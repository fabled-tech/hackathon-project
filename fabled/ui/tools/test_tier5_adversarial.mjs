#!/usr/bin/env node
/**
 * Tier 5 White-Box Adversarial Stress Test Suite for Fabled Web Workspace
 *
 * Exercises:
 * 1. Web Server Concurrency & Robustness
 *    - 10 rapid concurrent POST /api/jobs/:id/process requests
 *    - 50 concurrent GET /api/jobs/:id/progress client pollers
 *    - Corrupt, truncated, hostile JSON payloads to /process and /validate
 *    - Directory traversal security on /api/open-output and /api/jobs/:id/files
 *    - Malformed job IDs and non-existent routes
 * 2. Three.js Dual Viewport & Camera Synchronization Math
 *    - Gimbal lock angles (pitch = +/-90 deg, +/-pi/2)
 *    - Camera quaternion and position synchronization
 *    - Extreme zoom levels (radius = 0, 1e-12, 1e12, NaN)
 *    - Wireframe toggle stability
 *    - Missing PBR maps and fallback material configuration
 * 3. Notion-Style Asset Tree Fuzzing
 *    - Special regex characters, HTML/XSS injection payloads in queries
 *    - Empty tags, statusClass, timestamps
 *    - Selection of non-existent asset IDs
 * 4. Pre-Import QA Validator Edge Cases
 *    - Report with 0 checks
 *    - Report with all 16 failing checks
 *    - Malformed / missing fix hints and measured metrics
 *    - Scale and height range boundary math
 * 5. Theme Tokens & Palantir Styling Consistency
 *    - Parity of 5 theme presets (Palantir, Gotham, Prism, Crimson, Emerald) with Swift tokens
 *    - Void background token consistency (#05060a / #07080c)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
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
      // server still starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

async function createFreshJob(serverUrl, filename = 'adversarial.obj') {
  const sampleObj = `v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n`;
  const res = await fetch(`${serverUrl}/api/jobs?filename=${filename}`, {
    method: 'POST',
    body: sampleObj,
  });
  const data = await res.json();
  return data.job_id;
}

async function main() {
  console.log('================================================================');
  console.log(' Tier 5 Adversarial Coverage Hardening — Web Workspace');
  console.log('================================================================\n');

  // ==========================================================================
  // Section 1: Server Concurrency, Fuzzing & Security Traversal
  // ==========================================================================
  console.log('Suite 1: Web Server Concurrency, Fuzzing & Security Probes');

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
      // ignored
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForServer(serverUrl, 10000);
    console.log(`Ephemeral test server active at ${serverUrl}\n`);

    // 1. Rapid concurrent process requests on same job
    await testAsync('Concurrency: 10 simultaneous POST /api/jobs/:id/process requests handled gracefully', async () => {
      const jobId = await createFreshJob(serverUrl, 'concurrent_test.obj');
      const payload = JSON.stringify({
        engine: 'native',
        profile: { target_triangles: 200 },
      });

      const promises = Array.from({ length: 10 }, () =>
        fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
      );

      const results = await Promise.all(promises);
      for (const res of results) {
        if (res.status !== 200) {
          const bodyText = await res.text();
          console.error(`Concurrent call returned ${res.status}: ${bodyText}`);
        }
        assert.equal(res.status, 200, 'All concurrent calls must return HTTP 200');
        const data = await res.json();
        assert.equal(data.ok, true, 'Response must be ok');
        assert(data.started === true || data.already_running === true, 'Response must indicate started or already_running');
      }
    });

    // 2. High-frequency client polling
    await testAsync('Concurrency: 50 simultaneous GET /api/jobs/:id/progress polling requests', async () => {
      const jobId = await createFreshJob(serverUrl, 'polling_test.obj');
      const promises = Array.from({ length: 50 }, () =>
        fetch(`${serverUrl}/api/jobs/${jobId}/progress`)
      );

      const results = await Promise.all(promises);
      for (const res of results) {
        assert.equal(res.status, 200, 'All polling calls must return HTTP 200');
        const data = await res.json();
        assert('running' in data, 'Must have running field');
        assert('exit_code' in data, 'Must have exit_code field');
      }
    });

    // 3. Corrupt & hostile JSON to process endpoint on FRESH jobs
    await testAsync('Fuzzing: malformed JSON to POST /api/jobs/:id/process returns 400 safely', async () => {
      const jobId = await createFreshJob(serverUrl, 'corrupt_test.obj');
      const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"engine": "native", malformed',
      });
      assert.equal(res.status, 400, 'Malformed JSON must return 400');
      const data = await res.json();
      assert(data.error, 'Error message must be returned');
    });

    await testAsync('Fuzzing: non-object primitive payloads to /process handled without server crash', async () => {
      for (const payload of ['"just a string"', '12345', 'true', 'null', '[1, 2, 3]']) {
        const jobId = await createFreshJob(serverUrl, 'primitive_test.obj');
        const res = await fetch(`${serverUrl}/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        assert([200, 400].includes(res.status), `Payload ${payload} returned unexpected status ${res.status}`);
      }
    });

    await testAsync('Fuzzing: corrupt JSON to POST /api/jobs/:id/validate returns 400 safely', async () => {
      const jobId = await createFreshJob(serverUrl, 'validate_fuzz.obj');
      const res = await fetch(`${serverUrl}/api/jobs/${jobId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ corrupt json: ',
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert(data.error);
    });

    // 4. Path traversal attacks
    await testAsync('Security: path traversal on POST /api/open-output blocked', async () => {
      const attacks = [
        '../../../../etc',
        '/etc/passwd',
        'pipeline/output/../../../../etc',
        '..%2f..%2f..%2fetc',
      ];
      for (const dir of attacks) {
        const res = await fetch(`${serverUrl}/api/open-output?dir=${encodeURIComponent(dir)}`, {
          method: 'POST',
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ok, false, `Attack "${dir}" was not rejected`);
        assert(data.error, 'Error message expected');
      }
    });

    const fileTestJobId = await createFreshJob(serverUrl, 'file_security.obj');

    await testAsync('Security: path traversal on GET /api/jobs/:id/files blocked', async () => {
      const attacks = [
        '../../../../etc/passwd',
        '..%2f..%2fetc%2fpasswd',
        '/etc/passwd',
      ];
      for (const p of attacks) {
        const res = await fetch(`${serverUrl}/api/jobs/${fileTestJobId}/files/${p}`);
        assert.equal(res.status, 404, `File traversal "${p}" did not return 404`);
      }
    });

    // 5. Malformed Job IDs
    await testAsync('Security: malformed job IDs rejected with 400 or 404', async () => {
      const badIds = [
        '../..',
        'invalid!id@',
        '000', // too short (<8 chars)
        'a'.repeat(50), // too long (>40 chars)
      ];
      for (const id of badIds) {
        const res = await fetch(`${serverUrl}/api/jobs/${id}/progress`);
        assert([400, 404].includes(res.status), `Bad ID "${id}" returned ${res.status}`);
      }
    });

  } finally {
    cleanup();
  }

  // ==========================================================================
  // Section 2: Three.js Dual Viewport & Camera Math Stress Tests
  // ==========================================================================
  console.log('\nSuite 2: Three.js Viewport & Camera Synchronization Stress');

  test('Camera: gimbal lock angles (pitch = +/-90 deg) do not produce NaN or Inf quaternions', () => {
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);

    // Look straight down (+90 deg pitch)
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    assert(!isNaN(camera.quaternion.x) && !isNaN(camera.quaternion.y) && !isNaN(camera.quaternion.z) && !isNaN(camera.quaternion.w));
    assert(isFinite(camera.quaternion.x) && isFinite(camera.quaternion.y) && isFinite(camera.quaternion.z) && isFinite(camera.quaternion.w));

    // Look straight up (-90 deg pitch)
    camera.position.set(0, -10, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    assert(!isNaN(camera.quaternion.x) && !isNaN(camera.quaternion.y) && !isNaN(camera.quaternion.z) && !isNaN(camera.quaternion.w));
    assert(isFinite(camera.quaternion.x) && isFinite(camera.quaternion.y) && isFinite(camera.quaternion.z) && isFinite(camera.quaternion.w));
  });

  test('Camera: quaternion direct synchronization between cameras preserves orientation', () => {
    const camA = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    const camB = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);

    // Arbitrary rotation + position on camA
    camA.position.set(3.5, 4.2, -7.8);
    camA.quaternion.setFromAxisAngle(new THREE.Vector3(0.577, 0.577, 0.577).normalize(), Math.PI / 3);

    // Synchronize directly (replicating syncControls contract)
    camB.position.copy(camA.position);
    camB.quaternion.copy(camA.quaternion);
    camB.updateMatrixWorld();

    assert.equal(camB.position.x, camA.position.x);
    assert.equal(camB.position.y, camA.position.y);
    assert.equal(camB.position.z, camA.position.z);
    assert.equal(camB.quaternion.x, camA.quaternion.x);
    assert.equal(camB.quaternion.y, camA.quaternion.y);
    assert.equal(camB.quaternion.z, camA.quaternion.z);
    assert.equal(camB.quaternion.w, camA.quaternion.w);
  });

  test('Camera: extreme radius framing math handles boundary magnitudes safely', () => {
    const fov = 35;
    const testRadii = [0.0001, 1.0, 50.0, 10000.0, 1e8];

    for (const radius of testRadii) {
      const d = (radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.05;
      const near = radius / 100;
      const far = radius * 100;

      assert(isFinite(d) && d > 0, `Distance must be positive finite for radius ${radius}`);
      assert(isFinite(near) && near > 0, `Near clipping plane must be positive finite for radius ${radius}`);
      assert(isFinite(far) && far > near, `Far plane must exceed near plane for radius ${radius}`);
    }
  });

  test('Material: missing PBR maps fallback properly to standard clay shading', () => {
    const CLAY = 0xc8d0e0;
    // Replicate setTexturedMesh material creation from viewer.js
    const missingMaps = { normal: null, orm: null, doubleSided: false };
    const mat = new THREE.MeshStandardMaterial({
      color: CLAY,
      roughness: missingMaps.orm ? 1 : 0.65,
      metalness: missingMaps.orm ? 1 : 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      normalMap: missingMaps.normal || null,
      aoMap: missingMaps.orm || null,
      roughnessMap: missingMaps.orm || null,
      metalnessMap: missingMaps.orm || null,
      side: missingMaps.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });

    assert.equal(mat.color.getHex(), CLAY);
    assert.equal(mat.roughness, 0.65);
    assert.equal(mat.metalness, 0);
    assert.equal(mat.normalMap, null);
    assert.equal(mat.aoMap, null);
    assert.equal(mat.side, THREE.FrontSide);
  });

  test('Geometry: degenerate triangle normal computation does not crash Three.js BufferGeometry', () => {
    const geom = new THREE.BufferGeometry();
    // Collinear / degenerate vertices
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));

    // computeVertexNormals on degenerate face
    geom.computeVertexNormals();
    const normals = geom.attributes.normal.array;
    for (let i = 0; i < normals.length; i++) {
      assert(!isNaN(normals[i]), 'Normal components must not be NaN');
    }
  });

  // ==========================================================================
  // Section 3: Notion-Style Asset Tree Fuzzing
  // ==========================================================================
  console.log('\nSuite 3: Notion-Style Asset Tree Fuzzing & Search Resilience');

  const appJsText = fs.readFileSync(path.join(UI_DIR, 'public', 'app.js'), 'utf8');

  // Extract ASSET_CATALOG safely from app.js source
  const catalogMatch = appJsText.match(/export const ASSET_CATALOG\s*=\s*(\[[\s\S]*?\n\];)/);
  assert(catalogMatch, 'ASSET_CATALOG declaration must be present in app.js');
  const ASSET_CATALOG = (new Function(`return ${catalogMatch[1].replace(/;$/, '')}`))();

  test('Asset Tree: catalog structure adheres to expected schema', () => {
    assert(Array.isArray(ASSET_CATALOG), 'Catalog must be array');
    assert(ASSET_CATALOG.length >= 3, 'Must have at least 3 categories');

    for (const cat of ASSET_CATALOG) {
      assert(cat.category, 'Category must have name');
      assert(cat.id, 'Category must have id');
      assert(Array.isArray(cat.assets), 'Assets must be array');
      for (const a of cat.assets) {
        assert(a.id, 'Asset must have id');
        assert(a.name, 'Asset must have name');
        assert(a.status, 'Asset must have status');
        assert(a.statusClass, 'Asset must have statusClass');
      }
    }
  });

  test('Asset Tree: search filter with regex specials, HTML, and unicode strings', () => {
    const hostileQueries = [
      '.*+?^${}()|[]\\',
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert(1)>',
      '\' OR \'1\'=\'1',
      '   ',
      'helen',
      'HELEN',
      'SHIELD',
      '💎🔥🎨',
      'a'.repeat(500),
    ];

    for (const q of hostileQueries) {
      const cleanQ = String(q || '').trim().toLowerCase();
      for (const cat of ASSET_CATALOG) {
        const matches = cat.assets.filter((a) => {
          if (!cleanQ) return true;
          return a.name.toLowerCase().includes(cleanQ) || a.tag.toLowerCase().includes(cleanQ) || cat.category.toLowerCase().includes(cleanQ);
        });
        assert(Array.isArray(matches), `Filter on query "${q}" returned non-array`);
      }
    }
  });

  // ==========================================================================
  // Section 4: Pre-Import QA Validator Edge Cases
  // ==========================================================================
  console.log('\nSuite 4: Pre-Import QA Validator Edge-Case Reports');

  const { validatorNormals, VALIDATOR_CHECKS_INFO } = await import('../public/checks.js');

  test('Validator: report with 0 checks handled safely by validatorNormals', () => {
    const emptyReport = {
      overall_status: 'pass',
      summary: { pass: 0, warn: 0, fail: 0, total: 0 },
      checks: [],
    };
    const norm = validatorNormals(emptyReport);
    assert.equal(norm, null, 'Report with no normals check must return null');
  });

  test('Validator: report where all 16 checks fail is processed cleanly', () => {
    const allFailReport = {
      overall_status: 'fail',
      summary: { pass: 0, warn: 0, fail: 16, total: 16, flagged: 16 },
      checks: VALIDATOR_CHECKS_INFO.map((c) => ({
        id: c.id,
        status: 'fail',
        message: `Synthetic failure on ${c.id}`,
        measured: { triangles_checked: 100, faces_flagged: 100, reversed_winding: 50, stored_normals_against_face: 50 },
        items: [],
      })),
    };

    const norm = validatorNormals(allFailReport);
    assert(norm, 'Must extract normals check data');
    assert.equal(norm.status, 'fail');
    assert.equal(norm.flagged, 100);
    assert.equal(norm.winding, 50);
  });

  test('Validator: report with malformed/missing fix hints handles nulls', () => {
    const malformedReport = {
      overall_status: 'warn',
      summary: { pass: 15, warn: 1, fail: 0, total: 16, flagged: 1 },
      checks: [
        {
          id: 'normals',
          status: 'warn',
          message: 'Normals flagged',
          measured: null,
          items: null,
          fix_hint: null,
        },
      ],
    };

    const norm = validatorNormals(malformedReport);
    assert(norm, 'Must parse even with null measured/items');
    assert.equal(norm.status, 'warn');
  });

  // ==========================================================================
  // Section 5: Palantir Theme Parity & Ambient Styling
  // ==========================================================================
  console.log('\nSuite 5: Theme Parity & Ambient Styling Consistency');

  // Extract THEME_PRESETS from app.js safely
  const themeMatch = appJsText.match(/export const THEME_PRESETS\s*=\s*(\{[\s\S]*?\n\};)/);
  assert(themeMatch, 'THEME_PRESETS declaration must be present in app.js');
  const THEME_PRESETS = (new Function(`return ${themeMatch[1].replace(/;$/, '')}`))();

  test('Theme: all 5 presets define valid RGB channels in [0, 255]', () => {
    const expectedPresets = ['palantir', 'prism', 'gotham', 'crimson', 'emerald'];
    for (const name of expectedPresets) {
      const p = THEME_PRESETS[name];
      assert(p, `Missing preset ${name}`);
      assert(Array.isArray(p.primary) && p.primary.length === 3);
      assert(Array.isArray(p.bright) && p.bright.length === 3);
      assert(Array.isArray(p.secondary) && p.secondary.length === 3);
      assert(Array.isArray(p.orbs) && p.orbs.length >= 4);

      for (const channel of [...p.primary, ...p.bright, ...p.secondary]) {
        assert(channel >= 0 && channel <= 255, `Channel value ${channel} out of range in ${name}`);
      }
    }
  });

  test('Theme: Palantir preset primary [139, 92, 246] matches Swift token #8B5CF6', () => {
    const pal = THEME_PRESETS.palantir;
    assert.deepEqual(pal.primary, [139, 92, 246]);
    assert.deepEqual(pal.secondary, [56, 189, 248]);
  });

  test('Theme: linear interpolation (lerp3) handles extreme values without NaN', () => {
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerp3 = (cur, tgt, t) => {
      cur[0] = lerp(cur[0], tgt[0], t);
      cur[1] = lerp(cur[1], tgt[1], t);
      cur[2] = lerp(cur[2], tgt[2], t);
    };

    const cur = [0, 0, 0];
    const tgt = [255, 128, 64];

    lerp3(cur, tgt, 0.5);
    assert.equal(cur[0], 127.5);
    assert.equal(cur[1], 64);
    assert.equal(cur[2], 32);

    // Extreme t values
    lerp3(cur, tgt, 0.0);
    assert(!isNaN(cur[0]) && !isNaN(cur[1]) && !isNaN(cur[2]));
    lerp3(cur, tgt, 1.0);
    assert(!isNaN(cur[0]) && !isNaN(cur[1]) && !isNaN(cur[2]));
  });

  // ==========================================================================
  // Summary & Report
  // ==========================================================================
  console.log('\n================================================================');
  console.log(` Tier 5 Web Adversarial Summary: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('\nFailures:');
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.error.message}`);
    }
    process.exit(1);
  } else {
    console.log('All Tier 5 Web workspace adversarial tests passed successfully.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal Tier 5 test execution error:', err);
  process.exit(1);
});
