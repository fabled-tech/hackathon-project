#!/usr/bin/env node
// Browser regression walkthrough for both demo workspaces (headless Chromium through Playwright).
// Drives the real UI against a running server, asserts the collaboration, security, keyboard and phone-width
// behaviour of the two clients, and writes screenshots/*.png. Exits non-zero on any failed check or any browser
// console error that a check did not announce in advance.
// Usage: node tools/screenshot_demos.mjs [baseUrl]   (default http://127.0.0.1:5181, start the server first;
//        FABLED_PROVIDER_MOCK_MS=4000 keeps the mock generation short)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// Playwright is resolved via require so a globally installed copy (NODE_PATH / /opt/node-tools) works without npm install.
const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const m of ['playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright']) { try { return require(m); } catch { /* next */ } } throw new Error('playwright not found: npm i -D playwright'); })();

const BASE = (process.argv[2] || 'http://127.0.0.1:5181').replace(/\/$/, '');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f));

// ---- harness ----------------------------------------------------------------------------------------------------------
const results = [], notes = [], errors = [];
let tolerated = []; // console-error patterns the current check expects (e.g. the browser's own line for a 4xx it provokes)
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
let page;
const shot = (name, p = page) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
async function check(name, fn, { expectErrors = [] } = {}) {
  tolerated = expectErrors;
  try { await fn(); results.push({ name, ok: true }); console.log(`ok    ${name}`); } catch (e) {
    results.push({ name, ok: false, error: e.message }); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
    await shot(`fail-${slug(name)}`).catch(() => {});
  }
  await sleep(50); tolerated = [];
}
function watch(p, label) {
  p.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (tolerated.some((re) => re.test(t))) return; errors.push(`${label} console: ${t}`); });
  p.on('dialog', (d) => { dialogs.push(d.type()); d.accept().catch(() => {}); });
}
const dialogs = [];
// The "other collaborator": plain HTTP from Node, never through the page.
async function remote(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const HOSTILE = '"><img src=x onerror=window.__xss=1>';
const HOSTILE2 = '\'><svg onload=window.__xss=1></svg><script>window.__xss=1</script>';
const JS_URL = 'javascript:window.__xss=1';
// Nothing injected may have become markup: no flag, no event-handler attributes, no script URLs, only expected images.
async function assertClean(p, where, imgAllowed) {
  const r = await p.evaluate((allowed) => {
    const bad = [];
    if (window.__xss !== undefined) bad.push('window.__xss is set');
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) bad.push(`<${el.tagName.toLowerCase()} ${a.name}>`);
        if (['src', 'href', 'action', 'formaction', 'xlink:href'].includes(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value)) bad.push(`<${el.tagName.toLowerCase()} ${a.name}="${a.value.slice(0, 40)}">`);
      }
      if (typeof el.className === 'string' && /[<>"=]|onerror|onload/.test(el.className)) bad.push(`class="${el.className.slice(0, 60)}"`);
    }
    const re = new RegExp(allowed);
    for (const img of document.querySelectorAll('img')) if (img.getAttribute('src') && !re.test(img.src)) bad.push(`unexpected <img src="${img.src.slice(0, 60)}">`);
    for (const s of document.querySelectorAll('script')) if (!/\/(film|game)\/app\.js$/.test(s.src)) bad.push('unexpected <script>');
    for (const t of ['svg', 'iframe', 'object', 'embed']) if (document.querySelector(t)) bad.push(`unexpected <${t}>`);
    return bad;
  }, imgAllowed);
  assert(r.length === 0, `${where}: ${r.slice(0, 6).join('; ')}`);
}
const noOverflow = async (p, where) => { const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); assert(m.sw <= m.iw, `${where}: page scrolls horizontally (scrollWidth ${m.sw} > innerWidth ${m.iw})`); };
async function tabTo(p, selector, max = 60) {
  for (let i = 0; i < max; i += 1) { await p.keyboard.press('Tab'); if (await p.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), selector)) return; }
  throw new Error(`Tab never reached ${selector}`);
}
const focusRing = (p) => p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
const tcSeconds = (t) => { const [m, s, f] = t.split(':').map(Number); return m * 60 + s + f / 24; };
const sent = []; // mutating requests the pages made
const trackRequests = (p) => p.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/')) sent.push({ method: r.method(), url: r.url(), headers: r.headers() }); });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page = await ctx.newPage(); watch(page, 'desktop'); trackRequests(page);

await check('landing page loads', async () => { await page.goto(`${BASE}/`); await page.waitForSelector('.landing a.card'); await shot('00-landing'); });

// ============================================================ Fabled Shots ============================================
let film = null; // project id
const filmProject = async () => (await remote('GET', `/api/film/projects/${film}`)).json.project;
const FILM_IMG = `^(data:image/(svg\\+xml|png|jpeg|webp);base64,|${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/film/projects/)`;

await check('film: breakdown from the sample script', async () => {
  await page.goto(`${BASE}/film/`);
  await page.click('#btn-empty-new'); await page.click('#btn-sample');
  await page.waitForFunction(() => document.querySelector('#new-text').value.length > 100);
  await page.click('#btn-create');
  await page.waitForSelector('#shot-table tbody tr');
  film = (await page.evaluate(() => location.hash.slice(1)));
  assert(/^[a-z0-9_-]+$/i.test(film), `project id in the URL hash, got "${film}"`);
  assert((await page.locator('#shot-table tbody tr').count()) >= 8, 'at least 8 proposed shots');
  await shot('10-film-shotlist');
});

await check('film: role selector persists across reload (localStorage) and the project reopens from the hash', async () => {
  await page.selectOption('#role', 'dp');
  await remote('POST', '/api/film/projects', { title: `Delete me ${HOSTILE}`, text: 'INT. ROOM - DAY\n\nMARA\nHello.\n' });
  await page.reload();
  await page.waitForSelector('#shot-table tbody tr');
  eq(await page.inputValue('#role'), 'dp', 'role after reload');
  await assertClean(page, 'project list with a hostile title', FILM_IMG);
});

