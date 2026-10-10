import type {
  ChassisDefinition,
  MountCategory,
  MountPoint,
  PartModifier,
  QuarterTurn,
  WheelAnchor,
} from '@bolt/shared';

/**
 * The twenty chassis of Sections 6.4 and 11.2. Prices, masses and load limits are the seed
 * values from those tables and are checked row by row in `tests/unit/catalog.test.ts`.
 *
 * Coordinates are chassis-local world pixels: origin at the body centre, front is negative
 * Y, right is positive X. A mount's `maxFootprint` box, centred on the mount, is where a part
 * may sit before it is nudged within the installation region. The layouts obey these rules,
 * which the tests enforce for every chassis:
 *
 * - every box keeps 2 px clear of every wheel well (8 x 14 around each anchor);
 * - no two boxes overlap, so any two parts that fit their mounts fit together until one is
 *   nudged toward the other;
 * - a box may overhang the body outline by at most 4 px (bumpers, booms and claws);
 * - left and right mounts come in mirrored pairs, except on the Chameleon, which the
 *   specification describes as asymmetrical.
 *
 * The engine sits inside the body at `engine_bay`, below deck level, so accessory mounts may
 * be above it. Beetle, Arrow, Turtle and Spider keep the wheel anchors, body bounds and
 * engine bay their sprites were drawn for.
 */

type MountOptions = {
  /** Half-extents of the installation region. Default 2 x 2. */
  region?: [number, number];
  /** Small parts that may share the mount. Default 1. */
  capacity?: number;
  turns?: QuarterTurn[];
  acceptsAnyWeapon?: boolean;
};

/** Orientations by where a mount sits: outward first, never back across the cabin. */
const TURNS: Partial<Record<MountCategory, QuarterTurn[]>> = {
  FRONT: [0, 3, 1],
  REAR: [2, 3, 1],
  LEFT: [3, 0, 2],
  RIGHT: [1, 0, 2],
};
const ALL_TURNS: QuarterTurn[] = [0, 1, 2, 3];

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
  /** The Section 11.2 "defining modifier or restriction", beyond drag, yaw and stability. */
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
 */
export const CHASSIS_BEETLE = chassis({
  id: 'chassis_beetle',
  displayName: 'Beetle',
  price: 150,
  massKg: 250,
  soundKey: 'chassis_light',
  description: 'Forgiving, compact and happy on any road.',
  drawback: 'Only five accessory mounts.',
  handling: 'Forgiving and compact',
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
 * Needle. A long tapered nose ahead of the front axle, a body barely wider than the driver,
 * tiny side pods. The nose mount is long enough for a railgun; a second forward mount sits
 * on the spine between the front wheels, then the roof and a small rear roof mount.
 */
export const CHASSIS_NEEDLE = chassis({
  id: 'chassis_needle',
  displayName: 'Needle',
  price: 135,
  massKg: 180,
  soundKey: 'chassis_light',
  description: 'A long, light dart with the highest top speed of any frame.',
  drawback: 'Four mounts, and it carries little armor.',
  handling: 'High top-speed modifier',
  wheelAnchors: wheels4(11, -11, 11.5, 22),
  mounts: [
    mount('front_nose', ['FRONT', 'ARMOR'], 0, -29, 14, 18),
    mount('front_spine', ['FRONT'], 0, -11, 10, 12),
    mount('roof_mid', ['ROOF'], 0, 5, 12, 14),
    mount('roof_rear', ['ROOF'], 0, 22, 10, 12),
    engineBay(0, 22),
  ],
  bodyHalfWidth: 13,
  bodyHalfLength: 36,
  recommendedLoadKg: 350,
  maxLoadKg: 560,
  baseIntegrity: 90,
  // "Reduced armor capacity": one armor-capable mount and a smaller plate allowance.
  armorLoadShare: 0.27,
  special: [{ type: 'ModifySteeringResponse', topSpeed: 1.08 }],
});

/**
 * Turtle. A squat hexagonal shell with the wheels buried under it. Armor-capable mounts on
 * all four faces, and three roof mounts in a row along the spine.
 */
export const CHASSIS_TURTLE = chassis({
  id: 'chassis_turtle',
  displayName: 'Turtle',
  price: 215,
  massKg: 460,
  soundKey: 'chassis_heavy',
  description: 'An armored shell that shrugs off hits.',
  drawback: 'Heavy, and slow to change direction.',
  handling: 'Durable and slow',
  wheelAnchors: wheels4(15.5, -19, 15.5, 19.5),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -24, 18, 12),
    mount('roof_front', ['ROOF'], 0, -11, 16, 10),
    mount('roof_mid', ['ROOF'], 0, 2, 16, 12, { region: [3, 2] }),
    mount('roof_rear', ['ROOF'], 0, 14, 16, 8),
    ...pair('mid', ['LEFT', 'ARMOR'], 16.5, 0, 8, 18),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 25, 18, 10),
    engineBay(0, 21),
  ],
  bodyHalfWidth: 21,
  bodyHalfLength: 31,
  recommendedLoadKg: 720,
  maxLoadKg: 1050,
  baseIntegrity: 110,
  dragFactor: 1.08,
  yawFactor: 0.88,
  stabilityOffset: 6,
  stabilityThreshold: 50,
  special: [{ type: 'ModifyIntegrity', target: 'chassis', factor: 1.35 }],
});

