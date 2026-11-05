(() => {
  'use strict';
  const REPO='contentriumkorea/rium-download';
  const compare=(a,b)=>{const x=a.replace(/^v/,'').split('.').map(Number),y=b.replace(/^v/,'').split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return Math.sign(d);}return 0;};
  const valid=v=>/^v?\d+\.\d+\.\d+(?:\.\d+)?$/.test(v);
  globalThis.riumVersion={compare,valid};
  if(typeof document==='undefined'||location.pathname.endsWith('/player-menu.html'))return;
  const box=document.createElement('section');box.className='update-status';box.setAttribute('aria-live','polite');
  const label=document.createElement('span'),link=document.createElement('a'),button=document.createElement('button'),apply=document.createElement('button');
  label.textContent='Rium Download '+chrome.runtime.getManifest().version;
  link.textContent='설치파일로 업데이트';link.href='https://github.com/'+REPO+'/releases/latest';link.target='_blank';link.rel='noopener noreferrer';link.hidden=true;
  button.type='button';button.textContent='업데이트 확인';apply.type='button';apply.textContent='지금 업데이트';apply.hidden=true;
  box.append(label,apply,link,button);document.querySelector('main').append(box);
  function show(data){if(data&&valid(data.version)&&compare(data.version,chrome.runtime.getManifest().version)>0){label.textContent='새 버전 '+data.version+'을 사용할 수 있습니다. 다른 브라우저의 다운로드도 완료한 뒤 업데이트하세요.';apply.hidden=false;link.hidden=true;return true;}apply.hidden=true;link.hidden=true;return false;}
  async function check(force=false){
    button.disabled=true;
    try{
      const {riumUpdate}=await chrome.storage.local.get('riumUpdate');
      if(!force&&riumUpdate&&Date.now()-riumUpdate.checkedAt<6*3600000){show(riumUpdate);return;}
      const response=await fetch('https://api.github.com/repos/'+REPO+'/releases/latest',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('unavailable');
      const release=await response.json();if(release.draft||release.prerelease||!valid(release.tag_name))throw Error('invalid release');
      const data={version:release.tag_name,checkedAt:Date.now()};await chrome.storage.local.set({riumUpdate:data});
      if(!show(data))label.textContent='최신 버전입니다 · '+chrome.runtime.getManifest().version;
    }catch(_){label.textContent='업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';}
    finally{button.disabled=false;}
  }
  apply.addEventListener('click',async()=>{apply.disabled=true;button.disabled=true;label.textContent='업데이트를 내려받고 검증하고 있습니다. 잠시 기다려 주세요.';try{const result=await chrome.runtime.sendMessage({target:'background',type:'applyUpdate'});if(!result?.ok)throw Error(result?.error||'업데이트에 실패했습니다.');label.textContent='업데이트 완료. 확장을 다시 불러옵니다.';chrome.runtime.reload();}catch(error){label.textContent=String(error?.message||'업데이트에 실패했습니다. 설치파일로 다시 시도해 주세요.');link.hidden=false;apply.disabled=false;button.disabled=false;}});
  button.addEventListener('click',()=>check(true));check();
})();
