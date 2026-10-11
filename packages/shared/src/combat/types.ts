import type { ResolvedBuild } from '../blueprint.js';
import type { PassiveTotals } from '../modifiers.js';
import type { ControlInput } from '../physics.js';
import type {
  HazardKind,
  ProjectileKind,
  RaceEvent,
  RaceEventBody,
  RaceResult,
  StatusFamily,
} from '../protocol.js';
import type { DriveSession } from '../sim.js';
import type { TrackLocation, TrackRuntime } from '../track.js';
import type {
  BuildConditions,
  CarArc,
  Catalog,
  MatchPhase,
  RaceEnvironment,
  VehicleParams,
} from '../types.js';
import type { ModuleSpec } from './specs.js';

/**
 * Authoritative combat state (Section 15.5). Plain mutable records owned by one race; nothing
 * here is shared between races and nothing reads a clock or an unseeded random source.
 */

export type ComponentKind = 'engine' | 'steering' | 'wheel' | 'part';

/** Fixed component indices; wheels follow, then one per mounted part. */
export const COMPONENT_ENGINE = 0;
export const COMPONENT_STEERING = 1;
export const COMPONENT_FIRST_WHEEL = 2;

export type CarComponent = {
  kind: ComponentKind;
  /** Wheel index or part index; 0 for the engine and steering. */
  ref: number;
  /** Where it sits on the car, chassis-local pixels (x right, y toward the rear). */
  x: number;
  y: number;
  integrity: number;
  maxIntegrity: number;
  /** Which side of the car it is on, for arc-specific damage tags. */
  arc: CarArc;
  /** Section 8.1 state index last announced: 0 healthy, 1 damaged, 2 critical, 3 disabled. */
  condition: number;
};

/** Module lifecycle (Section 8.3): IDLE > TARGETING > ACTIVE > COOLDOWN > IDLE, or DISABLED. */
export const MODULE_IDLE = 0;
export const MODULE_TARGETING = 1;
export const MODULE_ACTIVE = 2;
export const MODULE_COOLDOWN = 3;
export const MODULE_DISABLED = 4;

export type ModuleRuntime = {
  state: number;
  /** Ticks until ready, and the length of the wait that is running, for a dial. */
  cooldown: number;
  cooldownTotal: number;
  /** Uses left, or -1 when unlimited. */
  charges: number;
  /** 0 nothing, 1 winding up, 2 emitting (burst or sustained effect), 3 action in progress. */
  phase: number;
  /** Ticks left of the current phase. */
  timer: number;
  /** Shots of a burst still to come, and ticks to the next one. */
  burstLeft: number;
  burstTimer: number;
  /** Ticks the target has been held in view, and whether that is a lock. */
  lock: number;
  locked: boolean;
  /** Aim relative to the car's nose, radians. A turret's traverse; otherwise its facing. */
  aim: number;
  /** Shield points, breakaway pool, as the part defines it. */
  pool: number;
  /** Where a lobbed shot was sent, and the component a repair is going to. */
  targetX: number;
  targetY: number;
  target: number;
  /** Tick a refusal was last reported, so a held button does not spam its driver. */
  refusedTick: number;
  /** Last tick line of sight was checked, and what it found. */
  losTick: number;
  los: boolean;
};

export type Projectile = {
  id: number;
  active: boolean;
  kind: ProjectileKind;
  owner: number;
  /** The weapon that fired it. Its numbers decide what happens on impact. */
  spec: ModuleSpec;
  x: number;
  y: number;
  /** World pixels per tick. */
  vx: number;
  vy: number;
  /** Ticks left. */
  life: number;
  age: number;
  /** Distance flown, for range falloff and the boomerang's turn-round. */
  travel: number;
  /** Car a guided projectile is steering at, or -1; or a decoy's hazard id when `decoyed`. */
  target: number;
  decoyed: boolean;
  /** 0 outbound, 1 returning. */
  phase: number;
  /** Cars already hit in this phase, as a bit mask. */
  hitMask: number;
  /** Where a lobbed projectile lands. */
  landX: number;
  landY: number;
  warned: boolean;
  /** Tick its recorded position and velocity were last rewritten (for snapshots). */
  syncTick: number;
  syncX: number;
  syncY: number;
  syncVx: number;
  syncVy: number;
};

export type Hazard = {
  id: number;
  active: boolean;
  kind: HazardKind;
  owner: number;
  /** The part that placed it. */
  spec: ModuleSpec;
  x: number;
  y: number;
  /** Radius of a round hazard, half-width of a strip. */
  radius: number;
  halfLength: number;
  angle: number;
  /** Ticks until live; ticks left. */
  arm: number;
  life: number;
  bornTick: number;
  /** Cars allowed to see it, as a bit mask. */
  revealMask: number;
  /** Drift of a decoy, world pixels per tick. */
  vx: number;
  vy: number;
};

export type Tether = {
  active: boolean;
  target: number;
  ticks: number;
  spec: ModuleSpec | null;
};

