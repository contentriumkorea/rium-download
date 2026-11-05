'use strict';
const button=document.getElementById('siteButton'), host=document.getElementById('hostname'), badge=document.getElementById('state'), message=document.getElementById('message');
const defaultSite='https://redko5.com';
const inPlayerMenu=location.pathname.endsWith('/player-menu.html');
const quickMode=inPlayerMenu&&location.hash.includes('&quick');
const outputMode=inPlayerMenu&&/(?:^#|&)audio(?:&|$)/.test(location.hash)?'audio':'video';
const prepareId=location.hash.match(/&prepare=([a-f0-9-]{36})(?:&|$)/)?.[1]||null;
const quickError=text=>{if(quickMode){if(prepareId)chrome.runtime.sendMessage({target:'background',type:'preparationFailed',id:prepareId,error:text}).catch(()=>{});parent.postMessage({source:'videoShortcutMenu',type:'quickError',text},'*');}};
let tab, site, pattern, current=false;
let selectedMediaFrameId=Number(location.hash.match(/(?:^#|&)frame=(\d+)/)?.[1]||0);
const setUI=(on,note)=>{current=on;button.disabled=false;document.getElementById('scan').disabled=!on;if(!on){document.getElementById('quality').disabled=true;document.getElementById('downloadButton').disabled=true;}button.setAttribute('aria-pressed',String(on));badge.textContent=on?'켜짐':'꺼짐';badge.classList.toggle('on',on);message.textContent=note || '';};
const scriptId=()=> 'site_'+btoa(site).replace(/[^a-zA-Z0-9]/g,'_');
(async()=>{try{if(inPlayerMenu && /^#\d+(?:&frame=\d+)?(?:&video=[a-f0-9-]{36})?(?:&prepare=[a-f0-9-]{36})?(?:&audio)?(?:&quick)?$/.test(location.hash))tab=await chrome.tabs.get(Number(location.hash.slice(1).split('&')[0]));else [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab || !tab.url)throw new Error('사이트 주소를 확인할 수 없습니다. 사이트를 연 뒤 확장 버튼을 눌러 주세요.');const url=new URL(tab.url);if(!['http:','https:'].includes(url.protocol))throw new Error('일반 웹사이트에서만 사용할 수 있습니다.');site=url.origin;pattern=site+'/*';host.textContent=url.hostname;const {sites={}}=await chrome.storage.local.get('sites');let on=Object.prototype.hasOwnProperty.call(sites,site)?!!sites[site]:site===defaultSite;if(on && site!==defaultSite)on=await chrome.permissions.contains({origins:[pattern]});setUI(on);if(on && inPlayerMenu)document.getElementById('scan').click();else if(quickMode&&!on)quickError('이 사이트에서 확장 프로그램을 먼저 켜 주세요.');}catch(e){host.textContent='사용할 수 없는 페이지';badge.textContent='사용 불가';message.textContent=e.message;quickError(e.message);}})();
button.addEventListener('click',async()=>{if(!tab || !site)return;const turnOn=!current;button.disabled=true;try{
  if(turnOn && site!==defaultSite){const granted=await chrome.permissions.request({origins:[pattern]});if(!granted){setUI(false,'사이트 접근 권한을 허용해야 사용할 수 있습니다.');return;}const existing=await chrome.scripting.getRegisteredContentScripts({ids:[scriptId()]});if(!existing.length)await chrome.scripting.registerContentScripts([{id:scriptId(),matches:[pattern],js:['x-support.js','instagram-support.js','shortcuts.js','download-widget.js','player-download.js'],runAt:'document_start',persistAcrossSessions:true}]);const watchers=await chrome.scripting.getRegisteredContentScripts({ids:[scriptId()+'_watch']});if(!watchers.length)await chrome.scripting.registerContentScripts([{id:scriptId()+'_watch',matches:[pattern],js:['media-watch.js'],world:'MAIN',runAt:'document_start',persistAcrossSessions:true}]);}
  if(!turnOn && site!==defaultSite){const existing=await chrome.scripting.getRegisteredContentScripts({ids:[scriptId()]});if(existing.length)await chrome.scripting.unregisterContentScripts({ids:[scriptId()]});const w=await chrome.scripting.getRegisteredContentScripts({ids:[scriptId()+'_watch']});if(w.length)await chrome.scripting.unregisterContentScripts({ids:[scriptId()+'_watch']});}
  const {sites={}}=await chrome.storage.local.get('sites');sites[site]=turnOn;await chrome.storage.local.set({sites});
  let note;
  if(turnOn){try{await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['media-watch.js']});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['x-support.js','instagram-support.js','shortcuts.js','download-widget.js','player-download.js']});}catch(_){note='설정했습니다. 페이지를 새로고침하면 적용됩니다.';}}
  if(turnOn){await chrome.runtime.sendMessage({target:'background',type:'repairRegistrations'});try{await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['generic-frame.js']});}catch(_){}}
  setUI(turnOn,note);
}catch(e){setUI(current,'설정을 변경하지 못했습니다: '+e.message);}});

const scan=document.getElementById('scan'), quality=document.getElementById('quality'), down=document.getElementById('downloadButton'), downMsg=document.getElementById('downloadMessage'), saveMode=document.getElementById('saveMode');
let candidates=[];
const xVideoToken=location.hash.match(/&video=([a-f0-9-]{36})(?:&|$)/)?.[1]||null;
chrome.storage.local.get('saveMode').then(x=>{saveMode.value=x.saveMode==='ask'?'ask':'default';});
saveMode.addEventListener('change',()=>chrome.storage.local.set({saveMode:saveMode.value}));
document.getElementById('openSettings').addEventListener('click',()=>chrome.tabs.create({url:'chrome://settings/downloads'}));
function collectDirectFiles(){
  const videos=[...document.querySelectorAll('video')].map(v=>{const r=v.getBoundingClientRect();return {v,area:r.width*r.height};}).filter(x=>x.area>0).sort((a,b)=>b.area-a.area);
  const v=videos[0]?.v;if(!v)return {items:[],hasVideo:false,reason:'이 페이지에서 영상 플레이어를 찾지 못했습니다.'};if(v.mediaKeys)return {items:[],reason:'보호된 영상은 다운로드할 수 없습니다.'};
  const items=[], seen=new Set();
  const add=(raw,label,type,isCurrent)=>{if(!raw)return;let u;try{u=new URL(raw,document.baseURI);}catch(_){return;}if(!['http:','https:'].includes(u.protocol)||/\.(m3u8|mpd)(?:$|\?)/i.test(u.pathname+u.search)||/mpegurl|dash\+xml/i.test(type||'')||seen.has(u.href))return;
    const fileLike=/\.(mp4|m4v|webm|ogv|mov)(?:$|\?)/i.test(u.pathname+u.search)||/^video\/(mp4|webm|ogg|quicktime)$/i.test(type||'');if(!fileLike)return;seen.add(u.href);let desc=(label||'').trim();if(!desc){const m=u.pathname.match(/(?:^|[^0-9])([0-9]{3,4})p(?:[^a-z]|$)/i);desc=m?m[1]+'p':'';}if(!desc && isCurrent && v.videoHeight)desc='현재 영상 ('+v.videoHeight+'p)';if(!desc)desc='제공된 영상 파일';items.push({url:u.href,label:desc,height:parseInt(desc.match(/(\d{3,4})p/)?.[1]||'0',10),bandwidth:0});};
  for(const s of v.querySelectorAll('source')){let label=s.getAttribute('label')||s.getAttribute('data-res')||s.getAttribute('res')||s.getAttribute('title')||'';if(/^\d{3,4}$/.test(label))label+='p';add(s.src,label,s.type,s.src===v.currentSrc);}
  add(v.currentSrc,'',v.getAttribute('type'),true);add(v.getAttribute('src'),'',v.getAttribute('type'),v.src===v.currentSrc);
  return {items,hasVideo:true,reason:items.length?'':'직접 영상 파일을 찾지 못했습니다. 스트리밍 또는 보호 영상은 지원되지 않을 수 있습니다.'};
}

async function collectHls(){
 const v=[...document.querySelectorAll('video')].map(v=>{const r=v.getBoundingClientRect();return {v,area:r.width*r.height};}).filter(x=>x.area>0).sort((a,b)=>b.area-a.area)[0]?.v;
 if(!v||v.mediaKeys||!Number.isFinite(v.duration)||v.duration<=0)return [];
 const found=[],seen=new Set();
 const entries=[...new Set([...performance.getEntriesByType('resource').map(e=>e.name),...(Array.isArray(globalThis.__videoShortcutStreams)?globalThis.__videoShortcutStreams:[])].filter(n=>{try{return new URL(n).pathname.toLowerCase().endsWith('.m3u8')}catch(_){return false}}))].slice(-12).reverse();
 const check=async(url,label,origin,depth,bandwidth=0)=>{try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||seen.has(u.href)||(origin&&u.origin!==origin))return;seen.add(u.href);const res=await fetch(u.href,{credentials:'omit'});if(!res.ok)return;const text=await res.text();if(text.length>2000000||!text.startsWith('#EXTM3U'))return;const lines=text.split(/\r?\n/).map(x=>x.trim());
  const variants=[];for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){const line=lines[i];if(/(?:^|,)AUDIO=/.test(line.slice(line.indexOf(':')+1)))continue;const next=lines.slice(i+1).find(x=>x&&!x.startsWith('#'));if(next)variants.push({url:new URL(next,u).href,label:(line.match(/RESOLUTION=([0-9]+x[0-9]+)/i)||[])[1]||'',bandwidth:Number((line.match(/(?:^|,)BANDWIDTH=(\d+)/)||[])[1]||0)});}
  if(variants.length&&depth===0){for(const x of variants.slice(0,8))await check(x.url,x.label,u.origin,depth+1,x.bandwidth);return;}
  if(!lines.includes('#EXT-X-ENDLIST')||lines.some(x=>/^#EXT-X-(MAP|BYTERANGE|DISCONTINUITY)(:|$)/.test(x)))return;
  const keys=lines.filter(x=>x.startsWith('#EXT-X-KEY:'));if(keys.some(x=>!(/METHOD=(NONE|AES-128)(?:,|$)/.test(x))||(/KEYFORMAT="([^"]+)"/.test(x)&&!x.includes('KEYFORMAT="identity"'))))return;
  const durations=lines.filter(x=>x.startsWith('#EXTINF:')).map(x=>parseFloat(x.slice(8)));if(!durations.length||durations.length>10000||durations.some(x=>!Number.isFinite(x)))return;const seconds=durations.reduce((a,b)=>a+b,0);if(Math.abs(seconds-v.duration)>Math.max(3,v.duration*0.005))return;
  found.push({url:u.href,kind:'hls',origins:u.origin==='https://api.ydydapi.com'?['https://api.ydydapi.com/*','https://res.ydydapi.com/*']:[u.origin+'/*'],height:Number(label.split('x')[1]||v.videoHeight||0),bandwidth,label:'HLS 스트림'+(label?' · '+label:' · 화질 정보 없음')+' (.mp4)'});
 }catch(_){}};
 for(const url of entries){await check(url,'',null,0);if(found.length>=8)break;}return found;
}
let pendingFrameOrigins=[];
const frameAccess=document.createElement('button');frameAccess.type='button';frameAccess.textContent='임베드 플레이어 연결';frameAccess.hidden=true;downMsg.before(frameAccess);
async function offerFrameAccess(){
 if(quickMode)return;
 const r=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>Array.from(document.querySelectorAll('iframe')).filter(f=>{const r=f.getBoundingClientRect();return r.width>=160&&r.height>=90&&r.bottom>0&&r.top<innerHeight;}).map(f=>f.src)});
 const origins=[...new Set((r[0]?.result||[]).flatMap(raw=>{try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?[u.origin+'/*']:[];}catch(_){return [];}}))].slice(0,8);
 pendingFrameOrigins=[];for(const origin of origins)if(!await chrome.permissions.contains({origins:[origin]}))pendingFrameOrigins.push(origin);
 frameAccess.hidden=!pendingFrameOrigins.length;if(pendingFrameOrigins.length)downMsg.textContent+=' 임베드 서버 접근 권한이 필요합니다: '+pendingFrameOrigins.map(x=>new URL(x).hostname).join(', ');
}
frameAccess.addEventListener('click',async()=>{if(!pendingFrameOrigins.length)return;frameAccess.disabled=true;try{const granted=await chrome.permissions.request({origins:pendingFrameOrigins});if(!granted){downMsg.textContent='임베드 서버 접근을 허용하지 않았습니다.';return;}await chrome.runtime.sendMessage({target:'background',type:'repairRegistrations'});await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['generic-frame.js']});frameAccess.hidden=true;downMsg.textContent='연결했습니다. 플레이어를 재생한 뒤 파일 확인을 다시 눌러 주세요.';}catch(e){downMsg.textContent='임베드 연결 실패: '+e.message;}finally{frameAccess.disabled=false;}});
async function collectGeneric(target){
 await chrome.scripting.executeScript({target,world:'MAIN',files:['media-watch.js','adaptive-manifest.js','media-collect.js']});
 const result=await chrome.scripting.executeScript({target,world:'MAIN',func:token=>globalThis.videoShortcutMedia.collect(token),args:[xVideoToken]});return result[0]?.result||{items:[],reason:'영상을 확인하지 못했습니다.'};
}
scan.addEventListener('click',async()=>{
 if(!current||!tab)return;scan.disabled=true;quality.disabled=true;down.disabled=true;candidates=[];frameAccess.hidden=true;downMsg.textContent='영상 파일과 스트림을 확인 중입니다...';
 try{
  let mediaTarget=selectedMediaFrameId?{tabId:tab.id,frameIds:[selectedMediaFrameId]}:{tabId:tab.id};
  const isX=['https://x.com','https://twitter.com','https://www.instagram.com','https://instagram.com'].includes(site);let data;
  if(['https://www.youtube.com','https://youtube.com','https://m.youtube.com'].includes(site)){await chrome.scripting.executeScript({target:mediaTarget,world:'MAIN',files:['youtube-support.js']});const found=await chrome.scripting.executeScript({target:mediaTarget,world:'MAIN',func:token=>globalThis.riumYouTube.collect(token),args:[xVideoToken]});data=found[0]?.result||{items:[],reason:'유튜브 영상을 확인하지 못했습니다.'};}
  else if(isX){await chrome.scripting.executeScript({target:mediaTarget,world:'MAIN',files:['x-support.js','instagram-support.js']});const direct=await chrome.scripting.executeScript({target:mediaTarget,world:'MAIN',func:token=>globalThis.__videoShortcutX.collect(token),args:[xVideoToken]});data=direct[0]?.result||{items:[],reason:'영상을 확인할 수 없습니다.'};}
  else data=await collectGeneric(mediaTarget);
  if(data.hasVideo===false&&!data.items?.length&&!selectedMediaFrameId){
   try{await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['generic-frame.js']});}catch(_){}
   const frames=await chrome.runtime.sendMessage({target:'background',type:'getFramePlayers',tabId:tab.id,purpose:'download'});const main=frames?.players?.[0];
   if(main){selectedMediaFrameId=main.frameId;mediaTarget={tabId:tab.id,frameIds:[main.frameId]};data=await collectGeneric(mediaTarget);}
  }
  // Preserve the existing legacy HLS path on its original integrations only.
  let streams=[];if(!isX&&!data.items?.length&&[defaultSite,'https://yadongparty10.com'].includes(site)){try{streams=(await chrome.scripting.executeScript({target:mediaTarget,world:'MAIN',func:collectHls}))[0]?.result||[];}catch(_){}}
  candidates=[...(data.items||[]),...streams];if(outputMode==='audio')candidates=candidates.filter(c=>c.mediaType!=='image');if(!isX)candidates.sort((a,b)=>(b.height||0)-(a.height||0)||(b.bandwidth||0)-(a.bandwidth||0));quality.replaceChildren();
  if(!candidates.length){const o=document.createElement('option');o.textContent='사용 가능한 파일 없음';quality.append(o);downMsg.textContent=data.reason||'지원되는 영상 소스를 찾지 못했습니다. 재생 후 다시 확인해 주세요.';quickError(downMsg.textContent);if(!isX)await offerFrameAccess();}
  else{candidates.forEach((x,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=x.label+(candidates.length>1?' · 파일 '+(i+1):'');quality.append(o);});quality.disabled=false;down.disabled=false;downMsg.textContent='';}
 }catch(e){downMsg.textContent='영상을 확인하지 못했습니다: '+e.message;quickError(downMsg.textContent);}
 finally{scan.disabled=!current;if(quickMode&&candidates.length)down.click();}
});
down.addEventListener('click',async(event)=>{const c=candidates[Number(quality.value)];if(!c)return;down.disabled=true;try{
 const requested={permissions:['downloads']};if(c.kind==='youtube-native')requested.permissions.push('nativeMessaging');if(c.kind!=='youtube-native'&&(outputMode==='audio'||['hls','instagram-dash','adaptive'].includes(c.kind))){const u=new URL(c.url);requested.origins=c.origins||[u.protocol+'//'+u.hostname+'/*'];}
 const alreadyAllowed=await chrome.permissions.contains(requested);if(quickMode&&!alreadyAllowed&&!event?.isTrusted){document.body.classList.add('needs-permission');down.textContent='권한 허용 후 다운로드';downMsg.textContent='처음 한 번 다운로드·영상 서버 권한이 필요합니다.';if(prepareId)chrome.runtime.sendMessage({target:'background',type:'preparationWaiting',id:prepareId}).catch(()=>{});parent.postMessage({source:'videoShortcutMenu',type:'permissionNeeded'},'*');return;}const allowed=alreadyAllowed||await chrome.permissions.request(requested);if(!allowed){downMsg.textContent='다운로드와 영상 서버 접근 권한이 필요합니다.';quickError(downMsg.textContent);return;}
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['download-widget.js']});
 const result=await chrome.runtime.sendMessage({target:'background',type:'startDownload',prepareId,job:{outputMode,url:c.url,kind:c.kind||'direct',tabId:tab.id,title:c.title||tab.title||'video',filename:c.filename,mediaType:c.mediaType,photoScope:c.photoScope,plan:c.plan,audioUrl:c.audioUrl,expectedDuration:c.expectedDuration,saveAs:saveMode.value==='ask'}});if(!result?.ok)throw new Error(result?.error||'다운로드를 시작하지 못했습니다.');downMsg.textContent='다운로드 대기열에 추가했습니다.';if(inPlayerMenu)parent.postMessage({source:'videoShortcutMenu',type:'downloadStarted'},'*');
 }catch(e){downMsg.textContent='다운로드를 시작하지 못했습니다: '+e.message;quickError(downMsg.textContent);}finally{down.disabled=!current||!candidates.length;}});

