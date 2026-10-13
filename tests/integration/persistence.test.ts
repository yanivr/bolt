import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT, CATALOG, CATALOG_VERSION } from '@bolt/content';
import type { HealthResponse } from '@bolt/shared';
import {
  buildHash,
  generateCarCode,
  publicBlueprintResponseSchema,
  serializeBlueprint,
} from '@bolt/shared';
import { createBlueprintService } from '../../apps/server/src/db/blueprintService.js';
import type { Migration } from '../../apps/server/src/db/migrate.js';
import { checksumOf, loadMigrations, migrate } from '../../apps/server/src/db/migrate.js';
import { openPostgresPersistence, postgresPersistence } from '../../apps/server/src/db/postgres.js';
import type { Persistence } from '../../apps/server/src/db/types.js';
import { silentLogger } from '../../apps/server/src/telemetry/log.js';
import {
  blueprintApiContract,
  car,
  expectError,
  newClient,
  shareOk,
} from '../helpers/blueprintApi.js';
import { namedCar, newGuest, repositoryContract } from '../helpers/persistence.js';
import { startTestServer } from '../helpers/server.js';
import type { TestSchema } from '../helpers/testDatabase.js';
import { TEST_DATABASE_URL, databaseReachable, freshSchema } from '../helpers/testDatabase.js';

/**
 * PostgreSQL persistence end to end: migrations, the repository contract, the HTTP API on a
 * real database, and the behaviors only a database has. Needs a reachable server:
 * `pnpm db:dev` starts one, `pnpm test:db` points this suite at it. Without one the whole file
 * is skipped, and says so, so the default run stays green on machines without PostgreSQL.
 */

const reachable = await databaseReachable();
if (!reachable)
  console.warn(
    TEST_DATABASE_URL
      ? `PostgreSQL suite skipped: no database answered at BOLT_TEST_DATABASE_URL/DATABASE_URL.`
      : 'PostgreSQL suite skipped: BOLT_TEST_DATABASE_URL is not set. Run `pnpm db:dev` and `pnpm test:db`.',
  );

const suite = reachable ? describe : describe.skip;

suite('migrations', () => {
  let schema: TestSchema;
  beforeAll(async () => {
    schema = await freshSchema('mig');
  });
  afterAll(async () => {
    await schema.drop();
  });

  it('apply from empty, create every table and index of Section 15.8, and re-run as a no-op', async () => {
    const first = await migrate(schema.db, silentLogger);
    expect(first).toEqual({ applied: [1], alreadyApplied: [] });
    const tables = await schema.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`,
      [schema.schema],
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'blueprints',
      'daily_challenges',
      'guest_sessions',
      'match_events',
      'matches',
      'schema_migrations',
    ]);
    const indexes = await schema.db.query<{ indexname: string }>(
      'SELECT indexname FROM pg_indexes WHERE schemaname = $1',
      [schema.schema],
    );
    const names = indexes.rows.map((r) => r.indexname);
    for (const name of [
      'blueprints_code_key', // public code
      'blueprints_owner_idx', // guest ownership
      'blueprints_owner_request_key',
      'blueprints_owner_build_key',
      'matches_pkey', // match id
      'match_events_pkey',
      'match_events_stored_idx',
      'daily_challenges_pkey', // daily date
      'guest_sessions_expires_idx',
    ])
      expect(names, name).toContain(name);
    // Nothing that could hold raw input or personal data exists.
    const columns = await schema.db.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1',
      [schema.schema],
    );
    for (const column of columns.rows.map((r) => r.column_name))
      expect(column).not.toMatch(/input|email|birth|address|ip|name_real|token$/);

    expect(await migrate(schema.db, silentLogger)).toEqual({ applied: [], alreadyApplied: [1] });
  });

  it('serialize concurrent starts with a lock', async () => {
    const other = await freshSchema('mig');
    try {
      const reports = await Promise.all([
        migrate(other.db, silentLogger),
        migrate(other.db, silentLogger),
        migrate(other.db, silentLogger),
      ]);
      expect(reports.flatMap((r) => r.applied)).toEqual([1]);
    } finally {
      await other.drop();
    }
  });

  it('refuse a migration edited after it was applied, and a database newer than the code', async () => {
    const real = loadMigrations();
    const edited: Migration[] = real.map((m) => ({
      ...m,
      sql: `${m.sql}\n-- edited`,
      checksum: checksumOf(`${m.sql}\n-- edited`),
    }));
    await expect(migrate(schema.db, silentLogger, edited)).rejects.toThrow(/was changed/);
    await schema.db.query(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES (999, 'future', 'x')",
    );
    await expect(migrate(schema.db, silentLogger)).rejects.toThrow(/does not know/);
    await schema.db.query('DELETE FROM schema_migrations WHERE version = 999');
  });

  it('roll a failing migration back completely', async () => {
    const bad: Migration = {
      version: 2,
      name: 'broken',
      sql: 'CREATE TABLE half_done (a int); SELECT no_such_function();',
      checksum: checksumOf('broken'),
    };
    await expect(migrate(schema.db, silentLogger, [...loadMigrations(), bad])).rejects.toThrow();
    const left = await schema.db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'half_done'`,
      [schema.schema],
    );
    expect(left.rowCount).toBe(0);
    const versions = await schema.db.query<{ version: number }>(
      'SELECT version FROM schema_migrations',
    );
    expect(versions.rows.map((r) => r.version)).toEqual([1]);
  });

  it('enforce the format of a stored code and the size of stored JSON in the database itself', async () => {
    const insert = (code: string, json: string) =>
      schema.db.query(
        `INSERT INTO blueprints (id, code, canonical_json, build_hash, catalog_version, name,
           paint_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '0', 'x', 'p', now(), now())`,
        [randomUUID(), code, json, 'a'.repeat(64)],
      );
    await expect(insert('CAR-UUUUUU-00', '{}')).rejects.toThrow();
    await expect(
      insert(
        generateCarCode((n) => randomBytes(n)),
        'x'.repeat(9000),
      ),
    ).rejects.toThrow();
  });
});

