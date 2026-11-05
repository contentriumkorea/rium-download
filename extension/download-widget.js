(() => {
  'use strict';

  const VERSION = '1.9.0';
  const previous = globalThis.__videoShortcutWidget;
  if (previous && typeof previous.dispose === 'function') {
    try { previous.dispose(); } catch (_) {}
  }
  document.getElementById('video-shortcut-download-widget')?.remove();

  const ext = typeof chrome === 'undefined' ? null : chrome;
  let disposed = false;
  const host = document.createElement('div');
  host.id = 'video-shortcut-download-widget';
  host.tabIndex = -1;
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fafafa';
  const shadow = host.attachShadow({ mode: 'open' });

  const css = document.createElement('style');
  css.textContent = `
    :host { all:initial; color-scheme:dark; } [hidden] { display:none!important; } *,*::before,*::after { box-sizing:border-box; }
    .panel { width:min(380px,var(--vs-w,380px)); max-height:min(560px,var(--vs-h,560px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(210,210,210,.48); border-radius:14px; background:#181818; box-shadow:0 14px 36px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.06) inset; color:#f4f4f4; font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .header { display:flex; align-items:center; gap:10px; min-height:50px; padding:10px 10px 10px 14px; border-bottom:1px solid rgba(220,220,220,.16); }
    .logo,.mini-logo { display:grid; place-items:center; flex:0 0 auto; background:#f5f5f5; color:#111; } .logo { width:26px; height:26px; border-radius:8px; }
    .logo::before,.mini-logo::before { content:''; width:0; height:0; margin-left:2px; border-top:6px solid transparent; border-bottom:6px solid transparent; border-left:9px solid currentColor; }
    .heading { min-width:0; flex:1; } .widget-title { color:#fff; font-size:14px; font-weight:720; letter-spacing:.01em; } .summary { overflow:hidden; color:#c8c8c8; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
    button { border:0; cursor:pointer; font:inherit; } button:focus-visible { outline:2px solid #fff; outline-offset:2px; } .icon { width:29px; height:29px; border-radius:8px; background:transparent; color:#d5d5d5; font-size:18px; line-height:1; } .icon:hover { background:rgba(255,255,255,.12); color:#fff; }
    .jobs { min-height:0; overflow:auto; overscroll-behavior:contain; padding:8px; scrollbar-color:#707070 #242424; } .job { padding:6px 8px; border:1px solid rgba(220,220,220,.18); border-radius:10px; background:#202020; } .job+.job { margin-top:6px; }
    .job-line { display:flex; align-items:center; gap:7px; min-width:0; } .job-title { min-width:0; flex:1 1 auto; overflow:hidden; color:#f8f8f8; font-size:13px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; } .status { flex:0 1 auto; max-width:92px; overflow:hidden; color:#c8c8c8; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
    .progress { position:relative; display:grid; flex:0 0 auto; width:31px; height:31px; place-items:center; border-radius:50%; background:conic-gradient(#e6e6e6 calc(var(--progress) * 1%),rgba(235,235,235,.18) 0); } .progress::before { position:absolute; inset:3px; border-radius:50%; background:#202020; content:''; } .value { position:relative; color:#e4e4e4; font-size:9px; font-variant-numeric:tabular-nums; line-height:1; } .is-error .progress,.is-cancelled .progress { background:conic-gradient(#979797 calc(var(--progress) * 1%),rgba(235,235,235,.18) 0); } .is-queued .progress,.is-cancelling .progress { background:conic-gradient(#b8b8b8 calc(var(--progress) * 1%),rgba(235,235,235,.18) 0); }
    .actions { display:flex; flex:0 0 auto; gap:4px; } .action { display:grid; width:27px; height:27px; padding:0; place-items:center; border:1px solid rgba(218,218,218,.42); border-radius:50%; background:rgba(255,255,255,.06); color:#f2f2f2; font-size:14px; line-height:1; } .action:hover { background:rgba(255,255,255,.16); } .primary { border-color:#e5e5e5; background:#e5e5e5; color:#171717; } .primary:hover { background:#fff; } .action:disabled { cursor:wait; opacity:.6; }
    .empty { padding:18px 12px; color:#bdbdbd; font-size:12px; text-align:center; } .mini { display:none; width:48px; height:48px; border:1px solid rgba(215,215,215,.62); border-radius:50%; background:#282828; box-shadow:0 10px 26px rgba(0,0,0,.42); color:#d6d6d6; } .mini:hover { background:#3a3a3a; } .mini-logo { width:28px; height:28px; border-radius:50%; } .mini-logo::before { border-top-width:5px; border-bottom-width:5px; border-left-width:8px; }
    :host([data-collapsed="true"]) .panel { display:none; } :host([data-collapsed="true"]) .mini { display:grid; place-items:center; }
    @media(max-width:420px) { .panel { width:min(calc(100vw - 20px),var(--vs-w,380px)); border-radius:12px; } .header { min-height:46px; } .jobs { padding:6px; } }
  `;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const panel = el('section', 'panel');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Rium Download 다운로드 대기열');
  const header = el('div', 'header');
  const logo = el('span', 'logo'); logo.setAttribute('aria-hidden', 'true');
  const heading = el('div', 'heading');
  const title = el('div', 'widget-title', 'Rium Download');
  const summary = el('div', 'summary'); summary.setAttribute('aria-live', 'polite');
  heading.append(title, summary);
  const fold = el('button', 'icon', '−'); fold.type = 'button'; fold.setAttribute('aria-label', '다운로드 대기열 접기'); fold.title = '작은 로고로 접기';
  const close = el('button', 'icon', '×'); close.type = 'button'; close.setAttribute('aria-label', '다운로드 대기열 닫기'); close.title = '대기열 UI만 닫고 다운로드는 계속합니다';
  header.append(logo, heading, fold, close);
  const list = el('div', 'jobs'); list.setAttribute('role', 'list');
  panel.append(header, list);
  const mini = el('button', 'mini'); mini.type = 'button'; mini.setAttribute('aria-label', '다운로드 대기열 열기');
  const miniLogo = el('span', 'mini-logo'); miniLogo.setAttribute('aria-hidden', 'true'); mini.append(miniLogo);
  shadow.append(css, panel, mini);
  document.documentElement.append(host);

  let zoom = 1, collapsed = false, closed = false, storageReady = false, gotInitial = false;
  let jobs = [];
  const dismissed = new Set();
  const text = value => value == null ? '' : String(value);
  const idOf = state => state && state.id != null ? String(state.id) : '';
  const phaseOf = phase => ['preparing','queued','running','complete','error','cancelled','cancelling'].includes(phase) ? phase : 'queued';
  const phaseLabel = phase => ({ preparing:'화질 확인 중', queued:'대기', running:'다운로드 중', complete:'완료', error:'오류', cancelled:'취소됨', cancelling:'취소 중' })[phase] || '대기';
  const setZoom = value => {
    const number = Number(value); if (Number.isFinite(number) && number > 0) zoom = number;
    host.style.transformOrigin = 'bottom right'; host.style.transform = `scale(${1 / zoom})`;
    host.style.right = `${18 / zoom}px`; host.style.bottom = `${18 / zoom}px`;
    host.style.setProperty('--vs-w', `${Math.max(180, innerWidth * zoom - 36)}px`);
    host.style.setProperty('--vs-h', `${Math.max(180, innerHeight * zoom - 36)}px`);
  };
  const onResize = () => setZoom(zoom); addEventListener('resize', onResize); setZoom(1);
  const setCollapsed = value => { collapsed = Boolean(value); host.dataset.collapsed = String(collapsed); };
  const shown = () => jobs.filter(job => { const id = idOf(job); return !id || !dismissed.has(id); });
  const saveDismissals = () => ext?.storage?.local?.set({ downloadWidgetDismissedIds:[...dismissed] }).catch(() => {});
  const request = (type, id) => new Promise(resolve => {
    if (!ext?.runtime?.sendMessage) return resolve({ ok:false, error:'확장 프로그램에 연결할 수 없습니다.' });
    try { ext.runtime.sendMessage({ target:'background', type, id }, response => { const error = ext.runtime.lastError; resolve(error ? { ok:false, error:error.message } : response); }); }
    catch (error) { resolve({ ok:false, error:error?.message || '요청을 처리하지 못했습니다.' }); }
  });
  const action = (actions, label, glyph, className, handler) => { const button = el('button', `action${className ? ` ${className}` : ''}`, glyph); button.type = 'button'; button.setAttribute('aria-label', label); button.title = label; button.addEventListener('click', handler); actions.append(button); };

  const jobView = state => {
    const phase = phaseOf(state.phase), id = idOf(state);
    const item = el('article', `job is-${phase}`); item.setAttribute('role', 'listitem');
    const line = el('div', 'job-line');
    const jobTitle = el('div', 'job-title', text(state.title) || '이름 없는 다운로드'); jobTitle.title = jobTitle.textContent;
    const statusText = phase==='preparing' && state.status==='권한 허용 필요' ? '권한 허용 필요' : phaseLabel(phase);
    const status = el('span', 'status', statusText);
    const statusDetail = [text(state.status), text(state.detail)].filter(Boolean).join(' · '); status.title = statusDetail || statusText;
    const supplied = Number(state.progress), progress = Number.isFinite(supplied) ? Math.max(0, Math.min(100, supplied)) : (phase === 'complete' ? 100 : 0);
    const progressNode = el('div', 'progress'); progressNode.style.setProperty('--progress', String(progress)); progressNode.setAttribute('role', 'progressbar'); progressNode.setAttribute('aria-label', `${jobTitle.textContent} 진행률`); progressNode.setAttribute('aria-valuemin', '0'); progressNode.setAttribute('aria-valuemax', '100'); progressNode.setAttribute('aria-valuenow', String(Math.round(progress))); progressNode.setAttribute('aria-valuetext', `${Math.round(progress)}%`); progressNode.append(el('span', 'value', `${Math.round(progress)}%`));
    const actions = el('div', 'actions');
    const canCancel = id && state.canCancel !== false && state.cancellable !== false;
    if (['preparing','queued','running'].includes(phase) && canCancel) action(actions, '다운로드 취소', '×', '', async event => { const button = event.currentTarget; button.disabled = true; const result = await request('cancelDownload', state.id); if (result?.ok === false) { button.disabled = false; status.textContent = text(result.error) || '취소 오류'; status.title = status.textContent; } });
    if (phase === 'complete' && id && Number.isInteger(state.downloadId) && state.downloadId >= 0) action(actions, '저장 폴더 열기', '↗', 'primary', async event => { const button = event.currentTarget; button.disabled = true; const result = await request('showDownloadFolder', state.id); button.disabled = false; if (result?.ok === false) { status.textContent = text(result.error) || '폴더 열기 오류'; status.title = status.textContent; } });
    if (['complete','error','cancelled'].includes(phase) && id) action(actions, '목록에서 제거', '−', '', async event => { const button = event.currentTarget; button.disabled = true; const result = await request('removeDownload', state.id); if (result?.ok === false) { button.disabled = false; status.textContent = text(result.error) || '제거 오류'; status.title = status.textContent; } });
    line.append(jobTitle, status, progressNode, actions); item.append(line); return item;
  };
  const render = () => {
    if (disposed || !storageReady) return;
    const visible = shown(); list.replaceChildren();
    if (visible.length) visible.forEach(job => list.append(jobView(job)));
    else list.append(el('div', 'empty', jobs.length ? '닫은 다운로드 항목입니다.' : '다운로드 대기열이 비어 있습니다.'));
    const active = visible.filter(job => ['preparing','queued','running','cancelling'].includes(phaseOf(job.phase))).length;
    summary.textContent = visible.length ? `${visible.length}개 항목${active ? ` · 진행 중 ${active}개` : ''}` : '다운로드 대기열';
    if (!closed) host.style.display = visible.length ? 'block' : 'none';
  };
  const receive = (states, pageZoom) => {
    if (disposed) return; if (pageZoom != null) setZoom(pageZoom);
    const next = Array.isArray(states) ? states : (states && typeof states === 'object' ? [states] : []); jobs = next.filter(state => state && typeof state === 'object');
    if (!storageReady) return;
    const visible = shown();
    if (!gotInitial) { gotInitial = true; closed = false; }
    else if (closed && visible.some(job => { const id = idOf(job); return id && !dismissed.has(id); })) { dismissed.clear(); saveDismissals(); closed = false; setCollapsed(false); }
    render();
  };

  fold.addEventListener('click', () => setCollapsed(true));
  mini.addEventListener('click', () => { closed = false; setCollapsed(false); render(); });
  close.addEventListener('click', () => { shown().forEach(job => { const id = idOf(job); if (id) dismissed.add(id); }); closed = true; setCollapsed(false); saveDismissals(); host.style.display = 'none'; });
  const stopKeys = event => event.stopPropagation(); host.addEventListener('keydown', stopKeys, true); shadow.addEventListener('keydown', stopKeys, true);
  const onMessage = message => {
    if (disposed || !message || typeof message !== 'object') return;
    if (message.type === 'downloadStatus') receive(Array.isArray(message.states) ? message.states : message.state, message.zoom);
    else if (message.type === 'pageZoom') setZoom(message.zoom);
    else if (message.type === 'showDownloadWidget') { dismissed.clear(); closed = false; setCollapsed(false); ext?.storage?.local?.remove(['downloadWidgetDismissedIds','downloadWidgetDismissedId']).catch(() => {}); render(); }
  };
  ext?.runtime?.onMessage?.addListener(onMessage);
  const restore = () => {
    if (!ext?.storage?.local) { storageReady = true; return receive(jobs); }
    ext.storage.local.get(['downloadWidgetDismissedIds','downloadWidgetDismissedId']).then(saved => {
      if (Array.isArray(saved?.downloadWidgetDismissedIds)) saved.downloadWidgetDismissedIds.forEach(id => { if (id != null) dismissed.add(String(id)); });
      else if (saved?.downloadWidgetDismissedId != null) dismissed.add(String(saved.downloadWidgetDismissedId));
    }).catch(() => {}).finally(() => { storageReady = true; receive(jobs); });
  };
  const initial = () => {
    if (!ext?.runtime?.sendMessage) return;
    try { ext.runtime.sendMessage({ target:'background', type:'getDownloadState' }, response => { if (disposed || ext.runtime.lastError || !response) return; receive(Array.isArray(response.states) ? response.states : response.state, response.zoom); }); } catch (_) {}
  };
  const dispose = () => { if (disposed) return; disposed = true; removeEventListener('resize', onResize); ext?.runtime?.onMessage?.removeListener(onMessage); host.remove(); if (globalThis.__videoShortcutWidget?.dispose === dispose) delete globalThis.__videoShortcutWidget; };
  globalThis.__videoShortcutWidget = { version:VERSION, dispose };
  restore(); initial();
})();
