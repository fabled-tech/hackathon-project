#!/usr/bin/env node
/**
 * Server hardening tests for server.mjs (no network, no API keys, no npm install needed).
 *
 * A. Loopback server (default bind): cross-site guard (Origin, Sec-Fetch-Site, Host / DNS rebinding), the
 *    Content-Type rule on JSON endpoints, uploads, security headers + CSP, path traversal, body limits,
 *    upload file-name sanitizing, error text without absolute paths, and requests that used to crash the process.
 * B. LAN-mode server (HOST=0.0.0.0, FABLED_ALLOWED_HOSTS): Host rules, upload cap, one pipeline per job,
 *    provider keys withheld from the pipeline's environment.
 * C. Stores (workspace.mjs): note count cap, activity log trimming.
 *
 * Every request here is sent with node:http so the Host / Origin / Content-Type headers are exactly what the test
 * says (fetch would add or forbid some of them).
 *
 * Run: node tools/test_server_security.mjs      (also run as the last suite of tools/test_connected_workspace.mjs)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_DIR = path.resolve(UI_DIR, '..');
const JSON_CT = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// One HTTP request with full control of the headers. host: undefined -> "127.0.0.1:<port>", null -> no Host header.
function raw(port, { method = 'GET', path: p = '/', headers = {}, body = null, host } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (host !== null) h.Host = host ?? `127.0.0.1:${port}`;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, setHost: false, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks); const text = buf.toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, text, json });
      });
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: UI_DIR, env: { ...process.env, PORT: String(port), ...env }, stdio: 'pipe' });
  let exited = false; child.on('exit', () => { exited = true; });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await raw(port, { path: '/api/status' }); if (r.status) break; } catch { await sleep(100); }
    if (exited) throw new Error(`server exited during startup:\n${log}`);
  }
  return { port, child, alive: () => !exited, log: () => log };
}

function importmapHash() {
  const html = fs.readFileSync(path.join(UI_DIR, 'public', 'index.html'), 'utf8');
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert(m, 'index.html must contain the inline importmap');
  return `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
}

export async function runServerSecurityTests(test) {
  const created = []; // job ids made by this run, removed at the end
  const rememberJob = (r) => { if (r.json?.job_id) created.push(r.json.job_id); return r; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabled-sec-'));
  const lanAddr = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address || null;

  // ---------------------------------------------------------------------------------------------------------------
  console.log('\nSecurity suite A: loopback server (cross-site guard, headers, traversal, limits)');
  const A = await startServer({ HOST: '127.0.0.1', FABLED_PIPELINE: 'off', FABLED_VALIDATOR: 'off', FABLED_PROVIDER_MOCK_MS: '300', MESHY_API_KEY: 'sk-live-should-never-leak' });
  const self = `http://127.0.0.1:${A.port}`;
  const upload = async (srv, filename, body = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', headers = {}) =>
    rememberJob(await raw(srv.port, { method: 'POST', path: `/api/jobs?filename=${encodeURIComponent(filename)}`, headers, body }));
  const uploadCount = async () => (await raw(A.port, { path: '/api/workspace' })).json.groups.find((g) => g.id === 'uploads').assets.length
    + (await raw(A.port, { path: '/api/workspace' })).json.groups.find((g) => g.id === 'uploads').hidden_count;
  try {
    await test('No Origin header (Swift app, curl, Node): GET, JSON POST/PUT and upload all work', async () => {
      assert.equal((await raw(A.port, { path: '/api/status' })).status, 200);
      const note = await raw(A.port, { method: 'PUT', path: '/api/workspace/notes?asset=sample%3Asecurity_suite', headers: JSON_CT, body: JSON.stringify({ text: 'native client note' }) });
      assert.equal(note.status, 200); assert.equal(note.json.note.text, 'native client note');
      await raw(A.port, { method: 'PUT', path: '/api/workspace/notes?asset=sample%3Asecurity_suite', headers: JSON_CT, body: JSON.stringify({ text: '' }) });
      const up = await upload(A, 'native.obj');
      assert.equal(up.status, 200); assert(up.json.job_id);
    });

    await test('Same-origin Origin header: accepted (127.0.0.1 and localhost spellings, explicit and default ports)', async () => {
      assert.equal((await raw(A.port, { path: '/api/status', headers: { Origin: self } })).status, 200);
      assert.equal((await raw(A.port, { path: '/api/status', host: `localhost:${A.port}`, headers: { Origin: `http://localhost:${A.port}` } })).status, 200);
      assert.equal((await raw(A.port, { path: '/api/status', host: `LOCALHOST:${A.port}`, headers: { Origin: `http://localhost:${A.port}` } })).status, 200, 'host names compare case-insensitively');
      assert.equal((await raw(A.port, { path: '/api/status', host: 'localhost', headers: { Origin: 'http://localhost' } })).status, 200, 'default port on both sides');
      assert.equal((await raw(A.port, { path: '/api/status', host: 'localhost:80', headers: { Origin: 'http://localhost' } })).status, 200, 'explicit :80 equals the http default');
      const up = await upload(A, 'same_origin.obj', undefined, { Origin: self });
      assert.equal(up.status, 200);
    });

    await test('Foreign Origin: 403 JSON on every /api/ method, nothing is done, and no CORS header is ever sent', async () => {
      const before = await uploadCount();
      const notesBefore = (await raw(A.port, { path: '/api/workspace/notes?asset=sample%3Acsrf_probe' })).json.note;
      for (const origin of ['https://evil.example', 'http://evil.example:5178', `http://127.0.0.1:${A.port + 1}`, `http://localhost:${A.port}`, `http://127.0.0.1.evil.example:${A.port}`, 'null', 'garbage']) {
        const attempts = [
          await raw(A.port, { path: '/api/status', headers: { Origin: origin } }),
          await raw(A.port, { path: '/api/workspace', headers: { Origin: origin } }),
          await raw(A.port, { method: 'POST', path: '/api/jobs?filename=csrf.obj', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: 'v 0 0 0' }),
          await raw(A.port, { method: 'POST', path: '/api/open-output?dir=pipeline/output', headers: { Origin: origin } }),
          await raw(A.port, { method: 'PUT', path: '/api/workspace/notes?asset=sample%3Acsrf_probe', headers: { Origin: origin, ...JSON_CT }, body: JSON.stringify({ text: 'planted' }) }),
          await raw(A.port, { method: 'POST', path: '/api/providers/mock/generations', headers: { Origin: origin, ...JSON_CT }, body: JSON.stringify({ kind: 'text-to-3d', prompt: 'csrf probe prompt' }) }),
          await raw(A.port, { method: 'OPTIONS', path: '/api/providers/mock/generations', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }),
        ];
        for (const r of attempts) {
          assert.equal(r.status, 403, `Origin ${origin} must be refused`);
          assert.equal(r.json.ok, false); assert.match(r.headers['content-type'], /application\/json/);
          assert(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')), 'no Access-Control-* header');
        }
      }
      assert.equal(await uploadCount(), before, 'a refused upload must not create a job');
      assert.deepEqual((await raw(A.port, { path: '/api/workspace/notes?asset=sample%3Acsrf_probe' })).json.note, notesBefore, 'a refused note must not be stored');
      const gens = (await raw(A.port, { path: '/api/providers' })).json.generations;
      assert(!gens.some((g) => g.prompt === 'csrf probe prompt'), 'a refused generation must not be started');
      // Also no CORS header on normal answers or on an unanswered preflight without Origin.
      for (const r of [await raw(A.port, { path: '/api/status' }), await raw(A.port, { path: '/' }), await raw(A.port, { method: 'OPTIONS', path: '/api/status' })]) {
        assert(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')));
      }
    });

    await test('Sec-Fetch-Site: cross-site and same-site are refused on /api/ (covers GETs without Origin), same-origin and none pass', async () => {
      assert.equal((await raw(A.port, { path: '/api/workspace', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
      assert.equal((await raw(A.port, { path: '/api/status', headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
      assert.equal((await raw(A.port, { path: '/api/status', headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
      assert.equal((await raw(A.port, { path: '/api/status', headers: { 'Sec-Fetch-Site': 'none' } })).status, 200);
      assert.equal((await raw(A.port, { path: '/', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200, 'a link from another site may still open the app itself');
    });

    await test('Bad Host on a loopback bind is 403 (DNS rebinding): only localhost, 127.0.0.1 and [::1] are accepted, any port', async () => {
      for (const host of [`localhost:${A.port}`, `127.0.0.1:${A.port}`, `[::1]:${A.port}`, '127.0.0.1', 'localhost:1', 'localhost.']) {
        assert.equal((await raw(A.port, { path: '/api/status', host })).status, 200, `Host ${host} must be accepted`);
      }
      const bad = ['evil.example', `evil.example:${A.port}`, `rebind.127.0.0.1.nip.io:${A.port}`, `192.168.1.20:${A.port}`, '0.0.0.0', `127.0.0.1.evil.example:${A.port}`, `localhost.evil.example`, `evil.example@127.0.0.1:${A.port}`, `127.0.0.1:${A.port}/x`];
      if (lanAddr) bad.push(`${lanAddr}:${A.port}`); // this machine's own LAN address is not valid for a loopback bind
      for (const host of bad) {
        for (const p of ['/api/status', '/api/workspace', '/']) {
          const r = await raw(A.port, { path: p, host });
          assert.equal(r.status, 403, `Host ${host} must be refused on ${p}`);
          assert.equal(r.json.ok, false);
        }
        const post = await raw(A.port, { method: 'POST', path: '/api/jobs?filename=rebind.obj', host, body: 'v 0 0 0' });
        assert.equal(post.status, 403);
      }
      // A rebinding page is same-origin from the browser's point of view; the Host check still refuses it.
      const rebind = await raw(A.port, { path: '/api/workspace', host: `evil.example:${A.port}`, headers: { Origin: `http://evil.example:${A.port}`, 'Sec-Fetch-Site': 'same-origin' } });
      assert.equal(rebind.status, 403);
    });

    await test('Malformed Host header or request target is a 4xx, and the server keeps running', async () => {
      const r1 = await raw(A.port, { path: '/api/status', host: 'a b' }); // crashed the process before the fix
      assert(r1.status === 400 || r1.status === 403, `got ${r1.status}`);
      const r2 = await raw(A.port, { path: '//' });
      assert(r2.status >= 400 && r2.status < 500 || r2.status === 200, `got ${r2.status}`);
      const r3 = await raw(A.port, { path: '/%E0%A4%A' });
      assert.equal(r3.status, 400);
      const r4 = await raw(A.port, { path: '/api/jobs/%E0%A4%A/result' });
      assert(r4.status >= 400 && r4.status < 500);
      const r5 = await raw(A.port, { path: '/api/status', host: '[::1' });
      assert.equal(r5.status, 403);
      const r6 = await raw(A.port, { method: 'POST', path: '/api/jobs/aaaaaaaa-0000/process', headers: JSON_CT, body: 'null' });
      assert(r6.status >= 400 && r6.status < 500);
      await sleep(150);
      assert(A.alive(), `server must survive malformed requests:\n${A.log().slice(-600)}`);
      assert.equal((await raw(A.port, { path: '/api/status' })).status, 200);
    });

    let jobId = null;
    await test('JSON endpoints: 415 without Content-Type: application/json; the web UI\'s same-origin text/plain is the one exception', async () => {
      const up = await upload(A, 'ctype.obj'); jobId = up.json.job_id;
      const profile = JSON.stringify({ name: 'security suite', lod_budget: [{ level: 0, max_triangles: 100, screen_size: 1 }] });
      const routes = [
        ['POST', `/api/jobs/${jobId}/process`, profile],
        ['POST', `/api/jobs/${jobId}/validate`, profile],
        ['PUT', '/api/workspace/notes?asset=sample%3Actype_probe', JSON.stringify({ text: 'ctype probe' })],
        ['POST', '/api/providers/mock/generations', JSON.stringify({ kind: 'text-to-3d', prompt: 'ctype probe prompt' })],
      ];
      for (const [method, p, body] of routes) {
        for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'text/plain;charset=UTF-8' }, { 'Content-Type': 'application/x-www-form-urlencoded' },
          { 'Content-Type': 'multipart/form-data; boundary=x' }, {}, { 'Content-Type': 'application/x-www-form-urlencoded', Origin: self }]) {
          const r = await raw(A.port, { method, path: p, headers, body });
          assert.equal(r.status, 415, `${method} ${p} with ${JSON.stringify(headers)} must be 415, got ${r.status}`);
          assert.equal(r.json.ok, false);
        }
      }
      assert.equal((await raw(A.port, { path: '/api/workspace/notes?asset=sample%3Actype_probe' })).json.note, null, 'a 415 must not store the note');
      assert(!(await raw(A.port, { path: '/api/providers' })).json.generations.some((g) => g.prompt === 'ctype probe prompt'), 'a 415 must not start a generation');
      // Accepted: application/json (with or without parameters, any case) from anyone ...
      for (const ct of ['application/json', 'application/json; charset=utf-8', 'Application/JSON']) {
        for (const [method, p, body] of routes.slice(0, 3)) {
          const r = await raw(A.port, { method, path: p, headers: { 'Content-Type': ct }, body });
          assert.equal(r.status, 200, `${method} ${p} with ${ct} must be accepted, got ${r.status} ${r.text.slice(0, 120)}`);
        }
      }
      // ... and what public/app.js / workspace.js send today: a JSON string with no explicit Content-Type, which the
      // browser labels text/plain, together with a same-origin Origin (or Sec-Fetch-Site: same-origin).
      for (const proof of [{ Origin: self }, { 'Sec-Fetch-Site': 'same-origin' }, { Origin: self, 'Sec-Fetch-Site': 'same-origin' }]) {
        for (const [method, p, body] of routes.slice(0, 3)) {
          const r = await raw(A.port, { method, path: p, headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...proof }, body });
          assert.equal(r.status, 200, `web UI style ${method} ${p} must be accepted, got ${r.status}`);
        }
      }
      const gen = await raw(A.port, { method: 'POST', path: '/api/providers/mock/generations', headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: self }, body: JSON.stringify({ kind: 'text-to-3d', prompt: 'web ui style prompt' }) });
      assert.equal(gen.status, 200); assert.equal(gen.json.ok, true);
      await raw(A.port, { method: 'PUT', path: '/api/workspace/notes?asset=sample%3Actype_probe', headers: JSON_CT, body: '{"text":""}' });
      // Malformed or non-object JSON is a 400, not a 415 and not a crash.
      for (const body of ['not json', '[1,2]', '"text"', 'null', '42']) {
        const r = await raw(A.port, { method: 'POST', path: `/api/jobs/${jobId}/validate`, headers: JSON_CT, body });
        assert.equal(r.status, 400, `body ${body}`);
      }
    });

    await test('Upload still works with any or no Content-Type (binary, octet-stream, text/plain); multipart is refused', async () => {
      const bin = Buffer.concat([Buffer.from('glTF'), crypto.randomBytes(300_000)]);
      for (const headers of [{}, { 'Content-Type': 'application/octet-stream' }, { 'Content-Type': 'model/gltf-binary' }, { 'Content-Type': 'text/plain;charset=UTF-8' },
        { 'Content-Type': 'application/x-www-form-urlencoded' }, { Origin: self }]) {
        const up = await upload(A, 'binary upload.glb', bin, headers);
        assert.equal(up.status, 200, `upload with ${JSON.stringify(headers)}`);
        assert.equal(path.basename(up.json.input_path), 'binary_upload.glb');
        const back = await raw(A.port, { path: `/api/jobs/${up.json.job_id}/input` });
        assert.equal(back.status, 200); assert(back.buf.equals(bin), 'the stored upload must be byte-identical');
      }
      const before = await uploadCount();
      const mp = await raw(A.port, { method: 'POST', path: '/api/jobs?filename=form.obj', headers: { 'Content-Type': 'multipart/form-data; boundary=----x' }, body: '------x\r\nContent-Disposition: form-data; name="f"\r\n\r\nv 0 0 0\r\n------x--\r\n' });
      assert.equal(mp.status, 415);
      assert.equal(await uploadCount(), before);
    });

    await test('Security headers on every response; HTML gets a CSP that allows exactly the inline importmap by hash', async () => {
      const responses = {
        html: await raw(A.port, { path: '/' }),
        css: await raw(A.port, { path: '/styles.css' }),
        js: await raw(A.port, { path: '/app.js' }),
        sample: await raw(A.port, { path: '/samples/SAMPLE_INFO.json' }),
        api: await raw(A.port, { path: '/api/status' }),
        api404: await raw(A.port, { path: '/api/nope' }),
        static404: await raw(A.port, { path: '/nope.html' }),
        forbidden: await raw(A.port, { path: '/api/status', headers: { Origin: 'https://evil.example' } }),
        badHost: await raw(A.port, { path: '/', host: 'evil.example' }),
        unsupported: await raw(A.port, { method: 'POST', path: `/api/jobs/${jobId}/validate`, headers: { 'Content-Type': 'text/plain' }, body: '{}' }),
        input: await raw(A.port, { path: `/api/jobs/${jobId}/input` }),
      };
      for (const [name, r] of Object.entries(responses)) {
        assert.equal(r.headers['x-content-type-options'], 'nosniff', `${name}: nosniff`);
        assert.equal(r.headers['referrer-policy'], 'no-referrer', `${name}: referrer policy`);
        assert.equal(r.headers['x-frame-options'], 'DENY', `${name}: frame options`);
        assert(r.headers['content-security-policy'], `${name}: CSP present`);
        assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/, `${name}: frame-ancestors`);
      }
      assert.equal(responses.html.status, 200);
      const csp = responses.html.headers['content-security-policy'];
      const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
      assert.deepEqual(directives['script-src'], ["'self'", importmapHash()], 'script-src is self plus the importmap hash, nothing else');
      assert(!csp.includes("'unsafe-eval'"));
      assert.deepEqual(directives['default-src'], ["'self'"]);
      assert.deepEqual(directives['object-src'], ["'none'"]);
      assert.deepEqual(directives['base-uri'], ["'none'"]);
      assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
      assert(directives['style-src'].includes("'unsafe-inline'"), 'inline style attributes keep working');
      for (const src of ["'self'", 'data:', 'blob:', 'https:']) assert(directives['img-src'].includes(src), `img-src ${src}`);
      for (const src of ["'self'", 'blob:', 'https:']) assert(directives['media-src'].includes(src), `media-src ${src}`);
      for (const src of ["'self'", 'blob:', 'data:']) assert(directives['connect-src'].includes(src), `connect-src ${src}`);
      assert(!directives['connect-src'].includes('https:') && !directives['connect-src'].includes('*'), 'fetch stays same-origin');
      // Everything that is not the app's HTML is inert if navigated to.
      for (const name of ['api', 'input', 'sample', 'api404']) assert.match(responses[name].headers['content-security-policy'], /default-src 'none'.*sandbox/, `${name}: inert CSP`);
      assert.match(responses.css.headers['content-type'], /text\/css/); assert.match(responses.js.headers['content-type'], /text\/javascript/);
    });

    await test('An uploaded .html / .js / .svg can never run in the app\'s origin', async () => {
      const page = '<!doctype html><script>fetch("/api/workspace")</script>';
      const up = await upload(A, 'evil.html', page);
      assert.equal(up.status, 200);
      const back = await raw(A.port, { path: `/api/jobs/${up.json.job_id}/input` });
      assert.equal(back.status, 200); assert.equal(back.text, page);
      assert.match(back.headers['content-type'], /^text\/plain/); assert(!/html/.test(back.headers['content-type']));
      assert.match(back.headers['content-security-policy'], /sandbox/); assert.equal(back.headers['x-content-type-options'], 'nosniff');
      const js = await upload(A, 'evil.js', 'alert(1)');
      assert.match((await raw(A.port, { path: `/api/jobs/${js.json.job_id}/input` })).headers['content-type'], /^text\/plain/);
      const svg = await upload(A, 'evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      assert.match((await raw(A.port, { path: `/api/jobs/${svg.json.job_id}/input` })).headers['content-security-policy'], /default-src 'none'.*sandbox/);
    });

    await test('Path traversal is refused on every route that maps a URL to a file', async () => {
      const marker = '#!/usr/bin/env node'; // first line of server.mjs
      const secretNames = ['job.json', 'server.mjs', 'package.json'];
      const leaked = (r) => r.status === 200 && (r.text.includes(marker) || r.text.includes('"fabled-demo-ui"') || r.text.includes('"job_id"'));
      const up = await upload(A, 'trav.obj'); const id = up.json.job_id;
      const jobFolder = path.join(UI_DIR, 'work', id);
      const paths = [
        // job output files: <rel> must stay inside the job's out/ folder
        `/api/jobs/${id}/files/../job.json`, `/api/jobs/${id}/files/..%2Fjob.json`, `/api/jobs/${id}/files/%2e%2e%2fjob.json`, `/api/jobs/${id}/files/..%5Cjob.json`,
        `/api/jobs/${id}/files/..%2F..%2F..%2Fserver.mjs`, `/api/jobs/${id}/files/%2Fetc%2Fpasswd`, `/api/jobs/${id}/files//etc/passwd`,
        `/api/jobs/${id}/files/${encodeURIComponent(path.join(UI_DIR, 'server.mjs'))}`, `/api/jobs/${id}/files/x%00/../../job.json`, `/api/jobs/${id}/files/..%252Fjob.json`,
        `/api/jobs/${id}/files/a/files/../../../job.json`,
        // job id must be a plain id
        '/api/jobs/..%2F..%2Fpublic/input', '/api/jobs/%2e%2e/result', '/api/jobs/..%2F..%2F..%2Fetc/files/passwd', `/api/jobs/${id.toUpperCase()}X/result`, '/api/jobs/aaaaaaaa%2F..%2F..%2Fsamples/input',
        // static roots
        '/samples/..%2Fserver.mjs', '/samples/%2e%2e%2fserver.mjs', '/samples/../server.mjs', '/samples/..%5C..%5Cserver.mjs', `/samples/${encodeURIComponent(path.join(UI_DIR, 'server.mjs'))}`, '/samples//etc/passwd',
        '/vendor/three/..%2F..%2Fpackage.json', '/vendor/three/..%2F..%2F..%2Fserver.mjs', '/vendor/three/%2Fetc%2Fpasswd',
        '/stub/..%2Fserver.mjs', '/demo-data/..%2F..%2Fserver.mjs', '/..%2Fserver.mjs', '/%2e%2e%2fserver.mjs', '/..%2Fwork%2Fprovider_tasks.json', '/..%2Fwork%2Fworkspace_notes.json',
        `/..%2Fwork%2F${id}%2Fjob.json`, '/%2Fetc%2Fpasswd',
      ];
      for (const p of paths) {
        const r = await raw(A.port, { path: p });
        assert(r.status >= 400 && r.status < 500, `${p} must be refused, got ${r.status}`);
        assert(!leaked(r), `${p} leaked a file`);
        assert(!r.text.includes('root:'), `${p} leaked /etc/passwd`);
      }
      assert(secretNames.length);
      // saved-report: only *.report.json under validator/reports
      for (const q of ['../../ui/server.mjs', '../../ui/package.json', '/etc/passwd', '../x.report.json', '../../ui/work/x.report.json', '..%2F..%2Fui%2Fserver.mjs', path.join(UI_DIR, 'server.mjs'), '']) {
        const r = await raw(A.port, { path: `/api/saved-report?path=${encodeURIComponent(q)}` });
        assert.equal(r.json?.ok, false, `saved-report ${q} must be refused`); assert(!leaked(r));
      }
      // open-output: only pipeline/output, pipeline/runs/*, ui/test_fixtures/*
      for (const dir of ['..', '../..', '/', '/etc', 'ui', 'ui/work', `ui/work/${id}`, 'pipeline/output/../../ui', 'pipeline/runs/../../validator', 'ui/test_fixtures/../work', 'pipeline', PROTO_DIR, 'pipeline/output\0/../../ui']) {
        const r = await raw(A.port, { method: 'POST', path: `/api/open-output?dir=${encodeURIComponent(dir)}` });
        assert.equal(r.json?.ok, false, `open-output ${JSON.stringify(dir)} must be refused`);
        assert.match(r.json.error, /not an allowed output folder/);
      }
      // A symlink inside a served folder cannot point out of it (job out/ files and the image picker for generations).
      fs.symlinkSync(path.join(UI_DIR, 'server.mjs'), path.join(jobFolder, 'out', 'link.mjs'));
      fs.symlinkSync(path.join(UI_DIR, 'screenshots'), path.join(jobFolder, 'out', 'shots'));
      fs.writeFileSync(path.join(jobFolder, 'out', 'real.txt'), 'inside');
      const viaLink = await raw(A.port, { path: `/api/jobs/${id}/files/link.mjs` });
      assert.equal(viaLink.status, 404); assert(!leaked(viaLink));
      assert.equal((await raw(A.port, { path: `/api/jobs/${id}/files/real.txt` })).text, 'inside', 'real files inside out/ are still served');
      const pic = fs.readdirSync(path.join(UI_DIR, 'screenshots')).find((f) => /\.png$/i.test(f));
      if (pic) {
        const g = await raw(A.port, { method: 'POST', path: '/api/providers/mock/generations', headers: JSON_CT, body: JSON.stringify({ kind: 'image-to-3d', image: { job_id: id, rel: `shots/${pic}` } }) });
        assert.equal(g.json.ok, false, 'an image reached through a symlink out of the job folder must be refused');
      }
    });

    await test('Upload file names from ?filename= are sanitized and can never collide with the server\'s own job files', async () => {
      const cases = {
        '../../evil.sh': 'evil.sh', '/etc/cron.d/x': 'x', 'job.json': 'upload_job.json', 'JOB.JSON': 'upload_JOB.JSON', 'job.json.tmp.1': 'upload_job.json.tmp.1',
        'validator_report.json': 'upload_validator_report.json', 'profile.json': 'upload_profile.json', 'pipeline_config.json': 'upload_pipeline_config.json',
        'validator_profile_export.json': 'upload_validator_profile_export.json', out: 'upload_out', '.hidden': 'hidden', '..': 'upload.bin', '.': 'upload.bin', '': 'upload.bin',
        'a b;rm -rf $HOME`id`|x.obj': 'a_b_rm_-rf__HOME_id__x.obj', '--config=x.obj': '--config_x.obj', 'ünïcode mesh.glb': '_n_code_mesh.glb', 'x\0y.obj': 'x_y.obj',
        [`${'a'.repeat(400)}.glb`]: `${'a'.repeat(116)}.glb`,
      };
      for (const [asked, expected] of Object.entries(cases)) {
        const up = await upload(A, asked);
        assert.equal(up.status, 200, `upload ${JSON.stringify(asked)}`);
        assert.equal(path.basename(up.json.input_path), expected, `filename ${JSON.stringify(asked)}`);
        assert.equal(path.dirname(up.json.input_path), path.join(UI_DIR, 'work', up.json.job_id), 'the upload stays inside its job folder');
        assert.equal(JSON.parse(fs.readFileSync(path.join(UI_DIR, 'work', up.json.job_id, 'job.json'), 'utf8')).job_id, up.json.job_id, 'job.json is the server\'s own');
      }
      // An upload named like the server's report file is not read back as a validator result.
      const fake = await upload(A, 'validator_report.json', JSON.stringify({ overall_status: 'pass', summary: { total: 1, pass: 1 } }));
      const assets = (await raw(A.port, { path: '/api/workspace' })).json.groups.flatMap((g) => g.assets);
      const a = assets.find((x) => x.id === fake.json.asset_id);
      if (a) { assert.equal(a.validator, null); assert.equal(a.status.label, 'Uploaded'); }
    });

    await test('Request bodies are bounded: oversized JSON is a 413 and the server stays up', async () => {
      const big = JSON.stringify({ name: 'x', pad: 'a'.repeat(1_500_000) });
      for (const p of [`/api/jobs/${jobId}/process`, `/api/jobs/${jobId}/validate`]) {
        const r = await raw(A.port, { method: 'POST', path: p, headers: JSON_CT, body: big });
        assert.equal(r.status, 413, `${p} got ${r.status}`); assert.equal(r.json.ok, false);
      }
      const note = await raw(A.port, { method: 'PUT', path: '/api/workspace/notes?asset=sample%3Abig_note', headers: JSON_CT, body: JSON.stringify({ text: 'n'.repeat(400_000) }) });
      assert.equal(note.status, 413);
      assert.equal((await raw(A.port, { path: '/api/workspace/notes?asset=sample%3Abig_note' })).json.note, null);
      // Chunked (no Content-Length) bodies are counted as they arrive.
      const chunked = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: A.port, method: 'POST', path: `/api/jobs/${jobId}/validate`, headers: { ...JSON_CT, Host: `127.0.0.1:${A.port}` }, setHost: false, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve(413) : reject(e)));
        req.write('{"pad":"'); for (let i = 0; i < 30; i++) req.write('a'.repeat(100_000)); req.end('"}');
      });
      assert.equal(chunked, 413);
      await sleep(100);
      assert(A.alive()); assert.equal((await raw(A.port, { path: '/api/status' })).status, 200);
      assert.equal((await raw(A.port, { path: `/api/jobs/${jobId}/progress` })).json.running, false, 'a refused process request leaves no run behind');
    });

    await test('Error responses do not leak absolute filesystem paths or environment values', async () => {
      const probes = [
        await raw(A.port, { path: `/api/jobs/${jobId}/result` }),                                    // no manifest in <job>/out
        await raw(A.port, { path: '/api/jobs/aaaaaaaa-0000/result' }),                               // unknown job
        await raw(A.port, { method: 'POST', path: '/api/open-output?dir=../..' }),
        await raw(A.port, { method: 'POST', path: '/api/open-output?dir=ui/test_fixtures/does_not_exist' }),
        await raw(A.port, { path: '/api/saved-report?path=missing.report.json' }),
        await raw(A.port, { path: `/api/jobs/${jobId}/files/nope.png` }),
        await raw(A.port, { path: '/samples/..%2Fserver.mjs' }),
        await raw(A.port, { method: 'POST', path: '/api/providers/mock/generations', headers: JSON_CT, body: JSON.stringify({ kind: 'image-to-3d', image: { job_id: jobId, rel: 'missing.png' } }) }),
        await raw(A.port, { method: 'POST', path: '/api/providers/meshy/generations', headers: JSON_CT, body: JSON.stringify({ kind: 'text-to-3d' }) }),
        await raw(A.port, { method: 'POST', path: `/api/jobs/${jobId}/validate`, headers: JSON_CT, body: '{bad' }),
        await raw(A.port, { path: '/api/jobs/BAD/result' }),
      ];
      const forbidden = [PROTO_DIR, path.dirname(PROTO_DIR), os.homedir(), 'sk-live-should-never-leak'].filter((s) => s && s.length > 1);
      for (const r of probes) {
        const error = JSON.stringify(r.json?.error ?? r.text);
        for (const f of forbidden) assert(!error.includes(f), `error text leaks ${f}: ${error.slice(0, 200)}`);
      }
      assert.match(probes[0].json.error, /no manifest\.json in ui\/work\//, 'paths in errors are relative to fabled/');
      assert.equal(probes[1].status, 404);
      // A job folder without job.json (e.g. left by a crash) reads as an unknown job, not as a raw ENOENT with its path.
      const orphan = 'zzzzzzzz-orphan-sec'; fs.mkdirSync(path.join(UI_DIR, 'work', orphan), { recursive: true }); created.push(orphan);
      const o = await raw(A.port, { path: `/api/jobs/${orphan}/result` });
      assert.equal(o.status, 404); assert.equal(o.json.error, 'unknown job');
    });
  } finally {
    A.child.kill();
  }

  // ---------------------------------------------------------------------------------------------------------------
  console.log('\nSecurity suite B: LAN mode (HOST=0.0.0.0) and spawned-process rules');
  // The pipeline override records the environment the pipeline process gets, then stays alive for a moment.
  const B = await startServer({ HOST: '0.0.0.0', FABLED_ALLOWED_HOSTS: ' studio.test , Other.Test:5178,', FABLED_UPLOAD_MAX_BYTES: '2000', FABLED_VALIDATOR: 'off',
    FABLED_PIPELINE: '', FABLED_PIPELINE_CMD: 'env > {out}/env.txt; sleep 1', MESHY_API_KEY: 'sk-child-must-not-see', HIGGSFIELD_API_KEY: 'hf-child-id', HIGGSFIELD_API_SECRET: 'hf-child-secret' });
  try {
    await test('LAN mode: Host may be the bind address, any of this machine\'s interface addresses, localhost, or a FABLED_ALLOWED_HOSTS name', async () => {
      const mine = Object.values(os.networkInterfaces()).flat().filter(Boolean).map((a) => (a.family === 'IPv6' ? `[${a.address}]` : a.address));
      assert(mine.length > 0, 'this machine reports no network interfaces');
      const ok = [...mine.map((a) => `${a}:${B.port}`), `0.0.0.0:${B.port}`, `localhost:${B.port}`, `127.0.0.1:${B.port}`, 'studio.test', `studio.test:${B.port}`, 'other.test:5178', 'OTHER.TEST.', `Studio.Test:${B.port}`];
      for (const host of ok) {
        assert.equal((await raw(B.port, { path: '/api/status', host })).status, 200, `Host ${host} must be accepted in LAN mode`);
        assert.equal((await raw(B.port, { path: '/', host })).status, 200, `Host ${host} must be accepted for the app itself`);
      }
      const notMine = ['10.99.99.99', '192.168.250.250', '203.0.113.7'].filter((a) => !mine.includes(a));
      for (const host of ['evil.example', `evil.example:${B.port}`, 'studio.test.evil.example', 'notstudio.test', ...notMine.map((a) => `${a}:${B.port}`)]) {
        assert.equal((await raw(B.port, { path: '/api/status', host })).status, 403, `Host ${host} must be refused in LAN mode`);
        assert.equal((await raw(B.port, { method: 'POST', path: '/api/jobs?filename=lan.obj', host, body: 'v 0 0 0' })).status, 403);
      }
    });
    await test('LAN mode: the Origin rule is unchanged (a page served from the LAN address is same-origin, other sites are not)', async () => {
      const addr = lanAddr || '127.0.0.1';
      const host = `${addr}:${B.port}`;
      assert.equal((await raw(B.port, { path: '/api/workspace', host, headers: { Origin: `http://${host}` } })).status, 200);
      const put = await raw(B.port, { method: 'PUT', path: '/api/workspace/notes?asset=sample%3Alan_probe', host, headers: { Origin: `http://${host}`, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ text: '' }) });
      assert.equal(put.status, 200, 'the web UI opened from an iPad on the LAN keeps working');
      assert.equal((await raw(B.port, { path: '/api/workspace', host, headers: { Origin: 'https://evil.example' } })).status, 403);
      assert.equal((await raw(B.port, { path: '/api/workspace', host, headers: { Origin: `http://studio.test:${B.port}` } })).status, 403, 'an allowed name is still a different origin than the Host in use');
      assert.equal((await raw(B.port, { path: '/api/workspace', host: `studio.test:${B.port}`, headers: { Origin: `http://studio.test:${B.port}` } })).status, 200);
      assert.equal((await raw(B.port, { path: '/api/status', host })).status, 200, 'native clients (no Origin) on the LAN address work');
    });
    await test('Upload cap (FABLED_UPLOAD_MAX_BYTES): over the limit is a 413 and leaves no job behind; under it works', async () => {
      const jobsBefore = fs.readdirSync(path.join(UI_DIR, 'work')).length;
      const over = await raw(B.port, { method: 'POST', path: '/api/jobs?filename=big.obj', body: Buffer.alloc(5000, 0x61) });
      assert.equal(over.status, 413);
      const chunked = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: B.port, method: 'POST', path: '/api/jobs?filename=big_chunked.obj', headers: { Host: `127.0.0.1:${B.port}` }, setHost: false, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve(413) : reject(e)));
        for (let i = 0; i < 10; i++) req.write(Buffer.alloc(1000, 0x62)); req.end();
      });
      assert.equal(chunked, 413);
      await sleep(200);
      assert.equal(fs.readdirSync(path.join(UI_DIR, 'work')).length, jobsBefore, 'a refused upload must not leave a job folder');
      const ok = rememberJob(await raw(B.port, { method: 'POST', path: '/api/jobs?filename=small.obj', body: Buffer.alloc(1500, 0x63) }));
      assert.equal(ok.status, 200);
    });
    await test('Pipeline start: one run per job even for simultaneous requests, and the child never sees provider API keys', async () => {
      const up = rememberJob(await raw(B.port, { method: 'POST', path: '/api/jobs?filename=race.obj', body: 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n' }));
      const id = up.json.job_id;
      const start = () => raw(B.port, { method: 'POST', path: `/api/jobs/${id}/process`, headers: JSON_CT, body: JSON.stringify({ engine: 'native; rm -rf /', profile: { name: 'race' } }) });
      const results = (await Promise.all([start(), start(), start(), start()])).map((r) => r.json);
      assert(results.every((r) => r.ok && r.started), JSON.stringify(results));
      assert.equal(results.filter((r) => !r.already_running).length, 1, 'exactly one request may start the pipeline');
      assert(['native', 'blender'].includes(results.find((r) => !r.already_running).engine), 'engine is one of the two known values, never the raw request string');
      let env = null;
      for (let i = 0; i < 40 && !env; i++) { const r = await raw(B.port, { path: `/api/jobs/${id}/files/env.txt` }); if (r.status === 200 && r.text.includes('PATH=')) env = r.text; else await sleep(100); }
      assert(env, 'the pipeline override must have written its environment');
      for (const secret of ['sk-child-must-not-see', 'hf-child-id', 'hf-child-secret', 'MESHY_API_KEY', 'HIGGSFIELD_API_SECRET']) assert(!env.includes(secret), `pipeline environment contains ${secret}`);
      assert.match(env, /PATH=/, 'ordinary environment still reaches the pipeline');
      for (let i = 0; i < 40; i++) { if (!(await raw(B.port, { path: `/api/jobs/${id}/progress` })).json.running) break; await sleep(100); }
      assert((await raw(B.port, { path: '/api/providers' })).json.providers.find((p) => p.id === 'meshy').configured, 'the server itself still has the key');
    });
  } finally {
    B.child.kill();
  }

  // ---------------------------------------------------------------------------------------------------------------
  console.log('\nSecurity suite C: stores stay bounded (workspace.mjs)');
  const { NotesStore, ActivityLog, NOTES_MAX_COUNT } = await import('../workspace.mjs');
  try {
    await test('NotesStore caps the number of notes; editing and clearing existing notes still works; concurrent saves all land', async () => {
      assert(NOTES_MAX_COUNT >= 100);
      const store = new NotesStore(path.join(tmp, 'notes.json'), { maxNotes: 5 });
      await Promise.all([0, 1, 2, 3, 4].map((i) => store.set(`sample:n${i}`, `note ${i}`)));
      assert.equal(Object.keys(store.all()).length, 5, 'five concurrent saves must all be stored');
      await assert.rejects(store.set('sample:n5', 'one too many'), (e) => e.code === 'FABLED_NOTES_FULL');
      assert.equal((await store.set('sample:n0', 'edited')).text, 'edited');
      assert.equal(await store.set('sample:n1', ''), null);
      assert.equal((await store.set('sample:n5', 'fits now')).text, 'fits now');
      assert.equal(Object.keys(store.all()).length, 5);
      assert.equal((await store.set('sample:n0', 'x'.repeat(50_000))).text.length, 20_000, 'note text is capped');
      await assert.rejects(store.set('../../etc/passwd', 'x'), /bad asset id/);
      assert(fs.readdirSync(tmp).every((f) => !f.includes('.tmp.')), 'no temp files left behind');
    });
    await test('ActivityLog is trimmed to its newest lines past the size cap, including under concurrent appends', async () => {
      const file = path.join(tmp, 'activity.jsonl');
      const log = new ActivityLog(file, { maxBytes: 4000, keepLines: 20 });
      for (let i = 0; i < 30; i++) await log.add({ type: 'note', asset_id: 'sample:a', message: `sequential ${i} ${'m'.repeat(100)}` });
      await Promise.all(Array.from({ length: 120 }, (_, i) => log.add({ type: 'note', asset_id: 'sample:a', message: `burst ${i} ${'m'.repeat(100)}` })));
      const size = fs.statSync(file).size;
      assert(size <= 4000 + 400, `log is ${size} bytes`);
      const events = log.list({ limit: 200 });
      assert(events.length > 0 && events.length <= 21);
      assert.equal(events[0].message.split(' ').slice(0, 2).join(' '), 'burst 119', 'the newest event is kept');
      for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) JSON.parse(line); // every remaining line is whole
      assert.equal((await log.add({ type: 'note', message: 'x'.repeat(5000) })).message.length, 500);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const id of created) if (/^[a-z0-9-]{8,40}$/.test(id)) fs.rmSync(path.join(UI_DIR, 'work', id), { recursive: true, force: true });
  }
}

// Standalone runner
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let total = 0; let passed = 0; const failures = [];
  const test = async (name, fn) => {
    total++;
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); }
  };
  console.log('Fabled server security tests');
  runServerSecurityTests(test).then(() => {
    console.log(`\n Server security summary: ${passed}/${total} passed (${total - passed} failed)`);
    process.exit(failures.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
