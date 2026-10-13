-- BOLT RIVALS: the Section 15.8 data model.
-- Applied once, inside a transaction, by apps/server/src/db/migrate.ts. Never edit a migration
-- that has shipped: the runner refuses to start when an applied file's checksum changes. Add a
-- new numbered file instead.

-- Anonymous guest sessions. The id is 128 random bits; the token itself is never stored, only
-- its SHA-256. No name, email, birthdate, address or device fingerprint exists anywhere.
CREATE TABLE guest_sessions (
  id            text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{22}$'),
  token_hash    text        NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL
);
CREATE INDEX guest_sessions_expires_idx ON guest_sessions (expires_at);

-- Shared blueprints. canonical_json is text, not jsonb, so the canonical serialization is kept
-- byte for byte. A code stays unique across every stored row, deleted ones included, so a code
-- that once named one car can never name another while its row exists.
CREATE TABLE blueprints (
  id               uuid        PRIMARY KEY,
  code             text        NOT NULL CHECK (code ~ '^CAR-[0-9A-HJKMNP-TV-Z]{6}-[0-9A-HJKMNP-TV-Z]{2}$'),
  owner_guest_id   text        REFERENCES guest_sessions (id) ON DELETE SET NULL,
  canonical_json   text        NOT NULL CHECK (length(canonical_json) <= 8192),
  build_hash       text        NOT NULL CHECK (build_hash ~ '^[0-9a-f]{64}$'),
  catalog_version  text        NOT NULL,
  name             text        NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
  paint_id         text        NOT NULL,
  request_id       text,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX blueprints_code_key ON blueprints (code);
CREATE INDEX blueprints_owner_idx ON blueprints (owner_guest_id, created_at DESC);
CREATE UNIQUE INDEX blueprints_owner_request_key ON blueprints (owner_guest_id, request_id)
  WHERE deleted_at IS NULL AND request_id IS NOT NULL AND owner_guest_id IS NOT NULL;
CREATE UNIQUE INDEX blueprints_owner_build_key ON blueprints (owner_guest_id, build_hash, name, paint_id)
  WHERE deleted_at IS NULL AND owner_guest_id IS NOT NULL;
CREATE INDEX blueprints_deleted_idx ON blueprints (deleted_at) WHERE deleted_at IS NOT NULL;

-- Finished matches. player_refs are per-match pseudonyms (an HMAC of match and guest), never
-- guest ids, so two matches of one player cannot be linked from this table alone.
CREATE TABLE matches (
  id                 text        PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  mode               text        NOT NULL,
  track_id           text        NOT NULL,
  weather_preset_id  text        NOT NULL,
  seed               bigint      NOT NULL,
  catalog_version    text        NOT NULL,
  player_refs        text[]      NOT NULL,
  player_kinds       text[]      NOT NULL,
  blueprint_hashes   text[]      NOT NULL,
  result             jsonb       NOT NULL,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NOT NULL,
  disconnect_reason  text,
  metrics            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  stored_at          timestamptz NOT NULL
);
CREATE INDEX matches_ended_idx ON matches (ended_at);

-- A compact sample of notable authoritative events per match (hits, knockouts, repairs, the
-- result). Raw input streams are never stored. Expires after 30 days.
CREATE TABLE match_events (
  match_id   text        NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  seq        integer     NOT NULL,
  tick       integer     NOT NULL,
  type       text        NOT NULL,
  car        smallint,
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  stored_at  timestamptz NOT NULL,
  PRIMARY KEY (match_id, seq)
);
CREATE INDEX match_events_stored_idx ON match_events (stored_at);

-- The daily engineering test (Section 17.4, Milestone F). Nonpersonal aggregates only.
CREATE TABLE daily_challenges (
  day                date        PRIMARY KEY,
  seed               bigint      NOT NULL,
  track_id           text        NOT NULL,
  weather_preset_id  text        NOT NULL,
  reference_bot      text        NOT NULL,
  aggregate          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
