import pg from 'pg';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';

/**
 * The PostgreSQL connection pool. One pool per process, built from `DATABASE_URL`. Every query
 * is parameterized; nothing in this layer ever concatenates a value into SQL text.
 */

export type QueryResult<R> = { rows: R[]; rowCount: number };

export type Queryable = {
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
};

export type Database = Queryable & {
  /** Runs `fn` on one connection inside BEGIN / COMMIT, rolling back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Runs `fn` on one dedicated connection (session-level locks need this). */
  withConnection<T>(fn: (connection: Queryable) => Promise<T>): Promise<T>;
  /** True when a trivial query succeeds within the connection timeout. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

export type DatabaseOptions = {
  connectionString: string;
  /**
   * Schema to work in, set as the connection's search_path. Tests use a fresh schema per run so
   * migrations start from empty without touching anything else. Production leaves it unset.
   */
  schema?: string;
  /** Pool size. The game server writes little, so a small pool is plenty. */
  max?: number;
  /** Milliseconds a statement may run before the server cancels it. */
  statementTimeoutMs?: number;
  connectionTimeoutMs?: number;
  logger: Logger;
};

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function createDatabase(options: DatabaseOptions): Database {
  if (options.schema !== undefined && !SCHEMA_PATTERN.test(options.schema))
    throw new Error('A database schema name must be lower-case letters, digits and underscores.');
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 5_000,
    application_name: 'bolt-rivals',
    ...(options.schema ? { options: `-c search_path=${options.schema}` } : {}),
  });
  // An idle client losing its connection must not take the process down; the next query
  // gets a fresh connection or fails on its own.
  pool.on('error', (error) => options.logger.error('database_pool_error', errorFields(error)));

  const query = async <R extends object>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<R>> => {
    const result = await pool.query<R>(text, values as unknown[]);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  };

  const onClient = (client: pg.PoolClient): Queryable => ({
    async query<R extends object>(text: string, values: readonly unknown[] = []) {
      const result = await client.query<R>(text, values as unknown[]);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  });

  let closed: Promise<void> | undefined;
  return {
    query,
    async withConnection(fn) {
      const client = await pool.connect();
      try {
        return await fn(onClient(client));
      } finally {
        client.release();
      }
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await fn(onClient(client));
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed ??= pool.end();
      return closed;
    },
  };
}

/** PostgreSQL's code for a unique constraint violation, and the index it names. */
export function uniqueViolationOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}

/** Strips credentials from a connection string so it can be logged. */
export function describeDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.searchParams.get('host') ?? url.host;
    return `${url.protocol}//${host}${url.pathname}`;
  } catch {
    return 'postgres (unparseable URL)';
  }
}
