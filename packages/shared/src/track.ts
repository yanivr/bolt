import {
  OPEN_GATE_REACH,
  SHORTCUT_MIN_GATES,
  SHORTCUT_MIN_GATES_WALLED,
  TRACK_HAZARD,
  WRONG_WAY_SECONDS,
} from './balance.js';
import type { Ground } from './hazards.js';
import { applyAreaHazard, createGround, hazardActive } from './hazards.js';
import {
  clamp,
  headingForwardX,
  headingForwardY,
  headingFromVector,
  lerp,
  segmentIntersection,
} from './math.js';
import type { CornerSign } from './trackSigns.js';
import { placeCornerSigns } from './trackSigns.js';
import type { ResolvedBand } from './trackShapes.js';
import {
  bandSpan,
  branchPointAt,
  resolveBand,
  segmentDistance,
  shapeTester,
} from './trackShapes.js';
import type {
  SurfaceId,
  TrackBranchDefinition,
  TrackControlPoint,
  TrackDefinition,
  TrackHazard,
  TrackObstacle,
  TrackShape,
  VehicleProgressState,
} from './types.js';
import { SURFACE_IDS } from './types.js';

/**
 * Runtime track model. Built once from an authored TrackDefinition and then queried by the
 * integrator, the checkpoint logic, the AI, the terrain baker and the minimap. Everything here
 * is pure and deterministic so the server and the predicting client agree.
 *
 * A track is a union of corridors. Each corridor follows a sampled centerline and carries a
 * paved half-width plus a drivable shoulder. On a walled track (format 1, and the city)
 * anything beyond the shoulder is solid. On an open track it is off-road ground, and what is
 * solid is listed: walls, obstacles and a crossing's barrier while it is down. Track format 2
 * adds surface zones and area hazards, baked into a grid of `TRACK_HAZARD.zoneCell` pixels,
 * checkpoints that make every shortcut earn its credit, and corner signs. docs/TRACK_API.md.
 */

export const TRACK_SAMPLE_SPACING = 10;
const GRID_CELL = 96;
const GATE_MARGIN = 10;

export type TrackBranch = {
  id: string;
  index: number;
  closed: boolean;
  /** Number of samples. For closed branches sample `count` wraps onto sample 0. */
  count: number;
  length: number;
  x: Float64Array;
  y: Float64Array;
  /** Unit tangent pointing in the direction of travel. */
  tx: Float64Array;
  ty: Float64Array;
  halfWidth: Float64Array;
  shoulder: Float64Array;
  /** Arc length from the first sample. */
  s: Float64Array;
  /** Signed curvature, positive when the road bends right. */
  curvature: Float64Array;
  surface: SurfaceId[];
  shoulderSurface: SurfaceId;
  /** For shortcuts: the main-line arc lengths this branch leaves from and rejoins at. */
  leaveS: number;
  rejoinS: number;
  /** Area hazard under each centerline sample, or -1: for planners (AI, corner speeds). */
  hazard: Int16Array;
};

export type TrackGate = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Direction of legal travel through the gate. */
  tx: number;
  ty: number;
  branch: number;
};

export type TrackCheckpoint = {
  index: number;
  /** Position along the lap measured from the start line. */
  lapS: number;
  gates: TrackGate[];
  /** Course progress after crossing this gate runs from `low` to `high` on the lap. */
  low: number;
  high: number;
};

/** Solid line segments as capsules: ax, ay, bx, by, radius for each, flat. */
export type WallSegments = { data: Float64Array; count: number; owner: Int32Array };

export type TrackSpawn = { x: number; y: number; headingRad: number };

export type TrackRuntime = {
  def: TrackDefinition;
  branches: TrackBranch[];
  main: TrackBranch;
  lapLength: number;
  /** Main-line arc length of the start and finish line. */
  startS: number;
  checkpoints: TrackCheckpoint[];
  spawns: TrackSpawn[];
  obstacles: TrackObstacle[];
  gridCols: number;
  gridRows: number;
  grid: Int32Array[];
  obstacleGrid: Int32Array[];
  /** Beyond the shoulder is solid (walled) or off-road ground (open). */
  walled: boolean;
  /** Zone grid: surface (0 none, else `SURFACE_IDS` index + 1) and area hazard (index + 1). */
  zoneCell: number;
  zoneCols: number;
  zoneRows: number;
  zoneSurface: Uint8Array | null;
  zoneHazard: Uint8Array | null;
  hazards: TrackHazard[];
  /** Indices into `hazards` of the crossings, whose barriers are solid while active. */
  crossings: number[];
  walls: WallSegments;
  /** Wall segments per 96 px cell, like `obstacleGrid`. */
  wallGrid: Int32Array[];
  /** Course progress floor on the grid before the start line. */
  gridProgressFloor: number;
  cornerSigns: CornerSign[];
  /**
   * Where hazards sit on the route, for planners: the branch and arc length of each crossing's
   * barrier, and of the middle of each area hazard the centerline runs through.
   */
  routeHazards: RouteHazard[];
};

export type RouteHazard = {
  /** Index into `TrackRuntime.hazards`. */
  hazard: number;
  branch: number;
  /** Arc length on the branch: the barrier, or the first centerline sample inside the area. */
  s: number;
  /** For an area hazard, the length of centerline inside it. */
  length: number;
};

export type TrackLocation = {
  branch: number;
  /** Index of the sample that starts the nearest segment. */
  index: number;
  /** Parametric position within that segment. */
  t: number;
  /** Arc length along the branch. */
  s: number;
  /** Closest point on the centerline. */
  cx: number;
  cy: number;
  /** Signed offset from the centerline, positive to the right of travel. */
  lateral: number;
  /** Distance past the solid edge. Negative while inside the drivable corridor. */
  edge: number;
  halfWidth: number;
  shoulder: number;
  tx: number;
  ty: number;
};

type DensePoint = { x: number; y: number; w: number; sh: number; surface: SurfaceId };

