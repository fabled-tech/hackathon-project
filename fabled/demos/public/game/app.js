// Fabled Forge client. Plain ES module, no dependencies, no build step. Talks to /api/game/*.
//
// Rules to keep when editing this file:
//  - Every value that came from the server goes through html`` (escapes by default), cls() (class whitelist),
//    num() (numbers), catColor() (style values) or safeUrl() (URLs). Never concatenate server strings into markup.
//  - A region is re-rendered only when its markup changed (setHtml). Form controls live in a skeleton that is built
//    once per selected asset and then synced, so a poll never destroys input that is in progress.
//  - The layout editor works on a local copy (`lay`). A poll never replaces it while it has unsaved changes.
//  - All mutating requests go through mutate(): JSON content type, optional If-Match, 409/400 handling.

// ---- tiny helpers (the same block lives in ../film/app.js; keep the two in step) --------------------------------
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
const localTime = (at) => { const d = new Date(typeof at === 'string' ? at : NaN); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
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
const API = '/api/game/projects';
const STATUS_FLOW = ['requested', 'generating', 'generated', 'in_pipeline', 'validated', 'imported'];
const STATUS_LABEL = { requested: 'Requested', generating: 'Generating', generated: 'Generated', in_pipeline: 'In pipeline', validated: 'Validated', imported: 'Imported to Unreal' };
const CAT_COLOR = { character: '#a78bfa', creature: '#f472b6', prop: '#fbbf24', environment: '#34d399', vehicle: '#38bdf8' };
const CATEGORIES = Object.keys(CAT_COLOR);
// The only way a category becomes a colour (style attribute or canvas): a fixed palette, grey for anything unknown.
const catColor = (c) => (typeof c === 'string' && Object.hasOwn(CAT_COLOR, c) ? CAT_COLOR[c] : '#8b95a7');
const GEN_STATUSES = ['queued', 'running', 'succeeded', 'failed'];
const ROLES = ['designer', 'character artist', 'environment artist', 'vendor', 'tech art director'];
const CONFLICT_MSG = 'Someone else changed this; your edit was not applied';

const state = { projects: [], project: null, assetId: null, tab: 'board', role: ROLES[0], providers: [], studio: '', rev: 0, seq: 0, confirmDelete: null, sel: null, drag: null };
const dirty = new Map();   // `${assetId}\n${field}` -> value picked but not accepted by the server yet
const drafts = new Map();  // `c\n${assetId}` -> comment being written, `p\n${assetId}` -> edited generation prompt
const as = () => `?as=${encodeURIComponent(state.role)}`;
const assets = () => (state.project ? state.project.assets : []);
const assetById = (id) => assets().find((a) => a.id === id) || null;
const projUrl = (tail = '') => `${API}/${encodeURIComponent(state.project.id)}${tail}${as()}`;
const assetUrl = (id, tail = '') => projUrl(`/assets/${encodeURIComponent(id)}${tail}`);
const fmt = (n) => num(n).toLocaleString('en-US');
const pct = (v) => clamp(Math.round(num(v)), 0, 100);
const statusOf = (a) => cls(a.status, STATUS_FLOW);
const statusLabel = (a) => (statusOf(a) ? STATUS_LABEL[statusOf(a)] : String(a.status ?? 'unknown'));
const pill = (value, allowed, label = value) => html`<span class="pill ${cls(value, allowed)}">${label}</span>`;
const MOCK_BADGE = html`<span class="badge-mockup">CONCEPT MOCKUP</span>`;
const defaultPrompt = (a) => (typeof a.generation?.prompt === 'string' && a.generation.prompt) || `${a.name ?? a.asset_name}, ${String(state.project.style ?? '').toLowerCase()} game asset, ${a.category}, clean silhouette, single object, neutral pose`;

// ---- data -----------------------------------------------------------------------------------------------------------
function normalize(p) {
  if (!isObj(p)) return null;
  for (const k of ['assets', 'activity', 'roles']) p[k] = arr(p[k]);
  p.id = String(p.id ?? '');
  p.assets = p.assets.filter(isObj);
  for (const a of p.assets) { a.id = String(a.id ?? ''); a.asset_name = String(a.asset_name ?? ''); a.comments = arr(a.comments).filter(isObj); if (!isObj(a.generation)) a.generation = null; if (!isObj(a.budget)) a.budget = {}; }
  p.activity = p.activity.filter(isObj);
  if (!isObj(p.summary)) p.summary = {};
  return p;
}
async function loadStatus() {
  const s = await api('/api/status');
  state.studio = safeUrl(s.studio_url);
  state.providers = arr(s.providers).filter((p) => isObj(p) && arr(p.kinds).includes('text-to-3d'));
  const sel = $('#provider');
  sel.replaceChildren(...state.providers.map((p) => { const o = new Option(`${p.name}${p.concept_mockup ? ' (CONCEPT MOCKUP)' : ''}${p.configured ? '' : ' — not configured'}`, String(p.id)); o.disabled = !p.configured; return o; }));
  const saved = store.get('fabled.game.provider');
  const pick = state.providers.find((p) => p.configured && String(p.id) === saved) || state.providers.find((p) => p.configured);
  if (pick) sel.value = String(pick.id);
}
async function loadProjects() { state.projects = arr((await api(API)).projects).filter(isObj); renderProjects(); }
let openToken = 0;
async function openProject(id) {
  if (lay.dirty && state.project && id !== state.project.id && !window.confirm('The level layout has unsaved changes. Open the other project and discard them?')) return;
  const token = ++openToken;
  try {
    const p = normalize((await api(`${API}/${encodeURIComponent(id)}`)).project);
    if (token !== openToken || !p) return;
    state.project = p; state.rev = p.rev; state.seq += 1;
    state.assetId = p.assets[0]?.id ?? null; state.sel = null; state.drag = null;
    lay.dirty = false; adoptLayout(p);
    if (location.hash.slice(1) !== p.id) location.hash = p.id;
    renderAll();
  } catch (e) { toast(e.message, true); if (e.status === 404) loadProjects().catch(() => {}); }
}
function closeProject() {
  openToken += 1;
  state.project = null; state.assetId = null; state.sel = null; state.drag = null; state.rev = 0; state.seq += 1;
  Object.assign(lay, { items: [], dirty: false, theirs: null, base: '' });
  history.replaceState(null, '', location.pathname + location.search);
  renderAll();
}
// A newer copy of the open project (from a mutation, a 409 body or a poll). Never touches input that is in progress
// and never replaces a layout that has unsaved changes (see adoptLayout).
function applyProject(p) {
  p = normalize(p);
  if (!p || !state.project || p.id !== state.project.id) return;
  state.project = p; state.rev = p.rev; state.seq += 1;
  if (!assetById(state.assetId)) state.assetId = p.assets[0]?.id ?? null;
  adoptLayout(p);
  keepScroll(renderAll);
}
// One path for every mutating request. Returns {ok, data} or {ok:false, conflict|offline|status}.
// `before(data)` runs on success just before the returned project is applied.
async function mutate(method, url, body, { ifMatch = false, before } = {}) {
  try {
    const data = await api(url, { method, body, ifMatch: ifMatch ? state.rev : undefined });
    if (before) before(data);
    if (data.project) applyProject(data.project);
    return { ok: true, data };
  } catch (e) {
    if (e.status === 409 && isObj(e.body?.project)) { applyProject(e.body.project); toast(CONFLICT_MSG, true, 7000); return { ok: false, conflict: true }; }
    toast(e.offline ? 'Server unreachable; your change was not saved' : e.message, true);
    if (e.offline) pollSoon();
    return { ok: false, offline: !!e.offline, status: e.status };
  }
}

// ---- render ---------------------------------------------------------------------------------------------------------
function renderProjects() {
  setHtml($('#projects'), state.projects.length ? html`${state.projects.map((p) => {
    const id = String(p.id ?? ''), active = state.project?.id === id, n = p.summary?.total;
    if (state.confirmDelete === id) return html`<div class="proj-row confirm" role="group" aria-label="Confirm delete"><span class="small">Delete “${p.title}” for everyone? This cannot be undone.</span><span class="row"><button class="btn tiny danger" data-act="delete-yes" data-id="${id}" data-fk="del-yes">Delete</button><button class="btn tiny" data-act="delete-no" data-id="${id}" data-fk="del-no">Cancel</button></span></div>`;
    return html`<div class="proj-row"><button class="item ${active ? 'active' : ''}" data-act="open" data-id="${id}" data-fk="open-${id}" ${active ? new Raw('aria-current="true"') : ''}>${p.title} <span class="muted small">· ${n == null ? '?' : num(n)} assets</span></button><button class="icon-btn" data-act="delete-ask" data-id="${id}" data-fk="del-${id}" aria-label="Delete project ${p.title}" title="Delete project">✕</button></div>`;
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
  if (!p) { setHtml($('#kit-summary'), html``); setHtml($('#activity'), html``); return; }
  const cats = isObj(p.summary.by_category) ? Object.entries(p.summary.by_category) : [];
  setHtml($('#kit-summary'), html`<h2>${p.title}</h2><div class="row"><span class="pill wrap">${p.genre}</span><span class="pill wrap">${p.camera}</span><span class="pill wrap">${p.style}</span><span class="pill wrap">${p.engine}</span></div>
    <div class="row sub">${cats.map(([k, v]) => html`<div class="stat"><b style="color:${catColor(k)}">${num(v)}</b><span>${k}</span></div>`)}</div>
    <p class="small muted sub">LOD0 budget across the kit: <b>${fmt(p.summary.lod0_triangles_total)}</b> tris <span class="badge-est">DEMO PLACEHOLDER VALUES</span></p>`);
  setHtml($('#activity'), html`${[...p.activity].reverse().slice(0, 30).map((a) => html`<li><span class="muted" title="${a.at}">${localTime(a.at)}</span> <b>${a.who}</b> ${a.what}</li>`)}`);
}
function renderMain() {
  if (!state.project) return;
  if (state.tab === 'board') renderKanban();
  else if (state.tab === 'layout') renderLayout();
  else if (state.tab === 'profiles') renderProfiles();
  else if (state.tab === 'unreal') renderUnreal();
}
function renderKanban() {
  const list = assets();
  const done = list.filter((a) => ['validated', 'imported'].includes(a.status)).length;
  setHtml($('#stats'), html`<div class="stat"><b>${list.length}</b><span>assets</span></div><div class="stat"><b>${list.filter((a) => a.status === 'generating').length}</b><span>generating</span></div><div class="stat"><b>${done}/${list.length}</b><span>validated+</span></div><div class="stat"><b>${lay.items.length}</b><span>placed</span></div>`);
  // An asset whose status is not one of ours still shows up (first column) with its raw status as text.
  setHtml($('#kanban'), html`${STATUS_FLOW.map((st) => {
    const cards = list.filter((a) => (statusOf(a) || STATUS_FLOW[0]) === st);
    return html`<div class="col" role="group" aria-label="${STATUS_LABEL[st]}, ${cards.length} assets"><h3>${STATUS_LABEL[st]}<span>${cards.length}</span></h3>${cards.map((a) => {
      const active = a.id === state.assetId, g = a.generation;
      return html`<div class="card ${active ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${active ? 'true' : 'false'}" aria-label="${a.asset_name}, ${a.category}, ${statusLabel(a)}, assigned to ${a.assignee}" data-id="${a.id}" data-fk="card-${a.id}"><div class="name"><span class="swatch" style="background:${catColor(a.category)}"></span>${a.asset_name}</div><div class="cat">${a.category} · ${a.assignee}</div>${statusOf(a) ? '' : html`<div class="sub">${pill(a.status, STATUS_FLOW)}</div>`}${g && a.status === 'generating' ? html`<div class="progress" role="progressbar" aria-label="Generation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(g.progress)}"><i style="width:${pct(g.progress)}%"></i></div>` : ''}${g?.concept_mockup ? html`<div class="sub">${MOCK_BADGE}</div>` : ''}${a.comments.length ? html`<div class="small muted sub">💬 ${a.comments.length}</div>` : ''}</div>`;
    })}</div>`;
  })}`);
}
function renderProfiles() {
  const list = assets(), tabId = assetById(state.assetId) ? state.assetId : list[0]?.id;
  setHtml($('#tab-profiles'), html`<p class="muted">One import profile per asset, derived from its category. These are the rules Fabled Studio's pre-import validator checks a delivered mesh against. <span class="badge-est">DEMO PLACEHOLDER VALUES</span></p><p class="sr-only" id="profiles-help">Use the up and down arrow keys to move between assets, Enter to select one.</p><div class="table-wrap"><table class="grid" aria-describedby="profiles-help"><thead><tr><th>Asset</th><th>Category</th><th>Profile</th><th>Up</th><th>Height cm</th><th>LOD tris</th><th>Texel px/cm</th><th>Textures</th><th>Rig</th></tr></thead><tbody>${list.map((a) => {
    const b = a.budget, active = a.id === state.assetId;
    return html`<tr class="${active ? 'active' : ''}" data-id="${a.id}" data-fk="row-${a.id}" tabindex="${a.id === tabId ? 0 : -1}" ${active ? new Raw('aria-current="true"') : ''}><td class="mono">${a.asset_name}</td><td>${a.category}</td><td class="mono">${a.import_profile}</td><td>${b.up_axis}</td><td>${arr(b.height_cm).map((x) => num(x)).join('–')}</td><td class="mono">${arr(b.lods_triangles).map(fmt).join(' / ')}</td><td>${num(b.texel_density_px_per_cm)}</td><td>${num(b.texture_px)}²</td><td>${b.rig}</td></tr>`;
  })}</tbody></table></div>`);
}
function renderUnreal() {
  const p = state.project, base = `${API}/${encodeURIComponent(p.id)}/export/`;
  setHtml($('#tab-unreal'), html`<div class="card"><h3>Hand-off to Unreal Engine</h3><p class="muted">The blockout plan lists one actor per placed item with the content path Fabled Studio's importer uses (<code class="mono">/Game/Fabled/&lt;Asset&gt;/&lt;Asset&gt;</code>). Where the asset is not imported yet, the builder spawns a placeholder box at the budgeted footprint and height, so the level reads before art exists and swaps to the real mesh later.</p>
    <ol class="steps muted"><li>Download <a href="${base}blockout_plan.json">blockout_plan.json</a> and <a href="${base}unreal.py">blockout_from_layout.py</a>.</li><li>Enable <b>Python Editor Script Plugin</b> in Unreal Engine 5.6 or later.</li><li>Output Log: <code class="mono">py "…/blockout_from_layout.py" --plan "…/blockout_plan.json" --folder Fabled/Blockout</code></li><li>Import validated assets with Fabled Studio's <code class="mono">unreal/import_fabled_asset.py</code>; re-run the builder to replace boxes with meshes.</li></ol>
    <p class="small"><span class="badge-est">UNTESTED DRAFT</span> Not executed in an editor from this environment; see the script header. Live editing through the Remote Control API is described in the script as a follow-up.</p></div>
    <div class="card"><h3>Other exports</h3><div class="row"><a class="btn tiny" href="${base}kit.json">Kit JSON (fabled.kit/0.1)</a><a class="btn tiny" href="${base}layout.json">Layout JSON (fabled.layout/0.1)</a><a class="btn tiny" href="${base}import_profiles.json">Import profiles JSON</a></div><p class="small muted sub">Import profiles feed Fabled Studio's validator; the kit JSON is the vendor-facing brief. Exports use the last <b>saved</b> layout.</p></div>
    <div class="card"><h3>Blockout plan preview</h3><pre class="code" id="plan-preview" tabindex="0" aria-label="Blockout plan preview">loading…</pre></div>`);
  loadPlanPreview(`${base}blockout_plan.json`);
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
    const j = await res.json(), list = arr(j.actors);
    text = JSON.stringify({ ...j, actors: list.length > 3 ? [...list.slice(0, 3), `… ${list.length - 3} more`] : list }, null, 2);
  } catch { text = 'Preview unavailable (the download links above still work).'; plan.key = null; }
  const pre = $('#plan-preview');
  if (pre && state.project && key.startsWith(`${state.project.id}@`) && pre.textContent !== text) keepScroll(() => { pre.textContent = text; });
}

// ---- detail pane ------------------------------------------------------------------------------------------------------
let detailFor = null; // asset id the skeleton was built for
const dkey = (id, k) => `${id}\n${k}`;
function buildDetail(a) {
  detailFor = a.id;
  const root = $('#detail');
  root._html = null;
  root.innerHTML = `<div class="section"><h2 id="d-title"></h2>
    <div class="row" id="d-pills"></div>
    <div class="detail-field"><label for="f-assignee">Assignee</label><select id="f-assignee" data-k="assignee"></select></div>
    <div class="detail-field"><label for="f-category">Category</label><select id="f-category" data-k="category"></select></div>
    <div id="d-budget"></div>
  </div>
  <div class="section"><h2>Generate</h2>
    <label class="small muted block" for="gen-prompt">Generation prompt</label><textarea id="gen-prompt" maxlength="2000"></textarea>
    <div class="row sub"><button class="btn tiny primary" id="btn-gen">✦ Text → 3D</button><span class="row" id="d-gen"></span></div>
    <div id="d-gen-extra"></div>
    <p class="small muted sub">Generated meshes are dense and unscaled; that is what Fabled Studio's pipeline and validator are for. Move the card as the asset progresses:</p>
    <div class="row sub" id="d-flow" role="group" aria-label="Asset status"></div>
  </div>
  <div class="section"><h2 id="d-comments-title"></h2><div id="d-comments"></div>
    <div class="row sub"><label class="sr-only" for="comment-text">Feedback for the artist or vendor</label><input type="text" id="comment-text" placeholder="Feedback for the artist / vendor…" maxlength="2000" autocomplete="off" /><button class="btn tiny" id="btn-comment">Post</button></div></div>`;
  $('#comment-text').value = drafts.get(dkey('c', a.id)) ?? '';
  for (const el of $$('[data-k]', root)) if (dirty.has(dkey(a.id, el.dataset.k))) el.value = dirty.get(dkey(a.id, el.dataset.k));
  const can = state.providers.some((x) => x.configured);
  $('#btn-gen').disabled = !can;
  if (!can) $('#btn-gen').title = 'No text→3D provider is configured on this server';
}
function renderDetail() {
  const root = $('#detail'), p = state.project, a = p && assetById(state.assetId);
  if (!a) { detailFor = null; setHtml(root, html`<div class="section"><h2>Asset</h2><p class="muted small">${p ? 'Select a card.' : 'Open a project, then select a card.'}</p></div>`); return; }
  if (detailFor !== a.id || !$('#d-title')) buildDetail(a);
  const g = a.generation, b = a.budget, idx = STATUS_FLOW.indexOf(a.status);
  setHtml($('#d-title'), html`<span class="swatch" style="background:${catColor(a.category)}"></span>${a.asset_name}`);
  setHtml($('#d-pills'), html`${pill(a.status, STATUS_FLOW, statusLabel(a))}<span class="pill">${a.category}</span><span class="muted small">${a.source}</span>`);
  syncOptions($('#f-assignee'), p.roles.length ? p.roles : ROLES, a.assignee);
  syncOptions($('#f-category'), CATEGORIES, a.category);
  for (const el of $$('[data-k]', root)) {
    const k = el.dataset.k, stored = String(a[k] ?? '');
    el.dataset.stored = stored;
    const isDirty = dirty.has(dkey(a.id, k));
    el.classList.toggle('unsaved', isDirty);
    if (!isDirty) setValue(el, stored);
  }
  setHtml($('#d-budget'), html`<div class="detail-field"><span class="muted">Profile</span><span class="mono">${a.import_profile}</span></div>
    <div class="detail-field"><span class="muted">LOD budget</span><span class="mono">${arr(b.lods_triangles).map(fmt).join(' / ')}</span></div>
    <div class="detail-field"><span class="muted">Height</span><span>${arr(b.height_cm).map((x) => num(x)).join('–')} cm, ${b.up_axis}-up, rig ${b.rig} <span class="badge-est">DEMO PLACEHOLDER VALUES</span></span></div>`);
  // The prompt box follows the stored prompt until the user edits it; an edited prompt is a draft and is left alone.
  const prompt = $('#gen-prompt'), draft = drafts.get(dkey('p', a.id));
  prompt.dataset.stored = defaultPrompt(a);
  if (draft === undefined) setValue(prompt, prompt.dataset.stored); else if (prompt.value !== draft && document.activeElement !== prompt) prompt.value = draft;
  setHtml($('#d-gen'), html`${g ? html`<span class="pill ${cls(g.status, GEN_STATUSES)}">${g.provider}: ${g.status}${g.progress != null && g.status !== 'succeeded' ? html` ${pct(g.progress)}%` : ''}</span>` : ''}${g?.concept_mockup ? MOCK_BADGE : ''}`);
  const model = arr(g?.outputs).find((o) => isObj(o) && o.type === 'model');
  const href = model ? safeUrl(model.url) || (typeof model.local === 'string' && model.local ? `/api/mock-models/${encodeURIComponent(model.local.split('/').pop())}` : '') : '';
  setHtml($('#d-gen-extra'), html`${g?.error ? html`<p class="small err-text">${g.error}</p>` : ''}${href ? html`<p class="small sub"><a href="${href}" download>Download mesh (${model.format})</a>${state.studio ? html` · then <a href="${state.studio}" target="_blank" rel="noopener noreferrer">open Fabled Studio</a> to run retopo, LODs, bake and the pre-import check against <span class="mono">${a.import_profile}</span>` : ''}.</p>` : ''}`);
  setHtml($('#d-flow'), html`${STATUS_FLOW.map((s, i) => html`<button class="btn tiny ${i === idx ? 'primary' : ''}" data-status="${s}" data-fk="st-${s}" title="${STATUS_LABEL[s]}" aria-label="Set status: ${STATUS_LABEL[s]}" aria-pressed="${i === idx ? 'true' : 'false'}">${i + 1}</button>`)}<span class="small muted">${statusLabel(a)}</span>`);
  setHtml($('#d-comments-title'), html`Comments (${a.comments.length})`);
  setHtml($('#d-comments'), html`${a.comments.map((c) => html`<div class="comment"><span class="who">${c.who}</span><span class="muted small" title="${c.at}">${localTime(c.at)}</span><div>${c.text}</div></div>`)}`);
}
function selectAsset(id) {
  if (id == null || !assetById(id) || id === state.assetId) return;
  state.assetId = id;
  renderMain(); renderDetail();
}
async function commitField(el) {
  const k = el.dataset.k, id = detailFor, key = dkey(id, k);
  if (!state.project || !assetById(id)) return;
  if (el._saving) { dirty.set(key, el.value); el._again = true; return; } // changed again while the last save is in flight
  if (el.value === el.dataset.stored) { dirty.delete(key); el.classList.remove('unsaved'); return; }
  const sent = el.value;
  dirty.set(key, sent); el._saving = true;
  const r = await mutate('PATCH', assetUrl(id), { [k]: sent }, { ifMatch: true });
  el._saving = false;
  // Success: the stored value wins unless the user picked again meanwhile. Failure (400, 409, offline): revert.
  if (!(r.ok && dirty.get(key) !== sent)) dirty.delete(key);
  renderDetail();
  if (el._again) { el._again = false; if (r.ok && el.isConnected && detailFor === id && el.value !== el.dataset.stored) commitField(el); }
}
async function postComment() {
  const input = $('#comment-text'), btn = $('#btn-comment'), id = detailFor, text = input.value.trim();
  if (!text || btn.disabled) return;
  btn.disabled = true;
  const r = await mutate('POST', assetUrl(id, '/comments'), { text });
  btn.disabled = false;
  if (r.ok) { drafts.delete(dkey('c', id)); if (detailFor === id && input.isConnected) { input.value = ''; if (document.activeElement === btn || document.activeElement === document.body) input.focus(); } }
}
async function generate(id) {
  const prompt = $('#gen-prompt').value.trim(), provider = $('#provider').value;
  const r = await mutate('POST', assetUrl(id, '/generate'), { provider, ...(prompt ? { prompt } : {}) }, { before: () => drafts.delete(dkey('p', id)) });
  if (r.ok) toast(`${r.data.task?.provider_name ?? provider}: generation started`);
}

// ---- top-down layout editor ----------------------------------------------------------------------------------------
// `lay` is the local working copy. `base` is the signature of the server layout it was last in step with, `dirty`
// says the local copy differs from it, and `theirs` holds a newer server layout that arrived while dirty.
const cv = $('#layout-canvas'), ctx = cv.getContext('2d');
const lay = { items: [], spawn: { x: 0, y: 0, z: 0, yaw: 0 }, size_cm: 4000, grid_cm: 100, base: '', dirty: false, theirs: null };
const normItem = (it) => ({ ...it, id: String(it.id ?? ''), asset_id: String(it.asset_id ?? ''), asset_name: String(it.asset_name ?? ''), x: num(it.x), y: num(it.y), z: num(it.z), yaw: num(it.yaw), scale: clamp(num(it.scale, 1) || 1, 0.1, 10), footprint_cm: [Math.max(1, num(arr(it.footprint_cm)[0], 60)), Math.max(1, num(arr(it.footprint_cm)[1], 60))] });
function serverLayout(p) {
  const L = isObj(p.layout) ? p.layout : {}, sp = isObj(L.spawn) ? L.spawn : {};
  return { size_cm: num(L.size_cm) > 0 ? num(L.size_cm) : 4000, grid_cm: num(L.grid_cm) > 0 ? num(L.grid_cm) : 100, spawn: { ...sp, x: num(sp.x), y: num(sp.y), z: num(sp.z), yaw: num(sp.yaw) }, items: arr(L.items).filter(isObj).map(normItem) };
}
const layoutSig = (L) => JSON.stringify([L.items.map((it) => [it.id, it.asset_id, it.x, it.y, it.z, it.yaw, it.scale]), [L.spawn.x, L.spawn.y, L.spawn.z, L.spawn.yaw]]);
function takeLayout(L, sig = layoutSig(L)) {
  Object.assign(lay, { items: L.items, spawn: L.spawn, size_cm: L.size_cm, grid_cm: L.grid_cm, base: sig, dirty: false, theirs: null });
  if (!lay.items.some((it) => it.id === state.sel)) state.sel = null;
}
function adoptLayout(p) {
  const theirs = serverLayout(p), sig = layoutSig(theirs);
  if (!lay.dirty || sig === layoutSig(lay)) takeLayout(theirs, sig);     // nothing local to lose
  else if (sig !== lay.base) lay.theirs = { ...theirs, sig };            // someone saved a layout under our unsaved edits
  else lay.theirs = null;                                                // server layout is still the one we started from
}
// Call after every local edit.
function touch() {
  lay.dirty = layoutSig(lay) !== lay.base;
  if (!lay.dirty && lay.theirs) takeLayout(lay.theirs, lay.theirs.sig);
  renderLayout();
}
const selItem = () => lay.items.find((it) => it.id === state.sel) || null;
const metres = (cm) => { const m = Math.round(cm) / 100; return `${m === 0 ? 0 : m} m`; };
const describe = (it) => `${it.asset_name.replace(/^SM_/, '') || 'item'}: x ${metres(it.x)}, y ${metres(it.y)}, yaw ${Math.round(it.yaw)}°, scale ${it.scale.toFixed(1)}`;
function renderLayout() {
  drawLayout();
  const it = selItem(), g = metres(lay.grid_cm), size = metres(lay.size_cm);
  $('#layout-dirty').hidden = !lay.dirty;
  $('#btn-revert-layout').hidden = !lay.dirty;
  $('#btn-save-layout').classList.toggle('primary', lay.dirty);
  $('#layout-conflict').hidden = !lay.theirs;
  $('#layout-dims').textContent = `Grid ${g} · ${size} × ${size}.`;
  const status = it ? `Selected ${describe(it)}.` : 'Nothing selected.';
  const text = `${status}${lay.dirty ? ' Unsaved changes.' : ''}`;
  if ($('#layout-status').textContent !== text) $('#layout-status').textContent = text;
  cv.setAttribute('aria-label', `Level layout, top-down, ${lay.items.length} items placed. ${status} Arrow keys move the selected item, the bracket keys select the previous or next item.`);
  setHtml($('#layout-count'), html`${lay.items.length}`);
  setHtml($('#layout-list'), lay.items.length ? html`${lay.items.map((x) => html`<li><button type="button" class="item ${x.id === state.sel ? 'active' : ''}" data-item="${x.id}" data-fk="it-${x.id}" aria-pressed="${x.id === state.sel ? 'true' : 'false'}"><span class="swatch" style="background:${catColor(x.category)}"></span>${describe(x)}</button></li>`)}` : html`<li class="muted small">Nothing placed yet.</li>`);
  const opts = assets().map((a) => [a.id, a.asset_name]), sig = JSON.stringify(opts), sel = $('#add-asset');
  if (sel._sig !== sig) { const keep = sel.value; sel.replaceChildren(...opts.map(([id, name]) => new Option(name, id))); sel._sig = sig; if (opts.some(([id]) => id === keep)) sel.value = keep; }
  $('#btn-add').disabled = !opts.length;
}
const toPx = (cm) => (cm / lay.size_cm + 0.5) * cv.width;
const toCm = (px) => (px / cv.width - 0.5) * lay.size_cm;
function drawLayout() {
  const half = lay.size_cm / 2;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = '#1f2436'; ctx.lineWidth = 1;
  for (let c = -half; c <= half; c += Math.max(lay.grid_cm * 5, lay.size_cm / 200)) { const p = toPx(c); ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, cv.height); ctx.moveTo(0, p); ctx.lineTo(cv.width, p); ctx.stroke(); }
  ctx.strokeStyle = '#2d3550'; ctx.beginPath(); ctx.moveTo(toPx(0), 0); ctx.lineTo(toPx(0), cv.height); ctx.moveTo(0, toPx(0)); ctx.lineTo(cv.width, toPx(0)); ctx.stroke();
  const sp = lay.spawn;
  ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(toPx(sp.x), toPx(-sp.y), 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8b95a7'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('player spawn', toPx(sp.x) + 10, toPx(-sp.y) + 4);
  for (const it of lay.items) {
    const a = assetById(it.asset_id), [fx, fy] = it.footprint_cm, color = catColor(it.category), selected = state.sel === it.id;
    const w = ((fx * it.scale) / lay.size_cm) * cv.width, h = ((fy * it.scale) / lay.size_cm) * cv.width;
    ctx.save(); ctx.translate(toPx(it.x), toPx(-it.y)); ctx.rotate((-it.yaw * Math.PI) / 180);
    ctx.fillStyle = color + (a?.status === 'imported' ? 'cc' : a?.status === 'validated' ? '99' : '55'); ctx.strokeStyle = selected ? '#f1f5f9' : color; ctx.lineWidth = selected ? 2.5 : 1;
    ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h / 2 - 6); ctx.stroke();
    ctx.rotate((it.yaw * Math.PI) / 180); ctx.fillStyle = '#f1f5f9'; ctx.font = `${selected ? '600 ' : ''}10px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(it.asset_name.replace(/^SM_/, '').slice(0, 40), 0, h / 2 + 11); ctx.restore();
  }
}
const hit = (x, y) => [...lay.items].reverse().find((it) => Math.abs(toCm(x) - it.x) <= Math.max(60, (it.footprint_cm[0] * it.scale) / 2) && Math.abs(-toCm(y) - it.y) <= Math.max(60, (it.footprint_cm[1] * it.scale) / 2));
const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
const snap = (cm) => { const half = lay.size_cm / 2; return clamp(Math.round(cm / lay.grid_cm) * lay.grid_cm, -half, half); };
function selectItem(id) {
  state.sel = id;
  const it = selItem();
  if (it && it.asset_id !== state.assetId && assetById(it.asset_id)) { state.assetId = it.asset_id; renderDetail(); }
  renderLayout();
}
cv.addEventListener('pointerdown', (e) => {
  if (!state.project || e.button > 0) return;
  const [x, y] = pos(e), it = hit(x, y);
  // The drag remembers the item id, not the object, so it survives a remote update that swaps the item list.
  state.drag = it ? { id: it.id, dx: toCm(x) - it.x, dy: -toCm(y) - it.y } : null;
  if (it) { try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } }
  selectItem(it ? it.id : null);
});
cv.addEventListener('pointermove', (e) => {
  const it = state.drag && lay.items.find((x) => x.id === state.drag.id);
  if (!it) return;
  const [x, y] = pos(e), nx = snap(toCm(x) - state.drag.dx), ny = snap(-toCm(y) - state.drag.dy);
  if (nx === it.x && ny === it.y) return;
  it.x = nx; it.y = ny; touch();
});
const endDrag = () => { state.drag = null; };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
// Keyboard: only while the layout tab is showing and focus is on the canvas, the item list or nothing at all, and
// never with Ctrl/Cmd/Alt held (so browser shortcuts such as Ctrl+R keep working). Backspace does nothing on purpose.
window.addEventListener('keydown', (e) => {
  if (state.tab !== 'layout' || !state.project || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target, inList = !!t.closest?.('#layout-list');
  if (t !== cv && t !== document.body && !inList) return;
  const order = lay.items, it = selItem(), g = lay.grid_cm, k = e.key;
  const cycle = (d) => { if (!order.length) return; const i = order.indexOf(it); selectItem(order[(i < 0 ? (d > 0 ? 0 : order.length - 1) : i + d + order.length) % order.length].id); if (inList) focusKey($('#layout-list'), `it-${state.sel}`); };
  if (k === ']') { e.preventDefault(); return cycle(1); }
  if (k === '[') { e.preventDefault(); return cycle(-1); }
  if (!it) { if (t === cv && (k === 'Enter' || k === ' ') && order.length) { e.preventDefault(); selectItem(order[0].id); } return; }
  const step = g * (e.shiftKey ? 5 : 1), move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[k];
  if (move) { it.x = snap(it.x + move[0]); it.y = snap(it.y + move[1]); }
  else if (k === 'r' || k === 'R') it.yaw = (((it.yaw + (e.shiftKey ? -15 : 15)) % 360) + 360) % 360;
  else if (k === 'Delete') { lay.items = lay.items.filter((x) => x !== it); state.sel = null; if (inList) cv.focus(); }
  else if (k === '+' || k === '=') it.scale = Math.min(10, +(it.scale + 0.1).toFixed(2));
  else if (k === '-') it.scale = Math.max(0.1, +(it.scale - 0.1).toFixed(2));
  else if (k === 'Escape') { state.sel = null; return renderLayout(); }
  else return;
  e.preventDefault();
  touch();
});
// Next free grid spot: walk outward from the centre ring by ring until the asset's footprint clears every placed
// item (bounding squares, so it holds for any yaw) and the player spawn. Falls back to the centre on a full map.
function nextFreeSpot(asset) {
  const g = lay.grid_cm, half = lay.size_cm / 2, fp = arr(asset.footprint_cm);
  const mine = Math.max(1, num(fp[0], 60), num(fp[1], 60)) / 2;
  const radius = (it) => (Math.max(it.footprint_cm[0], it.footprint_cm[1]) * it.scale) / 2;
  const clear = (x, y) => lay.items.every((it) => Math.abs(it.x - x) >= radius(it) + mine || Math.abs(it.y - y) >= radius(it) + mine) && (Math.abs(lay.spawn.x - x) >= mine + 50 || Math.abs(lay.spawn.y - y) >= mine + 50);
  const rings = Math.max(0, Math.floor((half - mine) / g));
  for (let n = 0; n <= rings; n += 1) for (let dy = -n; dy <= n; dy += 1) for (let dx = -n; dx <= n; dx += 1) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== n) continue;
    if (clear(dx * g, dy * g)) return { x: dx * g, y: dy * g };
  }
  return { x: 0, y: 0 };
}
async function addPlacement() {
  const asset = assetById($('#add-asset').value);
  if (!asset) return;
  const spot = nextFreeSpot(asset);
  let placed = null;
  const r = await mutate('POST', projUrl('/layout'), { asset_id: asset.id, x: spot.x, y: spot.y }, { before: (data) => {
    placed = isObj(data.item) ? normItem(data.item) : null;
    // With unsaved edits the local copy stays; the new item (already stored by the server) is added to it as well.
    if (lay.dirty && placed) { lay.items.push(placed); if (!lay.theirs && isObj(data.project)) lay.base = layoutSig(serverLayout(data.project)); }
  } });
  if (!r.ok) return;
  if (placed && lay.items.some((it) => it.id === placed.id)) selectItem(placed.id); else renderLayout();
  toast(`${asset.asset_name} placed at x ${metres(spot.x)}, y ${metres(spot.y)}`);
}
async function saveLayout() {
  const sent = layoutSig(lay);
  const r = await mutate('PUT', projUrl('/layout'), { items: lay.items, spawn: lay.spawn }, { ifMatch: true, before: (data) => {
    const saved = isObj(data.project) ? serverLayout(data.project) : null;
    if (layoutSig(lay) === sent) { lay.dirty = false; lay.theirs = null; lay.base = sent; } // nothing edited during the save
    else if (saved) { lay.base = layoutSig(saved); lay.theirs = null; }                      // kept editing: stay dirty against the saved copy
  } });
  if (r.ok) { toast('layout saved'); renderLayout(); if (!r.data.project) pollSoon(); }
}
$('#btn-add').onclick = () => busy($('#btn-add'), addPlacement);
$('#btn-save-layout').onclick = () => busy($('#btn-save-layout'), saveLayout);
$('#btn-revert-layout').onclick = () => { lay.dirty = false; adoptLayout(state.project); renderLayout(); $('#btn-save-layout').focus(); toast('unsaved layout changes discarded'); };
$('#btn-keep-mine').onclick = () => { if (lay.theirs) { lay.base = lay.theirs.sig; lay.theirs = null; } touch(); $('#btn-save-layout').focus(); };
$('#btn-load-theirs').onclick = () => { if (lay.theirs) takeLayout(lay.theirs, lay.theirs.sig); renderLayout(); cv.focus(); };
$('#layout-list').addEventListener('click', (e) => { const b = e.target.closest('[data-item]'); if (b) { selectItem(b.dataset.item); focusKey($('#layout-list'), `it-${b.dataset.item}`); } });
window.addEventListener('beforeunload', (e) => { if (lay.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---- wiring ---------------------------------------------------------------------------------------------------------
async function busy(btn, fn) { if (btn.disabled) return; btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }
const detail = $('#detail');
detail.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !detailFor) return;
  const id = detailFor;
  if (b.dataset.status) mutate('PATCH', assetUrl(id), { status: b.dataset.status }, { ifMatch: true });
  else if (b.id === 'btn-comment') postComment();
  else if (b.id === 'btn-gen') busy(b, () => generate(id));
});
detail.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'comment-text') { if (el.value) drafts.set(dkey('c', detailFor), el.value); else drafts.delete(dkey('c', detailFor)); }
  else if (el.id === 'gen-prompt') { if (el.value !== el.dataset.stored) drafts.set(dkey('p', detailFor), el.value); else drafts.delete(dkey('p', detailFor)); }
});
detail.addEventListener('change', (e) => { if (e.target.dataset.k) commitField(e.target); });
detail.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.target.id === 'comment-text') { e.preventDefault(); postComment(); } });

