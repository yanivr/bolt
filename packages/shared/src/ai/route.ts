import { MAX_COMBINED_GRIP, SURFACE_ROLLING_DECEL, UNSTABLE_GRIP_LOSS } from '../balance.js';
import { zoneHazardAt, zoneSurfaceAt } from '../hazards.js';
import { clamp } from '../math.js';
import {
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  driveForceAt,
  instability,
  rollingDecel,
  stepPowertrain,
  surfaceGrip,
} from '../physics.js';
import type { TrackBranch, TrackRuntime } from '../track.js';
import { createLocation, locate, obstacleDepth, wallDepth } from '../track.js';
import type { RaceEnvironment, SurfaceId, VehicleParams } from '../types.js';
import { SURFACE_IDS } from '../types.js';

/**
 * The AI's map of a track for one car (Section 15.9): a racing line on every route through the
 * route graph (the main line with each set of shortcuts spliced in), the speed the car can corner at on each point of it, and what each shortcut
 * is worth to this car. Everything is computed once from the track runtime and the car's own
 * published coefficients (the same `VehicleParams` the physics runs on), so a car on Sand
 * Paddles finds a different line and a different shortcut value than a car on Slicks.
 *
 * The line: a minimum-curvature path through the pavement, relaxed sample by sample, kept
 * inside the lateral band where the ground suits this car (a strip of drifted sand on the
 * inside of a bend is road for Sand Paddles and a trap for Slicks) and clear of oil, deep mud
 * and steam vents where the road leaves room to avoid them.
 */

/** Lateral cell size of the surface scan, px. */
const CELL = 8;
/** Room the line keeps between the car's body and the edge of the pavement, px. */
const EDGE_MARGIN = 6;
/** Room the line keeps between the car's body and a post, a wall or a barricade, px. */
const SOLID_MARGIN = 14;

type LateralScan = {
  /** Cells per side. Cell k (0..2K) sits at lateral (k - K) * CELL. */
  half: number;
  /** Per sample and cell: surface index + 1 (0 beyond the corridor), +16 on the shoulder. */
  surface: Uint8Array;
  /** Per sample and cell: area hazard index + 1, 0 for none. */
  hazard: Uint8Array;
  /** Per sample and cell: distance to the nearest wall or obstacle, px, at most 255. */
  clearance: Uint8Array;
  /**
   * Per sample and cell: distance inside the drivable union of corridors on a walled track
   * (255 on an open one). Within a branch's own width this only differs from that width where
   * two corridors meet: the convex corner where a shortcut leaves the street, which a car's
   * body clips on the way in (found by the bot tournament at Conveyor Gap and Lantern Alley).
   */
  room: Uint8Array;
};

const SCANS = new WeakMap<TrackRuntime, LateralScan[]>();

/** What the ground is across each branch, sampled once per track (shared by every car). */
function lateralScans(track: TrackRuntime): LateralScan[] {
  const cached = SCANS.get(track);
  if (cached) return cached;
  const scans = track.branches.map((branch) => {
    let widest = 0;
    for (let i = 0; i < branch.count; i++)
      widest = Math.max(widest, branch.halfWidth[i]! + branch.shoulder[i]!);
    const half = Math.ceil(widest / CELL);
    const cells = 2 * half + 1;
    const surface = new Uint8Array(branch.count * cells);
    const hazard = new Uint8Array(branch.count * cells);
    const clearance = new Uint8Array(branch.count * cells);
    const room = new Uint8Array(branch.count * cells).fill(255);
    const loc = createLocation();
    for (let i = 0; i < branch.count; i++) {
      const nx = -branch.ty[i]!;
      const ny = branch.tx[i]!;
      const hw = branch.halfWidth[i]!;
      const sh = branch.shoulder[i]!;
      for (let k = 0; k < cells; k++) {
        const lat = (k - half) * CELL;
        if (Math.abs(lat) > hw + sh) continue;
        const x = branch.x[i]! + nx * lat;
        const y = branch.y[i]! + ny * lat;
        const onShoulder = Math.abs(lat) > hw;
        let s: SurfaceId = onShoulder ? branch.shoulderSurface : branch.surface[i]!;
        const zone = zoneSurfaceAt(track, x, y);
        if (zone) s = zone;
        surface[i * cells + k] = SURFACE_IDS.indexOf(s) + 1 + (onShoulder ? 16 : 0);
        hazard[i * cells + k] = zoneHazardAt(track, x, y) + 1;
        const solid = Math.max(wallDepth(track, x, y, 0), obstacleDepth(track, x, y, 0));
        clearance[i * cells + k] = clamp(Math.round(-solid), 0, 255);
        if (track.walled) {
          locate(track, x, y, loc);
          room[i * cells + k] = clamp(Math.round(-loc.edge), 0, 255);
        }
      }
    }
    // A car is a capsule, not a point: its body circles sit up to a car length fore and aft of
    // its centre. A cell's clearance is the least of its own and its neighbours' two samples
    // either way along the road.
    const alongMin = (values: Uint8Array): Uint8Array => {
      const along = new Uint8Array(values.length);
      for (let i = 0; i < branch.count; i++)
        for (let k = 0; k < cells; k++) {
          let least = 255;
          for (let o = -2; o <= 2; o++) {
            let j = i + o;
            if (branch.closed) j = (j + branch.count) % branch.count;
            else if (j < 0 || j >= branch.count) continue;
            least = Math.min(least, values[j * cells + k]!);
          }
          along[i * cells + k] = least;
        }
      return along;
    };
    return { half, surface, hazard, clearance: alongMin(clearance), room: alongMin(room) };
  });
  SCANS.set(track, scans);
  return scans;
}