await check('film: keyboard: Tab reaches a shot row, arrows move, Enter selects, focus ring is visible', async () => {
  await page.locator('.brand .logo').focus();
  await tabTo(page, '#shot-table tbody tr');
  assert(await focusRing(page), 'focused shot row has a visible outline');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const id = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('Enter');
  await page.waitForFunction((x) => document.querySelector('#shot-table tbody tr.active')?.dataset.id === x, id);
  eq(await page.locator('#shot-table tbody tr.active').count(), 1, 'one active row');
  assert((await page.innerText('#d-title')).includes(id), 'detail pane shows the shot selected with Enter');
  eq(await page.evaluate(() => document.activeElement.dataset.id), id, 'focus stays on the selected row after re-render');
});

await check('film: approve from the detail pane; mutating requests are JSON and conditional (If-Match)', async () => {
  sent.length = 0;
  await page.click('#detail [data-status="approved"]');
  await page.waitForSelector('#shot-table tbody tr.active .pill.approved');
  const patch = sent.find((r) => r.method === 'PATCH');
  assert(patch, 'a PATCH was sent');
  assert(/^application\/json/.test(patch.headers['content-type'] || ''), 'PATCH has Content-Type: application/json');
  assert(/^\d+$/.test(patch.headers['if-match'] || ''), `PATCH carries If-Match: <rev>, got "${patch.headers['if-match']}"`);
});

let filmShots = [];
await check('film: a remote change does not wipe a half-typed prompt or comment, focus, caret or scroll', async () => {
  filmShots = (await filmProject()).shots;
  const mine = await page.evaluate(() => document.querySelector('#shot-table tbody tr.active').dataset.id);
  const other = filmShots.find((s) => s.id !== mine && s.id !== filmShots[0].id);
  await page.fill('#comment-text', 'Tighter on her hands');
  await page.click('#f-prompt');
  await page.fill('#f-prompt', 'A prompt I am still typing');
  await page.evaluate(() => { document.querySelector('#f-prompt').setSelectionRange(8, 8); document.querySelector('#main').scrollTop = 140; });
  const scroll0 = await page.evaluate(() => document.querySelector('#main').scrollTop);
  // collaborator edits another shot and comments on the shot we have open
  await remote('PATCH', `/api/film/projects/${film}/shots/${other.id}?as=producer`, { description: 'REMOTE EDIT lands here' });
  await remote('POST', `/api/film/projects/${film}/shots/${mine}/comments?as=producer`, { text: 'remote note' });
  await page.waitForFunction(() => document.querySelector('#shot-table tbody').innerText.includes('REMOTE EDIT lands here'), null, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#d-comments').innerText.includes('remote note'));
  eq(await page.inputValue('#f-prompt'), 'A prompt I am still typing', 'prompt text after the poll');
  eq(await page.evaluate(() => document.activeElement.id), 'f-prompt', 'focus after the poll');
  eq(await page.evaluate(() => document.querySelector('#f-prompt').selectionStart), 8, 'caret after the poll');
  eq(await page.inputValue('#comment-text'), 'Tighter on her hands', 'comment draft after the poll');
  eq(await page.evaluate(() => document.querySelector('#main').scrollTop), scroll0, 'main pane scroll after the poll');
  assert(await page.evaluate(() => document.querySelector('#f-prompt').classList.contains('unsaved')), 'unsaved prompt is marked');
  // now the comment box has focus while another remote change lands
  await page.click('#comment-text'); await page.keyboard.press('End'); await page.keyboard.type(' here');
  await remote('PATCH', `/api/film/projects/${film}/shots/${other.id}?as=producer`, { description: 'REMOTE EDIT two' });
  await page.waitForFunction(() => document.querySelector('#shot-table tbody').innerText.includes('REMOTE EDIT two'), null, { timeout: 12000 });
  eq(await page.inputValue('#comment-text'), 'Tighter on her hands here', 'comment text while focused');
  eq(await page.evaluate(() => document.activeElement.id), 'comment-text', 'comment box keeps focus');
  // post it with Enter, then save the prompt with Ctrl+Enter
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#d-comments').innerText.includes('Tighter on her hands here'));
  eq(await page.inputValue('#comment-text'), '', 'comment box is cleared after posting');
  await page.click('#f-prompt'); await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !document.querySelector('#f-prompt').classList.contains('unsaved'));
  eq((await filmProject()).shots.find((s) => s.id === mine).prompt, 'A prompt I am still typing', 'prompt stored on the server');
  await page.evaluate(() => { document.querySelector('#main').scrollTop = 0; });
});

