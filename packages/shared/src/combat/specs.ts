import { SIM_DT, WEAPON_COOLDOWN_FLOOR_SECONDS } from '../balance.js';
import type { PlacedPart, ResolvedBuild } from '../blueprint.js';
import type { PassiveTotals } from '../modifiers.js';
import { effectiveAim } from '../modifiers.js';
import type { PartParams, QuarterTurn, TriggerMode } from '../types.js';

/**
 * Turns a mounted part's catalog `params` into the numbers the simulation runs on (Section
 * 11.8: standardized primitives with validated per-part parameters). This is the only place
 * a `behaviorId` is read. Every number a part's behaviour needs comes from its `params`; a
 * missing one is an error here, at race creation, never a silent default in the hot loop.
 */

/** The primitive a part's active behaviour is built on. `passive` parts act through modifiers only. */
export type ModuleKind =
  // Weapons
  | 'burst'
  | 'spread'
  | 'hitscan'
  | 'rocket'
  | 'homing'
  | 'mine'
  | 'strip'
  | 'puddle'
  | 'pulse'
  | 'arc'
  | 'flame'
  | 'frost'
  | 'melee'
  | 'contact'
  | 'tether'
  | 'blast'
  | 'boomerang'
  | 'mortar'
  // Reactive defenses
  | 'shield'
  | 'breakaway'
  | 'reactive'
  | 'intercept'
  | 'sweep'
  // Utilities
  | 'spare'
  | 'repair'
  | 'nitro'
  | 'boost'
  | 'decoy'
  | 'hop'
  | 'winch'
  | 'capacitor'
  | 'radar'
  | 'minesensor'
  | 'targeting'
  | 'passive';

/** Which catalog behaviour is built on which primitive. Three guns share `burst` and differ in how they aim. */
export const BEHAVIOR_KIND: Readonly<Record<string, ModuleKind>> = {
  bullet_burst: 'burst',
  sentry_burst: 'burst',
  turret_burst: 'burst',
  pellet_spread: 'spread',
  charged_shot: 'hitscan',
  straight_rocket: 'rocket',
  guided_missile: 'homing',
  drop_mine: 'mine',
  oil_strip: 'strip',
  foam_puddle: 'puddle',
  emp_pulse: 'pulse',
  tesla_arc: 'arc',
  flame_cone: 'flame',
  frost_shot: 'frost',
  hammer_swing: 'melee',
  contact_saw: 'contact',
  tether_pull: 'tether',
  air_blast: 'blast',
  boomerang: 'boomerang',
  mortar_burst: 'mortar',
  energy_shield: 'shield',
  breakaway_absorb: 'breakaway',
  reactive_foam: 'reactive',
  missile_intercept: 'intercept',
  trap_sweep: 'sweep',
  replace_wheel: 'spare',
  repair_component: 'repair',
  nitro_burst: 'nitro',
  torque_boost: 'boost',
  missile_decoy: 'decoy',
  short_hop: 'hop',
  winch_pull: 'winch',
  burst_reserve: 'capacitor',
  rival_tracking: 'radar',
  mine_warning: 'minesensor',
  turret_assist: 'targeting',
};

/** How a weapon points. */
export type AimMode =
  /** Along its mounted facing, wherever that is. */
  | 'fixed'
  /** Along its facing, nudged onto a target that is inside its cone. */
  | 'assist'
  /** A turret: turns at a limited rate toward its target, all the way round. */
  | 'track'
  /** No direction: it acts around the car or picks a spot. */
  | 'none';

