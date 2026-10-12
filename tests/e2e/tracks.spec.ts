import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * The track and weather picker and the layout view (Milestone D phase 0). The production build
 * offers only courses with baked terrain (today Neon Cut, Clear Night), so it shows no picker;
 * `?debug=1` offers all eight tracks, and an unbaked one races in the layout view on the server.
 */

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

test('a production session offers only the baked course, with no picker', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await expect(page.getByRole('region', { name: 'Neon Cut' })).toBeVisible();
  await expect(page.getByTestId('course-picker')).toHaveCount(0);
  await expect(page.getByTestId('art-in-progress')).toHaveCount(0);
  await expect(page.locator('.preview-map-art')).toBeVisible();
  expect(problems).toEqual([]);
});

test('with ?debug=1 every track can be picked, is remembered, and races in the layout view', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  const picker = page.getByTestId('course-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('1 of 8');
  await expect(page.getByTestId('art-in-progress')).toHaveCount(0);

  // Next track: Backstreet Blitz, in the same weather slot (the first), with no art yet.
  await page.getByRole('button', { name: 'Next track' }).tap();
  await expect(page.getByRole('region', { name: 'Backstreet Blitz' })).toBeVisible();
  await expect(picker).toContainText('2 of 8');
  await expect(page.getByRole('radio', { name: 'Clear' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('art-in-progress')).toHaveText('Track art in progress');
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

  // The server accepts the course and races it; the client draws the layout, labelled.
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('layout-badge')).toHaveText('Track art in progress');
  await expect(page.getByTestId('debug')).toContainText('online');
  await expect(page.locator('.hud-clock canvas')).not.toHaveAttribute('aria-label', '0:00.00', {
    timeout: 20_000,
  });
  expect(problems).toEqual([]);
});
