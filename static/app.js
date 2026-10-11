'use strict';

/* ======================================================================= helpers */
const $ = (s, el = document) => el.querySelector(s);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function svg(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

async function req(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, opt);
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error((data && (data.detail || data.message)) || `Request failed (${r.status})`);
  return data;
}
const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b ?? {}),
  form: (u, fd) => req('POST', u, fd),
  del: (u) => req('DELETE', u),
};

function toast(msg, kind = 'info', ms = 4500) {
  const t = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

const fmtBytes = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const pct = (x) => `${Math.round(x * 100)}%`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '');
function ago(ts) {
  const s = (Date.now() / 1000) - ts;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

/* ======================================================================= state */
const S = {
  view: '', jobId: null, job: null, pollTimer: null, polling: false,
  sig: '', picksSig: '', sort: 'best', filters: { sameText: false, hideColored: false, hideWorse: false },
  uploadFile: null, uploadB64: '', pending: null, settings: null, cropEdits: {}, viewer: null,
};

/* ======================================================================= router */
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => { route(); loadSettings(); });

function route() {
  stopPolling();
  closeViewer();
  closeModal();
  const hash = location.hash || '#/';
  $('#nav-new').classList.toggle('active', hash === '#/' || hash === '');
  $('#nav-history').classList.toggle('active', hash === '#/history');
  if (hash.startsWith('#/job/')) showJob(hash.slice(6));
  else if (hash === '#/history') showHistory();
  else showStart();
}

async function loadSettings() {
  try { S.settings = await api.get('/api/settings'); } catch { /* server not ready */ }
}

/* ======================================================================= start view */
function showStart() {
  S.view = 'start'; S.jobId = null; S.job = null;
  const view = $('#view');
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true,
    onchange: (e) => e.target.files[0] && startSearch({ file: e.target.files[0] }) });
  const dz = h('div', { class: 'dropzone', onclick: () => fileInput.click() },
    h('div', { class: 'big' }, 'Drop a manga page or panel here'),
    h('div', { class: 'small' }, 'or click to choose a file \u00b7 or press ',
      h('span', { class: 'kbd' }, 'Ctrl'), ' + ', h('span', { class: 'kbd' }, 'V'), ' to paste one'));
  for (const ev of ['dragenter', 'dragover']) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) dz.addEventListener(ev, () => dz.classList.remove('over'));
  const urlIn = h('input', { type: 'url', placeholder: '\u2026or paste a link to an image (https://\u2026)' });
  const go = () => { const u = urlIn.value.trim(); if (u) startSearch({ url: u }); };
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const recent = h('div', { class: 'hgrid' });
  view.replaceChildren(h('section', { class: 'start' },
    h('h1', null, 'Find the best version of a panel'),
    h('p', { class: 'lead' }, 'Give it the page or panel you saved. It searches the web for every copy, checks each one really is your panel, and ranks them by how much real detail they have, so you can color the sharpest, least-cropped version.'),
    dz, fileInput,
    h('div', { class: 'urlrow' }, urlIn, h('button', { class: 'btn primary', onclick: go }, 'Search')),
    h('div', { class: 'how' },
      h('div', null, h('b', null, '1 \u00b7 Drop your image'), 'A full page, a cropped panel or a screenshot. Small or blurry is fine.'),
      h('div', null, h('b', null, '2 \u00b7 It searches & verifies'), 'Yandex, TinEye, SauceNAO and MangaDex. Every hit is downloaded and matched against your image.'),
      h('div', null, h('b', null, '3 \u00b7 Compare & save'), 'Slide between yours and theirs, then save the full, uncropped panel as a PNG.')),
    h('div', { class: 'section-title' }, 'Recent searches'), recent));
  renderHistoryGrid(recent, 8);
}

async function startSearch({ file, url }) {
  const fd = new FormData();
  if (file) fd.append('file', file, file.name || 'pasted-image.png');
  else fd.append('url', url);
  toast('Starting the search\u2026');
  try {
    const r = await api.form('/api/search', fd);
    location.hash = `#/job/${r.id}`;
  } catch (e) { toast(e.message, 'err', 7000); }
}

/* ======================================================================= history */
async function renderHistoryGrid(container, limit) {
  let list = [];
  try { list = await api.get('/api/jobs'); } catch { /* ignore */ }
  if (limit) list = list.slice(0, limit);
  if (!list.length) { container.replaceChildren(h('div', { class: 'empty' }, 'Nothing yet. Your searches will show up here.')); return; }
  container.replaceChildren(...list.map((j) => {
    const title = j.identification?.title ? `${j.identification.title}${j.identification.chapter ? ' \u00b7 ch. ' + j.identification.chapter : ''}` : (j.query?.name || 'Untitled image');
    const best = j.best ? `best ${j.best.width}\u00d7${j.best.height} (${j.best.detail.toFixed(1)}\u00d7)` : (j.status === 'running' ? 'searching\u2026' : 'no copies found');
    return h('div', { class: 'hcard', onclick: () => { location.hash = `#/job/${j.id}`; } },
      h('div', { class: 'ht', style: { backgroundImage: `url(/api/jobs/${j.id}/query_thumb)` } }),
      h('div', { class: 'hb' }, h('b', { title }, title), `${j.count} versions \u00b7 ${best}`, h('br'), ago(j.created)),
      h('button', { class: 'btn small danger del', title: 'Delete this search', onclick: async (e) => {
        e.stopPropagation();
        await api.del(`/api/jobs/${j.id}`); renderHistoryGrid(container, limit);
      } }, 'Delete'));
  }));
}

function showHistory() {
  S.view = 'history';
  const grid = h('div', { class: 'hgrid' });
  $('#view').replaceChildren(h('section', { class: 'history' },
    h('div', { class: 'history-head' }, h('h2', null, 'Your searches'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Delete all saved searches and their downloaded images?')) return;
        await api.del('/api/jobs'); renderHistoryGrid(grid);
      } }, 'Delete all')),
    grid));
  renderHistoryGrid(grid);
}

/* ======================================================================= job view */
async function showJob(id) {
  S.view = 'job'; S.jobId = id; S.job = null; S.sig = ''; S.picksSig = ''; S.uploadFile = null; S.cropEdits = {};
  const side = h('aside', { class: 'side' });
  const main = h('section', { class: 'mainc' });
  $('#view').replaceChildren(h('div', { class: 'job' }, side, main));
  try {
    const j = await api.get(`/api/jobs/${id}`);
    S.job = j;
    buildSide(side, j);
    buildMain(main, j);
    update(j);
    prefetchUpload(id);
    if (needsPoll(j)) schedulePoll();
  } catch (e) {
    main.replaceChildren(h('div', { class: 'nores' }, h('b', null, 'Could not open this search'), e.message));
  }
}

