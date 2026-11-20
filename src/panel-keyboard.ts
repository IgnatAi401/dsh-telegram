/**
 * Inline-keyboard rendering of a {@link Panel}: the fallback while Telegram
 * refuses widgets (`INPUT_MEDIA_WIDGET_NOT_ALLOWED`). The same panel object,
 * with the same request data, becomes a rich message plus inline buttons whose
 * `callback_data` is `prefix + data`, so taps reach the bridge's one handler.
 *
 * The body is official Rich HTML, one `<p>` block per line, so every label is
 * HTML-escaped once and never parsed as Markdown. Each tappable control is a
 * button; the text repeats what a button cannot show (subtitles, the meter).
 * @module telegram/panel-keyboard
 */

import type { TelegramInlineKeyboardButton, TelegramInlineKeyboardMarkup } from './client.js'
import { escapeHtml } from './format.js'
import type { Panel, PanelIcon, PanelRowMark } from './panel.js'

/** A panel drawn as a rich message with inline buttons. */
export interface KeyboardPanel {
  readonly markdown: string
  /** Empty for a closed panel, which removes the old buttons on edit. */
  readonly keyboard: TelegramInlineKeyboardMarkup
}

const ICONS: Readonly<Record<PanelIcon, string>> = {
  panel: '🎛', folder: '🗂', chat: '💬', model: '🤖', spark: '🧠', shield: '🛡', ask: '❓',
}
const NOTICES = { info: 'ℹ️', ok: '✅', error: '⚠️' } as const
const STATUSES = { idle: '⚪️', live: '🟢', wait: '🟡' } as const
const CLOSED = { neutral: '⏹', success: '✅', cancelled: '✖️' } as const

/** Telegram shows about this many characters on a full-width button. */
const BUTTON_CHARACTERS = 56

function icon(name: string): string {
  return ICONS[name as PanelIcon] ?? name
}

function buttonLabel(text: string): string {
  const characters = [...text]
  return characters.length <= BUTTON_CHARACTERS ? text : `${characters.slice(0, BUTTON_CHARACTERS - 1).join('')}…`
}

/** Escape a runtime label; line breaks stay inside the current block. */
function html(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>')
}

function markPrefix(mark: PanelRowMark | undefined, index: number): string {
  switch (mark) {
    case 'current': return '✓ '
    case 'checked': return '☑️ '
    case 'unchecked': return '⬜️ '
    case 'number': return `${index + 1}. `
    default: return ''
  }
}

/** A message cannot tick like the widget's clock, so a running status shows when it began. */
function startedAt(since: number): string {
  const date = new Date(since * 1000)
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())} 开始`
}

function meterBar(percent: number): string {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 10)
  return `${'▓'.repeat(filled)}${'░'.repeat(10 - filled)}`
}

/** Draw a panel as a rich message with inline buttons. */
export function renderKeyboardPanel(panel: Panel): KeyboardPanel {
  const prefix = panel.prefix ?? ''
  const blocks: string[] = []
  const rows: TelegramInlineKeyboardButton[][] = []
  const button = (text: string, data: string): TelegramInlineKeyboardButton =>
    ({ text: buttonLabel(text), callback_data: `${prefix}${data}` })
  const line = (body: string): void => { blocks.push(`<p>${body}</p>`) }

  if (panel.closed !== undefined) {
    const { kind, title, text } = panel.closed
    line(`${CLOSED[kind]} <b>${html(title)}</b>`)
    if (text) line(html(text))
    return { markdown: blocks.join('\n\n'), keyboard: { inline_keyboard: [] } }
  }

  const { header, status, notice, steps, meter, pager } = panel
  if (header !== undefined) {
    line(`${icon(header.icon)} <b>${html(header.title)}</b>`)
    if (status !== undefined) {
      const clock = status.since === undefined ? '' : ` · ${startedAt(status.since)}`
      line(`${STATUSES[status.kind]} ${html(status.text)}${clock}`)
    } else if (header.subtitle) {
      line(html(header.subtitle))
    }
  }
  if (steps !== undefined && steps.total > 1) line(`第 ${steps.index + 1} / ${steps.total} 步`)
  if (notice !== undefined) line(`${NOTICES[notice.kind]} ${html(notice.text)}`)

  if (panel.tiles?.length) {
    line(panel.tiles.map(tile => `${icon(tile.icon)} ${html(tile.label)}：<code>${html(tile.value)}</code>`).join('<br>'))
    const tappable = panel.tiles.filter(tile => tile.data !== undefined)
    for (let index = 0; index < tappable.length; index += 2) {
      rows.push(tappable.slice(index, index + 2).map(tile => button(`${icon(tile.icon)} ${tile.label}`, tile.data!)))
    }
  }
  if (meter !== undefined) line(`${html(meter.caption)}　${meterBar(meter.percent)}　${html(meter.label)}`)

  if (panel.rows?.length) {
    // Subtitles do not fit on a button, so list them only when some row has one.
    if (panel.rows.some(row => row.subtitle)) {
      line(panel.rows.map((row, index) => {
        const label = `${markPrefix(row.mark, index)}${html(row.title)}`
        return row.subtitle ? `${label} · ${html(row.subtitle)}` : label
      }).join('<br>'))
    }
    panel.rows.forEach((row, index) => {
      if (row.data !== undefined) rows.push([button(`${markPrefix(row.mark, index)}${row.title}`, row.data)])
    })
  }
  if (panel.empty !== undefined) line(`<i>${html(panel.empty.text)}</i>`)
  if (panel.text) line(html(panel.text))
  if (panel.listening) line('<i>等待你发送消息…</i>')

  if (pager !== undefined && pager.pages > 1) {
    line(`第 ${pager.page + 1} / ${pager.pages} 页`)
    const navigation: TelegramInlineKeyboardButton[] = []
    if (pager.prev !== undefined) navigation.push(button('⬅️ 上一页', pager.prev))
    if (pager.next !== undefined) navigation.push(button('下一页 ➡️', pager.next))
    if (navigation.length > 0) rows.push(navigation)
  }
  for (const actionRow of panel.actions ?? []) {
    const buttons = actionRow.filter(action => action.data !== undefined).map(action => button(action.text, action.data!))
    if (buttons.length > 0) rows.push(buttons)
  }
  if (header?.back !== undefined) rows.push([button('⬅️ 返回', header.back)])
  if (panel.footer) line(`<i>${html(panel.footer)}</i>`)

  return { markdown: blocks.join('\n\n') || '<p>🎛</p>', keyboard: { inline_keyboard: rows } }
}
