import {
  BASELINE_BLUEPRINT,
  CATALOG,
  CITY_01,
  ROOKIE_BLUEPRINT,
  STRINGS,
  TEMPLATES,
  WEATHER_PRESETS,
  baselineBlueprint,
  getTemplate,
} from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import {
  BUILD_SECONDS,
  COOLING_MULTIPLIER,
  MAX_GARAGE_HISTORY,
  SOLAR_TIME,
  STARTING_CREDITS,
  SURFACE_GRIP,
  blueprintCost,
  buildHash,
  buildTrack,
  installPart,
  serializeBlueprint,
  validateBlueprint,
  wheelKitPrice,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_KEY,
  MAX_SAVED_BLUEPRINTS,
  addBlueprint,
  copyName,
  deleteSaved,
  duplicateBlueprint,
  parseLibrary,
  readLibrary,
  renameSaved,
  repairSaved,
  serializeLibrary,
  writeLibrary,
} from '../../apps/web/src/garage/blueprintLibrary.js';
import { blockingIssue, planInstall, secondsLeft } from '../../apps/web/src/garage/buildSession.js';
import { createGarageStore } from '../../apps/web/src/garage/garageStore.js';
import { fill, listNames, mountName, signedDelta } from '../../apps/web/src/garage/text.js';
import { buildTips, trackFacts } from '../../apps/web/src/garage/trackFacts.js';

/** A garage store on a clock the test controls. */
function garage(start: VehicleBlueprint = BASELINE_BLUEPRINT, seconds = BUILD_SECONDS) {
  const clock = { now: 1_000_000 };
  const store = createGarageStore({ catalog: CATALOG, now: () => clock.now });
  store.getState().start(start, { seconds });
  const session = () => store.getState().session!;
  const car = () => session().history.present;
  const left = () => STARTING_CREDITS - blueprintCost(car(), CATALOG).total;
  return { store, clock, session, car, left, act: store.getState() };
}

function ids(blueprint: VehicleBlueprint): string[] {
  return blueprint.parts.map((p) => p.partId).sort();
}

/** A draft that is over the budget: something no garage edit can produce. */
function overspent(): VehicleBlueprint {
  let car = baselineBlueprint({ chassisId: 'chassis_brick', engineId: 'engine_v12' }, 'Overspent');
  car = { ...car, tireKitId: 'tires_track' };
  for (const partId of ['weapon_mortar', 'weapon_homing', 'defense_antimissile']) {
    const next = installPart(car, CATALOG, partId);
    // The edit helpers refuse to overspend, so the last parts are forced in by hand.
    car = next.ok
      ? next.blueprint
      : {
          ...car,
          parts: [
            ...car.parts,
            {
              instanceId: `x${car.parts.length}`,
              partId,
              mountId: 'roof_mid',
              offsetX: 0,
              offsetY: 0,
              rotationQuarterTurns: 0,
            },
          ],
        };
  }
  const padded: VehicleBlueprint = {
    ...car,
    parts: [
      ...car.parts,
      ...['left_mid', 'right_mid'].map((mountId, i) => ({
        instanceId: `y${i}`,
        partId: 'defense_heavy_plate',
        mountId,
        offsetX: 0,
        offsetY: 0,
        rotationQuarterTurns: (i === 0 ? 3 : 1) as 1 | 3,
      })),
    ],
  };
  return padded;
}

