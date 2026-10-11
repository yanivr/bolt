/**
 * Where everything on the workbench goes. Two views, both pure functions of the floor size
 * and the car's geometry, so they are unit tested for every chassis:
 *
 * - the overview (`layoutBench`): the car at the largest whole-number scale that fits, and one
 *   tile per accessory mount in a column on each side, each joined to its mount by a leader
 *   line. Tiles never overlap each other or the car, and leaders never cross;
 * - focus (`layoutFocus`, over `focusCamera`): the car one or two whole steps larger and
 *   panned so the selected mount sits near the middle of the floor the tiles leave free. The
 *   tiles shrink to their compact size and keep their places at the edges, and only the
 *   selected slot keeps its leader.
 *
 * No chassis has more than eight mounts, so a column never scrolls. A floor too short for
 * four tiles a side (a phone under 340 pixels tall) puts the overflow in a second, outer
 * column instead.
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
  /** From the tile's edge to the mount on the car. Empty for an unselected tile in focus. */
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
  /** Floor width each column block takes, edge padding included. */
  reserved: { left: number; right: number };
  /** Set in focus: the mount the view moved in on, and the floor it is framed in. */
  focus: BenchFocus | null;
};

export type BenchFocus = {
  /** The selected mount id, or `engine`. */
  id: string;
  /** Where the selected mount is on the floor. */
  anchor: Point;
  /** The floor the tile columns leave free. The selected part is inside it. */
  free: Box;
  /** The selected mount's largest part, as drawn, on the floor. */
  part: Box;
};

export const TILE_REGULAR = { w: 54, h: 48, gap: 4 } as const;
export const TILE_COMPACT = { w: 50, h: 44, gap: 3 } as const;
export const MAX_CAR_SCALE = 8;
/** Floor padding beside the tile columns. */
const EDGE = 4;
/** Floor padding above and below the columns and the car. */
const VEDGE = 2;
/**
 * Clear floor between a column and the car's box, where the leaders are read. The box is
 * drawn around the largest part every mount could hold, so the floor that really shows is
 * wider than this.
 */
const LEADER_ROOM = 8;
/** The most space left between tiles when a column has room to spread. */
const MAX_SPREAD = 14;

