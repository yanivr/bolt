import type { CarAtlasManifest } from './assets.js';
import type { Catalog, VehicleBlueprint, VehicleLoadout } from './types.js';

/**
 * Honest sprite fallback while the artists finish the catalog. The rules and the physics
 * already know all 120 parts; the car atlas does not have art for most of them yet. Until it
 * does, a car is drawn with the default engine and wheel sprites when its own are missing.
 * This changes pixels only: the blueprint that is validated, hashed and simulated is never
 * touched. A chassis has no stand-in, so a chassis without art cannot be picked.
 */

export const FALLBACK_ENGINE_SPRITE = 'engine_four_cylinder';
export const FALLBACK_TIRE_SPRITE = 'tires_street';
export const FALLBACK_PAINT = 'paint_signal';

function has(table: Record<string, unknown>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, id);
}

export type CarSprites = {
  /** Ids to draw with. Null when the chassis has no art, in which case nothing can be drawn. */
  loadout: VehicleLoadout | null;
  /** Part ids that were replaced by a stand-in for drawing. */
  substituted: string[];
};

export function resolveCarSprites(cars: CarAtlasManifest, blueprint: VehicleBlueprint): CarSprites {
  const substituted: string[] = [];
  if (!has(cars.chassis, blueprint.chassisId)) return { loadout: null, substituted };
  let engineId = blueprint.engineId;
  if (!has(cars.engines, engineId)) {
    substituted.push(engineId);
    engineId = FALLBACK_ENGINE_SPRITE;
  }
  let tireKitId = blueprint.tireKitId;
  if (!has(cars.wheels, tireKitId)) {
    substituted.push(tireKitId);
    tireKitId = FALLBACK_TIRE_SPRITE;
  }
  if (!has(cars.engines, engineId) || !has(cars.wheels, tireKitId))
    return { loadout: null, substituted };
  const paintId = has(cars.paints, blueprint.paintId) ? blueprint.paintId : FALLBACK_PAINT;
  return { loadout: { chassisId: blueprint.chassisId, engineId, tireKitId, paintId }, substituted };
}

/** Chassis ids that can be shown and driven today, in catalog order. */
export function drawableChassisIds(cars: CarAtlasManifest, catalog: Catalog): string[] {
  return Object.keys(catalog.chassis).filter((id) => has(cars.chassis, id));
}

/** Every catalog part the car atlas has no sprite sheet for, in catalog order. */
export function partsWithoutSprites(cars: CarAtlasManifest, catalog: Catalog): string[] {
  const mounted = cars.parts ?? {};
  return [
    ...Object.keys(catalog.chassis).filter((id) => !has(cars.chassis, id)),
    ...Object.keys(catalog.engines).filter((id) => !has(cars.engines, id)),
    ...Object.keys(catalog.tires).filter((id) => !has(cars.wheels, id)),
    ...Object.keys(catalog.parts).filter((id) => !has(mounted, id)),
  ];
}