describe('garage session: buying, selling and credits', () => {
  it('starts on the given car with the full budget accounted for and a 60 second clock', () => {
    const g = garage();
    expect(g.car()).toBe(BASELINE_BLUEPRINT);
    expect(g.left()).toBe(630);
    expect(g.session().phase).toBe('building');
    expect(g.session().lastLegal).toEqual(validateBlueprint(BASELINE_BLUEPRINT, CATALOG).blueprint);
    expect(BUILD_SECONDS).toBe(60);
    expect(secondsLeft(g.session(), g.clock.now)).toBe(60);
  });

  it('installs a part for its exact price and selects it', () => {
    const g = garage();
    g.act.setCategory('weapon');
    g.act.focusPart('weapon_front_mg');
    g.act.install('weapon_front_mg');
    expect(ids(g.car())).toEqual(['weapon_front_mg']);
    expect(g.left()).toBe(560);
    const part = g.car().parts[0]!;
    expect(part.mountId).toBe('front_center');
    expect(part.assignedActionSlot).toBe(0);
    expect(g.session().selection).toEqual({ kind: 'instance', instanceId: part.instanceId });
    expect(g.session().focusPartId).toBeNull();
    expect(g.session().notice).toMatchObject({ tone: 'ok', text: 'Front Machine Gun installed.' });
    expect(g.session().history.past).toHaveLength(1);
  });

  it('a tap on a mount never buys anything; it filters, and Install then uses that mount', () => {
    const g = garage();
    g.act.tapMount('roof_mid');
    expect(g.car()).toBe(BASELINE_BLUEPRINT);
    expect(g.session().selection).toEqual({ kind: 'mount', mountId: 'roof_mid' });
    expect(g.session().category).toBe('weapon');
    // The same tap again lets go of the mount.
    g.act.tapMount('roof_mid');
    expect(g.session().selection).toEqual({ kind: 'none' });
    g.act.tapMount('rear_center');
    g.act.install('weapon_rear_mg');
    expect(g.car().parts[0]).toMatchObject({ partId: 'weapon_rear_mg', mountId: 'rear_center' });
    expect(g.left()).toBe(630 - 85);
    // Tapping the occupied mount selects the part that is on it.
    g.act.clearSelection();
    g.act.tapMount('rear_center');
    expect(g.session().selection).toEqual({
      kind: 'instance',
      instanceId: g.car().parts[0]!.instanceId,
    });
    expect(g.car().parts).toHaveLength(1);
  });

  it('replaces the part on a mount as one transaction with spend and refund kept apart', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    expect(g.left()).toBe(520);
    g.act.targetMount('front_center');
    expect(g.session().selection).toEqual({ kind: 'mount', mountId: 'front_center' });
    const plan = planInstall(g.car(), CATALOG, 'weapon_shotgun', 'front_center');
    expect(plan.action).toBe('replace');
    expect(plan.replaced?.def.id).toBe('weapon_front_mg');
    expect(plan.result.ok && plan.result.spend).toMatchObject({
      newSpend: 90,
      refund: 70,
      net: 20,
      creditsLeft: 500,
    });
    g.act.install('weapon_shotgun');
    expect(ids(g.car())).toEqual(['utility_spare', 'weapon_shotgun']);
    expect(g.left()).toBe(500);
    expect(g.session().history.past).toHaveLength(1);
    g.act.undo();
    expect(ids(g.car())).toEqual(['utility_spare', 'weapon_front_mg']);
    expect(g.left()).toBe(520);
  });

  it('treats the part that is already on the mount as nothing to buy', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    const plan = planInstall(g.car(), CATALOG, 'weapon_front_mg', 'front_center');
    expect(plan.action).toBe('current');
    g.act.targetMount('front_center');
    g.act.install('weapon_front_mg');
    expect(g.car()).toBe(ROOKIE_BLUEPRINT);
  });

  it('removes a part for a full refund and leaves its mount selected', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    const gun = g.car().parts.find((p) => p.partId === 'weapon_front_mg')!;
    g.act.remove(gun.instanceId);
    expect(ids(g.car())).toEqual(['utility_spare']);
    expect(g.left()).toBe(590);
    expect(g.session().selection).toEqual({ kind: 'mount', mountId: 'front_center' });
    expect(g.session().notice?.text).toBe('Front Machine Gun removed. 70 credits back.');
  });

  it('swaps the engine and the wheel kit, priced for this chassis wheel count', () => {
    const g = garage(baselineBlueprint({ chassisId: 'chassis_spider' }, 'Six'));
    const before = g.left();
    g.act.install('tires_sand');
    expect(g.car().tireKitId).toBe('tires_sand');
    const sand = wheelKitPrice(CATALOG.tires.tires_sand!, 6);
    const street = wheelKitPrice(CATALOG.tires.tires_street!, 6);
    expect(sand).toBe(188);
    expect(g.left()).toBe(before - sand + street);
    g.act.install('engine_v8');
    expect(g.car().engineId).toBe('engine_v8');
    // Picking what is already fitted is not a transaction.
    const steps = g.session().history.past.length;
    g.act.install('engine_v8');
    expect(g.session().history.past).toHaveLength(steps);
  });

  it('paint and name are free and never change the build hash', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    const hash = buildHash(g.car());
    g.act.paint('paint_mint');
    g.act.rename('  Mint <b>Condition</b>  ');
    expect(g.car().paintId).toBe('paint_mint');
    expect(g.car().name).toBe('Mint bConditionb');
    expect(buildHash(g.car())).toBe(hash);
    expect(g.left()).toBe(520);
    // A name with nothing usable in it keeps the old one.
    g.act.rename('<<<>>>');
    expect(g.car().name).toBe('Mint bConditionb');
  });
});

