import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * In-game evidence for the desert courses: the production client (no `?debug=1`, so only baked
 * courses are offered), a phone-sized landscape viewport, the autopilot driving, a screenshot
 * every few seconds along the lap. Run against a server that serves the production build.
 *
 *   npx tsx art/scripts/terrain/desert/capture.ts [baseUrl] [outDir] [track/preset ...]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2679';
const outDir = resolve(process.argv[3] ?? 'art/preview/terrain/desert_ingame');
const only = process.argv.slice(4);
const COURSES = [
  ['desert_01', 'desert_clear'],
  ['desert_01', 'desert_crosswind'],
  ['desert_02', 'desert_dry_heat'],
  ['desert_02', 'desert_sandstorm'],
].filter(([t, p]) => only.length === 0 || only.includes(`${t}/${p}`));
const SHOTS_AT = [6, 14, 24, 36, 50, 66];
mkdirSync(outDir, { recursive: true });

async function main(): Promise<void> {
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
      ([t, p]) =>
        (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem(
          'bolt.course.v1',
          JSON.stringify({ trackId: t, presetId: p }),
        ),
      [trackId!, presetId!],
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
    for (const at of SHOTS_AT) {
      const wait = at * 1000 - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: `${outDir}/${trackId}_${presetId}_race_${String(at).padStart(2, '0')}s.png` });
    }
    const badge = await page.locator('[data-testid="layout-badge"]').count();
    console.log(
      `${trackId}/${presetId}: ${SHOTS_AT.length} shots; layout badge ${badge}; errors ${errors.length ? errors.join(' | ') : 'none'}`,
    );
    await context.close();
  }
  await browser.close();
}

void main();
