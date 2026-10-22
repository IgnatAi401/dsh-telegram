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
export interface TelegramConfig extends Omit<TelegramBridgeOptions, 'token' | 'allowedUserIds' | 'allowAllUsers'> {
  /** Bot token; empty falls back to the `TELEGRAM_BOT_TOKEN` env var. */
  token?: string
  /** Allowed Telegram user ids; empty falls back to `TELEGRAM_ALLOWED_USER_IDS`. */
  allowedUserIds?: number[]
  /** Allow any Telegram user (development only); unset falls back to `TELEGRAM_ALLOW_ALL_USERS`. */
  allowAllUsers?: boolean
}

export const Config: Schema<TelegramConfig> = Schema.object({
  token: Schema.string().default(''),
  allowedUserIds: Schema.array(Schema.natural().min(1)).default([]),
  allowAllUsers: Schema.boolean(),
  preset: Schema.string().min(1),
  pollingTimeoutSec: Schema.natural().min(1).default(30),
  apiBaseUrl: Schema.string().pattern(/^https?:\/\//),
  resultCacheDirectory: Schema.string().min(1),
})

// DSH 0.2.1-rc.2 refuses any `DSH_`-prefixed name in a `.env` file, so the settings use the
// `TELEGRAM_` prefix; the pre-0.3.2 `DSH_TELEGRAM_` names still work when exported.
const TOKEN_ENV = ['TELEGRAM_BOT_TOKEN', 'DSH_TELEGRAM_TOKEN']
const ALLOWED_USER_IDS_ENV = ['TELEGRAM_ALLOWED_USER_IDS', 'DSH_TELEGRAM_ALLOWED_USER_IDS']
const ALLOW_ALL_USERS_ENV = ['TELEGRAM_ALLOW_ALL_USERS', 'DSH_TELEGRAM_ALLOW_ALL_USERS']

/** Read the first non-empty variable among a setting's current and legacy names. */
function readEnv(names: string[]): { name: string, value: string } | undefined {
  for (const candidate of names) {
    const value = process.env[candidate]?.trim()
    if (value) return { name: candidate, value }
  }
}

/** Parse the comma-separated allowlist env var; empty when unset. */
function envAllowedUserIds(): number[] {
  const env = readEnv(ALLOWED_USER_IDS_ENV)
  if (env === undefined) return []
  const values = env.value.split(',').map(value => value.trim())
  if (values.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    throw new Error(`${env.name} must contain comma-separated positive integer user ids`)
  }
  return [...new Set(values.map(Number))]
}

/** Parse the optional open-access environment flag. */
function envAllowAllUsers(): boolean {
  const env = readEnv(ALLOW_ALL_USERS_ENV)
  if (env === undefined || env.value === 'false') return false
  if (env.value === 'true') return true
  throw new Error(`${env.name} must be "true" or "false"`)
}

/**
 * Start the Telegram bridge. A missing token fails loudly at load; polling
 * runs for as long as the plugin's fiber lives.
 * @param ctx - Cordis context with the services named by {@link inject}.
 * @param config - deployment config.
 */
export function apply(ctx: Context, config: TelegramConfig): void {
  const token = config.token?.trim() || readEnv(TOKEN_ENV)?.value
  if (!token) throw new Error(`telegram: missing bot token (set config.token or ${TOKEN_ENV[0]})`)
  const allowedUserIds = config.allowedUserIds?.length ? config.allowedUserIds : envAllowedUserIds()
  const allowAllUsers = config.allowAllUsers ?? envAllowAllUsers()
  const bridge = new TelegramBridge(ctx, { ...config, token, allowedUserIds, allowAllUsers })
  ctx.effect(() => {
    bridge.start()
    return () => bridge.stop()
  }, 'telegram.serve')
}
