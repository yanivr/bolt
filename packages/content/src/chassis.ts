import type {
  ChassisDefinition,
  MountCategory,
  MountPoint,
  PartModifier,
  QuarterTurn,
  WheelAnchor,
} from '@bolt/shared';

/**
 * The five chassis. The specification lists twenty (Sections 6.4 and 11.2); the product owner
 * cut the game to five on October 11, 2026 (docs/DECISIONS.md, entry 87): three ordinary
 * frames and two strange ones, each clearly best at one thing and paying for it somewhere a
 * player can read in the garage. The numbers below are tuned as a set and pinned row by row
 * in `tests/unit/catalog.test.ts`; docs/BALANCE_CHANGELOG.md explains every change from the
 * specification's seed values.
 *
 * Coordinates are chassis-local world pixels: origin at the body centre, front is negative
 * Y, right is positive X. A mount's `maxFootprint` box, centred on the mount, is where a part
 * may sit before it is nudged within the installation region. The layouts obey these rules,
 * which the tests enforce for every chassis:
 *
 * - every box keeps 2 px clear of every wheel well (8 x 14 around each anchor);
 * - no two boxes overlap, so any two parts that fit their mounts fit together until one is
 *   nudged toward the other;
 * - a box may overhang the body outline by at most 4 px (bumpers and booms);
 * - left and right mounts come in mirrored pairs.
 *
 * The engine sits inside the body at `engine_bay`, below deck level, so accessory mounts may
 * be above it. Every accessory in the catalog fits at least one mount of at least one frame.
 */

type MountOptions = {
  /** Half-extents of the installation region. Default 2 x 2. */
  region?: [number, number];
  /** Small parts that may share the mount. Default 1. */
  capacity?: number;
  turns?: QuarterTurn[];
  acceptsAnyWeapon?: boolean;
};

/**
 * Which way a part with a free facing may point on a mount, default first (0 front, 1 right,
 * 2 rear, 3 left). This is a statement about the car and has nothing to do with room: such a
 * part stands on a square base, so if it fits it fits every way the mount allows.
 *
 * - FRONT: forward only. A nose mount is a fixed forward gun position.
 * - REAR: backward only.
 * - LEFT and RIGHT: outward first, then forward and backward along the flank. Never inward,
 *   across the cabin.
 * - ROOF, UNIVERSAL (the Pickup's bed) and UTILITY: all four. Nothing stands in the way.
 *
 * The Pickup's two bed rails are REAR mounts on a side wall and add outward to backward.
 * Parts with a fixed facing ignore this table: the part decides (a Road Mine drops behind
 * from any mount).
 */
const ALL_TURNS: QuarterTurn[] = [0, 1, 2, 3];
const TURNS: Partial<Record<MountCategory, QuarterTurn[]>> = {
  FRONT: [0],
  REAR: [2],
  LEFT: [3, 0, 2],
  RIGHT: [1, 0, 2],
  ROOF: ALL_TURNS,
  UNIVERSAL: ALL_TURNS,
  UTILITY: ALL_TURNS,
};

function mount(
  id: string,
  categories: MountCategory[],
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  options: MountOptions = {},
): MountPoint {
  const point: MountPoint = {
    id,
    categories,
    x,
    y,
    regionHalfW: options.region?.[0] ?? 2,
    regionHalfH: options.region?.[1] ?? 2,
    maxFootprint: { w: maxW, h: maxH },
    allowedQuarterTurns: options.turns ?? TURNS[categories[0]!] ?? ALL_TURNS,
    capacity: options.capacity ?? 1,
  };
  if (options.acceptsAnyWeapon) point.acceptsAnyWeapon = true;
  return point;
}

/** A mirrored left and right pair. `x` is the distance from the centre line. */
function pair(
  name: string,
  leftCategories: MountCategory[],
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  options: MountOptions = {},
): MountPoint[] {
  const mirror = (c: MountCategory): MountCategory =>
    c === 'LEFT' ? 'RIGHT' : c === 'RIGHT' ? 'LEFT' : c;
  const flip = (t: QuarterTurn): QuarterTurn => (t === 1 ? 3 : t === 3 ? 1 : t);
  const leftTurns = options.turns ?? TURNS[leftCategories[0]!] ?? ALL_TURNS;
  return [
    mount(`left_${name}`, leftCategories, -x, y, maxW, maxH, { ...options, turns: leftTurns }),
    mount(`right_${name}`, leftCategories.map(mirror), x, y, maxW, maxH, {
      ...options,
      turns: options.turns
        ? options.turns.map(flip)
        : (TURNS[mirror(leftCategories[0]!)] ?? ALL_TURNS),
    }),
  ];
}

