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
export const MAX_PANEL_STATE_BYTES = 1024;
/**
 * The renderer reuses elements by position when the bridge changes the state,
 * blocks further taps while a request is in flight, and shows each answer's
 * text (or why the request failed) in the header's upper-right corner. The
 * bridge answers a tap while it writes the new state, so an empty answer that
 * beats that state keeps taps blocked until it is drawn (`pend` doubles as the
 * 3-second fallback delay). Telegram refuses
 * a widget whose HTML exceeds 4096 bytes after zlib compression.
 *
 * `el` advances a cursor on each parent and reuses a matching child; `trim`
 * removes children left over from the previous state. Leaf text is updated
 * without replacing its element. Keep row markers visible and a consistent
 * minimum row height, centering titles when there is no subtitle. Loading
 * lives over the heading; header feedback never adds document height.
 * Avoid class names differing only in
 * case: renderers in quirks mode can match them case-insensitively.
 * The root stays transparent over the chat bubble; cards, rows and secondary
 * buttons sit on a soft neutral fill (an rgba colour, not `opacity`), so they
 * layer on light and dark themes alike. Icons are stroked SVG on a solid accent
 * badge; only primary and approval actions are filled with a strong colour.
 * Status padding and negative margins reserve the pulse's 3px visual overflow
 * without moving the dot or changing the header's layout height.
 */
