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
 * The renderer. It rebuilds the panel whenever the bridge changes the state,
 * blocks further taps while a request is in flight, and shows each answer's
 * text (or why the request failed) in a line under the panel. Telegram refuses
 * a widget whose HTML exceeds 4096 bytes after zlib compression.
 */
export const PANEL_HTML = `<style>
*{box-sizing:border-box}
#a{--s:var(--tg-theme-secondary-bg-color);--h:var(--tg-theme-hint-color);--b:var(--tg-theme-button-color);--d:var(--tg-theme-destructive-text-color);--g:#31b545;display:flex;flex-direction:column;gap:10px}
button{font:inherit;color:inherit;border:0;margin:0;padding:0;background:none;text-align:left;position:relative;transition:transform .15s}
button:active{transform:scale(.96)}
.z button{pointer-events:none}
b,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
small{color:var(--h);font-size:.8em}
.H{display:flex;align-items:center;gap:10px}
.I{width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.35em;flex:none;background:linear-gradient(135deg,var(--b),var(--tg-theme-accent-text-color));animation:p .45s cubic-bezier(.3,1.6,.5,1)}
.B{width:30px;height:30px;border-radius:15px;background:var(--s);text-align:center;font-size:1.3em;line-height:28px;flex:none}
.T,.X{flex:1;min-width:0}
.T b{font-size:1.1em}
.P{display:flex;align-items:center;gap:6px}
.P u{width:7px;height:7px;border-radius:50%;background:var(--h);flex:none}
.v u{background:var(--g);animation:q 1.2s ease-in-out infinite}
.y u{background:var(--b)}
.N{padding:8px 11px;border-radius:10px;background:var(--s);font-size:.9em;border-left:3px solid var(--b);animation:u .3s}
.N1{border-color:var(--g)}
.N2{border-color:var(--d)}
.Q{display:flex;gap:4px}
.Q i{flex:1;height:4px;border-radius:2px;background:var(--s)}
.Q .o{background:var(--b)}
.Q .c{animation:f .5s ease-out;transform-origin:0 0}
.C{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.C button,.L button,.M{background:var(--s);border-radius:13px;padding:9px 12px;min-width:0}
.C button,.L button{animation:u .35s both;animation-delay:calc(var(--i)*40ms)}
.C b{margin-top:2px}
.M{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}
.M div{width:100%;height:6px;border-radius:3px;background:var(--tg-theme-bg-color);overflow:hidden}
.M i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--b),var(--tg-theme-accent-text-color));transform-origin:0 0;animation:f .8s cubic-bezier(.2,.8,.2,1)}
.M .h{background:var(--d)}
.L{display:flex;flex-direction:column;gap:6px}
.L button{display:flex;align-items:center;gap:10px;width:100%}
.L .o{box-shadow:inset 0 0 0 1.5px var(--b)}
.x .L button{padding:6px 12px}
.K{width:22px;height:22px;border-radius:11px;border:2px solid var(--h);flex:none;text-align:center;font-size:.72em;font-weight:700;line-height:18px;color:var(--tg-theme-button-text-color)}
.K2,.K3{border-radius:7px}
.K1,.K3{border-color:var(--b);background:var(--b);animation:p .3s cubic-bezier(.3,1.6,.5,1)}
.K4{border:0;background:var(--tg-theme-bg-color);color:var(--h);line-height:22px}
.V{color:var(--h);font-size:1.2em}
.E{text-align:center;color:var(--h);padding:10px 0}
.E div{font-size:2.2em;animation:w 2s ease-in-out infinite alternate}
.W{display:flex;gap:6px;justify-content:center;padding:6px}
.W i{width:8px;height:8px;border-radius:4px;background:var(--b);animation:w .6s ease-in-out infinite alternate;animation-delay:calc(var(--i)*.15s)}
p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.G{display:flex;align-items:center;justify-content:center;gap:10px}
.G button{width:30px;height:30px;border-radius:15px;background:var(--s);text-align:center;font-size:1.2em;line-height:28px}
.G button:disabled{color:var(--h)}
.G i{width:6px;height:6px;border-radius:3px;background:var(--s)}
.G .o{width:16px;background:var(--b)}
.A{display:flex;gap:8px}
.A button{flex:1;min-width:0;text-align:center;padding:10px 6px;border-radius:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--s)}
.A .k{flex:none;width:44px}
.A .A0{background:linear-gradient(135deg,var(--b),var(--tg-theme-accent-text-color));color:var(--tg-theme-button-text-color)}
.A .A2{color:var(--d)}
.A .A3{background:var(--g);color:#fff}
.F,#o{text-align:center;color:var(--h);font-size:.82em;margin:0}
#o{color:var(--tg-theme-accent-text-color)}
.O{margin-top:8px;animation:u .3s}
.w::after{content:'';position:absolute;right:10px;top:50%;margin-top:-7px;width:14px;height:14px;border:2px solid var(--h);border-top-color:transparent;border-radius:50%;animation:r .7s linear infinite}
.w .V{visibility:hidden}
.Z{text-align:center;padding:6px 0}
.Z svg{width:46px;height:46px;fill:none;stroke:var(--h);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.Z1 svg{stroke:var(--g)}
.Z circle{stroke-dasharray:107;animation:d .6s ease-out both}
.Z path{stroke-dasharray:40;animation:e .35s .45s ease-out both}
@keyframes u{from{transform:translateY(10px) scale(.96)}}
@keyframes p{from{transform:scale(.4)}}
@keyframes f{from{transform:scaleX(0)}}
@keyframes q{50%{transform:scale(1.7)}}
@keyframes w{to{transform:translateY(-5px)}}
@keyframes r{to{transform:rotate(360deg)}}
@keyframes d{from{stroke-dashoffset:107}}
@keyframes e{from{stroke-dashoffset:40}}
</style>
<div id="a"></div><p id="o"></p>
<script>
var W=window.TelegramWidget,A=document.getElementById('a'),O=document.getElementById('o'),busy=0,last,tm;
var E={NOT_ALLOWED:'这个面板不能操作，请重新发送命令',BUSY:'上一个操作还在处理',RATE_LIMITED:'操作太快，请稍后再试',TIMEOUT:'机器人没有响应，请稍后重试'};
var S=['M12 20h16','M12 21l6 6 11-13','M14 14l12 12M26 14l-12 12'];
function el(t,c,x,p){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;if(p)p.append(e);return e}
function say(m){O.textContent=m||'';O.className=m?'O':''}
function buzz(f,x){try{W.HapticFeedback[f](x)}catch(e){}}
function done(b){busy=0;A.className=A.className.replace('z','');b.className=b.className.replace(' w','')}
function tap(b,d){
if(busy)return;busy=1;A.className+=' z';b.className+=' w';say();buzz('impactOccurred','light');
W.request(d).then(function(r){done(b);say(r.result)},function(e){done(b);say(E[e.code]||'请求失败，请重试');buzz('notificationOccurred','error')})
}
function btn(c,p,d,i){var b=el('button',c,null,p);if(i!=null)b.style.setProperty('--i',i);if(d)b.onclick=function(){tap(b,d)};else b.disabled=true;return b}
function two(n){return(n<10?'0':'')+n}
function clock(e,x,t){function f(){var n=Math.max(0,Math.floor(Date.now()/1000)-t);e.textContent=x+' '+two(Math.floor(n/60))+':'+two(n%60)}f();tm=setInterval(f,1000)}
function draw(){
if(W.chatData===last)return;
last=W.chatData;clearInterval(tm);
var s=null,x,r,b,t,k;
try{s=JSON.parse(last)}catch(e){}
if(!s)s={z:[0,'面板已失效','请重新发送命令']};
k=s.k||'';A.textContent='';A.className=(s.l&&s.l.length>7?'x':'')+(busy?' z':'');
if(x=s.z){
r=el('div','Z Z'+x[0],null,A);
r.innerHTML='<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><path d="'+S[x[0]]+'"/></svg>';
el('b','',x[1],r);if(x[2])el('small','',x[2],r);return
}
if(x=s.h){
r=el('div','H',null,A);
if(x[3])btn('B',r,k+x[3]).textContent='‹';
el('div','I',x[0],r);b=el('div','T',null,r);el('b','',x[1],b);
if(t=s.s){
b=el('small','P'+(t[0]==1?' v':t[0]==2?' y':''),null,b);el('u','',null,b);b=el('span','',t[1],b);
if(t[2])clock(b,t[1],t[2])
}else if(x[2])el('small','',x[2],b)
}
if(x=s.q){r=el('div','Q',null,A);for(t=0;t<x[1];t++)el('i',t<x[0]?'o':t==x[0]?'o c':'',null,r)}
if(x=s.n)el('div','N N'+x[0],x[1],A);
if(s.c){r=el('div','C',null,A);s.c.forEach(function(x,i){b=btn('',r,x[3]&&k+x[3],i);el('small','',x[0]+' '+x[1],b);el('b','',x[2],b)})}
if(x=s.m){r=el('div','M',null,A);el('small','',x[1],r);el('small','',x[2],r);b=el('i',x[0]>84?'h':'',null,el('div','',null,r));b.style.width=Math.max(2,Math.min(100,x[0]))+'%'}
if(s.l){
r=el('div','L',null,A);
s.l.forEach(function(x,i){
var m=x[3]||0;b=btn(m==1||m==3?'o':'',r,x[2]&&k+x[2],i);
if(m)el('span','K K'+m,m==4?i+1:m==1||m==3?'✓':'',b);
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
row.forEach(function(x){b=btn('A'+(x[2]||0)+(Array.from(x[0]).length<2?' k':''),r,x[1]&&k+x[1]);b.textContent=x[0]})
});
if(s.f)el('p','F',s.f,A)
}
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
