import {
  BRAKE_LIFT_THRESHOLD,
  HEADING_DAMPING,
  HEADING_GAIN,
  HEADING_MIN_YAW_GAIN,
  HEAT_PROTECTION,
  SIM_DT,
} from '../balance.js';
import type { CombatCar } from '../combat/types.js';
import { scheduleState } from '../hazards.js';
import { angleDelta, clamp, headingFromVector, lerp } from '../math.js';
import type { ControlInput } from '../physics.js';
import { steerYawGain } from '../physics.js';
import type { TrackLocation, TrackRuntime } from '../track.js';
import { createLocation, locate, obstacleDepth, wallDepth } from '../track.js';
import type { AiPersona } from './profile.js';
import type { RouteLine, RoutePlan } from './route.js';
import { sampleIndex } from './route.js';

/**
 * The driving half of the AI: where the car is on its chosen route, where it wants to be
 * across the road, how fast it may go, and the steering and pedals that get it there. It
 * produces the same control sample a person does and nothing else.
 *
 * - Route: one closed path round the course, the main line with the shortcuts it has chosen
 *   spliced in (`RoutePlan.routes`). The car is projected onto that path, never onto whichever
 *   corridor happens to be nearest; before each fork it may switch to the route through or
 *   past the shortcut.
 * - Line: the route's racing line (scaled by planning depth), plus a slow wander (line error),
 *   plus whatever offset the tactics ask for (a pass, a defence, a trap to go round).
 * - Speed: for every point ahead within a braking horizon, the fastest entry speed from which
 *   it can still brake to that point's cornering limit, under the grip the car has right now
 *   (statuses and damaged wheels included), and a stop short of a rail crossing that will be
 *   down when it gets there, read from the published timetable.
 * - Recovery: pinned or turned round, it backs out with the wheels turned toward the road.
 */

const DEG = Math.PI / 180;
/** How hard the tracker turns toward the lane per px of cross-track error, per second. */
const CROSS_GAIN = 2.2;
/** Px per tick the commanded lane may move across the road; in a bend, `LANE_RATE_BEND`. */
const LANE_RATE = 2.6;
const LANE_RATE_BEND = 1.1;
/** Curvature from which a lane change counts as being in a bend, 1/px. */
const BEND_CURVATURE = 1 / 450;
/** A passage whose line may wander less than this either side, px, is narrow. */
const NARROW_EDGE = 16;
/** Speed a car not yet lined up enters a narrow passage at, px/s, plus 4 per px of room. */
const NARROW_LINE_UP_SPEED = 110;
/** Line curvature, 1/px, from which even a shallow planner follows the real line, fully by
 * `TIGHT_FULL`, looking `TIGHT_LOOKAHEAD` px ahead. Full lock is about 1/52 px. */
const TIGHT_FROM = 1 / 160;
const TIGHT_FULL = 1 / 90;
const TIGHT_LOOKAHEAD = 140;
/** Seconds from a steering command to the yaw it asks for: the wheel filter and the yaw lag. */
const STEER_LAG = 0.16;
/** Share of full-lock curvature beyond which a bend is taken at `FULL_LOCK_SPEED` px/s. */
export const LOCK_SHARE = 0.7;
const FULL_LOCK_SPEED = 70;
/** Px outside its street, and inside a shortcut's corridor, at which a car is in the shortcut. */
const IN_SHORTCUT = 12;
/** Px outside a shortcut's corridor at which a car on its route has missed the mouth. */
const MISSED_MOUTH = 40;
/** Distances ahead, px (plus 0.4 s of speed), at which a car far off its lane looks for a
 * clear way back, nearest first. */
const REJOIN_AHEAD = [40, 100, 170, 260];
/** Farther than this from its lane, px, a car checks that the way back is clear. */
const REJOIN_CHECK = 36;

