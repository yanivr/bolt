import type {
  CarAtlasManifest,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  SpriteSheetRef,
} from './assets.js';
import { resolveBlueprint } from './blueprint.js';
import type { MountedPartSprite } from './compose.js';
import type { Catalog, VehicleBlueprint, VehicleLoadout } from './types.js';

/**
 * Honest sprite fallback while the artists finish the catalog. The rules and the physics
 * already know all 105 parts; the car atlas does not have art for most of them yet. Until it
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

/** The engine sheet a chassis draws: the tail version, or the piped-in version for a bay. */
export function engineSheetFor(
  chassis: ChassisSpriteManifest,
  engine: EngineSpriteManifest,
): SpriteSheetRef {
  return chassis.engineInBay && engine.bay ? engine.bay : engine.sheet;
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

const DEFAULT_MOUNT_HEIGHT = 10;

/**
 * Mounted accessories of a blueprint that have art, positioned for the compositor. Parts whose
 * sprite sheet is not baked yet are left out of the drawing only.
 */
export function mountedPartSprites(
  cars: CarAtlasManifest,
  blueprint: VehicleBlueprint,
  catalog: Catalog,
): MountedPartSprite[] {
  const build = resolveBlueprint(blueprint, catalog);
  const sheets = cars.parts ?? {};
  const heights = cars.chassis[blueprint.chassisId]?.mountHeights ?? {};
  if (!build) return [];
  return build.parts
    .filter((placed) => has(sheets, placed.def.id))
    .map((placed) => ({
      instanceId: placed.instance.instanceId,
      partId: placed.def.id,
      x: placed.x,
      y: placed.y,
      z: has(heights, placed.mount.id) ? heights[placed.mount.id]! : DEFAULT_MOUNT_HEIGHT,
      quarterTurns: placed.instance.rotationQuarterTurns,
    }));
}
