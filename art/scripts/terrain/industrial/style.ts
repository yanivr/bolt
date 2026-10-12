import { col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { CityStyle } from '../city/palette.js';
import { roofRamp } from '../city/palette.js';
import type { WetStyle } from '../city/wet.js';

/**
 * Steel Circuit's night palette. The industrial biome reuses the city's oblique machinery
 * (scene, solids, lighting, the barrier), so it is expressed as a city style: the shared
 * palette's slots recolored for a steelworks, six roof families of cladding, and the colors
 * the industrial painters use on their own (plate floors, hazard paint, molten metal).
 *
 * Light at night: orange sodium on the yard roads (tint 0), cold mercury vapor inside the halls
 * (tint 5), the smelter's molten orange (tint 2) and hazard amber (tint 4).
 */

const c = col;

export const IND = {
  // Riveted plate floors: lighter and cooler than asphalt, so the halls read as metal.
  plate: c('#4E5A6E'),
  plateLight: c('#5B687C'),
  plateDark: c('#414B5D'),
  plateSeam: c('#323A4A'),
  plateRivet: c('#7C8AA0'),
  plateTread: c('#56637A'),
  // Hazard paint.
  hazardYellow: c('#E8B428'),
  hazardYellowDim: c('#A8821E'),
  hazardBlack: c('#1B1A22'),
  // Magnetic strips: cyan-steel segments, distinct from anything else on the floor.
  magnetBase: c('#2C3F5C'),
  magnetBar: c('#5FA8D8'),
  magnetHi: c('#B6EAFF'),
  magnetEdge: c('#1C2840'),
  // Oil: glossy dark pools with a lit rim and a sheen.
  oil: c('#141220'),
  oilMid: c('#1E1A2E'),
  oilRim: c('#4A4466'),
  oilSheen: c('#7A6AA8'),
  oilSheenHi: c('#C9B6F2'),
  // Steam vent grates.
  grate: c('#262C38'),
  grateBar: c('#4A5464'),
  grateHi: c('#7E8A9C'),
  // Molten metal and furnace light.
  moltenHi: c('#FFF2B0'),
  molten: c('#FFB040'),
  moltenMid: c('#F06A24'),
  moltenDark: c('#A0301E'),
  // Concrete apron and dock granite.
  concrete: c('#3A3F4E'),
  concreteAlt: c('#41465A'),
  concreteSeam: c('#2E3240'),
  granite: c('#565262'),
  graniteLight: c('#68637A'),
  graniteDark: c('#45414F'),
  // Mercury-vapor light, cold green-white.
  mercury: c('#D6F2E4'),
  mercuryGlow: c('#8FD8C0'),
  rust: c('#8A4A34'),
  rustDark: c('#5E3428'),
} as const;

const PAL_NIGHT: CityStyle['pal'] = {
  asphalt: c('#33384A'),
  asphaltDark: c('#2C3142'),
  asphaltLight: c('#3B4154'),
  asphaltSpeck: c('#4A5064'),
  asphaltRubber: c('#262A3A'),
  patch: c('#2A2F40'),
  patchEdge: c('#222636'),
  // The barrier: concrete with hazard paint where the city has red and white.
  kerbCoral: IND.hazardYellow,
  kerbCoralDark: IND.hazardYellowDim,
  kerbIvory: IND.hazardBlack,
  kerbIvoryDark: c('#121118'),
  coral: IND.hazardYellow,
  ivory: c('#2A2830'),
  // Granite setts on the dock.
  mortar: c('#2C2A36'),
  cobbleDark: c('#4A4656'),
  cobble: c('#57526A'),
  cobbleLight: c('#635E74'),
  cobbleHi: c('#7A7488'),
  sett: c('#6A6678'),
  settLight: c('#7C788A'),
  // Ground behind the walls: concrete aprons.
  street: c('#2A2E3C'),
  streetDark: c('#232633'),
  streetMark: IND.hazardYellowDim,
  yard: c('#30343F'),
  yardAlt: c('#363A46'),
  plaza: c('#3A3F4E'),
  plazaAlt: c('#41465A'),
  plazaLine: c('#2E3240'),
  water: c('#141C30'),
  waterDeep: c('#0F1526'),
  waterLight: c('#1B2842'),
  waterGlint: c('#C9884A'),
  waterSpark: c('#FFD08A'),
};

/** Cladding families: steel blue, rust, olive drab, slate, red oxide, galvanized. */
const ROOFS = [
  roofRamp('#7A8AA6', '#4C5A78', '#2C3650', '#323D58', '#222A40', '#191F32'),
  roofRamp('#A8705A', '#73473C', '#4A2E2C', '#523431', '#36211F', '#281817'),
  roofRamp('#8A9070', '#5A604A', '#3A3F32', '#41463A', '#2B2F27', '#20231E'),
  roofRamp('#7E8294', '#555A6C', '#363A4A', '#3C4152', '#282B38', '#1E202A'),
  roofRamp('#A65A50', '#723E3C', '#4C2A2E', '#553033', '#381F24', '#2A171B'),
  roofRamp('#A2A8B4', '#70788A', '#474E5E', '#4E5566', '#343A48', '#272B36'),
];

export const NIGHT_STYLE: CityStyle = {
  pal: PAL_NIGHT,
  roofs: ROOFS,
  weights: [0, 0, 0, 5, 5, 5, 3, 3, 1, 1, 2, 2, 4, 0, 5, 3],
};

/** Factory rain: the same works a step darker and colder before the wet pass. */
function rainy(v: Color): Color {
  return mixc(v, c('#141A2C'), 0.12);
}
export const RAIN_STYLE: CityStyle = {
  pal: Object.fromEntries(
    Object.entries(PAL_NIGHT).map(([k, v]) => [k, rainy(v!)]),
  ) as CityStyle['pal'],
  roofs: ROOFS.map((r) => ({
    hi: rainy(r.hi),
    par: rainy(r.par),
    base: rainy(r.base),
    alt: rainy(r.alt),
    dark: rainy(r.dark),
    deep: rainy(r.deep),
  })),
  weights: NIGHT_STYLE.weights,
};

export const WET_FACTORY: WetStyle = {
  darkGround: 0.24,
  darkRaised: 0.1,
  saturate: 0.16,
  cast: c('#141C34'),
  castAmount: 0.14,
  puddle: c('#26324E'),
  ripple: c('#566A94'),
  puddleLip: c('#181D2C'),
  puddleEdge: c('#3E4C70'),
  gutterShare: 0.55,
  spotShare: 0.09,
  reflect: 0.65,
  reflectPuddle: 0.95,
  glint: c('#8696B8'),
  glintRate: 0.004,
};

export const TINT_SODIUM = 0;
export const TINT_MOLTEN = 2;
export const TINT_AMBER = 4;
export const TINT_MERCURY = 5;
