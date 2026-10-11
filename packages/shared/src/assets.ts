/**
 * Machine-readable manifests written by the art pipeline and read by the web client. Keeping
 * the shapes here means the baker and the renderer cannot drift apart.
 */

export type TerrainChunk = {
  col: number;
  row: number;
  /** File name relative to the manifest. */
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Foreground art drawn above cars: gantries, bridges, lantern strings, canopies. */
export type TerrainOverlay = {
  id: string;
  kind: string;
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** When true the client fades the overlay while the local car is underneath it. */
  fadeNearPlayer: boolean;
};

/** Looping ambient animation stored as a horizontal strip of equally sized frames. */
export type TerrainAnimatedProp = {
  id: string;
  kind: string;
  file: string;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  /** Draw above cars (true) or on the ground below them (false). */
  above: boolean;
  blend: 'normal' | 'add';
};

/** Baked lamp positions, so dynamic sprites can pick up a matching tint as they pass. */
export type TerrainLight = {
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
};

export type TerrainManifest = {
  version: 1;
  trackId: string;
  presetId: string;
  worldWidth: number;
  worldHeight: number;
  chunkSize: number;
  cols: number;
  rows: number;
  ground: TerrainChunk[];
  overlays: TerrainOverlay[];
  animated: TerrainAnimatedProp[];
  lights: TerrainLight[];
  minimap: { file: string; width: number; height: number; worldScale: number };
};

// --- Vehicles ----------------------------------------------------------------------------------

/**
 * Authored headings per chassis. Sixty-four frames put 5.6 degrees between neighbours, so a
 * turning car reads as rotating rather than snapping (the specification's sixteen is a floor).
 */
export const CAR_HEADINGS = 64;
/** Heading frames are packed in a grid this many columns wide to stay inside texture limits. */
export const CAR_SHEET_COLUMNS = 8;
export const WHEEL_HEADINGS = 32;
/**
 * Camera tilt of every vehicle sprite: screen pixels a point rises per unit of height, and the
 * exaggeration applied to authored heights. The compositor uses the same numbers to lift a
 * mounted part to the height of its mount, so parts sit on the bodywork at every heading.
 */
export const CAR_TILT = 0.62;
export const CAR_Z_SCALE = 1.3;

export type AnchorPoint = { x: number; y: number };

export type SpriteSheetRef = {
  /** File name relative to the manifest. */
  file: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
};

export type ChassisSpriteManifest = {
  id: string;
  /** One frame per heading, heading 0 first, clockwise, packed row by row. */
  body: SpriteSheetRef;
  shadow: SpriteSheetRef;
  brakeLights: SpriteSheetRef;
  headlights: SpriteSheetRef;
  /** Exact RGB values (hex) of the paint ramp baked into `body`, darkest first. */
  paintKey: string[];
  /** Chassis-local positions; the compositor rotates them per heading. */
  wheelAnchors: Array<AnchorPoint & { id: string; steers: boolean }>;
  engineAnchor: AnchorPoint;
  exhausts: AnchorPoint[];
  headlightAnchors: AnchorPoint[];
  brakeLightAnchors: AnchorPoint[];
  /** Height of the bodywork under each accessory mount, in authored units. Missing means 10. */
  mountHeights?: Record<string, number>;
  /**
   * True when the engine sits inside the bodywork instead of at the tail. Such a chassis draws
   * the engine's `bay` sheet, which has no low tailpipes; the chassis routes its own exhaust.
   */
  engineInBay?: boolean;
};

export type WheelSpriteManifest = {
  id: string;
  /** Columns are 32 directions, rows are roll phases. */
  sheet: SpriteSheetRef;
  rollFrames: number;
};

export type EngineSpriteManifest = {
  id: string;
  /** One frame per heading, packed row by row. Drawn at the chassis engine anchor. */
  sheet: SpriteSheetRef;
  /** The same engine without the pipes that hang behind a rear deck. */
  bay?: SpriteSheetRef;
  exhaustStyle: 'puff' | 'flame' | 'none';
};

/**
 * A point on a mounted part in the part's own space at heading 0: `x` to the car's right and
 * `y` toward its rear (so a muzzle that points forward has a negative `y`), both in sprite
 * pixels from the part's centre, and `z` up from the mount surface in authored height units,
 * the same units as `mountHeights`.
 */
export type PartAnchor = { x: number; y: number; z: number };

/**
 * A mounted weapon, defense or utility. One frame per heading, packed row by row like a
 * chassis. The cell holds the whole drawing at every heading; the drawing is larger than the
 * part's base and may reach past its mount. Drawn at the part's position on the chassis
 * (mount plus offset), turned by its quarter-turn rotation.
 */
export type PartSpriteManifest = {
  id: string;
  sheet: SpriteSheetRef;
  /**
   * Where shots and muzzle flashes start, one per barrel in firing order. Present on every
   * weapon. Place one on screen with `partAnchorOffset`.
   */
  muzzles?: PartAnchor[];
  /** The axis a self-aiming head turns about (turrets). */
  pivot?: PartAnchor;
};

/**
 * Where a part anchor is drawn, in sprite pixels from the centre of the part's frame, for a
 * part whose frame shows it at `headingRad` (the car's heading plus the part's quarter turns,
 * clockwise from up). The same arithmetic as the sprite baker: turn on the ground plane, then
 * lift by the tilted camera. Add the result to where the compositor put the part.
 */
export function partAnchorOffset(anchor: PartAnchor, headingRad: number): AnchorPoint {
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  return {
    x: anchor.x * c - anchor.y * s,
    y: anchor.x * s + anchor.y * c - CAR_TILT * CAR_Z_SCALE * anchor.z,
  };
}

/** Square part icons packed in one sheet per size; `index` maps a part id to its cell. */
export type IconSheetManifest = {
  file: string;
  size: number;
  columns: number;
  index: Record<string, number>;
};

export type PaintDefinition = { id: string; displayName: string; ramp: string[] };

export type CarAtlasManifest = {
  version: 1;
  chassis: Record<string, ChassisSpriteManifest>;
  wheels: Record<string, WheelSpriteManifest>;
  engines: Record<string, EngineSpriteManifest>;
  /** Mounted parts. Absent until the first accessory sprites are baked. */
  parts?: Record<string, PartSpriteManifest>;
  /** Catalog icons at 32 and 24 pixels for every part that has art. */
  icons?: IconSheetManifest[];
  paints: Record<string, PaintDefinition>;
};

// --- Effects -----------------------------------------------------------------------------------

export type VfxStripManifest = {
  id: string;
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
};

export type VfxManifest = { version: 1; strips: Record<string, VfxStripManifest> };

// --- Combat effects atlas ----------------------------------------------------------------------

/**
 * Draw layer of a combat effect, lowest first. The renderer keeps one batch per layer, so the
 * order inside an explosion (smoke under debris under fire under flash) never depends on which
 * sprite happened to be created first.
 */
export const VFX_LAYERS = [
  'decal',
  'glow',
  'ground',
  'smoke',
  'body',
  'fire',
  'flash',
  'mark',
] as const;
export type VfxLayer = (typeof VFX_LAYERS)[number];

/**
 * One animation in a packed effects atlas (Section 13.8: frame sequence, playback rate, anchor,
 * layer priority, looping flag, fallback). Frames sit in a grid starting at `x`, `y`, `columns`
 * to a row, each `frameWidth` by `frameHeight` with `padding` clear pixels between neighbours.
 *
 * A directional animation holds `directions` headings (heading 0 up the screen, clockwise) of
 * `frames / directions` time frames each: frame index = direction * (frames / directions) + time.
 * Nothing in the atlas is ever rotated or scaled at run time.
 */
export type VfxAnimManifest = {
  id: string;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  columns: number;
  fps: number;
  loop: boolean;
  /** The point of each frame that is placed on the effect's position, in frame pixels. */
  anchorX: number;
  anchorY: number;
  layer: VfxLayer;
  blend: 'normal' | 'add';
  /** Headings baked into the strip, or 1 when it has no direction. */
  directions: number;
  /** Animation to draw when this one cannot be (reduced flashes), or null. */
  fallback: string | null;
};

export type VfxAtlasManifest = {
  version: 1;
  /** File name relative to the manifest. */
  file: string;
  width: number;
  height: number;
  padding: number;
  anims: Record<string, VfxAnimManifest>;
};

/**
 * Damage and frost overlays for one chassis: the same 64 headings as its body sheet, one block
 * of rows per state, drawn over the body by the compositor. `states` names the blocks in order.
 */
export type DamageOverlayManifest = {
  version: 1;
  states: string[];
  chassis: Record<string, SpriteSheetRef>;
};

/** Position of frame `index` of an atlas animation, in atlas pixels. */
export function vfxFrameRect(
  anim: VfxAnimManifest,
  index: number,
  padding: number,
): { x: number; y: number; w: number; h: number } {
  const col = index % anim.columns;
  const row = Math.floor(index / anim.columns);
  return {
    x: anim.x + col * (anim.frameWidth + padding),
    y: anim.y + row * (anim.frameHeight + padding),
    w: anim.frameWidth,
    h: anim.frameHeight,
  };
}
