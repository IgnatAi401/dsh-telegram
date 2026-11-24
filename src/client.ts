/**
 * Minimal Telegram Bot API client over `fetch`: long polling, native Rich
 * Markdown messages and drafts, inline keyboards, widgets, file uploads and downloads. The
 * token is embedded in the request URL, so every error path redacts it.
 * @module telegram/client
 */

// Uploads go through the `undici` package's fetch, which encodes only its own
// FormData class: Node's global FormData comes from the copy of undici bundled
// with Node, so it would be sent as the string "[object FormData]".
import { Agent, EnvHttpProxyAgent, FormData, fetch as undiciFetch } from 'undici'
import { http2Fetch } from './http2-fetch.js'

/**
 * Node's global `fetch` closes an idle connection after 4 seconds, and a new
 * TLS handshake to the Bot API can take a second, so a panel tap after a pause
 * paid that for every call. Bot API calls share one HTTP/2 session that the
 * long poll keeps open ({@link http2Fetch}); uploads, and everything when the
 * session cannot be opened, use `undici` with idle connections kept for a minute.
 */
const KEEP_ALIVE_MS = 60_000
let sharedFetch: typeof fetch | undefined

/** One transport for every client, honouring `NODE_USE_ENV_PROXY` like the global `fetch`. */
function keepAliveFetch(): typeof fetch {
  if (sharedFetch === undefined) {
    const options = { keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: KEEP_ALIVE_MS }
    const useEnvProxy = ['1', 'true'].includes(process.env.NODE_USE_ENV_PROXY ?? '')
    const dispatcher = useEnvProxy ? new EnvHttpProxyAgent(options) : new Agent(options)
    const http1 = ((input: string, init?: RequestInit) =>
      undiciFetch(input, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch
    // An HTTP proxy from the environment cannot carry the direct HTTP/2 session.
    sharedFetch = useEnvProxy ? http1 : http2Fetch(http1)
  }
  return sharedFetch
}

/** Telegram user object (sender of a message). */
export interface TelegramUser {
  readonly id: number
  readonly first_name?: string
  readonly username?: string
  readonly is_bot?: boolean
}

/** Telegram chat object (private chat, group, or channel). */
export interface TelegramChat {
  readonly id: number
  readonly type: string
  readonly title?: string
  readonly username?: string
  readonly first_name?: string
}

/** Common Telegram-hosted file identity. */
export interface TelegramFileReference {
  readonly file_id: string
  readonly file_unique_id: string
  readonly file_size?: number
}

/** One available resolution of a Telegram photo. */
export interface TelegramPhotoSize extends TelegramFileReference {
  readonly width: number
  readonly height: number
}

/** A general Telegram document, including images and arbitrary files. */
export interface TelegramDocument extends TelegramFileReference {
  readonly file_name?: string
  readonly mime_type?: string
}

/** Received `RichText`: a string, an array, or a typed object; read through `rich-text.ts`. */
export type TelegramRichText = unknown

/** Received rich message; its blocks are projected to text by `rich-text.ts`. */
export interface TelegramRichMessage {
  readonly blocks: readonly unknown[]
}

/** The part of the replied-to message that a reply quotes. */
export interface TelegramTextQuote {
  /** May be empty when the quote was chosen from a rich message. */
  readonly text: string
  /** One entry per quoted text of a rich message (Bot API 10.4). */
  readonly rich_texts?: readonly TelegramRichText[]
  /** Set when the sender selected the quote; otherwise the server added it. */
  readonly is_manual?: true
}

/** Telegram message object; only the fields used by this plugin are modeled. */
export interface TelegramMessage {
  readonly message_id: number
  readonly chat: TelegramChat
  /** Topic of a private chat with topics (Bot API 10.5); absent in the main chat. */
  readonly message_thread_id?: number
  readonly is_topic_message?: true
  readonly from?: TelegramUser
  readonly text?: string
  /** Rich messages carry their content here instead of in `text`. */
  readonly rich_message?: TelegramRichMessage
  readonly caption?: string
  readonly photo?: readonly TelegramPhotoSize[]
  readonly document?: TelegramDocument
  readonly media_group_id?: string
  /**
   * In a topic, every message replies to the topic's first (service) message
   * unless the user replied to another one.
   */
  readonly reply_to_message?: TelegramMessage
  /** Service messages of topics: created by the bot, renamed, closed or reopened. */
  readonly forum_topic_created?: unknown
  readonly forum_topic_edited?: unknown
  readonly forum_topic_closed?: unknown
  readonly forum_topic_reopened?: unknown
  /** Quoted part of `reply_to_message`, when the reply quotes only a part of it. */
  readonly quote?: TelegramTextQuote
  readonly date: number
}

/** File metadata returned by Telegram's `getFile`. */
export interface TelegramFile extends TelegramFileReference {
  readonly file_path?: string
}

/** Fully downloaded Telegram file plus the metadata used to obtain it. */
export interface TelegramDownloadedFile {
  readonly file: TelegramFile
  readonly data: Uint8Array
}

/** One callback generated by an inline-keyboard button. */
export interface TelegramCallbackQuery {
  readonly id: string
  readonly from: TelegramUser
  readonly message?: TelegramMessage
  readonly data?: string
}

/** One request sent by a widget in a message of the bot (Bot API 10.4). */
export interface TelegramWidgetQuery {
  readonly id: string
  readonly from: TelegramUser
  /** Omitted for widgets in inline messages, which this plugin never sends. */
  readonly chat?: TelegramChat
  readonly message_id?: number
  /** Not documented for widget queries; read in case Telegram sends it for a topic. */
  readonly message_thread_id?: number
  /** 1-64 bytes chosen by the widget's code. */
  readonly data: string
}

/** A widget to send: fixed HTML plus its initial per-message state. */
export interface TelegramWidgetInput {
  /** At most 32768 bytes, and 4096 bytes after zlib compression. */
  readonly html: string
  /** Chat state, at most 1024 bytes; the only part that can change later. */
  readonly chatData: string
  /** Plain text shown below the widget, and instead of it by apps without widget support. */
  readonly caption?: string
  /** Logical pixels; omitted fills the bubble width / follows the content height. */
  readonly width?: number
  readonly height?: number
  /** Whether the widget may send `widget_query` requests; defaults to true (the bridge's panels). */
  readonly allowQueries?: boolean
}

/** Inline button whose opaque callback payload is returned to the bot. */
export interface TelegramInlineKeyboardButton {
  readonly text: string
  readonly callback_data: string
}

/** Inline keyboard attached below a bot message. */
export interface TelegramInlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly TelegramInlineKeyboardButton[])[]
}

