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
  clear: {
    asphalt: 1.0,
    cobble: 0.87,
    sand: 0.61,
    dirt: 0.82,
    mud: 0.52,
    snow: 0.48,
    ice: 0.29,
    metal: 0.97,
  },
  rain: {
    asphalt: 0.73,
    cobble: 0.61,
    sand: 0.58,
    dirt: 0.65,
    mud: 0.4,
    snow: 0.43,
    ice: 0.25,
    metal: 0.72,
  },
  heavy_rain: {
    asphalt: 0.63,
    cobble: 0.52,
    sand: 0.54,
    dirt: 0.56,
    mud: 0.34,
    snow: 0.4,
    ice: 0.23,
    metal: 0.65,
  },
  sandstorm: {
    asphalt: 0.91,
    cobble: 0.85,
    sand: 0.55,
    dirt: 0.71,
    mud: 0.47,
    snow: 0.46,
    ice: 0.28,
    metal: 0.89,
  },
  dry_heat: {
    asphalt: 1.0,
    cobble: 0.88,
    sand: 0.57,
    dirt: 0.8,
    mud: 0.5,
    snow: 0.5,
    ice: 0.31,
    metal: 0.98,
  },
  snowfall: {
    asphalt: 0.66,
    cobble: 0.55,
    sand: 0.58,
    dirt: 0.61,
    mud: 0.37,
    snow: 0.42,
    ice: 0.24,
    metal: 0.65,
  },
  clear_frost: {
    asphalt: 0.75,
    cobble: 0.65,
    sand: 0.6,
    dirt: 0.69,
    mud: 0.4,
    snow: 0.52,
    ice: 0.28,
    metal: 0.77,
  },
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

/**
 * Steering filter. The commanded stick reaches the wheels over about a tenth of a second and
 * recentres a little more slowly (Section 7.1: 80 to 140 ms in, about 180 ms out).
 */
export const STEER_ENGAGE_TIME = 0.1;
export const STEER_RELEASE_TIME = 0.16;
/**
 * Tightest turn, as curvature, that full lock asks for at low speed. The tires and the
 * self-aligning term below take about a fifth of it back, so the circle actually driven at
 * parking speed is close to 66 world pixels: a little over one car length, and what the
 * drawn front-wheel angle implies for this wheelbase.
 */
export const MAX_STEER_CURVATURE = 1 / 52;
/**
 * At speed, full lock asks for this multiple of the lateral acceleration the tires can give on
 * dry asphalt, so the stick maps to cornering force rather than to an angle. A value a little
 * above one leaves a stable drift angle at the very end of the stick's travel.
 */
export const STEER_GRIP_DEMAND = 1.3;
/**
 * How strongly the steering demand follows the grip of the surface under the car, as an
 * exponent: 1 would make every surface feel the same with less turning, 0 would ask ice for
 * the same cornering as asphalt. In between, slippery surfaces slide progressively more.
 */
export const STEER_GRIP_SENSE = 0.6;
/** Sharpness of the hand-over from the low-speed turning circle to the grip-limited regime. */
export const STEER_BLEND_SHARPNESS = 3;
export const YAW_RESPONSE_TIME = 0.06;
export const SLIP_STIFFNESS = 9;
/**
 * Self-aligning yaw, per second: the nose is pulled toward the direction of travel in
 * proportion to the slip angle. This is what makes a slide settle at an angle instead of
 * winding up into a spin, and what straightens the car after a knock.
 */
export const YAW_ALIGN_GAIN = 2.5;
/**
 * Tire curve. Lateral force rises with slip, rounds off smoothly into its peak and then falls
 * gently to this share of the peak when the tire is fully sliding. There is no step anywhere.
 */
export const KINETIC_GRIP_FACTOR = 0.86;
export const TIRE_KNEE_SHARPNESS = 4;
export const TIRE_FADE_START = 1.4;
export const TIRE_FADE_END = 3.2;
/**
 * Slip angles, in radians, between which cornering starts to cost speed. Below the first the
 * car corners freely; above the second the tires' full sideways drag comes off its speed.
 */
export const FREE_ROLL_SLIP = 0.2;
export const SCRUB_FULL_SLIP = 0.5;
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
/**
 * The floating stick's origin trails the thumb once the thumb is this many radii away, so a
 * change of direction never needs more than a short, known movement however far the thumb
 * has wandered.
 */
export const JOYSTICK_TRAIL_RADII = 1.5;

/**
 * Direction steering: the stick points where the car should go on screen and a heading
 * controller turns that into ordinary steering and brake samples.
 */
/** Stick deflection, as a share of the radius, at which the controller has full authority. */
export const DIRECTION_FULL_AUTHORITY = 0.45;
/** Heading error is closed at this rate per second, before steering limits. */
export const HEADING_GAIN = 6;
/** Seconds of yaw-rate lead, which is what stops the nose swinging past the target. */
export const HEADING_DAMPING = 0.12;
/** Floor on the yaw response used to scale commands, so parking-speed steering stays finite. */
export const HEADING_MIN_YAW_GAIN = 0.55;
/**
 * Corner assist: a request this far off the nose, at these speeds, eases the throttle and
 * applies up to this share of the brake.
 */
export const CORNER_ASSIST_ANGLE_START = (20 * Math.PI) / 180;
export const CORNER_ASSIST_ANGLE_FULL = (60 * Math.PI) / 180;
export const CORNER_ASSIST_SPEED_LOW = 120;
export const CORNER_ASSIST_SPEED_HIGH = 200;
export const CORNER_ASSIST_MAX = 1;
/** Pointing further than this from the nose starts to trail the brake into the turn. */
export const DIRECTION_BRAKE_START = (105 * Math.PI) / 180;
export const DIRECTION_BRAKE_FULL = (150 * Math.PI) / 180;
/** Trail braking fades out below these speeds, so a turn-around never stalls the car. */
export const DIRECTION_TURN_SPEED_LOW = 70;
export const DIRECTION_TURN_SPEED_HIGH = 150;
/** Between these angles from the nose the request becomes a full stop. */
export const DIRECTION_STOP_START = (138 * Math.PI) / 180;
export const DIRECTION_STOP_FULL = (156 * Math.PI) / 180;
/** Steering fades out between the full-stop angle and here, so a straight pull brakes straight. */
export const DIRECTION_STEER_FADE_END = (176 * Math.PI) / 180;
/** While backing up, the car keeps reversing until the stick points within this of the nose. */
export const DIRECTION_REVERSE_EXIT = (80 * Math.PI) / 180;
/** Below this speed a stick held behind the car asks for reverse outright. */
export const DIRECTION_REVERSE_SPEED = 30;

// --- Network ----------------------------------------------------------------------------------

export const PROTOCOL_VERSION = 2;
export const MAX_QUEUED_INPUTS = 8;
export const MAX_INPUTS_PER_PACKET = 6;
export const REMOTE_INTERP_DELAY_MS = 120;
