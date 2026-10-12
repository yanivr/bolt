import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { HudBuild } from '../visual/hudBuilds.js';
import { ARMED_BEETLE, hudBlueprint } from '../visual/hudBuilds.js';

/**
 * The race HUD and results in the browser (Milestone C part 2): the fire buttons under real
 * multi-touch, the layout at the sizes the game has to work at, the car's condition during
 * scripted scenarios, the reasons a button will not act, callouts and warnings, the countdown
 * and the pause menu, and results whose numbers are the event log's.
 *
 * Three things here are set up with the HUD's debug hooks (`window.__boltDebug`, installed
 * only with `?debug=1`) because no scripted scenario reaches them: thermal protection, a lock
 * warning on the local car, and a rival placed off screen. The hook changes what a snapshot
 * says before the HUD reads it; everything asserted is then the HUD's own reading of it.
 */

type Finger = { id: number; x: number; y: number };

/** Real multi-touch through CDP, so pointer capture and simultaneous fingers behave as on a phone. */
class Touch {
  private session: CDPSession | null = null;
  private fingers = new Map<number, Finger>();
  constructor(private readonly page: Page) {}

  private async send(
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Finger[] = [...this.fingers.values()],
  ): Promise<void> {
    this.session ??= await this.page.context().newCDPSession(this.page);
    await this.session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((f) => ({
        x: f.x,
        y: f.y,
        id: f.id,
        radiusX: 8,
        radiusY: 8,
        force: 1,
      })),
    });
  }
  async down(f: Finger): Promise<void> {
    this.fingers.set(f.id, f);
    await this.send('touchStart');
  }
  async move(f: Finger): Promise<void> {
    this.fingers.set(f.id, f);
    await this.send('touchMove');
  }
  async up(id: number): Promise<void> {
    const finger = this.fingers.get(id);
    if (!finger) return;
    this.fingers.delete(id);
    // Chromium lifts exactly the points listed in a touchEnd; the others stay down.
    await this.send('touchEnd', [finger]);
  }
}

type Rect = { name: string; left: number; top: number; right: number; bottom: number };
type Probe = {
  samples: number;
  fire: number;
  use: number;
  steering: boolean;
  fireSeen: number;
  useSeen: number;
  fireWhileSteering: number;
  useWhileSteering: number;
  bothWhileSteering: number;
};
type HitEvent = {
  type: string;
  car: number;
  by: number;
  weapon: string;
  component: number;
  damage: number;
  chassis: number;
  shield: number;
  armor: number;
  absorbed: number;
};
type RaceView = {
  distance: string;
  filter: string;
  scale: number;
  widthPx: number;
  heightPx: number;
  worldWidth: number;
  worldHeight: number;
  cssPerWorld: number;
  chunks: number;
  chunksMax: number;
  chunksTotal: number;
};
type DebugHost = {
  __boltRace: { view: () => RaceView };
  __boltDebug: {
    input: Probe;
    hud: {
      override: (changes: unknown) => void;
      event: (body: unknown) => void;
      events: () => HitEvent[];
      showResults: () => void;
      carScreen: () => { x: number; y: number } | null;
      camera: () => { width: number; height: number; cssPerWorld: number };
      view: () => {
        popStamp: number;
        tow: number;
        you: number;
        result: null | {
          winner: number;
          reason: string;
          cars: Array<{
            damageDealt: number;
            damageTaken: number;
            hitsLanded: number;
            finishTimeMs: number | null;
          }>;
        };
      };
      parts: () => Array<{
        part: number;
        component: number;
        id: string;
        slot: number;
        useBit: number;
      }>;
      components: () => Array<{ index: number; kind: string; name: string }>;
    };
  };
};

/** Console errors that are this page's own. Other work in progress is not this suite's to judge. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

/** Makes a car the stored build, with settings, before the app next loads. */
async function seed(
  page: Page,
  build: HudBuild | null,
  settings: Record<string, unknown> = {},
): Promise<void> {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible({ timeout: 30_000 });
  const version = await page.evaluate(async () => {
    const response = await fetch('/api/v1/health');
    return ((await response.json()) as { catalogVersion: string }).catalogVersion;
  });
  await page.evaluate(
    ([car, prefs]) => {
      if (car) window.localStorage.setItem('bolt.blueprint.v1', car);
      window.localStorage.setItem('bolt.settings.v1', prefs!);
      window.localStorage.setItem(
        'bolt.tutorial.v1',
        JSON.stringify({ garage_tips: true, built: true, steered: true }),
      );
    },
    [build ? JSON.stringify(hudBlueprint(build, version)) : null, JSON.stringify(settings)],
  );
}

async function toGrid(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Start Racing' }).click();
  await page.getByRole('button', { name: 'Build Your Car' }).click();
  await page.getByTestId('ready').click();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
}

/** Waits for GO: the clock only runs once the race does. */
async function racing(page: Page): Promise<void> {
  await expect(page.locator('.hud-clock canvas')).not.toHaveAttribute('aria-label', '0:00.00', {
    timeout: 30_000,
  });
}

const RACE = '?debug=1&rival=starter_longlegs&seed=7';

/**
 * Timeouts for things that happen at a known race time. A scripted scenario advances with the
 * frames the machine manages to draw, so on a loaded machine with software rendering it can
 * run several times slower than the clock on the wall: nothing here waits by the wall clock.
 */
const SLOW = 150_000;

/** The race clock, in seconds. */
async function raceSeconds(page: Page): Promise<number> {
  const label = (await page.locator('.hud-clock canvas').getAttribute('aria-label')) ?? '0:00.00';
  const [minutes, rest] = label.split(':');
  return Number(minutes) * 60 + Number(rest);
}

/** Waits until the race clock has passed a time, however long the machine takes to get there. */
async function untilRaceTime(page: Page, seconds: number): Promise<void> {
  await expect
    .poll(() => raceSeconds(page), { timeout: SLOW, intervals: [250] })
    .toBeGreaterThanOrEqual(seconds);
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => ({ ...(window as unknown as DebugHost).__boltDebug.input }));
}

async function override(page: Page, changes: unknown): Promise<void> {
  await page.evaluate((o) => (window as unknown as DebugHost).__boltDebug.hud.override(o), changes);
}

async function inject(page: Page, body: unknown): Promise<void> {
  await page.evaluate((b) => (window as unknown as DebugHost).__boltDebug.hud.event(b), body);
}

