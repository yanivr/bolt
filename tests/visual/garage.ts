import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * Screenshots of the garage for design review, at the sizes it has to work at: the product
 * owner's phone inside its host page (870 x 370 landscape, 450 x 840 portrait), two bare
 * landscape phones, and a desktop.
 *
 *   pnpm build && PORT=2671 node apps/server/dist/main.js &
 *   npx tsx tests/visual/garage.ts http://localhost:2671 tests/visual/out/garage [sizes]
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
  { name: '870x370', width: 870, height: 370, mobile: true },
  { name: '844x390', width: 844, height: 390, mobile: true },
  { name: '667x375', width: 667, height: 375, mobile: true },
  { name: '450x840', width: 450, height: 840, mobile: true },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
];

type PartSpec = [partId: string, mountId: string, extra?: Record<string, unknown>];

function blueprint(
  name: string,
  essentials: { chassisId: string; engineId?: string; tireKitId?: string; paintId?: string },
  parts: PartSpec[],
  catalogVersion: string,
): Record<string, unknown> {
  return {
    formatVersion: 1,
    catalogVersion,
    name,
    chassisId: essentials.chassisId,
    engineId: essentials.engineId ?? 'engine_four_cylinder',
    tireKitId: essentials.tireKitId ?? 'tires_street',
    paintId: essentials.paintId ?? 'paint_signal',
    parts: parts.map(([partId, mountId, extra], index) => ({
      instanceId: `p${index + 1}`,
      partId,
      mountId,
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 0,
      ...extra,
    })),
    createdAt: '2026-10-10T00:00:00Z',
  };
}

/** The eight-mount Crab filled as far as 1,000 credits go. */
const CRAB: PartSpec[] = [
  ['weapon_front_mg', 'left_front', { rotationQuarterTurns: 3, assignedActionSlot: 0 }],
  ['weapon_rear_mg', 'left_mid', { rotationQuarterTurns: 3 }],
  ['weapon_shotgun', 'left_rear', { rotationQuarterTurns: 3 }],
  ['weapon_foam', 'right_front', { rotationQuarterTurns: 1, assignedActionSlot: 1 }],
  ['weapon_air', 'right_mid', { rotationQuarterTurns: 1 }],
  ['weapon_tesla', 'right_rear'],
  ['utility_spare', 'roof_front'],
];
/** The ten-mount Platform, eight of them filled. */
const PLATFORM: PartSpec[] = [
  ['weapon_mine', 'deck_fore', { assignedActionSlot: 1 }],
  ['weapon_oil', 'deck_front', { assignedActionSlot: 0 }],
  ['weapon_rear_mg', 'left_edge_front', { rotationQuarterTurns: 3 }],
  ['utility_radar', 'left_edge_mid'],
  ['utility_minesensor', 'left_edge_rear'],
  ['weapon_tesla', 'right_edge_front'],
  ['utility_fan', 'right_edge_mid'],
  ['defense_heatguard', 'right_edge_rear'],
];
/** A saved build from an older catalog that is also over its frame's weight limit. */
const STALE: PartSpec[] = [
  ['weapon_turret', 'roof_mid', { assignedActionSlot: 0 }],
  ['weapon_hammer', 'front_center', { assignedActionSlot: 1 }],
  ['utility_nitro', 'left_utility'],
  ['utility_generator', 'right_utility'],
];

