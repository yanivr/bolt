import type { RaceBrain } from './ai/brain.js';
import { BRAKE_LIFT_THRESHOLD } from './balance.js';
import { repairComponent } from './combat/car.js';
import type { RaceSession } from './combat/types.js';
import { angleDelta, clamp, headingFromVector } from './math.js';
import type { ControlInput } from './physics.js';
import type { RaceEventType } from './protocol.js';
import type { DriveSession } from './sim.js';
import type { TrackLocation, TrackRuntime } from './track.js';
import { createLocation, lapPosition, locate, sampleBranch } from './track.js';
import type { VehicleBlueprint } from './types.js';

/**
 * Scripted showcase scenarios (Section 19.4, Milestone C gate). A scenario puts two cars on
 * the track at chosen places, drives them along their lanes and presses their buttons on a
 * timeline, so that one situation (a rocket hit, a mortar strike, an EMP) happens the same way
 * every time. The rendering and audio work reviews effects against them, the tests assert on
 * them, and the server can host one in a real room.
 *
 * A scenario is plain data plus this small runner. It uses the ordinary race step and the
 * ordinary control sample: nothing in a scenario can happen that a race could not produce.
 */

/** Buttons and overrides for a span of race ticks (tick 1 is the first tick after GO). */
export type ScenarioStep = {
  from: number;
  /** Last tick the step applies to. Defaults to `from`. */
  to?: number;
  /** Fire buttons to hold: bit 0 primary, bit 1 secondary. */
  fire?: number;
  /** Utility buttons to hold. */
  use?: number;
  /** Repair target: component index + 1. */
  target?: number;
  /** Overrides the lane driver's steering or brake for the span. */
  steer?: number;
  brake?: number;
  /** Changes the lane the car holds from this tick on, world pixels right of the centerline. */
  lane?: number;
  /** Changes the speed the car holds from this tick on. */
  speed?: number;
};

export type ScenarioCar = {
  blueprint: VehicleBlueprint;
  /** Where it starts: world pixels along the lap from the start line, and right of the centerline. */
  s: number;
  lane: number;
  /** Speed it holds, world px/s. Zero keeps it parked on its brake. */
  speed: number;
  steps: ScenarioStep[];
  /** State it starts with, for showing damage, repairs and limits. */
  integrity?: Array<{ component: number; value: number }>;
  heat?: number;
  battery?: number;
};

export type ScenarioDefinition = {
  id: string;
  title: string;
  /** What happens, in order. */
  description: string;
  /** What a reviewer should look and listen for. */
  shows: string;
  trackId: string;
  weatherPresetId: string;
  seed: number;
  /** Ticks on the grid before GO. Short, so the scene is set and then it happens. */
  countdownTicks: number;
  /** Race ticks the scenario runs for. */
  durationTicks: number;
  cars: ScenarioCar[];
  /** Events the scenario must produce, checked by the tests. */
  expect: Array<{ type: RaceEventType; weapon?: string; car?: number }>;
};

/**
 * Puts a freshly created race into a scenario's opening position. The cars keep the grid
 * countdown (shortened), so every client flow that expects one still works.
 */
export function applyScenario(race: RaceSession, def: ScenarioDefinition): void {
  const track = race.track;
  def.cars.forEach((setup, index) => {
    const car = race.cars[index];
    if (!car) return;
    const session = car.session;
    const at = sampleBranch(track.main, track.startS + setup.s);
    const m = session.motion;
    m.x = at.x - at.ty * setup.lane;
    m.y = at.y + at.tx * setup.lane;
    m.headingRad = headingFromVector(at.tx, at.ty);
    m.velocityX = 0;
    m.velocityY = 0;
    m.yawRate = 0;
    car.prevX = m.x;
    car.prevY = m.y;
    session.countdownTicks = def.countdownTicks;
    for (const damage of setup.integrity ?? []) {
      const comp = car.components[damage.component];
      if (comp) repairComponent(race, car, damage.component, damage.value - comp.integrity);
    }
  });
  // Damage set up before the start is the scene, not news.
  race.events.length = 0;
}

