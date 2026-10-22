import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { localMediaKind, localMediaPath, mediaLink, rewriteMarkdownImages, withLocalMediaPlaceholders } from '../src/media.ts'

describe('local media', () => {
  it('rewrites Markdown images outside fences and code spans only', () => {
    const markdown = ['![a](x.png "t")', '`![b](y.png)`', '~~~', '![c](z.png)', '~~~', '![d](<with space.png>)'].join('\n')
    const seen: string[] = []
    const result = rewriteMarkdownImages(markdown, image => { seen.push(`${image.alt}:${image.source}:${image.title ?? ''}`); return `[${image.alt}]` })
    expect(seen).toEqual(['a:x.png:t', 'd:with space.png:'])
    expect(result).toBe(['[a]', '`![b](y.png)`', '~~~', '![c](z.png)', '~~~', '[d]'].join('\n'))
  })

  it('resolves local sources and leaves URLs, anchors and Telegram links alone', () => {
    expect(localMediaPath('a/b.png', '/w')).toBe('/w/a/b.png')
    expect(localMediaPath('/abs.png', '/w')).toBe('/abs.png')
    expect(localMediaPath('~/p.png', '/w')).toBe(join(homedir(), 'p.png'))
    expect(localMediaPath('file:///tmp/a%20b.png', '/w')).toBe('/tmp/a b.png')
    for (const source of ['https://x/y.png', 'tg://emoji?id=1', 'tg://photo?id=a', '#anchor', '']) {
      expect(localMediaPath(source, '/w')).toBeUndefined()
    }
  })

  it('chooses the upload kind by extension and photo size', () => {
    expect(localMediaKind('a.JPG', 1024)).toBe('photo')
    expect(localMediaKind('a.png', 10 * 1024 * 1024 + 1)).toBe('document')
    expect(localMediaKind('a.gif', 1)).toBe('animation')
    expect(localMediaKind('a.mov', 1)).toBe('video')
    expect(localMediaKind('a.mp3', 1)).toBe('audio')
    expect(localMediaKind('a.pdf', 1)).toBe('document')
    expect(mediaLink('animation', 'm1')).toBe('tg://video?id=m1')
  })

  it('shows local images as placeholders and keeps remote ones', () => {
    expect(withLocalMediaPlaceholders('![猫](./cat.png)\n\n![](https://x/y.png)\n\n![](<a b.mp4> "片段")'))
      .toBe('📎 猫\n\n![](https://x/y.png)\n\n📎 片段')
  })
})
