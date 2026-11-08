#!/usr/bin/env node
// Fabled industry demos: one zero-dependency Node server for two workspaces.
//   /film/  Fabled Shots  — screenplay → shot list → storyboard/animatic → Higgsfield clips → Unreal Sequencer plan
//   /game/  Fabled Forge  — pitch → asset kit (task board) → generate (Meshy/Tripo/mock) → layout → Unreal blockout plan
// State lives in work/<film|game>/<project>.json (gitignored). API keys come from the environment only and are never
// sent to the browser (see ../ui/PROVIDERS.md). Anything mocked is labeled concept_mockup: true.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { breakdown, shotlistCsv, sequencerPlan, promptFor, SHOTLIST_SCHEMA } from './film/breakdown.mjs';
import { buildKit, starterLayout, place, blockoutPlan, summarize, nextStatus, STATUS_FLOW, LAYOUT_SCHEMA } from './game/kit.mjs';
import { listProviders, getProvider, TaskStore, KIND_LABELS } from '../ui/providers/index.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, 'public');
const WORK = process.env.FABLED_DEMOS_WORK || path.join(DIR, 'work');
const PORT = Number(process.env.PORT || 5181);
const HOST = process.env.HOST || '127.0.0.1';
const UI_URL = process.env.FABLED_UI_URL || 'http://127.0.0.1:5178';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.fountain': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary' };

const events = [];
const pushEvent = (e) => { events.push({ id: events.length + 1, at: new Date().toISOString(), ...e }); if (events.length > 500) events.shift(); };
const tasks = new TaskStore(path.join(WORK, 'provider_tasks.json'), { onEvent: pushEvent });

const send = (res, code, body, headers = {}) => { const s = JSON.stringify(body); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store', ...headers }); res.end(s); };
const text = (res, code, body, type, name) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(name ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) }); res.end(body); };
const readBody = (req, limit = 16 * 1024 * 1024) => new Promise((resolve, reject) => { const chunks = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });
const readJson = async (req, limit) => { const raw = (await readBody(req, limit)).toString('utf8'); return raw ? JSON.parse(raw) : {}; };
const newId = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
const safeId = (id) => /^[a-z0-9_-]{1,64}$/i.test(String(id));

// ---- tiny JSON project store ------------------------------------------------------------------------------------
class Store {
  constructor(kind) { this.dir = path.join(WORK, kind); fs.mkdirSync(this.dir, { recursive: true }); }
  file(id) { return path.join(this.dir, `${id}.json`); }
  list() { return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => { try { const p = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); return { id: p.id, title: p.title, updated_at: p.updated_at, created_at: p.created_at, summary: p.summary || null }; } catch { return null; } }).filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))); }
  get(id) { if (!safeId(id)) return null; try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch { return null; } }
  async put(p) { p.updated_at = new Date().toISOString(); p.rev = (p.rev || 0) + 1; const tmp = `${this.file(p.id)}.tmp`; await fsp.writeFile(tmp, JSON.stringify(p, null, 2)); await fsp.rename(tmp, this.file(p.id)); return p; }
  async remove(id) { if (safeId(id)) await fsp.rm(this.file(id), { force: true }); }
}
const films = new Store('film');
const games = new Store('game');

