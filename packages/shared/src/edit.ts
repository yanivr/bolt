import { MAX_GARAGE_HISTORY, MAX_MANUAL_WEAPONS, STARTING_CREDITS } from './balance.js';
import type { CostLine, PlacedPart } from './blueprint.js';
import {
  accessoryMounts,
  allowedRotations,
  blueprintCost,
  fitsMountBox,
  canonicalizeBlueprint,
  findMount,
  mountAccepts,
  mountArc,
  own,
  placePart,
  resolveBlueprint,
  snapOffset,
} from './blueprint.js';
import { clamp } from './math.js';
import type { BlueprintIssue, BlueprintIssueCode } from './validate.js';
import {
  BLUEPRINT_ISSUE_COPY,
  placementProblems,
  takesFireButton,
  validateBlueprint,
} from './validate.js';
import type {
  AccessoryDefinition,
  BlueprintPart,
  Catalog,
  ChassisDefinition,
  MountPoint,
  QuarterTurn,
  VehicleBlueprint,
} from './types.js';

/**
 * Garage editing. Every function is pure: it takes a blueprint and returns a new one with
 * the spend and refund the change causes, or a refusal that names the reason. Nothing is
 * ever spent silently and nothing is mutated, so undo and redo are a list of values.
 */

export type SpendBreakdown = {
  /** Credits for items the new blueprint has and the old one did not. */
  newSpend: number;
  /** Credits returned for items the old blueprint had and the new one does not. */
  refund: number;
  /** `newSpend - refund`. */
  net: number;
  totalCost: number;
  creditsLeft: number;
};

export type RemovedPart = {
  instance: BlueprintPart;
  refund: number;
  reason: BlueprintIssueCode;
  message: string;
};

export type EditResult =
  | {
      ok: true;
      blueprint: VehicleBlueprint;
      spend: SpendBreakdown;
      /** Parts the change had to take off the car, each refunded in full. */
      removed: RemovedPart[];
      /** The instance the edit created or changed, when there is one. */
      instanceId?: string;
    }
  | { ok: false; blueprint: VehicleBlueprint; issue: BlueprintIssue };

export type Placement = {
  mountId: string;
  offsetX: number;
  offsetY: number;
  rotationQuarterTurns: QuarterTurn;
};

function lineKey(line: CostLine): string {
  return `${line.slot}:${line.partId}:${line.price}`;
}

/**
 * New spend and refund between two blueprints, item by item (Section 6.2: "every comparison
 * shows new spend and refund separately"). Moving or rotating a part costs nothing.
 */
export function compareCost(
  before: VehicleBlueprint,
  after: VehicleBlueprint,
  catalog: Catalog,
): SpendBreakdown {
  const a = blueprintCost(before, catalog);
  const b = blueprintCost(after, catalog);
  const pool = new Map<string, number>();
  for (const line of a.lines) pool.set(lineKey(line), (pool.get(lineKey(line)) ?? 0) + 1);
  let newSpend = 0;
  for (const line of b.lines) {
    const left = pool.get(lineKey(line)) ?? 0;
    if (left > 0) pool.set(lineKey(line), left - 1);
    else newSpend += line.price;
  }
  let refund = 0;
  for (const line of a.lines) {
    const left = pool.get(lineKey(line)) ?? 0;
    if (left > 0) {
      pool.set(lineKey(line), left - 1);
      refund += line.price;
    }
  }
  return {
    newSpend,
    refund,
    net: newSpend - refund,
    totalCost: b.total,
    creditsLeft: STARTING_CREDITS - b.total,
  };
}

function refuse(
  blueprint: VehicleBlueprint,
  code: BlueprintIssueCode,
  fields: Partial<BlueprintIssue> = {},
): EditResult {
  return {
    ok: false,
    blueprint,
    issue: { code, severity: 'error', message: BLUEPRINT_ISSUE_COPY[code], ...fields },
  };
}

