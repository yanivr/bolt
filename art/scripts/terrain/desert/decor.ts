import { hash2, mulberry32 } from '@bolt/shared';
import type { Canvas, Color } from '../canvas.js';
import type { CorridorField } from '../field.js';
import { FAR } from '../field.js';
import { K_OFFROAD, distanceTo } from './masks.js';
import type { Masks } from './masks.js';
import type { RegionGrid, SlopeGrid } from './ground.js';
import { slopeAt } from './ground.js';
import type { Look } from './palette.js';
import { PAL, darker, lighter } from './palette.js';
import { emptyRegion } from './spec.js';
import type { TerrainSpec } from './spec.js';

/**
 * Ground detail a car drives straight over: creosote and sage clumps, dry grass, pebbles,
 * old tire tracks across the sand. All of it is flat on the ground plane with at most a one
 * or two pixel contact shadow, so the open sand reads as drivable (rough, slower) ground and
 * never as a barrier. Placement is a jittered grid weighted by the track's regions.
 */

const SEED = 6607;

type Put = (x: number, y: number, c: Color) => void;

export type DecorStats = { scrub: number; tufts: number; pebbles: number; tracks: number; gullies: number };

export function paintDecor(
  world: Canvas,
  field: CorridorField,
  masks: Masks,
  spec: TerrainSpec,
  look: Look,
  regions: RegionGrid,
  slopes: SlopeGrid,
  seed: number,
): DecorStats {
  const { w, h } = masks;
  const data = world.data;
  const ok = (x: number, y: number, margin: number): boolean => {
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) return false;
    const p = y * w + x;
    if (masks.kind[p] !== K_OFFROAD || masks.solid[p]) return false;
    const e = field.edge[p]!;
    return e >= FAR || e > margin;
  };
  const get = (x: number, y: number): Color => {
    const o = (y * w + x) * 4;
    return (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
  };
  const put: Put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (masks.kind[p] !== K_OFFROAD) return;
    const o = p * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
  };
  const shadow = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (masks.kind[y * w + x] !== K_OFFROAD) return;
    put(x, y, look.shade(get(x, y)));
  };
  const reg = emptyRegion();
  const stats: DecorStats = { scrub: 0, tufts: 0, pebbles: 0, tracks: 0, gullies: 0 };
  const rock = spec.rock;

  // Scrub clumps and dry grass.
  const G = 26;
  for (let cy = 0; cy < h; cy += G)
    for (let cx = 0; cx < w; cx += G) {
      const hx = hash2(cx, cy, SEED + seed);
      const x = Math.round(cx + hash2(cx, cy, SEED + 1) * G);
      const y = Math.round(cy + hash2(cx, cy, SEED + 2) * G);
      if (!ok(x, y, 6)) continue;
      regions.sample(x, y, reg);
      const want = reg.brush * (1 - reg.playa * 0.9);
      if (hx < want * 0.42) {
        const size = 2 + hash2(cx, cy, SEED + 3) * 3.4;
        const dead = hash2(cx, cy, SEED + 4) < 0.22;
        scrub(put, shadow, x, y, size, dead, hash2(cx, cy, SEED + 5) * 1e6);
        stats.scrub++;
      } else if (hx < want * 0.42 + 0.1 * (1 - reg.playa)) {
        tuft(put, x, y, hash2(cx, cy, SEED + 6) * 1e6);
        stats.tufts++;
      }
    }

  // Pebbles and stones, denser where the region says rubble.
  const P = 18;
  for (let cy = 0; cy < h; cy += P)
    for (let cx = 0; cx < w; cx += P) {
      const x = Math.round(cx + hash2(cx, cy, SEED + 11) * P);
      const y = Math.round(cy + hash2(cx, cy, SEED + 12) * P);
      if (!ok(x, y, 3)) continue;
      regions.sample(x, y, reg);
      if (hash2(cx, cy, SEED + 13) > reg.rubble * 0.55 + 0.03) continue;
      const rnd = mulberry32(((cx * 7919) ^ (cy * 104729) ^ seed) >>> 0);
      const n = 2 + Math.floor(rnd() * (2 + reg.rubble * 6));
      for (let k = 0; k < n; k++) {
        const px = Math.round(x + (rnd() - 0.5) * 12);
        const py = Math.round(y + (rnd() - 0.5) * 8);
        if (!ok(px, py, 2)) continue;
        const big = rnd() < 0.25;
        const tone = rnd();
        const base = tone < 0.4 ? rock.mid : tone < 0.8 ? rock.base : rock.dark;
        if (big) {
          put(px, py, lighter(base, 0.25));
          put(px + 1, py, base);
          put(px, py + 1, base);
          put(px + 1, py + 1, darker(base, 0.3));
          shadow(px + 2, py + 1);
          shadow(px + 1, py + 2);
          shadow(px + 2, py + 2);
        } else {
          put(px, py, base);
          shadow(px + 1, py + 1);
        }
      }
      stats.pebbles++;
    }

  // Rills down the slopes: dry drainage lines that run with the fall of the land, which is
  // what tells a dip or a descent from flat ground when the light alone is too gentle.
  const C = 44;
  for (let cy = 0; cy < h; cy += C)
    for (let cx = 0; cx < w; cx += C) {
      let x = cx + hash2(cx, cy, SEED + 41) * C;
      let y = cy + hash2(cx, cy, SEED + 42) * C;
      const g0 = slopeAt(slopes, x, y);
      const steep = Math.hypot(g0.x, g0.y);
      if (steep < 0.07 || hash2(cx, cy, SEED + 43) > Math.min(0.85, (steep - 0.07) * 9)) continue;
      const steps = 30 + Math.floor(hash2(cx, cy, SEED + 44) * 60);
      let drawn = 0;
      for (let k = 0; k < steps; k++) {
        const g = slopeAt(slopes, x, y);
        const m = Math.hypot(g.x, g.y);
        if (m < 0.02) break;
        x -= (g.x / m) * 1.1 + (hash2(Math.round(x), Math.round(y), SEED + 45) - 0.5) * 0.9;
        y -= (g.y / m) * 1.1 + (hash2(Math.round(y), Math.round(x), SEED + 46) - 0.5) * 0.9;
        const px = Math.round(x);
        const py = Math.round(y);
        if (!ok(px, py, 8)) break;
        put(px, py, darker(get(px, py), 0.12));
        if (k % 2 === 0 && ok(px - 1, py - 1, 8)) put(px - 1, py - 1, lighter(get(px - 1, py - 1), 0.12));
        drawn++;
      }
      if (drawn > 8) stats.gullies++;
    }

  // Sand tails in the lee of every rock, longer as the wind blows harder.
  const wind = look.wind;
  const tail = 1.4 + Math.min(1, wind.speed / 60) * 2.2;
  for (const o of field.track.obstacles) {
    const len = o.radius * tail;
    const R = Math.ceil(len + o.radius + 2);
    for (let yy = -R; yy <= R; yy++)
      for (let xx = -R; xx <= R; xx++) {
        const px = Math.round(o.x + xx);
        const py = Math.round(o.y + yy);
        if (!ok(px, py, 2)) continue;
        const along = xx * wind.x + yy * wind.y;
        const across = -xx * wind.y + yy * wind.x;
        if (along < o.radius * 0.4 || along > len + o.radius) continue;
        const t = (along - o.radius * 0.4) / len;
        if (t >= 1) continue;
        const half = o.radius * 0.85 * (1 - t) ** 0.8;
        if (Math.abs(across) > half) continue;
        const edge = Math.abs(across) > half - 1.2;
        put(px, py, edge ? (across * -wind.y + across * wind.x > 0 ? spec.sand.mid : spec.sand.light) : t < 0.5 ? spec.sand.hi : spec.sand.light);
      }
  }

  // Scree aprons at the foot of rock walls: fallen rubble and the walls' own deep shade.
  const def = field.track.def;
  const rockWall = new Uint8Array(def.walls.length);
  def.walls.forEach((wl, i) => (rockWall[i] = wl.kind === 'cliff' ? 1 : 0));
  if (rockWall.some((v) => v === 1)) {
    const dist = distanceTo(w, h, (p) => masks.solid[p] === 1 && rockWall[masks.owner[p]! - 1] === 1);
    for (let p = 0; p < w * h; p++) {
      const dd = dist[p]!;
      if (dd <= 0 || dd > 26) continue;
      const x = p % w;
      const y = (p / w) | 0;
      if (masks.kind[p] !== K_OFFROAD || !masks.reach[p]) continue;
      if (dd < 11) put(x, y, look.shade(get(x, y)));
      const hs = hash2(x >> 1, y >> 1, SEED + 51);
      if (hs < 0.22 * (1 - dd / 26)) {
        const tone = hash2(x, y, SEED + 52);
        put(x, y, tone < 0.4 ? rock.dark : tone < 0.8 ? rock.mid : rock.light);
      }
    }
  }

  // Old tire tracks wandering off the road and back: somebody always cuts across.
  const rnd = mulberry32((seed ^ 0x7ac3) >>> 0);
  const main = field.track.main;
  for (let k = 0; k < 9; k++) {
    const s0 = rnd() * main.length;
    const i0 = Math.floor((s0 / main.length) * main.count) % main.count;
    const side = rnd() < 0.5 ? -1 : 1;
    const tx = main.tx[i0]!;
    const ty = main.ty[i0]!;
    const nx = -ty * side;
    const ny = tx * side;
    let x = main.x[i0]! + nx * (main.halfWidth[i0]! + main.shoulder[i0]! + 4);
    let y = main.y[i0]! + ny * (main.halfWidth[i0]! + main.shoulder[i0]! + 4);
    let ang = Math.atan2(ty + ny * 0.9, tx + nx * 0.9);
    const steps = 160 + Math.floor(rnd() * 320);
    let bend = (rnd() - 0.5) * 0.02;
    for (let st = 0; st < steps; st++) {
      bend += (rnd() - 0.5) * 0.004;
      bend = Math.max(-0.02, Math.min(0.02, bend));
      ang += bend;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const px = -Math.sin(ang);
      const py = Math.cos(ang);
      if (rnd() < 0.04) continue;
      for (const off of [-11, 11]) {
        for (const o2 of [0, 1]) {
          const qx = Math.round(x + px * (off + o2));
          const qy = Math.round(y + py * (off + o2));
          if (!ok(qx, qy, 2)) continue;
          put(qx, qy, o2 === 0 ? look.shade(get(qx, qy)) : darker(get(qx, qy), 0.06));
        }
      }
    }
    stats.tracks++;
  }

  return stats;
}

