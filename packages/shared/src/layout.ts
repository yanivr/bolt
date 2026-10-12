import { hazardState } from './hazards.js';
import type { TrackRuntime } from './track.js';
import { shapeOutline } from './trackShapes.js';
import type { SurfaceId, TrackHazard } from './types.js';

/**
 * The layout view: a track drawn from its data alone, as flat shapes. It is what the race
 * shows on a track whose terrain art is not baked yet (clearly labelled), what the track
 * preview's map and the minimap are drawn from without art, and what the review tool writes.
 * It is not art: flat ground colors per surface, road edges, curbs, checkpoints, obstacles,
 * walls and hazards as simple shapes. The same list of primitives feeds a canvas in the
 * browser and the software rasterizer of `layoutRaster.ts` in Node, so both show one picture.
 */

export type LayoutPrimitive =
  | { t: 'poly'; points: number[]; fill: string }
  | { t: 'line'; points: number[]; width: number; color: string; closed?: boolean }
  | { t: 'circle'; x: number; y: number; r: number; fill: string };

export const LAYOUT_SURFACE_COLORS: Record<SurfaceId, string> = {
  asphalt: '#4b505e',
  cobble: '#8c7a66',
  sand: '#d6b46e',
  dirt: '#93704a',
  mud: '#5e4632',
  snow: '#e6edf5',
  ice: '#a6d8f0',
  metal: '#7c90a4',
};

/** Ground off the road on an open track: the surface's color, darker. */
const OFFROAD_SHADE = 0.72;
const SHOULDER_SHADE = 0.86;

export const LAYOUT_COLORS = {
  solid: '#1a1f2c',
  wall: '#2a2e38',
  wallEdge: '#0d1018',
  edgeLine: '#f2efe6',
  centerLine: '#f6c35b',
  checkpoint: '#ffffff',
  start: '#f46b58',
  sign: '#ffd23f',
  oil: '#14161b',
  steam: '#e9f2ff',
  magnetic: '#3d7bff',
  crosswind: '#ffffff',
  deepMud: '#3b2a1b',
  crossing: '#e8433a',
  rail: '#3a3f48',
  anchor: '#ff6fd8',
  obstacle: {
    tree: '#2e6a3a',
    rock: '#7b6c5c',
    bollard: '#d4d4d4',
    crate: '#a2733d',
    pillar: '#6c717c',
    log: '#7a5534',
    barrel: '#c0392b',
    other: '#9a9a9a',
  } as Record<string, string>,
} as const;

