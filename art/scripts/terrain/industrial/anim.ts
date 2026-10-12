import { hash2, mulberry32 } from '@bolt/shared';
import type { TrackHazard } from '@bolt/shared';
import type { AnimatedArt, BakeContext } from '../biome.js';
import { Canvas, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { Rect } from '../city/layout.js';
import { PAL } from '../city/palette.js';
import { timetableLoop } from '../city/timetable.js';
import type { TimetableState } from '../city/timetable.js';
import { shapeTest, zoneBox } from './road.js';
import { IND } from './style.js';

/**
 * Steel Circuit's loops. Timetable loops follow the steam vents' schedules (the client picks
 * their frame from the race clock, see `city/timetable.ts`): steam above the cars, the grate's
 * warning ring and the warning lamps on the ground. Ambient loops: the conveyor, the stack and
 * crane beacons, the furnace's flicker, welding sparks, the oil sheen and the magnetic strips'
 * running lights. Every ground loop starts from the finished picture, so frame 0 (or every
 * settled frame) is exactly what is baked under it.
 */

type Vent = Extract<TrackHazard, { kind: 'steam_vent' }>;

/** A ground loop whose frames are the baked picture plus `draw`; frame 0 draws nothing. */
export function groundLoop(
  world: Canvas,
  id: string,
  kind: string,
  box: Rect,
  count: number,
  fps: number,
  draw: (cv: Canvas, frame: number) => void,
): AnimatedArt {
  const frames: Canvas[] = [];
  for (let k = 0; k < count; k++) {
    const cv = Canvas.sprite(box.w, box.h);
    cv.buf.copyFrom(world.buf, box.x, box.y, box.w, box.h, 0, 0);
    if (k > 0) draw(cv, k);
    frames.push(cv);
  }
  const across = Math.max(1, Math.min(count, Math.floor(4096 / box.w)));
  return {
    id,
    kind,
    frames,
    x: box.x,
    y: box.y,
    fps,
    above: false,
    blend: 'normal',
    columns: across,
  };
}

const bright = (c: Color, t: number): Color => mixc(c, 0xfff2d8, t);

/** Steam above a vent: a hiss of wisps in the warning, a billowing column while active. */
export function steamLoop(vent: Vent, k: number): AnimatedArt {
  if (vent.shape.type !== 'circle') throw new Error('steam vents are circles');
  const { x: cx, y: cy, radius: R } = vent.shape;
  const W = Math.round(R * 2 + 30);
  const H = Math.round(R * 2 + 90);
  const x0 = Math.round(cx - W / 2);
  const y0 = Math.round(cy + R + 6 - H);
  const pale = 0xe8eef6;
  const mid = 0xbcc8d8;
  const shade = 0x8896ac;
  const puff = (cv: Canvas, px: number, py: number, r: number, a: number): void => {
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++) {
        const d = Math.hypot(xx, yy * 1.2);
        if (d > r) continue;
        const lit = xx + yy < -r * 0.3;
        const c = d > r - 1.5 ? shade : lit ? pale : mid;
        const alpha = Math.round((a * (d > r - 1.5 ? 0.6 : 1)) / 32) * 32;
        if (alpha <= 0) continue;
        cv.halo(Math.round(px - x0 + xx), Math.round(py - y0 + yy), c, Math.min(240, alpha));
      }
  };
  return timetableLoop({
    id: `steam_${vent.id}`,
    hazardId: vent.id,
    schedule: vent.schedule,
    fps: 10,
    x: x0,
    y: y0,
    w: W,
    h: H,
    above: true,
    blend: 'normal',
    base: null,
    draw: (cv, st: TimetableState) => {
      const rnd = mulberry32(st.frame * 31 + k * 977);
      if (st.phase === 'warning') {
        // Hiss: thin wisps escaping round the rim, more of them as the blast nears.
        const n = 3 + Math.round(st.u * 6);
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2;
          const rr = R * (0.4 + rnd() * 0.5);
          const lift = 4 + rnd() * 10 * (0.5 + st.u);
          puff(
            cv,
            cx + Math.cos(a) * rr,
            cy + Math.sin(a) * rr * 0.8 - lift,
            2 + Math.round(rnd() * 2),
            150,
          );
        }
      } else if (st.phase === 'active') {
        // Blast: a column of puffs rising from the whole grate, tallest mid-blast.
        const grow = Math.min(1, st.since / 0.35);
        const fade = st.u > 0.75 ? 1 - (st.u - 0.75) / 0.25 : 1;
        const top = 30 + 50 * grow;
        for (let i = 0; i < 26; i++) {
          const h = rnd() * top;
          const spread = R * (0.55 + (h / top) * 0.5);
          const px = cx + (rnd() * 2 - 1) * spread + Math.sin(st.time * 6 + i) * 2;
          const py = cy - h;
          const r = Math.round(5 + (h / top) * 7 + rnd() * 3);
          puff(cv, px, py, r, 230 * fade);
        }
      } else if (st.since < 0.6) {
        // The last of it drifting off.
        for (let i = 0; i < 6; i++)
          puff(
            cv,
            cx + (rnd() * 2 - 1) * R * 0.8,
            cy - 30 - rnd() * 40 - st.since * 30,
            6,
            120 * (1 - st.since / 0.6),
          );
      }
    },
  });
}

