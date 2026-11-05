/* Read the selected YouTube player; never scrape cookies or signed media URLs. */
(() => {
  'use strict';
  function videoId(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)) return null;
      const id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? id : null;
    } catch (_) { return null; }
  }
  function collect(token) {
    const id = videoId(location.href);
    const fail = reason => ({items:[], reason});
    if (!id) return fail('유튜브 영상이나 Shorts 페이지에서 사용해 주세요.');
    const videos = [...document.querySelectorAll('video')];
    const matches = token ? videos.filter(v => v.getAttribute('data-vs-x-target') === token) : videos.filter(v => {const r=v.getBoundingClientRect();return r.width>0&&r.height>0;});
    if (matches.length !== 1) return fail('선택한 유튜브 플레이어를 확인할 수 없습니다.');
    const video = matches[0], player = video.closest('.html5-video-player');
    if (!player || player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) return fail('광고 재생이 끝난 뒤 다시 눌러 주세요.');
    if (video.mediaKeys) return fail('보호된 영상은 다운로드할 수 없습니다.');
    const response = player.getPlayerResponse?.();
    if (!response || response.videoDetails?.videoId !== id) return fail('유튜브 영상이 전환 중입니다. 재생 후 다시 눌러 주세요.');
    if (response.playabilityStatus?.status !== 'OK') return fail('재생할 수 없는 유튜브 영상입니다.');
    if (response.videoDetails?.isLive || response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow || !Number.isFinite(video.duration)) return fail('진행 중인 라이브는 지원하지 않습니다.');
    return {items:[{kind:'youtube-native', url:'https://www.youtube.com/watch?v='+id,
      title:String(response.videoDetails?.title || document.title).slice(0,500),
      label:'YouTube 최고 품질 · 영상 MKV / 음원 M4A', mediaType:'video'}], hasVideo:true, reason:''};
  }
  globalThis.riumYouTube = {collect, videoId};
})();
