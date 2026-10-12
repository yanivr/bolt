import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Moss Run. A loop through old woodland around a mill pond. The north side is paved and quick
 * and crosses the creek on a narrow wooden bridge; the east side drops through shaded bends
 * that never dry; the south is a dirt track with muddy bends at the pond's western edge. The
 * Marsh Track shortcut is the muddy detour: straight across the marsh behind the pond, much
 * shorter and deep in mud, quick only on tires made for it. Trees close in on both sides, the
 * creek and the pond are water, and the woods beyond are impassable.
 */
export const FOREST_01: TrackDefinition = defineTrack({
  id: 'forest_01',
  name: 'Moss Run',
  biome: 'forest',
  character: 'Wet shaded bends, a bridge, muddy detour',
  lengthClass: 'short',
  edges: 'open',
  offroadSurface: 'dirt',
  windExposure: 0.15,
  weatherPresetIds: ['forest_clear', 'forest_rain'],
  surfaceMix: { asphalt: 0.5, dirt: 0.3, mud: 0.2 },
  landmarks: ['Mill bridge', 'Water wheel', 'Hollow oak', 'Mushroom ring', 'Ranger hut'],
  scale: 1.15,
  margin: 380,
  checkpointCount: 10,
  start: { x: 1700, y: 400 },
  main: {
    surface: 'asphalt',
    shoulder: 18,
    shoulderSurface: 'dirt',
    corners: [
      c(500, 520, 240, 136, 'asphalt'),
      c(1050, 400, 260, 136),
      c(2000, 400, 260, 136),
      c(2550, 800, 220, 134),
      c(2350, 1300, 170, 130),
      c(2600, 1700, 190, 130, 'dirt'),
      c(1700, 1880, 280, 132),
      c(1150, 1620, 190, 130),
      c(650, 1820, 200, 130),
      c(420, 1200, 280, 132, 'asphalt'),
    ],
  },
  shortcuts: [
    {
      id: 'marsh_track',
      signName: 'Marsh Track',
      risk: 'Deep mud across the marsh, between reeds and stumps',
      surface: 'mud',
      shoulder: 10,
      shoulderSurface: 'mud',
      leave: { x: 1560, y: 1820 },
      rejoin: { x: 440, y: 1300 },
      corners: [c(1450, 1620, 0, 80), c(1150, 1430, 180, 78), c(720, 1320, 0, 80)],
    },
  ],
  features: (k) => {
    const mudBands = [
      // The shaded bends down the east side never dry out.
      k.zone(
        'shaded_mud',
        'mud',
        k.band('main', { x: 2570, y: 1000 }, { x: 2560, y: 1600 }, [-90, 90]),
      ),
      // Nor do the bends at the marsh's edge.
      k.zone(
        'marsh_edge_mud',
        'mud',
        k.band('main', { x: 1350, y: 1720 }, { x: 800, y: 1840 }, [-90, 90]),
      ),
    ];
    const creekX = k.at('main', { x: 1500, y: 400 }).x;
    const bridge = { from: { x: 1380, y: 400 }, to: { x: 1620, y: 400 } };
    const pond = [
      { x: 1250, y: 820 },
      { x: 1900, y: 780 },
      { x: 2050, y: 1060 },
      { x: 1750, y: 1260 },
      { x: 1300, y: 1180 },
    ];
    const treeRow = (
      prefix: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
      side: -1 | 1,
      seed: number,
      br = 'main',
    ) => k.rowAlong(prefix, 'tree', br, from, to, side, 36, 74, 15, seed, 50);
    return {
      surfaceZones: mudBands,
      walls: [
        k.boundary('dense_woods', 70),
        // The creek: banks from the north edge down to the bridge, and on into the pond.
        k.wall(
          'creek_bank_w',
          'water_edge',
          [{ x: creekX - 46, y: 70 }, k.at('main', bridge.from, -90)],
          14,
        ),
        k.wall(
          'creek_bank_e',
          'water_edge',
          [{ x: creekX + 46, y: 70 }, k.at('main', bridge.to, -90)],
          14,
        ),
        k.wall(
          'creek_bank_w_s',
          'water_edge',
          [k.at('main', bridge.from, 90), k.T({ x: 1450, y: 805 })],
          14,
        ),
        k.wall(
          'creek_bank_e_s',
          'water_edge',
          [k.at('main', bridge.to, 90), k.T({ x: 1600, y: 795 })],
          14,
        ),
        k.wall('mill_pond', 'water_edge', pond.map(k.T), 16, true),
        // Bridge rails.
        k.wallAlong('bridge_rail_n', 'rail', 'main', bridge.from, bridge.to, -1, 2, 10),
        k.wallAlong('bridge_rail_s', 'rail', 'main', bridge.from, bridge.to, 1, 2, 10),
      ],
      obstacles: [
        ...treeRow('trees_nw', { x: 450, y: 1100 }, { x: 1250, y: 400 }, -1, 101),
        ...treeRow('trees_nw_in', { x: 600, y: 1200 }, { x: 1250, y: 420 }, 1, 102),
        ...treeRow('trees_ne', { x: 1750, y: 400 }, { x: 2500, y: 1000 }, -1, 103),
        ...treeRow('trees_ne_in', { x: 1750, y: 420 }, { x: 2450, y: 1000 }, 1, 104),
        ...treeRow('trees_shade', { x: 2400, y: 1150 }, { x: 2550, y: 1650 }, -1, 105),
        ...treeRow('trees_shade_in', { x: 2400, y: 1150 }, { x: 2500, y: 1650 }, 1, 106),
        ...treeRow('trees_south', { x: 2400, y: 1850 }, { x: 1300, y: 1800 }, -1, 107),
        ...treeRow('trees_sw', { x: 900, y: 1750 }, { x: 450, y: 1500 }, -1, 108),
        ...k.rowAlong(
          'marsh_stumps',
          'log',
          'marsh_track',
          { x: 1420, y: 1580 },
          { x: 800, y: 1340 },
          1,
          20,
          160,
          9,
          109,
          30,
        ),
        ...k.rowAlong(
          'marsh_reeds',
          'tree',
          'marsh_track',
          { x: 1420, y: 1580 },
          { x: 800, y: 1340 },
          -1,
          22,
          150,
          8,
          110,
          30,
        ),
      ],
      hazards: [
        {
          id: 'marsh_deep_mud',
          kind: 'deep_mud',
          label: 'Deep marsh mud',
          shape: k.band('marsh_track', { x: 1400, y: 1560 }, { x: 850, y: 1350 }, [-44, 44]),
          drag: 20,
        },
      ],
      anchors: [
        k.anchor('mill_bridge', 'bridge', [k.at('main', bridge.from), k.at('main', bridge.to)]),
        k.anchor(
          'bridge_runoff',
          'waterfall',
          [k.at('main', { x: 1500, y: 400 }, 90)],
          'runoff under the bridge',
        ),
        k.anchor('water_wheel', 'landmark', [k.T({ x: 1420, y: 950 })]),
        k.anchor('hollow_oak', 'landmark', [k.at('main', { x: 2550, y: 800 }, 160)]),
        k.anchor(
          'mushroom_ring',
          'glow',
          [k.at('main', { x: 2350, y: 1300 }, 120)],
          'shady corner',
        ),
        k.anchor('ranger_hut', 'landmark', [k.at('main', { x: 420, y: 1200 }, -160)]),
        k.anchor('creek', 'water', [
          { x: creekX, y: 80 },
          k.at('main', { x: 1500, y: 400 }),
          k.T({ x: 1520, y: 880 }),
        ]),
        k.anchor(
          'mist_shade',
          'mist',
          k.edge('main', { x: 2400, y: 1150 }, { x: 2550, y: 1650 }, 1, 20, 160),
        ),
        k.anchor('birds_pond', 'birds', [k.T({ x: 1650, y: 1100 })]),
        k.anchor('canopy_shade', 'canopy', [
          k.at('main', { x: 2350, y: 1300 }),
          k.at('main', { x: 2600, y: 1700 }),
        ]),
      ],
    };
  },
});
