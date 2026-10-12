import { col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';

/**
 * The nature biomes' daylight palette. Every ramp runs from a blue-violet shadow to a warm
 * highlight; nothing is pure gray or pure black. Weather (rain, frost, snowfall) is a grade
 * applied afterwards to the finished picture, so the two weathers of a track are the same
 * drawing under different light.
 */

const ramp = (...hex: string[]): Color[] => hex.map(col);

export const NAT = {
  // Foliage families, darkest first.
  oak: [
    ramp('#142A26', '#1C3C2E', '#275234', '#336A38', '#46843E', '#64A048', '#8CBC58'),
    ramp('#162A22', '#203E2A', '#2C5630', '#3A6E34', '#52883A', '#72A444', '#9CC056'),
    ramp('#18282A', '#203A32', '#2A5038', '#36683E', '#4A8044', '#6A9A50', '#90B862'),
  ],
  birch: [
    ramp('#1C3226', '#2A4A2C', '#3A6632', '#4E8438', '#6AA040', '#8EBC4C', '#B8D464'),
    ramp('#203426', '#30502C', '#426C30', '#588A36', '#78A63E', '#9EC24C', '#C6DA68'),
  ],
  alder: [ramp('#13282A', '#1A3A34', '#24503A', '#2E6640', '#3E7E48', '#589852', '#7CB262')],
  redwood: [
    ramp('#10201E', '#162E26', '#1E3E2C', '#285034', '#34643A', '#4A7C44', '#689A50'),
    ramp('#121E22', '#18302C', '#204032', '#2A5238', '#36663E', '#4C7E48', '#6A9856'),
  ],
  pine: [
    ramp('#0E1E22', '#14302C', '#1A4034', '#22523A', '#2C6442', '#3E7A4C', '#5A9258'),
    ramp('#101C26', '#162C30', '#1C3C38', '#244E3E', '#2E6046', '#407650', '#5C8E5E'),
  ],
  barkOak: ramp('#231A1C', '#33262A', '#46342E', '#5C4636', '#745A42', '#8C7254'),
  barkBirch: ramp('#2E2A2E', '#8A8890', '#B4B2B4', '#D2CEC6', '#E8E2D4', '#F6F0E2'),
  barkRed: ramp('#34191A', '#522722', '#73392A', '#944E34', '#B26642', '#CA8458'),
  barkPine: ramp('#1E1618', '#2E2222', '#40302A', '#544034', '#6A5240'),

  // Forest floor.
  mossDeep: col('#1C3428'),
  mossDark: col('#26442E'),
  moss: col('#325834'),
  mossLight: col('#43703A'),
  mossHi: col('#5E8C44'),
  grass: col('#3C6636'),
  grassLight: col('#54803E'),
  litterDark: col('#363626'),
  litter: col('#46422E'),
  litterLight: col('#5E5636'),
  litterHi: col('#8A6A40'),
  leafRed: col('#8A4A2C'),
  leafGold: col('#B08A3C'),
  fernDark: col('#24502E'),
  fern: col('#3A7438'),
  fernLight: col('#5C9A46'),
  fernHi: col('#86BC5A'),
  soilDark: col('#2E2422'),
  soil: col('#43342C'),
  root: col('#52402F'),
  rootLight: col('#6E5840'),

  // Dirt road and verge.
  dirtDeep: col('#5A4230'),
  dirtDark: col('#6C503A'),
  dirt: col('#86664A'),
  dirtLight: col('#9E7E5A'),
  dirtHi: col('#B8986E'),
  pebble: col('#A89A86'),
  pebbleDark: col('#70665A'),
  gravel: col('#7A7064'),
  gravelLight: col('#958A7A'),
  gravelDark: col('#5E564C'),

  // Mud: darker, warmer, wet.
  mudDeep: col('#2E1E14'),
  mudDark: col('#3E2918'),
  mud: col('#5A3A22'),
  mudLight: col('#6E4A2C'),
  mudRidge: col('#80583A'),
  mudWater: col('#4A3E30'),
  mudSheen: col('#7A7064'),
  mudGlint: col('#B8B4A8'),

  // Asphalt: the stage. Cool slate, never black.
  asphaltDeep: col('#2A3040'),
  asphaltDark: col('#333A4A'),
  asphalt: col('#3C4456'),
  asphaltLight: col('#465064'),
  asphaltSpeck: col('#586378'),
  patch: col('#3A3E48'),
  crack: col('#262A32'),
  lineWhite: col('#E6E2D2'),
  lineWorn: col('#B4B2AA'),
  lineYellow: col('#E2B44A'),
  lineYellowWorn: col('#B08E48'),

  // Water.
  waterDeep: col('#1E4448'),
  waterDark: col('#265450'),
  water: col('#2F6460'),
  waterLight: col('#3C7668'),
  shallow: col('#4C7E5E'),
  shallowLight: col('#62905E'),
  waterGlint: col('#8CC4BC'),
  waterSpark: col('#DDF4EC'),
  foam: col('#C4DED6'),
  lily: col('#3C7A3A'),
  lilyLight: col('#5E9A48'),
  lilyFlower: col('#F0D6E2'),

  // Wood, stone, metal, paint.
  woodDeep: col('#2E2018'),
  woodDark: col('#45301F'),
  wood: col('#634529'),
  woodLight: col('#825E38'),
  woodHi: col('#A07A4A'),
  woodPale: col('#BE9C6A'),
  stoneDeep: col('#2E3036'),
  stoneDark: col('#464A50'),
  stone: col('#5E6266'),
  stoneLight: col('#7A7E80'),
  stoneHi: col('#9C9E9C'),
  stoneMoss: col('#4E6A44'),
  steelDark: col('#2E3440'),
  steel: col('#5A6474'),
  steelLight: col('#8A96A6'),
  steelHi: col('#C0CAD4'),
  rust: col('#8A4A2E'),
  red: col('#C8443E'),
  redDark: col('#7E2A2E'),
  ivory: col('#F2ECDA'),
  ivoryDark: col('#BCB6A6'),
  yellow: col('#E8B444'),
  yellowDark: col('#9A7030'),
  orange: col('#E8742E'),
  orangeDark: col('#9E4624'),
  ink: col('#14161E'),
  roofSlate: col('#4A5262'),
  roofSlateLight: col('#6A7486'),
  roofSlateDark: col('#323848'),
  roofMoss: col('#4C6040'),
  windowWarm: col('#FFD88A'),
  windowMid: col('#E89A4A'),
  windowDim: col('#2A3040'),
  glow: col('#C8F0A0'),
  glowHi: col('#F4FFE0'),
  mushroomCap: col('#C4483A'),
  mushroomCapHi: col('#E8806A'),
  mushroomGlow: col('#7CE8C8'),
  mushroomGlowHi: col('#D8FFF2'),
  mushroomStem: col('#E4DCC8'),
  flowerWhite: col('#EEEAE0'),
  flowerYellow: col('#E8CC52'),
  flowerViolet: col('#9A84D0'),
  reed: col('#7E8A4A'),
  reedLight: col('#A4AE62'),
  reedDark: col('#56602E'),
  cattail: col('#5E3E26'),
  sawdust: col('#C8A87A'),
  sawdustLight: col('#DCC092'),
  sawdustDark: col('#A88A60'),
} as const;

export const lighten = (c: Color, t: number): Color => mixc(c, col('#FFF6DE'), t);
export const darken = (c: Color, t: number): Color => mixc(c, col('#121428'), t);

/** Ground in the shade of a canopy or a mass: darker and toward blue-violet. */
export function shadeDay(c: Color, k = 1): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const f = 1 - 0.32 * k;
  const nr = Math.round(r * f + 4 * k);
  const ng = Math.round(g * (f + 0.02 * k) + 6 * k);
  const nb = Math.round(b * (f + 0.1 * k) + 18 * k);
  return (Math.min(255, nr) << 16) | (Math.min(255, ng) << 8) | Math.min(255, nb);
}

/** A soft sunlit lift for clearings and the light shafts between trees. */
export function sunDay(c: Color, k = 1): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const nr = Math.round(r * (1 + 0.16 * k) + 10 * k);
  const ng = Math.round(g * (1 + 0.13 * k) + 8 * k);
  const nb = Math.round(b * (1 + 0.04 * k) + 2 * k);
  return (Math.min(255, nr) << 16) | (Math.min(255, ng) << 8) | Math.min(255, nb);
}