/** What the line optimizer needs of a path: closed or open samples with tangents. */
type PathGeometry = {
  count: number;
  closed: boolean;
  x: Float64Array;
  y: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
};

/**
 * One way round the course: the main line with a set of shortcuts spliced in, as one closed
 * path. Each sample remembers which branch and sample it came from, so the ground under it and
 * the hazards on it are the track's own. Building the line on the whole route, rather than on
 * each branch alone, lets it take the turn into a shortcut (Lantern Alley leaves its street at
 * a right angle) as one corner instead of a kink.
 */
export type RouteLine = PathGeometry & {
  /** Shortcuts taken: bit k - 1 for `track.branches[k]`. */
  mask: number;
  length: number;
  s: Float64Array;
  halfWidth: Float64Array;
  /** Signed curvature of the centerline (positive bends right), from its branch. */
  curvature: Float64Array;
  src: Int16Array;
  srcIndex: Int32Array;
  /** Per main-line sample, its index on this route, or -1 where a shortcut bypasses it. */
  mainIndex: Int32Array;
  /** Route distance at which each shortcut's fork is, taken or not (index by branch). */
  forkS: number[];
  /** The racing line: lateral offset from the centerline, positive right. */
  offset: Float64Array;
  /** Curvature of the racing line, absolute, 1/px. */
  kappa: Float64Array;
  /** Fastest the car can take each point of the line at full grip, before braking. */
  limit: Float64Array;
  /** Grip and rolling resistance at each point of the line, for this car. */
  grip: Float64Array;
  roll: Float64Array;
  surface: SurfaceId[];
  /** Lateral band of good ground at each sample, car centre, px. */
  lo: Float64Array;
  hi: Float64Array;
  /** Hard limit of the pavement each side, car centre, px. */
  edge: Float64Array;
  /** Estimated lap on this route at the plan's confidence, seconds. */
  lapSeconds: number;
};

export type ShortcutValue = {
  /** Index into `track.branches`. */
  branch: number;
  /** Estimated laps without it and with it; positive gain when it is quicker for this car. */
  mainSeconds: number;
  shortcutSeconds: number;
  gain: number;
  /** Same estimate on length alone, at one average speed: what a shallow planner sees. */
  naiveGain: number;
  /** Narrowest usable width on the shortcut, px, and the share of it on poor ground. */
  narrowest: number;
  poorShare: number;
};

export type RoutePlan = {
  track: TrackRuntime;
  /** Every route, indexed by its mask. */
  routes: RouteLine[];
  shortcuts: ShortcutValue[];
  /** Steady top speed of the car on each surface, px/s (no heat, flat). */
  topSpeed: Record<SurfaceId, number>;
  /** Effective lateral acceleration at grip 1, after the chassis' stability. */
  lateralAccel: number;
};

