(() => {
  'use strict';
  const VERSION = '3.0.0';
  if (globalThis.videoShortcutMedia?.version === VERSION) return;
  const safe = fn => {try {return fn();} catch (_) {return undefined;}};
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const list = value => Array.isArray(value) ? value : [];
  function parent(element) {return element?.parentElement || safe(() => element.getRootNode().host) || null;}
  function isAd(v) {
    for (let e=v, i=0; e && i<20; e=parent(e), i++) {
      const classes = String(e.className?.baseVal ?? e.className ?? '');
      if (/(?:^|\s)(?:ad-showing|ad-interrupting|video-ads|ima-ad-container|vjs-ad-playing|vjs-ad-loading|jw-flag-ads)(?:\s|$)/i.test(classes)) return true;
      if (/^(?:advertisement|advertising|광고)(?:\s|$)/i.test(e.getAttribute?.('aria-label') || '')) return true;
      if (e.getAttribute?.('data-ad') === 'true' || e.getAttribute?.('data-ad-status') === 'playing') return true;
    }
    return false;
  }
  function visibleRect(v) {
    if (!v?.isConnected) return null;
    let win=v.ownerDocument?.defaultView, r=safe(() => v.getBoundingClientRect());
    if (!win || !r || r.width<40 || r.height<25) return null;
    let box={left:r.left, top:r.top, right:r.right, bottom:r.bottom};
    const clip = r => {box.left=Math.max(box.left,r.left);box.top=Math.max(box.top,r.top);box.right=Math.min(box.right,r.right);box.bottom=Math.min(box.bottom,r.bottom);};
    for (let e=v, i=0; e && i<60; e=parent(e), i++) {
      const s=safe(() => win.getComputedStyle(e));
      if (s && (s.display==='none' || s.visibility==='hidden' || s.visibility==='collapse' || Number(s.opacity)===0)) return null;
      if (e!==v && e!==v.ownerDocument.scrollingElement && e!==v.ownerDocument.documentElement && s && /hidden|clip|auto|scroll/.test((s.overflow||'')+' '+(s.overflowX||'')+' '+(s.overflowY||''))) {
        const er=safe(() => e.getBoundingClientRect()); if(er) clip(er);
      }
    }
    for (let depth=0; win && depth<12; depth++) {
      clip({left:0,top:0,right:win.innerWidth,bottom:win.innerHeight});
      const frame=safe(() => win.frameElement);
      if (!frame) break;
      const fr=safe(() => frame.getBoundingClientRect()), outer=frame.ownerDocument?.defaultView;
      if (!fr || !outer) break;
      const fs=safe(() => outer.getComputedStyle(frame));
      if(fs && (fs.display==='none'||fs.visibility==='hidden'||Number(fs.opacity)===0)) return null;
      const sx=fr.width/(frame.offsetWidth||fr.width||1), sy=fr.height/(frame.offsetHeight||fr.height||1);
      const x=fr.left+(frame.clientLeft||0)*sx, y=fr.top+(frame.clientTop||0)*sy;
      box={left:x+box.left*sx,right:x+box.right*sx,top:y+box.top*sy,bottom:y+box.bottom*sy};
      clip(fr); win=outer;
    }
    const area=Math.max(0,box.right-box.left)*Math.max(0,box.bottom-box.top);
    return area>0 ? {area} : null;
  }
  function videosIn(rootDocument) {
    const videos=[], docs=new Set(), roots=new Set();
    function walk(root, depth=0) {
      if (!root || roots.has(root) || depth>24) return;
      roots.add(root);
      if(root.nodeType===9) docs.add(root);
      for (const e of safe(() => root.querySelectorAll('*')) || []) {
        const tag=e.tagName?.toLowerCase();
        if(tag==='video') videos.push(e);
        if(e.shadowRoot) walk(e.shadowRoot,depth+1);
        // Accessing contentDocument is guarded: cross-origin frames stay untouched.
        if(tag==='iframe') walk(safe(() => e.contentDocument),depth+1);
      }
    }
    walk(rootDocument);
    return {videos, docs};
  }
  function http(raw, doc) {
    if (typeof raw!=='string' || !raw.trim()) return null;
    try {const u=new URL(raw,doc.baseURI);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;} catch (_) {return null;}
  }
  function manifestKind(url, type='') {
    if (/mpegurl/i.test(type)) return 'hls';
    if (/dash\+xml/i.test(type)) return 'dash';
    try {const u=new URL(url); const values=[u.pathname,...u.searchParams.values()];
      if(values.some(x=>/\.m3u8(?:$|[?#&])/i.test(x))) return 'hls';
      if(values.some(x=>/\.mpd(?:$|[?#&])/i.test(x))) return 'dash';
    } catch (_) {}
    return null;
  }
  function qualityHeight(meta) {
    const direct=positive(meta.height);if(direct)return direct;
    const res=String(meta.res??'').trim();if(/^\d{2,4}$/.test(res))return Number(res);
    for(const value of [res,String(meta.label||'').trim()]){const m=/(?:^|\s|[·(])(\d{3,4})p(?:\d{2,3})?(?=\b|[)])/i.exec(value);if(m)return Number(m[1]);const size=/^\d{2,5}[x×](\d{2,5})$/.exec(value);if(size)return Number(size[1]);}return 0;
  }
  function boundSources(v) {
    const doc=v.ownerDocument, win=doc.defaultView, found=[];
    function add(raw, meta={}, trusted=false) {
      if(typeof raw==='object'&&raw) {meta=raw;raw=raw.src||raw.file||raw.url;}
      const url=http(raw,doc); if(!url) return;
      const type=String(meta.type||''), adaptive=meta.manifest ? 'adaptive' : manifestKind(url,type);
      // Extensionless sources are permitted only when they are loaded or come from this player's API.
      if(!adaptive && !trusted && !/^video\//i.test(type) && !/\.(?:mp4|m4v|webm|ogv|ogg|mov)$/i.test(new URL(url).pathname)) return;
      found.push({url,adaptive,height:qualityHeight(meta),bandwidth:positive(meta.bandwidth||meta.bitrate),label:typeof meta.label==='string'?meta.label:''});
    }
    add(v.currentSrc, {height:v.videoHeight}, true);
    add(v.getAttribute?.('src'));
    for(const s of safe(()=>v.querySelectorAll('source'))||[]) add(s.src||s.getAttribute('src'), {type:s.type,height:s.getAttribute('data-height'),res:s.getAttribute('res')||s.getAttribute('data-res'),label:s.getAttribute('label')||s.getAttribute('data-label')});
    // Video.js: registry only, then exact tech element identity. Never instantiate a player.
    const vjs=safe(()=>win.videojs?.getPlayers?.()) || safe(()=>win.videojs?.players);
    for(const p of Object.values(vjs||{}).slice(0,100)) {
      const tech=safe(()=>p.tech?.({IWillNotUseThisInPlugins:true}));
      if(safe(()=>tech?.el?.())!==v) continue;
      for(const src of list(safe(()=>p.currentSources?.()))) add(src,{},true);
    }
    // Plyr attaches its public instance directly to its media element.
    const plyr=safe(()=>v.plyr);
    if(plyr?.media===v) for(const src of list(safe(()=>plyr.source?.sources))) add(src,{},true);
    // Shaka UI's official player getter plus explicitly exposed optional instances.
    const shakaUI=safe(()=>v.ui?.getControls?.()?.getPlayer?.());
    const optional=[shakaUI,safe(()=>v.shakaPlayer),safe(()=>win.shakaPlayer),safe(()=>v.dashPlayer),safe(()=>win.dashPlayer),safe(()=>v.hls),safe(()=>win.hls),safe(()=>win.hlsPlayer),safe(()=>v.clappr),safe(()=>win.clapprPlayer),safe(()=>v.flowplayer),safe(()=>win.player)];
    for(const p of new Set(optional.filter(Boolean))) {
      if(safe(()=>p.getMediaElement?.())===v) add(safe(()=>p.getManifestUri?.()),{manifest:true},true);
      if(safe(()=>p.getVideoElement?.())===v) add(safe(()=>p.getSource?.()),{manifest:true},true);
      if(safe(()=>p.media)===v) add(safe(()=>p.url),{type:'application/vnd.apple.mpegurl'},true);
      // Clappr exposes the active playback; options are read only after exact media binding.
      const playback=safe(()=>p.core?.activePlayback);
      if(safe(()=>playback.el)===v) add(safe(()=>playback.options?.src)||safe(()=>p.options?.source),{},true);
      // Flowplayer variants expose a media element or engine element. No factory calls.
      if(safe(()=>p.engine?.element)===v || safe(()=>p.video)===v) {
        const src=safe(()=>p.video?.src)||safe(()=>p.conf?.src);
        if(Array.isArray(src)) for(const s of src) add(s,{},true); else add(src,{},true);
      }
    }
    // JW's getter is used only on a rendered JW container, and verified against its actual container.
    for(let e=parent(v),i=0;e&&i<12;e=parent(e),i++) {
      if(!e.id || !/(?:^|\s)jwplayer(?:\s|$)/.test(String(e.className||'')) || typeof win.jwplayer!=='function') continue;
      const p=safe(()=>win.jwplayer(e.id)), container=safe(()=>p.getContainer());
      const members=safe(()=>container.querySelectorAll('video'));
      if(container!==e || members?.length!==1 || members[0]!==v || safe(()=>p.getState?.())==='advertising') continue;
      const currentIndex=safe(()=>p.getPlaylistIndex?.());
      const item=safe(()=>p.getPlaylistItem?.()) || (Number.isInteger(currentIndex) ? list(safe(()=>p.getPlaylist?.()))[currentIndex] : null);
      if(item) {add(item,{},true);for(const s of list(item.sources)) add(s,{},true);}
      break;
    }
    const unique=new Map();
    for(const x of found) {
      const old=unique.get(x.url);
      if(!old) unique.set(x.url,x);
      else unique.set(x.url,{...old,adaptive:old.adaptive||x.adaptive,height:old.height||x.height,bandwidth:old.bandwidth||x.bandwidth,label:old.label||x.label});
    }
    return [...unique.values()];
  }
  async function collect(token=null) {
    const context=videosIn(document);
    const exact=token!==null&&token!==undefined;
    const matches=exact?context.videos.filter(v=>v.getAttribute('data-vs-x-target')===String(token)):[];
    const visible=context.videos.map(v=>({v,rect:visibleRect(v)})).filter(x=>x.rect&&!isAd(x.v));
    visible.sort((a,b)=>b.rect.area-a.rect.area||Number(a.v.paused)-Number(b.v.paused));
    const v=exact?(matches.length===1?matches[0]:null):visible[0]?.v;
    const fail=reason=>({items:[],hasVideo:!!v,reason});
    if(!v) return fail(exact?'선택한 영상을 찾을 수 없거나 중복됩니다. 영상 버튼을 다시 눌러 주세요.':'화면에 표시된 일반 영상을 찾지 못했습니다.');
    if(!v.isConnected) return fail('선택한 영상이 페이지에서 사라졌습니다.');
    if(isAd(v)) return fail('광고 영상은 지원하지 않습니다.');
    if(v.mediaKeys) return fail('DRM으로 보호된 영상은 다운로드할 수 없습니다.');
    const duration=Number(v.duration), currentSrc=v.currentSrc||'', sources=boundSources(v), items=[], errors=[];
    const inspect=globalThis.videoShortcutAdaptive?.inspect;
    async function adaptive(source, fallback=false) {
      if(typeof inspect!=='function') {errors.push('스트리밍 목록 분석기를 사용할 수 없습니다.');return [];}
      try {
        const result=await inspect(source.url,{duration:v.duration,videoHeight:v.videoHeight});
        const candidates=Array.isArray(result)?result:list(result?.items);
        if(!candidates.length && result?.reason) errors.push(String(result.reason));
        return candidates.filter(c=>c?.kind==='adaptive'&&c.plan&&http(c.url,v.ownerDocument)).filter(c=>{
          if(!fallback) return true;
          const d=Number(c.plan.duration);
          return Number.isFinite(duration)&&duration>0&&Number.isFinite(d)&&d>0&&Math.abs(d-duration)<=Math.max(2,duration*0.02);
        }).map(c=>({...c,kind:'adaptive',label:c.label||source.label||'스트리밍 영상',height:positive(c.height||source.height),bandwidth:positive(c.bandwidth||source.bandwidth),origins:Array.isArray(c.origins)?c.origins:[],plan:c.plan}));
      } catch(error) {errors.push(String(error?.message||'스트리밍 목록을 분석하지 못했습니다.'));return [];}
    }
    for(const source of sources.slice(0,40)) {
      if(source.adaptive) items.push(...await adaptive(source));
      else items.push({url:source.url,kind:'direct',label:source.label||(source.height?source.height+'p':'원본 영상'),height:source.height,bandwidth:source.bandwidth});
    }
    if(!items.length && !sources.some(s=>s.adaptive)) {
      // Resource entries are not player bindings. Require one possible player, one manifest,
      // and a parsed VOD duration matching the selected media. Ambiguity is a hard failure.
      const sameDoc=context.videos.filter(x=>x.ownerDocument===v.ownerDocument && x.isConnected && (x.currentSrc||x.getAttribute('src')||safe(()=>x.querySelector('source'))));
      if(sameDoc.length>1) return fail('여러 플레이어가 있어 스트리밍 주소를 선택한 영상에 안전하게 연결할 수 없습니다.');
      const win=v.ownerDocument.defaultView, resources=[];
      for(const e of safe(()=>win.performance.getEntriesByType('resource'))||[]) resources.push(e.name);
      for(const e of safe(()=>win.__videoShortcutStreamWatch?.entries)||[]) resources.push(e.url);
      for(const url of list(safe(()=>win.__videoShortcutStreams))) resources.push(url);
      const manifests=[...new Set(resources.map(x=>http(x,v.ownerDocument)).filter(x=>x&&manifestKind(x)))];
      if(manifests.length>1) return fail('여러 스트리밍 목록 중 선택한 영상의 주소를 확인할 수 없어 다운로드하지 않습니다.');
      if(manifests.length===1) {
        if(!Number.isFinite(duration)||duration<=0) return fail('스트리밍 목록과 영상을 연결하려면 확정된 재생 시간이 필요합니다.');
        items.push(...await adaptive({url:manifests[0]},true));
        if(!items.length) errors.push('스트리밍 목록에서 영상 재생 시간과 일치하는 지원 형식을 찾지 못했습니다.');
      }
    }
    // Do not return a plan for a video that changed while manifest requests were pending.
    if(!v.isConnected || v.mediaKeys || (v.currentSrc||'')!==currentSrc || (exact&&v.getAttribute('data-vs-x-target')!==String(token))) return fail('분석 중 영상이 바뀌었거나 보호된 영상으로 변경되었습니다. 다시 선택해 주세요.');
    const unique=new Map();
    for(const item of items) unique.set(item.kind+'|'+item.url+'|'+item.height+'|'+item.bandwidth,item);
    const result=[...unique.values()].sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);
    return {items:result,hasVideo:true,reason:result.length?'':errors[0]||(/^blob:/i.test(currentSrc)?'MSE/blob 전용 영상입니다. 안전하게 연결된 다운로드 가능한 스트리밍 목록을 찾지 못했습니다.':'지원하는 HTTP 영상 소스나 안전하게 연결된 스트리밍 목록을 찾지 못했습니다.')};
  }
  globalThis.videoShortcutMedia = {version:VERSION,collect};
})();
