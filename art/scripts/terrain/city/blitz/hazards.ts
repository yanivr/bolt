import type { TrackHazard } from '@bolt/shared';
import type { AnimatedArt, BakeContext } from '../../biome.js';
import { Canvas, F_EMISSIVE, col } from '../../canvas.js';
import type { Color } from '../../canvas.js';
import { TILT } from '../../oblique.js';
import type { Scene } from '../../oblique.js';
import { PAL, darker, lighter } from '../palette.js';
import { emissive } from '../sprites.js';
import { timetableLoop } from '../timetable.js';
import type { TimetableState } from '../timetable.js';

/**
 * The hazards of Backstreet Blitz, drawn on the pixels the physics uses: the tram crossing's
 * posts, lights and boom (a timetable loop), the barricades on Bakers Row (on their capsules),
 * the crates in Laundry Lane and the old town gate bollards (inside their collision discs).
 */

export type Crossing = Extract<TrackHazard, { kind: 'crossing' }>;

/** Circles approximating every barricade capsule, so the guard treats them as solid. */
export function wallDiscs(ctx: BakeContext): Array<{ x: number; y: number; radius: number }> {
  const out: Array<{ x: number; y: number; radius: number }> = [];
  for (const wl of ctx.def.walls) {
    for (let k = 0; k + 1 < wl.points.length; k++) {
      const a = wl.points[k]!;
      const b = wl.points[k + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / 2));
      for (let j = 0; j <= n; j++)
        out.push({
          x: a.x + ((b.x - a.x) * j) / n,
          y: a.y + ((b.y - a.y) * j) / n,
          radius: wl.thickness / 2 - 0.6,
        });
    }
  }
  return out;
}

const STRIPE_RED = col('#D8443C');
const STRIPE_WHITE = col('#F2EADA');

/**
 * A barricade standing exactly on its capsule: a low concrete block with a red and white
 * striped board, all of it inside the capsule's footprint so nothing reaches drivable ground.
 */
export function paintBarricades(ctx: BakeContext, scene: Scene): Array<{ x: number; y: number }> {
  const lamps: Array<{ x: number; y: number }> = [];
  for (const wl of ctx.def.walls) {
    if (wl.kind !== 'barricade') continue;
    const a = wl.points[0]!;
    const b = wl.points[wl.points.length - 1]!;
    const x0 = Math.round(Math.min(a.x, b.x)) - 2;
    const x1 = Math.round(Math.max(a.x, b.x)) + 2;
    const cy = Math.round((a.y + b.y) / 2);
    const w = x1 - x0 + 1;
    // Footprint rows cy-2 .. cy+3; the board top rises three rows: all within the capsule.
    const cv = Canvas.sprite(w + 1, 10);
    for (let x = 0; x < w; x++) {
      const stripe = (Math.floor((x + x0) / 4) & 1) === 0;
      const c = stripe ? STRIPE_RED : STRIPE_WHITE;
      cv.set(x + 1, 0, lighter(c, 0.2));
      cv.set(x + 1, 1, c);
      cv.set(x + 1, 2, c);
      cv.set(x, 3, darker(c, 0.18));
      cv.set(x, 4, darker(c, 0.28));
      cv.set(x, 5, PAL.kerbShade);
      cv.set(x, 6, PAL.kerbShade);
      cv.set(x, 7, PAL.ink);
    }
    cv.set(0, 3, PAL.ink);
    scene.add({ art: cv, x: x0, y: cy - 5, baseY: cy + 3 });
    scene.footprint(x0, cy - 2, w, 6, 3);
    lamps.push({ x: Math.round((a.x + b.x) / 2), y: cy - 6 });
  }
  return lamps;
}

/** Amber blinkers on the barricades: an ambient loop, not over the telegraph stripes. */
export function barricadeBlinkers(
  world: Canvas,
  lamps: ReadonlyArray<{ x: number; y: number }>,
): AnimatedArt[] {
  return lamps.map((l, k) => {
    const lamp = (cv: Canvas, ox: number, oy: number, on: boolean): void => {
      cv.set(ox + 1, oy + 1, on ? PAL.amber : darker(PAL.amber, 0.55));
      cv.set(ox + 1, oy, on ? PAL.goldHi : PAL.ink);
    };
    const base = Canvas.sprite(3, 3);
    base.buf.copyFrom(world.buf, l.x - 1, l.y - 1, 3, 3, 0, 0);
    const frames = [0, 1, 2, 3].map((f) => {
      const cv = Canvas.sprite(3, 3);
      cv.buf.copyFrom(base.buf, 0, 0, 3, 3, 0, 0);
      lamp(cv, 0, 0, (f + k) % 4 < 2);
      return cv;
    });
    // The baked picture is frame 0.
    const prev = world.curFlags;
    world.curFlags = F_EMISSIVE;
    lamp(world, l.x - 1, l.y - 1, k % 4 < 2);
    world.curFlags = prev;
    return {
      id: `barricade_blinker_${k + 1}`,
      kind: 'warning_blinker',
      frames,
      x: l.x - 1,
      y: l.y - 1,
      fps: 4,
      above: false,
      blend: 'normal',
    };
  });
}

