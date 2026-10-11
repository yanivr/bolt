import { BRAKE_LIFT_THRESHOLD, COMPONENT_CRITICAL, COMPONENT_HEALTHY } from '../balance.js';
import { hullDistance, lineClear, localToWorld, withinArc } from '../combat/geometry.js';
import type { ModuleSpec } from '../combat/specs.js';
import type { CombatCar, ModuleRuntime, RaceSession } from '../combat/types.js';
import {
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_STEERING,
  MODULE_DISABLED,
  MODULE_TARGETING,
} from '../combat/types.js';
import type { DriverTuning } from '../driver.js';
import { DEFAULT_DRIVER } from '../driver.js';
import { angleDelta, clamp, headingFromVector, mulberry32, wrapAngle } from '../math.js';
import type { ControlInput } from '../physics.js';
import { surfaceGrip } from '../physics.js';
import type { TrackLocation } from '../track.js';
import {
  TRACK_SAMPLE_SPACING,
  createLocation,
  lapPosition,
  locate,
  sampleBranch,
} from '../track.js';
import type { RaceBrain } from './brain.js';

/**
 * The sparring rival: an honest, simple driver for Milestone C. It follows the centerline with
 * the speed planner of `driveCenterline`, moves over to pass or to avoid a trap it has been
 * shown, and uses its equipment by plain rules: fire a weapon when the target is inside its
 * arc and range, drop traps when the other car is close behind, repair when something is
 * critical. It reads its own car in full and of the other car only what can be seen from
 * outside, and it acts only through the control sample every driver sends.
 *
 * It is not the game's AI (Section 15.9, Milestone D): no build choice by weather, no
 * difficulty levels, no racing line, no planning. See `RaceBrain` for the seam.
 */

export type SparringTuning = {
  driver: DriverTuning;
  /** Ticks between spotting a chance and pressing the button: uniformly between these. */
  reactionMinTicks: number;
  reactionMaxTicks: number;
  /** Share of chances it lets go by. */
  missChance: number;
  /** How fast it changes lane, px per tick. */
  laneRate: number;
};

export const SPARRING_TUNING: SparringTuning = {
  driver: DEFAULT_DRIVER,
  reactionMinTicks: 4,
  reactionMaxTicks: 10,
  missChance: 0.12,
  laneRate: 2.2,
};

const PASS_GAP = 36;
const DEG = Math.PI / 180;
const point = { x: 0, y: 0 };

export class SparringBrain implements RaceBrain {
  private rng: () => number;
  private readonly loc: TrackLocation = createLocation();
  private readonly otherLoc: TrackLocation = createLocation();
  private readonly out: ControlInput = {
    steer: 0,
    brake: 0,
    coast: false,
    fire: 0,
    use: 0,
    target: 0,
  };
  private lane = 0;
  /** Per fire button: ticks until the press, -1 when no chance is pending; and a sulk timer. */
  private readonly delay = [-1, -1];
  private readonly skipUntil = [0, 0];
  private slowTicks = 0;
  private reverseTicks = 0;
  private usePulse = 0;

  constructor(
    private readonly seed: number,
    private readonly tuning: SparringTuning = SPARRING_TUNING,
  ) {
    this.rng = mulberry32(seed);
  }

  reset(): void {
    this.rng = mulberry32(this.seed);
    this.lane = 0;
    this.delay[0] = this.delay[1] = -1;
    this.skipUntil[0] = this.skipUntil[1] = 0;
    this.slowTicks = 0;
    this.reverseTicks = 0;
    this.usePulse = 0;
  }

  control(race: RaceSession, index: number): ControlInput {
    const car = race.cars[index]!;
    const out = this.out;
    out.fire = 0;
    out.use = 0;
    out.target = 0;
    const other = race.cars.find((c) => c.index !== index && !c.ko) ?? null;
    this.drive(race, car, other);
    if (race.phase === 'RACING' && car.session.phase === 'RACING' && !car.ko) {
      if (other) out.fire = this.weapons(race, car, other);
      out.use = this.utilities(race, car, other);
    }
    return out;
  }

  // --- Driving -----------------------------------------------------------------------------------