/**
 * Spider. An angular central cab on six wheels carried by segmented arms. Side mounts sit on
 * the body between the arms, two roof mounts on the cab, and a utility mount at each end.
 */
export const CHASSIS_SPIDER = chassis({
  id: 'chassis_spider',
  displayName: 'Spider',
  price: 235,
  massKg: 420,
  soundKey: 'chassis_heavy',
  description: 'Six wheels on long arms. Very hard to tip.',
  drawback: 'Wide, and six wheels cost more.',
  handling: 'Very stable and wide',
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
  recommendedLoadKg: 760,
  maxLoadKg: 1150,
  baseIntegrity: 115,
  dragFactor: 1.1,
  yawFactor: 0.94,
  stabilityOffset: 18,
  stabilityThreshold: 50,
});

/**
 * Crab. A narrow body with the wheels tucked in, and wide outriggers beyond them ending in
 * claw mounts: three a side, wide enough for a gun turned outward. Two roof mounts on the
 * centre line. Side mounts turn freely and widen any weapon's aim by 45 degrees.
 */
export const CHASSIS_CRAB = chassis({
  id: 'chassis_crab',
  displayName: 'Crab',
  price: 195,
  massKg: 330,
  soundKey: 'chassis_heavy',
  description: 'Six claw mounts on wide outriggers, built to fight sideways.',
  drawback: 'Nothing mounts on the nose or tail.',
  handling: 'Side-mounted tricks',
  wheelAnchors: wheels4(12, -18, 12, 18),
  mounts: [
    ...pair('front', ['LEFT', 'ARMOR'], 24, -17, 12, 12, { turns: [3, 0, 2, 1] }),
    ...pair('mid', ['LEFT', 'ARMOR'], 24, 0, 12, 16, { turns: [3, 0, 2, 1] }),
    ...pair('rear', ['LEFT', 'ARMOR'], 24, 17, 12, 12, { turns: [3, 0, 2, 1] }),
    mount('roof_front', ['ROOF'], 0, -12, 12, 12),
    mount('roof_mid', ['ROOF'], 0, 2, 12, 12),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 28,
  bodyHalfLength: 30,
  recommendedLoadKg: 630,
  maxLoadKg: 950,
  baseIntegrity: 115,
  dragFactor: 1.06,
  stabilityOffset: 4,
  special: [{ type: 'OverrideAimingArc', mounts: ['LEFT', 'RIGHT'], addDegrees: 45 }],
});

/**
 * Cobra. A long nose with a raised hood spine and forward vents. Two forward hardpoints in
 * line (the nose, and a long spine mount between the front wheels), two roof mounts, a rear
 * deck and a tail mount.
 */
export const CHASSIS_COBRA = chassis({
  id: 'chassis_cobra',
  displayName: 'Cobra',
  price: 170,
  massKg: 295,
  soundKey: 'chassis_light',
  description: 'Two forward hardpoints in line down a long nose.',
  drawback: 'The long nose is slow to swing round.',
  handling: 'Straight-line front attack',
  wheelAnchors: wheels4(13, -12, 13.5, 23),
  mounts: [
    mount('front_nose', ['FRONT', 'ARMOR'], 0, -31, 16, 12),
    mount('front_spine', ['FRONT'], 0, -14, 12, 18),
    mount('roof_front', ['ROOF'], 0, 2, 14, 10),
    mount('roof_rear', ['ROOF'], 0, 15, 12, 12),
    mount('rear_deck', ['REAR'], 0, 27, 12, 8),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 37, 16, 8),
    engineBay(0, 22),
  ],
  bodyHalfWidth: 16,
  bodyHalfLength: 37,
  recommendedLoadKg: 550,
  maxLoadKg: 850,
  baseIntegrity: 112,
  yawFactor: 0.92,
});

