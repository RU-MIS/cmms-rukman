#!/usr/bin/env bash
# Restore a backup made by backup.sh into a NEW, EMPTY Supabase project whose
# schema was created with the migrations (`supabase db push`) and NOT seeded.
#   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY of the TARGET project.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?}" "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
ARCHIVE="${1:?usage: restore.sh backup-<stamp>.tar.gz}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
tar -xzf "$ARCHIVE" -C "$WORK"
if [ "$(psql "$DATABASE_URL" -X -At -c 'select count(*) from public.companies')" != "0" ]; then
  echo "Target database is not empty — refusing to restore"; exit 1
fi
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$WORK/data.sql"
(cd worker && node src/storage-backup.ts restore "$WORK/files")
echo "Restored $(psql "$DATABASE_URL" -X -At -c 'select count(*) from public.companies') companies."
