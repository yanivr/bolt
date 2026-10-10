import {
  MAX_BLUEPRINT_BYTES,
  MAX_MANUAL_WEAPONS,
  MAX_OFFENSIVE_MODULES,
  MAX_REPAIR_UNITS,
  STARTING_CREDITS,
} from './balance.js';
import type { PlacedPart, ResolvedBuild } from './blueprint.js';
import {
  BLUEPRINT_FORMAT_VERSION,
  BLUEPRINT_NAME_PATTERN,
  allowedRotations,
  blueprintCost,
  blueprintSchema,
  buildHash,
  canonicalizeBlueprint,
  findMount,
  installedLoadKg,
  isAccessoryMount,
  mountAccepts,
  own,
  placePart,
  rectsConflict,
  wheelRect,
} from './blueprint.js';
import type {
  AccessoryDefinition,
  BlueprintPart,
  Catalog,
  ChassisDefinition,
  VehicleBlueprint,
} from './types.js';

/**
 * Blueprint legality (Sections 6.1, 6.3, 6.6, 8.3, 10.3 and 11.7). The server runs this on
 * every blueprint it is handed; the garage runs the very same function to explain a problem
 * before the player commits to it. Nothing here trusts a number the client computed.
 */

export const BLUEPRINT_ISSUE_CODES = [
  'MALFORMED',
  'UNSUPPORTED_FORMAT',
  'CATALOG_MISMATCH',
  'BAD_NAME',
  'UNKNOWN_PART',
  'MISSING_ESSENTIAL',
  'DUPLICATE_INSTANCE',
  'UNKNOWN_MOUNT',
  'NO_COMPATIBLE_MOUNT',
  'PART_TOO_LARGE',
  'BAD_ROTATION',
  'OUT_OF_REGION',
  'MOUNT_OCCUPIED',
  'PART_BLOCKS_ANOTHER',
  'OVERLAPS_WHEEL',
  'ONE_PER_CAR',
  'PART_LIMIT',
  'TOO_MANY_REPAIR_ITEMS',
  'TOO_MANY_WEAPONS',
  'TOO_MANY_MANUAL_WEAPONS',
  'BAD_ACTION_SLOT',
  'BAD_AUTO_MODE',
  'TOO_MUCH_ARMOR',
  'TOO_HEAVY',
  'NOT_ENOUGH_CREDITS',
  'WEAPON_INACTIVE',
] as const;
export type BlueprintIssueCode = (typeof BLUEPRINT_ISSUE_CODES)[number];

/**
 * Player copy for each issue. Lines that Sections 6.6 and 18.1 approve are used verbatim;
 * the rest follow the same voice.
 */
export const BLUEPRINT_ISSUE_COPY: Record<BlueprintIssueCode, string> = {
  MALFORMED: "We couldn't read that car. Check the code and try again.",
  UNSUPPORTED_FORMAT: 'This build was saved by a newer version of the game.',
  CATALOG_MISMATCH: 'This build uses older part values. Review it before racing.',
  BAD_NAME: 'Use letters, numbers and simple punctuation in the name.',
  UNKNOWN_PART: 'This part is no longer available.',
  MISSING_ESSENTIAL: 'Your car needs an engine and a complete set of wheels.',
  DUPLICATE_INSTANCE: 'This part is listed twice.',
  UNKNOWN_MOUNT: 'No compatible mount',
  NO_COMPATIBLE_MOUNT: 'No compatible mount',
  PART_TOO_LARGE: 'Too large for this mount.',
  BAD_ROTATION: "This part can't face that way here.",
  OUT_OF_REGION: 'Too far from the mount.',
  MOUNT_OCCUPIED: 'This mount is full.',
  PART_BLOCKS_ANOTHER: 'This part blocks another attachment.',
  OVERLAPS_WHEEL: 'This part blocks a wheel.',
  ONE_PER_CAR: 'One per car',
  PART_LIMIT: 'You have the most a car can carry of this part.',
  TOO_MANY_REPAIR_ITEMS: 'A car can carry one spare wheel and two repair kits.',
  TOO_MANY_WEAPONS: 'A car can carry six weapons.',
  TOO_MANY_MANUAL_WEAPONS: 'Only two weapons can have a fire button.',
  BAD_ACTION_SLOT: "This part can't use a fire button.",
  BAD_AUTO_MODE: "This part can't fire on its own.",
  TOO_MUCH_ARMOR: 'Too much armor for this chassis.',
  TOO_HEAVY: 'Too much weight',
  NOT_ENOUGH_CREDITS: 'Not enough credits',
  WEAPON_INACTIVE: 'This weapon has no fire button and will stay inactive.',
};