// ---- film ---------------------------------------------------------------------------------------------------------
async function filmApi(req, res, parts, url) {
  // GET /api/film/projects | POST /api/film/projects {title, text}
  if (parts.length === 3 && parts[2] === 'projects') {
    if (req.method === 'GET') return send(res, 200, { ok: true, projects: films.list() });
    if (req.method === 'POST') {
      const body = await readJson(req, 2 * 1024 * 1024);
      if (!body.text || typeof body.text !== 'string') return send(res, 400, { ok: false, error: 'body must be JSON {title?, text}' });
      const bd = breakdown(body.text, { title: String(body.title || 'Untitled').slice(0, 120) });
      const p = { id: newId('film'), ...bd, script_text: body.text.slice(0, 2_000_000), roles: ['director', 'dp', 'previs artist', 'producer'], activity: [], summary: { scenes: bd.scenes.length, shots: bd.shots.length, duration_s: bd.total_duration_s } };
      for (const s of p.shots) Object.assign(s, { comments: [], frame: null, clip: null, assignee: 'previs artist' });
      p.activity.push({ at: new Date().toISOString(), who: 'system', what: `Breakdown: ${bd.scenes.length} scenes, ${bd.shots.length} proposed shots, ~${bd.total_duration_s}s animatic (rule-based estimate)` });
      await films.put(p);
      return send(res, 201, { ok: true, project: p });
    }
  }
  const p = films.get(parts[3]);
  if (!p) return send(res, 404, { ok: false, error: 'project not found' });
  const sub = parts[4];
  if (req.method === 'GET' && !sub) return send(res, 200, { ok: true, project: p });
  if (req.method === 'DELETE' && !sub) { await films.remove(p.id); return send(res, 200, { ok: true }); }
  // exports
  if (req.method === 'GET' && sub === 'export') {
    const fmt = parts[5];
    const base = p.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const clean = { ...p }; delete clean.script_text; delete clean.activity;
    if (fmt === 'shotlist.json') return text(res, 200, JSON.stringify({ ...clean, schema: SHOTLIST_SCHEMA }, null, 2), MIME['.json'], `${base}_shotlist.json`);
    if (fmt === 'shotlist.csv') return text(res, 200, shotlistCsv(p), MIME['.csv'], `${base}_shotlist.csv`);
    if (fmt === 'sequencer_plan.json') return text(res, 200, JSON.stringify(sequencerPlan(p), null, 2), MIME['.json'], `${base}_sequencer_plan.json`);
    if (fmt === 'unreal.py') return text(res, 200, await fsp.readFile(path.join(DIR, 'unreal', 'build_sequence_from_shotlist.py'), 'utf8'), MIME['.py'], 'build_sequence_from_shotlist.py');
    return send(res, 404, { ok: false, error: 'unknown export' });
  }
  // PATCH /api/film/projects/:id/shots/:shotId {size?, move?, lens_mm?, duration_s?, description?, status?, assignee?, prompt?}
  if (sub === 'shots' && parts[5]) {
    const shot = p.shots.find((s) => s.id === parts[5]);
    if (!shot) return send(res, 404, { ok: false, error: 'shot not found' });
    const who = String(url.searchParams.get('as') || 'director').slice(0, 40);
    if (req.method === 'PATCH') {
      const body = await readJson(req, 64 * 1024);
      const allowed = ['size', 'move', 'lens_mm', 'duration_s', 'description', 'status', 'assignee', 'prompt', 'subject'];
      const changed = [];
      for (const k of allowed) if (body[k] !== undefined) { shot[k] = k === 'lens_mm' || k === 'duration_s' ? Math.max(0.1, Number(body[k]) || shot[k]) : String(body[k]).slice(0, 2000); changed.push(k); }
      if (changed.length && !changed.includes('prompt')) shot.prompt = promptFor(shot);
      if (body.status) p.activity.push({ at: new Date().toISOString(), who, what: `${shot.id} marked ${body.status}` });
      p.total_duration_s = Math.round(p.shots.reduce((a, s) => a + s.duration_s, 0) * 10) / 10;
      p.summary = { scenes: p.scenes.length, shots: p.shots.length, duration_s: p.total_duration_s };
      await films.put(p);
      return send(res, 200, { ok: true, shot, project: p });
    }
    if (req.method === 'POST' && parts[6] === 'comments') {
      const body = await readJson(req, 64 * 1024);
      if (!body.text) return send(res, 400, { ok: false, error: 'comment needs text' });
      const c = { id: newId('c'), at: new Date().toISOString(), who, text: String(body.text).slice(0, 2000) };
      shot.comments.push(c); p.activity.push({ at: c.at, who, what: `commented on ${shot.id}: ${c.text.slice(0, 80)}` });
      await films.put(p);
      return send(res, 201, { ok: true, comment: c, project: p });
    }
    // POST /api/film/projects/:id/shots/:shotId/frame {data_uri} — attach a still (uploaded or drawn) to the shot
    if (req.method === 'POST' && parts[6] === 'frame') {
      const body = await readJson(req, 12 * 1024 * 1024);
      if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(body.data_uri || '')) return send(res, 400, { ok: false, error: 'frame must be a PNG/JPEG/WebP/SVG data URI' });
      shot.frame = { data_uri: body.data_uri, label: String(body.label || 'uploaded still').slice(0, 80), at: new Date().toISOString(), concept_mockup: !!body.concept_mockup };
      p.activity.push({ at: shot.frame.at, who, what: `attached a frame to ${shot.id} (${shot.frame.label})` });
      await films.put(p);
      return send(res, 201, { ok: true, shot, project: p });
    }
    // POST /api/film/projects/:id/shots/:shotId/clip {provider} — image→video from the shot's frame through a provider plugin
    if (req.method === 'POST' && parts[6] === 'clip') {
      const body = await readJson(req, 64 * 1024);
      const providerId = String(body.provider || 'higgsfield');
      const prov = getProvider(providerId);
      if (!prov) return send(res, 404, { ok: false, error: 'unknown provider' });
      if (!prov.kinds.includes('image-to-video')) return send(res, 400, { ok: false, error: `${prov.name} does not do image→video` });
      if (!prov.configured(process.env)) return send(res, 409, { ok: false, error: `${prov.name} is not configured on this server (set ${prov.env.join(' / ')})`, env: prov.env });
      if (!shot.frame) return send(res, 400, { ok: false, error: 'attach a frame to the shot first (image→video needs a still)' });
      try {
        const task = await tasks.create(providerId, { kind: 'image-to-video', prompt: shot.prompt, image: { data_uri: shot.frame.data_uri }, image_label: `${p.title} ${shot.id}` });
        shot.clip = { task_id: task.id, provider: task.provider_name, status: task.status, url: null, concept_mockup: task.concept_mockup };
        p.activity.push({ at: new Date().toISOString(), who, what: `${prov.name}: image→video started for ${shot.id}` });
        await films.put(p);
        return send(res, 202, { ok: true, task, shot, project: p });
      } catch (e) { return send(res, 502, { ok: false, error: String(e.message || e) }); }
    }
  }
  // GET /api/film/projects/:id/clips -> refresh provider tasks referenced by shots
  if (req.method === 'GET' && sub === 'clips') {
    let dirty = false;
    for (const s of p.shots) if (s.clip?.task_id && !['succeeded', 'failed'].includes(s.clip.status)) {
      const t = await tasks.refresh(s.clip.task_id);
      if (t && t.status !== s.clip.status) { s.clip.status = t.status; s.clip.url = (t.outputs || []).find((o) => o.type === 'video')?.url || null; s.clip.error = t.error || null; dirty = true; }
    }
    if (dirty) await films.put(p);
    return send(res, 200, { ok: true, project: p });
  }
  return send(res, 404, { ok: false, error: 'not found' });
}

