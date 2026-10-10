import { CITY_01, DEFAULT_LOADOUT, TRACKS, environmentFor, resolveLoadout } from '@bolt/content';
import type { TrackRuntime, VehicleParams } from '@bolt/shared';
import {
  RACE_LIMIT_SECONDS,
  SIM_DT,
  buildTrack,
  createDriveSession,
  createDriverScratch,
  createLocation,
  createProgress,
  driveCenterline,
  isWrongWay,
  lapPosition,
  locate,
  sampleBranch,
  stepDriveSession,
  surfaceAt,
  updateProgress,
} from '@bolt/shared';
import { beforeAll, describe, expect, it } from 'vitest';

let track: TrackRuntime;
let params: VehicleParams;
const env = environmentFor('city_clear_night')!;

beforeAll(() => {
  track = buildTrack(CITY_01);
  const r = resolveLoadout(DEFAULT_LOADOUT);
  if (!r.ok) throw new Error('default loadout must resolve');
  params = r.params;
});

/** Walks a branch centerline in small steps, feeding the checkpoint logic. */
function walk(t: TrackRuntime, progress: ReturnType<typeof createProgress>, branch: number, from: number, to: number, time: { ms: number }) {
  const b = t.branches[branch]!;
  const loc = createLocation();
  const dir = to >= from ? 1 : -1;
  let prev = sampleBranch(b, from);
  const events: string[] = [];
  for (let s = from + dir * 6; dir > 0 ? s <= to : s >= to; s += dir * 6) {
    const p = sampleBranch(b, s);
    locate(t, p.x, p.y, loc);
    time.ms += 33;
    const e = updateProgress(t, progress, prev.x, prev.y, p.x, p.y, Math.atan2(p.tx * dir, -p.ty * dir), 200, loc, time.ms, SIM_DT);
    if (e !== 'none') events.push(e);
    prev = p;
  }
  return events;
}

describe('track content contract (Section 9.1)', () => {
  it.each(Object.values(TRACKS))('$id builds with valid geometry', (def) => {
    const t = buildTrack(def);
    expect(t.lapLength).toBeGreaterThan(4000);
    expect(t.checkpoints).toHaveLength(def.checkpointCount);
    expect(t.spawns.length).toBeGreaterThanOrEqual(2);
    expect(def.shortcuts.length).toBeGreaterThanOrEqual(1);
    expect(def.landmarks.length).toBeGreaterThanOrEqual(4);
    expect(def.weatherPresetIds.length).toBeGreaterThanOrEqual(2);
    for (const id of def.weatherPresetIds) expect(environmentFor(id)).toBeDefined();
    for (const b of t.branches) {
      for (let i = 0; i < b.count; i++) {
        expect(Number.isFinite(b.x[i]! + b.y[i]! + b.curvature[i]!)).toBe(true);
        expect(b.x[i]!).toBeGreaterThan(300);
        expect(b.x[i]!).toBeLessThan(def.worldWidth - 300);
        expect(b.y[i]!).toBeGreaterThan(300);
        expect(b.y[i]!).toBeLessThan(def.worldHeight - 300);
        // A car is 34 wide; every lane must fit one with room to spare.
        expect(b.halfWidth[i]! * 2).toBeGreaterThan(60);
      }
    }
  });

  it('spawns both cars on pavement, behind the line, facing down the road', () => {
    const loc = createLocation();
    for (const spawn of track.spawns) {
      locate(track, spawn.x, spawn.y, loc);
      expect(loc.branch).toBe(0);
      expect(surfaceAt(track, loc).onShoulder).toBe(false);
      const pos = lapPosition(track, loc);
      expect(pos).toBeGreaterThan(track.lapLength - 80);
      const facing = Math.sin(spawn.headingRad) * loc.tx + -Math.cos(spawn.headingRad) * loc.ty;
      expect(facing).toBeGreaterThan(0.99);
    }
    const a = createLocation();
    const b = createLocation();
    locate(track, track.spawns[0]!.x, track.spawns[0]!.y, a);
    locate(track, track.spawns[1]!.x, track.spawns[1]!.y, b);
    expect(Math.abs(lapPosition(track, a) - lapPosition(track, b))).toBeLessThan(2);
  });

  it('matches the published surface mix within five points', () => {
    let cobble = 0;
    for (let i = 0; i < track.main.count; i++) if (track.main.surface[i] === 'cobble') cobble++;
    const share = cobble / track.main.count;
    expect(Math.abs(share - (CITY_01.surfaceMix.cobble ?? 0))).toBeLessThan(0.05);
  });

  it('keeps solid obstacles inside the drivable corridor and off the main racing line', () => {
    const loc = createLocation();
    for (const ob of track.obstacles) {
      locate(track, ob.x, ob.y, loc);
      expect(loc.edge).toBeLessThan(4);
      const main = createLocation();
      let nearest = Infinity;
      for (let i = 0; i < track.main.count; i++) nearest = Math.min(nearest, Math.hypot(track.main.x[i]! - ob.x, track.main.y[i]! - ob.y));
      expect(nearest).toBeGreaterThan(30);
      void main;
    }
  });
});

