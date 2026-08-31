import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('rightsrader.demo.choice');
    window.localStorage.removeItem('rightsrader.demo.lastScriptId');
    window.localStorage.removeItem('rightsrader.demo.usedScriptIds');
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

test('choosing walkthrough lands on the case desk', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('demo-walkthrough').click();
  await expect(page.getByTestId('case-desk')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('demo-gate')).toHaveCount(0);
  await expect(page.getByTestId('demo-control')).toBeVisible();
  await expect(page.getByTestId('finding-card').filter({ hasText: 'The Matrix' })).toBeVisible();
  await expect(
    page.getByTestId('finding-card').filter({ hasText: 'There is no spoon' })
  ).toBeVisible();
  await expect(page.getByTestId('tool-call-chip').filter({ hasText: 'plan_queries' })).toHaveCount(2);
  await expect(page.getByText('example.com').first()).toBeVisible();
  await expect(page.getByTestId('demo-coach-overlay')).toBeVisible();
  await expect(page.getByTestId('demo-coach-spotlight')).toBeVisible();
  await expect(page.getByTestId('demo-coach')).toContainText('STEP 1 / 5');
  await expect(page.getByTestId('demo-coach')).toContainText('Who sits on this file');
  await expect(page.getByTestId('agent-avatar').first()).toBeVisible();
  await expect(page.getByTestId('human-avatar').first()).toBeVisible();
  await page.getByTestId('demo-coach-next').click();
  await expect(page.getByTestId('demo-coach')).toContainText('STEP 2 / 5');
});
