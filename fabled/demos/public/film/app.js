// Fabled Shots client. Plain ES module, no dependencies. Talks to /api/film/*.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = { projects: [], project: null, shotId: null, tab: 'shots', role: 'director', providers: [], playing: null, rev: 0 };
const SIZES = ['Extreme wide', 'Wide', 'Medium wide', 'Medium', 'Medium (over-the-shoulder)', 'Close-up', 'Insert'];
const MOVES = { static: 'Static (locked off)', push_in: 'Slow push-in', dolly_follow: 'Dolly follow', tracking_handheld: 'Tracking (handheld)', crane_down: 'Crane down', aerial_drift: 'Aerial drift', orbit_handheld: 'Handheld orbit', crash_zoom: 'Crash zoom' };
const STATUSES = ['proposed', 'approved', 'redo'];

const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
};
const toast = (msg, err = false) => { const t = $('#toast'); t.textContent = msg; t.className = `toast${err ? ' err' : ''}`; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4000); };
const as = () => `?as=${encodeURIComponent(state.role)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tc = (s) => { const f = Math.round((s % 1) * 24); const t = Math.floor(s); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`; };

// ---- placeholder storyboard frame (SVG, labeled CONCEPT MOCKUP) -------------------------------------------------
const FIG_H = { 'Extreme wide': 0.12, 'Wide': 0.3, 'Medium wide': 0.55, 'Medium': 0.8, 'Medium (over-the-shoulder)': 0.85, 'Close-up': 1.6, 'Insert': 2.2 };
export function placeholderSvg(shot) {
  const W = 640, H = 360, night = /NIGHT|DUSK/.test(shot.scene_heading), ext = /EXT/.test(shot.scene_heading);
  const sky = night ? '#0b1020' : ext ? '#243b55' : '#2a2320', ground = night ? '#141a26' : ext ? '#3b4a3a' : '#3d332b';
  const fh = (FIG_H[shot.size] || 0.6) * H, fw = fh * 0.36, cx = W * 0.5, base = H * 0.86;
  const fig = (x, dim = 1) => `<g opacity="${dim}"><ellipse cx="${x}" cy="${base - fh + fh * 0.1}" rx="${fw * 0.32}" ry="${fh * 0.1}" fill="#d8cdb8"/><path d="M${x - fw / 2} ${base} L${x - fw / 2} ${base - fh * 0.75} Q${x} ${base - fh * 0.95} ${x + fw / 2} ${base - fh * 0.75} L${x + fw / 2} ${base} Z" fill="#d8cdb8"/></g>`;
  const ots = shot.ots_side ? `<path d="M${shot.ots_side === 'camera left' ? 0 : W} 0 L${shot.ots_side === 'camera left' ? W * 0.38 : W * 0.62} 0 L${shot.ots_side === 'camera left' ? W * 0.28 : W * 0.72} ${H} L${shot.ots_side === 'camera left' ? 0 : W} ${H} Z" fill="#000" opacity=".75"/>` : '';
  const arrow = { push_in: 'M320 300 L320 230 M305 245 L320 230 L335 245', dolly_follow: 'M200 330 L440 330 M425 318 L440 330 L425 342', tracking_handheld: 'M200 330 L440 330 M425 318 L440 330 L425 342', crane_down: 'M600 60 L600 180 M588 165 L600 180 L612 165', aerial_drift: 'M80 60 L240 120 M222 102 L240 120 L216 124', orbit_handheld: 'M220 320 Q320 360 420 320 M405 312 L420 320 L410 334', crash_zoom: 'M320 320 L320 200 M300 220 L320 200 L340 220 M280 330 L360 330' }[shot.preset] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${sky}"/><rect y="${H * 0.62}" width="${W}" height="${H * 0.38}" fill="${ground}"/>${ext ? `<circle cx="${W * 0.78}" cy="${H * 0.2}" r="22" fill="${night ? '#cbd5e1' : '#fde68a'}" opacity=".8"/>` : `<rect x="${W * 0.1}" y="${H * 0.15}" width="${W * 0.2}" height="${H * 0.35}" fill="#0f172a" opacity=".6"/>`}${fig(cx)}${shot.size === 'Medium (over-the-shoulder)' ? fig(shot.ots_side === 'camera left' ? W * 0.22 : W * 0.78, 0.4) : ''}${ots}<path d="${arrow}" stroke="#fbbf24" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6 6" opacity=".5"/><text x="12" y="${H - 14}" font-family="Inter, sans-serif" font-size="16" fill="#f1f5f9">${esc(shot.size)} · ${esc(shot.move)} · ${shot.lens_mm}mm</text><rect x="${W - 170}" y="12" width="158" height="22" rx="4" fill="#f59e0b"/><text x="${W - 91}" y="28" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="12" fill="#000">CONCEPT MOCKUP</text></svg>`;
}
const svgUri = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
const frameSrc = (shot) => shot.frame?.data_uri || svgUri(placeholderSvg(shot));
// Rasterize an SVG data URI to PNG so video providers (which do not accept SVG) can use it as the start frame.
const svgToPng = (uri) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; c.getContext('2d').drawImage(img, 0, 0, 1280, 720); resolve(c.toDataURL('image/png')); }; img.onerror = reject; img.src = uri; });

