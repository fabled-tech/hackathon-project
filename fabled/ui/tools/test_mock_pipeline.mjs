// Exercises the progress bar + failed-run handling against test_fixtures/mock_pipeline_cli.py (TEST FIXTURE, no Blender).
// Start the server first:  FABLED_PIPELINE_CMD="python3 $PWD/test_fixtures/mock_pipeline_cli.py --input {input} --out {out} --config {config} --validator-profile {validator_profile}" PORT=5179 node server.mjs
import { chromium } from 'playwright-core';
const URL_ = process.argv[2] || 'http://127.0.0.1:5179/'; const SS = '/workspace/fabled-demos/prototype/ui/screenshots/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs = [];
p.on('console', m => m.type()==='error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
await p.goto(URL_, { waitUntil: 'networkidle' });
await p.setInputFiles('#file-input', '/workspace/fabled-demos/prototype/ui/samples/fabled_sample_head.obj');
await p.waitForFunction(() => window.__fabled.src && document.getElementById('busy').hidden && document.getElementById('validator-source').textContent !== 'not run', null, { timeout: 120000 });
await p.click('#btn-process');
await p.waitForFunction(() => document.getElementById('progress-step').textContent.includes('step 2'), null, { timeout: 60000 });
await p.screenshot({ path: SS + '16_TESTFIXTURE_pipeline_progress_bar.png' });
await p.waitForFunction(() => window.__fabled.lods.length > 0 && document.getElementById('busy').hidden && document.getElementById('progress').hidden, null, { timeout: 120000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { const r = document.querySelector('.report'); const h = document.getElementById('pipeline-section'); r.scrollTop = h.offsetTop - r.offsetTop - 10; });
await p.screenshot({ path: SS + '17_TESTFIXTURE_failed_run_partial_outputs.png' });
console.log(await p.evaluate(() => ({ status: document.getElementById('process-status').textContent, badge: document.getElementById('right-badge').textContent })));
console.log('errors', errs); await b.close(); if (errs.length) process.exit(1);
