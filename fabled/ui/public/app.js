// SculptLine UI: wiring. See INTERFACES.md for the server/pipeline/validator contracts.
import * as THREE from 'three';
import { loadModel, flatten, SUPPORTED } from './loaders.js';
import { weld, analyzeTopology, flipTriangles, decimateToTarget, triCount } from './meshops.js';
import { SideViewer, syncControls } from './viewer.js';
import { runBrowserChecks, VALIDATOR_CHECKS_INFO } from './checks.js';
import { licensedSample, manifestDisplayName } from './licensed.js';
import { initWorkspace } from './workspace.js';

// Feature 8: 8 Discrete Pipeline Stages Specification
export const PIPELINE_STAGES = [
  { step: 1, id: '01_import_measure', key: '01', name: 'import_measure', label: 'Import & Measure', description: 'Load high-poly sculpt, measure bounding box and surface metrics.' },
  { step: 2, id: '02_retopo', key: '02', name: 'retopology', label: 'Retopology & Manifold Clean', description: 'Perform QuadriFlow remeshing and seal open/non-manifold edges.' },
  { step: 3, id: '03_uv', key: '03', name: 'uv_unwrap', label: 'UV Atlas Generation', description: 'Generate non-overlapping UV0 coordinate atlas layout.' },
  { step: 4, id: '04_lods', key: '04', name: 'lod_generation', label: 'LOD Chain Generation', description: 'Build LOD0–LOD3 decimation chain matching target triangle budgets.' },
  { step: 5, id: '05_bake', key: '05', name: 'texture_bake', label: 'Normal & ORM Bake', description: 'Bake tangent-space normal and packed ORM (AO/Roughness/Metallic) maps.' },
  { step: 6, id: '06_export', key: '06', name: 'fbx_export', label: 'FBX & GLB Export', description: 'Export standardized FBX with LodGroup and glTF binary for preview.' },
  { step: 7, id: '07_previews', key: '07', name: 'previews', label: 'Preview Rendering', description: 'Render multi-angle turnaround preview images.' },
  { step: 8, id: '08_preview_composites', key: '08', name: 'preview_composites', label: 'Labelled Composites', description: 'Generate annotated contact sheet composites and QA render strips.' },
];

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const state = {
  src: null, topo: null, jobId: null, upload: null, lods: [], lod: 0,
  manifest: null, manifestSource: null, validator: null, status: null, lodsStale: false,
  engine: 'blender', selectedEngine: 'blender', activeAssetId: null,
};
window.__sculptline = window.__fabled = state; // for debugging / headless verification (__fabled: pre-rebrand alias)

// ---------- viewers ----------
const left = new SideViewer($('view-left'));
const right = new SideViewer($('view-right'));
syncControls(left, right, () => $('t-sync').checked);
(function loop() { left.render(); right.render(); requestAnimationFrame(loop); })();

// ---------- material mode selector ----------
const selMatMode = $('sel-mat-mode');
if (selMatMode) {
  selMatMode.onchange = () => {
    const mode = selMatMode.value;
    left.setMaterialMode(mode);
    right.setMaterialMode(mode);
  };
}

// ---------- engine toggle ----------
export function setEngine(engine) {
  state.engine = engine;
  state.selectedEngine = engine;
  const isBlender = engine === 'blender';
  const badge = $('badge-engine');
  if (badge) {
    badge.textContent = isBlender ? 'Headless Blender' : 'Native Python/NumPy';
    badge.className = `badge-engine ${isBlender ? 'blender' : 'native'}`;
  }
  const chip = $('chip-engine');
  if (chip) {
    chip.textContent = isBlender ? 'Engine: Blender' : 'Engine: Native';
    chip.title = isBlender ? 'Active pipeline execution engine: Headless Blender (Cycles CPU)' : 'Active pipeline execution engine: Native Python/NumPy Fallback';
    chip.className = `chip engine-chip ${isBlender ? 'blender' : 'native'}`;
  }
  const btnB = $('btn-engine-blender');
  const btnN = $('btn-engine-native');
  if (btnB) btnB.classList.toggle('active', isBlender);
  if (btnN) btnN.classList.toggle('active', !isBlender);
}
const btnEngineBlender = $('btn-engine-blender');
const btnEngineNative = $('btn-engine-native');
if (btnEngineBlender) btnEngineBlender.onclick = () => setEngine('blender');
if (btnEngineNative) btnEngineNative.onclick = () => setEngine('native');

// ---------- Feature 8: Stage Telemetry Cards ----------
export function renderStageTelemetryCards(containerEl = null) {
  const targets = containerEl ? [containerEl] : [$('stage-cards'), $('pipeline-stage-cards')].filter(Boolean);
  for (const c of targets) {
    c.innerHTML = PIPELINE_STAGES.map((s) => `
      <div class="stage-card pending" id="stage-card-${s.step}" data-step="${s.step}" data-stage-id="${s.id}">
        <div class="stage-card-head">
          <span class="stage-num">${s.key}</span>
          <span class="stage-name">${esc(s.label)}</span>
          <span class="stage-status-badge pending">Queued</span>
        </div>
        <div class="stage-card-desc">${esc(s.description)}</div>
        <div class="stage-card-footer">
          <span class="stage-timing" id="stage-time-${s.step}">—</span>
          <span class="stage-step-meta">Step ${s.step}/8</span>
        </div>
      </div>
    `).join('');
  }
}

let stageStartTime = null;
let stageElapsedTimes = {};

export function updateStageTelemetry(pr) {
  if (!pr || !pr.step) return;
  const currentStep = pr.step;
  const isDone = pr.done === true;
  const isOk = pr.status === 'ok';
  const isFailed = pr.status === 'failed';

  for (const s of PIPELINE_STAGES) {
    const cards = document.querySelectorAll(`[data-step="${s.step}"]`);
    cards.forEach((card) => {
      const badge = card.querySelector('.stage-status-badge');
      const timeEl = card.querySelector('.stage-timing');

      if (s.step < currentStep || (s.step === currentStep && isDone && isOk)) {
        card.className = 'stage-card ok';
        if (badge) { badge.className = 'stage-status-badge ok'; badge.textContent = '✓ Done'; }
        if (timeEl && stageElapsedTimes[s.step]) timeEl.textContent = `${stageElapsedTimes[s.step]}s wall time`;
      } else if (s.step === currentStep && !isDone && !isFailed) {
        card.className = 'stage-card running';
        if (badge) { badge.className = 'stage-status-badge running'; badge.textContent = '… Running'; }
        if (!stageStartTime) stageStartTime = performance.now();
        const curWall = ((performance.now() - stageStartTime) / 1000).toFixed(1);
        stageElapsedTimes[s.step] = curWall;
        if (timeEl) timeEl.textContent = `${curWall}s`;
      } else if (s.step === currentStep && isFailed) {
        card.className = 'stage-card failed';
        if (badge) { badge.className = 'stage-status-badge failed'; badge.textContent = '✕ Failed'; }
      } else {
        card.className = 'stage-card pending';
        if (badge) { badge.className = 'stage-status-badge pending'; badge.textContent = 'Queued'; }
      }
    });
  }
}

// ---------- busy ----------
const busy = (msg) => { $('busy').hidden = !msg; if (msg) $('busy-text').textContent = msg; };
const tick = () => new Promise((r) => setTimeout(r, 30));

// ---------- profile ----------
const DEFAULT_LODS = [[30000, 1.0], [15000, 0.5], [7500, 0.25], [3000, 0.12]];
function lodRow(level, tris, screen) {
  const d = document.createElement('div'); d.className = 'lod-row';
  d.innerHTML = `<b>LOD${level}</b><input type="number" min="1" value="${tris}" title="max triangles" /><input type="number" step="0.01" min="0" value="${screen}" title="screen size" />`;
  return d;
}
function renderLodRows(rows) { const c = $('lod-rows'); c.innerHTML = ''; rows.forEach(([t, s], i) => c.appendChild(lodRow(i, t, s))); }
renderLodRows(DEFAULT_LODS);
$('lod-plus').onclick = () => { const rows = readLodRows(); if (rows.length >= 8) return; const last = rows[rows.length - 1] || [30000, 1];
  rows.push([Math.max(1, Math.round(last[0] / 2)), +(last[1] / 2).toFixed(3)]); renderLodRows(rows); };
$('lod-minus').onclick = () => { const rows = readLodRows(); if (rows.length <= 1) return; rows.pop(); renderLodRows(rows); };
function readLodRows() { return [...$('lod-rows').children].map((r) => { const [a, b] = r.querySelectorAll('input'); return [Number(a.value), Number(b.value)]; }); }
$('p-skeleton').onchange = () => { $('p-skeleton-custom').hidden = $('p-skeleton').value !== 'custom'; };

