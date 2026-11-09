// Fabled Shots client. Plain ES module, no dependencies, no build step. Talks to /api/film/*.
//
// Rules to keep when editing this file:
//  - Every value that came from the server goes through html`` (escapes by default), cls() (class whitelist),
//    num() (numbers) or safeUrl() (URLs). Never concatenate server strings into markup or class/style attributes.
//  - A region is re-rendered only when its markup changed (setHtml). Form controls live in a skeleton that is built
//    once per selected shot and then synced field by field, so a poll never destroys input that is in progress.
//  - All mutating requests go through mutate(): JSON content type, optional If-Match, 409/400 handling.

// ---- tiny helpers (the same block lives in ../game/app.js; keep the two in step) --------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
class Raw { constructor(s) { this.s = s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
const part = (v) => (v == null || v === false || v === true ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
// html`<b>${value}</b>`: every interpolation is escaped unless it is itself html`` output. Attribute values must be quoted.
const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
// cls(value, allowed): the value if it is on the whitelist, otherwise ''. The only way a server value becomes a class name.
const cls = (value, allowed) => (typeof value === 'string' && allowed.includes(value) ? value : '');
const num = (v, fallback = 0) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : fallback; };
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
// safeUrl: http(s), same-origin relative, blob: and data:image/(png|jpeg|webp) only. Anything else becomes ''.
//   sameOrigin: only URLs on this origin (frames).  https: provider URLs must be https (same-origin paths still pass).
function safeUrl(value, { sameOrigin = false, https = false } = {}) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';
  if (/^data:/i.test(v)) return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(v) ? v : '';
  if (/[\u0000- \u007f\\]/.test(v)) return '';
  let u;
  try { u = new URL(v, location.origin); } catch { return ''; }
  const same = u.origin === location.origin;
  if (u.protocol === 'blob:') return !https && v.startsWith(`blob:${location.origin}/`) ? v : '';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (sameOrigin && !same) return '';
  if (https && !same && u.protocol !== 'https:') return '';
  return u.href;
}
// setHtml: replace a region only when its markup changed; keep keyboard focus (data-fk) and the region's own scroll.
function setHtml(el, markup) {
  const s = markup instanceof Raw ? markup.s : esc(markup);
  if (el._html === s) return false;
  const active = document.activeElement;
  const fk = active && active !== el && el.contains(active) ? active.dataset.fk : null;
  const top = el.scrollTop, left = el.scrollLeft;
  el.innerHTML = s; el._html = s;
  if (top || left) { el.scrollTop = top; el.scrollLeft = left; }
  if (fk) focusKey(el, fk);
  return true;
}
const focusKey = (root, fk) => { const t = $$('[data-fk]', root).find((x) => x.dataset.fk === fk); if (t) t.focus({ preventScroll: true }); return !!t; };
// Set a control's value without losing the caret when the user happens to be in it.
function setValue(el, value) {
  if (el.value === value) return;
  const focused = document.activeElement === el && typeof el.selectionStart === 'number' && el.type !== 'number';
  const a = focused ? el.selectionStart : 0, b = focused ? el.selectionEnd : 0;
  el.value = value;
  if (focused) { try { el.setSelectionRange(Math.min(a, value.length), Math.min(b, value.length)); } catch { /* not a text control */ } }
}
function syncOptions(sel, options, current) {
  const list = [...new Set([...options.map(String), ...(current ? [String(current)] : [])])];
  const sig = JSON.stringify(list);
  if (sel._sig === sig) return;
  const keep = sel.value;
  sel.replaceChildren(...list.map((o) => new Option(o, o)));
  sel._sig = sig;
  if (list.includes(keep)) sel.value = keep;
}
// Run a render pass without moving any scroll container (page, panes, lists).
function keepScroll(fn) {
  const els = [document.scrollingElement, ...$$('.pane, .main, .activity, .table-wrap, pre.code')].filter(Boolean);
  const before = els.map((e) => [e.scrollTop, e.scrollLeft]);
  try { fn(); } finally { els.forEach((e, i) => { if (e.scrollTop !== before[i][0]) e.scrollTop = before[i][0]; if (e.scrollLeft !== before[i][1]) e.scrollLeft = before[i][1]; }); }
}
const guard = (name, fn) => { try { fn(); } catch (e) { console.error(`render ${name} failed`, e); } };
// Local HH:MM of an ISO timestamp; '' for anything else (Date() alone would happily parse free text).
const localTime = (at) => { const d = new Date(typeof at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(at) ? at : NaN); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode / disabled storage */ } } };
function toast(msg, err = false, ms = 5000) {
  const t = $('#toast');
  t.className = `toast${err ? ' err' : ''}`; t.textContent = String(msg ?? '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.textContent = ''; }, ms);
}
// Arrow keys move focus between sibling items (rows, cards, timeline segments). Returns true when it handled the key.
function arrowNav(e, items, keys) {
  const step = keys[e.key];
  if (step === undefined || e.ctrlKey || e.metaKey || e.altKey) return false;
  const i = items.indexOf(e.target.closest('[data-fk]'));
  if (i < 0) return false;
  const next = step === 'first' ? 0 : step === 'last' ? items.length - 1 : clamp(i + step, 0, items.length - 1);
  e.preventDefault();
  if (next !== i) items[next].focus();
  return true;
}
const NAV_ROWS = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
const NAV_ANY = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: 'first', End: 'last' };
const NAV_LINE = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
const isActivate = (e) => (e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat;

async function api(url, { method = 'GET', body, ifMatch, timeoutMs = 20000 } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (body !== undefined) init.body = JSON.stringify(body);
    if (ifMatch != null) headers['If-Match'] = String(ifMatch);
  }
  const ctl = new AbortController(); init.signal = ctl.signal;
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try { res = await fetch(url, init); } catch { const err = new Error('Server unreachable'); err.offline = true; throw err; } finally { clearTimeout(timer); }
  const json = await res.json().catch(() => null);
  if (!res.ok || !isObj(json) || json.ok === false) {
    const err = new Error((isObj(json) && typeof json.error === 'string' && json.error) || `HTTP ${res.status}`);
    err.status = res.status; err.body = json; throw err;
  }
  return json;
}

