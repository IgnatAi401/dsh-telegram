/**
 * Which DSH session each Telegram chat (or chat topic) is bound to, kept in
 * DSH_HOME so a restart resumes the conversation. Only the session id is
 * stored: its workspace is read from the Workspace registry on restore.
 * @module telegram/bindings
 */
import type { TelegramBotSettings, TelegramTarget } from './client.js';
/** One stored binding. */
export interface TelegramBinding {
    readonly chatId: number;
    /** Absent for the main chat (no topic). */
    readonly threadId?: number;
    readonly sessionId: string;
}
/** The boolean topic settings of `value`, ignoring everything else. */
export declare function topicSettingsOf(value: unknown): TelegramBotSettings;
/** Map key of a chat or one of its topics: `7` or `7:12`. */
export declare function targetKey(target: TelegramTarget): string;
/**
 * The bindings of one bot, as a JSON file written atomically (temporary file,
 * then rename). Writes are serialized and always store the latest state.
 */
export declare class TelegramBindingStore {
    readonly path: string;
    private readonly bindings;
    private savedTopicSettings;
    private writing;
    /** @param path - the file; defaults to DSH_HOME/telegram-bindings/<bot>.json. */
    constructor(token: string, path?: string);
    /** Read the stored bindings; a missing file means none. Invalid entries are skipped. */
    load(): Promise<TelegramBinding[]>;
    /** Bind `target` to `sessionId`; resolves once the file is written. */
    set(target: TelegramTarget, sessionId: string): Promise<void>;
    /** Forget `target`'s binding, if it is still bound to `sessionId` (or any session when omitted). */
    delete(target: TelegramTarget, sessionId?: string): Promise<void>;
    /** The bot's topic settings from before topic mode, while it is on; see {@link BindingFile.topicSettings}. */
    get topicSettings(): TelegramBotSettings | undefined;
    /** Remember (or, with `undefined`, forget) the settings to restore; resolves once written. */
    setTopicSettings(settings: TelegramBotSettings | undefined): Promise<void>;
    /** Wait for pending writes. */
    flush(): Promise<void>;
    private save;
}
