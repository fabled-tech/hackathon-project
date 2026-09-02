/**
 * Headed Matrix walkthrough for local demo rehearsal.
 * Usage (API + web already on :8000 / :3000):
 *   node scripts/show-walkthrough.cjs
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.RIGHTSRADAR_WEB_URL ?? 'http://127.0.0.1:3000';
const ANALYZE_TIMEOUT_MS = Number(process.env.RIGHTSRADAR_ANALYZE_TIMEOUT_MS ?? 720_000);
const HOLD_MS = Number(process.env.RIGHTSRADAR_WALKTHROUGH_HOLD_MS ?? 120_000);

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
  await context.addInitScript(() => {
    localStorage.removeItem('rightsrader.demo.choice');
    localStorage.removeItem('rightsrader.demo.lastScriptId');
    localStorage.removeItem('rightsrader.demo.usedScriptIds');
    localStorage.removeItem('rightsrader.activeMemberId');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ANALYZE_TIMEOUT_MS);

  console.log(`Opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-gate').waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(1200);

  console.log(`Walk The Matrix homage (analyze timeout ${ANALYZE_TIMEOUT_MS}ms)`);
  await page.getByTestId('demo-walkthrough').click();
  await page.getByTestId('walkthrough-status').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.getByTestId('demo-coach').waitFor({ state: 'visible', timeout: ANALYZE_TIMEOUT_MS });
  await page.getByTestId('agent-pipeline').waitFor({ state: 'visible' });
  console.log('Stage READY — script filed');
  await page.waitForTimeout(2500);

  const labels = ['Intake', 'Research', 'Curation', 'Adjudication', 'Your turn'];
  for (const label of labels) {
    console.log(`Run next stage → ${label}`);
    await page.getByTestId('demo-coach-next').click();
    await page.waitForTimeout(2800);
  }

  console.log(`Done. Browser stays open for ${HOLD_MS}ms — explore or press Ctrl+C in the terminal.`);
  await page.waitForTimeout(HOLD_MS);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
