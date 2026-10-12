import type { AiStrategy } from '@bolt/content';
import {
  AI_BRAIN_SEED_SALT,
  AI_STRATEGIES,
  AI_STRATEGY_TABLE,
  CATALOG,
  build,
  conditionsFor,
  createAiRace,
  environmentFor,
  getTemplate,
  getTrack,
  pickAiBuild,
  raceEntry,
} from '@bolt/content';
import type {
  AiDifficulty,
  AiStyle,
  BuildConditions,
  RaceBrain,
  RaceEntry,
  RaceEnvironment,
  RaceResult,
  RaceSession,
  TrackRuntime,
} from '@bolt/shared';
import {
  AiBrain,
  SIM_DT,
  buildTrack,
  createLocation,
  createRace,
  createSparringBrain,
  locate,
  stepRaceWithBrains,
} from '@bolt/shared';
import { UPGRADE_PAIRS, upgradedOf } from '../balance/upgrade.js';

/**
 * The bot tournament harness (Section 10.2, the Milestone D gate). A match is set up exactly as
 * the server room sets up a race against the AI (`createAiRace` in packages/content: the AI
 * picks its build for the course with `pickAiBuild`, the race is created with the same options,
 * the brain is seeded with the same salt) except that the first grid slot is driven by an AI
 * too instead of a person, and it is stepped by `stepRaceWithBrains`, the function the room
 * calls each tick. Headless: no network, no client, no clock, as fast as the machine runs it.
 *
 * Each match records what the report needs and watches for what must never happen: an
 * exception, a non-finite car, a race that runs to the time limit, a car that sits still for
 * longer than `STUCK_SECONDS` while racing (other than waiting at a closed crossing).
 */

export type CarSpec = {
  /** An AI build for the course from this strategy, or a named shipped template. */
  strategy?: AiStrategy;
  templateId?: string;
  difficulty: AiDifficulty;
  /** Aggressive or tactical; picked by seed when absent, as the room does. */
  style?: AiStyle;
  /** Drive this car with the sparring brain instead (the before/after comparison). */
  sparring?: boolean;
  /** With `templateId`: the upgraded twin of an upgrade-test pair (tests/balance/upgrade.ts). */
  upgrade?: string;
  /** A fixed frame of a strategy with a chosen engine and wheel kit (the tire duels). */
  build?: { frame: string; engineId: string; tireKitId: string };
};

export type MatchSpec = {
  /** Position in the plan, for tools. */
  index?: number;
  /**
   * Set up as the room does (`createAiRace`): the first car stands in for the player, the
   * second is the AI rival the room would build for this course, seed and difficulty.
   */
  room?: boolean;
  trackId: string;
  presetId: string;
  seed: number;
  cars: [CarSpec, CarSpec];
  tow?: boolean;
};

export const STUCK_SECONDS = 8;
/**
 * A car that gains less than `NO_PROGRESS_PX` of course progress in this long while racing (not
 * waiting at a crossing, not knocked out) is stuck too, even if it never sits still: backing
 * and filling against a wall is the usual way (found on Backstreet Blitz).
 */
export const NO_PROGRESS_SECONDS = 15;
export const NO_PROGRESS_PX = 150;