// ---- constants ----------------------------------------------------------------------------------------------------
const API = '/api/film/projects';
const SIZES = ['Extreme wide', 'Wide', 'Medium wide', 'Medium', 'Medium (over-the-shoulder)', 'Close-up', 'Insert'];
// The one place a camera move label maps to its animation preset. The animatic class, the placeholder arrow and the
// Move select all read this map, so they agree even when the server has not updated shot.preset after a move edit.
const MOVE_PRESET = { 'Static (locked off)': 'static', 'Slow push-in': 'push_in', 'Dolly follow': 'dolly_follow', 'Tracking (handheld)': 'tracking_handheld', 'Crane down': 'crane_down', 'Aerial drift': 'aerial_drift', 'Handheld orbit': 'orbit_handheld', 'Crash zoom': 'crash_zoom' };
const MOVES = Object.keys(MOVE_PRESET);
const PRESETS = Object.values(MOVE_PRESET);
const presetOf = (shot) => (typeof shot.move === 'string' && Object.hasOwn(MOVE_PRESET, shot.move) ? MOVE_PRESET[shot.move] : cls(shot.preset, PRESETS) || 'static');
const STATUSES = ['proposed', 'approved', 'redo'];
const CLIP_STATUSES = ['queued', 'running', 'succeeded', 'failed'];
const ROLES = ['director', 'dp', 'previs artist', 'producer'];
const FRAME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let frameMaxBytes = 10 * 1024 * 1024; // replaced by /api/status limits.frame_bytes when the server reports it
const FREE_TEXT = ['description', 'prompt'];
const CONFLICT_MSG = 'Someone else changed this; your edit was not applied';

const state = { projects: [], project: null, shotId: null, tab: 'shots', role: ROLES[0], providers: [], rev: 0, seq: 0, confirmDelete: null };
const dirty = new Map();   // `${shotId}\n${field}` -> value the user typed but the server has not accepted yet
const drafts = new Map();  // shotId -> comment being written
const as = () => `?as=${encodeURIComponent(state.role)}`;
const shots = () => (state.project ? state.project.shots : []);
const shotById = (id) => shots().find((s) => s.id === id) || null;
const shotUrl = (id, tail = '') => `${API}/${encodeURIComponent(state.project.id)}/shots/${encodeURIComponent(id)}${tail}${as()}`;
const dur = (s) => Math.max(0, num(s.duration_s));
const totalDuration = () => shots().reduce((a, s) => a + dur(s), 0);
const tc = (sec) => { const frames = Math.max(0, Math.floor(num(sec) * 24 + 1e-6)); const t = Math.floor(frames / 24); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:${String(frames % 24).padStart(2, '0')}`; };
const pill = (value, allowed) => html`<span class="pill ${cls(value, allowed)}">${value}</span>`;
const MOCK_BADGE = html`<span class="corner badge-mockup">CONCEPT MOCKUP</span>`;

// ---- placeholder storyboard frame (SVG drawn in the page, labeled CONCEPT MOCKUP) -----------------------------------
const FIG_H = { 'Extreme wide': 0.12, 'Wide': 0.3, 'Medium wide': 0.55, 'Medium': 0.8, 'Medium (over-the-shoulder)': 0.85, 'Close-up': 1.6, 'Insert': 2.2 };
const ARROWS = { push_in: 'M320 300 L320 230 M305 245 L320 230 L335 245', dolly_follow: 'M200 330 L440 330 M425 318 L440 330 L425 342', tracking_handheld: 'M200 330 L440 330 M425 318 L440 330 L425 342', crane_down: 'M600 60 L600 180 M588 165 L600 180 L612 165', aerial_drift: 'M80 60 L240 120 M222 102 L240 120 L216 124', orbit_handheld: 'M220 320 Q320 360 420 320 M405 312 L420 320 L410 334', crash_zoom: 'M320 320 L320 200 M300 220 L320 200 L340 220 M280 330 L360 330' };
export function placeholderSvg(shot) {
  const W = 640, H = 360, heading = String(shot.scene_heading ?? ''), night = /NIGHT|DUSK/.test(heading), ext = /EXT/.test(heading);
  const sky = night ? '#0b1020' : ext ? '#243b55' : '#2a2320', ground = night ? '#141a26' : ext ? '#3b4a3a' : '#3d332b';
  const fh = (Object.hasOwn(FIG_H, shot.size) ? FIG_H[shot.size] : 0.6) * H, fw = fh * 0.36, cx = W * 0.5, base = H * 0.86;
  const left = shot.ots_side === 'camera left';
  const fig = (x, dim = 1) => `<g opacity="${dim}"><ellipse cx="${x}" cy="${base - fh + fh * 0.1}" rx="${fw * 0.32}" ry="${fh * 0.1}" fill="#d8cdb8"/><path d="M${x - fw / 2} ${base} L${x - fw / 2} ${base - fh * 0.75} Q${x} ${base - fh * 0.95} ${x + fw / 2} ${base - fh * 0.75} L${x + fw / 2} ${base} Z" fill="#d8cdb8"/></g>`;
  const ots = shot.ots_side ? `<path d="M${left ? 0 : W} 0 L${left ? W * 0.38 : W * 0.62} 0 L${left ? W * 0.28 : W * 0.72} ${H} L${left ? 0 : W} ${H} Z" fill="#000" opacity=".75"/>` : '';
  const arrow = ARROWS[presetOf(shot)] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${sky}"/><rect y="${H * 0.62}" width="${W}" height="${H * 0.38}" fill="${ground}"/>${ext ? `<circle cx="${W * 0.78}" cy="${H * 0.2}" r="22" fill="${night ? '#cbd5e1' : '#fde68a'}" opacity=".8"/>` : `<rect x="${W * 0.1}" y="${H * 0.15}" width="${W * 0.2}" height="${H * 0.35}" fill="#0f172a" opacity=".6"/>`}${fig(cx)}${shot.size === 'Medium (over-the-shoulder)' ? fig(left ? W * 0.22 : W * 0.78, 0.4) : ''}${ots}<path d="${arrow}" stroke="#fbbf24" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6 6" opacity=".5"/><text x="12" y="${H - 14}" font-family="Inter, sans-serif" font-size="16" fill="#f1f5f9">${esc(shot.size)} · ${esc(shot.move)} · ${num(shot.lens_mm)}mm</text><rect x="${W - 170}" y="12" width="158" height="22" rx="4" fill="#f59e0b"/><text x="${W - 91}" y="28" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="12" fill="#000">CONCEPT MOCKUP</text></svg>`;
}
const svgUri = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
const phCache = new Map();
// The in-page placeholder is the only SVG the client ever puts in an <img>; it is built here, never taken from the server.
function placeholderUri(shot) {
  const key = JSON.stringify([shot.scene_heading, shot.size, shot.move, shot.preset, shot.ots_side, shot.lens_mm]);
  if (!phCache.has(key)) { if (phCache.size > 500) phCache.clear(); phCache.set(key, svgUri(placeholderSvg(shot))); }
  return phCache.get(key);
}
// Frame contract: {url, mime, bytes, label, at, concept_mockup} (url is a same-origin path) or the older {data_uri, ...}.
const frameUrl = (shot) => (isObj(shot.frame) ? safeUrl(shot.frame.url, { sameOrigin: true }) || (/^data:/i.test(shot.frame.data_uri ?? '') ? safeUrl(shot.frame.data_uri) : '') : '');
const frameSrc = (shot) => frameUrl(shot) || placeholderUri(shot);
const isMockFrame = (shot) => !frameUrl(shot) || !!shot.frame.concept_mockup;
const clipUrl = (shot) => (isObj(shot.clip) ? safeUrl(shot.clip.url, { https: true }) : '');
// Rasterize the placeholder SVG to PNG: the server and the video providers only take PNG/JPEG/WebP.
const svgToPng = (uri) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { try { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; c.getContext('2d').drawImage(img, 0, 0, 1280, 720); resolve(c.toDataURL('image/png')); } catch (e) { reject(e); } }; img.onerror = () => reject(new Error('could not draw the placeholder frame')); img.src = uri; });
// A stored frame that fails to load falls back to the placeholder instead of a broken image.
document.addEventListener('error', (e) => { const el = e.target; if (!(el instanceof HTMLImageElement) || !el.dataset.shot || el.dataset.fallback) return; const s = shotById(el.dataset.shot); if (s) { el.dataset.fallback = '1'; el.src = placeholderUri(s); } }, true);

