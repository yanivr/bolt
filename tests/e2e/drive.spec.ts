import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

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

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function speed(page: Page): Promise<number> {
  const label = await page.locator('.hud-speed canvas').getAttribute('aria-label');
  return Number((label ?? '0').trim());
}

async function debug(page: Page): Promise<string> {
  return (await page.getByTestId('debug').textContent()) ?? '';
}

/**
 * From wherever the page is to the grid: Start Racing, Build Your Car, Ready. The garage opens
 * on the last legal build, so three taps race it unchanged.
 */
async function throughGarage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
}

async function startRace(page: Page, query = '?debug=1'): Promise<void> {
  await page.goto(`/${query}`);
  await throughGarage(page);
}

test('a blank session reaches the home screen and starts a server-authoritative drive', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?debug=1');
  await expect(page.getByRole('img', { name: 'BOLT RIVALS' })).toBeVisible();
  await expect(page.getByText('Build smart. Drive hard.')).toBeVisible();
  await throughGarage(page);
  await expect(page.getByTestId('debug')).toContainText('online');
  await expect(page.getByTestId('debug')).toContainText('webgl');
  await expect(page.getByText('Offline test drive')).toHaveCount(0);
  // The clock only runs once the server has started the race.
  await expect(page.locator('.hud-clock canvas')).not.toHaveAttribute('aria-label', '0:00.00', {
    timeout: 20_000,
  });
  expect(problems).toEqual([]);
});

/** Heading of the local car from the debug readout, degrees clockwise from screen-up. */
async function heading(page: Page): Promise<number> {
  return Number(/heading (\d+) deg/.exec(await debug(page))?.[1] ?? 'NaN');
}

/** A point `distance` CSS pixels from `origin` toward a screen heading. */
function toward(origin: { x: number; y: number }, headingDeg: number, distance: number) {
  const rad = (headingDeg * Math.PI) / 180;
  return { x: origin.x + Math.sin(rad) * distance, y: origin.y - Math.cos(rad) * distance };
}

test('floating joystick appears under the finger, drives, and brakes when pulled back', async ({
  page,
}) => {
  await startRace(page);
  const touch = new Touch(page);
  const disc = page.locator('.joy-disc');
  await expect(disc).not.toHaveClass(/is-active/);
  await expect(page.getByText('Drag toward where you want to go. Pull back to brake.')).toBeVisible(
    {
      timeout: 20_000,
    },
  );

  const origin = { x: 300, y: 260 };
  await touch.down({ id: 1, ...origin });
  await expect(disc).toHaveClass(/is-active/);
  const box = await disc.boundingBox();
  expect(Math.abs(box!.x + box!.width / 2 - 300)).toBeLessThan(3);
  expect(Math.abs(box!.y + box!.height / 2 - 260)).toBeLessThan(3);

  // A finger held still means go.
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(25);
  // The world is drawn north-up: pulling the stick opposite to where the car is pointing on
  // screen brakes it to a stop, and holding it there backs the car up.
  const nose = await heading(page);
  expect(Number.isFinite(nose)).toBe(true);
  await touch.move({ id: 1, ...toward(origin, nose + 180, 42) });
  await expect(page.getByTestId('debug')).toContainText('reversing', { timeout: 20_000 });
  // Pointing forward again drives forward again.
  await touch.move({ id: 1, ...toward(origin, nose, 42) });
  await expect(page.getByTestId('debug')).not.toContainText('reversing', { timeout: 20_000 });
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(25);
  await touch.up(1);
  await expect(disc).not.toHaveClass(/is-active/);
});

test('pointing the stick turns the car toward that direction on screen', async ({ page }) => {
  await startRace(page);
  const touch = new Touch(page);
  const origin = { x: 300, y: 240 };
  await touch.down({ id: 1, ...origin });
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(20);
  const before = await heading(page);
  // Ask for a heading 40 degrees clockwise of the nose and hold it.
  const wanted = (before + 40) % 360;
  await touch.move({ id: 1, ...toward(origin, wanted, 40) });
  const error = async () => {
    const now = await heading(page);
    return Math.abs(((now - wanted + 540) % 360) - 180);
  };
  await expect.poll(error, { timeout: 15_000 }).toBeLessThan(8);
  await touch.up(1);
});