const needsPoll = (j) => j.status === 'running' || j.mangadex?.state === 'running';

function schedulePoll() {
  stopPolling();
  S.pollTimer = setTimeout(poll, 900);
}
function stopPolling() { clearTimeout(S.pollTimer); S.pollTimer = null; }
async function poll() {
  if (S.view !== 'job' || !S.jobId) return;
  const id = S.jobId;
  try {
    const j = await api.get(`/api/jobs/${id}`);
    if (S.jobId !== id) return;
    const wasRunning = needsPoll(S.job || {});
    S.job = j;
    update(j);
    if (needsPoll(j)) schedulePoll();
    else if (wasRunning && j.status === 'done') {
      toast(j.results.length ? `Done: ${j.results.length} matching versions found.` : 'Done, but no matching copies were found.', j.results.length ? 'ok' : 'info');
    }
  } catch { schedulePoll(); }
}

async function refresh() {
  const j = await api.get(`/api/jobs/${S.jobId}`);
  S.job = j; S.sig = ''; S.picksSig = '';
  update(j);
  if (needsPoll(j)) schedulePoll();
}

async function prefetchUpload(id) {
  try {
    const blob = await (await fetch(`/api/jobs/${id}/upload.jpg`)).blob();
    S.uploadFile = new File([blob], 'image.jpg', { type: 'image/jpeg' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    S.uploadB64 = btoa(bin);
  } catch { /* the manual buttons will just not work */ }
}

/* ---------------------------------------------------------------- sidebar */
function buildSide(side, j) {
  const q = j.query;
  const qbox = h('div', { class: 'qimg', title: 'Click to focus on one panel of your image', onclick: openRoiPicker });
  side.append(
    h('h3', null, 'Your image'), qbox,
    h('div', { class: 'qmeta', id: 'qmeta' }),
    h('div', { class: 'row mt8' },
      h('button', { class: 'btn small', onclick: openRoiPicker }, 'Focus on one panel\u2026'),
      h('button', { class: 'btn small ghost', id: 'roi-clear', hidden: true, onclick: () => setRoi(null) }, 'Use whole image')),
    h('div', { class: 'hint' }, 'Searching a full page but only want one panel? Focus on it and the ranking will follow.'),
    h('h3', null, 'What is it?'), h('div', { id: 'ident' }),
    h('h3', null, 'Search progress'), h('ul', { class: 'engines', id: 'engines' }),
    h('h3', null, 'Search by hand'),
    h('div', { class: 'manual', id: 'manual' }),
    h('div', { class: 'hint' }, 'Opens the search in a new tab with your image. Found something better? Drag it back in here to check and crop it.'),
    h('h3', null, 'Activity'),
    h('details', { class: 'log' }, h('summary', null, 'Show log'), h('ol', { id: 'log' })),
  );
  renderQueryThumb(qbox, j);
  const meta = [`${q.width}\u00d7${q.height}`, q.format, fmtBytes(q.bytes)];
  if (q.jpeg_quality) meta.push(`JPEG quality \u2248${q.jpeg_quality}`);
  $('#qmeta').textContent = meta.join(' \u00b7 ');

  const manual = $('#manual');
  const mk = (label, fn) => h('button', { class: 'btn small', onclick: fn }, label);
  manual.append(
    mk('Google Lens', () => submitEngine('lens')),
    mk('Bing', () => submitEngine('bing')),
    mk('Yandex', () => { const u = S.job?.engines?.Yandex?.url; if (u) window.open(u, '_blank', 'noopener'); else submitEngine('yandex'); }),
    mk('SauceNAO', () => submitEngine('saucenao')),
    mk('TinEye', () => { const u = S.job?.engines?.TinEye?.url; if (u) window.open(u, '_blank', 'noopener'); else window.open('https://tineye.com/', '_blank', 'noopener'); }),
    mk('Open my image', () => window.open(`/api/jobs/${S.jobId}/query`, '_blank')),
  );
}

function renderQueryThumb(box, j) {
  const q = j.query;
  const s = svg('svg', { viewBox: `0 0 ${q.width} ${q.height}`, preserveAspectRatio: 'xMidYMid meet', width: '100%', style: `max-height:300px;display:block` },
    svg('image', { href: `/api/jobs/${j.id}/query`, x: 0, y: 0, width: q.width, height: q.height }));
  if (j.roi) {
    const [x0, y0, x1, y1] = j.roi;
    s.append(svg('path', { d: `M0 0H${q.width}V${q.height}H0Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`, fill: 'rgba(0,0,0,.55)', 'fill-rule': 'evenodd' }));
    s.append(svg('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'none', stroke: '#ffb547', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }
  box.replaceChildren(s);
}

const ENGINE_FORMS = {
  lens: { action: 'https://lens.google.com/v3/upload?hl=en', file: 'encoded_image' },
  bing: { action: 'https://www.bing.com/images/search?view=detailv2&iss=sbiupload', fields: { cbir: 'sbi' }, b64: 'imageBin' },
  yandex: { action: 'https://yandex.com/images/search?rpt=imageview', file: 'upfile', fields: { prg: '1' } },
  saucenao: { action: 'https://saucenao.com/search.php', file: 'file' },
};

function submitEngine(name) {
  const cfg = ENGINE_FORMS[name];
  if (!S.uploadFile) { toast('Still preparing your image, try again in a second.'); return; }
  const form = h('form', { method: 'POST', action: cfg.action, enctype: 'multipart/form-data', target: '_blank', hidden: true });
  for (const [k, v] of Object.entries(cfg.fields || {})) form.append(h('input', { type: 'hidden', name: k, value: v }));
  if (cfg.file) {
    const inp = h('input', { type: 'file', name: cfg.file });
    const dt = new DataTransfer();
    dt.items.add(S.uploadFile);
    inp.files = dt.files;
    form.append(inp);
  }
  if (cfg.b64) form.append(h('input', { type: 'hidden', name: cfg.b64, value: S.uploadB64 }));
  document.body.append(form);
  form.submit();
  form.remove();
}

function renderIdent(j) {
  const box = $('#ident');
  if (!box) return;
  const id = j.identification || {};
  const md = j.mangadex || {};
  let titleIn = $('#md-title'), chIn = $('#md-ch');
  if (!titleIn) {
    titleIn = h('input', { type: 'text', id: 'md-title', placeholder: 'Manga title' });
    chIn = h('input', { type: 'text', id: 'md-ch', placeholder: 'Ch.' });
    const btn = h('button', { class: 'btn small', id: 'md-go', onclick: runMangaDex }, 'Check every MangaDex version');
    box.replaceChildren(
      h('div', { id: 'ident-card' }),
      h('div', { class: 'mdform' }, titleIn, chIn),
      h('div', { class: 'row mt8' }, btn),
      h('div', { class: 'mdstatus', id: 'md-status' }));
  }
  if (id.title && !titleIn.dataset.touched) titleIn.value = id.title;
  if (id.chapter && !chIn.dataset.touched) chIn.value = id.chapter;
  titleIn.oninput = () => { titleIn.dataset.touched = 1; };
  chIn.oninput = () => { chIn.dataset.touched = 1; };
  const card = $('#ident-card');
  if (id.title) {
    card.replaceChildren(h('div', { class: 'ident' },
      h('b', null, id.title), id.chapter ? ` \u00b7 chapter ${id.chapter}` : (id.part ? ` \u00b7 ${id.part}` : ''),
      h('div', { class: 'src' }, `From ${id.source}`)));
  } else {
    card.replaceChildren(h('div', { class: 'hint', style: { marginTop: 0 } },
      j.status === 'running' ? 'Working it out\u2026' : 'Not sure which manga this is. Type the title and chapter to check MangaDex.'));
  }
  const st = $('#md-status');
  const go = $('#md-go');
  go.disabled = md.state === 'running';
  go.textContent = md.state === 'running' ? 'Checking MangaDex\u2026' : 'Check every MangaDex version';
  const kids = [];
  if (md.message) kids.push(h('div', null, md.message));
  if (md.versions?.length) {
    kids.push(h('ul', { style: { paddingLeft: '16px', margin: '4px 0 0' } },
      md.versions.map((v) => h('li', null, `${v.lang} \u00b7 ${v.group}: `, h('span', { style: { color: v.state.startsWith('page') ? 'var(--good)' : 'var(--faint)' } }, v.state)))));
  }
  st.replaceChildren(...kids);
}

async function runMangaDex() {
  const title = $('#md-title').value.trim(), chapter = $('#md-ch').value.trim();
  if (!title || !chapter) { toast('Type the manga title and the chapter number first.'); return; }
  try {
    await api.post(`/api/jobs/${S.jobId}/mangadex`, { title, chapter });
    toast('Checking MangaDex for every version of that chapter\u2026');
    schedulePoll();
  } catch (e) { toast(e.message, 'err'); }
}

function renderEngines(j) {
  const ul = $('#engines');
  if (!ul) return;
  const items = Object.entries(j.engines || {}).map(([name, e]) => {
    let st, cls = '';
    if (e.state === 'running') st = 'searching\u2026';
    else if (e.state === 'done') { st = `${e.found} results`; cls = 'ok'; }
    else if (e.state === 'off') st = e.error || 'off';
    else { st = e.error || 'failed'; cls = 'err'; }
    const label = e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener', title: 'Open these results' }, name) : name;
    return h('li', null, h('span', null, label), h('span', { class: `st ${cls}`, title: st }, st.length > 60 ? st.slice(0, 58) + '\u2026' : st));
  });
  const c = j.counters || {};
  items.push(h('li', null, h('span', null, 'Images checked'), h('span', { class: 'st' }, `${c.checked || 0} \u00b7 ${c.matched || 0} match`)));
  ul.replaceChildren(...items);
  const log = $('#log');
  if (log) log.replaceChildren(...(j.log || []).map((l) => h('li', null, `${l.t.toFixed(0).padStart(3)}s  ${l.msg}`)));
}

/* ---------------------------------------------------------------- main column */
function buildMain(main, j) {
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => e.target.files[0] && addCandidate({ file: e.target.files[0] }) });
  const urlIn = h('input', { type: 'url', placeholder: 'Paste a link to an image you found\u2026' });
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && urlIn.value.trim()) { addCandidate({ url: urlIn.value.trim() }); urlIn.value = ''; } });
  const addbar = h('div', { class: 'addbar', id: 'addbar' },
    h('span', { class: 'lbl' }, 'Found a version yourself?'), urlIn,
    h('button', { class: 'btn small', onclick: () => { if (urlIn.value.trim()) { addCandidate({ url: urlIn.value.trim() }); urlIn.value = ''; } } }, 'Check link'),
    h('button', { class: 'btn small', onclick: () => fileIn.click() }, 'Check a file\u2026'), fileIn);
  for (const ev of ['dragenter', 'dragover']) addbar.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); addbar.classList.add('over'); });
  addbar.addEventListener('dragleave', () => addbar.classList.remove('over'));
  addbar.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); addbar.classList.remove('over');
    const item = await itemFromDataTransfer(e.dataTransfer);
    if (item) addCandidate(item);
  });

  const sortSel = h('select', { onchange: (e) => { S.sort = e.target.value; S.sig = ''; update(S.job); } },
    h('option', { value: 'best' }, 'Sort: best quality'),
    h('option', { value: 'size' }, 'Sort: biggest panel'),
    h('option', { value: 'complete' }, 'Sort: least cropped'),
    h('option', { value: 'new' }, 'Sort: newest found'));
  sortSel.value = S.sort;
  const chk = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.filters[key] || null, onchange: (e) => { S.filters[key] = e.target.checked; S.sig = ''; update(S.job); } }), label);

  main.append(
    h('div', { class: 'statusbar', id: 'statusbar' }),
    h('div', { id: 'picks' }),
    addbar,
    h('div', { class: 'toolbar' }, h('span', { class: 'count', id: 'count' }),
      chk('sameText', 'Same text as mine'), chk('hideColored', 'Hide colored'), chk('hideWorse', 'Hide lower quality than mine'), sortSel),
    h('div', { class: 'grid', id: 'grid' }));
}

