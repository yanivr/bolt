import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * The Milestone B flow on the production build: Home, Track Preview, the timed garage, the
 * race, and My Blueprints. The build clock is stretched or shortened with `buildSeconds`,
 * which the client honours only when `debug=1` is set.
 */

const SLOW_CLOCK = '?debug=1&buildSeconds=900';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function credits(page: Page): Promise<number> {
  return Number(await page.getByTestId('credits-left').getAttribute('data-credits'));
}

function status(page: Page): Locator {
  return page.getByTestId('garage-status');
}

function card(page: Page, partId: string): Locator {
  return page.locator(`.part-card[data-part="${partId}"]`);
}

function ready(page: Page): Locator {
  return page.getByTestId('ready');
}

/** A slot tile: `chassis`, `engine`, `tires` or `mount:<id>`. */
function tile(page: Page, slot: string): Locator {
  return page.locator(`.slot-tile[data-slot="${slot}"]`);
}

/** Mount tiles that hold a part. */
function occupied(page: Page): Locator {
  return page.locator('.slot-tile.is-filled[data-mount]');
}

/** The list for the selected slot, by the slot's name. */
function list(page: Page): Locator {
  return page.getByTestId('part-list');
}

/** Opens the More menu and presses one of its entries. */
async function more(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'More' })
    .getByRole('button', { name, exact: typeof name === 'string' })
    .tap();
}

/** Buys a part through Browse All Parts: it goes on the best free mount. */
async function browseBuy(page: Page, category: string, partId: string): Promise<void> {
  await more(page, 'Browse All Parts');
  await page.getByRole('tab', { name: category }).tap();
  await card(page, partId).tap();
  await page.getByTestId('install').tap();
}

/** Buys a part for one slot: tap the tile, the row, then the button. */
async function slotBuy(page: Page, slot: string, partId: string): Promise<void> {
  await tile(page, slot).tap();
  await card(page, partId).tap();
  await page.getByTestId('install').tap();
}

/** Home, Start Racing, Build Your Car: the garage with its clock running. */
async function openGarage(page: Page, query = SLOW_CLOCK): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await expect(ready(page)).toBeVisible();
  await expect(page.locator('.slot-tile').first()).toBeVisible();
  // The car is shown once its art has been measured.
  await expect(page.locator('.g-car')).toBeVisible();
}

/** Marks the first-build tips as seen so they do not take list space in tests about other things. */
async function skipTips(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.localStorage.getItem('bolt.tutorial.v1') === null)
      window.localStorage.setItem('bolt.tutorial.v1', JSON.stringify({ garage_tips: true }));
  });
}

type PartSpec = [partId: string, mountId: string, extra?: Record<string, unknown>];

/** A blueprint as the client stores it, stamped with the catalog version the server reports. */
async function blueprint(
  page: Page,
  name: string,
  essentials: { chassisId?: string; engineId?: string; tireKitId?: string },
  parts: PartSpec[],
  catalogVersion?: string,
): Promise<Record<string, unknown>> {
  const version =
    catalogVersion ??
    (await page.evaluate(async () => {
      const response = await fetch('/api/v1/catalog');
      return ((await response.json()) as { catalogVersion: string }).catalogVersion;
    }));
  return {
    formatVersion: 1,
    catalogVersion: version,
    name,
    chassisId: essentials.chassisId ?? 'chassis_beetle',
    engineId: essentials.engineId ?? 'engine_four_cylinder',
    tireKitId: essentials.tireKitId ?? 'tires_street',
    paintId: 'paint_signal',
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

/** Makes a blueprint the player's last build, as if they had raced it before. */
async function seedLastBuild(page: Page, car: Record<string, unknown>): Promise<void> {
  await page.evaluate((json) => {
    window.localStorage.setItem('bolt.blueprint.v1', json);
    window.localStorage.setItem(
      'bolt.tutorial.v1',
      JSON.stringify({ garage_tips: true, built: true }),
    );
  }, JSON.stringify(car));
}

async function stored(page: Page): Promise<{
  name: string;
  chassisId: string;
  engineId: string;
  tireKitId: string;
  parts: Array<{ partId: string; mountId: string; offsetX: number }>;
}> {
  return JSON.parse(
    (await page.evaluate(() => window.localStorage.getItem('bolt.blueprint.v1'))) ?? '{}',
  );
}

test('first run: a blank browser builds a car in the garage and races it', async ({ page }) => {
  test.slow();
  const problems = collectProblems(page);
  await page.goto(`/${SLOW_CLOCK}`);
  // A first-time player has no last build to reuse.
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Last Build' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Racing' }).tap();

  // Track Preview: everything on it is real track and balance data.
  await expect(page.getByText('Know the road. Build for it.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'NEON CUT', exact: true })).toBeVisible();
  await expect(page.getByText('Clear Night')).toBeVisible();
  await expect(page.getByText('Asphalt: 80%, Cobblestone: 20%')).toBeVisible();
  await expect(page.locator('.preview-tips li')).toHaveCount(2);
  await expect(page.locator('.preview-tips')).toContainText('13% less grip than asphalt');
  await expect(page.getByRole('img', { name: 'Course map of Neon Cut' })).toBeVisible();
  await page.getByRole('button', { name: 'Track Details' }).tap();
  const details = page.getByRole('dialog', { name: 'Track Details' });
  await expect(details).toContainText('Cobblestone');
  await expect(details).toContainText('x0.87');
  await expect(details).toContainText('Cooling');
  await details.getByRole('button', { name: 'Close' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();

  // The garage opens on the legal baseline car with the three first-build highlights.
  await expect(ready(page)).toBeVisible();
  await expect(page.getByTestId('build-timer')).toBeVisible();
  expect(await credits(page)).toBe(630);
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'false');
  await expect(status(page)).toContainText('Ready to Race');
  const coach = page.getByRole('complementary', { name: 'First build' });
  await expect(coach.getByRole('button', { name: /Pick a chassis/ })).toBeVisible();
  await expect(coach.getByRole('button', { name: /Pick your tires/ })).toBeVisible();
  await expect(coach.getByRole('button', { name: /Add a weapon/ })).toBeVisible();
  await expect(coach.getByRole('button', { name: 'Use Starter Car' })).toBeVisible();

  // The scores live in the idle panel, not the header, and the steps are marked on the tiles.
  await expect(page.getByTestId('car-panel').getByTestId('score-speed')).toContainText('66');
  await expect(page.locator('.g-top [data-testid^="score-"]')).toHaveCount(0);
  await expect(tile(page, 'chassis').locator('.g-step')).toHaveText(/1/);
  await expect(tile(page, 'tires').locator('.g-step')).toHaveText(/2/);
  await expect(tile(page, 'mount:front_center').locator('.g-step')).toHaveText(/3/);

  // Change tires. The compare pane shows new spend and refund separately before anything is bought.
  await coach.getByRole('button', { name: /Pick your tires/ }).tap();
  await expect(tile(page, 'tires')).toHaveAttribute('aria-pressed', 'true');
  await expect(list(page)).toContainText('Pick your tires');
  await expect(card(page, 'tires_street')).toContainText('Installed');
  await card(page, 'tires_rain').tap();
  await expect(page.getByTestId('new-spend')).toHaveText('110');
  await expect(page.getByTestId('refund')).toHaveText('80');
  await expect(page.getByTestId('credits-after')).toHaveText('600');
  expect(await credits(page)).toBe(630);
  await page.getByTestId('install').tap();
  await expect.poll(() => credits(page)).toBe(600);
  await expect(status(page)).toContainText('Rain Runners fitted.');
  // Installing returns to the list, and the slot shows the new part.
  await expect(card(page, 'tires_rain')).toContainText('Installed');
  await expect(tile(page, 'tires')).toHaveAttribute('data-part', 'tires_rain');

  // Add a weapon to a chosen mount. Tapping the slot buys nothing; it lists what fits there.
  await tile(page, 'mount:roof_mid').tap();
  expect(await credits(page)).toBe(600);
  await expect(page.getByRole('region', { name: 'Roof middle' })).toBeVisible();
  await expect(list(page).locator('.g-group-head').first()).toContainText('Weapons');
  // A side saw has no business on a roof mount, so it is not offered there, and no row in a
  // slot's list is a part with nowhere to go.
  await expect(card(page, 'weapon_saw')).toHaveCount(0);
  await expect(list(page)).not.toContainText('No compatible mount');
  await card(page, 'weapon_turret').tap();
  await expect(page.getByTestId('new-spend')).toHaveText('130');
  await expect(page.locator('.g-detail').getByTestId('score-firepower')).toHaveClass(/is-better/);
  expect(await credits(page)).toBe(600);
  await page.getByTestId('install').tap();
  await expect.poll(() => credits(page)).toBe(470);
  await expect(tile(page, 'mount:roof_mid')).toHaveAttribute('data-part', 'weapon_turret');
  // The part's card is up, with everything that can be done to it.
  await expect(page.getByRole('region', { name: 'Selected part' })).toContainText('Swivel Turret');

  // Pick a chassis: the parts move across and the tips are done.
  await tile(page, 'chassis').tap();
  await card(page, 'chassis_arrow').tap();
  await expect(page.getByTestId('new-spend')).toHaveText('180');
  await expect(page.getByTestId('refund')).toHaveText('150');
  await page.getByTestId('install').tap();
  await expect.poll(() => credits(page)).toBe(440);
  await expect(status(page)).toContainText('Arrow fitted. Every part moved across.');
  await page.getByTestId('car-stats').tap();
  await expect(page.getByTestId('car-panel')).toBeVisible();
  await expect(coach).toHaveCount(0);
  await expect(page.locator('.slot-tile .g-step')).toHaveCount(0);

  // Ready is offered because the car is legal, and the race starts with exactly this car.
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'false');
  await ready(page).tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('debug')).toContainText('online');
  const raced = await stored(page);
  expect(raced).toMatchObject({ chassisId: 'chassis_arrow', tireKitId: 'tires_rain' });
  expect(raced.parts.map((p) => [p.partId, p.mountId])).toEqual([['weapon_turret', 'roof_mid']]);
  expect(problems).toEqual([]);
});

test('Use Starter Car loads the Rookie build and the tips can be skipped for good', async ({
  page,
}) => {
  await openGarage(page);
  await page.getByRole('button', { name: 'Use Starter Car' }).tap();
  await expect.poll(() => credits(page)).toBe(520);
  await expect(page.locator('.slot-tile[data-part="weapon_front_mg"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'First build' })).toHaveCount(0);
  // One undo step brings the stock car back.
  await page.getByRole('button', { name: 'Undo' }).tap();
  await expect.poll(() => credits(page)).toBe(630);
  await page.reload();
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await expect(ready(page)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'First build' })).toHaveCount(0);
});

test('an over-budget attempt says "Not enough credits" and changes nothing', async ({ page }) => {
  await skipTips(page);
  await page.goto('/?debug=1');
  // 925 of 1,000 credits spent: 75 left.
  await seedLastBuild(
    page,
    await blueprint(page, 'Nearly Broke', {}, [
      ['weapon_turret', 'roof_mid', { assignedActionSlot: 0 }],
      ['defense_heavy_plate', 'front_center'],
      ['defense_heavy_plate', 'rear_center', { rotationQuarterTurns: 2 }],
      ['utility_nitro', 'left_utility'],
      ['utility_overdrive', 'right_utility'],
    ]),
  );
  await openGarage(page);
  expect(await credits(page)).toBe(75);
  await tile(page, 'engine').tap();
  // The row already says why the V12 cannot be bought.
  await expect(card(page, 'engine_v12')).toContainText('Not enough credits');
  await card(page, 'engine_v12').tap();
  await expect(page.getByTestId('blocked-reason')).toHaveText('Not enough credits');
  const install = page.getByTestId('install');
  await expect(install).toHaveAttribute('aria-disabled', 'true');
  // Pressing it anyway is not silently ignored: the reason is announced and nothing is bought.
  await install.tap({ force: true });
  await expect(status(page)).toHaveText(/Not enough credits/);
  await expect(status(page)).toHaveAttribute('data-tone', 'error');
  expect(await credits(page)).toBe(75);
  await page.getByRole('button', { name: 'Parts', exact: true }).tap();
  await expect(card(page, 'engine_four_cylinder')).toContainText('Installed');
  await expect(card(page, 'engine_v12')).not.toContainText('Installed');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // The same goes for a dearer frame.
  await tile(page, 'chassis').tap();
  await expect(card(page, 'chassis_spider')).toContainText('Not enough credits');
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'false');
});