export class Pilot {
  readonly plan: RoutePlan;
  readonly track: TrackRuntime;
  /** The route being driven, by mask, and the car's place on it. */
  mask = 0;
  s = 0;
  lateral = 0;
  /** 1 once a shortcut has been decided on this approach to its fork, 0 while open. */
  readonly decided: number[];
  /** The car could not be found near its route (far off the road): it is heading back. */
  lost = false;
  /** Current lateral bias from the line, px, and where tactics want it. */
  bias = 0;
  biasWish = 0;
  /** Line error: an Ornstein-Uhlenbeck wander, px. */
  wander = 0;
  stuckTicks = 0;
  reverseTicks = 0;
  reverseSteer = 0;
  coastPhase = 0;
  holding = false;
  allowed = Infinity;
  /** Extra speed ceiling from tactics this tick (follow, line up a shot). */
  speedWish = Infinity;
  /** The way back to the lane is blocked by a wall or an obstacle (it runs along instead). */
  blocked = false;
  /** The point of the lane the last clear-way check looked at. */
  private readonly rejoin = { x: 0, y: 0 };
  /** Recoveries so far, for the tournament's stuck detector. */
  recoveries = 0;
  /** Route place of the last recovery and how many in a row were from about there. */
  private lastRecoveryS = Number.NaN;
  private repeats = 0;
  private initialized = false;
  private readonly loc: TrackLocation = createLocation();

  constructor(
    plan: RoutePlan,
    private readonly persona: AiPersona,
  ) {
    this.plan = plan;
    this.track = plan.track;
    this.decided = this.track.branches.map(() => 0);
  }

  reset(): void {
    this.initialized = false;
    this.mask = 0;
    this.s = 0;
    this.bias = 0;
    this.biasWish = 0;
    this.wander = 0;
    this.stuckTicks = 0;
    this.reverseTicks = 0;
    this.coastPhase = 0;
    this.recoveries = 0;
    this.lastRecoveryS = Number.NaN;
    this.repeats = 0;
    for (let i = 0; i < this.decided.length; i++) this.decided[i] = 0;
  }

  /**
   * Drops the shortcut the route is on at the car's place when the car itself is on another
   * road (it missed the mouth), and finds itself again on the route that remains.
   */
  private abandonShortcut(x: number, y: number): void {
    const r = this.route;
    const src = r.src[sampleIndex(r, this.s)]!;
    if (src === 0) return;
    locate(this.track, x, y, this.loc);
    if (this.loc.branch === src) return;
    const next = this.mask & ~(1 << (src - 1));
    if (!this.plan.routes[next]) return;
    this.mask = next;
    this.decided[src] = 1;
    this.relocate(x, y);
  }

  get route(): RouteLine {
    return this.plan.routes[this.mask]!;
  }

  /** Whether the route takes shortcut branch `k`. */
  takes(k: number): boolean {
    return (this.mask & (1 << (k - 1))) !== 0;
  }

  /** Racing-line offset at a route distance, scaled by planning depth, px. */
  lineOffset(s: number): number {
    const r = this.route;
    const i = sampleIndex(r, s);
    const j = (i + 1) % r.count;
    const span = j > i ? r.s[j]! - r.s[i]! : r.length - r.s[i]!;
    const w = ((s % r.length) + r.length) % r.length;
    const t = span > 1e-6 ? clamp((w - r.s[i]!) / span, 0, 1) : 0;
    const offset = lerp(r.offset[i]!, r.offset[j]!, t);
    const depth = this.persona.skill.lineDepth;
    if (depth >= 1) return offset;
    // A shallow planner drives a lazier line, nearer the middle, except into a bend so tight
    // that only the real line gets round it at all (a right-angle alley mouth: from the middle
    // of the street a Rookie's car could not turn in, and backed and filled at the posts).
    const follow = tightAhead(r)[i]!;
    return follow > 0 ? offset * lerp(depth, 1, follow) : offset * depth;
  }

  /** The band of good, clear ground at a route distance (route lateral), px. */
  bandAt(s: number, out: { lo: number; hi: number }): { lo: number; hi: number } {
    const r = this.route;
    const i = sampleIndex(r, s);
    out.lo = r.lo[i]!;
    out.hi = r.hi[i]!;
    return out;
  }

  edgeAt(s: number): number {
    const r = this.route;
    return r.edge[sampleIndex(r, s)]!;
  }

  /** Route point at distance `s`: centre and unit tangent. */
  pointAt(s: number, out: { x: number; y: number; tx: number; ty: number }): void {
    const r = this.route;
    const i = sampleIndex(r, s);
    const j = (i + 1) % r.count;
    const span = j > i ? r.s[j]! - r.s[i]! : r.length - r.s[i]!;
    const w = ((s % r.length) + r.length) % r.length;
    const t = span > 1e-6 ? clamp((w - r.s[i]!) / span, 0, 1) : 0;
    out.x = lerp(r.x[i]!, r.x[j]!, t);
    out.y = lerp(r.y[i]!, r.y[j]!, t);
    const tx = lerp(r.tx[i]!, r.tx[j]!, t);
    const ty = lerp(r.ty[i]!, r.ty[j]!, t);
    const d = Math.hypot(tx, ty) || 1;
    out.tx = tx / d;
    out.ty = ty / d;
  }

