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

// --- Construction rules (Sections 6, 8.3, 11.5, 11.7) ------------------------------------------

/** No car may carry more offensive modules than this, whatever its mounts allow. */
export const MAX_OFFENSIVE_MODULES = 6;
/** Fire buttons on the HUD: primary and secondary. */
export const MAX_MANUAL_WEAPONS = 2;
/** Spare wheels plus repair kits. */
export const MAX_REPAIR_UNITS = 3;
/** Parts and wheels must keep this much air between them, in world pixels. */
export const PART_CLEARANCE_PX = 2;
/** Keep-out box around every wheel anchor: the standard wheel well, whatever kit is fitted. */
export const WHEEL_WELL = { w: 8, h: 14 } as const;
/** Blueprint offsets snap to this grid, in world pixels. */
export const OFFSET_GRID_PX = 1;
/** Upper bounds on an untrusted blueprint payload. */
export const MAX_BLUEPRINT_PARTS = 24;
export const MAX_BLUEPRINT_NAME_LENGTH = 24;
export const MAX_BLUEPRINT_BYTES = 8192;
/** Garage undo and redo depth (Section 6.6). */
export const MAX_GARAGE_HISTORY = 20;
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

/**
 * The crawl floor on loose ground (Section 9.3: a valid return path, no instant failure off
 * the road). Rolling resistance on a loose surface (sand, dirt, mud, snow), on a shoulder or
 * off the road, and a deep-mud zone's drag on top of it, is held to at most `driveShare` of
 * the car's own full-throttle drive at its present speed while it is creeping (below
 * `fullBelow` px/s), easing back to the whole resistance by `fadeTo`. A car whose drive is
 * weaker than the ground can therefore always crawl, and a car with drive to spare is not
 * touched at all: the floor only acts where the resistance exceeds that share. Above `fadeTo`
 * the whole resistance applies as before, so the wrong tires on sand stay a real penalty.
 * docs/BALANCE_CHANGELOG.md, the loose-ground crawl floor.
 */
export const LOOSE_CREEP = {
  driveShare: 0.7,
  fullBelow: 30,
  fadeTo: 70,
};

/**
 * Deep ground: the same floor, held to a trudging pace instead of a crawl. Sand and mud are
 * whole stretches of a course, not a strip beside the road, and their resistance (42 and 55
 * px/s2) is close to the whole drive of a heavy car with a small engine, so under the crawl
 * floor alone such a car settled at 45 to 50 px/s and could not finish a desert course (Iron
 * Mule, a shipped example). Below `fullBelow` the ground takes at most `LOOSE_CREEP.driveShare`
 * of the car's own drive at that speed, easing back to the whole resistance by `fadeTo`; a car
 * with drive to spare is never touched, so this decides only how slow a weak car can be made,
 * never how fast a strong one goes. Net push is non-decreasing in drive at every speed, so a
 * stronger car is never slower on the same ground. Other surfaces and shoulders use the crawl
 * band of `LOOSE_CREEP`. docs/BALANCE_CHANGELOG.md, 0.7.1.
 */
export const DEEP_GROUND_FLOOR: Partial<Record<SurfaceId, { fullBelow: number; fadeTo: number }>> =
  {
    sand: { fullBelow: 120, fadeTo: 170 },
    mud: { fullBelow: 70, fadeTo: 110 },
  };

export const WALL_RESTITUTION = 0.18;
/** Closing speeds below this are grazes and cost nothing beyond friction. */
export const WALL_FORGIVE_SPEED = 26;
export const WALL_SCRAPE_LOSS_MIN = 0.08;
export const WALL_SCRAPE_LOSS_MAX = 0.2;
export const WALL_SCRAPE_FULL_SPEED = 190;
export const WALL_FRICTION_DECEL = 55;
export const WALL_GRACE_SECONDS = 0.35;

// --- Heat and energy (Section 6.5) ------------------------------------------------------------