function errorKey(i: BlueprintIssue): string {
  return `${i.code}|${i.instanceId ?? ''}|${i.mountId ?? ''}|${i.slot ?? ''}|${i.otherInstanceId ?? ''}`;
}

/**
 * A conflict between two parts is reported on whichever comes later in canonical order. When
 * the edit is what caused it, the highlight belongs on the part the player just touched, so
 * the two ends are swapped. The turret line of Section 6.6 already names the right part.
 */
function aboutEdited(
  found: BlueprintIssue,
  next: VehicleBlueprint,
  instanceId: string | undefined,
): BlueprintIssue {
  if (
    instanceId === undefined ||
    found.otherInstanceId !== instanceId ||
    found.instanceId === undefined ||
    (found.code !== 'MOUNT_OCCUPIED' && found.code !== 'PART_BLOCKS_ANOTHER') ||
    found.message !== BLUEPRINT_ISSUE_COPY[found.code]
  )
    return found;
  const edited = next.parts.find((p) => p.instanceId === instanceId);
  if (!edited) return found;
  return {
    ...found,
    instanceId,
    partId: edited.partId,
    mountId: edited.mountId,
    otherInstanceId: found.instanceId,
  };
}

/**
 * Accepts an edit unless it introduces an error the blueprint did not already have, or
 * deepens a budget, weight or armor overrun. A draft that is already illegal (an imported
 * build after a balance patch, say) can therefore still be edited toward legality.
 */
function commit(
  before: VehicleBlueprint,
  after: VehicleBlueprint,
  catalog: Catalog,
  removed: RemovedPart[] = [],
  instanceId?: string,
): EditResult {
  const next = canonicalizeBlueprint(after);
  const was = validateBlueprint(before, catalog);
  const now = validateBlueprint(next, catalog);
  const old = new Set(was.issues.filter((i) => i.severity === 'error').map(errorKey));
  for (const found of now.issues) {
    if (found.severity !== 'error') continue;
    const growing =
      (found.code === 'NOT_ENOUGH_CREDITS' && now.totalCost > was.totalCost) ||
      (found.code === 'TOO_HEAVY' && now.loadKg > was.loadKg);
    if (!old.has(errorKey(found)) || growing)
      return { ok: false, blueprint: before, issue: aboutEdited(found, next, instanceId) };
  }
  const result: EditResult = {
    ok: true,
    blueprint: next,
    spend: compareCost(before, next, catalog),
    removed,
  };
  if (instanceId !== undefined) result.instanceId = instanceId;
  return result;
}

/** The lowest unused `p<number>` instance id. Deterministic, so edits stay pure. */
export function nextInstanceId(blueprint: VehicleBlueprint): string {
  const used = new Set(blueprint.parts.map((p) => p.instanceId));
  for (let n = 1; ; n++) if (!used.has(`p${n}`)) return `p${n}`;
}

function placedParts(blueprint: VehicleBlueprint, catalog: Catalog): PlacedPart[] {
  return resolveBlueprint(blueprint, catalog)?.parts ?? [];
}

const OFFSET_TRIES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/** First legal placement of a part on one mount: preferred rotation, then offsets. */
function placementOnMount(
  chassis: ChassisDefinition,
  placed: readonly PlacedPart[],
  def: AccessoryDefinition,
  mount: MountPoint,
  prefer?: Partial<Placement>,
): Placement | null {
  if (!mountAccepts(mount, def)) return null;
  const rotations = [...allowedRotations(mount, def)];
  if (
    prefer?.rotationQuarterTurns !== undefined &&
    rotations.includes(prefer.rotationQuarterTurns)
  ) {
    rotations.splice(rotations.indexOf(prefer.rotationQuarterTurns), 1);
    rotations.unshift(prefer.rotationQuarterTurns);
  }
  const offsets: Array<readonly [number, number]> = [];
  if (prefer?.offsetX !== undefined || prefer?.offsetY !== undefined)
    offsets.push([
      clamp(snapOffset(prefer.offsetX ?? 0), -mount.regionHalfW, mount.regionHalfW),
      clamp(snapOffset(prefer.offsetY ?? 0), -mount.regionHalfH, mount.regionHalfH),
    ]);
  for (const [sx, sy] of OFFSET_TRIES)
    offsets.push([sx * Math.floor(mount.regionHalfW), sy * Math.floor(mount.regionHalfH)]);
  if (!fitsMountBox(mount, def)) return null;
  for (const rotation of rotations) {
    for (const [offsetX, offsetY] of offsets) {
      const candidate = placePart(
        {
          instanceId: '~candidate',
          partId: def.id,
          mountId: mount.id,
          offsetX,
          offsetY,
          rotationQuarterTurns: rotation,
        },
        def,
        mount,
      );
      if (placementProblems(chassis, placed, candidate).length === 0)
        return { mountId: mount.id, offsetX, offsetY, rotationQuarterTurns: rotation };
    }
  }
  return null;
}