await check('film: server 400 shows the error and reverts the control; 409 applies the server copy and says so', async () => {
  const stored = await page.inputValue('#f-size');
  const pick = stored === 'Wide' ? 'Medium' : 'Wide';
  await page.route('**/api/film/projects/*/shots/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'size must be one of: test' }) }) : route.fallback()));
  await page.selectOption('#f-size', pick);
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('size must be one of'));
  eq(await page.inputValue('#f-size'), stored, 'select reverted to the stored value after 400');
  await page.unroute('**/api/film/projects/*/shots/*');
  const current = await filmProject();
  await page.route('**/api/film/projects/*/shots/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'rev_conflict', error: 'project changed', rev: current.rev, project: current }) }) : route.fallback()));
  await page.selectOption('#f-size', pick);
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Someone else changed this; your edit was not applied'));
  eq(await page.inputValue('#f-size'), stored, 'select shows the server value after 409');
  await page.unroute('**/api/film/projects/*/shots/*');
  // client-side range check on numbers
  await page.fill('#f-lens', '5000'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('Lens:'));
  assert((await page.inputValue('#f-lens')) !== '5000', 'out-of-range lens is reverted');
  // live conflict: edit right after a remote change, before the next poll. Older servers ignore If-Match and apply it.
  const mine = await page.evaluate(() => document.querySelector('#shot-table tbody tr.active').dataset.id);
  await remote('PATCH', `/api/film/projects/${film}/shots/${filmShots[0].id}?as=producer`, { subject: 'remote subject' });
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'PATCH'), page.selectOption('#f-assignee', 'producer')]);
  await sleep(300);
  const applied = (await filmProject()).shots.find((s) => s.id === mine).assignee === 'producer';
  const told = (await page.innerText('#toast')).includes('Someone else changed this');
  assert(applied !== told, `either the edit is applied or the conflict notice shows (applied=${applied}, notice=${told})`);
  eq(await page.inputValue('#f-assignee'), applied ? 'producer' : (await filmProject()).shots.find((s) => s.id === mine).assignee, 'assignee control matches the server');
  notes.push(`film If-Match on a stale rev: ${told ? 'server answered 409, notice shown, edit not applied' : 'server applied the edit (no rev check)'}`);
}, { expectErrors: [/status of 400/, /status of 409/] });

await check('film: move drives the animation preset through one client-side map', async () => {
  await page.selectOption('#f-move', 'Crash zoom');
  await page.waitForFunction(() => !document.querySelector('#f-move').classList.contains('unsaved') && document.querySelector('#shot-table tbody tr.active').innerText.includes('Crash zoom'));
  await page.click('[data-tab="animatic"]'); await page.click('#play');
  await page.waitForFunction(() => document.querySelector('#screen').classList.contains('kb-crash_zoom'));
  assert((await page.evaluate(() => getComputedStyle(document.querySelector('#screen-img')).animationName)) === 'kbCrash', 'crash zoom keyframes run while playing');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  eq(await page.evaluate(() => getComputedStyle(document.querySelector('#screen-img')).animationName), 'none', 'animation under prefers-reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.click('#stop'); await page.click('[data-tab="shots"]');
});

await check('film: placeholder frame is uploaded as PNG, served by url or data URI, and can be removed', async () => {
  sent.length = 0;
  await page.click('#btn-placeholder');
  await page.waitForFunction(() => /^(data:image\/png|http)/.test(document.querySelector('#d-frame img').src));
  const up = sent.find((r) => r.method === 'POST' && /\/frame/.test(r.url));
  assert(up, 'frame upload request was sent');
  const mine = await page.evaluate(() => document.querySelector('#shot-table tbody tr.active').dataset.id);
  const frame = (await filmProject()).shots.find((s) => s.id === mine).frame;
  assert(frame && (frame.url || frame.data_uri), 'server stored a frame');
  assert(frame.url ? frame.mime === 'image/png' : frame.data_uri.startsWith('data:image/png;base64,'), 'stored frame is a PNG');
  await page.waitForFunction(() => { const i = document.querySelector('#d-frame img'); return i.complete && i.naturalWidth > 0; });
  assert(await page.locator('#d-frame .badge-mockup').count(), 'rasterized placeholder keeps the CONCEPT MOCKUP badge');
  notes.push(`film frame contract: server returned ${frame.url ? `frame.url (${frame.url.split('?')[0]})` : 'frame.data_uri (old shape)'}`);
  await page.click('#btn-remove-frame');
  await page.waitForFunction(() => /frame removed|cannot remove frames yet/.test(document.querySelector('#toast').textContent));
  const removed = (await page.innerText('#toast')).includes('frame removed');
  if (removed) {
    await page.waitForFunction(() => document.querySelector('#d-frame img').src.startsWith('data:image/svg+xml'));
    eq((await filmProject()).shots.find((s) => s.id === mine).frame, null, 'frame is gone on the server');
    assert(await page.locator('#btn-remove-frame').isHidden(), 'Remove frame hides when there is no frame');
    await page.click('#btn-placeholder');
    await page.waitForFunction(() => /^(data:image\/png|http)/.test(document.querySelector('#d-frame img').src));
  }
  notes.push(`film Remove frame: ${removed ? 'DELETE accepted, placeholder is back' : 'server has no DELETE yet, client said so and kept the frame'}`);
}, { expectErrors: [/status of 40[45]/] });

await check('film: storyboard cards are keyboard-operable', async () => {
  await page.click('[data-tab="board"]'); await page.waitForSelector('#board .card');
  await page.locator('#board .card').nth(1).focus();
  await page.keyboard.press('ArrowRight');
  const id = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('Space');
  await page.waitForFunction((x) => document.querySelector('#board .card.active')?.dataset.id === x, id);
  eq(await page.evaluate(() => document.activeElement.dataset.id), id, 'focus stays on the activated card');
  await page.waitForFunction(() => [...document.querySelectorAll('#board img')].slice(0, 6).every((i) => i.complete && i.naturalWidth > 0));
  await shot('11-film-storyboard');
});

await check('film: animatic keeps playing through a remote update, shows total runtime, seeks on timeline click', async () => {
  await page.click('[data-tab="animatic"]');
  await page.waitForSelector('#timeline .seg');
  const total = tcSeconds(await page.innerText('#runtime'));
  assert(total > 5, `total runtime is shown (${total}s)`);
  await page.locator('#timeline .seg').first().focus(); await page.keyboard.press('Enter'); // seek to the first shot (keyboard)
  await page.click('#play');
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'true');
  await sleep(1300); await shot('12-film-animatic');
  const t1 = tcSeconds(await page.innerText('#timecode'));
  assert(t1 > 0.8, `timecode advances while playing (${t1}s)`);
  const last = filmShots[filmShots.length - 1];
  await remote('PATCH', `/api/film/projects/${film}/shots/${last.id}?as=producer`, { status: 'redo' });
  await page.waitForFunction(() => !!document.querySelector('#timeline .seg:last-child.redo'), null, { timeout: 12000 });
  eq(await page.getAttribute('#play', 'aria-pressed'), 'true', 'still playing after the remote update');
  const t2 = tcSeconds(await page.innerText('#timecode'));
  assert(t2 > t1, `playback did not restart (${t1}s → ${t2}s)`);
  const box = await page.locator('#timeline').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await sleep(250);
  const t3 = tcSeconds(await page.innerText('#timecode'));
  assert(Math.abs(t3 - total * 0.6) < 1.5, `timeline click seeks to ~60% (${t3}s of ${total}s)`);
  eq(await page.getAttribute('#play', 'aria-pressed'), 'true', 'still playing after the seek');
  await sleep(500);
  assert(tcSeconds(await page.innerText('#timecode')) > t3, 'timecode keeps advancing after the seek');
  await page.click('#stop');
  eq(await page.getAttribute('#play', 'aria-pressed'), 'false', 'stopped');
});

