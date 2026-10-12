import { SIM_DT, SURFACE_ROLLING_DECEL } from '../balance.js';
import { STATUS_INDEX } from '../combat/types.js';
import { scheduleState } from '../hazards.js';
import { clamp, lerp } from '../math.js';
import type { TrackRuntime } from '../track.js';
import type { Observation, RivalView } from './observe.js';
import type { Pilot } from './pilot.js';
import type { AiPersona } from './profile.js';
import { sampleIndex } from './route.js';

/**
 * Where the AI wants to be across the road, and which way round the course: shortcuts, the
 * pass and the defence, going round traps it has been shown and shells it can see coming, and
 * lining the car up when its weapons ask. It reads the rival only through the observation, as
 * it was `reactionTicks` ago (a driver acts on what it saw a moment before), and sets the
 * pilot's `biasWish` (px from the racing line) and `speedWish`.
 */

/** Where something is relative to the car's own route. */
export type Relation = { along: number; lateral: number; near: boolean };

type Seen = { x: number; y: number; vx: number; vy: number; heading: number; speed: number };

const HISTORY = 24;
/** Seconds a deep planner counts against a shortcut whose line needs nearly full lock. */
const HAIRPIN_RISK = 0.35;
const TIGHTEST = new WeakMap<object, number[]>();

/** The tightest line curvature on shortcut `k` of the pilot's plan, 1/px (cached per plan). */
function tightestOf(pilot: Pilot, k: number): number {
  let row = TIGHTEST.get(pilot.plan);
  if (!row) {
    row = [];
    TIGHTEST.set(pilot.plan, row);
  }
  let v = row[k];
  if (v === undefined) {
    v = 0;
    const r = pilot.plan.routes[1 << (k - 1)];
    if (r)
      for (let i = 0; i < r.count; i++)
        if (r.src[i] === k) v = Math.max(v, Math.abs(r.curvature[i]!));
    row[k] = v;
  }
  return v;
}

/** How much more of a shortcut than of the road it skips must be poor ground to be a bog. */
const VISIBLY_WORSE = 0.25;
const MAIN_POOR = new WeakMap<object, number[]>();

/**
 * The share of poor ground (more rolling resistance than dirt, or grip under 0.6, for this car)
 * on the main line between where shortcut `k` leaves and rejoins it: what the shortcut is
 * compared with. Cached per plan.
 */
function mainPoorShare(pilot: Pilot, track: TrackRuntime, k: number): number {
  let row = MAIN_POOR.get(pilot.plan);
  if (!row) {
    row = [];
    MAIN_POOR.set(pilot.plan, row);
  }
  let v = row[k];
  if (v === undefined) {
    const base = pilot.plan.routes[0]!;
    const branch = track.branches[k]!;
    const lap = track.main.length;
    const span = (((branch.rejoinS - branch.leaveS) % lap) + lap) % lap;
    const step = lap / track.main.count;
    let poor = 0;
    let count = 0;
    for (let d = 0; d <= span; d += step) {
      const main = Math.floor((((branch.leaveS + d) % lap) / step) % track.main.count);
      const i = base.mainIndex[main]!;
      count++;
      if (base.roll[i]! > SURFACE_ROLLING_DECEL.dirt + 4 || base.grip[i]! < 0.6) poor++;
    }
    v = poor / Math.max(1, count);
    row[k] = v;
  }
  return v;
}

/** The other car counts as level with this one up to this far ahead, px. */
const LEVEL_AHEAD = 22;
/** Seconds after GO in which nobody leans on the other car: the scramble off the grid. */
const MERGE_SECONDS = 4;

