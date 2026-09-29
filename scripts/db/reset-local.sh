#!/usr/bin/env bash
# Rebuilds the LOCAL development database from migrations + system seed.
# Refuses to run against anything that is not a local server, and never in
# production (spec §41).
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "${APP_ENV:-development}" = "production" ] && { echo "Refusing: APP_ENV=production"; exit 1; }
HOST="${PGHOST:-localhost}"
case "$HOST" in localhost|127.0.0.1|/*) ;; *) echo "Refusing to reset non-local host '$HOST'"; exit 1 ;; esac
DB="${LOCAL_DB:-rukman_erp_dev}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f scripts/db/local-supabase-shim.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
for f in supabase/seed/system/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
echo "Local database '$DB' rebuilt."
