/**
 * The `telegram_widget` tool: lets the Agent send its own Bot API 10.4 widget
 * (`sendWidget`) into the bound private chat and later replace that widget's
 * chat state (`editMessageWidgetData`). It is registered only in the scope of
 * Agents whose session is bound to a Telegram chat, so other sessions never
 * see it.
 *
 * Agent widgets are self-contained: they are sent without `allow_queries`, so
 * `TelegramWidget.request` is refused by Telegram and taps never reach the
 * bridge; answers from the user still go through `ask_user_question`.
 * @module telegram/widget
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
export declare const WIDGET_TOOL_NAME = "telegram_widget";
/** Bot API 10.4 limits for one widget. */
export declare const MAX_WIDGET_HTML_BYTES = 32768;
export declare const MAX_WIDGET_COMPRESSED_BYTES = 4096;
export declare const MAX_WIDGET_DATA_BYTES = 1024;
export declare const MAX_WIDGET_CAPTION_LENGTH = 1024;
/** A validated `send` call. */
export interface WidgetSendRequest {
    readonly action: 'send';
    readonly html: string;
    readonly caption: string;
    readonly data?: string;
    readonly width?: number;
    readonly height?: number;
}
/** A validated `update` call. */
export interface WidgetUpdateRequest {
    readonly action: 'update';
    readonly messageId: number;
    /** Replacement chat state; empty clears it (the widget then reads `null`). */
    readonly data: string;
}
export type WidgetRequest = WidgetSendRequest | WidgetUpdateRequest;
/** What the bridge does for a call made by `agent`. */
export interface WidgetToolHandlers {
    send(agent: unknown, request: WidgetSendRequest, signal: AbortSignal): Promise<number>;
    update(agent: unknown, request: WidgetUpdateRequest, signal: AbortSignal): Promise<void>;
}
/** Thrown for arguments the model can fix; the message is shown to it as the tool error. */
export declare class WidgetArgsError extends Error {
}
/**
 * Validate one call against the Bot API 10.4 limits before anything is sent,
 * so the model gets an actionable error instead of a Telegram refusal.
 * @throws {WidgetArgsError} for arguments outside the limits.
 */
export declare function parseWidgetArgs(args: unknown): WidgetRequest;
/**
 * Build the tool definition; `handlers` do the Telegram side effects for the
 * calling Agent and throw when its session is no longer bound to a chat.
 */
export declare function widgetToolDefinition(handlers: WidgetToolHandlers): ToolDefinition;
/** Channel-prompt guidance; kept next to the tool so its rules match the limits above. */
export declare const WIDGET_PROMPT_LINES: string[];
