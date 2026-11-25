'use strict';
(() => {
 const section=document.createElement('section');section.className='download';
 const heading=document.createElement('h2');heading.textContent='MCP 연결';
 const info=document.createElement('p');info.className='hint';info.textContent='Codex·Aside에서 유튜브와 지원 사이트의 다운로드 및 인스타그램 일괄 다운로드를 제어합니다.';
 const button=document.createElement('button');button.type='button';button.textContent='MCP 연결 켜기';
 const stop=document.createElement('button');stop.type='button';stop.textContent='일괄 다운로드 중지';
 const status=document.createElement('p');status.className='hint';status.setAttribute('aria-live','polite');
 const config=document.createElement('textarea');config.readOnly=true;config.rows=8;config.style.cssText='width:100%;box-sizing:border-box';config.hidden=true;config.setAttribute('aria-label','MCP 클라이언트 연결 설정');
 section.append(heading,info,button,stop,status,config);document.getElementById('controlsPanel').append(section);
 let enabled=false;
 const request=(action)=>chrome.runtime.sendMessage({target:'background',type:'mcpControl',action});
 const render=result=>{enabled=!!result.enabled;button.textContent=enabled?'MCP 연결 끄기':'MCP 연결 켜기';config.hidden=!result.config;config.value=result.config?JSON.stringify({mcpServers:{'rium-download':result.config}},null,2):'';status.textContent=result.error|| (enabled?'연결됨 · 위 설정을 MCP 클라이언트에 등록하세요.':'연결 꺼짐');};
 request('status').then(render).catch(()=>{});
 button.addEventListener('click',async()=>{button.disabled=true;try{const result=await request(enabled?'stop':'start');if(!result.ok)throw Error(result.error);render(result);}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
 stop.addEventListener('click',async()=>{const result=await request('cancel');status.textContent=result.ok?'일괄 작업 중지를 요청했습니다.':result.error;});
})();
