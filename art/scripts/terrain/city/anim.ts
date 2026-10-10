import { sampleBranch } from '@bolt/shared';
import type { AnimatedArt, BakeContext } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { Scene } from '../oblique.js';
import { ROOF_HEAD } from './buildings.js';
import type { SignRequest } from './buildings.js';
import { RING_BOX_H, drawMarquee, drawTowerHub, drawTowerRings } from './landmarks.js';
import type { LandmarkSites } from './landmarks.js';
import type { CityLayout, Lot } from './layout.js';
import { drawNeonSign, neonSignSize } from './neon.js';
import type { NeonSignSpec } from './neon.js';
import { PAL } from './palette.js';

/**
 * Looping ambient animation. Frame 0 of every strip is exactly what is baked into the static
 * art underneath it, so a prop that never animates still looks right. The one exception is the
 * tower beacon, which exists only as a loop because it sits above an overlay.
 */

const ALL = 0xffffffff;

type FeatureWish = {
  id: string;
  kind: string;
  tx: number;
  ty: number;
  spec: NeonSignSpec;
  masks: number[];
  fps: number;
};

const FEATURES: readonly FeatureWish[] = [
  {
    id: 'neon_flicker',
    kind: 'neon_sign_flicker',
    tx: 1330,
    ty: 220,
    spec: { text: 'KIBO', color: 0, accent: 1, scale: 2, glyph: 0 },
    // Steady, then the second tube drops out, then a full brown-out.
    masks: [ALL, ALL, ALL & ~0b0010, ALL, 0x40000000, ALL],
    fps: 8,
  },
  {
    id: 'neon_chase',
    kind: 'neon_sign_chase',
    tx: 2640,
    ty: 820,
    spec: { text: 'NOODLE', color: 3, accent: 2, scale: 2, glyph: 4 },
    // Letters light one by one, then the bowl joins in.
    masks: [
      ALL,
      0x40000000,
      0x40000001,
      0x40000003,
      0x40000007,
      0x4000000f,
      0x4000001f,
      0x4000003f,
    ],
    fps: 6,
  },
];

export type FeatureSign = FeatureWish & { request: SignRequest };

/**
 * Chooses the roofs for the two animated signs: the nearest roomy roof on which the sign will
 * not be hidden by a taller building standing in front of it.
 */
export function planFeatureSigns(layout: CityLayout): FeatureSign[] {
  const out: FeatureSign[] = [];
  const used = new Set<number>();
  for (const wish of FEATURES) {
    const size = neonSignSize(wish.spec);
    let best: Lot | null = null;
    let bestD = Infinity;
    for (const lot of layout.lots) {
      if (!lot || lot.tag || used.has(lot.id)) continue;
      if (lot.w < size.w + 12 || lot.h < 16 || lot.floors > 2) continue;
      // Screen row of the foot of the sign.
      const foot = lot.y + Math.max(8, lot.h - 8) - lot.rise;
      let hidden = false;
      for (const other of layout.lots) {
        if (!other || other === lot) continue;
        if (other.x >= lot.x + lot.w || other.x + other.w <= lot.x) continue;
        if (other.y < lot.y + lot.h) continue;
        if (other.y - other.rise - ROOF_HEAD < foot + 2) hidden = true;
      }
      if (hidden) continue;
      const d = Math.hypot(lot.x + lot.w / 2 - wish.tx, lot.y + lot.h / 2 - wish.ty);
      if (d < bestD) {
        bestD = d;
        best = lot;
      }
    }
    if (!best) continue;
    used.add(best.id);
    out.push({ ...wish, request: { lot: best, spec: wish.spec, placed: null } });
  }
  return out;
}

export type SignalSite = { x: number; y: number };

const SIGNAL_W = 7;
const SIGNAL_H = 16;
const SIGNAL_POLE = 8;

const SIGNAL_DIM: readonly Color[] = [0x4a1f2a, 0x5a4424, 0x1d4a3c];
const SIGNAL_LIT: readonly Color[] = [PAL.red, PAL.amber, PAL.mint];
const SIGNAL_HOT: readonly Color[] = [PAL.coralHi, PAL.goldHi, 0xd4ffe9];

/** `lit` is a bit mask: 1 red, 2 amber, 4 green. */
export function drawSignal(cv: Canvas, x: number, y: number, lit: number): void {
  cv.rect(x, y, SIGNAL_W, SIGNAL_H, PAL.ink);
  cv.hline(x, y, SIGNAL_W, PAL.steel);
  cv.vline(x, y, SIGNAL_H, PAL.steelDark);
  for (let k = 0; k < 3; k++) {
    const on = (lit & (1 << k)) !== 0;
    cv.rect(x + 2, y + 2 + k * 4 + (k > 0 ? 1 : 0), 3, 3, on ? SIGNAL_LIT[k]! : SIGNAL_DIM[k]!);
    if (on) cv.set(x + 2, y + 2 + k * 4 + (k > 0 ? 1 : 0), SIGNAL_HOT[k]!);
  }
}

