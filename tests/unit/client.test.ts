import {
  BASELINE_BLUEPRINT,
  CATALOG,
  ROOKIE_BLUEPRINT,
  TEMPLATES,
  blueprintLoadout,
} from '@bolt/content';
import { buildHash, serializeBlueprint, validateBlueprint } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_KEY,
  LEGACY_LOADOUT_KEY,
  restoreBlueprint,
} from '../../apps/web/src/app/savedBlueprint.js';

/** A stand-in for `window.localStorage`. */
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('the stored car (store migration)', () => {
  it('starts a blank session on the baseline car', () => {
    expect(restoreBlueprint(storage())).toBe(BASELINE_BLUEPRINT);
  });

  it('restores a stored blueprint in canonical form', () => {
    for (const template of TEMPLATES) {
      const restored = restoreBlueprint(
        storage({ [BLUEPRINT_KEY]: serializeBlueprint(template.blueprint) }),
      );
      expect(buildHash(restored), template.id).toBe(buildHash(template.blueprint));
      expect(restored.name).toBe(template.name);
      expect(validateBlueprint(restored, CATALOG).ok).toBe(true);
    }
  });

  it('migrates the Milestone A loadout to a blueprint and removes the old key', () => {
    const old = storage({
      [LEGACY_LOADOUT_KEY]: JSON.stringify({
        chassisId: 'chassis_spider',
        engineId: 'engine_four_cylinder',
        tireKitId: 'tires_street',
        paintId: 'paint_mint',
      }),
    });
    const restored = restoreBlueprint(old);
    expect(blueprintLoadout(restored)).toEqual({
      chassisId: 'chassis_spider',
      engineId: 'engine_four_cylinder',
      tireKitId: 'tires_street',
      paintId: 'paint_mint',
    });
    expect(restored.parts).toEqual([]);
    expect(restored.catalogVersion).toBe(CATALOG.version);
    expect(validateBlueprint(restored, CATALOG).ok).toBe(true);
    expect(old.data.has(LEGACY_LOADOUT_KEY)).toBe(false);
    // A partial pick keeps what it names and defaults the rest.
    const partial = restoreBlueprint(
      storage({ [LEGACY_LOADOUT_KEY]: JSON.stringify({ chassisId: 'chassis_arrow' }) }),
    );
    expect(blueprintLoadout(partial)).toEqual({
      chassisId: 'chassis_arrow',
      engineId: 'engine_four_cylinder',
      tireKitId: 'tires_street',
      paintId: 'paint_signal',
    });
  });

  it('prefers a stored blueprint over a leftover loadout', () => {
    const both = storage({
      [BLUEPRINT_KEY]: serializeBlueprint(ROOKIE_BLUEPRINT),
      [LEGACY_LOADOUT_KEY]: JSON.stringify({ chassisId: 'chassis_spider' }),
    });
    expect(buildHash(restoreBlueprint(both))).toBe(buildHash(ROOKIE_BLUEPRINT));
  });

  it('falls back to the baseline for anything stale, broken or hostile', () => {
    const bad: Array<Record<string, string>> = [
      { [BLUEPRINT_KEY]: 'not json' },
      { [BLUEPRINT_KEY]: '{"half":' },
      { [BLUEPRINT_KEY]: 'null' },
      { [BLUEPRINT_KEY]: '[]' },
      // Built against another catalog version.
      { [BLUEPRINT_KEY]: serializeBlueprint({ ...ROOKIE_BLUEPRINT, catalogVersion: '0.2.0' }) },
      // A part that no longer exists, an illegal placement, an over-budget car.
      { [BLUEPRINT_KEY]: serializeBlueprint({ ...ROOKIE_BLUEPRINT, engineId: 'engine_removed' }) },
      {
        [BLUEPRINT_KEY]: serializeBlueprint({
          ...ROOKIE_BLUEPRINT,
          parts: [{ ...ROOKIE_BLUEPRINT.parts[0]!, mountId: 'engine_bay' }],
        }),
      },
      { [BLUEPRINT_KEY]: JSON.stringify({ ...ROOKIE_BLUEPRINT, totalCost: 0 }) },
      {
        [BLUEPRINT_KEY]: JSON.stringify({ ...ROOKIE_BLUEPRINT, name: '<script>alert(1)</script>' }),
      },
      { [BLUEPRINT_KEY]: 'x'.repeat(100_000) },
      { [LEGACY_LOADOUT_KEY]: 'not json' },
      // A Milestone A pick of a chassis that has since been retired.
      {
        [LEGACY_LOADOUT_KEY]: JSON.stringify({
          chassisId: 'chassis_turtle',
          engineId: 'engine_four_cylinder',
          tireKitId: 'tires_street',
          paintId: 'paint_mint',
        }),
      },
      // A stored car on a retired chassis: never restored as the current car.
      {
        [BLUEPRINT_KEY]: JSON.stringify({ ...ROOKIE_BLUEPRINT, chassisId: 'chassis_turtle' }),
      },
      { [LEGACY_LOADOUT_KEY]: '"chassis_turtle"' },
      { [LEGACY_LOADOUT_KEY]: '[1,2,3]' },
      { [LEGACY_LOADOUT_KEY]: JSON.stringify({ chassisId: 'chassis_from_the_future' }) },
      { [LEGACY_LOADOUT_KEY]: JSON.stringify({ chassisId: '__proto__', engineId: 'constructor' }) },
      {
        [LEGACY_LOADOUT_KEY]: JSON.stringify({
          chassisId: { toString: 'chassis_turtle' },
          paintId: 7,
        }),
      },
      { [LEGACY_LOADOUT_KEY]: JSON.stringify({ engineId: 'tires_street' }) },
      { [LEGACY_LOADOUT_KEY]: '{"__proto__":{"chassisId":"chassis_turtle"}}' },
    ];
    for (const contents of bad) {
      const restored = restoreBlueprint(storage(contents));
      expect(buildHash(restored), JSON.stringify(contents).slice(0, 80)).toBe(
        buildHash(BASELINE_BLUEPRINT),
      );
      expect(validateBlueprint(restored, CATALOG).ok).toBe(true);
    }
    expect(({} as Record<string, unknown>).chassisId).toBeUndefined();
    // Storage that throws is the same as no storage.
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => undefined,
    };
    expect(restoreBlueprint(broken)).toBe(BASELINE_BLUEPRINT);
  });
});
