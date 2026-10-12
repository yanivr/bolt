import { STRINGS } from '@bolt/content';
import type {
  MatchPhase,
  RaceEvent,
  RaceEventBody,
  RaceResult,
  RaceSnapshot,
  RefusalReason,
  StatusFamily,
} from '@bolt/shared';
import { create } from 'zustand';
import { debugEnabled } from '../app/flags.js';
import { useApp } from '../app/store.js';
import { raceFeed } from '../game/raceFeed.js';
import type { Callout, CalloutOffer } from './callouts.js';
import { CalloutQueue, calloutFor } from './callouts.js';
import { HudCamera } from './hudCamera.js';
import type { ActionView, HeatLevel, HudLoadout, StatusView, Tier, TowLevel } from './model.js';
import {
  GapSmoother,
  StatusClock,
  actionView,
  changedComponent,
  chassisTier,
  estimateTick,
  heatLevel,
  powerLow,
  tierOf,
  towLevel,
} from './model.js';
import type { ResultsSummary } from './results.js';
import { RaceLog } from './results.js';

/**
 * The combat HUD's state. It is fed only by `raceFeed`: race snapshots 15 times a second and
 * events in order (docs/COMBAT_API.md). Nothing here reaches into the scene.
 *
 * Two kinds of state, kept apart so a snapshot never re-renders the whole HUD:
 *
 * - `useCombat` holds what changes rarely: which tier a part is in, what a button's state is,
 *   which statuses are on, the shown gap. A field is only replaced when its value changes,
 *   so a component subscribed to one field renders when that field does and not otherwise.
 * - `hudLive` holds what changes every snapshot or every frame: the newest snapshot itself,
 *   when it arrived, the charge-ups under way. Gauges and dials read it inside `onHudFrame`
 *   and write straight to their own DOM nodes.
 */

export type WarningKind = 'missile' | 'lock' | 'trap' | 'rival_finished' | 'waiting';

export type RivalView = {
  present: boolean;
  chassisPercent: number;
  tier: Tier;
  ko: boolean;
  finished: boolean;
  /** Whether the server lets this driver be shown where the rival is. */
  tracked: boolean;
};

export type RefusalView = { part: number; reason: RefusalReason; stamp: number };

export type CombatView = {
  /** A race snapshot has arrived since the last reset. */
  live: boolean;
  you: number;
  racePhase: MatchPhase;
  position: number;
  /** Gap to the rival in seconds, steadied, positive when ahead. */
  gap: number;
  chassisPercent: number;
  hullTier: Tier;
  /** Armor left per arc (front, right, rear, left) in quarters, 0 to 4; -1 where there is none. */
  armor: number[];
  /** Condition of each component, by component index. */
  tiers: Tier[];
  /** Bumped when a component is hit, and when one is repaired, to restart its flash. */
  hitStamp: number[];
  repairStamp: number[];
  hullStamp: number;
  /**
   * Bumped whenever something happens to a component of the local car (a hit, a change of
   * condition, a repair): the car diagram comes up for a moment. `popFocus` is the component
   * it was, or -1 for the hull.
   */
  popStamp: number;
  popFocus: number;
  /** The catch-up tow on the local car as a level of one to three, or 0 for none. */
  tow: TowLevel;
  /** State of each mounted part's button or pip, by part index. */
  actions: ActionView[];
  refusal: RefusalView | null;
  statuses: StatusView[];
  heat: HeatLevel;
  powerLow: boolean;
  rival: RivalView;
  warning: WarningKind | null;
  callouts: readonly Callout[];
  youFinished: boolean;
  rivalFinished: boolean;
  result: RaceResult | null;
  summary: ResultsSummary | null;
  /** True when the results on show were asked for by a debug hook, not decided by the race. */
  preview: boolean;
};

const NO_RIVAL: RivalView = {
  present: false,
  chassisPercent: 100,
  tier: 0,
  ko: false,
  finished: false,
  tracked: false,
};

