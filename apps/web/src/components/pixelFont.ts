/**
 * BOLT 5x7: the game's original pixel display face for short headlines and HUD numerals.
 * Each glyph is seven rows of five cells. Body copy never uses this; it stays in a readable
 * sans-serif at native resolution (Section 5.1).
 */
const G: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.####|#....|#....|#....|#....|#....|.####',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.####|#....|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|..##.|.#...|#....|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '#...#|#...#|#...#|#####|....#|....#|....#',
  '5': '#####|#....|#....|####.|....#|....#|####.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|..#..|..#..|..#..',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|....#|.###.',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|.##..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  "'": '..#..|..#..|.....|.....|.....|.....|.....',
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

const cache = new Map<string, string[]>();

export function glyphRows(char: string): string[] {
  const key = char.toUpperCase();
  let rows = cache.get(key);
  if (!rows) {
    rows = (G[key] ?? G['?']!).split('|');
    cache.set(key, rows);
  }
  return rows;
}

/**
 * Punctuation that may give up its empty columns in `tight` text, with the first column it
 * uses and how many: a clock or a score reads the same and is a third narrower. Digits and
 * letters always keep the full cell, so numbers never shift as they change.
 */
const TIGHT: Record<string, [start: number, width: number]> = {
  '.': [1, 2],
  ':': [1, 2],
  ' ': [0, 2],
};

/** The columns of a glyph that are drawn: all five, or fewer for tight punctuation. */
export function glyphSpan(char: string, tight: boolean): [start: number, width: number] {
  return (tight ? TIGHT[char] : undefined) ?? [0, GLYPH_WIDTH];
}

/** Pixel width of a string at scale 1, with one cell of tracking between glyphs. */
export function measurePixelText(text: string, tight = false): number {
  if (text.length === 0) return 0;
  if (!tight) return text.length * (GLYPH_WIDTH + 1) - 1;
  let width = -1;
  for (const char of text) width += glyphSpan(char, true)[1] + 1;
  return width;
}