function mountPreference(def: AccessoryDefinition, mount: MountPoint): number {
  // Earlier entries in the part's own list are where it belongs; universal mounts and the
  // Horseshoe cavity come after every named match.
  let best = def.compatibleMounts.length + 1;
  for (const category of mount.categories) {
    const index = def.compatibleMounts.indexOf(category);
    if (index >= 0 && index < best) best = index;
  }
  return best;
}

/**
 * The best free compatible mount for a part, with a legal offset and rotation, or null when
 * the car has nowhere to put it. "Best" prefers the mount categories the part lists first,
 * then the smallest mount that fits (so large mounts stay free for large parts), then the
 * chassis' own mount order. A small part will share a rack only when nothing else is free.
 */
export function suggestMount(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  partId: string,
): Placement | null {
  const build = resolveBlueprint(blueprint, catalog);
  const def = own(catalog.parts, partId);
  if (!build || !def) return null;
  const mounts = accessoryMounts(build.chassis)
    .map((mount, index) => ({
      mount,
      index,
      taken: build.parts.some((p) => p.mount.id === mount.id) ? 1 : 0,
      preference: mountPreference(def, mount),
      area: mount.maxFootprint.w * mount.maxFootprint.h,
    }))
    .sort(
      (a, b) =>
        a.taken - b.taken || a.preference - b.preference || a.area - b.area || a.index - b.index,
    );
  for (const { mount } of mounts) {
    const placement = placementOnMount(build.chassis, build.parts, def, mount);
    if (placement) return placement;
  }
  return null;
}

/** Fire-button defaults for a newly installed weapon (Section 8.3). */
function defaultFireControl(
  blueprint: VehicleBlueprint,
  def: AccessoryDefinition,
): Pick<BlueprintPart, 'assignedActionSlot' | 'autoMode'> {
  if (!takesFireButton(def)) return {};
  const used = new Set(blueprint.parts.map((p) => p.assignedActionSlot));
  for (let slot = 0; slot < MAX_MANUAL_WEAPONS; slot++)
    if (!used.has(slot as 0 | 1)) return { assignedActionSlot: slot as 0 | 1 };
  return def.triggerMode === 'hybrid' ? { autoMode: true } : {};
}

/**
 * Buys a part and installs it. With no placement the best free mount is used; with a mount
 * id alone, the first legal offset and rotation on that mount. A manual or hybrid weapon
 * takes the first free fire button; with both taken a hybrid goes automatic and a manual
 * weapon is installed inactive (the validator then warns about it).
 */
