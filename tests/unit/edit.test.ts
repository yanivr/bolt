import {
  BASELINE_BLUEPRINT,
  CATALOG,
  CHASSIS_LIST,
  DEFENSE_LIST,
  ENGINE_LIST,
  ROOKIE_BLUEPRINT,
  TEMPLATES,
  TIRE_LIST,
  UTILITY_LIST,
  WEAPON_LIST,
  baselineBlueprint,
} from '@bolt/content';
import type { AccessoryDefinition, EditResult, VehicleBlueprint } from '@bolt/shared';
import {
  MAX_GARAGE_HISTORY,
  STARTING_CREDITS,
  accessoryMounts,
  assignActionSlot,
  blueprintCost,
  buildHash,
  compareCost,
  createHistory,
  installPart,
  installedParts,
  movePart,
  nextInstanceId,
  pushHistory,
  redo,
  removePart,
  renameBlueprint,
  repairBlueprint,
  rotatePart,
  setPaint,
  suggestMount,
  swapChassis,
  swapEngine,
  swapTires,
  undo,
  validateBlueprint,
  wheelKitPrice,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { car, check, errorCodes } from '../helpers/blueprints.js';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`edit refused: ${result.issue.code} ${result.issue.message}`);
  return result;
}

function refusal(result: EditResult): Extract<EditResult, { ok: false }> {
  if (result.ok) throw new Error('edit was accepted');
  return result;
}

/** The cheapest legal essentials, so any single part is affordable and under the weight cap. */
function cheapCar(chassisId: string): VehicleBlueprint {
  return deepFreeze(
    baselineBlueprint(
      { chassisId, engineId: 'engine_mini_electric', tireKitId: 'tires_micro' },
      'Bench',
    ),
  );
}

/** Installs a part on the first chassis that has room for it. */
function installSomewhere(part: AccessoryDefinition): {
  before: VehicleBlueprint;
  result: Extract<EditResult, { ok: true }>;
} {
  for (const chassis of CHASSIS_LIST) {
    const before = cheapCar(chassis.id);
    const result = installPart(before, CATALOG, part.id);
    if (result.ok) return { before, result };
  }
  throw new Error(`${part.id} installs nowhere`);
}

