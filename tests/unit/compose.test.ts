import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CarAtlasManifest, CarPose } from '@bolt/shared';
import {
  CAR_HEADINGS,
  MAX_WHEEL_YAW_RAD,
  TAU,
  WHEEL_HEADINGS,
  anchorToWorld,
  headingFrame,
  layoutCar,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(resolve('apps/web/public/assets/atlases/cars/manifest.json'), 'utf8'),
) as CarAtlasManifest;
const chassis = manifest.chassis.chassis_beetle!;
const wheels = manifest.wheels.tires_street!;
const engine = manifest.engines.engine_four_cylinder!;
const base: CarPose = {
  headingRad: 0,
  steer: 0,
  roll: 0,
  braking: false,
  headlights: false,
  bodyShiftX: 0,
  bodyShiftY: 0,
};

describe('vehicle compositor (Section 14.1)', () => {
  it('snaps headings to the authored frames and wraps correctly', () => {
    expect(headingFrame(0)).toBe(0);
    expect(headingFrame(TAU)).toBe(0);
    expect(headingFrame(-TAU / CAR_HEADINGS)).toBe(CAR_HEADINGS - 1);
    expect(headingFrame(Math.PI)).toBe(CAR_HEADINGS / 2);
    expect(headingFrame((TAU / CAR_HEADINGS) * 0.49)).toBe(0);
    expect(headingFrame((TAU / CAR_HEADINGS) * 0.51)).toBe(1);
  });

  it('draws shadow, one wheel per anchor, body, then engine, in that order', () => {
    const kinds = layoutCar(chassis, wheels, engine, base).map((op) => op.kind);
    expect(kinds).toEqual(['shadow', ...chassis.wheelAnchors.map(() => 'wheel'), 'body', 'engine']);
    const lit = layoutCar(chassis, wheels, engine, {
      ...base,
      braking: true,
      headlights: true,
    }).map((op) => op.kind);
    expect(lit.slice(-2)).toEqual(['headlight', 'brake']);
  });

  it('keeps every frame index inside its sheet for all headings, steering and roll', () => {
    for (let h = 0; h < 64; h++) {
      for (const steer of [-1, -0.4, 0, 0.7, 1]) {
        for (const roll of [-7.3, 0, 2.9, 1000.5]) {
          for (const op of layoutCar(chassis, wheels, engine, {
            ...base,
            headingRad: (h / 64) * TAU - Math.PI,
            steer,
            roll,
            braking: true,
            headlights: true,
          })) {
            const sheet = op.kind === 'wheel' ? wheels.sheet : op.kind === 'engine' ? engine.sheet : chassis.body;
            expect(Number.isInteger(op.frame)).toBe(true);
            expect(op.frame).toBeGreaterThanOrEqual(0);
            expect(op.frame).toBeLessThan(sheet.columns * sheet.rows);
            expect(Number.isInteger(op.dx) && Number.isInteger(op.dy)).toBe(true);
          }
        }
      }
    }
  });

  it('yaws only the steering wheels, in the steering direction', () => {
    const straight = layoutCar(chassis, wheels, engine, base).filter((op) => op.kind === 'wheel');
    const right = layoutCar(chassis, wheels, engine, { ...base, steer: 1 }).filter(
      (op) => op.kind === 'wheel',
    );
    chassis.wheelAnchors.forEach((anchor, i) => {
      if (anchor.steers) {
        expect(right[i]!.frame).toBe(headingFrame(MAX_WHEEL_YAW_RAD, WHEEL_HEADINGS));
        expect(right[i]!.frame).not.toBe(straight[i]!.frame);
      } else {
        expect(right[i]!.frame).toBe(straight[i]!.frame);
      }
    });
  });

  it('keeps wheels attached: each wheel stays at its anchor distance at every heading', () => {
    for (let h = 0; h < CAR_HEADINGS; h++) {
      const ops = layoutCar(chassis, wheels, engine, {
        ...base,
        headingRad: (h * TAU) / CAR_HEADINGS,
      }).filter((op) => op.kind === 'wheel');
      chassis.wheelAnchors.forEach((anchor, i) => {
        const expected = Math.hypot(anchor.x, anchor.y);
        expect(Math.abs(Math.hypot(ops[i]!.dx, ops[i]!.dy) - expected)).toBeLessThan(1);
      });
    }
  });

  it('moves the body, engine and lights together for lean and squat', () => {
    const shifted = layoutCar(chassis, wheels, engine, {
      ...base,
      bodyShiftX: 2,
      bodyShiftY: 1,
      braking: true,
      headlights: true,
    });
    const plain = layoutCar(chassis, wheels, engine, { ...base, braking: true, headlights: true });
    for (let i = 0; i < shifted.length; i++) {
      const moved = shifted[i]!.kind !== 'shadow' && shifted[i]!.kind !== 'wheel';
      expect(shifted[i]!.dx - plain[i]!.dx).toBe(moved ? 2 : 0);
      expect(shifted[i]!.dy - plain[i]!.dy).toBe(moved ? 1 : 0);
    }
  });

  it('maps anchors into the world with the heading convention used by physics', () => {
    const front = anchorToWorld({ x: 0, y: -10 }, 100, 100, 0);
    expect(front.x).toBeCloseTo(100, 9);
    expect(front.y).toBeCloseTo(90, 9);
    const east = anchorToWorld({ x: 0, y: -10 }, 100, 100, Math.PI / 2);
    expect(east.x).toBeCloseTo(110, 9);
    expect(east.y).toBeCloseTo(100, 9);
  });
});
