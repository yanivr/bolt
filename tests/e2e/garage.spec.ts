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
  // The Arrow's long spine mount is too narrow for a turret, so it moves to the rear roof.
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
  expect(raced.parts.map((p) => [p.partId, p.mountId])).toEqual([['weapon_turret', 'roof_rear']]);
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

  // A nose mount only faces forward: the picker shows it lit, the other three dimmed, and a
  // press on a dimmed one says why and changes nothing.
  const picker = page.getByTestId('facing-picker');
  await expect(picker).toHaveAttribute('data-facing', '0');
  await expect(picker.getByRole('radio', { name: 'Front' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  for (const name of ['Right', 'Rear', 'Left'])
    await expect(picker.getByRole('radio', { name })).toHaveAttribute('aria-disabled', 'true');
  await picker.getByRole('radio', { name: 'Rear' }).tap({ force: true });
  await expect(status(page)).toHaveText(/This mount only faces forward\./);
  await expect(picker).toHaveAttribute('data-facing', '0');
  expect(await credits(page)).toBe(470);

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
  await expect(tools.locator('.g-fire-note')).toBeVisible();
  await expect(tools.locator('.g-fire-note')).toHaveText('Two weapons can have a fire button.');

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
  // The view has moved in on it: only that slot keeps its leader.
  await tile(page, 'mount:front_center').tap();
  await expect(page.getByRole('region', { name: 'Front center' })).toBeVisible();
  await expect(page.locator('.g-car .socket')).toHaveCount(1);
  await expect(page.locator('.leader.is-selected')).toHaveAttribute('data-mount', 'front_center');
  await expect(bench).toHaveAttribute('data-focus', 'front_center');
  await expect(page.locator('.leader')).toHaveCount(1);
  // The rotate-view control keeps working in focus, and the view stays on the slot.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Rotate view' }).tap();
    views.push(await bench.getAttribute('data-view'));
    await expect(bench).toHaveAttribute('data-focus', 'front_center');
    await expect(page.locator('.leader')).toHaveCount(1);
  }
  expect(new Set(views).size).toBe(4);
  await page.getByRole('button', { name: 'Rotate view' }).tap();
  // Back to the whole car: every leader is back where it was.
  await page.getByRole('button', { name: 'Whole Car' }).tap();
  await expect(bench).not.toHaveAttribute('data-focus', /.+/);
  await expect(page.locator('.leader')).toHaveCount(5);
  // The move back takes a moment (150 ms); measure once it has settled.
  await page.waitForTimeout(240);
  const again = await where('front_center');
  expect(Math.abs(again.x - front.x)).toBeLessThan(2);
  expect(Math.abs(again.y - front.y)).toBeLessThan(2);
});

