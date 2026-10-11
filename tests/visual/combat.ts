import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import type { RaceEvent } from '@bolt/shared';
import type {} from '../../apps/web/src/game/debugHook.js';
import { inflateSync } from 'node:zlib';
import { PixelBuffer, writePng } from '../../art/scripts/lib/pixels.js';
import { SCENARIOS, runScenario } from '../scenarios/runner.js';

/**
 * Visual review of combat (Milestone C part 2). Plays every showcase scenario in the real
 * client, in a phone-sized viewport, on a manual clock, and saves for each key moment a
 * contact sheet of consecutive frames, so the animation of an effect can be judged and not
 * only one still of it. Key moments come from the scenario's own event timeline, run headless
 * here with the same simulation the page runs.
 *
 *   npx tsx tests/visual/combat.ts <baseUrl> <outDir> [scenario ...] [options]
 *
 *   --flashes     capture with Reduce Flashes off (it is on by default, as on first launch)
 *   --dsf=1       device scale factor (2 by default: the world is drawn at 2 device pixels;
 *                 1 is four times quicker to capture and is doubled in the sheets)
 *   --moments=5 --burst=6 --every=3 --merge=8   how many bursts, how long, how far apart
 *   --quality=low force the low effects tier
 *   --video       also record the four major examples of Section 13.3 in real time
 *   --hud         keep the HUD in the pictures
 *   --stress      capture the Section 19.5 stress scenario and print its frame statistics
 *
 * Output, per scenario: `<id>/<nn>_<what>_t<tick>.png` (a sheet of eight frames, 33 ms apart,
 * cropped round the cars) and `<id>/full_<nn>.png` (the whole screen at the peak).
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
const baseUrl = positional[0] ?? 'http://localhost:2672';
const outDir = resolve(positional[1] ?? 'tests/visual/out/combat');
const wanted = positional.slice(2);
const dsf = Number(flags.get('dsf') ?? 2);
const reduce = !flags.has('flashes');
const quality = flags.get('quality') ?? 'high';
const VIEW = { width: 870, height: 390 };
const CROP = {
  width: Number(flags.get('cropw') ?? 320),
  height: Number(flags.get('croph') ?? 190),
};
/** Events closer together than this share one burst of frames. */
const MERGE_TICKS = Number(flags.get('merge') ?? 6);
const MAX_MOMENTS = Number(flags.get('moments') ?? 8);
/** Pictures in a burst, and 60 Hz frames between them. */
const BURST = Number(flags.get('burst') ?? 8);
const EVERY = Number(flags.get('every') ?? 2);
const MAJOR = ['kinetic_impact', 'rocket_hit', 'mortar_strike', 'emp_burst', 'repair_burst'];

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

type Moment = { tick: number; label: string };

/** The moments of a scenario worth a burst of frames: where something visibly starts. */
function moments(events: RaceEvent[], goTick: number): Moment[] {
  const out: Moment[] = [];
  const interesting = new Set([
    'windup',
    'shot',
    'beam',
    'area',
    'telegraph',
    'hit',
    'explosion',
    'impact',
    'shield',
    'tether',
    'utility',
    'ko',
  ]);
  for (const event of events) {
    let label: string | null = null;
    if (interesting.has(event.type)) label = event.type;
    else if (event.type === 'status' && event.state !== 'blocked' && event.family !== 'immune')
      label = `${event.family}_${event.state}`;
    else if (event.type === 'hazard') label = `${event.kind}_${event.state}`;
    else if (event.type === 'component') label = `component_${event.condition}`;
    else if (event.type === 'warning') label = `warning_${event.kind}`;
    else if (event.type === 'lock' && event.locked) label = 'lock';
    if (!label) continue;
    const tick = event.tick - goTick;
    const last = out[out.length - 1];
    // Events within a quarter of a second of the last moment are in its burst already.
    if (last && tick - last.tick < MERGE_TICKS) {
      if (!last.label.includes(label) && last.label.length < 40) last.label += `+${label}`;
      continue;
    }
    out.push({ tick, label });
  }
  return out.slice(0, MAX_MOMENTS);
}

async function toTheGrid(page: Page, query: string): Promise<void> {
  await page.goto(`${baseUrl}/?${query}`);
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await page.locator('.hud').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__boltRace !== undefined, undefined, { timeout: 30_000 });
}

async function advanceTo(page: Page, raceTick: number): Promise<void> {
  // Two 60 Hz frames are one simulation tick. During the countdown the race tick stands at 0.
  await page.evaluate((target) => {
    const race = window.__boltRace!;
    for (let guard = 0; guard < 20000 && race.raceTick() < target; guard++) race.run(1);
  }, raceTick);
}

async function step(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => window.__boltRace!.run(n), frames);
  // Two animation frames, so the canvas shows what was just simulated.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Where to crop: round the middle of the two cars, kept on the screen. */
async function focus(page: Page): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate(() => window.__boltRace!.focus());
  return {
    x: Math.round(Math.min(VIEW.width - CROP.width, Math.max(0, centre.x - CROP.width / 2))),
    y: Math.round(Math.min(VIEW.height - CROP.height, Math.max(0, centre.y - CROP.height / 2))),
  };
}