  /**
   * Moves the car onto another route (taking or leaving a shortcut), keeping its place: only
   * possible where both routes share the road it is on. Returns whether it switched.
   */
  setRoute(mask: number): boolean {
    if (mask === this.mask) return true;
    const from = this.route;
    const to = this.plan.routes[mask];
    if (!to) return false;
    const i = sampleIndex(from, this.s);
    let j = -1;
    if (from.src[i] === 0) j = to.mainIndex[from.srcIndex[i]!]!;
    else
      for (let k = 0; k < to.count; k++)
        if (to.src[k] === from.src[i] && to.srcIndex[k] === from.srcIndex[i]) {
          j = k;
          break;
        }
    if (j < 0) return false;
    this.s = to.s[j]! + (this.s - from.s[i]!);
    this.mask = mask;
    return true;
  }

  /** Projects the car onto its route near where it was. */
  updateCursor(car: CombatCar): void {
    const m = car.session.motion;
    if (!this.initialized) {
      this.relocate(m.x, m.y);
      this.initialized = true;
    }
    let found = this.project(m.x, m.y, this.s, 10, 16);
    if (!found) {
      this.relocate(m.x, m.y);
      found = this.project(m.x, m.y, this.s, 30, 30);
    }
    this.lost = !found;
    // On a shortcut's part of the route but clearly outside the shortcut (the mouth missed and
    // left behind): give it up at once and race on, rather than scraping along the street wall
    // toward an alley it has passed.
    // And the other way round: inside a shortcut its route does not take (pushed in, or it ran
    // in), it is driving that shortcut now.
    if (found) {
      const r = this.route;
      const i = sampleIndex(r, this.s);
      const outside = Math.abs(this.lateral) - r.halfWidth[i]!;
      if (r.src[i] !== 0 && outside > MISSED_MOUTH) {
        this.abandonShortcut(m.x, m.y);
        this.project(m.x, m.y, this.s, 30, 30);
      } else if (r.src[i] === 0 && outside > IN_SHORTCUT && this.adoptShortcut(m.x, m.y))
        this.project(m.x, m.y, this.s, 30, 30);
    }
  }

  /** Takes the shortcut the car is in, when its route does not (it was pushed in, or ran in). */
  private adoptShortcut(x: number, y: number): boolean {
    const loc = this.loc;
    locate(this.track, x, y, loc);
    const k = loc.branch;
    if (k === 0 || this.takes(k) || Math.abs(loc.lateral) > loc.halfWidth) return false;
    const next = this.mask | (1 << (k - 1));
    if (!this.plan.routes[next]) return false;
    this.mask = next;
    this.decided[k] = 1;
    this.relocate(x, y);
    return true;
  }

  /** Finds the car's place on the route from scratch (start, or after being lost). */
  private relocate(x: number, y: number): void {
    const loc = this.loc;
    locate(this.track, x, y, loc);
    if (loc.branch !== 0 && !this.takes(loc.branch)) {
      // It is in a shortcut it had not planned on: it is driving it now.
      const next = this.mask | (1 << (loc.branch - 1));
      if (this.plan.routes[next]) this.mask = next;
    }
    const r = this.route;
    // The sample of that branch on this route nearest the located arc length.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < r.count; i++) {
      if (r.src[i] !== loc.branch) continue;
      const d = Math.hypot(r.x[i]! - loc.cx, r.y[i]! - loc.cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.s = r.s[best]!;
  }

  /** Nearest point on the route within a window around `guess`. False when far off it. */
  private project(x: number, y: number, guess: number, back: number, ahead: number): boolean {
    const r = this.route;
    const n = r.count;
    const i0 = sampleIndex(r, guess);
    let best = Infinity;
    let bestS = guess;
    let bestLat = 0;
    let bestReach = 0;
    for (let o = -back; o <= ahead; o++) {
      const i = (((i0 + o) % n) + n) % n;
      const j = (i + 1) % n;
      const ax = r.x[i]!;
      const ay = r.y[i]!;
      const abx = r.x[j]! - ax;
      const aby = r.y[j]! - ay;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 1e-12 ? clamp(((x - ax) * abx + (y - ay) * aby) / len2, 0, 1) : 0;
      const cx = ax + abx * t;
      const cy = ay + aby * t;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) {
        best = d;
        const len = Math.sqrt(len2) || 1;
        bestS = r.s[i]! + len * t;
        bestLat = ((x - cx) * -aby + (y - cy) * abx) / len;
        bestReach = r.halfWidth[i]! + 200;
      }
    }
    if (best > bestReach) return false;
    this.s = bestS % r.length;
    this.lateral = bestLat;
    return true;
  }

