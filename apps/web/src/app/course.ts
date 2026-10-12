import { TRACKS } from '@bolt/content';

/**
 * Which track and weather the player has chosen, and which of them can be offered. The art
 * pipeline writes `assets/maps/index.json`, the list of track and weather pairs whose terrain
 * is baked. A production build offers only those, exactly as the garage offers only chassis
 * with art. A development build, or any build with `?debug=1`, offers every track and weather:
 * a track without baked art races in the layout view, labelled as such, and a weather without
 * its own bake is drawn on another preset's art of the same track.
 */

export const DEFAULT_TRACK_ID = 'city_01';
export const DEFAULT_WEATHER_PRESET_ID = 'city_clear_night';

export type Course = { trackId: string; presetId: string };

/** How a course is drawn: its own bake, another preset's bake of the track, or the layout view. */
export type CourseArt = 'baked' | 'weather_fallback' | 'layout';

export type ArtIndex = { version: 1; maps: Course[] };

export const DEFAULT_COURSE: Course = {
  trackId: DEFAULT_TRACK_ID,
  presetId: DEFAULT_WEATHER_PRESET_ID,
};

/** Parses the art index; anything malformed reads as the one bake every build has shipped with. */
export function parseArtIndex(raw: unknown): ArtIndex {
  const fallback: ArtIndex = { version: 1, maps: [DEFAULT_COURSE] };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const maps = (raw as { maps?: unknown }).maps;
  if (!Array.isArray(maps)) return fallback;
  const out: Course[] = [];
  for (const m of maps) {
    if (typeof m !== 'object' || m === null) continue;
    const { trackId, presetId } = m as { trackId?: unknown; presetId?: unknown };
    if (typeof trackId === 'string' && typeof presetId === 'string')
      out.push({ trackId, presetId });
  }
  return { version: 1, maps: out };
}

export function bakedPresetOf(index: ArtIndex, trackId: string, presetId?: string): string | null {
  const exact =
    presetId && index.maps.find((m) => m.trackId === trackId && m.presetId === presetId);
  if (exact) return exact.presetId;
  return index.maps.find((m) => m.trackId === trackId)?.presetId ?? null;
}

export function courseArt(index: ArtIndex, course: Course): CourseArt {
  const baked = bakedPresetOf(index, course.trackId, course.presetId);
  if (baked === course.presetId) return 'baked';
  return baked ? 'weather_fallback' : 'layout';
}

export type CourseOption = Course & { art: CourseArt };

/**
 * Every course that may be offered, in the order of Section 9.1's table and each track's own
 * weather order. `allowUnbaked` is false in a production build without `?debug=1`.
 */
export function availableCourses(index: ArtIndex, allowUnbaked: boolean): CourseOption[] {
  const out: CourseOption[] = [];
  for (const def of Object.values(TRACKS))
    for (const presetId of def.weatherPresetIds) {
      const course = { trackId: def.id, presetId };
      const art = courseArt(index, course);
      if (art === 'baked' || allowUnbaked) out.push({ ...course, art });
    }
  return out;
}

/** The course to use: the wanted one if it may be offered, else the first that may. */
export function settleCourse(wanted: Course, options: readonly CourseOption[]): CourseOption {
  return (
    options.find((o) => o.trackId === wanted.trackId && o.presetId === wanted.presetId) ??
    options.find((o) => o.trackId === wanted.trackId) ??
    options[0] ?? { ...DEFAULT_COURSE, art: 'baked' }
  );
}
