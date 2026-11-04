// Screenshot of the validator report's manifest check (long pipeline-warning list) in the static demo.
import { chromium } from 'playwright-core';
const URL_ = process.argv[2] || 'http://127.0.0.1:5190/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = []; p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(URL_, { waitUntil: 'load' });
await p.waitForFunction(() => document.querySelector('.plist'), null, { timeout: 120000 });
const info = await p.evaluate(() => { const el = document.querySelector('.plist'); const li = el.closest('li'); li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { items: el.querySelectorAll('li').length, overflowX: li.scrollWidth > li.clientWidth + 1, text: li.innerText.slice(0, 400) }; });
await p.waitForTimeout(500);
const li = await p.$('li:has(.plist)'); await li.screenshot({ path: 'screenshots/demo_06_manifest_warnings_list.png' });
console.log(JSON.stringify({ info, errors }, null, 1)); await b.close(); process.exit(errors.length ? 1 : 0);
