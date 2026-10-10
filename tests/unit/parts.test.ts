import {
  ACCESSORIES,
  CATALOG,
  DEFENSE_LIST,
  UTILITY_LIST,
  WEAPON_LIST,
  baselineBlueprint,
  conditionsFor,
} from '@bolt/content';
import type { BuildConditions, PartParams, VehicleBlueprint, VehicleParams } from '@bolt/shared';
import {
  BASE_BATTERY,
  BASE_COOLING,
  BASE_GENERATION,
  SOLAR_TIME,
  SOLAR_WEATHER,
  WEATHER_IDS,
  aggregateModifiers,
  buildHash,
  compareBuildStats,
  effectiveAim,
  installPart,
  resolveBlueprint,
  weaponDamage,
  weaponIsActive,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { stepSteer } from '../feel/handling.js';
import { car } from '../helpers/blueprints.js';
import { FULL, paramsOf, rig, sprint, statsOf } from '../helpers/rig.js';

/**
 * Sections 11.5 to 11.7: sixty weapons, defenses and utilities. Passive parts are tested on
 * their mechanic in the simulator. Active parts, whose behaviour arrives with combat in
 * Milestone C, are tested on two things: that the numbers they declare are the numbers in
 * the specification (transcribed below by hand), and that installing them changes the build
 * the way a part of that kind must.
 */

/** The bench: a Platform, whose universal mounts take any part, on stock essentials. */
const BENCH: VehicleBlueprint = baselineBlueprint(
  { chassisId: 'chassis_platform', engineId: 'engine_four_cylinder' },
  'Bench',
);

function fitted(partId: string, base: VehicleBlueprint = BENCH): VehicleBlueprint {
  const result = installPart(base, CATALOG, partId);
  if (!result.ok) throw new Error(`${partId}: ${result.issue.code}`);
  return result.blueprint;
}

function totalsOf(blueprint: VehicleBlueprint) {
  return aggregateModifiers(resolveBlueprint(blueprint, CATALOG)!);
}

// --- Weapons ------------------------------------------------------------------------------------

// Transcribed from the Section 11.5 table and the ammunition and targeting paragraphs.
const SPEC_WEAPONS: Record<string, PartParams> = {
  weapon_front_mg: { bullets: 5, damagePerBullet: 3, coneDegrees: 85, range: 220, charges: 0 },
  weapon_rear_mg: { bullets: 4, damagePerBullet: 3, range: 220, charges: 0 },
  weapon_turret: { damage: 18, range: 220, charges: 0 },
  weapon_shotgun: { pellets: 8, damagePerPellet: 3, range: 110, charges: 0 },
  weapon_railshot: { damage: 27, range: 350, charges: 5 },
  weapon_rocket: { damage: 22, range: 220, charges: 5 },
  weapon_homing: { damage: 20, charges: 3, lockWarningSeconds: 0.5 },
  weapon_mine: { damage: 13, slowSeconds: 1.2, charges: 6, liveCap: 6 },
  weapon_oil: { gripLossSeconds: 2.5, charges: 0 },
  weapon_foam: { speedReduction: 0.2, slowSeconds: 2, charges: 0 },
  weapon_emp: { radius: 135, range: 135, disableSeconds: 1.5, charges: 0 },
  weapon_tesla: { damage: 12, charges: 0 },
  weapon_flame: { durationSeconds: 2, damageOverTime: 14, charges: 0 },
  weapon_frost: { gripReduction: 0.2, gripSeconds: 2.5, range: 220, charges: 0 },
  weapon_hammer: { damage: 24, range: 110, charges: 0 },
  weapon_saw: { damagePerBurst: 7, charges: 0 },
  weapon_harpoon: { hardStun: false, charges: 0 },
  weapon_air: { coneDegrees: 60, charges: 0 },
  weapon_boomerang: { damagePerHit: 12, phases: 2, hitsPerPhase: 1, charges: 0 },
  weapon_mortar: { damageCenter: 25, range: 320, charges: 3 },
};
/** Active primitive each weapon's defining effect must be built from (Section 11.8). */
const SPEC_WEAPON_PRIMITIVE: Record<string, string> = {
  weapon_front_mg: 'SpawnProjectile',
  weapon_rear_mg: 'AcquireTarget',
  weapon_turret: 'AcquireTarget',
  weapon_shotgun: 'SpawnProjectile',
  weapon_railshot: 'ShowTelegraph',
  weapon_rocket: 'SpawnProjectile',
  weapon_homing: 'ShowTelegraph',
  weapon_mine: 'SpawnMine',
  weapon_oil: 'SpawnAreaHazard',
  weapon_foam: 'SpawnAreaHazard',
  weapon_emp: 'ApplyEMP',
  weapon_tesla: 'ApplyEMP',
  weapon_flame: 'ApplyDamageOverTime',
  weapon_frost: 'ApplyGripDebuff',
  weapon_hammer: 'ApplyImpulse',
  weapon_saw: 'ApplyDirectDamage',
  weapon_harpoon: 'ApplyTether',
  weapon_air: 'ApplyImpulse',
  weapon_boomerang: 'SpawnProjectile',
  weapon_mortar: 'ShowTelegraph',
};

describe('weapons (Section 11.5)', () => {
  const bare = statsOf(BENCH);

  it.each(WEAPON_LIST)(
    '$displayName: declares the specified numbers and counts when installed',
    (weapon) => {
      expect(weapon.params).toMatchObject(SPEC_WEAPONS[weapon.id]!);
      expect(weapon.actions!.map((a) => a.type)).toContain(SPEC_WEAPON_PRIMITIVE[weapon.id]);
      expect(weapon.actions!.at(-1)).toEqual({
        type: 'StartCooldown',
        seconds: weapon.params.cooldownSeconds,
      });
      if (Number(weapon.params.charges) > 0)
        expect(weapon.actions).toContainEqual({
          type: 'ConsumeCharge',
          charges: weapon.params.charges,
        });
      else expect(weapon.actions!.some((a) => a.type === 'ConsumeCharge')).toBe(false);
      // Per-shot energy and heat are declared, finite and sensible.
      for (const key of ['energyPerShot', 'heatPerShot', 'range', 'coneDegrees'] as const) {
        expect(typeof weapon.params[key], key).toBe('number');
        expect(weapon.params[key], key).toBeGreaterThanOrEqual(0);
      }
      expect(weapon.params.energyPerShot).toBeGreaterThan(0);

      const bp = fitted(weapon.id);
      const stats = statsOf(bp);
      const placed = resolveBlueprint(bp, CATALOG)!.parts[0]!;
      // A newly installed weapon is ready to fire: on a button, or automatic.
      expect(weaponIsActive(placed)).toBe(true);
      expect(stats.legal).toBe(true);
      expect(stats.issues).toEqual([]);
      expect(stats.mass.totalKg - bare.mass.totalKg).toBeCloseTo(weapon.massKg, 9);
      expect(stats.indicators.load.loadKg - bare.indicators.load.loadKg).toBeCloseTo(
        weapon.massKg,
        9,
      );
      expect(stats.indicators.budget.spent - bare.indicators.budget.spent).toBe(weapon.price);
      expect(stats.scores.firepower).toBeGreaterThan(0);
      expect(bare.scores.firepower).toBe(0);
      expect(stats.details.firepower.activeWeapons).toBe(1);
      const cooldown = Number(weapon.params.cooldownSeconds);
      expect(
        stats.indicators.energy.drawPerSecond - bare.indicators.energy.drawPerSecond,
      ).toBeCloseTo(Number(weapon.params.energyPerShot) / cooldown, 9);
      expect(
        stats.indicators.heat.productionPerSecond - bare.indicators.heat.productionPerSecond,
      ).toBeCloseTo(Number(weapon.params.heatPerShot) / cooldown, 9);
      expect(
        Math.abs(weapon.powerDraw - Number(weapon.params.energyPerShot) / cooldown),
      ).toBeLessThanOrEqual(0.005 + 1e-9);
      // Carrying it costs acceleration, and nothing else about how the car drives.
      expect(stats.scores.speed).toBeLessThanOrEqual(bare.scores.speed);
      const before = paramsOf(BENCH);
      const after = paramsOf(bp);
      expect(after.massKg).toBeCloseTo(before.massKg + weapon.massKg, 9);
      expect({ ...after, massKg: 0, brakeDecel: 0, stability: 0 }).toEqual({
        ...before,
        massKg: 0,
        brakeDecel: 0,
        stability: 0,
      });
    },
  );

  it('gives each weapon a distinct behaviour and a distinct set of numbers', () => {
    expect(new Set(WEAPON_LIST.map((w) => w.behaviorId)).size).toBe(20);
    expect(new Set(WEAPON_LIST.map((w) => JSON.stringify(w.params))).size).toBe(20);
    expect(new Set(WEAPON_LIST.map((w) => w.soundKey)).size).toBe(20);
    // Section 11.5: missiles, railgun, mortar and mines have charges; guns and tools do not.
    const limited = WEAPON_LIST.filter((w) => Number(w.params.charges) > 0)
      .map((w) => w.id)
      .sort();
    expect(limited).toEqual([
      'weapon_homing',
      'weapon_mine',
      'weapon_mortar',
      'weapon_railshot',
      'weapon_rocket',
    ]);
    // Typical direct hits 8 to 18, heavy rare hits 20 to 30 (Section 8.4).
    for (const weapon of WEAPON_LIST)
      expect(weaponDamage(weapon.params), weapon.id).toBeLessThanOrEqual(30);
    expect(weaponDamage(ACCESSORIES.weapon_front_mg!.params)).toBe(15);
    expect(weaponDamage(ACCESSORIES.weapon_shotgun!.params)).toBe(24);
  });

  it('counts a weapon toward Firepower only when it can actually fire', () => {
    const armed = statsOf(
      car('chassis_platform', [
        { partId: 'weapon_front_mg', mountId: 'deck_front', assignedActionSlot: 0 },
      ]),
    );
    const idle = statsOf(
      car('chassis_platform', [{ partId: 'weapon_front_mg', mountId: 'deck_front' }]),
    );
    expect(armed.scores.firepower).toBeGreaterThan(20);
    expect(idle.scores.firepower).toBe(0);
    expect(idle.details.firepower).toMatchObject({ activeWeapons: 0, inactiveWeapons: 1 });
    expect(idle.indicators.energy.drawPerSecond).toBe(0);
    expect(idle.details.firepower.lines.join(' ')).toContain('Give it a fire button');
    // A hybrid on automatic counts for a little less than one under the driver's thumb.
    const manual = statsOf(
      car('chassis_platform', [
        { partId: 'weapon_turret', mountId: 'deck_fore', assignedActionSlot: 0 },
      ]),
    );
    const auto = statsOf(
      car('chassis_platform', [{ partId: 'weapon_turret', mountId: 'deck_fore', autoMode: true }]),
    );
    expect(auto.details.firepower.threat).toBeLessThan(manual.details.firepower.threat);
    expect(auto.details.firepower.threat).toBeGreaterThan(manual.details.firepower.threat * 0.8);
    // More weapons, more firepower, never past 100.
    let bp = BENCH;
    let last = 0;
    for (const id of [
      'weapon_front_mg',
      'weapon_shotgun',
      'weapon_turret',
      'weapon_tesla',
      'weapon_rear_mg',
      'weapon_homing',
    ]) {
      bp = fitted(id, { ...bp, engineId: 'engine_mini_electric', tireKitId: 'tires_micro' });
      const score = statsOf(bp).scores.firepower;
      expect(score, id).toBeGreaterThan(last);
      last = score;
    }
    expect(last).toBeLessThanOrEqual(100);
  });

  it('applies the Crab and Scorpion aim overrides to weapons on the mounts they name', () => {
    const aimOf = (bp: VehicleBlueprint) => {
      const build = resolveBlueprint(bp, CATALOG)!;
      return effectiveAim(aggregateModifiers(build), build.parts[0]!);
    };
    // Crab: side weapon rotation freedom +45 degrees.
    expect(
      aimOf(
        car('chassis_crab', [
          { partId: 'weapon_front_mg', mountId: 'left_mid', assignedActionSlot: 0 },
        ]),
      ),
    ).toEqual({ coneDegrees: 130, range: 220 });
    expect(
      aimOf(
        car('chassis_crab', [
          { partId: 'weapon_front_mg', mountId: 'roof_mid', assignedActionSlot: 0 },
        ]),
      ),
    ).toEqual({ coneDegrees: 85, range: 220 });
    expect(
      aimOf(
        car('chassis_turtle', [
          { partId: 'weapon_front_mg', mountId: 'left_mid', assignedActionSlot: 0 },
        ]),
      ),
    ).toEqual({ coneDegrees: 85, range: 220 });
    // Scorpion: rear weapon range +8%.
    const boom = aimOf(
      car('chassis_scorpion', [
        { partId: 'weapon_rear_mg', mountId: 'rear_boom', rotationQuarterTurns: 2 },
      ]),
    );
    expect(boom.range).toBeCloseTo(220 * 1.08, 9);
    expect(
      aimOf(
        car('chassis_scorpion', [
          { partId: 'weapon_rear_mg', mountId: 'roof_mid', rotationQuarterTurns: 2 },
        ]),
      ).range,
    ).toBe(220);
    expect(
      aimOf(
        car('chassis_beetle', [
          { partId: 'weapon_rear_mg', mountId: 'rear_center', rotationQuarterTurns: 2 },
        ]),
      ).range,
    ).toBe(220);
    // And the Firepower score sees the difference.
    const side = statsOf(
      car('chassis_crab', [
        { partId: 'weapon_front_mg', mountId: 'left_mid', assignedActionSlot: 0 },
      ]),
    );
    const roof = statsOf(
      car('chassis_crab', [
        { partId: 'weapon_front_mg', mountId: 'roof_mid', assignedActionSlot: 0 },
      ]),
    );
    expect(side.details.firepower.threat).toBeGreaterThan(roof.details.firepower.threat * 1.1);
  });
});

// --- Defenses -----------------------------------------------------------------------------------

// Transcribed from the Section 11.6 table.
const SPEC_DEFENSES: Record<string, PartParams> = {
  defense_light_plate: { armorHp: 25 },
  defense_heavy_plate: { armorHp: 75 },
  defense_front_bumper: { frontRamDamageFactor: 0.65 },
  defense_rear_bumper: { rearRamDamageFactor: 0.7 },
  defense_side_panels: { armorHp: 40 },
  defense_wheel_cage: { wheelDamageFactor: 0.55 },
  defense_engine_case: { engineDamageFactor: 0.6 },
  defense_ceramic: { bulletDamageFactor: 0.55, ramDamageFactor: 1.1 },
  defense_breakaway: { absorbDamage: 35, uses: 1 },
  defense_composite: { directDamageFactor: 0.82 },
  defense_energy_shield: { shieldPoints: 25, rechargeSeconds: 12 },
  defense_faraday: { empDurationFactor: 0.3 },
  defense_heatguard: { incomingHeatFactor: 0.45 },
  defense_antimissile: { interceptCooldownSeconds: 14 },
  defense_minesweeper: { sweepCooldownSeconds: 8 },
  defense_fireproof: { burnDamageFactor: 0.4 },
  defense_oilproof: { oilGripPenaltyFactor: 0.3 },
  defense_damper: { displacementFactor: 0.65, ramDamageFactor: 0.85 },
  defense_steer_assist: { steeringPenaltyFactor: 0.4 },
  defense_reactive: { heavyHitReduction: 0.4, cooldownSeconds: 16 },
};

describe('defenses (Section 11.6)', () => {
  const bare = statsOf(BENCH);

  it.each(DEFENSE_LIST)(
    '$displayName: declares the specified numbers and raises Defense when installed',
    (defense) => {
      expect(defense.params).toMatchObject(SPEC_DEFENSES[defense.id]!);
      const bp = fitted(defense.id);
      const stats = statsOf(bp);
      expect(stats.legal).toBe(true);
      expect(stats.mass.totalKg - bare.mass.totalKg).toBeCloseTo(defense.massKg, 9);
      expect(stats.scores.defense, 'defense score').toBeGreaterThan(bare.scores.defense);
      expect(stats.details.defense.effectiveHp).toBeGreaterThan(
        bare.details.defense.effectiveHp + 3,
      );
      expect(stats.scores.firepower).toBe(0);
      expect(stats.scores.utility).toBe(0);
      // The weight is the price: never quicker for carrying armor.
      expect(stats.scores.speed).toBeLessThanOrEqual(bare.scores.speed);
      expect(sprint(paramsOf(bp)).distance8s).toBeLessThan(sprint(paramsOf(BENCH)).distance8s);
    },
  );

  it('puts plate armor on the arc the plate faces', () => {
    const armor = (parts: Parameters<typeof car>[1]) =>
      totalsOf(car('chassis_turtle', parts)).armor;
    expect(armor([])).toEqual({ front: 0, rear: 0, left: 0, right: 0 });
    expect(
      armor([{ partId: 'defense_light_plate', mountId: 'front_center', rotationQuarterTurns: 0 }]),
    ).toEqual({ front: 25, rear: 0, left: 0, right: 0 });
    expect(
      armor([{ partId: 'defense_light_plate', mountId: 'rear_center', rotationQuarterTurns: 2 }]),
    ).toEqual({ front: 0, rear: 25, left: 0, right: 0 });
    expect(
      armor([{ partId: 'defense_heavy_plate', mountId: 'left_mid', rotationQuarterTurns: 3 }]),
    ).toEqual({ front: 0, rear: 0, left: 75, right: 0 });
    expect(
      armor([{ partId: 'defense_heavy_plate', mountId: 'right_mid', rotationQuarterTurns: 1 }]),
    ).toEqual({ front: 0, rear: 0, left: 0, right: 75 });
    // A plate on a side mount may be turned to face forward instead: it then guards the front.
    expect(
      armor([
        { partId: 'defense_light_plate', mountId: 'left_mid', rotationQuarterTurns: 3 },
        { partId: 'defense_light_plate', mountId: 'front_center' },
      ]),
    ).toEqual({ front: 25, rear: 0, left: 25, right: 0 });
    // Side Shields are a matched pair: 40 on each side from one part, whichever side holds it.
    expect(armor([{ partId: 'defense_side_panels', mountId: 'left_mid' }])).toEqual({
      front: 0,
      rear: 0,
      left: 40,
      right: 40,
    });
    expect(armor([{ partId: 'defense_side_panels', mountId: 'right_mid' }])).toEqual({
      front: 0,
      rear: 0,
      left: 40,
      right: 40,
    });
    // Plates stack on an arc; the Defense detail reports the total.
    const stacked = car('chassis_turtle', [
      { partId: 'defense_heavy_plate', mountId: 'front_center' },
      { partId: 'defense_light_plate', mountId: 'left_mid', rotationQuarterTurns: 0 },
    ]);
    expect(totalsOf(stacked).armor.front).toBe(100);
    expect(statsOf(stacked).details.defense.armorHp).toBe(100);
  });

  it('expresses every passive reduction as a damage tag the damage model will read', () => {
    // The bench Platform has a damage tag of its own (exposed parts); it is set aside here.
    const tags = (partId: string) => {
      const { mounted_part: _platform, ...rest } = totalsOf(fitted(partId)).damage;
      return rest;
    };
    expect(tags('defense_front_bumper')).toEqual({ ram_front: 0.65 });
    expect(tags('defense_rear_bumper')).toEqual({ ram_rear: 0.7 });
    expect(tags('defense_wheel_cage')).toEqual({ wheel: 0.55 });
    expect(tags('defense_engine_case')).toEqual({ engine: 0.6 });
    expect(tags('defense_ceramic')).toEqual({ bullet: 0.55, ram: 1.1 });
    expect(tags('defense_composite')).toEqual({ direct: 0.82 });
    expect(tags('defense_faraday')).toEqual({ emp_duration: 0.3 });
    expect(tags('defense_heatguard')).toEqual({ heat_status: 0.45 });
    expect(tags('defense_fireproof')).toEqual({ burn: 0.4 });
    expect(tags('defense_oilproof')).toEqual({ oil: 0.3 });
    expect(tags('defense_damper')).toEqual({ ram: 0.85 });
    expect(totalsOf(fitted('defense_damper')).impulse.displacement).toBeCloseTo(0.65, 9);
    expect(tags('defense_steer_assist')).toEqual({ steering: 0.4 });
    // Reductions of the same tag multiply: ceramic's ram penalty against the dampers' cut.
    const both = totalsOf(fitted('defense_damper', fitted('defense_ceramic'))).damage;
    expect(both.ram).toBeCloseTo(1.1 * 0.85, 9);
    // Ceramic helps against bullets and hurts in a ram, so its net worth is smaller than a
    // pure reduction of the same size.
    const ceramic =
      statsOf(fitted('defense_ceramic')).details.defense.effectiveHp -
      bare.details.defense.effectiveHp;
    expect(ceramic).toBeCloseTo(0.45 * 50 - 0.1 * 30, 6);
  });

  it('declares the reactive defenses as active primitives with their cooldowns', () => {
    const types = (id: string) => ACCESSORIES[id]!.actions!.map((a) => a.type);
    expect(types('defense_breakaway')).toEqual(['GrantTemporaryShield', 'ConsumeCharge']);
    expect(ACCESSORIES.defense_breakaway!.actions![0]).toMatchObject({ points: 35, uses: 1 });
    expect(types('defense_energy_shield')).toEqual(['GrantTemporaryShield', 'StartCooldown']);
    expect(ACCESSORIES.defense_energy_shield!.actions).toContainEqual({
      type: 'StartCooldown',
      seconds: 12,
    });
    expect(types('defense_antimissile')).toEqual(['InterceptProjectile', 'StartCooldown']);
    expect(ACCESSORIES.defense_antimissile!.actions).toContainEqual({
      type: 'StartCooldown',
      seconds: 14,
    });
    expect(types('defense_minesweeper')).toEqual(['InterceptProjectile', 'StartCooldown']);
    expect(ACCESSORIES.defense_minesweeper!.actions).toContainEqual({
      type: 'StartCooldown',
      seconds: 8,
    });
    expect(types('defense_reactive')).toEqual(['GrantTemporaryShield', 'StartCooldown']);
    expect(ACCESSORIES.defense_reactive!.actions).toContainEqual({
      type: 'StartCooldown',
      seconds: 16,
    });
    for (const id of [
      'defense_breakaway',
      'defense_energy_shield',
      'defense_antimissile',
      'defense_minesweeper',
      'defense_reactive',
    ])
      expect(ACCESSORIES[id]!.triggerMode, id).toBe('automatic');
    // The Energy Shield "draws energy": 3 a second, served after handling aids.
    const shield = statsOf(fitted('defense_energy_shield'));
    expect(shield.indicators.energy.drawPerSecond).toBe(3);
    expect(paramsOf(fitted('defense_energy_shield')).power.consumers).toEqual([
      { draw: 3, priority: 3, effect: {} },
    ]);
    // The interceptor draws when it fires: 6 every 14 seconds at most.
    expect(statsOf(fitted('defense_antimissile')).indicators.energy.drawPerSecond).toBeCloseTo(
      6 / 14,
      9,
    );
  });
});

// --- Utilities ----------------------------------------------------------------------------------

// Transcribed from the Section 11.7 table.
const SPEC_UTILITIES: Record<string, PartParams> = {
  utility_spare: { wheels: 1, actionSeconds: 1 },
  utility_repair: { restoreIntegrity: 40 },
  utility_fan: { cooling: 4, drawPerSecond: 2 },
  utility_radiator: { cooling: 9, dragFactor: 1.03 },
  utility_battery: { capacity: 65 },
  utility_generator: { generation: 12, heatPerSecond: 3 },
  utility_capacitor: { reserveEnergy: 30 },
  utility_nitro: { bursts: 2, burstSeconds: 1.5 },
  utility_overdrive: { boostSeconds: 2, heatAdded: 28 },
  utility_traction: { drawPerSecond: 4 },
  utility_gyro: { stabilityBonus: 16, drawPerSecond: 3 },
  utility_radar: {},
  utility_minesensor: { warningDistance: 120 },
  utility_decoy: { decoys: 2 },
  utility_jump: { cooldownSeconds: 9 },
  utility_winch: { cooldownSeconds: 20 },
  utility_ballast: {},
  utility_spoiler: { drawPerSecond: 3 },
  utility_targeting: { acquisitionSpeedFactor: 1.25, drawPerSecond: 4 },
  utility_solar: { generationClearDay: 4 },
};

describe('utilities (Section 11.7)', () => {
  const bare = statsOf(BENCH);
  const bareParams = paramsOf(BENCH);

  it.each(UTILITY_LIST)(
    '$displayName: declares the specified numbers and raises Utility when installed',
    (utility) => {
      expect(utility.params).toMatchObject(SPEC_UTILITIES[utility.id]!);
      const bp = fitted(utility.id);
      const stats = statsOf(bp);
      expect(stats.legal).toBe(true);
      expect(stats.mass.totalKg - bare.mass.totalKg).toBeCloseTo(utility.massKg, 9);
      expect(stats.scores.utility, 'utility score').toBeGreaterThan(0);
      expect(bare.scores.utility).toBe(0);
      expect(stats.scores.firepower).toBe(0);
      expect(buildHash(bp)).not.toBe(buildHash(BENCH));
      const delta = compareBuildStats(bare, stats);
      expect(delta.scores.utility.better).toBe(true);
      expect(delta.indicators.creditsLeft).toMatchObject({ delta: -utility.price, better: false });
      expect(delta.indicators.loadKg.delta).toBeCloseTo(utility.massKg, 9);
    },
  );

  /** Core heat a build settles at when held flat out for two minutes of simulated time. */
  function settledHeat(params: VehicleParams): number {
    const r = rig(params);
    // Hold a steady 200 px/s on the straight so the oval's bends never come into it.
    for (let i = 0; i < 30 * 120; i++) {
      r.state.x = 9000;
      r.state.y = 5000;
      r.state.velocityX = -200;
      r.state.velocityY = 0;
      r.run(FULL, 1 / 30);
    }
    return r.state.coreHeat;
  }

  it('Spare Wheel and Repair Kit: one-use repairs with the specified action times', () => {
    const spare = ACCESSORIES.utility_spare!;
    expect(spare.params).toMatchObject({
      wheels: 1,
      actionSeconds: 1,
      accelPenalty: 0.2,
      accelPenaltySeconds: 1,
      uses: 1,
      repairUnits: 1,
    });
    expect(spare.actions!.map((a) => a.type)).toEqual([
      'ShowTelegraph',
      'ReplaceWheel',
      'ConsumeCharge',
    ]);
    expect(spare.maxPerCar).toBe(1);
    const kit = ACCESSORIES.utility_repair!;
    expect(kit.params).toMatchObject({
      restoreIntegrity: 40,
      actionSeconds: 1.3,
      uses: 1,
      repairUnits: 1,
    });
    expect(kit.actions!.map((a) => a.type)).toEqual(['RepairComponent', 'ConsumeCharge']);
    expect(kit.maxPerCar).toBe(2);
    for (const part of [spare, kit]) expect(part.triggerMode).toBe('manual');
    // Carrying both is worth more Utility than carrying either.
    const both = statsOf(fitted('utility_repair', fitted('utility_spare'))).scores.utility;
    expect(both).toBeGreaterThan(statsOf(fitted('utility_spare')).scores.utility);
    expect(both).toBeGreaterThan(statsOf(fitted('utility_repair')).scores.utility);
  });

  it('Cooling Fan: +4 cooling for 2 power a second, and nothing without power', () => {
    const p = paramsOf(fitted('utility_fan'));
    expect(p.power.consumers).toEqual([{ draw: 2, priority: 2, effect: { cooling: 4 } }]);
    expect(p.heat.cooling).toBe(BASE_COOLING);
    const stats = statsOf(fitted('utility_fan'));
    expect(
      stats.indicators.heat.coolingPerSecond / bare.indicators.heat.coolingPerSecond,
    ).toBeCloseTo(12 / 8, 9);
    expect(stats.indicators.energy.drawPerSecond).toBe(2);
    // In the simulator the car runs cooler: 8 heat against 12 cooling settles at 20, not 45.
    expect(settledHeat(bareParams)).toBeCloseTo(45, 0);
    expect(settledHeat(p)).toBeCloseTo(75 * (8 / 12 - 0.4), 0);
    // Starved of power, the fan does nothing.
    const dead = { ...p, power: { ...p.power, generation: 0, capacity: 0 } };
    expect(settledHeat(dead)).toBeCloseTo(45, 0);
  });

  it('Racing Radiator: +9 cooling with no power needed, for 3% more drag', () => {
    const p = paramsOf(fitted('utility_radiator'));
    expect(p.heat.cooling).toBe(BASE_COOLING + 9);
    expect(p.power.consumers).toEqual([]);
    expect(p.dragQuadratic / bareParams.dragQuadratic).toBeCloseTo(1.03, 9);
    expect(settledHeat(p)).toBeCloseTo(75 * (8 / 17 - 0.4), 0);
    expect(settledHeat({ ...p, power: { ...p.power, generation: 0, capacity: 0 } })).toBeCloseTo(
      75 * (8 / 17 - 0.4),
      0,
    );
    // The drag costs top speed.
    expect(sprint(p).topMph).toBeLessThan(sprint(bareParams).topMph - 0.5);
  });

  it('Extra Battery: +65 energy, which delays a shortage and does not prevent one', () => {
    const base = baselineBlueprint(
      { chassisId: 'chassis_platform', engineId: 'engine_electric_sport' },
      'Bench',
    );
    const plain = paramsOf(base);
    const p = paramsOf(fitted('utility_battery', base));
    expect(plain.power.capacity).toBe(BASE_BATTERY);
    expect(p.power.capacity).toBe(BASE_BATTERY + 65);
    expect(p.power.generation).toBe(plain.power.generation);
    // The Sport Electric overdraws by 4 a second: 10 seconds on the stock battery, 26.25 with.
    const flat = (params: VehicleParams) => {
      const r = rig(params);
      let t = 0;
      r.run(FULL, 30, (self) => {
        if (t === 0 && self.telemetry.lowPower) t = self.time();
      });
      return t;
    };
    expect(flat(plain)).toBeCloseTo(10, 0);
    expect(flat(p)).toBeCloseTo(105 / 4, 0);
    expect(statsOf(fitted('utility_battery', base)).indicators.energy.batterySeconds).toBeCloseTo(
      105 / 4,
      6,
    );
    expect(statsOf(fitted('utility_battery', base)).indicators.energy.ratio).toBeCloseTo(1.4, 9);
  });

  it('Auxiliary Generator: +12 power a second and +3 heat a second', () => {
    const base = baselineBlueprint(
      { chassisId: 'chassis_platform', engineId: 'engine_electric_sport' },
      'Bench',
    );
    const p = paramsOf(fitted('utility_generator', base));
    expect(p.power.generation).toBe(BASE_GENERATION + 12);
    expect(p.heat.constantPerSecond).toBe(3);
    // It cures the Sport Electric's shortage outright...
    const r = rig(p);
    r.run(FULL, 30);
    expect(r.telemetry.lowPower).toBe(false);
    expect(r.state.batteryEnergy).toBe(BASE_BATTERY);
    expect(statsOf(fitted('utility_generator', base)).warnings.map((w) => w.code)).not.toContain(
      'LOW_POWER',
    );
    expect(statsOf(base).warnings.map((w) => w.code)).toContain('LOW_POWER');
    // ...and makes heat even with the car parked.
    const parked = rig(p);
    parked.run({ steer: 0, brake: 1, coast: false }, 0.2);
    expect(parked.telemetry.heatProduction).toBeCloseTo(3, 9);
    const stats = statsOf(fitted('utility_generator'));
    expect(
      stats.indicators.heat.productionPerSecond - bare.indicators.heat.productionPerSecond,
    ).toBeCloseTo(3, 9);
  });

  it('Burst Capacitor: 30 energy held in reserve, apart from the battery', () => {
    const bp = fitted('utility_capacitor');
    expect(totalsOf(bp).burstReserve).toBe(30);
    expect(paramsOf(bp).power.capacity).toBe(BASE_BATTERY);
    const stats = statsOf(bp);
    expect(stats.indicators.energy.burstReserve).toBe(30);
    expect(stats.indicators.energy.batteryCapacity).toBe(BASE_BATTERY);
    expect(stats.indicators.energy.lines.join(' ')).toContain('Holds 30 in reserve');
    expect(ACCESSORIES.utility_capacitor!.triggerMode).toBe('automatic');
  });

  it('Nitro Tank and Emergency Booster: declared torque pulses with their heat', () => {
    const nitro = ACCESSORIES.utility_nitro!;
    expect(nitro.actions).toContainEqual({ type: 'PulseTorque', factor: 1.6, seconds: 1.5 });
    expect(nitro.actions).toContainEqual({ type: 'ConsumeCharge', charges: 2 });
    const booster = ACCESSORIES.utility_overdrive!;
    expect(booster.actions).toContainEqual({ type: 'PulseTorque', factor: 1.5, seconds: 2 });
    expect(booster.actions).toContainEqual({ type: 'ApplyHeat', heat: 28, target: 'self' });
    for (const part of [nitro, booster]) expect(part.triggerMode).toBe('manual');
    // Until Milestone C fires them they are mass, and Utility points.
    expect(paramsOf(fitted('utility_nitro')).driveForce).toBe(bareParams.driveForce);
  });

  it('Traction Computer: 12% more grip in a slide for 4 power a second', () => {
    const p = paramsOf(fitted('utility_traction'));
    expect(p.power.consumers).toEqual([
      { draw: 4, priority: 2, effect: { slipRecovery: 0.12, stability: 4 } },
    ]);
    const stats = statsOf(fitted('utility_traction'));
    expect(stats.details.control.slideGrip / bare.details.control.slideGrip).toBeCloseTo(1.12, 9);
    expect(stats.indicators.stability.powered).toBe(4);
    // Full lock at speed: the slide is shallower with the computer than without its power.
    const dead = { ...p, power: { ...p.power, generation: 0, capacity: 0 } };
    const on = stepSteer(p, 240, 1);
    const off = stepSteer(dead, 240, 1);
    expect(on.lateralAccel).toBeGreaterThan(off.lateralAccel);
    expect(on.peakSlipDeg).toBeLessThanOrEqual(off.peakSlipDeg);
  });

  it('Gyro Stabilizer: +16 stability while it has 3 power a second', () => {
    // On a Trike, which starts below its threshold, the gyro buys real grip.
    const base = baselineBlueprint({ chassisId: 'chassis_trike' }, 'Bench');
    const withGyro = fitted('utility_gyro', base);
    const a = statsOf(base).indicators.stability;
    const b = statsOf(withGyro).indicators.stability;
    expect(b.powered).toBe(16);
    expect(a.powered).toBe(0);
    expect(a.score).toBeLessThan(a.threshold);
    expect(statsOf(base).warnings.map((w) => w.code)).toContain('UNSTABLE');
    // Its 57 kg rides on the Trike's roof mount, and weight carried high takes some back.
    expect(b.score - a.score).toBeGreaterThanOrEqual(8);
    expect(b.score - a.score).toBeLessThan(16);
    expect(b.highCenterPenalty).toBeGreaterThan(a.highCenterPenalty + 3);
    // On a Beetle, mounted in a sill pod, the same: +16 less what the offset weight costs.
    const beetle = statsOf(baselineBlueprint()).indicators.stability;
    const beetleGyro = statsOf(fitted('utility_gyro', baselineBlueprint())).indicators.stability;
    const cost = (key: 'lateralWeightPenalty' | 'longitudinalPenalty' | 'highCenterPenalty') =>
      beetleGyro[key] - beetle[key];
    expect(cost('lateralWeightPenalty')).toBeGreaterThan(2);
    expect(beetleGyro.raw + beetleGyro.powered - beetle.raw).toBeCloseTo(
      16 - cost('lateralWeightPenalty') - cost('longitudinalPenalty') - cost('highCenterPenalty'),
      6,
    );
    const p = paramsOf(withGyro);
    expect(p.power.consumers).toEqual([{ draw: 3, priority: 2, effect: { stability: 16 } }]);
    const dead = { ...p, power: { ...p.power, generation: 0, capacity: 0 } };
    expect(stepSteer(p, 200, 1).lateralAccel).toBeGreaterThan(
      stepSteer(dead, 200, 1).lateralAccel * 1.02,
    );
  });

  it('Radar, Mine Detector and Decoy Drone: sensors and countermeasures, declared for combat', () => {
    expect(ACCESSORIES.utility_radar!.params).toMatchObject({
      trackingRangeFactor: 1.5,
      missileWarningExtraSeconds: 0.5,
    });
    expect(ACCESSORIES.utility_radar!.triggerMode).toBe('passive');
    expect(ACCESSORIES.utility_minesensor!.actions).toEqual([
      { type: 'ShowTelegraph', style: 'mine_marker', distance: 120 },
    ]);
    expect(ACCESSORIES.utility_decoy!.actions).toContainEqual({
      type: 'ConsumeCharge',
      charges: 2,
    });
    expect(ACCESSORIES.utility_decoy!.actions![0]).toMatchObject({
      type: 'InterceptProjectile',
      kind: 'guided',
      mode: 'decoy',
    });
    // None of them changes how the car drives beyond its weight.
    for (const id of ['utility_radar', 'utility_minesensor', 'utility_decoy']) {
      const p = paramsOf(fitted(id));
      expect({ ...p, massKg: 0, brakeDecel: 0, stability: 0 }, id).toEqual({
        ...bareParams,
        massKg: 0,
        brakeDecel: 0,
        stability: 0,
      });
    }
    // A radar sits tall on its mount, which costs a little stability.
    expect(statsOf(fitted('utility_radar')).indicators.stability.highCenterPenalty).toBeGreaterThan(
      0,
    );
  });

  it('Jump Pad and Recovery Winch: manual escapes with the specified cooldowns', () => {
    expect(ACCESSORIES.utility_jump!.actions).toContainEqual({ type: 'StartCooldown', seconds: 9 });
    expect(ACCESSORIES.utility_jump!.massKg).toBe(100);
    expect(ACCESSORIES.utility_winch!.actions).toContainEqual({
      type: 'StartCooldown',
      seconds: 20,
    });
    expect(ACCESSORIES.utility_winch!.params).toMatchObject({ trappedSeconds: 1.5 });
    for (const id of ['utility_jump', 'utility_winch'])
      expect(ACCESSORIES[id]!.triggerMode).toBe('manual');
  });

  it('Sliding Ballast: more grip the harder you turn, and a steadier car', () => {
    const p = paramsOf(fitted('utility_ballast'));
    expect(p.corneringGrip).toBeCloseTo(0.05, 9);
    expect(p.power.consumers).toEqual([]);
    const stats = statsOf(fitted('utility_ballast'));
    expect(
      stats.indicators.stability.stabilizationBonus - bare.indicators.stability.stabilizationBonus,
    ).toBe(8);
    // Same car, same weight, with the ballast locked in place: less cornering force.
    const locked = { ...p, corneringGrip: 0 };
    const a = stepSteer(p, 240, 1);
    const b = stepSteer(locked, 240, 1);
    expect(a.lateralAccel).toBeGreaterThan(b.lateralAccel * 1.02);
    // In a straight line it is 90 kg of nothing.
    expect(sprint(p).distance8s).toBeLessThan(sprint(bareParams).distance8s);
    expect(sprint(p).distance8s).toBeCloseTo(sprint(locked).distance8s, 9);
  });

  it('Active Wing: more grip the faster you go, for 3 power a second and 4% drag', () => {
    const p = paramsOf(fitted('utility_spoiler'));
    expect(p.power.consumers).toEqual([
      { draw: 3, priority: 3, effect: { downforce: 0.1, stability: 5 } },
    ]);
    expect(p.dragQuadratic / bareParams.dragQuadratic).toBeCloseTo(1.04, 9);
    const gripAt = (params: VehicleParams, speed: number) => {
      const r = rig(params);
      r.state.velocityX = -speed;
      r.run(FULL, 1 / 30);
      return r.telemetry.grip;
    };
    expect(gripAt(p, 0)).toBeCloseTo(1, 6);
    expect(gripAt(p, 125)).toBeCloseTo(1 + 0.1 * 0.25, 2);
    expect(gripAt(p, 250)).toBeCloseTo(1.1, 2);
    expect(gripAt(p, 300)).toBeCloseTo(1.1, 2);
    const dead = { ...p, power: { ...p.power, generation: 0, capacity: 0 } };
    expect(gripAt(dead, 250)).toBe(1);
    expect(stepSteer(p, 250, 1).lateralAccel).toBeGreaterThan(
      stepSteer(dead, 250, 1).lateralAccel * 1.04,
    );
    expect(sprint(p).topMph).toBeLessThan(sprint(bareParams).topMph - 0.5);
  });

  it('Turret Computer: 25% faster acquisition for 4 power a second, worth more with a turret', () => {
    expect(paramsOf(fitted('utility_targeting')).power.consumers).toEqual([
      { draw: 4, priority: 3, effect: {} },
    ]);
    const alone = statsOf(fitted('utility_targeting'));
    expect(alone.indicators.energy.drawPerSecond).toBe(4);
    const turret = fitted('weapon_turret');
    const gain =
      statsOf(fitted('utility_targeting', turret)).details.utility.points -
      statsOf(turret).details.utility.points;
    expect(gain).toBeCloseTo(5, 9);
    expect(alone.details.utility.points).toBe(1);
  });

  it('Solar Panel: +4 power in clear daylight, weak at night and in storms', () => {
    const bp = fitted('utility_solar');
    const generation = (conditions: BuildConditions) =>
      paramsOf(bp, conditions).power.generation - BASE_GENERATION;
    expect(generation({ weather: 'clear', timeOfDay: 'day' })).toBe(4);
    expect(generation({ weather: 'dry_heat', timeOfDay: 'day' })).toBe(4);
    expect(generation({ weather: 'clear_frost', timeOfDay: 'day' })).toBe(4);
    for (const weather of WEATHER_IDS)
      for (const timeOfDay of ['day', 'dusk', 'night'] as const) {
        const got = generation({ weather, timeOfDay });
        expect(got, `${weather} ${timeOfDay}`).toBeCloseTo(
          4 * SOLAR_TIME[timeOfDay] * SOLAR_WEATHER[weather],
          9,
        );
        expect(got).toBeLessThanOrEqual(4);
        expect(got).toBeGreaterThan(0);
      }
    // Weak at night and in storms: under a third of its rated output.
    expect(generation({ weather: 'clear', timeOfDay: 'night' })).toBeLessThan(4 / 3);
    for (const storm of ['rain', 'heavy_rain', 'sandstorm', 'snowfall'] as const)
      expect(generation({ weather: storm, timeOfDay: 'day' }), storm).toBeLessThan(4 / 3);
    // On Neon Cut, a night track, the garage says so.
    const night = conditionsFor('city_01', 'city_clear_night')!;
    expect(night.timeOfDay).toBe('night');
    expect(statsOf(bp, night).indicators.energy.generationPerSecond).toBeCloseTo(10.4, 9);
    expect(statsOf(bp, night).scores.utility).toBeLessThan(
      statsOf(bp, { weather: 'clear', timeOfDay: 'day' }).scores.utility,
    );
    // No heat at all, unlike the generator.
    expect(paramsOf(bp).heat.constantPerSecond).toBe(0);
  });
});