if(inPlayerMenu){const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','다운로드 메뉴 닫기');close.style.cssText='margin-left:auto;background:transparent;border:0;color:#e7e7e7;font-size:24px;cursor:pointer;padding:4px 8px';const dismiss=()=>parent.postMessage({source:'videoShortcutMenu',type:'closeMenu'},'*');close.addEventListener('click',dismiss);document.querySelector('header').append(close);addEventListener('keydown',e=>{if(e.key==='Escape')dismiss();});}

if(quickMode){document.body.classList.add('quick-mode');}

const reopenProgress=document.getElementById('showProgress');
chrome.runtime.sendMessage({target:'background',type:'getDownloadState'}).then(r=>{if(reopenProgress)reopenProgress.disabled=!r?.state;}).catch(()=>{});
reopenProgress?.addEventListener('click',async()=>{try{if(!tab?.id)return;await chrome.scripting.executeScript({target:{tabId:tab.id},files:['download-widget.js']});await chrome.tabs.sendMessage(tab.id,{type:'showDownloadWidget'});}catch(e){downMsg.textContent='진행창을 열지 못했습니다: '+e.message;}});


// Global overlay visibility is independent of site shortcuts and download jobs.
const visibilitySwitch=document.getElementById('downloadVisibility');
if(visibilitySwitch){
 const visibilityBadge=document.getElementById('downloadVisibilityState'),visibilityHint=document.getElementById('downloadVisibilityHint');
 const renderVisibility=value=>{const on=value!==false;visibilitySwitch.setAttribute('aria-checked',String(on));visibilityBadge.textContent=on?'ON':'OFF';visibilityBadge.classList.toggle('on',on);};
 chrome.storage.local.get('downloadButtonVisible').then(s=>{renderVisibility(s.downloadButtonVisible);visibilitySwitch.disabled=false;}).catch(()=>{visibilityHint.textContent='설정을 읽지 못했습니다. 팝업을 다시 열어 주세요.';});
 visibilitySwitch.addEventListener('click',async()=>{visibilitySwitch.disabled=true;try{const on=visibilitySwitch.getAttribute('aria-checked')!=='true';await chrome.storage.local.set({downloadButtonVisible:on});renderVisibility(on);visibilityHint.textContent='';}catch(e){visibilityHint.textContent='설정을 저장하지 못했습니다: '+e.message;}finally{visibilitySwitch.disabled=false;}});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.downloadButtonVisible)renderVisibility(changes.downloadButtonVisible.newValue);});
}

const helpButton=document.getElementById('helpButton');
if(helpButton){const helpPanel=document.getElementById('helpPanel'),controlsPanel=document.getElementById('controlsPanel');let helpOpen=false;const showHelp=on=>{helpOpen=on;helpPanel.hidden=!on;controlsPanel.hidden=on;helpButton.setAttribute('aria-expanded',String(on));helpButton.setAttribute('aria-label',on?'도움말 닫기':'도움말');helpButton.title=on?'도움말 닫기':'도움말';helpButton.textContent=on?'×':'?';if(on)document.getElementById('helpHeading').focus();else helpButton.focus();window.scrollTo(0,0);};helpButton.addEventListener('click',()=>showHelp(!helpOpen));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&helpOpen){e.preventDefault();e.stopPropagation();showHelp(false);}});}
