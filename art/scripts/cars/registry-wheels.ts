import type { WheelArt } from './types.js';
import {
  DRIFT_WHEEL_ART,
  HARD_WHEEL_ART,
  MICRO_WHEEL_ART,
  RAIN_WHEEL_ART,
  SLICK_WHEEL_ART,
  SOFT_WHEEL_ART,
} from './wheelkits/road.js';
import {
  ADAPTIVE_WHEEL_ART,
  ARMORED_WHEEL_ART,
  BLADES_WHEEL_ART,
  MAGNETIC_WHEEL_ART,
  SOLID_WHEEL_ART,
} from './wheelkits/special.js';
import {
  BALLOON_WHEEL_ART,
  ICE_WHEEL_ART,
  MONSTER_WHEEL_ART,
  MUD_WHEEL_ART,
  SAND_WHEEL_ART,
  SNOW_WHEEL_ART,
} from './wheelkits/terrain.js';
import { FULL_TRACK_WHEEL_ART, HALF_TRACK_WHEEL_ART } from './wheelkits/tracks.js';
import { STREET_WHEEL_ART } from './wheels.js';

/** Every wheel kit with art. The first entry is used for chassis ground shadows. */
export const ALL_WHEEL_ART: WheelArt[] = [
  STREET_WHEEL_ART,
  SLICK_WHEEL_ART,
  RAIN_WHEEL_ART,
  SAND_WHEEL_ART,
  MUD_WHEEL_ART,
  SNOW_WHEEL_ART,
  ICE_WHEEL_ART,
  SOFT_WHEEL_ART,
  HARD_WHEEL_ART,
  DRIFT_WHEEL_ART,
  ARMORED_WHEEL_ART,
  SOLID_WHEEL_ART,
  BALLOON_WHEEL_ART,
  MONSTER_WHEEL_ART,
  MICRO_WHEEL_ART,
  HALF_TRACK_WHEEL_ART,
  FULL_TRACK_WHEEL_ART,
  MAGNETIC_WHEEL_ART,
  ADAPTIVE_WHEEL_ART,
  BLADES_WHEEL_ART,
];
