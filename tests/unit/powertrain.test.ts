import {
  CATALOG,
  CHASSIS_LIST,
  CITY_01,
  EXAMPLE_TEMPLATES,
  TEMPLATES,
  baselineBlueprint,
  conditionsFor,
} from '@bolt/content';
import type { VehicleMotionState, VehicleParams, WeatherId } from '@bolt/shared';
import {
  AIRFLOW_STILL,
  BASE_BATTERY,
  BASE_COOLING,
  BASE_GENERATION,
  BRAKE_DECEL,
  COOLING_MULTIPLIER,
  DRIVETRAIN_MIN_SUPPLY,
  FORCE_PER_INDEX,
  HEAT_PERFORMANCE,
  HEAT_PROTECTION,
  HEAT_RECOVERY,
  HEAT_SHED_BASE,
  HEAT_SHED_SCALE,
  HEAT_WARNING,
  SIM_DT,
  STABILITY_MAX,
  STABILITY_MIN,
  THERMAL_PENALTY_MAX,
  WEATHER_IDS,
  aggregateModifiers,
  buildTrack,
  computeMass,
  computeStability,
  copyMotionState,
  createDriveSession,
  createDriverScratch,
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  driveCenterline,
  instability,
  mulberry32,
  resetPowertrain,
  resolveBlueprint,
  sessionSnapshot,
  stepDriveSession,
  stepPowertrain,
  stepStraight,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { DriveState, writeDriveState } from '../../apps/server/src/rooms/schema.js';
import { car } from '../helpers/blueprints.js';
import { CLEAR, FULL, paramsOf, provingGround, rig, sprint, statsOf } from '../helpers/rig.js';
import { makeProvingGround } from '../helpers/tracks.js';

const BASE = paramsOf(baselineBlueprint());

/** Runs only the powertrain: no car, a fixed throttle and speed. */
function bench(params: VehicleParams, weather: WeatherId = 'clear') {
  const state = createMotionState(0, 0, 0, params);
  const out = createPowertrainOutput();
  const telemetry = createTelemetry();
  const env = { weather, wetness: 0 };
  return {
    state,
    out,
    telemetry,
    run(seconds: number, throttle = 1, speed = 250) {
      for (let i = 0; i < Math.round(seconds / SIM_DT); i++)
        stepPowertrain(state, throttle, speed, params, env, SIM_DT, out, telemetry);
    },
  };
}

describe('energy: generation, battery and consumer priority (Sections 6.2 and 6.5)', () => {
  it('starts from the Section 6.5 base: 10 power a second and a 40-unit battery', () => {
    expect(BASE_GENERATION).toBe(10);
    expect(BASE_BATTERY).toBe(40);
    expect(BASE.power).toEqual({
      generation: 10,
      offThrottleGeneration: 0,
      capacity: 40,
      drivetrainDraw: 0,
      consumers: [],
    });
    expect(createMotionState(0, 0, 0, BASE).batteryEnergy).toBe(40);
    const b = bench(BASE);
    b.run(30);
    expect(b.state.batteryEnergy).toBe(40);
    expect(b.telemetry).toMatchObject({
      lowPower: false,
      drivetrainSupply: 1,
      auxSupply: 1,
      powerDemand: 0,
      generation: 10,
    });
  });

  /** A car with an electric drivetrain and three optional systems of different priority. */
  const loaded = (generation: number): VehicleParams => ({
    ...BASE,
    power: {
      generation,
      offThrottleGeneration: 0,
      capacity: 40,
      drivetrainDraw: 14,
      consumers: [
        { draw: 5, priority: 1, effect: { surfaceGrip: { metal: 0.45 } } },
        { draw: 2, priority: 2, effect: { cooling: 4 } },
        { draw: 3, priority: 3, effect: { stability: 16 } },
      ],
    },
  });

  it('lets the battery smooth a burst, then throttles the lowest priority first', () => {
    // Demand 24 a second against 20 generated: the battery covers the 4 for ten seconds.
    const b = bench(loaded(20));
    b.run(9.9);
    expect(b.telemetry.lowPower).toBe(false);
    expect(b.out).toMatchObject({ output: 1, gripSupply: 1, stabilityAdd: 16 });
    expect(b.state.batteryEnergy).toBeCloseTo(40 - 4 * 9.9, 6);
    b.run(1);
    expect(b.state.batteryEnergy).toBe(0);
    expect(b.telemetry.lowPower).toBe(true);
    // 20 units: the drivetrain takes 14, the tires 5, the fan the last 1 of its 2, and the
    // gyro, the lowest priority, nothing.
    expect(b.telemetry.drivetrainSupply).toBe(1);
    expect(b.out.output).toBe(1);
    expect(b.out.gripSupply).toBe(1);
    expect(b.out.stabilityAdd).toBeCloseTo(0, 9);
    expect(
      b.telemetry.heatCooling / (HEAT_SHED_BASE + b.state.coreHeat / HEAT_SHED_SCALE),
    ).toBeCloseTo(BASE_COOLING + 4 * 0.5, 1);
    expect(b.telemetry.auxSupply).toBeCloseTo(6 / 10, 9);
    expect(b.telemetry.powerDemand).toBeCloseTo(24, 9);
  });

  it.each([
    // generation, drivetrain supply, tires, fan, gyro
    [30, 1, 1, 1, 1],
    [24, 1, 1, 1, 1],
    [22, 1, 1, 1, 1 / 3],
    [20, 1, 1, 0.5, 0],
    [16, 1, 0.4, 0, 0],
    [14, 1, 0, 0, 0],
    [10, 10 / 14, 0, 0, 0],
    [7, 0.5, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ])(
    'with %s power a second and a flat battery: drivetrain %s, then tires %s, fan %s, gyro %s',
    (generation, drive, tires, fan, gyro) => {
      const b = bench(loaded(generation));
      b.state.batteryEnergy = 0;
      b.run(1);
      expect(b.telemetry.drivetrainSupply).toBeCloseTo(drive, 9);
      expect(b.out.gripSupply).toBeCloseTo(tires, 9);
      expect(b.out.stabilityAdd).toBeCloseTo(16 * gyro, 9);
      const cooling =
        b.telemetry.heatCooling /
        (HEAT_SHED_BASE +
          (b.state.coreHeat - (b.telemetry.heatProduction - b.telemetry.heatCooling) * SIM_DT) /
            HEAT_SHED_SCALE);
      expect(cooling).toBeCloseTo(BASE_COOLING + 4 * fan, 6);
      // The protected minimum: however little arrives, the drivetrain keeps 55 percent.
      expect(b.out.output).toBeCloseTo(Math.max(DRIVETRAIN_MIN_SUPPLY, drive), 9);
      expect(b.out.output).toBeGreaterThanOrEqual(0.55);
      expect(b.state.batteryEnergy).toBeCloseTo(Math.max(0, (generation - 24) * 1), 6);
      expect(b.telemetry.lowPower).toBe(generation < 24);
    },
  );

  it('never lets an optional system take power the drivetrain needs', () => {
    // Fifty power-hungry accessories against a drivetrain: the drivetrain is still served first.
    const greedy: VehicleParams = {
      ...BASE,
      power: {
        ...loaded(14).power,
        consumers: Array.from({ length: 50 }, (_, i) => ({
          draw: 20,
          priority: 1 + (i % 4),
          effect: { stability: 1 },
        })),
      },
    };
    const b = bench(greedy);
    b.state.batteryEnergy = 0;
    b.run(5);
    expect(b.telemetry.drivetrainSupply).toBe(1);
    expect(b.out.output).toBe(1);
    expect(b.out.stabilityAdd).toBe(0);
    expect(b.state.batteryEnergy).toBe(0);
  });

  it('draws for the drivetrain in proportion to throttle, and recharges off it', () => {
    const p = loaded(10);
    const b = bench({ ...p, power: { ...p.power, consumers: [] } });
    b.run(5, 0.5);
    // Half throttle draws 7 against 10 generated: the battery stays full.
    expect(b.state.batteryEnergy).toBe(40);
    b.run(5, 1);
    expect(b.state.batteryEnergy).toBeCloseTo(40 - 4 * 5, 6);
    b.run(2, 0);
    expect(b.state.batteryEnergy).toBeCloseTo(40, 6);
    // The battery never holds more than its capacity or less than nothing.
    b.run(60, 0);
    expect(b.state.batteryEnergy).toBe(40);
    b.run(60, 1);
    expect(b.state.batteryEnergy).toBe(0);
  });

  it('shows the same shortage in the garage that the race will have', () => {
    const rainRunner = EXAMPLE_TEMPLATES.find((t) => t.name === 'Rain Runner')!.blueprint;
    const stats = statsOf(rainRunner, conditionsFor('city_01', 'city_rain_night')!);
    // Sport Electric 14 + Energy Shield 3 + the sentry's 2 per 3.2 seconds, against 10.
    expect(stats.indicators.energy.drawPerSecond).toBeCloseTo(14 + 3 + 2 / 3.2, 9);
    expect(stats.indicators.energy.ratio).toBeCloseTo(1.7625, 9);
    expect(stats.indicators.energy.status).toBe('over');
    expect(stats.warnings.map((w) => w.message)).toContain(
      'Not enough power for every system at once.',
    );
    expect(stats.indicators.energy.batterySeconds).toBeCloseTo(40 / 7.625, 6);
    // In the race the continuous 17 empties the battery in under six seconds flat out, the
    // shield (priority 3) loses its supply and the motor fades to 10/14.
    const r = rig(paramsOf(rainRunner, conditionsFor('city_01', 'city_rain_night')!), {
      weather: 'rain',
      wetness: 0.8,
    });
    r.run(FULL, 5.5);
    expect(r.telemetry.lowPower).toBe(false);
    r.run(FULL, 1.5);
    expect(r.telemetry.lowPower).toBe(true);
    expect(r.telemetry.auxSupply).toBe(0);
    expect(r.telemetry.powerFraction).toBeCloseTo(10 / 14, 6);
  });
});

describe('heat: thresholds, limiting and cooling (Sections 6.5 and 9.2)', () => {
  it('uses the Section 6.5 thresholds', () => {
    expect([
      BASE_COOLING,
      HEAT_WARNING,
      HEAT_PERFORMANCE,
      HEAT_PROTECTION,
      HEAT_RECOVERY,
      THERMAL_PENALTY_MAX,
    ]).toEqual([8, 70, 90, 110, 75, 0.35]);
    expect(BASE.heat).toEqual({
      enginePerSecond: 8,
      idleFraction: 0.2,
      partialLoadFactor: 1,
      constantPerSecond: 0,
      cooling: 8,
      performanceThreshold: 90,
    });
  });

  it('warns at 70, takes power from 90, protects at 110 and recovers below 75', () => {
    const outputAt = (heat: number, limited = false) => {
      const b = bench(BASE);
      b.state.coreHeat = heat;
      b.state.thermalLimited = limited;
      b.run(SIM_DT);
      return {
        output: b.out.output,
        level: b.telemetry.heatLevel,
        limited: b.state.thermalLimited,
      };
    };
    expect(outputAt(0)).toEqual({ output: 1, level: 0, limited: false });
    expect(outputAt(69)).toMatchObject({ output: 1, level: 0 });
    expect(outputAt(71)).toMatchObject({ output: 1, level: 1 });
    expect(outputAt(89)).toMatchObject({ output: 1, level: 1 });
    // Between 90 and 110 the penalty grows in a straight line to its cap.
    expect(outputAt(95).output).toBeCloseTo(1 - 0.35 * 0.25, 9);
    expect(outputAt(95).level).toBe(2);
    expect(outputAt(100).output).toBeCloseTo(1 - 0.35 * 0.5, 9);
    expect(outputAt(109).output).toBeCloseTo(1 - 0.35 * 0.95, 9);
    // At 110 protection engages, and no amount of heat costs more than 35 percent.
    expect(outputAt(111)).toMatchObject({ level: 3, limited: true });
    for (const heat of [110, 150, 400, 1e6]) expect(outputAt(heat).output).toBeCloseTo(0.65, 9);
    // Once engaged it holds the full penalty until heat is back under 75.
    expect(outputAt(100, true)).toEqual({ output: 0.65, level: 3, limited: true });
    expect(outputAt(76, true)).toEqual({ output: 0.65, level: 3, limited: true });
    expect(outputAt(74, true).output).toBe(0.65);
    expect(outputAt(74, true).limited).toBe(false);
    expect(outputAt(74, false)).toMatchObject({ output: 1, level: 1, limited: false });
  });

  it('cycles a badly overheating engine between protection and recovery, predictably', () => {
    // A V12 on stock cooling makes 19 against 8.
    const p = paramsOf(baselineBlueprint({ engineId: 'engine_v12' }));
    const b = bench(p);
    const trace: Array<{ heat: number; output: number; limited: boolean }> = [];
    for (let i = 0; i < 30 * 240; i++) {
      b.run(SIM_DT);
      trace.push({ heat: b.state.coreHeat, output: b.out.output, limited: b.state.thermalLimited });
    }
    const peak = Math.max(...trace.map((t) => t.heat));
    // It reaches the performance band and loses power there, never more than 35 percent.
    expect(peak).toBeGreaterThan(HEAT_PERFORMANCE);
    expect(Math.min(...trace.map((t) => t.output))).toBeGreaterThanOrEqual(0.65 - 1e-9);
    expect(trace.some((t) => t.output < 0.9)).toBe(true);
    // Heat is bounded: limiting the engine also limits the heat it makes.
    expect(peak).toBeLessThan(HEAT_PROTECTION + 5);
    // Lifting lets it cool right down.
    b.run(40, 0);
    expect(b.state.coreHeat).toBeLessThan(HEAT_WARNING);
    expect(b.state.thermalLimited).toBe(false);
    // The garage said so before the race.
    const stats = statsOf(baselineBlueprint({ engineId: 'engine_v12' }));
    expect(stats.indicators.heat.ratio).toBeCloseTo(19 / (8 * 1.6), 9);
    expect(stats.indicators.heat.status).toBe('over');
    expect(stats.warnings.map((w) => w.message)).toContain(
      'This build runs hot. Add cooling or manage your throttle.',
    );
    expect(statsOf(baselineBlueprint()).warnings).toEqual([]);
  });

  // Transcribed from the Cooling column of Section 9.2.
  const SPEC_COOLING: Record<WeatherId, number> = {
    clear: 1.0,
    rain: 1.18,
    heavy_rain: 1.25,
    sandstorm: 0.94,
    dry_heat: 0.78,
    snowfall: 1.15,
    clear_frost: 1.08,
  };

  it.each(WEATHER_IDS)('cools by the Section 9.2 multiplier in %s', (weather) => {
    expect(COOLING_MULTIPLIER[weather]).toBe(SPEC_COOLING[weather]);
    const multiplier = SPEC_COOLING[weather];
    // The default car held flat out settles where production meets cooling.
    const b = bench(BASE, weather);
    b.run(600);
    const settled = HEAT_SHED_SCALE * (8 / (8 * multiplier) - HEAT_SHED_BASE);
    expect(b.state.coreHeat).toBeCloseTo(settled, 1);
    expect(b.telemetry.heatCooling).toBeCloseTo(8, 2);
    // The default car stays under the warning line in every published weather.
    expect(b.state.coreHeat).toBeLessThan(HEAT_WARNING);
    expect(b.out.output).toBe(1);
    // A V8 with a fan: fine in the rain, hot in dry heat. Thresholds do not move with weather.
    const v8 = paramsOf(
      car('chassis_beetle', [{ partId: 'utility_fan', mountId: 'left_utility' }], {
        engineId: 'engine_v8',
      }),
    );
    const hot = bench(v8, weather);
    hot.run(600);
    const expected = HEAT_SHED_SCALE * (15 / (12 * multiplier) - HEAT_SHED_BASE);
    if (expected < HEAT_PERFORMANCE) {
      expect(hot.state.coreHeat).toBeCloseTo(expected, 1);
      expect(hot.out.output).toBe(1);
    } else {
      expect(hot.state.coreHeat).toBeGreaterThanOrEqual(HEAT_RECOVERY - 1);
      expect(hot.out.output).toBeLessThan(1);
    }
    expect(hot.telemetry.heatLevel >= 1).toBe(expected >= HEAT_WARNING);
    // The garage indicator for the published weather agrees with the simulation.
    const stats = statsOf(
      car('chassis_beetle', [{ partId: 'utility_fan', mountId: 'left_utility' }], {
        engineId: 'engine_v8',
      }),
      { weather, timeOfDay: 'day' },
    );
    expect(stats.indicators.heat.coolingPerSecond).toBeCloseTo(12 * multiplier * 1.6, 9);
    expect(stats.indicators.heat.ratio).toBeCloseTo(15 / (12 * multiplier * 1.6), 9);
    expect(stats.indicators.heat.equilibriumHeat).toBeCloseTo(expected, 6);
    expect(stats.warnings.some((w) => w.code === 'RUNS_HOT')).toBe(expected > HEAT_PERFORMANCE);
  });

  it('orders the weather presets by how well they cool', () => {
    const settle = (weather: WeatherId) => {
      const b = bench(BASE, weather);
      b.run(600);
      return b.state.coreHeat;
    };
    const order = [...WEATHER_IDS].sort((a, b) => settle(a) - settle(b));
    expect(order).toEqual([
      'heavy_rain',
      'rain',
      'snowfall',
      'clear_frost',
      'clear',
      'sandstorm',
      'dry_heat',
    ]);
  });

  it('needs airflow: a car standing still sheds 60 percent of what it sheds at speed', () => {
    const moving = bench(BASE);
    moving.state.coreHeat = 60;
    moving.run(SIM_DT, 0, 250);
    const still = bench(BASE);
    still.state.coreHeat = 60;
    still.run(SIM_DT, 0, 0);
    expect(still.telemetry.heatCooling / moving.telemetry.heatCooling).toBeCloseTo(
      AIRFLOW_STILL,
      6,
    );
    // Heat follows throttle: an idling engine makes a fifth of its full-throttle heat.
    expect(still.telemetry.heatProduction).toBeCloseTo(8 * 0.2, 9);
    expect(moving.telemetry.heatProduction).toBeCloseTo(8 * 0.2, 9);
    const flat = bench(BASE);
    flat.run(SIM_DT, 1);
    expect(flat.telemetry.heatProduction).toBeCloseTo(8, 9);
    // Heat never goes below zero.
    const cold = bench(BASE);
    cold.run(30, 0);
    expect(cold.state.coreHeat).toBe(0);
  });
});

describe('load (Section 6.2)', () => {
  // Beetle: recommended 460 kg, maximum 730 kg.
  const light = car('chassis_beetle', [], { engineId: 'engine_v8', tireKitId: 'tires_street' });
  const heavy = car(
    'chassis_beetle',
    [
      { partId: 'defense_heavy_plate', mountId: 'front_center' },
      { partId: 'defense_heavy_plate', mountId: 'rear_center', rotationQuarterTurns: 2 },
      { partId: 'utility_generator', mountId: 'left_utility' },
      { partId: 'utility_generator', mountId: 'right_utility' },
    ],
    { engineId: 'engine_v8', tireKitId: 'tires_street' },
  );

  it('counts installed mass against the limits, not the frame itself', () => {
    const a = statsOf(light).indicators.load;
    expect(a).toMatchObject({
      loadKg: 155 + 48,
      recommendedKg: 460,
      maxKg: 730,
      totalMassKg: 250 + 203,
      status: 'ok',
    });
    expect(a.gauge).toBeCloseTo(203 / 730, 9);
    expect(a.recommendedMark).toBeCloseTo(460 / 730, 9);
    const b = statsOf(heavy).indicators.load;
    expect(b.loadKg).toBe(155 + 48 + 145 * 2 + 82 * 2);
    expect(b.status).toBe('caution');
    expect(statsOf(heavy).legal).toBe(true);
    expect(statsOf(heavy).warnings.map((w) => w.code)).toContain('OVER_RECOMMENDED_LOAD');
    expect(statsOf(light).warnings.map((w) => w.code)).not.toContain('OVER_RECOMMENDED_LOAD');
    // Mass is where the parts are: two generators and plates front and rear stay centred.
    expect(statsOf(heavy).mass.comX).toBeCloseTo(0, 9);
  });

  it('costs acceleration, braking and heat above the recommended load, beyond the mass itself', () => {
    const p = paramsOf(heavy);
    const over = (657 - 460) / (730 - 460);
    expect(computeMass(resolveBlueprint(heavy, CATALOG)!).overload).toBeCloseTo(over, 9);
    expect(p.driveForce).toBeCloseTo(158 * FORCE_PER_INDEX * (1 - 0.18 * over), 6);
    expect(p.heat.enginePerSecond).toBeCloseTo(15 * (1 + 0.12 * over), 9);
    // Braking: the mass term and the overload term together.
    const massTerm = Math.max(0.75, Math.pow(393 / p.massKg, 0.3));
    expect(p.brakeDecel).toBeCloseTo(BRAKE_DECEL * massTerm * (1 - 0.25 * over), 6);
    expect(p.brakeDecel).toBeLessThan(paramsOf(light).brakeDecel * 0.75);
    // The same mass without the overload penalties (as on a frame rated for it) is quicker.
    const rated: VehicleParams = { ...p, driveForce: 158 * FORCE_PER_INDEX };
    expect(sprint(p).toSixty!).toBeGreaterThan(sprint(rated).toSixty! + 0.3);
    expect(sprint(p).toSixty!).toBeGreaterThan(sprint(paramsOf(light)).toSixty! * 1.6);
    // At or below the recommended load there is no penalty at all.
    expect(paramsOf(light).driveForce).toBe(158 * FORCE_PER_INDEX);
    expect(paramsOf(light).heat.enginePerSecond).toBe(15);
  });

  it('is illegal over the maximum, and the garage says so in the approved words', () => {
    const tooMuch = car(
      'chassis_trike',
      [
        { partId: 'weapon_shotgun', mountId: 'front_center', assignedActionSlot: 0 },
        { partId: 'utility_generator', mountId: 'left_rear' },
      ],
      {
        engineId: 'engine_twin',
        tireKitId: 'tires_track',
      },
    );
    const stats = statsOf(tooMuch);
    expect(stats.legal).toBe(false);
    expect(stats.indicators.load.status).toBe('over');
    expect(stats.indicators.load.gauge).toBe(1);
    expect(stats.warnings.map((w) => w.message)).toContain(
      'Too heavy for this chassis. Remove weight or swap frames.',
    );
    expect(stats.issues.map((i) => i.code)).toContain('TOO_HEAVY');
  });
});

describe('stability (Section 6.5)', () => {
  it('follows the formula term by term', () => {
    for (const template of TEMPLATES) {
      const s = statsOf(template.blueprint).indicators.stability;
      expect(s.raw, template.id).toBeCloseTo(
        100 -
          s.lateralWeightPenalty -
          s.highCenterPenalty -
          s.wheelbasePenalty -
          s.damagePenalty +
          s.stabilizationBonus,
        9,
      );
      expect(s.score).toBe(Math.round(Math.min(100, Math.max(10, s.raw + s.powered))));
      expect(s.damagePenalty).toBe(0);
      for (const term of [
        s.lateralWeightPenalty,
        s.highCenterPenalty,
        s.wheelbasePenalty,
        s.longitudinalPenalty,
      ])
        expect(term).toBeGreaterThanOrEqual(0);
    }
  });

  it('is clamped to 10 to 100 for every car, however extreme', () => {
    expect([STABILITY_MIN, STABILITY_MAX]).toEqual([10, 100]);
    // As planted as it gets: a Spider on Full Tracks with a gyro.
    const planted = statsOf(
      car('chassis_spider', [{ partId: 'utility_gyro', mountId: 'rear_utility' }], {
        tireKitId: 'tires_track',
      }),
    ).indicators.stability;
    expect(planted.raw + planted.powered).toBeGreaterThan(100);
    expect(planted.score).toBe(100);
    // As tippy as a legal car gets: a Trike on Monster Wheels with tall weight to one side.
    const tippy = statsOf(
      car(
        'chassis_trike',
        [
          { partId: 'defense_energy_shield', mountId: 'roof_mid' },
          { partId: 'utility_generator', mountId: 'left_rear' },
        ],
        { tireKitId: 'tires_monster' },
      ),
    );
    expect(tippy.legal).toBe(true);
    expect(tippy.indicators.stability.score).toBeLessThan(25);
    expect(tippy.indicators.stability.score).toBeGreaterThanOrEqual(10);
    // Force every penalty far past the scale: the score still stops at 10.
    const build = resolveBlueprint(baselineBlueprint({ chassisId: 'chassis_trike' }), CATALOG)!;
    const totals = aggregateModifiers(build);
    totals.steering.stability = -500;
    expect(computeStability(build, totals).score).toBe(10);
    totals.steering.stability = 500;
    expect(computeStability(build, totals).score).toBe(100);
  });

  it('never divides by zero, whatever the wheel layout', () => {
    const base = resolveBlueprint(baselineBlueprint(), CATALOG)!;
    for (const anchors of [
      [{ id: 'only', x: 0, y: 0, steers: true, driven: true }],
      [
        { id: 'a', x: 0, y: -10, steers: true, driven: false },
        { id: 'b', x: 0, y: 10, steers: false, driven: true },
      ],
      [
        { id: 'a', x: -10, y: 0, steers: true, driven: false },
        { id: 'b', x: 10, y: 0, steers: false, driven: true },
      ],
    ]) {
      const odd = { ...base, chassis: { ...base.chassis, wheelAnchors: anchors } };
      const s = computeStability(odd);
      for (const value of Object.values(s)) expect(Number.isFinite(value)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(10);
      expect(s.score).toBeLessThanOrEqual(100);
    }
    // A car that weighs nothing still has finite numbers.
    const weightless = {
      ...base,
      chassis: { ...base.chassis, massKg: 0, modifiers: [] },
      engine: { ...base.engine, massKg: 0, modifiers: [] },
      tires: { ...base.tires, massKg: 0, modifiers: [] },
    };
    for (const value of Object.values(computeMass(weightless)))
      expect(Number.isFinite(value)).toBe(true);
  });

  it('comes from where the mass really is, the wheel layout and the tires', () => {
    const s = (bp: Parameters<typeof statsOf>[0]) => statsOf(bp).indicators.stability;
    // Lateral centre of mass: a heavy part on one side costs points; a matching one restores them.
    const centred = s(baselineBlueprint());
    const oneSide = s(
      car('chassis_beetle', [{ partId: 'utility_generator', mountId: 'left_utility' }]),
    );
    const bothSides = s(
      car('chassis_beetle', [
        { partId: 'utility_generator', mountId: 'left_utility' },
        { partId: 'utility_generator', mountId: 'right_utility' },
      ]),
    );
    expect(centred.lateralWeightPenalty).toBe(0);
    expect(oneSide.lateralWeightPenalty).toBeGreaterThan(10);
    expect(bothSides.lateralWeightPenalty).toBeCloseTo(0, 9);
    expect(
      statsOf(car('chassis_beetle', [{ partId: 'utility_generator', mountId: 'left_utility' }]))
        .mass.comX,
    ).toBeCloseTo((82 * -13) / 475, 9);
    // Nudging a part inside its mount moves the centre of mass with it.
    const nudged = statsOf(
      car('chassis_beetle', [
        { partId: 'utility_generator', mountId: 'left_utility', offsetX: -2 },
      ]),
    ).mass.comX;
    expect(nudged).toBeCloseTo((82 * -15) / 475, 9);
    // Longitudinal balance: a heavy plate on the nose of a rear-engined car helps, on the tail hurts.
    const tail = s(
      car('chassis_beetle', [
        { partId: 'defense_heavy_plate', mountId: 'rear_center', rotationQuarterTurns: 2 },
      ]),
    );
    const nose = s(
      car('chassis_beetle', [{ partId: 'defense_heavy_plate', mountId: 'front_center' }]),
    );
    expect(tail.longitudinalPenalty).toBeGreaterThan(nose.longitudinalPenalty + 5);
    // Tall attachments, and more so on the roof.
    const turretRoof = s(
      car('chassis_beetle', [
        { partId: 'weapon_turret', mountId: 'roof_mid', assignedActionSlot: 0 },
      ]),
    );
    const turretNose = s(
      car('chassis_beetle', [
        { partId: 'weapon_turret', mountId: 'front_center', assignedActionSlot: 0 },
      ]),
    );
    const flat = s(
      car('chassis_beetle', [
        { partId: 'weapon_rocket', mountId: 'roof_mid', assignedActionSlot: 0 },
      ]),
    );
    expect(turretRoof.highCenterPenalty).toBeGreaterThan(turretNose.highCenterPenalty);
    expect(turretNose.highCenterPenalty).toBeGreaterThan(0);
    expect(flat.highCenterPenalty).toBeGreaterThan(0);
    expect(flat.highCenterPenalty).toBeLessThan(turretRoof.highCenterPenalty);
    // Wheelbase and track width: the wide six-wheeler pays nothing, the Trike the most.
    const geometry = (id: string) => {
      const g = s(baselineBlueprint({ chassisId: id, engineId: 'engine_four_cylinder' }));
      return g.wheelbasePenalty - g.longitudinalPenalty;
    };
    expect(geometry('chassis_spider')).toBeLessThan(2);
    expect(geometry('chassis_spider')).toBeLessThan(geometry('chassis_beetle'));
    expect(geometry('chassis_trike')).toBe(Math.max(...CHASSIS_LIST.map((c) => geometry(c.id))));
    // Tire grip: stickier rubber is steadier.
    expect(s(baselineBlueprint({ tireKitId: 'tires_slick' })).stabilizationBonus).toBeGreaterThan(
      centred.stabilizationBonus,
    );
    expect(s(baselineBlueprint({ tireKitId: 'tires_balloon' })).stabilizationBonus).toBeLessThan(
      centred.stabilizationBonus,
    );
    // Damage: missing wheels cost stability once combat can damage them.
    const build = resolveBlueprint(baselineBlueprint(), CATALOG)!;
    expect(computeStability(build, undefined, undefined, [100, 100, 100, 100]).damagePenalty).toBe(
      0,
    );
    expect(
      computeStability(build, undefined, undefined, [0, 100, 100, 100]).damagePenalty,
    ).toBeCloseTo(6.25, 9);
    expect(computeStability(build, undefined, undefined, [0, 0, 0, 0]).damagePenalty).toBe(25);
  });

  it('costs grip below the chassis threshold, clearly but drivably', () => {
    const p = { ...BASE, stabilityThreshold: 55 };
    expect(instability({ ...p, stability: 80 }, 0)).toBe(0);
    expect(instability({ ...p, stability: 55 }, 0)).toBe(0);
    expect(instability({ ...p, stability: 32.5 }, 0)).toBeCloseTo(0.5, 9);
    expect(instability({ ...p, stability: 10 }, 0)).toBe(1);
    expect(instability({ ...p, stability: -200 }, 0)).toBe(1);
    // A powered stabiliser counts as far as it is supplied.
    expect(instability({ ...p, stability: 39 }, 16)).toBe(0);
    expect(instability({ ...p, stability: 39 }, 8)).toBeCloseTo(8 / 45, 9);
    // The least stable car a player can build still finishes Neon Cut.
    const worst = car(
      'chassis_trike',
      [
        { partId: 'defense_energy_shield', mountId: 'roof_mid' },
        { partId: 'utility_generator', mountId: 'left_rear' },
      ],
      { tireKitId: 'tires_monster' },
    );
    const track = buildTrack(CITY_01);
    const params = paramsOf(worst, conditionsFor('city_01', 'city_clear_night')!);
    expect(instability(params, 0)).toBeGreaterThan(0.6);
    const session = createDriveSession(track, CLEAR, params);
    const scratch = createDriverScratch();
    for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++)
      stepDriveSession(session, driveCenterline(track, session.motion, params, CLEAR, scratch));
    expect(session.progress.finishedAtMs).not.toBeNull();
  });
});

describe('wheel count (Sections 6.3 and 19.1)', () => {
  it.each(CHASSIS_LIST)(
    '$displayName: one wheel integrity entry per wheel anchor, in state and on the wire',
    (chassis) => {
      const params = paramsOf(baselineBlueprint({ chassisId: chassis.id }));
      expect(params.wheelCount).toBe(chassis.wheelCount);
      const session = createDriveSession(provingGround(), CLEAR, params);
      expect(session.wheelIntegrity).toHaveLength(chassis.wheelAnchors.length);
      expect(session.wheelIntegrity).toHaveLength(chassis.wheelCount);
      expect(session.wheelIntegrity.every((v) => v === 100)).toBe(true);
      const snapshot = sessionSnapshot(session, -1, 'hash');
      expect(snapshot.wheelIntegrity).toHaveLength(chassis.wheelCount);
      expect(snapshot.wheelIntegrity).not.toBe(session.wheelIntegrity);
      // The synchronized schema carries the same number of entries.
      const state = new DriveState();
      writeDriveState(state, session, -1);
      expect(Array.from(state.wheelIntegrity)).toEqual(session.wheelIntegrity);
      // Written again for a car with a different wheel count, it resizes.
      const other = createDriveSession(
        provingGround(),
        CLEAR,
        paramsOf(
          baselineBlueprint({
            chassisId: chassis.wheelCount === 4 ? 'chassis_spider' : 'chassis_beetle',
          }),
        ),
      );
      writeDriveState(state, other, -1);
      expect(state.wheelIntegrity).toHaveLength(other.wheelIntegrity.length);
    },
  );

  it('has three-, four- and six-wheel bodies, and nothing assumes four', () => {
    const counts = CHASSIS_LIST.map((c) => c.wheelCount);
    expect(counts.filter((n) => n === 3)).toHaveLength(1);
    expect(counts.filter((n) => n === 6)).toHaveLength(1);
    expect(counts.filter((n) => n === 4)).toHaveLength(3);
    // Six wheels: the collision width reaches the outer wheels, beyond the body.
    const spider = paramsOf(baselineBlueprint({ chassisId: 'chassis_spider' }));
    expect(spider.colliderRadius).toBe(24.5);
    expect(spider.colliderRadius).toBeGreaterThan(CATALOG.chassis.chassis_spider!.bodyHalfWidth);
    for (const chassis of CHASSIS_LIST) {
      const p = paramsOf(baselineBlueprint({ chassisId: chassis.id }));
      const outer = Math.max(...chassis.wheelAnchors.map((w) => Math.abs(w.x)));
      expect(p.colliderRadius, chassis.id).toBe(Math.max(chassis.bodyHalfWidth, outer));
      expect(p.colliderRadius + p.colliderOffset, chassis.id).toBeCloseTo(
        Math.max(chassis.bodyHalfLength, p.colliderRadius + 4),
        9,
      );
    }
    // The Spider is the widest thing on the road.
    const widths = CHASSIS_LIST.map(
      (c) => paramsOf(baselineBlueprint({ chassisId: c.id })).colliderRadius,
    );
    expect(paramsOf(baselineBlueprint({ chassisId: 'chassis_spider' })).colliderRadius).toBe(
      Math.max(...widths),
    );
    // Three wheels: the lowest stability of any bare frame.
    const stability = (id: string) =>
      statsOf(baselineBlueprint({ chassisId: id, engineId: 'engine_four_cylinder' })).indicators
        .stability.score;
    expect(stability('chassis_trike')).toBe(Math.min(...CHASSIS_LIST.map((c) => stability(c.id))));
    expect(stability('chassis_spider')).toBe(100);
    // Mass of a wheel kit follows the wheel count.
    expect(
      paramsOf(baselineBlueprint({ chassisId: 'chassis_spider', engineId: 'engine_four_cylinder' }))
        .massKg,
    ).toBe(420 + 95 + 72);
    expect(
      paramsOf(baselineBlueprint({ chassisId: 'chassis_trike', engineId: 'engine_four_cylinder' }))
        .massKg,
    ).toBe(145 + 95 + 36);
  });
});

describe('runtime state is complete and replay-safe (Section 15.4)', () => {
  const dummy = createMotionState(1, 2, 3, BASE);
  const keys = Object.keys(dummy) as Array<keyof VehicleMotionState>;

  it('copies every field of the motion state', () => {
    const from = createMotionState(0, 0, 0, BASE);
    keys.forEach((key, i) => {
      (from as Record<string, number | boolean>)[key] =
        typeof from[key] === 'boolean' ? true : 100 + i;
    });
    const to = createMotionState(9, 9, 9);
    copyMotionState(from, to);
    expect(to).toEqual(from);
  });

  it('synchronizes every field of the motion state through the room schema', () => {
    const state = new DriveState() as unknown as Record<string, unknown>;
    for (const key of keys) expect(key in state, key).toBe(true);
    const session = createDriveSession(
      provingGround(),
      CLEAR,
      paramsOf(EXAMPLE_TEMPLATES[3]!.blueprint),
    );
    for (let i = 0; i < 200; i++) stepDriveSession(session, FULL);
    session.motion.thermalLimited = true;
    session.motion.engineBurst = 0.7;
    session.motion.tireWearSeconds = 33.3;
    const real = new DriveState();
    real.buildHash = 'abc';
    writeDriveState(real, session, 7);
    const wire = real as unknown as Record<string, unknown>;
    for (const key of keys) expect(wire[key], key).toBe(session.motion[key]);
    expect(real.buildHash).toBe('abc');
    expect(real.ackSequence).toBe(7);
    // Battery below full and heat above zero really made it across.
    expect(real.batteryEnergy).toBeLessThan(40);
    expect(real.coreHeat).toBeGreaterThan(0);
  });

  it('resets the powertrain to cold, charged and ready', () => {
    const p = paramsOf(
      car('chassis_beetle', [{ partId: 'utility_battery', mountId: 'left_utility' }], {
        engineId: 'engine_rocket',
      }),
    );
    const state = createMotionState(0, 0, 0, p);
    Object.assign(state, {
      coreHeat: 99,
      batteryEnergy: 1,
      thermalLimited: true,
      engineSpool: 0.5,
      engineCharge: 0.1,
      engineClock: 3,
      engineBurst: 1,
      tireWearSeconds: 80,
    });
    resetPowertrain(state, p);
    expect(state).toMatchObject({
      coreHeat: 0,
      batteryEnergy: 105,
      thermalLimited: false,
      engineSpool: 0,
      engineCharge: 1,
      engineClock: 0,
      engineBurst: 0,
      tireWearSeconds: 0,
    });
    // The countdown holds every car in that state, so GO is the same for everyone.
    const session = createDriveSession(provingGround(), CLEAR, p);
    for (let i = 0; i < 60; i++) stepDriveSession(session, FULL);
    expect(session.phase).toBe('COUNTDOWN');
    expect(session.motion).toMatchObject({
      coreHeat: 0,
      batteryEnergy: 105,
      engineCharge: 1,
      engineClock: 0,
      engineBurst: 0,
    });
  });

  it('predicts flat-out acceleration with the same numbers the full integrator produces', () => {
    for (const template of TEMPLATES) {
      const params = paramsOf(template.blueprint);
      const r = rig(params);
      const state = createMotionState(0, 0, 0, params);
      const out = createPowertrainOutput();
      const telemetry = createTelemetry();
      let v = 0;
      for (let i = 0; i < 30 * 12; i++) {
        r.run(FULL, SIM_DT);
        v = stepStraight(state, v, params, CLEAR, 'asphalt', SIM_DT, out, telemetry);
        expect(v, `${template.id} tick ${i}`).toBeCloseTo(r.telemetry.forwardSpeed, 6);
      }
      expect(state.coreHeat).toBeCloseTo(r.state.coreHeat, 6);
      expect(state.batteryEnergy).toBeCloseTo(r.state.batteryEnergy, 6);
      expect(state.engineSpool).toBe(r.state.engineSpool);
    }
  });

  it('stays finite under random driving for every engine and wheel kit', () => {
    const rng = mulberry32(120);
    const track = buildTrack(makeProvingGround());
    for (const engine of Object.keys(CATALOG.engines)) {
      const tires = Object.keys(CATALOG.tires)[Math.floor(rng() * 20)]!;
      const params = paramsOf(baselineBlueprint({ engineId: engine, tireKitId: tires }));
      const session = createDriveSession(track, CLEAR, params);
      let input = FULL;
      for (let i = 0; i < 30 * 40; i++) {
        if (i % 15 === 0)
          input = { steer: rng() * 2 - 1, brake: rng() < 0.25 ? rng() : 0, coast: rng() < 0.05 };
        stepDriveSession(session, input);
      }
      for (const [key, value] of Object.entries(session.motion))
        if (typeof value === 'number')
          expect(Number.isFinite(value), `${engine} ${tires} ${key}`).toBe(true);
      expect(session.motion.batteryEnergy).toBeGreaterThanOrEqual(0);
      expect(session.motion.batteryEnergy).toBeLessThanOrEqual(params.power.capacity);
      expect(session.motion.coreHeat).toBeGreaterThanOrEqual(0);
      expect(session.motion.engineSpool).toBeGreaterThanOrEqual(0);
      expect(session.motion.engineSpool).toBeLessThanOrEqual(1);
      expect(session.motion.engineCharge).toBeGreaterThanOrEqual(0);
      expect(session.motion.engineCharge).toBeLessThanOrEqual(1);
    }
  });
});
