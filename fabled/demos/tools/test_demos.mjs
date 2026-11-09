#!/usr/bin/env node
// Tests for the Fabled industry demos: breakdown + kit engines (pure), exporters, and the HTTP API against a server
// spawned on a free port with a throwaway work dir. No network, no keys: the one "provider" the server talks to is a
// fake Higgsfield on a local port owned by this file. Run: node tools/test_demos.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { breakdown, parseScreenplay, shotlistCsv, sequencerPlan, promptFor } from '../film/breakdown.mjs';
import { buildKit, starterLayout, blockoutPlan, nextStatus, categorize, STATUS_FLOW, CATEGORY_DEFAULTS } from '../game/kit.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const failures = [];
async function test(name, fn) { try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); } }
const script = fs.readFileSync(path.join(DIR, 'samples', 'the_lantern_keeper.fountain'), 'utf8');
const pitch = fs.readFileSync(path.join(DIR, 'samples', 'mossgate_pitch.txt'), 'utf8');

console.log('Film: breakdown engine');
await test('parses headings, dialogue and action; skips the Fountain title page', () => {
  const p = parseScreenplay(script);
  assert.equal(p.scenes.length, 4);
  assert.deepEqual(p.scenes.map((s) => s.int_ext), ['EXT', 'INT', 'EXT', 'EXT']);
  assert.equal(p.scenes[1].location, 'LIGHTHOUSE - KITCHEN'); assert.equal(p.scenes[1].time, 'MORNING');
  assert.equal(p.scenes[3].location, 'HARBOR TOWN'); // "(CONTINUOUS)" stripped
  assert.deepEqual(p.characters.map((c) => c.name), ['MARA', 'TOMAS']);
  const d = p.scenes[0].elements.find((e) => e.type === 'dialogue');
  assert.equal(d.character, 'MARA'); assert.deepEqual(d.parentheticals, ['quietly']); assert.equal(d.text, 'Not tonight. Not you too.');
  assert.equal(p.scenes[0].elements[0].text, 'Fog rolls over the rooftops. A lone lantern burns at the end of the pier.');
});
await test('proposes coverage: establishing per scene, OTS alternation, action rules, quiet close-up', () => {
  const bd = breakdown(script, { title: 'T' });
  assert.equal(bd.schema, 'fabled.shotlist/0.1'); assert.equal(bd.method, 'rule-based (no LLM)');
  const est = bd.shots.filter((s) => s.source === 'scene_heading'); assert.equal(est.length, 4); assert.equal(est[0].size, 'Extreme wide'); assert.equal(est[1].size, 'Wide');
  const run = bd.shots.find((s) => /runs along the cliff/.test(s.description)); assert.equal(run.move, 'Tracking (handheld)'); assert.equal(run.lens_mm, 24);
  const boom = bd.shots.find((s) => /explodes/.test(s.description)); assert.equal(boom.preset, 'crash_zoom');
  const quiet = bd.shots.find((s) => /Not tonight/.test(s.description)); assert.equal(quiet.size, 'Close-up'); assert.equal(quiet.lens_mm, 85);
  const ots = bd.shots.filter((s) => s.ots_side && s.scene === 2); assert.ok(ots.length >= 4); assert.notEqual(ots[0].ots_side, ots[1].ots_side); assert.equal(ots[0].ots_side, ots[2].ots_side);
  assert.equal(bd.total_duration_s, Math.round(bd.shots.reduce((a, s) => a + s.duration_s, 0) * 10) / 10);
  assert.ok(bd.props.find((x) => x.name === 'lantern').mentions >= 3);
  for (const s of bd.shots) { assert.ok(/mm lens/.test(s.prompt)); assert.ok(!/\.\./.test(s.prompt), `double period in prompt: ${s.prompt}`); }
  assert.ok(/low-key night/.test(bd.shots.find((s) => s.scene === 3).prompt));
});
await test('CSV is RFC 4180 quoted with one row per shot; sequencer plan is contiguous at 24 fps', () => {
  const bd = breakdown(script); const csv = shotlistCsv(bd).split('\n');
  assert.equal(csv[0], 'id,scene,scene_heading,size,move,lens_mm,duration_s,subject,description,status,prompt'); assert.equal(csv.length, bd.shots.length + 2);
  assert.ok(csv.some((l) => l.includes('""Not tonight. Not you too.""')));
  const plan = sequencerPlan(bd);
  assert.equal(plan.schema, 'fabled.sequencer_plan/0.1'); assert.equal(plan.fps, 24);
  let f = 0; for (const s of plan.shots) { assert.equal(s.start_frame, f); assert.ok(s.end_frame > s.start_frame); f = s.end_frame; assert.ok(s.focal_length_mm > 0); assert.ok(Number.isInteger(s.camera_start.x)); }
  assert.equal(plan.total_frames, f);
  // A push-in ends closer to what the camera looks at than it starts (measured from that shot's look_at, which is
  // not the world origin once every location has its own stage).
  const push = plan.shots.find((s) => s.id === bd.shots.find((x) => x.preset === 'push_in').id);
  const reach = (cam, at = {}) => Math.hypot(cam.x - (at.x || 0), cam.y - (at.y || 0));
  assert.ok(reach(push.camera_end, push.look_at) < reach(push.camera_start, push.look_at));
});
await test('empty and odd inputs do not throw', () => {
  assert.equal(breakdown('').shots.length, 0);
  const bd = breakdown('Just a paragraph with no headings. Someone looks up.'); assert.equal(bd.scenes.length, 1); assert.ok(bd.shots.length >= 2);
  assert.ok(promptFor({ description: 'x', size: 'Wide', move: 'Static (locked off)', lens_mm: 35, scene_heading: '' }).length > 10);
});

console.log('Game: kit engine');
await test('builds a kit from explicit lines plus inferred nouns, deduplicated and ordered by category', () => {
  const kit = buildKit(pitch);
  assert.equal(kit.schema, 'fabled.kit/0.1'); assert.equal(kit.title, 'Mossgate'); assert.equal(kit.genre, 'Cozy action RPG'); assert.equal(kit.camera, 'Third person');
  const names = kit.assets.map((a) => a.asset_name);
  assert.ok(names.includes('SM_MushroomCottage') && !names.includes('SM_Cottage'), 'inferred "cottage" must yield to explicit "mushroom cottage"');
  assert.ok(names.includes('SM_PotionFlask') && !names.includes('SM_Potion') && !names.includes('SM_Flask'));
  assert.ok(names.includes('SM_Fox') && names.includes('SM_Slime'), 'creatures inferred from prose');
  assert.equal(kit.assets[0].category, 'character'); assert.equal(kit.assets.at(-1).category, 'prop');
  assert.deepEqual(kit.assets.map((a) => a.id), kit.assets.map((_, i) => `A${String(i + 1).padStart(3, '0')}`));
  const knight = kit.assets.find((a) => a.asset_name === 'SM_Knight'); assert.equal(knight.import_profile, 'demo_placeholder'); assert.equal(knight.budget.rig, 'required'); assert.deepEqual(knight.budget.lods_triangles, [60000, 30000, 15000, 5000]);
  assert.equal(kit.summary.total, kit.assets.length); assert.ok(/PLACEHOLDER/.test(kit.budget_note));
  assert.equal(categorize('old boat'), 'vehicle'); assert.equal(categorize('mysterious thing'), 'prop');
});
await test('starter layout places every asset; blockout plan carries Fabled content paths and placeholder boxes', () => {
  const kit = buildKit(pitch); const lay = starterLayout(kit);
  assert.equal(lay.schema, 'fabled.layout/0.1'); assert.equal(lay.items.length, kit.assets.length);
  const plan = blockoutPlan(kit, lay);
  assert.equal(plan.schema, 'fabled.blockout_plan/0.1'); assert.equal(plan.actors.length, lay.items.length);
  const a = plan.actors.find((x) => x.label.startsWith('SM_Tavern_'));
  assert.equal(a.mesh_path, '/Game/Fabled/SM_Tavern/SM_Tavern'); assert.equal(a.imported, false); assert.deepEqual(a.placeholder_box_cm, { x: 400, y: 400, z: 500 });
  assert.equal(nextStatus('requested'), 'generating'); assert.equal(nextStatus('imported'), 'imported'); assert.equal(STATUS_FLOW.length, 6);
});
await test('a pitch with no structured lines still yields a kit', () => {
  const kit = buildKit('A horror game in a castle. The player finds a lantern and a key, chased by a wolf.');
  assert.equal(kit.genre, 'Survival horror'); assert.ok(kit.assets.map((a) => a.asset_name).includes('SM_Castle')); assert.ok(kit.assets.length >= 4);
});