test('the stick origin trails a thumb that wanders, so it never gets far away', async ({
  page,
}) => {
  await startRace(page);
  const touch = new Touch(page);
  await touch.down({ id: 1, x: 250, y: 250 });
  await touch.move({ id: 1, x: 250, y: 120 });
  const box = await page.locator('.joy-disc').boundingBox();
  // 42 px radius, trailing at one and a half radii: the disc has followed the thumb up.
  expect(Math.abs(box!.y + box!.height / 2 - (120 + 63))).toBeLessThan(4);
  expect(Math.abs(box!.x + box!.width / 2 - 250)).toBeLessThan(3);
  await touch.up(1);
});

test('the wheel-style option steers left and right relative to the car and brakes on a pull down', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem('bolt.settings.v1', JSON.stringify({ steering: 'wheel' })),
  );
  await startRace(page);
  await expect(page.getByText('Drag to steer. Pull down to brake.')).toBeVisible({
    timeout: 20_000,
  });
  const touch = new Touch(page);
  await touch.down({ id: 1, x: 300, y: 260 });
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(25);
  // A little over half the stick's travel is a firm brake that holds the car at a standstill.
  await touch.move({ id: 1, x: 300, y: 260 + 23 });
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeLessThan(3);
  await expect(page.getByTestId('debug')).not.toContainText('reversing');
  // The full pull, held at a standstill, backs the car up.
  await touch.move({ id: 1, x: 300, y: 260 + 42 });
  await expect(page.getByTestId('debug')).toContainText('reversing', { timeout: 20_000 });
  await touch.up(1);
});

test('the view is north-up at a whole-number scale and a stale camera setting is dropped', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      'bolt.settings.v1',
      JSON.stringify({ reducedCamera: true, drivingHand: 'right' }),
    ),
  );
  await startRace(page);
  // 844 CSS pixels at a device pixel ratio of 2 is 1688 device pixels: two per world pixel.
  const canvas = page.locator('.race-canvas canvas');
  await expect(canvas).toHaveAttribute('width', '1688');
  await expect(canvas).toHaveAttribute('height', '780');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Reduced Camera Motion')).toHaveCount(0);
  await expect(page.getByText('Touch Steering')).toBeVisible();
  await page.getByText('Left and Right').tap();
  const stored = await page.evaluate(() => window.localStorage.getItem('bolt.settings.v1'));
  expect(stored).toContain('"steering":"wheel"');
  expect(stored).toContain('"drivingHand":"right"');
  expect(stored).not.toContain('reducedCamera');
});

test('a second finger can use the menu while the first keeps steering', async ({ page }) => {
  await startRace(page);
  const touch = new Touch(page);
  await touch.down({ id: 1, x: 220, y: 250 });
  await touch.move({ id: 1, x: 250, y: 250 });
  const menu = await page.getByRole('button', { name: 'Settings' }).boundingBox();
  await touch.down({ id: 2, x: menu!.x + menu!.width / 2, y: menu!.y + menu!.height / 2 });
  await touch.up(2);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('The race keeps going while this menu is open.')).toBeVisible();
  // The steering finger was never captured by the button and never released.
  await expect(page.locator('.joy-disc')).toHaveClass(/is-active/);
  await touch.up(1);
});

test('a finger that starts on a HUD button never becomes the steering finger', async ({ page }) => {
  await startRace(page);
  const touch = new Touch(page);
  const menu = await page.getByRole('button', { name: 'Settings' }).boundingBox();
  await touch.down({ id: 1, x: menu!.x + 10, y: menu!.y + 10 });
  await touch.move({ id: 1, x: 300, y: 250 });
  await expect(page.locator('.joy-disc')).not.toHaveClass(/is-active/);
  await touch.up(1);
});

