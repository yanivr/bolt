import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed anonymous guest tokens.
 *
 * Format: `v1.<guestId>.<expEpochSeconds>.<signature>` where the signature is the base64url
 * HMAC-SHA256 of everything before the last dot. The guest id is 128 random bits and carries
 * no personal data. Tokens are bearer credentials: they are never logged, and only a SHA-256
 * hash of one is ever stored.
 */

const TOKEN_VERSION = 'v1';
const GUEST_ID_BYTES = 16;
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const EXPIRY_PATTERN = /^[1-9][0-9]{0,11}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Matches the upper bound in the shared join schema, so oversize strings cost nothing. */
const MAX_TOKEN_LENGTH = 512;

export const MIN_SECRET_LENGTH = 16;

export type GuestTokenClaims = { guestId: string; expiresAtSeconds: number };

export type GuestTokenFailure = 'malformed' | 'bad_signature' | 'expired';

export type GuestTokenVerification =
  ({ ok: true } & GuestTokenClaims) | { ok: false; reason: GuestTokenFailure };

export type GuestTokenSigner = {
  /** Signs a token for the guest that expires at the given epoch second. */
  sign(guestId: string, expiresAtSeconds: number): string;
  verify(token: unknown, nowMs?: number): GuestTokenVerification;
};

export function generateGuestId(): string {
  return randomBytes(GUEST_ID_BYTES).toString('base64url');
}

export function isGuestId(value: unknown): value is string {
  return typeof value === 'string' && GUEST_ID_PATTERN.test(value);
}

/** One-way hash kept by the session store in place of the token itself. */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createGuestTokenSigner(secret: string): GuestTokenSigner {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `The guest token secret must be at least ${MIN_SECRET_LENGTH} characters long.`,
    );
  }
  const key = Buffer.from(secret, 'utf8');

  const signatureFor = (payload: string): string =>
    createHmac('sha256', key).update(payload, 'utf8').digest('base64url');

  return {
    sign(guestId, expiresAtSeconds) {
      if (!isGuestId(guestId)) throw new Error('Cannot sign a token for a malformed guest id.');
      if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
        throw new Error('Cannot sign a token with an invalid expiry.');
      }
      const payload = `${TOKEN_VERSION}.${guestId}.${expiresAtSeconds}`;
      return `${payload}.${signatureFor(payload)}`;
    },

    verify(token, nowMs = Date.now()) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return { ok: false, reason: 'malformed' };
      }
      const parts = token.split('.');
      if (parts.length !== 4) return { ok: false, reason: 'malformed' };
      const [version, guestId, expiry, signature] = parts as [string, string, string, string];
      if (
        version !== TOKEN_VERSION ||
        !GUEST_ID_PATTERN.test(guestId) ||
        !EXPIRY_PATTERN.test(expiry) ||
        !SIGNATURE_PATTERN.test(signature)
      ) {
        return { ok: false, reason: 'malformed' };
      }

      // Compare the encoded text, not the decoded bytes: base64url has spare bits in its final
      // character, so several different strings decode to the same signature bytes.
      const expected = Buffer.from(signatureFor(`${version}.${guestId}.${expiry}`), 'ascii');
      const provided = Buffer.from(signature, 'ascii');
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return { ok: false, reason: 'bad_signature' };
      }

      // Expiry is checked only after the signature so an attacker learns nothing about
      // timestamps from unsigned guesses.
      const expiresAtSeconds = Number(expiry);
      if (expiresAtSeconds * 1000 <= nowMs) return { ok: false, reason: 'expired' };
      return { ok: true, guestId, expiresAtSeconds };
    },
  };
}
