import { CATALOG } from '@bolt/content';
import type {
  CarPose,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  MountedPartSprite,
  PaintDefinition,
  SpriteSheetRef,
  VehicleBlueprint,
  WheelSpriteManifest,
} from '@bolt/shared';
import {
  CAR_HEADINGS,
  CAR_SHEET_COLUMNS,
  TAU,
  layoutCar,
  engineSheetFor,
  mountedPartSprites,
  resolveCarSprites,
} from '@bolt/shared';
import type { GameManifests } from '../game/assets.js';

/**
 * Loading and drawing a car outside the race. Every car shown in the interface (the home
 * turntable, the garage workbench, blueprint thumbnails) is composed here from the same
 * sprite sheets, the same exact-color paint swap and the same shared `layoutCar` as the race
 * scene, so a car can never look different from one screen to the next.
 */

const images = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${url}`));
      image.src = url;
    });
    // A failed download is not cached, so the next car that needs it tries again.
    pending.catch(() => images.delete(url));
    images.set(url, pending);
  }
  return pending;
}

function rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

const painted = new Map<string, Promise<CanvasImageSource>>();

/**
 * A chassis body sheet in a paint, by exact-color palette swap: the pipeline bakes bodies in
 * a key ramp no other material uses, so glass, steel and lights are never touched and the
 * result stays crisp. No tinting, no filters.
 */
export function paintedBody(
  base: string,
  chassis: ChassisSpriteManifest,
  paint: PaintDefinition | undefined,
): Promise<CanvasImageSource> {
  const key = `${base}/${chassis.body.file}:${paint?.id ?? ''}`;
  let pending = painted.get(key);
  if (!pending) {
    pending = loadImage(`${base}/${chassis.body.file}`).then((source) => {
      if (!paint) return source;
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return source;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const from = chassis.paintKey.map(rgb);
      const to = paint.ramp.map(rgb);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        for (let k = 0; k < from.length; k++) {
          const f = from[k]!;
          if (px[i] === f[0] && px[i + 1] === f[1] && px[i + 2] === f[2]) {
            const t = to[k] ?? f;
            px[i] = t[0];
            px[i + 1] = t[1];
            px[i + 2] = t[2];
            break;
          }
        }
      }
      ctx.putImageData(data, 0, 0);
      return canvas;
    });
    pending.catch(() => painted.delete(key));
    painted.set(key, pending);
  }
  return pending;
}

type Sheet = { image: CanvasImageSource; ref: SpriteSheetRef };

export type CarSheets = {
  chassis: ChassisSpriteManifest;
  wheels: WheelSpriteManifest;
  engine: EngineSpriteManifest;
  body: Sheet;
  shadow: Sheet;
  headlights: Sheet;
  wheelSheet: Sheet;
  engineSheet: Sheet;
  /** Mounted parts that have art, keyed by part id. */
  partSheets: Map<string, Sheet>;
  parts: MountedPartSprite[];
  /** Frame size of the chassis sheets: the canvas a car is drawn on. */
  size: number;
};

/**
 * Everything needed to draw a blueprint, or null when its chassis has no art yet. Engines and
 * wheel kits without art fall back to the default sheets (`resolveCarSprites`). Mounted parts
 * whose sheet is not in the manifest, or fails to download, are simply left off the drawing.
 */
export async function loadCarSheets(
  manifests: GameManifests,
  blueprint: VehicleBlueprint,
): Promise<CarSheets | null> {
  const { cars, carsBase: base } = manifests;
  const loadout = resolveCarSprites(cars, blueprint).loadout;
  if (!loadout) return null;
  const chassis = cars.chassis[loadout.chassisId];
  const wheels = cars.wheels[loadout.tireKitId];
  const engine = cars.engines[loadout.engineId];
  if (!chassis || !wheels || !engine) return null;
  const parts = mountedPartSprites(cars, blueprint, CATALOG);
  const partIds = [...new Set(parts.map((p) => p.partId))];
  const [body, shadow, headlights, wheelImage, engineImage, partImages] = await Promise.all([
    paintedBody(base, chassis, cars.paints[loadout.paintId]),
    loadImage(`${base}/${chassis.shadow.file}`),
    loadImage(`${base}/${chassis.headlights.file}`),
    loadImage(`${base}/${wheels.sheet.file}`),
    loadImage(`${base}/${engineSheetFor(chassis, engine).file}`),
    Promise.all(
      partIds.map((id) => {
        const ref = cars.parts?.[id]?.sheet;
        return ref
          ? loadImage(`${base}/${ref.file}`).then(
              (image): [string, Sheet] | null => [id, { image, ref }],
              () => null,
            )
          : null;
      }),
    ),
  ]);
  const partSheets = new Map<string, Sheet>();
  for (const loaded of partImages) if (loaded) partSheets.set(loaded[0], loaded[1]);
  return {
    chassis,
    wheels,
    engine,
    body: { image: body, ref: chassis.body },
    shadow: { image: shadow, ref: chassis.shadow },
    headlights: { image: headlights, ref: chassis.headlights },
    wheelSheet: { image: wheelImage, ref: wheels.sheet },
    engineSheet: { image: engineImage, ref: engineSheetFor(chassis, engine) },
    partSheets,
    parts: parts.filter((p) => partSheets.has(p.partId)),
    size: chassis.body.frameWidth,
  };
}

export type DrawOptions = {
  /** Heading frame, 0 (nose up) to 63, clockwise. */
  frame: number;
  headlights?: boolean;
  /** Body offset in car-local pixels, for the idle shudder. */
  bodyShiftY?: number;
};

/** Draws one frame of a car, centred on a square canvas of `sheets.size` pixels. */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  sheets: CarSheets,
  options: DrawOptions,
): void {
  const pose: CarPose = {
    headingRad: (options.frame * TAU) / CAR_HEADINGS,
    steer: 0,
    roll: 0,
    braking: false,
    headlights: options.headlights ?? true,
    bodyShiftX: 0,
    bodyShiftY: options.bodyShiftY ?? 0,
  };
  const size = sheets.size;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  for (const op of layoutCar(sheets.chassis, sheets.wheels, sheets.engine, pose, sheets.parts)) {
    let sheet: Sheet | undefined;
    if (op.kind === 'shadow') sheet = sheets.shadow;
    else if (op.kind === 'body') sheet = sheets.body;
    else if (op.kind === 'headlight') sheet = sheets.headlights;
    else if (op.kind === 'wheel') sheet = sheets.wheelSheet;
    else if (op.kind === 'engine') sheet = sheets.engineSheet;
    else if (op.kind === 'part') sheet = sheets.partSheets.get(op.sheetId);
    if (!sheet) continue;
    const { frameWidth: fw, frameHeight: fh } = sheet.ref;
    const columns = sheet.ref.columns || CAR_SHEET_COLUMNS;
    ctx.drawImage(
      sheet.image,
      (op.frame % columns) * fw,
      Math.floor(op.frame / columns) * fh,
      fw,
      fh,
      Math.round(size / 2 + op.dx - fw / 2),
      Math.round(size / 2 + op.dy - fh / 2),
      fw,
      fh,
    );
  }
}

export type LocalPoint = { id: string; x: number; y: number; z: number };
export type ScreenPoint = { id: string; dx: number; dy: number };

const NO_SHEET: SpriteSheetRef = { file: '', frameWidth: 1, frameHeight: 1, columns: 1, rows: 1 };
const NO_WHEELS: WheelSpriteManifest = { id: '', sheet: NO_SHEET, rollFrames: 1 };
const NO_ENGINE: EngineSpriteManifest = { id: '', sheet: NO_SHEET, exhaustStyle: 'none' };

/**
 * Where chassis-local points land on the drawn car at a heading frame, as offsets from the
 * car's centre in sprite pixels. The points are run through `layoutCar` itself as if they
 * were mounted parts, so a mount marker sits exactly where the compositor draws the part.
 */
export function projectPoints(
  chassis: ChassisSpriteManifest,
  frame: number,
  points: readonly LocalPoint[],
): Map<string, ScreenPoint> {
  const pose: CarPose = {
    headingRad: (frame * TAU) / CAR_HEADINGS,
    steer: 0,
    roll: 0,
    braking: false,
    headlights: false,
    bodyShiftX: 0,
    bodyShiftY: 0,
  };
  const ops = layoutCar(
    chassis,
    NO_WHEELS,
    NO_ENGINE,
    pose,
    points.map((p) => ({ instanceId: p.id, partId: '', x: p.x, y: p.y, z: p.z, quarterTurns: 0 })),
  );
  const out = new Map<string, ScreenPoint>();
  for (const op of ops)
    if (op.kind === 'part' && op.instanceId !== undefined)
      out.set(op.instanceId, { id: op.instanceId, dx: op.dx, dy: op.dy });
  return out;
}

/** A screen-space drag, in sprite pixels, as a chassis-local offset at a heading frame. */
export function screenToLocal(frame: number, dx: number, dy: number): { x: number; y: number } {
  const rad = (-frame * TAU) / CAR_HEADINGS;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Height of the bodywork under a mount, as the compositor reads it. */
export function mountHeight(chassis: ChassisSpriteManifest, mountId: string): number {
  const heights = chassis.mountHeights ?? {};
  return Object.prototype.hasOwnProperty.call(heights, mountId) ? heights[mountId]! : 10;
}
