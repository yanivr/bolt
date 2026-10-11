/**
 * Engine voices as data (Section 14.3: "every engine family needs a recognizable pitch and
 * timbre envelope tied to normalized RPM; heavy V8 roars low, electric motors whine, turbines
 * spool, spring drives click, rocket engines pulse"). One recipe per catalog `soundKey`, and
 * every one of the twenty engines has its own key. `engineVoice.ts` plays them on a fixed
 * graph whose parameters are moved, never rebuilt.
 */

export type EngineOsc = {
  w: 'sq' | 'p25' | 'p12' | 'tri' | 'saw' | 'sin';
  /** Multiple of the firing frequency. */
  mult: number;
  gain: number;
};

export type EngineRecipe = {
  key: string;
  /** One line for the guide. */
  note: string;
  /** Firing frequency at idle and at the red line, hertz. */
  idleHz: number;
  redHz: number;
  /** Gears in the pitch model. 1 means engine speed simply follows road speed. */
  gears: number;
  /** Up to four tone channels. */
  oscs: readonly EngineOsc[];
  /** Lumpiness: amplitude wobble at `mult` times the firing frequency. `fade` removes it as revs rise. */
  lump?: { mult: number; depth: number; fade?: boolean };
  /** Low-pass that opens with revs and throttle. */
  filter: { base: number; rpm: number; throttle: number; q: number };
  /** Bit-crush steps on the tone channels, for grit. */
  crush?: number;
  /** Level at rest, added level per unit of throttle and of revs. Zero `idle` is an engine with no idle. */
  level: { idle: number; throttle: number; rpm: number };
  /** A second voice above the engine: turbo whistle, supercharger or motor whine. */
  whine?: {
    w: 'sin' | 'tri' | 'saw' | 'p12';
    fromHz: number;
    toHz: number;
    gain: number;
    /** What moves it: engine revs, road speed, the powertrain's spool, or revs times throttle. */
    by: 'rpm' | 'speed' | 'spool' | 'load';
    /** A second whistle this many cents off the first (twin turbos beat against each other). */
    twinCents?: number;
  };
  /** A noise channel: combustion roar, turbine hiss, diesel clatter. */
  noise?: {
    w: 'noise' | 'lfsr' | 'metal';
    rate: number;
    band: { t: 'lp' | 'bp' | 'hp'; fromHz: number; toHz: number; q: number };
    gain: { idle: number; throttle: number; rpm: number };
    /** Gate the noise at this multiple of the firing frequency (clatter, ratchet), 0 for none. */
    gate?: number;
    /** Gate at a fixed rate in hertz instead (rocket pulses). */
    gateHz?: number;
  };
  /** Play `turbo_blowoff` when the throttle is lifted with the turbo spooled. */
  blowoff?: boolean;
  /** Hybrid: below this throttle the tone channels fade out and only the whine is left. */
  electricBelow?: number;
  /** Pitch drifts by this share over the powertrain's repeating output cycle. */
  cycleWobble?: number;
  /** One-shot to play when a stored burst is released (spring launch, rocket pulse). */
  burst?: 'spring_release' | 'rocket_pulse';
};

