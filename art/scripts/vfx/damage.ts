import type { CarAtlasManifest, DamageOverlayManifest } from '@bolt/shared';
import { CAR_HEADINGS, CAR_SHEET_COLUMNS, TAU, hash2 } from '@bolt/shared';
import type { RGBA } from '../lib/pixels.js';
import { PixelBuffer, hex } from '../lib/pixels.js';
import { vnoise } from './kit.js';

/**
 * Damage and frost overlays (Section 8.5: damage is read on the vehicle). For each chassis one
 * sheet with the same 64 headings as its body, three blocks of them: scuffed, battered and
 * frosted. The compositor draws a block's frame over the body frame of the same heading.
 *
 * The marks are defined once, in the car's own space, and drawn onto every heading from the
 * baked body sheet: a pixel of the body is traced back to where it is on the car, and the
 * pattern is asked whether there is a scratch there. So a scratch on the left front wing is on
 * the left front wing at every heading, and nothing is drawn where there is no bodywork.
 */

export const DAMAGE_STATES = ['scuffed', 'battered', 'frosted'] as const;

const SCRATCH = hex('#23243a');
const BARE = hex('#c4cad8');
const SOOT = hex('#191a2a');
const SOOT_LIGHT = hex('#2e3046');
const ICE_HI = hex('#ffffff');
const ICE = hex('#d8f6ff');
const ICE_LOW = hex('#9fe8ff');
/** Bodywork is drawn about this many pixels above the point of the road it stands on. */
const BODY_LIFT = 6;

type Segment = { x0: number; y0: number; x1: number; y1: number };

function segments(seed: number, count: number, halfW: number, halfL: number): Segment[] {
  const out: Segment[] = [];
  for (let k = 0; k < count; k++) {
    const x = (hash2(k, seed, 1) - 0.5) * 2 * halfW;
    const y = (hash2(k, seed, 2) - 0.5) * 2 * halfL;
    const a = hash2(k, seed, 3) * Math.PI;
    const len = 2 + hash2(k, seed, 4) * 5;
    out.push({ x0: x, y0: y, x1: x + Math.cos(a) * len, y1: y + Math.sin(a) * len });
  }
  return out;
}

function nearSegment(list: readonly Segment[], x: number, y: number): number {
  for (let i = 0; i < list.length; i++) {
    const s = list[i]!;
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - (s.x0 + dx * t), y - (s.y0 + dy * t)) <= 0.62) return t > 0.8 ? 2 : 1;
  }
  return 0;
}

export function bakeDamageOverlays(
  cars: CarAtlasManifest,
  readBody: (file: string) => PixelBuffer,
): { manifest: DamageOverlayManifest; sheets: Map<string, PixelBuffer> } {
  const sheets = new Map<string, PixelBuffer>();
  const manifest: DamageOverlayManifest = { version: 1, states: [...DAMAGE_STATES], chassis: {} };
  for (const chassis of Object.values(cars.chassis)) {
    const body = readBody(chassis.body.file);
    const cell = chassis.body.frameWidth;
    const rows = Math.ceil(CAR_HEADINGS / CAR_SHEET_COLUMNS);
    const sheet = new PixelBuffer(cell * CAR_SHEET_COLUMNS, cell * rows * DAMAGE_STATES.length);
    const seed = chassis.id.length * 131 + chassis.id.charCodeAt(8)!;
    // The body's own extent, from its heading-0 frame, sizes the patterns.
    let halfW = 14;
    let halfL = 24;
    {
      let minX = cell;
      let maxX = 0;
      let minY = cell;
      let maxY = 0;
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++)
          if (body.alphaAt(x, y) !== 0) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
      halfW = (maxX - minX) / 2;
      halfL = (maxY - minY) / 2;
    }
    const light = segments(seed, 16, halfW, halfL);
    const heavy = [...light, ...segments(seed + 7, 26, halfW, halfL)];
    const blotches = Array.from({ length: 6 }, (_, k) => ({
      x: (hash2(k, seed, 11) - 0.5) * 2 * halfW * 0.8,
      y: (hash2(k, seed, 12) - 0.5) * 2 * halfL * 0.85,
      r: 3.5 + hash2(k, seed, 13) * 4,
    }));

    for (let h = 0; h < CAR_HEADINGS; h++) {
      const heading = (h * TAU) / CAR_HEADINGS;
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const fx = (h % CAR_SHEET_COLUMNS) * cell;
      const fy = Math.floor(h / CAR_SHEET_COLUMNS) * cell;
      const opaque = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < cell && y < cell && body.alphaAt(fx + x, fy + y) !== 0;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          if (!opaque(x, y)) continue;
          // Back to the car's own space: undo the lift of the tilted camera, then the turn.
          const dx = x + 0.5 - cell / 2;
          const dy = y + 0.5 - cell / 2 + BODY_LIFT;
          const lx = Math.round(dx * c + dy * s);
          const ly = Math.round(-dx * s + dy * c);
          const put = (block: number, color: RGBA) =>
            sheet.set(fx + x, fy + y + block * rows * cell, color);

          const scuff = nearSegment(light, lx, ly);
          if (scuff) put(0, scuff === 2 ? BARE : SCRATCH);

          const mark = nearSegment(heavy, lx, ly);
          let soot = 0;
          for (const b of blotches) {
            const d =
              Math.hypot(lx - b.x, ly - b.y) / b.r +
              (vnoise(lx / 2.5, ly / 2.5, 0, seed) - 0.5) * 0.7;
            if (d < 1) soot = Math.max(soot, d < 0.55 ? 2 : 1);
          }
          if (mark) put(1, mark === 2 ? BARE : SCRATCH);
          // Soot is a checkered stain, so the paint under it still shows which car it is.
          else if (soot === 2 && (lx + ly) % 2 === 0) put(1, SOOT);
          else if (soot === 1 && (lx + ly) % 2 === 0 && hash2(lx, ly, seed) > 0.3)
            put(1, SOOT_LIGHT);

          // Frost: a crust along every edge of the body and crystals scattered over it.
          let rim = 0;
          for (const [ox, oy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const)
            if (!opaque(x + ox, y + oy)) rim = 2;
          if (!rim)
            for (const [ox, oy] of [
              [-2, 0],
              [2, 0],
              [0, -2],
              [0, 2],
              [-1, -1],
              [1, 1],
              [-1, 1],
              [1, -1],
            ] as const)
              if (!opaque(x + ox, y + oy)) rim = 1;
          const crystal = hash2(lx, ly, seed + 3);
          if (rim === 2) put(2, crystal > 0.3 ? ICE : ICE_HI);
          else if (rim === 1 && crystal > 0.35) put(2, ICE_LOW);
          else if (crystal > 0.93) put(2, ICE_HI);
          else if (crystal > 0.86 && (lx + ly) % 2 === 0) put(2, ICE_LOW);
        }
      }
    }
    const file = `${chassis.id}_damage.png`;
    sheets.set(file, sheet);
    manifest.chassis[chassis.id] = {
      file,
      frameWidth: cell,
      frameHeight: cell,
      columns: CAR_SHEET_COLUMNS,
      rows: rows * DAMAGE_STATES.length,
    };
  }
  return { manifest, sheets };
}
