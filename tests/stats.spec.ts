import { describe, expect, it } from 'vitest'
import { cacheHitPercent, contextOccupancy, formatDuration, formatExactTokens, formatSessionStats, formatTokens } from '../src/stats.ts'

describe('stats formatting', () => {
  it('formats durations, token counts and cache hits like the DSH Web composer', () => {
    expect(formatDuration(800)).toBe('0.8秒')
    expect(formatDuration(162_000)).toBe('2分42秒')
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_364)).toBe('12.4K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatExactTokens(12_364)).toBe('12,364')
    expect(cacheHitPercent({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 })).toBeUndefined()
    expect(cacheHitPercent({ uncachedInputTokens: 1, cacheReadTokens: 999, cacheWriteTokens: 0, outputTokens: 0 })).toBe('99.9')
    expect(cacheHitPercent({ uncachedInputTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0, outputTokens: 0 })).toBe('100')
  })

  it('prefers projected tokens and requires a known context window', () => {
    expect(contextOccupancy({ contextPressure: { pressureTokens: 500, projectedTokens: 250, contextWindow: 1000 } }))
      .toEqual({ percent: 25, usedTokens: 250, contextWindow: 1000 })
    expect(contextOccupancy({ contextPressure: { pressureTokens: 500 } })).toBeUndefined()
    expect(contextOccupancy({})).toBeUndefined()
  })

  it('drops malformed sections and shows cache writes only when present', () => {
    const text = formatSessionStats({
      sessionStats: { turns: 'x' },
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 5, outputTokens: 2 },
    }, '`s-1`')
    expect(text).not.toContain('用时与速度')
    expect(text).toContain('| 缓存写入 | 5 tok |')
    expect(text).toContain('| 缓存命中 | 0% |')
    expect(text).not.toContain('上下文已用')
  })
})
