import { richExamples } from './fixtures/rich-markdown.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TelegramApiError } from '../src/client.ts'
import type { TelegramClientLike } from '../src/client.ts'
import { TelegramProgress } from '../src/progress.ts'

let progress: TelegramProgress | undefined
afterEach(() => { progress?.dispose(); progress = undefined; vi.useRealTimers() })

function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const client = {
    sendRichMessageDraft: vi.fn(async () => true),
    sendRichMessage: vi.fn(async () => ({ message_id: 31 })),
  }
  let queue = Promise.resolve()
  const warn = vi.fn()
  const track = vi.fn()
  progress = new TelegramProgress(client as unknown as TelegramClientLike, 7, new AbortController().signal,
    task => { queue = queue.then(task); return queue }, warn, track)
  // Wait for follow-up tasks enqueued while draining as well.
  const drain = async () => { for (let current; current !== queue;) await (current = queue) }
  return { client, warn, track, drain, p: progress }
}

function commit(p: TelegramProgress, text: string) {
  p.event({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } } as SessionEvent)
}

function tooling(p: TelegramProgress, text: string) {
  p.event({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }, { type: 'tool-call', id: 't' }] } } } as SessionEvent)
}

function start(p: TelegramProgress, attemptId = 'a', revision = 1) {
  p.stream({ type: 'start', attemptId, revision, turn: 1, step: 1 } as AssistantStreamFrame)
}

function chunk(p: TelegramProgress, text: string, revision: number, attemptId = 'a') {
  p.stream({ type: 'chunk', attemptId, revision, index: revision - 2, time: Date.now(),
    chunk: { type: 'text-delta', index: 0, text } } as AssistantStreamFrame)
}

