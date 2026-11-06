// Build a static, backend-free demo of the UI into dist/ (Vercel-ready; nothing is deployed by this script).
//   node tools/build_demo.mjs [--src <frozen run dir>] [--report <validator report.json>] [--profile <validator profile.json>] [--out dist]
// --src     default: ../pipeline/runs/latest (the pipeline's frozen-run pointer), resolved to the real folder
// --report  a real fabled_validator report for that run; if omitted, the validator CLI (Python, no Blender) is run once on
//           <src>/manifest.json with --profile, and its JSON is saved. The demo never runs the validator in the browser.
// --profile default: ../validator/profiles/demo_placeholder_prop.json (DEMO PLACEHOLDER VALUES, labeled as such in the UI)
// Copies: manifest.json, the LOD GLBs (FBX only for a LOD without GLB), textures, previews, the report and the profile,
// plus public/ and the three.js modules the app imports. Fails if samples, test fixtures, stub/mockup data or .blend files
// would be bundled, or if the manifest/report is marked concept_mockup/test_fixture.
import fs from 'node:fs'; import { stripGlbImages } from './strip_glb.mjs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const PROTO = path.dirname(UI);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SRC = fs.realpathSync(path.resolve(arg('src', path.join(PROTO, 'pipeline', 'runs', 'latest'))));
const OUT = path.resolve(UI, arg('out', 'dist')); const DATA = path.join(OUT, 'demo-data');
// Report: --report > the Validator SWE's independent report validator/reports/frozen_<run>/*.report.json (read fresh at
// every build, never cached) > running the validator CLI once. Profile: --profile > the profile file the report names > demo prop.
const indepDir = path.join(PROTO, 'validator', 'reports', `frozen_${path.basename(SRC)}`);
const indep = fs.existsSync(indepDir) ? fs.readdirSync(indepDir).filter((f) => f.endsWith('.report.json')).map((f) => path.join(indepDir, f)) : [];
if (!arg('report', null) && indep.length > 1) die(`several reports in ${indepDir}; pass --report`);
const REPORT = arg('report', null) || indep[0] || null;
const reportPeek = REPORT ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : null;
const PROFILE = path.resolve(arg('profile', reportPeek?.profile?.path && fs.existsSync(reportPeek.profile.path) ? reportPeek.profile.path : path.join(PROTO, 'validator', 'profiles', 'demo_placeholder_prop.json')));
const die = (m) => { console.error(`build:demo FAILED: ${m}`); process.exit(1); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

// ---- read + sanity-check the run
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
if (manifest.concept_mockup === true || manifest.test_fixture === true) die('manifest is marked concept_mockup/test_fixture');
if (manifest.status !== 'ok') die(`manifest status is "${manifest.status}", not ok`);
const isFrozen = /\/pipeline\/runs\//.test(SRC);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });

// ---- run data (paths stay relative to the manifest, so the manifest is copied unchanged)
const rels = new Set(['manifest.json']);
const lodsBy = new Map(); for (const l of [...(manifest.lods || []), ...(manifest.outputs?.lods || [])]) lodsBy.set(l.level, { ...(lodsBy.get(l.level) || {}), ...l });
for (const l of lodsBy.values()) rels.add(l.glb || l.path);
const tex = Array.isArray(manifest.textures) ? manifest.textures : [manifest.textures || {}];
for (const t of tex) for (const k of ['base_color', 'normal', 'orm']) if (typeof t[k] === 'string') rels.add(t[k]);
for (const p of manifest.outputs?.previews || manifest.previews || []) if (p?.path) rels.add(p.path);
for (const r of ['SOURCE.json']) if (fs.existsSync(path.join(SRC, r))) rels.add(r);
// Downsizing (approved): LOD GLBs ship with embedded images stripped (geometry unchanged); the normal/ORM maps ship once as
// bit-exact WebP lossless display copies taken from the GLB (OpenGL normal convention). The full-resolution export PNGs stay
// in the run folder and are not bundled. The run folder is only read; derived files go to dist/ (and .build-cache/).
const texRels = new Set(); for (const t of tex) for (const k of ['normal', 'orm', 'base_color']) if (typeof t[k] === 'string') texRels.add(t[k]);
const derived = []; let imageSha = null; let glbForTextures = null;
for (const r of rels) {
  const f = path.resolve(SRC, r); if (!f.startsWith(SRC + path.sep)) die(`path escapes the run folder: ${r}`); if (!fs.existsSync(f)) die(`missing in run: ${r}`);
  if (texRels.has(r)) continue; // replaced by display copies below
  if (r.endsWith('.glb')) {
    const st = stripGlbImages(fs.readFileSync(f)); fs.mkdirSync(path.dirname(path.join(DATA, r)), { recursive: true }); fs.writeFileSync(path.join(DATA, r), st.glb);
    if (st.imageSha.length) { if (imageSha && JSON.stringify(imageSha) !== JSON.stringify(st.imageSha)) die(`LOD GLBs embed different textures (${r}); per-LOD display copies not implemented`); imageSha = st.imageSha; glbForTextures ||= f; }
    derived.push({ path: r, kind: 'glb_embedded_images_removed', source_bytes: fs.statSync(f).size, bytes: st.glb.length, removed_images: st.removedImages });
  } else copy(f, path.join(DATA, r));
}
const displayTextures = {};
if (glbForTextures) {
  const cmpArgs = []; const slotOf = {};
  for (const t of tex) for (const k of ['normal', 'orm', 'base_color']) if (typeof t[k] === 'string') { const n = path.basename(t[k]).replace(/\.[^.]+$/, ''); cmpArgs.push(`${n}=${path.join(SRC, t[k])}`); slotOf[n] = { slot: k, original: t[k] }; }
  const pyBin = fs.existsSync(path.join(PROTO, 'validator', '.venv', 'bin', 'python')) ? path.join(PROTO, 'validator', '.venv', 'bin', 'python') : 'python3';
  const r = spawnSync(pyBin, [path.join(UI, 'tools', 'derive_textures.py'), glbForTextures, path.join(DATA, 'display'), path.join(UI, '.build-cache', 'textures'), ...cmpArgs], { encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.status !== 0) die(`texture derivation failed: ${r.stderr.slice(-800)}`);
  for (const d of JSON.parse(r.stdout)) {
    const so = slotOf[d.name]; if (!so) continue;
    displayTextures[so.slot] = { path: `display/${d.file}`, original_path: so.original, original_bytes: d.export_comparison?.export_file_bytes ?? null, width: d.width, height: d.height,
      encoding: d.encoding, bytes: d.webp_bytes, source: `embedded in ${path.basename(glbForTextures)} (same image in every LOD GLB)`, export_comparison: d.export_comparison,
      ...(so.slot === 'normal' ? { convention: 'OpenGL (+Y green), tangent space, as embedded in the GLB' } : {}), not_bundled: `${so.original} (full resolution, stays in the run folder)` };
    derived.push({ path: `display/${d.file}`, kind: 'texture_display_copy', slot: so.slot, bytes: d.webp_bytes });
  }
  for (const [slot, d] of Object.entries(displayTextures)) if (slot === 'normal' && !/green inverted|identical/.test(d.export_comparison?.relation || '')) die(`normal map relation to the export file unexpected: ${JSON.stringify(d.export_comparison)}`);
}

// ---- validator report (real) + the profile it used
let report;
if (REPORT) report = reportPeek;
else {
  const V = path.join(PROTO, 'validator');
  const vPy = fs.existsSync(path.join(V, '.venv', 'bin', 'python')) ? path.join(V, '.venv', 'bin', 'python') : 'python3'; // same fallback as server.mjs
  const r = spawnSync(vPy, ['-m', 'fabled_validator', 'check', '--manifest', path.join(SRC, 'manifest.json'), '--profile', PROFILE, '--json-only'], { cwd: V, encoding: 'utf8', maxBuffer: 64 << 20 });
  try { report = JSON.parse(r.stdout); } catch { die(`validator CLI gave no JSON (exit ${r.status}): ${(r.stderr || '').slice(-500)}`); }
}
if (report.concept_mockup) die('validator report is a stub/mockup');
{ const sha = report.profile?.sha256; if (sha) { const h = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(PROFILE)).digest('hex'); if (h !== sha) die(`profile ${PROFILE} does not match the report's profile sha256`); } }
{ const tp = report.manifest?.path || report.asset?.path || ''; if (REPORT && tp && !tp.startsWith(SRC) && !tp.includes(path.basename(SRC))) die(`report was made for ${tp}, not ${SRC}`); }
// Strip box-local absolute paths from what gets published (they mean nothing on a web host).
const scrub = (s) => s.split(SRC).join('<frozen-run>').split(path.join(PROTO, 'validator')).join('<validator>').split(PROTO).join('<prototype>');
fs.writeFileSync(path.join(DATA, 'validator_report.json'), scrub(JSON.stringify(report, null, 2)));
fs.writeFileSync(path.join(DATA, 'validator_profile.json'), scrub(fs.readFileSync(PROFILE, 'utf8')));
const demo = {
  kind: 'fabled.demo_data/0.1', note: 'Pre-processed real run: files copied unchanged from a pipeline run folder; validator report recorded (see validator_report_origin).',
  run_folder: isFrozen ? `pipeline/runs/${path.basename(SRC)}` : path.relative(PROTO, SRC), frozen_run: isFrozen,
  recorded_at: manifest.created_at || null, validator_generated_at: report.generated_at || null, built_at: new Date().toISOString(),
  manifest: 'manifest.json', validator_report: 'validator_report.json', validator_profile: 'validator_profile.json',
  validator_report_origin: REPORT ? `copied from ${path.relative(PROTO, path.resolve(REPORT))}` : 'run at build time with --manifest',
  validator_report_file: REPORT ? path.relative(PROTO, path.resolve(REPORT)) : null, validator_report_mtime: REPORT ? fs.statSync(REPORT).mtime.toISOString() : null,
  validator_overall_status: report.overall_status ?? null, validator_summary: report.summary ?? null,
  display_textures: displayTextures, derived_files: derived,
  validator_profile_name: JSON.parse(fs.readFileSync(PROFILE, 'utf8')).profile_name || null, validator_profile_file: path.relative(PROTO, PROFILE).replace(/^pipeline\/runs\/[^/]+\//, 'run folder: '),
};
fs.writeFileSync(path.join(DATA, 'demo.json'), JSON.stringify(demo, null, 2));
const pt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT' : 'n/a');
fs.writeFileSync(path.join(DATA, 'README.md'), `# demo-data (generated by tools/build_demo.mjs; do not edit)

- Pipeline run: \`${demo.run_folder}\`${demo.frozen_run ? ' (frozen)' : ''}, manifest created ${pt(demo.recorded_at)}. Files copied unchanged.
- Validator report bundled: \`${demo.validator_report_file || '(run at build time)'}\`
  - generated ${pt(demo.validator_generated_at)} (${demo.validator_generated_at}), file mtime ${pt(demo.validator_report_mtime)}
  - overall_status **${demo.validator_overall_status}**, summary ${JSON.stringify(demo.validator_summary)}
  - profile: ${demo.validator_profile_name} (\`${demo.validator_profile_file}\`)
- Downsized for the static demo: LOD GLBs ship with embedded images removed (geometry unchanged); textures ship as bit-exact WebP lossless display copies in display/. Full-resolution export PNGs stay in the run folder (not bundled). See demo.json display_textures / derived_files.
- Built ${pt(demo.built_at)}. Box-local absolute paths in the report/profile copies were replaced with <frozen-run>, <validator>, <prototype>.
`);

// ---- static app: public/ + only the three.js modules the app imports (traced)
const PUB = path.join(UI, 'public');
for (const f of fs.readdirSync(PUB, { recursive: true })) { const p = path.join(PUB, f); if (fs.statSync(p).isFile()) copy(p, path.join(OUT, f)); }
const idx = path.join(OUT, 'index.html');
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('<head>', '<head>\n  <meta name="fabled-demo" content="1" />'));
const THREE = path.join(UI, 'node_modules', 'three'); const seen = new Set();
const trace = (abs) => {
  if (seen.has(abs)) return; seen.add(abs); copy(abs, path.join(OUT, 'vendor', 'three', path.relative(THREE, abs)));
  for (const m of fs.readFileSync(abs, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1] || m[2]; if (spec === 'three') continue;
    if (spec.startsWith('.')) trace(path.resolve(path.dirname(abs), spec));
  }
};
trace(path.join(THREE, 'build', 'three.module.js'));
for (const f of fs.readdirSync(PUB)) if (f.endsWith('.js')) for (const m of fs.readFileSync(path.join(PUB, f), 'utf8').matchAll(/from\s*['"]three\/addons\/([^'"]+)['"]/g)) trace(path.join(THREE, 'examples', 'jsm', m[1]));
copy(path.join(THREE, 'LICENSE'), path.join(OUT, 'vendor', 'three', 'LICENSE'));
// dist/ deployable on its own as plain static files (no build, no functions)
fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', framework: null, buildCommand: null, installCommand: null,
  headers: JSON.parse(fs.readFileSync(path.join(UI, 'vercel.json'), 'utf8')).headers }, null, 2));

