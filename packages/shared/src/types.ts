/**
 * Shared data contracts. Content authors, the authoritative server, and the web client all
 * compile against these types, so a change here is a protocol change.
 */

export const SURFACE_IDS = [
  'asphalt',
  'cobble',
  'sand',
  'dirt',
  'mud',
  'snow',
  'ice',
  'metal',
] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

export const WEATHER_IDS = [
  'clear',
  'rain',
  'heavy_rain',
  'sandstorm',
  'dry_heat',
  'snowfall',
  'clear_frost',
] as const;
export type WeatherId = (typeof WEATHER_IDS)[number];

export type BiomeId = 'city' | 'desert' | 'forest' | 'snow' | 'industrial';

export type WeatherPreset = {
  /** Unique preset id, for example `city_clear_night`. */
  id: string;
  /** The row of the Section 9.2 grip table this preset uses. */
  weather: WeatherId;
  displayName: string;
  timeOfDay: 'day' | 'dusk' | 'night';
  ambientTempC: number;
  /** 0 dry to 1 standing water. Drives spray, reflections and cosmetic rain density. */
  wetness: number;
  /** World-space wind in world pixels per second. */
  windX: number;
  windY: number;
  visibility: number;
};

// ---------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------

export type PartCategory = 'chassis' | 'engine' | 'tires' | 'weapon' | 'defense' | 'utility';
export type AccessoryCategory = 'weapon' | 'defense' | 'utility';
export type TriggerMode = 'manual' | 'automatic' | 'hybrid' | 'passive';

export type MountCategory =
  | 'ENGINE'
  | 'WHEEL'
  | 'ROOF'
  | 'FRONT'
  | 'REAR'
  | 'LEFT'
  | 'RIGHT'
  | 'UTILITY'
  | 'ARMOR'
  | 'UNIVERSAL';

export type QuarterTurn = 0 | 1 | 2 | 3;
/** How a mounted part's direction is decided. See `AccessoryDefinition.facing`. */
export type PartFacing = 'free' | 'fixed' | 'none';

/** Which way a hit arrives, or a part faces, in the car's own frame. */
export type CarArc = 'front' | 'rear' | 'left' | 'right';

/**
 * Tags that incoming damage and impulses carry. `ModifyDamageByTag` scales one of them.
 * Direction tags (`front`, `rear`, `left`, `right`) refer to the arc the hit arrives from.
 */
export type DamageTag =
  | 'bullet'
  | 'direct'
  | 'heavy'
  | 'ram'
  | 'ram_front'
  | 'ram_rear'
  | 'burn'
  | 'heat_status'
  | 'emp_duration'
  | 'oil'
  | 'puncture'
  | 'wheel'
  | 'engine'
  | 'steering'
  | 'engine_output_loss'
  | 'front'
  | 'rear'
  | 'left'
  | 'right'
  | 'rear_mounted_part'
  | 'mounted_part';

/** Engine output over speed and time. Every number is consumed by `stepVehicle`. */
export type TorqueCurve = {
  /** Relative wheel force. The Four-Cylinder is 100. */
  forceIndex: number;
  /** Extra low-speed pull, as a fraction of rated force, that fades with speed. */
  launchBoost: number;
  /** Speed scale of the launch boost fade, world px/s. */
  launchFadeSpeed: number;
  /** Multiplier on the speeds at which force tapers out: the engine's rev ceiling. */
  topEndFactor: number;
  /** Multiplier on the speed where the taper starts. Above 1 holds rated force for longer. */
  taperStartFactor: number;
  /** Multiplier on traction-limited acceleration (how well force reaches the road). */
  tractionFactor: number;
  /**
   * Wind-up. Output is `spoolFloor` of rated force when cold and rises to full over
   * `spoolUpSeconds` of throttle, then falls back over `spoolDownSeconds`. Zero disables it.
   */
  spoolUpSeconds: number;
  spoolDownSeconds: number;
  spoolFloor: number;
  /** While fully spooled the rev ceiling is raised by this factor (Turbine). 1 for none. */
  spoolTopEndFactor: number;
  /**
   * Repeating output cycle tied to race time: output swings between `cycleLowFactor` and 1
   * with this period (Wildcard Motor). Zero disables it.
   */
  cyclePeriodSeconds: number;
  cycleLowFactor: number;
  /**
   * Fuel pulses (Rocket Engine). A full tank burns for `pulseBurnSeconds` at rated force,
   * then the engine idles at `pulseRestFactor` while the tank refills over
   * `pulseRefillSeconds`. Lifting the throttle also refills. Zero burn time disables it.
   */
  pulseBurnSeconds: number;
  pulseRefillSeconds: number;
  pulseRestFactor: number;
  /**
   * Stored launch (Spring Drive). One burst of `burstFactor` times rated force lasting
   * `burstSeconds` is stored every `burstRechargeSeconds` and released on full throttle.
   */
  burstRechargeSeconds: number;
  burstSeconds: number;
  burstFactor: number;
  /** Multiplier on top-end speed on paved surfaces (asphalt, cobble, metal). */
  roadSpeedFactor: number;
  /** Multiplier on rolling resistance on loose surfaces (sand, dirt, mud, snow). */
  looseRollingFactor: number;
  /** Multiplier on traction-limited acceleration on loose surfaces. */
  looseTractionFactor: number;
};