const engineBay = (x: number, y: number): MountPoint =>
  mount('engine_bay', ['ENGINE'], x, y, 22, 18, { region: [0, 0], turns: [0] });

function wheels4(frontX: number, frontY: number, rearX: number, rearY: number): WheelAnchor[] {
  return [
    { id: 'front_left', x: -frontX, y: frontY, steers: true, driven: false },
    { id: 'front_right', x: frontX, y: frontY, steers: true, driven: false },
    { id: 'rear_left', x: -rearX, y: rearY, steers: false, driven: true },
    { id: 'rear_right', x: rearX, y: rearY, steers: false, driven: true },
  ];
}

type ChassisRow = {
  id: string;
  displayName: string;
  price: number;
  massKg: number;
  soundKey: 'chassis_light' | 'chassis_heavy';
  description: string;
  drawback: string;
  handling: string;
  wheelAnchors: WheelAnchor[];
  mounts: MountPoint[];
  bodyHalfWidth: number;
  bodyHalfLength: number;
  recommendedLoadKg: number;
  maxLoadKg: number;
  baseIntegrity: number;
  dragFactor?: number;
  yawFactor?: number;
  stabilityOffset?: number;
  stabilityThreshold?: number;
  armorLoadShare?: number;
  defaultEngineId?: string;
  /** A defining modifier or restriction beyond drag, yaw and stability. */
  special?: PartModifier[];
};

/** Share of the maximum safe load that may be armor plate on an ordinary chassis. */
export const STANDARD_ARMOR_SHARE = 0.45;

function chassis(row: ChassisRow): ChassisDefinition {
  const dragFactor = row.dragFactor ?? 1;
  const yawFactor = row.yawFactor ?? 1;
  const stabilityOffset = row.stabilityOffset ?? 0;
  // The frame's own mass, drag, yaw response and stability offset are primitives like any
  // other, so the rules read one list and never a special field.
  const modifiers: PartModifier[] = [{ type: 'AddMass', kg: row.massKg }];
  if (dragFactor !== 1) modifiers.push({ type: 'ModifyDrag', factor: dragFactor });
  if (yawFactor !== 1 || stabilityOffset !== 0) {
    const steering: Extract<PartModifier, { type: 'ModifySteeringResponse' }> = {
      type: 'ModifySteeringResponse',
    };
    if (yawFactor !== 1) steering.yaw = yawFactor;
    if (stabilityOffset !== 0) steering.stability = stabilityOffset;
    modifiers.push(steering);
  }
  modifiers.push(...(row.special ?? []));
  return {
    id: row.id,
    displayName: row.displayName,
    category: 'chassis',
    price: row.price,
    massKg: row.massKg,
    footprint: { w: row.bodyHalfWidth * 2, h: row.bodyHalfLength * 2 },
    compatibleMounts: [],
    spriteKey: row.id,
    soundKey: row.soundKey,
    description: row.description,
    drawback: row.drawback,
    modifiers,
    wheelCount: row.wheelAnchors.length as 3 | 4 | 6,
    wheelAnchors: row.wheelAnchors,
    mounts: row.mounts,
    bodyHalfWidth: row.bodyHalfWidth,
    bodyHalfLength: row.bodyHalfLength,
    recommendedLoadKg: row.recommendedLoadKg,
    maxLoadKg: row.maxLoadKg,
    baseIntegrity: row.baseIntegrity,
    dragFactor,
    yawFactor,
    stabilityOffset,
    stabilityThreshold: row.stabilityThreshold ?? 55,
    armorLoadShare: row.armorLoadShare ?? STANDARD_ARMOR_SHARE,
    defaultEngineId: row.defaultEngineId ?? 'engine_four_cylinder',
    handling: row.handling,
  };
}

/**
 * Beetle. Rounded hood, twin fenders over all four wheels, compact cabin. One gun mount on
 * the hood between the front fenders, the roof, a utility pod on each sill between the
 * axles, and a rear deck mount above the engine.
 *
 * Best at: being the cheapest four-wheel frame, and the only frame with a nose, a roof, a
 * side and a tail mount all at once. Cost: it tops no chart.
 */