console.log('HTTP API');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const expectedShots = breakdown(script).shots.length; // whatever the film engine proposes for the sample, the API must agree

// A real, minimal 1×1 RGBA PNG (signature, IHDR, IDAT, IEND with CRCs), built here so no binary fixture is needed.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png1x1(rgba = [200, 60, 40, 255]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, ...rgba]))), pngChunk('IEND', Buffer.alloc(0))]);
}
const PNG = png1x1();
const dataUri = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const JPEG_ISH = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]); // JPEG magic bytes + filler (the server checks type, it does not decode)

// Fake Higgsfield (the adapter's documented shape): POST <model>/image-to-video → {request_id}; GET requests/<id>/status.
const fake = { mode: 'down', posts: [], status: { status: 'queued' } };
const fakeServer = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    if (fake.mode === 'down') return req.socket.destroy();
    const reply = (o) => { const s = JSON.stringify(o); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(s); };
    if (req.method === 'POST') { fake.posts.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); return reply({ request_id: `req-${fake.posts.length}`, status: 'queued' }); }
    return reply(fake.status);
  });
});
await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));

const port = await freePort();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fabled-demos-test-'));
const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', FABLED_DEMOS_WORK: work, FABLED_PROVIDER_MOCK_MS: '1900', HIGGSFIELD_API_KEY: 'sekrit-value-1234', HIGGSFIELD_API_SECRET: 'sekrit-secret-5678', HIGGSFIELD_BASE_URL: `http://127.0.0.1:${fakeServer.address().port}` };
delete childEnv.FABLED_ALLOWED_HOSTS;
const child = spawn(process.execPath, [path.join(DIR, 'server.mjs')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
const B = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50 && !/Fabled demos/.test(log); i++) await sleep(100);
// JSON helper: [status, parsed body (or text), headers]. o.headers adds headers (for example If-Match).
const j = async (u, o = {}) => { const r = await fetch(B + u, { method: o.method, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }); const t = await r.text(); let x; try { x = JSON.parse(t); } catch { x = t; } return [r.status, x, r.headers]; };
// Raw helper for requests a browser-like client cannot send (foreign Origin, arbitrary Host, odd Content-Type).
const raw = (method, p, { headers = {}, body = null, toPort = port } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: toPort, method, path: p, headers: { ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject); if (body != null) req.write(body); req.end();
});
const noCors = (headers) => assert.ok(!Object.keys(headers).some((h) => h.startsWith('access-control-')), 'no Access-Control-* header is ever sent');
const filmFile = (id) => path.join(work, 'film', `${id}.json`);
const frameFile = (id, shot, ext) => path.join(work, 'film', id, 'frames', `${shot}.${ext}`);
const CTRL = /[\x00-\x09\x0b-\x1f\x7f]/; // control characters other than "\n"
let lanChild = null; let work2 = null;

