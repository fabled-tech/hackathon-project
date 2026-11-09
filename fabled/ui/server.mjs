#!/usr/bin/env node
// Fabled demo UI: tiny local server (no dependencies beyond Node 18+).
// - Serves the static UI (public/), three.js from node_modules, and the sample sculpts.
// - /api/* shells out to the pipeline / validator CLIs if present (see INTERFACES.md),
//   otherwise returns the CONCEPT MOCKUP stub JSON from stub/.
// Binds to 127.0.0.1 by default (HOST=0.0.0.0 is the documented LAN mode for the iPad app). Not for deployment.
// Security model (see INTERFACES.md §11): every request must carry an allowed Host header, /api/* refuses
// cross-origin browser requests, no CORS headers are ever sent, and every response carries nosniff + a CSP.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { buildWorkspace, NotesStore, ActivityLog, validAssetId } from './workspace.mjs';
import { listProviders, getProvider, TaskStore, downloadModel, KIND_LABELS, PROVIDERS } from './providers/index.mjs';

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(UI_DIR, '..');
const PIPELINE_DIR = path.join(PROTO_DIR, 'pipeline');
const VALIDATOR_DIR = path.join(PROTO_DIR, 'validator');
const WORK_DIR = path.join(UI_DIR, 'work');
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '127.0.0.1';
const CLI_TIMEOUT_MS = Number(process.env.FABLED_CLI_TIMEOUT_MS || 60 * 60 * 1000);
// Connected workspace state (all under the gitignored work/ folder)
const activity = new ActivityLog(path.join(WORK_DIR, 'activity.jsonl'));
const notes = new NotesStore(path.join(WORK_DIR, 'workspace_notes.json'));
const generations = new TaskStore(path.join(WORK_DIR, 'provider_tasks.json'), { onEvent: (e) => activity.add(e) });
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
// Request body caps. Uploads are streamed to disk, everything else is small JSON held in memory.
const posInt = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : dflt);
const UPLOAD_MAX_BYTES = posInt(process.env.FABLED_UPLOAD_MAX_BYTES, 1024 * 1024 * 1024);
const JSON_MAX_BYTES = 1024 * 1024;            // import profiles
const NOTE_BODY_MAX_BYTES = 256 * 1024;
const GENERATION_BODY_MAX_BYTES = 16 * 1024 * 1024; // may carry a base64 image of up to IMAGE_MAX_BYTES
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain',
  '.fbx': 'application/octet-stream', '.ply': 'application/octet-stream', '.stl': 'application/octet-stream', '.md': 'text/plain; charset=utf-8' };

// PATH lookup without a shell (this runs on every /api/status).
const which = (bin) => {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
};
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const listDocs = (dir) => exists(dir) ? fs.readdirSync(dir).filter((f) => /^(INTERFACE|INTERFACES|README)(\.md)?$/i.test(f)).map((f) => path.join(dir, f)) : [];

// ---- CLI discovery (resolved contracts, see INTERFACES.md) ----
// Pipeline:  python3 pipeline/fabled_pipeline.py --input <mesh> --out <dir> --config <cfg.json>
//            writes <out>/progress.json during the run and <out>/manifest.json at the end (also on failure).
// Validator: validator/.venv/bin/python -m fabled_validator check <asset> --profile <p.json> --json-only
//            (cwd validator/), report JSON on stdout, exit 0 = no flags, 1 = warn/fail, 2 = error (stdout still a report).
const off = (v) => /^(0|off|false|stub)$/i.test(v || '');
const PY = process.env.PYTHON || 'python3';
// The pipeline and validator are started with an argv array (spawn without a shell); request data only ever becomes
// one argv element. The only shell use is the operator's own FABLED_PIPELINE_CMD / FABLED_VALIDATOR_CMD template,
// where each {value} is inserted single-quoted (shq). Child processes get the server's environment minus the
// provider API keys, which only the provider adapters need.
const SECRET_ENV = new Set([...PROVIDERS.flatMap((p) => p.env || []), 'HIGGSFIELD_API_SECRET']);
const childEnv = (extra = {}) => { const e = { ...process.env, ...extra }; for (const k of SECRET_ENV) delete e[k]; return e; };

function findBlender() {
  if (process.env.FABLED_BLENDER && exists(process.env.FABLED_BLENDER)) return process.env.FABLED_BLENDER;
  const inPath = which('blender') || which('Blender');
  if (inPath && exists(inPath)) return inPath;
  for (const cand of [
    '/opt/homebrew/bin/blender',
    '/usr/local/bin/blender',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    path.join(process.env.HOME || '', 'Applications/Blender.app/Contents/MacOS/Blender'),
  ]) {
    if (cand && exists(cand)) return cand;
  }
  return null;
}

// Feature detection by reading `--help` (argparse only; never launches Blender). Cached for 30 s.
const helpCache = new Map();
function helpHas(key, cmd, args, cwd, flag, extraEnv = {}) {
  const hit = helpCache.get(key);
  if (hit && Date.now() - hit.t < 30000) return hit.v;
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20000, env: childEnv(extraEnv) });
  const v = `${r.stdout || ''}${r.stderr || ''}`.includes(flag);
  helpCache.set(key, { t: Date.now(), v }); return v;
}
const pipelinePy = () => path.join(PIPELINE_DIR, 'fabled_pipeline.py');
const pipelineTakesAssetName = () => exists(pipelinePy()) && helpHas('p-aname', PY, [pipelinePy(), '--help'], PIPELINE_DIR, '--asset-name');
const pipelineTakesValidatorProfile = () => exists(pipelinePy()) && helpHas('p-vprof', PY, [pipelinePy(), '--help'], PIPELINE_DIR, '--validator-profile');
const validatorTakesManifest = () => helpHas('v-manifest', venvPython(), ['-m', 'fabled_validator', 'check', '--help'], VALIDATOR_DIR, '--manifest', {
  PYTHONPATH: process.env.PYTHONPATH ? `${VALIDATOR_DIR}:${process.env.PYTHONPATH}` : VALIDATOR_DIR,
});

