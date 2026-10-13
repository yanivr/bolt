import type { GuestSessionRecord, GuestSessionRotation } from '../persistence/guestStore.js';
import type { Logger } from '../telemetry/log.js';
import { migrate } from './migrate.js';
import type { Database, Queryable } from './pool.js';
import { createDatabase, describeDatabaseUrl, uniqueViolationOf } from './pool.js';
import type {
  BlueprintRecord,
  BlueprintRepository,
  DailyChallengeRepository,
  DailyChallengeRow,
  DeletableGuestStore,
  MatchEventRow,
  MatchRepository,
  MatchRow,
  NewBlueprint,
  Persistence,
  UniqueKey,
} from './types.js';
import { UniqueViolation } from './types.js';

// --- Guest sessions ---------------------------------------------------------------------------

type GuestRow = {
  id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
};

const guestFrom = (row: GuestRow): GuestSessionRecord => ({
  id: row.id,
  tokenHash: row.token_hash,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
});

/** The `GuestSessionStore` of `persistence/guestStore.ts` on the `guest_sessions` table. */
export class PostgresGuestStore implements DeletableGuestStore {
  constructor(private readonly db: Queryable) {}

  async create(record: GuestSessionRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO guest_sessions (id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash,
         last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at`,
      [record.id, record.tokenHash, record.createdAt, record.lastSeenAt, record.expiresAt],
    );
  }

  async get(id: string, now: Date): Promise<GuestSessionRecord | undefined> {
    const { rows } = await this.db.query<GuestRow>(
      'SELECT * FROM guest_sessions WHERE id = $1 AND expires_at > $2',
      [id, now],
    );
    return rows[0] ? guestFrom(rows[0]) : undefined;
  }

  async touch(id: string, now: Date, rotation?: GuestSessionRotation): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE guest_sessions
          SET last_seen_at = GREATEST(last_seen_at, $2),
              token_hash = COALESCE($3, token_hash),
              expires_at = COALESCE($4, expires_at)
        WHERE id = $1 AND expires_at > $2`,
      [id, now, rotation?.tokenHash ?? null, rotation?.expiresAt ?? null],
    );
    return rowCount > 0;
  }

  async expire(now: Date): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM guest_sessions WHERE expires_at <= $1', [
      now,
    ]);
    return rowCount;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM guest_sessions WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM guest_sessions',
    );
    return rows[0]?.n ?? 0;
  }
}

// --- Blueprints -------------------------------------------------------------------------------

