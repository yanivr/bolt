import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * Screenshots of the Milestone B flow for design review: home, track preview, the garage in
 * its main states and My Blueprints, on a landscape phone and on a desktop.
 *
 *   pnpm build && PORT=2671 node apps/server/dist/main.js &
 *   npx tsx tests/visual/garage.ts http://localhost:2671 tests/visual/out/garage
 *
 * The build clock is stretched with the debug-only `buildSeconds` switch so nothing locks
 * while a shot is being set up.
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/garage');
mkdirSync(outDir, { recursive: true });

const QUERY = '?debug=1&buildSeconds=900';

type Size = { name: string; width: number; height: number; mobile: boolean };
const SIZES: Size[] = [
  { name: '844x390', width: 844, height: 390, mobile: true },
  { name: '667x375', width: 667, height: 375, mobile: true },
  { name: '932x430', width: 932, height: 430, mobile: true },
  { name: '1024x768', width: 1024, height: 768, mobile: true },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

/** A saved build from an older catalog that is also over its frame's weight limit. */
function staleBuild(): string {
  const part = (instanceId: string, partId: string, mountId: string, extra = {}) => ({
    instanceId,
    partId,
    mountId,
    offsetX: 0,
    offsetY: 0,
    rotationQuarterTurns: 0,
    ...extra,
  });
  return JSON.stringify({
    version: 1,
    items: [
      {
        id: 'bstale',
        savedAt: '2026-09-01T10:00:00.000Z',
        blueprint: {
          formatVersion: 1,
          catalogVersion: '0.2.0',
          name: 'Old Faithful',
          chassisId: 'chassis_beetle',
          engineId: 'engine_v8',
          tireKitId: 'tires_armored',
          paintId: 'paint_cobalt',
          parts: [
            part('p1', 'weapon_turret', 'roof_mid', { assignedActionSlot: 0 }),
            part('p2', 'weapon_hammer', 'front_center', { assignedActionSlot: 1 }),
            part('p3', 'utility_nitro', 'left_utility'),
            part('p4', 'utility_generator', 'right_utility'),
          ],
          createdAt: '2026-09-01T10:00:00Z',
        },
      },
    ],
  });
}

async function shot(page: Page, size: Size, name: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(outDir, `${size.name}_${name}.png`) });
}

async function capture(browser: Browser, size: Size, problems: string[]): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    hasTouch: size.mobile,
    isMobile: size.mobile,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${size.name} console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${size.name} pageerror: ${e.message}`));
  const press = (name: string | RegExp) =>
    page
      .getByRole('button', { name, exact: typeof name === 'string' })
      .first()
      .click();

  await page.goto(`${baseUrl}/${QUERY}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  await shot(page, size, '01_home_first_visit');

  await press('Start Racing');
  await page.getByRole('button', { name: 'Build Your Car' }).waitFor();
  await shot(page, size, '02_track_preview');
  await press('Track Details');
  await shot(page, size, '02b_track_details');
  await press('Close');

  await press('Build Your Car');
  await page.getByTestId('ready').waitFor();
  await page.waitForTimeout(500);
  await shot(page, size, '03_garage_first_visit');
  await press('Skip tips');
  await shot(page, size, '04_garage_default');

  // A part selected with the compare pane open.
  await page.getByRole('tab', { name: 'Weapons' }).click();
  await shot(page, size, '05_garage_weapons');
  await page.locator('.part-card[data-part="weapon_turret"]').click();
  await shot(page, size, '06_garage_compare');
  await page.getByTestId('install').click();
  await shot(page, size, '07_garage_part_tools');
  await page.getByRole('button', { name: 'Rotate view' }).click();
  await shot(page, size, '07b_garage_view_turned');
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Rotate view' }).click();

  // A refused purchase: spend most of the budget, then ask for the V12.
  const buy = async (tab: string, partId: string) => {
    await page.getByRole('tab', { name: tab }).click();
    await page.locator(`.part-card[data-part="${partId}"]`).click();
    await page.getByTestId('install').click();
  };
  await buy('Defense', 'defense_heavy_plate');
  await buy('Defense', 'defense_heavy_plate');
  await buy('Utility', 'utility_nitro');
  await buy('Utility', 'utility_overdrive');
  await page.getByRole('tab', { name: 'Engine' }).click();
  await shot(page, size, '08_garage_engine_list_low_credits');
  await page.locator('.part-card[data-part="engine_v12"]').click();
  // The button is aria-disabled; pressing it anyway states the reason and changes nothing.
  await page.getByTestId('install').click({ force: true });
  await shot(page, size, '08b_garage_over_budget');
  await page.getByRole('button', { name: 'All parts' }).click();

  await page.getByRole('tab', { name: 'Chassis' }).click();
  await shot(page, size, '09_garage_chassis_list');
  await page.locator('.part-card[data-part="chassis_turtle"]').click();
  await shot(page, size, '09b_garage_chassis_compare');
  await page.getByRole('button', { name: 'All parts' }).click();

  await page.locator('.indicator[data-indicator="heat"]').click();
  await shot(page, size, '10_garage_indicator_detail');
  await press('Close');

  // On the narrowest phones Reset, Save and Quick Build fold into one menu.
  const more = page.getByRole('button', { name: 'More', exact: true });
  const folded = await more.isVisible();
  if (folded) {
    await more.click();
    await shot(page, size, '10b_garage_more_menu');
  }
  await press('Quick Build');
  await shot(page, size, '11_garage_quick_build');
  await press('Close');

  if (folded) await more.click();
  await page.getByRole('button', { name: /^Save/ }).click();
  await press('Save This Car');
  await shot(page, size, '12_garage_blueprints_overlay');
  await press('Close');

  // My Blueprints from home, with a stale build to flag.
  await page.evaluate((library) => {
    const current = JSON.parse(window.localStorage.getItem('bolt.blueprints.v1') ?? '{"items":[]}');
    const stale = JSON.parse(library);
    window.localStorage.setItem(
      'bolt.blueprints.v1',
      JSON.stringify({ version: 1, items: [...current.items, ...stale.items] }),
    );
  }, staleBuild());
  await press('Back');
  await press('Leave Garage');
  await page.getByRole('button', { name: 'My Blueprints' }).click();
  await page.getByRole('tab', { name: 'My Builds' }).waitFor();
  await shot(page, size, '13_blueprints');
  await page.getByRole('tab', { name: 'Starter Cars' }).click();
  await shot(page, size, '13b_blueprints_starters');
  await page.getByRole('tab', { name: 'My Builds' }).click();

  // An illegal build state: the stale build opened for review in the garage.
  await press('Review');
  await page.getByTestId('ready').waitFor();
  await page.waitForTimeout(500);
  await shot(page, size, '14_garage_illegal_build');
  await page.locator('.indicator[data-indicator="load"]').click();
  await shot(page, size, '14b_garage_illegal_load_detail');
  await press('Close');
  await press('Back');
  await press('Leave Garage');
  await page.getByRole('button', { name: 'Start Racing' }).waitFor();
  await shot(page, size, '15_home');
  await press('Quick Build');
  await shot(page, size, '16_home_quick_build');

  await context.close();
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
  const problems: string[] = [];
  const only = process.argv[4];
  for (const size of SIZES) {
    if (only && !only.split(',').includes(size.name)) continue;
    try {
      await capture(browser, size, problems);
    } catch (error) {
      problems.push(`${size.name} capture stopped: ${(error as Error).message.slice(0, 900)}`);
    }
  }
  await browser.close();
  console.log(JSON.stringify({ outDir, problems }, null, 2));
}

await main();
