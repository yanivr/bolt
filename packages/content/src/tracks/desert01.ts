import type { TrackDefinition } from '@bolt/shared';
import { corner as c, defineTrack } from '../trackKit.js';

/**
 * Dust Devil. Big flowing sweepers on open desert, shaped like a bean: a long sand-blown
 * southern arc, a fast asphalt climb up the west side, a dip where the road ducks down into
 * the infield, a fast northern rise, and Devil's Elbow, a tight left and right on asphalt that
 * throws the car back onto the southern arc. Sand has drifted over the inside of the asphalt
 * sweepers, so the short line is the slow line unless the car is shod for it. The Dry Wash
 * shortcut runs straight across the top of the dip: shorter, narrow, soft and lined with
 * rocks. Open ground everywhere, bounded by mesa cliffs; the long southern arc and the
 * northern rise are exposed to the wind.
 */
export const DESERT_01: TrackDefinition = defineTrack({
  id: 'desert_01',
  name: 'Dust Devil',
  biome: 'desert',
  character: 'Sweeping bends and risky sandy inside lines',
  lengthClass: 'long',
  edges: 'open',
  offroadSurface: 'sand',
  windExposure: 0.55,
  weatherPresetIds: ['desert_clear', 'desert_crosswind'],
  surfaceMix: { asphalt: 0.45, sand: 0.55 },
  landmarks: ['Twin mesas', 'Wind pump', 'Bleached billboard', 'Rock arch', 'Dust devil flats'],
  scale: 1.06,
  margin: 420,
  checkpointCount: 12,
  start: { x: 2300, y: 2190 },
  main: {
    surface: 'sand',
    shoulder: 26,
    shoulderSurface: 'sand',
    corners: [
      c(3150, 2080, 340, 150, 'sand'),
      c(1600, 2230, 520, 150),
      c(560, 1760, 380, 146, 'asphalt'),
      c(660, 960, 320, 146),
      c(1300, 560, 250, 146, 'sand'),
      c(1950, 1180, 200, 142),
      c(2550, 600, 220, 146, 'asphalt'),
      c(3350, 560, 220, 148),
      c(3330, 1180, 120, 140),
      c(3600, 1520, 130, 140),
    ],
  },
  shortcuts: [
    {
      id: 'dry_wash',
      signName: 'Dry Wash',
      risk: 'Narrow soft sand between rocks; quicker only for a car built for sand',
      surface: 'sand',
      shoulder: 14,
      shoulderSurface: 'sand',
      leave: { x: 1560, y: 820 },
      rejoin: { x: 2330, y: 860 },
      corners: [c(1720, 800, 0, 80), c(1950, 740, 260, 76), c(2180, 800, 0, 80)],
    },
  ],
  features: (k) => {
    const rocks = (
      prefix: string,
      br: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
      side: -1 | 1,
      seed: number,
    ) => k.rowAlong(prefix, 'rock', br, from, to, side, 26, 140, 14, seed, 40);
    return {
      surfaceZones: [
        // Drifted sand over the inside half of the two asphalt sweepers.
        k.zone(
          'west_drift',
          'sand',
          k.band('main', { x: 560, y: 1550 }, { x: 600, y: 1100 }, [10, 90]),
        ),
        k.zone(
          'rise_drift',
          'sand',
          k.band('main', { x: 2700, y: 560 }, { x: 3250, y: 560 }, [12, 90]),
        ),
        // Sand blown right across the road out of Devil's Elbow.
        k.zone(
          'elbow_sand',
          'sand',
          k.band('main', { x: 3600, y: 1600 }, { x: 3380, y: 1900 }, [-100, 100]),
        ),
      ],
      walls: [k.boundary('mesa_cliff', 70)],
      obstacles: [
        ...rocks('wash_rocks_n', 'dry_wash', { x: 1760, y: 790 }, { x: 2140, y: 790 }, -1, 11),
        ...rocks('wash_rocks_s', 'dry_wash', { x: 1760, y: 790 }, { x: 2140, y: 790 }, 1, 12),
        ...k.rowAlong(
          'arc_boulders',
          'rock',
          'main',
          { x: 2800, y: 2130 },
          { x: 900, y: 2100 },
          1,
          120,
          260,
          20,
          21,
          120,
        ),
        ...k.rowAlong(
          'climb_cacti',
          'rock',
          'main',
          { x: 560, y: 1550 },
          { x: 900, y: 750 },
          -1,
          90,
          230,
          10,
          31,
          140,
        ),
        ...k.rowAlong(
          'rise_rocks',
          'rock',
          'main',
          { x: 2700, y: 560 },
          { x: 3250, y: 560 },
          -1,
          100,
          240,
          16,
          41,
          120,
        ),
        ...k.rowAlong(
          'elbow_rocks',
          'rock',
          'main',
          { x: 3400, y: 900 },
          { x: 3500, y: 1700 },
          -1,
          70,
          200,
          16,
          42,
          80,
        ),
      ],
      hazards: [
        {
          id: 'wash_soft_sand',
          kind: 'deep_mud',
          label: 'Soft sand in the wash',
          shape: k.band('dry_wash', { x: 1820, y: 770 }, { x: 2080, y: 770 }, [-40, 40]),
          drag: 22,
        },
        {
          id: 'southern_arc_wind',
          kind: 'crosswind',
          label: 'Exposed southern arc',
          shape: k.band('main', { x: 2800, y: 2150 }, { x: 1100, y: 2130 }, [-260, 260]),
          exposure: 1,
          gust: { periodSeconds: 7, offsetSeconds: 0, low: 0.55, high: 1.1 },
        },
        {
          id: 'northern_rise_wind',
          kind: 'crosswind',
          label: 'Northern rise',
          shape: k.band('main', { x: 2700, y: 600 }, { x: 3150, y: 580 }, [-240, 240]),
          exposure: 0.9,
          gust: { periodSeconds: 9, offsetSeconds: 3, low: 0.5, high: 1 },
        },
      ],
      anchors: [
        k.anchor('dust_devil_flats', 'dust_devil', [
          k.T({ x: 1600, y: 1500 }),
          k.T({ x: 2400, y: 1450 }),
        ]),
        k.anchor('twin_mesas', 'landmark', [k.T({ x: 300, y: 300 }), k.T({ x: 3500, y: 250 })]),
        k.anchor('wind_pump', 'landmark', [k.at('main', { x: 2550, y: 600 }, -150)]),
        k.anchor('bleached_billboard', 'billboard', [k.at('main', { x: 1600, y: 2230 }, 130)]),
        k.anchor(
          'rock_arch',
          'landmark',
          [k.at('dry_wash', { x: 1950, y: 760 }, 0)],
          'over the wash',
        ),
        k.anchor(
          'devils_elbow_sign',
          'sign',
          [k.at('main', { x: 3330, y: 1000 }, -110)],
          "Devil's Elbow",
        ),
        k.anchor('wind_sock_arc', 'wind_sock', [k.at('main', { x: 2200, y: 2190 }, 120)]),
        k.anchor('wind_sock_rise', 'wind_sock', [k.at('main', { x: 2900, y: 580 }, -120)]),
        k.anchor('tumbleweed_path', 'tumbleweed', [
          k.T({ x: 900, y: 1900 }),
          k.T({ x: 1800, y: 1750 }),
          k.T({ x: 2800, y: 1850 }),
        ]),
        k.anchor(
          'heat_haze_arc',
          'heat_haze',
          k.edge('main', { x: 2700, y: 2140 }, { x: 1300, y: 2180 }, 1, 40, 300),
        ),
        k.anchor('dry_wash_sign', 'sign', [k.at('main', { x: 1500, y: 750 }, -110)], 'Dry Wash'),
      ],
    };
  },
});
