import { angleDelta, clamp, expBlend, lerp, smoothstep, wrapAngle } from '@bolt/shared';

/**
 * Follow camera (Sections 7.5 and 13.7). It trails the car with an eased spring, leads
 * slightly in the direction of travel, turns toward the car's heading at a capped rate, and
 * zooms between 1.0 at speed and 1.25 when slow. Shake is budgeted and never exceeds a few
 * world pixels. The HUD is DOM and is never affected.
 */

const MAX_TURN_RATE = (60 * Math.PI) / 180;
const TURN_TIME = 0.32;
const FOLLOW_TIME = 0.09;
const LEAD_SECONDS = 0.2;
const MAX_LEAD = 54;
const ZOOM_TIME = 0.7;
const SHAKE_LIMIT = 3;

export class ChaseCamera {
  x = 0;
  y = 0;
  heading = 0;
  zoom = 1.25;
  shakeX = 0;
  shakeY = 0;
  private shakeAmount = 0;
  private shakeTime = 0;
  private shakeSeed = 1;

  snapTo(x: number, y: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.zoom = 1.25;
  }

  update(
    dt: number,
    carX: number,
    carY: number,
    carHeading: number,
    velX: number,
    velY: number,
    northUp: boolean,
    shakeScale: number,
  ): void {
    const speed = Math.hypot(velX, velY);
    let leadX = velX * LEAD_SECONDS;
    let leadY = velY * LEAD_SECONDS;
    const lead = Math.hypot(leadX, leadY);
    if (lead > MAX_LEAD) {
      leadX *= MAX_LEAD / lead;
      leadY *= MAX_LEAD / lead;
    }
    const k = expBlend(dt, FOLLOW_TIME);
    this.x += (carX + leadX - this.x) * k;
    this.y += (carY + leadY - this.y) * k;

    const targetHeading = northUp ? 0 : carHeading;
    const diff = angleDelta(this.heading, targetHeading);
    const rate = clamp(diff / TURN_TIME, -MAX_TURN_RATE, MAX_TURN_RATE);
    this.heading = wrapAngle(this.heading + rate * dt);

    const targetZoom = lerp(1.25, 1, smoothstep(40, 235, speed));
    this.zoom += (targetZoom - this.zoom) * expBlend(dt, ZOOM_TIME);

    if (this.shakeTime > 0 && shakeScale > 0) {
      this.shakeTime -= dt;
      // Stepped pseudo-random offsets: a couple of crisp jolts, not a smooth wobble.
      this.shakeSeed = (this.shakeSeed * 16807) % 2147483647;
      const a = (this.shakeSeed / 2147483647) * Math.PI * 2;
      const amount = this.shakeAmount * shakeScale * clamp(this.shakeTime / 0.12, 0, 1);
      this.shakeX = Math.round(Math.cos(a) * amount);
      this.shakeY = Math.round(Math.sin(a) * amount);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.shakeAmount = 0;
    }
  }

  /** Adds an impulse in world pixels. Overlapping impulses share one budget. */
  kick(pixels: number, seconds: number): void {
    this.shakeAmount = Math.min(SHAKE_LIMIT, Math.max(this.shakeAmount, pixels));
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  /** World point to camera view space: x right, y down, origin at the camera anchor. */
  toView(wx: number, wy: number, out: { x: number; y: number }): void {
    const dx = wx - this.x;
    const dy = wy - this.y;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    out.x = dx * c + dy * s;
    out.y = -dx * s + dy * c;
  }
}
