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
export interface PanelButton {
    readonly text: string;
    /** Request data sent on a tap, without the panel's prefix; omitted draws a disabled control. */
    readonly data?: string;
    readonly style?: PanelButtonStyle;
}
export interface PanelTile {
    readonly icon: string;
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
        readonly icon: string;
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
    /** Placeholder for an empty list. */
    readonly empty?: {
        readonly icon: string;
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
 * The renderer. It rebuilds the panel whenever the bridge changes the state,
 * blocks further taps while a request is in flight, and shows each answer's
 * text (or why the request failed) in a line under the panel. Telegram refuses
 * a widget whose HTML exceeds 4096 bytes after zlib compression.
 */
export declare const PANEL_HTML = "<style>\n*{box-sizing:border-box}\n#a{--s:var(--tg-theme-secondary-bg-color);--h:var(--tg-theme-hint-color);--b:var(--tg-theme-button-color);--d:var(--tg-theme-destructive-text-color);--g:#31b545;display:flex;flex-direction:column;gap:10px}\nbutton{font:inherit;color:inherit;border:0;margin:0;padding:0;background:none;text-align:left;position:relative;transition:transform .15s}\nbutton:active{transform:scale(.96)}\n.z button{pointer-events:none}\nb,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\nsmall{color:var(--h);font-size:.8em}\n.H{display:flex;align-items:center;gap:10px}\n.I{width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.35em;flex:none;background:linear-gradient(135deg,var(--b),var(--tg-theme-accent-text-color));animation:p .45s cubic-bezier(.3,1.6,.5,1)}\n.B{width:30px;height:30px;border-radius:15px;background:var(--s);text-align:center;font-size:1.3em;line-height:28px;flex:none}\n.T,.X{flex:1;min-width:0}\n.T b{font-size:1.1em}\n.P{display:flex;align-items:center;gap:6px}\n.P u{width:7px;height:7px;border-radius:50%;background:var(--h);flex:none}\n.v u{background:var(--g);animation:q 1.2s ease-in-out infinite}\n.y u{background:var(--b)}\n.N{padding:8px 11px;border-radius:10px;background:var(--s);font-size:.9em;border-left:3px solid var(--b);animation:u .3s}\n.N1{border-color:var(--g)}\n.N2{border-color:var(--d)}\n.Q{display:flex;gap:4px}\n.Q i{flex:1;height:4px;border-radius:2px;background:var(--s)}\n.Q .o{background:var(--b)}\n.Q .c{animation:f .5s ease-out;transform-origin:0 0}\n.C{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n.C button,.L button,.M{background:var(--s);border-radius:13px;padding:9px 12px;min-width:0}\n.C button,.L button{animation:u .35s both;animation-delay:calc(var(--i)*40ms)}\n.C b{margin-top:2px}\n.M{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}\n.M div{width:100%;height:6px;border-radius:3px;background:var(--tg-theme-bg-color);overflow:hidden}\n.M i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--b),var(--tg-theme-accent-text-color));transform-origin:0 0;animation:f .8s cubic-bezier(.2,.8,.2,1)}\n.M .h{background:var(--d)}\n.L{display:flex;flex-direction:column;gap:6px}\n.L button{display:flex;align-items:center;gap:10px;width:100%}\n.L .o{box-shadow:inset 0 0 0 1.5px var(--b)}\n.x .L button{padding:6px 12px}\n.K{width:22px;height:22px;border-radius:11px;border:2px solid var(--h);flex:none;text-align:center;font-size:.72em;font-weight:700;line-height:18px;color:var(--tg-theme-button-text-color)}\n.K2,.K3{border-radius:7px}\n.K1,.K3{border-color:var(--b);background:var(--b);animation:p .3s cubic-bezier(.3,1.6,.5,1)}\n.K4{border:0;background:var(--tg-theme-bg-color);color:var(--h);line-height:22px}\n.V{color:var(--h);font-size:1.2em}\n.E{text-align:center;color:var(--h);padding:10px 0}\n.E div{font-size:2.2em;animation:w 2s ease-in-out infinite alternate}\n.W{display:flex;gap:6px;justify-content:center;padding:6px}\n.W i{width:8px;height:8px;border-radius:4px;background:var(--b);animation:w .6s ease-in-out infinite alternate;animation-delay:calc(var(--i)*.15s)}\np{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}\n.G{display:flex;align-items:center;justify-content:center;gap:10px}\n.G button{width:30px;height:30px;border-radius:15px;background:var(--s);text-align:center;font-size:1.2em;line-height:28px}\n.G button:disabled{color:var(--h)}\n.G i{width:6px;height:6px;border-radius:3px;background:var(--s)}\n.G .o{width:16px;background:var(--b)}\n.A{display:flex;gap:8px}\n.A button{flex:1;min-width:0;text-align:center;padding:10px 6px;border-radius:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--s)}\n.A .k{flex:none;width:44px}\n.A .A0{background:linear-gradient(135deg,var(--b),var(--tg-theme-accent-text-color));color:var(--tg-theme-button-text-color)}\n.A .A2{color:var(--d)}\n.A .A3{background:var(--g);color:#fff}\n.F,#o{text-align:center;color:var(--h);font-size:.82em;margin:0}\n#o{color:var(--tg-theme-accent-text-color)}\n.O{margin-top:8px;animation:u .3s}\n.w::after{content:'';position:absolute;right:10px;top:50%;margin-top:-7px;width:14px;height:14px;border:2px solid var(--h);border-top-color:transparent;border-radius:50%;animation:r .7s linear infinite}\n.w .V{visibility:hidden}\n.Z{text-align:center;padding:6px 0}\n.Z svg{width:46px;height:46px;fill:none;stroke:var(--h);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}\n.Z1 svg{stroke:var(--g)}\n.Z circle{stroke-dasharray:107;animation:d .6s ease-out both}\n.Z path{stroke-dasharray:40;animation:e .35s .45s ease-out both}\n@keyframes u{from{transform:translateY(10px) scale(.96)}}\n@keyframes p{from{transform:scale(.4)}}\n@keyframes f{from{transform:scaleX(0)}}\n@keyframes q{50%{transform:scale(1.7)}}\n@keyframes w{to{transform:translateY(-5px)}}\n@keyframes r{to{transform:rotate(360deg)}}\n@keyframes d{from{stroke-dashoffset:107}}\n@keyframes e{from{stroke-dashoffset:40}}\n</style>\n<div id=\"a\"></div><p id=\"o\"></p>\n<script>\nvar W=window.TelegramWidget,A=document.getElementById('a'),O=document.getElementById('o'),busy=0,last,tm;\nvar E={NOT_ALLOWED:'\u8FD9\u4E2A\u9762\u677F\u4E0D\u80FD\u64CD\u4F5C\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u547D\u4EE4',BUSY:'\u4E0A\u4E00\u4E2A\u64CD\u4F5C\u8FD8\u5728\u5904\u7406',RATE_LIMITED:'\u64CD\u4F5C\u592A\u5FEB\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5',TIMEOUT:'\u673A\u5668\u4EBA\u6CA1\u6709\u54CD\u5E94\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5'};\nvar S=['M12 20h16','M12 21l6 6 11-13','M14 14l12 12M26 14l-12 12'];\nfunction el(t,c,x,p){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;if(p)p.append(e);return e}\nfunction say(m){O.textContent=m||'';O.className=m?'O':''}\nfunction buzz(f,x){try{W.HapticFeedback[f](x)}catch(e){}}\nfunction done(b){busy=0;A.className=A.className.replace('z','');b.className=b.className.replace(' w','')}\nfunction tap(b,d){\nif(busy)return;busy=1;A.className+=' z';b.className+=' w';say();buzz('impactOccurred','light');\nW.request(d).then(function(r){done(b);say(r.result)},function(e){done(b);say(E[e.code]||'\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5');buzz('notificationOccurred','error')})\n}\nfunction btn(c,p,d,i){var b=el('button',c,null,p);if(i!=null)b.style.setProperty('--i',i);if(d)b.onclick=function(){tap(b,d)};else b.disabled=true;return b}\nfunction two(n){return(n<10?'0':'')+n}\nfunction clock(e,x,t){function f(){var n=Math.max(0,Math.floor(Date.now()/1000)-t);e.textContent=x+' '+two(Math.floor(n/60))+':'+two(n%60)}f();tm=setInterval(f,1000)}\nfunction draw(){\nif(W.chatData===last)return;\nlast=W.chatData;clearInterval(tm);\nvar s=null,x,r,b,t,k;\ntry{s=JSON.parse(last)}catch(e){}\nif(!s)s={z:[0,'\u9762\u677F\u5DF2\u5931\u6548','\u8BF7\u91CD\u65B0\u53D1\u9001\u547D\u4EE4']};\nk=s.k||'';A.textContent='';A.className=(s.l&&s.l.length>7?'x':'')+(busy?' z':'');\nif(x=s.z){\nr=el('div','Z Z'+x[0],null,A);\nr.innerHTML='<svg viewBox=\"0 0 40 40\"><circle cx=\"20\" cy=\"20\" r=\"17\"/><path d=\"'+S[x[0]]+'\"/></svg>';\nel('b','',x[1],r);if(x[2])el('small','',x[2],r);return\n}\nif(x=s.h){\nr=el('div','H',null,A);\nif(x[3])btn('B',r,k+x[3]).textContent='\u2039';\nel('div','I',x[0],r);b=el('div','T',null,r);el('b','',x[1],b);\nif(t=s.s){\nb=el('small','P'+(t[0]==1?' v':t[0]==2?' y':''),null,b);el('u','',null,b);b=el('span','',t[1],b);\nif(t[2])clock(b,t[1],t[2])\n}else if(x[2])el('small','',x[2],b)\n}\nif(x=s.q){r=el('div','Q',null,A);for(t=0;t<x[1];t++)el('i',t<x[0]?'o':t==x[0]?'o c':'',null,r)}\nif(x=s.n)el('div','N N'+x[0],x[1],A);\nif(s.c){r=el('div','C',null,A);s.c.forEach(function(x,i){b=btn('',r,x[3]&&k+x[3],i);el('small','',x[0]+' '+x[1],b);el('b','',x[2],b)})}\nif(x=s.m){r=el('div','M',null,A);el('small','',x[1],r);el('small','',x[2],r);b=el('i',x[0]>84?'h':'',null,el('div','',null,r));b.style.width=Math.max(2,Math.min(100,x[0]))+'%'}\nif(s.l){\nr=el('div','L',null,A);\ns.l.forEach(function(x,i){\nvar m=x[3]||0;b=btn(m==1||m==3?'o':'',r,x[2]&&k+x[2],i);\nif(m)el('span','K K'+m,m==4?i+1:m==1||m==3?'\u2713':'',b);\nt=el('span','X',null,b);el('b','',x[0],t);if(x[1])el('small','',x[1],t);\nif(m<2)el('span','V','\u203A',b)\n})\n}\nif(x=s.e){r=el('div','E',null,A);el('div','',x[0],r);el('small','',x[1],r)}\nif(s.t)el('p','',s.t,A);\nif(s.w){r=el('div','W',null,A);for(t=0;t<3;t++)el('i','',null,r).style.setProperty('--i',t)}\nif(x=s.p){\nr=el('div','G',null,A);btn('',r,x[2]&&k+x[2]).textContent='\u2039';\nif(x[1]<9)for(t=0;t<x[1];t++)el('i',t==x[0]?'o':'',null,r);else el('small','',x[0]+1+' / '+x[1],r);\nbtn('',r,x[3]&&k+x[3]).textContent='\u203A'\n}\n(s.a||[]).forEach(function(row){\nr=el('div','A',null,A);\nrow.forEach(function(x){b=btn('A'+(x[2]||0)+(Array.from(x[0]).length<2?' k':''),r,x[1]&&k+x[1]);b.textContent=x[0]})\n});\nif(s.f)el('p','F',s.f,A)\n}\nW.onEvent('chatDataChanged',draw);\ndraw();\nif(W.ready)W.ready();\n</script>";
/** Cut to at most `maxBytes` of UTF-8 without splitting a character, ending in an ellipsis. */
export declare function truncateBytes(text: string, maxBytes: number): string;
/**
 * Serialize a panel into a widget chat state of at most 1024 bytes. Titles and
 * details are shortened step by step, details first; request data is never altered.
 * @throws when the panel cannot fit even with the shortest labels.
 */
export declare function encodePanel(panel: Panel): string;