function isRoad(surface: SurfaceId): boolean {
  return surface === 'asphalt' || surface === 'cobble' || surface === 'metal';
}
function isLoose(surface: SurfaceId): boolean {
  return surface === 'sand' || surface === 'dirt' || surface === 'mud' || surface === 'snow';
}

/** Net forward acceleration of the car at full throttle, px/s2. */
export function netAccel(
  params: VehicleParams,
  surface: SurfaceId,
  grip: number,
  roll: number,
  v: number,
  output = 1,
): number {
  const scale = isRoad(surface) ? params.roadSpeedFactor : 1;
  const traction =
    params.tractionAccel * grip * (isLoose(surface) ? params.looseTractionFactor : 1);
  const drive = Math.min(traction, (output * driveForceAt(params, v / scale)) / params.massKg);
  const drag =
    ((params.dragLinear * v) / scale + (params.dragQuadratic * v * v) / (scale * scale)) /
    params.massKg;
  return drive - drag - roll;
}

function topSpeedOn(params: VehicleParams, env: RaceEnvironment, surface: SurfaceId): number {
  const grip = surfaceGrip(params, env, surface, false);
  const roll = rollingDecel(params, surface, false);
  let v = 0;
  for (let i = 0; i < 30 * 40; i++) {
    const a = netAccel(params, surface, grip, roll, v);
    if (a <= 0.05 && v > 5) break;
    v = Math.max(0, v + a / 30);
  }
  return Math.max(30, v);
}

type CellTable = { grip: Float64Array; roll: Float64Array };

/** Grip and rolling for each surface code of the scan (index + 1, + 16 on a shoulder). */
function cellTable(params: VehicleParams, env: RaceEnvironment): CellTable {
  const grip = new Float64Array(33);
  const roll = new Float64Array(33);
  for (let s = 0; s < SURFACE_IDS.length; s++) {
    const id = SURFACE_IDS[s]!;
    grip[s + 1] = surfaceGrip(params, env, id, false);
    roll[s + 1] = rollingDecel(params, id, false);
    grip[s + 17] = surfaceGrip(params, env, id, true);
    roll[s + 17] = rollingDecel(params, id, true);
  }
  return { grip, roll };
}

function hazardEffect(
  track: TrackRuntime,
  code: number,
  params: VehicleParams,
): { grip: number; drag: number; avoid: boolean } {
  if (code === 0) return { grip: 1, drag: 0, avoid: false };
  const h = track.hazards[code - 1]!;
  switch (h.kind) {
    case 'oil':
      return { grip: h.grip, drag: 0, avoid: true };
    case 'deep_mud':
      return { grip: 1, drag: h.drag, avoid: true };
    case 'steam_vent':
      return { grip: 1, drag: h.drag * 0.25, avoid: true };
    case 'magnetic_strip':
      return { grip: params.magneticTires ? 1 + h.gripBonus : 1, drag: 0, avoid: false };
    default:
      return { grip: 1, drag: 0, avoid: false };
  }
}

/** Signed curvature of the circle through three points, 1/px. */
function curvature3(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const bcx = cx - bx;
  const bcy = cy - by;
  const d = Math.hypot(abx, aby) * Math.hypot(bcx, bcy) * Math.hypot(cx - ax, cy - ay);
  return d > 1e-9 ? (2 * (abx * bcy - aby * bcx)) / d : 0;
}

/**
 * Relaxes a line toward minimum curvature inside its bounds, after Remi Coulom's K1999
 * method: at a stride of samples, each point is set to the curvature that is the
 * distance-weighted mean of its neighbours' (so curvature spreads evenly through a bend
 * instead of piling up at the apex), then clamped to the band of good ground. Strides halve
 * from 64 samples to 1, interpolating in between. Unlike averaging positions, this does not
 * pull a closed loop inward onto the inside of every corner.
 */
