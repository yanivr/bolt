import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { TRACKS } from '@bolt/content';
import type {} from '../../apps/web/src/game/debugHook.js';
import { PixelBuffer, writePng } from '../../art/scripts/lib/pixels.js';
import { reduceColors } from '../../art/scripts/terrain/chunks.js';

/**
 * Art-director review of every launch course in the real client (Milestone D). For each of the
 * sixteen courses it races the autopilot on a manual clock at 870 x 370 CSS pixels, two device
 * pixels to a CSS pixel (the `Close` step then shows 870 world pixels across, as on the owner's
 * phone), and saves:
 *
 *   <out>/<track>_<preset>/close_<k>.png  six frames spread over the first lap, HUD hidden
 *   <out>/<track>_<preset>/far.png        one frame at the `Far` camera step
 *   <out>/<track>_<preset>/hud.png        the whole screen with the HUD and its minimap
 *   <out>/<track>_<preset>/minimap.png    the HUD's minimap alone
 *   <out>/<track>_<preset>/stats.txt      what the race view says it drew, and page errors
 *
 * and with `--sheets=<dir>` one contact sheet per course (three `Close` frames, the `Far`
 * frame and the HUD frame at 1x, folded to 256 colors) for `docs/evidence/tracks`.
 * Needs a server: `PORT=2676 WEB_DIST=<build> node apps/server/dist/main.js`.
 *
 *   npx tsx tests/visual/courses.ts [baseUrl] [outDir] [track_preset ...] [--sheets=dir]
 *       [--motion=reduce] [--flashes=reduce] [--vfx=low] [--ticks=90,120]
 *
 * `--ticks` instead saves only `tick_<n>.png` at those race ticks (a hazard against its
 * timetable, say).
 */

const args = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    flags.set(key!, value ?? '1');
  } else positional.push(arg);
}
const baseUrl = positional[0] ?? 'http://localhost:2676';
const outDir = resolve(positional[1] ?? 'tests/visual/out/courses');
const only = positional.slice(2);
const sheetsDir = flags.has('sheets') ? resolve(flags.get('sheets')!) : null;
const reducedMotion = flags.get('motion') === 'reduce';
const reduceFlashes = flags.get('flashes') === 'reduce';
const vfx = flags.get('vfx') ?? 'high';
const ticks = (flags.get('ticks') ?? '')
  .split(',')
  .filter((t) => t !== '')
  .map(Number);
const VIEW = { width: 870, height: 370 };
const DSF = 2;
const GL = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
/** Seconds a lap takes the default car on the first weather (docs/TRACK_API.md, race / 3). */
const LAP_SECONDS: Record<string, number> = {
  city_01: 40,
  city_02: 36,
  desert_01: 46,
  desert_02: 43,
  forest_01: 34,
  forest_02: 42,
  snow_01: 34,
  industrial_01: 37,
};

/** Decodes a browser screenshot: 8-bit RGB or RGBA, any filter. */
function decodeShot(bytes: Buffer): PixelBuffer {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6))
        throw new Error('Unsupported screenshot format');
      channels = body[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    offset += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new PixelBuffer(width, height);
  const stride = width * channels;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let value = v;
      if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      out.data[di] = cur[x * channels]!;
      out.data[di + 1] = cur[x * channels + 1]!;
      out.data[di + 2] = cur[x * channels + 2]!;
      out.data[di + 3] = 255;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return out;
}

/** Every `f`-th pixel: a screenshot at two device pixels back to one per CSS pixel. */
function shrink(src: PixelBuffer, f: number): PixelBuffer {
  const out = new PixelBuffer(Math.floor(src.width / f), Math.floor(src.height / f));
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) out.set(x, y, src.get(x * f, y * f));
  return out;
}

async function openRace(
  browser: Browser,
  trackId: string,
  presetId: string,
  camera: 'close' | 'far',
): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: DSF,
    hasTouch: true,
    isMobile: true,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(
    ([t, p, cam, flashes]) => {
      window.localStorage.setItem('bolt.course.v1', JSON.stringify({ trackId: t, presetId: p }));
      window.localStorage.setItem(
        'bolt.settings.v1',
        JSON.stringify({ reduceFlashes: flashes === '1', muted: true, cameraDistance: cam }),
      );
    },
    [trackId, presetId, camera, reduceFlashes ? '1' : '0'],
  );
  // The race runs in the page (the offline drive), so the manual clock stops all of it.
  await context.route('**/api/v1/health', (route) => route.abort());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // The health check is aborted on purpose (the race runs offline in the page).
    if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED'))
      errors.push(`console: ${m.text()}`);
  });
  const motion = reducedMotion ? '&motion=reduce' : '';
  await page.goto(`${baseUrl}/?debug=1&autopilot=1&manual=1&vfx=${vfx}${motion}`);
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await page.locator('.hud').waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => window.__boltRace !== undefined, undefined, { timeout: 60_000 });
  return { page, errors };
}