/** Draws the crates and bollards inside their own collision discs. */
export function paintObstacles(ctx: BakeContext, scene: Scene): void {
  for (const ob of ctx.track.obstacles) {
    const x = Math.round(ob.x);
    const y = Math.round(ob.y);
    if (ob.kind === 'crate') {
      // Two stacked crates, the stack inside a disc of radius 9.
      const cv = Canvas.sprite(13, 15);
      const crate = (cx: number, cy: number, s: number): void => {
        cv.rect(cx, cy, s, 3, PAL.woodLight);
        cv.hline(cx, cy, s, lighter(PAL.woodLight, 0.25));
        cv.rect(cx, cy + 3, s, s - 3, PAL.wood);
        cv.frame(cx, cy + 3, s, s - 3, PAL.woodDark);
        cv.line(cx + 1, cy + 4, cx + s - 2, cy + s - 1, PAL.woodDark);
      };
      crate(0, 4, 12);
      crate(3, 0, 7);
      cv.hline(0, 14, 12, PAL.ink);
      scene.add({ art: cv, x: x - 6, y: y - 7, baseY: y + 7 });
      scene.shadeDisc(x + 3, y + 4, 6);
    } else {
      // Old stone bollard with an iron cap.
      const cv = Canvas.sprite(6, 10);
      cv.rect(0, 2, 6, 7, PAL.kerb);
      cv.vline(0, 2, 7, PAL.kerbHi);
      cv.vline(5, 2, 7, PAL.kerbShade);
      cv.rect(1, 0, 4, 3, PAL.steelDark);
      cv.hline(1, 0, 4, PAL.steel);
      cv.hline(0, 9, 6, PAL.ink);
      scene.add({ art: cv, x: x - 3, y: y - 5, baseY: y + 4 });
      scene.shadeDisc(x + 2, y + 3, 3);
    }
  }
}

// --- The tram crossing ---------------------------------------------------------------------

const POST_RISE = 12;
const MAST_RISE = 20;

/** The two boom posts and the two light masts, standing on solid ground. */
export function paintCrossingPosts(scene: Scene, h: Crossing): void {
  for (const p of [h.a, h.b]) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const cv = Canvas.sprite(6, POST_RISE + 4);
    cv.rect(1, 2, 4, POST_RISE + 1, PAL.kerbIvory);
    for (let v = 0; v < POST_RISE; v += 4) cv.rect(1, 2 + v, 4, 2, STRIPE_RED);
    cv.vline(1, 2, POST_RISE + 1, PAL.kerbHi);
    cv.rect(0, 0, 6, 3, PAL.steelDark);
    cv.hline(0, 0, 6, PAL.steel);
    cv.hline(0, POST_RISE + 3, 6, PAL.ink);
    scene.add({ art: cv, x: x - 3, y: y - POST_RISE - 3, baseY: y });
    scene.footprint(x - 2, y - 1, 4, 2, 5);
  }
  for (const l of h.lights) {
    const x = Math.round(l.x);
    const y = Math.round(l.y);
    const cv = Canvas.sprite(13, MAST_RISE + 2);
    cv.vline(6, 4, MAST_RISE - 2, PAL.steelLight);
    cv.vline(7, 4, MAST_RISE - 2, PAL.steelDark);
    cv.hline(5, MAST_RISE + 1, 4, PAL.ink);
    // Crossbuck over the lamps.
    cv.line(2, 0, 11, 3, STRIPE_WHITE);
    cv.line(2, 3, 11, 0, STRIPE_WHITE);
    cv.set(6, 1, STRIPE_RED);
    // Lamp housing: two dark lenses (lit in the loop).
    cv.rect(1, 5, 11, 5, PAL.ink);
    cv.rect(2, 6, 3, 3, darker(PAL.red, 0.5));
    cv.rect(8, 6, 3, 3, darker(PAL.red, 0.5));
    scene.add({ art: cv, x: x - 6, y: y - MAST_RISE - 1, baseY: y });
    scene.footprint(x - 1, y - 1, 3, 2, 5);
  }
}

/** Screen position of a point on a boom arm `r` pixels from its pivot at angle `a` (0 down). */
function armPoint(px: number, py: number, dir: number, r: number, a: number): [number, number] {
  return [px + dir * r * Math.cos(a), py - TILT * (POST_RISE - 2 + r * Math.sin(a))];
}

