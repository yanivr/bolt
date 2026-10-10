import type { TrackControlPoint, TrackDefinition } from '@bolt/shared';

/**
 * Authored launch tracks. Milestone A ships city_01; the other seven arrive in Milestone D.
 * Coordinates are world pixels with Y pointing down the screen. Travel is clockwise.
 *
 * Lengths are measured by the simulator, not guessed: tests/unit/track.test.ts drives the
 * default car around each track and asserts the lap time window from Section 9.3.
 */

const A = (x: number, y: number, width: number): TrackControlPoint => ({ x, y, width });
const C = (x: number, y: number, width: number): TrackControlPoint => ({ x, y, width, surface: 'cobble' });

/**
 * Neon Cut. A fast outer ring that folds into two tight downtown switchbacks paved in old
 * cobblestone. The signed shortcut, Lantern Alley, cuts the second switchback through a
 * narrow lane with a dogleg and bollards at its mouth.
 */
export const CITY_01: TrackDefinition = {
  id: 'city_01',
  name: 'Neon Cut',
  biome: 'city',
  character: 'Fast outer ring with tight downtown hairpins',
  laps: 3,
  worldWidth: 3584,
  worldHeight: 2816,
  main: {
    id: 'main',
    closed: true,
    surface: 'asphalt',
    shoulder: 16,
    shoulderSurface: 'cobble',
    points: [
      // Harbor Straight, heading west. Start line sits here.
      A(2620, 2340, 160),
      A(2050, 2340, 170),
      A(1450, 2340, 170),
      A(920, 2340, 160),
      // Dockside sweeper.
      A(600, 2215, 154),
      A(480, 1950, 150),
      // West Avenue with a kink around the clock tower.
      A(460, 1620, 150),
      A(545, 1310, 144),
      A(470, 1010, 146),
      // Arcade sweeper.
      A(505, 730, 150),
      A(690, 525, 156),
      A(990, 444, 162),
      // Billboard Row, heading east.
      A(1500, 444, 168),
      A(1950, 444, 160),
      // Switchback one: right-hand hairpin onto cobblestone.
      C(2215, 452, 134),
      C(2305, 488, 128),
      C(2340, 575, 126),
      C(2305, 662, 126),
      C(2215, 700, 126),
      C(1900, 700, 128),
      C(1640, 700, 128),
      // Switchback two: left-hand hairpin.
      C(1552, 737, 126),
      C(1515, 825, 126),
      C(1552, 913, 126),
      C(1640, 950, 126),
      C(1950, 950, 130),
      // Market Street, back onto asphalt.
      A(2400, 950, 140),
      A(2760, 968, 156),
      // Overpass sweeper.
      A(3030, 1110, 156),
      A(3140, 1380, 152),
      A(3150, 1720, 152),
      // Harbor bend.
      A(3100, 2030, 154),
      A(2940, 2240, 158),
    ],
  },
  shortcuts: [
    {
      id: 'lantern_alley',
      closed: false,
      surface: 'cobble',
      shoulder: 0,
      shoulderSurface: 'cobble',
      leaveNear: { x: 1790, y: 703 },
      rejoinNear: { x: 1800, y: 948 },
      signName: 'Lantern Alley',
      points: [C(1772, 772, 76), C(1798, 826, 72), C(1776, 882, 76)],
    },
  ],
  checkpointCount: 12,
  startNear: { x: 1900, y: 2340 },
  obstacles: [
    { id: 'alley_bollard_in_l', kind: 'bollard', x: 1748, y: 757, radius: 5 },
    { id: 'alley_bollard_in_r', kind: 'bollard', x: 1814, y: 757, radius: 5 },
    { id: 'alley_bollard_out_l', kind: 'bollard', x: 1750, y: 897, radius: 5 },
    { id: 'alley_bollard_out_r', kind: 'bollard', x: 1816, y: 897, radius: 5 },
  ],
  props: [
    { kind: 'landmark_clock_tower', x: 655, y: 1315 },
    { kind: 'landmark_arcade', x: 800, y: 800 },
    { kind: 'landmark_neon_tower', x: 1900, y: 826 },
    { kind: 'landmark_tram_viaduct', x: 3145, y: 1560 },
    { kind: 'landmark_harbor_cranes', x: 1750, y: 2560 },
    { kind: 'start_gantry', x: 1900, y: 2340 },
  ],
  landmarks: ['Clock tower', 'Starlight Arcade', 'Neon tower', 'Tram viaduct', 'Harbor cranes'],
  weatherPresetIds: ['city_clear_night', 'city_rain_night'],
  surfaceMix: { asphalt: 0.8, cobble: 0.2 },
};

export const TRACKS: Record<string, TrackDefinition> = {
  [CITY_01.id]: CITY_01,
};

export function getTrack(id: string): TrackDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(TRACKS, id) ? TRACKS[id] : undefined;
}