function relax(
  branch: PathGeometry,
  offset: Float64Array,
  lo: Float64Array,
  hi: Float64Array,
  fixedEnds: boolean,
): void {
  const n = branch.count;
  const closed = branch.closed;
  const X = (i: number) => branch.x[i]! - branch.ty[i]! * offset[i]!;
  const Y = (i: number) => branch.y[i]! + branch.tx[i]! * offset[i]!;
  const wrap = (i: number) => (closed ? ((i % n) + n) % n : clamp(i, 0, n - 1));
  const adjust = (i: number, step: number) => {
    const prev = wrap(i - step);
    const next = wrap(i + step);
    const pp = wrap(i - 2 * step);
    const nn = wrap(i + 2 * step);
    const px = X(prev);
    const py = Y(prev);
    const qx = X(next);
    const qy = Y(next);
    const rPrev = curvature3(X(pp), Y(pp), px, py, X(i), Y(i));
    const rNext = curvature3(X(i), Y(i), qx, qy, X(nn), Y(nn));
    const lPrev = Math.hypot(X(i) - px, Y(i) - py);
    const lNext = Math.hypot(X(i) - qx, Y(i) - qy);
    const target = (lNext * rPrev + lPrev * rNext) / Math.max(1e-6, lPrev + lNext);
    // Put the point on the chord from prev to next (curvature zero there)...
    const cx = branch.x[i]!;
    const cy = branch.y[i]!;
    const nx = -branch.ty[i]!;
    const ny = branch.tx[i]!;
    const dx = qx - px;
    const dy = qy - py;
    const den = nx * dy - ny * dx;
    let e = offset[i]!;
    if (Math.abs(den) > 1e-9) e = ((px - cx) * dy - (py - cy) * dx) / den;
    // ...then out along the normal to the curvature it should have.
    const delta = 0.5;
    const k0 = curvature3(px, py, cx + nx * e, cy + ny * e, qx, qy);
    const k1 = curvature3(px, py, cx + nx * (e + delta), cy + ny * (e + delta), qx, qy);
    const dk = (k1 - k0) / delta;
    if (Math.abs(dk) > 1e-9) e += (target - k0) / dk;
    offset[i] = clamp(e, lo[i]!, hi[i]!);
  };
  for (let step = 64; step >= 1; step = Math.floor(step / 2)) {
    if (step * 4 >= n) continue;
    const rounds = Math.round(40 * Math.sqrt(step));
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < n; i += step) {
        if (!closed && (fixedEnds ? i < step || i > n - 1 - step : i < step || i > n - 1 - step))
          continue;
        adjust(i, step);
      }
    }
    if (step > 1) {
      // Fill in between the points just placed.
      for (let i = 0; i < n; i += step) {
        const j = i + step;
        if (!closed && j > n - 1) break;
        const a = offset[i]!;
        const b = offset[wrap(j)]!;
        for (let k = 1; k < step; k++) {
          const at = wrap(i + k);
          if (!closed && at >= n - 1) break;
          offset[at] = clamp(a + ((b - a) * k) / step, lo[at]!, hi[at]!);
        }
      }
    }
  }
}

function lineCurvature(path: PathGeometry, offset: Float64Array, out: Float64Array): void {
  const n = path.count;
  const wrap = (i: number) => (path.closed ? ((i % n) + n) % n : clamp(i, 0, n - 1));
  const X = (i: number) => path.x[i]! - path.ty[i]! * offset[i]!;
  const Y = (i: number) => path.y[i]! + path.tx[i]! * offset[i]!;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = wrap(i - 2);
    const c = wrap(i + 2);
    raw[i] = Math.abs(curvature3(X(a), Y(a), X(i), Y(i), X(c), Y(c)));
  }
  // The car is not a point: hold each point to the sharpest curvature next to it.
  for (let i = 0; i < n; i++) out[i] = Math.max(raw[wrap(i - 1)]!, raw[i]!, raw[wrap(i + 1)]!);
}

/** First main-line sample at or after an arc length. */
function mainSampleAfter(main: TrackBranch, s: number): number {
  const step = main.length / main.count;
  return Math.ceil((((s % main.length) + main.length) % main.length) / step - 1e-9) % main.count;
}