/** Where an electrical consumer sits when power runs short. Lower numbers are served first. */
export type PowerPriority = 0 | 1 | 2 | 3 | 4;

/** What an electrical consumer contributes while it is supplied. Scaled by its supply. */
export type PoweredEffect = {
  cooling?: number;
  stability?: number;
  /** Multiplier on kinetic (sliding) grip, minus one. */
  slipRecovery?: number;
  /** Extra grip per (speed / reference speed) squared. */
  downforce?: number;
  /** Extra grip multiplier, minus one, on the listed surfaces. */
  surfaceGrip?: Partial<Record<SurfaceId, number>>;
  /** Extra grip multiplier, minus one, on every surface in wet weather. */
  wetGrip?: number;
};

/**
 * Passive mechanic primitives (Section 11.8). Every passive effect of every part is one or
 * more of these. `aggregateModifiers` folds a car's whole list into totals, and
 * `deriveVehicleParams` turns the totals into integrator coefficients. Nothing reads a part id.
 */
export type PartModifier =
  | { type: 'AddMass'; kg: number }
  | { type: 'ModifyTorqueCurve'; set?: TorqueCurve; scale?: Partial<TorqueCurve> }
  | { type: 'ModifyDrag'; factor: number }
  | {
      type: 'ModifyGripBySurface';
      /** Multiplier on grip. */
      factor: number;
      /** Surfaces it applies to. Omitted means every surface. */
      surfaces?: SurfaceId[];
      /** `wet` applies only in wet weather, `dry` only otherwise. */
      when?: 'wet' | 'dry';
    }
  | {
      type: 'ModifySlipRecovery';
      /** Multiplier on sliding grip, the share of peak force kept in a slide. */
      factor?: number;
      /** Multiplier on how readily the tires let go (lower slides sooner). */
      stiffness?: number;
      /** Multiplier on self-aligning yaw. */
      align?: number;
    }
  | {
      type: 'ModifyHeatGeneration';
      /** Heat per second at sustained full throttle (engine) or constantly (`constant`). */
      add?: number;
      constant?: number;
      factor?: number;
      /** Multiplier on engine heat below the partial-load throttle threshold. */
      partialLoadFactor?: number;
      /** Shifts the performance threshold: negative suffers from heat sooner. */
      toleranceOffset?: number;
      /** Share of full-throttle heat produced at idle. */
      idleFraction?: number;
    }
  | { type: 'ModifyCooling'; add: number }
  | {
      type: 'ModifyEnergyGeneration';
      add: number;
      /** `solar` scales with daylight and weather, `off_throttle` applies while lifting. */
      condition?: 'solar' | 'off_throttle';
    }
  | { type: 'ModifyEnergyCapacity'; add: number; reserve?: boolean }
  | {
      type: 'ModifyPowerPriority';
      /** Continuous draw in power units per second. */
      draw: number;
      priority: PowerPriority;
      /** True when the draw follows the throttle (electric drivetrains). */
      drivetrain?: boolean;
      /** What the consumer provides while supplied. */
      effect?: PoweredEffect;
    }
  | { type: 'AddArmorArc'; hp: number; arcs: CarArc[] | 'mounted' }
  | {
      type: 'ModifyIntegrity';
      target: 'chassis' | 'wheels' | 'engine' | 'armor';
      factor: number;
    }
  | { type: 'ModifyDamageByTag'; tag: DamageTag; factor: number }
  | {
      type: 'ModifyImpulse';
      /** `obstacle` scales wall and obstacle strikes taken, `ram_dealt` what a ram delivers. */
      kind: 'obstacle' | 'ram_dealt' | 'displacement';
      factor: number;
    }
  | {
      type: 'ModifySteeringResponse';
      /** Multiplier on yaw response. */
      yaw?: number;
      /** Multiplier on the turning radius at low speed. */
      turnRadius?: number;
      /** Additive stability score. */
      stability?: number;
      /** Multiplier on peak lateral grip. */
      peakGrip?: number;
      /** Extra lateral grip, as a fraction, while cornering (Sliding Ballast). */
      corneringGrip?: number;
      /** Multiplier on braking deceleration. */
      braking?: number;
      /** Multiplier on top speed everywhere. */
      topSpeed?: number;
      /** Multiplier on top speed on paved surfaces only. */
      roadSpeed?: number;
      /** Multiplier on grip lost on the shoulder (0 removes the penalty). */
      shoulderPenalty?: number;
      /** Tire wear: grip fades to `wornGrip` between these race seconds. */
      wearStartSeconds?: number;
      wearRampSeconds?: number;
      wornGrip?: number;
      /** Extra rolling resistance, px/s2, on the listed surfaces. */
      rollingAdd?: number;
      rollingSurfaces?: SurfaceId[];
      /** Multiplier on rolling resistance on the listed surfaces. */
      rollingFactor?: number;
      /** Multiplier on width for collision. */
      width?: number;
    }
  | {
      type: 'AddHardpoint';
      category: MountCategory;
      /** Extra attachments beyond one per mount, realised as rack capacity in the layout. */
      count: number;
    }
  | {
      type: 'OverrideAimingArc';
      /** Mount categories the change applies to. */
      mounts: MountCategory[];
      addDegrees?: number;
      rangeFactor?: number;
    };