function readProfile() {
  const cls = $('p-class').selectedOptions[0]; const sk = $('p-skeleton').value;
  return {
    schema: 'fabled.import_profile/0.1',
    name: $('p-name').value,
    units: $('p-units').value,
    scale: Number($('p-scale').value) || 1,
    up_axis: $('p-up').value,
    asset_class: { id: cls.value, label: cls.textContent.replace(/\s*\(.*\)$/, ''), height_cm: [Number(cls.dataset.min), Number(cls.dataset.max)] },
    skeleton: sk === 'none' ? { type: 'none', asset_path: null } : sk === 'custom' ? { type: 'custom', asset_path: $('p-skeleton-custom').value || null } : { type: 'asset', asset_path: sk },
    texel_density: { px_per_m: Number($('p-texel').value), texture_size: Number($('p-texsize').value) },
    lod_budget: readLodRows().map(([t, s], i) => ({ level: i, max_triangles: t, screen_size: s })),
  };
}
// ---------- integration status ----------
async function refreshStatus() {
  try {
    const s = await (await fetch('/api/status')).json(); state.status = s;
    const set = (el, name, info) => {
      el.textContent = `${name}: ${info.available ? 'connected' : 'stub (CONCEPT MOCKUP)'}`;
      el.className = `chip ${info.available ? 'ok' : 'stub'}`;
      el.title = info.available ? info.command_preview : info.forced_off ? 'Forced to stub by env var' : `No CLI found in ${info.dir}`;
    };
    set($('chip-pipeline'), 'Pipeline', s.pipeline); set($('chip-validator'), 'Validator', s.validator);
    workspace?.setStatus(s);
    $('btn-open-output').disabled = !s.pipeline.latest_output_manifest;
    $('btn-open-frozen').disabled = !s.pipeline.frozen_run; $('btn-open-frozen').dataset.dir = s.pipeline.frozen_run || '';
    if (s.pipeline.frozen_run) $('btn-open-frozen').title = `Read-only: ${s.pipeline.frozen_run} (frozen run)`;
    $('btn-open-output').title = s.pipeline.latest_output_manifest ? 'Read-only: prototype/pipeline/output/manifest.json' : 'No manifest.json in prototype/pipeline/output yet';
  } catch (e) { $('chip-pipeline').textContent = 'Server offline'; $('chip-validator').textContent = 'Server offline'; console.warn('status failed', e); }
  updateMockupBadge();
}
// ---------- static demo mode (?demo=1, or the build-time <meta name="sculptline-demo"> in dist/; dists built before the rebrand carry "fabled-demo") ----------
// Reads only the pre-processed files in demo-data/ (a real pipeline run + its recorded validator report). No /api calls,
// no upload, no Build, no stubs or fixtures.
const DEMO = new URLSearchParams(location.search).get('demo') === '1' || !!document.querySelector('meta[name="sculptline-demo"], meta[name="fabled-demo"]');
const DEMO_BASE = 'demo-data/';
const fmtPT = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT'; };
async function enterDemo() {
  document.body.classList.add('demo');
  for (const id of ['btn-sample', 'btn-open-fixture']) $(id).remove(); // sample + fixture are not bundled
  // upload, Build, saved reports and the editable profile are hidden (CSS body.demo .demo-hide), not used
  for (const id of ['btn-open-output', 'btn-open-frozen', 'dropzone', 'btn-process', 'process-status', 'saved-reports', 'btn-saved-report', 'btn-show-edit', 'edit-profile', 'edit-profile-tag']) $(id).classList.add('demo-hide');
  $('global-mockup').textContent = ''; $('right-badge').textContent = '';
  document.querySelector('footer').textContent = 'SculptLine by Fabled (Fable Technologies) · pre-processed real pipeline run · every figure is computed from the files shown or read from the recorded validator report.';
  try {
    const get = async (rel) => { const r = await fetch(DEMO_BASE + rel); if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`); return r.json(); };
    const info = await get('demo.json');
    const [manifest, report, profile] = await Promise.all([get(info.manifest), get(info.validator_report), get(info.validator_profile)]);
    if (manifest.concept_mockup || manifest.test_fixture || report.concept_mockup) throw new Error('demo data is not a real run');
    state.demo = { info, report, profile };
    state.demoMaps = await demoMaps();
    const when = fmtPT(info.recorded_at || manifest.created_at) || fmtPT(report.generated_at) || 'date unknown';
    $('chip-pipeline').textContent = `Pre-processed real run, recorded ${when}`; $('chip-pipeline').className = 'chip ok demo-label';
    $('chip-pipeline').title = `Pipeline run folder ${info.run_folder}${info.frozen_run ? ' (frozen)' : ''}; files copied unchanged`;
    $('chip-validator').textContent = `Validator report recorded ${fmtPT(report.generated_at) || ''} · ${String(report.overall_status || 'n/a').toUpperCase()}`;
    $('chip-validator').className = `chip vstatus-${esc(report.overall_status || 'na')}`; // never styled green unless the report says pass
    $('file-info').textContent = '';
    await showOutput({ ok: true, job_id: 'demo', out_dir: `${info.run_folder} (pre-processed)`, manifest, validator_profile: { path: info.validator_profile_file, content: profile } });
    await workspace.refresh(); setActiveAsset('run:demo');
  } catch (e) { console.error(e); $('file-info').textContent = `Demo data could not be loaded: ${e.message}`; }
}

const manifestIsReal = (m) => !!m && m.concept_mockup !== true && m.test_fixture !== true;
function updateMockupBadge() {
  if (DEMO) { $('global-mockup').hidden = true; return; }
  const reasons = [];
  if (state.status && !state.status.pipeline.available && !manifestIsReal(state.manifest)) reasons.push('pipeline not connected: retopo/LOD view is a browser decimation preview');
  if (state.lods.some((l) => l.source === 'preview')) reasons.push('LOD meshes shown are browser decimation previews, not SculptLine output');
  if (state.lods.length && state.manifest?.test_fixture) reasons.push('manifest is a TEST FIXTURE (not written by the pipeline)');
  else if (state.lods.some((l) => l.mock)) reasons.push('pipeline manifest is marked concept_mockup');
  if (state.validator?.concept_mockup) reasons.push('validator report is stub data, not computed from your file');
  $('global-mockup').hidden = reasons.length === 0; $('global-mockup').title = reasons.join('\n');
}

// ---------- file loading ----------
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files[0]; if (f) handleFile(f); });
document.body.addEventListener('dragover', (ev) => ev.preventDefault());
document.body.addEventListener('drop', (ev) => { ev.preventDefault(); const f = ev.dataTransfer?.files?.[0]; if (f) handleFile(f); });
$('file-input').addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) handleFile(f); });
$('btn-sample').onclick = async () => {
  busy('Fetching sample sculpt…');
  const r = await fetch('/samples/fabled_sample_head.glb'); const b = await r.arrayBuffer();
  handleFile(new File([b], 'fabled_sample_head.glb'));
};

function resetRight() {
  right.clear(); $('right-empty').hidden = false; $('right-badge').hidden = true; $('right-stats').textContent = ''; $('right-title').textContent = 'Retopo mesh';
}
function resetPipelineView() {
  $('pipeline-section').hidden = true; $('pipeline-run').innerHTML = ''; $('credit').hidden = true; $('left-credit').hidden = true;
  $('left-preview').hidden = true; $('left-preview').removeAttribute('src');
}

async function handleFile(file, { jobId = null, assetId = null } = {}) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!SUPPORTED.includes(ext)) { $('file-info').textContent = `Unsupported file type .${ext}. Supported: ${SUPPORTED.join(', ')}`; busy(null); return; }
  try {
    busy(`Loading ${file.name}…`); await tick();
    const buf = await file.arrayBuffer();
    const { object, format } = await loadModel(file.name, buf);
    busy('Reading geometry…'); await tick();
    const flat = flatten(object);
    const welded = weld(flat.positions, flat.indices);
    state.src = { name: file.name, size: file.size, format, flat, welded, fromPipeline: false };
    state.lods = []; state.lod = 0; state.manifest = null; state.manifestSource = null; state.validator = null; state.validatorJob = null; state.lodsStale = false; state.readonly = false;
    state.usedProfile = null; setProfileMode(false);
    busy('Analysing topology…'); await tick();
    state.topo = analyzeTopology(welded.positions, welded.indices, flat);
    resetPipelineView(); showSource(); resetRight(); renderLodSwitch();
    $('btn-process').disabled = false; $('btn-recheck').disabled = false; $('process-status').textContent = '';
    state.jobId = null; // never validate this file against the previous file's job
    if (jobId) { state.jobId = jobId; state.upload = Promise.resolve({ job_id: jobId, asset_id: assetId }); setActiveAsset(assetId || `job:${jobId}`); }
    else state.upload = uploadToServer(file, buf);
    await recheck();
  } catch (e) {
    console.error(e); $('file-info').textContent = `Could not load ${file.name}: ${e.message}`;
  } finally { busy(null); }
}

function displayParams() {
  const b = state.src.welded.bbox; const c = b.min.map((m, i) => m + b.size[i] / 2);
  return { center: c, radius: Math.hypot(...b.size) / 2, upZ: $('p-up').value === 'Z' };
}
function showSource(reframe = true) {
  const { welded, flat, name, size, format } = state.src; const d = displayParams();
  if (state.src.fromPipeline) {
    // Opened an output folder: the high-poly input is not loaded in the browser (can be millions of tris).
    left.clear(); if (reframe) right.frame(d.radius);
    $('left-empty').hidden = !!$('left-preview').getAttribute('src');
    const t = state.manifest?.input?.triangles;
    $('left-stats').textContent = t != null ? `${fmt(t)} tris (from pipeline manifest; input not loaded in browser)` : 'input not loaded in browser';
  } else {
    left.setMesh(welded.positions, welded.indices, d); if (reframe) { left.frame(d.radius); right.frame(d.radius); }
    left.setWireframe($('t-wire').checked);
    left.setFlipped(welded.positions, welded.indices, state.topo.flippedTriangles, $('t-flipped').checked);
    $('left-empty').hidden = true;
    $('left-stats').textContent = `${fmt(triCount(welded.indices))} tris · ${fmt(welded.positions.length / 3)} verts (computed from file)`;
  }
  const s = welded.bbox.size.map((v) => +v.toPrecision(4));
  $('file-info').innerHTML = (state.src.fromPipeline && state.manifest ? `<div class="asset-display">${esc(assetDisplayName(state.manifest))}</div>` : '') + `<b>${esc(name)}</b> · ${format.toUpperCase()}${size ? ` · ${(size / 1048576).toFixed(2)} MB` : ''}<br>` +
    `${flat.meshNames.length} mesh(es): ${esc(flat.meshNames.slice(0, 4).join(', '))}${flat.meshNames.length > 4 ? '…' : ''}<br>` +
    `Bounds (file units): ${s.join(' × ')}<br>UVs: ${flat.uvs ? 'yes' : 'no'} · Skinned: ${flat.skinnedMeshes ? 'yes' : 'no'} · Bones: ${flat.bones}`;
}

async function uploadToServer(file, buf) {
  try {
    const r = await fetch(`/api/jobs?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: buf });
    if (!r.ok) throw new Error(`upload ${r.status}`);
    const j = await r.json(); state.jobId = j.job_id; setActiveAsset(j.asset_id || `job:${j.job_id}`); workspace?.refresh(); return j;
  } catch (e) { console.warn('Upload to local server failed; pipeline/validator unavailable', e); state.jobId = null; return null; }
}

