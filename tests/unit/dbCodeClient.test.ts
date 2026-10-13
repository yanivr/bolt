import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT, CATALOG, ROOKIE_BLUEPRINT } from '@bolt/content';
import { buildHash, generateCarCode, requestIdSchema, serializeBlueprint } from '@bolt/shared';
import {
  LIBRARY_KEY,
  addBlueprint,
  attachShare,
  clearShares,
  duplicateBlueprint,
  parseLibrary,
  renameSaved,
  repairSaved,
  serializeLibrary,
} from '../../apps/web/src/garage/blueprintLibrary.js';
import {
  GUEST_TOKEN_KEY,
  PENDING_DELETES_KEY,
  createCodeClient,
  requestIdFor,
} from '../../apps/web/src/garage/codeApi.js';
import { LOCAL_PREFIX, clearGameKeys } from '../../apps/web/src/garage/privacy.js';

/** The client half of car codes: the API client, codes on saved cars, and the local reset. */

const code = generateCarCode(() => new Uint8Array([1, 2, 3, 4, 5, 6]));
const id = '0b6f3c1e-2a4d-4c8e-9f10-1234567890ab';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

type Call = { url: string; method: string; auth: string | null; body: unknown };

function stubServer(answers: Array<(call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new TypeError('Failed to fetch');
    return answer(call);
  };
  return { calls, fetch: fetchStub as typeof fetch };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const publicCar = {
  code,
  blueprint: BASELINE_BLUEPRINT,
  buildHash: buildHash(BASELINE_BLUEPRINT),
  catalogVersion: BASELINE_BLUEPRINT.catalogVersion,
  currentCatalogVersion: BASELINE_BLUEPRINT.catalogVersion,
  stale: false,
  createdAt: '2026-10-12T10:00:00.000Z',
};

describe('the code API client', () => {
  it('keeps the guest token key in step with network/api.ts', () => {
    const source = readFileSync(resolve('apps/web/src/network/api.ts'), 'utf8');
    expect(source).toContain(`const TOKEN_KEY = '${GUEST_TOKEN_KEY}';`);
  });

  it('looks a code up without a token and parses the answer with the shared schema', async () => {
    const server = stubServer([() => json(200, publicCar)]);
    const client = createCodeClient({
      fetch: server.fetch,
      origin: () => 'http://x',
      token: async () => 't',
    });
    const result = await client.lookup(code);
    expect(result).toEqual({ ok: true, value: publicCar });
    expect(server.calls[0]).toMatchObject({
      url: `http://x/api/v1/blueprints/${code}`,
      auth: null,
    });
  });

  it('turns statuses, network failures and off-contract bodies into reasons, never throws', async () => {
    const server = stubServer([
      () => json(404, { error: { code: 'NOT_FOUND', message: "We couldn't find that car." } }),
      () => json(400, { error: { code: 'BAD_REQUEST', message: 'x.' } }),
      () =>
        json(429, {
          error: { code: 'RATE_LIMITED', message: 'Too many codes that did not match a car.' },
        }),
      () =>
        json(503, {
          error: { code: 'INTERNAL', message: 'Saved cars are not available right now.' },
        }),
      () => json(200, { ...publicCar, owner: 'someone' }),
      () => new Response('<html>', { status: 200 }),
    ]);
    const client = createCodeClient({
      fetch: server.fetch,
      origin: () => '',
      token: async () => 't',
    });
    expect(await client.lookup(code)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await client.lookup(code)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await client.lookup(code)).toEqual({
      ok: false,
      reason: 'rate_limited',
      message: 'Too many codes that did not match a car.',
    });
    expect(await client.lookup(code)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await client.lookup(code)).toEqual({ ok: false, reason: 'offline' });
    expect(await client.lookup(code)).toEqual({ ok: false, reason: 'offline' });
    expect(await client.lookup(code)).toEqual({ ok: false, reason: 'offline' }); // network down
  });

  it('creates with a request id and the guest token, renewing the token once on 401', async () => {
    let tokens = 0;
    const created = {
      id,
      code,
      name: 'Baseline Beetle',
      buildHash: buildHash(BASELINE_BLUEPRINT),
      catalogVersion: BASELINE_BLUEPRINT.catalogVersion,
      createdAt: '2026-10-12T10:00:00.000Z',
      reused: false,
    };
    const server = stubServer([
      () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x.' } }),
      () => json(201, created),
    ]);
    const client = createCodeClient({
      fetch: server.fetch,
      origin: () => '',
      token: async () => `token-${++tokens}-0000000000000000`,
    });
    expect(await client.create(BASELINE_BLUEPRINT, 'req-12345678')).toEqual({
      ok: true,
      value: created,
    });
    expect(server.calls.map((c) => c.auth)).toEqual([
      'Bearer token-1-0000000000000000',
      'Bearer token-2-0000000000000000',
    ]);
    expect(server.calls[1]!.body).toEqual({
      requestId: 'req-12345678',
      blueprint: BASELINE_BLUEPRINT,
    });
  });

  it('queues a deletion that cannot reach the server and sends it later', async () => {
    const storage = new MemoryStorage();
    const server = stubServer([
      () => {
        throw new TypeError('offline');
      },
      () => new Response(null, { status: 204 }),
    ]);
    const client = createCodeClient({
      fetch: server.fetch,
      origin: () => '',
      token: async () => 'token-0000000000000000',
      storage: () => storage,
    });
    expect(await client.remove(id)).toEqual({ ok: false, reason: 'offline' });
    expect(JSON.parse(storage.getItem(PENDING_DELETES_KEY)!)).toEqual([id]);
    await client.flushPending();
    expect(server.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE /api/v1/me/blueprints/${id}`,
      `DELETE /api/v1/me/blueprints/${id}`,
    ]);
    expect(storage.getItem(PENDING_DELETES_KEY)).toBeNull();
  });

  it('deletes the guest with the stored token only, and never creates a guest to do it', async () => {
    const storage = new MemoryStorage();
    let created = 0;
    const server = stubServer([
      () => new Response(null, { status: 204 }),
      () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x.' } }),
    ]);
    const client = createCodeClient({
      fetch: server.fetch,
      origin: () => '',
      token: async () => {
        created++;
        return 'fresh-0000000000000000';
      },
      storage: () => storage,
    });
    expect(client.hasGuest()).toBe(false);
    expect(await client.deleteMe()).toEqual({ ok: true, value: undefined });
    expect(server.calls).toHaveLength(0);
    storage.setItem(GUEST_TOKEN_KEY, 'v1.stored-token-0000000000');
    expect(await client.deleteMe()).toEqual({ ok: true, value: undefined });
    expect(server.calls[0]).toMatchObject({
      method: 'DELETE',
      url: '/api/v1/me',
      auth: 'Bearer v1.stored-token-0000000000',
    });
    // A token the server no longer knows has nothing behind it: done, not an error.
    expect(await client.deleteMe()).toEqual({ ok: true, value: undefined });
    expect(created).toBe(0);
  });
});

describe('codes on saved cars', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const saved = () => {
    const added = addBlueprint([], BASELINE_BLUEPRINT, CATALOG, now);
    if (!added.ok) throw new Error('setup');
    return added;
  };

  it('are stored with the card, read back, and a malformed one is dropped', () => {
    const { entries, entry } = saved();
    const shared = attachShare(
      entries,
      entry.id,
      { code, id },
      entry.buildHash,
      entry.blueprint.name,
    );
    expect(shared.ok).toBe(true);
    const raw = serializeLibrary(shared.entries);
    const back = parseLibrary(raw, CATALOG);
    expect(back[0]!.share).toEqual({ code, id });
    const forged = raw.replace(code, 'CAR-AAAAAA-AA').replace(id, '<script>');
    expect(parseLibrary(forged, CATALOG)[0]!.share).toBeUndefined();
    expect(parseLibrary(forged, CATALOG)).toHaveLength(1);
    expect(LIBRARY_KEY).toBe('bolt.blueprints.v1');
  });

  it('are attached only to the build that was shared, and dropped when the car changes', () => {
    const { entries, entry } = saved();
    expect(
      attachShare(
        entries,
        entry.id,
        { code, id },
        buildHash(ROOKIE_BLUEPRINT),
        entry.blueprint.name,
      ).ok,
    ).toBe(false);
    expect(attachShare(entries, entry.id, { code, id }, entry.buildHash, 'Other Name').ok).toBe(
      false,
    );
    const shared = attachShare(
      entries,
      entry.id,
      { code, id },
      entry.buildHash,
      entry.blueprint.name,
    );
    if (!shared.ok) throw new Error('setup');
    const renamed = renameSaved(shared.entries, entry.id, 'New Name', CATALOG);
    expect(renamed.ok && renamed.entry.share).toBeUndefined();
    const same = renameSaved(shared.entries, entry.id, entry.blueprint.name, CATALOG);
    expect(same.ok && same.entry.share).toEqual({ code, id });
    const copy = duplicateBlueprint(shared.entries, entry.id, CATALOG, now);
    expect(copy.ok && copy.entry.share).toBeUndefined();
    expect(clearShares(shared.entries)[0]!.share).toBeUndefined();
  });

  it('are dropped by Repair Build, since the repaired car is a new build', () => {
    const old = { ...BASELINE_BLUEPRINT, catalogVersion: '0.1.0' };
    const raw = JSON.stringify({
      version: 1,
      items: [{ id: 'b1', blueprint: old, savedAt: now.toISOString(), share: { code, id } }],
    });
    const entries = parseLibrary(raw, CATALOG);
    expect(entries[0]!.legal).toBe(false);
    expect(entries[0]!.share).toEqual({ code, id });
    const repaired = repairSaved(entries, 'b1', CATALOG);
    expect(repaired.ok && repaired.entry.share).toBeUndefined();
  });

  it('ask for the same code for the same card, and a new one for a renamed or repainted card', () => {
    const { entry } = saved();
    const first = requestIdFor(entry);
    expect(requestIdSchema.safeParse(first).success).toBe(true);
    expect(requestIdFor(entry)).toBe(first);
    expect(requestIdFor({ ...entry, blueprint: { ...entry.blueprint, name: 'Other' } })).not.toBe(
      first,
    );
    expect(
      requestIdFor({ ...entry, blueprint: { ...entry.blueprint, paintId: 'paint_mint' } }),
    ).not.toBe(first);
    expect(requestIdFor({ ...entry, id: 'b<x>"' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('the local reset', () => {
  it('removes every key of the game and nothing else', () => {
    const storage = new MemoryStorage();
    storage.setItem(LIBRARY_KEY, serializeBlueprint(BASELINE_BLUEPRINT));
    storage.setItem(GUEST_TOKEN_KEY, 'token');
    storage.setItem('bolt.settings.v1', '{}');
    storage.setItem('bolt.audio.v1', '{}');
    storage.setItem('someone-else', 'keep');
    expect(clearGameKeys(storage)).toBe(4);
    expect(storage.length).toBe(1);
    expect(storage.getItem('someone-else')).toBe('keep');
    expect(LOCAL_PREFIX).toBe('bolt.');
    expect(clearGameKeys(null)).toBe(0);
  });
});
