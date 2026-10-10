import type { EngineDefinition, TireDefinition } from '@bolt/shared';

/**
 * Engines and wheel kits available in Milestone A. The full 120-part catalog from Section 11
 * replaces these tables in Milestone B; prices, masses and force values here already match the
 * seed balance so nothing needs to be re-tuned when the rest arrives.
 */

export const ENGINE_FOUR_CYLINDER: EngineDefinition = {
  id: 'engine_four_cylinder',
  displayName: 'Four-Cylinder',
  category: 'engine',
  price: 140,
  massKg: 95,
  footprint: { w: 18, h: 14 },
  compatibleMounts: ['ENGINE'],
  spriteKey: 'engine_four_cylinder',
  soundKey: 'engine_inline4',
  description: 'Reliable pull at any speed.',
  drawback: 'Nothing special at the top end.',
  modifiers: {},
  forceIndex: 100,
  heatPerSecond: 8,
  powerDraw: 0,
  launchBoost: 0.5,
  topEndFactor: 1,
};

export const TIRES_STREET: TireDefinition = {
  id: 'tires_street',
  displayName: 'Street Tires',
  category: 'tires',
  price: 80,
  massKg: 48,
  footprint: { w: 8, h: 14 },
  compatibleMounts: ['WHEEL'],
  spriteKey: 'tires_street',
  soundKey: 'tires_street',
  description: 'Predictable grip on every paved road.',
  drawback: 'No specialty surface.',
  modifiers: {},
  grip: 1,
  surfaceGrip: {},
  wetGripFactor: 1,
  slipRecoveryFactor: 1,
};

export const ENGINES: Record<string, EngineDefinition> = {
  [ENGINE_FOUR_CYLINDER.id]: ENGINE_FOUR_CYLINDER,
};

export const TIRES: Record<string, TireDefinition> = {
  [TIRES_STREET.id]: TIRES_STREET,
};

export const PAINTS: Record<string, { id: string; displayName: string }> = {
  paint_signal: { id: 'paint_signal', displayName: 'Signal Red' },
  paint_cobalt: { id: 'paint_cobalt', displayName: 'Cobalt' },
  paint_mint: { id: 'paint_mint', displayName: 'Mint' },
  paint_sunflare: { id: 'paint_sunflare', displayName: 'Sunflare' },
};
