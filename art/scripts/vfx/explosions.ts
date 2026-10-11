import { hash2, smoothstep } from '@bolt/shared';
import type { RGBA } from '../lib/pixels.js';
import { hex } from '../lib/pixels.js';
import type { FxStrip, Lobe, Put } from './kit.js';
import {
  BRASS,
  CYAN,
  DUST,
  FIRE,
  FOAM,
  ICE,
  INK,
  PINK,
  ROAD,
  SOOT,
  STEEL,
  VIOLET,
  alpha,
  burstLobes,
  cloud,
  disc,
  fx,
  line,
  ring,
  star,
  tumble,
} from './kit.js';

/**
 * Blasts and what they throw (Section 13.3): flashes, fireballs, the mortar's column, the
 * mine's low thump, smoke blossoms, dust, debris, the marks they leave and the light they
 * cast. A blast on screen is several of these on different layers, put together by the
 * recipes in `apps/web/src/game/vfx/recipes.ts`; no strip here is an explosion by itself.
 */

const FIRE_BANDS = [0.78, 0.62, 0.46, 0.3, 0.15, 0.02, -0.16];

/**
 * An asymmetric fireball: lobes thrown out from a hot core, bright and nearly round for two
 * frames, then ragged and orange, then torn into cooling tongues. Each `seed` is a different
 * shape, so the same blast is never stamped twice in a row (Section 13.1).
 */
function fireball(
  id: string,
  size: number,
  frames: number,
  fps: number,
  seed: number,
  ramp: readonly RGBA[] = FIRE,
  lobeCount = 5,
): FxStrip {
  const c = size / 2;
  const R = size * 0.36;
  return fx(id, size, size, frames, { fps, layer: 'fire' }, (f, put, t) => {
    const grow = 1 - Math.pow(1 - Math.min(1, t * 3.4), 2);
    const die = Math.pow(Math.max(0, (t - 0.42) / 0.58), 1.15);
    const lobes: Lobe[] = burstLobes(
      c,
      c + size * 0.02,
      lobeCount,
      seed,
      R * (0.5 * grow + 0.28 * t),
      R * (0.3 + 0.36 * grow) * (1 - 0.62 * die),
      t * size * 0.04,
    );
    lobes.push({
      x: c + (hash2(seed, 1, 2) - 0.5) * R * 0.3,
      y: c + (hash2(seed, 2, 2) - 0.5) * R * 0.3,
      r: R * 0.74 * grow * (1 - smoothstep(0.28, 0.72, t)),
    });
    cloud(put, size, size, lobes, {
      seed,
      ramp,
      thresholds: FIRE_BANDS,
      heat: (f === 0 ? 0.5 : 0.3) - t * 0.9,
      noise: 0.17 + t * 0.12,
      grain: size > 40 ? 4.6 : 3.2,
      z: f * 0.4,
      erode: die * 0.85,
      cell: 2,
      rim: 0.14,
      rimColor: ramp[ramp.length - 2]!,
    });
  });
}

/** A gray-black blossom that swells, rises a little and breaks up. */
function smoke(id: string, size: number, frames: number, fps: number, seed: number): FxStrip {
  const c = size / 2;
  return fx(id, size, size, frames, { fps, layer: 'smoke' }, (f, put, t) => {
    const swell = 0.5 + Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.62) * 0.62;
    const lobes = burstLobes(
      c,
      c + size * 0.08,
      4,
      seed,
      size * (0.06 + t * 0.2),
      size * 0.25 * swell,
      t * size * 0.13,
    );
    cloud(put, size, size, lobes, {
      seed,
      ramp: [SOOT[0]!, SOOT[1]!, SOOT[2]!],
      thresholds: [0.52, 0.22],
      noise: 0.14,
      grain: 3.4,
      z: f * 0.3,
      erode: Math.max(0, (t - 0.5) / 0.5) * 0.92,
      rim: 0.22,
      rimColor: SOOT[3]!,
    });
    // The underside still glows for the first two frames.
    if (f < 2)
      for (let k = 0; k < 5; k++)
        put(
          c - size * 0.2 + hash2(k, seed, 31) * size * 0.4,
          c + size * 0.12 + hash2(k, seed, 32) * size * 0.12,
          FIRE[f === 0 ? 3 : 4]!,
        );
  });
}

