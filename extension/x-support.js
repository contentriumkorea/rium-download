(() => {
  'use strict';
  if (!['x.com', 'twitter.com'].includes(location.hostname)) return;
  const version = '2.3.2';
  if (globalThis.__videoShortcutX?.version === version) return;
  try { globalThis.__videoShortcutX?.dispose?.(); } catch (_) {}
  let chosen=null;
  function mainVideo() {
    const items = [];
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect(), s = getComputedStyle(v);
      const area = Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
      if (!v.isConnected || r.width < 80 || r.height < 45 || area <= 0 || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      items.push({v, area, total:r.width*r.height, dialog:!!v.closest('[role="dialog"]')});
    }
    const dialogItems=items.filter(x=>x.dialog && x.area>=10000);
    const pool=dialogItems.length?dialogItems:items;
    const pinned=pool.find(x=>x.v===chosen);
    if(pinned && pinned.area >= 10000 && pinned.area/pinned.total >= 0.25) return chosen;
    pool.sort((a,b) => b.area-a.area || Number(!b.v.paused)-Number(!a.v.paused));
    chosen=pool[0]?.v || null;
    return chosen;
  }
  function context(v) {
    if (!v) return null;
    const article = v.closest('article');
    const link = article && [...article.querySelectorAll('a[href*="/status/"]')].find(a => a.querySelector('time'));
    let u; try { u = new URL(link?.href || location.href); } catch (_) { return null; }
    if (u.origin !== location.origin || !/^\/[A-Za-z0-9_]+\/status\/\d+(?:\/video\/\d+)?$/.test(u.pathname)) return null;
    const statusPath = u.pathname.match(/^\/[A-Za-z0-9_]+\/status\/\d+/)[0];
    const id = statusPath.split('/').pop();
    return {url:u.origin+statusPath, title:'X '+statusPath.split('/')[1]+' · '+id, id};
  }
  function collect(token) {
    const v = token ? [...document.querySelectorAll('video')].find(v => v.getAttribute('data-vs-x-target') === token) : mainVideo();
    const fail = reason => ({items:[],hasVideo:!!v,reason});
    if (!v?.isConnected) return fail('선택한 영상이 화면에서 사라졌습니다. 영상 아래 버튼을 다시 눌러 주세요.');
    if (v.mediaKeys) return fail('보호된 영상은 다운로드할 수 없습니다.');
    const ctx = context(v);
    if (!ctx) return fail('영상의 게시물 링크를 확인하지 못했습니다. 게시물을 열고 다시 시도해 주세요.');
    const component = v.closest('[data-testid="videoComponent"]');
    let fiber = component?.[Object.keys(component).find(k => k.startsWith('__reactFiber$'))];
    let variants = null;
    // Read only metadata of this player. No API calls, tokens, or other posts.
    for (let i=0; fiber && i<14; i++,fiber=fiber.return) {
      const p=fiber.memoizedProps;
      if (Array.isArray(p?.variants) && p.poster === v.poster) { variants=p.variants; break; }
    }
    const items=[],seen=new Set();
    for (const variant of variants || []) {
      let u; try { u=new URL(variant.src); } catch (_) { continue; }
      if (u.protocol!=='https:' || u.hostname!=='video.twimg.com' || u.username || u.password || !/\.mp4$/i.test(u.pathname) || variant.type!=='video/mp4' || seen.has(u.href)) continue;
      seen.add(u.href);
      const match=u.pathname.match(/\/(\d{2,5})x(\d{2,5})\//),width=Number(match?.[1]||0),height=Number(match?.[2]||0);
      items.push({url:u.href,kind:'direct',height,width,bandwidth:Number(variant.bitrate)||0,label:'X MP4 · '+(width&&height?width+'×'+height:'제공 화질'),title:ctx.title,filename:'X_'+ctx.id+'.mp4'});
    }
    items.sort((a,b)=>(b.width*b.height)-(a.width*a.height)||b.bandwidth-a.bandwidth);
    return {items,hasVideo:true,reason:items.length?'':'X가 제공한 일반 MP4를 찾지 못했습니다. 라이브·보호 영상은 지원하지 않습니다.',context:ctx};
  }
  const onPointerDown = event => {
    const target=event.target; if (!target?.closest) return;
    const player=target.closest('[data-testid="videoPlayer"]');
    const video=player?.querySelector('video');
    if(video?.isConnected) chosen=video;
  };
  if(typeof document.addEventListener==='function') document.addEventListener('pointerdown',onPointerDown,true);
  const dispose=()=>{if(typeof document.removeEventListener==='function')document.removeEventListener('pointerdown',onPointerDown,true);chosen=null;};
  globalThis.__videoShortcutX = {version, mainVideo, context, collect, dispose};
})();
