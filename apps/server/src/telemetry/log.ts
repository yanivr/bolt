/**
 * Structured logging: one JSON object per line on stdout, so Docker, Caddy and any log shipper
 * can parse events without a custom format. Secrets and guest tokens must never be passed in
 * as fields; callers log opaque guest ids at most.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Returns a logger that stamps every line with the given fields, for example a room id. */
  child(fields: LogFields): Logger;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LoggerOptions = {
  level?: LogLevel;
  /** Receives one complete line without a trailing newline. Defaults to stdout. */
  write?: (line: string) => void;
  base?: LogFields;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = RANK[options.level ?? 'info'];
  const write = options.write ?? ((line: string) => void process.stdout.write(line + '\n'));
  const base = options.base ?? {};

  const emit = (level: Exclude<LogLevel, 'silent'>, event: string, fields?: LogFields): void => {
    if (RANK[level] < threshold) return;
    // Fixed keys go last so a caller-supplied field can never spoof the level or event name.
    write(JSON.stringify({ ...base, ...fields, time: new Date().toISOString(), level, event }));
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

/** Used by tests and anywhere output would only be noise. */
export const silentLogger: Logger = createLogger({ level: 'silent' });

/** Flattens an unknown thrown value into loggable fields. Stacks stay in logs, never responses. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorName: 'NonError', errorMessage: String(error) };
}
