import { expect, test, type Page } from '@playwright/test';

async function openProductionMonitor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Production Monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Monitoring summary' })).toBeVisible();
}

test('production workspace shows source inventory, monitoring summary, and audit history', async ({
  page
}) => {
  await openProductionMonitor(page);
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
  await openProductionMonitor(page);
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
  const auditTimeline = page.getByRole('region', { name: 'Audit timeline' });
  await expect(auditTimeline).toContainText('Dismissed');
  await expect(auditTimeline).toContainText(/Run \S+ · finding \S+/);

  await page.getByTestId('run-list').getByRole('button').last().click();
  await expect(page.getByRole('heading', { name: 'Research leads' })).toBeVisible();
  await expect(page.getByTestId('production-finding')).toContainText('Pending');
  await expect(page.getByTestId('monitoring-workspace')).toContainText('Dismissed');
});

test('distinguishes a stale production revision from an unchanged monitor request', async ({
  page
}) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Revision race feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.route('**/api/productions/*/runs', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'The production changed while monitoring. Review the latest sources and try again.'
      })
    });
  });

  await page.getByRole('button', { name: 'Monitor changes' }).click();

  await expect(page.getByTestId('production-error')).toContainText(
    'The production changed while monitoring. Refresh the production and try again.'
  );
  await expect(page.getByText('No source changes need monitoring right now.')).toHaveCount(0);
});

test('discloses alternative evidence when no primary source was selected', async ({ page }) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Alternative evidence feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.route('**/api/productions/*/runs/*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const finding = body.findings?.[0];
    if (finding) {
      finding.evidence = {
        primary: null,
        rationale: null,
        alternatives: [
          {
            excerpt: 'A traceable alternative research excerpt.',
            source: {
              title: 'Alternative research source',
              url: 'https://example.test/alternative'
            }
          }
        ]
      };
    }
    await route.fulfill({ response, json: body });
  });

  await page.getByRole('button', { name: 'Monitor changes' }).click();

  const finding = page.getByTestId('production-finding');
  await expect(finding).toContainText(
    'No primary source was selected. The alternative evidence below is additional research material for human review.'
  );
  await expect(finding.getByRole('link', { name: 'Alternative research source' })).toBeVisible();
  await expect(finding).not.toContainText('No supporting source is available');
});

test('renders asset inventory metadata without private implementation fields', async ({ page }) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Asset feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();

  const inventory = page.getByTestId('source-inventory');
  await expect(inventory).toContainText('production-note.txt');
  await expect(inventory).toContainText('text/plain');
  await expect(inventory).toContainText(/updated/i);
  await expect(inventory).not.toContainText(
    'Production note: Nimbus Soda can appears as fictional set dressing in scene 12.'
  );
  await expect(inventory).not.toContainText(/fingerprint|storage|asset_id|private_asset_id/i);
});

test('keeps the newer production selected when a delayed production response arrives late', async ({
  page
}) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Older production');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Production name').fill('Newer production');
  await page.getByRole('button', { name: 'Create production' }).click();

  const picker = page.getByLabel('Selected production');
  const olderId = await picker.locator('option', { hasText: 'Older production' }).getAttribute('value');
  let releaseOlderResponse: (() => void) | undefined;
  let signalOlderRequest: (() => void) | undefined;
  const olderRequest = new Promise<void>((resolve) => {
    signalOlderRequest = resolve;
  });
  await page.route(`**/api/productions/${olderId}`, async (route) => {
    signalOlderRequest?.();
    await new Promise<void>((resolve) => {
      releaseOlderResponse = resolve;
    });
    await route.continue();
  });

  await picker.selectOption({ label: 'Older production' });
  await olderRequest;
  await picker.selectOption({ label: 'Newer production' });
  releaseOlderResponse?.();

  await expect(picker.locator('option:checked')).toHaveText('Newer production');
  await page.unroute(`**/api/productions/${olderId}`);
});

test('shows changed sources and a retired source in its next run snapshot', async ({ page }) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Source lifecycle feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.getByLabel('Plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();

  const inventory = page.getByTestId('source-inventory');
  const scriptCard = inventory.locator('article').filter({ hasText: 'Opening scene' });
  await scriptCard.getByRole('button', { name: 'Edit script' }).click();
  await page.getByLabel('Script text').fill('Nimbus Soda appears again.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await expect(scriptCard).toContainText('Changed');
  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await expect(page.getByTestId('run-list').getByRole('button').first()).toContainText(
    '1 changed source'
  );

  await scriptCard.getByRole('button', { name: 'Retire source' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await expect(page.getByLabel('Selected run source snapshot')).toContainText('Opening scene');
  await expect(page.getByLabel('Selected run source snapshot')).toContainText('Retired');
});

test('ignores a delayed older-run response after a newer run is selected', async ({ page }) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Run race feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await page.getByRole('button', { name: 'Recheck all sources' }).click();

  let holdFirstRun = true;
  let releaseOlderRun: (() => void) | undefined;
  let signalOlderRun: (() => void) | undefined;
  const olderRunStarted = new Promise<void>((resolve) => { signalOlderRun = resolve; });
  await page.route('**/api/productions/*/runs/*', async (route) => {
    if (!holdFirstRun) return route.continue();
    holdFirstRun = false;
    signalOlderRun?.();
    await new Promise<void>((resolve) => { releaseOlderRun = resolve; });
    await route.continue();
  });
  const runs = page.getByTestId('run-list').getByRole('button');
  await runs.last().click();
  await olderRunStarted;
  await runs.first().click();
  await expect(runs.first()).toHaveClass(/selected-run/);
  releaseOlderRun?.();
  await expect(runs.first()).toHaveClass(/selected-run/);
});

test('ignores a delayed review response after a different run is selected', async ({ page }) => {
  await openProductionMonitor(page);
  await page.getByLabel('Production name').fill('Review race feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await page.getByRole('button', { name: 'Recheck all sources' }).click();

  let releaseReview: (() => void) | undefined;
  let signalReview: (() => void) | undefined;
  const reviewStarted = new Promise<void>((resolve) => { signalReview = resolve; });
  await page.route('**/api/productions/*/runs/*/findings/*', async (route) => {
    signalReview?.();
    await new Promise<void>((resolve) => { releaseReview = resolve; });
    await route.continue();
  });
  await page.getByTestId('production-finding').getByRole('button', { name: 'Dismiss' }).click();
  await reviewStarted;
  await page.getByTestId('run-list').getByRole('button').last().click();
  await expect(page.getByTestId('production-finding')).toContainText('Pending');
  const auditTimeline = page.getByRole('region', { name: 'Audit timeline' });
  await expect(auditTimeline).toContainText('No review updates have been recorded yet.');
  releaseReview?.();
  await expect(page.getByTestId('production-finding')).toContainText('Pending');
  await expect(auditTimeline).toContainText('No review updates have been recorded yet.');
});

test('uses horizontal panes on desktop and stacks the workspace below 760px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openProductionMonitor(page);
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
