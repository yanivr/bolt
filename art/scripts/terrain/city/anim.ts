import { sampleBranch } from '@bolt/shared';
import type { AnimatedArt, BakeContext } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { LightPool } from '../lighting.js';
import { drawMarquee, drawTowerHub, drawTowerRings } from './landmarks.js';
import type { LandmarkSites } from './landmarks.js';
import type { CityLayout, Lot, Rect } from './layout.js';
import { NEON, drawNeonSign, neonSignSize } from './neon.js';
import type { NeonSignSpec } from './neon.js';
import { PAL, contactShade } from './palette.js';
import type { TerrainLight } from '@bolt/shared';

/**
 * Looping ambient animation. Frame 0 of every strip is exactly what is baked into the ground
 * (or, for the signals, stamped onto it after lighting), so a prop that never animates still
 * looks right.
 */

export type FeatureSign = {
  id: string;
  kind: string;
  lot: Lot;
  x: number;
  y: number;
  spec: NeonSignSpec;
  masks: number[];
  fps: number;
};

const ALL = 0xffffffff;

function pickLot(
  layout: CityLayout,
  tx: number,
  ty: number,
  minW: number,
  minH: number,
  used: ReadonlySet<number>,
): Lot | null {
  let best: Lot | null = null;
  let bestD = Infinity;
  for (const lot of layout.lots) {
    if (!lot || lot.tag || lot.cut || used.has(lot.id)) continue;
    if (lot.w < minW || lot.h < minH || lot.visible < lot.w * lot.h || lot.height >= 15) continue;
    const d = Math.hypot(lot.x + lot.w / 2 - tx, lot.y + lot.h / 2 - ty);
    if (d < bestD) {
      bestD = d;
      best = lot;
    }
  }
  return best;
}

