import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuestSessionStore } from './persistence/guestStore.js';
import type { RateLimitRule } from './security/rateLimiter.js';
import { MIN_SECRET_LENGTH } from './security/guestTokens.js';
import type { Logger } from './telemetry/log.js';

/** The value shipped in `.env.example`. Fine on a laptop, never acceptable in production. */
export const DEV_GUEST_TOKEN_SECRET = 'dev-only-change-me-0000000000000000';
const PRODUCTION_SECRET_MIN_LENGTH = 32;
const DEV_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export type NodeEnv = 'development' | 'production' | 'test';

export type DriveRoomTuning = {
  /** Seconds a dropped connection may take to come back before its car is removed. */
  reconnectSeconds: number;
  /** Malformed messages tolerated on one connection before it is closed. */
  maxMalformedMessages: number;
  /** Seconds without any input after which an abandoned room closes itself. */
  idleSeconds: number;
  /**
   * Whether a join may choose its rival, its seed or a showcase scenario. On everywhere but
   * production by default: reviews and tests need specific matchups, players do not get to
   * pick an opponent that suits them.
   */
  debugOptions: boolean;
};

export type GameServerConfig = {
  guestTokenSecret: string;
  nodeEnv?: NodeEnv;
  /** Browser origins allowed to call the API and open sockets from another host. */
  allowedOrigins?: string[];
  /** Set when a reverse proxy such as Caddy terminates connections in front of this process. */
  trustProxy?: boolean;
  /** Directory holding the built web client. Served with an SPA fallback when present. */
  webDist?: string;
  guestTokenTtlSeconds?: number;
  guestTokenRotateSeconds?: number;
  rateLimits?: Partial<Record<'api' | 'guest' | 'join', RateLimitRule>>;
  /** Refuse new rooms beyond this many so one node is never asked to simulate more than it can. */
  maxRooms?: number;
  drive?: Partial<DriveRoomTuning>;
  logger?: Logger;
  guestStore?: GuestSessionStore;
};

export type ResolvedConfig = Required<
  Omit<GameServerConfig, 'webDist' | 'logger' | 'guestStore' | 'rateLimits' | 'drive'>
> & {
  webDist: string | undefined;
  rateLimits: Record<'api' | 'guest' | 'join', RateLimitRule>;
  drive: DriveRoomTuning;
};

const DAY_SECONDS = 24 * 60 * 60;

export function resolveConfig(config: GameServerConfig): ResolvedConfig {
  const nodeEnv = config.nodeEnv ?? 'development';
  return {
    guestTokenSecret: config.guestTokenSecret,
    nodeEnv,
    allowedOrigins: (config.allowedOrigins ?? [])
      .map(normalizeOrigin)
      .filter((origin) => origin !== ''),
    trustProxy: config.trustProxy ?? false,
    webDist: config.webDist,
    guestTokenTtlSeconds: config.guestTokenTtlSeconds ?? 14 * DAY_SECONDS,
    guestTokenRotateSeconds: config.guestTokenRotateSeconds ?? 7 * DAY_SECONDS,
    rateLimits: {
      api: config.rateLimits?.api ?? { windowMs: 60_000, max: 240 },
      guest: config.rateLimits?.guest ?? { windowMs: 60_000, max: 30 },
      join: config.rateLimits?.join ?? { windowMs: 60_000, max: 30 },
    },
    maxRooms: config.maxRooms ?? 200,
    drive: {
      reconnectSeconds: config.drive?.reconnectSeconds ?? 20,
      maxMalformedMessages: config.drive?.maxMalformedMessages ?? 12,
      idleSeconds: config.drive?.idleSeconds ?? 300,
      debugOptions: config.drive?.debugOptions ?? nodeEnv !== 'production',
    },
  };
}

/** Origins compare as `scheme://host[:port]` in lower case without a trailing slash. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export class ConfigError extends Error {}

export type EnvConfig = { port: number; config: GameServerConfig; warnings: string[] };

/**
 * Reads process configuration. Production refuses to start on a missing, default or short
 * signing secret, because every guest identity would then be forgeable.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): EnvConfig {
  const warnings: string[] = [];
  const nodeEnv: NodeEnv =
    env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';

  const rawPort = env.PORT ?? '2567';
  const port = Number(rawPort);
  if (!/^\d{1,5}$/.test(rawPort) || port > 65535) {
    throw new ConfigError(`PORT must be a number between 0 and 65535, but it is "${rawPort}".`);
  }

  let secret = env.GUEST_TOKEN_SECRET ?? '';
  if (nodeEnv === 'production') {
    if (secret === '') throw new ConfigError('GUEST_TOKEN_SECRET must be set in production.');
    if (secret === DEV_GUEST_TOKEN_SECRET) {
      throw new ConfigError(
        'GUEST_TOKEN_SECRET still has the example value. Set a long random secret in production.',
      );
    }
    if (secret.length < PRODUCTION_SECRET_MIN_LENGTH) {
      throw new ConfigError(
        `GUEST_TOKEN_SECRET must be at least ${PRODUCTION_SECRET_MIN_LENGTH} characters long in production.`,
      );
    }
  } else if (secret === '') {
    secret = DEV_GUEST_TOKEN_SECRET;
    warnings.push('GUEST_TOKEN_SECRET is not set. Using the development default.');
  } else if (secret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `GUEST_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`,
    );
  }

  const listedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((origin) => origin !== '');
  for (const origin of listedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new ConfigError(
        `ALLOWED_ORIGINS contains "${origin}", which is not an origin such as https://example.com.`,
      );
    }
  }
  const allowedOrigins =
    listedOrigins.length > 0 || nodeEnv === 'production' ? listedOrigins : DEV_ALLOWED_ORIGINS;

  return {
    port,
    warnings,
    config: {
      guestTokenSecret: secret,
      nodeEnv,
      allowedOrigins,
      trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
      webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : defaultWebDist(),
    },
  };
}

/**
 * `apps/web/dist` relative to this file. Both the source layout (`apps/server/src`) and the
 * bundle (`apps/server/dist`) sit two levels below `apps`, so one relative path serves both.
 */
export function defaultWebDist(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
}
