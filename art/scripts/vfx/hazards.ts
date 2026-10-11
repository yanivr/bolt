import { hash2 } from '@bolt/shared';
import { hex } from '../lib/pixels.js';
import type { FxStrip } from './kit.js';
import {
  FIRE,
  FOAM,
  ICE,
  INK,
  MINT,
  OIL,
  SHEEN,
  STEEL,
  burstLobes,
  cloud,
  disc,
  fx,
  loopNoise,
  ring,
} from './kit.js';

/**
 * What lies on the road (Section 13.4): mines, oil, foam, frost, fire and the decoy drone.
 * Area hazards are built at run time from several overlapping blobs laid along the hazard's
 * real shape, so a strip at any angle and a patch of any radius is covered without rotating or
 * stretching a sprite. A blob strip holds its growth first and then its idle loop.
 */

/** Frames a blob spends growing before its idle loop starts. The runtime uses the same number. */
export const BLOB_GROW_FRAMES = 3;

export function buildHazardVfx(): FxStrip[] {
  const out: FxStrip[] = [];

  // --- Road mine: a fat spiked disc. Frames: dark, amber blink (arming), dark, red blink (live) --
  out.push(
    fx('mine', 16, 16, 4, { fps: 1, layer: 'ground' }, (f, put) => {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.26;
        disc(put, 8 + Math.cos(a) * 5.4, 8 + Math.sin(a) * 5.4, 1.2, STEEL[3]!);
      }
      disc(put, 8, 8, 5.6, INK);
      disc(put, 8, 8, 4.7, hex('#2e3448'));
      disc(put, 7.4, 7.4, 3.6, hex('#565f78'));
      ring(put, 8, 8, 4.2, 1, hex('#d83f49'));
      disc(put, 8, 8, 2.1, INK);
      const lamp = f === 1 ? hex('#ffb454') : f === 3 ? hex('#ff5d5d') : hex('#4a2a3a');
      disc(put, 8, 8, 1.5, lamp);
      if (f === 1 || f === 3) {
        put(7, 7, hex('#ffffff'));
        for (const [dx, dy] of [
          [-3, 0],
          [3, 0],
          [0, -3],
          [0, 3],
        ] as const)
          put(8 + dx - 0.5, 8 + dy - 0.5, lamp);
      }
    }),
  );

  // --- Oil: glossy angular puddles, blue-black with a slow rainbow sheen -------------------------
  for (const [id, seed] of [
    ['oil_a', 11],
    ['oil_b', 12],
    ['oil_c', 13],
  ] as const) {
    out.push(
      fx(id, 30, 30, BLOB_GROW_FRAMES + 3, { fps: 4, loop: true, layer: 'ground' }, (f, put) => {
        const grow = f < BLOB_GROW_FRAMES ? (f + 1) / (BLOB_GROW_FRAMES + 1) : 1;
        const phase = f < BLOB_GROW_FRAMES ? 0 : f - BLOB_GROW_FRAMES;
        const lobes = burstLobes(15, 15, 5, seed, 6 * grow, 7.4 * grow);
        lobes.push({ x: 15, y: 15, r: 8.5 * grow });
        cloud(put, 30, 30, lobes, {
          seed,
          ramp: [OIL[2]!, OIL[3]!, hex('#070812')],
          thresholds: [0.5, 0.14],
          // A coarse grain and a hard threshold give the angular edge of a liquid on tarmac.
          noise: 0.2,
          grain: 5,
        });
        // Gloss is what tells oil from shadow on a dark road: a pale rim where the puddle
        // catches the light, a broken highlight across it, and sheen pixels that drift.
        const field = (x: number, y: number) =>
          lobes.reduce(
            (m, l) => Math.max(m, 1 - Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) / l.r),
            -9,
          );
        for (let y = 0; y < 30; y++)
          for (let x = 0; x < 30; x++) {
            const fld = field(x, y);
            if (fld < 0.06) continue;
            // The rim is lit on the side that faces the upper-left key light.
            if (fld < 0.3 && field(x - 2, y - 2) < fld - 0.12 && hash2(x, y, seed + 9) > 0.25)
              put(x, y, hex(fld < 0.18 ? '#7f8fd0' : '#4a5890'));
            if (grow < 1 || fld < 0.3) continue;
            const diag = x + y;
            if (diag >= 21 && diag <= 22 && x > 6 && x < 16 && hash2(x, y, seed) > 0.25)
              put(x, y, hex(x % 5 === 0 ? '#dfe8ff' : '#6676b8'));
            const s = hash2(x >> 1, y >> 1, seed + 5);
            if (s > 0.86 && (x + y + phase * 2) % 6 < 2 && fld > 0.4)
              put(x, y, SHEEN[(Math.floor(s * 40) + phase) % SHEEN.length]!);
          }
      }),
    );
  }

  // --- Sticky foam: pale bubbly clumps with a violet-gray underside ------------------------------
  for (const [id, seed] of [
    ['foam_a', 21],
    ['foam_b', 22],
  ] as const) {
    out.push(
      fx(id, 28, 28, BLOB_GROW_FRAMES + 2, { fps: 3, loop: true, layer: 'ground' }, (f, put) => {
        const grow = f < BLOB_GROW_FRAMES ? (f + 1.2) / (BLOB_GROW_FRAMES + 1.2) : 1;
        const idle = f < BLOB_GROW_FRAMES ? 0 : f - BLOB_GROW_FRAMES;
        const lobes = burstLobes(14, 14, 6, seed, 6.4 * grow, 5.2 * grow);
        lobes.push({ x: 14, y: 14, r: 7 * grow });
        cloud(put, 28, 28, lobes, {
          seed,
          ramp: [FOAM[0]!, FOAM[1]!, FOAM[2]!],
          thresholds: [0.55, 0.22],
          rim: 0.26,
          rimColor: FOAM[3]!,
        });
        // Bubbles: dark pinholes with a bright cap, which swap places between the idle frames.
        for (let k = 0; k < 9; k++) {
          const a = hash2(k, seed, 7) * Math.PI * 2;
          const d = hash2(k, seed, 8) * 7 * grow;
          const x = 14 + Math.cos(a) * d + (idle && k % 2 ? 1 : 0);
          const y = 14 + Math.sin(a) * d;
          put(x, y, FOAM[4]!);
          put(x - 1, y - 1, FOAM[0]!);
        }
      }),
    );
  }
  // A clump stuck to a car.
  out.push(
    fx('foam_clump', 10, 10, 3, { fps: 1 }, (f, put) => {
      const lobes = burstLobes(5, 5, 3, 31 + f, 1.6, 2.6);
      cloud(put, 10, 10, lobes, {
        seed: 31 + f,
        ramp: [FOAM[0]!, FOAM[1]!, FOAM[2]!],
        thresholds: [0.5, 0.2],
        rim: 0.3,
        rimColor: FOAM[4]!,
      });
    }),
  );

  // --- Frost: pale angular plates with hard glints -----------------------------------------------
  for (const [id, seed] of [
    ['frost_a', 41],
    ['frost_b', 42],
  ] as const) {
    out.push(
      fx(id, 28, 28, BLOB_GROW_FRAMES + 2, { fps: 3, loop: true, layer: 'ground' }, (f, put) => {
        const grow = f < BLOB_GROW_FRAMES ? (f + 1) / (BLOB_GROW_FRAMES + 1) : 1;
        const idle = f < BLOB_GROW_FRAMES ? 0 : f - BLOB_GROW_FRAMES;
        for (let y = 0; y < 28; y++)
          for (let x = 0; x < 28; x++) {
            const dx = x + 0.5 - 14;
            const dy = y + 0.5 - 14;
            // A crystal's outline: the distance is a mix of round and diamond, cut by facets.
            const a = Math.atan2(dy, dx);
            const facet = 0.78 + 0.22 * Math.cos(a * 6 + hash2(seed, 1, 1) * 6);
            const d =
              (Math.hypot(dx, dy) * 0.6 + (Math.abs(dx) + Math.abs(dy)) * 0.36) /
              (11 * grow * facet);
            if (d > 1) continue;
            // See-through plate: a checkered wash that leaves the road showing between.
            const cell = hash2(x >> 1, y >> 1, seed + 3);
            if (d > 0.82) {
              if ((x + y) % 2 === 0 || cell > 0.5) put(x, y, ICE[2]!);
            } else if (cell > 0.72) put(x, y, ICE[1]!);
            else if ((x + y) % 2 === 0) put(x, y, d < 0.4 ? ICE[2]! : ICE[3]!);
          }
        if (grow < 1) return;
        for (let k = 0; k < 5; k++) {
          const a = hash2(k, seed, 5) * Math.PI * 2;
          const d = hash2(k, seed, 6) * 7;
          const x = Math.floor(14 + Math.cos(a) * d);
          const y = Math.floor(14 + Math.sin(a) * d);
          if ((k + idle) % 2 === 0) {
            put(x, y, ICE[0]!);
            put(x - 1, y, ICE[1]!);
            put(x + 1, y, ICE[1]!);
            put(x, y - 1, ICE[1]!);
            put(x, y + 1, ICE[1]!);
          } else put(x, y, ICE[0]!);
        }
      }),
    );
  }

  // --- Fire on the road: tongues that loop, on a dark core so they read against bright ground -----
  for (const [id, seed] of [
    ['fire_a', 51],
    ['fire_b', 52],
  ] as const) {
    const frames = 8;
    out.push(
      fx(id, 22, 30, frames, { fps: 12, loop: true, layer: 'fire', anchor: [11, 25] }, (f, put) => {
        for (let y = 0; y < 30; y++)
          for (let x = 0; x < 22; x++) {
            const dx = x + 0.5 - 11;
            const up = 26 - (y + 0.5);
            if (up < -3) continue;
            // The tongue narrows with height and leans with a noise that scrolls upward and loops.
            const sway = (loopNoise(x / 5 + 3, (y + (f * 16) / frames) / 4, 4, seed) - 0.5) * 2;
            const lean =
              (loopNoise(1.5, (y + (f * 32) / frames) / 8, 4, seed + 1) - 0.5) * 5 * (up / 24);
            const half = 8.4 * Math.pow(Math.max(0, 1 - up / 25), 0.75);
            const v =
              1 - Math.abs(dx - lean) / Math.max(0.01, half) + sway * 0.55 * (0.3 + up / 24);
            if (up < 0) {
              // Embers and char at the foot.
              if (Math.abs(dx) < 8 + up && hash2(x, y, seed + f) > 0.55)
                put(x, y, FIRE[up < -1.5 ? 6 : 5]!);
              continue;
            }
            if (v <= 0) continue;
            const heat = v * 0.8 + (1 - up / 25) * 0.42;
            put(
              x,
              y,
              FIRE[heat > 1.02 ? 1 : heat > 0.82 ? 2 : heat > 0.6 ? 3 : heat > 0.4 ? 4 : 5]!,
            );
          }
      }),
    );
  }
  // A small flame for a burning panel or a failing engine.
  {
    const frames = 6;
    out.push(
      fx(
        'flame_lick',
        12,
        18,
        frames,
        { fps: 12, loop: true, layer: 'fire', anchor: [6, 15] },
        (f, put) => {
          for (let y = 0; y < 18; y++)
            for (let x = 0; x < 12; x++) {
              const dx = x + 0.5 - 6;
              const up = 16 - (y + 0.5);
              if (up < 0) continue;
              const sway = (loopNoise(x / 3.5 + 2, (y + (f * 12) / frames) / 3, 4, 61) - 0.5) * 2;
              const lean =
                (loopNoise(0.5, (y + (f * 24) / frames) / 6, 4, 62) - 0.5) * 4 * (up / 15);
              const half = 4.4 * Math.pow(Math.max(0, 1 - up / 15), 0.8);
              const v =
                1 - Math.abs(dx - lean) / Math.max(0.01, half) + sway * 0.5 * (0.3 + up / 15);
              if (v <= 0) continue;
              const heat = v * 0.8 + (1 - up / 15) * 0.45;
              put(x, y, FIRE[heat > 1.0 ? 1 : heat > 0.76 ? 2 : heat > 0.5 ? 3 : 4]!);
            }
        },
      ),
    );
  }

  // --- Decoy drone: four rotors over a mint beacon, hovering -------------------------------------
  out.push(
    fx('decoy', 22, 22, 4, { fps: 16, loop: true }, (f, put) => {
      for (let i = -6; i <= 6; i++) {
        put(11 + i - 0.5, 11 + i - 0.5, STEEL[3]!);
        put(11 + i - 0.5, 11 - i - 0.5, STEEL[3]!);
      }
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const cx = 11 + sx * 6;
        const cy = 11 + sy * 6;
        // A rotor is a pale disc with a blade that steps round it.
        disc(put, cx, cy, 3.4, INK);
        disc(put, cx, cy, 2.6, STEEL[3]!);
        const a = ((f + (sx * sy > 0 ? 0 : 2)) / 4) * Math.PI;
        for (let d = -2.4; d <= 2.4; d += 0.6)
          put(cx + Math.cos(a) * d, cy + Math.sin(a) * d, STEEL[0]!);
      }
      disc(put, 11, 11, 4.4, INK);
      disc(put, 11, 11, 3.5, STEEL[2]!);
      disc(put, 10.4, 10.4, 2.4, STEEL[1]!);
      disc(put, 11, 11, 1.6, f % 2 === 0 ? MINT[1]! : MINT[2]!);
      if (f % 2 === 0) put(10, 10, hex('#ffffff'));
    }),
  );

  return out;
}
