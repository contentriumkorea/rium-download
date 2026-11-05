'use strict';
const youtubeWorkers = new Map();
function youtubeId(raw) {
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.youtube.com','youtube.com','m.youtube.com'].includes(u.hostname))return null;
    const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];
    return /^[\w-]{11}$/.test(id||'')?id:null;
  }catch(_){return null;}
}
function cancelYouTube(id) { youtubeWorkers.get(id)?.cancel(); }
async function runYouTubeNative(row) {
  return new Promise((resolve,reject)=>{
    let port, settled=false, saving=false, downloadId, poll, cancelled=false;
    let sequence=Promise.resolve();
    function finish(error) {
      if(settled)return;settled=true;clearInterval(poll);youtubeWorkers.delete(row.id);
      try{port?.postMessage({type:'release'});}catch(_){}
      try{port?.disconnect();}catch(_){}
      error?reject(error):resolve();
    }
    async function cancel() {
      if(settled)return;cancelled=true;
      if(Number.isInteger(downloadId))await chrome.downloads.cancel(downloadId).catch(()=>{});
      try{port?.postMessage({type:'cancel'});}catch(_){}
      // A pending save dialog resolves through downloads.download; keep cleanup attached to that promise.
      if(!saving||Number.isInteger(downloadId))finish(new Error('다운로드를 취소했습니다.'));
    }
    async function checkDownload() {
      if(settled||!Number.isInteger(downloadId))return;
      try{
        const item=(await chrome.downloads.search({id:downloadId}))[0];
        if(item?.state==='complete')finish();
        else if(item?.state==='interrupted')finish(new Error(cancelled?'다운로드를 취소했습니다.':'브라우저 파일 저장이 중단되었습니다.'));
        else if(item?.totalBytes>0)await updateRow(row.id,r=>{r.progress=90+Math.min(9,item.bytesReceived/item.totalBytes*9);});
      }catch(_){finish(new Error('브라우저 저장 상태를 확인할 수 없습니다.'));}
    }
    youtubeWorkers.set(row.id,{cancel});
    try {
      port=chrome.runtime.connectNative('com.contentrium.rium_download');
      port.onDisconnect.addListener(()=>{
        const error=chrome.runtime.lastError;
        if(!settled&&!cancelled)finish(new Error(error?'유튜브 도우미에 연결할 수 없습니다. Rium Download 도우미 등록을 확인해 주세요.':'유튜브 도우미 연결이 종료됐습니다.'));
      });
      port.onMessage.addListener(msg=>{
        sequence=sequence.then(async()=>{
          if(settled)return;
          if(msg.type==='progress'&&Number.isFinite(msg.progress))await updateRow(row.id,r=>{r.progress=Math.max(r.progress||0,Math.min(90,msg.progress));r.status='유튜브 원본 트랙 다운로드 중';r.detail='영상·음원을 순서대로 수신한 뒤 재인코딩 없이 저장합니다.';});
          else if(msg.type==='error'||msg.type==='cancelled')finish(new Error(msg.type==='cancelled'?'다운로드를 취소했습니다.':String(msg.error||'유튜브 다운로드 실패').slice(0,300)));
          else if(msg.type==='ready') {
            if(saving)throw Error('도우미 응답이 중복되었습니다.');
            const u=new URL(msg.url);
            if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.search||u.hash||!/^\/[A-Za-z0-9_-]{40,60}$/.test(u.pathname)||!['mkv','m4a'].includes(msg.extension))throw Error('잘못된 도우미 파일 응답입니다.');
            if((row.job.outputMode==='audio')!==(msg.extension==='m4a'))throw Error('요청과 파일 형식이 다릅니다.');
            const current=await currentRow(row.id);if(cancelled||!current||current.cancelRequested){await cancel();return;}
            const clean=String(row.job.title||'YouTube').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,120)||'YouTube';
            saving=true;
            await updateRow(row.id,r=>{r.progress=90;r.status='브라우저에 파일 저장 중';r.detail='원본 품질 · 재인코딩 없음';});
            downloadId=await chrome.downloads.download({url:u.href,filename:clean+'.'+msg.extension,saveAs:!!row.job.saveAs,conflictAction:'uniquify'});
            const updated=await updateRow(row.id,r=>{r.downloadId=downloadId;});
            if(cancelled||!updated||updated.cancelRequested){await chrome.downloads.cancel(downloadId).catch(()=>{});finish(new Error('다운로드를 취소했습니다.'));return;}
            poll=setInterval(checkDownload,700);await checkDownload();
          }
        }).catch(finish);
      });
      port.postMessage({type:'download',videoId:youtubeId(row.job.url),mode:row.job.outputMode});
    }catch(_){finish(new Error('유튜브 도우미를 시작하지 못했습니다. 도우미 등록과 권한을 확인해 주세요.'));}
  });
}
