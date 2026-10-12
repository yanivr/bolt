import type {
  BiomeId,
  HazardSchedule,
  ShortcutDefinition,
  SurfaceId,
  SurfaceZone,
  TrackAnchor,
  TrackBranch,
  TrackControlPoint,
  TrackDefinition,
  TrackHazard,
  TrackObstacle,
  TrackPoint,
  TrackProp,
  TrackShape,
  TrackWall,
} from '@bolt/shared';
import {
  TRACK_FORMAT_VERSION,
  branchPointAt,
  mulberry32,
  nearestOnBranch,
  routeBranches,
} from '@bolt/shared';

/**
 * Authoring kit for format-2 tracks (docs/TRACK_API.md, "How to add a track"). A track is
 * written as a loop of corners: each corner a point, the radius of its bend and the road's
 * width there; straights between corners are kept exactly straight (decision 11). Positions
 * and radii are written in design units and multiplied by one `scale`, which is how a track's
 * length is tuned in the simulator without redrawing it; widths, clearances and radii of
 * obstacles are world pixels and do not scale. Everything placed beside the road (walls, trees,
 * zones, hazards, anchors) is placed against the road's real centerline, so it stays where it
 * belongs when the scale changes.
 */

export type Corner = {
  x: number;
  y: number;
  /** Bend radius at this corner, design units. 0 is a sharp vertex (only for path ends). */
  r: number;
  /** Paved width, world px, at this corner. */
  w: number;
  /** Surface from this corner on, until a later corner names another. */
  s?: SurfaceId;
  /** Shoulder from this corner on. */
  sh?: number;
};

export const corner = (
  x: number,
  y: number,
  r: number,
  w: number,
  s?: SurfaceId,
  sh?: number,
): Corner => ({
  x,
  y,
  r,
  w,
  ...(s ? { s } : {}),
  ...(sh !== undefined ? { sh } : {}),
});

/** Points along a rounded polyline: arcs every 12 degrees, straights pinned straight. */
export function roundedPath(
  corners: readonly Corner[],
  closed: boolean,
  scale: number,
  defaults: { surface: SurfaceId; shoulder: number },
  label: string,
): TrackControlPoint[] {
  const n = corners.length;
  const P = corners.map((c) => ({ ...c, x: c.x * scale, y: c.y * scale, r: c.r * scale }));
  type Arc = { t1: TrackPoint; t2: TrackPoint; pts: TrackPoint[] };
  const arcs: Arc[] = [];
  for (let i = 0; i < n; i++) {
    const v = P[i]!;
    const isEnd = !closed && (i === 0 || i === n - 1);
    const prev = P[(i - 1 + n) % n]!;
    const next = P[(i + 1) % n]!;
    if (isEnd || v.r <= 0) {
      arcs.push({ t1: { x: v.x, y: v.y }, t2: { x: v.x, y: v.y }, pts: [{ x: v.x, y: v.y }] });
      continue;
    }
    let d1x = v.x - prev.x;
    let d1y = v.y - prev.y;
    let d2x = next.x - v.x;
    let d2y = next.y - v.y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    d1x /= l1;
    d1y /= l1;
    d2x /= l2;
    d2y /= l2;
    const cross = d1x * d2y - d1y * d2x;
    const dot = d1x * d2x + d1y * d2y;
    const phi = Math.atan2(Math.abs(cross), dot);
    if (phi < 1e-3) {
      arcs.push({ t1: { x: v.x, y: v.y }, t2: { x: v.x, y: v.y }, pts: [{ x: v.x, y: v.y }] });
      continue;
    }
    const L = v.r * Math.tan(phi / 2);
    const t1 = { x: v.x - d1x * L, y: v.y - d1y * L };
    const t2 = { x: v.x + d2x * L, y: v.y + d2y * L };
    // Centre on the inside of the turn.
    const side = cross > 0 ? 1 : -1;
    const cx = t1.x + -d1y * v.r * side;
    const cy = t1.y + d1x * v.r * side;
    const a0 = Math.atan2(t1.y - cy, t1.x - cx);
    const steps = Math.max(2, Math.ceil(phi / ((12 * Math.PI) / 180)));
    const pts: TrackPoint[] = [];
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * phi * (k / steps);
      pts.push({ x: cx + Math.cos(a) * v.r, y: cy + Math.sin(a) * v.r });
    }
    arcs.push({ t1, t2, pts });
  }
  // Check that every straight has room for the bends at both of its ends.
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = arcs[i]!;
    const b = arcs[(i + 1) % n]!;
    const a2 = a.t2;
    const b1 = b.t1;
    const ex = P[(i + 1) % n]!.x - P[i]!.x;
    const ey = P[(i + 1) % n]!.y - P[i]!.y;
    if ((b1.x - a2.x) * ex + (b1.y - a2.y) * ey < -1e-6)
      throw new Error(`${label}: corners ${i} and ${(i + 1) % n} overlap; shrink their radii`);
  }
  const out: TrackControlPoint[] = [];
  let surface = defaults.surface;
  let shoulder = defaults.shoulder;
  for (let i = 0; i < n; i++) {
    const v = P[i]!;
    if (v.s) surface = v.s;
    if (v.sh !== undefined) shoulder = v.sh;
    const arc = arcs[i]!;
    for (const p of arc.pts) out.push({ x: p.x, y: p.y, width: v.w, surface, shoulder });
    if (!closed && i === n - 1) break;
    const next = P[(i + 1) % n]!;
    const nextArc = arcs[(i + 1) % n]!;
    const ax = arc.t2.x;
    const ay = arc.t2.y;
    const bx = nextArc.t1.x;
    const by = nextArc.t1.y;
    const len = Math.hypot(bx - ax, by - ay);
    // Two interior points keep the straight straight between its neighbours.
    if (len > 60) {
      for (const f of [1 / 3, 2 / 3]) {
        out.push({
          x: ax + (bx - ax) * f,
          y: ay + (by - ay) * f,
          width: v.w + (next.w - v.w) * f,
          surface,
          shoulder,
        });
      }
    }
  }
  return out;
}

