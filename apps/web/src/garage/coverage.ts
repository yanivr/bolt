import type { ModuleSpec, ResolvedBuild } from '@bolt/shared';
import { aggregateModifiers, compileModules } from '@bolt/shared';

/**
 * What a mounted weapon covers, as shapes on the floor under the car.
 *
 * The numbers are the simulation's own. `compileModules` is what the race runs a weapon on
 * (docs/COMBAT_API.md), so the arc, the range, the minimum range, the drop distance and the
 * muzzle used here are exactly the ones that decide a hit, including any change a mount or
 * another part makes to a weapon's arc. Nothing in this file knows a weapon by name.
 *
 * Everything is in chassis-local pixels: x to the car's right, y toward its rear, the same
 * frame mounts and parts are placed in. Headings are radians from the car's nose, clockwise.
 */

/** A sector of a ring: a cone when `inner` is 0, a full circle or ring when `half` is PI. */
export type CoverageWedge = {
  kind: 'wedge';
  /** Where the arc is measured from: the muzzle, or the part's centre. */
  x: number;
  y: number;
  heading: number;
  /** Half-angle, radians. PI is all round. */
  half: number;
  inner: number;
  outer: number;
};

/** A round patch: where a mine goes off, where a lobbed shot lands. */
export type CoverageDisc = { kind: 'disc'; x: number; y: number; radius: number };

/** A strip on the road, such as an oil slick: a rectangle along `heading`. */
export type CoverageStrip = {
  kind: 'strip';
  x: number;
  y: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
};

/** A straight path from the muzzle to where a lobbed shot comes down. */
export type CoverageLine = { kind: 'line'; x: number; y: number; toX: number; toY: number };

export type CoverageShape = CoverageWedge | CoverageDisc | CoverageStrip | CoverageLine;

/** How a weapon's coverage is best described, for the drawing's pattern and for tests. */
export type CoverageKind = 'cone' | 'circle' | 'ring' | 'drop' | 'lob' | 'contact';

export type Coverage = {
  kind: CoverageKind;
  /** Quarter turns from the nose the part faces. */
  turn: number;
  /** The weapon's reach in world pixels, as the catalog and the simulation have it. */
  range: number;
  shapes: CoverageShape[];
};

/** A cone this narrow is drawn a little wider, so a rocket's line of fire is still a shape. */
const MIN_HALF = (4 * Math.PI) / 180;

function ahead(x: number, y: number, heading: number, distance: number): { x: number; y: number } {
  return { x: x + Math.sin(heading) * distance, y: y - Math.cos(heading) * distance };
}

/**
 * The coverage of one compiled weapon, at true size, or null for a part that is not a weapon.
 * The cases follow the simulation's `release` (combat/weapons.ts) one for one.
 */