describe('price and refund of all 120 parts (Sections 6.1 and 19.1)', () => {
  it.each([...WEAPON_LIST, ...DEFENSE_LIST, ...UTILITY_LIST])(
    '$id: install spends its price, remove refunds it in full',
    (part) => {
      const { before, result } = installSomewhere(part);
      const start = blueprintCost(before, CATALOG).total;
      expect(result.spend).toEqual({
        newSpend: part.price,
        refund: 0,
        net: part.price,
        totalCost: start + part.price,
        creditsLeft: STARTING_CREDITS - start - part.price,
      });
      expect(result.removed).toEqual([]);
      expect(result.blueprint.parts).toHaveLength(1);
      expect(result.blueprint.parts[0]!.partId).toBe(part.id);
      expect(result.instanceId).toBe(result.blueprint.parts[0]!.instanceId);
      // Whatever the helper produced is a legal build as far as the server is concerned.
      const verdict = check(result.blueprint);
      expect(verdict.ok, part.id).toBe(true);
      expect(verdict.totalCost).toBe(start + part.price);

      const sold = ok(removePart(result.blueprint, CATALOG, result.instanceId!));
      expect(sold.spend).toEqual({
        newSpend: 0,
        refund: part.price,
        net: -part.price,
        totalCost: start,
        creditsLeft: STARTING_CREDITS - start,
      });
      expect(sold.blueprint.parts).toEqual([]);
      expect(buildHash(sold.blueprint)).toBe(buildHash(before));
    },
  );

  it.each(ENGINE_LIST)(
    '$id: swapping it in spends its price and refunds the old engine',
    (engine) => {
      const before = deepFreeze(baselineBlueprint({ engineId: 'engine_four_cylinder' }));
      if (engine.id === 'engine_four_cylinder') {
        const same = ok(swapEngine(before, CATALOG, engine.id));
        expect(same.spend).toMatchObject({ newSpend: 0, refund: 0, net: 0, totalCost: 370 });
        return;
      }
      const swapped = ok(swapEngine(before, CATALOG, engine.id));
      expect(swapped.spend).toEqual({
        newSpend: engine.price,
        refund: 140,
        net: engine.price - 140,
        totalCost: 370 - 140 + engine.price,
        creditsLeft: 1000 - (370 - 140 + engine.price),
      });
      expect(swapped.blueprint.engineId).toBe(engine.id);
      const back = ok(swapEngine(swapped.blueprint, CATALOG, 'engine_four_cylinder'));
      expect(back.spend).toMatchObject({ newSpend: 140, refund: engine.price, totalCost: 370 });
      expect(buildHash(back.blueprint)).toBe(buildHash(before));
    },
  );

  it.each(TIRE_LIST)('$id: is priced for three, four and six wheels when swapped in', (kit) => {
    for (const [chassisId, wheels] of [
      ['chassis_trike', 3],
      ['chassis_beetle', 4],
      ['chassis_spider', 6],
    ] as const) {
      const before = deepFreeze(baselineBlueprint({ chassisId, engineId: 'engine_four_cylinder' }));
      const old = wheelKitPrice(CATALOG.tires.tires_street!, wheels);
      const expected = Math.round((kit.price * wheels) / 4);
      const swapped = ok(swapTires(before, CATALOG, kit.id));
      if (kit.id === 'tires_street') {
        expect(swapped.spend).toMatchObject({ newSpend: 0, refund: 0 });
        continue;
      }
      expect(swapped.spend.newSpend, `${wheels} wheels`).toBe(expected);
      expect(swapped.spend.refund, `${wheels} wheels`).toBe(old);
      expect(blueprintCost(swapped.blueprint, CATALOG).tires).toBe(expected);
      expect(check(swapped.blueprint).totalCost).toBe(
        blueprintCost(before, CATALOG).total - old + expected,
      );
    }
  });

  it.each(CHASSIS_LIST)(
    '$id: swapping to it spends its price, refunds the Beetle and re-prices the wheels',
    (chassis) => {
      const before = deepFreeze(baselineBlueprint({ engineId: 'engine_four_cylinder' }));
      const swapped = ok(swapChassis(before, CATALOG, chassis.id));
      if (chassis.id === 'chassis_beetle') {
        expect(swapped.spend).toMatchObject({ newSpend: 0, refund: 0, totalCost: 370 });
        return;
      }
      const tires = wheelKitPrice(CATALOG.tires.tires_street!, chassis.wheelCount);
      const reprice = tires !== 80;
      expect(swapped.spend).toEqual({
        newSpend: chassis.price + (reprice ? tires : 0),
        refund: 150 + (reprice ? 80 : 0),
        net: chassis.price - 150 + tires - 80,
        totalCost: chassis.price + 140 + tires,
        creditsLeft: 1000 - (chassis.price + 140 + tires),
      });
      expect(check(swapped.blueprint).ok).toBe(true);
    },
  );

  it('charges nothing to move, rotate, repaint, rename or reassign', () => {
    const start = deepFreeze(TEMPLATES.find((t) => t.id === 'starter_tinker')!.blueprint);
    const fan = ok(installPart(start, CATALOG, 'utility_fan', { mountId: 'roof_rear' }));
    const free = { newSpend: 0, refund: 0, net: 0 };
    expect(
      ok(movePart(fan.blueprint, CATALOG, fan.instanceId!, { offsetX: 1 })).spend,
    ).toMatchObject(free);
    expect(ok(setPaint(start, CATALOG, 'paint_cobalt')).spend).toMatchObject(free);
    expect(ok(renameBlueprint(start, CATALOG, 'Dust Devil')).spend).toMatchObject(free);
    const gun = start.parts.find((p) => p.partId === 'weapon_shotgun')!;
    expect(ok(assignActionSlot(start, CATALOG, gun.instanceId, 1)).spend).toMatchObject(free);
    expect(ok(rotatePart(start, CATALOG, gun.instanceId)).spend).toMatchObject(free);
    expect(compareCost(start, start, CATALOG)).toMatchObject(free);
    // Two identical parts swapped for one of another kind: spend and refund stay separate.
    const a = car('chassis_brick', [
      { partId: 'utility_fan', mountId: 'front_utility' },
      { partId: 'utility_fan', mountId: 'rear_utility' },
    ]);
    const b = car('chassis_brick', [
      { partId: 'utility_fan', mountId: 'front_utility' },
      { partId: 'utility_radiator', mountId: 'rear_utility' },
    ]);
    expect(compareCost(a, b, CATALOG)).toMatchObject({ newSpend: 90, refund: 55, net: 35 });
  });
});

