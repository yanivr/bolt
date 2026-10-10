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
export type TriggerMode = 'manual' | 'automatic' | 'hybrid' | 'passive';

export type PartDefinition = {
  id: string;
  displayName: string;
  category: PartCategory;
  price: number;
  massKg: number;
  footprint: { w: number; h: number };
  compatibleMounts: string[];
  spriteKey: string;
  soundKey: string;
  description: string;
  drawback: string;
  modifiers: Record<string, number>;
  behaviorId?: string;
  triggerMode?: TriggerMode;
  params?: Record<string, number | string | boolean>;
  maxPerCar?: number;
};

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

/**
 * Chassis-local coordinates: origin at the body centre, front is negative Y, right is
 * positive X, units are world pixels.
 */
export type MountPoint = {
  id: string;
  categories: MountCategory[];
  x: number;
  y: number;
  /** Half-extent of the bounded installation region around the hardpoint. */
  regionHalfW: number;
  regionHalfH: number;
  /** Largest part footprint this mount accepts. */
  maxFootprint: { w: number; h: number };
  allowedQuarterTurns: Array<0 | 1 | 2 | 3>;
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
};

export type EngineDefinition = PartDefinition & {
  category: 'engine';
  /** Relative wheel force. The Four-Cylinder is 100. */
  forceIndex: number;
  heatPerSecond: number;
  /** Continuous electrical draw in power units per second. */
  powerDraw: number;
  /** Extra low-speed pull, as a fraction of rated force, that fades with speed. */
  launchBoost: number;
  /** Multiplier on the speed at which force starts to taper. */
  topEndFactor: number;
};

export type TireDefinition = PartDefinition & {
  category: 'tires';
  /** Clear-weather asphalt grip multiplier. */
  grip: number;
  /** Extra multiplier per surface. Missing entries are 1. */
  surfaceGrip: Partial<Record<SurfaceId, number>>;
  /** Multiplier applied to grip whenever the weather preset is wet. */
  wetGripFactor: number;
  slipRecoveryFactor: number;
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
  fireSlot?: 0 | 1;
  activateUtility?: string;
  selectRepairTarget?: string;
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
  /** Curvature (1 / turn radius) at full lock and walking pace. */
  maxSteerCurvature: number;
  /** Speed at which steering authority has dropped to half. */
  steerHalfSpeed: number;
  yawResponseTime: number;
  slipStiffness: number;
  slipRecovery: number;
  reverseSpeed: number;
  /** Two collision circles on the body axis, front and rear. */
  colliderOffset: number;
  colliderRadius: number;
};

export type RaceEnvironment = {
  weather: WeatherId;
  wetness: number;
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

/** Minimal blueprint used through Milestone A. Parts, mounts and paint arrive in Milestone B. */
export type VehicleLoadout = {
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
};