// ---- data -----------------------------------------------------------------------------------------------------------
function normalize(p) {
  if (!isObj(p)) return null;
  for (const k of ['shots', 'scenes', 'characters', 'locations', 'props', 'activity', 'roles']) p[k] = arr(p[k]);
  p.id = String(p.id ?? '');
  p.shots = p.shots.filter(isObj);
  for (const s of p.shots) { s.id = String(s.id ?? ''); s.comments = arr(s.comments).filter(isObj); if (!isObj(s.frame)) s.frame = null; if (!isObj(s.clip)) s.clip = null; }
  p.activity = p.activity.filter(isObj); p.characters = p.characters.filter(isObj); p.props = p.props.filter(isObj);
  return p;
}
async function loadStatus() {
  const s = await api('/api/status');
  state.providers = arr(s.providers).filter((p) => isObj(p) && arr(p.kinds).includes('image-to-video'));
  if (num(s.limits?.frame_bytes) >= 1048576) frameMaxBytes = num(s.limits.frame_bytes);
  const on = state.providers.filter((p) => p.configured).map((p) => String(p.name));
  $('#prov-pill').textContent = on.length ? `providers: ${on.join(', ')}` : 'providers: none configured';
  $('#prov-pill').title = on.length ? 'Image→video providers configured on this server' : `Set ${state.providers.map((p) => arr(p.env).join('/')).join(' or ')} in the server environment to animate frames`;
}
async function loadProjects() { state.projects = arr((await api(API)).projects).filter(isObj); renderProjects(); }
let openToken = 0;
async function openProject(id) {
  const token = ++openToken;
  try {
    const p = normalize((await api(`${API}/${encodeURIComponent(id)}`)).project);
    if (token !== openToken || !p) return;
    stopPlay();
    state.project = p; state.rev = p.rev; state.seq += 1;
    state.shotId = p.shots[0]?.id ?? null;
    if (location.hash.slice(1) !== p.id) location.hash = p.id;
    renderAll();
  } catch (e) { toast(e.message, true); if (e.status === 404) loadProjects().catch(() => {}); }
}
function closeProject() {
  stopPlay(); openToken += 1;
  state.project = null; state.shotId = null; state.rev = 0; state.seq += 1;
  history.replaceState(null, '', location.pathname + location.search);
  renderAll();
}
// A newer copy of the open project (from a mutation, a 409 body or a poll). Never touches input that is in progress.
function applyProject(p) {
  p = normalize(p);
  if (!p || !state.project || p.id !== state.project.id) return;
  state.project = p; state.rev = p.rev; state.seq += 1;
  if (!shotById(state.shotId)) state.shotId = p.shots[0]?.id ?? null;
  keepScroll(renderAll);
}
// One path for every mutating request. Returns {ok, data} or {ok:false, conflict|offline|status}.
async function mutate(method, url, body, { ifMatch = false, quiet = [], timeoutMs } = {}) {
  try {
    const data = await api(url, { method, body, ifMatch: ifMatch ? state.rev : undefined, timeoutMs });
    if (data.project) applyProject(data.project);
    return { ok: true, data };
  } catch (e) {
    if (e.status === 409 && isObj(e.body?.project)) { applyProject(e.body.project); toast(CONFLICT_MSG, true, 7000); return { ok: false, conflict: true }; }
    if (!quiet.includes(e.status)) toast(e.offline ? 'Server unreachable; your change was not saved' : e.message, true);
    if (e.offline) pollSoon();
    return { ok: false, offline: !!e.offline, status: e.status };
  }
}

