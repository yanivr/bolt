import type {
  CarAtlasManifest,
  DamageOverlayManifest,
  TerrainManifest,
  VfxAtlasManifest,
  VfxManifest,
} from '@bolt/shared';

/** Everything the race scene needs to know about what the art pipeline produced. */
export type GameManifests = {
  cars: CarAtlasManifest;
  vfx: VfxManifest;
  /** The packed combat effects atlas (Milestone C part 2). */
  fx: VfxAtlasManifest;
  /** Damage and frost overlays per chassis, or null when none are baked. */
  damage: DamageOverlayManifest | null;
  terrain: TerrainManifest;
  carsBase: string;
  vfxBase: string;
  fxBase: string;
  damageBase: string;
  terrainBase: string;
};

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets`;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as T;
}

export async function loadManifests(trackId: string, presetId: string): Promise<GameManifests> {
  const carsBase = `${ASSET_ROOT}/atlases/cars`;
  const vfxBase = `${ASSET_ROOT}/atlases/vfx_core`;
  const terrainBase = `${ASSET_ROOT}/maps/${trackId}/${presetId}`;
  const fxBase = `${ASSET_ROOT}/atlases/vfx_combat`;
  const damageBase = `${ASSET_ROOT}/atlases/vfx_damage`;
  const [cars, vfx, terrain, fx, damage] = await Promise.all([
    getJson<CarAtlasManifest>(`${carsBase}/manifest.json`),
    getJson<VfxManifest>(`${vfxBase}/manifest.json`),
    getJson<TerrainManifest>(`${terrainBase}/manifest.json`),
    getJson<VfxAtlasManifest>(`${fxBase}/manifest.json`),
    // The overlays are an extra: a build without them still races, with tint-only damage.
    getJson<DamageOverlayManifest>(`${damageBase}/manifest.json`).catch(() => null),
  ]);
  return {
    cars,
    vfx,
    terrain,
    fx,
    damage,
    carsBase,
    vfxBase,
    terrainBase,
    fxBase,
    damageBase,
  };
}
