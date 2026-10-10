import type { ChassisDefinition, MountPoint } from '@bolt/shared';

/**
 * Chassis layouts. Coordinates are chassis-local world pixels: front is negative Y, right is
 * positive X. Milestone A ships the Beetle and the three benchmark frames from Section 14.2
 * (Arrow, Turtle, Spider); the remaining sixteen land in Milestone B. Prices, masses and
 * load limits are the seed values from Sections 6.4 and 11.2.
 */

const QUARTERS: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3];

function mount(
  id: string,
  categories: MountPoint['categories'],
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  region = 2,
): MountPoint {
  return {
    id,
    categories,
    x,
    y,
    regionHalfW: region,
    regionHalfH: region,
    maxFootprint: { w: maxW, h: maxH },
    allowedQuarterTurns: QUARTERS,
  };
}

export const CHASSIS_BEETLE: ChassisDefinition = {
  id: 'chassis_beetle',
  displayName: 'Beetle',
  category: 'chassis',
  price: 150,
  massKg: 250,
  footprint: { w: 34, h: 58 },
  compatibleMounts: [],
  spriteKey: 'chassis_beetle',
  soundKey: 'chassis_light',
  description: 'Forgiving, compact and happy on any road.',
  drawback: 'Only five accessory mounts.',
  modifiers: {},
  wheelCount: 4,
  wheelAnchors: [
    { id: 'front_left', x: -14.5, y: -17, steers: true, driven: false },
    { id: 'front_right', x: 14.5, y: -17, steers: true, driven: false },
    { id: 'rear_left', x: -14.5, y: 17.5, steers: false, driven: true },
    { id: 'rear_right', x: 14.5, y: 17.5, steers: false, driven: true },
  ],
  mounts: [
    mount('front_center', ['FRONT'], 0, -22, 20, 14),
    mount('roof_mid', ['ROOF'], 0, 1, 18, 18, 3),
    mount('rear_center', ['REAR'], 0, 24, 20, 12),
    mount('rear_utility', ['UTILITY'], -7, 16, 12, 12),
    mount('side_utility', ['UTILITY'], 7, 16, 12, 12),
    mount('engine_bay', ['ENGINE'], 0, 20, 22, 16, 0),
  ],
  bodyHalfWidth: 17,
  bodyHalfLength: 29,
  recommendedLoadKg: 460,
  maxLoadKg: 730,
  baseIntegrity: 110,
  dragFactor: 1,
  yawFactor: 1,
  stabilityOffset: 0,
};

/** Shared fields so each benchmark chassis only states what makes it different. */
function chassis(
  def: Omit<
    ChassisDefinition,
    'category' | 'footprint' | 'compatibleMounts' | 'spriteKey' | 'modifiers'
  >,
): ChassisDefinition {
  return {
    ...def,
    category: 'chassis',
    footprint: { w: def.bodyHalfWidth * 2, h: def.bodyHalfLength * 2 },
    compatibleMounts: [],
    spriteKey: def.id,
    modifiers: {},
  };
}

export const CHASSIS_ARROW = chassis({
  id: 'chassis_arrow',
  displayName: 'Arrow',
  price: 180,
  massKg: 230,
  soundKey: 'chassis_light',
  description: 'A narrow wedge that slips through the air.',
  drawback: 'Only four accessory mounts.',
  wheelCount: 4,
  wheelAnchors: [
    { id: 'front_left', x: -11.5, y: -14, steers: true, driven: false },
    { id: 'front_right', x: 11.5, y: -14, steers: true, driven: false },
    { id: 'rear_left', x: -13, y: 19, steers: false, driven: true },
    { id: 'rear_right', x: 13, y: 19, steers: false, driven: true },
  ],
  mounts: [
    mount('front_center', ['FRONT'], 0, -20, 12, 14),
    mount('roof_mid', ['ROOF'], 0, 2, 12, 14, 2),
    mount('roof_rear', ['ROOF'], 0, 14, 10, 10, 2),
    mount('rear_center', ['REAR'], 0, 27, 18, 10),
    mount('engine_bay', ['ENGINE'], 0, 20, 20, 14, 0),
  ],
  bodyHalfWidth: 14,
  bodyHalfLength: 31,
  recommendedLoadKg: 420,
  maxLoadKg: 680,
  baseIntegrity: 100,
  dragFactor: 0.84,
  yawFactor: 1,
  stabilityOffset: 0,
});

