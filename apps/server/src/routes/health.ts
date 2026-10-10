import { Router } from 'express';
import { CATALOG_VERSION } from '@bolt/content';
import type { HealthResponse } from '@bolt/shared';
import { PROTOCOL_VERSION } from '@bolt/shared';

export type HealthDeps = {
  startedAtMs: number;
  roomCount: () => number;
};

export function healthRoutes(deps: HealthDeps): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      catalogVersion: CATALOG_VERSION,
      uptimeSeconds: Math.floor((Date.now() - deps.startedAtMs) / 1000),
      rooms: deps.roomCount(),
      // PostgreSQL arrives with persistence in Milestone E. Until then nothing depends on it.
      dependencies: { database: 'not_configured' },
    };
    res.set('Cache-Control', 'no-store').json(body);
  });
  return router;
}