export type PartModifierType = PartModifier['type'];

/** Active mechanic primitives (Section 11.8). Declared in data now, executed in Milestone C. */
export type ActivePrimitiveType =
  | 'SpawnProjectile'
  | 'SpawnMine'
  | 'SpawnAreaHazard'
  | 'ApplyDirectDamage'
  | 'ApplyDamageOverTime'
  | 'ApplyHeat'
  | 'ApplyGripDebuff'
  | 'ApplyEMP'
  | 'ApplyImpulse'
  | 'ApplyTether'
  | 'GrantTemporaryShield'
  | 'RepairComponent'
  | 'ReplaceWheel'
  | 'PulseTorque'
  | 'ConsumeCharge'
  | 'StartCooldown'
  | 'AcquireTarget'
  | 'InterceptProjectile'
  | 'ShowTelegraph';

export type PartParamValue = number | string | boolean;
export type PartParams = Record<string, PartParamValue>;
export type ActivePrimitive = { type: ActivePrimitiveType } & PartParams;

export type PartDefinition = {
  id: string;
  displayName: string;
  category: PartCategory;
  price: number;
  massKg: number;
  /**
   * Width (across the car) and length (along it) in world pixels. For an accessory this is the
   * part at quarter turn 0, facing the front of the car; the room it takes once mounted is
   * `occupiedFootprint`.
   */
  footprint: { w: number; h: number };
  compatibleMounts: MountCategory[];
  spriteKey: string;
  soundKey: string;
  /** One-line benefit shown on the part card. */
  description: string;
  /** One-line downside shown on the part card. */
  drawback: string;
  modifiers: PartModifier[];
  behaviorId?: string;
  triggerMode?: TriggerMode;
  /** Every number of the part's defining effect, flat, for cards and for Milestone C. */
  params?: PartParams;
  /** The same effect as an ordered list of active primitives. */
  actions?: ActivePrimitive[];
  maxPerCar?: number;
};

/**
 * Chassis-local coordinates: origin at the body centre, front is negative Y, right is
 * positive X, units are world pixels.
 */