function update(j) {
  if (!j || S.view !== 'job') return;
  renderStatus(j);
  renderEngines(j);
  renderIdent(j);
  const roiBtn = $('#roi-clear');
  if (roiBtn) roiBtn.hidden = !j.roi;
  const picksSig = JSON.stringify([j.picks, j.roi, j.results.map((r) => [r.id, Math.round(r.score * 100)])]);
  if (picksSig !== S.picksSig) { S.picksSig = picksSig; renderPicks(j); }
  const list = visibleResults(j);
  const sig = JSON.stringify([list.map((r) => r.id + ':' + Math.round(r.score * 100)), j.roi]);
  if (sig !== S.sig) { S.sig = sig; renderGrid(j, list); }
  const total = j.results.length;
  $('#count').textContent = total ? (list.length === total ? `${total} matching versions` : `${list.length} of ${total} versions shown`) : '';
}

function renderStatus(j) {
  const bar = $('#statusbar');
  if (!bar) return;
  const c = j.counters || {};
  const running = needsPoll(j);
  const secs = Math.max(0, Math.round(Date.now() / 1000 - j.created));
  let phase = j.status === 'running' ? j.phase : (j.mangadex?.state === 'running' ? 'Checking MangaDex' : (j.status === 'error' ? j.phase : 'Search finished'));
  const counts = `${c.checked || 0} images checked \u00b7 ${j.results.length} match yours` + (j.status === 'running' ? ` \u00b7 ${secs}s` : '');
  const kids = [
    running ? h('div', { class: 'spinner' }) : h('span', { style: { color: j.results.length ? 'var(--good)' : 'var(--muted)', fontWeight: 700 } }, j.results.length ? '\u2713' : '\u2013'),
    h('span', { class: 'phase' }, phase),
    h('span', { class: 'counts' }, counts),
    h('span', { style: { marginLeft: 'auto' } }),
  ];
  if (!running) kids.push(h('button', { class: 'btn small', onclick: () => rerun() }, 'Search again'));
  bar.replaceChildren(...kids);
}

