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
# The permission catalogue is partly created by the migrations and fully
# contained in the backup: start from the backup's catalogue (the target has
# no company yet, so nothing references it).
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c 'truncate public.permissions cascade'
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$WORK/data.sql"
(cd worker && node src/storage-backup.ts restore "$WORK/files")
echo "Restored $(psql "$DATABASE_URL" -X -At -c 'select count(*) from public.companies') companies."
