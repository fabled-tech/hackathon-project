// Connected workspace: one index of everything the local server can see, built from disk on every request.
// Nothing here is invented: names, statuses, triangle counts and dates come from manifests, validator reports,
// job.json files, provider tasks and SAMPLE_INFO.json. Missing values stay null and the UI shows "—".
//
// Sources, in tree order:
//   runs      pipeline/output and pipeline/runs/<timestamp> (read-only pipeline outputs)
//   uploads   ui/work/<job> with an uploaded sculpt (not read-only "open output" jobs); newest first, capped
//   generated provider tasks (AI generations) plus the upload jobs they were imported into
//   samples   ui/samples/* and ui/test_fixtures/* (fixtures are labeled TEST FIXTURE)
// Notes:    ui/work/workspace_notes.json   { [asset_id]: { text, updated_at } }
// Activity: ui/work/activity.jsonl         one JSON event per line
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { licensedSample, manifestDisplayName, isProceduralSampleRun } from './public/licensed.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const mtimeIso = (p) => { try { return fs.statSync(p).mtime.toISOString(); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

export const UPLOADS_SHOWN = 12;
export const NOTE_MAX_CHARS = 20000;

function validatorStatus(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    overall: report.overall_status || null,
    summary: report.summary || null,
    generated_at: report.generated_at || null,
    concept_mockup: !!report.concept_mockup,
  };
}

// One status label + tone per asset, from the strongest real signal available.
function deriveStatus({ manifest, validator, running = false, uploaded = false, generation = null }) {
  if (running) return { label: 'Pipeline running', tone: 'running' };
  if (generation) {
    const s = generation.status;
    if (s === 'succeeded') return { label: generation.imported_job_id ? 'Imported' : 'Ready to import', tone: generation.concept_mockup ? 'mock' : 'ok' };
    if (s === 'failed') return { label: 'Generation failed', tone: 'fail' };
    return { label: s === 'queued' ? 'Queued' : `Generating${generation.progress != null ? ` ${Math.round(generation.progress)}%` : ''}`, tone: 'running' };
  }
  if (manifest?.test_fixture) return { label: 'TEST FIXTURE', tone: 'mock' };
  if (manifest?.concept_mockup) return { label: 'CONCEPT MOCKUP', tone: 'mock' };
  if (validator?.overall) {
    const o = String(validator.overall).toLowerCase();
    return { label: `Validator ${o.toUpperCase()}`, tone: o === 'pass' ? 'ok' : o === 'warn' ? 'warn' : validator.concept_mockup ? 'mock' : 'fail' };
  }
  if (manifest?.status) return { label: `Pipeline ${manifest.status}`, tone: manifest.status === 'ok' ? 'ok' : 'fail' };
  if (uploaded) return { label: 'Uploaded', tone: 'neutral' };
  return { label: 'No run yet', tone: 'neutral' };
}

function lodFacts(manifest) {
  const lods = Array.isArray(manifest?.lods) && manifest.lods.length ? manifest.lods : (manifest?.outputs?.lods || []);
  return { lod_count: lods.length || null, lod0_triangles: lods[0]?.triangles ?? null };
}

function runAsset(protoDir, dir, kind, extra = {}) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest) return null;
  const rel = path.relative(protoDir, dir);
  const lic = licensedSample(manifest);
  const validator = validatorStatus(readJson(path.join(dir, 'validator_report.json')));
  return {
    id: `run:${rel}`,
    kind,
    name: manifestDisplayName(manifest, { short: true }) || path.basename(dir),
    procedural_sample_run: isProceduralSampleRun(manifest),
    file_asset_name: manifest.asset || null,
    licensed: !!lic,
    status: deriveStatus({ manifest, validator }),
    pipeline_status: manifest.status || null,
    validator,
    triangles: { input: manifest.input?.triangles ?? null, ...lodFacts(manifest) },
    created_at: manifest.created_at || mtimeIso(path.join(dir, 'manifest.json')),
    concept_mockup: !!(manifest.concept_mockup || manifest.test_fixture),
    test_fixture: !!manifest.test_fixture,
    folder: rel,
    open: { type: 'output', dir: rel },
    source: isProceduralSampleRun(manifest) ? { name: 'ui/samples/fabled_sample_head.glb (procedural, tools/make_sample_sculpt.py)', license: 'no restrictions', url: null }
      : manifest.source ? { name: lic ? lic.shortName : manifest.source.name || null, license: manifest.source.license || null, url: manifest.source.url || null } : null,
    ...extra,
  };
}

