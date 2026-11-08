// Fabled Forge client. Plain ES module, no dependencies. Talks to /api/game/*.
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STATUS_FLOW = ['requested', 'generating', 'generated', 'in_pipeline', 'validated', 'imported'];
const STATUS_LABEL = { requested: 'Requested', generating: 'Generating', generated: 'Generated', in_pipeline: 'In pipeline', validated: 'Validated', imported: 'Imported to Unreal' };
const CAT_COLOR = { character: '#a78bfa', creature: '#f472b6', prop: '#fbbf24', environment: '#34d399', vehicle: '#38bdf8' };
const state = { projects: [], project: null, assetId: null, tab: 'board', role: 'designer', providers: [], studio: null, rev: 0, drag: null, sel: null };
const api = async (url, opts = {}) => { const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` })); if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`); return j; };
const toast = (m, err = false) => { const t = $('#toast'); t.textContent = m; t.className = `toast${err ? ' err' : ''}`; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4000); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const as = () => `?as=${encodeURIComponent(state.role)}`;
const fmt = (n) => Number(n).toLocaleString('en-US');

async function loadStatus() {
  const s = await api('/api/status'); state.studio = s.studio_url;
  state.providers = s.providers.filter((p) => p.kinds.includes('text-to-3d'));
  $('#provider').innerHTML = state.providers.map((p) => `<option value="${p.id}" ${p.configured ? '' : 'disabled'}>${esc(p.name)}${p.concept_mockup ? ' (CONCEPT MOCKUP)' : ''}${p.configured ? '' : ' — not configured'}</option>`).join('');
  const first = state.providers.find((p) => p.configured); if (first) $('#provider').value = first.id;
}
async function loadProjects() { state.projects = (await api('/api/game/projects')).projects; renderProjects(); }
async function openProject(id) { applyProject((await api(`/api/game/projects/${id}`)).project); state.assetId = state.project.assets[0]?.id || null; location.hash = id; renderAll(); }
function applyProject(p) { state.project = p; state.rev = p.rev; renderAll(); }