/**
 * Scorpion. A tapered front with nothing on it, and a lifted equipment boom behind the rear
 * axle that takes the largest rear weapons. A second rear mount between the rear wheels,
 * two roof mounts, and a utility pod on each sill. Mid engine.
 */
export const CHASSIS_SCORPION = chassis({
  id: 'chassis_scorpion',
  displayName: 'Scorpion',
  price: 180,
  massKg: 310,
  soundKey: 'chassis_light',
  description: 'A rear boom for big weapons. Rear mounts reach 8% farther.',
  drawback: 'No forward hardpoint at all.',
  handling: 'Rear weapon emphasis',
  wheelAnchors: wheels4(13, -18, 14.5, 14),
  mounts: [
    mount('roof_front', ['ROOF'], 0, -17, 12, 12),
    mount('roof_mid', ['ROOF'], 0, -2, 14, 12),
    ...pair('utility', ['UTILITY'], 13, -2, 8, 12),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 14, 14, 10),
    mount('rear_boom', ['REAR'], 0, 31, 16, 16),
    engineBay(0, 10),
  ],
  bodyHalfWidth: 17,
  bodyHalfLength: 36,
  recommendedLoadKg: 550,
  maxLoadKg: 850,
  baseIntegrity: 112,
  special: [{ type: 'OverrideAimingArc', mounts: ['REAR'], rangeFactor: 1.08 }],
});

/**
 * Buggy. An open roll cage on long-travel suspension with thick tires standing clear of the
 * body. A front bar, two cage-top mounts, a utility pod each side between the wheels, and a
 * rear bar.
 */
export const CHASSIS_BUGGY = chassis({
  id: 'chassis_buggy',
  displayName: 'Buggy',
  price: 165,
  massKg: 240,
  soundKey: 'chassis_light',
  description: 'Long-travel suspension: 12% more grip on dirt and sand.',
  drawback: 'Carries 15% less armor than other frames.',
  handling: 'Off-road suspension',
  wheelAnchors: wheels4(17, -17, 17, 17),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -22, 16, 12),
    mount('roof_front', ['ROOF'], 0, -8, 14, 12),
    mount('roof_rear', ['ROOF'], 0, 6, 14, 12),
    ...pair('utility', ['UTILITY'], 14, 0, 8, 14),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 22, 16, 10),
    engineBay(0, 19),
  ],
  bodyHalfWidth: 17,
  bodyHalfLength: 28,
  recommendedLoadKg: 460,
  maxLoadKg: 780,
  baseIntegrity: 100,
  dragFactor: 1.04,
  stabilityOffset: -2,
  armorLoadShare: STANDARD_ARMOR_SHARE * 0.85,
  special: [{ type: 'ModifyGripBySurface', surfaces: ['dirt', 'sand'], factor: 1.12 }],
});

