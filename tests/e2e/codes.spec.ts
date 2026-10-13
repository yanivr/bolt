import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BASELINE_BLUEPRINT, STARTER_TEMPLATES } from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import { buildHash, generateCarCode, serializeBlueprint } from '@bolt/shared';

/**
 * Short car codes across browsers (Section 19.7: "Short car codes create, persist, import and
 * validate across browsers"), on the production build with the real server on PostgreSQL.
 *
 * This file starts its own server, on its own port, with `DATABASE_URL` pointing at
 * `BOLT_E2E_DATABASE_URL` (default: the `pnpm db:dev` database `bolt_e2e`). When that database
 * cannot be reached the server refuses to start, and every test here is skipped with the reason,
 * so the default Playwright run stays green on a machine without PostgreSQL.
 *
 * Screenshots go to docs/evidence/persistence at 870 x 370 and 667 x 375.
 */

const BASE_PORT = Number(process.env.BOLT_E2E_PORT ?? 2567);
const PORT = BASE_PORT + 7;
const ORIGIN = `http://localhost:${PORT}`;
const DATABASE_URL =
  process.env.BOLT_E2E_DATABASE_URL ?? 'postgresql://bolt@localhost:5499/bolt_e2e';
const EVIDENCE = path.resolve('docs/evidence/persistence');
const SIZES = [
  { width: 870, height: 370 },
  { width: 667, height: 375 },
] as const;
const INVALID = "We couldn't find that car. Check the code and try again.";
const OUTDATED = 'This build uses older part values. Review it before racing.';

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: ORIGIN });

let server: ChildProcess | null = null;
let skipReason = '';
let serverLog = '';

/** Minimal surface of `pg`, loaded from the server package that depends on it. */
type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};
function pgClient(): PgClient {
  const require = createRequire(path.resolve('apps/server/package.json'));
  const pg = require('pg') as { Client: new (options: { connectionString: string }) => PgClient };
  return new pg.Client({ connectionString: DATABASE_URL });
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  mkdirSync(EVIDENCE, { recursive: true });
  server = spawn(process.execPath, ['apps/server/dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      GUEST_TOKEN_SECRET: 'e2e-codes-secret-000000000000000000000000',
      DATABASE_URL,
      BOLT_DB_CONNECT_ATTEMPTS: '2',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()));
  server.stderr?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()));
  let exited = false;
  server.once('exit', () => (exited = true));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const health = (await (await fetch(`${ORIGIN}/api/v1/health`)).json()) as {
        dependencies: { database: string };
      };
      if (health.dependencies.database === 'ok') return;
      skipReason = `the server on ${ORIGIN} reports database "${health.dependencies.database}"`;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  skipReason = `PostgreSQL is not reachable at BOLT_E2E_DATABASE_URL (run pnpm db:dev): ${
    serverLog
      .split('\n')
      .find((line) => line.includes('database_unavailable'))
      ?.slice(0, 200) ?? 'the server did not start'
  }`;
  console.warn(`codes.spec skipped: ${skipReason}`);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server!.once('exit', resolve));
    server.kill('SIGTERM');
    await stopped;
  }
});

test.beforeEach(() => {
  test.skip(skipReason !== '', skipReason);
});

/** Both phone sizes of one state, then back to the size the test runs at. */
async function snap(page: Page, name: string): Promise<void> {
  const before = page.viewportSize();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(EVIDENCE, `${size.width}x${size.height}_${name}.png`),
    });
  }
  if (before) await page.setViewportSize(before);
}

/** A fresh browser profile: another device, another guest. */
async function device(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 870, height: 370 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.warn(`page error: ${error.message}`));
  return { context, page };
}

/** Stores a car as the player's current one and skips the tutorial marks. */
async function seedCar(page: Page, blueprint: VehicleBlueprint): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(
    ([car]) => {
      window.localStorage.setItem('bolt.blueprint.v1', car!);
      window.localStorage.setItem(
        'bolt.tutorial.v1',
        JSON.stringify({ garage_tips: true, built: true, steered: true }),
      );
    },
    [serializeBlueprint(blueprint)],
  );
  await page.reload();
  await expect(page.getByTestId('home-car-name')).toHaveText(blueprint.name);
}

async function storedHash(page: Page): Promise<string> {
  const raw = await page.evaluate(() => window.localStorage.getItem('bolt.blueprint.v1'));
  return buildHash(JSON.parse(raw!) as VehicleBlueprint);
}

function codeInput(page: Page) {
  return page.getByRole('textbox', { name: 'Car code' });
}

const courier: VehicleBlueprint = { ...STARTER_TEMPLATES[2]!.blueprint, name: 'Code Courier' };
let sharedCode = '';
let ownerState: Awaited<ReturnType<BrowserContext['storageState']>> | null = null;