function jobAsset(uiDir, workDir, id, runs, tasksByJob) {
  const dir = path.join(workDir, id);
  const job = readJson(path.join(dir, 'job.json'));
  if (!job || job.readonly || !job.input) return null;
  const inputPath = path.join(dir, path.basename(job.input));
  if (!fs.existsSync(inputPath)) return null;
  const outDir = path.join(dir, 'out');
  const manifest = readJson(path.join(outDir, 'manifest.json'));
  const validator = validatorStatus(readJson(path.join(dir, 'validator_report.json')));
  const gen = job.provenance || null;
  const task = tasksByJob.get(id) || null;
  const running = !!runs.get(id)?.running;
  return {
    id: `job:${id}`,
    kind: gen ? 'generated' : 'upload',
    name: path.basename(job.input),
    status: deriveStatus({ manifest, validator, running, uploaded: true }),
    pipeline_status: manifest?.status || null,
    validator,
    triangles: { input: manifest?.input?.triangles ?? null, ...lodFacts(manifest) },
    created_at: job.created_at || mtimeIso(path.join(dir, 'job.json')),
    concept_mockup: !!(gen?.concept_mockup || task?.concept_mockup || manifest?.concept_mockup),
    engine: job.engine || null,
    folder: path.relative(path.dirname(uiDir), dir),
    open: { type: 'job', job_id: id, filename: path.basename(job.input), has_manifest: !!manifest },
    provenance: gen,
  };
}

function generationAsset(t) {
  return {
    id: `gen:${t.id}`,
    kind: 'generation',
    name: t.prompt ? t.prompt.slice(0, 60) : `${t.provider_name} ${t.kind}`,
    status: deriveStatus({ generation: t }),
    created_at: t.created_at,
    concept_mockup: !!t.concept_mockup,
    open: { type: 'generation', task_id: t.id },
    provenance: { provider: t.provider, provider_name: t.provider_name, kind: t.kind, task_id: t.id, prompt: t.prompt, image_label: t.image_label, source_asset_id: t.source_asset_id },
    generation: t,
  };
}

function sampleAssets(uiDir) {
  const out = [];
  const info = readJson(path.join(uiDir, 'samples', 'SAMPLE_INFO.json'))?.files || {};
  const sdir = path.join(uiDir, 'samples');
  if (isDir(sdir)) {
    for (const f of fs.readdirSync(sdir).filter((x) => /\.(glb|gltf|obj|fbx|ply|stl)$/i.test(x)).sort()) {
      const i = info[f] || {};
      out.push({
        id: `sample:${f}`, kind: 'sample', name: f,
        status: { label: i.flipped_triangles_seeded ? `${i.flipped_triangles_seeded.toLocaleString('en-US')} seeded flips` : 'Sample', tone: 'neutral' },
        triangles: { input: i.triangles ?? null, lod_count: null, lod0_triangles: null },
        created_at: mtimeIso(path.join(sdir, f)), concept_mockup: false, folder: `ui/samples/${f}`,
        open: { type: 'sample', url: `/samples/${encodeURIComponent(f)}`, filename: f },
        source: { name: 'Procedural sample sculpt (self-made, tools/make_sample_sculpt.py)', license: 'no restrictions', url: null },
      });
    }
  }
  return out;
}

