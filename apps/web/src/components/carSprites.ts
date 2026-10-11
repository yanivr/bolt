import { CATALOG, baselineBlueprint } from '@bolt/content';
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
  /** A mounted part to trace with a one-pixel outline in a color, without covering it. */
  outline?: { instanceId: string; color: string } | null;
  /**
   * Darkens the whole car except one thing, which is drawn again on top at full brightness:
   * a mounted part by instance, or the engine. `amount` is the share of black laid over the
   * rest, 0 to 1. Used by the garage's focus mode.
   */
  dim?: { amount: number; keep: { part: string } | { engine: true } | null } | null;
};

/** The color laid over a dimmed car: the interface's darkest navy, so it dims and does not grey. */
const DIM_COLOR = '11, 15, 25';

const silhouettes = new Map<string, HTMLCanvasElement>();

/** One frame of a sheet as a flat silhouette in a color, for tracing an outline. */
function silhouette(sheet: Sheet, frame: number, color: string): HTMLCanvasElement | null {
  const key = `${sheet.ref.file}:${frame}:${color}`;
  const cached = silhouettes.get(key);
  if (cached) return cached;
  const { frameWidth: fw, frameHeight: fh } = sheet.ref;
  const columns = sheet.ref.columns || CAR_SHEET_COLUMNS;
  const canvas = document.createElement('canvas');
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet.image,
    (frame % columns) * fw,
    Math.floor(frame / columns) * fh,
    fw,
    fh,
    0,
    0,
    fw,
    fh,
  );
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, fw, fh);
  if (silhouettes.size > 256) silhouettes.clear();
  silhouettes.set(key, canvas);
  return canvas;
}

/**
 * Sprite pixels of clear room the car canvas keeps on every side of the chassis frame. A
 * mounted part is drawn larger than its base and may reach past its mount and past the body
 * (a harpoon on a nose, a spoiler on a tail), so the canvas is this much larger than the
 * chassis cell; the element is pulled back by the same amount, so layout still sees the cell.
 */
export const CAR_CANVAS_PAD = 16;

/**
 * Draws one frame of a car, centred on the canvas. The canvas is square: `sheets.size`
 * pixels, or that plus `CAR_CANVAS_PAD` on every side where parts may overhang.
 */
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
  const size = ctx.canvas.width;
  ctx.clearRect(0, 0, size, ctx.canvas.height);
  ctx.imageSmoothingEnabled = false;
  // Which frame of its sheet each mounted part was drawn with, for tests of facing.
  const partFrames: string[] = [];
  const dim = options.dim && options.dim.amount > 0 ? options.dim : null;
  const ops = layoutCar(sheets.chassis, sheets.wheels, sheets.engine, pose, sheets.parts);
  const sheetOf = (op: (typeof ops)[number]): Sheet | undefined => {
    if (op.kind === 'shadow') return sheets.shadow;
    if (op.kind === 'body') return sheets.body;
    if (op.kind === 'headlight') return sheets.headlights;
    if (op.kind === 'wheel') return sheets.wheelSheet;
    if (op.kind === 'engine') return sheets.engineSheet;
    if (op.kind === 'part') return sheets.partSheets.get(op.sheetId);
    return undefined;
  };
  const drawOp = (op: (typeof ops)[number], sheet: Sheet) => {
    const { frameWidth: fw, frameHeight: fh } = sheet.ref;
    const columns = sheet.ref.columns || CAR_SHEET_COLUMNS;
    if (op.kind === 'part' && options.outline && op.instanceId === options.outline.instanceId) {
      // The part's own shape, one pixel out in each direction, drawn under the part: a halo
      // that follows the silhouette and hides nothing.
      const halo = silhouette(sheet, op.frame, options.outline.color);
      const x = Math.round(size / 2 + op.dx - fw / 2);
      const y = Math.round(size / 2 + op.dy - fh / 2);
      if (halo)
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          ctx.drawImage(halo, x + ox, y + oy);
    }
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
  };
  // One path for every car on every screen: the same operations in the same order.
  for (const op of ops) {
    const sheet = sheetOf(op);
    if (!sheet) continue;
    if (op.kind === 'part') partFrames.push(`${op.instanceId ?? ''}:${op.frame}`);
    drawOp(op, sheet);
  }
  if (dim) {
    // The dimming is a flat wash over the pixels already drawn, and nothing else: no blur and
    // no change to the art. What is kept bright is then drawn once more, as it was, on top.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(${DIM_COLOR}, ${Math.min(1, dim.amount)})`;
    ctx.fillRect(0, 0, size, ctx.canvas.height);
    ctx.restore();
    const keep = dim.keep;
    if (keep)
      for (const op of ops) {
        const kept =
          'part' in keep ? op.kind === 'part' && op.instanceId === keep.part : op.kind === 'engine';
        const sheet = kept ? sheetOf(op) : undefined;
        if (sheet) drawOp(op, sheet);
      }
  }
  if (ctx.canvas instanceof HTMLCanvasElement) ctx.canvas.dataset.partFrames = partFrames.join(' ');
}

export type { LocalPoint, ScreenPoint } from './carProjection.js';
export { mountHeight, projectPoints, screenToLocal } from './carProjection.js';

export type SpriteBox = { left: number; top: number; right: number; bottom: number };

const measured = new Map<string, SpriteBox>();

/** The measured bounds of a chassis at a heading frame, once `measureChassis` has run. */
export function measuredBounds(chassisId: string, frame: number): SpriteBox | undefined {
  return measured.get(`${chassisId}:${frame}`);
}

/**
 * Measures what a bare car on a chassis really draws at some heading frames: the opaque
 * pixels of the whole composition (shadow, wheels, body, engine and lights, on the chassis'
 * default engine and Street Tires), in sprite pixels from the car's centre. The workbench
 * sizes the car from this, so the scale is as large as the art allows rather than as large as
 * a guess allows, and wheels that stand outside the body, as the Spider's do, are counted.
 */
export async function measureChassis(
  manifests: GameManifests,
  chassisId: string,
  frames: readonly number[],
): Promise<void> {
  if (!manifests.cars.chassis[chassisId]) return;
  if (frames.every((frame) => measured.has(`${chassisId}:${frame}`))) return;
  const sheets = await loadCarSheets(manifests, baselineBlueprint({ chassisId }));
  if (!sheets) return;
  const size = sheets.size;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  for (const frame of frames) {
    drawCar(ctx, sheets, { frame, headlights: true });
    const data = ctx.getImageData(0, 0, size, size).data;
    const box: SpriteBox = { left: size, top: size, right: -1, bottom: -1 };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (data[(y * size + x) * 4 + 3]! > 0) {
          if (x < box.left) box.left = x;
          if (x > box.right) box.right = x;
          if (y < box.top) box.top = y;
          if (y > box.bottom) box.bottom = y;
        }
    if (box.right < 0) continue;
    measured.set(`${chassisId}:${frame}`, {
      left: box.left - size / 2,
      top: box.top - size / 2,
      right: box.right + 1 - size / 2,
      bottom: box.bottom + 1 - size / 2,
    });
  }
}
