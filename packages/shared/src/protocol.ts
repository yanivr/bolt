import { z } from 'zod';
import { MAX_INPUTS_PER_PACKET, PROTOCOL_VERSION } from './balance.js';
import { blueprintSchema } from './blueprint.js';
import type {
  MatchPhase,
  VehicleEffects,
  VehicleMotionState,
  VehicleProgressState,
} from './types.js';

/**
 * Wire contract between the web client and the authoritative server. Every inbound payload is
 * parsed with these schemas before it can touch room state (Sections 15.4 and 19.6).
 */

export const ROOM_DRIVE = 'drive';

export const ClientMessage = {
  PLAYER_INPUT: 'PLAYER_INPUT',
  READY: 'READY',
  RESET_CAR: 'RESET_CAR',
  LEAVE: 'LEAVE',
} as const;

export const ServerMessage = {
  MATCH_PHASE: 'MATCH_PHASE',
  COUNTDOWN: 'COUNTDOWN',
  RACE_EVENT: 'RACE_EVENT',
  RESULTS: 'RESULTS',
  ERROR: 'ERROR',
} as const;

const finite = z.number().finite();

export const inputSampleSchema = z
  .object({
    sequence: z.number().int().nonnegative().max(0x7fffffff),
    clientTick: z.number().int().nonnegative().max(0x7fffffff),
    steer: finite.min(-1).max(1),
    brake: finite.min(0).max(1),
    coast: z.boolean(),
    /** Fire buttons held: bit 0 primary, bit 1 secondary. */
    fire: z.number().int().min(0).max(3).optional(),
    /** Manual utilities held, one bit each in blueprint order. */
    use: z.number().int().min(0).max(255).optional(),
    /** Repair target: 0 automatic, otherwise component index + 1. */
    target: z.number().int().min(0).max(63).optional(),
  })
  .strict();
export type InputSample = z.infer<typeof inputSampleSchema>;

export const playerInputMessageSchema = z
  .object({ inputs: z.array(inputSampleSchema).min(1).max(MAX_INPUTS_PER_PACKET) })
  .strict();
export type PlayerInputMessage = z.infer<typeof playerInputMessageSchema>;

const idSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_]+$/);

/**
 * A drive room join carries the whole blueprint. The server parses it with the strict schema,
 * validates it against its own catalog and derives every total, mass and coefficient itself;
 * nothing a client computed is accepted, and any extra field is a refusal.
 */
export const driveJoinOptionsSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    guestToken: z.string().min(16).max(512),
    trackId: idSchema,
    weatherPresetId: idSchema,
    blueprint: blueprintSchema,
    /**
     * Sparring rival to race: a shipped template id. Omitted, the room picks one from its
     * seed. A debug and test option; the rival is always a legal shipped build.
     */
    rivalTemplateId: idSchema.optional(),
    /** Seed for the rival's choices. Omitted, the room derives one. */
    seed: z.number().int().min(0).max(0x7fffffff).optional(),
    /**
     * A showcase scenario to host instead of a race: both cars come from the scenario and
     * follow its lanes; the joining client supplies only the first car's buttons.
     */
    scenarioId: idSchema.optional(),
  })
  .strict();
export type DriveJoinOptions = z.infer<typeof driveJoinOptionsSchema>;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'VERSION_MISMATCH',
  'UNKNOWN_TRACK',
  'UNKNOWN_PART',
  'ILLEGAL_BUILD',
  'CATALOG_MISMATCH',
  'RATE_LIMITED',
  'SERVER_FULL',
  'NOT_FOUND',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiError = { error: { code: ErrorCode; message: string } };

/**
 * Colyseus join refusals only carry a number, so each refusal reason has a stable code in the
 * application range. The client maps them back to player-facing screens.
 */
export const JOIN_ERROR_CODES = {
  BAD_REQUEST: 4400,
  UNAUTHORIZED: 4401,
  UNKNOWN_TRACK: 4404,
  VERSION_MISMATCH: 4409,
  UNKNOWN_PART: 4422,
  ILLEGAL_BUILD: 4423,
  CATALOG_MISMATCH: 4426,
  RATE_LIMITED: 4429,
  INTERNAL: 4500,
  SERVER_FULL: 4503,
} as const satisfies Partial<Record<ErrorCode, number>>;
export type JoinErrorCode = keyof typeof JOIN_ERROR_CODES;

export type MatchPhaseMessage = { phase: MatchPhase; tick: number };

/** How a hit is classed for armor and defenses (Section 8.4 effect families). */
export type HitClass = 'bullet' | 'direct' | 'heavy' | 'ram' | 'burn';

