import type {
  BiomeId,
  SurfaceId,
  TrackDefinition,
  WeatherLayer,
  WeatherPreset,
} from '@bolt/shared';
import type { WeatherAnimName } from './atlas.js';

/**
 * Which moving weather and environment layers a course gets, and their numbers. A pure
 * function of the published preset and the track's data (its biome, anchors, hazards and
 * obstacles), so every one of the sixteen courses has a defined set and a unit test can list
 * it. Nothing here touches gameplay: the simulation applies grip, cooling, wind and visibility
 * on its own; this only shows them.
 */

export const WEATHER_LAYER_IDS = [
  // Every course: what the wheels throw up from the surface under them.
  'surface_particles',
  // Rain.
  'rain',
  'splashes',
  'spray',
  'wet_tracks',
  'reflections',
  'lightning',
  'canopy_drips',
  'runoff',
  // Snow and frost.
  'snow',
  'snow_tracks',
  'ice_glints',
  'diamond_dust',
  'cold_fog',
  'tailpipe_vapor',
  'snow_guns',
  'frost_vignette',
  // Sand, wind and heat.
  'sand_streaks',
  'grit',
  'dust_bands',
  'sand_tracks',
  'tumbleweeds',
  'dust_devils',
  'heat_haze',
  // Forest.
  'leaves',
  'light_shafts',
  'pollen',
  'fireflies',
  'mist',
  // Night, city and industry.
  'steam_vents',
  'smelter_sparks',
  'embers',
  'chimney_smoke',
  // The visibility modifier, shown at the screen edges and never near the cars.
  'visibility_haze',
] as const;
export type WeatherLayerId = (typeof WEATHER_LAYER_IDS)[number];

/**
 * A plane of falling or blowing particles in screen space with parallax (rain, snow, sand,
 * leaves). Positions are a pure function of the particle's index, the time and the camera
 * (`field.ts`), so they are deterministic and cost no state.
 */
export type FieldPlane = {
  id: string;
  anims: readonly WeatherAnimName[];
  layer: WeatherLayer;
  /** Particles over a reference 870 x 370 view at high quality; scaled by the view's area. */
  count: number;
  /** Seconds a particle lives before it is born again elsewhere. */
  life: number;
  /** Screen velocity, world pixels a second; `jitter` is the share each one varies by. */
  vx: number;
  vy: number;
  jitter: number;
  /** 1 moves with the ground; more than 1 is nearer the camera and slides faster. */
  parallax: number;
  alpha: number;
  /** How the frame is chosen: by the direction of travel, fixed per particle, or looped. */
  frames: 'direction' | 'fixed' | 'loop';
  /** For `fixed`: the frames a particle picks from. */
  pick?: readonly number[];
  /** Sideways sway in pixels and its period in seconds (snow, leaves). */
  sway?: number;
  swayPeriod?: number;
  /** The last moments of a far raindrop are a splash on the ground where it lands. */
  splash?: boolean;
  /** Fade in and out over the first and last tenth of its life, in alpha steps. */
  fade?: boolean;
  /**
   * A veil: drawn only toward the edges of the screen and never near the cars, denser the
   * further out (the visibility modifier for rain and snow: a thicker curtain far away).
   */
  veil?: boolean;
  tint?: number;
};

export type WeatherPlan = {
  presetId: string;
  trackId: string;
  biome: BiomeId;
  layers: ReadonlySet<WeatherLayerId>;
  planes: FieldPlane[];
  wetness: number;
  /** The wind as the art shows it, world pixels a second on screen. */
  windX: number;
  windY: number;
  night: boolean;
  cold: boolean;
  /** Visibility haze color and its strongest alpha at the screen corners. */
  haze: { tint: number; maxAlpha: number } | null;
  /** Surfaces that hold water and so show reflections and spray. */
  shiny: ReadonlySet<SurfaceId>;
};

/** Visual wind: the preset's wind is small in px/s; the art exaggerates it so it can be seen. */
const WIND_GAIN = 4;