/**
 * Chameleon. Modular panels and attachment rails, deliberately lopsided: one long rail down
 * the right side, two short pods on the left, and the roof mount set left of centre. Every
 * mount is universal. Lightly built.
 */
export const CHASSIS_CHAMELEON = chassis({
  id: 'chassis_chameleon',
  displayName: 'Chameleon',
  price: 195,
  massKg: 275,
  soundKey: 'chassis_light',
  description: 'Eight universal mounts. Anything goes anywhere it fits.',
  drawback: 'A light frame: 18% less chassis integrity.',
  handling: 'Flexible and fragile',
  wheelAnchors: wheels4(15, -18, 15, 20),
  mounts: [
    mount('rail_front', ['UNIVERSAL'], 0, -28, 16, 10, { turns: [0, 3, 1, 2] }),
    mount('rail_hood', ['UNIVERSAL'], 0, -16, 14, 10),
    mount('rail_roof', ['UNIVERSAL'], -2, -2, 12, 12),
    mount('rail_right', ['UNIVERSAL'], 13, 1, 8, 16, { turns: [1, 0, 2, 3] }),
    mount('pod_left_front', ['UNIVERSAL'], -14, -4, 8, 8, { turns: [3, 0, 2, 1] }),
    mount('pod_left_rear', ['UNIVERSAL'], -14, 6, 8, 8, { turns: [3, 0, 2, 1] }),
    mount('rail_deck', ['UNIVERSAL'], 0, 11, 14, 10),
    mount('rail_rear', ['UNIVERSAL'], 0, 27, 16, 10, { turns: [2, 3, 1, 0] }),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 19,
  bodyHalfLength: 34,
  recommendedLoadKg: 520,
  maxLoadKg: 790,
  baseIntegrity: 110,
  special: [{ type: 'ModifyIntegrity', target: 'chassis', factor: 0.82 }],
});

/**
 * Brick. A heavy rectilinear slab with riveted doors. A full-width mount at each end, a
 * large roof rack, two side mounts on each flank, and a utility bay ahead of and behind the
 * roof.
 */
export const CHASSIS_BRICK = chassis({
  id: 'chassis_brick',
  displayName: 'Brick',
  price: 245,
  massKg: 560,
  soundKey: 'chassis_heavy',
  description: 'Nine mounts and the highest load limit in the catalog.',
  drawback: 'A slab in the wind: 20% more drag.',
  handling: 'Large and heavy',
  wheelAnchors: wheels4(20, -24, 20, 24),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -32, 24, 10),
    mount('front_utility', ['UTILITY'], 0, -19, 16, 12),
    ...pair('front', ['LEFT', 'ARMOR'], 20, -7, 10, 12),
    mount('roof_mid', ['ROOF'], 0, 0, 18, 20, { region: [5, 4], capacity: 2 }),
    ...pair('rear', ['LEFT', 'ARMOR'], 20, 7, 10, 12),
    mount('rear_utility', ['UTILITY'], 0, 19, 16, 12),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 32, 24, 10),
    engineBay(0, 26),
  ],
  bodyHalfWidth: 26,
  bodyHalfLength: 38,
  recommendedLoadKg: 850,
  maxLoadKg: 1250,
  baseIntegrity: 150,
  dragFactor: 1.2,
  yawFactor: 0.9,
  stabilityOffset: 4,
  stabilityThreshold: 50,
  defaultEngineId: 'engine_v6',
});

/**
 * Trike. A tiny triangular frame, exposed down the middle: two steered wheels wide at the
 * front and a single driven wheel at the back. A forward mount between the front wheels, a
 * small roof mount, and a rear mount on each side of the back wheel.
 */
