import type {
  AnchorPoint,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  WheelSpriteManifest,
} from './assets.js';
import { CAR_HEADINGS, CAR_TILT, CAR_Z_SCALE, WHEEL_HEADINGS } from './assets.js';
import { TAU } from './math.js';

/**
 * The single vehicle compositing function (Section 14.1). Given the sprite manifests and a
 * pose it returns an ordered list of draw operations. The garage preview, VS card, live race,
 * results podium, thumbnails and the art pipeline's review sheets all call this, so a car can
 * never look different from one screen to the next.
 *
 * Pure layout only: callers own the actual drawing.
 */

export type CarLayerKind = 'shadow' | 'wheel' | 'body' | 'engine' | 'part' | 'brake' | 'headlight';

export type CarDrawOp = {
  kind: CarLayerKind;
  /** Which sheet to draw from: a chassis, wheel kit or engine id. */
  sheetId: string;
  /** Linear frame index in the sheet, counted row by row. */
  frame: number;
  /** Offset of the frame centre from the car origin, in sprite pixels. */
  dx: number;
  dy: number;
  /** For mounted parts: the blueprint instance this sprite belongs to. */
  instanceId?: string;
};

/** A mounted accessory to draw: where it sits on the chassis and how it is turned. */
export type MountedPartSprite = {
  instanceId: string;
  partId: string;
  /** Centre of the part in chassis-local pixels. */
  x: number;
  y: number;
  /** Height of the bodywork it stands on, in authored units. */
  z: number;
  quarterTurns: number;
};

export type CarPose = {
  /** Heading relative to the screen's up direction, radians clockwise. */
  headingRad: number;
  /** Filtered steering, -1 to 1. Front wheels yaw visibly. */
  steer: number;
  /** Accumulated wheel roll in sprite phases; any real number. */
  roll: number;
  braking: boolean;
  headlights: boolean;
  /** Body offset from the wheels in car-local pixels: lean (x) and squat or dive (y). */
  bodyShiftX: number;
  bodyShiftY: number;
};

export const MAX_WHEEL_YAW_RAD = (26 * Math.PI) / 180;

export function headingFrame(headingRad: number, frames = CAR_HEADINGS): number {
  const step = TAU / frames;
  return ((Math.round(headingRad / step) % frames) + frames) % frames;
}

function rotated(p: AnchorPoint, rad: number): { x: number; y: number } {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function layoutCar(
  chassis: ChassisSpriteManifest,
  wheels: WheelSpriteManifest,
  engine: EngineSpriteManifest,
  pose: CarPose,
  parts: MountedPartSprite[] = [],
): CarDrawOp[] {
  const frame = headingFrame(pose.headingRad);
  const snapped = (frame * TAU) / CAR_HEADINGS;
  const ops: CarDrawOp[] = [];
  const shift = rotated({ x: pose.bodyShiftX, y: pose.bodyShiftY }, snapped);
  const bx = Math.round(shift.x);
  const by = Math.round(shift.y);

  ops.push({ kind: 'shadow', sheetId: chassis.id, frame, dx: 2, dy: 3 });

  const rollRow =
    ((Math.floor(pose.roll) % wheels.rollFrames) + wheels.rollFrames) % wheels.rollFrames;
  for (const anchor of chassis.wheelAnchors) {
    const yaw = anchor.steers ? pose.steer * MAX_WHEEL_YAW_RAD : 0;
    const p = rotated(anchor, snapped);
    ops.push({
      kind: 'wheel',
      sheetId: wheels.id,
      frame: rollRow * WHEEL_HEADINGS + headingFrame(snapped + yaw, WHEEL_HEADINGS),
      dx: Math.round(p.x),
      dy: Math.round(p.y),
    });
  }

  ops.push({ kind: 'body', sheetId: chassis.id, frame, dx: bx, dy: by });

  const e = rotated(chassis.engineAnchor, snapped);
  ops.push({
    kind: 'engine',
    sheetId: engine.id,
    frame,
    dx: Math.round(e.x) + bx,
    dy: Math.round(e.y) + by,
  });

  // Mounted parts, far side first so nearer parts overlap the ones behind them.
  const placed = parts.map((part) => {
    const p = rotated(part, snapped);
    return { part, x: p.x, y: p.y };
  });
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const { part, x, y } of placed) {
    ops.push({
      kind: 'part',
      sheetId: part.partId,
      frame: headingFrame(snapped + (part.quarterTurns * TAU) / 4),
      dx: Math.round(x) + bx,
      dy: Math.round(y - CAR_TILT * CAR_Z_SCALE * part.z) + by,
      instanceId: part.instanceId,
    });
  }

  if (pose.headlights) ops.push({ kind: 'headlight', sheetId: chassis.id, frame, dx: bx, dy: by });
  if (pose.braking) ops.push({ kind: 'brake', sheetId: chassis.id, frame, dx: bx, dy: by });
  return ops;
}

/** World-space position of a chassis-local anchor for a car at an exact (unsnapped) heading. */
export function anchorToWorld(
  anchor: AnchorPoint,
  x: number,
  y: number,
  headingRad: number,
): { x: number; y: number } {
  const p = rotated(anchor, headingRad);
  return { x: x + p.x, y: y + p.y };
}
