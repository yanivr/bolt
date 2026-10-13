import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { JOIN_ERROR_CODES, JOIN_ERROR_MESSAGES } from '../rooms/driveJoin.js';
import type { OriginPolicy } from '../security/origin.js';
import { clientAddress } from '../security/origin.js';
import type { RateLimiter } from '../security/rateLimiter.js';
import { rateLimitKey } from '../security/rateLimiter.js';
import type { Logger } from '../telemetry/log.js';

/**
 * Colyseus answers its matchmaking endpoint itself, ahead of Express, and that built-in
 * handler accepts any origin, reads request bodies without a size limit, claims every URL
 * that merely contains "/matchmake", and never answers methods it does not expect. This
 * guard sits in front of it and lets through only well-formed, rate-limited join requests.
 */

export type MatchmakeGuardOptions = {
  origins: OriginPolicy;
  limiter: RateLimiter;
  trustProxy: boolean;
  maxBodyBytes: number;
  logger: Logger;
  /**
   * Room names that `create` and `joinOrCreate` may name. Others are reached another way (a
   * match room only through its code) and only `reconnect` is let through for them.
   */
  creatableRooms?: readonly string[];
};

const MATCHMAKE_MARKER = '/matchmake';
/** The only calls the solo drive client makes. Room ids and names use this alphabet. */
const ALLOWED_PATH = /^\/matchmake\/(joinOrCreate|create|reconnect)\/[A-Za-z0-9_-]{1,64}$/;

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

/** Must be called after the Colyseus server is constructed, so that its handler gets wrapped. */
export function installMatchmakeGuard(server: HttpServer, options: MatchmakeGuardOptions): void {
  const inner = server.listeners('request').slice() as RequestListener[];
  server.removeAllListeners('request');

  const forward: RequestListener = (req, res) => {
    for (const listener of inner) listener.call(server, req, res);
  };

  // Failures use the `{ code, error }` body colyseus.js already understands, so the client
  // surfaces the message the same way it does for errors raised inside a room.
  const refuse = (
    res: ServerResponse,
    status: number,
    code: number,
    error: string,
    headers: Record<string, string> = {},
  ): void => {
    const body = JSON.stringify({ code, error });
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(body);
  };

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    if (!url.includes(MATCHMAKE_MARKER)) {
      forward(req, res);
      return;
    }

    const path = url.split('?', 1)[0] ?? '';
    const method = req.method ?? '';
    const [, , action = '', target = ''] = path.split('/');
    const creatable =
      action === 'reconnect' ||
      options.creatableRooms === undefined ||
      options.creatableRooms.includes(target);
    if (!ALLOWED_PATH.test(path) || !creatable || (method !== 'POST' && method !== 'OPTIONS')) {
      refuse(res, 404, JOIN_ERROR_CODES.BAD_REQUEST, 'There is nothing at this address.');
      return;
    }
    if (!options.origins.allows(req.headers.origin, req.headers.host)) {
      options.logger.warn('matchmake_origin_refused', {
        origin: String(req.headers.origin).slice(0, 200),
      });
      refuse(
        res,
        403,
        JOIN_ERROR_CODES.UNAUTHORIZED,
        'This origin is not allowed to join games on this server.',
      );
      return;
    }
    if (method === 'OPTIONS') {
      forward(req, res);
      return;
    }

    const decision = options.limiter.hit(rateLimitKey(clientAddress(req, options.trustProxy)));
    if (!decision.allowed) {
      refuse(res, 429, JOIN_ERROR_CODES.RATE_LIMITED, JOIN_ERROR_MESSAGES.RATE_LIMITED, {
        'Retry-After': String(decision.retryAfterSeconds),
        ...corsHeaders(req, options.origins),
      });
      return;
    }

    const tooLarge = (): void => {
      refuse(res, 413, JOIN_ERROR_CODES.BAD_REQUEST, 'The join request is too large.', {
        Connection: 'close',
        ...corsHeaders(req, options.origins),
      });
    };
    const declared = Number(req.headers['content-length'] ?? 0);
    if (!Number.isFinite(declared) || declared > options.maxBodyBytes) {
      tooLarge();
      return;
    }
    // A chunked body declares no length, so it is also counted as it streams in. Destroying
    // the request stops Colyseus from ever seeing its end and answering a second time.
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > options.maxBodyBytes && !res.headersSent) {
        req.pause();
        res.once('finish', () => req.destroy());
        tooLarge();
      }
    });
    forward(req, res);
  });
}

function corsHeaders(req: IncomingMessage, origins: OriginPolicy): Record<string, string> {
  const origin = req.headers.origin;
  if (!origins.isListed(origin) || origin === undefined) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}
