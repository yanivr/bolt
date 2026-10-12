import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Timber Dash. A logging road stretched east to west: two long straights, each broken by a
 * tight chicane where the road jinks round a stand of giant trees, joined by a hairpin at each
 * end. The north straight is paved and fast, the south is a dirt haul road with mud in its
 * ruts. The Logging Spur cuts the eastern hairpin through the woods on a narrow dirt track
 * past log piles; mud lies in its low part.
 */
export const FOREST_02: TrackDefinition = defineTrack({
  id: 'forest_02',
  name: 'Timber Dash',
  biome: 'forest',
  character: 'Long straights broken by tight tree chicanes',
  lengthClass: 'long',
  edges: 'open',
  offroadSurface: 'dirt',
  windExposure: 0.15,
  weatherPresetIds: ['forest_clear', 'forest_heavy_rain'],
  surfaceMix: { asphalt: 0.45, dirt: 0.45, mud: 0.1 },
  landmarks: ['Sawmill', 'Giant redwoods', 'Log flume', 'Fire lookout', 'Timber stacks'],
  scale: 1.12,
  margin: 380,
  checkpointCount: 12,
  start: { x: 1100, y: 400 },
  main: {
    surface: 'asphalt',
    shoulder: 20,
    shoulderSurface: 'dirt',
    corners: [
      c(500, 420, 200, 140, 'asphalt'),
      c(1650, 400, 110, 136),
      c(1820, 560, 110, 132),
      c(2080, 560, 110, 132),
      c(2250, 400, 110, 136),
      c(3700, 400, 230, 140),
      c(3820, 1050, 200, 138, 'dirt'),
      c(2950, 1350, 260, 138),
      c(2350, 1420, 110, 134),
      c(2200, 1270, 110, 132),
      c(1940, 1270, 110, 132),
      c(1780, 1420, 110, 134),
      c(700, 1460, 220, 138),
      c(380, 1000, 220, 138),
    ],
  },
  shortcuts: [
    {
      id: 'logging_spur',
      signName: 'Logging Spur',
      risk: 'A narrow dirt track through the woods, log piles and a muddy dip',
      surface: 'dirt',
      shoulder: 12,
      shoulderSurface: 'dirt',
      leave: { x: 3250, y: 400 },
      rejoin: { x: 3300, y: 1220 },
      corners: [c(3350, 540, 0, 80), c(3450, 800, 180, 76), c(3400, 1080, 0, 80)],
    },
  ],
  features: (k) => {
    const trees = (
      prefix: string,
      br: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
      side: -1 | 1,
      seed: number,
      gap = 40,
    ) => k.rowAlong(prefix, 'tree', br, from, to, side, gap, 70, 16, seed, 60);
    return {
      surfaceZones: [
        // Mud in the haul road's ruts.
        k.zone(
          'rut_mud_east',
          'mud',
          k.band('main', { x: 2850, y: 1360 }, { x: 2500, y: 1400 }, [-80, 80]),
        ),
        k.zone(
          'rut_mud_west',
          'mud',
          k.band('main', { x: 1500, y: 1440 }, { x: 1150, y: 1450 }, [-80, 80]),
        ),
      ],
      walls: [k.boundary('dense_woods', 70)],
      obstacles: [
        // The giant trees the chicanes go round.
        k.obstacle('redwood_n_1', 'tree', k.at('main', { x: 1950, y: 560 }, -120), 34),
        k.obstacle('redwood_n_2', 'tree', k.at('main', { x: 1950, y: 560 }, -112, 90), 22),
        k.obstacle('redwood_s_1', 'tree', k.at('main', { x: 2070, y: 1270 }, 120), 34),
        k.obstacle('redwood_s_2', 'tree', k.at('main', { x: 2070, y: 1270 }, 112, -90), 22),
        ...trees('trees_n_out', 'main', { x: 700, y: 400 }, { x: 1550, y: 400 }, -1, 201),
        ...trees('trees_n_out_e', 'main', { x: 2350, y: 400 }, { x: 3600, y: 400 }, -1, 202),
        ...trees('trees_e_out', 'main', { x: 3800, y: 600 }, { x: 3700, y: 1250 }, -1, 203),
        ...trees('trees_s_out', 'main', { x: 2900, y: 1360 }, { x: 800, y: 1460 }, -1, 204),
        ...trees('trees_w_out', 'main', { x: 500, y: 1350 }, { x: 420, y: 650 }, -1, 205),
        ...trees('trees_mid_n', 'main', { x: 700, y: 430 }, { x: 3500, y: 420 }, 1, 206, 70),
        ...trees('trees_mid_s', 'main', { x: 2900, y: 1340 }, { x: 800, y: 1440 }, 1, 207, 70),
        ...trees(
          'spur_trees_e',
          'logging_spur',
          { x: 3350, y: 560 },
          { x: 3400, y: 1060 },
          -1,
          208,
          26,
        ),
        ...trees(
          'spur_trees_w',
          'logging_spur',
          { x: 3350, y: 560 },
          { x: 3400, y: 1060 },
          1,
          209,
          26,
        ),
        k.obstacle('log_pile_1', 'log', k.at('logging_spur', { x: 3420, y: 700 }, 34), 10),
        k.obstacle('log_pile_2', 'log', k.at('logging_spur', { x: 3440, y: 920 }, -34), 10),
      ],
      hazards: [
        {
          id: 'spur_mud',
          kind: 'deep_mud',
          label: 'Muddy dip on the spur',
          shape: k.band('logging_spur', { x: 3440, y: 760 }, { x: 3440, y: 880 }, [-40, 40]),
          drag: 24,
        },
      ],
      anchors: [
        k.anchor('sawmill', 'landmark', [k.T({ x: 1000, y: 900 })]),
        k.anchor('sawmill_chimney', 'chimney', [k.T({ x: 1060, y: 860 })]),
        k.anchor('giant_redwoods', 'landmark', [
          k.at('main', { x: 1950, y: 560 }, -120),
          k.at('main', { x: 2070, y: 1270 }, 120),
        ]),
        k.anchor('log_flume', 'water', [k.T({ x: 2600, y: 700 }), k.T({ x: 3000, y: 1100 })]),
        k.anchor('fire_lookout', 'landmark', [k.T({ x: 3950, y: 300 })]),
        k.anchor('timber_stacks', 'landmark', [k.at('main', { x: 700, y: 1460 }, -150)]),
        k.anchor(
          'chicane_chevrons_n',
          'sign',
          [k.at('main', { x: 1650, y: 400 }, -90)],
          'chevrons',
        ),
        k.anchor(
          'chicane_chevrons_s',
          'sign',
          [k.at('main', { x: 2350, y: 1420 }, -90)],
          'chevrons',
        ),
        k.anchor('leaf_fall', 'leaves', [k.T({ x: 1300, y: 900 }), k.T({ x: 2800, y: 900 })]),
        k.anchor('birds_woods', 'birds', [k.T({ x: 2000, y: 900 })]),
      ],
    };
  },
});