describe('installPart', () => {
  it('refuses, with the approved reason, instead of silently ignoring a purchase', () => {
    const base = deepFreeze(baselineBlueprint());
    const unknown = refusal(installPart(base, CATALOG, 'weapon_death_ray'));
    expect(unknown.issue.code).toBe('UNKNOWN_PART');
    expect(unknown.blueprint).toBe(base);
    for (const inherited of ['__proto__', 'constructor', 'toString'])
      expect(refusal(installPart(base, CATALOG, inherited)).issue.code).toBe('UNKNOWN_PART');
    // The Beetle has no side mount for a saw.
    const saw = refusal(installPart(base, CATALOG, 'weapon_saw'));
    expect(saw.issue).toMatchObject({
      code: 'NO_COMPATIBLE_MOUNT',
      message: 'No compatible mount',
    });
    expect(
      refusal(installPart(base, CATALOG, 'utility_fan', { mountId: 'nowhere' })).issue.code,
    ).toBe('UNKNOWN_MOUNT');
    expect(
      refusal(installPart(base, CATALOG, 'weapon_saw', { mountId: 'roof_mid' })).issue.code,
    ).toBe('NO_COMPATIBLE_MOUNT');
    expect(
      refusal(installPart(base, CATALOG, 'weapon_mortar', { mountId: 'roof_mid' })).issue.code,
    ).toBe('PART_TOO_LARGE');
    expect(
      refusal(
        installPart(base, CATALOG, 'utility_radar', {
          mountId: 'roof_mid',
          offsetX: 9,
          offsetY: 0,
          rotationQuarterTurns: 0,
        }),
      ).issue.code,
    ).toBe('OUT_OF_REGION');
    expect(
      refusal(
        installPart(base, CATALOG, 'weapon_front_mg', {
          mountId: 'front_center',
          offsetX: 0,
          offsetY: 0,
          rotationQuarterTurns: 2,
        }),
      ).issue.code,
    ).toBe('BAD_ROTATION');
  });

  it('never spends past 1,000 credits', () => {
    let bp = baselineBlueprint({
      chassisId: 'chassis_platform',
      engineId: 'engine_v12',
      tireKitId: 'tires_track',
    });
    expect(blueprintCost(bp, CATALOG).total).toBe(690);
    bp = ok(installPart(bp, CATALOG, 'weapon_mortar')).blueprint;
    const refused = refusal(installPart(bp, CATALOG, 'defense_antimissile'));
    expect(refused.issue).toMatchObject({
      code: 'NOT_ENOUGH_CREDITS',
      message: 'Not enough credits',
    });
    expect(refused.issue.detail).toMatchObject({ over: 25 });
    expect(refused.blueprint).toBe(bp);
    // Something that fits the 135 credits left is still welcome.
    expect(installPart(bp, CATALOG, 'weapon_turret').ok).toBe(true);
  });

  it('refuses weight past the chassis maximum and a second unique part', () => {
    let trike = baselineBlueprint({
      chassisId: 'chassis_trike',
      engineId: 'engine_twin',
      tireKitId: 'tires_track',
    });
    trike = ok(installPart(trike, CATALOG, 'weapon_shotgun')).blueprint;
    // 190 + 157.5 + 40 = 387.5 kg installed of 460; a generator is 82 more.
    const heavy = refusal(installPart(trike, CATALOG, 'utility_generator'));
    expect(heavy.issue).toMatchObject({
      code: 'TOO_HEAVY',
      message: 'Too much weight',
      hint: 'Too heavy for this chassis. Remove weight or swap frames.',
    });
    const gyro = ok(installPart(baselineBlueprint(), CATALOG, 'utility_gyro'));
    expect(refusal(installPart(gyro.blueprint, CATALOG, 'utility_gyro')).issue).toMatchObject({
      code: 'ONE_PER_CAR',
      message: 'One per car',
    });
  });

  it('refuses a full mount when asked for it by name, and names the part in the way', () => {
    const first = ok(
      installPart(baselineBlueprint(), CATALOG, 'weapon_turret', { mountId: 'roof_mid' }),
    );
    const second = refusal(
      installPart(first.blueprint, CATALOG, 'utility_radar', { mountId: 'roof_mid' }),
    );
    expect(['MOUNT_OCCUPIED', 'PART_BLOCKS_ANOTHER']).toContain(second.issue.code);
    // The highlight goes on the part just added, and names the one in its way.
    expect(second.issue.partId).toBe('utility_radar');
    expect(second.issue.otherInstanceId).toBe(first.instanceId);
  });

  it('hands out fire buttons: primary, secondary, then automatic for a hybrid or inactive for a manual', () => {
    let bp = baselineBlueprint({
      chassisId: 'chassis_platform',
      engineId: 'engine_mini_electric',
      tireKitId: 'tires_micro',
    });
    const slots: Array<[string, number | undefined, boolean | undefined]> = [];
    for (const partId of [
      'weapon_front_mg',
      'weapon_shotgun',
      'weapon_turret',
      'weapon_oil',
      'weapon_tesla',
    ]) {
      const result = ok(installPart(bp, CATALOG, partId));
      bp = result.blueprint;
      const placed = bp.parts.find((p) => p.instanceId === result.instanceId)!;
      slots.push([partId, placed.assignedActionSlot, placed.autoMode]);
    }
    expect(slots).toEqual([
      ['weapon_front_mg', 0, undefined],
      ['weapon_shotgun', 1, undefined],
      ['weapon_turret', undefined, true],
      ['weapon_oil', undefined, undefined],
      ['weapon_tesla', undefined, undefined],
    ]);
    const verdict = check(bp);
    expect(verdict.ok).toBe(true);
    // The manual weapon left without a button is called out before Ready.
    expect(verdict.issues.map((i) => [i.code, i.partId])).toEqual([
      ['WEAPON_INACTIVE', 'weapon_oil'],
    ]);
  });

  it('gives each new part the lowest free instance id and leaves the input untouched', () => {
    const base = deepFreeze(baselineBlueprint());
    const one = ok(installPart(base, CATALOG, 'utility_fan'));
    const two = ok(installPart(deepFreeze(one.blueprint), CATALOG, 'utility_repair'));
    expect(one.instanceId).toBe('p1');
    expect(two.instanceId).toBe('p2');
    const gone = ok(removePart(deepFreeze(two.blueprint), CATALOG, 'p1'));
    expect(nextInstanceId(gone.blueprint)).toBe('p1');
    expect(base.parts).toEqual([]);
    expect(refusal(removePart(base, CATALOG, 'p9')).issue.code).toBe('UNKNOWN_PART');
  });
});