function initial(): CombatView {
  return {
    live: false,
    you: 0,
    racePhase: 'COUNTDOWN',
    position: 1,
    gap: 0,
    chassisPercent: 100,
    hullTier: 0,
    armor: [-1, -1, -1, -1],
    tiers: [],
    hitStamp: [],
    repairStamp: [],
    hullStamp: 0,
    popStamp: 0,
    popFocus: -1,
    tow: 0,
    actions: [],
    refusal: null,
    statuses: [],
    heat: 0,
    powerLow: false,
    rival: NO_RIVAL,
    warning: null,
    callouts: [],
    youFinished: false,
    rivalFinished: false,
    result: null,
    summary: null,
    preview: false,
  };
}

export const useCombat = create<CombatView>(() => initial());

// --- Live values -----------------------------------------------------------------------------------

export type HudLive = {
  loadout: HudLoadout | null;
  rivalNames: string[];
  laps: number;
  race: RaceSnapshot | null;
  /** Page clock when `race` arrived. */
  arrivedMs: number;
  /** Per part: the tick a charge-up or timed action ends, its length, and whether it is a fill. */
  busyUntil: number[];
  busyTotal: number[];
  busyCharging: boolean[];
  /** Tick a warned missile is due, or 0. */
  impactTick: number;
  /** The trap the Mine Detector last warned of. */
  trap: { id: number; untilMs: number } | null;
  tetherUntil: number;
  log: RaceLog;
  camera: HudCamera;
};

export const hudLive: HudLive = {
  loadout: null,
  rivalNames: [],
  laps: 3,
  race: null,
  arrivedMs: 0,
  busyUntil: [],
  busyTotal: [],
  busyCharging: [],
  impactTick: 0,
  trap: null,
  tetherUntil: 0,
  log: new RaceLog(),
  camera: new HudCamera(),
};

/** The race tick now, run forward a little from the newest snapshot. */
export function hudTick(nowMs: number = performance.now()): number {
  const race = hudLive.race;
  if (!race) return 0;
  // A menu that freezes the race freezes the dials with it.
  if (frozen) return race.tick;
  return estimateTick(race.tick, hudLive.arrivedMs, nowMs);
}

let frozen = false;
/** Holds the HUD's clock still while the race itself is paused. */
export function setHudFrozen(value: boolean): void {
  if (frozen && !value) hudLive.arrivedMs = performance.now();
  frozen = value;
}

// --- One animation frame for the whole HUD -----------------------------------------------------------

type FrameListener = (tick: number, nowMs: number) => void;
const frameListeners = new Set<FrameListener>();
let frameHandle = 0;

function frame(nowMs: number): void {
  frameHandle = 0;
  const tick = hudTick(nowMs);
  for (const listener of frameListeners) listener(tick, nowMs);
  if (frameListeners.size > 0) frameHandle = requestAnimationFrame(frame);
}

/**
 * Calls `listener` every animation frame with the estimated race tick. Every dial, ring and
 * gauge in the HUD shares this one loop and writes its own DOM node; none of them sets React
 * state from it.
 */
export function onHudFrame(listener: FrameListener): () => void {
  frameListeners.add(listener);
  if (frameHandle === 0 && typeof requestAnimationFrame === 'function')
    frameHandle = requestAnimationFrame(frame);
  return () => {
    frameListeners.delete(listener);
    if (frameListeners.size === 0 && frameHandle !== 0) {
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
  };
}

// --- Deriving the view -------------------------------------------------------------------------------

const gap = new GapSmoother();
const statusClock = new StatusClock();
const queue = new CalloutQueue();
let lastEventId = -1;
let lastSnapshotMs = Number.NaN;
let lastHeat: HeatLevel = 0;
let lastPowerLow = false;
let powerNewsMs = -Infinity;
let lastHullTier: Tier = 0;
let lastCharges: number[] = [];
let refusalStamp = 0;

function sameArray<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!same(a[i]!, b[i]!)) return false;
  return true;
}
const is = <T>(x: T, y: T) => x === y;
const sameAction = (x: ActionView, y: ActionView) =>
  x.block === y.block && x.phase === y.phase && x.charges === y.charges;
const sameStatus = (x: StatusView, y: StatusView) =>
  x.key === y.key && x.untilTick === y.untilTick && x.totalTicks === y.totalTicks;

function offer(callout: CalloutOffer, nowMs: number): void {
  if (!useApp.getState().settings.callouts) return;
  queue.offer(callout, nowMs);
}