// ---- render ---------------------------------------------------------------------------------------------------------
function renderProjects() {
  setHtml($('#projects'), state.projects.length ? html`${state.projects.map((p) => {
    const id = String(p.id ?? ''), active = state.project?.id === id, n = p.summary?.shots;
    if (state.confirmDelete === id) return html`<div class="proj-row confirm" role="group" aria-label="Confirm delete"><span class="small">Delete “${p.title}” for everyone? This cannot be undone.</span><span class="row"><button class="btn tiny danger" data-act="delete-yes" data-id="${id}" data-fk="del-yes">Delete</button><button class="btn tiny" data-act="delete-no" data-id="${id}" data-fk="del-no">Cancel</button></span></div>`;
    return html`<div class="proj-row"><button class="item ${active ? 'active' : ''}" data-act="open" data-id="${id}" data-fk="open-${id}" ${active ? new Raw('aria-current="true"') : ''}>${p.title} <span class="muted small">· ${n == null ? '?' : num(n)} shots</span></button><button class="icon-btn" data-act="delete-ask" data-id="${id}" data-fk="del-${id}" aria-label="Delete project ${p.title}" title="Delete project">✕</button></div>`;
  })}` : html`<p class="muted small">No projects yet.</p>`);
}
function renderAll() {
  const p = state.project;
  guard('projects', renderProjects);
  $('#empty').hidden = !!p;
  $$('[id^=tab-]').forEach((el) => (el.hidden = !p || el.id !== `tab-${state.tab}`));
  $$('#tabs .btn').forEach((b) => { const on = b.dataset.tab === state.tab; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  guard('side', renderSide);
  guard('main', renderMain);
  guard('detail', renderDetail);
}
function renderSide() {
  const p = state.project;
  if (!p) { setHtml($('#breakdown'), html``); setHtml($('#activity'), html``); return; }
  const chips = (items, fn) => (items.length ? items.map(fn) : html`<span class="muted small">none</span>`);
  setHtml($('#breakdown'), html`<h2>Breakdown</h2><div class="row"><div class="stat"><b>${p.scenes.length}</b><span>scenes</span></div><div class="stat"><b>${p.shots.length}</b><span>shots</span></div><div class="stat"><b>${tc(totalDuration()).slice(0, 5)}</b><span>animatic <span class="badge-est">ESTIMATE</span></span></div></div>
    <p class="small muted sub">Characters</p><div class="row">${chips(p.characters, (c) => html`<span class="pill wrap">${c.name} · ${num(c.lines)}</span>`)}</div>
    <p class="small muted sub">Locations</p><div class="row">${chips(p.locations, (l) => html`<span class="pill wrap">${l}</span>`)}</div>
    <p class="small muted sub">Props mentioned</p><div class="row">${chips(p.props.slice(0, 10), (x) => html`<span class="pill wrap">${x.name} ×${num(x.mentions)}</span>`)}</div>`);
  setHtml($('#activity'), html`${[...p.activity].reverse().slice(0, 30).map((a) => html`<li><span class="muted" title="${a.at}">${localTime(a.at)}</span> <b>${a.who}</b> ${a.what}</li>`)}`);
}
function renderMain() {
  if (!state.project) return;
  if (state.tab === 'shots') renderTable();
  else if (state.tab === 'board') renderBoard();
  else if (state.tab === 'animatic') renderAnimatic();
  else if (state.tab === 'unreal') renderUnreal();
}
function renderTable() {
  const list = shots();
  const approved = list.filter((s) => s.status === 'approved').length, redo = list.filter((s) => s.status === 'redo').length, framed = list.filter((s) => frameUrl(s)).length, clips = list.filter((s) => clipUrl(s)).length;
  setHtml($('#stats'), html`<div class="stat"><b>${approved}/${list.length}</b><span>approved</span></div><div class="stat"><b>${redo}</b><span>redo</span></div><div class="stat"><b>${framed}</b><span>frames</span></div><div class="stat"><b>${clips}</b><span>clips</span></div><div class="stat"><b>${tc(totalDuration())}</b><span>runtime <span class="badge-est">ESTIMATE</span></span></div>`);
  // Roving tabindex: one row is in the Tab order (the selected one), Up/Down move between rows, Enter/Space selects.
  const tabId = shotById(state.shotId) ? state.shotId : list[0]?.id;
  setHtml($('#shot-table tbody'), html`${list.map((s) => {
    const active = s.id === state.shotId;
    const frame = clipUrl(s) ? '🎞 clip' : frameUrl(s) ? (s.frame.concept_mockup ? '▦ placeholder' : '🖼 still') : html`<span class="muted">—</span>`;
    return html`<tr data-id="${s.id}" data-fk="row-${s.id}" tabindex="${s.id === tabId ? 0 : -1}" class="${active ? 'active' : ''}" ${active ? new Raw('aria-current="true"') : ''}><td class="mono">${s.id}</td><td>${s.scene}</td><td>${s.size}</td><td>${s.move}</td><td>${num(s.lens_mm)}mm</td><td>${num(s.duration_s)}s</td><td>${s.subject}</td><td>${s.description}</td><td>${pill(s.status, STATUSES)}</td><td>${frame}</td></tr>`;
  })}`);
}
function renderBoard() {
  setHtml($('#board'), html`${shots().map((s) => {
    const active = s.id === state.shotId, clip = clipUrl(s);
    const media = clip ? html`<video src="${clip}" muted loop playsinline preload="metadata" tabindex="-1"></video>` : html`<img src="${frameSrc(s)}" data-shot="${s.id}" alt="" loading="lazy" />`;
    return html`<div class="card ${active ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${active ? 'true' : 'false'}" aria-label="Shot ${s.id}, ${s.status}: ${s.description}" data-id="${s.id}" data-fk="card-${s.id}"><div class="frame">${media}${isMockFrame(s) && !clip ? MOCK_BADGE : ''}<span class="shot-id">${s.id}</span></div><div class="meta"><span>${s.size} · ${num(s.lens_mm)}mm</span>${pill(s.status, STATUSES)}</div><p class="small desc">${s.description}</p></div>`;
  })}`);
}
function renderUnreal() {
  const p = state.project, base = `${API}/${encodeURIComponent(p.id)}/export/`;
  setHtml($('#tab-unreal'), html`<div class="card"><h3>Hand-off to Unreal Engine</h3>
  <p class="muted">The Sequencer plan places one CineCameraActor per shot around a subject mark, keys its focal length and a start/end transform for the camera move, and lays the shots on a camera-cut track at 24 fps. The Python builder reads it inside the Unreal Editor.</p>
  <ol class="steps muted"><li>Download <a href="${base}sequencer_plan.json">sequencer_plan.json</a> and <a href="${base}unreal.py">build_sequence_from_shotlist.py</a>.</li><li>In Unreal Engine 5.6 or later enable <b>Python Editor Script Plugin</b> and <b>Sequencer Scripting</b>, restart.</li><li>Output Log: <code class="mono">py "…/build_sequence_from_shotlist.py" --plan "…/sequencer_plan.json" --dest /Game/Fabled/Previs</code></li><li>Open the Level Sequence it logs, scrub, then render through Movie Render Queue / Movie Render Graph.</li></ol>
  <p class="small"><span class="badge-est">UNTESTED DRAFT</span> The script has not been executed in an editor from this environment; see its header for the API calls to verify. Nothing in it uploads anything.</p></div>
  <div class="card"><h3>Other exports</h3><div class="row"><a class="btn tiny" href="${base}shotlist.json">Shot list JSON (fabled.shotlist/0.1)</a><a class="btn tiny" href="${base}shotlist.csv">Shot list CSV</a></div><p class="small muted sub">The CSV opens in Sheets / StudioBinder-style templates; the JSON is the contract the Unreal builder, the animatic and any future LLM "director pass" share.</p></div>
  <div class="card"><h3>Sequencer plan preview</h3><pre class="code" id="plan-preview" tabindex="0" aria-label="Sequencer plan preview">loading…</pre></div>`);
  loadPlanPreview(`${base}sequencer_plan.json`);
}
const plan = { key: null };
async function loadPlanPreview(url) {
  const key = `${state.project.id}@${state.rev}`;
  if (plan.key === key) return;
  plan.key = key;
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json(), list = arr(j.shots);
    text = JSON.stringify({ ...j, shots: list.length > 3 ? [...list.slice(0, 3), `… ${list.length - 3} more`] : list }, null, 2);
  } catch { text = 'Preview unavailable (the download links above still work).'; plan.key = null; }
  const pre = $('#plan-preview');
  if (pre && state.project && key.startsWith(`${state.project.id}@`) && pre.textContent !== text) keepScroll(() => { pre.textContent = text; });
}

// ---- animatic -------------------------------------------------------------------------------------------------------
// Playback is a clock over the *current* shot list, keyed by shot id, so a remote update neither restarts nor stops it.
const anim = { playing: false, shotId: null, offset: 0, t0: 0, timer: 0 };
const startOf = (i) => shots().slice(0, i).reduce((a, s) => a + dur(s), 0);
function renderTimeline() {
  const list = shots(), total = totalDuration() || 1;
  const nowId = anim.playing ? anim.shotId : null;
  const tabId = nowId ?? (shotById(state.shotId) ? state.shotId : list[0]?.id);
  setHtml($('#timeline'), html`${list.map((s, i) => html`<button type="button" class="seg ${cls(s.status, STATUSES)} ${s.id === nowId ? 'now' : ''} ${s.id === state.shotId ? 'sel' : ''}" style="width:${((dur(s) / total) * 100).toFixed(4)}%" data-i="${i}" data-fk="seg-${s.id}" tabindex="${s.id === tabId ? 0 : -1}" title="${s.id} ${s.description}" aria-label="Shot ${s.id}, ${num(s.duration_s)} seconds, ${s.status}: ${s.description}" ${s.id === nowId ? new Raw('aria-current="true"') : ''}>${s.id.slice(-3)}</button>`)}`);
  $('#runtime').textContent = tc(totalDuration());
}
// Show shot i on the screen. restart=true (re)starts its camera-move animation `offset` seconds in; otherwise only
// what changed (frame, caption, timing) is updated, so a poll during playback does not reset the move.
function showFrame(i, { restart = false, offset = 0 } = {}) {
  const s = shots()[i], screen = $('#screen'), img = $('#screen-img');
  if (!s) return;
  const clip = clipUrl(s), src = clip || frameSrc(s);
  if (screen._src !== src) {
    screen._src = src;
    const old = $('video', screen); if (old) old.remove();
    if (clip) { img.hidden = true; const v = document.createElement('video'); v.src = clip; v.muted = true; v.autoplay = true; v.playsInline = true; screen.prepend(v); } else { img.hidden = false; delete img.dataset.fallback; img.src = src; }
  }
  img.dataset.shot = s.id;
  img.alt = clip ? '' : `${frameUrl(s) ? 'Frame' : 'Placeholder frame'} for shot ${s.id}`;
  const want = anim.playing ? `screen kb-${presetOf(s)}` : 'screen';
  screen.style.setProperty('--dur', `${Math.max(0.1, dur(s))}s`);
  if (restart) { screen.className = 'screen'; screen.style.setProperty('--delay', `${-Math.max(0, offset)}s`); void screen.offsetWidth; }
  if (screen.className !== want) screen.className = want;
  setHtml($('#screen-cap'), html`<b class="mono">${s.id}</b> ${s.description} <span class="muted">· ${s.size}, ${s.move}, ${num(s.lens_mm)}mm, ${num(s.duration_s)}s</span>`);
}
function setClock(sec) {
  const total = totalDuration();
  $('#timecode').textContent = tc(sec);
  const head = $('#playhead'); head.hidden = false; head.style.left = `${total > 0 ? clamp((sec / total) * 100, 0, 100).toFixed(3) : 0}%`;
}
function renderAnimatic() {
  renderTimeline();
  $('#play').setAttribute('aria-pressed', anim.playing ? 'true' : 'false');
  if (anim.playing) {
    const i = shots().findIndex((s) => s.id === anim.shotId);
    if (i < 0) return stopPlay(); // the shot being played no longer exists
    showFrame(i);
  } else {
    const i = Math.max(0, shots().findIndex((s) => s.id === state.shotId));
    showFrame(i); setClock(startOf(i));
  }
}
function playFrom(i, offset = 0) {
  const list = shots();
  if (!list.length) return;
  i = clamp(i, 0, list.length - 1);
  Object.assign(anim, { playing: true, shotId: list[i].id, offset, t0: performance.now() });
  showFrame(i, { restart: true, offset });
  renderTimeline(); $('#play').setAttribute('aria-pressed', 'true');
  setClock(startOf(i) + offset);
  clearInterval(anim.timer); anim.timer = setInterval(tick, 100);
}
function tick() {
  if (!anim.playing) return;
  const list = shots(); let i = list.findIndex((s) => s.id === anim.shotId);
  if (i < 0) return stopPlay();
  let local = anim.offset + (performance.now() - anim.t0) / 1000;
  if (local < dur(list[i])) return setClock(startOf(i) + local);
  while (i < list.length && local >= dur(list[i])) { local -= dur(list[i]); i += 1; } // also catches up after a throttled tab
  if (i >= list.length) { stopPlay(); setClock(totalDuration()); return; }
  playFrom(i, local);
}
function stopPlay() {
  const was = anim.playing;
  clearInterval(anim.timer); anim.playing = false; anim.shotId = null;
  if (was && state.project && state.tab === 'animatic') renderAnimatic();
}
// Seek to a time on the timeline: keeps playing from there, or selects the shot under the pointer when stopped.
function seek(sec) {
  const list = shots(); let i = 0, t = clamp(sec, 0, Math.max(0, totalDuration() - 0.001));
  while (i < list.length - 1 && t >= dur(list[i])) { t -= dur(list[i]); i += 1; }
  if (anim.playing) return playFrom(i, t);
  selectShot(list[i]?.id); setClock(sec);
}

// ---- detail pane ------------------------------------------------------------------------------------------------------
let detailFor = null; // shot id the skeleton was built for
const dkey = (shotId, k) => `${shotId}\n${k}`;
function buildDetail(s) {
  detailFor = s.id;
  const root = $('#detail');
  root._html = null;
  root.innerHTML = `<div class="section"><h2 id="d-title"></h2>
    <div id="d-frame"></div>
    <div class="row" id="d-status"></div>
    <div class="detail-field"><label for="f-size">Size</label><select id="f-size" data-k="size"></select></div>
    <div class="detail-field"><label for="f-move">Move</label><select id="f-move" data-k="move"></select></div>
    <div class="detail-field"><label for="f-lens">Lens <span class="muted">mm</span></label><input type="number" id="f-lens" data-k="lens_mm" min="4" max="1200" step="any" required /></div>
    <div class="detail-field"><label for="f-dur">Duration <span class="muted">s</span></label><input type="number" id="f-dur" data-k="duration_s" min="0.1" max="600" step="0.1" required /></div>
    <div class="detail-field"><label for="f-assignee">Assignee</label><select id="f-assignee" data-k="assignee"></select></div>
    <div class="detail-field"><label for="f-desc">Action</label><input type="text" id="f-desc" data-k="description" maxlength="2000" /></div>
    <label class="small muted block" for="f-prompt">Generation prompt (edit freely)</label><textarea id="f-prompt" data-k="prompt" maxlength="2000"></textarea>
    <p class="small muted sub">Fields save when you leave them (Enter in a field, Ctrl+Enter in the prompt). An amber outline means not saved yet.</p>
  </div>
  <div class="section"><h2>Frame &amp; clip</h2>
    <div class="row"><button class="btn tiny" id="btn-upload">Attach still…</button><button class="btn tiny" id="btn-placeholder">Use placeholder frame</button><button class="btn tiny" id="btn-remove-frame" hidden>Remove frame</button></div>
    <div class="row sub"><label class="sr-only" for="clip-provider">Image-to-video provider</label><select id="clip-provider"></select><button class="btn tiny primary" id="btn-clip">Animate frame → clip</button></div>
    <div id="d-clip"></div>
    <p class="small muted sub">Image→video needs a real still (PNG, JPEG or WebP, 10 MB or less). The placeholder frame is rasterized to PNG before it is sent. Keys stay on the server; the browser only sees provider names.</p>
  </div>
  <div class="section"><h2 id="d-comments-title"></h2><div id="d-comments"></div>
    <div class="row sub"><label class="sr-only" for="comment-text">Note for the team</label><input type="text" id="comment-text" placeholder="Note for the team…" maxlength="2000" autocomplete="off" /><button class="btn tiny" id="btn-comment">Post</button></div></div>`;
  $('#comment-text').value = drafts.get(s.id) ?? '';
  for (const el of $$('[data-k]', root)) if (dirty.has(dkey(s.id, el.dataset.k))) el.value = dirty.get(dkey(s.id, el.dataset.k));
  const prov = $('#clip-provider');
  if (state.providers.length) prov.replaceChildren(...state.providers.map((pr) => { const o = new Option(`${pr.name}${pr.configured ? '' : ' (not configured)'}`, String(pr.id)); o.disabled = !pr.configured; return o; }));
  else { const o = new Option('no image→video provider', ''); o.disabled = true; prov.replaceChildren(o); }
  const first = state.providers.find((pr) => pr.configured);
  if (first) prov.value = String(first.id); else prov.selectedIndex = 0; // show the first name even though it cannot be picked
  $('#btn-clip').disabled = !first;
  if (!first) $('#btn-clip').title = 'No image→video provider is configured on this server';
}
function renderDetail() {
  const root = $('#detail'), p = state.project, s = p && shotById(state.shotId);
  if (!s) { detailFor = null; setHtml(root, html`<div class="section"><h2>Shot</h2><p class="muted small">${p ? 'Select a shot to review it.' : 'Open a project, then select a shot to review it.'}</p></div>`); return; }
  if (detailFor !== s.id || !$('#d-title')) buildDetail(s);
  const clip = clipUrl(s);
  setHtml($('#d-title'), html`Shot <span class="mono">${s.id}</span> · scene ${s.scene}`);
  setHtml($('#d-frame'), html`<div class="frame">${clip ? html`<video src="${clip}" controls muted loop playsinline preload="metadata"></video>` : html`<img src="${frameSrc(s)}" data-shot="${s.id}" alt="${frameUrl(s) ? 'Frame' : 'Placeholder frame'} for shot ${s.id}" />`}${isMockFrame(s) && !clip ? MOCK_BADGE : ''}</div>${frameUrl(s) ? html`<p class="small muted frame-label">${s.frame.label}${s.frame.at ? html` · ${localTime(s.frame.at)}` : ''}</p>` : ''}`);
  setHtml($('#d-status'), html`<button class="btn tiny ${s.status === 'approved' ? 'primary' : ''}" data-status="approved" data-fk="st-approved" aria-pressed="${s.status === 'approved' ? 'true' : 'false'}">✓ Approve</button><button class="btn tiny ${s.status === 'redo' ? 'danger' : ''}" data-status="redo" data-fk="st-redo" aria-pressed="${s.status === 'redo' ? 'true' : 'false'}">↺ Redo</button><button class="btn tiny" data-status="proposed" data-fk="st-proposed">Reset</button><span class="spacer"></span>${pill(s.status, STATUSES)}`);
  syncOptions($('#f-size'), SIZES, s.size);
  syncOptions($('#f-move'), MOVES, s.move);
  syncOptions($('#f-assignee'), p.roles.length ? p.roles : ROLES, s.assignee);
  for (const el of $$('[data-k]', root)) {
    const k = el.dataset.k, stored = k === 'lens_mm' || k === 'duration_s' ? String(num(s[k])) : String(s[k] ?? '');
    el.dataset.stored = stored;
    const isDirty = dirty.has(dkey(s.id, k));
    el.classList.toggle('unsaved', isDirty);
    if (!isDirty) setValue(el, stored);
  }
  $('#btn-remove-frame').hidden = !frameUrl(s);
  const c = s.clip;
  setHtml($('#d-clip'), c ? html`<p class="small sub">${c.provider}: ${pill(c.status, CLIP_STATUSES)}${c.progress != null && !['succeeded', 'failed'].includes(c.status) ? html` <span class="muted">${clamp(Math.round(num(c.progress)), 0, 100)}%</span>` : ''} ${c.error ? html`<span class="muted">${c.error}</span>` : ''} ${clip ? html`<a href="${clip}" target="_blank" rel="noopener noreferrer">open</a>` : ''}${c.concept_mockup ? html` <span class="badge-mockup">CONCEPT MOCKUP</span>` : ''}</p>` : html``);
  setHtml($('#d-comments-title'), html`Comments (${s.comments.length})`);
  setHtml($('#d-comments'), html`${s.comments.map((cm) => html`<div class="comment"><span class="who">${cm.who}</span><span class="muted small" title="${cm.at}">${localTime(cm.at)}</span><div>${cm.text}</div></div>`)}`);
}
function selectShot(id) {
  if (id == null || !shotById(id) || id === state.shotId) return;
  state.shotId = id;
  renderMain(); renderDetail();
}
async function commitField(el) {
  const k = el.dataset.k, id = detailFor, key = dkey(id, k);
  if (!state.project || !shotById(id)) return;
  if (el._saving) { dirty.set(key, el.value); el._again = true; return; } // changed again while the last save is in flight
  if (el.value === el.dataset.stored) { dirty.delete(key); el.classList.remove('unsaved'); return; }
  let value = el.value;
  if (el.type === 'number') {
    if (!el.checkValidity()) { toast(`${k === 'lens_mm' ? 'Lens' : 'Duration'}: ${el.validationMessage}`, true); dirty.delete(key); return renderDetail(); }
    value = Number(value);
  }
  const sent = el.value;
  dirty.set(key, sent); el._saving = true;
  const r = await mutate('PATCH', shotUrl(id), { [k]: value }, { ifMatch: true });
  el._saving = false;
  // Success: the stored value wins unless the user kept typing. Failure: revert, except free text, which is kept
  // (marked unsaved) after a conflict or a network error so nothing typed is lost; Enter saves it again.
  const keep = r.ok ? dirty.get(key) !== sent : FREE_TEXT.includes(k) && (r.conflict || r.offline);
  if (!keep) dirty.delete(key);
  renderDetail();
  if (el._again) { el._again = false; if (r.ok && el.isConnected && detailFor === id && el.value !== el.dataset.stored) commitField(el); }
}
async function postComment() {
  const input = $('#comment-text'), btn = $('#btn-comment'), id = detailFor, text = input.value.trim();
  if (!text || btn.disabled) return;
  btn.disabled = true;
  const r = await mutate('POST', shotUrl(id, '/comments'), { text });
  btn.disabled = false;
  if (r.ok) { drafts.delete(id); if (detailFor === id && input.isConnected) { input.value = ''; if (document.activeElement === btn || document.activeElement === document.body) input.focus(); } }
}
const uploadFrame = (id, body) => mutate('POST', shotUrl(id, '/frame'), body, { ifMatch: true, timeoutMs: 120000 });
async function usePlaceholder(id) {
  const s = shotById(id); if (!s) return { ok: false };
  let png;
  try { png = await svgToPng(placeholderUri(s)); } catch (e) { toast(e.message, true); return { ok: false }; }
  return uploadFrame(id, { data_uri: png, label: 'placeholder frame (rasterized)', concept_mockup: true });
}
async function removeFrame(id) {
  const r = await mutate('DELETE', shotUrl(id, '/frame'), undefined, { ifMatch: true, quiet: [404, 405] });
  if (r.ok) { toast('frame removed'); if (!r.data.project) pollSoon(); } else if (r.status === 404 || r.status === 405) toast('This server cannot remove frames yet', true);
}
async function startClip(id) {
  const s = shotById(id); if (!s) return;
  const provider = $('#clip-provider').value;
  if (!frameUrl(s) && !(await usePlaceholder(id)).ok) return;
  const r = await mutate('POST', shotUrl(id, '/clip'), { provider });
  if (r.ok) toast(`${r.data.task?.provider_name ?? provider}: clip started`);
}
let uploadFor = null;
async function attachStill(file) {
  const id = uploadFor;
  if (!file || !state.project || !shotById(id)) return;
  if (!FRAME_TYPES.includes(file.type)) return toast('The still must be a PNG, JPEG or WebP image', true);
  if (file.size > frameMaxBytes) return toast(`The still must be ${Math.floor(frameMaxBytes / 1048576)} MB or less`, true);
  let data_uri;
  try { data_uri = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('could not read the file')); r.readAsDataURL(file); }); } catch (e) { return toast(e.message, true); }
  if ((await uploadFrame(id, { data_uri, label: file.name.slice(0, 80), concept_mockup: false })).ok) toast('still attached');
}