export const CHASSIS_BEETLE = chassis({
  id: 'chassis_beetle',
  displayName: 'Beetle',
  price: 150,
  massKg: 250,
  soundKey: 'chassis_light',
  description: 'The cheapest four-wheel frame, with a mount on every side.',
  drawback: 'Tops no chart: outrun by the Arrow, outcarried by the Pickup.',
  handling: 'Balanced and forgiving',
  wheelAnchors: wheels4(14.5, -17, 14.5, 17.5),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -22, 16, 12),
    mount('roof_mid', ['ROOF'], 0, 0, 14, 14),
    ...pair('utility', ['UTILITY'], 13, 0, 8, 14),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 23, 16, 10),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 17,
  bodyHalfLength: 29,
  recommendedLoadKg: 460,
  maxLoadKg: 730,
  baseIntegrity: 110,
});

/**
 * Arrow. A narrow aerodynamic wedge with rear fins and the suspension hidden inside. The
 * nose mount overhangs the front edge; a long spine mount (the one place a railgun fits
 * lengthwise), a small rear roof mount and a tail mount follow.
 *
 * Best at: drag, by a wide margin, so top speed. Cost: four mounts, none for a utility pod,
 * and the smallest load allowance of the four-wheel frames.
 */
export const CHASSIS_ARROW = chassis({
  id: 'chassis_arrow',
  displayName: 'Arrow',
  price: 180,
  massKg: 230,
  soundKey: 'chassis_light',
  description: 'A light wedge with the lowest drag and the highest top speed.',
  drawback: 'Four mounts and a small load limit leave little room for gear.',
  handling: 'Lowest drag, fastest',
  wheelAnchors: wheels4(11.5, -14, 13, 19),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -29, 14, 12),
    mount('roof_mid', ['ROOF'], 0, 0, 10, 18),
    mount('roof_rear', ['ROOF'], 0, 17, 12, 12),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 29, 14, 8),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 14,
  bodyHalfLength: 31,
  recommendedLoadKg: 360,
  maxLoadKg: 600,
  baseIntegrity: 95,
  dragFactor: 0.84,
});

/**
 * Pickup. A short cab ahead of an open bed with the cargo on show. Front engine under the
 * hood, so nothing mounts on the nose. A small mount on the cab roof, then the bed, which
 * takes any part: a rack behind the cab that holds two small parts, and the open bed floor,
 * the largest mount in the game and the only home of the mortar. A rail on each bed wall and
 * the tailgate finish it.
 *
 * Best at: load, by 150 kg, and the size of what it can carry. Cost: heavy and draggy, no
 * nose mount, and parts in the open bed take more damage.
 */
export const CHASSIS_PICKUP = chassis({
  id: 'chassis_pickup',
  displayName: 'Pickup',
  price: 185,
  massKg: 390,
  soundKey: 'chassis_heavy',
  description: 'Carries the most. The open bed takes any part, even the biggest.',
  drawback: 'Heavy, no nose mount, and parts in the bed take 15% more damage.',
  handling: 'Heavy hauler',
  wheelAnchors: wheels4(15.5, -23, 15.5, 22),
  mounts: [
    mount('roof_cab', ['ROOF'], 0, -12, 14, 10),
    mount('bed_front', ['UNIVERSAL'], 0, 1, 18, 12, { region: [5, 2], capacity: 2 }),
    mount('left_bed', ['REAR'], -15, 6, 8, 12, { turns: [2, 3] }),
    mount('right_bed', ['REAR'], 15, 6, 8, 12, { turns: [2, 1] }),
    mount('bed_rear', ['UNIVERSAL'], 0, 17, 18, 16, { region: [1, 1] }),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 32, 18, 10),
    engineBay(0, -22),
  ],
  bodyHalfWidth: 19,
  bodyHalfLength: 37,
  recommendedLoadKg: 780,
  maxLoadKg: 1200,
  baseIntegrity: 122,
  dragFactor: 1.08,
  special: [
    { type: 'AddHardpoint', category: 'UNIVERSAL', count: 1 },
    { type: 'ModifyDamageByTag', tag: 'rear_mounted_part', factor: 1.15 },
  ],
});

