import { BEETLE_ART } from './beetle.js';
import { ARROW_ART, SPIDER_ART, TURTLE_ART } from './benchmarks.js';
import { BRICK_ART } from './chassis/brick.js';
import { BUGGY_ART } from './chassis/buggy.js';
import { CHAMELEON_ART } from './chassis/chameleon.js';
import { COBRA_ART } from './chassis/cobra.js';
import { CRAB_ART } from './chassis/crab.js';
import { DRIFTER_ART } from './chassis/drifter.js';
import { HORSESHOE_ART } from './chassis/horseshoe.js';
import { KANGAROO_ART } from './chassis/kangaroo.js';
import { NEEDLE_ART } from './chassis/needle.js';
import { PICKUP_ART } from './chassis/pickup.js';
import { PLATFORM_ART } from './chassis/platform.js';
import { RAMMER_ART } from './chassis/rammer.js';
import { SCORPION_ART } from './chassis/scorpion.js';
import { TRIKE_ART } from './chassis/trike.js';
import { TWINS_ART } from './chassis/twins.js';
import { WAGON_ART } from './chassis/wagon.js';
import type { ChassisArt } from './types.js';

/** Every chassis with art, in Section 11.2 order. Add new chassis here; the baker picks them up. */
export const ALL_CHASSIS_ART: ChassisArt[] = [
  BEETLE_ART,
  NEEDLE_ART,
  TURTLE_ART,
  SPIDER_ART,
  CRAB_ART,
  COBRA_ART,
  SCORPION_ART,
  BUGGY_ART,
  CHAMELEON_ART,
  BRICK_ART,
  TRIKE_ART,
  ARROW_ART,
  WAGON_ART,
  RAMMER_ART,
  DRIFTER_ART,
  KANGAROO_ART,
  HORSESHOE_ART,
  PICKUP_ART,
  TWINS_ART,
  PLATFORM_ART,
];
