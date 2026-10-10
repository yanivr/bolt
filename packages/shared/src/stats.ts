import {
  BRAKE_DECEL,
  COOLING_MULTIPLIER,
  HEAT_PROTECTION,
  HEAT_SHED_BASE,
  HEAT_SHED_SCALE,
  HEAT_WARNING,
  KINETIC_GRIP_FACTOR,
  MAX_COMBINED_GRIP,
  MAX_STEER_CURVATURE,
  MPH_PER_WORLD_SPEED,
  SIM_DT,
  SOLAR_TIME,
  SOLAR_WEATHER,
  STARTING_CREDITS,
  UNSTABLE_GRIP_LOSS,
  WET_WEATHER,
} from './balance.js';
import type { PlacedPart, ResolvedBuild } from './blueprint.js';
import { blueprintCost, buildHash, resolveBlueprint } from './blueprint.js';
import { clamp } from './math.js';
import type { PassiveTotals } from './modifiers.js';
import { aggregateModifiers, effectiveAim } from './modifiers.js';
import {
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  instability,
  stepStraight,
  surfaceGrip,
} from './physics.js';
import type { BlueprintIssue } from './validate.js';
import { validateBlueprint } from './validate.js';
import type { MassBreakdown, StabilityBreakdown } from './vehicle.js';
import {
  DEFAULT_CONDITIONS,
  computeMass,
  computeStability,
  deriveVehicleParams,
} from './vehicle.js';
import type {
  BuildConditions,
  Catalog,
  DamageTag,
  RaceEnvironment,
  SurfaceId,
  TorqueCurve,
  VehicleBlueprint,
  VehicleParams,
} from './types.js';

/**
 * The garage's numbers (Section 6.2): five engineering indicators with raw values and
 * normalized gauges, five predicted performance scores, plain-English breakdown lines for
 * the detail popovers, and warnings in approved copy. Everything is derived from the same
 * catalog data and the same integrator the race uses; nothing here is a stat a player buys.
 * Formulas are documented in docs/DECISIONS.md and docs/GARAGE_API.md.
 */

export const STATS_WARNING_COPY = {
  RUNS_HOT: 'This build runs hot. Add cooling or manage your throttle.',
  LOW_POWER: 'Not enough power for every system at once.',
  OVER_RECOMMENDED_LOAD:
    'Over the recommended load. Expect slower acceleration and longer braking.',
  OVER_MAX_LOAD: 'Too heavy for this chassis. Remove weight or swap frames.',
  UNSTABLE: 'This build is unstable. It will slide wide in fast corners.',
  OVER_BUDGET: 'Not enough credits',
} as const;
export type StatsWarningCode = keyof typeof STATS_WARNING_COPY;
export type StatsWarning = { code: StatsWarningCode; message: string };

export type GaugeStatus = 'ok' | 'caution' | 'over';

export type Indicator = {
  /** 0 to 1 for the bar. Ratios above the limit are clamped; read the raw fields for those. */
  gauge: number;
  status: GaugeStatus;
  /** Plain-English lines for the detail popover, most important first. */
  lines: string[];
};

