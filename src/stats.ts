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
  readonly turns: number
  readonly steps: number
  readonly llmMs: number
  readonly toolMs: number
  readonly ttftMs: number
  readonly ttftSteps: number
  readonly decodeMs: number
  readonly decodeTokens: number
}

/** Provider-reported usage over the whole log (`@deepseek-ai/dsh-token-meter`). */
export interface TokenUsageValue {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Context occupancy of the next request, as the Web context meter shows it. */
export interface ContextOccupancy {
  readonly percent: number
  readonly usedTokens: number
  readonly contextWindow: number
}

/** Heuristic system/tools/message composition of the next request. */
export interface ContextBreakdownValue {
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly messageTokens: number
}

type ProjectionValues = Readonly<Record<string, unknown>>

const STATS_FIELDS = ['turns', 'steps', 'llmMs', 'toolMs', 'ttftMs', 'ttftSteps', 'decodeMs', 'decodeTokens'] as const
const USAGE_FIELDS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const
const BREAKDOWN_FIELDS = ['systemTokens', 'toolsTokens', 'messageTokens'] as const

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** The object when every listed field is a non-negative finite number. */
function numericRecord<K extends string>(value: unknown, fields: readonly K[]): Record<K, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return fields.every(field => count(record[field])) ? record as Record<K, number> : undefined
}

export function sessionStats(values: ProjectionValues): SessionStatsValue | undefined {
  return numericRecord(values.sessionStats, STATS_FIELDS)
}

export function tokenUsage(values: ProjectionValues): TokenUsageValue | undefined {
  return numericRecord(values.tokenUsage, USAGE_FIELDS)
}

/** Prefer the delta-repriced `projectedTokens`, like the Web meter; null until usage and capacity are known. */
export function contextOccupancy(values: ProjectionValues): ContextOccupancy | undefined {
  const pressure = values.contextPressure as { projectedTokens?: unknown; pressureTokens?: unknown; contextWindow?: unknown } | undefined
  if (typeof pressure !== 'object' || pressure === null) return undefined
  const usedTokens = count(pressure.projectedTokens) ? pressure.projectedTokens : pressure.pressureTokens
  const contextWindow = pressure.contextWindow
  if (!count(usedTokens) || !count(contextWindow) || contextWindow === 0) return undefined
  return { percent: Math.min(100, Math.round(usedTokens / contextWindow * 100)), usedTokens, contextWindow }
}

export function contextBreakdown(values: ProjectionValues): ContextBreakdownValue | undefined {
  return numericRecord(values.contextBreakdown, BREAKDOWN_FIELDS)
}

/** 45.2秒 under a minute, 2分42秒 from there on. */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}秒`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}分${whole % 60}秒`
}

/** Compact token count: 517 / 12.4K / 1M. */
export function formatTokens(value: number): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Exact count with thousands separators: 12,364. */
export function formatExactTokens(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatTokensPerSecond(tps: number): string {
  return tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10)
}

/** Integer percentage, with just enough decimals that a partial hit never reads 100. */
export function cacheHitPercent(usage: TokenUsageValue): string | undefined {
  const billed = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  if (billed === 0) return undefined
  if (usage.cacheReadTokens >= billed) return '100'
  const ratio = usage.cacheReadTokens / billed * 100
  for (let places = 0; ; places += 1) {
    const rounded = ratio.toFixed(places)
    if (Number(rounded) < 100 || places === 6) return rounded
  }
}

function table(header: string, rows: ReadonlyArray<readonly [string, string]>): string {
  return [`| ${header} | 数值 |`, '| :--- | ---: |', ...rows.map(([label, value]) => `| ${label} | ${value} |`)].join('\n')
}

/**
 * Render the `/stats` report as Telegram Rich Markdown. Sections follow the Web
 * composer: time once a step closed, usage once tokens were billed, context once
 * a provider reported usage against a known window.
 * @param values - the session's projection values.
 * @param sessionLabel - preformatted inline label of the session.
 * @returns the report, or a notice when no section has data yet.
 */
export function formatSessionStats(values: ProjectionValues, sessionLabel: string): string {
  const stats = sessionStats(values)
  const usage = tokenUsage(values)
  const occupancy = contextOccupancy(values)
  const breakdown = contextBreakdown(values)
  const sections: string[] = []
  if (stats !== undefined && stats.steps > 0) {
    const rows: Array<readonly [string, string]> = [['轮次', `${stats.turns} 轮 ${stats.steps} 步`]]
    if (stats.llmMs > 0) rows.push(['模型用时', formatDuration(stats.llmMs)])
    if (stats.toolMs > 0) rows.push(['工具调用用时', formatDuration(stats.toolMs)])
    if (stats.ttftSteps > 0) rows.push(['首 token 平均（TTFT）', formatDuration(stats.ttftMs / stats.ttftSteps)])
    if (stats.decodeMs > 0) {
      rows.push(['输出速度（TPS）', `${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000))} tok/s`])
    }
    sections.push(`## ⏱ 用时与速度\n\n${table('项目', rows)}`)
  }
  const billed = usage === undefined ? 0 : usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  if (usage !== undefined && (billed > 0 || usage.outputTokens > 0)) {
    const hit = cacheHitPercent(usage)
    const rows: Array<readonly [string, string]> = []
    if (hit !== undefined) rows.push(['缓存命中', `${hit}%`])
    rows.push(['未缓存输入', `${formatExactTokens(usage.uncachedInputTokens)} tok`])
    rows.push(['缓存读取', `${formatExactTokens(usage.cacheReadTokens)} tok`])
    if (usage.cacheWriteTokens !== 0) rows.push(['缓存写入', `${formatExactTokens(usage.cacheWriteTokens)} tok`])
    rows.push(['输出', `${formatExactTokens(usage.outputTokens)} tok`])
    sections.push(`## 🗄 Token 用量 · ${formatExactTokens(billed + usage.outputTokens)} tok\n\n${table('项目', rows)}`)
  }
  if (occupancy !== undefined) {
    // Each figure is a heuristic estimate, so none is presented as an exact total.
    const lines = [
      `## 🧭 上下文已用 ${occupancy.percent}%`,
      `约 ${formatTokens(occupancy.usedTokens)} / ${formatTokens(occupancy.contextWindow)}`,
    ]
    if (breakdown !== undefined) {
      lines.push(table('组成', [
        ['系统提示词', `约 ${formatTokens(breakdown.systemTokens)}`],
        ['工具定义', `约 ${formatTokens(breakdown.toolsTokens)}`],
        ['对话消息', `约 ${formatTokens(breakdown.messageTokens)}`],
      ]))
    }
    sections.push(lines.join('\n\n'))
  }
  if (sections.length === 0) {
    return `ℹ️ **暂无统计数据**\n\n**会话**：${sessionLabel}\n\n当前会话还没有模型请求记录，完成一轮对话后再试。`
  }
  return ['# 📊 会话统计', `**会话**：${sessionLabel}`, ...sections.flatMap(section => ['---', section])].join('\n\n')
}
