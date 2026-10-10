import { rotationArc, mountArc } from './blueprint.js';
import type { PlacedPart, ResolvedBuild } from './blueprint.js';
import { SURFACE_IDS } from './types.js';
import type {
  CarArc,
  DamageTag,
  MountCategory,
  PartModifier,
  PoweredEffect,
  SurfaceId,
  TorqueCurve,
} from './types.js';

/**
 * Folds a car's passive primitives (Section 11.8) into totals. This is the only place the
 * meaning of each primitive is defined; `deriveVehicleParams` and `computeBuildStats` read
 * the totals and never look at a part id.
 */

export const NEUTRAL_CURVE: TorqueCurve = Object.freeze({
  forceIndex: 0,
  launchBoost: 0,
  launchFadeSpeed: 70,
  topEndFactor: 1,
  taperStartFactor: 1,
  tractionFactor: 1,
  spoolUpSeconds: 0,
  spoolDownSeconds: 1,
  spoolFloor: 1,
  spoolTopEndFactor: 1,
  cyclePeriodSeconds: 0,
  cycleLowFactor: 1,
  pulseBurnSeconds: 0,
  pulseRefillSeconds: 1,
  pulseRestFactor: 1,
  burstRechargeSeconds: 0,
  burstSeconds: 0,
  burstFactor: 1,
  roadSpeedFactor: 1,
  looseRollingFactor: 1,
  looseTractionFactor: 1,
});

export type SurfaceFactors = Record<SurfaceId, number>;

function ones(): SurfaceFactors {
  const out = {} as SurfaceFactors;
  for (const s of SURFACE_IDS) out[s] = 1;
  return out;
}
function zeros(): SurfaceFactors {
  const out = {} as SurfaceFactors;
  for (const s of SURFACE_IDS) out[s] = 0;
  return out;
}

export type PowerConsumer = {
  /** Part that draws the power, for breakdown lines. */
  sourceId: string;
  draw: number;
  priority: number;
  drivetrain: boolean;
  effect: PoweredEffect;
};

export type PassiveTotals = {
  massKg: number;
  curve: TorqueCurve;
  drag: number;
  /** Grip multipliers that apply always, only in the dry and only in the wet. */
  grip: SurfaceFactors;
  gripDry: SurfaceFactors;
  gripWet: SurfaceFactors;
  slip: { factor: number; stiffness: number; align: number };
  heat: {
    engine: number;
    constant: number;
    factor: number;
    partialLoadFactor: number;
    toleranceOffset: number;
    /** Null until a part states one; combustion engines then use the shared default. */
    idleFraction: number | null;
  };
  cooling: number;
  generation: { always: number; solar: number; offThrottle: number };
  capacity: number;
  /** Energy held back for per-shot consumers (Burst Capacitor). Not part of the battery. */
  burstReserve: number;
  consumers: PowerConsumer[];
  armor: Record<CarArc, number>;
  integrity: { chassis: number; wheels: number; engine: number; armor: number };
  damage: Partial<Record<DamageTag, number>>;
  impulse: { obstacle: number; ram_dealt: number; displacement: number };
  steering: {
    yaw: number;
    turnRadius: number;
    stability: number;
    peakGrip: number;
    corneringGrip: number;
    braking: number;
    topSpeed: number;
    roadSpeed: number;
    shoulderPenalty: number;
    wearStartSeconds: number;
    wearRampSeconds: number;
    wornGrip: number;
    rollingAdd: SurfaceFactors;
    rollingFactor: SurfaceFactors;
    width: number;
  };
  hardpoints: Array<{ category: MountCategory; count: number }>;
  aimArcs: Array<{ mounts: MountCategory[]; addDegrees: number; rangeFactor: number }>;
};

