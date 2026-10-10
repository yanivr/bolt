import type { GameServerConfig } from '../../apps/server/src/config.js';
import type { GameServer } from '../../apps/server/src/app.js';
import { createGameServer } from '../../apps/server/src/app.js';
import { silentLogger } from '../../apps/server/src/telemetry/log.js';

export const TEST_SECRET = 'integration-test-secret-0123456789abcdef';
export const TEST_ORIGIN = 'http://game.test:5173';

export type TestServer = {
  server: GameServer;
  port: number;
  url: string;
  wsUrl: string;
  stop(): Promise<void>;
};

/**
 * Starts the real server on an ephemeral loopback port. Colyseus keeps its matchmaker in
 * module state, so each test file starts exactly one of these.
 */
export async function startTestServer(
  overrides: Partial<GameServerConfig> = {},
): Promise<TestServer> {
  const server = createGameServer({
    guestTokenSecret: TEST_SECRET,
    nodeEnv: 'test',
    allowedOrigins: [TEST_ORIGIN],
    logger: silentLogger,
    // Generous by default so only the tests that are about rate limiting ever hit a limit.
    rateLimits: {
      api: { windowMs: 60_000, max: 10_000 },
      guest: { windowMs: 60_000, max: 10_000 },
      join: { windowMs: 60_000, max: 10_000 },
    },
    ...overrides,
  });
  const port = await server.listen(0, '127.0.0.1');
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    stop: () => server.shutdown(),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until the predicate holds, failing with a readable message when it never does. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await sleep(10);
  }
}
