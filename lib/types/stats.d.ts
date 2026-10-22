/**
 * `/stats` report: the figures behind the DSH Web composer's statistics pills
 * and context meter, read from the session's `sessionStats`, `tokenUsage`,
 * `contextPressure` and `contextBreakdown` projections. Those projection keys
 * belong to DSH packages outside this plugin's peers, so values are checked
 * here and a missing or malformed one only drops its section.
 * @module telegram/stats
 */
/** Whole-log counts and wall times (`@deepseek-ai/dsh-session-stats`). */
export interface SessionStatsValue {
    readonly turns: number;
    readonly steps: number;
    readonly llmMs: number;
    readonly toolMs: number;
    readonly ttftMs: number;
    readonly ttftSteps: number;
    readonly decodeMs: number;
    readonly decodeTokens: number;
}
/** Provider-reported usage over the whole log (`@deepseek-ai/dsh-token-meter`). */
export interface TokenUsageValue {
    readonly uncachedInputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
}
/** Context occupancy of the next request, as the Web context meter shows it. */
export interface ContextOccupancy {
    readonly percent: number;
    readonly usedTokens: number;
    readonly contextWindow: number;
}
/** Heuristic system/tools/message composition of the next request. */
export interface ContextBreakdownValue {
    readonly systemTokens: number;
    readonly toolsTokens: number;
    readonly messageTokens: number;
}
type ProjectionValues = Readonly<Record<string, unknown>>;
export declare function sessionStats(values: ProjectionValues): SessionStatsValue | undefined;
export declare function tokenUsage(values: ProjectionValues): TokenUsageValue | undefined;
/** Prefer the delta-repriced `projectedTokens`, like the Web meter; null until usage and capacity are known. */
export declare function contextOccupancy(values: ProjectionValues): ContextOccupancy | undefined;
export declare function contextBreakdown(values: ProjectionValues): ContextBreakdownValue | undefined;
/** 45.2秒 under a minute, 2分42秒 from there on. */
export declare function formatDuration(ms: number): string;
/** Compact token count: 517 / 12.4K / 1M. */
export declare function formatTokens(value: number): string;
/** Exact count with thousands separators: 12,364. */
export declare function formatExactTokens(value: number): string;
/** Integer percentage, with just enough decimals that a partial hit never reads 100. */
export declare function cacheHitPercent(usage: TokenUsageValue): string | undefined;
/**
 * Render the `/stats` report as Telegram Rich Markdown. Sections follow the Web
 * composer: time once a step closed, usage once tokens were billed, context once
 * a provider reported usage against a known window.
 * @param values - the session's projection values.
 * @param sessionLabel - preformatted inline label of the session.
 * @returns the report, or a notice when no section has data yet.
 */
export declare function formatSessionStats(values: ProjectionValues, sessionLabel: string): string;
export {};