async function centre(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Bounding boxes of everything the HUD keeps on screen. */
async function hudRects(page: Page): Promise<{ rects: Rect[]; width: number; height: number }> {
  return page.evaluate(() => {
    const names: Array<[string, string]> = [
      ['strip', '.hud-strip'],
      ['car', '.hud-car'],
      ['map', '.hud-map'],
      ['menu', '.hud-menu'],
      ['speed', '.hud-speed'],
      ['fire-0', '[data-testid="fire-0"]'],
      ['fire-1', '[data-testid="fire-1"]'],
      ['use-0', '[data-testid="use-0"]'],
      ['use-1', '[data-testid="use-1"]'],
      ['autos', '.hud-autos'],
    ];
    const rects: Rect[] = [];
    for (const [name, selector] of names) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      rects.push({ name, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return { rects, width: window.innerWidth, height: window.innerHeight };
  });
}

/**
 * The box around the car that nothing persistent may enter: 300 x 190 from 760 pixels of
 * width up, the earlier 220 x 150 on a narrower phone (docs/DECISIONS.md).
 */
const keepOut = (width: number) => (width >= 760 ? { w: 300, h: 190 } : { w: 220, h: 150 });

/**
 * The box the product owner's brief of October 12 names: nothing within 260 x 170 of the car.
 * Asserted from 760 px of width up; a 667 px phone keeps the 220 x 150 box (docs/DECISIONS.md).
 */
const OWNER_BOX = { w: 260, h: 170 };

/**
 * Whether the keep-out box around the car can touch a rectangle, with the car anywhere the
 * camera can put it: inside an ellipse of 12 percent of the width by 27 percent of the height
 * around the middle of the view (docs/DECISIONS.md, entry 34).
 */
function carCanReach(
  rect: Rect,
  width: number,
  height: number,
  box: { w: number; h: number } = keepOut(width),
): boolean {
  const rx = width * 0.12;
  const ry = height * 0.27;
  const left = rect.left - box.w / 2 - width / 2;
  const right = rect.right + box.w / 2 - width / 2;
  const top = rect.top - box.h / 2 - height / 2;
  const bottom = rect.bottom + box.h / 2 - height / 2;
  const nx = Math.max(left, Math.min(0, right));
  const ny = Math.max(top, Math.min(0, bottom));
  return (nx / rx) ** 2 + (ny / ry) ** 2 <= 1;
}

const overlap = (a: Rect, b: Rect) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5;

const SIZES: Array<[number, number]> = [
  [870, 370],
  [870, 340],
  [844, 390],
  [667, 375],
  [932, 430],
];

/** Most of the screen the persistent HUD may cover: a tenth, or 12 percent on the small phone. */
const occupancyLimit = (width: number) => (width >= 840 ? 0.1 : 0.12);

async function assertLayout(page: Page, hand: 'left' | 'right', where: string): Promise<number> {
  const { rects, width, height } = await hudRects(page);
  const names = rects.map((r) => r.name);
  for (const wanted of [
    'strip',
    'car',
    'map',
    'menu',
    'speed',
    'fire-0',
    'fire-1',
    'use-0',
    'use-1',
  ])
    expect(names, `${where}: ${wanted}`).toContain(wanted);
  let area = 0;
  for (const r of rects) {
    // Inside the viewport, with room to spare at every edge.
    expect(r.left, `${where}: ${r.name} left`).toBeGreaterThanOrEqual(4);
    expect(r.top, `${where}: ${r.name} top`).toBeGreaterThanOrEqual(4);
    expect(r.right, `${where}: ${r.name} right`).toBeLessThanOrEqual(width - 4);
    expect(r.bottom, `${where}: ${r.name} bottom`).toBeLessThanOrEqual(height - 4);
    // Never where a box around the car can be.
    expect(carCanReach(r, width, height), `${where}: ${r.name} can be reached by the car`).toBe(
      false,
    );
    // The product owner's brief names a 260 x 170 box. It holds from 760 px of width up
    // (inside the 300 x 190 above, asserted on its own so the brief's number is in the test).
    // At 667 x 375 two thumbs' worth of buttons and the strip leave room for 220 x 150 only.
    if (width >= 760)
      expect(
        carCanReach(r, width, height, OWNER_BOX),
        `${where}: ${r.name} can be reached by the car's 260 x 170 box`,
      ).toBe(false);
    area += (r.right - r.left) * (r.bottom - r.top);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      expect(
        overlap(rects[i]!, rects[j]!),
        `${where}: ${rects[i]!.name} over ${rects[j]!.name}`,
      ).toBe(false);

  // The strip is one thin line, and the three bars under it are thin too.
  const strip = rects.find((x) => x.name === 'strip')!;
  expect(strip.bottom - strip.top, `${where}: strip height`).toBeLessThanOrEqual(32);
  expect(strip.bottom - strip.top, `${where}: strip height`).toBeGreaterThanOrEqual(26);
  const bars = await page
    .locator('.hud-car .gauge-track')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(bars, `${where}: three bars`).toHaveLength(3);
  for (const bar of bars) expect(bar, `${where}: bar height`).toBeLessThanOrEqual(8);
  // The rival's hull is a line of the route ribbon's own panel.
  const map = rects.find((x) => x.name === 'map')!;
  const rival = (await page.getByTestId('rival').boundingBox())!;
  expect(rival.x, `${where}: rival bar`).toBeGreaterThanOrEqual(map.left);
  expect(rival.y + rival.height, `${where}: rival bar`).toBeLessThanOrEqual(map.bottom);
  expect(map.right - map.left, `${where}: ribbon`).toBeLessThanOrEqual(80);

  // Fire buttons: big enough, and under the thumb of the action hand.
  const corner = { x: hand === 'left' ? width : 0, y: height };
  for (const name of ['fire-0', 'fire-1']) {
    const r = rects.find((x) => x.name === name)!;
    expect(r.right - r.left, `${where}: ${name} width`).toBeGreaterThanOrEqual(64);
    expect(r.bottom - r.top, `${where}: ${name} height`).toBeGreaterThanOrEqual(64);
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    expect(Math.hypot(cx - corner.x, cy - corner.y), `${where}: ${name} reach`).toBeLessThanOrEqual(
      160,
    );
    expect(cy, `${where}: ${name} in the lower half`).toBeGreaterThan(height / 2);
  }
  const primary = rects.find((x) => x.name === 'fire-0')!;
  expect(primary.right - primary.left, `${where}: primary`).toBeGreaterThanOrEqual(72);
  for (const name of ['use-0', 'use-1', 'menu']) {
    const r = rects.find((x) => x.name === name)!;
    expect(r.right - r.left, `${where}: ${name} width`).toBeGreaterThanOrEqual(44);
    expect(r.bottom - r.top, `${where}: ${name} height`).toBeGreaterThanOrEqual(44);
  }
  // The action side is the one opposite the steering hand.
  const fire = rects.find((x) => x.name === 'fire-0')!;
  if (hand === 'left') {
    expect(fire.left, `${where}: fire side`).toBeGreaterThan(width / 2);
    expect(strip.right, `${where}: info side`).toBeLessThan(width / 2);
  } else {
    expect(fire.right, `${where}: fire side`).toBeLessThan(width / 2);
    expect(strip.left, `${where}: info side`).toBeGreaterThan(width / 2);
  }
  // Nothing persistent is in the middle of the screen at all.
  for (const r of rects) {
    const middle = r.left < width * 0.72 && r.right > width * 0.28;
    expect(middle, `${where}: ${r.name} in the middle band`).toBe(false);
  }
  // Where the HUD believes the car is, nothing of the HUD is within the box. After a resize
  // the HUD's camera starts over, and has the car again on its next frame.
  const carAt = () =>
    page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.carScreen());
  await expect.poll(carAt, { message: `${where}: car position`, timeout: 30_000 }).not.toBeNull();
  const car = await carAt();
  const size = keepOut(width);
  const box: Rect = {
    name: 'car',
    left: car!.x - size.w / 2,
    right: car!.x + size.w / 2,
    top: car!.y - size.h / 2,
    bottom: car!.y + size.h / 2,
  };
  for (const r of rects)
    expect(overlap(box, r), `${where}: ${r.name} in the car's box`).toBe(false);
  return area / (width * height);
}

/** Chooses a `Camera` setting in the pause menu, as a player would. */
async function chooseCamera(page: Page, label: 'Close' | 'Medium' | 'Far'): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radiogroup', { name: 'Camera' }).getByText(label, { exact: true }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.hud')).toHaveAttribute('data-camera', label.toLowerCase());
}

const raceView = (page: Page) =>
  page.evaluate(() => (window as unknown as DebugHost).__boltRace.view());

/** Where an edge tag has been put, CSS pixels. */
const tagAt = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });

test('layout at five phone sizes, both hands: a slim HUD in the corners, buttons under the thumb, nothing near the car', async ({
  page,
}) => {
  test.slow();
  const problems = collectProblems(page);
  await seed(page, ARMED_BEETLE);
  await toGrid(page, RACE);
  await racing(page);
  // The default camera is Close, the view the game always had.
  await expect(page.locator('.hud')).toHaveAttribute('data-camera', 'close');
  // On the server: no offline mark on the menu button.
  await expect(page.getByTestId('offline-dot')).toHaveCount(0);
  const occupancy: string[] = [];
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const share = await assertLayout(page, 'left', `${width}x${height}`);
    occupancy.push(`${width}x${height} ${(share * 100).toFixed(1)}%`);
    // A tenth of the screen at most; the 667 x 375 phone has a quarter less screen for the
    // same buttons and is held to 12 percent (docs/DECISIONS.md).
    expect(share, `${width}x${height} occupancy`).toBeLessThanOrEqual(occupancyLimit(width));
  }
  // The tow widens the strip a little: it still keeps clear, and the HUD is still under its limit.
  await override(page, { tow: 0.9, position: 2, gapSeconds: -2.2 });
  await expect(page.getByTestId('tow')).toHaveAttribute('data-level', '3');
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const share = await assertLayout(page, 'left', `${width}x${height} with the tow`);
    expect(share, `${width}x${height} occupancy with the tow`).toBeLessThanOrEqual(
      occupancyLimit(width),
    );
  }
  await override(page, null);
  // The other hand: the two columns swap, whole.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Right Thumb Steers').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const share = await assertLayout(page, 'right', `${width}x${height} right thumb steers`);
    expect(share, `${width}x${height} occupancy`).toBeLessThanOrEqual(occupancyLimit(width));
  }
  // Larger buttons keep to the same rules at the owner's size, and the strip and the bars
  // grow with them, a little.
  await page.setViewportSize({ width: 870, height: 370 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Left Thumb Steers').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(350);
  const standardBar = (await page.locator('.hud-car .gauge-track').first().boundingBox())!.height;
  const standardStrip = (await page.locator('.hud-strip').boundingBox())!.height;
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Larger Buttons').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(350);
  await assertLayout(page, 'left', '870x370 larger buttons');
  const large = (await page.getByTestId('fire-0').boundingBox())!;
  expect(large.width).toBeGreaterThanOrEqual(84);
  expect(
    (await page.locator('.hud-car .gauge-track').first().boundingBox())!.height,
  ).toBeGreaterThan(standardBar);
  expect((await page.locator('.hud-strip').boundingBox())!.height).toBeGreaterThan(standardStrip);
  console.log(`HUD occupancy: ${occupancy.join(', ')}`);
  expect(problems).toEqual([]);
});

