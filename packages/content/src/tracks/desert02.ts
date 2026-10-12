import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Canyon Switch. A long fast plateau straight across the top of the map, open to the wind,
 * drops down a sandy west descent into a canyon. The canyon floor is a run of cliffside
 * S-bends between rock walls, then a switchback climbs the east wall back up to the plateau.
 * The Ledge Run shortcut follows a sand ledge along the foot of the south wall and cuts out the
 * middle S: shorter, narrow, sandy and with fallen rock at its mouth.
 */
export const DESERT_02: TrackDefinition = defineTrack({
  id: 'desert_02',
  name: 'Canyon Switch',
  biome: 'desert',
  character: 'Cliffside S-bends and wind-blown plateaus',
  lengthClass: 'long',
  edges: 'open',
  offroadSurface: 'sand',
  windExposure: 0.35,
  weatherPresetIds: ['desert_dry_heat', 'desert_sandstorm'],
  surfaceMix: { asphalt: 0.65, sand: 0.35 },
  landmarks: [
    'Plateau radio mast',
    'Canyon arch',
    'Switchback watchtower',
    'Rusted ore hopper',
    'Painted cliff',
  ],
  scale: 1.1,
  margin: 420,
  checkpointCount: 12,
  start: { x: 2100, y: 380 },
  main: {
    surface: 'asphalt',
    shoulder: 22,
    shoulderSurface: 'sand',
    corners: [
      c(3120, 360, 200, 150, 'asphalt'),
      c(900, 380, 330, 150, 'sand'),
      c(450, 1100, 360, 146),
      c(700, 1800, 280, 144, 'asphalt'),
      c(1250, 2050, 190, 136),
      c(1700, 1750, 190, 136),
      c(2150, 2050, 190, 136),
      c(2600, 1750, 190, 136),
      c(3250, 1950, 200, 140),
      c(3450, 1350, 150, 136),
      c(2850, 1150, 150, 136, 'sand'),
      c(3000, 800, 160, 140, 'asphalt'),
    ],
  },
  shortcuts: [
    {
      id: 'ledge_run',
      signName: 'Ledge Run',
      risk: 'A sand ledge along the cliff foot, barely two cars wide, with fallen rock',
      surface: 'sand',
      shoulder: 8,
      shoulderSurface: 'sand',
      leave: { x: 1250, y: 2045 },
      rejoin: { x: 2150, y: 2045 },
      corners: [c(1400, 2130, 0, 78), c(1700, 2180, 260, 76), c(2000, 2130, 0, 78)],
    },
  ],
  features: (k) => {
    const sb = { a: { x: 980, y: 1960 }, b: { x: 2950, y: 1880 } };
    return {
      surfaceZones: [
        // Sand blown across the plateau's western end.
        k.zone(
          'plateau_drift',
          'sand',
          k.band('main', { x: 1750, y: 380 }, { x: 1050, y: 380 }, [-75, 75]),
        ),
      ],
      walls: [
        k.boundary('canyon_rim', 70),
        // The canyon: rock walls close on both sides of the floor, open where the ledge runs.
        k.wallAlong('north_wall_a', 'cliff', 'main', sb.a, { x: 1700, y: 1745 }, -1, 34, 20),
        k.wallAlong('north_wall_b', 'cliff', 'main', { x: 1700, y: 1745 }, sb.b, -1, 34, 20),
        k.wallAlong('south_wall_a', 'cliff', 'main', sb.a, { x: 1180, y: 2040 }, 1, 34, 20),
        k.wallAlong(
          'south_wall_ledge',
          'cliff',
          'ledge_run',
          { x: 1400, y: 2130 },
          { x: 2000, y: 2130 },
          1,
          20,
          20,
        ),
        k.wallAlong('south_wall_b', 'cliff', 'main', { x: 2250, y: 2030 }, sb.b, 1, 34, 20),
        // Guard rail on the drop side of the switchback.
        k.wallAlong(
          'switchback_rail',
          'guard_rail',
          'main',
          { x: 3400, y: 1450 },
          { x: 2950, y: 1180 },
          1,
          30,
          12,
        ),
      ],
      obstacles: [
        k.obstacle('ledge_rock_1', 'rock', k.at('ledge_run', { x: 1450, y: 2140 }, -30), 9),
        k.obstacle('ledge_rock_2', 'rock', k.at('ledge_run', { x: 1950, y: 2140 }, 30), 9),
        ...k.rowAlong(
          'plateau_rocks',
          'rock',
          'main',
          { x: 3100, y: 380 },
          { x: 1100, y: 380 },
          1,
          140,
          300,
          18,
          52,
          160,
        ),
        ...k.rowAlong(
          'descent_rocks',
          'rock',
          'main',
          { x: 600, y: 600 },
          { x: 600, y: 1600 },
          1,
          90,
          220,
          14,
          53,
          100,
        ),
      ],
      hazards: [
        {
          id: 'plateau_wind',
          kind: 'crosswind',
          label: 'The plateau',
          shape: k.band('main', { x: 3150, y: 380 }, { x: 1150, y: 380 }, [-320, 320]),
          exposure: 1,
          gust: { periodSeconds: 8, offsetSeconds: 2, low: 0.6, high: 1.15 },
        },
        {
          id: 'switchback_wind',
          kind: 'crosswind',
          label: 'Switchback crest',
          shape: k.band('main', { x: 2880, y: 1080 }, { x: 2960, y: 820 }, [-170, 170]),
          exposure: 0.8,
        },
      ],
      anchors: [
        k.anchor('radio_mast', 'landmark', [k.at('main', { x: 2200, y: 380 }, -200)]),
        k.anchor(
          'canyon_arch',
          'landmark',
          [k.at('main', { x: 1700, y: 1750 }, -60)],
          'spans the road',
        ),
        k.anchor('watchtower', 'landmark', [k.at('main', { x: 3450, y: 1350 }, -140)]),
        k.anchor('ore_hopper', 'landmark', [k.T({ x: 2200, y: 1300 })]),
        k.anchor('painted_cliff', 'sign', [k.at('main', { x: 2600, y: 1750 }, -70)], 'chevrons'),
        k.anchor(
          'plateau_flags',
          'flag',
          k.edge('main', { x: 3100, y: 380 }, { x: 1200, y: 380 }, -1, 30, 380),
        ),
        k.anchor('dust_ribbons', 'dust', [k.T({ x: 1200, y: 250 }), k.T({ x: 3000, y: 300 })]),
        k.anchor(
          'falling_rock_sign',
          'warning',
          [k.at('ledge_run', { x: 1420, y: 2130 }, -40)],
          'falling rock',
        ),
      ],
    };
  },
});