test('an overweight attempt shows the approved sentence and changes nothing', async ({ page }) => {
  await skipTips(page);
  await page.goto('/?debug=1');
  // 655 kg on a Beetle that allows 730 kg, with 220 credits to spare.
  await seedLastBuild(
    page,
    await blueprint(page, 'Heavy', { engineId: 'engine_v8', tireKitId: 'tires_track' }, [
      ['defense_heavy_plate', 'front_center'],
      ['defense_heavy_plate', 'rear_center', { rotationQuarterTurns: 2 }],
    ]),
  );
  await openGarage(page);
  expect(await credits(page)).toBe(220);
  const load = page.locator('.indicator[data-indicator="load"]');
  await expect(load).toContainText('655/730 kg');
  await expect(load).toHaveAttribute('data-status', 'caution');
  await tile(page, 'mount:left_utility').tap();
  const sentence = 'Too heavy for this chassis. Remove weight or swap frames.';
  await expect(card(page, 'utility_ballast')).toContainText(sentence);
  await card(page, 'utility_ballast').tap();
  await expect(page.getByTestId('blocked-reason')).toHaveText(sentence);
  await page.getByTestId('install').tap({ force: true });
  await expect(status(page)).toHaveText(new RegExp(sentence.replace(/\./g, '\\.')));
  expect(await credits(page)).toBe(220);
  await expect(load).toContainText('655/730 kg');
  await expect(occupied(page)).toHaveCount(2);
  // The indicator explains itself in plain English, with the overload warning.
  await page.getByRole('button', { name: 'Parts', exact: true }).tap();
  await load.tap();
  const detail = page.getByTestId('indicator-detail');
  await expect(detail).toContainText('655 kg installed on a frame that recommends 460 kg');
  await expect(detail).toContainText('Over the recommended load.');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

test('undo and redo walk the build back and forth, by button and by keyboard', async ({ page }) => {
  await skipTips(page);
  await openGarage(page);
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await browseBuy(page, 'Utility', 'utility_fan');
  await expect.poll(() => credits(page)).toBe(575);
  await slotBuy(page, 'mount:front_center', 'weapon_front_mg');
  await expect.poll(() => credits(page)).toBe(505);
  await expect(occupied(page)).toHaveCount(2);

  await undo.tap();
  await expect.poll(() => credits(page)).toBe(575);
  await expect(occupied(page)).toHaveCount(1);
  await undo.tap();
  await expect.poll(() => credits(page)).toBe(630);
  await expect(undo).toBeDisabled();
  await redo.tap();
  await redo.tap();
  await expect.poll(() => credits(page)).toBe(505);
  await expect(redo).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect.poll(() => credits(page)).toBe(575);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => credits(page)).toBe(505);

  // Reset asks first, is one step, and can be undone.
  await more(page, 'Reset');
  await expect(page.getByText('Reset to the stock car? You can undo this.')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset' }).tap();
  await expect.poll(() => credits(page)).toBe(630);
  await undo.tap();
  await expect.poll(() => credits(page)).toBe(505);
});

test('a chassis swap carries parts over, refunds the rest and is one undo step', async ({
  page,
}) => {
  await skipTips(page);
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(page, 'Full House', {}, [
      ['weapon_front_mg', 'front_center', { assignedActionSlot: 0 }],
      ['utility_radar', 'roof_mid'],
      ['utility_spare', 'left_utility'],
      ['utility_battery', 'right_utility'],
      ['weapon_rear_mg', 'rear_center', { rotationQuarterTurns: 2 }],
    ]),
  );
  await openGarage(page);
  const before = await credits(page);
  expect(before).toBe(325);
  await expect(occupied(page)).toHaveCount(5);
  await tile(page, 'chassis').tap();
  await card(page, 'chassis_arrow').tap();
  // The preview already says what will not fit.
  const pane = page.locator('.g-detail');
  await expect(pane).toContainText('Will not fit the new frame and will be refunded');
  const after = Number(await page.getByTestId('credits-after').textContent());
  const refund = Number(await page.getByTestId('refund').textContent());
  const spend = Number(await page.getByTestId('new-spend').textContent());
  expect(spend).toBe(180);
  expect(refund).toBeGreaterThan(150);
  expect(after).toBe(before - spend + refund);
  await page.getByTestId('install').tap();
  await expect.poll(() => credits(page)).toBe(after);
  await expect(status(page)).toHaveText(
    /Arrow fitted\. \d parts? did not fit and w(as|ere) refunded: .+\. \d+ credits back\./,
  );
  await expect(status(page)).toHaveAttribute('data-tone', 'warn');
  const kept = await occupied(page).count();
  expect(kept).toBeLessThan(5);
  expect(kept).toBeGreaterThan(0);
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'false');
  // One undo brings back the Beetle with all five parts.
  await page.getByRole('button', { name: 'Undo' }).tap();
  await expect.poll(() => credits(page)).toBe(before);
  await expect(occupied(page)).toHaveCount(5);
});

