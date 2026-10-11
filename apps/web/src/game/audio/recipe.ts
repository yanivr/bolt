/**
 * Sound recipes: every sound in the game is a small piece of DATA describing oscillators, noise
 * channels, filters and envelopes, in the spirit of an 8-bit or 16-bit sound chip. Nothing here
 * touches the Web Audio API, so the tables can be checked in a plain Node test; `synth.ts`
 * turns a recipe into nodes.
 */

/**
 * The channels of the imaginary sound chip.
 * `sq`, `p25`, `p12`: pulse waves at 50, 25 and 12.5 percent duty. `tri`, `saw`, `sin`.
 * `noise`: white noise. `lfsr`: one-bit shift-register noise (the console "hiss").
 * `metal`: the 93-step short shift register, which is pitched and metallic.
 */
export type Wave = 'sq' | 'p25' | 'p12' | 'tri' | 'saw' | 'sin' | 'noise' | 'lfsr' | 'metal';

/** A breakpoint: seconds after the start of the voice, value. */
export type Pt = readonly [number, number];
/** A constant, or a line through breakpoints. */
export type Curve = number | readonly Pt[];

export type Lfo = {
  w: 'sq' | 'tri' | 'sin' | 'saw';
  hz: number;
  /** `f` and `cut`: a share of the frequency. `amp`: tremolo depth, 0 to 1. */
  depth: number;
  to: 'f' | 'amp' | 'cut';
};

export type Filter = { t: 'lp' | 'hp' | 'bp'; f: Curve; q?: number };

export type Layer = {
  w: Wave;
  /** Hertz for a tone. For a noise channel, the playback rate (1 is full band, 0.1 is a rumble). */
  f: Curve;
  /** How `f` moves between breakpoints: a glide, or steps like an arpeggio. Default `exp`. */
  glide?: 'exp' | 'lin' | 'step';
  /** Loudness breakpoints, 0 to 1. The voice always starts from and returns to silence. */
  env: readonly Pt[];
  /** Layer level, default 1. */
  g?: number;
  /** Seconds to hold the layer back. */
  at?: number;
  /** Two-operator FM: a sine at `ratio` times the carrier, `index` deep, fading over `decay`. */
  fm?: { ratio: number; index: number; decay?: number };
  lfo?: Lfo;
  flt?: Filter;
  /** Bit-crush: the number of amplitude steps left (16 is four bits). */
  crush?: number;
};

export const BUS_IDS = [
  'engine',
  'weapons',
  'impacts',
  'ambience',
  'alerts',
  'ui',
  'music',
] as const;
export type BusId = (typeof BUS_IDS)[number];

/**
 * What kind of sound it is. Each category has a loudness window that every recipe in it is
 * measured against (see `LOUDNESS_TARGETS`).
 */