function centripetal(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  k01: number,
  k12: number,
  k23: number,
  t: number,
): number {
  const t0 = 0;
  const t1 = t0 + k01;
  const t2 = t1 + k12;
  const t3 = t2 + k23;
  const tt = lerp(t1, t2, t);
  const a1 = ((t1 - tt) / (t1 - t0)) * p0 + ((tt - t0) / (t1 - t0)) * p1;
  const a2 = ((t2 - tt) / (t2 - t1)) * p1 + ((tt - t1) / (t2 - t1)) * p2;
  const a3 = ((t3 - tt) / (t3 - t2)) * p2 + ((tt - t2) / (t3 - t2)) * p3;
  const b1 = ((t2 - tt) / (t2 - t0)) * a1 + ((tt - t0) / (t2 - t0)) * a2;
  const b2 = ((t3 - tt) / (t3 - t1)) * a2 + ((tt - t1) / (t3 - t1)) * a3;
  return ((t2 - tt) / (t2 - t1)) * b1 + ((tt - t1) / (t2 - t1)) * b2;
}

function knot(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(1e-3, Math.sqrt(Math.hypot(bx - ax, by - ay)));
}

type Phantom = { x: number; y: number };

function densify(
  def: TrackBranchDefinition,
  leadIn: Phantom | null,
  leadOut: Phantom | null,
): DensePoint[] {
  const pts = def.points;
  const n = pts.length;
  const segments = def.closed ? n : n - 1;
  const at = (i: number): TrackControlPoint | Phantom => {
    if (def.closed) return pts[((i % n) + n) % n]!;
    if (i < 0) return leadIn ?? pts[0]!;
    if (i >= n) return leadOut ?? pts[n - 1]!;
    return pts[i]!;
  };
  const dense: DensePoint[] = [];
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = pts[i]!;
    const p2 = at(i + 1) as TrackControlPoint;
    const p3 = at(i + 2);
    const k01 = knot(p0.x, p0.y, p1.x, p1.y);
    const k12 = knot(p1.x, p1.y, p2.x, p2.y);
    const k23 = knot(p2.x, p2.y, p3.x, p3.y);
    const steps = Math.max(8, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3));
    const surface = p1.surface ?? def.surface;
    const sh1 = p1.shoulder ?? def.shoulder;
    const sh2 = p2.shoulder ?? def.shoulder;
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const e = t * t * (3 - 2 * t);
      dense.push({
        x: centripetal(p0.x, p1.x, p2.x, p3.x, k01, k12, k23, t),
        y: centripetal(p0.y, p1.y, p2.y, p3.y, k01, k12, k23, t),
        w: lerp(p1.width, p2.width, e),
        sh: lerp(sh1, sh2, e),
        surface,
      });
    }
  }
  if (!def.closed) {
    const last = pts[n - 1]!;
    dense.push({
      x: last.x,
      y: last.y,
      w: last.width,
      sh: last.shoulder ?? def.shoulder,
      surface: pts[n - 2]?.surface ?? def.surface,
    });
  }
  return dense;
}

function buildBranch(
  def: TrackBranchDefinition,
  index: number,
  leadIn: Phantom | null,
  leadOut: Phantom | null,
): TrackBranch {
  const dense = densify(def, leadIn, leadOut);
  const m = dense.length;
  const links = def.closed ? m : m - 1;
  const cum = new Float64Array(links + 1);
  for (let i = 0; i < links; i++) {
    const a = dense[i]!;
    const b = dense[(i + 1) % m]!;
    cum[i + 1] = cum[i]! + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const length = cum[links]!;
  const intervals = Math.max(4, Math.round(length / TRACK_SAMPLE_SPACING));
  const count = def.closed ? intervals : intervals + 1;
  const step = length / intervals;

  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const halfWidth = new Float64Array(count);
  const shoulder = new Float64Array(count);
  const s = new Float64Array(count);
  const surface: SurfaceId[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = Math.min(length, i * step);
    while (cursor < links - 1 && cum[cursor + 1]! < target) cursor++;
    const span = cum[cursor + 1]! - cum[cursor]!;
    const f = span > 1e-9 ? (target - cum[cursor]!) / span : 0;
    const a = dense[cursor]!;
    const b = dense[(cursor + 1) % m]!;
    x[i] = lerp(a.x, b.x, f);
    y[i] = lerp(a.y, b.y, f);
    halfWidth[i] = lerp(a.w, b.w, f) / 2;
    shoulder[i] = lerp(a.sh, b.sh, f);
    s[i] = target;
    surface.push(a.surface);
  }

  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const curvature = new Float64Array(count);
  const wrap = (i: number): number =>
    def.closed ? ((i % count) + count) % count : clamp(i, 0, count - 1);
  for (let i = 0; i < count; i++) {
    const a = wrap(i - 1);
    const b = wrap(i + 1);
    let dx = x[b]! - x[a]!;
    let dy = y[b]! - y[a]!;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    tx[i] = dx;
    ty[i] = dy;
  }
  for (let i = 0; i < count; i++) {
    const a = wrap(i - 1);
    const b = wrap(i + 1);
    const cross = tx[a]! * ty[b]! - ty[a]! * tx[b]!;
    const dot = tx[a]! * tx[b]! + ty[a]! * ty[b]!;
    const ds = a === b ? step : step * (b === i || a === i ? 1 : 2);
    curvature[i] = Math.atan2(cross, dot) / ds;
  }

  return {
    id: def.id,
    index,
    closed: def.closed,
    count,
    length,
    x,
    y,
    tx,
    ty,
    halfWidth,
    shoulder,
    s,
    curvature,
    surface,
    shoulderSurface: def.shoulderSurface,
    leaveS: 0,
    rejoinS: 0,
    hazard: new Int16Array(count).fill(-1),
  };
}

/** Interpolated centerline sample at arc length `s` along a branch. */
export type BranchPoint = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  halfWidth: number;
  shoulder: number;
  curvature: number;
  index: number;
};

export function sampleBranch(branch: TrackBranch, sIn: number): BranchPoint {
  let s = sIn;
  if (branch.closed) {
    s = ((s % branch.length) + branch.length) % branch.length;
  } else {
    s = clamp(s, 0, branch.length);
  }
  const intervals = branch.closed ? branch.count : branch.count - 1;
  const step = branch.length / intervals;
  let i = Math.floor(s / step);
  if (i >= intervals) i = intervals - 1;
  const f = clamp(s / step - i, 0, 1);
  const j = branch.closed ? (i + 1) % branch.count : i + 1;
  let tx = lerp(branch.tx[i]!, branch.tx[j]!, f);
  let ty = lerp(branch.ty[i]!, branch.ty[j]!, f);
  const d = Math.hypot(tx, ty) || 1;
  tx /= d;
  ty /= d;
  return {
    x: lerp(branch.x[i]!, branch.x[j]!, f),
    y: lerp(branch.y[i]!, branch.y[j]!, f),
    tx,
    ty,
    halfWidth: lerp(branch.halfWidth[i]!, branch.halfWidth[j]!, f),
    shoulder: lerp(branch.shoulder[i]!, branch.shoulder[j]!, f),
    curvature: lerp(branch.curvature[i]!, branch.curvature[j]!, f),
    index: i,
  };
}

