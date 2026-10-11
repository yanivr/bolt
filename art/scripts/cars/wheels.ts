import type { Decal, Model, Solid } from '../lib/model.js';
import { intersect, roundRect, strip } from '../lib/model.js';
import { CAR_MATERIALS } from './materials.js';
import type { WheelArt } from './types.js';

/**
 * Wheel kits seen from above: a tire barrel with a tread pattern that advances with the roll
 * phase. Each kit is one model function, so tread style is the readable difference between
 * kits on every chassis (Section 12.7).
 */

function barrel(halfWidth: number, halfLength: number, radius: number): Solid {
  return {
    shape: roundRect(0, 0, halfWidth, halfLength, radius),
    material: 'rubber',
    z0: 0,
    z1: 5,
    // A tire is a cylinder lying on its side: height falls off across its width only.
    height: (x) => 5.2 * Math.sqrt(Math.max(0.04, 1 - (x / (halfWidth + 0.4)) ** 2)),
    tag: 'tire',
  };
}

/** Street tire: fine straight grooves and two circumferential channels. */
function streetTire(rollPhase: number): Model {
  const hw = 4;
  const hl = 6.6;
  const tire = roundRect(0, 0, hw, hl, 2.1);
  const pitch = 3;
  const offset = (rollPhase / 3) * pitch;
  const grooves: Decal = {
    shape: intersect(tire, (x, y) => {
      const m = (((y + offset + 0.5) % pitch) + pitch) % pitch;
      return Math.max(m - 0.95, Math.abs(x) - 3.1);
    }),
    on: ['tire'],
    shade: 2,
  };
  const channel: Decal = { shape: intersect(tire, strip(-0.45, 0.45)), on: ['tire'], shade: -1 };
  return { solids: [barrel(hw, hl, 2.1)], decals: [grooves, channel], materials: CAR_MATERIALS };
}

export const STREET_WHEEL_ART: WheelArt = {
  id: 'tires_street',
  cell: 24,
  rollFrames: 3,
  model: streetTire,
};