async function rerun() {
  try {
    const blob = await (await fetch(`/api/jobs/${S.jobId}/query`)).blob();
    await startSearch({ file: new File([blob], S.job?.query?.name || 'image.png', { type: blob.type }) });
  } catch (e) { toast(e.message, 'err'); }
}

function visibleResults(j) {
  let list = j.results.slice();
  if (S.filters.sameText) list = list.filter((r) => r.text_differs === false);
  if (S.filters.hideColored) list = list.filter((r) => !r.colored);
  if (S.filters.hideWorse) list = list.filter((r) => r.detail >= 0.95);
  const key = {
    best: (r) => -r.score,
    size: (r) => -(r.panel_px[0] * r.panel_px[1]),
    complete: (r) => -(r.more_visible * 10 + r.score / 1000),
    new: (r) => -r.added,
  }[S.sort];
  list.sort((a, b) => key(a) - key(b));
  return list;
}

function detailInfo(d) {
  if (d >= 1.08) return { text: `${d.toFixed(1)}\u00d7 detail`, cls: 'up' };
  if (d >= 0.93) return { text: 'same detail', cls: 'same' };
  return { text: `${d.toFixed(2)}\u00d7 detail`, cls: 'down' };
}

function badgesFor(r) {
  const b = [];
  const add = (text, cls, title) => b.push(h('span', { class: `badge ${cls || ''}`, title }, text));
  if (r.sharpness === 'crisp') add('Crisp lines', 'good', 'Ink edges are sharp: real detail, not an upscale.');
  else if (r.sharpness === 'slightly soft') add('Slightly soft', '', 'Edges are a bit soft (scan blur or light resizing).');
  else if (r.sharpness === 'soft') add('Soft / blurry', 'warn', 'Edges are smeared. Probably blown up from a smaller copy.');
  if (r.upscaled) add('Looks upscaled', 'warn', 'Big in pixels, but the detail is no better than a smaller copy.');
  if (r.text_differs === true) add('Different text', 'warn', 'Speech bubbles or sound effects differ from yours: another language, a raw, or edits.');
  else if (r.text_differs === false) add('Same text', 'good', 'Lettering matches your image.');
  if (r.more_visible >= 0.05) add(`+${Math.round(r.more_visible * 100)}% more visible`, 'good', 'This version shows more of the panel/page than your image.');
  if (r.coverage < 0.97) add(`Shows ${pct(r.coverage)} of yours`, 'warn', 'This version is cropped tighter than yours.');
  if (r.colored) add('Colored', '', 'This version is already in color.');
  if (r.mirrored) add('Mirrored', 'warn', 'Flipped left-to-right compared to yours.');
  if (r.format === 'PNG') add('PNG', 'good', 'Lossless file: no extra compression damage.');
  else if (r.jpeg_quality && r.jpeg_quality < 80) add(`JPEG q${r.jpeg_quality}`, 'warn', 'Heavily compressed JPEG: watch for blocky artifacts.');
  else if (r.jpeg_quality) add(`JPEG q${r.jpeg_quality}`, '', 'JPEG compression quality.');
  else if (r.format === 'WEBP') add('WebP', '', '');
  return b;
}

function sourceLabel(r) {
  const n = r.sources.length;
  return `${r.domain}${n > 1 ? ` +${n - 1} more` : ''} \u00b7 ${r.note || r.engine}`;
}

