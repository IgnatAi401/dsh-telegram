import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelegramBridge } from '../src/bridge.ts'
import type { TelegramBridgeOptions } from '../src/bridge.ts'
import type { TelegramClientLike, TelegramMessage, TelegramReplyMarkup, TelegramUpdate } from '../src/client.ts'

type Mock = ReturnType<typeof vi.fn>
type Listener = (...args: never[]) => unknown

interface FakeAgent {
  session: { id: string }
  status: 'idle' | 'running'
  followup: Mock
  steer: Mock
  cancel: Mock
}

interface Sent {
  messageId: number
  chatId: number
  text: string
  replyMarkup?: TelegramReplyMarkup
}

interface HarnessSetup {
  /** Existing sessions in the single workspace. */
  sessions?: Array<{ id: string; title?: string; archived?: boolean }>
  /** Whether the current model accepts images. */
  imageInput?: boolean
}

const temporary: string[] = []
let current: Harness | undefined
afterEach(async () => {
  await current?.bridge.stop()
  current = undefined
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(path)
  return path
}

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function createHarness(options: Partial<TelegramBridgeOptions> = {}, setup: HarnessSetup = {}) {
  const sent: Sent[] = []
  const listeners = new Map<string, Listener[]>()
  const agents = new Map<string, FakeAgent>()
  const titles = new Map<string, string>()
  const selections = new Map<string, { provider: string; model: string; reasoningEffort?: string }>()
  const workspacePath = tempDir('telegram-workspace-')
  const sessionIds: string[] = []
  const archived: string[] = []
  let promptSpec: { name: string; text: (context: { agent?: FakeAgent }) => string } | undefined
  let nextMessageId = 1
  let nextSession = 1

  const agentFor = (id: string): FakeAgent => {
    let agent = agents.get(id)
    if (agent === undefined) {
      agent = { session: { id }, status: 'idle', followup: vi.fn(), steer: vi.fn(), cancel: vi.fn() }
      agents.set(id, agent)
    }
    return agent
  }
  for (const session of setup.sessions ?? []) {
    sessionIds.push(session.id)
    if (session.title !== undefined) titles.set(session.id, session.title)
    if (session.archived) archived.push(session.id)
  }
  const workspace = {
    id: 'ws-1',
    path: workspacePath,
    title: 'demo',
    get sessionIds() { return [...sessionIds] },
    status: vi.fn(async () => 'ok'),
    attachSession: vi.fn(async (id: string) => { if (!sessionIds.includes(id)) sessionIds.unshift(id) }),
  }
  const message = (chatId: number, messageId: number): TelegramMessage =>
    ({ message_id: messageId, chat: { id: chatId, type: 'private' }, date: 0 })
  const client = {
    sendRichMessageDraft: vi.fn(async () => true),
    sendRichMessage: vi.fn(async (chatId: number, text: string, _signal?: AbortSignal, replyMarkup?: TelegramReplyMarkup) => {
      const messageId = nextMessageId++
      sent.push({ messageId, chatId, text, ...(replyMarkup === undefined ? {} : { replyMarkup }) })
      return message(chatId, messageId)
    }),
    editRichMessage: vi.fn(async (chatId: number, messageId: number, text: string, _signal?: AbortSignal, replyMarkup?: TelegramReplyMarkup) => {
      sent.push({ messageId, chatId, text, ...(replyMarkup === undefined ? {} : { replyMarkup }) })
      return message(chatId, messageId)
    }),
    getUpdates: vi.fn(async () => [] as TelegramUpdate[]),
    sendChatAction: vi.fn(async () => true),
    setMyCommands: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async (chatId: number, messageId: number) => message(chatId, messageId)),
    answerCallbackQuery: vi.fn(async () => true),
    deleteMessages: vi.fn(async () => true),
    downloadFile: vi.fn(async (fileId: string) => ({ file: { file_id: fileId, file_unique_id: `u-${fileId}` }, data: PNG })),
    sendDocument: vi.fn(async (chatId: number, file: { name: string }) => {
      const messageId = nextMessageId++
      sent.push({ messageId, chatId, text: `[document] ${file.name}` })
      return message(chatId, messageId)
    }),
  } satisfies TelegramClientLike
  const models = {
    default: { provider: 'deepseek', model: 'flash' },
    routableProviders: ['deepseek'],
    failures: [],
    groups: [{
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'flash', name: 'Flash', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'pro', name: 'Pro' },
      ],
    }],
  }
  const userQuestions = { answer: vi.fn(() => true) }
  const ctx = {
    on: vi.fn((event: string, listener: Listener, opts?: { prepend?: boolean }) => {
      const list = listeners.get(event) ?? []
      if (opts?.prepend) list.unshift(listener)
      else list.push(listener)
      listeners.set(event, list)
      return () => { list.splice(list.indexOf(listener), 1); return true }
    }),
    get: vi.fn((name: string) => name === 'userQuestions' ? userQuestions : undefined),
    logger: { warn: vi.fn(), error: vi.fn() },
    agents: { get: vi.fn((id: string) => agents.get(id)) },
    systemPrompt: {
      context: vi.fn((spec: NonNullable<typeof promptSpec>) => { promptSpec = spec; return () => { promptSpec = undefined } }),
    },
    attachments: {
      imageLimits: {
        maxImageBytes: 1024, maxImagesPerMessage: 2, maxMessageImageBytes: 4096,
        maxImagePixels: 1_000_000, maxImageDimension: 4096,
        mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
      validateImage: vi.fn(async () => {}),
      saveImages: vi.fn(async (inputs: unknown[]) => inputs.map((_input, index) => ({ attachmentId: `img-${index}` }))),
      saveFile: vi.fn(async (input: { name: string }) => ({ attachmentId: 'file-1', name: input.name })),
    },
    llm: {
      resolveModelInfo: vi.fn(async (provider: string, model: string) => ({
        provider, id: model, name: model, inputModalities: setup.imageInput === false ? ['text'] : ['text', 'image'],
      })),
    },
    sessionController: {
      create: vi.fn(async (request: { workspaceId: string; agentPreset?: string }) => {
        const id = `session-${nextSession++}`
        agentFor(id)
        await workspace.attachSession(id)
        return { sessionId: id, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) }
      }),
      resolveAgent: vi.fn(async (id: string) => sessionIds.includes(id)
        ? { agent: agentFor(id) } : { error: new Error(`session "${id}" not found`) }),
      list: vi.fn(async () => ({
        items: sessionIds.map(id => ({
          sessionId: id, running: agents.get(id)?.status === 'running',
          projections: { kind: 'cached', asOfSeq: 0, values: titles.has(id) ? { title: titles.get(id) } : {} },
        })),
      })),
      projections: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
        asOfSeq: 0,
        values: {
          ...(titles.has(sessionId) ? { title: titles.get(sessionId) } : {}),
          modelSelection: { lastUsed: null, next: selections.get(sessionId) ?? null },
        },
      })),
      modelCatalog: vi.fn(async () => models),
      selectModel: vi.fn(async (request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) => {
        const { sessionId, ...selected } = request
        selections.set(sessionId, selected)
        return { selected }
      }),
    },
    workspaceRegistry: {
      list: vi.fn(() => [workspace]),
      get archivedSessionIds() { return [...archived] },
      archiveSession: vi.fn(async (id: string) => { archived.push(id) }),
      unarchiveSession: vi.fn(async (id: string) => { archived.splice(archived.indexOf(id), 1) }),
    },
  }
  const bridge = new TelegramBridge(ctx as unknown as Context, {
    token: '1:test',
    resultCacheDirectory: tempDir('telegram-results-'),
    allowAllUsers: true,
    client,
    sleep: async () => { await new Promise(resolve => setTimeout(resolve, 5)) },
    ...options,
  })
  bridge.start()

  const harness = {
    bridge, client, ctx, sent, agents, workspace, userQuestions, selections, archived,
    prompt: (agent: FakeAgent | undefined) => promptSpec?.text({ ...(agent === undefined ? {} : { agent }) }),
    /** Deliver one update through the same entry point as polling. */
    async dispatch(update: Partial<TelegramUpdate>): Promise<void> {
      await (bridge as unknown as { handleUpdate(update: TelegramUpdate): Promise<void> })
        .handleUpdate({ update_id: 1, ...update } as TelegramUpdate)
    },
    async text(text: string, extra: Partial<TelegramMessage> = {}): Promise<void> {
      await harness.dispatch({ message: { message_id: 900 + sent.length, chat: { id: 7, type: 'private' }, from: { id: 42 }, date: 0, text, ...extra } })
    },
    buttons(): Array<{ text: string; callback_data: string }> {
      const markup = [...sent].reverse().find(entry => entry.replyMarkup !== undefined && 'inline_keyboard' in entry.replyMarkup)?.replyMarkup
      return markup !== undefined && 'inline_keyboard' in markup ? markup.inline_keyboard.flat() : []
    },
    async click(label: string): Promise<void> {
      const panel = [...sent].reverse().find(entry => entry.replyMarkup !== undefined && 'inline_keyboard' in entry.replyMarkup)!
      const button = harness.buttons().find(item => item.text.includes(label))
      if (button === undefined) throw new Error(`missing button ${label}: ${harness.buttons().map(item => item.text).join(' | ')}`)
      await harness.dispatch({ callback_query: {
        id: `cb-${sent.length}`, from: { id: 42 }, data: button.callback_data,
        message: { message_id: panel.messageId, chat: { id: 7, type: 'private' }, date: 0 },
      } })
    },
    /** Bind chat 7 to a new session through the menu. */
    async newSession(): Promise<FakeAgent> {
      await harness.text('/menu')
      await harness.click('工作区与会话')
      await harness.click('demo')
      await harness.click('在此工作区新建会话')
      return agents.get(sessionIds[0]!)!
    },
    emit(sessionId: string, event: Partial<SessionEvent>): void {
      for (const listener of listeners.get('session/event') ?? []) {
        (listener as (session: { id: string }, event: SessionEvent) => void)({ id: sessionId }, { seq: 0, time: 0, ...event } as SessionEvent)
      }
    },
    /** Run one DSH waterfall event through the plugin's listener, falling back to `next`. */
    waterfall<T>(event: string, request: unknown, next: () => Promise<T>): Promise<T> {
      const listener = listeners.get(event)![0] as (request: unknown, next: () => Promise<T>) => Promise<T>
      return listener(request, next)
    },
    lastText(): string { return sent.at(-1)!.text },
  }
  current = harness
  return harness
}

