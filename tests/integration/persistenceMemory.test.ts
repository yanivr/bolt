import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfigFromEnv } from '../../apps/server/src/config.js';
import { blueprintApiContract } from '../helpers/blueprintApi.js';
import { startTestServer } from '../helpers/server.js';

/**
 * The server without a database: the same blueprint API on the in-memory repositories, the
 * production refusal, and the process actually starting (and refusing to) as `main.ts`.
 */

blueprintApiContract('in memory', () => startTestServer({ trustProxy: true }));

const SECRET = 'a-production-secret-that-is-long-enough-0001';

describe('DATABASE_URL in the environment', () => {
  it('is required in production', () => {
    expect(() =>
      loadConfigFromEnv({
        NODE_ENV: 'production',
        GUEST_TOKEN_SECRET: SECRET,
        ALLOWED_ORIGINS: '',
      }),
    ).toThrow(new ConfigError('DATABASE_URL must be set in production.'));
    const ok = loadConfigFromEnv({
      NODE_ENV: 'production',
      GUEST_TOKEN_SECRET: SECRET,
      DATABASE_URL: 'postgres://bolt:pw@db:5432/bolt',
    });
    expect(ok.config.databaseUrl).toBe('postgres://bolt:pw@db:5432/bolt');
  });

  it('is optional in development, and must be a postgres URL when given', () => {
    expect(loadConfigFromEnv({}).config.databaseUrl).toBeUndefined();
    expect(loadConfigFromEnv({ DATABASE_URL: '  ' }).config.databaseUrl).toBeUndefined();
    expect(() => loadConfigFromEnv({ DATABASE_URL: 'mysql://x' })).toThrow(ConfigError);
  });
});

/** Runs the real entry point with tsx and collects its log lines until it exits or is stopped. */
function runMain(
  env: Record<string, string>,
  until: (lines: string[]) => boolean,
  timeoutMs = 20_000,
): Promise<{ code: number | null; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    let buffered = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`main.ts did not reach the expected state: ${lines.join('\n')}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const parts = buffered.split('\n');
      buffered = parts.pop() ?? '';
      lines.push(...parts.filter(Boolean));
      if (until(lines)) child.kill('SIGTERM');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, lines });
    });
  });
}

describe('the server process', () => {
  it('starts without DATABASE_URL in development and says it keeps data in memory', async () => {
    const { lines } = await runMain(
      { PORT: '0', NODE_ENV: 'development', LOG_LEVEL: 'info' },
      (l) => l.some((line) => line.includes('"server_listening"')),
    );
    const memory = lines.find((line) => line.includes('"persistence_in_memory"'));
    expect(memory).toBeDefined();
    expect(memory).toContain('lost on restart');
    const listening = JSON.parse(lines.find((line) => line.includes('"server_listening"'))!) as {
      persistence: string;
    };
    expect(listening.persistence).toBe('memory');
  }, 30_000);

  it('refuses to start in production without DATABASE_URL', async () => {
    const { code, lines } = await runMain(
      { PORT: '0', NODE_ENV: 'production', GUEST_TOKEN_SECRET: SECRET },
      () => false,
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('DATABASE_URL must be set in production.');
    expect(lines.some((line) => line.includes('"server_listening"'))).toBe(false);
  }, 30_000);

  it('refuses to start when the configured database cannot be reached, never falling back to memory', async () => {
    const { code, lines } = await runMain(
      {
        PORT: '0',
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://bolt@127.0.0.1:1/bolt',
        BOLT_DB_CONNECT_ATTEMPTS: '1',
      },
      () => false,
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('database_unavailable');
    expect(lines.some((line) => line.includes('persistence_in_memory'))).toBe(false);
  }, 30_000);
});
