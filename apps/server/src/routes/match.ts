import type { AuthContext } from '@colyseus/core';
import { matchMaker } from '@colyseus/core';
import type { RequestHandler, Router } from 'express';
import express from 'express';
import type { MatchJoinResponse, MatchSeatOptions } from '@bolt/shared';
import {
  PROTOCOL_VERSION,
  ROOM_MATCH,
  createMatchRequestSchema,
  isMatchCode,
  joinMatchRequestSchema,
  normalizeMatchCode,
} from '@bolt/shared';
import { sendError } from '../http/errors.js';
import type { MatchCodeRegistry } from '../rooms/matchCodes.js';
import { JOIN_ERROR_CODES, JOIN_ERROR_MESSAGES } from '../rooms/driveJoin.js';
import type { GuestSessions } from '../security/guestSessions.js';
import { clientAddress } from '../security/origin.js';
import type { RateLimiter } from '../security/rateLimiter.js';
import { rateLimitKey } from '../security/rateLimiter.js';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';

/**
 * Race a Friend over HTTP (Sections 3.2 and 15.7): open a lobby, or take the second seat of the
 * one a code names. Each answer carries a seat reservation that colyseus.js turns into the
 * room's socket (`consumeSeatReservation`). These are the only ways into a match room.
 *
 * Abuse (Section 19.6). Opening lobbies is limited per address. Joining is the code-guessing
 * surface, so every join attempt, right or wrong, counts against both the caller's address
 * and its guest identity, and a wrong code is answered exactly like an expired one. With
 * 30^6 codes, a few hundred open lobbies and 20 tries a minute, a guesser's chance of hitting
 * any lobby in its 15-minute life is about one in a million.
 */

/** Approved copy (Section 5.4). */
export const INVITE_EXPIRED_COPY = 'This invite has expired. Ask your friend for a new link.';
export const LOBBY_FULL_COPY = 'This lobby is full. Ask your friend for a new link.';
export const ALREADY_SEATED_COPY = 'You are already in this lobby on another screen.';

export type MatchRouteDeps = {
  guests: GuestSessions;
  codes: MatchCodeRegistry;
  /** Lobbies opened, per address. */
  createLimit: RateLimiter;
  /** Join attempts (code guesses), per address and per guest. */
  codeLimit: RateLimiter;
  trustProxy: boolean;
  logger: Logger;
};

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{16,512})$/.exec(header.trim());
  return match?.[1];
}

type Reservation = Awaited<ReturnType<typeof matchMaker.create>>;

/** The matchmaker hands this to the room's `onAuth`. The guest token travels in the options. */
function authContext(req: Parameters<RequestHandler>[0]): AuthContext {
  return {
    token: undefined,
    headers: req.headers,
    ip: req.socket.remoteAddress ?? '',
  } as AuthContext;
}

function seatOf(reservation: Reservation): MatchJoinResponse['reservation'] {
  return {
    room: {
      roomId: reservation.room.roomId,
      processId: reservation.room.processId,
      name: reservation.room.name,
    },
    sessionId: reservation.sessionId,
  };
}

/** Colyseus join refusals carry a number; turn the ones a room raises into API errors. */
function refusalOf(error: unknown): { status: number; code: string; message: string } | null {
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof code !== 'number') return null;
  if (code === JOIN_ERROR_CODES.UNAUTHORIZED)
    return { status: 401, code: 'UNAUTHORIZED', message: JOIN_ERROR_MESSAGES.UNAUTHORIZED };
  if (code === JOIN_ERROR_CODES.VERSION_MISMATCH)
    return { status: 409, code: 'VERSION_MISMATCH', message: JOIN_ERROR_MESSAGES.VERSION_MISMATCH };
  if (code === JOIN_ERROR_CODES.SERVER_FULL)
    return { status: 503, code: 'SERVER_FULL', message: JOIN_ERROR_MESSAGES.SERVER_FULL };
  if (code === JOIN_ERROR_CODES.ILLEGAL_BUILD || code === JOIN_ERROR_CODES.UNKNOWN_PART)
    return {
      status: 422,
      code: 'ILLEGAL_BUILD',
      message: typeof message === 'string' ? message : JOIN_ERROR_MESSAGES.ILLEGAL_BUILD,
    };
  if (code === JOIN_ERROR_CODES.CATALOG_MISMATCH)
    return { status: 409, code: 'CATALOG_MISMATCH', message: JOIN_ERROR_MESSAGES.CATALOG_MISMATCH };
  if (code === JOIN_ERROR_CODES.BAD_REQUEST)
    return { status: 400, code: 'BAD_REQUEST', message: JOIN_ERROR_MESSAGES.BAD_REQUEST };
  return null;
}