describe('suggestMount', () => {
  it('returns a legal placement for every part on every chassis, or null', () => {
    let placed = 0;
    let nowhere = 0;
    for (const chassis of CHASSIS_LIST) {
      const bp = cheapCar(chassis.id);
      for (const part of Object.values(CATALOG.parts)) {
        const where = suggestMount(bp, CATALOG, part.id);
        if (!where) {
          nowhere++;
          // Null means no mount at all would take it, not that the search gave up.
          for (const mount of accessoryMounts(chassis))
            expect(
              installPart(bp, CATALOG, part.id, { mountId: mount.id }).ok,
              `${chassis.id} ${part.id} ${mount.id}`,
            ).toBe(false);
          continue;
        }
        placed++;
        const result = installPart(bp, CATALOG, part.id, where);
        expect(result.ok, `${chassis.id} ${part.id} at ${where.mountId}`).toBe(true);
      }
    }
    expect(placed).toBeGreaterThan(900);
    expect(nowhere).toBeGreaterThan(50);
    expect(suggestMount(baselineBlueprint(), CATALOG, 'nope')).toBeNull();
    expect(
      suggestMount({ ...baselineBlueprint(), chassisId: 'nope' }, CATALOG, 'utility_fan'),
    ).toBeNull();
  });

  it('prefers where the part belongs, keeps large mounts free and shares a rack last', () => {
    const beetle = baselineBlueprint();
    // A machine gun lists FRONT first; a sentry lists REAR first and faces backward there.
    expect(suggestMount(beetle, CATALOG, 'weapon_front_mg')).toEqual({
      mountId: 'front_center',
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 0,
    });
    expect(suggestMount(beetle, CATALOG, 'weapon_rear_mg')).toEqual({
      mountId: 'rear_center',
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 2,
    });
    // A small utility takes a pod and leaves the roof for something that needs it.
    expect(suggestMount(beetle, CATALOG, 'utility_repair')!.mountId).toBe('left_utility');
    // With the front taken, the next gun goes to the roof.
    const armed = ok(installPart(beetle, CATALOG, 'weapon_front_mg')).blueprint;
    expect(suggestMount(armed, CATALOG, 'weapon_shotgun')!.mountId).toBe('roof_mid');
    // On a Brick, small roof parts fill every free mount before two of them share the rack.
    let brick = baselineBlueprint({ chassisId: 'chassis_brick' });
    const homes: string[] = [];
    for (const partId of [
      'utility_radar',
      'utility_minesensor',
      'utility_targeting',
      'utility_capacitor',
      'utility_traction',
    ]) {
      const result = ok(installPart(brick, CATALOG, partId));
      brick = result.blueprint;
      homes.push(brick.parts.find((p) => p.instanceId === result.instanceId)!.mountId);
    }
    expect(new Set(homes.slice(0, 3)).size).toBe(3);
    expect(homes.filter((m) => m === 'roof_mid').length).toBeLessThanOrEqual(2);
    expect(check(brick).ok).toBe(true);
    // A full car has nowhere left.
    let full = baselineBlueprint();
    for (const partId of [
      'utility_radar',
      'utility_fan',
      'utility_repair',
      'weapon_front_mg',
      'weapon_rear_mg',
    ])
      full = ok(installPart(full, CATALOG, partId)).blueprint;
    expect(full.parts).toHaveLength(5);
    expect(suggestMount(full, CATALOG, 'utility_battery')).toBeNull();
    expect(refusal(installPart(full, CATALOG, 'utility_battery')).issue.code).toBe(
      'NO_COMPATIBLE_MOUNT',
    );
  });
});

describe('movePart and rotatePart', () => {
  const start = deepFreeze(
    car('chassis_brick', [
      {
        partId: 'weapon_front_mg',
        mountId: 'roof_mid',
        instanceId: 'gun',
        assignedActionSlot: 0,
        offsetX: -5,
      },
      { partId: 'utility_radar', mountId: 'roof_mid', instanceId: 'radar', offsetX: 5 },
    ]),
  );

  it('moves within the region and to another mount, and refuses anything illegal', () => {
    expect(check(start).ok).toBe(true);
    const nudged = ok(movePart(start, CATALOG, 'gun', { offsetY: 3 }));
    expect(nudged.blueprint.parts.find((p) => p.instanceId === 'gun')).toMatchObject({
      offsetX: -5,
      offsetY: 3,
    });
    expect(buildHash(nudged.blueprint)).not.toBe(buildHash(start));
    // Fractions snap to the pixel grid.
    expect(
      ok(movePart(start, CATALOG, 'gun', { offsetY: 2.6 })).blueprint.parts.find(
        (p) => p.instanceId === 'gun',
      )!.offsetY,
    ).toBe(3);
    expect(refusal(movePart(start, CATALOG, 'gun', { offsetX: -9 })).issue.code).toBe(
      'OUT_OF_REGION',
    );
    // Onto the radar.
    const onto = refusal(movePart(start, CATALOG, 'gun', { offsetX: 5 }));
    expect(onto.issue).toMatchObject({ code: 'PART_BLOCKS_ANOTHER', otherInstanceId: 'radar' });
    expect(onto.blueprint).toBe(start);
    // To another mount: the offset resets to the centre.
    const bay = ok(movePart(start, CATALOG, 'radar', { mountId: 'front_utility' }));
    expect(bay.blueprint.parts.find((p) => p.instanceId === 'radar')).toMatchObject({
      mountId: 'front_utility',
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 0,
    });
    // The Brick's front and rear mounts are wide and shallow: a 12-long gun only fits turned
    // sideways, so the move picks the first orientation that is allowed there and fits.
    const front = ok(movePart(start, CATALOG, 'gun', { mountId: 'front_center' }));
    expect(front.blueprint.parts.find((p) => p.instanceId === 'gun')).toMatchObject({
      mountId: 'front_center',
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: 3,
    });
    const rear = ok(movePart(start, CATALOG, 'gun', { mountId: 'rear_center' }));
    expect(rear.blueprint.parts.find((p) => p.instanceId === 'gun')!.rotationQuarterTurns).toBe(3);
    expect(check(front.blueprint).ok && check(rear.blueprint).ok).toBe(true);
    expect(refusal(movePart(start, CATALOG, 'gun', { mountId: 'engine_bay' })).issue.code).toBe(
      'NO_COMPATIBLE_MOUNT',
    );
    expect(refusal(movePart(start, CATALOG, 'gun', { mountId: 'nowhere' })).issue.code).toBe(
      'UNKNOWN_MOUNT',
    );
    expect(refusal(movePart(start, CATALOG, 'ghost', { offsetX: 1 })).issue.code).toBe(
      'UNKNOWN_PART',
    );
  });

  it('steps a part through the orientations its mount allows and its footprint fits', () => {
    // On the big roof rack every quarter turn is allowed, but the radar is in the way of a
    // sideways gun, so the gun alone is used here.
    const solo = deepFreeze(
      car('chassis_brick', [
        {
          partId: 'weapon_front_mg',
          mountId: 'roof_mid',
          instanceId: 'gun',
          assignedActionSlot: 0,
        },
      ]),
    );
    const seen = [0];
    let bp: VehicleBlueprint = solo;
    for (let i = 0; i < 4; i++) {
      bp = ok(rotatePart(bp, CATALOG, 'gun')).blueprint;
      seen.push(bp.parts[0]!.rotationQuarterTurns);
    }
    expect(seen).toEqual([0, 1, 2, 3, 0]);
    expect(ok(rotatePart(solo, CATALOG, 'gun', 2)).blueprint.parts[0]!.rotationQuarterTurns).toBe(
      2,
    );
    // On a front mount the step skips the orientation that points back across the cabin.
    const nose = deepFreeze(
      car('chassis_beetle', [
        {
          partId: 'weapon_front_mg',
          mountId: 'front_center',
          instanceId: 'gun',
          assignedActionSlot: 0,
        },
      ]),
    );
    const turns = [0];
    bp = nose;
    for (let i = 0; i < 3; i++) {
      bp = ok(rotatePart(bp, CATALOG, 'gun')).blueprint;
      turns.push(bp.parts[0]!.rotationQuarterTurns);
    }
    expect(turns).toEqual([0, 1, 3, 0]);
    expect(refusal(rotatePart(nose, CATALOG, 'gun', 2)).issue.code).toBe('BAD_ROTATION');
    // A part that cannot turn has nowhere to step to.
    expect(refusal(rotatePart(start, CATALOG, 'radar')).issue.code).toBe('BAD_ROTATION');
  });
});

