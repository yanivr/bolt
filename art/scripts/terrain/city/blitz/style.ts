import { col, mixc } from '../../canvas.js';
import type { Color } from '../../canvas.js';
import type { CityStyle } from '../palette.js';
import {
  ROOF_CONCRETE,
  ROOF_MAROON,
  ROOF_OLIVE,
  ROOF_PLUM,
  ROOF_SLATE,
  ROOF_TEAL,
  roofRamp,
} from '../palette.js';
import type { WetStyle } from '../wet.js';

/**
 * Backstreet Blitz's two looks. The clear preset is golden hour, about forty minutes before
 * sunset: the low sun stands west-north-west, which is the baker's upper-left key light, so the
 * roofs and west walls catch warm peach light and the cast shadows run long and blue-violet
 * across the streets; sodium lamps and shop windows are coming on. The rain preset is an
 * overcast wet afternoon: cooler, grayer, every lamp and window lit against the gloom.
 *
 * As in Neon Cut, these are the colors before lighting: the lamp pass adds posterized pools on
 * top and the shadow pass takes hard steps down.
 */

const c = col;

/** Golden-hour palette: daylight in the shade, warm stone, a warm-gray stage. */
const GOLDEN_PAL: CityStyle['pal'] = {
  ink: c('#1E1A26'),
  inkSoft: c('#2B2634'),
  asphaltRubber: c('#3B3C4C'),
  asphaltDark: c('#44465A'),
  asphalt: c('#4C4F63'),
  asphaltLight: c('#56596D'),
  asphaltSpeck: c('#66687B'),
  patch: c('#45475A'),
  patchEdge: c('#3A3B4D'),
  crack: c('#323343'),
  oil: c('#3D3A50'),
  paint: c('#EDE2C6'),
  paintWorn: c('#BFB6A2'),
  paintBright: c('#FFF5DA'),
  paintGold: c('#F0BA56'),
  paintGoldWorn: c('#C29A56'),
  mortar: c('#5E4E52'),
  cobbleDark: c('#776260'),
  cobble: c('#846E69'),
  cobbleLight: c('#917A73'),
  cobbleHi: c('#A68B7E'),
  sett: c('#8E7F7C'),
  settLight: c('#A5958E'),
  rail: c('#D6D4D2'),
  railMid: c('#8F929C'),
  railGroove: c('#2D2A35'),
  kerbShade: c('#6C6976'),
  kerb: c('#A4A0A8'),
  kerbHi: c('#D2CCC6'),
  kerbCoral: c('#E8634E'),
  kerbCoralDark: c('#B84A40'),
  kerbIvory: c('#F5EBD2'),
  kerbIvoryDark: c('#C5B9A3'),
  walkGrout: c('#5C5866'),
  walk: c('#78737E'),
  walkLight: c('#86808A'),
  walkShade: c('#68636F'),
  wallBase: c('#2A2634'),
  wallShade: c('#625C6A'),
  wallCap: c('#8E8790'),
  wallHi: c('#C4B8B0'),
  street: c('#4E4A56'),
  streetDark: c('#45414D'),
  streetMark: c('#6C6672'),
  yard: c('#5A535C'),
  yardAlt: c('#615962'),
  plaza: c('#7C6A62'),
  plazaAlt: c('#877268'),
  plazaLine: c('#615153'),
  leafDeep: c('#243A30'),
  leafDark: c('#36553B'),
  leaf: c('#4F7A42'),
  leafLight: c('#80A452'),
  leafHi: c('#C4C66C'),
  grassDark: c('#3B5435'),
  grass: c('#4D6C3D'),
  grassLight: c('#5F8045'),
  soil: c('#4C3B35'),
  waterDeep: c('#24324C'),
  water: c('#2F4464'),
  waterLight: c('#4B6888'),
  waterGlint: c('#E2AC76'),
  waterSpark: c('#FFE4AA'),
  steelDark: c('#3C3C4C'),
  steel: c('#777482'),
  steelLight: c('#AAA4A6'),
  steelHi: c('#E6D8C4'),
  wood: c('#8B5F46'),
  woodLight: c('#AA7A50'),
  woodDark: c('#5E3F36'),
  glass: c('#4E6688'),
  glassLight: c('#90A6BE'),
  lamp: c('#FFE2A0'),
  lampGlow: c('#F2A44C'),
  windowWarm: c('#FFD27A'),
  windowMid: c('#E8954A'),
  windowDim: c('#955A3C'),
  windowNight: c('#4A5676'),
  windowGlint: c('#E6B488'),
};

