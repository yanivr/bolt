import { emit } from './combat/car.js';
import { clearEntities } from './combat/entities.js';
import type { RaceSession } from './combat/types.js';
import type { RaceResult } from './protocol.js';
import { raceTimeOf } from './race.js';

/**
 * Section 3.3: a driver who leaves a race, or is gone longer than the reconnect window, forfeits
 * it. The race ends at once like any other ending (every car is finished, everything in flight
 * is cleared, a `finish` and a `result` event are emitted), and the result says `forfeit`, so it
 * is never mistaken for a normal finish. The cars' figures are what they were at that tick.
 *
 * Kept beside the race rather than inside `stepRace`, because only a room with people in it
 * can decide that someone has gone: the simulation itself never forfeits anyone.
 */
export function concedeRace(
  race: RaceSession,
  loser: number,
  cause: 'left' | 'disconnected',
): RaceResult | null {
  if (race.result || race.cars.length < 2) return null;
  const winner = race.cars.find((car) => car.index !== loser)?.index ?? -1;
  race.phase = 'FINISHED';
  const timeMs = raceTimeOf(race);
  for (const car of race.cars) {
    if (car.session.phase !== 'FINISHED') {
      car.session.phase = 'FINISHED';
      emit(race, { type: 'finish', car: car.index, raceTimeMs: timeMs, finished: false });
    }
    car.tether.active = false;
  }
  clearEntities(race);
  const result: RaceResult = {
    winner,
    reason: 'forfeit',
    raceTimeMs: timeMs,
    cars: race.cars.map((car) => ({
      finished: car.session.progress.finishedAtMs !== null,
      finishTimeMs: car.session.progress.finishedAtMs,
      courseProgress: car.session.progress.courseProgress,
      lastCheckpointMs: car.session.progress.lastCheckpointMs,
      bestLapMs: car.session.bestLapMs,
      chassis: car.chassis,
      ko: car.ko,
      damageDealt: car.stats.damageDealt,
      damageTaken: car.stats.damageTaken,
      shotsFired: car.stats.shotsFired,
      hitsLanded: car.stats.hitsLanded,
    })),
    forfeit: { car: loser, cause },
  };
  race.result = result;
  emit(race, { type: 'result', winner, reason: 'forfeit' });
  return result;
}