async function waitFor<T>(get: () => T | undefined | false, description: string): Promise<T> {
  const deadline = Date.now() + 3000
  for (;;) {
    const value = get()
    if (value !== undefined && value !== false) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

function completeTurn(h: ReturnType<typeof createHarness>, sessionId: string, answer: string): void {
  h.emit(sessionId, { type: 'turn/start', data: { turn: 1 } })
  h.emit(sessionId, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: answer }] } } } as Partial<SessionEvent>)
  h.emit(sessionId, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
}

describe('TelegramBridge lifecycle', () => {
  it('registers DSH listeners, the channel prompt and the command list, and releases them on stop', async () => {
    const h = createHarness()
    expect(h.ctx.on.mock.calls.map(call => call[0])).toEqual([
      'session/event', 'agent/assistant-stream', 'user-questions/request', 'approval/request',
    ])
    expect(h.ctx.systemPrompt.context).toHaveBeenCalledWith(expect.objectContaining({ name: 'telegram:channel', required: true, interpolate: false }))
    await waitFor(() => h.client.setMyCommands.mock.calls.length > 0, 'command registration')
    expect(h.client.setMyCommands.mock.calls[0]![0].map((command: { command: string }) => command.command)).not.toContain('clear')
    await h.bridge.stop()
    expect(h.prompt(undefined)).toBeUndefined()
  })

  it('adds the Telegram channel prompt only for the bound session', async () => {
    const h = createHarness({}, { sessions: [{ id: 'web-only' }] })
    const agent = await h.newSession()
    expect(h.prompt(agent)).toContain('currently using a Telegram bot')
    expect(h.prompt({ session: { id: 'web-only' } } as FakeAgent)).toBe('')
    expect(h.prompt(undefined)).toBe('')
  })

  it('denies unauthorized users and ignores group chats', async () => {
    const h = createHarness({ allowAllUsers: false, allowedUserIds: [1] })
    await h.text('/menu')
    expect(h.lastText()).toContain('访问被拒绝')
    const count = h.sent.length
    await h.dispatch({ message: { message_id: 1, chat: { id: -5, type: 'group' }, from: { id: 1 }, date: 0, text: '/menu' } })
    expect(h.sent).toHaveLength(count)
  })

  it('asks for a session before forwarding ordinary text', async () => {
    const h = createHarness()
    await h.text('你好')
    expect(h.lastText()).toContain('尚未选择会话')
  })
})

