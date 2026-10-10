import { Router } from 'express';
import { CATALOG_VERSION, CHASSIS, ENGINES, PAINTS, TIRES } from '@bolt/content';
import type { ChassisDefinition, EngineDefinition, TireDefinition } from '@bolt/shared';
import { PROTOCOL_VERSION } from '@bolt/shared';

export type CatalogResponse = {
  catalogVersion: string;
  protocolVersion: number;
  chassis: ChassisDefinition[];
  engines: EngineDefinition[];
  tires: TireDefinition[];
  paints: Array<{ id: string; displayName: string }>;
};

export function buildCatalogResponse(): CatalogResponse {
  return {
    catalogVersion: CATALOG_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    chassis: Object.values(CHASSIS),
    engines: Object.values(ENGINES),
    tires: Object.values(TIRES),
    paints: Object.values(PAINTS),
  };
}

export function catalogRoutes(): Router {
  const router = Router();
  const body = buildCatalogResponse();
  router.get('/catalog', (_req, res) => {
    res.set('Cache-Control', 'no-cache').json(body);
  });
  return router;
}
