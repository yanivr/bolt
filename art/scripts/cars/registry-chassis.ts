import { BEETLE_ART } from './beetle.js';
import { ARROW_ART, SPIDER_ART } from './benchmarks.js';
import { PICKUP_ART } from './chassis/pickup.js';
import { TRIKE_ART } from './chassis/trike.js';
import type { ChassisArt } from './types.js';

/**
 * Every chassis the game ships, in garage order. The baker picks up whatever is listed here.
 * Fifteen more models are kept, unbaked, in `chassis/retired` (see the README there).
 */
export const ALL_CHASSIS_ART: ChassisArt[] = [
  BEETLE_ART,
  ARROW_ART,
  PICKUP_ART,
  SPIDER_ART,
  TRIKE_ART,
];
