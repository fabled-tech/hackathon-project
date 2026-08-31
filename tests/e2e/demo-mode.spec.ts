import { expect, test } from '@playwright/test';
import { DEMO_PRODUCTION_TITLE } from '../../apps/web/lib/demo-mode';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('rightsrader.demo.choice');
    window.localStorage.removeItem('rightsrader.demo.lastScriptId');
    window.localStorage.removeItem('rightsrader.demo.usedScriptIds');
    window.localStorage.removeItem('rightsrader.activeMemberId');
  });
});

test('opening the app shows the demo gate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-gate')).toBeVisible();
  await expect(page.getByTestId('demo-walkthrough')).toBeVisible();
  await expect(page.getByTestId('demo-self-serve')).toBeVisible();
});

test('choosing self-serve hides the demo gate', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-self-serve').click();
  await expect(page.getByTestId('demo-gate')).toHaveCount(0);
  await expect(page.getByText('PRODUCTION RIGHTS WORKSPACE')).toBeVisible();
  await expect(page.getByTestId('demo-control')).toBeVisible();
});

test('production overview shows user Inbox instead of nested findings', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('demo-self-serve').click();

  const demoProduction = page
    .getByRole('button', { name: new RegExp(DEMO_PRODUCTION_TITLE) })
    .first();
  if ((await demoProduction.count()) > 0) {
    await demoProduction.click();
  } else {
    await page.getByLabel('New production').click();
    await page.getByPlaceholder('Production title').fill(DEMO_PRODUCTION_TITLE);
    await page.getByPlaceholder('Studio (optional)').fill('RightsRadar Demo Unit');
    await page.getByRole('button', { name: 'Create' }).click();
  }

  await expect(page.getByTestId('user-inbox')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
  await expect(page.getByTestId('production-case-details')).toHaveCount(0);
});

test('walkthrough reveals pipeline stages on each Next press', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('demo-walkthrough').click();

  await expect(page.getByTestId('user-input-section')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('demo-gate')).toHaveCount(0);
  await expect(page.getByTestId('demo-coach-overlay')).toBeVisible();
  await expect(page.getByTestId('agent-pipeline')).toHaveAttribute('data-reveal-stage', 'ready');
  await expect(page.getByTestId('agent-pipeline')).toContainText('READY');
  await expect(page.getByTestId('finding-card')).toHaveCount(0);
  await expect(page.getByTestId('demo-coach')).toContainText('STEP 1 / 5');
  await expect(page.getByTestId('demo-coach')).toContainText('Matrix script is filed');

  await page.getByTestId('demo-coach-next').click();
  await expect(page.getByTestId('demo-coach')).toContainText('STEP 2 / 5');
  await expect(page.getByTestId('agent-pipeline')).toHaveAttribute('data-reveal-stage', 'intake');
  await expect(page.getByTestId('case-desk')).toBeVisible();
  await expect(page.getByText('Detected').first()).toBeVisible();
  await expect(page.getByTestId('finding-card')).toHaveCount(0);

  await page.getByTestId('demo-coach-next').click();
  await expect(page.getByTestId('agent-pipeline')).toHaveAttribute('data-reveal-stage', 'research');
  await expect(page.getByTestId('tool-call-chip').filter({ hasText: 'plan_queries' }).first()).toBeVisible();

  await page.getByTestId('demo-coach-next').click();
  await expect(page.getByTestId('agent-pipeline')).toHaveAttribute('data-reveal-stage', 'curation');
  await expect(page.getByTestId('finding-card').filter({ hasText: 'The Matrix' })).toBeVisible();
  await expect(
    page.getByTestId('finding-card').filter({ hasText: 'There is no spoon' })
  ).toBeVisible();

  await page.getByTestId('demo-coach-next').click();
  await expect(page.getByTestId('agent-pipeline')).toHaveAttribute('data-reveal-stage', 'human');
  await expect(page.getByTestId('demo-coach')).toContainText('Your turn');
  await expect(page.getByTestId('human-avatar').first()).toBeVisible();
});