export type ShortcutSpec = {
  id: string;
  signName: string;
  risk: string;
  surface: SurfaceId;
  shoulder: number;
  shoulderSurface: SurfaceId;
  /** Design points near where it leaves and rejoins the main line. */
  leave: TrackPoint;
  rejoin: TrackPoint;
  /** Its own corners between the two ends (the ends are snapped onto the main line). */
  corners: Corner[];
  gates?: number;
};

export type FeatureKit = {
  scale: number;
  /** Design to world. */
  T: (p: TrackPoint) => TrackPoint;
  branches: TrackBranch[];
  branch: (id: string) => TrackBranch;
  /** World point on a branch nearest a design point, moved along it and across it. */
  at: (branch: string, p: TrackPoint, lateral?: number, along?: number) => TrackPoint;
  /** Arc length on a branch nearest a design point. */
  sAt: (branch: string, p: TrackPoint) => number;
  band: (branch: string, from: TrackPoint, to: TrackPoint, lateral: [number, number]) => TrackShape;
  zone: (id: string, surface: SurfaceId, shape: TrackShape) => SurfaceZone;
  poly: (points: TrackPoint[]) => TrackShape;
  /** A circle round a world point (one from `at`, say). */
  circle: (p: TrackPoint, radius: number) => TrackShape;
  /** Points along a branch between two design points at a signed offset from its edge. */
  edge: (
    branch: string,
    from: TrackPoint,
    to: TrackPoint,
    side: -1 | 1,
    gap: number,
    step?: number,
  ) => TrackPoint[];
  wall: (
    id: string,
    kind: string,
    points: TrackPoint[],
    thickness?: number,
    closed?: boolean,
  ) => TrackWall;
  wallAlong: (
    id: string,
    kind: string,
    branch: string,
    from: TrackPoint,
    to: TrackPoint,
    side: -1 | 1,
    gap: number,
    thickness?: number,
  ) => TrackWall;
  /** Obstacles in a row beside the road, skipped where they would stand on any road. */
  rowAlong: (
    prefix: string,
    kind: string,
    branch: string,
    from: TrackPoint,
    to: TrackPoint,
    side: -1 | 1,
    gap: number,
    spacing: number,
    radius: number,
    seed: number,
    depth?: number,
  ) => TrackObstacle[];
  /** A single obstacle at a road-relative spot. */
  obstacle: (
    id: string,
    kind: string,
    p: TrackPoint,
    radius: number,
    telegraph?: string,
  ) => TrackObstacle;
  /** A rail crossing across a branch at the point nearest `p`. */
  crossing: (
    id: string,
    label: string,
    branch: string,
    p: TrackPoint,
    schedule: HazardSchedule,
    /** World px of rail drawn beyond the road on its left and right. */
    rails?: [number, number],
  ) => TrackHazard;
  anchor: (id: string, kind: string, points: TrackPoint[], tag?: string) => TrackAnchor;
  /** The four walls of the world, `inset` world px in: the edge of an open map. */
  boundary: (kind: string, inset?: number) => TrackWall;
  world: { width: number; height: number };
};

export type Features = Partial<{
  surfaceZones: SurfaceZone[];
  walls: TrackWall[];
  obstacles: TrackObstacle[];
  hazards: TrackHazard[];
  anchors: TrackAnchor[];
  props: TrackProp[];
}>;

