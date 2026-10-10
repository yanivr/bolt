import { Router } from 'express';
import { CATALOG, CATALOG_VERSION, TEMPLATES } from '@bolt/content';
import type { BlueprintTemplate } from '@bolt/content';
import type {
  AccessoryDefinition,
  ChassisDefinition,
  EngineDefinition,
  PaintOption,
  TireDefinition,
} from '@bolt/shared';
import { PROTOCOL_VERSION, STARTING_CREDITS } from '@bolt/shared';

/**
 * The current content manifest and balance version (Section 15.7): all 120 parts with every
 * field the rules use, the paints and the shipped blueprints. The client bundles the same
 * data; this route is what lets a tool or a stale client see what the server will accept.
 */
export type CatalogResponse = {
  catalogVersion: string;
  protocolVersion: number;
  startingCredits: number;
  chassis: ChassisDefinition[];
  engines: EngineDefinition[];
  tires: TireDefinition[];
  weapons: AccessoryDefinition[];
  defenses: AccessoryDefinition[];
  utilities: AccessoryDefinition[];
  paints: PaintOption[];
  templates: BlueprintTemplate[];
};

export function buildCatalogResponse(): CatalogResponse {
  const accessories = Object.values(CATALOG.parts);
  return {
    catalogVersion: CATALOG_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    startingCredits: STARTING_CREDITS,
    chassis: Object.values(CATALOG.chassis),
    engines: Object.values(CATALOG.engines),
    tires: Object.values(CATALOG.tires),
    weapons: accessories.filter((p) => p.category === 'weapon'),
    defenses: accessories.filter((p) => p.category === 'defense'),
    utilities: accessories.filter((p) => p.category === 'utility'),
    paints: Object.values(CATALOG.paints),
    templates: TEMPLATES,
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