type BlueprintDbRow = {
  id: string;
  code: string;
  owner_guest_id: string | null;
  canonical_json: string;
  build_hash: string;
  catalog_version: string;
  name: string;
  paint_id: string;
  request_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

const blueprintFrom = (row: BlueprintDbRow): BlueprintRecord => ({
  id: row.id,
  code: row.code,
  ownerGuestId: row.owner_guest_id,
  canonicalJson: row.canonical_json,
  buildHash: row.build_hash,
  catalogVersion: row.catalog_version,
  name: row.name,
  paintId: row.paint_id,
  requestId: row.request_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

const UNIQUE_KEYS: Record<string, UniqueKey> = {
  blueprints_code_key: 'code',
  blueprints_owner_request_key: 'request',
  blueprints_owner_build_key: 'build',
  // A random UUID repeating is not going to happen, but it is a retry like a code collision.
  blueprints_pkey: 'code',
};

export class PostgresBlueprintRepository implements BlueprintRepository {
  constructor(private readonly db: Queryable) {}

  async insert(record: NewBlueprint): Promise<BlueprintRecord> {
    try {
      const { rows } = await this.db.query<BlueprintDbRow>(
        `INSERT INTO blueprints (id, code, owner_guest_id, canonical_json, build_hash,
           catalog_version, name, paint_id, request_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING *`,
        [
          record.id,
          record.code,
          record.ownerGuestId,
          record.canonicalJson,
          record.buildHash,
          record.catalogVersion,
          record.name,
          record.paintId,
          record.requestId,
          record.createdAt,
        ],
      );
      return blueprintFrom(rows[0]!);
    } catch (error) {
      const constraint = uniqueViolationOf(error);
      const key = constraint ? UNIQUE_KEYS[constraint] : undefined;
      if (key) throw new UniqueViolation(key);
      throw error;
    }
  }

  async findByCode(code: string): Promise<BlueprintRecord | undefined> {
    const { rows } = await this.db.query<BlueprintDbRow>(
      'SELECT * FROM blueprints WHERE code = $1 AND deleted_at IS NULL',
      [code],
    );
    return rows[0] ? blueprintFrom(rows[0]) : undefined;
  }

  async findByRequest(owner: string, requestId: string): Promise<BlueprintRecord | undefined> {
    const { rows } = await this.db.query<BlueprintDbRow>(
      `SELECT * FROM blueprints
        WHERE owner_guest_id = $1 AND request_id = $2 AND deleted_at IS NULL`,
      [owner, requestId],
    );
    return rows[0] ? blueprintFrom(rows[0]) : undefined;
  }

  async findSameCar(
    owner: string,
    buildHash: string,
    name: string,
    paintId: string,
  ): Promise<BlueprintRecord | undefined> {
    const { rows } = await this.db.query<BlueprintDbRow>(
      `SELECT * FROM blueprints
        WHERE owner_guest_id = $1 AND build_hash = $2 AND name = $3 AND paint_id = $4
          AND deleted_at IS NULL`,
      [owner, buildHash, name, paintId],
    );
    return rows[0] ? blueprintFrom(rows[0]) : undefined;
  }

  async listByOwner(owner: string, limit: number): Promise<BlueprintRecord[]> {
    const { rows } = await this.db.query<BlueprintDbRow>(
      `SELECT * FROM blueprints WHERE owner_guest_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id LIMIT $2`,
      [owner, limit],
    );
    return rows.map(blueprintFrom);
  }

  async countLiveByOwner(owner: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM blueprints WHERE owner_guest_id = $1 AND deleted_at IS NULL',
      [owner],
    );
    return rows[0]?.n ?? 0;
  }

  async countCreatedSince(owner: string, since: Date): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM blueprints WHERE owner_guest_id = $1 AND created_at > $2',
      [owner, since],
    );
    return rows[0]?.n ?? 0;
  }

  async softDelete(owner: string, id: string, at: Date): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE blueprints SET deleted_at = $3, updated_at = $3
        WHERE id = $1 AND owner_guest_id = $2 AND deleted_at IS NULL`,
      [id, owner, at],
    );
    return rowCount > 0;
  }

  async deleteAllForOwner(owner: string): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM blueprints WHERE owner_guest_id = $1', [
      owner,
    ]);
    return rowCount;
  }

  async purgeDeleted(before: Date): Promise<number> {
    const { rowCount } = await this.db.query(
      'DELETE FROM blueprints WHERE deleted_at IS NOT NULL AND deleted_at <= $1',
      [before],
    );
    return rowCount;
  }
}

// --- Matches ----------------------------------------------------------------------------------

type MatchDbRow = {
  id: string;
  mode: string;
  track_id: string;
  weather_preset_id: string;
  seed: string;
  catalog_version: string;
  player_refs: string[];
  player_kinds: string[];
  blueprint_hashes: string[];
  result: Record<string, unknown>;
  started_at: Date;
  ended_at: Date;
  disconnect_reason: string | null;
  metrics: Record<string, number>;
};

type EventDbRow = {
  seq: number;
  tick: number;
  type: string;
  car: number | null;
  data: Record<string, number | string | boolean>;
};

export class PostgresMatchRepository implements MatchRepository {
  constructor(private readonly db: Database) {}

  insert(match: MatchRow, events: MatchEventRow[], at: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { rowCount } = await tx.query(
        `INSERT INTO matches (id, mode, track_id, weather_preset_id, seed, catalog_version,
           player_refs, player_kinds, blueprint_hashes, result, started_at, ended_at,
           disconnect_reason, metrics, stored_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING`,
        [
          match.id,
          match.mode,
          match.trackId,
          match.weatherPresetId,
          match.seed,
          match.catalogVersion,
          match.playerRefs,
          match.playerKinds,
          match.blueprintHashes,
          JSON.stringify(match.result),
          match.startedAt,
          match.endedAt,
          match.disconnectReason,
          JSON.stringify(match.metrics),
          at,
        ],
      );
      if (rowCount === 0) return false;
      if (events.length > 0) {
        // One statement for the whole sample: arrays unnested into rows.
        await tx.query(
          `INSERT INTO match_events (match_id, seq, tick, type, car, data, stored_at)
           SELECT $1, e.seq, e.tick, e.type, e.car, e.data, $2
             FROM unnest($3::int[], $4::int[], $5::text[], $6::smallint[], $7::jsonb[])
               AS e(seq, tick, type, car, data)`,
          [
            match.id,
            at,
            events.map((e) => e.seq),
            events.map((e) => e.tick),
            events.map((e) => e.type),
            events.map((e) => e.car),
            events.map((e) => JSON.stringify(e.data)),
          ],
        );
      }
      return true;
    });
  }

  async get(id: string): Promise<{ match: MatchRow; events: MatchEventRow[] } | undefined> {
    const { rows } = await this.db.query<MatchDbRow>('SELECT * FROM matches WHERE id = $1', [id]);
    const row = rows[0];
    if (!row) return undefined;
    const events = await this.db.query<EventDbRow>(
      'SELECT seq, tick, type, car, data FROM match_events WHERE match_id = $1 ORDER BY seq',
      [id],
    );
    return {
      match: {
        id: row.id,
        mode: row.mode,
        trackId: row.track_id,
        weatherPresetId: row.weather_preset_id,
        seed: Number(row.seed),
        catalogVersion: row.catalog_version,
        playerRefs: row.player_refs,
        playerKinds: row.player_kinds,
        blueprintHashes: row.blueprint_hashes,
        result: row.result,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        disconnectReason: row.disconnect_reason,
        metrics: row.metrics,
      },
      events: events.rows,
    };
  }

  async count(): Promise<{ matches: number; events: number }> {
    const { rows } = await this.db.query<{ m: number; e: number }>(
      'SELECT (SELECT count(*)::int FROM matches) AS m, (SELECT count(*)::int FROM match_events) AS e',
    );
    return { matches: rows[0]?.m ?? 0, events: rows[0]?.e ?? 0 };
  }

  async purgeEvents(before: Date): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM match_events WHERE stored_at <= $1', [
      before,
    ]);
    return rowCount;
  }

  async purgeMatches(before: Date): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM matches WHERE ended_at <= $1', [before]);
    return rowCount;
  }
}

// --- Daily challenges -------------------------------------------------------------------------

type DailyDbRow = {
  day: string;
  seed: string;
  track_id: string;
  weather_preset_id: string;
  reference_bot: string;
  aggregate: Record<string, number>;
};

export class PostgresDailyRepository implements DailyChallengeRepository {
  constructor(private readonly db: Queryable) {}

  async upsert(row: DailyChallengeRow): Promise<void> {
    await this.db.query(
      `INSERT INTO daily_challenges (day, seed, track_id, weather_preset_id, reference_bot, aggregate, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (day) DO UPDATE SET seed = EXCLUDED.seed, track_id = EXCLUDED.track_id,
         weather_preset_id = EXCLUDED.weather_preset_id, reference_bot = EXCLUDED.reference_bot,
         aggregate = EXCLUDED.aggregate, updated_at = now()`,
      [
        row.day,
        row.seed,
        row.trackId,
        row.weatherPresetId,
        row.referenceBot,
        JSON.stringify(row.aggregate),
      ],
    );
  }

  async get(day: string): Promise<DailyChallengeRow | undefined> {
    const { rows } = await this.db.query<DailyDbRow>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, seed, track_id, weather_preset_id,
              reference_bot, aggregate
         FROM daily_challenges WHERE day = $1`,
      [day],
    );
    const r = rows[0];
    return r
      ? {
          day: r.day,
          seed: Number(r.seed),
          trackId: r.track_id,
          weatherPresetId: r.weather_preset_id,
          referenceBot: r.reference_bot,
          aggregate: r.aggregate,
        }
      : undefined;
  }
}

