#!/usr/bin/env bash
# Local PostgreSQL for development and the persistence tests, for machines without Docker.
#
#   pnpm db:dev          start (initializes the data directory the first time)
#   pnpm db:dev stop     stop it
#   pnpm db:dev status   is it running?
#
# It listens on localhost:5499 (and a socket in /tmp) with three databases: bolt (pnpm dev),
# bolt_test (pnpm test:db) and bolt_e2e (tests/e2e/codes.spec.ts). Authentication is "trust"
# for local connections only: a development convenience that must never reach a server.
# PostgreSQL refuses to run as root; when started by root this script runs it as `postgres`.
#
# Settings: PG_BIN (directory of initdb and pg_ctl), BOLT_PG_DIR (default /var/tmp/boltpg),
# BOLT_PG_PORT (5499), BOLT_PG_SOCKET (/tmp).
set -euo pipefail

command="${1:-start}"
dir="${BOLT_PG_DIR:-/var/tmp/boltpg}"
port="${BOLT_PG_PORT:-5499}"
socket="${BOLT_PG_SOCKET:-/tmp}"
data="$dir/data"

find_bin() {
  if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN"; return; fi
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/pg_ctl" ]; then
    pg_config --bindir; return
  fi
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r) \
    /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
    if [ -x "$candidate/pg_ctl" ]; then echo "$candidate"; return; fi
  done
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return; fi
  echo "PostgreSQL binaries not found. Install PostgreSQL 16 or set PG_BIN." >&2
  exit 1
}

bin="$(find_bin)"

# Runs a command as the owner of the cluster: postgres when we are root, ourselves otherwise.
as_owner() {
  if [ "$(id -u)" = "0" ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi
}

running() {
  as_owner "'$bin/pg_ctl' -D '$data' status" >/dev/null 2>&1
}

case "$command" in
  start)
    mkdir -p "$dir"
    if [ "$(id -u)" = "0" ]; then chown postgres "$dir"; fi
    if [ ! -f "$data/PG_VERSION" ]; then
      echo "Initializing $data"
      as_owner "'$bin/initdb' -D '$data' -U bolt --auth=trust >'$dir/initdb.log' 2>&1"
    fi
    if running; then
      echo "PostgreSQL is already running ($data)."
    else
      as_owner "'$bin/pg_ctl' -D '$data' -o '-p $port -k $socket' -l '$dir/log' -w start" >/dev/null
      echo "PostgreSQL started on localhost:$port (log: $dir/log)."
    fi
    for db in bolt bolt_test bolt_e2e; do
      if ! "$bin/psql" -h "$socket" -p "$port" -U bolt -d postgres -Atc \
        "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
        "$bin/createdb" -h "$socket" -p "$port" -U bolt "$db"
      fi
    done
    echo "DATABASE_URL=postgresql://bolt@localhost:$port/bolt"
    echo "Tests: pnpm test:db (bolt_test), Playwright codes.spec (bolt_e2e). Stop: pnpm db:dev stop"
    ;;
  stop)
    if running; then
      as_owner "'$bin/pg_ctl' -D '$data' -m fast -w stop" >/dev/null
      echo "PostgreSQL stopped."
    else
      echo "PostgreSQL is not running."
    fi
    ;;
  status)
    if running; then echo "running on localhost:$port ($data)"; else echo "not running"; exit 3; fi
    ;;
  *)
    echo "usage: scripts/db-dev.sh [start|stop|status]" >&2
    exit 2
    ;;
esac