export function installPart(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  partId: string,
  placement?: Partial<Placement>,
): EditResult {
  const def = own(catalog.parts, partId);
  if (!def) return refuse(blueprint, 'UNKNOWN_PART', { partId });
  const build = resolveBlueprint(blueprint, catalog);
  if (!build) return refuse(blueprint, 'MISSING_ESSENTIAL');

  let where: Placement | null;
  if (placement?.mountId === undefined) {
    where = suggestMount(blueprint, catalog, partId);
    if (!where) return refuse(blueprint, 'NO_COMPATIBLE_MOUNT', { partId });
  } else {
    const mount = findMount(build.chassis, placement.mountId);
    if (!mount) return refuse(blueprint, 'UNKNOWN_MOUNT', { partId, mountId: placement.mountId });
    const complete =
      placement.offsetX !== undefined &&
      placement.offsetY !== undefined &&
      placement.rotationQuarterTurns !== undefined;
    where = complete
      ? {
          mountId: mount.id,
          offsetX: placement.offsetX!,
          offsetY: placement.offsetY!,
          rotationQuarterTurns: placement.rotationQuarterTurns!,
        }
      : (placementOnMount(build.chassis, build.parts, def, mount, placement) ?? {
          // Nothing legal on this mount: place it as asked so the refusal names the real reason.
          mountId: mount.id,
          offsetX: placement.offsetX ?? 0,
          offsetY: placement.offsetY ?? 0,
          rotationQuarterTurns:
            placement.rotationQuarterTurns ?? allowedRotations(mount, def)[0] ?? 0,
        });
  }

  const instanceId = nextInstanceId(blueprint);
  const instance: BlueprintPart = {
    instanceId,
    partId,
    mountId: where.mountId,
    offsetX: snapOffset(where.offsetX),
    offsetY: snapOffset(where.offsetY),
    rotationQuarterTurns: where.rotationQuarterTurns,
    ...defaultFireControl(blueprint, def),
  };
  return commit(
    blueprint,
    { ...blueprint, parts: [...blueprint.parts, instance] },
    catalog,
    [],
    instanceId,
  );
}

/** Sells an installed part for its full price. */
export function removePart(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  instanceId: string,
): EditResult {
  if (!blueprint.parts.some((p) => p.instanceId === instanceId))
    return refuse(blueprint, 'UNKNOWN_PART', { instanceId });
  const next = { ...blueprint, parts: blueprint.parts.filter((p) => p.instanceId !== instanceId) };
  return commit(blueprint, next, catalog);
}

/**
 * Moves a part: to another mount, to another offset on its mount, or both. Omitted fields
 * keep their value, except that a change of mount resets the offset to the centre and takes
 * the new mount's default facing when the current one is not allowed there.
 */
export function movePart(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  instanceId: string,
  to: Partial<Placement>,
): EditResult {
  const current = blueprint.parts.find((p) => p.instanceId === instanceId);
  if (!current) return refuse(blueprint, 'UNKNOWN_PART', { instanceId });
  const build = resolveBlueprint(blueprint, catalog);
  const def = own(catalog.parts, current.partId);
  if (!build || !def) return refuse(blueprint, 'UNKNOWN_PART', { instanceId });
  const mountId = to.mountId ?? current.mountId;
  const mount = findMount(build.chassis, mountId);
  if (!mount) return refuse(blueprint, 'UNKNOWN_MOUNT', { instanceId, mountId });
  const changedMount = mountId !== current.mountId;
  let rotation = to.rotationQuarterTurns ?? current.rotationQuarterTurns;
  if (to.rotationQuarterTurns === undefined && changedMount) {
    const allowed = allowedRotations(mount, def);
    if (!allowed.includes(rotation)) rotation = allowed[0] ?? 0;
  }
  const moved: BlueprintPart = {
    ...current,
    mountId,
    offsetX: snapOffset(to.offsetX ?? (changedMount ? 0 : current.offsetX)),
    offsetY: snapOffset(to.offsetY ?? (changedMount ? 0 : current.offsetY)),
    rotationQuarterTurns: rotation,
  };
  const next = {
    ...blueprint,
    parts: blueprint.parts.map((p) => (p.instanceId === instanceId ? moved : p)),
  };
  return commit(blueprint, next, catalog, [], instanceId);
}

/**
 * Turns a part. Pass the facing wanted (0 front, 1 right, 2 rear, 3 left), or omit it to step
 * clockwise to the next facing its mount allows. A part with a fixed facing or none is
 * refused with `BAD_ROTATION`.
 */
