import type { Model, Shape } from '../../lib/model.js';
import { intersect, strip } from '../../lib/model.js';
import type { TireSpec } from './common.js';
import { flank, kit, rollOffset, tire, tireShape, wheel, wrap } from './common.js';

/**
 * Pavement kits. They share the proportions of the street tire, so each one is told by its
 * shoulders and markings: a bare slick with one chalk band, blue water channels, a red-dashed
 * soft compound, a square white-dashed hard compound, a yellow drift ring, a tiny chrome-capped
 * micro wheel.
 */

/** Slicks: wide, flat and bare. A single chalk band across the tread shows the rotation. */
function slick(phase: number): Model {
  const spec: TireSpec = { hw: 4.7, hl: 6.5, corner: 1.7, top: 5, crown: 5, arc: 0.2 };
  const shape = tireShape(spec);
  const pitch = 13;
  const offset = rollOffset(phase, 4, pitch);
  // One band per half turn: with four phases it is always somewhere on the visible top.
  const chalk: Shape = (x, y) => Math.max(wrap(y + offset - 0.9, pitch) - 1.9, Math.abs(x) - 3.6);
  return kit(
    [tire(spec)],
    [
      { shape: intersect(shape, strip(-2.9, -1.5)), on: ['tire'], shade: 1 },
      { shape: intersect(shape, chalk), on: ['tire'], material: 'hazard' },
    ],
  );
}

/** Rain Runners: herringbone blocks swept back from one deep blue centre channel. */
function rain(phase: number): Model {
  const spec: TireSpec = { hw: 4.1, hl: 6.6, corner: 2.1, top: 5.2, crown: 3 };
  const shape = tireShape(spec);
  const pitch = 3.6;
  const offset = rollOffset(phase, 3, pitch);
  const blocks: Shape = (x, y) =>
    Math.max(
      wrap(y + offset - Math.abs(x) * 0.8, pitch) - 2.2,
      0.75 - Math.abs(x),
      Math.abs(x) - 3.5,
    );
  return kit(
    [
      tire(spec),
      flank(spec.hw - 0.2, spec.hw + 0.5, spec.hl - 2.6, 'cyan', () => 2.9, { floor: 1.7 }),
    ],
    [
      { shape: intersect(shape, blocks), on: ['tire'], shade: 2 },
      { shape: intersect(shape, strip(-0.75, 0.75)), on: ['tire'], material: 'cyan', shade: -1 },
    ],
  );
}

/** A compound tire: plain grooves, with dashes of the compound color running round each shoulder. */
function compound(
  spec: TireSpec,
  mark: string,
  markShade: number,
  pitch: number,
  groove: number,
  phase: number,
): Model {
  const shape = tireShape(spec);
  const offset = rollOffset(phase, 3, pitch);
  const tread: Shape = (x, y) =>
    Math.max(wrap(y + offset, pitch) - (pitch - groove), Math.abs(x) - (spec.hw - 1.7));
  const dashes: Shape = (x, y) =>
    Math.max(
      wrap(y + offset + pitch / 2, pitch) - pitch * 0.55,
      Math.abs(Math.abs(x) - (spec.hw - 0.9)) - 0.55,
    );
  return kit(
    [
      tire(spec),
      flank(spec.hw - 0.2, spec.hw + 0.6, spec.hl - 2.4, mark, () => 3.1, { floor: 1.5 }),
    ],
    [
      { shape: intersect(shape, tread), on: ['tire'], shade: 2 },
      { shape: intersect(shape, dashes), on: ['tire'], material: mark, shade: markShade },
    ],
  );
}

/** Soft Compound: round shoulders, warm dark rubber, fine grooves, red marks. */
const soft = (phase: number): Model =>
  compound(
    { hw: 4.5, hl: 6.6, corner: 2.5, top: 5.3, crown: 2.4, material: 'rubberSoft' },
    'markRed',
    0,
    3,
    1.1,
    phase,
  );

/** Hard Compound: square shoulders, cool grey rubber, coarse blocks, white marks. */
const hard = (phase: number): Model =>
  compound(
    { hw: 4.2, hl: 6.6, corner: 1.2, top: 5.2, crown: 7, arc: 0.14, material: 'rubberHard' },
    'ivory',
    -2,
    4.2,
    1.3,
    phase,
  );

/** Drift Rings: a low tire with slanted grooves and a bright yellow ring on each sidewall. */
function drift(phase: number): Model {
  const spec: TireSpec = { hw: 4, hl: 6.5, corner: 1.9, top: 4.8, crown: 4 };
  const shape = tireShape(spec);
  const pitch = 3.6;
  const offset = rollOffset(phase, 3, pitch);
  // Grooves slant one way on each half so the pair stays symmetric left to right.
  const slashes: Shape = (x, y) =>
    Math.max(wrap(y + offset + Math.abs(x) * 0.9, pitch) - 1.2, Math.abs(x) - 3);
  return kit(
    [
      tire(spec),
      flank(spec.hw - 0.3, spec.hw + 0.9, spec.hl - 1.8, 'hazard', () => 3.5, { floor: 1 }),
    ],
    [{ shape: intersect(shape, slashes), on: ['tire'], shade: 2 }],
  );
}

/** Micro Wheels: a tiny tire between two polished hub caps. */
function micro(phase: number): Model {
  const spec: TireSpec = { hw: 2.7, hl: 4.1, corner: 1.4, top: 3.7, crown: 3 };
  const shape = tireShape(spec);
  const pitch = 2.7;
  const offset = rollOffset(phase, 3, pitch);
  const grooves: Shape = (x, y) => Math.max(wrap(y + offset, pitch) - 1.2, Math.abs(x) - 2);
  return kit(
    [
      tire(spec),
      flank(
        spec.hw - 0.2,
        spec.hw + 0.8,
        2.3,
        'chromeLit',
        (y) => 0.6 + 1.1 * Math.sqrt(Math.max(0, 5.3 - y * y)),
      ),
    ],
    [{ shape: intersect(shape, grooves), on: ['tire'], shade: 2 }],
  );
}

export const SLICK_WHEEL_ART = wheel('tires_slick', 24, 4, slick);
export const RAIN_WHEEL_ART = wheel('tires_rain', 24, 3, rain);
export const SOFT_WHEEL_ART = wheel('tires_soft', 24, 3, soft);
export const HARD_WHEEL_ART = wheel('tires_hard', 24, 3, hard);
export const DRIFT_WHEEL_ART = wheel('tires_drift', 24, 3, drift);
export const MICRO_WHEEL_ART = wheel('tires_micro', 20, 3, micro);