function gateAt(branch: TrackBranch, s: number): TrackGate {
  const p = sampleBranch(branch, s);
  const reach = p.halfWidth + p.shoulder + GATE_MARGIN;
  // Right-hand normal of the travel direction.
  const nx = -p.ty;
  const ny = p.tx;
  return {
    ax: p.x - nx * reach,
    ay: p.y - ny * reach,
    bx: p.x + nx * reach,
    by: p.y + ny * reach,
    tx: p.tx,
    ty: p.ty,
    branch: branch.index,
  };
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Arc length of the centerline position closest to a world point. Build-time only. */
function nearestArcLength(branch: TrackBranch, px: number, py: number): number {
  let best = Infinity;
  let bestS = 0;
  const links = branch.closed ? branch.count : branch.count - 1;
  for (let i = 0; i < links; i++) {
    const j = (i + 1) % branch.count;
    const ax = branch.x[i]!;
    const ay = branch.y[i]!;
    const abx = branch.x[j]! - ax;
    const aby = branch.y[j]! - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 1e-12 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
    const d = Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
    if (d < best) {
      best = d;
      bestS = branch.s[i]! + Math.sqrt(len2) * t;
    }
  }
  return bestS;
}

/** Built runtimes, by definition object: building samples every spline and bakes grids. */
const BUILT = new WeakMap<TrackDefinition, TrackRuntime>();

/**
 * Builds the runtime of a track. A definition is immutable once shipped, so a runtime is
 * built once per definition object and shared (`TrackRuntime` is never mutated after this).
 */
export function buildTrack(def: TrackDefinition): TrackRuntime {
  const cached = BUILT.get(def);
  if (cached) return cached;
  const runtime = buildTrackUncached(def);
  BUILT.set(def, runtime);
  return runtime;
}

/**
 * The sampled centerlines of a track: the main line, then each shortcut with its ends snapped
 * onto the main line. Cheap (no grids): authoring tools place features against these.
 */
export function routeBranches(
  def: Pick<TrackDefinition, 'id' | 'main' | 'shortcuts'>,
): TrackBranch[] {
  if (def.main.points.length < 4)
    throw new Error(`Track ${def.id}: main line needs at least four control points`);
  const main = buildBranch(def.main, 0, null, null);
  const branches: TrackBranch[] = [main];

  for (const shortcut of def.shortcuts) {
    const leaveS = nearestArcLength(main, shortcut.leaveNear.x, shortcut.leaveNear.y);
    const rejoinS = nearestArcLength(main, shortcut.rejoinNear.x, shortcut.rejoinNear.y);
    const leave = sampleBranch(main, leaveS);
    const rejoin = sampleBranch(main, rejoinS);
    const first = shortcut.points[0];
    const last = shortcut.points[shortcut.points.length - 1];
    if (!first || !last)
      throw new Error(`Track ${def.id}: shortcut ${shortcut.id} has no control points`);
    const snapped: TrackBranchDefinition = {
      ...shortcut,
      points: [
        {
          x: leave.x,
          y: leave.y,
          width: first.width,
          surface: first.surface,
          shoulder: first.shoulder,
        },
        ...shortcut.points,
        {
          x: rejoin.x,
          y: rejoin.y,
          width: last.width,
          surface: last.surface,
          shoulder: last.shoulder,
        },
      ],
    };
    const branch = buildBranch(
      snapped,
      branches.length,
      { x: leave.x - leave.tx * 80, y: leave.y - leave.ty * 80 },
      { x: rejoin.x + rejoin.tx * 80, y: rejoin.y + rejoin.ty * 80 },
    );
    branch.leaveS = leaveS;
    branch.rejoinS = rejoinS;
    branches.push(branch);
  }
  return branches;
}

function buildTrackUncached(def: TrackDefinition): TrackRuntime {
  const branches = routeBranches(def);
  const main = branches[0]!;
  const lapLength = main.length;
  const startS = nearestArcLength(main, def.startNear.x, def.startNear.y);
  const walled = def.edges === 'walled';

  const gridCols = Math.ceil(def.worldWidth / GRID_CELL);
  const gridRows = Math.ceil(def.worldHeight / GRID_CELL);
  const grid = walled
    ? corridorGrid(branches, gridCols, gridRows)
    : nearestGrid(branches, gridCols, gridRows);
  const obstacleBuckets: number[][] = Array.from({ length: gridCols * gridRows }, () => []);
  def.obstacles.forEach((ob, idx) => {
    const reach = ob.radius + 40;
    const c0 = clamp(Math.floor((ob.x - reach) / GRID_CELL), 0, gridCols - 1);
    const c1 = clamp(Math.floor((ob.x + reach) / GRID_CELL), 0, gridCols - 1);
    const r0 = clamp(Math.floor((ob.y - reach) / GRID_CELL), 0, gridRows - 1);
    const r1 = clamp(Math.floor((ob.y + reach) / GRID_CELL), 0, gridRows - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) obstacleBuckets[r * gridCols + c]!.push(idx);
    }
  });
  const walls = wallSegments(def);
  const wallGrid = segmentGrid(walls, gridCols, gridRows);

  const zoneCell = TRACK_HAZARD.zoneCell;
  const zoneCols = Math.ceil(def.worldWidth / zoneCell);
  const zoneRows = Math.ceil(def.worldHeight / zoneCell);
  const zoneSurface = def.surfaceZones.length > 0 ? new Uint8Array(zoneCols * zoneRows) : null;
  const areaHazards = def.hazards.filter((h) => h.kind !== 'crossing');
  const zoneHazard = areaHazards.length > 0 ? new Uint8Array(zoneCols * zoneRows) : null;

  const runtime: TrackRuntime = {
    def,
    branches,
    main,
    lapLength,
    startS,
    checkpoints: [],
    spawns: [],
    obstacles: def.obstacles,
    gridCols,
    gridRows,
    grid: grid.map((b) => Int32Array.from(b)),
    obstacleGrid: obstacleBuckets.map((b) => Int32Array.from(b)),
    walled,
    zoneCell,
    zoneCols,
    zoneRows,
    zoneSurface,
    zoneHazard,
    hazards: def.hazards,
    crossings: def.hazards.flatMap((h, i) => (h.kind === 'crossing' ? [i] : [])),
    walls,
    wallGrid,
    gridProgressFloor: -lapLength / def.checkpointCount,
    cornerSigns: [],
    routeHazards: [],
  };

  // Zones: later zones win, so each is stamped in order over the cells its bounds touch.
  if (zoneSurface) {
    for (const zone of def.surfaceZones) {
      const code = SURFACE_IDS.indexOf(zone.surface) + 1;
      stampAny(runtime, zone.shape, zoneSurface, code);
    }
  }
  if (zoneHazard) {
    def.hazards.forEach((h, i) => {
      if (h.kind === 'crossing') return;
      stampAny(runtime, h.shape, zoneHazard, i + 1);
    });
  }
  // What the centerline runs over, zone surfaces and area hazards included, for planners.
  for (const branch of branches) {
    for (let i = 0; i < branch.count; i++) {
      const cell = zoneIndex(runtime, branch.x[i]!, branch.y[i]!);
      if (cell < 0) continue;
      const sv = zoneSurface ? zoneSurface[cell]! : 0;
      if (sv > 0) branch.surface[i] = SURFACE_IDS[sv - 1]!;
      const hv = zoneHazard ? zoneHazard[cell]! : 0;
      if (hv > 0) branch.hazard[i] = hv - 1;
    }
  }

  runtime.checkpoints = buildCheckpoints(runtime);
  const uniform = runtime.checkpoints.length === def.checkpointCount;
  if (!uniform) {
    const last = runtime.checkpoints[runtime.checkpoints.length - 1]!;
    runtime.gridProgressFloor = -(lapLength - last.lapS);
  }

  // Two grid slots just behind the line, staggered so neither car starts ahead on distance.
  const spawns: TrackSpawn[] = [];
  for (const side of [-1, 1]) {
    const p = sampleBranch(main, startS - 46);
    const nx = -p.ty;
    const ny = p.tx;
    const offset = side * p.halfWidth * 0.42;
    spawns.push({
      x: p.x + nx * offset,
      y: p.y + ny * offset,
      headingRad: headingFromVector(p.tx, p.ty),
    });
  }
  runtime.spawns = spawns;
  runtime.cornerSigns = placeCornerSigns(runtime);
  runtime.routeHazards = routeHazardsOf(runtime);
  return runtime;
}