/** `gap` is the space between tiles. A leader from an outer column runs through it. */
type Size = { w: number; h: number; gap: number };
type Berth = { side: 'left' | 'right'; x: number; y: number; port: Point; stub: Point | null };
type Plan = {
  size: Size;
  left: number;
  right: number;
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
  // The car may stand the full height of the floor: its box already allows for the tallest
  // part on every mount, and the three pixels this gives decide whether the Spider is drawn at
  // three times or two on a 370 pixel phone.
  const tall = input.height;
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

function plan(input: BenchInput, size: Size, double: boolean, force = false): Plan | null {
  const n = input.mounts.length;
  const rows = Math.max(force ? 1 : 0, perColumn(input.height, size));
  const capacity = double ? Math.max(rows, 2 * rows - 1) : rows;
  if (n > 2 * capacity && !force) return null;
  const sorted = [...input.mounts].sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  const left = split(sorted, capacity);
  const right = n - left;
  const reserved = {
    left: blockWidth(columnsFor(left, rows), size),
    right: blockWidth(columnsFor(right, rows), size),
  };
  return { size, left, right, scale: fitScale(input, reserved), reserved };
}

/**
 * Tile positions for one side. Up to a column's worth sit in one column, spread a little when
 * there is height to spare. More than that takes a second, outer column whose tiles sit level
 * with the gaps of the inner one, so each outer leader has a clear run to the car.
 */
function berths(input: BenchInput, side: 'left' | 'right', count: number, size: Size): Berth[] {
  if (count === 0) return [];
  const rows = Math.max(1, perColumn(input.height, size));
  const sign = side === 'left' ? 1 : -1;
  const edge = side === 'left' ? EDGE : input.width - EDGE - size.w;
  const inward = (x: number) => (side === 'left' ? x + size.w : x);
  const free = input.height - 2 * VEDGE;
  const GAP = size.gap;
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

type Pair = { mount: BenchMount; berth: Berth };

/** Which tile each mount gets: by side, then top to bottom, traded until no leaders cross. */
function assign(
  input: BenchInput,
  mounts: readonly BenchMount[],
  chosen: Plan,
  anchorOf: (mount: BenchMount) => Point,
): Pair[] {
  const sorted = [...mounts].sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  const sides: Array<['left' | 'right', BenchMount[]]> = [
    ['left', sorted.slice(0, chosen.left)],
    ['right', sorted.slice(chosen.left)],
  ];
  const pairs: Pair[] = [];
  for (const [side, group] of sides) {
    const slots = berths(input, side, group.length, chosen.size);
    // Within a side, top to bottom on screen.
    const ordered = [...group].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    ordered.forEach((mount, i) => pairs.push({ mount, berth: slots[i]! }));
  }
  // Two leaders that cross are both shorter when their tiles trade places, so trading until
  // nothing crosses always ends.
  for (let pass = 0; pass < 200; pass++) {
    let swapped = false;
    for (let i = 0; i < pairs.length; i++)
      for (let j = i + 1; j < pairs.length; j++) {
        const a = pairs[i]!;
        const b = pairs[j]!;
        const pa = anchorOf(a.mount);
        const pb = anchorOf(b.mount);
        if (!segmentsCross(a.berth.port, pa, b.berth.port, pb)) continue;
        const now = length(a.berth.port, pa) + length(b.berth.port, pb);
        const traded = length(b.berth.port, pa) + length(a.berth.port, pb);
        if (traded >= now) continue;
        const berth = a.berth;
        a.berth = b.berth;
        b.berth = berth;
        swapped = true;
      }
    if (!swapped) break;
  }
  return pairs;
}

function sortTiles(tiles: BenchTile[]): BenchTile[] {
  // Stable order for the DOM: left column top to bottom, then right.
  return tiles.sort(
    (a, b) => (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1) || a.y - b.y || a.x - b.x,
  );
}

export function layoutBench(input: BenchInput): BenchLayout {
  const mounts = input.columns === false ? [] : input.mounts;
  const placed: BenchInput = { ...input, mounts };

  // The arrangement that shows the car largest, preferring full tiles in single columns. A
  // second column is only for a floor too short to hold one column a side.
  const candidates = [
    plan(placed, TILE_REGULAR, false),
    plan(placed, TILE_COMPACT, false),
    plan(placed, TILE_REGULAR, true),
    plan(placed, TILE_COMPACT, true),
  ].filter((p): p is Plan => p !== null);
  let chosen: Plan | null = null;
  for (const candidate of candidates)
    if (candidate.scale >= 2 && (!chosen || candidate.scale > chosen.scale)) chosen = candidate;
  chosen ??= candidates[0] ?? plan(placed, TILE_COMPACT, true, true)!;

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
  const anchorOf = (mount: BenchMount): Point => ({
    x: car.x + mount.dx * scale,
    y: car.y + mount.dy * scale,
  });
  const tiles = assign(placed, mounts, chosen, anchorOf).map(({ mount, berth }): BenchTile => {
    const anchor = anchorOf(mount);
    const leader = berth.stub ? [berth.stub, berth.port, anchor] : [berth.port, anchor];
    return { id: mount.id, side: berth.side, x: berth.x, y: berth.y, w: size.w, h: size.h, leader };
  });

  return {
    scale,
    car,
    carBox,
    tileW: size.w,
    tileH: size.h,
    tiles: sortTiles(tiles),
    reserved,
    focus: null,
  };
}

// --- Focus --------------------------------------------------------------------------------------

/** The most whole steps the view moves in from the overview. */
export const FOCUS_STEPS = 2;
/** Sprite pixels of bodywork kept in view on every side of the selected part. */
export const FOCUS_CONTEXT = 9;
/** Share of the free floor that may be left empty beside the car when a mount is at its edge. */
const FOCUS_SLACK = 0.1;
/** Clear floor between a tile column and the framed view. */
const FOCUS_GAP = 6;

export type CameraInput = {
  /** The floor the view may use, in CSS pixels: the workbench less the tile columns. */
  free: Box;
  /** Everything the car can draw at this heading, in sprite pixels from its centre. */
  bounds: Box;
  /** The selected mount's centre as drawn, in sprite pixels from the car's centre. */
  mount: Point;
  /** The largest part that mount takes, as drawn, in sprite pixels from the car's centre. */
  part: Box;
  /** Whole scales to choose from, in any order. The smallest is the fallback. */
  scales: readonly number[];
};

export type Camera = {
  scale: number;
  /** Where the centre of the car sprite goes on the floor, in whole CSS pixels. */
  car: Point;
  /** Where the selected mount lands on the floor. */
  anchor: Point;
};

/**
 * The focus camera. Picks the largest candidate scale at which the selected part and
 * `FOCUS_CONTEXT` sprite pixels of bodywork around it fit the free floor, then pans the car
 * so the part sits at the centre of that floor. The pan stops short of showing more than a
 * strip of empty floor beyond the car, so a mount at the nose is framed with the car beside
 * it and not with a void; on an axis where the whole car fits it is not panned at all, it is
 * centred. Scales and offsets are whole numbers: pixel art is never drawn between pixels.
 *
 * Whatever the inputs, the mount ends up inside `free`, at least its own part's half-size
 * from every edge, as long as the part fits the floor at the smallest candidate scale.
 */
/** Share of the car's width and height that stays on the floor past the first focus step. */
const FOCUS_VISIBLE = 0.6;

export function focusCamera(input: CameraInput): Camera {
  const { free, bounds, part } = input;
  const width = Math.max(1, free.right - free.left);
  const height = Math.max(1, free.bottom - free.top);
  const scales = [...input.scales].filter((s) => Number.isInteger(s) && s >= 1);
  scales.sort((a, b) => a - b);
  const needW = part.right - part.left + 2 * FOCUS_CONTEXT;
  const needH = part.bottom - part.top + 2 * FOCUS_CONTEXT;
  let scale = scales[0] ?? 1;
  // Beyond the first step in, keep most of the car in view: a part seen without the car
  // around it does not say where on the car it is.
  const carW = bounds.right - bounds.left;
  const carH = bounds.bottom - bounds.top;
  const inContext = (s: number): boolean =>
    s === scales[0] || (carW * s * FOCUS_VISIBLE <= width && carH * s * FOCUS_VISIBLE <= height);
  for (const s of scales) if (needW * s <= width && needH * s <= height && inContext(s)) scale = s;

  const axis = (
    lo: number,
    hi: number,
    carLo: number,
    carHi: number,
    partLo: number,
    partHi: number,
  ): number => {
    const room = hi - lo;
    const span = (carHi - carLo) * scale;
    const slack = Math.round(room * FOCUS_SLACK);
    // The whole car fits with room to spare: centred, nothing to pan.
    if (span <= room - 2 * slack) return (lo + hi) / 2 - ((carLo + carHi) / 2) * scale;
    const wanted = (lo + hi) / 2 - ((partLo + partHi) / 2) * scale;
    const least = hi - slack - carHi * scale;
    const most = lo + slack - carLo * scale;
    return Math.min(most, Math.max(least, wanted));
  };
  const car = {
    x: Math.round(axis(free.left, free.right, bounds.left, bounds.right, part.left, part.right)),
    y: Math.round(axis(free.top, free.bottom, bounds.top, bounds.bottom, part.top, part.bottom)),
  };
  return {
    scale,
    car,
    anchor: { x: car.x + input.mount.x * scale, y: car.y + input.mount.y * scale },
  };
}

/** The whole scales focus may use for an overview scale: one step in at least, two at most. */
export function focusScales(overview: number): number[] {
  return Array.from({ length: FOCUS_STEPS }, (_, i) => overview + 1 + i);
}

export type FocusInput = BenchInput & {
  target: {
    /** The selected mount id, or `engine`. */
    id: string;
    /** Its centre as drawn, in sprite pixels from the car's centre. */
    dx: number;
    dy: number;
    /** The largest part it takes, as drawn, in sprite pixels from the car's centre. */
    part: Box;
  };
};

/**
 * The workbench moved in on one mount. Every tile keeps the side and the order it has in the
 * overview, at the compact size, so switching slots is one tap on a tile that has not moved
 * far. The car is placed by `focusCamera` in the floor the columns leave free.
 */
export function layoutFocus(input: FocusInput): BenchLayout {
  const overview = layoutBench(input);
  const mounts = input.columns === false ? [] : input.mounts;
  const placed: BenchInput = { ...input, mounts };
  const size = TILE_COMPACT;
  const rows = Math.max(1, perColumn(input.height, size));
  const leftCount = overview.tiles.filter((t) => t.side === 'left').length;
  const rightCount = overview.tiles.length - leftCount;
  const reserved = {
    left: blockWidth(columnsFor(leftCount, rows), size),
    right: blockWidth(columnsFor(rightCount, rows), size),
  };
  const free: Box = {
    left: reserved.left > 0 ? reserved.left + FOCUS_GAP : EDGE,
    right: input.width - (reserved.right > 0 ? reserved.right + FOCUS_GAP : EDGE),
    top: VEDGE,
    bottom: input.height - VEDGE,
  };
  const { target, bounds } = input;
  const camera = focusCamera({
    free,
    bounds,
    mount: { x: target.dx, y: target.dy },
    part: target.part,
    scales: focusScales(overview.scale),
  });
  const { scale, car, anchor } = camera;

  // The same tile for the same mount as in the overview: same side, same order down it.
  const tiles: BenchTile[] = [];
  for (const side of ['left', 'right'] as const) {
    const group = overview.tiles
      .filter((t) => t.side === side)
      .sort((a, b) => a.leader[0]!.y - b.leader[0]!.y || a.y - b.y);
    const slots = berths(placed, side, group.length, size);
    group.forEach((tile, i) => {
      const berth = slots[i]!;
      const leader =
        tile.id !== target.id
          ? []
          : berth.stub
            ? [berth.stub, berth.port, anchor]
            : [berth.port, anchor];
      tiles.push({ id: tile.id, side, x: berth.x, y: berth.y, w: size.w, h: size.h, leader });
    });
  }

  return {
    scale,
    car,
    carBox: {
      left: car.x + bounds.left * scale,
      right: car.x + bounds.right * scale,
      top: car.y + bounds.top * scale,
      bottom: car.y + bounds.bottom * scale,
    },
    tileW: size.w,
    tileH: size.h,
    tiles: sortTiles(tiles),
    reserved,
    focus: {
      id: target.id,
      anchor,
      free,
      part: {
        left: car.x + target.part.left * scale,
        right: car.x + target.part.right * scale,
        top: car.y + target.part.top * scale,
        bottom: car.y + target.part.bottom * scale,
      },
    },
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
  // Under 390 pixels the essentials row and the padding give four pixels each to the floor.
  const low = viewport.height < 390;
  const pad = short ? 2 : low ? 3 : 4;
  const gap = short ? 3 : 4;
  const top = 48;
  const row = low ? 44 : 48;
  const gauges = 44;
  const side = 4;
  const columns = viewport.width - 2 * side - gap;
  return {
    width: Math.round((columns * 54) / 100) - 2,
    height: viewport.height - 2 * pad - top - row - gauges - 3 * gap - 2,
  };
}

/**
 * Floor size of the portrait car strip for a viewport, as the stylesheet lays it out: the
 * full width less the column that holds Stats and View, and 28.5 percent of the height
 * within 150 to 360 pixels.
 */
export function portraitFloor(viewport: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const side = 4;
  const gap = 3;
  const tools = 48;
  return {
    width: viewport.width - 2 * side - gap - tools - 2,
    height: Math.round(Math.min(360, Math.max(150, viewport.height * 0.285))) - 2,
  };
}