export function emptyTotals(): PassiveTotals {
  return {
    massKg: 0,
    curve: { ...NEUTRAL_CURVE },
    drag: 1,
    grip: ones(),
    gripDry: ones(),
    gripWet: ones(),
    slip: { factor: 1, stiffness: 1, align: 1 },
    heat: {
      engine: 0,
      constant: 0,
      factor: 1,
      partialLoadFactor: 1,
      toleranceOffset: 0,
      idleFraction: null,
    },
    cooling: 0,
    generation: { always: 0, solar: 0, offThrottle: 0 },
    capacity: 0,
    burstReserve: 0,
    consumers: [],
    armor: { front: 0, rear: 0, left: 0, right: 0 },
    integrity: { chassis: 1, wheels: 1, engine: 1, armor: 1 },
    damage: {},
    impulse: { obstacle: 1, ram_dealt: 1, displacement: 1 },
    steering: {
      yaw: 1,
      turnRadius: 1,
      stability: 0,
      peakGrip: 1,
      corneringGrip: 0,
      braking: 1,
      topSpeed: 1,
      roadSpeed: 1,
      shoulderPenalty: 1,
      wearStartSeconds: 0,
      wearRampSeconds: 0,
      wornGrip: 1,
      rollingAdd: zeros(),
      rollingFactor: ones(),
      width: 1,
    },
    hardpoints: [],
    aimArcs: [],
  };
}

export type ModifierContext = {
  sourceId: string;
  /** Multiplier on mass (a wheel kit is listed for four wheels). */
  massScale?: number;
  /** Arc a mounted armor part protects. */
  arc?: CarArc;
};

/** Curve fields that add when scaled would make no sense; everything else multiplies. */
const CURVE_REPLACE: ReadonlyArray<keyof TorqueCurve> = [
  'launchFadeSpeed',
  'spoolUpSeconds',
  'spoolDownSeconds',
  'spoolFloor',
  'cyclePeriodSeconds',
  'cycleLowFactor',
  'pulseBurnSeconds',
  'pulseRefillSeconds',
  'pulseRestFactor',
  'burstRechargeSeconds',
  'burstSeconds',
  'burstFactor',
];

export function applyModifier(
  totals: PassiveTotals,
  mod: PartModifier,
  ctx: ModifierContext,
): void {
  switch (mod.type) {
    case 'AddMass':
      totals.massKg += mod.kg * (ctx.massScale ?? 1);
      return;
    case 'ModifyTorqueCurve': {
      if (mod.set) totals.curve = { ...mod.set };
      if (mod.scale) {
        for (const key of Object.keys(mod.scale) as Array<keyof TorqueCurve>) {
          const value = mod.scale[key];
          if (value === undefined) continue;
          if (CURVE_REPLACE.includes(key)) totals.curve[key] = value;
          else totals.curve[key] *= value;
        }
      }
      return;
    }
    case 'ModifyDrag':
      totals.drag *= mod.factor;
      return;
    case 'ModifyGripBySurface': {
      const table =
        mod.when === 'wet' ? totals.gripWet : mod.when === 'dry' ? totals.gripDry : totals.grip;
      for (const surface of mod.surfaces ?? SURFACE_IDS) table[surface] *= mod.factor;
      return;
    }
    case 'ModifySlipRecovery':
      totals.slip.factor *= mod.factor ?? 1;
      totals.slip.stiffness *= mod.stiffness ?? 1;
      totals.slip.align *= mod.align ?? 1;
      return;
    case 'ModifyHeatGeneration':
      totals.heat.engine += mod.add ?? 0;
      totals.heat.constant += mod.constant ?? 0;
      totals.heat.factor *= mod.factor ?? 1;
      totals.heat.partialLoadFactor *= mod.partialLoadFactor ?? 1;
      totals.heat.toleranceOffset += mod.toleranceOffset ?? 0;
      if (mod.idleFraction !== undefined) totals.heat.idleFraction = mod.idleFraction;
      return;
    case 'ModifyCooling':
      totals.cooling += mod.add;
      return;
    case 'ModifyEnergyGeneration':
      if (mod.condition === 'solar') totals.generation.solar += mod.add;
      else if (mod.condition === 'off_throttle') totals.generation.offThrottle += mod.add;
      else totals.generation.always += mod.add;
      return;
    case 'ModifyEnergyCapacity':
      if (mod.reserve === true) totals.burstReserve += mod.add;
      else totals.capacity += mod.add;
      return;
    case 'ModifyPowerPriority':
      totals.consumers.push({
        sourceId: ctx.sourceId,
        draw: mod.draw,
        priority: mod.priority,
        drivetrain: mod.drivetrain === true,
        effect: mod.effect ?? {},
      });
      return;
    case 'AddArmorArc': {
      const arcs = mod.arcs === 'mounted' ? [ctx.arc ?? 'front'] : mod.arcs;
      for (const arc of arcs) totals.armor[arc] += mod.hp;
      return;
    }
    case 'ModifyIntegrity':
      totals.integrity[mod.target] *= mod.factor;
      return;
    case 'ModifyDamageByTag':
      totals.damage[mod.tag] = (totals.damage[mod.tag] ?? 1) * mod.factor;
      return;
    case 'ModifyImpulse':
      totals.impulse[mod.kind] *= mod.factor;
      return;
    case 'ModifySteeringResponse': {
      const s = totals.steering;
      s.yaw *= mod.yaw ?? 1;
      s.turnRadius *= mod.turnRadius ?? 1;
      s.stability += mod.stability ?? 0;
      s.peakGrip *= mod.peakGrip ?? 1;
      s.corneringGrip += mod.corneringGrip ?? 0;
      s.braking *= mod.braking ?? 1;
      s.topSpeed *= mod.topSpeed ?? 1;
      s.roadSpeed *= mod.roadSpeed ?? 1;
      s.shoulderPenalty *= mod.shoulderPenalty ?? 1;
      s.width *= mod.width ?? 1;
      if (mod.wearRampSeconds !== undefined && mod.wearRampSeconds > 0) {
        s.wearStartSeconds = mod.wearStartSeconds ?? 0;
        s.wearRampSeconds = mod.wearRampSeconds;
        s.wornGrip = mod.wornGrip ?? 1;
      }
      for (const surface of mod.rollingSurfaces ?? []) {
        s.rollingAdd[surface] += mod.rollingAdd ?? 0;
        s.rollingFactor[surface] *= mod.rollingFactor ?? 1;
      }
      return;
    }
    case 'AddHardpoint':
      totals.hardpoints.push({ category: mod.category, count: mod.count });
      return;
    case 'OverrideAimingArc':
      totals.aimArcs.push({
        mounts: mod.mounts,
        addDegrees: mod.addDegrees ?? 0,
        rangeFactor: mod.rangeFactor ?? 1,
      });
      return;
  }
}

