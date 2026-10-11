import type { SimPose } from '../game/rendering/frame.js';
import {
  FollowCamera,
  LEAD_FRACTION_X,
  LEAD_FRACTION_Y,
  chooseViewScale,
} from '../game/rendering/frame.js';

/**
 * Where things in the world are on the screen, worked out by the HUD for itself.
 *
 * The race feed carries no camera, and the HUD does not reach into the scene. The camera is a
 * pure function of the local car's pose, though (`FollowCamera` in rendering/frame.ts), so the
 * HUD runs a second one on the same numbers: the same view scale from the same canvas size,
 * the same lead through the same two low-pass stages. Its input is the snapshot pose moved
 * forward on its velocity rather than the scene's predicted and interpolated pose, so it can
 * be a few pixels off the real picture. That is far inside what an edge arrow needs.
 */

export type ScreenPoint = { x: number; y: number };

export class HudCamera {
  private readonly camera = new FollowCamera();
  private readonly pose: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
  private scale = 1;
  private ratio = 1;
  private lastMs = Number.NaN;
  private key = '';
  /** CSS size of the view. */
  width = 0;
  height = 0;
  ready = false;

  /** Call when the view's CSS size, the pixel ratio or the track may have changed. */
  configure(
    cssWidth: number,
    cssHeight: number,
    dpr: number,
    worldWidth: number,
    worldHeight: number,
  ): void {
    const key = `${cssWidth}x${cssHeight}@${dpr}:${worldWidth}x${worldHeight}`;
    if (key === this.key) return;
    this.key = key;
    const choice = chooseViewScale(cssWidth, cssHeight, dpr);
    this.scale = choice.scale;
    this.ratio = choice.renderRatio;
    this.width = cssWidth;
    this.height = cssHeight;
    this.camera.configure({
      widthPx: Math.max(2, Math.round(cssWidth * choice.renderRatio)),
      heightPx: Math.max(2, Math.round(cssHeight * choice.renderRatio)),
      scale: choice.scale,
      worldWidth,
      worldHeight,
    });
    this.camera.cut();
    this.lastMs = Number.NaN;
  }

  /** Forget the lead, for a car put back on the grid. */
  cut(): void {
    this.camera.cut();
    this.lastMs = Number.NaN;
    this.ready = false;
  }

  /** Advances the camera to `nowMs` for the local car at a world position and velocity (px/s). */
  update(nowMs: number, x: number, y: number, vx: number, vy: number): void {
    const dt = Number.isNaN(this.lastMs)
      ? 0
      : Math.min(0.1, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    const pose = this.pose;
    pose.x = x;
    pose.y = y;
    pose.vx = vx;
    pose.vy = vy;
    this.camera.update(dt, pose, 0);
    this.ready = true;
  }

  /** A world position in CSS pixels from the top left of the view. */
  toScreen(worldX: number, worldY: number, out: ScreenPoint): ScreenPoint {
    out.x = (worldX * this.scale - this.camera.scrollPxX) / this.ratio;
    out.y = (worldY * this.scale - this.camera.scrollPxY) / this.ratio;
    return out;
  }

  /** Where the local car is drawn. */
  car(out: ScreenPoint): ScreenPoint {
    return this.toScreen(this.pose.x, this.pose.y, out);
  }

  /** CSS pixels per world pixel. */
  get cssPerWorld(): number {
    return this.scale / this.ratio;
  }
}

// --- The area the car can be in --------------------------------------------------------------------

/**
 * Half-extents, in CSS pixels, of the ellipse the local car's screen position stays inside:
 * the camera leads it by up to 12 percent of the view's width and 27 percent of its height
 * (docs/DECISIONS.md entry 34), in the direction of travel. The HUD's panels are laid out so
 * that a box around the car anywhere in that ellipse touches none of them.
 */
export function carRoam(cssWidth: number, cssHeight: number): { rx: number; ry: number } {
  return { rx: cssWidth * LEAD_FRACTION_X, ry: cssHeight * LEAD_FRACTION_Y };
}

export type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Whether a box of `boxW` x `boxH` centred on the car can touch `rect` for any direction of
 * travel, the car being anywhere on or inside its roaming ellipse around the view's centre.
 */
export function carCanReach(
  rect: Rect,
  cssWidth: number,
  cssHeight: number,
  boxW: number,
  boxH: number,
): boolean {
  const { rx, ry } = carRoam(cssWidth, cssHeight);
  const cx = cssWidth / 2;
  const cy = cssHeight / 2;
  // The rectangle grown by half the box is where the car's centre would have to be.
  const left = rect.left - boxW / 2 - cx;
  const right = rect.right + boxW / 2 - cx;
  const top = rect.top - boxH / 2 - cy;
  const bottom = rect.bottom + boxH / 2 - cy;
  // Nearest point of that rectangle to the centre, measured in ellipse units.
  const nx = Math.max(left, Math.min(0, right));
  const ny = Math.max(top, Math.min(0, bottom));
  const ex = rx > 0 ? nx / rx : nx === 0 ? 0 : Infinity;
  const ey = ry > 0 ? ny / ry : ny === 0 ? 0 : Infinity;
  return ex * ex + ey * ey <= 1;
}

// --- Edge indicator --------------------------------------------------------------------------------

export type EdgeMark = {
  /** Where to draw the marker. */
  x: number;
  y: number;
  /** Direction it points, radians clockwise from screen-up. */
  angle: number;
};

/**
 * The off-screen indicator of Section 7.5. Returns null while `target` is on screen (inside
 * `view`); otherwise the point where the line from `origin` (the local car) toward the target
 * leaves `frame`, the rectangle the marker is clamped to, and the direction of the target.
 */
export function edgeMark(
  target: ScreenPoint,
  origin: ScreenPoint,
  view: Rect,
  frame: Rect,
): EdgeMark | null {
  if (
    target.x >= view.left &&
    target.x <= view.right &&
    target.y >= view.top &&
    target.y <= view.bottom
  )
    return null;
  const ox = Math.max(frame.left, Math.min(frame.right, origin.x));
  const oy = Math.max(frame.top, Math.min(frame.bottom, origin.y));
  const dx = target.x - ox;
  const dy = target.y - oy;
  const angle = Math.atan2(dx, -dy);
  if (dx === 0 && dy === 0) return { x: ox, y: oy, angle: 0 };
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (frame.right - ox) / dx);
  else if (dx < 0) t = Math.min(t, (frame.left - ox) / dx);
  if (dy > 0) t = Math.min(t, (frame.bottom - oy) / dy);
  else if (dy < 0) t = Math.min(t, (frame.top - oy) / dy);
  t = Math.max(0, Math.min(1, t));
  return {
    x: Math.max(frame.left, Math.min(frame.right, ox + dx * t)),
    y: Math.max(frame.top, Math.min(frame.bottom, oy + dy * t)),
    angle,
  };
}