function routeHazardsOf(track: TrackRuntime): RouteHazard[] {
  const out: RouteHazard[] = [];
  track.hazards.forEach((h, index) => {
    if (h.kind === 'crossing') {
      const mx = (h.a.x + h.b.x) / 2;
      const my = (h.a.y + h.b.y) / 2;
      const loc = createLocation();
      locate(track, mx, my, loc);
      out.push({ hazard: index, branch: loc.branch, s: loc.s, length: 0 });
      return;
    }
    for (const b of track.branches) {
      const step = b.length / (b.closed ? b.count : b.count - 1);
      let first = -1;
      let n = 0;
      for (let i = 0; i < b.count; i++) {
        if (b.hazard[i] !== index) continue;
        // On a loop the run may wrap the seam: start it after a sample outside.
        if (first < 0 || (b.closed && i > 0 && b.hazard[i - 1] !== index && first === 0)) first = i;
        n++;
      }
      if (n > 0) out.push({ hazard: index, branch: b.index, s: first * step, length: n * step });
    }
  });
  return out;
}

/** Format-1 bucketing: every centerline segment in the cells its corridor and a margin touch. */
function corridorGrid(branches: TrackBranch[], gridCols: number, gridRows: number): number[][] {
  const buckets: number[][] = Array.from({ length: gridCols * gridRows }, () => []);
  for (const branch of branches) {
    const links = branch.closed ? branch.count : branch.count - 1;
    for (let i = 0; i < links; i++) {
      const j = (i + 1) % branch.count;
      const reach =
        Math.max(
          branch.halfWidth[i]! + branch.shoulder[i]!,
          branch.halfWidth[j]! + branch.shoulder[j]!,
        ) + 48;
      const minX = Math.min(branch.x[i]!, branch.x[j]!) - reach;
      const maxX = Math.max(branch.x[i]!, branch.x[j]!) + reach;
      const minY = Math.min(branch.y[i]!, branch.y[j]!) - reach;
      const maxY = Math.max(branch.y[i]!, branch.y[j]!) + reach;
      const c0 = clamp(Math.floor(minX / GRID_CELL), 0, gridCols - 1);
      const c1 = clamp(Math.floor(maxX / GRID_CELL), 0, gridCols - 1);
      const r0 = clamp(Math.floor(minY / GRID_CELL), 0, gridRows - 1);
      const r1 = clamp(Math.floor(maxY / GRID_CELL), 0, gridRows - 1);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) buckets[r * gridCols + c]!.push((branch.index << 20) | i);
      }
    }
  }
  return buckets;
}

/**
 * Open-track bucketing: every cell of the world lists each segment that can be the deepest
 * corridor for some point in the cell, so `locate` never falls back to a full scan off-road.
 * A segment is kept when its best case (distance from the cell centre less half the cell
 * diagonal, less its widest corridor) is no worse than the worst case of the best segment.
 */
