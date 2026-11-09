#!/usr/bin/env node
// Fabled industry demos: one zero-dependency Node server for two workspaces.
//   /film/  Fabled Shots  — screenplay → shot list → storyboard/animatic → Higgsfield clips → Unreal Sequencer plan
//   /game/  Fabled Forge  — pitch → asset kit (task board) → generate (Meshy/Tripo/mock) → layout → Unreal blockout plan
// State lives in work/<film|game>/<project>.json (gitignored); shot stills live next to it as
// work/film/<project>/frames/<shot>.<png|jpg|webp>. API keys come from the environment only and are never sent to the
// browser (see ../ui/PROVIDERS.md). Anything mocked is labeled concept_mockup: true.
//
// Collaboration contract (what a client can rely on):
//   * Every mutation of a project runs inside a per-project critical section, on a copy re-read from disk after the
//     request body has been parsed. Concurrent requests on one project are applied one after another; none is lost.
//   * `project.rev` goes up by one for every change a collaborator would care about (edits, comments, frames, status
//     transitions of generations, outputs, errors). Send `If-Match: <rev>` on a mutating request to make it conditional:
//     if the stored rev differs the server answers 409 {ok:false, code:"rev_conflict", error, rev, project} and changes
//     nothing. Requests without If-Match are applied to the latest state.
//   * Provider progress ticks are persisted WITHOUT a rev bump. They only move `project.progress_rev` and the
//     `progress` fields themselves. Poll GET .../generations?rev=<rev you hold> (game) or .../clips?rev=<rev> (film):
//       rev matches → {ok:true, unchanged:true, rev, progress_rev, progress:[{id, status, progress}]}  (patch the
//                     progress bars in place; `id` is the asset id / shot id)
//       rev differs → {ok:true, project, rev, progress_rev, progress:[…]}                              (replace the project)
//   * /api/* refuses cross-site callers: a foreign Origin or an unexpected Host header is a 403, and POST/PUT/PATCH
//     must be Content-Type: application/json (415). The server never sends Access-Control-Allow-* headers.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// Namespace imports on purpose: optional engine exports (vocabularies, helpers) fall back to local copies below, so
// the server still starts against an older engine module.
import * as film from './film/breakdown.mjs';
import * as kitlib from './game/kit.mjs';
import { listProviders, getProvider, TaskStore, KIND_LABELS } from '../ui/providers/index.mjs';

const { breakdown, shotlistCsv, sequencerPlan, promptFor, SHOTLIST_SCHEMA } = film;
const { buildKit, starterLayout, place, blockoutPlan, summarize, nextStatus, STATUS_FLOW, LAYOUT_SCHEMA } = kitlib;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, 'public');
const WORK = process.env.FABLED_DEMOS_WORK || path.join(DIR, 'work');
const PORT = Number(process.env.PORT || 5181);
const HOST = process.env.HOST || '127.0.0.1';
const UI_URL = process.env.FABLED_UI_URL || 'http://127.0.0.1:5178';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.fountain': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary' };

// ---- limits -------------------------------------------------------------------------------------------------------
const MAX_ACTIVITY = 300;                    // newest entries kept per project
const MAX_COMMENTS = 200;                    // per shot / per asset
const MAX_LAYOUT_ITEMS = 2000;
const MAX_FRAME_BYTES = 10 * 1024 * 1024;    // decoded still
const FRAME_BODY_LIMIT = Math.ceil(MAX_FRAME_BYTES / 3) * 4 + 64 * 1024; // base64 of the above plus JSON envelope
const SMALL_BODY = 64 * 1024;
const TERMINAL = new Set(['succeeded', 'failed']);

// ---- vocabularies (engine exports when present, local fallbacks otherwise) -----------------------------------------
const strList = (v) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? v : null);
const SHOT_STATUSES = strList(film.SHOT_STATUSES) || ['proposed', 'approved', 'redo'];
const SHOT_SIZES = strList(film.SHOT_SIZES) || ['Extreme wide', 'Wide', 'Medium wide', 'Medium', 'Medium (over-the-shoulder)', 'Close-up', 'Insert'];
const MOVE_PRESETS = film.MOVE_PRESETS && typeof film.MOVE_PRESETS === 'object' && strList(Object.values(film.MOVE_PRESETS))
  ? film.MOVE_PRESETS
  : { static: 'Static (locked off)', push_in: 'Slow push-in', dolly_follow: 'Dolly follow', tracking_handheld: 'Tracking (handheld)', crane_down: 'Crane down', aerial_drift: 'Aerial drift', orbit_handheld: 'Handheld orbit', crash_zoom: 'Crash zoom' };
const SHOT_MOVES = Object.values(MOVE_PRESETS);
const presetForMove = (move) => {
  let id = null;
  if (typeof film.presetForMove === 'function') { try { id = film.presetForMove(move); } catch { id = null; } }
  if (typeof id !== 'string' || !Object.hasOwn(MOVE_PRESETS, id)) id = Object.keys(MOVE_PRESETS).find((k) => MOVE_PRESETS[k] === move) || null;
  return id;
};
const FILM_ROLES = ['director', 'dp', 'previs artist', 'producer'];
const GAME_ROLES = ['designer', 'character artist', 'environment artist', 'vendor', 'tech art director'];
const CATEGORY_DEFAULTS = kitlib.CATEGORY_DEFAULTS && typeof kitlib.CATEGORY_DEFAULTS === 'object' ? kitlib.CATEGORY_DEFAULTS : {};
const CATEGORIES = strList(kitlib.CATEGORIES) || Object.keys(CATEGORY_DEFAULTS);
const IMPORT_PROFILES = [...new Set(Object.values(CATEGORY_DEFAULTS).map((d) => d?.profile).filter((x) => typeof x === 'string'))];
const ASSET_STATUSES = strList(STATUS_FLOW) || ['requested', 'generating', 'generated', 'in_pipeline', 'validated', 'imported'];

// ---- small helpers ------------------------------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (message, extra) => new HttpError(400, message, extra);

let eventSeq = 0; // ids keep counting after the buffer wraps, so `?since=` stays monotonic
const events = [];
const pushEvent = (e) => { events.push({ id: ++eventSeq, at: new Date().toISOString(), ...e }); if (events.length > 500) events.shift(); };
const tasks = new TaskStore(path.join(WORK, 'provider_tasks.json'), { onEvent: pushEvent });

const send = (res, code, body, headers = {}) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store', ...headers });
  res.end(s);
};
const text = (res, code, body, type, name, headers = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...(name ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}), ...headers });
  res.end(body);
};
const methodNotAllowed = (res, allow) => send(res, 405, { ok: false, error: `method not allowed (use ${allow})` }, { Allow: allow });

