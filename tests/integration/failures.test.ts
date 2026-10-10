import { Client } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT } from '@bolt/content';
import type { ApiError, GuestSessionResponse } from '@bolt/shared';
import { PROTOCOL_VERSION, ROOM_DRIVE } from '@bolt/shared';
import { InMemoryGuestStore } from '../../apps/server/src/persistence/guestStore.js';
import { JOIN_ERROR_CODES } from '../../apps/server/src/rooms/driveJoin.js';
import { createLogger } from '../../apps/server/src/telemetry/log.js';
import type { TestServer } from '../helpers/server.js';
import { startTestServer } from '../helpers/server.js';

/** What players see, and what the log records, when a dependency fails underneath a request. */

const SECRET_DETAIL = 'connection to 10.0.0.7:5432 refused (password=hunter2)';

class FlakyGuestStore extends InMemoryGuestStore {
  failing = false;

  override async touch(...args: Parameters<InMemoryGuestStore['touch']>): Promise<boolean> {
    if (this.failing) throw new Error(SECRET_DETAIL);
    return super.touch(...args);
  }

  override async create(...args: Parameters<InMemoryGuestStore['create']>): Promise<void> {
    if (this.failing) throw new Error(SECRET_DETAIL);
    return super.create(...args);
  }
}

let ctx: TestServer;
let guest: GuestSessionResponse;
const store = new FlakyGuestStore();
const logLines: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  const logger = createLogger({
    level: 'info',
    write: (line) => logLines.push(JSON.parse(line) as Record<string, unknown>),
  });
  ctx = await startTestServer({ guestStore: store, logger });
  guest = (await (
    await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' })
  ).json()) as GuestSessionResponse;
});

afterAll(async () => {
  await ctx.stop();
});

describe('internal failures', () => {
  it('answer API calls with a generic error and keep the details in the log', async () => {
    store.failing = true;
    const res = await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' });
    store.failing = false;

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text) as ApiError).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on the server. Try again in a moment.',
      },
    });
    expect(text).not.toContain('hunter2');
    expect(text).not.toMatch(/\bat .*\(|\.ts:\d+/);

    const logged = logLines.find((line) => line.event === 'http_unhandled_error');
    expect(logged).toMatchObject({
      level: 'error',
      method: 'POST',
      path: '/api/v1/guest',
      errorMessage: SECRET_DETAIL,
    });
    expect(typeof logged!.stack).toBe('string');
  });

  it('answer room joins with a generic error and keep the details in the log', async () => {
    const client = new Client(ctx.wsUrl);
    store.failing = true;
    const failure = await client
      .joinOrCreate(ROOM_DRIVE, {
        protocolVersion: PROTOCOL_VERSION,
        guestToken: guest.token,
        trackId: 'city_01',
        weatherPresetId: 'city_clear_night',
        blueprint: BASELINE_BLUEPRINT,
      })
      .then(
        () => undefined,
        (error: { code?: number; message?: string }) => error,
      );
    store.failing = false;

    expect(failure).toBeDefined();
    expect(failure!.code).toBe(JOIN_ERROR_CODES.INTERNAL);
    expect(failure!.message).toBe('Something went wrong on the server. Try again in a moment.');
    expect(logLines.find((line) => line.event === 'join_failed')).toMatchObject({
      level: 'error',
      errorMessage: SECRET_DETAIL,
    });
  });

  it('never write a guest token to the log', async () => {
    // Exercise the paths that handle tokens: issue, keep, and a full join and leave.
    await fetch(`${ctx.url}/api/v1/guest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}` },
    });
    const client = new Client(ctx.wsUrl);
    const room = await client.joinOrCreate(ROOM_DRIVE, {
      protocolVersion: PROTOCOL_VERSION,
      guestToken: guest.token,
      trackId: 'city_01',
      weatherPresetId: 'city_clear_night',
      blueprint: BASELINE_BLUEPRINT,
    });
    await room.leave();
    await fetch(`${ctx.url}/matchmake/joinOrCreate/drive?guestToken=${guest.token}`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example' },
    });

    const everything = logLines.map((line) => JSON.stringify(line)).join('\n');
    expect(logLines.some((line) => line.event === 'player_joined')).toBe(true);
    expect(everything).toContain(guest.guestId);
    expect(everything).not.toContain(guest.token);
    expect(everything).not.toContain(guest.token.split('.')[3]);
  });

  it('log one JSON object per event with a time, level and event name', () => {
    expect(logLines.length).toBeGreaterThan(5);
    for (const line of logLines) {
      expect(typeof line.event).toBe('string');
      expect(['debug', 'info', 'warn', 'error']).toContain(line.level);
      expect(Number.isNaN(Date.parse(String(line.time)))).toBe(false);
    }
  });
});