/**
 * Signal heads on poles either side of the Market Street crossing. They stand behind the
 * collision edge, as far back as it takes for the head to stay off the road.
 */
export function placeSignals(ctx: BakeContext, scene: Scene, zebraS: number): SignalSite[] {
  const p = sampleBranch(ctx.track.main, zebraS - 14);
  const out: SignalSite[] = [];
  for (const side of [-1, 1]) {
    const nx = -p.ty * side;
    const ny = p.tx * side;
    const cv = Canvas.sprite(SIGNAL_W, SIGNAL_H + SIGNAL_POLE);
    cv.vline(3, SIGNAL_H, SIGNAL_POLE, PAL.steelLight);
    cv.vline(4, SIGNAL_H, SIGNAL_POLE, PAL.steelDark);
    cv.hline(2, SIGNAL_H + SIGNAL_POLE - 1, 4, PAL.steelDark);
    drawSignal(cv, 0, 0, 4);
    for (let back = 3; back < 48; back++) {
      const gx = Math.round(p.x + nx * (p.halfWidth + p.shoulder + back));
      const gy = Math.round(p.y + ny * (p.halfWidth + p.shoulder + back));
      const sx = gx - 3;
      const sy = gy - cv.h + 1;
      if (!scene.artFits(cv, sx, sy)) continue;
      scene.add({ art: cv, x: sx, y: sy, baseY: gy + 6 });
      scene.footprint(gx - 1, gy - 1, 3, 2, 4);
      out.push({ x: sx, y: sy });
      break;
    }
  }
  return out;
}

export function buildAnimated(
  sites: LandmarkSites,
  signs: readonly FeatureSign[],
  signals: readonly SignalSite[],
): AnimatedArt[] {
  const out: AnimatedArt[] = [];
  for (const sign of signs) {
    const placed = sign.request.placed;
    if (!placed) continue;
    const frames = sign.masks.map((mask) => {
      const cv = new Canvas(placed.w, placed.h);
      drawNeonSign(cv, 0, 0, sign.spec, mask);
      return cv;
    });
    out.push({
      id: sign.id,
      kind: sign.kind,
      frames,
      x: placed.x,
      y: placed.y,
      fps: sign.fps,
      above: false,
      blend: 'normal',
    });
  }
  // Aircraft beacon on top of the mast: above the cars, like the overlay it sits on.
  const beacon = [2, 1, 0, 0, 1, 2].map((level) => {
    const cv = new Canvas(14, 14);
    drawTowerHub(cv, 7, 7, level);
    return cv;
  });
  out.push({
    id: 'tower_beacon',
    kind: 'aircraft_beacon',
    frames: beacon,
    x: sites.beacon.x,
    y: sites.beacon.y,
    fps: 4,
    above: true,
    blend: 'normal',
  });
  // Tower rings pulsing upward.
  const ringStates: Array<[number, number, number]> = [
    [1, 1, 1],
    [2, 1, 1],
    [1, 2, 1],
    [1, 1, 2],
    [2, 2, 2],
    [1, 1, 1],
  ];
  const rings = ringStates.map((state) => {
    const cv = new Canvas(50, RING_BOX_H);
    drawTowerRings(cv, 25, RING_BOX_H, state);
    return cv;
  });
  out.push({
    id: 'tower_rings',
    kind: 'neon_rings',
    frames: rings,
    x: sites.rings.x,
    y: sites.rings.y,
    fps: 6,
    above: false,
    blend: 'normal',
  });
  // Arcade marquee chase.
  const marquee = [0, 1, 2, 3].map((k) => {
    const cv = new Canvas(88, 14);
    drawMarquee(cv, 0, 0, k);
    return cv;
  });
  out.push({
    id: 'arcade_marquee',
    kind: 'marquee_bulbs',
    frames: marquee,
    x: sites.marquee.x,
    y: sites.marquee.y,
    fps: 8,
    above: false,
    blend: 'normal',
  });
  // Traffic signals: green, green, green, amber, red, red, red, red and amber.
  const cycle = [4, 4, 4, 2, 1, 1, 1, 3];
  signals.forEach((site, k) => {
    const frames = cycle.map((lit) => {
      const cv = new Canvas(SIGNAL_W, SIGNAL_H);
      drawSignal(cv, 0, 0, lit);
      return cv;
    });
    out.push({
      id: `traffic_light_${k === 0 ? 'north' : 'south'}`,
      kind: 'traffic_light',
      frames,
      x: site.x,
      y: site.y,
      fps: 1,
      above: false,
      blend: 'normal',
    });
  });
  return out;
}

/** Counts pixels where frame 0 of a ground-level loop differs from the baked picture. */
export function animatedMismatch(world: Canvas, art: readonly AnimatedArt[]): number {
  let bad = 0;
  for (const a of art) {
    if (a.above) continue;
    const f = a.frames[0];
    if (!f) continue;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (f.alpha(x, y) !== 255) continue;
        if (world.get(a.x + x, a.y + y) !== f.get(x, y)) bad++;
      }
    }
  }
  return bad;
}
