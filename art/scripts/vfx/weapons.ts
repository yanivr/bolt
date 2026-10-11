import { hash2 } from '@bolt/shared';
import type { RGBA } from '../lib/pixels.js';
import { hex } from '../lib/pixels.js';
import type { FxStrip, Lobe } from './kit.js';
import {
  CYAN,
  FIRE,
  FOAM,
  ICE,
  INK,
  SOOT,
  STEEL,
  cloud,
  directional,
  fx,
  glow,
  loopNoise,
} from './kit.js';

/**
 * What leaves a weapon (Section 13.4): muzzle flashes and the things in flight. Every sprite
 * with a direction is drawn per heading from a shape in its own space, `u` forward and `v`
 * to the right, so a tracer at 22 degrees is as crisp as one at 0.
 */

const OUTLINE = STEEL[5]!;

/** A tapered streak: the body of every tracer. */
function streak(
  u: number,
  v: number,
  tail: number,
  head: number,
  half: number,
  colors: readonly RGBA[],
): RGBA | null {
  if (u < -tail || u > head) return null;
  const k = (u + tail) / (tail + head);
  // One pixel wide at the tail, `half` at the head.
  if (Math.abs(v) > 0.5 + (half - 0.5) * k) return null;
  return glow(colors[Math.min(colors.length - 1, Math.floor((1 - k) * colors.length))]!);
}

