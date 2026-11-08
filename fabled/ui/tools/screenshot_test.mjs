// Headless verification: load the UI, drop the sample sculpt via the file input, build LODs,
// run checks, apply fixes, and save screenshots. Fails (exit 1) on any console error / page error.
// Usage: node tools/screenshot_test.mjs [url] [sample]
//   SCREENS=all (default) | sample (upload flow, clicks Build) | bust (open pipeline output read-only, never clicks Build)
// The upload flow clicks "Build retopo + LODs", so it refuses to run against a server whose pipeline is connected
// (that would launch Blender). Run it on a server started with SCULPTLINE_PIPELINE=off; run SCREENS=bust on the real-mode server.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.argv[2] || 'http://127.0.0.1:5178/';
const SAMPLE = process.argv[3] || path.join(UI, 'samples', 'fabled_sample_head.glb');
const OUT = path.join(UI, 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = []; const logs = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => { const p = path.join(OUT, name); await page.screenshot({ path: p }); console.log('screenshot', p); };
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 300000 });
const t0 = Date.now(); const lap = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.getElementById('chip-pipeline').textContent.includes('checking'));
const scrollToValidator = () => page.evaluate(() => { const r = document.querySelector('.report'); const h = document.getElementById('validator-source').closest('h3'); r.scrollTop = h.offsetTop - r.offsetTop - 10; });
const MODE = process.env.SCREENS || 'all';
const pipelineConnected = (await page.textContent('#chip-pipeline')).includes('connected');
if (MODE !== 'bust' && pipelineConnected) { console.error('Refusing the upload flow: pipeline is connected, clicking Build would launch Blender. Use SCREENS=bust or a SCULPTLINE_PIPELINE=off server.'); await browser.close(); process.exit(2); }
if (MODE !== 'bust') {
await shot('01_empty.png'); lap('loaded');

await page.setInputFiles('#file-input', SAMPLE);
await page.waitForFunction(() => window.__sculptline?.src && document.querySelectorAll('#checks-validator li').length > 0, null, { timeout: 300000 });
await idle(); await page.waitForTimeout(1500);
await shot('02_sculpt_loaded_checks_flagged.png'); lap('sculpt loaded + checked');

await page.check('#t-wire'); await page.waitForTimeout(1500);
await shot('03_sculpt_wireframe.png'); await page.uncheck('#t-wire');

await page.click('#btn-process');
await page.waitForFunction(() => window.__sculptline.lods.length > 0, null, { timeout: 300000 }); await idle(); await page.waitForTimeout(1500);
await shot('04_lods_built_side_by_side.png'); lap('LODs built');

await page.check('#t-wire'); 
const lodButtons = await page.$$('#lod-switch button');
await lodButtons[lodButtons.length - 1].click(); await page.waitForTimeout(1500);
await shot('05_lastLOD_wireframe.png');
await lodButtons[0].click(); await page.waitForTimeout(1200);
await shot('06_LOD0_wireframe.png'); await page.uncheck('#t-wire');

// orbit the left view and confirm the right camera followed (sync)
const box = await page.locator('#view-left canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 - 40, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(800);
await shot('07_orbit_synced.png');

// demo beat: fix scale + flipped normals, then Re-check goes green
if (await page.$('#fix-scale')) await page.click('#fix-scale');
await idle();
if (await page.$('#fix-flip')) await page.click('#fix-flip');
await idle();
await page.click('#btn-process'); await idle();
await page.click('#btn-recheck'); await idle(); await page.waitForTimeout(1200);
await shot('08_after_fixes_recheck.png'); lap('fixes + recheck');

await scrollToValidator(); await page.waitForTimeout(400);
const vsrc = await page.textContent('#validator-source');
await shot(vsrc.includes('real report') ? '09_sample_validator_section_real.png' : '09_validator_section_stub.png'); lap(`validator section: ${vsrc}`);

// Real drag-and-drop path: dispatch a drop event carrying the OBJ sample on the dropzone.
const objPath = path.join(UI, 'samples', 'fabled_sample_head.obj');
if (fs.existsSync(objPath)) {
  const b64 = fs.readFileSync(objPath).toString('base64');
  await page.evaluate(async (data) => {
    const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], 'fabled_sample_head.obj'));
    document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64);
  await page.waitForFunction(() => window.__sculptline?.src?.name === 'fabled_sample_head.obj' && document.querySelectorAll('#checks-validator li').length > 0, null, { timeout: 300000 });
  await idle(); await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelector('.report').scrollTop = 0; });
  await shot('10_obj_dropped.png'); lap('obj dropped');
}
} // end upload flow