export type MountPoint = {
  id: string;
  /** The first entry is the mount's primary category. */
  categories: MountCategory[];
  x: number;
  y: number;
  /** Half-extent of the bounded installation region around the hardpoint. */
  regionHalfW: number;
  regionHalfH: number;
  /** Largest occupied footprint (`occupiedFootprint`) this mount accepts. */
  maxFootprint: { w: number; h: number };
  /**
   * Ways a part with a free facing may point here: 0 front, 1 right, 2 rear, 3 left. A
   * statement about the car, not about geometry. The first is the default.
   */
  allowedQuarterTurns: QuarterTurn[];
  /** How many small parts may share this mount. A large part always takes all of it. */
  capacity: number;
  /** Accepts any weapon, whatever its own mount list says (Horseshoe front cavity). */
  acceptsAnyWeapon?: boolean;
};

export type WheelAnchor = {
  id: string;
  x: number;
  y: number;
  steers: boolean;
  driven: boolean;
};

export type ChassisDefinition = PartDefinition & {
  category: 'chassis';
  wheelCount: 3 | 4 | 6;
  wheelAnchors: WheelAnchor[];
  mounts: MountPoint[];
  /** Physical bounds of the body, used for collision circles and overlap validation. */
  bodyHalfWidth: number;
  bodyHalfLength: number;
  recommendedLoadKg: number;
  maxLoadKg: number;
  baseIntegrity: number;
  /** Aerodynamic drag multiplier relative to the Beetle. */
  dragFactor: number;
  /** Yaw response multiplier relative to the Beetle. */
  yawFactor: number;
  /** Additive stability score offset. */
  stabilityOffset: number;
  /** Below this stability score the handling penalties of Section 6.2 begin. */
  stabilityThreshold: number;
  /** Share of the maximum safe load that may be armor plate. */
  armorLoadShare: number;
  /** Engine the garage starts this chassis with. */
  defaultEngineId: string;
  /** Section 6.4 handling character, shown with the mount layout. */
  handling: string;
};

export type EngineDefinition = PartDefinition & {
  category: 'engine';
  /** Relative wheel force. The Four-Cylinder is 100. */
  forceIndex: number;
  /** Heat per second at sustained full throttle, before cooling. */
  heatPerSecond: number;
  /** Continuous electrical draw in power units per second at full throttle. */
  powerDraw: number;
  curve: TorqueCurve;
};

export type TireDefinition = PartDefinition & {
  category: 'tires';
  /** Clear-weather asphalt grip multiplier. */
  grip: number;
  /** Continuous electrical draw in power units per second. */
  powerDraw: number;
};

export type AccessoryDefinition = PartDefinition & {
  category: AccessoryCategory;
  triggerMode: TriggerMode;
  behaviorId: string;
  params: PartParams;
  /** `full` takes the whole hardpoint, `shared` may sit on a rack beside another small part. */
  hardpointUse: 'full' | 'shared';
  /**
   * Whether the player chooses which way the part points. `free`: any way its mount allows,
   * and it occupies a square base so the choice never depends on room. `fixed`: the part
   * decides (`fixedTurn`). `none`: direction means nothing and it stays at quarter turn 0.
   */
  facing: PartFacing;
  /**
   * For a `fixed` part: the quarter turn it always has, or `outward` for away from the centre
   * line of the car, which depends on the side its mount is on.
   */
  fixedTurn?: QuarterTurn | 'outward';
  /** 0 flush, 1 raised, 2 tall. Tall parts raise the centre of mass. */
  heightLevel: 0 | 1 | 2;
  /** Sustained electrical draw shown on the part card (zero for parts that draw per shot). */
  powerDraw: number;
  /** Sustained heat effect shown on the part card: positive heats, negative cools. */
  heatEffect: number;
};

export type AnyPartDefinition =
  ChassisDefinition | EngineDefinition | TireDefinition | AccessoryDefinition;

export type PaintOption = { id: string; displayName: string };

/** The whole shipped catalog. Shared rules take it as an argument so they stay pure. */
export type Catalog = {
  version: string;
  chassis: Record<string, ChassisDefinition>;
  engines: Record<string, EngineDefinition>;
  tires: Record<string, TireDefinition>;
  /** Weapons, defenses and utilities. */
  parts: Record<string, AccessoryDefinition>;
  paints: Record<string, PaintOption>;
};

// ---------------------------------------------------------------------------------------------
// Blueprints (Section 15.6)
// ---------------------------------------------------------------------------------------------

export type BlueprintPart = {
  instanceId: string;
  partId: string;
  mountId: string;
  offsetX: number;
  offsetY: number;
  rotationQuarterTurns: QuarterTurn;
  assignedActionSlot?: 0 | 1;
  autoMode?: boolean;
};

