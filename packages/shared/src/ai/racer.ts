import type { RaceSession } from '../combat/types.js';
import { clamp, mulberry32 } from '../math.js';
import type { ControlInput } from '../physics.js';
import type { RaceBrain } from './brain.js';
import { Combat } from './combat.js';
import type { Observation } from './observe.js';
import { createObservation, observe } from './observe.js';
import { Pilot } from './pilot.js';
import type { AiDifficulty, AiPersona, AiStyle } from './profile.js';
import { DEFAULT_DIFFICULTY, aiPersona } from './profile.js';
import { routePlan, sampleIndex } from './route.js';
import { Tactics } from './tactics.js';

/**
 * The AI driver of Milestone D (Section 15.9), behind the same `RaceBrain` seam as the sparring
 * rival: it reads the race through `observe` (its own car in full, the rival only as a player
 * could see it) and answers with one control sample. Deterministic for a seed.
 *
 *   observe  ->  Tactics (where to be across the road: line, pass, defend, avoid; shortcuts)
 *            ->  Pilot   (route, speed plan, steering and pedals, recovery)
 *            ->  Combat  (fire buttons, utilities, repairs)
 */

export type AiBrainOptions = {
  seed: number;
  difficulty?: AiDifficulty;
  style?: AiStyle;
  /**
   * For tools and tests that measure the shortcuts: take every one, or none, instead of
   * deciding. Not a difficulty setting; a race against the AI always plans.
   */
  shortcuts?: 'plan' | 'always' | 'never';
};

export class AiBrain implements RaceBrain {
  readonly difficulty: AiDifficulty;
  readonly style: AiStyle;
  readonly persona: AiPersona;
  private rng: () => number;
  private obs: Observation | null = null;
  private pilot: Pilot | null = null;
  private tactics: Tactics | null = null;
  private combat: Combat | null = null;
  private index = -1;
  private planKey: unknown = null;
  private readonly out: ControlInput = {
    steer: 0,
    brake: 0,
    coast: false,
    fire: 0,
    use: 0,
    target: 0,
  };
  /** Wall-clock cost of the last `control` call, ms, for the tick budget report. */
  lastCostMs = 0;

  constructor(private readonly options: AiBrainOptions) {
    this.difficulty = options.difficulty ?? DEFAULT_DIFFICULTY;
    this.style =
      options.style ?? (mulberry32(options.seed ^ 0x6a09e667)() < 0.5 ? 'aggressive' : 'tactical');
    this.persona = aiPersona(this.difficulty, this.style);
    this.rng = mulberry32(options.seed);
  }

  /** The parts of the brain, for tests and review tools; the game never reads them. */
  get parts(): {
    pilot: Pilot;
    tactics: Tactics;
    combat: Combat;
    observation: Observation;
  } | null {
    if (!this.pilot || !this.tactics || !this.combat || !this.obs) return null;
    return { pilot: this.pilot, tactics: this.tactics, combat: this.combat, observation: this.obs };
  }

  /** Waiting at a closed crossing: standing still on purpose. */
  get holding(): boolean {
    return this.pilot?.holding ?? false;
  }

  /** The route plan in use (for tools and tests), or null before the first tick. */
  get plan() {
    return this.pilot?.plan ?? null;
  }

  /** Shortcuts the route currently takes, as a mask (bit k - 1 for branch k). */
  get routeMask(): number {
    return this.pilot?.mask ?? 0;
  }

  /**
   * How far the car is from the best racing line of its route right now, px: line error as
   * driven, including deliberate moves off the line (passing, defending, avoiding).
   */
  lineDeviation(): number {
    const pilot = this.pilot;
    if (!pilot || pilot.lost) return Number.NaN;
    const r = pilot.route;
    return Math.abs(pilot.lateral - r.offset[sampleIndex(r, pilot.s)]!);
  }

  reset(): void {
    this.rng = mulberry32(this.options.seed);
    this.pilot?.reset();
    this.tactics?.reset();
    this.combat?.reset();
  }

  /** Works out the route plan ahead of the race, so the first tick does not pay for it. */
  prepare(race: RaceSession, index: number): void {
    const car = race.cars[index]!;
    // The plan follows the car's own coefficients: rebuilt if it is a different car.
    if (this.pilot && this.index === index && this.planKey === car.baseParams) return;
    const plan = routePlan(race.track, car.baseParams, race.env);
    this.index = index;
    this.planKey = car.baseParams;
    this.obs = createObservation(car);
    this.pilot = new Pilot(plan, this.persona);
    this.tactics = new Tactics(this.pilot, this.persona, this.options.shortcuts ?? 'plan');
    this.combat = new Combat(this.persona, this.pilot);
    this.combat.tactics = this.tactics;
  }

  control(race: RaceSession, index: number): ControlInput {
    this.prepare(race, index);
    const obs = observe(race, index, this.obs!);
    const pilot = this.pilot!;
    const car = obs.self;
    const out = this.out;
    out.fire = 0;
    out.use = 0;
    out.target = 0;
    const m = car.session.motion;
    const speed = Math.hypot(m.velocityX, m.velocityY);
    pilot.updateCursor(car);
    this.tactics!.decide(race.track, obs, this.rng);
    pilot.planSpeed(car, speed, gripScaleOf(car));
    pilot.drive(car, out, this.rng, obs.racing);
    if (obs.racing) this.combat!.act(race.track, obs, out, this.rng);
    return out;
  }
}

/**
 * What statuses and damage are doing to the car's ability to corner, as the car itself feels
 * it: grip (oil, frost, damaged wheels, all in the effects record) and damaged steering, which
 * cannot ask for the full turn any more.
 */
function gripScaleOf(car: RaceSession['cars'][number]): number {
  const fx = car.session.effects;
  const steer = clamp(fx.steerScale + 0.25, 0.6, 1);
  return Math.max(0.25, fx.grip * steer);
}

export function createAiBrain(options: AiBrainOptions): AiBrain {
  return new AiBrain(options);
}