test('a saved car gets a code, and a second device loads the same car and races it', async ({
  browser,
}) => {
  test.slow();
  const owner = await device(browser);
  await seedCar(owner.page, courier);
  await owner.page.getByRole('button', { name: 'My Blueprints' }).tap();
  await owner.page.getByRole('button', { name: 'Save This Car' }).tap();
  const card = owner.page.getByRole('article', { name: 'Code Courier' });
  await expect(card.getByTestId('card-code')).toHaveCount(0);
  await card.getByRole('button', { name: 'Copy Code' }).tap();

  const sheet = owner.page.getByRole('dialog', { name: 'Share Blueprint' });
  const code = sheet.getByTestId('share-code');
  await expect(code).toHaveText(/^CAR-[0-9A-HJKMNP-TV-Z]{6}-[0-9A-HJKMNP-TV-Z]{2}$/);
  sharedCode = (await code.textContent())!;
  // No system share sheet in this browser: the fallback is copying.
  const native = await owner.page.evaluate(() => typeof navigator.share === 'function');
  await expect(sheet.getByRole('button', { name: 'Share', exact: true })).toHaveCount(
    native ? 1 : 0,
  );
  await snap(owner.page, 'share_sheet');
  await sheet.getByRole('button', { name: 'Copy Code' }).tap();
  await expect(sheet.getByTestId('share-status')).toHaveText('Code copied.');
  expect(await owner.page.evaluate(() => navigator.clipboard.readText())).toBe(sharedCode);
  await sheet.getByRole('button', { name: 'Copy Link' }).tap();
  expect(await owner.page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${ORIGIN}/car/${sharedCode}`,
  );
  await sheet.getByRole('button', { name: 'Close' }).tap();
  // The card now shows its code, and keeps it across a reload.
  await expect(card.getByTestId('card-code')).toHaveText(sharedCode);
  await owner.page.reload();
  await owner.page.getByRole('button', { name: 'My Blueprints' }).tap();
  await expect(
    owner.page.getByRole('article', { name: 'Code Courier' }).getByTestId('card-code'),
  ).toHaveText(sharedCode);
  await snap(owner.page, 'my_blueprints_with_code');
  // Copying again reuses the same code.
  await owner.page
    .getByRole('article', { name: 'Code Courier' })
    .getByRole('button', { name: 'Copy Code' })
    .tap();
  await expect(owner.page.getByTestId('share-code')).toHaveText(sharedCode);
  await owner.page
    .getByRole('dialog', { name: 'Share Blueprint' })
    .getByRole('button', { name: 'Close' })
    .tap();
  const ownerHash = await storedHash(owner.page);
  expect(ownerHash).toBe(buildHash(courier));
  ownerState = await owner.context.storageState();
  await owner.context.close();

  // A second device: its own guest, a different car.
  const friend = await device(browser);
  await seedCar(friend.page, { ...BASELINE_BLUEPRINT, name: 'Friend Car' });
  const lookups: string[] = [];
  friend.page.on('request', (request) => {
    if (request.url().includes('/api/v1/blueprints/')) lookups.push(request.url());
  });
  await friend.page.getByRole('button', { name: 'Load Code' }).tap();
  const overlay = friend.page.getByTestId('load-code');
  await expect(overlay).toBeVisible();
  await expect(friend.page.getByTestId('code-status')).toContainText(
    'Capitals and dashes are optional.',
  );
  // A typo is caught by the checksum on the device; the server is never asked.
  const symbols = sharedCode.replace(/^CAR-|-/g, '');
  const typo = symbols.slice(0, 3) + (symbols[3] === 'Z' ? 'Y' : 'Z') + symbols.slice(4);
  await codeInput(friend.page).fill(typo.toLowerCase());
  await expect(friend.page.getByTestId('code-status')).toHaveText(INVALID);
  expect(lookups).toEqual([]);
  await codeInput(friend.page).fill(symbols.slice(0, 4));
  await expect(friend.page.getByTestId('code-status')).toHaveText('4 of 8 characters');
  await snap(friend.page, 'load_code_typing');
  // Lower case, no dashes, no prefix: found.
  await codeInput(friend.page).fill(symbols.toLowerCase());
  await expect(friend.page.getByTestId('code-status')).toHaveText('Found it.');
  expect(lookups).toHaveLength(1);
  await expect(friend.page.getByTestId('code-car-name')).toHaveText('Code Courier');
  const badge = friend.page.getByTestId('code-badge');
  await expect(badge).toHaveText('Ready to Race');
  await expect(badge).toHaveAttribute('data-hash', ownerHash);
  await expect(friend.page.getByTestId('code-preview').locator('canvas')).toBeVisible();
  await snap(friend.page, 'load_code_found');
  // Using it replaces the current car only after asking.
  await friend.page.getByRole('button', { name: 'Use This Build' }).tap();
  await expect(friend.page.getByText('Replace Friend Car with Code Courier?')).toBeVisible();
  await friend.page.getByRole('button', { name: 'Keep Mine' }).tap();
  await friend.page.getByRole('button', { name: 'Use This Build' }).tap();
  await friend.page.getByRole('button', { name: 'Replace' }).tap();
  await expect(overlay).toHaveCount(0);
  await expect(friend.page.getByTestId('home-car-name')).toHaveText('Code Courier');
  expect(await storedHash(friend.page)).toBe(ownerHash);
  // Two devices, two guests.
  const guests = await friend.page.evaluate(() => window.localStorage.getItem('bolt.guest.v1'));
  const ownerGuest = ownerState!.origins[0]?.localStorage.find(
    (e) => e.name === 'bolt.guest.v1',
  )?.value;
  expect(guests?.split('.')[1]).not.toBe(ownerGuest?.split('.')[1]);

  // Race it.
  await friend.page.getByRole('button', { name: 'Start Racing' }).tap();
  await friend.page.getByRole('button', { name: 'Build Your Car' }).tap();
  await expect(friend.page.getByTestId('ready')).toBeVisible();
  await friend.page.getByTestId('ready').tap();
  await expect(friend.page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await expect(friend.page.locator('.hud-clock canvas')).not.toHaveAttribute(
    'aria-label',
    '0:00.00',
    {
      timeout: 40_000,
    },
  );
  expect(await storedHash(friend.page)).toBe(ownerHash);
  // On the server, not the offline test drive: the server has the room.
  const health = (await (await fetch(`${ORIGIN}/api/v1/health`)).json()) as { rooms: number };
  expect(health.rooms).toBeGreaterThan(0);
  await friend.context.close();
});

test('the results screen saves the car just raced and shares it', async ({ browser }) => {
  test.slow();
  const { context, page } = await device(browser);
  await seedCar(page, { ...STARTER_TEMPLATES[0]!.blueprint, name: 'Results Racer' });
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await expect(page.locator('.hud')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() =>
    (
      window as unknown as { __boltDebug: { hud: { showResults(): void } } }
    ).__boltDebug.hud.showResults(),
  );
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(results.getByRole('button')).toHaveText([
    'Race Again',
    'Change My Build',
    'Save This Car',
    'Share Blueprint',
    'Back Home',
  ]);
  await results.getByTestId('results-save').tap();
  await expect(results.getByRole('status').last()).toHaveText('Saved to My Blueprints.');
  await expect(results.getByTestId('results-save')).toHaveAttribute('data-saved', 'true');
  await results.getByTestId('results-save').tap();
  await expect(results.getByRole('status').last()).toHaveText(
    'This car is already in My Blueprints.',
  );
  await snap(page, 'results_save');
  await results.getByTestId('results-share').tap();
  const code = page.getByRole('dialog', { name: 'Share Blueprint' }).getByTestId('share-code');
  await expect(code).toHaveText(/^CAR-/);
  await snap(page, 'results_share');
  const lookup = await page.evaluate(
    async (c) => (await fetch(`/api/v1/blueprints/${c}`)).json(),
    (await code.textContent())!,
  );
  expect((lookup as { blueprint: VehicleBlueprint }).blueprint.name).toBe('Results Racer');
  await context.close();
});

test('a deep link /car/<code> opens Load Code with the car, and a bad link says why', async ({
  browser,
}) => {
  const { context, page } = await device(browser);
  await page.goto(`/car/${sharedCode.toLowerCase()}`);
  await expect(page.getByTestId('load-code')).toBeVisible({ timeout: 30_000 });
  await expect(codeInput(page)).toHaveValue(sharedCode);
  await expect(page.getByTestId('code-car-name')).toHaveText('Code Courier');
  // The address no longer carries the code, so a reload does not reopen it.
  expect(new URL(page.url()).search).toBe('');
  await page.getByRole('button', { name: 'Close' }).first().tap();
  await expect(page.getByTestId('load-code')).toHaveCount(0);

  await page.goto('/car/CAR-NOPE00-00');
  await expect(page.getByTestId('load-code')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('code-status')).toHaveText(INVALID);
  await context.close();
});

test('a code shared under an older catalog shows the approved copy and the repair flow', async ({
  browser,
}) => {
  const db = pgClient();
  await db.connect();
  const old: VehicleBlueprint = {
    ...BASELINE_BLUEPRINT,
    catalogVersion: '0.6.0',
    name: 'Old Timer',
  };
  const code = generateCarCode((n) => randomBytes(n));
  try {
    await db.query(
      `INSERT INTO blueprints (id, code, owner_guest_id, canonical_json, build_hash, catalog_version,
         name, paint_id, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, $4, '0.6.0', 'Old Timer', $5, now(), now())`,
      [randomUUID(), code, serializeBlueprint(old), buildHash(old), old.paintId],
    );
  } finally {
    await db.end();
  }
  const { context, page } = await device(browser);
  await seedCar(page, { ...BASELINE_BLUEPRINT, name: 'Current Car' });
  await page.getByRole('button', { name: 'My Blueprints' }).tap();
  await page.getByRole('button', { name: 'Load Code' }).tap();
  await codeInput(page).fill(code);
  const badge = page.getByTestId('code-badge');
  await expect(badge).toHaveText(OUTDATED);
  await expect(badge).toHaveAttribute('data-legal', 'false');
  await expect(page.getByRole('button', { name: 'Use This Build' })).toHaveCount(0);
  await snap(page, 'load_code_outdated');
  await page.getByRole('button', { name: 'Repair Build' }).tap();
  await expect(badge).toHaveText('Ready to Race');
  await expect(page.getByTestId('code-preview')).toContainText(
    'Repaired. This car is ready to race.',
  );
  // A copy can be kept; the original record on the server is never changed.
  await page.getByRole('button', { name: 'Save to My Blueprints' }).tap();
  await expect(page.getByTestId('code-preview')).toContainText('Saved a copy to My Blueprints.');
  await page.getByRole('button', { name: 'Use This Build' }).tap();
  await page.getByRole('button', { name: 'Replace' }).tap();
  await expect(page.getByTestId('load-code')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Old Timer' })).toBeVisible();
  const stillOld = (await page.evaluate(
    async (c) => (await fetch(`/api/v1/blueprints/${c}`)).json(),
    code,
  )) as {
    stale: boolean;
  };
  expect(stillOld.stale).toBe(true);
  await context.close();
});

test('deleting my data on the privacy page deletes my codes on the server and clears the device', async ({
  browser,
}) => {
  test.skip(ownerState === null, 'needs the owner from the first test');
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 870, height: 370 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    storageState: ownerState!,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('home-car-name')).toHaveText('Code Courier', { timeout: 30_000 });
  expect((await page.request.get(`/api/v1/blueprints/${sharedCode}`)).status()).toBe(200);

  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Privacy Info' }).tap();
  const privacy = page.getByTestId('privacy');
  await expect(privacy).toBeVisible();
  await expect(privacy.getByTestId('privacy-counts')).toContainText(
    'Saved cars on this device: 1.',
  );
  await expect(privacy.getByTestId('privacy-counts')).toContainText(
    'Shared codes on the server: 1.',
  );
  await snap(page, 'privacy_from_settings');
  await privacy.getByRole('button', { name: 'Delete My Data' }).scrollIntoViewIfNeeded();
  await snap(page, 'privacy_delete_control');
  await privacy.getByRole('button', { name: 'Delete My Data' }).tap();
  await expect(page.getByRole('alertdialog')).toContainText('This cannot be undone.');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep My Data' }).tap();
  expect((await page.request.get(`/api/v1/blueprints/${sharedCode}`)).status()).toBe(200);
  await privacy.getByRole('button', { name: 'Delete My Data' }).tap();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Everything' }).tap();
  await expect(page.getByTestId('privacy-status')).toHaveText(
    'Done. Everything is deleted. The game starts fresh.',
  );
  // The code stops resolving at once, for everyone.
  const gone = await page.request.get(`/api/v1/blueprints/${sharedCode}`);
  expect(gone.status()).toBe(404);
  expect(((await gone.json()) as { error: { message: string } }).error.message).toBe(INVALID);
  // The game restarts from a blank slate: no saved cars, no old guest pass.
  await expect(page.getByRole('button', { name: 'Start Racing' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('home-car-name')).toHaveText('Baseline Beetle');
  const keys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('bolt.')),
  );
  expect(keys).not.toContain('bolt.blueprints.v1');
  expect(keys).not.toContain('bolt.guest.v1');
  await context.close();

  // The privacy page also stands on its own at /privacy.
  const reader = await device(browser);
  await reader.page.goto('/privacy');
  await expect(reader.page.getByTestId('privacy')).toBeVisible({ timeout: 30_000 });
  await expect(reader.page.getByTestId('privacy-counts')).toContainText(
    'Shared codes on the server: none.',
  );
  await snap(reader.page, 'privacy_page');
  await reader.page.getByRole('button', { name: 'Back' }).tap();
  await expect(reader.page.getByRole('button', { name: 'Start Racing' })).toBeVisible();
  expect(new URL(reader.page.url()).pathname).toBe('/');
  await reader.context.close();
});