export function rotatePart(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  instanceId: string,
  rotationQuarterTurns?: QuarterTurn,
): EditResult {
  const current = blueprint.parts.find((p) => p.instanceId === instanceId);
  if (!current) return refuse(blueprint, 'UNKNOWN_PART', { instanceId });
  let rotation = rotationQuarterTurns;
  if (rotation === undefined) {
    const build = resolveBlueprint(blueprint, catalog);
    const def = own(catalog.parts, current.partId);
    const mount = build ? findMount(build.chassis, current.mountId) : undefined;
    if (!build || !def || !mount) return refuse(blueprint, 'UNKNOWN_PART', { instanceId });
    const others = build.parts.filter((p) => p.instance.instanceId !== instanceId);
    for (let step = 1; step <= 3 && rotation === undefined; step++) {
      const turn = ((current.rotationQuarterTurns + step) % 4) as QuarterTurn;
      const trial = placePart({ ...current, rotationQuarterTurns: turn }, def, mount);
      if (placementProblems(build.chassis, others, trial).length === 0) rotation = turn;
    }
    if (rotation === undefined)
      return refuse(blueprint, 'BAD_ROTATION', { instanceId, mountId: current.mountId });
  }
  return movePart(blueprint, catalog, instanceId, { rotationQuarterTurns: rotation });
}

function distanceScore(
  a: MountPoint,
  from: ChassisDefinition,
  b: MountPoint,
  to: ChassisDefinition,
): number {
  // Compare positions as shares of each body, so "front left" maps to "front left".
  const dx = a.x / from.bodyHalfWidth - b.x / to.bodyHalfWidth;
  const dy = a.y / from.bodyHalfLength - b.y / to.bodyHalfLength;
  return Math.hypot(dx, dy);
}

/**
 * Swaps the chassis as one atomic step. Each installed part is offered, in order, its mount
 * of the same name, then the nearest mount of the same category, then any mount that takes
 * it. Parts with nowhere to go are removed and refunded and come back in `removed`. The
 * wheel kit adapts to the new wheel count. The swap is refused only when the result would
 * be over budget or over weight, in which case nothing changes.
 */
export function swapChassis(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  chassisId: string,
): EditResult {
  const to = own(catalog.chassis, chassisId);
  if (!to) return refuse(blueprint, 'UNKNOWN_PART', { partId: chassisId, slot: 'chassis' });
  const from = own(catalog.chassis, blueprint.chassisId);
  const source = canonicalizeBlueprint(blueprint);
  const kept: BlueprintPart[] = [];
  const placed: PlacedPart[] = [];
  const removed: RemovedPart[] = [];
  const mounts = accessoryMounts(to);

  for (const instance of source.parts) {
    const def = own(catalog.parts, instance.partId);
    if (!def) {
      removed.push({
        instance,
        refund: 0,
        reason: 'UNKNOWN_PART',
        message: BLUEPRINT_ISSUE_COPY.UNKNOWN_PART,
      });
      continue;
    }
    const oldMount = from ? findMount(from, instance.mountId) : undefined;
    const order = mounts
      .map((mount, index) => {
        const sameName = mount.id === instance.mountId ? 0 : 1;
        const sameCategory =
          oldMount && mount.categories[0] === oldMount.categories[0]
            ? 0
            : oldMount && mountArc(mount) === mountArc(oldMount)
              ? 1
              : 2;
        const distance = oldMount && from ? distanceScore(oldMount, from, mount, to) : index;
        return { mount, sameName, sameCategory, distance, index };
      })
      .sort(
        (a, b) =>
          a.sameName - b.sameName ||
          a.sameCategory - b.sameCategory ||
          a.distance - b.distance ||
          a.index - b.index,
      );
    let home: Placement | null = null;
    for (const { mount } of order) {
      home = placementOnMount(to, placed, def, mount, {
        offsetX: instance.offsetX,
        offsetY: instance.offsetY,
        rotationQuarterTurns: instance.rotationQuarterTurns,
      });
      if (home) break;
    }
    if (!home) {
      removed.push({
        instance,
        refund: def.price,
        reason: 'NO_COMPATIBLE_MOUNT',
        message: BLUEPRINT_ISSUE_COPY.NO_COMPATIBLE_MOUNT,
      });
      continue;
    }
    const moved: BlueprintPart = { ...instance, ...home };
    kept.push(moved);
    placed.push(placePart(moved, def, findMount(to, home.mountId)!));
  }

  let next: VehicleBlueprint = { ...source, chassisId, parts: kept };
  // Armor that the new frame cannot carry comes off too, priciest first.
  for (;;) {
    const check = validateBlueprint(next, catalog);
    const armor = check.issues.find((i) => i.code === 'TOO_MUCH_ARMOR' && i.instanceId);
    if (!armor) break;
    const instance = next.parts.find((p) => p.instanceId === armor.instanceId)!;
    removed.push({
      instance,
      refund: own(catalog.parts, instance.partId)?.price ?? 0,
      reason: 'TOO_MUCH_ARMOR',
      message: BLUEPRINT_ISSUE_COPY.TOO_MUCH_ARMOR,
    });
    next = { ...next, parts: next.parts.filter((p) => p.instanceId !== instance.instanceId) };
  }
  return commit(blueprint, next, catalog, removed);
}