function anchorsOf(def: TrackDefinition, kind: string): number {
  let n = 0;
  for (const a of def.anchors) if (a.kind === kind) n += a.points.length;
  return n;
}

function rainPlanes(intensity: number, wx: number, wy: number): FieldPlane[] {
  const lean = (fall: number): [number, number] => [wx * WIND_GAIN * (fall / 380), fall + wy * 2];
  const [fx, fy] = lean(250);
  const [mx, my] = lean(380);
  const [nx, ny] = lean(560);
  return [
    {
      id: 'rain_far',
      anims: ['rain_far'],
      layer: 'ground',
      count: Math.round(230 * intensity),
      life: 0.5,
      vx: fx,
      vy: fy,
      jitter: 0.12,
      parallax: 1,
      alpha: 1,
      frames: 'direction',
      splash: true,
    },
    {
      id: 'rain_mid',
      anims: ['rain_mid'],
      layer: 'air',
      count: Math.round(140 * intensity),
      life: 0.36,
      vx: mx,
      vy: my,
      jitter: 0.1,
      parallax: 1.12,
      alpha: 1,
      frames: 'direction',
    },
    {
      id: 'rain_near',
      anims: ['rain_near'],
      layer: 'near',
      count: Math.round(36 * intensity),
      life: 0.26,
      vx: nx,
      vy: ny,
      jitter: 0.1,
      parallax: 1.3,
      alpha: 1,
      frames: 'direction',
    },
  ];
}

function snowPlanes(intensity: number, wx: number, wy: number): FieldPlane[] {
  const drift = (fall: number): [number, number] => [wx * 1.8, fall + wy * 0.8];
  const [fx, fy] = drift(32);
  const [mx, my] = drift(50);
  const [nx, ny] = drift(78);
  return [
    {
      id: 'snow_far',
      anims: ['flake'],
      layer: 'ground',
      count: Math.round(400 * intensity),
      life: 5,
      vx: fx,
      vy: fy,
      jitter: 0.25,
      parallax: 1,
      alpha: 1,
      frames: 'fixed',
      pick: [0, 1, 1],
      sway: 3,
      swayPeriod: 2.6,
      fade: true,
    },
    {
      id: 'snow_mid',
      anims: ['flake'],
      layer: 'air',
      count: Math.round(260 * intensity),
      life: 4,
      vx: mx,
      vy: my,
      jitter: 0.25,
      parallax: 1.15,
      alpha: 1,
      frames: 'fixed',
      pick: [1, 1, 2, 3],
      sway: 4,
      swayPeriod: 2.2,
      fade: true,
    },
    {
      id: 'snow_near',
      anims: ['flake'],
      layer: 'near',
      count: Math.round(90 * intensity),
      life: 3,
      vx: nx,
      vy: ny,
      jitter: 0.2,
      parallax: 1.35,
      alpha: 1,
      frames: 'fixed',
      pick: [3, 4, 5],
      sway: 5,
      swayPeriod: 1.9,
      fade: true,
    },
  ];
}

function sandPlanes(strength: number, wx: number, wy: number): FieldPlane[] {
  const sp = Math.hypot(wx, wy) || 1;
  // Streaks travel along the wind, fast enough to read as blown, whatever the wind's size.
  const speed = (k: number) => Math.max(120, sp * k);
  const ux = wx / sp;
  const uy = wy / sp;
  return [
    {
      id: 'sand_mid',
      anims: ['sand_streak'],
      layer: 'air',
      count: Math.round(220 * strength),
      life: 0.7,
      vx: ux * speed(4.5),
      vy: uy * speed(4.5),
      jitter: 0.2,
      parallax: 1.1,
      alpha: 1,
      frames: 'direction',
    },
    {
      id: 'sand_near',
      anims: ['sand_streak'],
      layer: 'near',
      count: Math.round(60 * strength),
      life: 0.45,
      vx: ux * speed(7),
      vy: uy * speed(7),
      jitter: 0.15,
      parallax: 1.3,
      alpha: 1,
      frames: 'direction',
    },
  ];
}

