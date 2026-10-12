import { COMPONENT_CRITICAL, SIM_DT } from '../balance.js';
import { lineClear, localToWorld, withinArc } from '../combat/geometry.js';
import type { ModuleSpec } from '../combat/specs.js';
import type { CombatCar } from '../combat/types.js';
import {
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_STEERING,
  MODULE_DISABLED,
  STATUS_INDEX,
} from '../combat/types.js';
import { clamp, wrapAngle } from '../math.js';
import type { ControlInput } from '../physics.js';
import type { TrackLocation, TrackRuntime } from '../track.js';
import { createLocation } from '../track.js';
import type { Observation } from './observe.js';
import type { Pilot } from './pilot.js';
import type { AiPersona } from './profile.js';
import { sampleIndex } from './route.js';
import type { Tactics } from './tactics.js';

/**
 * The fighting half of the AI: which fire buttons to hold and which utilities to press. Every
 * decision is made from what a player could see (the rival as perceived, revealed traps, every
 * projectile, its own lock warnings) and its own car's state as its HUD shows it.
 *
 * A weapon is fired when its estimated chance of doing what it is for (a hit, a trap driven
 * over, a shove) clears a threshold. The threshold depends on the style, and for a weapon with
 * a limited magazine on how its ammunition compares with the race left: twelve machine-gun
 * bursts are not spent on long shots early. The chance is a geometric estimate: where the
 * rival will be over the shot's flight or the burst (led by planning depth), against the
 * weapon's arc and range and the line of sight.
 */

const point = { x: 0, y: 0 };
const DEG = Math.PI / 180;

type Slot = { delay: number; skipUntil: number; held: boolean };

export class Combat {
  private readonly slots: Slot[] = [
    { delay: -1, skipUntil: 0, held: false },
    { delay: -1, skipUntil: 0, held: false },
  ];
  private prevUse = 0;
  private readonly loc: TrackLocation = createLocation();
  /** Line of sight to the rival, refreshed every few ticks. */
  private losTick = -100;
  private los = false;
  private decoyDelay = -1;
  /** Initial magazine of each part, from its catalog numbers. */
  private initialCharges: number[] = [];
  tactics: Tactics | null = null;
  /** Diagnostics for the tournament: shots it chose to take, and chances it let go by. */
  readonly stats = { presses: 0, skipped: 0, traps: 0, repairs: 0, boosts: 0, decoys: 0 };

  constructor(
    private readonly persona: AiPersona,
    private readonly pilot: Pilot,
  ) {}

  reset(): void {
    for (const s of this.slots) {
      s.delay = -1;
      s.skipUntil = 0;
      s.held = false;
    }
    this.prevUse = 0;
    this.losTick = -100;
    this.decoyDelay = -1;
    this.initialCharges = [];
  }

  act(track: TrackRuntime, obs: Observation, out: ControlInput, rng: () => number): void {
    const car = obs.self;
    if (this.initialCharges.length !== car.specs.length)
      this.initialCharges = car.specs.map((s) => s.charges);
    out.fire = this.weapons(track, obs, rng);
    const use = this.utilities(track, obs, out, rng);
    // A button is a press: let it go for a tick after each one.
    out.use = use & ~this.prevUse;
    this.prevUse = out.use;
  }

  // --- Weapons -----------------------------------------------------------------------------------

