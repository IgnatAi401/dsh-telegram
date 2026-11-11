/**
 * The control panel widget (Bot API 10.4 `sendWidget`): one fixed HTML document
 * that draws whatever panel the bridge writes into the widget's chat state. A
 * widget's code can never change after sending, so the menu, questions and
 * approvals all share this renderer and differ only in their state.
 *
 * State is JSON in `chat_data` (at most 1024 bytes of UTF-8) with one short key
 * per component; {@link encodePanel} documents each next to the field it writes.
 * A tap sends `k + data` (at most 64 bytes) to the bridge as a `widget_query`.
 *
 * The renderer stays inside the widget profile: transform-only animations and
 * colour instead of opacity (Telegram stops a widget with more than 16
 * translucent or blurred elements), no form controls, no network, no scrolling.
 * @module telegram/panel
 */

/** Telegram's limit for a widget's chat state, in bytes of UTF-8. */
export const MAX_PANEL_STATE_BYTES = 1024

export type PanelButtonStyle = 'primary' | 'ghost' | 'danger' | 'success'

/** Leading mark of a list row: a chevron, the current choice, a checkbox, or its number. */
export type PanelRowMark = 'none' | 'current' | 'unchecked' | 'checked' | 'number'

export interface PanelButton {
  readonly text: string
  /** Request data sent on a tap, without the panel's prefix; omitted draws a disabled control. */
  readonly data?: string
  readonly style?: PanelButtonStyle
}

export interface PanelTile {
  readonly icon: string
  readonly label: string
  readonly value: string
  readonly data?: string
}

export interface PanelRow {
  readonly title: string
  readonly subtitle?: string
  readonly data?: string
  readonly mark?: PanelRowMark
}

export interface Panel {
  /** Common prefix of every control's request data. */
  readonly prefix?: string
  /** Icon badge, title and a line below it; `back` adds a round back button. */
  readonly header?: { readonly icon: string, readonly title: string, readonly subtitle?: string, readonly back?: string }
  /** Replaces the header's subtitle with a status dot; `since` (Unix seconds) adds a running clock. */
  readonly status?: { readonly kind: 'idle' | 'live' | 'wait', readonly text: string, readonly since?: number }
  readonly notice?: { readonly kind: 'info' | 'ok' | 'error', readonly text: string }
  /** Progress through a batch of questions; `index` is zero-based. */
  readonly steps?: { readonly index: number, readonly total: number }
  /** Two-column cards. */
  readonly tiles?: readonly PanelTile[]
  /** A labelled bar filled to `percent`. */
  readonly meter?: { readonly percent: number, readonly caption: string, readonly label: string }
  readonly rows?: readonly PanelRow[]
  /** Navigation lists use selection marks without an outline around each row. */
  readonly plainRows?: boolean
  /** Placeholder for an empty list. */
  readonly empty?: { readonly icon: string, readonly text: string }
  readonly text?: string
  /** Bouncing dots: the bridge is waiting for the user's next message. */
  readonly listening?: boolean
  /** `page` is zero-based; a missing `prev`/`next` disables that arrow. */
  readonly pager?: { readonly page: number, readonly pages: number, readonly prev?: string, readonly next?: string }
  readonly actions?: readonly (readonly PanelButton[])[]
  readonly footer?: string
  /** A finished panel: nothing but an outcome mark and one or two lines. */
  readonly closed?: { readonly kind: 'neutral' | 'success' | 'cancelled', readonly title: string, readonly text?: string }
}

/**
 * The renderer reuses elements by position when the bridge changes the state,
 * blocks further taps while a request is in flight, and shows each answer's
 * text (or why the request failed) in the header's upper-right corner. Telegram refuses
 * a widget whose HTML exceeds 4096 bytes after zlib compression.
 *
 * `el` advances a cursor on each parent and reuses a matching child; `trim`
 * removes children left over from the previous state. Leaf text is updated
 * without replacing its element. Keep row markers visible and a consistent
 * minimum row height, centering titles when there is no subtitle. Loading
 * lives over the heading; header feedback never adds document height.
 * Avoid class names differing only in
 * case: renderers in quirks mode can match them case-insensitively.
 * The root and ordinary controls stay transparent over the chat bubble.
 * Text follows the chat palette; only primary and approval actions are filled.
 * Status padding and negative margins reserve the pulse's 3px visual overflow
 * without moving the dot or changing the header's layout height.
 */