/** The vent's grate ring flashing hot through the warning, glowing while it blasts. */
export function ventRingLoop(ctx: BakeContext, world: Canvas, vent: Vent, k: number): AnimatedArt {
  const idx = ctx.def.hazards.indexOf(vent);
  const box = zoneBox(ctx, idx)!;
  const inside = shapeTest(ctx, vent.shape);
  const R = vent.shape.type === 'circle' ? vent.shape.radius : 30;
  const cx = vent.shape.type === 'circle' ? vent.shape.x : 0;
  const cy = vent.shape.type === 'circle' ? vent.shape.y : 0;
  return timetableLoop({
    id: `vent_ring_${vent.id}`,
    hazardId: vent.id,
    schedule: vent.schedule,
    fps: 10,
    x: box.x0,
    y: box.y0,
    w: box.x1 - box.x0,
    h: box.y1 - box.y0,
    above: false,
    blend: 'normal',
    base: world,
    draw: (cv, st) => {
      if (st.phase === 'idle') return;
      const on = st.phase === 'active' || Math.floor(st.time * 5) % 2 === 0;
      void k;
      for (let y = 0; y < cv.h; y++)
        for (let x = 0; x < cv.w; x++) {
          const wx = box.x0 + x + 0.5;
          const wy = box.y0 + y + 0.5;
          if (!inside(wx, wy)) continue;
          const r = Math.hypot(wx - cx, wy - cy);
          const c = cv.get(x, y);
          if (r > R - 6) {
            if (on && c === IND.hazardYellow) cv.set(x, y, IND.moltenHi);
            else if (on && c === IND.hazardBlack) cv.set(x, y, IND.moltenMid);
          } else if (st.phase === 'active' && c === IND.grate) cv.set(x, y, 0x9aa6b8);
        }
    },
  });
}

/** A warning lamp beside a vent: dark when quiet, an amber beacon sweeping otherwise. */
export function lampLoop(
  world: Canvas,
  vent: Vent,
  at: { x: number; y: number },
  k: number,
): AnimatedArt {
  const box = { x: at.x - 5, y: at.y - 5, w: 11, h: 8 };
  return timetableLoop({
    id: `warning_lamp_${k + 1}`,
    hazardId: vent.id,
    schedule: vent.schedule,
    fps: 10,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    above: false,
    blend: 'normal',
    base: world,
    draw: (cv, st) => {
      if (st.phase === 'idle') return;
      const beam = Math.floor(st.time * 8) % 4;
      cv.set(5, 4, PAL.amber);
      cv.set(5, 3, PAL.goldHi);
      const dirs: Array<[number, number]> = [
        [-1, 0],
        [0, -1],
        [1, 0],
        [0, 1],
      ];
      const [dx, dy] = dirs[beam]!;
      for (let r = 1; r < 5; r++) {
        const x = 5 + dx * r;
        const y = 4 + dy * Math.min(r, 3);
        cv.set(x, y, mixc(cv.get(x, y), PAL.amber, r < 3 ? 0.75 : 0.45));
      }
    },
  });
}

/** Running lights along a magnetic strip: the bars brighten in a chase down the road. */
export function magnetLoop(ctx: BakeContext, world: Canvas, k: number): AnimatedArt | null {
  const box = zoneBox(ctx, k);
  if (!box) return null;
  const r = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
  const s = ctx.field.s;
  const w = ctx.field.w;
  return groundLoop(
    world,
    `magnet_marks_${ctx.def.hazards[k]!.id}`,
    'magnet_marks',
    r,
    6,
    8,
    (cv, f) => {
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const c = cv.get(x, y);
          if (c !== IND.magnetBar && c !== IND.magnetHi) continue;
          const ss = s[(r.y + y) * w + r.x + x]!;
          if (Math.floor(ss / 10) % 6 === 6 - f) cv.set(x, y, IND.magnetHi);
        }
    },
  );
}

/** A slow sheen sliding across an oil pool. */
export function oilLoop(ctx: BakeContext, world: Canvas, k: number): AnimatedArt | null {
  const box = zoneBox(ctx, k);
  if (!box) return null;
  const r = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
  return groundLoop(world, `oil_sheen_${ctx.def.hazards[k]!.id}`, 'oil_sheen', r, 8, 5, (cv, f) => {
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const c = cv.get(x, y);
        if (c !== IND.oil && c !== IND.oilMid) continue;
        const band = (x + y * 2 - f * 12 + 400) % 48;
        if (band < 2 && hash2(x, y, 31) < 0.7) cv.set(x, y, IND.oilSheen);
      }
  });
}

