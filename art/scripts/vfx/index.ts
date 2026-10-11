import { buildExplosionVfx } from './explosions.js';
import { buildHazardVfx } from './hazards.js';
import type { FxStrip } from './kit.js';
import { buildStatusVfx } from './status.js';
import { buildWeaponVfx } from './weapons.js';

/** Every strip of the combat effects atlas, in a stable order. */
export function buildCombatVfx(): FxStrip[] {
  return [...buildExplosionVfx(), ...buildWeaponVfx(), ...buildHazardVfx(), ...buildStatusVfx()];
}
