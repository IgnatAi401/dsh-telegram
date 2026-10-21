/**
 * Telegram bridge plugin: relays Telegram private chats to DSH sessions
 * through Bot API long polling. Sessions are created, resumed, and switched
 * between models through the Session Controller, so they behave exactly like
 * Web-created sessions and remain visible in the Web UI.
 *
 * @module telegram
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { TelegramBridgeOptions } from './bridge.js';
export * from './bridge.js';
export * from './client.js';
export declare const name = "telegram";
export declare const inject: string[];
/** Telegram bridge deployment config. */
export interface TelegramConfig extends Omit<TelegramBridgeOptions, 'token' | 'allowedUserIds' | 'allowAllUsers' | 'sendFileRoots'> {
    /** Bot token; empty falls back to the `DSH_TELEGRAM_TOKEN` env var. */
    token?: string;
    /** Allowed Telegram user ids; empty falls back to `DSH_TELEGRAM_ALLOWED_USER_IDS`. */
    allowedUserIds?: number[];
    /** Allow any Telegram user (development only); unset falls back to `DSH_TELEGRAM_ALLOW_ALL_USERS`. */
    allowAllUsers?: boolean;
    /** Extra roots a `[[send: …]]` reply may upload from; the workspace is always allowed. */
    sendFileRoots?: string[];
}
export declare const Config: Schema<TelegramConfig>;
/**
 * Start the Telegram bridge. A missing token fails loudly at load; polling
 * runs for as long as the plugin's fiber lives.
 * @param ctx - Cordis context with the services named by {@link inject}.
 * @param config - deployment config.
 */
export declare function apply(ctx: Context, config: TelegramConfig): void;
