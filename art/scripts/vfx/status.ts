import { hex } from '../lib/pixels.js';
import type { FxStrip } from './kit.js';
import { INK, MINT, STEEL, directional, disc, fx, glow, loopNoise, ring } from './kit.js';

/**
 * Things a car wears or does (Section 12.8): boost flames at the exhausts, the repair clamp
 * and the subsystem icon that pulses over a finished repair (Section 13.3, repair burst).
 */
export function buildStatusVfx(): FxStrip[] {
  const out: FxStrip[] = [];

  // Exhaust jet, baked near-white so one strip serves nitro (tinted cyan) and the emergency
  // booster (tinted orange). Three lengths flicker.
  out.push(
    directional(
      'jet',
      24,
      16,
      3,
      { fps: 20, loop: true, layer: 'flash', blend: 'add' },
      (u, v, ctx) => {
        const len = [10, 7.5, 9][ctx.frame]!;
        if (u < 0 || u > len) return null;
        const k = u / len;
        const edge = (loopNoise(u / 2.2, 0.5, 8, 71 + ctx.frame) - 0.5) * 1.2;
        if (Math.abs(v) > 2.5 * (1 - k * k) + edge * k) return null;
        return glow(k < 0.3 ? hex('#ffffff') : k < 0.65 ? hex('#dfe4ee') : hex('#9aa2b8'));
      },
    ),
  );

  // Repair clamp: two jaws close on the part, hold, and let go.
  out.push(
    fx('clamp', 16, 16, 7, { fps: 14, layer: 'body' }, (f, put) => {
      const gap = [5, 3, 1, 1, 1, 3, 5][f]!;
      for (const side of [-1, 1]) {
        const x = 8 + side * (gap + 1.5);
        for (let y = 4; y <= 11; y++) {
          put(x - 0.5, y, STEEL[1]!);
          put(x - 0.5 + side, y, STEEL[3]!);
        }
        for (let i = 0; i <= 2; i++) {
          put(x - 0.5 - side * i, 4, STEEL[1]!);
          put(x - 0.5 - side * i, 11, STEEL[2]!);
        }
        put(x - 0.5 + side * 2, 7, INK);
        put(x - 0.5 + side * 2, 8, INK);
      }
      if (f >= 2 && f <= 4) {
        put(7, 7, MINT[0]!);
        put(8, 8, MINT[0]!);
        if (f === 3)
          for (const [dx, dy] of [
            [-2, -2],
            [2, -2],
            [-2, 2],
            [2, 2],
          ] as const)
            put(7.5 + dx, 7.5 + dy, MINT[1]!);
      }
    }),
  );

  // Subsystem icons, mint on ink, readable at one glance and nothing like a healing spell.
  const icon = (id: string, draw: (put: (x: number, y: number) => void) => void): FxStrip =>
    fx(id, 13, 13, 2, { fps: 6, layer: 'mark' }, (f, put) => {
      const pixels: Array<[number, number]> = [];
      draw((x, y) => pixels.push([Math.floor(x), Math.floor(y)]));
      for (const [x, y] of pixels)
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const)
          put(x + dx, y + dy, INK);
      for (const [x, y] of pixels) put(x, y, f === 0 ? MINT[1]! : MINT[2]!);
    });
  out.push(
    icon('icon_wheel', (p) => {
      ring((x, y) => p(x, y), 6.5, 6.5, 4.6, 1.6, INK);
      p(6, 6);
    }),
  );
  out.push(
    icon('icon_engine', (p) => {
      for (let x = 3; x <= 9; x++)
        for (let y = 5; y <= 9; y++) if (x === 3 || x === 9 || y === 5 || y === 9) p(x, y);
      for (const x of [4, 6, 8]) {
        p(x, 3);
        p(x, 4);
      }
      p(10, 7);
      p(2, 7);
    }),
  );
  out.push(
    icon('icon_part', (p) => {
      // A bolt head: a hexagon with a slot.
      for (let i = -2; i <= 2; i++) {
        p(6 + i, 3);
        p(6 + i, 9);
      }
      for (let j = 4; j <= 8; j++) {
        p(3, j);
        p(9, j);
      }
      for (let i = -1; i <= 1; i++) p(6 + i, 6);
    }),
  );
  out.push(
    icon('icon_steer', (p) => {
      ring((x, y) => p(x, y), 6.5, 6.5, 4.6, 1, INK);
      for (let i = -3; i <= 3; i++) p(6 + i, 6);
      p(6, 7);
      p(6, 8);
      p(6, 9);
    }),
  );

  // The chevron that marks a new leader for a moment.
  out.push(
    fx('mark_lead', 11, 8, 2, { fps: 6, layer: 'mark' }, (f, put) => {
      const c = f === 0 ? hex('#f6c35b') : hex('#fff3b0');
      for (let i = 0; i <= 4; i++) {
        for (const x of [1 + i, 9 - i]) {
          put(x, 1 + i, c);
          put(x, 2 + i, INK);
        }
      }
      put(5, 6, INK);
    }),
  );

  // Aim tick of the turret and crosshair of a lock: tiny, red, never mistaken for fire.
  out.push(
    fx('aim_dot', 5, 5, 2, { fps: 8, loop: true, layer: 'mark' }, (f, put) => {
      disc(put, 2.5, 2.5, 1.4, f === 0 ? hex('#ff5d5d') : hex('#d83f49'));
      if (f === 0) put(2, 2, hex('#ffffff'));
    }),
  );

  return out;
}
