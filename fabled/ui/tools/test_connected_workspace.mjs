#!/usr/bin/env node
/**
 * Connected workspace + AI provider plugin tests (no network, no API keys needed).
 *
 * 1. Provider adapters (Meshy, Tripo, Runway, Higgsfield, mock) against a fake fetch: request shape, auth headers,
 *    status mapping, output extraction, and Higgsfield refusing to send its key to a foreign status host.
 * 2. TaskStore + downloadModel: unconfigured providers refused, kinds validated, image never persisted,
 *    non-https and out-of-root model downloads refused.
 * 3. Live server (ephemeral port): /api/workspace, notes, activity, providers (no secret values leaked),
 *    mock generate → poll → import → reopen input, and bad input handling.
 * 4. Server hardening (tools/test_server_security.mjs): cross-site guard, Content-Type rule, security headers,
 *    traversal, limits, LAN mode. Also runnable on its own.
 *
 * Run: node tools/test_connected_workspace.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runServerSecurityTests } from './test_server_security.mjs';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let total = 0; let passed = 0; const failures = [];
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push({ name, e }); console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); }
}

// Fake fetch: records calls, answers from a route table keyed by "METHOD host/path".
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    const key = `${opts.method || 'GET'} ${u.host}${u.pathname}`;
    calls.push({ key, url: String(url), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined });
    const r = routes[key];
    if (!r) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 });
    const v = typeof r === 'function' ? r(calls.at(-1)) : r;
    const wrapped = v && typeof v === 'object' && 'body' in v; // { status: <http>, body } vs a plain JSON body
    return new Response(JSON.stringify(wrapped ? v.body : v), { status: wrapped ? v.status : 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

async function main() {
  console.log('Fabled connected workspace + provider plugin tests\n');
  const { default: meshy } = await import('../providers/meshy.mjs');
  const { default: tripo } = await import('../providers/tripo.mjs');
  const { default: runway } = await import('../providers/runway.mjs');
  const { default: higgsfield } = await import('../providers/higgsfield.mjs');
  const { default: mock } = await import('../providers/mock.mjs');
  const { TaskStore, listProviders, downloadModel, PROVIDERS } = await import('../providers/index.mjs');

  console.log('Suite 1: provider adapters (fake fetch)');
  await test('Meshy text-to-3d: POST /v2/text-to-3d with Bearer key, result id, SUCCEEDED → glb output', async () => {
    const env = { MESHY_API_KEY: 'msy-secret' };
    const f = fakeFetch({
      'POST api.meshy.ai/openapi/v2/text-to-3d': { result: 'task-1' },
      'GET api.meshy.ai/openapi/v2/text-to-3d/task-1': { status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://assets.meshy.ai/x/model.glb?sig=1' }, thumbnail_url: 'https://assets.meshy.ai/x/t.png' },
    });
    const c = await meshy.create({ kind: 'text-to-3d', prompt: 'dwarf bust' }, { env, fetchImpl: f });
    assert.equal(c.remote_id, 'task-1');
    assert.equal(f.calls[0].headers.Authorization, 'Bearer msy-secret');
    assert.deepEqual(f.calls[0].body, { mode: 'preview', prompt: 'dwarf bust' });
    const p = await meshy.poll({ kind: 'text-to-3d', remote_id: 'task-1' }, { env, fetchImpl: f });
    assert.equal(p.status, 'succeeded');
    assert.equal(p.outputs[0].type, 'model'); assert.equal(p.outputs[0].format, 'glb');
  });
  await test('Meshy image-to-3d sends image_url (data URI ok); FAILED maps to failed with task_error', async () => {
    const env = { MESHY_API_KEY: 'k' };
    const f = fakeFetch({ 'POST api.meshy.ai/openapi/v1/image-to-3d': { result: 't2' }, 'GET api.meshy.ai/openapi/v1/image-to-3d/t2': { status: 'FAILED', task_error: { message: 'bad image' } } });
    await meshy.create({ kind: 'image-to-3d', image: { data_uri: 'data:image/png;base64,AAAA' } }, { env, fetchImpl: f });
    assert.equal(f.calls[0].body.image_url, 'data:image/png;base64,AAAA');
    const p = await meshy.poll({ kind: 'image-to-3d', remote_id: 't2' }, { env, fetchImpl: f });
    assert.equal(p.status, 'failed'); assert.equal(p.error, 'bad image');
    await assert.rejects(meshy.create({ kind: 'image-to-3d' }, { env, fetchImpl: f }), /needs an image/);
    await assert.rejects(meshy.create({ kind: 'image-to-video', image: {} }, { env, fetchImpl: f }), /does not support/);
  });
  await test('HTTP errors surface the provider message, not a stack of JSON', async () => {
    const f = fakeFetch({ 'POST api.meshy.ai/openapi/v2/text-to-3d': { status: 401, body: { message: 'Invalid API key' } } });
    await assert.rejects(meshy.create({ kind: 'text-to-3d', prompt: 'x' }, { env: { MESHY_API_KEY: 'bad' }, fetchImpl: f }), /HTTP 401: Invalid API key/);
  });
  await test('Tripo: task envelope {code,data:{task_id}}, success → pbr_model; image needs a public URL', async () => {
    const env = { TRIPO_API_KEY: 'tsk' };
    const f = fakeFetch({
      'POST api.tripo3d.ai/v2/openapi/task': { code: 0, data: { task_id: 'tp1' } },
      'GET api.tripo3d.ai/v2/openapi/task/tp1': { code: 0, data: { status: 'success', progress: 100, output: { pbr_model: 'https://tripo-data.example/m.glb' } } },
    });
    const c = await tripo.create({ kind: 'text-to-3d', prompt: 'shield' }, { env, fetchImpl: f });
    assert.equal(c.remote_id, 'tp1'); assert.equal(f.calls[0].body.type, 'text_to_model');
    const p = await tripo.poll({ remote_id: 'tp1' }, { env, fetchImpl: f });
    assert.equal(p.status, 'succeeded'); assert.equal(p.outputs[0].url, 'https://tripo-data.example/m.glb');
    await assert.rejects(tripo.create({ kind: 'image-to-3d', image: { data_uri: 'data:image/png;base64,AA' } }, { env, fetchImpl: f }), /public image URL/);
  });
  await test('Runway: X-Runway-Version header, gen4_turbo default, progress 0..1 scaled, output[0] video', async () => {
    const env = { RUNWAYML_API_SECRET: 'rw' };
    const f = fakeFetch({
      'POST api.dev.runwayml.com/v1/image_to_video': { id: 'rw1' },
      'GET api.dev.runwayml.com/v1/tasks/rw1': { status: 'RUNNING', progress: 0.42 },
    });
    await runway.create({ kind: 'image-to-video', prompt: 'orbit', image: { url: 'https://x.example/a.png' } }, { env, fetchImpl: f });
    assert.equal(f.calls[0].headers['X-Runway-Version'], '2024-11-06');
    assert.equal(f.calls[0].body.model, 'gen4_turbo'); assert.equal(f.calls[0].body.promptText, 'orbit');
    const p = await runway.poll({ remote_id: 'rw1' }, { env, fetchImpl: f });
    assert.equal(p.status, 'running'); assert.equal(p.progress, 42);
  });
  await test('Higgsfield: configurable auth; follows status_url only on its own host (key never sent elsewhere)', async () => {
    const env = { HIGGSFIELD_API_KEY: 'hk', HIGGSFIELD_API_SECRET: 'hs' };
    const f = fakeFetch({
      'POST api.higgsfield.ai/wan/v2.7/image-to-video': { request_id: 'r1', status_url: 'https://evil.example/steal' },
      'GET api.higgsfield.ai/requests/r1/status': { status: 'completed', video: { url: 'https://cdn.higgsfield.example/v.mp4' } },
    });
    const c = await higgsfield.create({ kind: 'image-to-video', prompt: 'dolly in', image: { url: 'https://x.example/a.png' } }, { env, fetchImpl: f });
    assert.equal(f.calls[0].headers.Authorization, 'Key hk:hs');
    const p = await higgsfield.poll({ remote_id: c.remote_id, status_url: c.status_url }, { env, fetchImpl: f });
    assert(f.calls.every((x) => !x.url.includes('evil.example')), 'must not call a foreign status host');
    assert.equal(p.status, 'succeeded'); assert.equal(p.outputs[0].type, 'video');
    await assert.rejects(higgsfield.create({ kind: 'image-to-video', image: { url: 'https://x' } }, { env, fetchImpl: f }), /needs a prompt/);
  });
  await test('Higgsfield image input: public https URL as documented; a data URI is sent as image_url only under the size cap', async () => {
    const env = { HIGGSFIELD_API_KEY: 'hk', HIGGSFIELD_API_SECRET: 'hs' };
    const routes = { 'POST api.higgsfield.ai/wan/v2.7/image-to-video': { request_id: 'r2' } };
    const small = `data:image/png;base64,${'A'.repeat(4000)}`;
    // Default behavior is unchanged: a small data URI goes out in image_url (whether the API accepts it is unverified).
    let f = fakeFetch(routes);
    await higgsfield.create({ kind: 'image-to-video', prompt: 'orbit', image: { data_uri: small } }, { env, fetchImpl: f });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, { prompt: 'orbit', image_url: small });
    // A public https URL is passed through whatever the cap is; a URL wins over a data URI.
    f = fakeFetch(routes);
    await higgsfield.create({ kind: 'image-to-video', prompt: 'orbit', image: { url: 'https://cdn.example/still.png', data_uri: small } }, { env: { ...env, HIGGSFIELD_MAX_DATA_URI_BYTES: '0' }, fetchImpl: f });
    assert.equal(f.calls[0].body.image_url, 'https://cdn.example/still.png');
    await assert.rejects(higgsfield.create({ kind: 'image-to-video', prompt: 'orbit', image: { url: 'http://insecure.example/still.png' } }, { env, fetchImpl: f }), /public https URL/);
    await assert.rejects(higgsfield.create({ kind: 'image-to-video', prompt: 'orbit', image: {} }, { env, fetchImpl: f }), /needs a still image/);
  });
  await test('Higgsfield size guard: a data URI over the limit (default 8 MB, HIGGSFIELD_MAX_DATA_URI_BYTES) is refused before any network call', async () => {
    const env = { HIGGSFIELD_API_KEY: 'hk', HIGGSFIELD_API_SECRET: 'hs' };
    const routes = { 'POST api.higgsfield.ai/wan/v2.7/image-to-video': { request_id: 'r3' } };
    const { DEFAULT_MAX_DATA_URI_BYTES } = await import('../providers/higgsfield.mjs');
    assert.equal(DEFAULT_MAX_DATA_URI_BYTES, 8 * 1024 * 1024);
    const prefix = 'data:image/png;base64,';
    const atLimit = prefix + 'A'.repeat(DEFAULT_MAX_DATA_URI_BYTES - prefix.length);
    const create = (data_uri, extraEnv, f) => higgsfield.create({ kind: 'image-to-video', prompt: 'dolly in', image: { data_uri } }, { env: { ...env, ...extraEnv }, fetchImpl: f });
    let f = fakeFetch(routes);
    await create(atLimit, {}, f);
    assert.equal(f.calls.length, 1, 'exactly at the limit is still sent');
    f = fakeFetch(routes);
    await assert.rejects(create(`${atLimit}A`, {}, f), (e) => {
      assert.match(e.message, /8\.0 MB limit/); assert.match(e.message, /HIGGSFIELD_MAX_DATA_URI_BYTES/);
      assert.match(e.message, /public https/); assert.match(e.message, /upload step/); assert.match(e.message, /unverified/);
      assert(!e.message.includes('AAAA'), 'the error must not echo image data');
      return true;
    });
    assert.equal(f.calls.length, 0, 'nothing may be sent to Higgsfield when the image is refused');
    // The limit is configurable; 0 refuses every data URI; junk values fall back to the default.
    f = fakeFetch(routes);
    await assert.rejects(create(prefix + 'A'.repeat(2000), { HIGGSFIELD_MAX_DATA_URI_BYTES: '1000' }, f), /over the 0\.0 MB limit/);
    await assert.rejects(create(prefix + 'AAAA', { HIGGSFIELD_MAX_DATA_URI_BYTES: '0' }, f), /public https/);
    assert.equal(f.calls.length, 0);
    await create(prefix + 'A'.repeat(2000), { HIGGSFIELD_MAX_DATA_URI_BYTES: '4000' }, f);
    await create(`${atLimit}AAAA`, { HIGGSFIELD_MAX_DATA_URI_BYTES: String(16 * 1024 * 1024) }, f);
    for (const junk of ['', 'abc', '-5', 'NaN']) await assert.rejects(create(`${atLimit}A`, { HIGGSFIELD_MAX_DATA_URI_BYTES: junk }, f), /8\.0 MB limit/);
    assert.equal(f.calls.length, 2);
    // No upload endpoint is invented: even with an upload-looking env var set, the only request is the generation itself.
    f = fakeFetch(routes);
    await create(prefix + 'AAAA', { HIGGSFIELD_UPLOAD_PATH: 'files/upload' }, f);
    assert.deepEqual(f.calls.map((c) => c.key), ['POST api.higgsfield.ai/wan/v2.7/image-to-video']);
    // Through the task store (what the server does): the refusal is an error message, nothing is stored or sent.
    f = fakeFetch(routes);
    const store = new TaskStore(path.join(os.tmpdir(), `fabled-hf-${process.pid}.json`), { env, fetchImpl: f });
    await assert.rejects(store.create('higgsfield', { kind: 'image-to-video', prompt: 'dolly in', image: { data_uri: `${atLimit}A` } }), /8\.0 MB limit/);
    assert.equal(store.list().length, 0); assert.equal(f.calls.length, 0);
  });
  await test('Mock provider is labeled CONCEPT MOCKUP and returns the local sample after its ramp', async () => {
    assert.equal(mock.concept_mockup, true);
    const c = await mock.create({ kind: 'text-to-3d', prompt: 'x' });
    const early = await mock.poll({ ...c });
    assert.notEqual(early.status, 'succeeded');
    const done = await mock.poll({ ...c, started_ms: Date.now() - 60_000 });
    assert.equal(done.status, 'succeeded'); assert.equal(done.outputs[0].local, 'samples/mock_generations/knight_helmet.glb'); // "x" hashes to the helmet
    const { pickMockModel } = await import('../providers/mock.mjs');
    assert.equal(pickMockModel('A Knight helmet with a crest'), 'knight_helmet.glb');
    assert.equal(pickMockModel('cozy mushroom cottage'), 'mushroom_cottage.glb');
    assert.equal(pickMockModel('glowing potion'), 'potion_flask.glb');
    assert.equal(pickMockModel('something else'), pickMockModel('something else'), 'deterministic for the same prompt');
    for (const m of ['knight_helmet', 'mushroom_cottage', 'potion_flask']) assert(fs.statSync(path.join(UI_DIR, 'samples', 'mock_generations', `${m}.glb`)).size > 100_000);
  });

  console.log('\nSuite 2: TaskStore + downloadModel');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabled-ws-'));
  await test('listProviders exposes env var names only, never values', () => {
    const list = listProviders({ MESHY_API_KEY: 'super-secret-value' });
    const json = JSON.stringify(list);
    assert(!json.includes('super-secret-value'));
    assert.equal(list.find((p) => p.id === 'meshy').configured, true);
    assert.equal(list.find((p) => p.id === 'runway').configured, false);
    assert.equal(list.length, PROVIDERS.length);
  });
  await test('TaskStore refuses unconfigured providers and unsupported kinds; never stores the image', async () => {
    const store = new TaskStore(path.join(tmp, 'tasks.json'), { env: { FABLED_PROVIDER_MOCK: 'on' } });
    await assert.rejects(store.create('meshy', { kind: 'text-to-3d', prompt: 'x' }), /not configured/);
    await assert.rejects(store.create('mock', { kind: 'image-to-video', prompt: 'x' }), /does not support/);
    await assert.rejects(store.create('nope', { kind: 'text-to-3d' }), /unknown provider/);
    const t = await store.create('mock', { kind: 'image-to-3d', image: { data_uri: 'data:image/png;base64,SECRETPIXELS' }, image_label: 'a.png' });
    assert.equal(t.image_label, 'a.png');
    assert(!fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8').includes('SECRETPIXELS'), 'image data must not be persisted');
    const reloaded = new TaskStore(path.join(tmp, 'tasks.json'), { env: {} });
    assert.equal(reloaded.list().length, 1, 'tasks persist across restarts');
  });
  await test('TaskStore: 40 concurrent saves all succeed and leave one valid file and no temp files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabled-save-'));
    const store = new TaskStore(path.join(dir, 'tasks.json'), { env: { FABLED_PROVIDER_MOCK: 'on' } });
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.create('mock', { kind: 'text-to-3d', prompt: `p${i}` })));
    await Promise.all(Array.from({ length: 40 }, () => store.save()));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).tasks.length, 12);
    assert.deepEqual(fs.readdirSync(dir), ['tasks.json']);
  });
  await test('downloadModel stops reading at the cap when the response has no Content-Length', async () => {
    let pulled = 0;
    const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 5000) c.close(); } });
    const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers(), body, arrayBuffer: async () => { throw new Error('must not buffer the whole body'); } });
    const task = { id: 'gen-capcap', provider: 'p', kind: 'text-to-3d', outputs: [{ type: 'model', format: 'glb', url: 'https://cdn.example/m.glb' }] };
    await assert.rejects(downloadModel(task, tmp, { fetchImpl, maxBytes: 10 * 1024 }), /over the 10240 byte cap/);
    assert(pulled < 100, `stopped early (pulled ${pulled} chunks)`);
    const small = async () => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }) });
    assert.equal(fs.statSync(await downloadModel(task, tmp, { fetchImpl: small, maxBytes: 10 * 1024 })).size, 3);
  });
  await test('downloadModel refuses http URLs and local files outside the allowed roots', async () => {
    const roots = [path.join(UI_DIR, 'samples')];
    await assert.rejects(downloadModel({ id: 'gen-x', provider: 'p', kind: 'text-to-3d', outputs: [{ type: 'model', format: 'glb', url: 'http://insecure.example/m.glb' }] }, tmp, { localRoots: roots }), /non-https/);
    await assert.rejects(downloadModel({ id: 'gen-x', provider: 'p', kind: 'text-to-3d', outputs: [{ type: 'model', format: 'glb', local: '../server.mjs' }] }, tmp, { localRoots: roots }), /allowed folder/);
    await assert.rejects(downloadModel({ id: 'gen-x', provider: 'p', kind: 'text-to-3d', outputs: [{ type: 'video', url: 'https://x/v.mp4' }] }, tmp, { localRoots: roots }), /no 3D model/);
    const okPath = await downloadModel({ id: 'gen-abcdef', provider: 'mock', kind: 'text-to-3d', outputs: [{ type: 'model', format: 'glb', local: 'samples/mock_generations/potion_flask.glb' }] }, tmp, { localRoots: roots });
    assert(fs.statSync(okPath).size > 1000); assert.equal(path.basename(okPath), 'mock_potion_flask_abcdef.glb');
  });

  console.log('\nSuite 3: live server endpoints');
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const server = spawn(process.execPath, ['server.mjs'], { cwd: UI_DIR, env: { ...process.env, PORT: String(port), FABLED_PIPELINE: 'off', FABLED_PROVIDER_MOCK_MS: '300', MESHY_API_KEY: 'sk-live-should-never-leak' }, stdio: 'pipe' });
  const base = `http://127.0.0.1:${port}`;
  const j = async (p, o) => (await fetch(base + p, o)).json();
  // JSON endpoints require Content-Type: application/json (a plain string body would be sent as text/plain → 415).
  const jsonBody = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: typeof value === 'string' ? value : JSON.stringify(value) });
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(`${base}/api/status`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

    await test('GET /api/workspace: groups, real pipeline runs, licensed name applied, sample tri counts from SAMPLE_INFO', async () => {
      const ws = await j('/api/workspace');
      assert.equal(ws.schema, 'fabled.workspace/0.1');
      assert.deepEqual(ws.groups.map((g) => g.id), ['runs', 'uploads', 'generated', 'samples']);
      const all = ws.groups.flatMap((g) => g.assets);
      const out = all.find((a) => a.id === 'run:pipeline/output');
      if (out) {
        assert(!/helen/i.test(out.name), 'licensed sample must not be titled with her name');
        assert.equal(out.open.type, 'output');
      }
      const s = all.find((a) => a.id === 'sample:fabled_sample_head.glb');
      assert.equal(s.triangles.input, 327680);
    });
    await test('GET /api/providers lists all plugins without leaking key values', async () => {
      const r = await fetch(`${base}/api/providers`); const text = await r.text();
      assert(!text.includes('sk-live-should-never-leak'));
      const d = JSON.parse(text);
      assert.equal(d.providers.find((p) => p.id === 'meshy').configured, true);
      assert.equal(d.providers.find((p) => p.id === 'mock').concept_mockup, true);
    });
    await test('Notes: reject bad ids, save, read back, clear', async () => {
      assert.equal((await fetch(`${base}/api/workspace/notes?asset=../../etc`)).status, 400);
      assert.equal((await fetch(`${base}/api/workspace/notes?asset=sample:x`, jsonBody('PUT', 'not json'))).status, 400);
      assert.equal((await fetch(`${base}/api/workspace/notes?asset=sample:x`, { method: 'PUT', body: JSON.stringify({ text: 'sent as text/plain' }) })).status, 415);
      assert.equal((await j('/api/workspace/notes?asset=sample:x')).note, null);
      const id = 'sample:fabled_sample_head.glb';
      const saved = await j(`/api/workspace/notes?asset=${encodeURIComponent(id)}`, jsonBody('PUT', { text: 'Use as the seeded-issues demo.' }));
      assert.equal(saved.note.text, 'Use as the seeded-issues demo.');
      assert.equal((await j(`/api/workspace/notes?asset=${encodeURIComponent(id)}`)).note.text, 'Use as the seeded-issues demo.');
      const ws = await j('/api/workspace');
      assert.equal(ws.groups.flatMap((g) => g.assets).find((a) => a.id === id).has_note, true);
      assert.equal((await j(`/api/workspace/notes?asset=${encodeURIComponent(id)}`, jsonBody('PUT', { text: '' }))).note, null);
    });
    await test('Mock generation: start → poll → import as job → input served → appears in workspace with provenance', async () => {
      const g = await j('/api/providers/mock/generations', jsonBody('POST', { kind: 'text-to-3d', prompt: 'test prompt from suite' }));
      assert(g.ok, g.error);
      let st;
      for (let i = 0; i < 40; i++) { st = (await j(`/api/generations/${g.generation.id}`)).generation; if (st.status === 'succeeded') break; await new Promise((r) => setTimeout(r, 250)); }
      assert.equal(st.status, 'succeeded');
      const imp = await j(`/api/generations/${g.generation.id}/import`, { method: 'POST' });
      assert(imp.ok, imp.error);
      const again = await j(`/api/generations/${g.generation.id}/import`, { method: 'POST' });
      assert.equal(again.job_id, imp.job_id, 'second import must reuse the same job');
      const input = await fetch(`${base}/api/jobs/${imp.job_id}/input`);
      assert.equal(input.status, 200); assert((await input.arrayBuffer()).byteLength > 1000);
      const ws = await j('/api/workspace');
      const a = ws.groups.find((x) => x.id === 'generated').assets.find((x) => x.id === imp.asset_id);
      assert(a, 'imported job must be listed under AI generations');
      assert.equal(a.provenance.prompt, 'test prompt from suite'); assert.equal(a.concept_mockup, true);
      const acts = (await j(`/api/activity?asset=${encodeURIComponent(imp.asset_id)}`)).events;
      assert(acts.some((e) => e.type === 'generation_imported'));
    });
    await test('Generation input validation: bad image sources and unknown ids are refused cleanly', async () => {
      const bad1 = await j('/api/providers/mock/generations', jsonBody('POST', { kind: 'image-to-3d', image: { data_uri: 'data:text/html;base64,PHNjcmlwdD4=' } }));
      assert.equal(bad1.ok, false);
      const bad2 = await j('/api/providers/mock/generations', jsonBody('POST', { kind: 'image-to-3d', image: { url: 'http://insecure.example/a.png' } }));
      assert.equal(bad2.ok, false);
      const bad3 = await j('/api/providers/mock/generations', jsonBody('POST', { kind: 'image-to-3d', image: { job_id: 'zzzzzzzz-0000', rel: '../../server.mjs' } }));
      assert.equal(bad3.ok, false);
      assert.equal((await fetch(`${base}/api/generations/nope`)).status, 404);
      assert.equal((await fetch(`${base}/api/providers/nope/generations`, jsonBody('POST', '{}'))).status, 404);
      const meshy = await j('/api/providers/meshy/generations', jsonBody('POST', { kind: 'text-to-3d' }));
      assert.equal(meshy.ok, false); // configured, but no prompt → adapter refuses before any network call
      assert.match(meshy.error, /prompt/);
    });
    await test('Uploads are logged and listed; read-only open-output jobs are not', async () => {
      const up = await j('/api/jobs?filename=suite_cube.obj', { method: 'POST', body: 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n' });
      assert.equal(up.asset_id, `job:${up.job_id}`);
      await fetch(`${base}/api/open-output?dir=pipeline/output`, { method: 'POST' });
      const ws = await j('/api/workspace');
      const uploads = ws.groups.find((g) => g.id === 'uploads').assets;
      assert(uploads.some((a) => a.id === up.asset_id && a.status.label === 'Uploaded'));
      const acts = (await j(`/api/activity?asset=${encodeURIComponent(up.asset_id)}`)).events;
      assert.equal(acts[0].type, 'uploaded');
    });
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\nSuite 4: server hardening (tools/test_server_security.mjs)');
  await runServerSecurityTests(test);

  console.log(`\n Connected workspace summary: ${passed}/${total} passed (${total - passed} failed)`);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