// ---------- manifest reading (locked shape fabled.pipeline.manifest/0.1; top-level first, outputs.* fallback) ----------
export function normalizeLods(m) {
  const top = Array.isArray(m?.lods) ? m.lods : []; const sub = Array.isArray(m?.outputs?.lods) ? m.outputs.lods : [];
  const lvl = (l, i) => (Number.isInteger(l.level) ? l.level : Number(/LOD(\d+)/i.exec(l.name || '')?.[1] ?? i));
  const base = top.length ? top : sub;
  return base.map((l, i) => {
    const level = lvl(l, i); const d = sub.find((x, j) => lvl(x, j) === level) || {}; // outputs.lods duplicate carries glb/vertices/has_uvs
    const pick = (k) => l[k] ?? d[k] ?? null;
    return { level, name: pick('name'), path: pick('path'), glb: pick('glb'), format: pick('format'), triangles: pick('triangles'), vertices: pick('vertices'),
      budget_triangles: pick('budget_triangles'), screen_size: pick('screen_size'), has_uvs: pick('has_uvs') };
  }).sort((a, b) => a.level - b.level);
}
export function manifestFacts(m) {
  const o = m?.outputs || {};
  const src = m?.source || {};
  return {
    asset: m?.asset ?? null, status: m?.status ?? null, up_axis: m?.up_axis ?? null, units: m?.units ?? null,
    combined_fbx: m?.combined_fbx ?? o.combined_fbx ?? null,
    textures: m?.textures ?? o.textures ?? null,
    uv_layout_png: m?.uv_layout_png ?? o.uv_layout_png ?? null,
    previews: m?.previews ?? o.previews ?? [],
    credit: { name: src.name ?? null, url: src.url ?? m?.input?.source_url ?? null, license: src.license ?? m?.input?.license ?? null },
    steps: Array.isArray(m?.steps) ? m.steps : [],
    warnings: Array.isArray(m?.warnings) ? m.warnings : [],
  };
}
const encRel = (rel) => rel.split('/').map(encodeURIComponent).join('/');
const fileUrl = (rel) => (DEMO ? `${DEMO_BASE}${encRel(rel)}` : `/api/jobs/${state.jobId}/files/${encRel(rel)}`);

// ---------- build retopo + LODs ----------
$('btn-process').onclick = buildLods;
async function buildLods() {
  if (!state.src || state.readonly) return;
  const profile = readProfile(); $('btn-process').disabled = true; $('process-status').textContent = '';
  try {
    busy('Preparing…'); await state.upload;
    if (!state.jobId) { await buildPreviewLods(profile); finishLods('Local server offline: right view is a browser decimation preview (CONCEPT MOCKUP).'); return; }
    const payload = { ...profile, engine: state.engine };
    const r = await fetch(`/api/jobs/${state.jobId}/process`, { method: 'POST', body: JSON.stringify(payload) });
    const resp = await r.json();
    if (resp.engine) setEngine(resp.engine);
    if (!r.ok || resp.ok === false) { showPipelineError(resp, profile); return; }
    if (resp.source === 'stub') {
      state.manifest = resp.manifest; state.manifestSource = 'stub'; state.lods = [];
      await buildPreviewLods(profile);
      finishLods('Pipeline not connected: right view is a browser decimation preview (CONCEPT MOCKUP).');
      await recheck(); return;
    }
    busy(null);
    const result = await pollPipeline();
    await applyPipelineResult(result, profile);
  } catch (e) { console.error(e); $('process-status').textContent = `Error: ${e.message}`; }
  finally { busy(null); $('progress').hidden = true; $('btn-process').disabled = false; updateMockupBadge(); }
}
function finishLods(msg) { state.lodsStale = false; state.lod = 0; renderLodSwitch(); showLod(0); $('process-status').textContent = msg; }

// Poll <out>/progress.json via the server and draw a real step bar.
async function pollPipeline() {
  const bar = $('progress'); bar.hidden = false; bar.classList.remove('failed');
  renderStageTelemetryCards();
  stageStartTime = performance.now();
  stageElapsedTimes = {};
  $('progress-label').textContent = 'Starting pipeline…'; $('progress-step').textContent = ''; $('progress-fill').style.width = '0%';
  for (;;) {
    const p = await (await fetch(`/api/jobs/${state.jobId}/progress`)).json();
    const pr = p.progress;
    if (pr && pr.total) {
      const doneSteps = typeof pr.done === 'number' ? pr.done : (pr.status === 'ok' || pr.done === true ? pr.step : pr.step - 1);
      $('progress-fill').style.width = `${Math.max(0, Math.min(100, (doneSteps / pr.total) * 100))}%`;
      const elapsed = ((performance.now() - stageStartTime) / 1000).toFixed(1);
      $('progress-label').textContent = `${pr.label || pr.name || 'step'}: ${pr.status || ''}`;
      $('progress-step').textContent = `step ${pr.step} of ${pr.total} · ${elapsed}s wall time`;
      if (pr.status === 'failed') bar.classList.add('failed');
      updateStageTelemetry(pr);
    }
    if (!p.running) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return (await fetch(`/api/jobs/${state.jobId}/result`)).json();
}

async function applyPipelineResult(res, profile) {
  workspace?.refresh();
  if (!res.ok || !res.manifest) { showPipelineError(res, profile); return; }
  state.manifest = res.manifest; state.manifestSource = 'pipeline'; state.lods = [];
  try { await loadPipelineLods(res.manifest); } catch (e) { console.warn(e); }
  renderPipelineRun(res.manifest, { exitCode: res.exit_code, failed: res.failed, sourceLabel: 'pipeline run' });
  if (state.lods.length) finishLods(res.failed ? `Pipeline failed (exit ${res.exit_code}); showing ${state.lods.length} partial LOD(s) from its manifest.` : `Loaded ${state.lods.length} LOD(s) from the pipeline manifest.`);
  else { resetRight(); $('process-status').textContent = `Pipeline ${res.failed ? `failed (exit ${res.exit_code})` : 'finished'}; the manifest lists no loadable LOD files.`; }
  await recheck();
}

function showPipelineError(resp, profile) {
  console.warn('pipeline error', resp);
  const el = $('process-status'); el.innerHTML = '';
  const msg = document.createElement('div'); msg.textContent = `Pipeline error: ${resp.error}`; el.appendChild(msg);
  const tail = (resp.stdout || resp.stderr || '').trim().split('\n').slice(-3).join(' | ');
  if (tail) { const t = document.createElement('div'); t.className = 'small'; t.textContent = tail; el.appendChild(t); }
  if (!state.src || state.readonly) return;
  const b = document.createElement('button'); b.className = 'btn fix'; b.id = 'btn-preview-fallback';
  b.textContent = 'Show browser decimation preview instead (CONCEPT MOCKUP)';
  b.onclick = async () => { state.lods = []; await buildPreviewLods(profile); busy(null);
    finishLods('Pipeline failed; right view is a browser decimation preview (CONCEPT MOCKUP), not SculptLine output.'); await recheck(); updateMockupBadge(); };
  el.appendChild(b);
}

async function buildPreviewLods(profile) {
  const { welded } = state.src;
  for (const l of profile.lod_budget) {
    busy(`Browser decimation preview: LOD${l.level} (target ≤ ${fmt(l.max_triangles)} tris)…`); await tick();
    const d = decimateToTarget(welded.positions, welded.indices, welded.bbox, l.max_triangles);
    state.lods.push({ level: l.level, source: 'preview', positions: d.positions, indices: d.indices, tris: triCount(d.indices), verts: d.positions.length / 3, budget: l.max_triangles, copied: d.copied });
  }
}

// Geometry (world space, with the file's normals/UVs/tangents) + baked maps for the textured view of a pipeline LOD.
// Real mode: maps embedded in the GLB. Demo: GLBs ship without images; maps come from demo-data display copies.
function texturedParts(object) {
  const geoms = []; let maps = { normal: null, orm: null, doubleSided: false };
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.uv || !o.geometry.attributes.normal) return;
    geoms.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m?.normalMap && !maps.normal) maps = { normal: m.normalMap, orm: m.aoMap || m.roughnessMap || null, doubleSided: m.side === THREE.DoubleSide };
    else if (m) maps.doubleSided ||= m.side === THREE.DoubleSide;
  });
  return geoms.length ? { geoms, maps } : null;
}
let demoMapsPromise = null;
function demoMaps() {
  const dt = state.demo?.info?.display_textures || {};
  const load = (rel) => (rel ? new THREE.TextureLoader().loadAsync(DEMO_BASE + encRel(rel)).then((t) => {
    t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; }) : Promise.resolve(null));
  return (demoMapsPromise ||= Promise.all([load(dt.normal?.path), load(dt.orm?.path)]).then(([normal, orm]) => ({ normal, orm })));
}

// Load each LOD: prefer lods[i].glb, fall back to lods[i].path (FBX). Counts are computed from what loads.
async function loadPipelineLods(manifest) {
  const errors = [];
  for (const l of normalizeLods(manifest)) {
    let loaded = null;
    for (const rel of [l.glb, l.path].filter(Boolean)) {
      busy(`Loading LOD${l.level} (${rel.split('/').pop()})…`); await tick();
      try {
        const r = await fetch(fileUrl(rel));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { object, format } = await loadModel(rel.split('/').pop(), await r.arrayBuffer());
        loaded = { flat: flatten(object), format, rel, tex: texturedParts(object) }; break;
      } catch (e) { errors.push(`LOD${l.level} ${rel}: ${e.message}`); console.warn('LOD load failed', rel, e); }
    }
    if (!loaded) continue;
    const { flat, format, rel, tex } = loaded; const w = weld(flat.positions, flat.indices);
    const topo = analyzeTopology(w.positions, w.indices, flat);
    state.lods.push({ level: l.level, source: 'pipeline', positions: w.positions, indices: w.indices, bbox: w.bbox, flat, tris: triCount(w.indices), verts: w.positions.length / 3, topo, tex,
      manifestTris: l.triangles, budget: l.budget_triangles, path: rel, format, mock: !manifestIsReal(manifest), fixture: manifest.test_fixture === true,
      uvData: flat.uvs ? { positions: flat.positions, indices: flat.indices, uvs: flat.uvs, label: `LOD${l.level} (pipeline output)` } : null });
  }
  busy(null);
  state.lodLoadErrors = errors;
  return errors;
}