describe('TelegramBridge sessions and menu', () => {
  it('creates sessions through the Session Controller with the configured preset', async () => {
    const h = createHarness({ preset: 'creator' })
    await h.newSession()
    expect(h.ctx.sessionController.create).toHaveBeenCalledWith({ workspaceId: 'ws-1', agentPreset: 'creator' })
    // The panel is sent once and then edited in place.
    expect(h.client.sendRichMessage).toHaveBeenCalledTimes(1)
    expect(h.client.editRichMessage).toHaveBeenCalledTimes(3)
    expect(h.lastText()).toContain('session-1')
    await h.text('/new')
    expect(h.ctx.sessionController.create).toHaveBeenCalledTimes(2)
    expect(h.lastText()).toContain('已创建新会话')
  })

  it('opens an existing session with its projected title and refuses one bound to another chat', async () => {
    const h = createHarness({}, { sessions: [{ id: 'old', title: '旧\n会话' }] })
    await h.text('/menu')
    await h.click('工作区与会话')
    await h.click('demo')
    expect(h.lastText()).toContain('<code>旧 会话</code>')
    await h.click('旧 会话')
    expect(h.ctx.sessionController.resolveAgent).toHaveBeenCalledWith('old')
    expect(h.lastText()).toContain('已切换会话')
    await h.dispatch({ message: { message_id: 1, chat: { id: 8, type: 'private' }, from: { id: 42 }, date: 0, text: '/menu' } })
    const panel = h.sent.at(-1)!
    for (const label of ['工作区与会话', 'demo', '旧 会话']) {
      const button = h.buttons().find(item => item.text.includes(label))
      if (button === undefined) throw new Error(`${label}: ${h.buttons().map(item => item.text).join(' | ')} / ${h.lastText()}`)
      await h.dispatch({ callback_query: { id: 'x', from: { id: 42 }, data: button.callback_data,
        message: { message_id: panel.messageId, chat: { id: 8, type: 'private' }, date: 0 } } })
    }
    expect(h.lastText()).toContain('该会话正在被另一个 Telegram 私聊使用')
  })

  it('archives the current session and unarchives it when reopened', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.text('/archive')
    expect(h.ctx.workspaceRegistry.archiveSession).toHaveBeenCalledWith(agent.session.id)
    expect(h.lastText()).toContain('已归档会话')
    await h.text('你好')
    expect(h.lastText()).toContain('尚未选择会话')
    await h.text('/menu')
    await h.click('工作区与会话')
    await h.click('demo')
    await h.click('已归档')
    expect(h.ctx.workspaceRegistry.unarchiveSession).toHaveBeenCalledWith(agent.session.id)
    expect(h.lastText()).toContain('已取消归档并切换到该会话')
  })

  it('refuses to archive or switch while a task runs', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    agent.status = 'running'
    await h.text('/archive')
    expect(h.lastText()).toContain('任务仍在运行')
    await h.text('/menu')
    await h.click('新建会话')
    expect(h.lastText()).toContain('任务仍在运行')
    expect(h.ctx.sessionController.create).toHaveBeenCalledTimes(1)
  })

  it('switches model and reasoning through the Session Controller', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.click('推理强度')
    await h.click('Low')
    expect(h.ctx.sessionController.selectModel).toHaveBeenLastCalledWith({
      sessionId: agent.session.id, provider: 'deepseek', model: 'flash', reasoningEffort: 'low',
    })
    expect(h.lastText()).toContain('**推理强度**：<code>Low</code>')
    await h.click('切换模型')
    await h.click('Pro')
    expect(h.ctx.sessionController.selectModel).toHaveBeenLastCalledWith({ sessionId: agent.session.id, provider: 'deepseek', model: 'pro' })
    expect(h.lastText()).toContain('**模型**：<code>Pro</code>')
    expect(h.lastText()).toContain('不支持')
  })

  it('rejects stale and repeated menu callbacks', async () => {
    const h = createHarness()
    await h.text('/menu')
    const button = h.buttons()[0]!
    const panel = h.sent.at(-1)!
    const click = () => h.dispatch({ callback_query: { id: 'c', from: { id: 42 }, data: button.callback_data,
      message: { message_id: panel.messageId, chat: { id: 7, type: 'private' }, date: 0 } } })
    await click()
    await click()
    expect(h.client.answerCallbackQuery).toHaveBeenLastCalledWith('c', '菜单已失效，请重新发送 /menu。', undefined, expect.anything())
  })
})

