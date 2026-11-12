/**
 * Built-in widget templates for `telegram_widget`: fixed HTML the Agent fills
 * with `data` only, so it does not have to write, size-check and re-send a
 * whole document. Each template reads its JSON from `TelegramWidget.chatData`
 * and redraws on `chatDataChanged`; the data formats are documented in
 * {@link WIDGET_TEMPLATES} and in the channel prompt.
 * @module telegram/widget-templates
 */

/**
 * Weather card: current conditions, three metric chips, a tappable 12-hour
 * temperature / rain-probability chart and a daily forecast. Weather codes are
 * WMO codes (as returned by Open-Meteo). Chips and unselected tabs sit on a faint
 * fill (not `<button>`s: Telegram paints those white) close to the control panel's tiles.
 */
const WEATHER_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:transparent}
body{color:var(--tg-theme-text-color);font:400 13px/1.35 -apple-system,system-ui,sans-serif}
#w{padding:10px 14px 12px}
.hd{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--tg-theme-hint-color)}
.hd b{color:var(--tg-theme-text-color);font-size:14px;font-weight:600}
.now{display:flex;align-items:center;gap:10px;margin-top:6px}
.tmp{font-size:44px;font-weight:300;letter-spacing:-2px;line-height:1}
.tmp sup{font-size:17px;font-weight:400;vertical-align:top;letter-spacing:0}
.desc{font-size:13px;margin-top:3px}
.hl{font-size:11px;color:var(--tg-theme-hint-color);margin-top:3px}
.hero{margin-left:auto;flex:0 0 auto}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
html{--fill:rgba(0,0,0,.06)}
@media(prefers-color-scheme:dark){html{--fill:rgba(255,255,255,.08)}}
.chip{background:var(--fill);display:inline-flex;align-items:center;gap:3px;height:24px;line-height:1;border-radius:10px;padding:0 9px;font-size:11px;color:var(--tg-theme-hint-color)}
.chip b{color:var(--tg-theme-text-color);font-weight:600}
.tabs{display:flex;align-items:center;gap:6px;margin:12px 0 2px;font-size:11px}
.tab{background:var(--fill);display:inline-flex;align-items:center;height:22px;line-height:1;padding:0 10px;border-radius:99px;color:var(--tg-theme-hint-color)}
.tab.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
#tip{margin-left:auto;color:var(--tg-theme-hint-color);font-variant-numeric:tabular-nums}
.cvw{height:92px;touch-action:manipulation}
svg{display:block}
.days{margin-top:8px;border-top:1px solid var(--tg-theme-secondary-bg-color);padding-top:5px}
.day{display:flex;align-items:center;gap:7px;padding:3.5px 0;font-size:12px}
.nm{width:38px}
.md{width:36px;font-size:11px;color:var(--tg-theme-hint-color)}
.ic{width:17px;height:17px;display:flex;flex:0 0 auto}
.bar{flex:1;height:4px;border-radius:2px;background:var(--tg-theme-secondary-bg-color);overflow:hidden;min-width:16px}
.bar i{display:block;height:100%;border-radius:2px;background:#4dabf7}
.pp{width:30px;text-align:right;font-size:11px;color:var(--tg-theme-hint-color);font-variant-numeric:tabular-nums}
.tp{width:76px;text-align:right;font-variant-numeric:tabular-nums}
.tp em{color:var(--tg-theme-hint-color);font-style:normal}
.ft{margin-top:7px;font-size:10px;color:var(--tg-theme-hint-color);text-align:right}
</style></head><body>
<div id="w">
<div class="hd"><span><b id="city"></b> <span id="area"></span></span><span id="up"></span></div>
<div class="now"><div><div class="tmp" id="t"></div><div class="desc" id="desc"></div><div class="hl" id="hl"></div></div><div class="hero" id="hero"></div></div>
<div class="chips" id="chips"></div>
<div class="tabs"><span class="tab on" data-m="t">气温</span><span class="tab" data-m="p">降雨概率</span><span id="tip"></span></div>
<div class="cvw" id="cvw"></div>
<div class="days" id="days"></div>
<div class="ft" id="ft"></div>
</div>
<script>
(function(){
var TW=window.TelegramWidget||{},D={},c={},H=[],Y=[],mode='t',sel=-1;
try{D=JSON.parse(TW.chatData||'{}')||{}}catch(e){}
c=D.cur||{};H=D.hourly||[];Y=D.daily||[];
function $(s){return document.querySelector(s)}
function dsc(w){return w<1?'晴':w<3?'多云':w<4?'阴':w<49?'阴':w<58?'毛毛雨':w<68?'小雨':w<78?'雪':w<83?'阵雨':w<90?'雷阵雨':'阴'}
var CL='<path d="M6.8 17.6h10.6a3.9 3.9 0 0 0 .2-7.8 6 6 0 0 0-11.4-.7 3.8 3.8 0 0 0 .6 8.5z" fill="#9fb3c8"/>';
function ic(w,s){
 var b='<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24">';
 if(w<1)return b+'<circle cx="12" cy="12" r="4.6" fill="#f5a524"/><g stroke="#f5a524" stroke-width="1.7" stroke-linecap="round"><path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7"/></g></svg>';
 if(w<3)return b+'<circle cx="9.4" cy="9.6" r="3.9" fill="#f5a524"/><g stroke="#f5a524" stroke-width="1.6" stroke-linecap="round"><path d="M9.4 3v1.9M9.4 14.3v1.9M2.8 9.6h1.9M4.7 4.9l1.3 1.3M12.8 12.9l1.3 1.3M4.9 14.4l1.4-1.4"/></g><path d="M8.6 20h9.2a3.4 3.4 0 0 0 .2-6.8 5.2 5.2 0 0 0-9.9-.6A3.3 3.3 0 0 0 8.6 20z" fill="#9fb3c8" stroke="var(--tg-theme-bg-color)" stroke-width="1.2"/></svg>';
 if(w<49)return b+CL+'</svg>';
 if(w<70)return b+CL+'<g stroke="#4dabf7" stroke-width="1.7" stroke-linecap="round"><path d="M8.6 19.4l-.8 2.2M12.2 19.6l-.8 2.2M15.8 19.4l-.8 2.2"/></g></svg>';
 if(w<80)return b+CL+'<g fill="#d7e6f5"><circle cx="9" cy="20.4" r="1.1"/><circle cx="13" cy="21.6" r="1.1"/><circle cx="16.4" cy="19.8" r="1.1"/></g></svg>';
 if(w<90)return b+CL+'<g stroke="#4dabf7" stroke-width="1.7" stroke-linecap="round"><path d="M7.4 19.6l-.9 2.4M11.6 19.6l-.9 2.4M15.8 19.6l-.9 2.4M20 19.6l-.9 2.4"/></g></svg>';
 return b+CL+'<path d="M12.8 18.6l-1.9 3.2h2.4l-1.3 2.2" stroke="#f5a524" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}
function render(){
 $('#city').textContent=D.city||'';
 $('#area').textContent=D.area?'· '+D.area:'';
 $('#up').textContent=D.up||'';
 $('#t').innerHTML=(c.t==null?'--':c.t)+'<sup>°</sup>';
 $('#desc').textContent=dsc(c.code||0);
 $('#hl').textContent='最高 '+c.hi+'° / 最低 '+c.lo+'°';
 $('#hero').innerHTML=ic(c.code||0,60);
 $('#chips').innerHTML='<span class="chip">体感 <b>'+c.f+'°</b></span><span class="chip">湿度 <b>'+c.h+'%</b></span><span class="chip">风 <b>'+c.w+' km/h</b> '+c.wd+'</span>';
 $('#days').innerHTML=Y.map(function(o){
  return '<div class="day"><span class="nm">'+o.d+'</span><span class="md">'+o.md+'</span><span class="ic">'+ic(o.code,17)+'</span><span class="bar"><i style="width:'+o.p+'%"></i></span><span class="pp">'+o.p+'%</span><span class="tp">'+o.lo+'°<em> / </em>'+o.hi+'°</span></div>'}).join('');
 $('#tip').textContent='今日 '+c.lo+'° ~ '+c.hi+'°';
 $('#ft').textContent=(D.src?'数据 '+D.src+' · ':'')+'点图表看逐时';
}
function chart(){
 if(!H.length)return '';
 var w=$('#cvw').clientWidth||320,h=92,n=H.length,pl=6,pr=6,pt=16,pb=16,iw=w-pl-pr,ih=h-pt-pb;
 var x=function(i){return (pl+iw*i/(n-1)).toFixed(1)};
 var V=H.map(function(o){return mode==='t'?o.t:o.p});
 var mn=Math.min.apply(null,V),mx=Math.max.apply(null,V);
 if(mode==='t'){mn-=1.5;mx+=1.5}else{mn=0;mx=100}
 var y=function(v){return (pt+ih*(1-(v-mn)/(mx-mn))).toFixed(1)};
 var s='<svg width="100%" height="92" viewBox="0 0 '+w+' 92" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5a524" stop-opacity=".3"/><stop offset="1" stop-color="#f5a524" stop-opacity="0"/></linearGradient></defs>';
 [0,.5,1].forEach(function(f){var yy=(pt+ih*f).toFixed(1);s+='<line x1="'+pl+'" y1="'+yy+'" x2="'+(w-pr)+'" y2="'+yy+'" stroke="#888" stroke-opacity=".22" stroke-width="1"/>'});
 var i,pts=[];
 for(i=0;i<n;i++)pts.push(x(i)+','+y(V[i]));
 if(mode==='t'){
  s+='<polygon points="'+pts.join(' ')+' '+x(n-1)+','+(h-pb)+' '+x(0)+','+(h-pb)+'" fill="url(#g)"/>';
  s+='<polyline points="'+pts.join(' ')+'" fill="none" stroke="#f5a524" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  for(i=0;i<n;i++)s+='<circle cx="'+x(i)+'" cy="'+y(V[i])+'" r="'+(i===sel?3.8:2)+'" fill="'+(i===sel?'#f5a524':'#fff')+'" stroke="#f5a524" stroke-width="1.4"/>';
 }else{
  var bw=Math.max(iw/(n-1)*.52,3);
  for(i=0;i<n;i++){var by=+y(V[i]),bh=h-pb-by;
   s+='<rect x="'+(x(i)-bw/2)+'" y="'+by+'" width="'+bw+'" height="'+Math.max(bh,1.5)+'" rx="2" fill="#4dabf7" fill-opacity="'+(i===sel?1:.45)+'"/>';}
 }
 if(sel>=0)s+='<line x1="'+x(sel)+'" y1="'+pt+'" x2="'+x(sel)+'" y2="'+(pt+ih)+'" stroke="#888" stroke-opacity=".45" stroke-dasharray="3 3"/>';
 [0,3,6,9,n-1].forEach(function(k){
  s+='<text x="'+x(k)+'" y="'+(h-4)+'" font-size="10" fill="#888" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif">'+H[k].h+'</text>';
 });
 for(i=0;i<n;i++){var xa=Math.max(+x(i)-iw/(n-1)/2,0),xb=Math.min(+x(i)+iw/(n-1)/2,w);
  s+='<rect x="'+xa+'" y="'+pt+'" width="'+Math.max(xb-xa,1)+'" height="'+(h-pt)+'" fill="none" pointer-events="all" data-i="'+i+'"/>';}
 return s+'</svg>';
}
function drawChart(){$('#cvw').innerHTML=chart()}
function pick(i){
 var o=H[i];if(!o)return;
 sel=i;drawChart();
 $('#tip').textContent=o.h+'时 '+o.t+'° · 雨 '+o.p+'%';
 if(TW.HapticFeedback)try{TW.HapticFeedback.selectionChanged()}catch(e){}
}
$('#cvw').addEventListener('click',function(e){
 var t=e.target,ix=t&&t.getAttribute?t.getAttribute('data-i'):null;
 if(ix!=null)pick(+ix);
});
$('#cvw').addEventListener('touchstart',function(e){
 var t=document.elementFromPoint?document.elementFromPoint(e.touches[0].clientX,e.touches[0].clientY):null;
 var ix=t&&t.getAttribute?t.getAttribute('data-i'):null;
 if(ix!=null){e.preventDefault();pick(+ix)}
},{passive:false});
render();drawChart();
try{window.addEventListener('resize',drawChart)}catch(e){}
try{
 var tabs=document.querySelectorAll('.tab'),k;
 for(k=0;k<tabs.length;k++)(function(el){
  el.addEventListener('click',function(){
   var a=document.querySelectorAll('.tab'),j;
   for(j=0;j<a.length;j++)a[j].classList.remove('on');
   el.classList.add('on');mode=el.getAttribute('data-m');sel=-1;drawChart();
   $('#tip').textContent=mode==='t'?'点圆点看逐时':'点柱看降雨概率';
   if(TW.HapticFeedback)try{TW.HapticFeedback.impactOccurred('light')}catch(e){}
  });
 })(tabs[k]);
}catch(e){}
try{
 if(TW.onEvent)TW.onEvent('chatDataChanged',function(){
  try{var nd=JSON.parse(TW.chatData||'{}');if(nd&&nd.cur){D=nd;c=nd.cur;H=nd.hourly||H;Y=nd.daily||Y;render();drawChart()}}catch(e){}
 });
 if(TW.ready)TW.ready();
}catch(e){}
})();
</script>
</body></html>
`

export interface WidgetTemplate {
  readonly html: string
  /** Data format, shown to the model in the tool description and the channel prompt. */
  readonly format: string
}

export const WIDGET_TEMPLATES = {
  weather: {
    html: WEATHER_HTML,
    format: 'weather（天气卡片）：{"city":"上海","area":"徐汇","up":"10:15 更新","src":"Open-Meteo",'
      + '"cur":{"t":16.6,"f":17.5,"h":87,"w":3.6,"wd":"西南风","code":3,"hi":18.2,"lo":13.3},'
      + '"hourly":[{"h":"10","t":16.5,"p":7},…],"daily":[{"d":"今天","md":"11/12","lo":13.3,"hi":18.2,"p":88,"code":53},…]}。'
      + 'cur：t 气温、f 体感、h 湿度 %、w 风速 km/h、wd 风向文字、code 天气代码（WMO，与 Open-Meteo 的 weather_code 相同）、hi/lo 今日最高/最低；'
      + 'hourly 是从当前整点起的 12 个小时（h 小时、t 气温、p 降雨概率 %），daily 是 5 天（d 星期、md 月/日、lo/hi、p 降雨概率、code）。'
      + 'area、up、src 可省略。温度保留一位小数，整个 data 不超过 1024 字节。',
  },
} as const satisfies Record<string, WidgetTemplate>

export type WidgetTemplateName = keyof typeof WIDGET_TEMPLATES
