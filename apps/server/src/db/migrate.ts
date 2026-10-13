import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../telemetry/log.js';
import type { Database, Queryable } from './pool.js';

/**
 * Plain SQL migrations, applied in order at startup. Each file is `NNN_name.sql`; each runs in
 * its own transaction together with its row in `schema_migrations`, so a failure leaves the
 * database exactly as the previous migration left it. A session advisory lock serializes
 * concurrent starts. Re-running is a no-op. An applied file whose content has changed is a
 * refusal to start, because the database would no longer match what the code expects.
 */

export type Migration = { version: number; name: string; sql: string; checksum: string };

const FILE_PATTERN = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
/** Arbitrary constant: "bolt" in ASCII. Every runner of this schema takes the same lock. */
const LOCK_KEY = 0x626f6c74;

/**
 * Where the SQL files live. In the source tree this file is `src/db/migrate.ts` next to
 * `src/db/migrations`; the server bundle is `dist/main.js` and the build copies the folder to
 * `dist/migrations`. Both are `./migrations` beside the running module.
 */
export function defaultMigrationsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Reads and orders the migration files. Throws on a malformed name or a repeated number. */
export function loadMigrations(dir = defaultMigrationsDir()): Migration[] {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql'));
  const migrations = files.map((file) => {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Migration file "${file}" must be named NNN_name.sql.`);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return { version: Number(match[1]), name: match[2]!, sql, checksum: checksumOf(sql) };
  });
  migrations.sort((a, b) => a.version - b.version);
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.version === migrations[i - 1]!.version)
      throw new Error(`Two migrations share the number ${migrations[i]!.version}.`);
  }
  if (migrations.length === 0) throw new Error(`No migrations found in ${dir}.`);
  return migrations;
}

export type MigrationReport = { applied: number[]; alreadyApplied: number[] };

type AppliedRow = { version: number; name: string; checksum: string };

async function inTransaction<T>(db: Queryable, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    const value = await fn();
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function migrate(
  db: Database,
  logger: Logger,
  migrations: Migration[] = loadMigrations(),
): Promise<MigrationReport> {
  return db.withConnection(async (connection) => {
    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await connection.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version     integer     PRIMARY KEY,
           name        text        NOT NULL,
           checksum    text        NOT NULL,
           applied_at  timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const { rows } = await connection.query<AppliedRow>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
      );
      const applied = new Map(rows.map((row) => [row.version, row]));
      const report: MigrationReport = { applied: [], alreadyApplied: [] };
      for (const migration of migrations) {
        const done = applied.get(migration.version);
        if (done) {
          if (done.checksum !== migration.checksum)
            throw new Error(
              `Migration ${migration.version} (${migration.name}) was changed after it was applied. Add a new migration instead.`,
            );
          report.alreadyApplied.push(migration.version);
          continue;
        }
        await inTransaction(connection, async () => {
          await connection.query(migration.sql);
          await connection.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [migration.version, migration.name, migration.checksum],
          );
        });
        logger.info('database_migrated', { version: migration.version, name: migration.name });
        report.applied.push(migration.version);
      }
      // A database newer than this code would have tables it does not know how to treat.
      const known = new Set(migrations.map((m) => m.version));
      const unknown = rows.filter((row) => !known.has(row.version));
      if (unknown.length > 0)
        throw new Error(
          `The database has migration ${unknown[0]!.version}, which this server does not know. Deploy the newer server.`,
        );
      return report;
    } finally {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  });
}