describe('TelegramBridge input', () => {
  it('queues text when idle, steers while running, and queues an explicit /followup', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.text('第一条')
    expect(agent.followup.mock.calls[0]![0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: '第一条' }] })
    agent.status = 'running'
    await h.text('插话')
    expect(agent.steer.mock.calls[0]![0].content).toEqual([{ type: 'text', text: '插话' }])
    await h.text('/followup 稍后再做')
    expect(agent.followup.mock.calls[1]![0].content).toEqual([{ type: 'text', text: '稍后再做' }])
  })

  it('keeps reply context in the same message', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.text('解释一下', { reply_to_message: { message_id: 3, chat: { id: 7, type: 'private' }, date: 0, text: '原文', from: { id: 1, username: 'bob' } } })
    const content = agent.followup.mock.calls[0]![0].content
    expect(content[0].text).toContain('[Telegram 引用消息 #3，来自 @bob')
    expect(content[0].text).toContain('> 原文')
    expect(content[1]).toEqual({ type: 'text', text: '解释一下' })
  })

  it('saves photos into the workspace and submits them as image attachments', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.dispatch({ message: { message_id: 5, chat: { id: 7, type: 'private' }, from: { id: 42 }, date: 0, caption: '看图',
      photo: [{ file_id: 'small', file_unique_id: 's', width: 1, height: 1, file_size: 10 }, { file_id: 'big', file_unique_id: 'b', width: 9, height: 9, file_size: 90 }] } })
    expect(h.client.downloadFile).toHaveBeenCalledWith('big', 1024, expect.anything())
    expect(readdirSync(join(h.workspace.path, 'telegram-downloads'))).toEqual(['b-5-telegram-photo-5.png'])
    const content = agent.followup.mock.calls[0]![0].content
    expect(content.map((block: { type: string }) => block.type)).toEqual(['text', 'image', 'text'])
    // Absolute, so the path stays valid after the Session's working directory moves.
    expect(content[0].text).toBe(`[Telegram 图片已保存到工作区：${join(realpathSync(h.workspace.path), 'telegram-downloads', 'b-5-telegram-photo-5.png')}]`)
    expect(content[1].attachment).toEqual({ attachmentId: 'img-0' })
  })

  it('rejects images when the session model lacks image input', async () => {
    const h = createHarness({}, { imageInput: false })
    const agent = await h.newSession()
    await h.dispatch({ message: { message_id: 5, chat: { id: 7, type: 'private' }, from: { id: 42 }, date: 0,
      photo: [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }] } })
    expect(h.lastText()).toContain('不支持图片输入')
    expect(agent.followup).not.toHaveBeenCalled()
  })

  it('stores documents through DSH attachments', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.dispatch({ message: { message_id: 6, chat: { id: 7, type: 'private' }, from: { id: 42 }, date: 0,
      document: { file_id: 'd', file_unique_id: 'd', file_name: 'notes.txt', mime_type: 'text/plain' } } })
    expect(h.ctx.attachments.saveFile).toHaveBeenCalledWith({ data: PNG, name: 'notes.txt' })
    expect(agent.followup.mock.calls[0]![0].content).toEqual([{ type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.txt' } }])
  })

  it('collects several messages and submits them together', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    await h.text('/collect')
    await h.text('第一段')
    await h.text('第二段')
    expect(agent.followup).not.toHaveBeenCalled()
    await h.text('/send 结尾')
    expect(agent.followup.mock.calls[0]![0].content.map((block: { text: string }) => block.text)).toEqual(['第一段', '第二段', '结尾'])
    expect(h.lastText()).toContain('已提交收集内容')
  })

  it('refuses input for a session archived elsewhere', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.archived.push(agent.session.id)
    await h.text('你好')
    expect(h.lastText()).toContain('当前会话已归档')
    expect(agent.followup).not.toHaveBeenCalled()
  })
})

