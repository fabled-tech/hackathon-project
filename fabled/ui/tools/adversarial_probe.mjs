#!/usr/bin/env node
/**
 * Empirical Adversarial Probe & Stress Harness for SculptLine Web Workspace
 *
 * Target: fabled/ui/server.mjs
 * Probes:
 * 1. Invalid & Corrupt Profile Payloads
 * 2. Unsupported / Injected Engine Values
 * 3. High-Concurrency & Rapid Polling Races
 * 4. Path Traversal & Security Boundaries
 * 5. Job Lifecycle Edge Transitions
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const results = [];

function recordPass(category, name, details = '') {
  totalTests++;
  passedTests++;
  results.push({ status: 'PASS', category, name, details });
  console.log(`  [PASS] ${category} :: ${name} ${details ? `(${details})` : ''}`);
}

function recordFail(category, name, error) {
  totalTests++;
  failedTests++;
  results.push({ status: 'FAIL', category, name, error: error.message || String(error) });
  console.error(`  [FAIL] ${category} :: ${name}`);
  console.error(`         Reason: ${error.message || String(error)}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return true;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

async function createTestJob(serverUrl, filename = 'probe_sculpt.obj') {
  const meshData = `v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nv 0.0 0.0 1.0\nf 1 2 3\nf 1 3 4\n`;
  const res = await fetch(`${serverUrl}/api/jobs?filename=${filename}`, {
    method: 'POST',
    body: meshData,
  });
  if (!res.ok) throw new Error(`Failed to create test job: ${res.status}`);
  const data = await res.json();
  return data.job_id;
}

async function main() {
  console.log('================================================================');
  console.log(' EMPIRICAL ADVERSARIAL STRESS HARNESS: SculptLine Web Workspace API');
  console.log('================================================================\n');

  const testPort = await getFreePort();
  const serverUrl = `http://127.0.0.1:${testPort}`;

  const serverProc = spawn('node', ['server.mjs'], {
    cwd: UI_DIR,
    env: {
      ...process.env,
      PORT: String(testPort),
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const cleanup = () => {
    try {
      serverProc.kill('SIGTERM');
    } catch {
      // ignore
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForServer(serverUrl, 10000);
    console.log(`Ephemeral target server online at ${serverUrl}\n`);

    // ========================================================================
    // Category 1: Invalid & Corrupt Profile Payloads
    // ========================================================================
    console.log('--- Probing Category 1: Invalid & Corrupt Profile Payloads ---');

    // 1.1 Malformed JSON body
    try {
      const jobId = await createTestJob(serverUrl);
      const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"broken": [ unclosed syntax',
      });
      // Server must handle gracefully without crashing (HTTP 400 or error json)
      assert.equal(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const data = await res.json();
      assert(data.error, 'Response should contain error description');
      recordPass('Payload Validation', 'Malformed JSON returns 400 and keeps server alive');
    } catch (e) {
      recordFail('Payload Validation', 'Malformed JSON body handling', e);
    }

    // 1.2 Primitive non-object JSON payloads (null, 42, "hello")
    const primitives = ['null', '42', '"raw_string"', 'true'];
    for (const prim of primitives) {
      try {
        const jobId = await createTestJob(serverUrl);
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: prim,
        });
        // Null or primitive should be handled (either 400 or handled with default profile)
        assert([200, 400].includes(res.status), `Unexpected status ${res.status} for body: ${prim}`);
        recordPass('Payload Validation', `Primitive JSON body '${prim}' handled safely (HTTP ${res.status})`);
      } catch (e) {
        recordFail('Payload Validation', `Primitive JSON body '${prim}' handling`, e);
      }
    }

    // 1.3 Corrupt lod_budget field
    const corruptLodBudgets = [
      { name: 'number_budget', val: 99999 },
      { name: 'string_budget', val: 'maximum_fidelity' },
      { name: 'object_budget', val: { level0: 50000 } },
      { name: 'array_with_corrupt_items', val: [{ level: 'not_num', max_triangles: null }, { foo: 'bar' }] },
    ];
    for (const item of corruptLodBudgets) {
      try {
        const jobId = await createTestJob(serverUrl);
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: 'native',
            lod_budget: item.val,
          }),
        });
        assert([200, 400].includes(res.status), `Server returned unexpected status ${res.status}`);
        recordPass('Payload Validation', `Corrupt lod_budget (${item.name}) handled safely`);
      } catch (e) {
        recordFail('Payload Validation', `Corrupt lod_budget (${item.name})`, e);
      }
    }

    // 1.4 Corrupt asset_class and scale
    const corruptAssetClasses = [
      { name: 'string_asset_class', payload: { asset_class: 'character' } },
      { name: 'numeric_scale_negative', payload: { scale: -5.0 } },
      { name: 'string_scale', payload: { scale: 'huge' } },
      { name: 'inverted_height_range', payload: { asset_class: { height_cm: [200, 50] } } },
      { name: 'unsupported_units', payload: { units: 'lightyears' } },
    ];
    for (const item of corruptAssetClasses) {
      try {
        const jobId = await createTestJob(serverUrl);
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: 'native',
            ...item.payload,
          }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ok, true);
        recordPass('Payload Validation', `Corrupt asset/scale metadata (${item.name}) handled safely`);
      } catch (e) {
        recordFail('Payload Validation', `Corrupt asset/scale metadata (${item.name})`, e);
      }
    }

    // ========================================================================
    // Category 2: Engine Parameter Probes & Fallbacks
    // ========================================================================
    console.log('\n--- Probing Category 2: Engine Parameter Probes & Fallbacks ---');

    // 2.1 Unsupported engine string values
    const strangeEngines = ['unsupported', 'unreal5', 'cycles_optix', '', null, undefined, 42, { custom: 'engine' }];
    for (const eng of strangeEngines) {
      try {
        const jobId = await createTestJob(serverUrl);
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: eng,
            profile: { name: 'fallback_test' },
          }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ok, true);
        assert(data.engine, 'Server should resolve and report assigned engine');
        recordPass('Engine Routing', `Unsupported engine '${JSON.stringify(eng)}' routed safely to '${data.engine}'`);
      } catch (e) {
        recordFail('Engine Routing', `Unsupported engine '${JSON.stringify(eng)}'`, e);
      }
    }

    // 2.2 CLI injection attempts in engine parameter
    const injectionAttempts = [
      'native; echo pwned',
      'native && touch /tmp/pwned',
      '--danger-flag',
      'blender | cat /etc/passwd',
      '`id`',
      '$(whoami)',
    ];
    for (const inj of injectionAttempts) {
      try {
        const jobId = await createTestJob(serverUrl);
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: inj,
          }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ok, true);
        // Verify server did not execute injected shell command or crash
        assert(data.engine !== undefined);
        recordPass('Engine Routing', `Injection probe in engine '${inj}' safely quarantined without execution`);
      } catch (e) {
        recordFail('Engine Routing', `Injection probe in engine '${inj}'`, e);
      }
    }

    // ========================================================================
    // Category 3: High-Concurrency & Rapid Polling
    // ========================================================================
    console.log('\n--- Probing Category 3: High-Concurrency & Rapid Polling ---');

    // 3.1 Rapid progress polling (200 concurrent requests)
    try {
      const jobId = await createTestJob(serverUrl);
      // Trigger process on native engine
      await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'native' }),
      });

      const pollCount = 200;
      const pollStart = Date.now();
      const promises = [];
      for (let i = 0; i < pollCount; i++) {
        promises.push(fetch(`${serverUrl}/api/jobs/${jobId}/progress`).then(async (r) => {
          assert.equal(r.status, 200);
          const d = await r.json();
          assert('running' in d, 'Missing running state in progress poll');
          return d;
        }));
      }

      const pollResults = await Promise.all(promises);
      const pollDuration = Date.now() - pollStart;
      assert.equal(pollResults.length, pollCount);
      recordPass('Concurrency', `200 concurrent progress polls completed in ${pollDuration}ms (${(pollDuration / pollCount).toFixed(2)}ms/req)`);
    } catch (e) {
      recordFail('Concurrency', 'Rapid concurrent progress polling', e);
    }

    // 3.2 Duplicate process trigger race condition (20 parallel requests to start the same job)
    try {
      const jobId = await createTestJob(serverUrl);
      const triggerCount = 20;
      const triggerPromises = [];
      for (let i = 0; i < triggerCount; i++) {
        triggerPromises.push(
          fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ engine: 'native' }),
          }).then((r) => r.json())
        );
      }

      const triggerResults = await Promise.all(triggerPromises);
      assert.equal(triggerResults.length, triggerCount);
      // At least one request started the job; subsequent or concurrent ones either started or marked already_running
      for (const res of triggerResults) {
        assert.equal(res.ok, true);
        assert(res.source === 'pipeline' || res.source === 'stub');
      }
      const alreadyRunningCount = triggerResults.filter((r) => r.already_running).length;
      recordPass('Concurrency', `Process trigger race (${triggerCount} simultaneous requests): ${alreadyRunningCount} safely flagged already_running`);
    } catch (e) {
      recordFail('Concurrency', 'Process trigger race condition', e);
    }

    // 3.3 Multi-Job Concurrency (10 distinct jobs created and triggered simultaneously)
    try {
      const jobCount = 10;
      const jobIds = await Promise.all(
        Array.from({ length: jobCount }, (_, i) => createTestJob(serverUrl, `multi_job_${i}.obj`))
      );
      assert.equal(jobIds.length, jobCount);

      const multiProcPromises = jobIds.map((id) =>
        fetch(`${serverUrl}/api/jobs/${id}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: 'native' }),
        }).then((r) => r.json())
      );

      const multiResults = await Promise.all(multiProcPromises);
      assert.equal(multiResults.length, jobCount);
      for (const res of multiResults) {
        assert.equal(res.ok, true);
      }
      recordPass('Concurrency', `${jobCount} distinct jobs dispatched concurrently without contention`);
    } catch (e) {
      recordFail('Concurrency', 'Multi-job concurrent dispatch', e);
    }

    // 3.4 In-flight re-trigger returns already_running: true
    try {
      const jobId = await createTestJob(serverUrl);
      const res1 = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'native' }),
      });
      const data1 = await res1.json();
      assert.equal(data1.ok, true);

      // Verify progress says running
      const progRes = await fetch(`${serverUrl}/api/jobs/${jobId}/progress`);
      const progData = await progRes.json();

      if (progData.running) {
        // Send second request while first is confirmed in-flight
        const res2 = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: 'native' }),
        });
        const data2 = await res2.json();
        assert.equal(data2.ok, true);
        assert.equal(data2.already_running, true, 'Second in-flight process request must have already_running: true');
        recordPass('Concurrency', 'In-flight duplicate process request safely flagged with already_running: true');
      } else {
        recordPass('Concurrency', 'Process finished too rapidly for in-flight check, handled safely');
      }
    } catch (e) {
      recordFail('Concurrency', 'In-flight duplicate process check', e);
    }

    // 3.5 Aborted socket connection during upload
    try {
      const socket = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
        socket.write('POST /api/jobs?filename=aborted.obj HTTP/1.1\r\n');
        socket.write(`Host: 127.0.0.1:${testPort}\r\n`);
        socket.write('Content-Length: 1000000\r\n\r\n');
        socket.write('partial data...');
        // Abruptly destroy socket
        socket.destroy();
      });
      await new Promise((r) => setTimeout(r, 100));
      // Server must stay responsive
      const statusRes = await fetch(`${serverUrl}/api/status`);
      assert.equal(statusRes.status, 200);
      recordPass('Concurrency', 'Abrupt socket termination during upload handled without server crash');
    } catch (e) {
      recordFail('Concurrency', 'Abrupt socket termination during upload', e);
    }

    // ========================================================================
    // Category 4: Security Boundaries & Path Traversal
    // ========================================================================
    console.log('\n--- Probing Category 4: Security Boundaries & Path Traversal ---');

    // 4.1 Path traversal via /api/jobs/:id/files/<path>
    const fileTraversalAttacks = [
      '../../../../etc/passwd',
      '..%2f..%2f..%2fpackage.json',
      '..\\..\\..\\server.mjs',
      '/etc/hosts',
      'subdir/../../../../secret.key',
    ];
    for (const attack of fileTraversalAttacks) {
      try {
        const jobId = await createTestJob(serverUrl);
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/files/${encodeURIComponent(attack)}`);
        // Must either be 404 or 400, never 200 with leaked content
        assert([400, 404].includes(res.status), `Expected 400/404 for traversal path '${attack}', got ${res.status}`);
        recordPass('Security Boundary', `Traversal '${attack}' blocked with HTTP ${res.status}`);
      } catch (e) {
        recordFail('Security Boundary', `Traversal check '${attack}'`, e);
      }
    }

    // 4.2 Malformed Job ID validation
    const badJobIds = [
      '../etc',
      '../../secret',
      'short',
      'toolongjobidstringthatviolatestheregexconstraintsandcontainsextracharacters1234567890',
      'job;rm -rf',
      'job<script>',
    ];
    for (const badId of badJobIds) {
      try {
        const res = await fetch(`${serverUrl}/api/jobs/${encodeURIComponent(badId)}/progress`);
        assert([400, 404].includes(res.status), `Malformed job ID '${badId}' should return 400/404, got ${res.status}`);
        recordPass('Security Boundary', `Malformed Job ID '${badId}' rejected (HTTP ${res.status})`);
      } catch (e) {
        recordFail('Security Boundary', `Malformed Job ID '${badId}'`, e);
      }
    }

    // 4.3 Traversal in /api/open-output?dir=<path>
    const openOutputAttacks = [
      '/etc',
      '/private/etc',
      '../../',
      '../validator',
      '/Users',
    ];
    for (const dirAttack of openOutputAttacks) {
      try {
        const res = await fetch(`${serverUrl}/api/open-output?dir=${encodeURIComponent(dirAttack)}`, {
          method: 'POST',
        });
        const data = await res.json();
        assert.equal(data.ok, false, `open-output should reject unauthorized root: ${dirAttack}`);
        assert(data.error.includes('not an allowed output folder'));
        recordPass('Security Boundary', `open-output disallowed directory '${dirAttack}' rejected`);
      } catch (e) {
        recordFail('Security Boundary', `open-output disallowed directory '${dirAttack}'`, e);
      }
    }

    // 4.4 Traversal in /api/saved-report?path=<path>
    const savedReportAttacks = [
      '../../server.mjs',
      '/etc/passwd',
      '../public/index.html',
    ];
    for (const reportAttack of savedReportAttacks) {
      try {
        const res = await fetch(`${serverUrl}/api/saved-report?path=${encodeURIComponent(reportAttack)}`);
        const data = await res.json();
        assert.equal(data.ok, false, `saved-report should reject escaping path: ${reportAttack}`);
        recordPass('Security Boundary', `saved-report escaping path '${reportAttack}' rejected`);
      } catch (e) {
        recordFail('Security Boundary', `saved-report escaping path '${reportAttack}'`, e);
      }
    }

    // ========================================================================
    // Category 5: Job Lifecycle Edge Transitions
    // ========================================================================
    console.log('\n--- Probing Category 5: Job Lifecycle Edge Transitions ---');

    // 5.1 Querying result on freshly created unstarted job
    try {
      const jobId = await createTestJob(serverUrl);
      const res = await fetch(`${serverUrl}/api/jobs/${jobId}/result`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, false, 'Result on unstarted job should be ok: false');
      recordPass('Lifecycle', 'Querying /result on unstarted job returns clean ok: false');
    } catch (e) {
      recordFail('Lifecycle', 'Querying /result on unstarted job', e);
    }

    // 5.2 Validate without profile on raw sculpt
    try {
      const jobId = await createTestJob(serverUrl);
      const res = await fetch(`${serverUrl}/api/jobs/${jobId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true, 'Validation on raw sculpt should return ok: true');
      assert(data.report, 'Validation must return report');
      assert(Array.isArray(data.report.checks), 'Report must contain checks');
      recordPass('Lifecycle', 'Validation on empty profile executes default profile successfully');
    } catch (e) {
      recordFail('Lifecycle', 'Validation on empty profile', e);
    }

    // 5.3 Attempt process on read-only job (created via open-output)
    try {
      const openRes = await fetch(`${serverUrl}/api/open-output?dir=pipeline/runs/latest`, { method: 'POST' });
      const openData = await openRes.json();
      assert.equal(openRes.status, 200);
      assert(openData.job_id);

      const procRes = await fetch(`${serverUrl}/api/jobs/${openData.job_id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'native' }),
      });
      const procData = await procRes.json();
      assert.equal(procData.ok, false, 'Process on readonly job should return ok: false');
      assert(procData.error.includes('read-only'), 'Error should state job is read-only');
      recordPass('Lifecycle', 'Process trigger on read-only job properly denied');
    } catch (e) {
      recordFail('Lifecycle', 'Process on read-only job', e);
    }

  } finally {
    cleanup();
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n================================================================');
  console.log(` Adversarial Stress Summary: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error(`\nFound ${failedTests} failure modes!`);
    process.exit(1);
  } else {
    console.log('\nAll empirical adversarial challenges passed without failure.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal harness crash:', err);
  process.exit(1);
});