function pipelineCommand(input, profile, outDir, config, validatorProfile, assetName = null, engine = null) {
  if (off(process.env.FABLED_PIPELINE)) return null;
  const blenderFlag = (engine === 'native')
    ? 'none'
    : (engine === 'blender'
      ? (findBlender() || '/opt/homebrew/bin/blender')
      : (findBlender() || 'none'));

  if (process.env.FABLED_PIPELINE_CMD) {
    return ['sh', ['-c', fill(process.env.FABLED_PIPELINE_CMD, {
      input, profile, out: outDir, config, validator_profile: validatorProfile, blender: blenderFlag, engine: engine || (blenderFlag === 'none' ? 'native' : 'blender')
    })]];
  }
  if (exists(pipelinePy())) return [PY, [pipelinePy(), '--input', input, '--out', outDir, '--config', config,
    '--blender', blenderFlag,
    ...(assetName && pipelineTakesAssetName() ? ['--asset-name', assetName] : []),
    ...(validatorProfile && pipelineTakesValidatorProfile() ? ['--validator-profile', validatorProfile] : [])]];
  return null;
}
// manifest: path to <out>/manifest.json when known. Preferred when the validator supports --manifest.
function validatorCommand(asset, profile, manifest) {
  if (off(process.env.FABLED_VALIDATOR)) return null;
  if (process.env.FABLED_VALIDATOR_CMD) return ['sh', ['-c', fill(process.env.FABLED_VALIDATOR_CMD, { asset, profile, manifest })]];
  if (!exists(path.join(VALIDATOR_DIR, 'fabled_validator', '__main__.py'))) return null;
  if (manifest && validatorTakesManifest()) return [venvPython(), ['-m', 'fabled_validator', 'check', '--manifest', manifest, '--profile', profile, '--json-only']];
  if (!asset) return null;
  return [venvPython(), ['-m', 'fabled_validator', 'check', asset, '--profile', profile, '--json-only']];
}
const venvPython = () => { const v = path.join(VALIDATOR_DIR, '.venv', 'bin', 'python'); return exists(v) ? v : PY; };
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "''" : shq(vars[k])));

function status() {
  const blenderPath = findBlender();
  const p = pipelineCommand('IN', 'PROFILE', 'OUT', 'CONFIG', 'VALIDATOR_PROFILE', 'ASSET_NAME');
  const v = validatorCommand('ASSET', 'PROFILE');
  return {
    pipeline: { dir: PIPELINE_DIR, dir_exists: exists(PIPELINE_DIR), available: !!p, command_preview: p ? [p[0], ...p[1]].join(' ') : null,
      forced_off: off(process.env.FABLED_PIPELINE), supports_validator_profile: pipelineTakesValidatorProfile(), supports_asset_name: pipelineTakesAssetName(), frozen_run: frozenRun(), latest_output_manifest: exists(path.join(PIPELINE_DIR, 'output', 'manifest.json')),
      blender_path: blenderPath,
      engines: { blender: !!blenderPath, native: true } },
    validator: { dir: VALIDATOR_DIR, dir_exists: exists(VALIDATOR_DIR), available: !!v, command_preview: v ? [v[0], ...v[1]].join(' ') : null,
      forced_off: off(process.env.FABLED_VALIDATOR), supports_manifest: !!v && validatorTakesManifest() },
  };
}

const MANIFEST_NAME = process.env.FABLED_PIPELINE_MANIFEST || 'manifest.json';

// Translate the UI import profile into the pipeline's own config format
// (prototype/pipeline/config/default.json as observed on 2026-10-25), keeping every other default.
const UNIT_TO_M = { m: 1, cm: 0.01, mm: 0.001 };
// Translate the UI import profile into the validator's profile format
// (prototype/validator/fabled_validator/profile.py DEFAULTS as observed on 2026-10-25).
// exportMode = validating pipeline output (manifest / combined FBX): the pipeline already baked units and scale in
// and exports with its own up axis, so axes.up comes from the manifest's export_up_axis (default Z), import_scale
// stays 1.0, and units follow the manifest's unreal_units. Raw uploads get the UI's up axis, units and scale.
function profileToValidatorProfile(profile, { exportMode = false, manifest = null } = {}) {
  const [min, max] = profile.asset_class?.height_cm || [null, null];
  const exportUnits = manifest?.units?.unreal_units || 'cm';
  return {
    profile_name: profile.name || 'UI profile',
    asset_type: profile.asset_class?.id || 'character',
    units: exportMode
      ? { assumed_source_units: exportUnits, import_scale: 1.0, trust_file_units: true, expected_height_cm: { min, max } }
      : { assumed_source_units: profile.units || 'cm', import_scale: Number(profile.scale) > 0 ? Number(profile.scale) : 1.0, trust_file_units: true, expected_height_cm: { min, max } },
    axes: { up: exportMode ? String(manifest?.export_up_axis || 'Z').toUpperCase() : (profile.up_axis || 'Y') },
    lods: { triangle_budgets: (profile.lod_budget || []).map((l) => Math.round(l.max_triangles)) },
    texel_density: { target_px_per_cm: profile.texel_density?.px_per_m ? profile.texel_density.px_per_m / 100 : null },
    skeleton: { required: profile.skeleton?.type && profile.skeleton.type !== 'none', root_bone_name: null },
    normals: { max_flipped_faces: 0 },
    _ui_mode: exportMode ? 'pipeline output: export_up_axis from manifest, UI scale not re-applied' : 'raw upload: UI up axis / units / scale',
    _ui_profile: profile,
  };
}

async function profileToPipelineConfig(profile, opts = {}) {
  let base = {};
  try { base = JSON.parse(await fsp.readFile(path.join(PIPELINE_DIR, 'config', 'default.json'), 'utf8')); } catch { /* pipeline config not present */ }
  const cfg = structuredClone(base);
  if (opts.inputPath) cfg.asset_name = path.basename(opts.inputPath, path.extname(opts.inputPath)).replace(/[^A-Za-z0-9_]/g, '_') || cfg.asset_name;
  if (profile.units) cfg.source_units_to_m = (UNIT_TO_M[profile.units] ?? 1) * (Number(profile.scale) || 1);
  if (profile.asset_class?.height_cm) cfg.expected_height_cm_range = profile.asset_class.height_cm;
  if (Array.isArray(profile.lod_budget)) cfg.lods = profile.lod_budget.map((l) => ({ name: `LOD${l.level}`, target_tris: l.max_triangles, screen_size: l.screen_size }));
  if (profile.texel_density?.texture_size) cfg.bake = { ...(cfg.bake || {}), resolution: profile.texel_density.texture_size };
  cfg.fabled_profile = profile; // full UI profile (skeleton, texel density target, up axis) for steps that want it
  cfg._generated_by = 'prototype/ui/server.mjs from the UI import profile';
  return cfg;
}
async function listOutputFiles(dir) {
  const result = [];
  async function scan(current, relPrefix = '') {
    try {
      const entries = await fsp.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await scan(path.join(current, entry.name), rel);
        } else {
          result.push(rel);
        }
      }
    } catch {}
  }
  if (exists(dir)) {
    await scan(dir);
  }
  return result;
}