/** Ask Telegram clients to open a reply composer for the bot message. */
export interface TelegramForceReply {
  readonly force_reply: true
  readonly input_field_placeholder?: string
  readonly selective?: boolean
}

/** Reply-markup shapes used by the question flow. */
export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramForceReply

/** The private-chat topic settings of `setMySettings` (Bot API 10.5). */
export interface TelegramBotSettings {
  readonly has_topics_enabled?: boolean
  readonly allows_users_to_create_topics?: boolean
  readonly has_topic_sidebar?: boolean
}

/** A topic created with `createForumTopic`. */
export interface TelegramForumTopic {
  readonly message_thread_id: number
  readonly name: string
}

/** One topic of a private chat with topics (Bot API 10.5). */
export interface TelegramChatTarget {
  readonly chatId: number
  readonly threadId?: number
}

/**
 * Where a call goes: a bare chat id, or a chat plus an optional topic. A target
 * without `threadId` sends exactly what a bare chat id does.
 */
export type TelegramTarget = number | TelegramChatTarget

/** The `chat_id` of a target. */
export function targetChatId(target: TelegramTarget): number {
  return typeof target === 'number' ? target : target.chatId
}

/** The `message_thread_id` of a target, if it names a topic. */
export function targetThreadId(target: TelegramTarget): number | undefined {
  return typeof target === 'number' ? undefined : target.threadId
}