const GOLDEN_ROOFS = [
  // Slate and tar: warm gray in the low sun.
  roofRamp('#D9C3B0', '#A28F8A', '#5F5663', '#6B616D', '#473F4E', '#34303F'),
  // Verdigris copper on the old town's turrets.
  roofRamp('#AECAA2', '#709C86', '#3F5F5A', '#476963', '#2F4747', '#233537'),
  // Red brick under terracotta tiles: the commonest building in the quarter.
  roofRamp('#E8A584', '#AE6552', '#773F3C', '#834845', '#5A3033', '#432428'),
  // Ochre plaster.
  roofRamp('#E8C590', '#B48C60', '#7A5B48', '#86654E', '#5C4439', '#45322E'),
  // Sage plaster with green shutters.
  roofRamp('#CACA96', '#8F9569', '#5A614B', '#646B51', '#43493B', '#32362D'),
  // Cream stone.
  roofRamp('#F4E2C2', '#C3B39B', '#837669', '#8F8173', '#5F5751', '#47413F'),
];

/** Brick first, then plaster; slate and copper are accents. */
const BLITZ_WEIGHTS = [
  ROOF_MAROON,
  ROOF_MAROON,
  ROOF_MAROON,
  ROOF_MAROON,
  ROOF_MAROON,
  ROOF_MAROON,
  ROOF_PLUM,
  ROOF_PLUM,
  ROOF_PLUM,
  ROOF_CONCRETE,
  ROOF_CONCRETE,
  ROOF_CONCRETE,
  ROOF_SLATE,
  ROOF_SLATE,
  ROOF_SLATE,
  ROOF_OLIVE,
  ROOF_OLIVE,
  ROOF_TEAL,
  ROOF_MAROON,
  ROOF_PLUM,
  ROOF_CONCRETE,
];

export const GOLDEN: CityStyle = { pal: GOLDEN_PAL, roofs: GOLDEN_ROOFS, weights: BLITZ_WEIGHTS };

/** The overcast wet afternoon: the golden palette cooled, grayed and darkened. */
function overcast(v: Color): Color {
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const avg = (r + g + b) / 3;
  // Less color, a cool cast, a step darker.
  const f = (x: number): number => avg + (x - avg) * 0.62;
  const o =
    (Math.round(f(r) * 0.84) << 16) | (Math.round(f(g) * 0.86) << 8) | Math.round(f(b) * 0.92);
  return mixc(o, c('#3A4660'), 0.12);
}

const KEEP_LIT = new Set([
  'lamp',
  'lampGlow',
  'windowWarm',
  'windowMid',
  'windowDim',
  'paint',
  'paintBright',
  'paintWorn',
  'paintGold',
  'paintGoldWorn',
  'kerbCoral',
  'kerbCoralDark',
  'kerbIvory',
  'kerbIvoryDark',
]);

const RAIN_PAL: CityStyle['pal'] = Object.fromEntries(
  Object.entries(GOLDEN_PAL).map(([k, v]) => [k, KEEP_LIT.has(k) ? v : overcast(v!)]),
) as CityStyle['pal'];
// Dark glass against an overcast sky, and the gloom's water.
RAIN_PAL.windowNight = c('#36405A');
RAIN_PAL.windowGlint = c('#8A98B2');
RAIN_PAL.waterGlint = c('#8A9CB6');
RAIN_PAL.waterSpark = c('#C8D4E2');
RAIN_PAL.steelHi = c('#C9CCD2');