  /**
   * Whether a wall or an obstacle stands between the car and its lane a little ahead (the
   * point it would steer for), swept with the car's own radius.
   */
  private wayBlocked(x: number, y: number, radius: number, ahead: number): boolean {
    const at = this.s + ahead;
    this.pointAt(at, this.aimPoint);
    const edge = this.edgeAt(at);
    const lane = clamp(this.lineOffset(at) + this.bias, -edge, edge);
    const tx = this.aimPoint.x - this.aimPoint.ty * lane;
    const ty = this.aimPoint.y + this.aimPoint.tx * lane;
    this.rejoin.x = tx;
    this.rejoin.y = ty;
    const d = Math.hypot(tx - x, ty - y);
    const steps = Math.max(1, Math.ceil(d / 12));
    for (let k = 1; k <= steps; k++) {
      const px = x + ((tx - x) * k) / steps;
      const py = y + ((ty - y) * k) / steps;
      if (
        wallDepth(this.track, px, py, radius) > 0 ||
        obstacleDepth(this.track, px, py, radius) > 0
      )
        return true;
      if (this.track.walled) {
        locate(this.track, px, py, this.loc);
        if (this.loc.edge + radius > 0) return true;
      }
    }
    return false;
  }

  /** Route distance from the car to `s` ahead, wrapped to [0, length). */
  ahead(s: number): number {
    const len = this.route.length;
    return (((s - this.s) % len) + len) % len;
  }

  /**
   * The speed plan: fastest allowed speed now, from the route ahead under the grip the car has
   * now. `gripScale` is what statuses and damage are doing to the car's cornering.
   */
  planSpeed(car: CombatCar, speed: number, gripScale: number): number {
    const skill = this.persona.skill;
    const params = car.session.params;
    const r = this.route;
    const conf = Math.sqrt(skill.cornerConfidence * gripScale);
    const decel0 = params.brakeDecel * Math.max(0.3, gripScale) * skill.brakeConfidence;
    const horizon = ((speed * speed) / (2 * decel0)) * skill.horizonFactor + skill.horizonExtra;
    // Off the line (passing, avoiding) the car corners on a tighter arc: keep some margin. And
    // a car that is still well off its lane (knocked aside, running wide, just switched to a
    // shortcut's line) must get back to it before the next bend or gap: the further off, the
    // more margin, and a narrow passage ahead is entered only once the car is lined up for it
    // (found by the bot tournament: cars arriving 20 to 50 px off the line at Conveyor Gap at
    // full pace and clipping the entrance).
    const miss = Math.max(0, Math.abs(this.lateral - (this.lineOffset(this.s) + this.bias)) - 8);
    const off = 1 - Math.min(0.25, Math.abs(this.bias) / 500 + miss / 250);
    let allowed = Infinity;
    const lockShare = params.maxSteerCurvature * LOCK_SHARE;
    for (let d = 0; d <= horizon; d += 20) {
      const i = sampleIndex(r, this.s + d);
      let limit = r.limit[i]! * conf * off;
      if (miss > r.edge[i]! && r.edge[i]! < NARROW_EDGE)
        limit = Math.min(limit, NARROW_LINE_UP_SPEED + 4 * r.edge[i]!);
      // A narrow passage whose line asks for most of full lock leaves no steering in hand for an
      // error and no road to run wide on: take it slowly, so the error stays small (a Rookie at
      // 103 px/s into Lantern Alley's posts on a rainy night). A wide street corner as tight is
      // taken at its grip limit as before.
      if (r.edge[i]! < NARROW_EDGE && Math.abs(r.curvature[i]!) > lockShare)
        limit = Math.min(limit, FULL_LOCK_SPEED);
      const decel = params.brakeDecel * r.grip[i]! * gripScale * skill.brakeConfidence + r.roll[i]!;
      const entry = Math.sqrt(limit * limit + 2 * decel * d);
      if (entry < allowed) allowed = entry;
    }
    this.holding = false;
    const crossing = this.crossingLimit(car, speed, horizon);
    if (crossing < allowed) {
      allowed = crossing;
      this.holding = true;
    }
    this.allowed = allowed;
    return allowed;
  }