/** `chat_id`, plus `message_thread_id` only when the target names a topic. */
function chatFields(target: TelegramTarget): { chat_id: number; message_thread_id?: number } {
  const threadId = targetThreadId(target)
  return { chat_id: targetChatId(target), ...(threadId === undefined ? {} : { message_thread_id: threadId }) }
}

/** Multipart form of {@link chatFields}. */
function setChatFields(form: FormData, target: TelegramTarget): void {
  const { chat_id, message_thread_id } = chatFields(target)
  form.set('chat_id', String(chat_id))
  if (message_thread_id !== undefined) form.set('message_thread_id', String(message_thread_id))
}

/** Telegram update envelope for text messages and inline-button callbacks. */
export interface TelegramUpdate {
  readonly update_id: number
  readonly message?: TelegramMessage
  readonly callback_query?: TelegramCallbackQuery
  readonly widget_query?: TelegramWidgetQuery
  readonly stopped_message_generation?: {
    readonly chat: TelegramChat
    readonly draft_id: number
    readonly message_thread_id?: number
  }
}

/** One local file uploaded with a rich message and referenced by a `tg://<type>?id=<id>` link. */
export interface TelegramRichMedia {
  /** 1-64 characters from A-Z, a-z, 0-9, `_` and `-`; also the multipart field name. */
  readonly id: string
  /** Bot API InputMedia type; animations are linked as `tg://video`. */
  readonly type: 'photo' | 'video' | 'animation' | 'audio' | 'document'
  readonly file: Blob
  readonly fileName: string
}

/** Runtime seam surface tests substitute with a fake. */
export interface TelegramClientLike {
  /** Native Rich Markdown (including official HTML extensions); drafts expire after 30 seconds. */
  sendRichMessageDraft(chat: TelegramTarget, draftId: number, markdown: string, signal?: AbortSignal): Promise<boolean>
  sendRichMessage(chat: TelegramTarget, markdown: string, signal?: AbortSignal, replyMarkup?: TelegramReplyMarkup): Promise<TelegramMessage>
  /** Upload media together with the rich message that embeds them through `tg://<type>?id=` links. */
  sendRichMessageWithMedia(chat: TelegramTarget, markdown: string, media: readonly TelegramRichMedia[], signal?: AbortSignal): Promise<TelegramMessage>
  /** Replace rich content and its inline keyboard in a single request. */
  editRichMessage(chat: TelegramTarget, messageId: number, markdown: string, signal?: AbortSignal, replyMarkup?: TelegramInlineKeyboardMarkup): Promise<TelegramMessage>
  /** Long-poll for updates at or after `offset`. */
  getUpdates(offset?: number, signal?: AbortSignal): Promise<TelegramUpdate[]>
  /** Send a chat action such as `typing`. */
  sendChatAction(chat: TelegramTarget, action: string, signal?: AbortSignal): Promise<boolean>
  /** Register the bot's slash-command list (shown in the Telegram UI). */
  setMyCommands(commands: Array<{ command: string; description: string }>, signal?: AbortSignal): Promise<boolean>
  /** Change bot settings (Bot API 10.5); optional so test fakes may omit it. */
  setMySettings?(settings: TelegramBotSettings, signal?: AbortSignal): Promise<boolean>
  /** The bot's own `BotFullInfo`; optional so test fakes may omit it. */
  getMe?(signal?: AbortSignal): Promise<Record<string, unknown>>
  /** Create a topic in a private chat with the bot; optional so test fakes may omit it. */
  createForumTopic?(chatId: number, name: string, signal?: AbortSignal): Promise<TelegramForumTopic>
  /** Rename a topic (1-128 characters). */
  editForumTopic?(chatId: number, threadId: number, name: string, signal?: AbortSignal): Promise<boolean>
  /** Delete a topic with all its messages. */
  deleteForumTopic?(chatId: number, threadId: number, signal?: AbortSignal): Promise<boolean>
  /** Replace or remove the inline keyboard below a message. */
  editMessageReplyMarkup(
    chat: TelegramTarget,
    messageId: number,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    signal?: AbortSignal,
  ): Promise<TelegramMessage>
  /** Acknowledge a callback so Telegram dismisses the button progress spinner. */
  answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean, signal?: AbortSignal): Promise<boolean>
  /** Send an HTML widget that may send requests back as `widget_query` updates. */
  sendWidget(chat: TelegramTarget, widget: TelegramWidgetInput, signal?: AbortSignal): Promise<TelegramMessage>
  /** Replace the chat state of a sent widget; its HTML can never change. */
  editMessageWidgetData(chat: TelegramTarget, messageId: number, chatData: string, signal?: AbortSignal): Promise<boolean>
  /** Answer a widget's request within 15 seconds; `data` reaches only that widget. */
  answerWidgetQuery(widgetQueryId: string, data?: string, signal?: AbortSignal): Promise<boolean>
  /** Delete up to 100 messages from one chat in a single request. */
  deleteMessages(chat: TelegramTarget, messageIds: readonly number[], signal?: AbortSignal): Promise<boolean>
  /** Upload one file as a document; Telegram keeps the original bytes (images are not recompressed). */
  sendDocument(chat: TelegramTarget, document: Blob, fileName: string, caption?: string, signal?: AbortSignal): Promise<TelegramMessage>
  /** Resolve and download one Telegram-hosted file under an explicit byte cap. */
  downloadFile(fileId: string, maxBytes: number, signal?: AbortSignal): Promise<TelegramDownloadedFile>
}

