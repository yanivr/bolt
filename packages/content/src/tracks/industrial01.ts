import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Steel Circuit. Through a working factory at night: out of the yard into Press Hall, a tight
 * three-corner wriggle on riveted plate with magnetic strips laid across its corners (Magnetic
 * Rollers bite there), back out along the yard road, round the cobbled loading dock and through
 * Smelter Hall, where oil stands on the floor and steam vents fire on a cycle. Tight factory
 * turns throughout, walls everywhere. The Conveyor Gap shortcut slips under the conveyor
 * bridge between the yard road and the dock: narrow plate between pillars.
 */
export const INDUSTRIAL_01: TrackDefinition = defineTrack({
  id: 'industrial_01',
  name: 'Steel Circuit',
  biome: 'industrial',
  character: 'Magnetic floor strips, oil hazards and tight factory turns',
  lengthClass: 'short',
  edges: 'walled',
  offroadSurface: 'metal',
  windExposure: 0.2,
  weatherPresetIds: ['industrial_dry_night', 'industrial_factory_rain'],
  surfaceMix: { metal: 0.45, asphalt: 0.4, cobble: 0.15 },
  landmarks: ['Press Hall', 'Smelter stacks', 'Conveyor bridge', 'Gantry crane', 'Water tower'],
  scale: 0.68,
  margin: 340,
  checkpointCount: 10,
  start: { x: 1000, y: 400 },
  main: {
    surface: 'asphalt',
    shoulder: 10,
    shoulderSurface: 'metal',
    corners: [
      c(500, 400, 80, 132, 'asphalt'),
      c(1600, 400, 70, 128, 'metal'),
      c(1600, 880, 60, 122),
      c(1100, 880, 60, 122),
      c(1100, 1280, 60, 122, 'asphalt'),
      c(2300, 1280, 80, 128, 'metal'),
      c(2300, 520, 70, 126, 'asphalt'),
      c(2750, 520, 70, 126, 'cobble'),
      c(2750, 1850, 90, 130, 'metal'),
      c(1300, 1850, 70, 124),
      c(1300, 1600, 60, 122),
      c(500, 1600, 80, 128, 'asphalt'),
    ],
  },
  shortcuts: [
    {
      id: 'conveyor_gap',
      signName: 'Conveyor Gap',
      risk: 'Plate floor under the conveyor, one car wide between pillars, oil at its exit',
      surface: 'metal',
      shoulder: 0,
      shoulderSurface: 'metal',
      leave: { x: 2300, y: 860 },
      rejoin: { x: 2750, y: 960 },
      corners: [c(2420, 760, 0, 74), c(2530, 720, 60, 72), c(2640, 760, 0, 74)],
    },
  ],
  features: (k) => {
    return {
      walls: [],
      obstacles: [
        k.obstacle(
          'gap_pillar_1',
          'pillar',
          k.at('conveyor_gap', { x: 2530, y: 720 }, -30, -30),
          8,
          'gap_warning',
        ),
        k.obstacle(
          'gap_pillar_2',
          'pillar',
          k.at('conveyor_gap', { x: 2530, y: 720 }, 30, 30),
          8,
          'gap_warning',
        ),
        k.obstacle('press_pillar_1', 'pillar', k.at('main', { x: 1350, y: 880 }, -54), 7),
        k.obstacle('press_pillar_2', 'pillar', k.at('main', { x: 1350, y: 880 }, 54), 7),
        k.obstacle('dock_crate_1', 'crate', k.at('main', { x: 2750, y: 700 }, 56), 7),
        k.obstacle('dock_crate_2', 'crate', k.at('main', { x: 2750, y: 1100 }, 56), 7),
        k.obstacle('smelter_barrel_1', 'barrel', k.at('main', { x: 2100, y: 1850 }, -55), 7),
      ],
      hazards: [
        {
          id: 'press_magnet_1',
          kind: 'magnetic_strip',
          label: 'Magnetic strip, Press Hall north corner',
          shape: k.band('main', { x: 1600, y: 760 }, { x: 1480, y: 880 }, [-62, 62]),
          gripBonus: 0.25,
        },
        {
          id: 'press_magnet_2',
          kind: 'magnetic_strip',
          label: 'Magnetic strip, Press Hall south corner',
          shape: k.band('main', { x: 1220, y: 880 }, { x: 1100, y: 1000 }, [-62, 62]),
          gripBonus: 0.25,
        },
        {
          id: 'smelter_oil_1',
          kind: 'oil',
          label: 'Oil on the Smelter Hall floor',
          shape: k.band('main', { x: 2350, y: 1850 }, { x: 2150, y: 1850 }, [8, 60]),
          grip: 0.55,
        },
        {
          id: 'smelter_oil_2',
          kind: 'oil',
          label: 'Oil at the Smelter Hall exit',
          shape: k.circle(k.at('main', { x: 1450, y: 1850 }, -30), 30),
          grip: 0.55,
        },
        {
          id: 'steam_vent_1',
          kind: 'steam_vent',
          label: 'Steam vent',
          shape: k.circle(k.at('main', { x: 1900, y: 1850 }, 0), 38),
          schedule: { periodSeconds: 6, offsetSeconds: 0, warnSeconds: 1.2, activeSeconds: 1.5 },
          drag: 140,
          heatPerSecond: 18,
        },
        {
          id: 'steam_vent_2',
          kind: 'steam_vent',
          label: 'Steam vent',
          shape: k.circle(k.at('main', { x: 1680, y: 1850 }, 0), 38),
          schedule: { periodSeconds: 6, offsetSeconds: 3, warnSeconds: 1.2, activeSeconds: 1.5 },
          drag: 140,
          heatPerSecond: 18,
        },
      ],
      anchors: [
        k.anchor(
          'gap_warning',
          'warning',
          [k.at('conveyor_gap', { x: 2420, y: 760 }, 0, -10)],
          'hazard stripes',
        ),
        k.anchor('conveyor_bridge', 'conveyor', [
          k.T({ x: 2300, y: 720 }),
          k.T({ x: 2750, y: 720 }),
        ]),
        k.anchor('press_hall', 'landmark', [k.T({ x: 1350, y: 650 })]),
        k.anchor('press_pistons', 'piston', [
          k.at('main', { x: 1350, y: 880 }, -80),
          k.at('main', { x: 1100, y: 1100 }, 80),
        ]),
        k.anchor('smelter_stacks', 'chimney', [
          k.T({ x: 2000, y: 2050 }),
          k.T({ x: 2200, y: 2050 }),
        ]),
        k.anchor('smelter_glow', 'glow', [k.at('main', { x: 2000, y: 1850 }, 80)], 'molten'),
        k.anchor('gantry_crane', 'landmark', [k.T({ x: 1700, y: 1450 })]),
        k.anchor('water_tower', 'landmark', [k.T({ x: 400, y: 1000 })]),
        k.anchor('warning_lamps', 'warning_light', [
          k.at('main', { x: 1900, y: 1850 }, -70),
          k.at('main', { x: 1680, y: 1850 }, 70),
        ]),
        k.anchor('magnet_lane_marks', 'magnet_marks', [
          k.at('main', { x: 1600, y: 800 }),
          k.at('main', { x: 1150, y: 920 }),
        ]),
        k.anchor('welding_sparks', 'sparks', [k.T({ x: 1850, y: 1700 })]),
      ],
    };
  },
});
