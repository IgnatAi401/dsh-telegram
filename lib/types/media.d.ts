/**
 * Local media the Agent places in its reply as Markdown images, for example
 * `![说明](./cat.jpg "标题")` or `![说明](<带空格 的路径.png>)`. Fenced code blocks
 * and code spans are left alone; sources with a URL scheme belong to Telegram.
 * @module telegram/media
 */
/** One Markdown image whose source may be a local path. */
export interface MarkdownImage {
    readonly alt: string;
    /** Source as written, without angle brackets. */
    readonly source: string;
    readonly title: string | undefined;
}
/** Upload kind of a local media file, matching its `tg://<link>?id=` link. */
export type LocalMediaKind = 'photo' | 'video' | 'animation' | 'audio' | 'document';
/**
 * Replace Markdown images outside code. `replace` returns the new text for an
 * image, or `undefined` to keep it unchanged.
 */
export declare function rewriteMarkdownImages(markdown: string, replace: (image: MarkdownImage) => string | undefined): string;
/** Resolve a local image source against `cwd`; `undefined` for URLs, anchors and empty sources. */
export declare function localMediaPath(source: string, cwd: string): string | undefined;
/** Upload kind by extension; oversized photos keep their bytes as documents. */
export declare function localMediaKind(path: string, size: number): LocalMediaKind;
/** `tg://` link type for a media kind; animations use video links. */
export declare function mediaLink(kind: LocalMediaKind, id: string): string;
/** Text shown where a local image cannot be embedded. */
export declare function mediaPlaceholder(image: MarkdownImage): string;
/**
 * Drafts and intermediate messages cannot upload files: show local images as
 * placeholders there. The final result embeds them.
 */
export declare function withLocalMediaPlaceholders(markdown: string): string;