/** Options for {@link TelegramClient}. */
export interface TelegramClientOptions {
  /** HTTP client seam; production uses a shared HTTP/2 session with an `undici` fallback. */
  fetch?: typeof fetch
  /** API base URL; production uses the public Bot API. */
  baseUrl?: string
  /** Long-polling timeout in seconds; production default is 30. */
  pollingTimeoutSec?: number
  /** Deadline for a complete API response, including its JSON body. Defaults to 15 seconds. */
  requestTimeoutMs?: number
  /** Deadline for a `sendDocument` upload. Defaults to 5 minutes. */
  uploadTimeoutMs?: number
}

interface TelegramApiResponse<T> {
  ok?: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

/** Structured API failure; tokens are redacted before constructing this error. */
export class TelegramApiError extends Error {
  constructor(message: string, readonly code: number, readonly retryAfter?: number) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

/** Replace the token with a placeholder in an error text. */
function redactToken(text: string, token: string): string {
  return text.split(token).join('***')
}

/** Strip the bot token from any thrown value before it is logged. */
function redactedMessage(error: unknown, token: string): string {
  const text = error instanceof Error ? error.message : String(error)
  return redactToken(text, token)
}

/**
 * Minimal Bot API client. All methods throw on transport failure or a
 * non-`ok` response; thrown messages never contain the token.
 */
export class TelegramClient implements TelegramClientLike {
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  /** Long-polling timeout in seconds; controls each getUpdates call. */
  readonly pollingTimeoutSec: number
  private readonly requestTimeoutMs: number
  private readonly uploadTimeoutMs: number

  /**
   * @param token - bot token from @BotFather.
   * @param options - client options.
   */
  constructor(token: string, options: TelegramClientOptions = {}) {
    const normalizedToken = token.trim()
    if (normalizedToken === '') throw new Error('telegram client: token must not be empty')
    const pollingTimeoutSec = options.pollingTimeoutSec ?? 30
    if (!Number.isSafeInteger(pollingTimeoutSec) || pollingTimeoutSec < 1) {
      throw new Error('telegram client: pollingTimeoutSec must be a positive integer')
    }
    this.token = normalizedToken
    this.fetchImpl = options.fetch ?? keepAliveFetch()
    this.baseUrl = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')
    this.pollingTimeoutSec = pollingTimeoutSec
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new RangeError('telegram client: requestTimeoutMs must be a positive integer')
    }
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 300000
    if (!Number.isSafeInteger(this.uploadTimeoutMs) || this.uploadTimeoutMs < 1) {
      throw new RangeError('telegram client: uploadTimeoutMs must be a positive integer')
    }
  }

