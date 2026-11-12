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
    /** Serialize background refreshes and navigation through the same per-chat queue. */
    private readonly menuUpdates;
    /** Chats whose `/compact` is still summarizing; native Stop aborts it. */
    private readonly compacting;
    /** Work started off the polling loop; `stop` waits for it. */
    private readonly backgroundTasks;
    private readonly abortController;
    private readonly disposers;
    /** `telegram_widget` registrations in the scope of each Agent of a bound session. */
    private readonly widgetTools;
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
    /** Report the figures the Web composer shows for the current session. */
    private sendStats;
    /** Check `/compact` preconditions, then summarize off the polling loop: the summary is a model call. */
    private startCompaction;
    /**
     * Manual compaction through `ctx.compaction`, the service behind the Web `/compact`
     * command. A refreshed rich draft shows progress; the result follows as one message
     * with the summary folded.
     */
    private runCompaction;
    /** Best-effort context occupancy after a compaction. */
    private contextOccupancyOf;
    /** Bind taps to the state shown, so an old panel cannot act on a newer selection. */
    private menuFingerprint;
    private handleMenuTap;
    /** Draw a menu page, telling the user when even that fails. */
    private showMenu;
    /** Redraw the chat's open menu after its task state changed; never opens a new one. */
    private refreshMenu;
    /** Keep Telegram writes and their action bindings in the same order. */
    private updateMenu;
    /**
     * Draw one menu page into the chat's panel widget, sending the widget when
     * `messageId` is missing. Taps capture stable ids, never live catalog positions.
     * @param resend - send a new panel when the old message is gone.
     */
    private renderMenu;
    /** Replace a widget's state; an unchanged or deleted panel is not an error. */
    private editWidget;
    private findModel;
    /**
     * Workspaces in registry order with their sessions' list metadata. Like the Web sidebar,
     * a blank session (no turn yet) is listed only while it is this chat's current session.
     */
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
    /**
     * Register `telegram_widget` in the Agent's own scope, so only sessions bound
     * to a Telegram chat see it. A failure leaves the channel without the tool.
     */
    private ensureWidgetTool;
    /** Remove the tool from the Agents of a session that lost its chat. */
    private dropWidgetTools;
    private widgetChat;
    /** Run one Telegram call in the chat's delivery order and hand back its outcome. */
    private inChatOrder;
    /** Send the Agent's own widget code; it stays in the chat after the turn. */
    private sendAgentWidget;
    private updateAgentWidget;
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
    /** Reuse question delivery and lifecycle, but grant only an explicit tap on "allow". */
    private approveThroughTelegram;
    /** Claim one DSH user-question request for the chat bound to its session. */
    private askThroughTelegram;
    /**
     * A timed wait expired: the tool call returns "pending" and the Agent keeps
     * working, while the question stays answerable here. The finished answer is
     * steered in through `userQuestions.answer`.
     */
    private continueTimedQuestion;
    /** Inline keyboards belong to panels sent before the widget redesign; nothing uses them now. */
    private handleCallbackQuery;
    /**
     * Handle one tap inside a panel widget. The answer is sent after the handler
     * has changed the panel, so the widget unlocks its buttons on the new state;
     * a slow action is answered early, since Telegram allows 15 seconds.
     */
    private handleWidgetQuery;
    /** Route one panel tap to the menu or to the waiting question. */
    private handleInteraction;
    /**
     * Send the current item: its text as a rich message, then the panel widget
     * with its controls. A widget's state is too small for the question itself
     * and cannot render rich text.
     */
    private presentQuestion;
    /** The controls for the current item: an approval, a choice, or "send a message". */
    private questionPanel;
    /** The question as a rich message; option descriptions too long for the panel are spelled out here. */
    private formatQuestion;
    /** Store one answer, then present the next question or complete the batch. */
    private submitQuestionAnswer;
    private currentQuestion;
    /** Abort question delivery when either the bridge or a still-open DSH request ends. */
    private questionSignal;
    private selectedLabels;
    /** Redraw the panel after a toggle or a switch to or from the custom answer. */
    private refreshQuestionPanel;
    /** Replace the controls with the outcome, so the panel cannot answer twice. */
    private closeQuestionPanel;
    private resolvePendingQuestion;
    private rejectPendingQuestion;
    /** Atomically remove a pending request and its abort listener. */
    private settlePendingQuestion;
    /** Question/answer messages are removed with the turn, unless the question outlives it. */
    private trackQuestionMessage;
    private handleSessionEvent;
    /**
     * Cache, then send the complete turn; a failure leaves the cache for `/resend`.
     * `markdown` is the plain text, with placeholders for local media. `embedded`
     * carries the text with `tg://` links and its uploads; if Telegram refuses it,
     * the plain text is sent and the caller sends the files separately.
     */
    private deliverResult;
    /**
     * Local images the result places in its text, resolved against the Session cwd.
     * Returns the text with `tg://` links, the plain text with placeholders, and the
     * checked files; unusable sources become placeholders in both and notice lines.
     */
    private inlineMedia;
    /** Keep presented files that Telegram can accept; the others become notice lines. */
    private checkFiles;
    /** Upload files as separate documents; skipped or failed files share one notice. */
    private sendDocuments;
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