// Reads the body up to `limit` bytes. Over the limit the promise rejects with 413 at once; the rest of the upload is
// discarded (not buffered) so the client can still read the answer, and a runaway upload is cut off.
const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
  const tooLarge = () => new HttpError(413, `request body is larger than ${limit} bytes`);
  if (Number(req.headers['content-length']) > limit) return reject(tooLarge());
  const chunks = []; let n = 0; let over = false;
  req.on('data', (c) => {
    n += c.length;
    if (over) { if (n > limit + 64 * 1024 * 1024) req.destroy(); return; }
    if (n > limit) { over = true; chunks.length = 0; reject(tooLarge()); return; }
    chunks.push(c);
  });
  req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
  req.on('error', () => reject(bad('request body could not be read')));
  req.on('close', () => reject(bad('request was closed before the body arrived')));
});
// JSON object bodies only: `null`, arrays and scalars are a 400, not a TypeError further down.
const readJson = async (req, limit) => {
  const raw = (await readBody(req, limit)).toString('utf8');
  if (!raw.trim()) return {};
  let v; try { v = JSON.parse(raw); } catch { throw bad('body is not valid JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('body must be a JSON object');
  return v;
};
const newId = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
const safeId = (id) => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(id);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const COORD_LIMIT = Number.isFinite(kitlib.LAYOUT_LIMIT_CM) && kitlib.LAYOUT_LIMIT_CM > 0 ? kitlib.LAYOUT_LIMIT_CM : 100000; // cm, ±1 km
const yawDeg = (n) => (((Math.round(n) % 360) + 360) % 360) + 0;
const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const numberIn = (v, name, lo, hi) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  return Math.min(hi, Math.max(lo, n));
};

// Free text from clients is stored as text and rendered by the browser apps; control characters (C0/C1, line and
// paragraph separators, bidi overrides) never belong in it. Multi-line fields keep "\n"; single-line fields do not.
const CTRL_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028-\u202E\u2066-\u2069]/g;
const CTRL_ALL = /[\u0000-\u001F\u007F-\u009F\u2028-\u202E\u2066-\u2069]/g;
const cleanText = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CTRL_MULTI, '').slice(0, max).trim();
const cleanLine = (v, max) => String(v ?? '').replace(CTRL_ALL, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
const textField = (v, name, max, { multi = true } = {}) => {
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  return multi ? cleanText(v, max) : cleanLine(v, max);
};
const httpUrl = (u) => { try { return ['https:', 'http:'].includes(new URL(u).protocol) ? String(u).slice(0, 2000) : null; } catch { return null; } };
const fileBase = (title) => String(title || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 80) || 'project';

// `?as=<role>` is shown next to comments and in the activity log, so it must be one of the project's roles.
const rolesOf = (p, defaults) => (Array.isArray(p.roles) && p.roles.length && p.roles.every((r) => typeof r === 'string') ? p.roles : defaults);
const matchRole = (value, roles) => { const v = String(value ?? '').trim().toLowerCase(); return roles.find((r) => r.toLowerCase() === v) || null; };
const whoFrom = (url, roles, dflt) => matchRole(url.searchParams.get('as'), roles) || (roles.includes(dflt) ? dflt : roles[0]);
const logActivity = (p, who, what) => {
  if (!Array.isArray(p.activity)) p.activity = [];
  p.activity.push({ at: new Date().toISOString(), who, what: cleanLine(what, 300) });
  if (p.activity.length > MAX_ACTIVITY) p.activity.splice(0, p.activity.length - MAX_ACTIVITY);
};

// ---- per-project critical sections ---------------------------------------------------------------------------------
// A promise chain per key: each caller runs after the previous one settled, whatever its outcome.
const locks = new Map();
function withLock(key, fn) {
  const run = (locks.get(key) || Promise.resolve()).then(() => fn());
  const tail = run.then(() => {}, () => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}
// Optional optimistic check: `If-Match: 7` (also `"7"`, `W/"7"`; `*` means any).
function parseIfMatch(req) {
  const h = req.headers['if-match'];
  if (h === undefined) return null;
  const v = String(h).trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
  if (v === '*') return null;
  if (!/^\d{1,15}$/.test(v)) throw bad('If-Match must be the integer project rev');
  return Number(v);
}
const revConflict = (p, sent) => new HttpError(409, `project changed: it is at rev ${p.rev}, this request was made against rev ${sent}; reload and retry`, { code: 'rev_conflict', rev: p.rev, project: p });
// Runs `fn(project)` on a fresh copy inside the project's critical section, then persists it.
// fn may return {write:false} (nothing changed) or {write:'progress'} (persist without a rev bump).
function mutate(store, id, req, fn) {
  const ifMatch = req ? parseIfMatch(req) : null;
  return withLock(store.lockKey(id), async () => {
    const p = store.load(id);
    if (ifMatch !== null && p.rev !== ifMatch) throw revConflict(p, ifMatch);
    const r = (await fn(p)) || {};
    if (r.write === 'progress') await store.put(p, { bump: false });
    else if (r.write !== false) await store.put(p);
    return { ...r, project: p };
  });
}

// ---- tiny JSON project store --------------------------------------------------------------------------------------
class Store {
  constructor(kind, listKey, normalize) { this.kind = kind; this.listKey = listKey; this.normalize = normalize; this.dir = path.join(WORK, kind); fs.mkdirSync(this.dir, { recursive: true }); }
  lockKey(id) { return `${this.kind}:${id}`; }
  file(id) { return path.join(this.dir, `${id}.json`); }
  exists(id) { return safeId(id) && fs.existsSync(this.file(id)); }
  list() {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => {
      try { const p = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); return isObj(p) && safeId(p.id) && `${p.id}.json` === f && Array.isArray(p[this.listKey]) ? { id: p.id, title: String(p.title ?? 'Untitled'), updated_at: p.updated_at, created_at: p.created_at, rev: p.rev, summary: p.summary || null } : null; } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  // null when there is no such project; a 500 with code project_corrupt when the file exists but cannot be used
  // (DELETE still works on it). Stored data is normalized so handlers and exporters never trip over a missing field.
  get(id) {
    if (!safeId(id)) return null;
    let raw; try { raw = fs.readFileSync(this.file(id), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw new HttpError(500, 'project file could not be read', { code: 'project_unreadable' }); }
    let p; try { p = JSON.parse(raw); } catch { p = null; }
    let ok = false; try { ok = isObj(p) && p.id === id && this.normalize(p); } catch { ok = false; }
    if (!ok) throw new HttpError(500, 'project file is corrupt (not the JSON this server wrote); delete the project or restore the file', { code: 'project_corrupt' });
    return p;
  }
  load(id) { const p = this.get(id); if (!p) throw new HttpError(404, 'project not found'); return p; }
  // bump:false is for transient provider progress: rev and updated_at stay, progress_rev moves.
  async put(p, { bump = true } = {}) {
    if (bump) { p.updated_at = new Date().toISOString(); p.rev = (Number(p.rev) || 0) + 1; } else p.progress_rev = (Number(p.progress_rev) || 0) + 1;
    await writeAtomic(this.file(p.id), JSON.stringify(p, null, 2));
    return p;
  }
  async remove(id) { if (safeId(id)) await fsp.rm(this.file(id), { force: true }); }
}
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { await fsp.writeFile(tmp, data); await fsp.rename(tmp, file); } catch (e) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw e; }
}
const baseNormalize = (p, roles) => {
  p.title = cleanLine(p.title, 120) || 'Untitled';
  p.rev = Number.isFinite(Number(p.rev)) ? Number(p.rev) : 0;
  p.progress_rev = Number.isFinite(Number(p.progress_rev)) ? Number(p.progress_rev) : 0;
  if (!Array.isArray(p.activity)) p.activity = [];
  p.roles = rolesOf(p, roles);
};
function normalizeFilm(p) {
  if (!Array.isArray(p.shots)) return false;
  baseNormalize(p, FILM_ROLES);
  if (!Array.isArray(p.scenes)) p.scenes = [];
  p.shots = p.shots.filter((s) => isObj(s) && typeof s.id === 'string');
  for (const s of p.shots) {
    if (!Array.isArray(s.comments)) s.comments = [];
    if (!Number.isFinite(s.duration_s)) s.duration_s = 0;
    if (!isObj(s.frame)) s.frame = null;
    if (!isObj(s.clip)) s.clip = null;
  }
  migrateFrames(p);
  return true;
}
function normalizeGame(p) {
  if (!Array.isArray(p.assets)) return false;
  baseNormalize(p, GAME_ROLES);
  p.assets = p.assets.filter((a) => isObj(a) && typeof a.id === 'string' && typeof a.asset_name === 'string');
  for (const a of p.assets) {
    if (!Array.isArray(a.comments)) a.comments = [];
    if (!isObj(a.generation)) a.generation = null;
  }
  // The stored layout is rebuilt through the same sanitizer as a client save, so a malformed stored item (unknown
  // asset, missing footprint, non-numeric transform) can never reach the canvas or an exporter.
  if (!isObj(p.layout)) p.layout = { items: [] };
  p.layout = cleanLayout(p);
  return true;
}
const films = new Store('film', 'shots', normalizeFilm);
const games = new Store('game', 'assets', normalizeGame);

// ---- shot stills on disk -------------------------------------------------------------------------------------------
const FRAME_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const FRAME_ERROR = 'frame must be a base64 data URI of a PNG, JPEG or WebP image (SVG is not accepted: video providers reject it)';
const magicOk = (mime, b) => (mime === 'image/png' ? b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  : mime === 'image/jpeg' ? b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  : mime === 'image/webp' ? b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' : false);
// Strict: exact "data:<mime>;base64," prefix, base64 alphabet only (nothing can ride along after the payload), decoded
// size capped, and the first bytes must be the image type the prefix claims.
function parseFrameDataUri(s) {
  if (typeof s !== 'string') throw bad(FRAME_ERROR);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(s.slice(0, 32));
  if (!m) throw bad(FRAME_ERROR);
  const b64 = s.slice(m[0].length);
  if (b64.length > Math.ceil(MAX_FRAME_BYTES / 3) * 4) throw new HttpError(413, `frame image is larger than ${MAX_FRAME_BYTES} bytes`);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  if (!b64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || (pad ? b64.length % 4 !== 0 : b64.length % 4 === 1)) throw bad('frame data URI payload is not valid base64');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_FRAME_BYTES) throw new HttpError(413, `frame image is larger than ${MAX_FRAME_BYTES} bytes`);
  if (!magicOk(m[1], buf)) throw bad(`frame bytes are not a ${m[1]} image`);
  return { mime: m[1], ext: FRAME_TYPES[m[1]], buf };
}
// Paths are built only from validated ids and a fixed extension list.
const framesDir = (projectId) => { if (!safeId(projectId)) throw bad('bad project id'); return path.join(films.dir, projectId, 'frames'); };
const frameFile = (projectId, shotId, ext) => { if (!safeId(shotId) || !Object.values(FRAME_TYPES).includes(ext)) throw bad('bad shot id'); return path.join(framesDir(projectId), `${shotId}.${ext}`); };
const frameUrl = (projectId, shotId, ms) => `/api/film/projects/${projectId}/shots/${shotId}/frame?v=${ms}`;
async function removeFrameFiles(projectId, shotId, exceptExt = null) {
  for (const ext of Object.values(FRAME_TYPES)) if (ext !== exceptExt) await fsp.rm(frameFile(projectId, shotId, ext), { force: true });
}
async function writeFrameFile(projectId, shotId, img) {
  await fsp.mkdir(framesDir(projectId), { recursive: true });
  await writeAtomic(frameFile(projectId, shotId, img.ext), img.buf);
  await removeFrameFiles(projectId, shotId, img.ext);
}
// One-time tolerant read of projects written before stills moved to files: shot.frame.data_uri becomes a file plus
// the new {url, mime, bytes, …} shape; anything that does not validate (SVG, junk) is dropped. Runs on every load and
// is idempotent, so the JSON on disk is rewritten in the new shape by the first persist after it (see loadFilm).
function migrateFrames(p) {
  let changed = false;
  for (const s of p.shots) {
    if (!s.frame) continue;
    if (typeof s.frame.data_uri === 'string') {
      changed = true;
      try {
        const img = parseFrameDataUri(s.frame.data_uri);
        const file = frameFile(p.id, s.id, img.ext);
        if (!fs.existsSync(file)) { // never overwrite: a newer still may already have replaced the inline one
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
          fs.writeFileSync(tmp, img.buf); fs.renameSync(tmp, file);
        }
        const at = typeof s.frame.at === 'string' && Number.isFinite(Date.parse(s.frame.at)) ? s.frame.at : new Date().toISOString();
        s.frame = { url: frameUrl(p.id, s.id, Date.parse(at)), mime: img.mime, bytes: img.buf.length, label: cleanLine(s.frame.label, 80) || 'uploaded still', at, concept_mockup: !!s.frame.concept_mockup };
      } catch { s.frame = null; }
    } else if (!FRAME_TYPES[s.frame.mime] || !safeId(s.id)) { s.frame = null; changed = true; }
    else if (typeof s.frame.url !== 'string' || !s.frame.url.startsWith(`${frameUrl(p.id, s.id, '')}`)) { s.frame.url = frameUrl(p.id, s.id, Date.parse(s.frame.at) || 0); changed = true; } // the URL is always this server's own path
  }
  if (changed) Object.defineProperty(p, 'migrated', { value: true, enumerable: false });
  return changed;
}
// Read path for films: if the load had to migrate old frames, persist the new shape once (no rev bump).
function loadFilm(id) {
  const p = films.load(id);
  if (p.migrated) withLock(films.lockKey(id), async () => { const q = films.get(id); if (q?.migrated) await writeAtomic(films.file(id), JSON.stringify(q, null, 2)); }).catch((e) => console.error(`frame migration of ${id} was not persisted: ${e.message}`));
  return p;
}
async function readFrameDataUri(projectId, shot) {
  const ext = FRAME_TYPES[shot.frame?.mime];
  if (!ext) return null;
  try { return `data:${shot.frame.mime};base64,${(await fsp.readFile(frameFile(projectId, shot.id, ext))).toString('base64')}`; } catch { return null; }
}

// Builds an export from a list of stored items; if one item makes the builder throw, that item is skipped instead of
// failing the whole export (exports must never 500 on stored data).
function tolerant(items, build) {
  const list = Array.isArray(items) ? items : [];
  try { return { out: build(list), skipped: 0 }; } catch { /* find the items the builder cannot take */ }
  const good = list.filter((it) => { try { build([it]); return true; } catch { return false; } });
  return { out: build(good), skipped: list.length - good.length };
}
const withWarnings = (out, skipped, what) => (skipped ? { ...out, warnings: [`${skipped} stored ${what} could not be read and ${skipped === 1 ? 'was' : 'were'} left out`] } : out);
const sanitizeOutputs = (outputs) => (Array.isArray(outputs) ? outputs : []).filter(isObj).slice(0, 20).map((o) => ({
  type: cleanLine(o.type, 20), format: cleanLine(o.format, 12),
  ...(httpUrl(o.url) ? { url: httpUrl(o.url) } : {}), ...(typeof o.local === 'string' ? { local: cleanLine(o.local, 300) } : {}),
}));
const taskError = (t) => (t.error ? cleanLine(typeof t.error === 'string' ? t.error : JSON.stringify(t.error), 500) : null);
const LOST_TASK = { status: 'failed', progress: null, outputs: [], error: 'this generation is no longer tracked by the server; start it again' };
// Refreshes provider tasks outside the project lock (they may hit the network). Never throws.
async function refreshTasks(ids) {
  const out = new Map();
  await Promise.all([...new Set(ids)].map(async (id) => { try { out.set(id, (await tasks.refresh(id)) || LOST_TASK); } catch { /* keep the stored state */ } }));
  return out;
}
const startsInFlight = new Set(); // "<project>:<shot|asset>" while a provider create call is running (no double paid starts)
async function startOnce(key, fn) {
  if (startsInFlight.has(key)) throw new HttpError(409, 'a generation is already being started for this item', { code: 'generation_starting' });
  startsInFlight.add(key);
  try { return await fn(); } finally { startsInFlight.delete(key); }
}
const pollReply = (res, url, p, progress) => {
  const want = url.searchParams.get('rev');
  if (want !== null && want === String(p.rev)) return send(res, 200, { ok: true, unchanged: true, rev: p.rev, progress_rev: p.progress_rev, progress });
  return send(res, 200, { ok: true, project: p, rev: p.rev, progress_rev: p.progress_rev, progress });
};

// ---- film ---------------------------------------------------------------------------------------------------------
const safePrompt = (shot) => { try { return promptFor(shot); } catch { return String(shot.prompt || ''); } };
const filmTotals = (p) => {
  p.total_duration_s = Math.round(p.shots.reduce((a, s) => a + (Number(s.duration_s) || 0), 0) * 10) / 10;
  p.summary = { scenes: p.scenes.length, shots: p.shots.length, duration_s: p.total_duration_s };
};
// Validates a shot PATCH body completely before anything is applied; returns only the fields to set.
function shotPatch(body, p) {
  const next = {};
  if (body.status !== undefined) { if (!SHOT_STATUSES.includes(body.status)) throw bad(`status must be one of: ${SHOT_STATUSES.join(', ')}`); next.status = body.status; }
  if (body.size !== undefined) { if (!SHOT_SIZES.includes(body.size)) throw bad(`size must be one of: ${SHOT_SIZES.join(', ')}`); next.size = body.size; }
  if (body.move !== undefined) { if (!SHOT_MOVES.includes(body.move)) throw bad(`move must be one of: ${SHOT_MOVES.join(', ')}`); next.move = body.move; }
  if (body.lens_mm !== undefined) next.lens_mm = Math.round(numberIn(body.lens_mm, 'lens_mm', 4, 1200) * 10) / 10;
  if (body.duration_s !== undefined) next.duration_s = Math.round(numberIn(body.duration_s, 'duration_s', 0.1, 600) * 10) / 10;
  if (body.assignee !== undefined) { const r = matchRole(body.assignee, p.roles); if (!r) throw bad(`assignee must be one of: ${p.roles.join(', ')}`); next.assignee = r; }
  if (body.description !== undefined) { next.description = textField(body.description, 'description', 2000); if (!next.description) throw bad('description cannot be empty'); }
  if (body.subject !== undefined) next.subject = textField(body.subject, 'subject', 200, { multi: false });
  if (body.prompt !== undefined) next.prompt = textField(body.prompt, 'prompt', 2000);
  return next;
}
const clipProgress = (p) => p.shots.filter((s) => s.clip).map((s) => ({ id: s.id, status: s.clip.status, progress: s.clip.progress ?? null }));

async function filmApi({ req, res, parts, url, method }) {
  if (parts[2] !== 'projects') return send(res, 404, { ok: false, error: 'not found' });
  // GET /api/film/projects | POST /api/film/projects {title, text}
  if (parts.length === 3) {
    if (method === 'GET') return send(res, 200, { ok: true, projects: films.list() });
    if (method !== 'POST') return methodNotAllowed(res, 'GET, POST');
    const body = await readJson(req, 2 * 1024 * 1024);
    if (!body.text || typeof body.text !== 'string') throw bad('body must be JSON {title?, text}');
    const bd = breakdown(body.text, { title: cleanLine(body.title, 120) || 'Untitled' });
    const p = { id: newId('film'), ...bd, script_text: body.text.slice(0, 2_000_000), roles: [...FILM_ROLES], activity: [], summary: { scenes: bd.scenes.length, shots: bd.shots.length, duration_s: bd.total_duration_s } };
    for (const s of p.shots) Object.assign(s, { comments: [], frame: null, clip: null, assignee: 'previs artist' });
    logActivity(p, 'system', `Breakdown: ${bd.scenes.length} scenes, ${bd.shots.length} proposed shots, ~${bd.total_duration_s}s animatic (rule-based estimate)`);
    await withLock(films.lockKey(p.id), () => films.put(p));
    return send(res, 201, { ok: true, project: p });
  }
  const id = parts[3];
  const sub = parts[4];
  if (!safeId(id)) return send(res, 404, { ok: false, error: 'project not found' });
  if (!sub) {
    // DELETE also removes the project's frame files, and works on a corrupt project file.
    if (method === 'DELETE') {
      const existed = await withLock(films.lockKey(id), async () => { const was = films.exists(id); await films.remove(id); await fsp.rm(path.join(films.dir, id), { recursive: true, force: true }); return was; });
      return existed ? send(res, 200, { ok: true }) : send(res, 404, { ok: false, error: 'project not found' });
    }
    if (method === 'GET') return send(res, 200, { ok: true, project: loadFilm(id) });
    return methodNotAllowed(res, 'GET, DELETE');
  }
  const p = loadFilm(id);
  // exports (never contain image bytes: frames are {url, mime, bytes, label, at, concept_mockup})
  if (sub === 'export') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const fmt = parts[5];
    const base = fileBase(p.title);
    if (fmt === 'shotlist.json') {
      const clean = { ...p, shots: p.shots.map((s) => { if (!s.frame) return s; const { data_uri, ...frame } = s.frame; return { ...s, frame }; }), schema: SHOTLIST_SCHEMA };
      delete clean.script_text; delete clean.activity;
      return text(res, 200, JSON.stringify(clean, null, 2), MIME['.json'], `${base}_shotlist.json`);
    }
    if (fmt === 'shotlist.csv') { const r = tolerant(p.shots, (shots) => shotlistCsv({ ...p, shots })); return text(res, 200, r.out, MIME['.csv'], `${base}_shotlist.csv`, r.skipped ? { 'X-Fabled-Skipped-Items': String(r.skipped) } : {}); }
    if (fmt === 'sequencer_plan.json') { const r = tolerant(p.shots, (shots) => sequencerPlan({ ...p, shots })); return text(res, 200, JSON.stringify(withWarnings(r.out, r.skipped, 'shot(s)'), null, 2), MIME['.json'], `${base}_sequencer_plan.json`); }
    if (fmt === 'unreal.py') return text(res, 200, await fsp.readFile(path.join(DIR, 'unreal', 'build_sequence_from_shotlist.py'), 'utf8'), MIME['.py'], 'build_sequence_from_shotlist.py');
    return send(res, 404, { ok: false, error: 'unknown export' });
  }
  if (sub === 'shots' && parts[5]) {
    const shotId = parts[5];
    const action = parts[6];
    const findShot = (proj) => { const s = proj.shots.find((x) => x.id === shotId); if (!s) throw new HttpError(404, 'shot not found'); return s; };
    const shot0 = findShot(p);
    // PATCH /api/film/projects/:id/shots/:shotId?as=role {size?, move?, lens_mm?, duration_s?, description?, status?, assignee?, prompt?, subject?}
    // Enumerated fields are whitelisted against the film engine's vocabularies (GET /api/status → vocab.film); a
    // bad value is a 400 and nothing is stored. Changing `move` also sets `preset` so the animatic and Sequencer plan
    // follow. An edited prompt is kept (prompt_custom) until it is cleared with prompt:"".
    if (!action) {
      if (method !== 'PATCH') return methodNotAllowed(res, 'PATCH');
      const body = await readJson(req, SMALL_BODY);
      const r = await mutate(films, id, req, (proj) => {
        const shot = findShot(proj);
        const who = whoFrom(url, proj.roles, 'director');
        const next = shotPatch(body, proj);
        const changed = Object.keys(next);
        if (!changed.length) return { write: false, shot };
        Object.assign(shot, next);
        if ('move' in next) shot.preset = presetForMove(next.move) || shot.preset;
        if ('prompt' in next) shot.prompt_custom = next.prompt !== '';
        if (!shot.prompt_custom && changed.some((k) => ['size', 'move', 'lens_mm', 'description', 'prompt'].includes(k))) shot.prompt = safePrompt(shot);
        if (next.status) logActivity(proj, who, `${shot.id} marked ${next.status}`);
        const edits = changed.filter((k) => k !== 'status');
        if (edits.length) logActivity(proj, who, `edited ${shot.id}: ${edits.join(', ')}`);
        filmTotals(proj);
        return { shot };
      });
      return send(res, 200, { ok: true, shot: r.shot, project: r.project });
    }
    if (action === 'comments') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const body = await readJson(req, SMALL_BODY);
      const txt = body.text === undefined ? '' : textField(body.text, 'text', 2000);
      if (!txt) throw bad('comment needs text');
      const r = await mutate(films, id, req, (proj) => {
        const shot = findShot(proj);
        if (shot.comments.length >= MAX_COMMENTS) throw bad(`this shot already has ${MAX_COMMENTS} comments (the limit)`);
        const c = { id: newId('c'), at: new Date().toISOString(), who: whoFrom(url, proj.roles, 'director'), text: txt };
        shot.comments.push(c);
        logActivity(proj, c.who, `commented on ${shot.id}: ${txt.slice(0, 80)}`);
        return { comment: c };
      });
      return send(res, 201, { ok: true, comment: r.comment, project: r.project });
    }
    // Shot still:  POST {data_uri, label?, concept_mockup?} stores the image as a file and sets
    //   shot.frame = {url, mime, bytes, label, at, concept_mockup}   (url is this path plus ?v=<timestamp>)
    // GET serves the bytes, DELETE removes the still. The project JSON never contains image data.
    if (action === 'frame') {
      if (method === 'GET') {
        const ext = FRAME_TYPES[shot0.frame?.mime];
        let buf = null;
        if (ext) { try { buf = await fsp.readFile(frameFile(id, shot0.id, ext)); } catch { buf = null; } }
        if (!buf) return send(res, 404, { ok: false, error: 'this shot has no frame' });
        const etag = `"${Date.parse(shot0.frame.at) || 0}-${buf.length}"`;
        // The ?v= value changes whenever the still does, so a versioned URL can be cached for good.
        const headers = { 'Content-Type': shot0.frame.mime, 'Cache-Control': url.searchParams.has('v') ? 'private, max-age=31536000, immutable' : 'private, no-cache', ETag: etag, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" };
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
        res.writeHead(200, { ...headers, 'Content-Length': buf.length });
        return res.end(buf);
      }
      if (method === 'POST') {
        const body = await readJson(req, FRAME_BODY_LIMIT);
        const img = parseFrameDataUri(body.data_uri);
        const label = body.label === undefined ? 'uploaded still' : textField(body.label, 'label', 80, { multi: false }) || 'uploaded still';
        const r = await mutate(films, id, req, async (proj) => {
          const shot = findShot(proj);
          const at = new Date();
          await writeFrameFile(id, shot.id, img);
          shot.frame = { url: frameUrl(id, shot.id, at.getTime()), mime: img.mime, bytes: img.buf.length, label, at: at.toISOString(), concept_mockup: !!body.concept_mockup };
          logActivity(proj, whoFrom(url, proj.roles, 'director'), `attached a frame to ${shot.id} (${label})`);
          return { shot };
        });
        return send(res, 201, { ok: true, shot: r.shot, project: r.project });
      }
      if (method === 'DELETE') {
        const r = await mutate(films, id, req, async (proj) => {
          const shot = findShot(proj);
          await removeFrameFiles(id, shot.id);
          if (!shot.frame) return { write: false, shot };
          shot.frame = null;
          logActivity(proj, whoFrom(url, proj.roles, 'director'), `removed the frame from ${shot.id}`);
          return { shot };
        });
        return send(res, 200, { ok: true, shot: r.shot, project: r.project });
      }
      return methodNotAllowed(res, 'GET, POST, DELETE');
    }
    // POST /api/film/projects/:id/shots/:shotId/clip {provider} — image→video from the shot's frame through a provider
    // plugin. The provider call runs outside the project lock; its result is applied to a fresh copy afterwards.
    if (action === 'clip') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const body = await readJson(req, SMALL_BODY);
      const ifMatch = parseIfMatch(req);
      const providerId = String(body.provider || 'higgsfield');
      const prov = getProvider(providerId);
      if (!prov) return send(res, 404, { ok: false, error: 'unknown provider' });
      if (!prov.kinds.includes('image-to-video')) return send(res, 400, { ok: false, error: `${prov.name} does not do image→video` });
      if (!prov.configured(process.env)) return send(res, 409, { ok: false, error: `${prov.name} is not configured on this server (set ${prov.env.join(' / ')})`, env: prov.env });
      const fresh = loadFilm(id); // after the body read: the frame may have just been attached
      if (ifMatch !== null && fresh.rev !== ifMatch) throw revConflict(fresh, ifMatch);
      const shot1 = findShot(fresh);
      if (!shot1.frame) return send(res, 400, { ok: false, error: 'attach a frame to the shot first (image→video needs a still)' });
      const data_uri = await readFrameDataUri(id, shot1);
      if (!data_uri) return send(res, 400, { ok: false, error: 'the frame file for this shot is missing; attach the still again' });
      let task;
      try {
        task = await startOnce(`${id}:${shot1.id}`, () => tasks.create(providerId, { kind: 'image-to-video', prompt: cleanText(shot1.prompt, 2000), image: { data_uri }, image_label: `${fresh.title} ${shot1.id}` }));
      } catch (e) { if (e instanceof HttpError) throw e; return send(res, 502, { ok: false, error: String(e.message || e) }); }
      const r = await mutate(films, id, null, (proj) => {
        const shot = findShot(proj);
        shot.clip = { task_id: task.id, provider: task.provider_name, status: task.status, progress: task.progress ?? 0, url: null, error: null, concept_mockup: !!task.concept_mockup };
        logActivity(proj, whoFrom(url, proj.roles, 'director'), `${prov.name}: image→video started for ${shot.id}`);
        return { shot };
      });
      return send(res, 202, { ok: true, task, shot: r.shot, project: r.project });
    }
    return send(res, 404, { ok: false, error: 'not found' });
  }
  // GET /api/film/projects/:id/clips[?rev=n] -> refresh provider tasks referenced by shots (see the contract on top:
  // rev moves on status / output / error changes only, progress ticks do not bump it).
  if (sub === 'clips') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const pending = p.shots.filter((s) => s.clip?.task_id && !TERMINAL.has(s.clip.status));
    if (!pending.length) return pollReply(res, url, p, clipProgress(p));
    const fresh = await refreshTasks(pending.map((s) => s.clip.task_id));
    const r = await mutate(films, id, null, (proj) => {
      let level = 0; // 0 nothing, 1 progress only, 2 collaborator-visible
      for (const s of proj.shots) {
        const t = s.clip?.task_id && !TERMINAL.has(s.clip.status) ? fresh.get(s.clip.task_id) : null;
        if (!t) continue;
        const nextUrl = httpUrl((t.outputs || []).find((o) => o?.type === 'video')?.url);
        const err = taskError(t);
        if (t.status !== s.clip.status || nextUrl !== (s.clip.url || null) || err !== (s.clip.error || null)) level = 2;
        else if (t.progress != null && t.progress !== s.clip.progress) level = Math.max(level, 1);
        Object.assign(s.clip, { status: t.status, progress: t.progress ?? s.clip.progress ?? null, url: nextUrl, error: err });
      }
      return { write: level === 2 ? true : level === 1 ? 'progress' : false };
    });
    return pollReply(res, url, r.project, clipProgress(r.project));
  }
  return send(res, 404, { ok: false, error: 'not found' });
}

