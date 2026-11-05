'use strict';
// One worker at a time: jobs and private stream URLs stay in trusted session storage.
let queueChain=Promise.resolve(), pumping=false, pollTimer=null;
const terminalPhases=new Set(['complete','error','cancelled']);
function visibleState(row){const {job,cancelRequested,...safe}=row;return safe;}
function notifyQueue(rows){const states=rows.map(visibleState);chrome.tabs.query({}).then(tabs=>{for(const tab of tabs)if(Number.isInteger(tab.id))chrome.tabs.sendMessage(tab.id,{type:'downloadStatus',states}).catch(()=>{});}).catch(()=>{});}
async function readRows(){const data=await chrome.storage.session.get(['downloadQueue','downloadState']);if(Array.isArray(data.downloadQueue))return data.downloadQueue;if(data.downloadState){const old=data.downloadState;return [{...old,phase:old.phase==='running'?'error':old.phase,...(old.phase==='running'?{status:'다운로드 중단됨',detail:'확장 프로그램이 다시 시작되어 재시도가 필요합니다.'}:{})}];}return [];}
function withQueue(fn,save=true){const op=queueChain.catch(()=>{}).then(async()=>{const rows=await readRows(),result=await fn(rows);if(save){await chrome.storage.session.set({downloadQueue:rows});notifyQueue(rows);}return result;});queueChain=op;return op;}
async function queueStates(){return withQueue(rows=>{let changed=false;for(const row of rows)if(row.phase==='preparing'&&row.status!=='권한 허용 필요'&&Date.now()-row.createdAt>120000){row.phase='error';row.status='화질 확인 실패';row.detail='화질 확인이 중단되었습니다. 영상에서 다운로드 버튼을 다시 눌러 주세요.';changed=true;}return rows.map(visibleState);});}
function schedulePump(){setTimeout(()=>pump().catch(()=>{}),100);}
async function prepareDownload(tabId,title){if(!Number.isInteger(tabId))throw Error('영상 탭을 확인할 수 없습니다.');const row={id:crypto.randomUUID(),tabId,title:String(title||'영상').slice(0,500),phase:'preparing',status:'화질 확인 중',detail:'영상 파일을 확인하고 있습니다.',progress:0,createdAt:Date.now()};await withQueue(rows=>{if(rows.filter(r=>!terminalPhases.has(r.phase)).length>=100)throw Error('대기 중인 다운로드가 너무 많습니다.');rows.push(row)});return {ok:true,id:row.id};}
async function enqueueDownload(job,prepareId){
 if(!Number.isInteger(job?.tabId))throw Error('영상 탭을 확인할 수 없습니다.');
 const u=new URL(job.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('지원하지 않는 영상 주소입니다.');
 if(!await chrome.permissions.contains({permissions:['downloads']}))throw Error('다운로드 권한이 없습니다.');
 const audioOnly=job.outputMode==='audio';if(audioOnly&&job.mediaType==='image')throw Error('사진에는 음원이 없습니다.');
 const kind=['hls','instagram-dash','adaptive','youtube-native'].includes(job.kind)?job.kind:audioOnly?'audio-direct':'direct',allowedOrigins=[u.origin];
 if(kind==='audio-direct'&&!await chrome.permissions.contains({origins:[u.origin+'/*']}))throw Error('음원 추출을 위한 영상 서버 접근 권한이 없습니다.');
 if(kind==='youtube-native'){
  const id=youtubeId(job.url),tab=await chrome.tabs.get(job.tabId);
  if(!id||youtubeId(tab.url)!==id)throw Error('선택한 유튜브 영상과 다운로드 요청이 다릅니다.');
  if(!await parentEnabled(job.tabId))throw Error('유튜브에서 확장 프로그램을 먼저 켜 주세요.');
  if(!await chrome.permissions.contains({permissions:['nativeMessaging']}))throw Error('유튜브 도우미 연결 권한이 필요합니다.');
 }
 let adaptivePlan;
 if(kind==='adaptive'){
  const p=job.plan;if(!p||p.version!==1||!Number.isFinite(p.duration)||p.duration<=0||p.duration>604800||!Array.isArray(p.tracks)||p.tracks.length<1||p.tracks.length>2)throw Error('지원하지 않는 스트림 작업입니다.');
  if(JSON.stringify(p).length>6000000)throw Error('스트림 작업 정보가 너무 큽니다.');
  let count=0;
  const resource=x=>{if(!x||typeof x.url!=='string'||x.url.length>8192)throw Error('영상 조각 주소가 잘못되었습니다.');const r=new URL(x.url);if(!['http:','https:'].includes(r.protocol)||r.username||r.password||r.hash)throw Error('허용되지 않은 영상 조각 주소입니다.');if(!allowedOrigins.includes(r.origin))allowedOrigins.push(r.origin);if(allowedOrigins.length>32)throw Error('영상 서버 수가 너무 많습니다.');const out={url:r.href};if(x.range!=null){const {start,end}=x.range;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>=268435456)throw Error('영상 조각 범위가 잘못되었습니다.');out.range={start,end};}return out;};
  const tracks=p.tracks.map(t=>{if(!t||!['video','audio','muxed'].includes(t.type)||!['fmp4','ts','file'].includes(t.format)||!Array.isArray(t.segments)||!t.segments.length||(count+=t.segments.length)>10000)throw Error('지원하지 않는 영상 트랙입니다.');return {type:t.type,format:t.format,...(t.init?{init:resource(t.init)}:{}),segments:t.segments.map(resource)};});
  if(tracks.length===1&&tracks[0].type==='audio'||tracks.length===2&&(tracks.filter(t=>t.type==='video').length!==1||tracks.filter(t=>t.type==='audio').length!==1))throw Error('영상·음성 트랙 연결을 확인하지 못했습니다.');
  if(!await chrome.permissions.contains({origins:allowedOrigins.map(o=>o+'/*')}))throw Error('영상 서버 접근 권한이 없습니다.');adaptivePlan={version:1,duration:p.duration,tracks};
 }
 const image=job.mediaType==='image',photoScope=job.photoScope||'story';if(image){const tab=await chrome.tabs.get(job.tabId);const pageUrl=new URL(tab.url||'');const file=/^Instagram_(story|post)_\d+\.(jpg|jpeg|png|webp)$/.exec(job.filename||'');if(kind!=='direct'||pageUrl.protocol!=='https:'||!['www.instagram.com','instagram.com'].includes(pageUrl.hostname)||!['story','post'].includes(photoScope)||(photoScope==='story'?!pageUrl.pathname.startsWith('/stories/'):pageUrl.pathname.startsWith('/stories/'))||u.protocol!=='https:'||u.port||u.hash||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)||!(/\.(jpe?g|png|webp)$/i.test(u.pathname))||!file||file[1]!==photoScope)throw Error('Instagram 사진과 다운로드 주소를 안전하게 확인하지 못했습니다.');}

 if(kind==='instagram-dash'){
  const tab=await chrome.tabs.get(job.tabId);if(!/^https:\/\/(www\.)?instagram\.com\//.test(tab.url||''))throw Error('Instagram 영상 탭이 아닙니다.');
  const a=new URL(job.audioUrl);for(const v of [u,a])if(v.protocol!=='https:'||v.username||v.password||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(v.hostname))throw Error('허용되지 않은 Instagram 영상 서버입니다.');
  if(!allowedOrigins.includes(a.origin))allowedOrigins.push(a.origin);
  if(!Number.isFinite(job.expectedDuration)||job.expectedDuration<=0)throw Error('영상 길이 정보가 없습니다.');
  if(!await chrome.permissions.contains({origins:allowedOrigins.map(o=>o+'/*')}))throw Error('Instagram 영상 서버 접근 권한이 없습니다.');
 }
 if(kind==='hls'){
  if(u.origin===PLAYER_ORIGIN){const tab=await chrome.tabs.get(job.tabId);if(new URL(tab.url).origin!==PARTY_ORIGIN)throw Error('영상과 페이지 연결을 확인할 수 없습니다.');allowedOrigins.push(SEGMENT_ORIGIN);}
  if(!await chrome.permissions.contains({origins:allowedOrigins.map(o=>o+'/*')}))throw Error('영상 서버 접근 권한이 없습니다.');
 }
 const row={id:crypto.randomUUID(),tabId:job.tabId,title:(audioOnly?'[음원] ':'')+String(job.title||'video').slice(0,500),kind,outputMode:audioOnly?'audio':'video',mediaType:image?'image':audioOnly?'audio':'video',phase:'queued',status:'다운로드 대기 중',detail:'앞선 다운로드가 끝나면 시작합니다.',progress:0,createdAt:Date.now(),job:{outputMode:audioOnly?'audio':'video',url:u.href,kind,title:String(job.title||'video').slice(0,500),filename:job.filename,mediaType:image?'image':'video',...(kind==='adaptive'?{plan:adaptivePlan}:{}),...(kind==='instagram-dash'?{audioUrl:job.audioUrl,expectedDuration:job.expectedDuration}:{}),saveAs:!!job.saveAs,allowedOrigins}};
 await withQueue(rows=>{if(prepareId){const i=rows.findIndex(r=>r.id===prepareId&&r.phase==='preparing');if(i<0)throw Error('취소되었거나 만료된 다운로드입니다.');if(rows[i].tabId!==job.tabId)throw Error('다운로드 탭이 일치하지 않습니다.');row.id=prepareId;row.createdAt=rows[i].createdAt;rows[i]=row;}else{if(rows.filter(r=>!terminalPhases.has(r.phase)).length>=100)throw Error('대기 중인 다운로드가 너무 많습니다.');rows.push(row);}while(rows.length>150){const i=rows.findIndex(r=>terminalPhases.has(r.phase));if(i<0)break;rows.splice(i,1);}});
 schedulePump();return {ok:true,id:row.id,queued:true};
}
async function finishJob(id,phase,status,detail){const changed=await withQueue(rows=>{const row=rows.find(r=>r.id===id);if(!row||terminalPhases.has(row.phase))return false;row.phase=row.cancelRequested?'cancelled':phase;row.status=row.cancelRequested?'다운로드 취소됨':status;row.detail=row.cancelRequested?'다운로드를 취소했습니다.':detail;if(row.phase==='complete')row.progress=100;delete row.job;delete row.cancelRequested;return true;});if(changed)schedulePump();return changed;}
async function updateRow(id,callback){return withQueue(rows=>{const row=rows.find(r=>r.id===id);if(!row||terminalPhases.has(row.phase))return null;callback(row);return {...row};});}
async function currentRow(id){return withQueue(rows=>rows.find(r=>r.id===id)||null,false);}
async function pump(){
 if(pumping)return;pumping=true;
 try{
  const row=await withQueue(rows=>{if(rows.some(r=>r.phase==='running'||r.phase==='cancelling'))return null;const next=rows.find(r=>r.phase==='queued');if(!next)return null;next.phase='running';next.status='다운로드 준비 중';next.detail='페이지를 이동하거나 상태창을 접어도 계속됩니다.';return {...next};});
  if(!row)return;
  const now=await currentRow(row.id);if(!now||now.cancelRequested){await finishJob(row.id,'cancelled','다운로드 취소됨','다운로드를 취소했습니다.');return;}
  try{
   if(row.kind==='youtube-native'){
    await runYouTubeNative(row);await finishJob(row.id,'complete','다운로드 완료','유튜브 원본 품질 파일을 저장했습니다. 재인코딩 없음');
   }else if(['hls','instagram-dash','adaptive','audio-direct'].includes(row.kind)){
    if(await offscreenExists())await chrome.offscreen.closeDocument();
    if((await currentRow(row.id))?.cancelRequested){await finishJob(row.id,'cancelled','다운로드 취소됨','다운로드를 취소했습니다.');return;}
    await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'Assemble user-requested video segments into an MP4 Blob without opening a tab.'});
    const response=await chrome.runtime.sendMessage({target:'offscreen',type:'startDownload',job:row.job,id:row.id});if(!response?.ok)throw Error(response?.error||'백그라운드 다운로드를 시작하지 못했습니다.');
    if((await currentRow(row.id))?.cancelRequested)await chrome.runtime.sendMessage({target:'offscreen',type:'cancelDownload',id:row.id}).catch(()=>{});
   }else{
    const u=new URL(row.job.url),opts={url:row.job.url,saveAs:row.job.saveAs,conflictAction:'uniquify'};
    if(u.hostname==='video.twimg.com'&&/^X_\d+\.mp4$/.test(row.job.filename||'')||row.job.mediaType==='image')opts.filename=row.job.filename;
    const id=await chrome.downloads.download(opts);
    const updated=await updateRow(row.id,r=>{r.downloadId=id;r.status=r.cancelRequested?'취소 중':'파일 다운로드 중';r.detail='브라우저에 파일을 저장하고 있습니다.';});
    if(updated?.cancelRequested){await chrome.downloads.cancel(id).catch(()=>{});await finishJob(row.id,'cancelled','다운로드 취소됨','다운로드를 취소했습니다.');return;}
    const item=(await chrome.downloads.search({id}))[0];
    if(item?.state==='complete')await finishJob(row.id,'complete','다운로드 완료','파일을 저장했습니다.');
    else if(item?.state==='interrupted')await finishJob(row.id,'error','다운로드 중단됨',item.error||'브라우저 다운로드가 중단됐습니다.');
    else startProgressPoll();
   }
  }catch(e){await finishJob(row.id,'error','다운로드 실패',e.message||'다운로드를 시작하지 못했습니다.');}
 }finally{pumping=false;const states=await queueStates();if(!states.some(r=>r.phase==='running'||r.phase==='cancelling')&&states.some(r=>r.phase==='queued'))schedulePump();}
}
function startProgressPoll(){if(pollTimer)return;pollTimer=setTimeout(async()=>{pollTimer=null;try{const running=await withQueue(rows=>rows.find(r=>r.kind==='direct'&&r.phase==='running'&&Number.isInteger(r.downloadId))||null,false);if(!running)return;const item=(await chrome.downloads.search({id:running.downloadId}))[0];if(item?.state==='complete')await finishJob(running.id,'complete','다운로드 완료','파일을 저장했습니다.');else if(item?.state==='interrupted')await finishJob(running.id,'error','다운로드 중단됨',item.error||'브라우저 다운로드가 중단됐습니다.');else if(item){await updateRow(running.id,r=>{if(item.totalBytes>0)r.progress=Math.max(0,Math.min(99,item.bytesReceived/item.totalBytes*100));});startProgressPoll();}}catch(_){startProgressPoll();}},1200);}
async function cancelQueueItem(id){
 const result=await withQueue(rows=>{const r=rows.find(x=>x.id===id);if(!r||terminalPhases.has(r.phase))return null;if(r.phase==='queued'||r.phase==='preparing'){r.phase='cancelled';r.status='다운로드 취소됨';r.detail='대기 중인 다운로드를 취소했습니다.';delete r.job;return {queued:true};}r.cancelRequested=true;r.phase='cancelling';r.status='취소 중';return {id:r.id,downloadId:r.downloadId,kind:r.kind};});
 if(!result)return {ok:true};if(result.queued){schedulePump();return {ok:true};}
 if(result.kind==='youtube-native'){cancelYouTube(result.id);return {ok:true};}
 if(Number.isInteger(result.downloadId))await chrome.downloads.cancel(result.downloadId).catch(()=>{});
 if(['hls','instagram-dash','adaptive','audio-direct'].includes(result.kind)){try{if(await offscreenExists())await chrome.runtime.sendMessage({target:'offscreen',type:'cancelDownload',id:result.id});}catch(_){}}
 else if(Number.isInteger(result.downloadId))await finishJob(result.id,'cancelled','다운로드 취소됨','다운로드를 취소했습니다.');
 return {ok:true};
}
async function removeQueueItem(id){await withQueue(rows=>{const i=rows.findIndex(r=>r.id===id);if(i>=0&&terminalPhases.has(rows[i].phase))rows.splice(i,1);});return {ok:true};}
async function showQueueFolder(id){const r=await withQueue(rows=>rows.find(x=>x.id===id)||null,false);if(!r||r.phase!=='complete'||!Number.isInteger(r.downloadId))throw Error('완료된 다운로드를 확인할 수 없습니다.');const file=(await chrome.downloads.search({id:r.downloadId}))[0];if(!file||file.state!=='complete'||file.exists===false)throw Error('저장된 파일이 삭제되었거나 다운로드 기록을 찾지 못했습니다.');await chrome.downloads.show(r.downloadId);return {ok:true};}
async function onWorkerProgress(msg){await updateRow(msg.id,r=>{if(r.phase!=='running')return;const patch=msg.patch||{};if(typeof patch.status==='string')r.status=patch.status.slice(0,200);if(typeof patch.detail==='string')r.detail=patch.detail.slice(0,500);if(Number.isFinite(patch.progress))r.progress=Math.max(0,Math.min(100,patch.progress));});return {ok:true};}
async function onWorkerFinished(msg){const phase=['complete','cancelled','error'].includes(msg.phase)?msg.phase:'error';await finishJob(msg.id,phase,phase==='complete'?'다운로드 완료':phase==='cancelled'?'다운로드 취소됨':'다운로드 실패',String(msg.detail||'').slice(0,500));return {ok:true};}
async function registerBlob(msg){if(!msg.options?.url?.startsWith('blob:'+chrome.runtime.getURL('')))throw Error('잘못된 파일 주소입니다.');const row=await currentRow(msg.id);if(!row||!['hls','instagram-dash','adaptive','audio-direct'].includes(row.kind)||row.phase!=='running'||row.cancelRequested)throw Error('다운로드가 취소되었거나 종료됐습니다.');const id=await chrome.downloads.download(msg.options);const updated=await updateRow(msg.id,r=>{r.downloadId=id;});if(!updated||updated.cancelRequested)await chrome.downloads.cancel(id).catch(()=>{});return {id};}
async function onBrowserChanged(delta){const r=await withQueue(rows=>rows.find(x=>x.downloadId===delta.id&&!terminalPhases.has(x.phase))||null,false);if(r?.kind==='direct'&&delta.state?.current==='complete')await finishJob(r.id,'complete','다운로드 완료','파일이 선택한 다운로드 위치에 저장되었습니다.');else if(r?.kind==='direct'&&delta.state?.current==='interrupted')await finishJob(r.id,'error','다운로드 중단됨',delta.error?.current||'브라우저 다운로드가 중단됐습니다.');if(await offscreenExists())await chrome.runtime.sendMessage({target:'offscreen',type:'downloadChanged',delta}).catch(()=>{});}
async function recoverQueue(){const rows=await withQueue(rows=>rows.filter(r=>r.phase==='running'||r.phase==='cancelling'),false);for(const row of rows){if(row.kind==='youtube-native'){await finishJob(row.id,'error','다운로드 중단됨','유튜브 도우미 연결이 종료되었습니다. 다시 시도해 주세요.');}else if(['hls','instagram-dash','adaptive','audio-direct'].includes(row.kind)){if(!await offscreenExists())await finishJob(row.id,'error','다운로드 중단됨','다운로드 작업이 중단되었습니다. 다시 시도해 주세요.');}else if(Number.isInteger(row.downloadId)){const file=(await chrome.downloads.search({id:row.downloadId}))[0];if(file?.state==='complete')await finishJob(row.id,'complete','다운로드 완료','파일을 저장했습니다.');else if(file?.state==='in_progress')startProgressPoll();else await finishJob(row.id,'error','다운로드 중단됨','브라우저 다운로드가 중단되었습니다.');}else await finishJob(row.id,'error','다운로드 중단됨','다운로드 준비가 중단되었습니다.');}schedulePump();}