/** The samples of one route: the main line, with each taken shortcut spliced in. */
function buildPath(track: TrackRuntime, mask: number) {
  const main = track.main;
  const n = main.count;
  const leaveAt: number[] = [];
  const rejoinAt: number[] = [];
  for (let k = 1; k < track.branches.length; k++) {
    leaveAt[k] = mainSampleAfter(main, track.branches[k]!.leaveS);
    rejoinAt[k] = mainSampleAfter(main, track.branches[k]!.rejoinS);
  }
  let start = 0;
  for (let k = 1; k < track.branches.length; k++)
    if (mask & (1 << (k - 1))) {
      start = rejoinAt[k]!;
      break;
    }
  const src: number[] = [];
  const srcIndex: number[] = [];
  let i = start;
  let visited = 0;
  while (visited < n) {
    let spliced = false;
    for (let k = 1; k < track.branches.length; k++) {
      if (!(mask & (1 << (k - 1))) || leaveAt[k] !== i) continue;
      const branch = track.branches[k]!;
      for (let j = 0; j < branch.count; j++) {
        src.push(k);
        srcIndex.push(j);
      }
      const skip = (((rejoinAt[k]! - i) % n) + n) % n;
      visited += skip;
      i = rejoinAt[k]!;
      spliced = true;
      break;
    }
    if (spliced) continue;
    src.push(0);
    srcIndex.push(i);
    i = (i + 1) % n;
    visited++;
  }
  const count = src.length;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const halfWidth = new Float64Array(count);
  const curvature = new Float64Array(count);
  const s = new Float64Array(count);
  const surface: SurfaceId[] = [];
  const mainIndex = new Int32Array(n).fill(-1);
  for (let j = 0; j < count; j++) {
    const b = track.branches[src[j]!]!;
    const k = srcIndex[j]!;
    x[j] = b.x[k]!;
    y[j] = b.y[k]!;
    tx[j] = b.tx[k]!;
    ty[j] = b.ty[k]!;
    halfWidth[j] = b.halfWidth[k]!;
    curvature[j] = b.curvature[k]!;
    surface.push(b.surface[k]!);
    if (src[j] === 0) mainIndex[k] = j;
    if (j > 0) s[j] = s[j - 1]! + Math.hypot(x[j]! - x[j - 1]!, y[j]! - y[j - 1]!);
  }
  const length = s[count - 1]! + Math.hypot(x[0]! - x[count - 1]!, y[0]! - y[count - 1]!);
  const forkS: number[] = [0];
  for (let k = 1; k < track.branches.length; k++) {
    let at = -1;
    if (mask & (1 << (k - 1))) {
      for (let j = 0; j < count; j++)
        if (src[j] === k && srcIndex[j] === 0) {
          at = j;
          break;
        }
    } else at = mainIndex[leaveAt[k]!]!;
    forkS[k] = at >= 0 ? s[at]! : -1;
  }
  return {
    count,
    closed: true as const,
    x,
    y,
    tx,
    ty,
    halfWidth,
    curvature,
    s,
    surface,
    length,
    src: Int16Array.from(src),
    srcIndex: Int32Array.from(srcIndex),
    mainIndex,
    forkS,
  };
}