// ---------- open an existing pipeline output folder (read-only) ----------
$('btn-open-output').onclick = () => openOutput('pipeline/output');
$('btn-open-frozen').onclick = () => openOutput($('btn-open-frozen').dataset.dir);
$('btn-open-fixture').onclick = () => openOutput('ui/test_fixtures/pipeline_output_FIXTURE');
async function openOutput(dir) {
  try {
    busy('Opening pipeline output…');
    const j = await (await fetch(`/api/open-output?dir=${encodeURIComponent(dir)}`, { method: 'POST' })).json();
    if (!j.ok) { $('file-info').textContent = j.error; return; }
    if (j.asset_id) setActiveAsset(j.asset_id);
    await showOutput(j);
  } catch (e) { console.error(e); $('file-info').textContent = `Could not open output: ${e.message}`; }
  finally { busy(null); updateMockupBadge(); }
}
async function showOutput(j) {
  try {
    busy('Opening pipeline output…');
    state.jobId = j.job_id; state.upload = Promise.resolve(j); state.readonly = true;
    state.manifest = j.manifest; state.manifestSource = 'pipeline_output'; state.lods = []; state.validator = null; state.validatorJob = null; state.lodsStale = false;
    state.usedProfile = j.validator_profile || null;
    await loadPipelineLods(j.manifest);
    if (!state.lods.length) { $('file-info').textContent = `No LOD file in ${j.out_dir} could be loaded: ${(state.lodLoadErrors || []).join('; ')}`; return; }
    const lod0 = state.lods[0];
    // glTF is metres and Y-up by spec; the FBX exports follow the manifest (units/up_axis).
    const facts = manifestFacts(j.manifest);
    if (lod0.format === 'glb' || lod0.format === 'gltf') { $('p-units').value = 'm'; $('p-up').value = 'Y'; }
    else { $('p-units').value = facts.units?.unreal_units === 'cm' ? 'cm' : $('p-units').value; if (facts.up_axis) $('p-up').value = facts.up_axis; }
    $('p-scale').value = 1;
    state.src = { name: `LOD${lod0.level} · ${lod0.path.split('/').pop()}`, size: 0, format: lod0.format, flat: lod0.flat, welded: { positions: lod0.positions, indices: lod0.indices, bbox: lod0.bbox }, fromPipeline: true };
    state.topo = lod0.topo;
    setProfileMode(true);
    resetPipelineView();
    const hp = facts.previews.find((p) => /high|hp|sculpt/i.test(`${p.label} ${p.path}`)) || null;
    if (hp) { $('left-preview').src = fileUrl(hp.path); $('left-preview').hidden = false; $('left-preview').alt = hp.label || ''; }
    $('left-empty').textContent = hp ? '' : 'High-poly input is not loaded in the browser';
    showSource(); finishLods(`Opened ${j.out_dir} (read-only).${j.manifest.test_fixture ? ' TEST FIXTURE manifest.' : ''}`);
    renderPipelineRun(j.manifest, { sourceLabel: j.manifest.test_fixture ? 'TEST FIXTURE manifest' : DEMO ? 'pre-processed real run' : 'pipeline output (read-only)' });
    if ($('btn-process')) $('btn-process').disabled = true; $('btn-recheck').disabled = false;
    await recheck();
  } catch (e) { console.error(e); $('file-info').textContent = `Could not open output: ${e.message}`; }
  finally { busy(null); updateMockupBadge(); }
}

// ---------- licensed sample assets: rules live in licensed.js (shared with the server's workspace index) ----------
export { licensedSample };
const assetDisplayName = (m) => manifestDisplayName(m) || 'asset';

