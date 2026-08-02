import { expect, test } from '@playwright/test';

test('uploads a text asset and reopens it from recent cases', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Script text').fill('Nimbus Soda appears in a shot.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
  await page.getByRole('button', { name: 'Upload asset' }).click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

  await page.getByRole('button', { name: 'Refresh recent cases' }).click();
  await page.getByTestId('recent-cases').getByRole('button').first().click();
  await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
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