test('left-handed layout mirrors the action side only, and settings persist', async ({ page }) => {
  await startRace(page);
  const before = await page.locator('.hud-speed').boundingBox();
  expect(before!.x).toBeGreaterThan(422);
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByText('Right Thumb Steers').tap();
  await page.getByRole('button', { name: 'Resume' }).tap();
  const after = await page.locator('.hud-speed').boundingBox();
  expect(after!.x).toBeLessThan(422);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
  const stored = await page.evaluate(() => window.localStorage.getItem('bolt.settings.v1'));
  expect(stored).toContain('"drivingHand":"right"');
});

test('prediction stays on the authoritative car during a full autopilot lap', async ({ page }) => {
  test.slow();
  await startRace(page, '?debug=1&autopilot=1');
  await expect(page.getByRole('img', { name: '2/3' })).toBeVisible({ timeout: 120_000 });
  const text = await debug(page);
  const max = Number(/max ([\d.]+) px/.exec(text)?.[1] ?? '999');
  // Software rendering starves the input stream now and then; anything near a teleport fails.
  expect(max).toBeLessThan(60);
});

test('falls back to a clearly badged offline drive when the server is unreachable', async ({
  page,
}) => {
  await page.route('**/api/v1/health', (route) => route.abort());
  await startRace(page);
  await expect(page.getByText('Offline test drive')).toBeVisible();
  await expect(page.getByTestId('debug')).toContainText('offline');
  const touch = new Touch(page);
  await touch.down({ id: 1, x: 300, y: 260 });
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(25);
  await touch.up(1);
});

test('portrait shows the rotate prompt with a working portrait option', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startRace(page);
  await expect(page.getByText('Turn your phone sideways to race')).toBeVisible();
  await page.getByRole('button', { name: 'Continue in Portrait' }).tap();
  await expect(page.getByText('Turn your phone sideways to race')).toHaveCount(0);
  await expect(page.locator('.hud-speed')).toBeVisible();
});

test('leaving a race asks first and returns home', async ({ page }) => {
  await startRace(page);
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Leave Race' }).tap();
  await expect(page.getByText("Leave this race? You won't be able to finish it.")).toBeVisible();
  await page.getByRole('button', { name: 'Leave Race' }).tap();
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
});

test('every chassis with art can be picked in the garage and driven', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => {
    if (window.localStorage.getItem('bolt.tutorial.v1') === null)
      window.localStorage.setItem('bolt.tutorial.v1', JSON.stringify({ garage_tips: true }));
  });
  await page.goto('/?debug=1');
  // The garage offers exactly the chassis the car atlas can draw. The artists are still adding
  // to it, so the list is read from the manifest; with many frames a spread of them is driven.
  const drawable = await page.evaluate(async () => {
    const response = await fetch('assets/atlases/cars/manifest.json');
    return Object.keys(((await response.json()) as { chassis: object }).chassis);
  });
  expect(drawable.length).toBeGreaterThanOrEqual(4);
  const picks = drawable.length <= 6 ? drawable : [...drawable.slice(0, 3), ...drawable.slice(-3)];
  for (const id of picks) {
    await page.getByRole('button', { name: 'Start Racing' }).tap();
    await page.getByRole('button', { name: 'Build Your Car' }).tap();
    await page.locator('.slot-tile[data-slot="chassis"]').tap();
    const card = page.locator(`.part-card[data-part="${id}"]`);
    if (!(await card.evaluate((el) => el.classList.contains('is-installed')))) {
      await card.tap();
      await page.getByTestId('install').tap();
      await expect(page.getByTestId('garage-status')).toContainText('fitted.');
    }
    await page.getByTestId('ready').tap();
    await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('debug')).toContainText('online');
    const stored = await page.evaluate(() => window.localStorage.getItem('bolt.blueprint.v1'));
    expect(JSON.parse(stored ?? '{}').chassisId).toBe(id);
    await page.getByRole('button', { name: 'Settings' }).tap();
    await page.getByRole('button', { name: 'Leave Race' }).tap();
    await page.getByRole('button', { name: 'Leave Race' }).tap();
    await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
  }
});

