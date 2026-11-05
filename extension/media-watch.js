(() => {
  'use strict';
  const VERSION = '3.0.0';
  const old = globalThis.__videoShortcutStreamWatch;
  if (old?.version === VERSION && !old.disposed) return;
  try { old?.dispose?.(); } catch (_) {}
  // Keep the original array identity for legacy popup consumers. Never hook fetch/XHR.
  const legacy = Array.isArray(globalThis.__videoShortcutStreams) ? globalThis.__videoShortcutStreams : [];
  globalThis.__videoShortcutStreams = legacy;
  const records = [];
  let observer = null, disposed = false;
  function classify(raw) {
    try {
      const u = new URL(raw, location.href);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
      const test = value => /\.m3u8(?:$|[?#&])/i.test(value) ? 'hls' : /\.mpd(?:$|[?#&])/i.test(value) ? 'dash' : null;
      let kind = test(u.pathname);
      for (const value of u.searchParams.values()) kind ||= test(value);
      return kind ? {url:u.href, kind} : null;
    } catch (_) { return null; }
  }
  function add(raw, startTime = 0) {
    if (disposed) return;
    const entry = classify(raw);
    if (!entry) return;
    const index = records.findIndex(x => x.url === entry.url);
    if (index >= 0) records.splice(index, 1);
    records.push({...entry, startTime:Number(startTime) || 0});
    if (records.length > 80) records.splice(0, records.length - 80);
    if (entry.kind === 'hls') {
      for (let i=legacy.length-1; i>=0; i--) if (legacy[i] === entry.url) legacy.splice(i, 1);
      legacy.push(entry.url);
      if (legacy.length > 40) legacy.splice(0, legacy.length - 40);
    }
  }
  const seeds = legacy.filter(x => typeof x === 'string');
  legacy.length = 0;
  for (const url of seeds) add(url);
  try { for (const e of performance.getEntriesByType('resource')) add(e.name, e.startTime); } catch (_) {}
  try {
    observer = new PerformanceObserver(list => { for (const e of list.getEntries()) add(e.name, e.startTime); });
    observer.observe({type:'resource', buffered:true});
  } catch (_) { try { observer?.disconnect(); } catch (_) {} observer = null; }
  const api = {version:VERSION, get disposed() {return disposed;},
    get entries() {return records.map(x => ({...x}));},
    dispose() {disposed = true; try {observer?.disconnect();} catch (_) {} observer = null;}
  };
  globalThis.__videoShortcutStreamWatch = api;
})();