export function buildWeaponVfx(): FxStrip[] {
  const out: FxStrip[] = [];

  // --- Muzzle flashes --------------------------------------------------------------------------
  // Machine gun: a short orange spike with two side sparks. Small, because five come in 0.4 s.
  out.push(
    directional('muzzle_mg', 14, 16, 2, { fps: 30, layer: 'flash', blend: 'add' }, (u, v, ctx) => {
      const len = ctx.frame === 0 ? 6.5 : 4;
      if (u >= -0.5 && u <= len && Math.abs(v) <= 1.5 * (1 - u / len) + 0.5)
        return u < 1.6 && ctx.frame === 0 ? FIRE[0]! : u < len * 0.55 ? FIRE[1]! : FIRE[3]!;
      if (ctx.frame === 0 && u > 0.4 && u < 3.6 && Math.abs(Math.abs(v) - u) < 0.6) return FIRE[2]!;
      return null;
    }),
  );
  // Sentry: a stubby amber puff with a collar, so the rear gun reads differently from the front.
  out.push(
    directional(
      'muzzle_sentry',
      12,
      16,
      2,
      { fps: 30, layer: 'flash', blend: 'add' },
      (u, v, ctx) => {
        if (ctx.frame === 0) {
          if (Math.hypot(u - 1.6, v) <= 2.1) return u < 1.4 ? FIRE[0]! : hex('#ffd98a');
          if (u > 0.2 && u < 1.4 && Math.abs(v) <= 3.6) return hex('#ffb454');
          return null;
        }
        return Math.hypot(u - 2.2, v) <= 1.5 ? hex('#ffb454') : null;
      },
    ),
  );
  // Turret: a round red-orange ball with a long hard spike.
  out.push(
    directional(
      'muzzle_turret',
      20,
      16,
      3,
      { fps: 30, layer: 'flash', blend: 'add' },
      (u, v, ctx) => {
        const f = ctx.frame;
        const ball = [3.4, 2.8, 1.6][f]!;
        const len = [8.5, 6, 0][f]!;
        if (Math.hypot(u - 1.5, v) <= ball)
          return Math.hypot(u - 1.5, v) < ball * 0.5 && f === 0
            ? FIRE[0]!
            : f === 2
              ? FIRE[4]!
              : FIRE[2]!;
        if (len > 0 && u > 0 && u <= len && Math.abs(v) <= 0.6 + (1 - u / len) * 0.9)
          return u < len * 0.5 ? FIRE[1]! : hex('#f46b58');
        return null;
      },
    ),
  );
  // Shotgun: the huge two-frame flash. A wide fan of flame fingers, then the sparks it leaves.
  out.push(
    directional(
      'muzzle_shotgun',
      52,
      16,
      3,
      { fps: 22, layer: 'flash', blend: 'add' },
      (u, v, ctx) => {
        const f = ctx.frame;
        if (u < -1.5) return null;
        const d = Math.hypot(u, v);
        if (d < 2.6 && f < 2) return FIRE[0]!;
        const a = Math.atan2(v, u);
        const half = 0.66;
        if (Math.abs(a) > half) return null;
        // Seven fingers of uneven length: the middle ones reach furthest.
        const fingers = 7;
        const slot = ((a + half) / (2 * half)) * fingers;
        const index = Math.min(fingers - 1, Math.floor(slot));
        const off = Math.abs(slot - index - 0.5) * 2;
        const centre = 1 - Math.abs(index - (fingers - 1) / 2) / fingers;
        const reach = [15, 24, 25][f]! * (0.55 + centre * 0.5) * (0.82 + hash2(index, 3, 21) * 0.3);
        if (f === 2) {
          // The fan is gone; a few hot flecks hang where its tips were.
          return d > reach * 0.7 && d < reach && off < 0.3 && hash2(Math.floor(d), index, 23) > 0.4
            ? FIRE[3]!
            : null;
        }
        if (d > reach) return null;
        // Each finger tapers to a point; the gaps between fingers open with distance.
        if (off > 1.15 - (d / reach) * 0.95) return null;
        const k = d / reach;
        return k < 0.34 ? FIRE[0]! : k < 0.62 ? FIRE[1]! : k < 0.84 ? FIRE[2]! : FIRE[3]!;
      },
    ),
  );
  // Back-blast of a rocket or missile leaving its tube: fire to the rear, in three beats.
  out.push(
    directional('backblast', 28, 16, 3, { fps: 20, layer: 'fire' }, (u, v, ctx) => {
      const f = ctx.frame;
      if (u > 1) return null;
      const d = Math.hypot(u, v);
      const a = Math.atan2(v, -u);
      if (Math.abs(a) > 0.5 + f * 0.08) return null;
      const reach = [7, 11, 12][f]! * (0.8 + loopNoise((a + 1) * 4, 0.5, 8, 31 + f) * 0.4);
      if (d > reach) return null;
      if (f === 2) return hash2(Math.floor(u), Math.floor(v), 33) > 0.45 ? glow(SOOT[0]!) : null;
      return glow(d < reach * 0.35 ? FIRE[1]! : d < reach * 0.7 ? FIRE[3]! : FIRE[4]!);
    }),
  );
  // Air cannon: an opening bell of pale pixels.
  out.push(
    directional('muzzle_air', 28, 16, 3, { fps: 20, layer: 'flash', blend: 'add' }, (u, v, ctx) => {
      const f = ctx.frame;
      const d = Math.hypot(u, v);
      if (u < 0 || Math.abs(Math.atan2(v, u)) > 0.7) return null;
      const r = [5, 9, 12][f]!;
      if (Math.abs(d - r) > 1.1) return null;
      return hash2(Math.floor(v * 1.3 + 30), f, 35) > 0.25
        ? hex(f === 2 ? '#aeb6c8' : '#f2f4fa')
        : null;
    }),
  );

  // --- Tracers ---------------------------------------------------------------------------------
  out.push(
    directional('tracer_mg', 20, 16, 1, { layer: 'flash', blend: 'add' }, (u, v) =>
      streak(u, v, 8, 2.5, 1, [FIRE[0]!, FIRE[1]!, FIRE[2]!, FIRE[3]!, FIRE[4]!]),
    ),
  );
  out.push(
    directional('tracer_sentry', 10, 16, 1, { layer: 'flash', blend: 'add' }, (u, v) =>
      streak(u, v, 3, 1.5, 1, [FIRE[1]!, hex('#ffb454'), hex('#e08a2c')]),
    ),
  );
  // The turret's round is a fat red bolt, the heaviest of the three bullet guns.
  out.push(
    directional('tracer_turret', 16, 16, 1, { layer: 'flash', blend: 'add' }, (u, v) => {
      if (Math.hypot(u - 1.5, v) <= 1.7)
        return glow(Math.hypot(u - 1.8, v) < 0.9 ? FIRE[0]! : hex('#ffb0a0'));
      return streak(u, v, 6, 1.5, 1.5, [
        hex('#ffb0a0'),
        hex('#f46b58'),
        hex('#d83f49'),
        hex('#8a2a3a'),
      ]);
    }),
  );
  out.push(
    directional('pellet', 8, 16, 1, { layer: 'flash', blend: 'add' }, (u, v) => {
      if (u >= -0.4 && u <= 1.6 && Math.abs(v) <= 1) return glow(FIRE[1]!);
      return streak(u, v, 3.6, 0, 0.6, [FIRE[2]!, FIRE[3]!, FIRE[4]!]);
    }),
  );

  // --- Rocket: gray body, red warhead, fins, a tail flame that flickers on its own clock ---------
  out.push(
    directional('rocket', 34, 16, 3, { fps: 18, loop: true, outline: OUTLINE }, (u, v, ctx) => {
      const lit = ctx.litRight ? v > 0 : v < 0;
      if (u > 4.5 && u <= 10 && Math.abs(v) <= 2.8 * (1 - (u - 4.5) / 5.8) + 0.3)
        return lit ? hex('#f46b58') : hex('#c8322e');
      if (u > -6 && u <= 4.5 && Math.abs(v) <= 2.6) {
        if (u > 3.2) return STEEL[3]!;
        return Math.abs(v) < 0.7 ? STEEL[1]! : lit ? STEEL[0]! : STEEL[2]!;
      }
      if (u > -8 && u <= -4.2 && Math.abs(v) <= 5 - (u + 8) * 0.5)
        return lit ? STEEL[2]! : STEEL[3]!;
      // Flame: three lengths, so it flickers independently of the rocket's motion.
      const len = [8.5, 5.5, 7][ctx.frame]!;
      const k = (-6 - u) / len;
      if (k >= 0 && k <= 1 && Math.abs(v) <= 2.6 * (1 - k) + (ctx.frame === 1 ? 0.5 : 0))
        return glow(k < 0.3 ? FIRE[0]! : k < 0.6 ? FIRE[1]! : FIRE[3]!);
      return null;
    }),
  );
  // Seeker missile: slim, ivory, red nose, a short blue-white exhaust.
  out.push(
    directional('missile', 26, 16, 2, { fps: 20, loop: true, outline: OUTLINE }, (u, v, ctx) => {
      const lit = ctx.litRight ? v > 0 : v < 0;
      if (u > 3 && u <= 7.5 && Math.abs(v) <= 1.6 * (1 - (u - 3) / 4.8) + 0.3)
        return lit ? hex('#ff7a68') : hex('#d83f49');
      if (u > -5 && u <= 3 && Math.abs(v) <= 1.5) return lit ? hex('#fffaf0') : hex('#cfc8b6');
      if (u > -0.6 && u <= 1.2 && Math.abs(v) <= 3) return hex('#8b93a8');
      if (u > -5.6 && u <= -3.8 && Math.abs(v) <= 3.2) return hex('#d83f49');
      const len = ctx.frame === 0 ? 4.5 : 3;
      const k = (-5 - u) / len;
      if (k >= 0 && k <= 1 && Math.abs(v) <= 1.3 * (1 - k) + 0.3)
        return glow(k < 0.4 ? CYAN[0]! : CYAN[2]!);
      return null;
    }),
  );
  // Harpoon dart: a broad barbed head on a thin shaft.
  out.push(
    directional('harpoon', 22, 16, 1, { outline: OUTLINE }, (u, v, ctx) => {
      const lit = ctx.litRight ? v > 0 : v < 0;
      if (u > 2.5 && u <= 8.5 && Math.abs(v) <= (8.5 - u) * 0.62)
        return lit ? STEEL[0]! : STEEL[2]!;
      if (u > 1 && u <= 3 && Math.abs(v) <= 3.8 && Math.abs(v) >= 1.2 + (u - 1) * 0.4)
        return STEEL[1]!;
      if (u > -7 && u <= 2.5 && Math.abs(v) <= 0.8) return hex('#b08a5a');
      return null;
    }),
  );
  // Boomerang: a hooked V in eight steps of a full turn, bright on its leading edge.
  const boomerang = directional(
    'boomerang',
    22,
    8,
    1,
    { fps: 20, loop: true, outline: OUTLINE },
    (u, v) => {
      for (const side of [-1, 1]) {
        // Each arm runs back from the nose at an angle; the outer edge is the bright one.
        const ax = Math.cos(Math.PI * 0.72) * 1;
        const ay = Math.sin(Math.PI * 0.72) * side;
        const along = (u - 3) * ax + v * ay;
        const across = -(u - 3) * ay + v * ax;
        if (along < -0.6 || along > 8.6) continue;
        const wide = 1.9 - along * 0.07;
        if (Math.abs(across) > wide) continue;
        if (along > 7 && across * side < -0.4) return STEEL[0]!;
        return across * side > 0.3 ? STEEL[0]! : along > 6 ? STEEL[1]! : STEEL[2]!;
      }
      return null;
    },
  );
  // Its eight headings are played as a loop: the blade spins, it does not point.
  boomerang.directions = 1;
  out.push(boomerang);
  // Frost shell: a faceted crystal in four turns.
  out.push(
    fx('frost_ball', 14, 14, 4, { fps: 14, loop: true }, (f, put) => {
      const turn = (f / 4) * (Math.PI / 2);
      for (let y = 0; y < 14; y++)
        for (let x = 0; x < 14; x++) {
          const dx = x + 0.5 - 7;
          const dy = y + 0.5 - 7;
          const u = dx * Math.cos(turn) + dy * Math.sin(turn);
          const v = -dx * Math.sin(turn) + dy * Math.cos(turn);
          const d = Math.abs(u) + Math.abs(v);
          if (d > 5.6) continue;
          if (d > 4.5) put(x, y, ICE[4]!);
          else put(x, y, dx + dy < -2.4 ? ICE[0]! : dx < 0 ? ICE[1]! : dy < 0 ? ICE[2]! : ICE[3]!);
        }
    }),
  );
  // Mortar shell at four sizes: it grows toward the camera as it climbs and shrinks as it falls.
  out.push(
    fx('shell', 18, 18, 4, { fps: 1 }, (f, put) => {
      const r = 2.6 + f * 1.1;
      for (let y = 0; y < 18; y++)
        for (let x = 0; x < 18; x++) {
          const dx = x + 0.5 - 9;
          const dy = y + 0.5 - 9;
          const d = Math.hypot(dx, dy);
          if (d > r + 1) continue;
          if (d > r) put(x, y, INK);
          else if (Math.hypot(dx + r * 0.35, dy + r * 0.35) < r * 0.36) put(x, y, STEEL[0]!);
          else if (Math.abs(dy - r * 0.15) < 0.8 && f > 0) put(x, y, hex('#ffb454'));
          else put(x, y, dx + dy < 0 ? STEEL[2]! : STEEL[3]!);
        }
    }),
  );
  // Foam glob at four sizes, for the same reason.
  out.push(
    fx('foam_glob', 18, 18, 4, { fps: 1 }, (f, put) => {
      const r = 2.4 + f * 1.0;
      const lobes: Lobe[] = [
        { x: 9, y: 9, r },
        { x: 9 - r * 0.6, y: 9 + r * 0.3, r: r * 0.7 },
        { x: 9 + r * 0.55, y: 9 - r * 0.35, r: r * 0.75 },
      ];
      cloud(put, 18, 18, lobes, {
        seed: 41 + f,
        ramp: [FOAM[0]!, FOAM[1]!, FOAM[2]!],
        thresholds: [0.5, 0.2],
        rim: 0.3,
        rimColor: FOAM[4]!,
      });
    }),
  );
  // Shadow of something in the air, at four sizes.
  out.push(
    fx('shadow_blob', 20, 12, 4, { fps: 1, layer: 'ground' }, (f, put) => {
      const rx = 3 + f * 1.8;
      const ry = 1.6 + f * 0.9;
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < 20; x++) {
          const d = Math.hypot((x + 0.5 - 10) / rx, (y + 0.5 - 6) / ry);
          if (d <= 1) put(x, y, [8, 10, 22, d > 0.72 ? 56 : 120]);
        }
    }),
  );

  // --- Flame spitter: jets of fire that swell and cool as they fly -------------------------------
  for (const [id, seed] of [
    ['flame_a', 51],
    ['flame_b', 52],
  ] as const) {
    out.push(
      fx(id, 20, 20, 8, { fps: 15, layer: 'fire' }, (f, put, t) => {
        const swell = 0.42 + Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.6) * 0.75;
        const lobes: Lobe[] = [];
        for (let k = 0; k < 3; k++) {
          const a = hash2(k, seed, 1) * Math.PI * 2;
          const d = t * 4.5 * hash2(k, seed, 2);
          lobes.push({
            x: 10 + Math.cos(a) * d,
            y: 10 + Math.sin(a) * d - t * 1.5,
            r: 5.4 * swell * (0.7 + hash2(k, seed, 3) * 0.5),
          });
        }
        cloud(put, 20, 20, lobes, {
          seed,
          ramp: [FIRE[0]!, FIRE[1]!, FIRE[2]!, FIRE[3]!, FIRE[4]!, FIRE[5]!, FIRE[6]!],
          thresholds: [0.8, 0.62, 0.44, 0.26, 0.1, -0.08],
          heat: 0.36 - t * 0.9,
          noise: 0.18,
          grain: 2.6,
          z: f * 0.45,
          erode: Math.max(0, (t - 0.5) / 0.5) * 0.92,
        });
      }),
    );
  }
  // Cold mist for the frost cannon's barrel and trail.
  out.push(
    fx('frost_mist', 14, 14, 6, { fps: 14, layer: 'smoke' }, (f, put, t) => {
      const lobes: Lobe[] = [];
      for (let k = 0; k < 3; k++) {
        const a = hash2(k, 61, 1) * Math.PI * 2;
        lobes.push({
          x: 7 + Math.cos(a) * t * 3,
          y: 7 + Math.sin(a) * t * 3,
          r: 3.2 * (0.6 + Math.sin(t * 2.6) * 0.55),
        });
      }
      cloud(put, 14, 14, lobes, {
        seed: 61,
        ramp: [ICE[0]!, ICE[1]!, ICE[2]!],
        thresholds: [0.5, 0.2],
        noise: 0.14,
        grain: 2.2,
        z: f * 0.4,
        erode: Math.max(0, (t - 0.35) / 0.65) * 0.95,
      });
    }),
  );

  // The boomerang's glancing cut: a crescent in eight directions, three frames.
  out.push(
    directional('slash', 28, 8, 3, { fps: 22, layer: 'flash', blend: 'add' }, (u, v, ctx) => {
      const f = ctx.frame;
      // A thin arc bulging forward; it thins and slides along its own curve.
      const r = 11;
      const d = Math.hypot(u + r - 4, v);
      const a = Math.atan2(v, u + r - 4);
      const half = [0.75, 1.0, 0.9][f]!;
      if (Math.abs(a) > half) return null;
      const thick = (1 - Math.abs(a) / half) * [2.4, 1.8, 0.9][f]!;
      if (Math.abs(d - r) > thick) return null;
      return Math.abs(d - r) < thick * 0.5 && f < 2 ? hex('#ffffff') : hex('#c4cad8');
    }),
  );

  return out;
}
