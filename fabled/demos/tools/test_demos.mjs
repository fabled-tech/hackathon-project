#!/usr/bin/env node
// Tests for the Fabled industry demos: breakdown + kit engines (pure), exporters, and the HTTP API against a server
// spawned on a free port with a throwaway work dir. No network, no keys. Run: node tools/test_demos.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { breakdown, parseScreenplay, shotlistCsv, sequencerPlan, promptFor } from '../film/breakdown.mjs';
import { buildKit, starterLayout, blockoutPlan, nextStatus, categorize, STATUS_FLOW } from '../game/kit.mjs';

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
  const push = plan.shots.find((s) => s.id === bd.shots.find((x) => x.preset === 'push_in').id); assert.ok(Math.hypot(push.camera_end.x, push.camera_end.y) < Math.hypot(push.camera_start.x, push.camera_start.y));
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
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fabled-demos-test-'));
const child = spawn(process.execPath, [path.join(DIR, 'server.mjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FABLED_DEMOS_WORK: work, FABLED_PROVIDER_MOCK_MS: '300', HIGGSFIELD_API_KEY: 'sekrit-value-1234', HIGGSFIELD_API_SECRET: 'sekrit-secret-5678' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
const B = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50 && !/Fabled demos/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const j = async (u, o = {}) => { const r = await fetch(B + u, { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined }); const t = await r.text(); let x; try { x = JSON.parse(t); } catch { x = t; } return [r.status, x, r.headers]; };
try {
  await test('status lists providers without key values; static pages and fonts are served; traversal is refused', async () => {
    const [s, x] = await j('/api/status'); assert.equal(s, 200); assert.ok(x.providers.find((p) => p.id === 'mock').configured);
    assert.ok(x.providers.find((p) => p.id === 'higgsfield').configured, 'fake key makes Higgsfield configured');
    assert.ok(!/sekrit/.test(JSON.stringify(x)), 'key values never reach the browser payload');
    for (const u of ['/', '/film/', '/game/', '/shared.css', '/film/app.js', '/game/app.js', '/fonts/Inter.ttf']) assert.equal((await fetch(B + u)).status, 200, u);
    assert.equal((await fetch(B + '/film')).redirected, true);
    assert.equal((await fetch(B + '/%2e%2e/server.mjs')).status, 404);
    assert.equal((await fetch(B + '/api/samples/../server.mjs')).status, 404);
  });
  let fid, sid;
  await test('film: create → patch (prompt regenerates) → comment → frame → export (json, csv, plan, py)', async () => {
    const [s, x] = await j('/api/film/projects', { method: 'POST', body: { title: 'LK', text: script } }); assert.equal(s, 201);
    fid = x.project.id; assert.equal(x.project.shots.length, 29); assert.equal(x.project.rev, 1); sid = x.project.shots[5].id;
    const [ps, px] = await j(`/api/film/projects/${fid}/shots/${sid}?as=dp`, { method: 'PATCH', body: { status: 'approved', lens_mm: 85, size: 'Close-up' } });
    assert.equal(ps, 200); assert.equal(px.shot.status, 'approved'); assert.ok(/85mm/.test(px.shot.prompt)); assert.equal(px.project.rev, 2); assert.ok(px.project.activity.some((a) => a.who === 'dp'));
    const [cs, cx] = await j(`/api/film/projects/${fid}/shots/${sid}/comments?as=director`, { method: 'POST', body: { text: 'hold longer' } }); assert.equal(cs, 201); assert.equal(cx.project.shots[5].comments[0].who, 'director');
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/frame`, { method: 'POST', body: { data_uri: 'data:text/html;base64,PGI+' } }))[0], 400);
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/frame`, { method: 'POST', body: { data_uri: 'data:image/png;base64,iVBORw0KGgo=', label: 'still', concept_mockup: true } }))[0], 201);
    const [, bad] = await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'mock' } }); assert.ok(/image→video/.test(bad.error));
    assert.equal((await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'runway' } }))[0], 409, 'unconfigured provider is a clean 409');
    const [hs, hx] = await j(`/api/film/projects/${fid}/shots/${sid}/clip`, { method: 'POST', body: { provider: 'higgsfield' } });
    assert.equal(hs, 502, 'configured provider with no network fails cleanly'); assert.ok(!/sekrit/.test(JSON.stringify(hx)), 'error text never echoes the key');
    const [js, jx, jh] = await j(`/api/film/projects/${fid}/export/shotlist.json`); assert.equal(js, 200); assert.equal(jx.schema, 'fabled.shotlist/0.1'); assert.equal(jx.script_text, undefined); assert.ok(/attachment/.test(jh.get('content-disposition')));
    const [, csv] = await j(`/api/film/projects/${fid}/export/shotlist.csv`); assert.equal(csv.split('\n').length, 31);
    const [, plan] = await j(`/api/film/projects/${fid}/export/sequencer_plan.json`); assert.equal(plan.shots.length, 29); assert.equal(plan.shots[5].focal_length_mm, 85);
    const [, py] = await j(`/api/film/projects/${fid}/export/unreal.py`); assert.ok(/UNTESTED DRAFT/.test(py) && /fabled.sequencer_plan\/0.1/.test(py));
    assert.equal((await j(`/api/film/projects/${fid}/export/nope`))[0], 404);
    const [, list] = await j('/api/film/projects'); assert.equal(list.projects.length, 1); assert.equal(list.projects[0].summary.shots, 29);
  });
  let gid, aid;
  await test('game: create → mock generation completes → status advances → layout → exports', async () => {
    const [s, x] = await j('/api/game/projects', { method: 'POST', body: { text: pitch } }); assert.equal(s, 201);
    gid = x.project.id; aid = x.project.assets.find((a) => a.asset_name === 'SM_Knight').id; assert.equal(x.project.layout.items.length, x.project.assets.length);
    const [gs, gx] = await j(`/api/game/projects/${gid}/assets/${aid}/generate?as=vendor`, { method: 'POST', body: { provider: 'mock' } }); assert.equal(gs, 202); assert.equal(gx.task.concept_mockup, true); assert.equal(gx.asset.status, 'generating');
    assert.equal((await j(`/api/game/projects/${gid}/assets/${aid}/generate`, { method: 'POST', body: { provider: 'meshy' } }))[0], 409);
    let a; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); const [, g] = await j(`/api/game/projects/${gid}/generations`); a = g.project.assets.find((z) => z.id === aid); if (a.generation.status === 'succeeded') break; }
    assert.equal(a.generation.status, 'succeeded'); assert.equal(a.status, 'generated'); assert.equal(a.generation.outputs[0].local, 'samples/mock_generations/knight_helmet.glb');
    assert.equal((await fetch(`${B}/api/mock-models/knight_helmet.glb`)).status, 200); assert.equal((await fetch(`${B}/api/mock-models/../MOCK_INFO.json`)).status, 404);
    assert.equal((await j(`/api/game/projects/${gid}/assets/${aid}`, { method: 'PATCH', body: { status: 'bogus' } }))[0], 400);
    const [, adv] = await j(`/api/game/projects/${gid}/assets/${aid}?as=tech%20art%20director`, { method: 'PATCH', body: { advance: true } }); assert.equal(adv.asset.status, 'in_pipeline');
    const [, imp] = await j(`/api/game/projects/${gid}/assets/${aid}`, { method: 'PATCH', body: { status: 'imported' } }); assert.equal(imp.project.summary.by_status.imported, 1);
    const [, c] = await j(`/api/game/projects/${gid}/assets/${aid}/comments?as=vendor`, { method: 'POST', body: { text: 'UVs redone' } }); assert.equal(c.comment.who, 'vendor');
    const [, add] = await j(`/api/game/projects/${gid}/layout`, { method: 'POST', body: { asset_id: aid, x: 120, y: -80, yaw: 45 } }); assert.equal(add.item.x, 120);
    const items = add.project.layout.items.slice(0, 3).concat([{ asset_id: 'nope', x: 0, y: 0 }]);
    const [, put] = await j(`/api/game/projects/${gid}/layout`, { method: 'PUT', body: { items } }); assert.equal(put.layout.items.length, 3, 'unknown asset ids are dropped');
    const [, plan] = await j(`/api/game/projects/${gid}/export/blockout_plan.json`); assert.equal(plan.actors.length, 3); assert.ok(plan.actors.every((z) => z.mesh_path.startsWith('/Game/Fabled/')));
    const [, prof] = await j(`/api/game/projects/${gid}/export/import_profiles.json`); assert.equal(prof.profiles.length, 23); assert.ok(/PLACEHOLDER/.test(prof.note));
    const [, kit] = await j(`/api/game/projects/${gid}/export/kit.json`); assert.equal(kit.pitch_text, undefined);
    const [, py] = await j(`/api/game/projects/${gid}/export/unreal.py`); assert.ok(/fabled.blockout_plan\/0.1/.test(py));
  });
  await test('bad input is a clean 4xx, unknown ids 404, delete works', async () => {
    assert.equal((await j('/api/film/projects', { method: 'POST', body: { nope: 1 } }))[0], 400);
    assert.equal((await fetch(`${B}/api/game/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' })).status, 400);
    assert.equal((await j('/api/film/projects/does-not-exist'))[0], 404); assert.equal((await j('/api/film/projects/..%2F..%2Fetc'))[0], 404);
    assert.equal((await j(`/api/film/projects/${fid}`, { method: 'DELETE' }))[0], 200); assert.equal((await j(`/api/film/projects/${fid}`))[0], 404);
    assert.equal((await j(`/api/game/projects/${gid}`, { method: 'DELETE' }))[0], 200);
  });
} finally {
  child.kill(); fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n Demos summary: ${pass}/${pass + fail} passed (${fail} failed)${fail ? '\n  failed: ' + failures.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
