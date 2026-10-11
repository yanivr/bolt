/**
 * Where everything on the workbench goes: the car at the largest whole-number scale that
 * fits, and one tile per accessory mount in columns beside it, each joined to its mount by a
 * leader line. A pure function of the floor size and the car's geometry, so it is unit tested
 * for every chassis: tiles never overlap each other or the car, and leaders never cross.
 */

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

/** A mount as the compositor draws it: sprite pixels from the car's centre. */
export type BenchMount = { id: string; dx: number; dy: number };

export type BenchInput = {
  /** The workbench floor, in CSS pixels. */
  width: number;
  height: number;
  mounts: readonly BenchMount[];
  /** Everything the car can draw at this heading, in sprite pixels from its centre. */
  bounds: Box;
  /** False when the tiles live somewhere else (the portrait row): only the car is placed. */
  columns?: boolean;
};

export type BenchTile = {
  id: string;
  side: 'left' | 'right';
  x: number;
  y: number;
  w: number;
  h: number;
  /** From the tile's edge to the mount on the car. Empty when the columns scroll. */
  leader: Point[];
};

export type BenchLayout = {
  /** Whole CSS pixels per sprite pixel. */
  scale: number;
  /** Where the centre of the car sprite goes. */
  car: Point;
  /** The car's drawn bounds on the floor. No tile enters it. */
  carBox: Box;
  tileW: number;
  tileH: number;
  tiles: BenchTile[];
  /** Too many mounts for the height: the columns scroll and carry no leaders. */
  scroll: boolean;
  /** Floor width each column block takes, edge padding included. */
  reserved: { left: number; right: number };
};

export const TILE_REGULAR = { w: 54, h: 48, gap: 4 } as const;
export const TILE_COMPACT = { w: 50, h: 44, gap: 3 } as const;
export const MAX_CAR_SCALE = 8;
/** Floor padding beside the tile columns. */
const EDGE = 4;
/** Floor padding above and below the columns and the car. */
const VEDGE = 2;
/** Clear floor between a column and the car, where the leaders are read. */
const LEADER_ROOM = 14;
/** The most space left between tiles when a column has room to spread. */
const MAX_SPREAD = 14;

/** `gap` is the space between tiles. A leader from an outer column runs through it. */
type Size = { w: number; h: number; gap: number };
type Berth = { side: 'left' | 'right'; x: number; y: number; port: Point; stub: Point | null };
type Plan = {
  size: Size;
  left: number;
  right: number;
  scroll: boolean;
  scale: number;
  reserved: { left: number; right: number };
};

function perColumn(height: number, size: Size): number {
  return Math.max(0, Math.floor((height - 2 * VEDGE + size.gap) / (size.h + size.gap)));
}

function columnsFor(count: number, rows: number): number {
  return count === 0 ? 0 : count > rows ? 2 : 1;
}

function blockWidth(columns: number, size: Size): number {
  return columns === 0 ? 0 : EDGE + columns * size.w + (columns - 1) * size.gap;
}

function fitScale(input: BenchInput, reserved: { left: number; right: number }): number {
  const room = reserved.left + reserved.right > 0 ? LEADER_ROOM : EDGE;
  const wide =
    input.width -
    Math.max(reserved.left, EDGE) -
    Math.max(reserved.right, EDGE) -
    (reserved.left > 0 ? room : 0) -
    (reserved.right > 0 ? room : 0);
  const tall = input.height - 2 * VEDGE;
  const spanX = Math.max(1, input.bounds.right - input.bounds.left);
  const spanY = Math.max(1, input.bounds.bottom - input.bounds.top);
  return Math.max(1, Math.min(MAX_CAR_SCALE, Math.floor(Math.min(wide / spanX, tall / spanY))));
}

/** How many mounts go left: their natural side, then whatever the columns can hold. */
function split(sorted: readonly BenchMount[], capacity: number): number {
  const n = sorted.length;
  const leftOf = sorted.filter((m) => m.dx < -1.5).length;
  const centred = sorted.filter((m) => Math.abs(m.dx) <= 1.5).length;
  const natural = leftOf + Math.floor(centred / 2);
  return Math.max(n - capacity, Math.min(capacity, natural));
}