/** Power units per second every chassis generates, and the energy its battery stores. */
export const BASE_GENERATION = 10;
export const BASE_BATTERY = 40;
/** Cooling rate at racing speed in clear weather with the core at its reference heat. */
export const BASE_COOLING = 8;
export const HEAT_WARNING = 70;
export const HEAT_PERFORMANCE = 90;
export const HEAT_PROTECTION = 110;
export const HEAT_RECOVERY = 75;
/** Engine output lost at and beyond the protection threshold. Never more than this. */
export const THERMAL_PENALTY_MAX = 0.35;
/**
 * Cooling grows with core heat, as it does for anything hot in moving air:
 * `shed = capacity * weather * airflow * (HEAT_SHED_BASE + heat / HEAT_SHED_SCALE)`.
 * With these values a car that produces exactly its capacity settles at 45, and one that
 * produces 1.6 times its capacity settles on the performance threshold of 90.
 */
export const HEAT_SHED_BASE = 0.4;
export const HEAT_SHED_SCALE = 75;
/** Share of cooling still available at a standstill; the rest needs airflow. */
export const AIRFLOW_STILL = 0.6;
/** Speed, world px/s, at which airflow is complete. */
export const AIRFLOW_FULL_SPEED = 170;
/** Share of full-throttle heat a combustion engine makes at idle. */
export const ENGINE_IDLE_HEAT = 0.2;
/** Throttle below which partial-load heat factors apply (Hybrid). */
export const PARTIAL_LOAD_THROTTLE = 0.7;
/** After an electrical overload the drivetrain keeps at least this share of rated output. */
export const DRIVETRAIN_MIN_SUPPLY = 0.55;

// --- Load and stability (Sections 6.2 and 6.5) -------------------------------------------------

/** Mass of the default car, the reference for mass-dependent handling terms. */
export const REFERENCE_MASS_KG = 393;
/** At the maximum safe load a car has lost this share of drive force and braking. */
export const OVERLOAD_FORCE_LOSS = 0.18;
export const OVERLOAD_BRAKE_LOSS = 0.25;
/** And makes this much more engine heat. */
export const OVERLOAD_HEAT_GAIN = 0.12;
/** Braking fades gently with total mass: factor = (reference / mass) ^ exponent, bounded. */
export const BRAKE_MASS_EXPONENT = 0.3;
export const BRAKE_MASS_MIN = 0.75;
export const BRAKE_MASS_MAX = 1.1;

export const STABILITY_MIN = 10;
export const STABILITY_MAX = 100;
/** Wheelbase and track width, world pixels, at which the geometry penalty reaches zero. */
export const STABILITY_REF_WHEELBASE = 50;
export const STABILITY_REF_TRACK = 46;
export const STABILITY_WHEELBASE_WEIGHT = 30;
export const STABILITY_TRACK_WEIGHT = 40;
/** Points lost per unit of lateral centre-of-mass offset, as a share of half the track. */
export const STABILITY_LATERAL_WEIGHT = 110;
export const STABILITY_LATERAL_MAX = 40;
/** Fore-aft imbalance beyond this share of half the wheelbase starts to cost points. */
export const STABILITY_LONGITUDINAL_FREE = 0.3;
export const STABILITY_LONGITUDINAL_WEIGHT = 50;
export const STABILITY_LONGITUDINAL_MAX = 22;
/** Points lost per unit of mass-weighted attachment height. */
export const STABILITY_HEIGHT_WEIGHT = 60;
export const STABILITY_HEIGHT_MAX = 30;
/** Points gained per unit of tire grip above the street baseline. */
export const STABILITY_TIRE_WEIGHT = 15;
/** Points gained per unit of yaw response given up (slow-steering frames are calmer). */
export const STABILITY_YAW_WEIGHT = 20;
/** Fully below its threshold a car loses these shares of grip, slide grip and self-aligning. */
export const UNSTABLE_GRIP_LOSS = 0.3;
export const UNSTABLE_RECOVERY_LOSS = 0.25;
export const UNSTABLE_ALIGN_LOSS = 0.35;
/** Speed at which downforce is quoted, world px/s. */
export const DOWNFORCE_REF_SPEED = 250;
/** Paved surfaces, where road speed limits and bonuses apply. */
export const ROAD_SURFACES: readonly SurfaceId[] = ['asphalt', 'cobble', 'metal'];
export const LOOSE_SURFACES: readonly SurfaceId[] = ['sand', 'dirt', 'mud', 'snow'];
/** Weather in which a solar panel sees the sun: output share by weather. */
export const SOLAR_WEATHER: Record<WeatherId, number> = {
  clear: 1,
  rain: 0.3,
  heavy_rain: 0.15,
  sandstorm: 0.25,
  dry_heat: 1,
  snowfall: 0.3,
  clear_frost: 1,
};
export const SOLAR_TIME: Record<'day' | 'dusk' | 'night', number> = {
  day: 1,
  dusk: 0.45,
  night: 0.1,
};