function hasStatus(race: RaceSnapshot, family: StatusFamily): boolean {
  const statuses = race.car.combat?.statuses ?? [];
  for (const s of statuses) if (s.family === family && s.untilTick > race.tick) return true;
  return false;
}

function derive(race: RaceSnapshot, nowMs: number): void {
  const loadout = hudLive.loadout;
  const combat = race.car.combat;
  const prev = useCombat.getState();
  const next: Partial<CombatView> = {};
  const dt = Number.isNaN(lastSnapshotMs) ? 0 : Math.min(0.5, (nowMs - lastSnapshotMs) / 1000);
  lastSnapshotMs = nowMs;

  if (!prev.live) next.live = true;
  if (prev.you !== race.you) next.you = race.you;
  if (prev.racePhase !== race.phase) next.racePhase = race.phase;
  if (prev.position !== race.position) next.position = race.position;
  const shownGap = gap.push(race.gapSeconds, dt);
  if (prev.gap !== shownGap) next.gap = shownGap;
  // The tow only means something while the race is on, and never for the leader (the
  // simulation gives the leader none; this keeps a stale or overridden value off the strip).
  const tow =
    race.phase === 'RACING' && !race.result && race.position !== 1 ? towLevel(race.car.tow) : 0;
  if (prev.tow !== tow) next.tow = tow;

  const rivalPresent = race.rival.buildHash !== '' && race.rival.chassisMax > 0;
  const rival: RivalView = rivalPresent
    ? {
        present: true,
        chassisPercent: Math.round((race.rival.chassis / race.rival.chassisMax) * 100),
        tier: chassisTier(race.rival.chassis, race.rival.chassisMax),
        ko: race.rival.ko,
        finished: race.rival.finishedAtMs !== null,
        tracked: race.rivalTracked,
      }
    : NO_RIVAL;
  const pr = prev.rival;
  if (
    pr.present !== rival.present ||
    pr.chassisPercent !== rival.chassisPercent ||
    pr.tier !== rival.tier ||
    pr.ko !== rival.ko ||
    pr.finished !== rival.finished ||
    pr.tracked !== rival.tracked
  )
    next.rival = rival;

  const youFinished = race.car.progress.finishedAtMs !== null;
  if (prev.youFinished !== youFinished) next.youFinished = youFinished;
  if (prev.rivalFinished !== rival.finished) next.rivalFinished = rival.finished;

  if (combat && loadout) {
    const motion = race.car.motion;
    const chassisPercent = Math.round((combat.chassis / Math.max(1, combat.chassisMax)) * 100);
    if (prev.chassisPercent !== chassisPercent) next.chassisPercent = chassisPercent;
    const hull = chassisTier(combat.chassis, combat.chassisMax);
    if (prev.hullTier !== hull) {
      next.hullTier = hull;
      if (prev.live) {
        next.popStamp = prev.popStamp + 1;
        next.popFocus = -1;
      }
    }
    if (hull >= 2 && lastHullTier < 2)
      offer(
        { key: 'hull', text: STRINGS.hud.callout.hullCritical, tone: 'bad', priority: 7 },
        nowMs,
      );
    lastHullTier = hull;

    // Armor has no ceiling in the snapshot; a car starts with every plate whole, so the most
    // seen on an arc is its full strength.
    const armor = combat.armor.map((points, arc) => {
      armorMax[arc] = Math.max(armorMax[arc] ?? 0, points);
      const max = armorMax[arc]!;
      return max <= 0 ? -1 : Math.ceil((points / max) * 4);
    });
    if (!sameArray(prev.armor, armor, is)) next.armor = armor;

    const tiers = combat.components.map((integrity) => tierOf(integrity));
    if (!sameArray(prev.tiers, tiers, is)) {
      next.tiers = tiers;
      const changed = changedComponent(prev.tiers, tiers);
      if (changed >= 0) {
        next.popStamp = prev.popStamp + 1;
        next.popFocus = changed;
      }
    }

    const emp = hasStatus(race, 'emp');
    const jam = hasStatus(race, 'jam');
    const airborne = hasStatus(race, 'airborne');
    const actions = loadout.parts.map((action, part): ActionView => {
      const module = combat.modules[part];
      if (!module) return { block: null, phase: 'ready', charges: -1 };
      return actionView(action, module, {
        tick: race.tick,
        integrity: combat.components[action.component] ?? 0,
        emp,
        jam,
        airborne,
        thermalLimited: motion.thermalLimited,
        battery: motion.batteryEnergy,
        reserve: combat.reserve,
        reserveThreshold: loadout.reserveThreshold,
        busyUntilTick: hudLive.busyUntil[part] ?? 0,
        busyCharging: hudLive.busyCharging[part] ?? false,
      });
    });
    if (!sameArray(prev.actions, actions, sameAction)) next.actions = actions;
    actions.forEach((view, part) => {
      const before = lastCharges[part];
      const action = loadout.parts[part]!;
      if (
        view.charges === 0 &&
        before !== undefined &&
        before > 0 &&
        // Weapons only: a spare wheel or repair kit running out is its job, not news, and
        // the line would push the repair callout off the lane.
        action.slot >= 0
      )
        offer(
          {
            key: `ammo-${part}`,
            text: STRINGS.hud.callout.outOfAmmo,
            detail: action.name,
            tone: 'info',
            priority: 4,
          },
          nowMs,
        );
      lastCharges[part] = view.charges;
    });

    const shield = loadout.parts.some(
      (action, part) => action.kind === 'shield' && (combat.modules[part]?.pool ?? 0) > 0,
    );
    const statuses = statusClock.read(combat, race.tick, {
      shield,
      tetherUntilTick: hudLive.tetherUntil,
    });
    if (!sameArray(prev.statuses, statuses, sameStatus)) next.statuses = statuses;

    const heat = heatLevel(motion.coreHeat, motion.thermalLimited, loadout);
    if (prev.heat !== heat) next.heat = heat;
    if (heat >= 2 && heat > lastHeat)
      offer(
        {
          key: `heat-${heat}`,
          text: STRINGS.hud.callout.engineHot,
          ...(heat === 3 ? { detail: STRINGS.hud.callout.weaponsLocked } : {}),
          tone: 'bad',
          priority: heat === 3 ? 7 : 6,
        },
        nowMs,
      );
    if (heat >= 2) hudLive.log.addHeat(dt);
    lastHeat = heat;

    const low = powerLow(motion.batteryEnergy, combat.reserve, loadout);
    if (prev.powerLow !== low) next.powerLow = low;
    if (low && !lastPowerLow && nowMs - powerNewsMs > 6000 && race.phase === 'RACING') {
      powerNewsMs = nowMs;
      offer({ key: 'power', text: STRINGS.hud.callout.lowPower, tone: 'bad', priority: 5 }, nowMs);
    }
    lastPowerLow = low;

    // --- What to warn about, most urgent first ------------------------------------------------
    let warning: WarningKind | null = null;
    if (combat.lockWarning === 2) warning = 'missile';
    else if (combat.lockWarning === 1) warning = 'lock';
    else if (hudLive.trap && hudLive.trap.untilMs > nowMs && trapHazard(race)) warning = 'trap';
    else if (race.phase === 'RACING' && race.finishWindowEndTick > 0 && !race.result)
      warning = youFinished ? 'waiting' : rival.finished ? 'rival_finished' : null;
    if (prev.warning !== warning) next.warning = warning;
  }

  if (race.result && !prev.result) {
    next.result = race.result;
    next.summary = hudLive.log.summary();
    next.preview = false;
  }
  if (Object.keys(next).length > 0) useCombat.setState(next);
}