// ---- game ---------------------------------------------------------------------------------------------------------
const footprintOf = (asset) => {
  const ok = (f) => Array.isArray(f) && f.length === 2 && f.every((n) => Number.isFinite(n) && n > 0);
  if (ok(asset.footprint_cm)) return [...asset.footprint_cm];
  const d = Object.hasOwn(CATEGORY_DEFAULTS, asset.category) ? CATEGORY_DEFAULTS[asset.category].footprint_cm : null;
  return ok(d) ? [...d] : [100, 100];
};
// Sets the category and everything that follows from it (same fields buildKit sets). Uses the kit engine's
// applyCategory when it exists; the local version mirrors buildKit.
function applyCategory(asset, category) {
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) throw bad(`category must be one of: ${CATEGORIES.join(', ')}`);
  if (typeof kitlib.applyCategory === 'function') { try { kitlib.applyCategory(asset, category); } catch (e) { throw bad(String(e.message || e)); } return asset; }
  const d = CATEGORY_DEFAULTS[category];
  asset.category = category;
  asset.import_profile = d.profile;
  asset.budget = { lods_triangles: [...d.lods], height_cm: [...d.height_cm], texel_density_px_per_cm: d.texel_density, texture_px: d.textures, up_axis: d.up_axis, rig: d.rig };
  asset.footprint_cm = [...d.footprint_cm];
  asset.assignee = category === 'character' || category === 'creature' ? 'character artist' : 'vendor';
  return asset;
}
const itemOk = (it) => isObj(it) && typeof it.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(it.id) && typeof it.asset_id === 'string' && typeof it.asset_name === 'string'
  && ['x', 'y', 'z', 'yaw', 'scale'].every((k) => Number.isFinite(it[k])) && Array.isArray(it.footprint_cm) && it.footprint_cm.length === 2 && it.footprint_cm.every((n) => Number.isFinite(n));