describe('TelegramBridge turn delivery', () => {
  it('delivers one final rich message, caches it and resends on request', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    completeTurn(h, agent.session.id, '**完成**')
    await waitFor(() => h.lastText() === '**完成**', 'final answer')
    expect(h.client.sendChatAction).toHaveBeenCalledWith(7, 'typing', expect.anything())
    await h.text('/resend')
    expect(h.sent.filter(entry => entry.text === '**完成**')).toHaveLength(2)
  })

  it('shows intermediate messages while running, then replaces them with the folded final message', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    const id = agent.session.id
    h.emit(id, { type: 'turn/start', data: { turn: 1 } })
    h.emit(id, { type: 'step/start', data: { turn: 1, step: 1 } })
    h.emit(id, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '先看看' }, { type: 'tool-call', id: 't' }] } } } as Partial<SessionEvent>)
    const intermediate = await waitFor(() => h.sent.find(entry => entry.text === '先看看'), 'intermediate message')
    h.emit(id, { type: 'tool/call', data: { turn: 1, step: 1, callId: 't', name: 'read', arguments: '{}' } } as Partial<SessionEvent>)
    h.emit(id, { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: { toolCallId: 't', content: [] } } } as Partial<SessionEvent>)
    h.emit(id, { type: 'step/start', data: { turn: 1, step: 2 } })
    h.emit(id, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: '答案' }] } } } as Partial<SessionEvent>)
    h.emit(id, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const final = await waitFor(() => h.sent.find(entry => entry.text.endsWith('答案'))?.text, 'final')
    expect(final).toMatch(/^<details><summary>1 次工具调用 · 1 条消息<\/summary>\n\n先看看\n\n<\/details>\n\n答案$/)
    await waitFor(() => h.client.deleteMessages.mock.calls.some(call => (call[1] as number[]).includes(intermediate.messageId)), 'cleanup')
  })

  it('reports failed turns and ignores sessions not bound to Telegram', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.emit('other', { type: 'turn/start', data: { turn: 1 } })
    h.emit(agent.session.id, { type: 'turn/start', data: { turn: 1 } })
    h.emit(agent.session.id, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'x', code: 'X' } } } } as Partial<SessionEvent>)
    await waitFor(() => h.lastText().includes('任务执行失败'), 'failure notice')
  })

  it('tells the user when delivery fails and keeps the result for /resend', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.client.sendRichMessage.mockRejectedValueOnce(new Error('message is too long'))
    completeTurn(h, agent.session.id, '很长的答案')
    await waitFor(() => h.lastText().includes('结果发送失败'), 'failure notice')
    await h.text('/resend')
    expect(h.lastText()).toBe('很长的答案')
  })

  it('streams drafts for the bound session only', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.emit(agent.session.id, { type: 'turn/start', data: { turn: 1 } })
    const stream = (session: string, frame: unknown) => {
      for (const listener of [h.ctx.on.mock.calls.find(call => call[0] === 'agent/assistant-stream')![1]]) {
        (listener as (payload: unknown) => void)({ agent: { session: { id: session } }, frame })
      }
    }
    stream(agent.session.id, { type: 'start', attemptId: 'a', revision: 1, turn: 1, step: 1 })
    stream(agent.session.id, { type: 'chunk', attemptId: 'a', revision: 2, index: 0, time: 0, chunk: { type: 'text-delta', index: 0, text: '正在写' } })
    stream('other', { type: 'chunk', attemptId: 'a', revision: 3, index: 1, time: 0, chunk: { type: 'text-delta', index: 0, text: '别人' } })
    await waitFor(() => h.client.sendRichMessageDraft.mock.calls.some(call => String(call[2]).includes('正在写')), 'draft')
    expect(h.client.sendRichMessageDraft.mock.calls.some(call => String(call[2]).includes('别人'))).toBe(false)
  })

  it('cancels the running turn on native Stop without delivering the partial answer', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.emit(agent.session.id, { type: 'turn/start', data: { turn: 1 } })
    agent.status = 'running'
    await h.dispatch({ stopped_message_generation: { chat: { id: 7, type: 'private' }, draft_id: 1 } })
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' })
    h.emit(agent.session.id, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '半截' }] } } } as Partial<SessionEvent>)
    h.emit(agent.session.id, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } } as Partial<SessionEvent>)
    await settle()
    expect(h.sent.some(entry => entry.text.includes('已中断当前任务'))).toBe(true)
    expect(h.sent.some(entry => entry.text.includes('半截'))).toBe(false)
  })
})

