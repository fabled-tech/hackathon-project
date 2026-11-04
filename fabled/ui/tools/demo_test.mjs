// Headless test of the static demo build. Serve dist/ with any plain static server first, e.g.
//   python3 -m http.server 5190 --bind 127.0.0.1 -d dist      then   node tools/demo_test.mjs [http://127.0.0.1:5190/]
// Fails on console errors, failed requests, any /api/ or /samples/ request, visible upload/Build controls,
// or any CONCEPT MOCKUP / TEST FIXTURE / stub text in the page.
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const OUT = path.join(UI, 'screenshots');
const URL_ = process.argv[2] || 'http://127.0.0.1:5190/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errors = []; const requests = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { requests.push(r.url()); if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
const shot = async (n) => { const p = path.join(OUT, n); await page.screenshot({ path: p }); console.log('screenshot', p); };
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fabled?.src?.fromPipeline && document.getElementById('busy').hidden && document.querySelectorAll('#checks-validator li').length > 0, null, { timeout: 180000 });
await page.waitForTimeout(1500); await page.evaluate(() => { document.querySelector('.report').scrollTop = 0; });
await shot('demo_01_overview_profile_used.png');
await page.check('#t-wire'); await page.waitForTimeout(1200); await shot('demo_02_side_by_side_LOD0_wire.png');
const lb = await page.$$('#lod-switch button'); await lb[lb.length - 1].click(); await page.waitForTimeout(1200);
await shot('demo_03_lastLOD_wire.png'); await lb[0].click(); await page.uncheck('#t-wire');
await page.evaluate(() => { const r = document.querySelector('.report'); const h = document.getElementById('pipeline-section'); r.scrollTop = h.offsetTop - r.offsetTop - 10; });
await page.waitForTimeout(800); await shot('demo_04_pipeline_run_textures_previews.png');
await page.evaluate(() => { const r = document.querySelector('.report'); const h = document.getElementById('validator-source').closest('h3'); r.scrollTop = h.offsetTop - r.offsetTop - 10; });
await page.waitForTimeout(500); await shot('demo_05_validator_recorded_report.png');
const info = await page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return { text: document.body.innerText, chip: document.getElementById('chip-pipeline').textContent, validatorChip: document.getElementById('chip-validator').textContent,
    visibleControls: ['dropzone', 'file-input', 'btn-sample', 'btn-process', 'btn-open-fixture', 'btn-open-output', 'saved-reports'].filter(vis),
    lods: window.__fabled.lods.map((l) => ({ level: l.level, tris: l.tris, manifestTris: l.manifestTris, format: l.format })), loadErrors: window.__fabled.lodLoadErrors,
    headline: document.getElementById('validator-headline').innerText,
    normals: document.querySelector('#checks-browser li[data-id="normals.flipped"]')?.innerText };
});
const lic = await (async () => page.evaluate(() => ({
  credit: document.getElementById('credit')?.innerText || '', creditHref: document.querySelector('#credit a')?.href || '',
  leftCredit: document.getElementById('left-credit')?.innerText || '',
  titleish: [document.title, document.querySelector('header')?.innerText, ...[...document.querySelectorAll('h1,h2,h3,.asset-display,#pipeline-run .row2:first-child b')].map((e) => e.innerText)].join(' | '),
  logos: [...document.querySelectorAll('img')].map((i) => i.src).filter((u) => /smithsonian|npg|si\.edu|logo/i.test(u)),
})))();
const CREDIT = 'Helen Adams Keller by Onorio Ruotolo, 1916. National Portrait Gallery, Smithsonian Institution (NPG.75.16). 3D model via Smithsonian 3D, CC0.';
if (!lic.credit.includes(CREDIT) || !lic.leftCredit.includes(CREDIT)) errors.push('license credit line missing or not verbatim');
if (lic.creditHref !== 'https://3d.si.edu/object/3d/helen-adams-keller:d8c64ccc-4ebc-11ea-b77f-2e728ce88125') errors.push(`credit link wrong: ${lic.creditHref}`);
if (!lic.credit.includes('Fabled is not affiliated with or endorsed by the Smithsonian Institution.')) errors.push('no-endorsement line missing');
if (/Keller/i.test(lic.titleish)) errors.push(`her name appears in a title/header/label: ${lic.titleish}`);
if (!lic.titleish.includes('Sample asset: historical bust scan (CC0)')) errors.push('display name missing');
if (lic.logos.length) errors.push(`logo-like images: ${lic.logos.join(', ')}`);
if (!/Height measured 53\.\d cm from the file \(source units inferred\)/.test(info.text)) errors.push('height not shown as measured-from-file');
info.license = lic;
const vs = await page.evaluate(async () => { const r = await (await fetch('demo-data/validator_report.json')).json(); const el = document.querySelector('#validator-headline .ostatus');
  return { report: r.overall_status, shown: el?.textContent, cls: el?.className, tag: document.querySelector('#validator-headline .placeholder-tag')?.textContent || null, profileTag: document.getElementById('up-placeholder').hidden ? null : document.getElementById('up-placeholder').textContent }; });
if (vs.shown !== vs.report || !vs.cls.includes(vs.report)) errors.push(`validator status shown ${vs.shown}/${vs.cls} != report ${vs.report}`);
if (/DEMO PLACEHOLDER/.test(JSON.stringify(await page.evaluate(() => fetch('demo-data/validator_profile.json').then((r) => r.text())))) && (vs.tag !== 'DEMO PLACEHOLDER VALUES' || vs.profileTag !== 'DEMO PLACEHOLDER VALUES')) errors.push('DEMO PLACEHOLDER VALUES label not visible');
info.validatorStatus = vs;
const banned = ['CONCEPT MOCKUP', 'TEST FIXTURE', 'stub'].filter((w) => info.text.includes(w));
if (banned.length) errors.push(`banned text on page: ${banned.join(', ')}`);
if (info.visibleControls.length) errors.push(`upload/build controls visible: ${info.visibleControls.join(', ')}`);
const backend = requests.filter((u) => /\/api\/|\/samples\/|test_fixtures|CONCEPT_MOCKUP/.test(u));
if (backend.length) errors.push(`backend/sample requests: ${backend.join(', ')}`);
if (!/^Pre-processed real run, recorded /.test(info.chip)) errors.push(`missing recorded-run label: ${info.chip}`);
delete info.text; console.log(JSON.stringify({ ...info, requests: requests.length }, null, 2));
fs.writeFileSync(path.join(OUT, 'demo_run_log.json'), JSON.stringify({ url: URL_, errors, info, requests }, null, 2));
await b.close();
if (errors.length) { console.error('FAILED:\n' + errors.join('\n')); process.exit(1); }
console.log('OK: static demo, no console errors, no backend requests');
