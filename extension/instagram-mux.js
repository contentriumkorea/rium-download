/* Pure ISO BMFF track muxer. No dependencies, decoding, or network access.
 * videoShortcutInstagramMux(videoBytes, audioBytes, options) -> Promise<Blob>
 * Supports complete, self-contained VP9/H.264/AV1 + AAC MP4, including
 * contiguous single-track fMP4 with tfdt, trex/tfhd defaults and AAC roll groups.
 * Rejects encrypted, incomplete, discontinuous and unsupported fragment layouts.
 * options: signal, maxInputBytes (256 MiB), maxMemoryBytes (1 GiB),
 * maxDurationDifferenceSeconds (2), expectedDurationSeconds (alias expectedDuration),
 * durationToleranceSeconds (2). Video sample entries: vp09, avc1, avc3, av01.
 * AAC sample entry mp4a; MPEG-4 AAC object types 2, 5, 29.
 * Default allocation budget limits combined input to about 85 MiB even though
 * maxInputBytes defaults to 256 MiB. Raising limits is bounded at 1/4 GiB.
 * Memory limit is a conservative allocation budget, not a browser heap guarantee.
 * Input views must not be mutated while this operation is running.
 */
(() => {
  'use strict';
  const MiB = 1048576;
  const fail = text => { throw new Error('Instagram MP4 합치기: ' + text); };
  const u32 = (a, p) => new DataView(a.buffer, a.byteOffset, a.byteLength).getUint32(p);
  const put32 = (a, p, n) => new DataView(a.buffer, a.byteOffset, a.byteLength).setUint32(p, n);
  const uint64 = (a, p) => {
    const n = u32(a, p) * 4294967296 + u32(a, p + 4);
    if (!Number.isSafeInteger(n)) fail('64비트 값이 안전한 정수 범위를 초과합니다.');
    return n;
  };
  const put64 = (a, p, n) => { put32(a, p, Math.floor(n / 4294967296)); put32(a, p + 4, n % 4294967296); };
  const typeAt = (a, p) => String.fromCharCode(...a.subarray(p, p + 4));
  function boxes(a, start = 0, end = a.length) {
    const out = [];
    for (let p = start; p < end;) {
      if (end - p < 8) fail('잘린 MP4 박스 헤더입니다.');
      let size = u32(a, p), head = 8;
      const type = typeAt(a, p + 4);
      if (size === 1) { if (end - p < 16) fail('잘린 확장 박스 헤더입니다.'); size = uint64(a, p + 8); head = 16; }
      else if (size === 0) size = end - p;
      if (size < head || size > end - p) fail('MP4 박스 크기가 잘못되었습니다: ' + type);
      out.push({ a, start: p, end: p + size, data: p + head, type });
      if (out.length > 100000) fail('박스 개수 제한을 초과합니다.');
      p += size;
    }
    return out;
  }
  const children = b => boxes(b.a, b.data, b.end);
  const raw = b => b.a.subarray(b.start, b.end);
  function one(list, type, optional = false) {
    const found = list.filter(b => b.type === type);
    if (found.length !== 1 && !(optional && !found.length)) fail(type + ' 박스가 누락되거나 중복되었습니다.');
    return found[0];
  }
  function only(list, allowed, context) {
    for (const b of list) if (!allowed.includes(b.type)) fail(context + '의 지원하지 않는 박스입니다: ' + b.type);
  }
  function need(b, n) { if (b.end - b.data < n) fail('잘린 ' + b.type + ' 박스입니다.'); }
  function full(b, versions = [0]) {
    need(b, 4);
    if (!versions.includes(b.a[b.data])) fail(b.type + ' 버전을 지원하지 않습니다.');
  }
  function table(b, stride, prefix = 8) {
    full(b); need(b, prefix);
    const count = u32(b.a, b.data + 4);
    if (b.end - b.data !== prefix + count * stride) fail(b.type + ' 테이블 길이가 잘못되었습니다.');
    return count;
  }
  function pack(type, parts) {
    const size = 8 + parts.reduce((n, a) => n + a.length, 0);
    if (size > 0xffffffff) fail('메타데이터 박스가 너무 큽니다.');
    const a = new Uint8Array(size); put32(a, 0, size);
    for (let i = 0; i < 4; i++) a[4 + i] = type.charCodeAt(i);
    let p = 8; for (const v of parts) { a.set(v, p); p += v.length; }
    return a;
  }
  function clock(b, track = false, allowZero = false) {
    full(b, [0, 1]);
    const v = b.a[b.data], scalePos = b.data + (v ? 20 : 12);
    const durationPos = b.data + (track ? (v ? 28 : 20) : (v ? 24 : 16));
    need(b, track ? (v ? 96 : 84) : b.type === 'mvhd' ? (v ? 112 : 100) : (v ? 36 : 24));
    const scale = track ? null : u32(b.a, scalePos);
    let duration = v ? uint64(b.a, durationPos) : u32(b.a, durationPos);
    if (allowZero && duration === 0xffffffff) duration = 0;
    if (!track && !scale) fail('시간 기준값이 0입니다.');
    if ((!duration && !allowZero) || duration === 0xffffffff) fail('재생 시간이 없거나 확정되지 않았습니다.');
    return { v, scale, duration, durationPos, idPos: b.data + (v ? 20 : 12) };
  }
  function durationCopy(b, c, duration, id) {
    const a = raw(b).slice();
    if (!Number.isSafeInteger(duration) || duration < 1 || (!c.v && duration >= 0xffffffff)) fail('재생 시간 필드가 범위를 초과합니다.');
    if (c.v) put64(a, c.durationPos - b.start, duration); else put32(a, c.durationPos - b.start, duration);
    if (id !== undefined) put32(a, c.idPos - b.start, id);
    return a;
  }
  function aacEsds(b) {
    full(b);
    function descriptor(p, end, wanted) {
      if (p >= end || b.a[p++] !== wanted) fail('AAC 코덱 설명자가 올바르지 않습니다.');
      let len = 0, done = false;
      for (let k = 0; k < 4; k++) { if (p >= end) fail('잘린 AAC 설명자입니다.'); const x = b.a[p++]; len = len * 128 + (x & 127); if (!(x & 128)) { done = true; break; } }
      if (!done || len > end - p) fail('AAC 설명자 길이가 잘못되었습니다.');
      return { p, end: p + len };
    }
    const es = descriptor(b.data + 4, b.end, 3);
    let p = es.p; if (es.end - p < 3) fail('잘린 ES 설명자입니다.');
    const flags = b.a[p + 2]; p += 3;
    if (flags & 128) p += 2;
    if (flags & 64) { if (p >= es.end) fail('잘린 ES URL입니다.'); p += 1 + b.a[p]; }
    if (flags & 32) p += 2;
    const dc = descriptor(p, es.end, 4);
    if (dc.end - dc.p < 13 || b.a[dc.p] !== 0x40 || (b.a[dc.p + 1] >> 2) !== 5) fail('AAC MPEG-4 오디오만 지원합니다.');
    const asc = descriptor(dc.p + 13, dc.end, 5);
    if (asc.end - asc.p < 2) fail('AAC AudioSpecificConfig가 없습니다.');
    const objectType = b.a[asc.p] >> 3;
    if (![2, 5, 29].includes(objectType)) fail('AAC LC/HE 프로필만 지원합니다.');
  }

  // Flatten a complete single-track fragmented MP4 without touching media bytes.
  // Original byte positions remain valid: old metadata becomes free space and the
  // replacement moov is appended. The normal mux pass then copies only mdats.
  function flattenFragments(a, check) {
    const top = boxes(a), moov = one(top, 'moov'), mc = children(moov);
    if (!top.some(b => b.type === 'moof') && !mc.some(b => b.type === 'mvex')) return a;
    if (mc.some(b => b.type === 'pssh')) fail('암호화/보호된 분할 MP4는 지원하지 않습니다.');
    only(top, ['ftyp','moov','moof','mdat','sidx','mfra','free','skip','wide'], '분할 파일');
    one(top, 'ftyp');
    const trak = one(mc,'trak'), tc = children(trak), mdia = one(tc,'mdia'), dc = children(mdia);
    const minf = one(dc,'minf'), ic = children(minf), stbl = one(ic,'stbl'), sc = children(stbl);
    only(sc,['stsd','stts','stsc','stsz','stco','co64','sgpd'], '분할 초기 샘플 테이블');
    for (const b of sc) {
      if (['stts','stsc','stco','co64'].includes(b.type) && table(b,b.type === 'stsc' ? 12 : b.type === 'stts' || b.type === 'co64' ? 8 : 4)) fail('초기 샘플과 분할 샘플의 혼합은 지원하지 않습니다.');
      if (b.type === 'stsz') { full(b); need(b,12); if (u32(a,b.data+8) || b.end-b.data !== 12) fail('초기 분할 샘플 테이블이 비어 있지 않습니다.'); }
    }
    const mvhd=one(mc,'mvhd'), tkhd=one(tc,'tkhd'), mdhd=one(dc,'mdhd');
    const movie=clock(mvhd,false,true), track=clock(tkhd,true,true), media=clock(mdhd,false,true);
    const id=u32(a,track.idPos), mvex=one(mc,'mvex'), xc=children(mvex);
    only(xc,['trex','mehd'],'분할 기본값'); const trex=one(xc,'trex'); full(trex); need(trex,24);
    if (trex.end-trex.data !== 24 || u32(a,trex.data+4)!==id) fail('분할 트랙 ID가 일치하지 않습니다.');
    const defaults=[8,12,16,20].map(p=>u32(a,trex.data+p));
    const mdats=top.filter(b=>b.type==='mdat'), samples=[], groupRuns=[];
    let ticks=0, previousEnd=-1, sequence=-1, hasGroups=false;
    const signed=(x)=>x > 0x7fffffff ? x-4294967296 : x;
    for (const moof of top.filter(b=>b.type==='moof')) {
      check(); const fc=children(moof); only(fc,['mfhd','traf'],'분할 헤더');
      const mfhd=one(fc,'mfhd'); full(mfhd); need(mfhd,8); const seq=u32(a,mfhd.data+4);
      if (seq<=sequence) fail('분할 순서가 중복되거나 역순입니다.'); sequence=seq;
      const traf=one(fc,'traf'), rc=children(traf); only(rc,['tfhd','tfdt','trun','sbgp'],'분할 트랙 (암호화/추가 메타데이터 미지원)');
      const tfhd=one(rc,'tfhd'); full(tfhd); need(tfhd,8); const flags=u32(a,tfhd.data)&0xffffff;
      if ((flags & ~0x02003b) || u32(a,tfhd.data+4)!==id) fail('지원하지 않는 tfhd 플래그/트랙입니다.');
      let p=tfhd.data+8; const read=()=>{if(p+4>tfhd.end) fail('잘린 tfhd입니다.');const n=u32(a,p);p+=4;return n;};
      let base=moof.start;
      if(flags&1){ if(p+8>tfhd.end)fail('잘린 tfhd 위치입니다.');base=uint64(a,p);p+=8; }
      else if(!(flags&0x020000)) fail('암시적 분할 기준 위치는 지원하지 않습니다.');
      const desc=flags&2?read():defaults[0], duration=flags&8?read():defaults[1], size=flags&16?read():defaults[2], sampleFlags=flags&32?read():defaults[3];
      if(p!==tfhd.end || desc!==1)fail('분할 샘플 설명이 잘못되었습니다.');
      const tfdt=one(rc,'tfdt');full(tfdt,[0,1]);need(tfdt,a[tfdt.data]?12:8);
      const decode=a[tfdt.data]?uint64(a,tfdt.data+4):u32(a,tfdt.data+4);
      if(decode!==ticks)fail('분할 타임라인에 누락, 겹침 또는 시작 지연이 있습니다.');
      const startCount=samples.length; let cursor=null;
      const runs=rc.filter(b=>b.type==='trun'); if(!runs.length)fail('분할 샘플이 없습니다.');
      for(const run of runs){
        full(run,[0,1]);need(run,8);const f=u32(a,run.data)&0xffffff,n=u32(a,run.data+4);
        if((f&~0xf05)||((f&4)&&(f&0x400))||!n||samples.length+n>1000000||samples.length+n>a.length/4)fail('분할 샘플 플래그/개수 제한을 초과합니다.');
        let q=run.data+8;const get=()=>{if(q+4>run.end)fail('잘린 trun입니다.');const v=u32(a,q);q+=4;return v;};
        if(f&1)cursor=base+signed(get());else if(cursor===null)cursor=base;
        const first=f&4?get():sampleFlags;
        for(let j=0;j<n;j++){
          if((j&4095)===0)check();
          const d=f&0x100?get():duration,sz=f&0x200?get():size,sf=f&0x400?get():j===0?first:sampleFlags;
          let c=f&0x800?get():0;if(a[run.data])c=signed(c);
          if(!d||!sz||!Number.isSafeInteger(cursor)||cursor<previousEnd||!mdats.some(m=>cursor>=m.data&&cursor+sz<=m.end))fail('분할 샘플 시간/mdat 범위가 잘못되었습니다.');
          samples.push([d,sz,c,sf,cursor]);ticks+=d;previousEnd=cursor+sz;cursor+=sz;
          if(!Number.isSafeInteger(ticks))fail('분할 재생 시간 범위 초과입니다.');
        }
        if(q!==run.end)fail('trun 길이가 일치하지 않습니다.');
      }
      const group=one(rc,'sbgp',true), count=samples.length-startCount;
      if(group){full(group);need(group,12);if(typeAt(a,group.data+4)!=='roll')fail('분할 AAC roll 그룹만 지원합니다.');const n=u32(a,group.data+8);if(group.end-group.data!==12+8*n)fail('분할 그룹 길이가 잘못되었습니다.');let total=0;for(let i=0;i<n;i++){const q=group.data+12+i*8,c=u32(a,q),g=u32(a,q+4);if(!c||g>=65536)fail('분할 로컬 샘플 그룹은 지원하지 않습니다.');total+=c;groupRuns.push([c,g]);}if(total!==count)fail('분할 그룹 샘플 수가 다릅니다.');hasGroups=true;}
      else groupRuns.push([count,0]);
    }
    if(!samples.length)fail('완전한 분할 미디어가 없습니다.');
    const makeTable=(type,rows,width,version=0)=>{const b=new Uint8Array(8+rows.length*width*4);b[0]=version;put32(b,4,rows.length);let p=8;for(const row of rows)for(const v of row){put32(b,p,v);p+=4;}return pack(type,[b]);};
    const rle=index=>{const rows=[];for(const s of samples){const last=rows[rows.length-1];if(last&&last[1]===s[index])last[0]++;else rows.push([1,s[index]]);}return rows;};
    const sz=new Uint8Array(12+samples.length*4);put32(sz,8,samples.length);
    const co=new Uint8Array(8+samples.length*8);put32(co,4,samples.length);
    const dep=new Uint8Array(4+samples.length), sync=[];
    samples.forEach((s,i)=>{put32(sz,12+i*4,s[1]);put64(co,8+i*8,s[4]);dep[4+i]=(s[3]>>>20)&255;if(!(s[3]&0x10000))sync.push([i+1]);});
    const parts=[raw(one(sc,'stsd')),makeTable('stts',rle(0),2),makeTable('stsc',[[1,1,1]],3),pack('stsz',[sz]),pack('co64',[co]),makeTable('stss',sync,1),pack('sdtp',[dep])];
    if(samples.some(s=>s[2])){const negative=samples.some(s=>s[2]<0);if(negative&&samples.some(s=>s[2]>0x7fffffff))fail('합성 시간 범위 초과입니다.');parts.push(makeTable('ctts',rle(2),2,negative?1:0));}
    const sgpd=one(sc,'sgpd',true);
    if(hasGroups&&!sgpd)fail('분할 샘플 그룹 설명이 없습니다.');
    if(sgpd){const b=new Uint8Array(12+groupRuns.length*8);b.set([114,111,108,108],4);put32(b,8,groupRuns.length);groupRuns.forEach((r,i)=>{put32(b,12+i*8,r[0]);put32(b,16+i*8,r[1]);});parts.push(raw(sgpd),pack('sbgp',[b]));}
    let duration=Math.round(ticks*movie.scale/media.scale), edit;
    const edts=one(tc,'edts',true);
    if(edts){const ec=children(edts);only(ec,['elst'],'분할 편집');const elst=one(ec,'elst');full(elst,[0,1]);need(elst,8);const v=a[elst.data],w=v?20:12;if(u32(a,elst.data+4)!==1||elst.end-elst.data!==8+w)fail('분할 MP4는 단일 편집만 지원합니다.');const p=elst.data+8,q=p+(v?8:4),time=v?uint64(a,q):u32(a,q);if(time>=ticks||u32(a,p+w-4)!==65536)fail('분할 편집 시간/속도가 잘못되었습니다.');const old=v?uint64(a,p):u32(a,p);duration=old||Math.round((ticks-time)*movie.scale/media.scale);if(duration<1||(!v&&duration>=0xffffffff))fail('분할 편집 시간 범위 초과입니다.');const b=raw(elst).slice();if(v)put64(b,p-elst.start,duration);else put32(b,p-elst.start,duration);edit=pack('edts',[b]);}
    const newMinf=pack('minf',ic.map(b=>b===stbl?pack('stbl',parts):raw(b)));
    const newMdia=pack('mdia',dc.map(b=>b===minf?newMinf:b===mdhd?durationCopy(b,media,ticks):raw(b)));
    const newTrak=pack('trak',tc.map(b=>b===mdia?newMdia:b===tkhd?durationCopy(b,track,duration):b===edts?edit:raw(b)));
    const newMoov=pack('moov',[durationCopy(mvhd,movie,duration),newTrak]);
    const out=new Uint8Array(a.length+newMoov.length);out.set(a);out.set(newMoov,a.length);
    for(const b of top)if(!['ftyp','mdat'].includes(b.type))out.set([102,114,101,101],b.start+4);
    return out;
  }

  function inspect(a, kind, check) {
    const top = boxes(a);
    if (top.some(b => ['moof', 'mfra'].includes(b.type))) fail('분할 MP4(fMP4)는 아직 지원하지 않습니다. 완전한 비분할 MP4가 필요합니다.');
    const moov = one(top, 'moov'), mc = children(moov);
    if (mc.some(b => b.type === 'mvex')) fail('분할 MP4(mvex)는 아직 지원하지 않습니다. 완전한 비분할 MP4가 필요합니다.');
    if (mc.some(b => b.type === 'pssh')) fail('암호화/보호된 MP4는 지원하지 않습니다.');
    only(top, ['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'], '파일');
    one(top, 'ftyp');
    const mdats = top.filter(b => b.type === 'mdat');
    if (!mdats.length) fail('미디어 데이터가 없습니다.');
    const mvhd = one(mc, 'mvhd'), movie = clock(mvhd);
    const trak = one(mc, 'trak'), tc = children(trak);
    only(tc, ['tkhd', 'edts', 'mdia'], '트랙');
    const tkhd = one(tc, 'tkhd'), track = clock(tkhd, true);
    if (!(tkhd.a[tkhd.data + 3] & 1)) fail('비활성 트랙은 지원하지 않습니다.');
    const mdia = one(tc, 'mdia'), dc = children(mdia);
    only(dc, ['mdhd', 'hdlr', 'minf'], '미디어');
    const mdhd = one(dc, 'mdhd'), media = clock(mdhd), hdlr = one(dc, 'hdlr'); need(hdlr, 24);
    if (typeAt(a, hdlr.data + 8) !== (kind === 'video' ? 'vide' : 'soun')) fail('영상/음성 트랙 종류가 일치하지 않습니다.');
    const minf = one(dc, 'minf'), ic = children(minf);
    only(ic, ['vmhd', 'smhd', 'dinf', 'stbl'], '미디어 정보');
    one(ic, kind === 'video' ? 'vmhd' : 'smhd');
    const dinf = one(ic, 'dinf'), refs = children(dinf); only(refs, ['dref'], '데이터 참조');
    const dref = one(refs, 'dref'); full(dref); need(dref, 8);
    const urls = boxes(a, dref.data + 8, dref.end);
    if (u32(a, dref.data + 4) !== 1 || urls.length !== 1 || urls[0].type !== 'url ') fail('외부 미디어 참조는 지원하지 않습니다.');
    const url = urls[0]; full(url);
    if (url.end - url.data !== 4 || u32(a, url.data) !== 1) fail('외부 미디어 참조는 지원하지 않습니다.');
    const stbl = one(ic, 'stbl'), sc = children(stbl);
    if (sc.some(b => ['senc', 'saiz', 'saio'].includes(b.type))) fail('암호화/보호된 샘플은 지원하지 않습니다.');
    only(sc, ['stsd', 'stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'stss', 'sdtp', 'sgpd', 'sbgp'], '샘플 테이블');
    for (const t of new Set(sc.map(b => b.type))) one(sc, t);
    const stsd = one(sc, 'stsd'); full(stsd); need(stsd, 8);
    const entries = boxes(a, stsd.data + 8, stsd.end);
    if (u32(a, stsd.data + 4) !== 1 || entries.length !== 1) fail('단일 코덱 샘플 설명만 지원합니다.');
    const entry = entries[0];
    if (['encv', 'enca'].includes(entry.type)) fail('암호화/보호된 샘플 항목은 지원하지 않습니다.');
    if (!(kind === 'video' ? ['vp09', 'avc1', 'avc3', 'av01'] : ['mp4a']).includes(entry.type)) fail('VP9/H.264/AV1 영상과 AAC 음성 MP4만 지원합니다.');
    need(entry, kind === 'video' ? 78 : 28);
    if (a[entry.data + 6] !== 0 || a[entry.data + 7] !== 1) fail('잘못된 샘플 데이터 참조입니다.');
    if (kind === 'audio' && (a[entry.data + 8] || a[entry.data + 9])) fail('확장 QuickTime 오디오 항목은 지원하지 않습니다.');
    const ec = boxes(a, entry.data + (kind === 'video' ? 78 : 28), entry.end);
    if (ec.some(b => ['sinf', 'schm', 'tenc'].includes(b.type))) fail('암호화/보호된 샘플 항목은 지원하지 않습니다.');
    only(ec, kind === 'video' ? ['vpcC', 'avcC', 'av1C', 'pasp', 'colr', 'btrt', 'clap'] : ['esds', 'btrt'], '코덱 정보');
    if (kind === 'video') { const config = one(ec, entry.type === 'vp09' ? 'vpcC' : entry.type === 'av01' ? 'av1C' : 'avcC'); if (entry.type === 'vp09') { full(config, [1]); need(config, 12); } else { need(config, entry.type === 'av01' ? 4 : 7); } }
    else aacEsds(one(ec, 'esds'));
    const stsz = one(sc, 'stsz'); full(stsz); need(stsz, 12);
    const sampleSize = u32(a, stsz.data + 4), samples = u32(a, stsz.data + 8);
    if (!samples || stsz.end - stsz.data !== 12 + (sampleSize ? 0 : samples * 4)) fail('샘플 크기 테이블이 잘못되었습니다.');
    const sgpd = one(sc, 'sgpd', true), sbgp = one(sc, 'sbgp', true);
    if (sgpd || sbgp) {
      if (!sgpd || !sbgp) fail('샘플 그룹 쌍이 누락되었습니다.');
      full(sgpd, [1]); need(sgpd, 16); full(sbgp); need(sbgp, 12);
      if (typeAt(a, sgpd.data + 4) !== 'roll' || typeAt(a, sbgp.data + 4) !== 'roll' || u32(a, sgpd.data + 8) !== 2) fail('AAC roll 샘플 그룹만 지원합니다.');
      const groups = u32(a, sgpd.data + 12), entries = u32(a, sbgp.data + 8);
      if (sgpd.end - sgpd.data !== 16 + groups * 2 || sbgp.end - sbgp.data !== 12 + entries * 8) fail('샘플 그룹 길이가 잘못되었습니다.');
      let groupSamples = 0; for (let i = 0; i < entries; i++) { const p = sbgp.data + 12 + i * 8; groupSamples += u32(a, p); if (u32(a, p + 4) > groups) fail('샘플 그룹 인덱스가 잘못되었습니다.'); }
      if (groupSamples !== samples) fail('샘플 그룹 개수가 일치하지 않습니다.');
    }
    const stts = one(sc, 'stts'), times = table(stts, 8);
    let totalSamples = 0, ticks = 0;
    for (let i = 0; i < times; i++) { const p = stts.data + 8 + i * 8, n = u32(a, p), d = u32(a, p + 4); if (!n || !d) fail('샘플 재생 시간이 0입니다.'); totalSamples += n; ticks += n * d; }
    if (totalSamples !== samples || !Number.isSafeInteger(ticks) || ticks !== media.duration) fail('샘플 수/재생 시간과 mdhd 메타데이터가 일치하지 않습니다.');
    const ctts = one(sc, 'ctts', true);
    if (ctts) { full(ctts, [0, 1]); need(ctts, 8); const n = u32(a, ctts.data + 4); if (ctts.end - ctts.data !== 8 + n * 8) fail('ctts 길이가 잘못되었습니다.'); let count = 0; for (let i = 0; i < n; i++) count += u32(a, ctts.data + 8 + i * 8); if (count !== samples) fail('ctts 샘플 수가 잘못되었습니다.'); }
    const stss = one(sc, 'stss', true);
    if (stss) { const n = table(stss, 4); let prev = 0; for (let i = 0; i < n; i++) { const v = u32(a, stss.data + 8 + i * 4); if (v <= prev || v > samples) fail('키프레임 테이블이 잘못되었습니다.'); prev = v; } }
    const sdtp = one(sc, 'sdtp', true); if (sdtp) { full(sdtp); if (sdtp.end - sdtp.data !== samples + 4) fail('sdtp 길이가 잘못되었습니다.'); }
    const offsets = sc.filter(b => ['stco', 'co64'].includes(b.type));
    if (offsets.length !== 1) fail('청크 오프셋 테이블이 누락되거나 중복되었습니다.');
    const offsetBox = offsets[0], stride = offsetBox.type === 'co64' ? 8 : 4, chunks = table(offsetBox, stride);
    if (!chunks || chunks > samples) fail('청크 개수가 잘못되었습니다.');
    const stsc = one(sc, 'stsc'), runs = table(stsc, 12);
    if (!runs) fail('청크 매핑이 없습니다.');
    const runAt = i => stsc.data + 8 + i * 12;
    let previous = 0;
    for (let i = 0; i < runs; i++) { const p = runAt(i), first = u32(a, p); if (first <= previous || first > chunks || (!i && first !== 1) || !u32(a, p + 4) || u32(a, p + 8) !== 1) fail('청크 매핑이 잘못되었습니다.'); previous = first; }
    let run = 0, sample = 0, previousEnd = -1;
    // Require file-order chunks; avoids a large range-sort allocation and ambiguous overlapping samples.
    for (let i = 0; i < chunks; i++) {
      if ((i & 4095) === 0) check();
      if (run + 1 < runs && i + 1 >= u32(a, runAt(run + 1))) run++;
      const n = u32(a, runAt(run) + 4);
      if (n > samples - sample) fail('청크 샘플 수가 범위를 초과합니다.');
      let bytes = sampleSize * n;
      if (!sampleSize) for (let j = 0; j < n; j++) { const sz = u32(a, stsz.data + 12 + (sample + j) * 4); if (!sz) fail('빈 샘플은 지원하지 않습니다.'); bytes += sz; }
      const p = offsetBox.data + 8 + i * stride, off = stride === 8 ? uint64(a, p) : u32(a, p);
      if (off < previousEnd || !mdats.some(m => off >= m.data && off + bytes <= m.end)) fail('청크가 mdat 범위를 벗어나거나 겹칩니다.');
      previousEnd = off + bytes; sample += n;
    }
    if (sample !== samples) fail('청크와 샘플 수가 일치하지 않습니다.');
    const edts = one(tc, 'edts', true); let elst, editDuration = 0;
    if (edts) {
      const edc = children(edts); only(edc, ['elst'], '편집 목록'); elst = one(edc, 'elst'); full(elst, [0, 1]); need(elst, 8);
      const v = a[elst.data], n = u32(a, elst.data + 4), width = v ? 20 : 12;
      if (!n || n > 2 || elst.end - elst.data !== 8 + n * width) fail('복잡하거나 잘못된 편집 목록은 지원하지 않습니다.');
      for (let i = 0; i < n; i++) {
        const p = elst.data + 8 + i * width, duration = v ? uint64(a, p) : u32(a, p), q = p + (v ? 8 : 4);
        const empty = v ? u32(a, q) === 0xffffffff && u32(a, q + 4) === 0xffffffff : u32(a, q) === 0xffffffff;
        const time = empty ? -1 : v ? uint64(a, q) : u32(a, q);
        if (!duration || u32(a, p + width - 4) !== 65536 || (empty && (i !== 0 || n !== 2)) || (!empty && (time > media.duration || time + duration * media.scale / movie.scale > media.duration + media.scale * 0.1))) fail('편집 목록 시간/재생 속도를 지원하지 않습니다.');
        editDuration += duration;
      }
      if (Math.abs(editDuration - track.duration) > 1) fail('편집 목록과 트랙 재생 시간이 일치하지 않습니다.');
    } else if (Math.abs(track.duration / movie.scale - media.duration / media.scale) > 0.1) fail('트랙과 미디어 재생 시간이 일치하지 않습니다.');
    if (Math.abs(movie.duration - track.duration) > Math.max(1, movie.scale * 0.1)) fail('영화와 트랙 재생 시간이 일치하지 않습니다.');
    return { a, mdats, mvhd, movie, media, trak, tc, tkhd, track, mdia, dc, minf, ic, stbl, sc, offsetBox, stride, chunks, edts, elst, seconds: track.duration / movie.scale };
  }
  function buildTrack(t, scale, id, maps) {
    const newDuration = Math.round(t.track.duration * scale / t.movie.scale);
    const co = new Uint8Array(8 + t.chunks * 8); put32(co, 4, t.chunks);
    for (let i = 0; i < t.chunks; i++) {
      const p = t.offsetBox.data + 8 + i * t.stride, old = t.stride === 8 ? uint64(t.a, p) : u32(t.a, p);
      if (maps) { let lo=0,hi=maps.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(maps[mid].oldStart<=old)lo=mid+1;else hi=mid;}const m=maps[lo-1]; if (!m || old>=m.oldEnd) fail('청크 위치를 변환할 수 없습니다.'); put64(co, 8 + i * 8, m.newStart + old - m.oldStart); }
    }
    const stbl = pack('stbl', t.sc.map(b => b === t.offsetBox ? pack('co64', [co]) : raw(b)));
    const minf = pack('minf', t.ic.map(b => b === t.stbl ? stbl : raw(b)));
    const mdia = pack('mdia', t.dc.map(b => b === t.minf ? minf : raw(b)));
    let edts;
    if (t.elst) {
      const e = t.elst, a = raw(e).slice(), v = t.a[e.data], n = u32(t.a, e.data + 4), width = v ? 20 : 12;
      let cumulative = 0, written = 0;
      for (let i = 0; i < n; i++) { const p = e.data + 8 + i * width; cumulative += v ? uint64(t.a, p) : u32(t.a, p); const end = i === n - 1 ? newDuration : Math.round(cumulative * scale / t.movie.scale), d = end - written; if (d < 1 || (!v && d >= 0xffffffff)) fail('변환한 편집 시간이 범위를 초과합니다.'); if (v) put64(a, p - e.start, d); else put32(a, p - e.start, d); written = end; }
      edts = pack('edts', [a]);
    }
    return pack('trak', t.tc.map(b => b === t.tkhd ? durationCopy(b, t.track, newDuration, id) : b === t.mdia ? mdia : edts));
  }
  globalThis.videoShortcutInstagramMux = async function(videoBytes, audioBytes, options = {}) {
    const numberOption = (key, fallback, max = Number.MAX_SAFE_INTEGER) => { const n = options[key] ?? fallback; if (!Number.isFinite(n) || n < 0 || n > max) fail('잘못된 옵션: ' + key); return n; };
    const check = () => { if (options.signal?.aborted) throw new DOMException('합치기가 취소되었습니다.', 'AbortError'); };
    check();
    if (!(videoBytes instanceof Uint8Array) || !(audioBytes instanceof Uint8Array) || !videoBytes.length || !audioBytes.length) fail('영상/음성 Uint8Array가 필요합니다.');
    const total = videoBytes.length + audioBytes.length;
    const inputCap = numberOption('maxInputBytes', 256 * MiB, 1024 * MiB), memoryCap = numberOption('maxMemoryBytes', 1024 * MiB, 4096 * MiB);
    // Bound even adversarial metadata amplification (nested box copies + co64 expansion).
    if (total > inputCap || total * 12 + MiB > memoryCap) fail('메모리 안전 제한을 초과합니다. 더 짧은 영상을 사용하세요.');
    const video = inspect(flattenFragments(videoBytes, check), 'video', check), audio = inspect(flattenFragments(audioBytes, check), 'audio', check);
    const difference = numberOption('maxDurationDifferenceSeconds', 2, 30);
    if (Math.abs(video.seconds - audio.seconds) > difference) fail('영상과 음성의 재생 시간이 다릅니다. 서로 다른 영상의 트랙일 수 있습니다.');
    const tolerance = numberOption('durationToleranceSeconds', 2, 30);
    if (options.expectedDurationSeconds !== undefined || options.expectedDuration !== undefined) {
      const expected = options.expectedDurationSeconds !== undefined ? numberOption('expectedDurationSeconds', 0) : numberOption('expectedDuration', 0);
      if (!expected || [video, audio].some(t => Math.abs(t.seconds - expected) > tolerance)) fail('요청한 영상의 재생 시간과 트랙 메타데이터가 일치하지 않습니다.');
    }
    const scale = video.movie.scale;
    const mvhd = durationCopy(video.mvhd, video.movie, Math.max(Math.round(video.seconds * scale), Math.round(audio.seconds * scale)));
    put32(mvhd, mvhd.length - 4, 3);
    const ftyp = pack('ftyp', [new Uint8Array([105,115,111,109,0,0,2,0,105,115,111,109,105,115,111,54,109,112,52,49,118,112,48,57])]);
    let moov = pack('moov', [mvhd, buildTrack(video, scale, 1), buildTrack(audio, scale, 2)]);
    let position = ftyp.length + moov.length;
    const mediaParts = [], maps = [];
    for (const t of [video, audio]) {
      const map = [];
      for (const m of t.mdats) {
        const size = m.end - m.data + 8, header = new Uint8Array(8); put32(header, 0, size); header.set([109,100,97,116], 4);
        map.push({ oldStart: m.data, oldEnd: m.end, newStart: position + 8 });
        mediaParts.push(header, t.a.subarray(m.data, m.end)); position += size;
      }
      maps.push(map);
    }
    const finalMoov = pack('moov', [mvhd, buildTrack(video, scale, 1, maps[0]), buildTrack(audio, scale, 2, maps[1])]);
    if (finalMoov.length !== moov.length || position > inputCap + 16 * MiB) fail('출력 크기가 안전 제한을 초과합니다.');
    moov = null; check();
    return new Blob([ftyp, finalMoov, ...mediaParts], { type: 'video/mp4' });
  };

  /** Extract AAC without decoding. Only selected audio chunks are copied to output.
   * Complete progressive MP4 and contiguous single/multi-track fMP4 are accepted.
   * Fragmented implicit bases are accepted only for the first traf in each moof.
   * options: signal, maxInputBytes (80 MiB), maxMemoryBytes (1 GiB),
   * expectedDuration / expectedDurationSeconds, durationToleranceSeconds (2).
   */
  globalThis.videoShortcutExtractAudio = async function(bytes, options = {}) {
    const check = () => { if (options.signal?.aborted) throw new DOMException('음원 추출이 취소되었습니다.', 'AbortError'); };
    const limit = (name, fallback, maximum) => { const n=options[name]??fallback;if(!Number.isFinite(n)||n<0||n>maximum)fail('잘못된 옵션: '+name);return n; };
    check();
    if(!(bytes instanceof Uint8Array)||!bytes.length)fail('음원 추출에는 비어 있지 않은 Uint8Array가 필요합니다.');
    const cap=limit('maxInputBytes',80*MiB,1024*MiB),memory=limit('maxMemoryBytes',1024*MiB,4096*MiB);
    if(bytes.length>cap||bytes.length*12+MiB>memory)fail('음원 추출 메모리 안전 제한을 초과합니다.');
    const top=boxes(bytes),moov=one(top,'moov'),mc=children(moov);
    only(top,['ftyp','moov','moof','mdat','sidx','mfra','free','skip','wide'],'음원 원본');
    one(top,'ftyp');
    if(mc.some(b=>b.type==='pssh'))fail('보호된 MP4는 음원을 추출할 수 없습니다.');
    const audioTracks=mc.filter(b=>b.type==='trak').filter(b=>{const mdia=one(children(b),'mdia'),hdlr=one(children(mdia),'hdlr');need(hdlr,24);return typeAt(bytes,hdlr.data+8)==='soun';});
    if(audioTracks.length!==1)fail(audioTracks.length?'여러 음성 트랙 중 선택이 필요합니다.':'이 영상에는 음성 트랙이 없습니다.');
    const trak=audioTracks[0],tc=children(trak),tkhd=one(tc,'tkhd'),trackClock=clock(tkhd,true,true),id=u32(bytes,trackClock.idPos);
    const mvhd=one(mc,'mvhd'),movie=clock(mvhd,false,true),mvex=one(mc,'mvex',true);
    const fragments=top.filter(b=>b.type==='moof');
    let singleMoov;
    if(fragments.length||mvex){
      if(!mvex||!fragments.length)fail('완전한 분할 오디오 파일이 아닙니다.');
      const xc=children(mvex);only(xc,['trex','mehd'],'분할 기본값');
      const trex=xc.filter(b=>b.type==='trex'&&(need(b,24),u32(bytes,b.data+4)===id));
      if(trex.length!==1)fail('음성 트랙의 trex가 누락되거나 중복되었습니다.');
      singleMoov=pack('moov',[raw(mvhd),raw(trak),pack('mvex',[raw(trex[0])])]);
    }else{
      if(!trackClock.duration)fail('음성 재생 시간이 없습니다.');
      singleMoov=pack('moov',[durationCopy(mvhd,movie,trackClock.duration),raw(trak)]);
    }
    // Retain original source byte positions while removing unrelated metadata.
    // This temporary buffer may still contain video; none of it is emitted below.
    const isolated=new Uint8Array(bytes.length+singleMoov.length);isolated.set(bytes);isolated.set(singleMoov,bytes.length);
    const makeFree=b=>isolated.set([102,114,101,101],b.start+4);
    for(const b of top)if(!['ftyp','mdat','moof'].includes(b.type))makeFree(b);
    let initialDecode=null;
    for(const moof of fragments){
      check();const fc=children(moof);only(fc,['mfhd','traf'],'분할 헤더');
      const mfhd=one(fc,'mfhd'),trafs=fc.filter(b=>b.type==='traf');
      const chosen=trafs.filter(b=>{const h=one(children(b),'tfhd');full(h);need(h,8);return u32(bytes,h.data+4)===id;});
      if(chosen.length>1)fail('한 분할에 중복 음성 트랙이 있습니다.');
      if(!chosen.length){makeFree(moof);continue;}
      const target=chosen[0],rc=children(target),tfhd=one(rc,'tfhd'),flags=u32(bytes,tfhd.data)&0xffffff;
      let header=raw(tfhd);
      if(!(flags&1)&&!(flags&0x020000)){
        if(trafs[0]!==target)fail('뒤쪽 음성 traf의 암시적 위치는 안전하게 추출할 수 없습니다.');
        header=header.slice();put32(header,tfhd.data-tfhd.start, u32(bytes,tfhd.data)|0x020000);
      }
      const tfdt=one(rc,'tfdt');full(tfdt,[0,1]);need(tfdt,bytes[tfdt.data]?12:8);
      const decode=bytes[tfdt.data]?uint64(bytes,tfdt.data+4):u32(bytes,tfdt.data+4);if(initialDecode===null)initialDecode=decode;
      if(decode<initialDecode)fail('음원 분할 시간이 역순입니다.');
      const dt=raw(tfdt).slice();if(bytes[tfdt.data])put64(dt,tfdt.data-tfdt.start+4,decode-initialDecode);else put32(dt,tfdt.data-tfdt.start+4,decode-initialDecode);
      const replacement=pack('moof',[raw(mfhd),pack('traf',rc.map(b=>b===tfhd?header:b===tfdt?dt:raw(b)))]);
      const remaining=moof.end-moof.start-replacement.length;
      if(remaining<0||(remaining>0&&remaining<8))fail('분할 헤더를 안전하게 분리할 수 없습니다.');
      isolated.set(replacement,moof.start);
      if(remaining){put32(isolated,moof.start+replacement.length,remaining);isolated.set([102,114,101,101],moof.start+replacement.length+4);}
    }
    const audio=inspect(flattenFragments(isolated,check),'audio',check);
    const delay=Math.round((initialDecode||0)*audio.movie.scale/audio.media.scale);
    if(delay && audio.edts)fail('지연된 분할 음원의 기존 편집 목록은 지원하지 않습니다.');
    if(delay && (delay>=0xffffffff||audio.track.duration>=0xffffffff))fail('음원 편집 시간 범위를 초과합니다.');
    const expected=options.expectedDurationSeconds??options.expectedDuration;
    if(expected!==undefined){const tolerance=limit('durationToleranceSeconds',2,30);if(!Number.isFinite(expected)||expected<=0||Math.abs(audio.seconds+delay/audio.movie.scale-expected)>tolerance)fail('요청한 음원의 재생 시간과 파일이 다릅니다.');}
    // Derive every audio chunk length from stsc/stsz; never copy whole source mdat.
    const stsc=one(audio.sc,'stsc'),stsz=one(audio.sc,'stsz'),fixed=u32(audio.a,stsz.data+4),runs=table(stsc,12);
    const chunks=[];let run=0,sample=0,payloadSize=0;
    for(let i=0;i<audio.chunks;i++){
      if((i&4095)===0)check();
      if(run+1<runs&&i+1>=u32(audio.a,stsc.data+8+(run+1)*12))run++;
      const n=u32(audio.a,stsc.data+12+run*12);let size=fixed*n;
      if(!fixed)for(let j=0;j<n;j++)size+=u32(audio.a,stsz.data+12+(sample+j)*4);
      const p=audio.offsetBox.data+8+i*audio.stride,offset=audio.stride===8?uint64(audio.a,p):u32(audio.a,p);
      chunks.push({offset,size});sample+=n;payloadSize+=size;
    }
    if(!payloadSize||payloadSize>cap||payloadSize+8>0xffffffff)fail('음원 출력 크기가 잘못되었습니다.');
    const ftyp=pack('ftyp',[new Uint8Array([77,52,65,32,0,0,2,0,77,52,65,32,105,115,111,109,109,112,52,50])]);
    const outDuration=audio.track.duration+delay;
    const outMvhd=durationCopy(audio.mvhd,audio.movie,outDuration);put32(outMvhd,outMvhd.length-4,2);
    const audioTrack=maps=>{const t=buildTrack(audio,audio.movie.scale,1,maps);if(!delay)return t;
      const list=children(boxes(t)[0]),tk=one(list,'tkhd'),c=clock(tk,true);
      const el=new Uint8Array(32);put32(el,4,2);put32(el,8,delay);put32(el,12,0xffffffff);put32(el,16,65536);put32(el,20,audio.track.duration);put32(el,24,0);put32(el,28,65536);
      return pack('trak',[...list.map(b=>b===tk?durationCopy(b,c,outDuration):raw(b)),pack('edts',[pack('elst',[el])])]);};
    const placeholder=pack('moov',[outMvhd,audioTrack()]);
    let offset=ftyp.length+placeholder.length+8;
    const maps=chunks.map(c=>{const m={oldStart:c.offset,oldEnd:c.offset+c.size,newStart:offset};offset+=c.size;return m;});
    const outMoov=pack('moov',[outMvhd,audioTrack(maps)]);
    if(outMoov.length!==placeholder.length)fail('음원 메타데이터 크기가 일치하지 않습니다.');
    const mediaHeader=new Uint8Array(8);put32(mediaHeader,0,payloadSize+8);mediaHeader.set([109,100,97,116],4);
    const payload=new Uint8Array(payloadSize);let cursor=0;
    for(let i=0;i<chunks.length;i++){check();const c=chunks[i];payload.set(audio.a.subarray(c.offset,c.offset+c.size),cursor);cursor+=c.size;if((i&4095)===4095)await new Promise(r=>setTimeout(r,0));}
    check();return new Blob([ftyp,outMoov,mediaHeader,payload],{type:'audio/mp4'});
  };
})();
