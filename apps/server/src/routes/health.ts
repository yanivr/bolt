import { Router } from 'express';
import { CATALOG_VERSION } from '@bolt/content';
import type { HealthResponse } from '@bolt/shared';
import { PROTOCOL_VERSION } from '@bolt/shared';

export type HealthDeps = {
  startedAtMs: number;
  roomCount: () => number;
  /** PostgreSQL state, or `not_configured` when the server runs on in-memory storage. */
  database?: () => Promise<'ok' | 'unavailable' | 'not_configured'>;
};

export function healthRoutes(deps: HealthDeps): Router {
  const router = Router();
  router.get('/health', (_req, res, next) => {
    void (deps.database?.() ?? Promise.resolve('not_configured' as const))
      .catch(() => 'unavailable' as const)
      .then((database) => {
        const body: HealthResponse = {
          status: database === 'unavailable' ? 'degraded' : 'ok',
          protocolVersion: PROTOCOL_VERSION,
          catalogVersion: CATALOG_VERSION,
          uptimeSeconds: Math.floor((Date.now() - deps.startedAtMs) / 1000),
          rooms: deps.roomCount(),
          dependencies: { database },
        };
        res.set('Cache-Control', 'no-store').json(body);
      })
      .catch(next);
  });
  return router;
}
