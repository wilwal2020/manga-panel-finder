'use strict';

/* ===================================================================== DOM helpers */
const NS = 'http://www.w3.org/2000/svg';
const $ = (sel, el = document) => el.querySelector(sel);

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
}
function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === true) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}
function h(tag, attrs, ...kids) { const el = document.createElement(tag); setAttrs(el, attrs); append(el, kids); return el; }
function sv(tag, attrs, ...kids) { const el = document.createElementNS(NS, tag); setAttrs(el, attrs); append(el, kids); return el; }

const ICONS = {
  upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4"/><path d="M12 17v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.01"/>',
  external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  focus: '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  arrows: '<path d="m9 7-5 5 5 5"/><path d="m15 7 5 5-5 5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  flip: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5z"/><path d="m16 7 5 5-5 5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
};
function icon(name, size = 18) {
  const s = document.createElementNS(NS, 'svg');
  setAttrs(s, { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ic' });
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* ===================================================================== api + small utils */
async function req(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, opt);
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error((data && (data.detail || data.message)) || `Something went wrong (${r.status})`);
  return data;
}
const api = { get: (u) => req('GET', u), post: (u, b) => req('POST', u, b ?? {}), form: (u, fd) => req('POST', u, fd), del: (u) => req('DELETE', u) };

function toast(msg, kind = 'info', ms = 4200) {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info', 17), h('span', null, msg));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (x) => `${Math.round(x * 100)}%`;
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isWeb = (u) => /^https?:\/\//i.test(u || '');
function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}
function download(url) { const a = h('a', { href: url, download: '' }); document.body.append(a); a.click(); a.remove(); }

function seg(options, value, onChange, label) {
  const el = h('div', { class: 'seg', role: 'tablist', 'aria-label': label || null });
  for (const [v, text] of options) {
    el.append(h('button', { type: 'button', role: 'tab', 'data-v': v, class: v === value ? 'on' : null, 'aria-selected': String(v === value),
      onclick: () => { setSeg(el, v); onChange(v); } }, text));
  }
  return el;
}
function setSeg(el, v) {
  for (const b of el.children) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
}

/* ===================================================================== state + routing */
const S = {
  view: '', jobId: null, job: null, byId: {}, timer: null,
  sel: null, media: 'result', filter: 'all', sort: 'best', cropEdits: {},
  heroSig: '', heroCleanup: null, headSig: '', detailsOpen: false,
  uploadFile: null, uploadB64: '', pending: null, settings: null, viewer: null, modal: null,
};
const PICKS = [['best', 'Sharpest'], ['same_text', 'Same lettering'], ['complete', 'Least cropped']];

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => { route(); loadSettings(); });
$('#nav-settings').addEventListener('click', openSettings);

async function loadSettings() { try { S.settings = await api.get('/api/settings'); } catch { /* server starting */ } }

function route() {
  stopPolling();
  closeViewer();
  closeModal();
  closeFloating();
  const hash = location.hash || '#/';
  $('#nav-new').classList.toggle('active', hash === '#/' || hash === '#');
  $('#nav-history').classList.toggle('active', hash === '#/history');
  window.scrollTo(0, 0);
  if (hash.startsWith('#/job/')) showJob(hash.slice(6));
  else if (hash === '#/history') showHistory();
  else showStart();
}

/* ===================================================================== start page */
function showStart() {
  S.view = 'start'; S.jobId = null; S.job = null;
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => e.target.files[0] && startSearch({ file: e.target.files[0] }) });
  const drop = h('div', { class: 'drop', role: 'button', tabindex: 0, 'aria-label': 'Choose an image to search',
    onclick: () => file.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } },
  h('div', { class: 'drop-icon' }, icon('upload', 28)),
  h('div', { class: 'drop-title' }, 'Drop a page or panel'),
  h('div', { class: 'drop-sub' }, 'or ', h('u', null, 'choose a file'), ' \u00b7 or paste with ', h('kbd', null, 'Ctrl'), h('kbd', null, 'V')));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  const link = h('input', { type: 'url', placeholder: 'Or paste a link to an image', 'aria-label': 'Image link' });
  const form = h('form', { class: 'linkform', onsubmit: (e) => { e.preventDefault(); const u = link.value.trim(); if (u) startSearch({ url: u }); } },
    h('span', { class: 'lf-icon' }, icon('link', 16)), link, h('button', { class: 'btn', type: 'submit' }, 'Search'));
  const cards = h('div', { class: 'jobcards' });
  const recent = h('section', { class: 'recent', hidden: true },
    h('div', { class: 'section-head' }, h('h2', null, 'Recent searches'), h('a', { href: '#/history', class: 'link-btn' }, 'See all')), cards);
  $('#view').replaceChildren(h('section', { class: 'start' },
    h('h1', null, 'Find a better version of any manga panel'),
    h('p', { class: 'lede' }, 'Drop the page or panel you saved. Panel Finder looks for sharper, less cropped copies online and checks that each one really is your panel.'),
    drop, file, form, recent));
  fillJobCards(cards, 6).then((n) => { recent.hidden = !n; });
}

async function startSearch({ file, url }) {
  const fd = new FormData();
  if (file) fd.append('file', file, file.name || 'pasted-image.png'); else fd.append('url', url);
  try {
    const r = await api.form('/api/search', fd);
    location.hash = `#/job/${r.id}`;
  } catch (e) { toast(e.message, 'err', 7000); }
}

/* ===================================================================== history */
function jobTitle(j) {
  const id = j.identification || {};
  if (id.title) return `${id.title}${id.chapter ? ` \u00b7 Chapter ${id.chapter}` : ''}`;
  const n = (j.query?.name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return n && !/^(pasted-image|image|blob)$/i.test(n) ? n : 'Untitled image';
}

function jobCard(j, onDelete) {
  const title = jobTitle(j);
  let sub;
  if (j.status === 'running') sub = 'Searching\u2026';
  else if (!j.count) sub = 'No copies found';
  else if (j.best && j.best.detail >= 1.08) sub = h('span', null, plural(j.count, 'version'), ' \u00b7 ', h('span', { class: 'jc-best' }, `${j.best.detail.toFixed(1)}\u00d7 sharper`));
  else sub = plural(j.count, 'version');
  const card = h('a', { class: 'jobcard', href: `#/job/${j.id}` },
    h('div', { class: 'jc-img', style: { backgroundImage: `url(/api/jobs/${j.id}/query_thumb)` } }),
    h('div', { class: 'jc-body' }, h('div', { class: 'jc-title', title }, title), h('div', { class: 'jc-sub' }, sub), h('div', { class: 'jc-sub' }, ago(j.created))));
  if (onDelete) {
    card.append(h('button', { class: 'btn btn-sm btn-icon jc-del', type: 'button', title: 'Delete this search', 'aria-label': `Delete search ${title}`,
      onclick: async (e) => { e.preventDefault(); e.stopPropagation(); try { await api.del(`/api/jobs/${j.id}`); onDelete(); } catch (err) { toast(err.message, 'err'); } } }, icon('trash', 16)));
  }
  return card;
}

async function fillJobCards(container, limit) {
  let list = [];
  try { list = await api.get('/api/jobs'); } catch { /* ignore */ }
  if (limit) list = list.slice(0, limit);
  const again = () => fillJobCards(container, limit);
  container.replaceChildren(...(list.length ? list.map((j) => jobCard(j, limit ? null : again)) : [h('div', { class: 'empty-note' }, 'No searches yet.')]));
  return list.length;
}

function showHistory() {
  S.view = 'history';
  const cards = h('div', { class: 'jobcards' });
  $('#view').replaceChildren(h('div', { class: 'page history-page' },
    h('div', { class: 'section-head', style: { marginBottom: '22px' } }, h('h1', null, 'History'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
        if (!confirm('Delete all saved searches and the images they downloaded?')) return;
        await api.del('/api/jobs'); fillJobCards(cards);
      } }, icon('trash', 16), 'Delete all')),
    cards));
  fillJobCards(cards);
}