test('chassis without art are listed as "Art in progress" and cannot be picked', async ({
  page,
}) => {
  await skipTips(page);
  // The artists are filling the atlas as this is written. To test the rule whatever they
  // have finished, two frames are taken out of the manifest the page receives.
  const withheld = ['chassis_spider', 'chassis_trike'];
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
  // All five frames are listed; exactly the ones the atlas cannot draw are held back.
  expect(all).toHaveLength(5);
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
  // A saved build from an older catalog, with a hammer hung outside its mount's region.
  const stale = await blueprint(
    page,
    'Old Faithful',
    { engineId: 'engine_v8' },
    [
      ['weapon_hammer', 'front_center', { assignedActionSlot: 0, offsetX: 5 }],
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
      // Hung five pixels off centre, outside the mount's region: no rule allows that.
      ['weapon_hammer', 'front_center', { assignedActionSlot: 0, offsetX: 5 }],
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
  // One starter for each of the five chassis.
  await expect(sheet.getByRole('article')).toHaveCount(5);
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
  // R steps through the facings the mount allows; a nose mount has one, and says so.
  await page.keyboard.press('r');
  await expect(page.getByTestId('facing-picker')).toHaveAttribute('data-facing', '0');
  await expect(status(page)).toHaveText(/This mount only faces forward\./);

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
  await expect(page.locator('.part-card')).toHaveCount(5);
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
  /** Portrait: the mount tiles are a row under the car, not columns beside it. */
  portrait?: boolean;
};

async function assertLayout(page: Page, label: string, options: LayoutOptions = {}): Promise<void> {
  // Let the car canvas finish drawing, and the view finish moving, before anything is read.
  await expect(page.locator('.g-car')).toBeVisible();
  await page.waitForTimeout(240);
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
      // Focus: the view has moved in on one slot. The car is then larger than the floor on
      // purpose; what has to hold is that the selected mount is on the floor, clear of its
      // edges and of every tile.
      const focus = document.querySelector('.g-bench')!.getAttribute('data-focus');
      const floorEl = document.querySelector<HTMLElement>('.g-floor')!;
      if (focus) {
        const [ax, ay] = (floorEl.dataset.anchor ?? '').split(',').map(Number) as [number, number];
        if (!Number.isFinite(ax) || !Number.isFinite(ay)) out.push('focus without a target');
        else {
          if (ax < 16 || ay < 16 || ax > floorEl.clientWidth - 16 || ay > floorEl.clientHeight - 16)
            out.push(`the focused mount is at the edge: ${ax},${ay}`);
          const under = document
            .elementsFromPoint(floor.left + 1 + ax, floor.top + 1 + ay)
            .find((el) => el.closest('.slot-tile'));
          if (under) out.push(`the focused mount is under ${name(under.closest('.slot-tile')!)}`);
        }
        const leaders = document.querySelectorAll('.leader').length;
        if (!portrait && focus !== 'engine' && leaders !== 1)
          out.push(`focus draws ${leaders} leaders`);
      }
      // The status line has its own place: it never lies over the car.
      const statusEl = document.querySelector<HTMLElement>('[data-testid="garage-status"]');
      if (!statusEl) out.push('no status line');
      else if (drawn) {
        const s = statusEl.getBoundingClientRect();
        const left = Math.max(drawn.left, floor.left);
        const right = Math.min(drawn.right, floor.right);
        const top = Math.max(drawn.top, floor.top);
        const bottom = Math.min(drawn.bottom, floor.bottom);
        if (s.left < right && left < s.right && s.top < bottom && top < s.bottom)
          out.push('the status line is over the car');
        if (
          s.left < floor.right &&
          floor.left < s.right &&
          s.top < floor.bottom &&
          floor.top < s.bottom
        )
          out.push('the status line is on the workbench floor');
      }
      // Nothing on the workbench scrolls: every tile is where it is drawn.
      if (document.querySelector('.g-column')) out.push('a scrolling tile column');
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>('.g-mount-row, .g-slot-row'),
      ))
        if (el.scrollWidth > el.clientWidth + 1) out.push(`a slot row scrolls: ${el.className}`);
      if (drawn && !focus) {
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
      tiles.forEach((el, i) => {
        const box = el.getBoundingClientRect();
        // In focus the tiles stand at the edges over the enlarged car, by design.
        if (drawn && !focus && hit(box, drawn)) out.push(`on the car: ${name(el)}`);
        for (const other of tiles.slice(i + 1))
          if (hit(box, other.getBoundingClientRect()))
            out.push(`tiles overlap: ${name(el)} and ${name(other)}`);
      });
      // Stats and View have their own place in the layout: never over the floor.
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.g-bench-tools button')))
        if (hit(el.getBoundingClientRect(), floor)) out.push(`on the floor: ${name(el)}`);
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
    if (size.width === 870 && size.height === 370)
      expect(floor).toEqual({ width: 461, height: 214 });
    if (size.width === 870 && size.height === 340)
      expect(floor).toEqual({ width: 462, height: 189 });
    if (size.width === 844) expect(floor).toEqual({ width: 447, height: 228 });
    if (size.width === 667) expect(floor).toEqual({ width: 352, height: 219 });
    // Every mount has its tile and its leader, and the essentials name what they hold on one
    // line.
    await expect(page.locator('.g-floor > .slot-tile')).toHaveCount(5);
    await expect(page.locator('.leader')).toHaveCount(5);
    for (const kind of ['chassis', 'engine', 'tires']) {
      const lines = await tile(page, kind)
        .locator('.slot-name')
        .evaluate((el) => ({
          text: el.textContent ?? '',
          height: el.getBoundingClientRect().height,
          wraps: getComputedStyle(el).whiteSpace,
        }));
      expect(lines.text.length, kind).toBeGreaterThan(1);
      expect(lines.wraps, kind).toBe('nowrap');
      expect(lines.height, kind).toBeLessThanOrEqual(26);
      await expect(tile(page, kind).locator('.slot-label'), kind).toBeVisible();
    }

    // A slot selected: its parts, and at least five whole rows of them.
    await tile(page, 'mount:roof_mid').tap();
    await assertLayout(page, 'slot list');
    expect(await visibleRows(page)).toBeGreaterThanOrEqual(size.rows);
    // The engine list is the long one now: twenty engines, five chassis.
    await tile(page, 'chassis').tap();
    await assertLayout(page, 'chassis list');
    await expect(page.locator('.part-card')).toHaveCount(5);
    await tile(page, 'engine').tap();
    await assertLayout(page, 'engine list');
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
    // The compare pane is a two-column table that fits without scrolling on any phone 370
    // pixels tall or more, the 667 x 375 one included.
    if (size.height >= 370) {
      const pane = await page
        .locator('.g-detail .g-pane-body')
        .evaluate((el) => ({ content: el.scrollHeight, room: el.clientHeight }));
      expect(pane.content, 'the compare pane scrolls').toBeLessThanOrEqual(pane.room + 1);
      await expect(page.locator('.g-detail .cmp-row')).toHaveCount(10);
      for (const id of ['score-speed', 'score-firepower'])
        await expect(page.locator('.g-detail').getByTestId(id)).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('install')).toBeInViewport({ ratio: 1 });
    }
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
      for (const name of ['Move forward', 'Move back', 'Replace', /^Remove/])
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

/** The two frames with the most mounts: the eight-mount Spider and the Pickup with its rack. */
const SPIDER: PartSpec[] = [
  ['utility_minesensor', 'front_utility'],
  ['weapon_front_mg', 'left_front', { assignedActionSlot: 0 }],
  ['utility_spare', 'right_front'],
  // The two tallest parts in the catalog on the two highest mounts: the overview is sized to
  // the pixel on this phone, and neither may be cut by the top of the floor.
  ['utility_radar', 'roof_front'],
  ['weapon_tesla', 'roof_mid'],
  ['weapon_rear_mg', 'left_rear'],
  ['utility_repair', 'rear_utility'],
];
const PICKUP: PartSpec[] = [
  ['utility_radar', 'roof_cab'],
  ['utility_repair', 'bed_front', { offsetX: -5 }],
  ['utility_battery', 'bed_front', { offsetX: 5 }],
  ['weapon_rear_mg', 'left_bed', { rotationQuarterTurns: 2 }],
  ['utility_fan', 'right_bed'],
  ['weapon_mortar', 'bed_rear', { autoMode: true }],
  ['defense_rear_bumper', 'rear_center', { rotationQuarterTurns: 2 }],
];

for (const frame of [
  {
    name: 'Spider',
    chassisId: 'chassis_spider',
    engineId: 'engine_four_cylinder',
    parts: SPIDER,
    mounts: 8,
  },
  {
    name: 'Pickup',
    chassisId: 'chassis_pickup',
    engineId: 'engine_four_cylinder',
    parts: PICKUP,
    mounts: 6,
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
      // One tile for each mount that holds something (two parts share the Pickup's rack).
      const firstOn = new Map<string, string>();
      for (const [partId, mountId] of frame.parts)
        if (!firstOn.has(mountId)) firstOn.set(mountId, partId);
      await expect(occupied(page), where).toHaveCount(firstOn.size);
      // Nothing scrolls at any size: every mount has its tile and its leader.
      await expect(page.locator('.g-column'), where).toHaveCount(0);
      await expect(page.locator('.leader'), where).toHaveCount(frame.mounts);
      for (let turn = 0; turn < 4; turn++) {
        await assertLayout(page, `${where}, view ${turn}`);
        await page.getByRole('button', { name: 'Rotate view' }).tap();
      }
      // Every tile can be reached and selects its own part, and the view moves in on it.
      const overview = Number(await page.locator('.g-bench').getAttribute('data-scale'));
      for (const [mountId, partId] of firstOn) {
        const slot = tile(page, `mount:${mountId}`);
        await slot.tap();
        await expect(page.locator('.g-bench'), `${where} ${mountId}`).toHaveAttribute(
          'data-focus',
          mountId,
        );
        expect(
          Number(await page.locator('.g-bench').getAttribute('data-scale')),
          `${where} ${mountId}`,
        ).toBeGreaterThan(overview);
        await assertLayout(page, `${where}, focus on ${mountId}`);
        await expect(slot, `${where} ${mountId}`).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.g-tools'), `${where} ${mountId}`).toHaveAttribute(
          'data-instance',
          /.+/,
        );
        // A shared rack shows whichever of its parts is first in canonical order.
        const onMount = frame.parts.filter(([, id]) => id === mountId).map(([id]) => id);
        expect(onMount, `${where} ${mountId}`).toContain(await slot.getAttribute('data-part'));
        expect(onMount, `${where} ${mountId}`).toContain(partId);
      }
      await assertLayout(page, `${where}, a part selected`);
    }
  });
}

/** The scale the car is really drawn at: CSS pixels per sprite pixel of its canvas. */
async function drawnScale(page: Page): Promise<number> {
  // Rounded to a thousandth: while the view is still easing, a transformed box is reported
  // with float noise in the seventh decimal.
  return page.locator('.g-car canvas').evaluate((el) => {
    const k = el.getBoundingClientRect().width / (el as HTMLCanvasElement).width;
    return Math.round(k * 1000) / 1000;
  });
}