export const CHASSIS_TURTLE = chassis({
  id: 'chassis_turtle',
  displayName: 'Turtle',
  price: 215,
  massKg: 460,
  soundKey: 'chassis_heavy',
  description: 'An armored shell that shrugs off hits.',
  drawback: 'Heavy, and slow to change direction.',
  wheelCount: 4,
  wheelAnchors: [
    { id: 'front_left', x: -15.5, y: -19, steers: true, driven: false },
    { id: 'front_right', x: 15.5, y: -19, steers: true, driven: false },
    { id: 'rear_left', x: -15.5, y: 19.5, steers: false, driven: true },
    { id: 'rear_right', x: 15.5, y: 19.5, steers: false, driven: true },
  ],
  mounts: [
    mount('front_center', ['FRONT'], 0, -24, 22, 12),
    mount('rear_center', ['REAR'], 0, 26, 22, 10),
    mount('left_mid', ['LEFT', 'ARMOR'], -16, 0, 10, 22),
    mount('right_mid', ['RIGHT', 'ARMOR'], 16, 0, 10, 22),
    mount('roof_front', ['ROOF'], 0, -10, 16, 12, 2),
    mount('roof_mid', ['ROOF'], 0, 2, 18, 18, 3),
    mount('roof_rear', ['ROOF'], 0, 13, 16, 10, 2),
    mount('engine_bay', ['ENGINE'], 0, 21, 22, 14, 0),
  ],
  bodyHalfWidth: 21,
  bodyHalfLength: 31,
  recommendedLoadKg: 720,
  maxLoadKg: 1050,
  baseIntegrity: 149,
  dragFactor: 1.08,
  yawFactor: 0.88,
  stabilityOffset: 6,
});

export const CHASSIS_SPIDER = chassis({
  id: 'chassis_spider',
  displayName: 'Spider',
  price: 235,
  massKg: 420,
  soundKey: 'chassis_heavy',
  description: 'Six wheels on long arms. Very hard to tip.',
  drawback: 'Wide, and six wheels cost more.',
  wheelCount: 6,
  wheelAnchors: [
    { id: 'front_left', x: -22.5, y: -24, steers: true, driven: false },
    { id: 'front_right', x: 22.5, y: -24, steers: true, driven: false },
    { id: 'mid_left', x: -24.5, y: 0, steers: false, driven: true },
    { id: 'mid_right', x: 24.5, y: 0, steers: false, driven: true },
    { id: 'rear_left', x: -22.5, y: 24, steers: false, driven: true },
    { id: 'rear_right', x: 22.5, y: 24, steers: false, driven: true },
  ],
  mounts: [
    mount('left_front', ['LEFT'], -15, -12, 12, 14),
    mount('left_rear', ['LEFT'], -15, 12, 12, 14),
    mount('right_front', ['RIGHT'], 15, -12, 12, 14),
    mount('right_rear', ['RIGHT'], 15, 12, 12, 14),
    mount('roof_front', ['ROOF'], 0, -20, 14, 12, 2),
    mount('roof_mid', ['ROOF'], 0, -2, 12, 14, 2),
    mount('utility_left', ['UTILITY'], -5, 14, 10, 10),
    mount('utility_right', ['UTILITY'], 5, 14, 10, 10),
    mount('engine_bay', ['ENGINE'], 0, 24, 20, 14, 0),
  ],
  bodyHalfWidth: 24,
  bodyHalfLength: 34,
  recommendedLoadKg: 760,
  maxLoadKg: 1150,
  baseIntegrity: 115,
  dragFactor: 1.1,
  yawFactor: 0.94,
  stabilityOffset: 18,
});

export const CHASSIS: Record<string, ChassisDefinition> = {
  [CHASSIS_BEETLE.id]: CHASSIS_BEETLE,
  [CHASSIS_ARROW.id]: CHASSIS_ARROW,
  [CHASSIS_TURTLE.id]: CHASSIS_TURTLE,
  [CHASSIS_SPIDER.id]: CHASSIS_SPIDER,
};
