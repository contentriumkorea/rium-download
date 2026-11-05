'use strict';
// Separate path: existing direct/HLS workers remain unchanged.
async function runInstagramDownload(job){
 const maxBytes=80*1024*1024;let total=0,objectUrl=null,downloadId=null;
 nameEl.textContent=job.title;bar.value=0;
 async function track(raw,label){
  const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)||!job.allowedOrigins.includes(u.origin))throw Error('허용되지 않은 Instagram 트랙 주소입니다.');
  statusEl.textContent=label+' 트랙을 받는 중';
  const response=await fetch(u.href,{credentials:'omit',redirect:'error',signal:aborter.signal});
  if(!response.ok)throw Error('Instagram '+label+' 서버 응답 '+response.status+' (주소 만료 또는 접근 제한일 수 있습니다). 영상을 새로고침하고 다시 요청해 주세요.');
  if(response.status===206||response.headers.get('content-range'))throw Error('전체 파일 대신 일부 범위만 반환되어 안전하게 결합할 수 없습니다.');
  const length=Number(response.headers.get('content-length')||0);if(length>maxBytes-total)throw Error('영상·음성이 80MB 메모리 한도를 넘습니다.');
  const reader=response.body.getReader(),parts=[];let count=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;count+=value.byteLength;if(total>maxBytes)throw Error('영상·음성이 80MB 메모리 한도를 넘습니다.');parts.push(value);detail.textContent='영상·음성 '+(total/1048576).toFixed(1)+'MB 수신됨 · 재인코딩 없음';bar.value=(label==='영상'?0:45)+(length?Math.min(44,count/length*44):0);}}finally{await reader.cancel().catch(()=>{});}
  if(!count)throw Error(label+' 트랙이 비어 있습니다.');const out=new Uint8Array(count);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
 }
 try{
  let video=job.outputMode==='audio'?null:await track(job.url,'영상'),audio=await track(job.audioUrl,'음성');
  if(aborter.signal.aborted)throw new DOMException('취소됨','AbortError');
  statusEl.textContent=job.outputMode==='audio'?'음원 파일을 만드는 중':'영상과 소리를 무손실로 결합 중';detail.textContent='재인코딩 없이 원본 트랙을 저장합니다.';bar.value=90;
  const blob=job.outputMode==='audio'?await videoShortcutExtractAudio(audio,{signal:aborter.signal,expectedDuration:job.expectedDuration}):await videoShortcutInstagramMux(video,audio,{signal:aborter.signal,expectedDuration:job.expectedDuration});video=null;audio=null;
  if(aborter.signal.aborted)throw new DOMException('취소됨','AbortError');
  objectUrl=URL.createObjectURL(blob);
  const clean=(job.title||'Instagram_video').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,120)||'Instagram_video';
  let onAbort;const abortWait=new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('취소됨','AbortError'));aborter.signal.addEventListener('abort',onAbort,{once:true});if(aborter.signal.aborted)onAbort();});
  try{downloadId=await Promise.race([videoShortcutDownloads.download({url:objectUrl,filename:clean+(job.outputMode==='audio'?'.m4a':'.mp4'),saveAs:!!job.saveAs,conflictAction:'uniquify'}),abortWait]);}finally{aborter.signal.removeEventListener('abort',onAbort);}startedDownload=true;statusEl.textContent='파일 저장 중';bar.value=97;
  await new Promise((resolve,reject)=>{let finished=false,timer;const finish=(state,error)=>{if(finished||!['complete','interrupted'].includes(state))return;finished=true;clearInterval(timer);videoShortcutDownloads.onChanged.removeListener(change);state==='complete'?resolve():reject(Error(error||'브라우저 다운로드가 중단되었습니다.'));};const change=d=>{if(d.id===downloadId&&d.state)finish(d.state.current,d.error?.current);};const poll=()=>videoShortcutDownloads.search({id:downloadId}).then(items=>finish(items[0]?.state)).catch(()=>{});videoShortcutDownloads.onChanged.addListener(change);timer=setInterval(poll,1000);poll();});
  statusEl.textContent='다운로드 완료';detail.textContent=job.outputMode==='audio'?'음원만 담긴 M4A를 저장했습니다.':'영상과 소리가 함께 있는 MP4를 저장했습니다.';bar.value=100;
 }finally{if(objectUrl)URL.revokeObjectURL(objectUrl);}
}