export type BuildStats = {
  buildHash: string;
  /** True when the blueprint would be accepted for a race as it stands. */
  legal: boolean;
  issues: BlueprintIssue[];
  indicators: {
    budget: Indicator & { credits: number; spent: number; left: number };
    load: Indicator & {
      loadKg: number;
      recommendedKg: number;
      maxKg: number;
      totalMassKg: number;
      /** Where the recommended load sits on the gauge, 0 to 1. */
      recommendedMark: number;
    };
    energy: Indicator & {
      /** Peak sustained draw, power units per second. */
      drawPerSecond: number;
      generationPerSecond: number;
      batteryCapacity: number;
      burstReserve: number;
      /** Draw divided by generation. Above 1 the battery is being spent. */
      ratio: number;
      /** How long a full battery covers the shortfall, or null when there is none. */
      batterySeconds: number | null;
    };
    heat: Indicator & {
      /** Estimated sustained heat production at full throttle, heat units per second. */
      productionPerSecond: number;
      /** Cooling capacity at the performance threshold under the published weather. */
      coolingPerSecond: number;
      /** Production divided by capacity. Above 1 the car will lose power to heat. */
      ratio: number;
      /** Core heat the car settles at when held flat out. */
      equilibriumHeat: number;
    };
    stability: Indicator & StabilityBreakdown;
  };
  /** Predicted performance, whole numbers 0 to 100, for the published track and weather. */
  scores: { speed: number; control: number; defense: number; firepower: number; utility: number };
  /** The measurements behind each score, with breakdown lines. */
  details: {
    speed: {
      topSpeedMph: number;
      zeroToSixtySeconds: number | null;
      distance8s: number;
      lines: string[];
    };
    control: {
      cornerGrip: number;
      brakeDecel: number;
      yawFactor: number;
      slideGrip: number;
      lines: string[];
    };
    defense: { chassisIntegrity: number; armorHp: number; effectiveHp: number; lines: string[] };
    firepower: { activeWeapons: number; inactiveWeapons: number; threat: number; lines: string[] };
    utility: { points: number; lines: string[] };
  };
  warnings: StatsWarning[];
  mass: MassBreakdown;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number, digits = 0) => {
  const r = digits === 0 ? Math.round(v) : round1(v);
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r)}`;
};
const norm = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Reference race length, seconds, for valuing limited charges and cooldowns. */
export const STATS_RACE_SECONDS = 120;

// --- Speed -------------------------------------------------------------------------------------

export type StraightRun = {
  /** Mean speed over the last eight seconds of a 30-second run, world px/s. */
  topSpeed: number;
  /** Seconds to 60 MPH, or null when the car never gets there. */
  zeroToSixty: number | null;
  /** World pixels covered in the first eight seconds. */
  distance8s: number;
  /** Highest core heat reached. */
  peakHeat: number;
};

/** Flat out in a straight line from rest for 30 seconds, with the real powertrain. */
export function simulateStraight(
  params: VehicleParams,
  env: RaceEnvironment,
  surface: SurfaceId,
): StraightRun {
  const state = createMotionState(0, 0, 0, params);
  const out = createPowertrainOutput();
  const telemetry = createTelemetry();
  const sixty = 60 / MPH_PER_WORLD_SPEED;
  let v = 0;
  let distance = 0;
  let distance8s = 0;
  let zeroToSixty: number | null = null;
  let tail = 0;
  let tailSteps = 0;
  let peakHeat = 0;
  const steps = Math.round(30 / SIM_DT);
  const eight = Math.round(8 / SIM_DT);
  for (let i = 1; i <= steps; i++) {
    v = stepStraight(state, v, params, env, surface, SIM_DT, out, telemetry);
    distance += v * SIM_DT;
    if (i === eight) distance8s = distance;
    if (zeroToSixty === null && v >= sixty) zeroToSixty = i * SIM_DT;
    if (i > steps - eight) {
      tail += v;
      tailSteps++;
    }
    if (state.coreHeat > peakHeat) peakHeat = state.coreHeat;
  }
  return { topSpeed: tail / tailSteps, zeroToSixty, distance8s, peakHeat };
}

/** Mean output of an engine held at full throttle, as a share of rated force. */
export function meanEngineOutput(curve: TorqueCurve): number {
  let mean = 1;
  if (curve.cyclePeriodSeconds > 0) mean *= (1 + curve.cycleLowFactor) / 2;
  if (curve.pulseBurnSeconds > 0) {
    const cycle = curve.pulseBurnSeconds + curve.pulseRefillSeconds;
    mean *= (curve.pulseBurnSeconds + curve.pulseRefillSeconds * curve.pulseRestFactor) / cycle;
  } else if (curve.burstRechargeSeconds > 0) {
    mean *= 1 + ((curve.burstFactor - 1) * curve.burstSeconds) / curve.burstRechargeSeconds;
  }
  return mean;
}

function surfaceMixOf(conditions: BuildConditions): Array<[SurfaceId, number]> {
  const entries = Object.entries(conditions.surfaceMix ?? {}).filter(
    (entry): entry is [SurfaceId, number] => typeof entry[1] === 'number' && entry[1] > 0,
  );
  if (entries.length === 0) return [['asphalt', 1]];
  const total = entries.reduce((sum, [, share]) => sum + share, 0);
  return entries.map(([surface, share]) => [surface, share / total]);
}

// --- Weapons -----------------------------------------------------------------------------------

/** True when a mounted weapon will fire in a race: automatic, bound to a button, or on auto. */
export function weaponIsActive(part: PlacedPart): boolean {
  if (part.def.category !== 'weapon') return false;
  if (part.def.triggerMode === 'automatic') return true;
  return part.instance.assignedActionSlot !== undefined || part.instance.autoMode === true;
}

/** Damage one activation can do, from whichever damage fields the weapon declares. */
export function weaponDamage(params: Record<string, unknown>): number {
  return (
    num(params.bullets) * num(params.damagePerBullet) +
    num(params.pellets) * num(params.damagePerPellet) +
    num(params.damage) +
    num(params.splashDamage) * 0.5 +
    num(params.damagePerHit) * Math.max(1, num(params.phases)) +
    num(params.damageCenter) +
    num(params.damageOverTime) +
    num(params.damagePerBurst)
  );
}

/** Control effects valued in damage-equivalent points. */
export function weaponStatusValue(params: Record<string, unknown>): number {
  return (
    num(params.slowSeconds) * (num(params.slowFactor) + num(params.speedReduction)) * 20 +
    num(params.gripLossSeconds) * num(params.gripLossFactor) * 20 +
    num(params.gripSeconds) * num(params.gripReduction) * 20 +
    num(params.disableSeconds) * 12 +
    num(params.moduleDelaySeconds) * 6 +
    num(params.lateralImpulse) / 20 +
    num(params.knockbackImpulse) / 20 +
    num(params.tetherSeconds) * 4 +
    num(params.heatApplied) * 0.3
  );
}

function weaponThreat(totals: PassiveTotals, part: PlacedPart): number {
  const p = part.def.params;
  const cooldown = Math.max(1.2, num(p.cooldownSeconds));
  const aim = effectiveAim(totals, part);
  // A fixed gun only hits what is in front of it; a wider cone or a tracking mount hits more.
  const aimFactor = 0.35 + 0.65 * Math.min(1, aim.coneDegrees / 360);
  const reach = aim.range > 0 ? Math.sqrt(clamp(aim.range, 40, 350) / 220) : 0.8;
  const mode =
    part.def.triggerMode === 'automatic' ? 1 : part.instance.autoMode === true ? 0.85 : 0.95;
  const charges = num(p.charges);
  const supply = charges > 0 ? Math.min(1, (charges * cooldown) / STATS_RACE_SECONDS) : 1;
  return ((weaponDamage(p) + weaponStatusValue(p)) / cooldown) * aimFactor * reach * mode * supply;
}

// --- Defense -----------------------------------------------------------------------------------

/** How much a 100 percent cut of each damage tag is worth, in effective hit points. */
const MITIGATION_WEIGHT: Partial<Record<DamageTag, number>> = {
  direct: 90,
  bullet: 50,
  heavy: 40,
  ram: 30,
  ram_front: 20,
  ram_rear: 12,
  wheel: 35,
  engine: 30,
  burn: 20,
  heat_status: 15,
  emp_duration: 20,
  oil: 15,
  steering: 15,
  puncture: 15,
  engine_output_loss: 20,
  front: 25,
  rear: 25,
  left: 25,
  right: 25,
  rear_mounted_part: 15,
  mounted_part: 25,
};

function activeDefenseValue(params: Record<string, unknown>): number {
  let value = 0;
  if (num(params.shieldPoints) > 0 && num(params.rechargeSeconds) > 0)
    value += num(params.shieldPoints) * (STATS_RACE_SECONDS / num(params.rechargeSeconds)) * 0.3;
  value += num(params.absorbDamage);
  if (num(params.heavyHitReduction) > 0 && num(params.cooldownSeconds) > 0)
    value +=
      25 * num(params.heavyHitReduction) * (STATS_RACE_SECONDS / num(params.cooldownSeconds)) * 0.5;
  if (num(params.interceptCooldownSeconds) > 0)
    value += 20 * (STATS_RACE_SECONDS / num(params.interceptCooldownSeconds)) * 0.3;
  if (num(params.sweepCooldownSeconds) > 0)
    value += 13 * (STATS_RACE_SECONDS / num(params.sweepCooldownSeconds)) * 0.2;
  return value;
}

// --- Utility -----------------------------------------------------------------------------------

function utilityPoints(part: PlacedPart, solarShare: number, hasTurret: boolean): number {
  let points = 0;
  for (const mod of part.def.modifiers) {
    if (mod.type === 'ModifyCooling') points += mod.add;
    else if (mod.type === 'ModifyEnergyGeneration')
      points += mod.add * 0.8 * (mod.condition === 'solar' ? solarShare : 1);
    else if (mod.type === 'ModifyEnergyCapacity') points += mod.add * 0.1;
    else if (mod.type === 'ModifySteeringResponse')
      points += (mod.stability ?? 0) * 0.5 + (mod.corneringGrip ?? 0) * 120;
    else if (mod.type === 'ModifyPowerPriority' && mod.effect) {
      points +=
        (mod.effect.cooling ?? 0) +
        (mod.effect.stability ?? 0) * 0.5 +
        (mod.effect.slipRecovery ?? 0) * 50 +
        (mod.effect.downforce ?? 0) * 80;
    }
  }
  const p = part.def.params;
  points += num(p.restoreIntegrity) * 0.25;
  points += num(p.wheels) * 10;
  points += num(p.bursts) * num(p.burstSeconds) * Math.max(0, num(p.forceFactor) - 1) * 5;
  if (num(p.boostSeconds) > 0 && num(p.cooldownSeconds) > 0)
    points +=
      num(p.boostSeconds) *
      Math.max(0, num(p.torqueFactor) - 1) *
      (STATS_RACE_SECONDS / num(p.cooldownSeconds));
  if (num(p.trackingRangeFactor) > 1) points += 5;
  points += (num(p.warningDistance) / 120) * 5;
  points += num(p.decoys) * 4;
  if (num(p.hopSeconds) > 0 && num(p.cooldownSeconds) > 0)
    points += (STATS_RACE_SECONDS / num(p.cooldownSeconds)) * 0.6;
  if (num(p.pullDistance) > 0) points += 5;
  if (num(p.acquisitionSpeedFactor) > 1)
    points += hasTurret ? (num(p.acquisitionSpeedFactor) - 1) * 20 : 1;
  return points;
}

// --- The whole report ---------------------------------------------------------------------------

/**
 * Computes every garage number for a blueprint under the published conditions. Returns null
 * only when the chassis, engine or wheel kit is not in the catalog. Drafts that are not
 * legal yet still get full stats, with `legal` false and the issues listed.
 */
export function computeBuildStats(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  conditions: BuildConditions = DEFAULT_CONDITIONS,
): BuildStats | null {
  const build = resolveBlueprint(blueprint, catalog);
  if (!build) return null;
  return computeResolvedStats(build, catalog, conditions);
}

export function computeResolvedStats(
  build: ResolvedBuild,
  catalog: Catalog,
  conditions: BuildConditions = DEFAULT_CONDITIONS,
): BuildStats {
  const { blueprint, chassis, engine, tires } = build;
  const validation = validateBlueprint(blueprint, catalog);
  const totals = aggregateModifiers(build);
  const mass = computeMass(build, totals);
  const stability = computeStability(build, totals, mass);
  const params = deriveVehicleParams(build, conditions, totals);
  const env: RaceEnvironment = {
    weather: conditions.weather,
    wetness: WET_WEATHER[conditions.weather] ? 1 : 0,
  };
  const mix = surfaceMixOf(conditions);
  const warnings: StatsWarning[] = [];
  const warn = (code: StatsWarningCode) =>
    warnings.push({ code, message: STATS_WARNING_COPY[code] });

  // --- Budget ------------------------------------------------------------------------------
  const cost = blueprintCost(blueprint, catalog);
  const left = STARTING_CREDITS - cost.total;
  if (left < 0) warn('OVER_BUDGET');
  const budget = {
    credits: STARTING_CREDITS,
    spent: cost.total,
    left,
    gauge: clamp(cost.total / STARTING_CREDITS, 0, 1),
    status: (left < 0 ? 'over' : 'ok') as GaugeStatus,
    lines: [
      `${chassis.displayName} ${cost.chassis}, ${engine.displayName} ${cost.engine}, ${tires.displayName} ${cost.tires} for ${chassis.wheelCount} wheels.`,
      `${build.parts.length} installed ${build.parts.length === 1 ? 'part' : 'parts'}: ${cost.parts}.`,
      `${cost.total} of ${STARTING_CREDITS} credits spent, ${left} left.`,
    ],
  };

  // --- Load --------------------------------------------------------------------------------
  const overMax = mass.loadKg > mass.maxKg;
  const overRecommended = mass.loadKg > mass.recommendedKg;
  if (overMax) warn('OVER_MAX_LOAD');
  else if (overRecommended) warn('OVER_RECOMMENDED_LOAD');
  const loadLines = [
    `${round1(mass.loadKg)} kg installed on a frame that recommends ${mass.recommendedKg} kg and allows ${mass.maxKg} kg.`,
    `With the ${chassis.massKg} kg frame the car weighs ${round1(mass.totalKg)} kg.`,
  ];
  if (overRecommended && !overMax)
    loadLines.push(
      `Over the recommended load: ${pct(0.18 * mass.overload)} less acceleration, ${pct(0.25 * mass.overload)} less braking, ${pct(0.12 * mass.overload)} more engine heat.`,
    );
  const load = {
    loadKg: mass.loadKg,
    recommendedKg: mass.recommendedKg,
    maxKg: mass.maxKg,
    totalMassKg: mass.totalKg,
    recommendedMark: mass.recommendedKg / mass.maxKg,
    gauge: clamp(mass.loadKg / mass.maxKg, 0, 1),
    status: (overMax ? 'over' : overRecommended ? 'caution' : 'ok') as GaugeStatus,
    lines: loadLines,
  };

  // --- Energy ------------------------------------------------------------------------------
  const activeWeapons = build.parts.filter(weaponIsActive);
  const inactiveWeapons = build.parts.filter(
    (p) => p.def.category === 'weapon' && !weaponIsActive(p),
  );
  let weaponDraw = 0;
  let weaponHeat = 0;
  for (const part of activeWeapons) {
    const cooldown = Math.max(1.2, num(part.def.params.cooldownSeconds));
    weaponDraw += num(part.def.params.energyPerShot) / cooldown;
    weaponHeat += num(part.def.params.heatPerShot) / cooldown;
  }
  let reactiveDraw = 0;
  for (const part of build.parts)
    if (
      num(part.def.params.energyPerIntercept) > 0 &&
      num(part.def.params.interceptCooldownSeconds) > 0
    )
      reactiveDraw +=
        num(part.def.params.energyPerIntercept) / num(part.def.params.interceptCooldownSeconds);
  const continuous = params.power.consumers.reduce((sum, c) => sum + c.draw, 0);
  const drawPerSecond = params.power.drivetrainDraw + continuous + weaponDraw + reactiveDraw;
  const generationPerSecond = params.power.generation;
  const energyRatio =
    generationPerSecond > 0 ? drawPerSecond / generationPerSecond : drawPerSecond > 0 ? 99 : 0;
  const shortfall = drawPerSecond - generationPerSecond;
  const batterySeconds = shortfall > 1e-9 ? params.power.capacity / shortfall : null;
  if (energyRatio > 1 + 1e-9) warn('LOW_POWER');
  const energyLines = [
    `Draws up to ${round1(drawPerSecond)} power a second: drivetrain ${round1(params.power.drivetrainDraw)}, systems ${round1(continuous)}, weapons at full rate ${round1(weaponDraw + reactiveDraw)}.`,
    `Generates ${round1(generationPerSecond)} a second under this weather. The battery stores ${params.power.capacity}.`,
  ];
  if (batterySeconds !== null)
    energyLines.push(
      `Flat out with everything running, a full battery lasts ${round1(batterySeconds)} seconds. After that the lowest-priority systems throttle first and the drivetrain keeps at least 55% of its output.`,
    );
  if (params.power.offThrottleGeneration > 0)
    energyLines.push(
      `Recovers ${params.power.offThrottleGeneration} more a second whenever you lift.`,
    );
  if (totals.burstReserve > 0)
    energyLines.push(`Holds ${totals.burstReserve} in reserve for weapon bursts.`);
  const energy = {
    drawPerSecond,
    generationPerSecond,
    batteryCapacity: params.power.capacity,
    burstReserve: totals.burstReserve,
    ratio: energyRatio,
    batterySeconds,
    gauge: clamp(energyRatio / 2, 0, 1),
    status: (energyRatio > 1.5 ? 'over' : energyRatio > 1 + 1e-9 ? 'caution' : 'ok') as GaugeStatus,
    lines: energyLines,
  };

  // --- Heat --------------------------------------------------------------------------------
  const heat = params.heat;
  const duty = meanEngineOutput(totals.curve);
  const engineHeat = heat.enginePerSecond * (heat.idleFraction + (1 - heat.idleFraction) * duty);
  const productionPerSecond = engineHeat + heat.constantPerSecond + weaponHeat;
  let poweredCooling = 0;
  for (const consumer of params.power.consumers) poweredCooling += consumer.effect.cooling ?? 0;
  const weatherCooling = (heat.cooling + poweredCooling) * COOLING_MULTIPLIER[conditions.weather];
  const coolingPerSecond =
    weatherCooling * (HEAT_SHED_BASE + heat.performanceThreshold / HEAT_SHED_SCALE);
  const heatRatio = coolingPerSecond > 0 ? productionPerSecond / coolingPerSecond : 99;
  const equilibriumHeat = Math.max(
    0,
    HEAT_SHED_SCALE * (productionPerSecond / Math.max(1e-6, weatherCooling) - HEAT_SHED_BASE),
  );
  if (heatRatio > 1 + 1e-9) warn('RUNS_HOT');
  const heatLines = [
    `Makes about ${round1(productionPerSecond)} heat a second flat out: engine ${round1(engineHeat)}, other systems ${round1(heat.constantPerSecond + weaponHeat)}.`,
    `Can shed ${round1(coolingPerSecond)} a second at the ${Math.round(heat.performanceThreshold)}-point limit in this weather (cooling x${COOLING_MULTIPLIER[conditions.weather]}).`,
    `Held flat out it settles near ${Math.round(equilibriumHeat)}. Warning at ${HEAT_WARNING}, power loss from ${Math.round(heat.performanceThreshold)}, protection at ${HEAT_PROTECTION}.`,
  ];
  if (heatRatio > 1 + 1e-9)
    heatLines.push(
      'Above the limit the engine gives up to 35% of its power until it cools. Lifting in corners buys time.',
    );
  const heatIndicator = {
    productionPerSecond,
    coolingPerSecond,
    ratio: heatRatio,
    equilibriumHeat,
    gauge: clamp(heatRatio / 2, 0, 1),
    status: (heatRatio > 1.25 ? 'over' : heatRatio > 1 + 1e-9 ? 'caution' : 'ok') as GaugeStatus,
    lines: heatLines,
  };

  // --- Stability ---------------------------------------------------------------------------
  const unstable = stability.score < stability.threshold;
  if (unstable) warn('UNSTABLE');
  const stabilityIndicator = {
    ...stability,
    gauge: stability.score / 100,
    status: (unstable ? 'caution' : 'ok') as GaugeStatus,
    lines: [
      `Stability ${stability.score} of 100. Handling suffers below ${stability.threshold} on this chassis.`,
      `Wheelbase ${round1(stability.wheelbase)} px and track ${round1(stability.trackWidth)} px: ${signed(-(stability.wheelbasePenalty - stability.longitudinalPenalty), 1)}.`,
      `Weight ${round1(Math.abs(mass.comX))} px off centre: ${signed(-stability.lateralWeightPenalty, 1)}. Fore and aft balance: ${signed(-stability.longitudinalPenalty, 1)}.`,
      `Tall and roof-mounted parts: ${signed(-stability.highCenterPenalty, 1)}.`,
      `Chassis, tires and stabilisers: ${signed(stability.stabilizationBonus + stability.powered, 1)}${stability.powered > 0 ? `, of which ${signed(stability.powered, 1)} needs power` : ''}.`,
    ],
  };

  // --- Speed score -------------------------------------------------------------------------
  let topSpeed = 0;
  let distance8s = 0;
  let sixty: number | null = 0;
  for (const [surface, share] of mix) {
    const run = simulateStraight(params, env, surface);
    topSpeed += run.topSpeed * share;
    distance8s += run.distance8s * share;
    if (sixty !== null) sixty = run.zeroToSixty === null ? null : sixty + run.zeroToSixty * share;
  }
  const speedScore = Math.round(
    100 * (0.5 * norm(topSpeed, 170, 370) + 0.5 * norm(distance8s, 600, 1500)),
  );
  const speedLines = [
    `Top speed about ${Math.round(topSpeed * MPH_PER_WORLD_SPEED)} MPH on this track's surfaces.`,
    sixty === null
      ? 'Does not reach 60 MPH on these surfaces.'
      : `0 to 60 MPH in about ${round1(sixty)} seconds.`,
    `Engine force ${Math.round(totals.curve.forceIndex)} pushing ${round1(mass.totalKg)} kg.`,
  ];

  // --- Control score -----------------------------------------------------------------------
  const lost = instability(params, stability.powered);
  let cornerGrip = 0;
  for (const [surface, share] of mix)
    cornerGrip +=
      share *
      Math.min(MAX_COMBINED_GRIP, surfaceGrip(params, env, surface, false)) *
      params.peakGripFactor *
      (1 - UNSTABLE_GRIP_LOSS * lost) *
      (1 + params.corneringGrip * 0.5);
  let slipAdd = 0;
  for (const consumer of params.power.consumers) slipAdd += consumer.effect.slipRecovery ?? 0;
  const slideGrip = Math.min(1, KINETIC_GRIP_FACTOR * params.slipRecovery * (1 + slipAdd));
  const yawFactor = params.maxSteerCurvature / MAX_STEER_CURVATURE;
  const controlScore = Math.round(
    100 *
      (0.5 * norm(cornerGrip, 0.35, 1.3) +
        0.2 * (stability.score / 100) +
        0.15 * norm(params.brakeDecel / BRAKE_DECEL, 0.6, 1.1) +
        0.1 * norm(yawFactor, 0.8, 1.1) +
        0.05 * norm(slideGrip, 0.7, 1)),
  );
  const controlLines = [
    `Cornering grip ${round1(cornerGrip * 100)}% of street tires on dry asphalt, for this weather and surface mix.`,
    `Braking ${pct(params.brakeDecel / BRAKE_DECEL)} and steering response ${pct(yawFactor)} of the default car.`,
    `Keeps ${pct(slideGrip)} of its grip in a slide. Stability ${stability.score}.`,
  ];

  // --- Defense score -----------------------------------------------------------------------
  const chassisIntegrity = chassis.baseIntegrity * totals.integrity.chassis;
  const armorHp =
    (totals.armor.front + totals.armor.rear + totals.armor.left + totals.armor.right) *
    totals.integrity.armor;
  let mitigation = 0;
  for (const tag of Object.keys(totals.damage) as DamageTag[])
    mitigation += (1 - (totals.damage[tag] ?? 1)) * (MITIGATION_WEIGHT[tag] ?? 10);
  mitigation += (totals.integrity.wheels - 1) * 40 + (totals.integrity.engine - 1) * 30;
  mitigation += (1 - totals.impulse.displacement) * 30;
  let reactive = 0;
  for (const part of build.parts)
    if (part.def.category === 'defense') reactive += activeDefenseValue(part.def.params);
  const effectiveHp = chassisIntegrity + armorHp + mitigation + reactive;
  const defenseScore = Math.round(100 * norm(effectiveHp, 70, 420));
  const defenseLines = [
    `Chassis integrity ${Math.round(chassisIntegrity)}. Armor: front ${Math.round(totals.armor.front)}, rear ${Math.round(totals.armor.rear)}, left ${Math.round(totals.armor.left)}, right ${Math.round(totals.armor.right)}.`,
    `Damage reductions are worth about ${Math.round(mitigation)} more hit points, shields and reactive parts about ${Math.round(reactive)}.`,
  ];

  // --- Firepower score ---------------------------------------------------------------------
  let threat = 0;
  for (const part of activeWeapons) threat += weaponThreat(totals, part);
  const firepowerScore = Math.round(100 * (1 - Math.exp(-threat / 12)));
  const firepowerLines = [
    activeWeapons.length === 0
      ? 'No active weapons.'
      : `${activeWeapons.length} active ${activeWeapons.length === 1 ? 'weapon' : 'weapons'}: ${activeWeapons.map((p) => p.def.displayName).join(', ')}.`,
    'Scored from damage and control effects per second, how wide each weapon can aim, its reach and its charges.',
  ];
  if (inactiveWeapons.length > 0)
    firepowerLines.push(
      `${inactiveWeapons.length} inactive: ${inactiveWeapons.map((p) => p.def.displayName).join(', ')}. Give ${inactiveWeapons.length === 1 ? 'it' : 'them'} a fire button to count.`,
    );

  // --- Utility score -----------------------------------------------------------------------
  const solarShare = SOLAR_TIME[conditions.timeOfDay] * SOLAR_WEATHER[conditions.weather];
  const hasTurret = build.parts.some((p) => num(p.def.params.turnRateDegPerSecond) > 0);
  let points = 0;
  const utilityNames: string[] = [];
  for (const part of build.parts) {
    if (part.def.category !== 'utility') continue;
    points += utilityPoints(part, solarShare, hasTurret);
    utilityNames.push(part.def.displayName);
  }
  const utilityScore = Math.round(100 * (1 - Math.exp(-points / 25)));
  const utilityLines = [
    utilityNames.length === 0
      ? 'No utility systems.'
      : `Utility systems: ${utilityNames.join(', ')}.`,
    'Scored from repairs carried, cooling and power added, handling aids, boosts and sensors.',
  ];

  return {
    buildHash: buildHash(blueprint),
    legal: validation.ok,
    issues: validation.issues,
    indicators: { budget, load, energy, heat: heatIndicator, stability: stabilityIndicator },
    scores: {
      speed: speedScore,
      control: controlScore,
      defense: defenseScore,
      firepower: firepowerScore,
      utility: utilityScore,
    },
    details: {
      speed: {
        topSpeedMph: topSpeed * MPH_PER_WORLD_SPEED,
        zeroToSixtySeconds: sixty,
        distance8s,
        lines: speedLines,
      },
      control: {
        cornerGrip,
        brakeDecel: params.brakeDecel,
        yawFactor,
        slideGrip,
        lines: controlLines,
      },
      defense: { chassisIntegrity, armorHp, effectiveHp, lines: defenseLines },
      firepower: {
        activeWeapons: activeWeapons.length,
        inactiveWeapons: inactiveWeapons.length,
        threat,
        lines: firepowerLines,
      },
      utility: { points, lines: utilityLines },
    },
    warnings,
    mass,
  };
}