export type ModuleSpec = {
  /** Index into the car's parts, in canonical blueprint order. */
  part: number;
  id: string;
  category: 'weapon' | 'defense' | 'utility';
  kind: ModuleKind;
  trigger: TriggerMode;
  /** Fire button, or -1. */
  slot: number;
  /** True when the part fires by itself: an automatic, or a hybrid left on auto. */
  auto: boolean;
  /** Bit in the `use` input for a manual utility, or -1. */
  useBit: number;
  aim: AimMode;
  /** Quarter turns from the car's nose to the part's facing. */
  turn: QuarterTurn;
  /** Part centre in chassis-local pixels (x right, y toward the rear). */
  lx: number;
  ly: number;
  /** Distance from the part centre to its muzzle along its facing. */
  muzzle: number;
  cooldownTicks: number;
  /** Uses per match; 0 means limited only by cooldown, energy and heat. */
  charges: number;
  energy: number;
  heat: number;
  range: number;
  minRange: number;
  /** Half-angle of the aim or acquisition cone, radians. PI is all round. */
  half: number;
  lineOfSight: boolean;
  /** Ticks between the trigger and the effect: charge, wind-up, action time. */
  windupTicks: number;
  /** Ticks a hybrid needs its target in view before it holds a lock. */
  lockTicks: number;
  count: number;
  intervalTicks: number;
  damage: number;
  damageEdge: number;
  penetration: number;
  speed: number;
  /** Full spread angle, radians. */
  spread: number;
  radius: number;
  lifeTicks: number;
  splashDamage: number;
  splashRadius: number;
  falloffStart: number;
  falloffMin: number;
  /** Turn rate, radians per tick: a turret's traverse, a missile's steering, a boomerang's return. */
  turnRate: number;
  /** A turret holds its lock while its aim is within this of the target, radians. */
  tolerance: number;
  statusMagnitude: number;
  statusTicks: number;
  hazardRadius: number;
  hazardHalfLength: number;
  hazardLifeTicks: number;
  armTicks: number;
  triggerRadius: number;
  liveCap: number;
  dropDistance: number;
  /** Ticks a sustained effect lasts once started. */
  activeTicks: number;
  heatApplied: number;
  lingerTicks: number;
  impulse: number;
  pullAccel: number;
  selfShare: number;
  breakDistance: number;
  flightTicks: number;
  lead: number;
  catchRadius: number;
  refundTicks: number;
  warnTicks: number;
  wetFactor: number;
  projectileImpulse: number;
  /** Points: shield strength, breakaway pool, capacitor reserve, integrity restored. */
  points: number;
  /** A fraction: reactive reduction, wheel-swap acceleration penalty, boost force factor - 1. */
  factor: number;
  threshold: number;
  flagA: boolean;
};

function blank(part: number, placed: PlacedPart): ModuleSpec {
  return {
    part,
    id: placed.def.id,
    category: placed.def.category,
    kind: 'passive',
    trigger: placed.def.triggerMode,
    slot: -1,
    auto: false,
    useBit: -1,
    aim: 'none',
    turn: placed.instance.rotationQuarterTurns,
    lx: placed.x,
    ly: placed.y,
    muzzle: 0,
    cooldownTicks: 0,
    charges: 0,
    energy: 0,
    heat: 0,
    range: 0,
    minRange: 0,
    half: Math.PI,
    lineOfSight: false,
    windupTicks: 0,
    lockTicks: 0,
    count: 1,
    intervalTicks: 0,
    damage: 0,
    damageEdge: 0,
    penetration: 0,
    speed: 0,
    spread: 0,
    radius: 0,
    lifeTicks: 0,
    splashDamage: 0,
    splashRadius: 0,
    falloffStart: 0,
    falloffMin: 1,
    turnRate: 0,
    tolerance: 0,
    statusMagnitude: 0,
    statusTicks: 0,
    hazardRadius: 0,
    hazardHalfLength: 0,
    hazardLifeTicks: 0,
    armTicks: 0,
    triggerRadius: 0,
    liveCap: 0,
    dropDistance: 0,
    activeTicks: 0,
    heatApplied: 0,
    lingerTicks: 0,
    impulse: 0,
    pullAccel: 0,
    selfShare: 0,
    breakDistance: 0,
    flightTicks: 0,
    lead: 0,
    catchRadius: 0,
    refundTicks: 0,
    warnTicks: 0,
    wetFactor: 1,
    projectileImpulse: 0,
    points: 0,
    factor: 0,
    threshold: 0,
    flagA: false,
  };
}

/** Seconds to whole simulation ticks, never fewer than one for a positive time. */
export function ticksOf(seconds: number): number {
  return seconds > 0 ? Math.max(1, Math.round(seconds / SIM_DT)) : 0;
}

const DEG = Math.PI / 180;