export function swapEngine(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  engineId: string,
): EditResult {
  if (!own(catalog.engines, engineId))
    return refuse(blueprint, 'UNKNOWN_PART', { partId: engineId, slot: 'engine' });
  return commit(blueprint, { ...blueprint, engineId }, catalog);
}

/** Replaces the whole wheel kit at once; it is priced for the chassis wheel count. */
export function swapTires(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  tireKitId: string,
): EditResult {
  if (!own(catalog.tires, tireKitId))
    return refuse(blueprint, 'UNKNOWN_PART', { partId: tireKitId, slot: 'tires' });
  return commit(blueprint, { ...blueprint, tireKitId }, catalog);
}

/** Cosmetic changes. Free, and they never change the build hash. */
export function setPaint(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  paintId: string,
): EditResult {
  if (!own(catalog.paints, paintId))
    return refuse(blueprint, 'UNKNOWN_PART', { partId: paintId, slot: 'paint' });
  return commit(blueprint, { ...blueprint, paintId }, catalog);
}
export function renameBlueprint(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  name: string,
): EditResult {
  return commit(blueprint, { ...blueprint, name }, catalog);
}

/**
 * Sets how a weapon is fired. `slot` 0 or 1 binds it to the primary or secondary button and
 * takes that button from whichever weapon had it (a displaced hybrid goes automatic, a
 * displaced manual weapon goes inactive). `'auto'` makes a hybrid fire on its own.
 * `null` leaves the weapon inactive.
 */
export function assignActionSlot(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  instanceId: string,
  slot: 0 | 1 | 'auto' | null,
): EditResult {
  const target = blueprint.parts.find((p) => p.instanceId === instanceId);
  if (!target) return refuse(blueprint, 'UNKNOWN_PART', { instanceId });
  const strip = (p: BlueprintPart): BlueprintPart => {
    const { assignedActionSlot: _slot, autoMode: _auto, ...rest } = p;
    return rest;
  };
  const parts = blueprint.parts.map((p) => {
    if (p.instanceId === instanceId) {
      const bare = strip(p);
      if (slot === 'auto') return { ...bare, autoMode: true };
      if (slot === null) return bare;
      return { ...bare, assignedActionSlot: slot };
    }
    if (slot !== 'auto' && slot !== null && p.assignedActionSlot === slot) {
      const def = own(catalog.parts, p.partId);
      const bare = strip(p);
      return def?.triggerMode === 'hybrid' ? { ...bare, autoMode: true } : bare;
    }
    return p;
  });
  return commit(blueprint, { ...blueprint, parts }, catalog, [], instanceId);
}