// ---- forbidden content check + size
const FORBID = [/demo-data\/export\/T_[^/]+\.png$/, /(^|\/)samples\//, /test_fixtures/, /fabled_sample_head/, /CONCEPT_MOCKUP/i, /(^|\/)stub\//, /mock_pipeline/, /\.blend1?$/, /make_sample_sculpt/];
const files = fs.readdirSync(OUT, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => fs.statSync(path.join(OUT, f)).isFile());
const bad = files.filter((f) => FORBID.some((re) => re.test(f)));
if (bad.length) die(`forbidden files in dist: ${bad.join(', ')}`);
for (const j of ['manifest.json', 'validator_report.json']) { const o = JSON.parse(fs.readFileSync(path.join(DATA, j), 'utf8')); if (o.concept_mockup === true || o.test_fixture === true) die(`${j} is marked mockup/fixture`); }
const size = (f) => fs.statSync(path.join(OUT, f)).size; const total = files.reduce((n, f) => n + size(f), 0);
const big = files.map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
const MB = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`dist: ${OUT}\nsource run: ${SRC}${isFrozen ? ' (frozen)' : ' (NOT a frozen run folder)'}\nrecorded_at: ${demo.recorded_at} · validator: ${report.overall_status} (${report.generated_at})`);
console.log(`files: ${files.length} · total ${MB(total)}${total > 100 * 1048576 ? '  ** OVER ~100 MB **' : ''}`);
for (const [f, n] of big) console.log(`  ${MB(n).padStart(9)}  ${f}`);
fs.writeFileSync(path.join(OUT, 'demo-data', 'BUILD_INFO.json'), JSON.stringify({ ...demo, files: files.length, total_bytes: total }, null, 2));