describe('checkpoints and progress (Sections 3.4 and 19.1)', () => {
  it('counts ordered checkpoints, laps and the finish along the main line', () => {
    const progress = createProgress();
    const time = { ms: 0 };
    const L = track.lapLength;
    const events = walk(track, progress, 0, track.startS - 40, track.startS - 40 + L * 3 + 80, time);
    expect(events.filter((e) => e === 'lap')).toHaveLength(2);
    expect(events.filter((e) => e === 'finish')).toHaveLength(1);
    expect(progress.finishedAtMs).not.toBeNull();
    expect(progress.courseProgress).toBe(L * 3);
  });

  it('does not advance when gates are crossed backwards', () => {
    const progress = createProgress();
    const time = { ms: 0 };
    walk(track, progress, 0, track.startS - 40, track.startS + 300, time);
    expect(progress.lap).toBe(1);
    const index = progress.checkpointIndex;
    walk(track, progress, 0, track.startS + 300, track.startS - track.lapLength * 0.5, time);
    expect(progress.lap).toBe(1);
    expect(progress.checkpointIndex).toBe(index);
    expect(isWrongWay(progress)).toBe(true);
  });

  it('refuses a lap when checkpoints were skipped', () => {
    const progress = createProgress();
    const time = { ms: 0 };
    walk(track, progress, 0, track.startS - 40, track.startS + 200, time);
    // Jump most of the lap ahead without crossing the gates in between.
    walk(track, progress, 0, track.startS + track.lapLength - 300, track.startS + track.lapLength + 200, time);
    expect(progress.lap).toBe(1);
    expect(progress.checkpointIndex).toBe(1);
    expect(progress.courseProgress).toBeLessThanOrEqual(track.lapLength / track.checkpoints.length + 1);
  });

  it('gives the signed shortcut the same checkpoint credit as the road it bypasses', () => {
    const alley = track.branches[1]!;
    const bypassed = track.checkpoints.filter((c) => c.gates.length > 1);
    expect(bypassed.length).toBeGreaterThanOrEqual(1);
    const progress = createProgress();
    const time = { ms: 0 };
    walk(track, progress, 0, track.startS - 40, alley.leaveS, time);
    const before = progress.checkpointIndex;
    walk(track, progress, 1, 0, alley.length, time);
    expect(progress.checkpointIndex).toBe(before + bypassed.length);
    walk(track, progress, 0, alley.rejoinS, track.startS + track.lapLength + 60, time);
    expect(progress.lap).toBe(2);
  });

  it('never decreases course progress while driving forwards', () => {
    const progress = createProgress();
    const time = { ms: 0 };
    const b = track.main;
    const loc = createLocation();
    let last = -Infinity;
    let prev = sampleBranch(b, track.startS - 40);
    for (let s = track.startS - 34; s < track.startS + track.lapLength * 1.2; s += 6) {
      const p = sampleBranch(b, s);
      locate(track, p.x, p.y, loc);
      time.ms += 33;
      updateProgress(track, progress, prev.x, prev.y, p.x, p.y, Math.atan2(p.tx, -p.ty), 200, loc, time.ms, SIM_DT);
      expect(progress.courseProgress).toBeGreaterThanOrEqual(last - 1e-6);
      last = progress.courseProgress;
      prev = p;
    }
  });
});

describe('simulated race length (Section 9.3)', () => {
  it('the default car laps Neon Cut cleanly inside the target window', () => {
    const session = createDriveSession(track, env, params);
    const scratch = createDriverScratch();
    let wallStrikes = 0;
    for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++) {
      stepDriveSession(session, driveCenterline(track, session.motion, params, env, scratch));
      if (session.telemetry.wallImpactSpeed > 0) wallStrikes++;
    }
    const seconds = session.raceTicks * SIM_DT;
    expect(session.progress.finishedAtMs).not.toBeNull();
    expect(seconds).toBeGreaterThan(105);
    expect(seconds).toBeLessThan(140);
    expect(wallStrikes).toBe(0);
    expect(session.bestLapMs).toBeGreaterThan(30_000);
  });

  it('is slower in the rain with the same car and driver', () => {
    const run = (preset: string) => {
      const e = environmentFor(preset)!;
      const session = createDriveSession(track, e, params);
      const scratch = createDriverScratch();
      for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++) stepDriveSession(session, driveCenterline(track, session.motion, params, e, scratch));
      return session.raceTicks * SIM_DT;
    };
    const dry = run('city_clear_night');
    const wet = run('city_rain_night');
    expect(wet).toBeGreaterThan(dry + 3);
    expect(wet).toBeLessThanOrEqual(RACE_LIMIT_SECONDS);
  });

  it('ends at the 180 second limit even if nobody finishes', () => {
    const session = createDriveSession(track, env, params);
    for (let i = 0; i < 30 * 190 && session.phase !== 'FINISHED'; i++) stepDriveSession(session, { steer: 0, brake: 1, coast: false });
    expect(session.phase).toBe('FINISHED');
    expect(session.raceTicks * SIM_DT).toBeCloseTo(RACE_LIMIT_SECONDS, 1);
    expect(session.progress.finishedAtMs).toBeNull();
  });

  it('holds the car on the grid until GO', () => {
    const session = createDriveSession(track, env, params);
    const x = session.motion.x;
    const y = session.motion.y;
    for (let i = 0; i < 60; i++) stepDriveSession(session, { steer: 1, brake: 0, coast: false });
    expect(session.phase).toBe('COUNTDOWN');
    expect(session.motion.x).toBe(x);
    expect(session.motion.y).toBe(y);
    for (let i = 0; i < 60; i++) stepDriveSession(session, { steer: 0, brake: 0, coast: false });
    expect(session.phase).toBe('RACING');
    expect(Math.hypot(session.motion.x - x, session.motion.y - y)).toBeGreaterThan(5);
  });
});
