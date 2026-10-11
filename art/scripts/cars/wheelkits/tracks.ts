import type { Model, Shape, Solid } from '../../lib/model.js';
import { intersect, roundRect, strip } from '../../lib/model.js';
import { bar, disc, flank, kit, rollOffset, wheel, wrap } from './common.js';

/**
 * Tracked kits. Each unit is a short pod that sits at one wheel anchor: a belt running round
 * its road wheels, with links that travel as it rolls. From above the belt shows its links and
 * cleated edges; side-on the tilted camera sees the road wheels under the top run.
 */

type PodSpec = {
  hw: number;
  hl: number;
  top: number;
  /** Radius of the loop where the belt turns over at each end. */
  turn: number;
  pitch: number;
  link: number;
  material: string;
};

/** Top run of the belt: flat between the end wheels, rolling over and down at each end. */
const beltHeight =
  (spec: PodSpec) =>
  (y: number): number => {
    const over = Math.abs(y) - (spec.hl - spec.turn);
    if (over <= 0) return spec.top;
    return spec.top - spec.turn + Math.sqrt(Math.max(0, spec.turn * spec.turn - over * over));
  };

function belt(spec: PodSpec, offset: number): { solid: Solid; shape: Shape; links: Shape } {
  const base = roundRect(0, 0, spec.hw, spec.hl, 0.8);
  const cleat = (y: number): number => bar(y + offset, spec.pitch, spec.link, 0.35);
  const flat = spec.hl - 1.6;
  // Each link stands a little proud of the belt edge.
  const shape: Shape = (x, y) => {
    const fade = Math.max(0, Math.min(1, (flat - Math.abs(y)) / 1));
    return base(x, y) - 0.6 * cleat(y) * fade;
  };
  const height = beltHeight(spec);
  const solid: Solid = {
    shape,
    material: spec.material,
    z0: 0,
    z1: spec.top,
    height: (_x, y) => height(y) + 0.5 * cleat(y),
    tag: 'belt',
  };
  const links: Shape = (_x, y) => wrap(y + offset, spec.pitch) - spec.link;
  return { solid, shape, links };
}

/** Half Tracks: a short rubber belt with spaced cleats over two yellow-hubbed bogie wheels. */
function halfTrack(phase: number): Model {
  const spec: PodSpec = {
    hw: 3.7,
    hl: 8.2,
    top: 5.4,
    turn: 2.6,
    pitch: 3.4,
    link: 1.5,
    material: 'rubber',
  };
  const offset = rollOffset(phase, 4, spec.pitch);
  const { solid, shape, links } = belt(spec, offset);
  const wheels = (y: number): number =>
    Math.max(disc(-4.2, 3, 1.3, 0.9)(y), disc(4.2, 3, 1.3, 0.9)(y));
  const hubs = (y: number): number =>
    Math.max(disc(-4.2, 1.5, 1.3, 0.9)(y), disc(4.2, 1.5, 1.3, 0.9)(y));
  return kit(
    [
      solid,
      flank(spec.hw - 0.3, spec.hw + 0.7, 7.2, 'steelWall', wheels),
      flank(spec.hw + 0.4, spec.hw + 1.2, 5.7, 'hazard', hubs, { floor: 1.3 }),
    ],
    [
      { shape: intersect(shape, links), on: ['belt'], material: 'trackSteel', shade: 1 },
      { shape: intersect(shape, strip(-0.5, 0.5)), on: ['belt'], shade: -1 },
    ],
  );
}

/** Full Tracks: a long steel-link belt with a guide groove, over four steel road wheels. */
function fullTrack(phase: number): Model {
  const spec: PodSpec = {
    hw: 4.5,
    hl: 9.8,
    top: 5.6,
    turn: 2.8,
    pitch: 2.6,
    link: 1.8,
    material: 'trackSteel',
  };
  const offset = rollOffset(phase, 4, spec.pitch);
  const { solid, shape, links } = belt(spec, offset);
  const centres = [-6.9, -2.3, 2.3, 6.9];
  const wheels = (y: number): number => Math.max(...centres.map((c) => disc(c, 2.3, 1.5, 0.95)(y)));
  return kit(
    [
      solid,
      flank(spec.hw - 0.3, spec.hw + 0.8, 9.1, 'steelWall', wheels),
      // A fender strip above the wheels, so the top run reads as a track guard.
      flank(spec.hw - 0.3, spec.hw + 1.1, 6.6, 'olive', () => 5.2, { floor: 4.3 }),
    ],
    [
      { shape: intersect(shape, links), on: ['belt'], shade: 2 },
      { shape: intersect(shape, strip(-0.6, 0.6)), on: ['belt'], material: 'bore' },
    ],
  );
}

export const HALF_TRACK_WHEEL_ART = wheel('tires_halftrack', 28, 4, halfTrack);
export const FULL_TRACK_WHEEL_ART = wheel('tires_track', 32, 4, fullTrack);
