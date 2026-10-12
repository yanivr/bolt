import { hash2, hashString, mulberry32 } from '@bolt/shared';
import type { Canvas, Color } from '../canvas.js';
import type { CorridorField } from '../field.js';
import { FAR } from '../field.js';
import { K_OFFROAD, distanceTo } from './masks.js';
import type { Masks } from './masks.js';
import type { RegionGrid, SlopeGrid } from './ground.js';
import { slopeAt } from './ground.js';
import { vnoise } from './noise.js';
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

export type DecorStats = {
  scrub: number;
  tufts: number;
  pebbles: number;
  tracks: number;
  gullies: number;
  washes: number;
};

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
  const stats: DecorStats = { scrub: 0, tufts: 0, pebbles: 0, tracks: 0, gullies: 0, washes: 0 };
  const rock = spec.rock;

  // Dry washes first: they are landforms, and the brush grows along their banks.
  const bed = paintWashes(
    world,
    field,
    masks,
    spec,
    look,
    slopes,
    hashString(field.track.def.id),
    stats,
  );

  // Scrub: creosote and sage in loose stands (a clump and a few smaller ones round it), and
  // dry grass. The stands are what gives open sand a rhythm at race speed; a lone two-pixel
  // dot every so often reads as noise.
  const G = 22;
  for (let cy = 0; cy < h; cy += G)
    for (let cx = 0; cx < w; cx += G) {
      const hx = hash2(cx, cy, SEED + seed);
      const x = Math.round(cx + hash2(cx, cy, SEED + 1) * G);
      const y = Math.round(cy + hash2(cx, cy, SEED + 2) * G);
      if (!ok(x, y, 6) || bed[y * w + x]) continue;
      regions.sample(x, y, reg);
      const want = Math.min(1, reg.brush * (1 - reg.playa * 0.9) + bank(bed, w, h, x, y) * 0.5);
      if (hx < want * 0.46) {
        const size = 2.4 + hash2(cx, cy, SEED + 3) * 3.6;
        const dead = hash2(cx, cy, SEED + 4) < 0.22;
        scrub(put, shadow, x, y, size, dead, hash2(cx, cy, SEED + 5) * 1e6);
        stats.scrub++;
        // A stand: up to four smaller clumps round the first, more where the brush is thick.
        const rnd = mulberry32(((cx * 31337) ^ (cy * 7331) ^ seed) >>> 0);
        const extra = Math.floor(rnd() * (1 + want * 4));
        for (let k = 0; k < extra; k++) {
          const a = rnd() * Math.PI * 2;
          const d = size + 3 + rnd() * 9;
          const sx = Math.round(x + Math.cos(a) * d);
          const sy = Math.round(y + Math.sin(a) * d * 0.75);
          if (!ok(sx, sy, 6) || bed[sy * w + sx]) continue;
          scrub(put, shadow, sx, sy, 1.6 + rnd() * size * 0.6, dead && rnd() < 0.6, rnd() * 1e6);
          stats.scrub++;
        }
      } else if (hx < want * 0.46 + 0.12 * (1 - reg.playa)) {
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
      if (hash2(cx, cy, SEED + 13) > reg.rubble * 0.7 + 0.04) continue;
      const rnd = mulberry32(((cx * 7919) ^ (cy * 104729) ^ seed) >>> 0);
      const n = 2 + Math.floor(rnd() * (2 + reg.rubble * 8));
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
        if (k % 2 === 0 && ok(px - 1, py - 1, 8))
          put(px - 1, py - 1, lighter(get(px - 1, py - 1), 0.12));
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
        put(
          px,
          py,
          edge
            ? across * -wind.y + across * wind.x > 0
              ? spec.sand.mid
              : spec.sand.light
            : t < 0.5
              ? spec.sand.hi
              : spec.sand.light,
        );
      }
  }

  // Scree aprons at the foot of rock walls: fallen rubble and the walls' own deep shade.
  const def = field.track.def;
  const rockWall = new Uint8Array(def.walls.length);
  def.walls.forEach((wl, i) => (rockWall[i] = wl.kind === 'cliff' ? 1 : 0));
  if (rockWall.some((v) => v === 1)) {
    const dist = distanceTo(
      w,
      h,
      (p) => masks.solid[p] === 1 && rockWall[masks.owner[p]! - 1] === 1,
    );
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
      if (inLobes(lobes, px - 2 + 0.5, py - 2 + 0.5) && !inLobes(lobes, px + 0.5, py + 0.5))
        shadow(px, py);
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
      put(
        Math.round(x + Math.cos(a) * (size + 1)),
        Math.round(y + Math.sin(a) * (size + 1) * 0.7),
        dark,
      );
    }
}

