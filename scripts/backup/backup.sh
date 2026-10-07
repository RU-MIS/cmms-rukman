#!/usr/bin/env bash
# Backup of ONE instance: database data (Supabase CLI dump, app config and
# storage internals excluded — they come from the migrations / the files) and
# the files of the "documents" bucket. Output: <out>/backup-<date>.tar.gz
#   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY required.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?}" "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
OUT="${1:-.}"; STAMP="$(date -u +%Y%m%d-%H%M)"; WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
EXCL=(); while read -r t; do [ -n "$t" ] && EXCL+=(-x "$t"); done < scripts/backup/exclude-tables.txt
"$SUPABASE_BIN" db dump --db-url "$DATABASE_URL" --data-only --use-copy "${EXCL[@]}" -f "$WORK/data.sql"
(cd worker && node src/storage-backup.ts backup "$WORK/files")
git rev-parse HEAD > "$WORK/schema-version.txt" 2>/dev/null || true
ls supabase/migrations > "$WORK/migrations.txt"
tar -czf "$OUT/backup-$STAMP.tar.gz" -C "$WORK" .
echo "$OUT/backup-$STAMP.tar.gz"
