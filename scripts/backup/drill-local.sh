#!/usr/bin/env bash
# Backup → wipe → restore drill against the LOCAL Supabase stack only.
set -euo pipefail
cd "$(dirname "$0")/../.."
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
eval "$("$SUPABASE_BIN" status -o env 2>/dev/null | sed -n 's/^\(API_URL\|SERVICE_ROLE_KEY\|DB_URL\)=/export \1=/p')"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "local only"; exit 1 ;; esac
export DATABASE_URL="$DB_URL" SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" SUPABASE_BIN
Q="select (select count(*) from companies)||'/'||(select count(*) from items)||'/'||(select count(*) from stock_movements)||'/'||(select coalesce(sum(base_qty),0) from stock_balances)||'/'||(select count(*) from documents)||'/'||(select count(*) from auth.users)||'/'||(select count(*) from email_outbox)||'/'||(select count(*) from storage.objects where bucket_id='documents')||'/'||(select count(*) from audit_log)||'/'||(select count(*) from storage.objects where bucket_id='item-images')||'/'||(select count(*) from item_images)||'/'||(select count(*) from item_rate_history)||'/'||(select count(*) from import_jobs)||'/'||(select count(*) from custom_field_definitions)||'/'||(select count(*) from storage.objects where bucket_id='company-assets')||'/'||(select count(*) from company_branding)||'/'||(select count(*) from company_modules)||'/'||(select count(*) from approval_rules)||'/'||(select count(*) from approval_actions)||'/'||(select count(*) from departments)||'/'||(select count(*) from party_opening_balances)"
BEFORE="$(psql "$DB_URL" -X -At -c "$Q")"
OUT="$(mktemp -d)"; ARCHIVE="$(bash scripts/backup/backup.sh "$OUT" | tail -1)"
echo "backup: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
"$SUPABASE_BIN" db reset >/dev/null 2>&1
# simulate "migrations only, no seed" of a new project
psql "$DB_URL" -X -q -c "truncate public.permissions, public.units cascade" 2>/dev/null
bash scripts/backup/restore.sh "$ARCHIVE"
AFTER="$(psql "$DB_URL" -X -At -c "$Q")"
echo "before: $BEFORE"; echo "after:  $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "OK: restore drill — data and files identical" || { echo "FAIL: restore differs"; exit 1; }