test('a pick stored by the Milestone A build is migrated to a blueprint and survives a reload', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'bolt.loadout.v1',
      JSON.stringify({
        chassisId: 'chassis_spider',
        engineId: 'engine_four_cylinder',
        tireKitId: 'tires_street',
        paintId: 'paint_mint',
      }),
    );
  });
  await page.reload();
  await expect(page.getByTestId('home-car-chassis')).toHaveText('Spider');
  const stored = await page.evaluate(() => ({
    legacy: window.localStorage.getItem('bolt.loadout.v1'),
    blueprint: window.localStorage.getItem('bolt.blueprint.v1'),
  }));
  expect(stored.legacy).toBeNull();
  expect(JSON.parse(stored.blueprint ?? '{}')).toMatchObject({
    formatVersion: 1,
    chassisId: 'chassis_spider',
    paintId: 'paint_mint',
    parts: [],
  });
  await page.reload();
  await expect(page.getByTestId('home-car-chassis')).toHaveText('Spider');
  // A pick of a chassis that has since been retired falls back to the baseline car.
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'bolt.loadout.v1',
      JSON.stringify({ chassisId: 'chassis_turtle', paintId: 'paint_mint' }),
    );
  });
  await page.reload();
  await expect(page.getByTestId('home-car-chassis')).toHaveText('Beetle');
  // Garbage in storage falls back to the baseline car instead of breaking the page.
  await page.evaluate(() =>
    window.localStorage.setItem('bolt.blueprint.v1', '{"chassisId":"<script>","totalCost":0}'),
  );
  await page.reload();
  await expect(page.getByTestId('home-car-chassis')).toHaveText('Beetle');
  expect(problems).toEqual([]);
});

test('a build with parts that have no art yet races online, drawn with stand-in sprites', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?debug=1');
  // The catalog version is read from the server so this test does not go stale with it.
  const catalogVersion = await page.evaluate(async () => {
    const response = await fetch('/api/v1/catalog');
    return ((await response.json()) as { catalogVersion: string }).catalogVersion;
  });
  // An Arrow with a V8, Slicks, a machine gun, nitro and a fan. Only the Arrow has sprites.
  const blueprint = {
    formatVersion: 1,
    catalogVersion,
    name: 'Straight-Line Rocket',
    chassisId: 'chassis_arrow',
    engineId: 'engine_v8',
    tireKitId: 'tires_slick',
    paintId: 'paint_signal',
    parts: [
      {
        instanceId: 'p1',
        partId: 'weapon_front_mg',
        mountId: 'front_center',
        offsetX: 0,
        offsetY: 0,
        rotationQuarterTurns: 0,
        assignedActionSlot: 0,
      },
      {
        instanceId: 'p2',
        partId: 'utility_nitro',
        mountId: 'roof_mid',
        offsetX: 0,
        offsetY: 0,
        rotationQuarterTurns: 0,
      },
      {
        instanceId: 'p3',
        partId: 'utility_fan',
        mountId: 'roof_rear',
        offsetX: 0,
        offsetY: 0,
        rotationQuarterTurns: 0,
      },
    ],
    createdAt: '2026-10-10T00:00:00Z',
  };
  await page.evaluate(
    (json) => window.localStorage.setItem('bolt.blueprint.v1', json),
    JSON.stringify(blueprint),
  );
  await page.goto('/?debug=1&autopilot=1');
  await expect(page.getByTestId('home-car-chassis')).toHaveText('Arrow');
  await expect(page.getByTestId('home-car-name')).toHaveText('Straight-Line Rocket');
  await throughGarage(page);
  // The server accepted the full blueprint: this is an authoritative drive, not the fallback.
  await expect(page.getByTestId('debug')).toContainText('online');
  await expect(page.getByTestId('debug')).toContainText('heat');
  // It is the V8 car that is being simulated: it passes the stock car's top speed.
  await expect
    .poll(async () => speed(page), { timeout: 40_000, intervals: [500] })
    .toBeGreaterThan(92);
  expect(problems).toEqual([]);
});
