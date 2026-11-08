#!/usr/bin/env node
// Drives both demo workspaces in headless Chromium, fails on console errors, writes screenshots/*.png.
// Usage: node tools/screenshot_demos.mjs [baseUrl]   (default http://127.0.0.1:5181, start the server first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// Playwright is resolved via require so a globally installed copy (NODE_PATH / /opt/node-tools) works without npm install.
const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const m of ['playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright']) { try { return require(m); } catch { /* next */ } } throw new Error('playwright not found: npm i -D playwright'); })();

const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

await page.goto(`${BASE}/`); await shot('00-landing');

// Film
await page.goto(`${BASE}/film/`);
await page.click('#btn-empty-new'); await page.click('#btn-sample'); await page.click('#btn-create');
await page.waitForSelector('#shot-table tbody tr'); await shot('10-film-shotlist');
await page.click('#shot-table tbody tr:nth-child(4)'); await page.click('#detail [data-status="approved"]'); await page.waitForTimeout(300);
await page.fill('#comment-text', 'Tighter on her hands here'); await page.click('#btn-comment'); await page.waitForSelector('.comment');
await page.click('#btn-placeholder'); await page.waitForTimeout(500);
await page.click('[data-tab="board"]'); await page.waitForSelector('#board .card'); await shot('11-film-storyboard');
await page.click('[data-tab="animatic"]'); await page.click('#play'); await page.waitForTimeout(1200); await shot('12-film-animatic'); await page.click('#stop');
await page.click('[data-tab="unreal"]'); await page.waitForSelector('#plan-preview:not(:empty)'); await shot('13-film-unreal');

// Game
await page.goto(`${BASE}/game/`);
await page.click('#btn-empty-new'); await page.click('#btn-sample'); await page.click('#btn-create');
await page.waitForSelector('#kanban .card'); await shot('20-game-board');
await page.click('#kanban .card'); await page.click('#btn-gen'); await page.waitForSelector('.pill.generating, .pill.queued, .pill.running', { timeout: 5000 });
await page.waitForSelector('.pill.generated, .pill.succeeded', { timeout: 15000 }); await shot('21-game-generated');
await page.click('[data-tab="layout"]'); await page.waitForTimeout(300);
const box = await page.locator('#layout-canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 5 }); await page.mouse.up();
await page.click('#btn-save-layout'); await page.waitForTimeout(400); await shot('22-game-layout');
await page.click('[data-tab="profiles"]'); await shot('23-game-profiles');
await page.click('[data-tab="unreal"]'); await page.waitForSelector('#plan-preview:not(:empty)'); await shot('24-game-unreal');
await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log(`ok: ${fs.readdirSync(OUT).length} screenshots in ${OUT}`);
