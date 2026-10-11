import { Client } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT } from '@bolt/content';
import type { DriveJoinOptions, GuestSessionResponse, HealthResponse } from '@bolt/shared';
import { JOIN_ERROR_CODES, PROTOCOL_VERSION, ROOM_DRIVE } from '@bolt/shared';
import type { DriveState } from '../../apps/server/src/rooms/schema.js';
import type { TestServer } from '../helpers/server.js';
import { startTestServer, waitFor } from '../helpers/server.js';

/**
 * Choosing the rival, the seed or a scenario is for reviews and tests. A server with the debug
 * options off, which is the default in production, refuses all three and still runs an
 * ordinary race: a player never gets to pick the opponent that suits a build.
 */

let ctx: TestServer;
let client: Client;
let guest: GuestSessionResponse;

beforeAll(async () => {
  ctx = await startTestServer({ drive: { debugOptions: false } });
  client = new Client(ctx.wsUrl);
  guest = (await (
    await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' })
  ).json()) as GuestSessionResponse;
});

afterAll(async () => {
  await ctx.stop();
});

function options(overrides: Record<string, unknown> = {}): DriveJoinOptions {
  return {
    protocolVersion: PROTOCOL_VERSION,
    guestToken: guest.token,
    trackId: 'city_01',
    weatherPresetId: 'city_clear_night',
    blueprint: BASELINE_BLUEPRINT,
    ...overrides,
  } as DriveJoinOptions;
}

describe('debug options on a server that has them off', () => {
  it('refuses a chosen rival, a chosen seed and a scenario, with a plain reason', async () => {
    for (const debug of [
      { rivalTemplateId: 'baseline' },
      { seed: 7 },
      { scenarioId: 'rocket_hit' },
    ]) {
      let failure: { code?: number; message?: string } | undefined;
      try {
        const room = await client.joinOrCreate(ROOM_DRIVE, options(debug));
        await room.leave();
      } catch (error) {
        failure = error as { code?: number; message?: string };
      }
      expect(failure, JSON.stringify(debug)).toBeDefined();
      expect(failure!.code).toBe(JOIN_ERROR_CODES.BAD_REQUEST);
      expect(failure!.message).toMatch(/^[A-Z].*\.$/);
      expect(failure!.message).not.toMatch(/—|--|Error:|node_modules/);
    }
    const health = (await (await fetch(`${ctx.url}/api/v1/health`)).json()) as HealthResponse;
    expect(health.rooms).toBe(0);
  });

  it('still starts an ordinary two-car race, with a rival the server chose', async () => {
    const room = await client.joinOrCreate<DriveState>(ROOM_DRIVE, options());
    await waitFor(
      () => typeof room.state?.rivalBlueprint === 'string' && room.state.rivalBlueprint.length > 0,
      3000,
      'the rival',
    );
    const rival = JSON.parse(room.state.rivalBlueprint) as { name: string; chassisId: string };
    expect(rival.chassisId).toMatch(/^chassis_/);
    expect(room.state.rival.chassisMax).toBeGreaterThan(50);
    expect(room.state.rival.buildHash).not.toBe(room.state.buildHash);
    // Side by side on the grid, not on top of the player.
    expect(
      Math.hypot(room.state.rival.x - room.state.x, room.state.rival.y - room.state.y),
    ).toBeGreaterThan(40);
    await room.leave();
  });
});
