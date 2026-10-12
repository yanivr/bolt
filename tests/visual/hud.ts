import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import type { HudBuild } from './hudBuilds.js';
import { ARMED_BEETLE, HOT_ARROW, SENSOR_SPIDER, hudBlueprint } from './hudBuilds.js';

/**
 * Screenshots of the race HUD, the results screen and the garage's firing cones for design
 * review, at the sizes they have to work at: the product owner's phone inside its host page
 * (870 x 370 at three device pixels), a small bare landscape phone (667 x 375 at two), an
 * iPhone 14 in landscape (844 x 390 at three) and, when asked for, a desktop (1440 x 900).
 *
 *   pnpm build && PORT=2675 node apps/server/dist/main.js &
 *   npx tsx tests/visual/hud.ts http://localhost:2675 tests/visual/out/hud [sizes] [shots]
 *
 * `sizes` is a comma-separated list of size names, or `all` (the three phones by default); `shots` a comma-separated list of shot
 * groups (`compare`, `race`, `scenarios`, `medium`, `garage`). Both default to everything.
 *
 * Most race shots are taken in the offline test drive (the page is told the server cannot be
 * reached) on the manual clock (`manual=1`), so the race stands still between shots and the
 * same frame can be captured in each `Camera` setting, and again from an older build for a
 * before and after (`compare`; join the two with `tests/visual/sheet.ts`).
 *
 * States that a real race reaches only by luck (thermal protection, a missile inbound on the
 * local car, heavy damage, the tow) are set up with the HUD's debug override (`?debug=1`,
 * `window.__boltDebug.hud`), which changes what a snapshot says before the HUD reads it. The
 * HUD's own rules still decide everything that is drawn.
 */

/** Sizes taken when none are named: the three phone sizes of the slim-HUD brief. */
const DEFAULT_SIZES = ['870x370', '667x375', '844x390'];

const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/hud');
const onlySizes =
  process.argv[4] === 'all' ? null : process.argv[4] ? process.argv[4].split(',') : DEFAULT_SIZES;
const onlyShots = process.argv[5] ? process.argv[5].split(',') : null;
mkdirSync(outDir, { recursive: true });

type Size = { name: string; width: number; height: number; mobile: boolean; dpr: number };
const SIZES: Size[] = [
  { name: '870x370', width: 870, height: 370, mobile: true, dpr: 3 },
  { name: '667x375', width: 667, height: 375, mobile: true, dpr: 2 },
  { name: '844x390', width: 844, height: 390, mobile: true, dpr: 3 },
  { name: '1440x900', width: 1440, height: 900, mobile: false, dpr: 1 },
];

type Override = Record<string, unknown>;
type DebugHost = {
  __boltRace?: { advance: (frames: number) => void; pending: () => number; view?: () => unknown };
  __boltDebug: {
    hud: {
      override: (changes: unknown) => void;
      event: (body: unknown) => void;
      showResults: () => void;
      parts: () => Array<{ part: number; component: number; id: string }>;
      components: () => Array<{ index: number; name: string }>;
    };
  };
};

/** The offline drive every deterministic shot is taken in. */
const OFFLINE = '?debug=1&manual=1&autopilot=1&rival=starter_longlegs&seed=7';
/** Frames from the grid to the moment the camera modes and the comparison are captured at. */
const MOMENT_FRAMES = 200 + 430;

