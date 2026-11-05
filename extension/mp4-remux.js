'use strict';
async function videoShortcutMP4(parts, options = {}) {
 if (!globalThis.muxjs?.mp4?.Transmuxer) throw new Error('MP4 저장 모듈을 불러오지 못했습니다.');
 const muxer = new muxjs.mp4.Transmuxer({remux:true,keepOriginalTimestamps:false});
 const output = []; let hasInit = false, dataCount = 0, muxError = null;
 muxer.on('error', e => { muxError = e instanceof Error ? e : new Error('영상 컨테이너 변환 중 오류가 발생했습니다.'); });
 muxer.on('data', segment => {
  if (!segment.data?.byteLength) return;
  if (!hasInit) { if (!segment.initSegment?.byteLength) { muxError = new Error('MP4 초기화 정보가 없습니다.'); return; } output.push(new Uint8Array(segment.initSegment)); hasInit = true; }
  output.push(new Uint8Array(segment.data)); dataCount++;
 });
 try {
  for (let i=0;i<parts.length;i++) {
   if (options.signal?.aborted) throw new DOMException('취소됨','AbortError');
   const bytes = parts[i]; if (!bytes?.byteLength) throw new Error('영상 조각이 누락됐습니다.');
   muxer.push(bytes); muxer.flush();
   if (muxError) throw muxError;
   if (options.releaseInput) parts[i] = null;
   options.onProgress?.(i+1,parts.length);
   if (i%8===0) await new Promise(r=>setTimeout(r,0));
  }
  if (!hasInit || !dataCount) throw new Error('이 영상의 코덱은 MP4 저장을 지원하지 않습니다.');
  return new Blob(output,{type:'video/mp4'});
 } finally { muxer.dispose?.(); }
}
