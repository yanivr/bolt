import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { TRACKS } from '@bolt/content';
import type {} from '../../apps/web/src/game/debugHook.js';
import { inflateSync } from 'node:zlib';
import { PixelBuffer, writePng } from '../../art/scripts/lib/pixels.js';

/**
 * Visual review of the weather and environment layer (Milestone D). For each of the sixteen
 * courses (the layout view where a track has no bake, the baked art where it has one) it
 * races the autopilot in the real client at 870 x 390 on a manual clock and saves:
 *
 *   <out>/<track>_<preset>/close.png    both cars close together, just after the start
 *   <out>/<track>_<preset>/full.png     the whole screen ten seconds in
 *   <out>/<track>_<preset>/burst.png    six consecutive frames (two 60 Hz frames apart) round
 *                                       the car while driving, as a sheet
 *   <out>/<track>_<preset>/stats.txt    what the race view says it drew
 *
 * and, for the heaviest three (heavy rain, sandstorm, snowfall), the same with Reduced Motion
 * (`_rm`) and at the low effects tier (`_low`). `--stress` instead runs the Section 19.5
 * stress scenario in heavy rain at both tiers, with and without the weather layer, in real
 * time, and prints the frame times (software rendering: evidence of the caps, not of a phone).
 *
 *   npx tsx tests/visual/weather.ts [baseUrl] [outDir] [track_preset ...] [--dsf=2] [--stress]
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
const baseUrl = positional[0] ?? 'http://localhost:2681';
const outDir = resolve(positional[1] ?? 'tests/visual/out/weather');
const only = positional.slice(2);
const dsf = Number(flags.get('dsf') ?? 2);
const VIEW = { width: 870, height: 390 };
const CROP = { width: 300, height: 170 };
const HEAVY = ['forest_heavy_rain', 'desert_sandstorm', 'snow_snowfall'];
const GL = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/** Decodes a browser screenshot: 8-bit RGB or RGBA, any filter. */
function decodePng(bytes: Buffer): PixelBuffer {
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

type Variant = { suffix: string; query: string; reducedMotion: boolean };
const NORMAL: Variant = { suffix: '', query: '', reducedMotion: false };
const REDUCED: Variant = { suffix: '_rm', query: '&motion=reduce', reducedMotion: true };
const LOW: Variant = { suffix: '_low', query: '&vfx=low', reducedMotion: false };

async function newPage(
  browser: Browser,
  trackId: string,
  presetId: string,
  v: Variant,
): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: dsf,
    hasTouch: true,
    isMobile: true,
    reducedMotion: v.reducedMotion ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(
    ([t, p]) => {
      window.localStorage.setItem('bolt.course.v1', JSON.stringify({ trackId: t, presetId: p }));
      // Flashes on (so a storm may show its lightning), sound off.
      window.localStorage.setItem(
        'bolt.settings.v1',
        JSON.stringify({ reduceFlashes: false, muted: true }),
      );
    },
    [trackId, presetId],
  );
  // The race runs in the page (the offline drive), so the manual clock stops all of it.
  await context.route('**/api/v1/health', (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  console: ${m.text()}`);
  });
  return page;
}

async function toTheGrid(page: Page, query: string): Promise<void> {
  await page.goto(`${baseUrl}/?${query}`);
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await page.locator('.hud').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__boltRace !== undefined, undefined, { timeout: 30_000 });
  await page.addStyleTag({ content: '.hud{visibility:hidden !important}' });
}

async function advanceTo(page: Page, raceTick: number): Promise<void> {
  await page.evaluate((target) => {
    const race = window.__boltRace!;
    for (let guard = 0; guard < 20000 && race.raceTick() < target; guard++) race.run(1);
  }, raceTick);
}

async function step(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => window.__boltRace!.run(n), frames);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function focus(page: Page): Promise<{ x: number; y: number }> {
  const c = await page.evaluate(() => window.__boltRace!.ownCar?.() ?? window.__boltRace!.focus());
  return {
    x: Math.round(Math.min(VIEW.width - CROP.width, Math.max(0, c.x - CROP.width / 2))),
    y: Math.round(Math.min(VIEW.height - CROP.height, Math.max(0, c.y - CROP.height / 2))),
  };
}

async function capture(
  browser: Browser,
  trackId: string,
  presetId: string,
  v: Variant,
): Promise<void> {
  const dir = join(outDir, `${trackId}_${presetId}${v.suffix}`);
  mkdirSync(dir, { recursive: true });
  const page = await newPage(browser, trackId, presetId, v);
  await toTheGrid(
    page,
    `debug=1&autopilot=1&manual=1${v.query.includes('vfx') ? '' : '&vfx=high'}${v.query}`,
  );
  // Both cars together, just after GO.
  await advanceTo(page, 50);
  await step(page, 2);
  await page.screenshot({ path: join(dir, 'close.png') });
  // Ten seconds in, then a burst of consecutive frames round the car.
  await advanceTo(page, 300);
  await step(page, 2);
  const clip = await focus(page);
  const frames: PixelBuffer[] = [];
  for (let f = 0; f < 6; f++) {
    await step(page, 2);
    const shot = await page.screenshot();
    if (f === 0) writeFileSync(join(dir, 'full.png'), shot);
    const full = decodePng(shot);
    const crop = new PixelBuffer(CROP.width * dsf, CROP.height * dsf);
    crop.copyFrom(full, clip.x * dsf, clip.y * dsf, crop.width, crop.height, 0, 0);
    frames.push(crop);
  }
  const fw = frames[0]!.width;
  const fh = frames[0]!.height;
  const sheet = new PixelBuffer(fw * 3 + 6, fh * 2 + 3);
  frames.forEach((frame, i) => sheet.blit(frame, (i % 3) * (fw + 3), Math.floor(i / 3) * (fh + 3)));
  writePng(join(dir, 'burst.png'), sheet);
  const stats = await page.evaluate(() => window.__boltRace!.stats());
  const badge = await page.locator('[data-testid="layout-badge"]').count();
  const art = badge > 0 ? 'layout view' : 'baked art';
  writeFileSync(join(dir, 'stats.txt'), `${art}\n${JSON.stringify(stats, null, 2)}\n`);
  console.log(
    `${trackId}/${presetId}${v.suffix}: ${art}; weather sprites ${String(stats.wxSprites)}, particles ${String(stats.wxParticles)}, layers: ${String(stats.wxLayers)}`,
  );
  await page.context().close();
}

/** `--tour=<ticks>`: full frames every three seconds of a race, to find anchored ambience. */
async function tour(
  browser: Browser,
  trackId: string,
  presetId: string,
  until: number,
): Promise<void> {
  const dir = join(outDir, `${trackId}_${presetId}_tour`);
  mkdirSync(dir, { recursive: true });
  const page = await newPage(browser, trackId, presetId, NORMAL);
  await toTheGrid(page, 'debug=1&autopilot=1&manual=1&vfx=high');
  for (let tick = 90; tick <= until; tick += 90) {
    await advanceTo(page, tick);
    await step(page, 2);
    await page.screenshot({ path: join(dir, `t${String(tick).padStart(4, '0')}.png`) });
  }
  console.log(`${trackId}/${presetId}: tour to tick ${until}`);
  await page.context().close();
}

async function stress(browser: Browser): Promise<void> {
  const dir = join(outDir, 'stress');
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (const tier of ['high', 'low'])
    for (const weather of ['1', '0']) {
      const page = await newPage(browser, 'city_01', 'city_clear_night', NORMAL);
      await toTheGrid(page, `debug=1&autopilot=1&vfxStress=1&vfx=${tier}&weather=${weather}`);
      await page.waitForTimeout(4000);
      // Frame time on the page's own clock: sample the smoothed value for five seconds.
      const samples: number[] = [];
      for (let k = 0; k < 10; k++) {
        await page.waitForTimeout(500);
        const s = await page.evaluate(() => window.__boltRace!.stats());
        samples.push(Number(s.frameMs));
      }
      const stats = await page.evaluate(() => window.__boltRace!.stats());
      await page.screenshot({ path: join(dir, `stress_${tier}_weather${weather}.png`) });
      samples.sort((a, b) => a - b);
      const line = `stress ${tier} weather=${weather}: frame ms median ${samples[5]} (min ${samples[0]}, max ${samples[9]}), peak ${String(stats.frameMsPeak)}; combat sprites ${String(stats.sprites)}, weather sprites ${String(stats.wxSprites ?? 0)}, weather particles ${String(stats.wxParticles ?? 0)}`;
      console.log(line);
      lines.push(line, JSON.stringify(stats));
      await page.context().close();
    }
  writeFileSync(join(dir, 'stress.txt'), `${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: GL });
  if (flags.has('stress')) await stress(browser);
  else if (flags.has('tour'))
    for (const key of only) {
      const def = Object.values(TRACKS).find((d) => key.startsWith(`${d.id}_`))!;
      await tour(browser, def.id, key.slice(def.id.length + 1), Number(flags.get('tour')));
    }
  else
    for (const def of Object.values(TRACKS))
      for (const presetId of def.weatherPresetIds) {
        const key = `${def.id}_${presetId}`;
        if (only.length > 0 && !only.some((o) => key.includes(o))) continue;
        await capture(browser, def.id, presetId, NORMAL);
        if (HEAVY.includes(presetId)) {
          await capture(browser, def.id, presetId, REDUCED);
          await capture(browser, def.id, presetId, LOW);
        }
      }
  await browser.close();
}

await main();