/**
 * Gives every installed part a facing that today's rules allow, changing nothing else. A
 * part whose saved quarter turn is still legal keeps it; otherwise it takes its fixed turn,
 * or its mount's default. This is the whole migration from catalogs before 0.5.0, where a
 * part's turn was also how its footprint was made to fit: a Road Mine saved at turn 0 now
 * faces back, a plate turned sideways to fit a narrow nose now faces forward. Nothing is
 * removed and nothing is bought.
 */
export function refaceBlueprint(blueprint: VehicleBlueprint, catalog: Catalog): VehicleBlueprint {
  const chassis = own(catalog.chassis, blueprint.chassisId);
  if (!chassis) return blueprint;
  let changed = false;
  const parts = blueprint.parts.map((part) => {
    const def = own(catalog.parts, part.partId);
    const mount = findMount(chassis, part.mountId);
    if (!def || !mount) return part;
    const allowed = allowedRotations(mount, def);
    if (allowed.includes(part.rotationQuarterTurns)) return part;
    changed = true;
    return { ...part, rotationQuarterTurns: allowed[0] ?? 0 };
  });
  return changed ? { ...blueprint, parts } : blueprint;
}

export type RepairResult =
  | { ok: true; blueprint: VehicleBlueprint; removed: RemovedPart[]; spend: SpendBreakdown }
  | { ok: false; blueprint: VehicleBlueprint; removed: RemovedPart[]; issues: BlueprintIssue[] };

export type RepairOptions = {
  /**
   * A chassis to rebuild on when the blueprint names one the catalog no longer has (a frame
   * retired by a later catalog). Without it such a blueprint cannot be repaired.
   */
  fallbackChassisId?: string;
};

/**
 * Moves a blueprint whose chassis has left the catalog onto a fallback frame. The engine,
 * wheel kit, paint and name are kept. Every part the catalog still has is bought again on
 * the new frame, most expensive first, wherever `suggestMount` finds room, keeping its fire
 * button when the rules still allow one; whatever has no home, no budget or no weight
 * allowance left is reported as removed. Returns null when the essentials cannot be saved.
 */
function rehomeOnFallback(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  fallbackChassisId: string,
): { blueprint: VehicleBlueprint; removed: RemovedPart[] } | null {
  if (!own(catalog.chassis, fallbackChassisId)) return null;
  let next: VehicleBlueprint = canonicalizeBlueprint({
    ...blueprint,
    catalogVersion: catalog.version,
    chassisId: fallbackChassisId,
    parts: [],
  });
  if (validateBlueprint(next, catalog).issues.some((i) => i.severity === 'error')) return null;
  const removed: RemovedPart[] = [];
  const price = (p: BlueprintPart) => own(catalog.parts, p.partId)?.price ?? -1;
  const queue = [...blueprint.parts].sort(
    (a, b) => price(b) - price(a) || (a.instanceId < b.instanceId ? -1 : 1),
  );
  for (const part of queue) {
    const result = installPart(next, catalog, part.partId);
    if (!result.ok) {
      removed.push({
        instance: part,
        refund: Math.max(0, price(part)),
        reason: result.issue.code,
        message: result.issue.message,
      });
      continue;
    }
    next = result.blueprint;
    // Keep the player's own fire button or automatic mode where it is still legal.
    const placed = next.parts.find((p) => p.instanceId === result.instanceId);
    const wanted = part.autoMode ? 'auto' : (part.assignedActionSlot ?? null);
    const has = placed?.autoMode ? 'auto' : (placed?.assignedActionSlot ?? null);
    if (placed && wanted !== has) {
      const assigned = assignActionSlot(next, catalog, placed.instanceId, wanted);
      if (
        assigned.ok &&
        !validateBlueprint(assigned.blueprint, catalog).issues.some((i) => i.severity === 'error')
      )
        next = assigned.blueprint;
    }
  }
  return { blueprint: next, removed };
}

