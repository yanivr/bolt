import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type {
  ErrorRequestHandler,
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import express from 'express';
import helmet from 'helmet';
import { ROOM_DRIVE } from '@bolt/shared';
import type { GameServerConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { sendError } from './http/errors.js';
import { installMatchmakeGuard } from './http/matchmakeGuard.js';
import { InMemoryGuestStore } from './persistence/guestStore.js';
import { createDriveRoom } from './rooms/DriveRoom.js';
import { catalogRoutes } from './routes/catalog.js';
import { guestRoutes } from './routes/guest.js';
import { healthRoutes } from './routes/health.js';
import { trackRoutes } from './routes/tracks.js';
import type { GuestSessions } from './security/guestSessions.js';
import { createGuestSessions } from './security/guestSessions.js';
import { createGuestTokenSigner } from './security/guestTokens.js';
import type { OriginPolicy } from './security/origin.js';
import { clientAddress, createOriginPolicy } from './security/origin.js';
import type { RateLimiter } from './security/rateLimiter.js';
import { createRateLimiter, rateLimitKey } from './security/rateLimiter.js';
import type { Logger } from './telemetry/log.js';
import { createLogger, errorFields } from './telemetry/log.js';

export type GameServer = {
  app: Express;
  httpServer: http.Server;
  gameServer: Server;
  /** Starts listening and resolves the bound port, which matters when asking for port 0. */
  listen(port: number, hostname?: string): Promise<number>;
  /** Closes every room and connection. Safe to call more than once. */
  shutdown(): Promise<void>;
};

const JSON_BODY_LIMIT = '16kb';
const MATCHMAKE_BODY_LIMIT_BYTES = 16 * 1024;
const SWEEP_INTERVAL_MS = 60_000;
/** How long shutdown waits for open HTTP connections to finish before cutting them off. */
const HTTP_DRAIN_MS = 2_000;
const HOST_PATTERN = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:]+\](:\d{1,5})?$/;

/**
 * Builds the HTTP API and the real-time server on one `http.Server`, so a single port (and a
 * single reverse-proxy rule) carries pages, API calls and WebSocket traffic.
 */
export function createGameServer(input: GameServerConfig): GameServer {
  const config = resolveConfig(input);
  const logger = input.logger ?? createLogger();
  const startedAtMs = Date.now();

  const origins = createOriginPolicy(config.allowedOrigins);
  const limiters = {
    api: createRateLimiter(config.rateLimits.api),
    guest: createRateLimiter(config.rateLimits.guest),
    join: createRateLimiter(config.rateLimits.join),
  };
  const guests = createGuestSessions({
    signer: createGuestTokenSigner(config.guestTokenSecret),
    store: input.guestStore ?? new InMemoryGuestStore(),
    ttlSeconds: config.guestTokenTtlSeconds,
    rotateWithinSeconds: config.guestTokenRotateSeconds,
  });
  const roomCount = (): number => matchMaker.stats.local.roomCount;

  const app = createExpressApp({
    config,
    logger,
    origins,
    limiters,
    guests,
    startedAtMs,
    roomCount,
  });
  const httpServer = http.createServer(app);

  const transport = new WebSocketTransport({
    server: httpServer,
    // Input packets are a few hundred bytes. Anything larger is not from this game.
    maxPayload: 4 * 1024,
    verifyClient: (info: { origin?: string; req: http.IncomingMessage }) =>
      origins.allows(info.origin || undefined, info.req.headers.host),
  });
  const gameServer = new Server({
    transport,
    greet: false,
    // Signals are handled in main.ts; the library default would call process.exit by itself.
    gracefullyShutdown: false,
    logger: colyseusLogger(logger),
  });
  gameServer.define(
    ROOM_DRIVE,
    createDriveRoom({ guests, logger, tuning: config.drive, maxRooms: config.maxRooms, roomCount }),
  );
  installMatchmakeGuard(httpServer, {
    origins,
    limiter: limiters.join,
    trustProxy: config.trustProxy,
    maxBodyBytes: MATCHMAKE_BODY_LIMIT_BYTES,
    logger,
  });

  const sweepTimer = setInterval(() => {
    limiters.api.sweep();
    limiters.guest.sweep();
    limiters.join.sweep();
    guests
      .sweep()
      .catch((error: unknown) => logger.error('guest_sweep_failed', errorFields(error)));
  }, SWEEP_INTERVAL_MS);
  // Housekeeping alone should never keep the process alive.
  sweepTimer.unref();

  let shuttingDown: Promise<void> | undefined;

  return {
    app,
    httpServer,
    gameServer,
    async listen(port, hostname) {
      await gameServer.listen(port, hostname);
      return (httpServer.address() as AddressInfo).port;
    },
    shutdown() {
      shuttingDown ??= (async () => {
        clearInterval(sweepTimer);
        const wasListening = httpServer.listening;
        const closed = new Promise<void>((resolve) => {
          if (!wasListening) resolve();
          else httpServer.once('close', () => resolve());
        });
        await gameServer.gracefullyShutdown(false);
        // Rooms are gone; what remains are idle keep-alive sockets holding the port open.
        httpServer.closeIdleConnections();
        const forced = setTimeout(() => httpServer.closeAllConnections(), HTTP_DRAIN_MS);
        await closed;
        clearTimeout(forced);
      })();
      return shuttingDown;
    },
  };
}