test('focus mode at 870 x 370: every slot of all five chassis moves the view in, and Whole Car, Escape and the floor go back', async ({
  page,
}) => {
  test.slow();
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await page.goto('/?debug=1');
  const bench = page.locator('.g-bench');
  const chassis: Array<[id: string, engine: string, mounts: string[]]> = [
    [
      'chassis_beetle',
      'engine_four_cylinder',
      ['front_center', 'roof_mid', 'left_utility', 'right_utility', 'rear_center'],
    ],
    [
      'chassis_arrow',
      'engine_four_cylinder',
      ['front_center', 'roof_mid', 'roof_rear', 'rear_center'],
    ],
    [
      'chassis_pickup',
      'engine_four_cylinder',
      ['roof_cab', 'bed_front', 'left_bed', 'right_bed', 'bed_rear', 'rear_center'],
    ],
    [
      'chassis_spider',
      'engine_four_cylinder',
      [
        'front_utility',
        'left_front',
        'right_front',
        'roof_front',
        'roof_mid',
        'left_rear',
        'right_rear',
        'rear_utility',
      ],
    ],
    [
      'chassis_trike',
      'engine_mini_electric',
      ['front_center', 'roof_mid', 'left_rear', 'right_rear'],
    ],
  ];
  for (const [chassisId, engineId, mounts] of chassis) {
    await seedLastBuild(page, await blueprint(page, 'Focus', { chassisId, engineId }, []));
    await openGarage(page);
    await expect(ready(page), chassisId).toHaveAttribute('aria-disabled', 'false');
    // The overview: the whole car, a tile and a leader for every mount, nothing scrolling.
    await assertLayout(page, `${chassisId} overview`);
    await expect(page.locator('.g-floor > .slot-tile'), chassisId).toHaveCount(mounts.length);
    await expect(page.locator('.leader'), chassisId).toHaveCount(mounts.length);
    await expect(bench).not.toHaveAttribute('data-focus', /.+/);
    const overview = await drawnScale(page);
    expect(Number.isInteger(overview), chassisId).toBe(true);
    expect(overview, chassisId).toBe(Number(await bench.getAttribute('data-scale')));
    // Three times on this phone for every chassis, the wide Spider included.
    expect(overview, chassisId).toBeGreaterThanOrEqual(3);

    for (const mountId of mounts) {
      const at = `${chassisId} ${mountId}`;
      await tile(page, `mount:${mountId}`).tap();
      await expect(bench, at).toHaveAttribute('data-focus', mountId);
      // The car is drawn larger, by whole steps, and the mount is on the floor, inside its
      // edges and under no tile (assertLayout checks the last three and the status line).
      const focused = await drawnScale(page);
      expect(focused % 1, `${at} scale ${focused}`).toBe(0);
      expect(focused, at).toBeGreaterThanOrEqual(overview + 1);
      expect(focused, at).toBeLessThanOrEqual(overview + 2);
      await assertLayout(page, `${at} focus`);
      // The empty slot is a dashed socket in the middle of the view, clear of every tile.
      await expect(page.locator('.g-car .socket.is-select'), at).toHaveCount(1);
      const clear = await page.evaluate(() => {
        const socket = document.querySelector('.g-car .socket.is-select')!.getBoundingClientRect();
        const floor = document.querySelector('.g-floor')!.getBoundingClientRect();
        const tiles = Array.from(document.querySelectorAll('.g-floor > .slot-tile'));
        return {
          inside:
            socket.left >= floor.left &&
            socket.right <= floor.right &&
            socket.top >= floor.top &&
            socket.bottom <= floor.bottom,
          covered: tiles.filter((t) => {
            const b = t.getBoundingClientRect();
            return (
              b.left < socket.right &&
              socket.left < b.right &&
              b.top < socket.bottom &&
              socket.top < b.bottom
            );
          }).length,
          tiles: tiles.map((t) => {
            const b = t.getBoundingClientRect();
            return Math.min(b.width, b.height);
          }),
        };
      });
      expect(clear.inside, `${at} socket on the floor`).toBe(true);
      expect(clear.covered, `${at} socket under a tile`).toBe(0);
      // Every other slot is still one tap away, on a tile of 44 pixels or more.
      expect(clear.tiles, at).toHaveLength(mounts.length);
      expect(Math.min(...clear.tiles), at).toBeGreaterThanOrEqual(44);
    }

    // Whole Car restores the overview exactly.
    await page.getByRole('button', { name: 'Whole Car' }).tap();
    await expect(bench, chassisId).not.toHaveAttribute('data-focus', /.+/);
    expect(await drawnScale(page), chassisId).toBe(overview);
    await expect(page.locator('.leader'), chassisId).toHaveCount(mounts.length);
    await assertLayout(page, `${chassisId} back to the overview`);
    // So does Escape.
    await tile(page, `mount:${mounts[0]}`).tap();
    await expect(bench).toHaveAttribute('data-focus', mounts[0]!);
    await page.keyboard.press('Escape');
    await expect(bench, chassisId).not.toHaveAttribute('data-focus', /.+/);
    expect(await drawnScale(page), chassisId).toBe(overview);
    // The engine has a focus of its own; the chassis and the wheels show the whole car.
    await tile(page, 'engine').tap();
    await expect(bench).toHaveAttribute('data-focus', 'engine');
    expect(await drawnScale(page), `${chassisId} engine`).toBeGreaterThan(overview);
    await expect(page.getByTestId('engine-socket')).toHaveCount(1);
    await assertLayout(page, `${chassisId} engine focus`);
    for (const kind of ['chassis', 'tires']) {
      await tile(page, kind).tap();
      await expect(bench, kind).not.toHaveAttribute('data-focus', /.+/);
      expect(await drawnScale(page), `${chassisId} ${kind}`).toBe(overview);
    }
    await page.getByRole('button', { name: 'Whole Car' }).tap();
    await expect(page.getByTestId('car-panel')).toBeVisible();
  }

  // A tap on the bare floor beside the car goes back too (the Trike leaves floor to tap).
  await tile(page, 'mount:roof_mid').tap();
  await expect(bench).toHaveAttribute('data-focus', 'roof_mid');
  const spot = await page.evaluate(() => {
    const floorEl = document.querySelector<HTMLElement>('.g-floor')!;
    const floor = floorEl.getBoundingClientRect();
    const [left, top, right, bottom] = (floorEl.dataset.carBox ?? '').split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    // The first bare point of the floor: off the car's box and off every tile.
    for (let y = 6; y < floor.height - 6; y += 6)
      for (let x = 6; x < floor.width - 6; x += 6) {
        if (x >= left - 2 && x <= right + 2 && y >= top - 2 && y <= bottom + 2) continue;
        if (document.elementFromPoint(floor.left + x, floor.top + y) === floorEl)
          return { x: floor.left + x, y: floor.top + y };
      }
    return null;
  });
  expect(spot, 'some bare floor in focus').not.toBeNull();
  await page.touchscreen.tap(spot!.x, spot!.y);
  await expect(bench).not.toHaveAttribute('data-focus', /.+/);
});