// A layout item is always rebuilt from the asset it points at: only id and the numeric transform come from the
// client. Uses the kit engine's sanitizeLayoutItem when it exists and returns a well-formed item.
function layoutItem(raw, asset) {
  if (!isObj(raw) || !asset) return null;
  let it = null;
  if (typeof kitlib.sanitizeLayoutItem === 'function') { try { it = kitlib.sanitizeLayoutItem(raw, asset); } catch { it = null; } }
  if (!itemOk(it)) {
    it = {
      id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : `${asset.id}-${crypto.randomBytes(2).toString('hex')}`,
      asset_id: asset.id, asset_name: asset.asset_name, category: asset.category,
      x: Math.round(clampNum(raw.x, -COORD_LIMIT, COORD_LIMIT, 0)), y: Math.round(clampNum(raw.y, -COORD_LIMIT, COORD_LIMIT, 0)), z: Math.round(clampNum(raw.z, -COORD_LIMIT, COORD_LIMIT, 0)),
      yaw: yawDeg(clampNum(raw.yaw, -1e9, 1e9, 0)), scale: clampNum(raw.scale, 0.1, 10, 1), footprint_cm: footprintOf(asset),
    };
  }
  return itemOk(it) && it.asset_id === asset.id ? it : null;
}
function layoutItems(rawItems, assets) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set(); const out = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (out.length >= MAX_LAYOUT_ITEMS) break;
    const it = isObj(raw) && typeof raw.asset_id === 'string' ? layoutItem(raw, byId.get(raw.asset_id)) : null;
    if (!it) continue;
    while (seen.has(it.id)) it.id = `${it.asset_id}-${crypto.randomBytes(3).toString('hex')}`;
    seen.add(it.id); out.push(it);
  }
  return out;
}
const SPAWN_DEFAULT = { x: 0, y: -1200, z: 0, yaw: 90 };
const spawnNum = (v, dflt) => Math.round(clampNum(v ?? dflt, -COORD_LIMIT, COORD_LIMIT, dflt));
const storedSpawn = (s) => ({ x: spawnNum(s?.x, SPAWN_DEFAULT.x), y: spawnNum(s?.y, SPAWN_DEFAULT.y), z: spawnNum(s?.z, SPAWN_DEFAULT.z), yaw: yawDeg(clampNum(s?.yaw ?? SPAWN_DEFAULT.yaw, -1e9, 1e9, SPAWN_DEFAULT.yaw)) });
// spawn from a client: an object whose x, y, z, yaw (when present) are numbers; nothing else is kept.
function spawnFrom(raw, current) {
  const cur = storedSpawn(current);
  if (raw === undefined || raw === null) return cur;
  if (!isObj(raw)) throw bad('spawn must be an object {x, y, z, yaw}');
  const out = { ...cur };
  for (const k of ['x', 'y', 'z']) if (raw[k] !== undefined) out[k] = Math.round(numberIn(raw[k], `spawn.${k}`, -COORD_LIMIT, COORD_LIMIT));
  if (raw.yaw !== undefined) out.yaw = yawDeg(numberIn(raw.yaw, 'spawn.yaw', -1e9, 1e9));
  return out;
}
const cleanLayout = (p, items = layoutItems(p.layout.items, p.assets), spawn = storedSpawn(p.layout.spawn)) => ({
  schema: LAYOUT_SCHEMA, title: p.title, size_cm: clampNum(p.layout.size_cm, 100, 1e6, 4000), grid_cm: clampNum(p.layout.grid_cm, 1, 1e5, 100), spawn, items,
  updated_at: typeof p.layout.updated_at === 'string' ? p.layout.updated_at : null,
});
const gameSummary = (p) => { try { p.summary = summarize(p.assets); } catch { /* keep the stored summary if an asset is malformed */ } };
const syncLayoutToAsset = (p, a) => { for (const it of p.layout.items) if (isObj(it) && it.asset_id === a.id) Object.assign(it, { asset_name: a.asset_name, category: a.category, footprint_cm: footprintOf(a) }); };
const pascal = (s) => String(s).split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
function renameAsset(p, a, name) {
  const before = a.asset_name;
  if (typeof kitlib.renameAsset === 'function') { try { kitlib.renameAsset(p, a.id, name); } catch (e) { throw bad(String(e.message || e)); } } else {
    a.name = name;
    const next = `SM_${pascal(name)}`.slice(0, 80);
    if (next !== 'SM_' && !p.assets.some((x) => x !== a && x.asset_name === next)) a.asset_name = next; // the Unreal content path follows the name when it stays unique
  }
  if (typeof a.name !== 'string' || !a.name) a.name = name;
  if (typeof a.asset_name !== 'string' || !/^[A-Za-z0-9_]{1,80}$/.test(a.asset_name)) a.asset_name = before;
  syncLayoutToAsset(p, a);
}
const generationProgress = (p) => p.assets.filter((a) => a.generation).map((a) => ({ id: a.id, status: a.generation.status, progress: a.generation.progress ?? null }));