export function buildWorkspace({ protoDir, pipelineDir, uiDir, workDir, runs = new Map(), tasks = [] }) {
  const groups = { runs: [], uploads: [], generated: [], samples: [] };

  // Pipeline outputs (read-only)
  const outDir = path.join(pipelineDir, 'output');
  const latestOut = runAsset(protoDir, outDir, 'pipeline_output', { label: 'Latest pipeline output' });
  if (latestOut) groups.runs.push(latestOut);
  const runsDir = path.join(pipelineDir, 'runs');
  let latestReal = null;
  try { latestReal = fs.realpathSync(path.join(runsDir, 'latest')); } catch { /* none */ }
  if (isDir(runsDir)) {
    for (const name of fs.readdirSync(runsDir).sort().reverse()) {
      const p = path.join(runsDir, name);
      if (name === 'latest' || !isDir(p) || fs.lstatSync(p).isSymbolicLink()) continue;
      const a = runAsset(protoDir, p, 'frozen_run', { label: `Frozen run ${name}`, frozen_latest: p === latestReal });
      if (a) groups.runs.push(a);
    }
  }

  // Upload jobs (+ generated imports)
  const tasksByJob = new Map(tasks.filter((t) => t.imported_job_id).map((t) => [t.imported_job_id, t]));
  const jobs = [];
  if (isDir(workDir)) {
    for (const id of fs.readdirSync(workDir)) {
      if (!/^[a-z0-9-]{8,40}$/.test(id)) continue;
      const a = jobAsset(uiDir, workDir, id, runs, tasksByJob);
      if (a) jobs.push(a);
    }
  }
  jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const uploads = jobs.filter((j) => j.kind === 'upload');
  groups.uploads = uploads.slice(0, UPLOADS_SHOWN);
  const generatedJobs = jobs.filter((j) => j.kind === 'generated');

  // AI generations: tasks not imported yet, then imported jobs (the job is the asset from then on)
  for (const t of tasks) if (!t.imported_job_id) groups.generated.push(generationAsset(t));
  groups.generated.push(...generatedJobs);

  // Samples & fixtures
  groups.samples.push(...sampleAssets(uiDir));
  const fx = path.join(uiDir, 'test_fixtures');
  if (isDir(fx)) for (const name of fs.readdirSync(fx).sort()) {
    const a = runAsset(protoDir, path.join(fx, name), 'fixture', { label: 'TEST FIXTURE' });
    if (a) groups.samples.push(a);
  }

  const G = [
    { id: 'runs', label: 'Pipeline runs', assets: groups.runs },
    { id: 'uploads', label: 'Uploads', assets: groups.uploads, hidden_count: Math.max(0, uploads.length - UPLOADS_SHOWN) },
    { id: 'generated', label: 'AI generations', assets: groups.generated },
    { id: 'samples', label: 'Samples & fixtures', assets: groups.samples },
  ];
  return { schema: 'fabled.workspace/0.1', generated_at: new Date().toISOString(), groups: G, total: G.reduce((n, g) => n + g.assets.length + (g.hidden_count || 0), 0) };
}

// ---- notes ----
const ASSET_ID_RE = /^(run|job|gen|sample):[\w./:@-]{1,300}$/;
export const validAssetId = (id) => typeof id === 'string' && ASSET_ID_RE.test(id) && !id.includes('..');

export class NotesStore {
  constructor(file) { this.file = file; this.lock = Promise.resolve(); }
  all() { return readJson(this.file)?.notes || {}; }
  get(assetId) { return this.all()[assetId] || null; }
  async set(assetId, text) {
    if (!validAssetId(assetId)) throw new Error('bad asset id');
    const clean = String(text ?? '').slice(0, NOTE_MAX_CHARS);
    // serialize writes so two quick saves cannot interleave
    const run = this.lock.then(async () => {
      const notes = this.all();
      if (clean.trim()) notes[assetId] = { text: clean, updated_at: new Date().toISOString() };
      else delete notes[assetId];
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp.${process.pid}.${Date.now()}`;
      await fsp.writeFile(tmp, JSON.stringify({ schema: 'fabled.workspace_notes/0.1', notes }, null, 2));
      await fsp.rename(tmp, this.file);
      return notes[assetId] || null;
    });
    this.lock = run.catch(() => {});
    return run;
  }
}

// ---- activity ----
export class ActivityLog {
  constructor(file) { this.file = file; }
  async add(evt) {
    const e = { at: new Date().toISOString(), ...evt };
    if (e.message) e.message = String(e.message).slice(0, 500);
    try { await fsp.mkdir(path.dirname(this.file), { recursive: true }); await fsp.appendFile(this.file, JSON.stringify(e) + '\n'); } catch { /* activity is best-effort */ }
    return e;
  }
  list({ assetId = null, limit = 50 } = {}) {
    let lines = [];
    try { lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      if (!assetId || e.asset_id === assetId) out.push(e);
    }
    return out;
  }
}