  private weapons(track: TrackRuntime, obs: Observation, rng: () => number): number {
    const car = obs.self;
    const rival = obs.rival;
    if (!rival.present || !rival.racing) {
      this.slots[0]!.delay = this.slots[1]!.delay = -1;
      return 0;
    }
    const skill = this.persona.skill;
    let fire = 0;
    for (let slot = 0; slot < 2; slot++) {
      const state = this.slots[slot]!;
      let want = false;
      for (let i = 0; i < car.specs.length; i++) {
        const spec = car.specs[i]!;
        if (spec.category !== 'weapon' || spec.slot !== slot || spec.auto) continue;
        const module = car.modules[i]!;
        if (module.state === MODULE_DISABLED || module.charges === 0) continue;
        // Something already under way (a charge, a burst, a flame) keeps its button.
        if (module.phase !== 0 && state.held) {
          want = true;
          continue;
        }
        if (module.cooldown > 0) continue;
        if (spec.heat > 0 && car.session.motion.thermalLimited) continue;
        // A narrow forward weapon ready to go: drift across onto the car ahead to line it up.
        const rel = this.tactics!.rel;
        if (
          spec.turn === 0 &&
          spec.half < 0.3 &&
          rel.near &&
          rel.along > 30 &&
          rel.along < spec.range * 1.1 &&
          Number.isNaN(this.tactics!.alignWish)
        )
          this.tactics!.alignWish = rel.lateral;
        const chance = this.chance(track, obs, spec, i);
        if (chance >= this.threshold(obs, spec, i)) want = true;
      }
      if (!want) {
        state.delay = -1;
        state.held = false;
        continue;
      }
      if (state.held) {
        fire |= 1 << slot;
        continue;
      }
      if (obs.tick < state.skipUntil) continue;
      if (state.delay < 0) {
        // A new chance: sometimes missed, otherwise it takes a moment to react.
        if (rng() < skill.missChance) {
          state.skipUntil = obs.tick + 40;
          this.stats.skipped++;
          continue;
        }
        state.delay = Math.max(0, skill.reactionTicks - 3 + Math.floor(rng() * 4));
      }
      if (state.delay > 0) state.delay--;
      else {
        fire |= 1 << slot;
        state.held = true;
        this.stats.presses++;
      }
    }
    return fire;
  }

  /** The lowest chance worth firing at: the style's, raised while a magazine is running ahead of the race. */
  threshold(obs: Observation, spec: ModuleSpec, part: number): number {
    const style = this.persona.style;
    const initial = this.initialCharges[part] ?? 0;
    if (initial <= 0) return style.fireThreshold;
    const car = obs.self;
    const total = car.session.track.def.laps * car.session.track.lapLength;
    const left = clamp(1 - car.session.progress.courseProgress / Math.max(1, total), 0, 1);
    const charges = car.modules[part]!.charges;
    // Ammunition left against the share of the race left: above 1 there is plenty. Short of
    // it, only the better chances are taken; with plenty in hand, and toward the flag, what is
    // left goes on fair ones rather than home unused.
    const plenty = charges / Math.max(0.5, initial * left);
    const scarcity = clamp(1 - plenty, 0, 1);
    const surplus = clamp((plenty - 1) / 1.5, 0, 1);
    const threshold = style.limitedThreshold + 0.35 * scarcity - 0.2 * surplus;
    return clamp(threshold, style.fireThreshold * 0.8, 0.95);
  }

  private clearTo(track: TrackRuntime, obs: Observation, x: number, y: number): boolean {
    if (obs.tick - this.losTick >= 3) {
      this.losTick = obs.tick;
      this.los = lineClear(track, x, y, obs.rival.x, obs.rival.y, this.loc);
    }
    return this.los;
  }

