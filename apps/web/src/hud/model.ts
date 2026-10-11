import { STRINGS } from '@bolt/content';
import type {
  CarCombatSnapshot,
  ModuleKind,
  ModuleSnapshot,
  PartCategory,
  ResolvedBuild,
  StatusSnapshot,
  VehicleParams,
} from '@bolt/shared';
import {
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_STEERING,
  HEAT_PROTECTION,
  HEAT_WARNING,
  MODULE_ACTIVE,
  MODULE_DISABLED,
  MODULE_TARGETING,
  SIM_DT,
  aggregateModifiers,
  compileModules,
  conditionIndex,
  engineMount,
} from '@bolt/shared';

/**
 * What the race HUD knows and how it reads it. Everything here is a pure function of the
 * car's blueprint, the race snapshots and the events (docs/COMBAT_API.md, "What the HUD can
 * read"): no DOM, no clock, no store, so each rule has a unit test.
 */

// --- The car as the HUD lays it out ---------------------------------------------------------------

/** One button, pip or damageable part of the car, as far as the HUD is concerned. */
export type HudAction = {
  /** Index into the car's mounted parts, the snapshot's `modules` and event `part` fields. */
  part: number;
  /** Index into the snapshot's `components`. */
  component: number;
  id: string;
  name: string;
  category: PartCategory;
  kind: ModuleKind;
  /** Fire button, or -1. */
  slot: number;
  /** Bit in the `use` input, or -1. */
  useBit: number;
  /** Fires by itself: an automatic, or a hybrid left on auto. */
  auto: boolean;
  /** Uses a match, or 0 when only cooldown, heat and power limit it. */
  charges: number;
  /** Ticks between the trigger and the effect: a charge-up the button shows filling. */
  windupTicks: number;
  /** Ticks a timed effect lasts once started (nitro, booster, jump). */
  activeTicks: number;
  /** Energy and heat one activation costs. */
  energy: number;
  heat: number;
  /** True for weapons that cannot fire without a lock (the mortar). */
  needsLock: boolean;
  /** Keyboard shortcut shown on desktop, or empty. */
  key: string;
};

export type HudComponentKind = 'engine' | 'steering' | 'wheel' | 'part';

/** A damageable component and where it sits on the car, chassis-local pixels. */
export type HudComponent = {
  index: number;
  kind: HudComponentKind;
  /** Wheel or part index. */
  ref: number;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  category: PartCategory | null;
  partId: string | null;
};

export type HudLoadout = {
  /** The weapon on each fire button, or null. */
  fire: [HudAction | null, HudAction | null];
  /** Manual utilities in the order of their input bits. */
  utilities: HudAction[];
  /** Parts that work by themselves and show a status pip: automatic weapons, reactive defenses. */
  autos: HudAction[];
  /** Every mounted part, by part index. */
  parts: HudAction[];
  components: HudComponent[];
  body: { halfW: number; halfL: number };
  /** Heat at which the gauge turns to warning, at which output falls, and at which weapons lock. */
  heatWarn: number;
  heatHot: number;
  heatMax: number;
  batteryCapacity: number;
  /** Energy at which a capacitor adds its reserve to a shot, or Infinity without one. */
  reserveThreshold: number;
  hasRadar: boolean;
  hasMineSensor: boolean;
  /** Utility bits the repair key presses. */
  repairMask: number;
  world: { width: number; height: number };
};

const AUTO_DEFENSES: ReadonlySet<ModuleKind> = new Set([
  'shield',
  'breakaway',
  'reactive',
  'intercept',
  'sweep',
]);

function wheelName(x: number, y: number, ys: number[]): string {
  const w = STRINGS.hud.wheels;
  const front = Math.min(...ys);
  const rear = Math.max(...ys);
  const row = y <= front + 0.5 ? 'front' : y >= rear - 0.5 ? 'rear' : 'mid';
  if (Math.abs(x) < 1) return row === 'front' ? w.front : w.rear;
  const left = x < 0;
  if (row === 'front') return left ? w.frontLeft : w.frontRight;
  if (row === 'rear') return left ? w.rearLeft : w.rearRight;
  return left ? w.midLeft : w.midRight;
}