function dust(id: string, size: number, frames: number, seed: number): FxStrip {
  const c = size / 2;
  return fx(id, size, size, frames, { fps: 12, layer: 'ground' }, (f, put, t) => {
    const swell = 0.55 + Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.7) * 0.6;
    const lobes = burstLobes(c, c, 4, seed, size * (0.05 + t * 0.22), size * 0.24 * swell);
    cloud(put, size, size, lobes, {
      seed,
      ramp: [DUST[0]!, DUST[1]!, DUST[2]!],
      thresholds: [0.5, 0.2],
      noise: 0.16,
      grain: 3,
      z: f * 0.3,
      erode: Math.max(0, (t - 0.35) / 0.65) * 0.95,
      rim: 0.2,
      rimColor: DUST[3]!,
    });
  });
}

/** Draws only the border of whatever `draw` fills, in one color. */
function outlined(w: number, h: number, put: Put, c: RGBA, draw: (inner: Put) => void): void {
  const mask = new Uint8Array(w * h);
  draw((x, y) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = 1;
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !mask[y * w + x - 1] ||
        !mask[y * w + x + 1] ||
        !mask[(y - 1) * w + x] ||
        !mask[(y + 1) * w + x];
      if (edge) put(x, y, c);
    }
  }
}

function flash(
  id: string,
  size: number,
  arms: number,
  seed: number,
  fallback?: string,
  colors: readonly RGBA[] = [FIRE[0]!, FIRE[0]!, FIRE[1]!, FIRE[2]!],
): FxStrip {
  const c = size / 2;
  const reach = size / 2 - 1;
  return fx(
    id,
    size,
    size,
    4,
    { fps: 30, layer: 'flash', blend: 'add', ...(fallback ? { fallback } : {}) },
    (f, put) => {
      if (f === 0) star(put, c, c, arms, reach * 0.6, reach * 0.26, colors, seed);
      else if (f === 1) star(put, c, c, arms, reach, reach * 0.3, colors, seed, 0.2);
      else if (f === 2)
        star(put, c, c, arms, reach * 0.95, reach * 0.12, colors.slice(1), seed, 0.2);
      else
        for (let k = 0; k < arms * 2; k++) {
          const a = (k / (arms * 2)) * Math.PI * 2 + hash2(k, seed, 8);
          const d = reach * (0.55 + hash2(k, seed, 9) * 0.4);
          put(c + Math.cos(a) * d, c + Math.sin(a) * d, colors[colors.length - 1]!);
        }
    },
  );
}

/** The no-flash stand-in (Section 13.3): the same spiked shape as a thin colored outline. */
function flashOutline(id: string, size: number, arms: number, seed: number): FxStrip {
  const c = size / 2;
  const reach = size / 2 - 1;
  return fx(id, size, size, 3, { fps: 20, layer: 'fire' }, (f, put) => {
    const color = [FIRE[2]!, FIRE[3]!, FIRE[4]!][f]!;
    outlined(size, size, put, color, (inner) =>
      star(inner, c, c, arms, reach * (0.6 + f * 0.2), reach * (0.34 - f * 0.08), [INK], seed, 0.2),
    );
  });
}

const SCORCH: RGBA[] = [
  [10, 9, 20, 168],
  [12, 11, 24, 112],
  [14, 13, 28, 60],
];

/** What a blast leaves on the road: soot in three fixed alpha steps, streaks, bare chips. */
function scorch(id: string, size: number, crater: boolean): FxStrip {
  const c = size / 2;
  return fx(id, size, size, 2, { fps: 1, layer: 'decal' }, (f, put) => {
    const seed = 900 + f * 17 + size;
    const lobes = burstLobes(c, c, 5, seed, size * 0.14, size * 0.3);
    lobes.push({ x: c, y: c, r: size * 0.3 });
    cloud(put, size, size, lobes, {
      seed,
      ramp: SCORCH,
      thresholds: [0.5, 0.24],
      noise: 0.22,
      grain: 3,
      erode: 0.12,
      cell: 1,
    });
    const rays = crater ? 14 : 8;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + hash2(k, seed, 3) * 0.5;
      const from = size * 0.2;
      const to = size * (0.3 + hash2(k, seed, 4) * 0.19);
      for (let d = from; d < to; d += 1) {
        if (hash2(Math.floor(d), k, seed) < 0.3) continue;
        put(c + Math.cos(a) * d, c + Math.sin(a) * d, SCORCH[d > to - 4 ? 2 : 1]!);
      }
    }
    // Chips of bare road where the surface broke.
    const chips = crater ? 16 : size > 30 ? 7 : 3;
    for (let k = 0; k < chips; k++) {
      const a = hash2(k, seed, 5) * Math.PI * 2;
      const d = size * (crater ? 0.1 + hash2(k, seed, 6) * 0.16 : hash2(k, seed, 6) * 0.2);
      put(c + Math.cos(a) * d, c + Math.sin(a) * d, ROAD[hash2(k, seed, 7) < 0.5 ? 1 : 2]!);
    }
    if (crater) {
      ring(put, c, c, size * 0.17, 1, alpha(ROAD[2]!, 255), 9, 0.6, hash2(seed, 1, 1));
      ring(put, c, c, size * 0.11, 1, [8, 7, 16, 200], 5, 0.7, hash2(seed, 2, 1));
    }
  });
}

