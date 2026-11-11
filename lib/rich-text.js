/**
 * Plain-text projection of received Telegram rich messages (Bot API `RichText`
 * and `RichBlock`), used to show the Agent what the user replied to or quoted.
 * The input comes from the network, so every shape is checked before use and
 * unknown types degrade to their `text` instead of throwing.
 * @module telegram/rich-text
 */
const MEDIA_LABELS = {
    photo: '图片', video: '视频', animation: '动画', audio: '音频',
    voice_note: '语音', document: '文件', map: '地图',
};
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value : undefined;
}
/** Flatten one `RichText` (a string, an array, or a typed object) to plain text. */
export function richTextPlain(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(richTextPlain).join('');
    const node = record(value);
    if (node === undefined)
        return '';
    if (node.type === 'mathematical_expression')
        return typeof node.expression === 'string' ? `$${node.expression}$` : '';
    if (node.type === 'custom_emoji')
        return typeof node.alternative_text === 'string' ? node.alternative_text : '';
    if (node.type === 'button')
        return richTextPlain(record(node.button)?.text);
    return richTextPlain(node.text);
}
/** A media or table caption: `RichBlockCaption` (text plus credit) or a bare `RichText`. */
function captionPlain(value) {
    const caption = record(value);
    if (caption === undefined || typeof caption.type === 'string')
        return richTextPlain(value);
    return withCredit(richTextPlain(caption.text), caption.credit);
}
function withCredit(text, credit) {
    const author = richTextPlain(credit).trim();
    return author === '' ? text : `${text}\n— ${author}`;
}
function quoted(text) {
    return text.split('\n').map(line => `> ${line}`).join('\n');
}
function listItemPlain(value) {
    const item = record(value);
    if (item === undefined)
        return '';
    const label = typeof item.label === 'string' && item.label !== '' ? item.label : '-';
    const checkbox = item.has_checkbox === true ? (item.is_checked === true ? '[x] ' : '[ ] ') : '';
    const body = richBlocksPlain(item.blocks, '\n');
    return `${label} ${checkbox}${body.split('\n').join('\n  ')}`;
}
function blockPlain(value) {
    const block = record(value);
    if (block === undefined)
        return '';
    switch (block.type) {
        case 'heading': {
            const size = typeof block.size === 'number' && block.size >= 1 && block.size <= 6 ? block.size : 1;
            return `${'#'.repeat(size)} ${richTextPlain(block.text)}`;
        }
        case 'pre': {
            const fence = '`'.repeat(3);
            return `${fence}${typeof block.language === 'string' ? block.language : ''}\n${richTextPlain(block.text)}\n${fence}`;
        }
        case 'mathematical_expression':
            return typeof block.expression === 'string' ? `$$${block.expression}$$` : '';
        case 'divider':
            return '---';
        case 'anchor':
        case 'buttons':
            return '';
        case 'list':
            return Array.isArray(block.items) ? block.items.map(listItemPlain).filter(Boolean).join('\n') : '';
        case 'blockquote':
            return withCredit(quoted(richBlocksPlain(block.blocks)), block.credit);
        case 'expandable_blockquote':
        case 'pullquote':
            return withCredit(quoted(richTextPlain(block.text)), block.credit);
        case 'table': {
            const rows = Array.isArray(block.cells) ? block.cells : [];
            const lines = rows.map(row => Array.isArray(row)
                ? row.map(cell => richTextPlain(record(cell)?.text).replace(/\n/g, ' ')).join(' | ') : '');
            return [captionPlain(block.caption), ...lines].filter(Boolean).join('\n');
        }
        case 'details':
            return [richTextPlain(block.summary), richBlocksPlain(block.blocks)].filter(Boolean).join('\n\n');
        case 'collage':
        case 'slideshow':
            return [richBlocksPlain(block.blocks), captionPlain(block.caption)].filter(Boolean).join('\n');
        default: {
            const label = typeof block.type === 'string' ? MEDIA_LABELS[block.type] : undefined;
            if (label === undefined)
                return richTextPlain(block.text);
            const caption = captionPlain(block.caption);
            return caption === '' ? `[${label}]` : `[${label}] ${caption}`;
        }
    }
}
/** Render `RichBlock`s as readable Markdown-like text; blank blocks are dropped. */
export function richBlocksPlain(blocks, separator = '\n\n') {
    return Array.isArray(blocks) ? blocks.map(blockPlain).filter(text => text.trim() !== '').join(separator) : '';
}
