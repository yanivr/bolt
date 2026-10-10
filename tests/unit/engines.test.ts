import { ENGINES, ENGINE_LIST, baselineBlueprint } from '@bolt/content';
import {
  HEAT_PERFORMANCE,
  SIM_DT,
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  driveForceAt,
  meanEngineOutput,
  stepPowertrain,
  stepStraight,
} from '@bolt/shared';
import type { VehicleParams } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { CLEAR, COAST, FULL, LIFT, rig, sprint, statsOf, withEngine } from '../helpers/rig.js';

/**
 * Section 11.3: twenty engines, each of which must drive differently in the way its
 * "Character" column says. Every measurement is taken on the real integrator, with the same
 * Beetle and Street Tires around the engine.
 */

const params = (id: string) => withEngine(id);
/**
 * Character is measured with heat taken out of the picture (unlimited cooling), so a hot
 * engine is judged on its curve and not on the stock Beetle's radiator. What heat does to
 * each engine on stock cooling is measured separately, in `hot`.
 */
const cooled = (p: VehicleParams): VehicleParams => ({ ...p, heat: { ...p.heat, cooling: 1000 } });
const runs = new Map(ENGINE_LIST.map((engine) => [engine.id, sprint(cooled(params(engine.id)))]));
const run = (id: string) => runs.get(id)!;
const hotRuns = new Map(ENGINE_LIST.map((engine) => [engine.id, sprint(params(engine.id))]));
const hot = (id: string) => hotRuns.get(id)!;

/** Engine output over time at full throttle, sampled every tick, with no car attached. */
function outputTrace(
  p: VehicleParams,
  seconds: number,
  throttle: (t: number) => number = () => 1,
): number[] {
  const state = createMotionState(0, 0, 0, p);
  const out = createPowertrainOutput();
  const telemetry = createTelemetry();
  const trace: number[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    // A large airflow speed and no heat build-up to speak of: this isolates engine character.
    state.coreHeat = 0;
    stepPowertrain(state, throttle(i * SIM_DT), 250, p, CLEAR, SIM_DT, out, telemetry);
    trace.push(out.output);
  }
  return trace;
}