export type VehicleBlueprint = {
  formatVersion: 1;
  catalogVersion: string;
  name: string;
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
  parts: BlueprintPart[];
  createdAt: string;
};

// ---------------------------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------------------------

export type TrackControlPoint = {
  x: number;
  y: number;
  /** Full paved width in world pixels at this control point. */
  width: number;
  /** Surface from this control point up to the next one. Defaults to the branch surface. */
  surface?: SurfaceId;
  /** Drivable shoulder on each side beyond the pavement. Defaults to the branch shoulder. */
  shoulder?: number;
};

export type TrackBranchDefinition = {
  id: string;
  closed: boolean;
  surface: SurfaceId;
  shoulder: number;
  shoulderSurface: SurfaceId;
  points: TrackControlPoint[];
};

export type ShortcutDefinition = TrackBranchDefinition & {
  closed: false;
  /**
   * World points near where this branch leaves and rejoins the main line. The track builder
   * snaps both ends onto the closest main-line position, so authors never hand-tune arc lengths.
   */
  leaveNear: { x: number; y: number };
  rejoinNear: { x: number; y: number };
  signName: string;
};

export type TrackObstacle = {
  id: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
};

export type TrackProp = {
  kind: string;
  x: number;
  y: number;
  /** Rotation in quarter turns for rectilinear props, radians for free props. */
  rotation?: number;
  variant?: number;
};

export type TrackDefinition = {
  id: string;
  name: string;
  biome: BiomeId;
  character: string;
  laps: number;
  worldWidth: number;
  worldHeight: number;
  main: TrackBranchDefinition & { closed: true };
  shortcuts: ShortcutDefinition[];
  /** Number of evenly spaced ordered checkpoints, including the start line. */
  checkpointCount: number;
  /** World point near the start and finish line. Snapped onto the main line. */
  startNear: { x: number; y: number };
  obstacles: TrackObstacle[];
  props: TrackProp[];
  landmarks: string[];
  weatherPresetIds: string[];
  surfaceMix: Partial<Record<SurfaceId, number>>;
};

// ---------------------------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------------------------

/** One fixed-step control sample. Matches Section 15.5. */
export type PlayerInput = {
  sequence: number;
  clientTick: number;
  /** Inclusive range -1 (left) to 1 (right). */
  steer: number;
  /** Inclusive range 0 to 1. Above the lift threshold the throttle releases. */
  brake: number;
  /** Fire buttons held this tick: bit 0 primary, bit 1 secondary (Section 8.3). */
  fire?: number;
  /** Manual utilities held this tick, one bit per manual utility in blueprint order. */
  use?: number;
  /** Component a repair should go to: 0 lets the car choose, otherwise component index + 1. */
  target?: number;
};

/**
 * The part of a vehicle that the pure integrator reads and writes every step. Everything
 * needed to resume a car after a reconnect or to replay client prediction lives here.
 */
export type VehicleMotionState = {
  x: number;
  y: number;
  headingRad: number;
  velocityX: number;
  velocityY: number;
  yawRate: number;
  /** Filtered steering actually applied to the wheels, -1 to 1. */
  steeringInput: number;
  brakeInput: number;
  throttleFraction: number;
  /** Seconds the car has been held on the brake while stationary. Drives reverse. */
  reverseHold: number;
  reversing: boolean;
  /** Seconds remaining of reduced scrape loss after a wall strike. */
  wallGrace: number;
  /** Shared core heat, in heat units (Section 6.5). */
  coreHeat: number;
  /** Stored electrical energy, in energy units. */
  batteryEnergy: number;
  /** True from the thermal protection threshold until heat falls below recovery. */
  thermalLimited: boolean;
  /** Engine wind-up, 0 cold to 1 fully spooled. */
  engineSpool: number;
  /** Engine reservoir, 0 to 1: rocket fuel or the stored spring launch. */
  engineCharge: number;
  /** Seconds into the engine's repeating output cycle. */
  engineClock: number;
  /** Seconds left of a stored launch burst, or 1 while a fuel pulse burns. */
  engineBurst: number;
  /** Seconds of driving the tires have done, for compounds that wear. */
  tireWearSeconds: number;
};

