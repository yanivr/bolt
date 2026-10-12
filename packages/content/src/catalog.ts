import type {
  AccessoryCategory,
  AccessoryDefinition,
  AnyPartDefinition,
  Catalog,
  PaintOption,
  PartCategory,
} from '@bolt/shared';
import { own } from '@bolt/shared';
import { CHASSIS, CHASSIS_LIST } from './chassis.js';
import { DEFENSES, DEFENSE_LIST } from './defenses.js';
import { ENGINES, ENGINE_LIST } from './engines.js';
import { TIRES, TIRE_LIST } from './tires.js';
import { UTILITIES, UTILITY_LIST } from './utilities.js';
import { WEAPONS, WEAPON_LIST } from './weapons.js';

/**
 * Semantic version of the shipped catalog and balance data. Bump on any value change and
 * describe the change in docs/BALANCE_CHANGELOG.md. A blueprint records the version it was
 * built against; the server refuses to race one built against another.
 */
export const CATALOG_VERSION = '0.7.0';

export const PAINTS: Record<string, PaintOption> = {
  paint_signal: { id: 'paint_signal', displayName: 'Signal Red' },
  paint_cobalt: { id: 'paint_cobalt', displayName: 'Cobalt' },
  paint_mint: { id: 'paint_mint', displayName: 'Mint' },
  paint_sunflare: { id: 'paint_sunflare', displayName: 'Sunflare' },
};

/** Weapons, defenses and utilities in one table, as blueprints reference them. */
export const ACCESSORIES: Record<string, AccessoryDefinition> = {
  ...WEAPONS,
  ...DEFENSES,
  ...UTILITIES,
};

/** The whole shipped catalog: 105 parts and the paints. */
export const CATALOG: Catalog = {
  version: CATALOG_VERSION,
  chassis: CHASSIS,
  engines: ENGINES,
  tires: TIRES,
  parts: ACCESSORIES,
  paints: PAINTS,
};

export const PART_CATEGORIES: readonly PartCategory[] = [
  'chassis',
  'engine',
  'tires',
  'weapon',
  'defense',
  'utility',
];

const BY_CATEGORY: Record<PartCategory, AnyPartDefinition[]> = {
  chassis: CHASSIS_LIST,
  engine: ENGINE_LIST,
  tires: TIRE_LIST,
  weapon: WEAPON_LIST,
  defense: DEFENSE_LIST,
  utility: UTILITY_LIST,
};

/** Every part of one category, in the order of its Section 11 table. */
export function partsByCategory(category: PartCategory): AnyPartDefinition[] {
  return BY_CATEGORY[category];
}

export function accessoriesByCategory(category: AccessoryCategory): AccessoryDefinition[] {
  return BY_CATEGORY[category] as AccessoryDefinition[];
}

/** All 105 parts, in table order. */
export function allParts(): AnyPartDefinition[] {
  return PART_CATEGORIES.flatMap((category) => BY_CATEGORY[category]);
}

/** Any part by id, from any category. Never resolves inherited property names. */
export function getPart(id: string): AnyPartDefinition | undefined {
  return (
    own(CATALOG.chassis, id) ??
    own(CATALOG.engines, id) ??
    own(CATALOG.tires, id) ??
    own(CATALOG.parts, id)
  );
}

/**
 * What a part card shows (Section 5.6): exact price, weight, energy draw or output, heat
 * effect, one benefit line and one downside line. `price` and `massKg` for a wheel kit are
 * for a set of four; pass the chassis wheel count to get the adjusted figures.
 */
export type PartCard = {
  id: string;
  displayName: string;
  category: PartCategory;
  spriteKey: string;
  price: number;
  massKg: number;
  /** Power units per second. Positive draws, negative generates, zero is neither. */
  powerPerSecond: number;
  /** Heat units per second. Positive heats, negative cools, zero is neither. */
  heatPerSecond: number;
  /** Uses per match, or zero when the part is not limited by charges. */
  charges: number;
  benefit: string;
  downside: string;
  triggerMode: string;
  maxPerCar: number | null;
};

export function partCard(part: AnyPartDefinition, wheelCount = 4): PartCard {
  let powerPerSecond = 0;
  let heatPerSecond = 0;
  let price = part.price;
  let massKg = part.massKg;
  if (part.category === 'engine') {
    powerPerSecond = part.powerDraw;
    heatPerSecond = part.heatPerSecond;
  } else if (part.category === 'tires') {
    powerPerSecond = part.powerDraw;
    price = Math.round((part.price * wheelCount) / 4);
    massKg = (part.massKg * wheelCount) / 4;
  } else if (part.category !== 'chassis') {
    powerPerSecond = part.powerDraw;
    heatPerSecond = part.heatEffect;
  }
  const charges =
    part.params?.charges ?? part.params?.uses ?? part.params?.bursts ?? part.params?.decoys;
  return {
    id: part.id,
    displayName: part.displayName,
    category: part.category,
    spriteKey: part.spriteKey,
    price,
    massKg,
    powerPerSecond,
    heatPerSecond,
    charges: typeof charges === 'number' ? charges : 0,
    benefit: part.description,
    downside: part.drawback,
    triggerMode: part.triggerMode ?? 'passive',
    maxPerCar: part.maxPerCar ?? null,
  };
}
