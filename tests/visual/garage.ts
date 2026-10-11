import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * Screenshots of the garage for design review, at the sizes it has to work at: the product
 * owner's phone inside its host page (870 x 370 landscape, 450 x 840 portrait), a small bare
 * landscape phone (667 x 375) and a desktop.
 *
 *   pnpm build && PORT=2671 node apps/server/dist/main.js &
 *   npx tsx tests/visual/garage.ts http://localhost:2671 tests/visual/out/garage [sizes]
 *
 * At every size: the idle overview of each of the five chassis, each of them fully loaded in
 * both main views, focus on a roof weapon, focus
 * on an outer mount of the Spider, focus with the part nudged and turned, the engine in
 * focus, the compare pane, Browse All Parts, the idle Your Car panel and an illegal build.
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

/** One bare car for each chassis, on its default engine, in a paint of its own. */
const FIVE: Array<[name: string, chassisId: string, engineId: string, paintId: string]> = [
  ['beetle', 'chassis_beetle', 'engine_four_cylinder', 'paint_signal'],
  ['arrow', 'chassis_arrow', 'engine_four_cylinder', 'paint_cobalt'],
  ['pickup', 'chassis_pickup', 'engine_four_cylinder', 'paint_sunflare'],
  ['spider', 'chassis_spider', 'engine_four_cylinder', 'paint_mint'],
  ['trike', 'chassis_trike', 'engine_mini_electric', 'paint_signal'],
];
/** The eight-mount Spider with seven of them filled. */
const SPIDER: PartSpec[] = [
  ['utility_minesensor', 'front_utility'],
  ['weapon_front_mg', 'left_front', { assignedActionSlot: 0 }],
  ['weapon_tesla', 'right_front'],
  ['utility_radar', 'roof_front'],
  ['utility_spare', 'roof_mid'],
  ['weapon_rear_mg', 'left_rear'],
  ['utility_repair', 'rear_utility'],
];
/** The Pickup with its bed in use: two utilities on the rack and the mortar on the floor. */
const PICKUP: PartSpec[] = [
  ['utility_radar', 'roof_cab'],
  ['utility_repair', 'bed_front', { offsetX: -5 }],
  ['utility_battery', 'bed_front', { offsetX: 5 }],
  ['weapon_rear_mg', 'left_bed', { rotationQuarterTurns: 2 }],
  ['weapon_mortar', 'bed_rear', { autoMode: true }],
  ['defense_rear_bumper', 'rear_center', { rotationQuarterTurns: 2 }],
];
/** Every mount of each chassis filled, to check that a full car still reads as a car. */
const LOADED: Array<
  [name: string, chassisId: string, engineId: string, paintId: string, parts: PartSpec[]]
