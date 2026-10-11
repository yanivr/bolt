import type { BlueprintPart, QuarterTurn, VehicleBlueprint } from '@bolt/shared';
import { BLUEPRINT_FORMAT_VERSION } from '@bolt/shared';
import { CATALOG_VERSION } from './catalog.js';
import { SHIPPED_AT, baselineBlueprint } from './loadout.js';

/**
 * Shipped blueprints: the baseline car every garage session starts from, five starter cars
 * (the Rookie of Section 6.3 and one for each of the other four chassis) and six example
 * builds after Section 11.9, rebuilt on the five chassis the game keeps (docs/DECISIONS.md,
 * entry 87). Every one is a real blueprint that the server accepts; the tests validate them,
 * hash them and drive them, and check that every chassis appears among the starters.
 */

export type BlueprintTemplate = {
  id: string;
  group: 'baseline' | 'starter' | 'example';
  name: string;
  /** One line for the card. */
  description: string;
  blueprint: VehicleBlueprint;
};

export type PartSpec = {
  part: string;
  mount: string;
  /** Facing: 0 front, 1 right, 2 rear, 3 left. Defaults to 0. */
  turn?: QuarterTurn;
  /** Fire button, or `'auto'` for a hybrid left to fire by itself. */
  fire?: 0 | 1 | 'auto';
  offset?: [number, number];
};

/** Builds a shipped blueprint from a short description. Used for templates and scenarios. */
export function build(
  name: string,
  chassisId: string,
  engineId: string,
  tireKitId: string,
  paintId: string,
  parts: PartSpec[],
): VehicleBlueprint {
  return {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    catalogVersion: CATALOG_VERSION,
    name,
    chassisId,
    engineId,
    tireKitId,
    paintId,
    parts: parts.map((spec, index) => {
      const part: BlueprintPart = {
        instanceId: `p${index + 1}`,
        partId: spec.part,
        mountId: spec.mount,
        offsetX: spec.offset?.[0] ?? 0,
        offsetY: spec.offset?.[1] ?? 0,
        rotationQuarterTurns: spec.turn ?? 0,
      };
      if (spec.fire === 'auto') part.autoMode = true;
      else if (spec.fire !== undefined) part.assignedActionSlot = spec.fire;
      return part;
    }),
    createdAt: SHIPPED_AT,
  };
}

/** Beetle, Four-Cylinder, Street Tires: 370 credits, roadworthy with no extras. */
export const BASELINE_BLUEPRINT: VehicleBlueprint = baselineBlueprint({}, 'Baseline Beetle');

