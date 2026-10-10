import type { GuestSessionResponse } from '@bolt/shared';
import type { GuestSessionStore } from '../persistence/guestStore.js';
import type { GuestTokenSigner } from './guestTokens.js';
import { generateGuestId, hashGuestToken } from './guestTokens.js';

/**
 * Guest session lifecycle on top of the token signer and the session store: issue a new
 * guest, keep or rotate an existing token, and authenticate a token for a room join.
 */

export type GuestSessionsOptions = {
  signer: GuestTokenSigner;
  store: GuestSessionStore;
  /** Lifetime of a freshly issued or rotated token. */
  ttlSeconds: number;
  /** A valid token with less than this much life left is replaced on the next guest call. */
  rotateWithinSeconds: number;
  /**
   * Whether a correctly signed, unexpired token whose session the store does not know is
   * registered again instead of refused. The in-memory store forgets every session on
   * restart, and without this each deploy would silently hand every player a new identity.
   * The signature remains the proof of identity either way.
   */
  adoptUnknownSessions?: boolean;
  now?: () => number;
};

export type GuestRefreshOutcome = 'created' | 'rotated' | 'kept';

export type GuestSessions = {
  /**
   * Returns a usable session for the caller. A valid token is kept, or rotated when it is
   * close to expiry; anything else (missing, forged, expired) yields a brand-new guest.
   */
  refresh(
    token: string | undefined,
  ): Promise<{ session: GuestSessionResponse; outcome: GuestRefreshOutcome }>;
  /** Resolves the guest id for a valid token, or null. */
  authenticate(token: unknown): Promise<{ guestId: string } | null>;
  /** Removes expired sessions from the store. */
  sweep(): Promise<number>;
};

export function createGuestSessions(options: GuestSessionsOptions): GuestSessions {
  const { signer, store, ttlSeconds, rotateWithinSeconds } = options;
  const adopt = options.adoptUnknownSessions ?? true;
  const now = options.now ?? Date.now;

  const respond = (
    guestId: string,
    token: string,
    expiresAtSeconds: number,
  ): GuestSessionResponse => ({
    guestId,
    token,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  });

  /** Confirms the store still honors this guest, registering the session again if allowed. */
  const ensureSession = async (
    guestId: string,
    token: string,
    expiresAtSeconds: number,
    at: Date,
  ): Promise<boolean> => {
    if (await store.touch(guestId, at)) return true;
    if (!adopt) return false;
    await store.create({
      id: guestId,
      tokenHash: hashGuestToken(token),
      createdAt: at,
      lastSeenAt: at,
      expiresAt: new Date(expiresAtSeconds * 1000),
    });
    return true;
  };

  const issue = async (at: Date): Promise<GuestSessionResponse> => {
    const guestId = generateGuestId();
    const expiresAtSeconds = Math.floor(at.getTime() / 1000) + ttlSeconds;
    const token = signer.sign(guestId, expiresAtSeconds);
    await store.create({
      id: guestId,
      tokenHash: hashGuestToken(token),
      createdAt: at,
      lastSeenAt: at,
      expiresAt: new Date(expiresAtSeconds * 1000),
    });
    return respond(guestId, token, expiresAtSeconds);
  };

  return {
    async refresh(token) {
      const nowMs = now();
      const at = new Date(nowMs);
      const checked = token === undefined ? undefined : signer.verify(token, nowMs);
      if (!checked?.ok || token === undefined) {
        return { session: await issue(at), outcome: 'created' };
      }
      if (!(await ensureSession(checked.guestId, token, checked.expiresAtSeconds, at))) {
        return { session: await issue(at), outcome: 'created' };
      }

      const remainingSeconds = checked.expiresAtSeconds - Math.floor(nowMs / 1000);
      if (remainingSeconds > rotateWithinSeconds) {
        return {
          session: respond(checked.guestId, token, checked.expiresAtSeconds),
          outcome: 'kept',
        };
      }

      // The outgoing token is deliberately not revoked: it expires on its own within the
      // rotation window, and a second open tab still holding it must not lose its identity.
      const expiresAtSeconds = Math.floor(nowMs / 1000) + ttlSeconds;
      const rotated = signer.sign(checked.guestId, expiresAtSeconds);
      await store.touch(checked.guestId, at, {
        tokenHash: hashGuestToken(rotated),
        expiresAt: new Date(expiresAtSeconds * 1000),
      });
      return { session: respond(checked.guestId, rotated, expiresAtSeconds), outcome: 'rotated' };
    },

    async authenticate(token) {
      const nowMs = now();
      const checked = signer.verify(token, nowMs);
      if (!checked.ok) return null;
      const known = await ensureSession(
        checked.guestId,
        token as string,
        checked.expiresAtSeconds,
        new Date(nowMs),
      );
      return known ? { guestId: checked.guestId } : null;
    },

    sweep() {
      return store.expire(new Date(now()));
    },
  };
}
