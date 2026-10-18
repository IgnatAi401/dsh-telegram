/**
 * Telegram→DSH bridge: owns the long-polling loop, the chat→session binding,
 * slash commands and menus, and delivery of each turn back to Telegram.
 * Sessions are created, resumed and configured through the Session
 * Controller, so Telegram and Web share sessions, models and presets.
 * @module telegram/bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TelegramClientLike } from './client.js';
/** Options for {@link TelegramBridge}. */
export interface TelegramBridgeOptions {
    /** Bot token from @BotFather. */
    token: string;
    /** User ids allowed to talk to the bot; empty means none unless `allowAllUsers`. */
    allowedUserIds?: readonly number[];
    /** Allow any Telegram user (development only). */
    allowAllUsers?: boolean;
    /** Agent preset for sessions created from Telegram; omitted uses the DSH default preset. */
    preset?: string;
    /** Long-polling timeout in seconds. */
    pollingTimeoutSec?: number;
    /** Bot API server; a self-hosted `telegram-bot-api` server lifts the 20 MiB download limit. */
    apiBaseUrl?: string;
    /** Result cache root; defaults to DSH_HOME/telegram-results. */
    resultCacheDirectory?: string;
    /** Client seam; tests substitute a fake. */
    client?: TelegramClientLike;
    /** Delay seam; tests substitute an instant sleep. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
/**
 * Bridge between Telegram private chats and DSH sessions. One session per
 * chat; incoming content becomes a user message, and each turn is delivered
 * back as one native rich Telegram message. Agents belong to DSH, so
 * {@link TelegramBridge.stop} only releases Telegram state.
 */
export declare class TelegramBridge {
    private readonly ctx;
    private readonly client;
    private readonly allowedUserIds;
    private readonly allowAllUsers;
    private readonly preset;
    private readonly sleep;
    private readonly resultCache;
    private readonly chats;
    private readonly chatsBySession;
    private readonly collections;
    /** Human-input requests keyed by Telegram chat id; at most one per chat. */
    private readonly pendingQuestions;
    private readonly menus;
    private readonly abortController;
    private readonly disposers;
    private offset;
    private started;
    private stopped;
    private pollTask;
    private commandTask;
    private stopTask;
    /**
     * @param ctx - Cordis context providing the services the plugin injects.
     * @param options - bridge options.
     */
    constructor(ctx: Context, options: TelegramBridgeOptions);
    /** Register DSH listeners, publish the command list, and start polling. */
    start(): void;
    /** Stop polling and release Telegram state; DSH sessions and Agents keep running. */
    stop(): Promise<void>;
    private stopImpl;
    /** Publish the slash-command list so Telegram's `/` menu matches the bot. */
    private registerCommands;
    private pollLoop;
    private authorizedUser;
    private handleUpdate;
    /** Route chat input to a waiting question; returns false when the message is an ordinary command. */
    private handleQuestionInput;
    private handleCommand;
    /** Native Stop: cancel the running turn and any question it is waiting on. */
    private stopCurrentTask;
    /** Bind callbacks to the state shown, so an old button cannot act on a newer selection. */
    private menuFingerprint;
    private handleMenuCallback;
    /** Render one menu page; callbacks capture stable ids, never live catalog positions. */
    private showMenu;
    private findModel;
    /** Workspaces in registry order with their sessions' list metadata. */
    private loadCatalog;
    /** Read one session's model route (falling back to the DSH default) and title. */
    private sessionStatus;
    private stateFor;
    /** The chat bound to an Agent's session, if any. */
    private boundChat;
    /** Resolve the live Agent through the Session Controller, resuming a cold session. */
    private resolveAgent;
    /** Create a session in `workspace` exactly as Web does and bind this chat to it. */
    private createSession;
    /** Bind this chat to an existing session, unarchiving it first when needed. */
    private openSession;
    private bind;
    /** Forget the Telegram binding; the DSH session and its Agent are unaffected. */
    private releaseActive;
    /** Archive through the Workspace registry, then release the Telegram selection. */
    private archiveCurrent;
    /** Return only a collection that still belongs to the active session. */
    private collectionFor;
    /** Replace the previous collection notice only after its successor was sent. */
    private sendCollectionStatus;
    private collectionStatus;
    /** Explicit `/followup`: queue one message, or submit the active collection as a later turn. */
    private handleFollowupMessage;
    /** Add one Telegram message and its reply context to an explicit collection. */
    private addToCollection;
    /** Submit and clear one collection only after DSH has accepted it. */
    private submitCollection;
    /** Build and submit one ordinary Telegram message. */
    private submitTelegramMessage;
    /**
     * Preserve Telegram reply semantics inside the same user message: quoted
     * text is explicitly delimited and quoted media stays adjacent to it.
     */
    private telegramMessageParts;
    /** Download the message's image into the workspace or its document into DSH attachments. */
    private mediaParts;
    /** Photos and declared raster documents go through the image pipeline. */
    private imageCandidate;
    /** Download, verify, and save one image beneath the selected workspace. */
    private downloadWorkspaceImage;
    /** Create an exclusive file under `<workspace>/telegram-downloads` without following an escaping directory link. */
    private saveWorkspaceFile;
    /** Admit collected images, preserve part order, then steer a running turn or queue a follow-up. */
    private submitParts;
    /** Reuse question delivery and lifecycle, but grant only an explicit approval button. */
    private approveThroughTelegram;
    /** Claim one DSH user-question request for the chat bound to its session. */
    private askThroughTelegram;
    /**
     * A timed wait expired: the tool call returns "pending" and the Agent keeps
     * working, while the question stays answerable here. The finished answer is
     * steered in through `userQuestions.answer`.
     */
    private continueTimedQuestion;
    /** Handle one inline-keyboard choice and always dismiss Telegram's callback spinner. */
    private handleCallbackQuery;
    /** Send the current item with buttons, or with a ForceReply composer for free text. */
    private presentQuestion;
    /** Render a question with all details visible even when button labels must be shortened. */
    private formatQuestion;
    /** Build the current keyboard; multi-select choices show their checked state. */
    private questionKeyboard;
    /** Enter free-text mode after the user explicitly presses the custom-answer button. */
    private requestCustomAnswer;
    /** Store one answer, then present the next question or complete the batch. */
    private submitQuestionAnswer;
    private currentQuestion;
    /** Abort question delivery when either the bridge or a still-open DSH request ends. */
    private questionSignal;
    private selectedLabels;
    /** Update checkmarks after toggling a multi-select option. */
    private refreshQuestionKeyboard;
    /** Remove an old keyboard so it cannot submit an answer twice. */
    private clearQuestionKeyboard;
    private editKeyboard;
    private resolvePendingQuestion;
    private rejectPendingQuestion;
    /** Atomically remove a pending request and its abort listener. */
    private settlePendingQuestion;
    /** Question/answer messages are removed with the turn, unless the question outlives it. */
    private trackQuestionMessage;
    private handleSessionEvent;
    /** Cache, then send the complete turn; a failure leaves the cache for `/resend`. */
    private deliverResult;
    /**
     * Upload every `[[send: …]]` path that resolves inside the chat's workspace.
     * Paths are re-resolved through `realpath`, so a symlink cannot widen the upload
     * beyond the workspace the model was told about.
     * @returns Markdown notices for the paths that were not sent.
     */
    private sendWorkspaceFiles;
    /** Serialize per-chat Telegram side effects; they never interleave. */
    private enqueue;
    /** Delete messages in Bot API batches. */
    private deleteMessageIds;
    /** Keep Telegram's typing indicator alive while a turn runs (the action expires after ~5s). */
    private startTyping;
    private stopTyping;
    /** Callback acknowledgements are best-effort but never omitted. */
    private safeAnswerCallback;
    /** Fixed notices use the same native Rich Markdown transport as assistant replies. */
    private safeSend;
    private safeAction;
}