/** A creosote or sage clump, or a dead brown one: a few overlapping lobes lit from the NW. */
function scrub(
  put: Put,
  shadow: (x: number, y: number) => void,
  x: number,
  y: number,
  size: number,
  dead: boolean,
  seed: number,
): void {
  const rnd = mulberry32(seed >>> 0);
  const lobes: Array<[number, number, number]> = [];
  const n = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * size * 0.6;
    lobes.push([x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, size * (0.45 + rnd() * 0.4)]);
  }
  const hi = dead ? PAL.brushHi : PAL.sageHi;
  const mid = dead ? PAL.brush : PAL.sage;
  const dark = dead ? PAL.brushDark : PAL.sageDark;
  const deep = dead ? darker(PAL.brushDark, 0.3) : PAL.sageDeep;
  const R = Math.ceil(size + 2);
  // Contact shadow first, two pixels to the south-east.
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      const px = x + xx;
      const py = y + yy;
      if (inLobes(lobes, px - 2 + 0.5, py - 2 + 0.5) && !inLobes(lobes, px + 0.5, py + 0.5)) shadow(px, py);
    }
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      const px = x + xx;
      const py = y + yy;
      const cx = px + 0.5;
      const cy = py + 0.5;
      if (!inLobes(lobes, cx, cy)) continue;
      // Light from the upper left: a lobe's NW edge is lit, its SE edge deep.
      const nw = inLobes(lobes, cx - 1.2, cy - 1.2);
      const se = inLobes(lobes, cx + 1.2, cy + 1.2);
      let c = mid;
      if (!nw) c = hi;
      else if (!se) c = deep;
      else if (hash2(px, py, 77) < 0.3) c = dark;
      put(px, py, c);
    }
  // A few twig tips poking out of dead brush.
  if (dead)
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2;
      put(Math.round(x + Math.cos(a) * (size + 1)), Math.round(y + Math.sin(a) * (size + 1) * 0.7), dark);
    }
}

function inLobes(lobes: ReadonlyArray<readonly [number, number, number]>, x: number, y: number): boolean {
  for (const [lx, ly, r] of lobes) if ((x - lx) ** 2 + ((y - ly) * 1.25) ** 2 <= r * r) return true;
  return false;
}

/** Dry grass: a handful of pale straw strokes leaning one way. */
function tuft(put: Put, x: number, y: number, seed: number): void {
  const rnd = mulberry32(seed >>> 0);
  const n = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const ox = Math.round((rnd() - 0.5) * 5);
    const len = 2 + Math.floor(rnd() * 3);
    const lean = rnd() < 0.5 ? 0 : 1;
    for (let j = 0; j < len; j++)
      put(x + ox + (j > 1 ? lean : 0), y - j, j === len - 1 ? PAL.brushHi : PAL.brush);
  }
}
