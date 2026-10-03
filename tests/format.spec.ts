import { describe, expect, it } from 'vitest'
import { escapeHtml } from '../src/format.ts'

describe('escapeHtml', () => {
  it('escapes the five Telegram-special characters', () => {
    expect(escapeHtml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f')
  })

  it('does not double-escape already escaped entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})