> = [
  [
    'beetle',
    'chassis_beetle',
    'engine_four_cylinder',
    'paint_signal',
    [
      ['weapon_front_mg', 'front_center', { assignedActionSlot: 0 }],
      ['weapon_homing', 'roof_mid', { assignedActionSlot: 1 }],
      ['utility_spare', 'left_utility'],
      ['utility_capacitor', 'right_utility'],
      ['weapon_mine', 'rear_center', { rotationQuarterTurns: 2 }],
    ],
  ],
  [
    'arrow',
    'chassis_arrow',
    'engine_four_cylinder',
    'paint_cobalt',
    [
      ['weapon_harpoon', 'front_center', { assignedActionSlot: 0 }],
      ['weapon_railshot', 'roof_mid', { assignedActionSlot: 1 }],
      ['utility_fan', 'roof_rear'],
      ['weapon_oil', 'rear_center', { rotationQuarterTurns: 2 }],
    ],
  ],
  [
    'pickup',
    'chassis_pickup',
    'engine_four_cylinder',
    'paint_sunflare',
    [
      ['utility_radar', 'roof_cab'],
      ['utility_repair', 'bed_front', { offsetX: -5 }],
      ['utility_battery', 'bed_front', { offsetX: 5 }],
      ['weapon_rear_mg', 'left_bed', { rotationQuarterTurns: 3 }],
      ['weapon_shotgun', 'right_bed', { rotationQuarterTurns: 1, assignedActionSlot: 0 }],
      ['weapon_mortar', 'bed_rear', { autoMode: true }],
      ['defense_rear_bumper', 'rear_center', { rotationQuarterTurns: 2 }],
    ],
  ],
  [
    'spider',
    'chassis_spider',
    'engine_four_cylinder',
    'paint_mint',
    [
      // Exactly the 1,000 credits: eight mounts filled on the most expensive frame.
      ['utility_radar', 'front_utility'],
      ['weapon_saw', 'left_front', { rotationQuarterTurns: 3 }],
      ['weapon_front_mg', 'right_front', { rotationQuarterTurns: 0, assignedActionSlot: 0 }],
      ['weapon_shotgun', 'roof_front', { assignedActionSlot: 1 }],
      ['utility_spare', 'roof_mid'],
      ['defense_side_panels', 'left_rear', { rotationQuarterTurns: 3 }],
      ['defense_light_plate', 'right_rear', { rotationQuarterTurns: 1 }],
      ['utility_fan', 'rear_utility'],
    ],
  ],
  [
    'trike',
    'chassis_trike',
    'engine_mini_electric',
    'paint_signal',
    [
      ['weapon_shotgun', 'front_center', { assignedActionSlot: 0 }],
      ['weapon_frost', 'roof_mid', { rotationQuarterTurns: 1, assignedActionSlot: 1 }],
      ['weapon_rear_mg', 'left_rear', { rotationQuarterTurns: 2 }],
      ['utility_repair', 'right_rear'],
    ],
  ],
];
/** A saved build from an older catalog that is also over its frame's weight limit. */
const STALE: PartSpec[] = [
  ['weapon_turret', 'roof_mid', { assignedActionSlot: 0 }],
  ['weapon_hammer', 'front_center', { assignedActionSlot: 1, rotationQuarterTurns: 1 }],
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
  await shot(page, size, '00_first_visit');
  await page.getByTestId('car-stats').click();
  await press('Skip tips');

  // The idle overview of each of the five chassis.
  for (const [name, chassisId, engineId, paintId] of FIVE) {
    await seed(blueprint(name, { chassisId, engineId, paintId }, [], version));
    await openGarage();
    await shot(page, size, `01_overview_${name}`);
  }

  // Every mount of each chassis filled, in both main views, with Ready allowed.
  for (const [name, chassisId, engineId, paintId, parts] of LOADED) {
    await seed(blueprint(`Full ${name}`, { chassisId, engineId, paintId }, parts, version));
    await openGarage();
    await shot(page, size, `14_loaded_${name}`);
    await press('Rotate view');
    await shot(page, size, `14b_loaded_${name}_view_turned`);
  }

  // A Beetle: an empty roof slot in focus, the compare pane, then a roof weapon in focus.
  await seed(blueprint('Beetle', { chassisId: 'chassis_beetle' }, [], version));
  await openGarage();
  await tile('mount:roof_mid').click();
  await shot(page, size, '02_focus_empty_roof_slot');
  await row('weapon_rocket').click();
  await shot(page, size, '03_compare_pane');
  await page.getByTestId('install').click();
  await page.waitForTimeout(3800);
  await shot(page, size, '04_focus_roof_weapon');
  // The same weapon nudged forward and turned to face right with the direction picker.
  await press('Move forward');
  await press('Move forward');
  await press('Move left');
  await page.getByTestId('face-1').click();
  await page.waitForTimeout(3800);
  await shot(page, size, '05_focus_nudged_rotated');
  await press('Rotate view');
  await shot(page, size, '05b_focus_nudged_view_turned');
  await press('Rotate view');
  await press('Rotate view');
  await press('Rotate view');
  // A front gun, then the engine in focus.
  await tile('mount:front_center').click();
  await row('weapon_front_mg').click();
  await page.getByTestId('install').click();
  await page.waitForTimeout(3800);
  await shot(page, size, '04b_focus_front_weapon');
  await tile('engine').click();
  await shot(page, size, '06_focus_engine');
  await tile('tires').click();
  await shot(page, size, '06b_wheels_whole_car');
  // The idle panel with equipment, then the whole catalog.
  await page.getByTestId('car-stats').click();
  await shot(page, size, '07_idle_your_car');
  await more('Browse All Parts');
  await shot(page, size, '08_browse_all');
  await page.locator('.part-card.is-blocked').first().click();
  await shot(page, size, '08b_browse_no_mount');
  await press('Parts');
  await page.locator('.indicator[data-indicator="heat"]').click();
  await shot(page, size, '09_indicator_detail');
  await press('Close');
  await tile('chassis').click();
  await shot(page, size, '10_chassis_list');
  await row('chassis_pickup').click();
  await shot(page, size, '10b_chassis_compare');

  // The Spider, loaded: the overview, then its outer mounts in focus.
  await seed(
    blueprint(
      'Full Spider',
      { chassisId: 'chassis_spider', paintId: 'paint_mint' },
      SPIDER,
      version,
    ),
  );
  await openGarage();
  await shot(page, size, '11_spider_loaded');
  await tile('mount:left_front').click();
  await shot(page, size, '11b_spider_focus_left_front');
  await tile('mount:right_rear').click();
  await shot(page, size, '11c_spider_focus_right_rear_empty');
  await tile('mount:front_utility').click();
  await shot(page, size, '11d_spider_focus_front_utility');
  await tile('mount:rear_utility').click();
  await shot(page, size, '11e_spider_focus_rear_utility');
  await press('Rotate view');
  await shot(page, size, '11f_spider_focus_view_turned');
  await tile('engine').click();
  await shot(page, size, '11g_spider_engine');

  // The Pickup with its bed in use, and the two bay-engined frames with their engines.
  await seed(
    blueprint(
      'Full Pickup',
      { chassisId: 'chassis_pickup', paintId: 'paint_sunflare' },
      PICKUP,
      version,
    ),
  );
  await openGarage();
  await shot(page, size, '12_pickup_loaded');
  await tile('mount:bed_rear').click();
  await shot(page, size, '12b_pickup_focus_bed_mortar');
  await tile('mount:bed_front').click();
  await shot(page, size, '12c_pickup_focus_rack');
  await tile('mount:roof_cab').click();
  await shot(page, size, '12d_pickup_focus_cab_roof');
  await tile('engine').click();
  await shot(page, size, '12e_pickup_engine');
  await seed(
    blueprint('Trike', { chassisId: 'chassis_trike', engineId: 'engine_rotary' }, [], version),
  );
  await openGarage();
  await tile('mount:left_rear').click();
  await shot(page, size, '12f_trike_focus_left_rear');
  await tile('engine').click();
  await shot(page, size, '12g_trike_engine');

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
        '0.3.0',
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