// --- Checkpoints and race rules ---------------------------------------------------------------

export const WRONG_WAY_SECONDS = 1.2;
export const SPAWN_RAM_GRACE_SECONDS = 1.5;
/** Share of the ram impulse and ram damage that applies during the spawn grace (Section 3.4). */
export const SPAWN_RAM_GRACE_FACTOR = 0.3;
/** A KO needs zero chassis and two disabled core systems for this long, continuously. */
export const KO_SECONDS = 3;
/** Floor on the speed a time gap is measured against, so a stopped car is not "hours" ahead. */
export const GAP_SPEED_FLOOR = 80;

// --- Track format 2: wind, hazards, checkpoints and corner signs (docs/TRACK_API.md) -----------

/**
 * Wind (Section 9.2: "mainly affects exposed bodies and airborne projectiles"). On a car, the
 * wind vector times `bodyGain` times the local exposure is an acceleration in px/s2: in full
 * across the car, `alongShare` of it along the car (a head or tail wind is felt less than a
 * side gust, and a top speed that changed with the wind would read as a bug). Light cars feel
 * more of it: scaled by the square root of the reference mass over the car's mass, clamped.
 * A projectile carries `projectileGain` of the wind as drift from the moment it is launched.
 * With the crosswind preset's 70 px/s, a reference car in a fully exposed zone feels 35 px/s2
 * across it (about a seventh of what its tires hold on sand) and a bullet at its full 220 px of
 * reach drifts about 10 px.
 */
export const WIND = {
  bodyGain: 0.5,
  alongShare: 0.25,
  massExponent: 0.5,
  massFactorMin: 0.7,
  massFactorMax: 1.35,
  projectileGain: 0.35,
} as const;

/** Track hazards: what a tram gate, steam, oil and magnets do. Per-hazard numbers are data. */
export const TRACK_HAZARD = {
  /** Size of a zone grid cell, world px: surfaces and area hazards are baked at this pitch. */
  zoneCell: 8,
  /** Half thickness of a closed crossing barrier is its own; cars are pushed out of it. */
  crossingMinThickness: 10,
} as const;

/** Every shortcut carries at least this many checkpoint gates of its own (open tracks). */
export const SHORTCUT_MIN_GATES = 2;
/** On walled tracks one gate suffices: there is no way onto a shortcut but its mouth. */
export const SHORTCUT_MIN_GATES_WALLED = 1;
/** On an open track a gate reaches this far past the shoulder, unless it meets other road. */
export const OPEN_GATE_REACH = 200;

/**
 * Corner signs (Section 9.3): placed so they are passed 0.8 to 1.2 s before the bend at normal
 * speed. Normal speed is a reference profile of the default car: top speed, cornering at
 * `cornerConfidence` of the clear-weather limit, braking and acceleration as below. A bend is
 * sharp when the profile has to slow below `sharpShare` of top speed for it.
 */
export const CORNER_SIGNS = {
  topSpeed: 262,
  cornerConfidence: 0.86,
  brakeConfidence: 0.7,
  accel: 120,
  /**
   * How fast a car that runs onto a slower surface loses the excess, as a share of that
   * surface's rolling resistance (the engine still pulls, the tires slip).
   */
  fadeShare: 0.2,
  sharpShare: 0.8,
  /** A bend is a run of curvature tighter than this radius, px, turning at least this far. */
  bendRadius: 260,
  minTurnDeg: 30,
  leadSeconds: 1.0,
  leadMin: 0.8,
  leadMax: 1.2,
  /**
   * The default car's top speed on each surface as a share of `topSpeed` (measured flat out on
   * the proving ground: 270, 257, 153, 234, 84, 212, 272 and 270 px/s).
   */
  surfaceTop: {
    asphalt: 1,
    cobble: 0.95,
    sand: 0.57,
    dirt: 0.87,
    mud: 0.31,
    snow: 0.79,
    ice: 1,
    metal: 1,
  } as Record<SurfaceId, number>,
} as const;