export function matchRoutes(deps: MatchRouteDeps): Router {
  const router = express.Router();
  const address = (req: Parameters<RequestHandler>[0]): string =>
    rateLimitKey(clientAddress(req, deps.trustProxy));

  const limited = (
    res: Parameters<RequestHandler>[1],
    decision: { allowed: boolean; retryAfterSeconds: number },
  ): boolean => {
    if (decision.allowed) return false;
    res.set('Retry-After', String(decision.retryAfterSeconds));
    sendError(res, 'RATE_LIMITED', 'Too many tries. Wait a moment and try again.');
    return true;
  };

  /** Shared checks for both routes: the guest, the protocol, the build. */
  const admit = async (
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
  ): Promise<{ token: string; guestId: string } | null> => {
    const version = (req.body as { protocolVersion?: unknown } | null)?.protocolVersion;
    if (version !== PROTOCOL_VERSION) {
      sendError(res, 'VERSION_MISMATCH', JOIN_ERROR_MESSAGES.VERSION_MISMATCH);
      return null;
    }
    const token = bearer(req.headers.authorization);
    const guest = token ? await deps.guests.authenticate(token) : null;
    if (!token || !guest) {
      sendError(res, 'UNAUTHORIZED', JOIN_ERROR_MESSAGES.UNAUTHORIZED);
      return null;
    }
    return { token, guestId: guest.guestId };
  };

  router.post('/match', async (req, res, next) => {
    try {
      if (limited(res, deps.createLimit.hit(address(req)))) return;
      const who = await admit(req, res);
      if (!who) return;
      const parsed = createMatchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 'BAD_REQUEST', 'The request could not be understood.');
        return;
      }
      const options: MatchSeatOptions = {
        protocolVersion: PROTOCOL_VERSION,
        guestToken: who.token,
        intent: 'create',
        profile: parsed.data.profile,
        blueprint: parsed.data.blueprint,
      };
      let reservation: Reservation;
      try {
        reservation = await matchMaker.create(ROOM_MATCH, options, authContext(req));
      } catch (error) {
        const refusal = refusalOf(error);
        if (!refusal) throw error;
        res
          .status(refusal.status)
          .set('Cache-Control', 'no-store')
          .json({
            error: { code: refusal.code, message: refusal.message },
          });
        return;
      }
      const code = deps.codes.codeOf(reservation.room.roomId) ?? '';
      deps.logger.info('match_lobby_opened', {
        guestId: who.guestId,
        roomId: reservation.room.roomId,
      });
      res
        .status(201)
        .set('Cache-Control', 'no-store')
        .json({ reservation: seatOf(reservation), code } satisfies MatchJoinResponse);
    } catch (error) {
      next(error);
    }
  });

  router.post('/match/join', async (req, res, next) => {
    try {
      // Counted before anything is looked at: a malformed or wrong code is still a guess.
      if (limited(res, deps.codeLimit.hit(`ip:${address(req)}`))) return;
      const who = await admit(req, res);
      if (!who) return;
      if (limited(res, deps.codeLimit.hit(`guest:${who.guestId}`))) return;
      const parsed = joinMatchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 'BAD_REQUEST', 'The request could not be understood.');
        return;
      }
      const code = normalizeMatchCode(parsed.data.code);
      const roomId = isMatchCode(code) ? deps.codes.lookup(code) : undefined;
      if (!roomId) {
        sendError(res, 'INVITE_EXPIRED', INVITE_EXPIRED_COPY);
        return;
      }
      const verdict = (await matchMaker
        .remoteRoomCall(roomId, 'canSeat', [who.guestId])
        .catch(() => 'closed')) as string;
      if (verdict === 'closed') {
        sendError(res, 'INVITE_EXPIRED', INVITE_EXPIRED_COPY);
        return;
      }
      if (verdict === 'already_seated') {
        sendError(res, 'LOBBY_FULL', ALREADY_SEATED_COPY);
        return;
      }
      if (verdict !== 'ok') {
        sendError(res, 'LOBBY_FULL', LOBBY_FULL_COPY);
        return;
      }
      const options: MatchSeatOptions = {
        protocolVersion: PROTOCOL_VERSION,
        guestToken: who.token,
        intent: 'join',
        code,
        profile: parsed.data.profile,
        blueprint: parsed.data.blueprint,
      };
      let reservation: Reservation;
      try {
        reservation = await matchMaker.joinById(roomId, options, authContext(req));
      } catch (error) {
        const refusal = refusalOf(error);
        if (refusal) {
          res
            .status(refusal.status)
            .set('Cache-Control', 'no-store')
            .json({
              error: { code: refusal.code, message: refusal.message },
            });
          return;
        }
        // The room filled or closed between the check and the reservation.
        deps.logger.info('match_join_lost_race', { roomId, ...errorFields(error) });
        sendError(res, 'LOBBY_FULL', LOBBY_FULL_COPY);
        return;
      }
      deps.logger.info('match_lobby_joined', { guestId: who.guestId, roomId });
      res
        .status(200)
        .set('Cache-Control', 'no-store')
        .json({ reservation: seatOf(reservation), code } satisfies MatchJoinResponse);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Invite links, `/join/<code>`: redirected into the app as `/?join=<code>` before the static
 * files, so the page loads from the root whatever path the link had. Only code symbols are
 * passed along; the rest of the query string is kept as it was.
 */
export function matchLinks(): Router {
  const links = express.Router();
  links.get('/join/:code', (req, res) => {
    const code = String(req.params.code ?? '')
      .slice(0, 32)
      .replace(/[^A-Za-z0-9-]/g, '');
    const rest = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
      : '';
    const query = new URLSearchParams(rest);
    query.delete('join');
    const tail = query.toString();
    res
      .set('Cache-Control', 'no-store')
      .redirect(302, `/?join=${encodeURIComponent(code)}${tail ? `&${tail}` : ''}`);
  });
  return links;
}