describe('swapChassis (Sections 5.6 and 6.6)', () => {
  it('keeps parts on mounts of the same name and finds homes for the rest', () => {
    const rookie = deepFreeze(ROOKIE_BLUEPRINT);
    // Beetle to Buggy: both mounts exist under the same names.
    const buggy = ok(swapChassis(rookie, CATALOG, 'chassis_buggy'));
    expect(buggy.removed).toEqual([]);
    expect(buggy.blueprint.parts.map((p) => [p.partId, p.mountId]).sort()).toEqual([
      ['utility_spare', 'left_utility'],
      ['weapon_front_mg', 'front_center'],
    ]);
    expect(buggy.spend).toMatchObject({ newSpend: 165, refund: 150, totalCost: 495 });
    // Beetle to Arrow: no utility pods, so the spare moves to a roof or rear mount.
    const arrow = ok(swapChassis(rookie, CATALOG, 'chassis_arrow'));
    expect(arrow.removed).toEqual([]);
    const spare = arrow.blueprint.parts.find((p) => p.partId === 'utility_spare')!;
    expect(['roof_mid', 'roof_rear']).toContain(spare.mountId);
    expect(arrow.blueprint.parts.find((p) => p.partId === 'weapon_front_mg')!.mountId).toBe(
      'front_center',
    );
    expect(check(arrow.blueprint).ok).toBe(true);
    // The gun keeps its fire button and both parts keep their instance ids.
    expect(arrow.blueprint.parts.map((p) => p.instanceId).sort()).toEqual(
      rookie.parts.map((p) => p.instanceId).sort(),
    );
    expect(
      arrow.blueprint.parts.find((p) => p.partId === 'weapon_front_mg')!.assignedActionSlot,
    ).toBe(0);
  });

  it('removes and refunds parts the new frame cannot carry, and lists them', () => {
    const beetle = deepFreeze(
      car('chassis_beetle', [
        {
          partId: 'weapon_turret',
          mountId: 'roof_mid',
          instanceId: 'turret',
          assignedActionSlot: 0,
        },
        { partId: 'utility_radar', mountId: 'left_utility', instanceId: 'radar' },
        {
          partId: 'weapon_rear_mg',
          mountId: 'rear_center',
          instanceId: 'sentry',
          rotationQuarterTurns: 2,
        },
      ]),
    );
    expect(check(beetle).ok).toBe(true);
    // The Rammer has no roof and no utility mount: the radar has nowhere to go, and the
    // turret is too large for its forward mounts.
    const rammer = ok(swapChassis(beetle, CATALOG, 'chassis_rammer'));
    expect(rammer.removed.map((r) => [r.instance.instanceId, r.refund, r.reason]).sort()).toEqual([
      ['radar', 45, 'NO_COMPATIBLE_MOUNT'],
      ['turret', 130, 'NO_COMPATIBLE_MOUNT'],
    ]);
    expect(rammer.blueprint.parts.map((p) => p.instanceId)).toEqual(['sentry']);
    expect(check(rammer.blueprint).issues).toEqual([]);
    // One atomic step: Beetle and removed parts refunded, Rammer bought.
    expect(rammer.spend).toEqual({
      newSpend: 220,
      refund: 150 + 130 + 45,
      net: 220 - 325,
      totalCost: 220 + 140 + 80 + 85,
      creditsLeft: 1000 - 525,
    });
    expect(beetle.parts).toHaveLength(3);
  });

  it('re-prices the wheel kit for the new wheel count', () => {
    const sand = deepFreeze(baselineBlueprint({ tireKitId: 'tires_sand' }));
    expect(blueprintCost(sand, CATALOG).tires).toBe(125);
    expect(
      blueprintCost(ok(swapChassis(sand, CATALOG, 'chassis_spider')).blueprint, CATALOG).tires,
    ).toBe(188);
    expect(
      blueprintCost(ok(swapChassis(sand, CATALOG, 'chassis_trike')).blueprint, CATALOG).tires,
    ).toBe(94);
  });

  it('is refused whole when the result would be over budget or over weight', () => {
    // 960 credits on a Beetle; the Brick costs 95 more.
    const dear = deepFreeze(
      car(
        'chassis_beetle',
        [
          { partId: 'weapon_turret', mountId: 'roof_mid', assignedActionSlot: 0 },
          { partId: 'weapon_rocket', mountId: 'front_center', assignedActionSlot: 1 },
          { partId: 'utility_battery', mountId: 'left_utility' },
          { partId: 'utility_generator', mountId: 'right_utility' },
        ],
        { engineId: 'engine_v12', tireKitId: 'tires_slick' },
      ),
    );
    expect(check(dear).totalCost).toBe(150 + 290 + 110 + 130 + 100 + 65 + 80);
    const refused = refusal(swapChassis(dear, CATALOG, 'chassis_brick'));
    expect(refused.issue.code).toBe('NOT_ENOUGH_CREDITS');
    expect(refused.blueprint).toBe(dear);
    // 505 kg installed on a Turtle; the Trike allows 460.
    const heavy = deepFreeze(
      car('chassis_turtle', [{ partId: 'defense_heavy_plate', mountId: 'front_center' }], {
        engineId: 'engine_twin',
        tireKitId: 'tires_track',
      }),
    );
    const tooHeavy = refusal(swapChassis(heavy, CATALOG, 'chassis_trike'));
    expect(tooHeavy.issue.code).toBe('TOO_HEAVY');
    expect(refusal(swapChassis(heavy, CATALOG, 'chassis_nope')).issue.code).toBe('UNKNOWN_PART');
    expect(refusal(swapEngine(heavy, CATALOG, 'tires_street')).issue.code).toBe('UNKNOWN_PART');
    expect(refusal(swapTires(heavy, CATALOG, 'engine_v6')).issue.code).toBe('UNKNOWN_PART');
  });

  it('takes armor off when the new frame allows less of it', () => {
    const plated = deepFreeze(
      car('chassis_cobra', [
        { partId: 'defense_heavy_plate', mountId: 'front_nose', instanceId: 'plate' },
        { partId: 'defense_ceramic', mountId: 'roof_rear', instanceId: 'ceramic' },
      ]),
    );
    expect(check(plated).ok).toBe(true);
    const needle = ok(swapChassis(plated, CATALOG, 'chassis_needle'));
    expect(needle.removed.map((r) => [r.instance.instanceId, r.reason])).toEqual([
      ['ceramic', 'TOO_MUCH_ARMOR'],
    ]);
    expect(needle.blueprint.parts.map((p) => p.instanceId)).toEqual(['plate']);
    expect(check(needle.blueprint).ok).toBe(true);
  });

  it('carries every shipped build onto every chassis without ever producing an illegal car', () => {
    let swaps = 0;
    for (const template of TEMPLATES) {
      for (const chassis of CHASSIS_LIST) {
        const result = swapChassis(template.blueprint, CATALOG, chassis.id);
        if (!result.ok) {
          expect(['NOT_ENOUGH_CREDITS', 'TOO_HEAVY']).toContain(result.issue.code);
          continue;
        }
        swaps++;
        const verdict = check(result.blueprint);
        expect(errorCodes(verdict), `${template.id} to ${chassis.id}`).toEqual([]);
        const kept = result.blueprint.parts.length + result.removed.length;
        expect(kept).toBe(template.blueprint.parts.length);
        const refunded = result.removed.reduce((sum, r) => sum + r.refund, 0);
        expect(verdict.totalCost).toBe(
          check(template.blueprint).totalCost - result.spend.refund + result.spend.newSpend,
        );
        expect(result.spend.refund).toBeGreaterThanOrEqual(refunded);
      }
    }
    expect(swaps).toBeGreaterThan(200);
  });
});