function run(cmd, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(extraEnv) });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); err += `\n[server] killed after ${CLI_TIMEOUT_MS} ms timeout`; }, CLI_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-200000); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-200000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// ---- helpers ----
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// Error text sent to a client never carries this machine's absolute paths: anything under fabled/ becomes a path
// relative to fabled/, and the home directory becomes ~. (Successful responses keep the documented absolute
// *_path / out_dir fields the UI and the Swift app read.)
const SCRUB_ROOTS = [...new Set([PROTO_DIR, (() => { try { return fs.realpathSync(PROTO_DIR); } catch { return PROTO_DIR; } })()])];
const HOME_DIR = os.homedir();
function scrub(msg) {
  let s = String(msg ?? '');
  for (const root of SCRUB_ROOTS) s = s.split(root + path.sep).join('').split(root).join('fabled');
  if (HOME_DIR && HOME_DIR.length > 1) s = s.split(HOME_DIR).join('~');
  return s.slice(0, 2000);
}
const relToProto = (p) => (p ? scrub(p) : p);

// ---- response hardening ----
// Sent on every response. No Access-Control-Allow-* header is ever emitted: this server has no cross-origin clients.
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' };
// For everything that is not the app's HTML (JSON, job files, uploads, samples): if a browser is navigated straight
// to it, it renders as an inert, sandboxed document. Subresource loads (fetch, <img>, module scripts) ignore it.
const INERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox";
// CSP for the app's HTML. The page has one inline <script type="importmap">; it is allowed by the sha256 of the bytes
// actually being served (hashes of every inline script in the file), so no 'unsafe-inline' for scripts.
// Inline style="" attributes need 'unsafe-inline' for styles. blob:/data: cover three.js textures and embedded glTF
// buffers; https: images and video are provider CDN outputs shown on generation pages.
function inlineScriptHashes(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const text = m[2].replace(/\r\n?/g, '\n'); // the HTML parser normalizes newlines before the browser hashes
    hashes.push(`'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`);
  }
  return hashes;
}
function htmlCsp(html) {
  let scriptSrc = null;
  try { scriptSrc = ["'self'", ...inlineScriptHashes(html)].join(' '); } catch { scriptSrc = null; }
  const rest = ["style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "media-src 'self' data: blob: https:",
    "connect-src 'self' data: blob:", "font-src 'self' data:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'"];
  // If the hashes cannot be computed, scripts are left unrestricted rather than breaking the app (no default-src
  // either, because it would apply to scripts); every other directive still holds.
  return (scriptSrc ? ["default-src 'self'", `script-src ${scriptSrc}`, ...rest] : rest).join('; ');
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': INERT_CSP });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
};
// One place turns a thrown error into a response; nothing a request does may take the process down.
function fail(req, res, e) {
  const status = e instanceof HttpError ? e.status : 400;
  if (res.headersSent) { res.destroy(); return; }
  if (status === 413) { // body not (fully) read: answer, discard what is still arriving, then drop the connection
    res.setHeader('Connection', 'close'); req.resume();
    res.once('finish', () => setTimeout(() => req.destroy(), 1000).unref());
  }
  try { send(res, status, { ok: false, error: scrub(e?.message || e) }); } catch { res.destroy(); }
}
const tooLarge = (limit) => new HttpError(413, `request body is over the ${limit} byte limit`);
const readBody = (req, limit = JSON_MAX_BYTES) => new Promise((resolve, reject) => {
  if (Number(req.headers['content-length']) > limit) return reject(tooLarge(limit));
  const chunks = []; let n = 0; let over = false;
  req.on('data', (c) => { if (over) return; n += c.length; if (n > limit) { over = true; chunks.length = 0; reject(tooLarge(limit)); } else chunks.push(c); });
  req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); }); req.on('error', reject);
});
// Streams an upload to disk (never buffered in memory), refusing more than `limit` bytes.
const receiveUpload = (req, dest, limit) => new Promise((resolve, reject) => {
  if (Number(req.headers['content-length']) > limit) return reject(tooLarge(limit));
  const out = fs.createWriteStream(dest, { flags: 'wx' });
  let n = 0; let settled = false;
  const done = (err) => { if (settled) return; settled = true; if (err) { req.unpipe(out); out.destroy(); reject(err); } else resolve(n); };
  req.on('data', (c) => { n += c.length; if (n > limit) done(tooLarge(limit)); });
  req.on('error', done); req.on('close', () => { if (!req.complete) done(new Error('upload interrupted')); });
  out.on('error', done); out.on('finish', () => done());
  req.pipe(out);
});

