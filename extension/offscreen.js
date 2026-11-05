'use strict';
let currentId=null,active=false,notifyTimer=null;const listeners=new Set();
async function ask(type,body={}){const result=await chrome.runtime.sendMessage({target:'background',type,...body});if(result?.error)throw new Error(result.error);return result;}
const videoShortcutDownloads={download:async options=>(await ask('downloadBlob',{id:currentId,options})).id,search:async query=>(await ask('searchDownload',{id:query.id})).items,onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}};
function emit(patch){if(currentId)ask('progress',{id:currentId,patch}).catch(()=>{});}
function publish(){notifyTimer=null;emit({status:document.getElementById('status').textContent,detail:document.getElementById('detail').textContent,progress:Number(document.getElementById('progress').value)});}
new MutationObserver(()=>{if(!notifyTimer)notifyTimer=setTimeout(publish,120);}).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{if(msg?.target!=='offscreen')return;
 if(msg.type==='downloadChanged'){for(const fn of listeners)fn(msg.delta);respond({ok:true});return;}
 if(msg.type==='cancelDownload'){if(active&&msg.id===currentId)aborter.abort();respond({ok:true});return;}
 if(msg.type==='startDownload'){
  if(active){respond({ok:false,error:'이미 다운로드 중입니다.'});return;}
  active=true;currentId=msg.id;const id=msg.id;respond({ok:true});
  (async()=>{let phase='complete',detail=msg.job.outputMode==='audio'?'M4A 음원 파일이 선택한 다운로드 위치에 저장되었습니다.':'MP4 영상 파일이 선택한 다운로드 위치에 저장되었습니다.';try{await run(msg.job);}catch(e){phase=aborter.signal.aborted||e.name==='AbortError'?'cancelled':'error';detail=e.message||'다운로드가 중단됐습니다.';aborter.abort();}finally{if(notifyTimer){clearTimeout(notifyTimer);notifyTimer=null;}active=false;currentId=null;try{await ask('workerFinished',{id,phase,detail});}catch(_){}}})();
 }
});
