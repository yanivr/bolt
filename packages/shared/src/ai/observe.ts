import type { ModuleSpec } from '../combat/specs.js';
import type { CombatCar, RaceSession } from '../combat/types.js';
import { STATUS_COUNT } from '../combat/types.js';
import type { HazardKind, ProjectileKind } from '../protocol.js';
import type { VehicleParams } from '../types.js';

/**
 * What the AI driver is allowed to know (Sections 7.5 and 15.9): its own car in full, as its
 * own HUD shows it, and of the other car only what a player could see from outside. The
 * rival's pose, velocity, steering and brake lights, its lap and course position, its visible
 * damage (chassis, armor, component integrity), its statuses, the parts mounted on it (its
 * blueprint is sent to every client to draw the car) and per part only whether it is idle,
 * aiming, firing or recovering, where it points and whether a shield is up. Never its heat,
 * energy, ammunition, cooldown timers, locks in progress or tow. Projectiles are all visible;
 * a hazard laid by the rival only once the simulation has revealed it to this driver.
 *
 * Every decision of the AI reads the rival through this view and nothing else. The view is
 * refilled every tick into the same records, so it allocates nothing after the first tick.
 */

export type RivalModuleView = { state: number; aim: number; shieldUp: boolean };

export type RivalView = {
  present: boolean;
  index: number;
  x: number;
  y: number;
  headingRad: number;
  velocityX: number;
  velocityY: number;
  speed: number;
  steering: number;
  braking: boolean;
  lap: number;
  courseProgress: number;
  finished: boolean;
  ko: boolean;
  racing: boolean;
  chassis: number;
  chassisMax: number;
  armor: number[];
  components: number[];
  /** Visible statuses: magnitude and ticks left, by `STATUS_INDEX`. */
  statusMagnitude: number[];
  statusTicks: number[];
  modules: RivalModuleView[];
  /** The parts mounted on it, compiled from its public blueprint. */
  specs: readonly ModuleSpec[];
  /** Body and mass, from its public blueprint with every part working. */
  params: VehicleParams;
};

export type HazardView = {
  id: number;
  kind: HazardKind;
  /** Laid by this driver's own car. */
  own: boolean;
  x: number;
  y: number;
  radius: number;
  halfLength: number;
  angle: number;
  /** Ticks until it is live (mines arm), and ticks left. */
  armTicks: number;
  lifeTicks: number;
};

export type ProjectileView = {
  id: number;
  kind: ProjectileKind;
  own: boolean;
  x: number;
  y: number;
  /** World pixels per tick. */
  vx: number;
  vy: number;
  /** Lobbed shots: where they come down (the telegraph), and in how many ticks. */
  lobbed: boolean;
  landX: number;
  landY: number;
  landTicks: number;
  /** The weapon that fired it (its catalog numbers are public). */
  spec: ModuleSpec;
};

export type Observation = {
  tick: number;
  raceTicks: number;
  racing: boolean;
  self: CombatCar;
  rival: RivalView;
  hazards: HazardView[];
  hazardCount: number;
  projectiles: ProjectileView[];
  projectileCount: number;
};

export function createObservation(self: CombatCar): Observation {
  return {
    tick: 0,
    raceTicks: 0,
    racing: false,
    self,
    rival: {
      present: false,
      index: -1,
      x: 0,
      y: 0,
      headingRad: 0,
      velocityX: 0,
      velocityY: 0,
      speed: 0,
      steering: 0,
      braking: false,
      lap: 0,
      courseProgress: 0,
      finished: false,
      ko: false,
      racing: false,
      chassis: 0,
      chassisMax: 1,
      armor: [0, 0, 0, 0],
      components: [],
      statusMagnitude: new Array<number>(STATUS_COUNT).fill(0),
      statusTicks: new Array<number>(STATUS_COUNT).fill(0),
      modules: [],
      specs: [],
      params: self.baseParams,
    },
    hazards: [],
    hazardCount: 0,
    projectiles: [],
    projectileCount: 0,
  };
}