let contractSchema: TestSchema | undefined;
if (reachable)
  repositoryContract('postgres', async () => {
    contractSchema = await freshSchema('repo');
    await migrate(contractSchema.db, silentLogger);
    return {
      persistence: postgresPersistence(contractSchema.db),
      cleanup: () => contractSchema!.drop(),
    };
  });

suite('postgres only', () => {
  let schema: TestSchema;
  let persistence: Persistence;
  beforeAll(async () => {
    schema = await freshSchema('only');
    await migrate(schema.db, silentLogger);
    persistence = postgresPersistence(schema.db);
  });
  afterAll(async () => {
    await schema.drop();
  });

  it('gives one code to many simultaneous requests for the same car', async () => {
    const owner = await newGuest(persistence);
    const service = createBlueprintService({
      repo: persistence.blueprints,
      catalog: CATALOG,
      catalogVersion: CATALOG_VERSION,
    });
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        service.create(owner, `req-race-${i}0000`, namedCar('Race Me')),
      ),
    );
    const codes = new Set(outcomes.map((o) => (o.ok ? o.record.code : o.reason)));
    expect(codes.size).toBe(1);
    expect(outcomes.filter((o) => o.ok && !o.reused)).toHaveLength(1);
  });

  it('orphans, but keeps, the codes of a guest whose session expired', async () => {
    const owner = await newGuest(persistence, new Date(Date.now() - 30 * 24 * 3600 * 1000));
    const service = createBlueprintService({
      repo: persistence.blueprints,
      catalog: CATALOG,
      catalogVersion: CATALOG_VERSION,
    });
    const made = await service.create(owner, 'req-orphan-01', namedCar('Orphan Car'));
    if (!made.ok) throw new Error('setup failed');
    expect(await persistence.guests.expire(new Date())).toBeGreaterThanOrEqual(1);
    const found = await service.lookup(made.record.code);
    expect(found.ok && found.record.ownerGuestId).toBeNull();
  });

  it('reports itself healthy, and a database that cannot be reached is a startup error', async () => {
    expect(await persistence.health()).toBe('ok');
    await expect(
      openPostgresPersistence({
        connectionString: 'postgresql://bolt@127.0.0.1:1/bolt',
        logger: silentLogger,
        connectAttempts: 1,
      }),
    ).rejects.toThrow(/Could not reach the database/);
  });
});