async function shot(page: Page, size: Size, name: string, wait = 350): Promise<void> {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${size.name}_${name}.png`), timeout: 180_000 });
}

async function capture(browser: Browser, size: Size, problems: string[]): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
    hasTouch: size.mobile,
    isMobile: size.mobile,
  });
  const page = await context.newPage();
  let offline = false;
  await page.route('**/api/v1/health', (route) => (offline ? route.abort() : route.continue()));
  page.on('console', (m) => {
    // A refused health check is how the offline drive is asked for.
    if (m.type() === 'error' && !(offline && /ERR_FAILED|Failed to load resource/.test(m.text())))
      problems.push(`${size.name} console: ${m.text()}`);
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
  const toGrid = async (query: string, server = true) => {
    offline = false;
    await page.goto(`${baseUrl}/${query}`, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Start Racing' }).waitFor({ timeout: 30_000 });
    await press('Start Racing');
    await press('Build Your Car');
    offline = !server;
    await page.getByTestId('ready').click();
    await page.locator('.hud').waitFor({ timeout: 40_000 });
    // The two debug text lines are for tests; they are not part of what is being reviewed.
    await page.addStyleTag({ content: '.debug-block { visibility: hidden; }' });
  };
  const racing = async () => {
    await page
      .locator('.hud-clock canvas:not([aria-label="0:00.00"])')
      .waitFor({ timeout: 30_000 });
  };
  /** Manual clock: runs this many 60 Hz frames and waits until they are drawn. */
  const step = async (frames: number) => {
    await page.evaluate((n) => (window as unknown as DebugHost).__boltRace?.advance(n), frames);
    await page.waitForFunction(
      () => ((window as unknown as DebugHost).__boltRace?.pending() ?? 0) === 0,
      undefined,
      { timeout: 240_000, polling: 100 },
    );
    await page.waitForTimeout(120);
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
    page.evaluate((o) => (window as unknown as DebugHost).__boltDebug.hud.override(o), changes);
  /** Sets the override and lets a few snapshots through, so the HUD has read it. */
  const state = async (changes: Override | null) => {
    await override(changes);
    await step(6);
  };
  /** Part index, and component index, of a mounted part by its catalog id. */
  const partsById = async (): Promise<Record<string, { part: number; component: number }>> =>
    page.evaluate(() =>
      Object.fromEntries(
        (window as unknown as DebugHost).__boltDebug.hud.parts().map((p) => [p.id, p]),
      ),
    );
  const componentByName = async (name: string): Promise<number> =>
    page.evaluate(
      (wanted) =>
        (window as unknown as DebugHost).__boltDebug.hud.components().find((c) => c.name === wanted)
          ?.index ?? -1,
      name,
    );
  const event = (body: Override) =>
    page.evaluate((b) => (window as unknown as DebugHost).__boltDebug.hud.event(b), body);
  /** Chooses a `Camera` setting in the pause menu, as a player would. */
  const camera = async (label: 'Close' | 'Medium' | 'Far') => {
    await press('Settings');
    await page
      .getByRole('radiogroup', { name: 'Camera' })
      .getByText(label, { exact: true })
      .click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await step(2);
    await page.waitForTimeout(400);
  };
  const hasCameraSetting = async () => {
    await press('Settings');
    const there = (await page.getByRole('radiogroup', { name: 'Camera' }).count()) > 0;
    await page.getByRole('button', { name: 'Resume' }).click();
    return there;
  };

  if (!onlyShots || onlyShots.includes('compare')) {
    // The frame used for the before and after: the offline drive, the armed car, in a bend.
    await seed(ARMED_BEETLE);
    await toGrid(OFFLINE, false);
    await step(MOMENT_FRAMES);
    await shot(page, size, '00_compare');
  }

  if (!onlyShots || onlyShots.includes('race')) {
    // --- The start, on the server -----------------------------------------------------------
    await seed(ARMED_BEETLE);
    await toGrid('?debug=1&rival=starter_longlegs&seed=7');
    await shot(page, size, '01_countdown', 500);
    await racing();
    await shot(page, size, '02_idle_armed_beetle', 900);

    // --- The same frame in each Camera setting ----------------------------------------------
    await toGrid(OFFLINE, false);
    await step(MOMENT_FRAMES);
    if (await hasCameraSetting()) {
      for (const [index, label] of (['Close', 'Medium', 'Far'] as const).entries()) {
        await camera(label);
        const view = await page.evaluate(
          () => (window as unknown as DebugHost).__boltRace?.view?.() ?? null,
        );
        console.log(`${size.name} ${label}: ${JSON.stringify(view)}`);
        await shot(page, size, `2${index}_camera_${label.toLowerCase()}`, 200);
      }
      await camera('Close');
    }

    // --- The car's condition ----------------------------------------------------------------
    const ids = await partsById();
    const rocket = ids.weapon_rocket!;
    const seeker = ids.weapon_homing!;
    const sentry = ids.weapon_rear_mg!;
    const nitro = ids.utility_nitro!;
    const frontLeft = await componentByName('Front left wheel');
    const rearRight = await componentByName('Rear right wheel');
    const hit = (component: number) =>
      event({
        type: 'hit',
        car: 0,
        by: 1,
        weapon: 'weapon_shotgun',
        cls: 'bullet',
        x: 0,
        y: 0,
        component,
        damage: 9,
        chassis: 3,
        shield: 0,
        armor: 0,
        absorbed: 0,
        projectile: 0,
      });

    // A hit on a wheel: the diagram comes up beside the bars with that wheel flashing.
    await state({ chassis: 84, integrity: { [frontLeft]: 58 } });
    await page.waitForTimeout(2200);
    await hit(frontLeft);
    await shot(page, size, '30_hit_diagram_pops', 180);
    // The wheel is gone: once the diagram has left, its icon stays.
    await state({ chassis: 71, integrity: { [frontLeft]: 0 } });
    await shot(page, size, '31_wheel_destroyed_diagram', 200);
    await shot(page, size, '32_wheel_destroyed_icon_stays', 2400);
    // More broken, and things acting on the car.
    const damaged = {
      chassis: 48,
      integrity: {
        0: 14,
        [frontLeft]: 0,
        [rearRight]: 52,
        [sentry.component]: 12,
        [seeker.component]: 55,
      },
      armor: [0, 0, 0, 0],
    };
    await state({
      ...damaged,
      statuses: [
        { family: 'burn', ticks: 70 },
        { family: 'slow', ticks: 45, magnitude: 0.3 },
      ],
      cooldown: { [rocket.part]: [26, 48] },
      charges: { [rocket.part]: 2, [seeker.part]: 1 },
      position: 2,
      gapSeconds: -1.4,
    });
    await shot(page, size, '33_damage_and_statuses', 2400);

    // --- Thermal protection, low power, the tow ---------------------------------------------
    await state({ coreHeat: 112, thermalLimited: true });
    await shot(page, size, '34_overheat', 2400);
    await state({ battery: 3 });
    await shot(page, size, '35_low_power', 2400);
    await state({ tow: 0.6, position: 2, gapSeconds: -2.1, gapMeters: -60 });
    await shot(page, size, '36_tow', 600);
    await state({ charges: { [rocket.part]: 0, [seeker.part]: 0, [nitro.part]: 0 } });
    await shot(page, size, '37_out_of_ammo', 600);

    // --- Warnings ---------------------------------------------------------------------------
    await state({
      lockWarning: 1,
      rivalOffset: { x: -1400, y: -160 },
      rivalTracked: true,
      gapMeters: -32,
      gapSeconds: -0.9,
      position: 2,
    });
    await shot(page, size, '38_missile_lock', 600);
    await override({
      lockWarning: 2,
      rivalOffset: { x: 1300, y: 300 },
      rivalTracked: true,
      missileOffset: { x: 300, y: 720 },
      gapMeters: 85,
      gapSeconds: 2.3,
      position: 1,
    });
    await step(6);
    await event({ type: 'warning', car: 0, kind: 'missile', by: 1, value: 12 });
    await shot(page, size, '39_missile_incoming', 250);

    // --- The rival off screen, in four directions --------------------------------------------
    const far: Array<[string, number, number, number]> = [
      ['ahead_top', 60, -1100, -85],
      ['right', 1500, 40, 45],
      ['behind_bottom', -80, 1100, 32],
      ['left', -1500, -60, -120],
    ];
    for (const [index, [name, x, y, meters]] of far.entries()) {
      await state({
        rivalOffset: { x, y },
        rivalTracked: true,
        gapMeters: meters,
        gapSeconds: meters / 30,
        position: meters > 0 ? 1 : 2,
      });
      await shot(page, size, `4${index}_rival_${name}`, 500);
    }
    await state(null);

    // --- Pause: the offline label and the lap times ------------------------------------------
    await press('Settings');
    await shot(page, size, '44_pause_offline', 400);
    await page.getByRole('button', { name: 'Resume' }).click();
    // --- Results, with the same label ---------------------------------------------------------
    await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.showResults());
    await shot(page, size, '45_results_offline', 500);

    // --- Left-handed layout, and larger buttons ----------------------------------------------
    await seed(ARMED_BEETLE, { drivingHand: 'right' });
    await toGrid(OFFLINE, false);
    await step(MOMENT_FRAMES);
    await state({ rivalOffset: { x: -1500, y: 60 }, rivalTracked: true, gapMeters: 40 });
    await shot(page, size, '46_left_handed', 500);
    await seed(ARMED_BEETLE, { hudScale: 'large' });
    await toGrid(OFFLINE, false);
    await step(MOMENT_FRAMES);
    await shot(page, size, '47_larger_buttons', 500);
  }

  if (!onlyShots || onlyShots.includes('medium')) {
    // --- How Medium is drawn: three ways, the same frame, and a burst while driving ----------
    for (const [name, query, distance] of [
      ['smooth', '', 'medium'],
      ['nearest', '&mediumAs=nearest', 'medium'],
      ['upscale', '&mediumAs=upscale', 'medium'],
      // The two whole-number views, for reference: the same frames in Close and Far.
      ['ref_close', '', 'close'],
      ['ref_far', '', 'far'],
    ] as const) {
      await seed(ARMED_BEETLE, { cameraDistance: distance });
      await toGrid(`${OFFLINE}${query}`, false);
      await step(MOMENT_FRAMES);
      await shot(page, size, `50_medium_${name}`, 200);
      for (let i = 0; i < 6; i++) {
        await step(1);
        await shot(page, size, `51_medium_${name}_burst${i}`, 0);
      }
    }
  }

  if (!onlyShots || onlyShots.includes('scenarios')) {
    // --- Sensors: Radar and Mine Detector, three equipment buttons, a trap warning ----------
    await seed(SENSOR_SPIDER);
    await toGrid('?debug=1&scenario=mine_sweeper');
    await racing();
    await page
      .locator('[data-testid="warning"][data-kind="trap"]')
      .waitFor({ timeout: 240_000 })
      .catch(() => undefined);
    await shot(page, size, '60_trap_warning_scenario', 0);

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
    await shot(page, size, '61_railgun_charging', 0);

    // --- Repairs, in a real scenario: a destroyed wheel and a critical engine ---------------
    await toGrid('?debug=1&scenario=repair_burst');
    await racing();
    await shot(page, size, '62_repair_scenario_start', 200);
    await page
      .locator('.car-seg[data-repairs="1"]')
      .first()
      .waitFor({ state: 'attached', timeout: 240_000 })
      .catch(() => undefined);
    await shot(page, size, '63_repair_scenario_wheel_replaced', 0);

    // --- Results: a scripted scenario, shown through the debug hook ------------------------
    await toGrid('?debug=1&scenario=rocket_hit');
    await racing();
    await untilRaceTime(8.2);
    await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.showResults());
    await shot(page, size, '64_results_scenario_preview', 500);

    // A hot car, for the heat warning before protection.
    await seed(HOT_ARROW);
    await toGrid('?debug=1&rival=starter_longlegs&seed=7');
    await racing();
    await override({ coreHeat: 96 });
    await shot(page, size, '65_engine_hot_arrow', 900);
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