export const PANEL_HTML = `<!doctype html><style>
*{box-sizing:border-box}
html{height:auto;min-height:0;--ink:var(--tg-theme-text-color);--h:var(--tg-theme-hint-color);--b:var(--tg-theme-button-color);--edge:var(--h);--track:rgba(0,0,0,.18);--d:#c72c30;--g:#008a30;--check:var(--tg-theme-button-text-color);background:none;color:var(--ink)}
body{position:relative;height:auto;min-height:0;margin:0;padding:12px 12px max(12px,var(--tg-content-safe-area-inset-bottom,0px));background:none;color:var(--ink)}
@media(prefers-color-scheme:dark){html{--d:#ff453a;--g:#30d36b;--track:rgba(0,0,0,.35)}}
#a{display:flex;flex-direction:column;gap:10px}
button{appearance:none;font:inherit;color:inherit;border:0;margin:0;padding:0;min-height:0;background:none;text-align:left;position:relative}
.busy button{pointer-events:none}
b,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
small{color:var(--h);font-size:.8em}
.H{display:flex;align-items:center;gap:10px}
.I{width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.35em;flex:none}
.B{width:30px;height:30px;border-radius:15px;text-align:center;font-size:1.3em;line-height:28px;flex:none}
.T,.X{flex:1;min-width:0}
.T{text-align:left}
.H .T b{position:relative;font-size:1.1em;padding-right:var(--notice-space,24px)}
.P{display:flex;align-items:center;gap:6px;padding:3px;margin:-3px}
.P u{width:7px;height:7px;border-radius:50%;background:var(--h);flex:none}
.live u{background:var(--g);animation:q 1.2s ease-in-out infinite}
.y u{background:var(--b)}
.Q{display:flex;gap:4px}
.Q i{flex:1;height:4px;border-radius:2px;background:var(--edge)}
.Q .o{background:var(--b)}
.C{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.C button,.L button,.M{box-shadow:inset 0 0 0 1px var(--edge);border-radius:13px;padding:9px 12px;min-width:0}
.C b{margin-top:2px}
.M{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}
.M div{width:100%;height:6px;border-radius:3px;background:var(--track);overflow:hidden}
.M i{display:block;height:100%;border-radius:3px;background:var(--b)}
.M .high{background:var(--d)}
.L{display:flex;flex-direction:column;gap:6px}
.L button{display:flex;align-items:center;gap:10px;width:100%;min-height:calc(2.25em + 14px);padding:6px 12px}
.L b{line-height:1.25em}
.L small{line-height:1.25em;min-height:1.25em}
.L .o{box-shadow:inset 0 0 0 1.5px var(--b)}
.L.plain button{box-shadow:none}
.K{width:22px;height:22px;border-radius:11px;border:2px solid var(--h);flex:none;text-align:center;font-size:.72em;font-weight:700;line-height:18px;color:var(--check)}
.K2,.K3{border-radius:7px}
.K1,.K3{border-color:var(--b);background:var(--b)}
.K4{border:1px solid var(--edge);color:var(--h);line-height:20px}
.V{color:var(--h);font-size:1.2em}
.E{text-align:center;color:var(--h);padding:10px 0}
.E div{font-size:2.2em;animation:w 2s ease-in-out infinite alternate}
.W{display:flex;gap:6px;justify-content:center;padding:6px}
.W i{width:8px;height:8px;border-radius:4px;background:var(--b);animation:w .6s ease-in-out infinite alternate;animation-delay:calc(var(--i)*.15s)}
p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.G{display:flex;align-items:center;justify-content:center;gap:10px}
.G button{width:30px;height:30px;border-radius:15px;text-align:center;font-size:1.2em;line-height:28px}
.G button:disabled{color:var(--h)}
.G i{width:6px;height:6px;border-radius:3px;background:var(--edge)}
.G .o{width:16px;background:var(--b)}
.A{display:flex;gap:8px}
.A button{display:flex;align-items:center;justify-content:center;flex:1;min-width:0;height:42px;line-height:1.2em;text-align:center;padding:0 6px;border-radius:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 0 0 0 1px var(--edge)}
.A .A0{flex:2;background:#2563eb;color:#fff;box-shadow:none}
.A .A2{color:var(--d)}
.A .A3{background:#00a63c;color:#fff;box-shadow:none}
.F{text-align:center;color:var(--h);font-size:.82em;margin:0}
#o{display:none;position:absolute;right:12px;top:14px;max-width:min(36vw,140px);color:var(--b);font-size:.78em;line-height:1.4em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}
#o.message{display:block}
#o.N1{color:var(--g)}
#o.N2{color:var(--d)}
.busy .H .T b::after{content:'';position:absolute;right:0;top:50%;margin-top:-7px;width:14px;height:14px;border:2px solid var(--h);border-top-color:transparent;border-radius:50%;animation:r .7s linear infinite}
.Z{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:8px 0}
.Z>div{display:flex;flex:none}
.Z .T{flex:none;width:100%;text-align:center}
.Z svg{width:48px;height:48px;fill:none;stroke:var(--h);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.Z1 svg{stroke:var(--g)}
.Z2 svg{stroke:var(--d)}
@keyframes q{50%{transform:scale(1.7)}}
@keyframes w{to{transform:translateY(-5px)}}
@keyframes r{to{transform:rotate(360deg)}}
</style>
<div id="a"></div><p id="o"></p>
<script>
var W=window.TelegramWidget,A=document.getElementById('a'),O=document.getElementById('o'),busy=0,last,tm,note,closed;
var E={NOT_ALLOWED:'这个面板不能操作，请重新发送命令',BUSY:'上一个操作还在处理',RATE_LIMITED:'操作太快，请稍后再试',TIMEOUT:'机器人没有响应，请稍后重试'};
var S=['M12 20h16','M12 21l6 6 11-13','M14 14l12 12M26 14l-12 12'];
function el(t,c,x,p){
var e=p&&p.children[p._n++];
if(!e||e.tagName.toLowerCase()!=t){var old=e;e=document.createElement(t);if(p){p.insertBefore(e,old||null);if(old)old.remove()}}
e._n=0;e.className=c||'';
if(x!=null){if(e.textContent!=String(x))e.textContent=x}else if(e._leaf)e.textContent='';
e._leaf=x!=null;return e
}
function trim(p){if(p._leaf)return;while(p.children.length>p._n)p.lastElementChild.remove();Array.from(p.children).forEach(trim)}
function say(m){m=closed||busy?'':String(m||'').replace(/\\p{P}+/gu,' ').replace(/\\s+/g,' ').trim();O.textContent=m;O.title=m;O.className=m?'message'+(note?' N'+note[0]:''):'';A.style.setProperty('--notice-space',m?'min(36vw,140px)':'24px')}
function buzz(f,x){try{W.HapticFeedback[f](x)}catch(e){}}
function done(){busy=0;A.className=''}
function failed(e){done();say(E[e&&e.code]||'请求失败，请重试');buzz('notificationOccurred','error')}
function tap(d){
if(busy)return;busy=1;A.className='busy';say();buzz('impactOccurred','light');
try{W.request(d).then(function(r){done();say(r.result||(note&&note[1]))},failed)}catch(e){failed(e)}
}
function btn(c,p,d){var b=el('button',c,null,p);b.disabled=!d;b.onclick=d?function(){tap(d)}:null;return b}
function two(n){return(n<10?'0':'')+n}
function clock(e,x,t){function f(){var n=Math.max(0,Math.floor(Date.now()/1000)-t);e.textContent=x+' '+two(Math.floor(n/60))+':'+two(n%60)}f();tm=setInterval(f,1000)}
function draw(){
if(W.chatData===last)return;
last=W.chatData;clearInterval(tm);
var s=null,x,r,b,t,k;
try{s=JSON.parse(last)}catch(e){}
if(!s)s={z:[0,'面板已失效','请重新发送命令']};
k=s.k||'';A._n=0;A.className=busy?'busy':'';note=s.n;closed=!!s.z;say(note&&note[1]);
if(x=s.z){
r=el('div','Z Z'+x[0],null,A);
t=el('div','',null,r);t.innerHTML='<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><path d="'+S[x[0]]+'"/></svg>';t._leaf=true;
b=el('span','T',null,r);el('b','',x[1],b);if(x[2])el('small','',x[2],b);trim(A);return
}
if(x=s.h){
r=el('div','H',null,A);
if(x[3])btn('B',r,k+x[3]).textContent='‹';
el('div','I',x[0],r);b=el('div','T',null,r);el('b','',x[1],b);
if(t=s.s){
b=el('small','P'+(t[0]==1?' live':t[0]==2?' y':''),null,b);el('u','',null,b);b=el('span','',t[1],b);
if(t[2])clock(b,t[1],t[2])
}else el('small','',x[2]||' ',b)
}
if(x=s.q){r=el('div','Q',null,A);for(t=0;t<x[1];t++)el('i',t<=x[0]?'o':'',null,r)}
if(s.c){r=el('div','C',null,A);s.c.forEach(function(x){b=btn('',r,x[3]&&k+x[3]);el('small','',x[0]+' '+x[1],b);el('b','',x[2],b)})}
if(x=s.m){r=el('div','M',null,A);el('small','',x[1],r);el('small','',x[2],r);b=el('i',x[0]>84?'high':'',null,el('div','',null,r));b.style.width=Math.max(2,Math.min(100,x[0]))+'%'}
if(s.l){
r=el('div','L'+(s.r?' plain':''),null,A);
s.l.forEach(function(x,i){
var m=x[3]||0;b=btn(m==1||m==3?'o':'',r,x[2]&&k+x[2]);
el('span','K K'+m,m==4?i+1:m==1||m==3?'✓':'',b);
t=el('span','X',null,b);el('b','',x[0],t);if(x[1])el('small','',x[1],t);
if(m<2)el('span','V','›',b)
})
}
if(x=s.e){r=el('div','E',null,A);el('div','',x[0],r);el('small','',x[1],r)}
if(s.t)el('p','',s.t,A);
if(s.w){r=el('div','W',null,A);for(t=0;t<3;t++)el('i','',null,r).style.setProperty('--i',t)}
if(x=s.p){
r=el('div','G',null,A);btn('',r,x[2]&&k+x[2]).textContent='‹';
if(x[1]<9)for(t=0;t<x[1];t++)el('i',t==x[0]?'o':'',null,r);else el('small','',x[0]+1+' / '+x[1],r);
btn('',r,x[3]&&k+x[3]).textContent='›'
}
(s.a||[]).forEach(function(row){
r=el('div','A',null,A);
row.forEach(function(x){b=btn('A'+(x[2]||0),r,x[1]&&k+x[1]);b.textContent=x[0]})
});
if(s.f)el('p','F',s.f,A)
trim(A)
}
if(W.setResizeAnchor)W.setResizeAnchor('top');
W.onEvent('chatDataChanged',draw);
draw();
if(W.ready)W.ready();
</script>`