describe('garage session: placing parts', () => {
  it('nudges inside the mount region and refuses a step outside it', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    const gun = g.car().parts.find((p) => p.partId === 'weapon_front_mg')!.instanceId;
    const at = () => g.car().parts.find((p) => p.instanceId === gun)!;
    g.act.nudge(gun, 1, 0);
    g.act.nudge(gun, 1, 0);
    expect(at()).toMatchObject({ offsetX: 2, offsetY: 0 });
    const steps = g.session().history.past.length;
    g.act.nudge(gun, 1, 0);
    expect(at()).toMatchObject({ offsetX: 2, offsetY: 0 });
    expect(g.session().history.past).toHaveLength(steps);
    expect(g.session().notice?.issue?.code).toBe('OUT_OF_REGION');
    expect(g.session().flagged).toEqual([gun]);
    // Moving costs nothing.
    expect(g.left()).toBe(520);
  });

  it('rotates through the orientations the mount allows', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    const gun = g.car().parts.find((p) => p.partId === 'weapon_front_mg')!.instanceId;
    const turns = () => g.car().parts.find((p) => p.instanceId === gun)!.rotationQuarterTurns;
    const allowed = CATALOG.chassis.chassis_beetle!.mounts.find(
      (m) => m.id === 'front_center',
    )!.allowedQuarterTurns;
    const seen = new Set<number>([turns()]);
    for (let i = 0; i < 6; i++) {
      g.act.rotate(gun);
      seen.add(turns());
      expect(allowed).toContain(turns());
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('applies the two-button rule when a third weapon asks for a fire button', () => {
    const g = garage();
    g.act.install('weapon_front_mg');
    g.act.clearSelection();
    g.act.install('weapon_shotgun');
    g.act.clearSelection();
    g.act.install('weapon_mine');
    const slot = (partId: string) =>
      g.car().parts.find((p) => p.partId === partId)!.assignedActionSlot;
    expect(slot('weapon_front_mg')).toBe(0);
    expect(slot('weapon_shotgun')).toBe(1);
    // Both buttons were taken, so the third manual weapon is installed inactive.
    expect(slot('weapon_mine')).toBeUndefined();
    const mine = g.car().parts.find((p) => p.partId === 'weapon_mine')!.instanceId;
    g.act.setFire(mine, 0);
    expect(slot('weapon_mine')).toBe(0);
    expect(slot('weapon_front_mg')).toBeUndefined();
    expect(slot('weapon_shotgun')).toBe(1);
    expect(validateBlueprint(g.car(), CATALOG).ok).toBe(true);
  });
});

describe('garage session: refusals change nothing and name the reason', () => {
  it('refuses to overspend with the approved line', () => {
    const g = garage();
    for (const partId of [
      'weapon_turret',
      'defense_heavy_plate',
      'defense_heavy_plate',
      'utility_nitro',
      'utility_overdrive',
    ]) {
      g.act.clearSelection();
      g.act.install(partId);
    }
    const before = g.car();
    expect(before.parts).toHaveLength(5);
    expect(g.left()).toBe(75);
    // The V12 costs 290 and the Four-Cylinder comes back for 140: 150 more than is left.
    g.act.install('engine_v12');
    expect(g.car()).toBe(before);
    expect(g.session().notice).toMatchObject({ tone: 'error', text: 'Not enough credits' });
    expect(g.session().notice?.issue?.code).toBe('NOT_ENOUGH_CREDITS');
    expect(g.session().history.present).toBe(before);
    expect(g.left()).toBe(75);
    expect(planInstall(before, CATALOG, 'engine_v12').result.ok).toBe(false);
  });

  it('refuses to overload the chassis with the approved sentence', () => {
    const g = garage();
    for (const partId of [
      'defense_heavy_plate',
      'defense_heavy_plate',
      'engine_v8',
      'tires_track',
    ]) {
      g.act.clearSelection();
      g.act.install(partId);
    }
    const before = g.car();
    expect(before).toMatchObject({ engineId: 'engine_v8', tireKitId: 'tires_track' });
    expect(validateBlueprint(before, CATALOG).loadKg).toBe(655);
    expect(g.left()).toBe(220);
    // 90 kg more would be 745 kg on a frame that allows 730. There are credits to spare.
    g.act.clearSelection();
    g.act.install('utility_ballast');
    expect(g.car()).toBe(before);
    expect(g.session().notice?.issue?.code).toBe('TOO_HEAVY');
    expect(g.session().notice?.text).toBe(
      'Too heavy for this chassis. Remove weight or swap frames.',
    );
  });

  it('refuses a part with nowhere to go, a second unique part, and an unknown part', () => {
    const g = garage();
    g.act.install('weapon_saw');
    expect(g.session().notice?.issue?.code).toBe('NO_COMPATIBLE_MOUNT');
    expect(g.session().notice?.text).toBe('No compatible mount');
    g.act.install('utility_spare');
    g.act.clearSelection();
    const one = g.car();
    expect(one.parts[0]!.mountId).toBe('left_utility');
    g.act.tapMount('right_utility');
    g.act.install('utility_spare');
    expect(g.car()).toBe(one);
    expect(g.session().notice?.issue?.code).toBe('ONE_PER_CAR');
    expect(g.session().notice?.text).toBe('One per car');
    g.act.install('weapon_does_not_exist');
    expect(g.car()).toBe(one);
    expect(g.session().notice?.issue?.code).toBe('UNKNOWN_PART');
  });

  it('never lets any sequence of presses take the build over 1,000 credits', () => {
    const g = garage();
    const wanted = [
      'chassis_brick',
      'engine_v12',
      'tires_track',
      'weapon_mortar',
      'weapon_homing',
      'weapon_railshot',
      'defense_antimissile',
      'defense_energy_shield',
      'defense_heavy_plate',
      'utility_overdrive',
      'utility_jump',
      'weapon_emp',
    ];
    for (const partId of wanted) {
      g.act.clearSelection();
      g.act.install(partId);
      expect(blueprintCost(g.car(), CATALOG).total).toBeLessThanOrEqual(STARTING_CREDITS);
      expect(validateBlueprint(g.car(), CATALOG).ok).toBe(true);
    }
    expect(g.session().notice?.issue?.code).toBeDefined();
  });
});

describe('garage session: undo, redo and reset', () => {
  it('undoes and redoes whole transactions and drops redo after a new edit', () => {
    const g = garage();
    g.act.install('weapon_front_mg');
    g.act.clearSelection();
    g.act.install('utility_spare');
    const two = g.car();
    g.act.undo();
    expect(ids(g.car())).toEqual(['weapon_front_mg']);
    expect(g.left()).toBe(560);
    g.act.undo();
    expect(g.car()).toBe(BASELINE_BLUEPRINT);
    g.act.undo();
    expect(g.car()).toBe(BASELINE_BLUEPRINT);
    g.act.redo();
    g.act.redo();
    expect(g.car()).toBe(two);
    g.act.undo();
    g.act.install('utility_fan');
    expect(g.session().history.future).toHaveLength(0);
    g.act.redo();
    expect(ids(g.car())).toEqual(['utility_fan', 'weapon_front_mg']);
  });

  it('keeps the last 20 transactions', () => {
    const g = garage();
    const paints = ['paint_cobalt', 'paint_mint', 'paint_sunflare', 'paint_signal'];
    for (let i = 0; i < 30; i++) g.act.paint(paints[i % paints.length]!);
    expect(MAX_GARAGE_HISTORY).toBe(20);
    expect(g.session().history.past).toHaveLength(20);
    for (let i = 0; i < 40; i++) g.act.undo();
    expect(g.session().history.past).toHaveLength(0);
    expect(g.session().history.future).toHaveLength(20);
  });

  it('drops a selection that an undo removes from the car', () => {
    const g = garage();
    g.act.install('weapon_front_mg');
    expect(g.session().selection.kind).toBe('instance');
    g.act.undo();
    expect(g.session().selection).toEqual({ kind: 'none' });
  });

  it('resets to the stock car as one step, keeping the name and paint', () => {
    const g = garage(getTemplate('starter_sprinter')!.blueprint);
    g.act.reset();
    expect(g.car()).toMatchObject({
      chassisId: 'chassis_beetle',
      engineId: 'engine_four_cylinder',
      tireKitId: 'tires_street',
      parts: [],
      name: 'Sprinter',
      paintId: 'paint_cobalt',
    });
    expect(g.left()).toBe(630);
    g.act.undo();
    expect(buildHash(g.car())).toBe(buildHash(getTemplate('starter_sprinter')!.blueprint));
  });
});

describe('garage session: chassis swap', () => {
  it('carries parts over where they fit and refunds the rest, as one undo step', () => {
    const g = garage();
    for (const partId of [
      'weapon_front_mg',
      'utility_spare',
      'utility_battery',
      'weapon_rear_mg',
      'utility_radar',
    ]) {
      g.act.clearSelection();
      g.act.install(partId);
    }
    const before = g.car();
    expect(new Set(before.parts.map((p) => p.mountId))).toEqual(
      new Set(['front_center', 'left_utility', 'right_utility', 'rear_center', 'roof_mid']),
    );
    const steps = g.session().history.past.length;
    // Five parts on a frame with four mounts: something has to come off.
    g.act.install('chassis_trike');
    const after = g.car();
    expect(after.chassisId).toBe('chassis_trike');
    const removed = g.session().lastRemoved;
    expect(removed.length).toBeGreaterThan(0);
    expect(after.parts.length + removed.length).toBe(before.parts.length);
    // Every credit is accounted for: what is on the car plus what is left is the budget.
    const cost = blueprintCost(after, CATALOG);
    expect(cost.tires).toBe(wheelKitPrice(CATALOG.tires.tires_street!, 3));
    expect(g.left()).toBe(STARTING_CREDITS - cost.total);
    expect(validateBlueprint(after, CATALOG).ok).toBe(true);
    // The notice names what came off and what came back.
    const refund = removed.reduce((sum, r) => sum + r.refund, 0);
    expect(g.session().notice?.tone).toBe('warn');
    for (const r of removed)
      expect(g.session().notice?.text).toContain(CATALOG.parts[r.instance.partId]!.displayName);
    expect(g.session().notice?.text).toContain(`${refund} credits back.`);
    expect(g.session().history.past).toHaveLength(steps + 1);
    g.act.undo();
    expect(g.car()).toBe(before);
  });

  it('says so when everything moved across', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    g.act.install('chassis_turtle');
    expect(g.car().chassisId).toBe('chassis_turtle');
    expect(ids(g.car())).toEqual(['utility_spare', 'weapon_front_mg']);
    expect(g.session().lastRemoved).toEqual([]);
    expect(g.session().notice).toMatchObject({
      tone: 'ok',
      text: 'Turtle fitted. Every part moved across.',
    });
  });

  it('refuses a frame the build cannot afford and changes nothing', () => {
    const g = garage();
    for (const partId of [
      'engine_v12',
      'tires_adaptive',
      'weapon_front_mg',
      'utility_overdrive',
      'utility_traction',
      'utility_radar',
    ]) {
      g.act.clearSelection();
      g.act.install(partId);
    }
    const before = g.car();
    expect(before.parts).toHaveLength(4);
    expect(g.left()).toBe(45);
    // The Spider costs 85 more and its six wheels need a bigger set of Adaptive Tires.
    g.act.install('chassis_spider');
    expect(g.car()).toBe(before);
    expect(g.session().notice?.issue?.code).toBe('NOT_ENOUGH_CREDITS');
    expect(g.session().notice?.text).toBe('Not enough credits');
    expect(g.session().lastRemoved).toEqual([]);
    expect(g.left()).toBe(45);
  });
});