async function gameApi({ req, res, parts, url, method }) {
  if (parts[2] !== 'projects') return send(res, 404, { ok: false, error: 'not found' });
  if (parts.length === 3) {
    if (method === 'GET') return send(res, 200, { ok: true, projects: games.list() });
    if (method !== 'POST') return methodNotAllowed(res, 'GET, POST');
    const body = await readJson(req, 1024 * 1024);
    if (!body.text || typeof body.text !== 'string') throw bad('body must be JSON {title?, text}');
    const kit = buildKit(body.text, { title: cleanLine(body.title, 120) || null });
    const p = { id: newId('game'), ...kit, title: cleanLine(kit.title, 120) || 'Untitled game', pitch_text: body.text.slice(0, 200_000), roles: [...GAME_ROLES], activity: [], layout: null };
    p.layout = starterLayout(p);
    logActivity(p, 'system', `Kit: ${kit.assets.length} assets (${Object.entries(kit.summary.by_category).map(([k, v]) => `${v} ${k}`).join(', ')}) with placeholder import profiles; starter layout with ${p.layout.items.length} placements`);
    await withLock(games.lockKey(p.id), () => games.put(p));
    return send(res, 201, { ok: true, project: p });
  }
  const id = parts[3];
  const sub = parts[4];
  if (!safeId(id)) return send(res, 404, { ok: false, error: 'project not found' });
  if (!sub) {
    if (method === 'DELETE') {
      const existed = await withLock(games.lockKey(id), async () => { const was = games.exists(id); await games.remove(id); return was; });
      return existed ? send(res, 200, { ok: true }) : send(res, 404, { ok: false, error: 'project not found' });
    }
    if (method === 'GET') return send(res, 200, { ok: true, project: games.load(id) });
    return methodNotAllowed(res, 'GET, DELETE');
  }
  const p = games.load(id);
  if (sub === 'export') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const fmt = parts[5];
    const base = fileBase(p.title);
    // The layout was re-sanitized on load; a stored item or asset the builders still cannot take is skipped.
    const layout = p.layout;
    if (fmt === 'kit.json') { const clean = { ...p, layout }; delete clean.pitch_text; delete clean.activity; return text(res, 200, JSON.stringify(clean, null, 2), MIME['.json'], `${base}_kit.json`); }
    if (fmt === 'layout.json') return text(res, 200, JSON.stringify(layout, null, 2), MIME['.json'], `${base}_layout.json`);
    if (fmt === 'blockout_plan.json') { const r = tolerant(layout.items, (items) => blockoutPlan(p, { ...layout, items })); return text(res, 200, JSON.stringify(withWarnings(r.out, r.skipped, 'layout item(s)'), null, 2), MIME['.json'], `${base}_blockout_plan.json`); }
    if (fmt === 'import_profiles.json') {
      const r = tolerant(p.assets, (assets) => assets.map((a) => ({ asset: a.asset_name, profile: a.import_profile, ...a.budget })));
      return text(res, 200, JSON.stringify(withWarnings({ schema: 'fabled.import_profiles/0.1', note: p.budget_note, profiles: r.out }, r.skipped, 'asset(s)'), null, 2), MIME['.json'], `${base}_import_profiles.json`);
    }
    if (fmt === 'unreal.py') return text(res, 200, await fsp.readFile(path.join(DIR, 'unreal', 'blockout_from_layout.py'), 'utf8'), MIME['.py'], 'blockout_from_layout.py');
    return send(res, 404, { ok: false, error: 'unknown export' });
  }
  if (sub === 'assets' && parts[5]) {
    const assetId = parts[5];
    const action = parts[6];
    const findAsset = (proj) => { const a = proj.assets.find((x) => x.id === assetId); if (!a) throw new HttpError(404, 'asset not found'); return a; };
    findAsset(p);
    // PATCH .../assets/:id?as=role {status? | advance?, assignee?, category?, name?, import_profile?}
    // Everything is validated before anything is applied. `category` re-applies that category's import profile,
    // budgets, footprint and default assignee (explicit import_profile / assignee in the same body win) and refreshes
    // the asset's layout items.
    if (!action) {
      if (method !== 'PATCH') return methodNotAllowed(res, 'PATCH');
      const body = await readJson(req, SMALL_BODY);
      const r = await mutate(games, id, req, (proj) => {
        const a = findAsset(proj);
        const who = whoFrom(url, proj.roles, 'designer');
        if (body.status !== undefined && !ASSET_STATUSES.includes(body.status)) throw bad(`status must be one of ${ASSET_STATUSES.join(', ')}`);
        if (body.category !== undefined && !(typeof body.category === 'string' && CATEGORIES.includes(body.category))) throw bad(`category must be one of: ${CATEGORIES.join(', ')}`);
        if (body.import_profile !== undefined && !IMPORT_PROFILES.includes(body.import_profile)) throw bad(`import_profile must be one of: ${IMPORT_PROFILES.join(', ')}`);
        const assignee = body.assignee === undefined ? null : matchRole(body.assignee, proj.roles);
        if (body.assignee !== undefined && !assignee) throw bad(`assignee must be one of: ${proj.roles.join(', ')}`);
        const name = body.name === undefined ? null : textField(body.name, 'name', 120, { multi: false });
        if (body.name !== undefined && !name) throw bad('name cannot be empty');
        const did = [];
        if (body.category !== undefined) { applyCategory(a, body.category); syncLayoutToAsset(proj, a); did.push(`category ${a.category} (profile ${a.import_profile})`); }
        if (name !== null && name !== a.name) { renameAsset(proj, a, name); did.push(`renamed to ${a.name}`); }
        if (body.import_profile !== undefined) { a.import_profile = body.import_profile; did.push(`profile ${a.import_profile}`); }
        if (assignee) { a.assignee = assignee; did.push(`assigned to ${assignee}`); }
        if (body.status !== undefined) { a.status = body.status; did.push(a.status); }
        if (body.advance) { a.status = nextStatus(a.status); did.push(a.status); }
        if (!did.length) return { write: false, asset: a };
        gameSummary(proj);
        logActivity(proj, who, `${a.asset_name}: ${did.join(', ')}`);
        return { asset: a };
      });
      return send(res, 200, { ok: true, asset: r.asset, project: r.project });
    }
    if (action === 'comments') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const body = await readJson(req, SMALL_BODY);
      const txt = body.text === undefined ? '' : textField(body.text, 'text', 2000);
      if (!txt) throw bad('comment needs text');
      const r = await mutate(games, id, req, (proj) => {
        const a = findAsset(proj);
        if (a.comments.length >= MAX_COMMENTS) throw bad(`this asset already has ${MAX_COMMENTS} comments (the limit)`);
        const c = { id: newId('c'), at: new Date().toISOString(), who: whoFrom(url, proj.roles, 'designer'), text: txt };
        a.comments.push(c);
        logActivity(proj, c.who, `commented on ${a.asset_name}: ${txt.slice(0, 80)}`);
        return { comment: c };
      });
      return send(res, 201, { ok: true, comment: r.comment, project: r.project });
    }
    // POST .../assets/:id/generate {provider, prompt?} — text→3D through a provider plugin (mock offline, Meshy/Tripo with keys)
    if (action === 'generate') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const body = await readJson(req, SMALL_BODY);
      const ifMatch = parseIfMatch(req);
      const providerId = String(body.provider || 'mock');
      const prov = getProvider(providerId);
      if (!prov) return send(res, 404, { ok: false, error: 'unknown provider' });
      if (!prov.kinds.includes('text-to-3d')) return send(res, 400, { ok: false, error: `${prov.name} does not do text→3D` });
      if (!prov.configured(process.env)) return send(res, 409, { ok: false, error: `${prov.name} is not configured on this server (set ${prov.env.join(' / ')})`, env: prov.env });
      const fresh = games.load(id);
      if (ifMatch !== null && fresh.rev !== ifMatch) throw revConflict(fresh, ifMatch);
      const a1 = findAsset(fresh);
      const prompt = (body.prompt === undefined || body.prompt === null ? '' : textField(body.prompt, 'prompt', 2000))
        || cleanText(`${a1.name}, ${String(fresh.style || 'stylized').toLowerCase()} game asset, ${a1.category}, clean silhouette, single object, neutral pose`, 2000);
      let task;
      try {
        task = await startOnce(`${id}:${a1.id}`, () => tasks.create(providerId, { kind: 'text-to-3d', prompt, source_asset_id: a1.id }));
      } catch (e) { if (e instanceof HttpError) throw e; return send(res, 502, { ok: false, error: String(e.message || e) }); }
      const r = await mutate(games, id, null, (proj) => {
        const a = findAsset(proj);
        a.generation = { task_id: task.id, provider: task.provider_name, status: task.status, progress: 0, outputs: [], error: null, concept_mockup: !!task.concept_mockup, prompt };
        a.status = 'generating';
        gameSummary(proj);
        logActivity(proj, whoFrom(url, proj.roles, 'designer'), `${prov.name}: text→3D started for ${a.asset_name}`);
        return { asset: a };
      });
      return send(res, 202, { ok: true, task, asset: r.asset, project: r.project });
    }
    return send(res, 404, { ok: false, error: 'not found' });
  }
  // GET /api/game/projects/:id/generations[?rev=n] -> refresh provider tasks referenced by assets. Progress ticks are
  // persisted without a rev bump; rev moves when a status, the outputs or the error change (contract on top).
  if (sub === 'generations') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const pending = p.assets.filter((a) => a.generation?.task_id && !TERMINAL.has(a.generation.status));
    if (!pending.length) return pollReply(res, url, p, generationProgress(p));
    const fresh = await refreshTasks(pending.map((a) => a.generation.task_id));
    const r = await mutate(games, id, null, (proj) => {
      let level = 0;
      for (const a of proj.assets) {
        const t = a.generation?.task_id && !TERMINAL.has(a.generation.status) ? fresh.get(a.generation.task_id) : null;
        if (!t) continue;
        const outputs = sanitizeOutputs(t.outputs);
        const err = taskError(t);
        if (t.status !== a.generation.status || JSON.stringify(outputs) !== JSON.stringify(a.generation.outputs || []) || err !== (a.generation.error || null)) level = 2;
        else if (t.progress != null && t.progress !== a.generation.progress) level = Math.max(level, 1);
        Object.assign(a.generation, { status: t.status, progress: t.progress ?? a.generation.progress ?? null, outputs, error: err });
        if (t.status === 'succeeded' && a.status === 'generating') a.status = 'generated';
        if (t.status === 'failed' && a.status === 'generating') a.status = 'requested';
      }
      if (level === 2) gameSummary(proj);
      return { write: level === 2 ? true : level === 1 ? 'progress' : false };
    });
    return pollReply(res, url, r.project, generationProgress(r.project));
  }
  // layout: PUT {items[], spawn?} replaces the placements; POST {asset_id, x, y, yaw?, scale?} adds one. Items are
  // rebuilt from the asset they point at (see layoutItem); unknown asset ids are dropped.
  if (sub === 'layout') {
    if (method === 'PUT') {
      const body = await readJson(req, 4 * 1024 * 1024);
      if (!Array.isArray(body.items)) throw bad('layout needs items[]');
      const r = await mutate(games, id, req, (proj) => {
        const spawn = spawnFrom(body.spawn, proj.layout.spawn);
        proj.layout = { ...cleanLayout(proj, layoutItems(body.items, proj.assets), spawn), updated_at: new Date().toISOString() };
        return {};
      });
      return send(res, 200, { ok: true, layout: r.project.layout, project: r.project });
    }
    if (method === 'POST') {
      const body = await readJson(req, SMALL_BODY);
      const r = await mutate(games, id, req, (proj) => {
        const a = proj.assets.find((x) => x.id === body.asset_id);
        if (!a) throw new HttpError(404, 'asset not found');
        if (proj.layout.items.length >= MAX_LAYOUT_ITEMS) throw bad(`a layout holds at most ${MAX_LAYOUT_ITEMS} placements`);
        const it = layoutItem(place(a, clampNum(body.x, -COORD_LIMIT, COORD_LIMIT, 0), clampNum(body.y, -COORD_LIMIT, COORD_LIMIT, 0), yawDeg(clampNum(body.yaw, -1e9, 1e9, 0)), clampNum(body.scale, 0.1, 10, 1)), a);
        if (!it) throw bad('this asset cannot be placed');
        proj.layout.items.push(it); proj.layout.updated_at = new Date().toISOString();
        return { item: it };
      });
      return send(res, 201, { ok: true, item: r.item, project: r.project });
    }
    return methodNotAllowed(res, 'PUT, POST');
  }
  return send(res, 404, { ok: false, error: 'not found' });
}