function plan(input: BenchInput, size: Size, double: boolean): Plan | null {
  const n = input.mounts.length;
  const rows = perColumn(input.height, size);
  const capacity = double ? Math.max(rows, 2 * rows - 1) : rows;
  if (n > 2 * capacity) return null;
  const sorted = [...input.mounts].sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  const left = split(sorted, capacity);
  const right = n - left;
  const reserved = {
    left: blockWidth(columnsFor(left, rows), size),
    right: blockWidth(columnsFor(right, rows), size),
  };
  return { size, left, right, scroll: false, scale: fitScale(input, reserved), reserved };
}

function scrollPlan(input: BenchInput): Plan {
  const n = input.mounts.length;
  const left = Math.ceil(n / 2);
  const reserved = {
    left: blockWidth(left > 0 ? 1 : 0, TILE_COMPACT),
    right: blockWidth(n - left > 0 ? 1 : 0, TILE_COMPACT),
  };
  return {
    size: TILE_COMPACT,
    left,
    right: n - left,
    scroll: true,
    scale: fitScale(input, reserved),
    reserved,
  };
}

/**
 * Tile positions for one side. Up to a column's worth sit in one column, spread a little when
 * there is height to spare. More than that takes a second, outer column whose tiles sit level
 * with the gaps of the inner one, so each outer leader has a clear run to the car.
 */
function berths(
  input: BenchInput,
  side: 'left' | 'right',
  count: number,
  size: Size,
  scroll: boolean,
): Berth[] {
  if (count === 0) return [];
  const rows = perColumn(input.height, size);
  const sign = side === 'left' ? 1 : -1;
  const edge = side === 'left' ? EDGE : input.width - EDGE - size.w;
  const inward = (x: number) => (side === 'left' ? x + size.w : x);
  const free = input.height - 2 * VEDGE;
  const GAP = size.gap;
  if (scroll)
    return Array.from({ length: count }, (_, i) => {
      const y = VEDGE + i * (size.h + GAP);
      return { side, x: edge, y, port: { x: inward(edge), y: y + size.h / 2 }, stub: null };
    });
  if (count <= rows) {
    const gap =
      count > 1 ? Math.max(GAP, Math.min(MAX_SPREAD, (free - count * size.h) / (count - 1))) : 0;
    const top = Math.round(VEDGE + (free - count * size.h - (count - 1) * gap) / 2);
    return Array.from({ length: count }, (_, i) => {
      const y = Math.round(top + i * (size.h + gap));
      return { side, x: edge, y, port: { x: inward(edge), y: y + size.h / 2 }, stub: null };
    });
  }
  const inner = Math.min(rows, Math.ceil((count + 1) / 2));
  const outer = count - inner;
  const innerX = edge + sign * (size.w + GAP);
  const top = Math.round(VEDGE + (free - inner * size.h - (inner - 1) * GAP) / 2);
  const out: Berth[] = [];
  for (let i = 0; i < inner; i++) {
    const y = top + i * (size.h + GAP);
    out.push({ side, x: innerX, y, port: { x: inward(innerX), y: y + size.h / 2 }, stub: null });
  }
  const first = Math.floor((inner - 1 - outer) / 2);
  for (let i = 0; i < outer; i++) {
    // Level with the gap under inner tile `first + i`.
    const centre = top + (first + i + 1) * (size.h + GAP) - GAP / 2;
    out.push({
      side,
      x: edge,
      y: Math.round(centre - size.h / 2),
      port: { x: inward(innerX), y: centre },
      stub: { x: inward(edge), y: centre },
    });
  }
  return out.sort((a, b) => a.port.y - b.port.y);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether two segments share a point other than a common end. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const within = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  if (d1 === 0 && within(c, d, a) && !same(a, c) && !same(a, d)) return true;
  if (d2 === 0 && within(c, d, b) && !same(b, c) && !same(b, d)) return true;
  if (d3 === 0 && within(a, b, c) && !same(c, a) && !same(c, b)) return true;
  if (d4 === 0 && within(a, b, d) && !same(d, a) && !same(d, b)) return true;
  return false;
}

