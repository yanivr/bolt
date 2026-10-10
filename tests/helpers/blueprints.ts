import { CATALOG, baselineBlueprint } from '@bolt/content';
import type {
  AccessoryDefinition,
  BlueprintIssueCode,
  BlueprintPart,
  BlueprintValidation,
  MountPoint,
  QuarterTurn,
  VehicleBlueprint,
} from '@bolt/shared';
import { allowedRotations, mountAccepts, rotatedFootprint, validateBlueprint } from '@bolt/shared';

/** A bare car on a chassis, optionally with other essentials, plus the parts given. */
export function car(
  chassisId: string,
  parts: Array<Partial<BlueprintPart> & { partId: string; mountId: string }> = [],
  essentials: { engineId?: string; tireKitId?: string } = {},
): VehicleBlueprint {
  return {
    ...baselineBlueprint({ chassisId, ...essentials }, 'Test Car'),
    parts: parts.map((p, i) => ({
      instanceId: `t${i + 1}`,
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 0,
      ...p,
    })),
  };
}

export function check(blueprint: VehicleBlueprint): BlueprintValidation {
  return validateBlueprint(blueprint, CATALOG);
}

export function errorCodes(result: BlueprintValidation): BlueprintIssueCode[] {
  return result.issues.filter((i) => i.severity === 'error').map((i) => i.code);
}

export function warningCodes(result: BlueprintValidation): BlueprintIssueCode[] {
  return result.issues.filter((i) => i.severity === 'warning').map((i) => i.code);
}

/** First rotation the mount allows at which the part's footprint fits, or null. */
export function fittingRotation(mount: MountPoint, part: AccessoryDefinition): QuarterTurn | null {
  if (!mountAccepts(mount, part)) return null;
  for (const turn of allowedRotations(mount, part)) {
    const size = rotatedFootprint(part.footprint, turn);
    if (size.w <= mount.maxFootprint.w && size.h <= mount.maxFootprint.h) return turn;
  }
  return null;
}

/**
 * A cheap, light part that fits a mount, with the rotation to use. Passive parts are
 * preferred so the probe never trips the fire-button or weapon-count rules.
 */
export function probeFor(mount: MountPoint): { part: AccessoryDefinition; turn: QuarterTurn } {
  const candidates = Object.values(CATALOG.parts)
    .filter((p) => p.category !== 'weapon')
    .sort((a, b) => a.massKg - b.massKg || a.price - b.price);
  for (const part of candidates) {
    const turn = fittingRotation(mount, part);
    if (turn !== null) return { part, turn };
  }
  throw new Error(`nothing fits ${mount.id}`);
}
