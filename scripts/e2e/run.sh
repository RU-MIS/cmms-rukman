#!/usr/bin/env bash
# Runs the end-to-end suites against the LOCAL Supabase stack
# (`supabase start`). Keys are read from `supabase status`, never committed.
#   bash scripts/e2e/run.sh api   # API / storage / worker tests (node --test)
#   bash scripts/e2e/run.sh ui    # browser tests (Playwright) against the built web app
set -euo pipefail
cd "$(dirname "$0")/../.."
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
eval "$("$SUPABASE_BIN" status -o env 2>/dev/null | sed -n 's/^\(API_URL\|ANON_KEY\|SERVICE_ROLE_KEY\|DB_URL\)=/export E2E_\1=/p')"
case "$E2E_API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing to run e2e against non-local Supabase '$E2E_API_URL'"; exit 1 ;;
esac
case "${1:-api}" in
  api) npm --workspace e2e run test:api ;;
  ui)  npm --workspace e2e run test:ui ;;
  *)   echo "usage: run.sh api|ui"; exit 2 ;;
esac