test.describe("on the owner's phone", () => {
  // 870 x 370 CSS pixels at three device pixels each: the numbers of the Camera decision.
  test.use({ viewport: { width: 870, height: 370 }, deviceScaleFactor: 3 });

  test('the Camera setting: three views, applied at once from the pause menu, and the HUD follows each', async ({
    page,
  }) => {
    test.slow();
    const problems = collectProblems(page);
    await seed(page, ARMED_BEETLE);
    await toGrid(page, RACE);
    await racing(page);
    const arrow = page.getByTestId('rival-arrow');
    const spans: Record<string, RaceView> = {};
    for (const label of ['Close', 'Medium', 'Far'] as const) {
      await chooseCamera(page, label);
      await expect
        .poll(async () => (await raceView(page)).distance, { message: label })
        .toBe(label.toLowerCase());
      const view = await raceView(page);
      spans[label] = view;
      // A whole number of canvas pixels to a world pixel, and the canvas fills the screen.
      expect(Number.isInteger(view.scale), `${label}: scale`).toBe(true);
      expect(view.worldWidth * view.cssPerWorld, `${label}: fills the width`).toBeCloseTo(870, 0);
      expect(view.worldHeight * view.cssPerWorld, `${label}: fills the height`).toBeCloseTo(370, 0);
      const canvas = (await page.locator('.race-canvas canvas').boundingBox())!;
      expect(canvas.width, `${label}: canvas width`).toBeCloseTo(870, 0);
      expect(canvas.height, `${label}: canvas height`).toBeCloseTo(370, 0);
      expect(
        await page
          .locator('.race-canvas canvas')
          .evaluate((el) => (el as HTMLElement).style.imageRendering),
        `${label}: canvas filter`,
      ).toBe(view.filter === 'pixelated' ? 'pixelated' : 'auto');
      // The terrain it has to draw: never more chunks than the view can touch.
      expect(view.chunks, `${label}: chunks`).toBeLessThanOrEqual(view.chunksMax);
      expect(view.chunksMax, `${label}: chunks`).toBeLessThanOrEqual(12);
      // The HUD's own camera has the same view.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as DebugHost).__boltDebug.hud.camera().cssPerWorld,
            ),
          { message: `${label}: HUD camera` },
        )
        .toBeCloseTo(view.cssPerWorld, 2);
      // The layout rules hold in every view: the car is in the same place on the screen.
      await assertLayout(page, 'left', `870x370 camera ${label}`);

      // A rival 500 world pixels to the left: on screen in the wider views, off it in Close.
      const car = (await page.evaluate(() =>
        (window as unknown as DebugHost).__boltDebug.hud.carScreen(),
      ))!;
      await override(page, { rivalOffset: { x: -500, y: 0 }, rivalTracked: true, gapMeters: 40 });
      const onScreen = car.x - 500 * view.cssPerWorld >= 0;
      await expect(arrow, `${label}: rival at -500`).toHaveAttribute(
        'data-shown',
        onScreen ? '0' : '1',
      );
      // Far off in four directions: the tag lies against that edge of the screen, clear of the panels.
      const { rects } = await hudRects(page);
      for (const [name, x, y] of [
        ['left', -2500, 0],
        ['right', 2500, 30],
        ['top', 40, -2500],
        ['bottom', -40, 2500],
      ] as const) {
        await override(page, { rivalOffset: { x, y }, rivalTracked: true, gapMeters: -85 });
        await expect(arrow).toHaveAttribute('data-shown', '1');
        await expect
          .poll(
            async () => {
              const at = await tagAt(page, 'rival-arrow');
              return name === 'left'
                ? at.x
                : name === 'right'
                  ? 870 - at.x
                  : name === 'top'
                    ? at.y
                    : 370 - at.y;
            },
            { message: `${label}: rival tag hugs the ${name} edge` },
          )
          .toBeLessThanOrEqual(40);
        const tag = (await arrow.locator('.edge-tag').boundingBox())!;
        const box: Rect = {
          name: 'tag',
          left: tag.x,
          top: tag.y,
          right: tag.x + tag.width,
          bottom: tag.y + tag.height,
        };
        expect(tag.x, `${label} ${name}: tag inside`).toBeGreaterThanOrEqual(0);
        expect(tag.y, `${label} ${name}: tag inside`).toBeGreaterThanOrEqual(0);
        expect(tag.x + tag.width, `${label} ${name}: tag inside`).toBeLessThanOrEqual(870);
        expect(tag.y + tag.height, `${label} ${name}: tag inside`).toBeLessThanOrEqual(370);
        // Compact: an arrow and a distance.
        expect(tag.width, `${label} ${name}: tag width`).toBeLessThanOrEqual(64);
        expect(tag.height, `${label} ${name}: tag height`).toBeLessThanOrEqual(24);
        await expect(arrow.locator('.edge-label')).toHaveText('85m');
        await expect(arrow).toHaveAttribute('aria-label', 'Rival: Ahead 85m');
        for (const r of rects)
          expect(overlap(box, r), `${label} ${name}: tag over ${r.name}`).toBe(false);
        // Never out toward the middle, where the cars are.
        const cx = tag.x + tag.width / 2;
        const cy = tag.y + tag.height / 2;
        expect(
          cx < 80 || cx > 790 || cy < 40 || cy > 330,
          `${label} ${name}: tag at ${cx},${cy}`,
        ).toBe(true);
      }
      await override(page, null);
    }
    const close = spans.Close!;
    const medium = spans.Medium!;
    const far = spans.Far!;
    // Close is the view the game had; Medium shows a quarter more, Far half as much again.
    expect(close.worldWidth).toBeCloseTo(870, 0);
    expect(medium.worldWidth / close.worldWidth).toBeCloseTo(1.25, 2);
    expect(medium.worldHeight / close.worldHeight).toBeCloseTo(1.25, 2);
    expect(far.worldWidth / close.worldWidth).toBeCloseTo(1.5, 2);
    // Medium is Close's own whole-number scale on a larger canvas; Far is the next scale out,
    // on the same canvas as Close: device resolution, nothing resampled.
    expect(medium.scale).toBe(close.scale);
    expect(medium.filter).toBe('smooth');
    expect(far.scale).toBe(close.scale - 1);
    expect(far.widthPx).toBe(close.widthPx);
    expect(far.filter).toBe('pixelated');
    console.log(
      `Camera: ${Object.entries(spans)
        .map(
          ([name, v]) =>
            `${name} ${Math.round(v.worldWidth)}x${Math.round(v.worldHeight)} world px, scale ${v.scale}, canvas ${v.widthPx}x${v.heightPx}, chunks ${v.chunks} now and ${v.chunksMax} at most of ${v.chunksTotal}`,
        )
        .join('; ')}`,
    );
    // The choice is kept with the other settings.
    expect(
      await page.evaluate(
        () =>
          (
            JSON.parse(window.localStorage.getItem('bolt.settings.v1') ?? '{}') as {
              cameraDistance?: string;
            }
          ).cameraDistance,
      ),
    ).toBe('far');
    expect(problems).toEqual([]);
  });
});