const RAIN_ROOFS = GOLDEN_ROOFS.map((r) => ({
  hi: overcast(r.hi),
  par: overcast(r.par),
  base: overcast(r.base),
  alt: overcast(r.alt),
  dark: overcast(r.dark),
  deep: overcast(r.deep),
}));

export const OVERCAST: CityStyle = { pal: RAIN_PAL, roofs: RAIN_ROOFS, weights: BLITZ_WEIGHTS };

/** Wet look of the rainy afternoon: the puddles mirror a pale overcast sky. */
export const WET_DAY: WetStyle = {
  darkGround: 0.18,
  darkRaised: 0.08,
  saturate: 0.14,
  cast: c('#34405A'),
  castAmount: 0.1,
  puddle: c('#6E7C92'),
  ripple: c('#A4B2C6'),
  puddleLip: c('#2C3242'),
  puddleEdge: c('#8896AA'),
  gutterShare: 0.55,
  spotShare: 0.08,
  reflect: 0.6,
  reflectPuddle: 0.9,
  glint: c('#B6C2D4'),
  glintRate: 0.004,
};

const TINTS: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.7, 0.32],
  [0.3, 0.86, 0.95],
  [1.0, 0.44, 0.36],
  [0.64, 0.5, 0.96],
  [1.0, 0.78, 0.38],
  [0.96, 0.94, 0.84],
];

function litWith(gain: readonly number[], lift: readonly number[]) {
  return (v: Color, step: number, tint: number): Color => {
    const t = TINTS[tint] ?? TINTS[0]!;
    const g = gain[step] ?? gain[gain.length - 1]!;
    const l = lift[step] ?? lift[lift.length - 1]!;
    const r = (v >> 16) & 255;
    const gr = (v >> 8) & 255;
    const b = v & 255;
    const lum = (r * 3 + gr * 5 + b * 2) / 10;
    const k = g * Math.max(0.2, 1.2 - lum / 200);
    const nr = Math.min(255, Math.round(r * (1 + k * t[0]) + l * t[0]));
    const ng = Math.min(255, Math.round(gr * (1 + k * t[1]) + l * t[1]));
    const nb = Math.min(255, Math.round(b * (1 + k * t[2]) + l * t[2]));
    return (nr << 16) | (ng << 8) | nb;
  };
}

/** Lamps barely tell against the last daylight; the rain's gloom lets them show. */
export const litGolden = litWith([0, 0.07, 0.14, 0.22], [0, 3, 6, 10]);
export const litOvercast = litWith([0, 0.12, 0.25, 0.4], [0, 5, 10, 16]);

const shade =
  (kr: number, kg: number, kb: number, ar: number, ag: number, ab: number) =>
  (v: Color): Color => {
    const r = (v >> 16) & 255;
    const g = (v >> 8) & 255;
    const b = v & 255;
    return (
      (Math.round(r * kr + ar) << 16) | (Math.round(g * kg + ag) << 8) | Math.round(b * kb + ab)
    );
  };

/** Golden hour: long blue-violet shadows, firm on the ground, gentler across the road. */
export const goldenShadeGround = shade(0.6, 0.62, 0.74, 6, 8, 22);
export const goldenShadeRoad = shade(0.78, 0.8, 0.88, 4, 5, 14);
export const goldenShadeDeep = shade(0.68, 0.7, 0.8, 4, 6, 16);
/** Overcast light throws soft, short shadows: one gentle step. */
export const overcastShadeGround = shade(0.74, 0.76, 0.82, 4, 5, 12);
export const overcastShadeRoad = shade(0.86, 0.87, 0.9, 2, 3, 8);
export const overcastShadeDeep = shade(0.78, 0.8, 0.86, 3, 4, 10);
