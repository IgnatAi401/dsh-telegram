import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TelegramClientLike, TelegramTarget } from './client.js';
/**
 * Shortest time from the start of one draft update to the start of the next.
 * The update in flight already spaces them by a Bot API round trip (about half
 * a second through a distant proxy); a 429 answer backs off further.
 */
export declare const DRAFT_INTERVAL_MS = 600;
/**
 * Draft pacing shared by every turn streaming into one private chat: topics
 * of a chat share Telegram's flood limits, so a 429 holds all of them.
 */
export interface DraftPacing {
    /** Shortest time between the starts of two draft updates of this turn. */
    interval(): number;
    /** Time (ms since epoch) before which no draft of the chat may be sent. */
    holdUntil(): number;
    /** Telegram answered 429: hold every draft of the chat until `until`. */
    flood(until: number): void;
}
/**
 * One turn's Telegram output while it runs. Intermediate assistant messages are
 * sent as temporary real messages, removed once the final message (folded
 * process record plus answer) is delivered; a disposable draft previews only
 * the text being generated. Events mutate bounded state synchronously; a
 * coalescer sends only the latest draft through the bridge's delivery queue.
 * No tool arguments or results are shown.
 */
export declare class TelegramProgress {
    private readonly client;
    private readonly chat;
    /** Aborted when the bridge stops; real messages outlive the turn's draft. */
    private readonly stopSignal;
    private readonly enqueue;
    private readonly warn;
    /** Record a temporary message for removal after final delivery. */
    private readonly track;
    private readonly pacing;
    private draftId;
    /** Every draft id this turn used, so native Stop on any of its previews finds it. */
    private readonly draftIds;
    private readonly started;
    private readonly abort;
    private readonly signal;
    private readonly timer;
    private attempt;
    private revision;
    private text;
    /** The latest message without tool calls, previewed until the turn goes on. */
    private answer;
    private previewOverflow;
    private phase;
    private readonly activeTools;
    private readonly transcript;
    private paused;
    private waitingForUser;
    private disposed;
    private stoppedByUser;
    private scheduled;
    private epoch;
    private dirty;
    private nextSend;
    private lastSent;
    /** Sends the latest text once {@link nextSend} passes, when no new chunk does. */
    private followUp;
    constructor(client: TelegramClientLike, chat: TelegramTarget, 
    /** Aborted when the bridge stops; real messages outlive the turn's draft. */
    stopSignal: AbortSignal, enqueue: (task: () => Promise<void>) => Promise<void>, warn: (error: unknown) => void, 
    /** Record a temporary message for removal after final delivery. */
    track: (messageId: number) => void, pacing?: DraftPacing);
    /** Reject old attempts and revisions, including late chunks after a retry. */
    stream(frame: AssistantStreamFrame): void;
    event(event: SessionEvent): void;
    /** The held answer turned out to be intermediate: the turn went on. */
    private flushAnswer;
    /**
     * Send an intermediate message as a temporary real message. Any bot message
     * clears Telegram's draft, and streaming the same draft_id again replays it
     * from empty, so later previews continue in a fresh draft.
     */
    private publish;
    private newDraft;
    /** Whether `draftId` is one of this turn's previews. */
    hasDraft(draftId: number): boolean;
    /** Whether the turn still streams previews. */
    get live(): boolean;
    private changed;
    /** Invalidate queued previews before a persisted assistant message or user question. */
    pause(): void;
    /** A message sent outside the progress (an Agent widget) cleared the draft; continue in a fresh one. */
    interrupt(): void;
    /** The question message clears the draft; continue in a fresh one afterwards. */
    suspend(): void;
    resume(): void;
    dispose(): void;
    stopByUser(): void;
    /** A terminal message clears a tool-only/failed draft even without an assistant answer. */
    terminalNotice(reason: string): string | undefined;
    /**
     * The complete turn as one rich message: folded intermediate messages, then
     * the answer (or `notice` when the turn produced none). Includes late tool
     * results and reasoning-only turns; `undefined` when nothing was recorded.
     */
    finalMessage(notice?: string): string | undefined;
    private status;
    private schedule;
    /** When the next draft may go out: this turn's own spacing, or the chat's flood hold. */
    private sendAt;
    private preview;
    private send;
}
