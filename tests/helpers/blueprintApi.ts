import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT, CATALOG_VERSION, STARTER_TEMPLATES } from '@bolt/content';
import type { ApiError, GuestSessionResponse, VehicleBlueprint } from '@bolt/shared';
import {
  ERROR_CODES,
  buildHash,
  createBlueprintResponseSchema,
  generateCarCode,
  myBlueprintsResponseSchema,
  publicBlueprintResponseSchema,
  serializeBlueprint,
} from '@bolt/shared';
import type { TestServer } from './server.js';

/**
 * The blueprint HTTP API (Section 15.7) as a contract, run against a server on in-memory
 * storage (`tests/integration/persistenceMemory.test.ts`) and one on PostgreSQL
 * (`tests/integration/persistence.test.ts`). The server must have `trustProxy` on: each test
 * speaks from its own forwarded address, so rate limits of one test never reach another.
 */

export const INVALID_CODE_COPY = "We couldn't find that car. Check the code and try again.";

let address = 0;
/** A fresh client address for one test. */
export function newAddress(): string {
  address += 1;
  return `10.${(address >> 16) & 255}.${(address >> 8) & 255}.${address & 255}`;
}

export type Client = {
  ip: string;
  token: string;
  guestId: string;
  call(path: string, init?: RequestInit & { auth?: boolean }): Promise<Response>;
  share(blueprint: unknown, requestId?: string): Promise<Response>;
};

let requests = 0;

