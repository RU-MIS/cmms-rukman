#!/usr/bin/env bash
# Verifies that this environment points to ITS OWN database and that the
# database is secured (docs/INSTANCE_ARCHITECTURE.md §6, spec §52).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?Set DATABASE_URL of this instance}"
: "${APP_INSTANCE_ID:?Set APP_INSTANCE_ID}"
if [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [[ "$DATABASE_URL" == *supabase* ]]; then
  REF=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https://([^.]+)\..*#\1#')
  [[ "$DATABASE_URL" == *"$REF"* ]] || { echo "FAIL: DATABASE_URL is not the project $REF of NEXT_PUBLIC_SUPABASE_URL"; exit 1; }
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -v instance_id="$APP_INSTANCE_ID" -f scripts/instance/verify.sql