export type CarRecord = {
  id: string;
  strategy: AiStrategy | 'template';
  frame: string;
  tireKitId: string;
  engineId: string;
  difficulty: AiDifficulty;
  style: AiStyle;
  sparring: boolean;
  finished: boolean;
  finishSeconds: number | null;
  damageDealt: number;
  damageTaken: number;
  weaponUses: number;
  /** Per mounted weapon: catalog id, activations and damage dealt. */
  weapons: Array<{ id: string; uses: number; damage: number }>;
  wrecked: boolean;
  ko: boolean;
  /** Seconds at or above the thermal performance threshold, and in thermal protection. */
  hotSeconds: number;
  protectionSeconds: number;
  /** Laps (completed) that went through each shortcut, by branch index; and lap times, s. */
  lapTimes: number[];
  lapShortcuts: number[];
  /** Longest time sitting still while racing, seconds. */
  longestStill: number;
  /** Longest time without `NO_PROGRESS_PX` of course progress while racing, seconds. */
  longestNoProgress: number;
  /** Recoveries the AI ran (backing out), when the car is AI-driven. */
  recoveries: number;
  wallHits: number;
  /** Mean and worst cost of the brain's `control`, ms. */
  brainMeanMs: number;
  brainWorstMs: number;
  /** Mean lateral distance from the car's own planned racing line, px (AI cars). */
  lineError: number;
  /** Seconds this car had any tow, and its mean tow while it had it (share of top speed). */
  towSeconds: number;
  towMean: number;
  /** Seconds the rival was within the reach of at least one of this car's weapons. */
  inRangeSeconds: number;
  /** Why it did not finish, when it did not: knocked out, stuck, time limit, finish window. */
  dnf: 'ko' | 'wrecked' | 'stuck' | 'time limit' | 'finish window' | 'crash' | null;
  /** Mean speed over the race while racing, px/s. */
  meanSpeed: number;
};

export type MatchRecord = {
  spec: MatchSpec;
  winner: number;
  reason: RaceResult['reason'] | 'error';
  error: string | null;
  raceSeconds: number;
  cars: [CarRecord, CarRecord];
  leadChanges: number;
  lap1Leader: number;
  /** Seconds both cars spent within 220 px of each other. */
  closeSeconds: number;
  /** Problems: a crash, a stuck car, a non-finite state, no end at all. */
  problems: string[];
  /** Ran to the 180 s limit with nobody home (decided on progress). */
  timedOut: boolean;
  ticks: number;
};

/** Seed salt of the AI standing in for the player in a room-built race. */
const PLAYER_BRAIN_SALT = 0x7f4a7c15;

const trackCache = new Map<string, TrackRuntime>();
export function trackOf(trackId: string): TrackRuntime {
  let t = trackCache.get(trackId);
  if (!t) {
    t = buildTrack(getTrack(trackId)!);
    trackCache.set(trackId, t);
  }
  return t;
}

type Built = {
  entry: RaceEntry;
  record: Pick<CarRecord, 'id' | 'strategy' | 'frame' | 'tireKitId' | 'engineId'>;
};

function buildCar(
  spec: CarSpec,
  match: MatchSpec,
  slot: number,
  conditions: BuildConditions,
): Built {
  if (spec.build) {
    const frame = AI_STRATEGIES.flatMap((s) => AI_STRATEGY_TABLE[s].frames).find(
      (f) => f.id === spec.build!.frame,
    );
    if (!frame) throw new Error(`no frame ${spec.build.frame}`);
    const blueprint = build(
      `AI ${frame.name}`,
      frame.chassisId,
      spec.build.engineId,
      spec.build.tireKitId,
      frame.paintId,
      [...frame.parts],
    );
    const entry = raceEntry(blueprint, conditions);
    if (!entry) throw new Error(`${frame.id} with ${spec.build.tireKitId} is not legal`);
    const strategy = AI_STRATEGIES.find((s) =>
      AI_STRATEGY_TABLE[s].frames.some((f) => f.id === frame.id),
    )!;
    return {
      entry,
      record: {
        id: `${frame.id}/${spec.build.engineId}/${spec.build.tireKitId}`,
        strategy,
        frame: frame.id,
        tireKitId: spec.build.tireKitId,
        engineId: spec.build.engineId,
      },
    };
  }
  if (spec.templateId) {
    let t = getTemplate(spec.templateId);
    if (t && spec.upgrade) {
      const pair = UPGRADE_PAIRS.find((p) => p.id === spec.upgrade);
      if (!pair || pair.base !== t.id) throw new Error(`no upgrade ${spec.upgrade} of ${t.id}`);
      t = upgradedOf(pair);
    }
    if (!t) throw new Error(`no template ${spec.templateId}`);
    const entry = raceEntry(t.blueprint, conditions);
    if (!entry) throw new Error(`${t.id} is not legal`);
    return {
      entry,
      record: {
        id: t.id,
        strategy: 'template',
        frame: t.id,
        tireKitId: t.blueprint.tireKitId,
        engineId: t.blueprint.engineId,
      },
    };
  }
  const pick = pickAiBuild(match.trackId, match.presetId, match.seed * 2 + slot, spec.strategy);
  if (!pick) throw new Error(`no ${spec.strategy} build for ${match.trackId}/${match.presetId}`);
  const entry = raceEntry(pick.blueprint, conditions);
  if (!entry) throw new Error(`AI build ${pick.frame} is not legal`);
  return {
    entry,
    record: {
      id: `${pick.frame}/${pick.engineId}/${pick.tireKitId}`,
      strategy: pick.strategy,
      frame: pick.frame,
      tireKitId: pick.tireKitId,
      engineId: pick.engineId,
    },
  };
}