test('in focus a part is positioned in plain sight: nudges and turns show on the car', async ({
  page,
}) => {
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await openGarage(page);
  await slotBuy(page, 'mount:roof_mid', 'weapon_front_mg');
  const bench = page.locator('.g-bench');
  await expect(bench).toHaveAttribute('data-focus', 'roof_mid');
  const scale = await drawnScale(page);
  expect(scale).toBeGreaterThanOrEqual(4);
  // The part keeps its gold outline, with the room it has drawn thin under it and an arrow
  // for the way it faces.
  const grab = page.getByTestId('part-grab');
  const mark = page.getByTestId('part-facing-mark').locator('.facing-shaft');
  await expect(grab).toHaveCount(1);
  await expect(page.locator('.g-car .socket.is-room')).toHaveCount(1);
  await expect(mark).toHaveCount(1);
  const centre = async () => {
    const box = (await grab.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const start = await centre();
  const car = (await page.locator('.g-car').boundingBox())!;
  // One step forward is one sprite pixel: a whole `scale` CSS pixels on screen. The view
  // itself does not move, so the part is seen to move against the car.
  await page.getByRole('button', { name: 'Move forward' }).tap();
  await expect(page.getByTestId('part-offset')).toHaveText('0, -1');
  const once = await centre();
  expect(Math.hypot(once.x - start.x, once.y - start.y)).toBeGreaterThanOrEqual(scale * 0.8);
  expect(Math.hypot(once.x - start.x, once.y - start.y)).toBeLessThanOrEqual(scale * 1.3);
  await page.getByRole('button', { name: 'Move forward' }).tap();
  await expect(page.getByTestId('part-offset')).toHaveText('0, -2');
  const twice = await centre();
  expect(Math.hypot(twice.x - start.x, twice.y - start.y)).toBeGreaterThanOrEqual(scale * 1.6);
  expect((await page.locator('.g-car').boundingBox())!).toEqual(car);
  // The arrow keys on the slot tile do the same.
  await tile(page, 'mount:roof_mid').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('part-offset')).toHaveText('0, -1');
  // Turning the part turns the arrow.
  const facing = await mark.getAttribute('points');
  await page.getByTestId('face-1').tap();
  await expect(page.getByTestId('facing-picker')).toHaveAttribute('data-facing', '1');
  await expect(status(page)).toHaveText(/Facing right/);
  await expect(mark).not.toHaveAttribute('points', facing!);
  // The rotate-view control keeps the view on the part.
  const view = await bench.getAttribute('data-view');
  await page.getByRole('button', { name: 'Rotate view' }).tap();
  await expect(bench).not.toHaveAttribute('data-view', view!);
  await expect(bench).toHaveAttribute('data-focus', 'roof_mid');
  await assertLayout(page, 'focus, part nudged and turned, view rotated');
});

/** The sheet frame the canvas drew an installed part with, as `drawCar` recorded it. */
async function partFrame(page: Page, instanceId: string): Promise<number> {
  const frames = (await page.locator('.g-car canvas').getAttribute('data-part-frames')) ?? '';
  const found = frames.split(' ').find((entry) => entry.startsWith(`${instanceId}:`));
  expect(found, `frame of ${instanceId} in "${frames}"`).toBeDefined();
  return Number(found!.split(':')[1]);
}

/** Direction of the facing arrow on screen, as a unit vector from its tail to its tip. */
async function arrowDirection(page: Page): Promise<{ x: number; y: number }> {
  const points = await page
    .getByTestId('part-facing-mark')
    .locator('.facing-shaft')
    .getAttribute('points');
  const [tail, tip] = points!.split(' ').map((p) => p.split(',').map(Number)) as [
    [number, number],
    [number, number],
  ];
  const length = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
  return { x: (tip[0] - tail[0]) / length, y: (tip[1] - tail[1]) / length };
}

test("facing is the player's choice: the Road Shotgun on the Trike roof faces forward, then backward, and every way", async ({
  page,
}) => {
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(
      page,
      'Roof Gun',
      { chassisId: 'chassis_trike', engineId: 'engine_mini_electric' },
      [],
    ),
  );
  await openGarage(page);
  // The roof mount is 14 x 10 and the shotgun 8 x 12: before catalog 0.5.0 it could only lie
  // across the car. It now goes on facing forward.
  await slotBuy(page, 'mount:roof_mid', 'weapon_shotgun');
  const tools = page.getByRole('region', { name: 'Selected part' });
  await expect(tools).toContainText('Road Shotgun');
  const picker = page.getByTestId('facing-picker');
  const bench = page.locator('.g-bench');
  await expect(picker).toHaveAttribute('data-facing', '0');
  const names = ['Front', 'Right', 'Rear', 'Left'];
  // A roof allows all four: nothing is dimmed.
  for (const name of names)
    await expect(picker.getByRole('radio', { name })).not.toHaveAttribute('aria-disabled', 'true');
  const instanceId = (await tools.getAttribute('data-instance'))!;
  const view = async () => Number(await bench.getAttribute('data-view'));

  const check = async (turn: number, where: string) => {
    await expect(picker, where).toHaveAttribute('data-facing', String(turn));
    for (let i = 0; i < 4; i++)
      await expect(picker.getByTestId(`face-${i}`), where).toHaveAttribute(
        'aria-checked',
        String(i === turn),
      );
    // The sprite: the frame of the car's own heading plus a quarter turn (16 of 64) a step.
    const carFrame = await view();
    await expect.poll(() => partFrame(page, instanceId), where).toBe((carFrame + turn * 16) % 64);
    // The arrow on the car: the same heading on screen, flattened by the tilted camera.
    await expect(page.getByTestId('part-facing-mark'), where).toHaveAttribute(
      'data-facing',
      String(turn),
    );
    const heading = ((carFrame + turn * 16) / 64) * Math.PI * 2;
    const arrow = await arrowDirection(page);
    const dot = arrow.x * Math.sin(heading) + arrow.y * -Math.cos(heading);
    expect(dot, `${where}: arrow against the part's heading`).toBeGreaterThan(0.985);
  };

  await check(0, 'as installed');
  const paid = await credits(page);
  // Forward, then backward: the two ways the owner could not have.
  await picker.getByRole('radio', { name: 'Rear' }).tap();
  await expect(status(page)).toHaveText(/Facing back/);
  await check(2, 'facing back');
  await picker.getByRole('radio', { name: 'Front' }).tap();
  await expect(status(page)).toHaveText(/Facing forward/);
  await check(0, 'facing forward');
  // Turning is free and leaves the part where it was.
  expect(await credits(page)).toBe(paid);
  await expect(page.getByTestId('part-offset')).toHaveText('0, 0');
  // Every facing agrees with the sprite and the arrow in every view heading.
  for (let turned = 0; turned < 4; turned++) {
    for (let turn = 0; turn < 4; turn++) {
      await picker.getByTestId(`face-${turn}`).tap();
      await check(turn, `view ${turned}, facing ${names[turn]}`);
    }
    const before = await view();
    await page.getByRole('button', { name: 'Rotate view' }).tap();
    await expect(bench).not.toHaveAttribute('data-view', String(before));
  }
  // R on the slot tile steps clockwise through the four.
  await picker.getByTestId('face-0').tap();
  await tile(page, 'mount:roof_mid').focus();
  for (const turn of [1, 2, 3, 0]) {
    await page.keyboard.press('r');
    await expect(picker).toHaveAttribute('data-facing', String(turn));
  }
  await assertLayout(page, 'roof weapon turned');
  await expect(ready(page)).toHaveAttribute('aria-disabled', 'false');
});

