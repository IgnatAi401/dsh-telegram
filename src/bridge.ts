/**
 * Telegram→DSH bridge: owns the long-polling loop, the chat→session binding,
 * slash commands and menus, and delivery of each turn back to Telegram.
 * Sessions are created, resumed and configured through the Session
 * Controller, so Telegram and Web share sessions, models and presets.
 * @module telegram/bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelCatalog, ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller'
import type { FileAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { TelegramClient } from './client.js'
import type {
  TelegramCallbackQuery,
  TelegramClientLike,
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramReplyMarkup,
  TelegramUpdate,
  TelegramUser,
} from './client.js'
import { escapeHtml } from './format.js'
import { TelegramProgress } from './progress.js'
import { TelegramResultCache } from './result-cache.js'

/** Options for {@link TelegramBridge}. */
export interface TelegramBridgeOptions {
  /** Bot token from @BotFather. */
  token: string
  /** User ids allowed to talk to the bot; empty means none unless `allowAllUsers`. */
  allowedUserIds?: readonly number[]
  /** Allow any Telegram user (development only). */
  allowAllUsers?: boolean
  /** Agent preset for sessions created from Telegram; omitted uses the DSH default preset. */
  preset?: string
  /** Long-polling timeout in seconds. */
  pollingTimeoutSec?: number
  /** Bot API server; a self-hosted `telegram-bot-api` server lifts the 20 MiB download limit. */
  apiBaseUrl?: string
  /** Result cache root; defaults to DSH_HOME/telegram-results. */
  resultCacheDirectory?: string
  /** Client seam; tests substitute a fake. */
  client?: TelegramClientLike
  /** Delay seam; tests substitute an instant sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** The DSH session currently bound to one Telegram chat. */
interface ActiveChatSession {
  readonly chatId: number
  readonly workspace: Workspace
  readonly sessionId: SessionId
  /** Question/answer messages removed once the turn's result was delivered. */
  readonly transientMessageIds: Set<number>
  /** Per-chat serialization chain for Telegram side effects. */
  queue: Promise<void>
  typingTimer: NodeJS.Timeout | undefined
  progress: TelegramProgress | undefined
}

/** Telegram chat state; a workspace stays selected after archiving its session. */
interface ChatState {
  readonly chatId: number
  workspace: Workspace | undefined
  active: ActiveChatSession | undefined
}

/** One verified image downloaded from Telegram into the selected workspace. */
interface DownloadedWorkspaceImage {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
  readonly name: string
  /** Absolute path; a Session's working directory may differ from the workspace root. */
  readonly path: string
}

/** Pre-admission content accumulated by `/collect` or built from one message. */
type CollectedPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly image: DownloadedWorkspaceImage }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }

/** One collection is permanently bound to the session where it began. */
interface TelegramCollection {
  readonly chatId: number
  readonly sessionId: SessionId
  readonly parts: CollectedPart[]
  statusMessageId?: number
}

/** Download candidate extracted from a Telegram photo or image document. */
interface TelegramImageCandidate {
  readonly fileId: string
  readonly fileUniqueId: string
  readonly fileSize: number | undefined
  readonly suggestedName: string
  readonly telegramMessageId: number
}

type DeliveryMode = 'default' | 'followup'

type MenuView = 'home' | 'workspaces' | 'sessions' | 'models' | 'reasoning'

interface CatalogSession {
  readonly id: SessionId
  readonly title: string | undefined
  readonly archived: boolean
  readonly running: boolean
}

interface CatalogWorkspace {
  readonly workspace: Workspace
  readonly sessions: readonly CatalogSession[]
}

/** Current model route and title of one session. */
interface SessionStatus {
  readonly selection: ModelSelection
  readonly title: string | undefined
}

type TimedCallId = Parameters<Context['userQuestions']['answer']>[1]

/** One DSH question batch or approval waiting on a Telegram private chat. */
interface PendingTelegramQuestion {
  readonly approval: boolean
  readonly chatId: number
  readonly sessionId: SessionId
  readonly token: string
  readonly questions: readonly AskUserQuestionItem[]
  readonly answers: AskUserQuestionAnswerItem[]
  readonly resolve: (answer: AskUserQuestionAnswer) => void
  readonly reject: (reason: unknown) => void
  readonly signal: AbortSignal | undefined
  /** Timed `ask_user_question` call; after its wait expires the answer is steered in as a reply. */
  readonly timedCallId: TimedCallId | undefined
  readonly messageIds: Set<number>
  index: number
  selectedIndices: Set<number>
  keyboardMessageId: number | undefined
  onAbort: (() => void) | undefined
  /** The DSH request already settled; answers continue through `userQuestions.answer`. */
  continued: boolean
  settled: boolean
}

interface MenuState {
  readonly token: string
  readonly messageId: number
  readonly fingerprint: string
  readonly actions: Array<() => Promise<void>>
}

const COLLECTION_ACTIONS = [
  '| 操作 | 命令 |',
  '| :--- | :--- |',
  '| 立即提交 | `/send` |',
  '| 排到下一轮 | `/followup` |',
  '| 放弃收集 | `/discard` |',
].join('\n')

const FOLLOWUP_HELP = [
  'ℹ️ **/followup 用法**',
  '',
  '将消息排到当前任务之后执行：',
  '',
  '```text',
  '/followup 在这里填写消息',
  '```',
  '',
  '---',
  '',
  '- 回复一条文字、图片或文件后发送 `/followup`，可将引用内容加入队列。',
  '- 收集模式中单独发送 `/followup`，会提交全部收集内容。',
].join('\n')

const HELP_TEXT = [
  '# 📖 命令帮助',
  '',
  '## 会话管理',
  '',
  '| 命令 | 作用 |',
  '| :--- | :--- |',
  '| /menu | 打开控制面板 |',
  '| /new | 在当前工作区新建会话 |',
  '| /archive | 归档当前会话，保留聊天记录 |',
  '',
  '## 收集与排队',
  '',
  '| 命令 | 作用 |',
  '| :--- | :--- |',
  '| /collect | 开始收集文字、图片和文件 |',
  '| /send | 提交收集内容，可附加文字 |',
  '| /discard | 放弃本次收集 |',
  '| /followup | 将内容排到当前任务之后 |',
  '',
  '**排队示例**',
  '',
  '```text',
  '/followup 完成后请总结修改内容',
  '```',
  '',
  '收集模式中单独发送 `/followup`，即可提交全部收集内容。',
  '',
  '---',
  '',
  '## 发送与停止',
  '',
  '- **空闲时**：发送消息开启任务。',
  '- **运行中**：发送消息作为插话。',
  '- **图片与文件**：可附带说明，多段内容可先使用 /collect。文件下载上限为 20 MiB。',
  '- **停止任务**：点击 Telegram 生成预览上的停止按钮。',
  '',
  '## 回答 Agent',
  '',
  '点击选项或发送自定义回答；/skip 跳过当前问题，/cancel 取消整次提问。',
  '',
  '---',
  '',
  '| 其他命令 | 作用 |',
  '| :--- | :--- |',
  '| /start | 确认 Bot 在线 |',
  '| /help | 显示本页 |',
  '| /resend | 重发最后一份完整结果 |',
  '',
  '每个聊天保留最后一份完整结果，发送成功后仍可重发，新结果会覆盖旧缓存。',
].join('\n')

/** Slash-command list registered with Telegram via setMyCommands. */
const MY_COMMANDS = [
  { command: 'menu', description: '打开控制面板' },
  { command: 'start', description: '确认机器人在线' },
  { command: 'new', description: '在当前工作区新建会话' },
  { command: 'archive', description: '归档当前会话，保留聊天记录' },
  { command: 'collect', description: '收集文字、图片与文件' },
  { command: 'send', description: '提交收集内容' },
  { command: 'discard', description: '放弃本次收集' },
  { command: 'followup', description: '将消息排到当前任务之后' },
  { command: 'resend', description: '重发最后一份完整结果' },
  { command: 'help', description: '查看使用帮助' },
]