class ParamReader {
  constructor(
    private readonly id: string,
    private readonly params: PartParams,
  ) {}
  num(key: string): number {
    const value = this.params[key];
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(`${this.id}: params.${key} must be a number`);
    return value;
  }
  opt(key: string, fallback: number): number {
    const value = this.params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
  flag(key: string): boolean {
    return this.params[key] === true;
  }
  ticks(key: string): number {
    return ticksOf(this.num(key));
  }
}

/**
 * Compiles one mounted part. `useBit` is assigned by the caller, which knows the order of the
 * car's manual utilities.
 */
export function compileModule(totals: PassiveTotals, placed: PlacedPart, part: number): ModuleSpec {
  const def = placed.def;
  const spec = blank(part, placed);
  const p = new ParamReader(def.id, def.params);
  spec.kind = BEHAVIOR_KIND[def.behaviorId] ?? 'passive';

  if (def.category === 'weapon') {
    if (spec.kind === 'passive') throw new Error(`${def.id}: unknown behaviour ${def.behaviorId}`);
    const aim = effectiveAim(totals, placed);
    spec.range = aim.range;
    spec.half = aim.coneDegrees >= 360 ? Math.PI : (aim.coneDegrees * DEG) / 2;
    spec.slot = placed.instance.assignedActionSlot ?? -1;
    spec.auto =
      def.triggerMode === 'automatic' ||
      (def.triggerMode === 'hybrid' && placed.instance.autoMode === true);
    spec.charges = p.num('charges');
    spec.energy = p.num('energyPerShot');
    spec.heat = p.num('heatPerShot');
    const cooldown = p.num('cooldownSeconds');
    spec.cooldownTicks = ticksOf(
      def.triggerMode === 'automatic'
        ? cooldown
        : Math.max(WEAPON_COOLDOWN_FLOOR_SECONDS, cooldown),
    );
    spec.muzzle = def.facing === 'none' ? 0 : def.footprint.h / 2;
    spec.aim = def.facing === 'none' ? 'none' : 'fixed';
  }

  switch (spec.kind) {
    case 'burst': {
      spec.count = p.num('bullets');
      spec.damage = p.opt('damagePerBullet', p.opt('damage', 0) / spec.count);
      spec.intervalTicks =
        spec.count > 1
          ? Math.max(1, Math.round(p.num('burstSeconds') / (spec.count - 1) / SIM_DT))
          : 0;
      spec.speed = p.num('projectileSpeed');
      spec.spread = p.num('spreadDegrees') * DEG;
      spec.radius = p.num('projectileRadius');
      spec.lifeTicks = Math.ceil(spec.range / spec.speed / SIM_DT);
      spec.falloffStart = p.num('falloffStart');
      spec.falloffMin = p.num('falloffMinFactor');
      spec.lineOfSight = true;
      spec.windupTicks = ticksOf(p.opt('acquireSeconds', 0));
      const traverse = p.opt('turnRateDegPerSecond', 0);
      if (traverse > 0) {
        spec.aim = 'track';
        spec.turnRate = traverse * DEG * SIM_DT;
        spec.tolerance = p.num('lockToleranceDegrees') * DEG;
      } else if (p.flag('aimAssist') || def.triggerMode !== 'manual') {
        spec.aim = 'assist';
      }
      break;
    }
    case 'spread':
      spec.count = p.num('pellets');
      spec.damage = p.num('damagePerPellet');
      spec.speed = p.num('projectileSpeed');
      spec.spread = p.num('spreadDegrees') * DEG;
      spec.radius = p.num('projectileRadius');
      spec.falloffStart = p.num('falloffStart');
      spec.falloffMin = p.num('falloffMinFactor');
      spec.lifeTicks = Math.ceil(spec.range / spec.speed / SIM_DT);
      break;
    case 'hitscan':
      spec.damage = p.num('damage');
      spec.penetration = p.num('penetration');
      spec.windupTicks = p.ticks('chargeSeconds');
      spec.radius = p.num('beamRadius');
      spec.lineOfSight = true;
      spec.aim = 'assist';
      break;
    case 'rocket':
      spec.damage = p.num('damage');
      spec.splashDamage = p.num('splashDamage');
      spec.splashRadius = p.num('splashRadius');
      spec.speed = p.num('projectileSpeed');
      spec.radius = p.num('projectileRadius');
      spec.lifeTicks = p.ticks('lifeSeconds');
      break;
    case 'homing':
      spec.damage = p.num('damage');
      spec.speed = p.num('projectileSpeed');
      spec.turnRate = p.num('turnRateDegPerSecond') * DEG * SIM_DT;
      spec.radius = p.num('projectileRadius');
      spec.lifeTicks = p.ticks('lifeSeconds');
      spec.lockTicks = p.ticks('lockSeconds');
      spec.warnTicks = p.ticks('lockWarningSeconds');
      spec.lineOfSight = true;
      break;
    case 'mine':
      spec.damage = p.num('damage');
      spec.statusMagnitude = p.num('slowFactor');
      spec.statusTicks = p.ticks('slowSeconds');
      spec.liveCap = p.num('liveCap');
      spec.armTicks = p.ticks('armSeconds');
      spec.triggerRadius = p.num('triggerRadius');
      spec.splashRadius = p.num('blastRadius');
      spec.dropDistance = p.num('dropDistance');
      spec.hazardLifeTicks = p.ticks('lifeSeconds');
      spec.hazardRadius = spec.triggerRadius;
      break;
    case 'strip':
      spec.statusMagnitude = p.num('gripLossFactor');
      spec.statusTicks = p.ticks('gripLossSeconds');
      spec.hazardHalfLength = p.num('stripLength') / 2;
      spec.hazardRadius = p.num('stripWidth') / 2;
      spec.hazardLifeTicks = p.ticks('lifeSeconds');
      spec.dropDistance = p.num('dropDistance');
      break;
    case 'puddle':
      spec.statusMagnitude = p.num('speedReduction');
      spec.statusTicks = p.ticks('slowSeconds');
      spec.hazardRadius = p.num('puddleRadius');
      spec.hazardLifeTicks = p.ticks('lifeSeconds');
      spec.flightTicks = p.ticks('flightSeconds');
      break;
    case 'pulse':
      spec.range = p.num('radius');
      spec.statusTicks = p.ticks('disableSeconds');
      spec.windupTicks = p.ticks('chargeSeconds');
      spec.flagA = p.flag('scramblesMissiles');
      break;
    case 'arc':
      spec.damage = p.num('damage');
      spec.statusTicks = p.ticks('moduleDelaySeconds');
      spec.wetFactor = p.num('wetRangeFactor');
      break;
    case 'flame':
      spec.activeTicks = p.ticks('durationSeconds');
      spec.damage = p.num('damageOverTime');
      spec.heatApplied = p.num('heatApplied');
      spec.lingerTicks = p.ticks('burnLingerSeconds');
      spec.flagA = p.flag('ignitesOil');
      spec.lineOfSight = true;
      break;
    case 'frost':
      spec.statusMagnitude = p.num('gripReduction');
      spec.statusTicks = p.ticks('gripSeconds');
      spec.speed = p.num('projectileSpeed');
      spec.radius = p.num('projectileRadius');
      spec.hazardRadius = p.num('patchRadius');
      spec.hazardLifeTicks = p.ticks('patchLifeSeconds');
      spec.wetFactor = p.num('wetPatchFactor');
      spec.lifeTicks = Math.ceil(spec.range / spec.speed / SIM_DT);
      break;
    case 'melee':
      spec.damage = p.num('damage');
      spec.impulse = p.num('lateralImpulse');
      spec.windupTicks = p.ticks('swingSeconds');
      break;
    case 'contact':
      spec.damage = p.num('damagePerBurst');
      spec.range = p.num('contactRange');
      break;
    case 'tether':
      spec.activeTicks = p.ticks('tetherSeconds');
      spec.pullAccel = p.num('pullAccel');
      spec.selfShare = p.num('selfPullShare');
      spec.speed = p.num('projectileSpeed');
      spec.radius = p.num('projectileRadius');
      spec.breakDistance = p.num('breakDistance');
      spec.lifeTicks = Math.ceil(spec.range / spec.speed / SIM_DT);
      spec.aim = 'assist';
      break;
    case 'blast':
      spec.impulse = p.num('knockbackImpulse');
      spec.damage = p.num('damage');
      spec.falloffMin = p.num('falloffMinFactor');
      spec.projectileImpulse = p.num('projectileImpulse');
      spec.lineOfSight = true;
      break;
    case 'boomerang':
      spec.damage = p.num('damagePerHit');
      spec.speed = p.num('projectileSpeed');
      spec.radius = p.num('projectileRadius');
      spec.turnRate = p.num('returnTurnDegPerSecond') * DEG * SIM_DT;
      spec.catchRadius = p.num('catchRadius');
      spec.refundTicks = p.ticks('catchRefundSeconds');
      spec.lifeTicks = p.ticks('lifeSeconds');
      break;
    case 'mortar':
      spec.damage = p.num('damageCenter');
      spec.damageEdge = p.num('damageEdge');
      spec.splashRadius = p.num('blastRadius');
      spec.flightTicks = p.ticks('flightSeconds');
      spec.minRange = p.num('minRange');
      spec.lockTicks = p.ticks('lockSeconds');
      spec.lead = p.num('leadFactor');
      break;

    case 'shield':
      spec.points = p.num('shieldPoints');
      spec.cooldownTicks = p.ticks('rechargeSeconds');
      break;
    case 'breakaway':
      spec.points = p.num('absorbDamage');
      spec.charges = p.num('uses');
      break;
    case 'reactive':
      spec.factor = p.num('heavyHitReduction');
      spec.threshold = p.num('heavyHitThreshold');
      spec.cooldownTicks = p.ticks('cooldownSeconds');
      break;
    case 'intercept':
      spec.range = p.num('interceptRange');
      spec.cooldownTicks = p.ticks('interceptCooldownSeconds');
      spec.energy = p.num('energyPerIntercept');
      break;
    case 'sweep':
      spec.range = p.num('sweepRange');
      spec.half = (p.num('sweepArcDegrees') * DEG) / 2;
      spec.cooldownTicks = p.ticks('sweepCooldownSeconds');
      spec.aim = 'fixed';
      break;

    case 'spare':
      spec.charges = p.num('uses');
      spec.windupTicks = p.ticks('actionSeconds');
      spec.factor = p.num('accelPenalty');
      spec.statusTicks = p.ticks('accelPenaltySeconds');
      break;
    case 'repair':
      spec.charges = p.num('uses');
      spec.windupTicks = p.ticks('actionSeconds');
      spec.points = p.num('restoreIntegrity');
      break;
    case 'nitro':
      spec.charges = p.num('bursts');
      spec.activeTicks = p.ticks('burstSeconds');
      spec.factor = p.num('forceFactor') - 1;
      spec.heat = p.num('heatPerBurst');
      break;
    case 'boost':
      spec.activeTicks = p.ticks('boostSeconds');
      spec.factor = p.num('torqueFactor') - 1;
      spec.heat = p.num('heatAdded');
      spec.cooldownTicks = p.ticks('cooldownSeconds');
      break;
    case 'decoy':
      spec.charges = p.num('decoys');
      spec.hazardLifeTicks = p.ticks('decoyLifeSeconds');
      spec.range = p.num('decoyRange');
      spec.dropDistance = p.num('dropDistance');
      break;
    case 'hop':
      spec.activeTicks = p.ticks('hopSeconds');
      spec.cooldownTicks = p.ticks('cooldownSeconds');
      break;
    case 'winch':
      spec.windupTicks = p.ticks('trappedSeconds');
      spec.threshold = p.num('trappedSpeed');
      spec.range = p.num('pullDistance');
      spec.activeTicks = p.ticks('pullSeconds');
      spec.cooldownTicks = p.ticks('cooldownSeconds');
      break;
    case 'capacitor':
      spec.points = p.num('reserveEnergy');
      spec.threshold = p.num('minShotEnergy');
      spec.factor = p.num('rechargePerSecond');
      break;
    case 'radar':
      spec.factor = p.num('trackingRangeFactor');
      spec.warnTicks = p.ticks('missileWarningExtraSeconds');
      break;
    case 'minesensor':
      spec.range = p.num('warningDistance');
      break;
    case 'targeting':
      spec.factor = p.num('acquisitionSpeedFactor');
      break;
    case 'passive':
      break;
  }
  return spec;
}

/** Compiles every mounted part of a build, in canonical blueprint order. */
export function compileModules(build: ResolvedBuild, totals: PassiveTotals): ModuleSpec[] {
  let useBit = 0;
  return build.parts.map((placed, index) => {
    const spec = compileModule(totals, placed, index);
    if (spec.category === 'utility' && spec.trigger === 'manual') spec.useBit = useBit++;
    return spec;
  });
}
