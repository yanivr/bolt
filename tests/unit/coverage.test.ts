import { CATALOG, WEAPON_LIST } from '@bolt/content';
import type { QuarterTurn } from '@bolt/shared';
import { resolveBlueprint } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { Coverage, CoverageWedge } from '../../apps/web/src/garage/coverage.js';
import {
  COVERAGE_MIN,
  COVERAGE_TRUE,
  buildCoverage,
  coverageOrigin,
  coveragePaths,
  fitCoverage,
  fittedDistance,
  shownDistance,
} from '../../apps/web/src/garage/coverage.js';
import { testBlueprint } from '../helpers/combat.js';

/**
 * What a weapon covers, as the garage draws it on the floor under the car. The shapes come
 * from the simulation's own compiled weapon (docs/COMBAT_API.md), so these tests hold the
 * drawing to the catalog: the right kind of shape for every weapon, the catalog's arc and
 * range, and a shape that turns with the part.
 */

function coverageOf(partId: string, turn: QuarterTurn = 0, mount = 'roof_mid'): Coverage {
  const blueprint = testBlueprint({ parts: [{ id: partId, mount, turn, fire: 0 }] });
  const build = resolveBlueprint(blueprint, CATALOG)!;
  expect(build.unresolved, partId).toEqual([]);
  const coverage = buildCoverage(build)[0];
  expect(coverage, partId).not.toBeNull();
  return coverage!;
}

const DEG = Math.PI / 180;
const wedge = (c: Coverage) => c.shapes[0] as CoverageWedge;