export function weaponCoverage(spec: ModuleSpec): Coverage | null {
  if (spec.category !== 'weapon') return null;
  const heading = (spec.turn * Math.PI) / 2;
  const muzzle = ahead(spec.lx, spec.ly, heading, spec.muzzle);
  const base = { turn: spec.turn, range: spec.range };
  switch (spec.kind) {
    case 'mine': {
      // Dropped a set distance behind the hatch; it goes off within its trigger radius and
      // hurts within its blast radius.
      const at = ahead(muzzle.x, muzzle.y, heading, spec.dropDistance);
      return {
        ...base,
        kind: 'drop',
        range: spec.dropDistance,
        shapes: [
          { kind: 'disc', x: at.x, y: at.y, radius: spec.splashRadius },
          { kind: 'disc', x: at.x, y: at.y, radius: spec.triggerRadius },
        ],
      };
    }
    case 'strip': {
      const at = ahead(muzzle.x, muzzle.y, heading, spec.dropDistance + spec.hazardHalfLength);
      return {
        ...base,
        kind: 'drop',
        range: spec.dropDistance + spec.hazardHalfLength * 2,
        shapes: [
          {
            kind: 'strip',
            x: at.x,
            y: at.y,
            heading,
            halfLength: spec.hazardHalfLength,
            halfWidth: spec.hazardRadius,
          },
        ],
      };
    }
    case 'puddle': {
      // Lobbed a fixed distance along the muzzle: the path, and the puddle where it lands.
      const at = ahead(muzzle.x, muzzle.y, heading, spec.range);
      return {
        ...base,
        kind: 'lob',
        shapes: [
          { kind: 'line', x: muzzle.x, y: muzzle.y, toX: at.x, toY: at.y },
          { kind: 'disc', x: at.x, y: at.y, radius: spec.hazardRadius },
        ],
      };
    }
    case 'mortar':
      // All round, but not inside its minimum range.
      return {
        ...base,
        kind: 'ring',
        shapes: [
          {
            kind: 'wedge',
            x: spec.lx,
            y: spec.ly,
            heading: 0,
            half: Math.PI,
            inner: spec.minRange,
            outer: spec.range,
          },
        ],
      };
    case 'pulse':
    case 'arc':
      return {
        ...base,
        kind: 'circle',
        shapes: [
          {
            kind: 'wedge',
            x: spec.lx,
            y: spec.ly,
            heading: 0,
            half: Math.PI,
            inner: 0,
            outer: spec.range,
          },
        ],
      };
    case 'contact':
      return {
        ...base,
        kind: 'contact',
        shapes: [
          {
            kind: 'wedge',
            x: muzzle.x,
            y: muzzle.y,
            heading,
            half: Math.max(MIN_HALF, spec.half),
            inner: 0,
            outer: spec.range,
          },
        ],
      };
    default: {
      // A turret and anything else that aims all round covers a circle about itself.
      if (spec.aim === 'track' || spec.aim === 'none' || spec.half >= Math.PI)
        return {
          ...base,
          kind: 'circle',
          shapes: [
            {
              kind: 'wedge',
              x: spec.lx,
              y: spec.ly,
              heading: 0,
              half: Math.PI,
              inner: 0,
              outer: spec.range,
            },
          ],
        };
      // The hammer swings about its own mount; everything else fires from its muzzle.
      const from = spec.kind === 'melee' ? { x: spec.lx, y: spec.ly } : muzzle;
      return {
        ...base,
        kind: 'cone',
        shapes: [
          {
            kind: 'wedge',
            x: from.x,
            y: from.y,
            heading,
            half: Math.max(MIN_HALF, spec.half),
            inner: spec.minRange,
            outer: spec.range,
          },
        ],
      };
    }
  }
}

/** The coverage of every mounted part of a build, by part index; null for what is not a weapon. */
export function buildCoverage(build: ResolvedBuild): Array<Coverage | null> {
  return compileModules(build, aggregateModifiers(build)).map(weaponCoverage);
}

// --- Fitting it on the workbench -------------------------------------------------------------------

/**
 * Weapons reach 14 to 350 pixels and a car is under 50 long, so ranges are not drawn to scale:
 * the first `COVERAGE_TRUE` pixels from the weapon are, and everything beyond is drawn at
 * `COVERAGE_FAR` of its length. What is next to the car (a saw's reach, where a mine lands) is
 * its real size against the bodywork, and longer weapons still look longer, in order.
 */
export const COVERAGE_TRUE = 16;
export const COVERAGE_FAR = 0.12;
/** A coverage squeezed onto a small floor is never drawn shorter than this, or than it truly is. */
export const COVERAGE_MIN = 10;

/**
 * A distance from a weapon as it is drawn. Increasing, and the identity up to
 * `COVERAGE_TRUE`; beyond it, `far` of the rest.
 */
export function shownDistance(distance: number, far: number = COVERAGE_FAR): number {
  return distance <= COVERAGE_TRUE ? distance : COVERAGE_TRUE + (distance - COVERAGE_TRUE) * far;
}

/**
 * How a coverage is fitted to the floor it is drawn on. `limit` is the room the floor has
 * from the weapon along its line of fire, in sprite pixels: in focus the car is drawn four or
 * five times its size and the floor is short, so the whole shape is shrunk about the weapon
 * until its far edge is on the floor. The arc keeps its angle and its facing; only its length
 * gives way.
 */
export type CoverageFit = { far?: number; limit?: number };

/** The factor a fit shrinks a shape by, given the true reach of the shape. */
function squeeze(reach: number, fit: CoverageFit): number {
  const shown = shownDistance(reach, fit.far);
  if (fit.limit === undefined || shown <= 0) return 1;
  const room = Math.max(Math.min(COVERAGE_MIN, shown), fit.limit);
  return Math.min(1, room / shown);
}

/** A distance as drawn, for a shape whose true reach is `reach`, under a fit. */
export function fittedDistance(distance: number, reach: number, fit: CoverageFit = {}): number {
  return shownDistance(distance, fit.far) * squeeze(reach, fit);
}

/**
 * Where a coverage is measured from and which way it points, for working out the room it has:
 * a cone's apex and heading, the centre of a circle (`round`), the start of a lob. Null for a
 * drop zone, which is drawn at its real size where it really falls.
 */