/**
 * Reads a resolved build into the HUD's layout. It uses the simulation's own `compileModules`,
 * so the buttons, bits and component order are the server's by construction.
 */
export function buildHudLoadout(
  build: ResolvedBuild,
  params: VehicleParams,
  world: { width: number; height: number },
): HudLoadout {
  const chassis = build.chassis;
  const specs = compileModules(build, aggregateModifiers(build));
  const wheelCount = chassis.wheelAnchors.length;
  const firstPart = COMPONENT_FIRST_WHEEL + wheelCount;
  const keys = STRINGS.hud.keys;

  const parts: HudAction[] = specs.map((spec, index) => ({
    part: index,
    component: firstPart + index,
    id: spec.id,
    name: build.parts[index]!.def.displayName,
    category: spec.category,
    kind: spec.kind,
    slot: spec.category === 'weapon' && !spec.auto ? spec.slot : -1,
    useBit: spec.useBit,
    auto: spec.auto,
    charges: spec.charges,
    windupTicks: spec.windupTicks,
    activeTicks: spec.activeTicks,
    energy: spec.energy,
    heat: spec.heat,
    needsLock: spec.kind === 'mortar',
    key:
      spec.category === 'weapon' && !spec.auto && spec.slot === 0
        ? keys.primary
        : spec.category === 'weapon' && !spec.auto && spec.slot === 1
          ? keys.secondary
          : spec.useBit >= 0
            ? String(spec.useBit + 1)
            : '',
  }));

  const fire: [HudAction | null, HudAction | null] = [null, null];
  for (const action of parts)
    if (action.slot === 0 || action.slot === 1) fire[action.slot] ??= action;
  const utilities = parts.filter((a) => a.useBit >= 0).sort((a, b) => a.useBit - b.useBit);
  const autos = parts.filter(
    (a) => (a.category === 'weapon' && a.auto) || AUTO_DEFENSES.has(a.kind),
  );
  let repairMask = 0;
  for (const u of utilities)
    if (u.kind === 'repair' || u.kind === 'spare') repairMask |= 1 << u.useBit;

  const components: HudComponent[] = [];
  const bay = engineMount(chassis);
  components[COMPONENT_ENGINE] = {
    index: COMPONENT_ENGINE,
    kind: 'engine',
    ref: 0,
    x: bay?.x ?? 0,
    y: bay?.y ?? 0,
    w: Math.min(14, chassis.bodyHalfWidth * 1.1),
    h: 12,
    name: STRINGS.hud.engine,
    category: 'engine',
    partId: build.engine.id,
  };
  const steered = chassis.wheelAnchors.filter((w) => w.steers);
  const rackY =
    steered.length > 0
      ? steered.reduce((sum, w) => sum + w.y, 0) / steered.length
      : -chassis.bodyHalfLength * 0.6;
  components[COMPONENT_STEERING] = {
    index: COMPONENT_STEERING,
    kind: 'steering',
    ref: 0,
    x: 0,
    y: rackY,
    w: Math.max(8, chassis.bodyHalfWidth * 1.2),
    h: 3,
    name: STRINGS.hud.steering,
    category: null,
    partId: null,
  };
  const ys = chassis.wheelAnchors.map((w) => w.y);
  chassis.wheelAnchors.forEach((wheel, i) => {
    components[COMPONENT_FIRST_WHEEL + i] = {
      index: COMPONENT_FIRST_WHEEL + i,
      kind: 'wheel',
      ref: i,
      x: wheel.x,
      y: wheel.y,
      w: 6,
      h: 11,
      name: wheelName(wheel.x, wheel.y, ys),
      category: 'tires',
      partId: build.tires.id,
    };
  });
  build.parts.forEach((placed, i) => {
    components[firstPart + i] = {
      index: firstPart + i,
      kind: 'part',
      ref: i,
      x: placed.x,
      y: placed.y,
      w: Math.max(5, placed.w),
      h: Math.max(5, placed.h),
      name: placed.def.displayName,
      category: placed.def.category,
      partId: placed.def.id,
    };
  });

  const capacitor = specs.find((s) => s.kind === 'capacitor');
  return {
    fire,
    utilities,
    autos,
    parts,
    components,
    body: { halfW: chassis.bodyHalfWidth, halfL: chassis.bodyHalfLength },
    heatWarn: HEAT_WARNING,
    heatHot: params.heat.performanceThreshold,
    heatMax: HEAT_PROTECTION,
    batteryCapacity: Math.max(1, params.power.capacity),
    reserveThreshold: capacitor ? capacitor.threshold : Infinity,
    hasRadar: specs.some((s) => s.kind === 'radar'),
    hasMineSensor: specs.some((s) => s.kind === 'minesensor'),
    repairMask,
    world,
  };
}

