(() => {
'use strict';
if(window===window.top || (location.hostname==='api.ydydapi.com' && /^\/v1\/Yl\/player\//.test(location.pathname)))return;
const VERSION='2.6.0';const old=globalThis.__videoShortcutGenericFrame;if(old?.version===VERSION)return;try{old?.dispose();}catch(_){}
let stopped=false,busy=false;
function main(){let best=null;function scan(root,depth=0){if(depth>8)return;for(const el of root.querySelectorAll('*')){if(el.shadowRoot)scan(el.shadowRoot,depth+1);if(el.tagName!=='VIDEO')continue;const r=el.getBoundingClientRect(),s=getComputedStyle(el),area=Math.max(0,Math.min(innerWidth,r.right)-Math.max(0,r.left))*Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top));if(r.width<160||r.height<90||area<=0||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)continue;if(!best||area>best.area)best={el,r,area};}}scan(document);return best;}
async function report(){if(stopped||busy)return;if(!chrome.runtime?.id){dispose();return;}const v=main();if(!v)return;busy=true;try{await chrome.runtime.sendMessage({target:'background',type:'registerGenericFramePlayer',player:{width:v.r.width,height:v.r.height,duration:Number.isFinite(v.el.duration)?v.el.duration:null,ready:v.el.readyState,protected:!!v.el.mediaKeys}});}catch(_){}finally{busy=false;}}
function dispose(){stopped=true;clearInterval(timer);document.removeEventListener('DOMContentLoaded',report);}
const timer=setInterval(report,1800);globalThis.__videoShortcutGenericFrame={version:VERSION,dispose};document.addEventListener('DOMContentLoaded',report,{once:true});report();
})();
