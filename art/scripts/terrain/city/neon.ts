import type { Canvas, Color, Stencil } from '../canvas.js';
import { F_EMISSIVE, stencil } from '../canvas.js';
import { drawText, textHeight, textWidth } from '../font.js';
import { PAL, TINT_CORAL, TINT_CYAN, TINT_GOLD, TINT_PURPLE } from './palette.js';
import { dropShadow } from './sprites.js';

/** Rooftop neon: original made-up names and abstract glyphs in the four accent colors. */

export type NeonColor = { c: Color; hi: Color; dim: Color; tint: number; hex: string };

export const NEON: readonly NeonColor[] = [
  { c: PAL.cyan, hi: PAL.cyanHi, dim: PAL.cyanDim, tint: TINT_CYAN, hex: '#46D5E6' },
  { c: PAL.coral, hi: PAL.coralHi, dim: PAL.coralDim, tint: TINT_CORAL, hex: '#F46B58' },
  { c: PAL.purple, hi: PAL.purpleHi, dim: PAL.purpleDim, tint: TINT_PURPLE, hex: '#B49AF2' },
  { c: PAL.gold, hi: PAL.goldHi, dim: PAL.goldDim, tint: TINT_GOLD, hex: '#F6C35B' },
];

export const SHOP_NAMES: readonly string[] = [
  'NOVA', 'KIBO', 'LUMA', 'ORBIT', 'VOLT', 'ECHO', 'PIXL', 'KOI', 'ZAP', 'DINER', 'SODA', 'BYTE', 'MOKA', 'RIFF',
  'TOFU', 'HALO', 'JUNO', 'NOODLE', 'OPAL', 'FIZZ', 'DOJO', 'TAXI', 'LOFT', 'YUZU', '24H', 'BAR', 'MIDORI', 'COMET',
];

export const GLYPHS: readonly Stencil[] = [
  // Lightning bolt.
  stencil(['......aaa', '.....aaa.', '....aaa..', '...aaaaaa', '.....aaa.', '....aaa..', '...aaa...', '..aa.....', '.aa......']),
  // Star.
  stencil(['.....a.....', '.....a.....', '....aaa....', 'aaaaabaaaaa', '.aaabbbaaa.', '..aabbbaa..', '..aaa.aaa..', '.aaa...aaa.', '.aa.....aa.']),
  // Heart.
  stencil(['.aaa..aaa.', 'aabaaaabaa', 'abbbaabbba', 'abbbbbbbba', '.abbbbbba.', '..abbbba..', '...abba...', '....aa....']),
  // Cocktail glass.
  stencil(['aaaaaaaaa', '.abbbbba.', '..abbba..', '...aba...', '....a....', '....a....', '....a....', '..aaaaa..']),
  // Noodle bowl with steam.
  stencil(['..b..b..b..', '.b..b..b...', '..b..b..b..', '...........', 'aaaaaaaaaaa', 'a.........a', '.a.......a.', '..aaaaaaa..', '...aaaaa...']),
  // Music note.
  stencil(['...aaaaaa', '...aaaaaa', '...a....a', '...a....a', '...a....a', '.bba..bba', 'bbba.bbba', '.bb...bb.']),
  // Diamond.
  stencil(['....a....', '...aba...', '..abbba..', '.abbabba.', 'abbaaabba', '.abbabba.', '..abbba..', '...aba...', '....a....']),
  // Arrow.
  stencil(['.....aa...', '......aa..', 'bbbbbbbaa.', 'bbbbbbbbaa', 'bbbbbbbaa.', '......aa..', '.....aa...']),
];

/** Tube lettering with a hot core at scale 2 and above. */
export function neonText(cv: Canvas, x: number, y: number, text: string, color: number, scale: number, on = true): void {
  const main = NEON[color]!;
  const prev = cv.curFlags;
  cv.curFlags = F_EMISSIVE;
  drawText(cv, x, y, text, on ? main.c : main.dim, 'micro', scale);
  if (on && scale >= 2) {
    const tw = textWidth(text, 'micro', scale);
    for (let yy = 0; yy < 5 * scale; yy += scale) {
      for (let xx = 0; xx < tw; xx += scale) {
        if (cv.get(x + xx, y + yy) === main.c && cv.alpha(x + xx, y + yy) === 255) cv.set(x + xx, y + yy, main.hi);
      }
    }
  }
  cv.curFlags = prev;
}

export type NeonSignSpec = {
  text: string;
  color: number;
  accent: number;
  scale: number;
  glyph: number;
};

export function neonSignSize(spec: NeonSignSpec): { w: number; h: number } {
  const tw = spec.text ? textWidth(spec.text, 'micro', spec.scale) : 0;
  const g = spec.glyph >= 0 ? GLYPHS[spec.glyph]! : null;
  const th = spec.text ? textHeight('micro', spec.scale) : 0;
  const inner = Math.max(th, g ? g.h : 0);
  return { w: tw + (g ? g.w + (tw ? 3 : 0) : 0) + 8, h: inner + 6 };
}

/**
 * Draws a sign board with glowing tubes. `litMask` selects which characters are powered (bit
 * per character, bit 31 for the glyph); unpowered tubes show their dim glass color.
 */
export function drawNeonSign(cv: Canvas, x: number, y: number, spec: NeonSignSpec, litMask = 0xffffffff, shadow = true): void {
  const { w, h } = neonSignSize(spec);
  const main = NEON[spec.color]!;
  const acc = NEON[spec.accent]!;
  const prev = cv.curFlags;
  cv.curFlags = 0;
  if (shadow) dropShadow(cv, x, y, w, h, 2);
  cv.rect(x, y, w, h, PAL.ink);
  cv.frame(x, y, w, h, PAL.steelDark);
  cv.hline(x, y, w, PAL.steel);
  cv.curFlags = F_EMISSIVE;
  // Accent tube frame, broken at the corners like real bent glass.
  const frameOn = (litMask & 0x40000000) !== 0;
  const fc = frameOn ? acc.dim : PAL.steelDark;
  cv.hline(x + 3, y + 1, w - 6, fc);
  cv.hline(x + 3, y + h - 2, w - 6, fc);
  let cx = x + 4;
  const g = spec.glyph >= 0 ? GLYPHS[spec.glyph]! : null;
  if (g) {
    const on = (litMask & 0x80000000) !== 0;
    cv.stamp(cx, y + ((h - g.h) >> 1), g, { a: on ? acc.c : acc.dim, b: on ? acc.hi : acc.dim });
    cx += g.w + 3;
  }
  if (spec.text) {
    const ty = y + ((h - textHeight('micro', spec.scale)) >> 1);
    let i = 0;
    for (const ch of spec.text) {
      const on = (litMask & (1 << i)) !== 0;
      drawText(cv, cx, ty, ch, on ? main.c : main.dim, 'micro', spec.scale);
      if (on && spec.scale >= 2) {
        // Hot core on the upper-left of each tube stroke.
        const cw = textWidth(ch, 'micro', spec.scale);
        for (let yy = 0; yy < 5 * spec.scale; yy += spec.scale) {
          for (let xx = 0; xx < cw; xx += spec.scale) {
            if (cv.get(cx + xx, ty + yy) === main.c) cv.set(cx + xx, ty + yy, main.hi);
          }
        }
      }
      cx += textWidth(ch, 'micro', spec.scale) + spec.scale;
      i++;
    }
  }
  cv.curFlags = prev;
}