function buildRoute(
  track: TrackRuntime,
  mask: number,
  scans: LateralScan[],
  table: CellTable,
  params: VehicleParams,
  lateralAccel: number,
): RouteLine {
  const path = buildPath(track, mask);
  const n = path.count;
  const offset = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const edge = new Float64Array(n);
  const slack = new Float64Array(n);
  // A walled street punishes running wide more than open ground does.
  const margin = params.colliderRadius + EDGE_MARGIN + (track.walled ? 5 : 0);
  const widest = Math.max(...scans.map((scan) => 2 * scan.half + 1));
  const quality = new Float64Array(widest);
  const cellGrip = new Float64Array(widest);
  const cellRoll = new Float64Array(widest);
  for (let i = 0; i < n; i++) {
    const scan = scans[path.src[i]!]!;
    const cells = 2 * scan.half + 1;
    const row = path.srcIndex[i]! * cells;
    const hw = Math.max(0, path.halfWidth[i]! - margin);
    edge[i] = hw;
    let bestGrip = 0;
    let bestRoll = Infinity;
    // Room from walls and obstacles: a car's radius and a little. Where nothing across the road
    // has that much (a barricade to weave round, a gap between pillars), the widest gap there is.
    let widestGap = 0;
    for (let k = 0; k < cells; k++) {
      const lat = (k - scan.half) * CELL;
      if (scan.surface[row + k]! === 0 || Math.abs(lat) > hw + CELL / 2) continue;
      widestGap = Math.max(widestGap, scan.clearance[row + k]!);
    }
    // Room the line keeps from a post or a wall where the road allows: a car at race pace is
    // 8 to 15 px off its line now and then (measured), and a bollard at 200 px/s is a wreck.
    let need = params.colliderRadius + SOLID_MARGIN;
    if (widestGap < need) need = Math.max(params.colliderRadius + 4, widestGap - 6);
    if (widestGap < need) need = Math.max(params.colliderRadius * 0.5, widestGap - 2);
    // How much room the car's body has in the widest gap here, px (0 is touching).
    slack[i] = Math.max(0, widestGap - params.colliderRadius);
    for (let k = 0; k < cells; k++) {
      const lat = (k - scan.half) * CELL;
      const code = scan.surface[row + k]!;
      if (
        code === 0 ||
        Math.abs(lat) > hw + CELL / 2 ||
        scan.clearance[row + k]! < need ||
        scan.room[row + k]! < params.colliderRadius + 4
      ) {
        quality[k] = -1;
        continue;
      }
      const hz = hazardEffect(track, scan.hazard[row + k]!, params);
      const g = Math.min(MAX_COMBINED_GRIP * 1.3, table.grip[code]! * hz.grip);
      const r = table.roll[code]! + hz.drag;
      cellGrip[k] = g;
      cellRoll[k] = r;
      quality[k] = hz.avoid ? 0 : 1;
      if (quality[k]! > 0) {
        bestGrip = Math.max(bestGrip, g);
        bestRoll = Math.min(bestRoll, r);
      }
    }
    // Good ground: nearly the best grip here and not much more rolling resistance. Of the
    // runs of good ground across the road, the widest, kept next to the previous sample's.
    const prevMid = i > 0 ? (lo[i - 1]! + hi[i - 1]!) / 2 / CELL + scan.half : scan.half;
    let runStart = -1;
    let bestA = -1;
    let bestB = -1;
    let bestScore = -Infinity;
    for (let k = 0; k <= cells; k++) {
      const good =
        k < cells &&
        quality[k]! > 0 &&
        cellGrip[k]! >= bestGrip * 0.85 &&
        cellRoll[k]! <= bestRoll + 20;
      if (good && runStart < 0) runStart = k;
      if (!good && runStart >= 0) {
        const score = k - 1 - runStart - 0.5 * Math.abs((runStart + k - 1) / 2 - prevMid);
        if (score > bestScore) {
          bestScore = score;
          bestA = runStart;
          bestB = k - 1;
        }
        runStart = -1;
      }
    }
    if (bestA < 0) {
      lo[i] = -hw;
      hi[i] = hw;
    } else {
      lo[i] = clamp((bestA - scan.half) * CELL - CELL / 2, -hw, hw);
      hi[i] = clamp((bestB - scan.half) * CELL + CELL / 2, -hw, hw);
      if (hi[i]! < lo[i]!) hi[i] = lo[i]!;
    }
    offset[i] = clamp(0, lo[i]!, hi[i]!);
  }
  relax(path, offset, lo, hi, false);

  const kappa = new Float64Array(n);
  lineCurvature(path, offset, kappa);
  const grip = new Float64Array(n);
  const roll = new Float64Array(n);
  const limit = new Float64Array(n);
  const surface: SurfaceId[] = [];
  for (let i = 0; i < n; i++) {
    const scan = scans[path.src[i]!]!;
    const cells = 2 * scan.half + 1;
    const row = path.srcIndex[i]! * cells;
    const k = clamp(Math.round(offset[i]! / CELL) + scan.half, 0, cells - 1);
    let code = scan.surface[row + k]!;
    if (code === 0) code = SURFACE_IDS.indexOf(path.surface[i]!) + 1;
    const hz = hazardEffect(track, scan.hazard[row + k]!, params);
    grip[i] = table.grip[code]! * hz.grip;
    roll[i] = table.roll[code]! + hz.drag;
    surface.push(SURFACE_IDS[(code - 1) & 15]!);
    // Only cornering limits the speed a car may carry: a slow surface slows it by itself, and
    // braking for it before it arrives would throw away the speed it can carry in.
    limit[i] = Math.sqrt((lateralAccel * grip[i]!) / Math.max(kappa[i]!, 1e-5));
    // Threading a gap barely wider than the car (pillars, barricades) is done slowly enough to
    // hold the line through it.
    if (slack[i]! < 14) limit[i] = Math.min(limit[i]!, 130 + 8 * slack[i]!);
  }
  const route: RouteLine = {
    ...path,
    mask,
    offset,
    kappa,
    limit,
    grip,
    roll,
    surface,
    lo,
    hi,
    edge,
    lapSeconds: 0,
  };
  route.lapSeconds = lapTime(params, route, 0.9, 0.7);
  return route;
}