// --- Tow: the long-range catch-up (product-owner decision, docs/DECISIONS.md 189 to 198) ---------

/**
 * Every number of the tow, and the only place they are written. A car that trails the racing
 * car ahead of it by more than `thresholdGap` seconds runs with a higher top speed; nothing
 * else about it changes and nothing about the car ahead changes at all.
 *
 * The time gap is the distance between the two cars along the course divided by the trailing
 * car's own recent average speed. The bonus is zero at and below `thresholdGap`, grows in a
 * straight line with the gap and is whole at `fullGap`. It is decided on a slow clock and
 * announced one period ahead, so a predicting client replays it exactly (see `advanceTow`).
 *
 * Where the threshold comes from: the eleven shipped builds race Neon Cut at 247 px/s on
 * average, 216 to 282 (course length over race time, alone, sparring driver, weapons off;
 * `tests/unit/tow.test.ts` measures it), so one second of gap is about 250 px of road. That is just outside the 220 px that eight of
 * the twenty weapons reach, both bullet guns among them, and inside the Arc Mortar's 320 and the
 * Needle Railgun's 350: the edge of the fight. Below it the bonus is exactly zero, so closing
 * the last second and passing are the cars' own business.
 *
 * How the rest was chosen, and every setting that was tried, is docs/evidence/balance/tow-study.md.
 */
export type TowTuning = {
  /** Time gap, seconds, at and below which the bonus is exactly zero: the edge of fighting range. */
  thresholdGap: number;
  /** An idle tow starts only once the gap has grown to this, so it cannot flicker at the edge. */
  engageGap: number;
  /** Time gap at which the bonus is whole. */
  fullGap: number;
  /** The whole bonus, as a share of top speed: 0.07 is seven percent. */
  maxBonus: number;
  /** How fast the bonus may rise and fall, as shares of the whole bonus per second. */
  rampUpPerSecond: number;
  rampDownPerSecond: number;
  /** No tow is decided before the race is this old, seconds. */
  startDelaySeconds: number;
  /** The bonus is decided this often, and each decision takes effect one period later. */
  updateSeconds: number;
  /** Time constant of the trailing car's average speed, seconds, and the least speed it counts as. */
  speedAverageSeconds: number;
  speedFloor: number;
  /**
   * The bonus acts on speed only: nothing below `fadeStartSpeed` (px/s), all of it from
   * `fadeFullSpeed`. A launch, a hairpin and the drive out of one are untouched.
   */
  fadeStartSpeed: number;
  fadeFullSpeed: number;
  /** Least time between two `catchup` events of one car, seconds. */
  eventMinSeconds: number;
};

/**
 * Not frozen on purpose: the tow study (tests/balance/tow.ts) tries other values by writing
 * them here for the length of a run and putting these back. Nothing in the game writes to it.
 */
export const TOW: TowTuning = {
  thresholdGap: 1.0,
  engageGap: 1.15,
  fullGap: 2.5,
  maxBonus: 0.08,
  rampUpPerSecond: 0.5,
  rampDownPerSecond: 1,
  startDelaySeconds: 5,
  updateSeconds: 0.5,
  speedAverageSeconds: 3,
  speedFloor: 120,
  fadeStartSpeed: 140,
  fadeFullSpeed: 200,
  eventMinSeconds: 3,
};

// --- Combat: damage and components (Sections 8.1, 10.1) -----------------------------------------
//
// Numbers that belong to one part live in that part's catalog `params`. What follows are the
// rules every part shares.