  private url(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`
  }

  /** Build a token-bearing download URL; callers must redact every failure path. */
  private fileUrl(filePath: string): string {
    return `${this.baseUrl}/file/bot${this.token}/${filePath.replace(/^\/+/, '')}`
  }

  /** POST `method` with a JSON or multipart `body`; throws on transport failure or a non-ok response. */
  private async call<T>(method: string, body: Record<string, unknown> | FormData, signal?: AbortSignal, retries = 0): Promise<T> {
    let response: Response
    let payload: TelegramApiResponse<T> | null
    try {
      const multipart = body instanceof FormData
      const timeout = method === 'getUpdates'
        ? this.pollingTimeoutSec * 1000 + this.requestTimeoutMs
        : multipart ? this.uploadTimeoutMs
          : method.endsWith('Draft') ? Math.min(5000, this.requestTimeoutMs) : this.requestTimeoutMs
      const result = await this.requestWithin(timeout, signal, async requestSignal => {
        // fetch derives the multipart boundary header from FormData itself.
        const response = await this.fetchImpl(this.url(method), multipart
          ? { method: 'POST', body, signal: requestSignal }
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              signal: requestSignal,
            })
        let payload: TelegramApiResponse<T> | null
        try {
          payload = await response.json() as TelegramApiResponse<T>
        } catch {
          requestSignal.throwIfAborted()
          payload = null
        }
        return { response, payload }
      })
      response = result.response
      payload = result.payload
    } catch (error) {
      throw new Error(`telegram ${method} transport error: ${redactedMessage(error, this.token)}`)
    }
    if (!response.ok || payload?.ok !== true) {
      const description = payload?.description
        ?? (payload === null ? `invalid JSON response (HTTP ${response.status})` : `HTTP ${response.status}`)
      const code = payload?.error_code ?? response.status
      const retryAfter = payload?.parameters?.retry_after
      // Only explicit flood-control rejections are safe to retry: transport failures
      // may have delivered a message already. Drafts are retried by the coalescer.
      if (code === 429 && retries < 2 && !method.endsWith('Draft')
        && typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 30) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')) }
          const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, Math.max(1000, retryAfter * 1000))
          if (signal?.aborted) onAbort()
          else signal?.addEventListener('abort', onAbort, { once: true })
        })
        return this.call<T>(method, body, signal, retries + 1)
      }
      throw new TelegramApiError(`telegram ${method} failed: ${redactToken(description, this.token)}`, code, retryAfter)
    }
    if (!Object.hasOwn(payload, 'result')) {
      throw new Error(`telegram ${method} failed: response omitted result`)
    }
    return payload.result as T
  }

  /** A stalled fetch/body must never hold the chat's delivery queue indefinitely. */
  private async requestWithin<T>(timeoutMs: number, signal: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeout = new AbortController()
    const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
    const timer = setTimeout(() => timeout.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs)
    let onAbort: (() => void) | undefined
    try {
      combined.throwIfAborted()
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(combined.reason)
        combined.addEventListener('abort', onAbort, { once: true })
      })
      // The race also covers transports that ignore cancellation or never finish
      // reading their response body. The real fetch still receives the abort.
      return await Promise.race([task(combined), cancelled])
    } finally {
      clearTimeout(timer)
      if (onAbort !== undefined) combined.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Long-poll for message and callback updates. Pass the previous update id plus one to
   * acknowledge already-seen updates; `undefined` asks for any pending update.
   * @param offset - the update id to start from.
   * @returns the batch of updates received within the polling timeout.
   */
  getUpdates(offset?: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const body: Record<string, unknown> = {
      timeout: this.pollingTimeoutSec,
      // An empty list means every update type except chat_member and reactions.
      allowed_updates: ['message', 'callback_query', 'stopped_message_generation', 'widget_query'],
    }
    if (offset !== undefined) body.offset = offset
    return this.call<TelegramUpdate[]>('getUpdates', body, signal)
  }

  /**
   * Send a chat action such as `typing`; Telegram shows it briefly while a
   * real message is on the way.
   * @param chat - target chat, optionally with its topic.
   * @param action - the action name (for example `typing`).
   * @returns whether the action was accepted.
   */
  sendChatAction(chat: TelegramTarget, action: string, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>('sendChatAction', { ...chatFields(chat), action }, signal)
  }

  sendRichMessageDraft(chat: TelegramTarget, draftId: number, markdown: string, signal?: AbortSignal): Promise<boolean> {
    return this.call('sendRichMessageDraft', {
      ...chatFields(chat), draft_id: draftId, rich_message: { markdown }, can_stop: true,
    }, signal)
  }

  sendRichMessage(chat: TelegramTarget, markdown: string, signal?: AbortSignal, replyMarkup?: TelegramReplyMarkup): Promise<TelegramMessage> {
    return this.call('sendRichMessage', {
      ...chatFields(chat),
      rich_message: { markdown },
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    }, signal)
  }

  /**
   * Multipart `sendRichMessage`: each file is posted under its id and named in
   * `rich_message.media` as `attach://<id>`. Telegram refuses the whole message
   * beyond 50 media, 50 MB in total, or with an empty file.
   */
  sendRichMessageWithMedia(chat: TelegramTarget, markdown: string, media: readonly TelegramRichMedia[], signal?: AbortSignal): Promise<TelegramMessage> {
    const form = new FormData()
    setChatFields(form, chat)
    form.set('rich_message', JSON.stringify({
      markdown,
      media: media.map(({ id, type }) => ({ id, media: { type, media: `attach://${id}` } })),
    }))
    for (const { id, file, fileName } of media) form.set(id, file, fileName)
    return this.call<TelegramMessage>('sendRichMessage', form, signal)
  }

  /** Edits name the message by its chat-wide id, so a topic is not sent. */
  editRichMessage(chat: TelegramTarget, messageId: number, markdown: string, signal?: AbortSignal, replyMarkup?: TelegramInlineKeyboardMarkup): Promise<TelegramMessage> {
    return this.call('editMessageText', {
      chat_id: targetChatId(chat),
      message_id: messageId,
      rich_message: { markdown },
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    }, signal)
  }

  /**
   * Register the bot's slash-command list; Telegram shows it in the `/` menu.
   * @param commands - `{ command, description }` pairs (command without the leading slash).
   * @returns whether the registration was accepted.
   */
  setMyCommands(commands: Array<{ command: string; description: string }>, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>('setMyCommands', { commands }, signal)
  }

  /** Change bot settings (Bot API 10.5); omitted settings stay unchanged. */
  setMySettings(settings: TelegramBotSettings, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>('setMySettings', { ...settings }, signal)
  }

  /** The bot's own `BotFullInfo`, including its settings (Bot API 10.5). */
  getMe(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('getMe', {}, signal)
  }

  /** Create a topic; in a private chat this needs topics enabled through `setMySettings`. */
  createForumTopic(chatId: number, name: string, signal?: AbortSignal): Promise<TelegramForumTopic> {
    return this.call<TelegramForumTopic>('createForumTopic', { chat_id: chatId, name }, signal)
  }

  editForumTopic(chatId: number, threadId: number, name: string, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>('editForumTopic', { chat_id: chatId, message_thread_id: threadId, name }, signal)
  }

  deleteForumTopic(chatId: number, threadId: number, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>('deleteForumTopic', { chat_id: chatId, message_thread_id: threadId }, signal)
  }

  editMessageReplyMarkup(
    chat: TelegramTarget,
    messageId: number,
    replyMarkup: TelegramInlineKeyboardMarkup = { inline_keyboard: [] },
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('editMessageReplyMarkup', {
      chat_id: targetChatId(chat),
      message_id: messageId,
      reply_markup: replyMarkup,
    }, signal)
  }

  answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId }
    if (text !== undefined) body.text = text
    if (showAlert !== undefined) body.show_alert = showAlert
    return this.call<boolean>('answerCallbackQuery', body, signal)
  }

