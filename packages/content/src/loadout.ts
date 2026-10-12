import type {
  BuildConditions,
  RaceEnvironment,
  ResolvedBuild,
  VehicleBlueprint,
  VehicleLoadout,
  VehicleParams,
} from '@bolt/shared';
import {
  BLUEPRINT_FORMAT_VERSION,
  DEFAULT_CONDITIONS,
  blueprintCost,
  deriveVehicleParams,
  own,
  resolveBlueprint,
  validateBlueprint,
} from '@bolt/shared';
import { CATALOG, CATALOG_VERSION } from './catalog.js';
import { getTrack } from './tracks.js';
import { getWeatherPreset } from './weather.js';

/** The default car of Section 6.3: Beetle, Four-Cylinder, Street Tires. 370 credits. */
export const DEFAULT_LOADOUT: VehicleLoadout = {
  chassisId: 'chassis_beetle',
  engineId: 'engine_four_cylinder',
  tireKitId: 'tires_street',
  paintId: 'paint_signal',
};

/** Fixed timestamp for shipped blueprints, so templates are byte-stable. */
export const SHIPPED_AT = '2026-10-10T00:00:00Z';

/**
 * A bare car: the three mandatory parts and nothing else. Omitted ids fall back to the
 * chassis' default engine and Street Tires. Used for the baseline car, by the home screen
 * picker until the garage exists, and by tests that only care about the essentials.
 */
export function baselineBlueprint(
  choice: Partial<VehicleLoadout> = {},
  name?: string,
): VehicleBlueprint {
  const chassisId = choice.chassisId ?? DEFAULT_LOADOUT.chassisId;
  const chassis = own(CATALOG.chassis, chassisId);
  return {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    catalogVersion: CATALOG_VERSION,
    name: name ?? chassis?.displayName ?? 'My Car',
    chassisId,
    engineId: choice.engineId ?? chassis?.defaultEngineId ?? DEFAULT_LOADOUT.engineId,
    tireKitId: choice.tireKitId ?? DEFAULT_LOADOUT.tireKitId,
    paintId: choice.paintId ?? DEFAULT_LOADOUT.paintId,
    parts: [],
    createdAt: SHIPPED_AT,
  };
}

/** The four ids the renderer draws from, before any sprite fallback. */
export function blueprintLoadout(blueprint: VehicleBlueprint): VehicleLoadout {
  return {
    chassisId: blueprint.chassisId,
    engineId: blueprint.engineId,
    tireKitId: blueprint.tireKitId,
    paintId: blueprint.paintId,
  };
}

export type BuildCheck =
  | { ok: true; params: VehicleParams; totalCost: number; build: ResolvedBuild; buildHash: string }
  | { ok: false; reason: string; detail: string };

/**
 * Validates a blueprint against the shipped catalog and derives its coefficients for the
 * published conditions. This is what the server runs at join; the client runs the same code
 * for its predicted car.
 */
export function resolveBuild(
  blueprint: VehicleBlueprint,
  conditions: BuildConditions = DEFAULT_CONDITIONS,
): BuildCheck {
  const check = validateBlueprint(blueprint, CATALOG);
  if (!check.ok) {
    const first = check.issues.find((i) => i.severity === 'error');
    return { ok: false, reason: first?.code ?? 'ILLEGAL_BUILD', detail: first?.partId ?? '' };
  }
  return {
    ok: true,
    params: deriveVehicleParams(check.build, conditions),
    totalCost: check.totalCost,
    build: check.build,
    buildHash: check.buildHash,
  };
}

export type LoadoutCheck =
  | { ok: true; params: VehicleParams; totalCost: number }
  | { ok: false; reason: 'UNKNOWN_PART'; detail: string };

/**
 * Coefficients for a bare car named by its three part ids, under a clear day. A convenience
 * for benches and tests; races always go through `resolveBuild` with a full blueprint.
 */
export function resolveLoadout(loadout: VehicleLoadout): LoadoutCheck {
  const blueprint = baselineBlueprint(loadout, 'Bench');
  const build = resolveBlueprint(blueprint, CATALOG);
  if (!build || !own(CATALOG.paints, loadout.paintId)) {
    const missing =
      (!own(CATALOG.chassis, loadout.chassisId) && loadout.chassisId) ||
      (!own(CATALOG.engines, loadout.engineId) && loadout.engineId) ||
      (!own(CATALOG.tires, loadout.tireKitId) && loadout.tireKitId) ||
      loadout.paintId;
    return { ok: false, reason: 'UNKNOWN_PART', detail: String(missing) };
  }
  return {
    ok: true,
    params: deriveVehicleParams(build),
    totalCost: blueprintCost(blueprint, CATALOG).total,
  };
}

export function environmentFor(weatherPresetId: string): RaceEnvironment | undefined {
  const preset = getWeatherPreset(weatherPresetId);
  if (!preset) return undefined;
  return {
    weather: preset.weather,
    wetness: preset.wetness,
    windX: preset.windX,
    windY: preset.windY,
  };
}

/**
 * Published build conditions for a track and weather preset: what the garage shows scores
 * for and what the server derives coefficients under (Sections 5.5 and 6.2).
 */
export function conditionsFor(
  trackId: string,
  weatherPresetId: string,
): BuildConditions | undefined {
  const preset = getWeatherPreset(weatherPresetId);
  const track = getTrack(trackId);
  if (!preset || !track) return undefined;
  return { weather: preset.weather, timeOfDay: preset.timeOfDay, surfaceMix: track.surfaceMix };
}
