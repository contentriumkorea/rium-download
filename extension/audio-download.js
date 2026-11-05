'use strict';
async function runAudioDirect(job){
 const u=new URL(job.url),signal=aborter.signal,limit=80*1048576;
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!job.allowedOrigins.includes(u.origin))throw Error('허용되지 않은 음원 원본 주소입니다.');
 nameEl.textContent=job.title;statusEl.textContent='음원 추출용 원본을 받는 중';
 const response=await fetch(u.href,{credentials:'omit',redirect:'error',signal});
 if(response.status!==200||response.headers.get('content-range'))throw Error('전체 원본을 받지 못했습니다 ('+response.status+'). 영상을 새로고침하고 다시 시도해 주세요.');
 const length=Number(response.headers.get('content-length')||0);if(length>limit){await response.body?.cancel();throw Error('음원 추출용 원본이 80MB 메모리 한도를 넘습니다.');}
 const reader=response.body.getReader(),parts=[];let total=0;
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw Error('음원 추출용 원본이 80MB 메모리 한도를 넘습니다.');parts.push(value);bar.value=length?total/length*85:0;detail.textContent=(total/1048576).toFixed(1)+'MB 수신됨';}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(!total||(length&&!response.headers.get('content-encoding')&&total!==length))throw Error('원본 파일이 비어 있거나 일부만 수신되었습니다.');
 let bytes=new Uint8Array(total),offset=0;for(let i=0;i<parts.length;i++){bytes.set(parts[i],offset);offset+=parts[i].length;parts[i]=null;}
 statusEl.textContent='음원만 무손실로 추출 중';const blob=await videoShortcutExtractAudio(bytes,{signal});bytes=null;
 return saveAudioBlob(blob,job);
}
async function saveAudioBlob(blob,job){
 aborter.signal.throwIfAborted();const objectUrl=URL.createObjectURL(blob);
 const clean=String(job.filename||job.title||'audio').replace(/\.(mp4|m4a|webm|mov)$/i,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,120)||'audio';
 try{const id=await videoShortcutDownloads.download({url:objectUrl,filename:clean+'.m4a',saveAs:!!job.saveAs,conflictAction:'uniquify'});startedDownload=true;statusEl.textContent='음원 파일 저장 중';bar.value=97;
 await new Promise((resolve,reject)=>{let finished=false,timer;const finish=(state,error)=>{if(finished||!['complete','interrupted'].includes(state))return;finished=true;clearInterval(timer);videoShortcutDownloads.onChanged.removeListener(change);state==='complete'?resolve():reject(Error(error||'음원 저장이 중단되었습니다.'));};const change=d=>{if(d.id===id&&d.state)finish(d.state.current,d.error?.current);};const poll=()=>videoShortcutDownloads.search({id}).then(items=>finish(items[0]?.state)).catch(()=>{});videoShortcutDownloads.onChanged.addListener(change);timer=setInterval(poll,1000);poll();});
 statusEl.textContent='다운로드 완료';detail.textContent='M4A 음원 파일을 저장했습니다. 재인코딩 없음';bar.value=100;return {downloadId:id,bytes:blob.size};
 }finally{URL.revokeObjectURL(objectUrl);}
}
