// Connected workspace (browser): live asset tree, Connections panel, Notion-style asset page (properties, notes,
// activity) and the AI generation dialog. Everything shown comes from the local server:
//   GET /api/workspace, /api/activity, /api/workspace/notes, /api/providers, /api/generations/:id (see INTERFACES.md §10).
// app.js owns the viewers and checks; it passes hooks in so this module can open assets without duplicating that logic.
import { filterWorkspace, findAsset, trisLabel, trisTitle, timeAgo, toneOf, KIND_ICON, KIND_LABEL } from './workspace-model.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtFull = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '—' : `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} (${timeAgo(iso)})`; };
const TERMINAL = new Set(['succeeded', 'failed']);
const VERIFY_LABEL = { partial: 'API partly verified', unverified: 'API unverified', mock: 'CONCEPT MOCKUP' };

export function initWorkspace(hooks) {
  const st = { ws: null, activeId: null, query: '', status: null, providers: [], generations: new Map(), kinds: {}, collapsed: new Set(), noteTimer: null, polling: null, lastNoteFor: null };
  const api = async (path, opts) => { const r = await fetch(path, opts); return r.json(); };

  // ---------------- tree ----------------
  function renderTree() {
    const box = $('asset-tree'); if (!box) return;
    if (!st.ws) { box.innerHTML = '<div class="asset-tree-empty muted small">Loading workspace…</div>'; return; }
    const { groups, total } = filterWorkspace(st.ws, st.query);
    const cnt = $('asset-tree-count');
    cnt.textContent = st.query ? `${total}/${st.ws.total}` : String(st.ws.total);
    cnt.title = st.query ? `${total} of ${st.ws.total} assets match` : `${st.ws.total} assets in the workspace`;
    let html = '';
    for (const g of groups) {
      if (!g.assets.length && (st.query || g.id !== 'generated')) continue;
      const open = !st.collapsed.has(g.id);
      html += `<div class="wst-group" data-group="${esc(g.id)}">
        <button type="button" class="wst-group-head" aria-expanded="${open}" data-toggle="${esc(g.id)}"><span class="wst-caret">${open ? '▾' : '▸'}</span><span>${esc(g.label)}</span><span class="wst-count">${g.assets.length}${g.hidden_count ? ` +${g.hidden_count}` : ''}</span></button>`;
      if (open) {
        html += '<div class="wst-items" role="group">';
        if (!g.assets.length) html += `<div class="wst-empty small muted">No generations yet. <button type="button" class="linkish" data-open-gen>Generate a sculpt or clip</button></div>`;
        for (const a of g.assets) {
          const tris = trisLabel(a); const ago = timeAgo(a.created_at);
          html += `<div class="wst-item${a.id === st.activeId ? ' active' : ''}" role="treeitem" tabindex="0" data-asset-id="${esc(a.id)}" aria-selected="${a.id === st.activeId}" title="${esc(KIND_LABEL[a.kind] || a.kind)}${a.folder ? ` · ${esc(a.folder)}` : ''}">
            <span class="wst-icon kind-${esc(a.kind)}" aria-hidden="true">${KIND_ICON[a.kind] || '◈'}</span>
            <div class="wst-body">
              <div class="wst-row1"><span class="wst-name">${esc(a.name)}</span>${a.has_note ? '<span class="wst-note" title="Has page notes">✎</span>' : ''}</div>
              <div class="wst-row2"><span class="wst-pill tone-${toneOf(a)}">${esc(a.status?.label || '—')}</span>${a.concept_mockup && toneOf(a) !== 'mock' ? '<span class="wst-pill tone-mock">MOCKUP</span>' : ''}</div>
              <div class="wst-row3">${tris ? `<span title="${esc(trisTitle(a))}">${esc(tris)}</span>` : ''}${tris && ago ? '<span class="dot">·</span>' : ''}${ago ? `<span title="${esc(a.created_at)}">${esc(ago)}</span>` : ''}</div>
            </div></div>`;
        }
        if (g.hidden_count) html += `<div class="wst-empty small muted">${g.hidden_count} older upload${g.hidden_count === 1 ? '' : 's'} in ui/work/ not shown</div>`;
        html += '</div>';
      }
      html += '</div>';
    }
    box.innerHTML = html || '<div class="asset-tree-empty muted small">No assets match the filter</div>';
    box.querySelector('.wst-item.active')?.scrollIntoView({ block: 'nearest' });
    box.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = () => { const id = b.dataset.toggle; st.collapsed.has(id) ? st.collapsed.delete(id) : st.collapsed.add(id); renderTree(); }; });
    box.querySelectorAll('[data-open-gen]').forEach((b) => { b.onclick = () => openGenDialog(); });
    box.querySelectorAll('.wst-item').forEach((el) => {
      el.onclick = () => selectAsset(el.dataset.assetId);
      el.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAsset(el.dataset.assetId); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); const items = [...box.querySelectorAll('.wst-item')]; const i = items.indexOf(el);
          items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        }
      };
    });
  }

  async function refresh() {
    if (hooks.demo) { st.ws = hooks.demoWorkspace(); renderTree(); renderPage(); return; }
    try {
      st.ws = await api('/api/workspace');
      renderTree(); renderPage();
    } catch (e) { console.warn('workspace index unavailable', e); $('asset-tree').innerHTML = '<div class="asset-tree-empty muted small">Local server not reachable: workspace index unavailable.</div>'; }
  }

  async function selectAsset(id) {
    const a = findAsset(st.ws, id); if (!a) return;
    setActive(id);
    const o = a.open || {};
    try {
      if (o.type === 'output') await hooks.openOutput(o.dir, id);
      else if (o.type === 'job') await hooks.openJob({ ...o, running: toneOf(a) === 'running' }, id);
      else if (o.type === 'sample') await hooks.openSample(o.url, o.filename);
      else if (o.type === 'generation') hooks.showPageTab?.();
    } finally { refresh(); }
  }

  function setActive(id) {
    st.activeId = id;
    document.querySelectorAll('#asset-tree .wst-item').forEach((el) => {
      const on = el.dataset.assetId === id; el.classList.toggle('active', on); el.setAttribute('aria-selected', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
    renderPage();
  }

  // ---------------- asset page ----------------
  async function renderPage() {
    const pane = $('page-body'); if (!pane) return;
    const a = st.activeId ? findAsset(st.ws, st.activeId) : null;
    if (!a) {
      $('page-title').textContent = 'Workspace';
      $('page-kind').textContent = 'Select an asset in the tree to open its page';
      pane.innerHTML = '<h4 class="page-h">Recent activity</h4><ul class="activity" id="page-activity"></ul>';
      renderActivity(null);
      return;
    }
    $('page-title').textContent = a.name;
    $('page-kind').innerHTML = `${esc(KIND_LABEL[a.kind] || a.kind)} <span class="wst-pill tone-${toneOf(a)}">${esc(a.status?.label || '—')}</span>${a.concept_mockup ? ' <span class="wst-pill tone-mock">CONCEPT MOCKUP</span>' : ''}`;
    const props = [];
    const p = (k, v, title = '') => props.push(`<dt>${esc(k)}</dt><dd${title ? ` title="${esc(title)}"` : ''}>${v}</dd>`);
    if (a.pipeline_status) p('Pipeline', esc(a.pipeline_status));
    if (a.validator?.overall) {
      const s = a.validator.summary || {};
      p('Saved report', `${esc(String(a.validator.overall).toUpperCase())}${s.total != null ? ` · ${s.pass ?? 0} pass / ${s.warn ?? 0} warn / ${s.fail ?? 0} fail / ${s.not_checked ?? 0} not checked` : ''}`,
        `validator_report.json stored with this ${a.kind === 'upload' || a.kind === 'generated' ? 'job' : 'run'}${a.validator.generated_at ? `, generated ${a.validator.generated_at}` : ''}. A live Re-check may use a different profile; its result is in Activity and the Validator tab.`);
    }
    if (a.triangles?.input != null) p('Input tris', fmtFull(a.triangles.input));
    if (a.triangles?.lod0_triangles != null) p('LOD0 tris', `${fmtFull(a.triangles.lod0_triangles)}${a.triangles.lod_count ? ` · ${a.triangles.lod_count} LODs` : ''}`);
    if (a.engine) p('Engine', esc(a.engine === 'native' ? 'Native Python/NumPy' : 'Headless Blender'));
    if (a.provenance?.provider_name) {
      p('Generated by', `${esc(a.provenance.provider_name)} · ${esc(st.kinds[a.provenance.kind] || a.provenance.kind)}`);
      if (a.provenance.prompt) p('Prompt', esc(a.provenance.prompt));
      if (a.provenance.image_label) p('Input image', esc(a.provenance.image_label));
      if (a.provenance.source_asset_id) p('From asset', `<button type="button" class="linkish" data-goto="${esc(a.provenance.source_asset_id)}">${esc(findAsset(st.ws, a.provenance.source_asset_id)?.name || a.provenance.source_asset_id)}</button>`);
    }
    if (a.source?.name) p('Source', `${esc(a.source.name)}${a.source.license ? ` · ${esc(a.source.license)}` : ''}`);
    if (a.created_at) p('Created', esc(when(a.created_at)), a.created_at);
    if (a.folder) p('Folder', `<code>${esc(a.folder)}</code>`);

    const gen = a.generation ? st.generations.get(a.generation.id) || a.generation : null;
    pane.innerHTML = `<dl class="page-props">${props.join('')}</dl>
      ${gen ? `<div class="page-gen" id="page-gen">${genCard(gen, { compact: false })}</div>` : ''}
      <h4 class="page-h">Notes <span class="small muted" id="page-note-status"></span></h4>
      <textarea id="page-notes" class="page-notes" rows="4" placeholder="${hooks.demo ? 'Notes need the local server (npm start).' : 'Hand-off notes, review decisions, open questions… saved to ui/work/workspace_notes.json'}" ${hooks.demo ? 'disabled' : ''}></textarea>
      <div class="page-actions">${!hooks.demo && (a.kind === 'pipeline_output' || a.kind === 'frozen_run' || a.kind === 'upload' || a.kind === 'generated'
        ) ? `<button type="button" class="btn tiny" id="page-gen-from">✦ Generate from this asset…</button>` : ''}</div>
      <h4 class="page-h">Activity</h4><ul class="activity" id="page-activity"></ul>`;
    pane.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => selectAsset(b.dataset.goto); });
    $('page-gen-from')?.addEventListener('click', () => openGenDialog({ sourceAssetId: a.id }));
    wireGenCard(pane);
    loadNote(a.id);
    renderActivity(a);
  }

  async function loadNote(id) {
    const ta = $('page-notes'); if (!ta || hooks.demo) return;
    st.lastNoteFor = id;
    try {
      const j = await api(`/api/workspace/notes?asset=${encodeURIComponent(id)}`);
      if (st.lastNoteFor !== id || !$('page-notes')) return;
      ta.value = j.note?.text || '';
      $('page-note-status').textContent = j.note ? `saved ${timeAgo(j.note.updated_at)}` : '';
    } catch { $('page-note-status').textContent = 'notes unavailable'; }
    ta.oninput = () => {
      $('page-note-status').textContent = 'editing…';
      clearTimeout(st.noteTimer);
      st.noteTimer = setTimeout(async () => {
        try {
          const j = await api(`/api/workspace/notes?asset=${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ text: ta.value }) });
          if (st.lastNoteFor === id && $('page-note-status')) $('page-note-status').textContent = j.ok ? 'saved' : `not saved: ${j.error}`;
          const a = findAsset(st.ws, id); if (a && a.has_note !== !!j.note) { a.has_note = !!j.note; renderTree(); }
        } catch (e) { $('page-note-status').textContent = `not saved: ${e.message}`; }
      }, 600);
    };
  }

  async function renderActivity(a) {
    const ul = $('page-activity'); if (!ul) return;
    if (hooks.demo) { ul.innerHTML = '<li class="muted small">Activity is recorded by the local server; the static demo has none.</li>'; return; }
    try {
      const ids = a ? [a.id, ...(a.provenance?.task_id ? [`gen:${a.provenance.task_id}`] : [])] : [null];
      const lists = await Promise.all(ids.map((id) => api(`/api/activity?limit=${a ? 25 : 12}${id ? `&asset=${encodeURIComponent(id)}` : ''}`)));
      const events = lists.flatMap((l) => l.events || []).sort((x, y) => String(y.at).localeCompare(String(x.at)));
      if (!$('page-activity')) return;
      ul.innerHTML = events.length ? events.map((e) => `<li class="act act-${esc(e.type)}"><span class="act-dot"></span><div><div>${esc(e.message || e.type)}${e.concept_mockup ? ' <span class="wst-pill tone-mock">MOCKUP</span>' : ''}</div>
        <div class="small muted" title="${esc(e.at)}">${esc(timeAgo(e.at) || '')}${!a && e.asset_id ? ` · <button type="button" class="linkish" data-goto="${esc(e.asset_id)}">${esc(findAsset(st.ws, e.asset_id)?.name || e.asset_id)}</button>` : ''}</div></div></li>`).join('')
        : `<li class="muted small">${a ? 'No recorded activity for this asset yet. Uploads, pipeline runs, validator runs, generations and notes appear here.' : 'No activity yet.'}</li>`;
      ul.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => selectAsset(b.dataset.goto); });
    } catch { ul.innerHTML = '<li class="muted small">Activity unavailable.</li>'; }
  }

  // ---------------- connections ----------------
  function setStatus(s) { st.status = s; renderConnections(); }
  function renderConnections() {
    const box = $('ws-connections'); if (!box) return;
    if (hooks.demo) {
      box.innerHTML = conn('static', 'Static demo', 'Pre-processed real run. No live pipeline, validator or providers.', 'neutral');
      return;
    }
    const s = st.status;
    const rows = [];
    if (s) {
      rows.push(conn('pipeline', 'Pipeline', s.pipeline.available ? 'fabled_pipeline.py found' : s.pipeline.forced_off ? 'forced to stub (FABLED_PIPELINE=off)' : 'not found: stub', s.pipeline.available ? 'ok' : 'mock', s.pipeline.command_preview));
      rows.push(conn('engine', 'Blender engine', s.pipeline.blender_path ? 'Headless Blender found' : 'Blender not found: Native Python/NumPy fallback', s.pipeline.blender_path ? 'ok' : 'warn', s.pipeline.blender_path || ''));
      rows.push(conn('validator', 'Validator', s.validator.available ? `fabled_validator${s.validator.supports_manifest ? ' · --manifest' : ''}` : 'not found: stub', s.validator.available ? 'ok' : 'mock', s.validator.command_preview));
    } else rows.push(conn('pipeline', 'Pipeline & validator', 'checking…', 'neutral'));
    rows.push(conn('unreal', 'Unreal import', 'Draft script, never run (ROADMAP ticket 2)', 'neutral', 'fabled/unreal/import_fabled_asset.py'));
    box.innerHTML = rows.join('') + `<div class="conn-sub">AI providers <button type="button" class="linkish" id="conn-open-gen">Generate…</button></div>` +
      (st.providers.length ? st.providers.map((p) => conn(`prov-${p.id}`, p.name,
        p.configured ? `${p.kind_labels.join(' · ')}` : `set ${p.env.join(' / ')} to enable`,
        p.concept_mockup ? 'mock' : p.configured ? 'ok' : 'off',
        `${p.category}. ${p.feeds} ${p.verification_note}`,
        `${VERIFY_LABEL[p.verification] ? `<span class="verify v-${esc(p.verification)}">${esc(VERIFY_LABEL[p.verification])}</span>` : ''}${p.docs ? ` <a href="${esc(p.docs)}" target="_blank" rel="noopener">docs</a>` : ''}`)).join('')
        : '<div class="small muted">Provider list unavailable.</div>');
    $('conn-open-gen')?.addEventListener('click', () => openGenDialog());
  }
  const conn = (id, name, detail, tone, title = '', extra = '') => `<div class="conn" data-conn="${esc(id)}" title="${esc(title || '')}"><span class="conn-dot tone-${esc(tone)}"></span><div class="conn-body"><div class="conn-name">${esc(name)} ${extra}</div><div class="conn-detail">${esc(detail)}</div></div></div>`;

  async function loadProviders() {
    if (hooks.demo) return;
    try {
      const j = await api('/api/providers');
      st.providers = j.providers || []; st.kinds = j.kinds || {};
      for (const g of j.generations || []) st.generations.set(g.id, g);
      renderConnections(); renderGenList(); ensurePolling();
    } catch (e) { console.warn('providers unavailable', e); }
  }

  // ---------------- generation dialog ----------------
  function kindsFor(pid) { return st.providers.find((p) => p.id === pid)?.kinds || []; }
  function openGenDialog({ sourceAssetId = null } = {}) {
    const dlg = $('gen-dialog'); if (!dlg || hooks.demo) return;
    st.genSource = sourceAssetId || st.activeId;
    const list = $('gen-providers');
    const firstReady = st.providers.find((p) => p.configured && !p.concept_mockup) || st.providers.find((p) => p.configured) || st.providers[0];
    list.innerHTML = st.providers.map((p) => `<label class="gen-prov${p.configured ? '' : ' disabled'}">
        <input type="radio" name="gen-provider" value="${esc(p.id)}" ${p.id === firstReady?.id ? 'checked' : ''} ${p.configured ? '' : 'disabled'} />
        <span class="gen-prov-name">${esc(p.name)} <span class="small muted">${esc(p.category)}</span></span>
        <span class="small">${esc(p.kind_labels.join(' · '))}</span>
        <span class="small muted">${p.configured ? esc(p.feeds) : `Not configured: set <code>${esc(p.env.join(' / '))}</code> in the server environment.`}</span>
        ${VERIFY_LABEL[p.verification] ? `<span class="verify v-${esc(p.verification)}" title="${esc(p.verification_note)}">${esc(VERIFY_LABEL[p.verification])}</span>` : ''}
      </label>`).join('');
    list.querySelectorAll('input[name=gen-provider]').forEach((r) => { r.onchange = fillKinds; });
    fillKinds(); fillImages();
    $('gen-msg').textContent = '';
    renderGenList();
    if (!dlg.open) dlg.showModal();
  }
  function selectedProvider() { return document.querySelector('input[name=gen-provider]:checked')?.value || null; }
  function fillKinds() {
    const sel = $('gen-kind'); const kinds = kindsFor(selectedProvider());
    sel.innerHTML = kinds.map((k) => `<option value="${esc(k)}">${esc(st.kinds[k] || k)}</option>`).join('');
    onKind();
  }
  function onKind() {
    const k = $('gen-kind').value;
    $('gen-image-row').hidden = k === 'text-to-3d';
    $('gen-prompt').placeholder = k === 'text-to-3d' ? 'e.g. stylized dwarf blacksmith bust, game prop, neutral pose'
      : k === 'image-to-video' ? 'Camera move / action, e.g. slow 180° orbit around the bust, studio light' : 'Optional texture prompt';
    $('gen-out-note').textContent = k === 'image-to-video' ? 'Output: a video clip, attached to the generation page. It does not enter the mesh pipeline.'
      : 'Output: a mesh. Import it as a sculpt, then Build retopo + LODs and run the pre-import check.';
  }
  function fillImages() {
    const sel = $('gen-image'); const ctx = hooks.context();
    const opts = ['<option value="">Choose an image…</option>'];
    for (const pv of ctx.previews || []) opts.push(`<option value="job:${esc(pv.rel)}">Preview: ${esc(pv.label || pv.rel.split('/').pop())}</option>`);
    opts.push('<option value="file">Upload an image file…</option>');
    sel.innerHTML = opts.join('');
    $('gen-image-file').hidden = true; $('gen-image-file').value = '';
    sel.onchange = () => { $('gen-image-file').hidden = sel.value !== 'file'; };
    $('gen-image-hint').textContent = (ctx.previews || []).length ? `${ctx.previews.length} preview render(s) from the open pipeline output.` : 'Open a pipeline run to use its preview renders as input.';
  }
  const fileToDataUri = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

  async function submitGen(ev) {
    ev?.preventDefault();
    const pid = selectedProvider(); const kind = $('gen-kind').value; const prompt = $('gen-prompt').value.trim();
    if (!pid) { $('gen-msg').textContent = 'No configured provider selected.'; return; }
    const body = { kind, prompt, source_asset_id: st.genSource || null };
    if (kind !== 'text-to-3d') {
      const v = $('gen-image').value; const ctx = hooks.context();
      if (v.startsWith('job:') && ctx.jobId) body.image = { job_id: ctx.jobId, rel: v.slice(4) };
      else if (v === 'file') {
        const f = $('gen-image-file').files[0];
        if (!f) { $('gen-msg').textContent = 'Pick an image file.'; return; }
        if (f.size > 10 * 1024 * 1024) { $('gen-msg').textContent = 'Image is over 10 MB.'; return; }
        body.image = { data_uri: await fileToDataUri(f), label: f.name };
      } else { $('gen-msg').textContent = 'This mode needs an input image.'; return; }
    }
    $('gen-submit').disabled = true; $('gen-msg').textContent = 'Submitting…';
    try {
      const j = await api(`/api/providers/${encodeURIComponent(pid)}/generations`, { method: 'POST', body: JSON.stringify(body) });
      if (!j.ok) { $('gen-msg').textContent = `Not started: ${j.error}`; return; }
      st.generations.set(j.generation.id, j.generation);
      $('gen-msg').textContent = 'Started. It appears under AI generations in the tree.';
      renderGenList(); ensurePolling(); refresh();
    } catch (e) { $('gen-msg').textContent = `Not started: ${e.message}`; }
    finally { $('gen-submit').disabled = false; }
  }

  function genCard(g, { compact = true } = {}) {
    const pct = g.progress != null ? Math.round(g.progress) : null;
    const model = (g.outputs || []).find((o) => o.type === 'model');
    const video = (g.outputs || []).find((o) => o.type === 'video');
    const image = (g.outputs || []).find((o) => o.type === 'image');
    const tone = g.status === 'succeeded' ? (g.concept_mockup ? 'mock' : 'ok') : g.status === 'failed' ? 'fail' : 'running';
    return `<div class="gen-card" data-gen="${esc(g.id)}">
      <div class="gen-card-head"><b>${esc(g.provider_name)}</b> <span class="small muted">${esc(st.kinds[g.kind] || g.kind)}</span>
        <span class="wst-pill tone-${tone}">${esc(g.status)}${pct != null && !TERMINAL.has(g.status) ? ` ${pct}%` : ''}</span>${g.concept_mockup ? '<span class="wst-pill tone-mock">CONCEPT MOCKUP</span>' : ''}</div>
      ${g.prompt ? `<div class="gen-prompt">“${esc(g.prompt)}”</div>` : ''}
      ${!TERMINAL.has(g.status) ? `<div class="pbar slim"><div class="pfill" style="width:${pct ?? 5}%"></div></div>` : ''}
      ${g.error ? `<div class="small gen-err">${esc(g.error)}</div>` : ''}${g.poll_error ? `<div class="small gen-err">Last poll: ${esc(g.poll_error)}</div>` : ''}
      ${!compact && image ? `<img class="gen-thumb" src="${esc(image.url)}" alt="Provider thumbnail" loading="lazy" referrerpolicy="no-referrer" />` : ''}
      ${video ? (compact ? `<a href="${esc(video.url)}" target="_blank" rel="noopener" class="small">Open video ↗</a>` : `<video class="gen-video" src="${esc(video.url)}" controls playsinline preload="metadata"></video>`) : ''}
      <div class="gen-actions">
        ${model && g.status === 'succeeded' ? (g.imported_job_id ? `<button type="button" class="btn tiny" data-gen-open="${esc(g.imported_job_id)}">Open imported sculpt</button>` : `<button type="button" class="btn tiny primary-ish" data-gen-import="${esc(g.id)}">Import as sculpt → pipeline</button>`) : ''}
        <span class="small muted">${esc(timeAgo(g.created_at) || '')}</span>
      </div></div>`;
  }
  function wireGenCard(root) {
    root.querySelectorAll('[data-gen-import]').forEach((b) => { b.onclick = () => importGen(b.dataset.genImport, b); });
    root.querySelectorAll('[data-gen-open]').forEach((b) => { b.onclick = () => { $('gen-dialog')?.open && $('gen-dialog').close(); selectAsset(`job:${b.dataset.genOpen}`); }; });
  }
  function renderGenList() {
    const box = $('gen-list'); if (!box) return;
    const all = [...st.generations.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12);
    box.innerHTML = all.length ? all.map((g) => genCard(g)).join('') : '<div class="small muted">No generations yet.</div>';
    wireGenCard(box);
  }
  async function importGen(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
    try {
      const j = await api(`/api/generations/${encodeURIComponent(id)}/import`, { method: 'POST' });
      if (!j.ok) { if (btn) btn.textContent = `Import failed: ${j.error}`; return; }
      const g = st.generations.get(id); if (g) g.imported_job_id = j.job_id;
      $('gen-dialog')?.open && $('gen-dialog').close();
      await refresh();
      setActive(j.asset_id);
      await hooks.openJob({ job_id: j.job_id, filename: j.filename, has_manifest: false }, j.asset_id);
      refresh();
    } catch (e) { if (btn) btn.textContent = `Import failed: ${e.message}`; }
  }
  function ensurePolling() {
    if (st.polling) return;
    const active = () => [...st.generations.values()].filter((g) => !TERMINAL.has(g.status));
    if (!active().length) return;
    st.polling = setInterval(async () => {
      const list = active();
      if (!list.length) { clearInterval(st.polling); st.polling = null; return; }
      let changed = false;
      for (const g of list) {
        try {
          const j = await api(`/api/generations/${encodeURIComponent(g.id)}`);
          if (j.ok) { if (j.generation.status !== g.status) changed = true; st.generations.set(g.id, j.generation); }
        } catch { /* next tick */ }
      }
      renderGenList();
      if (changed) refresh(); else if (st.activeId?.startsWith('gen:')) renderPage();
    }, 1500);
  }

  // ---------------- wiring ----------------
  const search = $('asset-tree-search');
  if (search) search.oninput = (e) => { st.query = e.target.value; renderTree(); };
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search?.focus(); search?.select(); } });
  $('btn-generate')?.addEventListener('click', () => openGenDialog());
  $('btn-close-gen')?.addEventListener('click', () => $('gen-dialog').close());
  $('gen-kind')?.addEventListener('change', onKind);
  $('gen-form')?.addEventListener('submit', submitGen);
  if (hooks.demo) $('btn-generate')?.setAttribute('hidden', '');

  renderTree(); renderConnections(); renderPage();
  refresh(); loadProviders();
  return { refresh, setActive, setStatus, selectAsset, openGenDialog, get activeId() { return st.activeId; } };
}