/* ===================================================================== job page */
async function showJob(id) {
  Object.assign(S, { view: 'job', jobId: id, job: null, byId: {}, sel: null, media: 'result', filter: 'all', sort: 'best',
    cropEdits: {}, heroSig: '', headSig: '', detailsOpen: false, uploadFile: null, uploadB64: '', cmpViews: {} });
  S.heroCleanup?.(); S.heroCleanup = null;
  const left = h('aside', { class: 'split-left', onscroll: closeFloating },
    h('header', { class: 'jobhead' },
      h('button', { class: 'qthumb', id: 'qthumb', title: 'Your image \u2014 click to focus on one panel', 'aria-label': 'Your image. Focus on one panel', onclick: openFocusPicker }),
      h('div', { class: 'jobtitle' }, h('h1', { id: 'job-title' }, '\u00a0'), h('div', { class: 'jobsub', id: 'job-sub' })),
      h('div', { class: 'jobactions' },
        h('button', { class: 'status-pill', id: 'status-pill', type: 'button', 'aria-haspopup': 'dialog', onclick: toggleDetails }),
        h('button', { class: 'btn btn-icon btn-ghost', type: 'button', title: 'More', 'aria-label': 'More actions', onclick: (e) => openMenu(e.currentTarget, jobMenu()) }, icon('more')))),
    h('div', { class: 'progress-line', id: 'progress-line' }),
    h('section', { class: 'hero', id: 'hero', 'aria-label': 'Best version' }),
    h('section', { class: 'versions', id: 'versions', hidden: true },
      h('div', { class: 'section-head' },
        h('h2', null, 'All versions', h('span', { class: 'count', id: 'v-count' })),
        h('select', { 'aria-label': 'Sort versions', onchange: (e) => { S.sort = e.target.value; renderTiles(S.job); } },
          h('option', { value: 'best' }, 'Best match first'), h('option', { value: 'sharp' }, 'Sharpest first'), h('option', { value: 'size' }, 'Largest first'),
          h('option', { value: 'complete' }, 'Least cropped first'), h('option', { value: 'new' }, 'Newest first'))),
      seg([['all', 'All'], ['same', 'Same lettering'], ['sharper', 'Sharper than yours']], S.filter, (v) => { S.filter = v; renderTiles(S.job); }, 'Filter versions'),
      h('div', { class: 'tiles', id: 'tiles' })),
    buildMore());
  const right = h('section', { class: 'split-right', id: 'media-pane', 'aria-label': 'Preview' });
  $('#view').replaceChildren(h('div', { class: 'split' }, left, right));
  try {
    const j = await api.get(`/api/jobs/${id}`);
    if (S.jobId !== id) return;
    update(j);
    prefetchUpload(id);
    if (needsPoll(j)) schedulePoll();
  } catch (e) {
    $('.split')?.classList.add('no-media');
    $('#hero').replaceChildren(h('div', { class: 'hero-empty' }, h('div', { class: 'empty-icon' }, icon('alert', 26)),
      h('h2', null, 'Could not open this search'), h('p', null, e.message), h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/' }, 'New search'))));
  }
}

const needsPoll = (j) => j.status === 'running' || j.sites?.state === 'running';
function schedulePoll() { stopPolling(); S.timer = setTimeout(poll, 900); }
function stopPolling() { clearTimeout(S.timer); S.timer = null; }
async function poll() {
  if (S.view !== 'job') return;
  const id = S.jobId;
  try {
    const j = await api.get(`/api/jobs/${id}`);
    if (S.jobId !== id) return;
    const was = S.job && needsPoll(S.job);
    update(j);
    if (needsPoll(j)) schedulePoll();
    else if (was && j.status === 'done') {
      const n = j.results.length;
      toast(n ? `Search finished \u2014 ${plural(n, 'version')} of your image found.` : 'Search finished. No copies of your image turned up.', n ? 'ok' : 'info');
    }
  } catch { schedulePoll(); }
}
async function refresh() {
  const j = await api.get(`/api/jobs/${S.jobId}`);
  S.heroSig = ''; S.headSig = '';
  update(j);
  if (needsPoll(j)) schedulePoll();
}

function update(j) {
  if (!j || S.view !== 'job' || j.id !== S.jobId) return;
  S.job = j;
  S.byId = Object.fromEntries(j.results.map((r) => [r.id, r]));
  renderHead(j);
  renderHero(j);
  renderTiles(j);
  renderMore(j);
  if (S.detailsOpen) renderDetails(j);
}

async function prefetchUpload(id) {
  try {
    const blob = await (await fetch(`/api/jobs/${id}/upload.jpg`)).blob();
    S.uploadFile = new File([blob], 'image.jpg', { type: 'image/jpeg' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    S.uploadB64 = btoa(bin);
  } catch { /* the "search other sites" buttons will say so */ }
}

/* ---------------------------------------------------------------- header */
function renderHead(j) {
  const q = j.query;
  const c = j.counters || {};
  const running = j.status === 'running';
  const pill = $('#status-pill');
  if (running) pill.replaceChildren(h('span', { class: 'spinner' }), `Searching \u00b7 ${c.checked || 0} checked`);
  else if (j.sites?.state === 'running') pill.replaceChildren(h('span', { class: 'spinner' }), 'Checking manga sites');
  else if (j.status === 'error') pill.replaceChildren(icon('alert', 16), 'Search stopped');
  else pill.replaceChildren(h('span', { class: 'ok' }, icon('check', 16)), j.results.length ? `${plural(j.results.length, 'version')} found` : 'Search finished');
  pill.title = 'Search details';
  $('#progress-line').classList.toggle('running', needsPoll(j));

  const sig = JSON.stringify([jobTitle(j), j.roi, q.width, j.identification?.source]);
  if (sig === S.headSig) return;
  S.headSig = sig;
  const title = $('#job-title');
  title.textContent = jobTitle(j);
  title.title = j.identification?.source ? `Guessed from ${j.identification.source}` : '';
  const sub = [h('span', null, `Your image \u00b7 ${q.width}\u00d7${q.height} ${q.format}`), h('span', { class: 'dot' }, '\u00b7')];
  if (j.roi) sub.push(h('span', null, 'Focused on one panel'), h('button', { class: 'link-btn', onclick: () => setRoi(null) }, 'Use whole image'));
  else sub.push(h('button', { class: 'link-btn', onclick: openFocusPicker }, 'Only want one panel?'));
  $('#job-sub').replaceChildren(...sub);

  const s = sv('svg', { viewBox: `0 0 ${q.width} ${q.height}`, preserveAspectRatio: 'xMidYMid meet' },
    sv('image', { href: `/api/jobs/${j.id}/query_thumb`, x: 0, y: 0, width: q.width, height: q.height, preserveAspectRatio: 'none' }));
  if (j.roi) {
    const [x0, y0, x1, y1] = j.roi;
    s.append(sv('path', { d: `M0 0H${q.width}V${q.height}H0Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`, fill: 'rgba(0,0,0,.6)', 'fill-rule': 'evenodd' }),
      sv('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'none', stroke: '#ff8a5b', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }
  $('#qthumb').replaceChildren(s);
}

function jobMenu() {
  const j = S.job;
  return [
    { icon: 'refresh', label: 'Search again', onClick: rerun },
    j?.roi ? { icon: 'focus', label: 'Use the whole image again', onClick: () => setRoi(null) } : { icon: 'focus', label: 'Focus on one panel\u2026', onClick: openFocusPicker },
    { icon: 'image', label: 'Open my image', onClick: () => window.open(`/api/jobs/${S.jobId}/query`, '_blank') },
    '-',
    { icon: 'trash', label: 'Delete this search', danger: true, onClick: async () => {
      if (!confirm('Delete this search and the images it downloaded?')) return;
      try { await api.del(`/api/jobs/${S.jobId}`); location.hash = '#/'; } catch (e) { toast(e.message, 'err'); }
    } },
  ];
}

function toggleDetails() {
  const anchor = $('#status-pill');
  if (S.floating?.anchor === anchor) { closeFloating(); return; }
  closeFloating();
  const el = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Search details' });
  $('#layer').append(el);
  S.floating = { el, anchor, onClose: () => { S.detailsOpen = false; } };
  S.detailsOpen = true;
  renderDetails(S.job);
  placeFloating(el, anchor);
}

function renderDetails(j) {
  const el = S.floating?.el;
  if (!el || !j) return;
  const rows = Object.entries(j.engines || {}).map(([name, e]) => {
    let st = e.error || 'off', cls = '';
    if (e.state === 'running') st = 'searching\u2026';
    else if (e.state === 'done') { st = plural(e.found || 0, 'result'); cls = 'ok'; }
    else if (e.state === 'error') cls = 'err';
    return h('div', { class: 'erow' }, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, name) : h('span', null, name), h('span', { class: `st ${cls}` }, st));
  });
  const c = j.counters || {};
  const log = h('ol', null, (j.log || []).map((l) => h('li', null, `${String(Math.round(l.t)).padStart(3)}s  ${l.msg}`)));
  const open = el.querySelector('details')?.open;
  el.replaceChildren(h('h4', null, 'Where it searched'), ...rows,
    h('div', { class: 'erow' }, h('span', null, 'Images checked'), h('span', { class: 'st' }, `${c.checked || 0} checked \u00b7 ${c.matched || 0} matched`)),
    h('details', { open: open || null }, h('summary', null, 'Activity log'), log));
}

/* ---------------------------------------------------------------- hero (the answer) */
function pickOf(j, id) { for (const [k] of PICKS) if (j.picks?.[k] === id) return k; return null; }

function selection(j) {
  if (S.sel?.pick) { const id = j.picks?.[S.sel.pick]; if (id && S.byId[id]) return { r: S.byId[id], pick: S.sel.pick }; }
  if (S.sel?.id && S.byId[S.sel.id]) return { r: S.byId[S.sel.id], pick: pickOf(j, S.sel.id) };
  const id = j.picks?.best;
  return id && S.byId[id] ? { r: S.byId[id], pick: 'best' } : null;
}

function detailInfo(d) {
  if (d >= 1.08) return { num: `${d >= 10 ? d.toFixed(0) : d.toFixed(1)}\u00d7`, label: 'sharper than yours', cls: 'up' };
  if (d >= 0.93) return { num: '\u2248 1\u00d7', label: 'about as sharp as yours', cls: 'same' };
  return { num: `${d.toFixed(1)}\u00d7`, label: 'as sharp as yours', cls: 'down' };
}

function notesFor(r, j) {
  const out = [];
  const same = j.picks?.same_text;
  if (r.coverage < 0.6) {
    out.push({ kind: 'warn', text: `Only shows part of your image (${pct(r.coverage)}), probably one page or panel.`,
      action: r.overlap_in_query && !j.roi ? ['Focus on that panel', () => setRoi(r.overlap_in_query)] : null });
  } else if (r.coverage < 0.97) {
    out.push({ kind: 'warn', text: `Cropped tighter than yours \u2014 shows ${pct(r.coverage)} of it.` });
  }
  if (r.text_differs === true) {
    out.push({ kind: 'warn', text: 'Lettering differs from yours (another language or a raw).',
      action: same && same !== r.id ? ['Show same lettering', () => choosePick('same_text')] : null });
  }
  if (r.upscaled) out.push({ kind: 'warn', text: 'Looks upscaled: bigger, but not really sharper.' });
  else if (r.sharpness === 'soft') out.push({ kind: 'warn', text: 'Lines look soft or blurry.' });
  if (r.more_visible >= 0.05) out.push({ kind: 'good', text: `Shows ${Math.round(r.more_visible * 100)}% more of the ${j.roi ? 'panel' : 'image'} than yours.` });
  if (r.mirrored) out.push({ kind: 'warn', text: 'Mirrored compared to yours.' });
  if (r.colored) out.push({ kind: 'info', text: 'Already colored.' });
  if (r.jpeg_quality && r.jpeg_quality < 70) out.push({ kind: 'warn', text: `Heavily compressed JPEG (quality ${r.jpeg_quality}).` });
  if (r.text_differs === false) out.push({ kind: 'good', text: 'Same lettering as yours.' });
  if (r.sharpness === 'crisp' && !r.upscaled) out.push({ kind: 'good', text: 'Clean, crisp linework.' });
  return out;
}
function noteEl(n) {
  return h('li', { class: n.kind }, icon(n.kind === 'good' ? 'check' : n.kind === 'warn' ? 'alert' : 'info', 16),
    h('span', null, n.text, n.action ? h('button', { class: 'link-btn', onclick: n.action[1] }, n.action[0]) : null));
}

const cropBox = (r) => S.cropEdits[r.id]?.box || r.crop;
const cropFlip = (r) => S.cropEdits[r.id]?.flip ?? false;
function cropUrl(r, box = cropBox(r), flip = cropFlip(r)) {
  return `/api/jobs/${S.jobId}/results/${r.id}/crop?box=${box.map((v) => Math.round(v)).join(',')}&flip=${flip ? 1 : 0}`;
}
async function saveResult(r, { flip, forceDownload } = {}) {
  const box = cropBox(r);
  const f = flip ?? cropFlip(r);
  if (S.settings?.save_folder && !forceDownload) {
    try { const res = await api.post(`/api/jobs/${S.jobId}/results/${r.id}/save`, { box, flip: f }); toast(`Saved to ${res.path}`, 'ok', 6500); }
    catch (e) { toast(e.message, 'err'); }
  } else {
    download(cropUrl(r, box, f));
  }
}
function saveLabel(r) {
  const panel = r.crop_kind === 'panel' || S.cropEdits[r.id];
  return S.settings?.save_folder ? 'Save to folder' : (panel ? 'Save panel' : 'Save image');
}
function sizeNote(r) { const b = cropBox(r); return `${Math.round(b[2] - b[0])}\u00d7${Math.round(b[3] - b[1])} PNG`; }

function resultMenu(r) {
  return [
    S.settings?.save_folder ? { icon: 'download', label: 'Download PNG instead', onClick: () => saveResult(r, { forceDownload: true }) } : null,
    r.mirrored ? { icon: 'flip', label: 'Save flipped to match yours', onClick: () => saveResult(r, { flip: true }) } : null,
    { icon: 'image', label: 'Download the original file', onClick: () => download(`/api/jobs/${S.jobId}/results/${r.id}/file?dl=1`) },
    isWeb(r.page_url || r.url) ? { icon: 'external', label: 'Open where it was found', onClick: () => window.open(r.page_url || r.url, '_blank', 'noopener') } : null,
    '-',
    { icon: 'refresh', label: 'Search again using this version', onClick: () => researchWith(r) },
  ];
}

function choosePick(k) { S.sel = { pick: k }; S.heroSig = ''; renderHero(S.job); markSelected(); }

function renderHero(j) {
  const hero = $('#hero');
  const sel = selection(j);
  const mode = sel ? 'result' : (needsPoll(j) ? 'loading' : 'empty');
  const r = sel?.r;
  const sig = JSON.stringify([mode, j.status, r?.id, sel?.pick, r && Math.round(r.score * 100), r?.crop, r && S.cropEdits[r.id], j.picks, j.roi, S.media,
    mode === 'loading' ? Object.values(j.engines || {}).map((e) => e.state) : 0, mode === 'empty' ? j.status : 0, S.settings?.save_folder]);
  if (sig === S.heroSig) return;
  S.heroSig = sig;
  S.heroCleanup?.(); S.heroCleanup = null;

  const pane = $('#media-pane');
  if (mode === 'loading') { hero.replaceChildren(heroLoading(j)); pane.replaceChildren(yourImagePane(j, true)); return; }
  if (mode === 'empty') { hero.replaceChildren(heroEmpty(j)); pane.replaceChildren(yourImagePane(j, false)); return; }

  const stage = h('div', { class: 'media-stage' });
  const media = h('div', { class: 'hero-media' }, stage,
    h('div', { class: 'media-bar' }, h('span'),
      h('button', { class: 'btn btn-icon btn-overlay', type: 'button', title: 'Full screen', 'aria-label': 'Open full screen',
        onclick: () => openViewer(r.id, 'compare') }, icon('expand'))));
  // on narrow screens the preview takes the image's shape
  media.style.setProperty('--ar', `${j.query.width} / ${Math.round(j.query.height * 1.1)}`);

  const picks = [];
  const seen = new Set();
  for (const [k, label] of PICKS) { const id = j.picks?.[k]; if (id && !seen.has(id)) { seen.add(id); picks.push([k, label]); } }
  let pickBar = null;
  if (picks.length > 1) pickBar = seg(picks, sel.pick, choosePick, 'Which version');
  if (!sel.pick) pickBar = h('div', { class: 'custom-pick' }, 'A version you picked \u00b7 ', h('button', { class: 'link-btn', onclick: () => choosePick('best') }, 'back to the sharpest'));

  const di = detailInfo(r.detail);
  const src = isWeb(r.page_url || r.url)
    ? h('a', { href: r.page_url || r.url, target: '_blank', rel: 'noopener noreferrer', title: 'Open where it was found' }, r.domain)
    : h('span', null, 'added by you');
  const notes = notesFor(r, j).slice(0, 3);
  const info = h('div', { class: 'hero-info' },
    j.status === 'running' ? h('div', { class: 'sofar' }, h('span', { class: 'spinner' }), 'Best so far — still searching for better copies') : null,
    heroCallout(j, sel),
    pickBar,
    h('div', { class: 'bigstat' }, h('div', { class: `num ${di.cls}` }, di.num), h('div', { class: 'lbl' }, di.label)),
    h('div', { class: 'metaline' }, `${r.width} \u00d7 ${r.height} ${r.format}`, h('span', { class: 'dot' }, '\u00b7'), fmtBytes(r.bytes), h('span', { class: 'dot' }, '\u00b7'), src),
    notes.length ? h('ul', { class: 'notes' }, notes.map(noteEl)) : null,
    h('div', { class: 'hero-actions' },
      h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: () => saveResult(r) }, icon('download', 19), saveLabel(r), h('span', { class: 'btn-note' }, sizeNote(r))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => openViewer(r.id, 'crop') }, icon('crop', 17), 'Adjust crop'),
        h('button', { class: 'btn btn-icon', type: 'button', title: 'More options', 'aria-label': 'More options', onclick: (e) => openMenu(e.currentTarget, resultMenu(r)) }, icon('more')))));
  hero.replaceChildren(info);
  pane.replaceChildren(media);
  const tool = mountCompare(stage, r, { viewKey: 'hero' });
  S.heroTool = tool;
  S.heroCleanup = () => { tool.destroy(); S.heroTool = null; };
}

/* The right-hand pane before there is a result to show: your own image. */
function yourImagePane(j, searching) {
  const q = j.query;
  return h('div', { class: `hero-media placeholder${searching ? ' searching' : ''}`, style: { '--ar': `${q.width} / ${Math.round(q.height * 1.22)}` } },
    h('div', { class: 'media-stage', style: { padding: '70px 32px 56px' } },
      sv('svg', { viewBox: `0 0 ${q.width} ${q.height}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Your image' },
        sv('image', { href: `/api/jobs/${j.id}/query`, x: 0, y: 0, width: q.width, height: q.height, preserveAspectRatio: 'none' }))),
    h('div', { class: 'media-caption' }, searching ? 'Your image · looking for better copies…' : 'Your image'));
}

/* Tell people plainly when their copy is already the best, or when a much sharper copy of one panel exists. */
function heroCallout(j, sel) {
  if (j.status === 'running' || sel.pick !== 'best') return null;
  const best = sel.r;
  const partial = j.roi ? null : j.results
    .filter((x) => x.coverage < 0.6 && x.overlap_in_query && x.detail >= Math.max(1.5, best.detail * 1.3))
    .sort((a, b) => b.detail - a.detail)[0];
  const already = best.detail < 1.08;
  if (!partial && !already) return null;
  const kids = [];
  if (already) kids.push(h('b', null, partial ? 'Yours is the sharpest full copy online.' : 'Yours is already the sharpest copy online.'));
  if (partial) {
    kids.push(h('p', null, `${already ? 'But there’s' : 'There’s also'} a ${partial.detail.toFixed(1)}× sharper copy of part of it (${pct(partial.coverage)} of your image, probably one page or panel).`),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => setRoi(partial.overlap_in_query) }, icon('focus', 16), 'Focus on that panel'),
        h('button', { class: 'btn btn-sm', onclick: () => selectResult(partial.id) }, 'Show it')));
  } else {
    kids.push(h('p', null, 'Every copy found is the same or smaller. “Not quite it?” below has more places to look.'));
  }
  return h('div', { class: `callout${partial ? '' : ' calm'}` }, kids);
}

function heroLoading(j) {
  const rows = Object.entries(j.engines || {}).filter(([, e]) => e.state !== 'off').map(([name, e]) =>
    h('div', null, e.state === 'running' ? h('span', { class: 'spinner' }) : icon(e.state === 'done' ? 'check' : 'alert', 16), `${name}${e.state === 'done' ? ` \u2014 ${plural(e.found || 0, 'result')}` : ''}`));
  return h('div', { class: 'skeleton' },
    h('div', { class: 'sk-info' },
      h('div', { class: 'sk-line', style: { width: '42%', height: '46px', borderRadius: '10px' } }),
      h('div', { class: 'sk-line', style: { width: '70%' } }),
      h('div', { class: 'sk-line', style: { width: '55%' } }),
      h('div', { class: 'sk-engines' }, rows.length ? rows : h('div', null, h('span', { class: 'spinner' }), 'Starting\u2026'))));
}

function heroEmpty(j) {
  const err = j.status === 'error';
  return h('div', { class: 'hero-empty' },
    h('div', { class: 'empty-icon' }, icon(err ? 'alert' : 'search', 26)),
    h('h2', null, err ? 'The search stopped' : 'No copies of your image turned up'),
    h('p', null, err ? j.phase : 'That happens with rare pages and tight crops. A full page is shared far more often than a single panel, so that is worth a try \u2014 or use one of the options below.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', onclick: () => submitEngine('lens') }, icon('globe', 17), 'Try Google Lens'),
      h('button', { class: 'btn', onclick: () => { $('#md-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('#md-title')?.focus(), 400); } }, icon('book', 17), 'Check manga sites'),
      h('button', { class: 'btn', onclick: rerun }, icon('refresh', 17), 'Search again')));
}

/* ---------------------------------------------------------------- all versions */
function visibleResults(j) {
  let list = j.results.slice();
  if (S.filter === 'same') list = list.filter((r) => r.text_differs === false);
  if (S.filter === 'sharper') list = list.filter((r) => r.detail >= 1.08);
  const key = { best: (r) => -r.score, sharp: (r) => -r.detail, size: (r) => -(r.panel_px[0] * r.panel_px[1]), complete: (r) => -(r.more_visible * 10 + r.score / 1000), new: (r) => -r.added }[S.sort];
  return list.sort((a, b) => key(a) - key(b));
}

function tileSig(r) { return [r.id, r.detail.toFixed(2), r.text_differs, r.colored, r.mirrored, r.upscaled].join('|'); }
function buildTile(r) {
  const di = detailInfo(r.detail);
  const flags = [];
  if (r.coverage < 0.9) flags.push(h('span', { class: 'flag', title: `Shows only ${pct(r.coverage)} of your image` }, 'Part'));
  if (r.text_differs === true) flags.push(h('span', { class: 'flag warn', title: 'Lettering differs from yours' }, 'A\u3042'));
  if (r.upscaled) flags.push(h('span', { class: 'flag warn', title: 'Looks upscaled' }, 'Upscaled'));
  if (r.colored) flags.push(h('span', { class: 'flag', title: 'Already colored' }, 'Color'));
  if (r.mirrored) flags.push(h('span', { class: 'flag', title: 'Mirrored' }, '\u21c6'));
  const tip = [`${r.width}\u00d7${r.height} ${r.format} from ${r.domain}`, `${di.num} ${di.label}`, ...notesFor(r, S.job).map((n) => n.text)].join('\n');
  return h('button', { class: 'tile', type: 'button', 'data-id': r.id, 'data-sig': tileSig(r), title: tip, onclick: () => selectResult(r.id) },
    h('div', { class: 'tile-img' }, h('img', { src: `/api/jobs/${S.jobId}/results/${r.id}/thumb`, alt: `${r.width} by ${r.height} version from ${r.domain}`, loading: 'lazy', decoding: 'async' })),
    h('div', { class: 'tile-meta' }, h('span', { class: `tile-detail ${di.cls}` }, di.num), h('span', { class: 'tile-size' }, `${r.width}\u00d7${r.height}`), flags.length ? h('span', { class: 'flags' }, flags) : null));
}

function renderTiles(j) {
  const section = $('#versions');
  if (!section) return;
  section.hidden = !j.results.length;
  if (!j.results.length) return;
  const list = visibleResults(j);
  const grid = $('#tiles');
  const old = new Map([...grid.querySelectorAll('.tile')].map((el) => [el.dataset.id, el]));
  const kids = list.map((r) => { const el = old.get(r.id); return el && el.dataset.sig === tileSig(r) ? el : buildTile(r); });
  if (!kids.length) kids.push(h('div', { class: 'empty-note' }, S.filter === 'same' ? 'None of the versions have the same lettering as yours.' : 'None of the versions are sharper than yours.'));
  grid.replaceChildren(...kids);
  $('#v-count').textContent = list.length === j.results.length ? String(j.results.length) : `${list.length} of ${j.results.length}`;
  markSelected();
}
function markSelected() {
  const id = S.job && selection(S.job)?.r.id;
  for (const el of document.querySelectorAll('.tile')) el.classList.toggle('selected', el.dataset.id === id);
}
function selectResult(id) {
  const k = pickOf(S.job, id);
  S.sel = k ? { pick: k } : { id };
  S.heroSig = '';
  renderHero(S.job);
  markSelected();
  // on narrow screens the image sits above the list, so bring it into view
  if (matchMedia('(max-width: 900px)').matches) $('#media-pane').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------------------------------------------------------- "not quite it?" */
function buildMore() {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => e.target.files[0] && addCandidate({ file: e.target.files[0] }) });
  const zone = h('div', { class: 'addzone', role: 'button', tabindex: 0, onclick: () => file.click(), onkeydown: (e) => { if (e.key === 'Enter') file.click(); } },
    'Drop an image here or ', h('u', null, 'choose a file'));
  for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('over');
    $('#drop-overlay').hidden = true; dragDepth = 0;
    const item = await itemFromDataTransfer(e.dataTransfer);
    if (item) addCandidate(item);
  });
  const link = h('input', { type: 'url', placeholder: 'Paste an image link', 'aria-label': 'Image link to check' });
  const linkForm = h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); const u = link.value.trim(); if (u) { addCandidate({ url: u }); link.value = ''; } } },
    link, h('button', { class: 'btn', type: 'submit' }, 'Check'));

  const eb = (label, fn) => h('button', { class: 'btn btn-sm btn-outline', type: 'button', onclick: fn }, label);
  const title = h('input', { type: 'text', id: 'md-title', placeholder: 'Manga title', 'aria-label': 'Manga title' });
  const ch = h('input', { type: 'text', id: 'md-ch', placeholder: 'Ch.', 'aria-label': 'Chapter number' });
  title.addEventListener('input', () => { title.dataset.touched = 1; });
  ch.addEventListener('input', () => { ch.dataset.touched = 1; });
  const mdForm = h('form', { class: 'mdform', onsubmit: (e) => { e.preventDefault(); runSites(); } }, title, ch, h('button', { class: 'btn', type: 'submit', id: 'md-go' }, 'Check'));

  return h('section', { class: 'more', id: 'more' },
    h('div', { class: 'section-head' }, h('h2', null, 'Not quite it?'), h('p', { class: 'muted' }, 'More ways to find a better copy of your image.')),
    h('div', { class: 'more-grid' },
      h('div', { class: 'more-card' }, h('h3', null, icon('globe', 18), 'Search other sites'),
        h('p', null, 'Google Lens and Bing can\u2019t be searched automatically. These open them in a new tab with your image already uploaded.'),
        h('div', { class: 'engine-btns' },
          eb('Google Lens', () => submitEngine('lens')), eb('Bing', () => submitEngine('bing')),
          eb('Yandex', () => { const u = S.job?.engines?.Yandex?.url; if (u) window.open(u, '_blank', 'noopener'); else submitEngine('yandex'); }),
          eb('SauceNAO', () => submitEngine('saucenao')),
          eb('TinEye', () => window.open(S.job?.engines?.TinEye?.url || 'https://tineye.com/', '_blank', 'noopener')))),
      h('div', { class: 'more-card' }, h('h3', null, icon('plus', 18), 'Check a version you found'),
        h('p', null, 'Found something better yourself? It\u2019s matched against your image and added to the list.'), zone, file, linkForm),
      h('div', { class: 'more-card' }, h('h3', null, icon('book', 18), 'Check manga sites'),
        h('p', null, 'Opens the chapter on WeebCentral, Mangapill and MangaDex and finds your page there. Runs by itself when the chapter can be worked out.'), mdForm, h('div', { class: 'mdstatus', id: 'md-status' }))));
}

function renderMore(j) {
  const id = j.identification || {};
  const title = $('#md-title'), ch = $('#md-ch');
  if (title && id.title && !title.dataset.touched) title.value = id.title;
  if (ch && id.chapter && !ch.dataset.touched) ch.value = id.chapter;
  const sites = j.sites || {};
  const go = $('#md-go');
  if (go) { go.disabled = sites.state === 'running'; go.textContent = sites.state === 'running' ? 'Checking\u2026' : 'Check'; }
  const st = $('#md-status');
  if (!st) return;
  const kids = [];
  if (sites.message) kids.push(h('div', null, sites.message));
  if (sites.rows?.length) {
    kids.push(h('ul', { class: 'siterows' }, sites.rows.map((r) => h('li', { class: r.hit ? 'hit' : null, title: r.detail || '' },
      h('b', null, r.site), h('span', null, r.state)))));
  }
  st.replaceChildren(...kids);
}

async function runSites() {
  const title = $('#md-title').value.trim(), chapter = $('#md-ch').value.trim();
  if (!title || !chapter) { toast('Type the manga title and the chapter number first.'); return; }
  try {
    await api.post(`/api/jobs/${S.jobId}/sites`, { title, chapter });
    toast('Looking for your page on the manga sites\u2026');
    schedulePoll();
  } catch (e) { toast(e.message, 'err'); }
}

const ENGINE_FORMS = {
  lens: { action: 'https://lens.google.com/v3/upload?hl=en', file: 'encoded_image' },
  bing: { action: 'https://www.bing.com/images/search?view=detailv2&iss=sbiupload', fields: { cbir: 'sbi' }, b64: 'imageBin' },
  yandex: { action: 'https://yandex.com/images/search?rpt=imageview', file: 'upfile', fields: { prg: '1' } },
  saucenao: { action: 'https://saucenao.com/search.php', file: 'file' },
};
function submitEngine(name) {
  const cfg = ENGINE_FORMS[name];
  if (!S.uploadFile) { toast('Still preparing your image \u2014 try again in a second.'); return; }
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

async function addCandidate({ file, url }) {
  if (S.view !== 'job') return;
  const fd = new FormData();
  if (file) fd.append('file', file, file.name || 'image.png'); else fd.append('url', url);
  toast('Checking that image against yours\u2026');
  try {
    const r = await api.form(`/api/jobs/${S.jobId}/add`, fd);
    toast(r.message, r.ok ? 'ok' : 'err', 6000);
    await refresh();
    if (r.ok && r.id) selectResult(r.id);
  } catch (e) { toast(e.message, 'err'); }
}

async function rerun() {
  try {
    const blob = await (await fetch(`/api/jobs/${S.jobId}/query`)).blob();
    await startSearch({ file: new File([blob], S.job?.query?.name || 'image.png', { type: blob.type }) });
  } catch (e) { toast(e.message, 'err'); }
}
async function researchWith(r) {
  try {
    const blob = await (await fetch(`/api/jobs/${S.jobId}/results/${r.id}/file`)).blob();
    closeViewer();
    await startSearch({ file: new File([blob], `${jobTitle(S.job)} ${r.width}x${r.height}`, { type: blob.type }) });
  } catch (e) { toast(e.message, 'err'); }
}

/* ===================================================================== focus on one panel */
function openFocusPicker() {
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
    rect.hidden = !roi;
    if (roi) Object.assign(rect.style, { left: `${ox + roi[0] * fit}px`, top: `${oy + roi[1] * fit}px`, width: `${(roi[2] - roi[0]) * fit}px`, height: `${(roi[3] - roi[1]) * fit}px` });
    apply.disabled = !roi;
  };
  const toImg = (e) => { const b = stage.getBoundingClientRect(); return [clamp((e.clientX - b.left - ox) / fit, 0, q.width), clamp((e.clientY - b.top - oy) / fit, 0, q.height)]; };
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); start = toImg(e); roi = [...start, ...start]; draw(); });
  stage.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = toImg(e);
    roi = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.max(start[0], p[0]), Math.max(start[1], p[1])];
    draw();
  });
  stage.addEventListener('pointerup', () => { start = null; if (roi && (roi[2] - roi[0] < 6 || roi[3] - roi[1] < 6)) roi = null; draw(); });
  const apply = h('button', { class: 'btn btn-primary', onclick: () => { closeModal(); setRoi(roi); } }, 'Focus on this panel');
  openModal({
    title: 'Which panel do you want?', wide: true,
    body: [h('p', { class: 'muted', style: { margin: 0 } }, 'Drag a box around it. The versions are re-ranked for that panel, and the crops snap to its borders.'), stage],
    foot: [j.roi ? h('button', { class: 'btn btn-ghost spacer', onclick: () => { closeModal(); setRoi(null); } }, 'Use the whole image') : null,
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), apply],
  });
  layout();
  img.addEventListener('load', layout);
}

async function setRoi(roi) {
  toast(roi ? 'Re-ranking for that panel\u2026' : 'Back to the whole image\u2026');
  try {
    const j = await api.post(`/api/jobs/${S.jobId}/roi`, { roi });
    S.cropEdits = {}; S.heroSig = ''; S.headSig = '';
    update(j);
  } catch (e) { toast(e.message, 'err'); }
}

/* ===================================================================== floating menus, popovers, modals */
function placeFloating(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = `${r.bottom + scrollY + 8}px`;
  el.style.left = `${clamp(r.right + scrollX - w, scrollX + 8, scrollX + innerWidth - w - 8)}px`;
}
function openMenu(anchor, items) {
  if (S.floating?.anchor === anchor) { closeFloating(); return; }
  closeFloating();
  const el = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => (it === '-' ? h('hr') :
    h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : null, onclick: () => { closeFloating(); it.onClick(); } }, icon(it.icon, 17), it.label))));
  (S.viewer ? S.viewer.el : $('#layer')).append(el);
  if (S.viewer) el.style.position = 'fixed';
  placeFloating(el, anchor);
  if (S.viewer) { const r = anchor.getBoundingClientRect(); el.style.top = `${r.bottom + 8}px`; el.style.left = `${clamp(r.right - el.offsetWidth, 8, innerWidth - el.offsetWidth - 8)}px`; }
  S.floating = { el, anchor };
  el.querySelector('button')?.focus();
}
function closeFloating() {
  if (!S.floating) return;
  S.floating.el.remove();
  S.floating.onClose?.();
  S.floating = null;
}
document.addEventListener('pointerdown', (e) => {
  if (S.floating && !S.floating.el.contains(e.target) && !S.floating.anchor.contains(e.target)) closeFloating();
});
window.addEventListener('resize', closeFloating);

function openModal({ title, body, foot, wide }) {
  closeModal();
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) closeModal(); } },
    h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn btn-icon btn-ghost', 'aria-label': 'Close', onclick: closeModal }, icon('x'))),
      h('div', { class: 'modal-body' }, body),
      foot ? h('div', { class: 'modal-foot' }, foot) : null));
  $('#layer').append(back);
  S.modal = back;
}
function closeModal() { S.modal?.remove(); S.modal = null; }

/* ===================================================================== settings */
async function openSettings() {
  let s;
  try { s = await api.get('/api/settings'); } catch (e) { toast(e.message, 'err'); return; }
  const f = {};
  const field = (key, label, input, help) => { f[key] = input; return h('div', { class: 'field' }, h('label', { for: `set-${key}` }, label), input, help ? h('div', { class: 'help' }, help) : null); };
  const check = (key, label) => { const i = h('input', { type: 'checkbox', checked: s[key] || null }); f[key] = i; return h('label', { class: 'check' }, i, label); };
  const inp = (key, attrs) => h('input', { id: `set-${key}`, ...attrs });
  const save = async () => {
    const out = {};
    for (const [k, el] of Object.entries(f)) out[k] = el.type === 'checkbox' ? el.checked : el.value;
    try {
      const r = await api.post('/api/settings', out);
      S.settings = r.settings;
      if (r.warning) { toast(r.warning, 'err'); return; }
      toast('Settings saved.', 'ok');
      closeModal();
      S.heroSig = '';
      if (S.job) renderHero(S.job);
    } catch (e) { toast(e.message, 'err'); }
  };
  openModal({
    title: 'Settings',
    body: [
      h('div', { class: 'fgroup' }, h('div', { class: 'glabel' }, 'Saving'),
        field('save_folder', 'Save straight to a folder', inp('save_folder', { type: 'text', value: s.save_folder || '', placeholder: 'e.g. C:\\Users\\you\\Pictures\\to color' }),
          'Optional. When set, \u201cSave\u201d puts the PNG straight in this folder. Leave empty to use your Downloads.')),
      h('div', { class: 'fgroup' }, h('div', { class: 'glabel' }, 'Searching'),
        h('div', { class: 'row-gap' }, check('use_yandex', 'Yandex'), check('use_tineye', 'TinEye'), check('use_saucenao', 'SauceNAO')),
        check('second_round', 'Search again with the best full page found (finds much bigger copies)'),
        check('auto_sites', 'Check manga sites automatically when the chapter can be worked out'),
        h('div', { class: 'row-gap' }, check('use_weebcentral', 'WeebCentral'), check('use_mangapill', 'Mangapill'), check('use_mangadex', 'MangaDex')),
        field('saucenao_key', 'SauceNAO key', inp('saucenao_key', { type: 'password', value: s.saucenao_key || '', placeholder: 'Optional \u2014 paste your free key', autocomplete: 'off' }),
          h('span', null, 'Recognises the manga, chapter and page. Make a free account at ', h('a', { href: 'https://saucenao.com/user.php', target: '_blank', rel: 'noopener' }, 'saucenao.com'),
            ' and copy the key from ', h('a', { href: 'https://saucenao.com/user.php?page=search-api', target: '_blank', rel: 'noopener' }, 'its API page'), '.'))),
      h('div', { class: 'fgroup' }, h('div', { class: 'glabel' }, 'Advanced'),
        field('max_checks', 'Images to check per search round', inp('max_checks', { type: 'number', min: 5, max: 200, value: s.max_checks }), 'More finds more versions but takes longer. 60 is a good balance.'),
        field('mangadex_languages', 'MangaDex languages', inp('mangadex_languages', { type: 'text', value: s.mangadex_languages || '', placeholder: 'All languages' }), 'Language codes separated by commas, e.g. en, ja.')),
    ],
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, 'Save settings')],
  });
}

/* ===================================================================== compare view
   Shows the version lined up with your image. Scroll to zoom, drag to move (when zoomed),
   press and hold (or Space) to see your original in its place. Zoom and position are kept per
   `viewKey`, so flipping through versions shows the same spot of the page every time. */
function mountCompare(host, r, { viewKey = 'hero' } = {}) {
  const j = S.job, q = j.query, W = q.width, H = q.height;
  const root = h('div', { class: 'cmp' });
  const inner = h('div', { class: 'cmp-inner' });
  const cand = h('img', { alt: 'This version, lined up with yours', src: `/api/jobs/${j.id}/results/${r.id}/aligned`, draggable: 'false' });
  const mine = h('img', { alt: 'Your image', class: 'cmp-mine', src: `/api/jobs/${j.id}/query`, draggable: 'false' });
  const diffLayer = h('div', { style: { position: 'absolute', inset: '0' } });
  inner.append(cand, mine, diffLayer);
  const tag = h('div', { class: 'cmp-tag l' });
  const zoomBtn = h('button', { class: 'cmp-zoom', type: 'button', title: 'Fit to screen (double-click)', hidden: true, onclick: (e) => { e.stopPropagation(); fitView(); } });
  const loading = h('div', { class: 'cmp-loading' }, h('span', { class: 'spinner' }));
  root.append(loading, inner, tag, zoomBtn);
  host.append(root);
  cand.addEventListener('load', () => loading.remove());
  cand.addEventListener('error', () => loading.replaceChildren('Could not line this version up with yours.'));

  S.cmpViews = S.cmpViews || {};
  let fit = 1, z = 1, tx = 0, ty = 0, held = false, peeking = false, down = null;
  const zoomed = () => z > 1.001;

  const showMine = () => {
    const on = held || peeking;
    mine.style.opacity = on ? '1' : '0';
    root.classList.toggle('showing-mine', on);
    tag.replaceChildren(on ? 'Yours' : 'This version', h('span', null, on ? ' · let go to see this version' : ' · hold to see yours'));
  };
  const apply = () => {
    inner.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    mine.style.imageRendering = z * fit > 4 ? 'pixelated' : 'auto';
    root.classList.toggle('zoomed', zoomed());
    zoomBtn.hidden = !zoomed();
    zoomBtn.textContent = `${Math.round(z * 100)}% · Fit`;
    // remember which point of the image is in the middle, so the next version opens at the same spot
    const cx = root.clientWidth / 2, cy = root.clientHeight / 2;
    S.cmpViews[viewKey] = { z, u: (cx - tx) / (W * fit * z), v: (cy - ty) / (H * fit * z) };
  };
  const layout = () => {
    const sw = root.clientWidth, sh = root.clientHeight;
    if (!sw || !sh) return;
    fit = Math.min((sw - 56) / W, (sh - 56) / H);
    inner.style.width = `${W * fit}px`; inner.style.height = `${H * fit}px`;
    const saved = S.cmpViews[viewKey];
    if (saved && saved.z > 1.001) {
      z = saved.z;
      tx = sw / 2 - saved.u * W * fit * z;
      ty = sh / 2 - saved.v * H * fit * z;
    } else {
      z = 1; tx = (sw - W * fit) / 2; ty = (sh - H * fit) / 2;
    }
    apply();
  };
  const fitView = () => { delete S.cmpViews[viewKey]; layout(); };

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target === zoomBtn) return;
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, timer: null };
    // zoomed in, a press might become a drag: wait a moment before swapping images
    if (zoomed()) down.timer = setTimeout(() => { held = true; showMine(); }, 120);
    else { held = true; showMine(); }
  });
  root.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
      down.moved = true;
      if (zoomed()) { clearTimeout(down.timer); root.classList.add('dragging'); }
    }
    if (down.moved && zoomed()) { tx += e.clientX - down.lx; ty += e.clientY - down.ly; apply(); }
    down.lx = e.clientX; down.ly = e.clientY;
  });
  const up = () => {
    if (!down) return;
    clearTimeout(down.timer);
    down = null; held = false;
    root.classList.remove('dragging');
    showMine();
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('lostpointercapture', up);
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = root.getBoundingClientRect();
    const cx = e.clientX - b.left, cy = e.clientY - b.top;
    const nz = clamp(z * Math.exp(-e.deltaY * 0.0015), 1, 24);
    if (nz <= 1.001) { fitView(); return; }
    tx = cx - ((cx - tx) * nz) / z; ty = cy - ((cy - ty) * nz) / z; z = nz;
    apply();
  }, { passive: false });
  root.addEventListener('dblclick', fitView);

  const ro = new ResizeObserver(layout);
  ro.observe(root);
  layout();
  showMine();
  return {
    destroy: () => { ro.disconnect(); root.remove(); },
    setDiff: (on) => {
      diffLayer.replaceChildren(...(on ? r.diff_boxes.map(([x0, y0, x1, y1]) => h('div', { class: 'diffbox', style: {
        left: `${(x0 / W) * 100}%`, top: `${(y0 / H) * 100}%`, width: `${((x1 - x0) / W) * 100}%`, height: `${((y1 - y0) / H) * 100}%` } })) : []));
    },
    peek: (on) => { peeking = on; showMine(); },
  };
}

/* ===================================================================== crop editor */
function mountCrop(host, r, onChange) {
  const W = r.width, H = r.height;
  const root = h('div', { class: 'cmp' });
  const wrap = h('div', { class: 'crop-wrap' });
  const img = h('img', { alt: 'This version', src: `/api/jobs/${S.jobId}/results/${r.id}/file`, draggable: 'false' });
  const yours = h('div', { class: 'crop-yours', title: 'Where your image is' });
  const size = h('div', { class: 'crop-size' });
  const boxEl = h('div', { class: 'crop-box' }, size, ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('div', { class: 'h', 'data-h': d })));
  wrap.append(img, yours, boxEl);
  root.append(wrap);
  host.append(root);
  let fit = 1, box = cropBox(r).slice(), drag = null;
  const layout = () => {
    const sw = root.clientWidth, sh = root.clientHeight;
    if (!sw || !sh) return;
    fit = Math.min((sw - 80) / W, (sh - 130) / H);
    Object.assign(wrap.style, { left: `${(sw - W * fit) / 2}px`, top: `${(sh - H * fit) / 2 - 6}px`, width: `${W * fit}px`, height: `${H * fit}px` });
    const [a, b, c, d] = r.roi_in_cand;
    Object.assign(yours.style, { left: `${a * fit}px`, top: `${b * fit}px`, width: `${(c - a) * fit}px`, height: `${(d - b) * fit}px` });
    draw();
  };
  const draw = () => {
    Object.assign(boxEl.style, { left: `${box[0] * fit}px`, top: `${box[1] * fit}px`, width: `${(box[2] - box[0]) * fit}px`, height: `${(box[3] - box[1]) * fit}px` });
    size.textContent = `${Math.round(box[2] - box[0])} \u00d7 ${Math.round(box[3] - box[1])} px`;
  };
  boxEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    boxEl.setPointerCapture(e.pointerId);
    drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, start: box.slice() };
  });
  boxEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / fit, dy = (e.clientY - drag.y) / fit;
    let [x0, y0, x1, y1] = drag.start;
    if (drag.h === 'move') {
      const w = x1 - x0, hh = y1 - y0;
      x0 = clamp(x0 + dx, 0, W - w); y0 = clamp(y0 + dy, 0, H - hh); x1 = x0 + w; y1 = y0 + hh;
    } else {
      if (drag.h.includes('w')) x0 = clamp(x0 + dx, 0, x1 - 8);
      if (drag.h.includes('e')) x1 = clamp(x1 + dx, x0 + 8, W);
      if (drag.h.includes('n')) y0 = clamp(y0 + dy, 0, y1 - 8);
      if (drag.h.includes('s')) y1 = clamp(y1 + dy, y0 + 8, H);
    }
    box = [x0, y0, x1, y1];
    draw();
  });
  const end = () => { if (drag) { drag = null; onChange(box.map(Math.round), true); } };
  boxEl.addEventListener('pointerup', end);
  boxEl.addEventListener('pointercancel', end);
  const ro = new ResizeObserver(layout);
  ro.observe(root);
  layout();
  return {
    destroy: () => { ro.disconnect(); root.remove(); },
    setBox: (b) => { box = b.slice(); draw(); onChange(box.map(Math.round), false); },
  };
}

/* ===================================================================== full-screen viewer */
function closeViewer() {
  const V = S.viewer;
  if (!V) return;
  V.tool?.destroy();
  window.removeEventListener('keydown', V.onKey, true);
  window.removeEventListener('keyup', V.onKeyUp, true);
  V.el.remove();
  S.viewer = null;
  document.body.style.overflow = '';
  closeFloating();
  if (S.job) { S.heroSig = ''; renderHero(S.job); markSelected(); }
}

function openViewer(id, tab = 'compare') {
  closeViewer();
  closeFloating();
  const j = S.job;
  const list = visibleResults(j);
  if (!list.some((x) => x.id === id) && S.byId[id]) list.unshift(S.byId[id]);
  let idx = Math.max(0, list.findIndex((x) => x.id === id));
  const stage = h('div', { class: 'vstage' });
  const panel = h('aside', { class: 'vpanel' });
  const title = h('div', { class: 'vtitle' });
  const count = h('span', { class: 'vcount' });
  const tabs = seg([['compare', 'Compare'], ['crop', 'Crop']], tab, (v) => show(idx, v), 'View');
  const prev = h('button', { class: 'btn btn-icon btn-ghost', title: 'Previous version (\u2190)', 'aria-label': 'Previous version', onclick: () => show(idx - 1) }, icon('left'));
  const next = h('button', { class: 'btn btn-icon btn-ghost', title: 'Next version (\u2192)', 'aria-label': 'Next version', onclick: () => show(idx + 1) }, icon('right'));
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Version viewer' },
    h('div', { class: 'vbar' },
      h('div', { class: 'vbar-left' }, h('button', { class: 'btn btn-icon btn-ghost', title: 'Close (Esc)', 'aria-label': 'Close', onclick: closeViewer }, icon('x')), title),
      tabs,
      h('div', { class: 'vbar-right' }, count, prev, next)),
    h('div', { class: 'vbody' }, stage, panel));
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  const V = S.viewer = { el, tab, tool: null, showDiff: false };

  function show(i, t = V.tab) {
    if (i < 0 || i >= list.length) return;
    idx = i; V.tab = t;
    setSeg(tabs, t);
    const r = list[i];
    title.replaceChildren(`${r.width} \u00d7 ${r.height} ${r.format}`, h('small', null, r.domain));
    count.textContent = list.length > 1 ? `${i + 1} of ${list.length}` : '';
    prev.disabled = i === 0; next.disabled = i === list.length - 1;
    V.tool?.destroy(); V.tool = null;
    stage.replaceChildren();
    if (t === 'compare') {
      V.tool = mountCompare(stage, r, { viewKey: 'viewer' });
      V.tool.setDiff(V.showDiff);
      stage.append(h('div', { class: 'stage-hint' }, 'Scroll to zoom \u00b7 drag to move \u00b7 double-click to fit \u00b7 D marks differences'));
    } else {
      const presets = seg([['suggested', r.crop_kind === 'panel' ? 'Panel' : 'Suggested'], ['yours', 'Same as yours'], ['whole', 'Whole image']], presetOf(r), (v) => {
        const b = v === 'suggested' ? r.crop : v === 'yours' ? r.roi_in_cand : [0, 0, r.width, r.height];
        V.tool.setBox(b.map(Math.round));
      }, 'Crop presets');
      V.tool = mountCrop(stage, r, (box, byHand) => {
        const same = box.every((v, k) => Math.abs(v - Math.round(r.crop[k])) <= 1);
        if (same && !cropFlip(r)) delete S.cropEdits[r.id]; else S.cropEdits[r.id] = { box, flip: cropFlip(r) };
        setSeg(presets, byHand ? presetOf(r) : presets.querySelector('.on')?.dataset.v);
        renderPanel(r);
      });
      stage.append(h('div', { class: 'stage-tools' }, presets), h('div', { class: 'stage-hint' }, 'Drag the box or its handles \u00b7 dashed line = your image'));
    }
    renderPanel(r);
  }

  function renderPanel(r) {
    const di = detailInfo(r.detail);
    const kids = [
      h('div', { class: 'bigstat' }, h('div', { class: `num ${di.cls}` }, di.num), h('div', { class: 'lbl' }, di.label)),
      h('div', { class: 'metaline' }, `${r.width} \u00d7 ${r.height} ${r.format}`, h('span', { class: 'dot' }, '\u00b7'), fmtBytes(r.bytes),
        r.jpeg_quality ? [h('span', { class: 'dot' }, '\u00b7'), `quality ${r.jpeg_quality}`] : null),
    ];
    const notes = notesFor(r, j);
    if (notes.length) kids.push(h('ul', { class: 'notes' }, notes.map(noteEl)));
    kids.push(h('div', { class: 'hero-actions', style: { marginTop: 0 } },
      h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => saveResult(r) }, icon('download', 19), saveLabel(r), h('span', { class: 'btn-note' }, sizeNote(r))),
      h('button', { class: 'btn btn-block', onclick: () => download(`/api/jobs/${S.jobId}/results/${r.id}/file?dl=1`) }, icon('image', 17), 'Download the original file')));
    if (r.mirrored) {
      kids.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cropFlip(r) || null, onchange: (e) => {
        S.cropEdits[r.id] = { box: cropBox(r), flip: e.target.checked };
      } }), 'Flip it to match my image'));
    }
    if (V.tab === 'compare' && r.diff_boxes?.length) {
      kids.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: V.showDiff || null, onchange: (e) => { V.showDiff = e.target.checked; V.tool?.setDiff?.(V.showDiff); } }), 'Highlight where it differs (D)'));
    }
    kids.push(
      h('details', null, h('summary', null, `Found on ${plural(r.sources.length, 'page')}`),
        h('div', { class: 'sources' }, r.sources.map((s) => (isWeb(s.page_url || s.url)
          ? h('a', { href: s.page_url || s.url, target: '_blank', rel: 'noopener noreferrer', title: s.page_url || s.url }, `${s.engine} \u00b7 ${s.title || s.page_url || s.url}`)
          : h('span', null, 'Added by you'))))),
      h('button', { class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, onclick: () => researchWith(r) }, icon('refresh', 16), 'Search again using this version'));
    panel.replaceChildren(...kids);
  }

  V.onKey = (e) => {
    if (e.target.matches?.('input, textarea, select')) return;
    if (e.key === 'Escape') { if (S.floating) closeFloating(); else closeViewer(); e.stopPropagation(); }
    else if (e.key === 'ArrowLeft' && !e.target.closest?.('.cmp-handle')) show(idx - 1);
    else if (e.key === 'ArrowRight' && !e.target.closest?.('.cmp-handle')) show(idx + 1);
    else if (e.code === 'Space' && V.tab === 'compare') { e.preventDefault(); V.tool?.peek(true); }
    else if ((e.key === 'd' || e.key === 'D') && V.tab === 'compare') { V.showDiff = !V.showDiff; V.tool?.setDiff(V.showDiff); renderPanel(list[idx]); }
  };
  V.onKeyUp = (e) => { if (e.code === 'Space') V.tool?.peek?.(false); };
  window.addEventListener('keydown', V.onKey, true);
  window.addEventListener('keyup', V.onKeyUp, true);
  show(idx, tab);
}

function presetOf(r) {
  const b = cropBox(r).map(Math.round);
  const eq = (o) => b.every((v, k) => Math.abs(v - Math.round(o[k])) <= 1);
  if (eq(r.crop)) return 'suggested';
  if (eq(r.roi_in_cand)) return 'yours';
  if (eq([0, 0, r.width, r.height])) return 'whole';
  return null;
}

/* ===================================================================== drag & drop, paste, keys */
async function itemFromDataTransfer(dt) {
  if (!dt) return null;
  const file = [...(dt.files || [])].find((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(f.name));
  if (file) return { file };
  const html = dt.getData('text/html');
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && isWeb(m[1])) return { url: m[1].replace(/&amp;/g, '&') };
  }
  const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n').map((l) => l.trim()).find(isWeb);
  return uri ? { url: uri } : null;
}

let dragDepth = 0;
const overlay = $('#drop-overlay');
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/html')) return;
  e.preventDefault();
  dragDepth++;
  if (S.view === 'job' && !S.viewer) overlay.hidden = false;
});
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  const item = await itemFromDataTransfer(e.dataTransfer);
  if (!item) { if (e.dataTransfer?.types?.length) toast('That doesn\u2019t look like an image.', 'err'); return; }
  if (S.view !== 'job') { startSearch(item); return; }
  const choice = e.target.closest?.('.drop-choice')?.dataset.action;
  if (choice === 'add') addCandidate(item);
  else if (choice === 'search' || !wasOpen) startSearch(item);
});
for (const c of overlay.querySelectorAll('.drop-choice')) {
  c.addEventListener('dragenter', () => c.classList.add('over'));
  c.addEventListener('dragleave', () => c.classList.remove('over'));
  c.addEventListener('drop', () => c.classList.remove('over'));
  const act = () => {
    overlay.hidden = true;
    const item = S.pending; S.pending = null;
    if (item) { if (c.dataset.action === 'add') addCandidate(item); else startSearch(item); }
  };
  c.addEventListener('click', act);
  c.addEventListener('keydown', (e) => { if (e.key === 'Enter') act(); });
}
overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.hidden = true; S.pending = null; } });

window.addEventListener('paste', (e) => {
  if (e.target.matches?.('input, textarea') || S.viewer || S.modal) return;
  const items = [...(e.clipboardData?.items || [])];
  const img = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  let item = null;
  if (img) item = { file: img.getAsFile() };
  else { const text = (e.clipboardData?.getData('text/plain') || '').trim(); if (/^https?:\/\/\S+$/i.test(text)) item = { url: text }; }
  if (!item) return;
  e.preventDefault();
  if (S.view === 'job') { S.pending = item; overlay.hidden = false; overlay.querySelector('.drop-choice')?.focus(); }
  else startSearch(item);
});

// Space held on the results page = show your original in the big preview
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || S.viewer || S.modal || !S.heroTool || e.target.matches?.('input, textarea, select, button, [role=button]')) return;
  e.preventDefault();
  S.heroTool.peek(true);
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') S.heroTool?.peek(false); });

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || S.viewer) return;
  if (!overlay.hidden) { overlay.hidden = true; S.pending = null; }
  else if (S.floating) closeFloating();
  else if (S.modal) closeModal();
});