function length(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function layoutBench(input: BenchInput): BenchLayout {
  const mounts = input.columns === false ? [] : input.mounts;
  const placed: BenchInput = { ...input, mounts };

  // The first arrangement that shows the car at twice its size or better, preferring full
  // tiles in single columns; scrolling columns only when nothing else does.
  const candidates = [
    plan(placed, TILE_REGULAR, false),
    plan(placed, TILE_COMPACT, false),
    plan(placed, TILE_REGULAR, true),
    plan(placed, TILE_COMPACT, true),
  ].filter((p): p is Plan => p !== null);
  let chosen: Plan | null = null;
  for (const candidate of candidates)
    if (candidate.scale >= 2 && (!chosen || candidate.scale > chosen.scale)) chosen = candidate;
  if (!chosen && mounts.length > 0) {
    const scrolling = scrollPlan(placed);
    chosen = scrolling.scale >= 2 || candidates.length === 0 ? scrolling : candidates[0]!;
  }
  chosen ??= candidates[0] ?? scrollPlan(placed);

  const { size, scale, reserved } = chosen;
  const { bounds } = input;
  const innerLeft = Math.max(reserved.left, EDGE);
  const innerRight = input.width - Math.max(reserved.right, EDGE);
  const car = {
    x: Math.round((innerLeft + innerRight) / 2 - ((bounds.left + bounds.right) / 2) * scale),
    y: Math.round(input.height / 2 - ((bounds.top + bounds.bottom) / 2) * scale),
  };
  const carBox = {
    left: car.x + bounds.left * scale,
    right: car.x + bounds.right * scale,
    top: car.y + bounds.top * scale,
    bottom: car.y + bounds.bottom * scale,
  };

  const sorted = [...mounts].sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  const sides: Array<['left' | 'right', BenchMount[]]> = [
    ['left', sorted.slice(0, chosen.left)],
    ['right', sorted.slice(chosen.left)],
  ];
  const pairs: Array<{ mount: BenchMount; berth: Berth; anchor: Point }> = [];
  for (const [side, group] of sides) {
    const slots = berths(placed, side, group.length, size, chosen.scroll);
    // Within a side, top to bottom on screen.
    const ordered = [...group].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    ordered.forEach((mount, i) => {
      const berth = slots[i]!;
      pairs.push({
        mount,
        berth,
        anchor: { x: car.x + mount.dx * scale, y: car.y + mount.dy * scale },
      });
    });
  }

  if (!chosen.scroll) {
    // Two leaders that cross are both shorter when their tiles trade places, so trading
    // until nothing crosses always ends.
    for (let pass = 0; pass < 200; pass++) {
      let swapped = false;
      for (let i = 0; i < pairs.length; i++)
        for (let j = i + 1; j < pairs.length; j++) {
          const a = pairs[i]!;
          const b = pairs[j]!;
          if (!segmentsCross(a.berth.port, a.anchor, b.berth.port, b.anchor)) continue;
          const now = length(a.berth.port, a.anchor) + length(b.berth.port, b.anchor);
          const traded = length(b.berth.port, a.anchor) + length(a.berth.port, b.anchor);
          if (traded >= now) continue;
          const berth = a.berth;
          a.berth = b.berth;
          b.berth = berth;
          swapped = true;
        }
      if (!swapped) break;
    }
  }

  const tiles = pairs.map(({ mount, berth, anchor }): BenchTile => {
    const leader = chosen.scroll
      ? []
      : berth.stub
        ? [berth.stub, berth.port, anchor]
        : [berth.port, anchor];
    return { id: mount.id, side: berth.side, x: berth.x, y: berth.y, w: size.w, h: size.h, leader };
  });
  // Stable order for the DOM: left column top to bottom, then right.
  tiles.sort(
    (a, b) => (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1) || a.y - b.y || a.x - b.x,
  );

  return {
    scale,
    car,
    carBox,
    tileW: size.w,
    tileH: size.h,
    tiles,
    scroll: chosen.scroll,
    reserved,
  };
}

/**
 * Floor size of the landscape workbench for a viewport, as the stylesheet lays it out. Used
 * by the unit tests to check the layout at real phone sizes; the page measures its own floor.
 */
export function landscapeFloor(viewport: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const short = viewport.height < 360;
  const pad = short ? 2 : 4;
  const gap = short ? 3 : 4;
  const top = 48;
  const row = short ? 44 : 48;
  const gauges = 44;
  const side = 4;
  const columns = viewport.width - 2 * side - gap;
  return {
    width: Math.round((columns * 54) / 100) - 2,
    height: viewport.height - 2 * pad - top - row - gauges - 3 * gap - 2,
  };
}