// ---- wiring ---------------------------------------------------------------------------------------------------------
const busy = async (btn, fn) => { if (btn.disabled) return; btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
const detail = $('#detail');
detail.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !detailFor) return;
  const id = detailFor;
  if (b.dataset.status) mutate('PATCH', shotUrl(id), { status: b.dataset.status }, { ifMatch: true });
  else if (b.id === 'btn-comment') postComment();
  else if (b.id === 'btn-upload') { uploadFor = id; $('#file-still').click(); }
  else if (b.id === 'btn-placeholder') busy(b, () => usePlaceholder(id));
  else if (b.id === 'btn-remove-frame') busy(b, () => removeFrame(id));
  else if (b.id === 'btn-clip') busy(b, () => startClip(id));
});
detail.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'comment-text') { if (el.value) drafts.set(detailFor, el.value); else drafts.delete(detailFor); }
  else if (el.dataset.k && el.tagName !== 'SELECT') { dirty.set(dkey(detailFor, el.dataset.k), el.value); el.classList.add('unsaved'); }
});
detail.addEventListener('change', (e) => { if (e.target.dataset.k) commitField(e.target); });
detail.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key !== 'Enter' || e.isComposing) return;
  if (el.id === 'comment-text') { e.preventDefault(); postComment(); }
  else if (el.dataset.k && (el.tagName === 'INPUT' || (el.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); commitField(el); }
});
$('#file-still').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; await attachStill(f); });

