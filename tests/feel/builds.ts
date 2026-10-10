import { CATALOG, CITY_01, conditionsFor, environmentFor } from '@bolt/content';
import type {
  BuildConditions,
  RaceEnvironment,
  TrackRuntime,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  MPH_PER_WORLD_SPEED,
  SIM_DT,
  buildTrack,
  computeBuildStats,
  createDriveSession,
  createDriverScratch,
  deriveVehicleParams,
  driveCenterline,
  resolveBlueprint,
  stepDriveSession,
} from '@bolt/shared';

/**
 * Build bench: drives a blueprint round Neon Cut with the centerline driver, on the
 * authoritative session, and reduces the run to the numbers the Milestone B gate asks about
 * ("verify meaningful speed/stability differences"). Deterministic.
 *
 *   npx tsx tests/feel/buildsReport.ts
 */

export type BuildRun = {
  finished: boolean;
  raceSeconds: number;
  bestLapSeconds: number;
  /** Highest speed reached, MPH. */
  topMph: number;
  /** Seconds from GO to 60 MPH, or null. */
  zeroToSixty: number | null;
  /** Seconds from GO to the first checkpoint after the line: a launch measure. */
  launch200: number | null;
  wallStrikes: number;
  /** Largest slip angle, degrees, and the share of the race spent sliding past 8 degrees. */
  peakSlipDeg: number;
  slideShare: number;
  peakHeat: number;
  /** Seconds at or above the performance threshold. */
  hotSeconds: number;
  /** Seconds any electrical consumer was short of power. */
  lowPowerSeconds: number;
  minBattery: number;
  stability: number;
  massKg: number;
  cost: number;
};

let neonCut: TrackRuntime | null = null;
export function neonCutTrack(): TrackRuntime {
  neonCut ??= buildTrack(CITY_01);
  return neonCut;
}

export const NEON_DRY = 'city_clear_night';
export const NEON_RAIN = 'city_rain_night';

export function runBuild(blueprint: VehicleBlueprint, weatherPresetId: string): BuildRun {
  const track = neonCutTrack();
  const env = environmentFor(weatherPresetId) as RaceEnvironment;
  const conditions = conditionsFor(CITY_01.id, weatherPresetId) as BuildConditions;
  const build = resolveBlueprint(blueprint, CATALOG);
  if (!build) throw new Error(`${blueprint.name} does not resolve`);
  const params = deriveVehicleParams(build, conditions);
  const stats = computeBuildStats(blueprint, CATALOG, conditions)!;
  const session = createDriveSession(track, env, params);
  const scratch = createDriverScratch();
  const sixty = 60 / MPH_PER_WORLD_SPEED;
  const startX = session.motion.x;
  const startY = session.motion.y;
  let top = 0;
  let zeroToSixty: number | null = null;
  let launch200: number | null = null;
  let strikes = 0;
  let peakSlip = 0;
  let sliding = 0;
  let peakHeat = 0;
  let hot = 0;
  let lowPower = 0;
  let minBattery = Infinity;
  for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++) {
    stepDriveSession(session, driveCenterline(track, session.motion, params, env, scratch));
    const phase: string = session.phase;
    if (phase !== 'RACING' && phase !== 'FINISHED') continue;
    const t = session.telemetry;
    const seconds = session.raceTicks * SIM_DT;
    top = Math.max(top, t.speed);
    if (zeroToSixty === null && t.speed >= sixty) zeroToSixty = seconds;
    if (
      launch200 === null &&
      Math.hypot(session.motion.x - startX, session.motion.y - startY) >= 200
    )
      launch200 = seconds;
    if (t.wallImpactSpeed > 0) strikes++;
    const slip = (Math.abs(t.slipAngle) * 180) / Math.PI;
    peakSlip = Math.max(peakSlip, slip);
    if (slip > 8) sliding++;
    peakHeat = Math.max(peakHeat, session.motion.coreHeat);
    if (t.heatLevel >= 2) hot++;
    if (t.lowPower) lowPower++;
    minBattery = Math.min(minBattery, session.motion.batteryEnergy);
  }
  const ticks = Math.max(1, session.raceTicks);
  return {
    finished: session.progress.finishedAtMs !== null,
    raceSeconds: session.raceTicks * SIM_DT,
    bestLapSeconds: session.bestLapMs / 1000,
    topMph: top * MPH_PER_WORLD_SPEED,
    zeroToSixty,
    launch200,
    wallStrikes: strikes,
    peakSlipDeg: peakSlip,
    slideShare: sliding / ticks,
    peakHeat,
    hotSeconds: hot * SIM_DT,
    lowPowerSeconds: lowPower * SIM_DT,
    minBattery,
    stability: stats.indicators.stability.score,
    massKg: params.massKg,
    cost: stats.indicators.budget.spent,
  };
}
