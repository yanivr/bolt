import { CATALOG, SCENARIOS, STRINGS, TEMPLATES, createScenarioRace } from '@bolt/content';
import type { CombatCar, RaceEvent, RaceResult, RaceSession } from '@bolt/shared';
import {
  COMPONENT_FIRST_WHEEL,
  combatSnapshot,
  eventVisibleTo,
  resolveBlueprint,
  stepRaceWithBrains,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { CalloutContext } from '../../apps/web/src/hud/callouts.js';
import {
  CALLOUT_GAP_MS,
  CALLOUT_LIFE_MS,
  CALLOUT_MAX,
  CALLOUT_REPEAT_MS,
  CalloutQueue,
  calloutFor,
} from '../../apps/web/src/hud/callouts.js';
import { HudCamera, carCanReach, carRoam, edgeMark } from '../../apps/web/src/hud/hudCamera.js';
import type { ActionContext, HudLoadout } from '../../apps/web/src/hud/model.js';
import {
  GapSmoother,
  MAX_EXTRAPOLATED_TICKS,
  StatusClock,
  actionView,
  buildHudLoadout,
  chassisTier,
  cooldownFraction,
  estimateTick,
  formatGap,
  heatLevel,
  powerLow,
  spanProgress,
  steadyMeters,
  tierOf,
} from '../../apps/web/src/hud/model.js';
import { RaceLog, resultFacts, verdictFor } from '../../apps/web/src/hud/results.js';
import { duel } from '../helpers/combat.js';
import { scenarioTrack } from '../scenarios/runner.js';

/**
 * The race HUD's rules, each a pure function of the blueprint, the snapshots and the events:
 * what the buttons are, what state each is in and why, how the dials turn between snapshots,
 * how the gap is steadied, what the results screen adds up, what gets called out, and where
 * the HUD may stand without ever covering the car.
 */

const WORLD = { width: 3584, height: 2816 };

function loadoutOf(car: CombatCar): HudLoadout {
  return buildHudLoadout(car.build, car.baseParams, WORLD);
}

function context(
  race: RaceSession,
  car: CombatCar,
  loadout: HudLoadout,
  part: number,
): ActionContext {
  const snapshot = combatSnapshot(car, race.tick);
  const has = (family: string) => snapshot.statuses.some((s) => s.family === family);
  return {
    tick: race.tick,
    integrity: snapshot.components[loadout.parts[part]!.component]!,
    emp: has('emp'),
    jam: has('jam'),
    airborne: has('airborne'),
    thermalLimited: car.session.motion.thermalLimited,
    battery: car.session.motion.batteryEnergy,
    reserve: snapshot.reserve,
    reserveThreshold: loadout.reserveThreshold,
    busyUntilTick: 0,
    busyCharging: false,
  };
}

describe('the HUD reads a car exactly as the simulation builds it', () => {
  it('has the same buttons, bits and component order for every shipped car', () => {
    const track = scenarioTrack(SCENARIOS[0]!);
    for (const scenario of SCENARIOS) {
      const setup = createScenarioRace(scenario, track);
      expect(setup, scenario.id).not.toBeNull();
      for (const car of setup!.race.cars) {
        const loadout = loadoutOf(car);
        const snapshot = combatSnapshot(car, 0);
        expect(loadout.components.length, scenario.id).toBe(snapshot.components.length);
        expect(loadout.parts.length).toBe(snapshot.modules.length);
        expect(loadout.utilities.map((u) => u.part)).toEqual(car.manualUtilities);
        loadout.utilities.forEach((u, bit) => expect(u.useBit).toBe(bit));
        car.components.forEach((component, index) => {
          const mine = loadout.components[index]!;
          expect(mine.kind).toBe(component.kind);
          expect(mine.ref).toBe(component.ref);
          expect(mine.x).toBeCloseTo(component.x, 6);
          expect(mine.y).toBeCloseTo(component.y, 6);
        });
        for (const spec of car.specs) {
          const action = loadout.parts[spec.part]!;
          expect(action.component).toBe(
            COMPONENT_FIRST_WHEEL + car.build.chassis.wheelAnchors.length + spec.part,
          );
          if (spec.category === 'weapon' && !spec.auto && spec.slot >= 0)
            expect(
              loadout.fire[spec.slot]?.part ?? -1,
              `${scenario.id} slot ${spec.slot}`,
            ).toBeGreaterThanOrEqual(0);
        }
        for (const slot of [0, 1] as const) {
          const action = loadout.fire[slot];
          if (action) expect(car.specs[action.part]!.slot).toBe(slot);
        }
      }
    }
  });

  it('gives every shipped template its fire buttons, equipment and pips', () => {
    for (const template of TEMPLATES) {
      const build = resolveBlueprint(template.blueprint, CATALOG)!;
      const loadout = buildHudLoadout(
        build,
        // Only heat and power limits are read from the coefficients.
        { heat: { performanceThreshold: 90 }, power: { capacity: 40 } } as never,
        WORLD,
      );
      const manual = build.parts.filter(
        (p) =>
          p.def.category === 'weapon' &&
          p.instance.assignedActionSlot !== undefined &&
          p.def.triggerMode !== 'automatic' &&
          p.instance.autoMode !== true,
      );
      expect(loadout.fire.filter(Boolean).length, template.id).toBe(
        new Set(manual.map((p) => p.instance.assignedActionSlot)).size,
      );
      const utilities = build.parts.filter(
        (p) => p.def.category === 'utility' && p.def.triggerMode === 'manual',
      );
      expect(loadout.utilities.length, template.id).toBe(utilities.length);
      // Names are the catalog's, and the wheels are told apart.
      const wheels = loadout.components.filter((c) => c.kind === 'wheel').map((c) => c.name);
      expect(new Set(wheels).size, template.id).toBe(wheels.length);
    }
  });

  it('presses the repair key for repair kits and spare wheels only', () => {
    const d = duel({ parts: ['utility_nitro', 'utility_repair', 'utility_spare', 'utility_jump'] });
    const loadout = loadoutOf(d.a);
    const repairBits = loadout.utilities
      .filter((u) => u.kind === 'repair' || u.kind === 'spare')
      .reduce((mask, u) => mask | (1 << u.useBit), 0);
    expect(loadout.repairMask).toBe(repairBits);
    expect(loadout.utilities.length).toBe(4);
    expect(repairBits).not.toBe(0);
    expect(repairBits).not.toBe(0b1111);
  });
});

describe('damage tiers (Section 8.1)', () => {
  it('follows the four states at their published limits', () => {
    expect(tierOf(100)).toBe(0);
    expect(tierOf(65.1)).toBe(0);
    expect(tierOf(65)).toBe(1);
    expect(tierOf(20.1)).toBe(1);
    expect(tierOf(20)).toBe(2);
    expect(tierOf(0.4)).toBe(2);
    expect(tierOf(0)).toBe(3);
  });

  it('gives the chassis the same proportions, and limp at zero', () => {
    expect(chassisTier(110, 110)).toBe(0);
    expect(chassisTier(72, 110)).toBe(0);
    expect(chassisTier(71, 110)).toBe(1);
    expect(chassisTier(23, 110)).toBe(1);
    expect(chassisTier(22, 110)).toBe(2);
    expect(chassisTier(0.2, 110)).toBe(2);
    expect(chassisTier(0, 110)).toBe(3);
  });
});

describe('dials between snapshots', () => {
  it('runs the race clock forward from the newest snapshot, and never far', () => {
    expect(estimateTick(300, 1000, 1000)).toBe(300);
    expect(estimateTick(300, 1000, 1000 + 1000 / 30)).toBeCloseTo(301, 6);
    expect(estimateTick(300, 1000, 1000 + 66.667)).toBeCloseTo(302, 3);
    // A stalled or paused race holds still after a few ticks.
    expect(estimateTick(300, 1000, 9000)).toBe(300 + MAX_EXTRAPOLATED_TICKS);
    // A clock that reads earlier than the arrival does not run backwards.
    expect(estimateTick(300, 1000, 900)).toBe(300);
  });

  it('turns a cooldown dial from full to empty', () => {
    const module = { readyTick: 160, cooldownTicks: 60 };
    expect(cooldownFraction(module, 100)).toBe(1);
    expect(cooldownFraction(module, 130)).toBeCloseTo(0.5, 6);
    expect(cooldownFraction(module, 159)).toBeCloseTo(1 / 60, 6);
    expect(cooldownFraction(module, 160)).toBe(0);
    expect(cooldownFraction(module, 400)).toBe(0);
    expect(cooldownFraction({ readyTick: 160, cooldownTicks: 0 }, 100)).toBe(0);
    // Smooth between two snapshots: 15 Hz snapshots, 60 Hz frames.
    let last = cooldownFraction(module, 130);
    for (let ms = 0; ms <= 66; ms += 16) {
      const now = cooldownFraction(module, estimateTick(130, 0, ms));
      expect(now).toBeLessThanOrEqual(last);
      expect(last - now).toBeLessThan(0.02);
      last = now;
    }
  });

  it('fills a charge-up from empty to full', () => {
    expect(spanProgress(124, 24, 100)).toBe(0);
    expect(spanProgress(124, 24, 112)).toBeCloseTo(0.5, 6);
    expect(spanProgress(124, 24, 124)).toBe(1);
    expect(spanProgress(124, 24, 200)).toBe(1);
    expect(spanProgress(124, 0, 100)).toBe(1);
  });
});

describe('button states follow the simulation', () => {
  it('counts a rocket launcher down to empty and says so before the server refuses', () => {
    const d = duel({ parts: [{ id: 'weapon_rocket', fire: 0 }] }, undefined, { ahead: 160 });
    const loadout = loadoutOf(d.a);
    const action = loadout.fire[0]!;
    expect(action.id).toBe('weapon_rocket');
    expect(action.charges).toBe(5);
    const view = () =>
      actionView(
        action,
        combatSnapshot(d.a, d.race.tick).modules[action.part]!,
        context(d.race, d.a, loadout, action.part),
      );

    expect(view()).toEqual({ block: null, phase: 'ready', charges: 5 });
    d.fire(0, 0, 0);
    expect(view().phase).toBe('cooling');
    expect(view().charges).toBe(4);
    // Hold the button: it fires again each time the cooldown ends, until nothing is left.
    let guard = 0;
    while (d.a.modules[action.part]!.charges > 0 && guard++ < 2000) d.step(1, { fire: 1 });
    expect(view().charges).toBe(0);
    expect(view().block).toBe('empty');
    d.step(600);
    expect(view()).toEqual({ block: 'empty', phase: 'ready', charges: 0 });
    d.fire(0, 0, 0);
    const refusals = d.of('refused', 0);
    expect(refusals[refusals.length - 1]!.reason).toBe('no_ammo');
  });

  it('agrees with every refusal the scenarios produce', () => {
    // For each command the simulation refused, the HUD's reading of the snapshot one tick
    // earlier must already have said the button would not act, and for the same reason.
    const allowed: Record<string, (v: ReturnType<typeof actionView>) => boolean> = {
      no_ammo: (v) => v.block === 'empty',
      cooldown: (v) => v.phase === 'cooling' || v.phase === 'active' || v.phase === 'charging',
      overheat: (v) => v.block === 'overheat',
      low_power: (v) => v.block === 'nopower',
      disabled: (v) => v.block === 'destroyed',
      jammed: (v) => v.block === 'emp' || v.block === 'jammed' || v.block === 'airborne',
      no_target: (v) => v.block === 'notarget',
    };
    let checked = 0;
    for (const scenario of SCENARIOS) {
      const setup = createScenarioRace(scenario, scenarioTrack(scenario))!;
      const { race, brains } = setup;
      const loadouts = race.cars.map(loadoutOf);
      for (let i = 0; i < scenario.countdownTicks + scenario.durationTicks; i++) {
        const before = race.cars.map((car, index) =>
          loadouts[index]!.parts.map((action) =>
            actionView(
              action,
              combatSnapshot(car, race.tick).modules[action.part]!,
              context(race, car, loadouts[index]!, action.part),
            ),
          ),
        );
        stepRaceWithBrains(race, [], brains);
        for (const event of race.events) {
          if (event.type !== 'refused' || event.part < 0) continue;
          const rule = allowed[event.reason];
          if (!rule) continue;
          const view = before[event.car]![event.part]!;
          expect(
            rule(view),
            `${scenario.id} tick ${race.tick}: ${event.reason} against ${JSON.stringify(view)}`,
          ).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('names each reason a button will not act, in the order the simulation checks them', () => {
    const d = duel({
      parts: [
        { id: 'weapon_flame', fire: 0 },
        { id: 'weapon_emp', fire: 1 },
      ],
    });
    const loadout = loadoutOf(d.a);
    const flame = loadout.fire[0]!;
    const emp = loadout.fire[1]!;
    const module = combatSnapshot(d.a, d.race.tick).modules[flame.part]!;
    const base = context(d.race, d.a, loadout, flame.part);
    expect(actionView(flame, module, base).block).toBeNull();
    expect(actionView(flame, module, { ...base, thermalLimited: true }).block).toBe('overheat');
    expect(actionView(flame, module, { ...base, battery: 0 }).block).toBe('nopower');
    // Ammunition comes before heat, electronics before both, a broken part before everything.
    expect(
      actionView(flame, { ...module, charges: 0 }, { ...base, thermalLimited: true }).block,
    ).toBe('empty');
    expect(actionView(flame, { ...module, charges: 0 }, { ...base, emp: true }).block).toBe('emp');
    expect(actionView(flame, module, { ...base, jam: true }).block).toBe('jammed');
    expect(actionView(flame, module, { ...base, airborne: true }).block).toBe('airborne');
    expect(actionView(flame, module, { ...base, emp: true, integrity: 0 }).block).toBe('destroyed');
    expect(actionView(flame, { ...module, state: 4 }, base).block).toBe('destroyed');
    // The EMP Pulse costs more than a drained battery holds.
    const empModule = combatSnapshot(d.a, d.race.tick).modules[emp.part]!;
    expect(actionView(emp, empModule, { ...base, battery: emp.energy - 1 }).block).toBe('nopower');
    expect(actionView(emp, empModule, { ...base, battery: emp.energy }).block).toBeNull();
    // A charge-up or a timed action under way is a phase, not a block.
    expect(
      actionView(emp, empModule, { ...base, busyUntilTick: base.tick + 5, busyCharging: true })
        .phase,
    ).toBe('charging');
    expect(
      actionView(emp, empModule, { ...base, busyUntilTick: base.tick + 5, busyCharging: false })
        .phase,
    ).toBe('active');
    expect(actionView(emp, { ...empModule, locked: true }, base).phase).toBe('locked');
  });

  it('shows a utility as broken, spent or cooling, and ignores heat and power for it', () => {
    const d = duel({ parts: ['utility_nitro'] });
    const loadout = loadoutOf(d.a);
    const nitro = loadout.utilities[0]!;
    const module = combatSnapshot(d.a, d.race.tick).modules[nitro.part]!;
    const base = context(d.race, d.a, loadout, nitro.part);
    expect(actionView(nitro, module, base)).toEqual({ block: null, phase: 'ready', charges: 2 });
    expect(
      actionView(nitro, module, { ...base, thermalLimited: true, battery: 0, airborne: true })
        .block,
    ).toBeNull();
    expect(actionView(nitro, { ...module, charges: 0 }, base).block).toBe('empty');
    expect(actionView(nitro, module, { ...base, emp: true }).block).toBe('emp');
  });

  it('tells the mortar apart from a ready weapon while it has no lock', () => {
    const d = duel({ parts: [{ id: 'weapon_mortar', fire: 0, mount: 'roof_mid' }] });
    const loadout = loadoutOf(d.a);
    const mortar = loadout.fire[0]!;
    const module = combatSnapshot(d.a, d.race.tick).modules[mortar.part]!;
    const base = context(d.race, d.a, loadout, mortar.part);
    expect(mortar.needsLock).toBe(true);
    expect(actionView(mortar, { ...module, locked: false, state: 0 }, base).block).toBe('notarget');
    expect(actionView(mortar, { ...module, locked: true }, base)).toMatchObject({
      block: null,
      phase: 'locked',
    });
  });
});

describe('heat and power', () => {
  const d = duel({ parts: [{ id: 'weapon_emp', fire: 0 }] });
  const loadout = loadoutOf(d.a);

  it('has four heat levels and the last one is thermal protection', () => {
    expect(heatLevel(10, false, loadout)).toBe(0);
    expect(heatLevel(loadout.heatWarn, false, loadout)).toBe(1);
    expect(heatLevel(loadout.heatHot, false, loadout)).toBe(2);
    expect(heatLevel(80, true, loadout)).toBe(3);
    expect(loadout.heatMax).toBe(110);
  });

  it('calls power low under a fifth of the battery, or under the cost of a bound shot', () => {
    expect(powerLow(loadout.batteryCapacity, 0, loadout)).toBe(false);
    expect(powerLow(loadout.batteryCapacity * 0.19, 0, loadout)).toBe(true);
    const cost = loadout.fire[0]!.energy;
    expect(powerLow(cost - 0.5, 0, loadout)).toBe(true);
    expect(powerLow(cost, 0, loadout)).toBe(cost < loadout.batteryCapacity * 0.2);
  });
});

describe('status timers', () => {
  it('starts a ring full when a status lands and refills it when it is extended', () => {
    const clock = new StatusClock();
    const none = { shield: false, tetherUntilTick: 0 };
    let views = clock.read(
      { statuses: [{ family: 'burn', magnitude: 3, untilTick: 160 }] },
      100,
      none,
    );
    expect(views).toEqual([{ key: 'burn', untilTick: 160, totalTicks: 60, harmful: true }]);
    // Half way: the same total, so the ring reads one half.
    views = clock.read({ statuses: [{ family: 'burn', magnitude: 3, untilTick: 160 }] }, 130, none);
    expect(views[0]!.totalTicks).toBe(60);
    // A fresh application that ends later starts the ring again from what is left.
    views = clock.read({ statuses: [{ family: 'burn', magnitude: 3, untilTick: 220 }] }, 140, none);
    expect(views[0]).toMatchObject({ untilTick: 220, totalTicks: 80 });
    // Gone, then back: no memory of the old length.
    expect(clock.read({ statuses: [] }, 230, none)).toEqual([]);
    views = clock.read({ statuses: [{ family: 'burn', magnitude: 3, untilTick: 250 }] }, 240, none);
    expect(views[0]!.totalTicks).toBe(10);
  });

  it('orders the worst first and adds the two the HUD derives itself', () => {
    const clock = new StatusClock();
    const views = clock.read(
      {
        statuses: [
          { family: 'boost', magnitude: 0.5, untilTick: 190 },
          { family: 'slow', magnitude: 0.3, untilTick: 150 },
          { family: 'emp', magnitude: 1, untilTick: 140 },
          { family: 'immune', magnitude: 1, untilTick: 200 },
        ],
      },
      100,
      { shield: true, tetherUntilTick: 130 },
    );
    expect(views.map((v) => v.key)).toEqual(['emp', 'tether', 'slow', 'boost', 'shield', 'immune']);
    expect(views.find((v) => v.key === 'shield')).toMatchObject({ untilTick: 0, harmful: false });
    expect(views.filter((v) => v.harmful).map((v) => v.key)).toEqual(['emp', 'tether', 'slow']);
    // An expired entry is not shown.
    expect(
      clock.read({ statuses: [{ family: 'emp', magnitude: 1, untilTick: 90 }] }, 100, {
        shield: false,
        tetherUntilTick: 0,
      }),
    ).toEqual([]);
  });
});

describe('the gap readout', () => {
  it('does not flicker on a gap that wobbles around one value', () => {
    const gap = new GapSmoother();
    let changes = 0;
    let shown = gap.push(1.23, 0);
    for (let i = 0; i < 300; i++) {
      // Fifteen readings a second, wobbling a tenth and a half either way.
      const noisy = 1.23 + Math.sin(i * 1.7) * 0.15 + Math.sin(i * 0.31) * 0.08;
      const next = gap.push(noisy, 1 / 15);
      if (next !== shown) changes++;
      shown = next;
      expect(Math.abs(next - 1.23)).toBeLessThan(0.2);
    }
    expect(changes).toBeLessThanOrEqual(4);
  });

  it('follows a real change within about a second and a half', () => {
    const gap = new GapSmoother();
    gap.push(1.0, 0);
    let shown = 0;
    for (let i = 0; i < 22; i++) shown = gap.push(2.0, 1 / 15);
    expect(shown).toBeGreaterThanOrEqual(1.9);
    expect(shown).toBeLessThanOrEqual(2.0);
  });

  it('takes a jump at once, and shows whole tenths with a real sign', () => {
    const gap = new GapSmoother();
    expect(gap.push(0.84, 0)).toBe(0.8);
    expect(gap.push(-6.26, 1 / 15)).toBe(-6.3);
    expect(formatGap(1.2)).toBe('+1.2');
    expect(formatGap(0)).toBe('+0.0');
    expect(formatGap(-0.8)).toBe('−0.8');
    expect(formatGap(-0.8)).not.toContain('-');
  });

  it('steps the distance on the off-screen arrow so it does not flicker', () => {
    expect(steadyMeters(12.4)).toBe(12);
    expect(steadyMeters(-12.6)).toBe(13);
    expect(steadyMeters(83.9)).toBe(85);
    expect(steadyMeters(-31)).toBe(30);
  });
});

// --- Results ---------------------------------------------------------------------------------------

function runLogged(id: string): { race: RaceSession; log: RaceLog; events: RaceEvent[] } {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const { race, brains } = createScenarioRace(scenario, scenarioTrack(scenario))!;
  const log = new RaceLog(0);
  const events: RaceEvent[] = [];
  for (let i = 0; i < scenario.countdownTicks + scenario.durationTicks; i++) {
    stepRaceWithBrains(race, [], brains);
    for (const event of race.events)
      if (eventVisibleTo(event, 0)) {
        log.add(event);
        events.push(event);
      }
  }
  return { race, log, events };
}

describe('results are added up from the event log', () => {
  it("matches the simulation's own totals in every scenario", () => {
    let withDamage = 0;
    for (const scenario of SCENARIOS) {
      const { race, log, events } = runLogged(scenario.id);
      const summary = log.summary();
      const [mine, theirs] = race.cars as [CombatCar, CombatCar];
      expect(summary.dealt.total, `${scenario.id} dealt`).toBeCloseTo(mine.stats.damageDealt, 6);
      expect(summary.dealt.hits, `${scenario.id} hits`).toBe(mine.stats.hitsLanded);
      expect(summary.taken.total, `${scenario.id} taken`).toBeCloseTo(mine.stats.damageTaken, 6);
      expect(summary.rivalDealt, `${scenario.id} rival dealt`).toBeCloseTo(
        theirs.stats.damageDealt,
        6,
      );
      expect(summary.rivalHits).toBe(theirs.stats.hitsLanded);
      expect(summary.shots, `${scenario.id} shots`).toBe(mine.stats.shotsFired);
      expect(summary.events).toBe(events.length);
      // The breakdowns add up to their totals.
      const byWeapon = summary.dealt.byWeapon.reduce((sum, w) => sum + w.damage, 0);
      expect(byWeapon).toBeCloseTo(summary.dealt.total, 6);
      expect(summary.dealt.byWeapon.reduce((sum, w) => sum + w.hits, 0)).toBe(summary.dealt.hits);
      const byComponent = summary.taken.byComponent.reduce((sum, c) => sum + c.damage, 0);
      expect(byComponent).toBeCloseTo(summary.taken.total, 6);
      if (summary.dealt.biggest) {
        const biggest = Math.max(
          ...events
            .filter((e) => e.type === 'hit' && e.by === 0 && e.car !== 0)
            .map((e) =>
              e.type === 'hit' ? e.damage + e.chassis + e.shield + e.armor + e.absorbed : 0,
            ),
        );
        expect(summary.dealt.biggest.damage).toBeCloseTo(biggest, 6);
      }
      // Sorted, most damaging first.
      for (let i = 1; i < summary.dealt.byWeapon.length; i++)
        expect(summary.dealt.byWeapon[i - 1]!.damage).toBeGreaterThanOrEqual(
          summary.dealt.byWeapon[i]!.damage,
        );
      if (summary.dealt.total > 0 || summary.taken.total > 0) withDamage++;
    }
    expect(withDamage).toBeGreaterThan(15);
  });

  it('records the repairs of the repair scenario and the parts they brought back', () => {
    const { log, race } = runLogged('repair_burst');
    const summary = log.summary();
    expect(summary.repairs.map((r) => r.utility)).toEqual(['utility_spare', 'utility_repair']);
    const loadout = loadoutOf(race.cars[0]!);
    expect(loadout.components[summary.repairs[0]!.component]!.kind).toBe('wheel');
    expect(loadout.components[summary.repairs[1]!.component]!.kind).toBe('engine');
  });

  it("lists parts lost, marks one that was repaired since, and counts the rival's", () => {
    const log = new RaceLog(0);
    let id = 1;
    const add = (body: object) => log.add({ ...(body as RaceEvent), id: id++, tick: id });
    add({
      type: 'component',
      car: 0,
      component: 3,
      condition: 'disabled',
      integrity: 0,
      repaired: false,
    });
    add({
      type: 'component',
      car: 0,
      component: 6,
      condition: 'disabled',
      integrity: 0,
      repaired: false,
    });
    add({
      type: 'component',
      car: 1,
      component: 0,
      condition: 'disabled',
      integrity: 0,
      repaired: false,
    });
    add({
      type: 'component',
      car: 0,
      component: 3,
      condition: 'healthy',
      integrity: 100,
      repaired: true,
    });
    add({
      type: 'component',
      car: 0,
      component: 5,
      condition: 'damaged',
      integrity: 60,
      repaired: false,
    });
    add({ type: 'lap', car: 0, lap: 1, lapTimeMs: 31_000 });
    add({ type: 'lap', car: 1, lap: 1, lapTimeMs: 33_000 });
    add({ type: 'ko', car: 1, by: 0 });
    log.addHeat(2.5);
    log.addHeat(1.5);
    const summary = log.summary();
    expect(summary.partsLost).toEqual([
      { component: 3, repaired: true },
      { component: 6, repaired: false },
    ]);
    expect(summary.rivalPartsLost).toEqual([0]);
    expect(summary.laps).toEqual([[31_000], [33_000]]);
    expect(summary.ko).toBe(1);
    expect(summary.hotSeconds).toBe(4);
    log.reset();
    expect(log.summary()).toMatchObject({ events: 0, partsLost: [], hotSeconds: 0, ko: -1 });
  });

  const car = (over: Partial<RaceResult['cars'][number]> = {}): RaceResult['cars'][number] => ({
    finished: true,
    finishTimeMs: 90_000,
    courseProgress: 9000,
    lastCheckpointMs: 89_000,
    bestLapMs: 29_000,
    chassis: 80,
    ko: false,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    hitsLanded: 0,
    ...over,
  });

  it("reads the verdict from the server's result and never decides the winner itself", () => {
    const finish = (
      winner: number,
      cars: RaceResult['cars'],
      reason: RaceResult['reason'] = 'finish',
    ): RaceResult => ({
      winner,
      reason,
      raceTimeMs: 98_000,
      cars,
    });
    expect(verdictFor(finish(0, [car(), car({ finishTimeMs: 90_400 })]), 0)).toEqual({
      outcome: 'victory',
      reason: 'margin',
      marginSeconds: 0.4,
    });
    expect(verdictFor(finish(0, [car(), car({ finishTimeMs: 90_400 })]), 1)).toMatchObject({
      outcome: 'defeat',
      reason: 'margin',
    });
    // The rival ran out of the eight-second window.
    const dnf = car({ finished: false, finishTimeMs: null });
    expect(verdictFor(finish(0, [car(), dnf]), 0)).toMatchObject({
      outcome: 'victory',
      reason: 'rival_dnf',
      marginSeconds: null,
    });
    expect(verdictFor(finish(0, [car(), dnf]), 1)).toMatchObject({
      outcome: 'defeat',
      reason: 'you_dnf',
    });
    // A knockout ends the duel at once.
    const wreck = car({ finished: false, finishTimeMs: null, ko: true, chassis: 0 });
    expect(verdictFor(finish(1, [wreck, dnf], 'ko'), 0)).toMatchObject({
      outcome: 'defeat',
      reason: 'you_ko',
    });
    expect(verdictFor(finish(1, [wreck, dnf], 'ko'), 1)).toMatchObject({
      outcome: 'victory',
      reason: 'rival_ko',
    });
    // Nobody finished: standings decide, or it is an explicit draw.
    expect(verdictFor(finish(1, [dnf, dnf], 'timeout'), 0)).toMatchObject({
      outcome: 'defeat',
      reason: 'timeout',
    });
    expect(verdictFor(finish(-1, [dnf, dnf], 'timeout'), 0)).toMatchObject({
      outcome: 'draw',
      reason: 'draw',
    });
  });

  it('offers only facts the log supports', () => {
    const log = new RaceLog(0);
    let id = 1;
    const hit = (over: object) =>
      log.add({
        type: 'hit',
        car: 1,
        by: 0,
        weapon: 'weapon_rocket',
        cls: 'direct',
        x: 0,
        y: 0,
        component: 0,
        damage: 10,
        chassis: 4,
        shield: 0,
        armor: 0,
        absorbed: 0,
        projectile: 0,
        id: id++,
        tick: id,
        ...over,
      } as RaceEvent);
    const wheelRows = new Map<number, 'front' | 'rear' | 'middle'>([
      [2, 'front'],
      [3, 'front'],
      [4, 'rear'],
      [5, 'rear'],
    ]);
    const ctx = { wheelRows, workingAutoWeapons: [1], complete: true };
    expect(resultFacts(log.summary(), ctx)).toEqual([{ kind: 'noShot', part: 1 }]);
    // An unfinished race cannot say "never".
    expect(resultFacts(log.summary(), { ...ctx, complete: false })).toEqual([]);

    hit({});
    hit({ weapon: 'weapon_front_mg', damage: 3, chassis: 1 });
    hit({ car: 0, by: 1, component: 4, damage: 8, chassis: 3, weapon: 'weapon_shotgun' });
    hit({ car: 0, by: 1, component: 5, damage: 8, chassis: 3, weapon: 'weapon_shotgun' });
    hit({ car: 0, by: 1, component: 5, damage: 8, chassis: 3, weapon: 'weapon_shotgun' });
    hit({ car: 0, by: 1, component: 2, damage: 2, chassis: 1, weapon: 'weapon_shotgun' });
    log.add({
      type: 'shot',
      car: 0,
      part: 1,
      weapon: 'weapon_rear_mg',
      x: 0,
      y: 0,
      dir: 0,
      projectile: 1,
      n: 0,
      of: 4,
      id: id++,
      tick: id,
    });
    log.addHeat(24.2);
    const facts = resultFacts(log.summary(), ctx);
    expect(facts.map((f) => f.kind)).toEqual([
      'biggestHit',
      'bestWeapon',
      'tireHits',
      'hot',
      'worstTaken',
    ]);
    expect(facts[0]).toEqual({ kind: 'biggestHit', weapon: 'weapon_rocket', damage: 14 });
    expect(facts[2]).toEqual({ kind: 'tireHits', where: 'rear', count: 3 });
    expect(facts[3]).toEqual({ kind: 'hot', seconds: 24 });
  });
});

// --- Callouts --------------------------------------------------------------------------------------

describe('callouts', () => {
  const offer = (key: string, priority = 5) => ({
    key,
    text: key.toUpperCase(),
    tone: 'info' as const,
    priority,
  });

  it('never shows more than two and spaces them out', () => {
    const queue = new CalloutQueue();
    let most = 0;
    let shownAt: number[] = [];
    const seen = new Set<number>();
    for (let ms = 0; ms < 6000; ms += 16) {
      // A burst of news every frame for the first second, then silence.
      if (ms < 1000) queue.offer(offer(`news-${ms}`), ms);
      const visible = queue.visible(ms);
      most = Math.max(most, visible.length);
      for (const c of visible)
        if (!seen.has(c.id)) {
          seen.add(c.id);
          shownAt.push(c.shownMs);
        }
    }
    expect(most).toBe(CALLOUT_MAX);
    shownAt = shownAt.sort((a, b) => a - b);
    for (let i = 1; i < shownAt.length; i++)
      expect(shownAt[i]! - shownAt[i - 1]!).toBeGreaterThanOrEqual(CALLOUT_GAP_MS);
    // Everything is gone once it has had its time.
    expect(queue.visible(6000)).toEqual([]);
  });

  it('drops a repeat of the same news and lets it back after a while', () => {
    const queue = new CalloutQueue();
    queue.offer(offer('wheel-hit'), 0);
    queue.offer(offer('wheel-hit'), 500);
    expect(queue.visible(600).length).toBe(1);
    queue.offer(offer('wheel-hit'), CALLOUT_REPEAT_MS - 1);
    expect(queue.visible(CALLOUT_REPEAT_MS - 1).length).toBe(0);
    queue.offer(offer('wheel-hit'), CALLOUT_REPEAT_MS + 1);
    expect(queue.visible(CALLOUT_REPEAT_MS + 1).length).toBe(1);
  });

  it('lets something important take the place of something that is not', () => {
    const queue = new CalloutQueue();
    queue.offer(offer('lap', 4), 0);
    queue.offer(offer('ammo', 3), 400);
    expect(queue.visible(400).map((c) => c.key)).toEqual(['lap', 'ammo']);
    queue.offer(offer('emp', 8), 800);
    expect(queue.visible(800).map((c) => c.key)).toEqual(['lap', 'emp']);
    // Something minor finds no room, waits briefly, and is forgotten.
    queue.offer(offer('misfire', 1), 900);
    expect(queue.visible(900).map((c) => c.key)).toEqual(['lap', 'emp']);
    expect(queue.visible(CALLOUT_LIFE_MS + 10).map((c) => c.key)).toEqual(['emp']);
    expect(queue.visible(CALLOUT_LIFE_MS + 700).map((c) => c.key)).toEqual(['emp']);
    expect(queue.visible(CALLOUT_LIFE_MS + 900)).toEqual([]);
  });

  const d = duel({ parts: [{ id: 'weapon_rocket', fire: 0 }, 'utility_spare', 'utility_repair'] });
  const loadout = loadoutOf(d.a);
  const ctx: CalloutContext = {
    you: 0,
    loadout,
    rivalNames: loadoutOf(d.b).components.map((c) => c.name),
    laps: 3,
    raceTimeMs: 20_000,
  };
  const event = (body: object) => ({ ...(body as RaceEvent), id: 1, tick: 1 });
  const hit = {
    type: 'hit',
    by: 1,
    weapon: 'weapon_shotgun',
    cls: 'bullet',
    x: 0,
    y: 0,
    damage: 6,
    chassis: 2,
    shield: 0,
    armor: 0,
    absorbed: 0,
    projectile: 0,
  };

  it('uses the approved lines exactly', () => {
    const wheel = loadout.components.find((c) => c.kind === 'wheel')!;
    expect(calloutFor(event({ ...hit, car: 0, component: wheel.index }), ctx)).toMatchObject({
      text: 'WHEEL HIT',
      detail: wheel.name,
      tone: 'bad',
    });
    expect(calloutFor(event({ ...hit, car: 0, component: 0 }), ctx)).toMatchObject({
      text: 'ENGINE HIT',
      tone: 'bad',
    });
    expect(
      calloutFor(
        event({
          type: 'utility',
          car: 0,
          part: 1,
          utility: 'utility_spare',
          state: 'done',
          value: wheel.index,
        }),
        ctx,
      ),
    ).toMatchObject({ text: 'WHEEL REPLACED', tone: 'good' });
    expect(STRINGS.hud.callout.engineHot).toBe('ENGINE HOT');
    expect(STRINGS.hud.callout.lowPower).toBe('LOW POWER');
    expect(STRINGS.hud.warn.missileLock).toBe('MISSILE LOCK');
    expect(STRINGS.race.go).toBe('GO!');
    expect(STRINGS.results.victory).toBe('VICTORY');
    expect(STRINGS.results.defeat).toBe('DEFEAT');
  });

  it("says nothing about small hits and about the other car's private business", () => {
    const part = loadout.parts[0]!;
    expect(calloutFor(event({ ...hit, car: 0, component: part.component }), ctx)).toBeNull();
    expect(calloutFor(event({ ...hit, car: 0, component: -1 }), ctx)).toBeNull();
    // A light hit on the rival is shown by the rival's car, not by words.
    expect(calloutFor(event({ ...hit, car: 1, by: 0, component: 0 }), ctx)).toBeNull();
    expect(
      calloutFor(
        event({ ...hit, car: 1, by: 0, component: 0, cls: 'direct', damage: 22, chassis: 9 }),
        ctx,
      ),
    ).toMatchObject({ text: 'DIRECT HIT', detail: 'Rival: Engine', tone: 'good' });
    expect(
      calloutFor(
        event({
          type: 'utility',
          car: 1,
          part: 0,
          utility: 'utility_spare',
          state: 'done',
          value: 2,
        }),
        ctx,
      ),
    ).toBeNull();
    expect(calloutFor(event({ type: 'checkpoint', car: 0, index: 2 }), ctx)).toBeNull();
  });

  it('calls laps, the final lap, lead changes, lost parts and repairs', () => {
    expect(
      calloutFor(event({ type: 'lap', car: 0, lap: 1, lapTimeMs: 31_420 }), ctx),
    ).toMatchObject({ text: 'LAP 2', detail: '0:31.42' });
    expect(
      calloutFor(event({ type: 'lap', car: 0, lap: 2, lapTimeMs: 30_000 }), ctx),
    ).toMatchObject({ text: 'FINAL LAP' });
    expect(calloutFor(event({ type: 'lap', car: 0, lap: 3, lapTimeMs: 30_000 }), ctx)).toBeNull();
    expect(calloutFor(event({ type: 'lap', car: 1, lap: 1, lapTimeMs: 30_000 }), ctx)).toBeNull();
    expect(calloutFor(event({ type: 'position', leader: 0, gapMeters: 2 }), ctx)).toMatchObject({
      text: 'LEAD TAKEN',
      tone: 'good',
    });
    expect(calloutFor(event({ type: 'position', leader: 1, gapMeters: 2 }), ctx)).toMatchObject({
      text: 'LEAD LOST',
      tone: 'bad',
    });
    // The shuffle off the grid is not news.
    expect(
      calloutFor(event({ type: 'position', leader: 1, gapMeters: 2 }), {
        ...ctx,
        raceTimeMs: 1500,
      }),
    ).toBeNull();
    const rocket = loadout.parts[0]!;
    expect(
      calloutFor(
        event({
          type: 'component',
          car: 0,
          component: rocket.component,
          condition: 'disabled',
          integrity: 0,
          repaired: false,
        }),
        ctx,
      ),
    ).toMatchObject({ text: 'PART LOST', detail: 'Straight Rocket' });
    expect(
      calloutFor(
        event({
          type: 'component',
          car: 1,
          component: 0,
          condition: 'disabled',
          integrity: 0,
          repaired: false,
        }),
        ctx,
      ),
    ).toMatchObject({ text: 'DESTROYED', detail: 'Rival: Engine' });
    expect(
      calloutFor(
        event({
          type: 'component',
          car: 0,
          component: 0,
          condition: 'damaged',
          integrity: 60,
          repaired: false,
        }),
        ctx,
      ),
    ).toBeNull();
    expect(
      calloutFor(
        event({
          type: 'utility',
          car: 0,
          part: 2,
          utility: 'utility_repair',
          state: 'done',
          value: 0,
        }),
        ctx,
      ),
    ).toMatchObject({ text: 'REPAIRED', detail: 'Engine' });
    expect(
      calloutFor(
        event({
          type: 'status',
          car: 0,
          by: 1,
          family: 'emp',
          state: 'applied',
          magnitude: 1,
          ticks: 45,
        }),
        ctx,
      ),
    ).toMatchObject({ text: 'SYSTEMS DOWN' });
    expect(
      calloutFor(
        event({
          type: 'status',
          car: 0,
          by: 1,
          family: 'emp',
          state: 'expired',
          magnitude: 1,
          ticks: 0,
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it('keeps every HUD and results string free of dashes used as punctuation', () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        expect(value, path).not.toMatch(/—|–|--/);
        return;
      }
      if (value && typeof value === 'object')
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    };
    walk(STRINGS.hud, 'hud');
    walk(STRINGS.results, 'results');
    walk(STRINGS.settings, 'settings');
  });
});

// --- Where the HUD may stand -----------------------------------------------------------------------

/** The column width the stylesheet gives the HUD at a viewport width, CSS pixels. */
function columnWidth(width: number, safe = 0): number {
  return Math.min(182, Math.max(131, 0.38 * width - 118 - safe));
}

describe('the HUD keeps clear of the car', () => {
  const sizes: Array<[number, number]> = [
    [870, 370],
    [870, 340],
    [844, 390],
    [667, 375],
    [932, 430],
  ];

  it('cannot be reached by a 220 x 150 box around the car, wherever the camera puts it', () => {
    for (const [w, h] of sizes) {
      const col = columnWidth(w) + 6;
      for (const rect of [
        { left: 0, top: 0, right: col, bottom: h },
        { left: w - col, top: 0, right: w, bottom: h },
      ])
        expect(carCanReach(rect, w, h, 220, 150), `${w}x${h} column ${rect.left}`).toBe(false);
      // The top banner (countdown, GO, finish) is only up while the car stands on the grid,
      // in the middle of the view: a banner 64 pixels tall is clear of it there.
      const roam = carRoam(w, h);
      expect(roam.rx).toBeCloseTo(w * 0.12, 6);
      expect(roam.ry).toBeCloseTo(h * 0.27, 6);
      expect(h / 2 - 75).toBeGreaterThan(8 + 64);
      // A panel across the top middle would be reached, which is why there is none.
      expect(
        carCanReach({ left: w / 2 - 60, top: 0, right: w / 2 + 60, bottom: 40 }, w, h, 220, 150),
      ).toBe(true);
    }
  });

  it('stays clear with a notch on the steering side', () => {
    // 844 wide with a 47 pixel inset: the column narrows, and what it gives up is the inset.
    const col = 47 + 6 + columnWidth(844, 47);
    expect(carCanReach({ left: 0, top: 0, right: col, bottom: 390 }, 844, 390, 220, 150)).toBe(
      false,
    );
  });

  it("places the car where the scene's camera does: behind the middle, along its travel", () => {
    const camera = new HudCamera();
    camera.configure(870, 370, 3, WORLD.width, WORLD.height);
    const at = { x: 0, y: 0 };
    // Standing still in open country: the middle of the view.
    camera.update(0, 1800, 1400, 0, 0);
    camera.car(at);
    expect(at.x).toBeCloseTo(435, 0);
    expect(at.y).toBeCloseTo(185, 0);
    // Flat out to the left: the lead settles, the car sits right of the middle, inside its roam.
    for (let ms = 16; ms < 4000; ms += 16) camera.update(ms, 1800, 1400, -260, 0);
    camera.car(at);
    expect(at.x).toBeGreaterThan(435 + 60);
    expect(at.x).toBeLessThanOrEqual(435 + carRoam(870, 370).rx + 1);
    expect(at.y).toBeCloseTo(185, 0);
    // Flat out down the screen: the car is high, never more than 27 percent above the middle.
    camera.cut();
    for (let ms = 0; ms < 4000; ms += 16) camera.update(ms, 1800, 1400, 0, 260);
    camera.car(at);
    expect(at.y).toBeLessThan(185 - 60);
    expect(at.y).toBeGreaterThanOrEqual(185 - carRoam(870, 370).ry - 1);
    // A point a hundred world pixels ahead of it is that far ahead on screen, at the view scale.
    const ahead = camera.toScreen(1800, 1500, { x: 0, y: 0 });
    expect(ahead.y - at.y).toBeCloseTo(100 * camera.cssPerWorld, 3);
    expect(camera.cssPerWorld).toBeCloseTo(1, 1);
  });

  it('marks an off-screen rival on the edge of the play field, pointing at it', () => {
    const view = { left: 0, top: 0, right: 870, bottom: 370 };
    const frame = { left: 200, top: 18, right: 670, bottom: 352 };
    const car = { x: 435, y: 285 };
    // On screen: no marker.
    expect(edgeMark({ x: 500, y: 100 }, car, view, frame)).toBeNull();
    // Straight ahead, far above the view.
    const up = edgeMark({ x: 435, y: -600 }, car, view, frame)!;
    expect(up).toMatchObject({ x: 435, y: 18 });
    expect(up.angle).toBeCloseTo(0, 6);
    // Off to the right and a little behind: clamped to the right edge of the frame.
    const right = edgeMark({ x: 1500, y: 385 }, car, view, frame)!;
    expect(right.x).toBe(670);
    expect(right.y).toBeGreaterThan(285);
    expect(right.y).toBeLessThanOrEqual(352);
    expect(right.angle).toBeCloseTo(Math.atan2(1500 - 435, -(385 - 285)), 6);
    // Behind and below: on the bottom edge, pointing down.
    const down = edgeMark({ x: 300, y: 900 }, car, view, frame)!;
    expect(down.y).toBe(352);
    expect(Math.abs(down.angle)).toBeGreaterThan(Math.PI / 2);
    // Always inside the frame, for a ring of directions.
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const mark = edgeMark(
        { x: 435 + Math.sin(a) * 2000, y: 285 - Math.cos(a) * 2000 },
        car,
        view,
        frame,
      )!;
      expect(mark.x).toBeGreaterThanOrEqual(frame.left);
      expect(mark.x).toBeLessThanOrEqual(frame.right);
      expect(mark.y).toBeGreaterThanOrEqual(frame.top);
      expect(mark.y).toBeLessThanOrEqual(frame.bottom);
      expect(mark.angle).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 4);
    }
  });
});