// Lists use event delegation so re-rendering a region never drops a handler.
const pickFrom = (root) => (e) => { const el = e.target.closest('[data-id]'); if (el && root.contains(el)) selectShot(el.dataset.id); };
const tbody = $('#shot-table tbody'), board = $('#board'), timeline = $('#timeline');
tbody.addEventListener('click', pickFrom(tbody));
tbody.addEventListener('keydown', (e) => { if (arrowNav(e, $$('tr[data-fk]', tbody), NAV_ROWS)) return; if (isActivate(e) && e.target.matches('tr')) { e.preventDefault(); selectShot(e.target.dataset.id); } });
board.addEventListener('click', pickFrom(board));
board.addEventListener('keydown', (e) => { if (arrowNav(e, $$('.card', board), NAV_ANY)) return; if (isActivate(e) && e.target.matches('.card')) { e.preventDefault(); selectShot(e.target.dataset.id); } });
const hoverPlay = (on) => (e) => { const card = e.target.closest?.('.card'); if (!card || card.contains(e.relatedTarget)) return; const v = $('video', card); if (v) { if (on) v.play().catch(() => {}); else v.pause(); } };
board.addEventListener('mouseover', hoverPlay(true)); board.addEventListener('mouseout', hoverPlay(false));
board.addEventListener('focusin', hoverPlay(true)); board.addEventListener('focusout', hoverPlay(false));
timeline.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg'); if (!seg || !state.project) return;
  const r = timeline.getBoundingClientRect();
  // A pointer click seeks to the exact time under the pointer; keyboard activation seeks to the start of the shot.
  seek(e.detail > 0 && r.width > 0 ? ((e.clientX - r.left) / r.width) * totalDuration() : startOf(Number(seg.dataset.i)) + 0.0005);
});
timeline.addEventListener('keydown', (e) => { arrowNav(e, $$('.seg', timeline), NAV_LINE); });
$('#play').addEventListener('click', () => { if (state.project) playFrom(Math.max(0, shots().findIndex((s) => s.id === state.shotId))); });
$('#stop').addEventListener('click', stopPlay);