test('the bars and the icons: the diagram comes up for a hit and leaves, what is broken stays, alarms are not told by color', async ({
  page,
}) => {
  test.slow();
  await seed(page, ARMED_BEETLE);
  await page.setViewportSize({ width: 870, height: 370 });
  await toGrid(page, RACE);
  await racing(page);
  const pop = page.getByTestId('diagram-pop');
  const broken = page.getByTestId('broken');
  const components = await page.evaluate(() =>
    (window as unknown as DebugHost).__boltDebug.hud.components(),
  );
  const wheel = components.find((c) => c.name === 'Front left wheel')!;
  const engine = components.find((c) => c.kind === 'engine')!;
  // A whole car: three bars and the hull's number, no diagram, no row of icons, no tow.
  await expect(pop).toHaveAttribute('data-shown', '0');
  await expect(pop).toHaveCSS('opacity', '0');
  await expect(broken).toHaveAttribute('data-count', '0');
  await expect(page.locator('.broken-icon')).toHaveCount(0);
  await expect(page.getByTestId('hull-value')).toHaveText('100');
  await expect(page.getByTestId('tow')).toHaveCount(0);
  // Best lap, last lap and the offline label are not on the HUD.
  await expect(page.locator('.hud')).not.toContainText('BEST');
  await expect(page.locator('.hud')).not.toContainText('Offline test drive');

  // A hit on a wheel: the diagram comes up beside the bars with that wheel marked, and leaves.
  await inject(page, {
    type: 'hit',
    car: 0,
    by: 1,
    weapon: 'weapon_shotgun',
    cls: 'bullet',
    x: 0,
    y: 0,
    component: wheel.index,
    damage: 9,
    chassis: 3,
    shield: 0,
    armor: 0,
    absorbed: 0,
    projectile: 0,
  });
  await expect(pop).toHaveAttribute('data-shown', '1');
  await expect(pop).toHaveCSS('opacity', '1');
  await expect(page.locator(`.car-seg[data-component="${wheel.index}"]`)).toHaveClass(/is-focus/);
  await expect(page.locator('.car-seg.is-focus')).toHaveCount(1);
  const bars = (await page.locator('.hud-car').boundingBox())!;
  const diagram = (await pop.boundingBox())!;
  expect(diagram.x).toBeGreaterThanOrEqual(bars.x + bars.width);
  expect(diagram.y).toBeGreaterThanOrEqual(bars.y - 1);
  // It is clear of the lane under it, and of the car's box.
  const lane = (await page.locator('.hud-lane').boundingBox())!;
  expect(diagram.y + diagram.height).toBeLessThanOrEqual(lane.y + 0.5);
  expect(
    carCanReach(
      {
        name: 'diagram',
        left: diagram.x,
        top: diagram.y,
        right: diagram.x + diagram.width,
        bottom: diagram.y + diagram.height,
      },
      870,
      370,
    ),
  ).toBe(false);
  // About a second and a half to two seconds, then it is gone again.
  await page.waitForTimeout(1200);
  await expect(pop).toHaveAttribute('data-shown', '1');
  await expect(pop).toHaveAttribute('data-shown', '0', { timeout: 2500 });
  await expect(pop).toHaveCSS('opacity', '0');

  // The wheel is destroyed: the diagram comes up for the change, and when it has left, the
  // wheel's icon stays, crossed out, with its name for a screen reader.
  await override(page, { integrity: { [wheel.index]: 0 } });
  await expect(pop).toHaveAttribute('data-shown', '1');
  const icon = page.locator(`.broken-icon[data-component="${wheel.index}"]`);
  await expect(icon).toHaveAttribute('data-tier', '3');
  await expect(icon).toHaveAttribute('aria-label', 'Front left wheel: destroyed');
  await expect(icon.locator('.broken-x')).toHaveCount(1);
  await expect(pop).toHaveAttribute('data-shown', '0', { timeout: 4000 });
  await expect(icon).toBeVisible();
  await expect(broken).toHaveAttribute('data-count', '1');
  // A critical engine has a different drawing: a hatch and a corner, no cross.
  await override(page, { integrity: { [wheel.index]: 0, [engine.index]: 14 } });
  const engineIcon = page.locator(`.broken-icon[data-component="${engine.index}"]`);
  await expect(engineIcon).toHaveAttribute('data-tier', '2');
  await expect(engineIcon.locator('.broken-x')).toHaveCount(0);
  await expect(engineIcon.locator('.broken-bang')).toHaveCount(1);
  expect(await engineIcon.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
    'repeating-linear-gradient',
  );
  expect(await engineIcon.locator('svg path').first().getAttribute('d')).not.toBe(
    await icon.locator('svg.glyph path').getAttribute('d'),
  );
  // A part that is only damaged is not in the row.
  await override(page, { integrity: { [wheel.index]: 0, [engine.index]: 55 } });
  await expect(engineIcon).toHaveCount(0);
  // The row is in the steering corner, clear of the car's box.
  const row = (await broken.boundingBox())!;
  expect(
    carCanReach(
      {
        name: 'row',
        left: row.x,
        top: row.y,
        right: row.x + row.width,
        bottom: row.y + row.height,
      },
      870,
      370,
    ),
  ).toBe(false);
  // Repaired: the icon goes.
  await override(page, null);
  await expect(page.locator('.broken-icon')).toHaveCount(0);

  // Overheat and low power: a different mark and a different hatch each, not only a color.
  const mark = (id: string) => page.getByTestId(id).locator('.mini').getAttribute('data-mini');
  const hatch = (id: string) =>
    page
      .getByTestId(id)
      .locator('.gauge-track')
      .evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
  const outline = (id: string) =>
    page
      .getByTestId(id)
      .locator('.gauge-track')
      .evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(await mark('heat')).toBe('heat');
  expect(await mark('power')).toBe('power');
  const calmHeat = await hatch('heat');
  const calmPower = await hatch('power');
  await override(page, { coreHeat: 112, thermalLimited: true, battery: 0 });
  await expect(page.getByTestId('heat')).toHaveAttribute('data-level', '3');
  await expect(page.getByTestId('power')).toHaveAttribute('data-low', '1');
  expect(await mark('heat')).toBe('alarm');
  expect(await mark('power')).toBe('alarm');
  expect(await hatch('heat')).not.toBe(calmHeat);
  expect(await hatch('power')).not.toBe(calmPower);
  expect(await hatch('heat')).not.toBe(await hatch('power'));
  expect(await outline('heat')).toBe('2px');
  expect(await outline('power')).toBe('2px');
  // The mark blinks, and stops with Reduce Flashing Effects, which is on by default.
  await expect(page.getByTestId('heat').locator('.mini')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Reduce Flashing Effects').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('heat').locator('.mini')).toHaveCSS('animation-name', 'seg-blink');
  await override(page, null);
  await expect(page.getByTestId('heat')).not.toHaveAttribute('data-level', '3');
  expect(await mark('heat')).toBe('heat');

  // The tow: nothing at zero or for a tow just letting go (5 percent and under), a caption
  // and one to three chevrons above that.
  for (const none of [0, 0.04, 0.05]) {
    await override(page, { tow: none, position: 2, gapSeconds: -1.8 });
    await page.waitForTimeout(400);
    await expect(page.getByTestId('tow'), `tow ${none}`).toHaveCount(0);
  }
  for (const [value, level] of [
    [0.2, 1],
    [0.5, 2],
    [1, 3],
  ] as const) {
    await override(page, { tow: value, position: 2, gapSeconds: -1.8 });
    const tow = page.getByTestId('tow');
    await expect(tow).toHaveAttribute('data-level', String(level));
    await expect(tow).toHaveAttribute('aria-label', `Tow, level ${level} of 3`);
    await expect(tow.locator('.hud-tow-steps .is-on')).toHaveCount(level);
    await expect(tow.locator('.hud-tow-steps span')).toHaveCount(3);
  }
  const strip = (await page.getByTestId('race-strip').boundingBox())!;
  const towBox = (await page.getByTestId('tow').boundingBox())!;
  expect(towBox.x).toBeGreaterThanOrEqual(strip.x);
  expect(towBox.y + towBox.height).toBeLessThanOrEqual(strip.y + strip.height);
  await override(page, null);
});

test('three fingers: steering, holding the primary button and tapping the secondary all reach the simulation', async ({
  page,
}) => {
  await seed(page, ARMED_BEETLE);
  await toGrid(page, RACE);
  await racing(page);
  const touch = new Touch(page);
  const primary = page.getByTestId('fire-0');
  const secondary = page.getByTestId('fire-1');
  await expect(primary).toHaveAttribute('data-charges', '5');
  await expect(secondary).toHaveAttribute('data-charges', '3');

  // Finger one steers.
  await touch.down({ id: 1, x: 260, y: 250 });
  await touch.move({ id: 1, x: 230, y: 250 });
  await expect(page.locator('.joy-disc')).toHaveClass(/is-active/);
  // Finger two presses and holds the primary button.
  const p = await centre(page, 'fire-0');
  await touch.down({ id: 2, ...p });
  await expect(primary).toHaveAttribute('data-held', '1');
  await expect.poll(async () => (await probe(page)).fireWhileSteering & 1).toBe(1);
  // Finger three taps the secondary while the other two stay down.
  const s = await centre(page, 'fire-1');
  await touch.down({ id: 3, ...s });
  await expect(secondary).toHaveAttribute('data-held', '1');
  await expect.poll(async () => (await probe(page)).bothWhileSteering).toBeGreaterThan(0);
  await touch.up(3);
  await expect(secondary).toHaveAttribute('data-held', '0');
  // The steering finger and the held button were not disturbed.
  await expect(primary).toHaveAttribute('data-held', '1');
  await expect(page.locator('.joy-disc')).toHaveClass(/is-active/);
  let now = await probe(page);
  expect(now.steering).toBe(true);
  expect(now.fireWhileSteering).toBe(3);
  await expect.poll(async () => (await probe(page)).fire).toBe(1);

  // The simulation heard both: a rocket and a seeker have left the car.
  await expect.poll(async () => Number(await secondary.getAttribute('data-charges'))).toBe(2);
  await expect
    .poll(async () => Number(await primary.getAttribute('data-charges')))
    .toBeLessThanOrEqual(4);
  // Held, the primary keeps firing each time its cooldown ends (Section 8.3).
  await expect
    .poll(async () => Number(await primary.getAttribute('data-charges')), { timeout: 30_000 })
    .toBeLessThanOrEqual(3);
  // The finger slides off the button without lifting: it still holds.
  await touch.move({ id: 2, x: p.x - 120, y: p.y - 60 });
  await expect(primary).toHaveAttribute('data-held', '1');
  await expect(page.locator('.joy-disc')).toHaveClass(/is-active/);
  await touch.up(2);
  await expect(primary).toHaveAttribute('data-held', '0');
  await expect.poll(async () => (await probe(page)).fire).toBe(0);

  // A fourth touch on an equipment button, still steering.
  const nitro = page.locator('[data-id="utility_nitro"]');
  const box = (await nitro.boundingBox())!;
  await touch.down({ id: 4, x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await touch.up(4);
  await expect.poll(async () => Number(await nitro.getAttribute('data-charges'))).toBe(1);
  await expect(page.locator('.status-icon[data-status="boost"]')).toBeVisible();
  now = await probe(page);
  expect(now.useWhileSteering).not.toBe(0);
  expect(now.steering).toBe(true);
  await touch.up(1);
  await expect(page.locator('.joy-disc')).not.toHaveClass(/is-active/);
});

test('left-handed: the buttons move to the left and work there, and the world does not mirror', async ({
  page,
}) => {
  await seed(page, ARMED_BEETLE, { drivingHand: 'right' });
  await toGrid(page, RACE);
  await racing(page);
  const width = page.viewportSize()!.width;
  const p = await centre(page, 'fire-0');
  expect(p.x).toBeLessThan(width / 3);
  expect((await page.locator('.hud-strip').boundingBox())!.x).toBeGreaterThan(width / 2);
  expect((await page.getByRole('button', { name: 'Settings' }).boundingBox())!.x).toBeLessThan(
    width / 2,
  );
  // The right thumb steers on the right, the left presses on the left.
  const touch = new Touch(page);
  await touch.down({ id: 1, x: width - 260, y: 250 });
  await touch.move({ id: 1, x: width - 290, y: 250 });
  await touch.down({ id: 2, ...p });
  await expect.poll(async () => (await probe(page)).fireWhileSteering & 1).toBe(1);
  await expect
    .poll(async () => Number(await page.getByTestId('fire-0').getAttribute('data-charges')))
    .toBeLessThanOrEqual(4);
  await touch.up(2);
  await touch.up(1);
  // Pointing the stick left still drives left: the Neon Cut grid faces left.
  const heading = Number(
    /heading (\d+) deg/.exec((await page.getByTestId('debug').textContent()) ?? '')?.[1],
  );
  expect(Math.abs(heading - 270)).toBeLessThan(25);
});

test('the car diagram shows the scripted repairs on the right parts, and the callouts name them', async ({
  page,
}) => {
  test.setTimeout(400_000);
  await seed(page, null);
  await toGrid(page, '?debug=1&scenario=repair_burst');
  const components = await page.evaluate(() =>
    (window as unknown as DebugHost).__boltDebug.hud.components(),
  );
  const wheel = components.find((c) => c.name === 'Front left wheel')!;
  const engine = components.find((c) => c.kind === 'engine')!;
  const seg = (index: number) => page.locator(`.car-seg[data-component="${index}"]`);
  // The scenario starts with a ruined front-left wheel and a critical engine.
  await expect(seg(wheel.index)).toHaveAttribute('data-tier', '3');
  await expect(seg(wheel.index).locator('.car-seg-x')).toHaveCount(1);
  await expect(seg(engine.index)).toHaveAttribute('data-tier', '2');
  for (const other of components.filter((c) => c.index !== wheel.index && c.index !== engine.index))
    await expect(seg(other.index), other.name).toHaveAttribute('data-tier', '0');
  await expect(page.getByTestId('car-diagram')).toHaveAttribute(
    'aria-label',
    /Engine: critical\. Front left wheel: destroyed/,
  );
  // The car starts like that, so the diagram is not up; the two icons are simply there.
  await expect(page.getByTestId('broken')).toHaveAttribute('data-count', '2');
  await expect(page.locator(`.broken-icon[data-component="${wheel.index}"]`)).toHaveAttribute(
    'data-tier',
    '3',
  );
  await expect(page.locator(`.broken-icon[data-component="${engine.index}"]`)).toHaveAttribute(
    'data-tier',
    '2',
  );
  // The spare wheel goes on: the button fills, the wheel comes back, the callout says so.
  await expect(page.locator('[data-id="utility_spare"]')).toHaveAttribute(
    'data-phase',
    'charging',
    {
      timeout: SLOW,
    },
  );
  await expect(page.locator('.status-icon[data-status="refit"]')).toBeVisible();
  await expect(seg(wheel.index)).toHaveAttribute('data-tier', '0', { timeout: SLOW });
  await expect(seg(wheel.index)).toHaveAttribute('data-repairs', '1');
  // The diagram comes up for the repair, and the wheel's icon leaves the row.
  await expect(page.getByTestId('diagram-pop')).toHaveAttribute('data-shown', '1');
  await expect(page.locator(`.broken-icon[data-component="${wheel.index}"]`)).toHaveCount(0);
  await expect(page.getByTestId('callouts')).toContainText('WHEEL REPLACED');
  await expect(page.getByTestId('callouts-live')).toContainText('WHEEL REPLACED');
  await expect(page.locator('[data-id="utility_spare"]')).toHaveAttribute('data-block', 'empty');
  // Then the repair kit brings the engine from critical to damaged.
  await expect(seg(engine.index)).toHaveAttribute('data-tier', '1', { timeout: SLOW });
  await expect(page.getByTestId('callouts')).toContainText('REPAIRED');
  await expect(seg(engine.index).locator('.car-seg-mark')).toHaveCount(1);
  await expect(page.getByTestId('broken')).toHaveAttribute('data-count', '0');
});

test('hits flash the part they landed on: every hit on the local car in three scenarios', async ({
  page,
}) => {
  test.setTimeout(900_000);
  await seed(page, null);
  let seen = 0;
  // Each scenario is watched until just after its last hit on the local car.
  for (const [scenario, seconds] of [
    ['ram', 4.6],
    ['wet_road', 8.8],
    ['shield_break', 7.8],
  ] as const) {
    await toGrid(page, `?debug=1&scenario=${scenario}`);
    await racing(page);
    await untilRaceTime(page, seconds);
    const hits = await page.evaluate(() =>
      (window as unknown as DebugHost).__boltDebug.hud
        .events()
        .filter((e) => e.type === 'hit' && e.car === 0 && e.component >= 0)
        .map((e) => e.component),
    );
    const counts = new Map<number, number>();
    for (const component of hits) counts.set(component, (counts.get(component) ?? 0) + 1);
    const shown = await page.evaluate(() =>
      Array.from(document.querySelectorAll<SVGGElement>('.car-seg')).map((el) => [
        Number(el.dataset.component),
        Number(el.dataset.hits),
      ]),
    );
    for (const [component, flashes] of shown)
      expect(flashes, `${scenario}: component ${component}`).toBe(counts.get(component!) ?? 0);
    seen += hits.length;
  }
  expect(seen).toBeGreaterThan(0);
});

test('a rocket hit shows on the rival bar, the button counts down, and results match the event log', async ({
  page,
}) => {
  test.setTimeout(900_000);
  await seed(page, null);
  await toGrid(page, '?debug=1&scenario=rocket_hit');
  const primary = page.getByTestId('fire-0');
  await expect(primary).toHaveAttribute('data-id', 'weapon_rocket');
  await expect(primary).toHaveAttribute('data-charges', '5');
  await expect(page.getByTestId('rival')).toHaveAttribute('data-percent', '100');
  // The first rocket: one fewer, reloading, and the rival's hull drops.
  await expect(primary).toHaveAttribute('data-charges', '4', { timeout: SLOW });
  await expect(primary).toHaveAttribute('data-phase', 'cooling');
  await expect(primary).toHaveAttribute('data-waiting', '1');
  await expect
    .poll(async () => Number(await page.getByTestId('rival').getAttribute('data-percent')), {
      timeout: SLOW,
    })
    .toBeLessThan(100);
  await expect(page.getByTestId('callouts-live')).toContainText('DIRECT HIT');
  await expect(page.getByTestId('callouts-live')).toContainText('Rival: Engine');
  await expect(primary).toHaveAttribute('data-phase', 'ready', { timeout: SLOW });
  await expect(primary).toHaveAttribute('data-charges', '3', { timeout: SLOW });
  // The second rocket bursts on the road 7.6 seconds in; nothing else happens after it.
  await untilRaceTime(page, 8);

  // The results for the race so far, from the same log the page has kept.
  const events = await page.evaluate(() =>
    (window as unknown as DebugHost).__boltDebug.hud.events(),
  );
  const mine = events.filter((e) => e.type === 'hit' && e.by === 0 && e.car !== 0);
  const dealt = mine.reduce(
    (sum, e) => sum + e.damage + e.chassis + e.shield + e.armor + e.absorbed,
    0,
  );
  const taken = events
    .filter((e) => e.type === 'hit' && e.car === 0)
    .reduce((sum, e) => sum + e.damage + e.chassis, 0);
  expect(mine.length).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.showResults());
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(results).toHaveAttribute('data-outcome', 'preview');
  // A scenario runs in the page, and the results say so.
  await expect(results.getByTestId('offline-badge')).toHaveText('Offline test drive');
  await expect(page.getByTestId('res-dealt-you')).toHaveText(String(Math.round(dealt)));
  await expect(page.getByTestId('res-hits-you')).toHaveText(String(mine.length));
  await expect(page.getByTestId('res-dealt-rival')).toHaveText('0');
  const row = page.locator('[data-testid="res-by-weapon"] li');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-weapon', 'weapon_rocket');
  expect(Number(await row.getAttribute('data-damage'))).toBeCloseTo(dealt, 6);
  await expect(row).toContainText('Straight Rocket');
  await expect(row.locator('.results-num')).toHaveText(String(Math.round(dealt)));
  expect(taken).toBe(0);
  await expect(results).toContainText('Not a scratch.');
  await expect(page.getByTestId('res-facts')).toContainText(
    `Biggest hit: Straight Rocket, ${Math.round(Math.max(...mine.map((e) => e.damage + e.chassis + e.shield + e.armor + e.absorbed)))} damage.`,
  );
  // The whole card is on screen at the test's phone size, and the actions are in order.
  const card = (await results.boundingBox())!;
  const view = page.viewportSize()!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(view.width);
  expect(card.y + card.height).toBeLessThanOrEqual(view.height);
  await expect(results.getByRole('button')).toHaveText([
    'Race Again',
    'Change My Build',
    'Back Home',
  ]);
  await expect(results.getByRole('button', { name: 'Race Again' })).toBeFocused();

  // Race Again: back on the grid with a full rack and an empty log.
  await results.getByRole('button', { name: 'Race Again' }).click();
  await expect(results).toHaveCount(0);
  await expect(primary).toHaveAttribute('data-charges', '5');
  await expect(page.getByTestId('rival')).toHaveAttribute('data-percent', '100');
  expect(
    await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.events().length),
  ).toBeLessThan(3);
  // Change My Build goes to the garage; Back Home goes home.
  await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.showResults());
  await results.getByRole('button', { name: 'Change My Build' }).click();
  await expect(page.getByTestId('ready')).toBeVisible();
  await page.getByTestId('ready').click();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.showResults());
  await page.getByTestId('results').getByRole('button', { name: 'Back Home' }).click();
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
});

