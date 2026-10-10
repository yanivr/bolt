import { describe, expect, it } from 'vitest';
import { InMemoryGuestStore } from '../../apps/server/src/persistence/guestStore.js';
import { createGuestSessions } from '../../apps/server/src/security/guestSessions.js';
import {
  createGuestTokenSigner,
  generateGuestId,
  hashGuestToken,
  isGuestId,
} from '../../apps/server/src/security/guestTokens.js';

const SECRET = 'unit-test-secret-0123456789abcdef';
const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0);
const NOW_S = NOW_MS / 1000;

describe('guest ids', () => {
  it('are 128 random bits encoded as 22 base64url characters', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateGuestId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(id, 'base64url')).toHaveLength(16);
      expect(isGuestId(id)).toBe(true);
    }
    expect(isGuestId('short')).toBe(false);
    expect(isGuestId(42)).toBe(false);
  });
});

describe('guest token signer', () => {
  const signer = createGuestTokenSigner(SECRET);

  it('issues a token that verifies and carries the guest id and expiry', () => {
    const guestId = generateGuestId();
    const token = signer.sign(guestId, NOW_S + 3600);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{22}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token.length).toBeLessThanOrEqual(512);
    expect(signer.verify(token, NOW_MS)).toEqual({
      ok: true,
      guestId,
      expiresAtSeconds: NOW_S + 3600,
    });
  });

  it('signs deterministically, so the same claims give the same token', () => {
    const guestId = generateGuestId();
    expect(signer.sign(guestId, NOW_S + 60)).toBe(signer.sign(guestId, NOW_S + 60));
  });

  it('rejects a token whose guest id was swapped', () => {
    const token = signer.sign(generateGuestId(), NOW_S + 3600);
    const parts = token.split('.');
    parts[1] = generateGuestId();
    expect(signer.verify(parts.join('.'), NOW_MS)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a token whose expiry was extended', () => {
    const token = signer.sign(generateGuestId(), NOW_S + 60);
    const parts = token.split('.');
    parts[2] = String(NOW_S + 999_999);
    expect(signer.verify(parts.join('.'), NOW_MS)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects every single-character change to the signature', () => {
    const token = signer.sign(generateGuestId(), NOW_S + 3600);
    const dot = token.lastIndexOf('.');
    for (let i = dot + 1; i < token.length; i += 1) {
      const swapped = token[i] === 'A' ? 'B' : 'A';
      const tampered = token.slice(0, i) + swapped + token.slice(i + 1);
      expect(signer.verify(tampered, NOW_MS).ok).toBe(false);
    }
  });

  it('rejects a different encoding of the same signature bytes', () => {
    // The last base64url character of a 32-byte value has two unused bits. A verifier that
    // compared decoded bytes would accept all four spellings of it.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const token = signer.sign(generateGuestId(), NOW_S + 3600);
    const last = alphabet.indexOf(token[token.length - 1]!);
    const alias = alphabet[last ^ 1]!;
    const tampered = token.slice(0, -1) + alias;
    expect(Buffer.from(tampered.split('.')[3]!, 'base64url')).toEqual(
      Buffer.from(token.split('.')[3]!, 'base64url'),
    );
    expect(signer.verify(tampered, NOW_MS)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an expired token, including one expiring this very instant', () => {
    const guestId = generateGuestId();
    const token = signer.sign(guestId, NOW_S + 60);
    expect(signer.verify(token, NOW_MS + 59_999).ok).toBe(true);
    expect(signer.verify(token, NOW_MS + 60_000)).toEqual({ ok: false, reason: 'expired' });
    expect(signer.verify(token, NOW_MS + 86_400_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token signed with a different secret', () => {
    const other = createGuestTokenSigner('a-completely-different-secret-value');
    const token = other.sign(generateGuestId(), NOW_S + 3600);
    expect(signer.verify(token, NOW_MS)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed input of every shape without throwing', () => {
    const good = signer.sign(generateGuestId(), NOW_S + 3600);
    const [version, guestId, expiry, signature] = good.split('.') as [
      string,
      string,
      string,
      string,
    ];
    const malformed: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      '',
      'not-a-token',
      '...',
      'v1..',
      `${version}.${guestId}.${expiry}`,
      `${good}.extra`,
      `v2.${guestId}.${expiry}.${signature}`,
      `${version}.${guestId}x.${expiry}.${signature}`,
      `${version}.${guestId}.-5.${signature}`,
      `${version}.${guestId}.0${expiry}.${signature}`,
      `${version}.${guestId}.1e9.${signature}`,
      `${version}.${guestId}.${expiry}.${signature.slice(1)}`,
      `${version}.${guestId}.${expiry}.${signature}=`,
      `${version}.${guestId}.${expiry}.${'+'.repeat(43)}`,
      ` ${good}`,
      `${good}\n`,
      'x'.repeat(100_000),
    ];
    for (const value of malformed) {
      expect(signer.verify(value, NOW_MS), String(value).slice(0, 40)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('refuses to sign nonsense claims or run with a weak secret', () => {
    expect(() => signer.sign('not a guest id', NOW_S + 60)).toThrow();
    expect(() => signer.sign(generateGuestId(), Number.NaN)).toThrow();
    expect(() => signer.sign(generateGuestId(), -1)).toThrow();
    expect(() => createGuestTokenSigner('short')).toThrow();
    expect(() => createGuestTokenSigner('')).toThrow();
  });

  it('hashes tokens one way for storage', () => {
    const token = signer.sign(generateGuestId(), NOW_S + 3600);
    const hash = hashGuestToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashGuestToken(token));
    expect(hash).not.toContain(token.split('.')[3]);
  });
});

describe('guest sessions', () => {
  const TTL = 1000;
  const ROTATE_WITHIN = 400;

  function setup(adoptUnknownSessions = true) {
    let nowMs = NOW_MS;
    const store = new InMemoryGuestStore();
    const signer = createGuestTokenSigner(SECRET);
    const guests = createGuestSessions({
      signer,
      store,
      ttlSeconds: TTL,
      rotateWithinSeconds: ROTATE_WITHIN,
      adoptUnknownSessions,
      now: () => nowMs,
    });
    return {
      store,
      signer,
      guests,
      advance: (seconds: number) => (nowMs += seconds * 1000),
      now: () => new Date(nowMs),
    };
  }

  it('creates a guest and stores only a hash of the token', async () => {
    const { guests, store, now } = setup();
    const { session, outcome } = await guests.refresh(undefined);
    expect(outcome).toBe('created');
    expect(new Date(session.expiresAt).getTime()).toBe(NOW_MS + TTL * 1000);

    const record = await store.get(session.guestId, now());
    expect(record).toBeDefined();
    expect(record!.tokenHash).toBe(hashGuestToken(session.token));
    expect(JSON.stringify(record)).not.toContain(session.token);
    expect(record!.createdAt.getTime()).toBe(NOW_MS);
    expect(record!.expiresAt.getTime()).toBe(NOW_MS + TTL * 1000);
  });

  it('keeps a fresh token, rotates one near expiry, and replaces an invalid one', async () => {
    const { guests, store, advance, now } = setup();
    const first = (await guests.refresh(undefined)).session;

    advance(100);
    const kept = await guests.refresh(first.token);
    expect(kept.outcome).toBe('kept');
    expect(kept.session).toEqual(first);
    expect((await store.get(first.guestId, now()))!.lastSeenAt.getTime()).toBe(NOW_MS + 100_000);

    advance(600);
    const rotated = await guests.refresh(first.token);
    expect(rotated.outcome).toBe('rotated');
    expect(rotated.session.guestId).toBe(first.guestId);
    expect(rotated.session.token).not.toBe(first.token);
    expect(new Date(rotated.session.expiresAt).getTime()).toBe(NOW_MS + (700 + TTL) * 1000);
    expect((await store.get(first.guestId, now()))!.tokenHash).toBe(
      hashGuestToken(rotated.session.token),
    );

    advance(400);
    const replaced = await guests.refresh(first.token);
    expect(replaced.outcome).toBe('created');
    expect(replaced.session.guestId).not.toBe(first.guestId);

    const forged = await guests.refresh('v1.AAAAAAAAAAAAAAAAAAAAAA.9999999999.' + 'A'.repeat(43));
    expect(forged.outcome).toBe('created');
  });

  it('authenticates valid tokens only', async () => {
    const { guests, advance } = setup();
    const { session } = await guests.refresh(undefined);
    expect(await guests.authenticate(session.token)).toEqual({ guestId: session.guestId });
    expect(await guests.authenticate(session.token + 'x')).toBeNull();
    expect(await guests.authenticate(undefined)).toBeNull();
    advance(TTL + 1);
    expect(await guests.authenticate(session.token)).toBeNull();
  });

  it('re-registers a signed token the store has forgotten, unless told to be strict', async () => {
    const lenient = setup(true);
    const token = lenient.signer.sign(generateGuestId(), NOW_S + 500);
    expect(await lenient.guests.authenticate(token)).not.toBeNull();
    expect(await lenient.store.count()).toBe(1);

    const strict = setup(false);
    expect(await strict.guests.authenticate(token)).toBeNull();
    expect(await strict.store.count()).toBe(0);
  });

  it('expires sessions from the store and bounds its size', async () => {
    const { guests, store, advance } = setup();
    await guests.refresh(undefined);
    await guests.refresh(undefined);
    expect(await store.count()).toBe(2);
    advance(TTL - 1);
    expect(await guests.sweep()).toBe(0);
    advance(1);
    expect(await guests.sweep()).toBe(2);
    expect(await store.count()).toBe(0);

    const small = new InMemoryGuestStore({ maxSessions: 3 });
    const at = new Date(NOW_MS);
    for (let i = 0; i < 10; i += 1) {
      await small.create({
        id: `guest-${i}`,
        tokenHash: 'h',
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(NOW_MS + 1000),
      });
    }
    expect(await small.count()).toBe(3);
    expect(await small.get('guest-9', at)).toBeDefined();
    expect(await small.get('guest-0', at)).toBeUndefined();
    expect(await small.touch('guest-0', at)).toBe(false);
  });
});
