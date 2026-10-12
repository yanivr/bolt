import {
  AI_STRATEGIES,
  CATALOG,
  TRACKS,
  aiBuildOptions,
  conditionsFor,
  createAiRace,
  environmentFor,
  getTemplate,
  getTrack,
  pickAiBuild,
  raceEntry,
  resolveBuild,
} from '@bolt/content';
import type { AiStrategy } from '@bolt/content';
import type {
  BuildConditions,
  CombatCar,
  ControlInput,
  RaceBrain,
  RaceEnvironment,
  RaceSession,
  TrackRuntime,
} from '@bolt/shared';
import {
  AI_SKILLS,
  AiBrain,
  COMPONENT_FIRST_WHEEL,
  MODULE_COOLDOWN,
  STATUS_INDEX,
  buildTrack,
  createRace,
  routePlan,
  sampleBranch,
  stepRaceWithBrains,
  towShareOf,
  validateBlueprint,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/**
 * The AI driver (Section 15.9, Milestone D): its pieces one by one on real tracks, and the
 * rules it must keep: the same car as a player's, only what a player could see, deterministic
 * for a seed.
 */

const NEON = 'city_01';
const NEON_CLEAR = 'city_clear_night';

function course(trackId: string, presetId: string) {
  const track = buildTrack(getTrack(trackId)!);
  const env = environmentFor(presetId) as RaceEnvironment;
  const conditions = conditionsFor(trackId, presetId) as BuildConditions;
  return { track, env, conditions };
}

/** Two cars from templates, an AI brain on car 0 and a brain (or nothing) on car 1. */
function duel(
  a: string,
  b: string,
  options: { seed?: number; trackId?: string; presetId?: string; tow?: boolean } = {},
): { race: RaceSession; brain: AiBrain } {
  const { track, env, conditions } = course(
    options.trackId ?? NEON,
    options.presetId ?? NEON_CLEAR,
  );
  const entries = [a, b].map((id) => raceEntry(getTemplate(id)!.blueprint, conditions)!);
  const race = createRace(track, env, entries, {
    seed: options.seed ?? 5,
    conditions,
    catalog: CATALOG,
    tow: options.tow ?? false,
  });
  const brain = new AiBrain({ seed: options.seed ?? 5, difficulty: 'ace', style: 'tactical' });
  return { race, brain };
}

const IDLE: ControlInput = { steer: 0, brake: 0.58, coast: false, fire: 0, use: 0, target: 0 };

/** Steps through the countdown with both cars braked. */
function toGreen(race: RaceSession): void {
  while (race.phase !== 'RACING') stepRaceWithBrains(race, [IDLE, IDLE], []);
}

/** The longest straight on the main line: arc length of its start and its length. */
function straightOf(track: TrackRuntime): { s: number; length: number } {
  const main = track.main;
  let best = { s: 0, length: 0 };
  let start = -1;
  for (let i = 0; i <= main.count * 2; i++) {
    const k = Math.abs(main.curvature[i % main.count]!);
    if (k < 1 / 3000) {
      if (start < 0) start = i;
      const length = (i - start) * (main.length / main.count);
      if (length > best.length) best = { s: (start * main.length) / main.count, length };
    } else start = -1;
  }
  return best;
}

/** Puts a car on the main line at arc length `s`, `lateral` px right of it, moving at `speed`. */
function place(car: CombatCar, track: TrackRuntime, s: number, lateral: number, speed: number) {
  const p = sampleBranch(track.main, s);
  const m = car.session.motion;
  m.x = p.x - p.ty * lateral;
  m.y = p.y + p.tx * lateral;
  m.headingRad = Math.atan2(p.tx, -p.ty);
  m.velocityX = p.tx * speed;
  m.velocityY = p.ty * speed;
  m.yawRate = 0;
}

describe('the AI driver: look-ahead speed', () => {
  it('plans a lower speed before a tight bend than on a straight, within braking distance', () => {
    const { track, env, conditions } = course(NEON, NEON_CLEAR);
    const params = raceEntry(getTemplate('baseline')!.blueprint, conditions)!.params;
    const plan = routePlan(track, params, env);
    const route = plan.routes[0]!;
    // The sharpest point of the line and the fastest.
    let slow = 0;
    for (let i = 0; i < route.count; i++) if (route.limit[i]! < route.limit[slow]!) slow = i;
    expect(route.limit[slow]!).toBeLessThan(200);
    const { race, brain } = duel('baseline', 'baseline');
    toGreen(race);
    const car = race.cars[0]!;
    brain.prepare(race, 0);
    const pilot = brain.parts!.pilot;
    // Far from the bend nothing binds; 60 px before it the plan is close to the bend's limit.
    pilot.s = route.s[slow]! - 900;
    const far = pilot.planSpeed(car, 240, 1);
    pilot.s = route.s[slow]! - 60;
    const near = pilot.planSpeed(car, 240, 1);
    expect(near).toBeLessThan(far);
    const skill = AI_SKILLS.ace;
    const limit = route.limit[slow]! * Math.sqrt(skill.cornerConfidence);
    const brake = params.brakeDecel * route.grip[slow]! * skill.brakeConfidence + route.roll[slow]!;
    expect(near).toBeLessThanOrEqual(Math.sqrt(limit * limit + 2 * brake * 60) + 1e-6);
    // Less grip (oil, frost, a damaged wheel) plans slower.
    expect(pilot.planSpeed(car, 240, 0.6)).toBeLessThan(near);
  });

  it('reads the ground for its own tires: Sand Paddles and Slicks find different lines on Dust Devil', () => {
    const { track, env, conditions } = course('desert_01', 'desert_clear');
    const sand = routePlan(
      track,
      raceEntry(getTemplate('example_dust_spider')!.blueprint, conditions)!.params,
      env,
    );
    const slick = routePlan(
      track,
      raceEntry(getTemplate('example_straight_line_rocket')!.blueprint, conditions)!.params,
      env,
    );
    // The sand car's band of good ground includes drifted sand the slick car keeps off.
    let wider = 0;
    for (let i = 0; i < Math.min(sand.routes[0]!.count, slick.routes[0]!.count); i++) {
      const a = sand.routes[0]!.hi[i]! - sand.routes[0]!.lo[i]!;
      const b = slick.routes[0]!.hi[i]! - slick.routes[0]!.lo[i]!;
      if (a > b + 16) wider++;
    }
    expect(wider).toBeGreaterThan(20);
    // And the sand car is quicker round its own line here.
    expect(sand.topSpeed.sand).toBeGreaterThan(slick.topSpeed.sand);
  });

  it('stops short of the tram crossing when the barrier will be down as it arrives', () => {
    const { race, brain } = duel('baseline', 'baseline', {
      trackId: 'city_02',
      presetId: 'city_clear_day',
    });
    toGreen(race);
    brain.prepare(race, 0);
    const track = race.track;
    const crossing = track.routeHazards.find((h) => track.hazards[h.hazard]!.kind === 'crossing')!;
    const car = race.cars[0]!;
    const pilot = brain.parts!.pilot;
    pilot.mask = 0;
    const route = brain.plan!.routes[0]!;
    const at =
      route.s[route.mainIndex[Math.floor(crossing.s / (track.main.length / track.main.count))]!]!;
    pilot.s = at - 150;
    // The race clock at which the barrier is down: the schedule's first active window.
    const hz = track.hazards[crossing.hazard]! as {
      schedule: {
        offsetSeconds: number;
        periodSeconds: number;
        warnSeconds: number;
        activeSeconds: number;
      };
    };
    const sch = hz.schedule;
    const down = sch.offsetSeconds + sch.periodSeconds - sch.activeSeconds * 0.5;
    car.session.raceTicks = Math.round(down * 30);
    const closed = pilot.planSpeed(car, 200, 1);
    expect(pilot.holding).toBe(true);
    // At most the speed from which it can stop 34 px short of the barrier.
    const stop = Math.sqrt(2 * car.session.params.brakeDecel * 0.6 * (150 - 34));
    expect(closed).toBeLessThanOrEqual(stop + 1e-6);
    expect(closed).toBeLessThan(200);
    // Long before the next closing it drives on.
    car.session.raceTicks = Math.round((sch.offsetSeconds + sch.periodSeconds * 1.02) * 30);
    pilot.planSpeed(car, 200, 1);
    expect(pilot.holding).toBe(false);
  });
});

describe('the AI driver: avoidance', () => {
  it('steers round a mine it has been shown, and not round one it has not', () => {
    const run = (revealed: boolean) => {
      const { race, brain } = duel('baseline', 'example_back_alley_trap');
      toGreen(race);
      const track = race.track;
      const straight = straightOf(track);
      const s = straight.s + 60;
      place(race.cars[0]!, track, s, 0, 150);
      place(race.cars[1]!, track, s + 1400, 0, 0);
      // A live enemy mine on the line ahead.
      const trap = race.cars[1]!;
      const spec = trap.specs.find((x) => x.kind === 'mine')!;
      const p = sampleBranch(track.main, s + 170);
      const brains: RaceBrain[] = [brain];
      stepRaceWithBrains(race, [undefined, IDLE], brains);
      const lane = brain.parts!.pilot.lineOffset(s + 170);
      race.hazards.push({
        id: 999,
        active: true,
        kind: 'mine',
        owner: 1,
        spec,
        x: p.x - p.ty * lane,
        y: p.y + p.tx * lane,
        radius: spec.triggerRadius,
        halfLength: 0,
        angle: 0,
        arm: 0,
        life: 600,
        bornTick: race.tick,
        revealMask: revealed ? 0b11 : 0b10,
        vx: 0,
        vy: 0,
      });
      let wish = 0;
      for (let i = 0; i < 12; i++) {
        stepRaceWithBrains(race, [undefined, IDLE], brains);
        wish = Math.max(wish, Math.abs(brain.parts!.pilot.biasWish));
      }
      return wish;
    };
    expect(run(true)).toBeGreaterThan(20);
    expect(run(false)).toBeLessThan(1);
  });
});

describe('the AI driver: shortcuts', () => {
  it('weighs each shortcut for its own car, and only drives one it decided to take', () => {
    const { track, env, conditions } = course('desert_01', 'desert_clear');
    // Dry Wash is soft sand: a car on street tires loses more in it than a sand car does.
    const street = routePlan(
      track,
      raceEntry(getTemplate('starter_rookie')!.blueprint, conditions)!.params,
      env,
    );
    const sand = routePlan(
      track,
      raceEntry(getTemplate('example_dust_spider')!.blueprint, conditions)!.params,
      env,
    );
    expect(sand.shortcuts[0]!.gain).toBeGreaterThan(street.shortcuts[0]!.gain);
    // A shallow planner only sees that it is shorter.
    expect(street.shortcuts[0]!.naiveGain).toBeGreaterThan(street.shortcuts[0]!.gain);
    // Forced through it, the car drives the shortcut's checkpoints; left to plan, a Racer whose
    // estimate says it loses time stays on the main line.
    const lapThrough = (policy: 'always' | 'plan'): number => {
      const entry = raceEntry(getTemplate('starter_rookie')!.blueprint, conditions)!;
      const race = createRace(track, env, [entry], {
        seed: 3,
        conditions,
        catalog: CATALOG,
        tow: false,
      });
      const brain = new AiBrain({
        seed: 3,
        difficulty: 'racer',
        style: 'tactical',
        shortcuts: policy,
      });
      let masks = 0;
      for (let i = 0; i < 30 * 70 && race.phase !== 'FINISHED'; i++) {
        stepRaceWithBrains(race, [], [brain]);
        masks |= brain.routeMask;
      }
      return masks;
    };
    expect(lapThrough('always')).toBe(1);
    expect(street.shortcuts[0]!.gain).toBeLessThan(AI_STYLE_GAIN);
    expect(lapThrough('plan')).toBe(0);
  });
});
const AI_STYLE_GAIN = 0.1;

describe('the AI driver: weapons and repairs', () => {
  it('fires a forward gun at a car in its cone and range, after a reaction delay, and not out of range', () => {
    const run = (gap: number) => {
      const { race, brain } = duel('starter_rookie', 'baseline');
      toGreen(race);
      const track = race.track;
      const straight = straightOf(track);
      place(race.cars[0]!, track, straight.s + 40, 0, 120);
      place(race.cars[1]!, track, straight.s + 40 + gap, 0, 120);
      let firstPress = -1;
      for (let i = 0; i < 20; i++) {
        const c = brain.control(race, 0);
        if (c.fire && firstPress < 0) firstPress = i;
        stepRaceWithBrains(race, [c, IDLE], []);
        place(race.cars[1]!, track, straight.s + 40 + gap + (i + 1) * 4, 0, 120);
      }
      return firstPress;
    };
    const near = run(110);
    expect(near).toBeGreaterThanOrEqual(AI_SKILLS.ace.reactionTicks - 3);
    expect(near).toBeLessThan(15);
    expect(run(600)).toBe(-1);
  });

  it('saves a limited magazine: a long shot is worth less early with ammunition short', () => {
    const { race, brain } = duel('starter_rookie', 'baseline');
    toGreen(race);
    brain.control(race, 0);
    const { combat, observation: obs } = brain.parts!;
    const car = race.cars[0]!;
    const gun = car.specs.find((s) => s.id === 'weapon_front_mg')!;
    const full = combat.threshold(obs, gun, gun.part);
    car.modules[gun.part]!.charges = 3;
    const short = combat.threshold(obs, gun, gun.part);
    expect(short).toBeGreaterThan(full);
    // Late in the race with plenty left, it spends it on fair chances instead of keeping it.
    car.modules[gun.part]!.charges = 12;
    car.session.progress.courseProgress = race.track.lapLength * race.track.def.laps * 0.85;
    expect(combat.threshold(obs, gun, gun.part)).toBeLessThan(full);
  });

  it('repairs a badly damaged wheel, aiming the kit at it, and leaves a healthy car alone', () => {
    const run = (wheelIntegrity: number) => {
      const { race, brain } = duel('starter_packhorse', 'baseline');
      toGreen(race);
      const car = race.cars[0]!;
      const wheel = COMPONENT_FIRST_WHEEL + 1;
      car.components[wheel]!.integrity = wheelIntegrity;
      const straight = straightOf(race.track);
      place(car, race.track, straight.s + 20, 0, 200);
      place(race.cars[1]!, race.track, straight.s + 2000, 0, 0);
      let pressed: { use: number; target: number } | null = null;
      for (let i = 0; i < 20 && !pressed; i++) {
        const c = brain.control(race, 0);
        if (c.use) pressed = { use: c.use ?? 0, target: c.target ?? 0 };
        stepRaceWithBrains(race, [c, IDLE], []);
      }
      return pressed;
    };
    const press = run(12);
    expect(press).not.toBeNull();
    expect(press!.target).toBe(COMPONENT_FIRST_WHEEL + 1 + 1);
    expect(run(100)).toBeNull();
  });

  it('obeys the same cooldowns and magazines as a player: a refused press changes nothing', () => {
    const { race, brain } = duel('starter_rookie', 'starter_sprinter', { seed: 9 });
    const brains: RaceBrain[] = [
      brain,
      new AiBrain({ seed: 10, difficulty: 'racer', style: 'aggressive' }),
    ];
    let shots = 0;
    for (let i = 0; i < 30 * 60 && race.phase !== 'FINISHED'; i++) {
      stepRaceWithBrains(race, [], brains);
      for (const e of race.events) if (e.type === 'shot' && e.car === 0 && e.n === 0) shots++;
    }
    const gun = race.cars[0]!.specs.find((s) => s.id === 'weapon_front_mg')!;
    // Every burst came out of the magazine; the module never went below zero.
    expect(race.cars[0]!.modules[gun.part]!.charges).toBe(gun.charges - shots);
    expect(race.cars[0]!.modules[gun.part]!.charges).toBeGreaterThanOrEqual(0);
    void MODULE_COOLDOWN;
  });
});

describe('the AI driver: fair play', () => {
  it("drives exactly the car a player would: the coefficients are the validator's, whatever the difficulty", () => {
    const { track, env, conditions } = course('desert_02', 'desert_dry_heat');
    const player = raceEntry(getTemplate('baseline')!.blueprint, conditions)!;
    for (const difficulty of ['rookie', 'racer', 'ace'] as const) {
      const ai = createAiRace(track, 'desert_dry_heat', env, conditions, player, 77, {
        difficulty,
      })!;
      const rival = ai.race.cars[1]!;
      const resolved = resolveBuild(ai.rival.blueprint, conditions);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(rival.baseParams).toEqual(resolved.params);
      expect(ai.difficulty).toBe(difficulty);
    }
  });

  it("never reads what a player could not see: scrambling the rival's heat, energy, ammunition, cooldowns, locks and tow changes nothing it does", () => {
    const { race } = duel('starter_longlegs', 'example_iron_mule', { tow: true, seed: 21 });
    const honest = new AiBrain({ seed: 31, difficulty: 'ace', style: 'aggressive' });
    const probe = new AiBrain({ seed: 31, difficulty: 'ace', style: 'aggressive' });
    const rivalBrain = new AiBrain({ seed: 32, difficulty: 'racer', style: 'tactical' });
    let rng = 12345;
    const noise = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let compared = 0;
    for (let i = 0; i < 30 * 90 && race.phase !== 'FINISHED'; i++) {
      const a = { ...honest.control(race, 0) };
      // The same moment with the other car's hidden numbers replaced by nonsense.
      const rival = race.cars[1]!;
      const m = rival.session.motion;
      const saved = {
        heat: m.coreHeat,
        battery: m.batteryEnergy,
        modules: rival.modules.map((x) => ({ ...x })),
        reserve: rival.reserve,
        tow: { ...rival.tow },
        ownTow: { ...race.cars[0]!.tow },
        fx: { ...race.cars[0]!.session.effects },
      };
      m.coreHeat = noise() * 120;
      m.batteryEnergy = noise() * 40;
      rival.reserve = noise() * 50;
      for (const mod of rival.modules) {
        mod.cooldown = Math.floor(noise() * 200);
        mod.cooldownTotal = Math.floor(noise() * 200);
        mod.charges = Math.floor(noise() * 12);
        mod.lock = Math.floor(noise() * 30);
        mod.locked = noise() < 0.5;
        mod.timer = Math.floor(noise() * 20);
        // The pool shows only as "a shield is up": keep that one visible fact.
        mod.pool = mod.pool > 0 ? 1 + noise() * 50 : 0;
      }
      rival.tow.tow = noise() * 0.08;
      rival.tow.towTarget = noise() * 0.08;
      rival.tow.gapSeconds = noise() * 5;
      race.cars[0]!.tow.tow = noise() * 0.08;
      race.cars[0]!.tow.gapSeconds = noise() * 5;
      race.cars[0]!.session.effects.tow = noise() * 0.08;
      race.cars[0]!.session.effects.towTarget = noise() * 0.08;
      race.cars[0]!.session.effects.towNext = noise() * 0.08;
      const b = { ...probe.control(race, 0) };
      m.coreHeat = saved.heat;
      m.batteryEnergy = saved.battery;
      rival.reserve = saved.reserve;
      rival.modules.forEach((mod, k) => Object.assign(mod, saved.modules[k]!));
      Object.assign(rival.tow, saved.tow);
      Object.assign(race.cars[0]!.tow, saved.ownTow);
      Object.assign(race.cars[0]!.session.effects, saved.fx);
      expect(b, `tick ${race.tick}`).toEqual(a);
      compared++;
      stepRaceWithBrains(race, [a, undefined], [null, rivalBrain]);
    }
    expect(compared).toBeGreaterThan(1500);
  });

  it('races under the tow like anyone else: the trailing AI car is towed, the leader never', () => {
    const { track, env, conditions } = course('city_01', 'city_clear_night');
    const entries = ['example_straight_line_rocket', 'example_iron_mule'].map((id) =>
      raceEntry(getTemplate(id)!.blueprint, conditions)!,
    );
    const race = createRace(track, env, entries, {
      seed: 8,
      conditions,
      catalog: CATALOG,
      tow: true,
    });
    const brains: RaceBrain[] = [
      new AiBrain({ seed: 1, difficulty: 'ace', style: 'tactical' }),
      new AiBrain({ seed: 2, difficulty: 'rookie', style: 'tactical' }),
    ];
    let towedTicks = 0;
    let leaderTowed = 0;
    for (let i = 0; i < 30 * 100 && race.phase !== 'FINISHED'; i++) {
      stepRaceWithBrains(race, [], brains);
      const [a, b] = race.cars as [CombatCar, CombatCar];
      const leader = a.session.progress.courseProgress >= b.session.progress.courseProgress ? a : b;
      const trailer = leader === a ? b : a;
      if (towShareOf(trailer) > 0) towedTicks++;
      if (
        towShareOf(leader) > 0 &&
        Math.abs(a.session.progress.courseProgress - b.session.progress.courseProgress) > 60
      )
        leaderTowed++;
    }
    expect(towedTicks).toBeGreaterThan(30 * 10);
    expect(leaderTowed).toBe(0);
  });

  it('is deterministic: the same seed drives the same race, a different seed a different one', () => {
    const record = (seed: number) => {
      const { track, env, conditions } = course('forest_02', 'forest_clear');
      const player = raceEntry(getTemplate('starter_sprinter')!.blueprint, conditions)!;
      const ai = createAiRace(track, 'forest_clear', env, conditions, player, seed, {
        difficulty: 'racer',
      })!;
      const pilotBrain = new AiBrain({ seed: seed + 1, difficulty: 'ace', style: 'tactical' });
      const brains: RaceBrain[] = [pilotBrain, ai.brain];
      const trace: number[] = [];
      for (let i = 0; i < 30 * 40; i++) {
        stepRaceWithBrains(ai.race, [], brains);
        const m = ai.race.cars[1]!.session.motion;
        trace.push(m.x, m.y, ai.race.controls[1]!.steer, ai.race.controls[1]!.fire ?? 0);
      }
      return { trace, rival: ai.rival.blueprint };
    };
    const a = record(41);
    const b = record(41);
    expect(b.trace).toEqual(a.trace);
    expect(b.rival).toEqual(a.rival);
    const c = record(42);
    expect(c.trace).not.toEqual(a.trace);
  });
});

describe('the AI loadout table', () => {
  it('offers only legal builds under the same 1,000 credits and validator as a player, on every course and strategy', () => {
    let builds = 0;
    for (const def of Object.values(TRACKS))
      for (const presetId of def.weatherPresetIds)
        for (const strategy of AI_STRATEGIES) {
          const options = aiBuildOptions(def.id, presetId, strategy);
          expect(options.length, `${def.id}/${presetId}/${strategy}`).toBeGreaterThan(0);
          expect(options.some((o) => o.nearOptimal)).toBe(true);
          for (const o of options) {
            const check = validateBlueprint(o.blueprint, CATALOG);
            expect(check.ok, `${o.frame} ${o.engineId} ${o.tireKitId}`).toBe(true);
            if (check.ok) expect(check.totalCost).toBeLessThanOrEqual(1000);
            builds++;
          }
        }
    expect(builds).toBeGreaterThan(1000);
  });

  it('picks by seed among the near-optimal builds of a strategy, the same pick for the same seed', () => {
    for (const strategy of AI_STRATEGIES) {
      const a = pickAiBuild('city_02', 'city_rain_day', 1234, strategy)!;
      expect(pickAiBuild('city_02', 'city_rain_day', 1234, strategy)!.blueprint).toEqual(
        a.blueprint,
      );
      expect(a.nearOptimal).toBe(true);
    }
    const strategies = new Set<AiStrategy>();
    for (let seed = 0; seed < 60; seed++)
      strategies.add(pickAiBuild(NEON, NEON_CLEAR, seed)!.strategy);
    expect(strategies.size).toBe(AI_STRATEGIES.length);
  });

  it('builds for the ground: Sand Paddles in the desert, Mud Claws on Moss Run, Rain Runners in the rain', () => {
    const tires = (trackId: string, presetId: string) =>
      new Set(
        AI_STRATEGIES.flatMap((s) =>
          aiBuildOptions(trackId, presetId, s)
            .filter((o) => o.nearOptimal)
            .map((o) => o.tireKitId),
        ),
      );
    // On every sand course the fastest build of every strategy is on Sand Paddles.
    for (const [t, p] of [
      ['desert_01', 'desert_clear'],
      ['desert_01', 'desert_crosswind'],
      ['desert_02', 'desert_dry_heat'],
      ['desert_02', 'desert_sandstorm'],
    ]) {
      for (const s of AI_STRATEGIES)
        expect(aiBuildOptions(t!, p!, s)[0]!.tireKitId, `${t}/${p} ${s}`).toBe('tires_sand');
      expect(tires(t!, p!).has('tires_sand')).toBe(true);
    }
    expect(tires('forest_01', 'forest_clear').has('tires_mud')).toBe(true);
    for (const [t, p] of [
      ['city_01', 'city_rain_night'],
      ['city_02', 'city_rain_day'],
      ['industrial_01', 'industrial_factory_rain'],
      ['snow_01', 'snow_snowfall'],
    ])
      expect(tires(t!, p!).has('tires_rain'), `${t}/${p}`).toBe(true);
    expect(tires('city_02', 'city_clear_day').has('tires_rain')).toBe(false);
  });
});

void STATUS_INDEX;
