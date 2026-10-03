/**
 * Escaping for literal text embedded in Telegram Rich Markdown/HTML.
 * @module telegram/format
 */
/**
 * Escape the characters HTML treats specially.
 * @param text - the raw text to escape.
 * @returns the HTML-escaped text.
 */
export declare function escapeHtml(text: string): string;
