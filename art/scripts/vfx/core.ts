import { hash2 } from '@bolt/shared';
import type { RGBA } from '../lib/pixels.js';
import { PixelBuffer, hex } from '../lib/pixels.js';

/**
 * Core driving effects for Milestone A: tire smoke and surface dust, wall sparks, exhaust
 * puffs, skid decals and the headlight pool. Each is an authored frame strip built from pixel
 * clusters with seeded variation, never a scaled translucent circle (Section 13).
 * Smoke is baked near-white so the client can tint it per surface.
 */

export type VfxStrip = {
  id: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
  image: PixelBuffer;
};

function strip(
  id: string,
  fw: number,
  fh: number,
  frames: number,
  fps: number,
  draw: (frame: number, put: (x: number, y: number, c: RGBA) => void) => void,
): VfxStrip {
  const image = new PixelBuffer(fw * frames, fh);
  for (let f = 0; f < frames; f++) {
    draw(f, (x, y, c) => {
      if (x < 0 || y < 0 || x >= fw || y >= fh) return;
      image.set(f * fw + x, y, c);
    });
  }
  return { id, frameWidth: fw, frameHeight: fh, frames, fps, image };
}

/** A billowing cluster: three lobes that swell, drift apart, then break into flecks. */
function puff(
  id: string,
  size: number,
  frames: number,
  seed: number,
  light: RGBA,
  mid: RGBA,
  dark: RGBA,
): VfxStrip {
  const c = size / 2;
  return strip(id, size, size, frames, 14, (f, put) => {
    const t = f / (frames - 1);
    const lobes = [0, 1, 2].map((k) => {
      const a = hash2(k, seed, 11) * Math.PI * 2;
      const spread = (0.6 + t * 2.4) * (0.6 + hash2(k, seed, 12) * 0.6);
      return {
        x: c + Math.cos(a) * spread,
        y: c + Math.sin(a) * spread - t * 1.2,
        r:
          (size * 0.2 + hash2(k, seed, 13) * size * 0.1) *
          (0.55 + Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.75) * 0.75),
      };
    });
    // Late frames erode: a rising share of pixels drop out in stable 2 px cells.
    const erode = Math.max(0, (t - 0.45) / 0.55);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let inside = -1;
        let best = Infinity;
        for (let k = 0; k < lobes.length; k++) {
          const l = lobes[k]!;
          const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) / l.r;
          if (d < best) {
            best = d;
            inside = k;
          }
        }
        if (best > 1 || inside < 0) continue;
        if (hash2(x >> 1, y >> 1, seed + 40) < erode * 0.95) continue;
        const l = lobes[inside]!;
        // Lit from the upper left, like everything else in the game.
        const lit = (l.x - x) * 0.5 + (l.y - y) * 0.6;
        put(x, y, best > 0.78 && lit < 0 ? dark : lit > l.r * 0.2 ? light : mid);
      }
    }
  });
}

export function buildCoreVfx(): VfxStrip[] {
  const out: VfxStrip[] = [];
  const white = hex('#f2f4fa');
  const mid = hex('#c4cad8');
  const dark = hex('#8b93a8');
  out.push(puff('smoke_a', 16, 7, 1, white, mid, dark));
  out.push(puff('smoke_b', 16, 7, 2, white, mid, dark));
  out.push(puff('smoke_small', 10, 5, 3, white, mid, dark));
  out.push(puff('exhaust', 8, 5, 4, hex('#aab2c6'), hex('#7c859c'), hex('#565f78')));

  // Hot spark: a streak that shortens and cools from white to orange to ember red.
  out.push(
    strip('spark', 8, 8, 5, 24, (f, put) => {
      const colors = [
        hex('#ffffff'),
        hex('#fff3b0'),
        hex('#f6c35b'),
        hex('#f08a3c'),
        hex('#d83f49'),
      ];
      const len = [4, 4, 3, 2, 1][f]!;
      for (let i = 0; i < len; i++)
        put(2 + i, 5 - i, colors[Math.min(4, f + (i === len - 1 ? 0 : 1))]!);
    }),
  );
  // Impact star for a wall strike: two frames of four-point flash, then a ring of flecks.
  out.push(
    strip('impact', 16, 16, 4, 20, (f, put) => {
      const hot = hex('#ffffff');
      const warm = hex('#fff3b0');
      const gold = hex('#f6c35b');
      const c = 8;
      if (f < 2) {
        const arm = f === 0 ? 5 : 7;
        for (let i = -arm; i <= arm; i++) {
          const col = Math.abs(i) < 2 ? hot : Math.abs(i) < arm - 1 ? warm : gold;
          put(c + i, c, col);
          put(c, c + i, col);
          if (Math.abs(i) <= arm / 2) {
            put(c + i, c + i, warm);
            put(c + i, c - i, warm);
          }
        }
      } else {
        const r = f === 2 ? 5 : 7;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + hash2(k, f, 5);
          put(
            Math.round(c + Math.cos(a) * r),
            Math.round(c + Math.sin(a) * r),
            f === 2 ? warm : gold,
          );
        }
      }
    }),
  );

  // Rubber laid on the road. Two severities; ends are ragged so repeats do not tile visibly.
  for (const [id, alpha] of [
    ['skid_light', 70],
    ['skid_heavy', 130],
  ] as const) {
    out.push(
      strip(id, 5, 8, 4, 1, (f, put) => {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 5; x++) {
            const edge = x === 0 || x === 4;
            if ((y === 0 || y === 7) && hash2(x, y + f * 9, 77) < 0.5) continue;
            if (edge && hash2(x, y + f * 9, 78) < 0.35) continue;
            put(x, y, [10, 12, 22, edge ? Math.round(alpha * 0.6) : alpha]);
          }
        }
      }),
    );
  }

  // Headlight pool: three hard-edged steps, drawn additively on the road ahead of the car.
  out.push(
    strip('headlight_cone', 72, 96, 1, 1, (_f, put) => {
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 72; x++) {
          const dx = x + 0.5 - 36;
          const dy = 96 - (y + 0.5);
          const reach = Math.hypot(dx, dy) / 96;
          const spread = Math.abs(Math.atan2(dx, dy));
          if (spread > 0.36 || reach > 0.97) continue;
          const level = reach < 0.36 ? 3 : reach < 0.66 ? 2 : 1;
          // One-pixel checker band between steps keeps the falloff crisp instead of blurred.
          const bandEdge = Math.abs(reach - 0.36) < 0.012 || Math.abs(reach - 0.66) < 0.012;
          const lv = bandEdge && (x + y) % 2 === 0 ? level - 1 : level;
          if (lv <= 0) continue;
          put(x, y, [255, 240, 196, [0, 26, 46, 70][lv]!]);
        }
      }
    }),
  );
  return out;
}