test('parts with no facing choice show no picker, and a fixed part shows which way it works', async ({
  page,
}) => {
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(page, 'Fixed', {}, [
      ['utility_radar', 'roof_mid'],
      ['weapon_mine', 'rear_center', { rotationQuarterTurns: 2, assignedActionSlot: 0 }],
      ['defense_front_bumper', 'front_center'],
    ]),
  );
  await openGarage(page);
  const tools = page.getByRole('region', { name: 'Selected part' });
  // A radar has no direction: no picker and no arrow on the car.
  await tile(page, 'mount:roof_mid').tap();
  await expect(tools).toContainText('Radar');
  await expect(page.getByTestId('facing-picker')).toHaveCount(0);
  await expect(page.getByTestId('part-facing-mark')).toHaveCount(0);
  await expect(tools.getByRole('button', { name: 'Move forward' })).toBeVisible();
  // A mine always drops behind: no picker, and the arrow on the car points back.
  await tile(page, 'mount:rear_center').tap();
  await expect(tools).toContainText('Road Mine');
  await expect(page.getByTestId('facing-picker')).toHaveCount(0);
  await expect(page.getByTestId('part-facing-mark')).toHaveAttribute('data-facing', '2');
  // R has nothing to step to, and says so.
  await tile(page, 'mount:rear_center').focus();
  await page.keyboard.press('r');
  await expect(status(page)).toHaveText(/This part always faces back\./);
  await tile(page, 'mount:front_center').tap();
  await expect(tools).toContainText('Crash Bumper');
  await expect(page.getByTestId('facing-picker')).toHaveCount(0);
  await expect(page.getByTestId('part-facing-mark')).toHaveAttribute('data-facing', '0');
});

