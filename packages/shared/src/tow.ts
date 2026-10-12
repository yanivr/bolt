import { SIM_DT, TOW } from './balance.js';
import { emit } from './combat/car.js';
import { ticksOf } from './combat/specs.js';
import type { CombatCar, RaceSession } from './combat/types.js';
import { clamp, expBlend } from './math.js';
import { advanceTow, clearTow } from './physics.js';
import { isWrongWay } from './track.js';

/**
 * The tow: the long-range catch-up the product owner approved (docs/DECISIONS.md 189 to 198,
 * docs/COMBAT_API.md "The tow"). A car that trails the racing car ahead of it by more than the
 * edge of fighting range is given a little top speed, more the further back it is, and none at
 * all once it is back in range. The car ahead is never touched. The same rule for a player, the
 * rival and, later, two people.
 *
 * This file is the race's half: measuring the gap and deciding the bonus. The other half, moving
 * the bonus toward what was decided, is `advanceTow` in physics.ts, which a predicting client
 * runs too. Every number is in `TOW` (balance.ts).
 */

/**
 * The time gap for a distance along the course, seconds: how long the trailing car would take
 * to cover it at its own recent average speed. A car that has all but stopped is counted as
 * moving at the floor, so standing still does not turn a short gap into a long one.
 */
export function towTimeGap(distance: number, averageSpeed: number): number {
  if (!(distance > 0)) return 0;
  return distance / Math.max(TOW.speedFloor, averageSpeed);
}

/**
 * Share of the whole bonus a time gap earns: exactly 0 at and below the threshold, rising in a
 * straight line, 1 from the full gap. This is the curve alone; whether a car is on it at all is
 * the latch in `decideTow`.
 */
export function towCurve(gapSeconds: number): number {
  if (!(gapSeconds > TOW.thresholdGap)) return 0;
  return clamp((gapSeconds - TOW.thresholdGap) / (TOW.fullGap - TOW.thresholdGap), 0, 1);
}

function racing(car: CombatCar): boolean {
  return car.session.phase === 'RACING' && !car.ko;
}

/**
 * A wrecked car (its chassis at zero, limping for the rest of the race: chassis is never
 * repaired) is owed nothing. Unlike a finish or a knockout it is still driving, so its bonus is
 * not cut: it is decided as zero from now on and ramps away at the usual rate.
 */
function wrecked(car: CombatCar): boolean {
  return car.chassis <= 0;
}

/**
 * The car this one is chasing: the nearest car ahead of it along the course that is still
 * racing. A car that has finished or been knocked out is nobody's target, and neither is one
 * that is behind on the course however close it is on the road, so the leader gets nothing
 * from coming up on a car it is lapping.
 */
export function towReference(race: RaceSession, car: CombatCar): CombatCar | null {
  const mine = car.session.progress.courseProgress;
  let best: CombatCar | null = null;
  let nearest = Infinity;
  for (const other of race.cars) {
    if (other === car || !racing(other)) continue;
    const d = other.session.progress.courseProgress - mine;
    if (d > 0 && d < nearest) {
      nearest = d;
      best = other;
    }
  }
  return best;
}

/**
 * The time gap from a car to the one it is chasing, or 0 when it is chasing nobody. Distance is
 * the difference of course progress, which only ever counts checkpoints crossed forward and so
 * neither jumps at the start line nor rewards a car pointed the wrong way.
 */
export function towGapSeconds(race: RaceSession, car: CombatCar): number {
  const ahead = towReference(race, car);
  if (!ahead) return 0;
  return towTimeGap(
    ahead.session.progress.courseProgress - car.session.progress.courseProgress,
    car.tow.averageSpeed,
  );
}

/**
 * A decision is made now, takes effect one period from now and stands for a period: the middle
 * of its life is a period and a half away. The gap it is made on is carried forward that far at
 * the rate it changed since the last decision, so a car closing quickly is let go as it reaches
 * the threshold, not a second after. Bounded, so one odd measurement cannot swing it.
 */
const DECISION_LEAD_PERIODS = 1.5;
const DECISION_LEAD_LIMIT = 0.5;

/**
 * Decides the bonus a car will be moving toward one period from now, as a share of top speed.
 * Nothing before the start delay, nothing for a car driving the wrong way, nothing with nobody
 * to chase. An idle tow waits for the engage gap; a running one follows the curve down to
 * exactly zero at the threshold and is then idle again.
 */
export function decideTow(race: RaceSession, car: CombatCar): number {
  const tow = car.tow;
  const before = tow.gapSeconds;
  tow.gapSeconds = 0;
  if (race.raceTicks < ticksOf(TOW.startDelaySeconds) || isWrongWay(car.session.progress)) {
    tow.latched = false;
    return 0;
  }
  const measured = towGapSeconds(race, car);
  tow.gapSeconds = measured;
  let gap = measured;
  if (measured > 0 && before > 0)
    gap = Math.max(
      0,
      measured +
        clamp(
          (measured - before) * DECISION_LEAD_PERIODS,
          -DECISION_LEAD_LIMIT,
          DECISION_LEAD_LIMIT,
        ),
    );
  if (tow.latched) {
    if (gap <= TOW.thresholdGap) tow.latched = false;
  } else if (gap >= TOW.engageGap) tow.latched = true;
  return tow.latched ? TOW.maxBonus * towCurve(gap) : 0;
}

/**
 * The share of the whole bonus a car has now, 0 to 1 in hundredths: the snapshot's `tow`
 * (`CarSnapshot.tow`, `RivalSnapshot.tow`).
 */
export function towShareOf(car: CombatCar): number {
  if (!(TOW.maxBonus > 0)) return 0;
  return Math.round(clamp(car.tow.tow / TOW.maxBonus, 0, 1) * 100) / 100;
}

/**
 * One race tick of the tow for every car, before any of them moves, so each is measured against
 * where the others were at the end of the last tick. `stepRace` copies the result into each
 * car's effects after it has worked out what damage and statuses are doing.
 */
export function stepTow(race: RaceSession): void {
  const enabled = race.options.tow !== false;
  const blend = expBlend(SIM_DT, TOW.speedAverageSeconds);
  const quiet = ticksOf(TOW.eventMinSeconds);
  for (const car of race.cars) {
    const tow = car.tow;
    if (!enabled || !racing(car)) {
      clearTow(tow);
      tow.latched = false;
      tow.gapSeconds = 0;
    } else {
      tow.averageSpeed += (car.session.telemetry.speed - tow.averageSpeed) * blend;
      if (wrecked(car)) {
        // Nothing announced, nothing to move toward: the bonus it has falls away from here.
        tow.towNext = 0;
        tow.towTarget = 0;
        tow.latched = false;
        tow.gapSeconds = 0;
        advanceTow(tow, race.raceTicks);
      } else if (advanceTow(tow, race.raceTicks)) tow.towNext = decideTow(race, car);
    }
    // Engaged and released are news, told once each and never in a flutter.
    const active = tow.tow > 0;
    if (active !== tow.announced && race.tick - tow.announcedTick >= quiet) {
      tow.announced = active;
      tow.announcedTick = race.tick;
      emit(race, { type: 'catchup', car: car.index, state: active ? 'engaged' : 'released' });
    }
  }
}
