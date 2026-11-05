(() => {
  'use strict';

  const VERSION = '2.8.0-player-download.instagram-shorts-vertical.2';
  const previous = globalThis.__videoShortcutPlayerDownload;
  if (previous?.version === VERSION) return;
  try { previous?.dispose?.(); } catch (_) {}

  const HOST_ID = 'video-shortcut-player-download';
  const DEFAULT_ORIGIN = 'https://redko5.com';
  const origin = location.origin;
  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);
  const runtimeOrigin = new URL(chrome.runtime.getURL('')).origin;
  const BUTTON_SIZE = 40;
  const RIGHT_OFFSET = 16;
  const CONTROLS_OFFSET = 64;
  const FRAME_WIDTH = 340;
  const FRAME_HEIGHT = 190;

  let enabled = false;
  let downloadButtonVisible = true;
  let zoom = 1;
  let tabId = null;
  let remotePlayers=[];
  let selectedFrameId=0;
  let selectedVideoToken=null;
  let prepareId=null;
  let outputMode='video';
  let xSpacing=null;
  const restoreXSpacing=()=>{if(xSpacing){const {element,value,priority}=xSpacing;element.style.setProperty("margin-bottom",value,priority);xSpacing=null;}};
  let menuOpen = false;
  let needsPermission = false;
  let animationFrame = 0;
  let disposed = false;

  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'z-index:2147483647',
    'display:none',
    'margin:0',
    'padding:0',
    'border:0',
    'background:transparent',
    'transform-origin:top left',
    'pointer-events:auto'
  ].join(';');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .button {
      display: grid;
      place-items: center;
      width: ${BUTTON_SIZE}px;
      height: ${BUTTON_SIZE}px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      box-shadow:none;filter:drop-shadow(0 1px 2px rgba(0, 0, 0,.8));
      color: #ffffff;
      cursor: pointer;
    }
    .button:hover { color:#ffffff; background:transparent; }
    .button:focus-visible { outline: 2px solid #ffffff; outline-offset: 3px; }
    .button svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 3.1; stroke-linecap: round; stroke-linejoin: round; }
    .toolbar { display:flex;gap:6px;align-items:center; }
    :host([data-external-vertical="true"]) .toolbar { flex-direction:column; }
    .frame {
      display: none;
      width: ${FRAME_WIDTH}px;
      height: ${FRAME_HEIGHT}px;
      border: 0;
      border-radius: 10px;
      background: #131313;
      box-shadow: 0 12px 38px rgba(0, 0, 0, .55);
    }
    :host([data-menu-open="true"]) .download-button { opacity:.5;cursor:wait; }
    :host([data-menu-open="true"]) .frame { display:block;position:absolute;width:1px!important;height:1px!important;opacity:0;pointer-events:none; }
    :host([data-needs-permission="true"]) .toolbar { display:none; }
    :host([data-needs-permission="true"]) .frame { position:static;width:340px!important;height:190px!important;opacity:1;pointer-events:auto; }
  `;

  const button = document.createElement('button');
  button.className = 'button download-button';
  button.type = 'button';
  button.setAttribute('aria-label', '영상 다운로드');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>';
  button.title='영상 다운로드';
  const audioButton=document.createElement('button');audioButton.className='button download-button audio-button';audioButton.type='button';audioButton.setAttribute('aria-label','음원만 다운로드');audioButton.title='음원만 다운로드 (M4A)';audioButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg>';

  const toolbar=document.createElement('div');toolbar.className='toolbar';toolbar.append(button,audioButton);

  const frame = document.createElement('iframe');
  frame.className = 'frame';
  frame.title = '영상 다운로드';
  frame.setAttribute('aria-label', '영상 다운로드 메뉴');
  const feedback=document.createElement('div');feedback.setAttribute('role','status');feedback.style.cssText='position:absolute;right:0;top:44px;width:280px;color:#ffffff;background:#202020;border-radius:7px;font:12px/1.5 system-ui;pointer-events:none;';
  shadow.append(style, toolbar, frame,feedback);

  const attachHost = () => {
    for(const stale of document.querySelectorAll('#'+HOST_ID)){if(stale!==host){stale.style.visibility='hidden';stale.style.pointerEvents='none';}}

    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLVideoElement) return false;
    const parent = fullscreen instanceof Element ? fullscreen : document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    return true;
  };

  const setZoom = (nextZoom) => {
    const parsed = Number(nextZoom);
    if (Number.isFinite(parsed) && parsed > 0) zoom = parsed;
    host.style.transform = `scale(${1 / zoom})`;
    schedulePosition();
  };

  const setEnabled = (sites) => {
    enabled = Object.prototype.hasOwnProperty.call(sites || {}, origin)
      ? Boolean(sites[origin])
      : origin === DEFAULT_ORIGIN;
    if (!enabled) {
      restoreXSpacing();
      menuOpen = false;
      host.dataset.menuOpen = 'false';
      host.style.display = 'none';
    }
    schedulePosition();
  };

  const rectVisibleArea = (rect) => {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right);
    const bottom = Math.min(innerHeight, rect.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  };

  const looksLikeAd = (video) => {
    let element = video;
    for (let depth = 0; element instanceof Element && depth < 7; depth += 1, element = element.parentElement) {
      const label = [element.id, element.className, element.getAttribute('data-ad'), element.getAttribute('aria-label')]
        .filter(value => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      if (/(^|[\s_-])(ads?|advert(?:isement)?|sponsor(?:ed)?)(?=$|[\s_-])/.test(label)) return true;
    }
    return false;
  };

  const mainVideo = () => {
    if(globalThis.__videoShortcutX){const api=globalThis.__videoShortcutX;const video=(api.mainDownloadTarget||api.mainVideo)();if(!video)return null;const box=video.closest('[data-testid="videoPlayer"]')||video;return {video,rect:box.getBoundingClientRect(),box,xModal:!!video.closest('[role="dialog"]')||!!document.fullscreenElement||/(^|\.)instagram\.com$/.test(location.hostname)};}
    const candidates = [];
    const walk=(root,dx=0,dy=0,clip={left:0,top:0,right:innerWidth,bottom:innerHeight},depth=0)=>{
      if(depth>8)return;
      for(const el of root.querySelectorAll('*')){
        if(el.shadowRoot)walk(el.shadowRoot,dx,dy,clip,depth+1);
        if(el.tagName==='IFRAME'){
          try{const r=el.getBoundingClientRect(),d=el.contentDocument,s=el.ownerDocument.defaultView.getComputedStyle(el);if(d&&r.width>=160&&r.height>=90&&s.display!=='none'&&s.visibility!=='hidden')walk(d,dx+r.left+el.clientLeft,dy+r.top+el.clientTop,{left:Math.max(clip.left,dx+r.left),top:Math.max(clip.top,dy+r.top),right:Math.min(clip.right,dx+r.right),bottom:Math.min(clip.bottom,dy+r.bottom)},depth+1);}catch(_){}
        }
        if(el.tagName!=='VIDEO'||!el.isConnected)continue;
        const r=el.getBoundingClientRect(),s=el.ownerDocument.defaultView.getComputedStyle(el);
        if(r.width<160||r.height<90||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)continue;
        const rect={left:Math.max(clip.left,dx+r.left),top:Math.max(clip.top,dy+r.top),right:Math.min(clip.right,dx+r.right),bottom:Math.min(clip.bottom,dy+r.bottom)};rect.width=rect.right-rect.left;rect.height=rect.bottom-rect.top;
        if(rect.width<=0||rect.height<=0)continue;
        candidates.push({video:el,rect,area:rect.width*rect.height,ad:looksLikeAd(el)});
      }
    };walk(document);
    const nonAds = candidates.filter(candidate => !candidate.ad);
    const pool = nonAds;
    pool.sort((a, b) => b.area - a.area || Number(!b.video.paused) - Number(!a.video.paused));
    if(pool.length)return pool[0];
    const remote=[];
    for(const frame of document.querySelectorAll('iframe')){const info=remotePlayers.find(p=>p.url===frame.src);if(!info)continue;const rect=frame.getBoundingClientRect();if(rect.width>=160&&rect.height>=90&&rectVisibleArea(rect)>0)remote.push({video:frame,rect,area:rectVisibleArea(rect),frameId:info.frameId});}
    remote.sort((a,b)=>b.area-a.area);return remote[0]||null;
  };

  const clamp = (value, minimum, maximum) => {
    if (maximum <= minimum) return minimum;
    return Math.min(Math.max(value, minimum), maximum);
  };

  const closeMenu = () => {
    menuOpen = false;needsPermission=false;button.disabled=false;audioButton.disabled=false;button.title=button.getAttribute('aria-label');audioButton.title='음원만 다운로드 (M4A)';host.dataset.needsPermission='false';
    host.dataset.menuOpen = 'false';
    schedulePosition();
  };

  const position = () => {
    animationFrame = 0;
    if (!chrome.runtime?.id) { disposed=true;clearInterval(poll);host.remove();return; }
    if (disposed || !enabled || !downloadButtonVisible || !attachHost()) {
      host.style.display = 'none';
      return;
    }

    const candidate = mainVideo();
    if (!candidate) {
      restoreXSpacing();
      menuOpen = false;
      host.dataset.menuOpen = 'false';
      host.style.display = 'none';
      return;
    }

    selectedFrameId=candidate.frameId||0;
    restoreXSpacing();
    const rect = candidate.rect;
    const isPhoto=candidate.video instanceof HTMLImageElement;button.setAttribute('aria-label',isPhoto?(location.pathname.startsWith('/stories/')?'스토리 사진 다운로드':'게시물 사진 다운로드'):'영상 다운로드');
    audioButton.hidden=isPhoto;audioButton.style.display=isPhoto?'none':'';
    // YouTube changes routes without reloading, so update the layout on every pass.
    const isYouTubeShorts = /(^|\.)youtube\.com$/.test(location.hostname) && /^\/shorts(?:\/|$)/.test(location.pathname);
    const externalVertical = isInstagram || isYouTubeShorts;
    host.dataset.externalVertical = String(externalVertical);
    feedback.style.top = externalVertical ? `${isPhoto ? 44 : 90}px` : '44px';
    const physicalUnit = 1 / zoom;
    let left;
    let top;

    if (menuOpen && needsPermission) {
      const width = Math.min(FRAME_WIDTH, Math.max(1, innerWidth * zoom - 8));
      const height = Math.min(FRAME_HEIGHT, Math.max(1, innerHeight * zoom - 8));
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      const edge = 4 * physicalUnit;
      left = clamp(rect.right - (width + RIGHT_OFFSET) * physicalUnit, edge, innerWidth - width * physicalUnit - edge);
      top = clamp(rect.bottom - (height + CONTROLS_OFFSET) * physicalUnit, edge, innerHeight - height * physicalUnit - edge);
    } else {
      frame.style.width = `${FRAME_WIDTH}px`;
      frame.style.height = `${FRAME_HEIGHT}px`;
      const width = (isPhoto?BUTTON_SIZE:BUTTON_SIZE*2+6) * physicalUnit;
      const height = BUTTON_SIZE * physicalUnit;
      left = clamp(rect.right - width, 4 * physicalUnit, innerWidth - width - 4 * physicalUnit);
      top = candidate.xModal ? clamp(Math.max(rect.top,0) + 12 * physicalUnit, 4 * physicalUnit, innerHeight - height - 4 * physicalUnit) : clamp(rect.bottom + 8 * physicalUnit,4*physicalUnit,innerHeight-height-4*physicalUnit);
      if(candidate.xModal)left=clamp(Math.min(rect.right,innerWidth) - width - 12 * physicalUnit,4 * physicalUnit,innerWidth-width-4 * physicalUnit);
      if (externalVertical) {
        // Keep controls outside Instagram media and YouTube Shorts.
        const stackHeight = (isPhoto ? BUTTON_SIZE : BUTTON_SIZE * 2 + 6) * physicalUnit;
        left = rect.right + 8 * physicalUnit;
        top = clamp(Math.max(rect.top, 0), 4 * physicalUnit, innerHeight - stackHeight - 4 * physicalUnit);
      }
    }

    host.style.left = `${Math.round(left * 100) / 100}px`;
    host.style.top = `${Math.round(top * 100) / 100}px`;
    host.style.display = 'block';
  };

  const schedulePosition = () => {
    if (disposed || animationFrame) return;
    animationFrame = requestAnimationFrame(position);
  };

  const refreshState = (openAfterRefresh) => {
    try {
      chrome.runtime.sendMessage({ target: 'background', type: 'getDownloadState' }, (response) => {
        if (chrome.runtime.lastError || disposed) return;
        if (response && Number.isFinite(Number(response.zoom)) && Number(response.zoom) > 0) zoom = Number(response.zoom);
        if (response && Number.isInteger(response.tabId)) tabId = response.tabId;
        if (openAfterRefresh) {
          if (!Number.isInteger(tabId)) return;
          frame.src = chrome.runtime.getURL('player-menu.html') + '?request=' + encodeURIComponent(prepareId || crypto.randomUUID()) + '#' + tabId + (selectedFrameId?'&frame='+selectedFrameId:'') + (selectedVideoToken?'&video='+selectedVideoToken:'') + (prepareId?'&prepare='+prepareId:'') + (outputMode==='audio'?'&audio':'') + '&quick';
          menuOpen = true;button.disabled=true;audioButton.disabled=true;button.title=outputMode==='audio'?'음원 확인 중...':'최고 화질 영상 확인 중...';audioButton.title='음원 확인 중...';
          host.dataset.menuOpen = 'true';
        }
        host.style.transform = `scale(${1 / zoom})`;
        schedulePosition();
      });
    } catch (_) {}
  };

  const requestDownload = async (event,mode) => {
    event.preventDefault();event.stopPropagation();
    if(menuOpen||!downloadButtonVisible)return;
    outputMode=mode;feedback.textContent='';
    const x=globalThis.__videoShortcutX;if(x){const v=(x.mainDownloadTarget||x.mainVideo)();if(!v)return;selectedVideoToken=crypto.randomUUID();v.setAttribute('data-vs-x-target',selectedVideoToken);if(/(^|\.)instagram\.com$/.test(location.hostname)){v.setAttribute('data-vs-ig-source',v.currentSrc||v.src||'');v.setAttribute('data-vs-ig-page',location.pathname);v.setAttribute('data-vs-ig-story-id',location.pathname.match(/^\/stories\/[^/]+\/(\d+)/)?.[1]||'');}}else {const selected=mainVideo()?.video;selectedVideoToken=selected?.tagName==='VIDEO'?crypto.randomUUID():null;if(selectedVideoToken)selected.setAttribute('data-vs-x-target',selectedVideoToken);}
    button.disabled=true;audioButton.disabled=true;button.title='화질 확인 중...';
    try{const created=await chrome.runtime.sendMessage({target:'background',type:'prepareDownload',outputMode});if(!created?.ok)throw Error(created?.error||'다운로드를 준비하지 못했습니다.');prepareId=created.id;refreshState(true);}catch(e){feedback.textContent=e.message;button.disabled=false;audioButton.disabled=false;}
  };
  button.addEventListener('click',e=>requestDownload(e,'video'));
  audioButton.addEventListener('click',e=>requestDownload(e,'audio'));

  const onRuntimeMessage = (message) => {
    if (message?.type === 'pageZoom') setZoom(message.zoom);
  };

  const onStorageChanged = (changes, areaName) => {
    if (areaName === 'local' && changes.sites) setEnabled(changes.sites.newValue);
    if(areaName==='local'&&changes.downloadButtonVisible){downloadButtonVisible=changes.downloadButtonVisible.newValue!==false;if(!downloadButtonVisible)host.style.display='none';schedulePosition();}
  };

  const onWindowMessage = (event) => {
    if(event.source!==frame.contentWindow||event.origin!==runtimeOrigin||event.data?.source!=='videoShortcutMenu')return;
    if(['downloadStarted','closeMenu'].includes(event.data.type)){closeMenu();feedback.textContent='';}
    else if(event.data.type==='permissionNeeded'){needsPermission=true;host.dataset.needsPermission='true';schedulePosition();}
    else if(event.data.type==='quickError'){closeMenu();feedback.textContent=event.data.text||'다운로드할 수 없습니다.';button.title=feedback.textContent;}
  };

  const onFullscreenChange = () => {
    if (document.fullscreenElement instanceof HTMLVideoElement) closeMenu();
    schedulePosition();
  };

  const onOutsideClick = event => { if (menuOpen && !event.composedPath().includes(host)) closeMenu(); };
  document.addEventListener('pointerdown', onOutsideClick, true);
  const onViewportChange = () => schedulePosition();
  const refreshRemotePlayers=()=>{try{chrome.runtime.sendMessage({target:'background',type:'getFramePlayers',purpose:'download'},r=>{if(chrome.runtime.lastError||disposed)return;remotePlayers=r?.players||[];schedulePosition();});}catch(_){}};
  const poll = setInterval(()=>{schedulePosition();refreshRemotePlayers();}, 1000);
  refreshRemotePlayers();

  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('message', onWindowMessage);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.storage.local.get(['sites','downloadButtonVisible']).then(result => {downloadButtonVisible=result.downloadButtonVisible!==false;setEnabled(result.sites);}).catch(() => setEnabled(undefined));
  refreshState(false);
  attachHost();
  schedulePosition();

  globalThis.__videoShortcutPlayerDownload = {
    version: VERSION,
    dispose() {
      if (disposed) return;
      disposed = true;
      restoreXSpacing();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      clearInterval(poll);
      document.removeEventListener('pointerdown', onOutsideClick, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('message', onWindowMessage);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      host.remove();
    }
  };
})();