/** Section 6.6 wording for the one case the specification names a specific blocked part. */
export const TURRET_BLOCKED_COPY = 'This part blocks your turret';
/** Section 18.1 sentence shown beside the short overweight reason. */
export const OVERWEIGHT_HINT = 'Too heavy for this chassis. Remove weight or swap frames.';

export type BlueprintIssue = {
  code: BlueprintIssueCode;
  severity: 'error' | 'warning';
  /** Short player copy for the highlight on the offending item. */
  message: string;
  /** Longer approved sentence where one exists. */
  hint?: string;
  /** The offending installed part, when the issue belongs to one. */
  instanceId?: string;
  partId?: string;
  mountId?: string;
  /** The other party to a conflict. */
  otherInstanceId?: string;
  /** Which mandatory slot is at fault. */
  slot?: 'chassis' | 'engine' | 'tires' | 'paint';
  /** Numbers behind the verdict, for the detail popover. */
  detail?: Record<string, number | string>;
};

export type BlueprintValidation =
  | {
      ok: true;
      /** The canonical form of what was validated. Store and race this, not the input. */
      blueprint: VehicleBlueprint;
      buildHash: string;
      totalCost: number;
      creditsLeft: number;
      loadKg: number;
      build: ResolvedBuild;
      /** Warnings only. */
      issues: BlueprintIssue[];
    }
  | {
      ok: false;
      blueprint: VehicleBlueprint | null;
      totalCost: number;
      creditsLeft: number;
      loadKg: number;
      issues: BlueprintIssue[];
    };

function issue(
  code: BlueprintIssueCode,
  fields: Omit<BlueprintIssue, 'code' | 'severity' | 'message'> & { message?: string } = {},
  severity: 'error' | 'warning' = 'error',
): BlueprintIssue {
  return { code, severity, ...fields, message: fields.message ?? BLUEPRINT_ISSUE_COPY[code] };
}

function at(instance: BlueprintPart): Pick<BlueprintIssue, 'instanceId' | 'partId' | 'mountId'> {
  return { instanceId: instance.instanceId, partId: instance.partId, mountId: instance.mountId };
}

function inAnyTable(catalog: Catalog, id: string): boolean {
  return (
    own(catalog.chassis, id) !== undefined ||
    own(catalog.engines, id) !== undefined ||
    own(catalog.tires, id) !== undefined ||
    own(catalog.parts, id) !== undefined
  );
}

/** True for a weapon the driver can fire: manual, or hybrid with manual confirmation. */
export function takesFireButton(def: AccessoryDefinition): boolean {
  return (
    def.category === 'weapon' && (def.triggerMode === 'manual' || def.triggerMode === 'hybrid')
  );
}

export function isArmorPlate(def: AccessoryDefinition): boolean {
  return def.category === 'defense' && def.params.armorPlate === true;
}

export function repairUnits(def: AccessoryDefinition): number {
  const units = def.params.repairUnits;
  return typeof units === 'number' ? units : 0;
}

/** Most armor plate, in kilograms, a chassis may carry (Needle and Buggy carry less). */
export function armorLimitKg(chassis: ChassisDefinition): number {
  return Math.round(chassis.maxLoadKg * chassis.armorLoadShare);
}

export type PlacementProblem = {
  code:
    | 'NO_COMPATIBLE_MOUNT'
    | 'BAD_ROTATION'
    | 'PART_TOO_LARGE'
    | 'OUT_OF_REGION'
    | 'OVERLAPS_WHEEL'
    | 'MOUNT_OCCUPIED'
    | 'PART_BLOCKS_ANOTHER';
  otherInstanceId?: string;
  wheelId?: string;
};