test('an installed part can be moved, rotated, given a fire button, replaced and removed', async ({
  page,
}) => {
  await skipTips(page);
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(page, 'Gunner', {}, [
      ['weapon_front_mg', 'front_center', { assignedActionSlot: 0 }],
      ['weapon_shotgun', 'roof_mid', { assignedActionSlot: 1 }],
    ]),
  );
  await openGarage(page);
  expect(await credits(page)).toBe(470);
  const gun = page.locator('.slot-tile[data-part="weapon_front_mg"]');
  await gun.tap();
  const tools = page.getByRole('region', { name: 'Selected part' });
  await expect(tools).toContainText('Front Machine Gun');
  await expect(page.getByTestId('part-offset')).toHaveText('0, 0');

  // Nudge with the arrow buttons, inside the mount's region only.
  await tools.getByRole('button', { name: 'Move right' }).tap();
  await tools.getByRole('button', { name: 'Move right' }).tap();
  await expect(page.getByTestId('part-offset')).toHaveText('2, 0');
  await tools.getByRole('button', { name: 'Move right' }).tap();
  await expect(page.getByTestId('part-offset')).toHaveText('2, 0');
  await expect(status(page)).toHaveText(/Too far from the mount\./);
  expect(await credits(page)).toBe(470);

  // Drag it back on the car itself. Nothing is drawn over the part: the handle is invisible.
  // In this view the car's right is down the screen, so dragging up moves the part left.
  const box = (await page.getByTestId('part-grab').boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 24, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(
    ((await page.getByTestId('part-offset').textContent()) ?? '9').split(',')[0],
  );
  expect(dragged).toBeLessThan(2);

  // Rotate steps through the orientations a front mount allows.
  await expect(page.getByTestId('part-facing')).toHaveText('Facing forward');
  await page.getByTestId('rotate-part').tap();
  await expect(page.getByTestId('part-facing')).not.toHaveText('Facing forward');

  // Two fire buttons: giving Secondary to this gun takes it from the shotgun.
  const fire = tools.getByRole('radiogroup', { name: 'Fire button' });
  await expect(fire.getByRole('radio', { name: 'Primary' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await fire.getByRole('radio', { name: 'Secondary' }).tap();
  await expect(fire.getByRole('radio', { name: 'Secondary' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.locator('.slot-tile[data-part="weapon_shotgun"]').tap();
  await expect(fire.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  // The rule is explained on the card.
  await expect(tools).toContainText('Two weapons can have a fire button.');

  // Replace the shotgun: the list shows what fits its mount, and Replace is one transaction.
  await tools.getByRole('button', { name: 'Replace' }).tap();
  await expect(page.getByRole('region', { name: 'Roof middle' })).toBeVisible();
  await expect(card(page, 'weapon_shotgun')).toContainText('Installed');
  await card(page, 'weapon_turret').tap();
  await expect(page.getByTestId('install')).toHaveText('Replace');
  await expect(page.getByTestId('new-spend')).toHaveText('130');
  await expect(page.getByTestId('refund')).toHaveText('90');
  await page.getByTestId('install').tap();
  await expect.poll(() => credits(page)).toBe(430);
  await expect(page.locator('.slot-tile[data-part="weapon_shotgun"]')).toHaveCount(0);

  // Remove returns the full price.
  await expect(tools).toContainText('Swivel Turret');
  await page.getByTestId('remove').tap();
  await expect.poll(() => credits(page)).toBe(560);
  await expect(status(page)).toContainText('Swivel Turret removed. 130 credits back.');
  await expect(occupied(page)).toHaveCount(1);
  // The emptied slot lists what fits it.
  await expect(page.getByRole('region', { name: 'Roof middle' })).toBeVisible();
});

test('the car is clean, and the leader lines follow the rotate-view control', async ({ page }) => {
  await skipTips(page);
  await openGarage(page);
  // Nothing interactive or boxed is drawn over the car until a slot is selected.
  await expect(page.locator('.g-car button')).toHaveCount(0);
  await expect(page.locator('.g-car .socket')).toHaveCount(0);
  await expect(page.locator('.g-car [data-testid="part-grab"]')).toHaveCount(0);
  const bench = page.locator('.g-bench');
  const where = async (mountId: string) => {
    const car = (await page.locator('.g-car').boundingBox())!;
    const end = (await page.locator(`.leader[data-mount="${mountId}"] rect`).boundingBox())!;
    return {
      x: end.x + end.width / 2 - (car.x + car.width / 2),
      y: end.y + end.height / 2 - (car.y + car.height / 2),
    };
  };
  const side = async (mountId: string) => {
    const floor = (await page.locator('.g-floor').boundingBox())!;
    const box = (await tile(page, `mount:${mountId}`).boundingBox())!;
    return box.x + box.width / 2 < floor.x + floor.width / 2 ? 'left' : 'right';
  };
  // A three-quarter view with the nose to the right: the front mount is right of the rear one.
  const views = [await bench.getAttribute('data-view')];
  const front = await where('front_center');
  const rear = await where('rear_center');
  expect(front.x).toBeGreaterThan(rear.x + 60);
  expect(await side('front_center')).toBe('right');
  expect(await side('rear_center')).toBe('left');
  // Each leader ends on the car, inside its drawn box.
  const car = (await page.locator('.g-car').boundingBox())!;
  expect(Math.abs(front.x)).toBeLessThan(car.width / 2);
  expect(Math.abs(front.y)).toBeLessThan(car.height / 2);

  await page.getByRole('button', { name: 'Rotate view' }).tap();
  views.push(await bench.getAttribute('data-view'));
  // Nose to the left now: the leaders and the tiles have swapped sides with it.
  const turned = { front: await where('front_center'), rear: await where('rear_center') };
  expect(turned.front.x).toBeLessThan(turned.rear.x - 60);
  expect(await side('front_center')).toBe('left');
  // Tiles still work in the turned view, and an empty selected slot shows a socket on the car.
  await tile(page, 'mount:front_center').tap();
  await expect(page.getByRole('region', { name: 'Front center' })).toBeVisible();
  await expect(page.locator('.g-car .socket')).toHaveCount(1);
  await expect(page.locator('.leader.is-selected')).toHaveAttribute('data-mount', 'front_center');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Rotate view' }).tap();
    views.push(await bench.getAttribute('data-view'));
  }
  expect(new Set(views).size).toBe(4);
  await page.getByRole('button', { name: 'Rotate view' }).tap();
  const again = await where('front_center');
  expect(Math.abs(again.x - front.x)).toBeLessThan(2);
  expect(Math.abs(again.y - front.y)).toBeLessThan(2);
});

test('chassis without art are listed as "Art in progress" and cannot be picked', async ({
  page,
}) => {
  await skipTips(page);
  // The artists are filling the atlas as this is written. To test the rule whatever they
  // have finished, three frames are taken out of the manifest the page receives.
  const withheld = ['chassis_brick', 'chassis_trike', 'chassis_platform'];
  await page.route('**/atlases/cars/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as { chassis: Record<string, unknown> };
    for (const id of withheld) delete manifest.chassis[id];
    await route.fulfill({ response, json: manifest });
  });
  await openGarage(page);
  await tile(page, 'chassis').tap();
  const drawable = await page.evaluate(async () => {
    const response = await fetch('assets/atlases/cars/manifest.json');
    return Object.keys(((await response.json()) as { chassis: object }).chassis);
  });
  const all = await page.locator('.part-card').evaluateAll((cards) =>
    cards.map((c) => ({
      id: c.getAttribute('data-part') ?? '',
      pending: c.classList.contains('is-pending'),
    })),
  );
  // All twenty frames are listed; exactly the ones the atlas cannot draw are held back.
  expect(all).toHaveLength(20);
  for (const entry of all) expect(entry.pending, entry.id).toBe(!drawable.includes(entry.id));
  for (const id of withheld) expect(all.find((entry) => entry.id === id)?.pending, id).toBe(true);
  const held = card(page, 'chassis_trike');
  await expect(held).toContainText('Art in progress');
  await expect(held).toHaveAttribute('aria-disabled', 'true');
  await held.tap({ force: true });
  await expect(page.locator('.g-detail')).toHaveCount(0);
  expect(await credits(page)).toBe(630);
  // A frame with art, right beside it, can be picked as usual.
  await card(page, 'chassis_arrow').tap();
  await expect(page.getByTestId('install')).toHaveText('Swap');
  await page.getByRole('button', { name: 'Parts', exact: true }).tap();
  await expect(list(page)).toBeVisible();
});

test('the build clock warns at ten seconds, locks at zero and starts the race', async ({
  page,
}) => {
  await skipTips(page);
  await openGarage(page, '?debug=1&buildSeconds=9');
  const timer = page.getByTestId('build-timer');
  await expect(timer).toHaveClass(/is-urgent/);
  await expect(status(page)).toContainText('10 seconds. Finish your build.');
  // An edit made before the lock is part of what races.
  await browseBuy(page, 'Utility', 'utility_fan');
  await expect.poll(() => credits(page)).toBe(575);
  await expect(page.getByText('Build locked. Time to race.').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  const raced = await stored(page);
  expect(raced.parts.map((p) => p.partId)).toEqual(['utility_fan']);
});

test('at zero an illegal draft is not raced: the last legal car is', async ({ page }) => {
  await skipTips(page);
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(page, 'Legal Eagle', {}, [['utility_fan', 'roof_mid']]),
  );
  // A saved build from an older catalog, with a hammer that no longer fits its mount.
  const stale = await blueprint(
    page,
    'Old Faithful',
    { engineId: 'engine_v8' },
    [
      ['weapon_hammer', 'front_center', { assignedActionSlot: 0 }],
      ['utility_nitro', 'left_utility'],
    ],
    '0.2.0',
  );
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
    JSON.stringify(stale),
  );
  await page.goto('/?debug=1&buildSeconds=8');
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  const saved = page.getByRole('article', { name: 'Old Faithful' });
  await expect(saved).toContainText('This build uses older part values. Review it before racing.');
  await expect(saved.getByRole('button', { name: 'Use', exact: true })).toHaveCount(0);
  await saved.getByRole('button', { name: 'Review' }).tap();

  // In the garage the draft is shown as it is: Ready is held back and says why.
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.slot-tile.is-bad[data-part="weapon_hammer"]')).toBeVisible();
  await ready(page).tap({ force: true });
  await expect(ready(page)).toBeVisible();
  await expect(page.locator('.hud')).toHaveCount(0);
  await expect(page.getByText('Build locked. Time to race.').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('debug')).toContainText('online');
  expect((await stored(page)).name).toBe('Legal Eagle');
});

test('the test clock is ignored without the debug flag', async ({ page }) => {
  await openGarage(page, '?buildSeconds=3');
  const seconds = Number(await page.getByTestId('build-timer').getAttribute('data-seconds'));
  expect(seconds).toBeGreaterThan(50);
  expect(seconds).toBeLessThanOrEqual(60);
  await expect(page.getByTestId('build-timer')).not.toHaveClass(/is-urgent/);
});

test('an illegal build is flagged, Ready is held back, and Repair Build fixes it', async ({
  page,
}) => {
  await skipTips(page);
  await page.goto('/?debug=1');
  const stale = await blueprint(
    page,
    'Old Faithful',
    { engineId: 'engine_v8' },
    [
      ['weapon_hammer', 'front_center', { assignedActionSlot: 0 }],
      ['utility_nitro', 'left_utility'],
    ],
    '0.2.0',
  );
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
    JSON.stringify(stale),
  );
  await page.goto(`/${SLOW_CLOCK}`);
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await page
    .getByRole('article', { name: 'Old Faithful' })
    .getByRole('button', { name: 'Review' })
    .tap();
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(status(page)).toContainText(
    'This build uses older part values. Review it before racing.',
  );
  await expect(status(page)).toHaveAttribute('data-tone', 'error');
  // The exact offending slot is marked, with a warning badge and a red leader to the car.
  await expect(page.locator('.slot-tile.is-bad')).toHaveCount(1);
  await expect(page.locator('.slot-tile.is-bad')).toHaveAttribute('data-part', 'weapon_hammer');
  await expect(page.locator('.slot-tile.is-bad .slot-alert')).toBeVisible();
  await expect(page.locator('.leader.is-bad')).toHaveAttribute('data-mount', 'front_center');
  // The idle panel says the car is not ready and why, and pressing Ready says it again.
  await expect(page.getByTestId('car-panel')).toContainText('Not ready');
  await expect(page.getByTestId('car-panel')).toContainText('older part values');
  await ready(page).tap({ force: true });
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toContainText('older part values');
  // With a slot open the reason stays up as one line over the workbench.
  await tile(page, 'chassis').tap();
  await expect(status(page)).toBeVisible({ timeout: 15_000 });
  await expect(status(page)).toContainText('older part values');
  await page.getByTestId('car-stats').tap();
  await page.getByTestId('car-panel').getByRole('button', { name: 'Repair Build' }).tap();
  await expect(status(page)).toContainText('Build repaired. Removed and refunded: Crash Hammer.');
  await expect(page.locator('.slot-tile.is-bad')).toHaveCount(0);
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'false');
  await expect(occupied(page)).toHaveCount(1);
});

test('My Blueprints saves, duplicates, renames and deletes across reloads', async ({ page }) => {
  await skipTips(page);
  await openGarage(page);
  await browseBuy(page, 'Weapons', 'weapon_front_mg');
  await expect.poll(() => credits(page)).toBe(560);

  // Name it in the garage, with the safe character set.
  await more(page, 'Paint and Name');
  const name = page.getByRole('dialog', { name: 'Paint and Name' });
  await name.getByRole('radio', { name: 'Mint' }).tap();
  await name.getByLabel('Car name').fill('Mint <Gun>!');
  await expect(name.getByLabel('Car name')).toHaveValue('Mint Gun!');
  await name.getByRole('button', { name: 'Done' }).tap();
  await page.getByTestId('car-stats').tap();
  await expect(page.getByTestId('car-name')).toHaveText('Mint Gun!');
  // The name on the idle panel opens the same dialog.
  await page.getByRole('button', { name: /^Paint and Name/ }).tap();
  await page
    .getByRole('dialog', { name: 'Paint and Name' })
    .getByRole('button', { name: 'Cancel' })
    .tap();

  await more(page, /^Save/);
  const library = page.getByRole('dialog', { name: 'My Blueprints' });
  await expect(library.getByText('No saved cars yet.')).toBeVisible();
  await library.getByRole('button', { name: 'Save This Car' }).tap();
  await expect(library.getByRole('status')).toHaveText('Saved to My Blueprints.');
  const saved = library.getByRole('article', { name: 'Mint Gun!', exact: true });
  await expect(saved).toContainText('440 credits');
  await expect(saved.locator('canvas')).toBeVisible();
  // Saving the very same car again is refused, not duplicated.
  await library.getByRole('button', { name: 'Save This Car' }).tap();
  await expect(library.getByRole('status')).toHaveText('This car is already saved.');
  await expect(library.getByRole('article')).toHaveCount(1);
  // There is no share-code control: codes need the server.
  await expect(library.getByText(/code/i)).toHaveCount(0);
  // Starter cars are one tab away.
  await library.getByRole('tab', { name: 'Starter Cars' }).tap();
  await expect(library.getByRole('article', { name: 'Rookie' })).toBeVisible();
  await expect(library.getByRole('article', { name: 'Sprinter' })).toBeVisible();
  await library.getByRole('button', { name: 'Close' }).tap();
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(
    page.getByText("Leave the garage? Changes you haven't saved will be lost."),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Leave Garage' }).tap();

  // From Home, after a reload: the card is still there.
  await page.reload();
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await expect(page.getByRole('article')).toHaveCount(1);
  const first = page.getByRole('article', { name: 'Mint Gun!', exact: true });
  await first.getByRole('button', { name: 'Duplicate' }).tap();
  await expect(page.getByRole('status')).toHaveText('Copied as Mint Gun! 2.');
  await expect(page.getByRole('article')).toHaveCount(2);
  const copy = page.getByRole('article', { name: 'Mint Gun! 2' });
  await copy.getByRole('button', { name: 'Rename' }).tap();
  const rename = page.getByRole('dialog', { name: 'Rename' });
  await rename.getByLabel('Car name').fill('Spare Car');
  await rename.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('article', { name: 'Spare Car' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await expect(page.getByRole('article')).toHaveCount(2);
  // Delete asks first; Keep It keeps it.
  await first.getByRole('button', { name: 'Delete' }).tap();
  await expect(page.getByText('Delete Mint Gun!? This cannot be undone.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep It' }).tap();
  await expect(page.getByRole('article')).toHaveCount(2);
  await first.getByRole('button', { name: 'Delete' }).tap();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).tap();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await expect(page.getByRole('article')).toHaveCount(1);

  // Use makes it the car on the home screen.
  await page
    .getByRole('article', { name: 'Spare Car' })
    .getByRole('button', { name: 'Use', exact: true })
    .tap();
  await expect(page.getByTestId('home-car-name')).toHaveText('Spare Car');
  expect((await stored(page)).parts.map((p) => p.partId)).toEqual(['weapon_front_mg']);
});

test('corrupt blueprint storage is an empty garage, not a broken page', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');
  await page.evaluate(() =>
    window.localStorage.setItem('bolt.blueprints.v1', '{"version":1,"items":[{"id":"<x>"},7,nul'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await expect(page.getByText('No saved cars yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Save This Car' }).tap();
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(problems).toEqual([]);
});

test('a returning player races in three taps, and in one with Use Last Build', async ({ page }) => {
  test.slow();
  await page.goto('/?debug=1');
  let taps = 0;
  const tap = async (name: string) => {
    taps++;
    await page.getByRole('button', { name, exact: true }).tap();
  };
  // Through the full flow: Start Racing, Build Your Car, Ready.
  await tap('Start Racing');
  await tap('Build Your Car');
  await tap('Ready');
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  expect(taps).toBe(3);

  // Back home, the last build is offered next to the primary action.
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Leave Race' }).tap();
  await page.getByRole('button', { name: 'Leave Race' }).tap();
  await expect(page.getByRole('button', { name: 'Use Last Build' })).toBeVisible();
  await page.reload();
  taps = 0;
  await tap('Use Last Build');
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  expect(taps).toBe(1);
  await expect(page.getByTestId('debug')).toContainText('online');
});

test('Quick Build on the home screen races a starter car straight away', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'Quick Build' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Pick a starter and go' });
  await expect(sheet.getByRole('article')).toHaveCount(4);
  await sheet.getByRole('button', { name: 'Race This Car: Sprinter' }).tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  expect(await stored(page)).toMatchObject({ name: 'Sprinter', chassisId: 'chassis_arrow' });
});

test('after a race, Change My Build returns to the garage with the same car and a fresh clock', async ({
  page,
}) => {
  // A whole three-lap race on autopilot, in real time.
  test.setTimeout(420_000);
  await page.goto('/?debug=1');
  // The Straight-Line Rocket of Section 11.9: the quickest shipped build around Neon Cut.
  await seedLastBuild(
    page,
    await blueprint(
      page,
      'Lap Runner',
      { chassisId: 'chassis_arrow', engineId: 'engine_v8', tireKitId: 'tires_slick' },
      [
        ['weapon_front_mg', 'front_center', { assignedActionSlot: 0 }],
        ['utility_nitro', 'roof_mid'],
        ['utility_fan', 'roof_rear'],
      ],
    ),
  );
  await page.goto('/?debug=1&autopilot=1&buildSeconds=30');
  await page.getByRole('button', { name: 'Use Last Build' }).tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  const change = page.getByRole('button', { name: 'Change My Build' });
  await expect(change).toBeVisible({ timeout: 300_000 });
  await expect(page.getByRole('button', { name: 'Race Again' })).toBeVisible();
  await change.tap();
  await expect(ready(page)).toBeVisible();
  await expect(page.getByTestId('car-name')).toHaveText('Lap Runner');
  expect(await credits(page)).toBe(275);
  await expect(occupied(page)).toHaveCount(3);
  const seconds = Number(await page.getByTestId('build-timer').getAttribute('data-seconds'));
  expect(seconds).toBeGreaterThan(25);
  await ready(page).tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
});

test('the whole garage can be driven from the keyboard', async ({ page }) => {
  await skipTips(page);
  await openGarage(page);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        role: el?.getAttribute('role') ?? '',
        part: el?.getAttribute('data-part') ?? '',
        slot: el?.getAttribute('data-slot') ?? '',
        testid: el?.getAttribute('data-testid') ?? '',
        label: el?.getAttribute('aria-label') ?? el?.textContent ?? '',
        isCard: el?.classList.contains('part-card') ?? false,
      };
    });
  const tabUntil = async (hit: (f: Awaited<ReturnType<typeof focused>>) => boolean, max = 60) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      if (hit(await focused())) return;
    }
    throw new Error('focus never reached the control');
  };

  // Tab reaches the slot tiles; Enter opens the slot's list and buys nothing.
  await tabUntil((f) => f.slot === 'mount:front_center');
  expect((await focused()).label).toBe('Empty mount: Front center');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Front center' })).toBeVisible();
  expect(await credits(page)).toBe(630);

  // Tab on to the first row and open it with Enter: focus lands on Install.
  await tabUntil((f) => f.part === 'weapon_front_mg' && f.isCard);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('install')).toBeFocused();
  expect(await credits(page)).toBe(630);
  await page.keyboard.press('Enter');
  await expect.poll(() => credits(page)).toBe(560);

  // Focus is now on the part's slot tile, where the arrow keys nudge it and R turns it.
  await expect(tile(page, 'mount:front_center')).toBeFocused();
  await expect(tile(page, 'mount:front_center')).toHaveAttribute('data-part', 'weapon_front_mg');
  await expect(page.getByTestId('part-offset')).toHaveText('0, 0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('part-offset')).toHaveText('1, 1');
  await page.keyboard.press('r');
  await expect(page.getByTestId('part-facing')).not.toHaveText('Facing forward');

  // Escape lets go of the part and returns to the whole car.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Selected part' })).toHaveCount(0);
  await expect(page.getByTestId('car-panel')).toBeVisible();

  // The whole catalog is a tab list: arrow keys move between categories.
  await tabUntil((f) => f.label.includes('Browse All Parts'));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Weapons' })).toHaveAttribute('aria-selected', 'true');
  await tabUntil((f) => f.role === 'tab');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Defense' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Defense' })).toBeFocused();

  // A dialog opens and closes from the keyboard too.
  await tabUntil((f) => f.label.startsWith('Heat:'));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('indicator-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('indicator-detail')).toHaveCount(0);
  await expect(page.locator('.indicator[data-indicator="heat"]')).toBeFocused();

  // And Ready starts the race.
  await tabUntil((f) => f.testid === 'ready');
  await page.keyboard.press('Enter');
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
});

