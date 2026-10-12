import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Backstreet Blitz. A downtown grid: square corners, one long boulevard and a cobbled old
 * quarter. The fast boulevard runs east along the bottom of the screen; Signal Street climbs
 * north across the tram line, where a level crossing comes down on a fixed timetable. Two
 * alleys: Laundry Lane slips behind the tram stop and skips the crossing, the corner and Signal
 * Street; Bakers Row runs straight down the old town where the main road jinks round the market,
 * narrow and slalomed by barricades.
 */
export const CITY_02: TrackDefinition = defineTrack({
  id: 'city_02',
  name: 'Backstreet Blitz',
  biome: 'city',
  character: 'Narrow shortcut alleys, barricades, tram crossing',
  lengthClass: 'short',
  edges: 'walled',
  offroadSurface: 'cobble',
  windExposure: 0,
  weatherPresetIds: ['city_clear_day', 'city_rain_day'],
  surfaceMix: { asphalt: 0.6, cobble: 0.4 },
  landmarks: ['Tram stop', 'Clock market', 'Laundry lines', 'Old town gate', 'Harbor silos'],
  scale: 0.7,
  margin: 340,
  checkpointCount: 10,
  start: { x: 1000, y: 1900 },
  main: {
    surface: 'asphalt',
    shoulder: 10,
    shoulderSurface: 'cobble',
    corners: [
      c(500, 1900, 70, 132, 'asphalt'),
      c(2300, 1900, 70, 132),
      c(2300, 1350, 60, 122),
      c(1850, 1350, 60, 120, 'cobble'),
      c(1850, 1000, 60, 120, 'asphalt'),
      c(2600, 1000, 80, 128, 'asphalt'),
      c(2600, 350, 80, 128),
      c(1650, 350, 55, 118, 'cobble'),
      c(1450, 600, 55, 112),
      c(900, 600, 55, 112),
      c(900, 350, 55, 112),
      c(500, 350, 70, 118),
      c(500, 930, 90, 118),
      c(710, 1120, 90, 118),
      c(710, 1430, 90, 118),
      c(500, 1620, 90, 118),
    ],
  },
  shortcuts: [
    {
      id: 'laundry_lane',
      signName: 'Laundry Lane',
      risk: 'Half the width of the boulevard, cobbled, crates at both bends',
      surface: 'cobble',
      shoulder: 0,
      shoulderSurface: 'cobble',
      leave: { x: 1080, y: 1900 },
      rejoin: { x: 2020, y: 1350 },
      corners: [
        c(1180, 1770, 0, 70),
        c(1290, 1600, 60, 68),
        c(2060, 1600, 60, 68),
        c(2060, 1480, 0, 70),
      ],
    },
    {
      id: 'bakers_row',
      signName: 'Bakers Row',
      risk: 'Straight but barely two cars wide, with barricades to weave round',
      surface: 'cobble',
      shoulder: 0,
      shoulderSurface: 'cobble',
      leave: { x: 500, y: 900 },
      rejoin: { x: 500, y: 1660 },
      corners: [c(500, 1010, 0, 78), c(500, 1550, 0, 78)],
    },
  ],
  features: (k) => {
    const bakers = (y: number, lateral: number) => k.at('bakers_row', { x: 500, y }, lateral);
    const barricade = (id: string, y: number, side: -1 | 1) => {
      const a = bakers(y, side * 39);
      const b = bakers(y, side * 19);
      return { ...k.wall(id, 'barricade', [a, b], 12), telegraph: `${id}_stripes` };
    };
    const crossing = k.crossing(
      'tram_crossing',
      'Signal Street tram crossing',
      'main',
      { x: 2300, y: 1700 },
      {
        periodSeconds: 14,
        offsetSeconds: 4,
        warnSeconds: 1.6,
        activeSeconds: 2.6,
      },
      [140, 520],
    );
    return {
      walls: [
        barricade('bakers_barricade_1', 1140, -1),
        barricade('bakers_barricade_2', 1280, 1),
        barricade('bakers_barricade_3', 1420, -1),
      ],
      obstacles: [
        k.obstacle(
          'laundry_crate_1',
          'crate',
          k.at('laundry_lane', { x: 1290, y: 1600 }, -30, -40),
          9,
        ),
        k.obstacle(
          'laundry_crate_2',
          'crate',
          k.at('laundry_lane', { x: 2060, y: 1600 }, -30, -40),
          9,
        ),
        k.obstacle('gate_bollard_l', 'bollard', k.at('main', { x: 1200, y: 600 }, -52), 5),
        k.obstacle('gate_bollard_r', 'bollard', k.at('main', { x: 1200, y: 600 }, 52), 5),
      ],
      hazards: [crossing],
      anchors: [
        k.anchor('tram_line', 'tram_line', crossing.kind === 'crossing' ? crossing.railPath : []),
        k.anchor('bakers_barricade_1_stripes', 'warning', [bakers(1100, -28)], 'hazard stripes'),
        k.anchor('bakers_barricade_2_stripes', 'warning', [bakers(1240, 28)], 'hazard stripes'),
        k.anchor('bakers_barricade_3_stripes', 'warning', [bakers(1380, -28)], 'hazard stripes'),
        k.anchor('laundry_lines', 'laundry_line', [
          k.at('laundry_lane', { x: 1600, y: 1600 }, -40),
          k.at('laundry_lane', { x: 1600, y: 1600 }, 40),
        ]),
        k.anchor('market_neon', 'neon', [k.at('main', { x: 2200, y: 1000 }, -80)], '#ff5fa2'),
        k.anchor('cafe_awning', 'awning', [k.at('main', { x: 1100, y: 600 }, 70)]),
        k.anchor('clock_market', 'landmark', [k.T({ x: 780, y: 1280 })]),
        k.anchor('old_town_gate', 'landmark', [k.at('main', { x: 1200, y: 600 })]),
        k.anchor('harbor_silos', 'landmark', [k.T({ x: 2900, y: 600 })]),
        k.anchor(
          'boulevard_lamps',
          'lamp',
          k.edge('main', { x: 600, y: 1900 }, { x: 2200, y: 1900 }, -1, 6, 160),
        ),
        k.anchor('traffic_light_signal', 'traffic_light', [k.at('main', { x: 1850, y: 1200 }, 70)]),
        k.anchor('billboard_market', 'billboard', [k.at('main', { x: 2600, y: 700 }, 80)]),
      ],
    };
  },
});
