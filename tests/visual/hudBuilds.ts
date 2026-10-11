/**
 * Cars for the HUD screenshots and end-to-end tests: legal builds of 1,000 credits or less
 * that between them put every kind of control on the HUD. `npx tsx tests/visual/hudBuilds.ts`
 * validates them against the catalog and prints what each one costs.
 */

export type HudPart = [partId: string, mountId: string, extra?: Record<string, unknown>];

export type HudBuild = {
  name: string;
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
  parts: HudPart[];
};

/**
 * The Beetle with a control of every kind: a rocket on the primary button (five charges), a
 * seeker on the secondary (a lock, three charges), an automatic sentry, and a repair kit and
 * nitro as equipment.
 */
export const ARMED_BEETLE: HudBuild = {
  name: 'HUD Beetle',
  chassisId: 'chassis_beetle',
  engineId: 'engine_four_cylinder',
  tireKitId: 'tires_street',
  paintId: 'paint_signal',
  parts: [
    ['weapon_rocket', 'front_center', { assignedActionSlot: 0 }],
    ['weapon_homing', 'roof_mid', { assignedActionSlot: 1 }],
    ['utility_repair', 'left_utility'],
    ['utility_nitro', 'right_utility'],
    ['weapon_rear_mg', 'rear_center', { rotationQuarterTurns: 2 }],
  ],
};

/**
 * The Spider with sensors: Radar and a Mine Detector (hazards on the route ribbon, the early
 * missile warning), two automatic weapons, a machine gun, and three equipment buttons.
 */
export const SENSOR_SPIDER: HudBuild = {
  name: 'HUD Spider',
  chassisId: 'chassis_spider',
  engineId: 'engine_four_cylinder',
  tireKitId: 'tires_street',
  paintId: 'paint_mint',
  parts: [
    ['utility_minesensor', 'front_utility'],
    ['weapon_front_mg', 'left_front', { assignedActionSlot: 0 }],
    ['weapon_tesla', 'right_front'],
    ['utility_radar', 'roof_front'],
    ['utility_spare', 'roof_mid'],
    ['weapon_rear_mg', 'left_rear', { rotationQuarterTurns: 2 }],
    ['utility_repair', 'rear_utility'],
  ],
};

/** A railgun to charge and a flame spitter to overheat with. */
export const HOT_ARROW: HudBuild = {
  name: 'HUD Arrow',
  chassisId: 'chassis_arrow',
  engineId: 'engine_four_cylinder',
  tireKitId: 'tires_street',
  paintId: 'paint_cobalt',
  parts: [
    ['weapon_flame', 'front_center', { assignedActionSlot: 0 }],
    ['weapon_railshot', 'roof_mid', { assignedActionSlot: 1 }],
    ['utility_overdrive', 'roof_rear'],
  ],
};

export const HUD_BUILDS: HudBuild[] = [ARMED_BEETLE, SENSOR_SPIDER, HOT_ARROW];

export function hudBlueprint(build: HudBuild, catalogVersion: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    catalogVersion,
    name: build.name,
    chassisId: build.chassisId,
    engineId: build.engineId,
    tireKitId: build.tireKitId,
    paintId: build.paintId,
    parts: build.parts.map(([partId, mountId, extra], index) => ({
      instanceId: `p${index + 1}`,
      partId,
      mountId,
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 0,
      ...extra,
    })),
    createdAt: '2026-10-11T00:00:00Z',
  };
}

if (process.argv[1]?.endsWith('hudBuilds.ts'))
  void (async () => {
    const { CATALOG, CATALOG_VERSION } = await import('@bolt/content');
    const { validateUntrustedBlueprint } = await import('@bolt/shared');
    for (const build of HUD_BUILDS) {
      const check = validateUntrustedBlueprint(hudBlueprint(build, CATALOG_VERSION), CATALOG);
      console.log(
        build.name,
        check.ok
          ? `ok, ${check.totalCost} credits`
          : JSON.stringify(check.issues ?? check, null, 1),
      );
      if (!check.ok) process.exitCode = 1;
    }
  })();