describe('assignActionSlot (Section 8.3)', () => {
  const armed = deepFreeze(
    car('chassis_platform', [
      { partId: 'weapon_front_mg', mountId: 'deck_front', instanceId: 'mg', assignedActionSlot: 0 },
      {
        partId: 'weapon_turret',
        mountId: 'deck_fore',
        instanceId: 'turret',
        assignedActionSlot: 1,
      },
      { partId: 'weapon_shotgun', mountId: 'deck_aft', instanceId: 'shotgun' },
      { partId: 'weapon_tesla', mountId: 'left_edge_mid', instanceId: 'tesla' },
    ]),
  );
  const fire = (bp: VehicleBlueprint) =>
    Object.fromEntries(
      bp.parts.map((p) => [p.instanceId, p.assignedActionSlot ?? (p.autoMode ? 'auto' : null)]),
    );

  it('takes the button from whichever weapon had it', () => {
    // The shotgun takes the secondary button: the hybrid turret goes automatic.
    const a = ok(assignActionSlot(armed, CATALOG, 'shotgun', 1));
    expect(fire(a.blueprint)).toEqual({ mg: 0, turret: 'auto', shotgun: 1, tesla: null });
    expect(check(a.blueprint).issues).toEqual([]);
    // The shotgun takes the primary button: the manual machine gun is left inactive.
    const b = ok(assignActionSlot(armed, CATALOG, 'shotgun', 0));
    expect(fire(b.blueprint)).toEqual({ mg: null, turret: 1, shotgun: 0, tesla: null });
    expect(check(b.blueprint).issues.map((i) => [i.code, i.instanceId])).toEqual([
      ['WEAPON_INACTIVE', 'mg'],
    ]);
    // Automatic and inactive.
    expect(fire(ok(assignActionSlot(armed, CATALOG, 'turret', 'auto')).blueprint).turret).toBe(
      'auto',
    );
    expect(fire(ok(assignActionSlot(armed, CATALOG, 'mg', null)).blueprint).mg).toBeNull();
  });

  it('refuses buttons for parts that cannot use one', () => {
    expect(refusal(assignActionSlot(armed, CATALOG, 'tesla', 0)).issue.code).toBe(
      'BAD_ACTION_SLOT',
    );
    expect(refusal(assignActionSlot(armed, CATALOG, 'mg', 'auto')).issue.code).toBe(
      'BAD_AUTO_MODE',
    );
    expect(refusal(assignActionSlot(armed, CATALOG, 'ghost', 0)).issue.code).toBe('UNKNOWN_PART');
    expect(armed.parts.find((p) => p.instanceId === 'shotgun')!.assignedActionSlot).toBeUndefined();
  });
});