/**
 * Heat and battery a scenario starts a car with. Applied on the first race tick, because the
 * grid hands every car over cold and charged.
 */
function applyStartState(session: DriveSession, setup: ScenarioCar): void {
  if (setup.heat !== undefined) session.motion.coreHeat = setup.heat;
  if (setup.battery !== undefined) session.motion.batteryEnergy = setup.battery;
}

export type ScenarioScratch = { loc: TrackLocation; lane: number; speed: number; started: boolean };

export function createScenarioScratch(setup: ScenarioCar): ScenarioScratch {
  return { loc: createLocation(), lane: setup.lane, speed: setup.speed, started: false };
}

/**
 * The control a scenario gives one car for the tick about to be simulated. It reads only that
 * car's own session, so a client can compute it for its predicted car and send it as an
 * ordinary sample: prediction then matches the authority exactly, as with a hand on the stick.
 */
export function scenarioControl(
  setup: ScenarioCar,
  track: TrackRuntime,
  session: DriveSession,
  scratch: ScenarioScratch,
  out: ControlInput,
): ControlInput {
  const m = session.motion;
  // The tick this control is for: the session has not been stepped yet.
  const tick = session.phase === 'RACING' ? session.raceTicks + 1 : 0;
  if (session.phase === 'COUNTDOWN') {
    scratch.lane = setup.lane;
    scratch.speed = setup.speed;
    scratch.started = false;
  } else if (!scratch.started && tick >= 1) {
    scratch.started = true;
    applyStartState(session, setup);
  }

  out.fire = 0;
  out.use = 0;
  out.target = 0;
  let steerOverride: number | undefined;
  let brakeOverride: number | undefined;
  for (const step of setup.steps) {
    if (tick < step.from) continue;
    if (step.lane !== undefined) scratch.lane = step.lane;
    if (step.speed !== undefined) scratch.speed = step.speed;
    if (tick > (step.to ?? step.from)) continue;
    if (step.fire !== undefined) out.fire |= step.fire;
    if (step.use !== undefined) out.use |= step.use;
    if (step.target !== undefined) out.target = step.target;
    if (step.steer !== undefined) steerOverride = step.steer;
    if (step.brake !== undefined) brakeOverride = step.brake;
  }

  const loc = scratch.loc;
  locate(track, m.x, m.y, loc);
  const lapS = track.startS + lapPosition(track, loc);
  const speed = Math.hypot(m.velocityX, m.velocityY);
  const aim = sampleBranch(track.main, lapS + 60 + speed * 0.25);
  const ax = aim.x - aim.ty * scratch.lane;
  const ay = aim.y + aim.tx * scratch.lane;
  out.coast = false;
  out.steer = clamp(angleDelta(m.headingRad, headingFromVector(ax - m.x, ay - m.y)) * 2.4, -1, 1);
  if (scratch.speed <= 0) {
    // Parked: on the brake, short of the pull that would engage reverse.
    out.steer = 0;
    out.brake = 0.5;
  } else {
    const over = clamp((speed - scratch.speed) / 24, 0, 1);
    out.brake = over > 0 ? BRAKE_LIFT_THRESHOLD + over * 0.6 * (1 - BRAKE_LIFT_THRESHOLD) : 0;
  }
  if (steerOverride !== undefined) out.steer = steerOverride;
  if (brakeOverride !== undefined) out.brake = brakeOverride;
  return out;
}

/** Drives one car of a scenario. Both the server room and the offline link use it. */
export class ScenarioBrain implements RaceBrain {
  private scratch: ScenarioScratch;
  private readonly out: ControlInput = {
    steer: 0,
    brake: 0,
    coast: false,
    fire: 0,
    use: 0,
    target: 0,
  };

  constructor(private readonly setup: ScenarioCar) {
    this.scratch = createScenarioScratch(setup);
  }

  reset(): void {
    this.scratch = createScenarioScratch(this.setup);
  }

  control(race: RaceSession, index: number): ControlInput {
    return scenarioControl(
      this.setup,
      race.track,
      race.cars[index]!.session,
      this.scratch,
      this.out,
    );
  }
}
