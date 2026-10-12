import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Visual evidence for Milestone D phase 0: for every track, the Track Preview with its picker
 * and map, and a moment of a race in the layout view (or the baked art, for Neon Cut), in a
 * phone-sized landscape viewport. Runs against a server with `?debug=1`, so every course is
 * offered, as in a development build.
 *
 *   npx tsx tests/visual/tracks.ts [baseUrl] [outDir] [trackId...]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/tracks');
const only = process.argv.slice(4);
const TRACKS = [
  ['city_01', 'city_clear_night'],
  ['city_02', 'city_clear_day'],
  ['desert_01', 'desert_crosswind'],
  ['desert_02', 'desert_dry_heat'],
  ['forest_01', 'forest_clear'],
  ['forest_02', 'forest_clear'],
  ['snow_01', 'snow_clear_frost'],
  ['industrial_01', 'industrial_dry_night'],
].filter(([id]) => only.length === 0 || only.includes(id!));
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
  for (const [trackId, presetId] of TRACKS) {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(
      ([t, p]) =>
        window.localStorage.setItem('bolt.course.v1', JSON.stringify({ trackId: t, presetId: p })),
      [trackId!, presetId!],
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${baseUrl}/?debug=1&autopilot=1`);
    await page.getByRole('button', { name: 'Start Racing' }).tap();
    await page.locator('.preview-map-art').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${trackId}_preview.png` });
    await page.getByRole('button', { name: 'Back' }).first().tap();
    await page.getByRole('button', { name: 'Quick Build' }).tap();
    await page.getByRole('button', { name: 'Race This Car' }).first().tap();
    await page.locator('canvas').first().waitFor();
    // Loading, the countdown, then a few seconds of the autopilot driving.
    await page.locator('.hud').waitFor({ timeout: 40_000 });
    await page.waitForTimeout(11_000);
    await page.screenshot({ path: `${outDir}/${trackId}_race.png` });
    const badge = await page.locator('[data-testid="layout-badge"]').count();
    console.log(
      `${trackId}/${presetId}: preview and race captured; layout badge ${badge}; errors ${errors.length ? errors.join(' | ') : 'none'}`,
    );
    await context.close();
  }
  await browser.close();
}

void main();
