import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from '../helpers/server.js';
import { startTestServer } from '../helpers/server.js';

/** Single-port production layout: the server also hosts the built web client. */

let ctx: TestServer;
let webDist: string;

beforeAll(async () => {
  webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-web-dist-'));
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(
    path.join(webDist, 'index.html'),
    '<!doctype html><title>BOLT RIVALS</title><div id="root"></div>',
  );
  fs.writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log("app");');
  fs.writeFileSync(path.join(webDist, 'manifest.webmanifest'), '{}');
  ctx = await startTestServer({ webDist });
});

afterAll(async () => {
  await ctx.stop();
  fs.rmSync(webDist, { recursive: true, force: true });
});

describe('built web client', () => {
  it('serves the app shell at the root and for client-side routes', async () => {
    for (const route of ['/', '/garage', '/race/city_01?weather=rain']) {
      const res = await fetch(`${ctx.url}${route}`, { headers: { Accept: 'text/html' } });
      expect(res.status, route).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(await res.text()).toContain('BOLT RIVALS');
    }
  });

  it('caches fingerprinted assets forever and everything else not at all', async () => {
    const asset = await fetch(`${ctx.url}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const manifest = await fetch(`${ctx.url}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a missing asset or API route with JSON, never the app shell', async () => {
    for (const route of [
      '/assets/missing-000.js',
      '/favicon.ico',
      '/api/v1/nope',
      '/api/unknown',
    ]) {
      const res = await fetch(`${ctx.url}${route}`, { headers: { Accept: 'text/html,*/*' } });
      expect(res.status, route).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'There is nothing at this address.' },
      });
    }
    const script = await fetch(`${ctx.url}/garage`, { headers: { Accept: 'application/json' } });
    expect(script.status).toBe(404);
  });

  it('does not serve files outside the web directory', async () => {
    const outside = path.join(path.dirname(webDist), `bolt-secret-${process.pid}.txt`);
    fs.writeFileSync(outside, 'secret');
    try {
      for (const route of [
        `/../${path.basename(outside)}`,
        `/..%2f${path.basename(outside)}`,
        `/assets/..%2f..%2f${path.basename(outside)}`,
      ]) {
        const res = await fetch(`${ctx.url}${route}`);
        expect(res.status, route).toBeGreaterThanOrEqual(400);
        expect(await res.text()).not.toContain('secret');
      }
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('still serves the API beside the client', async () => {
    const res = await fetch(`${ctx.url}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});