  sendWidget(chat: TelegramTarget, widget: TelegramWidgetInput, signal?: AbortSignal): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendWidget', {
      ...chatFields(chat),
      html: widget.html,
      ...(widget.chatData === '' ? {} : { chat_data: widget.chatData }),
      ...(widget.allowQueries === false ? {} : { allow_queries: true }),
      ...(widget.caption === undefined ? {} : { caption: widget.caption }),
      ...(widget.width === undefined ? {} : { width: widget.width }),
      ...(widget.height === undefined ? {} : { height: widget.height }),
    }, signal)
  }

  editMessageWidgetData(chat: TelegramTarget, messageId: number, chatData: string, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>('editMessageWidgetData', { chat_id: targetChatId(chat), message_id: messageId, chat_data: chatData }, signal)
  }

  answerWidgetQuery(widgetQueryId: string, data?: string, signal?: AbortSignal): Promise<boolean> {
    const body: Record<string, unknown> = { widget_query_id: widgetQueryId }
    if (data !== undefined && data !== '') body.data = data
    return this.call<boolean>('answerWidgetQuery', body, signal)
  }

  deleteMessages(chat: TelegramTarget, messageIds: readonly number[], signal?: AbortSignal): Promise<boolean> {
    if (messageIds.length < 1 || messageIds.length > 100) {
      throw new RangeError('telegram deleteMessages: messageIds must contain from 1 to 100 entries')
    }
    return this.call<boolean>('deleteMessages', {
      chat_id: targetChatId(chat),
      message_ids: [...messageIds],
    }, signal)
  }

  /**
   * Upload a file through multipart `sendDocument`. The public Bot API accepts
   * at most 50 MB per file; callers check the size before reading the file.
   * @param caption - plain-text caption; Telegram allows 1024 characters.
   */
  sendDocument(chat: TelegramTarget, document: Blob, fileName: string, caption?: string, signal?: AbortSignal): Promise<TelegramMessage> {
    const form = new FormData()
    setChatFields(form, chat)
    form.set('document', document, fileName)
    if (caption !== undefined && caption !== '') form.set('caption', caption)
    return this.call<TelegramMessage>('sendDocument', form, signal)
  }

  /**
   * Resolve a Telegram `file_id` and download it without ever buffering more
   * than the caller-approved limit. The public Bot API currently imposes its
   * own 20 MiB ceiling; a local Bot API server may allow more.
   */
  async downloadFile(fileId: string, maxBytes: number, signal?: AbortSignal): Promise<TelegramDownloadedFile> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('telegram downloadFile: maxBytes must be a positive safe integer')
    }
    const file = await this.call<TelegramFile>('getFile', { file_id: fileId }, signal)
    if (file.file_path === undefined || file.file_path === '') {
      throw new Error('telegram getFile failed: response omitted file_path')
    }
    if (file.file_size !== undefined && file.file_size > maxBytes) {
      throw new Error(`telegram downloadFile failed: file exceeds ${maxBytes} bytes`)
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.fileUrl(file.file_path), { signal })
    } catch (error) {
      throw new Error(`telegram downloadFile transport error: ${redactedMessage(error, this.token)}`)
    }
    if (!response.ok) {
      throw new Error(`telegram downloadFile failed: HTTP ${response.status}`)
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      try { await response.body?.cancel() } catch { /* best-effort release */ }
      throw new Error(`telegram downloadFile failed: file exceeds ${maxBytes} bytes`)
    }
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('telegram downloadFile failed: response omitted body')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        length += next.value.byteLength
        if (length > maxBytes) {
          await reader.cancel()
          throw new Error(`telegram downloadFile failed: file exceeds ${maxBytes} bytes`)
        }
        chunks.push(next.value)
      }
    } catch (error) {
      const redacted = redactedMessage(error, this.token)
      if (/telegram downloadFile failed:/.test(redacted)) throw new Error(redacted)
      throw new Error(`telegram downloadFile transport error: ${redacted}`)
    } finally {
      reader.releaseLock()
    }
    const data = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { file, data }
  }
}
