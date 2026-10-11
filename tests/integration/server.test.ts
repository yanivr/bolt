import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_VERSION, DEFAULT_LOADOUT, TRACKS, WEATHER_PRESETS } from '@bolt/content';
import type { ApiError, GuestSessionResponse, HealthResponse } from '@bolt/shared';
import { ERROR_CODES, PROTOCOL_VERSION } from '@bolt/shared';
import type { CatalogResponse } from '../../apps/server/src/routes/catalog.js';
import type { TracksResponse } from '../../apps/server/src/routes/tracks.js';
import {
  createGuestTokenSigner,
  generateGuestId,
} from '../../apps/server/src/security/guestTokens.js';
import type { TestServer } from '../helpers/server.js';
import { TEST_ORIGIN, TEST_SECRET, startTestServer } from '../helpers/server.js';

let ctx: TestServer;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await ctx.stop();
});

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ctx.url}${path}`, init);
}

async function expectApiError(
  res: Response,
  status: number,
  code: ApiError['error']['code'],
): Promise<ApiError> {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain('application/json');
  const body = (await res.json()) as ApiError;
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  expect(ERROR_CODES).toContain(body.error.code);
  expect(body.error.code).toBe(code);
  // Error copy is shown to players: a real sentence, no stack frames, no dash punctuation.
  expect(body.error.message).toMatch(/^[A-Z].*\.$/);
  expect(body.error.message).not.toMatch(/—|--|\bat\s+\S+\s+\(|node_modules|Error:/);
  return body;
}

/** `fetch` cannot set Host or leave a body unterminated, so a few cases use a raw request. */
function rawRequest(
  options: http.RequestOptions,
  body?: string | Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: ctx.port, ...options }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('GET /api/v1/health', () => {
  it('reports readiness, versions and dependency state', async () => {
    const res = await api('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as HealthResponse;
    expect(body).toEqual({
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      catalogVersion: CATALOG_VERSION,
      uptimeSeconds: expect.any(Number),
      rooms: 0,
      dependencies: { database: 'not_configured' },
    });
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('sends security headers suited to a same-origin WebGL game', async () => {
    const res = await api('/api/v1/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(
      new RegExp(
        `connect-src 'self' ws://127\\.0\\.0\\.1:${ctx.port} wss://127\\.0\\.0\\.1:${ctx.port}`,
      ),
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('never reflects a hostile Host header into the policy', async () => {
    const res = await rawRequest({
      path: '/api/v1/health',
      headers: { Host: "evil.test; script-src 'unsafe-inline'" },
    });
    expect(res.status).toBe(200);
    const raw = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: ctx.port,
          path: '/api/v1/health',
          headers: { Host: 'evil.test;script-src *' },
        },
        (response) => {
          response.resume();
          resolve(String(response.headers['content-security-policy']));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(raw).not.toContain('evil.test');
    expect(raw).toContain("script-src 'self'");
  });
});

describe('POST /api/v1/guest', () => {
  const signer = createGuestTokenSigner(TEST_SECRET);

  async function requestGuest(
    token?: string,
  ): Promise<{ res: Response; body: GuestSessionResponse }> {
    const res = await api('/api/v1/guest', {
      method: 'POST',
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    });
    return { res, body: (await res.json()) as GuestSessionResponse };
  }

  it('issues a signed guest session that is never cached', async () => {
    const { res, body } = await requestGuest();
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'guestId', 'token']);
    expect(body.guestId).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const verified = signer.verify(body.token);
    expect(verified).toMatchObject({ ok: true, guestId: body.guestId });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 24 * 3600 * 1000);
    expect(verified.ok && verified.expiresAtSeconds * 1000).toBe(
      new Date(body.expiresAt).getTime(),
    );
  });

  it('gives every anonymous caller a different identity', async () => {
    const [a, b] = await Promise.all([requestGuest(), requestGuest()]);
    expect(a.body.guestId).not.toBe(b.body.guestId);
    expect(a.body.token).not.toBe(b.body.token);
  });

  it('keeps a valid token that is far from expiry', async () => {
    const first = await requestGuest();
    const again = await requestGuest(first.body.token);
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it('rotates a valid token that is close to expiry and keeps the guest id', async () => {
    const guestId = generateGuestId();
    const expiring = signer.sign(guestId, Math.floor(Date.now() / 1000) + 120);
    const { res, body } = await requestGuest(expiring);
    expect(res.status).toBe(200);
    expect(body.guestId).toBe(guestId);
    expect(body.token).not.toBe(expiring);
    expect(signer.verify(body.token)).toMatchObject({ ok: true, guestId });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 24 * 3600 * 1000);
  });

  it('starts a new guest when the presented token is forged, expired or garbage', async () => {
    const guestId = generateGuestId();
    const now = Math.floor(Date.now() / 1000);
    const candidates = [
      createGuestTokenSigner('some-other-secret-0123456789abcdef').sign(guestId, now + 3600),
      signer.sign(guestId, now - 10),
      signer.sign(guestId, now + 3600).slice(0, -2) + 'AA',
      'definitely-not-a-token-at-all',
    ];
    for (const token of candidates) {
      const { res, body } = await requestGuest(token);
      expect(res.status).toBe(201);
      expect(body.guestId).not.toBe(guestId);
      expect(signer.verify(body.token).ok).toBe(true);
    }
  });
});

