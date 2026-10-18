/**
 * Telegram bridge plugin: relays Telegram private chats to DSH sessions
 * through Bot API long polling. Sessions are created, resumed, and switched
 * between models through the Session Controller, so they behave exactly like
 * Web-created sessions and remain visible in the Web UI.
 *
 * @module telegram
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { TelegramBridge } from './bridge.js'
import type { TelegramBridgeOptions } from './bridge.js'

export * from './bridge.js'
export * from './client.js'

export const name = 'telegram'
export const inject = ['agents', 'attachments', 'llm', 'sessionController', 'systemPrompt', 'workspaceRegistry']

/** Telegram bridge deployment config. */
export interface TelegramConfig extends Omit<TelegramBridgeOptions, 'token' | 'allowedUserIds' | 'allowAllUsers' | 'sendFileRoots'> {
  /** Bot token; empty falls back to the `DSH_TELEGRAM_TOKEN` env var. */
  token?: string
  /** Allowed Telegram user ids; empty falls back to `DSH_TELEGRAM_ALLOWED_USER_IDS`. */
  allowedUserIds?: number[]
  /** Allow any Telegram user (development only); unset falls back to `DSH_TELEGRAM_ALLOW_ALL_USERS`. */
  allowAllUsers?: boolean
  /** Extra roots a `[[send: …]]` reply may upload from; the workspace is always allowed. */
  sendFileRoots?: string[]
}

export const Config: Schema<TelegramConfig> = Schema.object({
  token: Schema.string().default(''),
  allowedUserIds: Schema.array(Schema.natural().min(1)).default([]),
  allowAllUsers: Schema.boolean(),
  preset: Schema.string().min(1),
  pollingTimeoutSec: Schema.natural().min(1).default(30),
  apiBaseUrl: Schema.string().pattern(/^https?:\/\//),
  resultCacheDirectory: Schema.string().min(1),
  sendFileRoots: Schema.array(Schema.string().min(1)).default([]),
})

const ALLOWED_USER_IDS_ENV = 'DSH_TELEGRAM_ALLOWED_USER_IDS'
const ALLOW_ALL_USERS_ENV = 'DSH_TELEGRAM_ALLOW_ALL_USERS'

/** Parse the comma-separated allowlist env var; empty when unset. */
function envAllowedUserIds(): number[] {
  const raw = process.env[ALLOWED_USER_IDS_ENV]?.trim()
  if (raw === undefined || raw === '') return []
  const values = raw.split(',').map(value => value.trim())
  if (values.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    throw new Error(`${ALLOWED_USER_IDS_ENV} must contain comma-separated positive integer user ids`)
  }
  return [...new Set(values.map(Number))]
}

/** Parse the optional open-access environment flag. */
function envAllowAllUsers(): boolean {
  const raw = process.env[ALLOW_ALL_USERS_ENV]
  if (raw === undefined || raw === '' || raw === 'false') return false
  if (raw === 'true') return true
  throw new Error(`${ALLOW_ALL_USERS_ENV} must be "true" or "false"`)
}

/**
 * Start the Telegram bridge. A missing token fails loudly at load; polling
 * runs for as long as the plugin's fiber lives.
 * @param ctx - Cordis context with the services named by {@link inject}.
 * @param config - deployment config.
 */
export function apply(ctx: Context, config: TelegramConfig): void {
  const token = config.token?.trim() || process.env.DSH_TELEGRAM_TOKEN?.trim()
  if (!token) throw new Error('telegram: missing bot token (set config.token or DSH_TELEGRAM_TOKEN)')
  const allowedUserIds = config.allowedUserIds?.length ? config.allowedUserIds : envAllowedUserIds()
  const allowAllUsers = config.allowAllUsers ?? envAllowAllUsers()
  const bridge = new TelegramBridge(ctx, { ...config, token, allowedUserIds, allowAllUsers })
  ctx.effect(() => {
    bridge.start()
    return () => bridge.stop()
  }, 'telegram.serve')
}