export const CHASSIS_TRIKE = chassis({
  id: 'chassis_trike',
  displayName: 'Trike',
  price: 120,
  massKg: 145,
  soundKey: 'chassis_light',
  description: 'The lightest frame. It launches like nothing else.',
  drawback: 'Three wheels: tippy in corners and easy to overload.',
  handling: 'Agile but unstable',
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
  dragFactor: 0.94,
  yawFactor: 1.08,
  stabilityOffset: -16,
  stabilityThreshold: 62,
  defaultEngineId: 'engine_mini_electric',
});

/**
 * Arrow. A narrow aerodynamic wedge with rear fins and the suspension hidden inside. The
 * nose mount overhangs the front edge; two roof mounts and a tail mount follow.
 */
export const CHASSIS_ARROW = chassis({
  id: 'chassis_arrow',
  displayName: 'Arrow',
  price: 180,
  massKg: 230,
  soundKey: 'chassis_light',
  description: 'A narrow wedge that slips through the air.',
  drawback: 'Only four accessory mounts.',
  handling: 'Excellent drag coefficient',
  wheelAnchors: wheels4(11.5, -14, 13, 19),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -29, 14, 12),
    mount('roof_mid', ['ROOF'], 0, 2, 12, 14),
    mount('roof_rear', ['ROOF'], 0, 17, 12, 12),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 29, 14, 8),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 14,
  bodyHalfLength: 31,
  recommendedLoadKg: 420,
  maxLoadKg: 680,
  baseIntegrity: 100,
  dragFactor: 0.84,
});

/**
 * Wagon. An elongated cab with roof rails and stacked rear racks. Two roof mounts, two
 * double-capacity utility racks behind them, a utility pod on each sill, a rear rack and a
 * tail mount. Nothing mounts on the nose.
 */
export const CHASSIS_WAGON = chassis({
  id: 'chassis_wagon',
  displayName: 'Wagon',
  price: 190,
  massKg: 390,
  soundKey: 'chassis_heavy',
  description: 'Two double racks carry two extra utilities.',
  drawback: 'A long wheelbase: 12% wider turns.',
  handling: 'Support and slow turning',
  wheelAnchors: wheels4(16.5, -24, 16.5, 22),
  mounts: [
    mount('roof_front', ['ROOF'], 0, -27, 16, 10),
    mount('roof_mid', ['ROOF'], 0, -13, 18, 14, { region: [3, 2] }),
    mount('rack_upper', ['UTILITY'], 0, 1, 18, 10, { region: [5, 1], capacity: 2 }),
    ...pair('utility', ['UTILITY'], 15, 1, 8, 14),
    mount('rack_deck', ['UTILITY'], 0, 13, 18, 10, { region: [5, 1], capacity: 2 }),
    mount('rear_rack', ['REAR'], 0, 25, 18, 10),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 37, 18, 10),
    engineBay(0, -24),
  ],
  bodyHalfWidth: 20,
  bodyHalfLength: 40,
  recommendedLoadKg: 720,
  maxLoadKg: 1090,
  baseIntegrity: 125,
  dragFactor: 1.05,
  stabilityOffset: 3,
  special: [
    { type: 'ModifySteeringResponse', turnRadius: 1.12 },
    { type: 'AddHardpoint', category: 'UTILITY', count: 2 },
  ],
});

/**
 * Rammer. A battering-ram bumper across the full nose, broad shoulders and reinforced seams.
 * The ram mount overhangs the front; two more forward mounts sit behind it between the
 * wheels, a shoulder mount on each flank, and a mount each side of the tail. No roof mount.
 */