// Lists use event delegation so re-rendering a region never drops a handler.
const kanban = $('#kanban'), profiles = $('#tab-profiles');
kanban.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) selectAsset(c.dataset.id); });
kanban.addEventListener('keydown', (e) => { if (arrowNav(e, $$('.card', kanban), NAV_ANY)) return; if (isActivate(e) && e.target.matches('.card')) { e.preventDefault(); selectAsset(e.target.dataset.id); } });
profiles.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectAsset(tr.dataset.id); });
profiles.addEventListener('keydown', (e) => { if (arrowNav(e, $$('tr[data-fk]', profiles), NAV_ROWS)) return; if (isActivate(e) && e.target.matches('tr[data-id]')) { e.preventDefault(); selectAsset(e.target.dataset.id); } });

$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === state.tab) return; state.tab = b.dataset.tab; renderAll(); });
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
const showNew = (v) => { $('#new-project').hidden = !v; if (v) $('#new-text').focus(); };
$('#btn-new').onclick = () => showNew(true); $('#btn-empty-new').onclick = () => showNew(true); $('#btn-cancel').onclick = () => showNew(false);
$('#btn-sample').onclick = async () => { try { const res = await fetch('/api/samples/mossgate_pitch.txt'); if (!res.ok) throw new Error(`sample pitch: HTTP ${res.status}`); $('#new-text').value = await res.text(); } catch (e) { toast(e.message || 'Server unreachable', true); } };
$('#btn-create').onclick = () => busy($('#btn-create'), async () => {
  const text = $('#new-text').value.trim(); if (!text) return toast('paste a pitch first', true);
  try {
    const p = normalize((await api(API, { method: 'POST', body: { text } })).project);
    showNew(false); $('#new-text').value = '';
    await loadProjects().catch(() => {}); await openProject(p.id);
    toast(`${p.assets.length} assets in the kit`);
  } catch (e) { toast(e.message, true); }
});
const roleSel = $('#role');
roleSel.replaceChildren(...ROLES.map((r) => new Option(r, r)));
state.role = cls(store.get('fabled.game.role'), ROLES) || ROLES[0];
roleSel.value = state.role;
roleSel.onchange = () => { state.role = cls(roleSel.value, ROLES) || ROLES[0]; store.set('fabled.game.role', state.role); };
$('#provider').onchange = () => store.set('fabled.game.provider', $('#provider').value);
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.project?.id && state.projects.some((p) => p.id === id)) openProject(id); });

