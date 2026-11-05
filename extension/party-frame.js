(() => {
  'use strict';

  const VERSION = '1.0.0';
  const TARGET_HOST = 'api.ydydapi.com';
  const TARGET_PATH = /^\/v1\/Yl\/player\/\d+/;
  const previous = globalThis.__videoShortcutPartyFrame;
  if (previous?.version === VERSION) return;
  try { previous?.dispose?.(); } catch (_) {}

  if (location.hostname !== TARGET_HOST || !TARGET_PATH.test(location.pathname)) return;
  let inFrame = false;
  try { inFrame = window.top !== window; } catch (_) {}
  if (!inFrame) return;

  let disposed = false;
  let enabled = false;
  let reporting = false;
  let reportTimer = null;

  const runtimeAvailable = () => {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  };

  const mainVideo = () => {
    let best = null;
    try {
      for (const video of document.querySelectorAll('video')) {
        const rect = video.getBoundingClientRect();
        if (rect.width < 160 || rect.height < 90) continue;
        const style = getComputedStyle(video);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const area = rect.width * rect.height;
        if (!best || area > best.area) best = { video, rect, area };
      }
    } catch (_) {}
    return best;
  };

  const report = () => {
    if (disposed || reporting) return;
    if (!runtimeAvailable()) { dispose(); return; }
    const candidate = mainVideo();
    if (!candidate) return;
    reporting = true;
    const { video, rect } = candidate;
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const player = {
      url: location.href,
      duration,
      width: rect.width,
      height: rect.height,
      ready: video.readyState,
      protected: !!video.mediaKeys
    };
    Promise.resolve(chrome.runtime.sendMessage({
      target: 'background',
      type: 'registerFramePlayer',
      player
    })).then(response => {
      if (!disposed && response?.ok === true && typeof response.enabled === 'boolean') enabled = response.enabled;
    }).catch(() => {}).finally(() => { reporting = false; });
  };

  const typingTarget = () => {
    const active = document.activeElement;
    if (!(active instanceof Element)) return false;
    return active.matches('input, textarea, [contenteditable]:not([contenteditable="false"])') || active.isContentEditable;
  };

  const keyMap = {
    Space: { key: ' ', code: 'Space', accepted: [' '] },
    KeyK: { key: 'k', code: 'KeyK', accepted: ['k', 'K'] },
    KeyJ: { key: 'j', code: 'KeyJ', accepted: ['j', 'J'] },
    KeyL: { key: 'l', code: 'KeyL', accepted: ['l', 'L'] },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', accepted: ['ArrowLeft'] },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', accepted: ['ArrowRight'] },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', accepted: ['ArrowUp'] },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', accepted: ['ArrowDown'] },
    KeyM: { key: 'm', code: 'KeyM', accepted: ['m', 'M'] },
    KeyF: { key: 'f', code: 'KeyF', accepted: ['f', 'F'] },
    KeyT: { key: 't', code: 'KeyT', accepted: ['t', 'T'] }
  };

  const onMessage = (message, sender, respond) => {
    if (message?.type !== 'frameKey') return;
    if (sender?.id && sender.id !== chrome.runtime.id) return;
    const candidate = mainVideo();
    respond({ ok: true, found: !!candidate });
    if (disposed || !enabled || !candidate || typingTarget()) return;

    const entry = keyMap[message.code];
    if (!entry || typeof message.key !== 'string' || !entry.accepted.includes(message.key)) return;
    if (typeof message.ctrlKey !== 'boolean' || typeof message.shiftKey !== 'boolean') return;
    const horizontal = entry.code === 'ArrowLeft' || entry.code === 'ArrowRight';
    if (!horizontal && (message.ctrlKey || message.shiftKey)) return;

    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: entry.key,
        code: entry.code,
        ctrlKey: message.ctrlKey,
        shiftKey: message.shiftKey,
        repeat: message.repeat === true,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}
  };

  const onSitesChanged = (changes, areaName) => {
    if (areaName === 'local' && changes.sites) report();
  };

  const onDomReady = () => report();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (reportTimer !== null) clearInterval(reportTimer);
    document.removeEventListener('DOMContentLoaded', onDomReady);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) {}
    try { chrome.storage.onChanged.removeListener(onSitesChanged); } catch (_) {}
  }

  globalThis.__videoShortcutPartyFrame = { version: VERSION, dispose };
  try { chrome.runtime.onMessage.addListener(onMessage); } catch (_) { dispose(); return; }
  try { chrome.storage.onChanged.addListener(onSitesChanged); } catch (_) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  else report();
  reportTimer = setInterval(() => {
    if (!runtimeAvailable()) { dispose(); return; }
    report();
  }, 1800);
})();
