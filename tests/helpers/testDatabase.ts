import { randomBytes } from 'node:crypto';
import type { Database } from '../../apps/server/src/db/pool.js';
import { createDatabase } from '../../apps/server/src/db/pool.js';
import { silentLogger } from '../../apps/server/src/telemetry/log.js';

/**
 * PostgreSQL for the persistence suites. The URL comes from `BOLT_TEST_DATABASE_URL` (set by
 * `pnpm test:db`), or `DATABASE_URL`. Each suite works in a schema of its own, created empty
 * and dropped at the end, so runs never see each other's rows or touch anything else.
 */

export const TEST_DATABASE_URL = process.env.BOLT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export async function databaseReachable(): Promise<boolean> {
  if (!TEST_DATABASE_URL) return false;
  const db = createDatabase({
    connectionString: TEST_DATABASE_URL,
    logger: silentLogger,
    connectionTimeoutMs: 2000,
  });
  try {
    return await db.ping();
  } finally {
    await db.close();
  }
}

export type TestSchema = { db: Database; schema: string; drop(): Promise<void> };

export async function freshSchema(prefix = 't'): Promise<TestSchema> {
  const url = TEST_DATABASE_URL!;
  const schema = `${prefix}_${randomBytes(5).toString('hex')}`;
  const admin = createDatabase({ connectionString: url, logger: silentLogger, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = createDatabase({ connectionString: url, logger: silentLogger, schema });
  return {
    db,
    schema,
    async drop() {
      await db.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.close();
    },
  };
}