function nearestGrid(branches: TrackBranch[], gridCols: number, gridRows: number): number[][] {
  const n = branches.reduce((sum, b) => sum + (b.closed ? b.count : b.count - 1), 0);
  const code = new Int32Array(n);
  const mx = new Float64Array(n);
  const my = new Float64Array(n);
  const half = new Float64Array(n);
  const x0 = new Float64Array(n);
  const y0 = new Float64Array(n);
  const x1 = new Float64Array(n);
  const y1 = new Float64Array(n);
  const rMin = new Float64Array(n);
  const rMax = new Float64Array(n);
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const dist = new Float64Array(n);
  const cand: number[] = [];
  let k = 0;
  for (const branch of branches) {
    const links = branch.closed ? branch.count : branch.count - 1;
    for (let i = 0; i < links; i++, k++) {
      const j = (i + 1) % branch.count;
      const sx = branch.x[i]!;
      const sy = branch.y[i]!;
      const ex = branch.x[j]!;
      const ey = branch.y[j]!;
      const ri = branch.halfWidth[i]! + branch.shoulder[i]!;
      const rj = branch.halfWidth[j]! + branch.shoulder[j]!;
      code[k] = (branch.index << 20) | i;
      ax[k] = sx;
      ay[k] = sy;
      bx[k] = ex;
      by[k] = ey;
      mx[k] = (sx + ex) / 2;
      my[k] = (sy + ey) / 2;
      half[k] = Math.hypot(ex - sx, ey - sy) / 2;
      x0[k] = Math.min(sx, ex);
      y0[k] = Math.min(sy, ey);
      x1[k] = Math.max(sx, ex);
      y1[k] = Math.max(sy, ey);
      rMin[k] = Math.min(ri, rj);
      rMax[k] = Math.max(ri, rj);
    }
  }
  // For a point anywhere in the cell, a segment's corridor edge distance is at most its
  // distance from the cell centre through the segment's midpoint plus half its length plus half
  // the cell's diagonal, less its narrowest corridor; and at least its distance from the centre
  // to the segment's bounding box less half the diagonal, less its widest corridor. Keep every
  // segment whose best case is no worse than the best worst case: the true deepest is among them.
  const diag = (GRID_CELL * Math.SQRT2) / 2;
  const buckets: number[][] = [];
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cx = (c + 0.5) * GRID_CELL;
      const cy = (r + 0.5) * GRID_CELL;
      let worstBest = Infinity;
      for (let q = 0; q < n; q++) {
        const upper = Math.hypot(cx - mx[q]!, cy - my[q]!) + half[q]! + diag - rMin[q]!;
        if (upper < worstBest) worstBest = upper;
      }
      // Candidates by the cheap bound, then the exact distance to tighten both bounds.
      cand.length = 0;
      for (let q = 0; q < n; q++) {
        const dx = cx < x0[q]! ? x0[q]! - cx : cx > x1[q]! ? cx - x1[q]! : 0;
        const dy = cy < y0[q]! ? y0[q]! - cy : cy > y1[q]! ? cy - y1[q]! : 0;
        if (Math.hypot(dx, dy) - diag - rMax[q]! <= worstBest + 1) cand.push(q);
      }
      for (const q of cand) {
        const d = segmentDistance(cx, cy, ax[q]!, ay[q]!, bx[q]!, by[q]!);
        dist[q] = d;
        if (d + diag - rMin[q]! < worstBest) worstBest = d + diag - rMin[q]!;
      }
      const list: number[] = [];
      for (const q of cand) if (dist[q]! - diag - rMax[q]! <= worstBest + 1) list.push(code[q]!);
      buckets.push(list);
    }
  }
  return buckets;
}

function wallSegments(def: TrackDefinition): WallSegments {
  const flat: number[] = [];
  const owner: number[] = [];
  def.walls.forEach((wall, w) => {
    const pts = wall.points;
    const n = wall.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      flat.push(a.x, a.y, b.x, b.y, wall.thickness / 2);
      owner.push(w);
    }
  });
  return { data: Float64Array.from(flat), count: owner.length, owner: Int32Array.from(owner) };
}

function segmentGrid(walls: WallSegments, gridCols: number, gridRows: number): Int32Array[] {
  const buckets: number[][] = Array.from({ length: gridCols * gridRows }, () => []);
  for (let k = 0; k < walls.count; k++) {
    const d = walls.data;
    const reach = d[k * 5 + 4]! + 48;
    const c0 = clamp(
      Math.floor((Math.min(d[k * 5]!, d[k * 5 + 2]!) - reach) / GRID_CELL),
      0,
      gridCols - 1,
    );
    const c1 = clamp(
      Math.floor((Math.max(d[k * 5]!, d[k * 5 + 2]!) + reach) / GRID_CELL),
      0,
      gridCols - 1,
    );
    const r0 = clamp(
      Math.floor((Math.min(d[k * 5 + 1]!, d[k * 5 + 3]!) - reach) / GRID_CELL),
      0,
      gridRows - 1,
    );
    const r1 = clamp(
      Math.floor((Math.max(d[k * 5 + 1]!, d[k * 5 + 3]!) + reach) / GRID_CELL),
      0,
      gridRows - 1,
    );
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) buckets[r * gridCols + c]!.push(k);
  }
  return buckets.map((b) => Int32Array.from(b));
}

function zoneIndex(track: TrackRuntime, x: number, y: number): number {
  const c = Math.floor(x / track.zoneCell);
  const r = Math.floor(y / track.zoneCell);
  if (c < 0 || r < 0 || c >= track.zoneCols || r >= track.zoneRows) return -1;
  return r * track.zoneCols + c;
}

function stampAny(track: TrackRuntime, shape: TrackShape, grid: Uint8Array, code: number): void {
  if (shape.type === 'band') stampBand(track, resolveBand(shape, track.branches), grid, code);
  else stampShape(track, shapeTester(shape, track.branches), grid, code);
}

/**
 * A band, stamped as the union of one quad per centerline segment between its two offsets, cut
 * square at its two arc lengths. Each cell is tested only against the quads near it.
 */
