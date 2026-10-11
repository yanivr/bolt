import type { Material } from '../../lib/model.js';
import { ramp } from '../../lib/model.js';
import { CAR_MATERIALS } from '../materials.js';

/**
 * Extra ramps used by the sixteen later chassis. None of them reuses a color of the paint key,
 * so the runtime paint swap can never touch them.
 */
export const CHASSIS_EXTRA_MATERIALS: Record<string, Material> = {
  /** Varnished timber: the Wagon's side panels. */
  wood: ramp('#3b2318', '#5f3b22', '#8c5c32', '#b8854c', '#e0b57c', '#21130d'),
  /** Coil springs and hydraulic rams. */
  spring: ramp('#57420f', '#8c6b13', '#c79f1b', '#efcd3d', '#fff3a2', '#2d2108'),
  /** Sheathed wiring looms. */
  wire: ramp('#0d3943', '#136870', '#1fa19e', '#60d5c3', '#c5fff1', '#062129'),
  /** Seat leather and grips. */
  seat: ramp('#2b1d23', '#4b3031', '#765240', '#a27c5a', '#d0b086', '#170f14'),
};

export const CHASSIS_MATERIALS: Record<string, Material> = {
  ...CAR_MATERIALS,
  ...CHASSIS_EXTRA_MATERIALS,
};