const armorMax: number[] = [];

/** The hazard the last trap warning was about, while the snapshot still has it. */
export function trapHazard(race: RaceSnapshot): RaceSnapshot['hazards'][number] | null {
  const trap = hudLive.trap;
  if (!trap) return null;
  for (const hazard of race.hazards) if (hazard.id === trap.id) return hazard;
  return null;
}

function onEvent(event: RaceEvent, race: RaceSnapshot | null, nowMs: number): void {
  if (event.id <= lastEventId) return;
  lastEventId = event.id;
  const loadout = hudLive.loadout;
  const you = race?.you ?? useCombat.getState().you;
  hudLive.log.add(event);
  const state = useCombat.getState();

  switch (event.type) {
    case 'hit':
      if (event.car !== you) break;
      if (event.component >= 0) {
        const hitStamp = [...state.hitStamp];
        hitStamp[event.component] = (hitStamp[event.component] ?? 0) + 1;
        useCombat.setState({
          hitStamp,
          popStamp: state.popStamp + 1,
          popFocus: event.component,
        });
      }
      if (event.chassis > 0) useCombat.setState({ hullStamp: state.hullStamp + 1 });
      break;
    case 'component':
      if (event.car === you && event.repaired) {
        const repairStamp = [...state.repairStamp];
        repairStamp[event.component] = (repairStamp[event.component] ?? 0) + 1;
        useCombat.setState({ repairStamp });
      }
      // Destroyed, disabled or repaired: the diagram shows which part.
      if (event.car === you && event.component >= 0)
        useCombat.setState({
          popStamp: useCombat.getState().popStamp + 1,
          popFocus: event.component,
        });
      break;
    case 'windup':
      if (event.car !== you) break;
      hudLive.busyUntil[event.part] = event.tick + event.ticks;
      hudLive.busyTotal[event.part] = event.ticks;
      hudLive.busyCharging[event.part] = true;
      break;
    case 'utility': {
      if (event.car !== you) break;
      const action = loadout?.parts[event.part];
      if (event.state !== 'started' || !action) {
        hudLive.busyUntil[event.part] = 0;
        break;
      }
      const repair = action.kind === 'repair' || action.kind === 'spare';
      const ticks = repair ? action.windupTicks : action.activeTicks;
      if (ticks > 0) {
        hudLive.busyUntil[event.part] = event.tick + ticks;
        hudLive.busyTotal[event.part] = ticks;
        hudLive.busyCharging[event.part] = repair;
      }
      break;
    }
    case 'status':
      // An EMP cuts a charge-up short (docs/COMBAT_API.md, `windup`).
      if (
        event.car === you &&
        event.state === 'applied' &&
        (event.family === 'emp' || event.family === 'jam')
      )
        loadout?.parts.forEach((action, part) => {
          if (action.category === 'weapon') hudLive.busyUntil[part] = 0;
        });
      break;
    case 'warning':
      if (event.car !== you) break;
      if (event.kind === 'missile') hudLive.impactTick = event.tick + event.value;
      else if (event.kind === 'trap') hudLive.trap = { id: event.value, untilMs: nowMs + 3000 };
      else if (event.kind === 'lock_lost') hudLive.impactTick = 0;
      break;
    case 'tether':
      if (event.car !== you && event.target !== you) break;
      // The line lasts two seconds unless it parts sooner (docs/COMBAT_API.md, fixed timings).
      hudLive.tetherUntil = event.state === 'attached' ? event.tick + 60 : 0;
      break;
    case 'refused':
      if (event.car === you && event.part >= 0)
        useCombat.setState({
          refusal: { part: event.part, reason: event.reason, stamp: ++refusalStamp },
        });
      break;
    default:
      break;
  }

  if (loadout) {
    const callout = calloutFor(event, {
      you,
      loadout,
      rivalNames: hudLive.rivalNames,
      laps: hudLive.laps,
      raceTimeMs: race?.raceTimeMs ?? 0,
    });
    if (callout) offer(callout, nowMs);
  }
}