$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === state.tab) return; if (state.tab === 'animatic') stopPlay(); state.tab = b.dataset.tab; renderAll(); });
$('#projects').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (act === 'open') { state.confirmDelete = null; openProject(id); }
  else if (act === 'delete-ask') { state.confirmDelete = id; renderProjects(); focusKey($('#projects'), 'del-no'); }
  else if (act === 'delete-no') { state.confirmDelete = null; renderProjects(); focusKey($('#projects'), `del-${id}`); }
  else if (act === 'delete-yes') {
    b.disabled = true;
    try { await api(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('project deleted'); } catch (err) { if (err.status !== 404) { b.disabled = false; return toast(err.message, true); } }
    state.confirmDelete = null;
    state.projects = state.projects.filter((p) => String(p.id) !== id);
    if (state.project?.id === id) closeProject(); else renderProjects();
    $('#btn-new').focus();
  }
});
const showNew = (v) => { $('#new-project').hidden = !v; if (v) $('#new-title').focus(); };
$('#btn-new').onclick = () => showNew(true); $('#btn-empty-new').onclick = () => showNew(true); $('#btn-cancel').onclick = () => showNew(false);
$('#btn-sample').onclick = async () => { try { const res = await fetch('/api/samples/the_lantern_keeper.fountain'); if (!res.ok) throw new Error(`sample script: HTTP ${res.status}`); $('#new-text').value = await res.text(); $('#new-title').value = 'The Lantern Keeper'; } catch (e) { toast(e.message || 'Server unreachable', true); } };
$('#btn-create').onclick = () => busy($('#btn-create'), async () => {
  const text = $('#new-text').value.trim(); if (!text) return toast('paste a script first', true);
  try {
    const p = normalize((await api(API, { method: 'POST', body: { title: $('#new-title').value.trim() || 'Untitled', text } })).project);
    showNew(false); $('#new-text').value = ''; $('#new-title').value = '';
    await loadProjects().catch(() => {}); await openProject(p.id);
    toast(`${p.shots.length} shots proposed from ${p.scenes.length} scenes`);
  } catch (e) { toast(e.message, true); }
});
const roleSel = $('#role');
roleSel.replaceChildren(...ROLES.map((r) => new Option(r, r)));
state.role = cls(store.get('fabled.film.role'), ROLES) || ROLES[0];
roleSel.value = state.role;
roleSel.onchange = () => { state.role = cls(roleSel.value, ROLES) || ROLES[0]; store.set('fabled.film.role', state.role); };
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.project?.id && state.projects.some((p) => p.id === id)) openProject(id); });