export const CHASSIS_RAMMER = chassis({
  id: 'chassis_rammer',
  displayName: 'Rammer',
  price: 220,
  massKg: 455,
  soundKey: 'chassis_heavy',
  description: 'A battering ram: 20% more push when it hits nose first.',
  drawback: 'Heavy before you add a single part.',
  handling: 'Heavy frontal collision',
  wheelAnchors: wheels4(18, -18, 18, 20),
  mounts: [
    mount('front_ram', ['FRONT', 'ARMOR'], 0, -33, 24, 8),
    mount('front_left', ['FRONT'], -6.5, -20, 10, 12),
    mount('front_right', ['FRONT'], 6.5, -20, 10, 12),
    ...pair('shoulder', ['LEFT', 'ARMOR'], 18, -1, 10, 16),
    ...pair('rear', ['LEFT', 'ARMOR'], 6.5, 22, 10, 14),
    engineBay(0, 4),
  ],
  bodyHalfWidth: 23,
  bodyHalfLength: 34,
  recommendedLoadKg: 710,
  maxLoadKg: 1090,
  baseIntegrity: 140,
  dragFactor: 1.1,
  yawFactor: 0.93,
  stabilityOffset: 4,
  defaultEngineId: 'engine_v6',
  special: [{ type: 'ModifyImpulse', kind: 'ram_dealt', factor: 1.2 }],
});

/**
 * Drifter. A low roof, flared rear arches and an offset exhaust. Front engine. Two roof
 * mounts, a side mount on each sill, a rear deck and a tail mount.
 */
export const CHASSIS_DRIFTER = chassis({
  id: 'chassis_drifter',
  displayName: 'Drifter',
  price: 155,
  massKg: 260,
  soundKey: 'chassis_light',
  description: 'Catches a slide 15% sooner and holds it.',
  drawback: 'Gives up 6% of peak cornering grip.',
  handling: 'Controlled slip',
  wheelAnchors: wheels4(14, -17, 15.5, 18),
  mounts: [
    mount('roof_front', ['ROOF'], 0, -15, 14, 12),
    mount('roof_mid', ['ROOF'], 0, 0, 12, 14),
    ...pair('mid', ['LEFT', 'ARMOR'], 13, 0, 8, 14),
    mount('rear_deck', ['REAR'], 0, 14, 14, 10),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 26, 16, 10),
    engineBay(0, -16),
  ],
  bodyHalfWidth: 17,
  bodyHalfLength: 30,
  recommendedLoadKg: 490,
  maxLoadKg: 770,
  baseIntegrity: 105,
  dragFactor: 0.97,
  special: [
    { type: 'ModifySlipRecovery', factor: 1.15 },
    { type: 'ModifySteeringResponse', peakGrip: 0.94 },
  ],
});

/**
 * Kangaroo. A lifted cab on tall sprung wheel mounts with a skid plate underneath. A front
 * mount, three utility bays down the spine and a rear mount.
 */
export const CHASSIS_KANGAROO = chassis({
  id: 'chassis_kangaroo',
  displayName: 'Kangaroo',
  price: 190,
  massKg: 325,
  soundKey: 'chassis_heavy',
  description: 'Sprung wheel mounts take 22% off every wall and obstacle strike.',
  drawback: 'Rides high, with only two weapon mounts.',
  handling: 'Bumps and jump support',
  wheelAnchors: wheels4(16.5, -19, 16.5, 20),
  mounts: [
    mount('front_center', ['FRONT', 'ARMOR'], 0, -25, 18, 12),
    mount('utility_front', ['UTILITY'], 0, -11, 16, 12),
    mount('utility_mid', ['UTILITY'], 0, 4, 16, 14, { region: [3, 2] }),
    mount('utility_rear', ['UTILITY'], 0, 17, 14, 8),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 28, 18, 10),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 19,
  bodyHalfLength: 32,
  recommendedLoadKg: 530,
  maxLoadKg: 860,
  baseIntegrity: 118,
  dragFactor: 1.05,
  stabilityOffset: -3,
  special: [{ type: 'ModifyImpulse', kind: 'obstacle', factor: 0.78 }],
});

/**
 * Horseshoe. A U-shaped front structure around an open central cavity that takes any weapon
 * in the catalog, however large. A brace mount behind the cavity, a prong mount at the tip
 * of each arm and a side mount on each flank. Thin at the back.
 */
