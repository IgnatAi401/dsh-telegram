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
import type { Context, Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { TelegramBridgeOptions } from './bridge.js';
export * from './bridge.js';
export * from './client.js';
export declare const name = "telegram";
export declare const inject: string[];
/** Telegram bridge deployment config. */
export interface TelegramConfig extends Omit<TelegramBridgeOptions, 'token' | 'allowedUserIds' | 'allowAllUsers'> {
    /** Bot token, edited on the Plugins page; empty falls back to the `TELEGRAM_BOT_TOKEN` env var. */
    token: Volatile<string | undefined>;
    /** Allowed Telegram user ids, edited on the Plugins page; empty falls back to `TELEGRAM_ALLOWED_USER_IDS`. */
    allowedUserIds: Volatile<number[]>;
    /** Allow any Telegram user (development only); unset falls back to `TELEGRAM_ALLOW_ALL_USERS`. */
    allowAllUsers?: boolean;
}
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    token: Schema<string, string, "volatile">;
    allowedUserIds: Schema<NoInfer<number[]>, NoInfer<number[]>, "volatile-defined">;
    allowAllUsers: Schema<boolean, boolean, "plain">;
    preset: Schema<string, string, "plain">;
    pollingTimeoutSec: Schema<number, number, "defined">;
    apiBaseUrl: Schema<string, string, "plain">;
    resultCacheDirectory: Schema<string, string, "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    token: Schema<string, string, "volatile">;
    allowedUserIds: Schema<NoInfer<number[]>, NoInfer<number[]>, "volatile-defined">;
    allowAllUsers: Schema<boolean, boolean, "plain">;
    preset: Schema<string, string, "plain">;
    pollingTimeoutSec: Schema<number, number, "defined">;
    apiBaseUrl: Schema<string, string, "plain">;
    resultCacheDirectory: Schema<string, string, "plain">;
}>>, "plain">;
/**
 * Start the Telegram bridge and restart it whenever the token or allowlist
 * changes. A malformed environment fallback fails loudly at load.
 * @param ctx - Cordis context with the services named by {@link inject}.
 * @param config - deployment config.
 */
export declare function apply(ctx: Context, config: TelegramConfig): void;