// ---- request guard for /api/* (cross-site requests and DNS rebinding) ---------------------------------------------
// Any page open in the user's browser can send requests to http://127.0.0.1:<port>/. Three checks keep them out:
//   Host     must name this server. Bound to loopback (the default): localhost, 127.0.0.1 or [::1], any port, which
//            stops DNS rebinding (the attacker's hostname arrives in Host). Bound elsewhere (HOST=…, an explicit
//            opt-in to LAN use): the bound address, this machine's own addresses when bound to a wildcard, and the
//            names in FABLED_ALLOWED_HOSTS (comma-separated).
//   Origin   when the browser sends one it must be this server (same host:port as Host).
//   Content-Type  POST/PUT/PATCH (and any other request with a body) must be application/json. Browsers cannot send
//            that cross-site without a CORS preflight, and this server never answers one.
const hostnameOf = (hostHeader) => {
  try { const u = new URL(`http://${hostHeader}`); return u.username || u.password || u.pathname !== '/' || u.search || u.hash ? null : { hostname: u.hostname.toLowerCase(), host: u.host.toLowerCase() }; } catch { return null; }
};
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];
const bracket = (h) => (net.isIPv6(h) ? `[${h}]` : h);
const boundHost = bracket(String(HOST).trim().toLowerCase());
const BOUND_TO_LOOPBACK = boundHost === 'localhost' || boundHost === '[::1]' || /^127(\.\d{1,3}){3}$/.test(boundHost);
const ALLOWED_HOSTNAMES = new Set(LOOPBACK_NAMES);
if (!BOUND_TO_LOOPBACK) {
  const add = (h) => { const parsed = hostnameOf(bracket(String(h).trim().toLowerCase())); if (parsed) ALLOWED_HOSTNAMES.add(parsed.hostname); };
  if (['0.0.0.0', '[::]', ''].includes(boundHost)) { add(os.hostname()); for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) add(i.address.split('%')[0]); } else add(boundHost);
  for (const h of String(process.env.FABLED_ALLOWED_HOSTS || '').split(',')) if (h.trim()) add(h);
}
function guardApi(req) {
  const host = hostnameOf(String(req.headers.host || ''));
  if (!host || !ALLOWED_HOSTNAMES.has(host.hostname)) return [403, 'this server does not answer for that Host header'];
  if (req.headers.origin !== undefined) {
    let origin = null;
    try { const u = new URL(req.headers.origin); if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.host.toLowerCase(); } catch { origin = null; }
    if (origin !== host.host) return [403, 'cross-origin requests are not allowed'];
  }
  const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (['POST', 'PUT', 'PATCH'].includes(req.method) || (hasBody && !['GET', 'HEAD'].includes(req.method))) {
    if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || '').trim())) return [415, 'Content-Type must be application/json'];
  }
  return null;
}

