/**
 * Escaping for literal text embedded in Telegram Rich Markdown/HTML.
 * @module telegram/format
 */
/**
 * Escape the characters HTML treats specially.
 * @param text - the raw text to escape.
 * @returns the HTML-escaped text.
 */
export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