function thumbSvg(j, r, { showCrop = true } = {}) {
  const W = r.width, H = r.height;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%', style: 'position:absolute;inset:0' },
    svg('image', { href: `/api/jobs/${j.id}/results/${r.id}/thumb`, x: 0, y: 0, width: W, height: H }));
  const [a, b, c, d] = r.roi_in_cand;
  s.append(svg('rect', { x: a, y: b, width: c - a, height: d - b, fill: 'none', stroke: 'rgba(126,166,255,.95)', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
  if (showCrop && r.crop_kind === 'panel') {
    const [x0, y0, x1, y1] = r.crop;
    s.append(svg('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'none', stroke: '#ffb547', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }
  return s;
}

function cropUrl(r, box, flip) {
  const b = (box || r.crop).map((v) => Math.round(v)).join(',');
  return `/api/jobs/${S.jobId}/results/${r.id}/crop?box=${b}&flip=${flip ? 1 : 0}`;
}

function download(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a); a.click(); a.remove();
}

function renderPicks(j) {
  const box = $('#picks');
  if (!box) return;
  const byId = Object.fromEntries(j.results.map((r) => [r.id, r]));
  const p = j.picks || {};
  const items = [];
  if (p.best) items.push(['Best version', byId[p.best], true]);
  if (p.same_text && p.same_text !== p.best) items.push(['Best with your text', byId[p.same_text], false]);
  if (p.complete && p.complete !== p.best && p.complete !== p.same_text) items.push(['Least cropped', byId[p.complete], false]);
  if (!items.length) {
    if (j.status === 'running') { box.replaceChildren(); return; }
    box.replaceChildren(h('div', { class: 'nores' },
      h('b', null, 'No verified copies of your image were found online.'),
      h('ul', { class: 'explain' },
        h('li', null, 'Try the ', h('b', null, 'Google Lens'), ' button on the left. It often finds copies the automatic search misses.'),
        h('li', null, 'If you know the manga and chapter, type them under \u201cWhat is it?\u201d to check every MangaDex version.'),
        h('li', null, 'If you searched with a small crop, try the full page instead. Pages are shared far more often than panels.'),
        h('li', null, 'Add a free SauceNAO key in Settings. It is very good at recognising manga pages.'))));
    return;
  }
  box.replaceChildren(h('div', { class: 'picks' }, items.map(([label, r, isBest]) => {
    const di = detailInfo(r.detail);
    return h('div', { class: `pick ${isBest ? 'best' : ''}` },
      h('div', { class: 'ptitle' }, label),
      h('div', { class: 'thumb', onclick: () => openViewer(r.id, 'compare') }, thumbSvg(j, r)),
      h('div', { class: 'pbody' },
        h('div', { class: 'bignum' }, di.cls === 'up' ? di.text : (di.cls === 'same' ? 'Same detail as yours' : di.text), h('small', null, `saves ${r.panel_px[0]}\u00d7${r.panel_px[1]} px`)),
        h('div', { class: 'badges' }, badgesFor(r)),
        h('div', { class: 'source' }, sourceLabel(r)),
        h('div', { class: 'row actions' },
          h('button', { class: 'btn primary', onclick: () => openViewer(r.id, 'compare') }, 'Compare & save'),
          h('button', { class: 'btn', onclick: () => download(cropUrl(r)) }, 'Download PNG'))));
  })));
}

function renderGrid(j, list) {
  const grid = $('#grid');
  if (!grid) return;
  grid.replaceChildren(...list.map((r) => {
    const di = detailInfo(r.detail);
    return h('div', { class: 'card' },
      h('div', { class: 'thumb', onclick: () => openViewer(r.id, 'compare'), title: 'Dashed blue: where your image is. Orange: the panel it will save.' }, thumbSvg(j, r)),
      h('div', { class: 'cbody' },
        h('div', { class: 'dims' }, h('span', null, h('b', null, `${r.width}\u00d7${r.height}`), h('span', { class: 'fmt' }, r.format)),
          h('span', { class: `detailnum ${di.cls}` }, di.text)),
        h('div', { class: 'sub' }, r.crop_kind === 'panel' ? `Saves a ${r.panel_px[0]}\u00d7${r.panel_px[1]} crop` : 'Same framing as yours'),
        h('div', { class: 'badges' }, badgesFor(r)),
        h('div', { class: 'source', title: r.sources.map((s) => s.page_url || s.url).join('\n') }, sourceLabel(r)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', onclick: () => openViewer(r.id, 'compare') }, 'Compare'),
          h('button', { class: 'btn small', onclick: () => openViewer(r.id, 'crop') }, 'Crop & save'))));
  }));
}

async function addCandidate({ file, url }) {
  const fd = new FormData();
  if (file) fd.append('file', file, file.name || 'image.png'); else fd.append('url', url);
  toast('Checking that image against yours\u2026');
  try {
    const r = await api.form(`/api/jobs/${S.jobId}/add`, fd);
    toast(r.message, r.ok ? 'ok' : 'err', 6000);
    await refresh();
    if (r.ok && r.id) openViewer(r.id, 'compare');
  } catch (e) { toast(e.message, 'err'); }
}

/* ======================================================================= focus (region of interest) */
function openRoiPicker() {
  const j = S.job;
  if (!j) return;
  const q = j.query;
  const stage = h('div', { class: 'roi-stage' });
  const img = h('img', { src: `/api/jobs/${j.id}/query`, alt: '' });
  const rect = h('div', { class: 'roi-rect', hidden: true });
  stage.append(img, rect);
  let fit = 1, ox = 0, oy = 0, roi = j.roi ? j.roi.slice() : null, start = null;
  const layout = () => {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    fit = Math.min(sw / q.width, sh / q.height);
    ox = (sw - q.width * fit) / 2; oy = (sh - q.height * fit) / 2;
    Object.assign(img.style, { left: `${ox}px`, top: `${oy}px`, width: `${q.width * fit}px`, height: `${q.height * fit}px` });
    draw();
  };
  const draw = () => {
    if (!roi) { rect.hidden = true; return; }
    rect.hidden = false;
    Object.assign(rect.style, { left: `${ox + roi[0] * fit}px`, top: `${oy + roi[1] * fit}px`, width: `${(roi[2] - roi[0]) * fit}px`, height: `${(roi[3] - roi[1]) * fit}px` });
  };
  const toImg = (e) => {
    const b = stage.getBoundingClientRect();
    return [clamp((e.clientX - b.left - ox) / fit, 0, q.width), clamp((e.clientY - b.top - oy) / fit, 0, q.height)];
  };
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); start = toImg(e); roi = [...start, ...start]; draw(); });
  stage.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = toImg(e);
    roi = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.max(start[0], p[0]), Math.max(start[1], p[1])];
    draw();
  });
  stage.addEventListener('pointerup', () => { start = null; if (roi && (roi[2] - roi[0] < 6 || roi[3] - roi[1] < 6)) { roi = null; draw(); } });
  openModal('Focus on one panel', h('div', null,
    h('p', { class: 'sub', style: { marginTop: 0 } }, 'Drag a box around the panel you want. Results are re-ranked for that area, and the suggested crops grow out to that panel\u2019s borders.'),
    stage), [
    h('button', { class: 'btn ghost', onclick: () => { closeModal(); setRoi(null); } }, 'Use whole image'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => { closeModal(); setRoi(roi); } }, 'Focus here'),
  ], { wide: true });
  layout();
  img.addEventListener('load', layout);
}

async function setRoi(roi) {
  toast(roi ? 'Re-ranking for that panel\u2026' : 'Back to the whole image\u2026');
  try {
    const j = await api.post(`/api/jobs/${S.jobId}/roi`, { roi });
    S.job = j; S.sig = ''; S.picksSig = '';
    renderQueryThumb($('.qimg'), j);
    update(j);
  } catch (e) { toast(e.message, 'err'); }
}

/* ======================================================================= modals */
function openModal(title, body, buttons = [], { wide = false } = {}) {
  closeModal();
  const m = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === m) closeModal(); } },
    h('div', { class: 'modal', style: wide ? { width: 'min(1100px, 100%)' } : null },
      h('header', null, h('h2', null, title), h('button', { class: 'x', onclick: closeModal, title: 'Close' }, '\u00d7')),
      h('div', { class: 'mbody' }, body),
      buttons.length ? h('footer', null, buttons) : null));
  $('#modal-root').replaceChildren(m);
}
function closeModal() { $('#modal-root').replaceChildren(); }

$('#nav-settings').addEventListener('click', openSettings);