export type VehicleProgressState = {
  /** Index of the next checkpoint the car must cross. */
  checkpointIndex: number;
  lap: number;
  /** Monotonic course progress in world pixels across all laps. */
  courseProgress: number;
  /** Simulation time of the last valid checkpoint crossing, in milliseconds. */
  lastCheckpointMs: number;
  wrongWaySeconds: number;
  finishedAtMs: number | null;
};

/** Per-step observations for rendering, audio and telemetry. Never fed back into physics. */
export type VehicleTelemetry = {
  speed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  /** Signed slip angle in radians between the heading and the travel direction. */
  slipAngle: number;
  /** 0 gripping to 1 fully sliding. */
  slipRatio: number;
  surface: SurfaceId;
  onShoulder: boolean;
  grip: number;
  /** Normalized engine speed 0 to 1 for audio and exhaust. */
  rpm: number;
  wallContact: boolean;
  /** Closing speed of the strongest wall strike this step, zero when none. */
  wallImpactSpeed: number;
  wallNormalX: number;
  wallNormalY: number;
  /** Engine output this step as a fraction of rated force, after every limit. */
  powerFraction: number;
  /** Share of the electric drivetrain's demand that was supplied, 1 when it has none. */
  drivetrainSupply: number;
  /** Share of optional electrical demand that was supplied this step. */
  auxSupply: number;
  /** Power generated and demanded this step, units per second. */
  generation: number;
  powerDemand: number;
  /** Heat produced and shed this step, units per second. */
  heatProduction: number;
  heatCooling: number;
  /** 0 normal, 1 warning (70), 2 performance loss (90), 3 thermal protection (110). */
  heatLevel: 0 | 1 | 2 | 3;
  lowPower: boolean;
};

/**
 * Physical coefficients derived once from a blueprint and the published conditions.
 * Recomputed only when damage or status effects change them.
 */
export type VehicleParams = {
  massKg: number;
  /** Rated wheel force. Acceleration is force divided by mass. */
  driveForce: number;
  launchBoost: number;
  launchFadeSpeed: number;
  /** Speed above which engine force tapers toward zero at `forceZeroSpeed`. */
  forceTaperSpeed: number;
  forceZeroSpeed: number;
  dragLinear: number;
  dragQuadratic: number;
  brakeDecel: number;
  /** Lateral acceleration available at grip 1.0, world pixels per second squared. */
  lateralGripAccel: number;
  /** Traction-limited forward acceleration at grip 1.0. */
  tractionAccel: number;
  tireGrip: number;
  tireSurfaceGrip: Partial<Record<SurfaceId, number>>;
  tireWetGripFactor: number;
  /** Curvature (1 / turn radius) that full lock asks for at walking pace. */
  maxSteerCurvature: number;
  /** Lateral acceleration, as a multiple of dry-asphalt grip, that full lock asks for at speed. */
  steerGripDemand: number;
  yawResponseTime: number;
  /** Self-aligning yaw per second per radian of slip. */
  yawAlign: number;
  slipStiffness: number;
  slipRecovery: number;
  reverseSpeed: number;
  /** Two collision circles on the body axis, front and rear. */
  colliderOffset: number;
  colliderRadius: number;

  // --- Milestone B: everything below comes from the blueprint and published conditions ---
  wheelCount: number;
  /** Multiplier on grip, per surface, that applies only in dry weather. */
  tireDryGrip: Partial<Record<SurfaceId, number>>;
  /** Multiplier on grip, per surface, that applies only in wet weather. */
  tireWetSurfaceGrip: Partial<Record<SurfaceId, number>>;
  /** Peak lateral grip multiplier from chassis, stability and load. */
  peakGripFactor: number;
  /** Extra lateral grip fraction at full steering lock. */
  corneringGrip: number;
  /** Multiplier on grip lost on the shoulder. 1 is the standard penalty, 0 none. */
  shoulderPenalty: number;
  /** Multiplier on top-end speed on paved surfaces. */
  roadSpeedFactor: number;
  looseRollingFactor: number;
  looseTractionFactor: number;
  rollingAdd: Partial<Record<SurfaceId, number>>;
  rollingFactor: Partial<Record<SurfaceId, number>>;
  /** Multiplier on speed lost and bounce taken from walls and obstacles. */
  obstacleImpulse: number;
  wearStartSeconds: number;
  wearRampSeconds: number;
  wornGrip: number;
  engine: {
    spoolUpSeconds: number;
    spoolDownSeconds: number;
    spoolFloor: number;
    spoolTopEndFactor: number;
    cyclePeriodSeconds: number;
    cycleLowFactor: number;
    pulseBurnSeconds: number;
    pulseRefillSeconds: number;
    pulseRestFactor: number;
    burstRechargeSeconds: number;
    burstSeconds: number;
    burstFactor: number;
  };
  heat: {
    /** Engine heat per second at sustained full throttle and rated output. */
    enginePerSecond: number;
    idleFraction: number;
    partialLoadFactor: number;
    /** Heat per second produced regardless of throttle (generators). */
    constantPerSecond: number;
    /** Unpowered cooling capacity before weather and airflow. */
    cooling: number;
    /** Heat at which engine output starts to fall for this car. */
    performanceThreshold: number;
  };
  power: {
    /** Units per second generated at all times under the published conditions. */
    generation: number;
    /** Extra generation while off the throttle. */
    offThrottleGeneration: number;
    capacity: number;
    /** Electric drivetrain draw at full throttle. Served before everything else. */
    drivetrainDraw: number;
    /** Optional consumers in the order they are served. */
    consumers: Array<{ draw: number; priority: number; effect: PoweredEffect }>;
  };
  /** Stability before clamping and before powered stabilisers, which the step adds as supplied. */
  stability: number;
  stabilityThreshold: number;
};

