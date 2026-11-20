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
import type { TelegramInlineKeyboardMarkup } from './client.js';
import type { Panel } from './panel.js';
/** A panel drawn as a rich message with inline buttons. */
export interface KeyboardPanel {
    readonly markdown: string;
    /** Empty for a closed panel, which removes the old buttons on edit. */
    readonly keyboard: TelegramInlineKeyboardMarkup;
}
/** Draw a panel as a rich message with inline buttons. */
export declare function renderKeyboardPanel(panel: Panel): KeyboardPanel;
