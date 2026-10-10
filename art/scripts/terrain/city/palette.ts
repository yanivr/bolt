import type { Color } from '../canvas.js';
import { col, mixc } from '../canvas.js';

/**
 * Night city palette. Ramps are hue shifted: shadows lean blue-violet, lights lean warm.
 * There is no pure gray and no pure black. These are the colors of the unlit night state;
 * the lighting pass derives the lit and shadowed variants from them.
 */

export const PAL = {
  ink: col('#10131F'),
  inkSoft: col('#181C2C'),

  // Asphalt: the stage. Dark blue-gray that never drops out of sight.
  asphaltRubber: col('#272D40'),
  asphaltDark: col('#2F364A'),
  asphalt: col('#363E53'),
  asphaltLight: col('#3E475D'),
  asphaltSpeck: col('#4A536A'),
  patch: col('#2B3145'),
  patchEdge: col('#22273A'),
  crack: col('#1F2436'),
  oil: col('#2A2A44'),

  // Road paint.
  paint: col('#D6D1C0'),
  paintWorn: col('#A9A9AA'),
  paintBright: col('#F1EAD6'),
  paintGold: col('#E2B052'),
  paintGoldWorn: col('#B08A4C'),

  // Cobblestone: warmer, lighter, patterned.
  mortar: col('#34303F'),
  cobbleDark: col('#544C5A'),
  cobble: col('#625866'),
  cobbleLight: col('#716570'),
  cobbleHi: col('#84767C'),
  sett: col('#7C7684'),
  settLight: col('#908A96'),
  rail: col('#B4C0CE'),
  railMid: col('#75839A'),
  railGroove: col('#1D2132'),

  // Kerbs.
  kerbShade: col('#535C73'),
  kerb: col('#7E889C'),
  kerbHi: col('#A9B2BF'),
  kerbCoral: col('#E4604F'),
  kerbCoralDark: col('#B1463F'),
  kerbIvory: col('#EAE3CE'),
  kerbIvoryDark: col('#B7B1A4'),

  // Sidewalk slabs: lighter and cooler than asphalt.
  walkGrout: col('#3B445B'),
  walk: col('#4B566E'),
  walkLight: col('#556079'),
  walkShade: col('#414A61'),

  // The solid edge.
  wallBase: col('#131726'),
  wallShade: col('#3A425A'),
  wallCap: col('#5C667F'),
  wallHi: col('#8D98AD'),

  // Ground behind the walls.
  street: col('#222739'),
  streetDark: col('#1D2132'),
  streetMark: col('#3C4257'),
  yard: col('#292E41'),
  yardAlt: col('#2E3448'),
  plaza: col('#3D4459'),
  plazaAlt: col('#454C62'),
  plazaLine: col('#33394D'),

  // Foliage, teal-shifted for night.
  leafDeep: col('#17302E'),
  leafDark: col('#21483C'),
  leaf: col('#2F6A4A'),
  leafLight: col('#4A9460'),
  leafHi: col('#74BE78'),
  grassDark: col('#1E3A34'),
  grass: col('#27493C'),
  grassLight: col('#30583F'),
  soil: col('#2C2530'),

  // Water.
  waterDeep: col('#121A30'),
  water: col('#17223C'),
  waterLight: col('#1E2F4D'),
  waterGlint: col('#3B678A'),
  waterSpark: col('#86BDD4'),

  // Metal and utility.
  steelDark: col('#2A3044'),
  steel: col('#59657D'),
  steelLight: col('#8E9BB0'),
  steelHi: col('#C3CDD8'),
  wood: col('#6C5048'),
  woodLight: col('#86654F'),
  woodDark: col('#4A3638'),
  glass: col('#2C5F73'),
  glassLight: col('#4F97A8'),

  // Emissive accents shared with the interface palette.
  cyan: col('#46D5E6'),
  cyanHi: col('#CDF7FA'),
  cyanDim: col('#1F7C92'),
  coral: col('#F46B58'),
  coralHi: col('#FFD3C2'),
  coralDim: col('#98393D'),
  purple: col('#B49AF2'),
  purpleHi: col('#E6DAFF'),
  purpleDim: col('#6D59A2'),
  gold: col('#F6C35B'),
  goldHi: col('#FFF1BD'),
  goldDim: col('#A6722F'),
  mint: col('#67DEA7'),
  mintDim: col('#2A7F63'),
  amber: col('#FFB454'),
  red: col('#D83F49'),
  redDim: col('#7A2634'),
  ivory: col('#F5EED9'),
  lamp: col('#FFE9B0'),
  lampGlow: col('#F4B45E'),
  windowWarm: col('#FFD98A'),
  windowMid: col('#E39A4C'),
  windowDim: col('#8F5636'),
  windowNight: col('#18223A'),
  windowGlint: col('#2F4D70'),
} as const;

