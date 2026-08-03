import { expect, test } from '@playwright/test';

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

  await page.getByRole('button', { name: 'Past cases' }).click();
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(visibleScript) })
    .first()
    .click();
  await expect(page.getByLabel('Script text')).toHaveValue(visibleScript);

  await page.route(`**/api/cases/${failedCase.id}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'forced reopen failure' })
    });
  });
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(failedScript) })
    .first()
    .click();
  await expect(page.getByText('This case could not be reopened. Please try again.')).toBeVisible();
  await expect(page.getByLabel('Script text')).toHaveValue(visibleScript);
  await page.keyboard.press('Escape');

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

  await page.getByRole('button', { name: 'Past cases' }).click();
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(olderScript) })
    .first()
    .click();
  await expect(page.getByLabel('Script text')).toHaveValue(olderScript);
  await page.keyboard.press('Escape');

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
  await page.getByRole('button', { name: 'Past cases' }).click();
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(newerScript) })
    .first()
    .click();
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

  await page.getByRole('button', { name: 'Past cases' }).click();
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

  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(olderScript) })
    .first()
    .click();
  await olderCaseRequestStarted;
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(newerScript) })
    .first()
    .click();
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

  await page.getByRole('button', { name: 'Past cases' }).click();
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

  await page.getByRole('button', { name: 'Past cases' }).click();
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(originalScript) })
    .first()
    .click();

  await expect(page.getByLabel('Script text')).toHaveValue(originalScript);
  await expect(page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' })).toContainText(
    'Dismissed'
  );
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
});

test('submits a script and lets the reviewer dismiss a finding', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Script text').fill(
    'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(page.getByTestId('focused-workspace')).toBeVisible();
  await expect(page.getByTestId('review-queue')).toBeVisible();
  const brandFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await expect(brandFinding.getByTestId('evidence-primary')).toContainText(
    'Nimbus Soda brand reference archive'
  );
  await expect(brandFinding).toContainText('brand reference archive');
  await expect(brandFinding).toContainText('Pending');

  await brandFinding.getByRole('button', { name: 'Dismiss' }).click();
  await expect(brandFinding).toContainText('Dismissed');
});

test('keeps alternative citations hidden until the reviewer asks for more evidence', async ({ page }) => {
  await page.route('**/api/cases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'alternative-evidence-case',
        script_text: 'A reference needs evidence review.',
        created_at: '2026-08-02T00:00:00Z',
        findings: [
          {
            id: 'alternative-evidence-finding',
            case_id: 'alternative-evidence-case',
            category: 'brand_reference',
            detected_item: 'Example Brand',
            explanation: 'The reviewer should assess this research lead.',
            confidence: 0.75,
            supporting_evidence: [
              {
                excerpt: 'Primary research excerpt.',
                source: { title: 'Official source', url: 'https://source.test/official' }
              },
              {
                excerpt: 'Alternative research excerpt.',
                source: { title: 'Alternative source', url: 'https://source.test/alternative' }
              }
            ],
            source_urls: ['https://source.test/official', 'https://source.test/alternative'],
            retrieved_at: '2026-08-02T00:00:00Z',
            reviewer_status: 'pending',
            evidence: {
              primary: {
                excerpt: 'Primary research excerpt.',
                source: { title: 'Official source', url: 'https://source.test/official' }
              },
              rationale: 'The official source directly addresses the referenced item.',
              alternatives: [
                {
                  excerpt: 'Alternative research excerpt.',
                  source: { title: 'Alternative source', url: 'https://source.test/alternative' }
                }
              ]
            }
          }
        ]
      })
    });
  });

  await page.goto('/');
  await page.getByLabel('Script text').fill('A reference needs evidence review.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const finding = page.getByTestId('finding-card');
  await expect(finding.getByTestId('evidence-primary')).toContainText('Official source');
  await expect(finding.getByTestId('evidence-alternatives')).toBeHidden();
  await finding.getByRole('button', { name: 'More evidence' }).click();
  await expect(finding.getByTestId('evidence-alternatives')).toContainText('Alternative source');
});

test('renders a neutral no-source finding without hiding the review actions', async ({ page }) => {
  await page.route('**/api/cases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'no-source-case',
        script_text: 'A reference needs human follow-up.',
        created_at: '2026-08-02T00:00:00Z',
        findings: [
          {
            id: 'no-source-finding',
            case_id: 'no-source-case',
            category: 'brand_reference',
            detected_item: 'Unverified reference',
            explanation: 'The reference needs a reviewer to decide next steps.',
            confidence: 0.5,
            supporting_evidence: [],
            source_urls: [],
            retrieved_at: '2026-08-02T00:00:00Z',
            reviewer_status: 'pending',
            evidence: { primary: null, rationale: null, alternatives: [] }
          }
        ]
      })
    });
  });

  await page.goto('/');
  await page.getByLabel('Script text').fill('A reference needs human follow-up.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(page.getByTestId('no-source-state')).toBeVisible();
  await expect(page.getByTestId('finding-card').getByRole('button', { name: 'Dismiss' })).toBeEnabled();
});

test('opens and closes the newest-first Past cases drawer with the keyboard', async ({ page }) => {
  const olderScript = 'Older chronological case.';
  const newerScript = 'Newer chronological case.';

  await page.goto('/');
  await page.getByLabel('Script text').fill(olderScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await page.getByLabel('Script text').fill(newerScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await page.getByRole('button', { name: 'Past cases' }).click();
  const drawer = page.getByTestId('past-cases');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('recent-cases').getByRole('button').first()).toContainText(
    newerScript
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});
