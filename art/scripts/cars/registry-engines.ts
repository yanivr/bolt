import { FOUR_CYLINDER_ART } from './engines.js';
import {
  DIESEL_ART,
  IRONHEART_ART,
  ROTARY_ART,
  TRAIL_ART,
  V12_ART,
  V6_ART,
  V8_ART,
} from './engines/combustion.js';
import {
  ECO_ELECTRIC_ART,
  HYBRID_ART,
  MINI_ELECTRIC_ART,
  SPORT_ELECTRIC_ART,
  TWIN_DRIVE_ART,
} from './engines/electric.js';
import { ROCKET_ART, SPRING_DRIVE_ART, TURBINE_ART, WILDCARD_ART } from './engines/exotic.js';
import { SMALL_TURBO_ART, SUPERCHARGER_ART, TWIN_TURBO_ART } from './engines/forced.js';
import type { EngineArt } from './types.js';

/** Every engine with art. Add new engines here; the baker picks them up. */
export const ALL_ENGINE_ART: EngineArt[] = [
  FOUR_CYLINDER_ART,
  MINI_ELECTRIC_ART,
  V6_ART,
  V8_ART,
  V12_ART,
  SMALL_TURBO_ART,
  TWIN_TURBO_ART,
  SUPERCHARGER_ART,
  DIESEL_ART,
  SPORT_ELECTRIC_ART,
  ECO_ELECTRIC_ART,
  HYBRID_ART,
  ROTARY_ART,
  TURBINE_ART,
  ROCKET_ART,
  TWIN_DRIVE_ART,
  SPRING_DRIVE_ART,
  TRAIL_ART,
  IRONHEART_ART,
  WILDCARD_ART,
];
