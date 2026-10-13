import { randomBytes, randomUUID } from 'node:crypto';
import type { BlueprintIssue, Catalog, VehicleBlueprint } from '@bolt/shared';
import {
  BLUEPRINT_ISSUE_COPY,
  generateCarCode,
  readCarCode,
  sanitizeBlueprintName,
  serializeBlueprint,
  validateUntrustedBlueprint,
} from '@bolt/shared';
import type { BlueprintRecord, BlueprintRepository } from './types.js';
import { UniqueViolation } from './types.js';

/**
 * Short car codes on top of the blueprint repository (Section 15.6). The server re-validates
 * every car with the shared validator and stores only its canonical form; a client's totals,
 * hashes or flags are never read. The rules here are the same whichever repository is below.
 */

export type BlueprintLimits = {
  /** Live codes one guest may hold at once. */
  maxLivePerGuest: number;
  /** Codes one guest may create in any 24 hours, deleted ones included. */
  maxCreatesPerDay: number;
  /** Fresh codes tried when a generated one is already taken, before giving up. */
  maxCodeAttempts: number;
};

export const DEFAULT_BLUEPRINT_LIMITS: BlueprintLimits = {
  maxLivePerGuest: 100,
  maxCreatesPerDay: 100,
  maxCodeAttempts: 8,
};

export type BlueprintServiceOptions = {
  repo: BlueprintRepository;
  catalog: Catalog;
  catalogVersion: string;
  limits?: Partial<BlueprintLimits>;
  /** Code source. Defaults to `crypto.randomBytes`; tests stub it to force collisions. */
  generateCode?: () => string;
  now?: () => Date;
};

export type CreateFailure =
  | 'malformed'
  | 'catalog'
  | 'unknown_part'
  | 'illegal'
  | 'request_conflict'
  | 'quota'
  | 'daily_limit'
  | 'codes_exhausted';

export type CreateOutcome =
  | { ok: true; record: BlueprintRecord; reused: boolean }
  | { ok: false; reason: CreateFailure; message: string };

export type LookupOutcome =
  | { ok: true; record: BlueprintRecord; blueprint: VehicleBlueprint; stale: boolean }
  | { ok: false; reason: 'invalid' | 'not_found' };

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIST = 200;

/**
 * The validator's copy for the first problem, as a sentence. Some issue labels are short
 * highlights for a part card (`No compatible mount`); an API answer is read on its own, so a
 * label is put into a sentence.
 */