  /** A stop short of a rail crossing that will be down while the car would be on it. */
  private crossingLimit(car: CombatCar, speed: number, horizon: number): number {
    const track = this.track;
    if (track.crossings.length === 0) return Infinity;
    const skill = this.persona.skill;
    const clock = car.session.raceTicks;
    const r = this.route;
    let limit = Infinity;
    const look = horizon + speed * skill.hazardForesight + 60;
    for (const rh of track.routeHazards) {
      const hz = track.hazards[rh.hazard]!;
      if (hz.kind !== 'crossing') continue;
      // Where the barrier is on this route, if the route goes over it at all.
      let at = -1;
      if (rh.branch === 0) {
        const step = track.main.length / track.main.count;
        at = r.mainIndex[Math.floor(rh.s / step) % track.main.count]!;
      } else if (this.takes(rh.branch))
        for (let i = 0; i < r.count; i++)
          if (r.src[i] === rh.branch && track.branches[rh.branch]!.s[r.srcIndex[i]!]! >= rh.s) {
            at = i;
            break;
          }
      if (at < 0) continue;
      const d = this.ahead(r.s[at]!);
      if (d > look) continue;
      const now = scheduleState(hz.schedule, clock * SIM_DT);
      if (d < 28 && now.phase !== 'active') continue;
      const eta = d / Math.max(speed, 60);
      const margin = 0.6;
      const when = scheduleState(hz.schedule, clock * SIM_DT + eta - margin);
      if (when.phase === 'idle' && when.secondsLeft > margin * 2) continue;
      const room = Math.max(0, d - 34);
      const stop = Math.sqrt(2 * car.session.params.brakeDecel * 0.6 * room);
      if (stop < limit) limit = stop;
    }
    return limit;
  }

  private readonly aimPoint = { x: 0, y: 0, tx: 0, ty: -1 };
  private readonly p0 = { x: 0, y: 0 };
  private readonly p1 = { x: 0, y: 0 };
  private readonly p2 = { x: 0, y: 0 };
  private readonly p3 = { x: 0, y: 0 };
  private readonly q0 = { x: 0, y: 0 };
  private readonly q1 = { x: 0, y: 0 };
  private readonly q2 = { x: 0, y: 0 };