test('out of ammunition and too hot are told apart without color, and a refused press says why', async ({
  page,
}) => {
  test.slow();
  await seed(page, ARMED_BEETLE);
  await toGrid(page, RACE);
  await racing(page);
  const primary = page.getByTestId('fire-0');
  const secondary = page.getByTestId('fire-1');
  // Hold the trigger until the rack is empty: a real race, the server's own count.
  await page.keyboard.down('Space');
  await expect(primary).toHaveAttribute('data-charges', '0', { timeout: SLOW });
  await page.keyboard.up('Space');
  await expect(primary).toHaveAttribute('data-block', 'empty');
  await expect(primary).toHaveAttribute('aria-disabled', 'true');
  await expect(primary).toHaveAttribute('aria-label', /Fire Straight Rocket\. 0 left\. Empty/);
  await expect(primary.locator('.fire-block-word')).toHaveText('Empty');
  await expect(page.getByTestId('callouts-live')).toContainText('OUT OF AMMO');
  const emptyGlyph = await primary.locator('.fire-block svg path').getAttribute('d');
  // Pressing it again is refused by the server, and the button says the same thing.
  await page.waitForTimeout(400);
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  await page.keyboard.up('Space');
  await expect(primary.locator('.fire-refusal')).toHaveAttribute('data-reason', 'no_ammo', {
    timeout: SLOW,
  });
  await expect(primary.locator('.fire-refusal-word')).toHaveText('Empty');

  // Thermal protection (set through the debug override): the seeker, which makes heat, locks.
  await expect(secondary).toHaveAttribute('data-block', '');
  await override(page, { coreHeat: 112, thermalLimited: true });
  await expect(secondary).toHaveAttribute('data-block', 'overheat');
  await expect(secondary.locator('.fire-block-word')).toHaveText('Too hot');
  await expect(secondary).toHaveAttribute('aria-label', /Too hot/);
  await expect(page.getByTestId('heat')).toHaveAttribute('data-level', '3');
  await expect(page.getByTestId('heat')).toHaveAttribute('aria-label', 'Heat: Cooling down');
  await expect(page.getByTestId('callouts')).toContainText('ENGINE HOT');
  // Different words, different glyphs, different hatching: not color alone.
  const hotGlyph = await secondary.locator('.fire-block svg path').getAttribute('d');
  expect(hotGlyph).not.toBe(emptyGlyph);
  const patterns = await page.evaluate(() => {
    const image = (id: string) =>
      getComputedStyle(document.querySelector(`[data-testid="${id}"] .fire-block`)!)
        .backgroundImage;
    return [image('fire-0'), image('fire-1')];
  });
  expect(patterns[0]).not.toBe(patterns[1]);
  // An empty launcher stays "Empty": ammunition is checked before heat.
  await expect(primary).toHaveAttribute('data-block', 'empty');
  // Equipment is not a weapon: heat does not lock the nitro.
  await expect(page.locator('[data-id="utility_nitro"]')).toHaveAttribute('data-block', '');

  // No power, a broken part and an EMP each have their own word.
  const parts = await page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.parts());
  const seeker = parts.find((p) => p.id === 'weapon_homing')!;
  await override(page, { battery: 0 });
  await expect(secondary.locator('.fire-block-word')).toHaveText('No power');
  await expect(page.getByTestId('power')).toHaveAttribute('data-low', '1');
  await override(page, { integrity: { [seeker.component]: 0 } });
  await expect(secondary.locator('.fire-block-word')).toHaveText('Broken');
  await expect(page.locator(`.car-seg[data-component="${seeker.component}"]`)).toHaveAttribute(
    'data-tier',
    '3',
  );
  await override(page, { statuses: [{ family: 'emp', ticks: 60 }] });
  await expect(secondary.locator('.fire-block-word')).toHaveText('EMP');
  await expect(page.locator('[data-id="utility_nitro"] .fire-block-word')).toHaveText('EMP');
  await expect(page.locator('.status-icon[data-status="emp"]')).toBeVisible();
  await override(page, null);
  await expect(secondary).toHaveAttribute('data-block', '');
});