/**
 * The explicit auto-repair of Section 15.6. The blueprint is re-stamped with the current
 * catalog version and every part is given a facing the rules allow (`refaceBlueprint`), then
 * optional parts are removed until it is legal: first any part an
 * error points at, otherwise any part, always the most expensive first. The chassis, engine
 * and wheel kit are never touched, so a blueprint whose essentials are themselves illegal
 * cannot be repaired and comes back with its remaining issues. The one exception is a chassis
 * that has left the catalog: given `fallbackChassisId`, the build is moved onto that frame
 * (see `rehomeOnFallback`) and what could not come along is listed. The input is not
 * modified; save the result as a new revision.
 */
export function repairBlueprint(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  options: RepairOptions = {},
): RepairResult {
  let next: VehicleBlueprint = canonicalizeBlueprint(
    refaceBlueprint({ ...blueprint, catalogVersion: catalog.version }, catalog),
  );
  const removed: RemovedPart[] = [];
  if (options.fallbackChassisId !== undefined && !own(catalog.chassis, blueprint.chassisId)) {
    const rehomed = rehomeOnFallback(blueprint, catalog, options.fallbackChassisId);
    if (rehomed) {
      next = rehomed.blueprint;
      removed.push(...rehomed.removed);
    }
  }
  const price = (p: BlueprintPart) => own(catalog.parts, p.partId)?.price;
  for (;;) {
    const check = validateBlueprint(next, catalog);
    const errors = check.issues.filter((i) => i.severity === 'error');
    if (errors.length === 0)
      return { ok: true, blueprint: next, removed, spend: compareCost(blueprint, next, catalog) };
    if (next.parts.length === 0) return { ok: false, blueprint: next, removed, issues: errors };
    const named = new Set(errors.map((e) => e.instanceId).filter((id): id is string => !!id));
    const pool = named.size > 0 ? next.parts.filter((p) => named.has(p.instanceId)) : next.parts;
    // Parts the catalog no longer has go first, then descending price, then a stable order.
    const victim = [...pool].sort(
      (a, b) =>
        Number(price(a) !== undefined) - Number(price(b) !== undefined) ||
        (price(b) ?? 0) - (price(a) ?? 0) ||
        (a.instanceId < b.instanceId ? -1 : 1),
    )[0]!;
    const reason = errors.find((e) => e.instanceId === victim.instanceId) ?? errors[0]!;
    removed.push({
      instance: victim,
      refund: price(victim) ?? 0,
      reason: reason.code,
      message: reason.message,
    });
    // Duplicate instance ids are removed one copy at a time.
    const index = next.parts.indexOf(victim);
    next = { ...next, parts: next.parts.filter((_, i) => i !== index) };
  }
}

// --- Undo and redo -----------------------------------------------------------------------------

/**
 * Garage history as a plain immutable value: the last 20 transactions, local to one build
 * session (Section 6.6). Blueprints are never mutated, so each entry is just a reference.
 */
export type BuildHistory = {
  past: VehicleBlueprint[];
  present: VehicleBlueprint;
  future: VehicleBlueprint[];
};

export function createHistory(blueprint: VehicleBlueprint): BuildHistory {
  return { past: [], present: blueprint, future: [] };
}

/** Records a committed edit. Clears redo, as any editor does. */
export function pushHistory(history: BuildHistory, next: VehicleBlueprint): BuildHistory {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_GARAGE_HISTORY),
    present: next,
    future: [],
  };
}

export function undo(history: BuildHistory): BuildHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: BuildHistory): BuildHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_GARAGE_HISTORY),
    present: next,
    future: history.future.slice(1),
  };
}

/** Parts in an order that is stable for display: canonical, the same as the hash uses. */
export function installedParts(blueprint: VehicleBlueprint, catalog: Catalog): PlacedPart[] {
  return placedParts(canonicalizeBlueprint(blueprint), catalog);
}