function resetRace(): void {
  hudLive.race = null;
  hudLive.busyUntil = [];
  hudLive.busyTotal = [];
  hudLive.busyCharging = [];
  hudLive.impactTick = 0;
  hudLive.trap = null;
  hudLive.tetherUntil = 0;
  hudLive.log.reset();
  hudLive.camera.cut();
  gap.reset();
  statusClock.reset();
  queue.reset();
  armorMax.length = 0;
  lastSnapshotMs = Number.NaN;
  lastHeat = 0;
  lastPowerLow = false;
  powerNewsMs = -Infinity;
  lastHullTier = 0;
  lastCharges = [];
  useCombat.setState(initial(), true);
}

// --- Debug fixtures --------------------------------------------------------------------------------

/**
 * Changes laid over each incoming snapshot before the HUD reads it, for screenshots and for
 * tests of states a scripted scenario does not reach (thermal protection, a lock warning on
 * the local car). Only installed with `?debug=1`. The HUD's own rules still do all the work:
 * the override changes what the snapshot says, never what the HUD concludes from it.
 */
export type HudOverride = {
  coreHeat?: number;
  thermalLimited?: boolean;
  battery?: number;
  chassis?: number;
  lockWarning?: number;
  /** Charges by part index. */
  charges?: Record<number, number>;
  /** Module lifecycle state by part index. */
  moduleState?: Record<number, number>;
  /** Ticks of cooldown left, and its length, by part index. */
  cooldown?: Record<number, [left: number, total: number]>;
  /** Integrity by component index. */
  integrity?: Record<number, number>;
  armor?: number[];
  statuses?: Array<{ family: StatusFamily; ticks: number; magnitude?: number }>;
  position?: number;
  gapSeconds?: number;
  gapMeters?: number;
  /** Puts the rival at an offset from the local car, world pixels. */
  rivalOffset?: { x: number; y: number };
  rivalTracked?: boolean;
  rivalChassis?: number;
  /** A guided missile at an offset from the local car, world pixels. */
  missileOffset?: { x: number; y: number };
  /** The catch-up tow on the local car, 0 to 1 (the snapshot's `tow`). */
  tow?: number;
};