describe('garage session: the build clock, Ready and the lock', () => {
  it('counts down from the deadline and locks the last legal snapshot at zero', () => {
    const g = garage(ROOKIE_BLUEPRINT, 60);
    g.act.install('utility_fan');
    const legal = validateBlueprint(g.car(), CATALOG).blueprint!;
    // An illegal draft arrives (an old saved build opened for review).
    g.act.load(overspent(), 'loaded');
    expect(validateBlueprint(g.car(), CATALOG).ok).toBe(false);
    expect(blueprintCost(g.car(), CATALOG).total).toBeGreaterThan(STARTING_CREDITS);
    expect(g.session().notice?.tone).toBe('error');
    expect(g.session().lastLegal).toEqual(legal);

    g.clock.now += 49_000;
    g.act.tick();
    expect(g.session().phase).toBe('building');
    expect(secondsLeft(g.session(), g.clock.now)).toBe(11);
    g.clock.now += 10_999;
    g.act.tick();
    expect(g.session().phase).toBe('building');
    expect(secondsLeft(g.session(), g.clock.now)).toBe(1);
    g.clock.now += 1;
    g.act.tick();
    expect(secondsLeft(g.session(), g.clock.now)).toBe(0);
    expect(g.session().phase).toBe('locked');
    expect(g.session().lockReason).toBe('timer');
    // What races is the last build the validator accepted, never the overspent draft.
    expect(g.session().locked).toEqual(legal);
    expect(blueprintCost(g.session().locked!, CATALOG).total).toBeLessThanOrEqual(STARTING_CREDITS);
    expect(validateBlueprint(g.session().locked!, CATALOG).ok).toBe(true);
    expect(g.session().notice?.text).toBe('Build locked. Time to race.');
  });

  it('ignores every edit after the lock', () => {
    const g = garage(ROOKIE_BLUEPRINT, 5);
    g.clock.now += 5_000;
    g.act.tick();
    const locked = g.session();
    g.act.install('utility_fan');
    g.act.undo();
    g.act.reset();
    g.act.paint('paint_mint');
    g.act.remove(ROOKIE_BLUEPRINT.parts[0]!.instanceId);
    g.act.ready();
    g.act.tick();
    expect(g.session().history).toBe(locked.history);
    expect(g.session().locked).toBe(locked.locked);
    expect(g.session().lockReason).toBe('timer');
  });

  it('falls back to the last raced car when the draft was never legal', () => {
    const clock = { now: 0 };
    const store = createGarageStore({ catalog: CATALOG, now: () => clock.now });
    store.getState().start(overspent(), { seconds: 3, fallback: ROOKIE_BLUEPRINT });
    clock.now = 3_000;
    store.getState().tick();
    const session = store.getState().session!;
    expect(session.phase).toBe('locked');
    expect(buildHash(session.locked!)).toBe(buildHash(ROOKIE_BLUEPRINT));
  });

  it('Ready locks a legal build at once and refuses an illegal one with the reason', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    g.act.ready();
    expect(g.session().phase).toBe('locked');
    expect(g.session().lockReason).toBe('ready');
    expect(g.session().locked).toEqual(validateBlueprint(ROOKIE_BLUEPRINT, CATALOG).blueprint);

    const bad = garage(ROOKIE_BLUEPRINT);
    bad.act.load(overspent(), 'loaded');
    expect(blockingIssue(bad.car(), CATALOG)).not.toBeNull();
    bad.act.ready();
    expect(bad.session().phase).toBe('building');
    expect(bad.session().locked).toBeNull();
    expect(bad.session().notice?.tone).toBe('error');
    expect(blockingIssue(ROOKIE_BLUEPRINT, CATALOG)).toBeNull();
  });

  it('lets a server own the phase: it moves the deadline and it locks its own snapshot', () => {
    const g = garage(BASELINE_BLUEPRINT, 60);
    g.act.setDeadline(g.clock.now + 5_000);
    expect(secondsLeft(g.session(), g.clock.now)).toBe(5);
    g.act.lockWith(ROOKIE_BLUEPRINT);
    expect(g.session().phase).toBe('locked');
    expect(g.session().locked).toBe(ROOKIE_BLUEPRINT);
    // No clock at all is also a valid session.
    const free = garage(BASELINE_BLUEPRINT, 0);
    expect(secondsLeft(free.session(), free.clock.now)).toBeNull();
    free.clock.now += 1e9;
    free.act.tick();
    expect(free.session().phase).toBe('building');
  });

  it('repairs an illegal draft as one undo step and reports what came off', () => {
    const g = garage(ROOKIE_BLUEPRINT);
    g.act.load(overspent(), 'loaded');
    const draft = g.car();
    g.act.repair();
    expect(validateBlueprint(g.car(), CATALOG).ok).toBe(true);
    expect(g.session().lastRemoved.length).toBeGreaterThan(0);
    expect(g.session().notice?.text).toContain('Removed and refunded');
    expect(g.session().lastLegal).toEqual(g.car());
    g.act.undo();
    expect(g.car()).toBe(draft);
  });

  it('starts every shipped template as a legal session', () => {
    for (const template of TEMPLATES) {
      const g = garage(template.blueprint);
      expect(blockingIssue(g.car(), CATALOG), template.id).toBeNull();
      g.act.ready();
      expect(g.session().phase, template.id).toBe('locked');
    }
  });
});

