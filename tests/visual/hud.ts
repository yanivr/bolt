import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import type { HudBuild } from './hudBuilds.js';
import { ARMED_BEETLE, HOT_ARROW, SENSOR_SPIDER, hudBlueprint } from './hudBuilds.js';

/**
 * Screenshots of the race HUD, the results screen and the garage's firing cones for design
 * review, at the sizes they have to work at: the product owner's phone inside its host page
 * (870 x 370), a small bare landscape phone (667 x 375) and a desktop (1440 x 900).
 *
 *   pnpm build && PORT=2673 node apps/server/dist/main.js &
 *   npx tsx tests/visual/hud.ts http://localhost:2673 tests/visual/out/hud [sizes] [shots]
 *
 * `sizes` is a comma-separated list of size names; `shots` a comma-separated list of shot
 * groups (`race`, `garage`). Both default to everything.
 *
 * States that a real race reaches only by luck (thermal protection, a missile inbound on the
 * local car, heavy damage) are set up with the HUD's debug override (`?debug=1`,
 * `window.__boltDebug.hud`), which changes what a snapshot says before the HUD reads it. The
 * HUD's own rules still decide everything that is drawn.
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/hud');
const onlySizes = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : null;
const onlyShots = process.argv[5] ? process.argv[5].split(',') : null;
mkdirSync(outDir, { recursive: true });

type Size = { name: string; width: number; height: number; mobile: boolean };
const SIZES: Size[] = [
  { name: '870x370', width: 870, height: 370, mobile: true },
  { name: '667x375', width: 667, height: 375, mobile: true },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
];

type Override = Record<string, unknown>;

async function shot(page: Page, size: Size, name: string, wait = 350): Promise<void> {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${size.name}_${name}.png`), timeout: 180_000 });
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

  await page.goto(`${baseUrl}/?debug=1`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 20_000 });
  const version = await page.evaluate(async () => {
    const response = await fetch('/api/v1/health');
    return ((await response.json()) as { catalogVersion: string }).catalogVersion;
  });

  /** Makes a car the player's last build and sets the settings for the next page load. */
  const seed = async (build: HudBuild, settings: Record<string, unknown> = {}) => {
    await page.evaluate(
      ([car, prefs]) => {
        window.localStorage.setItem('bolt.blueprint.v1', car!);
        window.localStorage.setItem('bolt.settings.v1', prefs!);
        window.localStorage.setItem(
          'bolt.tutorial.v1',
          JSON.stringify({ garage_tips: true, built: true, steered: true }),
        );
      },
      [JSON.stringify(hudBlueprint(build, version)), JSON.stringify(settings)],
    );
  };
  /** From the home screen to the grid with the seeded car. */
  const toGrid = async (query: string) => {
    await page.goto(`${baseUrl}/${query}`, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 30_000 });
    await press('Start Racing');
    await press('Build Your Car');
    await page.getByTestId('ready').click();
    await page.locator('.hud').waitFor({ timeout: 40_000 });
  };
  const racing = async () => {
    await page
      .locator('.hud-clock canvas:not([aria-label="0:00.00"])')
      .waitFor({ timeout: 30_000 });
  };
  /** Waits for a race time: a scenario runs with the frames drawn, not with the wall clock. */
  const untilRaceTime = async (seconds: number) => {
    await page
      .waitForFunction(
        (s) => {
          const label =
            document.querySelector('.hud-clock canvas')?.getAttribute('aria-label') ?? '0:00.00';
          const [minutes, rest] = label.split(':');
          return Number(minutes) * 60 + Number(rest) >= s;
        },
        seconds,
        { timeout: 240_000, polling: 250 },
      )
      .catch(() => undefined);
  };
  const override = (changes: Override | null) =>
    page.evaluate((o) => {
      const debug = (
        window as unknown as { __boltDebug: { hud: { override: (c: unknown) => void } } }
      ).__boltDebug;
      debug.hud.override(o);
    }, changes);
  /** Part index, and component index, of a mounted part by its catalog id. */
  const partsById = async (): Promise<Record<string, { part: number; component: number }>> =>
    page.evaluate(() => {
      const debug = (
        window as unknown as {
          __boltDebug: {
            hud: { parts: () => Array<{ part: number; component: number; id: string }> };
          };
        }
      ).__boltDebug;
      return Object.fromEntries(debug.hud.parts().map((p) => [p.id, p]));
    });
  const componentByName = async (name: string): Promise<number> =>
    page.evaluate((wanted) => {
      const debug = (
        window as unknown as {
          __boltDebug: { hud: { components: () => Array<{ index: number; name: string }> } };
        }
      ).__boltDebug;
      return debug.hud.components().find((c) => c.name === wanted)?.index ?? -1;
    }, name);
  const event = (body: Override) =>
    page.evaluate((b) => {
      const debug = (window as unknown as { __boltDebug: { hud: { event: (c: unknown) => void } } })
        .__boltDebug;
      debug.hud.event(b);
    }, body);

  if (!onlyShots || onlyShots.includes('race')) {
    // --- Countdown and the idle HUD with a fully armed car ---------------------------------
    await seed(ARMED_BEETLE);
    await toGrid('?debug=1&rival=starter_longlegs&seed=7');
    await shot(page, size, '01_countdown', 500);
    await racing();
    await shot(page, size, '02_idle_armed_beetle', 900);

    // Driving: the autopilot build of the same race, a few seconds in.
    await toGrid('?debug=1&autopilot=1&rival=starter_longlegs&seed=7');
    await racing();
    await page.waitForTimeout(5200);
    await shot(page, size, '03_driving');

    // --- Mid-combat: damage on several parts, statuses, a callout --------------------------
    const ids = await partsById();
    const rocket = ids.weapon_rocket!;
    const seeker = ids.weapon_homing!;
    const sentry = ids.weapon_rear_mg!;
    const nitro = ids.utility_nitro!;
    const frontLeft = await componentByName('Front left wheel');
    const rearRight = await componentByName('Rear right wheel');
    const damaged = {
      chassis: 58,
      integrity: {
        0: 44,
        [frontLeft]: 0,
        [rearRight]: 52,
        [sentry.component]: 12,
        [seeker.component]: 55,
      },
      armor: [0, 0, 0, 0],
    };
    await override({
      ...damaged,
      statuses: [
        { family: 'burn', ticks: 70 },
        { family: 'slow', ticks: 45, magnitude: 0.3 },
        { family: 'boost', ticks: 30 },
      ],
      cooldown: { [rocket.part]: [26, 48] },
      charges: { [rocket.part]: 2, [seeker.part]: 1 },
      position: 2,
      gapSeconds: -1.4,
    });
    await page.waitForTimeout(300);
    await event({
      type: 'component',
      car: 0,
      component: frontLeft,
      condition: 'disabled',
      integrity: 0,
      repaired: false,
    });
    await event({
      type: 'hit',
      car: 0,
      by: 1,
      weapon: 'weapon_shotgun',
      cls: 'bullet',
      x: 0,
      y: 0,
      component: 0,
      damage: 9,
      chassis: 3,
      shield: 0,
      armor: 0,
      absorbed: 0,
      projectile: 0,
    });
    await shot(page, size, '04_mid_combat_damage_statuses', 420);

    // --- Thermal protection: weapons that make heat are locked ----------------------------
    await override({ ...damaged, coreHeat: 112, thermalLimited: true });
    await shot(page, size, '05_overheat', 700);

    // --- Out of ammunition on both buttons, the nitro spent --------------------------------
    await override({ charges: { [rocket.part]: 0, [seeker.part]: 0, [nitro.part]: 0 } });
    await shot(page, size, '06_out_of_ammo', 700);

    // --- Electronics down ------------------------------------------------------------------
    await override({
      statuses: [
        { family: 'emp', ticks: 40 },
        { family: 'immune', ticks: 100 },
      ],
    });
    await shot(page, size, '07_emp', 500);

    // --- A missile inbound from behind, the rival off screen -------------------------------
    await override({
      lockWarning: 2,
      rivalOffset: { x: 620, y: 260 },
      rivalTracked: true,
      missileOffset: { x: 300, y: 420 },
      gapMeters: 85,
      gapSeconds: 2.3,
      position: 1,
    });
    await event({ type: 'warning', car: 0, kind: 'missile', by: 1, value: 12 });
    await shot(page, size, '08_missile_incoming', 250);
    await override({
      lockWarning: 1,
      rivalOffset: { x: -700, y: -120 },
      rivalTracked: true,
      gapMeters: -32,
      gapSeconds: -0.9,
      position: 2,
    });
    await shot(page, size, '09_lock_warning_rival_ahead', 500);

    // --- The rival off screen, nothing else going on ----------------------------------------
    await override({
      rivalOffset: { x: 80, y: -640 },
      rivalTracked: true,
      gapMeters: -85,
      gapSeconds: -2.6,
      position: 2,
    });
    await shot(page, size, '10_offscreen_rival_arrow', 500);
    await override(null);

    // --- Pause -----------------------------------------------------------------------------
    await press('Settings');
    await shot(page, size, '11_pause', 400);
    await page.getByRole('button', { name: 'Resume' }).click();

    // --- Left-handed layout ----------------------------------------------------------------
    await seed(ARMED_BEETLE, { drivingHand: 'right' });
    await toGrid('?debug=1&rival=starter_longlegs&seed=7');
    await racing();
    await shot(page, size, '12_left_handed', 900);

    // --- Larger buttons --------------------------------------------------------------------
    await seed(ARMED_BEETLE, { hudScale: 'large' });
    await toGrid('?debug=1&rival=starter_longlegs&seed=7');
    await racing();
    await shot(page, size, '13_larger_buttons', 900);

    // --- Sensors: Radar and Mine Detector, three equipment buttons, a trap warning ----------
    await seed(SENSOR_SPIDER);
    await toGrid('?debug=1&scenario=mine_sweeper');
    await racing();
    await page
      .locator('[data-testid="warning"][data-kind="trap"]')
      .waitFor({ timeout: 240_000 })
      .catch(() => undefined);
    await shot(page, size, '14_trap_warning_scenario', 0);

    // --- A railgun charging, in a real scenario --------------------------------------------
    await toGrid('?debug=1&scenario=weapon_railshot');
    await racing();
    await page
      .locator(
        '[data-testid="fire-0"][data-phase="charging"], [data-testid="fire-1"][data-phase="charging"]',
      )
      .first()
      .waitFor({ timeout: 240_000 })
      .catch(() => undefined);
    await shot(page, size, '15_railgun_charging', 0);

    // --- Repairs, in a real scenario: a destroyed wheel and a critical engine ---------------
    await toGrid('?debug=1&scenario=repair_burst');
    await racing();
    await shot(page, size, '16_repair_scenario_start', 200);
    await page
      .locator('.car-seg[data-repairs="1"]')
      .first()
      .waitFor({ state: 'attached', timeout: 240_000 })
      .catch(() => undefined);
    await shot(page, size, '17_repair_scenario_wheel_replaced', 0);

    // --- Results: a scripted scenario, shown through the debug hook ------------------------
    await toGrid('?debug=1&scenario=rocket_hit');
    await racing();
    await untilRaceTime(8.2);
    await page.evaluate(() =>
      (
        window as unknown as { __boltDebug: { hud: { showResults: () => void } } }
      ).__boltDebug.hud.showResults(),
    );
    await shot(page, size, '18_results_scenario_preview', 500);

    // A hot car, for the heat warning before protection.
    await seed(HOT_ARROW);
    await toGrid('?debug=1&rival=starter_longlegs&seed=7');
    await racing();
    await override({ coreHeat: 96 });
    await shot(page, size, '19_engine_hot_arrow', 900);
    await override(null);
  }

  if (!onlyShots || onlyShots.includes('garage')) {
    // --- The garage: what each weapon covers, on the floor under the car --------------------
    const tile = (slot: string) => page.locator(`.slot-tile[data-slot="${slot}"]`);
    const openGarage = async () => {
      await page.goto(`${baseUrl}/?debug=1&buildSeconds=900`, { waitUntil: 'load' });
      await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 30_000 });
      await press('Start Racing');
      await press('Build Your Car');
      await page.getByTestId('ready').waitFor();
      await page.locator('.g-car').waitFor({ state: 'visible' });
      await page.waitForTimeout(400);
    };
    const cones: Array<[name: string, build: HudBuild, slot: string]> = [
      [
        'front_mg_cone',
        {
          ...ARMED_BEETLE,
          parts: [['weapon_front_mg', 'front_center', { assignedActionSlot: 0 }]],
        },
        'mount:front_center',
      ],
      [
        'turret_circle',
        { ...ARMED_BEETLE, parts: [['weapon_turret', 'roof_mid', { assignedActionSlot: 0 }]] },
        'mount:roof_mid',
      ],
      [
        'shotgun_facing_right',
        {
          ...ARMED_BEETLE,
          parts: [
            ['weapon_shotgun', 'roof_mid', { assignedActionSlot: 0, rotationQuarterTurns: 1 }],
          ],
        },
        'mount:roof_mid',
      ],
      [
        'mine_drop_zone',
        {
          ...ARMED_BEETLE,
          parts: [
            ['weapon_mine', 'rear_center', { assignedActionSlot: 0, rotationQuarterTurns: 2 }],
          ],
        },
        'mount:rear_center',
      ],
      [
        'oil_strip',
        {
          ...ARMED_BEETLE,
          parts: [
            ['weapon_oil', 'rear_center', { assignedActionSlot: 0, rotationQuarterTurns: 2 }],
          ],
        },
        'mount:rear_center',
      ],
      [
        'mortar_ring',
        {
          ...ARMED_BEETLE,
          chassisId: 'chassis_pickup',
          paintId: 'paint_sunflare',
          parts: [['weapon_mortar', 'bed_rear', { autoMode: true }]],
        },
        'mount:bed_rear',
      ],
      [
        'saw_side_sweep',
        {
          ...SENSOR_SPIDER,
          parts: [['weapon_saw', 'left_front', { rotationQuarterTurns: 3 }]],
        },
        'mount:left_front',
      ],
      [
        'foam_lob_rear',
        {
          ...ARMED_BEETLE,
          parts: [['weapon_foam', 'roof_mid', { assignedActionSlot: 0, rotationQuarterTurns: 2 }]],
        },
        'mount:roof_mid',
      ],
      [
        'railgun_narrow',
        { ...HOT_ARROW, parts: [['weapon_railshot', 'roof_mid', { assignedActionSlot: 0 }]] },
        'mount:roof_mid',
      ],
    ];
    for (const [name, build, slot] of cones) {
      await seed(build);
      await openGarage();
      await tile(slot).click();
      await page.getByTestId('part-coverage').waitFor({ timeout: 10_000 });
      await shot(page, size, `30_cone_${name}`, 500);
    }
    // The same cone after the view is turned, and after the part is turned.
    await seed({
      ...ARMED_BEETLE,
      parts: [['weapon_shotgun', 'roof_mid', { assignedActionSlot: 0 }]],
    });
    await openGarage();
    await tile('mount:roof_mid').click();
    await press('Rotate view');
    await shot(page, size, '31_cone_shotgun_view_turned', 500);
    await page.getByTestId('face-3').click();
    await shot(page, size, '32_cone_shotgun_facing_left', 500);

    // --- Focus dimming: a part, the engine, an empty mount ---------------------------------
    await seed(ARMED_BEETLE);
    await openGarage();
    await shot(page, size, '33_overview_not_dimmed', 300);
    await tile('mount:left_utility').click();
    await shot(page, size, '34_focus_dim_part', 500);
    await tile('engine').click();
    await shot(page, size, '35_focus_dim_engine', 500);
    await seed({ ...ARMED_BEETLE, parts: ARMED_BEETLE.parts.slice(0, 2) });
    await openGarage();
    await tile('mount:rear_center').click();
    await shot(page, size, '36_focus_dim_empty_mount', 500);
  }

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
  for (const size of SIZES) {
    if (onlySizes && !onlySizes.includes(size.name)) continue;
    try {
      await capture(browser, size, problems);
    } catch (error) {
      problems.push(`${size.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await browser.close();
  console.log(JSON.stringify({ outDir, problems }, null, 2));
}

await main();
