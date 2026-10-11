import type {
  AccessoryCategory,
  AnyPartDefinition,
  Catalog,
  MountPoint,
  PartCategory,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  accessoryMounts,
  allowedRotations,
  mountAccepts,
  own,
  rotatedFootprint,
} from '@bolt/shared';
import type { InstallPlan, Slot } from './buildSession.js';
import { issueText, partsOnMount, planInstall } from './buildSession.js';

/**
 * What the side panel lists for a slot, as plain data. A mount lists exactly the accessories
 * that can physically sit on it; each entry carries the plan the Install button would run,
 * so a reason shown on a row is the reason the press would give. Nothing here touches the
 * browser: the selectors are unit tested against the validator.
 */

export const ACCESSORY_CATEGORIES: readonly AccessoryCategory[] = ['weapon', 'defense', 'utility'];

export type SlotEntry = {
  part: AnyPartDefinition;
  /** Copies on the car now: 1 for the current chassis, engine or wheel kit. */
  installed: number;
  /** This very part is what the slot holds now. */
  here: boolean;
  /** Why it cannot be bought right now, in approved copy. Null when it can. */
  blocked: string | null;
  action: InstallPlan['action'];
  /** The mount an accessory would go on, when the plan found one. */
  mountId: string | null;
  /** The part that would come off to make room. */
  replaces: string | null;
  /** A chassis the car atlas cannot draw yet. */
  pending: boolean;
};

export type SlotOptions = {
  /** Chassis the car atlas can draw. Without it every chassis is offered. */
  drawable?: ReadonlySet<string>;
};

/** Whether a part can physically go on a mount in some allowed orientation. */
export function fitsMount(mount: MountPoint, part: AnyPartDefinition): boolean {
  if (part.category === 'chassis' || part.category === 'engine' || part.category === 'tires')
    return false;
  if (!mountAccepts(mount, part)) return false;
  return allowedRotations(mount, part).some((turns) => {
    const size = rotatedFootprint(part.footprint, turns);
    return size.w <= mount.maxFootprint.w && size.h <= mount.maxFootprint.h;
  });
}

export function slotKey(slot: Slot): string {
  return slot.kind === 'mount' ? `mount:${slot.mountId}` : slot.kind;
}

export function sameSlot(a: Slot | null, b: Slot | null): boolean {
  return a !== null && b !== null && slotKey(a) === slotKey(b);
}

function copies(blueprint: VehicleBlueprint, partId: string): number {
  return partId === blueprint.chassisId ||
    partId === blueprint.engineId ||
    partId === blueprint.tireKitId
    ? 1
    : blueprint.parts.filter((p) => p.partId === partId).length;
}

function entry(
  blueprint: VehicleBlueprint,
  part: AnyPartDefinition,
  plan: InstallPlan,
  here: boolean,
): SlotEntry {
  return {
    part,
    installed: copies(blueprint, part.id),
    here,
    blocked: plan.result.ok ? null : issueText(plan.result.issue),
    action: plan.action,
    mountId: plan.mountId,
    replaces: plan.replaced && plan.result.ok ? plan.replaced.def.displayName : null,
    pending: false,
  };
}

function essentials(catalog: Catalog, category: PartCategory): AnyPartDefinition[] {
  if (category === 'chassis') return Object.values(catalog.chassis);
  if (category === 'engine') return Object.values(catalog.engines);
  if (category === 'tires') return Object.values(catalog.tires);
  return Object.values(catalog.parts).filter((part) => part.category === category);
}

function essentialEntries(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  category: 'chassis' | 'engine' | 'tires',
  options: SlotOptions,
): SlotEntry[] {
  return essentials(catalog, category).map((part): SlotEntry => {
    const pending =
      category === 'chassis' && options.drawable !== undefined && !options.drawable.has(part.id);
    const plan = planInstall(blueprint, catalog, part.id);
    const made = entry(blueprint, part, plan, plan.action === 'current');
    return pending ? { ...made, blocked: null, pending } : made;
  });
}

/**
 * The parts for one slot. For a mount: every weapon, defense and utility that fits it, in
 * that order, and nothing that does not. A row is blocked only for a reason that is not about
 * fit: credits, weight, a per-car limit, a neighbor in the way.
 */
export function partsForSlot(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  slot: Slot,
  options: SlotOptions = {},
): SlotEntry[] {
  if (slot.kind !== 'mount') return essentialEntries(blueprint, catalog, slot.kind, options);
  const chassis = own(catalog.chassis, blueprint.chassisId);
  const mount = chassis ? accessoryMounts(chassis).find((m) => m.id === slot.mountId) : undefined;
  if (!mount) return [];
  const holding = new Set(partsOnMount(blueprint, catalog, mount.id).map((p) => p.def.id));
  return ACCESSORY_CATEGORIES.flatMap((category) =>
    essentials(catalog, category)
      .filter((part) => fitsMount(mount, part))
      .map((part) =>
        entry(
          blueprint,
          part,
          planInstall(blueprint, catalog, part.id, mount.id),
          holding.has(part.id),
        ),
      ),
  );
}

/**
 * One category of the whole catalog, for Browse All Parts. An accessory is planned for the
 * best free mount; one that fits no mount of this chassis is listed with that reason.
 */
export function catalogEntries(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  category: PartCategory,
  options: SlotOptions = {},
): SlotEntry[] {
  if (category === 'chassis' || category === 'engine' || category === 'tires')
    return essentialEntries(blueprint, catalog, category, options);
  return essentials(catalog, category).map((part) => {
    const free = planInstall(blueprint, catalog, part.id);
    if (free.result.ok || free.result.issue.code !== 'NO_COMPATIBLE_MOUNT')
      return entry(blueprint, part, free, false);
    // No free mount. If it fits one that is taken, the offer is to replace what is there;
    // only a part this chassis has no mount for at all is listed as having none.
    const taken = mountsFor(blueprint, catalog, part)[0];
    return taken
      ? entry(blueprint, part, planInstall(blueprint, catalog, part.id, taken.id), false)
      : entry(blueprint, part, free, false);
  });
}

/** Mounts of the current chassis a part could physically sit on, taken or not. */
export function mountsFor(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  part: AnyPartDefinition,
): MountPoint[] {
  const chassis = own(catalog.chassis, blueprint.chassisId);
  return chassis ? accessoryMounts(chassis).filter((mount) => fitsMount(mount, part)) : [];
}
