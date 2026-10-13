import { createGameServer } from './app.js';
import { ConfigError, loadConfigFromEnv } from './config.js';
import { openPersistence } from './db/index.js';
import { createLogger, errorFields } from './telemetry/log.js';

/** Process entry point: read the environment, start listening, and shut down cleanly. */

const SHUTDOWN_DEADLINE_MS = 10_000;

async function main(): Promise<void> {
  const logger = createLogger({ level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info' });

  let loaded;
  try {
    loaded = loadConfigFromEnv(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.error('config_invalid', { message: error.message });
    process.exitCode = 1;
    return;
  }
  for (const message of loaded.warnings) logger.warn('config_warning', { message });

  // PostgreSQL when DATABASE_URL is set (migrations run here, before any request is served);
  // in memory otherwise, which the log states plainly. Production cannot get here without one.
  let persistence;
  try {
    const attempts = Number(process.env.BOLT_DB_CONNECT_ATTEMPTS);
    persistence = await openPersistence({
      databaseUrl: loaded.config.databaseUrl,
      logger,
      ...(Number.isInteger(attempts) && attempts > 0 ? { connectAttempts: attempts } : {}),
    });
  } catch (error) {
    logger.error('database_unavailable', errorFields(error));
    process.exitCode = 1;
    return;
  }

  const server = createGameServer({ ...loaded.config, logger, persistence });
  const port = await server.listen(loaded.port);
  logger.info('server_listening', {
    port,
    nodeEnv: loaded.config.nodeEnv ?? 'development',
    allowedOrigins: (loaded.config.allowedOrigins ?? []).join(','),
    trustProxy: loaded.config.trustProxy ?? false,
    persistence: persistence.kind,
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('server_stopping', { signal });
    // If a room or socket refuses to close, exit anyway so the supervisor can restart us.
    const deadline = setTimeout(() => {
      logger.error('shutdown_timed_out', { deadlineMs: SHUTDOWN_DEADLINE_MS });
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    server
      .shutdown()
      .then(() => persistence.close())
      .then(() => {
        logger.info('server_stopped', {});
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('shutdown_failed', errorFields(error));
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((error: unknown) => {
  createLogger().error('server_failed_to_start', errorFields(error));
  process.exit(1);
});
