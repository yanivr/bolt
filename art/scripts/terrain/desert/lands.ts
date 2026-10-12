import { fbm, smooth, vnoise } from './noise.js';
import { GRADE_CALICHE, GRADE_DUNE, ROCK_SANDSTONE, ROCK_TERRA, SAND_CANYON, SAND_DUNE, SAND_PALE, SAND_RED } from './palette.js';
import type { Region, TerrainSpec } from './spec.js';

/**
 * The land of each desert track, in world pixels: where its dunes, flats, rubble and slopes
 * are. Positions come from the track files' design points through the same scale and offset
 * the authoring kit applies (Dust Devil: 1.06 and (-27.6, -25.6); Canyon Switch: 1.1 and
 * (71, 174)), so they stay beside the road they describe.
 */

const gauss = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number =>
  Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));

/** Dust Devil design point to world. */
export const dd = (x: number, y: number): { x: number; y: number } => ({
  x: x * 1.06 - 27.6,
  y: y * 1.06 - 25.6,
});

/** Canyon Switch design point to world. */
export const cs = (x: number, y: number): { x: number; y: number } => ({
  x: x * 1.1 + 71,
  y: y * 1.1 + 174,
});

const DIP = dd(1950, 1020);
const FLATS = dd(1990, 1480);
const ELBOW = dd(3480, 1350);
const WASH = dd(1950, 770);

export const DUST_DEVIL_LAND: TerrainSpec = {
  sand: SAND_DUNE,
  sandAlt: SAND_RED,
  rock: ROCK_TERRA,
  grade: GRADE_DUNE,
  prevailing: { x: 0.995, y: 0.1 },
  duneLength: 260,
  duneHeight: 26,
  region(x: number, y: number, r: Region): void {
    const n = fbm(x, y, 620, 11, 3);
    // Dune fields: the far south, the north-east and the west, broken up by noise.
    let dune = smooth(0.42, 0.66, n);
    dune = Math.max(dune, smooth(2350, 2650, y) * 0.9);
    dune = Math.max(dune, smooth(3650, 4050, x) * smooth(0.3, 0.55, n));
    // The dust devil flats are a playa: no dunes, pale silt.
    const flats = gauss(x, y, FLATS.x, FLATS.y, 640, 250);
    const playa = smooth(0.42, 0.62, flats + (vnoise(x, y, 90, 12) - 0.5) * 0.3);
    dune *= 1 - smooth(0.2, 0.5, flats);
    // No dunes in the dip or along the wash.
    const dip = gauss(x, y, DIP.x, DIP.y, 360, 260);
    dune *= 1 - smooth(0.25, 0.6, dip);
    const wash = gauss(x, y, WASH.x, WASH.y, 420, 120);
    dune *= 1 - smooth(0.2, 0.5, wash);
    r.dune = dune;
    r.playa = playa;
    r.rubble =
      smooth(0.25, 0.7, gauss(x, y, ELBOW.x, ELBOW.y, 380, 600)) * 0.7 +
      smooth(0.6, 0.8, fbm(x, y, 260, 13, 2)) * 0.5 +
      smooth(0.3, 0.7, dip) * 0.35;
    r.brush = (0.25 + 0.5 * smooth(0.45, 0.7, fbm(x, y, 300, 14, 2))) * (1 - playa) + wash * 0.6;
    r.tone = playa * 0.15 - smooth(0.3, 0.8, dip) * 0.35;
    r.terrace = 0;
    r.streak = 0;
    r.alt = 0.8 * (1 - playa) * (1 - smooth(0.3, 0.6, dip));
  },
  height(x: number, y: number): number {
    const swell = (fbm(x, y, 820, 21, 3) - 0.5) * 46;
    const dip = -95 * gauss(x, y, DIP.x, DIP.y, 330, 250);
    const rise = 40 * gauss(x, y, dd(2900, 380).x, dd(2900, 380).y, 900, 260);
    const climb = 30 * gauss(x, y, dd(500, 1100).x, dd(500, 1100).y, 260, 700);
    return swell + dip + rise + climb;
  },
};

const PLATEAU_Y = cs(0, 380).y;
const FLOOR = cs(1900, 1960);
const DESCENT = cs(520, 1100);
const SWITCHBACK = cs(3150, 1250);

export const CANYON_SWITCH_LAND: TerrainSpec = {
  sand: SAND_CANYON,
  sandAlt: SAND_PALE,
  rock: ROCK_SANDSTONE,
  grade: GRADE_CALICHE,
  prevailing: { x: -0.93, y: 0.36 },
  duneLength: 220,
  duneHeight: 20,
  region(x: number, y: number, r: Region): void {
    const n = fbm(x, y, 560, 31, 3);
    const plateau = 1 - smooth(PLATEAU_Y + 260, PLATEAU_Y + 560, y);
    const floor = gauss(x, y, FLOOR.x, FLOOR.y + 120, 1500, 380);
    const south = smooth(FLOOR.y + 300, FLOOR.y + 520, y);
    // Dunes only in the low south and in the lee of the plateau rocks.
    r.dune = Math.max(south * smooth(0.35, 0.6, n), smooth(0.55, 0.72, n) * 0.6 * (1 - plateau));
    r.playa = 0;
    r.rubble =
      plateau * (0.35 + 0.4 * smooth(0.45, 0.65, fbm(x, y, 180, 32, 2))) +
      floor * 0.35 +
      smooth(0.3, 0.7, gauss(x, y, SWITCHBACK.x, SWITCHBACK.y, 520, 640)) * 0.5;
    r.brush = (0.2 + 0.4 * smooth(0.5, 0.7, fbm(x, y, 280, 33, 2))) * (1 - plateau * 0.6);
    // The plateau is bleached; the canyon floor and the low south lie a step down.
    r.tone = plateau * 0.35 - floor * 0.7 - south * 0.45;
    r.terrace =
      smooth(0.3, 0.6, gauss(x, y, DESCENT.x, DESCENT.y, 380, 700)) * 0.9 +
      smooth(0.3, 0.6, gauss(x, y, SWITCHBACK.x, SWITCHBACK.y, 450, 600)) * 0.9;
    r.streak = plateau;
    r.alt = 0.75 * plateau;
  },
  height(x: number, y: number): number {
    const swell = (fbm(x, y, 480, 41, 3) - 0.5) * 50;
    // The land falls from the plateau in the north to the canyon floor in the south.
    const fall = -smooth(PLATEAU_Y + 200, FLOOR.y, y) * 220;
    return swell + fall;
  },
};
