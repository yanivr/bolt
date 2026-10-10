import type { RequestHandler } from 'express';
import { Router } from 'express';
import type { GuestSessions } from '../security/guestSessions.js';
import type { Logger } from '../telemetry/log.js';

export type GuestDeps = {
  guests: GuestSessions;
  /** Stricter limiter than the general API one, since each call can mint an identity. */
  limit: RequestHandler;
  logger: Logger;
};

/** The character class matches the token alphabet, so anything else is simply "no token". */
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._-]{16,512})$/;

export function guestRoutes(deps: GuestDeps): Router {
  const router = Router();
  router.post('/guest', deps.limit, (req, res, next) => {
    const presented = BEARER_PATTERN.exec(req.headers.authorization ?? '')?.[1];
    deps.guests
      .refresh(presented)
      .then(({ session, outcome }) => {
        deps.logger.info('guest_session', { outcome, guestId: session.guestId });
        res
          .status(outcome === 'created' ? 201 : 200)
          .set('Cache-Control', 'no-store')
          .json(session);
      })
      .catch(next);
  });
  return router;
}
