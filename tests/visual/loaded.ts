import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Race screenshots of every starter and example car, to check that mounted parts, engines
 * and wheel kits are drawn on the car that actually drives.
 *
 *   npx tsx tests/visual/loaded.ts http://localhost:2671 tests/visual/out/loaded
 */
const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/loaded');
mkdirSync(outDir, { recursive: true });

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?debug=1&autopilot=1`);
  await page.getByRole('button', { name: 'Quick Build' }).click();
  const count = await page.getByRole('button', { name: /^Race This Car/ }).count();
  for (let i = 0; i < count; i++) {
    await page.goto(`${baseUrl}/?debug=1&autopilot=1`);
    await page.getByRole('button', { name: 'Quick Build' }).click();
    await page
      .getByRole('button', { name: /^Race This Car/ })
      .nth(i)
      .click();
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: join(outDir, `race_${i}.png`) });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(outDir, `race_${i}_b.png`) });
  }
  await browser.close();
}
void main();