export const ENGINE_RECIPES: readonly EngineRecipe[] = [
  {
    key: 'engine_electric_small',
    note: 'Mini Electric: a small pure whine that rises with road speed and is silent at rest.',
    idleHz: 150,
    redHz: 900,
    gears: 1,
    oscs: [
      { w: 'sin', mult: 1, gain: 0.5 },
      { w: 'tri', mult: 2, gain: 0.18 },
    ],
    filter: { base: 1200, rpm: 2600, throttle: 800, q: 0.7 },
    level: { idle: 0, throttle: 0.5, rpm: 0.5 },
    whine: { w: 'p12', fromHz: 900, toHz: 3600, gain: 0.05, by: 'speed' },
  },
  {
    key: 'engine_inline4',
    note: 'Four-Cylinder: the raspy all-rounder, a saw and a square an octave up over a sub.',
    idleHz: 60,
    redHz: 215,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.5 },
      { w: 'sq', mult: 2.01, gain: 0.36 },
      { w: 'tri', mult: 0.5, gain: 0.16 },
    ],
    filter: { base: 560, rpm: 2300, throttle: 900, q: 2.2 },
    level: { idle: 0.42, throttle: 0.58, rpm: 0.33 },
  },
  {
    key: 'engine_v6',
    note: 'V6: smoother and fuller, with a fifth above the fundamental and a light burble.',
    idleHz: 64,
    redHz: 236,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.48 },
      { w: 'saw', mult: 1.5, gain: 0.26 },
      { w: 'tri', mult: 0.5, gain: 0.24 },
      { w: 'p25', mult: 3, gain: 0.14 },
    ],
    lump: { mult: 0.5, depth: 0.14 },
    filter: { base: 600, rpm: 2500, throttle: 1000, q: 1.6 },
    level: { idle: 0.42, throttle: 0.58, rpm: 0.33 },
  },
  {
    key: 'engine_v8',
    note: 'V8: roars low. A deep uneven burble at idle that hardens into a bellow.',
    idleHz: 44,
    redHz: 168,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.55 },
      { w: 'sq', mult: 0.5, gain: 0.26 },
      { w: 'saw', mult: 1.5, gain: 0.3 },
      { w: 'p25', mult: 2, gain: 0.16 },
    ],
    lump: { mult: 0.5, depth: 0.5 },
    filter: { base: 460, rpm: 1800, throttle: 900, q: 2.6 },
    crush: 24,
    level: { idle: 0.5, throttle: 0.6, rpm: 0.3 },
  },
  {
    key: 'engine_v12',
    note: 'V12: a high, smooth, ripping howl with dense harmonics and no lumpiness at all.',
    idleHz: 84,
    redHz: 340,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.42 },
      { w: 'saw', mult: 2, gain: 0.3 },
      { w: 'p25', mult: 3, gain: 0.16 },
      { w: 'saw', mult: 1.003, gain: 0.3 },
    ],
    filter: { base: 600, rpm: 2800, throttle: 1200, q: 1.2 },
    level: { idle: 0.36, throttle: 0.56, rpm: 0.4 },
  },
  {
    key: 'engine_turbo_small',
    note: 'Small Turbo: a busy four with a whistle that climbs as the turbo spools and a blow-off on lift.',
    idleHz: 64,
    redHz: 230,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.46 },
      { w: 'sq', mult: 2.01, gain: 0.3 },
      { w: 'tri', mult: 0.5, gain: 0.22 },
    ],
    filter: { base: 600, rpm: 2400, throttle: 900, q: 2.4 },
    level: { idle: 0.4, throttle: 0.56, rpm: 0.34 },
    whine: { w: 'sin', fromHz: 2200, toHz: 6800, gain: 0.1, by: 'spool' },
    blowoff: true,
  },
  {
    key: 'engine_turbo_twin',
    note: 'Twin Turbo: a bigger six with two whistles beating against each other, and a loud blow-off.',
    idleHz: 60,
    redHz: 224,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.5 },
      { w: 'saw', mult: 1.5, gain: 0.24 },
      { w: 'tri', mult: 0.5, gain: 0.24 },
      { w: 'sq', mult: 2, gain: 0.22 },
    ],
    lump: { mult: 0.5, depth: 0.12 },
    filter: { base: 580, rpm: 2500, throttle: 1000, q: 2 },
    level: { idle: 0.42, throttle: 0.58, rpm: 0.34 },
    whine: { w: 'sin', fromHz: 1900, toHz: 6000, gain: 0.13, by: 'spool', twinCents: 38 },
    blowoff: true,
  },
  {
    key: 'engine_supercharger',
    note: 'Supercharger: a V8 underneath and a belt-driven whine that is always there and tracks the revs.',
    idleHz: 46,
    redHz: 172,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.5 },
      { w: 'sq', mult: 0.5, gain: 0.22 },
      { w: 'saw', mult: 2, gain: 0.26 },
    ],
    lump: { mult: 0.5, depth: 0.32 },
    filter: { base: 480, rpm: 1900, throttle: 900, q: 2.2 },
    level: { idle: 0.46, throttle: 0.56, rpm: 0.3 },
    whine: { w: 'p12', fromHz: 420, toHz: 1900, gain: 0.16, by: 'rpm' },
  },
  {
    key: 'engine_diesel',
    note: 'Torque Diesel: very low and square, with a hard clatter on every firing stroke.',
    idleHz: 36,
    redHz: 122,
    gears: 3,
    oscs: [
      { w: 'sq', mult: 1, gain: 0.5 },
      { w: 'saw', mult: 2, gain: 0.34 },
      { w: 'p25', mult: 4, gain: 0.14 },
    ],
    lump: { mult: 1, depth: 0.4 },
    filter: { base: 420, rpm: 1500, throttle: 700, q: 1.4 },
    crush: 16,
    level: { idle: 0.5, throttle: 0.55, rpm: 0.25 },
    noise: {
      w: 'lfsr',
      rate: 0.6,
      band: { t: 'bp', fromHz: 1400, toHz: 2400, q: 1.2 },
      gain: { idle: 0.2, throttle: 0.16, rpm: 0.05 },
      gate: 1,
    },
  },
  {
    key: 'engine_electric_sport',
    note: 'Sport Electric: a hard, fast-rising saw whine with a fifth in it, the loudest of the motors.',
    idleHz: 200,
    redHz: 1500,
    gears: 1,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.34 },
      { w: 'sin', mult: 1.5, gain: 0.3 },
      { w: 'sin', mult: 0.5, gain: 0.3 },
    ],
    filter: { base: 1400, rpm: 4200, throttle: 1500, q: 1.4 },
    level: { idle: 0, throttle: 0.6, rpm: 0.5 },
    whine: { w: 'p12', fromHz: 1400, toHz: 5200, gain: 0.07, by: 'load' },
  },
  {
    key: 'engine_electric_eco',
    note: 'Eco Electric: the gentlest voice, a soft hum with a faint whistle, silent at rest.',
    idleHz: 120,
    redHz: 700,
    gears: 1,
    oscs: [
      { w: 'sin', mult: 1, gain: 0.5 },
      { w: 'tri', mult: 1.01, gain: 0.2 },
    ],
    filter: { base: 900, rpm: 1800, throttle: 500, q: 0.7 },
    level: { idle: 0, throttle: 0.42, rpm: 0.42 },
    whine: { w: 'sin', fromHz: 1100, toHz: 2800, gain: 0.04, by: 'speed' },
  },
  {
    key: 'engine_hybrid',
    note: 'Hybrid: hums like a motor on a light throttle, and the petrol engine cuts in when pushed.',
    idleHz: 62,
    redHz: 208,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.44 },
      { w: 'sq', mult: 2, gain: 0.26 },
      { w: 'tri', mult: 0.5, gain: 0.2 },
    ],
    filter: { base: 560, rpm: 2100, throttle: 800, q: 1.8 },
    level: { idle: 0.12, throttle: 0.6, rpm: 0.3 },
    whine: { w: 'tri', fromHz: 260, toHz: 1500, gain: 0.2, by: 'speed' },
    electricBelow: 0.4,
  },
  {
    key: 'engine_rotary',
    note: 'Rotary: a high, hollow buzz that "braps" at idle and screams smooth at speed.',
    idleHz: 90,
    redHz: 420,
    gears: 4,
    oscs: [
      { w: 'p25', mult: 1, gain: 0.45 },
      { w: 'saw', mult: 2, gain: 0.2 },
      { w: 'p12', mult: 3, gain: 0.14 },
    ],
    lump: { mult: 0.25, depth: 0.6, fade: true },
    filter: { base: 700, rpm: 3000, throttle: 1000, q: 4.5 },
    level: { idle: 0.36, throttle: 0.54, rpm: 0.4 },
  },
  {
    key: 'engine_turbine',
    note: 'Turbine: no cylinders at all. A whistle that takes time to spool up over a wash of hiss.',
    idleHz: 180,
    redHz: 520,
    gears: 1,
    oscs: [
      { w: 'sin', mult: 1, gain: 0.3 },
      { w: 'tri', mult: 2.01, gain: 0.14 },
    ],
    filter: { base: 1500, rpm: 3000, throttle: 600, q: 0.8 },
    level: { idle: 0.2, throttle: 0.4, rpm: 0.4 },
    whine: { w: 'sin', fromHz: 1100, toHz: 5200, gain: 0.2, by: 'spool' },
    noise: {
      w: 'noise',
      rate: 1,
      band: { t: 'bp', fromHz: 1800, toHz: 6500, q: 1.1 },
      gain: { idle: 0.08, throttle: 0.1, rpm: 0.2 },
    },
  },
  {
    key: 'engine_rocket',
    note: 'Rocket Engine: a pulsing roar of burning fuel, ten pulses a second, with a deep cough at each burst.',
    idleHz: 56,
    redHz: 90,
    gears: 1,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.4 },
      { w: 'sq', mult: 2, gain: 0.3 },
    ],
    lump: { mult: 0.25, depth: 0.5 },
    filter: { base: 420, rpm: 900, throttle: 900, q: 1.2 },
    crush: 12,
    level: { idle: 0.22, throttle: 0.5, rpm: 0.2 },
    noise: {
      w: 'noise',
      rate: 0.5,
      band: { t: 'lp', fromHz: 800, toHz: 3400, q: 0.8 },
      gain: { idle: 0.04, throttle: 0.5, rpm: 0.1 },
      gateHz: 10,
    },
    burst: 'rocket_pulse',
  },
  {
    key: 'engine_twin',
    note: 'Twin Drive: two engines a shade apart, so the note beats and throbs against itself.',
    idleHz: 58,
    redHz: 205,
    gears: 4,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.4 },
      { w: 'saw', mult: 1.07, gain: 0.4 },
      { w: 'sq', mult: 2, gain: 0.2 },
      { w: 'sq', mult: 2.14, gain: 0.2 },
    ],
    filter: { base: 540, rpm: 2100, throttle: 900, q: 1.8 },
    level: { idle: 0.44, throttle: 0.56, rpm: 0.3 },
  },
  {
    key: 'engine_spring',
    note: 'Spring Drive: clicks. A ratchet whose ticking speeds up with the car, over a wound-spring twang.',
    idleHz: 55,
    redHz: 165,
    gears: 1,
    oscs: [
      { w: 'tri', mult: 2, gain: 0.3 },
      { w: 'p12', mult: 4, gain: 0.08 },
    ],
    filter: { base: 900, rpm: 1800, throttle: 400, q: 3 },
    level: { idle: 0.1, throttle: 0.3, rpm: 0.3 },
    noise: {
      w: 'metal',
      rate: 1.7,
      band: { t: 'bp', fromHz: 2200, toHz: 3600, q: 2 },
      gain: { idle: 0.12, throttle: 0.2, rpm: 0.2 },
      gate: 0.25,
    },
    burst: 'spring_release',
  },
  {
    key: 'engine_offroad',
    note: 'Trail Engine: a big single thumping away, every stroke separate at low revs.',
    idleHz: 40,
    redHz: 154,
    gears: 3,
    oscs: [
      { w: 'sq', mult: 1, gain: 0.44 },
      { w: 'tri', mult: 0.5, gain: 0.26 },
      { w: 'saw', mult: 2, gain: 0.3 },
    ],
    lump: { mult: 0.5, depth: 0.7, fade: true },
    filter: { base: 480, rpm: 1800, throttle: 900, q: 2 },
    level: { idle: 0.48, throttle: 0.56, rpm: 0.28 },
  },
  {
    key: 'engine_resilient',
    note: 'Ironheart: cast iron. Low, dark and steady, with a slow mechanical knock that never goes away.',
    idleHz: 40,
    redHz: 146,
    gears: 3,
    oscs: [
      { w: 'tri', mult: 1, gain: 0.32 },
      { w: 'saw', mult: 1, gain: 0.42 },
      { w: 'sq', mult: 3, gain: 0.14 },
    ],
    lump: { mult: 0.5, depth: 0.25 },
    filter: { base: 400, rpm: 1400, throttle: 700, q: 1.2 },
    level: { idle: 0.5, throttle: 0.5, rpm: 0.26 },
    noise: {
      w: 'metal',
      rate: 0.5,
      band: { t: 'bp', fromHz: 700, toHz: 1100, q: 3 },
      gain: { idle: 0.1, throttle: 0.06, rpm: 0.04 },
      gate: 0.5,
    },
  },
  {
    key: 'engine_experimental',
    note: 'Wildcard Motor: an inharmonic, glitching tone whose pitch swells and sags on its four-second cycle.',
    idleHz: 74,
    redHz: 270,
    gears: 2,
    oscs: [
      { w: 'saw', mult: 1, gain: 0.4 },
      { w: 'p12', mult: 5.02, gain: 0.12 },
      { w: 'sq', mult: 1.41, gain: 0.2 },
      { w: 'tri', mult: 0.5, gain: 0.2 },
    ],
    lump: { mult: 0.33, depth: 0.3 },
    filter: { base: 500, rpm: 2000, throttle: 900, q: 3.5 },
    crush: 10,
    level: { idle: 0.4, throttle: 0.54, rpm: 0.32 },
    cycleWobble: 0.09,
  },
];

const BY_KEY = new Map(ENGINE_RECIPES.map((recipe) => [recipe.key, recipe]));

export const DEFAULT_ENGINE_KEY = 'engine_inline4';

export function engineRecipe(soundKey: string): EngineRecipe | undefined {
  return BY_KEY.get(soundKey);
}

/** Mistakes in an engine recipe, as text. */
export function engineProblems(recipe: EngineRecipe): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${recipe.key}: ${text}`);
  if (recipe.oscs.length < 1 || recipe.oscs.length > 4) say('one to four tone channels');
  if (!(recipe.idleHz >= 20 && recipe.redHz > recipe.idleHz)) say('idle and red line out of order');
  for (const osc of recipe.oscs) {
    const top = recipe.redHz * 1.05 * osc.mult;
    if (top > 9000) say('a tone channel passes 9 kHz at the red line');
    if (recipe.idleHz * osc.mult < 7) say('a tone channel is below hearing at idle');
  }
  if (recipe.level.idle < 0 || recipe.level.idle + recipe.level.throttle + recipe.level.rpm > 1.6)
    say('level out of range');
  if (!recipe.note) say('no design note');
  return problems;
}