  private drive(race: RaceSession, car: CombatCar, other: CombatCar | null): void {
    const { track, env } = race;
    const tuning = this.tuning.driver;
    const session = car.session;
    const m = session.motion;
    const params = session.params;
    const loc = this.loc;
    locate(track, m.x, m.y, loc);
    const lapS = track.startS + lapPosition(track, loc);
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const out = this.out;
    out.coast = false;

    // Where it wants to be across the road: the middle, unless there is something to go round.
    let laneTarget = 0;
    let follow = 0;
    if (other && loc.branch === 0) {
      const o = other.session.motion;
      locate(track, o.x, o.y, this.otherLoc);
      if (this.otherLoc.branch === 0) {
        let ds = lapPosition(track, this.otherLoc) - lapPosition(track, loc);
        if (ds > track.lapLength / 2) ds -= track.lapLength;
        else if (ds < -track.lapLength / 2) ds += track.lapLength;
        const side = this.otherLoc.lateral - loc.lateral;
        const closing = speed - Math.hypot(o.velocityX, o.velocityY);
        const reach = 70 + Math.max(0, closing) * 0.9;
        if (ds > -30 && ds < reach) {
          // Alongside or coming up behind it: take the side with more road.
          const lateral = this.otherLoc.lateral;
          const dir = Math.abs(side) > 8 ? -Math.sign(side) : lateral > 0 ? -1 : 1;
          laneTarget = lateral + dir * PASS_GAP;
          // No way round yet and closing fast: lift rather than ram by accident.
          if (ds > 0 && ds < 46 && Math.abs(side) < 24 && closing > 30) follow = 0.5;
        }
      }
    }
    // A trap it has been shown, in its lane just ahead: go round it.
    for (const h of race.hazards) {
      if (!h.active || h.kind === 'decoy' || !((h.revealMask >> car.index) & 1)) continue;
      if (h.owner === car.index && h.arm > 0) continue;
      const dx = h.x - m.x;
      const dy = h.y - m.y;
      const along = dx * loc.tx + dy * loc.ty;
      if (along < 10 || along > 150 + speed * 0.3) continue;
      const across = dx * -loc.ty + dy * loc.tx;
      const width = h.radius + params.colliderRadius + 10;
      if (Math.abs(across) > width) continue;
      const absolute = loc.lateral + across;
      laneTarget = absolute + (absolute > 0 ? -1 : 1) * (width + 14);
      break;
    }

    const aim = sampleBranch(
      track.main,
      lapS + tuning.lookAheadBase + speed * tuning.lookAheadPerSpeed,
    );
    const room = Math.max(0, aim.halfWidth - params.colliderRadius - 8);
    laneTarget = clamp(laneTarget, -room, room);
    this.lane += clamp(laneTarget - this.lane, -this.tuning.laneRate, this.tuning.laneRate);
    const ax = aim.x - aim.ty * this.lane;
    const ay = aim.y + aim.tx * this.lane;
    const wanted = headingFromVector(ax - m.x, ay - m.y);
    out.steer = clamp(angleDelta(m.headingRad, wanted) * tuning.steerGain, -1, 1);

    // The speed plan of `driveCenterline`: the fastest entry speed that still allows braking to
    // each point's cornering limit, under the grip the car has right now.
    const fx = session.effects;
    let allowed = Infinity;
    const horizon = 60 + speed * 1.1;
    for (let d = 0; d <= horizon; d += TRACK_SAMPLE_SPACING * 2) {
      const p = sampleBranch(track.main, lapS + d);
      const surface = track.main.surface[p.index] ?? 'asphalt';
      const grip = surfaceGrip(params, env, surface, false) * fx.grip;
      const curvature = Math.max(Math.abs(p.curvature), 1e-5);
      const cornerSpeed = Math.sqrt(
        (params.lateralGripAccel * grip * tuning.cornerConfidence) / curvature,
      );
      const entry = Math.sqrt(
        cornerSpeed * cornerSpeed + 2 * params.brakeDecel * grip * tuning.brakeConfidence * d,
      );
      if (entry < allowed) allowed = entry;
    }
    let pull = 0;
    if (speed > allowed) {
      const lift = clamp((speed - allowed) / 45, 0.25, 1);
      pull = BRAKE_LIFT_THRESHOLD + lift * (1 - BRAKE_LIFT_THRESHOLD);
    }
    if (follow > 0)
      pull = Math.max(pull, BRAKE_LIFT_THRESHOLD + follow * (1 - BRAKE_LIFT_THRESHOLD));
    out.brake = pull;

    // Pinned nose-first against something: back out for a moment, as a person would.
    const racing = session.phase === 'RACING';
    if (racing && speed < 14 && !session.motion.reversing) this.slowTicks++;
    else if (speed > 30) this.slowTicks = 0;
    if (this.reverseTicks > 0) {
      this.reverseTicks--;
      out.brake = 1;
      out.steer = -out.steer;
    } else if (this.slowTicks > 50) {
      this.slowTicks = 0;
      this.reverseTicks = 32;
    }
  }

