import type { RaceEnvironment, VehicleLoadout, VehicleParams } from '@bolt/shared';
import { deriveVehicleParams, wheelKitPrice } from '@bolt/shared';
import { CHASSIS } from './chassis.js';
import { ENGINES, PAINTS, TIRES } from './parts.js';
import { getWeatherPreset } from './weather.js';

/** Semantic version of the shipped catalog and balance data. Bump on any value change. */
export const CATALOG_VERSION = '0.1.0';

export const DEFAULT_LOADOUT: VehicleLoadout = {
  chassisId: 'chassis_beetle',
  engineId: 'engine_four_cylinder',
  tireKitId: 'tires_street',
  paintId: 'paint_signal',
};

export type LoadoutCheck =
  | { ok: true; params: VehicleParams; totalCost: number }
  | { ok: false; reason: 'UNKNOWN_PART'; detail: string };

function own<T>(table: Record<string, T>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}

/**
 * Server-side validation of the three mandatory parts. The client never supplies totals or
 * coefficients; they are always derived here from catalog data.
 */
export function resolveLoadout(loadout: VehicleLoadout): LoadoutCheck {
  const chassis = own(CHASSIS, loadout.chassisId);
  if (!chassis) return { ok: false, reason: 'UNKNOWN_PART', detail: loadout.chassisId };
  const engine = own(ENGINES, loadout.engineId);
  if (!engine) return { ok: false, reason: 'UNKNOWN_PART', detail: loadout.engineId };
  const tires = own(TIRES, loadout.tireKitId);
  if (!tires) return { ok: false, reason: 'UNKNOWN_PART', detail: loadout.tireKitId };
  if (!own(PAINTS, loadout.paintId)) return { ok: false, reason: 'UNKNOWN_PART', detail: loadout.paintId };
  return {
    ok: true,
    params: deriveVehicleParams(chassis, engine, tires),
    totalCost: chassis.price + engine.price + wheelKitPrice(tires, chassis.wheelCount),
  };
}

export function environmentFor(weatherPresetId: string): RaceEnvironment | undefined {
  const preset = getWeatherPreset(weatherPresetId);
  if (!preset) return undefined;
  return { weather: preset.weather, wetness: preset.wetness };
}
