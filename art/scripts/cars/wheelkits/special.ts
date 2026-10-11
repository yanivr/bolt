import type { Model, Shape } from '../../lib/model.js';
import { intersect, mirrorX, strip } from '../../lib/model.js';
import type { TireSpec } from './common.js';
import { disc, flank, kit, rollOffset, tire, tireShape, wheel, wrap } from './common.js';

/**
 * Engineered kits: armor, airless spokes, electromagnets, shifting plates, hub blades. Each
 * carries something no rubber tire has: steel across the tread, orange spokes in the shoulders,
 * a lit cyan strip, green seams, or a saw disc standing proud of the sidewall.
 */

/** Armored Tires: steel belts across the tread and a shield plate over each sidewall. */
function armored(phase: number): Model {
  const spec: TireSpec = { hw: 4.6, hl: 6.8, corner: 1.6, top: 5.4, crown: 5 };
  const shape = tireShape(spec);
  const pitch = 4.4;
  const offset = rollOffset(phase, 4, pitch);
  const belt: Shape = (x, y) => Math.max(wrap(y + offset, pitch) - 2.9, Math.abs(x) - 3.9);
  const rivets: Shape = (x, y) =>
    Math.hypot(Math.abs(x) - 2.6, wrap(y + offset, pitch) - 1.45) - 0.6;
  return kit(
    [
      tire(spec),
      // Shield: a chamfered plate that does not turn with the wheel.
      flank(spec.hw - 0.3, spec.hw + 1.1, 4.8, 'steel', (y) => Math.min(4.8, 7.6 - Math.abs(y))),
    ],
    [
      { shape: intersect(shape, belt), on: ['tire'], material: 'trackSteel' },
      { shape: intersect(shape, rivets), on: ['tire'], material: 'bore' },
    ],
  );
}

/** Solid Core: an airless tire. Orange spokes show through cutouts along both shoulders. */
function solid(phase: number): Model {
  const spec: TireSpec = { hw: 4.5, hl: 6.5, corner: 1.5, top: 5.2, crown: 6, arc: 0.16 };
  const shape = tireShape(spec);
  const pitch = 2.9;
  const offset = rollOffset(phase, 3, pitch);
  const shoulder = mirrorX(strip(2.2, 3.9));
  const spokes: Shape = (_x, y) => wrap(y + offset, pitch) - 1.25;
  return kit(
    [tire(spec), flank(spec.hw - 0.2, spec.hw + 0.5, 4.6, 'cable', () => 3.6, { floor: 1.4 })],
    [
      { shape: intersect(shape, shoulder), on: ['tire'], material: 'bore' },
      {
        shape: intersect(shape, intersect(shoulder, spokes)),
        on: ['tire'],
        material: 'cable',
        shade: -1,
      },
      { shape: intersect(shape, strip(-0.5, 0.5)), on: ['tire'], shade: -1 },
    ],
  );
}

/** Magnetic Rollers: a segmented steel drum with a lit strip round its middle and axle stubs. */
function magnetic(phase: number): Model {
  const spec: TireSpec = {
    hw: 4.3,
    hl: 6.2,
    corner: 0.9,
    top: 5,
    crown: 8,
    arc: 0.34,
    material: 'trackSteel',
  };
  const shape = tireShape(spec);
  const pitch = 4.2;
  const offset = rollOffset(phase, 4, pitch);
  const plates: Shape = (x, y) =>
    Math.max(wrap(y + offset, pitch) - 3.2, 0.9 - Math.abs(x), Math.abs(x) - 3.7);
  const dashes: Shape = (x, y) => Math.max(wrap(y + offset + 0.4, pitch) - 2.4, Math.abs(x) - 0.6);
  return kit(
    [
      tire(spec),
      flank(spec.hw - 0.2, spec.hw + 1, 1.7, 'chromeLit', disc(0, 1.7, 1.6, 1), { floor: 1 }),
    ],
    [
      { shape: intersect(shape, plates), on: ['tire'], shade: 2 },
      { shape: intersect(shape, strip(-0.6, 0.6)), on: ['tire'], material: 'cyan', shade: -1 },
      { shape: intersect(shape, dashes), on: ['tire'], material: 'cyanGlow' },
    ],
  );
}

