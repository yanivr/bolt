import type { Material } from '../lib/model.js';
import { ramp } from '../lib/model.js';

/**
 * Vehicle material ramps. Shadows shift toward blue-violet and highlights toward warm, so
 * parts read as painted metal under a night sky rather than as flat fills. The `paint` ramp is
 * the key that the runtime swaps for the player's chosen paint, so no other material may reuse
 * any of its exact colors.
 */

export const PAINT_KEY = ['#5c1230', '#941f34', '#cf3440', '#f0604c', '#ffb08a'] as const;
export const PAINT_OUTLINE_KEY = '#2b0a1f';

export const PAINTS: Record<string, { displayName: string; ramp: string[]; outline: string }> = {
  paint_signal: { displayName: 'Signal Red', ramp: [...PAINT_KEY], outline: PAINT_OUTLINE_KEY },
  paint_cobalt: {
    displayName: 'Cobalt',
    ramp: ['#16235e', '#22409a', '#2f69d2', '#52a0ee', '#a8e0ff'],
    outline: '#0b1233',
  },
  paint_mint: {
    displayName: 'Mint',
    ramp: ['#0f4a4c', '#178a70', '#3cc79a', '#7ae8b4', '#d6ffd9'],
    outline: '#082a30',
  },
  paint_sunflare: {
    displayName: 'Sunflare',
    ramp: ['#6e3212', '#b3611a', '#e89b2a', '#f8cc5c', '#fff3b0'],
    outline: '#3a160c',
  },
};

export const CAR_MATERIALS: Record<string, Material> = {
  paint: ramp(PAINT_KEY[0], PAINT_KEY[1], PAINT_KEY[2], PAINT_KEY[3], PAINT_KEY[4], PAINT_OUTLINE_KEY),
  ivory: ramp('#6e6684', '#aaa09f', '#ddd3bf', '#f5eed9', '#ffffff', '#3a3550'),
  glass: ramp('#0a1324', '#11233c', '#1a3a5e', '#2e6c94', '#93dcee', '#070c18'),
  steel: ramp('#1c2436', '#35425c', '#5d6d8a', '#95a5bf', '#dbe6f5', '#0e1320'),
  steelDark: ramp('#0c101a', '#161d2c', '#242e42', '#3a4862', '#5d6d8a', '#070a12'),
  chassis: ramp('#080b13', '#0f1420', '#1a2132', '#28324a', '#3a4862', '#05070c'),
  rubber: ramp('#0a0d16', '#141926', '#20283a', '#39445c', '#5d6a86', '#04050a'),
  lampOff: ramp('#6a5f44', '#a89a66', '#e0d69c', '#fff4bd', '#ffffff', '#3a3324'),
  lampOn: ramp('#fff4bd', '#fff4bd', '#fffbe6', '#ffffff', '#ffffff', '#f6c35b', { flat: true }),
  tailOff: ramp('#2c0a14', '#4c101c', '#7c1826', '#ab222e', '#d83f49', '#1a060c'),
  tailOn: ramp('#ff5a4a', '#ff5a4a', '#ff7a5c', '#ffb09a', '#ffffff', '#d83f49', { flat: true }),
  copper: ramp('#3a1c14', '#6b3320', '#a5562e', '#d8884a', '#ffc98a', '#1f0e0a'),
  bore: ramp('#030407', '#05070c', '#080b13', '#0f1420', '#1a2132', '#030407', { flat: true }),
};