async function openSettings() {
  let s;
  try { s = await api.get('/api/settings'); } catch (e) { toast(e.message, 'err'); return; }
  const f = {};
  const field = (key, label, input, help) => { f[key] = input; return h('div', { class: 'field' }, h('label', null, label), input, help ? h('div', { class: 'help' }, help) : null); };
  const check = (key, label) => { const i = h('input', { type: 'checkbox', checked: s[key] || null }); f[key] = i; return h('label', { class: 'check' }, i, label); };
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    field('saucenao_key', 'SauceNAO API key (optional, free)', h('input', { type: 'password', value: s.saucenao_key || '', placeholder: 'paste your key here', autocomplete: 'off' }),
      h('span', null, 'SauceNAO is great at telling which manga, chapter and page an image is from. Make a free account at ',
        h('a', { href: 'https://saucenao.com/user.php', target: '_blank', rel: 'noopener' }, 'saucenao.com'),
        ', then copy the key from ', h('a', { href: 'https://saucenao.com/user.php?page=search-api', target: '_blank', rel: 'noopener' }, 'the API page'), '. Free keys allow about 100 searches a day.')),
    h('div', { class: 'field' }, h('label', null, 'Search with'),
      h('div', { class: 'row', style: { gap: '18px' } }, check('use_yandex', 'Yandex'), check('use_tineye', 'TinEye'), check('use_saucenao', 'SauceNAO'))),
    check('second_round', 'Second round: search again with the best full page found (finds much bigger copies)'),
    check('auto_mangadex', 'Check MangaDex automatically when SauceNAO recognises the chapter'),
    field('max_checks', 'Images to check per search round', h('input', { type: 'number', min: 5, max: 200, value: s.max_checks }), 'More finds more versions but takes longer. 60 is a good balance.'),
    field('mangadex_languages', 'MangaDex languages', h('input', { type: 'text', value: s.mangadex_languages || '', placeholder: 'empty = all, or e.g. en, ja' }), 'Language codes to check on MangaDex, separated by commas.'),
    field('save_folder', 'Save-to folder (optional)', h('input', { type: 'text', value: s.save_folder || '', placeholder: 'e.g. C:\\Users\\you\\Pictures\\to color' }), 'If set, you get a \u201cSave to folder\u201d button that drops files straight in here. Otherwise files go to your Downloads.'));
  const save = async () => {
    const out = {};
    for (const [k, el] of Object.entries(f)) out[k] = el.type === 'checkbox' ? el.checked : el.value;
    try {
      const r = await api.post('/api/settings', out);
      S.settings = r.settings;
      if (r.warning) toast(r.warning, 'err'); else { toast('Settings saved.', 'ok'); closeModal(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  openModal('Settings', body, [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')]);
}

/* ======================================================================= viewer (compare + crop) */
function closeViewer() {
  if (!S.viewer) return;
  S.viewer.cleanup?.();
  S.viewer.el.remove();
  S.viewer = null;
}

function openViewer(cid, tab = 'compare') {
  closeViewer();
  const j = S.job;
  const list = visibleResults(j);
  let idx = list.findIndex((r) => r.id === cid);
  if (idx < 0) { list.unshift(j.results.find((r) => r.id === cid)); idx = 0; }
  const stage = h('div', { class: 'stage' });
  const side = h('div', { class: 'vside' });
  const title = h('span', { class: 'vtitle' });
  const tabs = h('div', { class: 'tabs' },
    h('button', { 'data-tab': 'compare', onclick: () => show(idx, 'compare') }, 'Compare'),
    h('button', { 'data-tab': 'crop', onclick: () => show(idx, 'crop') }, 'Crop & save'));
  const prev = h('button', { class: 'btn small', title: 'Previous (\u2190)', onclick: () => show(idx - 1, V.tab) }, '\u2190');
  const next = h('button', { class: 'btn small', title: 'Next (\u2192)', onclick: () => show(idx + 1, V.tab) }, '\u2192');
  const el = h('div', { class: 'viewer' },
    h('div', { class: 'vhead' }, title, tabs, h('div', { class: 'vnav' }, prev, next, h('button', { class: 'x', title: 'Close (Esc)', onclick: closeViewer }, '\u00d7'))),
    h('div', { class: 'vmain' }, stage, side));
  document.body.append(el);
  const V = S.viewer = { el, tab, stageCleanup: null };
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') show(idx - 1, V.tab);
    else if (e.key === 'ArrowRight') show(idx + 1, V.tab);
    else V.onKey?.(e);
  };
  const onKeyUp = (e) => V.onKeyUp?.(e);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  V.cleanup = () => { V.stageCleanup?.(); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };

  function show(i, t) {
    if (i < 0 || i >= list.length) return;
    idx = i; V.tab = t;
    const r = list[i];
    prev.disabled = i === 0; next.disabled = i === list.length - 1;
    title.textContent = `${i + 1} / ${list.length} \u00b7 ${r.width}\u00d7${r.height} ${r.format} from ${r.domain}`;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === t);
    V.stageCleanup?.(); V.onKey = V.onKeyUp = null;
    stage.replaceChildren();
    if (t === 'compare') mountCompare(stage, r, V); else mountCrop(stage, r, V);
    renderViewerSide(side, r, V);
  }
  show(idx, tab);
}

function renderViewerSide(side, r, V) {
  const j = S.job;
  const di = detailInfo(r.detail);
  const q = j.query;
  const edits = S.cropEdits[r.id];
  const box = edits?.box || r.crop;
  const flip = edits?.flip ?? false;
  const kids = [
    h('div', null, h('div', { class: 'bigdims' }, `${r.width} \u00d7 ${r.height}`), h('div', { class: 'sub' }, `${r.format} \u00b7 ${fmtBytes(r.bytes)}${r.jpeg_quality ? ` \u00b7 JPEG quality \u2248${r.jpeg_quality}` : ''}`)),
    h('div', { class: `detailnum ${di.cls}`, style: { fontSize: '18px' } }, di.cls === 'same' ? 'Same detail as yours' : `${di.text} compared to yours`),
    h('div', { class: 'kv' },
      h('span', null, 'Your area here'), h('span', null, `${r.roi_px[0]}\u00d7${r.roi_px[1]} px (yours: ${j.roi ? Math.round(j.roi[2] - j.roi[0]) + '\u00d7' + Math.round(j.roi[3] - j.roi[1]) : q.width + '\u00d7' + q.height})`),
      h('span', null, 'Will save'), h('span', null, `${Math.round(box[2] - box[0])}\u00d7${Math.round(box[3] - box[1])} px ${r.crop_kind === 'panel' && !edits ? '(panel)' : ''}`),
      h('span', null, 'Line sharpness'), h('span', null, r.sharpness),
      h('span', null, 'Pixel scale'), h('span', null, `${r.scale.toFixed(2)}\u00d7 yours`)),
    h('div', { class: 'badges' }, badgesFor(r)),
    h('button', { class: 'btn primary', onclick: () => download(cropUrl(r, box, flip)) }, r.crop_kind === 'panel' || edits ? 'Download this crop (PNG)' : 'Download page (PNG)'),
    h('button', { class: 'btn', onclick: () => download(`/api/jobs/${j.id}/results/${r.id}/file?dl=1`) }, 'Download original file'),
  ];
  if (S.settings?.save_folder) {
    kids.push(h('button', { class: 'btn', onclick: async () => {
      try {
        const res = await api.post(`/api/jobs/${j.id}/results/${r.id}/save`, { box, flip });
        toast(`Saved to ${res.path}`, 'ok', 7000);
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Save crop to my folder'));
  }
  if (r.mirrored) {
    kids.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: flip || null, onchange: (e) => {
      S.cropEdits[r.id] = { box, flip: e.target.checked }; renderViewerSide(side, r, V);
    } }), 'Flip back to match my image'));
  }
  if (V.tab === 'compare' && r.diff_boxes?.length) {
    kids.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: V.showDiff || null, onchange: (e) => { V.showDiff = e.target.checked; V.renderDiff?.(); } }), 'Highlight differences (D)'));
  }
  kids.push(
    h('button', { class: 'btn ghost', onclick: () => researchWith(r) }, 'Search again using this version'),
    h('div', { class: 'section-title', style: { margin: '6px 0 0' } }, 'Found at'),
    h('div', { class: 'sources' }, r.sources.map((s) => h('a', { href: s.page_url || s.url, target: '_blank', rel: 'noopener', title: s.page_url || s.url }, `${s.engine}: ${s.title || s.page_url || s.url}`))),
    h('ul', { class: 'explain' },
      h('li', null, h('b', null, 'Detail'), ' compares real sharpness, not just pixel count, so upscaled copies don\u2019t win.'),
      h('li', null, h('b', null, 'Blue dashed'), ' box = where your image sits. ', h('b', null, 'Orange'), ' = what will be saved.')));
  side.replaceChildren(...kids);
}