/** Status families. One entry per family is active on a car at a time (Section 11.8). */
export const STATUS_FAMILIES = [
  'slow',
  'grip',
  'burn',
  'emp',
  'jam',
  'boost',
  'refit',
  'airborne',
  'immune',
] as const;
export type StatusFamily = (typeof STATUS_FAMILIES)[number];

/** Section 8.1 component states. */
export type ComponentCondition = 'healthy' | 'damaged' | 'critical' | 'disabled';

/** Kinds of things in flight. `lobbed` kinds fly over cars and walls and land on a marked spot. */
export const PROJECTILE_KINDS = [
  'bullet',
  'pellet',
  'rocket',
  'missile',
  'frost',
  'harpoon',
  'boomerang',
  'foam',
  'shell',
] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

/** Kinds of things lying on, or hovering over, the road. */
export const HAZARD_KINDS = ['mine', 'oil', 'foam', 'fire', 'frost', 'decoy'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

/** Why a fire or utility command did nothing. Reported to its own driver only. */
export type RefusalReason =
  | 'no_weapon'
  | 'cooldown'
  | 'no_ammo'
  | 'low_power'
  | 'overheat'
  | 'disabled'
  | 'jammed'
  | 'no_target'
  | 'not_needed'
  | 'busy';

/**
 * Everything discrete a client must show or hear exactly once (Sections 13.4, 13.6, 15.4).
 * `car` is the index of the car the event belongs to; `by` the car that caused it; `part` an
 * index into that car's blueprint parts (canonical order) and `weapon` the catalog id of that
 * part. Positions are world pixels and `dir` is a heading in radians, 0 up and clockwise.
 * docs/COMBAT_API.md describes when each one fires and what follows it.
 */
export type RaceEventBody =
  | { type: 'checkpoint'; car: number; index: number }
  | { type: 'lap'; car: number; lap: number; lapTimeMs: number }
  | { type: 'finish'; car: number; raceTimeMs: number; finished: boolean }
  | { type: 'wall'; car: number; speed: number }
  | { type: 'position'; leader: number; gapMeters: number }
  | {
      /**
       * The tow (the long-range catch-up) took hold of a car or let go of it. At most one every
       * few seconds for a car. The level itself is `tow` in the snapshot.
       */
      type: 'catchup';
      car: number;
      state: 'engaged' | 'released';
    }
  | {
      /** A weapon is winding up: railgun charge, EMP charge, hammer draw, flame ignition. */
      type: 'windup';
      car: number;
      part: number;
      weapon: string;
      ticks: number;
    }
  | {
      /** Something left a weapon. `projectile` is 0 when nothing flies (hitscan, cone, pulse). */
      type: 'shot';
      car: number;
      part: number;
      weapon: string;
      x: number;
      y: number;
      dir: number;
      projectile: number;
      /** Which shot of the activation this is, from 0, and how many there are. */
      n: number;
      of: number;
    }
  | {
      /** An instant line: the railgun slug, a Tesla arc. `hit` is the car struck, or -1. */
      type: 'beam';
      car: number;
      part: number;
      weapon: string;
      x: number;
      y: number;
      toX: number;
      toY: number;
      hit: number;
    }
  | {
      /** An emission with a shape and a duration: flame cone, air blast, EMP ring. */
      type: 'area';
      car: number;
      part: number;
      weapon: string;
      x: number;
      y: number;
      dir: number;
      /** Half-angle in radians; PI for a full ring. */
      half: number;
      range: number;
      ticks: number;
    }
  | {
      /** A mark on the ground that something will land on: mortar reticle, foam landing. */
      type: 'telegraph';
      car: number;
      part: number;
      weapon: string;
      x: number;
      y: number;
      radius: number;
      ticks: number;
      projectile: number;
    }
  | {
      /** A tracking weapon gained or lost its target. */
      type: 'lock';
      car: number;
      part: number;
      weapon: string;
      target: number;
      locked: boolean;
    }
  | {
      /** Information for one driver: being locked, a missile about to hit, a trap revealed. */
      type: 'warning';
      car: number;
      kind: 'lock' | 'lock_lost' | 'missile' | 'trap';
      by: number;
      /** Ticks until impact for `missile`, hazard id for `trap`, otherwise 0. */
      value: number;
    }
  | {
      /** Damage landed. `component` is -1 when only bodywork was struck. */
      type: 'hit';
      car: number;
      by: number;
      weapon: string;
      cls: HitClass;
      x: number;
      y: number;
      component: number;
      /** Integrity taken from the component, and from the chassis. */
      damage: number;
      chassis: number;
      /** What stood in the way, in points. */
      shield: number;
      armor: number;
      absorbed: number;
      projectile: number;
    }
  | {
      type: 'explosion';
      by: number;
      weapon: string;
      x: number;
      y: number;
      radius: number;
      projectile: number;
    }
  | {
      /** A projectile ended without striking a car. */
      type: 'impact';
      weapon: string;
      x: number;
      y: number;
      projectile: number;
      on: 'wall' | 'obstacle' | 'ground' | 'expired' | 'caught' | 'intercepted' | 'scrambled';
    }
  | {
      type: 'status';
      car: number;
      by: number;
      family: StatusFamily;
      state: 'applied' | 'expired' | 'blocked';
      magnitude: number;
      ticks: number;
    }
  | { type: 'impulse'; car: number; by: number; weapon: string; dx: number; dy: number }
  | {
      type: 'component';
      car: number;
      component: number;
      condition: ComponentCondition;
      integrity: number;
      /** True when the change is a repair. */
      repaired: boolean;
    }
  | {
      type: 'shield';
      car: number;
      part: number;
      state: 'up' | 'down' | 'broken';
      points: number;
    }
  | {
      type: 'hazard';
      hazard: number;
      kind: HazardKind;
      by: number;
      state: 'placed' | 'armed' | 'triggered' | 'expired' | 'cleared' | 'ignited' | 'melted';
      x: number;
      y: number;
      /** The car that set it off or cleared it, or -1. */
      car: number;
    }
  | {
      type: 'tether';
      car: number;
      part: number;
      target: number;
      state: 'attached' | 'released';
    }
  | {
      type: 'utility';
      car: number;
      part: number;
      utility: string;
      state: 'started' | 'done' | 'interrupted';
      /** Component index for a repair, ticks for a timed effect, otherwise 0. */
      value: number;
    }
  | { type: 'misfire'; car: number; part: number; weapon: string }
  | { type: 'refused'; car: number; part: number; reason: RefusalReason }
  | { type: 'ko'; car: number; by: number }
  | { type: 'result'; winner: number; reason: 'finish' | 'timeout' | 'ko' };

export type RaceEvent = RaceEventBody & { id: number; tick: number };
export type RaceEventType = RaceEvent['type'];

/** Runtime state of one mounted part: a weapon, a reactive defense or a utility. */
export type ModuleSnapshot = {
  /** 0 idle, 1 targeting, 2 active, 3 cooldown, 4 disabled (Section 8.3 lifecycle). */
  state: number;
  /** Uses left this match, or -1 when the part is not limited by charges. */
  charges: number;
  /** Tick at which the part is ready again, and the length of that wait, for a cooldown dial. */
  readyTick: number;
  cooldownTicks: number;
  /** Aim relative to the car, radians: where a turret points. */
  aim: number;
  /** True while a tracking weapon holds its target. */
  locked: boolean;
  /** Shield points, breakaway armor left or capacitor reserve, as the part defines it. */
  pool: number;
};

/** One active status on a car. */
export type StatusSnapshot = { family: StatusFamily; magnitude: number; untilTick: number };

/** Combat state of one car as its own driver sees it. */
export type CarCombatSnapshot = {
  chassis: number;
  chassisMax: number;
  /** Armor points left per arc: front, right, rear, left. */
  armor: number[];
  /** Integrity per component: engine, steering, each wheel, then each mounted part. */
  components: number[];
  statuses: StatusSnapshot[];
  /** One entry per mounted part, in canonical blueprint order. */
  modules: ModuleSnapshot[];
  /** Energy held in the burst capacitor, 0 without one. */
  reserve: number;
  /** 0 none, 1 a rival weapon has a lock, 2 a guided missile is inbound. */
  lockWarning: number;
  ko: boolean;
};

/** What a driver may know about the other car: what could be seen from outside (Section 7.5). */
export type RivalSnapshot = {
  x: number;
  y: number;
  headingRad: number;
  velocityX: number;
  velocityY: number;
  steeringInput: number;
  braking: boolean;
  lap: number;
  checkpointIndex: number;
  courseProgress: number;
  finishedAtMs: number | null;
  chassis: number;
  chassisMax: number;
  armor: number[];
  components: number[];
  statuses: StatusSnapshot[];
  /** Visible part state only: lifecycle state, turret aim, whether a shield is up. */
  modules: Array<{ state: number; aim: number; up: boolean }>;
  ko: boolean;
  buildHash: string;
  /** The rival's tow, as `CarSnapshot.tow`: it can be seen pulling, so it may be shown. */
  tow: number;
};

export type ProjectileSnapshot = {
  id: number;
  kind: ProjectileKind;
  owner: number;
  /**
   * Position and velocity (world px per second) at `tick`. Ballistic kinds keep the values
   * they were launched with and a client moves them forward itself; missiles and boomerangs
   * are rewritten every snapshot.
   */
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick: number;
  /** Tick at which a lobbed kind lands, otherwise 0. */
  landTick: number;
};

export type HazardSnapshot = {
  id: number;
  kind: HazardKind;
  owner: number;
  x: number;
  y: number;
  radius: number;
  /** For a strip: half its length along `angle`. Zero for a round hazard. */
  halfLength: number;
  angle: number;
  /** Tick from which it is live, and at which it goes away. */
  armedTick: number;
  endTick: number;
  /** True when the viewing driver is allowed to see it (own, close, or detected). */
  revealed: boolean;
};

export type RaceResultCar = {
  finished: boolean;
  finishTimeMs: number | null;
  courseProgress: number;
  lastCheckpointMs: number;
  bestLapMs: number;
  chassis: number;
  ko: boolean;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  hitsLanded: number;
};

/** Section 3.4: one authoritative result. `winner` is -1 for an explicit draw. */
export type RaceResult = {
  winner: number;
  reason: 'finish' | 'timeout' | 'ko';
  raceTimeMs: number;
  cars: RaceResultCar[];
};

/** Everything about the race that is not the viewer's own car. */
export type RaceSnapshot = {
  tick: number;
  /** Index of the viewing driver's car. */
  you: number;
  /** Race phase: COUNTDOWN, RACING, FINISHED. A car's own `phase` goes FINISHED when it finishes. */
  phase: MatchPhase;
  raceTimeMs: number;
  /** The viewer's car: everything the predictor needs, plus its combat state. */
  car: CarSnapshot;
  rival: RivalSnapshot;
  /** Canonical JSON of the rival's blueprint, so its car can be drawn. Never changes. */
  rivalBlueprint: string;
  projectiles: ProjectileSnapshot[];
  hazards: HazardSnapshot[];
  /** 1 leading, 2 trailing. */
  position: number;
  /** Distance to the other car along the course, positive when the viewer leads. */
  gapMeters: number;
  gapSeconds: number;
  /** True while the rival is close enough (or Radar reaches far enough) to show its direction. */
  rivalTracked: boolean;
  /** Tick at which the finishing window closes, or 0 before anyone has finished. */
  finishWindowEndTick: number;
  result: RaceResult | null;
};

/**
 * Plain snapshot of one authoritative car. The Colyseus schema mirrors these fields; the
 * client converts state patches into this shape before reconciling its prediction.
 */
export type CarSnapshot = {
  tick: number;
  /** Sequence number of the last input sample the server consumed for this car. */
  ackSequence: number;
  raceTimeMs: number;
  phase: MatchPhase;
  /** Whole seconds left on the start countdown, zero once racing. */
  countdown: number;
  /** Exact simulation ticks left before GO, so a predicting client starts on the same tick. */
  countdownTicks: number;
  /**
   * Includes the powertrain state (core heat, battery, thermal limit, engine wind-up, charge,
   * cycle clock and burst, tire wear), so a predicting client resumes from exactly the state
   * the server simulated.
   */
  motion: VehicleMotionState;
  progress: VehicleProgressState;
  bestLapMs: number;
  lastLapMs: number;
  /** Integrity of each wheel, one entry per wheel anchor of the chassis. */
  wheelIntegrity: number[];
  /** Mechanical hash of the blueprint the server accepted for this car. */
  buildHash: string;
  /**
   * What damage and statuses are doing to the car's driving. The predictor replays its
   * unacknowledged input with exactly these numbers. Absent means nothing is acting on it.
   */
  effects?: VehicleEffects;
  /** Combat state. Absent in a session with no combat (benches and tests of one car). */
  combat?: CarCombatSnapshot;
  /**
   * The tow, the long-range catch-up: the share of its whole bonus (`TOW.maxBonus` of top speed)
   * this car has right now, 0 to 1 in steps of a hundredth. Exactly 0 when it is not being
   * towed, which is always the case for the leader, within `TOW.thresholdGap` of the car ahead,
   * in the countdown and the first seconds of the race, once wrecked and after the finish. Not to
   * be confused with `effects.tow`, the bonus itself as a share of top speed, for prediction.
   */
  tow: number;
};

export type GuestSessionResponse = {
  guestId: string;
  token: string;
  expiresAt: string;
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  protocolVersion: number;
  catalogVersion: string;
  uptimeSeconds: number;
  rooms: number;
  dependencies: Record<string, 'ok' | 'unavailable' | 'not_configured'>;
};