describe('repairBlueprint (Section 15.6)', () => {
  it('removes optional parts in descending price until the build is legal again', () => {
    // A legal build under a catalog where two parts were cheaper: now 1,070 credits.
    const imported = deepFreeze(
      car(
        'chassis_platform',
        [
          { partId: 'weapon_mortar', mountId: 'deck_fore', instanceId: 'mortar', autoMode: true },
          {
            partId: 'weapon_turret',
            mountId: 'deck_aft',
            instanceId: 'turret',
            assignedActionSlot: 0,
          },
          { partId: 'utility_fan', mountId: 'left_edge_mid', instanceId: 'fan' },
          { partId: 'utility_radar', mountId: 'right_edge_mid', instanceId: 'radar' },
        ],
        { engineId: 'engine_v12', tireKitId: 'tires_track' },
      ),
    );
    const before = check(imported);
    expect(before.totalCost).toBe(690 + 175 + 130 + 55 + 45);
    expect(errorCodes(before)).toEqual(['NOT_ENOUGH_CREDITS']);
    const repaired = repairBlueprint(imported, CATALOG);
    expect(repaired.ok).toBe(true);
    // The most expensive optional part goes first, and one removal is enough.
    expect(repaired.removed.map((r) => [r.instance.instanceId, r.refund, r.reason])).toEqual([
      ['mortar', 175, 'NOT_ENOUGH_CREDITS'],
    ]);
    expect(check(repaired.blueprint).ok).toBe(true);
    expect(check(repaired.blueprint).totalCost).toBe(920);
    if (repaired.ok) expect(repaired.spend).toMatchObject({ newSpend: 0, refund: 175 });
    // The original record is untouched and the essentials are never changed.
    expect(imported.parts).toHaveLength(4);
    expect([
      repaired.blueprint.chassisId,
      repaired.blueprint.engineId,
      repaired.blueprint.tireKitId,
    ]).toEqual([imported.chassisId, imported.engineId, imported.tireKitId]);
  });

  it('removes as many parts as it takes, priciest first', () => {
    const tight = {
      ...CATALOG,
      chassis: {
        ...CATALOG.chassis,
        chassis_platform: { ...CATALOG.chassis.chassis_platform!, price: 510 },
      },
    };
    const bp = car('chassis_platform', [
      { partId: 'utility_radar', mountId: 'left_edge_mid', instanceId: 'radar' },
      { partId: 'weapon_turret', mountId: 'deck_aft', instanceId: 'turret', assignedActionSlot: 0 },
      {
        partId: 'weapon_rocket',
        mountId: 'deck_fore',
        instanceId: 'rocket',
        assignedActionSlot: 1,
      },
      { partId: 'utility_fan', mountId: 'right_edge_mid', instanceId: 'fan' },
    ]);
    // 510 + 175 + 80 = 765, plus 130 + 100 + 55 + 45 = 1,095.
    const repaired = repairBlueprint(bp, tight);
    expect(repaired.ok).toBe(true);
    expect(repaired.removed.map((r) => r.instance.instanceId)).toEqual(['turret']);
    const tighter = {
      ...tight,
      chassis: {
        ...tight.chassis,
        chassis_platform: { ...tight.chassis.chassis_platform!, price: 650 },
      },
    };
    expect(repairBlueprint(bp, tighter).removed.map((r) => r.instance.instanceId)).toEqual([
      'turret',
      'rocket',
      'fan',
    ]);
  });

  it('re-stamps the catalog version and drops parts the catalog no longer has, cheapest fix first', () => {
    const old = deepFreeze({
      ...car('chassis_beetle', [
        { partId: 'weapon_laser_from_v1', mountId: 'roof_mid', instanceId: 'gone' },
        { partId: 'utility_fan', mountId: 'left_utility', instanceId: 'fan' },
        { partId: 'utility_fan', mountId: 'left_utility', instanceId: 'fan2' },
        {
          partId: 'weapon_front_mg',
          mountId: 'front_center',
          instanceId: 'mg',
          rotationQuarterTurns: 2 as const,
          assignedActionSlot: 0 as const,
        },
      ]),
      catalogVersion: '0.1.0',
    });
    expect(errorCodes(check(old))).toContain('CATALOG_MISMATCH');
    const repaired = repairBlueprint(old, CATALOG);
    expect(repaired.ok).toBe(true);
    expect(repaired.blueprint.catalogVersion).toBe(CATALOG.version);
    // Only parts an error points at are removed: the unknown part, the gun facing the wrong
    // way, and one of the two fans on a single-capacity mount.
    expect(repaired.removed.map((r) => r.instance.instanceId)).toEqual(['gone', 'mg', 'fan2']);
    expect(repaired.blueprint.parts.map((p) => p.instanceId)).toEqual(['fan']);
    expect(old.catalogVersion).toBe('0.1.0');
  });

  it('cannot repair a car whose essentials are themselves illegal, and says why', () => {
    const noEngine = repairBlueprint(
      { ...ROOKIE_BLUEPRINT, engineId: 'engine_from_the_future' },
      CATALOG,
    );
    expect(noEngine.ok).toBe(false);
    if (!noEngine.ok) expect(noEngine.issues.map((i) => i.code)).toEqual(['UNKNOWN_PART']);
    expect(noEngine.blueprint.parts).toEqual([]);
    expect(noEngine.blueprint.engineId).toBe('engine_from_the_future');
    // A legal blueprint is returned unchanged apart from being canonical.
    const fine = repairBlueprint(ROOKIE_BLUEPRINT, CATALOG);
    expect(fine.ok).toBe(true);
    expect(fine.removed).toEqual([]);
    expect(buildHash(fine.blueprint)).toBe(buildHash(ROOKIE_BLUEPRINT));
  });

  it('lets an illegal draft be edited toward legality but never further from it', () => {
    const over = car(
      'chassis_platform',
      [
        { partId: 'weapon_mortar', mountId: 'deck_fore', instanceId: 'mortar', autoMode: true },
        { partId: 'defense_antimissile', mountId: 'deck_aft', instanceId: 'interceptor' },
      ],
      { engineId: 'engine_v12', tireKitId: 'tires_track' },
    );
    expect(errorCodes(check(over))).toEqual(['NOT_ENOUGH_CREDITS']);
    // Spending more is refused; a free move, a cheaper engine and a removal are all allowed.
    expect(refusal(installPart(over, CATALOG, 'utility_radar')).issue.code).toBe(
      'NOT_ENOUGH_CREDITS',
    );
    expect(movePart(over, CATALOG, 'mortar', { offsetX: 1 }).ok).toBe(true);
    const cheaper = ok(swapEngine(over, CATALOG, 'engine_v8'));
    expect(check(cheaper.blueprint).ok).toBe(true);
    expect(check(ok(removePart(over, CATALOG, 'interceptor')).blueprint).ok).toBe(true);
  });
});

