import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import type {
  BlueprintCodeRecord,
  CreateBlueprintResponse,
  MyBlueprintsResponse,
  PublicBlueprintResponse,
} from '@bolt/shared';
import {
  BLUEPRINT_ISSUE_COPY,
  blueprintRecordIdSchema,
  createBlueprintRequestSchema,
  normalizeCarCode,
} from '@bolt/shared';
import type { BlueprintService } from '../db/blueprintService.js';
import type { BlueprintRecord, Persistence } from '../db/types.js';
import { sendError } from '../http/errors.js';
import type { GuestSessions } from '../security/guestSessions.js';
import { clientAddress } from '../security/origin.js';
import type { RateLimitRule } from '../security/rateLimiter.js';
import { createRateLimiter, rateLimitKey } from '../security/rateLimiter.js';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';

/**
 * Blueprint endpoints (Section 15.7):
 *
 *   POST   /blueprints            validate, save and issue a short code (guest token)
 *   GET    /blueprints/:code      the public, canonical car behind a code (anyone)
 *   GET    /me/blueprints         the guest's own live codes
 *   DELETE /me/blueprints/:id     soft-delete one of them
 *   DELETE /me                    delete the guest and everything that is theirs (Section 16)
 *
 * And outside the API, `GET /car/:code`, the share link, which sends the browser to the app
 * with the code in the query (`/?car=CAR-...`), where the Load Code overlay opens.
 */

export type BlueprintRouteLimits = {
  /** Code creations per guest. */
  createPerGuest: RateLimitRule;
  /** Lookups per client address. */
  lookupPerAddress: RateLimitRule;
  /**
   * Failed lookups (bad checksum, unknown code) per client address. Past it, every lookup from
   * that address is refused until the window ends: the defense against walking the code space.
   */
  missesPerAddress: RateLimitRule;
  /** Deletions and listings per guest. */
  ownerCallsPerGuest: RateLimitRule;
};

export const DEFAULT_BLUEPRINT_ROUTE_LIMITS: BlueprintRouteLimits = {
  createPerGuest: { windowMs: 60_000, max: 10 },
  lookupPerAddress: { windowMs: 60_000, max: 30 },
  missesPerAddress: { windowMs: 10 * 60_000, max: 20 },
  ownerCallsPerGuest: { windowMs: 60_000, max: 60 },
};

export type BlueprintRouteDeps = {
  service: BlueprintService;
  persistence: Persistence;
  guests: GuestSessions;
  logger: Logger;
  trustProxy: boolean;
  catalogVersion: string;
  limits?: Partial<BlueprintRouteLimits>;
};

/** Player copy, all full sentences (approved Section 18.1 lines where one exists). */
export const ROUTE_COPY = {
  invalidCode: "We couldn't find that car. Check the code and try again.",
  outdated: BLUEPRINT_ISSUE_COPY.CATALOG_MISMATCH,
  noGuest: 'Your guest pass is missing or has expired. Reload the game and try again.',
  badBody: 'The request could not be understood.',
  notYours: 'There is no saved car with that id.',
  tooMany: 'Too many requests. Wait a moment and try again.',
  tooManyMisses: 'Too many codes that did not match a car. Wait a few minutes and try again.',
  unavailable: 'Saved cars are not available right now. Try again in a moment.',
} as const;

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._-]{16,512})$/;
/** Generous upper bound on a code as typed in a URL before normalizing. */
const MAX_CODE_PARAM = 64;

function owned(record: BlueprintRecord): BlueprintCodeRecord {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    buildHash: record.buildHash,
    catalogVersion: record.catalogVersion,
    createdAt: record.createdAt.toISOString(),
  };
}

export type BlueprintRoutes = { api: Router; links: Router; sweep(): void };

