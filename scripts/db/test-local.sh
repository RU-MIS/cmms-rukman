#!/usr/bin/env bash
# Creates a throw-away local database, applies the Supabase shim, every
# migration and the system seed, then runs supabase/tests/*.sql.
# Uses only a LOCAL PostgreSQL server (PGHOST/PGPORT/PGUSER from env, default
# local socket). It refuses to run against a non-local host.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST="${PGHOST:-localhost}"
case "$HOST" in
  localhost|127.0.0.1|/*) ;;
  *) echo "Refusing to run tests against non-local host '$HOST'"; exit 1 ;;
esac

DB="${TEST_DB:-rukman_erp_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f scripts/db/local-supabase-shim.sql
for f in supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done
for f in supabase/seed/system/*.sql; do
  [ -e "$f" ] || continue
  echo "seed     $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

"${PSQL[@]}" -d "$DB" -f scripts/db/test-helpers.sql

fail=0
for f in supabase/tests/*.sql; do
  [ -e "$f" ] || continue
  # each test file wraps itself in BEGIN … ROLLBACK
  if "${PSQL[@]}" -d "$DB" -f "$f" >/tmp/rukman_test_out.txt 2>&1; then
    echo "PASS     $(basename "$f")"
  else
    echo "FAIL     $(basename "$f")"; cat /tmp/rukman_test_out.txt; fail=1
  fi
done
for f in supabase/tests/*.sh; do
  [ -e "$f" ] || continue
  if TEST_DB="$DB" bash "$f" >/tmp/rukman_test_out.txt 2>&1; then
    echo "PASS     $(basename "$f")"
  else
    echo "FAIL     $(basename "$f")"; cat /tmp/rukman_test_out.txt; fail=1
  fi
done
exit $fail
