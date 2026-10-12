import type { TrackDefinition, TrackHazard, SurfaceZone } from '@bolt/shared';
import { plainTrackFields } from '@bolt/shared';

/**
 * An open test field: a wide loop of road with open ground all round, bounded by a wall at the
 * world's edge, for wind, off-road and hazard tests. The road runs west along y = 3000 between
 * x = 9000 and x = 3000, which is where tests put the car.
 */
export function makeOpenField(
  options: {
    windExposure?: number;
    hazards?: TrackHazard[];
    surfaceZones?: SurfaceZone[];
    offroad?: TrackDefinition['offroadSurface'];
  } = {},
): TrackDefinition {
  const w = 160;
  return {
    ...plainTrackFields(12000, 7000),
    id: 'open_field',
    name: 'Open Field',
    biome: 'desert',
    character: 'Test field',
    edges: 'open',
    offroadSurface: options.offroad ?? 'sand',
    windExposure: options.windExposure ?? 0,
    laps: 1,
    worldWidth: 12000,
    worldHeight: 7000,
    main: {
      id: 'main',
      closed: true,
      surface: 'asphalt',
      shoulder: 20,
      shoulderSurface: 'sand',
      points: [
        { x: 10000, y: 3000, width: w },
        { x: 9000, y: 3000, width: w },
        { x: 6000, y: 3000, width: w },
        { x: 3000, y: 3000, width: w },
        { x: 2000, y: 3000, width: w },
        { x: 1200, y: 4000, width: w },
        { x: 2000, y: 5000, width: w },
        { x: 3000, y: 5000, width: w },
        { x: 6000, y: 5000, width: w },
        { x: 9000, y: 5000, width: w },
        { x: 10000, y: 5000, width: w },
        { x: 10800, y: 4000, width: w },
      ],
    },
    shortcuts: [],
    checkpointCount: 8,
    startNear: { x: 8000, y: 3000 },
    surfaceZones: options.surfaceZones ?? [],
    hazards: options.hazards ?? [],
    walls: [
      {
        id: 'edge',
        kind: 'boundary',
        thickness: 24,
        closed: true,
        points: [
          { x: 60, y: 60 },
          { x: 11940, y: 60 },
          { x: 11940, y: 6940 },
          { x: 60, y: 6940 },
        ],
      },
    ],
    obstacles: [],
    props: [],
    landmarks: [],
    weatherPresetIds: ['desert_clear', 'desert_crosswind'],
    surfaceMix: { asphalt: 1 },
  };
}
