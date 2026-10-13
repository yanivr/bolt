/**
 * Short car codes (Section 15.6): `CAR-XXXXXX-XX`, six random Crockford Base32 symbols and two
 * check symbols. Shared by the server, which issues them, and the client, which checks a typed
 * code before it ever asks the server.
 *
 * The check symbols make the eight symbols a codeword of a Reed-Solomon code over GF(32) with
 * two parity symbols, shifted by a fixed constant so that a run of zeros is not a valid code.
 * Its minimum distance is 3, so every error that touches one or two symbols is detected: any
 * single wrong character, any swap of two characters (adjacent or not), any two wrong
 * characters. A random string of eight valid symbols passes with probability 1 in 1,024.
 *
 * The checksum catches mistypes; it is not a security feature. Anyone can compute it. What
 * keeps a code from being guessed is the size of the random part (32^6, over a billion) against
 * the number of codes issued, and the server's rate limits on lookups.
 */

/** Crockford Base32: digits and letters without I, L, O and U. */
export const CAR_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CAR_CODE_PREFIX = 'CAR';
export const CAR_CODE_RANDOM_LENGTH = 6;
export const CAR_CODE_CHECK_LENGTH = 2;
/** Random plus check symbols. */
export const CAR_CODE_SYMBOLS = CAR_CODE_RANDOM_LENGTH + CAR_CODE_CHECK_LENGTH;
/** The canonical printed form, for example `CAR-7K92QZ-R4`. */
export const CAR_CODE_PATTERN = /^CAR-[0-9A-HJKMNP-TV-Z]{6}-[0-9A-HJKMNP-TV-Z]{2}$/;
/** An example in the right shape. It does not pass the checksum. */
export const CAR_CODE_EXAMPLE = 'CAR-7K92QZ-R4';

// --- GF(32) arithmetic, primitive polynomial x^5 + x^2 + 1 -------------------------------------

const FIELD = 32;
const ORDER = FIELD - 1;
const EXP: number[] = new Array<number>(ORDER * 2);
const LOG: number[] = new Array<number>(FIELD).fill(-1);
{
  let x = 1;
  for (let i = 0; i < ORDER; i++) {
    EXP[i] = x;
    EXP[i + ORDER] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & FIELD) x ^= 0b100101;
  }
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function div(a: number, b: number): number {
  if (b === 0) throw new Error('division by zero in GF(32)');
  if (a === 0) return 0;
  return EXP[(LOG[a]! - LOG[b]! + ORDER) % ORDER]!;
}

/** alpha^k for any whole k. */
function power(k: number): number {
  return EXP[((k % ORDER) + ORDER) % ORDER]!;
}

/**
 * The two parity conditions: sum of v_i * alpha^(i*j) for j = 1 and 2 must equal these
 * constants. They are taken from the prefix, so the code space is a coset that excludes the
 * all-zero word and anything else trivially guessable.
 */
const TARGET: readonly [number, number] = [
  CAR_CODE_ALPHABET.indexOf('C') ^ CAR_CODE_ALPHABET.indexOf('A'),
  CAR_CODE_ALPHABET.indexOf('R'),
];

function syndromes(values: readonly number[]): [number, number] {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < values.length; i++) {
    s1 ^= mul(values[i]!, power(i));
    s2 ^= mul(values[i]!, power(2 * i));
  }
  return [s1, s2];
}

/**
 * The two check symbols for six data symbols: solves
 *   c6 a^6  + c7 a^7  = T1 - S1(data)
 *   c6 a^12 + c7 a^14 = T2 - S2(data)
 * (subtraction is XOR in characteristic 2) by Cramer's rule.
 */
function checkValues(data: readonly number[]): [number, number] {
  const [s1, s2] = syndromes(data);
  const r1 = TARGET[0] ^ s1;
  const r2 = TARGET[1] ^ s2;
  const a = power(6);
  const b = power(7);
  const c = power(12);
  const d = power(14);
  const det = mul(a, d) ^ mul(b, c);
  const c6 = div(mul(r1, d) ^ mul(b, r2), det);
  const c7 = div(mul(a, r2) ^ mul(r1, c), det);
  return [c6, c7];
}

