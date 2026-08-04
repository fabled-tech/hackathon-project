import { expect, test } from '@playwright/test';

test('production workspace shows source inventory, monitoring summary, and audit history', async ({
  page
}) => {
  await page.goto('/');
  await page.getByLabel('Production name').fill('Summer feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();

  await expect(page.getByRole('heading', { name: 'Monitoring summary' })).toBeVisible();
  await expect(page.getByText('1 script')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recheck all sources' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();
});

test('keeps a production selected after unchanged monitoring, restores older runs, and records review activity', async ({
  page
}) => {
  await page.goto('/');
  await page.getByLabel('Production name').fill('Run history feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await expect(page.getByText('Initial monitoring')).toBeVisible();

  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await expect(page.getByText('No source changes need monitoring right now.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recheck all sources' })).toBeVisible();
  await expect(page.getByLabel('Selected production').locator('option:checked')).toHaveText(
    'Run history feature'
  );

  await page.getByRole('button', { name: 'Recheck all sources' }).click();
  const latestFinding = page.getByTestId('production-finding').first();
  await latestFinding.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('region', { name: 'Audit timeline' })).toContainText('Dismissed');

  await page.getByTestId('run-list').getByRole('button').last().click();
  await expect(page.getByRole('heading', { name: 'Research leads' })).toBeVisible();
  await expect(page.getByTestId('production-finding')).toHaveCount(1);
});

test('renders asset inventory metadata without private implementation fields', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Production name').fill('Asset feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();

  const inventory = page.getByTestId('source-inventory');
  await expect(inventory).toContainText('production-note.txt');
  await expect(inventory).toContainText('text/plain');
  await expect(inventory).toContainText(/updated/i);
  await expect(inventory).not.toContainText(/fingerprint|storage|asset_id|private note/i);
});

test('uses horizontal panes on desktop and stacks the workspace below 760px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const sourcePane = page.getByTestId('source-workspace');
  const monitoringPane = page.getByTestId('monitoring-workspace');
  const desktopSourceBox = await sourcePane.boundingBox();
  const desktopMonitoringBox = await monitoringPane.boundingBox();
  expect(desktopSourceBox).not.toBeNull();
  expect(desktopMonitoringBox).not.toBeNull();
  expect(desktopMonitoringBox!.x).toBeGreaterThan(desktopSourceBox!.x);

  await page.setViewportSize({ width: 600, height: 900 });
  const narrowSourceBox = await sourcePane.boundingBox();
  const narrowMonitoringBox = await monitoringPane.boundingBox();
  expect(narrowSourceBox).not.toBeNull();
  expect(narrowMonitoringBox).not.toBeNull();
  expect(narrowMonitoringBox!.y).toBeGreaterThan(narrowSourceBox!.y);
});
