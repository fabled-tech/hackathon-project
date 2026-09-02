import { expect, test, type Page } from '@playwright/test';
import { DEMO_ROSTER, DEMO_TWO_LEAD_SCRIPT } from '../../apps/web/lib/demo-mode';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('rightsrader.demo.choice');
    window.localStorage.removeItem('rightsrader.demo.lastScriptId');
    window.localStorage.removeItem('rightsrader.demo.usedScriptIds');
    window.localStorage.removeItem('rightsrader.activeMemberId');
    window.localStorage.setItem('rightsrader.demo.choice', 'self-serve');
  });
});

/**
 * The textarea's accessible label switches from "Script text" to
 * "Script the agents analyzed" once a case has been submitted (see
 * script-review.tsx). Select by the stable element id instead of the
 * label text so tests keep working across that state change.
 */
function scriptTextarea(page: Page) {
  return page.locator('#script-text');
}

/**
 * The "Refresh recent cases" button label shortens to "Refresh" once a
 * case is open (compact recent-cases panel in script-review.tsx). Match
 * on the shared substring so tests work in both layouts.
 */
function refreshRecentCasesButton(page: Page) {
  return page.getByRole('button', { name: /Refresh/ });
}

async function openCaseWorkspace(page: Page) {
  const title = `E2E Production ${Date.now()} ${Math.random().toString(16).slice(2)}`;
  const response = await page.request.post('http://127.0.0.1:8000/api/productions', {
    data: { title, studio: 'RightsRadar Test Unit', roster: DEMO_ROSTER }
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'New case' })
    .click();
}

test('keeps the visible case usable after reopening another case fails', async ({ page }) => {
  const visibleScript = 'Failure guard visible case: Nimbus Soda remains on the prop table.';
  const failedScript = 'Failure guard target case: a quiet scene plays in silence.';

  await openCaseWorkspace(page);
  await scriptTextarea(page).fill(visibleScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await scriptTextarea(page).fill(failedScript);
  const failedCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const failedCase = await (await failedCaseResponse).json();

  await refreshRecentCasesButton(page).click();
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(visibleScript) }).click();
  await expect(scriptTextarea(page)).toHaveValue(visibleScript);

  await page.route(`**/api/cases/${failedCase.id}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'forced reopen failure' })
    });
  });
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(failedScript) }).click();
  await expect(page.getByText('This case could not be reopened. Please try again.')).toBeVisible();
  await expect(scriptTextarea(page)).toHaveValue(visibleScript);

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await page.unroute(`**/api/cases/${failedCase.id}`);
});

test('ignores stale asset uploads after a newer case is selected', async ({ page }) => {
  const olderScript = 'Stale upload older case: Nimbus Soda remains on the prop table.';
  const newerScript = 'Stale upload newer case: a quiet scene plays in silence.';

  await openCaseWorkspace(page);
  await scriptTextarea(page).fill(olderScript);
  const olderCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const olderCase = await (await olderCaseResponse).json();

  await scriptTextarea(page).fill(newerScript);
  const newerCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const newerCase = await (await newerCaseResponse).json();

  await refreshRecentCasesButton(page).click();
  await page.getByTestId('recent-cases').getByRole('button', { name: new RegExp(olderScript) }).click();
  await expect(scriptTextarea(page)).toHaveValue(olderScript);

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
  await expect(scriptTextarea(page)).toHaveValue(newerScript);

  const staleAssetsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/cases/${olderCase.id}/assets`) &&
      response.request().method() === 'GET'
  );
  releaseOlderAssetsResponse?.();
  await staleAssetsResponse;
  await expect(page.getByTestId('asset-list')).not.toContainText('production-note.txt');
  await expect(page.getByTestId('finding-card')).toHaveCount(0);
  await expect(scriptTextarea(page)).toHaveValue(newerScript);

  await page.unroute(`**/api/cases/${olderCase.id}/assets`);
  expect(newerCase.id).not.toBe(olderCase.id);
});

