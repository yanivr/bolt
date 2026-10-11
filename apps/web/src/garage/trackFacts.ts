import { STRINGS } from '@bolt/content';
import type {
  BuildConditions,
  SurfaceId,
  TrackDefinition,
  TrackRuntime,
  WeatherPreset,
} from '@bolt/shared';
import {
  COOLING_MULTIPLIER,
  LOOSE_SURFACES,
  SOLAR_TIME,
  SOLAR_WEATHER,
  SURFACE_GRIP,
  SURFACE_IDS,
  WET_WEATHER,
  WORLD_PIXELS_PER_METER,
} from '@bolt/shared';
import { fill } from './text.js';

/**
 * What the Track Preview shows (Section 5.5). Every number comes from the track runtime or
 * the shared balance tables the race itself reads: there is nothing here to keep in sync.
 */

export type SurfaceRow = {
  surface: SurfaceId;
  name: string;
  /** Share of the lap, 0 to 1. */
  share: number;
  /** Grip multiplier under the published weather, before tires. */
  grip: number;
};

export type TrackFacts = {
  laps: number;
  lapMeters: number;
  lengthLabel: string;
  corners: number;
  surfaces: SurfaceRow[];
  cooling: number;
  /** Solar panel output as a share of a clear midday. */
  solar: number;
  tips: [string, string];
};

/** A bend tighter than this radius, turning at least `MAJOR_CORNER_TURN`, is a major corner. */
export const MAJOR_CORNER_RADIUS = 800;
export const MAJOR_CORNER_TURN = (45 * Math.PI) / 180;

/**
 * Counts major corners on the main line: runs of road that bend one way, tighter than
 * `MAJOR_CORNER_RADIUS` world pixels, through at least 45 degrees. A hairpin is one corner.
 */
export function countMajorCorners(track: TrackRuntime): number {
  const { curvature, s, count } = track.main;
  const limit = 1 / MAJOR_CORNER_RADIUS;
  const flags: number[] = [];
  for (let i = 0; i < count; i++) {
    const k = curvature[i] ?? 0;
    flags.push(Math.abs(k) >= limit ? Math.sign(k) : 0);
  }
  // Start counting on a straight so a corner that wraps the start line is counted once.
  const start = Math.max(0, flags.indexOf(0));
  let corners = 0;
  let turned = 0;
  let side = 0;
  for (let n = 0; n <= count; n++) {
    const i = (start + n) % count;
    const flag = n === count ? 0 : (flags[i] ?? 0);
    if (flag !== side) {
      if (side !== 0 && turned >= MAJOR_CORNER_TURN) corners++;
      side = flag;
      turned = 0;
    }
    if (flag !== 0) {
      const next = (i + 1) % count;
      const ds =
        next > i ? (s[next] ?? 0) - (s[i] ?? 0) : track.main.length - (s[i] ?? 0) + (s[next] ?? 0);
      turned += Math.abs(curvature[i] ?? 0) * Math.max(0, ds);
    }
  }
  return corners;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function surfaceName(surface: SurfaceId, wet: boolean): string {
  return wet ? STRINGS.preview.wetSurfaceNames[surface] : STRINGS.preview.surfaceNames[surface];
}

/** Two build tips from the real traction and cooling modifiers of the published conditions. */
export function buildTips(conditions: BuildConditions): [string, string] {
  const wet = WET_WEATHER[conditions.weather];
  const grip = SURFACE_GRIP[conditions.weather];
  const mix = Object.entries(conditions.surfaceMix ?? { asphalt: 1 }) as Array<[SurfaceId, number]>;
  const total = mix.reduce((sum, [, share]) => sum + share, 0) || 1;
  const shares = mix
    .map(([surface, share]) => ({ surface, share: share / total, grip: grip[surface] }))
    .sort((a, b) => b.share - a.share);
  const mean = shares.reduce((sum, row) => sum + row.share * row.grip, 0);
  const asphalt = grip.asphalt;

  let traction: string;
  const loose = shares.find((row) => LOOSE_SURFACES.includes(row.surface) && row.share >= 0.25);
  const slick = [...shares]
    .filter((row) => row.share >= 0.1 && row.grip < asphalt - 0.04)
    .sort((a, b) => a.grip - b.grip)[0];
  if (wet) traction = fill(STRINGS.preview.tipWet, { grip: percent(mean) });
  else if (loose)
    traction = fill(STRINGS.preview.tipLoose, {
      surface: surfaceName(loose.surface, false),
      share: percent(loose.share),
      grip: percent(loose.grip),
    });
  else if (slick)
    traction = fill(STRINGS.preview.tipSlick, {
      surface: surfaceName(slick.surface, false),
      share: percent(slick.share),
      loss: percent((asphalt - slick.grip) / asphalt),
    });
  else
    traction = fill(STRINGS.preview.tipGrippy, {
      share: percent(shares.filter((row) => row.grip >= 0.95).reduce((n, row) => n + row.share, 0)),
    });

  const cooling = COOLING_MULTIPLIER[conditions.weather];
  const solar = SOLAR_TIME[conditions.timeOfDay] * SOLAR_WEATHER[conditions.weather];
  let thermal: string;
  if (cooling <= 0.95) thermal = fill(STRINGS.preview.tipHot, { percent: percent(1 - cooling) });
  else if (cooling >= 1.05)
    thermal = fill(STRINGS.preview.tipCool, { percent: percent(cooling - 1) });
  else if (conditions.timeOfDay === 'night')
    thermal = fill(STRINGS.preview.tipNight, { percent: percent(solar) });
  else if (solar < 0.95) thermal = fill(STRINGS.preview.tipDusk, { percent: percent(solar) });
  else thermal = STRINGS.preview.tipClear;
  return [traction, thermal];
}

export function trackFacts(
  def: TrackDefinition,
  runtime: TrackRuntime,
  preset: WeatherPreset,
): TrackFacts {
  const conditions: BuildConditions = {
    weather: preset.weather,
    timeOfDay: preset.timeOfDay,
    surfaceMix: def.surfaceMix,
  };
  const wet = WET_WEATHER[preset.weather];
  const mix = def.surfaceMix ?? { asphalt: 1 };
  const surfaces: SurfaceRow[] = SURFACE_IDS.filter((id) => (mix[id] ?? 0) > 0)
    .map((surface) => ({
      surface,
      name: surfaceName(surface, wet),
      share: mix[surface] ?? 0,
      grip: SURFACE_GRIP[preset.weather][surface],
    }))
    .sort((a, b) => b.share - a.share);
  const lapMeters = Math.round(runtime.lapLength / WORLD_PIXELS_PER_METER / 10) * 10;
  const raceMeters = lapMeters * def.laps;
  return {
    laps: def.laps,
    lapMeters,
    lengthLabel:
      raceMeters < 3200
        ? STRINGS.preview.shortLap
        : raceMeters < 4200
          ? STRINGS.preview.mediumLap
          : STRINGS.preview.longLap,
    corners: countMajorCorners(runtime),
    surfaces,
    cooling: COOLING_MULTIPLIER[preset.weather],
    solar: SOLAR_TIME[preset.timeOfDay] * SOLAR_WEATHER[preset.weather],
    tips: buildTips(conditions),
  };
}
