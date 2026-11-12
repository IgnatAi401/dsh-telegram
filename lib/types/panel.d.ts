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
export declare const MAX_PANEL_STATE_BYTES = 1024;
export type PanelButtonStyle = 'primary' | 'ghost' | 'danger' | 'success';
/** Leading mark of a list row: a chevron, the current choice, a checkbox, or its number. */
export type PanelRowMark = 'none' | 'current' | 'unchecked' | 'checked' | 'number';
/**
 * Built-in line icons drawn by the renderer, each with its own accent colour.
 * Any other string is shown as text, so an old state with an emoji still renders.
 */
export type PanelIcon = 'panel' | 'folder' | 'chat' | 'model' | 'spark' | 'shield' | 'ask';
export interface PanelButton {
    readonly text: string;
    /** Request data sent on a tap, without the panel's prefix; omitted draws a disabled control. */
    readonly data?: string;
    readonly style?: PanelButtonStyle;
}
export interface PanelTile {
    readonly icon: PanelIcon;
    readonly label: string;
    readonly value: string;
    readonly data?: string;
}
export interface PanelRow {
    readonly title: string;
    readonly subtitle?: string;
    readonly data?: string;
    readonly mark?: PanelRowMark;
}
export interface Panel {
    /** Common prefix of every control's request data. */
    readonly prefix?: string;
    /** Icon badge, title and a line below it; `back` adds a round back button. */
    readonly header?: {
        readonly icon: PanelIcon;
        readonly title: string;
        readonly subtitle?: string;
        readonly back?: string;
    };
    /** Replaces the header's subtitle with a status dot; `since` (Unix seconds) adds a running clock. */
    readonly status?: {
        readonly kind: 'idle' | 'live' | 'wait';
        readonly text: string;
        readonly since?: number;
    };
    readonly notice?: {
        readonly kind: 'info' | 'ok' | 'error';
        readonly text: string;
    };
    /** Progress through a batch of questions; `index` is zero-based. */
    readonly steps?: {
        readonly index: number;
        readonly total: number;
    };
    /** Two-column cards. */
    readonly tiles?: readonly PanelTile[];
    /** A labelled bar filled to `percent`. */
    readonly meter?: {
        readonly percent: number;
        readonly caption: string;
        readonly label: string;
    };
    readonly rows?: readonly PanelRow[];
    /** Navigation lists use selection marks without an outline around each row. */
    readonly plainRows?: boolean;
    /** Placeholder for an empty list. */
    readonly empty?: {
        readonly icon: PanelIcon;
        readonly text: string;
    };
    readonly text?: string;
    /** Bouncing dots: the bridge is waiting for the user's next message. */
    readonly listening?: boolean;
    /** `page` is zero-based; a missing `prev`/`next` disables that arrow. */
    readonly pager?: {
        readonly page: number;
        readonly pages: number;
        readonly prev?: string;
        readonly next?: string;
    };
    readonly actions?: readonly (readonly PanelButton[])[];
    readonly footer?: string;
    /** A finished panel: nothing but an outcome mark and one or two lines. */
    readonly closed?: {
        readonly kind: 'neutral' | 'success' | 'cancelled';
        readonly title: string;
        readonly text?: string;
    };
}
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
export declare const PANEL_HTML = "<!doctype html><style>\n*{box-sizing:border-box}\nhtml{height:auto;min-height:0;--h:var(--tg-theme-hint-color);--b:var(--tg-theme-button-color);--s:rgba(120,120,128,.14);--s2:rgba(120,120,128,.28);--d:#e44;--g:#2a5;background:none;color:var(--tg-theme-text-color)}\nbody{position:relative;height:auto;min-height:0;margin:0;padding:12px 12px max(12px,var(--tg-content-safe-area-inset-bottom,0px));background:none}\n#a{display:flex;flex-direction:column;gap:10px}\nbutton{appearance:none;font:inherit;color:inherit;border:0;margin:0;padding:0;min-height:0;background:none;text-align:left;position:relative}\nb,small,.A button,#o{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\nsmall{color:var(--h);font-size:.8em}\nsvg{display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\n.H{display:flex;align-items:center;gap:12px}\n.I{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--c,var(--s));color:#fff}\n.I svg{width:21px;height:21px}\n.B,.G button{width:30px;height:30px;border-radius:15px;background:var(--s);text-align:center;font-size:1.25em;line-height:28px;flex:none}\n.T,.X{flex:1;min-width:0}\n.H .T b{position:relative;font-size:1.12em;padding-right:var(--ns,24px)}\n.P{display:flex;align-items:center;gap:6px;padding:3px;margin:-3px}\n.P u{width:7px;height:7px;border-radius:50%;background:var(--h);flex:none}\n.live u{background:var(--g);animation:q 1.2s ease-in-out infinite}\n.y u{background:#f90}\n.Q{display:flex;gap:4px}\n.Q i{flex:1;height:4px;border-radius:2px;background:var(--s2)}\n.C{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n.C button,.L button,.M{background:var(--s);border-radius:14px;padding:10px 12px;min-width:0}\n.C small{display:flex;align-items:center;gap:5px}\n.j{color:var(--c);flex:none}\n.j svg{width:15px;height:15px}\n.C b{margin-top:4px}\n.M{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}\n.M div{width:100%;height:6px;border-radius:3px;background:var(--s2)}\n.M i{display:block;height:100%;border-radius:3px}\n.M .high{background:var(--d)}\n.L{display:flex;flex-direction:column;gap:6px}\n.L button{display:flex;align-items:center;gap:10px;width:100%;min-height:calc(2.25em + 16px);padding:7px 12px}\n.L b,.L small{line-height:1.25em;min-height:1.25em}\n.L .o{box-shadow:inset 0 0 0 1.5px var(--b)}\n.K{width:22px;height:22px;border-radius:11px;border:2px solid var(--h);flex:none;text-align:center;font-size:.72em;font-weight:700;line-height:18px;color:#fff}\n.K2,.K3{border-radius:7px}\n.K1,.K3{border-color:var(--b);background:var(--b)}\n.K4{border:0;background:var(--s2);color:inherit;line-height:22px}\n.V{color:var(--h)}\n.E svg{width:34px;height:34px}\n.W{display:flex;gap:6px;justify-content:center;padding:6px}\n.W i{width:8px;height:8px;border-radius:4px;animation:w .6s ease-in-out infinite alternate;animation-delay:calc(var(--i)*.15s)}\np{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}\n.G{display:flex;align-items:center;justify-content:center;gap:10px}\nbutton:disabled{color:var(--h)}\n.G i{width:6px;height:6px;border-radius:3px;background:var(--s2)}\n.G .o{width:16px}\n.Q .o,.G .o,.M i,.W i{background:var(--b)}\n.A{display:flex;gap:8px}\n.A button{flex:1;min-width:0;height:42px;line-height:42px;text-align:center;padding:0 6px;border-radius:13px;font-weight:600;background:var(--s)}\n.A .A0{flex:2;background:var(--b);color:var(--tg-theme-button-text-color)}\n.A .A2{color:var(--d)}\n.A .A3{background:var(--g);color:#fff}\n.F{text-align:center;color:var(--h);font-size:.82em}\n#o{display:none;position:absolute;right:12px;top:14px;max-width:min(36vw,140px);color:var(--b);font-size:.78em;line-height:1.4em}\n#o.message{display:block}\n#o.N1{color:var(--g)}\n#o.N2{color:var(--d)}\n.busy .H .T b::after{content:'';position:absolute;right:0;top:50%;margin-top:-7px;width:14px;height:14px;border:2px solid var(--h);border-top-color:transparent;border-radius:50%;animation:r .7s linear infinite}\n.E,.Z{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:8px 0}\n.E{color:var(--h)}\n.Z .T{flex:none;width:100%}\n.Z svg{width:48px;height:48px;stroke:var(--h);stroke-width:1.8}\n.Z1 svg{stroke:var(--g)}\n.Z2 svg{stroke:var(--d)}\n@keyframes q{50%{transform:scale(1.7)}}\n@keyframes w{to{transform:translateY(-5px)}}\n@keyframes r{to{transform:rotate(360deg)}}\n</style>\n<div id=\"a\"></div><p id=\"o\"></p>\n<script>\nvar W=window.TelegramWidget,A=document.getElementById('a'),O=document.getElementById('o'),busy=0,last,tm,note,closed,pend,tw;\nvar E={NOT_ALLOWED:'\u9762\u677F\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u547D\u4EE4',BUSY:'\u4E0A\u4E2A\u64CD\u4F5C\u8FD8\u5728\u5904\u7406',RATE_LIMITED:'\u64CD\u4F5C\u592A\u5FEB\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5',TIMEOUT:'\u673A\u5668\u4EBA\u65E0\u54CD\u5E94\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5'};\nvar C='M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',S=['M8 12h8','M8 12l3 3 5-6','M9 9l6 6m0-6-6 6'];\nfunction sv(d){return'<svg viewBox=\"0 0 24 24\"><path d=\"'+d+'\"/></svg>'}\nfunction el(t,c,x,p){\nvar e=p&&p.children[p._n++];\nif(!e||e.tagName.toLowerCase()!=t){var old=e;e=document.createElement(t);if(p){p.insertBefore(e,old||null);if(old)old.remove()}}\ne._n=0;e.className=c||'';\nif(x!=null){if(e.textContent!=String(x))e.textContent=x}else if(e._leaf)e.textContent='';\ne._leaf=x!=null;return e\n}\nfunction trim(p){if(p._leaf)return;while(p.children.length>p._n)p.lastElementChild.remove();Array.from(p.children).forEach(trim)}\nfunction say(m){m=closed||busy?'':String(m||'').replace(/\\p{P}+/gu,' ').replace(/\\s+/g,' ').trim();O.textContent=m;O.className=m?'message'+(note?' N'+note[0]:''):'';A.style.setProperty('--ns',m?'min(36vw,140px)':'24px')}\nvar G={panel:['#55e','M4 4h16v16H4zm8 0v16M4 12h16'],folder:['#f90','M3 5h6l2 2h10v12H3z'],chat:['#08f','M4 5h16v11H9l-5 4z'],model:['#85f','M7 7h10v10H7zm5-4v4m0 10v4M3 12h4m10 0h4'],spark:['#e48','M13 3 5 14h6l-1 7 8-11h-6z'],shield:['#1a5','M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zm-3 9 2 2 4-4'],ask:['#08f',C+'m-2 7a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.6m0 3v.1']};\nfunction ic(n,c,p){var g=G[n],e=el('span',c,g?null:n,p);e.style.setProperty('--c',g?g[0]:'');if(g){e.innerHTML=sv(g[1]);e._leaf=1}return e}\nfunction buzz(f,x){try{W.HapticFeedback[f](x)}catch(e){}}\nfunction done(m){clearTimeout(tw);pend=busy=0;A.className='';say(m||(note&&note[1]))}\nfunction failed(e){done(E[e&&e.code]||'\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5');buzz('notificationOccurred','error')}\nfunction tap(d){\nif(busy)return;busy=1;A.className='busy';say();buzz('impactOccurred','light');var at=last;\ntry{W.request(d).then(function(r){r.result||last!=at?done(r.result):tw=setTimeout(done,pend=3e3)},failed)}catch(e){failed(e)}\n}\nfunction btn(c,p,d){var b=el('button',c,null,p);b.disabled=!d;b.onclick=d?function(){tap(d)}:null;return b}\nfunction two(n){return(n<10?'0':'')+n}\nfunction clock(e,x,t){function f(){var n=Math.max(0,Date.now()/1e3-t|0);e.textContent=x+' '+two(n/60|0)+':'+two(n%60)}f();tm=setInterval(f,1e3)}\nfunction draw(){\nif(W.chatData===last)return;\nlast=W.chatData;clearInterval(tm);pend&&done();\nvar s=null,x,r,b,t,k;\ntry{s=JSON.parse(last)}catch(e){}\nif(!s)s={z:[0,'\u9762\u677F\u5DF2\u5931\u6548','\u8BF7\u91CD\u65B0\u53D1\u9001\u547D\u4EE4']};\nk=s.k||'';A._n=0;A.className=busy?'busy':'';note=s.n;closed=!!s.z;say(note&&note[1]);\nif(x=s.z){\nr=el('div','Z Z'+x[0],null,A);\nt=el('div','',null,r);t.innerHTML=sv(C+S[x[0]]);t._leaf=true;\nb=el('span','T',null,r);el('b','',x[1],b);if(x[2])el('small','',x[2],b);trim(A);return\n}\nif(x=s.h){\nr=el('div','H',null,A);\nif(x[3])btn('B',r,k+x[3]).textContent='\u2039';\nic(x[0],'I',r);b=el('div','T',null,r);el('b','',x[1],b);\nif(t=s.s){\nb=el('small','P'+(t[0]==1?' live':t[0]==2?' y':''),null,b);el('u','',null,b);b=el('span','',t[1],b);\nif(t[2])clock(b,t[1],t[2])\n}else el('small','',x[2]||'\u00A0',b)\n}\nif(x=s.q){r=el('div','Q',null,A);for(t=0;t<x[1];t++)el('i',t<=x[0]?'o':'',null,r)}\nif(s.c){r=el('div','C',null,A);s.c.forEach(function(x){b=btn('',r,x[3]&&k+x[3]);t=el('small','',null,b);ic(x[0],'j',t);el('span','',x[1],t);el('b','',x[2],b)})}\nif(x=s.m){r=el('div','M',null,A);el('small','',x[1],r);el('small','',x[2],r);b=el('i',x[0]>84?'high':'',null,el('div','',null,r));b.style.width=Math.max(2,Math.min(100,x[0]))+'%'}\nif(s.l){\nr=el('div','L',null,A);\ns.l.forEach(function(x,i){\nvar m=x[3]||0;b=btn(m==1||m==3?'o':'',r,x[2]&&k+x[2]);\nel('span','K K'+m,m==4?i+1:m==1||m==3?'\u2713':'',b);\nt=el('span','X',null,b);el('b','',x[0],t);if(x[1])el('small','',x[1],t);\nif(m<2)el('span','V','\u203A',b)\n})\n}\nif(x=s.e){r=el('div','E',null,A);ic(x[0],'',r);el('small','',x[1],r)}\nif(s.t)el('p','',s.t,A);\nif(s.w){r=el('div','W',null,A);for(t=0;t<3;t++)el('i','',null,r).style.setProperty('--i',t)}\nif(x=s.p){\nr=el('div','G',null,A);btn('',r,x[2]&&k+x[2]).textContent='\u2039';\nif(x[1]<9)for(t=0;t<x[1];t++)el('i',t==x[0]?'o':'',null,r);else el('small','',x[0]+1+' / '+x[1],r);\nbtn('',r,x[3]&&k+x[3]).textContent='\u203A'\n}\n(s.a||[]).forEach(function(row){\nr=el('div','A',null,A);\nrow.forEach(function(x){b=btn('A'+(x[2]||0),r,x[1]&&k+x[1]);b.textContent=x[0]})\n});\nif(s.f)el('p','F',s.f,A)\ntrim(A)\n}\nif(W.setResizeAnchor)W.setResizeAnchor('top');\nW.onEvent('chatDataChanged',draw);\ndraw();\nif(W.ready)W.ready();\n</script>";
/** Cut to at most `maxBytes` of UTF-8 without splitting a character, ending in an ellipsis. */
export declare function truncateBytes(text: string, maxBytes: number): string;
/**
 * Serialize a panel into a widget chat state of at most 1024 bytes. Titles and
 * details are shortened step by step, details first; request data is never altered.
 * @throws when the panel cannot fit even with the shortest labels.
 */
export declare function encodePanel(panel: Panel): string;