function stampBand(track: TrackRuntime, band: ResolvedBand, grid: Uint8Array, code: number): void {
  const { branch } = band;
  const span = bandSpan(band);
  const steps = Math.max(1, Math.ceil(span / 6));
  const cell = track.zoneCell;
  let prev = branchPointAt(branch, band.s0);
  for (let k = 1; k <= steps; k++) {
    const p = branchPointAt(branch, band.s0 + (span * k) / steps);
    const quad = [
      prev.x - prev.ty * band.l0,
      prev.y + prev.tx * band.l0,
      p.x - p.ty * band.l0,
      p.y + p.tx * band.l0,
      p.x - p.ty * band.l1,
      p.y + p.tx * band.l1,
      prev.x - prev.ty * band.l1,
      prev.y + prev.tx * band.l1,
    ];
    let qx0 = Infinity;
    let qy0 = Infinity;
    let qx1 = -Infinity;
    let qy1 = -Infinity;
    for (let q = 0; q < 8; q += 2) {
      qx0 = Math.min(qx0, quad[q]!);
      qx1 = Math.max(qx1, quad[q]!);
      qy0 = Math.min(qy0, quad[q + 1]!);
      qy1 = Math.max(qy1, quad[q + 1]!);
    }
    const c0 = clamp(Math.floor(qx0 / cell), 0, track.zoneCols - 1);
    const c1 = clamp(Math.floor(qx1 / cell), 0, track.zoneCols - 1);
    const r0 = clamp(Math.floor(qy0 / cell), 0, track.zoneRows - 1);
    const r1 = clamp(Math.floor(qy1 / cell), 0, track.zoneRows - 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (inQuad(quad, (c + 0.5) * cell, (r + 0.5) * cell)) grid[r * track.zoneCols + c] = code;
      }
    prev = p;
  }
}

function inQuad(q: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = 6; i < 8; j = i, i += 2) {
    const ax = q[i]!;
    const ay = q[i + 1]!;
    const bx = q[j]!;
    const by = q[j + 1]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Writes `code` into every zone cell whose centre lies in the shape. */
function stampShape(
  track: TrackRuntime,
  tester: ReturnType<typeof shapeTester>,
  grid: Uint8Array,
  code: number,
): void {
  const cell = track.zoneCell;
  const c0 = clamp(Math.floor(tester.bounds.x0 / cell), 0, track.zoneCols - 1);
  const c1 = clamp(Math.floor(tester.bounds.x1 / cell), 0, track.zoneCols - 1);
  const r0 = clamp(Math.floor(tester.bounds.y0 / cell), 0, track.zoneRows - 1);
  const r1 = clamp(Math.floor(tester.bounds.y1 / cell), 0, track.zoneRows - 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tester.contains((c + 0.5) * cell, (r + 0.5) * cell)) grid[r * track.zoneCols + c] = code;
    }
  }
}

/**
 * Ordered checkpoints. Evenly spaced around the lap, checkpoint 0 on the start line; then, for
 * every shortcut that holds fewer gates of its own than it must (`SHORTCUT_MIN_GATES`, one on a
 * walled track), more checkpoints inside the span it bypasses. A checkpoint inside a shortcut's
 * span has a gate on the shortcut too, at the same share of its length (progress equivalence).
 */
function buildCheckpoints(track: TrackRuntime): TrackCheckpoint[] {
  const { def, main, lapLength, startS, branches } = track;
  const count = def.checkpointCount;
  const spans = branches.slice(1).map((branch) => ({
    branch,
    span: positiveMod(branch.rejoinS - branch.leaveS, lapLength),
    // Lap position of the leave point, measured from the start line.
    from: positiveMod(branch.leaveS - startS, lapLength),
  }));
  const inside = (lapS: number, sp: (typeof spans)[number]): boolean => {
    const offset = positiveMod(lapS - sp.from, lapLength);
    return offset > 0 && offset < sp.span;
  };
  const positions: number[] = [];
  for (let k = 0; k < count; k++) positions.push((k * lapLength) / count);
  let uniform = true;
  def.shortcuts.forEach((shortcut, n) => {
    const sp = spans[n]!;
    const need = shortcut.gates ?? (track.walled ? SHORTCUT_MIN_GATES_WALLED : SHORTCUT_MIN_GATES);
    const have = positions.filter((p) => inside(p, sp)).length;
    if (have >= need) return;
    uniform = false;
    // Replace what is inside with `need` checkpoints evenly inside the span.
    for (let i = positions.length - 1; i >= 0; i--)
      if (inside(positions[i]!, sp)) positions.splice(i, 1);
    for (let j = 1; j <= need; j++)
      positions.push(positiveMod(sp.from + (sp.span * j) / (need + 1), lapLength));
  });
  if (!uniform) positions.sort((a, b) => a - b);

  const checkpoints: TrackCheckpoint[] = [];
  const span = lapLength / count;
  positions.forEach((lapS, k) => {
    const gates = [makeGate(track, main, startS + lapS)];
    for (const sp of spans) {
      const offset = positiveMod(startS + lapS - sp.branch.leaveS, lapLength);
      if (offset > 0 && offset < sp.span) {
        // Progress equivalence: the same fraction of the bypassed main-line span.
        gates.push(makeGate(track, sp.branch, (offset / sp.span) * sp.branch.length));
      }
    }
    const low = uniform ? k * span : lapS;
    const high = uniform ? low + span : (positions[k + 1] ?? lapLength);
    checkpoints.push({ index: k, lapS, gates, low, high });
  });
  return checkpoints;
}

/**
 * A gate across a branch. On a walled track it spans the corridor and a margin. On an open
 * track it reaches `OPEN_GATE_REACH` past the shoulder on each side, so a car that runs wide
 * over open ground is still counted, but it stops short of a wall or of another piece of road.
 */
function makeGate(track: TrackRuntime, branch: TrackBranch, s: number): TrackGate {
  if (track.walled) return gateAt(branch, s);
  const p = sampleBranch(branch, s);
  const nx = -p.ty;
  const ny = p.tx;
  const base = p.halfWidth + p.shoulder + GATE_MARGIN;
  const loc = createLocation();
  const reachOn = (side: number): number => {
    let reach = base;
    for (let d = base; d <= base + OPEN_GATE_REACH; d += 8) {
      const x = p.x + nx * d * side;
      const y = p.y + ny * d * side;
      if (wallDepth(track, x, y, 4) > 0 || obstacleDepth(track, x, y, 4) > 0) break;
      if (x < 0 || y < 0 || x > track.def.worldWidth || y > track.def.worldHeight) break;
      locate(track, x, y, loc);
      const other =
        loc.branch !== branch.index ||
        Math.abs(positiveModHalf(loc.s - s, branch.closed ? branch.length : Infinity)) > 160;
      if (other && loc.edge < 40) break;
      reach = d;
    }
    return reach;
  };
  const left = reachOn(-1);
  const right = reachOn(1);
  return {
    ax: p.x - nx * left,
    ay: p.y - ny * left,
    bx: p.x + nx * right,
    by: p.y + ny * right,
    tx: p.tx,
    ty: p.ty,
    branch: branch.index,
  };
}