export function coverageOrigin(
  coverage: Coverage,
): { x: number; y: number; heading: number; round: boolean } | null {
  const first = coverage.shapes[0];
  if (!first || coverage.kind === 'drop') return null;
  if (first.kind === 'wedge')
    return { x: first.x, y: first.y, heading: first.heading, round: first.half >= Math.PI };
  if (first.kind === 'line')
    return {
      x: first.x,
      y: first.y,
      heading: Math.atan2(first.toX - first.x, -(first.toY - first.y)),
      round: false,
    };
  return null;
}

export type CoveragePath = {
  /** Outline points in chassis-local pixels, in order. */
  points: Array<{ x: number; y: number }>;
  closed: boolean;
  /** An inner outline cut out of the shape (the mortar's minimum range), or null. */
  hole: Array<{ x: number; y: number }> | null;
  role: 'area' | 'core' | 'path';
};

function arc(
  x: number,
  y: number,
  radius: number,
  from: number,
  to: number,
  steps: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push({ x: x + Math.sin(a) * radius, y: y - Math.cos(a) * radius });
  }
  return out;
}

/**
 * The outlines to draw for a coverage, with every distance from the weapon passed through
 * `fittedDistance`. Angles are untouched: an 85 degree cone is drawn as 85 degrees.
 */
export function coveragePaths(coverage: Coverage, fit: CoverageFit = {}): CoveragePath[] {
  return coverage.shapes.map((shape, index): CoveragePath => {
    switch (shape.kind) {
      case 'wedge': {
        const outer = fittedDistance(shape.outer, shape.outer, fit);
        const inner = shape.inner > 0 ? fittedDistance(shape.inner, shape.outer, fit) : 0;
        if (shape.half >= Math.PI) {
          const ring = arc(shape.x, shape.y, outer, 0, Math.PI * 2, 48);
          return {
            points: ring,
            closed: true,
            hole: inner > 0 ? arc(shape.x, shape.y, inner, 0, Math.PI * 2, 32) : null,
            role: 'area',
          };
        }
        const steps = Math.max(4, Math.ceil((shape.half * 2) / (Math.PI / 24)));
        const rim = arc(
          shape.x,
          shape.y,
          outer,
          shape.heading - shape.half,
          shape.heading + shape.half,
          steps,
        );
        const near =
          inner > 0
            ? arc(
                shape.x,
                shape.y,
                inner,
                shape.heading + shape.half,
                shape.heading - shape.half,
                steps,
              )
            : [{ x: shape.x, y: shape.y }];
        return { points: [...rim, ...near], closed: true, hole: null, role: 'area' };
      }
      case 'disc':
        return {
          points: arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2, 32),
          closed: true,
          hole: null,
          role: index === 0 || coverage.kind === 'lob' ? 'area' : 'core',
        };
      case 'strip': {
        const fx = Math.sin(shape.heading);
        const fy = -Math.cos(shape.heading);
        const sx = -fy;
        const sy = fx;
        const corner = (along: number, across: number) => ({
          x: shape.x + fx * along * shape.halfLength + sx * across * shape.halfWidth,
          y: shape.y + fy * along * shape.halfLength + sy * across * shape.halfWidth,
        });
        return {
          points: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
          closed: true,
          hole: null,
          role: 'area',
        };
      }
      case 'line':
        return {
          points: [
            { x: shape.x, y: shape.y },
            { x: shape.toX, y: shape.toY },
          ],
          closed: false,
          hole: null,
          role: 'path',
        };
    }
  });
}

/**
 * The same coverage with a lobbed shot's landing point moved in along its own line, as far as
 * `fittedDistance` says, and its puddle shrunk with it. Wedges are left for `coveragePaths`
 * to shorten, since their distances are radii, and drop zones are left at their real size.
 */
export function fitCoverage(coverage: Coverage, fit: CoverageFit = {}): Coverage {
  const first = coverage.shapes[0];
  if (!first || coverage.kind !== 'lob' || first.kind !== 'line') return coverage;
  const dx = first.toX - first.x;
  const dy = first.toY - first.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return coverage;
  const k = fittedDistance(length, length, fit) / length;
  const toX = first.x + dx * k;
  const toY = first.y + dy * k;
  return {
    ...coverage,
    shapes: coverage.shapes.map((shape) =>
      shape.kind === 'line'
        ? { ...shape, toX, toY }
        : shape.kind === 'disc'
          ? {
              ...shape,
              x: toX,
              y: toY,
              radius: shownDistance(shape.radius, fit.far) * squeeze(length, fit),
            }
          : shape,
    ),
  };
}