/** A stand-in for `window.localStorage`. */
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const NOW = new Date('2026-10-10T12:00:00.000Z');

describe('My Blueprints in local storage', () => {
  it('round-trips saved cars through storage in canonical form', () => {
    const store = storage();
    let entries = readLibrary(store, CATALOG);
    expect(entries).toEqual([]);
    for (const template of TEMPLATES.slice(0, 5)) {
      const result = addBlueprint(entries, template.blueprint, CATALOG, NOW);
      expect(result.ok).toBe(true);
      entries = result.entries;
    }
    expect(writeLibrary(store, entries)).toBe(true);
    const back = readLibrary(store, CATALOG);
    expect(back.map((e) => e.id)).toEqual(entries.map((e) => e.id));
    expect(new Set(back.map((e) => e.id)).size).toBe(5);
    for (const entry of back) {
      expect(entry.legal).toBe(true);
      expect(entry.issues).toEqual([]);
      expect(entry.totalCost).toBe(blueprintCost(entry.blueprint, CATALOG).total);
      expect(entry.savedAt).toBe(NOW.toISOString());
      expect(serializeBlueprint(entry.blueprint)).toBe(
        serializeBlueprint(entries.find((e) => e.id === entry.id)!.blueprint),
      );
    }
    expect(JSON.parse(store.data.get(LIBRARY_KEY)!).version).toBe(1);
  });

  it('survives corrupt storage without throwing', () => {
    const broken = [
      'not json',
      '',
      'null',
      '[]',
      '{"version":1}',
      '{"version":2,"items":[]}',
      '{"version":1,"items":"x"}',
      '{"version":1,"items":[null,7,"x",{}]}',
      'x'.repeat(700_000),
    ];
    for (const raw of broken) expect(parseLibrary(raw, CATALOG), raw.slice(0, 20)).toEqual([]);
    expect(parseLibrary(null, CATALOG)).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readLibrary(throwing, CATALOG)).toEqual([]);
    expect(readLibrary(null, CATALOG)).toEqual([]);
    expect(writeLibrary(throwing, [])).toBe(false);
    expect(writeLibrary(null, [])).toBe(false);
  });

  it('drops entries that are not blueprints and keeps the rest', () => {
    const good = addBlueprint([], ROOKIE_BLUEPRINT, CATALOG, NOW);
    const stored = JSON.parse(serializeLibrary(good.entries)) as { items: unknown[] };
    stored.items.push(
      { id: 'b2', blueprint: { chassisId: '<script>' }, savedAt: 'x' },
      { id: 'bad id!', blueprint: ROOKIE_BLUEPRINT, savedAt: NOW.toISOString() },
      { id: 'b3', blueprint: { ...ROOKIE_BLUEPRINT, extra: 1 }, savedAt: NOW.toISOString() },
      { id: good.entries[0]!.id, blueprint: BASELINE_BLUEPRINT, savedAt: NOW.toISOString() },
      { id: 'b4', blueprint: BASELINE_BLUEPRINT, savedAt: '<img onerror=x>' },
    );
    const back = parseLibrary(JSON.stringify(stored), CATALOG);
    expect(back.map((e) => e.id)).toEqual([good.entries[0]!.id, 'b4']);
    // A bad timestamp falls back to the blueprint's own creation time.
    expect(back[1]!.savedAt).toBe(BASELINE_BLUEPRINT.createdAt);
  });

  it('keeps and flags a build from an older catalog, and repairs it on request', () => {
    const old: VehicleBlueprint = { ...ROOKIE_BLUEPRINT, catalogVersion: '0.2.0', name: 'Old' };
    const added = addBlueprint([], old, CATALOG, NOW);
    expect(added.ok).toBe(true);
    const back = parseLibrary(serializeLibrary(added.entries), CATALOG);
    expect(back).toHaveLength(1);
    expect(back[0]!.legal).toBe(false);
    expect(back[0]!.issues[0]).toMatchObject({
      code: 'CATALOG_MISMATCH',
      message: 'This build uses older part values. Review it before racing.',
    });
    expect(STRINGS.blueprints.outdated).toBe(back[0]!.issues[0]!.message);
    const repaired = repairSaved(back, back[0]!.id, CATALOG);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.entry.legal).toBe(true);
    expect(repaired.entry.blueprint.catalogVersion).toBe(CATALOG.version);
    expect(repaired.removed).toEqual([]);
    expect(repaired.entry.id).toBe(back[0]!.id);
    expect(repairSaved(back, 'missing', CATALOG).ok).toBe(false);
  });

  it('repairs an overspent saved build by removing parts and saying which', () => {
    const added = addBlueprint([], overspent(), CATALOG, NOW);
    expect(added.ok && added.entry.legal).toBe(false);
    const repaired = repairSaved(added.entries, added.entries[0]!.id, CATALOG);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.removed.length).toBeGreaterThan(0);
    expect(repaired.entry.totalCost).toBeLessThanOrEqual(STARTING_CREDITS);
    expect(repaired.entry.legal).toBe(true);
  });

  it('holds at most 30 cars and refuses an identical second copy', () => {
    let entries = addBlueprint([], ROOKIE_BLUEPRINT, CATALOG, NOW).entries;
    expect(addBlueprint(entries, ROOKIE_BLUEPRINT, CATALOG, NOW)).toMatchObject({
      ok: false,
      reason: 'duplicate',
    });
    // The same car under another name is a different card.
    expect(addBlueprint(entries, { ...ROOKIE_BLUEPRINT, name: 'Other' }, CATALOG, NOW).ok).toBe(
      true,
    );
    for (let i = 1; i < MAX_SAVED_BLUEPRINTS; i++) {
      const result = duplicateBlueprint(entries, entries[0]!.id, CATALOG, NOW);
      expect(result.ok, String(i)).toBe(true);
      entries = result.entries;
    }
    expect(entries).toHaveLength(30);
    expect(new Set(entries.map((e) => e.id)).size).toBe(30);
    expect(new Set(entries.map((e) => e.blueprint.name)).size).toBe(30);
    expect(duplicateBlueprint(entries, entries[0]!.id, CATALOG, NOW)).toMatchObject({
      ok: false,
      reason: 'full',
    });
    expect(addBlueprint(entries, BASELINE_BLUEPRINT, CATALOG, NOW)).toMatchObject({
      ok: false,
      reason: 'full',
    });
    // Storage holding more than 30 is cut to 30 on read.
    const raw = JSON.parse(serializeLibrary(entries)) as { items: Array<{ id: string }> };
    raw.items.push({ ...raw.items[0]!, id: 'overflow' });
    expect(parseLibrary(JSON.stringify(raw), CATALOG)).toHaveLength(30);
  });

  it('duplicates, renames with the safe character set, and deletes', () => {
    const first = addBlueprint([], ROOKIE_BLUEPRINT, CATALOG, NOW);
    const copy = duplicateBlueprint(first.entries, first.entries[0]!.id, CATALOG, NOW);
    expect(copy.ok && copy.entry.blueprint.name).toBe('Rookie 2');
    expect(copy.ok && copy.entry.buildHash).toBe(buildHash(ROOKIE_BLUEPRINT));
    expect(copy.entries.map((e) => e.blueprint.name)).toEqual(['Rookie', 'Rookie 2']);
    const again = duplicateBlueprint(copy.entries, copy.entries[1]!.id, CATALOG, NOW);
    expect(again.ok && again.entry.blueprint.name).toBe('Rookie 3');
    expect(copyName([], 'A Name That Is Twenty4 Ch')).toHaveLength(24);
    expect(copyName([], 'A Name That Is Twenty4 Ch')).toMatch(/ 2$/);

    const renamed = renameSaved(copy.entries, copy.entries[1]!.id, '<b>Rain & Shine</b>', CATALOG);
    expect(renamed.ok && renamed.entry.blueprint.name).toBe('bRain & Shineb');
    expect(renamed.ok && renamed.entry.legal).toBe(true);
    const kept = renameSaved(copy.entries, copy.entries[1]!.id, '   ', CATALOG);
    expect(kept.ok && kept.entry.blueprint.name).toBe('Rookie 2');
    expect(renameSaved(copy.entries, 'nope', 'x', CATALOG).ok).toBe(false);

    const less = deleteSaved(copy.entries, copy.entries[0]!.id);
    expect(less.map((e) => e.blueprint.name)).toEqual(['Rookie 2']);
    expect(deleteSaved(less, 'nope')).toHaveLength(1);
  });
});

