import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as telegram from '../src/index.ts'
import type { TelegramClientLike } from '../src/client.ts'

/**
 * Mount the real namespace plugin on a real Context with its injected DSH
 * services stubbed and a fake client seam. Covers mount/poll/dispose and the
 * environment fallbacks; message flow is covered by the bridge unit tests.
 */

async function waitFor<T>(get: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function fakeClient(): TelegramClientLike & { polls: number } {
  const message = { message_id: 1, chat: { id: 7, type: 'private' }, date: 0 }
  const client = {
    polls: 0,
    async sendRichMessageDraft() { return true },
    async sendRichMessage() { return message },
    async editRichMessage() { return message },
    async getUpdates() {
      client.polls += 1
      return []
    },
    async sendChatAction() { return true },
    async setMyCommands() { return true },
    async editMessageReplyMarkup() { return message },
    async answerCallbackQuery() { return true },
    async deleteMessages() { return true },
    async downloadFile(fileId: string) {
      return { file: { file_id: fileId, file_unique_id: fileId }, data: new Uint8Array() }
    },
  }
  return client
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function contextWithServices(): { ctx: Context; prompts: string[] } {
  const ctx = new Context()
  const prompts: string[] = []
  ctx.provide('agents', { get() { return undefined } } as unknown as Context['agents'])
  ctx.provide('attachments', {} as Context['attachments'])
  ctx.provide('llm', {} as Context['llm'])
  ctx.provide('sessionController', {} as Context['sessionController'])
  ctx.provide('systemPrompt', {
    context({ name }: { name: string }) {
      prompts.push(name)
      return () => { prompts.splice(prompts.indexOf(name), 1) }
    },
  } as unknown as Context['systemPrompt'])
  ctx.provide('workspaceRegistry', {} as Context['workspaceRegistry'])
  return { ctx, prompts }
}

/** Run `task` with environment variables temporarily replaced. */
async function withEnv(values: Record<string, string>, task: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  try {
    await task()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('dsh-telegram plugin apply', () => {
  it('polls through the client seam, registers the channel prompt, and disposes cleanly', async () => {
    const client = fakeClient()
    const { ctx, prompts } = contextWithServices()
    await ctx.plugin(telegram, { token: 'test-token', client, sleep })
    await waitFor(() => client.polls > 0 ? true : undefined, 'first poll')
    expect(prompts).toEqual(['telegram:channel'])
    await ctx.fiber.dispose()
    const pollsAfterDispose = client.polls
    await sleep(25)
    expect(client.polls).toBe(pollsAfterDispose)
    expect(prompts).toEqual([])
  })

  it('fails loudly at load when the token is missing', async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: '', DSH_TELEGRAM_TOKEN: '' }, async () => {
      await expect(contextWithServices().ctx.plugin(telegram, {})).rejects.toThrow('missing bot token')
    })
  })

  it('falls back to the TELEGRAM_BOT_TOKEN environment variable', async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: 'env-token' }, async () => {
      const client = fakeClient()
      const { ctx } = contextWithServices()
      await ctx.plugin(telegram, { client, sleep })
      await waitFor(() => client.polls > 0 ? true : undefined, 'first poll')
      await ctx.fiber.dispose()
    })
  })

  it('still accepts the legacy DSH_TELEGRAM_TOKEN when exported', async () => {
    await withEnv({ TELEGRAM_BOT_TOKEN: '', DSH_TELEGRAM_TOKEN: 'legacy-token' }, async () => {
      const client = fakeClient()
      const { ctx } = contextWithServices()
      await ctx.plugin(telegram, { client, sleep })
      await waitFor(() => client.polls > 0 ? true : undefined, 'first poll')
      await ctx.fiber.dispose()
    })
  })

  it('reads the allowlist from TELEGRAM_ALLOWED_USER_IDS and rejects malformed values', async () => {
    await withEnv({ TELEGRAM_ALLOWED_USER_IDS: '111, 222' }, async () => {
      const { ctx } = contextWithServices()
      await ctx.plugin(telegram, { token: 'test-token', client: fakeClient(), sleep })
      await ctx.fiber.dispose()
    })
    await withEnv({ TELEGRAM_ALLOWED_USER_IDS: '111,not-a-user' }, async () => {
      await expect(contextWithServices().ctx.plugin(telegram, { token: 'test-token', client: fakeClient() }))
        .rejects.toThrow('TELEGRAM_ALLOWED_USER_IDS must contain comma-separated positive integer')
    })
    await withEnv({ TELEGRAM_ALLOWED_USER_IDS: '', DSH_TELEGRAM_ALLOWED_USER_IDS: 'bad' }, async () => {
      await expect(contextWithServices().ctx.plugin(telegram, { token: 'test-token', client: fakeClient() }))
        .rejects.toThrow('DSH_TELEGRAM_ALLOWED_USER_IDS must contain')
    })
  })

  it('lets explicit allowAllUsers false bypass the environment fallback', async () => {
    await withEnv({ TELEGRAM_ALLOW_ALL_USERS: 'not-a-boolean' }, async () => {
      const { ctx } = contextWithServices()
      await ctx.plugin(telegram, { token: 'test-token', allowAllUsers: false, client: fakeClient(), sleep })
      await ctx.fiber.dispose()
      await expect(contextWithServices().ctx.plugin(telegram, { token: 'test-token', client: fakeClient() }))
        .rejects.toThrow('"true" or "false"')
    })
  })
})
