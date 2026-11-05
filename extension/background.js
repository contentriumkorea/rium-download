'use strict';

const PARTY_ORIGIN='https://yadongparty10.com',PLAYER_ORIGIN='https://api.ydydapi.com',SEGMENT_ORIGIN='https://res.ydydapi.com';
async function parentEnabled(tabId){const tab=await chrome.tabs.get(tabId);let origin;try{origin=new URL(tab.url).origin;}catch(_){return false;}const sites=(await chrome.storage.local.get('sites')).sites||{};return Object.hasOwn(sites,origin)?!!sites[origin]:origin==='https://redko5.com';}
async function frameContext(sender){if(!sender.tab?.id||!sender.frameId||!sender.url)return {enabled:false};const url=new URL(sender.url),tab=await chrome.tabs.get(sender.tab.id);const enabled=new URL(tab.url).origin===PARTY_ORIGIN&&url.origin===PLAYER_ORIGIN&&/^\/v1\/Yl\/player\/\d+/.test(url.pathname)&&await parentEnabled(sender.tab.id)&&await chrome.permissions.contains({origins:[PLAYER_ORIGIN+'/*']});return {enabled};}
async function availableFrames(tabId,includeGeneric=false){if(!Number.isInteger(tabId)||!await parentEnabled(tabId))return [];const key='framePlayers_'+tabId,saved=(await chrome.storage.session.get(key))[key]||[];return saved.filter(f=>Date.now()-f.updatedAt<7000&&(includeGeneric||!f.generic)).sort((a,b)=>b.width*b.height-a.width*a.height);}

chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});

