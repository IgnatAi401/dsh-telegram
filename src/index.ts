/**
 * Telegram bridge plugin: relays Telegram private chats to DSH sessions
 * through Bot API long polling. Sessions are created, resumed, and switched
 * between models through the Session Controller, so they behave exactly like
 * Web-created sessions and remain visible in the Web UI.
 *
 * The bot token and the allowlist are volatile fields: the configuration page
 * this package's browser half registers on the DSH Plugins page edits them in
 * the profile patch, and the bridge restarts with the new values without a
 * DSH restart. Without a token the plugin stays loaded and idle, so the page
 * stays available to fill it in.
 *
 * @module telegram
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
// Type-only: the `loader/volatile-update` event.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import Schema from '@deepseek-ai/schemastery'
import { TelegramBridge } from './bridge.js'
import type { TelegramBridgeOptions } from './bridge.js'

export * from './bridge.js'
export * from './client.js'

export const name = 'telegram'
export const inject = ['agents', 'attachments', 'llm', 'sessionController', 'systemPrompt', 'workspaceRegistry']

/** Telegram bridge deployment config. */
export interface TelegramConfig extends Omit<TelegramBridgeOptions, 'token' | 'allowedUserIds' | 'allowAllUsers'> {
  /** Bot token, edited on the Plugins page; empty falls back to the `TELEGRAM_BOT_TOKEN` env var. */
  token: Volatile<string | undefined>
  /** Allowed Telegram user ids, edited on the Plugins page; empty falls back to `TELEGRAM_ALLOWED_USER_IDS`. */
  allowedUserIds: Volatile<number[]>
  /** Allow any Telegram user (development only); unset falls back to `TELEGRAM_ALLOW_ALL_USERS`. */
  allowAllUsers?: boolean
}

export const Config = Schema.object({
  // No default: the settings page reports a secret as configured whenever its value is defined.
  token: Schema.string().role('secret').volatile(),
  allowedUserIds: Schema.array(Schema.natural().min(1)).default([]).volatile(),
  allowAllUsers: Schema.boolean(),
  preset: Schema.string().min(1),
  pollingTimeoutSec: Schema.natural().min(1).default(30),
  apiBaseUrl: Schema.string().pattern(/^https?:\/\//),
  resultCacheDirectory: Schema.string().min(1),
})

// Settings from releases before the Plugins page: DSH 0.2.1-rc.2 refuses any `DSH_`-prefixed
// name in a `.env` file, so they use the `TELEGRAM_` prefix; the pre-0.3.2 `DSH_TELEGRAM_`
// names still work when exported.
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

/** Build a bridge from the current settings, or undefined while no token is configured. */
function createBridge(ctx: Context, config: TelegramConfig): TelegramBridge | undefined {
  const token = config.token.get()?.trim() || readEnv(TOKEN_ENV)?.value
  if (!token) {
    ctx.logger.warn('[telegram] no bot token configured; fill it in on the DSH Plugins page (dsh-telegram → telegram)')
    return undefined
  }
  const configured = config.allowedUserIds.get()
  const allowedUserIds = configured.length ? configured : envAllowedUserIds()
  if (!allowedUserIds.length && !config.allowAllUsers) {
    ctx.logger.warn('[telegram] no allowed Telegram user id configured; the bot answers nobody until one is added')
  }
  const allowAllUsers = config.allowAllUsers ?? envAllowAllUsers()
  const { token: _token, allowedUserIds: _ids, ...rest } = config
  return new TelegramBridge(ctx, { ...rest, token, allowedUserIds, allowAllUsers })
}

/**
 * Start the Telegram bridge and restart it whenever the token or allowlist
 * changes. A malformed environment fallback fails loudly at load.
 * @param ctx - Cordis context with the services named by {@link inject}.
 * @param config - deployment config.
 */
export function apply(ctx: Context, config: TelegramConfig): void {
  let bridge: TelegramBridge | undefined
  // Serializes restarts: the old bridge stops polling before the next one starts,
  // since Telegram refuses two concurrent getUpdates calls for one token.
  let pending: Promise<void> = Promise.resolve()
  let disposed = false
  ctx.effect(() => {
    bridge = createBridge(ctx, config)
    bridge?.start()
    return () => {
      disposed = true
      return pending.then(() => bridge?.stop())
    }
  }, 'telegram.serve')
  ctx.on('loader/volatile-update', () => {
    pending = pending.then(async () => {
      await bridge?.stop()
      bridge = undefined
      if (disposed) return
      try {
        bridge = createBridge(ctx, config)
        bridge?.start()
      } catch (error) {
        ctx.logger.error('[telegram] restart failed: %s', error instanceof Error ? error.message : String(error))
      }
    })
  })
}