describe('TelegramBridge questions and approvals', () => {
  const question = { id: 'q', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }

  it('answers bound questions with buttons and removes them after the turn', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.emit(agent.session.id, { type: 'turn/start', data: { turn: 1 } })
    const answer = h.waterfall('user-questions/request', { agent, questions: [question] }, async () => ({ answers: [] }))
    await waitFor(() => h.lastText().includes('选哪个？'), 'question')
    const questionId = h.sent.at(-1)!.messageId
    await h.click('2. B')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] })
    h.emit(agent.session.id, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await waitFor(() => h.client.deleteMessages.mock.calls.some(call => (call[1] as number[]).includes(questionId)), 'cleanup')
  })

  it('shows the question below the intermediate message that asked it, and removes both after the turn', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    h.emit(agent.session.id, { type: 'turn/start', data: { turn: 1 } })
    h.emit(agent.session.id, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '已检查配置' }, { type: 'tool-call', id: 'q' }] } } } as Partial<SessionEvent>)
    const answer = h.waterfall('user-questions/request', { agent, questions: [question] }, async () => ({ answers: [] }))
    await waitFor(() => h.lastText().includes('选哪个？'), 'question')
    const intermediate = h.sent.at(-2)!
    expect(intermediate.text).toBe('已检查配置')
    await h.click('1. A')
    await answer
    h.emit(agent.session.id, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const questionId = h.sent.find(entry => entry.text.includes('选哪个？'))!.messageId
    await waitFor(() => h.client.deleteMessages.mock.calls.length > 0, 'cleanup')
    expect(h.client.deleteMessages.mock.calls.flatMap(call => call[1] as number[])).toEqual(expect.arrayContaining([intermediate.messageId, questionId]))
  })

  it('accepts typed answers and delegates questions from unbound sessions', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    const answer = h.waterfall('user-questions/request', { agent, questions: [{ id: 'free', question: '名字？' }] }, async () => ({ answers: [] }))
    await waitFor(() => h.lastText().includes('名字？'), 'question')
    await h.text('小明')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'free', selected: [], custom: '小明' }] })
    expect(agent.followup).not.toHaveBeenCalled()
    const next = vi.fn(async () => ({ answers: [] }))
    await h.waterfall('user-questions/request', { agent: { session: { id: 'web' } }, questions: [question] }, next)
    expect(next).toHaveBeenCalled()
  })

  it('rejects with ASK_CANCELLED on /cancel and ASK_ABORTED when DSH withdraws the request', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    const cancelled = h.waterfall('user-questions/request', { agent, questions: [question] }, async () => ({ answers: [] }))
    await waitFor(() => h.lastText().includes('选哪个？'), 'question')
    await h.text('/cancel')
    await expect(cancelled).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    const controller = new AbortController()
    const aborted = h.waterfall('user-questions/request', { agent, questions: [question], signal: controller.signal }, async () => ({ answers: [] }))
    await waitFor(() => h.sent.filter(entry => entry.text.includes('选哪个？')).length === 2, 'second question')
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'ASK_ABORTED' })
  })

  it('keeps a timed question answerable after its wait expires and steers the late answer', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    const controller = new AbortController()
    const asked = h.waterfall('user-questions/request', {
      agent, questions: [question], signal: controller.signal, wait: { callId: 'call-1', timed: true },
    }, async () => ({ answers: [] }))
    await waitFor(() => h.lastText().includes('选哪个？'), 'question')
    controller.abort(Object.assign(new Error('timed out'), { code: 'ASK_TIMED_OUT' }))
    await expect(asked).rejects.toMatchObject({ code: 'ASK_TIMED_OUT' })
    await waitFor(() => h.lastText().includes('等待回答已超时'), 'timeout notice')
    await h.click('1. A')
    expect(h.userQuestions.answer).toHaveBeenCalledWith(agent, 'call-1', { answers: [{ id: 'q', selected: ['A'] }] })
    expect(h.lastText()).toContain('回答已发送给 Agent')
  })

  it('grants approvals only through the explicit buttons', async () => {
    const h = createHarness()
    const agent = await h.newSession()
    const approval = h.waterfall('approval/request', {
      agent, toolName: 'bash', reason: 'raw', displayReason: { en: 'english', zh: '需要更高权限' },
    }, async () => 'unavailable')
    await waitFor(() => h.lastText().includes('权限审批'), 'approval')
    expect(h.lastText()).toContain('需要更高权限')
    await h.text('好的')
    expect(h.lastText()).toContain('正在等待权限审批')
    await h.click('仅允许本次')
    await expect(approval).resolves.toBe('allowed-once')
    const rejected = h.waterfall('approval/request', { agent, toolName: 'bash' }, async () => 'unavailable')
    await waitFor(() => h.sent.filter(entry => entry.text.includes('工具：')).length === 2, 'second approval')
    await h.click('拒绝')
    await expect(rejected).resolves.toBe('rejected')
  })
})