describe('TelegramProgress', () => {
  it('sends tool-calling messages as real messages and previews only the text being generated', async () => {
    const { p, client, drain } = setup()
    tooling(p, '**检查项目**\n\n- 配置正常')
    tooling(p, '```sh\npnpm test')
    start(p)
    chunk(p, '```ts\nconst ok = true', 2)
    await drain()
    expect(client.sendRichMessage.mock.calls.map(call => call[1]))
      .toEqual(['**检查项目**\n\n- 配置正常', '```sh\npnpm test\n```'])
    const preview = String(client.sendRichMessageDraft.mock.calls.at(-1)?.[2])
    expect(preview).toMatch(/<\/tg-thinking>\n\n```ts\nconst ok = true\n```$/)
    expect(preview).not.toContain('检查项目')
    chunk(p, '\n```\n\n完成', 3)
    await vi.advanceTimersByTimeAsync(1200)
    expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain('```ts\nconst ok = true\n```\n\n完成')
  })

  it('continues in a fresh draft after each real message, so Telegram never replays it', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '先看看', 2)
    await drain()
    tooling(p, '先看看')
    p.event({ type: 'tool/call', time: 100000, data: { callId: 't', name: 'bash' } } as SessionEvent)
    await vi.advanceTimersByTimeAsync(1200)
    const ids = client.sendRichMessageDraft.mock.calls.map(call => call[1])
    expect(new Set(ids).size).toBe(2)
    const last = String(client.sendRichMessageDraft.mock.calls.at(-1)?.[2])
    expect(last).toContain('正在执行工具')
    expect(last).not.toContain('先看看')
    expect(client.sendRichMessage).toHaveBeenCalledTimes(1)
  })

  it('holds a message without tool calls as the answer, and sends it once the turn goes on', async () => {
    const { p, client, drain } = setup()
    commit(p, '看起来是答案')
    await drain()
    expect(client.sendRichMessage).not.toHaveBeenCalled()
    expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain('看起来是答案')
    p.event({ type: 'step/start', data: { step: 2 } } as SessionEvent)
    commit(p, '真正的答案')
    await drain()
    expect(client.sendRichMessage.mock.calls.map(call => call[1])).toEqual(['看起来是答案'])
    expect(p.finalMessage()).toMatch(/^<details><summary>0 次工具调用 · 1 条消息<\/summary>\n\n看起来是答案\n\n<\/details>\n\n真正的答案$/)
  })

  it('never sends reasoning, tool arguments or tool results', async () => {
    const { p, client, drain } = setup()
    p.event({ type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: '先检查状态' }, { type: 'text', text: '正在检查' }, { type: 'tool-call', id: 'a' },
    ] } } } as SessionEvent)
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read', arguments: '{"path":"a.ts"}' } } as SessionEvent)
    p.event({ type: 'tool/result', time: 101000, data: { message: { toolCallId: 'a', isError: true, content: [{ type: 'text', text: '文件不存在' }] } } } as SessionEvent)
    p.event({ type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: '整理结果' }, { type: 'text', text: '**最终答案**' },
    ] } } } as SessionEvent)
    await vi.advanceTimersByTimeAsync(1200)
    await drain()
    const output = [...client.sendRichMessage.mock.calls, ...client.sendRichMessageDraft.mock.calls]
      .map(call => String(call[1]) + String(call[2])).join('\n')
    expect(output).toContain('正在检查')
    expect(output).not.toMatch(/先检查状态|整理结果|a\.ts|文件不存在|read/)
  })

  it('never sends abandoned streaming attempts', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '丢弃的草稿', 2)
    for (let i = 0; i < 5; i++) tooling(p, `步骤 ${i}`)
    commit(p, '答案')
    await drain()
    expect(client.sendRichMessage.mock.calls.map(call => call[1])).toEqual(['步骤 0', '步骤 1', '步骤 2', '步骤 3', '步骤 4'])
    expect(p.finalMessage()).toMatch(/<\/details>\n\n答案$/)
  })

  it('folds intermediate messages and counts without reasoning or tool details', () => {
    const { p } = setup()
    const assistant = (content: unknown[]) => p.event({ type: 'assistant/message', data: { message: { content } } } as SessionEvent)
    assistant([{ type: 'reasoning', text: '先检查 <details> & 状态' }, { type: 'text', text: '正在检查' }])
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read', arguments: '{"path":"a.ts"}' } } as SessionEvent)
    p.event({ type: 'tool/result', time: 101000, data: { message: { toolCallId: 'a', isError: true, content: [{ type: 'text', text: '文件不存在' }] } } } as SessionEvent)
    assistant([{ type: 'reasoning', text: '整理结果' }, { type: 'text', text: '**最终答案**' }])
    const result = p.finalMessage('**最终答案**')!
    expect(result).not.toContain('先检查 &lt;details&gt; &amp; 状态')
    expect(result).toContain('正在检查')
    expect(result).not.toContain('```json\n{\n  \"path\": \"a.ts\"\n}\n```')
    expect(result).not.toContain('读取 · 文件不存在')
    expect(result).not.toContain('文件不存在')
    expect(result).not.toContain('整理结果')
    expect(result.match(/最终答案/g)).toHaveLength(1)
    expect(result).toMatch(/<\/details>\n\n\*\*最终答案\*\*$/)
    expect(result).not.toContain('<details open')
  })

  it('retains all committed steps, but never abandoned streaming attempts', () => {
    const { p } = setup()
    start(p)
    chunk(p, '丢弃的草稿', 2)
    for (let i = 0; i < 20; i++) {
      p.event({ type: 'assistant/message', data: { message: { content: [
        { type: 'text', text: `步骤 ${i}` },
      ] } } } as SessionEvent)
    }
    const result = p.finalMessage('步骤 19')!
    expect(result).toContain('步骤 0')
    expect(result).toContain('步骤 18')
    expect(result).not.toContain('丢弃的草稿')
    expect(result.match(/步骤 19/g)).toHaveLength(1)
  })

  it('includes reasoning-only turns and results arriving after the last answer', () => {
    const { p } = setup()
    p.event({ type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: '已确认的思考' },
    ] } } } as SessionEvent)
    expect(p.finalMessage('任务已完成')).toBe('任务已完成')
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read', arguments: '{}' } } as SessionEvent)
    p.event({ type: 'tool/result', time: 101000, data: { message: { toolCallId: 'a', content: [{ type: 'text', text: '迟到的结果' }] } } } as SessionEvent)
    expect(p.finalMessage('任务已完成')).toMatch(/^<details><summary>1 次工具调用 · 0 条消息<\/summary>[\s\S]*任务已完成$/)
    p.stopByUser()
    expect(p.finalMessage('任务已完成')).toBeUndefined()
  })

  it('preserves code source for the native rich parser', () => {
    const { p } = setup()
    commit(p, 'Before\n\n```ts\nconst a = 1\n```\n\nAfter')
    const html = p.finalMessage('Before\n\n```ts\nconst a = 1\n```\n\nAfter')!
    expect(html).toBe('Before\n\n```ts\nconst a = 1\n```\n\nAfter')
    expect(html).not.toContain('<p><pre>')
    expect(html).toContain('After')
  })

  it('preserves every streamed formula prefix and does not append metadata inside unfinished code', async () => {
    const { p, client, drain } = setup()
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read<file>', arguments: '{}' } } as SessionEvent)
    start(p)
    let prefix = ''
    let revision = 2
    for (const part of ['公式 $', String.raw`\frac{`, '1}{2}', '$']) {
      prefix += part
      chunk(p, part, revision++)
      await vi.advanceTimersByTimeAsync(1200)
      await drain()
      expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain(prefix)
    }
    const code = '```html\n<details>source'
    expect(p.finalMessage(code)?.endsWith(code)).toBe(true)
    expect(p.finalMessage(code)!).not.toContain('read&lt;file&gt;')
    for (const [, source] of richExamples) expect(p.finalMessage(source)?.endsWith(source)).toBe(true)
  })

  it('combines tool counts and answer in one message without large tool output', () => {
    const { p } = setup()
    const log = '详细工具输出\n'.repeat(2000)
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read', arguments: '{}' } } as SessionEvent)
    p.event({ type: 'tool/result', time: 101000, data: { message: { toolCallId: 'a', content: [{ type: 'text', text: log }] } } } as SessionEvent)
    p.event({ type: 'assistant/message', data: { message: { content: [
      { type: 'text', text: '这是最终正文。' },
    ] } } } as SessionEvent)
    const result = p.finalMessage('这是最终正文。')!
    expect(result.endsWith('</details>\n\n这是最终正文。')).toBe(true)
    expect(p.finalMessage('这是最终正文。')).toMatch(/^<details>/)
    expect(result).not.toContain(log)
    expect(result).toContain('1 次工具调用 · 0 条消息')
    expect(result.match(/<details>/g)).toHaveLength(1)
    expect(result.match(/这是最终正文。/g)).toHaveLength(1)
  })

  it('places the process disclosure before an unfinished answer', () => {
    const { p } = setup()
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read', arguments: '{}' } } as SessionEvent)
    const answer = '<details><summary>说明</summary>\n\n正文'
    const message = p.finalMessage(answer)
    expect(message).toMatch(/^<details><summary>1 次工具调用/)
    expect(message?.endsWith('</details>\n\n' + answer)).toBe(true)
  })

  it('aborts an in-flight draft on disposal so final delivery can proceed', async () => {
    const { p, client, drain } = setup()
    client.sendRichMessageDraft.mockImplementationOnce((...args: unknown[]) => new Promise((_resolve, reject) => {
      const signal = args[3] as AbortSignal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    await vi.advanceTimersByTimeAsync(0)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(1)
    p.dispose()
    await drain()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves code source for the native rich parser', () => {
    const { p } = setup()
    commit(p, 'Before\n\n```ts\nconst a = 1\n```\n\nAfter')
    const html = p.finalMessage('Before\n\n```ts\nconst a = 1\n```\n\nAfter')!
    expect(html).toBe('Before\n\n```ts\nconst a = 1\n```\n\nAfter')
    expect(html).not.toContain('<p><pre>')
    expect(html).toContain('After')
  })

  it('uses native formatting for both streamed previews and persisted replies', async () => {
    const { p, client, drain } = setup()
    const text = '# 标题\n\n| 项目 | 说明 |\n|---|---|\n| 粗体 | **正常** |\n\n---'
    start(p)
    chunk(p, text, 2)
    await drain()
    commit(p, text)
    const final = p.finalMessage(text)!
    expect(final).toBe(text)
    expect(final).toContain('# 标题')
    expect(final).toContain('---')
    expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain(final)
    expect(final).not.toContain('<pre>')
  })

  it.each(richExamples)('sends intermediate messages with native rich formatting: %s', async (_name, source) => {
    const { p, client, drain } = setup()
    tooling(p, source)
    await drain()
    expect(client.sendRichMessage.mock.calls[0]?.[1]).toBe(source)
  })

  it('closes unfinished syntax in an intermediate message', async () => {
    const { p, client, drain } = setup()
    tooling(p, '<details><summary>附注</summary>\n\n内容')
    await drain()
    expect(client.sendRichMessage.mock.calls[0]?.[1]).toBe('<details><summary>附注</summary>\n\n内容\n\n</details>')
  })

  it('still sends a queued intermediate message after the turn ends, and records it for removal', async () => {
    const { p, client, track, drain } = setup()
    tooling(p, '最后一步')
    p.dispose()
    await drain()
    expect(client.sendRichMessage.mock.calls.map(call => call[1])).toEqual(['最后一步'])
    expect(track).toHaveBeenCalledWith(31)
  })

  it('logs a failed intermediate message and keeps going', async () => {
    const { p, client, drain, warn } = setup()
    const error = new TelegramApiError('message is too long', 400)
    client.sendRichMessage.mockRejectedValueOnce(error)
    tooling(p, '太长')
    commit(p, '答案')
    await drain()
    expect(warn).toHaveBeenCalledWith(error)
    expect(p.finalMessage()).toMatch(/太长[\s\S]*答案$/)
  })

  it('keeps the other tool running when parallel results arrive out of order', async () => {
    const { p, client, drain } = setup()
    for (const callId of ['a', 'b']) {
      p.event({ type: 'tool/call', time: 100000, data: { callId, name: `tool-${callId}`, arguments: '{}' } } as SessionEvent)
    }
    p.event({ type: 'tool/result', time: 101000, data: { message: { toolCallId: 'b', content: [] } } } as SessionEvent)
    await drain()
    const html = client.sendRichMessageDraft.mock.calls.at(-1)?.[2]
    expect(html).toContain('正在执行工具')
    expect(html).not.toMatch(/tool-a|tool-b|✅|⏳|已完成/)
  })

  it('coalesces tokens in one stable draft, refreshing before expiry', async () => {
    const { p, client, drain } = setup()
    start(p)
    await drain()
    for (let i = 0; i < 100; i++) chunk(p, '字', i + 2)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1200)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(2)
    expect(client.sendRichMessageDraft.mock.calls[1]?.[2]).toContain('字'.repeat(100))
    await vi.advanceTimersByTimeAsync(12000)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(3)
    const ids = client.sendRichMessageDraft.mock.calls.map(call => call[1])
    expect(new Set(ids).size).toBe(1)
    expect(ids.every(id => Number.isInteger(id) && Number(id) > 0)).toBe(true)
  })

  it('clears a retried attempt and ignores stale chunks and duplicate revisions', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '旧答案', 2)
    await drain()
    start(p, 'b', 3)
    chunk(p, '迟到旧内容', 2)
    chunk(p, '新答案', 4, 'b')
    chunk(p, '重复', 4, 'b')
    await vi.advanceTimersByTimeAsync(1200)
    const html = client.sendRichMessageDraft.mock.calls.at(-1)?.[2]
    expect(html).toContain('新答案')
    expect(html).not.toMatch(/旧答案|迟到|重复/)
  })

  it('keeps drafts compact without tool arguments or results', async () => {
    const { p, client, drain } = setup()
    start(p)
    p.stream({ type: 'chunk', attemptId: 'a', revision: 2, index: 0, time: 100000,
      chunk: { type: 'tool-call-delta', id: 't', index: 0, name: 'bash', argumentsDelta: 'secret' } } as AssistantStreamFrame)
    await drain()
    expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain('正在准备工具调用')
    p.event({ type: 'tool/call', time: 100000, data: { callId: 't', name: 'bash<script>', arguments: 'secret' } } as SessionEvent)
    await vi.advanceTimersByTimeAsync(1200)
    p.event({ type: 'tool/result', time: 102000, data: { message: { toolCallId: 't', isError: true, content: [{ type: 'text', text: 'secret result' }] } } } as SessionEvent)
    await vi.advanceTimersByTimeAsync(1200)
    const drafts = client.sendRichMessageDraft.mock.calls.map(call => String(call[2])).join('\n')
    expect(drafts).toContain('正在执行工具')
    expect(drafts).not.toMatch(/secret|bash/)
    const final = p.finalMessage('完成')!
    expect(final).toContain('<details>')
    expect(final).not.toContain('secret result')
  })

  it('reports a rejected native preview without creating legacy preview messages', async () => {
    const { p, client, drain, warn } = setup()
    const error = new TelegramApiError('invalid rich content', 400)
    client.sendRichMessageDraft.mockRejectedValueOnce(error)
    await drain()
    expect(warn).toHaveBeenCalledWith(error)
    await vi.advanceTimersByTimeAsync(6000)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(2)
    expect(client.sendRichMessage).not.toHaveBeenCalled()
    commit(p, '完整答案')
    expect(p.finalMessage()).toBe('完整答案')
  })

  it('honors retry_after while continuing to coalesce and keeps native mode', async () => {
    const { p, client, drain } = setup()
    client.sendRichMessageDraft.mockRejectedValueOnce(new TelegramApiError('rate limited', 429, 5))
    start(p)
    await drain()
    chunk(p, '最新', 2)
    await vi.advanceTimersByTimeAsync(4800)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1200)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(2)
    expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain('最新')
  })

  it('does not downgrade on ambiguous network errors', async () => {
    const { client, drain } = setup()
    client.sendRichMessageDraft.mockRejectedValueOnce(new Error('network unavailable'))
    await drain()
    await vi.advanceTimersByTimeAsync(6000)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(2)
    expect(client.sendRichMessage).not.toHaveBeenCalled()
  })

  it('invalidates queued previews at finalization and releases the timer on disposal', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '部分', 2)
    p.pause()
    await drain()
    await vi.advanceTimersByTimeAsync(24000)
    expect(client.sendRichMessageDraft).not.toHaveBeenCalled()
    p.resume()
    await drain()
    p.dispose()
    chunk(p, '迟到', 3)
    await vi.advanceTimersByTimeAsync(24000)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not resume previews over a pending user question', async () => {
    const { p, client, drain } = setup()
    await drain()
    p.suspend()
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'parallel', name: 'read', arguments: '{}' } } as SessionEvent)
    await vi.advanceTimersByTimeAsync(24000)
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(1)
    p.resume()
    await drain()
    expect(client.sendRichMessageDraft).toHaveBeenCalledTimes(2)
  })

  it('resumes in a fresh draft after a user question', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '提问前', 2)
    await drain()
    const before = client.sendRichMessageDraft.mock.calls.at(-1)!
    p.suspend()
    p.resume()
    await vi.advanceTimersByTimeAsync(1200)
    expect(client.sendRichMessageDraft.mock.calls.at(-1)![1]).not.toBe(before[1])
  })

  it('caps previews without downgrading or truncating long final answers', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '中'.repeat(100000), 2)
    await drain()
    expect(String(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).length).toBeLessThan(20000)
    commit(p, '中'.repeat(25000))
    expect(p.finalMessage()).toBe('中'.repeat(25000))
  })

  it('defers disclosures until committed delivery and keeps tool status outside disclosures', async () => {
    const { p, client, drain } = setup()
    p.event({ type: 'tool/call', time: 100000, data: { callId: 'a', name: 'read', arguments: '{}' } } as SessionEvent)
    start(p)
    chunk(p, '<details><summary>摘要</summary>', 2)
    await drain()
    const preview = String(client.sendRichMessageDraft.mock.calls.at(-1)?.[2])
    expect(preview).not.toContain('<details>')
    expect(preview).toContain('折叠内容将在生成完成后显示')
    expect(preview).not.toMatch(/read|⏳|✅|已完成/)
    const complete = '<details><summary>摘要</summary>\n\n正文\n\n</details>'
    expect(p.finalMessage(complete)!).toContain(complete)
  })

  it('does not send truncated rich syntax or resume its tail after overflowing', async () => {
    const { p, client, drain } = setup()
    start(p)
    chunk(p, '<details><summary>摘要</summary>' + '字'.repeat(17000), 2)
    await drain()
    chunk(p, '</details>尾部', 3)
    await vi.advanceTimersByTimeAsync(1200)
    const preview = String(client.sendRichMessageDraft.mock.calls.at(-1)?.[2])
    expect(preview).toContain('回复较长')
    expect(preview).not.toMatch(/<\/?details>|尾部|字/)
    start(p, 'b', 4)
    chunk(p, '重试回复', 5, 'b')
    await vi.advanceTimersByTimeAsync(1200)
    expect(client.sendRichMessageDraft.mock.calls.at(-1)?.[2]).toContain('重试回复')
  })
})