try {
  await test('status lists providers without key values; static pages and fonts are served; traversal is refused', async () => {
    const [s, x] = await j('/api/status'); assert.equal(s, 200); assert.ok(x.providers.find((p) => p.id === 'mock').configured);
    assert.ok(x.providers.find((p) => p.id === 'higgsfield').configured, 'fake key makes Higgsfield configured');
    assert.ok(!/sekrit/.test(JSON.stringify(x)), 'key values never reach the browser payload');
    assert.deepEqual(x.vocab.film.statuses, ['proposed', 'approved', 'redo']); assert.ok(x.vocab.film.sizes.includes('Close-up') && x.vocab.film.moves.includes('Crane down') && x.vocab.game.categories.includes('vehicle'));
    for (const u of ['/', '/film/', '/game/', '/shared.css', '/film/app.js', '/game/app.js', '/fonts/Inter.ttf']) assert.equal((await fetch(B + u)).status, 200, u);
    assert.equal((await fetch(B + '/film')).redirected, true);
    assert.equal((await fetch(B + '/%2e%2e/server.mjs')).status, 404);
    assert.equal((await fetch(B + '/api/samples/../server.mjs')).status, 404);
    assert.equal((await fetch(B + '/fonts/..%2f..%2fserver.mjs')).status, 403);
  });

  await test('security headers: nosniff + no-referrer everywhere, CSP on HTML, never an Access-Control-* header; HEAD works', async () => {
    for (const u of ['/', '/film/', '/game/app.js', '/api/status', '/api/nope', '/nope.txt', '/api/samples/mossgate_pitch.txt']) {
      const r = await fetch(B + u); await r.arrayBuffer();
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', u); assert.equal(r.headers.get('referrer-policy'), 'no-referrer', u);
      noCors(Object.fromEntries(r.headers));
    }
    for (const u of ['/', '/film/', '/game/']) {
      const csp = (await fetch(B + u)).headers.get('content-security-policy');
      for (const part of ["default-src 'self'", "img-src 'self' data: blob:", "media-src 'self' https: blob:", "style-src 'self' 'unsafe-inline'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(part), `${u}: CSP has ${part}`);
      assert.ok(!/script-src[^;]*unsafe/.test(csp), 'scripts are same-origin only');
    }
    assert.equal((await fetch(B + '/shared.css')).headers.get('content-security-policy'), null, 'CSP is for HTML documents');
    for (const u of ['/api/status', '/film/', '/shared.css']) { const h = await raw('HEAD', u, { headers: { Host: `127.0.0.1:${port}` } }); assert.equal(h.status, 200, `HEAD ${u}`); assert.equal(h.body.length, 0); assert.ok(Number(h.headers['content-length']) > 0); }
    assert.equal((await raw('POST', '/shared.css', { headers: { Host: `127.0.0.1:${port}` } })).status, 405, 'static files are GET/HEAD only');
  });

  await test('cross-site guard: foreign Origin 403, unexpected Host 403 (DNS rebinding), non-JSON body 415, same origin ok', async () => {
    const here = `127.0.0.1:${port}`; const json = { 'Content-Type': 'application/json' };
    const before = (await j('/api/film/projects'))[1].projects.length;
    const body = JSON.stringify({ title: 'x', text: 'INT. ROOM - DAY\n\nSomeone looks up.\n' });
    // (a) Origin
    for (const origin of ['http://evil.example', `http://localhost:${port}`, `http://127.0.0.1:${port + 1}`, `https://127.0.0.1:${port + 1}`, 'null', 'file://']) {
      const r = await raw('POST', '/api/film/projects', { headers: { Host: here, Origin: origin, ...json }, body }); assert.equal(r.status, 403, `Origin ${origin}`); noCors(r.headers);
    }
    assert.equal((await raw('GET', '/api/film/projects', { headers: { Host: here, Origin: 'http://evil.example' } })).status, 403, 'cross-origin reads are refused too');
    const pre = await raw('OPTIONS', '/api/film/projects', { headers: { Host: here, Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(pre.status, 403, 'a CORS preflight is never answered'); noCors(pre.headers);
    // (b) Host
    for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1.evil.example:${port}`, 'localhost.evil.example', `192.168.1.20:${port}`, '[', 'a b']) {
      const r = await raw('GET', '/api/status', { headers: { Host: host } }); assert.equal(r.status, 403, `Host ${host}`);
    }
    for (const host of [here, `localhost:${port}`, 'LOCALHOST', '127.0.0.1', `[::1]:${port}`]) assert.equal((await raw('GET', '/api/status', { headers: { Host: host } })).status, 200, `Host ${host}`);
    // (c) Content-Type
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', null]) {
      const r = await raw('POST', '/api/film/projects', { headers: { Host: here, ...(type ? { 'Content-Type': type } : {}) }, body }); assert.equal(r.status, 415, `Content-Type ${type}`);
    }
    assert.equal((await raw('POST', '/api/film/projects', { headers: { Host: here } })).status, 415, 'a body-less POST without a JSON content type is refused too');
    assert.equal((await j('/api/film/projects'))[1].projects.length, before, 'none of the refused requests created anything');
    // same origin (what the browser apps send) is accepted, with or without a charset
    const ok = await raw('POST', '/api/film/projects', { headers: { Host: here, Origin: `http://${here}`, 'Content-Type': 'application/json; charset=utf-8' }, body }); assert.equal(ok.status, 201);
    const viaLocalhost = await raw('POST', '/api/film/projects', { headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, ...json }, body }); assert.equal(viaLocalhost.status, 201);
    for (const r of [ok, viaLocalhost]) assert.equal((await j(`/api/film/projects/${JSON.parse(r.body).project.id}`, { method: 'DELETE' }))[0], 200);
    assert.equal(child.exitCode, null, 'the server survived the malformed Host headers');
  });

  await test('LAN opt-in: a non-loopback HOST accepts the bound address and FABLED_ALLOWED_HOSTS names, nothing else', async () => {
    // The server module is told it is bound to 192.0.2.10 (TEST-NET) but this child listens on loopback only, so the
    // opt-in logic is exercised without opening a port to the network.
    const lanPort = await freePort(); work2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fabled-demos-test-lan-'));
    const code = `const { server } = await import(${JSON.stringify(pathToFileURL(path.join(DIR, 'server.mjs')).href)}); server.listen(${lanPort}, '127.0.0.1', () => console.log('lan-ready'));`;
    lanChild = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...childEnv, HOST: '192.0.2.10', FABLED_ALLOWED_HOSTS: 'demo.lan, Studio-PC:5181', FABLED_DEMOS_WORK: work2 }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; lanChild.stdout.on('data', (d) => (out += d)); lanChild.stderr.on('data', (d) => (out += d));
    for (let i = 0; i < 50 && !/lan-ready/.test(out); i++) await sleep(100);
    assert.ok(/lan-ready/.test(out), `LAN-mode server started: ${out}`);
    for (const host of ['192.0.2.10:5181', 'demo.lan', 'studio-pc:5181', `127.0.0.1:${lanPort}`]) assert.equal((await raw('GET', '/api/status', { toPort: lanPort, headers: { Host: host } })).status, 200, `Host ${host}`);
    for (const host of ['evil.example', '192.0.2.11', 'demo.lan.evil.example']) assert.equal((await raw('GET', '/api/status', { toPort: lanPort, headers: { Host: host } })).status, 403, `Host ${host}`);
    assert.equal((await raw('GET', '/api/status', { toPort: lanPort, headers: { Host: 'demo.lan', Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await raw('GET', '/api/status', { toPort: lanPort, headers: { Host: 'demo.lan', Origin: 'http://demo.lan' } })).status, 200);
  });

  let fid, sid;
  await test('film: create → patch (prompt regenerates) → comment → frame → clip errors → export (json, csv, plan, py)', async () => {
    const [s, x] = await j('/api/film/projects', { method: 'POST', body: { title: 'LK', text: script } }); assert.equal(s, 201);
    fid = x.project.id; assert.equal(x.project.shots.length, expectedShots); assert.equal(x.project.rev, 1); sid = x.project.shots[5].id;
    const [ps, px] = await j(`/api/film/projects/${fid}/shots/${sid}?as=dp`, { method: 'PATCH', body: { status: 'approved', lens_mm: 85, size: 'Close-up' } });
    assert.equal(ps, 200); assert.equal(px.shot.status, 'approved'); assert.ok(/85mm/.test(px.shot.prompt)); assert.equal(px.project.rev, 2); assert.ok(px.project.activity.some((a) => a.who === 'dp'));
    const [cs, cx] = await j(`/api/film/projects/${fid}/shots/${sid}/comments?as=director`, { method: 'POST', body: { text: 'hold longer' } }); assert.equal(cs, 201); assert.equal(cx.project.shots[5].comments[0].who, 'director');
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/frame`, { method: 'POST', body: { data_uri: 'data:text/html;base64,PGI+' } }))[0], 400);
    const [, bad] = await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'mock' } }); assert.ok(/image→video/.test(bad.error));
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'runway' } }))[0], 409, 'unconfigured provider is a clean 409');
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'higgsfield' } }))[0], 400, 'image→video needs a frame first');
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/frame`, { method: 'POST', body: { data_uri: dataUri('image/png', PNG), label: 'still', concept_mockup: true } }))[0], 201);
    fake.mode = 'down';
    const [hs, hx] = await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'higgsfield' } });
    assert.equal(hs, 502, 'configured provider that cannot be reached fails cleanly'); assert.ok(!/sekrit/.test(JSON.stringify(hx)), 'error text never echoes the key');
    const [js, jx, jh] = await j(`/api/film/projects/${fid}/export/shotlist.json`); assert.equal(js, 200); assert.equal(jx.schema, 'fabled.shotlist/0.1'); assert.equal(jx.script_text, undefined); assert.ok(/attachment/.test(jh.get('content-disposition')));
    const [, csv] = await j(`/api/film/projects/${fid}/export/shotlist.csv`); assert.equal(csv.split('\n').length, expectedShots + 2);
    const [, plan] = await j(`/api/film/projects/${fid}/export/sequencer_plan.json`); assert.equal(plan.shots.length, expectedShots); assert.equal(plan.shots[5].focal_length_mm, 85);
    const [, py] = await j(`/api/film/projects/${fid}/export/unreal.py`); assert.ok(/UNTESTED DRAFT/.test(py) && /fabled.sequencer_plan\/0.1/.test(py));
    assert.equal((await j(`/api/film/projects/${fid}/export/nope`))[0], 404);
    const [, list] = await j('/api/film/projects'); assert.equal(list.projects.length, 1); assert.equal(list.projects[0].summary.shots, expectedShots);
  });

  await test('no lost updates: 20 concurrent comments on different shots all land; rev counts every write', async () => {
    const [, before] = await j(`/api/film/projects/${fid}`); const shots = before.project.shots; const had = shots.reduce((n, s) => n + s.comments.length, 0);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => j(`/api/film/projects/${fid}/shots/${shots[i % shots.length].id}/comments?as=producer`, { method: 'POST', body: { text: `note ${i}` } })));
    assert.ok(results.every(([s]) => s === 201), 'every comment was accepted');
    const [, after] = await j(`/api/film/projects/${fid}`); const texts = after.project.shots.flatMap((s) => s.comments.map((c) => c.text));
    for (let i = 0; i < 20; i++) assert.ok(texts.includes(`note ${i}`), `comment ${i} is stored`);
    assert.equal(texts.length, had + 20); assert.equal(after.project.rev, before.project.rev + 20, 'one rev per write, none overwritten');
    assert.equal(new Set(after.project.shots.flatMap((s) => s.comments.map((c) => c.id))).size, had + 20, 'comment ids are unique');
    // mixed kinds of writes on one project at the same time
    const mixed = await Promise.all([
      j(`/api/film/projects/${fid}/shots/${shots[0].id}`, { method: 'PATCH', body: { duration_s: 4 } }),
      j(`/api/film/projects/${fid}/shots/${shots[1].id}`, { method: 'PATCH', body: { status: 'redo' } }),
      j(`/api/film/projects/${fid}/shots/${shots[2].id}/comments`, { method: 'POST', body: { text: 'mixed' } }),
      j(`/api/film/projects/${fid}/shots/${shots[3].id}/frame`, { method: 'POST', body: { data_uri: dataUri('image/png', PNG) } }),
    ]);
    assert.deepEqual(mixed.map(([s]) => s), [200, 200, 201, 201]);
    const [, m] = await j(`/api/film/projects/${fid}`); const by = (id) => m.project.shots.find((s) => s.id === id);
    assert.equal(by(shots[0].id).duration_s, 4); assert.equal(by(shots[1].id).status, 'redo'); assert.ok(by(shots[2].id).comments.some((c) => c.text === 'mixed')); assert.ok(by(shots[3].id).frame.url);
    assert.equal(m.project.rev, after.project.rev + 4);
  });

  await test('If-Match: a stale rev is a 409 with the current project and changes nothing; a current rev (or none) is applied', async () => {
    const [, cur] = await j(`/api/film/projects/${fid}`); const rev = cur.project.rev; const u = `/api/film/projects/${fid}/shots/${sid}`;
    const [s1, x1] = await j(`${u}/comments`, { method: 'POST', headers: { 'If-Match': String(rev) }, body: { text: 'first writer' } }); assert.equal(s1, 201); assert.equal(x1.project.rev, rev + 1);
    const [s2, x2] = await j(`${u}/comments`, { method: 'POST', headers: { 'If-Match': String(rev) }, body: { text: 'second writer, stale' } });
    assert.equal(s2, 409); assert.equal(x2.ok, false); assert.equal(x2.code, 'rev_conflict'); assert.ok(x2.error); assert.equal(x2.project.rev, rev + 1); assert.equal(x2.rev, rev + 1);
    assert.ok(x2.project.shots.some((s) => s.comments.some((c) => c.text === 'first writer')), 'the 409 carries the current project');
    const [s3] = await j(u, { method: 'PATCH', headers: { 'If-Match': String(rev) }, body: { status: 'proposed' } }); assert.equal(s3, 409);
    const [, after] = await j(`/api/film/projects/${fid}`); assert.equal(after.project.rev, rev + 1); assert.ok(!JSON.stringify(after.project).includes('second writer, stale')); assert.equal(after.project.shots.find((s) => s.id === sid).status, 'approved');
    assert.equal((await j(u, { method: 'PATCH', headers: { 'If-Match': `"${rev + 1}"` }, body: { status: 'proposed' } }))[0], 200, 'quoted ETag-style rev is accepted');
    assert.equal((await j(u, { method: 'PATCH', headers: { 'If-Match': 'abc' }, body: { status: 'approved' } }))[0], 400);
    assert.equal((await j(u, { method: 'PATCH', body: { status: 'approved' } }))[0], 200, 'no If-Match keeps working');
  });

  await test('shot PATCH is whitelisted: status / size / move / assignee / numbers are validated, text is cleaned, move sets preset', async () => {
    const u = `/api/film/projects/${fid}/shots/${sid}`; const get = async () => (await j(`/api/film/projects/${fid}`))[1].project;
    const start = await get(); const shot0 = start.shots.find((s) => s.id === sid);
    const xss = '"><img src=x onerror=alert(1)>';
    for (const body of [{ status: xss }, { status: 'done' }, { status: ['approved'] }, { size: xss }, { size: 'Huge' }, { move: xss }, { move: 'Teleport' }, { assignee: xss }, { assignee: 'intern' }, { lens_mm: 'wide' }, { lens_mm: null }, { duration_s: {} }, { description: 5 }, { description: '   ' }, { prompt: ['x'] }, { subject: {} }, { status: 'redo', size: 'Huge' }]) {
      const [s, x] = await j(u, { method: 'PATCH', body }); assert.equal(s, 400, JSON.stringify(body)); assert.equal(x.ok, false);
    }
    const mid = await get(); assert.equal(mid.rev, start.rev, 'rejected patches store nothing (not even their valid half)'); assert.deepEqual(mid.shots.find((s) => s.id === sid), shot0); assert.ok(!JSON.stringify(mid).includes('onerror'));
    // move → preset, for every move in the vocabulary
    const moves = (await j('/api/status'))[1].vocab.film.moves; assert.ok(moves.length >= 8);
    const [, cr] = await j(u, { method: 'PATCH', body: { move: 'Crane down' } }); assert.equal(cr.shot.move, 'Crane down'); assert.equal(cr.shot.preset, 'crane_down'); assert.ok(/crane down/.test(cr.shot.prompt));
    const [, cz] = await j(u, { method: 'PATCH', body: { move: 'Crash zoom', size: 'Insert', assignee: 'DP' } }); assert.equal(cz.shot.preset, 'crash_zoom'); assert.equal(cz.shot.size, 'Insert'); assert.equal(cz.shot.assignee, 'dp');
    const [, plan] = await j(`/api/film/projects/${fid}/export/sequencer_plan.json`); const ps = plan.shots.find((s) => s.id === sid); if (ps.preset !== undefined) assert.equal(ps.preset, 'crash_zoom', 'the Sequencer plan follows the edited move');
    // clamps
    const [, lo] = await j(u, { method: 'PATCH', body: { lens_mm: 0.001, duration_s: -5 } }); assert.equal(lo.shot.lens_mm, 4); assert.equal(lo.shot.duration_s, 0.1);
    const [, hi] = await j(u, { method: 'PATCH', body: { lens_mm: 1e9, duration_s: '99999' } }); assert.equal(hi.shot.lens_mm, 1200); assert.equal(hi.shot.duration_s, 600);
    assert.equal(hi.project.total_duration_s, Math.round(hi.project.shots.reduce((a, s) => a + s.duration_s, 0) * 10) / 10);
    // free text: stored as text, control characters stripped (newlines survive in multi-line fields)
    const bidi = String.fromCharCode(0x202e); const nasty = `line one\x00\x07\x1b[31m${bidi}\r\nline two\x7f`;
    const [, tx] = await j(u, { method: 'PATCH', body: { description: nasty, subject: `MA\x00RA\nJR`, lens_mm: 50, duration_s: 3 } });
    assert.equal(tx.shot.description, 'line one[31m\nline two'); assert.equal(tx.shot.subject, 'MA RA JR'); assert.ok(!CTRL.test(tx.shot.prompt));
    const [, cm] = await j(`${u}/comments?as=${encodeURIComponent(xss)}`, { method: 'POST', body: { text: `ok\x00\x08 then${bidi}\nmore` } });
    assert.equal(cm.comment.text, 'ok then\nmore'); assert.equal(cm.comment.who, 'director', 'an unknown ?as= falls back to a project role'); assert.ok(cm.project.activity.every((a) => ['system', ...cm.project.roles].includes(a.who)));
    assert.equal((await j(`${u}/comments?as=PRODUCER`, { method: 'POST', body: { text: 'x' } }))[1].comment.who, 'producer');
    for (const body of [{ text: '' }, { text: ' \x00 ' }, { text: 7 }, {}]) assert.equal((await j(`${u}/comments`, { method: 'POST', body }))[0], 400);
    // an edited prompt survives later edits until it is cleared
    const [, p1] = await j(u, { method: 'PATCH', body: { prompt: 'my own prompt' } }); assert.equal(p1.shot.prompt, 'my own prompt');
    const [, p2] = await j(u, { method: 'PATCH', body: { status: 'approved', lens_mm: 35 } }); assert.equal(p2.shot.prompt, 'my own prompt');
    const [, p3] = await j(u, { method: 'PATCH', body: { prompt: '' } }); assert.ok(/35mm/.test(p3.shot.prompt));
    const revNow = (await get()).rev; assert.equal((await j(u, { method: 'PATCH', body: { unknown_field: 1 } }))[0], 200); assert.equal((await get()).rev, revNow, 'a patch with nothing to change does not bump rev');
  });

  await test('frames: strict data-URI validation, stored as files (not in the project JSON), served, replaced, deleted', async () => {
    const u = `/api/film/projects/${fid}/shots/${sid}/frame`; const post = (body) => j(u, { method: 'POST', body });
    const b64 = PNG.toString('base64');
    const rejected = {
      'attribute injection after the payload': 'data:image/png;base64,AAAA" onerror="alert(1)',
      'injection after a valid image': `${dataUri('image/png', PNG)}" onerror="alert(1)`,
      'SVG (no longer accepted)': dataUri('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
      'HTML': dataUri('text/html', Buffer.from('<b>')),
      'GIF': dataUri('image/gif', Buffer.from('GIF89a')),
      'not base64 (no ;base64)': `data:image/png,${b64}`,
      'whitespace in the payload': `data:image/png;base64,${b64.slice(0, 20)} ${b64.slice(20)}`,
      'padding in the middle': `data:image/png;base64,${b64.slice(0, 10)}=${b64.slice(10)}`,
      'too much padding': `data:image/png;base64,${b64.replace(/=+$/, '')}===`,
      'impossible base64 length': 'data:image/png;base64,iVBORw0KGgoAA',
      'empty payload': 'data:image/png;base64,',
      'PNG mime with JPEG bytes': dataUri('image/png', JPEG_ISH),
      'JPEG mime with PNG bytes': dataUri('image/jpeg', PNG),
      'WebP mime with PNG bytes': dataUri('image/webp', PNG),
      'mime parameter smuggling': `data:image/png;charset=x;base64,${b64}`,
      'upper-case scheme': `DATA:image/png;base64,${b64}`,
      'a URL instead of a data URI': 'https://example.com/a.png',
    };
    for (const [why, data_uri] of Object.entries(rejected)) { const [s, x] = await post({ data_uri }); assert.equal(s, 400, why); assert.equal(x.ok, false); }
    for (const data_uri of [undefined, null, 5, {}, ['data:image/png;base64,AAAA']]) assert.equal((await post({ data_uri }))[0], 400);
    const [bs, bx] = await post({ data_uri: dataUri('image/png', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length + 1)])) }); assert.equal(bs, 413, 'over 10 MB decoded'); assert.equal(bx.ok, false);
    // accepted: a real PNG
    const [s, x] = await post({ data_uri: dataUri('image/png', PNG), label: 'key\x00 frame\n<b>', concept_mockup: true }); assert.equal(s, 201);
    const frame = x.shot.frame;
    assert.deepEqual(Object.keys(frame).sort(), ['at', 'bytes', 'concept_mockup', 'label', 'mime', 'url']); assert.equal(frame.mime, 'image/png'); assert.equal(frame.bytes, PNG.length); assert.equal(frame.label, 'key frame <b>'); assert.equal(frame.concept_mockup, true);
    assert.ok(new RegExp(`^/api/film/projects/${fid}/shots/${sid}/frame\\?v=\\d+$`).test(frame.url), frame.url);
    assert.ok(PNG.equals(fs.readFileSync(frameFile(fid, sid, 'png'))), 'the bytes are a file under the work dir');
    assert.ok(!fs.readFileSync(filmFile(fid), 'utf8').includes('base64'), 'the project JSON holds no image data');
    const got = await fetch(B + frame.url); assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png'); assert.equal(got.headers.get('x-content-type-options'), 'nosniff'); assert.ok(/max-age=\d{6,}/.test(got.headers.get('cache-control')) && /immutable/.test(got.headers.get('cache-control')));
    assert.ok(PNG.equals(Buffer.from(await got.arrayBuffer())));
    const unversioned = await fetch(`${B}${u}`); assert.equal(unversioned.status, 200); assert.ok(/no-cache/.test(unversioned.headers.get('cache-control')), 'only the versioned URL is cached for good');
    assert.equal((await fetch(B + frame.url, { headers: { 'If-None-Match': got.headers.get('etag') } })).status, 304);
    const head = await raw('HEAD', frame.url, { headers: { Host: `127.0.0.1:${port}` } }); assert.equal(head.status, 200); assert.equal(Number(head.headers['content-length']), PNG.length); assert.equal(head.body.length, 0);
    // a 1 MB still does not make the project payload (what every poll returns) grow
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024, 1)]);
    const others = x.project.shots.filter((sh) => sh.id !== sid).slice(0, 3);
    for (const sh of others) assert.equal((await j(`/api/film/projects/${fid}/shots/${sh.id}/frame`, { method: 'POST', body: { data_uri: dataUri('image/png', big) } }))[0], 201);
    const projectText = await (await fetch(`${B}/api/film/projects/${fid}`)).text(); assert.ok(projectText.length < 200 * 1024, `project payload is ${projectText.length} bytes with 3 MB of stills attached`); assert.ok(!projectText.includes('data:image'));
    const exportText = await (await fetch(`${B}/api/film/projects/${fid}/export/shotlist.json`)).text(); const exported = JSON.parse(exportText);
    assert.ok(!/data:image|base64/.test(exportText), 'exports never embed image bytes'); assert.equal(exported.shots.find((sh) => sh.id === sid).frame.url, frame.url); assert.equal(exported.shots.find((sh) => sh.id === others[0].id).frame.bytes, big.length);
    // replace with another type: the old file goes away, the URL version changes
    await sleep(5);
    const [rs, rx] = await post({ data_uri: dataUri('image/jpeg', JPEG_ISH) }); assert.equal(rs, 201); assert.equal(rx.shot.frame.mime, 'image/jpeg'); assert.equal(rx.shot.frame.label, 'uploaded still'); assert.equal(rx.shot.frame.concept_mockup, false); assert.notEqual(rx.shot.frame.url, frame.url);
    assert.ok(!fs.existsSync(frameFile(fid, sid, 'png')) && fs.existsSync(frameFile(fid, sid, 'jpg')));
    assert.equal((await fetch(B + rx.shot.frame.url)).headers.get('content-type'), 'image/jpeg');
    // delete
    const [ds, dx] = await j(u, { method: 'DELETE' }); assert.equal(ds, 200); assert.equal(dx.shot.frame, null); assert.equal(dx.project.shots.find((sh) => sh.id === sid).frame, null);
    assert.ok(!fs.existsSync(frameFile(fid, sid, 'jpg'))); assert.equal((await fetch(`${B}${u}`)).status, 404);
    assert.equal((await j(u, { method: 'DELETE' }))[0], 200, 'deleting a missing frame is not an error'); assert.equal((await j(`/api/film/projects/${fid}/shots/nope/frame`))[0], 404);
  });

  await test('clip: the provider receives the stored still as a data URI; progress ticks do not bump rev; ?rev= polling stays small', async () => {
    const u = `/api/film/projects/${fid}/shots/${sid}`;
    assert.equal((await j(`${u}/frame`, { method: 'POST', body: { data_uri: dataUri('image/png', PNG), label: 'still' } }))[0], 201);
    fake.mode = 'up'; fake.posts.length = 0;
    const [cs, cx] = await j(`${u}/clip?as=dp`, { method: 'POST', body: { provider: 'higgsfield' } }); assert.equal(cs, 202);
    assert.equal(fake.posts.length, 1); assert.equal(fake.posts[0].body.image_url, dataUri('image/png', PNG), 'image: { data_uri } built from the frame file'); assert.equal(fake.posts[0].body.prompt, cx.shot.prompt);
    assert.ok(!JSON.stringify(cx).includes('sekrit') && !JSON.stringify(cx).includes('base64'), 'neither the key nor the image comes back');
    assert.equal(cx.shot.clip.status, 'queued'); assert.equal(cx.shot.clip.provider, 'Higgsfield'); const rev = cx.project.rev;
    // tick 1: still queued, progress moved → persisted, but rev stays
    fake.status = { status: 'queued', progress: 30 };
    const [, t1] = await j(`/api/film/projects/${fid}/clips?rev=${rev}`);
    assert.deepEqual(Object.keys(t1).sort(), ['ok', 'progress', 'progress_rev', 'rev', 'unchanged']); assert.equal(t1.unchanged, true); assert.equal(t1.rev, rev);
    assert.deepEqual(t1.progress.find((p) => p.id === sid), { id: sid, status: 'queued', progress: 30 });
    const [, full] = await j(`/api/film/projects/${fid}/clips`); assert.equal(full.project.rev, rev, 'a progress tick is not a new revision'); assert.equal(full.project.shots.find((s) => s.id === sid).clip.progress, 30); assert.ok(full.project.progress_rev >= 1);
    assert.equal(JSON.parse(fs.readFileSync(filmFile(fid), 'utf8')).shots.find((s) => s.id === sid).clip.progress, 30, 'progress is persisted');
    assert.equal((await j(`/api/film/projects/${fid}/clips?rev=${rev - 1}`))[1].project.rev, rev, 'a stale ?rev= gets the whole project');
    // tick 2 (the task store polls a provider at most every 2 s): finished → rev moves once
    fake.status = { status: 'completed', video: { url: 'https://cdn.example.com/clips/shot.mp4' } };
    let done = null; let polls = 0;
    for (let i = 0; i < 40 && !done; i++) { await sleep(150); polls++; const [, r] = await j(`/api/film/projects/${fid}/clips?rev=${rev}`); if (!r.unchanged) done = r; else assert.equal(r.rev, rev); }
    assert.ok(done, 'the clip finished'); const clip = done.project.shots.find((s) => s.id === sid).clip;
    assert.equal(clip.status, 'succeeded'); assert.equal(clip.url, 'https://cdn.example.com/clips/shot.mp4'); assert.equal(done.project.rev, rev + 1, `one rev for the result after ${polls} polls`);
    assert.equal((await j(`/api/film/projects/${fid}/clips?rev=${rev + 1}`))[1].unchanged, true);
    // a provider that answers with a non-http(s) URL does not get it stored
    const other = done.project.shots.find((s) => s.id !== sid && s.frame);
    const [os2, ox] = await j(`/api/film/projects/${fid}/shots/${other.id}/clip`, { method: 'POST', body: { provider: 'higgsfield' } }); assert.equal(os2, 202);
    fake.status = { status: 'failed', error: 'nsfw\x00 content', video: { url: 'javascript:alert(1)' } };
    const [, fr] = await j(`/api/film/projects/${fid}/clips?rev=${ox.project.rev}`); const failed = fr.project.shots.find((s) => s.id === other.id).clip;
    assert.equal(failed.status, 'failed'); assert.equal(failed.url, null); assert.equal(failed.error, 'nsfw content');
  });

  await test('old projects with inline data_uri frames are migrated to files on first load; invalid ones are dropped', async () => {
    const id = 'film-legacy01';
    const shot = (n, frame) => ({ id: `S01-00${n}`, scene: 1, scene_heading: 'INT. ROOM - DAY', status: 'proposed', size: 'Wide', move: 'Static (locked off)', preset: 'static', lens_mm: 35, duration_s: 2, subject: 'ROOM', description: `shot ${n}`, prompt: 'p', comments: [], clip: null, assignee: 'dp', frame });
    const at = '2026-11-01T10:00:00.000Z';
    const legacy = { id, schema: 'fabled.shotlist/0.1', title: 'Legacy', created_at: at, updated_at: at, rev: 7, scenes: [{ number: 1, heading: 'INT. ROOM - DAY', location: 'ROOM' }], roles: ['director', 'dp'], activity: [], shots: [
      shot(1, { data_uri: dataUri('image/png', PNG), label: 'old still', at, concept_mockup: true }),
      shot(2, { data_uri: dataUri('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), label: 'svg', at }),
      shot(3, { data_uri: 'data:image/png;base64,AAAA" onerror="alert(1)', label: 'x', at }),
      shot(4, null),
    ] };
    fs.writeFileSync(filmFile(id), JSON.stringify(legacy));
    const [s, x] = await j(`/api/film/projects/${id}`); assert.equal(s, 200); assert.equal(x.project.rev, 7, 'migration is not a new revision');
    const [f1, f2, f3, f4] = x.project.shots.map((sh) => sh.frame);
    assert.deepEqual(f1, { url: `/api/film/projects/${id}/shots/S01-001/frame?v=${Date.parse(at)}`, mime: 'image/png', bytes: PNG.length, label: 'old still', at, concept_mockup: true });
    assert.equal(f2, null); assert.equal(f3, null); assert.equal(f4, null); assert.ok(!JSON.stringify(x).includes('onerror'));
    assert.ok(PNG.equals(fs.readFileSync(frameFile(id, 'S01-001', 'png')))); assert.ok(PNG.equals(Buffer.from(await (await fetch(B + f1.url)).arrayBuffer())));
    for (let i = 0; i < 40 && fs.readFileSync(filmFile(id), 'utf8').includes('data_uri'); i++) await sleep(50);
    assert.ok(!fs.readFileSync(filmFile(id), 'utf8').includes('data_uri'), 'the file on disk is rewritten in the new shape');
    for (const fmt of ['shotlist.json', 'shotlist.csv', 'sequencer_plan.json']) assert.equal((await j(`/api/film/projects/${id}/export/${fmt}`))[0], 200, fmt);
    assert.equal((await j(`/api/film/projects/${id}/shots/S01-001/comments`, { method: 'POST', body: { text: 'still works' } }))[1].project.rev, 8);
    // deleting a project removes its frame files
    assert.equal((await j(`/api/film/projects/${id}`, { method: 'DELETE' }))[0], 200);
    assert.ok(!fs.existsSync(path.join(work, 'film', id)) && !fs.existsSync(filmFile(id)));
  });

  let gid, aid;
  await test('game: create → mock generation completes → status advances → layout → exports', async () => {
    const [s, x] = await j('/api/game/projects', { method: 'POST', body: { text: pitch } }); assert.equal(s, 201);
    gid = x.project.id; aid = x.project.assets.find((a) => a.asset_name === 'SM_Knight').id; assert.equal(x.project.layout.items.length, x.project.assets.length);
    const [gs, gx] = await j(`/api/game/projects/${gid}/assets/${aid}/generate?as=vendor`, { method: 'POST', body: { provider: 'mock' } }); assert.equal(gs, 202); assert.equal(gx.task.concept_mockup, true); assert.equal(gx.asset.status, 'generating');
    assert.equal((await j(`/api/game/projects/${gid}/assets/${aid}/generate`, { method: 'POST', body: { provider: 'meshy' } }))[0], 409);
    // Revision churn: the mock ramps progress for 1.9 s. An early poll sees progress but no status change, which must
    // be persisted without a new rev; the whole run may bump rev only for status transitions (queued → running → succeeded).
    const rev0 = gx.project.rev; await sleep(100);
    const [, tick] = await j(`/api/game/projects/${gid}/generations?rev=${rev0}`);
    const early = tick.progress.find((p) => p.id === aid);
    if (early.status === 'queued') { // (always, unless this machine stalled for 300 ms)
      assert.equal(tick.unchanged, true); assert.equal(tick.project, undefined); assert.equal(tick.rev, rev0); assert.ok(early.progress > 0 && early.progress < 100);
      const [, same] = await j(`/api/game/projects/${gid}/generations`); assert.equal(same.project.rev, rev0, 'a progress tick is not a new revision'); assert.equal(same.project.assets.find((z) => z.id === aid).generation.progress, early.progress); assert.ok(same.project.progress_rev >= 1);
    }
    let a; let last; const revs = new Set();
    for (let i = 0; i < 60; i++) { await sleep(150); const [, g] = await j(`/api/game/projects/${gid}/generations`); last = g; revs.add(g.project.rev); a = g.project.assets.find((z) => z.id === aid); if (a.generation.status === 'succeeded') break; }
    assert.equal(a.generation.status, 'succeeded'); assert.equal(a.status, 'generated'); assert.equal(a.generation.outputs[0].local, 'samples/mock_generations/knight_helmet.glb');
    assert.ok(last.project.rev > rev0 && last.project.rev <= rev0 + 2, `rev moved ${last.project.rev - rev0}× for the status transitions, not once per poll`); assert.ok(revs.size <= 3);
    const [, idle] = await j(`/api/game/projects/${gid}/generations?rev=${last.project.rev}`); assert.equal(idle.unchanged, true); assert.deepEqual(idle.progress, [{ id: aid, status: 'succeeded', progress: 100 }]);
    assert.equal((await fetch(`${B}/api/mock-models/knight_helmet.glb`)).status, 200); assert.equal((await fetch(`${B}/api/mock-models/../MOCK_INFO.json`)).status, 404);
    assert.equal((await j(`/api/game/projects/${gid}/assets/${aid}`, { method: 'PATCH', body: { status: 'bogus' } }))[0], 400);
    const [, adv] = await j(`/api/game/projects/${gid}/assets/${aid}?as=tech%20art%20director`, { method: 'PATCH', body: { advance: true } }); assert.equal(adv.asset.status, 'in_pipeline');
    const [, imp] = await j(`/api/game/projects/${gid}/assets/${aid}`, { method: 'PATCH', body: { status: 'imported' } }); assert.equal(imp.project.summary.by_status.imported, 1);
    const [, c] = await j(`/api/game/projects/${gid}/assets/${aid}/comments?as=vendor`, { method: 'POST', body: { text: 'UVs redone' } }); assert.equal(c.comment.who, 'vendor');
    const [, add] = await j(`/api/game/projects/${gid}/layout`, { method: 'POST', body: { asset_id: aid, x: 120, y: -80, yaw: 45 } }); assert.equal(add.item.x, 120); assert.equal(add.item.yaw, 45);
    const items = add.project.layout.items.slice(0, 3).concat([{ asset_id: 'nope', x: 0, y: 0 }]);
    const [, put] = await j(`/api/game/projects/${gid}/layout`, { method: 'PUT', body: { items } }); assert.equal(put.layout.items.length, 3, 'unknown asset ids are dropped'); assert.deepEqual(put.layout.items, items.slice(0, 3), 'a clean layout round-trips unchanged');
    const [, plan] = await j(`/api/game/projects/${gid}/export/blockout_plan.json`); assert.equal(plan.actors.length, 3); assert.ok(plan.actors.every((z) => z.mesh_path.startsWith('/Game/Fabled/')));
    const [, prof] = await j(`/api/game/projects/${gid}/export/import_profiles.json`); assert.equal(prof.profiles.length, x.project.assets.length); assert.ok(/PLACEHOLDER/.test(prof.note));
    const [, kit] = await j(`/api/game/projects/${gid}/export/kit.json`); assert.equal(kit.pitch_text, undefined);
    const [, py] = await j(`/api/game/projects/${gid}/export/unreal.py`); assert.ok(/fabled.blockout_plan\/0.1/.test(py));
  });

  await test('asset PATCH: a category change re-applies profile, budget, rig and footprint (also on layout items); fields are validated', async () => {
    const get = async () => (await j(`/api/game/projects/${gid}`))[1].project;
    const p0 = await get(); const prop = p0.assets.find((a) => a.category === 'prop' && a.id !== aid); const u = `/api/game/projects/${gid}/assets/${prop.id}`;
    assert.equal((await j(`/api/game/projects/${gid}/layout`, { method: 'PUT', body: { items: [{ asset_id: prop.id, x: 100, y: 200 }, { asset_id: prop.id, x: -300, y: 0, yaw: 90 }, { asset_id: aid, x: 0, y: 0 }] } }))[0], 200);
    const ch = CATEGORY_DEFAULTS.character;
    const [s, x] = await j(`${u}?as=designer`, { method: 'PATCH', body: { category: 'character' } }); assert.equal(s, 200);
    assert.equal(x.asset.category, 'character'); assert.equal(x.asset.import_profile, ch.profile); assert.notEqual(x.asset.import_profile, prop.import_profile);
    assert.equal(x.asset.budget.rig, 'required'); assert.deepEqual(x.asset.budget.lods_triangles, ch.lods); assert.deepEqual(x.asset.budget.height_cm, ch.height_cm); assert.equal(x.asset.budget.texture_px, ch.textures); assert.deepEqual(x.asset.footprint_cm, ch.footprint_cm);
    const placed = x.project.layout.items.filter((it) => it.asset_id === prop.id); assert.equal(placed.length, 2);
    for (const it of placed) { assert.equal(it.category, 'character'); assert.deepEqual(it.footprint_cm, ch.footprint_cm); }
    assert.equal(x.project.layout.items.find((it) => it.asset_id === aid).category, 'character', 'other items are untouched');
    assert.equal(x.project.summary.by_category.character, p0.summary.by_category.character + 1); assert.equal(x.project.summary.by_category.prop, p0.summary.by_category.prop - 1);
    const env = CATEGORY_DEFAULTS.environment;
    const [, e] = await j(u, { method: 'PATCH', body: { category: 'environment' } }); assert.equal(e.asset.budget.rig, 'none'); assert.equal(e.asset.import_profile, env.profile); assert.deepEqual(e.project.layout.items.find((it) => it.asset_id === prop.id).footprint_cm, env.footprint_cm);
    const [, plan] = await j(`/api/game/projects/${gid}/export/blockout_plan.json`); assert.deepEqual(plan.actors.filter((z) => z.category === 'environment').map((z) => [z.placeholder_box_cm.x, z.placeholder_box_cm.y]), [env.footprint_cm, env.footprint_cm]);
    // validation: nothing below is stored
    const rev = (await get()).rev; const xss = '"><img src=x onerror=alert(1)>';
    for (const body of [{ category: 'bogus' }, { category: '__proto__' }, { category: ['prop'] }, { assignee: xss }, { assignee: 'nobody' }, { import_profile: xss }, { import_profile: 'studio_secret' }, { name: '' }, { name: ' \x00 ' }, { name: 5 }, { status: xss }, { category: 'prop', assignee: 'nobody' }]) assert.equal((await j(u, { method: 'PATCH', body }))[0], 400, JSON.stringify(body));
    const after = await get(); assert.equal(after.rev, rev); assert.equal(after.assets.find((a) => a.id === prop.id).category, 'environment'); assert.ok(!JSON.stringify(after).includes('onerror'));
    const [, ok] = await j(`${u}?as=${encodeURIComponent(xss)}`, { method: 'PATCH', body: { assignee: 'Vendor', import_profile: 'demo_placeholder_prop' } }); assert.equal(ok.asset.assignee, 'vendor'); assert.equal(ok.asset.import_profile, 'demo_placeholder_prop');
    assert.ok(ok.project.activity.every((a) => ['system', ...ok.project.roles].includes(a.who)), 'an unknown ?as= never reaches the activity log');
    // rename: display name is cleaned, the Unreal asset name follows and layout items follow it
    const [, rn] = await j(u, { method: 'PATCH', body: { name: 'Great\x00 Sword\n' } }); assert.equal(rn.asset.name, 'Great Sword'); assert.equal(rn.asset.asset_name, 'SM_GreatSword');
    assert.ok(rn.project.layout.items.filter((it) => it.asset_id === prop.id).every((it) => it.asset_name === 'SM_GreatSword'));
    assert.equal(new Set(rn.project.assets.map((a) => a.asset_name.toLowerCase())).size, rn.project.assets.length, 'asset names stay unique');
    const [, cmt] = await j(`${u}/comments?as=nobody`, { method: 'POST', body: { text: 'a\x00b' } }); assert.equal(cmt.comment.text, 'ab'); assert.equal(cmt.comment.who, 'designer');
    assert.equal((await j(u, { method: 'PATCH', headers: { 'If-Match': '1' }, body: { advance: true } }))[0], 409, 'If-Match works on game projects too');
  });

  await test('layout save rebuilds every item from its asset; spawn is numeric only; exports never 500 on stored data', async () => {
    const get = async () => (await j(`/api/game/projects/${gid}`))[1].project; const p0 = await get(); const asset = p0.assets.find((a) => a.id === aid);
    const hostile = [
      { id: '"><script>alert(1)</script>', asset_id: aid, asset_name: '<img src=x onerror=alert(1)>', category: 'evil', x: '<script>', y: 1e99, z: null, yaw: 'abc', scale: -5, footprint_cm: 'wide', extra: { nested: 'x' }, onclick: 'alert(1)' },
      { asset_id: aid }, // no transform, no footprint: this used to make the blockout export answer 500
      { asset_id: aid, id: 'keep-me_1', x: 12.6, y: '-40', yaw: 450, scale: 99, footprint_cm: [1, 1] },
      { asset_id: aid, id: 'keep-me_1', x: 1, y: 1 }, // duplicate id
      { asset_id: 'nope', x: 0, y: 0 }, null, 'junk', 42, [],
    ];
    const [s, x] = await j(`/api/game/projects/${gid}/layout`, { method: 'PUT', body: { items: hostile, spawn: { x: 5, y: '6', z: 0, yaw: 450, evil: '<b>' } } }); assert.equal(s, 200);
    const items = x.layout.items; assert.equal(items.length, 4);
    for (const it of items) {
      assert.deepEqual(Object.keys(it).sort(), ['asset_id', 'asset_name', 'category', 'footprint_cm', 'id', 'scale', 'x', 'y', 'yaw', 'z']);
      assert.equal(it.asset_id, aid); assert.equal(it.asset_name, asset.asset_name); assert.equal(it.category, asset.category); assert.deepEqual(it.footprint_cm, asset.footprint_cm);
      for (const k of ['x', 'y', 'z', 'yaw', 'scale']) assert.ok(Number.isFinite(it[k]), `${k} is a number`);
      assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(it.id)); assert.ok(it.scale >= 0.1 && it.scale <= 10); assert.ok(Math.abs(it.x) <= 1e6 && Math.abs(it.y) <= 1e6 && Math.abs(it.yaw) <= 360);
    }
    assert.equal(items[2].id, 'keep-me_1'); assert.equal(items[2].x, 13); assert.equal(items[2].y, -40); assert.equal(items[2].scale, 10); assert.equal(new Set(items.map((it) => it.id)).size, 4, 'duplicate ids are re-issued');
    assert.deepEqual(x.layout.spawn, { x: 5, y: 6, z: 0, yaw: 90 }); assert.ok(!JSON.stringify(x.project.layout).includes('<'));
    for (const spawn of [{ x: '<script>' }, { yaw: {} }, 'north', [1, 2], { z: null }]) assert.equal((await j(`/api/game/projects/${gid}/layout`, { method: 'PUT', body: { items: [], spawn } }))[0], 400, JSON.stringify(spawn));
    assert.equal((await j(`/api/game/projects/${gid}/layout`, { method: 'PUT', body: { items: 'all' } }))[0], 400);
    assert.equal((await get()).layout.items.length, 4, 'a rejected save keeps the stored layout');
    const [bs, plan] = await j(`/api/game/projects/${gid}/export/blockout_plan.json`); assert.equal(bs, 200); assert.equal(plan.actors.length, 4);
    for (const a of plan.actors) { assert.ok(Number.isFinite(a.placeholder_box_cm.x) && Number.isFinite(a.placeholder_box_cm.z)); assert.ok(a.mesh_path.startsWith('/Game/Fabled/SM_')); }
    // Data that is already on disk in a bad shape (written by an older server, or edited by hand)
    const stored = JSON.parse(fs.readFileSync(path.join(work, 'game', `${gid}.json`), 'utf8'));
    stored.id = 'game-stored01';
    stored.layout.items = [{ asset_id: aid, x: 1 }, { id: 'x1', asset_id: aid, asset_name: asset.asset_name, x: 'a', y: {}, footprint_cm: null }, { asset_id: 'gone', asset_name: 'SM_Gone', x: 0, y: 0, footprint_cm: [1, 1] }, null, 'junk', stored.layout.items[2]];
    stored.layout.spawn = 'here';
    stored.assets.push({ id: 'A999', name: 'no budget', asset_name: 'SM_NoBudget', category: 'mystery', status: 'requested', comments: 'none' }, null, 'junk');
    stored.layout.items.push({ asset_id: 'A999', x: 50, y: 50 });
    delete stored.activity; stored.roles = 'everyone';
    fs.writeFileSync(path.join(work, 'game', 'game-stored01.json'), JSON.stringify(stored));
    for (const fmt of ['blockout_plan.json', 'layout.json', 'kit.json', 'import_profiles.json']) { const [es, ex] = await j(`/api/game/projects/game-stored01/export/${fmt}`); assert.equal(es, 200, `${fmt}: ${JSON.stringify(ex).slice(0, 200)}`); }
    // 3 placements point at the knight; the 4th points at an asset with no budget, which the kit engine either sizes from defaults or the server leaves out with a warning.
    const [, sp] = await j('/api/game/projects/game-stored01/export/blockout_plan.json'); assert.ok(sp.actors.length === 4 || (sp.actors.length === 3 && sp.warnings?.length === 1), `usable items are exported, unusable ones are left out (${sp.actors.length} actors)`); assert.ok(sp.actors.every((a) => Number.isFinite(a.location.x) && Number.isFinite(a.location.y) && Number.isFinite(a.placeholder_box_cm.x)));
    const [gs, gp] = await j('/api/game/projects/game-stored01'); assert.equal(gs, 200); assert.equal(gp.project.layout.items.length, 4); assert.ok(Number.isFinite(gp.project.layout.spawn.x)); assert.ok(Array.isArray(gp.project.roles) && Array.isArray(gp.project.activity));
    assert.equal((await j('/api/game/projects/game-stored01/assets/A999/comments', { method: 'POST', body: { text: 'works' } }))[0], 201);
    assert.equal((await j('/api/game/projects/game-stored01/assets/A999', { method: 'PATCH', body: { category: 'prop' } }))[1].asset.budget.rig, 'none');
    assert.equal((await j('/api/game/projects/game-stored01', { method: 'DELETE' }))[0], 200);
  });

  await test('growth is bounded: 200 comments per item, 300 activity entries, capped request bodies', async () => {
    const [, p0] = await j(`/api/game/projects/${gid}`); const target = p0.project.assets.find((a) => a.comments.length === 0); const u = `/api/game/projects/${gid}/assets/${target.id}/comments`;
    const results = await Promise.all(Array.from({ length: 205 }, (_, i) => j(u, { method: 'POST', body: { text: `c${i}` } })));
    assert.equal(results.filter(([s]) => s === 201).length, 200); assert.equal(results.filter(([s]) => s === 400).length, 5);
    const second = p0.project.assets.find((a) => a.comments.length === 0 && a.id !== target.id);
    const more = await Promise.all(Array.from({ length: 120 }, (_, i) => j(`/api/game/projects/${gid}/assets/${second.id}/comments?as=vendor`, { method: 'POST', body: { text: `d${i}` } })));
    assert.ok(more.every(([s]) => s === 201), 'the limit is per item');
    const [, p1] = await j(`/api/game/projects/${gid}`); assert.equal(p1.project.assets.find((a) => a.id === target.id).comments.length, 200); assert.equal(p1.project.assets.find((a) => a.id === second.id).comments.length, 120);
    assert.ok(p0.project.activity.length + 320 > 300); assert.equal(p1.project.activity.length, 300, 'the activity log keeps the newest 300');
    assert.equal(p1.project.activity.at(-1).who, 'vendor'); assert.equal(p1.project.rev, p0.project.rev + 320);
    assert.equal((await j(u, { method: 'POST', body: { text: 'x'.repeat(100 * 1024) } }))[0], 413, 'a body over the endpoint limit is a 413');
    assert.equal((await j('/api/game/projects', { method: 'POST', body: { text: 'x'.repeat(1024 * 1024 + 10) } }))[0], 413);
    const chunked = await new Promise((resolve, reject) => { // no Content-Length: the limit is enforced while reading
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: u, headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write('{"text":"'); req.write('y'.repeat(200 * 1024)); req.end('"}');
    });
    assert.equal(chunked, 413);
    assert.equal((await j(`/api/game/projects/${gid}`))[1].project.rev, p1.project.rev);
  });

  await test('bad input is a clean 4xx, a corrupt project file is reported (and deletable), unknown ids 404, delete works', async () => {
    assert.equal((await j('/api/film/projects', { method: 'POST', body: { nope: 1 } }))[0], 400);
    assert.equal((await fetch(`${B}/api/game/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' })).status, 400);
    for (const body of ['null', '[]', '"text"', '7', 'true']) assert.equal((await fetch(`${B}/api/film/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400, `body ${body}`);
    assert.equal((await fetch(`${B}/api/film/projects/${fid}/shots/${sid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
    assert.equal((await j('/api/film/projects/does-not-exist'))[0], 404); assert.equal((await j('/api/film/projects/..%2F..%2Fetc'))[0], 404);
    assert.equal((await fetch(`${B}/%E0%A4%A`)).status, 400, 'a malformed escape in a path is a 400, not a crash');
    assert.equal((await j(`/api/film/projects/${fid}`, { method: 'PUT', body: {} }))[0], 405); assert.equal((await j('/api/status', { method: 'DELETE' }))[0], 405);
    // corrupt files: not listed, a clear 500 with a code (never a crash or a hang), and DELETE cleans them up
    fs.writeFileSync(filmFile('film-corrupt01'), '{"id":"film-corrupt01","shots":[{"id":"S01-0');
    fs.writeFileSync(filmFile('film-corrupt02'), '[]');
    fs.writeFileSync(path.join(work, 'game', 'game-corrupt01.json'), JSON.stringify({ id: 'game-corrupt01', title: 'no assets' }));
    fs.writeFileSync(path.join(work, 'game', 'game-corrupt02.json'), JSON.stringify({ id: 'someone-else', assets: [] }));
    const [ls, lx] = await j('/api/film/projects'); assert.equal(ls, 200); assert.ok(lx.projects.every((p) => !p.id.includes('corrupt'))); assert.ok(lx.projects.some((p) => p.id === fid));
    assert.equal((await j('/api/game/projects'))[1].projects.filter((p) => /corrupt|someone/.test(p.id)).length, 0);
    for (const u of ['/api/film/projects/film-corrupt01', '/api/film/projects/film-corrupt02', '/api/film/projects/film-corrupt01/clips', '/api/film/projects/film-corrupt01/export/shotlist.csv', '/api/game/projects/game-corrupt01', '/api/game/projects/game-corrupt02/generations']) {
      const [s, x] = await j(u); assert.equal(s, 500, u); assert.equal(x.code, 'project_corrupt', u);
    }
    assert.equal((await j('/api/film/projects/film-corrupt01/shots/S01-001/comments', { method: 'POST', body: { text: 'x' } }))[0], 500);
    for (const u of ['/api/film/projects/film-corrupt01', '/api/film/projects/film-corrupt02', '/api/game/projects/game-corrupt01', '/api/game/projects/game-corrupt02']) { assert.equal((await j(u, { method: 'DELETE' }))[0], 200, u); assert.equal((await j(u))[0], 404, u); }
    // delete removes the project and its frame files
    assert.ok(fs.readdirSync(path.join(work, 'film', fid, 'frames')).length >= 3);
    assert.equal((await j(`/api/film/projects/${fid}`, { method: 'DELETE' }))[0], 200); assert.equal((await j(`/api/film/projects/${fid}`))[0], 404); assert.ok(!fs.existsSync(path.join(work, 'film', fid)), 'frame files are gone');
    assert.equal((await j(`/api/film/projects/${fid}`, { method: 'DELETE' }))[0], 404);
    assert.equal((await j(`/api/game/projects/${gid}`, { method: 'DELETE' }))[0], 200);
    assert.equal(fs.readdirSync(path.join(work, 'film')).concat(fs.readdirSync(path.join(work, 'game'))).filter((f) => f.endsWith('.tmp')).length, 0, 'no temp files are left behind');
    assert.equal((await j('/api/status'))[0], 200); assert.equal(child.exitCode, null, 'the server is still running after everything above');
    assert.ok(!/unhandled|Error|failed|not persisted/i.test(log), `server log is clean:\n${log}`);
  });
} finally {
  child.kill(); if (lanChild) lanChild.kill(); fakeServer.close();
  fs.rmSync(work, { recursive: true, force: true }); if (work2) fs.rmSync(work2, { recursive: true, force: true });
}
console.log(`\n Demos summary: ${pass}/${pass + fail} passed (${fail} failed)${fail ? '\n  failed: ' + failures.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
