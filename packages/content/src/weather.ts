import type { WeatherPreset } from '@bolt/shared';
import { COOLING_MULTIPLIER } from '@bolt/shared';

/**
 * Deterministic weather presets, published before the build timer starts (Section 9.2). Each
 * one points at a row of the shared grip table (`SURFACE_GRIP`) and of the cooling table
 * (`COOLING_MULTIPLIER`); nothing here changes mid-race. The other numbers are ours: ambient
 * temperature, how hard it rains (for the art and the sound), how wet the road is, the wind in
 * world px/s (which acts only where a track is exposed, docs/TRACK_API.md) and visibility.
 *
 * Presets are per biome, because a clear day in the desert is not a clear day in the forest;
 * each track publishes exactly the two of Section 9.1's table. Crosswind and the night
 * variants are not rows of the grip table: crosswind is the clear row with a strong wind, dry
 * night the clear row at night, factory rain the rain row at night.
 */
type PresetSeed = Omit<WeatherPreset, 'cooling'>;

function preset(seed: PresetSeed): WeatherPreset {
  return { ...seed, cooling: COOLING_MULTIPLIER[seed.weather] };
}

const LIST: PresetSeed[] = [
  // city_01 Neon Cut
  {
    id: 'city_clear_night',
    weather: 'clear',
    displayName: 'Clear Night',
    timeOfDay: 'night',
    ambientTempC: 17,
    wetness: 0,
    rainIntensity: 0,
    windX: 0,
    windY: 0,
    visibility: 1,
  },
  {
    id: 'city_rain_night',
    weather: 'rain',
    displayName: 'Rainy Night',
    timeOfDay: 'night',
    ambientTempC: 12,
    wetness: 0.8,
    rainIntensity: 0.6,
    windX: -18,
    windY: 6,
    visibility: 0.9,
  },
  // city_02 Backstreet Blitz
  {
    id: 'city_clear_day',
    weather: 'clear',
    displayName: 'Clear',
    timeOfDay: 'day',
    ambientTempC: 22,
    wetness: 0,
    rainIntensity: 0,
    windX: 8,
    windY: -4,
    visibility: 1,
  },
  {
    id: 'city_rain_day',
    weather: 'rain',
    displayName: 'Rain',
    timeOfDay: 'day',
    ambientTempC: 14,
    wetness: 0.75,
    rainIntensity: 0.55,
    windX: -14,
    windY: 8,
    visibility: 0.88,
  },
  // desert_01 Dust Devil
  {
    id: 'desert_clear',
    weather: 'clear',
    displayName: 'Clear',
    timeOfDay: 'day',
    ambientTempC: 31,
    wetness: 0,
    rainIntensity: 0,
    windX: 10,
    windY: 0,
    visibility: 1,
  },
  {
    id: 'desert_crosswind',
    weather: 'clear',
    displayName: 'Crosswind',
    timeOfDay: 'day',
    ambientTempC: 27,
    wetness: 0,
    rainIntensity: 0,
    // Across the long east-west straights, from the north.
    windX: 12,
    windY: 70,
    visibility: 0.94,
  },
  // desert_02 Canyon Switch
  {
    id: 'desert_dry_heat',
    weather: 'dry_heat',
    displayName: 'Dry Heat',
    timeOfDay: 'day',
    ambientTempC: 43,
    wetness: 0,
    rainIntensity: 0,
    windX: 6,
    windY: 0,
    visibility: 0.92,
  },
  {
    id: 'desert_sandstorm',
    weather: 'sandstorm',
    displayName: 'Sandstorm',
    timeOfDay: 'day',
    ambientTempC: 34,
    wetness: 0,
    rainIntensity: 0,
    windX: -62,
    windY: 24,
    visibility: 0.6,
  },
  // forest_01 Moss Run and forest_02 Timber Dash
  {
    id: 'forest_clear',
    weather: 'clear',
    displayName: 'Clear',
    timeOfDay: 'day',
    ambientTempC: 18,
    wetness: 0.1,
    rainIntensity: 0,
    windX: 4,
    windY: 2,
    visibility: 1,
  },
  {
    id: 'forest_rain',
    weather: 'rain',
    displayName: 'Rain',
    timeOfDay: 'day',
    ambientTempC: 13,
    wetness: 0.85,
    rainIntensity: 0.65,
    windX: -10,
    windY: 12,
    visibility: 0.85,
  },
  {
    id: 'forest_heavy_rain',
    weather: 'heavy_rain',
    displayName: 'Heavy Rain',
    timeOfDay: 'day',
    ambientTempC: 11,
    wetness: 1,
    rainIntensity: 1,
    windX: -16,
    windY: 14,
    visibility: 0.7,
  },
  // snow_01 Whiteout Pass
  {
    id: 'snow_clear_frost',
    weather: 'clear_frost',
    displayName: 'Clear Frost',
    timeOfDay: 'day',
    ambientTempC: -9,
    wetness: 0,
    rainIntensity: 0,
    windX: 12,
    windY: 0,
    visibility: 1,
  },
  {
    id: 'snow_snowfall',
    weather: 'snowfall',
    displayName: 'Snowfall',
    timeOfDay: 'day',
    ambientTempC: -4,
    wetness: 0.4,
    rainIntensity: 0.7,
    windX: -22,
    windY: 10,
    visibility: 0.72,
  },
  // industrial_01 Steel Circuit
  {
    id: 'industrial_dry_night',
    weather: 'clear',
    displayName: 'Dry Night',
    timeOfDay: 'night',
    ambientTempC: 15,
    wetness: 0,
    rainIntensity: 0,
    windX: 0,
    windY: 0,
    visibility: 1,
  },
  {
    id: 'industrial_factory_rain',
    weather: 'rain',
    displayName: 'Factory Rain',
    timeOfDay: 'night',
    ambientTempC: 11,
    wetness: 0.8,
    rainIntensity: 0.6,
    windX: 8,
    windY: 14,
    visibility: 0.86,
  },
];

export const WEATHER_PRESETS: Record<string, WeatherPreset> = Object.fromEntries(
  LIST.map((seed) => [seed.id, preset(seed)]),
);

export function getWeatherPreset(id: string): WeatherPreset | undefined {
  return Object.prototype.hasOwnProperty.call(WEATHER_PRESETS, id)
    ? WEATHER_PRESETS[id]
    : undefined;
}