type AppDeps = {
  config: ResolvedConfig;
  logger: Logger;
  origins: OriginPolicy;
  limiters: Record<'api' | 'guest' | 'join', RateLimiter>;
  guests: GuestSessions;
  startedAtMs: number;
  roomCount: () => number;
};

function createExpressApp(deps: AppDeps): Express {
  const { config, logger, origins } = deps;
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLog(logger));
  app.use(securityHeaders(config));

  const api = express.Router();
  api.use(corsGate(origins, logger));
  api.use(rateLimit(deps.limiters.api, config.trustProxy));
  api.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  api.use(healthRoutes({ startedAtMs: deps.startedAtMs, roomCount: deps.roomCount }));
  api.use(
    guestRoutes({
      guests: deps.guests,
      limit: rateLimit(deps.limiters.guest, config.trustProxy),
      logger,
    }),
  );
  api.use(trackRoutes());
  api.use(catalogRoutes());
  app.use('/api/v1', api);

  const webIndex = config.webDist ? path.join(config.webDist, 'index.html') : undefined;
  if (config.webDist && webIndex && fs.existsSync(webIndex)) {
    logger.info('web_client_served', { webDist: config.webDist });
    app.use(
      express.static(config.webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          // Vite fingerprints everything under /assets, so those files can be cached forever.
          const fingerprinted = filePath.includes(`${path.sep}assets${path.sep}`);
          res.setHeader(
            'Cache-Control',
            fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    // Client-side routes resolve to the app shell. Paths that look like files or API calls
    // fall through to the JSON 404 so a missing asset is never answered with HTML.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || path.extname(req.path) !== '' || !req.accepts('html')) {
        next();
        return;
      }
      res.set('Cache-Control', 'no-cache').sendFile(webIndex);
    });
  }

  app.use((_req, res) => {
    sendError(res, 'NOT_FOUND', 'There is nothing at this address.');
  });
  app.use(errorHandler(logger));
  return app;
}

/** The path only: query strings can carry values that do not belong in logs. */
function loggablePath(req: Request): string {
  return (req.originalUrl.split('?', 1)[0] ?? '').slice(0, 200);
}

function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const requestPath = loggablePath(req);
      const fields = {
        method: req.method,
        path: requestPath,
        status: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100,
      };
      // Health probes arrive every few seconds and would drown everything else out.
      if (requestPath === '/api/v1/health' && res.statusCode < 400)
        logger.debug('http_request', fields);
      else logger.info('http_request', fields);
    });
    next();
  };
}

