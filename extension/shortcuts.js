(() => {
  'use strict';
  if (globalThis.__videoShortcutInstalled?.version === '2.1.0') return;
  try { globalThis.__videoShortcutInstalled?.dispose?.(); } catch (_) {}
  const trackedVideos = new Map();
  const VERSION = '2.1.0';
  const site = location.protocol + '//' + location.hostname;
  const defaultSite = 'https://redko5.com';
  let enabled = false;
  const embeddedFrame=typeof window!=='undefined'&&window.top!==window;
  let remotePlayers=[];
  const refreshRemote=()=>{if(embeddedFrame||typeof chrome.runtime.sendMessage!=='function')return;chrome.runtime.sendMessage({target:'background',type:'getFramePlayers'}).then(r=>{remotePlayers=r?.players||[];}).catch(()=>{});};
  const remoteVideo=()=>{const frames=[];for(const f of document.querySelectorAll('iframe')){const known=remotePlayers.find(p=>p.url===f.src);if(!known)continue;const r=f.getBoundingClientRect();if(r.width>=160&&r.height>=90)frames.push({element:f,info:known,area:r.width*r.height});}return frames.sort((a,b)=>b.area-a.area)[0]||null;};
  let theater = null;
  function restoreTheater() {
    if (!theater) return;
    const {box,video,boxStyle,videoStyle} = theater;
    if (boxStyle === null) box.removeAttribute('style'); else box.setAttribute('style',boxStyle);
    if (video !== box) { if (videoStyle === null) video.removeAttribute('style'); else video.setAttribute('style',videoStyle); }
    theater = null;
  }
  function toggleTheater(video) {
    if (theater) { restoreTheater(); return; }
    let box = video.closest('.direct-player, .video-js, .jwplayer, .plyr, [data-player]') || video.parentElement;
    if (!box || box === document.body || box === document.documentElement) box = video;
    const vr=video.getBoundingClientRect(), br=box.getBoundingClientRect();
    if (br.width > vr.width*1.8 || br.height > vr.height*1.8) box=video;
    theater={box,video,boxStyle:box.getAttribute('style'),videoStyle:video.getAttribute('style')};
    const p=(e,k,v)=>e.style.setProperty(k,v,'important');
    for (const [k,v] of Object.entries({position:'fixed',top:'0',left:'0',width:'100vw',height:'85vh','max-width':'none','max-height':'none','z-index':'2147483646',margin:'0','aspect-ratio':'auto',background:'#000'})) p(box,k,v);
    if(box!==video)for(const [k,v] of Object.entries({width:'100%',height:'100%','max-width':'none','max-height':'none','object-fit':'contain'}))p(video,k,v);
  }
  const update = async sites => { if(embeddedFrame){try{enabled=!!(await chrome.runtime.sendMessage({target:'background',type:'getFrameContext'}))?.enabled;}catch(_){enabled=false;}}else enabled = Object.prototype.hasOwnProperty.call(sites || {}, site) ? !!sites[site] : site === defaultSite; if (!enabled) { for(const state of trackedVideos.values())state.pending=0;restoreTheater(); }else{mainVideo();refreshRemote();} };
  chrome.storage.local.get('sites').then(x => update(x.sites)).catch(() => {});
  const onSiteChange=(changes, area) => { if (area === 'local' && changes.sites) update(changes.sites.newValue); };
  chrome.storage.onChanged.addListener(onSiteChange);
  // Browsers do not expose a universal frame index. Use observed presentation
  // timestamps when available; otherwise estimate a single frame from cadence.
  function trackVideo(video) {
    if (trackedVideos.has(video)) return trackedVideos.get(video);
    const state={intervals:[],times:[],last:null,token:null,pending:0,draining:false};
    trackedVideos.set(video,state);
    const sample=(_,meta)=>{
      if(!chrome.runtime?.id || !video.isConnected){trackedVideos.delete(video);return;}
      const prev=state.last;
      if(prev && !video.seeking){const frames=meta.presentedFrames-prev.presentedFrames,dt=meta.mediaTime-prev.mediaTime;if(frames>0&&dt>0&&dt<1){const duration=dt/frames;if(duration>=1/240&&duration<=1/10){state.intervals.push(duration);if(state.intervals.length>60)state.intervals.shift();}}}
      state.last={mediaTime:meta.mediaTime,presentedFrames:meta.presentedFrames};
      if(Number.isFinite(meta.mediaTime)&&!state.times.some(t=>Math.abs(t-meta.mediaTime)<.00001)){state.times.push(meta.mediaTime);state.times.sort((a,b)=>a-b);if(state.times.length>180){const farthest=state.times.reduce((i,t,k,a)=>Math.abs(t-meta.mediaTime)>Math.abs(a[i]-meta.mediaTime)?k:i,0);state.times.splice(farthest,1);}}
      state.token=video.requestVideoFrameCallback(sample);
    };
    if(typeof video.requestVideoFrameCallback==='function')state.token=video.requestVideoFrameCallback(sample);
    return state;
  }
  function frameDuration(state) {
    if(!state.intervals.length)return 1/30;
    const sorted=[...state.intervals].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
    const rates=[24000/1001,24,25,30000/1001,30,48,50,60000/1001,60,100,120,144,240];
    const closest=rates.reduce((best,fps)=>Math.abs(1/fps-median)<Math.abs(1/best-median)?fps:best,30);
    return Math.abs(1/closest-median)<median*.015?1/closest:median;
  }
  function seekSettled(video,target) {
    return new Promise(resolve=>{
      let done=false;
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);video.removeEventListener('seeked',onSeeked);resolve();};
      const onSeeked=()=>setTimeout(finish,25);
      const timer=setTimeout(finish,450);
      video.addEventListener('seeked',onSeeked,{once:true});
      try{video.currentTime=target;}catch(_){finish();}
      if(!video.seeking)setTimeout(finish,25);
    });
  }
  function stepFrame(video,direction) {
    if(!Number.isFinite(video.duration)||video.duration<=0)return;
    const state=trackVideo(video);video.pause();
    state.pending=Math.max(-60,Math.min(60,state.pending+direction));
    if(state.draining)return;
    state.draining=true;
    (async()=>{try{while(state.pending && enabled && chrome.runtime?.id){
      const dir=Math.sign(state.pending);state.pending-=dir;
      const dt=frameDuration(state),current=video.currentTime;
      const displayed=state.last?.mediaTime;
      const anchor=Number.isFinite(displayed)&&Math.abs(current-displayed)<dt*.55?displayed:current;
      const candidates=state.times.filter(t=>dir>0?t>anchor+dt*.1&&t<anchor+dt*1.6:t<anchor-dt*.1&&t>anchor-dt*1.6);
      const known=dir>0?candidates[0]:candidates[candidates.length-1];
      const target=Math.max(0,Math.min(video.duration,known==null?anchor+dir*dt:known));
      await seekSettled(video,target);
    }}finally{state.draining=false;}})().catch(()=>{state.draining=false;state.pending=0;});
  }

  function mainVideo() {
    if(globalThis.__videoShortcutX){const v=globalThis.__videoShortcutX.mainVideo();if(v)trackVideo(v);return v;}
    const videos = [];
    const collect = (doc, depth) => {
      try {
        for (const v of doc.querySelectorAll('video')) {
          const r = v.getBoundingClientRect();
          if (r.width >= 80 && r.height >= 45 && getComputedStyle(v).visibility !== 'hidden' && getComputedStyle(v).display !== 'none') {trackVideo(v);videos.push({v, area:r.width*r.height});}
        }
        if (depth < 3) for (const frame of doc.querySelectorAll('iframe')) { try { if (frame.contentDocument) collect(frame.contentDocument, depth + 1); } catch (_) {} }
      } catch (_) {}
    };
    collect(document, 0);
    videos.sort((a,b) => b.area - a.area || Number(!b.v.paused) - Number(!a.v.paused));
    return videos[0]?.v;
  }
  const onKeyDown = event => {
    if(!chrome.runtime?.id)return;
    if (event.composedPath().some(el => (el?.id === 'video-shortcut-download-widget' || el?.id === 'video-shortcut-player-download'))) return;
    if (event.key === 'Escape' && theater) { event.preventDefault(); restoreTheater(); return; }
    if (!enabled || event.defaultPrevented || event.altKey || event.metaKey || event.isComposing) return;
    const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight';
    if((event.ctrlKey||event.shiftKey)&&(!horizontal||(event.ctrlKey&&event.shiftKey)))return;
    const target = event.target;
    if (target instanceof Element && !(target instanceof HTMLVideoElement) && (target.isContentEditable || target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"]'))) return;
    const key = event.code === 'Space' ? ' ' : event.key.toLowerCase();
    const video = mainVideo();
    if(!video){const remote=remoteVideo();if(!remote||![' ','k','j','l','arrowleft','arrowright','arrowup','arrowdown','m','t','f'].includes(key))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(key==='t'){if(!event.repeat)toggleTheater(remote.element);return;}
      if(key==='f'){if(!event.repeat){const doc=remote.element.ownerDocument;if(doc.fullscreenElement)doc.exitFullscreen().catch(()=>{});else remote.element.requestFullscreen().catch(()=>{});}return;}
      chrome.runtime.sendMessage({target:'background',type:'relayFrameKey',frameId:remote.info.frameId,key:event.key,code:event.code,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,repeat:event.repeat}).catch(()=>{});return;
    }
    if(embeddedFrame&&['t','f'].includes(key)){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)chrome.runtime.sendMessage({target:'background',type:'relayParentViewKey',key}).catch(()=>{});return;}
    const seek = seconds => { const state=trackVideo(video);state.pending=0;if (Number.isFinite(video.duration)) video.currentTime = Math.max(0,Math.min(video.duration,video.currentTime+seconds)); };
    if(horizontal&&(event.ctrlKey||event.shiftKey)){event.preventDefault();event.stopImmediatePropagation();const dir=key==='arrowleft'?-1:1;if(event.ctrlKey)stepFrame(video,dir);else seek(dir*30);return;}
    if (key === 't' && (location.hostname === 'youtube.com' || location.hostname.endsWith('.youtube.com'))) return;
    const actions = {
      ' ': () => { if (!event.repeat) video.paused ? video.play().catch(() => {}) : video.pause(); },
      'k': () => { if (!event.repeat) video.paused ? video.play().catch(() => {}) : video.pause(); },
      'arrowleft': () => seek(-5), 'arrowright': () => seek(5),
      'j': () => seek(-10), 'l': () => seek(10),
      'arrowup': () => { video.volume=Math.min(1,Math.round((video.volume+0.05)*100)/100); video.muted=false; },
      'arrowdown': () => { video.volume=Math.max(0,Math.round((video.volume-0.05)*100)/100); },
      'm': () => { if (!event.repeat) video.muted=!video.muted; },
      't': () => { if (!event.repeat) toggleTheater(video); },
      'f': () => { if (!event.repeat) { const d=video.ownerDocument; if (d.fullscreenElement) d.exitFullscreen().catch(()=>{}); else video.requestFullscreen().catch(()=>{}); } }
    };
    if (!Object.hasOwn(actions,key)) return;
    event.preventDefault(); event.stopImmediatePropagation(); actions[key]();
  };
  document.addEventListener('keydown',onKeyDown,true);
  const onParentView=msg=>{if(!embeddedFrame&&msg?.type==='parentViewKey'&&['t','f'].includes(msg.key))document.dispatchEvent(new KeyboardEvent('keydown',{key:msg.key,bubbles:true,cancelable:true}));};
  chrome.runtime.onMessage?.addListener(onParentView);
  const sampleTimer=setInterval(()=>{if(!chrome.runtime?.id){clearInterval(sampleTimer);return;}if(enabled){mainVideo();refreshRemote();}},1200);
  if(enabled)mainVideo();
  globalThis.__videoShortcutInstalled={version:VERSION,dispose(){clearInterval(sampleTimer);document.removeEventListener('keydown',onKeyDown,true);chrome.storage.onChanged.removeListener(onSiteChange);chrome.runtime.onMessage?.removeListener(onParentView);for(const [video,state] of trackedVideos){state.pending=0;if(state.token!=null&&typeof video.cancelVideoFrameCallback==='function')try{video.cancelVideoFrameCallback(state.token);}catch(_){}}trackedVideos.clear();restoreTheater();}};
})();
