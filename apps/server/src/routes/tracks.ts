import { Router } from 'express';
import { TRACKS, WEATHER_PRESETS } from '@bolt/content';
import type { BiomeId, SurfaceId, WeatherPreset } from '@bolt/shared';

export type TrackSummary = {
  id: string;
  name: string;
  biome: BiomeId;
  character: string;
  laps: number;
  surfaceMix: Partial<Record<SurfaceId, number>>;
  landmarks: string[];
  weatherPresets: WeatherPreset[];
};

export type TracksResponse = { tracks: TrackSummary[] };

/** Menu-level track data. Geometry ships with the client bundle, so it is not repeated here. */
export function buildTracksResponse(): TracksResponse {
  return {
    tracks: Object.values(TRACKS).map((track) => ({
      id: track.id,
      name: track.name,
      biome: track.biome,
      character: track.character,
      laps: track.laps,
      surfaceMix: track.surfaceMix,
      landmarks: track.landmarks,
      weatherPresets: track.weatherPresetIds.flatMap((id) => {
        const preset = Object.prototype.hasOwnProperty.call(WEATHER_PRESETS, id)
          ? WEATHER_PRESETS[id]
          : undefined;
        return preset ? [preset] : [];
      }),
    })),
  };
}

export function trackRoutes(): Router {
  const router = Router();
  // Content is immutable for the life of the process, so the body is built once.
  const body = buildTracksResponse();
  router.get('/tracks', (_req, res) => {
    res.set('Cache-Control', 'no-cache').json(body);
  });
  return router;
}
