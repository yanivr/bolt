import { SIM_DT } from './balance.js';
import type { TrackRuntime } from './track.js';
import type { HazardSchedule, SurfaceId, TrackHazard } from './types.js';
import { SURFACE_IDS } from './types.js';

/**
 * Environment hazards and the ground under a car (Sections 9.1 and 9.3). Every hazard is a
 * pure function of the race clock, counted in ticks from GO, so the server, a predicting
 * client and a replay agree on whether a tram gate is down without any of it being sent.
 */

export type HazardPhase = 'idle' | 'warning' | 'active';

export type HazardState = {
  phase: HazardPhase;
  /** Seconds until the phase changes. */
  secondsLeft: number;
  /** Seconds into the current period. */
  periodTime: number;
};

/** Where a timetable stands `seconds` after GO. Before GO the clock reads zero. */
export function scheduleState(schedule: HazardSchedule, seconds: number): HazardState {
  const period = schedule.periodSeconds;
  const t = (((Math.max(0, seconds) - schedule.offsetSeconds) % period) + period) % period;
  const quiet = period - schedule.warnSeconds - schedule.activeSeconds;
  if (t < quiet) return { phase: 'idle', secondsLeft: quiet - t, periodTime: t };
  if (t < quiet + schedule.warnSeconds)
    return { phase: 'warning', secondsLeft: quiet + schedule.warnSeconds - t, periodTime: t };
  return { phase: 'active', secondsLeft: period - t, periodTime: t };
}

/** Seconds of race time for a clock in ticks. */
export function clockSeconds(clockTicks: number): number {
  return clockTicks * SIM_DT;
}

export function hazardState(hazard: TrackHazard, clockTicks: number): HazardState {
  if ('schedule' in hazard) return scheduleState(hazard.schedule, clockSeconds(clockTicks));
  return { phase: 'active', secondsLeft: Infinity, periodTime: 0 };
}

/** Whether a timed hazard is active at this tick. Untimed hazards always are. */
export function hazardActive(hazard: TrackHazard, clockTicks: number): boolean {
  if (!('schedule' in hazard)) return true;
  const s = hazard.schedule;
  const t =
    (((Math.max(0, clockTicks * SIM_DT) - s.offsetSeconds) % s.periodSeconds) + s.periodSeconds) %
    s.periodSeconds;
  return t >= s.periodSeconds - s.activeSeconds;
}

/** Gust factor of a crosswind zone, 0.5 to 1 of its range, smooth and periodic. */
export function gustFactor(
  hazard: Extract<TrackHazard, { kind: 'crosswind' }>,
  clockTicks: number,
): number {
  const gust = hazard.gust;
  if (!gust) return 1;
  const t = clockTicks * SIM_DT - gust.offsetSeconds;
  const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / gust.periodSeconds);
  return gust.low + (gust.high - gust.low) * wave;
}

/** What the ground does to a car this tick. Reused between ticks; written by `groundAt`. */
export type Ground = {
  surface: SurfaceId;
  /** On the shoulder or off the road: the shoulder's grip and rolling penalty apply. */
  onShoulder: boolean;
  /** Off the road altogether, on an open track's off-road ground. */
  offroad: boolean;
  /** Multiplier on grip after the tire cap (oil). 1 when nothing acts. */
  gripScale: number;
  /** Extra grip, minus one, for magnetic tires (a magnetic strip), before the cap. */
  magnetBonus: number;
  /** Extra rolling resistance, px/s2 (steam, deep mud). */
  drag: number;
  /** Engine heat added per second (steam). */
  heat: number;
  /** Share of the weather's wind acting here. */
  exposure: number;
  /** Index of the area hazard under the car, or -1. */
  hazard: number;
};

export function createGround(): Ground {
  return {
    surface: 'asphalt',
    onShoulder: false,
    offroad: false,
    gripScale: 1,
    magnetBonus: 0,
    drag: 0,
    heat: 0,
    exposure: 0,
    hazard: -1,
  };
}

/** Surface id stored in a zone grid cell, or null for none. */
export function zoneSurfaceAt(track: TrackRuntime, x: number, y: number): SurfaceId | null {
  const grid = track.zoneSurface;
  if (!grid) return null;
  const c = Math.floor(x / track.zoneCell);
  const r = Math.floor(y / track.zoneCell);
  if (c < 0 || r < 0 || c >= track.zoneCols || r >= track.zoneRows) return null;
  const v = grid[r * track.zoneCols + c]!;
  return v === 0 ? null : SURFACE_IDS[v - 1]!;
}

/** Index of the area hazard covering a point, or -1. */
export function zoneHazardAt(track: TrackRuntime, x: number, y: number): number {
  const grid = track.zoneHazard;
  if (!grid) return -1;
  const c = Math.floor(x / track.zoneCell);
  const r = Math.floor(y / track.zoneCell);
  if (c < 0 || r < 0 || c >= track.zoneCols || r >= track.zoneRows) return -1;
  return grid[r * track.zoneCols + c]! - 1;
}

/** Share of the weather's wind at a point: a crosswind zone's (with its gusts) or the track's. */
export function exposureAt(track: TrackRuntime, x: number, y: number, clockTicks: number): number {
  const index = zoneHazardAt(track, x, y);
  if (index >= 0) {
    const h = track.hazards[index]!;
    if (h.kind === 'crosswind') return h.exposure * gustFactor(h, clockTicks);
  }
  return track.def.windExposure;
}

/**
 * Applies the area hazard under a point to a ground record whose surface is already set.
 * Cheap: one grid read and, for a hazard, a switch on its kind.
 */
export function applyAreaHazard(
  track: TrackRuntime,
  x: number,
  y: number,
  clockTicks: number,
  out: Ground,
): void {
  out.gripScale = 1;
  out.magnetBonus = 0;
  out.drag = 0;
  out.heat = 0;
  out.exposure = track.def.windExposure;
  out.hazard = -1;
  const index = zoneHazardAt(track, x, y);
  if (index < 0) return;
  const h = track.hazards[index]!;
  out.hazard = index;
  switch (h.kind) {
    case 'oil':
      out.gripScale = h.grip;
      break;
    case 'magnetic_strip':
      out.magnetBonus = h.gripBonus;
      break;
    case 'deep_mud':
      out.drag = h.drag;
      break;
    case 'steam_vent':
      if (hazardActive(h, clockTicks)) {
        out.drag = h.drag;
        out.heat = h.heatPerSecond;
      }
      break;
    case 'crosswind':
      out.exposure = h.exposure * gustFactor(h, clockTicks);
      break;
    case 'crossing':
      break;
  }
}