// ---- cross-site request guard ----
// Any website open in the user's browser can send requests to http://127.0.0.1:5178. Three checks stop it from using
// the API (uploads, pipeline runs, notes, paid AI generations):
//  1. Host allow-list (all routes): defeats DNS rebinding, where an attacker's hostname is re-pointed at this machine.
//     Bound to loopback (default): localhost, 127.0.0.1, [::1]. Bound elsewhere (HOST=0.0.0.0, the iPad/LAN mode):
//     also the bind address and every address of this machine's network interfaces. FABLED_ALLOWED_HOSTS
//     (comma-separated names) adds explicit extras, e.g. my-mac.local.
//  2. Origin (/api/*): browsers attach Origin to every cross-origin fetch and to every POST/PUT; if it is present it
//     must match the Host header (scheme-default ports considered). Sec-Fetch-Site, when a browser sends it, must be
//     same-origin or none; this also covers cross-site GETs (e.g. <img src>), which carry no Origin.
//     Native clients (the Swift app, curl, the Node tests) send neither header and pass.
//  3. Content-Type (JSON endpoints, see requireJson): a cross-site page cannot send application/json without a CORS
//     preflight, and this server never answers one.
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' };
function parseAuthority(value, scheme = 'http:') {
  if (typeof value !== 'string' || !value || value.length > 300 || /[\s/\\?#@]/.test(value)) return null;
  try {
    const u = new URL(`${scheme}//${value}`);
    const hostname = u.hostname.toLowerCase().replace(/\.$/, '');
    return hostname ? { hostname, port: u.port || DEFAULT_PORT[scheme] } : null;
  } catch { return null; }
}
const hostName = (v) => { const t = String(v || '').trim().split('%')[0]; return parseAuthority(net.isIPv6(t) ? `[${t}]` : t)?.hostname || null; };
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];
const BIND_NAME = hostName(HOST);
const BIND_IS_LOOPBACK = BIND_NAME === 'localhost' || BIND_NAME === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(BIND_NAME || '');
const EXTRA_HOSTS = (process.env.FABLED_ALLOWED_HOSTS || '').split(',').map(hostName).filter(Boolean);
let hostCache = null;
function allowedHostnames() {
  if (hostCache && Date.now() - hostCache.t < 5000) return hostCache.set;
  const set = new Set([...LOOPBACK_NAMES, ...EXTRA_HOSTS]);
  if (BIND_NAME) set.add(BIND_NAME);
  if (!BIND_IS_LOOPBACK) {
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) { const n = hostName(a.address); if (n) set.add(n); }
  }
  hostCache = { t: Date.now(), set };
  return set;
}
// Returns the reason to refuse the request, or null. Marks requests a browser proved to be same-origin.
function crossSiteRefusal(req, isApi) {
  const host = parseAuthority(req.headers.host);
  if (!host || !allowedHostnames().has(host.hostname)) {
    return 'Host header is not an address of this server; open it by its own address, or list the name in FABLED_ALLOWED_HOSTS';
  }
  if (!isApi) return null;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let o = null; try { o = new URL(origin); } catch { /* "null" and garbage are foreign */ }
    const h = o && DEFAULT_PORT[o.protocol] ? parseAuthority(req.headers.host, o.protocol) : null;
    if (!h || h.hostname !== o.hostname.toLowerCase().replace(/\.$/, '') || h.port !== (o.port || DEFAULT_PORT[o.protocol])) {
      return 'cross-origin request refused: the Origin header does not match this server';
    }
    req.fabledSameOrigin = true;
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined) {
    if (site === 'same-origin') req.fabledSameOrigin = true;
    else if (site !== 'none') return 'cross-site request refused';
  }
  return null;
}
const mediaType = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
// State-changing JSON endpoints (process, validate, notes, generations) require Content-Type: application/json.
// One exception: public/app.js and public/workspace.js post JSON strings with no Content-Type header, which a browser
// labels text/plain. That is accepted only when the browser has proved the request is same-origin (Origin matching
// Host, or Sec-Fetch-Site: same-origin; a page cannot forge either). Without that proof text/plain gets 415, which is
// what a cross-site <form enctype="text/plain"> from a browser too old to send Origin would look like.
function requireJson(req) {
  const type = mediaType(req);
  if (type === 'application/json' || (type === 'text/plain' && req.fabledSameOrigin)) return;
  throw new HttpError(415, 'Content-Type must be application/json');
}
async function readJsonObject(req, limit = JSON_MAX_BYTES) {
  requireJson(req);
  let v; try { v = JSON.parse((await readBody(req, limit)).toString('utf8') || '{}'); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'body must be JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'body must be a JSON object');
  return v;
}

// Upload file names come from ?filename=. Only [A-Za-z0-9_.-] survives, no leading dots, bounded length, and never one
// of the names the server itself writes into the job folder (an upload called validator_report.json would otherwise
// be read back as the job's validator result).
const RESERVED_JOB_FILES = /^(job\.json.*|profile\.json|pipeline_config\.json|validator_profile(_export)?\.json|validator_report\.json|out)$/i;
function safeUploadName(raw) {
  let name = path.basename(String(raw || '')).replace(/[^\w.\-]/g, '_').replace(/^\.+/, '');
  if (name.length > 120) { const ext = path.extname(name).slice(0, 16); name = name.slice(0, 120 - ext.length) + ext; }
  if (!name) name = 'upload.bin';
  return RESERVED_JOB_FILES.test(name) ? `upload_${name}` : name;
}

const jobDir = (id) => { if (typeof id !== 'string' || !/^[a-z0-9-]{8,40}$/.test(id)) throw new HttpError(400, 'bad job id'); return path.join(WORK_DIR, id); };
const safeJoin = (root, rel) => { const p = path.resolve(root, rel); if (p !== root && !p.startsWith(root + path.sep)) throw new HttpError(400, 'path escapes root'); return p; };
// api: the file comes from a job folder (uploads, pipeline output), i.e. it is not part of the app. HTML and scripts
// from there are served as plain text so an uploaded page can never run in this origin.
async function serveFile(res, file, { api = false } = {}) {
  try {
    const st = await fsp.stat(file); if (!st.isFile()) throw 0;
    const ext = path.extname(file).toLowerCase();
    let type = MIME[ext] || 'application/octet-stream';
    if (!api && ext === '.html') {
      const html = await fsp.readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': html.length, 'Cache-Control': 'no-store', 'Content-Security-Policy': htmlCsp(html.toString('utf8')) });
      return res.end(html);
    }
    if (api && /^text\/(html|javascript)/.test(type)) type = 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store', 'Content-Security-Policy': INERT_CSP });
    if (st.size === 0) return res.end();
    // Exactly the bytes promised in Content-Length, even if the file is still being written by the pipeline.
    const stream = fs.createReadStream(file, { start: 0, end: st.size - 1 });
    stream.on('error', () => res.destroy()); // e.g. the file vanished after stat; never an unhandled 'error'
    stream.pipe(res);
  } catch { send(res, 404, { error: 'not found' }); }
}
const loadStub = async (name) => JSON.parse(await fsp.readFile(path.join(UI_DIR, 'stub', name), 'utf8'));

// ---- jobs ----
const RUNS = new Map(); // job_id -> { running, code, out, err, started_at, finished_at }
const newId = () => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const readJob = async (dir) => {
  for (let i = 0; i < 10; i++) {
    try {
      const text = await fsp.readFile(path.join(dir, 'job.json'), 'utf8');
      if (text) return JSON.parse(text);
    } catch (e) {
      if (i === 9) throw e;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
};
const writeJob = async (dir, job) => {
  const tmp = path.join(dir, `job.json.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`);
  await fsp.writeFile(tmp, JSON.stringify(job, null, 2));
  await fsp.rename(tmp, path.join(dir, 'job.json'));
};
const readJsonIf = async (p) => { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; } };
const inside = (root, p) => p === root || p.startsWith(root + path.sep);
// Same containment test after resolving symlinks, so a link inside a served folder cannot point out of it.
const realInside = (root, p) => { try { return inside(fs.realpathSync(root), fs.realpathSync(p)); } catch { return false; } };
// Manifest paths are relative to the manifest's directory = <out> (locked contract). Absolute paths are accepted only if inside <out>.
const resolveOut = (outDir, rel) => { if (!rel) return null; const p = path.resolve(outDir, rel); return inside(outDir, p) ? p : null; };
function exportAsset(manifest, outDir) {
  const p = resolveOut(outDir, manifest?.combined_fbx ?? manifest?.outputs?.combined_fbx);
  return p && exists(p) ? p : null;
}
// Read-only "open an existing output folder": the pipeline's default output, or a test fixture folder.
const OPEN_ROOTS = [path.join(PIPELINE_DIR, 'output'), path.join(PIPELINE_DIR, 'runs'), path.join(UI_DIR, 'test_fixtures')];
// Newest frozen run (pipeline --freeze): runs/latest -> runs/<timestamp>; returned as the timestamped folder, never "latest".
function frozenRun() {
  try { const real = fs.realpathSync(path.join(PIPELINE_DIR, 'runs', 'latest')); return exists(path.join(real, 'manifest.json')) ? path.relative(PROTO_DIR, real) : null; } catch { return null; }
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (req.method === 'GET' && parts[1] === 'status') return send(res, 200, status());

  // POST /api/jobs?filename=foo.glb  (raw file body) -> { job_id }
  // Content-Type rule: none. The body is the mesh itself; public/app.js sends an ArrayBuffer (no Content-Type header at
  // all), the Node tools send strings (text/plain), curl --data-binary says application/x-www-form-urlencoded (the
  // Swift client has no upload call today; URLSession would send no type or octet-stream), and none of that can be
  // told apart from what a cross-site <form> could send. So this route relies on the Origin / Sec-Fetch-Site check
  // (every current browser sends Origin on a cross-site POST, form or fetch) and on the fact that an upload is
  // inert: it is stored under a sanitized name and only ever served back as a sandboxed, non-HTML file.
  // multipart/form-data is refused because a form-wrapped body is never a valid mesh.
  if (req.method === 'POST' && parts[1] === 'jobs' && parts.length === 2) {
    if (mediaType(req) === 'multipart/form-data') throw new HttpError(415, 'send the raw file bytes as the request body, not multipart/form-data');
    const filename = safeUploadName(url.searchParams.get('filename'));
    const id = newId(); const dir = jobDir(id); await fsp.mkdir(path.join(dir, 'out'), { recursive: true });
    const input = path.join(dir, filename);
    try { await receiveUpload(req, input, UPLOAD_MAX_BYTES); } catch (e) { await fsp.rm(dir, { recursive: true, force: true }); throw e; }
    await writeJob(dir, { job_id: id, input, out_dir: path.join(dir, 'out'), readonly: false, created_at: new Date().toISOString(), asset_id: `job:${id}` });
    await activity.add({ type: 'uploaded', asset_id: `job:${id}`, message: `Uploaded ${filename}` });
    return send(res, 200, { job_id: id, input_path: input, asset_id: `job:${id}` });
  }

  // GET /api/saved-reports -> validator reports already on disk (validator/reports/**/*.report.json), read-only
  if (req.method === 'GET' && parts[1] === 'saved-reports') {
    const root = path.join(VALIDATOR_DIR, 'reports'); const found = [];
    const walk = (d, depth) => { if (depth > 4 || !exists(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name); if (e.isDirectory()) walk(f, depth + 1); else if (e.name.endsWith('.report.json')) found.push({ rel: path.relative(root, f), mtime: fs.statSync(f).mtimeMs }); } };
    walk(root, 0); found.sort((a, b) => b.mtime - a.mtime);
    return send(res, 200, { root, reports: found });
  }
  // GET /api/saved-report?path=<relative to validator/reports>
  if (req.method === 'GET' && parts[1] === 'saved-report') {
    const root = path.join(VALIDATOR_DIR, 'reports'); const f = path.resolve(root, url.searchParams.get('path') || '');
    if (!inside(root, f) || !f.endsWith('.report.json') || !exists(f) || !realInside(root, f)) return send(res, 200, { ok: false, error: 'report not found under validator/reports' });
    return send(res, 200, { ok: true, source: 'validator_saved', report_path: f, report: JSON.parse(await fsp.readFile(f, 'utf8')) });
  }

  // POST /api/open-output?dir=<path>  -> read-only job over an existing pipeline output folder
  if (req.method === 'POST' && parts[1] === 'open-output') {
    const asked = url.searchParams.get('dir') || 'pipeline/output';
    const want = path.resolve(PROTO_DIR, asked);
    // The error echoes what was asked for, never the resolved absolute path.
    if (asked.includes('\0') || !OPEN_ROOTS.some((r) => inside(r, want) && (!exists(want) || realInside(r, want)))) return send(res, 200, { ok: false, error: `not an allowed output folder: ${asked.slice(0, 200)}` });
    const mPath = path.join(want, MANIFEST_NAME);
    const manifest = await readJsonIf(mPath);
    if (!manifest) return send(res, 200, { ok: false, error: `no readable ${MANIFEST_NAME} in ${relToProto(want)}` });
    const id = newId(); const dir = jobDir(id); await fsp.mkdir(dir, { recursive: true });
    let realWant = want; try { realWant = fs.realpathSync(want); } catch { /* keep */ }
    const assetId = `run:${path.relative(PROTO_DIR, realWant)}`;
    const job = { job_id: id, input: null, out_dir: want, readonly: true, manifest: mPath, export_asset: exportAsset(manifest, want), asset_id: assetId };
    await writeJob(dir, job);
    // The profile the validator will use for this read-only job (same rule as /validate), so the UI can show it.
    const demoProp = path.join(VALIDATOR_DIR, 'profiles', 'demo_placeholder_prop.json');
    const vprof = exists(demoProp) && !off(process.env.FABLED_USE_DEMO_PROP_PROFILE) ? { path: demoProp, content: await readJsonIf(demoProp) } : null;
    return send(res, 200, { ok: true, source: 'pipeline_output', job_id: id, asset_id: assetId, out_dir: want, manifest, manifest_path: mPath, export_asset: job.export_asset, validator_profile: vprof });
  }

  // ---- connected workspace ----
  if (req.method === 'GET' && parts[1] === 'workspace' && parts.length === 2) {
    const ws = buildWorkspace({ protoDir: PROTO_DIR, pipelineDir: PIPELINE_DIR, uiDir: UI_DIR, workDir: WORK_DIR, runs: RUNS, tasks: generations.list() });
    const allNotes = notes.all();
    for (const g of ws.groups) for (const a of g.assets) a.has_note = !!allNotes[a.id];
    return send(res, 200, ws);
  }
  if (parts[1] === 'workspace' && parts[2] === 'notes') {
    const assetId = url.searchParams.get('asset') || '';
    if (!validAssetId(assetId)) return send(res, 400, { ok: false, error: 'bad or missing ?asset=' });
    if (req.method === 'GET') return send(res, 200, { ok: true, asset_id: assetId, note: notes.get(assetId) });
    if (req.method === 'PUT') {
      const body = await readJsonObject(req, NOTE_BODY_MAX_BYTES);
      const before = notes.get(assetId);
      let note; try { note = await notes.set(assetId, body.text); } catch (e) { throw e?.code === 'FABLED_NOTES_FULL' ? new HttpError(507, e.message) : e; }
      if (!before || !note) await activity.add({ type: 'note', asset_id: assetId, message: note ? 'Page notes started' : 'Page notes cleared' });
      return send(res, 200, { ok: true, asset_id: assetId, note });
    }
  }
  if (req.method === 'GET' && parts[1] === 'activity') {
    const assetId = url.searchParams.get('asset');
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
    return send(res, 200, { ok: true, events: activity.list({ assetId: assetId && validAssetId(assetId) ? assetId : null, limit }) });
  }

  // ---- AI provider plugins ----
  if (req.method === 'GET' && parts[1] === 'providers' && parts.length === 2) {
    return send(res, 200, { ok: true, kinds: KIND_LABELS, providers: listProviders(), generations: generations.list() });
  }
  // POST /api/providers/:id/generations  {kind, prompt, image: {job_id, rel} | {data_uri} | {url}, source_asset_id}
  if (req.method === 'POST' && parts[1] === 'providers' && parts[2] && parts[3] === 'generations') {
    if (!getProvider(parts[2])) return send(res, 404, { ok: false, error: `unknown provider ${parts[2]}` });
    const body = await readJsonObject(req, GENERATION_BODY_MAX_BYTES);
    let image = null; let imageLabel = null;
    try {
      if (body.image?.job_id && body.image?.rel) {
        const jd = jobDir(String(body.image.job_id)); const j = await readJob(jd);
        const imgRoot = j.out_dir || path.join(jd, 'out');
        const f = resolveOut(imgRoot, String(body.image.rel));
        const mime = f && IMAGE_MIME[path.extname(f).toLowerCase()];
        if (!f || !mime || !exists(f) || !realInside(imgRoot, f)) throw new Error('image must be a .png/.jpg/.webp inside that job\'s output folder');
        const buf = await fsp.readFile(f);
        if (buf.length > IMAGE_MAX_BYTES) throw new Error(`image is over ${IMAGE_MAX_BYTES} bytes`);
        image = { data_uri: `data:${mime};base64,${buf.toString('base64')}` }; imageLabel = path.basename(f);
      } else if (typeof body.image?.data_uri === 'string') {
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(body.image.data_uri)) throw new Error('data_uri must be a base64 PNG, JPEG or WebP');
        image = { data_uri: body.image.data_uri }; imageLabel = String(body.image.label || 'uploaded image').slice(0, 120);
      } else if (typeof body.image?.url === 'string') {
        if (!/^https:\/\//.test(body.image.url)) throw new Error('image url must be https');
        image = { url: body.image.url }; imageLabel = body.image.url.split('/').pop().slice(0, 120);
      }
      const task = await generations.create(parts[2], { kind: body.kind, prompt: body.prompt, image, image_label: imageLabel,
        source_asset_id: validAssetId(body.source_asset_id) ? body.source_asset_id : null });
      return send(res, 200, { ok: true, generation: task });
    } catch (e) { return send(res, 200, { ok: false, error: scrub(e.message || e) }); }
  }
  if (parts[1] === 'generations' && parts[2]) {
    const t = generations.raw(parts[2]);
    if (!t) return send(res, 404, { ok: false, error: 'unknown generation' });
    if (req.method === 'GET' && parts.length === 3) return send(res, 200, { ok: true, generation: await generations.refresh(parts[2]) });
    // POST /api/generations/:id/import -> download the mesh into a new upload job, ready for the pipeline
    if (req.method === 'POST' && parts[3] === 'import') {
      await generations.refresh(parts[2]);
      if (t.status !== 'succeeded') return send(res, 200, { ok: false, error: `generation is ${t.status}, not succeeded` });
      if (t.imported_job_id && exists(jobDir(t.imported_job_id))) return send(res, 200, { ok: true, already_imported: true, job_id: t.imported_job_id, asset_id: `job:${t.imported_job_id}`, filename: path.basename((await readJob(jobDir(t.imported_job_id))).input) });
      const id = newId(); const dir = jobDir(id); await fsp.mkdir(path.join(dir, 'out'), { recursive: true });
      try {
        const input = await downloadModel(t, dir, { localRoots: [path.join(UI_DIR, 'samples')] });
        const provenance = { provider: t.provider, provider_name: t.provider_name, kind: t.kind, task_id: t.id, prompt: t.prompt, image_label: t.image_label, source_asset_id: t.source_asset_id, concept_mockup: !!t.concept_mockup };
        await writeJob(dir, { job_id: id, input, out_dir: path.join(dir, 'out'), readonly: false, created_at: new Date().toISOString(), asset_id: `job:${id}`, provenance });
        await generations.markImported(t.id, id);
        await activity.add({ type: 'generation_imported', asset_id: `job:${id}`, message: `Imported ${t.provider_name} ${t.kind} result as sculpt ${path.basename(input)}${t.concept_mockup ? ' (CONCEPT MOCKUP)' : ''}`, concept_mockup: !!t.concept_mockup });
        return send(res, 200, { ok: true, job_id: id, asset_id: `job:${id}`, filename: path.basename(input) });
      } catch (e) {
        await fsp.rm(dir, { recursive: true, force: true });
        return send(res, 200, { ok: false, error: scrub(e.message || e) });
      }
    }
  }

  if (parts[1] === 'jobs' && parts[2]) {
    const id = parts[2]; const dir = jobDir(id);
    if (!exists(dir)) return send(res, 404, { error: 'unknown job' });
    let job; try { job = await readJob(dir); } catch { job = null; }
    if (!job || typeof job !== 'object') return send(res, 404, { error: 'unknown job' });
    const outDir = job.out_dir || path.join(dir, 'out');

    // POST /api/jobs/:id/process  body = profile JSON
    //   stub     -> { ok, source:'stub', manifest }
    //   pipeline -> { ok, source:'pipeline', started:true }  then poll /progress and /result
    if (req.method === 'POST' && parts[3] === 'process') {
      requireJson(req);
      if (job.readonly || !job.input) return send(res, 200, { ok: false, error: 'read-only job (opened output folder); upload a sculpt to run the pipeline' });
      if (RUNS.get(id)?.running) return send(res, 200, { ok: true, source: 'pipeline', started: true, already_running: true });
      // Claimed before the first await, so two quick requests cannot both start a pipeline for the same job.
      const st = { running: true, code: null, out: '', err: '', started_at: new Date().toISOString() }; RUNS.set(id, st);
      let launched = false;
      try {
        const body = await readJsonObject(req);
        const asked = body.engine || body.profile?.engine || process.env.FABLED_ENGINE || null;
        const engine = asked === 'native' || asked === 'blender' ? asked : null; // anything else: auto-detect
        const profile = (body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile)) ? body.profile : body;
        const profilePath = path.join(dir, 'profile.json');
        await fsp.writeFile(profilePath, JSON.stringify(profile, null, 2));
        const configPath = path.join(dir, 'pipeline_config.json');
        await fsp.writeFile(configPath, JSON.stringify(await profileToPipelineConfig(profile, { inputPath: job.input }), null, 2));
        const vProfilePath = path.join(dir, 'validator_profile.json');
        await fsp.writeFile(vProfilePath, JSON.stringify(profileToValidatorProfile(profile, { exportMode: true }), null, 2));
        const assetName = path.basename(job.input, path.extname(job.input)).replace(/[^A-Za-z0-9_]/g, '_') || null; // also kept in config.asset_name
        const cmd = pipelineCommand(job.input, profilePath, outDir, configPath, vProfilePath, assetName, engine);
        if (!cmd) {
          const m = await loadStub('manifest.CONCEPT_MOCKUP.json');
          m.job_id = id; m.input.sculpt_path = job.input; m.input.format = path.extname(job.input).slice(1).toLowerCase(); m.profile = profile;
          m.outputs.lods = (Array.isArray(profile.lod_budget) ? profile.lod_budget : []).map((l) => ({ level: l.level, path: null, format: null, triangles: null, vertices: null,
            budget_triangles: l.max_triangles ?? null, screen_size: l.screen_size ?? null, has_uvs: null }));
          return send(res, 200, { ok: true, source: 'stub', manifest: m });
        }
        job.engine = engine || (cmd[1].includes('none') ? 'native' : 'blender');
        await writeJob(dir, job);
        for (const f of [MANIFEST_NAME, 'progress.json']) { try { await fsp.unlink(path.join(outDir, f)); } catch { /* fresh */ } }
        const jobAssetId = job.asset_id || `job:${id}`;
        await activity.add({ type: 'pipeline_started', asset_id: jobAssetId, message: `Pipeline started (${job.engine === 'native' ? 'Native Python/NumPy' : 'Headless Blender'})` });
        launched = true;
        run(cmd[0], cmd[1], PIPELINE_DIR).then(async (r) => {
          Object.assign(st, { running: false, code: r.code, out: r.out, err: r.err, finished_at: new Date().toISOString() });
          const m = await readJsonIf(path.join(outDir, MANIFEST_NAME));
          await activity.add({ type: r.code === 0 ? 'pipeline_finished' : 'pipeline_failed', asset_id: jobAssetId,
            message: `Pipeline ${r.code === 0 ? 'finished' : `failed (exit ${r.code})`}${m ? `: manifest status ${m.status}` : '; no manifest'}` });
        }).catch(() => { st.running = false; });
        return send(res, 200, { ok: true, source: 'pipeline', started: true, engine: job.engine });
      } finally { if (!launched && RUNS.get(id) === st) RUNS.delete(id); }
    }

    // GET /api/jobs/:id/progress -> { running, exit_code, progress: <out>/progress.json | null }
    if (req.method === 'GET' && parts[3] === 'progress') {
      const st = RUNS.get(id);
      return send(res, 200, { running: !!st?.running, exit_code: st?.code ?? null, progress: await readJsonIf(path.join(outDir, 'progress.json')) });
    }

    // GET /api/jobs/:id/result -> manifest whenever it exists, even after a non-zero exit (failed runs write one too)
    if (req.method === 'GET' && parts[3] === 'result') {
      const st = RUNS.get(id);
      if (st?.running) return send(res, 200, { ok: false, running: true });
      const mPath = path.join(outDir, MANIFEST_NAME);
      const manifest = await readJsonIf(mPath);
      const stdoutTail = (st?.out || '').slice(-6000);
      const stderrTail = (st?.err || '').slice(-6000);
      const tail = { stdout: stdoutTail, stderr: stderrTail, stdout_tail: stdoutTail, stderr_tail: stderrTail };
      const outputFiles = await listOutputFiles(outDir);
      if (!manifest) return send(res, 200, { ok: false, source: 'pipeline', exit_code: st?.code ?? null, error: `pipeline exited ${st?.code ?? '?'}; no ${MANIFEST_NAME} in ${relToProto(outDir)}`, outputs: outputFiles, output_files: outputFiles, ...tail });
      job.manifest = mPath; job.export_asset = exportAsset(manifest, outDir); await writeJob(dir, job);
      return send(res, 200, { ok: true, source: 'pipeline', exit_code: st?.code ?? null, failed: (st?.code ?? 0) !== 0, manifest, manifest_path: mPath, export_asset: job.export_asset, outputs: manifest.outputs || outputFiles, output_files: outputFiles, ...tail });
    }

    // POST /api/jobs/:id/validate  body = profile JSON -> { ok, source, report, exit_code, asset }
    if (req.method === 'POST' && parts[3] === 'validate') {
      const profile = await readJsonObject(req);
      await fsp.writeFile(path.join(dir, 'profile.json'), JSON.stringify(profile, null, 2));
      let manifestPath = job.manifest && exists(job.manifest) ? job.manifest : null;
      if (!manifestPath) {
        const candidate = path.join(outDir, MANIFEST_NAME);
        if (exists(candidate)) {
          manifestPath = candidate;
          job.manifest = candidate;
        }
      }
      const manifest = manifestPath ? await readJsonIf(manifestPath) : null;
      if (!job.export_asset && manifest) {
        job.export_asset = exportAsset(manifest, outDir);
        await writeJob(dir, job);
      }
      const asset = job.export_asset || job.input; // pipeline's combined FBX when it exists, else the uploaded sculpt
      const exportMode = !!(manifestPath || job.export_asset);
      let vProfilePath = path.join(dir, exportMode ? 'validator_profile_export.json' : 'validator_profile.json');
      await fsp.writeFile(vProfilePath, JSON.stringify(profileToValidatorProfile(profile, { exportMode, manifest }), null, 2));
      // Opened pipeline output (the bust): use the validator team's static-prop placeholder profile when present.
      const demoProp = path.join(VALIDATOR_DIR, 'profiles', 'demo_placeholder_prop.json');
      if (job.readonly && exists(demoProp) && !off(process.env.FABLED_USE_DEMO_PROP_PROFILE)) vProfilePath = demoProp;
      const cmd = validatorCommand(asset, vProfilePath, manifestPath);
      const target = cmd && cmd[1].includes('--manifest') ? { kind: 'manifest', path: manifestPath } : { kind: asset === job.export_asset ? 'combined_fbx' : 'uploaded_sculpt', path: asset };
      if (!cmd) { const r = await loadStub('validator_report.CONCEPT_MOCKUP.json'); r.profile_name = profile.name ?? null; return send(res, 200, { ok: true, source: 'stub', report: r }); }
      const validatorEnv = {
        PYTHONPATH: process.env.PYTHONPATH ? `${VALIDATOR_DIR}:${process.env.PYTHONPATH}` : VALIDATOR_DIR
      };
      const r = await run(cmd[0], cmd[1], VALIDATOR_DIR, validatorEnv);
      let report = null; try { report = JSON.parse(r.out); } catch { /* not JSON */ }
      // exit 0/1/2 are all normal; 2 still prints a report with overall_status "error".
      if (!report || typeof report !== 'object') return send(res, 200, { ok: false, source: 'validator', exit_code: r.code, target, error: `validator exited ${r.code} without a JSON report on stdout`, stdout: r.out.slice(-4000), stderr: r.err.slice(-4000) });
      const reportPath = path.join(dir, 'validator_report.json'); // job folder, never the (possibly read-only) output folder
      await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
      const profileUsedContent = await readJsonIf(vProfilePath);
      const s = report.summary || {};
      await activity.add({ type: 'validator_run', asset_id: job.asset_id || `job:${id}`,
        message: `Validator ${String(report.overall_status || 'n/a').toUpperCase()} on ${target.kind.replace('_', ' ')}${s.total != null ? ` (${s.pass ?? 0} pass / ${s.warn ?? 0} warn / ${s.fail ?? 0} fail / ${s.not_checked ?? 0} not checked)` : ''}` });
      return send(res, 200, { ok: true, source: 'validator', exit_code: r.code, target, profile_used: vProfilePath, profile_used_content: profileUsedContent, report, report_path: reportPath, stderr: r.err.slice(-2000) });
    }

    // GET /api/jobs/:id/input -> the uploaded sculpt (to reopen an upload from the workspace tree)
    if (req.method === 'GET' && parts[3] === 'input') {
      if (!job.input) return send(res, 404, { error: 'read-only job has no uploaded input' });
      return serveFile(res, path.join(dir, path.basename(job.input)), { api: true });
    }

    // GET /api/jobs/:id/files/<path relative to <out>>
    if (req.method === 'GET' && parts[3] === 'files') {
      const rel = decodeURIComponent(url.pathname.split('/files/')[1] || '');
      const file = resolveOut(outDir, rel);
      if (!file || !exists(file) || !realInside(outDir, file)) return send(res, 404, { error: 'file not found inside the output folder', rel: rel.slice(0, 300) });
      return serveFile(res, file, { api: true });
    }
  }
  send(res, 404, { error: 'unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
  try {
    for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
    // Parsed inside the try, against a fixed base: a malformed Host header or request target is a 400, not a crash.
    let url; try { if (!req.url.startsWith('/')) throw 0; url = new URL(req.url.replace(/^\/+/, '/'), 'http://localhost'); } catch { return send(res, 400, { ok: false, error: 'bad request target' }); }
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const refusal = crossSiteRefusal(req, isApi);
    if (refusal) return send(res, 403, { ok: false, error: refusal });
    if (isApi) return await api(req, res, url);
    if (url.pathname.startsWith('/vendor/three/')) return await serveFile(res, safeJoin(path.join(UI_DIR, 'node_modules', 'three'), decodeURIComponent(url.pathname.slice('/vendor/three/'.length))));
    // ?demo=1 on the local server reads the same prebuilt files as the static build (npm run build:demo)
    if (url.pathname.startsWith('/demo-data/')) return await serveFile(res, safeJoin(path.join(UI_DIR, 'dist', 'demo-data'), decodeURIComponent(url.pathname.slice('/demo-data/'.length))));
    if (url.pathname.startsWith('/samples/')) return await serveFile(res, safeJoin(path.join(UI_DIR, 'samples'), decodeURIComponent(url.pathname.slice('/samples/'.length))));
    if (url.pathname.startsWith('/stub/')) return await serveFile(res, safeJoin(path.join(UI_DIR, 'stub'), decodeURIComponent(url.pathname.slice('/stub/'.length))));
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    return await serveFile(res, safeJoin(path.join(UI_DIR, 'public'), rel));
  } catch (e) { fail(req, res, e); }
});
server.listen(PORT, HOST, () => {
  const s = status();
  console.log(`Fabled demo UI: http://${HOST}:${PORT}/`);
  if (!BIND_IS_LOOPBACK) console.log(`  LAN mode  : reachable from other devices on this network; accepted Host names = this machine's addresses${EXTRA_HOSTS.length ? ` + ${EXTRA_HOSTS.join(', ')}` : ''} (FABLED_ALLOWED_HOSTS adds names)`);
  console.log(`  pipeline : ${s.pipeline.available ? s.pipeline.command_preview : 'not found -> CONCEPT MOCKUP stub'}`);
  console.log(`  validator: ${s.validator.available ? s.validator.command_preview : 'not found -> CONCEPT MOCKUP stub'}`);
});
