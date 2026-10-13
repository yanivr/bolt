import { InMemoryGuestStore } from '../persistence/guestStore.js';
import type {
  BlueprintRecord,
  BlueprintRepository,
  DailyChallengeRepository,
  DailyChallengeRow,
  MatchEventRow,
  MatchRepository,
  MatchRow,
  NewBlueprint,
  Persistence,
} from './types.js';
import { UniqueViolation } from './types.js';

/**
 * Process-local implementations of the repositories, for development and for tests that do not
 * need a database. They keep the same uniqueness rules as the SQL indexes so the service above
 * them behaves identically. Everything is lost when the process stops, and the server says so
 * in its log at startup. Production refuses to run on them (`config.ts`).
 */

const copy = (record: BlueprintRecord): BlueprintRecord => ({ ...record });

export type MemoryLimits = {
  /** Hard cap on stored blueprints, so a development server cannot be filled up. */
  maxBlueprints?: number;
  maxMatches?: number;
};

export class MemoryBlueprintRepository implements BlueprintRepository {
  private readonly rows = new Map<string, BlueprintRecord>();
  private readonly byCode = new Map<string, string>();
  private readonly max: number;

  constructor(limits: MemoryLimits = {}) {
    this.max = limits.maxBlueprints ?? 50_000;
  }

  private live(): BlueprintRecord[] {
    return [...this.rows.values()].filter((r) => r.deletedAt === null);
  }

  async insert(record: NewBlueprint): Promise<BlueprintRecord> {
    if (this.byCode.has(record.code) || this.rows.has(record.id)) throw new UniqueViolation('code');
    if (record.ownerGuestId !== null) {
      for (const row of this.live()) {
        if (row.ownerGuestId !== record.ownerGuestId) continue;
        if (record.requestId !== null && row.requestId === record.requestId)
          throw new UniqueViolation('request');
        if (
          row.buildHash === record.buildHash &&
          row.name === record.name &&
          row.paintId === record.paintId
        )
          throw new UniqueViolation('build');
      }
    }
    if (this.rows.size >= this.max) throw new Error('The in-memory blueprint store is full.');
    const stored: BlueprintRecord = { ...record, updatedAt: record.createdAt, deletedAt: null };
    this.rows.set(stored.id, stored);
    this.byCode.set(stored.code, stored.id);
    return copy(stored);
  }

  async findByCode(code: string): Promise<BlueprintRecord | undefined> {
    const id = this.byCode.get(code);
    const row = id ? this.rows.get(id) : undefined;
    return row && row.deletedAt === null ? copy(row) : undefined;
  }

  async findByRequest(owner: string, requestId: string): Promise<BlueprintRecord | undefined> {
    const row = this.live().find((r) => r.ownerGuestId === owner && r.requestId === requestId);
    return row ? copy(row) : undefined;
  }

  async findSameCar(
    owner: string,
    buildHash: string,
    name: string,
    paintId: string,
  ): Promise<BlueprintRecord | undefined> {
    const row = this.live().find(
      (r) =>
        r.ownerGuestId === owner &&
        r.buildHash === buildHash &&
        r.name === name &&
        r.paintId === paintId,
    );
    return row ? copy(row) : undefined;
  }

  async listByOwner(owner: string, limit: number): Promise<BlueprintRecord[]> {
    return this.live()
      .filter((r) => r.ownerGuestId === owner)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map(copy);
  }

  async countLiveByOwner(owner: string): Promise<number> {
    return this.live().filter((r) => r.ownerGuestId === owner).length;
  }

  async countCreatedSince(owner: string, since: Date): Promise<number> {
    let n = 0;
    for (const row of this.rows.values())
      if (row.ownerGuestId === owner && row.createdAt.getTime() > since.getTime()) n += 1;
    return n;
  }

  async softDelete(owner: string, id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.ownerGuestId !== owner || row.deletedAt !== null) return false;
    row.deletedAt = at;
    row.updatedAt = at;
    return true;
  }

  async deleteAllForOwner(owner: string): Promise<number> {
    let n = 0;
    for (const [id, row] of this.rows) {
      if (row.ownerGuestId !== owner) continue;
      this.rows.delete(id);
      this.byCode.delete(row.code);
      n += 1;
    }
    return n;
  }

  async purgeDeleted(before: Date): Promise<number> {
    let n = 0;
    for (const [id, row] of this.rows) {
      if (row.deletedAt === null || row.deletedAt.getTime() > before.getTime()) continue;
      this.rows.delete(id);
      this.byCode.delete(row.code);
      n += 1;
    }
    return n;
  }

  /** Orphans the records of guests whose sessions are gone, as the SQL foreign key does. */
  orphan(owner: string): void {
    for (const row of this.rows.values()) if (row.ownerGuestId === owner) row.ownerGuestId = null;
  }
}

type StoredMatch = { match: MatchRow; events: MatchEventRow[]; storedAt: Date };

export class MemoryMatchRepository implements MatchRepository {
  private readonly matches = new Map<string, StoredMatch>();
  private readonly max: number;

  constructor(limits: MemoryLimits = {}) {
    this.max = limits.maxMatches ?? 10_000;
  }

  async insert(match: MatchRow, events: MatchEventRow[], at: Date): Promise<boolean> {
    if (this.matches.has(match.id)) return false;
    if (this.matches.size >= this.max) {
      // Oldest first: Map iteration follows insertion order.
      const oldest = this.matches.keys().next();
      if (!oldest.done) this.matches.delete(oldest.value);
    }
    this.matches.set(match.id, {
      match: structuredClone(match),
      events: structuredClone(events),
      storedAt: at,
    });
    return true;
  }

  async get(id: string): Promise<{ match: MatchRow; events: MatchEventRow[] } | undefined> {
    const stored = this.matches.get(id);
    return stored
      ? { match: structuredClone(stored.match), events: structuredClone(stored.events) }
      : undefined;
  }

  async count(): Promise<{ matches: number; events: number }> {
    let events = 0;
    for (const stored of this.matches.values()) events += stored.events.length;
    return { matches: this.matches.size, events };
  }

  async purgeEvents(before: Date): Promise<number> {
    let n = 0;
    for (const stored of this.matches.values()) {
      if (stored.storedAt.getTime() > before.getTime()) continue;
      n += stored.events.length;
      stored.events = [];
    }
    return n;
  }

  async purgeMatches(before: Date): Promise<number> {
    let n = 0;
    for (const [id, stored] of this.matches) {
      if (stored.match.endedAt.getTime() > before.getTime()) continue;
      this.matches.delete(id);
      n += 1;
    }
    return n;
  }
}

export class MemoryDailyRepository implements DailyChallengeRepository {
  private readonly rows = new Map<string, DailyChallengeRow>();

  async upsert(row: DailyChallengeRow): Promise<void> {
    this.rows.set(row.day, structuredClone(row));
  }

  async get(day: string): Promise<DailyChallengeRow | undefined> {
    const row = this.rows.get(day);
    return row ? structuredClone(row) : undefined;
  }
}

/** The whole layer in memory. `health` reports `not_configured`: there is no database. */
export function createMemoryPersistence(limits: MemoryLimits = {}): Persistence {
  const guests = new InMemoryGuestStore();
  const blueprints = new MemoryBlueprintRepository(limits);
  return {
    kind: 'memory',
    guests,
    blueprints,
    matches: new MemoryMatchRepository(limits),
    daily: new MemoryDailyRepository(),
    async deleteGuest(guestId) {
      const removed = await blueprints.deleteAllForOwner(guestId);
      await guests.delete(guestId);
      return removed;
    },
    health: async () => 'not_configured',
    close: async () => {},
  };
}
