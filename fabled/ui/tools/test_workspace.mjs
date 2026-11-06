#!/usr/bin/env node
/**
 * Automated Test Runner for Fabled Web Workspace (Milestone 2 Feature 13)
 *
 * Verifies:
 * 1. Client Component Data Structures & Schemas
 *    - THEME_PRESETS (5 presets with dark Notion/Palantir tokens)
 *    - Connected workspace wiring (workspace.js, licensed.js, Connections, asset page, generation dialog)
 *    - VALIDATOR_CHECKS_INFO (16 pre-import validation checks with rules & fixes)
 *    - PIPELINE_STAGES (8 discrete stages with IDs and descriptions)
 *    - DOM structure and CSS styling in index.html and styles.css
 * 2. Static File Serving via HTTP
 *    - index.html, styles.css, app.js, viewer.js, checks.js, Three.js vendor bundle, sample assets
 * 3. Web Server REST API Endpoints
 *    - GET /api/status (pipeline & validator availability, dual engine detection)
 *    - POST /api/jobs (job creation with sculpt upload)
 *    - GET /api/jobs/:id/progress (stage progression & exit status)
 *    - POST /api/jobs/:id/validate (pre-import quality check invocation)
 *    - GET /api/jobs/:id/result (pipeline run results & output files)
 *    - GET /api/saved-reports & POST /api/open-output
 * 4. Dual-Engine Process Routing
 *    - POST /api/jobs/:id/process with { engine: 'native' } -> Native Python/NumPy fallback
 *    - POST /api/jobs/:id/process with { engine: 'blender' } -> Headless Blender engine
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_DIR = path.resolve(UI_DIR, '..');

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

async function main() {
  console.log('================================================================');
  console.log(' Fabled Web Workspace Automated Test Suite (Milestone 2 / M2)');
  console.log('================================================================\n');

  // ==========================================================================
  // Suite 1: Client Component Data Structures & Schemas
  // ==========================================================================
  console.log('Suite 1: Client Component Data Structures & DOM Schemas');

  const { VALIDATOR_CHECKS_INFO } = await import('../public/checks.js');

  test('checks.js defines all 16 validator checks with rules and fix hints', () => {
    assert(VALIDATOR_CHECKS_INFO, 'VALIDATOR_CHECKS_INFO should be exported');
    assert(Array.isArray(VALIDATOR_CHECKS_INFO), 'VALIDATOR_CHECKS_INFO should be an array');
    assert.equal(VALIDATOR_CHECKS_INFO.length, 16, `Expected 16 validator checks, found ${VALIDATOR_CHECKS_INFO.length}`);

    const expectedChecks = [
      'scale', 'up_axis', 'normals', 'non_manifold',
      'degenerate_triangles', 'triangle_budget', 'skeleton_binding', 'bone_naming',
      'texture_files', 'texture_slots', 'texture_naming', 'texture_size',
      'material_count', 'uv_layout', 'texel_density', 'manifest',
    ];

    const foundIds = new Set(VALIDATOR_CHECKS_INFO.map((c) => c.id));
    for (const id of expectedChecks) {
      assert(foundIds.has(id), `Missing check info for ${id}`);
    }

    for (const check of VALIDATOR_CHECKS_INFO) {
      assert(check.title, `Check ${check.id} must have a title`);
      assert(check.group, `Check ${check.id} must have a group`);
      assert(check.explanation, `Check ${check.id} must have rule explanation`);
      assert(check.fixHint, `Check ${check.id} must have a fix suggestion`);
    }
  });

  const appJsContent = fs.readFileSync(path.join(UI_DIR, 'public', 'app.js'), 'utf8');

  test('app.js wires the connected workspace (live tree, no hardcoded catalog)', () => {
    assert(!appJsContent.includes('ASSET_CATALOG'), 'hardcoded ASSET_CATALOG must be gone');
    assert(appJsContent.includes("from './workspace.js'"), 'app.js must import workspace.js');
    assert(appJsContent.includes('initWorkspace('), 'app.js must call initWorkspace');
    assert(appJsContent.includes("from './licensed.js'"), 'licensed-sample rules must come from the shared licensed.js');
  });

  test('app.js defines 8 discrete pipeline stages', () => {
    assert(appJsContent.includes('export const PIPELINE_STAGES'), 'PIPELINE_STAGES must be exported');
    const expectedStages = [
      '01_import_measure', '02_retopo', '03_uv', '04_lods',
      '05_bake', '06_export', '07_previews', '08_preview_composites',
    ];
    for (const stage of expectedStages) {
      assert(appJsContent.includes(stage), `app.js must include pipeline stage ${stage}`);
    }
    assert(appJsContent.includes('renderStageTelemetryCards'), 'Must define renderStageTelemetryCards');
    assert(appJsContent.includes('updateStageTelemetry'), 'Must define updateStageTelemetry');
  });

  test('app.js defines dark theme presets and ambient orbs integration', () => {
    assert(appJsContent.includes('export const THEME_PRESETS'), 'THEME_PRESETS must be exported');
    assert(appJsContent.includes('palantir:'), 'Must define palantir preset');
    assert(appJsContent.includes('gotham:'), 'Must define gotham preset');
    assert(appJsContent.includes('prism:'), 'Must define prism preset');
    assert(appJsContent.includes('crimson:'), 'Must define crimson preset');
    assert(appJsContent.includes('emerald:'), 'Must define emerald preset');
    assert(appJsContent.includes('triggerAmbientPulse'), 'Must define triggerAmbientPulse');
    assert(appJsContent.includes('initAmbientLightShow'), 'Must define initAmbientLightShow');
  });

  test('app.js implements dual-engine state management and process dispatch', () => {
    assert(appJsContent.includes('setEngine'), 'Must define setEngine');
    assert(appJsContent.includes('engine: state.engine'), 'Must pass engine in POST body to process');
  });

  const indexHtmlContent = fs.readFileSync(path.join(UI_DIR, 'public', 'index.html'), 'utf8');

  test('index.html contains all Milestone 2 workspace UI elements', () => {
    // Feature 7: Engine Selector
    assert(indexHtmlContent.includes('id="engine-selector-group"'), 'Missing #engine-selector-group');
    assert(indexHtmlContent.includes('id="badge-engine"'), 'Missing #badge-engine');
    assert(indexHtmlContent.includes('id="btn-engine-blender"'), 'Missing #btn-engine-blender');
    assert(indexHtmlContent.includes('id="btn-engine-native"'), 'Missing #btn-engine-native');
    assert(indexHtmlContent.includes('id="chip-engine"'), 'Missing #chip-engine');

    // Feature 8: Stage Telemetry Cards
    assert(indexHtmlContent.includes('id="stage-cards"'), 'Missing #stage-cards in progress bar');
    assert(indexHtmlContent.includes('id="pipeline-stage-cards"'), 'Missing #pipeline-stage-cards in inspector');

    // Feature 10: Notion-Style Asset Tree
    assert(indexHtmlContent.includes('id="ws-asset-tree-card"'), 'Missing #ws-asset-tree-card');
    assert(indexHtmlContent.includes('id="asset-tree-search"'), 'Missing #asset-tree-search');
    assert(indexHtmlContent.includes('id="asset-tree"'), 'Missing #asset-tree');
    assert(indexHtmlContent.includes('id="ws-connections"'), 'Missing #ws-connections');
    assert(indexHtmlContent.includes('id="pane-page"'), 'Missing #pane-page asset page');
    assert(indexHtmlContent.includes('id="gen-dialog"'), 'Missing #gen-dialog');

    // Feature 11: Viewport Controls & Material Mode
    assert(indexHtmlContent.includes('id="sel-mat-mode"'), 'Missing #sel-mat-mode material mode selector');

    // Feature 12: Ambient Canvas
    assert(indexHtmlContent.includes('id="ambient-bg-canvas"'), 'Missing #ambient-bg-canvas');
  });

  const stylesCssContent = fs.readFileSync(path.join(UI_DIR, 'public', 'styles.css'), 'utf8');

  test('styles.css defines Palantir/Notion tokens and component styles', () => {
    // Theme tokens
    assert(stylesCssContent.includes('--bg-void'), 'Missing --bg-void token');
    assert(stylesCssContent.includes('#07080c') || stylesCssContent.includes('#05060a'), 'Missing void background color');
    assert(stylesCssContent.includes('--bg-card'), 'Missing --bg-card token');
    assert(stylesCssContent.includes('--purple'), 'Missing --purple token');
    assert(stylesCssContent.includes('--cyan'), 'Missing --cyan token');

    // Feature 7 styles
    assert(stylesCssContent.includes('.engine-selector-group'), 'Missing .engine-selector-group style');
    assert(stylesCssContent.includes('.badge-engine'), 'Missing .badge-engine style');

    // Feature 8 styles
    assert(stylesCssContent.includes('.stage-cards'), 'Missing .stage-cards style');
    assert(stylesCssContent.includes('.stage-card'), 'Missing .stage-card style');
    assert(stylesCssContent.includes('stage-pulse'), 'Missing stage-pulse keyframes');

    // Feature 9 styles
    assert(stylesCssContent.includes('.check-badge'), 'Missing .check-badge style');
    assert(stylesCssContent.includes('.badge-pass'), 'Missing .badge-pass style');
    assert(stylesCssContent.includes('.badge-warn'), 'Missing .badge-warn style');
    assert(stylesCssContent.includes('.badge-fail'), 'Missing .badge-fail style');

    // Feature 10 styles
    assert(stylesCssContent.includes('.asset-tree'), 'Missing .asset-tree style');
    assert(stylesCssContent.includes('.wst-item'), 'Missing .wst-item style');
    assert(stylesCssContent.includes('.wst-pill.tone-ok'), 'Missing .wst-pill tone styles');
    assert(stylesCssContent.includes('.conn-dot'), 'Missing Connections styles');
    assert(stylesCssContent.includes('.gen-card'), 'Missing generation card styles');
  });

  const viewerJsContent = fs.readFileSync(path.join(UI_DIR, 'public', 'viewer.js'), 'utf8');

  test('viewer.js supports MatCap, Clay, and PBR material modes', () => {
    assert(viewerJsContent.includes('createMatcapTexture'), 'Missing createMatcapTexture generator');
    assert(viewerJsContent.includes('setMaterialMode'), 'Missing setMaterialMode implementation');
    assert(viewerJsContent.includes('applyMaterialMode'), 'Missing applyMaterialMode implementation');
  });

  // ==========================================================================
  // Ephemeral Web Server Setup
  // ==========================================================================
  console.log('\nStarting ephemeral test server...');
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
    console.log(`Server online at ${serverUrl}\n`);

    // ========================================================================
    // Suite 2: Static Asset Serving via HTTP
    // ========================================================================
    console.log('Suite 2: Static Asset Serving via HTTP');

    await testAsync('GET / serves index.html with HTML Content-Type', async () => {
      const res = await fetch(`${serverUrl}/`);
      assert.equal(res.status, 200);
      assert(res.headers.get('content-type')?.includes('text/html'));
      const text = await res.text();
      assert(text.includes('Fabled · Sculpt to Unreal Workspace'));
      assert(text.includes('id="ws-asset-tree-card"'));
    });

    await testAsync('GET /styles.css serves dark theme stylesheet', async () => {
      const res = await fetch(`${serverUrl}/styles.css`);
      assert.equal(res.status, 200);
      assert(res.headers.get('content-type')?.includes('text/css'));
      const text = await res.text();
      assert(text.includes('--bg-void'));
      assert(text.includes('.asset-tree'));
    });

    await testAsync('GET /app.js serves application logic', async () => {
      const res = await fetch(`${serverUrl}/app.js`);
      assert.equal(res.status, 200);
      assert(res.headers.get('content-type')?.includes('text/javascript'));
      const text = await res.text();
      assert(text.includes('initWorkspace('));
      assert(text.includes('PIPELINE_STAGES'));
    });

    await testAsync('GET /viewer.js serves Three.js viewer controller', async () => {
      const res = await fetch(`${serverUrl}/viewer.js`);
      assert.equal(res.status, 200);
      assert(res.headers.get('content-type')?.includes('text/javascript'));
      const text = await res.text();
      assert(text.includes('SideViewer'));
      assert(text.includes('setMaterialMode'));
    });

    await testAsync('GET /checks.js serves pre-import check rules', async () => {
      const res = await fetch(`${serverUrl}/checks.js`);
      assert.equal(res.status, 200);
      assert(res.headers.get('content-type')?.includes('text/javascript'));
      const text = await res.text();
      assert(text.includes('VALIDATOR_CHECKS_INFO'));
    });

    await testAsync('GET /vendor/three/build/three.module.js serves Three.js bundle', async () => {
      const res = await fetch(`${serverUrl}/vendor/three/build/three.module.js`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert(text.includes('THREE') || text.includes('Three.js') || text.length > 50000);
    });

    await testAsync('GET /samples/fabled_sample_head.glb serves sample model binary', async () => {
      const res = await fetch(`${serverUrl}/samples/fabled_sample_head.glb`);
      assert.equal(res.status, 200);
      const buf = await res.arrayBuffer();
      assert(buf.byteLength > 1000, `Sample model buffer too small: ${buf.byteLength}`);
    });

    // ========================================================================
    // Suite 3: Web Server REST API Endpoints
    // ========================================================================
    console.log('\nSuite 3: Web Server REST API Endpoints');

    await testAsync('GET /api/status returns pipeline & validator metadata and engine list', async () => {
      const res = await fetch(`${serverUrl}/api/status`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert(data.pipeline, 'Missing pipeline object');
      assert(data.validator, 'Missing validator object');
      assert(data.pipeline.engines, 'Missing pipeline.engines object');
      assert.equal(data.pipeline.engines.native, true, 'Native fallback engine must be available');
      assert(typeof data.pipeline.engines.blender === 'boolean', 'Blender engine must be boolean');
    });

    let testJobId = null;

    await testAsync('POST /api/jobs creates job and accepts raw sculpt payload', async () => {
      const sampleObj = `v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nv 0.0 0.0 1.0\nf 1 2 3\nf 1 3 4\n`;
      const res = await fetch(`${serverUrl}/api/jobs?filename=test_tetrahedron.obj`, {
        method: 'POST',
        body: sampleObj,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert(data.job_id, 'Response must include job_id');
      assert(data.input_path, 'Response must include input_path');
      testJobId = data.job_id;
    });

    await testAsync('GET /api/jobs/:id/progress returns running state and progress', async () => {
      assert(testJobId, 'testJobId required');
      const res = await fetch(`${serverUrl}/api/jobs/${testJobId}/progress`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert('running' in data, 'Response must indicate running state');
      assert('exit_code' in data, 'Response must include exit_code field');
    });

    await testAsync('POST /api/jobs/:id/validate invokes pre-import validator', async () => {
      assert(testJobId, 'testJobId required');
      const res = await fetch(`${serverUrl}/api/jobs/${testJobId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true, 'Validator response ok must be true');
      assert(data.report, 'Validator response must contain report');
      assert(Array.isArray(data.report.checks), 'Report must contain checks array');
    });

    await testAsync('GET /api/jobs/:id/result returns result payload or status', async () => {
      assert(testJobId, 'testJobId required');
      const res = await fetch(`${serverUrl}/api/jobs/${testJobId}/result`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert('ok' in data, 'Response must have ok field');
    });

    await testAsync('GET /api/saved-reports lists pre-generated reports', async () => {
      const res = await fetch(`${serverUrl}/api/saved-reports`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert(Array.isArray(data.reports), 'reports must be an array');
    });

    await testAsync('POST /api/open-output loads existing pipeline output run', async () => {
      const res = await fetch(`${serverUrl}/api/open-output?dir=pipeline/runs/latest`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true, 'open-output ok must be true');
      assert(data.job_id, 'Must return assigned job_id');
      assert(data.manifest, 'Must load manifest.json');
    });

    // ========================================================================
    // Suite 4: Dual-Engine Process Routing
    // ========================================================================
    console.log('\nSuite 4: Dual-Engine Process Routing');

    await testAsync('POST /api/jobs/:id/process routes to Native Python/NumPy engine', async () => {
      // Create fresh job for native engine run
      const sampleObj = `v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n`;
      const jobRes = await fetch(`${serverUrl}/api/jobs?filename=native_test.obj`, {
        method: 'POST',
        body: sampleObj,
      });
      const jobData = await jobRes.json();
      const nativeJobId = jobData.job_id;

      const procRes = await fetch(`${serverUrl}/api/jobs/${nativeJobId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: 'native',
          profile: { target_triangles: 500 },
        }),
      });
      assert.equal(procRes.status, 200);
      const procData = await procRes.json();
      assert.equal(procData.ok, true, 'Process response ok must be true');
      assert.equal(procData.engine, 'native', 'Engine routed must be native');
    });

    await testAsync('POST /api/jobs/:id/process routes to Headless Blender engine', async () => {
      // Create fresh job for blender engine run
      const sampleObj = `v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n`;
      const jobRes = await fetch(`${serverUrl}/api/jobs?filename=blender_test.obj`, {
        method: 'POST',
        body: sampleObj,
      });
      const jobData = await jobRes.json();
      const blenderJobId = jobData.job_id;

      const procRes = await fetch(`${serverUrl}/api/jobs/${blenderJobId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: 'blender',
          profile: { target_triangles: 500 },
        }),
      });
      assert.equal(procRes.status, 200);
      const procData = await procRes.json();
      assert.equal(procData.ok, true, 'Process response ok must be true');
      assert.equal(procData.engine, 'blender', 'Engine routed must be blender');
    });

  } finally {
    cleanup();
  }

  // ==========================================================================
  // Summary & Results
  // ==========================================================================
  console.log('\n================================================================');
  console.log(` Test Summary: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('\nFailures:');
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.error.message}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed successfully.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
