import {
  BRAKE_DECEL,
  CORNER_SIGNS,
  LATERAL_GRIP_ACCEL,
  SURFACE_GRIP,
  SURFACE_ROLLING_DECEL,
} from './balance.js';
import type { TrackBranch, TrackRuntime } from './track.js';

/**
 * Corner signs (Section 9.3): "visible arrow signs and sharp-bend road chevrons communicate
 * upcoming corners 0.8 to 1.2 seconds before arrival at normal speed". Normal speed is a
 * reference profile of the default car on the centerline (`CORNER_SIGNS`); a bend is sharp
 * when that profile must slow below a share of top speed for it. Each sharp bend gets one sign,
 * placed on the outside of the bend where the profile reaches the bend `leadSeconds` later.
 * The validator then checks the lead time against the real default car in the simulator.
 */

export type CornerSign = {
  id: string;
  /** Branch index (0 is the main line). */
  branch: number;
  /** Arc length on the branch where the bend begins, and where the sign stands. */
  bendS: number;
  signS: number;
  /** Bends announced by this sign (a sequence counts each), and where the last one ends. */
  chain: number;
  chainEndS: number;
  /** World position of the sign, on the outside edge of the road. */
  x: number;
  y: number;
  turn: 'left' | 'right';
  /** 1 a bend to lift for, 2 a bend to brake for, 3 a hairpin. */
  severity: 1 | 2 | 3;
  /** Total turn of the bend in degrees, and its tightest radius in world pixels. */
  turnDegrees: number;
  minRadius: number;
  /** Reference speed through the bend's slowest point, px/s. */
  bendSpeed: number;
  /** Seconds from sign to bend at the reference speed. */
  leadSeconds: number;
};

/**
 * Reference speed at every centerline sample of a branch, px/s, clear weather, Street Tires.
 * Cornering limit, braking back from it, and a forward pass that accelerates toward the
 * surface's top speed, or, on a slower surface than the car arrived on, slows toward it by the
 * surface's rolling resistance and drag: a car runs into sand at speed and bogs down over a
 * few car lengths, it does not stop dead at the edge of it.
 */
export function referenceSpeeds(branch: TrackBranch, track: TrackRuntime): Float64Array {
  const n = branch.count;
  const v = new Float64Array(n);
  const step = branch.length / (branch.closed ? n : n - 1);
  const surfaceOf = (i: number) => branch.surface[i] ?? 'asphalt';
  const grip = (i: number): number => {
    const g = SURFACE_GRIP.clear[surfaceOf(i)];
    const h = branch.hazard[i] ?? -1;
    const hz = h >= 0 ? track.hazards[h] : undefined;
    return hz && hz.kind === 'oil' ? g * hz.grip : g;
  };
  const top = (i: number) => CORNER_SIGNS.topSpeed * CORNER_SIGNS.surfaceTop[surfaceOf(i)];
  for (let i = 0; i < n; i++) {
    const k = Math.max(Math.abs(branch.curvature[i]!), 1e-5);
    v[i] = Math.min(
      CORNER_SIGNS.topSpeed,
      Math.sqrt((LATERAL_GRIP_ACCEL * grip(i) * CORNER_SIGNS.cornerConfidence) / k),
    );
  }
  // Braking backward and accelerating forward; twice round a loop so the seam settles.
  const passes = branch.closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let k = n - 2 + (branch.closed ? 1 : 0); k >= 0; k--) {
      const i = k % n;
      const j = (k + 1) % n;
      const b = BRAKE_DECEL * grip(i) * CORNER_SIGNS.brakeConfidence;
      v[i] = Math.min(v[i]!, Math.sqrt(v[j]! * v[j]! + 2 * b * step));
    }
  }
  const limit = Float64Array.from(v);
  let carry = Math.min(limit[0]!, top(0));
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < n; k++) {
      const j = k % n;
      const cap = top(j);
      let next: number;
      if (carry < cap) {
        const a = CORNER_SIGNS.accel * grip(j) * Math.max(0.15, 1 - carry / cap);
        next = Math.min(cap, Math.sqrt(carry * carry + 2 * a * step));
      } else {
        const fade = SURFACE_ROLLING_DECEL[surfaceOf(j)] * CORNER_SIGNS.fadeShare;
        next = Math.max(cap, Math.sqrt(Math.max(0, carry * carry - 2 * fade * step)));
      }
      carry = Math.min(limit[j]!, next);
      v[j] = carry;
    }
    if (!branch.closed) break;
  }
  return v;
}

/** A bend: a run of curvature one way, with its reference speed. Arc lengths on its branch. */
export type Bend = {
  startS: number;
  endS: number;
  /** Sample indices, possibly past `count` on a loop (take them modulo). */
  start: number;
  end: number;
  turnDegrees: number;
  minRadius: number;
  minSpeed: number;
  right: boolean;
};