async function offscreenExists(){return (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]})).length>0;}
importScripts('youtube-native.js','download-queue.js','site-repair.js');
const registrationsReady=repairSiteRegistrations().catch(e=>console.warn('Site registration repair:',e.message));
chrome.runtime.onStartup.addListener(()=>{repairSiteRegistrations().catch(e=>console.warn('Site registration repair:',e.message));});
const queueReady=recoverQueue().catch(()=>{});
let updatingExtension=false;
function updateNative(){return new Promise((resolve,reject)=>{
 let port,finished=false;
 const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);try{port?.disconnect();}catch(_){}error?reject(error):resolve(value);};
 const timer=setTimeout(()=>done(Error('업데이트 시간이 초과되었습니다. 설치 상태를 확인해 주세요.')),15*60*1000);
 try{
  port=chrome.runtime.connectNative('com.contentrium.rium_download');
  port.onMessage.addListener(value=>done(null,value));
  port.onDisconnect.addListener(()=>done(Error('업데이트 도우미에 연결할 수 없습니다. 최신 설치파일을 한 번 실행해 주세요.')));
  port.postMessage({type:'update'});
 }catch(_){done(Error('업데이트 도우미에 연결할 수 없습니다. 최신 설치파일을 한 번 실행해 주세요.'));}
});}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.target!=='background')return;
 (async()=>{
  if (msg.type === 'applyUpdate') {
   if (sender.url !== chrome.runtime.getURL('popup.html')) throw Error('허용되지 않은 업데이트 요청입니다.');
   if (updatingExtension) throw Error('업데이트가 이미 진행 중입니다.');
   updatingExtension=true;let applied=false;
   try {
    await queueReady;
    await withQueue(rows=>{if(rows.some(r=>!['complete','cancelled','error'].includes(r.phase)))throw Error('진행 중인 다운로드가 끝난 뒤 업데이트해 주세요.');},false);
    const result=await updateNative();
    if(result?.type!=='updated')throw Error(result?.error||'업데이트 도우미를 확인할 수 없습니다. 설치파일을 한 번 다시 실행해 주세요.');
    applied=true;
    setTimeout(()=>chrome.runtime.reload(),100);
    return {ok:true,version:result.version};
   } finally { if(!applied)updatingExtension=false; }
  }
  if (updatingExtension && ['prepareDownload','startDownload'].includes(msg.type)) throw Error('업데이트가 끝난 뒤 다운로드해 주세요.');
  if(msg.type==='repairRegistrations'){if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw Error('허용되지 않은 요청입니다.');await repairSiteRegistrations();return {ok:true};}
  if(msg.type==='getFrameContext')return {ok:true,...await frameContext(sender)};
  if(msg.type==='registerGenericFramePlayer'){
   if(!sender.tab?.id||!sender.frameId||!sender.url||!await parentEnabled(sender.tab.id))return {ok:true,enabled:false};
   const u=new URL(sender.url);if(!['http:','https:'].includes(u.protocol)||!await chrome.permissions.contains({origins:[u.origin+'/*']}))return {ok:true,enabled:false};
   const p=msg.player;if(!p||!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<160||p.height<90)return {ok:true,enabled:true};
   const key='framePlayers_'+sender.tab.id,saved=(await chrome.storage.session.get(key))[key]||[];
   const frame={frameId:sender.frameId,documentId:sender.documentId,url:sender.url,generic:true,width:p.width,height:p.height,ready:p.ready,duration:p.duration,protected:!!p.protected,updatedAt:Date.now()};
   await chrome.storage.session.set({[key]:[...saved.filter(f=>f.frameId!==sender.frameId&&Date.now()-f.updatedAt<7000),frame].slice(-16)});return {ok:true,enabled:true};
  }
  if(msg.type==='registerFramePlayer'){
   const ctx=await frameContext(sender);if(!ctx.enabled)return {ok:true,enabled:false};
   const p=msg.player,key='framePlayers_'+sender.tab.id,saved=(await chrome.storage.session.get(key))[key]||[];
   if(!p||!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<160||p.height<90)return {ok:true,enabled:true};
   const frame={frameId:sender.frameId,documentId:sender.documentId,url:sender.url,width:p.width,height:p.height,ready:p.ready,duration:p.duration,protected:!!p.protected,updatedAt:Date.now()};
   await chrome.storage.session.set({[key]:[...saved.filter(f=>f.frameId!==sender.frameId&&Date.now()-f.updatedAt<7000),frame].slice(-8)});
   return {ok:true,enabled:true};
  }
  if(msg.type==='getFramePlayers'){const id=Number.isInteger(msg.tabId)&&sender.url?.startsWith(chrome.runtime.getURL(''))?msg.tabId:sender.tab?.id;return {ok:true,players:await availableFrames(id,msg.purpose==='download')};}
  if(msg.type==='relayFrameKey'){
   if(!sender.tab?.id||sender.frameId!==0)throw Error('허용되지 않은 키 요청입니다.');
   const frames=await availableFrames(sender.tab.id),f=frames.find(f=>f.frameId===msg.frameId)||frames[0];if(!f)return {ok:false,error:'플레이어를 찾지 못했습니다.'};
   const key=String(msg.key||'').toLowerCase();if(![' ','k','j','l','arrowleft','arrowright','arrowup','arrowdown','m'].includes(key)||(msg.ctrlKey||msg.shiftKey)&&!['arrowleft','arrowright'].includes(key)||msg.ctrlKey&&msg.shiftKey)throw Error('지원하지 않는 키입니다.');
   const options=f.documentId?{documentId:f.documentId}:{frameId:f.frameId};return await chrome.tabs.sendMessage(sender.tab.id,{type:'frameKey',key:msg.key,code:msg.code,ctrlKey:!!msg.ctrlKey,shiftKey:!!msg.shiftKey,repeat:!!msg.repeat},options);
  }
  if(msg.type==='relayParentViewKey'){
   if(!(await frameContext(sender)).enabled||!['t','f'].includes(msg.key))throw Error('허용되지 않은 요청입니다.');await chrome.tabs.sendMessage(sender.tab.id,{type:'parentViewKey',key:msg.key},{frameId:0});return {ok:true};
  }
  if(msg.type==='getDownloadState'){await queueReady;let zoom=1;try{if(sender.tab?.id!=null)zoom=await chrome.tabs.getZoom(sender.tab.id);}catch(_){}const states=await queueStates();return {states,state:states.at(-1)||null,zoom,tabId:sender.tab?.id};}
  if(msg.type==='prepareDownload'){await queueReady;if(!sender.tab?.id||sender.frameId!==0)throw Error('허용되지 않은 요청입니다.');return prepareDownload(sender.tab.id,(msg.outputMode==='audio'?'[음원] ':'')+sender.tab.title);}
  if(msg.type==='preparationWaiting'){await updateRow(msg.id,r=>{if(r.phase==='preparing'){r.status='권한 허용 필요';r.detail='다운로드 권한을 허용해 주세요.';}});return {ok:true};}
  if(msg.type==='preparationFailed'){await finishJob(msg.id,'error','화질 확인 실패',String(msg.error||'영상 파일을 찾지 못했습니다.').slice(0,500));return {ok:true};}
  if(msg.type==='startDownload'){if(msg.job?.kind==='youtube-native'&&(!sender.url?.startsWith(chrome.runtime.getURL(''))||!['/popup.html','/player-menu.html'].includes(new URL(sender.url).pathname)))throw Error('허용되지 않은 유튜브 요청입니다.');await queueReady;return enqueueDownload(msg.job,msg.prepareId);}
  if(msg.type==='showDownloadFolder')return showQueueFolder(msg.id);
  if(msg.type==='cancelDownload')return cancelQueueItem(msg.id);
  if(msg.type==='removeDownload')return removeQueueItem(msg.id);
  if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('허용되지 않은 요청입니다.');
  if(msg.type==='progress')return onWorkerProgress(msg);
  if(msg.type==='workerFinished')return onWorkerFinished(msg);
  if(msg.type==='downloadBlob')return registerBlob(msg);
  if(msg.type==='searchDownload'){const item=(await chrome.downloads.search({id:msg.id}))[0];return {items:item?[{id:item.id,state:item.state}]:[]};}
  throw new Error('지원하지 않는 요청입니다.');
 })().then(respond,e=>respond({ok:false,error:e.message}));return true;
});
chrome.downloads.onChanged.addListener(delta=>{onBrowserChanged(delta).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{(async()=>{const registered=await chrome.scripting.getRegisteredContentScripts();for(const r of registered)if(r.id.startsWith('site_')&&!r.id.endsWith('_watch')){await chrome.scripting.updateContentScripts([{id:r.id,js:['x-support.js','instagram-support.js','shortcuts.js','download-widget.js','player-download.js']}]);if(!registered.some(w=>w.id===r.id+'_watch'))await chrome.scripting.registerContentScripts([{id:r.id+'_watch',matches:r.matches,js:['media-watch.js'],world:'MAIN',runAt:'document_start',persistAcrossSessions:true}]);}await queueReady;await registrationsReady;await repairSiteRegistrations();})().catch(e=>console.warn(e.message));});

chrome.tabs.onZoomChange.addListener(info=>{chrome.tabs.sendMessage(info.tabId,{type:'pageZoom',zoom:info.newZoomFactor}).catch(()=>{});});

chrome.permissions.onAdded.addListener(()=>{repairSiteRegistrations().catch(()=>{});});
chrome.permissions.onRemoved.addListener(()=>{repairSiteRegistrations().catch(()=>{});});