/** Integrity every component starts with before `ModifyIntegrity` (Section 10.1). */
export const COMPONENT_INTEGRITY = 100;
/** Section 8.1 states: healthy above, damaged down to critical, critical down to 1, disabled at 0. */
export const COMPONENT_HEALTHY = 65;
export const COMPONENT_CRITICAL = 20;
/**
 * Chassis damage as a share of the nominal (component) damage of a hit. Section 8.4 pairs 8 to
 * 18 component points with 2 to 8 chassis points, and 20 to 30 with 8 to 12.
 */
export const CHASSIS_DAMAGE_SHARE = 0.4;
/** Extra chassis share when the hit lands on bare bodywork with no component within reach. */
export const BODY_HIT_SHARE = 0.3;
/** A hit damages the nearest component within this many pixels of where it landed. */
export const HIT_LOCAL_RADIUS = 15;
/** Share of a penetrating hit, per unit of penetration, that reaches the next module along. */
export const PENETRATION_SECOND_SHARE = 1;
/** A fresh plate absorbs everything it is asked to; a spent one lets this share through anyway. */
export const ARMOR_MIN_ABSORB = 0.5;
/** A disabled wheel still rolls at this efficiency (Section 8.1). */
export const WHEEL_LIMP_EFFICIENCY = 0.35;
/** Grip lost per unit of mean wheel efficiency lost. */
export const WHEEL_GRIP_WEIGHT = 0.8;
/** Steering pull toward a damaged side, as steering input, at most (Section 8.1: 12 percent). */
export const WHEEL_PULL_MAX = 0.12;
/** Rolling resistance added, px/s2, per unit of mean wheel efficiency lost. */
export const WHEEL_DRAG_DECEL = 60;
/** Stability points lost per unit of mean wheel efficiency lost (Section 6.5 damagePenalty). */
export const WHEEL_STABILITY_PENALTY = 25;
/** A disabled engine keeps this share of its output: limp-home (Section 8.1). */
export const ENGINE_LIMP_OUTPUT = 0.5;
/** A disabled engine makes this much more heat for the output it still has. */
export const ENGINE_DAMAGE_HEAT = 0.3;
/** Disabled steering keeps this share of its lock and answers this many seconds late. */
export const STEERING_LIMP_SCALE = 0.5;
export const STEERING_DAMAGE_LAG = 0.08;
/** With the chassis at zero the car limps: this share of engine output remains (Section 3.4). */
export const LIMP_DRIVE_FACTOR = 0.6;

// --- Combat: ramming (Sections 3.4, 10.1) ------------------------------------------------------

/** Bounce between two cars. */
export const CAR_RESTITUTION = 0.25;
/** Closing speeds below this are rubbing, and do no damage (the forgiveness band). */
export const RAM_FORGIVE_SPEED = 45;
/** Damage per px/s of closing speed above the band, before mass share, angle and armor. */
export const RAM_DAMAGE_PER_SPEED = 0.085;
export const RAM_DAMAGE_MAX = 24;
/** Seconds before the same pair of cars can deal ram damage again. */
export const RAM_DAMAGE_COOLDOWN_SECONDS = 0.5;
/** How strongly an off-centre push turns the car, radians per px/s of sideways push at the end. */
export const RAM_YAW_KICK = 0.004;

// --- Combat: statuses (Sections 8.1, 8.4, 11.8) ------------------------------------------------

/** How fast a slow sheds speed above its cap, px/s2. */
export const SLOW_ONSET_DECEL = 300;
/** Total temporary speed suppression from debuffs never exceeds this (Section 8.1). */
export const SLOW_TOTAL_CAP = 0.45;
/** Total temporary grip loss from debuffs never exceeds this: there is always steering. */
export const GRIP_LOSS_CAP = 0.6;
/** Burn damage lands in pulses this far apart, so a fire is a few readable hits, not sixty. */
export const BURN_PULSE_SECONDS = 1 / 3;
/** Immunity to another forced steering or hard disable after one lands (Section 8.1). */
export const CC_IMMUNITY_SECONDS = 2;
/** A weapon impulse at or above this, px/s, counts as a major forced steering effect. */
export const MAJOR_IMPULSE = 90;
/** Mass a weapon impulse is quoted for. Lighter cars are thrown further, within these bounds. */
export const IMPULSE_MASS_MIN = 0.6;
export const IMPULSE_MASS_MAX = 1.5;