const encoder = new TextEncoder()

function byteLength(text: string): number {
  return encoder.encode(text).length
}

/** Cut to at most `maxBytes` of UTF-8 without splitting a character, ending in an ellipsis. */
export function truncateBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  let result = ''
  let used = 3 // the ellipsis
  for (const character of text) {
    used += byteLength(character)
    if (used > maxBytes) break
    result += character
  }
  return `${result}…`
}

const STATUS_CODES = { idle: 0, live: 1, wait: 2 } as const
const NOTICE_CODES = { info: 0, ok: 1, error: 2 } as const
const CLOSED_CODES = { neutral: 0, success: 1, cancelled: 2 } as const
const MARK_CODES: Readonly<Record<PanelRowMark, number>> = { none: 0, current: 1, unchecked: 2, checked: 3, number: 4 }
const STYLE_CODES: Readonly<Record<PanelButtonStyle, number>> = { primary: 0, ghost: 1, danger: 2, success: 3 }

/** Drop trailing empty entries, so optional positions cost no bytes. */
function compact(values: readonly (string | number | undefined)[]): (string | number)[] {
  const result = values.map(value => value ?? '')
  while (result.length > 0 && (result.at(-1) === '' || result.at(-1) === 0)) result.pop()
  return result
}

function serialize(panel: Panel, titleBytes: number, detailBytes: number): string {
  const title = (text: string): string => truncateBytes(text, titleBytes)
  const detail = (text: string | undefined, factor = 1): string =>
    text === undefined || detailBytes === 0 ? '' : truncateBytes(text, detailBytes * factor)
  const { header, status, notice, steps, meter, pager, closed } = panel
  return JSON.stringify({
    k: panel.prefix || undefined,
    // [kind, title, text]
    z: closed && compact([CLOSED_CODES[closed.kind], title(closed.title), detail(closed.text)]),
    // [icon, title, subtitle, back]
    h: header && compact([header.icon, title(header.title), detail(header.subtitle), header.back]),
    // [kind, text, since]
    s: status && compact([STATUS_CODES[status.kind], status.text, status.since]),
    // [index, total]
    q: steps && steps.total > 1 ? [steps.index, steps.total] : undefined,
    // [kind, text]
    n: notice && [NOTICE_CODES[notice.kind], truncateBytes(notice.text, Math.max(60, detailBytes * 3))],
    // [icon, label, value, data]
    c: panel.tiles?.length ? panel.tiles.map(tile => compact([tile.icon, tile.label, title(tile.value), tile.data])) : undefined,
    // [percent, caption, label]
    m: meter && [meter.percent, meter.caption, meter.label],
    // [title, subtitle, data, mark]
    l: panel.rows?.length
      ? panel.rows.map(row => compact([title(row.title), detail(row.subtitle), row.data, MARK_CODES[row.mark ?? 'none']]))
      : undefined,
    r: panel.plainRows ? 1 : undefined,
    // [icon, text]
    e: panel.empty && [panel.empty.icon, panel.empty.text],
    t: panel.text ? truncateBytes(panel.text, Math.max(90, detailBytes * 5)) : undefined,
    w: panel.listening ? 1 : undefined,
    // [page, pages, prev, next]
    p: pager && pager.pages > 1 ? compact([pager.page, pager.pages, pager.prev, pager.next]) : undefined,
    // rows of [text, data, style]
    a: panel.actions?.filter(row => row.length > 0)
      .map(row => row.map(button => compact([title(button.text), button.data, STYLE_CODES[button.style ?? 'ghost']]))),
    f: panel.footer ? truncateBytes(panel.footer, Math.max(60, detailBytes * 3)) : undefined,
  })
}

/**
 * Serialize a panel into a widget chat state of at most 1024 bytes. Titles and
 * details are shortened step by step, details first; request data is never altered.
 * @throws when the panel cannot fit even with the shortest labels.
 */
export function encodePanel(panel: Panel): string {
  for (const [titleBytes, detailBytes] of [[72, 60], [54, 42], [42, 27], [30, 15], [24, 0], [15, 0]] as const) {
    const state = serialize(panel, titleBytes, detailBytes)
    if (byteLength(state) <= MAX_PANEL_STATE_BYTES) return state
  }
  throw new Error('telegram panel: the panel does not fit into 1024 bytes of widget state')
}