await check('film: Unreal & export tab keeps plain download links', async () => {
  await page.click('[data-tab="unreal"]');
  await page.waitForFunction(() => document.querySelector('#plan-preview')?.textContent.includes('"schema"'));
  for (const f of ['shotlist.csv', 'shotlist.json', 'sequencer_plan.json', 'unreal.py']) eq(await page.locator(`#tab-unreal a[href$="/export/${f}"]`).count(), 1, `plain link to ${f}`);
  await shot('13-film-unreal');
});

await check('film: hostile project values are rendered as text, never as markup, class names or URLs', async () => {
  // through the API where the server takes them …
  await remote('POST', `/api/film/projects/${film}/shots/${filmShots[1].id}/comments?as=${encodeURIComponent(HOSTILE)}`, { text: HOSTILE2 });
  await remote('PATCH', `/api/film/projects/${film}/shots/${filmShots[1].id}?as=${encodeURIComponent(HOSTILE)}`, { status: HOSTILE, size: HOSTILE, move: HOSTILE2, subject: HOSTILE, description: HOSTILE, assignee: HOSTILE, lens_mm: HOSTILE, duration_s: HOSTILE });
  // … and through an intercepted poll for the fields a validating server refuses
  const real = await filmProject();
  const evil = JSON.parse(JSON.stringify(real));
  evil.rev = real.rev + 1000; evil.title = HOSTILE; evil.scenes = 'not-an-array'; evil.total_duration_s = HOSTILE;
  evil.roles = [HOSTILE, 'director']; evil.locations = [HOSTILE, { x: 1 }]; evil.characters = [{ name: HOSTILE, lines: HOSTILE }, null]; evil.props = [{ name: HOSTILE2, mentions: HOSTILE }];
  evil.activity = [{ at: HOSTILE, who: HOSTILE, what: HOSTILE2 }, 'junk', ...real.activity];
  evil.shots.forEach((s, i) => {
    if (i % 2) return;
    Object.assign(s, { status: HOSTILE, scene: HOSTILE, size: HOSTILE, move: HOSTILE2, preset: HOSTILE, lens_mm: HOSTILE, duration_s: i === 0 ? HOSTILE : s.duration_s, subject: HOSTILE, description: HOSTILE2, assignee: HOSTILE, scene_heading: HOSTILE, ots_side: HOSTILE, prompt: HOSTILE,
      frame: { url: JS_URL, data_uri: 'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9MTwvc2NyaXB0Pg==', mime: HOSTILE, label: HOSTILE, at: HOSTILE, concept_mockup: false },
      clip: { task_id: HOSTILE, provider: HOSTILE, status: HOSTILE, progress: HOSTILE, url: i === 0 ? JS_URL : 'http://clips.invalid/not-https.mp4', error: HOSTILE2 },
      comments: [{ who: HOSTILE, at: HOSTILE, text: HOSTILE2 }, 'junk'] });
  });
  evil.shots[2].id = HOSTILE;
  evil.shots.push('junk', null);
  await page.route('**/api/film/projects/*/clips*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project: evil }) }));
  await page.click('[data-tab="shots"]');
  await page.waitForFunction((h) => document.querySelector('#shot-table tbody tr td:nth-child(2)')?.textContent === h, HOSTILE, { timeout: 12000 });
  for (const tab of ['shots', 'board', 'animatic', 'unreal']) {
    await page.click(`[data-tab="${tab}"]`); await sleep(150);
    await assertClean(page, `film ${tab} tab`, FILM_IMG);
  }
  await page.click('[data-tab="shots"]');
  for (const i of [0, 2]) { await page.locator('#shot-table tbody tr').nth(i).click(); await sleep(100); await assertClean(page, `film detail pane, shot ${i}`, FILM_IMG); }
  eq(await page.locator('#shot-table tbody tr').nth(2).locator('td').first().innerText(), HOSTILE, 'hostile shot id is shown as text');
  eq(await page.locator('#d-frame video').count(), 0, 'no <video> for a javascript: clip URL');
  eq(await page.locator('#shot-table tbody tr').count(), real.shots.length, 'junk shot entries are dropped, real ones stay');
  await page.click('[data-tab="animatic"]'); await page.click('#play'); await sleep(300);
  eq(await page.evaluate(() => [...document.querySelector('#screen').classList].filter((c) => c.startsWith('kb-')).every((c) => /^kb-[a-z_]+$/.test(c))), true, 'animation class is whitelisted');
  await page.click('#stop'); await assertClean(page, 'film animatic after play', FILM_IMG);
  await shot('14-film-hostile-values-as-text');
  await page.unroute('**/api/film/projects/*/clips*');
  await page.click('[data-tab="shots"]');
  await page.waitForFunction((h) => document.querySelector('#shot-table tbody tr td:nth-child(2)')?.textContent !== h, HOSTILE, { timeout: 12000 });
  await assertClean(page, 'film after recovery (API-injected values)', FILM_IMG);
});

await check('film: polling is single-flight, shows offline, backs off and recovers by itself', async () => {
  let started = 0, release = null;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/film/projects/*/clips*', async (route) => { started += 1; await gate; await route.abort().catch(() => {}); });
  await sleep(7500); // two and a half poll periods with the first request still in flight
  eq(started, 1, 'poll requests started while one is in flight');
  release();
  await page.waitForFunction(() => document.querySelector('#sync').textContent.startsWith('offline'), null, { timeout: 5000 });
  assert(/retrying in 6 s/.test(await page.innerText('#sync')), `first retry is delayed to 6 s: "${await page.innerText('#sync')}"`);
  await page.waitForFunction(() => /retrying in 12 s/.test(document.querySelector('#sync').textContent), null, { timeout: 9000 });
  await page.unroute('**/api/film/projects/*/clips*');
  await page.waitForFunction(() => document.querySelector('#sync').textContent === 'synced', null, { timeout: 16000 });
}, { expectErrors: [/Failed to load resource/] });

await check('film: a project can be deleted from the list after a confirm step', async () => {
  const row = page.locator('#projects .proj-row', { hasText: 'Delete me' });
  await row.waitFor({ timeout: 20000 });
  await row.locator('.icon-btn').click();
  await page.waitForSelector('#projects .proj-row.confirm');
  await page.click('#projects [data-act="delete-no"]');
  eq(await page.locator('#projects .proj-row.confirm').count(), 0, 'Cancel leaves the project alone');
  await page.locator('#projects .proj-row', { hasText: 'Delete me' }).locator('.icon-btn').click();
  await page.click('#projects [data-act="delete-yes"]');
  await page.waitForFunction(() => !document.querySelector('#projects').innerText.includes('Delete me'));
  const list = (await remote('GET', '/api/film/projects')).json.projects;
  assert(!list.some((p) => String(p.title).includes('Delete me')), 'project is gone on the server');
  assert(list.some((p) => p.id === film), 'the open project is untouched');
  assert(await page.locator('#shot-table tbody tr').count(), 'the open project is still showing');
});

// ============================================================ Fabled Forge ============================================
let game = null;
const gameProject = async () => (await remote('GET', `/api/game/projects/${game}`)).json.project;
const selectedItem = () => page.locator('#layout-list [aria-pressed="true"]').innerText();
const firesBeforeUnload = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });

await check('game: kit from the sample pitch', async () => {
  await page.goto(`${BASE}/game/`);
  await page.click('#btn-empty-new'); await page.click('#btn-sample');
  await page.waitForFunction(() => document.querySelector('#new-text').value.length > 50);
  await page.click('#btn-create');
  await page.waitForSelector('#kanban .card');
  game = await page.evaluate(() => location.hash.slice(1));
  assert(/^[a-z0-9_-]+$/i.test(game), `project id in the URL hash, got "${game}"`);
  await shot('20-game-board');
});

await check('game: role persists; kanban cards are keyboard-operable with a visible focus ring', async () => {
  await page.selectOption('#role', 'vendor');
  await page.reload(); await page.waitForSelector('#kanban .card');
  eq(await page.inputValue('#role'), 'vendor', 'role after reload');
  await page.locator('.brand .logo').focus();
  await tabTo(page, '#kanban .card');
  assert(await focusRing(page), 'focused card has a visible outline');
  await page.keyboard.press('ArrowDown');
  const id = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('Enter');
  await page.waitForFunction((x) => document.querySelector('#kanban .card.active')?.dataset.id === x, id);
  const name = (await gameProject()).assets.find((a) => a.id === id).asset_name;
  assert((await page.innerText('#d-title')).includes(name), 'detail pane shows the asset selected with Enter');
});

await check('game: a comment draft and an edited prompt survive a generation running to the end', async () => {
  await page.fill('#comment-text', 'needs a chunkier silhouette');
  await page.fill('#gen-prompt', 'my own prompt, still editing');
  await page.click('#comment-text'); await page.keyboard.press('End');
  const other = (await gameProject()).assets[3];
  eq((await remote('POST', `/api/game/projects/${game}/assets/${other.id}/generate?as=vendor`, { provider: 'mock' })).status, 202, 'remote generate accepted');
  await page.waitForSelector('#kanban .progress', { timeout: 12000 });
  await page.waitForFunction((n) => [...document.querySelectorAll('#kanban .col')][2].innerText.includes(n), other.asset_name, { timeout: 30000 });
  eq(await page.inputValue('#comment-text'), 'needs a chunkier silhouette', 'comment draft after the generation');
  eq(await page.evaluate(() => document.activeElement.id), 'comment-text', 'comment box keeps focus');
  eq(await page.inputValue('#gen-prompt'), 'my own prompt, still editing', 'edited prompt after the generation');
  sent.length = 0;
  await page.click('#btn-gen');
  await page.waitForSelector('#d-gen .pill.queued, #d-gen .pill.running', { timeout: 8000 });
  assert(sent.every((r) => /^application\/json/.test(r.headers['content-type'] || '')), 'generate request is JSON');
  await page.waitForSelector('#d-gen .pill.succeeded', { timeout: 30000 });
  await page.waitForSelector('#d-gen-extra a[download]');
  assert(await page.locator('#d-gen .badge-mockup').count(), 'mock generation keeps the CONCEPT MOCKUP badge');
  await shot('21-game-generated');
});

let dragged = '';
await check('game: a dragged layout item and the unsaved indicator survive a mock generation', async () => {
  await page.click('[data-tab="layout"]'); await page.waitForSelector('#layout-list [data-item]');
  eq(await firesBeforeUnload(), false, 'no beforeunload prompt while the layout is saved');
  const box = await page.locator('#layout-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 6 }); await page.mouse.up();
  dragged = await selectedItem();
  assert(/x 4 m, y 4 m/.test(dragged), `dragged item reports its new position: "${dragged}"`);
  assert(await page.locator('#layout-dirty').isVisible(), 'unsaved indicator shows after the drag');
  eq(await firesBeforeUnload(), true, 'beforeunload prompt while the layout has unsaved changes');
  const p = await gameProject(), asset = p.assets[5];
  eq((await remote('POST', `/api/game/projects/${game}/assets/${asset.id}/generate?as=vendor`, { provider: 'mock' })).status, 202, 'remote generate accepted');
  const t0 = Date.now();
  for (;;) { const a = (await gameProject()).assets.find((x) => x.id === asset.id); if (a.status === 'generated') break; assert(Date.now() - t0 < 30000, 'mock generation finishes within 30 s'); await sleep(500); }
  await page.waitForFunction(() => /synced/.test(document.querySelector('#sync').textContent)); await sleep(3200); // at least one more poll
  eq(await selectedItem(), dragged, 'dragged position after the generation finished');
  assert(await page.locator('#layout-dirty').isVisible(), 'unsaved indicator still shows');
  assert(await page.locator('#layout-conflict').isHidden(), 'no conflict notice: nobody changed the layout');
  assert(!(await gameProject()).layout.items.some((it) => it.x === 400 && it.y === 400), 'the drag has not been saved behind the user\'s back');
});

await check('game: layout keyboard: arrows nudge (Shift ×5), R rotates, modifiers and Backspace do nothing', async () => {
  await page.locator('#layout-canvas').focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); // arrive by keyboard so :focus-visible applies
  eq(await page.evaluate(() => document.activeElement.id), 'layout-canvas', 'canvas is in the Tab order');
  assert(await focusRing(page), 'canvas shows a focus ring');
  await page.keyboard.press('ArrowRight');
  assert(/x 5 m, y 4 m/.test(await selectedItem()), `ArrowRight moves one grid step: "${await selectedItem()}"`);
  await page.keyboard.press('Shift+ArrowUp');
  assert(/x 5 m, y 9 m/.test(await selectedItem()), `Shift+ArrowUp moves five steps: "${await selectedItem()}"`);
  const n = await page.locator('#layout-list [data-item]').count();
  const before = await selectedItem();
  for (const k of ['Backspace', 'Control+Delete', 'Alt+Delete', 'Control+=', 'Alt+-', 'Control+ArrowLeft']) await page.keyboard.press(k);
  eq(await page.locator('#layout-list [data-item]').count(), n, 'Backspace / modified Delete remove nothing');
  eq(await selectedItem(), before, 'modified keys change nothing');
  await page.keyboard.press('r');
  assert(/yaw 195°|yaw 15°/.test(await selectedItem()), `R rotates 15°: "${await selectedItem()}"`);
  await page.keyboard.press('Shift+R');
  eq(await selectedItem(), before, 'Shift+R rotates back');
  assert((await page.getAttribute('#layout-canvas', 'aria-label')).includes('x 5 m, y 9 m'), 'canvas aria-label describes the selection');
  assert((await page.innerText('#layout-status')).includes('Unsaved changes'), 'status line announces unsaved changes');
  await page.keyboard.press(']');
  assert((await selectedItem()) !== before, '] selects the next item');
  await page.keyboard.press('[');
  eq(await selectedItem(), before, '[ selects the previous item');
  dragged = before;
});

await check('game: a remote layout save while dirty offers Keep mine / Load theirs instead of replacing', async () => {
  const theirs = (await gameProject()).layout;
  const moved = theirs.items[theirs.items.length - 1];
  moved.x = -1500; moved.y = 1500;
  eq((await remote('PUT', `/api/game/projects/${game}/layout?as=designer`, { items: theirs.items, spawn: theirs.spawn })).status, 200, 'remote layout save');
  await page.waitForSelector('#layout-conflict:not([hidden])', { timeout: 12000 });
  eq(await selectedItem(), dragged, 'local layout is untouched while the notice shows');
  await shot('22-game-layout-conflict');
  await page.click('#btn-keep-mine');
  assert(await page.locator('#layout-conflict').isHidden(), 'notice closes after Keep mine');
  assert(await page.locator('#layout-dirty').isVisible(), 'still unsaved after Keep mine');
  sent.length = 0;
  await page.click('#btn-save-layout');
  await page.waitForFunction(() => document.querySelector('#layout-dirty').hidden);
  const put = sent.find((r) => r.method === 'PUT');
  assert(put && /^\d+$/.test(put.headers['if-match'] || ''), 'layout save is conditional (If-Match)');
  const saved = (await gameProject()).layout.items;
  assert(saved.some((it) => it.x === 500 && it.y === 900), 'my position is what got saved');
  assert(!saved.some((it) => it.x === -1500 && it.y === 1500), 'Keep mine replaced their layout on save');
  eq(await firesBeforeUnload(), false, 'no beforeunload prompt after saving');
  // second round: Load theirs
  await page.locator('#layout-canvas').focus(); await page.keyboard.press('ArrowLeft');
  assert(await page.locator('#layout-dirty').isVisible(), 'dirty again after a nudge');
  const again = (await gameProject()).layout; again.items[again.items.length - 1].x = -1700;
  await remote('PUT', `/api/game/projects/${game}/layout?as=designer`, { items: again.items, spawn: again.spawn });
  await page.waitForSelector('#layout-conflict:not([hidden])', { timeout: 12000 });
  await page.click('#btn-load-theirs');
  assert(await page.locator('#layout-dirty').isHidden(), 'clean after Load theirs');
  assert((await page.innerText('#layout-list')).includes('x -17 m'), 'their layout is showing');
  assert(/x 5 m, y 9 m/.test(await selectedItem()), 'my un-saved nudge was dropped');
});

await check('game: Place asset uses the next free grid spot, never a stack at the centre', async () => {
  const before = (await gameProject()).layout.items.length;
  await page.click('#btn-add'); await page.waitForFunction((n) => document.querySelectorAll('#layout-list [data-item]').length === n + 1, before);
  await page.click('#btn-add'); await page.waitForFunction((n) => document.querySelectorAll('#layout-list [data-item]').length === n + 2, before);
  const items = (await gameProject()).layout.items;
  eq(items.length, before + 2, 'two placements stored');
  const [a, b] = items.slice(-2);
  for (const n of [a, b]) eq(items.filter((it) => it.x === n.x && it.y === n.y).length, 1, `nothing else sits at ${n.x},${n.y}`);
  assert(!(a.x === 0 && a.y === 0) || !(b.x === 0 && b.y === 0), 'the two placements are not stacked at the centre');
  assert(a.x % 100 === 0 && a.y % 100 === 0 && b.x % 100 === 0 && b.y % 100 === 0, 'new items sit on the 1 m grid');
  assert(await page.locator('#layout-dirty').isHidden(), 'placing with a clean layout leaves nothing unsaved');
  await page.waitForFunction(() => document.querySelector('#toast').textContent === '', null, { timeout: 8000 });
  await shot('23-game-layout');
});

await check('game: import profiles and Unreal tabs; plain export links', async () => {
  await page.click('[data-tab="profiles"]'); await page.waitForSelector('#tab-profiles tbody tr');
  await page.locator('#tab-profiles tbody tr[tabindex="0"]').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  eq(await page.evaluate(() => document.activeElement.classList.contains('active')), true, 'profile row selected with Enter keeps focus');
  await shot('24-game-profiles');
  await page.click('[data-tab="unreal"]');
  await page.waitForFunction(() => document.querySelector('#plan-preview')?.textContent.includes('"schema"'));
  for (const f of ['kit.json', 'layout.json', 'import_profiles.json', 'blockout_plan.json', 'unreal.py']) eq(await page.locator(`#tab-unreal a[href$="/export/${f}"]`).count(), 1, `plain link to ${f}`);
  await shot('25-game-unreal');
});

await check('game: hostile project values are rendered as text, never as markup, class names, styles or URLs', async () => {
  const real = await gameProject();
  await remote('POST', `/api/game/projects/${game}/assets/${real.assets[1].id}/comments?as=${encodeURIComponent(HOSTILE)}`, { text: HOSTILE2 });
  await remote('PATCH', `/api/game/projects/${game}/assets/${real.assets[1].id}?as=${encodeURIComponent(HOSTILE)}`, { assignee: HOSTILE, category: HOSTILE, name: HOSTILE2 });
  const evil = JSON.parse(JSON.stringify(await gameProject()));
  evil.rev += 1000;
  Object.assign(evil, { title: HOSTILE, genre: HOSTILE, camera: HOSTILE2, style: HOSTILE, engine: HOSTILE, roles: [HOSTILE, 'designer'] });
  evil.summary = { by_category: { [HOSTILE]: HOSTILE, 'red;background:url(javascript:window.__xss=1)': 3, constructor: 2 }, lod0_triangles_total: HOSTILE, total: HOSTILE };
  evil.activity = [{ at: HOSTILE, who: HOSTILE, what: HOSTILE2 }, 7, ...evil.activity];
  evil.assets.forEach((a, i) => {
    if (i % 2) return;
    Object.assign(a, { status: i === 0 ? HOSTILE : 'generating', category: i === 0 ? HOSTILE : 'constructor', asset_name: i === 0 ? HOSTILE : a.asset_name, name: HOSTILE, assignee: HOSTILE, source: HOSTILE2, import_profile: HOSTILE,
      budget: i === 0 ? HOSTILE : { up_axis: HOSTILE, height_cm: HOSTILE, lods_triangles: [HOSTILE, 5], texel_density_px_per_cm: HOSTILE, texture_px: HOSTILE, rig: HOSTILE2 },
      generation: { task_id: HOSTILE, provider: HOSTILE, status: HOSTILE, progress: '50%;background:url(javascript:window.__xss=1)', prompt: HOSTILE, error: HOSTILE2, concept_mockup: true, outputs: [{ type: 'model', format: HOSTILE, url: JS_URL }, 'junk'] },
      comments: [{ who: HOSTILE, at: HOSTILE, text: HOSTILE2 }, null] });
  });
  evil.assets.push(null, 'junk');
  evil.layout.items.forEach((it, i) => { if (i % 2 === 0) Object.assign(it, { asset_name: HOSTILE, category: HOSTILE, x: i === 0 ? HOSTILE : it.x, footprint_cm: i === 0 ? HOSTILE : it.footprint_cm, scale: HOSTILE, yaw: HOSTILE }); });
  evil.layout.items.push('junk'); evil.layout.spawn = HOSTILE;
  await page.route('**/api/game/projects/*/generations*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project: evil }) }));
  await page.click('[data-tab="board"]');
  await page.waitForFunction((h) => document.querySelector('#kit-summary h2')?.textContent === h, HOSTILE, { timeout: 12000 });
  for (const tab of ['board', 'layout', 'profiles', 'unreal']) {
    await page.click(`[data-tab="${tab}"]`); await sleep(150);
    await assertClean(page, `game ${tab} tab`, '^$');
  }
  await page.click('[data-tab="board"]');
  eq(await page.locator('#kanban .card').count(), real.assets.length, 'every real asset still has a card (unknown status goes to the first column)');
  for (const i of [0, 1, 2]) { await page.locator('#kanban .card').nth(i).click(); await sleep(100); await assertClean(page, `game detail pane, card ${i}`, '^$'); }
  const styles = await page.evaluate(() => [...document.querySelectorAll('#kit-summary [style], #kanban [style], #detail [style], #layout-list [style], #tab-profiles [style]')].map((e) => e.getAttribute('style')));
  assert(styles.every((s) => /^(background:#[0-9a-f]{6}|color:#[0-9a-f]{6}|width:\d{1,3}%)$/.test(s)), `style attributes only hold whitelisted values: ${styles.filter((s) => !/^(background|color):#|^width:\d/.test(s)).slice(0, 3).join(' | ')}`);
  eq(await page.evaluate(() => [...document.querySelectorAll('#detail a[href]')].every((a) => /^https?:$/.test(a.protocol))), true, 'links in the detail pane are http(s) only');
  await shot('26-game-hostile-values-as-text');
  await page.unroute('**/api/game/projects/*/generations*');
  await page.waitForFunction((h) => document.querySelector('#kit-summary h2')?.textContent !== h, HOSTILE, { timeout: 12000 });
  await assertClean(page, 'game after recovery (API-injected values)', '^$');
});

await check('game: polling shows offline and recovers by itself', async () => {
  await page.route('**/api/game/projects/*/generations*', (route) => route.abort());
  await page.waitForFunction(() => document.querySelector('#sync').textContent.startsWith('offline'), null, { timeout: 8000 });
  await page.unroute('**/api/game/projects/*/generations*');
  await page.waitForFunction(() => document.querySelector('#sync').textContent === 'synced', null, { timeout: 16000 });
}, { expectErrors: [/Failed to load resource/] });

await check('game: a project can be deleted from the list after a confirm step', async () => {
  const extra = (await remote('POST', '/api/game/projects', { text: 'Title: Delete me too\nGenre: test\nProps: crate, barrel\n' })).json.project;
  const row = page.locator('#projects .proj-row', { hasText: 'Delete me too' });
  await row.waitFor({ timeout: 25000 });
  await row.locator('.icon-btn').click();
  await page.click('#projects [data-act="delete-yes"]');
  await page.waitForFunction(() => !document.querySelector('#projects').innerText.includes('Delete me too'));
  eq((await remote('GET', `/api/game/projects/${extra.id}`)).status, 404, 'project is gone on the server');
  assert(await page.locator('#kanban .card').count(), 'the open project is still showing');
});

// ============================================================ phone width =============================================
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage(); watch(phone, 'phone');
await check('phone 390×844: no horizontal page scroll on /, /film/ and /game/ with a project open', async () => {
  await phone.goto(`${BASE}/`); await phone.waitForSelector('.landing a.card'); await noOverflow(phone, 'landing'); await shot('30-phone-landing', phone);
  await phone.goto(`${BASE}/film/#${film}`); await phone.waitForSelector('#shot-table tbody tr');
  for (const tab of ['shots', 'board', 'animatic', 'unreal']) {
    await phone.tap(`[data-tab="${tab}"]`); await sleep(250);
    await noOverflow(phone, `film ${tab} tab`);
    if (tab === 'shots') await shot('31-phone-film-shots', phone);
    if (tab === 'board') { await phone.locator('#board').scrollIntoViewIfNeeded(); await shot('32-phone-film-storyboard', phone); }
  }
  await phone.locator('#detail').scrollIntoViewIfNeeded(); await noOverflow(phone, 'film detail pane'); await shot('33-phone-film-detail', phone);
  await phone.goto(`${BASE}/game/#${game}`); await phone.waitForSelector('#kanban .card');
  for (const tab of ['board', 'layout', 'profiles', 'unreal']) {
    await phone.tap(`[data-tab="${tab}"]`); await sleep(250);
    await noOverflow(phone, `game ${tab} tab`);
    if (tab === 'board') { await phone.locator('#kanban').scrollIntoViewIfNeeded(); await shot('34-phone-game-board', phone); }
    if (tab === 'layout') { await phone.locator('#layout-canvas').scrollIntoViewIfNeeded(); await shot('35-phone-game-layout', phone); }
  }
  const stacked = await phone.evaluate(() => { const [a, m, d] = ['.pane', '.main', '#detail'].map((s) => document.querySelector(s).getBoundingClientRect()); return a.bottom <= m.top + 1 && m.bottom <= d.top + 1 && Math.round(m.width) === window.innerWidth; });
  assert(stacked, 'panes stack vertically at phone width');
  // touch drag on the layout canvas works and marks the layout unsaved
  await phone.tap('[data-tab="layout"]'); await phone.locator('#layout-canvas').scrollIntoViewIfNeeded();
  const item = (await (await fetch(`${BASE}/api/game/projects/${game}`)).json()).project.layout.items[0];
  const box = await phone.locator('#layout-canvas').boundingBox();
  const at = (cmX, cmY) => [box.x + (cmX / 4000 + 0.5) * box.width, box.y + (-cmY / 4000 + 0.5) * box.height];
  const cdp = await phoneCtx.newCDPSession(phone);
  const [x0, y0] = at(item.x, item.y), [x1, y1] = at(item.x + 300, item.y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 4; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 4, y: y0 + ((y1 - y0) * i) / 4 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(await phone.locator('#layout-dirty').isVisible(), 'touch drag marks the layout unsaved');
  await noOverflow(phone, 'game layout after a touch drag');
  await phone.tap('#btn-revert-layout');
  assert(await phone.locator('#layout-dirty').isHidden(), 'Discard clears the unsaved state');
});

await browser.close();

// ---- report -----------------------------------------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${errors.length} unexpected browser error(s), ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} screenshots in ${OUT}`);
for (const n of notes) console.log(`note: ${n}`);
if (dialogs.length) console.log(`note: dialogs seen: ${dialogs.join(', ')}`);
if (errors.length) console.error(`\nUnexpected browser errors:\n  ${errors.join('\n  ')}`);
if (failed.length) console.error(`\nFailed checks:\n  ${failed.map((f) => `${f.name}: ${f.error}`).join('\n  ')}`);
process.exit(failed.length || errors.length ? 1 : 0);
