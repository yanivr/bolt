import type { Canvas, Color } from './canvas.js';

/**
 * Two original pixel fonts for painted signage: a 3x5 micro face for rooftop neon and a chunky
 * 5x7 face for banners. Glyph rows are bit strings, most significant bit on the left.
 */

const MICRO: Record<string, readonly string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '110', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '110', '101', '010'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['010', '101', '010', '101', '010'],
  '9': ['010', '101', '011', '001', '110'],
  '!': ['010', '010', '010', '000', '010'],
  '-': ['000', '000', '111', '000', '000'],
  '>': ['100', '010', '001', '010', '100'],
  '<': ['001', '010', '100', '010', '001'],
  ' ': ['000', '000', '000', '000', '000'],
};

const CHUNKY: Record<string, readonly string[]> = {
  A: ['01110', '11011', '11011', '11111', '11011', '11011', '11011'],
  B: ['11110', '11011', '11011', '11110', '11011', '11011', '11110'],
  E: ['11111', '11000', '11000', '11110', '11000', '11000', '11111'],
  I: ['1111', '0110', '0110', '0110', '0110', '0110', '1111'],
  L: ['11000', '11000', '11000', '11000', '11000', '11000', '11111'],
  N: ['11011', '11011', '11111', '11111', '11111', '11011', '11011'],
  O: ['01110', '11011', '11011', '11011', '11011', '11011', '01110'],
  R: ['11110', '11011', '11011', '11110', '11110', '11011', '11011'],
  S: ['01111', '11000', '11000', '01110', '00011', '00011', '11110'],
  T: ['111111', '001100', '001100', '001100', '001100', '001100', '001100'],
  V: ['11011', '11011', '11011', '11011', '11011', '01110', '00100'],
  Y: ['110011', '110011', '011110', '001100', '001100', '001100', '001100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

export type FontId = 'micro' | 'chunky';

function glyphs(font: FontId): Record<string, readonly string[]> {
  return font === 'micro' ? MICRO : CHUNKY;
}

export function textWidth(text: string, font: FontId, scale = 1, spacing = 1): number {
  const set = glyphs(font);
  let w = 0;
  for (const ch of text) {
    const g = set[ch] ?? set[' ']!;
    w += (g[0]!.length + spacing) * scale;
  }
  return Math.max(0, w - spacing * scale);
}

export function textHeight(font: FontId, scale = 1): number {
  return (font === 'micro' ? 5 : 7) * scale;
}

/**
 * Draws text. `rot` is in quarter turns counter-clockwise: 0 reads left to right, 1 reads
 * bottom to top (for banners that span a road running east-west).
 */
export function drawText(
  cv: Canvas,
  x: number,
  y: number,
  text: string,
  color: Color,
  font: FontId = 'micro',
  scale = 1,
  rot: 0 | 1 = 0,
  spacing = 1,
): void {
  const set = glyphs(font);
  let cursor = 0;
  for (const ch of text) {
    const g = set[ch] ?? set[' ']!;
    const gw = g[0]!.length;
    for (let r = 0; r < g.length; r++) {
      const row = g[r]!;
      for (let c = 0; c < gw; c++) {
        if (row[c] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const u = cursor + c * scale + sx;
            const v = r * scale + sy;
            if (rot === 0) cv.set(x + u, y + v, color);
            else cv.set(x + v, y - u, color);
          }
        }
      }
    }
    cursor += (gw + spacing) * scale;
  }
}