/**
 * Everything wrong with putting one part where it is, given the parts already placed. The
 * validator and `suggestMount` both go through here, so a suggestion is always legal.
 */
export function placementProblems(
  chassis: ChassisDefinition,
  placedBefore: readonly PlacedPart[],
  candidate: PlacedPart,
): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  const { mount, def, instance } = candidate;
  if (!mountAccepts(mount, def)) {
    problems.push({ code: 'NO_COMPATIBLE_MOUNT' });
    return problems;
  }
  if (!allowedRotations(mount, def).includes(instance.rotationQuarterTurns))
    problems.push({ code: 'BAD_ROTATION' });
  if (candidate.w > mount.maxFootprint.w || candidate.h > mount.maxFootprint.h)
    problems.push({ code: 'PART_TOO_LARGE' });
  if (
    Math.abs(candidate.x - mount.x) > mount.regionHalfW ||
    Math.abs(candidate.y - mount.y) > mount.regionHalfH
  )
    problems.push({ code: 'OUT_OF_REGION' });
  for (const wheel of chassis.wheelAnchors) {
    if (rectsConflict(candidate.rect, wheelRect(wheel))) {
      problems.push({ code: 'OVERLAPS_WHEEL', wheelId: wheel.id });
      break;
    }
  }
  const sharing = placedBefore.filter((other) => other.mount.id === mount.id);
  if (sharing.length > 0) {
    const anyFull =
      def.hardpointUse === 'full' || sharing.some((o) => o.def.hardpointUse === 'full');
    if (anyFull || sharing.length >= mount.capacity)
      problems.push({ code: 'MOUNT_OCCUPIED', otherInstanceId: sharing[0]!.instance.instanceId });
  }
  for (const other of placedBefore) {
    if (rectsConflict(candidate.rect, other.rect)) {
      problems.push({ code: 'PART_BLOCKS_ANOTHER', otherInstanceId: other.instance.instanceId });
      break;
    }
  }
  return problems;
}

/**
 * Validates a typed blueprint against a catalog. Issues come back in a stable order and
 * each names the instance and mount at fault where there is one.
 */
