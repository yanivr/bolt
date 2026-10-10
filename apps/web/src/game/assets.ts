import type { CarAtlasManifest, TerrainManifest, VfxManifest } from '@bolt/shared';

/** Everything the race scene needs to know about what the art pipeline produced. */
export type GameManifests = {
  cars: CarAtlasManifest;
  vfx: VfxManifest;
  terrain: TerrainManifest;
  carsBase: string;
  vfxBase: string;
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
  const [cars, vfx, terrain] = await Promise.all([
    getJson<CarAtlasManifest>(`${carsBase}/manifest.json`),
    getJson<VfxManifest>(`${vfxBase}/manifest.json`),
    getJson<TerrainManifest>(`${terrainBase}/manifest.json`),
  ]);
  return { cars, vfx, terrain, carsBase, vfxBase, terrainBase };
}