  // --- Weapons -----------------------------------------------------------------------------------

  private weapons(race: RaceSession, car: CombatCar, other: CombatCar): number {
    let fire = 0;
    for (let slot = 0; slot < 2; slot++) {
      let want = false;
      for (let i = 0; i < car.specs.length; i++) {
        const spec = car.specs[i]!;
        if (spec.category !== 'weapon' || spec.slot !== slot) continue;
        const module = car.modules[i]!;
        if (module.state === MODULE_DISABLED || module.charges === 0) continue;
        if (this.chance(race, car, other, spec, module)) want = true;
      }
      if (!want) {
        this.delay[slot] = -1;
        continue;
      }
      if (race.tick < this.skipUntil[slot]!) continue;
      if (this.delay[slot]! < 0) {
        // A new chance: sometimes it is simply missed; otherwise it takes a moment to react.
        if (this.rng() < this.tuning.missChance) {
          this.skipUntil[slot] = race.tick + 45;
          continue;
        }
        const span = this.tuning.reactionMaxTicks - this.tuning.reactionMinTicks + 1;
        this.delay[slot] = this.tuning.reactionMinTicks + Math.floor(this.rng() * span);
      }
      if (this.delay[slot]! > 0) this.delay[slot]!--;
      else fire |= 1 << slot;
    }
    return fire;
  }

  /** Whether this weapon, fired now, has a fair chance of doing what it is for. */
  private chance(
    race: RaceSession,
    car: CombatCar,
    other: CombatCar,
    spec: ModuleSpec,
    module: ModuleRuntime,
  ): boolean {
    if (module.cooldown > 0) return false;
    const m = car.session.motion;
    const o = other.session.motion;
    const facing = m.headingRad + (spec.turn * Math.PI) / 2;
    localToWorld(m, spec.lx, spec.ly, point);
    const bearing = Math.atan2(o.x - point.x, -(o.y - point.y));
    const off = Math.abs(wrapAngle(bearing - facing));
    const gap = hullDistance(o, other.session.params, point.x, point.y, null);
    const centre = Math.hypot(o.x - point.x, o.y - point.y);
    // How far off its line a straight shot may point and still strike the body.
    const bodyAngle = Math.atan2(other.session.params.colliderRadius, Math.max(1, centre));
    const sees = () => lineClear(race.track, point.x, point.y, o.x, o.y, this.otherLoc);

    switch (spec.kind) {
      case 'burst':
        if (spec.aim === 'track') return module.locked;
        return gap <= spec.range && off <= spec.half && sees();
      case 'spread':
        return gap <= spec.range * 0.85 && off <= spec.half * 0.7 && sees();
      case 'hitscan':
        return module.state === MODULE_TARGETING;
      case 'homing':
        return module.locked;
      case 'mortar':
        return module.locked;
      case 'rocket':
      case 'frost':
        return gap <= spec.range * 1.2 && off <= bodyAngle + 2 * DEG && sees();
      case 'boomerang':
        return gap <= spec.range && off <= bodyAngle + 5 * DEG && sees();
      case 'tether':
        return gap <= spec.range * 0.9 && off <= spec.half && sees();
      case 'puddle':
        // It lands a fixed distance ahead: worth it when the other car is about there.
        return Math.abs(centre - spec.range) <= 40 && off <= 14 * DEG;
      case 'flame':
        return gap <= spec.range * 0.9 && off <= spec.half && sees();
      case 'melee':
        return gap <= spec.range * 0.9 && withinArc(facing, bearing, spec.half * 0.9);
      case 'blast':
        return gap <= spec.range * 0.85 && off <= spec.half * 0.8 && sees();
      case 'pulse':
        return gap <= spec.range * 0.9;
      case 'mine':
      case 'strip': {
        // Traps go down when the other car is close behind and on the same piece of road.
        const fx = Math.sin(m.headingRad);
        const fy = -Math.cos(m.headingRad);
        const along = (o.x - m.x) * fx + (o.y - m.y) * fy;
        const across = Math.abs((o.x - m.x) * -fy + (o.y - m.y) * fx);
        return along < -30 && along > -190 && across < 46;
      }
      default:
        return false;
    }
  }