export class Tactics {
  /** Ring buffer of what the rival looked like, newest last. */
  private readonly history: Seen[] = Array.from({ length: HISTORY }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    heading: 0,
    speed: 0,
  }));
  private head = 0;
  private filled = 0;
  /** The rival as perceived now (delayed and extrapolated by planning depth). */
  readonly seen: Seen = { x: 0, y: 0, vx: 0, vy: 0, heading: 0, speed: 0 };
  readonly rel: Relation = { along: 0, lateral: 0, near: false };
  /** Asked for by the weapons: an absolute lateral to line up on, or NaN. Cleared each tick. */
  alignWish = Number.NaN;
  /** Committed pass side, +1 right, -1 left, 0 none, and ticks it is held. */
  private passSide = 0;
  private passHold = 0;
  /** A shortcut taken to pass or defend, decided on its own. */
  private readonly scratch: Relation = { along: 0, lateral: 0, near: false };
  /** Ticks the rival has been close behind, for defending. */
  private pressure = 0;
  private readonly band = { lo: 0, hi: 0 };

  constructor(
    private readonly pilot: Pilot,
    private readonly persona: AiPersona,
    private readonly shortcutPolicy: 'plan' | 'always' | 'never' = 'plan',
  ) {}

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.alignWish = Number.NaN;
    this.passSide = 0;
    this.passHold = 0;
    this.pressure = 0;
  }

  /** Where a world point is relative to the route the car follows. */
  relate(x: number, y: number, out: Relation): Relation {
    const pilot = this.pilot;
    const r = pilot.route;
    const n = r.count;
    const i0 = sampleIndex(r, pilot.s);
    let best = Infinity;
    let bestS = 0;
    let bestLat = 0;
    for (let o = -30; o <= 45; o++) {
      const i = (((i0 + o) % n) + n) % n;
      const j = (i + 1) % n;
      const ax = r.x[i]!;
      const ay = r.y[i]!;
      const abx = r.x[j]! - ax;
      const aby = r.y[j]! - ay;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 1e-12 ? clamp(((x - ax) * abx + (y - ay) * aby) / len2, 0, 1) : 0;
      const d = Math.hypot(x - (ax + abx * t), y - (ay + aby * t));
      if (d < best) {
        best = d;
        const len = Math.sqrt(len2) || 1;
        bestS = r.s[i]! + len * t;
        bestLat = ((x - ax - abx * t) * -aby + (y - ay - aby * t) * abx) / len;
      }
    }
    out.near = best <= r.halfWidth[i0]! + 60;
    let along = bestS - pilot.s;
    if (along > r.length / 2) along -= r.length;
    else if (along < -r.length / 2) along += r.length;
    out.along = along;
    out.lateral = bestLat;
    return out;
  }

  /** Records the rival and reads it back as perceived, `reactionTicks` late. */
  private perceive(rival: RivalView): Seen {
    const slot = this.history[this.head]!;
    slot.x = rival.x;
    slot.y = rival.y;
    slot.vx = rival.velocityX;
    slot.vy = rival.velocityY;
    slot.heading = rival.headingRad;
    slot.speed = rival.speed;
    this.head = (this.head + 1) % HISTORY;
    this.filled = Math.min(HISTORY, this.filled + 1);
    const skill = this.persona.skill;
    const delay = Math.min(skill.reactionTicks, this.filled - 1);
    const old = this.history[(this.head - 1 - delay + HISTORY * 2) % HISTORY]!;
    // A driver predicts a little where the car it saw has gone since; how well is planning.
    const ahead = delay * SIM_DT * skill.leadShare;
    const s = this.seen;
    s.x = old.x + old.vx * ahead;
    s.y = old.y + old.vy * ahead;
    s.vx = old.vx;
    s.vy = old.vy;
    s.heading = old.heading;
    s.speed = old.speed;
    return s;
  }

  decide(track: TrackRuntime, obs: Observation, rng: () => number): void {
    const pilot = this.pilot;
    const car = obs.self;
    const m = car.session.motion;
    const params = car.session.params;
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const skill = this.persona.skill;
    const style = this.persona.style;
    pilot.speedWish = Infinity;
    const lineHere = pilot.lineOffset(pilot.s);
    const edgeHere = pilot.edgeAt(pilot.s);
    let wish = 0;
    let priority = 0;
    let beside = false;
    let besideAhead = 0;
    let besideLat = 0;
    let besideGap = 0;
    let besideSpeed = 0;

    // --- Shortcuts: decided once an approach, a second and a half before the mouth --------
    if (obs.racing) this.decideShortcuts(track, obs, speed, rng);

    // --- The rival -------------------------------------------------------------------------
    const rival = obs.rival;
    this.rel.near = false;
    if (rival.present && rival.racing && obs.racing) {
      const seen = this.perceive(rival);
      const rel = this.relate(seen.x, seen.y, this.rel);
      if (rel.near) {
        const gap = params.colliderRadius + rival.params.colliderRadius + 10;
        const rivalAlong = (seen.vx * m.velocityX + seen.vy * m.velocityY) / Math.max(1, speed);
        const closing = speed - rivalAlong;
        const lateralGap = rel.lateral - pilot.lateral;
        const ahead = rel.along;
        if (ahead > 8 && ahead < style.passReach + Math.max(0, closing) * 0.8) {
          // Coming up behind: commit to a side and hold it.
          if (closing > style.passClosing || ahead < 40) {
            if (this.passHold <= 0 || this.passSide === 0) {
              this.passSide = this.chooseSide(rel.lateral, edgeHere, gap);
              this.passHold = 45;
            }
            const roomOnSide = this.passSide > 0 ? edgeHere - rel.lateral : rel.lateral + edgeHere;
            if (roomOnSide >= gap * 1.05) {
              wish = rel.lateral + this.passSide * gap * 1.15 - lineHere;
              priority = 2;
            } else if (ahead < 46 && Math.abs(lateralGap) < gap) {
              // No way past yet: do not drive into its back by accident (unless that is the plan).
              const ram = style.leans && params.massKg > rival.params.massKg * 1.15;
              if (!ram) pilot.speedWish = Math.max(40, rivalAlong + 4);
            }
          }
        } else if (ahead >= -26 && ahead <= 8) {
          // Alongside: keep a car's width, or lean on it. Not in the scramble off the grid,
          // where nobody has chosen a fight yet.
          const ram =
            style.leans &&
            obs.self.session.raceTicks * SIM_DT > MERGE_SECONDS &&
            (params.massKg > rival.params.massKg * 1.1 || car.bladeDamage > 0) &&
            Math.abs(lateralGap) < gap * 1.6;
          const side = Math.sign(lateralGap) || 1;
          if (ram) {
            wish = rel.lateral - side * gap * 0.55 - lineHere;
            priority = 2;
          }
        } else if (ahead < -8 && ahead > -150 && style.defends > 0) {
          // Followed closely: cover the line it would pass on, once, without weaving.
          const behindClosing = -closing;
          if (behindClosing > -6) this.pressure = Math.min(90, this.pressure + 1);
          else this.pressure = Math.max(0, this.pressure - 2);
          if (this.pressure > 12) {
            let cover = rel.lateral;
            if (skill.cornerCraft) {
              const inside = this.cornerSide(120, 420);
              if (inside !== 0) cover = inside * edgeHere * 0.6;
            }
            const target = lerp(lineHere, cover, 0.55 * style.defends);
            wish = target - lineHere;
            priority = 1;
          }
        }
        // Close enough to touch: the side-by-side rule below applies after the weapons have
        // had their say.
        // Straight ahead on the same line is a car to follow, not one to dodge.
        const inLine = ahead > 8 && Math.abs(lateralGap) < gap * 0.6;
        if (!inLine && ahead > -26 && ahead < 60 + Math.max(0, closing) * 0.6) {
          beside = true;
          besideAhead = ahead;
          besideLat = rel.lateral;
          besideGap = gap;
          besideSpeed = rivalAlong;
        } else if (priority < 2 && ahead > 8 && ahead < 50 && closing > 0) {
          // Right behind it: do not run into its back while waiting for room.
          const ram = style.leans && params.massKg > rival.params.massKg * 1.15;
          if (!ram) pilot.speedWish = Math.min(pilot.speedWish, Math.max(40, rivalAlong + 4));
        }
      }
    }
    if (this.passHold > 0) this.passHold--;
    else if (priority < 2) this.passSide = 0;

    // --- The weapons want the car lined up ---------------------------------------------------
    if (!Number.isNaN(this.alignWish) && priority < 2) {
      wish = this.alignWish - lineHere;
      priority = 1;
    }
    this.alignWish = Number.NaN;

    // --- Side by side ----------------------------------------------------------------------
    // Never steer across a car that is beside it or just ahead, whatever the line, the defence
    // or the weapons want. The car whose lane crosses the other's is the one that gives way: it
    // holds its own side and, level or behind, lifts so as to cross behind. The other keeps its
    // lane and only moves over from an actual overlap. This is the grid (the slots are side by
    // side and the line from one often runs across the other; on Backstreet Blitz the second
    // slot turns across the first into Laundry Lane at once) and every side-by-side moment
    // after it. A pass already chose a side with room, and a ram is meant.
    if (beside && priority < 2) {
      const mine = pilot.lateral - besideLat;
      const side = -(Math.sign(mine) || 1);
      const lane = lineHere + wish;
      const laneSide = Math.sign(lane - besideLat);
      const apart = besideLat - side * besideGap * 1.1;
      // Room on this side for a car's width: keeping apart must not mean the wall. The band of
      // clear ground, not the pavement's edge: it leaves out the corner where a shortcut leaves.
      const band = pilot.bandAt(pilot.s + 20, this.band);
      const room = apart >= band.lo - 2 && apart <= band.hi + 2;
      if (laneSide === side || (besideAhead <= 8 && Math.abs(lane - besideLat) < besideGap * 0.5)) {
        // Its lane is across the other car: stay on this side of it, and give way. Lifting is
        // for while the two are level and the other is ahead; once it is clear ahead it opens
        // the way by itself (lifting all the while cost two evenly matched cars a quarter of
        // their pace).
        if (room) wish = apart - lineHere;
        priority = 2;
        // Only the car behind lifts. Both lifting to the other's speed less a margin spiralled
        // two evenly matched cars down to a crawl together (Dust Devil, lap 3).
        if ((besideAhead > 0 && besideAhead < LEVEL_AHEAD) || !room)
          pilot.speedWish = Math.min(pilot.speedWish, Math.max(25, besideSpeed - (room ? 12 : 30)));
      } else if (besideAhead <= 8 && Math.abs(mine) < besideGap) {
        // Overlapping alongside: back to a car's width apart, or, squeezed against the edge,
        // drop behind (found on Backstreet Blitz: a car cutting across to Laundry Lane pressed
        // the other into the alley mouth).
        if (room) wish = apart - lineHere;
        else pilot.speedWish = Math.min(pilot.speedWish, Math.max(25, besideSpeed - 30));
        priority = 2;
      }
    }

    // --- Traps it can see, and shells coming down --------------------------------------------
    const avoid = this.avoidance(obs, speed, lineHere + wish, edgeHere);
    if (!Number.isNaN(avoid)) wish = avoid - lineHere;

    pilot.biasWish = clamp(wish, -edgeHere - lineHere, edgeHere - lineHere);
  }

  /** The side of the next real bend between `from` and `to` px ahead: +1 right, -1 left, 0 none. */
  cornerSide(from: number, to: number): number {
    const pilot = this.pilot;
    const r = pilot.route;
    let strongest = 0;
    for (let d = from; d <= to; d += 40) {
      const k = r.curvature[sampleIndex(r, pilot.s + d)]!;
      if (Math.abs(k) > Math.abs(strongest)) strongest = k;
    }
    return Math.abs(strongest) > 1 / 420 ? Math.sign(strongest) : 0;
  }

  private chooseSide(rivalLat: number, edge: number, gap: number): number {
    const right = edge - rivalLat;
    const left = rivalLat + edge;
    if (this.persona.skill.cornerCraft) {
      const inside = this.cornerSide(60, 360);
      if (inside > 0 && right >= gap * 1.05) return 1;
      if (inside < 0 && left >= gap * 1.05) return -1;
    }
    return right >= left ? 1 : -1;
  }

  private decideShortcuts(
    track: TrackRuntime,
    obs: Observation,
    speed: number,
    rng: () => number,
  ): void {
    const pilot = this.pilot;
    const skill = this.persona.skill;
    for (const value of pilot.plan.shortcuts) {
      const k = value.branch;
      const fork = pilot.route.forkS[k]!;
      if (fork < 0) continue;
      // Once per approach to the fork, not once per lap: a fork just past the start line (Laundry
      // Lane leaves the boulevard 56 px after it) would otherwise be decided only when the lap
      // count ticks over, too late to brake for the mouth.
      const ahead = pilot.ahead(fork);
      const reach = 80 + speed * 2.2;
      if (ahead > reach + 150) {
        pilot.decided[k] = 0;
        continue;
      }
      if (pilot.decided[k] === 1 || ahead > reach || ahead < 12) continue;
      pilot.decided[k] = 1;
      let take = false;
      // A passage that asks for nearly full lock (Lantern Alley's right-angle mouth) is a risk
      // to any driver; a shallow planner goes for it half as often, a deep one counts it.
      const hairpin = tightestOf(pilot, k) > obs.self.session.params.maxSteerCurvature * 0.8;
      if (skill.shortcutDepth === 1) {
        // A shallow planner sees a shorter road and sometimes goes for it, unless it can see
        // the road is a bog: much more of the shortcut is poor ground than of the road it skips
        // (Moss Run's Marsh Track, 30 s a race slower, used to take three Rookie laps in five).
        const bog = value.poorShare > mainPoorShare(pilot, track, k) + VISIBLY_WORSE;
        take = !bog && value.naiveGain > 0.25 && rng() < (hairpin ? 0.28 : 0.55);
      } else if (skill.shortcutDepth === 2) {
        // Risk: a way barely wider than the car punishes line error, and a touch on a pillar or
        // a barricade costs more than the shortcut saves (measured: Conveyor Gap).
        const width = value.narrowest - 2 * obs.self.session.params.colliderRadius;
        const tight = Math.max(0, 1 - width / 40);
        const risk = tight * tight * (0.5 + skill.lineError * 0.1);
        let gain =
          value.gain -
          risk -
          (hairpin ? HAIRPIN_RISK : 0) +
          this.crossingWait(track, obs, k, speed);
        // Racing the other car through it: a different road is a way past, or a way to hold on.
        if (this.rel.near && Math.abs(this.rel.along) < 90) gain += 0.08;
        take = gain > this.persona.style.shortcutGain;
      }
      // Off the grid side by side, nobody dives across the other car for a shortcut (Laundry
      // Lane forks 56 px past Backstreet Blitz's start line, across the first slot).
      if (
        take &&
        obs.self.session.raceTicks * SIM_DT < MERGE_SECONDS &&
        this.rel.near &&
        Math.abs(this.rel.along) < 60
      )
        take = false;
      if (this.shortcutPolicy === 'always') take = true;
      else if (this.shortcutPolicy === 'never') take = false;
      const bit = 1 << (k - 1);
      pilot.setRoute(take ? pilot.mask | bit : pilot.mask & ~bit);
    }
    void track;
  }

  /**
   * Seconds the car would wait at a rail crossing that a shortcut goes round, if it stayed on
   * the main line: read from the published timetable for the time it would get there.
   */
  private crossingWait(track: TrackRuntime, obs: Observation, k: number, speed: number): number {
    const pilot = this.pilot;
    const branch = track.branches[k]!;
    const lap = track.main.length;
    const span = (((branch.rejoinS - branch.leaveS) % lap) + lap) % lap;
    let wait = 0;
    for (const rh of track.routeHazards) {
      const hz = track.hazards[rh.hazard]!;
      if (hz.kind !== 'crossing' || rh.branch !== 0) continue;
      const into = (((rh.s - branch.leaveS) % lap) + lap) % lap;
      if (into > span) continue;
      // How far ahead the barrier is on the main line, and when the car would be at it: on
      // the route's average pace, give or take a second, since the road between can change it.
      const fork = pilot.route.forkS[k]!;
      const d = pilot.ahead(fork) + into;
      const pace = pilot.route.length / Math.max(1, pilot.route.lapSeconds);
      const eta = d / Math.max(80, (pace + speed) / 2);
      const now = obs.self.session.raceTicks * SIM_DT;
      const sch = hz.schedule;
      let expected = 0;
      const offsets = [-1, -0.5, 0, 0.5, 1];
      for (const o of offsets) {
        const at = scheduleState(sch, now + eta + o);
        // As the speed plan holds for it: from just before the warning to the end of the closing.
        let w = 0;
        if (at.phase === 'active') w = at.secondsLeft;
        else if (at.phase === 'warning') w = at.secondsLeft + sch.activeSeconds;
        else if (at.secondsLeft <= 1.2) w = at.secondsLeft + sch.warnSeconds + sch.activeSeconds;
        if (w > 0) w += 0.6;
        expected += w / offsets.length;
      }
      wait = Math.max(wait, expected);
    }
    return wait;
  }

  /**
   * Going round what it has been shown: revealed traps, patches, and where a lobbed shot will
   * come down. Returns the lateral to steer for, or NaN when nothing is in the way.
   */
  private avoidance(obs: Observation, speed: number, lane: number, edge: number): number {
    const params = obs.self.session.params;
    const radius = params.colliderRadius;
    const reach = 70 + speed * 0.75;
    let target = Number.NaN;
    let nearest = Infinity;
    const consider = (x: number, y: number, size: number, minAlong: number) => {
      const r = this.relate(x, y, this.scratch);
      if (!r.near || r.along < minAlong || r.along > reach || r.along > nearest) return;
      const width = size + radius + 6;
      if (Math.abs(r.lateral - lane) >= width) return;
      const left = r.lateral - width;
      const right = r.lateral + width;
      const leftOk = left >= -edge;
      const rightOk = right <= edge;
      if (!leftOk && !rightOk) return;
      nearest = r.along;
      if (leftOk && rightOk)
        target = Math.abs(left - lane) <= Math.abs(right - lane) ? left : right;
      else target = leftOk ? left : right;
    };
    for (let i = 0; i < obs.hazardCount; i++) {
      const h = obs.hazards[i]!;
      if (h.kind === 'decoy') continue;
      // Its own traps are live for it too once armed.
      if (h.own && h.armTicks > 0) continue;
      const size = h.halfLength > 0 ? Math.max(h.radius, h.halfLength * 0.6) : h.radius;
      consider(h.x, h.y, size, 4);
    }
    for (let i = 0; i < obs.projectileCount; i++) {
      const p = obs.projectiles[i]!;
      if (!p.lobbed || p.own) continue;
      const size = Math.max(p.spec.splashRadius, p.spec.hazardRadius, 24);
      // Only if the car will be about there when it lands.
      const r = this.relate(p.landX, p.landY, this.scratch);
      const eta = r.along / Math.max(40, speed);
      if (Math.abs(eta - p.landTicks * SIM_DT) < 0.9) consider(p.landX, p.landY, size, -10);
    }
    void STATUS_INDEX;
    return target;
  }
}
