import { BASELINE_BLUEPRINT, CATALOG, baselineBlueprint } from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import { validateUntrustedBlueprint } from '@bolt/shared';

/**
 * The player's current car in local storage. Kept apart from the store so it has no browser
 * or framework dependency and can be tested directly.
 */

export const BLUEPRINT_KEY = 'bolt.blueprint.v1';
/** The Milestone A pick: three part ids and a paint. Read once to migrate, then removed. */
export const LEGACY_LOADOUT_KEY = 'bolt.loadout.v1';

/**
 * Restores the car the player last had. Whatever is in storage is untrusted (an older build
 * wrote it, or the player edited it), so it goes through the same strict parser and
 * validator the server uses. Anything that is not a legal build for the current catalog is
 * dropped in favour of the baseline car; nothing stale can reach a race.
 */
export function restoreBlueprint(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
): VehicleBlueprint {
  try {
    const stored = storage.getItem(BLUEPRINT_KEY);
    if (stored !== null) {
      const check = validateUntrustedBlueprint(stored, CATALOG);
      if (check.ok) return check.blueprint;
    }
    // Migration from the three-id loadout. Only fields that are plain part ids are read, and
    // the result is validated like any other blueprint.
    const legacy = storage.getItem(LEGACY_LOADOUT_KEY);
    if (legacy !== null) {
      storage.removeItem(LEGACY_LOADOUT_KEY);
      const parsed = JSON.parse(legacy) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const pick = parsed as Record<string, unknown>;
        const id = (value: unknown) =>
          typeof value === 'string' && /^[a-z0-9_]{1,48}$/.test(value) ? value : undefined;
        const choice: Parameters<typeof baselineBlueprint>[0] = {};
        const chassisId = id(pick.chassisId);
        const engineId = id(pick.engineId);
        const tireKitId = id(pick.tireKitId);
        const paintId = id(pick.paintId);
        if (chassisId) choice.chassisId = chassisId;
        if (engineId) choice.engineId = engineId;
        if (tireKitId) choice.tireKitId = tireKitId;
        if (paintId) choice.paintId = paintId;
        const check = validateUntrustedBlueprint(baselineBlueprint(choice), CATALOG);
        if (check.ok) return check.blueprint;
      }
    }
  } catch {
    // Unreadable storage or broken JSON: start from the baseline car.
  }
  return BASELINE_BLUEPRINT;
}