  /**
   * How likely this weapon, fired now, is to do what it is for. 0 to 1. Uses the rival as
   * perceived (Tactics.seen), never its hidden state.
   */
  chance(track: TrackRuntime, obs: Observation, spec: ModuleSpec, part: number): number {
    const car = obs.self;
    const m = car.session.motion;
    const tactics = this.tactics!;
    const seen = tactics.seen;
    const rival = obs.rival;
    const skill = this.persona.skill;
    const radius = rival.params.colliderRadius + rival.params.colliderOffset * 0.6;
    const facing = m.headingRad + (spec.turn * Math.PI) / 2;
    localToWorld(m, spec.lx, spec.ly, point);
    const mx = point.x + Math.sin(facing) * spec.muzzle;
    const my = point.y - Math.cos(facing) * spec.muzzle;
    const dx = seen.x - mx;
    const dy = seen.y - my;
    const dist = Math.hypot(dx, dy);
    const gap = Math.max(0, dist - radius);
    const bearing = Math.atan2(dx, -dy);
    // Where it will be after `t` seconds, relative to the muzzle (its velocity against ours).
    const rvx = seen.vx - m.velocityX;
    const rvy = seen.vy - m.velocityY;
    const at = (t: number) => {
      const lead = t * skill.leadShare;
      return { x: dx + rvx * lead, y: dy + rvy * lead };
    };
    const inCone = (x: number, y: number, half: number, axis = facing) =>
      withinArc(axis, Math.atan2(x, -y), half + Math.atan2(radius, Math.max(8, Math.hypot(x, y))));
    const immune = rival.statusTicks[STATUS_INDEX.immune]! > 0;
    const shielded = rival.modules.some((mod) => mod.shieldUp);

    switch (spec.kind) {
      case 'burst': {
        if (spec.aim === 'track') return car.modules[part]!.locked ? 0.8 : 0;
        // The burst's rounds: does the target stay inside the cone and the reach throughout?
        const burst = (spec.count - 1) * spec.intervalTicks * SIM_DT;
        let inside = 0;
        for (let k = 0; k <= 2; k++) {
          const t = (burst * k) / 2 + dist / Math.max(1, spec.speed);
          const p = at(t);
          const d = Math.hypot(p.x, p.y) - radius;
          if (d <= spec.range && inCone(p.x, p.y, spec.half * 0.85)) inside++;
        }
        if (inside === 0 || !this.clearTo(track, obs, mx, my)) return 0;
        // Damage fades past half the range: a long shot is worth less.
        const fade =
          gap > spec.falloffStart
            ? 1 -
              (1 - spec.falloffMin) *
                ((gap - spec.falloffStart) / Math.max(1, spec.range - spec.falloffStart))
            : 1;
        return (inside / 3) * clamp(fade, 0.4, 1) * (shielded ? 0.7 : 1);
      }
      case 'spread': {
        if (gap > spec.range * 0.9 || !inCone(dx, dy, spec.spread * 0.4)) return 0;
        if (!this.clearTo(track, obs, mx, my)) return 0;
        return clamp(1.15 - gap / spec.range, 0, 1);
      }
      case 'hitscan': {
        // The beam goes after the charge: where will it be then?
        const p = at(spec.windupTicks * SIM_DT);
        const d = Math.hypot(p.x, p.y) - radius;
        if (d > spec.range * 0.95 || !inCone(p.x, p.y, spec.half * 0.8)) return 0;
        if (!this.clearTo(track, obs, mx, my)) return 0;
        return 0.75;
      }
      case 'rocket':
      case 'frost':
      case 'boomerang': {
        const t = dist / Math.max(1, spec.speed);
        const p = at(t);
        const d = Math.hypot(p.x, p.y);
        if (d - radius > spec.range * (spec.kind === 'boomerang' ? 0.95 : 1.1)) return 0;
        const off = Math.abs(wrapAngle(Math.atan2(p.x, -p.y) - facing));
        const body = Math.atan2(
          radius + spec.radius + (spec.splashRadius ?? 0) * 0.4,
          Math.max(8, d),
        );
        if (off > body) return 0;
        if (!this.clearTo(track, obs, mx, my)) return 0;
        // A long flight gives the other car time to turn away.
        return clamp(1 - t * 0.9, 0.3, 0.95) * (off < body * 0.5 ? 1 : 0.75);
      }
      case 'homing':
        return car.modules[part]!.locked ? (rival.speed > 0 ? 0.85 : 0.9) : 0;
      case 'mortar':
        return car.modules[part]!.locked ? 0.7 : 0;
      case 'tether': {
        if (gap > spec.range * 0.85 || gap < 30) return 0;
        if (!inCone(dx, dy, spec.half * 0.8) || !this.clearTo(track, obs, mx, my)) return 0;
        // Worth most from behind: it pulls the leader back and the thrower on.
        return tactics.rel.near && tactics.rel.along > 0 ? 0.8 : 0.35;
      }
      case 'puddle': {
        // It lands a fixed distance ahead: worth it where the other car will be then.
        const t = spec.flightTicks * SIM_DT;
        const p = at(t);
        const landX = Math.sin(facing) * spec.range;
        const landY = -Math.cos(facing) * spec.range;
        const miss = Math.hypot(p.x + m.velocityX * 0 - landX, p.y - landY);
        return miss < spec.hazardRadius + radius ? 0.7 : 0;
      }
      case 'flame':
        if (gap > spec.range * 0.85 || !inCone(dx, dy, spec.half * 0.85)) return 0;
        return this.clearTo(track, obs, mx, my) ? 0.75 : 0;
      case 'melee': {
        const p = at(spec.windupTicks * SIM_DT);
        const d = Math.hypot(p.x, p.y) - radius;
        return d <= spec.range * 0.8 && inCone(p.x, p.y, spec.half * 0.8) ? 0.8 : 0;
      }
      case 'blast':
        if (gap > spec.range * 0.8 || !inCone(dx, dy, spec.half * 0.8)) return 0;
        if (immune) return 0.2;
        return this.clearTo(track, obs, mx, my) ? 0.7 : 0;
      case 'pulse': {
        if (immune || rival.statusTicks[STATUS_INDEX.emp]! > 0) return 0;
        const p = at(spec.windupTicks * SIM_DT);
        return Math.hypot(p.x, p.y) - radius <= spec.range * 0.85 ? 0.8 : 0;
      }
      case 'mine':
      case 'strip':
        return this.trapChance(obs, spec);
      default:
        void bearing;
        return 0;
    }
  }