/** Index of the sample at route distance `s` (wrapped). */
export function sampleIndex(route: RouteLine, s: number): number {
  const len = route.length;
  const w = ((s % len) + len) % len;
  const arr = route.s;
  let lo = 0;
  let hi = route.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid]! <= w) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A lap of a route by forward (acceleration) and backward (braking) passes, seconds. */
function lapTime(
  params: VehicleParams,
  route: RouteLine,
  cornerConfidence: number,
  brakeConfidence: number,
): number {
  const n = route.count;
  const v = new Float64Array(n);
  const conf = Math.sqrt(cornerConfidence);
  for (let i = 0; i < n; i++) v[i] = route.limit[i]! * conf;
  const gap = (i: number) =>
    i + 1 < n ? route.s[i + 1]! - route.s[i]! : route.length - route.s[i]!;
  for (let lap = 0; lap < 2; lap++) {
    for (let j = 1; j <= n; j++) {
      const i = j % n;
      const p = j - 1;
      const a = netAccel(params, route.surface[p]!, route.grip[p]!, route.roll[p]!, v[p]!);
      const next = Math.sqrt(Math.max(0, v[p]! * v[p]! + 2 * a * gap(p)));
      v[i] = Math.min(route.limit[i]! * conf, Math.max(next, 10));
    }
    for (let j = n - 1; j >= 0; j--) {
      const nx = (j + 1) % n;
      const decel = params.brakeDecel * route.grip[j]! * brakeConfidence + route.roll[j]!;
      v[j] = Math.min(v[j]!, Math.sqrt(v[nx]! * v[nx]! + 2 * decel * gap(j)));
    }
  }
  let t = 0;
  for (let i = 0; i < n; i++) t += gap(i) / Math.max(v[i]!, 5);
  return t;
}

const PLANS = new WeakMap<TrackRuntime, Map<string, RoutePlan>>();

/** A key for the coefficients the plan depends on. */
function paramsKey(params: VehicleParams, env: RaceEnvironment): string {
  return JSON.stringify([
    env.weather,
    params.massKg,
    params.driveForce,
    params.lateralGripAccel,
    params.brakeDecel,
    params.tireGrip,
    params.tireSurfaceGrip,
    params.tireWetGripFactor,
    params.tireDryGrip,
    params.tireWetSurfaceGrip,
    params.rollingFactor,
    params.rollingAdd,
    params.looseRollingFactor,
    params.looseTractionFactor,
    params.roadSpeedFactor,
    params.peakGripFactor,
    params.stability,
    params.colliderRadius,
    params.forceZeroSpeed,
    params.magneticTires ?? false,
  ]);
}

/** The plan of one car on one track in one weather. Cached: a rematch costs nothing. */
export function routePlan(
  track: TrackRuntime,
  params: VehicleParams,
  env: RaceEnvironment,
): RoutePlan {
  let byTrack = PLANS.get(track);
  if (!byTrack) {
    byTrack = new Map();
    PLANS.set(track, byTrack);
  }
  const key = paramsKey(params, env);
  const cached = byTrack.get(key);
  if (cached) return cached;
  const plan = buildPlan(track, params, env);
  if (byTrack.size > 64) byTrack.clear();
  byTrack.set(key, plan);
  return plan;
}