function positiveModHalf(value: number, modulus: number): number {
  if (!Number.isFinite(modulus)) return value;
  let v = positiveMod(value, modulus);
  if (v > modulus / 2) v -= modulus;
  return v;
}

/** How far a circle of `radius` at a point sinks into the deepest wall, or a negative clearance. */
export function wallDepth(track: TrackRuntime, x: number, y: number, radius: number): number {
  const c = Math.floor(x / GRID_CELL);
  const r = Math.floor(y / GRID_CELL);
  if (c < 0 || r < 0 || c >= track.gridCols || r >= track.gridRows) return -Infinity;
  const bucket = track.wallGrid[r * track.gridCols + c]!;
  const d = track.walls.data;
  let deepest = -Infinity;
  for (let k = 0; k < bucket.length; k++) {
    const w = bucket[k]! * 5;
    const depth =
      d[w + 4]! + radius - segmentDistance(x, y, d[w]!, d[w + 1]!, d[w + 2]!, d[w + 3]!);
    if (depth > deepest) deepest = depth;
  }
  return deepest;
}

/** How far a circle sinks into the deepest obstacle, or a negative clearance. */
export function obstacleDepth(track: TrackRuntime, x: number, y: number, radius: number): number {
  const c = Math.floor(x / GRID_CELL);
  const r = Math.floor(y / GRID_CELL);
  if (c < 0 || r < 0 || c >= track.gridCols || r >= track.gridRows) return -Infinity;
  const bucket = track.obstacleGrid[r * track.gridCols + c]!;
  let deepest = -Infinity;
  for (let k = 0; k < bucket.length; k++) {
    const ob = track.obstacles[bucket[k]!]!;
    const depth = ob.radius + radius - Math.hypot(ob.x - x, ob.y - y);
    if (depth > deepest) deepest = depth;
  }
  return deepest;
}

/** Whether the barrier of crossing hazard `index` (into `track.hazards`) is down at this tick. */
export function crossingClosed(track: TrackRuntime, index: number, clockTicks: number): boolean {
  const h = track.hazards[index];
  return !!h && h.kind === 'crossing' && hazardActive(h, clockTicks);
}

function evaluateSegment(
  branch: TrackBranch,
  i: number,
  px: number,
  py: number,
  out: TrackLocation,
  bestEdge: number,
): number {
  const j = (i + 1) % branch.count;
  const ax = branch.x[i]!;
  const ay = branch.y[i]!;
  const bx = branch.x[j]!;
  const by = branch.y[j]!;
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 1e-12 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy);
  const hw = lerp(branch.halfWidth[i]!, branch.halfWidth[j]!, t);
  const sh = lerp(branch.shoulder[i]!, branch.shoulder[j]!, t);
  const edge = dist - (hw + sh);
  if (edge >= bestEdge) return bestEdge;
  const len = Math.sqrt(len2) || 1;
  const tx = abx / len;
  const ty = aby / len;
  out.branch = branch.index;
  out.index = i;
  out.t = t;
  out.s = branch.s[i]! + len * t;
  out.cx = cx;
  out.cy = cy;
  // Right-hand normal is (-ty, tx); project the offset onto it for a signed lateral.
  out.lateral = dx * -ty + dy * tx;
  out.edge = edge;
  out.halfWidth = hw;
  out.shoulder = sh;
  out.tx = tx;
  out.ty = ty;
  return edge;
}

export function createLocation(): TrackLocation {
  return {
    branch: 0,
    index: 0,
    t: 0,
    s: 0,
    cx: 0,
    cy: 0,
    lateral: 0,
    edge: 0,
    halfWidth: 0,
    shoulder: 0,
    tx: 0,
    ty: -1,
  };
}

/**
 * Finds the corridor the point sits deepest inside. Writes into `out` to avoid allocation in
 * the 30 Hz loop. Returns false only when the point is far from every corridor, in which case
 * a brute-force search has still filled `out` with the nearest one.
 */
export function locate(track: TrackRuntime, px: number, py: number, out: TrackLocation): boolean {
  const c = Math.floor(px / GRID_CELL);
  const r = Math.floor(py / GRID_CELL);
  let best = Infinity;
  if (c >= 0 && r >= 0 && c < track.gridCols && r < track.gridRows) {
    const bucket = track.grid[r * track.gridCols + c]!;
    for (let k = 0; k < bucket.length; k++) {
      const code = bucket[k]!;
      best = evaluateSegment(track.branches[code >> 20]!, code & 0xfffff, px, py, out, best);
    }
  }
  if (best !== Infinity) return true;
  for (const branch of track.branches) {
    const links = branch.closed ? branch.count : branch.count - 1;
    for (let i = 0; i < links; i++) best = evaluateSegment(branch, i, px, py, out, best);
  }
  return false;
}

export function surfaceAt(
  track: TrackRuntime,
  loc: TrackLocation,
): { surface: SurfaceId; onShoulder: boolean } {
  if (track.zoneSurface || !track.walled) {
    // Format 2: zones and off-road ground. The located point is rebuilt from the location.
    const x = loc.cx - loc.ty * loc.lateral;
    const y = loc.cy + loc.tx * loc.lateral;
    groundAt(track, loc, x, y, 0, surfaceScratch);
    return { surface: surfaceScratch.surface, onShoulder: surfaceScratch.onShoulder };
  }
  const branch = track.branches[loc.branch]!;
  if (Math.abs(loc.lateral) > loc.halfWidth)
    return { surface: branch.shoulderSurface, onShoulder: true };
  return { surface: branch.surface[loc.index]!, onShoulder: false };
}

const surfaceScratch = createGround();

/**
 * Everything the ground does to a car whose centre is at (x, y), located as `loc`, at race
 * clock `clockTicks` (ticks since GO): the surface (a zone's, the road's, the shoulder's or
 * the off-road ground's), whether the shoulder penalty applies, and the area hazard's effect.
 * One `locate` the caller has done already, one grid read; no allocation.
 */
