// Render a saved real validator report in the UI and screenshot it.
// Usage: node tools/shot_saved_report.mjs [rel-under-validator/reports] [out.png]
import { chromium } from 'playwright-core';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = process.argv[2] || 'real_pipeline_output/SM_HelenKellerBust_fbx.report.json';
const OUT = process.argv[3] || path.join(UI, 'screenshots', '11_validator_real_report.png');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
await p.goto(process.env.URL || 'http://127.0.0.1:5178/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.querySelectorAll('#saved-reports option').length > 1);
await p.selectOption('#saved-reports', REL); await p.click('#btn-saved-report');
await p.waitForFunction(() => document.querySelectorAll('#checks-validator li').length > 0);
await p.evaluate(() => { const r = document.querySelector('.report'); const h = document.getElementById('validator-source').closest('h3'); r.scrollTop = h.offsetTop - r.offsetTop - 10; });
await p.waitForTimeout(500);
await p.screenshot({ path: OUT });
const info = await p.evaluate(() => ({ src: document.getElementById('validator-source').textContent, head: document.getElementById('validator-headline').innerText,
  rows: [...document.querySelectorAll('#checks-validator li')].map((li) => `${li.dataset.status} ${li.className} ${li.dataset.id}`) }));
console.log(JSON.stringify(info, null, 1)); console.log('errors', errs, '\nscreenshot', OUT); await b.close();
