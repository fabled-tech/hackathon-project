import { expect, test, type Page } from '@playwright/test';

async function openProductionMonitor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Production Monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Monitoring summary' })).toBeVisible();
}

test('keeps the visible case usable after reopening another case fails', async ({ page }) => {
  const visibleScript = 'Failure guard visible case: Nimbus Soda remains on the prop table.';
  const failedScript = 'Failure guard target case: a quiet scene plays in silence.';

  await page.goto('/');
  await page.getByLabel('Script text').fill(visibleScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await page.getByLabel('Script text').fill(failedScript);
  const failedCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const failedCase = await (await failedCaseResponse).json();

  await page.getByRole('button', { name: 'Refresh recent cases' }).click();
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(visibleScript) }).click();
  await expect(page.getByLabel('Script text')).toHaveValue(visibleScript);

  await page.route(`**/api/cases/${failedCase.id}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'forced reopen failure' })
    });
  });
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(failedScript) }).click();
  await expect(page.getByText('This case could not be reopened. Please try again.')).toBeVisible();
  await expect(page.getByLabel('Script text')).toHaveValue(visibleScript);

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await page.unroute(`**/api/cases/${failedCase.id}`);
});

test('ignores stale asset uploads after a newer case is selected', async ({ page }) => {
  const olderScript = 'Stale upload older case: Nimbus Soda remains on the prop table.';
  const newerScript = 'Stale upload newer case: a quiet scene plays in silence.';

  await page.goto('/');
  await page.getByLabel('Script text').fill(olderScript);
  const olderCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const olderCase = await (await olderCaseResponse).json();

  await page.getByLabel('Script text').fill(newerScript);
  const newerCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const newerCase = await (await newerCaseResponse).json();

  await page.getByRole('button', { name: 'Refresh recent cases' }).click();
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(olderScript) }).click();
  await expect(page.getByLabel('Script text')).toHaveValue(olderScript);

  let releaseOlderAssetsResponse: (() => void) | undefined;
  let signalOlderAssetsRequestStarted: (() => void) | undefined;
  const olderAssetsRequestStarted = new Promise<void>((resolve) => {
    signalOlderAssetsRequestStarted = resolve;
  });
  await page.route(`**/api/cases/${olderCase.id}/assets`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    signalOlderAssetsRequestStarted?.();
    await new Promise<void>((release) => {
      releaseOlderAssetsResponse = release;
    });
    await route.continue();
  });

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await olderAssetsRequestStarted;
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(newerScript) }).click();
  await expect(page.getByLabel('Script text')).toHaveValue(newerScript);

  const staleAssetsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/cases/${olderCase.id}/assets`) &&
      response.request().method() === 'GET'
  );
  releaseOlderAssetsResponse?.();
  await staleAssetsResponse;
  await expect(page.getByTestId('asset-list')).not.toContainText('production-note.txt');
  await expect(page.getByTestId('finding-card')).toHaveCount(0);
  await expect(page.getByLabel('Script text')).toHaveValue(newerScript);

  await page.unroute(`**/api/cases/${olderCase.id}/assets`);
  expect(newerCase.id).not.toBe(olderCase.id);
});

test('ignores stale case reopen responses after a newer case is selected', async ({ page }) => {
  const olderScript = 'The Nimbus Soda can remains on the prop table.';
  const newerScript = 'A quiet scene without any fictional references plays in silence.';

  await page.goto('/');
  await page.getByLabel('Script text').fill(olderScript);
  const olderCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const olderCase = await (await olderCaseResponse).json();

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await page.getByLabel('Script text').fill(newerScript);
  const newerCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const newerCase = await (await newerCaseResponse).json();

  await page.getByRole('button', { name: 'Refresh recent cases' }).click();
  await expect(page.getByTestId('recent-cases')).toContainText(olderScript);

  let releaseOlderCaseResponse: (() => void) | undefined;
  let signalOlderCaseRequestStarted: (() => void) | undefined;
  const olderCaseRequestStarted = new Promise<void>((resolve) => {
    signalOlderCaseRequestStarted = resolve;
  });
  await page.route(`**/api/cases/${olderCase.id}`, async (route) => {
    signalOlderCaseRequestStarted?.();
    await new Promise<void>((release) => {
      releaseOlderCaseResponse = release;
    });
    await route.continue();
  });

  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(olderScript) }).click();
  await olderCaseRequestStarted;
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(newerScript) }).click();
  await expect(page.getByLabel('Script text')).toHaveValue(newerScript);

  const staleAssetsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/cases/${olderCase.id}/assets`) &&
      response.request().method() === 'GET'
  );
  releaseOlderCaseResponse?.();
  await staleAssetsResponse;

  await expect(page.getByLabel('Script text')).toHaveValue(newerScript);
  await expect(page.getByTestId('finding-card')).toHaveCount(0);
  await expect(page.getByTestId('asset-list')).not.toContainText('production-note.txt');
  await expect(page.getByTestId('asset-list')).toContainText(
    'No plain-text production notes are attached yet.'
  );

  await page.unroute(`**/api/cases/${olderCase.id}`);
  expect(newerCase.id).not.toBe(olderCase.id);
});

test('uploads a text asset and reopens it from recent cases', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Script text').fill('Nimbus Soda appears in a shot.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
  await expect(page.getByTestId('asset-list')).toContainText('text/plain');

  await page.getByRole('button', { name: 'Refresh recent cases' }).click();
  await page.getByTestId('recent-cases').getByRole('button').first().click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
  await expect(page.getByTestId('asset-list')).toContainText('text/plain');
});

test('reopens a different case with its script, reviewer status, and assets', async ({ page }) => {
  const originalScript = 'Scene 47: Nimbus Soda appears beside a painted blue kettle.';
  const newerScript = 'A different scene contains no fictional brand references.';

  await page.goto('/');
  await page.getByLabel('Script text').fill(originalScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const originalFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await originalFinding.getByRole('button', { name: 'Dismiss' }).click();
  await expect(originalFinding).toContainText('Dismissed');

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await page.getByLabel('Script text').fill(newerScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.getByLabel('Script text')).toHaveValue(newerScript);

  await page.getByRole('button', { name: 'Refresh recent cases' }).click();
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(originalScript) })
    .click();

  await expect(page.getByLabel('Script text')).toHaveValue(originalScript);
  await expect(page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' })).toContainText(
    'Dismissed'
  );
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
});

test('frames cited character leads as research assistance', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Potential research leads')).toBeVisible();
  await expect(page.getByText(/characters, franchises, and likenesses/i)).toBeVisible();
  await expect(page.getByLabel('Legal disclaimer')).toContainText('Research assistance only.');

  await page.getByLabel('Script text').fill('Captain Aurelia enters the archive.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const characterFinding = page.getByTestId('finding-card').filter({ hasText: 'Captain Aurelia' });
  await expect(characterFinding).toContainText('character reference');
  await expect(characterFinding).toContainText('character reference archive');
  await expect(characterFinding).toContainText('research');
});

test('submits a script and lets the reviewer dismiss a finding', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Script text').fill(
    'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const brandFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await expect(brandFinding).toContainText('brand reference archive');
  await expect(brandFinding).toContainText('Pending');

  await brandFinding.getByRole('button', { name: 'Dismiss' }).click();
  await expect(brandFinding).toContainText('Dismissed');
});
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