// --- Damage tiers ----------------------------------------------------------------------------------

/** Section 8.1 condition of a component: 0 healthy, 1 damaged, 2 critical, 3 destroyed. */
export type Tier = 0 | 1 | 2 | 3;

export function tierOf(integrity: number): Tier {
  return conditionIndex(integrity) as Tier;
}

/**
 * The chassis has no Section 8.1 states of its own, so the bar borrows the same proportions:
 * healthy above 65 percent, damaged above 20, critical above none, and limp at zero.
 */
export function chassisTier(chassis: number, max: number): Tier {
  if (chassis <= 0) return 3;
  const share = max > 0 ? (chassis / max) * 100 : 0;
  return share > 65 ? 0 : share > 20 ? 1 : 2;
}

// --- The race clock between snapshots --------------------------------------------------------------

const MS_PER_TICK = SIM_DT * 1000;
/** How far past a snapshot the HUD will run its own clock before it waits for the next one. */
export const MAX_EXTRAPOLATED_TICKS = 4;

/**
 * The race tick at `nowMs`, given the tick of the newest snapshot and when it arrived.
 * Snapshots come 15 times a second; dials that count ticks read this in between so they turn
 * smoothly. It never runs more than a few ticks ahead, so a paused or stalled race holds still.
 */
export function estimateTick(snapshotTick: number, arrivedMs: number, nowMs: number): number {
  const ahead = Math.max(0, nowMs - arrivedMs) / MS_PER_TICK;
  return snapshotTick + Math.min(MAX_EXTRAPOLATED_TICKS, ahead);
}

/** Share of a wait still to run, 1 just started to 0 ready. */
export function cooldownFraction(
  module: Pick<ModuleSnapshot, 'readyTick' | 'cooldownTicks'>,
  tick: number,
): number {
  const left = module.readyTick - tick;
  if (left <= 0 || module.cooldownTicks <= 0) return 0;
  return Math.min(1, left / module.cooldownTicks);
}

/** Share of a timed span that has passed, 0 to 1, for a span ending at `untilTick`. */
export function spanProgress(untilTick: number, totalTicks: number, tick: number): number {
  if (totalTicks <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - (untilTick - tick) / totalTicks));
}

// --- Buttons ---------------------------------------------------------------------------------------

/** Why a button cannot act right now. The label says it in words; the glyph and hatch differ too. */
export type BlockReason =
  'destroyed' | 'emp' | 'jammed' | 'airborne' | 'empty' | 'overheat' | 'nopower' | 'notarget';

/** What a button is doing when nothing blocks it. */
export type ActionPhase = 'ready' | 'cooling' | 'charging' | 'active' | 'targeting' | 'locked';

export type ActionView = {
  block: BlockReason | null;
  phase: ActionPhase;
  /** Uses left, or -1 when the part is not limited by charges. */
  charges: number;
};

export type ActionContext = {
  /** Estimated race tick. */
  tick: number;
  /** Integrity of the part's own component. */
  integrity: number;
  emp: boolean;
  jam: boolean;
  airborne: boolean;
  thermalLimited: boolean;
  battery: number;
  reserve: number;
  reserveThreshold: number;
  /** Tick a charge-up or a timed action that is under way ends, or 0. */
  busyUntilTick: number;
  /** True when that span is a charge-up or a repair (a fill), false for a timed effect. */
  busyCharging: boolean;
};

