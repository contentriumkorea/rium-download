(() => {
  'use strict';
  if (!['www.instagram.com','instagram.com'].includes(location.hostname)) return;
  // Live read-only checks 2026-11-05: home feed + /p/DfP2MMzvoxO/ => 4021671325163490382, 1592x2123.
  // /p/DfMooSPGIbl/ slides => 4020767129128954794 (1206x1206), 4020767129883962303 (1174x1174).
  // Distinct filenames; previous-slide token, changed source/page/media-ID rejected. No CDN payloads stored.
  const version='instagram-2.2.1';
  if(globalThis.__videoShortcutX?.version===version)return;
  try{globalThis.__videoShortcutX?.dispose?.();}catch(_){}
  let chosen=null;
  function mainVideo(){
    const items=[];
    for(const v of document.querySelectorAll('video')){
      const r=v.getBoundingClientRect(),style=getComputedStyle(v);
      const area=Math.max(0,Math.min(innerWidth,r.right)-Math.max(0,r.left))*Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top));
      if(!v.isConnected||r.width<80||r.height<45||area<=0||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
      items.push({v,area,total:r.width*r.height,dialog:!!v.closest('[role="dialog"]')});
    }
    const dialog=items.filter(x=>x.dialog&&x.area>=10000),pool=dialog.length?dialog:items;
    const pinned=pool.find(x=>x.v===chosen);
    if(pinned&&pinned.area>=10000&&pinned.area/pinned.total>=0.25)return chosen;
    pool.sort((a,b)=>b.area-a.area||Number(!b.v.paused)-Number(!a.v.paused));
    chosen=pool[0]?.v||null;return chosen;
  }
  function storyId(){const m=/^\/stories\/[^/]+\/(\d+)\/?$/.exec(location.pathname);return m?m[1]:'';}
  function photoURL(value){
    let u;try{u=new URL(value);}catch(_){return null;}
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname))return null;
    const ext=/\.(jpe?g|png|webp)$/i.exec(u.pathname)?.[1]?.toLowerCase();
    return ext?{url:value,ext:ext==='jpeg'?'jpg':ext}:null;
  }
  // DOM-only selection also runs in the extension's ISOLATED world.
  function visibleMedia(el){
    const r=el.getBoundingClientRect();
    let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
    if(!el.isConnected||r.width<80||r.height<45)return null;
    for(let p=el;p;p=p.parentElement){
      const s=getComputedStyle(p);
      if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.hidden||p.getAttribute('aria-hidden')==='true')return null;
      // The document scroller is already clipped to the viewport above. Its bounding rect moves with scrollY and is not a viewport rectangle.
      if(p!==el&&p!==document.scrollingElement&&p!==document.documentElement){const b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|auto|scroll/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
    }
    const area=Math.max(0,right-left)*Math.max(0,bottom-top);
    return area>0?{el,area,total:r.width*r.height,dialog:el.closest('[role="dialog"]'),left,top,right,bottom}:null;
  }
  function isPostPhoto(img){
    if(img.closest('a,button,[role="button"],[role="grid"],[role="tablist"],[role="group"][aria-label="Video player"]'))return false;
    return !!(img.closest('article')||img.closest('[role="dialog"]')||(/^\/(?:p|reel)\/[^/]+\/?$/.test(location.pathname)&&img.closest('main,[role="main"]')));
  }
  let downloadChosen=null;
  function mainDownloadTarget(){
    const story=!!storyId(),items=[];
    for(const el of document.querySelectorAll('video,img')){
      const v=visibleMedia(el);if(!v)continue;
      if(el instanceof HTMLImageElement){
        if(!el.complete||el.naturalWidth<200||el.naturalHeight<200||v.area<25600||v.area/v.total<0.5||!photoURL(el.currentSrc||el.src)||(!story&&!isPostPhoto(el)))continue;
      }else if(v.area<10000)continue;
      items.push(v);
    }
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>100&&r.height>100&&s.display!=='none'&&s.visibility!=='hidden';});
    const pool=dialogs.length?items.filter(x=>x.dialog):items;
    const pinned=pool.find(x=>x.el===downloadChosen);
    if(pinned&&pinned.area/pinned.total>=0.5)return pinned.el;
    pool.sort((a,b)=>b.area-a.area);
    // Half-visible neighbouring slides during a swipe are not a stable selection.
    if(pool.length>1&&pool[0].el instanceof HTMLImageElement&&pool[1].el instanceof HTMLImageElement&&pool[0].el.closest('article')===pool[1].el.closest('article')&&pool[1].area>=pool[0].area*0.8)return null;
    return pool[0]?.el||null;
  }
  function mediaId(media){
    if(!media||typeof media!=='object')return '';
    const ids=[typeof media.__id==='string'?/^XDTMediaDict:(\d+)$/.exec(media.__id)?.[1]:null,typeof media.pk==='string'&&/^\d+$/.test(media.pk)?media.pk:null,typeof media.id==='string'?/^(\d+)(?:_\d+)?$/.exec(media.id)?.[1]:null].filter(Boolean);
    return ids.length&&ids.every(id=>id===ids[0])?ids[0]:'';
  }
  function ownsOnlyPhoto(root,img){
    const stack=[root],seen=new Set();let count=0,selected=false;
    while(stack.length){const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);if(seen.size>1500)return false;if(f.stateNode instanceof HTMLVideoElement)return false;if(f.stateNode instanceof HTMLImageElement){count++;selected ||= f.stateNode===img;if(count>1)return false;}for(let c=f.child,n=0;c&&n<1500;c=c.sibling,n++)stack.push(c);}
    return count===1&&selected;
  }
  function collectPostPhoto(img,token){
    const reject=reason=>({items:[],hasVideo:false,reason});
    const src=img.currentSrc||img.src;
    if(!photoURL(src)||!isPostPhoto(img)||mainDownloadTarget()!==img)return reject('선택한 게시물 사진이 바뀌었습니다. 해당 사진의 버튼을 다시 눌러 주세요.');
    if(token&&(img.getAttribute('data-vs-ig-source')!==src||(img.hasAttribute('data-vs-ig-page')&&img.getAttribute('data-vs-ig-page')!==location.pathname)))return reject('사진 전환 중입니다. 해당 사진의 버튼을 다시 눌러 주세요.');
    const key=Object.keys(img).find(k=>k.startsWith('__reactFiber$'));
    let fiber=key&&img[key],bound=null,id='',srcBound=false;
    // React can leave the DOM expando on the previous alternate after a commit.
    if(fiber?.memoizedProps?.src!==img.src&&fiber?.alternate?.memoizedProps?.src===img.src)fiber=fiber.alternate;
    for(let depth=0;fiber&&depth<18;depth++,fiber=fiber.return){
      const p=fiber.memoizedProps,other=fiber.alternate?.memoizedProps;
      if(typeof p?.src==='string'){
        if(p.src!==src&&p.src!==img.src)return reject('사진 전환 중입니다. 로딩이 끝난 뒤 다시 눌러 주세요.');
        if(typeof other?.src==='string'&&other.src!==p.src&&(!photoURL(other.src)||new URL(other.src).pathname!==new URL(p.src).pathname))return reject('사진 전환 중입니다. 잠시 후 다시 눌러 주세요.');
        srcBound=true;
      }
      const media=p?.['media$key']||p?.media;
      if(!media)continue;
      id=mediaId(media);
      if(!id||!srcBound||!ownsOnlyPhoto(fiber,img))return reject('선택한 사진과 게시물 정보를 안전하게 연결하지 못했습니다.');
      const alt=other?.['media$key']||other?.media;
      if(alt&&mediaId(alt)!==id)return reject('게시물 전환 중입니다. 잠시 후 다시 눌러 주세요.');
      bound=media;break;
    }
    if(!bound)return reject('선택한 게시물 사진 정보를 확인하지 못했습니다.');
    const captured=img.getAttribute('data-vs-ig-post-id');
    if(token&&captured&&captured!==id)return reject('선택한 게시물 사진이 바뀌었습니다. 다시 눌러 주세요.');
    const candidates=[{url:src,width:img.naturalWidth,height:img.naturalHeight}];
    // Only the selected photo's own bound candidates. Never parent carousel data.
    for(const c of bound.image_versions2?.candidates||[]){if(photoURL(c.url)&&Number.isInteger(c.width)&&Number.isInteger(c.height)&&c.width>0&&c.height>0)candidates.push({url:c.url,width:c.width,height:c.height});}
    for(const part of (img.srcset||'').split(',')){
      const m=/^\s*(\S+)\s+(\d+(?:\.\d+)?)(w|x)\s*$/.exec(part);if(!m||!photoURL(m[1]))continue;
      const width=m[3]==='w'?Number(m[2]):Math.round(img.naturalWidth*Number(m[2]));
      // Density descriptors cannot safely establish original dimensions.
      if(m[3]==='w')candidates.push({url:m[1],width,height:Math.round(width*img.naturalHeight/img.naturalWidth)});
    }
    candidates.sort((a,b)=>b.width*b.height-a.width*a.height);
    const best=candidates[0],source=photoURL(best.url),title='Instagram 게시물 '+id+' (사진)';
    return {items:[{kind:'direct',mediaType:'image',photoScope:'post',url:best.url,title,filename:'Instagram_post_'+id+'.'+source.ext,width:best.width,height:best.height,label:'Instagram 게시물 사진 '+best.width+'×'+best.height,origins:[new URL(best.url).origin+'/*']}],hasVideo:false,reason:'',context:context(img)};
  }
  function collectPhoto(img,token){return storyId()?collectStoryPhoto(img,token):collectPostPhoto(img,token);}
  function collectStoryPhoto(img,token){
    const reject=reason=>({items:[],hasVideo:false,reason});
    const id=storyId(),src=img.currentSrc||img.src,source=photoURL(src);
    if(!id||!source||mainDownloadTarget()!==img)return reject('선택한 스토리 사진이 바뀌었습니다. 해당 사진의 버튼을 다시 눌러 주세요.');
    if(token&&(img.getAttribute('data-vs-ig-source')!==src||img.getAttribute('data-vs-ig-story-id')!==id))return reject('스토리 전환 중입니다. 해당 사진의 버튼을 다시 눌러 주세요.');
    const key=Object.keys(img).find(k=>k.startsWith('__reactFiber$'));
    let fiber=key&&img[key],bound=false,srcBound=false;
    for(let depth=0;fiber&&depth<16;depth++,fiber=fiber.return){
      const p=fiber.memoizedProps,other=fiber.alternate?.memoizedProps;
      if(typeof p?.src==='string'){
        if(p.src!==src||(typeof other?.src==='string'&&other.src!==p.src))return reject('사진 전환 중입니다. 로딩이 끝난 뒤 다시 눌러 주세요.');
        srcBound=true;
      }
      const media=p?.media;if(!media)continue;
      const mediaId=typeof media.__id==='string'?/^XDTMediaDict:(\d+)$/.exec(media.__id)?.[1]:null;
      const pk=typeof media.pk==='string'?media.pk:null;
      const explicit=typeof media.id==='string'?/^(\d+)(?:_\d+)?$/.exec(media.id)?.[1]:null;
      const ids=[mediaId,pk,explicit].filter(Boolean);
      if(!ids.length)continue;
      if(ids.some(x=>x!==id))return reject('선택한 스토리와 사진 정보가 일치하지 않습니다.');
      const alt=other?.media;
      if(alt&&['__id','pk','id'].some(k=>typeof alt[k]==='string'&&typeof media[k]==='string'&&alt[k]!==media[k]))return reject('스토리 전환 중입니다. 잠시 후 다시 눌러 주세요.');
      const stack=[fiber],seen=new Set();let count=0,selected=false,video=false;
      while(stack.length&&seen.size<1500){const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);if(f.stateNode instanceof HTMLImageElement){count++;selected ||= f.stateNode===img;}if(f.stateNode instanceof HTMLVideoElement)video=true;for(let c=f.child,n=0;c&&n<1500;c=c.sibling,n++)stack.push(c);}
      if(stack.length||count!==1||!selected||video)return reject('선택한 사진과 스토리 정보를 안전하게 연결하지 못했습니다.');
      bound=true;break;
    }
    if(!bound||!srcBound)return reject('선택한 스토리 사진 정보를 확인하지 못했습니다.');
    const title='Instagram 스토리 '+id+' (사진)';
    return {items:[{kind:'direct',mediaType:'image',photoScope:'story',url:src,title,filename:'Instagram_story_'+id+'.'+source.ext,width:img.naturalWidth,height:img.naturalHeight,label:'Instagram 스토리 사진 '+img.naturalWidth+'×'+img.naturalHeight,origins:[new URL(src).origin+'/*']}],hasVideo:false,reason:'',context:context(img)};
  }
  function context(v){if(!v)return null;return {url:location.href,title:document.title||'Instagram 영상'};}
  // Only read a manifest on the selected DOM video's own player ancestor chain.
  // Never search page-wide React stores, children props, feed items, or the URL.
  function boundManifest(v){
    const key=Object.keys(v).find(k=>k.startsWith('__reactFiber$'));
    let fiber=key&&v[key];
    const ownsOnlySelectedVideo=root=>{
      const stack=[root],seen=new Set();let count=0,selected=false;
      while(stack.length){
        const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);
        if(seen.size>1500)return false;
        if(f.stateNode instanceof HTMLVideoElement){count++;selected ||= f.stateNode===v;if(count>1)return false;}
        if(f.child){for(let c=f.child,n=0;c&&n<1500;c=c.sibling,n++)stack.push(c);}
      }
      return count===1&&selected;
    };
    for(let depth=0;fiber&&depth<24;depth++,fiber=fiber.return){
      const p=fiber.memoizedProps;
      if(p&&typeof p.manifest==='string'&&p.manifest.includes('<MPD')){
        if(!ownsOnlySelectedVideo(fiber))throw new Error('선택한 영상과 스트리밍 정보를 안전하게 연결하지 못했습니다. 해당 영상의 버튼을 다시 눌러 주세요.');
        const other=fiber.alternate?.memoizedProps;
        const id=p.coreVideoPlayerMetaData?.videoFBID,otherId=other?.coreVideoPlayerMetaData?.videoFBID;
        if((id&&otherId&&id!==otherId)||(typeof other?.manifest==='string'&&other.manifest!==p.manifest&&(!id||!otherId)))throw new Error('영상 전환 중입니다. 재생이 시작된 뒤 다시 눌러 주세요.');
        return {xml:p.manifest,id:typeof id==='string'&&/^\d+$/.test(id)?id:''};
      }
    }
    throw new Error('선택한 영상에 연결된 DASH 정보를 찾지 못했습니다. 영상 재생 후 다시 눌러 주세요. 무음 파일로 대신 저장하지 않습니다.');
  }
  function durationSeconds(value){
    const m=/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value||'');
    return m&&(m[1]||m[2]||m[3])?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):NaN;
  }
  function parseTracks(xml){
    const reject=message=>{throw new Error(message);};
    if(xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))reject('지원하지 않는 DASH 문서입니다.');
    const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement;
    const all=name=>Array.from(doc.getElementsByTagNameNS('*',name));
    const children=(el,name)=>Array.from(el.children).filter(x=>x.localName===name);
    if(all('parsererror').length||root.localName!=='MPD'||root.namespaceURI!=='urn:mpeg:dash:schema:mpd:2011')reject('DASH 정보를 읽을 수 없습니다.');
    if(root.getAttribute('type')!=='static')reject('실시간 스트리밍은 저장할 수 없습니다.');
    if(all('ContentProtection').length)reject('DRM으로 보호된 영상은 다운로드할 수 없습니다.');
    if(all('Period').length!==1||children(root,'Period').length!==1)reject('여러 구간으로 나뉜 DASH 영상은 지원하지 않습니다.');
    if(all('SegmentTemplate').length||all('SegmentList').length||all('ContentComponent').length)reject('분할 세그먼트 형식은 지원하지 않습니다.');
    const period=children(root,'Period')[0],start=period.getAttribute('start');
    if(start&&durationSeconds(start)!==0)reject('시작 시각이 다른 DASH 구간은 지원하지 않습니다.');
    const expectedDuration=durationSeconds(root.getAttribute('mediaPresentationDuration')||period.getAttribute('duration'));
    const pd=durationSeconds(period.getAttribute('duration'));
    if(!Number.isFinite(expectedDuration)||expectedDuration<=0||(Number.isFinite(pd)&&Math.abs(pd-expectedDuration)>0.25))reject('영상 전체 길이를 확인할 수 없습니다.');
    const tracks=[];
    for(const set of children(period,'AdaptationSet'))for(const rep of children(set,'Representation')){
      const attr=n=>rep.getAttribute(n)||set.getAttribute(n)||'';
      const mime=attr('mimeType'),codec=attr('codecs'),type=mime==='video/mp4'?'video':mime==='audio/mp4'?'audio':'';
      if(!type||(type==='video'?!/^(?:avc1|avc3|vp09|av01)(?:\.[\w.]+)?$/i.test(codec):!/^mp4a\.40\.(?:2|5|29)$/i.test(codec)))continue;
      const bases=children(rep,'BaseURL');if(bases.length!==1)continue;
      let u;try{u=new URL(bases[0].textContent.trim());}catch(_){continue;}
      if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname)||!/\.mp4$/i.test(u.pathname))continue;
      // Keep the signed URL byte-for-byte. A range URL is not a full track.
      if([...u.searchParams.keys()].some(k=>/^(?:bytestart|byteend|range|start_byte|end_byte|start|end)$/i.test(k)))continue;
      const segments=children(rep,'SegmentBase');
      if(segments.length!==1)continue;
      const seg=segments[0],init=children(seg,'Initialization');
      if(!/^\d+-\d+$/.test(seg.getAttribute('indexRange')||'')||init.length!==1||init[0].hasAttribute('sourceURL')||!/^0-\d+$/.test(init[0].getAttribute('range')||'')||children(seg,'RepresentationIndex').length)continue;
      const bandwidth=Number(attr('bandwidth')),width=Number(attr('width')),height=Number(attr('height'));
      if(!Number.isFinite(bandwidth)||bandwidth<=0||(type==='video'&&(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)))continue;
      tracks.push({type,url:bases[0].textContent.trim(),bandwidth,width,height,codec});
    }
    const videos=tracks.filter(x=>x.type==='video').sort((a,b)=>b.width*b.height-a.width*a.height||b.height-a.height||b.bandwidth-a.bandwidth);
    const audios=tracks.filter(x=>x.type==='audio').sort((a,b)=>b.bandwidth-a.bandwidth);
    if(!videos.length||!audios.length)reject('전체 MP4 영상과 AAC 음성 트랙을 모두 확인하지 못했습니다. 무음 파일로 대신 저장하지 않습니다.');
    return {video:videos[0],audio:audios[0],expectedDuration};
  }
  function collect(token){
    const v=token?[...document.querySelectorAll('video,img')].find(x=>x.getAttribute('data-vs-x-target')===token):mainDownloadTarget();
    const fail=reason=>({items:[],hasVideo:!!v,reason});
    if(!v?.isConnected)return fail('선택한 영상이 사라졌습니다. 해당 영상의 버튼을 다시 눌러 주세요.');
    if(v instanceof HTMLImageElement)return collectPhoto(v,token);
    if(v.mediaKeys)return fail('보호된 영상은 다운로드할 수 없습니다.');
    try{
      const bound=boundManifest(v),{video,audio,expectedDuration}=parseTracks(bound.xml);
      if(Number.isFinite(v.duration)&&Math.abs(v.duration-expectedDuration)>Math.max(0.5,expectedDuration*0.01))return fail('선택한 영상과 DASH 길이가 일치하지 않습니다. 재생이 안정된 뒤 다시 눌러 주세요.');
      const title=bound.id?'Instagram '+bound.id:'Instagram 영상';
      const item={kind:'instagram-dash',url:video.url,audioUrl:audio.url,expectedDuration,height:video.height,width:video.width,bandwidth:video.bandwidth,title,filename:title+'.mp4',label:'Instagram '+video.width+'×'+video.height+' · 영상+음성',videoCodec:video.codec,audioCodec:audio.codec,origins:[...new Set([video.url,audio.url].map(s=>new URL(s).origin+'/*'))]};
      return {items:[item],hasVideo:true,reason:'',context:context(v)};
    }catch(error){return fail(error instanceof Error?error.message:'선택한 영상 정보를 확인하지 못했습니다.');}
  }
  const onPointerDown=e=>{const target=e.target;if(!(target instanceof Element))return;for(const media of document.querySelectorAll('img,video')){if((target===media||media.parentElement?.contains(target))&&visibleMedia(media)&&(media instanceof HTMLVideoElement||storyId()||isPostPhoto(media))){downloadChosen=media;break;}}for(const v of document.querySelectorAll('video')){const box=v.parentElement;if(box&&(box===target||box.contains(target))){chosen=v;break;}}};
  document.addEventListener('pointerdown',onPointerDown,true);
  const dispose=()=>{document.removeEventListener('pointerdown',onPointerDown,true);chosen=null;downloadChosen=null;};
  globalThis.__videoShortcutX={version,mainVideo,mainDownloadTarget,context,collect,dispose};
})();
