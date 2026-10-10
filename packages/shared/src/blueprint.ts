import { z } from 'zod';
import {
  MAX_BLUEPRINT_NAME_LENGTH,
  MAX_BLUEPRINT_PARTS,
  OFFSET_GRID_PX,
  PART_CLEARANCE_PX,
  WHEEL_WELL,
} from './balance.js';
import { sha256Hex } from './sha256.js';
import type {
  AccessoryDefinition,
  BlueprintPart,
  CarArc,
  Catalog,
  ChassisDefinition,
  EngineDefinition,
  MountCategory,
  MountPoint,
  QuarterTurn,
  TireDefinition,
  VehicleBlueprint,
  WheelAnchor,
} from './types.js';

/**
 * Blueprint representation (Section 15.6): the wire schema, the canonical form, the
 * mechanical hash, and the geometry every rule shares. Pure and synchronous, so the garage
 * preview in the browser and the authoritative server agree to the last pixel.
 */

export const BLUEPRINT_FORMAT_VERSION = 1;

// --- Untrusted input ---------------------------------------------------------------------------

const partIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_]+$/);

const instanceIdSchema = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * Car names are shown to other players, so the character set is closed: letters, digits,
 * spaces and a little punctuation. Nothing that means anything to HTML, a URL or a shell.
 */
export const BLUEPRINT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 '.!?&+#-]*[A-Za-z0-9.!?])?$/;

const offsetSchema = z.number().finite().min(-64).max(64);

export const blueprintPartSchema = z
  .object({
    instanceId: instanceIdSchema,
    partId: partIdSchema,
    mountId: partIdSchema,
    offsetX: offsetSchema,
    offsetY: offsetSchema,
    rotationQuarterTurns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    assignedActionSlot: z.union([z.literal(0), z.literal(1)]).optional(),
    autoMode: z.boolean().optional(),
  })
  .strict();

export const blueprintSchema = z
  .object({
    formatVersion: z.literal(BLUEPRINT_FORMAT_VERSION),
    catalogVersion: z
      .string()
      .min(1)
      .max(24)
      .regex(/^[0-9A-Za-z.+-]+$/),
    name: z.string().min(1).max(MAX_BLUEPRINT_NAME_LENGTH).regex(BLUEPRINT_NAME_PATTERN),
    chassisId: partIdSchema,
    engineId: partIdSchema,
    tireKitId: partIdSchema,
    paintId: partIdSchema,
    parts: z.array(blueprintPartSchema).max(MAX_BLUEPRINT_PARTS),
    createdAt: z
      .string()
      .min(10)
      .max(40)
      .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/),
  })
  .strict();

/** Trims and replaces anything outside the allowed set, for names typed by a player. */
export function sanitizeBlueprintName(raw: string, fallback = 'My Car'): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9 '.!?&+#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BLUEPRINT_NAME_LENGTH)
    .trim();
  return BLUEPRINT_NAME_PATTERN.test(cleaned) ? cleaned : fallback;
}

// --- Catalog lookups ---------------------------------------------------------------------------

/** Own-property lookup, so `constructor` and `__proto__` are never parts. */
export function own<T>(table: Record<string, T>, id: string): T | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(table, id)
    ? table[id]
    : undefined;
}

// --- Canonical form and hash -------------------------------------------------------------------

export function snapOffset(value: number): number {
  const snapped = Math.round(value / OFFSET_GRID_PX) * OFFSET_GRID_PX;
  // Avoid a negative zero, which would serialize differently from zero in some encoders.
  return snapped === 0 ? 0 : snapped;
}

