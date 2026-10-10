import type { ChassisDefinition, MountPoint } from '@bolt/shared';

/**
 * Chassis layouts. Coordinates are chassis-local world pixels: front is negative Y, right is
 * positive X. Milestone A ships the Beetle; the remaining nineteen frames from Section 11.2
 * land in Milestone B with their mount tables.
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

export const CHASSIS: Record<string, ChassisDefinition> = {
  [CHASSIS_BEETLE.id]: CHASSIS_BEETLE,
};