// ---- shared -------------------------------------------------------------------------------------------------------
async function api(ctx) {
  const { req, res, url, method } = ctx;
  const denied = guardApi(req);
  if (denied) return send(res, denied[0], { ok: false, error: denied[1] });
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'film', 'projects', ...]
  ctx.parts = parts;
  if (parts[1] === 'film') return filmApi(ctx);
  if (parts[1] === 'game') return gameApi(ctx);
  if (method !== 'GET') return methodNotAllowed(res, 'GET, HEAD');
  if (parts[1] === 'status') {
    return send(res, 200, { ok: true, service: 'fabled-demos', version: '0.2', providers: listProviders(), kinds: KIND_LABELS, studio_url: UI_URL, demos: { film: '/film/', game: '/game/' }, work_dir: path.relative(DIR, WORK),
      vocab: { film: { statuses: SHOT_STATUSES, sizes: SHOT_SIZES, moves: SHOT_MOVES, roles: FILM_ROLES }, game: { statuses: ASSET_STATUSES, categories: CATEGORIES, import_profiles: IMPORT_PROFILES, roles: GAME_ROLES } },
      limits: { frame_bytes: MAX_FRAME_BYTES, frame_types: Object.keys(FRAME_TYPES), comments_per_item: MAX_COMMENTS, layout_items: MAX_LAYOUT_ITEMS } });
  }
  if (parts[1] === 'events') { const since = Number(url.searchParams.get('since') || 0) || 0; return send(res, 200, { ok: true, events: events.filter((e) => e.id > since) }); }
  if (parts[1] === 'samples' && parts[2]) {
    const f = path.join(DIR, 'samples', path.basename(parts[2]));
    const type = MIME[path.extname(f).toLowerCase()];
    let buf = null; try { if (type && (await fsp.stat(f)).isFile()) buf = await fsp.readFile(f); } catch { buf = null; }
    if (!buf) return send(res, 404, { ok: false, error: 'no such sample' });
    return text(res, 200, buf, type);
  }
  // GET /api/mock-models/<file>.glb — the offline mock provider's procedural models (CONCEPT MOCKUP, self-made)
  if (parts[1] === 'mock-models' && parts[2]) {
    const f = path.join(DIR, '..', 'ui', 'samples', 'mock_generations', path.basename(parts[2]));
    let buf = null; try { if (f.endsWith('.glb') && (await fsp.stat(f)).isFile()) buf = await fsp.readFile(f); } catch { buf = null; }
    if (!buf) return send(res, 404, { ok: false, error: 'no such model' });
    return text(res, 200, buf, MIME['.glb'], path.basename(f));
  }
  return send(res, 404, { ok: false, error: 'not found' });
}