test('Browse All Parts shows the whole catalog, says why a part cannot go on, and where one can', async ({
  page,
}) => {
  await skipTips(page);
  await openGarage(page);
  await page.getByTestId('car-panel').getByRole('button', { name: 'Browse All Parts' }).tap();
  // Six categories; all twenty-odd weapons, whatever this chassis can carry.
  await expect(page.getByRole('tab')).toHaveCount(6);
  await expect(page.getByRole('tab', { name: 'Weapons' })).toHaveAttribute('aria-selected', 'true');
  // Far more than the roof or the nose of a Beetle would list on their own.
  expect(await page.locator('.part-card').count()).toBeGreaterThanOrEqual(20);
  // A part with a free mount says where it will go; one with none says so.
  await expect(card(page, 'weapon_front_mg')).toContainText('Goes on Front center');
  await expect(card(page, 'weapon_turret')).toContainText('Goes on Roof middle');
  const homeless = page.locator('.part-card.is-blocked', { hasText: 'No compatible mount' });
  expect(await homeless.count()).toBeGreaterThan(0);
  await homeless.first().tap();
  await expect(page.getByTestId('no-mount')).toContainText('This chassis has no mount for it.');
  await expect(page.getByTestId('install')).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Parts', exact: true }).tap();

  // Installing from here uses the free mount it named, or another the player picks.
  await card(page, 'weapon_turret').tap();
  const pick = page.getByRole('radiogroup', { name: 'Mount' });
  await expect(pick.getByRole('radio', { name: /Roof middle/ })).toBeVisible();
  await page.getByTestId('install').tap();
  await expect.poll(() => credits(page)).toBe(500);
  await expect(tile(page, 'mount:roof_mid')).toHaveAttribute('data-part', 'weapon_turret');

  // The same entry closes every slot's list.
  await tile(page, 'mount:front_center').tap();
  await page.getByTestId('browse-all').scrollIntoViewIfNeeded();
  await page.getByTestId('browse-all').tap();
  await page.getByRole('tab', { name: 'Chassis' }).tap();
  await expect(page.locator('.part-card')).toHaveCount(20);
  // With the only mount it fits taken, a part offers to replace what is there.
  await page.getByRole('tab', { name: 'Weapons' }).tap();
  await expect(card(page, 'weapon_emp')).toContainText('Replaces Swivel Turret on Roof middle');
  await card(page, 'weapon_emp').tap();
  await expect(page.getByTestId('install')).toHaveText('Replace');
  await expect(
    page.getByRole('radiogroup', { name: 'Mount' }).getByRole('radio', { name: /Roof middle/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('refund')).toHaveText('130');
});

/** Controls that must always be whole and on screen, whatever the pane shows. */
const FIXED_CONTROLS =
  '.g-top button, .g-top .g-timer, .g-top .g-track, .g-ready, .g-bottom button, ' +
  '.g-floor > .slot-tile, .g-bench-tools button, .g-pane-head button, .g-pane-foot button, ' +
  '.g-tools button, .g-carpanel-head button, .g-list, .g-detail, .g-tools, .g-carpanel';

/** Every interactive control of the garage, for touch-target size. */
const TARGETS =
  '.g-top button, .g-ready, .g-bottom button, .slot-tile, .g-pane-head button, ' +
  '.g-pane-foot button, .g-tools button, .g-carpanel button, .chip, .g-browse-row, .g-tab, ' +
  '.g-coach-line button';

type LayoutOptions = {
  /** Portrait: the essentials row scrolls sideways, so its tiles may be off screen. */
  portrait?: boolean;
};

async function assertLayout(page: Page, label: string, options: LayoutOptions = {}): Promise<void> {
  // Let the car canvas finish drawing before its pixels are read.
  await expect(page.locator('.g-car')).toBeVisible();
  await page.waitForTimeout(150);
  const report = await page.evaluate(
    ({ fixed, targets, portrait }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const out: string[] = [];
      const name = (el: Element) =>
        `${(el as HTMLElement).className} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`;
      const root = document.scrollingElement!;
      if (root.scrollWidth > vw) out.push(`page scrolls sideways: ${root.scrollWidth} > ${vw}`);
      if (root.scrollHeight > vh) out.push(`page scrolls down: ${root.scrollHeight} > ${vh}`);
      const row = document.querySelector('.g-slot-row')!.getBoundingClientRect();
      if (!portrait && row.right > vw + 0.5) out.push('the slot row runs off the screen');
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(fixed))) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.left < -0.5 || box.top < -0.5 || box.right > vw + 0.5 || box.bottom > vh + 0.5)
          out.push(
            `outside the viewport: ${name(el)} ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.right)},${Math.round(box.bottom)}`,
          );
      }
      // The essentials: on screen in landscape, inside their scrolling row in portrait.
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>('.g-slot-row .slot-tile'),
      )) {
        const box = el.getBoundingClientRect();
        if (box.top < row.top - 0.5 || box.bottom > row.bottom + 0.5)
          out.push(`out of its row: ${name(el)}`);
        if (!portrait && (box.left < -0.5 || box.right > vw + 0.5))
          out.push(`outside the viewport: ${name(el)}`);
      }
      // Text that does not fit its control is clipped text.
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>(
          '.g-top button, .g-ready, .g-bottom button, .g-pane-head button, .g-pane-foot button, .g-tools button, .g-carpanel .btn, .chip, .g-tab',
        ),
      )) {
        if (el.getBoundingClientRect().width === 0) continue;
        if (el.scrollWidth > el.clientWidth + 1)
          out.push(`clipped: ${name(el)} ${el.scrollWidth} > ${el.clientWidth}`);
      }
      // Touch targets: 48 pixels for the main controls, 44 for dense secondary ones.
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(targets))) {
        const box = el.getBoundingClientRect();
        if (box.width === 0) continue;
        if (box.height < 43.5 || box.width < 43.5)
          out.push(`small target: ${name(el)} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.part-card'))) {
        const box = el.getBoundingClientRect();
        if (box.height < 47.5) out.push(`short row: ${name(el)} ${box.height}`);
      }
      // Ready is the one primary control, the tallest in the header, a full 48 pixels.
      const readyEl = document.querySelector<HTMLElement>('[data-testid="ready"]')!;
      const readyBox = readyEl.getBoundingClientRect();
      if (readyBox.height < 48 || readyBox.width < 100)
        out.push(
          `Ready is too small: ${Math.round(readyBox.width)}x${Math.round(readyBox.height)}`,
        );
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.g-top button'))) {
        const box = el.getBoundingClientRect();
        if (box.height >= readyBox.height) out.push(`as tall as Ready: ${name(el)}`);
        if (el.classList.contains('btn-primary')) out.push(`a second primary: ${name(el)}`);
      }
      // Nothing overlaps Ready or the credits.
      for (const id of ['ready', 'credits-left']) {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!top || !(el === top || el.contains(top))) out.push(`${id} is covered`);
        if (box.left < -0.5 || box.top < -0.5 || box.right > vw + 0.5 || box.bottom > vh + 0.5)
          out.push(`${id} is off screen`);
      }

      // The car as it is really drawn: the bounding box of its opaque pixels.
      const canvas = document.querySelector<HTMLCanvasElement>('.g-car canvas');
      const floor = document.querySelector('.g-floor')!.getBoundingClientRect();
      let drawn: DOMRect | null = null;
      if (canvas) {
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let x0 = canvas.width;
        let y0 = canvas.height;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++)
            if (data[(y * canvas.width + x) * 4 + 3]! > 0) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
        const at = canvas.getBoundingClientRect();
        const k = at.width / canvas.width;
        if (x1 < 0) out.push('the car is not drawn');
        else
          drawn = new DOMRect(
            at.left + x0 * k,
            at.top + y0 * k,
            (x1 + 1 - x0) * k,
            (y1 + 1 - y0) * k,
          );
        if (!Number.isInteger(k) || k < 2) out.push(`car scale is ${k}`);
      } else out.push('no car canvas');
      if (drawn) {
        if (
          drawn.left < floor.left - 0.5 ||
          drawn.right > floor.right + 0.5 ||
          drawn.top < floor.top - 0.5 ||
          drawn.bottom > floor.bottom + 0.5
        )
          out.push(
            `the car is cut off: ${Math.round(drawn.left - floor.left)},${Math.round(drawn.top - floor.top)} ${Math.round(drawn.right - floor.left)},${Math.round(drawn.bottom - floor.top)} on a ${Math.round(floor.width)}x${Math.round(floor.height)} floor`,
          );
      }
      // No slot tile overlaps the drawn car or another tile.
      const tiles = Array.from(
        document.querySelectorAll<HTMLElement>('.g-floor .slot-tile, .g-bench-tools .slot-tile'),
      );
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      // A tile in a scrolling column counts for the part of it that shows.
      const shown = (el: HTMLElement): DOMRect | null => {
        const box = el.getBoundingClientRect();
        const column = el.closest('.g-column')?.getBoundingClientRect();
        if (!column) return box;
        const top = Math.max(box.top, column.top);
        const bottom = Math.min(box.bottom, column.bottom);
        return bottom > top ? new DOMRect(box.left, top, box.width, bottom - top) : null;
      };
      tiles.forEach((el, i) => {
        const box = shown(el);
        if (!box) return;
        if (drawn && hit(box, drawn)) out.push(`on the car: ${name(el)}`);
        for (const other of tiles.slice(i + 1)) {
          const second = shown(other);
          if (second && hit(box, second)) out.push(`tiles overlap: ${name(el)} and ${name(other)}`);
        }
      });
      return out;
    },
    { fixed: FIXED_CONTROLS, targets: TARGETS, portrait: options.portrait === true },
  );
  expect(report, label).toEqual([]);
}

/** Part rows that are whole and inside the list's visible area. */
async function visibleRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const listBox = document.querySelector('[data-testid="part-list"]')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.part-card')).filter((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + 2);
      const bottom = document.elementFromPoint(box.left + box.width / 2, box.bottom - 2);
      return (
        box.top >= listBox.top - 0.5 &&
        box.bottom <= Math.min(listBox.bottom, window.innerHeight) + 0.5 &&
        el.contains(top) &&
        el.contains(bottom)
      );
    }).length;
  });
}

for (const size of [
  { width: 870, height: 370, rows: 5 },
  { width: 870, height: 340, rows: 5 },
  { width: 844, height: 390, rows: 5 },
  { width: 667, height: 375, rows: 5 },
  { width: 932, height: 430, rows: 5 },
  { width: 1024, height: 768, rows: 10 },
  { width: 1440, height: 900, rows: 12 },
]) {
  test(`garage layout holds at ${size.width} x ${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openGarage(page);
    await expect(ready(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('credits-left')).toBeInViewport({ ratio: 1 });
    await assertLayout(page, 'first visit, with the tips');
    await page.getByRole('button', { name: 'Skip tips' }).tap();
    await assertLayout(page, 'idle');
    const bench = (await page.locator('.g-bench').boundingBox())!;
    const panel = (await page.locator('.g-panel').boundingBox())!;
    // The workbench has about half the width, and the car is the largest thing on it.
    expect(bench.width / (bench.width + panel.width)).toBeGreaterThan(0.44);
    expect(bench.width / (bench.width + panel.width)).toBeLessThan(0.57);

    // The floor is the size the unit-tested layout is checked at (`landscapeFloor`).
    const floor = await page
      .locator('.g-floor')
      .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
    if (size.width === 870 && size.height === 340)
      expect(floor).toEqual({ width: 462, height: 189 });
    if (size.width === 844) expect(floor).toEqual({ width: 447, height: 228 });

    // A slot selected: its parts, and at least five whole rows of them.
    await tile(page, 'mount:roof_mid').tap();
    await assertLayout(page, 'slot list');
    expect(await visibleRows(page)).toBeGreaterThanOrEqual(size.rows);
    await tile(page, 'chassis').tap();
    await assertLayout(page, 'chassis list');
    expect(await visibleRows(page)).toBeGreaterThanOrEqual(size.rows);

    // The list scrolls inside its panel; the page does not move.
    const scrolled = await list(page).evaluate((el) => {
      el.scrollTop = 400;
      return { list: el.scrollTop, page: document.scrollingElement!.scrollTop };
    });
    expect(scrolled.list).toBeGreaterThan(100);
    expect(scrolled.page).toBe(0);

    await tile(page, 'mount:roof_mid').tap();
    await card(page, 'weapon_turret').tap();
    await assertLayout(page, 'compare pane');
    const before = await page.locator('.g-floor').boundingBox();
    await page.getByTestId('install').tap();
    const tools = page.getByRole('region', { name: 'Selected part' });
    await expect(tools).toBeVisible();
    await assertLayout(page, 'part card');
    // Messages appear without moving the layout.
    expect(await page.locator('.g-floor').boundingBox()).toEqual(before);
    // Everything on the card is there without scrolling, on any phone 370 pixels tall or more.
    if (size.height >= 370) {
      const fits = await page
        .locator('.g-tools-body')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
      expect(fits, 'the part card scrolls').toBe(true);
      for (const name of ['Primary', 'Secondary', 'Auto', 'Off'])
        await expect(tools.getByRole('radio', { name })).toBeInViewport({ ratio: 1 });
      for (const name of ['Move forward', 'Move back', 'Rotate', 'Replace', /^Remove/])
        await expect(tools.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('part-offset')).toBeInViewport({ ratio: 1 });
    }
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Rotate view' }).tap();
      await assertLayout(page, `view turned ${i + 1}`);
    }
    await more(page, 'Browse All Parts');
    await assertLayout(page, 'browse all parts');
    await page.getByRole('button', { name: 'More', exact: true }).tap();
    const menu = page.getByRole('dialog', { name: 'More' });
    for (const name of ['Paint and Name', /^Save/, 'Quick Build', 'Reset', 'Browse All Parts'])
      await expect(
        menu.getByRole('button', { name, exact: typeof name === 'string' }),
      ).toBeInViewport({ ratio: 1 });
    await expect(ready(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('credits-left')).toBeInViewport({ ratio: 1 });
  });
}

/** Frames with many mounts: the Crab filled as far as 1,000 credits go, and the ten-mount Platform. */
const CRAB: PartSpec[] = [
  ['weapon_front_mg', 'left_front', { rotationQuarterTurns: 3, assignedActionSlot: 0 }],
  ['weapon_rear_mg', 'left_mid', { rotationQuarterTurns: 3 }],
  ['weapon_shotgun', 'left_rear', { rotationQuarterTurns: 3 }],
  ['weapon_foam', 'right_front', { rotationQuarterTurns: 1, assignedActionSlot: 1 }],
  ['weapon_air', 'right_mid', { rotationQuarterTurns: 1 }],
  ['weapon_tesla', 'right_rear'],
  ['utility_spare', 'roof_front'],
];
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

for (const frame of [
  {
    name: 'Crab',
    chassisId: 'chassis_crab',
    engineId: 'engine_four_cylinder',
    parts: CRAB,
    mounts: 8,
  },
  {
    name: 'Platform',
    chassisId: 'chassis_platform',
    engineId: 'engine_v6',
    parts: PLATFORM,
    mounts: 10,
  },
]) {
  test(`every slot of a loaded ${frame.name} has its own tile, clear of the car, on every phone`, async ({
    page,
  }) => {
    test.slow();
    await skipTips(page);
    await page.goto('/?debug=1');
    await seedLastBuild(
      page,
      await blueprint(
        page,
        `Full ${frame.name}`,
        { chassisId: frame.chassisId, engineId: frame.engineId },
        frame.parts,
      ),
    );
    for (const size of [
      { width: 870, height: 370 },
      { width: 870, height: 340 },
      { width: 844, height: 390 },
      { width: 667, height: 375 },
      { width: 932, height: 430 },
    ]) {
      await page.setViewportSize(size);
      await openGarage(page);
      const where = `${size.width} x ${size.height}`;
      await expect(ready(page), where).toHaveAttribute('aria-disabled', 'false');
      await expect(page.locator('.slot-tile[data-mount]'), where).toHaveCount(frame.mounts);
      await expect(occupied(page), where).toHaveCount(frame.parts.length);
      const scrolls = (await page.locator('.g-floor').getAttribute('data-scroll')) === 'true';
      // Only the ten-mount frame on the narrowest phone needs its columns to scroll.
      expect(scrolls, where).toBe(frame.mounts > 8 && size.width < 700);
      if (!scrolls) await expect(page.locator('.leader'), where).toHaveCount(frame.mounts);
      for (let turn = 0; turn < 4; turn++) {
        await assertLayout(page, `${where}, view ${turn}`);
        await page.getByRole('button', { name: 'Rotate view' }).tap();
      }
      // Every tile can be reached and selects its own part.
      for (const [partId, mountId] of frame.parts) {
        const slot = tile(page, `mount:${mountId}`);
        await slot.scrollIntoViewIfNeeded();
        await slot.tap();
        await expect(slot, `${where} ${mountId}`).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.g-tools'), `${where} ${mountId}`).toHaveAttribute(
          'data-instance',
          /.+/,
        );
        await expect(slot).toHaveAttribute('data-part', partId);
      }
      await assertLayout(page, `${where}, a part selected`);
    }
  });
}