/**
 * Spider. An angular central cab on six wheels carried by segmented arms. Side mounts sit on
 * the body between the arms, two roof mounts on the cab, and a utility mount at each end.
 *
 * Best at: stability, by a wide margin, and mount count (eight, the only side mounts in the
 * game). Cost: the most expensive frame, six wheels to pay for and to carry, the most drag
 * and the slowest steering.
 */
export const CHASSIS_SPIDER = chassis({
  id: 'chassis_spider',
  displayName: 'Spider',
  price: 235,
  massKg: 420,
  soundKey: 'chassis_heavy',
  description: 'Six wheels on arms: the hardest frame to tip, with eight mounts.',
  drawback: 'The priciest frame. Six wheels cost half again, and it turns slowly.',
  handling: 'Very stable, slow to turn',
  wheelAnchors: [
    { id: 'front_left', x: -22.5, y: -24, steers: true, driven: false },
    { id: 'front_right', x: 22.5, y: -24, steers: true, driven: false },
    { id: 'mid_left', x: -24.5, y: 0, steers: false, driven: true },
    { id: 'mid_right', x: 24.5, y: 0, steers: false, driven: true },
    { id: 'rear_left', x: -22.5, y: 24, steers: false, driven: true },
    { id: 'rear_right', x: 22.5, y: 24, steers: false, driven: true },
  ],
  mounts: [
    mount('front_utility', ['UTILITY'], 0, -28, 14, 8),
    ...pair('front', ['LEFT', 'ARMOR'], 12, -14, 8, 14),
    mount('roof_front', ['ROOF'], 0, -14, 12, 14),
    mount('roof_mid', ['ROOF'], 0, 2, 12, 14),
    ...pair('rear', ['LEFT', 'ARMOR'], 12, 14, 8, 14),
    mount('rear_utility', ['UTILITY'], 0, 17, 12, 12),
    engineBay(0, 24),
  ],
  bodyHalfWidth: 24,
  bodyHalfLength: 34,
  recommendedLoadKg: 700,
  maxLoadKg: 1050,
  baseIntegrity: 115,
  dragFactor: 1.1,
  yawFactor: 0.94,
  stabilityOffset: 18,
  stabilityThreshold: 50,
});

/**
 * Trike. A tiny triangular frame, exposed down the middle: two steered wheels wide at the
 * front and a single driven wheel at the back. A forward mount between the front wheels, a
 * small roof mount, and a rear mount on each side of the back wheel.
 *
 * Best at: price and weight. It is the cheapest and lightest frame and its wheel kits cost a
 * quarter less, which leaves the most credits for weapons. Cost: the least stable frame, the
 * weakest, and the smallest load limit.
 */
export const CHASSIS_TRIKE = chassis({
  id: 'chassis_trike',
  displayName: 'Trike',
  price: 120,
  massKg: 145,
  soundKey: 'chassis_light',
  description: 'The cheapest and lightest frame. More credits left for weapons.',
  drawback: 'Three wheels: easy to tip, easy to break, easy to overload.',
  handling: 'Quick but easy to tip',
  wheelAnchors: [
    { id: 'front_left', x: -11.5, y: -13, steers: true, driven: false },
    { id: 'front_right', x: 11.5, y: -13, steers: true, driven: false },
    { id: 'rear_center', x: 0, y: 16, steers: false, driven: true },
  ],
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -15, 10, 14),
    mount('roof_mid', ['ROOF'], 0, 1, 14, 10),
    mount('left_rear', ['REAR'], -10.5, 15, 8, 12),
    mount('right_rear', ['REAR'], 10.5, 15, 8, 12),
    engineBay(0, 3),
  ],
  bodyHalfWidth: 13,
  bodyHalfLength: 24,
  recommendedLoadKg: 280,
  maxLoadKg: 460,
  baseIntegrity: 80,
  yawFactor: 1.08,
  stabilityOffset: -16,
  stabilityThreshold: 62,
  defaultEngineId: 'engine_mini_electric',
});

/** Garage order: the three ordinary frames, then the two strange ones. */
export const CHASSIS_LIST: ChassisDefinition[] = [
  CHASSIS_BEETLE,
  CHASSIS_ARROW,
  CHASSIS_PICKUP,
  CHASSIS_SPIDER,
  CHASSIS_TRIKE,
];

export const CHASSIS: Record<string, ChassisDefinition> = Object.fromEntries(
  CHASSIS_LIST.map((c) => [c.id, c]),
);
