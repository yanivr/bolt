// Development harness (not shipped, deleted before hand-off): paints a course with a cached
// corridor field and writes quick review images to the scratchpad.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTrack, getWeatherPreset } from '@bolt/content';
import { buildTrack, hashString } from '@bolt/shared';
import { PixelBuffer, writePng } from '../../lib/pixels.js';
import type { BiomeModule } from '../biome.js';
import { Canvas } from '../canvas.js';
import { buildCorridorField } from '../field.js';
import type { CorridorField } from '../field.js';
import { downscale } from '../preview.js';

const SCRATCH = '/tmp/claude-0/-home-claude/9a9c2fd5-f17b-5127-9c0e-ccddc4d2f788/scratchpad';

function cachedField(id: string, track: ReturnType<typeof buildTrack>): CorridorField {
  const file = join(SCRATCH, `field_${id}.bin`);
  const w = track.def.worldWidth;
  const h = track.def.worldHeight;
  const n = w * h;
  if (existsSync(file)) {
    const buf = readFileSync(file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    let o = 0;
    const f32 = (): Float32Array => {
      const a = new Float32Array(ab, o, n);
      o += n * 4;
      return a;
    };
    const edge = f32();
    const lateral = f32();
    const s = f32();
    const half = f32();
    const sample = new Uint16Array(ab, o, n);
    o += n * 2;
    const branch = new Uint8Array(ab, o, n);
    o += n;
    const zone = new Uint8Array(ab, o, n);
    o += n;
    const surface = new Uint8Array(ab, o, n);
    o += n;
    const meta = JSON.parse(buf.subarray(o).toString('utf8')) as { surfaces: string[] };
    const real = buildCorridorField.length; // keep import used
    void real;
    return {
      w,
      h,
      track,
      edge,
      lateral,
      s,
      half,
      branch,
      sample,
      zone,
      surface,
      surfaces: meta.surfaces as CorridorField['surfaces'],
      smoothCurvature: track.branches.map((b) => Float32Array.from(b.curvature)),
    };
  }
  const f = buildCorridorField(track);
  const parts = [
    Buffer.from(f.edge.buffer),
    Buffer.from(f.lateral.buffer),
    Buffer.from(f.s.buffer),
    Buffer.from(f.half.buffer),
    Buffer.from(f.sample.buffer),
    Buffer.from(f.branch.buffer),
    Buffer.from(f.zone.buffer),
    Buffer.from(f.surface.buffer),
    Buffer.from(JSON.stringify({ surfaces: f.surfaces })),
  ];
  writeFileSync(file, Buffer.concat(parts));
  return f;
}

export async function dev(module: BiomeModule): Promise<void> {
  const id = process.argv[2]!;
  const presetId = process.argv[3]!;
  const def = getTrack(id)!;
  const preset = getWeatherPreset(presetId)!;
  const track = buildTrack(def);
  const field = cachedField(id, track);
  const world = Canvas.world(def.worldWidth, def.worldHeight);
  const t0 = performance.now();
  const out = module.paint({
    def,
    track,
    field,
    presetId,
    preset,
    world,
    seed: hashString(`${def.id}:${presetId}`),
  });
  console.log(`paint ${((performance.now() - t0) / 1000).toFixed(1)} s`, out.checks);
  for (const o of out.overlays) {
    let n = 0;
    for (let i = 3; i < o.canvas.data.length; i += 4) if (o.canvas.data[i]) n++;
    if (n > o.canvas.w * o.canvas.h * 0.8 && o.canvas.w * o.canvas.h > 400) console.log('SOLID overlay', o.id, o.x, o.y, o.canvas.w, o.canvas.h);
  }
  for (const a of out.animated) {
    const f = a.frames[0]!;
    let n = 0;
    for (let i = 3; i < f.data.length; i += 4) if (f.data[i]) n++;
    if (a.above && n > f.w * f.h * 0.8) console.log('SOLID anim', a.id, a.x, a.y, f.w, f.h);
  }
  {
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < world.w * world.h; i++) if (world.data[i * 4 + 3] !== 255) { n++; const x = i % world.w, y = (i / world.w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (n) console.log('HOLES in ground', n, x0, y0, x1, y1);
  }
  const probe = (process.env.PROBE ?? '').split(',').map(Number);
  if (probe.length === 2) {
    for (const o of out.overlays) if (probe[0]! >= o.x && probe[0]! < o.x + o.canvas.w && probe[1]! >= o.y && probe[1]! < o.y + o.canvas.h) console.log('PROBE overlay', o.id, o.canvas.alpha(probe[0]! - o.x, probe[1]! - o.y));
    for (const a of out.animated) { const f = a.frames[0]!; if (probe[0]! >= a.x && probe[0]! < a.x + f.w && probe[1]! >= a.y && probe[1]! < a.y + f.h) console.log('PROBE anim', a.id, a.above, f.alpha(probe[0]! - a.x, probe[1]! - a.y)); }
  }
  const comp = world.crop(0, 0, world.w, world.h);
  for (const o of out.overlays) comp.blit(o.canvas, o.x, o.y);
  for (const a of out.animated) if (a.above) comp.blit(a.frames[0]!, a.x, a.y);
  const dir = join(SCRATCH, `${id}_${presetId}`);
  mkdirSync(dir, { recursive: true });
  writePng(join(dir, 'overview.png'), downscale(comp, 4));
  writePng(join(dir, 'ground_overview.png'), downscale(world, 4));
  const spots = out.previewCars ?? [];
  for (const sp of spots) {
    const vw = 870;
    const vh = 390;
    const x0 = Math.max(0, Math.min(world.w - vw, Math.round(sp.x - vw / 2)));
    const y0 = Math.max(0, Math.min(world.h - vh, Math.round(sp.y - vh / 2)));
    const v = new PixelBuffer(vw, vh);
    v.copyFrom(comp.buf, x0, y0, vw, vh, 0, 0);
    writePng(join(dir, `view_${sp.name}.png`), v);
    const g = new PixelBuffer(vw, vh);
    g.copyFrom(world.buf, x0, y0, vw, vh, 0, 0);
    writePng(join(dir, `ground_${sp.name}.png`), g);
  }
  console.log(`overlays ${out.overlays.length} animated ${out.animated.length} -> ${dir}`);
}