/** The race entry for one car spec on a course (tools). */
export function entryFor(
  spec: CarSpec,
  trackId: string,
  presetId: string,
  seed: number,
  conditions: BuildConditions,
): RaceEntry {
  return buildCar(spec, { trackId, presetId, seed, cars: [spec, spec] }, 0, conditions).entry;
}

export type Match = { race: RaceSession; brains: RaceBrain[]; built: [Built, Built] };

export function createMatch(spec: MatchSpec): Match {
  const track = trackOf(spec.trackId);
  const env = environmentFor(spec.presetId) as RaceEnvironment;
  const conditions = conditionsFor(spec.trackId, spec.presetId) as BuildConditions;
  if (spec.room) {
    // Exactly the race the room sets up for a player (`createAiRace`, the same seed, build pick,
    // brain seed and difficulty), with an AI standing in for the player on the first slot.
    const player = buildCar(spec.cars[0], spec, 0, conditions);
    const ai = createAiRace(track, spec.presetId, env, conditions, player.entry, spec.seed, {
      difficulty: spec.cars[1].difficulty,
    });
    if (!ai || !ai.pick) throw new Error(`no AI race on ${spec.trackId}/${spec.presetId}`);
    const stand = new AiBrain({
      seed: (spec.seed ^ PLAYER_BRAIN_SALT) >>> 0,
      difficulty: spec.cars[0].difficulty,
      ...(spec.cars[0].style ? { style: spec.cars[0].style } : {}),
    });
    stand.prepare(ai.race, 0);
    const pick = ai.pick;
    return {
      race: ai.race,
      brains: [stand, ai.brain],
      built: [
        player,
        {
          entry: {
            build: ai.race.cars[1]!.build,
            params: ai.race.cars[1]!.baseParams,
            buildHash: ai.race.cars[1]!.buildHash,
          },
          record: {
            id: `${pick.frame}/${pick.engineId}/${pick.tireKitId}`,
            strategy: pick.strategy,
            frame: pick.frame,
            tireKitId: pick.tireKitId,
            engineId: pick.engineId,
          },
        },
      ],
    };
  }
  const built = [
    buildCar(spec.cars[0], spec, 0, conditions),
    buildCar(spec.cars[1], spec, 1, conditions),
  ] as [Built, Built];
  const race = createRace(
    track,
    env,
    built.map((b) => b.entry),
    { seed: spec.seed, conditions, catalog: CATALOG, tow: spec.tow ?? true },
  );
  const brains = spec.cars.map((car, i) => {
    const seed = (spec.seed ^ AI_BRAIN_SEED_SALT ^ (i * 0x9e3779b9)) >>> 0;
    if (car.sparring) return createSparringBrain(seed);
    const brain = new AiBrain({
      seed,
      difficulty: car.difficulty,
      ...(car.style ? { style: car.style } : {}),
    });
    brain.prepare(race, i);
    return brain;
  });
  return { race, brains, built };
}

const TICK_LIMIT = 30 * 200;

