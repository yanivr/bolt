import { readFileSync } from 'node:fs';
import { CATALOG, CHASSIS_LIST, STRINGS, TEMPLATES, conditionsFor, CITY_01 } from '@bolt/content';
import type { CarAtlasManifest, ChassisDefinition } from '@bolt/shared';
import { accessoryMounts, computeBuildStats } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { BenchLayout, Box } from '../../apps/web/src/garage/benchLayout.js';
import {
  FOCUS_CONTEXT,
  FOCUS_STEPS,
  focusCamera,
  focusScales,
  landscapeFloor,
  layoutBench,
  layoutFocus,
  portraitFloor,
  segmentsCross,
} from '../../apps/web/src/garage/benchLayout.js';
import {
  VIEW_FRAMES,
  carBounds,
  focusTarget,
  projectMounts,
} from '../../apps/web/src/garage/carGeometry.js';
import { STRONG_SCORE, WEAK_SCORE, summarizeCar } from '../../apps/web/src/garage/carSummary.js';
import { mountName, mountShort } from '../../apps/web/src/garage/text.js';

/**
 * The workbench: the overview with a tile and a leader for every mount, and focus mode, where
 * the view moves in on one slot. Both are pure functions of the floor and the car's geometry
 * and are checked here for every mount of all five chassis at the sizes the garage has to
 * work at: the product owner's phone in its host page (870 x 370 and 870 x 340 landscape,
 * 450 x 840 portrait) and three bare phones.
 */

const cars = JSON.parse(
  readFileSync('apps/web/public/assets/atlases/cars/manifest.json', 'utf8'),
) as CarAtlasManifest;

const LANDSCAPE = [
  { width: 870, height: 370 },
  { width: 870, height: 340 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 932, height: 430 },
];
const PORTRAIT = { width: 450, height: 840 };

type Floor = { name: string; width: number; height: number; columns: boolean };
const FLOORS: Floor[] = [
  ...LANDSCAPE.map((v) => ({
    name: `${v.width}x${v.height}`,
    ...landscapeFloor(v),
    columns: true,
  })),
  { name: '450x840', ...portraitFloor(PORTRAIT), columns: false },
];

const overlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const tileBox = (t: BenchLayout['tiles'][number]): Box => ({
  left: t.x,
  top: t.y,
  right: t.x + t.w,
  bottom: t.y + t.h,
});
/** The body art is smaller than the chassis box; the page measures it. This stands in. */
const shrink = (b: Box, by: number): Box => ({
  left: b.left * by,
  top: b.top * by,
  right: b.right * by,
  bottom: b.bottom * by,
});
const inputFor = (chassis: ChassisDefinition, frame: number, floor: Floor, tight = 1) => {
  const sprite = cars.chassis[chassis.id]!;
  return {
    width: floor.width,
    height: floor.height,
    mounts: projectMounts(chassis, sprite, frame),
    bounds: shrink(carBounds(chassis, sprite, frame), tight),
    columns: floor.columns,
  };
};

describe('workbench floor', () => {
  it('is the size the stylesheet gives it', () => {
    expect(landscapeFloor({ width: 870, height: 340 })).toEqual({ width: 462, height: 189 });
    expect(landscapeFloor({ width: 870, height: 370 })).toEqual({ width: 461, height: 214 });
    expect(landscapeFloor({ width: 844, height: 390 })).toEqual({ width: 447, height: 228 });
    expect(landscapeFloor({ width: 667, height: 375 })).toEqual({ width: 352, height: 219 });
    expect(portraitFloor(PORTRAIT)).toEqual({ width: 389, height: 237 });
  });
});