async function newPage(browser: Browser, video: string | null): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: dsf,
    hasTouch: true,
    isMobile: true,
    ...(video ? { recordVideo: { dir: video, size: VIEW } } : {}),
  });
  await context.addInitScript(
    ([reduceFlashes]) => {
      try {
        const saved = JSON.parse(window.localStorage.getItem('bolt.settings.v1') ?? '{}') as Record<
          string,
          unknown
        >;
        window.localStorage.setItem(
          'bolt.settings.v1',
          JSON.stringify({ ...saved, reduceFlashes, muted: true }),
        );
      } catch {
        // No storage: the defaults apply.
      }
    },
    [reduce],
  );
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  console: ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
  return page;
}

async function captureScenario(browser: Browser, id: string): Promise<void> {
  const def = SCENARIOS.find((s) => s.id === id);
  if (!def) throw new Error(`no scenario ${id}`);
  const run = runScenario(def);
  const list = moments(run.events, run.goTick);
  const dir = join(outDir, id);
  mkdirSync(dir, { recursive: true });
  const page = await newPage(browser, null);
  await toTheGrid(page, `debug=1&manual=1&vfx=${quality}&scenario=${id}`);
  if (!flags.has('hud')) await page.addStyleTag({ content: '.hud{visibility:hidden !important}' });
  const lines: string[] = [];
  let index = 0;
  for (const moment of list) {
    // An event of tick T is shown one tick later, when the render clock reaches it.
    await advanceTo(page, moment.tick);
    const frames: PixelBuffer[] = [];
    const clip = { ...(await focus(page)), ...CROP };
    for (let f = 0; f < BURST; f++) {
      await step(page, EVERY);
      // One screenshot a frame: the crop for the sheet is cut from it here, not in the browser.
      const shot = await page.screenshot();
      if (f === Math.min(2, BURST - 1))
        writeFileSync(join(dir, `full_${String(index).padStart(2, '0')}.png`), shot);
      const full = decodePng(shot);
      const crop = new PixelBuffer(clip.width * dsf, clip.height * dsf);
      crop.copyFrom(full, clip.x * dsf, clip.y * dsf, crop.width, crop.height, 0, 0);
      // At device scale 1 a world pixel is one pixel: doubled, so every sheet reads alike.
      frames.push(dsf === 1 ? crop.scaled(2) : crop);
    }
    const fw = frames[0]!.width;
    const fh = frames[0]!.height;
    const columns = Math.min(4, frames.length);
    const rows = Math.ceil(frames.length / columns);
    const sheet = new PixelBuffer(fw * columns + 3 * (columns - 1), fh * rows + 3 * (rows - 1));
    frames.forEach((frame, i) =>
      sheet.blit(frame, (i % columns) * (fw + 3), Math.floor(i / columns) * (fh + 3)),
    );
    const name = `${String(index).padStart(2, '0')}_${moment.label.replace(/[^a-z0-9_+]/g, '')}_t${moment.tick}.png`;
    writePng(join(dir, name), sheet);
    lines.push(`${name}  tick ${moment.tick}  ${moment.label}`);
    index++;
  }
  const stats = await page.evaluate(() => window.__boltRace!.stats());
  writeFileSync(join(dir, 'moments.txt'), `${lines.join('\n')}\n${JSON.stringify(stats)}\n`);
  console.log(`${id}: ${list.length} moments, peak sprites per layer ${String(stats.peak)}`);
  await page.context().close();
}

async function recordScenario(browser: Browser, id: string): Promise<void> {
  const def = SCENARIOS.find((s) => s.id === id)!;
  const dir = join(outDir, 'video', id);
  mkdirSync(dir, { recursive: true });
  const page = await newPage(browser, dir);
  await toTheGrid(page, `debug=1&scenario=${id}`);
  // Real time, on the page's own clock: this is what shows motion (Section 19.4).
  await page.waitForTimeout(((def.countdownTicks + def.durationTicks) / 30) * 1000 + 1500);
  const stats = await page.evaluate(() => window.__boltRace!.stats());
  console.log(
    `${id}: recorded, frame ${String(stats.frameMs)} ms (software rendering), peak ${String(stats.frameMsPeak)} ms`,
  );
  await page.context().close();
}

async function stress(browser: Browser): Promise<void> {
  const dir = join(outDir, 'stress');
  mkdirSync(dir, { recursive: true });
  for (const tier of ['high', 'low']) {
    const page = await newPage(browser, null);
    await toTheGrid(page, `debug=1&vfxStress=1&vfx=${tier}&scenario=rocket_hit`);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: join(dir, `stress_${tier}.png`) });
    const stats = await page.evaluate(() => window.__boltRace!.stats());
    console.log(`stress ${tier}: ${JSON.stringify(stats)}`);
    writeFileSync(join(dir, `stress_${tier}.json`), `${JSON.stringify(stats, null, 2)}\n`);
    await page.context().close();
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: GL });
  const ids = wanted.length > 0 ? wanted : SCENARIOS.map((s) => s.id);
  if (flags.has('stress')) await stress(browser);
  else {
    for (const id of ids) await captureScenario(browser, id);
    if (flags.has('video')) for (const id of MAJOR) await recordScenario(browser, id);
  }
  await browser.close();
}

await main();