export type CarStats = {
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  hitsLanded: number;
  /** Damage dealt per mounted part, for the balance report. */
  damageByPart: number[];
  /** Activations per mounted part. */
  usesByPart: number[];
  ramsDealt: number;
  heatLimitedTicks: number;
  lowPowerTicks: number;
  impairedTicks: number;
};

export type CombatCar = {
  index: number;
  session: DriveSession;
  build: ResolvedBuild;
  buildHash: string;
  /** Canonical blueprint JSON, sent once so the other client can draw this car. */
  blueprintJson: string;
  /** Coefficients with every part working. `session.params` follows the disabled set. */
  baseParams: VehicleParams;
  /** Passive totals of the parts that are currently working. */
  totals: PassiveTotals;
  specs: ModuleSpec[];
  modules: ModuleRuntime[];
  /** Part indices of the manual utilities, in `use` bit order. */
  manualUtilities: number[];
  chassis: number;
  chassisMax: number;
  /** Armor points per arc, indexed front, right, rear, left; and their ceilings. */
  armor: number[];
  armorMax: number[];
  components: CarComponent[];
  /** Bit per part whose integrity is zero. */
  disabledMask: number;
  /** One slot per status family: magnitude, ticks left, the car that applied it, a reference value. */
  statusMagnitude: number[];
  statusTicks: number[];
  statusBy: number[];
  statusRef: number[];
  tether: Tether;
  /** Energy held by a burst capacitor, and its ceiling. */
  reserve: number;
  reserveMax: number;
  /** Ticks of zero chassis with two core systems down; and the verdict. */
  koTicks: number;
  ko: boolean;
  koBy: number;
  repairLock: number;
  /** Ticks the car has been pinned against something. */
  stuckTicks: number;
  /** Winch pull in progress: ticks left and velocity, px/s. */
  winchTicks: number;
  winchVx: number;
  winchVy: number;
  /** Weapons of other cars holding a lock on this one; a guided missile inbound. */
  lockCount: number;
  missileInbound: boolean;
  lockWarning: number;
  prevFire: number;
  prevUse: number;
  /** This tick's buttons. */
  fire: number;
  use: number;
  repairTarget: number;
  /** Position before this tick's integration, for swept tests. */
  prevX: number;
  prevY: number;
  /** Last car to damage this one, for attributing a KO. */
  lastHitBy: number;
  /** Radar and sensor reach, from working parts. */
  trackRange: number;
  revealRange: number;
  missileWarnTicks: number;
  acquisitionFactor: number;
  stats: CarStats;
  lastWallEventTick: number;
  /** True when this car's body touched another this tick. */
  touching: boolean;
  /** Bladed hubs (a wheel kit's own contact damage): numbers from the kit's params, 0 without. */
  bladeDamage: number;
  bladeCooldownTicks: number;
  bladeMinSpeed: number;
  bladeCooldown: number;
  /** Burn damage waiting for the next pulse, and where on the car the fire is, chassis-local. */
  burnPending: number;
  burnTimer: number;
  burnX: number;
  burnY: number;
  /** The weapon that lit it, and its part index on the attacker, for attributing the damage. */
  burnWeapon: string;
  burnPart: number;
  /** What put the grip status on: 1 oil, 2 frost. Fire thaws frost; it does not clean oil. */
  gripSource: number;
};

export type RaceOptions = {
  seed: number;
  /** Conditions the cars' coefficients are derived under, again whenever a part fails. */
  conditions: BuildConditions;
  catalog: Catalog;
};

export type RaceSession = {
  track: TrackRuntime;
  env: RaceEnvironment;
  options: RaceOptions;
  cars: CombatCar[];
  projectiles: Projectile[];
  hazards: Hazard[];
  /** Events of the tick that was just stepped. Cleared at the start of the next. */
  events: RaceEvent[];
  nextEventId: number;
  nextEntityId: number;
  tick: number;
  phase: MatchPhase;
  raceTicks: number;
  /** Race tick at which the finishing window closes, or -1. */
  finishWindowEnd: number;
  leader: number;
  result: RaceResult | null;
  /** Seeded gameplay randomness: misfires. AI brains carry their own. */
  rng: () => number;
  /** Tick ram damage between two cars was last dealt, keyed by pair. */
  lastRamTick: number;
  ramGraceTicks: number;
  scratchLoc: TrackLocation;
  /** Reused control records, one per car, for cars whose input is overridden. */
  controls: ControlInput[];
};

export type EmitFn = (race: RaceSession, body: RaceEventBody) => void;

export const STATUS_INDEX: Readonly<Record<StatusFamily, number>> = {
  slow: 0,
  grip: 1,
  burn: 2,
  emp: 3,
  jam: 4,
  boost: 5,
  refit: 6,
  airborne: 7,
  immune: 8,
};
export const STATUS_COUNT = 9;

export const ARC_INDEX: Readonly<Record<CarArc, number>> = { front: 0, right: 1, rear: 2, left: 3 };
export const ARCS: readonly CarArc[] = ['front', 'right', 'rear', 'left'];
