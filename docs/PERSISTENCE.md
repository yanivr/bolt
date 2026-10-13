# Persistence and sharing

Milestone E, part 2: guest sessions, short car codes, match records and the privacy controls,
on PostgreSQL (Section 15.8), with an in-memory fallback for development. This is the reference
for the schema, the code format, the HTTP endpoints, the limits, retention and local setup.

Contents: [Layout](#layout) · [Schema](#schema) · [Migrations](#migrations) ·
[Car codes](#car-codes) · [Endpoints](#endpoints) · [Rate limits](#rate-limits-and-quotas) ·
[Match records](#match-records) · [Retention](#retention) · [Privacy and deletion](#privacy-and-deletion) ·
[The client](#the-client) · [Local setup](#local-setup) · [Tests](#tests) · [Known limits](#known-limits)

## Layout

```text
packages/shared/src/carCode.ts       code format, checksum, the forgiving reader (client and server)
packages/shared/src/blueprintApi.ts  zod schemas of the blueprint endpoints' requests and responses
apps/server/src/db/
  pool.ts            pg pool from DATABASE_URL, transactions, parameterized queries only
  migrate.ts         ordered plain-SQL migrations, a migrations table, an advisory lock
  migrations/*.sql   001_initial.sql: the Section 15.8 tables and indexes
  types.ts           records and repository interfaces
  postgres.ts        the repositories on PostgreSQL, and openPostgresPersistence()
  memory.ts          the same repositories in memory (no DATABASE_URL)
  index.ts           openPersistence(): PostgreSQL when configured, otherwise memory, loudly
  blueprintService.ts  validation, idempotency, dedupe, collision retries, quotas
  matchRecorder.ts   the storage behind rooms/matchLog.ts recordMatch()
  retention.ts       the retention policy and its hourly job
apps/server/src/routes/blueprints.ts  the HTTP endpoints and the /car/<code> link
apps/server/src/persistence/guestStore.ts  the guest store interface (and its memory version)
apps/web/src/garage/codeApi.ts, shareFlow.ts, codeStore.ts, privacy.ts
apps/web/src/garage/ui/LoadCodeDialog.tsx, ShareSheet.tsx, ResultsShare.tsx, CodeHost.tsx
apps/web/src/components/PrivacyView.tsx, apps/web/src/pages/PrivacyScreen.tsx
```

The server picks its storage in `main.ts`: with `DATABASE_URL` it connects (ten attempts a
second apart, for a database still starting under Compose), runs the migrations and serves; if
the database cannot be reached it exits with `database_unavailable` and never falls back to
memory. Without `DATABASE_URL` it logs `persistence_in_memory` ("kept in memory and lost on
restart") and runs on `db/memory.ts`. In production (`NODE_ENV=production`) a missing
`DATABASE_URL` is a configuration error and the process does not start. The health check
reports `dependencies.database` as `ok`, `unavailable` (status `degraded`) or `not_configured`.

## Schema

All in `apps/server/src/db/migrations/001_initial.sql`.

| Table               | Columns                                                                                                                                                                                                                              | Notes                                                                                                                                            |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `guest_sessions`    | `id` (22-char random id, PK), `token_hash` (SHA-256 hex), `created_at`, `last_seen_at`, `expires_at`                                                                                                                                 | The token itself is never stored. No other column exists.                                                                                        |
| `blueprints`        | `id` uuid PK, `code`, `owner_guest_id` → `guest_sessions` ON DELETE SET NULL, `canonical_json` text (≤ 8,192), `build_hash`, `catalog_version`, `name` (1 to 24), `paint_id`, `request_id`, `created_at`, `updated_at`, `deleted_at` | `canonical_json` is text, not jsonb, so the canonical serialization is kept byte for byte. CHECK constraints hold the code format and the sizes. |
| `matches`           | `id` PK, `mode`, `track_id`, `weather_preset_id`, `seed`, `catalog_version`, `player_refs[]`, `player_kinds[]`, `blueprint_hashes[]`, `result` jsonb, `started_at`, `ended_at`, `disconnect_reason`, `metrics` jsonb, `stored_at`    | Players are per-match pseudonyms (see Match records).                                                                                            |
| `match_events`      | (`match_id` → `matches` ON DELETE CASCADE, `seq`) PK, `tick`, `type`, `car`, `data` jsonb, `stored_at`                                                                                                                               | A sample of notable events, at most 240 a match.                                                                                                 |
| `daily_challenges`  | `day` date PK, `seed`, `track_id`, `weather_preset_id`, `reference_bot`, `aggregate` jsonb, `updated_at`                                                                                                                             | Created now; used by Milestone F. Nonpersonal aggregates only.                                                                                   |
| `schema_migrations` | `version` PK, `name`, `checksum`, `applied_at`                                                                                                                                                                                       | Created by the runner.                                                                                                                           |

Indexes (Section 15.8: public code, guest ownership, match id, daily date):

| Index                                                                                                       | Purpose                                                                                                                       |
| :---------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `blueprints_code_key` UNIQUE (`code`)                                                                       | Lookup by code. Unique over every stored row, deleted ones included, so a code cannot name a second car while its row exists. |
| `blueprints_owner_idx` (`owner_guest_id`, `created_at DESC`)                                                | My codes, the daily count.                                                                                                    |
| `blueprints_owner_request_key` UNIQUE partial (`owner_guest_id`, `request_id`) where live                   | Idempotent create.                                                                                                            |
| `blueprints_owner_build_key` UNIQUE partial (`owner_guest_id`, `build_hash`, `name`, `paint_id`) where live | One live code per car per guest.                                                                                              |
| `blueprints_deleted_idx` partial (`deleted_at`)                                                             | The purge of deleted rows.                                                                                                    |
| `matches_pkey`, `matches_ended_idx`                                                                         | Match id; expiry of summaries.                                                                                                |
| `match_events_pkey`, `match_events_stored_idx`                                                              | Events by match; expiry of events.                                                                                            |
| `daily_challenges_pkey`                                                                                     | Daily date.                                                                                                                   |
| `guest_sessions_expires_idx`                                                                                | Session expiry sweep.                                                                                                         |

## Migrations

`migrate(db, logger)` takes a session advisory lock (`pg_advisory_lock(0x626f6c74)`), creates
`schema_migrations` if needed, and applies each `NNN_name.sql` not yet applied, in order, each in
its own transaction together with its `schema_migrations` row. Re-running is a no-op. It refuses
to start when an applied file's checksum changed ("Add a new migration instead") and when the
database has a migration this code does not know (an older server against a newer database).
A failing migration rolls back completely (tested: no half-created table, no row). The server
bundle reads the files from `apps/server/dist/migrations`, which `pnpm build` copies from
`src/db/migrations`.

To add a migration: a new file `002_what_it_does.sql`. Never edit a shipped one.

## Car codes

`CAR-XXXXXX-XX`: the prefix, six random symbols and two check symbols, all from Crockford
Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`: no I, L, O or U). Example shape: `CAR-7K92QZ-R4`
(the specification's example; it does not pass the checksum).

- **Random part.** Six symbols from `crypto.randomBytes`, one byte each through its low five bits
  (exactly uniform, since 256 is a multiple of 32): 32^6 = 1,073,741,824 codes.
- **Checksum.** The eight symbols are a codeword of a Reed-Solomon code over GF(32)
  (x^5 + x^2 + 1) with two parity symbols: the sums of v_i·α^i and v_i·α^(2i) must equal two
  fixed constants (taken from the prefix, so `00000000` and other trivial strings are not codes).
  Its minimum distance is 3, so **every** error that touches one or two symbols is detected:
  any single wrong character, any swap of two characters (adjacent or not), any two wrong
  characters. A random 8-symbol string passes with probability 1/1,024 (measured: 0.098 percent
  of 200,000). The unit tests check all 31 substitutions at all 8 positions for 600 codes, every
  swap, and a grid of double errors.
- **Not a secret.** The checksum is public and catches typing mistakes only. What makes codes
  hard to walk is sparsity (a million live codes would still be one in a thousand of the space)
  together with the lookup limits below. A code is not an invitation and reveals no guest.
- **Reading.** `readCarCode` accepts what people type and paste: any case, spaces, dashes,
  dots, underscores and Unicode dashes as layout, the `CAR` prefix optional, whole links
  (`https://host/car/CAR-...`, `?car=...`, or a link inside a sentence). Crockford reading
  rules: I and L are 1, O is 0; U is refused. It reports `empty`, `incomplete` (with the count),
  `characters`, `length` or `checksum`, which the overlay turns into live feedback.
- **Collisions.** Uniqueness is the database's (`blueprints_code_key`). An insert that collides
  is retried with a fresh code, up to 8 times, then the request fails with 503
  ("We couldn't make a code just now."). Tested with a stubbed generator that repeats a taken code.
- **Dedupe and idempotency.** A create carries a client `requestId`; the same guest and request
  id return the same record (200, `reused: true`). The same guest sharing the same car (mechanical
  hash, name and paint) gets its existing code. A different car under a used request id is refused.
- **Immutable.** A record keeps the canonical JSON as shared. A renamed or repaired card shares
  under a new code; the old code keeps naming the old build. A code shared under an older catalog
  is served with `stale: true`, and the client shows the approved line `This build uses older part
values. Review it before racing.` with `Repair Build` (the shared auto-repair; the server record
  is never changed).

## Endpoints

All under `/api/v1`, behind the existing origin gate, the general per-address limit (240 a
minute) and the 16 kB body limit. Every error is `{ "error": { "code", "message" } }` with a
stable code and a full sentence. Bodies and parameters are parsed with zod (`blueprintApi.ts`)
before anything else; responses are parsed with the same schemas on the client.

| Method | Route                         | Auth        | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :----- | :---------------------------- | :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/blueprints`                 | guest token | `{ requestId, blueprint }`. The server re-validates with `validateUntrustedBlueprint` (strict schema, 8 kB bound, catalog, every rule), stores the canonical form and its hash, and answers 201 `{ id, code, name, buildHash, catalogVersion, createdAt, reused: false }`, or 200 with `reused: true`. Refusals: 400 `BAD_REQUEST` (malformed, extra fields such as a client total, bad name, reused request id), 409 `CATALOG_MISMATCH`, 422 `UNKNOWN_PART`, 422 `ILLEGAL_BUILD`, 413 (body over 16 kB), 429 `RATE_LIMITED`, 401 `UNAUTHORIZED`. |
| GET    | `/blueprints/:code`           | none        | `{ code, blueprint, buildHash, catalogVersion, currentCatalogVersion, stale, createdAt }`. Never the owner, the record id or anything about a guest. Any spelling `readCarCode` accepts. A bad checksum is 400 and an unknown code 404, both `We couldn't find that car. Check the code and try again.` `Cache-Control: no-store`, so a deleted code stops resolving at once.                                                                                                                                                                     |
| GET    | `/me/blueprints`              | guest token | `{ blueprints: [{ id, code, name, buildHash, catalogVersion, createdAt, stale }] }`, newest first, live only.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DELETE | `/me/blueprints/:id`          | guest token | 204. Soft delete. Someone else's id and an unknown id answer the same 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DELETE | `/me`                         | guest token | 204. Deletes the guest's blueprints (all, deleted ones included) and the guest session, in one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/car/:code` (outside `/api`) | none        | 302 to `/?car=<code>`, where the app opens Load Code. A link that is not a code is passed on as letters, digits and dashes only.                                                                                                                                                                                                                                                                                                                                                                                                                  |

`POST /api/v1/guest` is unchanged (the multiplayer side owns it). `GET /api/v1/daily` is not
implemented: the table exists for Milestone F.

A storage failure answers 503 `INTERNAL` with `Saved cars are not available right now. Try
again in a moment.` and the details go to the log only.

## Rate limits and quotas

| Limit                                                     | Value                                                                                  | Where                   |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------- | :---------------------- |
| Code creations per guest                                  | 10 a minute                                                                            | in process              |
| Code creations per guest per 24 hours                     | 100, deleted ones included                                                             | counted in the database |
| Live codes per guest                                      | 100                                                                                    | counted in the database |
| Lookups per client address                                | 30 a minute                                                                            | in process              |
| Failed lookups (bad checksum or unknown code) per address | 20 in 10 minutes, then every lookup from that address is refused until the window ends | in process              |
| Owner calls (list, delete) per guest                      | 60 a minute                                                                            | in process              |
| All API calls per address                                 | 240 a minute (existing)                                                                | in process              |

The checksum is checked before the database is asked, so a typo never costs a query, and junk
counts against the miss limit. In-process limits reset on restart and are per node; the launch
target is one node (Section 15.11). Behind Caddy set `TRUST_PROXY=1` so the address is the
client's.

## Match records

`apps/server/src/rooms/matchLog.ts` belongs to the room code: the match room calls
`recordMatch(summary)` once per decided race, and `setMatchRecorder` installs the storage. The
server installs `createMatchRecorder` at startup (and flushes pending records on shutdown).
For each summary it writes one `matches` row:

- track, weather, seed, catalog and protocol versions, round, whether builds were swapped;
- players in seat order as **per-match pseudonyms**: HMAC-SHA256 over the match id and the guest
  id, keyed with the server secret, 32 hex characters. The same guest in two matches has two
  unrelated ids, and a database dump alone cannot link a match to a guest session. Nicknames and
  room ids are not stored;
- the build hashes, the authoritative `RaceResult` (winner car, reason, race time, per car:
  finished, times, best lap, KO, hull, damage, shots, hits) and which car each seat drove;
- the forfeit, if any (`seat1:left`), start and end times.

If a summary carries `events` (the race's authoritative `RaceEvent`s), a sample is kept in
`match_events`: results, knockouts, component damage and repairs, finished repairs, hits of 4
points or more, explosions, triggered hazards, shields, tethers and misfires; at most 240, by
priority and size, stored in time order with numbers rounded to hundredths and strings capped.
Shots, steering, inputs and other routine events are never stored. Today's room does not pass
events, so `match_events` is filled only by tests; the hook is ready for it.

A failing write is logged (`match_record_failed`) and never reaches the room.

## Retention

`db/retention.ts`, run at startup and every hour (`retention_run` in the log):

| Data                       | Kept                                                                                                                                                                 |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw input streams          | Never stored.                                                                                                                                                        |
| `match_events`             | 30 days after they were stored.                                                                                                                                      |
| `matches`                  | 90 days after the match ended.                                                                                                                                       |
| Blueprints a guest deleted | 30 days (disputes), then removed for good.                                                                                                                           |
| Live shared blueprints     | Until their owner deletes them. When the owner's session expires the row stays public by code, with `owner_guest_id` set to NULL.                                    |
| `guest_sessions`           | Until expiry: 14 days after the last token, renewed when under 7 days remain, so one to two weeks after the last visit. Swept every minute and by the retention job. |

## Privacy and deletion

The privacy page (`PrivacyView`) is reachable from Settings (`Privacy Info`) and at `/privacy`.
It says, in plain words, what exists on the device and on the server, how long each is kept,
and what is never collected, with live counts (saved cars on this device; shared codes on the
server, asked only when this browser already has a guest, so looking never creates one).

`Delete My Data` (confirmed, `alertdialog`) calls `DELETE /api/v1/me` with the stored token,
then removes every `bolt.` key from local and session storage and restarts the game from a blank
slate. The server is asked first: once the guest pass is gone from the device nobody can delete
the codes it made. If the server cannot be reached nothing is deleted, the page says so, and
offers `Clear This Device Only` with the consequence stated (shared codes keep working and can
no longer be deleted). Deleting one saved card that has a code also deletes its server record
(the confirmation says the code will stop working); when offline, the deletion is queued in
`bolt.codes.pending.v1` and sent on the next visit that reaches the server.

With PostgreSQL the server forgets a deleted guest for good: a still-signed token whose session
is gone is refused (`adoptUnknownSessions` is off when a database is configured) and a guest call
with it gets a new identity. The in-memory store keeps re-registering valid tokens, because it
forgets every session on restart; the client drops its token on reset in either case.

## The client

- **My Blueprints** works from local storage exactly as before, offline included. `Copy Code`
  on a legal card asks the server for a code (or reuses the card's), records it on the card
  (shown in the mono face under the cost) and opens the share sheet. A card that is not legal
  offers `Repair Build` first. `Load Code` is in the header.
- **Share sheet:** the code large in a monospace face, `Copy Code`, `Copy Link`, and `Share`
  where `navigator.share` exists (phones); the clipboard is the fallback, then a selectable code
  if the browser blocks copying (plain HTTP on a LAN). Failures show the connection line
  `We can't reach the race server right now.` and `Try Again`; the card is never touched.
- **Load Code** (Home, My Blueprints, the garage's More menu, and `/car/<code>`): live checksum
  feedback, lookup only for a valid code, a preview composed from the real sprites with name,
  cost, chassis and a badge (`Ready to Race`, the approved outdated line, or the validator's
  reason), `Repair Build`, `Use This Build` (asks before replacing a different car) and `Save to
My Blueprints`.
- **Results:** `Save This Car` and `Share Blueprint` sit between `Change My Build` and `Back
Home` (`ResultsShare`, one line in `hud/Results.tsx`).
- A returning guest's session is renewed once per visit (sliding expiry); a visit never creates a
  guest by itself.

## Local setup

Without Docker (what this repository's tests use):

```bash
pnpm db:dev                     # PostgreSQL 16 on localhost:5499, databases bolt, bolt_test, bolt_e2e
DATABASE_URL=postgresql://bolt@localhost:5499/bolt pnpm dev
pnpm test:db                    # the PostgreSQL suites against bolt_test
pnpm test:e2e:codes             # Playwright codes.spec against bolt_e2e (after pnpm build)
pnpm db:dev stop
```

`scripts/db-dev.sh` finds the PostgreSQL binaries (`PG_BIN`, `pg_config`, `/usr/lib/postgresql/*`,
Homebrew), initializes `/var/tmp/boltpg/data` the first time with `trust` authentication for
local connections (development only), and runs the server as `postgres` when started by root
(PostgreSQL refuses to run as root). `BOLT_PG_DIR`, `BOLT_PG_PORT` and `BOLT_PG_SOCKET` move it.

With Docker:

```bash
pnpm install && pnpm build
docker compose up               # postgres:16-alpine and the server on http://localhost:2567
```

`docker-compose.yml` runs the host's build (mounted read-only) in `node:22-bookworm-slim` with
`DATABASE_URL` pointing at the `postgres` service and a named volume for the data. It is a
development stack only; the production images, Caddy and HTTPS are Milestone G. It was written
and its YAML checked here, but not run: this machine has no Docker daemon.

Without either, leave `DATABASE_URL` unset: everything works in memory and is lost on restart.

## Tests

| Suite                                         | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Needs a database |
| :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------- |
| `tests/unit/dbCarCode.test.ts`                | Format, alphabet, uniformity, every substitution, every swap, double errors, random pass rate, the reader (case, spacing, prefix, links, Crockford aliases, U, lengths, huge input).                                                                                                                                                                                                                                                                                                                                                       | no               |
| `tests/unit/dbMemory.test.ts`                 | The repository contract on the in-memory layer; event sampling; pseudonyms; the match hook.                                                                                                                                                                                                                                                                                                                                                                                                                                                | no               |
| `tests/unit/dbRoutes.test.ts`                 | A failed store: 503 with plain copy on every endpoint, nothing leaked; health `degraded`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | no               |
| `tests/unit/dbCodeClient.test.ts`             | The client: parsing, every failure reason, 401 renewal, queued offline deletes, `deleteMe` never creating a guest; codes on saved cars; the local reset.                                                                                                                                                                                                                                                                                                                                                                                   | no               |
| `tests/integration/persistenceMemory.test.ts` | The HTTP contract on in-memory storage; `DATABASE_URL` required in production; `main.ts` started for real: in memory without a database, refusing production without one, refusing an unreachable one.                                                                                                                                                                                                                                                                                                                                     | no               |
| `tests/integration/persistence.test.ts`       | Migrations from empty, re-run, concurrent, edited, newer, failing; the repository contract and the HTTP contract on PostgreSQL; concurrent creates; orphaned codes; stale codes; token hash only; a deleted guest refused; restart survival; a database going away. Skipped with a message when `BOLT_TEST_DATABASE_URL` is unset or unreachable.                                                                                                                                                                                          | yes              |
| `tests/e2e/codes.spec.ts`                     | Two browser profiles (two guests): save, copy (clipboard checked), load on the other device by a lowercase dashless code, same build hash, race it on the server; results save and share; `/car/<code>`; a stale code and its repair; deletion from the privacy page making the code 404. Starts its own server on `BOLT_E2E_PORT + 7` with `BOLT_E2E_DATABASE_URL` (default `postgresql://bolt@localhost:5499/bolt_e2e`); every test skips with the reason when that database is unreachable. Screenshots in `docs/evidence/persistence`. | yes              |

## Known limits

- In-process rate limits: per node, reset on restart. A determined guesser with many addresses
  is limited only by the code space; codes are not secrets by design.
- A guest whose session expires (one to two weeks without a visit) can no longer delete codes it
  shared; the codes stay public until a future cleanup policy says otherwise. The privacy page
  says so.
- A card keeps showing its code after its guest was replaced (session expired, new guest); the
  code still works, but deleting the card can no longer delete it on the server.
- Today's match room passes no events, so `match_events` stays empty in real play.
- `docker-compose.yml` has not been run (no Docker daemon here). The CI job for the PostgreSQL
  suite has not run either (no access to the repository's CI).
- Nothing here has had legal review (Section 16).