describe('track preview facts come from the track and the balance tables', () => {
  const runtime = buildTrack(CITY_01);

  it('reports laps, lap length, corners and the surface mix of Neon Cut', () => {
    const facts = trackFacts(CITY_01, runtime, WEATHER_PRESETS.city_clear_night!);
    expect(facts.laps).toBe(CITY_01.laps);
    expect(facts.lapMeters).toBe(Math.round(runtime.lapLength / 8 / 10) * 10);
    // Two hairpins and four sweepers.
    expect(facts.corners).toBe(6);
    expect(facts.surfaces).toEqual([
      { surface: 'asphalt', name: 'Asphalt', share: 0.8, grip: SURFACE_GRIP.clear.asphalt },
      { surface: 'cobble', name: 'Cobblestone', share: 0.2, grip: SURFACE_GRIP.clear.cobble },
    ]);
    expect(facts.cooling).toBe(COOLING_MULTIPLIER.clear);
    expect(facts.solar).toBe(SOLAR_TIME.night);
  });

  it('derives both tips from the real modifiers', () => {
    const clear = trackFacts(CITY_01, runtime, WEATHER_PRESETS.city_clear_night!);
    const loss = Math.round(((SURFACE_GRIP.clear.asphalt - SURFACE_GRIP.clear.cobble) * 100) / 1);
    expect(clear.tips[0]).toBe(
      `Cobblestone is 20% of the lap with ${loss}% less grip than asphalt. Brake before it, not on it.`,
    );
    expect(clear.tips[1]).toContain(`${Math.round(SOLAR_TIME.night * 100)}%`);

    const rain = trackFacts(CITY_01, runtime, WEATHER_PRESETS.city_rain_night!);
    const mean = Math.round(
      (0.8 * SURFACE_GRIP.rain.asphalt + 0.2 * SURFACE_GRIP.rain.cobble) * 100,
    );
    expect(rain.tips[0]).toBe(
      `The road is wet: about ${mean}% of dry grip. Good grip matters more than raw power.`,
    );
    expect(rain.tips[1]).toContain(`${Math.round((COOLING_MULTIPLIER.rain - 1) * 100)}%`);
    expect(rain.surfaces[0]!.name).toBe('Wet asphalt');

    const heat = buildTips({ weather: 'dry_heat', timeOfDay: 'day', surfaceMix: { sand: 1 } });
    expect(heat[0]).toContain(`${Math.round(SURFACE_GRIP.dry_heat.sand * 100)}% grip`);
    expect(heat[1]).toContain(`${Math.round((1 - COOLING_MULTIPLIER.dry_heat) * 100)}%`);
    const plain = buildTips({ weather: 'clear', timeOfDay: 'day' });
    expect(plain[0]).toContain('100% of the lap');
    expect(plain[1]).toBe(STRINGS.preview.tipClear);
    for (const tip of [...clear.tips, ...rain.tips, ...heat, ...plain]) {
      expect(tip).not.toMatch(/[{}]/);
      expect(tip).not.toMatch(/—|–|--/);
    }
  });
});

describe('copy helpers', () => {
  it('fills placeholders and leaves unknown ones alone', () => {
    expect(fill('{a} and {b}', { a: 1, b: 'two' })).toBe('1 and two');
    expect(fill('{missing}', {})).toBe('{missing}');
    expect(fill('{toString}', {})).toBe('{toString}');
  });

  it('names mounts, lists and deltas the way the screen shows them', () => {
    expect(mountName('front_center')).toBe('Front center');
    expect(mountName('roof_mid')).toBe('Roof middle');
    expect(listNames([])).toBe('');
    expect(listNames(['Radar'])).toBe('Radar');
    expect(listNames(['Radar', 'Nitro Tank'])).toBe('Radar and Nitro Tank');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(signedDelta(4)).toBe('+4');
    expect(signedDelta(-2.4)).toBe('-2');
    expect(signedDelta(0.2)).toBe('');
  });

  it('has a name for every mount of every chassis', () => {
    for (const chassis of Object.values(CATALOG.chassis))
      for (const mount of chassis.mounts) {
        const name = mountName(mount.id);
        expect(name, mount.id).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      }
  });
});