test('ignores stale case reopen responses after a newer case is selected', async ({ page }) => {
  const olderScript = 'The Nimbus Soda can remains on the prop table.';
  const newerScript = 'A quiet scene without any fictional references plays in silence.';

  await openCaseWorkspace(page);
  await scriptTextarea(page).fill(olderScript);
  const olderCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const olderCase = await (await olderCaseResponse).json();

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await scriptTextarea(page).fill(newerScript);
  const newerCaseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const newerCase = await (await newerCaseResponse).json();

  await refreshRecentCasesButton(page).click();
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
  await expect(scriptTextarea(page)).toHaveValue(newerScript);

  const staleAssetsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/cases/${olderCase.id}/assets`) &&
      response.request().method() === 'GET'
  );
  releaseOlderCaseResponse?.();
  await staleAssetsResponse;

  await expect(scriptTextarea(page)).toHaveValue(newerScript);
  await expect(page.getByTestId('finding-card')).toHaveCount(0);
  await expect(page.getByTestId('asset-list')).not.toContainText('production-note.txt');
  await expect(page.getByTestId('asset-list')).toContainText(
    'No plain-text production notes are attached yet.'
  );

  await page.unroute(`**/api/cases/${olderCase.id}`);
  expect(newerCase.id).not.toBe(olderCase.id);
});

test('uploads a text asset and reopens it from recent cases', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('Nimbus Soda appears in a shot.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
  await expect(page.getByTestId('asset-list')).toContainText('text/plain');

  await refreshRecentCasesButton(page).click();
  await page.getByTestId('recent-cases').getByRole('button').first().click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
  await expect(page.getByTestId('asset-list')).toContainText('text/plain');
});

test('reopens a different case with its script, reviewer status, and assets', async ({ page }) => {
  const originalScript = 'Scene 47: Nimbus Soda appears beside a painted blue kettle.';
  const newerScript = 'A different scene contains no fictional brand references.';

  await openCaseWorkspace(page);
  await scriptTextarea(page).fill(originalScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const originalFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await originalFinding.getByRole('button', { name: 'Dismiss' }).click();
  await expect(originalFinding).toContainText('Dismissed');

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await scriptTextarea(page).fill(newerScript);
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(scriptTextarea(page)).toHaveValue(newerScript);

  await refreshRecentCasesButton(page).click();
  await page
    .getByTestId('recent-cases')
    .getByRole('button', { name: new RegExp(originalScript) })
    .click();

  await expect(scriptTextarea(page)).toHaveValue(originalScript);
  await expect(page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' })).toContainText(
    'Dismissed'
  );
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
});

test('frames cited character leads as research assistance', async ({ page }) => {
  await openCaseWorkspace(page);
  await expect(page.getByLabel('Legal disclaimer')).toContainText('Research assistance only.');

  await scriptTextarea(page).fill('Captain Aurelia enters the archive.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  // Findings (and the "Potential research leads" heading) render only once a case exists.
  await expect(page.getByText('Potential research leads')).toBeVisible();

  const characterFinding = page.getByTestId('finding-card').filter({ hasText: 'Captain Aurelia' });
  await expect(characterFinding).toContainText('character reference');
  await expect(characterFinding).toContainText('character reference archive');
  await expect(characterFinding).toContainText('research');
});

test('submits a script and lets the reviewer dismiss a finding', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill(
    'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(page.getByTestId('agent-pipeline')).toContainText('COMPLETE');
  await expect(page.getByTestId('agent-pipeline')).toContainText('Gemini Intake');
  await expect(page.getByTestId('agent-pipeline')).toContainText('Parallel Research');
  await expect(page.getByTestId('agent-pipeline')).toContainText('Gemini Curation');
  await expect(page.getByTestId('agent-pipeline')).toContainText('2 leads detected');

  const brandFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await expect(brandFinding).toContainText('brand reference archive');
  await expect(brandFinding).toContainText('Pending');

  await brandFinding.getByRole('button', { name: 'Dismiss' }).click();
  await expect(brandFinding).toContainText('Dismissed');
});

test('lets the reviewer escalate a finding', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill(
    'A Nimbus Soda billboard looms over the skyline in the establishing shot.'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const brandFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await expect(brandFinding).toContainText('Pending');

  await brandFinding.getByRole('button', { name: 'Escalate' }).click();
  await expect(brandFinding).toContainText('Escalated');
});

test('shows an error banner when script submission fails', async ({ page }) => {
  await openCaseWorkspace(page);
  await page.route('**/api/cases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await scriptTextarea(page).fill('Nimbus Soda appears in the scene.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(
    page.getByText('RightsRadar could not analyze this script right now. Please try again.')
  ).toBeVisible();
  await expect(page.getByTestId('agent-pipeline')).toContainText('RETRY NEEDED');

  await page.unroute('**/api/cases');
});

test('shows an error banner when asset upload fails', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('Nimbus Soda appears in the scene.');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.getByTestId('finding-card').first()).toBeVisible();

  await page.route('**/assets', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 413, contentType: 'application/json', body: '{}' });
  });

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();

  await expect(
    page.getByText('The asset could not be uploaded. Use a plain-text file no larger than 256 KiB.')
  ).toBeVisible();

  await page.unroute('**/assets');
});

test('shows an error banner when loading recent cases fails', async ({ page }) => {
  await openCaseWorkspace(page);
  await page.route('**/api/cases*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });

  await refreshRecentCasesButton(page).click();

  await expect(
    page.getByText('Recent cases could not be loaded. Please try again.')
  ).toBeVisible();

  await page.unroute('**/api/cases*');
});

test('shows an error banner when saving a reviewer status fails', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('Nimbus Soda appears in the scene.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const brandFinding = page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' });
  await expect(brandFinding).toBeVisible();

  await page.route('**/findings/**', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await brandFinding.getByRole('button', { name: 'Dismiss' }).click();

  await expect(
    page.getByText('The reviewer status could not be saved. Please try again.')
  ).toBeVisible();

  await page.unroute('**/findings/**');
});

test('shows a no-findings message when the script produces no leads', async ({ page }) => {
  await openCaseWorkspace(page);
  await page.route('**/api/cases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'case-empty',
        script_text: 'A quiet scene plays in silence.',
        created_at: new Date().toISOString(),
        asset_count: 0,
        findings: []
      })
    });
  });

  await scriptTextarea(page).fill('A quiet scene plays in silence.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(
    page.getByText('No deterministic research leads were found in this excerpt.')
  ).toBeVisible();
  await expect(page.getByTestId('finding-card')).toHaveCount(0);

  await page.unroute('**/api/cases');
});

test('shows the recent-cases placeholder before the first refresh', async ({ page }) => {
  await openCaseWorkspace(page);
  await expect(
    page.getByText('Refresh to load recently reviewed cases.')
  ).toBeVisible();
});

test('character counter updates as the user types', async ({ page }) => {
  await openCaseWorkspace(page);
  const textarea = scriptTextarea(page);
  await textarea.fill('');
  await expect(page.getByText('0 / 20,000')).toBeVisible();

  await textarea.fill('Hello');
  await expect(page.getByText('5 / 20,000')).toBeVisible();
});

test('analyze button is disabled when the script textarea is empty', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('');
  await expect(page.getByRole('button', { name: 'Analyze script' })).toBeDisabled();
});

test('upload button is disabled when no file is selected', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('Nimbus Soda appears in the scene.');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.getByTestId('finding-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload asset' })).toBeDisabled();
});

test('explains accepted production assets before upload', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('Nimbus Soda appears in the scene.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(page.getByText('script sides, continuity or clearance notes')).toBeVisible();
  await expect(page.getByText('To analyze a PDF, DOCX, PNG, JPEG, or WebP file')).toBeVisible();
  await expect(page.getByText('it is not analyzed')).toBeVisible();
  await expect(page.getByText('UTF-8 .TXT · 256 KIB MAX')).toBeVisible();
});

test('filters production ignore phrases before creating findings', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New production').click();
  await page.getByPlaceholder('Production title').fill('Ignore List Feature');
  await page.getByPlaceholder('Studio (optional)').fill('Universal Studios');
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('IGNORE PHRASES').fill('NIMBUS SODA\nirrelevant fragment');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByLabel('IGNORE PHRASES')).toHaveValue(
    'NIMBUS SODA\nirrelevant fragment'
  );

  await page.getByRole('button', { name: 'New case' }).click();
  await scriptTextarea(page).fill(
    'Nimbus Soda appears. "Time keeps the reel turning," the director says.'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await expect(page.getByTestId('finding-card')).toHaveCount(1);
  await expect(page.getByTestId('finding-card')).toContainText('Time keeps the reel turning');
  await expect(page.getByTestId('finding-card')).not.toContainText('Nimbus Soda');
});

test('uses competition branding without OS positioning', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('PRODUCTION RIGHTS WORKSPACE')).toBeVisible();
  await expect(page.getByText('RIGHTS CLEARANCE OS')).toHaveCount(0);
  await expect(page.getByRole('complementary').getByLabel('All productions')).toContainText(
    'RightsRadar'
  );
});

test('sorts the production portfolio without another API request', async ({ page }) => {
  await page.request.post('http://127.0.0.1:8000/api/productions', {
    data: { title: '000 Alpha Sort', studio: 'Sort Test' }
  });
  await page.request.post('http://127.0.0.1:8000/api/productions', {
    data: { title: 'ZZZ Omega Sort', studio: 'Sort Test' }
  });
  await page.goto('/');

  await page.getByLabel('Sort productions').selectOption('title');
  const cards = await page
    .locator('section[aria-labelledby="production-portfolio-title"] li button')
    .allTextContents();

  expect(cards.findIndex((text) => text.includes('000 Alpha Sort'))).toBeLessThan(
    cards.findIndex((text) => text.includes('ZZZ Omega Sort'))
  );
});

test('analyzes an uploaded production image through the case workspace', async ({ page }) => {
  await openCaseWorkspace(page);

  await page.getByLabel('OR ANALYZE A PRODUCTION FILE').setInputFiles({
    name: 'wardrobe-board.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a6d6f636b2d696d616765', 'hex')
  });
  await page.getByRole('button', { name: 'Analyze file' }).click();

  await expect(page.getByTestId('finding-card')).toContainText('wardrobe-board.png');
  await expect(page.getByTestId('asset-list')).toContainText('wardrobe-board.png');
});

test('uploads a custom production icon and has no agent-run controls', async ({ page }) => {
  const title = `Custom Icon ${Date.now()}`;
  await page.request.post('http://127.0.0.1:8000/api/productions', {
    data: { title, studio: 'Icon Test' }
  });
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await page.getByRole('button', { name: 'Settings' }).click();

  await page.getByLabel('CUSTOM ICON').setInputFiles({
    name: 'production-icon.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await expect(
    page.getByRole('main').getByRole('img', { name: `${title} custom icon` })
  ).toBeVisible();

  await page.getByRole('navigation').getByRole('button', { name: 'All productions' }).click();
  await expect(page.getByText('Agent runs')).toHaveCount(0);
  await expect(page.getByText('Clearance brief')).toHaveCount(0);
  await expect(page.getByText('Run watch agent')).toHaveCount(0);
});

test('opens a case desk and its findings from the user Inbox', async ({ page }) => {
  await openCaseWorkspace(page);
  await scriptTextarea(page).fill('Nimbus Soda appears beside the hero prop.');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Overview' }).click();

  const inbox = page.getByTestId('user-inbox');
  await expect(inbox).toBeVisible();
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
  await expect(page.getByTestId('all-cases-list')).toBeVisible();

  const inboxCase = inbox.getByTestId('inbox-case-row').filter({ hasText: 'Nimbus Soda' });
  await expect(inboxCase).toBeVisible();
  await inboxCase.getByRole('button', { name: 'Open desk' }).click();

  await expect(page.getByTestId('case-desk')).toBeVisible();
  await expect(page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' })).toContainText(
    'Pending'
  );
});

test('runs a roster desk thread with stakeholder research and a human reply', async ({
  page
}) => {
  const title = `Desk Production ${Date.now()} ${Math.random().toString(16).slice(2)}`;
  const response = await page.request.post('http://127.0.0.1:8000/api/productions', {
    data: {
      title,
      studio: 'RightsRadar Test Unit',
      roster: [
        { name: 'Jordan', role: 'clearance' },
        { name: 'Alex', role: 'production' },
        { name: 'Maya', role: 'legal' }
      ]
    }
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await page.getByRole('navigation').getByRole('button', { name: 'New case' }).click();
  await scriptTextarea(page).fill(
    'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.getByTestId('agent-pipeline')).toContainText('COMPLETE');
  await expect(page.getByTestId('judge-log')).toBeVisible();

  const desk = page.getByTestId('case-desk');
  await expect(desk).toBeVisible();
  await expect(desk).toContainText('Intake');
  await expect(desk).toContainText('Research');
  await expect(desk).toContainText('Curation');
  await expect(desk).toContainText('Alex');
  await expect(desk).toContainText('Jordan');
  await expect(desk).toContainText('Parallel Search');
  await expect(desk.getByTestId('tool-call-chip').filter({ hasText: 'plan_queries' })).toHaveCount(2);
  await expect(desk.getByTestId('tool-call-chip').filter({ hasText: 'brief_stakeholders' })).toHaveCount(
    2
  );

  await page.getByLabel('Acting as').selectOption({ label: 'Jordan (clearance)' });
  await page.getByLabel('Desk reply').fill('Studio-owned brand. I can dismiss Nimbus.');
  await page.getByRole('button', { name: 'Post to desk' }).click();
  await expect(desk).toContainText('Studio-owned brand');

  const quoteFinding = page
    .getByTestId('finding-card')
    .filter({ hasText: 'Time keeps the reel turning' });
  await quoteFinding.getByRole('button', { name: /Escalate/ }).click();
  await expect(quoteFinding).toContainText('Escalated');
});

test('creates a production, analyzes the two-lane demo script, and shows tool-call chips', async ({
  page
}) => {
  await page.goto('/');
  await page.getByLabel('New production').click();
  await page.getByPlaceholder('Production title').fill(`Two Lane ${Date.now()}`);
  await expect(page.getByLabel('Roster name 1')).toHaveValue('Jordan');
  await expect(page.getByLabel('Roster name 2')).toHaveValue('Alex');
  await expect(page.getByLabel('Roster name 3')).toHaveValue('Maya');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'New case' }).click();
  await scriptTextarea(page).fill(DEMO_TWO_LEAD_SCRIPT.script);
  const caseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Analyze script' }).click();
  const created = await (await caseResponse).json();
  const methods = (created.tool_calls ?? []).map((call: { method: string }) => call.method);
  expect(methods.filter((method: string) => method === 'identify_material').length).toBeGreaterThanOrEqual(
    1
  );
  expect(methods.filter((method: string) => method === 'plan_queries').length).toBeGreaterThanOrEqual(
    2
  );
  expect(methods.filter((method: string) => method === 'search').length).toBeGreaterThanOrEqual(4);
  expect(methods.filter((method: string) => method === 'extract').length).toBeGreaterThanOrEqual(2);
  expect(
    methods.filter((method: string) => method === 'brief_stakeholders').length
  ).toBeGreaterThanOrEqual(2);
  expect(
    methods.filter((method: string) => method === 'curate_evidence').length
  ).toBeGreaterThanOrEqual(2);
  expect((created.tool_calls ?? []).every((call: { fixture?: boolean }) => call.fixture)).toBe(true);

  await expect(page.getByTestId('case-desk')).toBeVisible();
  await expect(page.getByTestId('finding-card').filter({ hasText: 'Nimbus Soda' })).toBeVisible();
  await expect(
    page.getByTestId('finding-card').filter({ hasText: 'Time keeps the reel turning' })
  ).toBeVisible();
  await expect(page.getByTestId('tool-call-chip').filter({ hasText: 'plan_queries' })).toHaveCount(2);
  await expect(page.getByTestId('tool-call-chip').filter({ hasText: 'search' })).toHaveCount(4);
  await expect(page.getByText('example.com').first()).toBeVisible();
});