function comparePart(a: BlueprintPart, b: BlueprintPart): number {
  return (
    cmp(a.mountId, b.mountId) ||
    cmp(a.partId, b.partId) ||
    a.offsetX - b.offsetX ||
    a.offsetY - b.offsetY ||
    a.rotationQuarterTurns - b.rotationQuarterTurns ||
    (a.assignedActionSlot ?? -1) - (b.assignedActionSlot ?? -1) ||
    Number(a.autoMode === true) - Number(b.autoMode === true) ||
    cmp(a.instanceId, b.instanceId)
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalPart(part: BlueprintPart): BlueprintPart {
  const out: BlueprintPart = {
    instanceId: part.instanceId,
    partId: part.partId,
    mountId: part.mountId,
    offsetX: snapOffset(part.offsetX),
    offsetY: snapOffset(part.offsetY),
    rotationQuarterTurns: part.rotationQuarterTurns,
  };
  if (part.assignedActionSlot === 0 || part.assignedActionSlot === 1)
    out.assignedActionSlot = part.assignedActionSlot;
  if (part.autoMode === true) out.autoMode = true;
  return out;
}

/**
 * The canonical blueprint: offsets on the integer grid, parts sorted by mount and then part
 * id, optional fields present only when they say something, keys in a fixed order. Two
 * blueprints that describe the same car and metadata canonicalize to identical JSON.
 */
export function canonicalizeBlueprint(blueprint: VehicleBlueprint): VehicleBlueprint {
  return {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    catalogVersion: blueprint.catalogVersion,
    name: blueprint.name,
    chassisId: blueprint.chassisId,
    engineId: blueprint.engineId,
    tireKitId: blueprint.tireKitId,
    paintId: blueprint.paintId,
    parts: blueprint.parts.map(canonicalPart).sort(comparePart),
    createdAt: blueprint.createdAt,
  };
}

/** Stable JSON of the canonical blueprint, for storage and transport. */
export function serializeBlueprint(blueprint: VehicleBlueprint): string {
  return JSON.stringify(canonicalizeBlueprint(blueprint));
}

/**
 * Canonical JSON of what makes the car drive and fight the way it does, and nothing else:
 * no name, paint, creation time or instance ids. Fire-button assignments are included
 * because they decide which weapons can be used.
 */
export function mechanicalJson(blueprint: VehicleBlueprint): string {
  const parts = blueprint.parts
    .map(canonicalPart)
    .map(
      (p) =>
        [
          p.mountId,
          p.partId,
          p.offsetX,
          p.offsetY,
          p.rotationQuarterTurns,
          p.assignedActionSlot ?? -1,
          p.autoMode === true ? 1 : 0,
        ] as const,
    )
    .sort((a, b) => {
      for (let i = 0; i < a.length; i++) {
        const x = a[i]!;
        const y = b[i]!;
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    });
  return JSON.stringify({
    format: BLUEPRINT_FORMAT_VERSION,
    catalog: blueprint.catalogVersion,
    chassis: blueprint.chassisId,
    engine: blueprint.engineId,
    tires: blueprint.tireKitId,
    parts,
  });
}

/** SHA-256 of the mechanical JSON, lower-case hex. Independent of purchase order. */
export function buildHash(blueprint: VehicleBlueprint): string {
  return sha256Hex(mechanicalJson(blueprint));
}

// --- Geometry ----------------------------------------------------------------------------------

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Footprint after rotation: odd quarter turns swap width and length. */
export function rotatedFootprint(
  footprint: { w: number; h: number },
  turns: QuarterTurn,
): { w: number; h: number } {
  return turns % 2 === 1 ? { w: footprint.h, h: footprint.w } : { w: footprint.w, h: footprint.h };
}

export function rectAround(x: number, y: number, w: number, h: number): Rect {
  return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
}

/**
 * True when two boxes are closer than the clearance on both axes. Boxes that are at least
 * the clearance apart on either axis are clear of each other.
 */
export function rectsConflict(a: Rect, b: Rect, clearance = PART_CLEARANCE_PX): boolean {
  const gapX = Math.max(a.x0 - b.x1, b.x0 - a.x1);
  const gapY = Math.max(a.y0 - b.y1, b.y0 - a.y1);
  return gapX < clearance && gapY < clearance;
}

export function wheelRect(anchor: WheelAnchor): Rect {
  return rectAround(anchor.x, anchor.y, WHEEL_WELL.w, WHEEL_WELL.h);
}

export function isAccessoryMount(mount: MountPoint): boolean {
  return !mount.categories.includes('ENGINE') && !mount.categories.includes('WHEEL');
}

export function accessoryMounts(chassis: ChassisDefinition): MountPoint[] {
  return chassis.mounts.filter(isAccessoryMount);
}

export function engineMount(chassis: ChassisDefinition): MountPoint | undefined {
  return chassis.mounts.find((m) => m.categories.includes('ENGINE'));
}

export function findMount(chassis: ChassisDefinition, mountId: string): MountPoint | undefined {
  return chassis.mounts.find((m) => m.id === mountId);
}

/** Whether a mount takes a part at all, before size, rotation and clearance. */
export function mountAccepts(mount: MountPoint, part: AccessoryDefinition): boolean {
  if (!isAccessoryMount(mount)) return false;
  if (mount.categories.includes('UNIVERSAL')) return true;
  if (mount.acceptsAnyWeapon === true && part.category === 'weapon') return true;
  return part.compatibleMounts.some((category: MountCategory) =>
    mount.categories.includes(category),
  );
}

/** Orientations a part may take on a mount. Parts that cannot rotate stay at 0. */
export function allowedRotations(mount: MountPoint, part: AccessoryDefinition): QuarterTurn[] {
  return part.rotatable ? mount.allowedQuarterTurns : [0];
}

/** Which way a rotation points: 0 forward, 1 right, 2 rear, 3 left. */
export function rotationArc(turns: QuarterTurn): CarArc {
  return turns === 0 ? 'front' : turns === 1 ? 'right' : turns === 2 ? 'rear' : 'left';
}

/** Where a mount sits on the car, from its primary category or failing that its position. */
export function mountArc(mount: MountPoint): CarArc {
  const primary = mount.categories[0];
  if (primary === 'FRONT') return 'front';
  if (primary === 'REAR') return 'rear';
  if (primary === 'LEFT') return 'left';
  if (primary === 'RIGHT') return 'right';
  if (Math.abs(mount.x) > Math.abs(mount.y)) return mount.x < 0 ? 'left' : 'right';
  return mount.y <= 0 ? 'front' : 'rear';
}

// --- Resolution --------------------------------------------------------------------------------

export type PlacedPart = {
  instance: BlueprintPart;
  def: AccessoryDefinition;
  mount: MountPoint;
  /** Centre of the part in chassis-local pixels. */
  x: number;
  y: number;
  /** Footprint after rotation. */
  w: number;
  h: number;
  rect: Rect;
};

export type ResolvedBuild = {
  blueprint: VehicleBlueprint;
  chassis: ChassisDefinition;
  engine: EngineDefinition;
  tires: TireDefinition;
  /** Installed accessories that resolve to a known part on a known mount. */
  parts: PlacedPart[];
  /** Instances whose part or mount is unknown. They count for nothing. */
  unresolved: BlueprintPart[];
};

export function placePart(
  instance: BlueprintPart,
  def: AccessoryDefinition,
  mount: MountPoint,
): PlacedPart {
  const size = rotatedFootprint(def.footprint, instance.rotationQuarterTurns);
  const x = mount.x + snapOffset(instance.offsetX);
  const y = mount.y + snapOffset(instance.offsetY);
  return {
    instance,
    def,
    mount,
    x,
    y,
    w: size.w,
    h: size.h,
    rect: rectAround(x, y, size.w, size.h),
  };
}

/**
 * Looks every id up in the catalog. Returns null when the chassis, engine or wheel kit is
 * unknown; unknown accessories are set aside in `unresolved`. This does not judge legality:
 * the garage shows stats for drafts that are not legal yet. Use `validateBlueprint` for that.
 */
export function resolveBlueprint(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
): ResolvedBuild | null {
  const chassis = own(catalog.chassis, blueprint.chassisId);
  const engine = own(catalog.engines, blueprint.engineId);
  const tires = own(catalog.tires, blueprint.tireKitId);
  if (!chassis || !engine || !tires) return null;
  const parts: PlacedPart[] = [];
  const unresolved: BlueprintPart[] = [];
  for (const instance of blueprint.parts) {
    const def = own(catalog.parts, instance.partId);
    const mount = findMount(chassis, instance.mountId);
    if (!def || !mount || !isAccessoryMount(mount)) unresolved.push(instance);
    else parts.push(placePart(instance, def, mount));
  }
  return { blueprint, chassis, engine, tires, parts, unresolved };
}

// --- Cost and load -----------------------------------------------------------------------------

/** A wheel kit is priced and weighed for four wheels and scaled to the chassis (Section 6.3). */
export function wheelKitPrice(tires: { price: number }, wheelCount: number): number {
  return Math.round((tires.price * wheelCount) / 4);
}
export function wheelKitMass(tires: { massKg: number }, wheelCount: number): number {
  return (tires.massKg * wheelCount) / 4;
}

export type CostLine = {
  slot: 'chassis' | 'engine' | 'tires' | 'part';
  partId: string;
  instanceId?: string;
  price: number;
};

export type BlueprintCost = {
  chassis: number;
  engine: number;
  tires: number;
  parts: number;
  total: number;
  lines: CostLine[];
};

/**
 * `totalCost = chassis + engine + round(tirePrice * wheelCount / 4) + sum(extras)` from
 * catalog prices only (Section 6.1). Unknown ids cost nothing here and are refused by the
 * validator.
 */
export function blueprintCost(blueprint: VehicleBlueprint, catalog: Catalog): BlueprintCost {
  const chassis = own(catalog.chassis, blueprint.chassisId);
  const engine = own(catalog.engines, blueprint.engineId);
  const tires = own(catalog.tires, blueprint.tireKitId);
  const lines: CostLine[] = [];
  const chassisCost = chassis?.price ?? 0;
  const engineCost = engine?.price ?? 0;
  const tireCost = tires ? wheelKitPrice(tires, chassis?.wheelCount ?? 4) : 0;
  lines.push({ slot: 'chassis', partId: blueprint.chassisId, price: chassisCost });
  lines.push({ slot: 'engine', partId: blueprint.engineId, price: engineCost });
  lines.push({ slot: 'tires', partId: blueprint.tireKitId, price: tireCost });
  let parts = 0;
  for (const instance of blueprint.parts) {
    const price = own(catalog.parts, instance.partId)?.price ?? 0;
    parts += price;
    lines.push({ slot: 'part', partId: instance.partId, instanceId: instance.instanceId, price });
  }
  return {
    chassis: chassisCost,
    engine: engineCost,
    tires: tireCost,
    parts,
    total: chassisCost + engineCost + tireCost + parts,
    lines,
  };
}

/**
 * Installed mass that counts against the chassis load limits: the engine, the wheel kit
 * scaled to the wheel count, and every accessory. The chassis' own mass is not load; it is
 * what carries the load. See docs/DECISIONS.md.
 */
export function installedLoadKg(build: ResolvedBuild): number {
  let load = build.engine.massKg + wheelKitMass(build.tires, build.chassis.wheelCount);
  for (const part of build.parts) load += part.def.massKg;
  return load;
}

/** Everything, chassis included: the mass the integrator accelerates. */
export function totalMassKg(build: ResolvedBuild): number {
  return build.chassis.massKg + installedLoadKg(build);
}