// ---- data ---------------------------------------------------------------------------------------------------------
async function loadStatus() {
  const s = await api('/api/status');
  state.providers = s.providers.filter((p) => p.kinds.includes('image-to-video'));
  const on = state.providers.filter((p) => p.configured).map((p) => p.name);
  $('#prov-pill').textContent = on.length ? `providers: ${on.join(', ')}` : 'providers: none configured';
  $('#prov-pill').title = on.length ? 'Image→video providers configured on this server' : `Set ${state.providers.map((p) => p.env.join('/')).join(' or ')} in the server environment to animate frames`;
}
async function loadProjects() { state.projects = (await api('/api/film/projects')).projects; renderProjects(); }
async function openProject(id) { state.project = (await api(`/api/film/projects/${id}`)).project; state.rev = state.project.rev; state.shotId = state.shotId && state.project.shots.some((s) => s.id === state.shotId) ? state.shotId : state.project.shots[0]?.id || null; location.hash = id; renderAll(); }
function applyProject(p) { state.project = p; state.rev = p.rev; renderAll(); }

// ---- render -------------------------------------------------------------------------------------------------------
function renderProjects() {
  $('#projects').innerHTML = state.projects.map((p) => `<button class="item ${state.project?.id === p.id ? 'active' : ''}" data-id="${p.id}">${esc(p.title)} <span class="muted small">· ${p.summary?.shots ?? '?'} shots</span></button>`).join('') || '<p class="muted small">No projects yet.</p>';
  $$('#projects .item').forEach((b) => (b.onclick = () => openProject(b.dataset.id)));
}
function renderAll() {
  const p = state.project;
  renderProjects();
  $('#empty').hidden = !!p;
  $$('[id^=tab-]').forEach((el) => (el.hidden = !p || el.id !== `tab-${state.tab}`));
  if (!p) return;
  $('#breakdown').innerHTML = `<h2>Breakdown</h2><div class="row"><div class="stat"><b>${p.scenes.length}</b><span>scenes</span></div><div class="stat"><b>${p.shots.length}</b><span>shots</span></div><div class="stat"><b>${tc(p.total_duration_s).slice(0, 5)}</b><span>animatic <span class="badge-est">est</span></span></div></div>
    <p class="small muted" style="margin:8px 0 4px">Characters</p><div class="row">${p.characters.map((c) => `<span class="pill">${esc(c.name)} · ${c.lines}</span>`).join('') || '<span class="muted small">none</span>'}</div>
    <p class="small muted" style="margin:8px 0 4px">Locations</p><div class="row">${p.locations.map((l) => `<span class="pill">${esc(l)}</span>`).join('')}</div>
    <p class="small muted" style="margin:8px 0 4px">Props mentioned</p><div class="row">${p.props.slice(0, 10).map((x) => `<span class="pill">${esc(x.name)} ×${x.mentions}</span>`).join('') || '<span class="muted small">none</span>'}</div>`;
  $('#activity').innerHTML = [...p.activity].reverse().slice(0, 30).map((a) => `<li><span class="muted">${a.at.slice(11, 16)}</span> <b>${esc(a.who)}</b> ${esc(a.what)}</li>`).join('');
  const approved = p.shots.filter((s) => s.status === 'approved').length, redo = p.shots.filter((s) => s.status === 'redo').length, framed = p.shots.filter((s) => s.frame).length, clips = p.shots.filter((s) => s.clip?.url).length;
  $('#stats').innerHTML = `<div class="stat"><b>${approved}/${p.shots.length}</b><span>approved</span></div><div class="stat"><b>${redo}</b><span>redo</span></div><div class="stat"><b>${framed}</b><span>frames</span></div><div class="stat"><b>${clips}</b><span>clips</span></div><div class="stat"><b>${tc(p.total_duration_s)}</b><span>runtime <span class="badge-est">est</span></span></div>`;
  renderTable(); renderBoard(); renderTimeline(); renderUnreal(); renderDetail();
}
function renderTable() {
  $('#shot-table tbody').innerHTML = state.project.shots.map((s) => `<tr data-id="${s.id}" class="${s.id === state.shotId ? 'active' : ''}"><td class="mono">${s.id}</td><td>${s.scene}</td><td>${esc(s.size)}</td><td>${esc(s.move)}</td><td>${s.lens_mm}mm</td><td>${s.duration_s}s</td><td>${esc(s.subject)}</td><td>${esc(s.description)}</td><td><span class="pill ${s.status}">${s.status}</span></td><td>${s.clip?.url ? '🎞 clip' : s.frame ? (s.frame.concept_mockup ? '▦ placeholder' : '🖼 still') : '<span class="muted">—</span>'}</td></tr>`).join('');
  $$('#shot-table tbody tr').forEach((tr) => (tr.onclick = () => { state.shotId = tr.dataset.id; renderAll(); }));
}
function renderBoard() {
  $('#board').innerHTML = state.project.shots.map((s) => `<div class="card ${s.id === state.shotId ? 'active' : ''}" data-id="${s.id}"><div class="frame">${s.clip?.url ? `<video src="${esc(s.clip.url)}" muted loop playsinline></video>` : `<img src="${frameSrc(s)}" alt="${esc(s.description)}" />`}${s.frame?.concept_mockup || !s.frame ? '<span class="corner badge-mockup">CONCEPT MOCKUP</span>' : ''}<span class="shot-id">${s.id}</span></div><div class="meta"><span>${esc(s.size)} · ${s.lens_mm}mm</span><span class="pill ${s.status}">${s.status}</span></div><p class="small" style="margin:6px 0 0">${esc(s.description)}</p></div>`).join('');
  $$('#board .card').forEach((c) => { c.onclick = () => { state.shotId = c.dataset.id; renderAll(); }; const v = c.querySelector('video'); if (v) { c.onmouseenter = () => v.play().catch(() => {}); c.onmouseleave = () => v.pause(); } });
}
function renderTimeline() {
  const total = state.project.total_duration_s || 1;
  $('#timeline').innerHTML = state.project.shots.map((s, i) => `<div class="seg ${s.status} ${state.playing?.index === i ? 'now' : ''}" style="width:${(s.duration_s / total) * 100}%" data-i="${i}" title="${esc(s.id)} ${esc(s.description)}">${s.id.slice(-3)}</div>`).join('');
  $$('#timeline .seg').forEach((el) => (el.onclick = () => play(Number(el.dataset.i))));
  if (!state.playing) showFrame(state.project.shots.findIndex((s) => s.id === state.shotId));
}
function showFrame(i) {
  const s = state.project.shots[i]; if (!s) return;
  const screen = $('#screen'); screen.className = `screen kb-${s.preset}`; screen.style.setProperty('--dur', `${s.duration_s}s`);
  const old = $('#screen video'); if (old) old.remove();
  const img = $('#screen-img');
  if (s.clip?.url) { img.hidden = true; const v = document.createElement('video'); v.src = s.clip.url; v.muted = true; v.autoplay = true; v.playsInline = true; screen.prepend(v); } else { img.hidden = false; img.src = ''; requestAnimationFrame(() => (img.src = frameSrc(s))); }
  $('#screen-cap').innerHTML = `<b class="mono">${s.id}</b> ${esc(s.description)} <span class="muted">· ${esc(s.size)}, ${esc(s.move)}, ${s.lens_mm}mm, ${s.duration_s}s</span>`;
}
function play(from = 0) {
  stop();
  const shots = state.project.shots; let i = from; let elapsed = shots.slice(0, from).reduce((a, s) => a + s.duration_s, 0);
  const step = () => { if (i >= shots.length) return stop(); state.playing = { index: i }; showFrame(i); renderTimeline(); const d = shots[i].duration_s; const t0 = performance.now(); state.playing.tick = setInterval(() => ($('#timecode').textContent = tc(elapsed + (performance.now() - t0) / 1000)), 100); state.playing.timer = setTimeout(() => { clearInterval(state.playing.tick); elapsed += d; i += 1; step(); }, d * 1000); };
  step();
}
function stop() { if (state.playing) { clearTimeout(state.playing.timer); clearInterval(state.playing.tick); } state.playing = null; renderTimeline(); }