function valuesOf(symbols: string): number[] | null {
  const values: number[] = [];
  for (const ch of symbols) {
    const v = CAR_CODE_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  return values;
}

/** The two check characters for six random characters of the alphabet. */
export function carCodeChecksum(random: string): string {
  const values = valuesOf(random);
  if (!values || values.length !== CAR_CODE_RANDOM_LENGTH)
    throw new Error('A car code has six random characters from the Crockford alphabet.');
  return checkValues(values)
    .map((v) => CAR_CODE_ALPHABET[v]!)
    .join('');
}

/** True when eight symbols (no prefix, no dashes) form a valid code. */
export function carCodeSymbolsValid(symbols: string): boolean {
  if (symbols.length !== CAR_CODE_SYMBOLS) return false;
  const values = valuesOf(symbols);
  if (!values) return false;
  const [s1, s2] = syndromes(values);
  return s1 === TARGET[0] && s2 === TARGET[1];
}

/** `7K92QZR4` as `CAR-7K92QZ-R4`. */
export function formatCarCode(symbols: string): string {
  return `${CAR_CODE_PREFIX}-${symbols.slice(0, CAR_CODE_RANDOM_LENGTH)}-${symbols.slice(CAR_CODE_RANDOM_LENGTH)}`;
}

/** Fills a buffer with random bytes: `crypto.getRandomValues` or Node's `randomBytes`. */
export type RandomBytes = (length: number) => Uint8Array;

/**
 * A fresh code from a cryptographic random source. Each byte gives one symbol through its low
 * five bits, which is exactly uniform because 256 is a multiple of 32.
 */
export function generateCarCode(random: RandomBytes): string {
  const bytes = random(CAR_CODE_RANDOM_LENGTH);
  if (bytes.length < CAR_CODE_RANDOM_LENGTH) throw new Error('Not enough random bytes.');
  let symbols = '';
  for (let i = 0; i < CAR_CODE_RANDOM_LENGTH; i++) symbols += CAR_CODE_ALPHABET[bytes[i]! & 31];
  return formatCarCode(symbols + carCodeChecksum(symbols));
}

// --- Reading what a player typed or pasted ----------------------------------------------------

export type CarCodeReading =
  | { ok: true; code: string }
  | {
      ok: false;
      /**
       * `empty`: nothing typed. `incomplete`: fewer than eight symbols so far. `characters`:
       * something that is not in the alphabet (U, punctuation inside the code). `length`: too
       * many symbols. `checksum`: the right shape with a typo in it.
       */
      reason: 'empty' | 'incomplete' | 'characters' | 'length' | 'checksum';
      /** The symbols read so far, normalized, for showing back while typing. */
      symbols: string;
    };

/** Longest input looked at, so a pasted essay costs nothing. */
const MAX_INPUT = 512;
/** Layout characters a player may type or paste between symbols, including Unicode dashes. */
const SEPARATORS = /[\s\-_.‐-―]/g;
const PREFIX_WRITTEN = /^car(?:[\s\-_.‐-―]|$)/i;

/**
 * Turns anything a player might type or paste into a code: case-insensitive, spaces and dashes
 * optional, the `CAR` prefix optional, a whole link (`https://host/car/CAR-7K92QZ-R4`, or
 * `?car=...`) accepted. Crockford's reading rules apply: I and L are 1, O is 0. U is not in the
 * alphabet and is refused. Nothing here touches the network.
 */
export function readCarCode(input: string): CarCodeReading {
  let text = String(input ?? '')
    .slice(0, MAX_INPUT)
    .trim();
  // A link: take what follows /car/ or car=, up to the end of that path segment.
  const link = /(?:\/car\/|[?&#]car=)([^/?#&\s]*)/i.exec(text);
  if (link) {
    try {
      text = decodeURIComponent(link[1] ?? '');
    } catch {
      text = link[1] ?? '';
    }
  }
  // Only letters and digits carry meaning; spaces, dashes, dots and underscores are layout.
  const compact = text.replace(SEPARATORS, '').toUpperCase();
  // The prefix is recognised when it is written as one (`CAR-`, `car `, `CAR` alone) or when
  // there are more symbols than a code has without it. Eight symbols that happen to start with
  // C, A, R are a code without its prefix.
  const prefixed =
    PREFIX_WRITTEN.test(text) ||
    (compact.startsWith(CAR_CODE_PREFIX) && compact.length > CAR_CODE_SYMBOLS);
  const body = prefixed ? compact.slice(CAR_CODE_PREFIX.length) : compact;
  if (prefixed && body.length === 0) return { ok: false, reason: 'incomplete', symbols: '' };
  const symbols = body.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (symbols.length === 0) return { ok: false, reason: 'empty', symbols };
  if (!/^[0-9A-Z]+$/.test(symbols) || /U/.test(symbols))
    return { ok: false, reason: 'characters', symbols };
  if (symbols.length < CAR_CODE_SYMBOLS) return { ok: false, reason: 'incomplete', symbols };
  if (symbols.length > CAR_CODE_SYMBOLS) return { ok: false, reason: 'length', symbols };
  if (!carCodeSymbolsValid(symbols)) return { ok: false, reason: 'checksum', symbols };
  return { ok: true, code: formatCarCode(symbols) };
}

/** The canonical code, or null. For server parameters and stored values. */
export function normalizeCarCode(input: string): string | null {
  const reading = readCarCode(input);
  return reading.ok ? reading.code : null;
}

/** True only for a code already in the canonical printed form with a valid checksum. */
export function isCanonicalCarCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    CAR_CODE_PATTERN.test(value) &&
    carCodeSymbolsValid(value.slice(4, 10) + value.slice(11))
  );
}

/** What a typed fragment looks like so far, grouped as the code is printed: `CAR-7K9`. */
export function previewCarCode(symbols: string): string {
  const head = symbols.slice(0, CAR_CODE_RANDOM_LENGTH);
  const tail = symbols.slice(CAR_CODE_RANDOM_LENGTH, CAR_CODE_SYMBOLS);
  return `${CAR_CODE_PREFIX}-${head}${tail ? `-${tail}` : ''}`;
}

/** The share link for a code on a given origin, `https://example.com/car/CAR-7K92QZ-R4`. */
export function carCodeLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/car/${code}`;
}
