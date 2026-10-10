import type { TrackDefinition } from '@bolt/shared';

/**
 * A huge clockwise stadium oval used to measure straight-line and steady-state behaviour
 * without corners or walls getting in the way.
 */
export function makeProvingGround(surface: TrackDefinition['main']['surface'] = 'asphalt'): TrackDefinition {
  const w = 600;
  return {
    id: 'proving_ground',
    name: 'Proving Ground',
    biome: 'city',
    character: 'Test oval',
    laps: 1,
    worldWidth: 14000,
    worldHeight: 6000,
    main: {
      id: 'main',
      closed: true,
      surface,
      shoulder: 40,
      shoulderSurface: surface,
      // Extra collinear points keep the long sides exactly straight: a spline segment only
      // runs true when both of its neighbours sit on the same line.
      points: [
        { x: 12000, y: 5000, width: w },
        { x: 11000, y: 5000, width: w },
        { x: 7000, y: 5000, width: w },
        { x: 3000, y: 5000, width: w },
        { x: 2000, y: 5000, width: w },
        { x: 1000, y: 3000, width: w },
        { x: 2000, y: 1000, width: w },
        { x: 3000, y: 1000, width: w },
        { x: 7000, y: 1000, width: w },
        { x: 11000, y: 1000, width: w },
        { x: 12000, y: 1000, width: w },
        { x: 13000, y: 3000, width: w },
      ],
    },
    shortcuts: [],
    checkpointCount: 8,
    startNear: { x: 10900, y: 5000 },
    obstacles: [],
    props: [],
    landmarks: [],
    weatherPresetIds: ['city_clear_night'],
    surfaceMix: { [surface]: 1 },
  };
}
