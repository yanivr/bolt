import { TRACKS } from '@bolt/content';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COURSE,
  availableCourses,
  bakedPresetOf,
  courseArt,
  parseArtIndex,
  settleCourse,
} from '../../apps/web/src/app/course.js';

/** Which courses a build offers, from the art index the terrain baker writes (Milestone D). */

const SHIPPED = parseArtIndex({
  version: 1,
  maps: [{ trackId: 'city_01', presetId: 'city_clear_night' }],
});

describe('the art index and the courses on offer', () => {
  it('reads the index defensively: anything malformed is the one bake every build ships', () => {
    expect(parseArtIndex(null).maps).toEqual([DEFAULT_COURSE]);
    expect(parseArtIndex({ maps: 'no' }).maps).toEqual([DEFAULT_COURSE]);
    expect(parseArtIndex({ maps: [{ trackId: 1 }, { trackId: 'a', presetId: 'b' }] }).maps).toEqual(
      [{ trackId: 'a', presetId: 'b' }],
    );
  });

  it('tells baked, weather fallback and layout apart', () => {
    expect(courseArt(SHIPPED, { trackId: 'city_01', presetId: 'city_clear_night' })).toBe('baked');
    expect(courseArt(SHIPPED, { trackId: 'city_01', presetId: 'city_rain_night' })).toBe(
      'weather_fallback',
    );
    expect(bakedPresetOf(SHIPPED, 'city_01', 'city_rain_night')).toBe('city_clear_night');
    expect(courseArt(SHIPPED, { trackId: 'desert_01', presetId: 'desert_clear' })).toBe('layout');
  });

  it('offers only baked courses in production, and all sixteen in development', () => {
    expect(availableCourses(SHIPPED, false)).toEqual([{ ...DEFAULT_COURSE, art: 'baked' }]);
    const all = availableCourses(SHIPPED, true);
    expect(all).toHaveLength(16);
    expect(all.map((c) => c.trackId)).toEqual(
      Object.values(TRACKS).flatMap((t) => t.weatherPresetIds.map(() => t.id)),
    );
  });

  it('settles a stored choice on what is offered', () => {
    const prod = availableCourses(SHIPPED, false);
    expect(settleCourse({ trackId: 'snow_01', presetId: 'snow_snowfall' }, prod)).toEqual({
      ...DEFAULT_COURSE,
      art: 'baked',
    });
    const dev = availableCourses(SHIPPED, true);
    expect(settleCourse({ trackId: 'snow_01', presetId: 'snow_snowfall' }, dev).presetId).toBe(
      'snow_snowfall',
    );
    // A preset that is not the track's falls back to the track's first.
    expect(settleCourse({ trackId: 'snow_01', presetId: 'city_rain_night' }, dev)).toEqual({
      trackId: 'snow_01',
      presetId: 'snow_clear_frost',
      art: 'layout',
    });
  });
});
