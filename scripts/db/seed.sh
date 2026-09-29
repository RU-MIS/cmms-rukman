#!/usr/bin/env bash
# Applies the idempotent SYSTEM seed (permissions, units) to DATABASE_URL.
# It contains no company data and is safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?Set DATABASE_URL of this instance}"
for f in supabase/seed/system/*.sql; do
  echo "seed $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -f "$f"
done
