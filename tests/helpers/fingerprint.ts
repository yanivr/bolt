import {
  CATALOG,
  CITY_01,
  DEFAULT_LOADOUT,
  RIVAL_TEMPLATES,
  conditionsFor,
  environmentFor,
  raceEntry,
  resolveLoadout,
} from '@bolt/content';
import type { RaceEnvironment, TrackRuntime } from '@bolt/shared';
import {
  buildTrack,
  createDriveSession,
  createDriverScratch,
  createRace,
  createSparringBrain,
  driveCenterline,
  sha256Hex,
  stepDriveSession,
  stepRaceWithBrains,
} from '@bolt/shared';

/**
 * Bit-level fingerprints of Neon Cut, used to prove that the move to track format v2 left its
 * geometry and its driving exactly as they were: every number of the runtime track, a default
 * car's three laps, and a whole armed race between two sparring brains. The expected digests
 * were recorded on the format-1 build (October 12, 2026) before any track code changed.
 */

function feed(parts: string[], values: ArrayLike<number> | readonly string[]): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    parts.push(typeof v === 'number' ? v.toString(36) : v);
  }
}

export function trackFingerprint(track: TrackRuntime): string {
  const parts: string[] = [String(track.lapLength), String(track.startS)];
  for (const b of track.branches) {
    feed(parts, b.x);
    feed(parts, b.y);
    feed(parts, b.tx);
    feed(parts, b.ty);
    feed(parts, b.halfWidth);
    feed(parts, b.shoulder);
    feed(parts, b.s);
    feed(parts, b.curvature);
    feed(parts, b.surface);
    parts.push(String(b.leaveS), String(b.rejoinS), b.shoulderSurface);
  }
  for (const c of track.checkpoints) {
    parts.push(String(c.lapS));
    for (const g of c.gates) feed(parts, [g.ax, g.ay, g.bx, g.by, g.tx, g.ty, g.branch]);
  }
  for (const s of track.spawns) feed(parts, [s.x, s.y, s.headingRad]);
  for (const o of track.obstacles) feed(parts, [o.x, o.y, o.radius]);
  for (const g of track.grid) feed(parts, g);
  for (const g of track.obstacleGrid) feed(parts, g);
  return sha256Hex(parts.join(','));
}

/** The default car driven by the centerline driver for a whole race, every tick of its motion. */
export function driveFingerprint(track: TrackRuntime, presetId = 'city_clear_night'): string {
  const env = environmentFor(presetId) as RaceEnvironment;
  const r = resolveLoadout(DEFAULT_LOADOUT);
  if (!r.ok) throw new Error('default loadout must resolve');
  const session = createDriveSession(track, env, r.params);
  const scratch = createDriverScratch();
  const parts: string[] = [];
  for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++) {
    stepDriveSession(session, driveCenterline(track, session.motion, r.params, env, scratch));
    const m = session.motion;
    feed(parts, [m.x, m.y, m.headingRad, m.velocityX, m.velocityY, m.coreHeat]);
    feed(parts, [session.progress.courseProgress, session.progress.checkpointIndex]);
  }
  parts.push(String(session.raceTicks), String(session.bestLapMs));
  return sha256Hex(parts.join(','));
}

/** Two shipped builds without bullet guns (the magazine of catalog 0.7.0 cannot touch them) with sparring brains, a whole race, every car's motion and every event. */
export function raceFingerprint(
  track: TrackRuntime,
  presetId = 'city_clear_night',
  seed = 1001,
): string {
  const env = environmentFor(presetId) as RaceEnvironment;
  const conditions = conditionsFor(CITY_01.id, presetId)!;
  const a = RIVAL_TEMPLATES[6]!;
  const b = RIVAL_TEMPLATES[10]!;
  const entries = [a, b].map((t) => raceEntry(t.blueprint, conditions)!);
  const race = createRace(track, env, entries, { seed, conditions, catalog: CATALOG, tow: true });
  const brains = [createSparringBrain(seed ^ 0x1b873593), createSparringBrain(seed ^ 0x2545f491)];
  const parts: string[] = [];
  for (let i = 0; i < 30 * 200 && race.phase !== 'FINISHED'; i++) {
    stepRaceWithBrains(race, [], brains);
    for (const car of race.cars) {
      const m = car.session.motion;
      feed(parts, [m.x, m.y, m.headingRad, m.velocityX, m.velocityY, car.chassis]);
    }
    for (const e of race.events) parts.push(JSON.stringify(e));
  }
  parts.push(JSON.stringify(race.result));
  return sha256Hex(parts.join(','));
}

export function cityFingerprints(): { track: string; drive: string; rain: string; race: string } {
  const track = buildTrack(CITY_01);
  return {
    track: trackFingerprint(track),
    drive: driveFingerprint(track),
    rain: driveFingerprint(track, 'city_rain_night'),
    race: raceFingerprint(track),
  };
}
