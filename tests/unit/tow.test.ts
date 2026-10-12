import {
  ALL_SCENARIOS,
  CATALOG,
  RIVAL_TEMPLATES,
  SCENARIOS,
  TOW_SCENARIO,
  WEAPON_LIST,
  getScenario,
  getTemplate,
} from '@bolt/content';
import type { BlueprintTemplate } from '@bolt/content';
import type { CombatCar, RaceEvent, RaceSession, VehicleEffects } from '@bolt/shared';
import {
  PROTOCOL_VERSION,
  SIM_DT,
  TOW,
  WRONG_WAY_SECONDS,
  advanceTow,
  blueprintCost,
  carSnapshot,
  towShareOf,
  clearTow,
  createEffects,
  createMotionState,
  createStepScratch,
  createTelemetry,
  decideTow,
  headingFromVector,
  raceSnapshot,
  resetRace,
  sessionSnapshot,
  stepRace,
  stepRaceWithBrains,
  stepVehicle,
  ticksOf,
  towCurve,
  towGapSeconds,
  towReference,
  towTimeGap,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { createBotMatch, neonCut } from '../balance/harness.js';
import { unarmed, withTow } from '../balance/tow.js';
import { CLEAR, FULL, paramsOf, provingGround } from '../helpers/rig.js';
import { runScenario } from '../scenarios/runner.js';

/**
 * The tow, the long-range catch-up (docs/DECISIONS.md 189 to 198, docs/COMBAT_API.md "The
 * tow"): the measure of the gap, the curve of the bonus, what it does and does not do to a
 * car, and who gets none. Prediction is in tests/unit/towPrediction.test.ts, the room in
 * tests/integration/combatRoom.test.ts and the balance targets in tests/balance/balance.test.ts.
 */

const template = (id: string): BlueprintTemplate => {
  const found = getTemplate(id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
};

const PERIOD = ticksOf(TOW.updateSeconds);
const DELAY = ticksOf(TOW.startDelaySeconds);
const LAP = neonCut().lapLength;

/** Two unarmed shipped builds on the grid of Neon Cut with a sparring driver each. */
function match(a = 'example_straight_line_rocket', b = 'example_iron_mule', seed = 7, tow = true) {
  return createBotMatch(unarmed(template(a)), unarmed(template(b)), seed, undefined, tow);
}

/** Runs a match to its end, calling `each` after every tick. */
function play(
  m: { race: RaceSession; brains: ReturnType<typeof createBotMatch>['brains'] },
  each?: (race: RaceSession) => void,
  ticks = Infinity,
): RaceEvent[] {
  const events: RaceEvent[] = [];
  for (let i = 0; i < ticks && m.race.phase !== 'FINISHED'; i++) {
    stepRaceWithBrains(m.race, [], m.brains);
    for (const event of m.race.events) events.push({ ...event });
    each?.(m.race);
  }
  return events;
}

/**
 * A race frozen just after the start delay, with the two cars' course progress and average
 * speed set by hand: the gap measure and the decision are then pure functions of them.
 */
function staged(
  gapPx: number,
  speed = 250,
): { race: RaceSession; lead: CombatCar; chase: CombatCar } {
  const m = match();
  play(m, undefined, 95);
  const race = m.race;
  expect(race.phase).toBe('RACING');
  race.raceTicks = DELAY + 1;
  const [lead, chase] = race.cars as [CombatCar, CombatCar];
  lead.session.progress.courseProgress = 3000 + gapPx;
  chase.session.progress.courseProgress = 3000;
  for (const car of race.cars) {
    car.tow.averageSpeed = speed;
    car.session.progress.wrongWaySeconds = 0;
    clearTow(car.tow);
    car.tow.latched = false;
    car.tow.gapSeconds = 0;
  }
  return { race, lead, chase };
}

describe('the gap measure', () => {
  it('is distance along the course over the trailing car’s recent average speed', () => {
    expect(towTimeGap(500, 250)).toBe(2);
    expect(towTimeGap(250, 250)).toBe(1);
    expect(towTimeGap(0, 250)).toBe(0);
    expect(towTimeGap(-40, 250)).toBe(0);
    const { race, lead, chase } = staged(500);
    expect(towGapSeconds(race, chase)).toBe(2);
    expect(towReference(race, chase)).toBe(lead);
    // The car in front chases nobody and has no gap.
    expect(towReference(race, lead)).toBeNull();
    expect(towGapSeconds(race, lead)).toBe(0);
  });

  it('counts a car that has all but stopped as moving at the floor, so parking does not earn a tow', () => {
    expect(towTimeGap(120, 0)).toBe(120 / TOW.speedFloor);
    expect(towTimeGap(120, TOW.speedFloor / 2)).toBe(1);
    const { race, chase } = staged(TOW.speedFloor * 0.9, 5);
    // 0.9 s at the floor: inside fighting range however slowly the car is going.
    expect(towGapSeconds(race, chase)).toBeCloseTo(0.9, 9);
    expect(decideTow(race, chase)).toBe(0);
  });

  it('moves without a jump down the straights, through the corners and across the start line', () => {
    // A whole race between two cars of different pace, the tow on. The measured gap of the
    // car behind may change only as fast as two cars can close or part: never a step.
    const m = match('starter_sprinter', 'starter_rookie', 11);
    let last = -1;
    let worst = 0;
    let worstAtLine = 0;
    let lineCrossings = 0;
    let samples = 0;
    let previousLap = 0;
    play(m, (race) => {
      if (race.phase !== 'RACING' || race.raceTicks < 60) return;
      const [a, b] = race.cars as [CombatCar, CombatCar];
      if (a.session.phase !== 'RACING' || b.session.phase !== 'RACING') {
        last = -1;
        return;
      }
      const behind = a.session.progress.courseProgress < b.session.progress.courseProgress ? a : b;
      const gap = towGapSeconds(race, behind);
      const crossed = behind.session.progress.lap !== previousLap;
      previousLap = behind.session.progress.lap;
      if (last >= 0) {
        worst = Math.max(worst, Math.abs(gap - last));
        if (crossed) {
          lineCrossings++;
          worstAtLine = Math.max(worstAtLine, Math.abs(gap - last));
        }
        samples++;
      }
      last = gap;
    });
    expect(samples).toBeGreaterThan(3000);
    expect(lineCrossings).toBeGreaterThanOrEqual(2);
    // A tick is a thirtieth of a second: the gap cannot honestly move by more than that.
    expect(worst).toBeLessThan(0.05);
    expect(worstAtLine).toBeLessThan(0.05);
  });

  it('measures a lapped car by the course, not by the road: it is a lap behind, and the leader beside it gets nothing', () => {
    const { race, lead, chase } = staged(LAP + 40);
    // On the road the leader is 40 px behind the car it is about to lap.
    expect(towReference(race, lead)).toBeNull();
    expect(decideTow(race, lead)).toBe(0);
    // The lapped car is a lap and 40 px behind: the whole bonus, and nothing strange.
    expect(towGapSeconds(race, chase)).toBeCloseTo((LAP + 40) / 250, 9);
    expect(decideTow(race, chase)).toBe(TOW.maxBonus);
  });

  it('gives nothing to a car driving the wrong way, and lets go of one that turns round', () => {
    const { race, chase } = staged(700);
    expect(decideTow(race, chase)).toBeGreaterThan(0);
    expect(chase.tow.latched).toBe(true);
    chase.session.progress.wrongWaySeconds = WRONG_WAY_SECONDS;
    expect(decideTow(race, chase)).toBe(0);
    expect(chase.tow.latched).toBe(false);
    // Course progress only counts checkpoints crossed forward, so going back down the road
    // cannot open a gap larger than the stretch between two gates either.
    chase.session.progress.wrongWaySeconds = 0;
    expect(decideTow(race, chase)).toBeGreaterThan(0);
  });

  it('has no target in a car that is wrecked or has finished, and takes the tow off such a car at once', () => {
    const wrecked = staged(700);
    wrecked.lead.ko = true;
    expect(towReference(wrecked.race, wrecked.chase)).toBeNull();
    expect(decideTow(wrecked.race, wrecked.chase)).toBe(0);

    const finished = staged(700);
    finished.lead.session.phase = 'FINISHED';
    expect(towReference(finished.race, finished.chase)).toBeNull();
    expect(decideTow(finished.race, finished.chase)).toBe(0);

    // The towed car itself: knocked out or over the line, the bonus is gone on the next tick,
    // not ramped away.
    for (const end of ['ko', 'finish'] as const) {
      const m = match();
      let ended = false;
      let after = 0;
      play(m, (race) => {
        const car = race.cars[1]!;
        if (!ended && towShareOf(car) >= 0.5) {
          ended = true;
          if (end === 'ko') car.ko = true;
          car.session.phase = 'FINISHED';
          return;
        }
        if (ended) {
          after++;
          expect(car.tow.tow, end).toBe(0);
          expect(car.tow.towTarget, end).toBe(0);
          expect(car.session.effects.tow, end).toBe(0);
          expect(towShareOf(car), end).toBe(0);
        }
      });
      expect(ended, end).toBe(true);
      expect(after, end).toBeGreaterThan(0);
    }
  });

  it('lets go of a car that is wrecked: nothing more is decided, and what it had ramps away', () => {
    const m = match('starter_sprinter', 'starter_packhorse', 3);
    let wreckedAt = -1;
    let last = 0;
    const down = TOW.maxBonus * TOW.rampDownPerSecond * SIM_DT;
    play(m, (race) => {
      const car = race.cars[1]!;
      if (wreckedAt < 0) {
        if (towShareOf(car) >= 0.5 && car.chassis > 0) {
          // A hit that takes the chassis to zero: the car limps on for the rest of the race.
          car.chassis = 0;
          wreckedAt = race.raceTicks;
          last = car.tow.tow;
        }
        return;
      }
      if (car.session.phase !== 'RACING') return;
      // Nothing to move toward and nothing announced, from the very next tick.
      expect(car.tow.towTarget).toBe(0);
      expect(car.tow.towNext).toBe(0);
      expect(car.tow.latched).toBe(false);
      // Never more than it had, and never faster down than the ramp: no sudden loss of pace.
      expect(car.tow.tow).toBeLessThanOrEqual(last);
      expect(last - car.tow.tow).toBeLessThanOrEqual(down + 1e-12);
      last = car.tow.tow;
      if (race.raceTicks > wreckedAt + 30 / TOW.rampDownPerSecond + 1) {
        expect(car.tow.tow).toBe(0);
        expect(raceSnapshot(race, 1, 0).car.tow).toBe(0);
      }
    });
    expect(wreckedAt).toBeGreaterThan(0);
    expect(last).toBe(0);
  });

  it('is off on the grid, in the countdown and for the first seconds of the race', () => {
    const m = match();
    let firstTow = -1;
    play(m, (race) => {
      const any = race.cars.some((car) => car.tow.tow > 0 || car.tow.towTarget > 0);
      if (race.phase === 'COUNTDOWN') expect(any).toBe(false);
      if (any && firstTow < 0) firstTow = race.raceTicks;
      for (const car of race.cars)
        if (race.raceTicks < DELAY) {
          expect(car.session.effects.tow).toBe(0);
          expect(carSnapshot(race, car.index, 0).tow).toBe(0);
        }
    });
    // Decided no earlier than the delay, and in effect one period after it was decided.
    expect(firstTow).toBeGreaterThanOrEqual(DELAY + PERIOD);
    expect(firstTow).toBeLessThan(DELAY + 30 * 12);
  });
});

describe('the threshold, from the weapons and the pace', () => {
  it('is the distance between the guns’ reach and the longest weapons at typical race speed', () => {
    // Typical race speed: the eleven shipped builds alone on Neon Cut, weapons off, tow off.
    // Course length over race time.
    const laps = neonCut().lapLength * 3;
    const speeds = RIVAL_TEMPLATES.map((t) => {
      const m = createBotMatch(unarmed(t), unarmed(t), 1, undefined, false);
      play(m);
      return laps / (m.race.result!.cars[0]!.finishTimeMs! / 1000);
    });
    const typical = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;
    expect(typical).toBeGreaterThan(230);
    expect(typical).toBeLessThan(290);
    // Reach: the most common range among weapons that fire at a distance (eight of the twenty
    // reach 220 px, among them both bullet guns, the turret, the rockets and the frost cannon),
    // and the longest (the rail gun, 350; the mortar 320).
    const ranges = WEAPON_LIST.map((w) => Number(w.params.range ?? 0)).filter((r) => r > 0);
    const count = new Map<number, number>();
    for (const r of ranges) count.set(r, (count.get(r) ?? 0) + 1);
    const common = [...count].sort((a, b) => b[1] - a[1])[0]![0];
    const longest = Math.max(...ranges);
    expect(common).toBe(220);
    expect(longest).toBe(350);
    // At the threshold the trailing car is just out of the guns' reach, still inside the
    // longest weapons': the edge of the fight.
    const edge = TOW.thresholdGap * typical;
    expect(edge).toBeGreaterThan(common);
    expect(edge).toBeLessThan(longest);
  });
});

describe('the bonus curve', () => {
  it('is exactly zero at and below the threshold, rises with the gap and is capped', () => {
    for (const gap of [0, 0.2, 0.5, 0.99, TOW.thresholdGap]) expect(towCurve(gap)).toBe(0);
    let last = 0;
    for (let gap = TOW.thresholdGap; gap <= TOW.fullGap + 2; gap += 0.01) {
      const share = towCurve(gap);
      expect(share).toBeGreaterThanOrEqual(last);
      expect(share).toBeLessThanOrEqual(1);
      last = share;
    }
    expect(towCurve(TOW.fullGap)).toBe(1);
    expect(towCurve(60)).toBe(1);
    expect(towCurve((TOW.thresholdGap + TOW.fullGap) / 2)).toBeCloseTo(0.5, 9);
    // The table itself: the edge of fighting range, and a bonus of six to eight percent.
    expect(TOW.thresholdGap).toBeGreaterThanOrEqual(0.9);
    expect(TOW.thresholdGap).toBeLessThanOrEqual(1.1);
    expect(TOW.maxBonus).toBeGreaterThanOrEqual(0.06);
    expect(TOW.maxBonus).toBeLessThanOrEqual(0.08);
    expect(TOW.engageGap).toBeGreaterThan(TOW.thresholdGap);
    expect(TOW.fullGap).toBeGreaterThan(TOW.engageGap);
    expect(TOW.startDelaySeconds).toBeGreaterThanOrEqual(3);
  });

  it('starts only past the engage gap and then follows the curve down to zero: it cannot flicker at the edge', () => {
    const speed = 250;
    const { race, lead, chase } = staged(0, speed);
    // A gap that has been where it is since the last decision: no closing rate to carry forward.
    const at = (gapSeconds: number) => {
      lead.session.progress.courseProgress =
        chase.session.progress.courseProgress + gapSeconds * speed;
      chase.tow.gapSeconds = gapSeconds;
      return decideTow(race, chase);
    };
    const between = (TOW.thresholdGap + TOW.engageGap) / 2;
    // Idle and wobbling about the threshold: nothing, however often it is crossed.
    for (let i = 0; i < 40; i++) expect(at(i % 2 === 0 ? between : 0.95)).toBe(0);
    // Past the engage gap it takes hold, and holds through the band it would not start in.
    expect(at(TOW.engageGap + 0.01)).toBeGreaterThan(0);
    expect(at(between)).toBeCloseTo(TOW.maxBonus * towCurve(between), 12);
    expect(at(TOW.thresholdGap)).toBe(0);
    expect(chase.tow.latched).toBe(false);
    // And having let go, it waits for the engage gap again.
    expect(at(between)).toBe(0);
  });

  it('decides on where the gap will be when the decision is in force: a car closing fast is let go at the threshold, not after', () => {
    const speed = 250;
    const { race, lead, chase } = staged(0, speed);
    const next = (gapSeconds: number) => {
      lead.session.progress.courseProgress =
        chase.session.progress.courseProgress + gapSeconds * speed;
      return decideTow(race, chase);
    };
    // Steady at 1.5 s: half the bonus, decision after decision.
    expect(next(1.5)).toBeCloseTo(TOW.maxBonus * towCurve(1.5), 12);
    expect(next(1.5)).toBeCloseTo(TOW.maxBonus * towCurve(1.5), 12);
    // Closing by 0.2 s a period (a car 40 percent quicker): at 1.3 s it is decided as for
    // 1.0 s, where it will be when this decision is half way through its life.
    expect(next(1.3)).toBe(0);
    expect(chase.tow.latched).toBe(false);
    expect(chase.tow.gapSeconds).toBe(1.3);
    // Falling back at the same rate it is taken up early, and the lead is bounded.
    expect(next(1.5)).toBeCloseTo(TOW.maxBonus * towCurve(1.8), 12);
    expect(next(9)).toBe(TOW.maxBonus);
    expect(next(1.2)).toBe(0);
    // A first measurement has no rate: it is taken as it is.
    chase.tow.gapSeconds = 0;
    chase.tow.latched = false;
    expect(next(1.3)).toBeCloseTo(TOW.maxBonus * towCurve(1.3), 12);
  });

  it('moves no faster than its ramp, and takes effect one decision period after it is decided', () => {
    const fx = createEffects();
    fx.towNext = TOW.maxBonus;
    const up = TOW.maxBonus * TOW.rampUpPerSecond * SIM_DT;
    const down = TOW.maxBonus * TOW.rampDownPerSecond * SIM_DT;
    let tick = 1;
    // Announced, not yet in effect.
    for (; tick % PERIOD !== 0; tick++) {
      expect(advanceTow(fx, tick)).toBe(false);
      expect(fx.tow).toBe(0);
    }
    expect(advanceTow(fx, tick++)).toBe(true);
    expect(fx.towTarget).toBe(TOW.maxBonus);
    expect(fx.tow).toBeCloseTo(up, 12);
    let last = fx.tow;
    for (let i = 0; i < 30 * 20 && fx.tow < TOW.maxBonus; i++) {
      advanceTow(fx, tick++);
      expect(fx.tow - last).toBeLessThanOrEqual(up + 1e-12);
      last = fx.tow;
    }
    expect(fx.tow).toBe(TOW.maxBonus);
    // Up takes about 1 / rampUpPerSecond seconds.
    expect((tick - PERIOD) * SIM_DT).toBeGreaterThan(0.9 / TOW.rampUpPerSecond);
    fx.towNext = 0;
    while (tick % PERIOD !== 0) advanceTow(fx, tick++);
    for (let i = 0; i < 30 * 20 && fx.tow > 0; i++) {
      advanceTow(fx, tick++);
      expect(last - fx.tow).toBeLessThanOrEqual(down + 1e-12);
      last = fx.tow;
    }
    expect(fx.tow).toBe(0);
  });

  it('in a race, changes by at most one ramp step a tick and reports it as tow in hundredths', () => {
    const m = match('starter_sprinter', 'starter_packhorse', 3);
    const step = TOW.maxBonus * Math.max(TOW.rampUpPerSecond, TOW.rampDownPerSecond) * SIM_DT;
    const before = [0, 0];
    let peak = 0;
    play(m, (race) => {
      for (const car of race.cars) {
        const now = car.tow.tow;
        if (car.session.phase === 'RACING')
          expect(Math.abs(now - before[car.index]!)).toBeLessThanOrEqual(step + 1e-12);
        before[car.index] = now;
        expect(now).toBeGreaterThanOrEqual(0);
        expect(now).toBeLessThanOrEqual(TOW.maxBonus);
        const level = raceSnapshot(race, car.index, 0).car.tow;
        expect(level).toBe(Math.round((now / TOW.maxBonus) * 100) / 100);
        expect(Number.isInteger(Math.round(level * 100))).toBe(true);
        peak = Math.max(peak, level);
      }
    });
    expect(peak).toBeGreaterThan(0.2);
  });
});

describe('what the tow does to a car, and what it leaves alone', () => {
  const params = paramsOf(template('starter_rookie').blueprint);

  function drive(tow: number, seconds: number, input = FULL, airborne = false, from = 0) {
    const track = provingGround();
    const state = createMotionState(11000, 5000, headingFromVector(-1, 0), params);
    state.velocityX = -from;
    const telemetry = createTelemetry();
    const scratch = createStepScratch();
    const fx: VehicleEffects = createEffects();
    fx.tow = tow;
    fx.airborne = airborne;
    const speeds: number[] = [];
    for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
      stepVehicle(state, input, params, CLEAR, track, SIM_DT, scratch, telemetry, fx);
      speeds.push(telemetry.speed);
    }
    return { state, speeds, top: Math.max(...speeds) };
  }

  it('raises top speed by the bonus, to within half a percent', () => {
    const plain = drive(0, 24).top;
    const towed = drive(TOW.maxBonus, 24).top;
    expect(plain).toBeGreaterThan(TOW.fadeFullSpeed);
    expect(towed / plain).toBeGreaterThan(1 + TOW.maxBonus - 0.005);
    expect(towed / plain).toBeLessThan(1 + TOW.maxBonus + 0.005);
    // Half the bonus is half the gain.
    const half = drive(TOW.maxBonus / 2, 24).top;
    expect(half / plain).toBeCloseTo(1 + TOW.maxBonus / 2, 2);
  });

  it('does nothing off the line: the launch is the same to the bit until the car is at speed', () => {
    const plain = drive(0, 6).speeds;
    const towed = drive(TOW.maxBonus, 6).speeds;
    let same = 0;
    while (same < plain.length && plain[same] === towed[same]) same++;
    // Identical up to the tick the car first passes the speed the bonus fades in from.
    expect(plain[same - 1]!).toBeGreaterThan(TOW.fadeStartSpeed - 12);
    expect(plain[same - 1]!).toBeLessThanOrEqual(TOW.fadeStartSpeed + 12);
    expect(same * SIM_DT).toBeGreaterThan(1.5);
  });

  it('does not change braking, or how hard the car corners', () => {
    // Braking from the same speed: the same stop to the bit, at a half pull and at a full one,
    // because the bonus follows the throttle and a braking car has none.
    for (const pull of [0.58, 1]) {
      const stop = (tow: number) =>
        drive(tow, 2.5, { steer: 0, brake: pull, coast: false }, false, 260);
      expect(stop(TOW.maxBonus).speeds, `pull ${pull}`).toEqual(stop(0).speeds);
      expect(stop(TOW.maxBonus).state.x, `pull ${pull}`).toBe(stop(0).state.x);
    }
    // Coasting with the throttle shut is the same too.
    const coast = (tow: number) =>
      drive(tow, 3, { steer: 0, brake: 0.45, coast: false }, false, 260);
    expect(coast(TOW.maxBonus).speeds).toEqual(coast(0).speeds);
    // Cornering: full lock held from the same speed for one second turns the car through
    // the same angle, to within half a percent.
    const turn = (tow: number) =>
      drive(tow, 1, { steer: 1, brake: 0.3, coast: false }, false, 180).state.headingRad;
    expect(turn(TOW.maxBonus) / turn(0)).toBeGreaterThan(0.995);
    expect(turn(TOW.maxBonus) / turn(0)).toBeLessThan(1.005);
  });

  it('does nothing in the air', () => {
    const plain = drive(0, 1, FULL, true, 260);
    const towed = drive(TOW.maxBonus, 1, FULL, true, 260);
    expect(towed.speeds).toEqual(plain.speeds);
    expect(towed.state.x).toBe(plain.state.x);
  });

  it('never touches the car in front: a leader that is never caught drives the same race to the bit', () => {
    // The Rocket leads the Iron Mule from the first corner to the flag. With the tow on the
    // Mule is helped; the Rocket's own race must not differ by one bit.
    const lines: number[][] = [[], []];
    const times: Array<number | null> = [];
    [false, true].forEach((tow, run) => {
      const m = match('example_straight_line_rocket', 'example_iron_mule', 7, tow);
      play(m, (race) => {
        const lead = race.cars[0]!;
        expect(lead.tow.tow).toBe(0);
        expect(lead.session.effects.tow).toBe(0);
        if (race.tick % 30 === 0)
          lines[run]!.push(
            lead.session.motion.x,
            lead.session.motion.y,
            lead.session.motion.coreHeat,
          );
      });
      times.push(m.race.result!.cars[0]!.finishTimeMs);
      expect(m.race.result!.winner).toBe(0);
    });
    expect(times[1]).toBe(times[0]);
    expect(lines[1]).toEqual(lines[0]);
  });

  it('helps the car behind, and by less than its bonus: a slower build is still slower', () => {
    const finish = (tow: boolean) => {
      const m = match('example_straight_line_rocket', 'starter_rookie', 7, tow);
      // Let the second car run to the line however far back it is.
      m.race.finishWindowEnd = -1;
      let lapEnd = 0;
      play(m, (race) => {
        if (race.finishWindowEnd >= 0) race.finishWindowEnd = race.raceTicks + 30 * 60;
        const rookie = race.cars[1]!;
        if (lapEnd === 0 && rookie.session.progress.finishedAtMs !== null)
          lapEnd = rookie.session.progress.finishedAtMs;
      });
      return { rocket: m.race.result!.cars[0]!.finishTimeMs!, rookie: lapEnd };
    };
    const off = finish(false);
    const on = finish(true);
    expect(on.rocket).toBe(off.rocket);
    expect(on.rookie).toBeLessThan(off.rookie);
    // Still well behind: the tow closes part of a 17 percent pace gap, not all of it.
    expect(on.rookie - on.rocket).toBeGreaterThan(0.5 * (off.rookie - off.rocket));
    // And never more than the bonus itself could buy over the whole race.
    expect(off.rookie - on.rookie).toBeLessThan(off.rookie * TOW.maxBonus);
  });
});

describe('the sparring rival and the tow', () => {
  it('drives the same whatever its tow is: it cannot hang back to collect it', () => {
    // Two copies of the same race, stepped together. Before each of the brain's decisions in
    // the second, every number of the tow on both cars is replaced with nonsense, and put back
    // before the race moves. If the brain read any of it, its control would differ.
    const pick = (): [BlueprintTemplate, BlueprintTemplate] => [
      template('starter_sprinter'),
      template('starter_packhorse'),
    ];
    const a = createBotMatch(...pick(), 11);
    const b = createBotMatch(...pick(), 11);
    let towed = 0;
    for (let tick = 0; tick < 30 * 150 && a.race.phase !== 'FINISHED'; tick++) {
      const controls = [0, 1].map((i) => ({ ...a.brains[i]!.control(a.race, i) }));
      for (let i = 0; i < 2; i++) {
        const saved = b.race.cars.map((car) => ({
          tow: { ...car.tow },
          fx: [car.session.effects.tow, car.session.effects.towTarget, car.session.effects.towNext],
        }));
        for (const car of b.race.cars) {
          Object.assign(car.tow, {
            tow: TOW.maxBonus,
            towTarget: 0,
            towNext: TOW.maxBonus / 2,
            gapSeconds: 9,
            averageSpeed: 1,
            latched: true,
          });
          car.session.effects.tow = TOW.maxBonus;
          car.session.effects.towTarget = 0;
          car.session.effects.towNext = TOW.maxBonus;
        }
        const control = { ...b.brains[i]!.control(b.race, i) };
        b.race.cars.forEach((car, k) => {
          Object.assign(car.tow, saved[k]!.tow);
          [car.session.effects.tow, car.session.effects.towTarget, car.session.effects.towNext] =
            saved[k]!.fx as [number, number, number];
        });
        expect(control, `tick ${tick}, car ${i}`).toEqual(controls[i]);
      }
      for (let i = 0; i < 2; i++) Object.assign(a.race.controls[i]!, controls[i]);
      for (let i = 0; i < 2; i++) Object.assign(b.race.controls[i]!, controls[i]);
      stepRace(a.race, a.race.controls);
      stepRace(b.race, b.race.controls);
      if (a.race.cars.some((car) => car.tow.tow > 0)) towed++;
    }
    // The tow was really there to be exploited, for a good part of the race.
    expect(towed).toBeGreaterThan(30 * 10);
    expect(b.race.cars[1]!.session.motion.x).toBe(a.race.cars[1]!.session.motion.x);
  });
});

describe('determinism and the snapshot', () => {
  const digest = (race: RaceSession, into: number): number => {
    const text =
      JSON.stringify(raceSnapshot(race, 0, 0)) + JSON.stringify(raceSnapshot(race, 1, 0));
    let h = into;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
    return h;
  };
  const record = (seed: number) => {
    const armedA = RIVAL_TEMPLATES.find((t) => t.id === 'example_back_alley_trap')!;
    const armedB = RIVAL_TEMPLATES.find((t) => t.id === 'starter_longlegs')!;
    const m = createBotMatch(armedA, armedB, seed);
    let h = 17;
    const events = play(m, (race) => {
      if (race.tick % 15 === 0) h = digest(race, h);
    });
    return { events, h, race: m.race };
  };

  it('runs a two-car race with the tow to the same bits twice, events included', () => {
    const one = record(21);
    const two = record(21);
    expect(two.h).toBe(one.h);
    expect(two.events).toEqual(one.events);
    // The tow really did take hold and let go in it.
    const tows = one.events.filter((e) => e.type === 'catchup');
    expect(tows.some((e) => e.type === 'catchup' && e.state === 'engaged')).toBe(true);
    expect(one.race.result).not.toBeNull();
  });

  it('replays the same race, tow and all, after a reset to the grid', () => {
    const m = match('starter_sprinter', 'starter_packhorse', 5);
    const first = play(m).map(({ id: _id, tick: _tick, ...rest }) => rest);
    resetRace(m.race);
    for (const brain of m.brains) brain.reset();
    for (const car of m.race.cars) {
      expect(car.tow.tow).toBe(0);
      expect(car.tow.latched).toBe(false);
      expect(car.tow.averageSpeed).toBe(0);
    }
    const second = play(m).map(({ id: _id, tick: _tick, ...rest }) => rest);
    expect(second).toEqual(first);
  });

  it('is protocol version 5, and every car in a snapshot carries tow', () => {
    expect(PROTOCOL_VERSION).toBe(5);
    const m = match();
    play(m, undefined, 30 * 20);
    const snap = raceSnapshot(m.race, 1, 0);
    expect(typeof snap.car.tow).toBe('number');
    expect(typeof snap.rival.tow).toBe('number');
    expect(snap.car.tow).toBeGreaterThan(0);
    expect(snap.car.tow).toBeLessThanOrEqual(1);
    // The leader, seen as itself and as the other driver's rival.
    expect(snap.rival.tow).toBe(0);
    expect(raceSnapshot(m.race, 0, 0).car.tow).toBe(0);
    expect(raceSnapshot(m.race, 0, 0).rival.tow).toBe(snap.car.tow);
    // The effects the predictor replays with carry the three tow numbers.
    const fx = snap.car.effects!;
    expect(fx.tow).toBe(m.race.cars[1]!.tow.tow);
    expect(fx.towTarget).toBe(m.race.cars[1]!.tow.towTarget);
    expect(fx.towNext).toBe(m.race.cars[1]!.tow.towNext);
    // A session with no race around it has none.
    expect(sessionSnapshot(m.race.cars[1]!.session, 0).tow).toBe(0);
  });

  it('runs without it when the race says so: no bonus, no events, tow zero throughout', () => {
    const m = match('example_straight_line_rocket', 'example_iron_mule', 7, false);
    const events = play(m, (race) => {
      for (const car of race.cars) {
        expect(car.session.effects.tow).toBe(0);
        expect(towShareOf(car)).toBe(0);
      }
    });
    expect(events.some((e) => e.type === 'catchup')).toBe(false);
  });
});

describe('the catchup event', () => {
  it('says engaged and released in turn for a car, never twice running and never in a flutter', () => {
    const quiet = ticksOf(TOW.eventMinSeconds);
    for (const [a, b, seed] of [
      ['starter_sprinter', 'starter_packhorse', 3],
      ['example_back_alley_trap', 'starter_tinker', 9],
      ['starter_rookie', 'starter_longlegs', 4],
    ] as const) {
      const m = createBotMatch(template(a), template(b), seed);
      const events = play(m).filter((e) => e.type === 'catchup');
      for (const car of [0, 1]) {
        const own = events.filter((e) => e.type === 'catchup' && e.car === car);
        let state = 'released';
        let tick = -1e9;
        for (const e of own) {
          if (e.type !== 'catchup') continue;
          expect(e.state).not.toBe(state);
          expect(e.tick - tick).toBeGreaterThanOrEqual(quiet);
          state = e.state;
          tick = e.tick;
        }
      }
    }
  });

  it('fits the table to another setting when a study changes it, and puts it back', () => {
    const saved = { ...TOW };
    withTow({ maxBonus: 0.03, thresholdGap: 2 }, () => {
      expect(towCurve(2)).toBe(0);
      expect(TOW.maxBonus).toBe(0.03);
    });
    expect(TOW).toEqual(saved);
  });
});

describe('scenarios', () => {
  it('runs the 33 combat showcases without the tow, so their timelines are what they were', () => {
    expect(SCENARIOS).toHaveLength(33);
    for (const def of SCENARIOS) {
      expect(def.tow, def.id).toBeUndefined();
      const run = runScenario(def);
      expect(run.setup.race.options.tow, def.id).toBe(false);
      expect(
        run.events.some((e) => e.type === 'catchup'),
        def.id,
      ).toBe(false);
      for (const car of run.setup.race.cars) expect(towShareOf(car), def.id).toBe(0);
    }
  });

  it('has one showcase of its own: the tow takes hold of the car behind, builds, fades and lets go', () => {
    expect(ALL_SCENARIOS).toHaveLength(34);
    expect(getScenario('tow')).toBe(TOW_SCENARIO);
    expect(SCENARIOS.includes(TOW_SCENARIO)).toBe(false);
    for (const setup of TOW_SCENARIO.cars)
      expect(blueprintCost(setup.blueprint, CATALOG).total).toBeLessThanOrEqual(1000);
    const run = runScenario(TOW_SCENARIO);
    expect(run.missing).toEqual([]);
    expect(run.setup.race.options.tow).toBe(true);
    const tows = run.events.filter((e) => e.type === 'catchup');
    expect(tows.map((e) => e.type === 'catchup' && `${e.car} ${e.state}`)).toEqual([
      '0 engaged',
      '0 released',
    ]);
    const [engaged, released] = tows as [RaceEvent, RaceEvent];
    // Not before the start delay, and a good few seconds of it to look at.
    expect(engaged.tick - run.goTick).toBeGreaterThanOrEqual(DELAY + PERIOD);
    expect(released.tick - engaged.tick).toBeGreaterThan(30 * 5);
    // It let go short of the car ahead, and the two never touched.
    expect(run.events.some((e) => e.type === 'hit')).toBe(false);
    const [chaser, leader] = run.setup.race.cars as [CombatCar, CombatCar];
    expect(leader.session.progress.courseProgress).toBeGreaterThan(
      chaser.session.progress.courseProgress + 60,
    );
    // The same way every time.
    expect(runScenario(TOW_SCENARIO).events).toEqual(run.events);
  });
});