  /**
   * A trap goes down where the follower will drive. Close behind, on the same piece of road:
   * line the car up with it (asking the tactics) and drop when the drop point is on its line.
   * Further back, a few seconds behind: drop on the racing line through a bend, where a car
   * that is racing will pass, when this car is on that line. Its own traps are live for it too,
   * so it never drops one on a line it is about to drive again within the trap's life.
   */
  private trapChance(obs: Observation, spec: ModuleSpec): number {
    const tactics = this.tactics!;
    const rel = tactics.rel;
    const car = obs.self;
    const radius = obs.rival.params.colliderRadius;
    const width = (spec.kind === 'strip' ? spec.hazardRadius : spec.triggerRadius) + radius;
    if (rel.near && rel.along <= -25 && rel.along >= -280) {
      tactics.alignWish = rel.lateral;
      const miss = Math.abs(rel.lateral - this.pilot.lateral);
      if (miss > width * 1.6) return 0;
      const reach = -rel.along / Math.max(30, tactics.seen.speed);
      const timing = clamp(1.2 - reach / 2.5, 0, 1);
      return clamp(1 - miss / (width * 1.6), 0, 1) * timing;
    }
    // A few seconds behind on the course: the bend's racing line is where it will be.
    const gap = car.session.progress.courseProgress - obs.rival.courseProgress;
    const speed = Math.max(60, obs.rival.speed);
    const seconds = gap / speed;
    const life = (spec.hazardLifeTicks || 240) / 30;
    if (gap < 150 || seconds > Math.min(4, life * 0.6)) return 0;
    const pilot = this.pilot;
    const r = pilot.route;
    const i = sampleIndex(r, pilot.s);
    const onLine = Math.abs(pilot.lateral - r.offset[i]!) < width * 0.5;
    const bend = r.kappa[i]! > 1 / 320;
    return onLine && bend ? (spec.kind === 'mine' ? 0.55 : 0.5) : 0;
  }

  // --- Utilities and repairs -------------------------------------------------------------------

  private utilities(
    track: TrackRuntime,
    obs: Observation,
    out: ControlInput,
    rng: () => number,
  ): number {
    const car = obs.self;
    const session = car.session;
    const m = session.motion;
    const skill = this.persona.skill;
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const wheels = car.build.chassis.wheelAnchors.length;
    const pilot = this.pilot;
    let use = 0;
    // Threat awareness, a reaction time late.
    if (car.lockWarning >= 2 || (car.lockWarning >= 1 && skill.cornerCraft)) {
      if (this.decoyDelay < 0) this.decoyDelay = skill.reactionTicks + Math.floor(rng() * 3);
      else if (this.decoyDelay > 0) this.decoyDelay--;
    } else this.decoyDelay = -1;

    for (let bit = 0; bit < car.manualUtilities.length; bit++) {
      const part = car.manualUtilities[bit]!;
      const spec = car.specs[part]!;
      const module = car.modules[part]!;
      if (module.state === MODULE_DISABLED || module.charges === 0) continue;
      if (module.cooldown > 0 || module.phase !== 0) continue;
      let want = false;
      switch (spec.kind) {
        case 'spare': {
          let worst = -1;
          let worstIntegrity = Infinity;
          for (let w = 0; w < wheels; w++) {
            const c = car.components[COMPONENT_FIRST_WHEEL + w]!;
            if (c.integrity < worstIntegrity) {
              worstIntegrity = c.integrity;
              worst = COMPONENT_FIRST_WHEEL + w;
            }
          }
          const severe = worstIntegrity <= 45;
          const critical = worstIntegrity <= COMPONENT_CRITICAL;
          if (severe && (critical || !skill.carCraft || this.fastStretchAhead(speed))) {
            want = true;
            out.target = worst + 1;
          }
          break;
        }
        case 'repair': {
          // Wheels and the engine first (Section 15.9), then steering, then a dying weapon.
          const pick = this.repairTarget(car, wheels);
          if (pick.index >= 0) {
            const urgent = pick.integrity <= COMPONENT_CRITICAL;
            if (urgent || !skill.carCraft || this.fastStretchAhead(speed)) {
              want = true;
              out.target = pick.index + 1;
            }
          }
          break;
        }
        case 'nitro':
        case 'boost': {
          if (car.statusTicks[STATUS_INDEX.boost]! > 0) break;
          const heatRoom = m.coreHeat + spec.heat < session.params.heat.performanceThreshold - 6;
          // On a straight: the plan allows a good deal more speed for the next second or more.
          const room = pilot.allowed - speed;
          const straight = this.straightAhead(Math.max(220, speed * 1.4));
          // Spent where it changes something: closing on the car ahead, holding off the one
          // behind, or (with charges to spare) wherever the road lets it run.
          const rel = this.tactics!.rel;
          const fight =
            rel.near &&
            ((rel.along > 40 && rel.along < 380) || (rel.along < -20 && rel.along > -160));
          const spare = module.charges < 0 || module.charges > 1 || !rel.near;
          want = heatRoom && straight && room > 35 && speed > 70 && (fight || spare);
          break;
        }
        case 'decoy':
          want = this.decoyDelay === 0;
          break;
        case 'hop':
          want = this.trapUnderNose(obs, speed);
          break;
        case 'winch':
          want = car.stuckTicks >= spec.windupTicks;
          break;
        default:
          break;
      }
      if (want) {
        use |= 1 << bit;
        if (spec.kind === 'repair' || spec.kind === 'spare') this.stats.repairs++;
        if (spec.kind === 'nitro' || spec.kind === 'boost') this.stats.boosts++;
        if (spec.kind === 'decoy') this.stats.decoys++;
      }
    }
    return use;
  }