async function advanceTo(page: Page, raceTick: number): Promise<void> {
  await page.evaluate((target) => {
    const race = window.__boltRace!;
    for (let guard = 0; guard < 40000 && race.raceTick() < target; guard++) race.run(1);
  }, raceTick);
  await page.evaluate(() => window.__boltRace!.run(2));
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

const hideHud = (page: Page) =>
  page.addStyleTag({ content: '.hud{visibility:hidden !important}' }).then(() => undefined);
const showHud = (page: Page) =>
  page.addStyleTag({ content: '.hud{visibility:visible !important}' }).then(() => undefined);

async function capture(browser: Browser, trackId: string, presetId: string): Promise<void> {
  const dir = join(outDir, `${trackId}_${presetId}`);
  mkdirSync(dir, { recursive: true });
  const lap = LAP_SECONDS[trackId] ?? 40;
  const lines: string[] = [];
  const close: PixelBuffer[] = [];

  const { page, errors } = await openRace(browser, trackId, presetId, 'close');
  const badge = await page.locator('[data-testid="layout-badge"]').count();
  if (ticks.length > 0) {
    // Only the asked race ticks, HUD hidden: for checking a hazard against its timetable.
    await hideHud(page);
    for (const tick of ticks) {
      await advanceTo(page, tick);
      await page.screenshot({ path: join(dir, `tick_${String(tick).padStart(4, '0')}.png`) });
    }
    await page.context().close();
    console.log(`${trackId}/${presetId}: ticks ${ticks.join(', ')}; errors ${errors.length}`);
    return;
  }
  lines.push(
    badge > 0 ? 'layout view' : 'baked art',
    `view ${JSON.stringify(await page.evaluate(() => window.__boltRace!.view()))}`,
  );
  // The HUD and its minimap at the first frame's moment, then the same moment without it.
  await advanceTo(page, 90);
  const hudShot = await page.screenshot();
  writeFileSync(join(dir, 'hud.png'), hudShot);
  const mini = page.locator('canvas.minimap');
  if ((await mini.count()) > 0) await mini.first().screenshot({ path: join(dir, 'minimap.png') });
  await hideHud(page);
  for (let k = 0; k < 6; k++) {
    // Spread over the first lap, from just after the start.
    const tick = Math.round((3 + (k * lap) / 6) * 30);
    await advanceTo(page, tick);
    const shot = await page.screenshot();
    writeFileSync(join(dir, `close_${k}.png`), shot);
    close.push(shrink(decodeShot(shot), DSF));
  }
  const stats = await page.evaluate(() => window.__boltRace!.stats());
  lines.push(`close stats ${JSON.stringify(stats)}`);
  await showHud(page);
  await page.context().close();

  const far = await openRace(browser, trackId, presetId, 'far');
  await advanceTo(far.page, Math.round((3 + lap * 0.45) * 30));
  await hideHud(far.page);
  await far.page.evaluate(() => window.__boltRace!.run(2));
  const farShot = await far.page.screenshot();
  writeFileSync(join(dir, 'far.png'), farShot);
  lines.push(
    `far view ${JSON.stringify(await far.page.evaluate(() => window.__boltRace!.view()))}`,
  );
  await far.page.context().close();

  const allErrors = [...errors, ...far.errors];
  lines.push(`errors ${allErrors.length === 0 ? 'none' : allErrors.join(' | ')}`);
  writeFileSync(join(dir, 'stats.txt'), `${lines.join('\n')}\n`);
  console.log(
    `${trackId}/${presetId}: ${badge > 0 ? 'LAYOUT VIEW' : 'baked art'}; layers ${String(stats.wxLayers)}; errors ${allErrors.length}`,
  );

  if (sheetsDir) {
    mkdirSync(sheetsDir, { recursive: true });
    const gap = 6;
    const tiles = [
      close[0]!,
      close[2]!,
      close[4]!,
      shrink(decodeShot(farShot), DSF),
      shrink(decodeShot(hudShot), DSF),
    ];
    const cols = 2;
    const rows = Math.ceil(tiles.length / cols);
    const sheet = new PixelBuffer(
      cols * (VIEW.width + gap) + gap,
      rows * (VIEW.height + gap) + gap,
    );
    sheet.fill([16, 19, 31, 255]);
    tiles.forEach((t, i) =>
      sheet.blit(
        t,
        gap + (i % cols) * (VIEW.width + gap),
        gap + Math.floor(i / cols) * (VIEW.height + gap),
      ),
    );
    reduceColors(sheet, 256);
    writePng(join(sheetsDir, `${trackId}_${presetId}.png`), sheet);
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: GL });
  for (const def of Object.values(TRACKS))
    for (const presetId of def.weatherPresetIds) {
      const key = `${def.id}_${presetId}`;
      if (only.length > 0 && !only.some((o) => key.includes(o))) continue;
      try {
        await capture(browser, def.id, presetId);
      } catch (e) {
        console.log(`${key}: FAILED ${(e as Error).message}`);
      }
    }
  await browser.close();
}

await main();