/** Everything on the occupied-slot card, by test id or role, that must be whole and on screen. */
async function assertCard(page: Page, where: string, expectPicker: boolean): Promise<void> {
  const report = await page.evaluate((picker) => {
    const out: string[] = [];
    const card = document.querySelector<HTMLElement>('.g-tools');
    if (!card) return ['no card'];
    const panel = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const body = card.querySelector<HTMLElement>('.g-tools-body')!;
    if (body.scrollHeight > body.clientHeight + 1)
      out.push(`the card scrolls: ${body.scrollHeight} > ${body.clientHeight}`);
    if (body.scrollWidth > body.clientWidth + 1)
      out.push(`the card is too wide: ${body.scrollWidth} > ${body.clientWidth}`);
    const controls = Array.from(
      card.querySelectorAll<HTMLElement>(
        'button, .pad-mid, .pad-title, [data-testid="part-offset"], [data-testid="remove-refund"], .g-tools-head h2, .g-block-title',
      ),
    );
    const name = (el: Element) =>
      `${el.className} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`;
    for (const el of controls) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (
        box.left < panel.left - 0.5 ||
        box.top < panel.top - 0.5 ||
        box.right > panel.right + 0.5 ||
        box.bottom > panel.bottom + 0.5
      )
        out.push(`outside the panel: ${name(el)}`);
      if (box.left < -0.5 || box.top < -0.5 || box.right > vw + 0.5 || box.bottom > vh + 0.5)
        out.push(`outside the viewport: ${name(el)}`);
      if (el.tagName === 'BUTTON') {
        if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: ${name(el)}`);
        if (box.width < 43.5 || box.height < 43.5)
          out.push(`small target: ${name(el)} ${Math.round(box.width)}x${Math.round(box.height)}`);
        // Nothing lies over a button: the middle of each is its own.
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!top || !(el === top || el.contains(top))) out.push(`covered: ${name(el)}`);
      }
    }
    // No two buttons overlap.
    const buttons = controls.filter((el) => el.tagName === 'BUTTON');
    for (let i = 0; i < buttons.length; i++)
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i]!.getBoundingClientRect();
        const b = buttons[j]!.getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        if (
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5
        )
          out.push(`overlap: ${name(buttons[i]!)} and ${name(buttons[j]!)}`);
      }
    const has = card.querySelector('[data-testid="facing-picker"]') !== null;
    if (has !== picker) out.push(picker ? 'no direction picker' : 'a direction picker');
    for (const id of ['part-offset', 'replace', 'remove', 'remove-refund'])
      if (!card.querySelector(`[data-testid="${id}"]`)) out.push(`missing ${id}`);
    // The help paragraph is gone: the card is controls only.
    if (card.querySelector('.g-tools-hint')) out.push('the help text is back');
    return out;
  }, expectPicker);
  expect(report, where).toEqual([]);
}

for (const size of [
  { width: 870, height: 370 },
  { width: 870, height: 340 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
]) {
  test(`the part card fits at ${size.width} x ${size.height} with nothing cut and nothing to scroll`, async ({
    page,
  }) => {
    await skipTips(page);
    await page.setViewportSize(size);
    await page.goto('/?debug=1');
    await seedLastBuild(
      page,
      await blueprint(
        page,
        'Card',
        { chassisId: 'chassis_trike', engineId: 'engine_mini_electric' },
        [
          // The owner's own case: a Frost Cannon on the Trike roof, refund 110.
          ['weapon_frost', 'roof_mid', { rotationQuarterTurns: 3, assignedActionSlot: 0 }],
          // A non-directional part with a three-digit refund (Emergency Booster, 115).
          ['utility_overdrive', 'left_rear'],
        ],
      ),
    );
    await openGarage(page);
    const where = `${size.width} x ${size.height}`;
    const tools = page.getByRole('region', { name: 'Selected part' });

    await tile(page, 'mount:roof_mid').tap();
    await expect(tools).toContainText('Frost Cannon');
    await page.waitForTimeout(240);
    await assertCard(page, `${where}, roof weapon`, true);
    await assertLayout(page, `${where}, roof weapon card`);
    // Every control by name: the fire row, the four directions, the nudge pad with its
    // readout, Replace and Remove with its refund.
    for (const name of ['Primary', 'Secondary', 'Off'])
      await expect(tools.getByRole('radio', { name, exact: true })).toBeInViewport({ ratio: 1 });
    for (const name of ['Front', 'Right', 'Rear', 'Left'])
      await expect(
        page.getByTestId('facing-picker').getByRole('radio', { name, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    for (const name of ['Move forward', 'Move back', 'Move left', 'Move right', 'Replace'])
      await expect(tools.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('part-offset')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('remove')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('remove-refund')).toHaveText('+110');
    await expect(page.getByTestId('remove-refund')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('facing-picker')).toHaveAttribute('data-facing', '3');
    // A refund of four digits fits the same button: measured on a hidden copy of it, the
    // same width, so the real one is left to React.
    const room = await page.getByTestId('remove').evaluate((button) => {
      const copy = button.cloneNode(true) as HTMLElement;
      const box = button.getBoundingClientRect();
      copy.style.position = 'absolute';
      copy.style.visibility = 'hidden';
      copy.style.width = `${box.width}px`;
      copy.style.height = `${box.height}px`;
      button.parentElement!.append(copy);
      const refund = copy.querySelector<HTMLElement>('[data-testid="remove-refund"]')!;
      refund.textContent = '+8888';
      const outer = copy.getBoundingClientRect();
      const inner = refund.getBoundingClientRect();
      const fits =
        copy.scrollWidth <= copy.clientWidth + 1 &&
        inner.right <= outer.right - 1 &&
        inner.left >= outer.left + 1 &&
        inner.bottom <= outer.bottom + 0.5;
      copy.remove();
      return fits;
    });
    expect(room, `${where}: a four-digit refund`).toBe(true);
    // The card still fits after the part is turned and nudged.
    await page.getByTestId('face-0').tap();
    await tools.getByRole('button', { name: 'Move left' }).tap();
    await assertCard(page, `${where}, roof weapon turned`, true);

    await tile(page, 'mount:left_rear').tap();
    await expect(tools).toContainText('Emergency Booster');
    await page.waitForTimeout(240);
    await assertCard(page, `${where}, non-directional part`, false);
    await assertLayout(page, `${where}, non-directional card`);
    await expect(page.getByTestId('remove-refund')).toHaveText('+115');
    await expect(page.getByTestId('remove-refund')).toBeInViewport({ ratio: 1 });
    await expect(tools.getByRole('radiogroup', { name: 'Fire button' })).toHaveCount(0);
  });
}

test('the idle Your Car panel shows scores, indicators, a derived summary and tappable equipment', async ({
  page,
}) => {
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await openGarage(page);
  const panel = page.getByTestId('car-panel');
  // The stock Beetle: Speed 66, Control 69, nothing else to speak of.
  await expect(panel.getByTestId('score-speed')).toContainText('66');
  await expect(panel.getByTestId('score-control')).toContainText('69');
  await expect(panel.locator('.g-state')).toHaveCount(5);
  for (const key of ['budget', 'load', 'energy', 'heat', 'stability'])
    await expect(panel.locator(`.g-state[data-state="${key}"]`)).toHaveAttribute(
      'data-status',
      'ok',
    );
  const summary = panel.getByTestId('car-summary');
  await expect(summary).toContainText('Strongest: Control 69 and Speed 66.');
  await expect(summary).toContainText('Weakest: Utility 0.');
  await expect(panel).toContainText('0 of 5 mounts used');
  await expect(panel).toContainText('Nothing mounted yet. Tap a slot to see what fits.');
  await assertLayout(page, 'idle panel, empty');
  // An indicator opens its working.
  await panel.locator('.g-state[data-state="heat"]').tap();
  await expect(page.getByRole('dialog', { name: 'Heat' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).tap();

  // Mount two things: the summary follows the numbers, and each row opens its slot.
  await slotBuy(page, 'mount:roof_mid', 'weapon_turret');
  await slotBuy(page, 'mount:left_utility', 'utility_repair');
  await page.getByRole('button', { name: 'Whole Car' }).tap();
  await expect(panel).toContainText('2 of 5 mounts used');
  const firepower = (await panel.getByTestId('score-firepower').locator('dd').textContent())!;
  // Since catalog 0.7.0 the Turret has eight bursts a race, and Firepower weighs that supply
  // as it does for every limited weapon (about 9 today, was above 20).
  expect(Number(firepower)).toBeGreaterThan(4);
  await expect(summary).toContainText('Strongest: Control');
  const rows = panel.locator('.g-equipment-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Swivel Turret');
  await expect(rows.nth(1)).toContainText('Roof middle');
  await assertLayout(page, 'idle panel, equipped');
  await panel.getByRole('button', { name: 'Swivel Turret on Roof middle. Open this slot.' }).tap();
  await expect(page.locator('.g-bench')).toHaveAttribute('data-focus', 'roof_mid');
  await expect(page.getByRole('region', { name: 'Selected part' })).toContainText('Swivel Turret');
});

test('a saved car on a retired chassis is flagged, not broken, and Repair Build rebuilds it on the Beetle', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await skipTips(page);
  await page.goto('/?debug=1');
  // A Turtle saved under the old catalog, as a returning player's browser would hold it.
  const old = await blueprint(
    page,
    'Old Bulldog',
    { chassisId: 'chassis_turtle', engineId: 'engine_v6', tireKitId: 'tires_hard' },
    [
      ['defense_front_bumper', 'front_center'],
      ['weapon_rear_mg', 'rear_center', { rotationQuarterTurns: 2 }],
      ['defense_side_panels', 'left_mid'],
    ],
    '0.3.0',
  );
  await page.evaluate((json) => {
    window.localStorage.setItem(
      'bolt.blueprints.v1',
      JSON.stringify({
        version: 1,
        items: [{ id: 'bold', savedAt: '2026-10-09T08:00:00.000Z', blueprint: JSON.parse(json) }],
      }),
    );
    // The same car as the last build raced: it must not be restored as the current car.
    window.localStorage.setItem('bolt.blueprint.v1', json);
  }, JSON.stringify(old));
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  const saved = page.getByRole('article', { name: 'Old Bulldog' });
  await expect(saved).toBeVisible();
  await expect(saved).toContainText('This build uses older part values. Review it before racing.');
  await expect(saved).toContainText('Retired frame');
  await expect(saved).not.toContainText('Art in progress');
  await expect(saved.getByRole('button', { name: 'Use', exact: true })).toHaveCount(0);
  await saved.getByRole('button', { name: 'Repair Build' }).tap();
  await expect(page.locator('.bp-message')).toContainText(
    'That frame is retired. Rebuilt on the Beetle. Removed and refunded: Side Shields.',
  );
  await expect(saved).toContainText('Beetle');
  await expect(saved).not.toContainText('older part values');
  await saved.getByRole('button', { name: 'Use', exact: true }).tap();
  const car = await stored(page);
  expect(car).toMatchObject({
    name: 'Old Bulldog',
    chassisId: 'chassis_beetle',
    engineId: 'engine_v6',
    tireKitId: 'tires_hard',
  });
  expect(car.parts.map((p) => p.partId).sort()).toEqual(['defense_front_bumper', 'weapon_rear_mg']);
  expect(problems).toEqual([]);
});

test('portrait: the car is a strip, the slots are rows under it, and five parts show', async ({
  page,
}) => {
  await page.setViewportSize({ width: 450, height: 840 });
  await openGarage(page);
  await expect(ready(page)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('credits-left')).toBeInViewport({ ratio: 1 });
  // The cell the car is drawn in; the canvas itself keeps clear room round it for parts
  // that overhang.
  await expect(page.locator('.g-car')).toBeInViewport({ ratio: 0.6 });
  await assertLayout(page, 'first visit', { portrait: true });
  // The car takes a little under thirty percent of the height; no leaders, no tiles around it.
  const floor = (await page.locator('.g-floor').boundingBox())!;
  expect(floor.height / 840).toBeGreaterThan(0.26);
  expect(floor.height / 840).toBeLessThan(0.34);
  await expect(page.locator('.leader')).toHaveCount(0);
  await expect(page.locator('.g-floor > .slot-tile')).toHaveCount(0);
  // Two rows under the car, nothing to scroll: the mounts in car order, then Chassis, Engine
  // and Wheels with the names of what they hold.
  const order = await page
    .locator('.g-mount-row .slot-tile, .g-slot-row .slot-tile')
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
  for (const row of ['.g-mount-row', '.g-slot-row']) {
    const tops = await page
      .locator(`${row} .slot-tile`)
      .evaluateAll((tiles) => tiles.map((t) => Math.round(t.getBoundingClientRect().top)));
    expect(new Set(tops).size, row).toBe(1);
    await expect(page.locator(`${row} .slot-tile`).last()).toBeInViewport({ ratio: 1 });
  }
  await expect(tile(page, 'engine').locator('.slot-name')).toHaveText('Four-Cylinder');
  // Stats and View are in a column of their own beside the car, never over it, and the
  // status line has a row of its own under the slots.
  const strip = (await page.locator('.g-floor').boundingBox())!;
  for (const name of ['Car Stats', 'Rotate view']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect(box.x, name).toBeGreaterThanOrEqual(strip.x + strip.width);
    expect(box.height, name).toBeGreaterThanOrEqual(48);
  }
  const line = (await status(page).boundingBox())!;
  expect(line.y).toBeGreaterThanOrEqual(strip.y + strip.height);
  // The strip is the size the unit-tested layout is checked at (`portraitFloor`).
  expect(
    await page
      .locator('.g-floor')
      .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight })),
  ).toEqual({ width: 389, height: 237 });
  // The first-build tips are one line: the current step, the starter car and Skip.
  const coach = page.getByRole('complementary', { name: 'First build' });
  expect((await coach.boundingBox())!.height).toBeLessThanOrEqual(52);
  await expect(coach.getByRole('button', { name: /Pick a chassis/ })).toBeVisible();
  await expect(coach.getByRole('button', { name: 'Use Starter Car' })).toBeVisible();

  // With the tips still up, a selected slot shows five whole rows, and the view has moved in.
  const overview = Number(await page.locator('.g-bench').getAttribute('data-scale'));
  await tile(page, 'mount:roof_mid').tap();
  await expect(page.locator('.g-car .socket')).toHaveCount(1);
  await expect(page.locator('.g-bench')).toHaveAttribute('data-focus', 'roof_mid');
  expect(Number(await page.locator('.g-bench').getAttribute('data-scale'))).toBeGreaterThan(
    overview,
  );
  expect(await visibleRows(page)).toBeGreaterThanOrEqual(5);
  await coach.getByRole('button', { name: 'Skip tips' }).tap();
  await expect(coach).toHaveCount(0);
  await assertLayout(page, 'slot list', { portrait: true });
  expect(await visibleRows(page)).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: 'Whole Car' }).tap();
  await expect(page.locator('.g-bench')).not.toHaveAttribute('data-focus', /.+/);
  expect(Number(await page.locator('.g-bench').getAttribute('data-scale'))).toBe(overview);
  await tile(page, 'mount:roof_mid').tap();
  // The gauges are one thin row directly above Ready.
  const gauges = (await page.locator('.g-bottom').boundingBox())!;
  const readyBox = (await ready(page).boundingBox())!;
  expect(gauges.height).toBeLessThanOrEqual(48);
  expect(readyBox.y - (gauges.y + gauges.height)).toBeLessThan(10);
  expect(readyBox.width).toBeGreaterThan(400);

  // The essentials are in reach without scrolling.
  await tile(page, 'tires').tap();
  await expect(page.getByRole('region', { name: 'Wheels' })).toBeVisible();
  expect(await visibleRows(page)).toBeGreaterThanOrEqual(5);
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

// --- Milestone C part 2: what a weapon covers, and the car stepping back in focus ---------------

/** The outline of the first area the floor shows for the selected weapon, as screen points. */
async function coverageOutline(page: Page): Promise<Array<{ x: number; y: number }>> {
  const d = await page
    .getByTestId('part-coverage')
    .locator('.coverage-area .coverage-fill')
    .first()
    .getAttribute('d');
  return (d ?? '')
    .split(/[MLZ]/)
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(/\s+/).map(Number);
      return { x: x!, y: y! };
    });
}

/** Which way a cone points on screen: from its apex, the last point, to the middle of its rim. */
function coneDirection(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const apex = points[points.length - 1]!;
  const rim = points.slice(0, -1);
  const cx = rim.reduce((sum, p) => sum + p.x, 0) / rim.length - apex.x;
  const cy = rim.reduce((sum, p) => sum + p.y, 0) / rim.length - apex.y;
  const length = Math.hypot(cx, cy);
  return { x: cx / length, y: cy / length };
}

test('a selected weapon shows what it covers on the floor, and the drawing turns and moves with it', async ({
  page,
}) => {
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(page, 'Cones', {}, [
      ['weapon_shotgun', 'roof_mid', { assignedActionSlot: 0 }],
      ['weapon_mine', 'rear_center', { rotationQuarterTurns: 2, assignedActionSlot: 1 }],
      ['utility_radar', 'left_utility'],
    ]),
  );
  await openGarage(page);
  const bench = page.locator('.g-bench');
  const cover = page.getByTestId('part-coverage');
  // Nothing selected: nothing on the floor.
  await expect(cover).toHaveCount(0);

  // The shotgun: a cone, drawn under the car and inside the floor.
  await tile(page, 'mount:roof_mid').tap();
  await expect(cover).toHaveAttribute('data-kind', 'cone');
  await expect(cover).toHaveAttribute('data-facing', '0');
  await expect(cover).toHaveAttribute('data-range', '110');
  const floor = (await page.locator('.g-floor').boundingBox())!;
  const layer = (await cover.boundingBox())!;
  expect(Math.abs(layer.x - floor.x)).toBeLessThan(2);
  expect(Math.abs(layer.width - floor.width)).toBeLessThan(3);
  expect(Math.abs(layer.height - floor.height)).toBeLessThan(3);
  // Under the car in the page, and the faint copy over it.
  const order = await page.evaluate(() => {
    const kids = Array.from(document.querySelector('.g-floor')!.children);
    return {
      cover: kids.findIndex((k) => k.matches('.g-coverage:not(.is-ghost)')),
      car: kids.findIndex((k) => k.matches('.g-car')),
      ghost: kids.findIndex((k) => k.matches('.g-coverage.is-ghost')),
    };
  });
  expect(order.cover).toBeGreaterThanOrEqual(0);
  expect(order.cover).toBeLessThan(order.car);
  expect(order.ghost).toBeGreaterThan(order.car);
  // The arrow at the muzzle is no longer painted: the cone is the direction cue.
  await expect(page.getByTestId('part-facing-mark')).toBeHidden();

  const heading = async (turn: number) => {
    const frame = Number(await bench.getAttribute('data-view'));
    const rad = ((frame + turn * 16) / 64) * Math.PI * 2;
    return { x: Math.sin(rad), y: -Math.cos(rad) };
  };
  const along = async (turn: number, where: string) => {
    await expect(cover, where).toHaveAttribute('data-facing', String(turn));
    const points = await coverageOutline(page);
    expect(points.length, where).toBeGreaterThan(4);
    const cone = coneDirection(points);
    const want = await heading(turn);
    expect(cone.x * want.x + cone.y * want.y, where).toBeGreaterThan(0.985);
    // Every point is on the floor's drawing, and the apex is inside the floor itself.
    const apex = points[points.length - 1]!;
    expect(apex.x, where).toBeGreaterThan(0);
    expect(apex.x, where).toBeLessThan(floor.width);
    expect(apex.y, where).toBeGreaterThan(0);
    expect(apex.y, where).toBeLessThan(floor.height);
    // A 40 degree cone: the two ends of its rim are 40 degrees apart as seen from the apex.
    const a = points[0]!;
    const b = points[points.length - 2]!;
    const angle = Math.abs(
      Math.atan2(a.y - apex.y, a.x - apex.x) - Math.atan2(b.y - apex.y, b.x - apex.x),
    );
    const spread = Math.min(angle, Math.PI * 2 - angle);
    expect((spread * 180) / Math.PI, where).toBeGreaterThan(34);
    expect((spread * 180) / Math.PI, where).toBeLessThan(46);
  };
  await along(0, 'facing forward');
  // Turned with the picker, it turns; turned with the view, it turns with the car.
  await page.getByTestId('face-1').tap();
  await along(1, 'facing right');
  await page.getByTestId('face-2').tap();
  await along(2, 'facing back');
  await page.getByRole('button', { name: 'Rotate view' }).tap();
  await along(2, 'facing back, view turned');
  await page.getByTestId('face-3').tap();
  await along(3, 'facing left, view turned');
  // A nudge moves the apex with the part, by a sprite pixel a step.
  const scale = await drawnScale(page);
  const before = (await coverageOutline(page)).pop()!;
  await page.getByRole('button', { name: 'Move forward' }).tap();
  await expect
    .poll(async () => {
      const now = (await coverageOutline(page)).pop()!;
      return Math.hypot(now.x - before.x, now.y - before.y);
    })
    .toBeCloseTo(scale, 0);

  // The mine: a drop zone behind the car, hatched, with the ring that sets it off.
  await tile(page, 'mount:rear_center').tap();
  await expect(cover).toHaveAttribute('data-kind', 'drop');
  await expect(cover).toHaveAttribute('data-facing', '2');
  await expect(cover.locator('.coverage-area')).toHaveCount(1);
  await expect(cover.locator('.coverage-core')).toHaveCount(1);
  // The radar is not a weapon: nothing on the floor.
  await tile(page, 'mount:left_utility').tap();
  await expect(cover).toHaveCount(0);
});

/** Mean brightness of the opaque pixels of the car canvas, 0 to 255. */
async function carBrightness(page: Page): Promise<number> {
  return page.locator('.g-car canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 200) continue;
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    return n > 0 ? sum / n : 0;
  });
}

test('in focus the car steps back: everything but the selected part is drawn darker, at once under Reduced Motion', async ({
  page,
}) => {
  await skipTips(page);
  await page.setViewportSize({ width: 870, height: 370 });
  await page.goto('/?debug=1');
  await seedLastBuild(
    page,
    await blueprint(page, 'Dim', {}, [
      ['utility_radar', 'left_utility'],
      ['utility_repair', 'right_utility'],
    ]),
  );
  await openGarage(page);
  const canvas = page.locator('.g-car canvas');
  // The overview is drawn as it always was.
  await expect(canvas).toHaveAttribute('data-dim', '0.00');
  const whole = await carBrightness(page);
  expect(whole).toBeGreaterThan(20);

  // A part in focus: the rest fades to forty percent darker, the part is kept.
  await tile(page, 'mount:left_utility').tap();
  const tools = page.getByRole('region', { name: 'Selected part' });
  const instanceId = (await tools.getAttribute('data-instance'))!;
  await expect(canvas).toHaveAttribute('data-dim', '0.40');
  await expect(canvas).toHaveAttribute('data-dim-keep', `part:${instanceId}`);
  const dimmed = await carBrightness(page);
  // Mostly bodywork, so the whole picture is clearly darker. It is not exactly forty percent:
  // the kept part and its gold outline stay bright, and in focus they are a larger share of
  // the picture than in the overview this is compared with.
  expect(dimmed / whole).toBeGreaterThan(0.55);
  expect(dimmed / whole).toBeLessThan(0.82);
  // The engine in focus keeps the engine; an empty mount dims the whole car.
  await tile(page, 'engine').tap();
  await expect(canvas).toHaveAttribute('data-dim-keep', 'engine');
  await expect(canvas).toHaveAttribute('data-dim', '0.40');
  await tile(page, 'mount:roof_mid').tap();
  await expect(canvas).toHaveAttribute('data-dim-keep', 'all');
  // The wash is the interface's navy, not black, and the dashed socket is bright.
  expect((await carBrightness(page)) / whole).toBeLessThan(0.75);
  // The chassis and the wheels show the whole car, undimmed, and so does Whole Car.
  await tile(page, 'tires').tap();
  await expect(canvas).toHaveAttribute('data-dim', '0.00');
  await tile(page, 'mount:left_utility').tap();
  await expect(canvas).toHaveAttribute('data-dim', '0.40');
  await page.getByTestId('car-stats').tap();
  await expect(canvas).toHaveAttribute('data-dim', '0.00');
  expect(Math.abs((await carBrightness(page)) - whole)).toBeLessThan(1);

  // Reduced Motion: no fade. The first frame after the tap is already fully dimmed.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await tile(page, 'mount:right_utility').tap();
  const first = await canvas.evaluate(
    (el) =>
      new Promise<string>((resolve) =>
        requestAnimationFrame(() => resolve((el as HTMLCanvasElement).dataset.dim ?? '')),
      ),
  );
  expect(first).toBe('0.40');
});
