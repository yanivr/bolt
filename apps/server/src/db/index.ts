import type { Logger } from '../telemetry/log.js';
import { createMemoryPersistence } from './memory.js';
import { openPostgresPersistence } from './postgres.js';
import type { Persistence } from './types.js';

/**
 * Chooses the persistence layer: PostgreSQL when a connection string is configured, otherwise
 * the in-memory implementation behind the same interfaces, announced loudly in the log.
 * Production never reaches the in-memory branch: `loadConfigFromEnv` refuses to start there
 * without `DATABASE_URL`.
 */
export async function openPersistence(options: {
  databaseUrl: string | undefined;
  logger: Logger;
  /** Startup attempts to reach the database, a second apart. Ten by default. */
  connectAttempts?: number;
}): Promise<Persistence> {
  if (options.databaseUrl) {
    return openPostgresPersistence({
      connectionString: options.databaseUrl,
      logger: options.logger,
      ...(options.connectAttempts ? { connectAttempts: options.connectAttempts } : {}),
    });
  }
  options.logger.warn('persistence_in_memory', {
    message:
      'DATABASE_URL is not set. Guest sessions, shared car codes and match records are kept in memory and lost on restart.',
  });
  return createMemoryPersistence();
}

export type { Persistence } from './types.js';
