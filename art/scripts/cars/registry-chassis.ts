import { BEETLE_ART } from './beetle.js';
import { ARROW_ART, SPIDER_ART, TURTLE_ART } from './benchmarks.js';
import type { ChassisArt } from './types.js';

/** Every chassis with art. Add new chassis here; the baker picks them up. */
export const ALL_CHASSIS_ART: ChassisArt[] = [BEETLE_ART, ARROW_ART, TURTLE_ART, SPIDER_ART];