  // --- Utilities and repairs ---------------------------------------------------------------------

  private utilities(race: RaceSession, car: CombatCar, other: CombatCar | null): number {
    // A button is a press, not a hold: every other look it is let go again.
    this.usePulse = (this.usePulse + 1) % 6;
    if (this.usePulse !== 0) return 0;
    const session = car.session;
    const m = session.motion;
    const wheels = car.build.chassis.wheelAnchors.length;
    let use = 0;
    for (let bit = 0; bit < car.manualUtilities.length; bit++) {
      const part = car.manualUtilities[bit]!;
      const spec = car.specs[part]!;
      const module = car.modules[part]!;
      if (module.state === MODULE_DISABLED || module.charges === 0) continue;
      if (module.cooldown > 0 || module.phase !== 0) continue;
      let want = false;
      switch (spec.kind) {
        case 'spare':
          for (let w = 0; w < wheels; w++)
            if (car.components[COMPONENT_FIRST_WHEEL + w]!.integrity <= COMPONENT_HEALTHY * 0.5)
              want = true;
          break;
        case 'repair': {
          // Engine, steering or a wheel in a bad way; failing that, anything about to fail.
          const core = COMPONENT_FIRST_WHEEL + wheels;
          for (let c = 0; c < car.components.length; c++) {
            const comp = car.components[c]!;
            const limit = c < core ? COMPONENT_CRITICAL * 1.5 : COMPONENT_CRITICAL;
            if (comp.integrity <= limit && comp.integrity < comp.maxIntegrity) want = true;
          }
          if (
            car.components[COMPONENT_ENGINE]!.integrity <= COMPONENT_HEALTHY * 0.6 ||
            car.components[COMPONENT_STEERING]!.integrity <= COMPONENT_HEALTHY * 0.6
          )
            want = true;
          break;
        }
        case 'nitro':
        case 'boost': {
          // On a straight, with heat to spare, when there is ground to make up or hold.
          const lapS = race.track.startS + lapPosition(race.track, this.loc);
          let straight = true;
          for (let d = 0; d <= 260; d += 40)
            if (Math.abs(sampleBranch(race.track.main, lapS + d).curvature) > 1 / 900)
              straight = false;
          const room = m.coreHeat + spec.heat < session.params.heat.performanceThreshold - 8;
          const speed = Math.hypot(m.velocityX, m.velocityY);
          want = straight && room && speed > 60 && speed < session.params.forceZeroSpeed * 0.62;
          break;
        }
        case 'decoy':
          want = car.lockWarning >= 2 || (car.lockWarning >= 1 && this.rng() < 0.2);
          break;
        case 'hop': {
          // A trap dead ahead and too close to steer round.
          const fx = Math.sin(m.headingRad);
          const fy = -Math.cos(m.headingRad);
          for (const h of race.hazards) {
            if (!h.active || h.kind === 'decoy' || !((h.revealMask >> car.index) & 1)) continue;
            const along = (h.x - m.x) * fx + (h.y - m.y) * fy;
            const across = Math.abs((h.x - m.x) * -fy + (h.y - m.y) * fx);
            if (along > 6 && along < 44 && across < h.radius + 12) want = true;
          }
          break;
        }
        case 'winch':
          want = car.stuckTicks >= spec.windupTicks;
          break;
        default:
          break;
      }
      if (want) use |= 1 << bit;
    }
    void other;
    return use;
  }
}

export function createSparringBrain(seed: number, tuning?: SparringTuning): SparringBrain {
  return new SparringBrain(seed, tuning);
}
