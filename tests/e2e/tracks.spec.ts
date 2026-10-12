import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * The track and weather picker (Milestone D). A production build offers only courses with baked
 * terrain, and since the terrain finish that is all sixteen (`assets/maps/index.json`), so it
 * shows the picker with all eight tracks and both weathers each, every one drawn from its bake:
 * nothing says "Track art in progress" and no race falls back to the layout view.
 */

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

test('a production session offers every course, each with its baked art', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await expect(page.getByRole('region', { name: 'Neon Cut' })).toBeVisible();
  const picker = page.getByTestId('course-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('1 of 8');
  // Every track, both weathers: the map is the bake's and nothing is labelled in progress.
  for (let k = 0; k < 8; k++) {
    const weathers = page.getByRole('radiogroup', { name: 'Weather' }).getByRole('radio');
    await expect(weathers).toHaveCount(2);
    for (const radio of await weathers.all()) {
      await radio.tap();
      await expect(page.getByTestId('art-in-progress')).toHaveCount(0);
      await expect(page.locator('.preview-map-art')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Next track' }).tap();
  }
  await expect(picker).toContainText('1 of 8');
  expect(problems).toEqual([]);
});

test('every track can be picked, is remembered, and races its baked art', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  const picker = page.getByTestId('course-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('1 of 8');
  await expect(page.getByTestId('art-in-progress')).toHaveCount(0);

  // Next track: Backstreet Blitz, in the same weather slot (the first).
  await page.getByRole('button', { name: 'Next track' }).tap();
  await expect(page.getByRole('region', { name: 'Backstreet Blitz' })).toBeVisible();
  await expect(picker).toContainText('2 of 8');
  await expect(page.getByRole('radio', { name: 'Clear' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('art-in-progress')).toHaveCount(0);
  await expect(page.locator('.preview-map-art')).toBeVisible();
  await page.getByRole('radio', { name: 'Rain' }).tap();
  await expect(page.getByRole('radio', { name: 'Rain' })).toHaveAttribute('aria-checked', 'true');

  // Round the list both ways.
  await page.getByRole('button', { name: 'Previous track' }).tap();
  await page.getByRole('button', { name: 'Previous track' }).tap();
  await expect(page.getByRole('region', { name: 'Steel Circuit' })).toBeVisible();
  await expect(picker).toContainText('8 of 8');
  await page.getByRole('button', { name: 'Next track' }).tap();
  await page.getByRole('button', { name: 'Next track' }).tap();
  await expect(page.getByRole('region', { name: 'Backstreet Blitz' })).toBeVisible();

  // The choice survives a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await expect(page.getByRole('region', { name: 'Backstreet Blitz' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Rain' })).toHaveAttribute('aria-checked', 'true');

  // The server accepts the course and races it; the client draws its bake, not the layout.
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('layout-badge')).toHaveCount(0);
  await expect(page.getByTestId('debug')).toContainText('online');
  await expect(page.locator('.hud-clock canvas')).not.toHaveAttribute('aria-label', '0:00.00', {
    timeout: 20_000,
  });
  expect(problems).toEqual([]);
});
