import type { TelegramTarget } from './client.js';
/** DSH's own home resolution: blank means unset; `~`, `~/` and `~\` expand. */
export declare function dshHome(): string;
/** Bot identity that survives token rotation; never put the token in a file name. */
export declare function botKey(token: string): string;
/** Replace `path` in one step, so a crash never leaves a partly written file. */
export declare function writeFileAtomic(path: string, data: string): Promise<void>;
/** One replaceable complete output per bot/chat (or chat topic); retained for display recovery. */
export declare class TelegramResultCache {
    private readonly queues;
    readonly directory: string;
    constructor(token: string, directory?: string);
    private exclusive;
    /** `<chat>.json` for a chat, `<chat>-t<topic>.json` for one of its topics. */
    private path;
    /** Persist `markdown` before sending it, so a failed or unrendered delivery can be resent. */
    deliver(chat: TelegramTarget, markdown: string, send: (text: string) => Promise<unknown>): Promise<void>;
    /** Resend the cached output; `false` when this chat has none. */
    resend(chat: TelegramTarget, send: (text: string) => Promise<unknown>): Promise<boolean>;
}
