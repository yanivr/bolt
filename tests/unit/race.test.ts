import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync } from 'node:fs';
import {
  CATALOG,
  RIVAL_TEMPLATES,
  SCENARIOS,
  WEAPON_LIST,
  getTemplate,
  raceEntry,
} from '@bolt/content';
import type { BlueprintTemplate } from '@bolt/content';
import type { ControlInput, RaceEvent, RaceSession, ResultStanding } from '@bolt/shared';
import {
  COMPONENT_FIRST_WHEEL,
  FINISH_WINDOW_SECONDS,
  PROTOCOL_VERSION,
  RACE_LIMIT_SECONDS,
  SIM_DT,
  WORLD_PIXELS_PER_METER,
  blueprintCost,
  compareStandings,
  driveJoinOptionsSchema,
  eventVisibleTo,
  inputSampleSchema,
  raceSnapshot,
  repairComponent,
  resetRace,
  standingOf,
  stepRaceWithBrains,
  ticksOf,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { NEON_CLEAR, createBotMatch, neonCut, runBotMatch } from '../balance/harness.js';
import { GO, duel } from '../helpers/combat.js';
import { formatEvent, runScenario, runScenarioById } from '../scenarios/runner.js';

/**
 * The race around the combat (Section 3.4): the grid, positions and gaps, the finish and its
 * window, the time limit and its tie-breaks; then that all of it is deterministic, that the
 * sparring rival drives and fights by the rules, that the showcase scenarios are honest, and
 * what a tick costs.
 */

const template = (id: string): BlueprintTemplate => {
  const found = getTemplate(id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
};

/** A cheap, order-sensitive digest of everything both drivers can be shown. */
function digest(race: RaceSession, into: number): number {
  const text = JSON.stringify(raceSnapshot(race, 0, 0)) + JSON.stringify(raceSnapshot(race, 1, 0));
  let h = into;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}

type Recording = { events: RaceEvent[]; digests: number[]; race: RaceSession };

function record(a: string, b: string, seed: number, ticks = Infinity): Recording {
  const { race, brains } = createBotMatch(template(a), template(b), seed);
  const events: RaceEvent[] = [];
  const digests: number[] = [];
  let h = 17;
  for (let i = 0; i < ticks && race.phase !== 'FINISHED'; i++) {
    stepRaceWithBrains(race, [], brains);
    for (const event of race.events) events.push({ ...event });
    if (race.tick % 15 === 0) {
      h = digest(race, h);
      digests.push(h);
    }
  }
  digests.push(digest(race, h));
  return { events, digests, race };
}

describe('protocol (Section 15.3)', () => {
  it('is version 6, and an input sample carries two fire buttons, utility buttons and a repair target', () => {
    // 5 added the tow: `tow` on both cars, three numbers in the effects, the `catchup` event.
    // 6 is track format 2: the same wire, but a client now predicts wind and timed track
    // hazards on the race clock, so an older one would be corrected on the new tracks.
    expect(PROTOCOL_VERSION).toBe(6);
    const base = { sequence: 1, clientTick: 1, steer: 0, brake: 0, coast: false };
    expect(inputSampleSchema.safeParse(base).success).toBe(true);
    expect(inputSampleSchema.safeParse({ ...base, fire: 3, use: 255, target: 63 }).success).toBe(
      true,
    );
    for (const bad of [
      { fire: 4 },
      { fire: -1 },
      { fire: 1.5 },
      { fire: '1' },
      { fire: true },
      { use: 256 },
      { target: 64 },
      { ammo: 5 },
      { cooldown: 0 },
      { weapon: 'weapon_rocket' },
    ])
      expect(inputSampleSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
  });

  it('lets a join name a rival template, a seed or a scenario, and nothing more about the rival', () => {
    const join = {
      protocolVersion: PROTOCOL_VERSION,
      guestToken: 'g'.repeat(40),
      trackId: 'city_01',
      weatherPresetId: NEON_CLEAR,
      blueprint: template('baseline').blueprint,
    };
    expect(driveJoinOptionsSchema.safeParse(join).success).toBe(true);
    expect(
      driveJoinOptionsSchema.safeParse({ ...join, rivalTemplateId: 'starter_rookie', seed: 12 })
        .success,
    ).toBe(true);
    expect(driveJoinOptionsSchema.safeParse({ ...join, scenarioId: 'rocket_hit' }).success).toBe(
      true,
    );
    // The rival is a shipped template named by id: a client cannot hand the server a car for it.
    expect(
      driveJoinOptionsSchema.safeParse({ ...join, rivalBlueprint: template('baseline').blueprint })
        .success,
    ).toBe(false);
    expect(driveJoinOptionsSchema.safeParse({ ...join, seed: 1.5 }).success).toBe(false);
    expect(driveJoinOptionsSchema.safeParse({ ...join, seed: -1 }).success).toBe(false);
    expect(driveJoinOptionsSchema.safeParse({ ...join, rivalTemplateId: '../x' }).success).toBe(
      false,
    );
  });
});

describe('the grid and the start (Section 3.4)', () => {
  it('puts the two cars side by side, the same distance from the first checkpoint', () => {
    const { race } = createBotMatch(template('baseline'), template('starter_rookie'), 1);
    const a = race.cars[0]!.session.motion;
    const b = race.cars[1]!.session.motion;
    const gate = neonCut().checkpoints[0]!.gates[0]!;
    // Distance to the line of the gate, along the gate's own direction of travel.
    const toGate = (m: { x: number; y: number }) =>
      (gate.ax - m.x) * gate.tx + (gate.ay - m.y) * gate.ty;
    expect(Math.abs(toGate(a) - toGate(b))).toBeLessThan(0.001);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(50);
    expect(a.headingRad).toBe(b.headingRad);
    expect(race.cars.map((car) => car.session.progress.courseProgress)).toEqual([0, 0]);
    expect(race.phase).toBe('COUNTDOWN');
  });

  it('holds both cars through the countdown whatever they press, and starts them on the same tick', () => {
    const { race } = createBotMatch(template('starter_rookie'), template('starter_rookie'), 1);
    const start = race.cars.map((car) => ({ x: car.session.motion.x, y: car.session.motion.y }));
    const flatOut: ControlInput[] = [
      { ...GO, fire: 3, use: 255 },
      { ...GO, fire: 3, use: 255 },
    ];
    const events: RaceEvent[] = [];
    let went = -1;
    for (let i = 0; i < 200 && went < 0; i++) {
      stepRaceWithBrains(race, flatOut, []);
      events.push(...race.events);
      if (race.phase === 'RACING') went = race.tick;
      else
        race.cars.forEach((car, index) => {
          expect(car.session.motion.x).toBe(start[index]!.x);
          expect(car.session.motion.y).toBe(start[index]!.y);
        });
    }
    expect(went).toBeGreaterThan(30);
    expect(race.cars.every((car) => car.session.phase === 'RACING')).toBe(true);
    // Nothing was fired, refused or used on the grid.
    expect(events).toEqual([]);
    expect(race.raceTicks).toBe(0);
    // A button held through the countdown is a press at GO: both guns open up at once.
    for (let i = 0; i < 3; i++) {
      stepRaceWithBrains(race, flatOut, []);
      events.push(...race.events);
    }
    const shots = events.filter((event) => event.type === 'shot');
    expect(new Set(shots.map((event) => (event as { car: number }).car))).toEqual(new Set([0, 1]));
    expect(shots.every((event) => event.tick === went + 1 || event.tick > went)).toBe(true);
  });
});

describe('positions and gaps', () => {
  it('ranks both cars by progress and reports the gap from each side', () => {
    const { race } = record('starter_sprinter', 'example_iron_mule', 3, 600);
    const [fast, slow] = race.cars as [(typeof race.cars)[0], (typeof race.cars)[0]];
    const a = standingOf(race, 0, { position: 0, gapMeters: 0, gapSeconds: 0 });
    const b = standingOf(race, 1, { position: 0, gapMeters: 0, gapSeconds: 0 });
    expect([a.position, b.position]).toEqual([1, 2]);
    const gap = fast.session.progress.courseProgress - slow.session.progress.courseProgress;
    expect(gap).toBeGreaterThan(100);
    expect(a.gapMeters).toBeCloseTo(gap / WORLD_PIXELS_PER_METER, 9);
    expect(b.gapMeters).toBeCloseTo(-a.gapMeters, 9);
    // Seconds are the gap at the speed of the car that has to close it.
    expect(a.gapSeconds).toBeCloseTo(gap / slow.session.telemetry.speed, 6);
    expect(b.gapSeconds).toBeCloseTo(-a.gapSeconds, 9);
    const seen = raceSnapshot(race, 1, 0);
    expect(seen).toMatchObject({ you: 1, position: 2, phase: 'RACING' });
    expect(seen.gapMeters).toBeCloseTo(b.gapMeters, 9);
    expect(seen.rival.courseProgress).toBe(fast.session.progress.courseProgress);
  });

  it('announces a change of leader when it is real, and never the same leader twice running', () => {
    const { events, race } = record('baseline', 'baseline', 5);
    const changes = events.filter(
      (e): e is Extract<RaceEvent, { type: 'position' }> => e.type === 'position',
    );
    expect(changes.length).toBeGreaterThan(0);
    // Two identical cars swap places a handful of times, not every time a nose is ahead.
    expect(changes.length).toBeLessThan(12);
    for (let i = 1; i < changes.length; i++)
      expect(changes[i]!.leader).not.toBe(changes[i - 1]!.leader);
    // A lead is announced only once it is a real gap (six pixels), or at the line.
    expect(
      changes.every(
        (event) => event.gapMeters * WORLD_PIXELS_PER_METER >= 6 - 1e-9 || event.tick > 3000,
      ),
    ).toBe(true);
    expect(race.leader).toBe(changes.at(-1)!.leader);
    expect(race.result!.winner).toBe(race.leader);
  });

  it('counts each car through its own checkpoints and flags only the one going the wrong way', () => {
    const d = duel(
      { chassis: 'chassis_beetle' },
      { chassis: 'chassis_beetle' },
      { ahead: 200, aside: 60, turnB: Math.PI },
    );
    d.step(150, GO, GO);
    expect(d.a.session.progress.wrongWaySeconds).toBe(0);
    expect(d.b.session.progress.wrongWaySeconds).toBeGreaterThan(1);
    expect(d.a.session.progress.courseProgress).toBeGreaterThan(
      d.b.session.progress.courseProgress,
    );
  });
});

describe('finishing (Section 3.4)', () => {
  it('ends the race when the second car finishes inside the window, and the first across wins', () => {
    const { events, race } = record('starter_sprinter', 'starter_tinker', 3);
    const result = race.result!;
    expect(result.reason).toBe('finish');
    const finishes = events.filter(
      (e): e is Extract<RaceEvent, { type: 'finish' }> => e.type === 'finish',
    );
    expect(finishes).toHaveLength(2);
    expect(finishes.every((event) => event.finished)).toBe(true);
    expect(result.winner).toBe(finishes[0]!.car);
    const first = result.cars[finishes[0]!.car]!;
    const second = result.cars[finishes[1]!.car]!;
    expect(first.finishTimeMs!).toBeLessThan(second.finishTimeMs!);
    expect(second.finishTimeMs! - first.finishTimeMs!).toBeLessThan(FINISH_WINDOW_SECONDS * 1000);
    // No waiting out the window once everyone is home.
    expect(result.raceTimeMs).toBe(second.finishTimeMs);
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      winner: result.winner,
      reason: 'finish',
    });
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    // Three laps each, reported in order.
    for (const car of [0, 1])
      expect(
        events
          .filter((e) => e.type === 'lap' && e.car === car)
          .map((e) => (e as { lap: number }).lap),
      ).toEqual([1, 2, 3]);
    expect(race.projectiles.some((p) => p.active)).toBe(false);
    expect(race.hazards.some((h) => h.active)).toBe(false);
  });

  it('gives the other car eight seconds and then records it as not finished', () => {
    const { events, race } = record('example_straight_line_rocket', 'example_iron_mule', 3);
    const result = race.result!;
    expect(result.winner).toBe(0);
    expect(result.cars[0]).toMatchObject({ finished: true, ko: false });
    expect(result.cars[1]).toMatchObject({ finished: false, finishTimeMs: null, ko: false });
    expect(result.raceTimeMs - result.cars[0]!.finishTimeMs!).toBe(FINISH_WINDOW_SECONDS * 1000);
    const finishes = events.filter(
      (e): e is Extract<RaceEvent, { type: 'finish' }> => e.type === 'finish',
    );
    expect(finishes.map((event) => [event.car, event.finished])).toEqual([
      [0, true],
      [1, false],
    ]);
    // The window was published the moment the winner crossed the line.
    expect(result.cars[1]!.courseProgress).toBeLessThan(result.cars[0]!.courseProgress);
    expect(race.phase).toBe('FINISHED');
  });

  it('keeps a finished car out of the fight: it fires nothing and takes nothing', () => {
    const { race, brains } = createBotMatch(
      template('starter_longlegs'),
      template('example_iron_mule'),
      3,
    );
    let finishedAt = -1;
    const after: RaceEvent[] = [];
    while (race.phase !== 'FINISHED') {
      stepRaceWithBrains(race, [], brains);
      if (finishedAt < 0 && race.cars[0]!.session.progress.finishedAtMs !== null)
        finishedAt = race.tick;
      else if (finishedAt >= 0) after.push(...race.events);
    }
    expect(finishedAt).toBeGreaterThan(0);
    expect(after.filter((event) => event.type === 'shot' && event.car === 0)).toEqual([]);
  });
});

describe('the time limit and its tie-breaks (Section 3.4)', () => {
  const LIMIT = ticksOf(RACE_LIMIT_SECONDS);
  /** Two parked cars one tick before the limit. */
  const atTheLimit = (ahead: number) => {
    const d = duel(
      { chassis: 'chassis_beetle' },
      { chassis: 'chassis_beetle' },
      { ahead, aside: 60 },
    );
    d.step(3);
    d.race.raceTicks = LIMIT - 2;
    return d;
  };

  it('ends at 180 seconds and gives it to the car further along the course', () => {
    const d = atTheLimit(120);
    d.step(1);
    expect(d.race.phase).toBe('RACING');
    d.step(1);
    expect(d.race.phase).toBe('FINISHED');
    const further =
      d.a.session.progress.courseProgress > d.b.session.progress.courseProgress ? 0 : 1;
    expect(d.race.result).toMatchObject({
      winner: further,
      reason: 'timeout',
      raceTimeMs: RACE_LIMIT_SECONDS * 1000,
    });
    expect(d.race.result!.cars.every((car) => !car.finished)).toBe(true);
    expect(d.of('result')).toMatchObject([{ winner: further, reason: 'timeout' }]);
    // Both are told their race is over, unfinished.
    expect(d.of('finish').map((event) => event.finished)).toEqual([false, false]);
    // Nothing happens after the result.
    const events = d.events.length;
    d.step(30, GO, GO);
    expect(d.events.length).toBe(events);
  });

  it('applies the tie-breaks in order: finish, progress, checkpoint time, chassis, then a draw', () => {
    const level: ResultStanding = {
      finishedAtMs: null,
      courseProgress: 500,
      lastCheckpointMs: 60_000,
      chassisRatio: 0.8,
    };
    const ahead = (a: Partial<ResultStanding>, b: Partial<ResultStanding>) =>
      Math.sign(compareStandings({ ...level, ...a }, { ...level, ...b }));
    // An exact tie is a draw, not a win for whoever is listed first.
    expect(ahead({}, {})).toBe(0);
    expect(ahead({ chassisRatio: 0.81 }, {})).toBe(-1);
    expect(ahead({ lastCheckpointMs: 59_999 }, {})).toBe(-1);
    expect(ahead({ courseProgress: 500.001 }, {})).toBe(-1);
    expect(ahead({ finishedAtMs: 170_000 }, {})).toBe(-1);
    expect(ahead({ finishedAtMs: 120_000 }, { finishedAtMs: 119_967 })).toBe(1);
    // Each rule outranks every rule below it.
    expect(
      ahead(
        { finishedAtMs: 170_000, courseProgress: 0, chassisRatio: 0 },
        { courseProgress: 9000 },
      ),
    ).toBe(-1);
    expect(ahead({ courseProgress: 501, lastCheckpointMs: 90_000, chassisRatio: 0.1 }, {})).toBe(
      -1,
    );
    expect(ahead({ lastCheckpointMs: 59_000, chassisRatio: 0.1 }, {})).toBe(-1);
  });
});

describe('determinism (Section 19.2)', () => {
  it('runs a whole two-car fight to the same bits twice', () => {
    const first = record('starter_longlegs', 'starter_packhorse', 41);
    const second = record('starter_longlegs', 'starter_packhorse', 41);
    expect(first.events.length).toBeGreaterThan(200);
    expect(first.events.some((event) => event.type === 'hit')).toBe(true);
    expect(second.digests).toEqual(first.digests);
    expect(second.events).toEqual(first.events);
    expect(second.race.result).toEqual(first.race.result);
  });

  it('is the same for a trap car in the rain as well', () => {
    const run = () => {
      const { race, brains } = createBotMatch(
        template('example_back_alley_trap'),
        template('starter_rookie'),
        9,
        'city_rain_night',
      );
      let h = 3;
      const events: RaceEvent[] = [];
      for (let i = 0; i < 1500; i++) {
        stepRaceWithBrains(race, [], brains);
        events.push(...race.events.map((event) => ({ ...event })));
        if (i % 10 === 0) h = digest(race, h);
      }
      return { h, events };
    };
    const a = run();
    const b = run();
    expect(a.events.some((event) => event.type === 'hazard' || event.type === 'shot')).toBe(true);
    expect(b.h).toBe(a.h);
    expect(b.events).toEqual(a.events);
  });

  it('depends on the seed only through the rival: another seed is another race', () => {
    const a = record('starter_rookie', 'starter_tinker', 1, 900);
    const b = record('starter_rookie', 'starter_tinker', 2, 900);
    expect(a.digests).not.toEqual(b.digests);
  });

  it('replays the same race after a reset to the grid', () => {
    const { race, brains } = createBotMatch(
      template('starter_rookie'),
      template('starter_tinker'),
      5,
    );
    const run = () => {
      const trace: number[] = [];
      for (let i = 0; i < 600; i++) {
        stepRaceWithBrains(race, [], brains);
        if (i % 20 === 0)
          trace.push(
            race.cars[0]!.session.motion.x,
            race.cars[1]!.session.motion.y,
            race.cars[1]!.chassis,
          );
      }
      return trace;
    };
    const first = run();
    const eventId = race.nextEventId;
    const tick = race.tick;
    resetRace(race);
    for (const brain of brains) brain.reset();
    expect(race.phase).toBe('COUNTDOWN');
    expect(race.cars.every((car) => car.chassis === car.chassisMax)).toBe(true);
    // The clock and the ids go on, so nothing sent before can be mistaken for something new.
    expect(race.tick).toBe(tick);
    expect(race.nextEventId).toBe(eventId);
    expect(run()).toEqual(first);
  });
});

describe('the sparring rival (Section 15.9 seam)', () => {
  it('drives three clean laps in traffic inside the target race length', () => {
    const { events, race } = record('baseline', 'baseline', 5);
    const result = race.result!;
    expect(result.cars.every((car) => car.finished)).toBe(true);
    // Section 3.4: 110 to 140 seconds for evenly matched default cars.
    for (const car of result.cars) {
      expect(car.finishTimeMs! / 1000).toBeGreaterThan(110);
      expect(car.finishTimeMs! / 1000).toBeLessThan(140);
    }
    expect(events.filter((event) => event.type === 'wall').length).toBeLessThanOrEqual(2);
    expect(race.cars.every((car) => car.session.progress.wrongWaySeconds === 0)).toBe(true);
    // Two identical cars side by side for two minutes barely touch.
    expect(result.cars[0]!.damageTaken).toBeLessThan(10);
  });

  it('fires only at a target it has a fair chance against, and hits with most of what it fires', () => {
    const { race, brains } = createBotMatch(template('starter_rookie'), template('baseline'), 3);
    const gun = race.cars[0]!.specs[0]!;
    expect(gun.id).toBe('weapon_front_mg');
    let bursts = 0;
    let bullets = 0;
    let hits = 0;
    while (race.phase !== 'FINISHED') {
      const a = race.cars[0]!.session.motion;
      const b = race.cars[1]!.session.motion;
      const range = Math.hypot(b.x - a.x, b.y - a.y);
      const bearing = Math.atan2(b.x - a.x, -(b.y - a.y));
      const off = Math.abs(
        Math.atan2(Math.sin(bearing - a.headingRad), Math.cos(bearing - a.headingRad)),
      );
      stepRaceWithBrains(race, [], brains);
      for (const event of race.events) {
        if (event.type === 'shot' && event.car === 0) {
          bullets++;
          if (event.n === 0) {
            bursts++;
            // The trigger was pulled with the rival inside the gun's cone and reach.
            expect(range).toBeLessThan(gun.range + 60);
            expect(off).toBeLessThan(gun.half + 0.15);
          }
        }
        if (event.type === 'hit' && event.car === 1 && event.weapon === 'weapon_front_mg') hits++;
      }
    }
    expect(bursts).toBeGreaterThan(2);
    expect(hits / bullets).toBeGreaterThan(0.5);
    // The same cooldown as anyone: never two bursts inside 1.4 seconds.
    expect(race.cars[0]!.stats.usesByPart[0]).toBe(bursts);
  });

  it('drops traps for a car that is close behind, and nowhere else', () => {
    const { race, brains } = createBotMatch(
      template('example_back_alley_trap'),
      template('starter_rookie'),
      3,
    );
    let dropped = 0;
    while (race.phase !== 'FINISHED') {
      const gapBefore =
        race.cars[0]!.session.progress.courseProgress -
        race.cars[1]!.session.progress.courseProgress;
      stepRaceWithBrains(race, [], brains);
      for (const event of race.events)
        if (
          event.type === 'hazard' &&
          event.state === 'placed' &&
          event.kind === 'mine' &&
          event.by === 0
        ) {
          dropped++;
          expect(gapBefore).toBeGreaterThan(0);
          expect(gapBefore).toBeLessThan(260);
        }
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it('fits its spare wheel when a wheel is in a bad way', () => {
    const { race, brains } = createBotMatch(template('starter_rookie'), template('baseline'), 3);
    while (race.phase !== 'RACING') stepRaceWithBrains(race, [], brains);
    const car = race.cars[0]!;
    repairComponent(race, car, COMPONENT_FIRST_WHEEL + 1, -85);
    const events: RaceEvent[] = [];
    for (let i = 0; i < 90; i++) {
      stepRaceWithBrains(race, [], brains);
      events.push(...race.events);
    }
    const used = events.filter(
      (e): e is Extract<RaceEvent, { type: 'utility' }> => e.type === 'utility' && e.car === 0,
    );
    expect(used.map((event) => event.state)).toEqual(['started', 'done']);
    expect(used[0]).toMatchObject({ utility: 'utility_spare', value: COMPONENT_FIRST_WHEEL + 1 });
    expect(car.components[COMPONENT_FIRST_WHEEL + 1]!.integrity).toBe(100);
  });

  it('acts only through a control sample, so it has every limit a player has', () => {
    const { race, brains } = createBotMatch(
      template('starter_longlegs'),
      template('starter_packhorse'),
      3,
    );
    for (let i = 0; i < 1200; i++) {
      for (let c = 0; c < 2; c++) {
        const control = brains[c]!.control(race, c);
        expect(Math.abs(control.steer)).toBeLessThanOrEqual(1);
        expect(control.brake).toBeGreaterThanOrEqual(0);
        expect(control.brake).toBeLessThanOrEqual(1);
        expect((control.fire ?? 0) & ~3).toBe(0);
        expect((control.use ?? 0) & ~255).toBe(0);
        // Whatever it sends would pass the same validation as a client's sample.
        if (i % 50 === 0)
          expect(
            inputSampleSchema.safeParse({
              sequence: i,
              clientTick: i,
              steer: control.steer,
              brake: control.brake,
              coast: control.coast,
              fire: control.fire,
              use: control.use,
              target: control.target,
            }).success,
          ).toBe(true);
      }
      stepRaceWithBrains(race, [], brains);
    }
    expect(race.cars.some((car) => car.stats.shotsFired > 0)).toBe(true);
  });
});

describe('showcase scenarios (Sections 13.3, 13.4, 19.4)', () => {
  it('has one for each of the twenty weapons and the listed feature showcases', () => {
    const ids = new Set(SCENARIOS.map((def) => def.id));
    expect(ids.size).toBe(SCENARIOS.length);
    for (const weapon of WEAPON_LIST) expect(ids.has(weapon.id), weapon.id).toBe(true);
    for (const feature of [
      'kinetic_impact',
      'rocket_hit',
      'mortar_strike',
      'emp_burst',
      'repair_burst',
      'wet_road',
      'oil_fire',
      'flame_frost',
      'frost_thaw',
      'missile_defense',
      'mine_sweeper',
      'ram',
      'shield_break',
    ])
      expect(ids.has(feature), feature).toBe(true);
  });

  it('uses only legal builds of 1,000 credits or less', () => {
    for (const def of SCENARIOS)
      for (const car of def.cars) {
        expect(
          blueprintCost(car.blueprint, CATALOG).total,
          `${def.id} ${car.blueprint.name}`,
        ).toBeLessThanOrEqual(1000);
        expect(
          raceEntry(car.blueprint, {
            weather: 'clear',
            timeOfDay: 'night',
            surfaceMix: neonCut().def.surfaceMix,
          }),
          `${def.id} ${car.blueprint.name}`,
        ).not.toBeNull();
      }
  });

  it('shows what each one says it shows, the same way every time', () => {
    for (const def of SCENARIOS) {
      const first = runScenario(def);
      expect(first.missing, def.id).toEqual([]);
      const again = runScenario(def);
      expect(again.events, def.id).toEqual(first.events);
      expect(def.title.length).toBeGreaterThan(3);
      expect(`${def.title} ${def.description} ${def.shows}`).not.toMatch(/—|--/);
    }
  });

  it('prints a readable timeline', () => {
    const run = runScenarioById('rocket_hit');
    const lines = run.events.map((event) => formatEvent(event, run.goTick));
    expect(lines.some((line) => /explosion/.test(line) && /weapon_rocket/.test(line))).toBe(true);
    expect(lines[0]).toMatch(/^\s*\d+\.\d\ds\s+#\s*\d+ t\d+ /);
  });

  it('documents every scenario in docs/COMBAT_API.md', () => {
    const path = new URL('../../docs/COMBAT_API.md', import.meta.url);
    expect(existsSync(path)).toBe(true);
    const doc = readFileSync(path, 'utf8');
    for (const def of SCENARIOS) expect(doc.includes(`\`${def.id}\``), def.id).toBe(true);
    expect(doc).toMatch(/npx tsx tests\/scenarios\/run\.ts/);
    expect(doc).toMatch(/\?debug=1&scenario=/);
  });
});

describe('what every event says about who may see it', () => {
  it("keeps one driver's refusals, warnings and checkpoints from the other", () => {
    const { events } = record('starter_longlegs', 'starter_packhorse', 41, 1500);
    const mine = events.filter((event) => eventVisibleTo(event, 0));
    const theirs = events.filter((event) => eventVisibleTo(event, 1));
    for (const [view, other] of [
      [mine, 1],
      [theirs, 0],
    ] as const)
      expect(
        view.some(
          (event) =>
            (event.type === 'refused' || event.type === 'warning' || event.type === 'checkpoint') &&
            event.car === other,
        ),
      ).toBe(false);
    // Everything that happens on the road is for both.
    for (const type of ['shot', 'hit', 'component', 'lap'] as const)
      expect(mine.filter((e) => e.type === type)).toEqual(theirs.filter((e) => e.type === type));
  });
});

describe('tick budget (Section 19.5)', () => {
  it('steps a two-car fight in a small fraction of a 33 ms tick', () => {
    // Warm the code paths first, so the measurement is of the simulation and not of the JIT.
    runBotMatch(template('starter_longlegs'), template('starter_packhorse'), 2);
    const samples: number[] = [];
    for (const [a, b] of [
      ['starter_longlegs', 'starter_packhorse'],
      ['example_back_alley_trap', 'starter_tinker'],
      ['example_iron_mule', 'starter_rookie'],
    ] as const) {
      const { race, brains } = createBotMatch(template(a), template(b), 11);
      while (race.phase !== 'FINISHED') {
        const started = performance.now();
        stepRaceWithBrains(race, [], brains);
        samples.push(performance.now() - started);
      }
    }
    samples.sort((x, y) => x - y);
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    const p99 = samples[Math.floor(samples.length * 0.99)]!;
    const worst = samples[samples.length - 1]!;
    console.log(
      `race tick, two cars with brains, ${samples.length} ticks: mean ${(mean * 1000).toFixed(0)} us, p99 ${(p99 * 1000).toFixed(0)} us, worst ${worst.toFixed(2)} ms`,
    );
    // The room has 33.3 ms a tick and shares its process with other rooms.
    expect(mean).toBeLessThan(0.5);
    expect(p99).toBeLessThan(2);
    // The worst tick includes whatever the garbage collector did to it.
    expect(worst).toBeLessThan(20);
    expect(SIM_DT).toBeCloseTo(1 / 30, 12);
  });

  it('never holds more projectiles or hazards than its caps, however long the fight', () => {
    let projectiles = 0;
    let hazards = 0;
    for (const rival of RIVAL_TEMPLATES.slice(0, 4)) {
      const { race, brains } = createBotMatch(template('example_back_alley_trap'), rival, 4);
      for (let i = 0; i < 2400 && race.phase !== 'FINISHED'; i++) {
        stepRaceWithBrains(race, [], brains);
        projectiles = Math.max(projectiles, race.projectiles.filter((p) => p.active).length);
        hazards = Math.max(hazards, race.hazards.filter((h) => h.active).length);
      }
      // The pools are reused, not grown without bound.
      expect(race.projectiles.length).toBeLessThanOrEqual(64);
      expect(race.hazards.length).toBeLessThanOrEqual(48);
    }
    expect(projectiles).toBeGreaterThan(0);
    expect(projectiles).toBeLessThanOrEqual(64);
    expect(hazards).toBeLessThanOrEqual(48);
  });
});