function gritPlane(count: number, wx: number, wy: number): FieldPlane {
  const sp = Math.hypot(wx, wy) || 1;
  const speed = Math.max(90, sp * 4);
  return {
    id: 'grit',
    anims: ['grit'],
    layer: 'air',
    count,
    life: 0.8,
    vx: (wx / sp) * speed,
    vy: (wy / sp) * speed,
    jitter: 0.35,
    parallax: 1.08,
    alpha: 1,
    frames: 'fixed',
    pick: [0, 1, 2],
  };
}

function leafPlane(count: number, wx: number, wy: number, needles: boolean): FieldPlane {
  return {
    id: 'leaves',
    anims: needles
      ? ['needle', 'needle', 'leaf_amber']
      : ['leaf_green', 'leaf_olive', 'leaf_amber', 'leaf_green'],
    layer: 'air',
    count,
    life: 6,
    vx: wx * 3,
    vy: 16 + wy * 1.5,
    jitter: 0.4,
    parallax: 1.2,
    alpha: 1,
    frames: 'loop',
    sway: 7,
    swayPeriod: 2.8,
    fade: true,
  };
}

const WATER_SURFACES: readonly SurfaceId[] = ['asphalt', 'cobble', 'metal', 'ice'];

/** The layers and their numbers for one course. */
export function planWeather(preset: WeatherPreset, def: TrackDefinition): WeatherPlan {
  const layers = new Set<WeatherLayerId>(['surface_particles']);
  const planes: FieldPlane[] = [];
  const w = preset.weather;
  const biome = def.biome;
  const wx = preset.windX;
  const wy = preset.windY;
  const windSpeed = Math.hypot(wx, wy);
  const night = preset.timeOfDay === 'night';
  const cold = preset.ambientTempC <= 2;
  const wet = preset.wetness;
  const add = (...ids: WeatherLayerId[]) => ids.forEach((id) => layers.add(id));

  // --- Rain: three planes, splashes, spray, wet marks and reflections; lightning in a storm.
  if ((w === 'rain' || w === 'heavy_rain') && preset.rainIntensity > 0) {
    add('rain', 'splashes', 'spray', 'wet_tracks');
    planes.push(...rainPlanes(preset.rainIntensity, wx, wy));
    if (wet >= 0.5) add('reflections');
    if (w === 'heavy_rain') add('lightning');
    if (biome === 'forest') add('canopy_drips');
    if (anchorsOf(def, 'waterfall') > 0) add('runoff');
  } else if (wet >= 0.3) add('spray', 'wet_tracks');

  // --- Snow and frost.
  if (w === 'snowfall') {
    add('snow', 'snow_tracks', 'frost_vignette', 'cold_fog');
    planes.push(...snowPlanes(preset.rainIntensity, wx, wy));
  }
  if (w === 'clear_frost') {
    add('snow_tracks', 'diamond_dust', 'frost_vignette', 'cold_fog');
    planes.push({
      id: 'diamond_dust',
      anims: ['mote'],
      layer: 'glow',
      count: 26,
      life: 3.2,
      vx: wx * 1.5,
      vy: 10,
      jitter: 0.4,
      parallax: 1.15,
      alpha: 1,
      frames: 'fixed',
      pick: [0, 1, 2],
      sway: 2,
      swayPeriod: 2.4,
      fade: true,
      tint: 0xd8f0ff,
    });
  }
  if (biome === 'snow') {
    add('snow_tracks', 'ice_glints');
    if (anchorsOf(def, 'snow_gun') > 0) add('snow_guns');
  }
  if (cold) add('tailpipe_vapor');

  // --- Sand, wind and heat.
  if (w === 'sandstorm') {
    add('sand_streaks', 'grit', 'dust_bands', 'sand_tracks');
    planes.push(...sandPlanes(1, wx, wy), gritPlane(100, wx, wy));
  } else if (biome === 'desert') {
    add('sand_tracks', 'grit');
    if (windSpeed >= 40) {
      // A crosswind: streaks and bands blowing across the long straights.
      add('sand_streaks', 'dust_bands');
      planes.push(...sandPlanes(0.45, wx, wy), gritPlane(50, wx, wy));
    } else planes.push(gritPlane(w === 'dry_heat' ? 14 : 22, wx, wy));
    if (anchorsOf(def, 'tumbleweed') > 0) add('tumbleweeds');
    if (anchorsOf(def, 'dust_devil') > 0) add('dust_devils');
    if (w === 'dry_heat' || anchorsOf(def, 'heat_haze') > 0) add('heat_haze');
  }

  // --- Forest.
  if (biome === 'forest') {
    const needles =
      def.obstacles.filter((o) => o.kind === 'tree').length > 0 && def.id === 'forest_02';
    const rainy = w === 'rain' || w === 'heavy_rain';
    add('leaves');
    planes.push(leafPlane(rainy ? (w === 'heavy_rain' ? 12 : 8) : 18, wx, wy, needles));
    if (!rainy) add('light_shafts');
    if (!rainy && (anchorsOf(def, 'glow') > 0 || anchorsOf(def, 'canopy') > 0)) add('pollen');
    if (preset.timeOfDay !== 'day' && !rainy) add('fireflies');
    if (anchorsOf(def, 'mist') > 0 || (rainy && anchorsOf(def, 'water') > 0)) add('mist');
  }

  // --- Night, city and industry: vents on their timetable, the smelter, chimneys.
  if (def.hazards.some((h) => h.kind === 'steam_vent')) add('steam_vents');
  if (anchorsOf(def, 'sparks') > 0) add('smelter_sparks');
  if (biome === 'industrial' && (anchorsOf(def, 'glow') > 0 || anchorsOf(def, 'chimney') > 0))
    add('embers');
  if (anchorsOf(def, 'chimney') > 0) add('chimney_smoke');

  // --- Visibility: the sim's modifier, shown as haze at the screen edges.
  let haze: WeatherPlan['haze'] = null;
  if (preset.visibility < 0.97) {
    add('visibility_haze');
    const tint =
      w === 'sandstorm'
        ? 0xeac892
        : biome === 'desert'
          ? w === 'dry_heat'
            ? 0xf0d6a4
            : 0xdcc08c
          : w === 'snowfall'
            ? 0xe6eef8
            : biome === 'forest'
              ? 0x98a8a6
              : 0x8e9cb6;
    haze = { tint, maxAlpha: Math.min(0.48, (1 - preset.visibility) * 1.15) };
    // Rain and snow show it as a thicker curtain of drops or flakes far from the cars, not as
    // a tint: the pixels stay crisp, and the road near the car stays as clear as ever.
    const curtain = planes.find((p) => p.id === 'rain_mid' || p.id === 'snow_mid');
    if (curtain) {
      planes.push({
        ...curtain,
        id: 'veil',
        count: Math.round(900 * haze.maxAlpha),
        pick: curtain.id === 'snow_mid' ? [1, 1, 2, 2, 3] : undefined,
        parallax: 1.05,
        veil: true,
      });
      haze = null;
    }
  }

  return {
    presetId: preset.id,
    trackId: def.id,
    biome,
    layers,
    planes: planes.filter((p) => p.count > 0),
    wetness: wet,
    windX: wx * WIND_GAIN,
    windY: wy * WIND_GAIN,
    night,
    cold,
    haze,
    shiny: new Set(WATER_SURFACES),
  };
}

/** The sixteen courses: every track with each of its two weathers. */
export function courseList(tracks: readonly TrackDefinition[]): Array<[TrackDefinition, string]> {
  const out: Array<[TrackDefinition, string]> = [];
  for (const def of tracks) for (const id of def.weatherPresetIds) out.push([def, id]);
  return out;
}