let override: HudOverride | null = null;

function applyOverride(race: RaceSnapshot, o: HudOverride): RaceSnapshot {
  const car = { ...race.car, motion: { ...race.car.motion } };
  const out: RaceSnapshot = { ...race, car, rival: { ...race.rival } };
  if (o.tow !== undefined) car.tow = o.tow;
  if (o.coreHeat !== undefined) car.motion.coreHeat = o.coreHeat;
  if (o.thermalLimited !== undefined) car.motion.thermalLimited = o.thermalLimited;
  if (o.battery !== undefined) car.motion.batteryEnergy = o.battery;
  if (car.combat) {
    const combat = {
      ...car.combat,
      components: [...car.combat.components],
      modules: car.combat.modules.map((m) => ({ ...m })),
    };
    car.combat = combat;
    if (o.chassis !== undefined) combat.chassis = o.chassis;
    if (o.lockWarning !== undefined) combat.lockWarning = o.lockWarning;
    if (o.armor) combat.armor = [...o.armor];
    for (const [part, charges] of Object.entries(o.charges ?? {})) {
      const m = combat.modules[Number(part)];
      if (m) m.charges = charges;
    }
    for (const [part, value] of Object.entries(o.moduleState ?? {})) {
      const m = combat.modules[Number(part)];
      if (m) m.state = value;
    }
    for (const [part, [left, total]] of Object.entries(o.cooldown ?? {})) {
      const m = combat.modules[Number(part)];
      if (m) {
        m.readyTick = race.tick + left;
        m.cooldownTicks = total;
      }
    }
    for (const [component, value] of Object.entries(o.integrity ?? {}))
      if (Number(component) < combat.components.length)
        combat.components[Number(component)] = value;
    if (o.statuses)
      combat.statuses = o.statuses.map((s) => ({
        family: s.family,
        magnitude: s.magnitude ?? 1,
        untilTick: race.tick + s.ticks,
      }));
  }
  if (o.position !== undefined) out.position = o.position;
  if (o.gapSeconds !== undefined) out.gapSeconds = o.gapSeconds;
  if (o.gapMeters !== undefined) out.gapMeters = o.gapMeters;
  if (o.rivalTracked !== undefined) out.rivalTracked = o.rivalTracked;
  if (o.rivalChassis !== undefined) out.rival.chassis = o.rivalChassis;
  if (o.rivalOffset) {
    out.rival.x = car.motion.x + o.rivalOffset.x;
    out.rival.y = car.motion.y + o.rivalOffset.y;
  }
  if (o.missileOffset)
    out.projectiles = [
      ...race.projectiles,
      {
        id: 999_999,
        kind: 'missile',
        owner: race.you === 0 ? 1 : 0,
        x: car.motion.x + o.missileOffset.x,
        y: car.motion.y + o.missileOffset.y,
        vx: 0,
        vy: 0,
        tick: race.tick,
        landTick: 0,
      },
    ];
  return out;
}