describe('TelegramBridge file delivery', () => {
  it('uploads a workspace file named by a send directive and strips the directive', async () => {
    const h = createHarness()
    await h.newSession()
    const root = realpathSync(h.ctx.workspaceRegistry.list()[0]!.path)
    const target = join(root, 'report.txt')
    writeFileSync(target, 'hello')
    completeTurn(h, 'session-1', `结果如下\n\n[[send: ${target}]]`)
    await waitFor(() => h.client.sendDocument.mock.calls.length > 0, 'document upload')
    expect(h.client.sendDocument).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'report.txt' }), expect.anything())
    await waitFor(() => h.sent.some(entry => entry.text.includes('结果如下')), 'text delivery')
    // The directive is a control line, never visible chat content.
    expect(h.sent.map(entry => entry.text).join('\n')).not.toContain('[[send:')
  })

  it('refuses a send directive that resolves outside the workspace', async () => {
    const h = createHarness()
    await h.newSession()
    const outside = join(tmpdir(), `outside-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
    writeFileSync(outside, 'secret')
    try {
      completeTurn(h, 'session-1', `看这个\n\n[[send: ${outside}]]`)
      await waitFor(() => h.sent.some(entry => entry.text.includes('不在当前工作区内')), 'refusal notice')
      expect(h.client.sendDocument).not.toHaveBeenCalled()
    } finally {
      rmSync(outside, { force: true })
    }
  })
})