// ---- collaboration: revision polling ---------------------------------------------------------------------------------
// One request at a time. When the server cannot be reached the pill says "offline" and the delay doubles (2.5 s … 30 s);
// the next successful answer puts everything back. `?rev=` lets a newer server answer {unchanged:true, progress:[…]}.
const POLL_MS = 2500, POLL_MAX_MS = 30000;
const poll = { timer: 0, busy: false, fails: 0, n: 0 };
function setSync(text, kind) { const el = $('#sync'); if (el.textContent !== text) el.textContent = text; el.className = `pill ${kind}`; }
function applyProgress(list) {
  let changed = false;
  for (const it of arr(list).filter(isObj)) {
    const a = assets().find((x) => x.generation && (x.id === String(it.id) || x.generation.task_id === it.id));
    if (!a) continue;
    if (it.progress != null && a.generation.progress !== it.progress) { a.generation.progress = it.progress; changed = true; }
    if (cls(it.status, GEN_STATUSES) && a.generation.status !== it.status) { a.generation.status = it.status; changed = true; }
  }
  if (changed) keepScroll(() => { guard('main', renderMain); guard('detail', renderDetail); });
}
async function pollOnce() {
  if (poll.busy) return;
  poll.busy = true; clearTimeout(poll.timer);
  let delay = POLL_MS;
  try {
    poll.n += 1;
    const open = state.project, seq = state.seq;
    if (open) {
      const r = await api(`${API}/${encodeURIComponent(open.id)}/generations?rev=${encodeURIComponent(state.rev)}`, { timeoutMs: 15000 });
      // Ignore the answer if a mutation was applied (or the project changed) while this request was in flight.
      if (state.seq === seq) {
        if (isObj(r.project)) { if (r.project.rev !== state.rev) applyProject(r.project); } else applyProgress(r.progress);
      }
    }
    if (poll.n % (open ? 6 : 2) === 0 || poll.fails) await loadProjects();
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