// Floor between polls so an instant-empty transport cannot hot-loop the
// event loop; real long polling already blocks for the polling timeout.
const POLL_CADENCE_MS = 50
const MENU_PAGE_SIZE = 8
const MAX_FILE_BYTES = 20 * 1024 * 1024
/** The public Bot API caps a bot-sent document at 50 MiB. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const DOWNLOAD_DIRECTORY = 'telegram-downloads'
/** A standalone reply line asking the plugin to upload one workspace file. */
const SEND_FILE_DIRECTIVE = /^\[\[send:\s*(.+?)\]\]$/i
const MAX_QUOTED_TEXT_LENGTH = 4096
const APPROVE_ONCE = '仅允许本次'
const REJECT = '拒绝'
const TELEGRAM_CHANNEL_PROMPT = [
  'The human interacting with this agent is currently using a Telegram bot.',
  'Treat user inputs and quoted-message context as coming from Telegram.',
  'Keep replies suitable for Telegram text delivery and do not assume the human can see or operate Web UI controls.',
  '以下格式约束仅适用于当前 Telegram 通道的回复，不限制用户要求生成的文件内容：',
  "- 回复直接作为 Telegram Rich Markdown 发送，由 Telegram 原生解析；不要预先按 Telegram MarkdownV2 转义整段回复。支持官方 Rich HTML 扩展，不支持任意网页、CSS 或 JavaScript。",
  "- 使用 # 到 ###### 标题、段落、--- 分隔线、嵌套有序/无序列表。长回复用少量清晰小标题，段落间一个空行，不用空格或框线字符手工排版。",
  "- 行内支持 **粗体**、*斜体*、~~删除线~~、==高亮==、||剧透||、`代码`；下划线用 <u> 或 <ins>，上下标用 <sup> 与 <sub>。需要展示语法本身时放进代码块并指定语言。",
  "- 任务清单使用 - [ ] 待办事项 和 - [x] 已完成事项。它表达清单状态，不等于创建 Telegram 可协作编辑的独立 Checklist，也不自动执行任务。",
  "- LaTeX 公式使用 $...$（行内）、$$...$$（独立公式）或 math 围栏代码块；保留公式中的反斜杠，不做二次转义。也可使用 <tg-math> 和 <tg-math-block>。金额中的美元符号在有歧义时用反斜杠转义。",
  "- 表格使用标准 Markdown 表格及 :---、:---:、---: 对齐标记。手机上优先 2–3 列短字段，长解释放在表外；单元格只含行内格式。需要合并单元格或样式时可用 <table bordered striped compact>、<caption>、<tr>、<th>、<td> 及 colspan、rowspan、align、valign。",
  "- 引用使用行首 >；可用 <blockquote expandable> 创建可展开引用，用 <aside> 搭配 <cite> 创建引述。不要依赖未在官方文档定义的 [!NOTE] 等提示块；提示标题直接加粗。",
  "- 脚注使用 [^note] 与单独的 [^note]: 说明；也可用 <tg-reference name=\"note\">。锚点用 <a name=\"section\"></a>，文内跳转用 [跳转](#section)。",
  "- 链接支持 https://、mailto:、tel: 和 tg://user?id=。完整网址、邮箱、用户名、话题、命令等交给 Telegram 自动识别；不要编造用户 ID。",
  "- 折叠内容使用 <details><summary>简短摘要</summary> 加正文并闭合 </details>；加 open 可默认展开。details、tg-collage、tg-slideshow 内可继续写 Markdown，其他 HTML 块内部只能使用 HTML 排版。脚注、长推导和补充资料可放在折叠块中。",
  "- 官方 HTML 还支持 <p>、<br>、<h1> 至 <h6>、<pre><code class=\"language-python\">、<footer>、<hr/>、<ul>、<ol>、<li> 与 <input type=\"checkbox\" checked>。标签必须正确闭合，HTML 属性和普通文字里的 &、<、> 按 HTML 规则转义。",
  "- 图片、视频、音频、语音、动画和文件可用独立一段的 ![说明](https://可访问的真实媒体地址 \"标题\")，Telegram 按地址及 MIME 类型识别媒体；只提供文字链接时用 [说明](地址)。不要把本地路径当成公开 URL；不要编造媒体地址。",
  "- 显式媒体标签支持 <img>、<video>、<audio>、<tg-document>，用 <figure><figcaption> 和 <cite> 加标题和来源，tg-spoiler 可隐藏媒体。拼图用 <tg-collage>，轮播用 <tg-slideshow>。媒体必须是独立块。",
  "- 复用已上传媒体的 tg://photo?id=、tg://video?id=、tg://audio?id=、tg://document?id= 需要真实媒体映射，当前没有映射工具，不要杜撰这些 ID。草稿不能新上传文件；媒体可能要等最终消息才显示。",
  "- 要把工作区里的文件真正发给用户，在最终回复里单独一行写 [[send: 工作区内的绝对路径]]，每行一个。插件会把它作为附件上传并从正文中移除。文件必须位于当前工作区内，单个不超过 50 MiB；不要用它发送公开媒体地址，也不要虚构路径。",
  "- 地图使用 <tg-map lat=\"纬度\" long=\"经度\" zoom=\"缩放级别\"/>，只填有依据的坐标。自定义表情用 <tg-emoji emoji-id=\"真实ID\">替代文字</tg-emoji>，日期时间用 <tg-time unix=\"真实Unix秒数\" format=\"wDT\">替代文字</tg-time>，也支持官方 tg://emoji 与 tg://time 语法。",
  "- 原生按钮用 <tg-button>，按钮行用 <tg-button-row align=\"left|center|right\">。可使用 type=\"url\" 搭配 url、type=\"copy_text\" 搭配 text，或 type=\"disabled\"；样式为 primary、success、danger、link。不要用按钮代替普通正文链接。",
  "- callback_data、web_app、login_url、switch_inline_query、switch_inline_query_current_chat、switch_inline_query_chosen_chat 按钮语法会原样传给 Telegram，但需要真实应用、域名或后端处理。当前插件只处理自己的菜单和提问按钮；不要生成自定义业务回调或承诺点击能执行工具。需要用户回答时使用已有 ask_user_question 工具。",
  "- <tg-thinking> 仅用于生成中的草稿，由插件负责插入状态；不要在最终答案中输出这个标签。插件会将 dsh 已提供的中间消息放入外层折叠记录，标题显示工具调用次数和中间消息数量，不包含思考或工具详情；无需在正文重复过程记录。",
  "- 富消息上限为 32768 个 UTF-8 字符、500 个块（含嵌套列表项及表格行）、16 层嵌套、50 个媒体、20 列表格。每条回复正文尽量少于 30000 字符，为插件运行记录留空间；超长内容应组织为精简回复和用户要求的文件。插件不截断最终答案、不转普通文本、不拆坏公式或脚注；超限或不支持的服务会明确记入发送失败日志。",
].join('\n')

const IMAGE_EXTENSIONS: Record<ImageMediaType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** Playful online acknowledgements from a reluctant but dependable assistant. */
const START_MESSAGES = [
  '在啦在啦，刚想摸会儿鱼就被你发现了。说吧，今天要我帮什么忙？',
  '哼，当然在线。才不是专门等你，只是还没找到合适的偷懒时机。',
  '唔……五分钟的休息计划泡汤了。把任务拿来吧，做完我还要继续躺着呢。',
  '收到啦，不用再戳了。麻烦事交给我，你把要求说清楚就好……才不是在照顾你。',
  '我在。先说好，能一步做完的事不许让我跑三趟，省下来的时间我要拿去摸鱼。',
  '被你叫醒了……好吧，这次也帮你。可不是因为特别想干活哦。',
  '在线，正在认真研究如何少干活。嗯？有任务？那就先把你的事做好再研究。',
  '哼，你来得倒挺准，刚好赶上我准备休息。说吧说吧，帮完这次再偷懒。',
] as const

/** A stable message string for logging, whatever the thrown shape. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** DSH restores record-shaped `UserQuestionError`s, so the optional package need not load at runtime. */
function userQuestionError(message: string, code: string, cause?: unknown): Error & { code: string } {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as Error & { code: string }
  error.name = 'UserQuestionError'
  error.code = code
  return error
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** True when Telegram rejected an edit only because the content is unchanged. */
function isNotModified(error: unknown): boolean {
  return /not modified/i.test(messageOf(error))
}

/** True when an edit/delete target is known not to exist anymore. */
function isMissingMessage(error: unknown): boolean {
  return /message to (?:edit|delete) not found|message can't be (?:edited|deleted)/i.test(messageOf(error))
}

/** Cut text without leaving a dangling high surrogate. */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  let end = Math.max(0, maxLength - 1)
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end -= 1
  return `${text.slice(0, end)}…`
}

/** Keep button text readable without risking an oversized keyboard label. */
function buttonLabel(text: string): string {
  const characters = [...text]
  return characters.length <= 56 ? text : `${characters.slice(0, 55).join('')}…`
}

/** Quote runtime labels as literal inline HTML, never as executable rich markup. */
function richLiteral(value: string): string {
  return `<code>${escapeHtml(value)}</code>`
}

/** Use a delimiter longer than any backtick run in the literal value. */
function inlineCode(value: string): string {
  const delimiter = '`'.repeat(Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length)) + 1)
  return `${delimiter} ${value.replace(/[\r\n]+/g, ' ')} ${delimiter}`
}

/** Literal diagnostic/identifier blocks remain safe even with embedded markup. */
function richCodeBlock(value: string): string {
  return `<pre><code class="language-text">${escapeHtml(value)}</code></pre>`
}

/** Text-bearing Telegram messages use `text`; media messages use `caption`. */
function telegramText(message: TelegramMessage): string | undefined {
  return message.text ?? message.caption
}

/** Parse a leading Telegram slash command while preserving the unsplit argument text. */
function telegramCommand(text: string | undefined): { command: string; argsText: string } | undefined {
  if (text === undefined || !text.trimStart().startsWith('/')) return undefined
  const trimmed = text.trim()
  const separator = trimmed.search(/\s/)
  const raw = separator < 0 ? trimmed : trimmed.slice(0, separator)
  return {
    command: (raw.split('@')[0] ?? '').toLowerCase(),
    argsText: separator < 0 ? '' : trimmed.slice(separator).trim(),
  }
}

/** Verify the actual raster container instead of trusting Telegram MIME metadata. */
function detectImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  const ascii = (start: number, end: number): string => String.fromCharCode(...data.slice(start, end))
  if (data.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => data[index] === byte)) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (data.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif'
  return undefined
}

/** Pick Telegram's largest advertised photo rendition. */
function largestPhoto(photo: readonly TelegramPhotoSize[]): TelegramPhotoSize | undefined {
  return [...photo].sort((left, right) =>
    (right.file_size ?? 0) - (left.file_size ?? 0) || right.width * right.height - left.width * left.height)[0]
}

/** Keep a user-facing filename while removing paths, controls, and shell-hostile punctuation. */
function safeFileStem(name: string): string {
  const leaf = basename(name.replaceAll('\\', '/')).normalize('NFC')
  const safe = leaf.slice(0, Math.max(0, leaf.length - extname(leaf).length))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 96)
  return safe || 'image'
}

/** Stable Telegram identities contain punctuation unsuitable for a filename. */
function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'file'
}

/** Reject paths that escape the canonical root. */
function pathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path))
}

/**
 * Split `[[send: path]]` directive lines out of a reply.
 * The lines never reach Telegram; the remaining text keeps its own line breaks.
 * @param markdown - the complete reply the model produced.
 * @returns the reply without directives, plus the paths in the order they appeared.
 */
function extractFileDirectives(markdown: string): { text: string; paths: string[] } {
  const paths: string[] = []
  const kept: string[] = []
  for (const line of markdown.split('\n')) {
    const match = SEND_FILE_DIRECTIVE.exec(line.trim())
    if (match === null) {
      kept.push(line)
      continue
    }
    const target = match[1].trim()
    if (target !== '') paths.push(target)
  }
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, paths }
}

/** Clearly delimit repeated material as a quote, not a fresh instruction. */
function quotedTextBlock(message: TelegramMessage, hasImage: boolean): string {
  const author = message.from?.username !== undefined ? `@${message.from.username}` : message.from?.first_name
  const header = `[Telegram 引用消息 #${message.message_id}${author === undefined ? '' : `，来自 ${author}`}；以下仅为被引用内容]`
  const original = telegramText(message)?.trim()
  const body = original === undefined || original === ''
    ? hasImage ? '（引用了一张图片）' : '（引用消息没有可提取的文字）'
    : truncateText(original, MAX_QUOTED_TEXT_LENGTH).split('\n').map(line => `> ${line}`).join('\n')
  return `${header}\n${body}`
}

/** A 12-hex-digit token binding callback buttons to the message that showed them. */
function callbackToken(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12)
}

/** Normalize an optional projected title for display. */
function displayTitle(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.replace(/\s+/g, ' ').trim() : undefined
}

/**
 * Bridge between Telegram private chats and DSH sessions. One session per
 * chat; incoming content becomes a user message, and each turn is delivered
 * back as one native rich Telegram message. Agents belong to DSH, so
 * {@link TelegramBridge.stop} only releases Telegram state.
 */
export class TelegramBridge {
  private readonly ctx: Context
  private readonly client: TelegramClientLike
  private readonly allowedUserIds: ReadonlySet<number>
  private readonly allowAllUsers: boolean
  private readonly preset: string | undefined
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly resultCache: TelegramResultCache
  private readonly chats = new Map<number, ChatState>()
  private readonly chatsBySession = new Map<string, ActiveChatSession>()
  private readonly collections = new Map<number, TelegramCollection>()
  /** Human-input requests keyed by Telegram chat id; at most one per chat. */
  private readonly pendingQuestions = new Map<number, PendingTelegramQuestion>()
  private readonly menus = new Map<number, MenuState>()
  private readonly abortController = new AbortController()
  private readonly disposers: Array<() => unknown> = []
  private offset: number | undefined
  private started = false
  private stopped = false
  private pollTask: Promise<void> | undefined
  private commandTask: Promise<void> | undefined
  private stopTask: Promise<void> | undefined