/** The other car a brain races: the nearest one still in the race, else any other. */
function rivalOf(race: RaceSession, index: number): CombatCar | null {
  const me = race.cars[index]!.session.motion;
  let best: CombatCar | null = null;
  let bestD = Infinity;
  for (const car of race.cars) {
    if (car.index === index) continue;
    const m = car.session.motion;
    const d = (m.x - me.x) ** 2 + (m.y - me.y) ** 2 + (car.ko ? 1e12 : 0);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/** Fills the observation of car `index` from the race. */
export function observe(race: RaceSession, index: number, out: Observation): Observation {
  const self = race.cars[index]!;
  out.self = self;
  out.tick = race.tick;
  out.raceTicks = race.raceTicks;
  out.racing = race.phase === 'RACING' && self.session.phase === 'RACING' && !self.ko;

  const r = out.rival;
  const other = rivalOf(race, index);
  r.present = other !== null;
  if (other) {
    const m = other.session.motion;
    const p = other.session.progress;
    r.index = other.index;
    r.x = m.x;
    r.y = m.y;
    r.headingRad = m.headingRad;
    r.velocityX = m.velocityX;
    r.velocityY = m.velocityY;
    r.speed = Math.hypot(m.velocityX, m.velocityY);
    r.steering = m.steeringInput;
    r.braking = m.brakeInput > 0.3 || m.reversing;
    r.lap = p.lap;
    r.courseProgress = p.courseProgress;
    r.finished = p.finishedAtMs !== null;
    r.ko = other.ko;
    r.racing = other.session.phase === 'RACING' && !other.ko;
    r.chassis = other.chassis;
    r.chassisMax = other.chassisMax;
    for (let i = 0; i < 4; i++) r.armor[i] = other.armor[i]!;
    r.components.length = other.components.length;
    for (let i = 0; i < other.components.length; i++)
      r.components[i] = other.components[i]!.integrity;
    for (let i = 0; i < STATUS_COUNT; i++) {
      r.statusMagnitude[i] = other.statusTicks[i]! > 0 ? other.statusMagnitude[i]! : 0;
      r.statusTicks[i] = other.statusTicks[i]!;
    }
    while (r.modules.length < other.modules.length)
      r.modules.push({ state: 0, aim: 0, shieldUp: false });
    r.modules.length = other.modules.length;
    for (let i = 0; i < other.modules.length; i++) {
      const mod = other.modules[i]!;
      const view = r.modules[i]!;
      view.state = mod.state;
      view.aim = mod.aim;
      view.shieldUp = other.specs[i]!.kind === 'shield' && mod.pool > 0;
    }
    r.specs = other.specs;
    r.params = other.baseParams;
  }

  // Hazards: its own, and the rival's once revealed to this driver.
  let n = 0;
  for (const h of race.hazards) {
    if (!h.active) continue;
    const own = h.owner === index;
    if (!own && !((h.revealMask >> index) & 1)) continue;
    let view = out.hazards[n];
    if (!view) {
      view = {
        id: 0,
        kind: h.kind,
        own,
        x: 0,
        y: 0,
        radius: 0,
        halfLength: 0,
        angle: 0,
        armTicks: 0,
        lifeTicks: 0,
      };
      out.hazards.push(view);
    }
    view.id = h.id;
    view.kind = h.kind;
    view.own = own;
    view.x = h.x;
    view.y = h.y;
    view.radius = h.radius;
    view.halfLength = h.halfLength;
    view.angle = h.angle;
    view.armTicks = h.arm;
    view.lifeTicks = h.life;
    n++;
  }
  out.hazardCount = n;

  let k = 0;
  for (const p of race.projectiles) {
    if (!p.active) continue;
    let view = out.projectiles[k];
    if (!view) {
      view = {
        id: 0,
        kind: p.kind,
        own: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        lobbed: false,
        landX: 0,
        landY: 0,
        landTicks: 0,
        spec: p.spec,
      };
      out.projectiles.push(view);
    }
    view.id = p.id;
    view.kind = p.kind;
    view.own = p.owner === index;
    view.x = p.x;
    view.y = p.y;
    view.vx = p.vx;
    view.vy = p.vy;
    view.lobbed = p.kind === 'foam' || p.kind === 'shell';
    view.landX = p.landX;
    view.landY = p.landY;
    view.landTicks = p.life;
    view.spec = p.spec;
    k++;
  }
  out.projectileCount = k;
  return out;
}
