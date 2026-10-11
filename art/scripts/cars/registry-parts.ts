import { DEFENSE_ART } from './parts/defenses.js';
import { UTILITY_ART } from './parts/utilities.js';
import { WEAPON_ART } from './parts/weapons.js';
import type { PartArt } from './types.js';

/** Every mounted weapon, defense and utility with art. Add new parts here. */
export const ALL_PART_ART: PartArt[] = [...WEAPON_ART, ...DEFENSE_ART, ...UTILITY_ART];