test('portrait: the car is a strip, the slots are one row, and six parts show', async ({
  page,
}) => {
  await page.setViewportSize({ width: 450, height: 840 });
  await openGarage(page);
  await expect(ready(page)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('credits-left')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.g-car canvas')).toBeInViewport({ ratio: 0.6 });
  await assertLayout(page, 'first visit', { portrait: true });
  // The car takes about thirty percent of the height; no leaders, no tiles around it.
  const floor = (await page.locator('.g-floor').boundingBox())!;
  expect(floor.height / 840).toBeGreaterThan(0.26);
  expect(floor.height / 840).toBeLessThan(0.34);
  await expect(page.locator('.leader')).toHaveCount(0);
  await expect(page.locator('.g-floor > .slot-tile')).toHaveCount(0);
  // One row: the mounts in car order, then Chassis, Engine and Wheels.
  const order = await page
    .locator('.g-slot-row .slot-tile')
    .evaluateAll((tiles) => tiles.map((t) => t.getAttribute('data-slot')));
  expect(order).toEqual([
    'mount:front_center',
    'mount:left_utility',
    'mount:roof_mid',
    'mount:right_utility',
    'mount:rear_center',
    'chassis',
    'engine',
    'tires',
  ]);
  const tops = await page
    .locator('.g-slot-row .slot-tile')
    .evaluateAll((tiles) => tiles.map((t) => Math.round(t.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // The first-build tips are one line: the current step, the starter car and Skip.
  const coach = page.getByRole('complementary', { name: 'First build' });
  expect((await coach.boundingBox())!.height).toBeLessThanOrEqual(52);
  await expect(coach.getByRole('button', { name: /Pick a chassis/ })).toBeVisible();
  await expect(coach.getByRole('button', { name: 'Use Starter Car' })).toBeVisible();

  // With the tips still up, a selected slot shows six whole rows.
  await tile(page, 'mount:roof_mid').tap();
  await expect(page.locator('.g-car .socket')).toHaveCount(1);
  expect(await visibleRows(page)).toBeGreaterThanOrEqual(6);
  await coach.getByRole('button', { name: 'Skip tips' }).tap();
  await expect(coach).toHaveCount(0);
  await assertLayout(page, 'slot list', { portrait: true });
  expect(await visibleRows(page)).toBeGreaterThanOrEqual(6);
  // The gauges are one thin row directly above Ready.
  const gauges = (await page.locator('.g-bottom').boundingBox())!;
  const readyBox = (await ready(page).boundingBox())!;
  expect(gauges.height).toBeLessThanOrEqual(48);
  expect(readyBox.y - (gauges.y + gauges.height)).toBeLessThan(10);
  expect(readyBox.width).toBeGreaterThan(400);

  // The essentials are at the end of the row and scroll into reach.
  await tile(page, 'tires').scrollIntoViewIfNeeded();
  await tile(page, 'tires').tap();
  await expect(page.getByRole('region', { name: 'Wheels' })).toBeVisible();
  expect(await visibleRows(page)).toBeGreaterThanOrEqual(6);
  await tile(page, 'mount:front_center').scrollIntoViewIfNeeded();
  await slotBuy(page, 'mount:front_center', 'weapon_front_mg');
  await expect.poll(() => credits(page)).toBe(560);
  await assertLayout(page, 'part card', { portrait: true });
  await more(page, 'Reset');
  await expect(page.getByText('Reset to the stock car? You can undo this.')).toBeVisible();
});

test('home, preview and blueprints fit a small landscape phone', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('/?debug=1');
  const fits = async (selector: string) => {
    const bad = await page.evaluate((sel) => {
      const out: string[] = [];
      const root = document.scrollingElement!;
      if (root.scrollWidth > window.innerWidth || root.scrollHeight > window.innerHeight)
        out.push('page scrolls');
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const box = el.getBoundingClientRect();
        if (box.width === 0) continue;
        if (
          box.left < 0 ||
          box.top < 0 ||
          box.right > window.innerWidth ||
          box.bottom > window.innerHeight
        )
          out.push(`outside: ${(el.textContent ?? '').trim().slice(0, 20)}`);
        if (box.height < 43.5) out.push(`small: ${(el.textContent ?? '').trim().slice(0, 20)}`);
      }
      return out;
    }, selector);
    expect(bad, selector).toEqual([]);
  };
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
  await fits('.home button');
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await expect(page.getByRole('button', { name: 'Build Your Car' })).toBeVisible();
  await fits('.preview > section button');
  await expect(page.getByText('Know the road. Build for it.')).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await fits('.bp-head button');
});