function renderUnreal() {
  const p = state.project; const base = `/api/film/projects/${p.id}/export/`;
  $('#tab-unreal').innerHTML = `<div class="card"><h3 style="margin:0 0 6px">Hand-off to Unreal Engine</h3>
  <p class="muted">The Sequencer plan places one CineCameraActor per shot around a subject mark, keys its focal length and a start/end transform for the camera move, and lays the shots on a camera-cut track at 24 fps. The Python builder reads it inside the Unreal Editor.</p>
  <ol class="steps muted"><li>Download <a href="${base}sequencer_plan.json">sequencer_plan.json</a> and <a href="${base}unreal.py">build_sequence_from_shotlist.py</a>.</li><li>In Unreal Engine 5.6 or later enable <b>Python Editor Script Plugin</b> and <b>Sequencer Scripting</b>, restart.</li><li>Output Log: <code class="mono">py "…/build_sequence_from_shotlist.py" --plan "…/sequencer_plan.json" --dest /Game/Fabled/Previs</code></li><li>Open the Level Sequence it logs, scrub, then render through Movie Render Queue / Movie Render Graph.</li></ol>
  <p class="small"><span class="badge-est">UNTESTED DRAFT</span> The script has not been executed in an editor from this environment; see its header for the API calls to verify. Nothing in it uploads anything.</p></div>
  <div class="card"><h3 style="margin:0 0 6px">Other exports</h3><div class="row"><a class="btn tiny" href="${base}shotlist.json">Shot list JSON (fabled.shotlist/0.1)</a><a class="btn tiny" href="${base}shotlist.csv">Shot list CSV</a></div><p class="small muted" style="margin-top:8px">The CSV opens in Sheets / StudioBinder-style templates; the JSON is the contract the Unreal builder, the animatic and any future LLM "director pass" share.</p></div>
  <div class="card"><h3 style="margin:0 0 6px">Sequencer plan preview</h3><pre class="code" id="plan-preview">loading…</pre></div>`;
  fetch(`${base}sequencer_plan.json`).then((r) => r.json()).then((j) => ($('#plan-preview').textContent = JSON.stringify({ ...j, shots: j.shots.slice(0, 3).concat([`… ${j.shots.length - 3} more`]) }, null, 2))).catch(() => {});
}