export function validateBlueprint(input: VehicleBlueprint, catalog: Catalog): BlueprintValidation {
  const blueprint = canonicalizeBlueprint(input);
  const issues: BlueprintIssue[] = [];

  if ((input.formatVersion as number) !== BLUEPRINT_FORMAT_VERSION)
    issues.push(issue('UNSUPPORTED_FORMAT'));
  if (blueprint.catalogVersion !== catalog.version)
    issues.push(
      issue('CATALOG_MISMATCH', {
        detail: { blueprint: String(blueprint.catalogVersion), catalog: catalog.version },
      }),
    );
  if (typeof blueprint.name !== 'string' || !BLUEPRINT_NAME_PATTERN.test(blueprint.name))
    issues.push(issue('BAD_NAME'));

  // --- Mandatory parts (Section 6.1) -------------------------------------------------------
  const chassis = own(catalog.chassis, blueprint.chassisId);
  const engine = own(catalog.engines, blueprint.engineId);
  const tires = own(catalog.tires, blueprint.tireKitId);
  const essentials: Array<['chassis' | 'engine' | 'tires', string, unknown]> = [
    ['chassis', blueprint.chassisId, chassis],
    ['engine', blueprint.engineId, engine],
    ['tires', blueprint.tireKitId, tires],
  ];
  for (const [slot, id, found] of essentials) {
    if (found) continue;
    // An id from another table, or no id at all, means the slot is empty. An id the catalog
    // has never heard of is an unknown part.
    const code =
      typeof id === 'string' && id.length > 0 && !inAnyTable(catalog, id)
        ? 'UNKNOWN_PART'
        : 'MISSING_ESSENTIAL';
    issues.push(issue(code, { slot, partId: String(id) }));
  }
  if (!own(catalog.paints, blueprint.paintId))
    issues.push(issue('UNKNOWN_PART', { slot: 'paint', partId: String(blueprint.paintId) }));

  // --- Installed parts ---------------------------------------------------------------------
  const seen = new Set<string>();
  const placed: PlacedPart[] = [];
  const known: Array<{ instance: BlueprintPart; def: AccessoryDefinition }> = [];
  for (const instance of blueprint.parts) {
    if (seen.has(instance.instanceId)) {
      issues.push(issue('DUPLICATE_INSTANCE', at(instance)));
      continue;
    }
    seen.add(instance.instanceId);
    const def = own(catalog.parts, instance.partId);
    if (!def) {
      issues.push(issue('UNKNOWN_PART', at(instance)));
      continue;
    }
    known.push({ instance, def });
    if (!chassis) continue;
    const mount = findMount(chassis, instance.mountId);
    if (!mount) {
      issues.push(issue('UNKNOWN_MOUNT', at(instance)));
      continue;
    }
    if (!isAccessoryMount(mount)) {
      issues.push(issue('NO_COMPATIBLE_MOUNT', at(instance)));
      continue;
    }
    const candidate = placePart(instance, def, mount);
    for (const problem of placementProblems(chassis, placed, candidate)) {
      const fields: Parameters<typeof issue>[1] = { ...at(instance) };
      if (problem.otherInstanceId) fields.otherInstanceId = problem.otherInstanceId;
      if (problem.wheelId) fields.detail = { wheelId: problem.wheelId };
      if (problem.code === 'PART_TOO_LARGE')
        fields.detail = {
          w: candidate.w,
          h: candidate.h,
          maxW: mount.maxFootprint.w,
          maxH: mount.maxFootprint.h,
        };
      if (problem.code === 'PART_BLOCKS_ANOTHER') {
        const other = placed.find((p) => p.instance.instanceId === problem.otherInstanceId);
        const turret = (d: AccessoryDefinition) => d.behaviorId === 'turret_burst';
        if (other && turret(other.def) && !turret(def)) fields.message = TURRET_BLOCKED_COPY;
        else if (other && turret(def) && !turret(other.def)) {
          // The turret is the victim, so the highlight goes on the part in its way.
          fields.instanceId = other.instance.instanceId;
          fields.partId = other.instance.partId;
          fields.mountId = other.instance.mountId;
          fields.otherInstanceId = instance.instanceId;
          fields.message = TURRET_BLOCKED_COPY;
        }
      }
      issues.push(issue(problem.code, fields));
    }
    // A part that cannot be on this mount at all takes up no room for the checks that follow.
    if (mountAccepts(mount, def)) placed.push(candidate);
  }

  // --- Per-car limits (Sections 6.1, 8.3, 11.5, 11.7) --------------------------------------
  const perPart = new Map<string, number>();
  let weapons = 0;
  let repairs = 0;
  let armorKg = 0;
  const slots = new Map<number, string>();
  for (const { instance, def } of known) {
    const count = (perPart.get(def.id) ?? 0) + 1;
    perPart.set(def.id, count);
    if (def.maxPerCar !== undefined && count > def.maxPerCar) {
      const units = repairUnits(def);
      issues.push(
        issue(
          def.maxPerCar === 1 ? 'ONE_PER_CAR' : units > 0 ? 'TOO_MANY_REPAIR_ITEMS' : 'PART_LIMIT',
          { ...at(instance), detail: { limit: def.maxPerCar } },
        ),
      );
    }
    const units = repairUnits(def);
    if (units > 0) {
      repairs += units;
      if (repairs > MAX_REPAIR_UNITS && !(def.maxPerCar !== undefined && count > def.maxPerCar))
        issues.push(
          issue('TOO_MANY_REPAIR_ITEMS', { ...at(instance), detail: { limit: MAX_REPAIR_UNITS } }),
        );
    }
    if (def.category === 'weapon') {
      weapons += 1;
      if (weapons > MAX_OFFENSIVE_MODULES)
        issues.push(
          issue('TOO_MANY_WEAPONS', { ...at(instance), detail: { limit: MAX_OFFENSIVE_MODULES } }),
        );
    }
    if (isArmorPlate(def) && chassis) {
      armorKg += def.massKg;
      const limit = armorLimitKg(chassis);
      if (armorKg > limit)
        issues.push(
          issue('TOO_MUCH_ARMOR', { ...at(instance), detail: { armorKg, limitKg: limit } }),
        );
    }

    // Fire buttons and automatic mode (Section 8.3).
    const slot = instance.assignedActionSlot;
    const fireable = takesFireButton(def);
    if (slot !== undefined) {
      if (!fireable) issues.push(issue('BAD_ACTION_SLOT', at(instance)));
      else if (slots.has(slot))
        issues.push(
          issue('TOO_MANY_MANUAL_WEAPONS', {
            ...at(instance),
            otherInstanceId: slots.get(slot)!,
            detail: { limit: MAX_MANUAL_WEAPONS, slot },
          }),
        );
      else slots.set(slot, instance.instanceId);
    }
    if (instance.autoMode === true && (def.triggerMode !== 'hybrid' || slot !== undefined))
      issues.push(issue('BAD_AUTO_MODE', at(instance)));
    if (fireable && slot === undefined && instance.autoMode !== true)
      issues.push(issue('WEAPON_INACTIVE', at(instance), 'warning'));
  }

  // --- Budget and load, from catalog values only -------------------------------------------
  const cost = blueprintCost(blueprint, catalog);
  if (cost.total > STARTING_CREDITS)
    issues.push(
      issue('NOT_ENOUGH_CREDITS', {
        detail: {
          totalCost: cost.total,
          budget: STARTING_CREDITS,
          over: cost.total - STARTING_CREDITS,
        },
      }),
    );

  let loadKg = 0;
  let build: ResolvedBuild | null = null;
  if (chassis && engine && tires) {
    build = { blueprint, chassis, engine, tires, parts: placed, unresolved: [] };
    // Load counts every known installed part, including any that sit somewhere illegal.
    loadKg = installedLoadKg({ ...build, parts: [] });
    for (const { def } of known) loadKg += def.massKg;
    if (loadKg > chassis.maxLoadKg)
      issues.push(
        issue('TOO_HEAVY', {
          hint: OVERWEIGHT_HINT,
          detail: {
            loadKg: Math.round(loadKg * 10) / 10,
            maxLoadKg: chassis.maxLoadKg,
            overKg: Math.round((loadKg - chassis.maxLoadKg) * 10) / 10,
          },
        }),
      );
  }

  const creditsLeft = STARTING_CREDITS - cost.total;
  const errors = issues.some((i) => i.severity === 'error');
  if (errors || !build)
    return { ok: false, blueprint, totalCost: cost.total, creditsLeft, loadKg, issues };
  return {
    ok: true,
    blueprint,
    buildHash: buildHash(blueprint),
    totalCost: cost.total,
    creditsLeft,
    loadKg,
    build,
    issues,
  };
}

/**
 * The boundary function: takes anything at all (a join option, a request body, a string from
 * local storage), bounds its size, parses it strictly and validates it. Never throws.
 */
export function validateUntrustedBlueprint(input: unknown, catalog: Catalog): BlueprintValidation {
  const malformed = (): BlueprintValidation => ({
    ok: false,
    blueprint: null,
    totalCost: 0,
    creditsLeft: STARTING_CREDITS,
    loadKg: 0,
    issues: [issue('MALFORMED')],
  });
  let value = input;
  try {
    if (typeof value === 'string') {
      if (value.length > MAX_BLUEPRINT_BYTES) return malformed();
      value = JSON.parse(value) as unknown;
    } else if (JSON.stringify(value)?.length > MAX_BLUEPRINT_BYTES) {
      return malformed();
    }
  } catch {
    return malformed();
  }
  const parsed = blueprintSchema.safeParse(value);
  if (!parsed.success) return malformed();
  return validateBlueprint(parsed.data, catalog);
}

/** Errors only, for callers that treat warnings separately. */
export function blueprintErrors(result: BlueprintValidation): BlueprintIssue[] {
  return result.issues.filter((i) => i.severity === 'error');
}