/** Rooftop color families: highlight, parapet, base, texture alternate, dark, deep. */
export type RoofRamp = { hi: Color; par: Color; base: Color; alt: Color; dark: Color; deep: Color };

const ramp = (
  hi: string,
  par: string,
  base: string,
  alt: string,
  dark: string,
  deep: string,
): RoofRamp => ({
  hi: col(hi),
  par: col(par),
  base: col(base),
  alt: col(alt),
  dark: col(dark),
  deep: col(deep),
});

export const ROOF_SLATE = 0;
export const ROOF_TEAL = 1;
export const ROOF_MAROON = 2;
export const ROOF_PLUM = 3;
export const ROOF_OLIVE = 4;
export const ROOF_CONCRETE = 5;

export const ROOFS: readonly RoofRamp[] = [
  ramp('#6C7DA0', '#445274', '#29334E', '#2F3A57', '#1F273E', '#171D30'),
  ramp('#55908F', '#33636D', '#1E404B', '#234852', '#162F39', '#10232B'),
  ramp('#A45C64', '#703F4B', '#482A39', '#50303F', '#341E2C', '#261623'),
  ramp('#8B70AB', '#5B4A7E', '#382D53', '#3F345C', '#28203E', '#1D1830'),
  ramp('#7F8B68', '#55604B', '#373F35', '#3D463A', '#272D27', '#1D221E'),
  ramp('#8A8FA2', '#606579', '#3E4256', '#44495C', '#2D3144', '#222535'),
];

/**
 * A building in the oblique view has three planes with three clearly separate values. The roof
 * catches the sky and is the lightest. The west wall is turned toward the light and sits in
 * the middle. The south wall is turned away from it and stays in deep blue-violet shade, which
 * leaves the work there to windows and neon.
 */
export type BuildingRamp = {
  roof: Color;
  roofAlt: Color;
  roofLine: Color;
  /** Lit top of a parapet or cornice, and its shaded counterpart. */
  rim: Color;
  rimLow: Color;
  /** Inner face of a parapet, in shade. */
  inner: Color;
  /** West wall, toward the light. */
  west: Color;
  westAlt: Color;
  westLine: Color;
  /** The lit corner where the west wall meets the south wall. */
  edge: Color;
  /** South wall, in shade. */
  wall: Color;
  wallAlt: Color;
  wallLow: Color;
  /** Piers and string courses on the south wall. */
  pier: Color;
  line: Color;
  trim: Color;
  deep: Color;
};

export const BUILDINGS: readonly BuildingRamp[] = ROOFS.map((r) => ({
  roof: mixc(r.par, r.hi, 0.2),
  roofAlt: mixc(r.par, r.hi, 0.06),
  roofLine: mixc(r.alt, r.par, 0.5),
  rim: mixc(r.hi, col('#F2EEDC'), 0.18),
  rimLow: mixc(r.hi, r.par, 0.4),
  inner: r.dark,
  west: mixc(r.alt, r.par, 0.4),
  westAlt: mixc(r.alt, r.par, 0.16),
  westLine: mixc(r.base, r.dark, 0.3),
  edge: mixc(r.par, r.hi, 0.55),
  wall: mixc(r.dark, r.base, 0.62),
  wallAlt: mixc(r.dark, r.base, 0.3),
  wallLow: mixc(r.deep, r.dark, 0.5),
  pier: mixc(r.base, r.alt, 0.7),
  line: r.deep,
  trim: mixc(r.alt, r.par, 0.75),
  deep: mixc(r.deep, col('#0E1124'), 0.3),
}));

/** Slate and concrete dominate; the saturated families are accents. */
export const ROOF_WEIGHTS: readonly number[] = [
  0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 1, 1, 2, 2, 3, 3, 4, 4, 4,
];