/** Light thrown on the road: three hard steps with a checkered band between, drawn additively. */
function glowDisc(id: string, size: number): FxStrip {
  const c = size / 2;
  const steps = [0, 26, 50, 84];
  return fx(id, size, size, 1, { fps: 1, layer: 'glow', blend: 'add' }, (_f, put) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / (size / 2);
        if (d > 0.97) continue;
        const level = d < 0.34 ? 3 : d < 0.64 ? 2 : 1;
        const edge = Math.abs(d - 0.34) < 0.03 || Math.abs(d - 0.64) < 0.03 || d > 0.93;
        const lv = edge && (x + y) % 2 === 0 ? level - 1 : level;
        if (lv > 0) put(x, y, [255, 255, 255, steps[lv]!]);
      }
    }
  });
}

type Shape = (u: number, v: number) => RGBA | null;

/** A rigid fragment in eight stepped rotations (Section 13.2: metal shards tumble in steps). */
function fragment(
  id: string,
  size: number,
  shape: Shape,
  outline: RGBA | null = STEEL[5]!,
): FxStrip {
  return fx(id, size, size, 8, { fps: 14, loop: true, layer: 'body' }, (f, put) =>
    tumble(put, size, (f / 8) * Math.PI * 2, shape, outline ?? undefined),
  );
}

const box =
  (hw: number, hh: number, top: RGBA, body: RGBA): Shape =>
  (u, v) =>
    Math.abs(u) <= hw && Math.abs(v) <= hh ? (v < -hh + 1 ? top : body) : null;

const wedge =
  (len: number, wide: number, top: RGBA, body: RGBA): Shape =>
  (u, v) => {
    const k = (u + len) / (2 * len);
    if (k < 0 || k > 1) return null;
    return Math.abs(v) <= wide * (1 - k) + 0.4 ? (v < 0 ? top : body) : null;
  };