describe('undo and redo (Section 6.6)', () => {
  it('walks back and forward through immutable blueprints', () => {
    const a = BASELINE_BLUEPRINT;
    const b = ok(installPart(a, CATALOG, 'utility_fan')).blueprint;
    const c = ok(swapChassis(b, CATALOG, 'chassis_buggy')).blueprint;
    let history = createHistory(a);
    history = pushHistory(history, b);
    history = pushHistory(history, c);
    expect(history.present).toBe(c);
    history = undo(history);
    // Changing a chassis is one atomic step: one undo restores the Beetle and its part.
    expect(history.present).toBe(b);
    history = undo(history);
    expect(history.present).toBe(a);
    expect(undo(history)).toBe(history);
    history = redo(history);
    expect(history.present).toBe(b);
    // A new edit clears redo.
    const d = ok(installPart(b, CATALOG, 'utility_repair')).blueprint;
    history = pushHistory(history, d);
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
    expect(pushHistory(history, d)).toBe(history);
    expect(history.past).toEqual([a, b]);
  });

  it('keeps the last twenty transactions', () => {
    let history = createHistory(BASELINE_BLUEPRINT);
    let bp = BASELINE_BLUEPRINT;
    for (let i = 0; i < 30; i++) {
      bp = ok(renameBlueprint(bp, CATALOG, `Car ${i}`)).blueprint;
      history = pushHistory(history, bp);
    }
    expect(MAX_GARAGE_HISTORY).toBe(20);
    expect(history.past).toHaveLength(20);
    let steps = 0;
    while (history.past.length > 0) {
      history = undo(history);
      steps++;
    }
    expect(steps).toBe(20);
    expect(history.present.name).toBe('Car 9');
    expect(history.future).toHaveLength(20);
  });
});

describe('installedParts', () => {
  it('lists parts in canonical order with their geometry', () => {
    const parts = installedParts(ROOKIE_BLUEPRINT, CATALOG);
    expect(parts.map((p) => p.mount.id)).toEqual(['front_center', 'left_utility']);
    expect(parts[0]).toMatchObject({ x: 0, y: -22, w: 8, h: 12 });
    expect(parts[0]!.rect).toEqual({ x0: -4, y0: -28, x1: 4, y1: -16 });
    expect(validateBlueprint(ROOKIE_BLUEPRINT, CATALOG).ok).toBe(true);
  });
});