export const CHASSIS_HORSESHOE = chassis({
  id: 'chassis_horseshoe',
  displayName: 'Horseshoe',
  price: 195,
  massKg: 350,
  soundKey: 'chassis_heavy',
  description: 'A front cavity that takes any weapon, however large.',
  drawback: 'Thin at the back: hits from behind do 20% more.',
  handling: 'Large front cavity',
  wheelAnchors: wheels4(18, -14, 18, 22),
  mounts: [
    mount('front_cavity', ['FRONT'], 0, -22, 20, 26, { acceptsAnyWeapon: true }),
    ...pair('prong', ['LEFT', 'ARMOR'], 17, -30, 8, 12),
    mount('front_brace', ['FRONT'], 0, -1, 16, 12),
    ...pair('mid', ['LEFT', 'ARMOR'], 17, 4, 8, 14),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 22,
  bodyHalfLength: 35,
  recommendedLoadKg: 610,
  maxLoadKg: 940,
  baseIntegrity: 118,
  dragFactor: 1.06,
  special: [{ type: 'ModifyDamageByTag', tag: 'rear', factor: 1.2 }],
});

/**
 * Pickup. A short cab ahead of an open utility bed with the cargo on show. Front engine with
 * a utility mount on the hood, two large double-capacity cargo mounts in the bed, a utility
 * pod and a bed rail on each side, and the tailgate.
 */
export const CHASSIS_PICKUP = chassis({
  id: 'chassis_pickup',
  displayName: 'Pickup',
  price: 185,
  massKg: 365,
  soundKey: 'chassis_heavy',
  description: 'Two cargo mounts in the bed hold two utilities each.',
  drawback: 'Open bed: parts on rear mounts take 15% more damage.',
  handling: 'Rear modular cargo',
  wheelAnchors: wheels4(15.5, -23, 15.5, 22),
  mounts: [
    mount('utility_hood', ['UTILITY'], 0, -26, 14, 10),
    ...pair('utility', ['UTILITY'], 15, -8, 8, 10),
    mount('bed_front', ['UTILITY'], 0, 2, 18, 14, { region: [5, 2], capacity: 2 }),
    mount('left_bed', ['REAR'], -15, 6, 8, 12),
    mount('right_bed', ['REAR'], 15, 6, 8, 12),
    mount('bed_rear', ['UTILITY'], 0, 18, 18, 14, { region: [5, 2], capacity: 2 }),
    mount('rear_center', ['REAR', 'ARMOR'], 0, 32, 18, 10),
    engineBay(0, -22),
  ],
  bodyHalfWidth: 19,
  bodyHalfLength: 37,
  recommendedLoadKg: 690,
  maxLoadKg: 1080,
  baseIntegrity: 122,
  dragFactor: 1.07,
  special: [
    { type: 'AddHardpoint', category: 'UTILITY', count: 2 },
    { type: 'ModifyDamageByTag', tag: 'rear_mounted_part', factor: 1.15 },
  ],
});

/**
 * Twins. Two side pods, each carrying a pair of wheels, joined by a narrow central bridge.
 * Three mounts on each pod (nose, front and rear) and two roof mounts on the bridge, the
 * rear one a large double rack. A quarter wider than anything else.
 */
export const CHASSIS_TWINS = chassis({
  id: 'chassis_twins',
  displayName: 'Twins',
  price: 230,
  massKg: 490,
  soundKey: 'chassis_heavy',
  description: 'Twin hulls a quarter wider than any other frame. Very hard to tip.',
  drawback: 'Too wide for tight gaps, and heavy.',
  handling: 'Very wide and unusual',
  wheelAnchors: wheels4(22, -22, 22, 22),
  mounts: [
    ...pair('nose', ['LEFT', 'ARMOR'], 21, -35, 10, 8),
    mount('roof_front', ['ROOF'], 0, -12, 16, 14),
    ...pair('front', ['LEFT', 'ARMOR'], 21, -7, 12, 10),
    mount('roof_rear', ['ROOF'], 0, 5, 18, 16, { region: [5, 3], capacity: 2 }),
    ...pair('rear', ['LEFT', 'ARMOR'], 21, 6, 12, 12),
    engineBay(0, 20),
  ],
  bodyHalfWidth: 28,
  bodyHalfLength: 36,
  recommendedLoadKg: 790,
  maxLoadKg: 1180,
  baseIntegrity: 135,
  dragFactor: 1.14,
  yawFactor: 0.92,
  stabilityOffset: 20,
  stabilityThreshold: 50,
  defaultEngineId: 'engine_v6',
  // "Width +25%" is in the body bounds themselves: 28 against the 22 to 24 of the other
  // large frames. "Side stability +20" is the stability offset above.
});

/**
 * Platform. An exposed square truss with every part and wire on show. Four universal mounts
 * down the centre (two of them large enough for a mortar) and three on each edge.
 */
export const CHASSIS_PLATFORM = chassis({
  id: 'chassis_platform',
  displayName: 'Platform',
  price: 210,
  massKg: 390,
  soundKey: 'chassis_heavy',
  description: 'Ten universal mounts on an open truss.',
  drawback: 'Nothing is protected: 22% less chassis integrity.',
  handling: 'Maximum freedom, exposed parts',
  wheelAnchors: wheels4(20, -24, 20, 24),
  mounts: [
    mount('deck_front', ['UNIVERSAL'], 0, -29, 20, 12, { turns: [0, 3, 1, 2] }),
    mount('deck_fore', ['UNIVERSAL'], 0, -12, 18, 18, { region: [3, 2] }),
    ...pair('edge_front', ['UNIVERSAL'], 18, -10, 10, 8, { turns: [3, 0, 2, 1] }),
    ...pair('edge_mid', ['UNIVERSAL'], 18, 0, 10, 8, { turns: [3, 0, 2, 1] }),
    ...pair('edge_rear', ['UNIVERSAL'], 18, 10, 10, 8, { turns: [3, 0, 2, 1] }),
    mount('deck_aft', ['UNIVERSAL'], 0, 8, 18, 18, { region: [5, 3], capacity: 2 }),
    mount('deck_rear', ['UNIVERSAL'], 0, 28, 20, 14, { turns: [2, 3, 1, 0] }),
    engineBay(0, 18),
  ],
  bodyHalfWidth: 24,
  bodyHalfLength: 36,
  recommendedLoadKg: 680,
  maxLoadKg: 1020,
  baseIntegrity: 120,
  dragFactor: 1.12,
  stabilityOffset: 2,
  defaultEngineId: 'engine_v6',
  special: [
    { type: 'ModifyIntegrity', target: 'chassis', factor: 0.78 },
    { type: 'ModifyDamageByTag', tag: 'mounted_part', factor: 1.1 },
  ],
});

/** Section 11.2 order. */
export const CHASSIS_LIST: ChassisDefinition[] = [
  CHASSIS_BEETLE,
  CHASSIS_NEEDLE,
  CHASSIS_TURTLE,
  CHASSIS_SPIDER,
  CHASSIS_CRAB,
  CHASSIS_COBRA,
  CHASSIS_SCORPION,
  CHASSIS_BUGGY,
  CHASSIS_CHAMELEON,
  CHASSIS_BRICK,
  CHASSIS_TRIKE,
  CHASSIS_ARROW,
  CHASSIS_WAGON,
  CHASSIS_RAMMER,
  CHASSIS_DRIFTER,
  CHASSIS_KANGAROO,
  CHASSIS_HORSESHOE,
  CHASSIS_PICKUP,
  CHASSIS_TWINS,
  CHASSIS_PLATFORM,
];

export const CHASSIS: Record<string, ChassisDefinition> = Object.fromEntries(
  CHASSIS_LIST.map((c) => [c.id, c]),
);