// ---- collaboration: revision polling ---------------------------------------------------------------------------------
// One request at a time. When the server cannot be reached the pill says "offline" and the delay doubles (3 s … 30 s);
// the next successful answer puts everything back. `?rev=` lets a newer server answer {unchanged:true, progress:[…]}.
const POLL_MS = 3000, POLL_MAX_MS = 30000;
const poll = { timer: 0, busy: false, fails: 0, n: 0 };
function setSync(text, kind) { const el = $('#sync'); if (el.textContent !== text) el.textContent = text; el.className = `pill ${kind}`; }
function applyProgress(list) {
  let changed = false;
  for (const it of arr(list).filter(isObj)) {
    const s = shots().find((x) => x.clip && (x.id === String(it.id) || x.clip.task_id === it.id));
    if (!s) continue;
    if (it.progress != null && s.clip.progress !== it.progress) { s.clip.progress = it.progress; changed = true; }
    if (cls(it.status, CLIP_STATUSES) && s.clip.status !== it.status) { s.clip.status = it.status; changed = true; }
  }
  if (changed) keepScroll(() => guard('detail', renderDetail));
}
async function pollOnce() {
  if (poll.busy) return;
  poll.busy = true; clearTimeout(poll.timer);
  let delay = POLL_MS;
  try {
    poll.n += 1;
    const open = state.project, seq = state.seq;
    if (open) {
      const r = await api(`${API}/${encodeURIComponent(open.id)}/clips?rev=${encodeURIComponent(state.rev)}`, { timeoutMs: 15000 });
      // Ignore the answer if a mutation was applied (or the project changed) while this request was in flight.
      if (state.seq === seq) {
        if (isObj(r.project)) { if (r.project.rev !== state.rev) applyProject(r.project); } else applyProgress(r.progress);
      }
    }
    if (poll.n % (open ? 5 : 2) === 0 || poll.fails) await loadProjects();
    poll.fails = 0; setSync('synced', 'ok');
  } catch (e) {
    if (e.status === 404 && state.project) { toast('This project was deleted', true); closeProject(); loadProjects().catch(() => {}); }
    else {
      poll.fails += 1; delay = Math.min(POLL_MAX_MS, POLL_MS * 2 ** Math.min(poll.fails, 5));
      setSync(e.offline ? `offline · retrying in ${Math.round(delay / 1000)} s` : `sync error (${e.message}) · retrying`, 'failed');
    }
  } finally { poll.busy = false; clearTimeout(poll.timer); poll.timer = setTimeout(pollOnce, delay); }
}
function pollSoon() { clearTimeout(poll.timer); poll.timer = setTimeout(pollOnce, 150); }
window.addEventListener('online', pollSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden && poll.fails) pollSoon(); });

renderAll();
await loadStatus().catch((e) => toast(e.message, true));
await loadProjects().catch((e) => toast(e.message, true));
const initial = location.hash.slice(1);
if (initial && state.projects.some((p) => p.id === initial)) await openProject(initial);
poll.timer = setTimeout(pollOnce, POLL_MS);