describe('workbench overview', () => {
  it('gives every mount of every chassis a tile and a leader, in one column a side, at every landscape size', () => {
    let checked = 0;
    for (const floor of FLOORS.filter((f) => f.columns))
      for (const chassis of CHASSIS_LIST)
        for (const frame of VIEW_FRAMES)
          for (const tight of [1, 0.85]) {
            const input = inputFor(chassis, frame, floor, tight);
            const layout = layoutBench(input);
            const at = `${chassis.id} view ${frame} at ${floor.name}`;
            checked++;

            expect(layout.focus, at).toBeNull();
            expect(Number.isInteger(layout.scale), at).toBe(true);
            expect(layout.scale, at).toBeGreaterThanOrEqual(2);
            expect(layout.tiles.map((t) => t.id).sort(), at).toEqual(
              accessoryMounts(chassis)
                .map((m) => m.id)
                .sort(),
            );
            // The car is whole and on the floor.
            expect(layout.carBox.left, at).toBeGreaterThanOrEqual(0);
            expect(layout.carBox.right, at).toBeLessThanOrEqual(floor.width);
            expect(layout.carBox.top, at).toBeGreaterThanOrEqual(0);
            expect(layout.carBox.bottom, at).toBeLessThanOrEqual(floor.height);

            // Never more than a column a side: nothing scrolls and nothing is stacked two
            // deep, because no chassis has more than eight mounts.
            for (const side of ['left', 'right'] as const) {
              const column = layout.tiles.filter((t) => t.side === side);
              expect(new Set(column.map((t) => t.x)).size, `${at} ${side}`).toBeLessThanOrEqual(1);
            }
            for (const tile of layout.tiles) {
              expect(tile.w, at).toBeGreaterThanOrEqual(44);
              expect(tile.h, at).toBeGreaterThanOrEqual(44);
              expect(tile.x, at).toBeGreaterThanOrEqual(0);
              expect(tile.x + tile.w, at).toBeLessThanOrEqual(floor.width);
              expect(tile.y, at).toBeGreaterThanOrEqual(0);
              expect(tile.y + tile.h, at).toBeLessThanOrEqual(floor.height);
              expect(overlap(tileBox(tile), layout.carBox), `${at} ${tile.id} on car`).toBe(false);
              // A leader starts on its tile's edge and ends on its mount.
              expect(tile.leader, `${at} ${tile.id}`).toHaveLength(2);
              const mount = input.mounts.find((m) => m.id === tile.id)!;
              const [start, end] = tile.leader as [
                (typeof tile.leader)[number],
                (typeof tile.leader)[number],
              ];
              expect(start.x === tile.x || start.x === tile.x + tile.w, at).toBe(true);
              expect(start.y, at).toBeGreaterThanOrEqual(tile.y);
              expect(start.y, at).toBeLessThanOrEqual(tile.y + tile.h);
              expect(end, at).toEqual({
                x: layout.car.x + mount.dx * layout.scale,
                y: layout.car.y + mount.dy * layout.scale,
              });
              // No leader runs under another tile.
              for (const other of layout.tiles) {
                if (other === tile) continue;
                const box = tileBox(other);
                for (let step = 0; step <= 20; step++) {
                  const x = start.x + ((end.x - start.x) * step) / 20;
                  const y = start.y + ((end.y - start.y) * step) / 20;
                  const inside = x > box.left && x < box.right && y > box.top && y < box.bottom;
                  expect(inside, `${at} ${tile.id} leader under ${other.id}`).toBe(false);
                }
              }
            }
            for (let i = 0; i < layout.tiles.length; i++)
              for (let j = i + 1; j < layout.tiles.length; j++) {
                const a = layout.tiles[i]!;
                const b = layout.tiles[j]!;
                expect(overlap(tileBox(a), tileBox(b)), `${at} ${a.id} on ${b.id}`).toBe(false);
                expect(
                  segmentsCross(a.leader[0]!, a.leader[1]!, b.leader[0]!, b.leader[1]!),
                  `${at} ${a.id} x ${b.id}`,
                ).toBe(false);
              }
          }
    expect(checked).toBe(5 * 5 * 4 * 2);
  });

  it('orders a column by where the mounts are on screen', () => {
    const chassis = CATALOG.chassis.chassis_beetle!;
    const frame = VIEW_FRAMES[0]!;
    const input = inputFor(chassis, frame, FLOORS[0]!);
    const layout = layoutBench(input);
    expect(layout.tileH).toBe(48);
    for (const side of ['left', 'right'] as const) {
      const column = layout.tiles.filter((t) => t.side === side);
      expect(column.length).toBeGreaterThan(0);
      const ys = column.map((t) => input.mounts.find((m) => m.id === t.id)!.dy);
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    }
    // The front of the car faces right in this view, so the front mount is in the right column.
    expect(layout.tiles.find((t) => t.id === 'front_center')?.side).toBe('right');
    expect(layout.tiles.find((t) => t.id === 'rear_center')?.side).toBe('left');
  });

  it('shows the car larger with room, and places only the car in the portrait strip', () => {
    const beetle = CATALOG.chassis.chassis_beetle!;
    const big = layoutBench({ ...inputFor(beetle, 18, FLOORS[0]!), width: 650, height: 690 });
    expect(big.scale).toBeGreaterThanOrEqual(6);
    for (const chassis of CHASSIS_LIST) {
      const strip = layoutBench(inputFor(chassis, 18, FLOORS[FLOORS.length - 1]!));
      expect(strip.tiles, chassis.id).toEqual([]);
      expect(strip.scale, chassis.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('falls back to a second column, never to scrolling, on a floor too short for four tiles', () => {
    const spider = CATALOG.chassis.chassis_spider!;
    const layout = layoutBench({ ...inputFor(spider, 18, FLOORS[0]!), height: 150 });
    expect(layout.tiles).toHaveLength(8);
    for (const tile of layout.tiles) {
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y + tile.h).toBeLessThanOrEqual(150);
      expect(tile.leader.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 0; i < layout.tiles.length; i++)
      for (let j = i + 1; j < layout.tiles.length; j++)
        expect(overlap(tileBox(layout.tiles[i]!), tileBox(layout.tiles[j]!))).toBe(false);
  });

  it('has a short label and a name for every mount, unique on its chassis', () => {
    for (const chassis of CHASSIS_LIST) {
      const labels = accessoryMounts(chassis).map((mount) => {
        expect(
          Object.prototype.hasOwnProperty.call(STRINGS.garage.mountShort, mount.id),
          mount.id,
        ).toBe(true);
        const label = mountShort(mount.id);
        expect(label.length, mount.id).toBeLessThanOrEqual(7);
        return label;
      });
      expect(new Set(labels).size, chassis.id).toBe(labels.length);
      const names = accessoryMounts(chassis).map((mount) => mountName(mount.id));
      expect(new Set(names).size, chassis.id).toBe(names.length);
      for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
    }
    // No label is kept for a mount that no chassis has any more.
    const live = new Set(CHASSIS_LIST.flatMap((c) => accessoryMounts(c).map((m) => m.id)));
    for (const id of Object.keys(STRINGS.garage.mountShort)) expect(live.has(id), id).toBe(true);
    for (const id of Object.keys(STRINGS.garage.mountNames)) expect(live.has(id), id).toBe(true);
  });
});

describe('focus camera', () => {
  const free: Box = { left: 60, top: 2, right: 400, bottom: 206 };
  const bounds: Box = { left: -40, top: -30, right: 40, bottom: 30 };
  const partAt = (x: number, y: number, half = 8): Box => ({
    left: x - half,
    top: y - half,
    right: x + half,
    bottom: y + half,
  });
  const centre = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

  it('takes the largest whole scale at which the part and its context fit', () => {
    const part = partAt(0, 0);
    // The part is 16 across and needs FOCUS_CONTEXT on each side: 34 sprite pixels of a 204
    // pixel tall floor, so six fits and seven does not.
    expect(16 + 2 * FOCUS_CONTEXT).toBe(34);
    // A small car stays mostly in view at any of these steps, so only the part limits it.
    const small = { left: -20, top: -28, right: 20, bottom: 28 };
    const on = (scales: number[]) =>
      focusCamera({ free, bounds: small, mount: { x: 0, y: 0 }, part, scales }).scale;
    expect(on([4, 5, 6])).toBe(6);
    expect(on([4, 5, 6, 7])).toBe(6);
    expect(on([5, 4])).toBe(5);
    // A big car gives up the later steps so most of it stays on the floor, but never the first.
    const big = focusCamera({ free, bounds, mount: { x: 0, y: 0 }, part, scales: [4, 5, 6] });
    expect(big.scale).toBeLessThan(6);
    expect(big.scale).toBeGreaterThanOrEqual(4);
    // A large part takes a smaller step.
    const large = partAt(0, 0, 14);
    expect(
      focusCamera({ free, bounds, mount: { x: 0, y: 0 }, part: large, scales: [4, 5, 6] }).scale,
    ).toBe(4);
    // Nothing fits with context: the smallest candidate, never less.
    const huge = partAt(0, 0, 40);
    expect(
      focusCamera({ free, bounds, mount: { x: 0, y: 0 }, part: huge, scales: [4, 5] }).scale,
    ).toBe(4);
    // Fractions are not scales.
    expect(focusCamera({ free, bounds, mount: { x: 0, y: 0 }, part, scales: [4.5, 5] }).scale).toBe(
      5,
    );
  });

  it('puts a part in the middle of the car at the middle of the free floor', () => {
    const big: Box = { left: -80, top: -60, right: 80, bottom: 60 };
    const part = partAt(6, -4);
    const camera = focusCamera({ free, bounds: big, mount: { x: 6, y: -4 }, part, scales: [5] });
    expect(camera.scale).toBe(5);
    expect({ x: camera.car.x + 6 * 5, y: camera.car.y - 4 * 5 }).toEqual(centre(free));
    expect(Number.isInteger(camera.car.x) && Number.isInteger(camera.car.y)).toBe(true);
  });

  it('stops the pan before it shows more than a strip of empty floor past the car', () => {
    const big: Box = { left: -80, top: -60, right: 80, bottom: 60 };
    // A mount at the nose: centring it would leave half the floor empty.
    const part = partAt(72, 0);
    const camera = focusCamera({ free, bounds: big, mount: { x: 72, y: 0 }, part, scales: [5] });
    const carRight = camera.car.x + big.right * 5;
    const empty = free.right - carRight;
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThanOrEqual(Math.round((free.right - free.left) * 0.1) + 1);
    // The mount is still well inside the floor.
    const anchorX = camera.car.x + 72 * 5;
    expect(anchorX).toBeLessThan(free.right - 8 * 5);
    expect(anchorX).toBeGreaterThan(centre(free).x);
    // And the same at the other three edges.
    for (const [x, y] of [
      [-72, 0],
      [0, -52],
      [0, 52],
    ] as const) {
      const c = focusCamera({
        free,
        bounds: big,
        mount: { x, y },
        part: partAt(x, y),
        scales: [5],
      });
      const ax = c.car.x + x * 5;
      const ay = c.car.y + y * 5;
      expect(ax).toBeGreaterThanOrEqual(free.left + 40);
      expect(ax).toBeLessThanOrEqual(free.right - 40);
      expect(ay).toBeGreaterThanOrEqual(free.top + 40);
      expect(ay).toBeLessThanOrEqual(free.bottom - 40);
    }
  });

  it('does not pan on an axis where the whole car fits: it centres the car', () => {
    // 80 x 60 sprite pixels at 3: 240 x 180 on a 340 x 204 floor. Wide enough to centre.
    const part = partAt(30, 20);
    const camera = focusCamera({ free, bounds, mount: { x: 30, y: 20 }, part, scales: [3] });
    expect(camera.car.x).toBe(centre(free).x);
    // Not tall enough to centre with room to spare: panned, within the slack.
    expect(camera.car.y + bounds.top * 3).toBeLessThanOrEqual(free.top + 21);
    expect(camera.car.y + bounds.bottom * 3).toBeGreaterThanOrEqual(free.bottom - 21);
  });

  it('keeps the mount inside the free floor for any car, mount and floor', () => {
    let seed = 20261011;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 4000; i++) {
      const w = 150 + random() * 500;
      const h = 120 + random() * 400;
      const area: Box = { left: random() * 80, top: random() * 8, right: 0, bottom: 0 };
      area.right = area.left + w;
      area.bottom = area.top + h;
      const car: Box = {
        left: -(20 + random() * 40),
        top: -(15 + random() * 30),
        right: 20 + random() * 40,
        bottom: 15 + random() * 30,
      };
      const half = 3 + random() * 8;
      const x = car.left + half + random() * (car.right - car.left - 2 * half);
      const y = car.top + half + random() * (car.bottom - car.top - 2 * half);
      const part = partAt(x, y, half);
      const overview = Math.max(
        1,
        Math.floor(Math.min(w / (car.right - car.left), h / (car.bottom - car.top))),
      );
      const scales = focusScales(overview);
      const camera = focusCamera({ free: area, bounds: car, mount: { x, y }, part, scales });
      expect(scales).toContain(camera.scale);
      expect(Number.isInteger(camera.car.x) && Number.isInteger(camera.car.y)).toBe(true);
      // The whole part is on the free floor whenever the floor can hold it at all.
      if (2 * half * camera.scale <= Math.min(w, h)) {
        expect(camera.car.x + part.left * camera.scale).toBeGreaterThanOrEqual(area.left - 1);
        expect(camera.car.x + part.right * camera.scale).toBeLessThanOrEqual(area.right + 1);
        expect(camera.car.y + part.top * camera.scale).toBeGreaterThanOrEqual(area.top - 1);
        expect(camera.car.y + part.bottom * camera.scale).toBeLessThanOrEqual(area.bottom + 1);
      }
    }
  });

  it('offers one step in at least and two at most', () => {
    expect(FOCUS_STEPS).toBe(2);
    expect(focusScales(3)).toEqual([4, 5]);
    expect(focusScales(2)).toEqual([3, 4]);
    expect(focusScales(6)).toEqual([7, 8]);
  });
});

describe('focus mode', () => {
  /** Every accessory mount, and the engine. */
  const slotsOf = (chassis: ChassisDefinition) => [
    ...accessoryMounts(chassis).map((m) => m.id),
    'engine',
  ];
  const MARGIN = 20;

  it('frames every mount of all five chassis, and the engine, at every size and view', () => {
    let checked = 0;
    for (const floor of FLOORS)
      for (const chassis of CHASSIS_LIST)
        for (const frame of VIEW_FRAMES)
          for (const tight of [1, 0.85]) {
            const sprite = cars.chassis[chassis.id]!;
            const input = inputFor(chassis, frame, floor, tight);
            const overview = layoutBench(input);
            for (const slot of slotsOf(chassis)) {
              const target = focusTarget(chassis, sprite, frame, slot)!;
              const at = `${chassis.id} ${slot} view ${frame} at ${floor.name} x${tight}`;
              expect(target, at).not.toBeNull();
              const layout = layoutFocus({ ...input, target });
              const focus = layout.focus!;
              checked++;

              // Always closer than the overview, in whole steps, never between them.
              expect(Number.isInteger(layout.scale), at).toBe(true);
              expect(layout.scale, at).toBeGreaterThanOrEqual(overview.scale + 1);
              expect(layout.scale, at).toBeLessThanOrEqual(overview.scale + FOCUS_STEPS);
              expect(Number.isInteger(layout.car.x) && Number.isInteger(layout.car.y), at).toBe(
                true,
              );

              // The selected mount is inside the free floor, with a margin.
              expect(focus.id, at).toBe(slot);
              expect(focus.anchor.x, at).toBeGreaterThanOrEqual(focus.free.left + MARGIN);
              expect(focus.anchor.x, at).toBeLessThanOrEqual(focus.free.right - MARGIN);
              expect(focus.anchor.y, at).toBeGreaterThanOrEqual(focus.free.top + MARGIN);
              expect(focus.anchor.y, at).toBeLessThanOrEqual(focus.free.bottom - MARGIN);
              expect(focus.free.left, at).toBeGreaterThanOrEqual(0);
              expect(focus.free.right, at).toBeLessThanOrEqual(floor.width);
              expect(focus.free.top, at).toBeGreaterThanOrEqual(0);
              expect(focus.free.bottom, at).toBeLessThanOrEqual(floor.height);
              // With the art as the catalog sizes it, the whole of the largest part that
              // mount takes is on the free floor too.
              if (tight === 1 && slot !== 'engine') {
                expect(focus.part.left, at).toBeGreaterThanOrEqual(focus.free.left);
                expect(focus.part.right, at).toBeLessThanOrEqual(focus.free.right);
                expect(focus.part.top, at).toBeGreaterThanOrEqual(focus.free.top);
                expect(focus.part.bottom, at).toBeLessThanOrEqual(focus.free.bottom);
              }

              // The other slots stay at the edges: same side and order as the overview,
              // compact, never under 44 pixels, on the floor, apart, and off the part.
              expect(
                layout.tiles.map((t) => [t.id, t.side]),
                at,
              ).toEqual(overview.tiles.map((t) => [t.id, t.side]));
              for (const tile of layout.tiles) {
                expect(tile.w, at).toBeGreaterThanOrEqual(44);
                expect(tile.h, at).toBe(44);
                expect(tile.x, at).toBeGreaterThanOrEqual(0);
                expect(tile.x + tile.w, at).toBeLessThanOrEqual(floor.width);
                expect(tile.y, at).toBeGreaterThanOrEqual(0);
                expect(tile.y + tile.h, at).toBeLessThanOrEqual(floor.height);
                const box = tileBox(tile);
                expect(overlap(box, focus.free), `${at} ${tile.id} in the view`).toBe(false);
                const under =
                  focus.anchor.x >= box.left &&
                  focus.anchor.x <= box.right &&
                  focus.anchor.y >= box.top &&
                  focus.anchor.y <= box.bottom;
                expect(under, `${at} mount under ${tile.id}`).toBe(false);
                if (tight === 1 && slot !== 'engine')
                  expect(overlap(box, focus.part), `${at} part under ${tile.id}`).toBe(false);
                // Only the selected slot keeps its leader, and it ends on the mount.
                if (tile.id === slot) {
                  expect(tile.leader[tile.leader.length - 1], at).toEqual(focus.anchor);
                  const start = tile.leader[0]!;
                  expect(start.x === tile.x || start.x === tile.x + tile.w, at).toBe(true);
                } else expect(tile.leader, at).toEqual([]);
              }
              for (let i = 0; i < layout.tiles.length; i++)
                for (let j = i + 1; j < layout.tiles.length; j++)
                  expect(
                    overlap(tileBox(layout.tiles[i]!), tileBox(layout.tiles[j]!)),
                    `${at} ${layout.tiles[i]!.id} on ${layout.tiles[j]!.id}`,
                  ).toBe(false);
            }
          }
    // 5 + 4 + 6 + 8 + 4 mounts and five engines, at six sizes, four views, two art sizes.
    expect(checked).toBe((27 + 5) * 6 * 4 * 2);
  });

  it('moves in to four or five times on the owner phone, where the overview is three', () => {
    const floor = FLOORS[0]!;
    expect(floor.name).toBe('870x370');
    const seen = new Set<number>();
    for (const chassis of CHASSIS_LIST) {
      const sprite = cars.chassis[chassis.id]!;
      const frame = VIEW_FRAMES[0]!;
      // Measured art is a little smaller than the catalog box, as on the page.
      const input = inputFor(chassis, frame, floor, 0.9);
      const overview = layoutBench(input);
      for (const mount of accessoryMounts(chassis)) {
        const layout = layoutFocus({
          ...input,
          target: focusTarget(chassis, sprite, frame, mount.id)!,
        });
        expect(layout.scale, `${chassis.id} ${mount.id}`).toBeGreaterThan(overview.scale);
        expect(layout.scale, `${chassis.id} ${mount.id}`).toBeGreaterThanOrEqual(3);
        seen.add(layout.scale - overview.scale);
      }
    }
    // Small mounts take two steps, the Pickup bed and other large ones take one.
    expect([...seen].sort()).toEqual([1, 2]);
    const beetle = CATALOG.chassis.chassis_beetle!;
    const input = inputFor(beetle, VIEW_FRAMES[0]!, floor, 0.9);
    expect(layoutBench(input).scale).toBe(3);
    const roof = layoutFocus({
      ...input,
      target: focusTarget(beetle, cars.chassis.chassis_beetle!, VIEW_FRAMES[0]!, 'roof_mid')!,
    });
    expect([4, 5]).toContain(roof.scale);
  });

  it('has no target for a mount the chassis does not have', () => {
    const beetle = CATALOG.chassis.chassis_beetle!;
    expect(focusTarget(beetle, cars.chassis.chassis_beetle!, 18, 'bed_rear')).toBeNull();
    expect(focusTarget(beetle, cars.chassis.chassis_beetle!, 18, 'engine')!.id).toBe('engine');
  });
});

describe('the car in two lines', () => {
  const scores = (
    speed: number,
    control: number,
    defense: number,
    firepower: number,
    utility: number,
  ) => ({
    speed,
    control,
    defense,
    firepower,
    utility,
  });

  it('names the best one or two scores and the lowest, from the numbers alone', () => {
    expect(summarizeCar(scores(66, 69, 11, 0, 0))).toEqual({
      strengths: [
        { key: 'control', value: 69 },
        { key: 'speed', value: 66 },
      ],
      best: { key: 'control', value: 69 },
      weakness: { key: 'utility', value: 0 },
    });
    // Three strong scores: the top two only.
    expect(summarizeCar(scores(88, 77, 70, 35, 41)).strengths.map((s) => s.key)).toEqual([
      'speed',
      'control',
    ]);
    // Nothing strong: the best score is still named, and the lowest is the weakness.
    const slow = summarizeCar(scores(29, 57, 42, 12, 33));
    expect(slow.strengths).toEqual([]);
    expect(slow.best).toEqual({ key: 'control', value: 57 });
    expect(slow.weakness).toEqual({ key: 'firepower', value: 12 });
    // No score low enough to call a weakness.
    expect(summarizeCar(scores(70, 65, 50, 48, 46)).weakness).toBeNull();
    expect(STRONG_SCORE).toBeGreaterThan(WEAK_SCORE);
    // Ties keep the order of the score strip.
    expect(summarizeCar(scores(60, 60, 60, 60, 60)).strengths.map((s) => s.key)).toEqual([
      'speed',
      'control',
    ]);
    expect(summarizeCar(scores(0, 0, 0, 0, 0)).weakness).toBeNull();
  });

  it('describes every shipped car from its real stats', () => {
    const conditions = conditionsFor(CITY_01.id, 'city_clear_night')!;
    for (const template of TEMPLATES) {
      const stats = computeBuildStats(template.blueprint, CATALOG, conditions)!;
      const summary = summarizeCar(stats.scores);
      const values = Object.values(stats.scores);
      expect(summary.best.value, template.name).toBe(Math.max(...values));
      for (const s of summary.strengths) expect(stats.scores[s.key]).toBe(s.value);
      if (summary.weakness) expect(summary.weakness.value, template.name).toBe(Math.min(...values));
    }
    // The Straight-Line Rocket leads with Speed; the stock Beetle has no weapon to speak of.
    const rocket = TEMPLATES.find((t) => t.id === 'example_straight_line_rocket')!;
    expect(
      summarizeCar(computeBuildStats(rocket.blueprint, CATALOG, conditions)!.scores).best.key,
    ).toBe('speed');
  });
});
