import type { MountedPartSprite, VehicleLoadout } from '@bolt/shared';
import { engineSheetFor } from '@bolt/shared';
import type { GameManifests } from '../assets.js';
import type { CarTextureKeys } from '../composition/CarView.js';

/** What it takes to draw a car in the race: the sheets to use and its mounted parts. */
export type RivalSprites = { loadout: VehicleLoadout; parts: MountedPartSprite[] };

type SheetRef = { file: string; frameWidth: number; frameHeight: number };

/** Sprite sheets a car needs, as `[key, file reference]` pairs for the scene's loader. */
export function rivalSheets(
  manifests: GameManifests,
  sprites: RivalSprites,
): Array<[string, SheetRef]> {
  const { loadout, parts } = sprites;
  const chassis = manifests.cars.chassis[loadout.chassisId];
  const wheels = manifests.cars.wheels[loadout.tireKitId];
  const engine = manifests.cars.engines[loadout.engineId];
  if (!chassis || !wheels || !engine) return [];
  const out: Array<[string, SheetRef]> = [
    [`car:${chassis.id}:body`, chassis.body],
    [`car:${chassis.id}:shadow`, chassis.shadow],
    [`car:${chassis.id}:brake`, chassis.brakeLights],
    [`car:${chassis.id}:head`, chassis.headlights],
    [`wheel:${loadout.tireKitId}`, wheels.sheet],
    [
      `engine:${loadout.engineId}:${chassis.engineInBay ? 'bay' : 'tail'}`,
      engineSheetFor(chassis, engine),
    ],
  ];
  for (const partId of new Set(parts.map((p) => p.partId))) {
    const ref = manifests.cars.parts?.[partId];
    if (ref) out.push([`part:${partId}`, ref.sheet]);
  }
  return out;
}

/** Texture keys of a car's layers, as the scene's loader named them. */
export function carTextureKeys(manifests: GameManifests, sprites: RivalSprites): CarTextureKeys {
  const { loadout, parts } = sprites;
  const chassis = manifests.cars.chassis[loadout.chassisId];
  const bay = chassis?.engineInBay ? 'bay' : 'tail';
  return {
    body: `car:${loadout.chassisId}:body`,
    shadow: `car:${loadout.chassisId}:shadow`,
    brake: `car:${loadout.chassisId}:brake`,
    head: `car:${loadout.chassisId}:head`,
    wheels: `wheel:${loadout.tireKitId}`,
    engine: `engine:${loadout.engineId}:${bay}`,
    parts: Object.fromEntries(parts.map((p) => [p.partId, `part:${p.partId}`])),
    overlay: `car:${loadout.chassisId}:overlay`,
  };
}