/** Published conditions a build is evaluated under (Sections 5.5 and 6.2). */
export type BuildConditions = {
  weather: WeatherId;
  timeOfDay: 'day' | 'dusk' | 'night';
  /** Share of the lap on each surface. Missing means all asphalt. */
  surfaceMix?: Partial<Record<SurfaceId, number>>;
};

export type RaceEnvironment = {
  weather: WeatherId;
  wetness: number;
};

/**
 * What damage, status effects and active equipment do to a car's driving this step
 * (Section 11.8 step 4). The combat layer rewrites these numbers every tick from component
 * health and active statuses; the integrator only reads them. Every field has a neutral value
 * with which the integrator produces bit-identical results to a car without effects, and the
 * whole record travels in the snapshot so a predicting client replays with the same numbers.
 */
export type VehicleEffects = {
  /** Multiplier on engine output: engine damage, limp-home, boosts, the wheel-swap penalty. */
  drive: number;
  /** Forward speed, world px/s, the car is being held down to. Infinity when not slowed. */
  speedCap: number;
  /** Multiplier on grip: oil, frost and damaged wheels. */
  grip: number;
  /** Added to the commanded steering: a damaged wheel pulls the car toward its side. */
  steerBias: number;
  /** Multiplier on the commanded steering: damaged steering has less lock. */
  steerScale: number;
  /** Seconds added to the steering filter: damaged steering answers late. */
  steerLag: number;
  /** Extra rolling resistance, px/s2: dragging a broken wheel. */
  rollingAdd: number;
  /** Multiplier on engine heat: a damaged engine runs hot. */
  heatFactor: number;
  /** Ceiling on the supply of optional electrical consumers: 0 while an EMP has them down. */
  auxLimit: number;
  /** Ceiling on the supply of an electric drivetrain. Never below the protected minimum. */
  driveSupplyLimit: number;
  /** Added to the stability score: negative with damaged wheels. */
  stabilityAdd: number;
  /** True while the car is off the ground: no tire forces, no steering, low obstacles pass under. */
  airborne: boolean;
  /**
   * The tow (`TOW` in balance.ts): the share of top speed this car is being given this tick,
   * the share it is moving toward, and the share it will move toward from the next decision
   * tick. Zero, zero and zero for a car that is not being towed. `advanceTow` moves them on.
   */
  tow: number;
  towTarget: number;
  towNext: number;
};

export type MatchPhase =
  | 'CREATED'
  | 'WAITING_FOR_OPPONENT'
  | 'TRACK_REVEAL'
  | 'BUILDING'
  | 'VS_REVEAL'
  | 'COUNTDOWN'
  | 'RACING'
  | 'FINISHED'
  | 'RESULTS'
  | 'REMATCH_VOTE'
  | 'CLOSED';

/**
 * The four ids the race renderer draws a car from. Derived from a blueprint; after the
 * sprite fallback of `resolveCarSprites` it may name stand-in art, never physics.
 */
export type VehicleLoadout = {
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
};