describe('GET /api/v1/tracks', () => {
  it('lists every track with its full weather presets', async () => {
    const res = await api('/api/v1/tracks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as TracksResponse;
    expect(body.tracks.map((track) => track.id)).toEqual(Object.keys(TRACKS));

    const city = body.tracks.find((track) => track.id === 'city_01')!;
    const def = TRACKS.city_01!;
    expect(city).toEqual({
      id: def.id,
      name: def.name,
      biome: def.biome,
      character: def.character,
      laps: def.laps,
      surfaceMix: def.surfaceMix,
      landmarks: def.landmarks,
      weatherPresets: def.weatherPresetIds.map((id) => WEATHER_PRESETS[id]),
    });
    expect(city.weatherPresets.length).toBeGreaterThan(0);
    // Geometry belongs to the client bundle and must not be shipped on every menu load.
    expect(city).not.toHaveProperty('main');
    expect(city).not.toHaveProperty('props');
  });
});

describe('GET /api/v1/catalog', () => {
  it('returns the versions and every part table', async () => {
    const res = await api('/api/v1/catalog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogResponse;
    expect(Object.keys(body).sort()).toEqual([
      'catalogVersion',
      'chassis',
      'defenses',
      'engines',
      'paints',
      'protocolVersion',
      'startingCredits',
      'templates',
      'tires',
      'utilities',
      'weapons',
    ]);
    // The whole catalog: 105 parts, five chassis and twenty of each other kind.
    expect(body.chassis).toHaveLength(5);
    for (const list of [body.engines, body.tires, body.weapons, body.defenses, body.utilities])
      expect(list).toHaveLength(20);
    expect(body.startingCredits).toBe(1000);
    expect(body.templates.map((t) => t.id)).toContain('example_tiny_trouble');
    for (const part of [...body.weapons, ...body.defenses, ...body.utilities]) {
      expect(typeof part.price).toBe('number');
      expect(typeof part.description).toBe('string');
      expect(typeof part.drawback).toBe('string');
      expect(part.params).toBeDefined();
    }
    expect(body.catalogVersion).toBe(CATALOG_VERSION);
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.chassis.map((part) => part.id)).toContain(DEFAULT_LOADOUT.chassisId);
    expect(body.engines.map((part) => part.id)).toContain(DEFAULT_LOADOUT.engineId);
    expect(body.tires.map((part) => part.id)).toContain(DEFAULT_LOADOUT.tireKitId);
    expect(body.paints.map((paint) => paint.id)).toContain(DEFAULT_LOADOUT.paintId);
    expect(body.chassis[0]!.mounts.length).toBeGreaterThan(0);
  });
});

describe('CORS', () => {
  it('refuses an origin that is not on the allow list', async () => {
    const res = await api('/api/v1/health', { headers: { Origin: 'http://evil.example' } });
    await expectApiError(res, 403, 'UNAUTHORIZED');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();

    const post = await api('/api/v1/guest', {
      method: 'POST',
      headers: { Origin: 'http://evil.example' },
    });
    await expectApiError(post, 403, 'UNAUTHORIZED');

    const opaque = await api('/api/v1/health', { headers: { Origin: 'null' } });
    await expectApiError(opaque, 403, 'UNAUTHORIZED');
  });

  it('refuses a preflight from an unlisted origin', async () => {
    const res = await api('/api/v1/guest', {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows a listed origin and answers its preflight', async () => {
    const res = await api('/api/v1/health', { headers: { Origin: TEST_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN);
    expect(res.headers.get('vary')).toContain('Origin');

    const preflight = await api('/api/v1/guest', {
      method: 'OPTIONS',
      headers: {
        Origin: TEST_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('allows the page this server itself hosts without listing it', async () => {
    const res = await api('/api/v1/guest', { method: 'POST', headers: { Origin: ctx.url } });
    expect(res.status).toBe(201);
    // Same-origin requests need no CORS grant, so none is advertised.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('request bodies', () => {
  it('rejects a JSON body above 16 kB', async () => {
    const res = await api('/api/v1/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(20 * 1024) }),
    });
    await expectApiError(res, 413, 'BAD_REQUEST');
  });

  it('accepts a small JSON body', async () => {
    const res = await api('/api/v1/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(1024) }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects JSON that does not parse without echoing parser details', async () => {
    const res = await api('/api/v1/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": ',
    });
    const body = await expectApiError(res, 400, 'BAD_REQUEST');
    expect(body.error.message).not.toMatch(/position|token|Unexpected/i);
  });
});

describe('unknown routes', () => {
  it('answer with the JSON error shape', async () => {
    await expectApiError(await api('/api/v1/nope'), 404, 'NOT_FOUND');
    await expectApiError(await api('/api/v2/health'), 404, 'NOT_FOUND');
    await expectApiError(await api('/'), 404, 'NOT_FOUND');
    await expectApiError(
      await api('/some/page', { headers: { Accept: 'text/html' } }),
      404,
      'NOT_FOUND',
    );
    await expectApiError(await api('/api/v1/health', { method: 'DELETE' }), 404, 'NOT_FOUND');
    await expectApiError(await api('/api/v1/guest'), 404, 'NOT_FOUND');
    await expectApiError(await api('/%E0%A4%A'), 404, 'NOT_FOUND');
  });
});

describe('matchmaking endpoint guard', () => {
  const joinPath = '/matchmake/joinOrCreate/drive';

  it('answers every method and path instead of leaving the request hanging', async () => {
    for (const [method, path] of [
      ['PUT', joinPath],
      ['DELETE', joinPath],
      ['GET', joinPath],
      ['POST', '/matchmake/joinById/abc'],
      ['POST', '/matchmake/joinOrCreate/drive/extra'],
      ['POST', '/matchmake'],
      ['GET', '/api/v1/health?next=/matchmake'],
    ] as const) {
      const res = await api(path, { method, signal: AbortSignal.timeout(3000) });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ code: expect.any(Number), error: expect.any(String) });
    }
  });

  it('refuses joins from an unlisted origin', async () => {
    const res = await api(joinPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers the preflight for a listed origin', async () => {
    const res = await api(joinPath, {
      method: 'OPTIONS',
      headers: { Origin: TEST_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN);
  });

  it('rejects an oversized join body whether or not its length is declared', async () => {
    const big = JSON.stringify({ padding: 'x'.repeat(64 * 1024) });
    const declared = await rawRequest(
      { method: 'POST', path: joinPath, headers: { 'Content-Type': 'application/json' } },
      big,
    );
    expect(declared.status).toBe(413);
    expect(JSON.parse(declared.body)).toEqual({
      code: expect.any(Number),
      error: 'The join request is too large.',
    });

    const chunked = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: ctx.port,
          method: 'POST',
          path: joinPath,
          headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      // The server answers and drops the connection mid-upload, which surfaces here as a
      // write error after the response has already been read.
      req.on('error', () => undefined);
      setTimeout(
        () => reject(new Error('The oversized chunked upload was never answered.')),
        5000,
      ).unref();
      for (let i = 0; i < 8; i += 1) req.write('x'.repeat(8 * 1024));
      req.end();
    });
    expect(chunked).toBe(413);

    // The server is still healthy afterwards.
    expect((await api('/api/v1/health')).status).toBe(200);
  });

  it('turns a join that is not valid JSON into an error body, not a crash', async () => {
    const res = await api(joinPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect((await api('/api/v1/health')).status).toBe(200);
  });
});