describe('weapon coverage', () => {
  it('gives every weapon in the catalog a shape with an area', () => {
    expect(WEAPON_LIST.length).toBe(20);
    for (const weapon of WEAPON_LIST) {
      const coverage = coverageOf(
        weapon.id,
        weapon.facing === 'fixed' && weapon.fixedTurn === 2 ? 2 : 0,
      );
      expect(coverage.shapes.length, weapon.id).toBeGreaterThan(0);
      const paths = coveragePaths(fitCoverage(coverage));
      expect(paths.length, weapon.id).toBe(coverage.shapes.length);
      expect(
        paths.some((p) => p.closed && p.role === 'area'),
        weapon.id,
      ).toBe(true);
      for (const path of paths)
        for (const point of path.points) {
          expect(Number.isFinite(point.x), weapon.id).toBe(true);
          expect(Number.isFinite(point.y), weapon.id).toBe(true);
        }
      // The range drawn is the catalog's for everything that has one.
      const range = typeof weapon.params.range === 'number' ? weapon.params.range : 0;
      if (range > 0 && coverage.kind !== 'drop') expect(coverage.range, weapon.id).toBe(range);
    }
  });

  it('draws the shape each weapon is', () => {
    // An 85 degree wedge ahead for the Front Machine Gun, from its muzzle.
    const mg = coverageOf('weapon_front_mg');
    expect(mg.kind).toBe('cone');
    expect(wedge(mg).half).toBeCloseTo(42.5 * DEG, 6);
    expect(wedge(mg).outer).toBe(220);
    expect(wedge(mg).heading).toBe(0);
    // A full circle for the Swivel Turret, the EMP Pulse and the Tesla Arc.
    for (const [id, range] of [
      ['weapon_turret', 220],
      ['weapon_emp', 135],
      ['weapon_tesla', 70],
    ] as const) {
      const circle = coverageOf(id);
      expect(circle.kind, id).toBe('circle');
      expect(wedge(circle), id).toMatchObject({ half: Math.PI, inner: 0, outer: range });
    }
    // A ring with a hole for the Arc Mortar: 90 to 320.
    const mortar = coverageOf('weapon_mortar');
    expect(mortar.kind).toBe('ring');
    expect(wedge(mortar)).toMatchObject({ half: Math.PI, inner: 90, outer: 320 });
    expect(coveragePaths(mortar)[0]!.hole).not.toBeNull();
    // A drop zone behind the car for the Road Mine and the Oil Slick.
    const mine = coverageOf('weapon_mine', 2, 'rear_utility');
    expect(mine.kind).toBe('drop');
    expect(mine.shapes.map((s) => s.kind)).toEqual(['disc', 'disc']);
    const blast = mine.shapes[0] as { x: number; y: number; radius: number };
    const part = resolveBlueprint(
      testBlueprint({ parts: [{ id: 'weapon_mine', mount: 'rear_utility', turn: 2 }] }),
      CATALOG,
    )!.parts[0]!;
    expect(blast.y).toBeGreaterThan(part.y);
    expect(blast.x).toBeCloseTo(part.x, 6);
    expect(blast.radius).toBe(26);
    const oil = coverageOf('weapon_oil', 2, 'rear_utility');
    expect(oil.kind).toBe('drop');
    expect(oil.shapes[0]).toMatchObject({ kind: 'strip', halfLength: 45, halfWidth: 13 });
    expect((oil.shapes[0] as { y: number }).y).toBeGreaterThan(part.y + 45);
    // A lobbed puddle at a fixed distance for the Sticky Foam.
    const foam = coverageOf('weapon_foam');
    expect(foam.kind).toBe('lob');
    expect(foam.shapes.map((s) => s.kind)).toEqual(['line', 'disc']);
    // A short sweep off the side for the Side Saw.
    const saw = coverageOf('weapon_saw', 1, 'right_front');
    expect(saw.kind).toBe('contact');
    expect(wedge(saw).outer).toBe(14);
    expect(wedge(saw).heading).toBeCloseTo(Math.PI / 2, 6);
    expect(wedge(saw).half).toBeCloseTo(60 * DEG, 6);
    // A narrow line for the railgun, and a rocket with no cone is still drawn as a sliver.
    expect(wedge(coverageOf('weapon_railshot')).half).toBeCloseTo(10 * DEG, 6);
    expect(wedge(coverageOf('weapon_rocket')).half).toBeGreaterThan(0);
    expect(wedge(coverageOf('weapon_rocket')).half).toBeLessThan(6 * DEG);
  });

  it('turns with the part: each quarter turn rotates the whole shape about the part', () => {
    for (const id of [
      'weapon_front_mg',
      'weapon_shotgun',
      'weapon_flame',
      'weapon_foam',
      'weapon_hammer',
    ]) {
      const base = coveragePaths(fitCoverage(coverageOf(id, 0)));
      const centre = resolveBlueprint(
        testBlueprint({ parts: [{ id, mount: 'roof_mid' }] }),
        CATALOG,
      )!.parts[0]!;
      for (const turn of [1, 2, 3] as const) {
        const turned = coveragePaths(fitCoverage(coverageOf(id, turn)));
        expect(coverageOf(id, turn).turn).toBe(turn);
        const a = (turn * Math.PI) / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        base.forEach((path, i) => {
          expect(turned[i]!.points.length).toBe(path.points.length);
          for (const p of path.points) {
            // A clockwise quarter turn about the part's centre, x right and y toward the rear.
            // Matched to the nearest point, because a circle's outline starts where it likes.
            const dx = p.x - centre.x;
            const dy = p.y - centre.y;
            const x = centre.x + dx * cos - dy * sin;
            const y = centre.y + dx * sin + dy * cos;
            const nearest = Math.min(...turned[i]!.points.map((q) => Math.hypot(q.x - x, q.y - y)));
            expect(nearest, `${id} turn ${turn}`).toBeLessThan(1e-5);
          }
        });
      }
    }
    // The four facings of one weapon are four different drawings.
    const firsts = [0, 1, 2, 3].map((turn) => {
      const p = coveragePaths(coverageOf('weapon_shotgun', turn as QuarterTurn))[0]!.points[0]!;
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    });
    expect(new Set(firsts).size).toBe(4);
  });

  it('keeps angles true and draws long ranges short, in order', () => {
    // Near the car a pixel is a pixel.
    for (const d of [0, 5, 14, COVERAGE_TRUE]) expect(shownDistance(d)).toBe(d);
    let last = 0;
    for (let d = 0; d <= 400; d += 5) {
      expect(shownDistance(d)).toBeGreaterThanOrEqual(last);
      last = shownDistance(d);
    }
    expect(shownDistance(350)).toBeLessThan(60);
    expect(shownDistance(350)).toBeGreaterThan(shownDistance(220));
    expect(shownDistance(220)).toBeGreaterThan(shownDistance(110));
    // The outline of an 85 degree cone still spans 85 degrees at its far edge.
    const mg = coverageOf('weapon_front_mg');
    const { points } = coveragePaths(mg)[0]!;
    const origin = wedge(mg);
    const angle = (p: { x: number; y: number }) => Math.atan2(p.x - origin.x, -(p.y - origin.y));
    const far = points.filter((p) => Math.hypot(p.x - origin.x, p.y - origin.y) > 1);
    expect(Math.min(...far.map(angle))).toBeCloseTo(-42.5 * DEG, 5);
    expect(Math.max(...far.map(angle))).toBeCloseTo(42.5 * DEG, 5);
    for (const p of far)
      expect(Math.hypot(p.x - origin.x, p.y - origin.y)).toBeCloseTo(shownDistance(220), 5);
    // A saw's reach is inside the true-size zone: drawn at its real size.
    const saw = coverageOf('weapon_saw', 1, 'right_front');
    const sawFar = coveragePaths(saw)[0]!.points.map((p) =>
      Math.hypot(p.x - wedge(saw).x, p.y - wedge(saw).y),
    );
    expect(Math.max(...sawFar)).toBeCloseTo(14, 5);
    // A lobbed shot lands closer on the drawing, on the same line.
    const foam = coverageOf('weapon_foam');
    const fitted = fitCoverage(foam);
    const line = fitted.shapes[0] as { x: number; y: number; toX: number; toY: number };
    expect(Math.hypot(line.toX - line.x, line.toY - line.y)).toBeCloseTo(shownDistance(120), 5);
    expect(line.toX).toBeCloseTo(line.x, 6);
    expect(line.toY).toBeLessThan(line.y);
  });

  it('shrinks to the room a small floor has, keeping its angle and its facing', () => {
    const mg = coverageOf('weapon_front_mg', 1);
    const origin = wedge(mg);
    const reach = (limit?: number) => {
      const fit = limit === undefined ? {} : { limit };
      const points = coveragePaths(fitCoverage(mg, fit), fit)[0]!.points;
      const far = points.filter((p) => Math.hypot(p.x - origin.x, p.y - origin.y) > 1);
      const angles = far.map((p) => Math.atan2(p.x - origin.x, -(p.y - origin.y)));
      return {
        radius: Math.max(...far.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y))),
        from: Math.min(...angles),
        to: Math.max(...angles),
      };
    };
    const whole = reach();
    expect(whole.radius).toBeCloseTo(shownDistance(220), 5);
    // Plenty of room changes nothing; a short floor brings the far edge onto it.
    expect(reach(200).radius).toBeCloseTo(whole.radius, 5);
    expect(reach(22).radius).toBeCloseTo(22, 5);
    // It is never drawn as a speck, however little room there is.
    expect(reach(3).radius).toBeCloseTo(COVERAGE_MIN, 5);
    for (const limit of [200, 22, 3]) {
      expect(reach(limit).from).toBeCloseTo(Math.PI / 2 - 42.5 * DEG, 5);
      expect(reach(limit).to).toBeCloseTo(Math.PI / 2 + 42.5 * DEG, 5);
    }
    // A saw that reaches 14 pixels is not stretched to the minimum, nor shrunk below its size
    // while there is room for it.
    expect(fittedDistance(14, 14, { limit: 30 })).toBe(14);
    expect(fittedDistance(14, 14, { limit: 4 })).toBeCloseTo(COVERAGE_MIN, 6);
    // The mortar's ring keeps the proportion of its hole.
    const mortar = coverageOf('weapon_mortar');
    const ring = coveragePaths(mortar, { limit: 20 })[0]!;
    const centre = wedge(mortar);
    const r = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
    expect(r(ring.points[0]!)).toBeCloseTo(20, 5);
    expect(r(ring.hole![0]!) / r(ring.points[0]!)).toBeCloseTo(
      shownDistance(90) / shownDistance(320),
      5,
    );
    // A lob lands inside the room, with its puddle shrunk by the same factor.
    const foam = fitCoverage(coverageOf('weapon_foam'), { limit: 14 });
    const line = foam.shapes[0] as { x: number; y: number; toX: number; toY: number };
    expect(Math.hypot(line.toX - line.x, line.toY - line.y)).toBeCloseTo(14, 5);
    expect((foam.shapes[1] as { radius: number }).radius).toBeCloseTo(
      (shownDistance(30) * 14) / shownDistance(120),
      5,
    );
    // Where the room is measured from: a cone's apex and heading, a circle's centre, no limit
    // for a drop zone, which is drawn where it falls at its real size.
    expect(coverageOrigin(mg)).toMatchObject({
      x: origin.x,
      y: origin.y,
      heading: Math.PI / 2,
      round: false,
    });
    expect(coverageOrigin(coverageOf('weapon_turret'))).toMatchObject({ round: true });
    expect(coverageOrigin(coverageOf('weapon_mine', 2, 'rear_utility'))).toBeNull();
    expect(coverageOrigin(coverageOf('weapon_foam', 2))!.heading).toBeCloseTo(Math.PI, 6);
  });

  it('has nothing to draw for parts that are not weapons', () => {
    const blueprint = testBlueprint({
      parts: ['utility_radar', 'defense_light_plate', { id: 'weapon_shotgun', fire: 0 }],
    });
    const coverage = buildCoverage(resolveBlueprint(blueprint, CATALOG)!);
    expect(coverage.filter((c) => c !== null).length).toBe(1);
  });
});