// --- Combat: weapons (Sections 8.3, 8.4, 11.5) -------------------------------------------------

/** No fire command comes back faster than this, whatever the catalog says (Section 8.4). */
export const WEAPON_COOLDOWN_FLOOR_SECONDS = 1.2;
/** Reload is this much longer at the thermal protection threshold, growing from the performance threshold. */
export const WEAPON_HEAT_RELOAD_PENALTY = 0.5;
/** Reload is this much longer for a weapon at zero integrity's edge, growing below healthy. */
export const WEAPON_DAMAGE_RELOAD_PENALTY = 0.6;
/** Chance of a harmless misfire per shot for a weapon about to fail, growing below healthy. */
export const WEAPON_MISFIRE_CHANCE = 0.25;
/** A misfire costs this long before the weapon can be tried again. */
export const WEAPON_MISFIRE_SECONDS = 0.6;
/** Projectiles live at most this long unless their part says otherwise (Section 8.3). */
export const PROJECTILE_MAX_LIFE_SECONDS = 5;
/** Simultaneous projectiles and ground hazards a race keeps. The oldest gives way. */
export const MAX_PROJECTILES = 64;
export const MAX_HAZARDS = 48;
/** Spacing of the wall probes along a projectile's path and a line of sight, px. */
export const SWEEP_STEP = 9;
/** Line of sight is rechecked this often for weapons that track a target, in ticks. */
export const LOS_INTERVAL_TICKS = 3;
/** An enemy trap is hidden until a car is this close; a Mine Detector adds its own distance. */
export const HAZARD_REVEAL_RANGE = 90;
/** The rival is tracked on the HUD within this range; Radar multiplies it. */
export const RIVAL_TRACK_RANGE = 600;
/** Seconds between repair actions on one car (Section 8.2: cannot be spammed). */
export const REPAIR_LOCKOUT_SECONDS = 2;
/** A refused fire command is reported to its driver at most this often, in seconds. */
export const REFUSAL_REPORT_SECONDS = 0.5;

/**
 * Weather acts on what lies on the road (Section 6.5: weather multiplies selected effect
 * durations). Rain washes oil and foam away and puts fires out sooner; cold keeps frost; dry
 * heat melts it. Multipliers on a hazard's lifetime.
 */
export const HAZARD_LIFE_WEATHER: Record<
  'oil' | 'fire' | 'frost' | 'foam',
  Record<WeatherId, number>
> = {
  oil: {
    clear: 1,
    rain: 0.6,
    heavy_rain: 0.45,
    sandstorm: 0.8,
    dry_heat: 1,
    snowfall: 0.8,
    clear_frost: 1,
  },
  fire: {
    clear: 1,
    rain: 0.5,
    heavy_rain: 0.35,
    sandstorm: 0.8,
    dry_heat: 1.25,
    snowfall: 0.6,
    clear_frost: 0.9,
  },
  frost: {
    clear: 1,
    rain: 1.3,
    heavy_rain: 1.3,
    sandstorm: 0.8,
    dry_heat: 0.6,
    snowfall: 1.5,
    clear_frost: 1.5,
  },
  foam: {
    clear: 1,
    rain: 0.8,
    heavy_rain: 0.65,
    sandstorm: 0.9,
    dry_heat: 1.1,
    snowfall: 1,
    clear_frost: 1,
  },
};

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

/**
 * 7: the loose-ground crawl floor changed the physics a client predicts, and the join may name
 * the AI's difficulty (Milestone D). 8: the deep-ground floor on sand and mud
 * (`DEEP_GROUND_FLOOR`) changed it again. 9: Milestone E. Rooms advance on their own 30 Hz
 * clock and acknowledge per driver (`TickInputBuffer`); input packets carry their race; the
 * room state gained `you`, `raceId`, `held` and the input statistics; results may be forfeits;
 * the match room exists.
 */
export const PROTOCOL_VERSION = 9;
export const MAX_QUEUED_INPUTS = 8;
export const MAX_INPUTS_PER_PACKET = 6;
export const REMOTE_INTERP_DELAY_MS = 120;