/**
 * The state of one button, in the simulation's own order of refusals (`tryFire`, `activate`):
 * a broken part, electronics down, no ammunition, then for a weapon thermal protection and
 * power. A wait that is running is the phase, not a block, because it ends by itself and the
 * dial already shows it; a block is something the driver has to do something about.
 */
export function actionView(
  action: HudAction,
  module: ModuleSnapshot,
  ctx: ActionContext,
): ActionView {
  const weapon = action.category === 'weapon';
  let block: BlockReason | null = null;
  if (module.state === MODULE_DISABLED || ctx.integrity <= 0) block = 'destroyed';
  else if (ctx.emp) block = 'emp';
  else if (ctx.jam) block = 'jammed';
  else if (weapon && ctx.airborne) block = 'airborne';
  else if (module.charges === 0) block = 'empty';
  else if (weapon && action.heat > 0 && ctx.thermalLimited) block = 'overheat';
  else if (weapon && action.energy > 0) {
    const available = ctx.battery + (action.energy >= ctx.reserveThreshold ? ctx.reserve : 0);
    if (available < action.energy - 1e-9) block = 'nopower';
  }

  let phase: ActionPhase = 'ready';
  if (ctx.busyUntilTick > ctx.tick) phase = ctx.busyCharging ? 'charging' : 'active';
  else if (module.state === MODULE_ACTIVE) phase = 'active';
  else if (module.readyTick > ctx.tick && module.cooldownTicks > 0) phase = 'cooling';
  else if (module.locked) phase = 'locked';
  else if (module.state === MODULE_TARGETING) phase = 'targeting';

  // A mortar has nowhere to send a shell without a lock: say so instead of looking ready.
  if (!block && action.needsLock && (phase === 'ready' || phase === 'targeting'))
    block = 'notarget';
  return { block, phase, charges: module.charges };
}

// --- Heat and power --------------------------------------------------------------------------------

/** 0 normal, 1 warm, 2 hot (output falling), 3 protection: weapons that make heat are locked. */
export type HeatLevel = 0 | 1 | 2 | 3;

export function heatLevel(
  coreHeat: number,
  thermalLimited: boolean,
  loadout: HudLoadout,
): HeatLevel {
  if (thermalLimited) return 3;
  if (coreHeat >= loadout.heatHot) return 2;
  if (coreHeat >= loadout.heatWarn) return 1;
  return 0;
}

/**
 * Whether the battery is too low to do what the car carries: under a fifth of its capacity,
 * or less than the dearest shot on a fire button costs. The snapshot has no "low power" flag
 * of its own, so this is the HUD's reading of the stored energy.
 */
export function powerLow(battery: number, reserve: number, loadout: HudLoadout): boolean {
  if (battery < loadout.batteryCapacity * 0.2) return true;
  for (const action of loadout.fire) {
    if (!action || action.energy <= 0) continue;
    const available = battery + (action.energy >= loadout.reserveThreshold ? reserve : 0);
    if (available < action.energy - 1e-9) return true;
  }
  return false;
}

// --- Statuses --------------------------------------------------------------------------------------

/** A status icon. `family` also covers the two the HUD derives itself: shield and tether. */
export type StatusKey = StatusSnapshot['family'] | 'shield' | 'tether';

export type StatusView = {
  key: StatusKey;
  /** Tick it ends at, or 0 for one with no clock (a shield that is up). */
  untilTick: number;
  /** Length of the span it is counting down, for the ring. */
  totalTicks: number;
  /** True for the statuses that hurt: the icon is framed as a warning. */
  harmful: boolean;
};

const HARMFUL: ReadonlySet<StatusKey> = new Set(['slow', 'grip', 'burn', 'emp', 'jam', 'tether']);
/** Shown in this order, worst first, so the icon a driver must act on is always leftmost. */
const STATUS_ORDER: readonly StatusKey[] = [
  'emp',
  'jam',
  'burn',
  'tether',
  'slow',
  'grip',
  'refit',
  'airborne',
  'boost',
  'shield',
  'immune',
];

