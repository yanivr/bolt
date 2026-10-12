import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * In-game screenshots of the forest and snow courses (a review tool, not a test). Runs against
 * a production build served locally, in an 870 x 390 phone viewport, with the autopilot
 * driving; no `?debug=1`, so a course is offered only because it is baked.
 *
 *   npx tsx art/scripts/terrain/forest/capture.ts http://localhost:2680 [outDir] [track/preset ...]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2680';
const outDir = resolve(process.argv[3] ?? 'art/preview/terrain/client');
const wanted = process.argv.slice(4);
const COURSES = (
  wanted.length > 0
    ? wanted
    : [
        'forest_01/forest_clear',
        'forest_01/forest_rain',
        'forest_02/forest_clear',
        'forest_02/forest_heavy_rain',
        'snow_01/snow_clear_frost',
        'snow_01/snow_snowfall',
      ]
).map((s) => s.split('/') as [string, string]);
const MOMENTS = [9_000, 17_000, 27_000, 38_000];

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  for (const [trackId, presetId] of COURSES) {
    const context = await browser.newContext({
      viewport: { width: 870, height: 390 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(
      ([t, p]) => globalThis.localStorage.setItem('bolt.course.v1', JSON.stringify({ trackId: t, presetId: p })),
      [trackId, presetId],
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${baseUrl}/?autopilot=1`);
    await page.getByRole('button', { name: 'Start Racing' }).tap();
    await page.locator('.preview-map-art').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${trackId}_${presetId}_preview.png` });
    await page.getByRole('button', { name: 'Back' }).first().tap();
    await page.getByRole('button', { name: 'Quick Build' }).tap();
    await page.getByRole('button', { name: 'Race This Car' }).first().tap();
    await page.locator('canvas').first().waitFor();
    await page.locator('.hud').waitFor({ timeout: 60_000 });
    const t0 = Date.now();
    for (const [k, at] of MOMENTS.entries()) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: `${outDir}/${trackId}_${presetId}_race_${k}.png` });
    }
    const badge = await page.locator('[data-testid="layout-badge"]').count();
    console.log(`${trackId}/${presetId}: captured; layout badge ${badge}; errors ${errors.length ? errors.join(' | ') : 'none'}`);
    await context.close();
  }
  await browser.close();
}

void main();