function renderCredit(c) {
  const lic = licensedSample(state.manifest);
  if (lic) {
    const html = `<a href="${esc(lic.creditUrl)}" target="_blank" rel="noopener">${esc(lic.credit)}</a><br><span class="disclaimer">${esc(lic.disclaimer)}</span>`;
    $('credit').innerHTML = html; $('credit').hidden = false; $('left-credit').innerHTML = html; $('left-credit').hidden = false;
    return;
  }
  if (!c || (!c.name && !c.url && !c.license)) return;
  const html = `Source: ${c.name ? esc(c.name) : ''}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>` : ''}${c.license ? ` · License: ${esc(c.license)}` : ''}`;
  $('credit').innerHTML = html; $('credit').hidden = false;
  $('left-credit').innerHTML = html; $('left-credit').hidden = false;
}

const STEP_ICON = { ok: ['✓', 'ok'], automated: ['✓', 'ok'], failed: ['✕', 'failed'], running: ['…', 'running'], not_implemented: ['i', 'ni'], manual: ['✋', 'neutral'], skipped: ['–', 'neutral'] };
function renderPipelineRun(m, { exitCode = null, failed = false, sourceLabel = '' } = {}) {
  const f = manifestFacts(m); const el = $('pipeline-run');
  $('pipeline-section').hidden = false;
  const src = $('pipeline-source');
  src.textContent = m.test_fixture ? 'TEST FIXTURE manifest' : m.concept_mockup ? 'CONCEPT MOCKUP' : sourceLabel || 'pipeline';
  src.className = `pill ${m.test_fixture || m.concept_mockup ? 'mock' : 'real'}`;
  renderCredit(f.credit);
  const rows = [];
  rows.push(`<div class="row2"><b>${esc(assetDisplayName(m))}</b><span class="muted">status: ${esc(f.status ?? (failed ? 'failed' : 'n/a'))}${exitCode != null ? ` · exit ${exitCode}` : ''}${f.up_axis ? ` · up ${esc(f.up_axis)}` : ''}${f.units ? ` · units ${esc(JSON.stringify(f.units))}` : ''}</span></div>`);
  for (const st of f.steps) {
    const [ic, cls] = STEP_ICON[st.status] || ['·', 'neutral'];
    const label = st.status === 'not_implemented' ? 'not implemented yet' : st.status;
    rows.push(`<div class="row2"><span class="st ${cls}">${ic}</span><span>${esc(st.label || st.name)}</span><span class="muted">${esc(label)}${st.runtime_s != null ? ` · ${esc(st.runtime_s)} s wall-clock` : ''}${st.method ? ` · ${esc(st.method)}` : ''}</span></div>`);
  }
  const texSets = Array.isArray(f.textures) ? f.textures : f.textures ? [f.textures] : [];
  const texNames = { normal: 'Normal map', base_color: 'Base color', orm: 'ORM' };
  for (const tex of texSets) {
    for (const k of Object.keys({ normal: 1, base_color: 1, orm: 1, ...tex })) {
      if (k === 'material') continue; const v = tex[k]; const lbl = `${texNames[k] || k}${tex.material ? ` (${tex.material})` : ''}`;
      const disp = DEMO ? state.demo?.info?.display_textures?.[k] : null;
      if (typeof v === 'string' && disp) { rows.push(`<div class="row2"><span class="st ok">✓</span><span>${esc(lbl)}</span><span><a href="${fileUrl(disp.path)}" target="_blank">${esc(disp.path.split('/').pop())}</a> <span class="muted small">display copy, ${esc(disp.width)} px WebP lossless (${(disp.bytes / 1048576).toFixed(1)} MB, pixel-identical to the map in the GLB)${disp.convention ? ', OpenGL normal' : ''}; export file ${esc(v.split('/').pop())}${disp.original_bytes ? ` (${(disp.original_bytes / 1048576).toFixed(1)} MB${k === 'normal' && /green inverted/.test(disp.export_comparison?.relation || '') ? ', DirectX for Unreal' : ''})` : ''} not bundled</span></span></div>`); continue; }
      rows.push(typeof v === 'string' ? `<div class="row2"><span class="st ok">✓</span><span>${esc(lbl)}</span><a href="${fileUrl(v)}" target="_blank">${esc(v.split('/').pop())}</a></div>`
        : `<div class="row2"><span class="st neutral">–</span><span>${esc(lbl)}</span><span class="muted">not produced yet</span></div>`);
    }
  }
  if (f.combined_fbx) rows.push(`<div class="row2"><span class="st neutral">▸</span><span>Combined FBX</span><span class="muted">${esc(f.combined_fbx)}</span></div>`);
  if (m.runtimes_note) rows.push(`<div class="muted">${esc(m.runtimes_note)}</div>`);
  if (f.warnings.length) rows.push(`<div class="warnings">${f.warnings.map(esc).join('<br>')}</div>`);
  if (state.lodLoadErrors?.length) rows.push(`<div class="warnings">Load errors: ${state.lodLoadErrors.map(esc).join('<br>')}</div>`);
  if (f.previews.length) rows.push(`<div class="thumbs">${f.previews.map((p) => `<a href="${fileUrl(p.path)}" target="_blank" title="${esc(p.label)}"><img src="${fileUrl(p.path)}" loading="lazy" alt="${esc(p.label)}"/>${esc(p.label || '')}</a>`).join('')}</div>`);
  el.innerHTML = `<div class="run">${rows.join('')}</div>`;
}

function renderLodSwitch() {
  const c = $('lod-switch'); c.innerHTML = '<span class="muted small">LOD</span>';
  if (!state.lods.length) { const s = document.createElement('span'); s.className = 'small muted'; s.textContent = 'none built'; c.appendChild(s); return; }
  state.lods.forEach((l, i) => { const b = document.createElement('button'); b.textContent = `LOD${l.level}`; b.className = i === state.lod ? 'active' : ''; b.onclick = () => showLod(i); b.dataset.lod = l.level; c.appendChild(b); });
}
function showLod(i) {
  const l = state.lods[i]; if (!l) return; state.lod = i;
  [...$('lod-switch').querySelectorAll('button')].forEach((b, k) => b.classList.toggle('active', k === i));
  const d = displayParams();
  const maps = l.tex ? (DEMO ? { ...state.demoMaps, doubleSided: l.tex.maps.doubleSided } : l.tex.maps) : null;
  if (l.tex && maps?.normal && $('t-tex').checked) right.setTexturedMesh(l.tex.geoms, maps, d); else right.setMesh(l.positions, l.indices, d);
  right.setWireframe($('t-wire').checked);
  $('right-empty').hidden = true;
  const preview = l.source === 'preview';
  $('right-title').textContent = preview ? `LOD${l.level} preview` : `Retopo LOD${l.level}`;
  $('right-badge').hidden = !(preview || l.mock);
  $('right-badge').textContent = preview ? 'CONCEPT MOCKUP · browser decimation preview, not SculptLine output'
    : l.fixture ? 'CONCEPT MOCKUP · TEST FIXTURE manifest (not written by the pipeline)' : 'CONCEPT MOCKUP · pipeline manifest is marked concept_mockup';
  $('right-stats').textContent = `${fmt(l.tris)} tris · ${fmt(l.verts)} verts (computed from ${preview ? 'preview mesh' : `loaded ${l.format?.toUpperCase() || 'file'}`})` +
    (l.budget != null ? ` · budget ${fmt(l.budget)}` : '') + (l.manifestTris != null ? ` · manifest says ${fmt(l.manifestTris)}` : '') +
    (l.copied ? ' · under budget, copied as-is' : '') + (state.lodsStale ? ' · out of date: rebuild' : '');
}

// ---------- toggles ----------
$('t-wire').onchange = () => { left.setWireframe($('t-wire').checked); right.setWireframe($('t-wire').checked); };
$('t-flipped').onchange = () => left.setFlippedVisible($('t-flipped').checked);
$('t-tex').onchange = () => { if (state.lods.length) showLod(state.lod); };
$('btn-frame').onclick = () => { if (!state.src) return; const d = displayParams(); left.frame(d.radius, true); right.frame(d.radius, true); };
$('p-up').onchange = () => { if (state.src) { showSource(false); if (state.lods.length) showLod(state.lod); } };

// ---------- checks ----------
$('btn-recheck').onclick = () => recheck();
async function recheck() {
  if (!state.src) return;
  const profile = readProfile();
  busy('Running pre-import checks…'); await tick();
  state.validatorJob = null;
  let checks = renderBrowserChecks();
  busy('Running validator…');
  await runValidator(profile);
  checks = renderBrowserChecks(); // again, now with the validator's authoritative normals number
  busy(null); updateMockupBadge(); workspace?.refresh();
  return checks;
}
function renderBrowserChecks() {
  const profile = effectiveProfile();
  const checks = runBrowserChecks({ src: state.src, topo: state.topo, profile, lods: state.lods, manifest: state.manifest, validator: state.validatorJob });
  for (const st of manifestFacts(state.manifest).steps.filter((x) => x.status === 'not_implemented'))
    checks.push({ id: `pipeline.step.${st.name}`, severity: 'info', passed: null, object: 'pipeline manifest', message: `Pipeline step "${st.label || st.name}" is not implemented yet.` });
  renderChecks($('checks-browser'), checks);
  renderFixes(checks);
  const failed = checks.filter((c) => c.passed === false); const errs = failed.filter((c) => c.severity === 'error').length; const warns = failed.filter((c) => c.severity === 'warning').length;
  const passed = checks.filter((c) => c.passed === true).length;
  $('report-summary').innerHTML = (failed.length ? `<span class="bad">${failed.length} flagged</span> (${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'})` : '<span class="good">No blocking issues</span>') +
    ` · ${passed} passed · ${checks.length - failed.length - passed} info<br><span class="small">Browser checks on ${esc(state.src.name)} · ${new Date().toLocaleTimeString()} · ${profile._used ? `profile used: "${esc(profile.name)}"` : `profile "${esc(profile.name)}"`}${state.validatorJob ? ' · normals row shows the validator figure (authoritative)' : ''}</span>`;
  return checks;
}

// ---------- profile panel: values used (pipeline output) vs editable (new upload) ----------
// Effective profile for the browser checks. Pipeline output: built from the validator profile file the
// validator actually used, plus file-format facts of what the browser loaded (glTF = metres, Y-up).
function effectiveProfile() {
  const vp = state.readonly ? state.usedProfile?.content : null;
  if (!vp) return readProfile();
  const lod0 = state.lods.find((l) => l.level === 0) || state.lods[0];
  const isGltf = /^(glb|gltf)$/.test(lod0?.format || '');
  const h = vp.units?.expected_height_cm || {};
  const tex = Number(state.manifest?.pipeline_config?.bake?.resolution) || Number($('p-texsize').value) || 2048;
  return {
    _heightNote: licensedSample(state.manifest)?.heightNote || null,
    _used: true, name: vp.profile_name || 'validator profile', units: isGltf ? 'm' : (vp.units?.assumed_source_units || 'cm'), scale: Number(vp.units?.import_scale) || 1,
    up_axis: isGltf ? 'Y' : String(vp.axes?.up || 'Z').toUpperCase(),
    _measureNote: isGltf ? `measured on the GLB preview, which is Y-up/metres by glTF spec; the validator reads the FBX ${String(vp.axes?.up || 'Z').toUpperCase()}-up in cm` : '',
    asset_class: { id: vp.asset_type || 'prop', label: vp.asset_type || 'prop', height_cm: [h.min ?? 0, h.max ?? Infinity] },
    skeleton: vp.skeleton?.required ? { type: 'asset', asset_path: vp.skeleton.root_bone_name || '(required)' } : { type: 'none', asset_path: null },
    texel_density: { px_per_m: vp.texel_density?.target_px_per_cm != null ? vp.texel_density.target_px_per_cm * 100 : null, texture_size: tex },
    lod_budget: (vp.lods?.triangle_budgets || []).map((t, i) => ({ level: i, max_triangles: t, screen_size: null })),
  };
}
function setProfileMode(used) {
  $('used-profile').hidden = !used;
  $('edit-profile').hidden = used; $('edit-profile-tag').hidden = used;
  $('btn-show-edit').textContent = 'Show editable profile (for a new upload)';
  $('edit-hint').textContent = used ? 'Editable values apply only to a NEW upload. They are not used for the pipeline output on screen.' : 'Profile values are inputs you set, not measurements.';
  if (used) renderUsedProfile();
}
$('btn-show-edit').onclick = () => {
  const show = $('edit-profile').hidden; $('edit-profile').hidden = !show; $('edit-profile-tag').hidden = !show;
  $('edit-profile').classList.toggle('dimmed', show);
  $('btn-show-edit').textContent = show ? 'Hide editable profile' : 'Show editable profile (for a new upload)';
};
function renderUsedProfile() {
  const vp = state.usedProfile?.content; const m = state.manifest || {}; const f = manifestFacts(m);
  const rows = []; const add = (k, v) => rows.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`);
  const ptxt = `${vp?.profile_name || ''} ${vp?._comment || ''}`; const placeholder = /DEMO PLACEHOLDER|example values/i.test(ptxt);
  $('up-placeholder').hidden = !placeholder; $('up-placeholder').textContent = /DEMO PLACEHOLDER/i.test(ptxt) ? 'DEMO PLACEHOLDER VALUES' : 'EXAMPLE VALUES · not a studio spec';
  if (vp) {
    add('Validator profile', `${esc(vp.profile_name || '')}<br><span class="muted">${esc((state.usedProfile.path || '').split('/').slice(-3).join('/'))}</span>`);
    add('Units', `FBX in ${esc(m.units?.unreal_units || vp.units?.assumed_source_units || 'cm')}, import scale ${esc(vp.units?.import_scale ?? 1)}${vp.units?.trust_file_units ? ', file units trusted' : ''}`);
    add('Up axis', `${esc(String(vp.axes?.up || 'Z').toUpperCase())} up (validator, FBX)${m.export_up_axis ? '' : ' · manifest has no export_up_axis, Z assumed'}<br><span class="muted">browser reads the GLB preview: Y up by glTF spec</span>`);
    const h = vp.units?.expected_height_cm || {};
    add('Height range', `${esc(h.min)}–${esc(h.max)} cm (${esc(vp.asset_type || '')})`);
    const lods = normalizeLods(m);
    add('LOD budgets', (vp.lods?.triangle_budgets || []).map((t, i) => { const mb = lods.find((l) => l.level === i)?.budget_triangles; return `LOD${i} ${fmt(t)}${mb != null && mb !== t ? ` <span class="bad">(manifest ${fmt(mb)})</span>` : ''}`; }).join(' · ') +
      (placeholder ? '<br><span class="muted">mirror the pipeline\'s own targets, not a studio spec</span>' : ''));
    add('Texel density', vp.texel_density?.target_px_per_cm != null ? `${esc(vp.texel_density.target_px_per_cm)} px/cm ±${esc(vp.texel_density.tolerance_pct)}%` : 'no target (not checked; measured value shown as info)');
    add('Textures', `required: ${esc((vp.materials?.required_texture_slots || []).join(', ') || 'none')}; recommended: ${esc((vp.materials?.recommended_texture_slots || []).join(', ') || 'none')}`);
    add('Skeleton', vp.skeleton?.required ? `required (${esc(vp.skeleton.root_bone_name)})` : 'not required (static mesh)');
    add('Max flipped faces', esc(vp.normals?.max_flipped_faces ?? 0));
  } else {
    add('Validator profile', 'generated from the editable profile in export mode (cm, scale 1.0, up = manifest export_up_axis or Z)');
    add('LOD budgets', normalizeLods(m).map((l) => `LOD${l.level} ${l.budget_triangles != null ? fmt(l.budget_triangles) : '—'}`).join(' · ') + ' (manifest)');
  }
  $('up-rows').innerHTML = rows.join('');
}

// Validator report (sculptline_validator, formerly fabled_validator; schema report.schema.json 0.1.0) or the CONCEPT MOCKUP stub.
const STATUS_MAP = { pass: ['info', true], warn: ['warning', false], fail: ['error', false], not_checked: ['info', null] };
const itemLabel = (it) => (typeof it === 'string' ? it : it?.object || it?.mesh || it?.name || it?.file || it?.material || null);
export function normalizeChecks(report) {
  const raw = Array.isArray(report?.checks) ? report.checks : [];
  return raw.map((c) => {
    const st = typeof c.status === 'string' ? STATUS_MAP[c.status.toLowerCase()] : null;
    const items = Array.isArray(c.items) ? c.items.map(itemLabel).filter(Boolean) : [];
    const total = c.items_total ?? items.length;
    return {
      id: c.id, status: c.status ?? null,
      severity: (c.severity || st?.[0] || 'info').toLowerCase(),
      passed: typeof c.passed === 'boolean' ? c.passed : st ? st[1] : null,
      message: [c.title, c.message].filter(Boolean).join(': '),
      // validator d07216e: manifest check lists every problem in full; render as a list (same text as the message)
      list: [...(c.measured?.problems_fail_list || []).map((t) => ['fail', t]), ...(c.measured?.problems_warn_list || []).map((t) => ['warn', t])],
      object: c.object || (items.length ? items.slice(0, 3).join(', ') + (total > 3 ? ` +${total - 3} more` : '') : null),
      fix_hint: c.fix_hint || null,
      measured: c.measured || {},
      expected: c.expected || {},
    };
  });
}

async function runValidator(profile) {
  const src = $('validator-source'); const note = $('validator-note'); const list = $('checks-validator'); const head = $('validator-headline');
  head.innerHTML = '';
  if (DEMO) {
    const rep = state.demo.report; state.validator = rep; state.validatorJob = rep;
    renderReportHead(rep, `${validatorTool(rep)} · real report (recorded)`);
    const tgt = rep.manifest?.path ? 'the run manifest' : (rep.asset?.file_name || (rep.asset?.path || '').split('/').pop() || 'the run');
    note.textContent = `Recorded validator report (${state.demo.info.validator_report_origin || 'recorded'}), generated ${fmtPT(rep.generated_at) || 'n/a'} on ${tgt}. Profile file: ${state.demo.info.validator_profile_file}. Not re-run in the browser.`;
    renderChecks(list, normalizeChecks(rep)); return;
  }
  await state.upload; const jobAtStart = state.jobId;
  if (!state.jobId) { src.textContent = 'server offline'; src.className = 'pill'; note.textContent = 'Local server not reachable; validator not run.'; list.innerHTML = ''; return; }
  try {
    const r = await fetch(`/api/jobs/${state.jobId}/validate`, { method: 'POST', body: JSON.stringify(profile) }); const j = await r.json();
    if (state.jobId !== jobAtStart) return; // a different file/output was opened meanwhile; drop this stale result
    if (!r.ok || j.ok === false) { state.validator = null; src.textContent = 'validator error'; src.className = 'pill'; note.textContent = `${j.error} ${(j.stderr || '').trim().split('\n').slice(-2).join(' | ')}`; list.innerHTML = ''; console.warn('validator error', j); return; }
    const rep = j.report; state.validator = rep; state.validatorJob = rep.concept_mockup ? null : rep;
    if (j.profile_used_content && state.readonly) { state.usedProfile = { path: j.profile_used, content: j.profile_used_content }; renderUsedProfile(); }
    if (rep.concept_mockup) {
      src.textContent = 'CONCEPT MOCKUP · stub, not from your file'; src.className = 'pill mock'; note.textContent = rep.concept_mockup_note || '';
    } else {
      renderReportHead(rep, `${validatorTool(rep)} · real report`);
      const t = j.target || {};
      note.textContent = `Profile file: ${(j.profile_used || '').split('/').slice(-2).join('/')} · Checked ${t.kind === 'manifest' ? 'pipeline manifest' : t.kind === 'combined_fbx' ? 'combined FBX' : 'uploaded sculpt'}: ${(t.path || rep.asset?.path || '').split('/').pop()} · exit ${j.exit_code}`;
    }
    renderChecks(list, normalizeChecks(rep));
  } catch (e) { src.textContent = 'error'; note.textContent = String(e); console.warn(e); }
}

// Headline for a real validator report (schema 0.1.0 / 0.2.0): overall_status, summary as-is,
// complete, error (incl. manifest_error), profile name (DEMO PLACEHOLDER label shown prominently), manifest object.
// Tool name as recorded in the report (reports written before the rebrand say fabled_validator), then the version.
const validatorTool = (rep) => `${rep.tool?.name || 'sculptline_validator'} ${rep.tool?.version ?? ''}`;
function renderReportHead(rep, label) {
  const src = $('validator-source'); src.textContent = label; src.className = 'pill real';
  const os = rep.overall_status; const sm = rep.summary; const pn = rep.profile?.name || '';
  const placeholder = /DEMO PLACEHOLDER|example values/i.test(pn); const phText = /DEMO PLACEHOLDER/i.test(pn) ? 'DEMO PLACEHOLDER VALUES' : 'EXAMPLE VALUES · not a studio spec';
  const mf = rep.manifest;
  $('validator-headline').innerHTML = `${os ? `<span class="ostatus ${esc(os)}">${esc(os)}</span>` : ''}` +
    (sm ? `<span>pass ${sm.pass} · warn ${sm.warn} · fail ${sm.fail} · not checked ${sm.not_checked} · total ${sm.total} · flagged ${sm.flagged}</span>` : '') +
    `<span class="muted">complete: ${rep.complete === true ? 'yes' : rep.complete === false ? 'no (some checks not run)' : 'n/a'}</span>` +
    (pn ? `<div class="vprofile">${placeholder ? `<span class="placeholder-tag">${phText}</span>` : ''}Profile: ${esc(pn)}</div>` : '') +
    (mf ? `<div class="vprofile muted">Manifest: ${esc((mf.path || '').split('/').slice(-3).join('/'))}${mf.readable === false ? ' · not readable' : ''}${mf.lod_count != null ? ` · ${mf.lod_count} LODs listed` : ''}${mf.error ? ` · ${esc(typeof mf.error === 'string' ? mf.error : mf.error.message)}` : ''}</div>` : '') +
    (() => { const mm = (rep.checks || []).find((c) => c.id === 'manifest')?.measured || {}; const ax = [['source', mm.source_up_axis], ['export', mm.export_up_axis], ['FBX', mm.fbx_up_axis]].filter(([, v]) => v);
      return ax.length ? `<div class="vprofile muted">Up axis (manifest check): ${ax.map(([k, v]) => `${k} ${esc(v)}`).join(' · ')}</div>` : ''; })() +
    (rep.error ? `<div class="verror"><b>${esc(rep.error.type)}</b>: ${esc(rep.error.message)}</div>` : '');
}

async function loadSavedReportList() {
  try {
    const j = await (await fetch('/api/saved-reports')).json(); const sel = $('saved-reports');
    sel.innerHTML = '<option value="">Saved validator reports…</option>' + j.reports.map((r) => `<option value="${esc(r.rel)}">${esc(r.rel)}</option>`).join('');
  } catch (e) { console.warn(e); }
}
$('btn-saved-report').onclick = () => showSavedReport($('saved-reports').value);
async function showSavedReport(rel) {
  if (!rel) return;
  const j = await (await fetch(`/api/saved-report?path=${encodeURIComponent(rel)}`)).json();
  if (!j.ok) { $('validator-note').textContent = j.error; return; }
  const rep = j.report; state.validator = rep;
  renderReportHead(rep, `${validatorTool(rep)} · real report (saved file)`);
  $('validator-note').textContent = `Saved report: validator/reports/${rel} · asset ${rep.asset?.file_name ?? ''} · generated ${rep.generated_at_display || rep.generated_at_local || rep.generated_at || ''}`;
  renderChecks($('checks-validator'), normalizeChecks(rep)); updateMockupBadge();
}
window.__sculptlineShowSavedReport = window.__fabledShowSavedReport = showSavedReport; // __fabled…: pre-rebrand alias

export function renderChecks(ul, checks) {
  ul.innerHTML = '';
  checks.forEach((c, idx) => {
    const li = document.createElement('li');
    const nc = c.status === 'not_checked';
    const info = c.passed === null || c.passed === undefined;
    li.className = `check ${nc ? 'nc' : c.passed === true ? 'pass' : info ? 'fail info' : `fail ${c.severity}`}`;
    li.dataset.id = c.id; li.dataset.passed = String(c.passed); if (c.status) li.dataset.status = c.status;
    const icon = nc ? '–' : c.passed === true ? '✓' : c.passed === false ? (c.severity === 'info' ? 'i' : '!') : 'i';
    const sevLabel = nc ? 'not checked' : c.passed === true ? 'pass' : c.passed === false ? c.severity : 'info';

    // Status badges (PASS in green, WARN in amber, FAIL in red)
    const badgeText = nc ? 'NOT CHECKED' : c.passed === true ? 'PASS' : c.severity === 'warning' ? 'WARN' : 'FAIL';
    const badgeCls = nc ? 'badge-nc' : c.passed === true ? 'badge-pass' : c.severity === 'warning' ? 'badge-warn' : 'badge-fail';
    const statusBadgeHtml = `<span class="check-badge ${badgeCls}">${badgeText}</span>`;

    // Rule explanation and fix suggestions
    const checkInfo = VALIDATOR_CHECKS_INFO.find((x) => x.id === c.id || c.id.startsWith(x.id)) || null;
    const ruleExpl = checkInfo?.explanation || (c.fix_hint ? 'Pre-import 3D asset quality check.' : 'Validation check for engine asset compatibility.');
    const fixHint = c.fix_hint || checkInfo?.fixHint || null;

    // Measured values vs thresholds
    let metricsHtml = '';
    const m = c.measured || {};
    const exp = c.expected || {};
    const metricPairs = [];
    if (m.height_cm != null) metricPairs.push(`Height: ${m.height_cm} cm (expected: ${exp.min_cm ?? 0}–${exp.max_cm ?? '∞'} cm)`);
    if (m.triangles_checked != null) metricPairs.push(`Triangles: ${fmt(m.triangles_checked)} (flags: ${m.faces_flagged ?? 0})`);
    if (m.uv_density_px_per_cm != null) metricPairs.push(`Texel density: ${m.uv_density_px_per_cm} px/cm (target: ${exp.target_px_per_cm ?? 'none'})`);
    if (m.bone_count != null) metricPairs.push(`Bones: ${m.bone_count}`);
    if (metricPairs.length > 0) {
      metricsHtml = `<div class="check-metrics-summary">${metricPairs.map((p) => `<span class="metric-chip">${esc(p)}</span>`).join(' ')}</div>`;
    }

    li.innerHTML = `<span class="icon">${icon}</span><div><div class="meta">${statusBadgeHtml}<span class="sev">${sevLabel}</span><span>${esc(c.id)}</span>${c.object ? `<span>· ${esc(c.object)}</span>` : ''}</div>` +
      (c.list?.length ? `<div>${esc(c.message.split(':')[0])}: ${c.list.length} problem${c.list.length === 1 ? '' : 's'}</div><ul class="plist">${c.list.map(([sev, t]) => {
        const m = /^(.*?\(\d+\)):\s*(.*)$/s.exec(t); const parts = m && m[2].includes(' | ') ? m[2].split(' | ') : null;
        return `<li class="${sev}"><b>${sev}</b> ${esc(parts ? m[1] : t)}${parts ? `<ol>${parts.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}</li>`; }).join('')}</ul>`
        : `<div>${esc(c.message)}</div>`) +
      metricsHtml +
      `<details class="check-details"><summary class="check-details-summary">Rule details &amp; fix suggestions</summary><div class="check-details-body"><div class="rule-expl"><strong>Rule explanation:</strong> ${esc(ruleExpl)}</div>${fixHint ? `<div class="rule-fix"><strong>Fix suggestion:</strong> ${esc(fixHint)}</div>` : ''}</div></details>` +
      `<div class="fix-slot"></div></div>`;
    ul.appendChild(li);
    if (li.animate) {
      li.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 240, delay: Math.min(idx * 18, 220), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
      );
    }
  });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function renderFixes(checks) {
  for (const ch of checks) {
    if (!ch.fix) continue;
    const c = document.querySelector(`#checks-browser li[data-id="${ch.id}"] .fix-slot`); if (!c) continue;
    const b = document.createElement('button'); b.className = 'btn fix';
    if (ch.fix.kind === 'scale') { b.textContent = `Set profile scale to ${ch.fix.value}`; b.onclick = () => { $('p-scale').value = ch.fix.value; recheck(); }; b.id = 'fix-scale'; }
    if (ch.fix.kind === 'flip') { b.textContent = `Preview unified winding (${fmt(ch.fix.count)} tris) · browser preview only`; b.title = 'Edits the in-browser copy only. The file on disk, the pipeline input and the validator result are unchanged.'; b.onclick = fixFlipped; b.id = 'fix-flip'; }
    c.appendChild(b);
  }
}
async function fixFlipped() {
  busy('Unifying winding…'); await tick();
  const w = state.src.welded; state.src.browserFixedFlips = (state.src.browserFixedFlips || 0) + state.topo.flippedTriangles.length;
  const rawIdx = (state.src.previewRawIndices ||= Uint32Array.from(state.src.flat.indices));
  flipTriangles(rawIdx, state.topo.flippedTriangles);
  flipTriangles(w.indices, state.topo.flippedTriangles);
  state.topo = analyzeTopology(w.positions, w.indices, { positions: state.src.flat.positions, indices: rawIdx, normals: state.src.flat.normals });
  showSource(false);
  if (state.lods.length) { state.lodsStale = state.lods.some((l) => l.source === 'preview'); showLod(state.lod); if (state.lodsStale) $('process-status').textContent = 'Winding fixed on the sculpt. Rebuild LODs to update the preview.'; }
  await recheck();
}

// ---------- connected workspace (tree, connections, asset page, AI generation) ----------
const IMG_RE = /\.(png|jpe?g|webp)$/i;
function setActiveAsset(id) { state.activeAssetId = id; workspace?.setActive(id); }
async function openJobAsset({ job_id, filename, has_manifest, running }, assetId) {
  busy(`Opening ${filename}…`);
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(job_id)}/input`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await handleFile(new File([await r.arrayBuffer()], filename), { jobId: job_id, assetId });
    if (running) { const res = await pollPipeline(); $('progress').hidden = true; await applyPipelineResult(res, readProfile()); }
    else if (has_manifest) {
      const res = await (await fetch(`/api/jobs/${encodeURIComponent(job_id)}/result`)).json();
      if (res.ok && res.manifest) await applyPipelineResult(res, readProfile());
    }
  } catch (e) { console.error(e); $('file-info').textContent = `Could not reopen ${filename}: ${e.message}`; }
  finally { busy(null); updateMockupBadge(); }
}
const workspace = initWorkspace({
  demo: DEMO,
  openOutput: (dir) => openOutput(dir),
  openJob: openJobAsset,
  openSample: async (url, filename) => {
    busy(`Fetching ${filename}…`);
    try { const r = await fetch(url); await handleFile(new File([await r.arrayBuffer()], filename)); } finally { busy(null); }
  },
  showPageTab: () => setInspectorTab('page'),
  // what the Generate dialog may use as input images: preview renders of the open pipeline output (served via the job)
  context: () => ({
    assetId: state.activeAssetId, jobId: state.jobId,
    previews: state.manifest && manifestIsReal(state.manifest) && state.jobId ? manifestFacts(state.manifest).previews.filter((p) => p?.path && IMG_RE.test(p.path)).map((p) => ({ rel: p.path, label: p.label })) : [],
  }),
  demoWorkspace: () => {
    const m = state.manifest; const info = state.demo?.info;
    if (!m) return { groups: [], total: 0 };
    const lods = normalizeLods(m);
    const rep = state.demo?.report;
    return { total: 1, groups: [{ id: 'runs', label: 'Pre-processed run', assets: [{
      id: 'run:demo', kind: 'frozen_run', name: manifestDisplayName(m, { short: true }) || 'asset',
      status: rep?.overall_status ? { label: `Validator ${String(rep.overall_status).toUpperCase()}`, tone: rep.overall_status === 'pass' ? 'ok' : rep.overall_status === 'warn' ? 'warn' : 'fail' } : { label: `Pipeline ${m.status}`, tone: 'ok' },
      pipeline_status: m.status, validator: rep ? { overall: rep.overall_status, summary: rep.summary } : null,
      triangles: { input: m.input?.triangles ?? null, lod_count: lods.length || null, lod0_triangles: lods[0]?.triangles ?? null },
      created_at: m.created_at, folder: info?.run_folder || null, open: { type: 'demo' } }] }] };
  },
});

// Initialize components
setEngine(state.engine || 'blender');
renderStageTelemetryCards();

if (DEMO) enterDemo();
else { refreshStatus(); loadSavedReportList(); }

// ---------- iPad Pro & Notion Sidebar Layout Switcher ----------
const modeBar = $('ipad-mode-bar');
const btnToggleLeft = $('btn-toggle-left');
const btnToggleRight = $('btn-toggle-right');

function animateCenterResize() {
  const centerEl = document.querySelector('.center');
  if (centerEl?.animate) {
    centerEl.animate([{ opacity: 0.88 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  }
  window.dispatchEvent(new Event('resize'));
}

if (btnToggleLeft) {
  btnToggleLeft.onclick = () => {
    document.body.classList.remove('layout-focus-3d', 'layout-split-check');
    const hidden = document.body.classList.toggle('hide-left-pane');
    btnToggleLeft.classList.toggle('active', !hidden);
    const side = document.querySelector('.sidebar');
    if (!hidden && side?.animate) {
      side.animate([{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    animateCenterResize();
  };
}
if (btnToggleRight) {
  btnToggleRight.onclick = () => {
    document.body.classList.remove('layout-focus-3d', 'layout-split-check');
    const hidden = document.body.classList.toggle('hide-right-pane');
    btnToggleRight.classList.toggle('active', !hidden);
    const rep = document.querySelector('.report');
    if (!hidden && rep?.animate) {
      rep.animate([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    animateCenterResize();
  };
}
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    btnToggleLeft?.click();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
    e.preventDefault();
    btnToggleRight?.click();
  }
});

if (modeBar) {
  modeBar.querySelectorAll('button[data-layout-mode]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.layoutMode;
      modeBar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      document.body.classList.remove('layout-focus-3d', 'layout-split-check', 'hide-left-pane', 'hide-right-pane');
      if (mode === 'focus-3d') document.body.classList.add('layout-focus-3d');
      if (mode === 'split-check') document.body.classList.add('layout-split-check');
      animateCenterResize();
    };
  });
}

// ---------- UV & Baked Map Inspector Modal ----------
const mapDialog = $('map-dialog');
const btnInspectMaps = $('btn-inspect-maps');
const btnCloseMaps = $('btn-close-maps');
if (btnInspectMaps && mapDialog) {
  btnInspectMaps.onclick = () => {
    populateMapDialog();
    mapDialog.showModal();
  };
  if (btnCloseMaps) btnCloseMaps.onclick = () => mapDialog.close();
  mapDialog.addEventListener('click', (e) => {
    if (e.target === mapDialog) mapDialog.close();
  });
}

function populateMapDialog() {
  const grid = $('map-grid');
  if (!grid) return;
  const m = state.manifest || state.demo?.manifest;
  const f = manifestFacts(m);
  const cards = [];
  if (f.previews?.length) {
    for (const p of f.previews) {
      cards.push({
        title: p.label || p.name || 'Preview',
        sub: p.path,
        src: fileUrl(p.path),
      });
    }
  }
  const texSets = Array.isArray(f.textures) ? f.textures : f.textures ? [f.textures] : [];
  for (const tex of texSets) {
    for (const [k, label] of [['normal', 'Tangent-Space Normal Map'], ['orm', 'Packed ORM (AO · Roughness · Metallic)'], ['base_color', 'Base Color Map']]) {
      const disp = DEMO ? state.demo?.info?.display_textures?.[k] : null;
      const path = disp?.path || tex[k];
      if (typeof path === 'string') {
        cards.push({
          title: label,
          sub: disp ? `${disp.width}×${disp.height} px · ${disp.convention || 'baked texture'}` : path,
          src: fileUrl(path),
        });
      }
    }
  }
  if (!cards.length) {
    // Fallback to latest pipeline output previews when inspecting before opening a run
    const fallback = [
      ['High-Poly vs LOD0 Shaded', '/api/output-file?path=previews/compare_shaded_highpoly_vs_lod0.png'],
      ['LOD0–LOD3 Wireframe Strip', '/api/output-file?path=previews/lod_strip_wire.png'],
      ['UV Layout (LOD0)', '/api/output-file?path=previews/uv_layout_lod0.png'],
      ['Tangent Normal Map (1024px)', '/api/output-file?path=previews/normal_map_texture_1024.png'],
      ['Ambient Occlusion / ORM Map', '/api/output-file?path=previews/ao_map_texture_1024.png'],
    ];
    for (const [title, src] of fallback) {
      cards.push({ title, sub: 'Latest pipeline output artifact', src });
    }
  }
  grid.innerHTML = cards.map((c) => `
    <div class="map-card">
      <a href="${esc(c.src)}" target="_blank" rel="noopener"><img src="${esc(c.src)}" alt="${esc(c.title)}" loading="lazy" /></a>
      <strong>${esc(c.title)}</strong>
      <span>${esc(c.sub)}</span>
    </div>
  `).join('');
}

// ---------- Storyboard Guided Demo Bar ----------
const demoTour = $('demo-tour');
if (demoTour) {
  demoTour.querySelectorAll('button[data-beat]').forEach((btn) => {
    btn.onclick = async () => {
      demoTour.querySelectorAll('button[data-beat]').forEach((b) => b.classList.toggle('active', b === btn));
      triggerAmbientPulse();
      const beat = Number(btn.dataset.beat);
      if (beat === 1) {
        if (!DEMO) await $('btn-sample').click();
      } else if (beat === 2) {
        if ($('edit-profile')?.hidden && $('btn-show-edit')) $('btn-show-edit').click();
        const advDrawer = $('profile-advanced-drawer');
        if (advDrawer && !advDrawer.open) advDrawer.open = true;
        $('edit-profile')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (beat === 3) {
        if (!DEMO) {
          if (!$('btn-open-frozen').disabled) await $('btn-open-frozen').click();
          else await $('btn-open-output').click();
        } else {
          showLod(0);
        }
      } else if (beat === 4) {
        if (!state.lods.length && !DEMO) {
          if (!$('btn-open-frozen').disabled) await $('btn-open-frozen').click();
          else await $('btn-open-output').click();
        }
        $('t-wire').checked = true;
        $('t-wire').onchange();
        if (state.lods.length > 1) showLod((state.lod + 1) % state.lods.length);
      } else if (beat === 5) {
        if (!DEMO && (!state.src || state.readonly)) await $('btn-sample').click();
        setInspectorTab('browser');
        await recheck();
        $('checks-browser')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (beat === 6) {
        if (!DEMO && (!state.src || state.readonly)) await $('btn-sample').click();
        setInspectorTab('browser');
        const fixScale = $('fix-scale');
        if (fixScale) fixScale.click();
        const fixFlip = $('fix-flip');
        if (fixFlip) await fixFlip.click();
      }
    };
  });
}

// ---------- Notion-Style Inspector Filter Tabs & Smooth JS Drawer Animations ----------
const itabContainer = $('inspector-tabs');
function setInspectorTab(tab) {
  if (!itabContainer) return;
  itabContainer.querySelectorAll('.itab').forEach((b) => b.classList.toggle('active', b.dataset.itab === tab));
  const panes = {
    page: $('pane-page'),
    browser: $('pane-browser'),
    validator: $('pane-validator'),
    pipeline: $('pane-pipeline'),
  };
  for (const [k, el] of Object.entries(panes)) {
    if (!el) continue;
    const show = tab === 'all' || tab === k;
    el.hidden = !show;
    if (show && k === 'pipeline' && $('pipeline-section')) {
      $('pipeline-section').hidden = false;
    }
    if (show && el.animate) {
      el.animate(
        [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  }
}
if (itabContainer) {
  itabContainer.querySelectorAll('.itab').forEach((btn) => {
    btn.onclick = () => setInspectorTab(btn.dataset.itab);
  });
}

// Smooth Web Animations API expansion for <details class="ws-drawer">
document.querySelectorAll('details.ws-drawer').forEach((det) => {
  const summary = det.querySelector('summary');
  const body = det.querySelector('.ws-drawer-body');
  if (!summary || !body) return;
  summary.addEventListener('click', (e) => {
    if (!body.animate) return;
    e.preventDefault();
    if (det.open) {
      const anim = body.animate(
        [{ height: `${body.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 190, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      );
      anim.onfinish = () => { det.open = false; };
    } else {
      det.open = true;
      body.animate(
        [{ height: '0px', opacity: 0, transform: 'translateY(-4px)' }, { height: `${body.offsetHeight}px`, opacity: 1, transform: 'translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  });
});

// ---------- 60fps JavaScript Ambient Light-Show & Dynamic Theme Engine ----------
export const THEME_PRESETS = {
  palantir: {
    primary: [139, 92, 246],
    bright: [167, 139, 250],
    secondary: [56, 189, 248],
    orbs: [
      [139, 92, 246],   // Royal Violet
      [99, 102, 241],   // Deep Indigo
      [56, 189, 248],   // Tactical Cyan
      [168, 85, 247],   // Amethyst
      [79, 70, 229],    // Cobalt Violet
    ],
  },
  prism: {
    primary: [168, 85, 247],
    bright: [192, 132, 252],
    secondary: [6, 182, 212],
    orbs: [
      [168, 85, 247],   // Electric Purple
      [6, 182, 212],    // Cyber Cyan
      [236, 72, 153],   // Neon Rose
      [16, 185, 129],   // Emerald Pulse
      [99, 102, 241],   // Indigo
    ],
  },
  gotham: {
    primary: [14, 165, 233],
    bright: [56, 189, 248],
    secondary: [139, 92, 246],
    orbs: [
      [14, 165, 233],   // Gotham Sky
      [59, 130, 246],   // Tactical Blue
      [20, 184, 166],   // Teal Telemetry
      [99, 102, 241],   // Indigo Hint
      [56, 189, 248],   // Ice Cyan
    ],
  },
  crimson: {
    primary: [244, 63, 94],
    bright: [251, 113, 133],
    secondary: [139, 92, 246],
    orbs: [
      [244, 63, 94],    // Ops Crimson
      [139, 92, 246],   // Deep Violet
      [245, 158, 11],   // Amber Signal
      [190, 18, 60],    // Ruby
      [168, 85, 247],   // Purple
    ],
  },
  emerald: {
    primary: [16, 185, 129],
    bright: [52, 211, 153],
    secondary: [56, 189, 248],
    orbs: [
      [16, 185, 129],   // Emerald Core
      [6, 182, 212],    // Cyan
      [139, 92, 246],   // Violet Hint
      [20, 184, 166],   // Teal
      [59, 130, 246],   // Cobalt
    ],
  },
};

let ambientPulseEnergy = 0;
function triggerAmbientPulse() {
  ambientPulseEnergy = 1.0;
}

(function initAmbientLightShow() {
  const canvas = $('ambient-bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  // Smooth mouse parallax tracking
  let targetMouseX = 0.5, targetMouseY = 0.35;
  let curMouseX = 0.5, curMouseY = 0.35;
  window.addEventListener('pointermove', (e) => {
    targetMouseX = e.clientX / Math.max(1, width);
    targetMouseY = e.clientY / Math.max(1, height);
  }, { passive: true });

  // Current & Target interpolated RGB colors for smooth theme transitions
  let currentPrimary = [...THEME_PRESETS.palantir.primary];
  let targetPrimary = [...THEME_PRESETS.palantir.primary];
  let currentBright = [...THEME_PRESETS.palantir.bright];
  let targetBright = [...THEME_PRESETS.palantir.bright];
  let currentSecondary = [...THEME_PRESETS.palantir.secondary];
  let targetSecondary = [...THEME_PRESETS.palantir.secondary];

  const orbs = THEME_PRESETS.palantir.orbs.map((rgb, i) => ({
    curRgb: [...rgb],
    targetRgb: [...rgb],
    freqX: 0.00022 + i * 0.00005,
    freqY: 0.00018 + i * 0.00006,
    phaseX: i * 1.4,
    phaseY: i * 2.1,
    radiusFactor: 0.32 + (i % 3) * 0.08,
  }));

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  function rgbToInt([r, g, b]) {
    return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255);
  }

  function applyThemeTarget(preset) {
    targetPrimary = [...preset.primary];
    targetBright = [...preset.bright];
    targetSecondary = [...preset.secondary];
    orbs.forEach((o, i) => {
      o.targetRgb = [...preset.orbs[i % preset.orbs.length]];
    });
    triggerAmbientPulse();
  }

  const themeSelect = $('theme-select');
  const customInput = $('theme-custom-color');
  if (themeSelect) {
    themeSelect.onchange = () => {
      const val = themeSelect.value;
      if (val === 'custom' && customInput) {
        customInput.click();
        return;
      }
      const preset = THEME_PRESETS[val] || THEME_PRESETS.palantir;
      applyThemeTarget(preset);
    };
  }
  if (customInput) {
    customInput.oninput = () => {
      if (themeSelect) themeSelect.value = 'custom';
      const [r, g, b] = hexToRgb(customInput.value);
      const bright = [Math.min(255, r + 35), Math.min(255, g + 35), Math.min(255, b + 35)];
      const comp = [b, Math.min(255, Math.round(r * 0.7 + 60)), g];
      applyThemeTarget({
        primary: [r, g, b],
        bright,
        secondary: comp,
        orbs: [
          [r, g, b],
          comp,
          [Math.round(r * 0.6 + 50), g, Math.min(255, b + 60)],
          bright,
          [Math.min(255, b + 40), Math.round(g * 0.7), r],
        ],
      });
    };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp3 = (cur, tgt, t) => {
    cur[0] = lerp(cur[0], tgt[0], t);
    cur[1] = lerp(cur[1], tgt[1], t);
    cur[2] = lerp(cur[2], tgt[2], t);
  };

  let lastCssSync = 0;
  function renderFrame(now) {
    curMouseX = lerp(curMouseX, targetMouseX, 0.04);
    curMouseY = lerp(curMouseY, targetMouseY, 0.04);
    ambientPulseEnergy = Math.max(0, ambientPulseEnergy * 0.96 - 0.002);

    // Smoothly interpolate theme colors
    lerp3(currentPrimary, targetPrimary, 0.06);
    lerp3(currentBright, targetBright, 0.06);
    lerp3(currentSecondary, targetSecondary, 0.06);
    for (const o of orbs) lerp3(o.curRgb, o.targetRgb, 0.05);

    // Sync CSS variables & Three.js 3D viewport lights every ~50ms while transitioning
    if (now - lastCssSync > 48) {
      lastCssSync = now;
      const [pr, pg, pb] = currentPrimary.map(Math.round);
      const [br, bg, bb] = currentBright.map(Math.round);
      const [sr, sg, sb] = currentSecondary.map(Math.round);
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--purple', `rgb(${pr}, ${pg}, ${pb})`);
      rootStyle.setProperty('--brown', `rgb(${pr}, ${pg}, ${pb})`);
      rootStyle.setProperty('--purple-bright', `rgb(${br}, ${bg}, ${bb})`);
      rootStyle.setProperty('--purple-dim', `rgba(${pr}, ${pg}, ${pb}, 0.14)`);
      rootStyle.setProperty('--purple-glow', `rgba(${pr}, ${pg}, ${pb}, 0.38)`);
      rootStyle.setProperty('--cyan', `rgb(${sr}, ${sg}, ${sb})`);
      if (left?.setThemeColors) left.setThemeColors(rgbToInt(currentBright), rgbToInt(currentSecondary));
      if (right?.setThemeColors) right.setThemeColors(rgbToInt(currentBright), rgbToInt(currentSecondary));
    }

    // Clear to deep Palantir void black
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);

    // Draw drifting volumetric aurora light-show orbs
    const minDim = Math.min(width, height);
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      const [r, g, b] = o.curRgb.map(Math.round);
      const lissX = 0.5 + 0.36 * Math.sin(now * o.freqX + o.phaseX) + (curMouseX - 0.5) * (0.12 + i * 0.03);
      const lissY = 0.5 + 0.34 * Math.cos(now * o.freqY + o.phaseY) + (curMouseY - 0.5) * (0.12 + i * 0.03);
      const cx = lissX * width;
      const cy = lissY * height;
      const breath = 1 + 0.12 * Math.sin(now * 0.0012 + i) + ambientPulseEnergy * 0.25;
      const rad = Math.max(220, minDim * o.radiusFactor * breath);
      const alpha = (0.095 + ambientPulseEnergy * 0.07) * (i === 0 ? 1.25 : 0.85);

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.42).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Subtle pointer spotlight glow
    const [pr, pg, pb] = currentBright.map(Math.round);
    const px = curMouseX * width;
    const py = curMouseY * height;
    const pGrad = ctx.createRadialGradient(px, py, 0, px, py, 320);
    pGrad.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0.075)`);
    pGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = pGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);
})();