export const PANEL_HTML = `<!doctype html><style>
*{box-sizing:border-box}
html{height:auto;min-height:0;--h:var(--tg-theme-hint-color);--b:var(--tg-theme-button-color);--s:rgba(120,120,128,.14);--s2:rgba(120,120,128,.28);--d:#e44;--g:#2a5;background:none;color:var(--tg-theme-text-color)}
body{position:relative;height:auto;min-height:0;margin:0;padding:12px 12px max(12px,var(--tg-content-safe-area-inset-bottom,0px));background:none}
#a{display:flex;flex-direction:column;gap:10px}
button{appearance:none;font:inherit;color:inherit;border:0;margin:0;padding:0;min-height:0;background:none;text-align:left;position:relative}
b,small,.A button,#o{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
small{color:var(--h);font-size:.8em}
svg{display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.H{display:flex;align-items:center;gap:12px}
.I{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--c,var(--s));color:#fff}
.I svg{width:21px;height:21px}
.B,.G button{width:30px;height:30px;border-radius:15px;background:var(--s);text-align:center;font-size:1.25em;line-height:28px;flex:none}
.T,.X{flex:1;min-width:0}
.H .T b{position:relative;font-size:1.12em;padding-right:var(--ns,24px)}
.P{display:flex;align-items:center;gap:6px;padding:3px;margin:-3px}
.P u{width:7px;height:7px;border-radius:50%;background:var(--h);flex:none}
.live u{background:var(--g);animation:q 1.2s ease-in-out infinite}
.y u{background:#f90}
.Q{display:flex;gap:4px}
.Q i{flex:1;height:4px;border-radius:2px;background:var(--s2)}
.C{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.C button,.L button,.M{background:var(--s);border-radius:14px;padding:10px 12px;min-width:0}
.C small{display:flex;align-items:center;gap:5px}
.j{color:var(--c);flex:none}
.j svg{width:15px;height:15px}
.C b{margin-top:4px}
.M{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
.M div{width:100%;height:6px;border-radius:3px;background:var(--s2)}
.M i{display:block;height:100%;border-radius:3px}
.M .high{background:var(--d)}
.L{display:flex;flex-direction:column;gap:6px}
.L button{display:flex;align-items:center;gap:10px;width:100%;min-height:calc(2.25em + 16px);padding:7px 12px}
.L b,.L small{line-height:1.25em;min-height:1.25em}
.L .o{box-shadow:inset 0 0 0 1.5px var(--b)}
.K{width:22px;height:22px;border-radius:11px;border:2px solid var(--h);flex:none;text-align:center;font-size:.72em;font-weight:700;line-height:18px;color:#fff}
.K2,.K3{border-radius:7px}
.K1,.K3{border-color:var(--b);background:var(--b)}
.K4{border:0;background:var(--s2);color:inherit;line-height:22px}
.V{color:var(--h)}
.E svg{width:34px;height:34px}
.W{display:flex;gap:6px;justify-content:center;padding:6px}
.W i{width:8px;height:8px;border-radius:4px;animation:w .6s ease-in-out infinite alternate;animation-delay:calc(var(--i)*.15s)}
p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.G{display:flex;align-items:center;justify-content:center;gap:10px}
button:disabled{color:var(--h)}
.G i{width:6px;height:6px;border-radius:3px;background:var(--s2)}
.G .o{width:16px}
.Q .o,.G .o,.M i,.W i{background:var(--b)}
.A{display:flex;gap:8px}
.A button{flex:1;min-width:0;height:42px;line-height:42px;text-align:center;padding:0 6px;border-radius:13px;font-weight:600;background:var(--s)}
.A .A0{flex:2;background:var(--b);color:var(--tg-theme-button-text-color)}
.A .A2{color:var(--d)}
.A .A3{background:var(--g);color:#fff}
.F{text-align:center;color:var(--h);font-size:.82em}
#o{display:none;position:absolute;right:12px;top:14px;max-width:min(36vw,140px);color:var(--b);font-size:.78em;line-height:1.4em}
#o.message{display:block}
#o.N1{color:var(--g)}
#o.N2{color:var(--d)}
.busy .H .T b::after{content:'';position:absolute;right:0;top:50%;margin-top:-7px;width:14px;height:14px;border:2px solid var(--h);border-top-color:transparent;border-radius:50%;animation:r .7s linear infinite}
.E,.Z{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:8px 0}
.E{color:var(--h)}
.Z .T{flex:none;width:100%}
.Z svg{width:48px;height:48px;stroke:var(--h);stroke-width:1.8}
.Z1 svg{stroke:var(--g)}
.Z2 svg{stroke:var(--d)}
@keyframes q{50%{transform:scale(1.7)}}
@keyframes w{to{transform:translateY(-5px)}}
@keyframes r{to{transform:rotate(360deg)}}
</style>
<div id="a"></div><p id="o"></p>
<script>
var W=window.TelegramWidget,A=document.getElementById('a'),O=document.getElementById('o'),busy=0,last,tm,note,closed,pend,tw;
var E={NOT_ALLOWED:'面板已失效，请重新发送命令',BUSY:'上个操作还在处理',RATE_LIMITED:'操作太快，请稍后再试',TIMEOUT:'机器人无响应，请稍后再试'};
var C='M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',S=['M8 12h8','M8 12l3 3 5-6','M9 9l6 6m0-6-6 6'];
function sv(d){return'<svg viewBox="0 0 24 24"><path d="'+d+'"/></svg>'}
function el(t,c,x,p){
var e=p&&p.children[p._n++];
if(!e||e.tagName.toLowerCase()!=t){var old=e;e=document.createElement(t);if(p){p.insertBefore(e,old||null);if(old)old.remove()}}
e._n=0;e.className=c||'';
if(x!=null){if(e.textContent!=String(x))e.textContent=x}else if(e._leaf)e.textContent='';
e._leaf=x!=null;return e
}
function trim(p){if(p._leaf)return;while(p.children.length>p._n)p.lastElementChild.remove();Array.from(p.children).forEach(trim)}
function say(m){m=closed||busy?'':String(m||'').replace(/\\p{P}+/gu,' ').replace(/\\s+/g,' ').trim();O.textContent=m;O.className=m?'message'+(note?' N'+note[0]:''):'';A.style.setProperty('--ns',m?'min(36vw,140px)':'24px')}
var G={panel:['#55e','M4 4h16v16H4zm8 0v16M4 12h16'],folder:['#f90','M3 5h6l2 2h10v12H3z'],chat:['#08f','M4 5h16v11H9l-5 4z'],model:['#85f','M7 7h10v10H7zm5-4v4m0 10v4M3 12h4m10 0h4'],spark:['#e48','M13 3 5 14h6l-1 7 8-11h-6z'],shield:['#1a5','M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zm-3 9 2 2 4-4'],ask:['#08f',C+'m-2 7a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.6m0 3v.1']};
function ic(n,c,p){var g=G[n],e=el('span',c,g?null:n,p);e.style.setProperty('--c',g?g[0]:'');if(g){e.innerHTML=sv(g[1]);e._leaf=1}return e}
function buzz(f,x){try{W.HapticFeedback[f](x)}catch(e){}}
function done(m){clearTimeout(tw);pend=busy=0;A.className='';say(m||(note&&note[1]))}
function failed(e){done(E[e&&e.code]||'请求失败，请重试');buzz('notificationOccurred','error')}
function tap(d){
if(busy)return;busy=1;A.className='busy';say();buzz('impactOccurred','light');var at=last;
try{W.request(d).then(function(r){r.result||last!=at?done(r.result):tw=setTimeout(done,pend=3e3)},failed)}catch(e){failed(e)}
}
function btn(c,p,d){var b=el('button',c,null,p);b.disabled=!d;b.onclick=d?function(){tap(d)}:null;return b}
function two(n){return(n<10?'0':'')+n}
function clock(e,x,t){function f(){var n=Math.max(0,Date.now()/1e3-t|0);e.textContent=x+' '+two(n/60|0)+':'+two(n%60)}f();tm=setInterval(f,1e3)}
function draw(){
if(W.chatData===last)return;
last=W.chatData;clearInterval(tm);pend&&done();
var s=null,x,r,b,t,k;
try{s=JSON.parse(last)}catch(e){}
if(!s)s={z:[0,'面板已失效','请重新发送命令']};
k=s.k||'';A._n=0;A.className=busy?'busy':'';note=s.n;closed=!!s.z;say(note&&note[1]);
if(x=s.z){
r=el('div','Z Z'+x[0],null,A);
t=el('div','',null,r);t.innerHTML=sv(C+S[x[0]]);t._leaf=true;
b=el('span','T',null,r);el('b','',x[1],b);if(x[2])el('small','',x[2],b);trim(A);return
}
if(x=s.h){
r=el('div','H',null,A);
if(x[3])btn('B',r,k+x[3]).textContent='‹';
ic(x[0],'I',r);b=el('div','T',null,r);el('b','',x[1],b);
if(t=s.s){
b=el('small','P'+(t[0]==1?' live':t[0]==2?' y':''),null,b);el('u','',null,b);b=el('span','',t[1],b);
if(t[2])clock(b,t[1],t[2])
}else el('small','',x[2]||' ',b)
}
if(x=s.q){r=el('div','Q',null,A);for(t=0;t<x[1];t++)el('i',t<=x[0]?'o':'',null,r)}
if(s.c){r=el('div','C',null,A);s.c.forEach(function(x){b=btn('',r,x[3]&&k+x[3]);t=el('small','',null,b);ic(x[0],'j',t);el('span','',x[1],t);el('b','',x[2],b)})}
if(x=s.m){r=el('div','M',null,A);el('small','',x[1],r);el('small','',x[2],r);b=el('i',x[0]>84?'high':'',null,el('div','',null,r));b.style.width=Math.max(2,Math.min(100,x[0]))+'%'}
if(s.l){
r=el('div','L',null,A);
s.l.forEach(function(x,i){
var m=x[3]||0;b=btn(m==1||m==3?'o':'',r,x[2]&&k+x[2]);
el('span','K K'+m,m==4?i+1:m==1||m==3?'✓':'',b);
t=el('span','X',null,b);el('b','',x[0],t);if(x[1])el('small','',x[1],t);
if(m<2)el('span','V','›',b)
})
}
if(x=s.e){r=el('div','E',null,A);ic(x[0],'',r);el('small','',x[1],r)}
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
</script>`;
const encoder = new TextEncoder();
function byteLength(text) {
    return encoder.encode(text).length;
}
/** Cut to at most `maxBytes` of UTF-8 without splitting a character, ending in an ellipsis. */
export function truncateBytes(text, maxBytes) {
    if (byteLength(text) <= maxBytes)
        return text;
    let result = '';
    let used = 3; // the ellipsis
    for (const character of text) {
        used += byteLength(character);
        if (used > maxBytes)
            break;
        result += character;
    }
    return `${result}…`;
}
const STATUS_CODES = { idle: 0, live: 1, wait: 2 };
const NOTICE_CODES = { info: 0, ok: 1, error: 2 };
const CLOSED_CODES = { neutral: 0, success: 1, cancelled: 2 };
const MARK_CODES = { none: 0, current: 1, unchecked: 2, checked: 3, number: 4 };
const STYLE_CODES = { primary: 0, ghost: 1, danger: 2, success: 3 };
/** Drop trailing empty entries, so optional positions cost no bytes. */
function compact(values) {
    const result = values.map(value => value ?? '');
    while (result.length > 0 && (result.at(-1) === '' || result.at(-1) === 0))
        result.pop();
    return result;
}
function serialize(panel, titleBytes, detailBytes) {
    const title = (text) => truncateBytes(text, titleBytes);
    const detail = (text, factor = 1) => text === undefined || detailBytes === 0 ? '' : truncateBytes(text, detailBytes * factor);
    const { header, status, notice, steps, meter, pager, closed } = panel;
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
    });
}
/**
 * Serialize a panel into a widget chat state of at most 1024 bytes. Titles and
 * details are shortened step by step, details first; request data is never altered.
 * @throws when the panel cannot fit even with the shortest labels.
 */
export function encodePanel(panel) {
    for (const [titleBytes, detailBytes] of [[72, 60], [54, 42], [42, 27], [30, 15], [24, 0], [15, 0]]) {
        const state = serialize(panel, titleBytes, detailBytes);
        if (byteLength(state) <= MAX_PANEL_STATE_BYTES)
            return state;
    }
    throw new Error('telegram panel: the panel does not fit into 1024 bytes of widget state');
}