// ---- game ---------------------------------------------------------------------------------------------------------
async function gameApi(req, res, parts, url) {
  if (parts.length === 3 && parts[2] === 'projects') {
    if (req.method === 'GET') return send(res, 200, { ok: true, projects: games.list() });
    if (req.method === 'POST') {
      const body = await readJson(req, 1024 * 1024);
      if (!body.text || typeof body.text !== 'string') return send(res, 400, { ok: false, error: 'body must be JSON {title?, text}' });
      const kit = buildKit(body.text, { title: body.title ? String(body.title).slice(0, 120) : null });
      const p = { id: newId('game'), ...kit, pitch_text: body.text.slice(0, 200_000), roles: ['designer', 'character artist', 'environment artist', 'vendor', 'tech art director'], activity: [], layout: null };
      p.layout = starterLayout(p);
      p.activity.push({ at: new Date().toISOString(), who: 'system', what: `Kit: ${kit.assets.length} assets (${Object.entries(kit.summary.by_category).map(([k, v]) => `${v} ${k}`).join(', ')}) with placeholder import profiles; starter layout with ${p.layout.items.length} placements` });
      await games.put(p);
      return send(res, 201, { ok: true, project: p });
    }
  }
  const p = games.get(parts[3]);
  if (!p) return send(res, 404, { ok: false, error: 'project not found' });
  const sub = parts[4];
  const who = String(url.searchParams.get('as') || 'designer').slice(0, 40);
  if (req.method === 'GET' && !sub) return send(res, 200, { ok: true, project: p });
  if (req.method === 'DELETE' && !sub) { await games.remove(p.id); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && sub === 'export') {
    const fmt = parts[5];
    const base = p.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const clean = { ...p }; delete clean.pitch_text; delete clean.activity;
    if (fmt === 'kit.json') return text(res, 200, JSON.stringify(clean, null, 2), MIME['.json'], `${base}_kit.json`);
    if (fmt === 'layout.json') return text(res, 200, JSON.stringify(p.layout, null, 2), MIME['.json'], `${base}_layout.json`);
    if (fmt === 'blockout_plan.json') return text(res, 200, JSON.stringify(blockoutPlan(p, p.layout), null, 2), MIME['.json'], `${base}_blockout_plan.json`);
    if (fmt === 'import_profiles.json') return text(res, 200, JSON.stringify({ schema: 'fabled.import_profiles/0.1', note: p.budget_note, profiles: p.assets.map((a) => ({ asset: a.asset_name, profile: a.import_profile, ...a.budget })) }, null, 2), MIME['.json'], `${base}_import_profiles.json`);
    if (fmt === 'unreal.py') return text(res, 200, await fsp.readFile(path.join(DIR, 'unreal', 'blockout_from_layout.py'), 'utf8'), MIME['.py'], 'blockout_from_layout.py');
    return send(res, 404, { ok: false, error: 'unknown export' });
  }
  if (sub === 'assets' && parts[5]) {
    const a = p.assets.find((x) => x.id === parts[5]);
    if (!a) return send(res, 404, { ok: false, error: 'asset not found' });
    if (req.method === 'PATCH') {
      const body = await readJson(req, 64 * 1024);
      if (body.status !== undefined) { if (!STATUS_FLOW.includes(body.status)) return send(res, 400, { ok: false, error: `status must be one of ${STATUS_FLOW.join(', ')}` }); a.status = body.status; }
      if (body.advance) a.status = nextStatus(a.status);
      for (const k of ['assignee', 'name', 'import_profile']) if (body[k] !== undefined) a[k] = String(body[k]).slice(0, 120);
      if (body.category && p.assets && Object.keys(summarize([])).length >= 0 && ['character', 'creature', 'prop', 'environment', 'vehicle'].includes(body.category)) a.category = body.category;
      p.summary = summarize(p.assets);
      p.activity.push({ at: new Date().toISOString(), who, what: `${a.asset_name}: ${body.status || (body.advance ? a.status : 'updated')}` });
      await games.put(p);
      return send(res, 200, { ok: true, asset: a, project: p });
    }
    if (req.method === 'POST' && parts[6] === 'comments') {
      const body = await readJson(req, 64 * 1024);
      if (!body.text) return send(res, 400, { ok: false, error: 'comment needs text' });
      const c = { id: newId('c'), at: new Date().toISOString(), who, text: String(body.text).slice(0, 2000) };
      a.comments.push(c); p.activity.push({ at: c.at, who, what: `commented on ${a.asset_name}: ${c.text.slice(0, 80)}` });
      await games.put(p);
      return send(res, 201, { ok: true, comment: c, project: p });
    }
    // POST .../assets/:id/generate {provider, prompt?} — text→3D through a provider plugin (mock offline, Meshy/Tripo with keys)
    if (req.method === 'POST' && parts[6] === 'generate') {
      const body = await readJson(req, 64 * 1024);
      const providerId = String(body.provider || 'mock');
      const prov = getProvider(providerId);
      if (!prov) return send(res, 404, { ok: false, error: 'unknown provider' });
      if (!prov.kinds.includes('text-to-3d')) return send(res, 400, { ok: false, error: `${prov.name} does not do text→3D` });
      if (!prov.configured(process.env)) return send(res, 409, { ok: false, error: `${prov.name} is not configured on this server (set ${prov.env.join(' / ')})`, env: prov.env });
      const prompt = String(body.prompt || `${a.name}, ${p.style.toLowerCase()} game asset, ${a.category}, clean silhouette, single object, neutral pose`).slice(0, 2000);
      try {
        const task = await tasks.create(providerId, { kind: 'text-to-3d', prompt, source_asset_id: a.id });
        a.generation = { task_id: task.id, provider: task.provider_name, status: task.status, progress: 0, outputs: [], concept_mockup: task.concept_mockup, prompt };
        a.status = 'generating'; p.summary = summarize(p.assets);
        p.activity.push({ at: new Date().toISOString(), who, what: `${prov.name}: text→3D started for ${a.asset_name}` });
        await games.put(p);
        return send(res, 202, { ok: true, task, asset: a, project: p });
      } catch (e) { return send(res, 502, { ok: false, error: String(e.message || e) }); }
    }
  }
  if (req.method === 'GET' && sub === 'generations') {
    let dirty = false;
    for (const a of p.assets) if (a.generation?.task_id && !['succeeded', 'failed'].includes(a.generation.status)) {
      const t = await tasks.refresh(a.generation.task_id);
      if (t && (t.status !== a.generation.status || t.progress !== a.generation.progress)) {
        Object.assign(a.generation, { status: t.status, progress: t.progress, outputs: t.outputs || [], error: t.error || null });
        if (t.status === 'succeeded' && a.status === 'generating') a.status = 'generated';
        if (t.status === 'failed' && a.status === 'generating') a.status = 'requested';
        dirty = true;
      }
    }
    if (dirty) { p.summary = summarize(p.assets); await games.put(p); }
    return send(res, 200, { ok: true, project: p });
  }
  // layout: PUT replaces items; POST adds a placement
  if (sub === 'layout') {
    if (req.method === 'PUT') {
      const body = await readJson(req, 4 * 1024 * 1024);
      if (!Array.isArray(body.items)) return send(res, 400, { ok: false, error: 'layout needs items[]' });
      const ids = new Set(p.assets.map((a) => a.id));
      p.layout = { ...p.layout, schema: LAYOUT_SCHEMA, items: body.items.filter((it) => ids.has(it.asset_id)).slice(0, 2000).map((it) => ({ ...it, x: Math.round(Number(it.x) || 0), y: Math.round(Number(it.y) || 0), z: Math.round(Number(it.z) || 0), yaw: Math.round(Number(it.yaw) || 0), scale: Math.max(0.1, Math.min(10, Number(it.scale) || 1)) })), spawn: body.spawn || p.layout.spawn, updated_at: new Date().toISOString() };
      await games.put(p);
      return send(res, 200, { ok: true, layout: p.layout, project: p });
    }
    if (req.method === 'POST') {
      const body = await readJson(req, 64 * 1024);
      const a = p.assets.find((x) => x.id === body.asset_id);
      if (!a) return send(res, 404, { ok: false, error: 'asset not found' });
      const it = place(a, Number(body.x) || 0, Number(body.y) || 0, Number(body.yaw) || 0, Number(body.scale) || 1);
      p.layout.items.push(it); p.layout.updated_at = new Date().toISOString();
      await games.put(p);
      return send(res, 201, { ok: true, item: it, project: p });
    }
  }
  return send(res, 404, { ok: false, error: 'not found' });
}

