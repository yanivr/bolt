import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Combat in the browser, as far as Milestone C part 1 goes: the simulation runs behind the
 * race screen, a rival is on the track, the scenario switch works, and the stand-in drawing
 * and debug readout do not break the page. What combat looks and sounds like is part 2.
 */

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function toTheGrid(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
}

async function combat(page: Page): Promise<string> {
  return (await page.getByTestId('debug-combat').textContent()) ?? '';
}

const field = (text: string, name: string) =>
  Number(new RegExp(`${name} (-?[\\d.]+)`).exec(text)?.[1] ?? 'NaN');

test('a showcase scenario plays in the page: the rocket flies and the other car is hit', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await toTheGrid(page, '?debug=1&scenario=rocket_hit');
  // A scenario runs in the page, on its script: nothing here needs the driver.
  await expect(page.getByTestId('debug')).toContainText('offline');
  await expect
    .poll(async () => field(await combat(page), 'rival'), { timeout: 15_000 })
    .toBeGreaterThan(50);
  const whole = field(await combat(page), 'rival');
  // The first rocket leaves about 1.3 s after GO and lands a quarter of a second later.
  await expect
    .poll(async () => field(await combat(page), 'rival'), { timeout: 25_000 })
    .toBeLessThan(whole);
  expect(field(await combat(page), 'events')).toBeGreaterThan(2);
  // The attacker was not touched.
  const text = await combat(page);
  expect(field(text, 'hull')).toBeGreaterThan(50);
  expect(problems).toEqual([]);
});

test('an ordinary race has a rival on the grid, chosen by the debug switch, on the server', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await toTheGrid(page, '?debug=1&rival=starter_longlegs&seed=7');
  await expect(page.getByTestId('debug')).toContainText('online');
  await expect
    .poll(async () => field(await combat(page), 'rival'), { timeout: 15_000 })
    .toBeGreaterThan(50);
  const text = await combat(page);
  expect([1, 2]).toContain(field(text, 'pos'));
  expect(field(text, 'hull')).toBeGreaterThan(50);
  // Once the race is on, the event stream is live: a press of the fire key is answered.
  await page.locator('.hud-clock canvas').waitFor();
  await expect(page.locator('.hud-clock canvas')).not.toHaveAttribute('aria-label', '0:00.00', {
    timeout: 20_000,
  });
  const before = field(await combat(page), 'events');
  await page.keyboard.down('Space');
  await page.waitForTimeout(200);
  await page.keyboard.up('Space');
  await expect
    .poll(async () => field(await combat(page), 'events'), { timeout: 10_000 })
    .toBeGreaterThan(before);
  expect(problems).toEqual([]);
});