export function runMatch(spec: MatchSpec): MatchRecord {
  const problems: string[] = [];
  let match: Match;
  try {
    match = createMatch(spec);
  } catch (error) {
    return failed(spec, error);
  }
  const { race, brains, built } = match;
  const n = race.cars.length;
  const still = [0, 0];
  const longest = [0, 0];
  const markProgress = [0, 0];
  const markTime = [0, 0];
  const noProgress = [0, 0];
  const towTicks = [0, 0];
  const towSum = [0, 0];
  const inRange = [0, 0];
  const speedSum = [0, 0];
  const speedTicks = [0, 0];
  // The longest reach of each car's weapons (traps and contact parts count at their own reach).
  const reach = race.cars.map((car) =>
    Math.max(0, ...car.specs.filter((sp) => sp.category === 'weapon').map((sp) => sp.range || 0)),
  );
  const hot = [0, 0];
  const protection = [0, 0];
  const walls = [0, 0];
  const lapStart = [0, 0];
  const lapTimes: number[][] = [[], []];
  const lapShortcuts: number[][] = [[], []];
  const lapMask = [0, 0];
  const lineSum = [0, 0];
  const lineCount = [0, 0];
  const brainMs = [0, 0];
  const brainWorst = [0, 0];
  const brainCalls = [0, 0];
  let leadChanges = 0;
  let lap1Leader = -1;
  let close = 0;
  let ticks = 0;
  const loc = createLocation();
  // Time each brain without changing what it does.
  const timed: RaceBrain[] = brains.map((brain, i) => ({
    control: (r, index) => {
      const t0 = performance.now();
      const c = brain.control(r, index);
      const d = performance.now() - t0;
      if (r.raceTicks > 0) {
        brainMs[i]! += d;
        brainCalls[i]!++;
        if (d > brainWorst[i]!) brainWorst[i] = d;
      }
      return c;
    },
    reset: () => brain.reset(),
  }));
  try {
    while (race.phase !== 'FINISHED' && ticks < TICK_LIMIT) {
      stepRaceWithBrains(race, [], timed);
      ticks++;
      if (race.raceTicks === 0) continue;
      for (let i = 0; i < n; i++) {
        const car = race.cars[i]!;
        const m = car.session.motion;
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.velocityX))
          throw new Error(`car ${i} has a non-finite state at tick ${race.tick}`);
        const brain = brains[i];
        const holding = brain instanceof AiBrain ? brain.holding : false;
        const now = race.raceTicks * SIM_DT;
        const progress = car.session.progress.courseProgress;
        // A wrecked car (chassis gone, still driving on what is left) limps by design.
        const wreck = car.chassis <= 0;
        if (
          car.session.phase !== 'RACING' ||
          car.ko ||
          wreck ||
          holding ||
          progress > markProgress[i]! + NO_PROGRESS_PX
        ) {
          markProgress[i] = Math.max(markProgress[i]!, progress);
          markTime[i] = now;
        } else noProgress[i] = Math.max(noProgress[i]!, now - markTime[i]!);
        if (car.session.phase !== 'RACING' || car.ko) continue;
        const speed = Math.hypot(m.velocityX, m.velocityY);
        speedSum[i]! += speed;
        speedTicks[i]!++;
        if (car.tow.tow > 0) {
          towTicks[i]!++;
          towSum[i]! += car.tow.tow;
        }
        const other = race.cars[1 - i];
        if (other && other.session.phase === 'RACING' && reach[i]! > 0) {
          const om = other.session.motion;
          if (Math.hypot(om.x - m.x, om.y - m.y) <= reach[i]!) inRange[i]! += SIM_DT;
        }
        if (speed < 8 && !holding && car.chassis > 0) {
          still[i]! += SIM_DT;
          longest[i] = Math.max(longest[i]!, still[i]!);
        } else still[i] = 0;
        if (m.coreHeat >= car.session.params.heat.performanceThreshold) hot[i]! += SIM_DT;
        if (m.thermalLimited) protection[i]! += SIM_DT;
        if (race.tick % 3 === 0) {
          locate(race.track, m.x, m.y, loc);
          if (loc.branch > 0 && Math.abs(loc.lateral) < loc.halfWidth)
            lapMask[i]! |= 1 << (loc.branch - 1);
          if (brain instanceof AiBrain) {
            const e = brain.lineDeviation();
            if (Number.isFinite(e)) {
              lineSum[i]! += e;
              lineCount[i]!++;
            }
          }
        }
      }
      const [a, b] = race.cars;
      if (a && b && a.session.phase === 'RACING' && b.session.phase === 'RACING') {
        const d = Math.hypot(
          a.session.motion.x - b.session.motion.x,
          a.session.motion.y - b.session.motion.y,
        );
        if (d <= 220) close += SIM_DT;
      }
      for (const e of race.events) {
        if (e.type === 'position' && race.raceTicks * SIM_DT > 5) leadChanges++;
        if (e.type === 'wall') walls[e.car]!++;
        if (e.type === 'lap' || (e.type === 'finish' && e.finished)) {
          if (e.type === 'lap' && e.lap === 1 && lap1Leader < 0) lap1Leader = e.car;
          const now = race.raceTicks * SIM_DT;
          if (e.type === 'lap') {
            lapTimes[e.car]!.push(e.lapTimeMs / 1000);
            lapShortcuts[e.car]!.push(lapMask[e.car]!);
            lapMask[e.car] = 0;
            lapStart[e.car] = now;
          }
        }
      }
    }
  } catch (error) {
    return failed(spec, error);
  }
  const result = race.result;
  if (!result) problems.push(`never ended in ${TICK_LIMIT} ticks`);
  // At 180 s the race is decided on course progress (Section 3.4): a legal end, reported by the
  // report as an anomaly to look at, not a failure of the harness.
  const timedOut = result?.reason === 'timeout';
  for (let i = 0; i < n; i++) {
    if (longest[i]! > STUCK_SECONDS)
      problems.push(`car ${i} sat still for ${longest[i]!.toFixed(1)} s`);
    if (noProgress[i]! > NO_PROGRESS_SECONDS)
      problems.push(`car ${i} made no progress for ${noProgress[i]!.toFixed(1)} s`);
  }
  const record = (i: number): CarRecord => {
    const car = race.cars[i]!;
    const summary = result?.cars[i];
    const spec_ = spec.cars[i]!;
    let uses = 0;
    for (const s of car.specs)
      if (s.category === 'weapon') uses += car.stats.usesByPart[s.part] ?? 0;
    const b = brains[i];
    return {
      ...built[i]!.record,
      difficulty: spec_.difficulty,
      style: b instanceof AiBrain ? b.style : (spec_.style ?? 'tactical'),
      sparring: spec_.sparring === true,
      finished: summary?.finished ?? false,
      finishSeconds:
        summary?.finishTimeMs === undefined || summary.finishTimeMs === null
          ? null
          : summary.finishTimeMs / 1000,
      damageDealt: summary?.damageDealt ?? 0,
      damageTaken: summary?.damageTaken ?? 0,
      weaponUses: uses,
      weapons: car.specs
        .filter((w) => w.category === 'weapon')
        .map((w) => ({
          id: w.id,
          uses: car.stats.usesByPart[w.part] ?? 0,
          damage: car.stats.damageByPart[w.part] ?? 0,
        })),
      wrecked: car.chassis <= 0,
      ko: car.ko,
      hotSeconds: hot[i]!,
      protectionSeconds: protection[i]!,
      lapTimes: lapTimes[i]!,
      lapShortcuts: lapShortcuts[i]!,
      longestStill: longest[i]!,
      longestNoProgress: noProgress[i]!,
      recoveries: (() => {
        const b = brains[i];
        return b instanceof AiBrain ? (b.parts?.pilot.recoveries ?? 0) : 0;
      })(),
      wallHits: walls[i]!,
      brainMeanMs: brainMs[i]! / Math.max(1, brainCalls[i]!),
      brainWorstMs: brainWorst[i]!,
      lineError: lineCount[i]! > 0 ? lineSum[i]! / lineCount[i]! : Number.NaN,
      towSeconds: towTicks[i]! * SIM_DT,
      towMean: towTicks[i]! > 0 ? towSum[i]! / towTicks[i]! : 0,
      inRangeSeconds: inRange[i]!,
      dnf: summary?.finished
        ? null
        : car.ko
          ? 'ko'
          : car.chassis <= 0
            ? 'wrecked'
            : longest[i]! > STUCK_SECONDS || noProgress[i]! > NO_PROGRESS_SECONDS
              ? 'stuck'
              : result?.reason === 'timeout' || !result
                ? 'time limit'
                : 'finish window',
      meanSpeed: speedTicks[i]! > 0 ? speedSum[i]! / speedTicks[i]! : 0,
    };
  };
  return {
    spec,
    winner: result?.winner ?? -1,
    reason: result?.reason ?? 'timeout',
    error: null,
    raceSeconds: (result?.raceTimeMs ?? race.raceTicks * SIM_DT * 1000) / 1000,
    cars: [record(0), record(1)],
    leadChanges,
    lap1Leader,
    closeSeconds: close,
    problems,
    timedOut,
    ticks,
  };
}