export function groundAt(
  track: TrackRuntime,
  loc: TrackLocation,
  x: number,
  y: number,
  clockTicks: number,
  out: Ground,
): Ground {
  const branch = track.branches[loc.branch]!;
  const offroad = !track.walled && loc.edge > 0;
  out.offroad = offroad;
  if (offroad) {
    out.surface = track.def.offroadSurface;
    out.onShoulder = true;
  } else if (Math.abs(loc.lateral) > loc.halfWidth) {
    out.surface = branch.shoulderSurface;
    out.onShoulder = true;
  } else {
    out.surface = branch.surface[loc.index]!;
    out.onShoulder = false;
  }
  const grid = track.zoneSurface;
  if (grid) {
    const c = Math.floor(x / track.zoneCell);
    const r = Math.floor(y / track.zoneCell);
    if (c >= 0 && r >= 0 && c < track.zoneCols && r < track.zoneRows) {
      const v = grid[r * track.zoneCols + c]!;
      if (v > 0) out.surface = SURFACE_IDS[v - 1]!;
    }
  }
  applyAreaHazard(track, x, y, clockTicks, out);
  return out;
}

/** Position around the lap, measured from the start line, for any located point. */
export function lapPosition(track: TrackRuntime, loc: TrackLocation): number {
  const branch = track.branches[loc.branch]!;
  let mainS: number;
  if (branch.index === 0) {
    mainS = loc.s;
  } else {
    const span = positiveMod(branch.rejoinS - branch.leaveS, track.lapLength);
    mainS = branch.leaveS + (loc.s / branch.length) * span;
  }
  return positiveMod(mainS - track.startS, track.lapLength);
}

export function createProgress(): VehicleProgressState {
  return {
    checkpointIndex: 0,
    lap: 0,
    courseProgress: 0,
    lastCheckpointMs: 0,
    wrongWaySeconds: 0,
    finishedAtMs: null,
  };
}

export type ProgressEvent = 'none' | 'checkpoint' | 'lap' | 'finish';

/**
 * Advances checkpoint, lap and course progress for one simulation step. Only a forward
 * crossing of the expected gate counts, so cutting the course, reversing through a gate or
 * leaving the map can never advance a racer.
 */
export function updateProgress(
  track: TrackRuntime,
  progress: VehicleProgressState,
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  headingRad: number,
  speed: number,
  loc: TrackLocation,
  simTimeMs: number,
  dt: number,
): ProgressEvent {
  let event: ProgressEvent = 'none';
  const count = track.checkpoints.length;
  if (progress.finishedAtMs === null) {
    const expected = track.checkpoints[progress.checkpointIndex]!;
    for (const gate of expected.gates) {
      if (!crossesGate(track, gate, prevX, prevY, x, y)) continue;
      progress.lastCheckpointMs = simTimeMs;
      event = 'checkpoint';
      if (expected.index === 0) {
        if (progress.lap >= track.def.laps) {
          progress.finishedAtMs = simTimeMs;
          event = 'finish';
        } else {
          progress.lap += 1;
          event = progress.lap === 1 ? 'checkpoint' : 'lap';
        }
      }
      progress.checkpointIndex = (progress.checkpointIndex + 1) % count;
      break;
    }
  }

  const lapLength = track.lapLength;
  if (progress.finishedAtMs !== null) {
    progress.courseProgress = track.def.laps * lapLength;
  } else if (progress.lap === 0) {
    // Still on the grid behind the line: progress is the (negative) distance to the line.
    const pos = lapPosition(track, loc);
    progress.courseProgress = clamp(pos - lapLength, track.gridProgressFloor, 0);
  } else {
    const lastIndex = positiveMod(progress.checkpointIndex - 1, count);
    const last = track.checkpoints[lastIndex]!;
    const low = last.low;
    const high = last.high;
    let pos = lapPosition(track, loc);
    // `loc` is where the car was before this step, so on the tick it crosses a gate its
    // position can still read as just short of it. Around the start line that is a whole lap
    // away from the stretch it has entered, in either direction: bring it next to the stretch
    // before clamping, or progress jumps a checkpoint span ahead for one tick at every line.
    if (pos < low - lapLength / 2) pos += lapLength;
    else if (pos > high + lapLength / 2) pos -= lapLength;
    progress.courseProgress = (progress.lap - 1) * lapLength + clamp(pos, low, high);
  }

  const facing = headingForwardX(headingRad) * loc.tx + headingForwardY(headingRad) * loc.ty;
  if (facing < -0.3 && speed > 24) progress.wrongWaySeconds += dt;
  else progress.wrongWaySeconds = 0;
  return event;
}

/**
 * Px a crossing may pass beyond either end of a gate on a walled track and still count. Walls
 * bound a walled corridor, so a gate's ends only matter where two corridors meet: at a fork the
 * main line's gate and the shortcut's twin can leave a gap a car on the inside line goes
 * through (found by the bot tournament at Steel Circuit's Conveyor Gap: a whole lap lost).
 * Open tracks keep exact ends; their gates already reach 200 px past the shoulder.
 */
export const GATE_END_SLACK_WALLED = 28;

/** Whether the move from (x0, y0) to (x1, y1) crosses `gate` forwards. */
export function crossesGate(
  track: TrackRuntime,
  gate: TrackGate,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if ((x1 - x0) * gate.tx + (y1 - y0) * gate.ty <= 0) return false;
  let { ax, ay, bx, by } = gate;
  if (track.walled) {
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 1e-9) {
      const ex = ((bx - ax) / len) * GATE_END_SLACK_WALLED;
      const ey = ((by - ay) / len) * GATE_END_SLACK_WALLED;
      ax -= ex;
      ay -= ey;
      bx += ex;
      by += ey;
    }
  }
  return segmentIntersection(x0, y0, x1, y1, ax, ay, bx, by) >= 0;
}

export function isWrongWay(progress: VehicleProgressState): boolean {
  return progress.wrongWaySeconds >= WRONG_WAY_SECONDS;
}

/**
 * Largest absolute curvature on the main line within `distance` ahead of `lapS`, signed by
 * the direction of that bend. Feeds the next-bend warning and the AI speed planner.
 */
export function bendAhead(
  track: TrackRuntime,
  lapS: number,
  from: number,
  to: number,
): { curvature: number; distance: number } {
  let strongest = 0;
  let at = from;
  for (let d = from; d <= to; d += TRACK_SAMPLE_SPACING * 2) {
    const p = sampleBranch(track.main, track.startS + lapS + d);
    if (Math.abs(p.curvature) > Math.abs(strongest)) {
      strongest = p.curvature;
      at = d;
    }
  }
  return { curvature: strongest, distance: at };
}
