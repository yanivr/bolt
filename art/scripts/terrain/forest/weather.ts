import type { Color } from '../canvas.js';
import { mixc } from '../canvas.js';
import type { Grade } from './finish.js';

/**
 * Weather as light. A course's two weathers are one drawing under two lights: the grade below
 * maps every finished color (ground, overlays, loop frames alike), and a few parameters change
 * how the light falls (shadow length and strength, sun flecks) and how wet the ground is drawn.
 */

export type WeatherLook = {
  grade: Grade;
  /** Shadow length per unit of height. */
  shadowK: number;
  /** Strength of cast shadows (overcast light is soft). */
  shadowStrength: number;
  sunShafts: number;
};

function sat(c: Color, k: number, v: number, tr: number, tg: number, tb: number): Color {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const l = r * 0.3 + g * 0.55 + b * 0.15;
  // Bright paint (edge lines, dashes, snow) keeps most of its value, so it stays the most
  // readable thing on the road under any sky.
  const keep = Math.max(0, Math.min(1, (l - 150) / 90));
  const vv = v + (1 - v) * keep * 0.75;
  const f = (x: number, t: number): number => Math.max(0, Math.min(255, Math.round((l + (x - l) * k) * vv + t)));
  return (f(r, tr) << 16) | (f(g, tg) << 8) | f(b, tb);
}

/** Pulls the extremes toward a haze color: lower contrast, as in falling snow. */
function haze(c: Color, toward: Color, t: number): Color {
  return mixc(c, toward, t);
}

export function weatherLook(presetId: string): WeatherLook {
  switch (presetId) {
    case 'forest_rain':
      return {
        grade: (c) => sat(c, 1.12, 0.76, -3, 1, 8),
        shadowK: 0.35,
        shadowStrength: 0.65,
        sunShafts: 0,
      };
    case 'forest_heavy_rain':
      return {
        grade: (c) => sat(c, 1.14, 0.66, -5, 0, 11),
        shadowK: 0.3,
        shadowStrength: 0.55,
        sunShafts: 0,
      };
    case 'snow_clear_frost':
      // Crisp blue morning: long shadows, cool shade, a touch of warmth in the light.
      return {
        grade: (c) => sat(c, 1.04, 1, 0, 0, 3),
        shadowK: 0.95,
        shadowStrength: 1,
        sunShafts: 0,
      };
    case 'snow_snowfall':
      return {
        grade: (c) => haze(sat(c, 0.86, 0.97, 0, 2, 6), 0xd2d8e2, 0.16),
        shadowK: 0.4,
        shadowStrength: 0.5,
        sunShafts: 0,
      };
    default:
      return { grade: (c) => c, shadowK: 0.55, shadowStrength: 1, sunShafts: 90 };
  }
}