export async function newClient(base: string, ip = newAddress()): Promise<Client> {
  const raw = await fetch(`${base}/api/v1/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: '{}',
  });
  const guest = (await raw.json()) as GuestSessionResponse;
  const client: Client = {
    ip,
    token: guest.token,
    guestId: guest.guestId,
    call(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set('x-forwarded-for', ip);
      if (init.auth !== false) headers.set('authorization', `Bearer ${client.token}`);
      if (init.body !== undefined && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
      return fetch(`${base}${path}`, { ...init, headers });
    },
    share(blueprint, requestId = `req-${process.pid}-${++requests}`) {
      return client.call('/api/v1/blueprints', {
        method: 'POST',
        body: JSON.stringify({ requestId, blueprint }),
      });
    },
  };
  return client;
}

export async function expectError(res: Response, status: number, code: ApiError['error']['code']) {
  expect(res.status).toBe(status);
  const body = (await res.json()) as ApiError;
  expect(Object.keys(body)).toEqual(['error']);
  expect(ERROR_CODES).toContain(body.error.code);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toMatch(/^[A-Z].*\.$/);
  expect(body.error.message).not.toMatch(/—|--|\bat\s+\S+\s+\(|node_modules|Error:|SELECT|pg_/);
  return body.error.message;
}

export function car(name: string, base: VehicleBlueprint = BASELINE_BLUEPRINT): VehicleBlueprint {
  return { ...base, name };
}

export async function shareOk(client: Client, blueprint: VehicleBlueprint) {
  const res = await client.share(blueprint);
  expect(res.status).toBe(201);
  return createBlueprintResponseSchema.parse(await res.json());
}

export function blueprintApiContract(
  label: string,
  start: () => Promise<TestServer>,
  /** More tests that need this suite's server (one Colyseus server per test file). */
  extra?: (server: () => TestServer) => void,
): void {
  describe(`${label}: blueprint API contract`, () => {
    let ctx: TestServer;
    beforeAll(async () => {
      ctx = await start();
    });
    afterAll(async () => {
      await ctx.stop();
    });

    it('creates a code for a legal car, idempotently, and serves the public canonical car', async () => {
      const me = await newClient(ctx.url);
      const blueprint = car('Api Sprinter', STARTER_TEMPLATES[1]!.blueprint);
      const first = await me.share(blueprint, 'req-api-idem-1');
      expect(first.status).toBe(201);
      expect(first.headers.get('cache-control')).toBe('no-store');
      const made = createBlueprintResponseSchema.parse(await first.json());
      expect(made.reused).toBe(false);
      expect(made.buildHash).toBe(buildHash(blueprint));
      expect(made.catalogVersion).toBe(CATALOG_VERSION);
      const again = await me.share(blueprint, 'req-api-idem-1');
      expect(again.status).toBe(200);
      expect(createBlueprintResponseSchema.parse(await again.json())).toEqual({
        ...made,
        reused: true,
      });

      // Anyone can load it, with any spelling of the code, and sees only the car.
      const stranger = await newClient(ctx.url);
      for (const spelling of [
        made.code,
        made.code.toLowerCase(),
        made.code.replace(/-/g, '').slice(3),
      ]) {
        const res = await stranger.call(`/api/v1/blueprints/${encodeURIComponent(spelling)}`, {
          auth: false,
        });
        expect(res.status, spelling).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const text = await res.text();
        expect(text).not.toContain(me.guestId);
        expect(text).not.toContain(made.id);
        const body = publicBlueprintResponseSchema.parse(JSON.parse(text));
        expect(Object.keys(body).sort()).toEqual(
          [
            'blueprint',
            'buildHash',
            'catalogVersion',
            'code',
            'createdAt',
            'currentCatalogVersion',
            'stale',
          ].sort(),
        );
        expect(body.code).toBe(made.code);
        expect(body.stale).toBe(false);
        expect(serializeBlueprint(body.blueprint)).toBe(serializeBlueprint(blueprint));
        expect(buildHash(body.blueprint)).toBe(made.buildHash);
      }
    });

    it('needs a valid guest token to create, list or delete', async () => {
      const me = await newClient(ctx.url);
      const anonymous = await me.call('/api/v1/blueprints', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ requestId: 'req-anon-0001', blueprint: BASELINE_BLUEPRINT }),
      });
      await expectError(anonymous, 401, 'UNAUTHORIZED');
      const forged = me.token.slice(0, -4) + (me.token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      const bad = await me.call('/api/v1/me/blueprints', {
        auth: false,
        headers: { authorization: `Bearer ${forged}` },
      });
      await expectError(bad, 401, 'UNAUTHORIZED');
      await expectError(
        await me.call('/api/v1/me', { method: 'DELETE', auth: false }),
        401,
        'UNAUTHORIZED',
      );
    });

    it('refuses illegal builds, forged fields, other catalogs, unknown parts and bad bodies', async () => {
      const me = await newClient(ctx.url);
      const overBudget = {
        ...BASELINE_BLUEPRINT,
        name: 'Too Rich',
        parts: Array.from({ length: 6 }, (_, i) => ({
          instanceId: `p${i + 1}`,
          partId: 'weapon_rocket',
          mountId: 'roof',
          offsetX: 0,
          offsetY: 0,
          rotationQuarterTurns: 0,
        })),
      };
      await expectError(await me.share(overBudget), 422, 'ILLEGAL_BUILD');
      // A client-computed total is a field the schema does not have: refused, not trusted.
      await expectError(
        await me.share({ ...BASELINE_BLUEPRINT, totalCost: 0 }),
        400,
        'BAD_REQUEST',
      );
      await expectError(
        await me.share({ ...BASELINE_BLUEPRINT, parts: [{ partId: 'weapon_rocket', cost: -500 }] }),
        400,
        'BAD_REQUEST',
      );
      const outdated = await me.share({ ...BASELINE_BLUEPRINT, catalogVersion: '0.1.0' });
      expect(await expectError(outdated, 409, 'CATALOG_MISMATCH')).toBe(
        'This build uses older part values. Review it before racing.',
      );
      await expectError(
        await me.share({ ...BASELINE_BLUEPRINT, chassisId: 'chassis_ufo' }),
        422,
        'UNKNOWN_PART',
      );
      await expectError(
        await me.share({ ...BASELINE_BLUEPRINT, offsetX: Number.NaN }),
        400,
        'BAD_REQUEST',
      );
      await expectError(
        await me.share({ ...BASELINE_BLUEPRINT, name: '<img src=x onerror=1>' }),
        400,
        'BAD_REQUEST',
      );
      await expectError(
        await me.call('/api/v1/blueprints', { method: 'POST', body: '{"requestId":"x"}' }),
        400,
        'BAD_REQUEST',
      );
      await expectError(
        await me.call('/api/v1/blueprints', {
          method: 'POST',
          body: JSON.stringify({
            requestId: 'req-extra-001',
            blueprint: BASELINE_BLUEPRINT,
            owner: 'me',
          }),
        }),
        400,
        'BAD_REQUEST',
      );
      await expectError(
        await me.call('/api/v1/blueprints', { method: 'POST', body: '{"requestId": ' }),
        400,
        'BAD_REQUEST',
      );
      const huge = JSON.stringify({
        requestId: 'req-huge-0001',
        blueprint: { name: 'x'.repeat(40_000) },
      });
      await expectError(
        await me.call('/api/v1/blueprints', { method: 'POST', body: huge }),
        413,
        'BAD_REQUEST',
      );
      // Just under the body limit but over the blueprint bound: refused by the validator.
      const padded = JSON.stringify({
        requestId: 'req-pad-00001',
        blueprint: { ...BASELINE_BLUEPRINT, createdAt: 'x'.repeat(9000) },
      });
      await expectError(
        await me.call('/api/v1/blueprints', { method: 'POST', body: padded }),
        400,
        'BAD_REQUEST',
      );
      const list = myBlueprintsResponseSchema.parse(
        await (await me.call('/api/v1/me/blueprints')).json(),
      );
      expect(list.blueprints).toEqual([]);
    });

    it('answers bad and unknown codes with the approved copy, checking the checksum first', async () => {
      const me = await newClient(ctx.url);
      const made = await shareOk(me, car('Typo Target'));
      const typo = made.code.slice(0, 6) + (made.code[6] === 'Z' ? 'Y' : 'Z') + made.code.slice(7);
      const swapped =
        made.code[4] === made.code[5]
          ? made.code.slice(0, 4) + made.code[6] + made.code[5] + made.code[4] + made.code.slice(7)
          : made.code.slice(0, 4) + made.code[5] + made.code[4] + made.code.slice(6);
      for (const bad of [
        typo,
        swapped,
        'CAR-7K92QZ-R4',
        'hello',
        'CAR-UUUUUU-UU',
        '%3Cscript%3E',
        'x'.repeat(80),
      ]) {
        const res = await me.call(`/api/v1/blueprints/${bad}`, { auth: false });
        expect(await expectError(res, 400, 'BAD_REQUEST'), bad).toBe(INVALID_CODE_COPY);
      }
      // A well-formed code nobody holds: 404, the same sentence.
      const unknown = generateCarCode((n) => randomBytes(n));
      const res = await me.call(`/api/v1/blueprints/${unknown}`, { auth: false });
      expect(await expectError(res, 404, 'NOT_FOUND')).toBe(INVALID_CODE_COPY);
    });

    it('lists the guest own codes and deletes only theirs', async () => {
      const me = await newClient(ctx.url);
      const thief = await newClient(ctx.url);
      const a = await shareOk(me, car('Mine A'));
      const b = await shareOk(me, car('Mine B'));
      const list = myBlueprintsResponseSchema.parse(
        await (await me.call('/api/v1/me/blueprints')).json(),
      );
      expect(list.blueprints.map((r) => r.code).sort()).toEqual([a.code, b.code].sort());
      expect(list.blueprints.every((r) => r.stale === false)).toBe(true);
      const theirs = myBlueprintsResponseSchema.parse(
        await (await thief.call('/api/v1/me/blueprints')).json(),
      );
      expect(theirs.blueprints).toEqual([]);

      await expectError(
        await thief.call(`/api/v1/me/blueprints/${a.id}`, { method: 'DELETE' }),
        404,
        'NOT_FOUND',
      );
      expect((await me.call(`/api/v1/blueprints/${a.code}`, { auth: false })).status).toBe(200);
      await expectError(
        await me.call('/api/v1/me/blueprints/not-a-uuid', { method: 'DELETE' }),
        400,
        'BAD_REQUEST',
      );
      const gone = await me.call(`/api/v1/me/blueprints/${a.id}`, { method: 'DELETE' });
      expect(gone.status).toBe(204);
      const after = await me.call(`/api/v1/blueprints/${a.code}`, { auth: false });
      expect(await expectError(after, 404, 'NOT_FOUND')).toBe(INVALID_CODE_COPY);
      await expectError(
        await me.call(`/api/v1/me/blueprints/${a.id}`, { method: 'DELETE' }),
        404,
        'NOT_FOUND',
      );
      const left = myBlueprintsResponseSchema.parse(
        await (await me.call('/api/v1/me/blueprints')).json(),
      );
      expect(left.blueprints.map((r) => r.code)).toEqual([b.code]);
    });

    it('deletes a guest and every code they made in one call (Section 16 reset)', async () => {
      const me = await newClient(ctx.url);
      const friend = await newClient(ctx.url);
      const a = await shareOk(me, car('Reset A'));
      const b = await shareOk(me, car('Reset B'));
      const kept = await shareOk(friend, car('Friend Car'));
      const reset = await me.call('/api/v1/me', { method: 'DELETE' });
      expect(reset.status).toBe(204);
      for (const code of [a.code, b.code])
        await expectError(
          await friend.call(`/api/v1/blueprints/${code}`, { auth: false }),
          404,
          'NOT_FOUND',
        );
      expect((await friend.call(`/api/v1/blueprints/${kept.code}`, { auth: false })).status).toBe(
        200,
      );
    });

    it('limits code creation per guest', async () => {
      const me = await newClient(ctx.url);
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await me.share(car(`Spam ${i}`))).status);
      expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('limits lookups per address and locks out an address that keeps missing', async () => {
      const owner = await newClient(ctx.url);
      const made = await shareOk(owner, car('Guess Target'));
      const guesser = await newClient(ctx.url);
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++)
        statuses.push(
          (await guesser.call(`/api/v1/blueprints/CAR-00000${i % 10}-00`, { auth: false })).status,
        );
      expect(statuses.slice(0, 20).every((s) => s === 400 || s === 404)).toBe(true);
      expect(statuses[20]).toBe(429);
      // Now even a real code is refused from that address until the window ends.
      const locked = await guesser.call(`/api/v1/blueprints/${made.code}`, { auth: false });
      await expectError(locked, 429, 'RATE_LIMITED');
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
      // Another address is unaffected, and a plain flood of good lookups is capped as well.
      const reader = await newClient(ctx.url);
      const ok: number[] = [];
      for (let i = 0; i < 31; i++)
        ok.push((await reader.call(`/api/v1/blueprints/${made.code}`, { auth: false })).status);
      expect(ok.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(ok[30]).toBe(429);
    });

    it('turns a share link into the app with the code, and never echoes markup', async () => {
      const me = await newClient(ctx.url);
      const made = await shareOk(me, car('Link Car'));
      const link = await fetch(`${ctx.url}/car/${made.code.toLowerCase()}`, { redirect: 'manual' });
      expect(link.status).toBe(302);
      expect(link.headers.get('location')).toBe(`/?car=${made.code}`);
      const junk = await fetch(`${ctx.url}/car/%3Cscript%3Ealert(1)%3C%2Fscript%3E`, {
        redirect: 'manual',
      });
      expect(junk.status).toBe(302);
      expect(junk.headers.get('location')).toBe('/?car=scriptalert1script');
    });

    extra?.(() => ctx);
  });
}