let httpSchema: TestSchema | undefined;
if (reachable)
  blueprintApiContract(
    'postgres',
    async () => {
      httpSchema = await freshSchema('http');
      await migrate(httpSchema.db, silentLogger);
      const server = await startTestServer({
        trustProxy: true,
        persistence: postgresPersistence(httpSchema.db),
      });
      return {
        ...server,
        stop: async () => {
          await server.stop();
          await httpSchema!.drop();
        },
      };
    },
    (server) => {
      it('reports the database in the health check', async () => {
        const body = (await (
          await fetch(`${server().url}/api/v1/health`)
        ).json()) as HealthResponse;
        expect(body.status).toBe('ok');
        expect(body.dependencies).toEqual({ database: 'ok' });
      });

      it('keeps only a hash of the guest token, and forgets a deleted guest for good', async () => {
        const me = await newClient(server().url);
        const rows = await httpSchema!.db.query<Record<string, unknown>>(
          'SELECT * FROM guest_sessions WHERE id = $1',
          [me.guestId],
        );
        expect(rows.rowCount).toBe(1);
        expect(rows.rows[0]!.token_hash).toBe(createHash('sha256').update(me.token).digest('hex'));
        expect(JSON.stringify(rows.rows)).not.toContain(me.token);

        const made = await shareOk(me, car('Forget Me'));
        expect((await me.call('/api/v1/me', { method: 'DELETE' })).status).toBe(204);
        const left = await httpSchema!.db.query(
          'SELECT 1 FROM blueprints WHERE code = $1 UNION ALL SELECT 1 FROM guest_sessions WHERE id = $2',
          [made.code, me.guestId],
        );
        expect(left.rowCount).toBe(0);
        // The old token is still correctly signed, but the session behind it is gone: refused,
        // and a guest call with it gets a brand-new identity.
        await expectError(await me.call('/api/v1/me/blueprints'), 401, 'UNAUTHORIZED');
        const fresh = await me.call('/api/v1/guest', { method: 'POST', body: '{}' });
        expect(fresh.status).toBe(201);
        expect(((await fresh.json()) as { guestId: string }).guestId).not.toBe(me.guestId);
      });

      it('marks a code shared under an older catalog as stale, with the car exactly as stored', async () => {
        const old = { ...BASELINE_BLUEPRINT, catalogVersion: '0.6.0', name: 'Old Timer' };
        const code = generateCarCode((n) => randomBytes(n));
        await httpSchema!.db.query(
          `INSERT INTO blueprints (id, code, owner_guest_id, canonical_json, build_hash,
             catalog_version, name, paint_id, created_at, updated_at)
           VALUES ($1, $2, NULL, $3, $4, '0.6.0', 'Old Timer', $5, now(), now())`,
          [randomUUID(), code, serializeBlueprint(old), buildHash(old), old.paintId],
        );
        const reader = await newClient(server().url);
        const res = await reader.call(`/api/v1/blueprints/${code}`, { auth: false });
        expect(res.status).toBe(200);
        const body = publicBlueprintResponseSchema.parse(await res.json());
        expect(body.stale).toBe(true);
        expect(body.catalogVersion).toBe('0.6.0');
        expect(body.currentCatalogVersion).toBe(CATALOG_VERSION);
        expect(serializeBlueprint(body.blueprint)).toBe(serializeBlueprint(old));
      });

      it('survives a server restart: a code and a guest outlive the process', async () => {
        const me = await newClient(server().url);
        const made = await shareOk(me, car('Restart Proof'));
        // A second persistence layer on the same schema stands in for the next process.
        const next = postgresPersistence(httpSchema!.db);
        const service = createBlueprintService({
          repo: next.blueprints,
          catalog: CATALOG,
          catalogVersion: CATALOG_VERSION,
        });
        expect((await service.lookup(made.code)).ok).toBe(true);
        expect(await next.guests.get(me.guestId, new Date())).toBeDefined();
      });

      it('answers 503 with plain copy when the database stops answering', async () => {
        const broken = await freshSchema('gone');
        await migrate(broken.db, silentLogger);
        const persistence = postgresPersistence(broken.db);
        const service = createBlueprintService({
          repo: persistence.blueprints,
          catalog: CATALOG,
          catalogVersion: CATALOG_VERSION,
        });
        await broken.drop(); // closes its pool
        await expect(service.lookup(generateCarCode((n) => randomBytes(n)))).rejects.toThrow();
        expect(await persistence.health()).toBe('unavailable');
      });
    },
  );

if (!reachable)
  describe('PostgreSQL persistence', () => {
    it.skip('needs BOLT_TEST_DATABASE_URL pointing at a reachable PostgreSQL (pnpm db:dev, pnpm test:db)', () => {});
  });
