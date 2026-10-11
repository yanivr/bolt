import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * Screenshots of the occupied-slot card and the direction picker for design review.
 *
 *   pnpm build && PORT=2671 node apps/server/dist/main.js &
 *   npx tsx tests/visual/card.ts http://localhost:2671 tests/visual/out/card
 *
 * At the four landscape phone sizes the card has to fit without scrolling (870 x 370, 870 x
 * 340, 844 x 390, 667 x 375) and in portrait: a roof weapon with a three-digit refund, a
 * nose gun whose mount has one facing, non-directional parts with and without a fire row and
 * a three-digit refund, a part with a fixed facing, and a hybrid with four fire choices.
 * Then, at 870 x 370, the Road Shotgun on the Trike roof facing each of the four ways in each
 * of the four view headings, to check that the arrow on the car agrees with the picker.
 */

const baseUrl = process.argv[2] ?? 'http://localhost:2567';
const outDir = resolve(process.argv[3] ?? 'tests/visual/out/card');
mkdirSync(outDir, { recursive: true });
const QUERY = '?debug=1&buildSeconds=900';

const SIZES = [
  { name: '870x370', width: 870, height: 370 },
  { name: '870x340', width: 870, height: 340 },
  { name: '844x390', width: 844, height: 390 },
  { name: '667x375', width: 667, height: 375 },
  { name: '450x840', width: 450, height: 840 },
];

type PartSpec = [partId: string, mountId: string, extra?: Record<string, unknown>];

function blueprint(chassisId: string, parts: PartSpec[], catalogVersion: string) {
  return {
    formatVersion: 1,
    catalogVersion,
    name: 'Card',
    chassisId,
    engineId: chassisId === 'chassis_trike' ? 'engine_mini_electric' : 'engine_four_cylinder',
    tireKitId: 'tires_street',
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

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const problems: string[] = [];
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const page: Page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`${size.name} console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${size.name} pageerror: ${e.message}`));
    await page.goto(`${baseUrl}/${QUERY}`, { waitUntil: 'networkidle' });
    const version = await page.evaluate(async () => {
      const response = await fetch('/api/v1/health');
      return ((await response.json()) as { catalogVersion: string }).catalogVersion;
    });
    const open = async (car: Record<string, unknown>) => {
      await page.evaluate((json) => {
        window.localStorage.setItem('bolt.blueprint.v1', json);
        window.localStorage.setItem(
          'bolt.tutorial.v1',
          JSON.stringify({ garage_tips: true, built: true }),
        );
      }, JSON.stringify(car));
      await page.goto(`${baseUrl}/${QUERY}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Start Racing' }).click();
      await page.getByRole('button', { name: 'Build Your Car' }).click();
      await page.locator('.g-car').waitFor({ state: 'visible' });
      await page.waitForTimeout(400);
    };
    const shot = async (name: string) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(outDir, `${size.name}_${name}.png`) });
    };
    const tile = (mountId: string) => page.locator(`.slot-tile[data-slot="mount:${mountId}"]`);

    // A roof weapon with a three-digit refund (Frost Cannon, 110), on the owner's Trike.
    await open(
      blueprint(
        'chassis_trike',
        [
          ['weapon_frost', 'roof_mid', { assignedActionSlot: 0 }],
          ['weapon_shotgun', 'front_center', { assignedActionSlot: 1 }],
          ['utility_overdrive', 'left_rear'],
        ],
        version,
      ),
    );
    await tile('roof_mid').click();
    await shot('01_roof_weapon_refund_110');
    // The nose mount only faces forward: three arrows dimmed, and a press says why.
    await tile('front_center').click();
    await shot('02_nose_gun_one_facing');
    await page.getByTestId('face-2').click({ force: true });
    await shot('02b_nose_gun_reason');
    // A non-directional part with a three-digit refund: no picker, no fire row.
    await tile('left_rear').click();
    await shot('02c_non_directional_refund_115');

    // A hybrid weapon (four fire choices), a non-directional part and a fixed one.
    await open(
      blueprint(
        'chassis_beetle',
        [
          ['weapon_turret', 'roof_mid', { assignedActionSlot: 0 }],
          ['utility_radiator', 'front_center'],
          ['weapon_mine', 'rear_center', { rotationQuarterTurns: 2, assignedActionSlot: 1 }],
        ],
        version,
      ),
    );
    await tile('roof_mid').click();
    await shot('03_turret_no_facing');
    await tile('front_center').click();
    await shot('04_radiator_no_facing_no_fire');
    await tile('rear_center').click();
    await shot('05_mine_fixed_facing');

    // A hybrid with a free facing: four fire chips and both pads.
    await open(
      blueprint(
        'chassis_beetle',
        [['weapon_homing', 'roof_mid', { assignedActionSlot: 0 }]],
        version,
      ),
    );
    await tile('roof_mid').click();
    await shot('06_hybrid_four_chips_two_pads');

    if (size.name === '870x370') {
      await open(
        blueprint(
          'chassis_trike',
          [['weapon_shotgun', 'roof_mid', { assignedActionSlot: 0 }]],
          version,
        ),
      );
      await tile('roof_mid').click();
      for (let view = 0; view < 4; view++) {
        for (const turn of [0, 1, 2, 3]) {
          await page.getByTestId(`face-${turn}`).click();
          await shot(`10_view${view}_facing${turn}`);
        }
        await page.getByRole('button', { name: 'Rotate view' }).click();
      }
    }
    await context.close();
  }
  await browser.close();
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`card screenshots in ${outDir}`);
}

await main();