/** Bends of a branch that make the reference car slow below `sharpShare` of top speed. */
export function sharpBends(
  track: TrackRuntime,
  branch: TrackBranch,
  v = referenceSpeeds(branch, track),
): Bend[] {
  const n = branch.count;
  const step = branch.length / (branch.closed ? n : n - 1);
  const at = (i: number): number =>
    branch.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  const kOf = (i: number) => branch.curvature[at(i)]!;
  const bendK = 1 / CORNER_SIGNS.bendRadius;
  // Start the scan on a straight so a bend over the seam of a loop is seen whole.
  let first = 0;
  if (branch.closed) while (first < n && Math.abs(kOf(first)) >= bendK) first++;
  const out: Bend[] = [];
  const limit = branch.closed ? first + n : n;
  for (let i = first; i < limit;) {
    const k = kOf(i);
    if (Math.abs(k) < bendK) {
      i++;
      continue;
    }
    const sign = Math.sign(k);
    let j = i;
    let turn = 0;
    let minSpeed = Infinity;
    let peak = 0;
    while (j < limit && Math.sign(kOf(j)) === sign && Math.abs(kOf(j)) >= bendK) {
      turn += kOf(j) * step;
      minSpeed = Math.min(minSpeed, v[at(j)]!);
      peak = Math.max(peak, Math.abs(kOf(j)));
      j++;
    }
    const degrees = Math.abs((turn * 180) / Math.PI);
    if (
      degrees >= CORNER_SIGNS.minTurnDeg &&
      minSpeed < CORNER_SIGNS.topSpeed * CORNER_SIGNS.sharpShare
    ) {
      const wrap = (x: number) =>
        branch.closed ? ((x % branch.length) + branch.length) % branch.length : x;
      out.push({
        startS: wrap(i * step),
        endS: wrap(j * step),
        start: i,
        end: j,
        turnDegrees: Math.round(degrees),
        minRadius: Math.round(1 / Math.max(peak, 1e-6)),
        minSpeed: Math.round(minSpeed),
        right: sign > 0,
      });
    }
    i = j;
  }
  return out;
}

/**
 * Stands a sign before each sharp bend. A bend that follows the previous one within
 * `leadSeconds` at reference speed is part of its sequence (an S, a chicane, two corners of a
 * city block) and is announced by that sequence's sign: the sign before a sequence counts its
 * bends (`chain`), as a "double bend" board does.
 */
function branchSigns(track: TrackRuntime, branch: TrackBranch): CornerSign[] {
  const n = branch.count;
  const step = branch.length / (branch.closed ? n : n - 1);
  const v = referenceSpeeds(branch, track);
  const at = (i: number): number =>
    branch.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  const bends = sharpBends(track, branch, v);
  const secondsBetween = (from: number, to: number): number => {
    let t = 0;
    for (let k = from; k < to; k++) t += step / Math.max(1, (v[at(k)]! + v[at(k + 1)]!) / 2);
    return t;
  };
  const out: CornerSign[] = [];
  let open: CornerSign | null = null;
  let lastEnd = -Infinity;
  for (const bend of bends) {
    // A bend at the mouth of a shortcut, and any that follows it closely, is announced by the
    // shortcut's own named sign.
    if (
      !branch.closed &&
      out.length === 0 &&
      secondsBetween(Math.max(0, lastEnd), bend.start) <
        (lastEnd < 0 ? CORNER_SIGNS.leadMin : CORNER_SIGNS.leadSeconds)
    ) {
      lastEnd = bend.end;
      continue;
    }
    if (open && secondsBetween(lastEnd, bend.start) < CORNER_SIGNS.leadSeconds) {
      open.chain++;
      open.chainEndS = bend.endS;
      open.severity = Math.max(open.severity, severityOf(bend)) as 1 | 2 | 3;
      lastEnd = bend.end;
      continue;
    }
    // Walk back from the bend until the reference car is `leadSeconds` away, but not back into
    // the previous bend.
    let time = 0;
    let k = bend.start;
    while (time < CORNER_SIGNS.leadSeconds && k - 1 > lastEnd && bend.start - k < n) {
      if (!branch.closed && k - 1 < 0) break;
      time += step / Math.max(1, (v[at(k - 1)]! + v[at(k)]!) / 2);
      k--;
    }
    const i0 = at(k);
    let signS = k * step;
    if (branch.closed) signS = ((signS % branch.length) + branch.length) % branch.length;
    // Outside of the bend: the left side for a right-hand bend.
    const side = bend.right ? -1 : 1;
    const off = branch.halfWidth[i0]! + Math.min(branch.shoulder[i0]!, 10) + 6;
    const tx = branch.tx[i0]!;
    const ty = branch.ty[i0]!;
    open = {
      id: `${branch.id}_sign_${out.length + 1}`,
      branch: branch.index,
      bendS: bend.startS,
      chainEndS: bend.endS,
      chain: 1,
      signS,
      x: branch.x[i0]! - ty * off * side,
      y: branch.y[i0]! + tx * off * side,
      turn: bend.right ? 'right' : 'left',
      severity: severityOf(bend),
      turnDegrees: bend.turnDegrees,
      minRadius: bend.minRadius,
      bendSpeed: bend.minSpeed,
      leadSeconds: Math.round(time * 100) / 100,
    };
    out.push(open);
    lastEnd = bend.end;
  }
  return out;
}

function severityOf(bend: Bend): 1 | 2 | 3 {
  if (bend.minRadius < 90 || bend.turnDegrees >= 150) return 3;
  return bend.minSpeed < CORNER_SIGNS.topSpeed * CORNER_SIGNS.sharpShare * 0.75 ? 2 : 1;
}

export function placeCornerSigns(track: TrackRuntime): CornerSign[] {
  return track.branches.flatMap((b) => branchSigns(track, b));
}