  /**
   * Steering and pedals toward the lane at the aim point, at no more than the plan allows.
   * Writes the steering, brake and coast fields of `out`.
   */
  drive(car: CombatCar, out: ControlInput, rng: () => number, racing: boolean): void {
    const skill = this.persona.skill;
    const session = car.session;
    const m = session.motion;
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const fx = Math.sin(m.headingRad);
    const fy = -Math.cos(m.headingRad);
    const forward = m.velocityX * fx + m.velocityY * fy;

    // Line error: a slow random wander about the line.
    const k = SIM_DT / skill.lineErrorSeconds;
    this.wander += -this.wander * k + skill.lineError * Math.sqrt(2 * k) * gauss(rng);
    // Any driver concentrates in a tight spot: the wander shrinks with the room there is.
    const r = this.route;
    const here = sampleIndex(r, this.s + 20);
    const room = r.hi[here]! - r.lo[here]!;
    const wander = this.wander * clamp(room / 70, 0.15, 1);
    // Tactics move the bias toward their wish at a limited rate, and slower in a bend, where a
    // lane change unwinding at the apex throws the car wide (found on Steel Circuit).
    const bend = Math.abs(r.curvature[sampleIndex(r, this.s + 30)]!) > BEND_CURVATURE;
    const rate = bend ? LANE_RATE_BEND : LANE_RATE;
    this.bias += clamp(this.biasWish - this.bias, -rate, rate);

    // Steering: a Stanley-type tracker on the lane (line, bias and wander). The lane's own
    // heading a little ahead, turned toward the lane by the cross-track error, plus the yaw the
    // lane's curvature asks for, all through the car's own yaw response at this speed (the
    // controller of `directionToControl`). It holds the line through a bend instead of cutting
    // inside it as pure pursuit does.
    const v = Math.max(0, forward);
    const preview = 6 + 0.12 * v;
    const laneAt = (at: number, out: { x: number; y: number }) => {
      const edge = this.edgeAt(at);
      const lane = clamp(this.lineOffset(at) + this.bias + wander, -edge, edge);
      this.pointAt(at, this.aimPoint);
      out.x = this.aimPoint.x - this.aimPoint.ty * lane;
      out.y = this.aimPoint.y + this.aimPoint.tx * lane;
      return lane;
    };
    const a = this.p0;
    const b = this.p1;
    const c = this.p2;
    laneAt(this.s + preview - 16, a);
    laneAt(this.s + preview, b);
    laneAt(this.s + preview + 16, c);
    const laneHeading = headingFromVector(c.x - a.x, c.y - a.y);
    const laneHere = laneAt(this.s, this.p3);
    let cross = laneHere - this.lateral;
    // Far off the lane (run wide onto open ground, behind a snow bank): head back only where the
    // way is clear; otherwise run along the road until it is. Steering straight at the lane
    // drove cars into the bank they were behind (Whiteout Pass).
    this.blocked = false;
    let rejoinHeading = Number.NaN;
    if (Math.abs(cross) > REJOIN_CHECK) {
      // The nearest point of the lane ahead that can be reached in a straight line: through a
      // gap in a tree line, past the end of a bank. None: run along the road.
      const radius = session.params.colliderRadius;
      let clear = false;
      for (const d of REJOIN_AHEAD) {
        if (!this.wayBlocked(m.x, m.y, radius, d + 0.4 * v)) {
          clear = true;
          if (d !== REJOIN_AHEAD[0])
            rejoinHeading = headingFromVector(this.rejoin.x - m.x, this.rejoin.y - m.y);
          break;
        }
      }
      if (!clear) {
        this.blocked = true;
        cross = 0;
      }
    }
    const wanted = Number.isNaN(rejoinHeading)
      ? laneHeading + Math.atan2(CROSS_GAIN * cross, Math.max(25, v))
      : rejoinHeading;
    const error = angleDelta(m.headingRad, wanted);
    // The yaw the lane's curvature asks for, read where the car will be once the steering and
    // the yaw have caught up (`STEER_LAG` s ahead), so a sharp turn-in (a right-angle alley
    // mouth) is begun in time rather than a car length late. Taken as the stronger of here and
    // there, so the end of a bend is not let go early.
    const kappaHere = signedCurvature(a.x, a.y, b.x, b.y, c.x, c.y);
    const lagAhead = preview + v * STEER_LAG;
    laneAt(this.s + lagAhead - 16, this.q0);
    laneAt(this.s + lagAhead, this.q1);
    laneAt(this.s + lagAhead + 16, this.q2);
    const kappaThere = signedCurvature(
      this.q0.x,
      this.q0.y,
      this.q1.x,
      this.q1.y,
      this.q2.x,
      this.q2.y,
    );
    const kappa = Math.abs(kappaThere) > Math.abs(kappaHere) ? kappaThere : kappaHere;
    const feedYaw = v * kappa;
    const grip = session.telemetry.grip > 0 ? session.telemetry.grip : 1;
    const gain = Math.max(steerYawGain(session.params, v, grip), HEADING_MIN_YAW_GAIN);
    const yaw = feedYaw + HEADING_GAIN * (error - HEADING_DAMPING * (m.yawRate - feedYaw));
    // Its own damage, as a driver feels it: a damaged steering rack turns less for the same
    // input and a damaged wheel pulls to one side (`effects.steerScale` and `steerBias`, which
    // the physics applies to the command). Ask for the turn it wants after them; without this
    // a battered car weaved (Backstreet Blitz).
    const fx_ = session.effects;
    let want = yaw / gain;
    if (fx_.steerScale !== 1 || fx_.steerBias !== 0)
      want = (want - fx_.steerBias) / Math.max(0.35, fx_.steerScale);
    let steer = clamp(want, -1, 1);
    const point = this.aimPoint;
    this.pointAt(this.s + 34 + 0.3 * v, point);

    let allowed = Math.min(this.allowed, this.speedWish);
    if (this.blocked) allowed = Math.min(allowed, 160);
    let pull = 0;
    if (speed > allowed + 1) {
      // Brake in proportion to the overspeed, but firmly: the plan assumes `brakeConfidence` of
      // the car's braking, and a softer pedal over a 40 px/s band delivered about 60 percent of
      // it, which carried cars past the posts of Lantern Alley (bot tournament).
      const lift = clamp((speed - allowed) / 14, 0.3, 1);
      pull = BRAKE_LIFT_THRESHOLD + lift * (1 - BRAKE_LIFT_THRESHOLD);
    }
    let coast = false;
    // Heat: thermal protection costs a third of the engine until the core is back down to the
    // recovery temperature, which on a hot day is most of a lap. Just short of it, ease off on
    // a straight (every other tick on the gentle throttle) so the car never trips it. Below
    // that the performance loss is gradual and running hot is quicker than lifting (measured).
    // Not on loose ground, where a lift costs more speed than the protection does.
    if (
      skill.carCraft &&
      pull === 0 &&
      !m.thermalLimited &&
      m.coreHeat > HEAT_PROTECTION - 3 &&
      Math.abs(steer) < 0.25 &&
      session.telemetry.surface !== 'sand' &&
      session.telemetry.surface !== 'mud' &&
      session.telemetry.surface !== 'snow' &&
      session.telemetry.surface !== 'dirt'
    ) {
      this.coastPhase = (this.coastPhase + 1) % 2;
      if (this.coastPhase !== 0) coast = true;
    }

    // Pinned nose-first, or turned round: back out with the wheels turned toward the road.
    const pathHeading = headingFromVector(point.tx, point.ty);
    const turnedRound = Math.abs(angleDelta(m.headingRad, pathHeading)) > 115 * DEG;
    if (!racing || this.holding) this.stuckTicks = 0;
    else if ((speed < 10 || (turnedRound && speed < 40)) && !m.reversing) this.stuckTicks++;
    else if (speed > 28 && !turnedRound) this.stuckTicks = 0;
    if (this.reverseTicks > 0) {
      this.reverseTicks--;
      out.steer = this.reverseSteer;
      out.brake = 1;
      out.coast = false;
      return;
    }
    if (this.stuckTicks > 36) {
      this.stuckTicks = 0;
      this.recoveries++;
      // A second try from the same place backs out further, and from the third it gives up a
      // shortcut it has already overshot (its mouth behind or beside the car, the car still on
      // the main road), and turns the other way: one move repeated is a loop.
      const again = Math.abs(this.s - this.lastRecoveryS) < 80;
      this.repeats = again ? this.repeats + 1 : 0;
      this.lastRecoveryS = this.s;
      if (this.repeats >= 2) this.abandonShortcut(m.x, m.y);
      this.reverseTicks = Math.round(
        (26 + Math.floor(rng() * 14)) * Math.min(2.4, 1 + 0.45 * this.repeats),
      );
      // In reverse the wheels turn the tail: steer away from the way the nose should go.
      const side = -Math.sign(error || 1);
      this.reverseSteer = this.repeats >= 3 && this.repeats % 2 === 1 ? -side : side;
    }
    if (turnedRound && speed < 60) steer = Math.sign(error) || 1;

    out.steer = coast ? 0 : steer;
    out.brake = pull;
    out.coast = coast;
  }
}

const TIGHT = new WeakMap<RouteLine, Float32Array>();

/**
 * Per sample of a route: how much a shallow planner must follow the real line there, 0 to 1,
 * from the tightest line curvature within `TIGHT_LOOKAHEAD` px ahead. Worked out once a route.
 */
function tightAhead(r: RouteLine): Float32Array {
  let out = TIGHT.get(r);
  if (out) return out;
  out = new Float32Array(r.count);
  for (let i = 0; i < r.count; i++) {
    let tight = 0;
    for (let d = 0; d <= TIGHT_LOOKAHEAD; d += 20)
      tight = Math.max(tight, Math.abs(r.curvature[sampleIndex(r, r.s[i]! + d)]!));
    out[i] = clamp((tight - TIGHT_FROM) / (TIGHT_FULL - TIGHT_FROM), 0, 1);
  }
  TIGHT.set(r, out);
  return out;
}

/** Signed curvature of the circle through three points, positive bending right, 1/px. */
function signedCurvature(
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

/** Standard normal from two uniforms (Box-Muller). */
function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