/** The Rookie tutorial car: the baseline plus a Front Machine Gun and a Spare Wheel. 480. */
export const ROOKIE_BLUEPRINT: VehicleBlueprint = build(
  'Rookie',
  'chassis_beetle',
  'engine_four_cylinder',
  'tires_street',
  'paint_signal',
  [
    { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
    { part: 'utility_spare', mount: 'left_utility' },
  ],
);

export const TEMPLATES: BlueprintTemplate[] = [
  {
    id: 'baseline',
    group: 'baseline',
    name: 'Baseline Beetle',
    description: 'The stock car. Honest, slow to anger, and 630 credits short of finished.',
    blueprint: BASELINE_BLUEPRINT,
  },
  {
    id: 'starter_rookie',
    group: 'starter',
    name: 'Rookie',
    description: 'The stock Beetle with a machine gun and a spare wheel. Plenty left to spend.',
    blueprint: ROOKIE_BLUEPRINT,
  },
  {
    id: 'starter_sprinter',
    group: 'starter',
    name: 'Sprinter',
    description: 'A slippery Arrow with a V6, a fan to keep it cool and one gun up front.',
    blueprint: build('Sprinter', 'chassis_arrow', 'engine_v6', 'tires_street', 'paint_cobalt', [
      { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
      { part: 'utility_fan', mount: 'roof_rear' },
    ]),
  },
  {
    id: 'starter_packhorse',
    group: 'starter',
    name: 'Packhorse',
    description: 'A Pickup with tools on the rack, a sentry on the rail and room in the bed.',
    blueprint: build('Packhorse', 'chassis_pickup', 'engine_v6', 'tires_street', 'paint_sunflare', [
      { part: 'utility_repair', mount: 'bed_front', offset: [-5, 0] },
      { part: 'utility_battery', mount: 'bed_front', offset: [5, 0] },
      { part: 'weapon_rear_mg', mount: 'left_bed', turn: 2 },
      { part: 'defense_rear_bumper', mount: 'rear_center', turn: 2 },
    ]),
  },
  {
    id: 'starter_longlegs',
    group: 'starter',
    name: 'Longlegs',
    description: 'A Spider that will not tip, with a gun on the roof and a plate on each flank.',
    blueprint: build('Longlegs', 'chassis_spider', 'engine_v6', 'tires_street', 'paint_mint', [
      { part: 'weapon_front_mg', mount: 'roof_front', fire: 0 },
      { part: 'defense_light_plate', mount: 'left_front', turn: 3 },
      { part: 'defense_light_plate', mount: 'right_front', turn: 1 },
      { part: 'utility_radar', mount: 'rear_utility' },
    ]),
  },
  {
    id: 'starter_tinker',
    group: 'starter',
    name: 'Tinker',
    description: 'A Trike so cheap it can afford a shotgun, a sentry gun and a repair kit.',
    blueprint: build(
      'Tinker',
      'chassis_trike',
      'engine_small_turbo',
      'tires_street',
      'paint_cobalt',
      [
        { part: 'weapon_shotgun', mount: 'front_center', fire: 0 },
        { part: 'weapon_rear_mg', mount: 'right_rear', turn: 2 },
        { part: 'utility_repair', mount: 'left_rear' },
      ],
    ),
  },
  {
    id: 'example_straight_line_rocket',
    group: 'example',
    name: 'Straight-Line Rocket',
    description: 'Fast on dry asphalt. Weak in the rain and in tight turns.',
    blueprint: build(
      'Straight-Line Rocket',
      'chassis_arrow',
      'engine_v8',
      'tires_slick',
      'paint_signal',
      [
        { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
        { part: 'utility_nitro', mount: 'roof_mid' },
        { part: 'utility_fan', mount: 'roof_rear' },
      ],
    ),
  },
  {
    id: 'example_iron_mule',
    group: 'example',
    name: 'Iron Mule',
    description: 'Hard to hurt and hard to pass, with a mortar in the bed. Slow to get going.',
    blueprint: build(
      'Iron Mule',
      'chassis_pickup',
      'engine_four_cylinder',
      'tires_armored',
      'paint_mint',
      [
        { part: 'weapon_mortar', mount: 'bed_rear', fire: 0 },
        { part: 'weapon_oil', mount: 'rear_center', turn: 2, fire: 1 },
        { part: 'defense_energy_shield', mount: 'roof_cab' },
        { part: 'utility_repair', mount: 'bed_front', offset: [-5, 0] },
      ],
    ),
  },
  {
    id: 'example_dust_spider',
    group: 'example',
    name: 'Dust Spider',
    description: 'Planted through desert corners, with an air cannon to shove rivals wide.',
    blueprint: build(
      'Dust Spider',
      'chassis_spider',
      'engine_offroad',
      'tires_sand',
      'paint_sunflare',
      [
        { part: 'weapon_air', mount: 'roof_front', fire: 0 },
        { part: 'utility_gyro', mount: 'rear_utility' },
      ],
    ),
  },
  {
    id: 'example_rain_runner',
    group: 'example',
    name: 'Rain Runner',
    description: 'A wet-city sprinter. Watch the battery: the motor and the shield share it.',
    blueprint: build(
      'Rain Runner',
      'chassis_beetle',
      'engine_electric_sport',
      'tires_rain',
      'paint_cobalt',
      [
        { part: 'weapon_rear_mg', mount: 'rear_center', turn: 2 },
        { part: 'defense_energy_shield', mount: 'roof_mid' },
      ],
    ),
  },
  {
    id: 'example_back_alley_trap',
    group: 'example',
    name: 'Back-Alley Trap',
    description: 'Owns the road behind it, and sees other traps coming.',
    blueprint: build(
      'Back-Alley Trap',
      'chassis_beetle',
      'engine_hybrid',
      'tires_street',
      'paint_sunflare',
      [
        { part: 'weapon_mine', mount: 'rear_center', turn: 2, fire: 0 },
        { part: 'weapon_rear_mg', mount: 'roof_mid', turn: 2 },
        { part: 'utility_minesensor', mount: 'left_utility' },
      ],
    ),
  },
  {
    id: 'example_tiny_trouble',
    group: 'example',
    name: 'Tiny Trouble',
    description: 'Outrageous off the line. Fragile the moment the road bends.',
    blueprint: build(
      'Tiny Trouble',
      'chassis_trike',
      'engine_rotary',
      'tires_micro',
      'paint_signal',
      [
        { part: 'weapon_shotgun', mount: 'front_center', fire: 0 },
        { part: 'utility_fan', mount: 'roof_mid' },
      ],
    ),
  },
];

export function getTemplate(id: string): BlueprintTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export const STARTER_TEMPLATES = TEMPLATES.filter((t) => t.group === 'starter');
export const EXAMPLE_TEMPLATES = TEMPLATES.filter((t) => t.group === 'example');