function drawBoom(cv: Canvas, ox: number, oy: number, h: Crossing, angle: number): void {
  const len = Math.abs(h.b.x - h.a.x) / 2 - 3;
  for (const [p, dir] of [
    [h.a, 1],
    [h.b, -1],
  ] as const) {
    for (let r = -5; r <= len; r += 0.5) {
      const [sx, sy] = armPoint(p.x, p.y, dir, r, angle);
      const x = Math.round(sx) - ox;
      const y = Math.round(sy) - oy;
      if (r < 0) {
        // Counterweight behind the pivot.
        cv.rect(x - 1, y - 1, 3, 3, PAL.steelDark);
        continue;
      }
      // A box-section arm: lit top edge, the striped face, a dark underside; three pixels
      // across whichever way it points, so it reads raised or lowered.
      const stripe = (Math.floor(r / 7) & 1) === 0;
      const face = stripe ? STRIPE_RED : STRIPE_WHITE;
      const vertical = Math.sin(angle) > 0.7;
      if (vertical) {
        cv.set(x - 1, y, stripe ? lighter(STRIPE_RED, 0.2) : PAL.ivory);
        cv.set(x, y, face);
        cv.set(x + 1, y, darker(face, 0.3));
        cv.set(x + 2, y, PAL.ink);
      } else {
        cv.set(x, y - 2, PAL.ink);
        cv.set(x, y - 1, stripe ? lighter(STRIPE_RED, 0.2) : PAL.ivory);
        cv.set(x, y, face);
        cv.set(x, y + 1, darker(face, 0.3));
        cv.set(x, y + 2, PAL.ink);
      }
    }
  }
}

/**
 * The crossing as one timetable loop: the lights blink through warning and active, the boom
 * lowers during the warning, is down for the whole active phase (it is solid then) and rises
 * after. The box covers both posts, both masts and the boom in every position.
 */
export function crossingLoop(world: Canvas, h: Crossing, boomUpBackground: Canvas): AnimatedArt {
  const len = Math.abs(h.b.x - h.a.x) / 2 - 3;
  const xs = [h.a.x, h.b.x, ...h.lights.map((l) => l.x)];
  const ys = [h.a.y, h.b.y, ...h.lights.map((l) => l.y)];
  const x0 = Math.floor(Math.min(...xs)) - 8;
  const x1 = Math.ceil(Math.max(...xs)) + 8;
  const y0 = Math.floor(Math.min(...ys) - TILT * (POST_RISE + len)) - 6;
  const y1 = Math.ceil(Math.max(...ys)) + 2;
  void world;
  const LOWER = 1.0;
  const RAISE = 0.9;
  const up = Math.PI / 2;
  const angleAt = (st: TimetableState): number => {
    // Down for every frame that touches the active phase: the boom is never shown open
    // while the barrier is solid.
    if (st.touchesActive) return 0;
    if (st.phase === 'warning') {
      const left = h.schedule.warnSeconds - st.since;
      if (left > LOWER) return up;
      return up * Math.max(0, (left - 0.2) / (LOWER - 0.2));
    }
    // Rising again just after the active phase.
    if (st.since < RAISE) return up * (st.since / RAISE);
    return up;
  };
  return timetableLoop({
    id: 'tram_crossing',
    hazardId: h.id,
    schedule: h.schedule,
    fps: 5,
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    above: false,
    blend: 'normal',
    base: boomUpBackground,
    draw: (cv, st) => {
      drawBoom(cv, x0, y0, h, angleAt(st));
      if (st.phase !== 'idle') {
        const on = Math.floor(st.time * 2.5) % 2 === 0;
        for (const l of h.lights) {
          const lx = Math.round(l.x) - 6 - x0;
          const ly = Math.round(l.y) - MAST_RISE - 1 - y0;
          const lit = (left: boolean): void => {
            const bx = lx + (left ? 2 : 8);
            cv.rect(bx, ly + 6, 3, 3, PAL.red);
            cv.set(bx, ly + 6, PAL.coralHi);
            // A hard glow ring round a lit lens.
            for (const [dx, dy] of [
              [-1, 1],
              [3, 1],
              [1, -1],
              [1, 3],
            ] as const)
              cv.set(bx + dx, ly + 6 + dy, mixRed(cv.get(bx + dx, ly + 6 + dy)));
          };
          lit(on);
        }
      }
    },
  });
}

function mixRed(c: Color): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (
    (Math.min(255, Math.round(r * 0.5 + 120)) << 16) |
    (Math.round(g * 0.55) << 8) |
    Math.round(b * 0.55)
  );
}

/** Bakes the boom in its raised position into the world, after lighting. */
export function bakeBoomUp(world: Canvas, h: Crossing): void {
  const prev = world.curFlags;
  world.curFlags = 0;
  drawBoom(world, 0, 0, h, Math.PI / 2);
  world.curFlags = prev;
  void emissive;
}
