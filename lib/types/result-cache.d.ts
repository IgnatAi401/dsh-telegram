/** One replaceable complete output per bot/chat; retained for display recovery. */
export declare class TelegramResultCache {
    private readonly queues;
    readonly directory: string;
    constructor(token: string, directory?: string);
    private exclusive;
    private path;
    /** Persist `markdown` before sending it, so a failed or unrendered delivery can be resent. */
    deliver(chatId: number, markdown: string, send: (text: string) => Promise<unknown>): Promise<void>;
    /** Resend the cached output; `false` when this chat has none. */
    resend(chatId: number, send: (text: string) => Promise<unknown>): Promise<boolean>;
}
