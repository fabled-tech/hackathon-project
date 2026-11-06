// Provider plugin registry + task store for entertainment-AI generation services.
//
// A provider plugin is a plain object:
//   { id, name, category, kinds: ['text-to-3d'|'image-to-3d'|'image-to-video'], env: [VAR names], docs, verification,
//     verification_note, feeds, concept_mockup?, configured(env) -> bool,
//     create({kind, prompt, image}, ctx) -> {remote_id, ...extra kept on the task},
//     poll(task, ctx) -> {status: queued|running|succeeded|failed, progress: 0-100|null, outputs: [{type, format, url|local}], error} }
// To add one: write providers/<id>.mjs and add it to PROVIDERS below. API keys come from the server's environment only;
// they are never sent to the browser, written to disk or logged.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import meshy from './meshy.mjs';
import tripo from './tripo.mjs';
import runway from './runway.mjs';
import higgsfield from './higgsfield.mjs';
import mock from './mock.mjs';

export const PROVIDERS = [meshy, tripo, higgsfield, runway, mock];
export const KIND_LABELS = { 'text-to-3d': 'Text → 3D mesh', 'image-to-3d': 'Image → 3D mesh', 'image-to-video': 'Image → video' };
export const getProvider = (id) => PROVIDERS.find((p) => p.id === id) || null;

// Browser-safe description: env var NAMES only, never values.
export function listProviders(env = process.env) {
  return PROVIDERS.map((p) => ({
    id: p.id, name: p.name, category: p.category, kinds: p.kinds, kind_labels: p.kinds.map((k) => KIND_LABELS[k] || k),
    env: p.env, configured: !!p.configured(env), docs: p.docs, verification: p.verification, verification_note: p.verification_note,
    feeds: p.feeds, concept_mockup: !!p.concept_mockup,
  }));
}

const TERMINAL = new Set(['succeeded', 'failed']);
const POLL_MIN_MS = 2000;
const MAX_TASKS = 200;

export class TaskStore {
  constructor(file, { env = process.env, fetchImpl, onEvent = () => {} } = {}) {
    this.file = file; this.env = env; this.fetchImpl = fetchImpl; this.onEvent = onEvent;
    this.tasks = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const t of saved.tasks || []) this.tasks.set(t.id, t);
    } catch { /* first run */ }
  }

  list() { return [...this.tasks.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(publicTask); }
  get(id) { const t = this.tasks.get(id); return t ? publicTask(t) : null; }
  raw(id) { return this.tasks.get(id) || null; }

  async save() {
    const tasks = [...this.tasks.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, MAX_TASKS);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp.${process.pid}.${Date.now()}`;
    await fsp.writeFile(tmp, JSON.stringify({ schema: 'fabled.provider_tasks/0.1', tasks }, null, 2));
    await fsp.rename(tmp, this.file);
  }

  async create(providerId, { kind, prompt = '', image = null, image_label = null, source_asset_id = null } = {}) {
    const p = getProvider(providerId);
    if (!p) throw new Error(`unknown provider: ${providerId}`);
    if (!p.configured(this.env)) throw new Error(`${p.name} is not configured: set ${p.env.join(' / ')} in the server environment`);
    if (!p.kinds.includes(kind)) throw new Error(`${p.name} does not support ${kind} (supports ${p.kinds.join(', ')})`);
    const cleanPrompt = String(prompt || '').slice(0, 2000);
    const extra = await p.create({ kind, prompt: cleanPrompt, image }, { env: this.env, fetchImpl: this.fetchImpl });
    const now = new Date().toISOString();
    const task = {
      id: `gen-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      provider: p.id, provider_name: p.name, kind, prompt: cleanPrompt, image_label: image_label || (image ? 'image' : null),
      source_asset_id, status: 'queued', progress: 0, outputs: [], error: null, created_at: now, updated_at: now,
      concept_mockup: !!p.concept_mockup, imported_job_id: null, ...extra, // the image itself is never stored
    };
    this.tasks.set(task.id, task);
    await this.save();
    this.onEvent({ type: 'generation_started', asset_id: `gen:${task.id}`, message: `${p.name}: ${KIND_LABELS[kind]} started${cleanPrompt ? ` ("${cleanPrompt.slice(0, 80)}")` : ''}`, concept_mockup: task.concept_mockup });
    return publicTask(task);
  }

  // Polls the provider unless the task is finished or was polled < 2 s ago. Network errors are recorded, not thrown,
  // so one flaky poll does not fail the task.
  async refresh(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (TERMINAL.has(t.status) || (t._polled_at && Date.now() - t._polled_at < POLL_MIN_MS)) return publicTask(t);
    const p = getProvider(t.provider);
    t._polled_at = Date.now();
    if (!p || !p.configured(this.env)) { t.poll_error = 'provider no longer configured on this server'; return publicTask(t); }
    try {
      const r = await p.poll(t, { env: this.env, fetchImpl: this.fetchImpl });
      const before = t.status;
      Object.assign(t, { status: r.status, progress: r.progress ?? t.progress, outputs: r.outputs || [], error: r.error || null, poll_error: null, updated_at: new Date().toISOString() });
      if (t.status !== before && TERMINAL.has(t.status)) {
        this.onEvent({ type: t.status === 'succeeded' ? 'generation_succeeded' : 'generation_failed', asset_id: `gen:${t.id}`,
          message: `${t.provider_name}: ${KIND_LABELS[t.kind]} ${t.status}${t.error ? ` (${t.error})` : ''}`, concept_mockup: t.concept_mockup });
        await this.save();
      }
    } catch (e) {
      t.poll_error = String(e.message || e);
    }
    return publicTask(t);
  }

  async markImported(id, jobId) {
    const t = this.tasks.get(id); if (!t) return;
    t.imported_job_id = jobId; t.updated_at = new Date().toISOString(); await this.save();
  }
}

function publicTask(t) {
  const { _polled_at, started_ms, status_url, mock_model, ...rest } = t; // internal bookkeeping stays server-side
  return rest;
}

// Download a finished task's model into destDir. Local outputs (mock) may only come from allowed folders.
// Remote outputs must be https and are size-capped.
export async function downloadModel(task, destDir, { localRoots = [], fetchImpl = globalThis.fetch, maxBytes = 300 * 1024 * 1024 } = {}) {
  const out = (task.outputs || []).find((o) => o.type === 'model');
  if (!out) throw new Error('this generation has no 3D model output');
  const fmt = String(out.format || 'glb').toLowerCase().replace(/[^a-z0-9]/g, '') || 'glb';
  const stem = out.local ? `_${path.basename(out.local, path.extname(out.local))}` : '';
  const base = `${task.provider}${stem}_${task.id.slice(-6)}`;
  const dest = path.join(destDir, `${base}.${fmt}`);
  if (out.local) {
    const src = localRoots.map((r) => path.resolve(r, '..', out.local)).find((p) => localRoots.some((r) => p.startsWith(r + path.sep)) && fs.existsSync(p));
    if (!src) throw new Error('local output is not inside an allowed folder');
    await fsp.copyFile(src, dest);
    return dest;
  }
  const url = new URL(out.url);
  if (url.protocol !== 'https:') throw new Error('refusing a non-https model URL');
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`model download answered HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error(`model is ${len} bytes, over the ${maxBytes} byte cap`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`model is over the ${maxBytes} byte cap`);
  await fsp.writeFile(dest, buf);
  return dest;
}