/** The arc a mounted part faces: its rotation when it can turn, else where its mount sits. */
export function partArc(part: PlacedPart): CarArc {
  return part.def.rotatable
    ? rotationArc(part.instance.rotationQuarterTurns)
    : mountArc(part.mount);
}

/** Totals for a whole car: chassis, engine, wheel kit scaled to the wheel count, and parts. */
export function aggregateModifiers(build: ResolvedBuild): PassiveTotals {
  const totals = emptyTotals();
  for (const mod of build.chassis.modifiers)
    applyModifier(totals, mod, { sourceId: build.chassis.id });
  for (const mod of build.engine.modifiers)
    applyModifier(totals, mod, { sourceId: build.engine.id });
  for (const mod of build.tires.modifiers)
    applyModifier(totals, mod, {
      sourceId: build.tires.id,
      massScale: build.chassis.wheelCount / 4,
    });
  for (const part of build.parts)
    for (const mod of part.def.modifiers)
      applyModifier(totals, mod, { sourceId: part.def.id, arc: partArc(part) });
  // Served in priority order; ties keep the order parts were listed in (stable sort).
  totals.consumers.sort((a, b) => a.priority - b.priority);
  return totals;
}

/**
 * Aim cone and range of a mounted weapon after chassis overrides (Crab side mounts, Scorpion
 * rear mounts). Milestone C fires weapons with these numbers; the Firepower score uses them.
 */
export function effectiveAim(
  totals: PassiveTotals,
  part: PlacedPart,
): { coneDegrees: number; range: number } {
  const cone = typeof part.def.params.coneDegrees === 'number' ? part.def.params.coneDegrees : 0;
  const range = typeof part.def.params.range === 'number' ? part.def.params.range : 0;
  let add = 0;
  let factor = 1;
  for (const override of totals.aimArcs) {
    if (!override.mounts.some((c) => part.mount.categories.includes(c))) continue;
    add += override.addDegrees;
    factor *= override.rangeFactor;
  }
  return { coneDegrees: cone > 0 ? Math.min(360, cone + add) : 0, range: range * factor };
}
