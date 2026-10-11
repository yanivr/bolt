import type { PoolQuality } from './EffectPool.js';

/**
 * Effects quality (Section 13.2: emitters are scaled by device quality; Section 19.5: when the
 * frame rate drops, decorative sparks go first and gameplay objects never).
 *
 * `auto` watches the frame time: half a second over 21 ms a frame drops to `low`, which halves
 * decorative particle counts and the decorative share of every pool; five steady seconds under
 * 17.5 ms brings `high` back. Projectiles, hazards, telegraphs and warnings are pinned sprites
 * and are not affected by either tier. A settings screen can force a tier with `setVfxQuality`.
 */
export type VfxQualitySetting = 'auto' | PoolQuality;

let setting: VfxQualitySetting = 'auto';
let current: PoolQuality = 'high';

export function setVfxQuality(value: VfxQualitySetting): void {
  setting = value;
  if (value !== 'auto') current = value;
}

export function vfxQualitySetting(): VfxQualitySetting {
  return setting;
}

/** The tier in force right now. */
export function vfxQuality(): PoolQuality {
  return current;
}

const SLOW_MS = 21;
const FAST_MS = 17.5;
const DROP_AFTER = 0.5;
const RAISE_AFTER = 5;

export class QualityGovernor {
  private slow = 0;
  private fast = 0;
  /** Smoothed frame time in milliseconds. */
  frameMs = 16.7;

  /** Feed one frame's length in seconds; returns the tier to use. */
  update(dt: number): PoolQuality {
    if (dt <= 0 || dt > 0.25) return current;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;
    if (setting !== 'auto') {
      current = setting;
      return current;
    }
    if (this.frameMs > SLOW_MS) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.frameMs < FAST_MS) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    if (current === 'high' && this.slow >= DROP_AFTER) {
      current = 'low';
      this.slow = 0;
    } else if (current === 'low' && this.fast >= RAISE_AFTER) {
      current = 'high';
      this.fast = 0;
    }
    return current;
  }

  reset(): void {
    this.slow = 0;
    this.fast = 0;
    this.frameMs = 16.7;
  }
}
