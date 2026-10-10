import type { SurfaceId, WeatherId } from './types.js';

/**
 * Low-level tuning constants. Section 11.8 requires that these live in one documented file
 * and are covered by tests. Distances are world pixels, time is seconds.
 */

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
export const SNAPSHOT_HZ = 15;
export const INPUT_PACKET_HZ = 20;

/** Race budget and limits from the product invariants. */
export const STARTING_CREDITS = 1000;
export const BUILD_SECONDS = 60;
export const RACE_LIMIT_SECONDS = 180;
export const FINISH_WINDOW_SECONDS = 8;
export const COUNTDOWN_SECONDS = 3;

/**
 * Speed on the HUD. World distances are abstract, so the conversion is chosen for readable
 * top-down play: a full screen of look-ahead should take roughly a second at top speed.
 */
export const MPH_PER_WORLD_SPEED = 0.3125;
export const KMH_PER_MPH = 1.609344;
/** One "metre" for distance callouts such as the rival gap. */
export const WORLD_PIXELS_PER_METER = 8;

/** Section 9.2 road surface grip before tire specialization. */
export const SURFACE_GRIP: Record<WeatherId, Record<SurfaceId, number>> = {
  clear: { asphalt: 1.0, cobble: 0.87, sand: 0.61, dirt: 0.82, mud: 0.52, snow: 0.48, ice: 0.29, metal: 0.97 },
  rain: { asphalt: 0.73, cobble: 0.61, sand: 0.58, dirt: 0.65, mud: 0.4, snow: 0.43, ice: 0.25, metal: 0.72 },
  heavy_rain: { asphalt: 0.63, cobble: 0.52, sand: 0.54, dirt: 0.56, mud: 0.34, snow: 0.4, ice: 0.23, metal: 0.65 },
  sandstorm: { asphalt: 0.91, cobble: 0.85, sand: 0.55, dirt: 0.71, mud: 0.47, snow: 0.46, ice: 0.28, metal: 0.89 },
  dry_heat: { asphalt: 1.0, cobble: 0.88, sand: 0.57, dirt: 0.8, mud: 0.5, snow: 0.5, ice: 0.31, metal: 0.98 },
  snowfall: { asphalt: 0.66, cobble: 0.55, sand: 0.58, dirt: 0.61, mud: 0.37, snow: 0.42, ice: 0.24, metal: 0.65 },
  clear_frost: { asphalt: 0.75, cobble: 0.65, sand: 0.6, dirt: 0.69, mud: 0.4, snow: 0.52, ice: 0.28, metal: 0.77 },
};

export const COOLING_MULTIPLIER: Record<WeatherId, number> = {
  clear: 1.0,
  rain: 1.18,
  heavy_rain: 1.25,
  sandstorm: 0.94,
  dry_heat: 0.78,
  snowfall: 1.15,
  clear_frost: 1.08,
};

export const WET_WEATHER: Record<WeatherId, boolean> = {
  clear: false,
  rain: true,
  heavy_rain: true,
  sandstorm: false,
  dry_heat: false,
  snowfall: true,
  clear_frost: false,
};

/** Rolling resistance as a deceleration in world pixels per second squared. */
export const SURFACE_ROLLING_DECEL: Record<SurfaceId, number> = {
  asphalt: 4,
  cobble: 9,
  sand: 42,
  dirt: 18,
  mud: 55,
  snow: 26,
  ice: 3,
  metal: 4,
};

/** Tire specialization can never push combined grip beyond this, per Section 9.2. */
export const MAX_COMBINED_GRIP = 1.45;

// --- Vehicle handling -------------------------------------------------------------------------

/**
 * One force index point of engine output, in force units. Tuned with DRAG_* so the default
 * Beetle reaches 60 MPH in about four seconds and tops out near 88 MPH on dry asphalt.
 */
export const FORCE_PER_INDEX = 205;
export const DRAG_LINEAR = 9;
export const DRAG_QUADRATIC = 0.125;
/** Speed band, as a fraction of nominal top speed, over which rated force tapers out. */
export const FORCE_TAPER_START = 0.62;
export const FORCE_ZERO_FACTOR = 1.55;
export const NOMINAL_TOP_SPEED = 282;
export const LAUNCH_FADE_SPEED = 70;

export const BRAKE_DECEL = 220;
export const LATERAL_GRIP_ACCEL = 400;
export const TRACTION_ACCEL = 190;

export const STEER_ENGAGE_TIME = 0.1;
export const STEER_RELEASE_TIME = 0.18;
export const MAX_STEER_CURVATURE = 1 / 46;
export const STEER_HALF_SPEED = 215;
export const YAW_RESPONSE_TIME = 0.055;
export const SLIP_STIFFNESS = 9;
/** Sliding tires hold slightly less than gripping ones, which is what sustains a drift. */
export const KINETIC_GRIP_FACTOR = 0.82;
/** How far past the grip limit the steering assist lets a driver push before it caps yaw. */
export const STEER_OVERDRIVE = 1.22;
/** Throttle fades between these slip ratios so power cannot feed a spin. */
export const THROTTLE_ASSIST_SLIP_START = 0.35;
export const THROTTLE_ASSIST_SLIP_FULL = 0.9;
export const THROTTLE_ASSIST_MIN = 0.45;

/** Joystick pull beyond this fraction starts releasing the throttle (Section 7.1). */
export const BRAKE_LIFT_THRESHOLD = 0.18;
export const REVERSE_HOLD_SECONDS = 0.35;
export const REVERSE_SPEED = 78;
export const REVERSE_ACCEL = 150;
/** Gentle throttle when nobody is touching the screen. */
export const IDLE_THROTTLE = 0.55;

export const SHOULDER_ROLLING_DECEL = 34;
export const SHOULDER_GRIP_FACTOR = 0.88;

export const WALL_RESTITUTION = 0.18;
/** Closing speeds below this are grazes and cost nothing beyond friction. */
export const WALL_FORGIVE_SPEED = 26;
export const WALL_SCRAPE_LOSS_MIN = 0.08;
export const WALL_SCRAPE_LOSS_MAX = 0.2;
export const WALL_SCRAPE_FULL_SPEED = 190;
export const WALL_FRICTION_DECEL = 55;
export const WALL_GRACE_SECONDS = 0.35;

// --- Checkpoints and race rules ---------------------------------------------------------------

export const WRONG_WAY_SECONDS = 1.2;
export const SPAWN_RAM_GRACE_SECONDS = 1.5;

// --- Input ------------------------------------------------------------------------------------

export const JOYSTICK_RADIUS_PX = 42;
export const JOYSTICK_DEAD_ZONE = 0.12;
export const JOYSTICK_CURVE = 1.25;

// --- Network ----------------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;
export const MAX_QUEUED_INPUTS = 8;
export const MAX_INPUTS_PER_PACKET = 6;
export const REMOTE_INTERP_DELAY_MS = 120;