describe('every engine has its own measured profile', () => {
  it('gives twenty engines twenty different acceleration and top-speed profiles', () => {
    const list = ENGINE_LIST.map((e) => ({ id: e.id, ...run(e.id) }));
    for (const a of list) {
      expect(a.toSixty, a.id).not.toBeNull();
      expect(a.topMph, a.id).toBeGreaterThan(55);
      expect(a.topMph, a.id).toBeLessThan(125);
      for (const b of list) {
        if (a.id >= b.id) continue;
        // At least two percent apart in launch, mid-range or top speed.
        const apart = Math.max(
          Math.abs(a.distance2s / b.distance2s - 1),
          Math.abs(a.distance8s / b.distance8s - 1),
          Math.abs(a.topMph / b.topMph - 1),
        );
        expect(apart, `${a.id} against ${b.id}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('is replay-safe: the same inputs give bit-identical state for every engine', () => {
    for (const engine of ENGINE_LIST) {
      const a = rig(params(engine.id));
      const b = rig(params(engine.id));
      const script = (r: ReturnType<typeof rig>) => {
        r.run(FULL, 5);
        r.run(LIFT, 1.5);
        r.run({ steer: 0.4, brake: 0, coast: false }, 4);
        r.run(COAST, 2);
        r.run(FULL, 6);
      };
      script(a);
      script(b);
      expect(a.state, engine.id).toEqual(b.state);
      for (const value of Object.values(a.state))
        if (typeof value === 'number') expect(Number.isFinite(value), engine.id).toBe(true);
    }
  });

  it('keeps the default car on its Section 6.5 targets', () => {
    const baseline = run('engine_four_cylinder');
    expect(baseline.toSixty!).toBeGreaterThan(3.5);
    expect(baseline.toSixty!).toBeLessThan(4.5);
    expect(baseline.topMph).toBeGreaterThan(70);
    expect(baseline.topMph).toBeLessThan(95);
    // It never gets hot enough to matter on a clear day, so stock cooling changes nothing.
    expect(hot('engine_four_cylinder').peakHeat).toBeLessThan(60);
    expect(hot('engine_four_cylinder').topMph).toBe(baseline.topMph);
    expect(hot('engine_four_cylinder').toSixty).toBe(baseline.toSixty);
  });
});

describe('engine character (Section 11.3)', () => {
  it('Mini Electric: quiet and light, the weakest pull, and it draws 5 power a second', () => {
    const p = params('engine_mini_electric');
    expect(p.power.drivetrainDraw).toBe(5);
    expect(p.heat.idleFraction).toBe(0);
    expect(run('engine_mini_electric').topMph).toBe(
      Math.min(...ENGINE_LIST.map((e) => run(e.id).topMph)),
    );
    expect(run('engine_mini_electric').distance8s).toBe(
      Math.min(...ENGINE_LIST.map((e) => run(e.id).distance8s)),
    );
    // Light: the lightest car on the bench, so it still leaves the line smartly for its power.
    expect(p.massKg).toBe(Math.min(...ENGINE_LIST.map((e) => params(e.id).massKg)));
    // Base generation of 10 covers its draw: the battery never empties.
    const r = rig(p);
    r.run(FULL, 30);
    expect(r.state.batteryEnergy).toBe(p.power.capacity);
    expect(r.telemetry.lowPower).toBe(false);
    expect(r.state.coreHeat).toBeLessThan(20);
    expect(hot('engine_mini_electric').peakHeat).toBe(
      Math.min(...ENGINE_LIST.map((e) => hot(e.id).peakHeat)),
    );
  });

  it('Four-Cylinder: the reliable all-rounder, with no special behaviour at all', () => {
    const p = params('engine_four_cylinder');
    expect(meanEngineOutput(ENGINES.engine_four_cylinder!.curve)).toBe(1);
    const trace = outputTrace(p, 20);
    expect(Math.min(...trace)).toBe(1);
    expect(Math.max(...trace)).toBe(1);
    expect(p.power.drivetrainDraw).toBe(0);
  });

  it('V6: stronger acceleration than the Four-Cylinder everywhere', () => {
    expect(run('engine_v6').toSixty!).toBeLessThan(run('engine_four_cylinder').toSixty! - 0.4);
    expect(run('engine_v6').distance2s).toBeGreaterThan(run('engine_four_cylinder').distance2s);
    expect(run('engine_v6').topMph).toBeGreaterThan(run('engine_four_cylinder').topMph + 3);
  });

  it('V8: heavy, with the hardest launch of the ordinary piston engines', () => {
    const piston = [
      'engine_four_cylinder',
      'engine_v6',
      'engine_v8',
      'engine_v12',
      'engine_supercharger',
    ];
    expect(run('engine_v8').distance2s).toBe(Math.max(...piston.map((id) => run(id).distance2s)));
    expect(run('engine_v8').toSixty!).toBeLessThan(run('engine_v6').toSixty!);
    expect(ENGINES.engine_v8!.massKg).toBeGreaterThan(ENGINES.engine_v6!.massKg + 30);
  });

  it('V12: the highest top speed of any engine with steady output', () => {
    const steady = ENGINE_LIST.filter(
      (e) => meanEngineOutput(e.curve) === 1 && e.curve.spoolUpSeconds === 0,
    );
    expect(steady.length).toBeGreaterThan(8);
    expect(run('engine_v12').topMph).toBe(Math.max(...steady.map((e) => run(e.id).topMph)));
    expect(run('engine_v12').topMph).toBeGreaterThan(run('engine_v8').topMph + 5);
    // Tall gearing: off the line the V8 is still the quicker car.
    expect(run('engine_v12').distance2s).toBeLessThan(run('engine_v8').distance2s);
    expect(ENGINES.engine_v12!.price).toBe(Math.max(...ENGINE_LIST.map((e) => e.price)));
  });

  it('Small Turbo: boost builds in about half a second and gives a quick burst', () => {
    const p = params('engine_small_turbo');
    const trace = outputTrace(p, 2);
    expect(trace[0]!).toBeCloseTo(0.8 + 0.2 * (SIM_DT / 0.6), 6);
    const full = trace.findIndex((v) => v >= 1) * SIM_DT;
    expect(full).toBeGreaterThan(0.5);
    expect(full).toBeLessThan(0.7);
    // A burst from a rolling 30 MPH, its own spool-up included, beats the Four-Cylinder by
    // more than a tenth.
    const rolling = (id: string) => {
      const r = rig(params(id));
      r.state.velocityX = -96;
      r.run(FULL, 1.5);
      return r.telemetry.speed - 96;
    };
    expect(rolling('engine_small_turbo')).toBeGreaterThan(rolling('engine_four_cylinder') * 1.1);
    expect(run('engine_small_turbo').toSixty!).toBeLessThan(
      run('engine_four_cylinder').toSixty! - 0.4,
    );
    expect(ENGINES.engine_small_turbo!.heatPerSecond).toBeGreaterThan(
      ENGINES.engine_v6!.heatPerSecond,
    );
  });

  it('Twin Turbo: big sustained power, a second of lag after a lift, and very hot', () => {
    const p = params('engine_twin_turbo');
    // Spooled, lift for one second, back on the throttle: output has fallen and climbs back.
    const trace = outputTrace(p, 6, (t) => (t >= 2 && t < 3 ? 0 : 1));
    expect(trace[Math.round(1.9 / SIM_DT)]!).toBe(1);
    const after = trace[Math.round(3 / SIM_DT)]!;
    expect(after).toBeLessThan(0.75);
    expect(after).toBeGreaterThanOrEqual(0.7);
    const recovered = trace.findIndex((v, i) => i > 3 / SIM_DT && v >= 1) * SIM_DT - 3;
    expect(recovered).toBeGreaterThan(0.9);
    expect(recovered).toBeLessThan(1.3);
    // Bare, it overheats: the hottest steady engine on stock cooling.
    expect(
      statsOf(baselineBlueprint({ engineId: 'engine_twin_turbo' })).indicators.heat.ratio,
    ).toBeGreaterThan(1.5);
    expect(hot('engine_twin_turbo').peakHeat).toBeGreaterThan(HEAT_PERFORMANCE);
    // With cooling to match it is one of the fastest engines there is; on stock cooling the
    // heat takes most of that back.
    expect(run('engine_twin_turbo').topMph).toBeGreaterThan(run('engine_v8').topMph);
    expect(hot('engine_twin_turbo').topMph).toBeLessThan(run('engine_twin_turbo').topMph - 8);
  });

  it('Supercharger: the same pull from rest to high speed, with no lag, for extra drag', () => {
    const blown = params('engine_supercharger');
    const v8 = params('engine_v8');
    expect(Math.min(...outputTrace(blown, 3))).toBe(1);
    // Force at speed, as a share of force at rest: flatter than the V8's curve.
    const flatness = (p: VehicleParams) => driveForceAt(p, 215) / driveForceAt(p, 0);
    expect(flatness(blown)).toBeGreaterThan(flatness(v8) + 0.15);
    expect(flatness(blown)).toBeGreaterThan(0.8);
    expect(blown.dragQuadratic / v8.dragQuadratic).toBeCloseTo(1.06, 6);
    expect(blown.dragLinear / v8.dragLinear).toBeCloseTo(1.06, 6);
  });

  it('Torque Diesel: strongest recovery from low speed, and a low rev ceiling', () => {
    // From a near stop (after a hit or a hairpin) back to 45 MPH.
    const recovery = (id: string) => {
      const r = rig(params(id));
      r.state.velocityX = -25;
      let t = 0;
      r.run(FULL, 8, (self) => {
        if (t === 0 && self.telemetry.speed >= 144) t = self.time();
      });
      return t;
    };
    expect(recovery('engine_diesel')).toBeLessThan(recovery('engine_v6'));
    expect(recovery('engine_diesel')).toBeLessThan(recovery('engine_supercharger'));
    // Lower max RPM: slower at the top than the weaker Four-Cylinder.
    expect(run('engine_diesel').topMph).toBeLessThan(run('engine_four_cylinder').topMph);
    expect(params('engine_diesel').forceZeroSpeed).toBeLessThan(
      params('engine_four_cylinder').forceZeroSpeed * 0.85,
    );
  });

  it('Sport Electric: the fastest launch of the steady engines, at 14 power a second', () => {
    const steady = ENGINE_LIST.filter((e) => meanEngineOutput(e.curve) === 1);
    expect(run('engine_electric_sport').toThirty!).toBe(
      Math.min(...steady.map((e) => run(e.id).toThirty!)),
    );
    const p = params('engine_electric_sport');
    expect(p.power.drivetrainDraw).toBe(14);
    // Generation is 10: the 40-unit battery lasts ten seconds flat out, then the motor fades
    // to what generation alone supplies, never below the protected 55 percent.
    const r = rig(p);
    r.run(FULL, 9.5);
    expect(r.state.batteryEnergy).toBeGreaterThan(0);
    expect(r.telemetry.powerFraction).toBe(1);
    r.run(FULL, 1.5);
    expect(r.state.batteryEnergy).toBe(0);
    expect(r.telemetry.lowPower).toBe(true);
    expect(r.telemetry.drivetrainSupply).toBeCloseTo(10 / 14, 6);
    expect(r.telemetry.powerFraction).toBeCloseTo(10 / 14, 6);
    // Lifting recharges it.
    r.run(COAST, 4);
    expect(r.state.batteryEnergy).toBeGreaterThan(8);
  });

  it('Eco Electric: efficient, drawing 6 a second that base generation covers', () => {
    const p = params('engine_electric_eco');
    expect(p.power.drivetrainDraw).toBe(6);
    const r = rig(p);
    r.run(FULL, 24);
    expect(r.state.batteryEnergy).toBe(p.power.capacity);
    expect(r.telemetry.powerFraction).toBe(1);
    expect(
      statsOf(baselineBlueprint({ engineId: 'engine_electric_eco' })).indicators.energy.ratio,
    ).toBeCloseTo(0.6, 6);
    // Cool: second only to the Mini Electric.
    expect(hot('engine_electric_eco').peakHeat).toBeLessThan(
      hot('engine_four_cylinder').peakHeat / 2,
    );
    expect(run('engine_electric_eco').topMph).toBeLessThan(run('engine_four_cylinder').topMph);
  });

  it('Hybrid: cooler at part throttle, and it recharges when you lift', () => {
    const p = params('engine_hybrid');
    expect(p.power.generation).toBe(12);
    expect(p.power.offThrottleGeneration).toBe(6);
    const heatAt = (brake: number) => {
      const r = rig(p);
      r.run({ steer: 0, brake, coast: false }, 2);
      return {
        made: r.telemetry.heatProduction,
        throttle: r.state.throttleFraction,
        gen: r.telemetry.generation,
      };
    };
    const flat = heatAt(0);
    const part = heatAt(0.3);
    expect(part.throttle).toBeGreaterThan(0.3);
    expect(part.throttle).toBeLessThan(0.7);
    // The same throttle on an engine without the partial-load saving would make this much:
    const plain = 9 * (0.2 + 0.8 * part.throttle);
    expect(part.made).toBeCloseTo(plain * 0.55, 6);
    expect(flat.made).toBeCloseTo(9, 6);
    expect(flat.gen).toBe(12);
    // Bonus regeneration off the throttle.
    const lifted = rig(p);
    lifted.run(FULL, 3);
    lifted.run({ steer: 0, brake: 0.6, coast: false }, 0.5);
    expect(lifted.telemetry.generation).toBe(18);
  });

  it('Rotary: light and quick to rev, and it loses power to heat sooner', () => {
    const rotary = params('engine_rotary');
    expect(rotary.heat.performanceThreshold).toBe(HEAT_PERFORMANCE - 15);
    expect(ENGINES.engine_rotary!.massKg).toBeLessThan(ENGINES.engine_four_cylinder!.massKg);
    const outputAtHeat = (p: VehicleParams, heat: number) => {
      const state = createMotionState(0, 0, 0, p);
      state.coreHeat = heat;
      const out = createPowertrainOutput();
      stepPowertrain(state, 1, 250, p, CLEAR, SIM_DT, out, createTelemetry());
      return out.output;
    };
    // At 85 heat a Four-Cylinder is untouched; the Rotary has already given up power.
    expect(outputAtHeat(params('engine_four_cylinder'), 85)).toBe(1);
    expect(outputAtHeat(rotary, 85)).toBeCloseTo(1 - 0.35 * (10 / 35), 6);
    expect(outputAtHeat(rotary, 74)).toBe(1);
    // Kept cool it revs past a V6. On stock cooling the same engine is slower than one.
    expect(run('engine_rotary').topMph).toBeGreaterThan(run('engine_v6').topMph);
    expect(hot('engine_rotary').topMph).toBeLessThan(hot('engine_v6').topMph);
  });

  it('Turbine: low initial pull, then a high top speed once it has wound up', () => {
    const p = params('engine_turbine');
    const trace = outputTrace(p, 5);
    expect(trace[0]!).toBeLessThan(0.52);
    expect(trace[Math.round(1.75 / SIM_DT)]!).toBeCloseTo(0.75, 1);
    const wound = trace.findIndex((v) => v >= 1) * SIM_DT;
    expect(wound).toBeGreaterThan(3.3);
    expect(wound).toBeLessThan(3.7);
    // 146 force index, yet slower over the first two seconds than a Four-Cylinder...
    expect(run('engine_turbine').distance2s).toBeLessThan(run('engine_four_cylinder').distance2s);
    // ...and faster at the top than the Supercharger and the V8, which make more force.
    expect(run('engine_turbine').topMph).toBeGreaterThan(run('engine_v8').topMph);
    expect(run('engine_turbine').topMph).toBeGreaterThan(run('engine_supercharger').topMph);
    // It winds down when you lift.
    const lifted = outputTrace(p, 8, (t) => (t >= 4 && t < 6.5 ? 0 : 1));
    expect(lifted[Math.round(6.5 / SIM_DT)]!).toBeLessThan(0.55);
  });

  it('Rocket Engine: huge bursts, limited by fuel pulses', () => {
    const p = params('engine_rocket');
    const trace = outputTrace(p, 24);
    const burning = trace.filter((v) => v === 1).length * SIM_DT;
    const resting = trace.filter((v) => v < 0.31).length * SIM_DT;
    // 2.6 seconds on, 3.4 seconds refilling at 30 percent: four cycles in 24 seconds.
    expect(burning).toBeCloseTo(4 * 2.6, 0);
    expect(resting).toBeCloseTo(24 - 4 * 2.6, 0);
    expect(trace[0]!).toBe(1);
    expect(trace[Math.round(2.5 / SIM_DT)]!).toBe(1);
    expect(trace[Math.round(2.8 / SIM_DT)]!).toBeCloseTo(0.3, 6);
    expect(trace[Math.round(5.9 / SIM_DT)]!).toBeCloseTo(0.3, 6);
    expect(trace[Math.round(6.2 / SIM_DT)]!).toBe(1);
    // The hardest shove of any engine while it burns.
    expect(run('engine_rocket').peakAccel).toBe(
      Math.max(...ENGINE_LIST.map((e) => run(e.id).peakAccel)),
    );
    // "Controlled": lifting during a burn saves the fuel that is left and tops it up.
    const state = createMotionState(0, 0, 0, p);
    const out = createPowertrainOutput();
    const telemetry = createTelemetry();
    const step = (throttle: number, seconds: number) => {
      for (let i = 0; i < Math.round(seconds / SIM_DT); i++)
        stepPowertrain(state, throttle, 200, p, CLEAR, SIM_DT, out, telemetry);
    };
    step(1, 1.3);
    expect(state.engineCharge).toBeCloseTo(0.5, 1);
    step(0, 1.7);
    expect(state.engineCharge).toBeCloseTo(1, 1);
    step(1, 2.4);
    expect(out.output).toBe(1);
    expect(meanEngineOutput(ENGINES.engine_rocket!.curve)).toBeCloseTo((2.6 + 3.4 * 0.3) / 6, 9);
  });

  it('Twin Drive: puts its power down where a single engine spins it away', () => {
    const twin = params('engine_twin');
    const v8 = params('engine_v8');
    expect(twin.tractionAccel / v8.tractionAccel).toBeCloseTo(1.3, 6);
    // On ice both are traction-limited, and the Twin Drive leaves 30 percent harder.
    const launch = (p: VehicleParams) => {
      let v = 0;
      const state = createMotionState(0, 0, 0, p);
      const out = createPowertrainOutput();
      const telemetry = createTelemetry();
      for (let i = 0; i < 30; i++)
        v = stepStraight(state, v, p, CLEAR, 'ice', SIM_DT, out, telemetry);
      return v;
    };
    expect(launch(twin) / launch(v8)).toBeGreaterThan(1.25);
    expect(sprint(twin, CLEAR, 'ice').distance8s).toBeGreaterThan(
      sprint(v8, CLEAR, 'ice').distance8s * 1.1,
    );
    expect(ENGINES.engine_twin!.massKg).toBe(Math.max(...ENGINE_LIST.map((e) => e.massKg)));
  });

  it('Spring Drive: stores one launch burst every 12 seconds', () => {
    const p = params('engine_spring');
    const trace = outputTrace(p, 30);
    const boosted = trace.map((v) => v > 1.45);
    const starts = boosted
      .map((b, i) => (b && !boosted[i - 1] ? i * SIM_DT : -1))
      .filter((t) => t >= 0);
    // One at the start, then one each time 12 seconds of recharge follow a 1.4-second burst.
    expect(starts).toHaveLength(3);
    expect(starts[0]!).toBe(0);
    expect(starts[1]! - starts[0]!).toBeCloseTo(13.4, 1);
    expect(starts[2]! - starts[1]!).toBeCloseTo(13.4, 1);
    expect(boosted.filter(Boolean).length * SIM_DT).toBeCloseTo(3 * 1.4, 0);
    expect(Math.max(...trace)).toBeCloseTo(1.5, 6);
    // The burst waits for full throttle: braking through a corner keeps it for the exit.
    const held = outputTrace(p, 20, (t) => (t < 1.5 || t > 16 ? 1 : 0.4));
    expect(held[Math.round(14 / SIM_DT)]!).toBe(1);
    expect(held[Math.round(16.2 / SIM_DT)]!).toBeCloseTo(1.5, 6);
    // Same force index as the Ironheart, 70 kg lighter and with a burst: clearly quicker away.
    expect(run('engine_spring').distance2s).toBeGreaterThan(
      run('engine_resilient').distance2s * 1.2,
    );
  });

  it('Trail Engine: keeps its pull on loose ground and gives up top speed on the road', () => {
    const trail = params('engine_offroad');
    const v6 = params('engine_v6');
    expect(trail.roadSpeedFactor).toBeCloseTo(0.93, 9);
    expect(trail.looseRollingFactor).toBeCloseTo(0.55, 9);
    // On the road the V6, with a little more force, is the faster car.
    expect(run('engine_offroad').topMph).toBeLessThan(run('engine_v6').topMph - 4);
    // On every loose surface the Trail Engine is.
    for (const surface of ['sand', 'dirt', 'mud', 'snow'] as const) {
      const a = sprint(trail, CLEAR, surface);
      const b = sprint(v6, CLEAR, surface);
      expect(a.topMph, surface).toBeGreaterThan(b.topMph);
      expect(a.distance8s, surface).toBeGreaterThan(b.distance8s * 0.99);
    }
    expect(sprint(trail, CLEAR, 'mud').topMph).toBeGreaterThan(
      sprint(v6, CLEAR, 'mud').topMph * 1.08,
    );
  });

  it('Ironheart: loses half as much output to damage', () => {
    const iron = statsOf(baselineBlueprint({ engineId: 'engine_resilient' }));
    const plain = statsOf(baselineBlueprint({ engineId: 'engine_four_cylinder' }));
    expect(ENGINES.engine_resilient!.modifiers).toContainEqual({
      type: 'ModifyDamageByTag',
      tag: 'engine_output_loss',
      factor: 0.5,
    });
    expect(ENGINES.engine_resilient!.modifiers).toContainEqual({
      type: 'ModifyIntegrity',
      target: 'engine',
      factor: 1.25,
    });
    // The toughness shows in the Defense score today; the damage model reads the tag in Milestone C.
    expect(iron.scores.defense).toBeGreaterThan(plain.scores.defense);
    expect(iron.details.defense.effectiveHp - plain.details.defense.effectiveHp).toBeCloseTo(
      0.5 * 20 + 0.25 * 30,
      6,
    );
    // It pays for it in weight.
    expect(run('engine_resilient').toSixty!).toBeGreaterThan(
      run('engine_four_cylinder').toSixty! - 0.5,
    );
    expect(ENGINES.engine_resilient!.massKg).toBeGreaterThan(ENGINES.engine_spring!.massKg + 60);
  });

  it('Wildcard Motor: output pulses in a repeatable 4-second cycle', () => {
    const p = params('engine_experimental');
    const trace = outputTrace(p, 16);
    expect(Math.max(...trace)).toBeCloseTo(1, 3);
    expect(Math.min(...trace)).toBeCloseTo(0.55, 3);
    const period = Math.round(4 / SIM_DT);
    // Exactly periodic, and the trough is half a period after the peak.
    for (let i = 0; i + period < trace.length; i++)
      expect(trace[i + period]!).toBeCloseTo(trace[i]!, 9);
    const peak = trace.indexOf(Math.max(...trace.slice(0, period + 1)));
    const trough = trace.indexOf(Math.min(...trace.slice(0, period + 1)));
    expect(Math.abs(Math.abs(trough - peak) - period / 2)).toBeLessThanOrEqual(1);
    // The cycle is tied to race time, not to the throttle: lifting does not reset it.
    const lifted = outputTrace(p, 16, (t) => (t > 5 && t < 6 ? 0 : 1));
    expect(lifted[Math.round(10 / SIM_DT)]!).toBeCloseTo(trace[Math.round(10 / SIM_DT)]!, 9);
    expect(meanEngineOutput(ENGINES.engine_experimental!.curve)).toBeCloseTo(0.775, 9);
    // And the car's speed breathes with it.
    const r = rig(p);
    const speeds: number[] = [];
    r.run(FULL, 24, (self) => speeds.push(self.telemetry.speed));
    const late = speeds.slice(-period);
    expect(Math.max(...late) - Math.min(...late)).toBeGreaterThan(4);
  });
});
