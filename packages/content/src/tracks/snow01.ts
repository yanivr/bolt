import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Whiteout Pass. A mountain pass in three parts: a plowed asphalt sprint lane along the top,
 * between snow banks; a run of slippery switchbacks down the east slope on packed snow; and
 * the crossing of a frozen pond along the bottom, glass-smooth ice where only a straight line
 * is fast. Back up the west side on snow. The Snowmobile Trail cuts the switchbacks through
 * the pines: shorter, narrow, in soft snow.
 */
export const SNOW_01: TrackDefinition = defineTrack({
  id: 'snow_01',
  name: 'Whiteout Pass',
  biome: 'snow',
  character: 'Slippery turns, frozen pond and plowed sprint lanes',
  lengthClass: 'short',
  edges: 'open',
  offroadSurface: 'snow',
  windExposure: 0.45,
  weatherPresetIds: ['snow_clear_frost', 'snow_snowfall'],
  surfaceMix: { snow: 0.55, ice: 0.25, asphalt: 0.2 },
  landmarks: ['Ski lodge', 'Snow gun row', 'Frozen pond', 'Ice cave', 'Radio relay'],
  scale: 1.05,
  margin: 380,
  checkpointCount: 10,
  start: { x: 1200, y: 420 },
  main: {
    surface: 'snow',
    shoulder: 22,
    shoulderSurface: 'snow',
    corners: [
      c(520, 470, 220, 140, 'asphalt'),
      c(1950, 420, 240, 140, 'snow'),
      c(2560, 760, 140, 136),
      c(1950, 1060, 130, 134),
      c(2560, 1360, 140, 134),
      c(2300, 1780, 200, 140, 'ice'),
      c(700, 1800, 240, 140, 'snow'),
      c(800, 1180, 220, 136),
    ],
  },
  shortcuts: [
    {
      id: 'snowmobile_trail',
      signName: 'Snowmobile Trail',
      risk: 'Narrow soft snow through the pines, no snow banks to lean on',
      surface: 'snow',
      shoulder: 12,
      shoulderSurface: 'snow',
      leave: { x: 2250, y: 580 },
      rejoin: { x: 2470, y: 1560 },
      corners: [
        c(2520, 640, 0, 80),
        c(2940, 900, 200, 76),
        c(2940, 1300, 200, 76),
        c(2700, 1550, 0, 80),
      ],
    },
  ],
  features: (k) => {
    const pond = [
      { x: 900, y: 1620 },
      { x: 2200, y: 1600 },
      { x: 2350, y: 1950 },
      { x: 800, y: 2000 },
    ];
    const pines = (
      prefix: string,
      br: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
      side: -1 | 1,
      seed: number,
      gap = 50,
    ) => k.rowAlong(prefix, 'tree', br, from, to, side, gap, 80, 15, seed, 70);
    return {
      surfaceZones: [
        k.zone('frozen_pond', 'ice', k.poly(pond)),
        // Where the plow stopped: the lane's last stretch is packed snow again.
        k.zone(
          'unplowed',
          'snow',
          k.band('main', { x: 1500, y: 420 }, { x: 1900, y: 420 }, [-90, 90]),
        ),
      ],
      walls: [
        k.boundary('mountain', 70),
        // Snow banks either side of the plowed sprint lane.
        k.wallAlong(
          'bank_n',
          'snowbank',
          'main',
          { x: 700, y: 440 },
          { x: 1450, y: 420 },
          -1,
          6,
          18,
        ),
        k.wallAlong(
          'bank_s',
          'snowbank',
          'main',
          { x: 700, y: 440 },
          { x: 1450, y: 420 },
          1,
          6,
          18,
        ),
      ],
      obstacles: [
        ...pines('pines_slope_w', 'main', { x: 2300, y: 950 }, { x: 2300, y: 1250 }, 1, 301, 60),
        ...pines('pines_west', 'main', { x: 650, y: 1600 }, { x: 700, y: 800 }, -1, 302),
        ...pines('pines_west_in', 'main', { x: 800, y: 1550 }, { x: 900, y: 900 }, 1, 303, 80),
        ...pines(
          'trail_pines_w',
          'snowmobile_trail',
          { x: 2560, y: 660 },
          { x: 2720, y: 1530 },
          1,
          304,
          24,
        ),
        ...pines(
          'trail_pines_e',
          'snowmobile_trail',
          { x: 2560, y: 660 },
          { x: 2720, y: 1530 },
          -1,
          305,
          24,
        ),
        ...pines('pines_top', 'main', { x: 1950, y: 440 }, { x: 2500, y: 700 }, -1, 306),
      ],
      hazards: [
        {
          id: 'trail_soft_snow',
          kind: 'deep_mud',
          label: 'Soft snow on the trail',
          shape: k.band('snowmobile_trail', { x: 2940, y: 950 }, { x: 2940, y: 1250 }, [-40, 40]),
          drag: 18,
        },
        {
          id: 'pond_wind',
          kind: 'crosswind',
          label: 'Across the frozen pond',
          shape: k.poly(pond),
          exposure: 1,
          gust: { periodSeconds: 6, offsetSeconds: 1, low: 0.5, high: 1 },
        },
      ],
      anchors: [
        k.anchor('ski_lodge', 'landmark', [k.T({ x: 1300, y: 900 })]),
        k.anchor('lodge_chimney', 'chimney', [k.T({ x: 1340, y: 860 })]),
        k.anchor(
          'snow_guns',
          'snow_gun',
          k.edge('main', { x: 750, y: 440 }, { x: 1750, y: 420 }, -1, 40, 250),
        ),
        k.anchor('frozen_pond', 'landmark', [k.T({ x: 1550, y: 1800 })]),
        k.anchor('ice_cave', 'landmark', [k.at('main', { x: 2550, y: 1330 }, -150)]),
        k.anchor('radio_relay', 'landmark', [k.T({ x: 2800, y: 300 })]),
        k.anchor('pond_cracks', 'ice_cracks', [
          k.T({ x: 1000, y: 1700 }),
          k.T({ x: 2000, y: 1900 }),
        ]),
        k.anchor(
          'plow_markers',
          'sign',
          k.edge('main', { x: 750, y: 440 }, { x: 1750, y: 420 }, 1, 30, 200),
          'orange poles',
        ),
        k.anchor('snow_drift', 'snow_drift', [k.T({ x: 2000, y: 1300 }), k.T({ x: 2600, y: 900 })]),
      ],
    };
  },
});
