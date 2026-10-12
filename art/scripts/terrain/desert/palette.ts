import type { WeatherPreset } from '@bolt/shared';
import { col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';

/**
 * The desert palette family. One set of ramps is shared by both tracks; each track picks its
 * sand and rock family, and each weather preset is a grade applied to the finished picture
 * (ground, overlays and loops alike, so frame 0 of a loop always matches the art under it).
 *
 * Shadows lean blue-violet in clear light and brown in dust. There is no pure gray and no pure
 * black anywhere: the darkest ink is a warm maroon.
 */

export type SandRamp = {
  hi: Color;
  light: Color;
  base: Color;
  mid: Color;
  dark: Color;
  deep: Color;
};

export type RockRamp = {
  hi: Color;
  light: Color;
  base: Color;
  mid: Color;
  dark: Color;
  deep: Color;
  ink: Color;
};

const sand = (hi: string, light: string, base: string, mid: string, dark: string, deep: string) => ({
  hi: col(hi),
  light: col(light),
  base: col(base),
  mid: col(mid),
  dark: col(dark),
  deep: col(deep),
});

const rock = (
  hi: string,
  light: string,
  base: string,
  mid: string,
  dark: string,
  deep: string,
  ink: string,
): RockRamp => ({
  hi: col(hi),
  light: col(light),
  base: col(base),
  mid: col(mid),
  dark: col(dark),
  deep: col(deep),
  ink: col(ink),
});

export const PAL = {
  ink: col('#2B1D21'),
  inkSoft: col('#3B2A2C'),

  // Asphalt: sun-bleached warm gray, always far darker than any sand.
  asphaltHi: col('#6B666D'),
  asphaltLight: col('#5C5860'),
  asphalt: col('#504C55'),
  asphaltDark: col('#44414A'),
  asphaltDeep: col('#3A3740'),
  tar: col('#302D35'),
  patch: col('#48444E'),
  patchEdge: col('#3C3942'),

  // Road paint.
  white: col('#EFE7D3'),
  whiteWorn: col('#C8BEA9'),
  yellow: col('#E8B23E'),
  yellowWorn: col('#BC9147'),
  curbRed: col('#C9443A'),
  curbRedDark: col('#97322E'),
  curbWhite: col('#EFE7D3'),
  curbWhiteDark: col('#BDB2A0'),
  stud: col('#F4C25A'),

  // Graded sand road: paler, flatter and smoother than the dunes, with wheel tracks.
  gradeHi: col('#F2D6A6'),
  gradeLight: col('#EACB98'),
  grade: col('#E1BD88'),
  gradeMid: col('#D6AF7A'),
  rut: col('#C99F6C'),
  rutDeep: col('#B88E5F'),
  stone: col('#F3EEE2'),
  stoneShade: col('#B9AE9C'),

  // Vegetation.
  sageHi: col('#B6BC80'),
  sage: col('#929C66'),
  sageDark: col('#6C7852'),
  sageDeep: col('#4E5B40'),
  brushHi: col('#C9A86E'),
  brush: col('#A88A5A'),
  brushDark: col('#7E6544'),
  cactusHi: col('#9CC46E'),
  cactusLight: col('#7FAA5C'),
  cactus: col('#62904E'),
  cactusDark: col('#486F3F'),
  cactusDeep: col('#334F33'),
  bark: col('#8C6C4A'),
  barkDark: col('#5E4834'),

  // Wood, metal, rust, rubber.
  woodHi: col('#B89468'),
  wood: col('#957250'),
  woodDark: col('#6C513A'),
  woodDeep: col('#4A382C'),
  steelHi: col('#D5D3CC'),
  steelLight: col('#A9A8A6'),
  steel: col('#7F7F84'),
  steelDark: col('#5A5A63'),
  steelDeep: col('#403F49'),
  rustHi: col('#D27D48'),
  rust: col('#AE5D36'),
  rustDark: col('#80412C'),
  rustDeep: col('#5A2F26'),
  ore: col('#7A6660'),
  rubber: col('#3A3539'),
  rubberHi: col('#5A5459'),

  // Signs and flags.
  signYellow: col('#F2C24C'),
  signYellowDark: col('#C4952F'),
  signRed: col('#D44B3A'),
  signRedDark: col('#9B3330'),
  signWhite: col('#F4EDDA'),
  signWhiteDark: col('#C9BFAA'),
  signBlack: col('#2E2523'),
  flagOrange: col('#F07A3A'),
  flagOrangeDark: col('#B4532E'),
  sky: col('#7FB4C8'),
  skyLight: col('#B6D8DE'),
  lamp: col('#FF5A44'),
  lampHi: col('#FFD2B8'),
  lampDim: col('#7A2A2A'),

  // Old paint for the billboard and the wrecks.
  paintTeal: col('#5E9C98'),
  paintTealDark: col('#41706E'),
  paintCream: col('#E8D8B4'),
  paintCoral: col('#D66E58'),
  paintBlue: col('#6A86A8'),
  paintBlueDark: col('#4B6280'),
} as const;

/** Graded road surfaces: packed buff sand on Dust Devil, pale caliche on Canyon Switch. */
export const GRADE_DUNE = {
  hi: col('#F2D6A6'),
  base: col('#E8C796'),
  mid: col('#D8B07B'),
  rut: col('#C69B69'),
  edge: col('#B7895A'),
};
export const GRADE_CALICHE = {
  hi: col('#FAF0DC'),
  base: col('#F1E3C6'),
  mid: col('#E1CDA8'),
  rut: col('#CDB38B'),
  edge: col('#B39672'),
};

/** Dust Devil: warm orange dune sand and terracotta rock. */
export const SAND_DUNE: SandRamp = sand('#F4CF90', '#EABD7E', '#DFAA6C', '#D1985B', '#BE8552', '#A46E47');
/** Iron-red dune sand, in broad patches on Dust Devil. */
export const SAND_RED: SandRamp = sand('#F2C489', '#E6B077', '#D99D66', '#CB8B57', '#B6784D', '#9B6444');
/** Canyon Switch: paler, more bone-colored sand and pink-cream sandstone. */
export const SAND_CANYON: SandRamp = sand(
  '#F5DDB2',
  '#ECCF9F',
  '#E2C08D',
  '#D4AE7C',
  '#C29A6C',
  '#A9825D',
);

/** Pale wind-sorted sand, in patches on Canyon Switch's plateau. */
export const SAND_PALE: SandRamp = sand('#F8E6C2', '#F1DAB0', '#E8CC9C', '#DBBA88', '#C9A677', '#B08E66');

export const ROCK_TERRA: RockRamp = rock(
  '#F0A676',
  '#DA885C',
  '#C06E48',
  '#A5593D',
  '#864634',
  '#62332A',
  '#3E2224',
);
export const ROCK_SANDSTONE: RockRamp = rock(
  '#F4D2AA',
  '#E4B387',
  '#CF9266',
  '#B77650',
  '#975B41',
  '#6E4033',
  '#45272A',
);

/** Strata bands from the foot of a cliff upward: each a light and a dark value. */
export const STRATA: ReadonlyArray<readonly [Color, Color]> = [
  [col('#C9774E'), col('#A65C3F')],
  [col('#E2B48A'), col('#C39270')],
  [col('#B9603F'), col('#934A36')],
  [col('#D7966A'), col('#B57552')],
  [col('#EBCDA6'), col('#CBAA86')],
  [col('#A9573E'), col('#854434')],
  [col('#D58B5C'), col('#B06D4A')],
];

/** Desert varnish: dark streaks that run down a cliff face from its rim. */
export const VARNISH = col('#5E3833');

export const lighter = (c: Color, t: number): Color => mixc(c, col('#FFF6E4'), t);
export const darker = (c: Color, t: number): Color => mixc(c, col('#2B1D21'), t);

/**
 * A weather look: the light and the grade of one preset. `drop` is how fast a cast shadow sinks
 * per pixel it travels (small is a long, low-sun shadow), `shade` darkens ground in shadow,
 * `grade` maps every final color to the preset's light.
 */
export type Look = {
  id: string;
  drop: number;
  shade: (c: Color) => Color;
  /** Shadow that one mass throws on another's face or top. */
  castShade: (c: Color) => Color;
  grade: (c: Color) => Color;
  /** Unit vector the wind blows toward, and its speed in px/s. */
  wind: { x: number; y: number; speed: number };
  /** 0 to 1: how much loose sand the wind is moving (drift fingers, streaks). */
  drift: number;
  /** Paint and edge pixels keep more of their own value under the grade. */
  gradePaint: (c: Color) => Color;
  /** Channel step of the final picture (1 keeps every value). */
  posterize: number;
};

function channels(c: Color): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function pack(r: number, g: number, b: number): Color {
  const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return (k(r) << 16) | (k(g) << 8) | k(b);
}

/** Golden afternoon: warm highlights, violet shadows, long and low. */
function shadeGolden(c: Color): Color {
  const [r, g, b] = channels(c);
  return pack(r * 0.66 + 6, g * 0.64 + 8, b * 0.72 + 26);
}

function castGolden(c: Color): Color {
  const [r, g, b] = channels(c);
  return pack(r * 0.62 + 4, g * 0.6 + 6, b * 0.7 + 24);
}

/** Midday heat: short shadows, bleached and still violet-cool, a step lighter. */
function shadeNoon(c: Color): Color {
  const [r, g, b] = channels(c);
  return pack(r * 0.72 + 8, g * 0.71 + 10, b * 0.78 + 26);
}

/** Dusty light: weak brown shadows. */
function shadeDust(c: Color): Color {
  const [r, g, b] = channels(c);
  return pack(r * 0.8 + 6, g * 0.78 + 6, b * 0.8 + 10);
}

function grader(
  warm: [number, number, number],
  lift: number,
  liftColor: Color,
  sat: number,
  mul: number,
  fog: number,
  fogColor: Color,
): (c: Color) => Color {
  const cache = new Map<Color, Color>();
  const [lr, lg, lb] = channels(liftColor);
  const [fr, fg, fb] = channels(fogColor);
  return (c) => {
    const hit = cache.get(c);
    if (hit !== undefined) return hit;
    let [r, g, b] = channels(c);
    r = r * warm[0];
    g = g * warm[1];
    b = b * warm[2];
    const l = r * 0.3 + g * 0.55 + b * 0.15;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    r = r + (lr - r) * lift;
    g = g + (lg - g) * lift;
    b = b + (lb - b) * lift;
    r *= mul;
    g *= mul;
    b *= mul;
    r = r + (fr - r) * fog;
    g = g + (fg - g) * fog;
    b = b + (fb - b) * fog;
    const out = pack(r, g, b);
    cache.set(c, out);
    return out;
  };
}

export function lookFor(preset: WeatherPreset): Look {
  const speed = Math.hypot(preset.windX, preset.windY);
  const wind = {
    x: speed > 0 ? preset.windX / speed : 1,
    y: speed > 0 ? preset.windY / speed : 0,
    speed,
  };
  switch (preset.id) {
    case 'desert_clear': {
      const grade = grader([1.02, 1.0, 0.95], 0, 0, 1.04, 1, 0, 0);
      return {
        id: preset.id,
        drop: 3,
        shade: shadeGolden,
        castShade: castGolden,
        grade,
        gradePaint: grade,
        wind,
        drift: 0.15,
        posterize: 1,
      };
    }
    case 'desert_crosswind': {
      // The same afternoon through a little blown dust.
      const grade = grader([1.02, 1.0, 0.95], 0, 0, 0.98, 0.99, 0.06, col('#E2B47E'));
      return {
        id: preset.id,
        drop: 3,
        shade: shadeGolden,
        castShade: castGolden,
        grade,
        gradePaint: grader([1.02, 1.0, 0.96], 0, 0, 1, 1, 0.03, col('#E2B47E')),
        wind,
        drift: 0.75,
        posterize: 1,
      };
    }
    case 'desert_dry_heat': {
      const grade = grader([1.03, 1.0, 0.94], 0.12, col('#FFF3DC'), 0.8, 1.02, 0, 0);
      return {
        id: preset.id,
        drop: 7,
        shade: shadeNoon,
        castShade: shadeNoon,
        grade,
        gradePaint: grader([1.02, 1.0, 0.96], 0.06, col('#FFF3DC'), 0.9, 1, 0, 0),
        wind,
        drift: 0.1,
        posterize: 1,
      };
    }
    case 'desert_sandstorm': {
      const grade = grader([1.0, 0.97, 0.88], 0, 0, 0.78, 0.84, 0.3, col('#A87C4E'));
      return {
        id: preset.id,
        drop: 5,
        shade: shadeDust,
        castShade: shadeDust,
        grade,
        gradePaint: grader([1.0, 0.98, 0.92], 0, 0, 0.9, 0.95, 0.16, col('#A87C4E')),
        wind,
        drift: 1,
        posterize: 6,
      };
    }
    default:
      throw new Error(`The desert module does not paint ${preset.id}`);
  }
}
