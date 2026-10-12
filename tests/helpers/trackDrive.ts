import { DEFAULT_LOADOUT, environmentFor, resolveLoadout } from '@bolt/content';
import type { RaceEnvironment, SurfaceId, TrackRuntime, VehicleParams } from '@bolt/shared';
import {
  SIM_DT,
  createDriveSession,
  createDriverScratch,
  createLocation,
  driveCenterline,
  DEFAULT_DRIVER,
  hazardClock,
  lapPosition,
  planSpeed,
  referenceSpeeds,
  locate,
  stepDriveSession,
} from '@bolt/shared';

/**
 * The default car (Baseline Beetle, Four-Cylinder, Street Tires) driven over a track's default
 * route by the centerline driver, as Section 9.3 asks track lengths to be measured. Returns
 * the race and lap times, what it drove on, and when it passed each corner sign of the main
 * line on its second lap.
 */

export type DefaultRun = {
  finished: boolean;
  raceSeconds: number;
  /** Lap times in ms. */
  laps: number[];
  wallStrikes: number;
  /** Share of ticks with the car's centre off the road on an open track. */
  offroadShare: number;
  /** Share of distance driven on each surface. */
  surfaceShare: Partial<Record<SurfaceId, number>>;
  /** Every third tick: position and speed. */
  path: Array<{ x: number; y: number; speed: number }>;
  /** Per main-line corner sign: seconds from passing it to reaching its bend, lap 2. */
  signLeads: Array<{ id: string; seconds: number | null }>;
  /** Ticks the car was held at a rail crossing (stopped with a crossing ahead). */
  heldTicks: number;
};

export function driveDefaultCar(
  track: TrackRuntime,
  presetId: string,
  car?: VehicleParams,
): DefaultRun {
  const env = environmentFor(presetId) as RaceEnvironment;
  const resolved = resolveLoadout(DEFAULT_LOADOUT);
  if (!resolved.ok) throw new Error('default loadout must resolve');
  const r = { params: car ?? resolved.params };
  const session = createDriveSession(track, env, r.params);
  const scratch = createDriverScratch();
  const laps: number[] = [];
  const path: DefaultRun['path'] = [];
  const dist: Partial<Record<SurfaceId, number>> = {};
  let total = 0;
  let wallStrikes = 0;
  let offroad = 0;
  let ticks = 0;
  let held = 0;
  const loc = createLocation();
  const signs = track.cornerSigns.filter((s) => s.branch === 0);
  const toLap = (s: number) =>
    (((s - track.startS) % track.lapLength) + track.lapLength) % track.lapLength;
  const passedSign = new Map<string, number>();
  const ref = referenceSpeeds(track.main, track);
  const normal = (s: number) =>
    ref[Math.min(track.main.count - 1, Math.floor((s / track.main.length) * track.main.count))]!;
  const leads = new Map<string, number>();
  let prevPos = -1;
  for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++) {
    const control = driveCenterline(
      track,
      session.motion,
      r.params,
      env,
      scratch,
      undefined,
      hazardClock(session),
    );
    const result = stepDriveSession(session, control);
    if (result.lapTimeMs > 0) laps.push(result.lapTimeMs);
    if (session.raceTicks === 0) continue;
    ticks++;
    const t = session.telemetry;
    if (t.wallImpactSpeed > 0) wallStrikes++;
    if (t.onShoulder && !track.walled) {
      locate(track, session.motion.x, session.motion.y, loc);
      if (loc.edge > 0) offroad++;
    }
    const ds = t.speed * SIM_DT;
    dist[t.surface] = (dist[t.surface] ?? 0) + ds;
    total += ds;
    if (t.speed < 2 && control.brake > 0) held++;
    if (i % 3 === 0) path.push({ x: session.motion.x, y: session.motion.y, speed: t.speed });
    // Corner sign lead times on the second lap.
    locate(track, session.motion.x, session.motion.y, loc);
    const crossingBusy = planSpeed(
      track,
      r.params,
      env,
      track.startS + lapPosition(track, loc),
      t.speed,
      DEFAULT_DRIVER,
      1,
      hazardClock(session),
    ).holding;
    if (session.progress.lap === 2) {
      locate(track, session.motion.x, session.motion.y, loc);
      if (loc.branch === 0) {
        const pos = lapPosition(track, loc);
        if (prevPos >= 0 && pos >= prevPos) {
          for (const sign of signs) {
            const a = toLap(sign.signS);
            const b = toLap(sign.bendS);
            const now = session.raceTicks * SIM_DT;
            // Measured only when the car passes the sign at something like normal speed (it
            // may have just pulled away from a crossing).
            if (prevPos < a && pos >= a && t.speed >= normal(sign.signS) * 0.75)
              passedSign.set(sign.id, now);
            // A car that slowed for a crossing in between says nothing about the sign.
            if (crossingBusy) passedSign.delete(sign.id);
            if (prevPos < b && pos >= b && passedSign.has(sign.id) && !leads.has(sign.id))
              leads.set(sign.id, now - passedSign.get(sign.id)!);
          }
        }
        prevPos = pos;
      }
    }
  }
  const surfaceShare: Partial<Record<SurfaceId, number>> = {};
  for (const [k, v] of Object.entries(dist)) surfaceShare[k as SurfaceId] = v / Math.max(1, total);
  return {
    finished: session.progress.finishedAtMs !== null,
    raceSeconds: session.raceTicks * SIM_DT,
    laps,
    wallStrikes,
    offroadShare: offroad / Math.max(1, ticks),
    surfaceShare,
    path,
    signLeads: signs.map((s) => ({ id: s.id, seconds: leads.get(s.id) ?? null })),
    heldTicks: held,
  };
}