async function researchWith(r) {
  try {
    const blob = await (await fetch(`/api/jobs/${S.jobId}/results/${r.id}/file`)).blob();
    closeViewer();
    await startSearch({ file: new File([blob], `version-${r.width}x${r.height}`, { type: blob.type }) });
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------------------------------------------------------- compare slider */
function mountCompare(stage, r, V) {
  const j = S.job, q = j.query;
  const W = q.width, H = q.height;
  const inner = h('div', { class: 'cmp-inner' });
  const cand = h('img', { alt: '', src: `/api/jobs/${j.id}/results/${r.id}/aligned` });
  const mine = h('img', { alt: '', class: 'mine', src: `/api/jobs/${j.id}/query` });
  const diffLayer = h('div', { style: { position: 'absolute', inset: 0 } });
  inner.append(cand, mine, diffLayer);
  const divider = h('div', { class: 'cmp-divider' });
  const handle = h('div', { class: 'cmp-handle', title: 'Drag to compare' }, '\u2194');
  const loading = h('div', { class: 'stage-hint', style: { bottom: 'auto', top: '50%' } }, 'Lining this version up with yours\u2026');
  cand.addEventListener('load', () => loading.remove());
  cand.addEventListener('error', () => { loading.textContent = 'Could not prepare the comparison image.'; });
  stage.append(inner, divider, handle,
    h('div', { class: 'cmp-label l' }, `Yours \u00b7 ${W}\u00d7${H}`),
    h('div', { class: 'cmp-label r' }, `This version \u00b7 ${r.roi_px[0]}\u00d7${r.roi_px[1]}`),
    h('div', { class: 'stage-hint' }, 'Drag the handle \u00b7 scroll to zoom \u00b7 drag to pan \u00b7 hold Space to see yours \u00b7 double-click to reset'),
    loading);
  let fit = 1, z = 1, tx = 0, ty = 0, pos = 0.5, saved = null;
  const reset = () => {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    fit = Math.min(sw / W, sh / H) * 0.94;
    z = 1; tx = (sw - W * fit) / 2; ty = (sh - H * fit) / 2;
    inner.style.width = `${W * fit}px`; inner.style.height = `${H * fit}px`;
    apply();
  };
  const apply = () => {
    inner.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    mine.style.clipPath = `inset(0 ${(1 - pos) * 100}% 0 0)`;
    const x = tx + pos * W * fit * z;
    divider.style.left = `${x}px`;
    handle.style.left = `${x}px`;
    handle.style.top = `${clamp(ty + H * fit * z / 2, 40, stage.clientHeight - 40)}px`;
    // keep small images crisp-looking when zoomed far in
    mine.style.imageRendering = z * fit > 4 ? 'pixelated' : 'auto';
  };
  V.renderDiff = () => {
    diffLayer.replaceChildren();
    if (!V.showDiff) return;
    for (const [x0, y0, x1, y1] of r.diff_boxes) {
      diffLayer.append(h('div', { class: 'diffbox', style: { left: `${x0 / W * 100}%`, top: `${y0 / H * 100}%`, width: `${(x1 - x0) / W * 100}%`, height: `${(y1 - y0) / H * 100}%` } }));
    }
  };
  let mode = null, sx = 0, sy = 0;
  const onDown = (e) => {
    stage.setPointerCapture(e.pointerId);
    mode = e.target === handle ? 'slide' : 'pan';
    sx = e.clientX; sy = e.clientY;
    if (mode === 'pan') stage.style.cursor = 'grabbing';
  };
  const onMove = (e) => {
    if (!mode) return;
    if (mode === 'slide') {
      const b = stage.getBoundingClientRect();
      pos = clamp((e.clientX - b.left - tx) / (W * fit * z), 0, 1);
    } else {
      tx += e.clientX - sx; ty += e.clientY - sy; sx = e.clientX; sy = e.clientY;
    }
    apply();
  };
  const onUp = () => { mode = null; stage.style.cursor = ''; };
  const onWheel = (e) => {
    e.preventDefault();
    const b = stage.getBoundingClientRect();
    const cx = e.clientX - b.left, cy = e.clientY - b.top;
    const nz = clamp(z * Math.exp(-e.deltaY * 0.0015), 1, 24);
    tx = cx - (cx - tx) * nz / z; ty = cy - (cy - ty) * nz / z; z = nz;
    apply();
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('dblclick', reset);
  V.onKey = (e) => {
    if (e.code === 'Space' && saved == null) { e.preventDefault(); saved = pos; pos = 1; apply(); }
    if (e.key === 'd' || e.key === 'D') { V.showDiff = !V.showDiff; V.renderDiff(); }
  };
  V.onKeyUp = (e) => { if (e.code === 'Space' && saved != null) { pos = saved; saved = null; apply(); } };
  reset();
  const ro = new ResizeObserver(reset);
  ro.observe(stage);
  V.stageCleanup = () => ro.disconnect();
  V.renderDiff();
}

/* ---------------------------------------------------------------- crop editor */
function mountCrop(stage, r, V) {
  const j = S.job;
  const W = r.width, H = r.height;
  const wrap = h('div', { class: 'crop-wrap' });
  const img = h('img', { alt: '', src: `/api/jobs/${j.id}/results/${r.id}/file` });
  const roiEl = h('div', { class: 'crop-roi' });
  const label = h('div', { class: 'crop-size' });
  const boxEl = h('div', { class: 'crop-box' }, label, ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('div', { class: 'h', 'data-h': d })));
  wrap.append(img, roiEl, boxEl);
  const tools = h('div', { style: { position: 'absolute', left: '12px', top: '12px', display: 'flex', gap: '6px', zIndex: 3 } },
    h('button', { class: 'btn small', onclick: () => setBox(r.crop.slice()) }, r.crop_kind === 'panel' ? 'Suggested panel' : 'Suggested'),
    h('button', { class: 'btn small', onclick: () => setBox(r.roi_in_cand.slice()) }, 'Same as mine'),
    h('button', { class: 'btn small', onclick: () => setBox([0, 0, W, H]) }, 'Whole image'));
  stage.append(wrap, tools, h('div', { class: 'stage-hint' }, 'Drag the box or its handles \u00b7 the dashed blue box is your image'));
  let fit = 1, ox = 0, oy = 0;
  let box = (S.cropEdits[r.id]?.box || r.crop).slice();
  const layout = () => {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    fit = Math.min((sw - 40) / W, (sh - 70) / H);
    ox = (sw - W * fit) / 2; oy = (sh - H * fit) / 2 + 10;
    Object.assign(wrap.style, { left: `${ox}px`, top: `${oy}px`, width: `${W * fit}px`, height: `${H * fit}px` });
    const [a, b, c, d] = r.roi_in_cand;
    Object.assign(roiEl.style, { left: `${a * fit}px`, top: `${b * fit}px`, width: `${(c - a) * fit}px`, height: `${(d - b) * fit}px` });
    draw();
  };
  const draw = () => {
    Object.assign(boxEl.style, { left: `${box[0] * fit}px`, top: `${box[1] * fit}px`, width: `${(box[2] - box[0]) * fit}px`, height: `${(box[3] - box[1]) * fit}px` });
    label.textContent = `${Math.round(box[2] - box[0])} \u00d7 ${Math.round(box[3] - box[1])} px`;
  };
  const commit = () => {
    const prevFlip = S.cropEdits[r.id]?.flip ?? false;
    S.cropEdits[r.id] = { box: box.map(Math.round), flip: prevFlip };
    renderViewerSide($('.vside'), r, V);
  };
  const setBox = (b) => { box = b; draw(); commit(); };
  let drag = null;
  boxEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    boxEl.setPointerCapture(e.pointerId);
    drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, start: box.slice() };
  });
  boxEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / fit, dy = (e.clientY - drag.y) / fit;
    let [x0, y0, x1, y1] = drag.start;
    const hnd = drag.h;
    if (hnd === 'move') {
      const w = x1 - x0, hh = y1 - y0;
      x0 = clamp(x0 + dx, 0, W - w); y0 = clamp(y0 + dy, 0, H - hh); x1 = x0 + w; y1 = y0 + hh;
    } else {
      if (hnd.includes('w')) x0 = clamp(x0 + dx, 0, x1 - 8);
      if (hnd.includes('e')) x1 = clamp(x1 + dx, x0 + 8, W);
      if (hnd.includes('n')) y0 = clamp(y0 + dy, 0, y1 - 8);
      if (hnd.includes('s')) y1 = clamp(y1 + dy, y0 + 8, H);
    }
    box = [x0, y0, x1, y1];
    draw();
  });
  boxEl.addEventListener('pointerup', () => { if (drag) { drag = null; commit(); } });
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  V.stageCleanup = () => ro.disconnect();
}