export function blueprintRoutes(deps: BlueprintRouteDeps): BlueprintRoutes {
  const limits = { ...DEFAULT_BLUEPRINT_ROUTE_LIMITS, ...deps.limits };
  const createLimiter = createRateLimiter(limits.createPerGuest);
  const lookupLimiter = createRateLimiter(limits.lookupPerAddress);
  const missLimiter = createRateLimiter(limits.missesPerAddress);
  const ownerLimiter = createRateLimiter(limits.ownerCallsPerGuest);
  /** Addresses refused for guessing, until the time stored. */
  const blocked = new Map<string, number>();

  const limited = (
    res: Response,
    retryAfterSeconds: number,
    message: string = ROUTE_COPY.tooMany,
  ) => {
    res.set('Retry-After', String(retryAfterSeconds));
    sendError(res, 'RATE_LIMITED', message);
  };

  /** Any storage failure is a 503 with plain copy; the details go to the log only. */
  const guard =
    (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req: Request, res: Response, next: NextFunction) => {
      handler(req, res).catch((error: unknown) => {
        if (res.headersSent) {
          next(error);
          return;
        }
        deps.logger.error('blueprint_store_failed', {
          path: req.path.slice(0, 80),
          ...errorFields(error),
        });
        sendError(res, 'INTERNAL', ROUTE_COPY.unavailable, 503);
      });
    };

  /** The guest behind the bearer token, or a 401 already sent. */
  const guestOf = async (req: Request, res: Response): Promise<string | null> => {
    const token = BEARER_PATTERN.exec(req.headers.authorization ?? '')?.[1];
    const guest = token ? await deps.guests.authenticate(token) : null;
    if (!guest) {
      sendError(res, 'UNAUTHORIZED', ROUTE_COPY.noGuest);
      return null;
    }
    return guest.guestId;
  };

  const api = Router();

  api.post(
    '/blueprints',
    guard(async (req, res) => {
      const body = createBlueprintRequestSchema.safeParse(req.body);
      if (!body.success) {
        sendError(res, 'BAD_REQUEST', ROUTE_COPY.badBody);
        return;
      }
      const guestId = await guestOf(req, res);
      if (!guestId) return;
      const gate = createLimiter.hit(`g:${guestId}`);
      if (!gate.allowed) {
        limited(res, gate.retryAfterSeconds);
        return;
      }
      const outcome = await deps.service.create(guestId, body.data.requestId, body.data.blueprint);
      if (!outcome.ok) {
        switch (outcome.reason) {
          case 'malformed':
          case 'request_conflict':
            sendError(res, 'BAD_REQUEST', outcome.message);
            return;
          case 'catalog':
            sendError(res, 'CATALOG_MISMATCH', outcome.message);
            return;
          case 'unknown_part':
            sendError(res, 'UNKNOWN_PART', outcome.message, 422);
            return;
          case 'illegal':
            sendError(res, 'ILLEGAL_BUILD', outcome.message);
            return;
          case 'quota':
          case 'daily_limit':
            limited(res, outcome.reason === 'daily_limit' ? 3600 : 60, outcome.message);
            return;
          case 'codes_exhausted':
            sendError(res, 'INTERNAL', outcome.message, 503);
            return;
        }
      }
      deps.logger.info('blueprint_code', {
        guestId,
        code: outcome.record.code,
        reused: outcome.reused,
      });
      const response: CreateBlueprintResponse = {
        ...owned(outcome.record),
        reused: outcome.reused,
      };
      res
        .status(outcome.reused ? 200 : 201)
        .set('Cache-Control', 'no-store')
        .json(response);
    }),
  );

  api.get(
    '/blueprints/:code',
    guard(async (req, res) => {
      const address = rateLimitKey(clientAddress(req, deps.trustProxy));
      const until = blocked.get(address);
      if (until !== undefined) {
        if (until > Date.now()) {
          limited(
            res,
            Math.max(1, Math.ceil((until - Date.now()) / 1000)),
            ROUTE_COPY.tooManyMisses,
          );
          return;
        }
        blocked.delete(address);
      }
      const gate = lookupLimiter.hit(address);
      if (!gate.allowed) {
        limited(res, gate.retryAfterSeconds);
        return;
      }
      const miss = (status: 'invalid' | 'not_found') => {
        const count = missLimiter.hit(address);
        if (!count.allowed) {
          blocked.set(address, Date.now() + count.retryAfterSeconds * 1000);
          limited(res, count.retryAfterSeconds, ROUTE_COPY.tooManyMisses);
          return;
        }
        if (status === 'invalid') sendError(res, 'BAD_REQUEST', ROUTE_COPY.invalidCode);
        else sendError(res, 'NOT_FOUND', ROUTE_COPY.invalidCode);
      };
      const raw = typeof req.params.code === 'string' ? req.params.code : '';
      if (raw.length > MAX_CODE_PARAM) {
        miss('invalid');
        return;
      }
      const outcome = await deps.service.lookup(raw);
      if (!outcome.ok) {
        miss(outcome.reason);
        return;
      }
      const response: PublicBlueprintResponse = {
        code: outcome.record.code,
        blueprint: outcome.blueprint,
        buildHash: outcome.record.buildHash,
        catalogVersion: outcome.record.catalogVersion,
        currentCatalogVersion: deps.catalogVersion,
        stale: outcome.stale,
        createdAt: outcome.record.createdAt.toISOString(),
      };
      // Not cached anywhere: a code deleted by its owner must stop resolving at once.
      res.set('Cache-Control', 'no-store').json(response);
    }),
  );

  /** Owner calls share one per-guest limiter. */
  const ownerGate = async (req: Request, res: Response): Promise<string | null> => {
    const guestId = await guestOf(req, res);
    if (!guestId) return null;
    const gate = ownerLimiter.hit(`g:${guestId}`);
    if (!gate.allowed) {
      limited(res, gate.retryAfterSeconds);
      return null;
    }
    return guestId;
  };

  api.get(
    '/me/blueprints',
    guard(async (req, res) => {
      const guestId = await ownerGate(req, res);
      if (!guestId) return;
      const records = await deps.service.listMine(guestId);
      const response: MyBlueprintsResponse = {
        blueprints: records.map((r) => ({ ...owned(r), stale: deps.service.isStale(r) })),
      };
      res.set('Cache-Control', 'no-store').json(response);
    }),
  );

  api.delete(
    '/me/blueprints/:id',
    guard(async (req, res) => {
      const id = blueprintRecordIdSchema.safeParse(req.params.id);
      if (!id.success) {
        sendError(res, 'BAD_REQUEST', ROUTE_COPY.badBody);
        return;
      }
      const guestId = await ownerGate(req, res);
      if (!guestId) return;
      // Another guest's record and a missing one answer alike, so ids cannot be probed.
      if (!(await deps.service.deleteMine(guestId, id.data))) {
        sendError(res, 'NOT_FOUND', ROUTE_COPY.notYours);
        return;
      }
      deps.logger.info('blueprint_deleted', { guestId });
      res.status(204).set('Cache-Control', 'no-store').end();
    }),
  );

  api.delete(
    '/me',
    guard(async (req, res) => {
      const guestId = await ownerGate(req, res);
      if (!guestId) return;
      const removed = await deps.persistence.deleteGuest(guestId);
      deps.logger.info('guest_deleted', { blueprints: removed });
      res.status(204).set('Cache-Control', 'no-store').end();
    }),
  );

  const links = Router();
  links.get('/car/:code', (req, res) => {
    const raw = String(req.params.code ?? '').slice(0, MAX_CODE_PARAM);
    // A link that is not a valid code still lands on the app, where Load Code shows what was
    // in it and says what is wrong. Only letters, digits and dashes are passed along.
    const code = normalizeCarCode(raw) ?? raw.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
    const target = `/?car=${encodeURIComponent(code)}`;
    res.set('Cache-Control', 'no-store').redirect(302, target);
  });

  return {
    api,
    links,
    sweep() {
      createLimiter.sweep();
      lookupLimiter.sweep();
      missLimiter.sweep();
      ownerLimiter.sweep();
      const t = Date.now();
      for (const [address, until] of blocked) if (until <= t) blocked.delete(address);
    },
  };
}
