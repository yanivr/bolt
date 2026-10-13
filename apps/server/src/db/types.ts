import type { GuestSessionStore } from '../persistence/guestStore.js';

/**
 * Records and repository interfaces of the persistence layer (Section 15.8). Two
 * implementations sit behind them: PostgreSQL (`postgres.ts`) and an in-memory one
 * (`memory.ts`) for development and tests without a database. Callers never know which.
 */

export type BlueprintRecord = {
  /** UUID, the owner's handle for deleting it. Never shown to anyone else. */
  id: string;
  /** Public short code, `CAR-XXXXXX-XX`. Unique for ever among stored rows. */
  code: string;
  /** Opaque guest id of the owner; null once that guest's session has expired. */
  ownerGuestId: string | null;
  /** The canonical JSON exactly as serialized (`serializeBlueprint`), stored as text. */
  canonicalJson: string;
  /** Mechanical SHA-256 (`buildHash`). */
  buildHash: string;
  catalogVersion: string;
  /** Sanitized display name, also inside the JSON; kept as a column for listing. */
  name: string;
  paintId: string;
  /** Client request id of the create call, for idempotent retries. */
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type NewBlueprint = Omit<BlueprintRecord, 'updatedAt' | 'deletedAt'>;

/** Which uniqueness rule an insert broke. */
export type UniqueKey = 'code' | 'request' | 'build';

export class UniqueViolation extends Error {
  constructor(readonly key: UniqueKey) {
    super(`unique violation on ${key}`);
    this.name = 'UniqueViolation';
  }
}

export interface BlueprintRepository {
  /** Stores a new record. Throws `UniqueViolation` when a code, request id or build repeats. */
  insert(record: NewBlueprint): Promise<BlueprintRecord>;
  /** A live (not deleted) record by its canonical code. */
  findByCode(code: string): Promise<BlueprintRecord | undefined>;
  /** The owner's live record created by this request id. */
  findByRequest(ownerGuestId: string, requestId: string): Promise<BlueprintRecord | undefined>;
  /** The owner's live record of the same mechanical build, name and paint. */
  findSameCar(
    ownerGuestId: string,
    buildHash: string,
    name: string,
    paintId: string,
  ): Promise<BlueprintRecord | undefined>;
  /** The owner's live records, newest first. */
  listByOwner(ownerGuestId: string, limit: number): Promise<BlueprintRecord[]>;
  countLiveByOwner(ownerGuestId: string): Promise<number>;
  /** Records the owner created since then, deleted ones included (a daily creation limit). */
  countCreatedSince(ownerGuestId: string, since: Date): Promise<number>;
  /** Marks the owner's record deleted. False when there is no such live record of theirs. */
  softDelete(ownerGuestId: string, id: string, at: Date): Promise<boolean>;
  /** Removes every record of the owner for good, deleted ones included. Resolves the count. */
  deleteAllForOwner(ownerGuestId: string): Promise<number>;
  /** Removes for good records soft-deleted at or before the instant. */
  purgeDeleted(before: Date): Promise<number>;
}

/** A finished match as stored. Player ids are per-match pseudonyms, never guest ids. */
export type MatchRow = {
  id: string;
  mode: string;
  trackId: string;
  weatherPresetId: string;
  seed: number;
  catalogVersion: string;
  playerRefs: string[];
  playerKinds: string[];
  blueprintHashes: string[];
  /** Winner, reason and the per-car numbers. */
  result: Record<string, unknown>;
  startedAt: Date;
  endedAt: Date;
  disconnectReason: string | null;
  metrics: Record<string, number>;
};

export type MatchEventRow = {
  seq: number;
  tick: number;
  type: string;
  car: number | null;
  data: Record<string, number | string | boolean>;
};

export interface MatchRepository {
  /** Stores a match and its sampled events together. A repeated id is ignored. */
  insert(match: MatchRow, events: MatchEventRow[], at: Date): Promise<boolean>;
  get(id: string): Promise<{ match: MatchRow; events: MatchEventRow[] } | undefined>;
  count(): Promise<{ matches: number; events: number }>;
  /** Drops events stored at or before the instant. */
  purgeEvents(before: Date): Promise<number>;
  /** Drops matches (and so their events) that ended at or before the instant. */
  purgeMatches(before: Date): Promise<number>;
}

/** Section 15.8: date, seed, track, weather, reference bot and nonpersonal aggregates. */
export type DailyChallengeRow = {
  /** `YYYY-MM-DD`. */
  day: string;
  seed: number;
  trackId: string;
  weatherPresetId: string;
  referenceBot: string;
  aggregate: Record<string, number>;
};

/** Used from Milestone F; the table exists from the first migration. */
export interface DailyChallengeRepository {
  upsert(row: DailyChallengeRow): Promise<void>;
  get(day: string): Promise<DailyChallengeRow | undefined>;
}

/** A guest store that can also forget a guest on request (the Section 16 deletion control). */
export type DeletableGuestStore = GuestSessionStore;

export type DatabaseHealth = 'ok' | 'unavailable' | 'not_configured';

export type RetentionReport = {
  matchEvents: number;
  matches: number;
  deletedBlueprints: number;
  guestSessions: number;
};

export type Persistence = {
  kind: 'postgres' | 'memory';
  guests: DeletableGuestStore;
  blueprints: BlueprintRepository;
  matches: MatchRepository;
  daily: DailyChallengeRepository;
  /**
   * Deletes a guest and everything that is theirs (their blueprints and their session) in one
   * step. Resolves the number of blueprints removed.
   */
  deleteGuest(guestId: string): Promise<number>;
  health(): Promise<DatabaseHealth>;
  close(): Promise<void>;
};