/** Adaptive Tires: two columns of plates, out of step, with lit green seams between them. */
function adaptive(phase: number): Model {
  const spec: TireSpec = {
    hw: 4.4,
    hl: 6.6,
    corner: 2,
    top: 5.2,
    crown: 4,
    material: 'rubberHard',
  };
  const shape = tireShape(spec);
  const pitch = 4;
  const offset = rollOffset(phase, 4, pitch);
  // The right column sits half a plate behind the left, as if the tread were mid-shuffle.
  const plate: Shape = (x, y) =>
    Math.max(
      wrap(y + offset + (x > 0 ? pitch / 2 : 0), pitch) - 3,
      0.5 - Math.abs(x),
      Math.abs(x) - 3.5,
    );
  return kit(
    [
      tire(spec, (x, y) => (plate(x, y) < -0.3 ? 0.5 : 0)),
      flank(spec.hw - 0.2, spec.hw + 0.6, 1.5, 'green', () => 3.4, { floor: 1.8 }),
    ],
    [
      { shape: intersect(shape, strip(-3.5, 3.5)), on: ['tire'], material: 'green' },
      { shape: intersect(shape, plate), on: ['tire'], material: 'rubberHard', shade: 1 },
    ],
  );
}

/** Razor Wheels: a narrow tire with a toothed saw disc and a spike outside each sidewall. */
function blades(phase: number): Model {
  const spec: TireSpec = { hw: 3.6, hl: 6.4, corner: 2, top: 5, crown: 3 };
  const shape = tireShape(spec);
  const pitch = 3;
  const offset = rollOffset(phase, 3, pitch);
  const grooves: Shape = (x, y) => Math.max(wrap(y + offset, pitch) - 1.1, Math.abs(x) - 2.7);
  const toothPitch = 3.3;
  const toothOffset = rollOffset(phase, 3, toothPitch);
  const saw = (y: number): number => {
    const rim = Math.sqrt(Math.max(0, 4.9 * 4.9 - y * y));
    const tooth = Math.abs(wrap(y + toothOffset, toothPitch) / toothPitch - 0.5) * 2;
    return 1.6 + rim * 0.9 + tooth * 1.8;
  };
  const spike: Shape = (x, y) => {
    const out = Math.abs(x) - spec.hw;
    return Math.max(-out, Math.abs(y) - (3.6 - out) * 0.42);
  };
  return kit(
    [
      tire(spec),
      {
        shape: spike,
        material: 'steel',
        z0: 2.6,
        z1: 3.6,
        bevel: 0.6,
        floor: 1.8,
        tag: 'spike',
        noShadow: true,
      },
      flank(spec.hw + 0.5, spec.hw + 1.4, 4.8, 'chromeWall', saw, { floor: 1.4 }),
      flank(spec.hw + 1.2, spec.hw + 1.9, 1.3, 'steelDark', disc(0, 1.3, 2.6, 1), { floor: 2 }),
    ],
    [{ shape: intersect(shape, grooves), on: ['tire'], shade: 2 }],
  );
}

export const ARMORED_WHEEL_ART = wheel('tires_armored', 24, 4, armored);
export const SOLID_WHEEL_ART = wheel('tires_solid', 24, 3, solid);
export const MAGNETIC_WHEEL_ART = wheel('tires_magnetic', 24, 4, magnetic);
export const ADAPTIVE_WHEEL_ART = wheel('tires_adaptive', 24, 4, adaptive);
export const BLADES_WHEEL_ART = wheel('tires_blades', 24, 3, blades);