export function buildExplosionVfx(): FxStrip[] {
  const out: FxStrip[] = [];

  // --- Flashes: two frames of white and yellow star, a thin third, a ring of flecks --------
  out.push(flash('flash_s', 24, 6, 11));
  out.push(flash('flash_m', 56, 8, 12, 'outline_m'));
  out.push(flash('flash_l', 88, 10, 13, 'outline_l'));
  out.push(flashOutline('outline_m', 56, 8, 12));
  out.push(flashOutline('outline_l', 88, 10, 13));
  out.push(
    flash('flash_cyan', 28, 4, 14, undefined, [CYAN[0]!, CYAN[0]!, CYAN[1]!, CYAN[2]!, CYAN[3]!]),
  );
  out.push(
    flash('flash_violet', 24, 5, 15, undefined, [VIOLET[0]!, VIOLET[1]!, VIOLET[2]!, VIOLET[3]!]),
  );
  out.push(
    flash('flash_mint', 22, 4, 16, undefined, [hex('#ffffff'), hex('#a8f5cf'), hex('#67dea7')]),
  );

  // --- Fire --------------------------------------------------------------------------------
  out.push(fireball('fireball_a', 68, 12, 16, 101));
  out.push(fireball('fireball_b', 68, 12, 16, 207, FIRE, 6));
  out.push(fireball('fireball_s_a', 30, 8, 18, 311, FIRE, 4));
  out.push(fireball('fireball_s_b', 30, 8, 18, 419, FIRE, 4));
  // The seeker's bloom: tighter, four-lobed and pink-white, so it is not the rocket's burst.
  {
    const size = 46;
    const c = size / 2;
    out.push(
      fx('bloom', size, size, 10, { fps: 18, layer: 'fire' }, (f, put, t) => {
        const grow = 1 - Math.pow(1 - Math.min(1, 0.3 + t * 3.6), 2);
        const die = Math.max(0, (t - 0.4) / 0.6);
        const lobes: Lobe[] = [];
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4 + t * 0.5;
          const d = size * 0.2 * grow + size * 0.12 * t;
          lobes.push({
            x: c + Math.cos(a) * d,
            y: c + Math.sin(a) * d,
            r: size * 0.19 * grow * (1 - 0.7 * die),
          });
        }
        lobes.push({ x: c, y: c, r: size * 0.3 * grow * (1 - smoothstep(0.25, 0.7, t)) });
        cloud(put, size, size, lobes, {
          seed: 523,
          ramp: PINK,
          thresholds: [0.74, 0.56, 0.38, 0.2, 0.04],
          heat: 0.4 - t * 0.9,
          noise: 0.1 + t * 0.1,
          grain: 3.2,
          z: f * 0.4,
          erode: die * 0.9,
        });
        if (f >= 1 && f <= 4)
          ring(put, c, c, size * (0.2 + f * 0.065), 1, PINK[f < 3 ? 1 : 2]!, 12, 0.7, f * 0.03);
      }),
    );
  }

  // The mortar's core: a column of hot white pixels that climbs, caps over and tears apart.
  {
    const w = 76;
    const h = 112;
    const baseY = 100;
    out.push(
      fx('mortar_core', w, h, 14, { fps: 14, layer: 'fire', anchor: [38, 100] }, (f, put, t) => {
        const rise = 1 - Math.pow(1 - Math.min(1, t * 2.8), 2);
        const die = Math.pow(Math.max(0, (t - 0.42) / 0.58), 1.1);
        const height = 64 * rise + 8 * t;
        const lobes: Lobe[] = [];
        const count = 10;
        for (let k = 0; k < count; k++) {
          const along = k / (count - 1);
          const sway = (hash2(k, 7, 601) - 0.5) * 7 * (0.2 + t) * along;
          // A waisted trunk under a broad cap, standing on a wide foot.
          const profile = along > 0.78 ? 19 : along < 0.12 ? 15 : 12 + (hash2(k, 5, 602) - 0.5) * 3;
          lobes.push({
            x: w / 2 + sway,
            y: baseY - 6 - along * height - die * along * 9,
            r: profile * (0.45 + 0.55 * rise) * (1 - die * (0.45 + (1 - along) * 0.4)),
          });
        }
        // The ground burst at the foot of the column.
        lobes.push({ x: w / 2, y: baseY - 5, r: 26 * rise * (1 - smoothstep(0.18, 0.6, t)) });
        cloud(put, w, h, lobes, {
          seed: 607,
          ramp: FIRE,
          thresholds: FIRE_BANDS,
          heat: 0.44 - t * 1.0,
          noise: 0.17 + t * 0.12,
          grain: 4.2,
          z: f * 0.45,
          erode: die * 0.88,
          rim: 0.14,
          rimColor: FIRE[6]!,
        });
        // White needles in the heart of the column for the first third.
        if (t < 0.4)
          for (let k = 0; k < 6; k++) {
            const x = w / 2 - 4 + hash2(k, f, 611) * 8;
            const top = baseY - height * (0.3 + hash2(k, 3, 612) * 0.55);
            line(put, x, baseY - 10, x, top, FIRE[0]!);
          }
      }),
    );
  }

  // The mine's thump: a bright lens at axle height for two frames, then a low dome of dust.
  {
    const w = 68;
    const h = 40;
    out.push(
      fx('thump', w, h, 8, { fps: 16, layer: 'fire', anchor: [34, 24] }, (f, put, t) => {
        if (f < 2) {
          const rx = f === 0 ? 22 : 31;
          const ry = f === 0 ? 4.5 : 7;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const d = Math.hypot((x + 0.5 - 34) / rx, (y + 0.5 - 24) / ry);
              if (d > 1) continue;
              put(x, y, FIRE[d < 0.45 ? 0 : d < 0.72 ? 1 : f === 0 ? 2 : 3]!);
            }
          for (let k = 0; k < 9; k++) {
            const a = -Math.PI * (0.1 + hash2(k, f, 41) * 0.8);
            const d = 8 + hash2(k, f, 42) * 9;
            put(34 + Math.cos(a) * d * 1.6, 24 + Math.sin(a) * d, FIRE[1]!);
          }
          return;
        }
        const lobes: Lobe[] = [];
        for (let k = 0; k < 6; k++) {
          const along = (k / 5 - 0.5) * 2;
          lobes.push({
            x: 34 + along * (16 + t * 13),
            y: 24 - 2 - t * 5 - hash2(k, 5, 43) * 4,
            r: (9.5 - Math.abs(along) * 3) * (1 - Math.max(0, t - 0.5) * 0.9),
          });
        }
        cloud(put, w, h, lobes, {
          seed: 45,
          ramp: [FIRE[2]!, FIRE[3]!, DUST[0]!, DUST[1]!, DUST[2]!],
          thresholds: [0.66, 0.5, 0.34, 0.14],
          heat: 0.55 - t * 1.3,
          noise: 0.16,
          grain: 3.2,
          z: f * 0.4,
          erode: Math.max(0, (t - 0.45) / 0.55) * 0.92,
          rim: 0.18,
          rimColor: DUST[3]!,
        });
      }),
    );
  }

  // --- Smoke and dust ----------------------------------------------------------------------
  out.push(smoke('smoke_dark_a', 34, 10, 10, 701));
  out.push(smoke('smoke_dark_b', 34, 10, 10, 702));
  out.push(smoke('smoke_dark_c', 34, 10, 10, 703));
  out.push(smoke('smoke_dark_s', 18, 7, 12, 704));
  out.push(dust('dust_a', 26, 7, 801));
  out.push(dust('dust_b', 26, 7, 802));
  out.push(dust('dust_s', 14, 5, 803));

  // Tight gray smoke of a small kinetic impact: gone inside half a second.
  out.push(
    fx('chip_puff', 14, 14, 5, { fps: 14, layer: 'smoke' }, (f, put, t) => {
      const lobes = burstLobes(7, 7, 3, 811, 1 + t * 3.4, 3.4 * (0.7 + Math.sin(t * 2.4) * 0.5));
      cloud(put, 14, 14, lobes, {
        seed: 811,
        ramp: [STEEL[1]!, STEEL[2]!, STEEL[3]!],
        thresholds: [0.5, 0.2],
        noise: 0.14,
        grain: 2.4,
        z: f * 0.4,
        erode: Math.max(0, (t - 0.4) / 0.6) * 0.95,
      });
    }),
  );

  // A ring of smoke kicked out by a launch or a hatch.
  out.push(
    fx('launch_puff', 24, 24, 6, { fps: 16, layer: 'smoke' }, (f, put, t) => {
      const lobes: Lobe[] = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        const d = 2 + t * 8.5;
        lobes.push({
          x: 12 + Math.cos(a) * d,
          y: 12 + Math.sin(a) * d,
          r: 3.3 * (1 - t * 0.55) * (0.8 + hash2(k, 3, 821) * 0.4),
        });
      }
      if (t < 0.4) lobes.push({ x: 12, y: 12, r: 4.5 * (1 - t * 2.2) });
      cloud(put, 24, 24, lobes, {
        seed: 821,
        ramp: [STEEL[0]!, STEEL[1]!, STEEL[2]!],
        thresholds: [0.5, 0.2],
        noise: 0.12,
        grain: 2.6,
        z: f * 0.4,
        erode: Math.max(0, (t - 0.5) / 0.5) * 0.9,
      });
    }),
  );

  // White wisps: steam off a quenched fire, a thawed patch, a hot engine.
  out.push(
    fx('steam', 16, 20, 7, { fps: 11, layer: 'smoke', anchor: [8, 16] }, (f, put, t) => {
      const lobes: Lobe[] = [];
      for (let k = 0; k < 3; k++)
        lobes.push({
          x: 8 + Math.sin(t * 3 + k * 2.1) * 2.6,
          y: 16 - 2 - t * (7 + k * 3.2) - k * 1.6,
          r: (3.3 - k * 0.5) * (0.6 + Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.7) * 0.6),
        });
      cloud(put, 16, 20, lobes, {
        seed: 831,
        ramp: [hex('#ffffff'), hex('#dfe6f2'), hex('#b4bdd0')],
        thresholds: [0.5, 0.2],
        noise: 0.14,
        grain: 2.4,
        z: f * 0.4,
        erode: Math.max(0, (t - 0.3) / 0.7) * 0.95,
      });
    }),
  );

  // Tintable white puffs for whatever needs a pale cloud: air blasts, frost mist, tire spray.
  for (const [id, size, frames, seed] of [
    ['puff_a', 18, 7, 841],
    ['puff_b', 18, 7, 842],
    ['puff_s', 10, 5, 843],
  ] as const) {
    const c = size / 2;
    out.push(
      fx(id, size, size, frames, { fps: 14, layer: 'smoke' }, (f, put, t) => {
        const swell = 0.55 + Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.75) * 0.7;
        const lobes = burstLobes(c, c, 3, seed, size * (0.04 + t * 0.2), size * 0.26 * swell);
        cloud(put, size, size, lobes, {
          seed,
          ramp: [hex('#ffffff'), hex('#dfe4ee'), hex('#aeb6c8')],
          thresholds: [0.5, 0.2],
          noise: 0.12,
          grain: 2.8,
          z: f * 0.35,
          erode: Math.max(0, (t - 0.45) / 0.55) * 0.95,
        });
      }),
    );
  }

  // --- Marks and light -----------------------------------------------------------------------
  out.push(scorch('scorch_s', 22, false));
  out.push(scorch('scorch_m', 48, false));
  out.push(scorch('scorch_l', 92, true));
  out.push(glowDisc('glow_s', 48));
  out.push(glowDisc('glow_m', 96));
  out.push(glowDisc('glow_l', 168));

  // --- Debris --------------------------------------------------------------------------------
  out.push(fragment('shard_a', 10, wedge(3.4, 2.2, STEEL[1]!, STEEL[3]!)));
  out.push(fragment('shard_b', 10, box(3.2, 1.1, STEEL[1]!, STEEL[3]!)));
  out.push(
    fragment('shard_c', 10, (u, v) =>
      (Math.abs(u) <= 2.6 && v >= 0.4 && v <= 2) || (u >= 1 && u <= 2.6 && Math.abs(v) <= 2)
        ? v < 0.9
          ? STEEL[2]!
          : STEEL[4]!
        : null,
    ),
  );
  out.push(fragment('shard_d', 8, box(1.5, 1.5, STEEL[2]!, STEEL[4]!)));
  // Glowing fragments carry no outline: they are light, not objects.
  out.push(fragment('shard_hot_a', 8, wedge(2.8, 1.6, FIRE[1]!, FIRE[3]!), null));
  out.push(fragment('shard_hot_b', 8, box(2.2, 0.9, FIRE[2]!, FIRE[4]!), null));
  out.push(fragment('chunk_a', 10, box(2.4, 1.9, ROAD[0]!, ROAD[2]!), ROAD[3]!));
  out.push(fragment('chunk_b', 8, wedge(2.2, 1.9, ROAD[1]!, ROAD[2]!), ROAD[3]!));
  out.push(fragment('casing', 8, box(1.9, 0.8, BRASS[0]!, BRASS[1]!), BRASS[3]!));
  out.push(
    fragment('chip_round', 8, (u, v) => {
      const d = Math.hypot(u, v);
      return d <= 1.8 ? (u + v < -0.6 ? STEEL[0]! : STEEL[2]!) : null;
    }),
  );
  out.push(
    fragment('wheel_debris', 16, (u, v) => {
      if (Math.abs(u) > 5.2 || Math.abs(v) > 3.1) return null;
      if (Math.abs(u) > 4.2 && Math.abs(v) > 2.2) return null;
      if (Math.abs(u) < 1.6 && Math.abs(v) < 1.3) return STEEL[2]!;
      return Math.floor(u + 20) % 2 === 0 ? hex('#262b3e') : hex('#353b52');
    }),
  );
  out.push(
    fragment('plate_debris', 16, (u, v) => {
      if (Math.abs(u) > 5 || Math.abs(v) > 3.2) return null;
      if ((Math.abs(Math.abs(u) - 3.6) < 0.6 && Math.abs(Math.abs(v) - 1.9) < 0.6) || v < -2.2)
        return STEEL[0]!;
      return u > 3.8 || v > 2.2 ? STEEL[3]! : STEEL[2]!;
    }),
  );
  for (const [id, a0, a1] of [
    ['shield_frag_a', 0.2, 1.3],
    ['shield_frag_b', 2.2, 3.0],
    ['shield_frag_c', 4.0, 5.1],
  ] as const) {
    out.push(
      fx(id, 12, 12, 4, { fps: 12, layer: 'flash', blend: 'add' }, (f, put) => {
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 12; x++) {
            const dx = x + 0.5 - 6;
            const dy = y + 0.5 - 6;
            const d = Math.hypot(dx, dy);
            const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
            if (d < 3.4 || d > 5.4 || a < a0 || a > a1) continue;
            if (f > 0 && hash2(x, y, 51 + a0 * 10) < f * 0.3) continue;
            put(x, y, d > 4.6 ? CYAN[f < 2 ? 1 : 3]! : CYAN[f < 2 ? 2 : 4]!);
          }
      }),
    );
  }
  out.push(
    fragment(
      'ice_shard_a',
      10,
      (u, v) => (Math.abs(u) / 3.6 + Math.abs(v) / 1.5 <= 1 ? (v < 0 ? ICE[0]! : ICE[2]!) : null),
      ICE[4]!,
    ),
  );
  out.push(
    fragment(
      'ice_shard_b',
      8,
      (u, v) =>
        Math.abs(u) / 2.2 + Math.abs(v) / 1.9 <= 1 ? (u + v < 0 ? ICE[1]! : ICE[3]!) : null,
      ICE[4]!,
    ),
  );
  out.push(
    fx('foam_bit', 8, 8, 4, { fps: 1, layer: 'body' }, (f, put) => {
      const lobes = burstLobes(4, 4, 2 + (f % 2), 861 + f, 1.2, 1.9);
      cloud(put, 8, 8, lobes, {
        seed: 861 + f,
        ramp: [FOAM[0]!, FOAM[1]!, FOAM[3]!],
        thresholds: [0.45, 0.12],
      });
    }),
  );
  // Square circuit fragments for electric bursts (Section 13.2, energy glyphs).
  out.push(
    fx('circuit', 8, 8, 4, { fps: 1, layer: 'flash', blend: 'add' }, (f, put) => {
      const c = f % 2 === 0 ? CYAN[2]! : VIOLET[2]!;
      for (let i = 1; i < 6; i++) {
        if (f === 0) {
          for (const j of [1, 5]) {
            put(i, j, c);
            put(j, i, c);
          }
        } else if (f === 1) {
          put(i, 3, c);
          put(3, i, c);
        } else if (f === 2) {
          put(i, 5, c);
          put(1, i, c);
          put(5, 2, c);
        } else if (i >= 2 && i < 5) for (let j = 2; j < 5; j++) put(i, j, c);
      }
    }),
  );

  // --- Small bursts ----------------------------------------------------------------------------
  // A clean white pop with a ring: an interceptor's kill, a swept mine, a decoy going down.
  out.push(
    fx('pop', 26, 26, 6, { fps: 20, layer: 'fire' }, (f, put) => {
      if (f < 2)
        star(
          put,
          13,
          13,
          6,
          f === 0 ? 6 : 10,
          f === 0 ? 3 : 4.5,
          [FIRE[0]!, FIRE[1]!, FIRE[2]!],
          871,
        );
      if (f >= 1)
        ring(put, 13, 13, 4 + f * 1.7, 1, FIRE[Math.min(5, f)]!, 10, 0.75 - f * 0.06, f * 0.02);
      if (f >= 3)
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.3;
          put(13 + Math.cos(a) * (3 + f), 13 + Math.sin(a) * (3 + f), SOOT[1]!);
        }
    }),
  );

  // The hammer's clang: an oversized four-point spark with a hard ring.
  out.push(
    fx('clang', 48, 48, 6, { fps: 24, layer: 'flash', blend: 'add' }, (f, put) => {
      const colors = [FIRE[0]!, FIRE[0]!, FIRE[1]!, FIRE[2]!];
      if (f === 0) star(put, 24, 24, 4, 12, 4, colors, 881);
      else if (f === 1) star(put, 24, 24, 4, 23, 5, colors, 881);
      else if (f === 2) star(put, 24, 24, 4, 21, 2.5, colors.slice(1), 881, 0.5);
      if (f >= 1 && f <= 4)
        ring(put, 24, 24, 6 + f * 3.6, f < 3 ? 2 : 1, FIRE[f]!, 8, 0.8 - f * 0.1, 0.06);
      if (f >= 3)
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + 0.2;
          put(24 + Math.cos(a) * (14 + f * 1.6), 24 + Math.sin(a) * (14 + f * 1.6), FIRE[3]!);
        }
    }),
  );

  // The frost shell's shatter: straight crystal spokes, not a round burst.
  out.push(
    fx('ice_burst', 40, 40, 7, { fps: 18, layer: 'fire' }, (f, put, t) => {
      const spokes = 8;
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * Math.PI * 2 + 0.26;
        const reach = (7 + hash2(k, 4, 891) * 9) * Math.min(1, 0.45 + t * 1.6);
        const from = t < 0.35 ? 0 : reach * (t - 0.35) * 1.2;
        for (let d = from; d < reach; d += 0.7) {
          const w = d < reach * 0.4 ? 1 : 0;
          const c = d < reach * 0.35 ? ICE[0]! : d < reach * 0.7 ? ICE[1]! : ICE[2]!;
          for (let s = -w; s <= w; s++)
            put(
              20 + Math.cos(a) * d - Math.sin(a) * s * 0.8,
              20 + Math.sin(a) * d + Math.cos(a) * s * 0.8,
              c,
            );
        }
        if (t > 0.2) {
          const tip = reach + 1 + t * 3;
          put(20 + Math.cos(a) * tip, 20 + Math.sin(a) * tip, ICE[3]!);
        }
      }
      if (f < 3) disc(put, 20, 20, 3.5 - f, ICE[0]!);
      if (f >= 1 && f <= 3) {
        // A square pulse, turned on its corner: the facet that names it as ice.
        const r = 5 + f * 3.2;
        for (let i = -r; i <= r; i++) {
          const j = r - Math.abs(i);
          if (Math.floor(i + 40) % 3 === 0) continue;
          put(20 + i, 20 + j, ICE[2]!);
          put(20 + i, 20 - j, ICE[2]!);
        }
      }
    }),
  );

  // The foam glob landing: an elastic splat with strands.
  out.push(
    fx('foam_splat', 40, 40, 7, { fps: 16, layer: 'body' }, (f, put, t) => {
      const lobes: Lobe[] = [{ x: 20, y: 20, r: 6 + Math.sin(Math.min(1, t * 2) * Math.PI) * 4 }];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.5;
        // Strands shoot out, overshoot and snap back a little: the elastic part.
        const d =
          (8 + hash2(k, 2, 901) * 7) * Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.62) * 1.3;
        lobes.push({ x: 20 + Math.cos(a) * d, y: 20 + Math.sin(a) * d, r: 2.6 * (1 - t * 0.5) });
        if (t > 0.15 && t < 0.8)
          line(
            put,
            20 + Math.cos(a) * 4,
            20 + Math.sin(a) * 4,
            20 + Math.cos(a) * d,
            20 + Math.sin(a) * d,
            FOAM[2]!,
          );
      }
      cloud(put, 40, 40, lobes, {
        seed: 901,
        ramp: [FOAM[0]!, FOAM[1]!, FOAM[2]!],
        thresholds: [0.5, 0.2],
        noise: 0.1,
        grain: 2.6,
        z: f * 0.3,
        erode: Math.max(0, (t - 0.55) / 0.45) * 0.9,
        rim: 0.25,
        rimColor: FOAM[3]!,
      });
    }),
  );

  // A violet fork star for whatever the Tesla arc touches.
  out.push(
    fx('zap', 22, 22, 4, { fps: 22, layer: 'flash', blend: 'add' }, (f, put) => {
      for (let k = 0; k < 5; k++) {
        let x = 11;
        let y = 11;
        const a = (k / 5) * Math.PI * 2 + f * 0.9;
        const len = 5 + hash2(k, f, 911) * 5;
        for (let d = 0; d < len; d++) {
          const j = (hash2(k * 7 + d, f, 912) - 0.5) * 2.4;
          x += Math.cos(a) + -Math.sin(a) * j * 0.6;
          y += Math.sin(a) + Math.cos(a) * j * 0.6;
          put(x, y, d < 2 ? VIOLET[0]! : d < len - 2 ? VIOLET[2]! : VIOLET[3]!);
        }
      }
      if (f < 2) disc(put, 11, 11, 2.2 - f * 0.6, VIOLET[0]!);
    }),
  );

  return out;
}
