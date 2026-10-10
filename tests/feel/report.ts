import { CHASSIS, DEFAULT_LOADOUT, resolveLoadout } from '@bolt/content';
import type { VehicleParams } from '@bolt/shared';
import { MPH_PER_WORLD_SPEED } from '@bolt/shared';
import {
  brakeAndTurn,
  flick,
  headingStep,
  pullBack,
  stickNoise,
  pathElasticity,
  slalom,
  slowSweep,
  stepSteer,
  topSpeed,
} from './handling.js';

/**
 * Prints the handling tables for every shipped chassis.
 *
 *   npx tsx tests/feel/report.ts
 */

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'inf').padStart(7);

export function paramsFor(chassisId: string): VehicleParams {
  const r = resolveLoadout({ ...DEFAULT_LOADOUT, chassisId });
  if (!r.ok) throw new Error(`loadout for ${chassisId} must resolve`);
  return r.params;
}

function plantReport(name: string, params: VehicleParams, full: boolean): void {
  const top = topSpeed(params);
  console.log(`\n=== ${name}: top speed ${f(top)} px/s (${(top * MPH_PER_WORLD_SPEED).toFixed(1)} MPH) ===`);
  const speeds = [40, 80, 120, 160, 200, 240, Math.floor(top)];
  const sticks = [0.25, 0.5, 0.75, 1];

  console.log('\nSteady yaw rate, deg/s (rows: speed px/s, columns: stick)');
  console.log('  speed' + sticks.map((s) => f(s, 2)).join(''));
  for (const v of speeds)
    console.log(f(v, 0) + sticks.map((s) => f(stepSteer(params, v, s).yawDeg)).join(''));

  console.log('\nFull lock step: radius px | lat accel px/s2 | t90 s | overshoot % | peak yaw accel deg/s2 | peak yaw jerk deg/s3 | slip deg (steady / peak) | speed after 3 s px/s');
  for (const v of speeds) {
    const r = stepSteer(params, v, 1);
    console.log(
      `${f(v, 0)} ${f(r.radius)} ${f(r.lateralAccel, 0)} ${f(r.t90, 2)} ${f(r.overshootPct)} ${f(r.peakYawAccel, 0)} ${f(r.peakYawJerk, 0)} ${f(r.slipDeg)} ${f(r.peakSlipDeg)} ${f(r.endSpeed)}`,
    );
  }

  console.log('\nPath elasticity to +10% stick (1.0 is proportionate; 0 or less means more stick does not tighten the path)');
  console.log('  speed' + [0.2, 0.4, 0.6, 0.8, 0.9].map((s) => f(s, 2)).join(''));
  for (const v of speeds)
    console.log(
      f(v, 0) + [0.2, 0.4, 0.6, 0.8, 0.9].map((s) => f(pathElasticity(params, v, s), 2)).join(''),
    );

  if (!full) return;
  console.log('\nSlow sweep to full lock: worst path-yaw reversal % | worst lateral accel step px/s2 per tick | peak slip deg');
  for (const v of speeds) {
    const r = slowSweep(params, v);
    console.log(`${f(v, 0)} ${f(r.worstReversalPct)} ${f(r.worstAccelStep)} ${f(r.peakSlipDeg)}`);
  }

  console.log('\nFlick (full lock 0.15 s, release): heading change deg | settle s | rebound deg/s | peak yaw deg/s');
  for (const v of speeds) {
    const r = flick(params, v);
    console.log(`${f(v, 0)} ${f(r.headingChangeDeg)} ${f(r.settle, 2)} ${f(r.reboundDeg)} ${f(r.peakYawDeg)}`);
  }

  console.log('\nSlalom 0.8 Hz at 70% stick: yaw amplitude deg/s | lag ms | peak slip deg | asymmetry %');
  for (const v of speeds) {
    const r = slalom(params, v);
    console.log(`${f(v, 0)} ${f(r.yawAmplitudeDeg)} ${f(r.lagMs, 0)} ${f(r.peakSlipDeg)} ${f(r.asymmetryPct)}`);
  }

  const bt = brakeAndTurn(params);
  console.log(
    `\nBrake and turn from top speed (80% brake, 70% stick, 1.5 s): peak slip ${f(bt.peakSlipDeg)} deg, heading change ${f(bt.headingChangeDeg)} deg, end speed ${f(bt.endSpeed)} px/s, spun ${bt.spun}`,
  );
}

function directionReport(name: string, params: VehicleParams): void {
  const top = topSpeed(params);
  console.log(`\n=== ${name}: direction steering ===`);
  console.log('Stick snaps to a new heading: t90 s | overshoot deg | settle s | steer reversals | peak yaw jerk deg/s3 | peak slip deg | min speed px/s | heading at 0.5 s');
  for (const delta of [10, 30, 60, 90, 135]) {
    console.log(`  change of ${delta} degrees`);
    for (const v of [40, 100, 160, 220, Math.floor(top)]) {
      const r = headingStep(params, v, delta);
      console.log(
        `${f(v, 0)} ${f(r.t90, 2)} ${f(r.overshootDeg, 2)} ${f(r.settle, 2)} ${f(r.reversals, 0)} ${f(r.peakYawJerk, 0)} ${f(r.peakSlipDeg)} ${f(r.minSpeed)} ${f(r.at500ms)}`,
      );
    }
  }
  console.log('\nProportion: heading covered in 0.5 s for a 20 degree and a 22 degree request (ratio should be near 1.10)');
  for (const v of [40, 100, 160, 220, Math.floor(top)]) {
    const a = headingStep(params, v, 20).at500ms;
    const b = headingStep(params, v, 22).at500ms;
    console.log(`${f(v, 0)} ${f(a, 2)} ${f(b, 2)} ${f(b / a, 3)}`);
  }
  console.log('\nTrembling thumb (stick angle +/-5 degrees at 6 Hz): heading wobble deg | steering wobble');
  for (const v of [40, 100, 160, 220, Math.floor(top)]) {
    const r = stickNoise(params, v);
    console.log(`${f(v, 0)} ${f(r.headingWobbleDeg, 2)} ${f(r.steerWobble, 2)}`);
  }
  console.log('\nPull straight back and hold: stop s | heading drift deg | rolling backwards at s | drives forward again');
  for (const v of [100, 200, Math.floor(top)]) {
    const r = pullBack(params, v);
    console.log(`${f(v, 0)} ${f(r.stopSeconds, 2)} ${f(r.headingDriftDeg, 2)} ${f(r.reverseSeconds, 2)}   ${r.recovers}`);
  }
}

if (process.argv[1]?.endsWith('report.ts')) {
  for (const chassis of Object.values(CHASSIS))
    plantReport(chassis.displayName, paramsFor(chassis.id), chassis.id === DEFAULT_LOADOUT.chassisId);
  for (const chassis of Object.values(CHASSIS)) directionReport(chassis.displayName, paramsFor(chassis.id));
}
export { directionReport, plantReport };