function inLobes(
  lobes: ReadonlyArray<readonly [number, number, number]>,
  x: number,
  y: number,
): boolean {
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

/** How close a point is to a wash's bank, 0 to 1 (1 on the bank). */
function bank(bed: Uint8Array, w: number, h: number, x: number, y: number): number {
  let best = 0;
  for (const [dx, dy, v] of [
    [10, 0, 1],
    [-10, 0, 1],
    [0, 8, 1],
    [0, -8, 1],
    [20, 0, 0.5],
    [-20, 0, 0.5],
    [0, 16, 0.5],
    [0, -16, 0.5],
  ] as const) {
    const px = x + dx;
    const py = y + dy;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    if (bed[py * w + px]) best = Math.max(best, v);
  }
  return best;
}

/**
 * Dry washes across the open sand: shallow sandy channels that wander down the fall of the
 * land, a pale silt bed with braided flow lines and cobbles, a lit bank on the south-east side
 * (it faces the north-west sun) and a shaded one opposite. They are flat ground, drivable like
 * the rest (Section 12.10's "sunlit rock debris" lies along them), and they stop short of the
 * road's verge. What they add is structure: long readable lines that break the plain into
 * places. Laid out from the track's own seed, so both weathers of a track share them.
 * Returns the bed mask (1 inside a channel), for the brush to grow along.
 */
function paintWashes(
  world: Canvas,
  field: CorridorField,
  masks: Masks,
  spec: TerrainSpec,
  look: Look,
  slopes: SlopeGrid,
  seed: number,
  stats: DecorStats,
): Uint8Array {
  const { w, h } = masks;
  const data = world.data;
  // Distance from the nearest channel centre over its half width, in hundredths (255: none).
  const q = new Uint8Array(w * h).fill(255);
  const rnd = mulberry32((seed ^ 0x51a7e) >>> 0);
  const area = w * h;
  const count = Math.round(area / 1.6e6);
  const free = (x: number, y: number, margin: number): boolean => {
    if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4) return false;
    const p = (y | 0) * w + (x | 0);
    if (masks.kind[p] !== K_OFFROAD || masks.solid[p]) return false;
    const e = field.edge[p]!;
    return e >= FAR || e > margin;
  };
  for (let k = 0, tries = 0; k < count && tries < count * 20; tries++) {
    let x = 60 + rnd() * (w - 120);
    let y = 60 + rnd() * (h - 120);
    if (!free(x, y, 160)) continue;
    k++;
    const g0 = slopeAt(slopes, x, y);
    let ang = Math.hypot(g0.x, g0.y) > 0.01 ? Math.atan2(-g0.y, -g0.x) : rnd() * Math.PI * 2;
    const len = 700 + rnd() * 1100;
    const width = 13 + rnd() * 12;
    let turn = 0;
    let drawn = 0;
    for (let t = 0; t < len; t += 1.5) {
      // Meander: a slowly wandering turn, pulled gently downhill.
      turn += (rnd() - 0.5) * 0.012;
      turn = Math.max(-0.018, Math.min(0.018, turn)) * 0.995;
      const g = slopeAt(slopes, x, y);
      const m = Math.hypot(g.x, g.y);
      if (m > 0.02) {
        const down = Math.atan2(-g.y, -g.x);
        let d = down - ang;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        ang += d * 0.004;
      }
      ang += turn;
      x += Math.cos(ang) * 1.5;
      y += Math.sin(ang) * 1.5;
      if (x < 8 || y < 8 || x >= w - 8 || y >= h - 8) break;
      // Narrow at its head, widest in the middle of its run.
      const u = t / len;
      const hw =
        width *
        (0.35 + 0.65 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5)) *
        (0.8 + 0.4 * vnoise(t, k * 97, 90, seed + 3));
      const R = Math.ceil(hw * 1.3) + 1;
      for (let yy = -R; yy <= R; yy++)
        for (let xx = -R; xx <= R; xx++) {
          const px = Math.round(x) + xx;
          const py = Math.round(y) + yy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / hw;
          if (d > 1.3) continue;
          const v = Math.round(d * 100);
          const p = py * w + px;
          if (v < q[p]!) q[p] = v;
        }
      drawn++;
    }
    if (drawn > 100) stats.washes++;
  }
  const bed = new Uint8Array(w * h);
  const L = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  const sand = spec.sand;
  const rock = spec.rock;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 255 : q[y * w + x]!;
  const put = (p: number, c: Color): void => {
    const o = p * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const v = q[p]!;
      if (v > 118) continue;
      if (!free(x, y, 7)) continue;
      // Banks fade out toward the road, so a wash never draws a ledge at the verge.
      const e = field.edge[p]! >= FAR ? 600 : field.edge[p]!;
      const fade = e < 24 ? (e - 7) / 17 : 1;
      if (hash2(x, y, seed + 9) > fade) continue;
      if (v < 74) {
        bed[p] = 1;
        // The bed: coarse sand a step below the plain, braided flow lines, gravel and
        // cobbles, more of them toward the banks. Never smooth and pale, so a wash can never
        // be mistaken for the graded road.
        const flow = vnoise(x * 0.5, y * 0.5, 6, seed + 11);
        let c = flow > 0.74 ? sand.dark : flow < 0.2 ? sand.base : sand.mid;
        const gravel = hash2(x >> 1, y >> 1, seed + 13);
        if (gravel < 0.05 + (v / 74) * 0.2) {
          const tone = hash2(x, y, seed + 14);
          c = tone < 0.35 ? rock.mid : tone < 0.7 ? rock.base : tone < 0.9 ? rock.light : rock.dark;
        } else if (hash2(x, y, seed + 15) < 0.04) c = sand.light;
        put(p, c);
      } else {
        // The banks, lit from the upper left: the slope's fall line against the light.
        const gx = at(x + 1, y) - at(x - 1, y);
        const gy = at(x, y + 1) - at(x, y - 1);
        // Distance grows away from the channel, so the bank falls toward -grad.
        const lit = -(gx * L.x + gy * L.y);
        if (v < 100) put(p, lit > 0 ? sand.light : look.shade(sand.base));
        else if (v < 108) put(p, lit > 0 ? sand.hi : look.shade(sand.light));
        else if (lit < 0 && v < 114) put(p, sand.mid);
      }
    }
  return bed;
}