/** Container liveries for the harbor and parked car paint. */
export const LIVERIES: readonly Color[] = [
  col('#A94A42'),
  col('#2F7B84'),
  col('#B98B3C'),
  col('#3C4C7C'),
  col('#8F93A2'),
  col('#3E7C5C'),
  col('#7A5A9A'),
];

export const lighter = (c: Color, t: number): Color => mixc(c, col('#FFF4DC'), t);
export const darker = (c: Color, t: number): Color => mixc(c, col('#0E1124'), t);

/** Cast shadow: darker and pulled toward blue-violet, but the road stays visible. */
export function shadeNight(c: Color): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const nr = Math.round(r * 0.6 + 3);
  const ng = Math.round(g * 0.6 + 4);
  const nb = Math.round(b * 0.68 + 10);
  return (nr << 16) | (ng << 8) | nb;
}

/**
 * A building's shadow across drivable ground: a gentle step down that leaves paint, kerbs and
 * edges fully readable and never takes pavement below the darkest tone the road already uses.
 */
export function shadeRoad(c: Color): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const nr = Math.max(Math.min(r, 0x27), Math.round(r * 0.8 + 2));
  const ng = Math.max(Math.min(g, 0x2d), Math.round(g * 0.8 + 3));
  const nb = Math.max(Math.min(b, 0x40), Math.round(b * 0.84 + 7));
  return (nr << 16) | (ng << 8) | nb;
}

/**
 * Shadow of a structure that stands over the road (a bridge, the gantry, a barrier): deeper
 * than a building's, but held to the same floor so the pavement never drops out of sight.
 */
export function shadeRoadDeep(c: Color): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const nr = Math.max(Math.min(r, 0x27), Math.round(r * 0.68 + 2));
  const ng = Math.max(Math.min(g, 0x2d), Math.round(g * 0.68 + 3));
  const nb = Math.max(Math.min(b, 0x40), Math.round(b * 0.74 + 9));
  return (nr << 16) | (ng << 8) | nb;
}

/** Shadow one mass throws onto the roof or west wall of another: a full, hard step down. */
export function castShade(c: Color): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (
    (Math.round(r * 0.56 + 4) << 16) | (Math.round(g * 0.57 + 5) << 8) | Math.round(b * 0.66 + 14)
  );
}

/** Small contact shadow under roof dressing and street furniture. */
export function contactShade(c: Color): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (
    (Math.round(r * 0.55 + 2) << 16) | (Math.round(g * 0.55 + 3) << 8) | Math.round(b * 0.62 + 9)
  );
}

export const TINT_WARM = 0;
export const TINT_CYAN = 1;
export const TINT_CORAL = 2;
export const TINT_PURPLE = 3;
export const TINT_GOLD = 4;
export const TINT_COOL = 5;

export const TINT_HEX: readonly string[] = [
  '#FFC47A',
  '#46D5E6',
  '#F46B58',
  '#9A7FE0',
  '#F6C35B',
  '#CFE4F5',
];

const TINTS: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.72, 0.3],
  [0.3, 0.86, 0.95],
  [1.0, 0.44, 0.36],
  [0.64, 0.5, 0.96],
  [1.0, 0.78, 0.38],
  [0.96, 0.94, 0.84],
];

const GAIN = [0, 0.2, 0.42, 0.68];
const LIFT = [0, 7, 15, 25];

/** Posterized lamp response. Step 1 to 3; each step is a distinct hard tone. */
export function litNight(c: Color, step: number, tint: number): Color {
  const t = TINTS[tint] ?? TINTS[0]!;
  const g = GAIN[step] ?? 1;
  const l = LIFT[step] ?? 32;
  const r = (c >> 16) & 255;
  const gr = (c >> 8) & 255;
  const b = c & 255;
  // Already-bright surfaces gain less, so paint and cobble do not blow out under a lamp.
  const lum = (r * 3 + gr * 5 + b * 2) / 10;
  const k = g * Math.max(0.22, 1.22 - lum / 190);
  const nr = Math.min(255, Math.round(r * (1 + k * t[0]) + l * t[0]));
  const ng = Math.min(255, Math.round(gr * (1 + k * t[1]) + l * t[1]));
  const nb = Math.min(255, Math.round(b * (1 + k * t[2]) + l * t[2]));
  return (nr << 16) | (ng << 8) | nb;
}
