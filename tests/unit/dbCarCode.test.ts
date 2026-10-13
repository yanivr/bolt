import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CAR_CODE_ALPHABET,
  CAR_CODE_EXAMPLE,
  CAR_CODE_PATTERN,
  carCodeChecksum,
  carCodeLink,
  carCodeSymbolsValid,
  formatCarCode,
  generateCarCode,
  isCanonicalCarCode,
  normalizeCarCode,
  previewCarCode,
  readCarCode,
} from '@bolt/shared';

/** Section 15.6 short codes: format, checksum and the forgiving reader of Section 5.7. */

const random = (n: number) => new Uint8Array(randomBytes(n));
const symbolsOf = (code: string) => code.slice(4, 10) + code.slice(11);

/** A deterministic stream of codes, so a failure can be reproduced. */
function seeded(seed: number): (n: number) => Uint8Array {
  let state = seed >>> 0 || 1;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      out[i] = state & 0xff;
    }
    return out;
  };
}

describe('the alphabet', () => {
  it('is Crockford Base32: 32 symbols without I, L, O or U', () => {
    expect(CAR_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CAR_CODE_ALPHABET).size).toBe(32);
    for (const ch of 'ILOU') expect(CAR_CODE_ALPHABET).not.toContain(ch);
  });
});

describe('generated codes', () => {
  const codes = Array.from({ length: 5000 }, (_, i) => generateCarCode(seeded(i + 1)));

  it('are all in the exact CAR-XXXXXX-XX format and validate', () => {
    for (const code of codes) {
      expect(code).toMatch(CAR_CODE_PATTERN);
      expect(isCanonicalCarCode(code)).toBe(true);
      expect(readCarCode(code)).toEqual({ ok: true, code });
      expect(carCodeChecksum(symbolsOf(code).slice(0, 6))).toBe(symbolsOf(code).slice(6));
    }
  });

  it('use every symbol in every random position (the low five bits of a byte are uniform)', () => {
    for (let position = 0; position < 6; position++) {
      const seen = new Set(codes.map((c) => symbolsOf(c)[position]));
      expect(seen.size, `position ${position}`).toBe(32);
    }
  });

  it('come from the random source given, and from crypto by default in the server', () => {
    const fixed = generateCarCode(() => new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(fixed.slice(0, 10)).toBe('CAR-012345');
    expect(generateCarCode(random)).not.toBe(generateCarCode(random));
  });

  it('refuse a short random source', () => {
    expect(() => generateCarCode(() => new Uint8Array(3))).toThrow();
  });
});

describe('the checksum', () => {
  const sample = Array.from({ length: 600 }, (_, i) =>
    symbolsOf(generateCarCode(seeded(9000 + i))),
  );

  it('rejects every single-character substitution', () => {
    let tried = 0;
    for (const symbols of sample) {
      for (let i = 0; i < 8; i++) {
        for (const ch of CAR_CODE_ALPHABET) {
          if (ch === symbols[i]) continue;
          tried++;
          const typo = symbols.slice(0, i) + ch + symbols.slice(i + 1);
          expect(carCodeSymbolsValid(typo), `${symbols} -> ${typo}`).toBe(false);
        }
      }
    }
    expect(tried).toBe(600 * 8 * 31);
  });

  it('rejects every swap of two different characters, adjacent or not', () => {
    for (const symbols of sample) {
      for (let i = 0; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) {
          if (symbols[i] === symbols[j]) continue;
          const swapped = [...symbols];
          [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
          expect(carCodeSymbolsValid(swapped.join('')), `${symbols} swap ${i},${j}`).toBe(false);
        }
      }
    }
  });

  it('rejects any two wrong characters (minimum distance three)', () => {
    for (const symbols of sample.slice(0, 40)) {
      for (let i = 0; i < 8; i++)
        for (let j = i + 1; j < 8; j++)
          for (const a of CAR_CODE_ALPHABET.slice(0, 8))
            for (const b of CAR_CODE_ALPHABET.slice(8, 16)) {
              if (a === symbols[i] || b === symbols[j]) continue;
              const chars = [...symbols];
              chars[i] = a;
              chars[j] = b;
              expect(carCodeSymbolsValid(chars.join(''))).toBe(false);
            }
    }
  });

  it('lets about one random string in 1,024 through, so most junk never reaches the server', () => {
    let passed = 0;
    const draws = 200_000;
    const source = seeded(424242);
    for (let n = 0; n < draws; n++) {
      const bytes = source(8);
      let s = '';
      for (const b of bytes) s += CAR_CODE_ALPHABET[b & 31];
      if (carCodeSymbolsValid(s)) passed++;
    }
    expect(passed / draws).toBeGreaterThan(0.0007);
    expect(passed / draws).toBeLessThan(0.0013);
  });

  it('does not accept all zeros or the example from the specification', () => {
    expect(carCodeSymbolsValid('00000000')).toBe(false);
    expect(readCarCode(CAR_CODE_EXAMPLE)).toMatchObject({ ok: false, reason: 'checksum' });
  });
});

describe('reading what a player types or pastes (Section 5.7)', () => {
  const code = generateCarCode(seeded(77));
  const symbols = symbolsOf(code);

  it('ignores case, spaces, dashes and the prefix', () => {
    for (const typed of [
      code,
      code.toLowerCase(),
      symbols,
      symbols.toLowerCase(),
      `  ${symbols.slice(0, 3)} ${symbols.slice(3, 6)} ${symbols.slice(6)}  `,
      `car ${symbols}`,
      `CAR_${symbols.slice(0, 6)}.${symbols.slice(6)}`,
      `CAR–${symbols.slice(0, 6)}—${symbols.slice(6)}`,
      `CAR${symbols}`,
    ])
      expect(readCarCode(typed), typed).toEqual({ ok: true, code });
  });

  it('reads whole links', () => {
    for (const link of [
      carCodeLink('https://bolt.example/', code),
      `http://192.168.1.4:2567/car/${symbols.toLowerCase()}?ref=x`,
      `bolt.example/?car=${encodeURIComponent(code)}`,
      `Race my car! ${carCodeLink('https://bolt.example', code)} see you`,
    ])
      expect(readCarCode(link), link).toEqual({ ok: true, code });
  });

  it('reads I and L as 1 and O as 0, per Crockford', () => {
    const withOne = symbolsOf(
      [...Array(4000).keys()]
        .map((i) => generateCarCode(seeded(500 + i)))
        .find((c) => symbolsOf(c).includes('1') && symbolsOf(c).includes('0'))!,
    );
    const typed = withOne.replace('1', 'l').replace('0', 'O');
    expect(readCarCode(typed)).toEqual({ ok: true, code: formatCarCode(withOne) });
    expect(readCarCode(withOne.replace('1', 'I'))).toEqual({
      ok: true,
      code: formatCarCode(withOne),
    });
  });

  it('says what is wrong while typing', () => {
    expect(readCarCode('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(readCarCode('   ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(readCarCode('CAR')).toMatchObject({ ok: false, reason: 'incomplete', symbols: '' });
    expect(readCarCode('CAR-')).toMatchObject({ ok: false, reason: 'incomplete', symbols: '' });
    expect(readCarCode(`CAR-${symbols.slice(0, 4)}`)).toMatchObject({
      ok: false,
      reason: 'incomplete',
      symbols: symbols.slice(0, 4),
    });
    expect(readCarCode(`${symbols}7`)).toMatchObject({ ok: false, reason: 'length' });
    expect(readCarCode(`${symbols.slice(0, 7)}U`)).toMatchObject({
      ok: false,
      reason: 'characters',
    });
    expect(readCarCode(`${symbols.slice(0, 7)}!`)).toMatchObject({
      ok: false,
      reason: 'characters',
    });
    expect(readCarCode('<script>alert(1)</script>')).toMatchObject({ ok: false });
  });

  it('reports a typo as a checksum failure, never as a code', () => {
    const typo = symbols.slice(0, 2) + (symbols[2] === 'Z' ? 'Y' : 'Z') + symbols.slice(3);
    expect(readCarCode(typo)).toMatchObject({ ok: false, reason: 'checksum' });
    expect(normalizeCarCode(typo)).toBeNull();
  });

  it('bounds the work on a huge paste', () => {
    expect(readCarCode('A'.repeat(1_000_000))).toMatchObject({ ok: false });
  });

  it('previews a fragment the way the code is printed', () => {
    expect(previewCarCode('7K9')).toBe('CAR-7K9');
    expect(previewCarCode('7K92QZR')).toBe('CAR-7K92QZ-R');
  });

  it('accepts only the canonical form as canonical', () => {
    expect(isCanonicalCarCode(code)).toBe(true);
    expect(isCanonicalCarCode(code.toLowerCase())).toBe(false);
    expect(isCanonicalCarCode(symbols)).toBe(false);
    expect(isCanonicalCarCode(42)).toBe(false);
  });
});