// --- Predictive deltas --------------------------------------------------------------------------

export type StatDelta = {
  before: number;
  after: number;
  delta: number;
  /** True when the change helps, false when it hurts, null when it is neutral or zero. */
  better: boolean | null;
};

function delta(before: number, after: number, higherIsBetter: boolean | null): StatDelta {
  const d = after - before;
  return {
    before,
    after,
    delta: d,
    better: higherIsBetter === null || Math.abs(d) < 1e-9 ? null : d > 0 === higherIsBetter,
  };
}

export type BuildStatsDelta = {
  scores: Record<keyof BuildStats['scores'], StatDelta>;
  indicators: {
    creditsLeft: StatDelta;
    loadKg: StatDelta;
    energyRatio: StatDelta;
    heatRatio: StatDelta;
    stability: StatDelta;
  };
  /** Warnings the change introduces and warnings it clears. */
  newWarnings: StatsWarning[];
  clearedWarnings: StatsWarning[];
  becomesLegal: boolean;
  becomesIllegal: boolean;
};

/**
 * What a change would do, for the preview shown before the player commits to it
 * (Section 6.2: "show changed deltas before installing a part"). Compute stats for the
 * current blueprint and for the result of the edit, then compare.
 */
export function compareBuildStats(before: BuildStats, after: BuildStats): BuildStatsDelta {
  const had = new Set(before.warnings.map((w) => w.code));
  const has = new Set(after.warnings.map((w) => w.code));
  return {
    scores: {
      speed: delta(before.scores.speed, after.scores.speed, true),
      control: delta(before.scores.control, after.scores.control, true),
      defense: delta(before.scores.defense, after.scores.defense, true),
      firepower: delta(before.scores.firepower, after.scores.firepower, true),
      utility: delta(before.scores.utility, after.scores.utility, true),
    },
    indicators: {
      creditsLeft: delta(before.indicators.budget.left, after.indicators.budget.left, true),
      loadKg: delta(before.indicators.load.loadKg, after.indicators.load.loadKg, false),
      energyRatio: delta(before.indicators.energy.ratio, after.indicators.energy.ratio, false),
      heatRatio: delta(before.indicators.heat.ratio, after.indicators.heat.ratio, false),
      stability: delta(before.indicators.stability.score, after.indicators.stability.score, true),
    },
    newWarnings: after.warnings.filter((w) => !had.has(w.code)),
    clearedWarnings: before.warnings.filter((w) => !has.has(w.code)),
    becomesLegal: !before.legal && after.legal,
    becomesIllegal: before.legal && !after.legal,
  };
}
