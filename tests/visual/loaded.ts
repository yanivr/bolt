import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Race screenshots of every starter car (one for each of the five chassis), to check that
 * mounted parts, engines and wheel kits are drawn on the car that actually drives, and that
 * the five frames are easy to tell apart at race size. Files are named after the car.
 *
 *   npx tsx tests/visual/loaded.ts http://localhost:2671 tests/visual/out/loaded
 */
const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/loaded');
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
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?debug=1&autopilot=1`);
  await page.getByRole('button', { name: 'Quick Build' }).click();
  const buttons = page.getByRole('button', { name: /^Race This Car/ });
  const count = await buttons.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++)
    names.push(
      ((await buttons.nth(i).getAttribute('aria-label')) ?? `car ${i}`)
        .replace(/^Race This Car:?\s*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_'),
    );
  for (let i = 0; i < count; i++) {
    await page.goto(`${baseUrl}/?debug=1&autopilot=1`);
    await page.getByRole('button', { name: 'Quick Build' }).click();
    await page
      .getByRole('button', { name: /^Race This Car/ })
      .nth(i)
      .click();
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: join(outDir, `race_${i}_${names[i]}.png`) });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(outDir, `race_${i}_${names[i]}_b.png`) });
  }
  await browser.close();
}
void main();