/** Chooses roofs for the two animated signs and draws their baked state. */
export function placeFeatureSigns(
  ctx: BakeContext,
  layout: CityLayout,
  taken: Map<number, Rect>,
  pools: LightPool[],
  lights: TerrainLight[],
): FeatureSign[] {
  const out: FeatureSign[] = [];
  const used = new Set<number>();
  const want: Array<{
    id: string;
    kind: string;
    tx: number;
    ty: number;
    spec: NeonSignSpec;
    masks: number[];
    fps: number;
  }> = [
    {
      id: 'neon_flicker',
      kind: 'neon_sign_flicker',
      tx: 1330,
      ty: 590,
      spec: { text: 'KIBO', color: 0, accent: 1, scale: 2, glyph: 0 },
      // Steady, then the second tube drops out, then a full brown-out.
      masks: [ALL, ALL, ALL & ~0b0010, ALL, 0x40000000, ALL],
      fps: 8,
    },
    {
      id: 'neon_chase',
      kind: 'neon_sign_chase',
      tx: 2640,
      ty: 800,
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
  for (const wsh of want) {
    const size = neonSignSize(wsh.spec);
    const lot = pickLot(layout, wsh.tx, wsh.ty, size.w + 14, size.h + 14, used);
    if (!lot) continue;
    used.add(lot.id);
    const x = lot.x + ((lot.w - size.w) >> 1);
    const y = lot.y + ((lot.h - size.h) >> 1);
    ctx.world.clipMap = layout.roofId;
    ctx.world.clipId = lot.id;
    drawNeonSign(ctx.world, x, y, wsh.spec);
    ctx.world.clipMap = null;
    taken.set(lot.id, { x, y, w: size.w, h: size.h });
    const nc = NEON[wsh.spec.color]!;
    pools.push({
      x: x + size.w / 2,
      y: y + size.h / 2,
      radii: [size.w * 0.5 + 4, size.w * 0.5 + 12],
      tint: nc.tint,
      level: lot.id,
      squashY: 1.5,
    });
    pools.push({ x: x + size.w / 2, y: y + size.h / 2, radii: [44, 64], tint: nc.tint, level: 0 });
    lights.push({
      x: Math.round(x + size.w / 2),
      y: Math.round(y + size.h / 2),
      radius: 64,
      color: nc.hex,
      intensity: 0.7,
    });
    out.push({
      id: wsh.id,
      kind: wsh.kind,
      lot,
      x,
      y,
      spec: wsh.spec,
      masks: wsh.masks,
      fps: wsh.fps,
    });
  }
  return out;
}

export type SignalSite = { x: number; y: number };

/** Signal heads flank the Market Street crossing, on poles at the back of the sidewalk. */
export function signalSites(ctx: BakeContext, zebraS: number): SignalSite[] {
  const p = sampleBranch(ctx.track.main, zebraS - 14);
  const out: SignalSite[] = [];
  for (const side of [-1, 1]) {
    const lat = side * (p.halfWidth + p.shoulder - 6);
    out.push({ x: Math.round(p.x - p.ty * lat) - 3, y: Math.round(p.y + p.tx * lat) - 8 });
  }
  return out;
}

const SIGNAL_DIM: readonly Color[] = [0x4a1f2a, 0x5a4424, 0x1d4a3c];
const SIGNAL_LIT: readonly Color[] = [PAL.red, PAL.amber, PAL.mint];
const SIGNAL_HOT: readonly Color[] = [PAL.coralHi, PAL.goldHi, 0xd4ffe9];

/** `lit` is a bit mask: 1 red, 2 amber, 4 green. */
export function drawSignal(cv: Canvas, x: number, y: number, lit: number): void {
  cv.rect(x, y, 7, 16, PAL.ink);
  cv.hline(x, y, 7, PAL.steel);
  cv.vline(x, y, 16, PAL.steelDark);
  for (let k = 0; k < 3; k++) {
    const on = (lit & (1 << k)) !== 0;
    cv.rect(x + 2, y + 2 + k * 4 + (k > 0 ? 1 : 0), 3, 3, on ? SIGNAL_LIT[k]! : SIGNAL_DIM[k]!);
    if (on) cv.set(x + 2, y + 2 + k * 4 + (k > 0 ? 1 : 0), SIGNAL_HOT[k]!);
  }
}

/** Stamps the baked signal state after lighting, with a contact shadow for the pole. */
export function stampSignals(ctx: BakeContext, sites: readonly SignalSite[]): void {
  for (const s of sites) {
    for (let k = 1; k <= 3; k++)
      for (let j = 0; j < 16; j++) ctx.world.map(s.x + 6 + k, s.y + j + k, contactShade);
    drawSignal(ctx.world, s.x, s.y, 4);
  }
}

export function buildAnimated(
  sites: LandmarkSites,
  signs: readonly FeatureSign[],
  signals: readonly SignalSite[],
): AnimatedArt[] {
  const out: AnimatedArt[] = [];
  for (const sign of signs) {
    const size = neonSignSize(sign.spec);
    const frames = sign.masks.map((mask) => {
      const cv = new Canvas(size.w, size.h);
      drawNeonSign(cv, 0, 0, sign.spec, mask, false);
      return cv;
    });
    out.push({
      id: sign.id,
      kind: sign.kind,
      frames,
      x: sign.x,
      y: sign.y,
      fps: sign.fps,
      above: false,
      blend: 'normal',
    });
  }
  // Aircraft beacon on the tower hub.
  const beacon = [2, 1, 0, 0, 1, 2].map((level) => {
    const cv = new Canvas(14, 14);
    drawTowerHub(cv, 7, 7, level);
    return cv;
  });
  out.push({
    id: 'tower_beacon',
    kind: 'aircraft_beacon',
    frames: beacon,
    x: sites.tower.x - 7,
    y: sites.tower.y - 7,
    fps: 4,
    above: false,
    blend: 'normal',
  });
  // Tower rings pulsing outward.
  const ringStates: Array<[number, number, number]> = [
    [1, 1, 1],
    [1, 1, 2],
    [1, 2, 1],
    [2, 1, 1],
    [2, 2, 2],
    [1, 1, 1],
  ];
  const rings = ringStates.map((state) => {
    const cv = new Canvas(64, 64);
    drawTowerRings(cv, 32, 32, state);
    return cv;
  });
  out.push({
    id: 'tower_rings',
    kind: 'neon_rings',
    frames: rings,
    x: sites.tower.x - 32,
    y: sites.tower.y - 32,
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
      const cv = new Canvas(7, 16);
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
      above: true,
      blend: 'normal',
    });
  });
  return out;
}