test('warnings and the off-screen rival: a lock, a missile, an arrow with its distance; callouts can be turned off', async ({
  page,
}) => {
  await seed(page, ARMED_BEETLE, { callouts: false });
  await toGrid(page, RACE);
  await racing(page);
  const arrow = page.getByTestId('rival-arrow');
  const warning = page.getByTestId('warning');
  // The rival far ahead, off the top of the screen, and tracked.
  await override(page, {
    rivalOffset: { x: 0, y: -900 },
    rivalTracked: true,
    gapMeters: -85,
    position: 2,
    gapSeconds: -2.4,
  });
  await expect(arrow).toHaveAttribute('data-shown', '1');
  await expect(arrow).toHaveAttribute('data-label', 'Ahead 85m');
  await expect(page.getByTestId('position')).toHaveAttribute('data-position', '2');
  await expect(page.getByTestId('gap')).toHaveText('−2.4');
  const view = page.viewportSize()!;
  const info = (await page.locator('.hud-col-info').boundingBox())!;
  const action = (await page.locator('.hud-col-action').boundingBox())!;
  const at = await arrow.evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });
  // Against the top edge of the screen, between the two corners of the HUD.
  expect(at.y).toBeLessThan(30);
  expect(at.x).toBeGreaterThan(info.x + info.width);
  expect(at.x).toBeLessThan(action.x);
  // Behind and to the right: the label changes, the arrow goes to that edge.
  await override(page, {
    rivalOffset: { x: 900, y: 300 },
    rivalTracked: true,
    gapMeters: 32,
    position: 1,
    gapSeconds: 1.1,
  });
  await expect(arrow).toHaveAttribute('data-label', 'Behind 30m');
  await expect(page.getByTestId('gap')).toHaveText('+1.1');
  // Against the right edge of the screen, not out beside the car.
  expect((await tagAt(page, 'rival-arrow')).x).toBeGreaterThan(view.width - 45);
  // Out of tracking range, the server does not say where the rival is, and neither does the HUD.
  await override(page, { rivalOffset: { x: 900, y: 300 }, rivalTracked: false });
  await expect(arrow).toHaveAttribute('data-shown', '0');
  await expect(page.getByTestId('minimap')).toHaveAttribute('data-rival', '0');
  // On screen, there is no arrow either.
  await override(page, { rivalOffset: { x: 60, y: 20 }, rivalTracked: true });
  await expect(arrow).toHaveAttribute('data-shown', '0');
  await expect(page.getByTestId('minimap')).toHaveAttribute('data-rival', '1');

  // A lock, then a missile in the air.
  await expect(warning).toHaveCount(0);
  await override(page, { lockWarning: 1, rivalOffset: { x: -800, y: 0 }, rivalTracked: true });
  await expect(warning).toHaveAttribute('data-kind', 'lock');
  await expect(warning).toContainText('MISSILE LOCK');
  await expect(warning).toHaveAttribute('role', 'alert');
  await expect(arrow).toHaveAttribute('data-threat', '1');
  await override(page, {
    lockWarning: 2,
    rivalOffset: { x: -800, y: 0 },
    rivalTracked: true,
    missileOffset: { x: 30, y: 700 },
  });
  await inject(page, { type: 'warning', car: 0, kind: 'missile', by: 1, value: 14 });
  await expect(warning).toHaveAttribute('data-kind', 'missile');
  await expect(warning).toContainText('INCOMING');
  // The missile is behind and the rival ahead: two markers, the threat's own at the bottom.
  await expect(page.getByTestId('threat-arrow')).toHaveAttribute('data-shown', '1');
  const threat = await page.getByTestId('threat-arrow').evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });
  expect(threat.y).toBeGreaterThan(view.height - 40);
  // Warnings are never switched off; callouts are, and were for this page.
  await inject(page, { type: 'lap', car: 0, lap: 2, lapTimeMs: 30_000 });
  await inject(page, {
    type: 'status',
    car: 0,
    by: 1,
    family: 'emp',
    state: 'applied',
    magnitude: 1,
    ticks: 45,
  });
  await page.waitForTimeout(500);
  await expect(page.locator('.hud-callout')).toHaveCount(0);
  await override(page, null);
  await expect(warning).toHaveCount(0);

  // Turned back on: news is called out, never more than two at a time.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Race Callouts').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  for (const family of ['emp', 'jam', 'burn'])
    await inject(page, {
      type: 'status',
      car: 0,
      by: 1,
      family,
      state: 'applied',
      magnitude: 1,
      ticks: 45,
    });
  await inject(page, { type: 'lap', car: 0, lap: 2, lapTimeMs: 30_000 });
  await inject(page, { type: 'position', leader: 1, gapMeters: 3 });
  await expect(page.getByTestId('callouts')).toContainText('SYSTEMS DOWN');
  await expect(page.getByTestId('callouts-live')).toHaveAttribute('aria-live', 'polite');
  let most = 0;
  for (let i = 0; i < 12; i++) {
    most = Math.max(most, await page.locator('.hud-callout').count());
    await page.waitForTimeout(120);
  }
  expect(most).toBe(2);
  // They leave by themselves.
  await expect(page.locator('.hud-callout')).toHaveCount(0, { timeout: 8000 });
});