function buildPlan(track: TrackRuntime, params: VehicleParams, env: RaceEnvironment): RoutePlan {
  const scans = lateralScans(track);
  const table = cellTable(params, env);
  const top = {} as Record<SurfaceId, number>;
  for (const s of SURFACE_IDS) top[s] = topSpeedOn(params, env, s);
  const lateralAccel =
    params.lateralGripAccel *
    params.peakGripFactor *
    (1 - UNSTABLE_GRIP_LOSS * instability(params, 0));
  const shortcutCount = track.branches.length - 1;
  const routes: RouteLine[] = [];
  for (let mask = 0; mask < 1 << shortcutCount; mask++)
    routes[mask] = buildRoute(track, mask, scans, table, params, lateralAccel);

  const shortcuts: ShortcutValue[] = [];
  const base = routes[0]!;
  for (let k = 1; k <= shortcutCount; k++) {
    const via = routes[1 << (k - 1)]!;
    const branch = track.branches[k]!;
    const span =
      (((branch.rejoinS - branch.leaveS) % track.main.length) + track.main.length) %
      track.main.length;
    let narrowest = Infinity;
    let poor = 0;
    let samples = 0;
    for (let i = 0; i < via.count; i++) {
      if (via.src[i] !== k) continue;
      samples++;
      narrowest = Math.min(narrowest, via.hi[i]! - via.lo[i]! + 2 * params.colliderRadius);
      if (via.roll[i]! > SURFACE_ROLLING_DECEL.dirt + 4 || via.grip[i]! < 0.6) poor++;
    }
    const average = base.length / Math.max(1e-6, base.lapSeconds);
    shortcuts.push({
      branch: k,
      mainSeconds: base.lapSeconds,
      shortcutSeconds: via.lapSeconds,
      gain: base.lapSeconds - via.lapSeconds,
      naiveGain: (span - branch.length) / Math.max(60, average),
      narrowest,
      poorShare: poor / Math.max(1, samples),
    });
  }
  return { track, routes, shortcuts, topSpeed: top, lateralAccel };
}

/**
 * A quick estimate of a race (all its laps) on the main centerline for a car, seconds: the
 * centerline's own curvature, surfaces and area hazards give a speed limit at each point, a
 * backward pass turns it into a braking profile, and the car is then driven along it in time,
 * flat out wherever it is under the profile, with the real powertrain (`stepPowertrain`), so
 * an engine that overheats on a hot day pays for it. A few milliseconds, so a build can be
 * weighed against its alternatives when a race is set up; the full plan (`routePlan`) is for
 * the car that is chosen. Returns seconds per lap.
 */
export function estimateLapSeconds(
  track: TrackRuntime,
  params: VehicleParams,
  env: RaceEnvironment,
): number {
  const main = track.main;
  const n = main.count;
  const lateralAccel =
    params.lateralGripAccel *
    params.peakGripFactor *
    (1 - UNSTABLE_GRIP_LOSS * instability(params, 0));
  const table = cellTable(params, env);
  const limit = new Float64Array(n);
  const grip = new Float64Array(n);
  const roll = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const code = SURFACE_IDS.indexOf(main.surface[i]!) + 1;
    const hz = hazardEffect(track, main.hazard[i]! + 1, params);
    grip[i] = table.grip[code]! * hz.grip;
    roll[i] = table.roll[code]! + hz.drag;
    // The centerline is tighter than a racing line: half again the radius.
    const k = Math.max(Math.abs(main.curvature[i]!) / 1.5, 1e-5);
    limit[i] = Math.sqrt((lateralAccel * grip[i]! * 0.9) / k);
  }
  const step = main.length / n;
  // Braking profile: the fastest speed at each point from which the car can still slow down
  // for everything after it (twice round, so the lap wraps).
  const profile = new Float64Array(n);
  for (let i = 0; i < n; i++) profile[i] = limit[i]!;
  for (let lap = 0; lap < 2; lap++)
    for (let j = n - 1; j >= 0; j--) {
      const decel = params.brakeDecel * grip[j]! * 0.7 + roll[j]!;
      profile[j] = Math.min(profile[j]!, Math.sqrt(profile[(j + 1) % n]! ** 2 + 2 * decel * step));
    }
  // Drive it in time, with heat.
  const state = createMotionState(0, 0, 0, params);
  const power = createPowertrainOutput();
  const telemetry = createTelemetry();
  const laps = track.def.laps;
  const total = laps * main.length;
  let s = 0;
  let v = 0;
  let t = 0;
  const dt = 1 / 30;
  while (s < total && t < 600) {
    const i = Math.floor(s / step) % n;
    const want = profile[i]!;
    const throttle = v < want ? 1 : 0.2;
    stepPowertrain(state, throttle, v, params, env, dt, power, telemetry);
    if (v < want) {
      const a = netAccel(params, main.surface[i]!, grip[i]!, roll[i]!, v, power.output);
      v = Math.min(want, Math.max(0, v + a * dt));
    } else v = want;
    v = Math.max(v, 4);
    s += v * dt;
    t += dt;
  }
  return t / laps;
}