// ---- shared -------------------------------------------------------------------------------------------------------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'film', 'projects', ...]
  if (parts[1] === 'status') return send(res, 200, { ok: true, service: 'fabled-demos', version: '0.1', providers: listProviders(), kinds: KIND_LABELS, studio_url: UI_URL, demos: { film: '/film/', game: '/game/' }, work_dir: path.relative(DIR, WORK) });
  if (parts[1] === 'events') { const since = Number(url.searchParams.get('since') || 0); return send(res, 200, { ok: true, events: events.filter((e) => e.id > since) }); }
  if (parts[1] === 'samples' && parts[2]) {
    const f = path.join(DIR, 'samples', path.basename(parts[2]));
    if (!fs.existsSync(f)) return send(res, 404, { ok: false, error: 'no such sample' });
    return text(res, 200, await fsp.readFile(f), MIME[path.extname(f)] || 'application/octet-stream');
  }
  // GET /api/mock-models/<file>.glb — the offline mock provider's procedural models (CONCEPT MOCKUP, self-made)
  if (parts[1] === 'mock-models' && parts[2]) {
    const f = path.join(DIR, '..', 'ui', 'samples', 'mock_generations', path.basename(parts[2]));
    if (!f.endsWith('.glb') || !fs.existsSync(f)) return send(res, 404, { ok: false, error: 'no such model' });
    return text(res, 200, await fsp.readFile(f), MIME['.glb'], path.basename(f));
  }
  if (parts[1] === 'film') return filmApi(req, res, parts, url);
  if (parts[1] === 'game') return gameApi(req, res, parts, url);
  return send(res, 404, { ok: false, error: 'not found' });
}

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) { res.writeHead(403); return res.end('forbidden'); }
  // fonts are shared with the studio UI
  const candidates = [file, rel.startsWith('/fonts/') ? path.join(DIR, '..', 'ui', 'public', rel) : null].filter(Boolean);
  for (const f of candidates) {
    try { const st = await fsp.stat(f); if (st.isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' }); return fs.createReadStream(f).pipe(res); } } catch { /* next */ }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/film' || url.pathname === '/game') { res.writeHead(302, { Location: `${url.pathname}/` }); return res.end(); }
    return await serveStatic(res, url.pathname);
  } catch (e) {
    if (res.headersSent) return res.end();
    return send(res, e instanceof SyntaxError ? 400 : 500, { ok: false, error: String(e.message || e) });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  server.listen(PORT, HOST, () => {
    const prov = listProviders().filter((p) => p.configured).map((p) => p.name).join(', ') || 'none';
    console.log(`Fabled demos  http://${HOST}:${PORT}/   film → /film/   game → /game/   providers configured: ${prov}   work: ${WORK}`);
  });
}