// Open the real pipeline output read-only (storyboard shots 3-6 with the bust); fall back to the TEST FIXTURE.
let fixture = null;
const frozenAvailable = await page.evaluate(() => !!document.getElementById('btn-open-frozen') && !document.getElementById('btn-open-frozen').disabled);
const realAvailable = frozenAvailable || await page.evaluate(() => !document.getElementById('btn-open-output').disabled);
const hasFixture = fs.existsSync(path.join(UI, 'test_fixtures', 'pipeline_output_FIXTURE', 'manifest.json'));
if (MODE !== 'sample' && (realAvailable || hasFixture)) {
  const tag = realAvailable ? 'bust' : 'TESTFIXTURE';
  await page.click(frozenAvailable ? '#btn-open-frozen' : realAvailable ? '#btn-open-output' : '#btn-open-fixture');
  await page.waitForFunction(() => window.__sculptline?.src?.fromPipeline && document.getElementById('busy').hidden &&
    !['not run', ''].includes(document.getElementById('validator-source').textContent), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('.report').scrollTop = 0; });
  await shot(`20_${tag}_shot3_profile_and_output.png`);
  await page.check('#t-wire'); await page.waitForTimeout(1200);
  await shot(`21_${tag}_shot4_side_by_side_LOD0_wire.png`);
  const lb = await page.$$('#lod-switch button'); await lb[lb.length - 1].click(); await page.waitForTimeout(1200);
  await shot(`22_${tag}_shot5_lastLOD_wire.png`); await lb[0].click(); await page.uncheck('#t-wire');
  await page.evaluate(() => { const r = document.querySelector('.report'); const h = document.getElementById('pipeline-section'); r.scrollTop = h.offsetTop - r.offsetTop - 10; });
  await page.waitForTimeout(800); await shot(`23_${tag}_shot5_pipeline_run_textures_previews.png`);
  await scrollToValidator(); await page.waitForTimeout(400); await shot(`24_${tag}_shot6_validator_real_report.png`);
  const lic = await page.evaluate(() => ({ credit: document.getElementById('credit').innerText, href: document.querySelector('#credit a')?.href,
    titles: [document.title, document.querySelector('header').innerText, ...[...document.querySelectorAll('h1,h2,h3,.asset-display,#pipeline-run .row2:first-child b')].map((e) => e.innerText)].join(' | ') }));
  if (tag === 'bust') {
    if (!lic.credit.includes('Helen Adams Keller by Onorio Ruotolo, 1916. National Portrait Gallery, Smithsonian Institution (NPG.75.16). 3D model via Smithsonian 3D, CC0.') || !lic.credit.includes('Fabled is not affiliated with or endorsed by the Smithsonian Institution.')) errors.push('license credit/disclaimer missing');
    if (/Keller/i.test(lic.titles)) errors.push(`name in a title/header: ${lic.titles}`);
  }
  fixture = await page.evaluate(() => ({ openedDir: document.getElementById('process-status').textContent, lods: window.__sculptline.lods.map((l) => ({ level: l.level, path: l.path, format: l.format, tris: l.tris, manifestTris: l.manifestTris, budget: l.budget })),
    loadErrors: window.__sculptline.lodLoadErrors, validatorSource: document.getElementById('validator-source').textContent, validatorNote: document.getElementById('validator-note').textContent,
    validatorHeadline: document.getElementById('validator-headline').innerText, credit: document.getElementById('credit').innerText,
    rightBadge: document.getElementById('right-badge').hidden ? null : document.getElementById('right-badge').textContent,
    globalBadge: document.getElementById('global-mockup').hidden ? null : document.getElementById('global-mockup').title,
    validatorChecks: [...document.querySelectorAll('#checks-validator li')].map((li) => `${li.dataset.status}\t${li.dataset.id}\t${(li.querySelector('div > div:nth-child(2)')?.textContent ?? li.querySelector('.plist')?.innerText ?? '').replace(/\s+/g, ' ')}`) }));
  lap(`${tag} output opened`);
}

const summary = await page.evaluate(() => ({
  pipeline: document.getElementById('chip-pipeline').textContent, validator: document.getElementById('chip-validator').textContent,
  mockupBadgeVisible: !document.getElementById('global-mockup').hidden, rightBadgeVisible: !document.getElementById('right-badge').hidden,
  left: document.getElementById('left-stats').textContent, right: document.getElementById('right-stats').textContent,
  lods: window.__sculptline.lods.map((l) => ({ level: l.level, tris: l.tris, budget: l.budget, source: l.source })),
  browserChecks: [...document.querySelectorAll('#checks-browser li')].map((li) => `${li.dataset.passed}\t${li.dataset.id}\t${(li.querySelector('div > div:nth-child(2)')?.textContent ?? li.querySelector('.plist')?.innerText ?? '').replace(/\s+/g, ' ')}`),
  summary: document.getElementById('report-summary').innerText,
}));
console.log(JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ fixture }, null, 2));
fs.writeFileSync(path.join(OUT, MODE === 'all' ? 'run_log.json' : `run_log_${MODE}.json`), JSON.stringify({ url: URL_, sample: SAMPLE, errors, logs, summary, fixture }, null, 2));
await browser.close();
if (errors.length) { console.error('CONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('OK: no console errors');
