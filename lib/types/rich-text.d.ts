/**
 * Plain-text projection of received Telegram rich messages (Bot API `RichText`
 * and `RichBlock`), used to show the Agent what the user replied to or quoted.
 * The input comes from the network, so every shape is checked before use and
 * unknown types degrade to their `text` instead of throwing.
 * @module telegram/rich-text
 */
/** Flatten one `RichText` (a string, an array, or a typed object) to plain text. */
export declare function richTextPlain(value: unknown): string;
/** Render `RichBlock`s as readable Markdown-like text; blank blocks are dropped. */
export declare function richBlocksPlain(blocks: unknown, separator?: string): string;
