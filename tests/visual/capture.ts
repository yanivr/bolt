import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * Visual evidence capture. Drives the real client in a phone-sized touch viewport, steers with
 * a synthetic finger, and saves screenshots plus a short gameplay recording.
 *
 *   npx tsx tests/visual/capture.ts [baseUrl] [outDir]
 *
 * Screenshots prove composition; the recording is what shows motion (Section 19.4).
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out');
const autopilot = process.argv[4] !== 'touch';
mkdirSync(outDir, { recursive: true });

type Finger = { id: number; x: number; y: number };

/** Dispatches real pointer events through CDP touch input, so pointer capture behaves. */
let cdp: CDPSession | null = null;
async function touch(
  page: Page,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  fingers: Finger[],
): Promise<void> {
  // One session for the whole run: Chromium tracks active touches per session.
  cdp ??= await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: fingers.map((f) => ({
      x: f.x,
      y: f.y,
      id: f.id,
      radiusX: 8,
      radiusY: 8,
      force: 1,
    })),
  });
}

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
    recordVideo: { dir: outDir, size: { width: 844, height: 390 } },
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) =>
    problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`),
  );

  await page.goto(autopilot ? `${baseUrl}/?autopilot=1` : baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(outDir, '01_home.png') });

  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.locator('.hud').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, '02_grid_countdown.png') });
  await page.waitForTimeout(2600);

  if (autopilot) {
    // The centerline driver laps the track; capture at fixed times around the first lap.
    const shots: Array<[number, string]> = [
      [1500, '03_launch.png'],
      [4000, '04_harbor_straight.png'],
      [4500, '05_dockside_sweeper.png'],
      [5500, '06_west_avenue.png'],
      [5000, '07_arcade_sweeper.png'],
      [5000, '08_billboard_row.png'],
      [3200, '09_switchback_one.png'],
      [3000, '10_cobble.png'],
      [2600, '11_switchback_two.png'],
      [4500, '12_market_street.png'],
      [4500, '13_overpass.png'],
    ];
    for (const [ms, shot] of shots) {
      await page.waitForTimeout(ms);
      await page.screenshot({ path: join(outDir, shot) });
    }
  } else {
    // Direction steering: hold a finger down for full throttle, then point the stick at a
    // sequence of screen directions. The Neon Cut grid faces left, so "left" is straight on.
    const origin = { x: 210, y: 250 };
    await touch(page, 'touchStart', [{ id: 1, ...origin }]);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(outDir, '03_touch_launch.png') });
    const script: Array<[number, number, number, string?]> = [
      [1500, -40, 0],
      [900, -34, -20, '04_touch_point_up_left.png'],
      [900, -34, 20, '05_touch_point_down_left.png'],
      [900, -40, 0, '06_touch_straight.png'],
      [1600, 42, 0, '07_touch_pull_back.png'],
      [1500, -40, 0, '08_touch_forward_again.png'],
    ];
    for (const [ms, dx, dy, shot] of script) {
      await touch(page, 'touchMove', [{ id: 1, x: origin.x + dx, y: origin.y + dy }]);
      await page.waitForTimeout(ms);
      if (shot) await page.screenshot({ path: join(outDir, shot) });
    }
    await touch(page, 'touchEnd', []);
    await page.waitForTimeout(400);
  }

  const hud = await page.evaluate(
    () => (document.querySelector('.hud') as HTMLElement | null)?.innerText ?? '',
  );
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '11_pause_settings.png') });

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ hud: hud.replace(/\s+/g, ' ').slice(0, 200), problems }, null, 2));
}

await main();
