import { createHash } from 'node:crypto';
import { mulberry32, sha256Bytes, sha256Hex, utf8Bytes } from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/** Published vectors: FIPS 180-4 examples and the NIST short-message suite. */
const VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
  [
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
  [
    'The quick brown fox jumps over the lazy dog',
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
  ],
];

describe('SHA-256', () => {
  it.each(VECTORS)('hashes %j to the published digest', (message, digest) => {
    expect(sha256Hex(message)).toBe(digest);
  });

  it('hashes one million "a" characters to the published digest', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with the platform implementation at every padding boundary', () => {
    for (let length = 0; length <= 200; length++) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(
        createHash('sha256').update(text).digest('hex'),
      );
    }
  });

  it('agrees with the platform implementation on random bytes', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 100; i++) {
      const bytes = new Uint8Array(Math.floor(rng() * 700));
      for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(rng() * 256);
      expect(Buffer.from(sha256Bytes(bytes)).toString('hex')).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    }
  });

  it('encodes text as UTF-8 exactly as the platform does, surrogates included', () => {
    for (const text of [
      'Zürich',
      'señal',
      '日本語',
      'car \u{1F3CE} go',
      'lone \ud800 high',
      '\udc00 low',
    ]) {
      expect(Array.from(utf8Bytes(text))).toEqual(Array.from(new TextEncoder().encode(text)));
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});
