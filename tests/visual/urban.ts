import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * In-game evidence for the urban bakes (Backstreet Blitz clear and rain, Steel Circuit dry
 * night and factory rain, Neon Cut's rainy night) in a production build: no `?debug=1`, so a
 * course is only offered if its art is baked. Phone landscape, 870 x 390, three moments of the
 * autopilot driving each course.
 *
 *   npx tsx tests/visual/urban.ts [baseUrl] [outDir]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2678';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/urban');
const only = process.argv.slice(4);
const ALL = [
  ['city_02', 'city_clear_day'],
  ['city_02', 'city_rain_day'],
  ['industrial_01', 'industrial_dry_night'],
  ['industrial_01', 'industrial_factory_rain'],
  ['city_01', 'city_rain_night'],
] as const;
const COURSES = ALL.filter(([t, p]) => only.length === 0 || only.includes(`${t}/${p}`));
mkdirSync(outDir, { recursive: true });

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  for (const [trackId, presetId] of COURSES) {
    const context = await browser.newContext({
      viewport: { width: 870, height: 390 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(
      ([t, p]) =>
        window.localStorage.setItem('bolt.course.v1', JSON.stringify({ trackId: t, presetId: p })),
      [trackId, presetId],
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const missing: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/maps/')) missing.push(r.url());
    });
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
    for (const [k, wait] of [8_000, 9_000, 10_000].entries()) {
      await page.waitForTimeout(wait);
      await page.screenshot({
        path: `${outDir}/${trackId}_${presetId}_race_${k + 1}.png`,
        timeout: 120_000,
      });
    }
    const badge = await page.locator('[data-testid="layout-badge"]').count();
    console.log(
      `${trackId}/${presetId}: layout badge ${badge}; missing ${missing.length}; errors ${errors.length ? errors.join(' | ') : 'none'}`,
    );
    await context.close();
  }
  await browser.close();
}

void main();