/**
 * Timers for the statuses on a car. A status's full length is not in the snapshot, only when
 * it ends, so the longest remaining time seen for it is kept as its length: the ring starts
 * full when the status lands and is refilled when a new application extends it.
 */
export class StatusClock {
  private readonly total = new Map<StatusKey, { untilTick: number; totalTicks: number }>();

  reset(): void {
    this.total.clear();
  }

  read(
    combat: Pick<CarCombatSnapshot, 'statuses'>,
    tick: number,
    extra: { shield: boolean; tetherUntilTick: number },
  ): StatusView[] {
    const seen = new Set<StatusKey>();
    const out: StatusView[] = [];
    const add = (key: StatusKey, untilTick: number) => {
      seen.add(key);
      const left = Math.max(1, untilTick - tick);
      const known = this.total.get(key);
      // A later end is a fresh application: the ring starts over from what is left now.
      if (!known || untilTick > known.untilTick + 1 || left > known.totalTicks)
        this.total.set(key, { untilTick, totalTicks: left });
      else known.untilTick = untilTick;
      out.push({
        key,
        untilTick,
        totalTicks: this.total.get(key)!.totalTicks,
        harmful: HARMFUL.has(key),
      });
    };
    for (const status of combat.statuses)
      if (status.untilTick > tick) add(status.family, status.untilTick);
    if (extra.tetherUntilTick > tick) add('tether', extra.tetherUntilTick);
    if (extra.shield) {
      seen.add('shield');
      out.push({ key: 'shield', untilTick: 0, totalTicks: 0, harmful: false });
    }
    for (const key of [...this.total.keys()]) if (!seen.has(key)) this.total.delete(key);
    out.sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
    return out;
  }
}

// --- Position and gap ------------------------------------------------------------------------------

/**
 * The gap to the rival as a steady number. The snapshot's gap in seconds is distance over the
 * chasing car's speed, which twitches with every lift and touch of a wall. This eases it over
 * about half a second and then only changes the shown tenth when the eased value is clearly
 * inside another one, so the readout neither lags a real change nor flickers between two tenths.
 */
export class GapSmoother {
  private eased = Number.NaN;
  private shown = Number.NaN;

  reset(): void {
    this.eased = Number.NaN;
    this.shown = Number.NaN;
  }

  /** Feeds one snapshot's gap, `dt` seconds after the last. Returns the gap to show, in tenths. */
  push(gapSeconds: number, dt: number): number {
    const gap = Math.max(-99.9, Math.min(99.9, gapSeconds));
    if (Number.isNaN(this.eased) || Math.abs(gap - this.eased) > 3) {
      // The first reading, or a jump no easing should smear (a restart, a finish).
      this.eased = gap;
      this.shown = Math.round(gap * 10) / 10;
      return this.shown;
    }
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.45);
    this.eased += (gap - this.eased) * k;
    // Hysteresis: the eased value has to be a clear 0.035 s inside another tenth before the
    // readout moves to it, so a gap sitting on the edge of two tenths does not flip between
    // them, and a gap that settles is shown within that much of its nearest tenth.
    const nearest = Math.round(this.eased * 10) / 10;
    if (nearest !== this.shown && Math.abs(this.eased - this.shown) >= 0.085) this.shown = nearest;
    return this.shown;
  }
}

/** `+1.2` when ahead, `-0.8` when behind, with a real minus sign never a hyphen-minus pair. */
export function formatGap(tenths: number): string {
  const value = Math.abs(tenths).toFixed(1);
  return tenths >= 0 ? `+${value}` : `−${value}`;
}

export function formatRaceTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const minutes = Math.floor(total / 6000);
  const seconds = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/**
 * Metres to show on the off-screen arrow: every metre up close, steps of five beyond, so the
 * label does not flicker while the gap drifts.
 */
export function steadyMeters(meters: number): number {
  const m = Math.abs(meters);
  return m < 30 ? Math.round(m) : Math.round(m / 5) * 5;
}
