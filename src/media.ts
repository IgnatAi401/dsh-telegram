/**
 * Local media the Agent places in its reply as Markdown images, for example
 * `![说明](./cat.jpg "标题")` or `![说明](<带空格 的路径.png>)`. Fenced code blocks
 * and code spans are left alone; sources with a URL scheme belong to Telegram.
 * @module telegram/media
 */

import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One Markdown image whose source may be a local path. */
export interface MarkdownImage {
  readonly alt: string
  /** Source as written, without angle brackets. */
  readonly source: string
  readonly title: string | undefined
}

/** Upload kind of a local media file, matching its `tg://<link>?id=` link. */
export type LocalMediaKind = 'photo' | 'video' | 'animation' | 'audio' | 'document'

/** Bot API multipart uploads accept photos of up to 10 MB; larger images go as files. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.oga', '.wav', '.flac'])

// A code span is consumed first, so an image written inside one is not matched.
const INLINE = /(`+)[\s\S]*?\1|!\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+"([^"\n]*)")?\s*\)/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Replace Markdown images outside code. `replace` returns the new text for an
 * image, or `undefined` to keep it unchanged.
 */
export function rewriteMarkdownImages(markdown: string, replace: (image: MarkdownImage) => string | undefined): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let prose: string[] = []
  let fence: string | undefined
  const flush = (): void => {
    if (prose.length === 0) return
    output.push(prose.join('\n').replace(INLINE, (match, ticks: string | undefined, alt: string, source: string, title?: string) =>
      ticks !== undefined ? match
        : replace({ alt, source: source.startsWith('<') ? source.slice(1, -1) : source, title }) ?? match))
    prose = []
  }
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1]
    if (fence === undefined) {
      if (marker === undefined) { prose.push(line); continue }
      flush()
      fence = marker
      output.push(line)
    } else {
      output.push(line)
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined
    }
  }
  flush()
  return output.join('\n')
}

/** Resolve a local image source against `cwd`; `undefined` for URLs, anchors and empty sources. */
export function localMediaPath(source: string, cwd: string): string | undefined {
  if (/^file:\/\//i.test(source)) {
    try { return fileURLToPath(source) } catch { return undefined }
  }
  // A drive letter is a Windows path, not a URL scheme.
  if (source === '' || source.startsWith('#') || (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source))) return undefined
  if (source === '~' || source.startsWith('~/')) return join(homedir(), source.slice(2))
  return resolve(cwd, source)
}

/** Upload kind by extension; oversized photos keep their bytes as documents. */
export function localMediaKind(path: string, size: number): LocalMediaKind {
  const extension = extname(path).toLowerCase()
  if (PHOTO_EXTENSIONS.has(extension)) return size <= MAX_PHOTO_BYTES ? 'photo' : 'document'
  if (extension === '.gif') return 'animation'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return 'document'
}

/** `tg://` link type for a media kind; animations use video links. */
export function mediaLink(kind: LocalMediaKind, id: string): string {
  return `tg://${kind === 'animation' ? 'video' : kind}?id=${id}`
}

/** Text shown where a local image cannot be embedded. */
export function mediaPlaceholder(image: MarkdownImage): string {
  return `📎 ${image.alt.trim() || image.title?.trim() || basename(image.source)}`
}

/**
 * Drafts and intermediate messages cannot upload files: show local images as
 * placeholders there. The final result embeds them.
 */
export function withLocalMediaPlaceholders(markdown: string): string {
  return rewriteMarkdownImages(markdown, image =>
    localMediaPath(image.source, '/') === undefined ? undefined : mediaPlaceholder(image))
}