test('a trap warning and hazards on the route ribbon for a car with a Mine Detector', async ({
  page,
}) => {
  test.setTimeout(400_000);
  await seed(page, null);
  await toGrid(page, '?debug=1&scenario=mine_sweeper');
  const warning = page.getByTestId('warning');
  await expect(warning).toHaveAttribute('data-kind', 'trap', { timeout: SLOW });
  await expect(warning).toContainText('TRAP AHEAD');
  await expect
    .poll(async () => Number(await page.getByTestId('minimap').getAttribute('data-hazards')))
    .toBeGreaterThan(0);
  // The sweeper's pip is there, with no button behind it.
  await expect(page.locator('.auto-pip[data-part]')).toHaveCount(1);
  await expect(page.getByTestId('fire-0')).toHaveCount(0);
  // The warning goes when the mine has been dealt with.
  await expect(warning).toHaveCount(0, { timeout: SLOW });
});

test('the countdown is clear of the car, and pausing a single-player race stops its clock', async ({
  page,
}) => {
  test.setTimeout(400_000);
  await seed(page, null);
  await toGrid(page, '?debug=1&scenario=weapon_railshot');
  // A scenario runs in the page: single player. The HUD no longer carries the label for
  // that; the pause menu and the results do.
  await expect(page.getByText('Offline test drive')).toHaveCount(0);
  // What the HUD keeps of it is a small mark on the menu button, named in its tooltip.
  await expect(page.getByTestId('offline-dot')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute(
    'title',
    'Offline test drive',
  );
  // The railgun charges before it fires: the button fills. The charge is short, so every
  // phase the button goes through is recorded in the page instead of sampled from here.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __railPhases: string[] }).__railPhases = seen;
    const note = () => {
      const phase = document
        .querySelector('[data-id="weapon_railshot"]')
        ?.getAttribute('data-phase');
      if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
    };
    new MutationObserver(note).observe(document.querySelector('.hud')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    });
    note();
  });
  await racing(page);
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __railPhases: string[] }).__railPhases),
      {
        timeout: SLOW,
      },
    )
    .toContain('charging');
  await page.getByRole('button', { name: 'Settings' }).click();
  const notice = page.getByTestId('pause-notice');
  await expect(notice).toContainText('Paused. The race resumes by itself in ');
  await expect(notice).toContainText(/[12]:\d\d\./);
  await expect(page.getByTestId('offline-badge')).toHaveText('Offline test drive');
  await expect(page.getByTestId('offline-badge')).toBeVisible();
  await expect(page.getByTestId('pause-laps')).toContainText('Best lap');
  await expect(page.getByTestId('pause-laps')).toContainText('Last lap');
  const clock = page.locator('.hud-clock canvas');
  const before = await clock.getAttribute('aria-label');
  await page.waitForTimeout(900);
  expect(await clock.getAttribute('aria-label')).toBe(before);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(clock).not.toHaveAttribute('aria-label', before!, { timeout: 5000 });

  // On the server the race keeps going, and the menu says so.
  await toGrid(page, RACE);
  const count = page.getByTestId('countdown');
  await expect(count).toBeVisible({ timeout: 20_000 });
  const banner = (await count.boundingBox())!;
  const car = await page.evaluate(() =>
    (window as unknown as DebugHost).__boltDebug.hud.carScreen(),
  );
  if (car) expect(banner.y + banner.height).toBeLessThan(car.y - 75);
  expect(banner.y).toBeLessThan(20);
  await racing(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('pause-notice')).toHaveText(
    'The race keeps going while this menu is open.',
  );
  await expect(page.getByTestId('offline-badge')).toHaveCount(0);
  const running = await clock.getAttribute('aria-label');
  await expect(clock).not.toHaveAttribute('aria-label', running!, { timeout: 5000 });
});