export type HudDebug = {
  /** Lays changes over every following snapshot; null removes them. */
  override: (changes: HudOverride | null) => void;
  /** Pushes an event through the HUD exactly as the feed would. */
  event: (body: RaceEventBody) => void;
  /** Every event the HUD has been given this race. */
  events: () => RaceEvent[];
  summary: () => ResultsSummary;
  /** Shows the results screen for the race so far, marked as a preview. */
  showResults: () => void;
  /** The local car's place on screen as the HUD has it, CSS pixels. */
  carScreen: () => { x: number; y: number } | null;
  /** The HUD's own reading of the view: its size and how many CSS pixels a world pixel covers. */
  camera: () => { width: number; height: number; cssPerWorld: number };
  /** Combat view, for assertions. */
  view: () => CombatView;
  /** The local car's mounted parts, so a test can find one by its catalog id. */
  parts: () => Array<{ part: number; component: number; id: string; slot: number; useBit: number }>;
  /** The local car's components, by index. */
  components: () => Array<{ index: number; kind: string; name: string }>;
};

function installDebug(): void {
  let fakeId = 1_000_000;
  const debug: HudDebug = {
    override: (changes) => {
      override = changes;
    },
    event: (body) => {
      const race = hudLive.race;
      onEvent(
        { ...body, id: fakeId++, tick: race?.tick ?? 0 } as RaceEvent,
        race,
        performance.now(),
      );
    },
    events: () => [...hudLive.log.events],
    summary: () => hudLive.log.summary(),
    showResults: () => useCombat.setState({ summary: hudLive.log.summary(), preview: true }),
    carScreen: () => (hudLive.camera.ready ? hudLive.camera.car({ x: 0, y: 0 }) : null),
    camera: () => ({
      width: hudLive.camera.width,
      height: hudLive.camera.height,
      cssPerWorld: hudLive.camera.cssPerWorld,
    }),
    view: () => useCombat.getState(),
    parts: () =>
      (hudLive.loadout?.parts ?? []).map((p) => ({
        part: p.part,
        component: p.component,
        id: p.id,
        slot: p.slot,
        useBit: p.useBit,
      })),
    components: () =>
      (hudLive.loadout?.components ?? []).map((c) => ({
        index: c.index,
        kind: c.kind,
        name: c.name,
      })),
  };
  const host = window as unknown as { __boltDebug?: Record<string, unknown> };
  host.__boltDebug = { ...(host.__boltDebug ?? {}), hud: debug };
}

// --- The feed ----------------------------------------------------------------------------------------

export type HudFeedConfig = {
  loadout: HudLoadout;
  /** Names of the rival's components by index. */
  rivalNames: string[];
  laps: number;
};

/**
 * Connects the HUD to the race feed for one race screen. Returns the function that
 * disconnects it. The feed's own reset (Race Again) clears the race but keeps the car.
 */
export function startHudFeed(config: HudFeedConfig): () => void {
  hudLive.loadout = config.loadout;
  hudLive.rivalNames = config.rivalNames;
  hudLive.laps = config.laps;
  lastEventId = -1;
  override = null;
  frozen = false;
  resetRace();
  if (debugEnabled()) installDebug();

  const unsubscribe = raceFeed.subscribe({
    onRace: (snapshot, nowMs) => {
      const race = override ? applyOverride(snapshot, override) : snapshot;
      hudLive.race = race;
      hudLive.arrivedMs = nowMs;
      derive(race, nowMs);
    },
    onEvent: (event) => onEvent(event, hudLive.race, performance.now()),
    onReset: resetRace,
  });
  // Callouts and warnings end by the clock, not by a snapshot.
  const stopFrame = onHudFrame((_tick, nowMs) => {
    const visible = queue.visible(nowMs);
    const state = useCombat.getState();
    if (state.callouts !== visible) useCombat.setState({ callouts: visible });
    if (state.warning === 'trap' && (!hudLive.trap || hudLive.trap.untilMs <= nowMs))
      useCombat.setState({ warning: null });
  });
  return () => {
    unsubscribe();
    stopFrame();
    hudLive.loadout = null;
    resetRace();
  };
}