/** A blinking red beacon at a point already baked dark-red in the picture. */
export function beaconLoop(
  world: Canvas,
  id: string,
  at: { x: number; y: number },
  phase: number,
): AnimatedArt {
  const box = { x: at.x - 2, y: at.y - 2, w: 5, h: 5 };
  return groundLoop(world, id, 'aircraft_beacon', box, 6, 4, (cv, f) => {
    const on = (f + phase) % 6 < 2;
    const off = (f + phase) % 6 >= 4;
    if (off) cv.set(2, 2, 0x5a1a22);
    else if (on) {
      cv.set(2, 2, PAL.coralHi);
      for (const [dx, dy] of [
        [1, 2],
        [3, 2],
        [2, 1],
        [2, 3],
      ] as const)
        cv.set(dx, dy, mixc(cv.get(dx, dy), PAL.red, 0.7));
    }
  });
}

/** The furnace mouth's flicker and the floor glow in front of it. */
export function furnaceLoop(world: Canvas, mouth: Rect): AnimatedArt {
  const box = { x: mouth.x - 2, y: mouth.y - 2, w: mouth.w + 4, h: mouth.h + 4 };
  return groundLoop(world, 'smelter_glow', 'molten_glow', box, 8, 8, (cv, f) => {
    const rnd = mulberry32(f * 97);
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++) {
        const c = cv.get(x, y);
        if (c === IND.molten && rnd() < 0.35)
          cv.set(x, y, f % 3 === 0 ? IND.moltenHi : IND.moltenMid);
        else if (c === IND.moltenMid && rnd() < 0.2) cv.set(x, y, IND.molten);
      }
  });
}

/** Welding sparks: short bursts of bright pixels at a work bench. */
export function sparksLoop(world: Canvas, at: { x: number; y: number }): AnimatedArt {
  const box = { x: at.x - 10, y: at.y - 14, w: 21, h: 18 };
  return groundLoop(world, 'welding_sparks', 'sparks', box, 10, 12, (cv, f) => {
    if (f > 6) return;
    const rnd = mulberry32(f * 13 + 5);
    cv.set(10, 12, IND.moltenHi);
    cv.set(10, 13, PAL.ivory);
    for (let i = 0; i < 6 + f; i++) {
      const a = -Math.PI * (0.1 + rnd() * 0.8);
      const r = 1 + rnd() * (2 + f * 1.4);
      const x = Math.round(10 + Math.cos(a) * r);
      const y = Math.round(12 + Math.sin(a) * r * 0.8 + f * 0.4);
      if (x >= 0 && y >= 0 && x < box.w && y < box.h)
        cv.set(x, y, i % 3 === 0 ? PAL.ivory : IND.moltenHi);
    }
  });
}

/** A conveyor belt on the quay: rollers and lugs creeping along it. */
export function conveyorLoop(world: Canvas, belt: Rect): AnimatedArt {
  const draw = (cv: Canvas, ox: number, oy: number, f: number): void => {
    for (let y = 0; y < belt.h; y++) {
      const lug = (y + f * 2) % 12 === 0;
      for (let x = 1; x < belt.w - 1; x++)
        cv.set(ox + x, oy + y, lug ? PAL.steelHi : (y + f * 2) % 4 === 0 ? 0x2e3442 : 0x3a4152);
      cv.set(ox, oy + y, PAL.steelLight);
      cv.set(ox + belt.w - 1, oy + y, PAL.steelDark);
    }
  };
  // The baked belt is frame 0.
  const prev = world.curFlags;
  world.curFlags = 0;
  draw(world, belt.x, belt.y, 0);
  world.curFlags = prev;
  return groundLoop(world, 'quay_conveyor', 'conveyor', belt, 6, 10, (cv, f) => draw(cv, 0, 0, f));
}

export { bright };

/** A press ram travelling down and up between its columns; frame 0 is the ram at the top. */
export function pistonLoop(world: Canvas, at: { x: number; y: number }, k: number): AnimatedArt {
  const box = { x: at.x, y: at.y, w: 16, h: 20 };
  const travel = [0, 3, 7, 12, 14, 12, 7, 3];
  const base = Canvas.sprite(box.w, box.h);
  base.buf.copyFrom(world.buf, box.x, box.y, box.w, box.h, 0, 0);
  // The ram is drawn into the picture at the top of its stroke.
  const ram = (cv: Canvas, ox: number, oy: number, t: number): void => {
    for (let x = 1; x < box.w - 1; x++) {
      cv.set(ox + x, oy + t, PAL.steelLight);
      cv.set(ox + x, oy + t + 1, PAL.steel);
      cv.set(ox + x, oy + t + 2, PAL.steel);
      cv.set(ox + x, oy + t + 3, PAL.steelDark);
    }
    for (let v = 0; v < t; v++) cv.set(ox + (box.w >> 1), oy + v, PAL.steelHi);
  };
  ram(world, box.x, box.y, 0);
  const frames = travel.map((t) => {
    const cv = Canvas.sprite(box.w, box.h);
    cv.buf.copyFrom(base.buf, 0, 0, box.w, box.h, 0, 0);
    ram(cv, 0, 0, t);
    return cv;
  });
  return {
    id: `press_piston_${k + 1}`,
    kind: 'piston',
    frames,
    x: box.x,
    y: box.y,
    fps: 8,
    above: false,
    blend: 'normal',
  };
}
