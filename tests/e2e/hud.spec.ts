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
type DebugHost = {
  __boltDebug: {
    input: Probe;
    hud: {
      override: (changes: unknown) => void;
      event: (body: unknown) => void;
      events: () => HitEvent[];
      showResults: () => void;
      carScreen: () => { x: number; y: number } | null;
      view: () => {
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
      ['race', '.hud-race'],
      ['car', '.hud-car'],
      ['map', '.hud-map'],
      ['menu', '.hud-menu'],
      ['speed', '.hud-speed'],
      ['rival', '.hud-rival'],
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
 * Whether a 220 x 150 box around the car can touch a rectangle, with the car anywhere the
 * camera can put it: inside an ellipse of 12 percent of the width by 27 percent of the height
 * around the middle of the view (docs/DECISIONS.md, entry 34).
 */
function carCanReach(rect: Rect, width: number, height: number): boolean {
  const rx = width * 0.12;
  const ry = height * 0.27;
  const left = rect.left - 110 - width / 2;
  const right = rect.right + 110 - width / 2;
  const top = rect.top - 75 - height / 2;
  const bottom = rect.bottom + 75 - height / 2;
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

async function assertLayout(page: Page, hand: 'left' | 'right', where: string): Promise<number> {
  const { rects, width, height } = await hudRects(page);
  const names = rects.map((r) => r.name);
  for (const wanted of [
    'race',
    'car',
    'map',
    'menu',
    'speed',
    'rival',
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
    area += (r.right - r.left) * (r.bottom - r.top);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      expect(
        overlap(rects[i]!, rects[j]!),
        `${where}: ${rects[i]!.name} over ${rects[j]!.name}`,
      ).toBe(false);

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
  const race = rects.find((x) => x.name === 'race')!;
  if (hand === 'left') {
    expect(fire.left, `${where}: fire side`).toBeGreaterThan(width / 2);
    expect(race.right, `${where}: info side`).toBeLessThan(width / 2);
  } else {
    expect(fire.right, `${where}: fire side`).toBeLessThan(width / 2);
    expect(race.left, `${where}: info side`).toBeGreaterThan(width / 2);
  }
  // Where the HUD believes the car is, nothing of the HUD is within the box. After a resize
  // the HUD's camera starts over, and has the car again on its next frame.
  const carAt = () =>
    page.evaluate(() => (window as unknown as DebugHost).__boltDebug.hud.carScreen());
  await expect.poll(carAt, { message: `${where}: car position`, timeout: 30_000 }).not.toBeNull();
  const car = await carAt();
  const box: Rect = {
    name: 'car',
    left: car!.x - 110,
    right: car!.x + 110,
    top: car!.y - 75,
    bottom: car!.y + 75,
  };
  for (const r of rects)
    expect(overlap(box, r), `${where}: ${r.name} in the car's box`).toBe(false);
  return area / (width * height);
}

test('layout at five phone sizes, both hands: buttons under the thumb, nothing over the car or another panel', async ({
  page,
}) => {
  test.slow();
  const problems = collectProblems(page);
  await seed(page, ARMED_BEETLE);
  await toGrid(page, RACE);
  await racing(page);
  const occupancy: string[] = [];
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const share = await assertLayout(page, 'left', `${width}x${height}`);
    occupancy.push(`${width}x${height} ${(share * 100).toFixed(1)}%`);
    // Section 5.9: about 18 percent of the screen at most. The 667 x 375 phone has a quarter
    // less screen for the same buttons, and is held to what it can do (docs/DECISIONS.md).
    expect(share, `${width}x${height} occupancy`).toBeLessThan(width >= 840 ? 0.19 : 0.215);
  }
  // The other hand: the two columns swap, whole.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Right Thumb Steers').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    await assertLayout(page, 'right', `${width}x${height} right thumb steers`);
  }
  // Larger buttons keep to the same rules at the owner's size.
  await page.setViewportSize({ width: 870, height: 370 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Left Thumb Steers').click();
  await page.getByText('Larger Buttons').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(350);
  await assertLayout(page, 'left', '870x370 larger buttons');
  const large = (await page.getByTestId('fire-0').boundingBox())!;
  expect(large.width).toBeGreaterThanOrEqual(84);
  console.log(`HUD occupancy: ${occupancy.join(', ')}`);
  expect(problems).toEqual([]);
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
  expect((await page.locator('.hud-race').boundingBox())!.x).toBeGreaterThan(width / 2);
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
  await expect(page.getByTestId('callouts')).toContainText('WHEEL REPLACED');
  await expect(page.getByTestId('callouts-live')).toContainText('WHEEL REPLACED');
  await expect(page.locator('[data-id="utility_spare"]')).toHaveAttribute('data-block', 'empty');
  // Then the repair kit brings the engine from critical to damaged.
  await expect(seg(engine.index)).toHaveAttribute('data-tier', '1', { timeout: SLOW });
  await expect(page.getByTestId('callouts')).toContainText('REPAIRED');
  await expect(seg(engine.index).locator('.car-seg-mark')).toHaveCount(1);
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
  await expect(page.getByTestId('gap')).toHaveText('−2.4 s');
  const view = page.viewportSize()!;
  const info = (await page.locator('.hud-col-info').boundingBox())!;
  const action = (await page.locator('.hud-col-action').boundingBox())!;
  const at = await arrow.evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });
  // Clamped to the top of the play field, between the two columns.
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
  await expect(page.getByTestId('gap')).toHaveText('+1.1 s');
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
  // A scenario runs in the page: single player.
  await expect(page.getByText('Offline test drive')).toBeVisible();
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
