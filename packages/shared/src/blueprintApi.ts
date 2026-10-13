import { z } from 'zod';
import { blueprintSchema } from './blueprint.js';
import { CAR_CODE_PATTERN } from './carCode.js';

/**
 * HTTP contract of the blueprint endpoints (Section 15.7). Requests are parsed with these
 * schemas on the server; responses are parsed with them on the client, so neither side trusts
 * the other's JSON.
 */

/** A client-chosen id that makes `POST /api/v1/blueprints` idempotent. */
export const requestIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createBlueprintRequestSchema = z
  .object({
    requestId: requestIdSchema,
    // Parsed again by the validator with its size bound; this only refuses the wrong shape early.
    blueprint: z.unknown(),
  })
  .strict();
export type CreateBlueprintRequest = { requestId: string; blueprint: unknown };

export const carCodeSchema = z.string().regex(CAR_CODE_PATTERN);
/** Server record ids are UUIDs. */
export const blueprintRecordIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isoTimeSchema = z.string().min(10).max(40);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const versionSchema = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[0-9A-Za-z.+-]+$/);

/** What the owner gets back for a code: never the canonical JSON of someone else. */
export const blueprintCodeRecordSchema = z
  .object({
    id: blueprintRecordIdSchema,
    code: carCodeSchema,
    name: z.string().min(1).max(24),
    buildHash: hashSchema,
    catalogVersion: versionSchema,
    createdAt: isoTimeSchema,
  })
  .strict();
export type BlueprintCodeRecord = z.infer<typeof blueprintCodeRecordSchema>;

/** `POST /api/v1/blueprints`: 201 for a new code, 200 when the same car already has one. */
export const createBlueprintResponseSchema = blueprintCodeRecordSchema
  .extend({ reused: z.boolean() })
  .strict();
export type CreateBlueprintResponse = z.infer<typeof createBlueprintResponseSchema>;

/**
 * `GET /api/v1/blueprints/:code`: the public view of a shared car. Only what the car is, never
 * who made it. `stale` is true when the catalog has moved on since it was shared; the client
 * then shows the approved older-part-values line and its repair flow.
 */
export const publicBlueprintResponseSchema = z
  .object({
    code: carCodeSchema,
    blueprint: blueprintSchema,
    buildHash: hashSchema,
    catalogVersion: versionSchema,
    currentCatalogVersion: versionSchema,
    stale: z.boolean(),
    createdAt: isoTimeSchema,
  })
  .strict();
export type PublicBlueprintResponse = z.infer<typeof publicBlueprintResponseSchema>;

/** `GET /api/v1/me/blueprints`: the guest's own live codes, newest first. */
export const myBlueprintsResponseSchema = z
  .object({
    blueprints: z.array(blueprintCodeRecordSchema.extend({ stale: z.boolean() }).strict()),
  })
  .strict();
export type MyBlueprintsResponse = z.infer<typeof myBlueprintsResponseSchema>;