async function shot(page: Page, size: Size, name: string): Promise<void> {
  await page.waitForTimeout(450);
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
  const tile = (slot: string) => page.locator(`.slot-tile[data-slot="${slot}"]`);
  const row = (partId: string) => page.locator(`.part-card[data-part="${partId}"]`);
  const more = async (name: string | RegExp) => {
    await press('More');
    await page
      .getByRole('dialog', { name: 'More' })
      .getByRole('button', { name, exact: typeof name === 'string' })
      .click();
  };
  const openGarage = async () => {
    await page.goto(`${baseUrl}/${QUERY}`, { waitUntil: 'networkidle' });
    await press('Start Racing');
    await press('Build Your Car');
    await page.getByTestId('ready').waitFor();
    await page.locator('.g-car').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
  };
  /** Makes a car the player's last build, with the first-build tips already seen. */
  const seed = async (car: Record<string, unknown>) => {
    await page.evaluate((json) => {
      window.localStorage.setItem('bolt.blueprint.v1', json);
      window.localStorage.setItem(
        'bolt.tutorial.v1',
        JSON.stringify({ garage_tips: true, built: true }),
      );
    }, JSON.stringify(car));
  };

  await page.goto(`${baseUrl}/${QUERY}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 20_000 });
  const version = await page.evaluate(async () => {
    const response = await fetch('/api/v1/health');
    return ((await response.json()) as { catalogVersion: string }).catalogVersion;
  });

  // First visit: the three steps marked on their tiles.
  await openGarage();
  await shot(page, size, '01_first_visit');
  await tile('tires').click();
  await shot(page, size, '01b_first_visit_step_list');
  await page.getByTestId('car-stats').click();
  await press('Skip tips');
  await shot(page, size, '02_idle');

  // A slot selected with its list, then the compare pane.
  await tile('mount:roof_mid').click();
  await shot(page, size, '03_slot_list');
  await row('weapon_turret').click();
  await shot(page, size, '04_compare');
  await page.getByTestId('install').click();
  await shot(page, size, '05_weapon_card');
  await tile('mount:front_center').scrollIntoViewIfNeeded();
  await tile('mount:front_center').click();
  await row('weapon_front_mg').click();
  await page.getByTestId('install').click();
  await page.waitForTimeout(3800);
  await shot(page, size, '05b_second_weapon_card');
  await press('Rotate view');
  await shot(page, size, '06_view_rotated');
  await press('Rotate view');
  await shot(page, size, '06b_view_rotated_twice');
  await press('Rotate view');
  await press('Rotate view');

  // The essentials, the whole catalog, and the menu.
  await tile('chassis').scrollIntoViewIfNeeded();
  await tile('chassis').click();
  await shot(page, size, '07_chassis_list');
  await row('chassis_turtle').click();
  await shot(page, size, '07b_chassis_compare');
  await press('Parts');
  await more('Browse All Parts');
  await shot(page, size, '08_browse_all');
  await page.locator('.part-card.is-blocked').first().click();
  await shot(page, size, '08b_browse_no_mount');
  await press('Parts');
  await page.locator('.indicator[data-indicator="heat"]').click();
  await shot(page, size, '09_indicator_detail');
  await press('Close');
  await press('More');
  await shot(page, size, '10_more_menu');
  await press('Close');

  // Frames with many mounts.
  await seed(blueprint('Full Crab', { chassisId: 'chassis_crab' }, CRAB, version));
  await openGarage();
  await shot(page, size, '11_crab_loaded');
  await tile('mount:right_mid').scrollIntoViewIfNeeded();
  await tile('mount:right_mid').click();
  await shot(page, size, '11b_crab_part_selected');
  await press('Rotate view');
  await shot(page, size, '11c_crab_rotated');
  await seed(
    blueprint(
      'Full Platform',
      { chassisId: 'chassis_platform', engineId: 'engine_v6', paintId: 'paint_cobalt' },
      PLATFORM,
      version,
    ),
  );
  await openGarage();
  await shot(page, size, '12_platform');
  await tile('mount:deck_aft').scrollIntoViewIfNeeded();
  await tile('mount:deck_aft').click();
  await shot(page, size, '12b_platform_slot_list');

  // An illegal build: an old saved car opened for review.
  await page.evaluate(
    (json) =>
      window.localStorage.setItem(
        'bolt.blueprints.v1',
        JSON.stringify({
          version: 1,
          items: [
            { id: 'bstale', savedAt: '2026-09-01T10:00:00.000Z', blueprint: JSON.parse(json) },
          ],
        }),
      ),
    JSON.stringify(
      blueprint(
        'Old Faithful',
        {
          chassisId: 'chassis_beetle',
          engineId: 'engine_v8',
          tireKitId: 'tires_armored',
          paintId: 'paint_cobalt',
        },
        STALE,
        '0.2.0',
      ),
    ),
  );
  await page.goto(`${baseUrl}/${QUERY}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'My Blueprints' }).click();
  await press('Review');
  await page.getByTestId('ready').waitFor();
  await page.locator('.g-car').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await shot(page, size, '13_illegal_build');
  await page.getByTestId('ready').click({ force: true });
  await shot(page, size, '13b_illegal_ready_pressed');
  await page.locator('.indicator[data-indicator="load"]').click();
  await shot(page, size, '13c_illegal_load_detail');
  await press('Close');

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