/* ======================================================================= drag & drop / paste */
async function itemFromDataTransfer(dt) {
  if (!dt) return null;
  const file = [...(dt.files || [])].find((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(f.name));
  if (file) return { file };
  const htmlData = dt.getData('text/html');
  if (htmlData) {
    const m = htmlData.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && /^https?:/i.test(m[1])) return { url: m[1].replace(/&amp;/g, '&') };
  }
  const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n').find((l) => /^https?:\/\//i.test(l.trim()));
  if (uri) return { url: uri.trim() };
  return null;
}

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/html')) return;
  e.preventDefault();
  dragDepth++;
  if (S.view === 'job') $('#drop-overlay').hidden = false;
});
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  const overlay = $('#drop-overlay');
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  const item = await itemFromDataTransfer(e.dataTransfer);
  if (!item) { if (e.dataTransfer?.types?.length) toast('That did not look like an image.', 'err'); return; }
  if (S.view !== 'job') { startSearch(item); return; }
  const choice = e.target.closest?.('.drop-choice')?.dataset.action;
  if (choice === 'add') addCandidate(item);
  else if (choice === 'search' || !wasOpen) startSearch(item);
});
for (const c of document.querySelectorAll('.drop-choice')) {
  c.addEventListener('dragenter', () => c.classList.add('over'));
  c.addEventListener('dragleave', () => c.classList.remove('over'));
  c.addEventListener('drop', () => c.classList.remove('over'));
  c.addEventListener('click', () => {
    $('#drop-overlay').hidden = true;
    const item = S.pending; S.pending = null;
    if (!item) return;
    if (c.dataset.action === 'add') addCandidate(item); else startSearch(item);
  });
}
$('#drop-overlay').addEventListener('click', (e) => { if (e.target.id === 'drop-overlay') { e.currentTarget.hidden = true; S.pending = null; } });

window.addEventListener('paste', (e) => {
  if (e.target.matches?.('input, textarea')) return;
  const items = [...(e.clipboardData?.items || [])];
  const imgItem = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  let item = null;
  if (imgItem) item = { file: imgItem.getAsFile() };
  else {
    const text = (e.clipboardData?.getData('text/plain') || '').trim();
    if (/^https?:\/\/\S+$/i.test(text)) item = { url: text };
  }
  if (!item) return;
  e.preventDefault();
  if (S.view === 'job') { S.pending = item; $('#drop-overlay').hidden = false; }
  else startSearch(item);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#drop-overlay').hidden) { $('#drop-overlay').hidden = true; S.pending = null; }
});
