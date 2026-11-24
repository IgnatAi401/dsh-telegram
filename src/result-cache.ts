import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { targetChatId, targetThreadId } from './client.js'
import type { TelegramTarget } from './client.js'

/** DSH's own home resolution: blank means unset; `~`, `~/` and `~\` expand. */
export function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return configured === '~' ? homedir()
    : configured.startsWith('~/') || configured.startsWith('~\\') ? join(homedir(), configured.slice(2)) : resolve(configured)
}

/** Bot identity that survives token rotation; never put the token in a file name. */
export function botKey(token: string): string {
  return createHash('sha256').update(token.split(':')[0]!).digest('hex')
}

/** Replace `path` in one step, so a crash never leaves a partly written file. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data, { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** One replaceable complete output per bot/chat (or chat topic); retained for display recovery. */
export class TelegramResultCache {
  private readonly queues = new Map<string, Promise<unknown>>()
  readonly directory: string

  constructor(token: string, directory?: string) {
    this.directory = join(directory ?? join(dshHome(), 'telegram-results'), botKey(token))
  }

  private async exclusive<T>(chat: TelegramTarget, task: () => Promise<T>): Promise<T> {
    const key = this.path(chat)
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    this.queues.set(key, next)
    try { return await next }
    finally { if (this.queues.get(key) === next) this.queues.delete(key) }
  }

  /** `<chat>.json` for a chat, `<chat>-t<topic>.json` for one of its topics. */
  private path(chat: TelegramTarget): string {
    const chatId = targetChatId(chat)
    const threadId = targetThreadId(chat)
    if (!Number.isSafeInteger(chatId) || (threadId !== undefined && !Number.isSafeInteger(threadId))) {
      throw new Error('Invalid Telegram chat id')
    }
    return join(this.directory, threadId === undefined ? `${chatId}.json` : `${chatId}-t${threadId}.json`)
  }

  /** Persist `markdown` before sending it, so a failed or unrendered delivery can be resent. */
  async deliver(chat: TelegramTarget, markdown: string, send: (text: string) => Promise<unknown>): Promise<void> {
    return this.exclusive(chat, async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await writeFileAtomic(this.path(chat), JSON.stringify({ markdown }))
      // API acceptance does not guarantee that a client rendered the message.
      await send(markdown)
    })
  }

  /** Resend the cached output; `false` when this chat has none. */
  async resend(chat: TelegramTarget, send: (text: string) => Promise<unknown>): Promise<boolean> {
    return this.exclusive(chat, async () => {
      let raw: string
      try { raw = await readFile(this.path(chat), 'utf8') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
      const value: unknown = JSON.parse(raw)
      if (typeof value !== 'object' || value === null || !('markdown' in value) || typeof value.markdown !== 'string') {
        throw new Error('Invalid Telegram result cache')
      }
      await send(value.markdown)
      return true
    })
  }
}