function renderDetail() {
  const p = state.project, s = p.shots.find((x) => x.id === state.shotId);
  if (!s) { $('#detail').innerHTML = '<div class="section"><h2>Shot</h2><p class="muted small">Select a shot.</p></div>'; return; }
  const provOpts = state.providers.map((pr) => `<option value="${pr.id}" ${pr.configured ? '' : 'disabled'}>${esc(pr.name)}${pr.configured ? '' : ' (not configured)'}</option>`).join('');
  $('#detail').innerHTML = `<div class="section"><h2>Shot <span class="mono">${s.id}</span> · scene ${s.scene}</h2>
    <div class="frame" style="margin-bottom:8px">${s.clip?.url ? `<video src="${esc(s.clip.url)}" controls muted loop playsinline></video>` : `<img src="${frameSrc(s)}" alt="" />`}${!s.frame || s.frame.concept_mockup ? '<span class="corner badge-mockup">CONCEPT MOCKUP</span>' : ''}</div>
    <div class="row"><button class="btn tiny ${s.status === 'approved' ? 'primary' : ''}" data-status="approved">✓ Approve</button><button class="btn tiny" data-status="redo">↺ Redo</button><button class="btn tiny" data-status="proposed">Reset</button><span class="spacer"></span><span class="pill ${s.status}">${s.status}</span></div>
    <div class="detail-field"><label>Size</label><select data-k="size">${SIZES.map((x) => `<option ${x === s.size ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="detail-field"><label>Move</label><select data-k="move">${Object.values(MOVES).map((x) => `<option ${x === s.move ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="detail-field"><label>Lens</label><input type="number" data-k="lens_mm" value="${s.lens_mm}" min="8" max="400" /></div>
    <div class="detail-field"><label>Duration</label><input type="number" data-k="duration_s" value="${s.duration_s}" min="0.5" step="0.5" /></div>
    <div class="detail-field"><label>Assignee</label><select data-k="assignee">${p.roles.map((r) => `<option ${r === s.assignee ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <div class="detail-field"><label>Action</label><input type="text" data-k="description" value="${esc(s.description)}" /></div>
    <p class="small muted" style="margin:8px 0 2px">Generation prompt (edit freely)</p><textarea data-k="prompt" style="min-height:70px">${esc(s.prompt)}</textarea>
  </div>
  <div class="section"><h2>Frame &amp; clip</h2>
    <div class="row"><button class="btn tiny" id="btn-upload">Attach still…</button><button class="btn tiny" id="btn-placeholder">Use placeholder frame</button></div>
    <div class="row" style="margin-top:8px"><select id="clip-provider">${provOpts || '<option disabled>no image→video provider</option>'}</select><button class="btn tiny primary" id="btn-clip" ${state.providers.some((x) => x.configured) ? '' : 'disabled'}>Animate frame → clip</button></div>
    ${s.clip ? `<p class="small" style="margin-top:8px">${esc(s.clip.provider)}: <span class="pill ${s.clip.status}">${s.clip.status}</span> ${s.clip.error ? `<span class="muted">${esc(s.clip.error)}</span>` : ''} ${s.clip.url ? `<a href="${esc(s.clip.url)}" target="_blank" rel="noopener">open</a>` : ''}</p>` : ''}
    <p class="small muted" style="margin-top:8px">Image→video needs a real still (PNG/JPEG). The placeholder frame is rasterized to PNG before it is sent. Keys stay on the server; the browser only sees provider names.</p>
  </div>
  <div class="section"><h2>Comments (${s.comments.length})</h2>${s.comments.map((c) => `<div class="comment"><span class="who">${esc(c.who)}</span><span class="muted small">${c.at.slice(11, 16)}</span><div>${esc(c.text)}</div></div>`).join('')}
    <div class="row" style="margin-top:6px"><input type="text" id="comment-text" placeholder="Note for the team…" style="flex:1" /><button class="btn tiny" id="btn-comment">Post</button></div></div>`;
  const patch = async (body) => { try { applyProject((await api(`/api/film/projects/${p.id}/shots/${s.id}${as()}`, { method: 'PATCH', body })).project); } catch (e) { toast(e.message, true); } };
  $$('#detail [data-status]').forEach((b) => (b.onclick = () => patch({ status: b.dataset.status })));
  $$('#detail [data-k]').forEach((el) => (el.onchange = () => patch({ [el.dataset.k]: el.value })));
  $('#btn-comment').onclick = async () => { const t = $('#comment-text').value.trim(); if (!t) return; try { applyProject((await api(`/api/film/projects/${p.id}/shots/${s.id}/comments${as()}`, { method: 'POST', body: { text: t } })).project); } catch (e) { toast(e.message, true); } };
  $('#comment-text').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-comment').click(); };
  $('#btn-upload').onclick = () => $('#file-still').click();
  $('#file-still').onchange = async () => { const f = $('#file-still').files[0]; if (!f) return; if (f.size > 10 * 1024 * 1024) return toast('still must be 10 MB or less', true); const data_uri = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); }); try { applyProject((await api(`/api/film/projects/${p.id}/shots/${s.id}/frame${as()}`, { method: 'POST', body: { data_uri, label: f.name } })).project); toast('still attached'); } catch (e) { toast(e.message, true); } $('#file-still').value = ''; };
  $('#btn-placeholder').onclick = async () => { try { const png = await svgToPng(svgUri(placeholderSvg(s))); applyProject((await api(`/api/film/projects/${p.id}/shots/${s.id}/frame${as()}`, { method: 'POST', body: { data_uri: png, label: 'placeholder frame (rasterized)', concept_mockup: true } })).project); } catch (e) { toast(e.message, true); } };
  $('#btn-clip').onclick = async () => { try { if (!s.frame) await $('#btn-placeholder').onclick(); const r = await api(`/api/film/projects/${p.id}/shots/${s.id}/clip${as()}`, { method: 'POST', body: { provider: $('#clip-provider').value } }); applyProject(r.project); toast(`${r.task.provider_name}: clip started`); } catch (e) { toast(e.message, true); } };
}

// ---- wiring -------------------------------------------------------------------------------------------------------
$$('#tabs .btn').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; $$('#tabs .btn').forEach((x) => x.classList.toggle('active', x === b)); stop(); renderAll(); }));
$('#play').onclick = () => play(Math.max(0, state.project.shots.findIndex((s) => s.id === state.shotId)));
$('#stop').onclick = stop;
const showNew = (v) => { $('#new-project').hidden = !v; };
$('#btn-new').onclick = () => showNew(true); $('#btn-empty-new').onclick = () => showNew(true); $('#btn-cancel').onclick = () => showNew(false);
$('#btn-sample').onclick = async () => { $('#new-text').value = await (await fetch('/api/samples/the_lantern_keeper.fountain')).text(); $('#new-title').value = 'The Lantern Keeper'; };
$('#btn-create').onclick = async () => { const text = $('#new-text').value.trim(); if (!text) return toast('paste a script first', true); try { const r = await api('/api/film/projects', { method: 'POST', body: { title: $('#new-title').value.trim() || 'Untitled', text } }); showNew(false); await loadProjects(); await openProject(r.project.id); toast(`${r.project.shots.length} shots proposed from ${r.project.scenes.length} scenes`); } catch (e) { toast(e.message, true); } };
$('#role').innerHTML = ['director', 'dp', 'previs artist', 'producer'].map((r) => `<option>${r}</option>`).join('');
$('#role').onchange = () => (state.role = $('#role').value);

// Collaboration: poll the project every 3 s; apply when someone else bumped the revision. Also refreshes provider clips.
setInterval(async () => {
  if (!state.project) return;
  try {
    const r = await api(`/api/film/projects/${state.project.id}/clips`);
    $('#sync').textContent = 'synced';
    if (r.project.rev !== state.rev) { const keepTab = state.tab; applyProject(r.project); state.tab = keepTab; }
  } catch { $('#sync').textContent = 'offline'; }
}, 3000);

await loadStatus().catch((e) => toast(e.message, true));
await loadProjects().catch((e) => toast(e.message, true));
const initial = location.hash.slice(1);
if (initial && state.projects.some((p) => p.id === initial)) await openProject(initial);