function failed(spec: MatchSpec, error: unknown): MatchRecord {
  const blank = (i: number): CarRecord => ({
    id: '?',
    strategy: spec.cars[i]!.strategy ?? 'template',
    frame: '?',
    tireKitId: '?',
    engineId: '?',
    difficulty: spec.cars[i]!.difficulty,
    style: spec.cars[i]!.style ?? 'tactical',
    sparring: spec.cars[i]!.sparring === true,
    finished: false,
    finishSeconds: null,
    damageDealt: 0,
    damageTaken: 0,
    weaponUses: 0,
    weapons: [],
    wrecked: false,
    ko: false,
    hotSeconds: 0,
    protectionSeconds: 0,
    lapTimes: [],
    lapShortcuts: [],
    longestStill: 0,
    longestNoProgress: 0,
    recoveries: 0,
    wallHits: 0,
    brainMeanMs: 0,
    brainWorstMs: 0,
    lineError: Number.NaN,
    towSeconds: 0,
    towMean: 0,
    inRangeSeconds: 0,
    dnf: 'crash',
    meanSpeed: 0,
  });
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return {
    spec,
    winner: -1,
    reason: 'error',
    error: message,
    raceSeconds: 0,
    cars: [blank(0), blank(1)],
    leadChanges: 0,
    lap1Leader: -1,
    closeSeconds: 0,
    problems: [`crashed: ${message.split('\n')[0]}`],
    timedOut: false,
    ticks: 0,
  };
}

