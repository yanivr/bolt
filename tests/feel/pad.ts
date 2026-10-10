import type { TrackDefinition } from '@bolt/shared';

/**
 * Skid pad: one very wide, very long strip of dry asphalt. Wide enough that full-lock circles,
 * slaloms and hairpin turns at any speed never reach a wall, so the feel bench measures the
 * car and nothing else.
 */
export const PAD_START = { x: 14500, y: 3000 };

export function makeSkidPad(surface: TrackDefinition['main']['surface'] = 'asphalt'): TrackDefinition {
  const w = 2400;
  return {
    id: 'skid_pad',
    name: 'Skid Pad',
    biome: 'city',
    character: 'Feel bench',
    laps: 1,
    worldWidth: 20000,
    worldHeight: 12000,
    main: {
      id: 'main',
      closed: true,
      surface,
      shoulder: 40,
      shoulderSurface: surface,
      points: [
        { x: 16000, y: 3000, width: w },
        { x: 14000, y: 3000, width: w },
        { x: 9000, y: 3000, width: w },
        { x: 6000, y: 3000, width: w },
        { x: 4000, y: 3000, width: w },
        { x: 2500, y: 6000, width: w },
        { x: 4000, y: 9000, width: w },
        { x: 6000, y: 9000, width: w },
        { x: 9000, y: 9000, width: w },
        { x: 14000, y: 9000, width: w },
        { x: 16000, y: 9000, width: w },
        { x: 17500, y: 6000, width: w },
      ],
    },
    shortcuts: [],
    checkpointCount: 8,
    startNear: { x: 13000, y: 3000 },
    obstacles: [],
    props: [],
    landmarks: [],
    weatherPresetIds: ['city_clear_night'],
    surfaceMix: { [surface]: 1 },
  };
}
