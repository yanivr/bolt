import type { RockRamp, SandRamp } from './palette.js';

/**
 * What a desert track tells the generic desert painters about its land: the sand and rock
 * families, the prevailing wind that built its dunes, a relief function for hill shading, and
 * region weights (dunes, playa, rubble, brush, tone, terraces) sampled on a coarse grid. All of
 * it is painted flat on the ground plane: on an open track the ground is drivable everywhere,
 * so landforms are shown by light and texture, never by raised art.
 */

export type Region = {
  /** Dune ridges, 0 to 1. */
  dune: number;
  /** Pale silt flat with shrinkage cracks, 0 to 1. */
  playa: number;
  /** Pebbles and scree, 0 to 1. */
  rubble: number;
  /** Desert scrub density, 0 to 1. */
  brush: number;
  /** Shift along the sand ramp: negative for shaded low ground, positive for bleached flats. */
  tone: number;
  /** Contour ledges on slopes, 0 to 1. */
  terrace: number;
  /** Wind-scoured streaks, 0 to 1. */
  streak: number;
  /** Share of the second sand, 0 to 1. */
  alt: number;
};

export type TerrainSpec = {
  sand: SandRamp;
  /** A second sand, laid in broad patches (iron-red dune sand, pale wind-sorted sand). */
  sandAlt: SandRamp;
  rock: RockRamp;
  /** The graded sand road: highlight, surface, worn, wheel track, and the edge furrow. */
  grade: { hi: number; base: number; mid: number; rut: number; edge: number };
  /** Unit vector the prevailing wind blows toward; dunes form across it. */
  prevailing: { x: number; y: number };
  /** Dune wavelength in world px. */
  duneLength: number;
  /** Dune crest height in world px at full `dune` weight. */
  duneHeight: number;
  region(x: number, y: number, out: Region): void;
  /** Relief in world px, for hill shading only. */
  height(x: number, y: number): number;
};

export const emptyRegion = (): Region => ({
  dune: 0,
  playa: 0,
  rubble: 0,
  brush: 0,
  tone: 0,
  terrace: 0,
  streak: 0,
  alt: 0,
});