function messageOf(issue: BlueprintIssue | undefined): string {
  if (!issue) return BLUEPRINT_ISSUE_COPY.MALFORMED;
  const text = issue.hint ?? issue.message;
  if (/[.!?]$/.test(text)) return text;
  return `This build can't race: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

/** Copy for refusals that are not validator issues. Each is a full sentence. */
export const SERVICE_COPY = {
  requestConflict: 'This request was already used for a different car.',
  quota: 'You have shared as many cars as a guest can keep. Delete an old code to share another.',
  dailyLimit: "You've shared a lot of cars today. Try again tomorrow.",
  exhausted: "We couldn't make a code just now. Try again in a moment.",
} as const;

export type BlueprintService = ReturnType<typeof createBlueprintService>;

export function createBlueprintService(options: BlueprintServiceOptions) {
  const { repo, catalog, catalogVersion } = options;
  const limits = { ...DEFAULT_BLUEPRINT_LIMITS, ...options.limits };
  const now = options.now ?? (() => new Date());
  const generate = options.generateCode ?? (() => generateCarCode((n) => randomBytes(n)));

  const sameCar = (record: BlueprintRecord, hash: string, name: string, paint: string) =>
    record.buildHash === hash && record.name === name && record.paintId === paint;

  return {
    /**
     * Validates, saves and issues a code. Idempotent twice over: the same request id returns
     * the same record, and the same car (mechanical hash, name and paint) already shared by
     * this guest returns its existing code instead of minting another.
     */
    async create(ownerGuestId: string, requestId: string, input: unknown): Promise<CreateOutcome> {
      const check = validateUntrustedBlueprint(input, catalog);
      if (!check.ok) {
        const errors = check.issues.filter((i) => i.severity === 'error');
        const first = errors[0];
        const reason: CreateFailure =
          !first ||
          first.code === 'MALFORMED' ||
          first.code === 'UNSUPPORTED_FORMAT' ||
          first.code === 'BAD_NAME'
            ? 'malformed'
            : errors.some((i) => i.code === 'CATALOG_MISMATCH')
              ? 'catalog'
              : errors.some((i) => i.code === 'UNKNOWN_PART')
                ? 'unknown_part'
                : 'illegal';
        const shown =
          reason === 'catalog'
            ? errors.find((i) => i.code === 'CATALOG_MISMATCH')
            : reason === 'unknown_part'
              ? errors.find((i) => i.code === 'UNKNOWN_PART')
              : first;
        return { ok: false, reason, message: messageOf(shown) };
      }
      // The schema already holds the name to the safe set; sanitizing again costs nothing and
      // means the stored name cannot depend on that schema staying strict.
      const name = sanitizeBlueprintName(check.blueprint.name);
      const blueprint: VehicleBlueprint = { ...check.blueprint, name };
      const canonicalJson = serializeBlueprint(blueprint);
      const buildHash = check.buildHash;
      const paintId = blueprint.paintId;

      const existing = async (): Promise<CreateOutcome | null> => {
        const replay = await repo.findByRequest(ownerGuestId, requestId);
        if (replay) {
          return sameCar(replay, buildHash, name, paintId)
            ? { ok: true, record: replay, reused: true }
            : { ok: false, reason: 'request_conflict', message: SERVICE_COPY.requestConflict };
        }
        const same = await repo.findSameCar(ownerGuestId, buildHash, name, paintId);
        return same ? { ok: true, record: same, reused: true } : null;
      };

      const found = await existing();
      if (found) return found;

      const at = now();
      if ((await repo.countLiveByOwner(ownerGuestId)) >= limits.maxLivePerGuest)
        return { ok: false, reason: 'quota', message: SERVICE_COPY.quota };
      if (
        (await repo.countCreatedSince(ownerGuestId, new Date(at.getTime() - DAY_MS))) >=
        limits.maxCreatesPerDay
      )
        return { ok: false, reason: 'daily_limit', message: SERVICE_COPY.dailyLimit };

      for (let attempt = 0; attempt < limits.maxCodeAttempts; attempt++) {
        const code = generate();
        try {
          const record = await repo.insert({
            id: randomUUID(),
            code,
            ownerGuestId,
            canonicalJson,
            buildHash,
            catalogVersion: blueprint.catalogVersion,
            name,
            paintId,
            requestId,
            createdAt: at,
          });
          return { ok: true, record, reused: false };
        } catch (error) {
          if (!(error instanceof UniqueViolation)) throw error;
          if (error.key === 'code') continue;
          // Another request for the same car or request id won the race: answer with its row.
          const raced = await existing();
          if (raced) return raced;
        }
      }
      return { ok: false, reason: 'codes_exhausted', message: SERVICE_COPY.exhausted };
    },

    /**
     * A public lookup. The code is normalized and its checksum checked before the repository
     * is asked anything, so a typo never costs a query.
     */
    async lookup(rawCode: string): Promise<LookupOutcome> {
      const reading = readCarCode(rawCode);
      if (!reading.ok) return { ok: false, reason: 'invalid' };
      const record = await repo.findByCode(reading.code);
      if (!record) return { ok: false, reason: 'not_found' };
      // Stored rows were validated when written, but the column is still read as untrusted.
      let blueprint: VehicleBlueprint;
      try {
        blueprint = JSON.parse(record.canonicalJson) as VehicleBlueprint;
      } catch {
        return { ok: false, reason: 'not_found' };
      }
      return { ok: true, record, blueprint, stale: record.catalogVersion !== catalogVersion };
    },

    listMine(ownerGuestId: string): Promise<BlueprintRecord[]> {
      return repo.listByOwner(ownerGuestId, MAX_LIST);
    },

    deleteMine(ownerGuestId: string, id: string): Promise<boolean> {
      return repo.softDelete(ownerGuestId, id, now());
    },

    isStale(record: BlueprintRecord): boolean {
      return record.catalogVersion !== catalogVersion;
    },
  };
}
