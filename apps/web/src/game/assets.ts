import type {
  CarAtlasManifest,
  DamageOverlayManifest,
  TerrainManifest,
  TrackRuntime,
  VfxAtlasManifest,
  VfxManifest,
} from '@bolt/shared';
import type { ArtIndex, Course, CourseArt } from '../app/course.js';
import { bakedPresetOf, courseArt, parseArtIndex } from '../app/course.js';
import { layoutMinimap } from './layout/layoutCanvas.js';

/** What the art pipeline produced that every race needs, whatever the track. */
export type CoreManifests = {
  cars: CarAtlasManifest;
  vfx: VfxManifest;
  /** The packed combat effects atlas (Milestone C part 2). */
  fx: VfxAtlasManifest;
  /** Damage and frost overlays per chassis, or null when none are baked. */
  damage: DamageOverlayManifest | null;
  /** Which tracks and weathers have baked terrain (`assets/maps/index.json`). */
  artIndex: ArtIndex;
  carsBase: string;
  vfxBase: string;
  fxBase: string;
  damageBase: string;
};

/** Everything the race scene needs to know about what the art pipeline produced. */
export type GameManifests = CoreManifests & {
  course: Course;
  /**
   * The terrain to draw. For a course drawn in the layout view it lists no chunks, overlays or
   * loops; the scene draws the layout instead.
   */
  terrain: TerrainManifest;
  terrainBase: string;
  terrainArt: CourseArt;
  /** URL of the course map image: the baked `minimap.png`, or one drawn from the layout. */
  minimapSrc: string;
};

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets`;

/** Where a track and preset's terrain bake lives. The minimap is always `minimap.png` there. */
export function terrainBaseOf(trackId: string, presetId: string): string {
  return `${ASSET_ROOT}/maps/${trackId}/${presetId}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as T;
}

export async function loadCoreManifests(): Promise<CoreManifests> {
  const carsBase = `${ASSET_ROOT}/atlases/cars`;
  const vfxBase = `${ASSET_ROOT}/atlases/vfx_core`;
  const fxBase = `${ASSET_ROOT}/atlases/vfx_combat`;
  const damageBase = `${ASSET_ROOT}/atlases/vfx_damage`;
  const [cars, vfx, fx, damage, index] = await Promise.all([
    getJson<CarAtlasManifest>(`${carsBase}/manifest.json`),
    getJson<VfxManifest>(`${vfxBase}/manifest.json`),
    getJson<VfxAtlasManifest>(`${fxBase}/manifest.json`),
    // The overlays are an extra: a build without them still races, with tint-only damage.
    getJson<DamageOverlayManifest>(`${damageBase}/manifest.json`).catch(() => null),
    getJson<unknown>(`${ASSET_ROOT}/maps/index.json`).catch(() => null),
  ]);
  return {
    cars,
    vfx,
    fx,
    damage,
    artIndex: parseArtIndex(index),
    carsBase,
    vfxBase,
    fxBase,
    damageBase,
  };
}

/** A terrain manifest with nothing baked in it, for a course drawn in the layout view. */
function layoutTerrain(
  course: Course,
  track: TrackRuntime,
): { terrain: TerrainManifest; minimapSrc: string } {
  const mini = layoutMinimap(track);
  const { worldWidth, worldHeight } = track.def;
  return {
    terrain: {
      version: 1,
      trackId: course.trackId,
      presetId: course.presetId,
      worldWidth,
      worldHeight,
      chunkSize: 1024,
      cols: Math.ceil(worldWidth / 1024),
      rows: Math.ceil(worldHeight / 1024),
      ground: [],
      overlays: [],
      animated: [],
      lights: [],
      minimap: { file: '', width: mini.width, height: mini.height, worldScale: mini.worldScale },
    },
    minimapSrc: mini.src,
  };
}

/**
 * The terrain for one course: its own bake, else the bake of another weather of the same
 * track (development and `?debug=1` builds only offer that), else the layout view.
 */
export async function loadCourseManifests(
  core: CoreManifests,
  course: Course,
  track: TrackRuntime,
): Promise<GameManifests> {
  const art = courseArt(core.artIndex, course);
  if (art !== 'layout') {
    const preset = bakedPresetOf(core.artIndex, course.trackId, course.presetId)!;
    const terrainBase = terrainBaseOf(course.trackId, preset);
    const terrain = await getJson<TerrainManifest>(`${terrainBase}/manifest.json`);
    return {
      ...core,
      course,
      terrain,
      terrainBase,
      terrainArt: art,
      minimapSrc: `${terrainBase}/${terrain.minimap.file}`,
    };
  }
  const layout = layoutTerrain(course, track);
  return { ...core, course, terrainBase: '', terrainArt: 'layout', ...layout };
}