test.describe('on a desktop', () => {
  test.use({
    viewport: { width: 1280, height: 720 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
  });

  test('the Camera setting on a screen at one device pixel: the canvas covers the screen in every view', async ({
    page,
  }) => {
    await seed(page, ARMED_BEETLE);
    await toGrid(page, RACE);
    await racing(page);
    const widths: number[] = [];
    // Each view has its own canvas size here; Far comes after another view, and again before one.
    for (const label of ['Medium', 'Far', 'Close', 'Far', 'Medium'] as const) {
      await chooseCamera(page, label);
      await expect
        .poll(async () => (await raceView(page)).distance, { message: label })
        .toBe(label.toLowerCase());
      const view = await raceView(page);
      const canvas = (await page.locator('.race-canvas canvas').boundingBox())!;
      expect(canvas.width, `${label}: canvas width`).toBeCloseTo(1280, 0);
      expect(canvas.height, `${label}: canvas height`).toBeCloseTo(720, 0);
      expect(view.worldWidth * view.cssPerWorld, `${label}: fills the width`).toBeCloseTo(1280, 0);
      expect(Number.isInteger(view.scale), `${label}: scale`).toBe(true);
      widths.push(view.worldWidth);
    }
    // Medium, Far, Close, Far, Medium: wider, narrower, wider, narrower.
    expect(widths[1]).toBeGreaterThan(widths[0]!);
    expect(widths[2]).toBeLessThan(widths[0]!);
    expect(widths[3]).toBe(widths[1]);
    expect(widths[4]).toBe(widths[0]);
  });

  test('keyboard only: steer, fire both weapons, use equipment, pause and restart', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await seed(page, ARMED_BEETLE);
    await toGrid(page, RACE);
    await racing(page);
    const primary = page.getByTestId('fire-0');
    const secondary = page.getByTestId('fire-1');
    // The shortcuts are printed on the buttons.
    await expect(primary.locator('.fire-key')).toBeVisible();
    await expect(primary.locator('.fire-key')).toHaveText('Space');
    await expect(secondary.locator('.fire-key')).toHaveText('E');
    const speed = async () =>
      Number(((await page.locator('.hud-speed canvas').getAttribute('aria-label')) ?? '0').trim());
    const heading = async () =>
      Number(/heading (\d+) deg/.exec((await page.getByTestId('debug').textContent()) ?? '')?.[1]);

    await page.keyboard.down('ArrowUp');
    await expect.poll(speed, { timeout: SLOW }).toBeGreaterThan(20);
    const before = await heading();
    await page.keyboard.down('ArrowRight');
    await expect
      .poll(async () => Math.abs((((await heading()) - before + 540) % 360) - 180), {
        timeout: SLOW,
      })
      .toBeGreaterThan(8);
    await page.keyboard.up('ArrowRight');

    // Space and E, together.
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyE');
    await expect.poll(async () => (await probe(page)).fireSeen).toBe(3);
    await page.keyboard.up('KeyE');
    await page.keyboard.up('Space');
    await expect(primary).toHaveAttribute('data-charges', '4', { timeout: SLOW });
    await expect(secondary).toHaveAttribute('data-charges', '2', { timeout: SLOW });

    // The nitro by its number, the repair kit by R.
    const nitro = page.locator('[data-id="utility_nitro"]');
    const bit = Number((await nitro.getAttribute('data-testid'))!.replace('use-', ''));
    await expect(nitro.locator('.fire-key')).toHaveText(String(bit + 1));
    await page.keyboard.down(`Digit${bit + 1}`);
    await page.waitForTimeout(150);
    await page.keyboard.up(`Digit${bit + 1}`);
    await expect(nitro).toHaveAttribute('data-charges', '1', { timeout: SLOW });
    await page.keyboard.down('KeyR');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyR');
    // The server runs this race in real time whatever the page manages to draw, so by now the
    // rival may have scratched the car: R then either repairs it or is refused as not needed.
    // The words of a refusal are checked where the race is scripted (out of ammunition).
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as DebugHost).__boltDebug.hud
              .events()
              .map((e) => e as unknown as { type: string; reason?: string; utility?: string })
              .some(
                (e) =>
                  (e.type === 'refused' && e.reason === 'not_needed') ||
                  (e.type === 'utility' && e.utility === 'utility_repair'),
              ),
          ),
        { timeout: SLOW },
      )
      .toBe(true);
    await page.keyboard.up('ArrowUp');

    // Escape pauses, with the keyboard inside the menu; Tab and Enter restart the race.
    await page.keyboard.press('Escape');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Resume' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Race Again' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(primary).toHaveAttribute('data-charges', '5', { timeout: SLOW });
    await expect(secondary).toHaveAttribute('data-charges', '3');
    await expect(nitro).toHaveAttribute('data-charges', '2');
    // And Escape, Escape is pause and resume.
    await racing(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test('a whole race to the flag: the finish, then results that agree with the server and the log', async ({
  page,
}) => {
  test.setTimeout(900_000);
  await seed(page, ARMED_BEETLE);
  await toGrid(page, `${RACE}&autopilot=1`);
  await racing(page);
  // Fire now and then on the way round, so there is something to add up.
  const results = page.getByTestId('results');
  const stop = Date.now() + 780_000;
  let sawFinal = false;
  while (Date.now() < stop && (await results.count()) === 0) {
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(400);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyE');
    await page.waitForTimeout(1600);
    if (!sawFinal && (await page.getByRole('img', { name: 'FINAL LAP' }).count()) > 0)
      sawFinal = true;
  }
  await expect(results).toBeVisible({ timeout: 30_000 });
  expect(sawFinal).toBe(true);
  const verdict = await page.evaluate(() => {
    const view = (window as unknown as DebugHost).__boltDebug.hud.view();
    return { you: view.you, result: view.result };
  });
  expect(verdict.result).not.toBeNull();
  const mine = verdict.result!.cars[verdict.you]!;
  const outcome =
    verdict.result!.winner === verdict.you
      ? 'victory'
      : verdict.result!.winner === -1
        ? 'draw'
        : 'defeat';
  await expect(results).toHaveAttribute('data-outcome', outcome);
  await expect(
    results.getByRole('img', {
      name: outcome === 'victory' ? 'VICTORY' : outcome === 'defeat' ? 'DEFEAT' : 'DRAW',
    }),
  ).toBeVisible();
  // The table is the server's result.
  await expect(page.getByTestId('res-dealt-you')).toHaveText(String(Math.round(mine.damageDealt)));
  await expect(page.getByTestId('res-hits-you')).toHaveText(String(mine.hitsLanded));
  if (mine.finishTimeMs !== null) await expect(page.getByTestId('res-laps-you')).toHaveText('3/3');
  // And the breakdown, added up from the events, comes to the same totals.
  const events = await page.evaluate(() =>
    (window as unknown as DebugHost).__boltDebug.hud.events(),
  );
  const dealt = events
    .filter((e) => e.type === 'hit' && e.by === verdict.you && e.car !== verdict.you)
    .reduce((sum, e) => sum + e.damage + e.chassis + e.shield + e.armor + e.absorbed, 0);
  const taken = events
    .filter((e) => e.type === 'hit' && e.car === verdict.you)
    .reduce((sum, e) => sum + e.damage + e.chassis, 0);
  expect(dealt).toBeCloseTo(mine.damageDealt, 3);
  expect(taken).toBeCloseTo(mine.damageTaken, 3);
  const rows = await page
    .locator('[data-testid="res-by-weapon"] li')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.damage)));
  if (mine.damageDealt > 0) expect(rows.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  // Race Again from the results starts a new race.
  await results.getByRole('button', { name: 'Race Again' }).click();
  await expect(results).toHaveCount(0);
  await expect(page.getByTestId('fire-0')).toHaveAttribute('data-charges', '5', {
    timeout: SLOW,
  });
});