// The apps use same-origin module scripts and CSS, inline style attributes, data:/blob: images, same-origin fetch and
// video from provider CDNs (https). Nothing else is allowed, and the pages cannot be framed.
const CSP_HTML = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const plain = (res, code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers }); res.end(body); };
async function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return plain(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
  let rel; try { rel = decodeURIComponent(pathname); } catch { return plain(res, 400, 'bad request'); }
  if (rel.includes('\0')) return plain(res, 400, 'bad request');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return plain(res, 403, 'forbidden');
  // fonts are shared with the studio UI
  const fonts = path.join(DIR, '..', 'ui', 'public', 'fonts');
  const shared = rel.startsWith('/fonts/') ? path.normalize(path.join(DIR, '..', 'ui', 'public', rel)) : null;
  const candidates = [file, shared && shared.startsWith(fonts + path.sep) ? shared : null].filter(Boolean);
  for (const f of candidates) {
    let st; try { st = await fsp.stat(f); } catch { continue; }
    if (!st.isFile()) continue;
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP_HTML, 'X-Frame-Options': 'DENY' } : {}) });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(f);
    stream.on('error', () => res.destroy()); // the file vanished or became unreadable mid-response: drop the connection, not the process
    return stream.pipe(res);
  }
  return plain(res, 404, 'not found');
}

async function handle(req, res) {
  // On every response. No Access-Control-Allow-* header is ever sent: this API is same-origin only.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  try {
    let url; try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { ok: false, error: 'bad request URL' }); }
    const method = req.method === 'HEAD' ? 'GET' : req.method; // HEAD is routed as GET; Node drops the body
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await api({ req, res, url, method });
    if (url.pathname === '/film' || url.pathname === '/game') { res.writeHead(302, { Location: `${url.pathname}/` }); return res.end(); }
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (res.headersSent) { res.destroy(); return undefined; }
    if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message, ...e.extra });
    console.error(`${req.method} ${req.url} failed:`, e);
    return send(res, 500, { ok: false, error: String(e?.message || e) });
  }
}
export const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => { console.error('request handler failed:', e); try { res.destroy(); } catch { /* already gone */ } });
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  // A stray rejection (for example from a provider adapter) is logged; it must not take the server down mid-session.
  process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
  server.listen(PORT, HOST, () => {
    const prov = listProviders().filter((p) => p.configured).map((p) => p.name).join(', ') || 'none';
    console.log(`Fabled demos  http://${HOST}:${PORT}/   film → /film/   game → /game/   providers configured: ${prov}   work: ${WORK}`);
  });
}
