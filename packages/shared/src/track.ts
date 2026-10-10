import { WRONG_WAY_SECONDS } from './balance.js';
import { clamp, headingForwardX, headingForwardY, headingFromVector, lerp, segmentIntersection } from './math.js';
import type {
  SurfaceId,
  TrackBranchDefinition,
  TrackControlPoint,
  TrackDefinition,
  TrackObstacle,
  VehicleProgressState,
} from './types.js';

/**
 * Runtime track model. Built once from an authored TrackDefinition and then queried by the
 * integrator, the checkpoint logic, the AI, the terrain baker and the minimap. Everything here
 * is pure and deterministic so the server and the predicting client agree.
 *
 * A track is a union of corridors. Each corridor follows a sampled centerline and carries a
 * paved half-width plus a drivable shoulder; anything beyond the shoulder is solid.
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
};

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

function centripetal(p0: number, p1: number, p2: number, p3: number, k01: number, k12: number, k23: number, t: number): number {
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
  const wrap = (i: number): number => (def.closed ? ((i % count) + count) % count : clamp(i, 0, count - 1));
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

export function buildTrack(def: TrackDefinition): TrackRuntime {
  if (def.main.points.length < 4) throw new Error(`Track ${def.id}: main line needs at least four control points`);
  const main = buildBranch(def.main, 0, null, null);
  const branches: TrackBranch[] = [main];
  const lapLength = main.length;
  const startS = nearestArcLength(main, def.startNear.x, def.startNear.y);

  for (const shortcut of def.shortcuts) {
    const leaveS = nearestArcLength(main, shortcut.leaveNear.x, shortcut.leaveNear.y);
    const rejoinS = nearestArcLength(main, shortcut.rejoinNear.x, shortcut.rejoinNear.y);
    const leave = sampleBranch(main, leaveS);
    const rejoin = sampleBranch(main, rejoinS);
    const first = shortcut.points[0];
    const last = shortcut.points[shortcut.points.length - 1];
    if (!first || !last) throw new Error(`Track ${def.id}: shortcut ${shortcut.id} has no control points`);
    const snapped: TrackBranchDefinition = {
      ...shortcut,
      points: [
        { x: leave.x, y: leave.y, width: first.width, surface: first.surface, shoulder: first.shoulder },
        ...shortcut.points,
        { x: rejoin.x, y: rejoin.y, width: last.width, surface: last.surface, shoulder: last.shoulder },
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

  // Ordered checkpoints, evenly spaced around the lap. Checkpoint 0 is the start line.
  const checkpoints: TrackCheckpoint[] = [];
  for (let k = 0; k < def.checkpointCount; k++) {
    const lapS = (k * lapLength) / def.checkpointCount;
    const gates = [gateAt(main, startS + lapS)];
    for (const branch of branches) {
      if (branch.index === 0) continue;
      const span = positiveMod(branch.rejoinS - branch.leaveS, lapLength);
      const offset = positiveMod(startS + lapS - branch.leaveS, lapLength);
      if (offset > 0 && offset < span) {
        // Progress equivalence: the same fraction of the bypassed main-line span.
        gates.push(gateAt(branch, (offset / span) * branch.length));
      }
    }
    checkpoints.push({ index: k, lapS, gates });
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

  const gridCols = Math.ceil(def.worldWidth / GRID_CELL);
  const gridRows = Math.ceil(def.worldHeight / GRID_CELL);
  const buckets: number[][] = Array.from({ length: gridCols * gridRows }, () => []);
  for (const branch of branches) {
    const links = branch.closed ? branch.count : branch.count - 1;
    for (let i = 0; i < links; i++) {
      const j = (i + 1) % branch.count;
      const reach = Math.max(branch.halfWidth[i]! + branch.shoulder[i]!, branch.halfWidth[j]! + branch.shoulder[j]!) + 48;
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

  return {
    def,
    branches,
    main,
    lapLength,
    startS,
    checkpoints,
    spawns,
    obstacles: def.obstacles,
    gridCols,
    gridRows,
    grid: buckets.map((b) => Int32Array.from(b)),
    obstacleGrid: obstacleBuckets.map((b) => Int32Array.from(b)),
  };
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
  return { branch: 0, index: 0, t: 0, s: 0, cx: 0, cy: 0, lateral: 0, edge: 0, halfWidth: 0, shoulder: 0, tx: 0, ty: -1 };
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

export function surfaceAt(track: TrackRuntime, loc: TrackLocation): { surface: SurfaceId; onShoulder: boolean } {
  const branch = track.branches[loc.branch]!;
  if (Math.abs(loc.lateral) > loc.halfWidth) return { surface: branch.shoulderSurface, onShoulder: true };
  return { surface: branch.surface[loc.index]!, onShoulder: false };
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
    const mx = x - prevX;
    const my = y - prevY;
    for (const gate of expected.gates) {
      if (mx * gate.tx + my * gate.ty <= 0) continue;
      const hit = segmentIntersection(prevX, prevY, x, y, gate.ax, gate.ay, gate.bx, gate.by);
      if (hit < 0) continue;
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
    progress.courseProgress = clamp(pos - lapLength, -lapLength / count, 0);
  } else {
    const span = lapLength / count;
    const lastIndex = positiveMod(progress.checkpointIndex - 1, count);
    const low = lastIndex * span;
    const high = low + span;
    let pos = lapPosition(track, loc);
    if (pos < low - lapLength / 2) pos += lapLength;
    progress.courseProgress = (progress.lap - 1) * lapLength + clamp(pos, low, high);
  }

  const facing = headingForwardX(headingRad) * loc.tx + headingForwardY(headingRad) * loc.ty;
  if (facing < -0.3 && speed > 24) progress.wrongWaySeconds += dt;
  else progress.wrongWaySeconds = 0;
  return event;
}

export function isWrongWay(progress: VehicleProgressState): boolean {
  return progress.wrongWaySeconds >= WRONG_WAY_SECONDS;
}

/**
 * Largest absolute curvature on the main line within `distance` ahead of `lapS`, signed by
 * the direction of that bend. Feeds the next-bend warning and the AI speed planner.
 */
export function bendAhead(track: TrackRuntime, lapS: number, from: number, to: number): { curvature: number; distance: number } {
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
