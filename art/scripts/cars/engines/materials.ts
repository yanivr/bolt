import type { Material } from '../../lib/model.js';
import { ramp } from '../../lib/model.js';
import { CAR_MATERIALS } from '../materials.js';

/**
 * Drivetrain materials: everything the engines and wheel kits need beyond the shared vehicle
 * ramps. Shadows lean blue-violet and highlights warm, like the bodywork. None of these may
 * reuse an exact color of the paint key ramp, because the runtime repaints by exact match.
 */
export const DRIVE_MATERIALS: Record<string, Material> = {
  ...CAR_MATERIALS,
  // Metals.
  chrome: ramp('#232b40', '#4a5874', '#8493b0', '#c3cfe2', '#ffffff', '#0e1320'),
  // Lit variants for tall parts: an upright wall mostly faces away from the key light, so
  // stacks, blowers and risers take a brighter step to stay readable against a dark road.
  chromeLit: ramp('#232b40', '#4a5874', '#8493b0', '#c3cfe2', '#ffffff', '#0e1320', { bias: 1 }),
  steelLit: ramp('#1c2436', '#35425c', '#5d6d8a', '#95a5bf', '#dbe6f5', '#0e1320', { bias: 1 }),
  brassLit: ramp('#3b2812', '#765218', '#b5882a', '#e2bf52', '#fff2a8', '#1f140a', { bias: 1 }),
  // South-facing walls always fall in deep shadow; wheel hubs and road wheels are seen only as
  // such walls, so they take two steps back.
  steelWall: ramp('#1c2436', '#35425c', '#5d6d8a', '#95a5bf', '#dbe6f5', '#0e1320', { bias: 2 }),
  chromeWall: ramp('#232b40', '#4a5874', '#8493b0', '#c3cfe2', '#ffffff', '#0e1320', { bias: 2 }),
  iron: ramp('#17141c', '#2b2731', '#47424d', '#6c656f', '#9a9194', '#0a090d'),
  brass: ramp('#3b2812', '#765218', '#b5882a', '#e2bf52', '#fff2a8', '#1f140a'),
  // Heat: a glowing turbine side, a nozzle throat, a furnace window.
  hot: ramp('#8a2a12', '#d04a16', '#ff7a1c', '#ffb53c', '#fff0a0', '#4a160c'),
  hotCore: ramp('#ffb53c', '#ffb53c', '#ffd75a', '#fff0a0', '#ffffff', '#d04a16', { flat: true }),
  ember: ramp('#d04a16', '#d04a16', '#ff8a2c', '#ffd75a', '#ffffff', '#6a200e', { flat: true }),
  // Electrics.
  cable: ramp('#6e2c0a', '#b24c0c', '#f0851a', '#ffb244', '#ffe0a0', '#3a160a'),
  cyan: ramp('#0a3442', '#0f6a78', '#1fb4be', '#6cefe4', '#d8fffb', '#061e28'),
  cyanGlow: ramp('#1fb4be', '#1fb4be', '#6cefe4', '#d8fffb', '#ffffff', '#0f6a78', { flat: true }),
  green: ramp('#0f3326', '#1b6440', '#36a25a', '#78d67a', '#c8f7ac', '#082018'),
  // Painted casings and markings.
  olive: ramp('#1a2114', '#303c1e', '#4e5f2c', '#788c42', '#a9ba68', '#0e130a'),
  hazard: ramp('#5c4208', '#a5780c', '#e0ae18', '#ffd648', '#fff2a6', '#33240a'),
  violet: ramp('#22104a', '#44208a', '#7438cf', '#a674ff', '#dcc8ff', '#120828'),
  pulse: ramp('#ff4fa0', '#ff4fa0', '#ff86c2', '#ffd0e6', '#ffffff', '#a11c62', { flat: true }),
  markRed: ramp('#5e0f2e', '#a01a3e', '#e23358', '#ff6f80', '#ffc0c0', '#30081a'),
  frost: ramp('#4c5c7c', '#7f93b4', '#b2c6de', '#deecfb', '#ffffff', '#2a3550'),
  // Rubber compounds and track metal: all darker than bodywork, lighter than the road shadow.
  rubberHard: ramp('#0e121c', '#1b2233', '#2c374e', '#48566f', '#6f7f9c', '#06080e'),
  rubberSoft: ramp('#100c16', '#1c1626', '#2c2238', '#48395a', '#6e5c86', '#07050b'),
  trackSteel: ramp('#11151f', '#222a3a', '#3a455a', '#5a6880', '#8795ad', '#080b12'),
};
