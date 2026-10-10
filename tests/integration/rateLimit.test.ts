import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError } from '@bolt/shared';
import { JOIN_ERROR_CODES } from '../../apps/server/src/rooms/driveJoin.js';
import { createRateLimiter, rateLimitKey } from '../../apps/server/src/security/rateLimiter.js';
import type { TestServer } from '../helpers/server.js';
import { sleep, startTestServer } from '../helpers/server.js';

const WINDOW_MS = 800;
const API_MAX = 6;
const GUEST_MAX = 3;
const JOIN_MAX = 3;

let ctx: TestServer;

beforeAll(async () => {
  ctx = await startTestServer({
    rateLimits: {
      api: { windowMs: WINDOW_MS, max: API_MAX },
      guest: { windowMs: WINDOW_MS, max: GUEST_MAX },
      join: { windowMs: WINDOW_MS, max: JOIN_MAX },
    },
  });
});

afterAll(async () => {
  await ctx.stop();
});

/** Waits for a fresh window so one test's traffic never counts against the next. */
async function nextWindow(): Promise<void> {
  await sleep(WINDOW_MS + 100);
}

describe('HTTP rate limiting', () => {
  it('limits API calls per address and recovers when the window ends', async () => {
    await nextWindow();
    const responses = await Promise.all(
      Array.from({ length: API_MAX + 4 }, () => fetch(`${ctx.url}/api/v1/tracks`)),
    );
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(API_MAX);
    expect(statuses.filter((status) => status === 429)).toHaveLength(4);

    const limited = responses.find((res) => res.status === 429)!;
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get('ratelimit-remaining')).toBe('0');
    const body = (await limited.json()) as ApiError;
    expect(body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a moment and try again.' },
    });

    await nextWindow();
    expect((await fetch(`${ctx.url}/api/v1/tracks`)).status).toBe(200);
  });

  it('limits guest creation more tightly than the rest of the API', async () => {
    await nextWindow();
    const statuses: number[] = [];
    for (let i = 0; i < GUEST_MAX + 2; i += 1) {
      statuses.push((await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    // The general budget is not exhausted, so other routes still answer.
    expect((await fetch(`${ctx.url}/api/v1/health`)).status).toBe(200);
  });

  it('limits room joins before they reach the matchmaker', async () => {
    await nextWindow();
    const attempt = () =>
      fetch(`${ctx.url}/matchmake/joinOrCreate/drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: -1 }),
      });
    const results: Array<{ status: number; body: { code: number; error: string } }> = [];
    for (let i = 0; i < JOIN_MAX + 2; i += 1) {
      const res = await attempt();
      results.push({
        status: res.status,
        body: (await res.json()) as { code: number; error: string },
      });
    }
    // Admitted attempts reach the room's own validation, which refuses the bogus version.
    for (const result of results.slice(0, JOIN_MAX)) {
      expect(result).toEqual({
        status: 200,
        body: { code: JOIN_ERROR_CODES.VERSION_MISMATCH, error: expect.any(String) },
      });
    }
    for (const result of results.slice(JOIN_MAX)) {
      expect(result).toEqual({
        status: 429,
        body: { code: JOIN_ERROR_CODES.RATE_LIMITED, error: expect.any(String) },
      });
    }
  });
});

describe('rate limiter', () => {
  it('counts per key in fixed windows', () => {
    let now = 1_000;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 }, () => now);
    expect(limiter.hit('a')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.hit('a')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.hit('a')).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
    expect(limiter.hit('b').allowed).toBe(true);
    now += 999;
    expect(limiter.hit('a').allowed).toBe(false);
    now += 1;
    expect(limiter.hit('a').allowed).toBe(true);
    now += 5000;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });

  it('keys IPv4 by address and IPv6 by /64 so one host cannot rotate out of a limit', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:0db8:0001:0002:ffff::9')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:db8:1:3::1')).not.toBe(rateLimitKey('2001:db8:1:2::1'));
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitKey(undefined)).toBe('unknown');
  });
});
