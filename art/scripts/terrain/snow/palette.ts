import { col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { RoadPalette } from '../forest/road.js';

/**
 * The snow biome's palette. Snow is never pure white: lit powder is a pale warm-white, its
 * shade a clear blue-violet, so the ground has form without glare. Packed road snow is grayer
 * and cooler than powder and carries blue tire grooves; ice is cyan, with hard white streaks;
 * the plowed lane is dark tarmac. Each reads apart from the others at a glance.
 */

export const SNOW = {
  powderHi: col('#F4F6FA'),
  powder: col('#E4EAF3'),
  powderMid: col('#D2DAE8'),
  powderShade: col('#B4C0DA'),
  powderDeep: col('#94A2C6'),
  drift: col('#C2CCE2'),
  sparkle: col('#FFFFFF'),
  crust: col('#DCE2EC'),
  rock: col('#4E4C58'),
  rockLight: col('#6C6A76'),
  rockDark: col('#34323E'),
  rockHi: col('#8A8894'),
  tarmacDeep: col('#2A2D35'),
  tarmacDark: col('#33373F'),
  tarmac: col('#3C4049'),
  tarmacLight: col('#474C56'),
  salt: col('#7E848E'),
  slush: col('#A8B2C2'),
  slushDark: col('#8692A4'),
  iceDeep: col('#4A82AA'),
  iceDark: col('#689EC2'),
  ice: col('#8ABCD6'),
  iceLight: col('#A8D2E4'),
  iceStreak: col('#ECF8FE'),
  iceCrack: col('#3A6890'),
  iceSnow: col('#CCDDEA'),
  pole: col('#E8742E'),
  poleDark: col('#9E4624'),
};

export const SNOW_ROAD: RoadPalette = {
  asphalt: [SNOW.tarmacDeep, SNOW.tarmacDark, SNOW.tarmac, SNOW.tarmacLight, SNOW.salt],
  line: col('#E2DED0'),
  lineWorn: col('#A8A8A6'),
  center: col('#D8AE48'),
  centerWorn: col('#A08848'),
  dirt: [col('#5A4A3E'), col('#6C5A4A'), col('#84705C'), col('#9A8670'), col('#B09C84')],
  pebble: col('#A09A94'),
  pebbleDark: col('#6E6A68'),
  mud: [col('#2E2622'), col('#3C302A'), col('#4C3E34'), col('#5E4C40'), col('#6E5A4C')],
  mudWater: col('#5A6270'),
  mudSheen: col('#8C98A8'),
  mudGlint: col('#C8D4E0'),
  verge: [SNOW.slushDark, SNOW.slush, col('#C2CAD6')],
  snow: [col('#8C98B6'), col('#AEB8CC'), col('#C6CEDC'), col('#D4DBE6'), col('#E6EBF2')],
  ice: [SNOW.iceDeep, SNOW.iceDark, SNOW.ice, SNOW.iceLight, SNOW.iceStreak, SNOW.iceCrack],
  edgeGround: () => SNOW.powderMid,
};

/** Shade on snow is blue, not gray. */
export function shadeSnow(c: Color, k = 1): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const f = 1 - 0.26 * k;
  const nr = Math.round(r * f - 6 * k);
  const ng = Math.round(g * (f + 0.02 * k) - 2 * k);
  const nb = Math.round(b * (f + 0.12 * k) + 14 * k);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  return (clamp(nr) << 16) | (clamp(ng) << 8) | clamp(nb);
}

export const towardSky = (c: Color, t: number): Color => mixc(c, col('#C8D6EC'), t);
