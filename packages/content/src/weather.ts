import type { WeatherPreset } from '@bolt/shared';

/**
 * Deterministic weather presets, published before the build timer starts (Section 9.2).
 * Each one points at a row of the shared grip table; nothing here changes mid-race.
 */
export const WEATHER_PRESETS: Record<string, WeatherPreset> = {
  city_clear_night: {
    id: 'city_clear_night',
    weather: 'clear',
    displayName: 'Clear Night',
    timeOfDay: 'night',
    ambientTempC: 17,
    wetness: 0,
    windX: 0,
    windY: 0,
    visibility: 1,
  },
  city_rain_night: {
    id: 'city_rain_night',
    weather: 'rain',
    displayName: 'Rainy Night',
    timeOfDay: 'night',
    ambientTempC: 12,
    wetness: 0.8,
    windX: -18,
    windY: 6,
    visibility: 0.9,
  },
};

export function getWeatherPreset(id: string): WeatherPreset | undefined {
  return Object.prototype.hasOwnProperty.call(WEATHER_PRESETS, id) ? WEATHER_PRESETS[id] : undefined;
}