/**
 * One car alone on a course, the AI driving, its shortcuts forced on or off or left to plan:
 * the race time, for the shortcut payoff table.
 */
export function runSolo(
  trackId: string,
  presetId: string,
  car: CarSpec,
  shortcuts: 'plan' | 'always' | 'never',
  seed = 3,
): { seconds: number | null; walls: number; mask: number; gains: number[] } {
  const env = environmentFor(presetId) as RaceEnvironment;
  const conditions = conditionsFor(trackId, presetId) as BuildConditions;
  const spec: MatchSpec = { trackId, presetId, seed, cars: [car, car] };
  const { entry } = buildCar(car, spec, 0, conditions);
  const race = createRace(trackOf(trackId), env, [entry], {
    seed,
    conditions,
    catalog: CATALOG,
    tow: false,
  });
  const brain = new AiBrain({
    seed,
    difficulty: car.difficulty,
    ...(car.style ? { style: car.style } : {}),
    shortcuts,
  });
  let walls = 0;
  let mask = 0;
  for (let i = 0; i < TICK_LIMIT && race.phase !== 'FINISHED'; i++) {
    stepRaceWithBrains(race, [], [brain]);
    mask |= brain.routeMask;
    for (const e of race.events) if (e.type === 'wall') walls++;
  }
  const t = race.result?.cars[0]?.finishTimeMs;
  return {
    seconds: t === undefined || t === null ? null : t / 1000,
    walls,
    mask,
    gains: brain.plan?.shortcuts.map((s) => s.gain) ?? [],
  };
}