export type TrackSpec = {
  id: string;
  name: string;
  biome: BiomeId;
  character: string;
  lengthClass: 'short' | 'long';
  laps?: number;
  edges: 'walled' | 'open';
  offroadSurface: SurfaceId;
  windExposure: number;
  weatherPresetIds: [string, string];
  surfaceMix: Partial<Record<SurfaceId, number>>;
  landmarks: string[];
  /** Design units to world px. */
  scale: number;
  /** World px of ground around the farthest road, on every side. */
  margin: number;
  main: { surface: SurfaceId; shoulder: number; shoulderSurface: SurfaceId; corners: Corner[] };
  shortcuts: ShortcutSpec[];
  start: TrackPoint;
  checkpointCount: number;
  features: (kit: FeatureKit) => Features;
};

function offsetPoint(b: TrackBranch, s: number, lateral: number): TrackPoint {
  const p = branchPointAt(b, s);
  return { x: p.x - p.ty * lateral, y: p.y + p.tx * lateral };
}

/** Builds a format-2 track definition from a spec. Deterministic: same spec, same track. */
export function defineTrack(spec: TrackSpec): TrackDefinition {
  const S = spec.scale;
  const pts = [...spec.main.corners, ...spec.shortcuts.flatMap((sc) => sc.corners)];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x * S - p.w);
    minY = Math.min(minY, p.y * S - p.w);
    maxX = Math.max(maxX, p.x * S + p.w);
    maxY = Math.max(maxY, p.y * S + p.w);
  }
  const ox = spec.margin - minX;
  const oy = spec.margin - minY;
  const width = Math.ceil((maxX - minX + spec.margin * 2) / 64) * 64;
  const height = Math.ceil((maxY - minY + spec.margin * 2) / 64) * 64;
  const T = (p: TrackPoint): TrackPoint => ({ x: p.x * S + ox, y: p.y * S + oy });
  const shift = (cps: TrackControlPoint[]): TrackControlPoint[] =>
    cps.map((c) => ({ ...c, x: c.x + ox, y: c.y + oy }));

  const main = {
    id: 'main',
    closed: true as const,
    surface: spec.main.surface,
    shoulder: spec.main.shoulder,
    shoulderSurface: spec.main.shoulderSurface,
    points: shift(roundedPath(spec.main.corners, true, S, spec.main, `${spec.id} main`)),
  };
  const shortcuts: ShortcutDefinition[] = spec.shortcuts.map((sc) => ({
    id: sc.id,
    closed: false as const,
    surface: sc.surface,
    shoulder: sc.shoulder,
    shoulderSurface: sc.shoulderSurface,
    leaveNear: T(sc.leave),
    rejoinNear: T(sc.rejoin),
    signName: sc.signName,
    risk: sc.risk,
    ...(sc.gates !== undefined ? { gates: sc.gates } : {}),
    points: shift(
      roundedPath(
        // The path's own ends are its first and last corners; give it straight lead-ins.
        sc.corners,
        false,
        S,
        sc,
        `${spec.id} ${sc.id}`,
      ),
    ),
  }));
  const branches = routeBranches({ id: spec.id, main, shortcuts });
  const branch = (id: string): TrackBranch => {
    const b = branches.find((x) => x.id === id);
    if (!b) throw new Error(`${spec.id}: no branch ${id}`);
    return b;
  };
  const sAt = (id: string, p: TrackPoint): number => {
    const w = T(p);
    return nearestOnBranch(branch(id), w.x, w.y);
  };
  const span = (b: TrackBranch, s0: number, s1: number): number =>
    s1 >= s0 ? s1 - s0 : b.closed ? b.length - s0 + s1 : 0;
  const road = (b: TrackBranch, s: number, side: number, gap: number): TrackPoint => {
    const intervals = b.closed ? b.count : b.count - 1;
    const step = b.length / intervals;
    let i = Math.round(s / step);
    if (b.closed) i = ((i % b.count) + b.count) % b.count;
    else i = Math.max(0, Math.min(b.count - 1, i));
    return offsetPoint(b, s, side * (b.halfWidth[i]! + b.shoulder[i]! + gap));
  };
  const clearOfRoad = (p: TrackPoint, radius: number): boolean => {
    for (const b of branches) {
      for (let i = 0; i < b.count; i++) {
        const d = Math.hypot(b.x[i]! - p.x, b.y[i]! - p.y);
        if (d < b.halfWidth[i]! + b.shoulder[i]! + radius + 4) return false;
      }
    }
    return true;
  };

  const kit: FeatureKit = {
    scale: S,
    T,
    branches,
    branch,
    world: { width, height },
    sAt,
    at: (id, p, lateral = 0, along = 0) => offsetPoint(branch(id), sAt(id, p) + along, lateral),
    band: (id, from, to, lateral) => ({
      type: 'band',
      branch: id,
      from: T(from),
      to: T(to),
      lateral,
    }),
    zone: (id, surface, shape) => ({ id, surface, shape }),
    poly: (points) => ({ type: 'polygon', points: points.map(T) }),
    circle: (p, radius) => ({ type: 'circle', x: p.x, y: p.y, radius }),
    edge: (id, from, to, side, gap, step = 24) => {
      const b = branch(id);
      const s0 = sAt(id, from);
      const len = span(b, s0, sAt(id, to));
      const out: TrackPoint[] = [];
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) out.push(road(b, s0 + (len * k) / n, side, gap));
      return out;
    },
    wall: (id, kind, points, thickness = 16, closed = false) => ({
      id,
      kind,
      points,
      thickness,
      ...(closed ? { closed } : {}),
    }),
    wallAlong: (id, kind, br, from, to, side, gap, thickness = 16) => ({
      id,
      kind,
      thickness,
      points: kit.edge(br, from, to, side, gap + thickness / 2),
    }),
    rowAlong: (prefix, kind, br, from, to, side, gap, spacing, radius, seed, depth = 0) => {
      const b = branch(br);
      const rng = mulberry32(seed);
      const s0 = sAt(br, from);
      const len = span(b, s0, sAt(br, to));
      const out: TrackObstacle[] = [];
      for (let d = 0; d <= len; d += spacing) {
        const jitterAlong = (rng() - 0.5) * spacing * 0.5;
        const jitterOut = rng() * depth;
        const p = road(b, s0 + d + jitterAlong, side, gap + radius + jitterOut);
        const ob = {
          id: `${prefix}_${out.length + 1}`,
          kind,
          x: Math.round(p.x),
          y: Math.round(p.y),
          radius,
        };
        if (clearOfRoad(ob, radius)) out.push(ob);
      }
      return out;
    },
    obstacle: (id, kind, p, radius, telegraph) => ({
      id,
      kind,
      x: Math.round(p.x),
      y: Math.round(p.y),
      radius,
      ...(telegraph ? { telegraph } : {}),
    }),
    crossing: (id, label, br, p, schedule, rails = [400, 400]) => {
      const b = branch(br);
      const s = sAt(br, p);
      const c = branchPointAt(b, s);
      const intervals = b.closed ? b.count : b.count - 1;
      const i = Math.round(s / (b.length / intervals)) % b.count;
      const reach = b.halfWidth[i]! + b.shoulder[i]! + 4;
      const nx = -c.ty;
      const ny = c.tx;
      const a = { x: c.x - nx * reach, y: c.y - ny * reach };
      const bb = { x: c.x + nx * reach, y: c.y + ny * reach };
      return {
        id,
        kind: 'crossing',
        label,
        a,
        b: bb,
        thickness: 12,
        schedule,
        lights: [
          { x: c.x - nx * (reach + 14) - c.tx * 18, y: c.y - ny * (reach + 14) - c.ty * 18 },
          { x: c.x + nx * (reach + 14) - c.tx * 18, y: c.y + ny * (reach + 14) - c.ty * 18 },
        ],
        railPath: [
          { x: c.x - nx * (reach + rails[0]), y: c.y - ny * (reach + rails[0]) },
          { x: c.x + nx * (reach + rails[1]), y: c.y + ny * (reach + rails[1]) },
        ],
      };
    },
    anchor: (id, kind, points, tag) => ({ id, kind, points, ...(tag ? { tag } : {}) }),
    boundary: (kind, inset = 60) => ({
      id: 'world_edge',
      kind,
      thickness: 24,
      closed: true,
      points: [
        { x: inset, y: inset },
        { x: width - inset, y: inset },
        { x: width - inset, y: height - inset },
        { x: inset, y: height - inset },
      ],
    }),
  };
  const features = spec.features(kit);

  return {
    formatVersion: TRACK_FORMAT_VERSION,
    id: spec.id,
    name: spec.name,
    biome: spec.biome,
    character: spec.character,
    lengthClass: spec.lengthClass,
    laps: spec.laps ?? 3,
    worldWidth: width,
    worldHeight: height,
    edges: spec.edges,
    offroadSurface: spec.offroadSurface,
    main,
    shortcuts,
    checkpointCount: spec.checkpointCount,
    startNear: T(spec.start),
    surfaceZones: features.surfaceZones ?? [],
    walls: features.walls ?? [],
    obstacles: features.obstacles ?? [],
    hazards: features.hazards ?? [],
    windExposure: spec.windExposure,
    anchors: features.anchors ?? [],
    cameraBounds: { x: 0, y: 0, w: width, h: height },
    props: features.props ?? [],
    landmarks: spec.landmarks,
    weatherPresetIds: spec.weatherPresetIds,
    surfaceMix: spec.surfaceMix,
  };
}