export function shade(color: string, factor: number): string {
  const n = parseInt(color.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((1 << 24) | (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b)).toString(16).slice(1)}`;
}

function obstacleColor(kind: string): string {
  return LAYOUT_COLORS.obstacle[kind] ?? LAYOUT_COLORS.obstacle['other']!;
}

function hazardFill(h: TrackHazard): string {
  switch (h.kind) {
    case 'oil':
      return LAYOUT_COLORS.oil;
    case 'steam_vent':
      return LAYOUT_COLORS.steam;
    case 'magnetic_strip':
      return LAYOUT_COLORS.magnetic;
    case 'crosswind':
      return LAYOUT_COLORS.crosswind;
    case 'deep_mud':
      return LAYOUT_COLORS.deepMud;
    case 'crossing':
      return LAYOUT_COLORS.crossing;
  }
}

export type LayoutOptions = {
  /** Race clock in ticks, for timed hazards (a closed crossing is drawn closed). */
  clockTicks?: number;
  checkpoints?: boolean;
  signs?: boolean;
  anchors?: boolean;
};

/** Every primitive of the layout view, in drawing order. */
export function layoutPrimitives(track: TrackRuntime, opts: LayoutOptions = {}): LayoutPrimitive[] {
  const { def } = track;
  const out: LayoutPrimitive[] = [];
  const W = def.worldWidth;
  const H = def.worldHeight;
  const ground = track.walled
    ? LAYOUT_COLORS.solid
    : shade(LAYOUT_SURFACE_COLORS[def.offroadSurface], OFFROAD_SHADE);
  out.push({ t: 'poly', points: [0, 0, W, 0, W, H, 0, H], fill: ground });

  // Road: shoulders first, then the pavement, one quad per centerline segment.
  for (const pass of ['shoulder', 'paved'] as const) {
    for (const b of track.branches) {
      const links = b.closed ? b.count : b.count - 1;
      for (let i = 0; i < links; i++) {
        const j = (i + 1) % b.count;
        const wi = pass === 'paved' ? b.halfWidth[i]! : b.halfWidth[i]! + b.shoulder[i]!;
        const wj = pass === 'paved' ? b.halfWidth[j]! : b.halfWidth[j]! + b.shoulder[j]!;
        if (pass === 'shoulder' && b.shoulder[i]! <= 0 && b.shoulder[j]! <= 0) continue;
        const fill =
          pass === 'paved'
            ? LAYOUT_SURFACE_COLORS[b.surface[i]!]
            : shade(LAYOUT_SURFACE_COLORS[b.shoulderSurface], SHOULDER_SHADE);
        // Quads overlap their neighbours by a pixel so no seam shows.
        const ex = b.tx[i]! * 0.6;
        const ey = b.ty[i]! * 0.6;
        out.push({
          t: 'poly',
          points: [
            b.x[i]! + b.ty[i]! * wi - ex,
            b.y[i]! - b.tx[i]! * wi - ey,
            b.x[j]! + b.ty[j]! * wj + ex,
            b.y[j]! - b.tx[j]! * wj + ey,
            b.x[j]! - b.ty[j]! * wj + ex,
            b.y[j]! + b.tx[j]! * wj + ey,
            b.x[i]! - b.ty[i]! * wi - ex,
            b.y[i]! + b.tx[i]! * wi - ey,
          ],
          fill,
        });
      }
    }
  }

  // Surface zones over road and ground alike, as the simulation sees them.
  for (const zone of def.surfaceZones) {
    const pts = shapeOutline(zone.shape, track.branches);
    out.push({
      t: 'poly',
      points: pts.flatMap((p) => [p.x, p.y]),
      fill: LAYOUT_SURFACE_COLORS[zone.surface],
    });
  }

  // Edge lines and the dashed centre of the main line.
  for (const b of track.branches) {
    for (const side of [-1, 1]) {
      const pts: number[] = [];
      for (let i = 0; i < b.count; i++) {
        const w = b.halfWidth[i]! * side;
        pts.push(b.x[i]! - b.ty[i]! * w, b.y[i]! + b.tx[i]! * w);
      }
      out.push({
        t: 'line',
        points: pts,
        width: 2,
        color: LAYOUT_COLORS.edgeLine,
        closed: b.closed,
      });
    }
  }
  const main = track.main;
  for (let i = 0; i + 2 < main.count; i += 6) {
    out.push({
      t: 'line',
      points: [main.x[i]!, main.y[i]!, main.x[i + 2]!, main.y[i + 2]!],
      width: 2,
      color: LAYOUT_COLORS.centerLine,
    });
  }

  // Area hazards: an outline in the hazard's color and a translucent wash.
  def.hazards.forEach((h) => {
    if (h.kind === 'crossing') return;
    const pts = shapeOutline(h.shape, track.branches).flatMap((p) => [p.x, p.y]);
    out.push({ t: 'poly', points: pts, fill: `${hazardFill(h)}88` });
    out.push({ t: 'line', points: pts, width: 3, color: hazardFill(h), closed: true });
  });

  for (const wall of def.walls) {
    const pts = wall.points.flatMap((p) => [p.x, p.y]);
    out.push({
      t: 'line',
      points: pts,
      width: wall.thickness + 4,
      color: LAYOUT_COLORS.wallEdge,
      closed: wall.closed,
    });
    out.push({
      t: 'line',
      points: pts,
      width: wall.thickness,
      color: LAYOUT_COLORS.wall,
      closed: wall.closed,
    });
  }
  for (const ob of def.obstacles) {
    out.push({ t: 'circle', x: ob.x, y: ob.y, r: ob.radius + 1.5, fill: LAYOUT_COLORS.wallEdge });
    out.push({ t: 'circle', x: ob.x, y: ob.y, r: ob.radius, fill: obstacleColor(ob.kind) });
  }

  // Crossings: rails across the road, and the barrier when it is down.
  def.hazards.forEach((h) => {
    if (h.kind !== 'crossing') return;
    out.push({
      t: 'line',
      points: h.railPath.flatMap((p) => [p.x, p.y]),
      width: 10,
      color: LAYOUT_COLORS.rail,
    });
    const state = hazardState(h, opts.clockTicks ?? 0);
    const color = state.phase === 'idle' ? '#7d828c' : LAYOUT_COLORS.crossing;
    if (state.phase === 'active')
      out.push({ t: 'line', points: [h.a.x, h.a.y, h.b.x, h.b.y], width: h.thickness, color });
    for (const l of h.lights) out.push({ t: 'circle', x: l.x, y: l.y, r: 6, fill: color });
  });

  if (opts.checkpoints !== false) {
    for (const cp of track.checkpoints) {
      for (const g of cp.gates) {
        out.push({
          t: 'line',
          points: [g.ax, g.ay, g.bx, g.by],
          width: cp.index === 0 ? 6 : 2,
          color: cp.index === 0 ? LAYOUT_COLORS.start : `${LAYOUT_COLORS.checkpoint}99`,
        });
      }
    }
  }
  if (opts.signs !== false) {
    for (const sign of track.cornerSigns) {
      const r = 6 + sign.severity * 3;
      out.push({
        t: 'poly',
        points: [sign.x, sign.y - r, sign.x + r, sign.y + r, sign.x - r, sign.y + r],
        fill: LAYOUT_COLORS.sign,
      });
    }
  }
  if (opts.anchors) {
    for (const a of def.anchors) {
      if (a.points.length > 1)
        out.push({
          t: 'line',
          points: a.points.flatMap((p) => [p.x, p.y]),
          width: 3,
          color: LAYOUT_COLORS.anchor,
        });
      else if (a.points[0])
        out.push({
          t: 'circle',
          x: a.points[0].x,
          y: a.points[0].y,
          r: 7,
          fill: LAYOUT_COLORS.anchor,
        });
    }
  }
  return out;
}
