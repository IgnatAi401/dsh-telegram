/**
 * Which DSH session each Telegram chat (or chat topic) is bound to, kept in
 * DSH_HOME so a restart resumes the conversation. Only the session id is
 * stored for a live session: its workspace is read from the Workspace registry
 * on restore. The workspace id is kept only as a hint for when the session is
 * gone, so a topic can offer a new session in the same workspace.
 * @module telegram/bindings
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { targetChatId, targetThreadId } from './client.js'
import type { TelegramBotSettings, TelegramTarget } from './client.js'
import { botKey, dshHome, writeFileAtomic } from './result-cache.js'

/** One stored binding. */
export interface TelegramBinding {
  readonly chatId: number
  /** Absent for the main chat (no topic). */
  readonly threadId?: number
  readonly sessionId: string
  /** The session's workspace when it was bound; used only once the session is gone. */
  readonly workspaceId?: string
}

interface BindingFile {
  readonly version: 1
  readonly bindings: readonly TelegramBinding[]
  /**
   * Present while the bridge has private-chat topics switched on: the bot's
   * topic settings from before, restored when topic mode is turned off.
   */
  readonly topicSettings?: TelegramBotSettings
}

const TOPIC_SETTING_KEYS = ['has_topics_enabled', 'allows_users_to_create_topics', 'has_topic_sidebar'] as const

/** The boolean topic settings of `value`, ignoring everything else. */
export function topicSettingsOf(value: unknown): TelegramBotSettings {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return Object.fromEntries(TOPIC_SETTING_KEYS.flatMap(key => typeof record[key] === 'boolean' ? [[key, record[key]]] : []))
}

/** Map key of a chat or one of its topics: `7` or `7:12`. */
export function targetKey(target: TelegramTarget): string {
  const threadId = targetThreadId(target)
  return threadId === undefined ? String(targetChatId(target)) : `${targetChatId(target)}:${threadId}`
}

function validBinding(value: unknown): value is TelegramBinding {
  const entry = value as Partial<TelegramBinding> | null
  return typeof entry === 'object' && entry !== null
    && Number.isSafeInteger(entry.chatId)
    && (entry.threadId === undefined || Number.isSafeInteger(entry.threadId))
    && typeof entry.sessionId === 'string' && entry.sessionId !== ''
    && (entry.workspaceId === undefined || typeof entry.workspaceId === 'string')
}

/**
 * The bindings of one bot, as a JSON file written atomically (temporary file,
 * then rename). Writes are serialized and always store the latest state.
 */
export class TelegramBindingStore {
  readonly path: string
  private readonly bindings = new Map<string, TelegramBinding>()
  private savedTopicSettings: TelegramBotSettings | undefined
  private writing: Promise<void> = Promise.resolve()

  /** @param path - the file; defaults to DSH_HOME/telegram-bindings/<bot>.json. */
  constructor(token: string, path?: string) {
    this.path = path ?? join(dshHome(), 'telegram-bindings', `${botKey(token)}.json`)
  }

  /** Read the stored bindings; a missing file means none. Invalid entries are skipped. */
  async load(): Promise<TelegramBinding[]> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const value = JSON.parse(raw) as Partial<BindingFile> | null
    const entries = Array.isArray(value?.bindings) ? value.bindings.filter(validBinding) : []
    this.savedTopicSettings = typeof value?.topicSettings === 'object' && value.topicSettings !== null
      ? topicSettingsOf(value.topicSettings) : undefined
    this.bindings.clear()
    for (const entry of entries) {
      const binding: TelegramBinding = {
        chatId: entry.chatId,
        ...(entry.threadId === undefined ? {} : { threadId: entry.threadId }),
        sessionId: entry.sessionId,
        ...(entry.workspaceId === undefined ? {} : { workspaceId: entry.workspaceId }),
      }
      this.bindings.set(targetKey(binding), binding)
    }
    return [...this.bindings.values()]
  }

  /** Bind `target` to `sessionId` of `workspaceId`; resolves once the file is written. */
  set(target: TelegramTarget, sessionId: string, workspaceId?: string): Promise<void> {
    const threadId = targetThreadId(target)
    const binding: TelegramBinding = {
      chatId: targetChatId(target),
      ...(threadId === undefined ? {} : { threadId }),
      sessionId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    }
    const key = targetKey(binding)
    const previous = this.bindings.get(key)
    if (previous?.sessionId === sessionId && previous.workspaceId === workspaceId) return this.writing
    this.bindings.set(key, binding)
    return this.save()
  }

  /** Forget `target`'s binding, if it is still bound to `sessionId` (or any session when omitted). */
  delete(target: TelegramTarget, sessionId?: string): Promise<void> {
    const key = targetKey(target)
    const previous = this.bindings.get(key)
    if (previous === undefined || (sessionId !== undefined && previous.sessionId !== sessionId)) return this.writing
    this.bindings.delete(key)
    return this.save()
  }

  /** The bot's topic settings from before topic mode, while it is on; see {@link BindingFile.topicSettings}. */
  get topicSettings(): TelegramBotSettings | undefined {
    return this.savedTopicSettings
  }

  /** Remember (or, with `undefined`, forget) the settings to restore; resolves once written. */
  setTopicSettings(settings: TelegramBotSettings | undefined): Promise<void> {
    this.savedTopicSettings = settings === undefined ? undefined : topicSettingsOf(settings)
    return this.save()
  }

  /** Wait for pending writes. */
  flush(): Promise<void> {
    return this.writing
  }

  private save(): Promise<void> {
    this.writing = this.writing.catch(() => {}).then(async () => {
      // Each write takes the state at its turn, so the last one always wins.
      const file: BindingFile = {
        version: 1,
        bindings: [...this.bindings.values()],
        ...(this.savedTopicSettings === undefined ? {} : { topicSettings: this.savedTopicSettings }),
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`)
    })
    return this.writing
  }
}