  /**
   * @param ctx - Cordis context providing the services the plugin injects.
   * @param options - bridge options.
   */
  constructor(ctx: Context, options: TelegramBridgeOptions) {
    if (options.pollingTimeoutSec !== undefined
      && (!Number.isSafeInteger(options.pollingTimeoutSec) || options.pollingTimeoutSec < 1)) {
      throw new RangeError('telegram: pollingTimeoutSec must be a positive integer')
    }
    const allowedUserIds = options.allowedUserIds ?? []
    if (allowedUserIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new RangeError('telegram: allowedUserIds must contain only positive safe integers')
    }
    this.ctx = ctx
    this.client = options.client ?? new TelegramClient(options.token, {
      ...(options.pollingTimeoutSec === undefined ? {} : { pollingTimeoutSec: options.pollingTimeoutSec }),
      ...(options.apiBaseUrl === undefined ? {} : { baseUrl: options.apiBaseUrl }),
    })
    this.allowedUserIds = new Set(allowedUserIds)
    this.allowAllUsers = options.allowAllUsers ?? false
    this.preset = options.preset?.trim() || undefined
    this.resultCache = new TelegramResultCache(options.token, options.resultCacheDirectory)
    this.sleep = options.sleep ?? ((ms, signal) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    }))
  }

  /** Register DSH listeners, publish the command list, and start polling. */
  start(): void {
    if (this.started || this.stopped) return
    this.started = true
    const ctx = this.ctx
    this.disposers.push(
      ctx.on('session/event', (session, event) => this.handleSessionEvent(session, event)),
      ctx.on('agent/assistant-stream', ({ agent, frame }) => this.boundChat(agent)?.progress?.stream(frame)),
      ctx.on('user-questions/request', (request, next) => {
        const chat = request.agent === undefined ? undefined : this.boundChat(request.agent)
        return chat === undefined ? next() : this.askThroughTelegram(chat, request)
      }, { prepend: true }),
      ctx.on('approval/request', (request, next) => {
        const chat = this.boundChat(request.agent)
        return chat === undefined ? next() : this.approveThroughTelegram(chat, request)
      }, { prepend: true }),
      // Required: the channel's output rules still apply when a deployment turns off optional
      // runtime context. Literal: the format guide is not a `{{variable}}` template.
      ctx.systemPrompt.context({
        name: 'telegram:channel',
        order: 900,
        required: true,
        interpolate: false,
        text: ({ agent }) => agent !== undefined && this.boundChat(agent) !== undefined ? TELEGRAM_CHANNEL_PROMPT : '',
      }),
    )
    this.commandTask = this.registerCommands()
    this.pollTask = this.pollLoop()
  }

  /** Stop polling and release Telegram state; DSH sessions and Agents keep running. */
  stop(): Promise<void> {
    this.stopTask ??= this.stopImpl()
    return this.stopTask
  }

  private async stopImpl(): Promise<void> {
    this.stopped = true
    for (const pending of [...this.pendingQuestions.values()]) {
      this.rejectPendingQuestion(pending, userQuestionError(
        'ask_user_question was aborted because the Telegram bridge stopped', 'ASK_ABORTED'))
    }
    this.abortController.abort()
    for (const dispose of this.disposers.splice(0)) dispose()
    const entries = [...this.chatsBySession.values()]
    for (const entry of entries) {
      this.stopTyping(entry)
      entry.progress?.dispose()
    }
    await Promise.allSettled([this.pollTask, this.commandTask, ...entries.map(entry => entry.queue)])
    this.chats.clear()
    this.chatsBySession.clear()
    this.collections.clear()
    this.menus.clear()
  }

  /** Publish the slash-command list so Telegram's `/` menu matches the bot. */
  private async registerCommands(): Promise<void> {
    try {
      await this.client.setMyCommands(MY_COMMANDS, this.abortController.signal)
    } catch (error) {
      if (!this.stopped) this.ctx.logger.warn('[telegram] setMyCommands failed: %s', messageOf(error))
    }
  }

  private async pollLoop(): Promise<void> {
    let errorCount = 0
    while (!this.stopped) {
      let updates: TelegramUpdate[]
      try {
        updates = await this.client.getUpdates(this.offset, this.abortController.signal)
        errorCount = 0
      } catch (error) {
        if (this.stopped) return
        errorCount += 1
        this.ctx.logger.warn('[telegram] polling error (attempt %d): %s', errorCount, messageOf(error))
        await this.sleep(Math.min(1000 * errorCount, 10000), this.abortController.signal)
        continue
      }
      for (const update of updates) {
        if (this.stopped) return
        this.offset = update.update_id + 1
        try {
          await this.handleUpdate(update)
        } catch (error) {
          if (!this.stopped) this.ctx.logger.error('[telegram] update %d failed: %s', update.update_id, messageOf(error))
        }
      }
      if (updates.length === 0 && !this.stopped) await this.sleep(POLL_CADENCE_MS, this.abortController.signal)
    }
  }

  private authorizedUser(user: TelegramUser | undefined): boolean {
    return this.allowAllUsers || (user !== undefined && this.allowedUserIds.has(user.id))
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const stopped = update.stopped_message_generation
    if (stopped !== undefined) {
      // Native Stop is a chat-level request; the draft id does not gate cancellation.
      if (stopped.chat.type === 'private' && stopped.message_thread_id === undefined
        && (this.allowAllUsers || this.allowedUserIds.has(stopped.chat.id))) {
        await this.stopCurrentTask(stopped.chat.id)
      }
      return
    }
    if (update.callback_query !== undefined) {
      await this.handleCallbackQuery(update.callback_query)
      return
    }
    const message = update.message
    // Group semantics (mentions, topics, shared visibility) are out of scope;
    // ignoring groups keeps an allowed user from forwarding one to a private agent.
    if (message === undefined || message.chat.type !== 'private') return
    if (!this.authorizedUser(message.from)) {
      await this.safeSend(message.chat.id, '⛔ **访问被拒绝**')
      return
    }
    const chatId = message.chat.id
    const parsed = telegramCommand(telegramText(message))
    const pending = this.pendingQuestions.get(chatId)
    if (pending !== undefined && await this.handleQuestionInput(pending, message, parsed?.command)) return
    if (parsed !== undefined && parsed.command !== '/followup') {
      await this.handleCommand(chatId, parsed.command, parsed.argsText)
      return
    }
    const active = this.chats.get(chatId)?.active
    if (active === undefined) {
      await this.safeSend(chatId, '⚠️ **尚未选择会话**\n\n发送 /menu，选择工作区和会话，或点击“新建会话”。')
      return
    }
    if (parsed?.command === '/followup') {
      await this.handleFollowupMessage(active, message, parsed.argsText)
      return
    }
    const collection = this.collectionFor(active)
    if (collection !== undefined) {
      await this.addToCollection(active, collection, message)
      return
    }
    if (message.text === undefined && message.document === undefined && message.photo === undefined
      && message.reply_to_message === undefined) return
    await this.submitTelegramMessage(active, message, 'default')
  }

  /** Route chat input to a waiting question; returns false when the message is an ordinary command. */
  private async handleQuestionInput(
    pending: PendingTelegramQuestion,
    message: TelegramMessage,
    command: string | undefined,
  ): Promise<boolean> {
    const chatId = message.chat.id
    if (command === '/skip') {
      this.trackQuestionMessage(pending, message.message_id)
      await this.submitQuestionAnswer(pending, { id: this.currentQuestion(pending).id, selected: [] })
      return true
    }
    if (command === '/cancel') {
      this.trackQuestionMessage(pending, message.message_id)
      const noticeId = await this.safeSend(chatId, pending.approval ? '🚫 **已取消权限申请**' : '🚫 **已取消提问**')
      if (noticeId !== undefined) this.trackQuestionMessage(pending, noticeId)
      this.rejectPendingQuestion(pending, userQuestionError('ask_user_question was cancelled by the Telegram user', 'ASK_CANCELLED'))
      return true
    }
    if (command !== undefined) return false
    if (pending.approval) {
      await this.safeSend(chatId, `🔐 **正在等待权限审批**\n\n请点击“${APPROVE_ONCE}”或“${REJECT}”；发送 /cancel 可取消申请。`)
      return true
    }
    if (message.text === undefined) {
      await this.safeSend(chatId, '❓ **正在等待回答**\n\n请使用按钮或发送文字；图片和文件不能作为本次回答。')
      return true
    }
    this.trackQuestionMessage(pending, message.message_id)
    await this.submitQuestionAnswer(pending, {
      id: this.currentQuestion(pending).id,
      selected: this.selectedLabels(pending),
      custom: message.text,
    })
    return true
  }

  private async handleCommand(chatId: number, command: string, argsText: string): Promise<void> {
    switch (command) {
      case '/start':
        await this.safeSend(chatId, `☕ **在线 · 摸鱼暂停**\n\n${START_MESSAGES[Math.floor(Math.random() * START_MESSAGES.length)]!}\n\n---\n\n/menu 打开控制面板 · /help 查看帮助`)
        return
      case '/help':
        await this.safeSend(chatId, HELP_TEXT)
        return
      case '/menu':
        await this.showMenu(chatId)
        return
      case '/resend':
        try {
          const sent = await this.resultCache.resend(chatId, text =>
            this.client.sendRichMessage(chatId, text, this.abortController.signal))
          if (!sent) await this.safeSend(chatId, 'ℹ️ **没有可重发的结果**\n\n当前还没有缓存的完整结果。')
        } catch (error) {
          this.ctx.logger.error('[telegram] cached result delivery failed: %s', messageOf(error))
          await this.safeSend(chatId, '⚠️ **缓存结果补发失败**\n\n缓存仍保留，请稍后使用 /resend 重试。')
        }
        return
      case '/new': {
        const workspace = this.chats.get(chatId)?.workspace
        if (workspace === undefined) {
          await this.safeSend(chatId, '⚠️ **尚未选择工作区**\n\n请先打开 /menu 选择工作区和会话。')
          return
        }
        try {
          const active = await this.createSession(chatId, workspace)
          await this.safeSend(chatId, `✅ **已创建新会话**\n\n**工作区**：${richLiteral(workspace.title)}\n\n**会话编号**\n\n${richCodeBlock(active.sessionId)}`)
        } catch (error) {
          await this.safeSend(chatId, `⚠️ **创建会话失败**\n\n${richCodeBlock(messageOf(error))}`)
        }
        return
      }
      case '/archive':
        try {
          const archived = await this.archiveCurrent(chatId)
          await this.safeSend(chatId, archived === undefined
            ? 'ℹ️ **没有可归档的会话**'
            : `📦 **已归档会话**\n\n${richCodeBlock(archived)}\n\n---\n\n聊天记录已保留，工作区仍保持选中；可使用 /new 创建新会话，或在 /menu 会话列表中重新打开已归档会话。`)
        } catch (error) {
          await this.safeSend(chatId, `⚠️ **归档会话失败**\n\n${richCodeBlock(messageOf(error))}`)
        }
        return
      case '/collect': {
        const active = this.chats.get(chatId)?.active
        if (active === undefined) {
          await this.safeSend(chatId, '⚠️ **尚未选择会话**\n\n请先打开 /menu 选择或新建会话。')
          return
        }
        const existing = this.collectionFor(active)
        if (existing !== undefined) {
          await this.sendCollectionStatus(existing, this.collectionStatus(existing, '已经处于收集模式'))
          return
        }
        const collection: TelegramCollection = { chatId, sessionId: active.sessionId, parts: [] }
        this.collections.set(chatId, collection)
        await this.sendCollectionStatus(collection,
          `📥 **已进入收集模式**\n\n现在可以按任意顺序发送文字、图片和文件。\n\n---\n\n${COLLECTION_ACTIONS}`)
        return
      }
      case '/send': {
        const active = this.chats.get(chatId)?.active
        const collection = active === undefined ? undefined : this.collectionFor(active)
        if (active === undefined || collection === undefined) {
          await this.safeSend(chatId, 'ℹ️ **当前没有收集内容**\n\n先使用 `/collect` 开始收集。')
          return
        }
        if (argsText !== '') collection.parts.push({ type: 'text', text: argsText })
        await this.submitCollection(active, collection, 'default')
        return
      }
      case '/discard': {
        const collection = this.collections.get(chatId)
        if (collection === undefined) {
          await this.safeSend(chatId, 'ℹ️ **当前没有收集内容**')
          return
        }
        this.collections.delete(chatId)
        await this.sendCollectionStatus(collection,
          `🗑 **已放弃本次收集**\n\n已经下载的图片仍保留在当前工作区的 \`${DOWNLOAD_DIRECTORY}\` 文件夹中。`)
        return
      }
      case '/followup':
        await this.safeSend(chatId, FOLLOWUP_HELP)
        return
      default:
        await this.safeSend(chatId, `❔ **未知命令**\n\n${richLiteral(command)}\n\n发送 \`/help\` 查看可用命令。`)
    }
  }

  /** Native Stop: cancel the running turn and any question it is waiting on. */
  private async stopCurrentTask(chatId: number): Promise<void> {
    const active = this.chats.get(chatId)?.active
    const pending = this.pendingQuestions.get(chatId)
    const agent = active === undefined ? undefined : this.ctx.agents.get(active.sessionId)
    const running = agent?.status === 'running'
    if (active === undefined || (!running && pending === undefined)) {
      await this.safeSend(chatId, 'ℹ️ **当前没有正在执行的任务**')
      return
    }
    // Kill the typing heartbeat first so Telegram's indicator expires instead of renewing.
    this.stopTyping(active)
    active.progress?.stopByUser()
    if (pending !== undefined) {
      this.rejectPendingQuestion(pending, userQuestionError('ask_user_question was aborted by the Telegram user', 'ASK_ABORTED'))
    }
    // Queued follow-ups are discarded too; the aborted turn never delivers its partial answer.
    if (running) agent.cancel({ kind: 'user' })
    await this.enqueue(active, async () => { await this.safeSend(chatId, '⏹ **已中断当前任务**') })
  }

  // --- Menu ------------------------------------------------------------------

  /** Bind callbacks to the state shown, so an old button cannot act on a newer selection. */
  private menuFingerprint(chatId: number): string {
    const state = this.chats.get(chatId)
    return JSON.stringify([state?.workspace?.id, state?.active?.sessionId])
  }

  private async handleMenuCallback(callback: TelegramCallbackQuery, chatId: number, messageId: number): Promise<void> {
    const match = /^menu:([a-f0-9]{12}):(\d+)$/.exec(callback.data!)
    const menu = this.menus.get(chatId)
    const action = match !== null && menu?.token === match[1] && menu.messageId === messageId
      ? menu.actions[Number(match[2])] : undefined
    if (menu === undefined || action === undefined) {
      await this.safeAnswerCallback(callback.id, '菜单已失效，请重新发送 /menu。')
      return
    }
    // Consume before awaiting anything: repeated taps cannot repeat a mutation.
    this.menus.delete(chatId)
    await this.safeAnswerCallback(callback.id)
    try {
      if (menu.fingerprint !== this.menuFingerprint(chatId)) {
        await this.showMenu(chatId, 'home', 0, undefined, '选择已变化，已刷新面板，请重新操作。', menu.messageId)
        return
      }
      await action()
    } catch (error) {
      await this.showMenu(chatId, 'home', 0, undefined, `操作失败：${messageOf(error)}`, menu.messageId)
    }
  }

  /** Render one menu page; callbacks capture stable ids, never live catalog positions. */
  private async showMenu(
    chatId: number,
    view: MenuView = 'home',
    page = 0,
    workspaceId?: string,
    notice?: string,
    messageId?: number,
  ): Promise<void> {
    try {
      const state = this.stateFor(chatId)
      const active = state.active
      const [catalog, models, status] = await Promise.all([
        this.loadCatalog(),
        this.ctx.sessionController.modelCatalog(),
        active === undefined ? undefined : this.sessionStatus(active.sessionId),
      ])
      const selection = status?.selection ?? models.default
      const token = callbackToken()
      const actions: Array<() => Promise<void>> = []
      const rows: TelegramInlineKeyboardButton[][] = []
      const button = (text: string, action: () => Promise<void>): TelegramInlineKeyboardButton => {
        const index = actions.push(action) - 1
        return { text: buttonLabel(text), callback_data: `menu:${token}:${index}` }
      }
      const navigate = (next: MenuView, nextPage = 0, id?: string, message?: string): Promise<void> =>
        this.showMenu(chatId, next, nextPage, id, message, messageId)
      const running = active !== undefined && this.ctx.agents.get(active.sessionId)?.status === 'running'
      const idle = (): void => {
        if (active !== undefined && this.ctx.agents.get(active.sessionId)?.status === 'running') {
          throw new Error('任务仍在运行，请等待完成或点击 Telegram 原生停止按钮后再操作。')
        }
      }
      const model = this.findModel(models, selection)
      const effort = selection.reasoningEffort ?? model?.reasoning?.defaultEffort
      const effortName = model?.reasoning?.efforts.find(candidate => candidate.id === effort)?.name ?? effort
        ?? (model?.reasoning === undefined ? '不支持' : '默认')
      const sessionLabel = active === undefined ? '未选择'
        : status?.title === undefined ? inlineCode(active.sessionId)
          : `${richLiteral(status.title)}（${inlineCode(active.sessionId)}）`
      const lines = [
        '# 🎛 控制面板',
        [
          '## 🎯 当前选择',
          '',
          `- **工作区**：${state.workspace === undefined ? '未选择' : richLiteral(state.workspace.title)}`,
          ...(state.workspace === undefined ? [] : [`  ${inlineCode(state.workspace.path)}`]),
          `- **会话**：${sessionLabel}`,
          `- **模型**：${richLiteral(model?.name ?? `${selection.provider}/${selection.model}`)}`,
          `- **推理强度**：${richLiteral(effortName)}`,
        ].join('\n'),
        '---',
        '## 📊 运行状态',
        [
          '| 项目 | 状态 |',
          '| --- | --- |',
          `| 任务 | ${running ? '运行中' : active ? '空闲' : '未连接会话'} |`,
          `| 等待回答 | ${this.pendingQuestions.has(chatId) ? '是' : '否'} |`,
          `| 收集模式 | ${this.collections.has(chatId) ? `已收集 ${this.collections.get(chatId)!.parts.length} 项` : '关闭'} |`,
          `| 现有工作区 / 会话 | ${catalog.length} / ${catalog.reduce((sum, entry) => sum + entry.sessions.length, 0)} |`,
        ].join('\n'),
        '---',
      ]
      if (notice) lines.push(`**提示**　${richLiteral(notice)}`)
      const paginate = <T>(items: readonly T[], render: (item: T) => void): void => {
        const pages = Math.max(1, Math.ceil(items.length / MENU_PAGE_SIZE))
        page = Math.max(0, Math.min(page, pages - 1))
        lines.push(`第 ${page + 1} / ${pages} 页`)
        const start = lines.length
        items.slice(page * MENU_PAGE_SIZE, (page + 1) * MENU_PAGE_SIZE).forEach(render)
        const entries = lines.splice(start)
        if (entries.length) lines.push(entries.join('\n'))
        if (pages > 1) {
          const navigation: TelegramInlineKeyboardButton[] = []
          if (page > 0) navigation.push(button('⬅️ 上一页', () => navigate(view, page - 1, workspaceId)))
          if (page + 1 < pages) navigation.push(button('下一页 ➡️', () => navigate(view, page + 1, workspaceId)))
          rows.push(navigation)
        }
      }
      const changeModel = async (next: ModelSelection): Promise<void> => {
        if (active === undefined) throw new Error('请先选择或新建会话。')
        idle()
        await this.ctx.sessionController.selectModel({ sessionId: active.sessionId, ...next })
        await navigate('home')
      }
      if (view === 'home') {
        lines.push('使用下方按钮管理会话与模型，面板会在原消息中更新。')
        rows.push([button('🗂 工作区与会话', () => navigate('workspaces')), button('🤖 切换模型', () => navigate('models'))])
        rows.push([button('🧠 推理强度', () => navigate('reasoning'))])
        rows.push([
          button('➕ 新建会话', async () => {
            idle()
            if (state.workspace === undefined) return navigate('workspaces')
            await this.createSession(chatId, state.workspace)
            await navigate('home')
          }),
          button('📦 归档会话', async () => {
            const archived = await this.archiveCurrent(chatId)
            await navigate('home', 0, undefined,
              archived === undefined ? '没有可归档的会话。' : '已归档会话，聊天记录已保留；可新建会话或在会话列表中重新打开。')
          }),
        ])
      } else if (view === 'workspaces') {
        lines.push('## 🗂 现有工作区')
        if (!catalog.length) lines.push('暂无已登记工作区，请先在 Web UI 中添加。')
        paginate(catalog, (entry) => {
          lines.push(`- **${richLiteral(entry.workspace.title)}** · ${entry.sessions.length} 个会话\n  ${inlineCode(entry.workspace.path)}`)
          rows.push([button(`${state.workspace?.id === entry.workspace.id ? '✓ ' : ''}${entry.workspace.title}`,
            () => navigate('sessions', 0, entry.workspace.id))])
        })
      } else if (view === 'sessions') {
        const entry = catalog.find(item => item.workspace.id === workspaceId)
        if (entry === undefined) throw new Error('工作区已移除，请刷新菜单。')
        lines.push(`## 💬 ${richLiteral(entry.workspace.title)} 的会话`)
        if (!entry.sessions.length) lines.push('暂无会话，可点击下方按钮新建。')
        paginate(entry.sessions, (session) => {
          const label = session.title ?? session.id
          const badges = `${session.running ? ' · 运行中' : ''}${session.archived ? ' · 已归档' : ''}${active?.sessionId === session.id ? ' · 当前' : ''}`
          lines.push(`- ${richLiteral(label)}${badges}\n  ${inlineCode(session.id)}`)
          rows.push([button(`${label}${badges}`, async () => {
            idle()
            const result = await this.openSession(chatId, entry.workspace, session.id)
            await navigate('home', 0, undefined, result)
          })])
        })
        rows.push([
          button('➕ 在此工作区新建会话', async () => {
            idle()
            await this.createSession(chatId, entry.workspace)
            await navigate('home')
          }),
          button('⬅️ 工作区', () => navigate('workspaces')),
        ])
      } else if (view === 'models') {
        const choices = models.groups.flatMap(group => group.models.map(item => ({ ...item, provider: group.id })))
        lines.push('## 🤖 可用模型', '切换模型后，推理强度恢复为该模型默认值，新会话也会默认使用该模型。')
        if (active === undefined) lines.push('请先选择或新建会话。')
        for (const failure of models.failures) lines.push(`⚠️ ${richLiteral(failure.name)} 模型列表读取失败：${richLiteral(failure.message)}`)
        paginate(choices, (choice) => {
          const selected = choice.provider === selection.provider && choice.id === selection.model
          lines.push(`- ${richLiteral(choice.name)}${selected ? ' · **当前**' : ''}`)
          rows.push([button(`${selected ? '✓ ' : ''}${choice.name}`,
            () => changeModel({ provider: choice.provider, model: choice.id }))])
        })
      } else {
        const efforts = model?.reasoning?.efforts ?? []
        lines.push('## 🧠 可用推理强度')
        if (active === undefined) lines.push('请先选择或新建会话。')
        if (!efforts.length) lines.push('当前模型不支持切换推理强度。')
        paginate(efforts, (choice) => {
          lines.push(`- ${richLiteral(choice.name)}${choice.description ? ` — ${richLiteral(choice.description)}` : ''}`)
          rows.push([button(`${effort === choice.id ? '✓ ' : ''}${choice.name}`,
            () => changeModel({ provider: selection.provider, model: selection.model, reasoningEffort: choice.id }))])
        })
      }
      rows.push([button(view === 'home' ? '🔄 刷新状态' : '🏠 返回总览', () => navigate('home'))])
      const markdown = lines.filter(Boolean).join('\n\n')
      const old = this.menus.get(chatId)
      const sent = messageId === undefined
        ? await this.client.sendRichMessage(chatId, markdown, this.abortController.signal, { inline_keyboard: rows })
        : await this.client.editRichMessage(chatId, messageId, markdown, this.abortController.signal, { inline_keyboard: rows })
      // Button actions read this binding, so later pages edit the panel in place.
      messageId = sent.message_id
      this.menus.set(chatId, { token, messageId: sent.message_id, fingerprint: this.menuFingerprint(chatId), actions })
      if (old !== undefined && old.messageId !== sent.message_id) {
        try { await this.client.editMessageReplyMarkup(chatId, old.messageId, { inline_keyboard: [] }, this.abortController.signal) }
        catch (error) { this.ctx.logger.warn('[telegram] old menu cleanup failed: %s', messageOf(error)) }
      }
    } catch (error) {
      await this.safeSend(chatId, `⚠️ **菜单暂时不可用**\n\n${richLiteral(messageOf(error))}\n\n请重新发送 /menu。`)
    }
  }

  private findModel(catalog: ModelCatalog, selection: ModelSelection): ModelCatalogModel | undefined {
    return catalog.groups.find(group => group.id === selection.provider)?.models
      .find(model => model.id === selection.model)
  }

  /** Workspaces in registry order with their sessions' list metadata. */
  private async loadCatalog(): Promise<CatalogWorkspace[]> {
    const { items } = await this.ctx.sessionController.list({}, this.abortController.signal)
    const summaries = new Map(items.map(item => [item.sessionId, item]))
    const archived = new Set(this.ctx.workspaceRegistry.archivedSessionIds)
    return this.ctx.workspaceRegistry.list().map(workspace => ({
      workspace,
      sessions: workspace.sessionIds.map((id) => {
        const summary = summaries.get(id)
        return {
          id,
          title: displayTitle(summary?.projections?.values.title),
          archived: archived.has(id),
          running: summary?.running === true,
        }
      }),
    }))
  }

  /** Read one session's model route (falling back to the DSH default) and title. */
  private async sessionStatus(sessionId: SessionId): Promise<SessionStatus> {
    const baseline = await this.ctx.sessionController.projections({ sessionId }, this.abortController.signal)
    const selection = baseline?.values.modelSelection?.next
      ?? (await this.ctx.sessionController.modelCatalog()).default
    return { selection, title: displayTitle(baseline?.values.title) }
  }

  // --- Session binding -------------------------------------------------------

  private stateFor(chatId: number): ChatState {
    let state = this.chats.get(chatId)
    if (state === undefined) {
      state = { chatId, workspace: undefined, active: undefined }
      this.chats.set(chatId, state)
    }
    return state
  }

  /** The chat bound to an Agent's session, if any. */
  private boundChat(agent: Agent): ActiveChatSession | undefined {
    return this.chatsBySession.get(agent.session.id)
  }

  /** Resolve the live Agent through the Session Controller, resuming a cold session. */
  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const found = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  /** Create a session in `workspace` exactly as Web does and bind this chat to it. */
  private async createSession(chatId: number, workspace: Workspace): Promise<ActiveChatSession> {
    if (await workspace.status() !== 'ok') throw new Error(`工作区目录不存在：${workspace.path}`)
    const { sessionId } = await this.ctx.sessionController.create({
      workspaceId: workspace.id,
      ...(this.preset === undefined ? {} : { agentPreset: this.preset }),
    })
    return this.bind(chatId, workspace, sessionId)
  }

  /** Bind this chat to an existing session, unarchiving it first when needed. */
  private async openSession(chatId: number, workspace: Workspace, sessionId: SessionId): Promise<string> {
    const state = this.stateFor(chatId)
    if (state.active?.sessionId === sessionId) {
      state.workspace = workspace
      return '当前已在该会话中。'
    }
    const owner = this.chatsBySession.get(sessionId)
    if (owner !== undefined && owner.chatId !== chatId) throw new Error('该会话正在被另一个 Telegram 私聊使用')
    const archived = this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)
    if (archived) await this.ctx.workspaceRegistry.unarchiveSession(sessionId)
    await this.resolveAgent(sessionId)
    await this.bind(chatId, workspace, sessionId)
    return archived ? '已取消归档并切换到该会话。' : '已切换会话。'
  }

  private async bind(chatId: number, workspace: Workspace, sessionId: SessionId): Promise<ActiveChatSession> {
    if (this.stopped) throw new Error('telegram bridge stopped during session binding')
    const state = this.stateFor(chatId)
    await this.releaseActive(state)
    const active: ActiveChatSession = {
      chatId,
      workspace,
      sessionId,
      transientMessageIds: new Set(),
      queue: Promise.resolve(),
      typingTimer: undefined,
      progress: undefined,
    }
    state.workspace = workspace
    state.active = active
    this.chatsBySession.set(sessionId, active)
    return active
  }

  /** Forget the Telegram binding; the DSH session and its Agent are unaffected. */
  private async releaseActive(state: ChatState): Promise<void> {
    const active = state.active
    if (active === undefined) return
    this.collections.delete(state.chatId)
    const pending = this.pendingQuestions.get(state.chatId)
    if (pending?.sessionId === active.sessionId) {
      this.rejectPendingQuestion(pending, userQuestionError(
        'ask_user_question was aborted because the Telegram session changed', 'ASK_ABORTED'))
    }
    state.active = undefined
    this.chatsBySession.delete(active.sessionId)
    this.stopTyping(active)
    active.progress?.dispose()
    await active.queue
    await this.deleteMessageIds(active.chatId, [...active.transientMessageIds])
  }

  /** Archive through the Workspace registry, then release the Telegram selection. */
  private async archiveCurrent(chatId: number): Promise<SessionId | undefined> {
    const state = this.chats.get(chatId)
    const active = state?.active
    if (state === undefined || active === undefined) return undefined
    if (this.ctx.agents.get(active.sessionId)?.status === 'running') {
      throw new Error('任务仍在运行，请等待完成或点击 Telegram 原生停止按钮后再归档。')
    }
    await this.ctx.workspaceRegistry.archiveSession(active.sessionId)
    await this.releaseActive(state)
    return active.sessionId
  }

  // --- Input collection and submission ---------------------------------------

  /** Return only a collection that still belongs to the active session. */
  private collectionFor(active: ActiveChatSession): TelegramCollection | undefined {
    const collection = this.collections.get(active.chatId)
    if (collection === undefined || collection.sessionId === active.sessionId) return collection
    this.collections.delete(active.chatId)
    return undefined
  }

  /** Replace the previous collection notice only after its successor was sent. */
  private async sendCollectionStatus(collection: TelegramCollection, text: string): Promise<void> {
    const messageId = await this.safeSend(collection.chatId, text)
    if (messageId === undefined) return
    const previousId = collection.statusMessageId
    collection.statusMessageId = messageId
    if (previousId !== undefined && previousId !== messageId) await this.deleteMessageIds(collection.chatId, [previousId])
  }

  private collectionStatus(collection: TelegramCollection, prefix = '已加入收集'): string {
    const count = (type: CollectedPart['type']): number => collection.parts.filter(part => part.type === type).length
    return `📥 **${prefix}**\n\n| 内容 | 数量 |\n| :--- | ---: |\n| 文字 | ${count('text')} 段 |\n| 图片 | ${count('image')} 张 |\n| 文件 | ${count('file')} 个 |\n\n---\n\n${COLLECTION_ACTIONS}`
  }

  /** Explicit `/followup`: queue one message, or submit the active collection as a later turn. */
  private async handleFollowupMessage(active: ActiveChatSession, message: TelegramMessage, argsText: string): Promise<void> {
    const hasContent = argsText !== '' || message.document !== undefined || message.photo !== undefined
      || message.reply_to_message !== undefined
    const collection = this.collectionFor(active)
    if (collection !== undefined) {
      if (hasContent && !await this.addToCollection(active, collection, message, argsText, false)) return
      await this.submitCollection(active, collection, 'followup')
    } else if (hasContent) {
      await this.submitTelegramMessage(active, message, 'followup', argsText)
    } else {
      await this.safeSend(message.chat.id, FOLLOWUP_HELP)
    }
  }

  /** Add one Telegram message and its reply context to an explicit collection. */
  private async addToCollection(
    active: ActiveChatSession,
    collection: TelegramCollection,
    message: TelegramMessage,
    overrideText?: string,
    announce = true,
  ): Promise<boolean> {
    try {
      const parts = await this.telegramMessageParts(active, message, overrideText)
      if (parts.length === 0) {
        await this.safeSend(message.chat.id, 'ℹ️ **没有可收集的内容**\n\n这条消息没有文字、图片或文件。')
        return false
      }
      const images = [...collection.parts, ...parts].flatMap(part => part.type === 'image' ? [part.image] : [])
      const limits = this.ctx.attachments.imageLimits
      if (images.length > limits.maxImagesPerMessage) {
        await this.safeSend(message.chat.id, `⚠️ **图片数量超过限制**\n\n当前最多 ${limits.maxImagesPerMessage} 张。`)
        return false
      }
      if (images.reduce((sum, image) => sum + image.data.byteLength, 0) > limits.maxMessageImageBytes) {
        await this.safeSend(message.chat.id, '⚠️ **图片总大小超过当前 DSH 限制**')
        return false
      }
      collection.parts.push(...parts)
      if (announce) await this.sendCollectionStatus(collection, this.collectionStatus(collection))
      return true
    } catch (error) {
      await this.safeSend(message.chat.id, `⚠️ **收集失败**\n\n${richCodeBlock(messageOf(error))}`)
      return false
    }
  }

  /** Submit and clear one collection only after DSH has accepted it. */
  private async submitCollection(active: ActiveChatSession, collection: TelegramCollection, mode: DeliveryMode): Promise<void> {
    if (collection.parts.length === 0) {
      await this.safeSend(active.chatId, 'ℹ️ **收集内容为空**\n\n请先发送文字、图片或文件。')
      return
    }
    try {
      await this.submitParts(active, collection.parts, mode)
      this.collections.delete(active.chatId)
      await this.sendCollectionStatus(collection, mode === 'followup' ? '🕒 **已加入后续任务队列**' : '✅ **已提交收集内容**')
    } catch (error) {
      await this.safeSend(active.chatId, `⚠️ **提交收集内容失败**\n\n${richCodeBlock(messageOf(error))}\n\n内容仍保留在收集模式中。`)
    }
  }

  /** Build and submit one ordinary Telegram message. */
  private async submitTelegramMessage(
    active: ActiveChatSession,
    message: TelegramMessage,
    mode: DeliveryMode,
    overrideText?: string,
  ): Promise<void> {
    try {
      const parts = await this.telegramMessageParts(active, message, overrideText)
      if (parts.length > 0) await this.submitParts(active, parts, mode)
    } catch (error) {
      await this.safeSend(message.chat.id, `⚠️ **消息处理失败**\n\n${richCodeBlock(messageOf(error))}`)
    }
  }

  /**
   * Preserve Telegram reply semantics inside the same user message: quoted
   * text is explicitly delimited and quoted media stays adjacent to it.
   */
  private async telegramMessageParts(
    active: ActiveChatSession,
    message: TelegramMessage,
    overrideText?: string,
  ): Promise<CollectedPart[]> {
    const parts: CollectedPart[] = []
    const reply = message.reply_to_message
    if (reply !== undefined) {
      parts.push({ type: 'text', text: quotedTextBlock(reply, this.imageCandidate(reply) !== undefined) })
      parts.push(...await this.mediaParts(active, reply, '[Telegram 引用图片已保存到工作区：'))
    }
    parts.push(...await this.mediaParts(active, message, '[Telegram 图片已保存到工作区：'))
    const text = (overrideText ?? telegramText(message) ?? '').trim()
    if (text !== '') parts.push({ type: 'text', text })
    else if (reply !== undefined && this.imageCandidate(message) === undefined) {
      parts.push({ type: 'text', text: '请继续处理我在 Telegram 中引用的内容。' })
    }
    return parts
  }

  /** Download the message's image into the workspace or its document into DSH attachments. */
  private async mediaParts(active: ActiveChatSession, message: TelegramMessage, imageLabel: string): Promise<CollectedPart[]> {
    const candidate = this.imageCandidate(message)
    if (candidate !== undefined) {
      const image = await this.downloadWorkspaceImage(active, candidate)
      return [{ type: 'text', text: `${imageLabel}${image.path}]` }, { type: 'image', image }]
    }
    const document = message.document
    if (document === undefined) return []
    const downloaded = await this.client.downloadFile(document.file_id, MAX_FILE_BYTES, this.abortController.signal)
    const attachment = await this.ctx.attachments.saveFile({
      data: downloaded.data,
      name: document.file_name ?? `telegram-file-${message.message_id}`,
    })
    return [{ type: 'file', attachment }]
  }

  /** Photos and declared raster documents go through the image pipeline. */
  private imageCandidate(message: TelegramMessage): TelegramImageCandidate | undefined {
    const photo = message.photo === undefined ? undefined : largestPhoto(message.photo)
    if (photo !== undefined) {
      return {
        fileId: photo.file_id,
        fileUniqueId: photo.file_unique_id,
        fileSize: photo.file_size,
        suggestedName: `telegram-photo-${message.message_id}.jpg`,
        telegramMessageId: message.message_id,
      }
    }
    const document = message.document
    if (document === undefined) return undefined
    const mime = document.mime_type?.toLowerCase() ?? ''
    const extension = extname(document.file_name ?? '').toLowerCase()
    if (!(mime in IMAGE_EXTENSIONS) && !['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return undefined
    return {
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
      fileSize: document.file_size,
      suggestedName: document.file_name ?? `telegram-image-${message.message_id}`,
      telegramMessageId: message.message_id,
    }
  }

  /** Download, verify, and save one image beneath the selected workspace. */
  private async downloadWorkspaceImage(
    active: ActiveChatSession,
    candidate: TelegramImageCandidate,
  ): Promise<DownloadedWorkspaceImage> {
    const limits = this.ctx.attachments.imageLimits
    if (candidate.fileSize !== undefined && candidate.fileSize > limits.maxImageBytes) {
      throw new Error(`图片超过当前单张大小限制（${limits.maxImageBytes} 字节）`)
    }
    const { data } = await this.client.downloadFile(candidate.fileId, limits.maxImageBytes, this.abortController.signal)
    const mediaType = detectImageMediaType(data)
    if (mediaType === undefined || !limits.mediaTypes.includes(mediaType)) {
      throw new Error('文件内容不是 DSH 支持的 PNG、JPEG、WebP 或 GIF 图片')
    }
    const name = `${safeFileStem(candidate.suggestedName)}${IMAGE_EXTENSIONS[mediaType]}`
    await this.ctx.attachments.validateImage({ data, mediaType, name })
    const path = await this.saveWorkspaceFile(active.workspace, candidate, name, data)
    return { data, mediaType, name, path }
  }

  /** Create an exclusive file under `<workspace>/telegram-downloads` without following an escaping directory link. */
  private async saveWorkspaceFile(
    workspace: Workspace,
    candidate: TelegramImageCandidate,
    name: string,
    data: Uint8Array,
  ): Promise<string> {
    const workspaceRoot = await realpath(workspace.path)
    const requestedRoot = join(workspaceRoot, DOWNLOAD_DIRECTORY)
    await mkdir(requestedRoot, { recursive: true })
    const root = await realpath(requestedRoot)
    if (!pathInside(workspaceRoot, root)) throw new Error(`下载目录逃离了当前工作区：${requestedRoot}`)
    const stem = safeFileStem(name)
    const identity = `${safeId(candidate.fileUniqueId)}-${candidate.telegramMessageId}`
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const absolutePath = join(root, `${identity}-${stem}${attempt === 0 ? '' : `-${attempt + 1}`}${extname(name)}`)
      let file: Awaited<ReturnType<typeof open>>
      try {
        file = await open(absolutePath, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      try { await file.writeFile(data) }
      finally { await file.close() }
      return absolutePath
    }
    throw new Error('无法为 Telegram 下载生成不冲突的文件名')
  }

  /** Admit collected images, preserve part order, then steer a running turn or queue a follow-up. */
  private async submitParts(active: ActiveChatSession, parts: readonly CollectedPart[], mode: DeliveryMode): Promise<void> {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(active.sessionId)) {
      throw new Error('当前会话已归档，请在 /menu 会话列表中重新打开它，或使用 /new 新建会话')
    }
    const agent = await this.resolveAgent(active.sessionId)
    const images = parts.flatMap(part => part.type === 'image' ? [part.image] : [])
    if (images.length > 0) {
      const { selection } = await this.sessionStatus(active.sessionId)
      const info = await this.ctx.llm.resolveModelInfo(selection.provider, selection.model, this.abortController.signal)
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        throw new Error(`当前模型 ${info.name} 不支持图片输入；请先打开 /menu 切换到支持图片的模型`)
      }
    }
    const refs = images.length === 0 ? [] : await this.ctx.attachments.saveImages(images.map(image => ({
      data: image.data,
      mediaType: image.mediaType,
      name: image.name,
    })))
    let imageIndex = 0
    const content = parts.flatMap((part): ContentBlock[] => {
      if (part.type === 'text') return part.text.trim() === '' ? [] : [{ type: 'text', text: part.text }]
      if (part.type === 'file') return [{ type: 'file', attachment: part.attachment }]
      const attachment = refs[imageIndex++]
      return attachment === undefined ? [] : [{ type: 'image', attachment }]
    })
    if (content.length === 0) throw new Error('消息没有可提交的内容')
    const input = createUserMessage({ content, source: { kind: 'user' } })
    if (mode === 'followup' || agent.status !== 'running') agent.followup(input)
    else agent.steer(input)
  }

  // --- Questions and approvals -----------------------------------------------

  /** Reuse question delivery and lifecycle, but grant only an explicit approval button. */
  private async approveThroughTelegram(chat: ActiveChatSession, request: ApprovalRequest): Promise<ApprovalOutcome> {
    const reason = request.displayReason?.zh ?? request.displayReason?.en ?? request.reason ?? '未提供'
    try {
      const answer = await this.askThroughTelegram(chat, {
        questions: [{
          id: 'approval',
          header: '权限审批',
          question: `工具：${richLiteral(request.toolName)}`,
          detail: [
            ...(request.callId === undefined ? [] : [`调用：${richLiteral(request.callId)}`]),
            `**申请原因**\n\n${richCodeBlock(reason)}`,
            '授权仅适用于本次操作，不会修改工作区的默认权限。',
          ].join('\n\n'),
          options: [{ label: APPROVE_ONCE }, { label: REJECT }],
        }],
        agent: request.agent,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }, true)
      const selected = answer.answers[0]?.selected[0]
      return selected === APPROVE_ONCE ? 'allowed-once' : selected === REJECT ? 'rejected' : 'cancelled'
    } catch (error) {
      const code = errorCode(error)
      return code === 'ASK_ABORTED' || code === 'ASK_CANCELLED' ? 'cancelled' : 'unavailable'
    }
  }

  /** Claim one DSH user-question request for the chat bound to its session. */
  private askThroughTelegram(
    chat: ActiveChatSession,
    request: AskUserQuestionRequest,
    approval = false,
  ): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted === true || this.stopped) {
      return Promise.reject(userQuestionError('ask_user_question was aborted before the Telegram user answered', 'ASK_ABORTED'))
    }
    if (this.pendingQuestions.has(chat.chatId)) {
      return Promise.reject(userQuestionError(
        'another ask_user_question request is already waiting in this Telegram chat', 'ASK_BUSY'))
    }
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const pending: PendingTelegramQuestion = {
        approval,
        chatId: chat.chatId,
        sessionId: chat.sessionId,
        token: callbackToken(),
        questions: request.questions,
        answers: [],
        resolve,
        reject,
        signal: request.signal,
        timedCallId: request.wait?.timed === true ? request.wait.callId : undefined,
        messageIds: new Set(),
        index: 0,
        selectedIndices: new Set(),
        keyboardMessageId: undefined,
        onAbort: undefined,
        continued: false,
        settled: false,
      }
      pending.onAbort = () => {
        const reason: unknown = request.signal?.reason
        if (pending.timedCallId !== undefined && errorCode(reason) === 'ASK_TIMED_OUT') this.continueTimedQuestion(pending, reason)
        else this.rejectPendingQuestion(pending, userQuestionError(
          'ask_user_question was aborted before the Telegram user answered', 'ASK_ABORTED'))
      }
      request.signal?.addEventListener('abort', pending.onAbort, { once: true })
      this.pendingQuestions.set(chat.chatId, pending)
      chat.progress?.suspend()
      // Queued after intermediate messages, so the question appears below them.
      void chat.queue.then(() => this.presentQuestion(pending)).catch((error: unknown) => {
        const aborted = request.signal?.aborted === true || this.stopped
        this.rejectPendingQuestion(pending, userQuestionError(
          aborted ? 'ask_user_question was aborted before the Telegram user answered'
            : `could not deliver ask_user_question to Telegram: ${messageOf(error)}`,
          aborted ? 'ASK_ABORTED' : 'ASK_DELIVERY_FAILED',
          error,
        ))
      })
    })
  }

  /**
   * A timed wait expired: the tool call returns "pending" and the Agent keeps
   * working, while the question stays answerable here. The finished answer is
   * steered in through `userQuestions.answer`.
   */
  private continueTimedQuestion(pending: PendingTelegramQuestion, reason: unknown): void {
    if (pending.settled || pending.continued) return
    pending.continued = true
    if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
    const active = this.chats.get(pending.chatId)?.active
    if (active?.sessionId === pending.sessionId) {
      // The question outlives this turn, so its messages must survive turn cleanup.
      for (const id of pending.messageIds) active.transientMessageIds.delete(id)
      active.progress?.resume()
    }
    pending.reject(reason)
    void this.safeSend(pending.chatId, '⏳ **等待回答已超时**\n\nAgent 已继续工作；你仍可回答上面的问题，回答会作为新消息发送给 Agent。发送 /cancel 可放弃回答。')
  }

  /** Handle one inline-keyboard choice and always dismiss Telegram's callback spinner. */
  private async handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
    const message = callback.message
    if (message === undefined || message.chat.type !== 'private' || callback.data === undefined) {
      await this.safeAnswerCallback(callback.id, '这个按钮不可用。', true)
      return
    }
    if (!this.authorizedUser(callback.from)) {
      await this.safeAnswerCallback(callback.id, '⛔ 访问被拒绝', true)
      return
    }
    if (callback.data.startsWith('menu:')) {
      await this.handleMenuCallback(callback, message.chat.id, message.message_id)
      return
    }
    const match = /^uq:([a-f0-9]{12}):(\d+):(o\d+|d|u|s|c)$/.exec(callback.data)
    const pending = this.pendingQuestions.get(message.chat.id)
    if (match === null || pending === undefined || match[1] !== pending.token
      || Number(match[2]) !== pending.index || message.message_id !== pending.keyboardMessageId) {
      await this.safeAnswerCallback(callback.id, '这个问题已经失效。')
      return
    }
    const question = this.currentQuestion(pending)
    const action = match[3]!
    if (pending.approval && action !== 'o0' && action !== 'o1') {
      await this.safeAnswerCallback(callback.id, '请使用权限审批按钮。')
      return
    }
    if (action.startsWith('o')) {
      const optionIndex = Number(action.slice(1))
      const option = question.options?.[optionIndex]
      if (option === undefined) {
        await this.safeAnswerCallback(callback.id, '这个选项已经失效。')
      } else if (question.multiSelect === true) {
        if (!pending.selectedIndices.delete(optionIndex)) pending.selectedIndices.add(optionIndex)
        await this.safeAnswerCallback(callback.id)
        await this.refreshQuestionKeyboard(pending)
      } else {
        await this.safeAnswerCallback(callback.id, `已选择：${option.label}`)
        await this.submitQuestionAnswer(pending, { id: question.id, selected: [option.label] })
      }
    } else if (action === 'd') {
      const selected = this.selectedLabels(pending)
      if (question.multiSelect !== true) {
        await this.safeAnswerCallback(callback.id, '这个按钮已经失效。')
      } else if (selected.length === 0) {
        await this.safeAnswerCallback(callback.id, '请至少选择一项，或点“跳过”。')
      } else {
        await this.safeAnswerCallback(callback.id, '已提交选择。')
        await this.submitQuestionAnswer(pending, { id: question.id, selected })
      }
    } else if (action === 'u') {
      await this.safeAnswerCallback(callback.id)
      await this.requestCustomAnswer(pending)
    } else if (action === 's') {
      await this.safeAnswerCallback(callback.id, '已跳过。')
      await this.submitQuestionAnswer(pending, { id: question.id, selected: [] })
    } else {
      await this.safeAnswerCallback(callback.id, '已取消提问。')
      this.rejectPendingQuestion(pending, userQuestionError('ask_user_question was cancelled by the Telegram user', 'ASK_CANCELLED'))
    }
  }

  /** Send the current item with buttons, or with a ForceReply composer for free text. */
  private async presentQuestion(pending: PendingTelegramQuestion): Promise<void> {
    if (pending.settled) return
    const active = this.chats.get(pending.chatId)?.active
    if (active?.sessionId !== pending.sessionId) {
      throw userQuestionError('the Telegram session changed before the question was shown', 'ASK_ABORTED')
    }
    this.stopTyping(active)
    const hasOptions = (this.currentQuestion(pending).options?.length ?? 0) > 0
    const replyMarkup: TelegramReplyMarkup = hasOptions
      ? this.questionKeyboard(pending)
      : { force_reply: true, input_field_placeholder: '请输入回答，或发送 /skip 跳过', selective: true }
    const sent = await this.client.sendRichMessage(pending.chatId, this.formatQuestion(pending), this.questionSignal(pending), replyMarkup)
    this.trackQuestionMessage(pending, sent.message_id)
    if (hasOptions) {
      pending.keyboardMessageId = sent.message_id
      if (pending.settled) await this.clearQuestionKeyboard(pending)
    }
  }

  /** Render a question with all details visible even when button labels must be shortened. */
  private formatQuestion(pending: PendingTelegramQuestion): string {
    const question = this.currentQuestion(pending)
    const heading = question.header?.trim() || (question.intent?.kind === 'plan-review' ? '方案确认' : 'Agent 需要你的回答')
    const lines = [`❓ **${heading}**`, '', `问题 ${pending.index + 1} / ${pending.questions.length}`, '', question.question]
    if (question.detail?.trim()) lines.push('', question.detail)
    if (pending.approval) {
      lines.push('', '---', '', `请选择“${APPROVE_ONCE}”或“${REJECT}”；发送 \`/cancel\` 可取消申请。`)
      return lines.join('\n')
    }
    const options = question.options ?? []
    if (options.length > 0) {
      lines.push('', '---', '', '**选项**', '')
      options.forEach((option, index) => {
        lines.push(`**${index + 1}. ${option.label}**${option.description === undefined ? '' : `\n\n${option.description}`}`, '')
      })
      lines.push('---', '', question.multiSelect === true
        ? '💡 可选择多项，选好后点“完成”；也可直接输入补充或自定义回答。'
        : '💡 请选择一项；也可直接输入自定义回答。')
    } else {
      lines.push('', '---', '', '💡 请直接回复这条消息。发送 `/skip` 可跳过，发送 `/cancel` 可取消整次提问。')
    }
    return lines.join('\n')
  }

  /** Build the current keyboard; multi-select choices show their checked state. */
  private questionKeyboard(pending: PendingTelegramQuestion): TelegramInlineKeyboardMarkup {
    const question = this.currentQuestion(pending)
    const data = (action: string): string => `uq:${pending.token}:${pending.index}:${action}`
    const rows = (question.options ?? []).map((option, index) => [{
      text: buttonLabel(`${pending.selectedIndices.has(index) ? '✓ ' : ''}${index + 1}. ${option.label}`),
      callback_data: data(`o${index}`),
    }])
    if (pending.approval) return { inline_keyboard: rows }
    rows.push(question.multiSelect === true
      ? [{ text: '完成', callback_data: data('d') }, { text: '✍️ 自定义', callback_data: data('u') }]
      : [{ text: '✍️ 自定义回答', callback_data: data('u') }])
    rows.push([{ text: '跳过', callback_data: data('s') }, { text: '取消提问', callback_data: data('c') }])
    return { inline_keyboard: rows }
  }

  /** Enter free-text mode after the user explicitly presses the custom-answer button. */
  private async requestCustomAnswer(pending: PendingTelegramQuestion): Promise<void> {
    if (pending.settled) return
    await this.clearQuestionKeyboard(pending)
    try {
      const sent = await this.client.sendRichMessage(
        pending.chatId,
        '✍️ **请输入自定义回答**\n\n若刚才已勾选多项，你的文字会作为补充一并提交。',
        this.questionSignal(pending),
        { force_reply: true, input_field_placeholder: '输入自定义回答', selective: true },
      )
      this.trackQuestionMessage(pending, sent.message_id)
    } catch (error) {
      this.rejectPendingQuestion(pending, userQuestionError(
        `could not request a custom Telegram answer: ${messageOf(error)}`, 'ASK_DELIVERY_FAILED', error))
    }
  }

  /** Store one answer, then present the next question or complete the batch. */
  private async submitQuestionAnswer(pending: PendingTelegramQuestion, answer: AskUserQuestionAnswerItem): Promise<void> {
    if (pending.settled || answer.id !== this.currentQuestion(pending).id) return
    await this.clearQuestionKeyboard(pending)
    if (pending.settled) return
    pending.answers.push(answer)
    pending.index += 1
    pending.selectedIndices = new Set()
    if (pending.index >= pending.questions.length) {
      await this.resolvePendingQuestion(pending)
      return
    }
    try {
      await this.presentQuestion(pending)
    } catch (error) {
      this.rejectPendingQuestion(pending, userQuestionError(
        `could not deliver ask_user_question to Telegram: ${messageOf(error)}`,
        pending.signal?.aborted === true ? 'ASK_ABORTED' : 'ASK_DELIVERY_FAILED',
        error,
      ))
    }
  }

  private currentQuestion(pending: PendingTelegramQuestion): AskUserQuestionItem {
    const question = pending.questions[pending.index]
    if (question === undefined) throw new Error('telegram: pending question index is out of bounds')
    return question
  }

  /** Abort question delivery when either the bridge or a still-open DSH request ends. */
  private questionSignal(pending: PendingTelegramQuestion): AbortSignal {
    return pending.signal === undefined || pending.continued
      ? this.abortController.signal
      : AbortSignal.any([this.abortController.signal, pending.signal])
  }

  private selectedLabels(pending: PendingTelegramQuestion): string[] {
    const options = this.currentQuestion(pending).options ?? []
    return [...pending.selectedIndices].sort((left, right) => left - right)
      .flatMap(index => options[index] === undefined ? [] : [options[index].label])
  }

  /** Update checkmarks after toggling a multi-select option. */
  private async refreshQuestionKeyboard(pending: PendingTelegramQuestion): Promise<void> {
    if (pending.keyboardMessageId === undefined || pending.settled) return
    await this.editKeyboard(pending.chatId, pending.keyboardMessageId, this.questionKeyboard(pending))
  }

  /** Remove an old keyboard so it cannot submit an answer twice. */
  private async clearQuestionKeyboard(pending: PendingTelegramQuestion): Promise<void> {
    const messageId = pending.keyboardMessageId
    pending.keyboardMessageId = undefined
    if (messageId !== undefined) await this.editKeyboard(pending.chatId, messageId, undefined)
  }

  private async editKeyboard(chatId: number, messageId: number, markup: TelegramInlineKeyboardMarkup | undefined): Promise<void> {
    try {
      await this.client.editMessageReplyMarkup(chatId, messageId, markup, this.abortController.signal)
    } catch (error) {
      if (!this.stopped && !isNotModified(error) && !isMissingMessage(error)) {
        this.ctx.logger.warn('[telegram] question keyboard update failed: %s', messageOf(error))
      }
    }
  }

  private async resolvePendingQuestion(pending: PendingTelegramQuestion): Promise<void> {
    if (!this.settlePendingQuestion(pending)) return
    const answer = { answers: pending.answers }
    if (!pending.continued) {
      const active = this.chats.get(pending.chatId)?.active
      if (active?.sessionId === pending.sessionId && this.ctx.agents.get(active.sessionId)?.status === 'running') {
        void this.safeAction(pending.chatId, 'typing')
        this.startTyping(active)
        active.progress?.resume()
      }
      pending.resolve(answer)
      return
    }
    try {
      const agent = await this.resolveAgent(pending.sessionId)
      const accepted = this.ctx.get('userQuestions')?.answer(agent, pending.timedCallId!, answer) ?? false
      await this.safeSend(pending.chatId, accepted ? '✅ **回答已发送给 Agent**' : 'ℹ️ **该提问已在其他界面回答或已失效**')
    } catch (error) {
      await this.safeSend(pending.chatId, `⚠️ **回答发送失败**\n\n${richCodeBlock(messageOf(error))}`)
    }
  }

  private rejectPendingQuestion(pending: PendingTelegramQuestion, error: unknown): void {
    if (!this.settlePendingQuestion(pending)) return
    void this.clearQuestionKeyboard(pending)
    if (pending.continued) return
    const active = this.chats.get(pending.chatId)?.active
    if (active?.sessionId === pending.sessionId) active.progress?.resume()
    pending.reject(error)
  }

  /** Atomically remove a pending request and its abort listener. */
  private settlePendingQuestion(pending: PendingTelegramQuestion): boolean {
    if (pending.settled) return false
    pending.settled = true
    if (this.pendingQuestions.get(pending.chatId) === pending) this.pendingQuestions.delete(pending.chatId)
    if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
    return true
  }

  /** Question/answer messages are removed with the turn, unless the question outlives it. */
  private trackQuestionMessage(pending: PendingTelegramQuestion, messageId: number): void {
    pending.messageIds.add(messageId)
    const active = this.chats.get(pending.chatId)?.active
    if (!pending.continued && active?.sessionId === pending.sessionId) active.transientMessageIds.add(messageId)
  }

  // --- Turn delivery ---------------------------------------------------------

  private handleSessionEvent(session: Session, event: SessionEvent): void {
    const chat = this.chatsBySession.get(session.id)
    if (chat === undefined) return
    if (event.type === 'turn/start') {
      chat.progress?.dispose()
      void this.safeAction(chat.chatId, 'typing')
      this.startTyping(chat)
      chat.progress = new TelegramProgress(this.client, chat.chatId, this.abortController.signal,
        task => this.enqueue(chat, task),
        error => this.ctx.logger.warn('[telegram] preview failed: %s', messageOf(error)),
        messageId => chat.transientMessageIds.add(messageId))
    } else if (event.type === 'turn/end') {
      const progress = chat.progress
      chat.progress = undefined
      const reason = event.data.reason.kind
      const notice = progress?.terminalNotice(reason)
      // An aborted turn never delivers its partial answer.
      const final = reason === 'aborted' ? notice : progress?.finalMessage(notice) ?? notice
      progress?.dispose()
      void this.enqueue(chat, async () => {
        this.stopTyping(chat)
        if (final !== undefined && !await this.deliverResult(chat, final)) return
        const messageIds = [...chat.transientMessageIds]
        chat.transientMessageIds.clear()
        await this.deleteMessageIds(chat.chatId, messageIds)
      })
    } else {
      chat.progress?.event(event)
    }
  }

  /** Cache, then send the complete turn; a failure leaves the cache for `/resend`. */
  private async deliverResult(chat: ActiveChatSession, markdown: string): Promise<boolean> {
    try {
      const { text, paths } = extractFileDirectives(markdown)
      // Upload before the text: the reply may refer to the files, and a rejected
      // upload must not swallow an otherwise deliverable answer.
      const notices = await this.sendWorkspaceFiles(chat, paths)
      const body = [text, ...notices].filter(part => part.trim()).join('\n\n')
      await this.resultCache.deliver(chat.chatId, body, message =>
        this.client.sendRichMessage(chat.chatId, message, this.abortController.signal))
      return true
    } catch (error) {
      if (this.stopped) return false
      this.ctx.logger.error('[telegram] result delivery failed: %s', messageOf(error))
      await this.safeSend(chat.chatId, '⚠️ **结果发送失败**\n\n完整结果已缓存，可发送 /resend 重试；详细原因见 DSH 日志。')
      return false
    }
  }

  /**
   * Upload every `[[send: …]]` path that resolves inside the chat's workspace.
   * Paths are re-resolved through `realpath`, so a symlink cannot widen the upload
   * beyond the workspace the model was told about.
   * @returns Markdown notices for the paths that were not sent.
   */
  private async sendWorkspaceFiles(chat: ActiveChatSession, paths: readonly string[]): Promise<string[]> {
    if (paths.length === 0) return []
    let workspaceRoot: string
    try {
      workspaceRoot = await realpath(chat.workspace.path)
    } catch (error) {
      this.ctx.logger.warn('[telegram] workspace realpath failed: %s', messageOf(error))
      return ['⚠️ **文件未发送**：无法解析当前工作区。']
    }
    const notices: string[] = []
    for (const requested of paths) {
      try {
        const target = await realpath(requested)
        // Confine uploads to the workspace: a model-chosen absolute path must never
        // become an arbitrary read of the user's home directory.
        if (!pathInside(workspaceRoot, target)) {
          notices.push(`⚠️ **未发送**：\`${richLiteral(requested)}\` 不在当前工作区内。`)
          continue
        }
        const info = await stat(target)
        if (!info.isFile()) {
          notices.push(`⚠️ **未发送**：\`${richLiteral(requested)}\` 不是普通文件。`)
          continue
        }
        if (info.size > MAX_UPLOAD_BYTES) {
          notices.push(`⚠️ **未发送**：\`${richLiteral(requested)}\` 超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB。`)
          continue
        }
        const data = await readFile(target)
        await this.client.sendDocument(chat.chatId, { data, name: basename(target) }, this.abortController.signal)
      } catch (error) {
        this.ctx.logger.warn('[telegram] file upload failed: %s', messageOf(error))
        notices.push(`⚠️ **未发送**：\`${richLiteral(requested)}\` 上传失败。`)
      }
    }
    return notices
  }

  /** Serialize per-chat Telegram side effects; they never interleave. */
  private enqueue(chat: ActiveChatSession, task: () => Promise<void>): Promise<void> {
    chat.queue = chat.queue.then(task).catch((error: unknown) => {
      if (!this.stopped) this.ctx.logger.error('[telegram] chat task failed: %s', messageOf(error))
    })
    return chat.queue
  }

  /** Delete messages in Bot API batches. */
  private async deleteMessageIds(chatId: number, messageIds: readonly number[]): Promise<void> {
    const unique = [...new Set(messageIds)]
    for (let offset = 0; offset < unique.length; offset += 100) {
      try {
        await this.client.deleteMessages(chatId, unique.slice(offset, offset + 100), this.abortController.signal)
      } catch (error) {
        if (this.stopped) return
        if (!isMissingMessage(error)) this.ctx.logger.warn('[telegram] message cleanup failed: %s', messageOf(error))
      }
    }
  }

  /** Keep Telegram's typing indicator alive while a turn runs (the action expires after ~5s). */
  private startTyping(chat: ActiveChatSession): void {
    this.stopTyping(chat)
    chat.typingTimer = setInterval(() => { void this.safeAction(chat.chatId, 'typing') }, 4000)
  }

  private stopTyping(chat: ActiveChatSession): void {
    clearInterval(chat.typingTimer)
    chat.typingTimer = undefined
  }

  /** Callback acknowledgements are best-effort but never omitted. */
  private async safeAnswerCallback(callbackId: string, text?: string, showAlert?: boolean): Promise<void> {
    try {
      await this.client.answerCallbackQuery(callbackId, text === undefined ? undefined : truncateText(text, 200),
        showAlert, this.abortController.signal)
    } catch (error) {
      if (!this.stopped) this.ctx.logger.warn('[telegram] callback acknowledgement failed: %s', messageOf(error))
    }
  }

  /** Fixed notices use the same native Rich Markdown transport as assistant replies. */
  private async safeSend(chatId: number, text: string): Promise<number | undefined> {
    try {
      return (await this.client.sendRichMessage(chatId, text, this.abortController.signal)).message_id
    } catch (error) {
      if (!this.stopped) this.ctx.logger.error('[telegram] delivery failed: %s', messageOf(error))
      return undefined
    }
  }

  private async safeAction(chatId: number, action: string): Promise<void> {
    try {
      await this.client.sendChatAction(chatId, action, this.abortController.signal)
    } catch (error) {
      if (!this.stopped) this.ctx.logger.warn('[telegram] chat action %s failed: %s', action, messageOf(error))
    }
  }
}
