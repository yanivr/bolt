import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT } from '@bolt/content';
import type { ApiError, GuestSessionResponse } from '@bolt/shared';
import { generateCarCode } from '@bolt/shared';
import { createMemoryPersistence } from '../../apps/server/src/db/memory.js';
import type { BlueprintRepository, Persistence } from '../../apps/server/src/db/types.js';
import type { TestServer } from '../helpers/server.js';
import { startTestServer } from '../helpers/server.js';

/** The blueprint routes on a storage layer that has failed: plain 503s, nothing leaked. */

const failing = new Proxy({} as BlueprintRepository, {
  get: () => async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 at Pool.query (node_modules/pg-pool)');
  },
});

let ctx: TestServer;
let token = '';

beforeAll(async () => {
  const memory = createMemoryPersistence();
  const persistence: Persistence = {
    ...memory,
    blueprints: failing,
    deleteGuest: () => failing.deleteAllForOwner('x'),
    health: async () => 'unavailable',
  };
  ctx = await startTestServer({ persistence });
  const guest = await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' });
  token = ((await guest.json()) as GuestSessionResponse).token;
});

afterAll(async () => {
  await ctx.stop();
});

describe('a failed store', () => {
  it('answers every blueprint call with 503 and the same plain sentence', async () => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const calls: Array<[string, RequestInit]> = [
      [`/api/v1/blueprints/${generateCarCode((n) => new Uint8Array(n).fill(7))}`, {}],
      [
        '/api/v1/blueprints',
        {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ requestId: 'req-fail-0001', blueprint: BASELINE_BLUEPRINT }),
        },
      ],
      ['/api/v1/me/blueprints', { headers: auth }],
      ['/api/v1/me', { method: 'DELETE', headers: auth }],
    ];
    for (const [path, init] of calls) {
      const res = await fetch(`${ctx.url}${path}`, init);
      expect(res.status, path).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|node_modules|Pool/);
      expect((JSON.parse(text) as ApiError).error).toEqual({
        code: 'INTERNAL',
        message: 'Saved cars are not available right now. Try again in a moment.',
      });
    }
  });

  it('reports the server degraded in the health check', async () => {
    const body = (await (await fetch(`${ctx.url}/api/v1/health`)).json()) as {
      status: string;
      dependencies: Record<string, string>;
    };
    expect(body).toMatchObject({ status: 'degraded', dependencies: { database: 'unavailable' } });
  });
});