  private repairTarget(car: CombatCar, wheels: number): { index: number; integrity: number } {
    const engine = car.components[COMPONENT_ENGINE]!;
    let best = -1;
    let bestScore = 0;
    let bestIntegrity = 100;
    for (let c = 0; c < car.components.length; c++) {
      const comp = car.components[c]!;
      if (comp.integrity >= comp.maxIntegrity) continue;
      const share = comp.integrity / Math.max(1, comp.maxIntegrity);
      const core =
        c === COMPONENT_ENGINE ||
        (c >= COMPONENT_FIRST_WHEEL && c < COMPONENT_FIRST_WHEEL + wheels);
      const weight = core ? 1.4 : c === COMPONENT_STEERING ? 1.2 : 0.6;
      const limit = core ? 0.5 : c === COMPONENT_STEERING ? 0.45 : 0.2;
      if (share > limit) continue;
      const score = (1 - share) * weight;
      if (score > bestScore) {
        bestScore = score;
        best = c;
        bestIntegrity = comp.integrity;
      }
    }
    void engine;
    return { index: best, integrity: bestIntegrity };
  }

  /** A fast stretch begins within a couple of seconds: a repaired car will use it. */
  private fastStretchAhead(speed: number): boolean {
    const pilot = this.pilot;
    const r = pilot.route;
    const top = pilot.plan.topSpeed.asphalt;
    let fast = 0;
    let samples = 0;
    for (let d = 0; d <= Math.max(300, speed * 2.5); d += 40) {
      samples++;
      if (r.limit[sampleIndex(r, pilot.s + d)]! > top * 0.8) fast++;
    }
    return fast >= samples * 0.6;
  }

  private straightAhead(distance: number): boolean {
    const pilot = this.pilot;
    const r = pilot.route;
    for (let d = 0; d <= distance; d += 30)
      if (Math.abs(r.curvature[sampleIndex(r, pilot.s + d)]!) > 1 / 700) return false;
    return true;
  }

  /** A revealed trap dead ahead, too close to steer round: worth a jump. */
  private trapUnderNose(obs: Observation, speed: number): boolean {
    const m = obs.self.session.motion;
    const fx = Math.sin(m.headingRad);
    const fy = -Math.cos(m.headingRad);
    const radius = obs.self.session.params.colliderRadius;
    for (let i = 0; i < obs.hazardCount; i++) {
      const h = obs.hazards[i]!;
      if (h.kind === 'decoy' || (h.own && h.armTicks > 0)) continue;
      const along = (h.x - m.x) * fx + (h.y - m.y) * fy;
      const across = Math.abs((h.x - m.x) * -fy + (h.y - m.y) * fx);
      const size = h.halfLength > 0 ? Math.max(h.radius, h.halfLength * 0.5) : h.radius;
      if (along > 8 && along < 12 + speed * 0.25 && across < size + radius) return true;
    }
    void DEG;
    return false;
  }
}