/**
 * Headers for a WebGL and Web Audio game served from this origin. Phaser decodes images and
 * sounds through blob and data URLs and React sets inline style attributes, which is why
 * those sources appear; scripts stay limited to files this server hosts.
 */
function securityHeaders(config: ResolvedConfig): RequestHandler {
  const production = config.nodeEnv === 'production';
  // 'self' covers same-origin sockets in current browsers, but older Safari releases did not
  // match ws: or wss: against it, so the socket origins are also spelled out.
  const socketSource =
    (scheme: 'ws' | 'wss') =>
    (req: http.IncomingMessage): string => {
      const host = req.headers.host ?? '';
      return HOST_PATTERN.test(host) ? `${scheme}://${host}` : "'self'";
    };
  const listedSockets = config.allowedOrigins.map((origin) => origin.replace(/^http/, 'ws'));

  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'worker-src': ["'self'", 'blob:'],
        'connect-src': [
          "'self'",
          socketSource('ws'),
          socketSource('wss'),
          ...config.allowedOrigins,
          ...listedSockets,
        ],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        // Forcing HTTPS would break plain-HTTP testing from a phone on the local network.
        ...(production ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    // Allow-listed development origins on another port still need to read API responses.
    crossOriginResourcePolicy: { policy: 'same-site' },
    strictTransportSecurity: production ? { maxAge: 15552000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

function corsGate(origins: OriginPolicy, logger: Logger): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    res.vary('Origin');
    if (!origins.allows(origin, req.headers.host)) {
      logger.warn('origin_refused', {
        origin: String(origin).slice(0, 200),
        path: loggablePath(req),
      });
      sendError(res, 'UNAUTHORIZED', 'This origin is not allowed to use the game API.', 403);
      return;
    }
    if (origin !== undefined && origins.isListed(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    if (req.method === 'OPTIONS') {
      res
        .set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        .set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        .set('Access-Control-Max-Age', '600')
        .status(204)
        .end();
      return;
    }
    next();
  };
}

function rateLimit(limiter: RateLimiter, trustProxy: boolean): RequestHandler {
  return (req, res, next) => {
    const decision = limiter.hit(rateLimitKey(clientAddress(req, trustProxy)));
    res
      .set('RateLimit-Limit', String(decision.limit))
      .set('RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      res.set('Retry-After', String(decision.retryAfterSeconds));
      sendError(res, 'RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
      return;
    }
    next();
  };
}

function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    // body-parser and the static file handler describe client mistakes with a 4xx status on
    // the error object. Anything without one is a bug on this side.
    const status =
      typeof error === 'object' && error !== null
        ? Number((error as { status?: unknown }).status)
        : Number.NaN;
    if (status === 413) {
      sendError(res, 'BAD_REQUEST', 'The request body is too large.', 413);
      return;
    }
    if (status >= 400 && status < 500) {
      sendError(res, 'BAD_REQUEST', 'The request could not be understood.', 400);
      return;
    }
    logger.error('http_unhandled_error', {
      method: req.method,
      path: loggablePath(req),
      ...errorFields(error),
    });
    sendError(res, 'INTERNAL', 'Something went wrong on the server. Try again in a moment.');
  };
}

/** Routes the library's own console-style output through the structured logger. */
function colyseusLogger(
  logger: Logger,
): Record<'debug' | 'info' | 'log' | 'warn' | 'error' | 'trace', (...args: unknown[]) => void> {
  const text = (args: unknown[]): string =>
    args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ');
  return {
    debug: (...args) => logger.debug('colyseus', { message: text(args) }),
    trace: (...args) => logger.debug('colyseus', { message: text(args) }),
    info: (...args) => logger.info('colyseus', { message: text(args) }),
    log: (...args) => logger.info('colyseus', { message: text(args) }),
    warn: (...args) => logger.warn('colyseus', { message: text(args) }),
    error: (...args) => logger.error('colyseus', { message: text(args) }),
  };
}