// --- The whole layer --------------------------------------------------------------------------

export type PostgresPersistenceOptions = {
  connectionString: string;
  logger: Logger;
  schema?: string;
  /** Attempts to reach the database at startup before giving up (one second apart). */
  connectAttempts?: number;
};

/** A persistence layer that already holds a database (tests build one per schema). */
export function postgresPersistence(db: Database): Persistence {
  const guests = new PostgresGuestStore(db);
  const blueprints = new PostgresBlueprintRepository(db);
  return {
    kind: 'postgres',
    guests,
    blueprints,
    matches: new PostgresMatchRepository(db),
    daily: new PostgresDailyRepository(db),
    deleteGuest: (guestId) =>
      db.transaction(async (tx) => {
        const removed = await new PostgresBlueprintRepository(tx).deleteAllForOwner(guestId);
        await new PostgresGuestStore(tx).delete(guestId);
        return removed;
      }),
    health: async () => ((await db.ping()) ? 'ok' : 'unavailable'),
    close: () => db.close(),
  };
}

/**
 * Connects, waits for the database to answer (it may still be starting under Compose), applies
 * migrations, and returns the repositories. Throws when the database cannot be reached: a
 * server told to use a database never falls back to memory on its own.
 */
export async function openPostgresPersistence(
  options: PostgresPersistenceOptions,
): Promise<Persistence> {
  const db = createDatabase({
    connectionString: options.connectionString,
    logger: options.logger,
    ...(options.schema ? { schema: options.schema } : {}),
  });
  const attempts = Math.max(1, options.connectAttempts ?? 10);
  for (let attempt = 1; ; attempt++) {
    if (await db.ping()) break;
    if (attempt >= attempts) {
      await db.close();
      throw new Error(
        `Could not reach the database at ${describeDatabaseUrl(options.connectionString)} after ${attempts} attempts.`,
      );
    }
    options.logger.warn('database_waiting', { attempt });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  try {
    await migrate(db, options.logger);
  } catch (error) {
    await db.close();
    throw error;
  }
  options.logger.info('persistence_postgres', {
    database: describeDatabaseUrl(options.connectionString),
  });
  return postgresPersistence(db);
}