function renderProjects() {
  $('#projects').innerHTML = state.projects.map((p) => `<button class="item ${state.project?.id === p.id ? 'active' : ''}" data-id="${p.id}">${esc(p.title)} <span class="muted small">· ${p.summary?.total ?? '?'} assets</span></button>`).join('') || '<p class="muted small">No projects yet.</p>';
  $$('#projects .item').forEach((b) => (b.onclick = () => openProject(b.dataset.id)));
}
function renderAll() {
  const p = state.project; renderProjects(); $('#empty').hidden = !!p; $$('[id^=tab-]').forEach((el) => (el.hidden = !p || el.id !== `tab-${state.tab}`)); if (!p) return;
  $('#kit-summary').innerHTML = `<h2>${esc(p.title)}</h2><div class="row"><span class="pill">${esc(p.genre)}</span><span class="pill">${esc(p.camera)}</span><span class="pill">${esc(p.style)}</span><span class="pill">${esc(p.engine)}</span></div>
    <div class="row" style="margin-top:8px">${Object.entries(p.summary.by_category).map(([k, v]) => `<div class="stat"><b style="color:${CAT_COLOR[k]}">${v}</b><span>${k}</span></div>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">LOD0 budget across the kit: <b>${fmt(p.summary.lod0_triangles_total)}</b> tris <span class="badge-est">placeholder</span></p>`;
  $('#activity').innerHTML = [...p.activity].reverse().slice(0, 30).map((a) => `<li><span class="muted">${a.at.slice(11, 16)}</span> <b>${esc(a.who)}</b> ${esc(a.what)}</li>`).join('');
  const done = p.assets.filter((a) => ['validated', 'imported'].includes(a.status)).length;
  $('#stats').innerHTML = `<div class="stat"><b>${p.assets.length}</b><span>assets</span></div><div class="stat"><b>${p.assets.filter((a) => a.status === 'generating').length}</b><span>generating</span></div><div class="stat"><b>${done}/${p.assets.length}</b><span>validated+</span></div><div class="stat"><b>${p.layout?.items.length ?? 0}</b><span>placed</span></div>`;
  renderKanban(); renderProfiles(); renderUnreal(); renderDetail(); if (state.tab === 'layout') drawLayout();
  $('#add-asset').innerHTML = p.assets.map((a) => `<option value="${a.id}">${esc(a.asset_name)}</option>`).join('');
}
function renderKanban() {
  const p = state.project;
  $('#kanban').innerHTML = STATUS_FLOW.map((st) => { const cards = p.assets.filter((a) => a.status === st); return `<div class="col"><h3>${STATUS_LABEL[st]}<span>${cards.length}</span></h3>${cards.map((a) => `<div class="card ${a.id === state.assetId ? 'active' : ''}" data-id="${a.id}"><div class="name"><span class="swatch" style="background:${CAT_COLOR[a.category]}"></span>${esc(a.asset_name)}</div><div class="cat">${a.category} · ${esc(a.assignee)}</div>${a.generation && a.status === 'generating' ? `<div class="progress"><i style="width:${a.generation.progress || 0}%"></i></div>` : ''}${a.generation?.concept_mockup ? '<span class="badge-mockup" style="margin-top:6px;display:inline-block">CONCEPT MOCKUP</span>' : ''}${a.comments.length ? `<div class="small muted" style="margin-top:4px">💬 ${a.comments.length}</div>` : ''}</div>`).join('')}</div>`; }).join('');
  $$('#kanban .card').forEach((c) => (c.onclick = () => { state.assetId = c.dataset.id; renderAll(); }));
}
function renderProfiles() {
  const p = state.project;
  $('#tab-profiles').innerHTML = `<p class="muted">One import profile per asset, derived from its category. These are the rules Fabled Studio's pre-import validator checks a delivered mesh against. <span class="badge-est">DEMO PLACEHOLDER VALUES</span></p><table class="grid"><thead><tr><th>Asset</th><th>Category</th><th>Profile</th><th>Up</th><th>Height cm</th><th>LOD tris</th><th>Texel px/cm</th><th>Textures</th><th>Rig</th></tr></thead><tbody>${p.assets.map((a) => `<tr class="${a.id === state.assetId ? 'active' : ''}" data-id="${a.id}"><td class="mono">${esc(a.asset_name)}</td><td>${a.category}</td><td class="mono">${esc(a.import_profile)}</td><td>${a.budget.up_axis}</td><td>${a.budget.height_cm.join('–')}</td><td class="mono">${a.budget.lods_triangles.map(fmt).join(' / ')}</td><td>${a.budget.texel_density_px_per_cm}</td><td>${a.budget.texture_px}²</td><td>${a.budget.rig}</td></tr>`).join('')}</tbody></table>`;
  $$('#tab-profiles tr[data-id]').forEach((tr) => (tr.onclick = () => { state.assetId = tr.dataset.id; renderAll(); }));
}
function renderUnreal() {
  const p = state.project, base = `/api/game/projects/${p.id}/export/`;
  $('#tab-unreal').innerHTML = `<div class="card"><h3 style="margin:0 0 6px">Hand-off to Unreal Engine</h3><p class="muted">The blockout plan lists one actor per placed item with the content path Fabled Studio's importer uses (<code class="mono">/Game/Fabled/&lt;Asset&gt;/&lt;Asset&gt;</code>). Where the asset is not imported yet, the builder spawns a placeholder box at the budgeted footprint and height, so the level reads before art exists and swaps to the real mesh later.</p>
    <ol class="steps muted"><li>Download <a href="${base}blockout_plan.json">blockout_plan.json</a> and <a href="${base}unreal.py">blockout_from_layout.py</a>.</li><li>Enable <b>Python Editor Script Plugin</b> in Unreal Engine 5.6 or later.</li><li>Output Log: <code class="mono">py "…/blockout_from_layout.py" --plan "…/blockout_plan.json" --folder Fabled/Blockout</code></li><li>Import validated assets with Fabled Studio's <code class="mono">unreal/import_fabled_asset.py</code>; re-run the builder to replace boxes with meshes.</li></ol>
    <p class="small"><span class="badge-est">UNTESTED DRAFT</span> Not executed in an editor from this environment; see the script header. Live editing through the Remote Control API is described in the script as a follow-up.</p></div>
    <div class="card"><h3 style="margin:0 0 6px">Other exports</h3><div class="row"><a class="btn tiny" href="${base}kit.json">Kit JSON (fabled.kit/0.1)</a><a class="btn tiny" href="${base}layout.json">Layout JSON (fabled.layout/0.1)</a><a class="btn tiny" href="${base}import_profiles.json">Import profiles JSON</a></div><p class="small muted" style="margin-top:8px">Import profiles feed Fabled Studio's validator; the kit JSON is the vendor-facing brief.</p></div>
    <div class="card"><h3 style="margin:0 0 6px">Blockout plan preview</h3><pre class="code" id="plan-preview">loading…</pre></div>`;
  fetch(`${base}blockout_plan.json`).then((r) => r.json()).then((j) => ($('#plan-preview').textContent = JSON.stringify({ ...j, actors: j.actors.slice(0, 3).concat([`… ${j.actors.length - 3} more`]) }, null, 2))).catch(() => {});
}
function renderDetail() {
  const p = state.project, a = p.assets.find((x) => x.id === state.assetId);
  if (!a) { $('#detail').innerHTML = '<div class="section"><h2>Asset</h2><p class="muted small">Select a card.</p></div>'; return; }
  const g = a.generation; const model = g?.outputs?.find((o) => o.type === 'model');
  const modelHref = model ? (model.url || (model.local ? `/api/mock-models/${encodeURIComponent(model.local.split('/').pop())}` : null)) : null;
  const idx = STATUS_FLOW.indexOf(a.status);
  $('#detail').innerHTML = `<div class="section"><h2><span class="swatch" style="background:${CAT_COLOR[a.category]}"></span>${esc(a.asset_name)}</h2>
    <div class="row"><span class="pill ${a.status}">${STATUS_LABEL[a.status]}</span><span class="pill">${a.category}</span><span class="muted small">${esc(a.source)}</span></div>
    <div class="detail-field"><label>Assignee</label><select data-k="assignee">${p.roles.map((r) => `<option ${r === a.assignee ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <div class="detail-field"><label>Category</label><select data-k="category">${Object.keys(CAT_COLOR).map((c) => `<option ${c === a.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="detail-field"><label>Profile</label><span class="mono">${esc(a.import_profile)}</span></div>
    <div class="detail-field"><label>LOD budget</label><span class="mono">${a.budget.lods_triangles.map(fmt).join(' / ')}</span></div>
    <div class="detail-field"><label>Height</label><span>${a.budget.height_cm.join('–')} cm, ${a.budget.up_axis}-up, rig ${a.budget.rig}</span></div></div>
  <div class="section"><h2>Generate</h2>
    <textarea id="gen-prompt" style="min-height:60px">${esc(g?.prompt || `${a.name}, ${p.style.toLowerCase()} game asset, ${a.category}, clean silhouette, single object, neutral pose`)}</textarea>
    <div class="row" style="margin-top:6px"><button class="btn tiny primary" id="btn-gen" ${state.providers.some((x) => x.configured) ? '' : 'disabled'}>✦ Text → 3D</button>${g ? `<span class="pill ${g.status}">${esc(g.provider)}: ${g.status}${g.progress != null && g.status !== 'succeeded' ? ` ${g.progress}%` : ''}</span>` : ''}${g?.concept_mockup ? '<span class="badge-mockup">CONCEPT MOCKUP</span>' : ''}</div>
    ${g?.error ? `<p class="small" style="color:var(--red)">${esc(g.error)}</p>` : ''}
    ${modelHref ? `<p class="small" style="margin-top:8px"><a href="${esc(modelHref)}" download>Download mesh (${esc(model.format)})</a> · then <a href="${esc(state.studio)}" target="_blank" rel="noopener">open Fabled Studio</a> to run retopo, LODs, bake and the pre-import check against <span class="mono">${esc(a.import_profile)}</span>.</p>` : ''}
    <p class="small muted" style="margin-top:8px">Generated meshes are dense and unscaled; that is what Fabled Studio's pipeline and validator are for. Move the card as the asset progresses:</p>
    <div class="row" style="margin-top:6px">${STATUS_FLOW.map((s, i) => `<button class="btn tiny ${i === idx ? 'primary' : ''}" data-status="${s}" title="${STATUS_LABEL[s]}">${i + 1}</button>`).join('')}<span class="small muted">${STATUS_LABEL[a.status]}</span></div></div>
  <div class="section"><h2>Comments (${a.comments.length})</h2>${a.comments.map((c) => `<div class="comment"><span class="who">${esc(c.who)}</span><span class="muted small">${c.at.slice(11, 16)}</span><div>${esc(c.text)}</div></div>`).join('')}<div class="row" style="margin-top:6px"><input type="text" id="comment-text" placeholder="Feedback for the artist / vendor…" style="flex:1" /><button class="btn tiny" id="btn-comment">Post</button></div></div>`;
  const patch = async (body) => { try { applyProject((await api(`/api/game/projects/${p.id}/assets/${a.id}${as()}`, { method: 'PATCH', body })).project); } catch (e) { toast(e.message, true); } };
  $$('#detail [data-k]').forEach((el) => (el.onchange = () => patch({ [el.dataset.k]: el.value })));
  $$('#detail [data-status]').forEach((b) => (b.onclick = () => patch({ status: b.dataset.status })));
  $('#btn-gen').onclick = async () => { try { const r = await api(`/api/game/projects/${p.id}/assets/${a.id}/generate${as()}`, { method: 'POST', body: { provider: $('#provider').value, prompt: $('#gen-prompt').value } }); applyProject(r.project); toast(`${r.task.provider_name}: generation started`); } catch (e) { toast(e.message, true); } };
  $('#btn-comment').onclick = async () => { const t = $('#comment-text').value.trim(); if (!t) return; try { applyProject((await api(`/api/game/projects/${p.id}/assets/${a.id}/comments${as()}`, { method: 'POST', body: { text: t } })).project); } catch (e) { toast(e.message, true); } };
  $('#comment-text').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-comment').click(); };
}

// ---- top-down layout editor ----------------------------------------------------------------------------------------
const cv = $('#layout-canvas'), ctx = cv.getContext('2d');
const world = () => state.project.layout.size_cm; const toPx = (cm) => (cm / world() + 0.5) * cv.width; const toCm = (px) => (px / cv.width - 0.5) * world();
function drawLayout() {
  const L = state.project.layout; ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = '#1f2436'; ctx.lineWidth = 1; for (let c = -L.size_cm / 2; c <= L.size_cm / 2; c += L.grid_cm * 5) { const p = toPx(c); ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, cv.height); ctx.moveTo(0, p); ctx.lineTo(cv.width, p); ctx.stroke(); }
  ctx.strokeStyle = '#2d3550'; ctx.beginPath(); ctx.moveTo(toPx(0), 0); ctx.lineTo(toPx(0), cv.height); ctx.moveTo(0, toPx(0)); ctx.lineTo(cv.width, toPx(0)); ctx.stroke();
  const sp = L.spawn; ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(toPx(sp.x), toPx(-sp.y), 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8b95a7'; ctx.font = '11px Inter, sans-serif'; ctx.fillText('player spawn', toPx(sp.x) + 10, toPx(-sp.y) + 4);
  for (const it of L.items) {
    const a = state.project.assets.find((x) => x.id === it.asset_id); const [fx, fy] = it.footprint_cm; const w = (fx * it.scale / world()) * cv.width, h = (fy * it.scale / world()) * cv.width;
    ctx.save(); ctx.translate(toPx(it.x), toPx(-it.y)); ctx.rotate((-it.yaw * Math.PI) / 180);
    ctx.fillStyle = CAT_COLOR[it.category] + (a?.status === 'imported' ? 'cc' : a?.status === 'validated' ? '99' : '55'); ctx.strokeStyle = state.sel === it.id ? '#f1f5f9' : CAT_COLOR[it.category]; ctx.lineWidth = state.sel === it.id ? 2.5 : 1;
    ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h / 2 - 6); ctx.stroke();
    ctx.rotate((it.yaw * Math.PI) / 180); ctx.fillStyle = '#f1f5f9'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(it.asset_name.replace(/^SM_/, ''), 0, h / 2 + 11); ctx.restore();
  }
}
const hit = (x, y) => [...state.project.layout.items].reverse().find((it) => Math.abs(toCm(x) - it.x) <= Math.max(60, it.footprint_cm[0] * it.scale / 2) && Math.abs(-toCm(y) - it.y) <= Math.max(60, it.footprint_cm[1] * it.scale / 2));
const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
cv.addEventListener('pointerdown', (e) => { if (!state.project) return; const [x, y] = pos(e); const it = hit(x, y); state.sel = it?.id || null; if (it) { state.drag = { it, dx: toCm(x) - it.x, dy: -toCm(y) - it.y }; cv.setPointerCapture(e.pointerId); state.assetId = it.asset_id; renderDetail(); } drawLayout(); });
cv.addEventListener('pointermove', (e) => { if (!state.drag) return; const [x, y] = pos(e); const g = state.project.layout.grid_cm; state.drag.it.x = Math.round((toCm(x) - state.drag.dx) / g) * g; state.drag.it.y = Math.round((-toCm(y) - state.drag.dy) / g) * g; drawLayout(); });
cv.addEventListener('pointerup', () => { state.drag = null; });
window.addEventListener('keydown', (e) => { if (state.tab !== 'layout' || !state.sel || /input|textarea|select/i.test(e.target.tagName)) return; const L = state.project.layout; const it = L.items.find((x) => x.id === state.sel); if (!it) return; if (e.key === 'r' || e.key === 'R') it.yaw = (it.yaw + 15) % 360; if (e.key === 'Delete' || e.key === 'Backspace') { L.items = L.items.filter((x) => x !== it); state.sel = null; } if (e.key === '+' || e.key === '=') it.scale = Math.min(10, +(it.scale + 0.1).toFixed(2)); if (e.key === '-') it.scale = Math.max(0.1, +(it.scale - 0.1).toFixed(2)); drawLayout(); });
$('#btn-add').onclick = async () => { try { applyProject((await api(`/api/game/projects/${state.project.id}/layout${as()}`, { method: 'POST', body: { asset_id: $('#add-asset').value, x: 0, y: 0 } })).project); } catch (e) { toast(e.message, true); } };
$('#btn-save-layout').onclick = async () => { try { applyProject((await api(`/api/game/projects/${state.project.id}/layout${as()}`, { method: 'PUT', body: { items: state.project.layout.items, spawn: state.project.layout.spawn } })).project); toast('layout saved'); } catch (e) { toast(e.message, true); } };

// ---- wiring -------------------------------------------------------------------------------------------------------
$$('#tabs .btn').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; $$('#tabs .btn').forEach((x) => x.classList.toggle('active', x === b)); renderAll(); }));
const showNew = (v) => ($('#new-project').hidden = !v);
$('#btn-new').onclick = () => showNew(true); $('#btn-empty-new').onclick = () => showNew(true); $('#btn-cancel').onclick = () => showNew(false);
$('#btn-sample').onclick = async () => ($('#new-text').value = await (await fetch('/api/samples/mossgate_pitch.txt')).text());
$('#btn-create').onclick = async () => { const text = $('#new-text').value.trim(); if (!text) return toast('paste a pitch first', true); try { const r = await api('/api/game/projects', { method: 'POST', body: { text } }); showNew(false); await loadProjects(); await openProject(r.project.id); toast(`${r.project.assets.length} assets in the kit`); } catch (e) { toast(e.message, true); } };
$('#role').innerHTML = ['designer', 'character artist', 'environment artist', 'vendor', 'tech art director'].map((r) => `<option>${r}</option>`).join(''); $('#role').onchange = () => (state.role = $('#role').value);
setInterval(async () => { if (!state.project) return; try { const r = await api(`/api/game/projects/${state.project.id}/generations`); $('#sync').textContent = 'synced'; if (r.project.rev !== state.rev && !state.drag) { const keep = state.tab; applyProject(r.project); state.tab = keep; } } catch { $('#sync').textContent = 'offline'; } }, 2500);
await loadStatus().catch((e) => toast(e.message, true)); await loadProjects().catch((e) => toast(e.message, true));
const initial = location.hash.slice(1); if (initial && state.projects.some((p) => p.id === initial)) await openProject(initial);