export const CATEGORIES = [
  'ui',
  'race',
  'stinger',
  'alert',
  'fire_small',
  'fire_big',
  'mech',
  'travel',
  'impact_small',
  'impact',
  'explosion',
  'status',
  'utility',
  'install',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Loudness windows in dBFS: the loudest 100 ms RMS of the sound, heard at the player's own car
 * with every slider at full, after the master limiter. `aim` is where the calibration puts a
 * recipe; the window is what the render test accepts.
 */
export const LOUDNESS_TARGETS: Readonly<
  Record<Category, { aim: number; min: number; max: number }>
> = {
  ui: { aim: -24, min: -30, max: -18 },
  race: { aim: -19, min: -25, max: -13 },
  stinger: { aim: -17, min: -23, max: -11 },
  alert: { aim: -16, min: -22, max: -10 },
  fire_small: { aim: -19, min: -25, max: -13 },
  fire_big: { aim: -15, min: -21, max: -9 },
  mech: { aim: -23, min: -29, max: -17 },
  travel: { aim: -25, min: -31, max: -19 },
  impact_small: { aim: -22, min: -28, max: -16 },
  impact: { aim: -17, min: -23, max: -11 },
  explosion: { aim: -12, min: -18, max: -7 },
  status: { aim: -26, min: -32, max: -20 },
  utility: { aim: -19, min: -25, max: -13 },
  install: { aim: -21, min: -27, max: -15 },
};

/** Engines: RMS at full throttle with the Engine slider at full, dBFS. */
export const ENGINE_LOUDNESS = { aim: -20, min: -25, max: -15 } as const;

export type Recipe = {
  id: string;
  bus: BusId;
  cat: Category;
  /** 0 to 100. Decides who is stolen when the voice pool is full; 100 is never stolen. */
  pri: number;
  layers: readonly Layer[];
  /** Sustains at the last envelope level until stopped. */
  loop?: boolean;
  /** Seconds a loop takes to fade when stopped. */
  release?: number;
  /** Least milliseconds between two starts of this sound. */
  limitMs?: number;
  /** Most copies of this sound at once; the oldest goes. */
  poly?: number;
  /** 0 to 1: how hard this sound ducks the music and engines while it plays. */
  duck?: number;
  /** One line: what the sound is meant to be. Printed in docs/AUDIO_GUIDE.md. */
  note: string;
};

const MIN_ATTACK = 0.003;
const MIN_RELEASE = 0.012;

function curveEnd(curve: Curve): number {
  return typeof curve === 'number' ? 0 : (curve[curve.length - 1]?.[0] ?? 0);
}

/** Seconds from the start of a layer to its last envelope point, before the closing fade. */
export function layerEnvEnd(layer: Layer): number {
  return (layer.at ?? 0) + Math.max(MIN_ATTACK, curveEnd(layer.env));
}

/** Seconds a one-shot lasts, closing fade included. A loop reports its attack only. */
export function recipeDuration(recipe: Recipe, stretch = 1): number {
  let end = 0;
  for (const layer of recipe.layers) end = Math.max(end, layerEnvEnd(layer));
  return end * stretch + MIN_RELEASE;
}

export const ENV_LIMITS = { MIN_ATTACK, MIN_RELEASE } as const;

/** Structural mistakes in a recipe, as text. Empty means sound. */
export function recipeProblems(recipe: Recipe): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${recipe.id}: ${text}`);
  if (recipe.layers.length < 1 || recipe.layers.length > 5) say('needs one to five layers');
  if (recipe.pri < 0 || recipe.pri > 100) say('priority out of range');
  if (!recipe.note) say('no design note');
  recipe.layers.forEach((layer, index) => {
    const where = `layer ${index}`;
    if (layer.env.length < 1) say(`${where} has no envelope`);
    let last = -1;
    for (const [t, v] of layer.env) {
      if (t < last) say(`${where} envelope goes back in time`);
      if (v < 0 || v > 1) say(`${where} envelope level out of range`);
      last = t;
    }
    const lastLevel = layer.env[layer.env.length - 1]?.[1] ?? 0;
    if (recipe.loop && lastLevel <= 0 && index === 0) say('a loop must sustain above zero');
    const freqs = typeof layer.f === 'number' ? [layer.f] : layer.f.map((p) => p[1]);
    const noisy = layer.w === 'noise' || layer.w === 'lfsr' || layer.w === 'metal';
    for (const f of freqs) {
      if (!(f > 0)) say(`${where} frequency must be positive`);
      if (noisy && f > 8) say(`${where} noise rate is a playback rate, not hertz`);
      if (!noisy && (f < 16 || f > 12000)) say(`${where} tone outside 16 Hz to 12 kHz`);
    }
    if (layer.flt) {
      const cut = typeof layer.flt.f === 'number' ? [layer.flt.f] : layer.flt.f.map((p) => p[1]);
      for (const f of cut) if (f < 20 || f > 16000) say(`${where} filter outside 20 Hz to 16 kHz`);
    }
    if (layer.crush !== undefined && (layer.crush < 2 || layer.crush > 256))
      say(`${where} crush steps out of range`);
  });
  return problems;
}
