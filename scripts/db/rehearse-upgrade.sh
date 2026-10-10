#!/usr/bin/env bash
# =============================================================================
# Migration rehearsal on the LOCAL Supabase stack only (never production).
#
#   1. reset the local stack to the PRODUCTION migration chain (git worktree of <prod-ref>)
#   2. optionally restore a backup taken from production with scripts/backup/backup.sh
#      (otherwise the caller fills the database first, e.g. with the production e2e suites)
#   3. row-level snapshot of every table, production columns only
#   4. `supabase db push` of THIS branch — exactly what the deployment runs
#   5. row-level snapshot again; report, per table, existing rows that changed or
#      disappeared (rows added by the migrations are listed separately)
#
# usage: SUPABASE_BIN=… bash scripts/db/rehearse-upgrade.sh <prod-ref> [backup.tar.gz] [--keep-prod-state]
#   REHEARSE_REPORT_ONLY=1 REHEARSE_OUT=<dir>  recompute the report from existing snapshots
#   --keep-prod-state  stop after step 3 (fill / inspect the production state, run again with REHEARSE_SKIP_RESET=1)
# Output: <out-dir>/report.txt (default ./rehearsal-<stamp>, git-ignored). Exit 1 when existing rows changed
# outside the allow-list below.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$PWD"
SB="${SUPABASE_BIN:-supabase}"
REF="${1:?usage: rehearse-upgrade.sh <prod-ref> [backup.tar.gz] [--keep-prod-state]}"
BACKUP="${2:-}"; [ "$BACKUP" = "--keep-prod-state" ] && BACKUP=""
KEEP=0; for a in "$@"; do [ "$a" = "--keep-prod-state" ] && KEEP=1; done
OUT="${REHEARSE_OUT:-$REPO/rehearsal-$(date -u +%Y%m%d-%H%M%S)}"; mkdir -p "$OUT"

eval "$("$SB" status -o env 2>/dev/null | sed -n 's/^\(API_URL\|SERVICE_ROLE_KEY\|DB_URL\)=/export \1=/p')"
case "$DB_URL" in postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) echo "Refusing: '$DB_URL' is not the local stack"; exit 1 ;; esac
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "Refusing: API is not local"; exit 1 ;; esac

WT="$OUT/prod-worktree"
if [ "${REHEARSE_SKIP_RESET:-0}" != "1" ]; then
  git worktree remove --force "$WT" >/dev/null 2>&1 || true; rm -rf "$WT"; git worktree prune
  git worktree add --detach "$WT" "$REF" >/dev/null
  echo "== reset local stack to the production chain ($(ls "$WT/supabase/migrations" | wc -l) migrations at $REF)"
  "$SB" db reset --local --workdir "$WT" >"$OUT/reset.log" 2>&1
  if [ -n "$BACKUP" ]; then
    echo "== restore $BACKUP (new, unseeded production-schema project)"
    psql "$DB_URL" -X -q -c "truncate public.permissions, public.units cascade"
    DATABASE_URL="$DB_URL" SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" bash scripts/backup/restore.sh "$BACKUP" | tail -1
  fi
fi

# production columns of every table (taken from the production state, so new columns are ignored)
COLS="$OUT/columns.txt"
if [ ! -s "$COLS" ]; then
  psql "$DB_URL" -XAt -c "select c.table_schema||'.'||c.table_name, string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
    from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where t.table_type = 'BASE TABLE' and c.table_schema in ('public', 'app', 'auth', 'storage')
      and (c.table_schema in ('public', 'app') or c.table_name in ('users', 'objects', 'buckets'))
    group by 1 order by 1" > "$COLS"
fi
verify() {     # verify <label>: scripts/instance/verify.sql of THIS branch (needs an initialised instance)
  local id; id=$(psql "$DB_URL" -XAt -c "select instance_id from public.instance_meta limit 1" 2>/dev/null || true)
  [ -z "$id" ] && { echo "verify $1: skipped (instance not initialised)"; return; }
  if DATABASE_URL="$DB_URL" APP_INSTANCE_ID="$id" bash scripts/instance/verify.sh >"$OUT/verify-$1.log" 2>&1
  then echo "verify $1: $(grep -o 'OK:.*' "$OUT/verify-$1.log")"
  else echo "verify $1: $(grep -o 'FAIL:.*' "$OUT/verify-$1.log")"; fi
}
snapshot() {   # snapshot <dir>: one sorted file of row texts per table
  mkdir -p "$1"
  while IFS='|' read -r t cols; do
    psql "$DB_URL" -XAt -c "select row($cols)::text from $t" | LC_ALL=C sort > "$1/$t.rows"
  done < "$COLS"
}
if [ "${REHEARSE_REPORT_ONLY:-0}" != "1" ]; then
echo "== snapshot before"; snapshot "$OUT/before"
psql "$DB_URL" -XAt -c "select count(*) || ' migrations, last ' || max(version) from supabase_migrations.schema_migrations" | tee "$OUT/version-before.txt"
verify before
[ "$KEEP" = "1" ] && { echo "Production state kept (snapshot in $OUT/before). Re-run with REHEARSE_SKIP_RESET=1 REHEARSE_OUT=$OUT"; exit 0; }

echo "== supabase db push (dry run, then real)"
( cd "$REPO" && "$SB" db push --db-url "$DB_URL" --dry-run ) > "$OUT/push-dry-run.log" 2>&1
grep -c '^ • ' "$OUT/push-dry-run.log" | sed 's/^/migrations pending: /'
start=$(date +%s)
( cd "$REPO" && { yes 2>/dev/null || true; } | "$SB" db push --db-url "$DB_URL" ) > "$OUT/push.log" 2>&1
echo "push took $(( $(date +%s) - start )) s"
psql "$DB_URL" -XAt -c "select count(*) || ' migrations, last ' || max(version) from supabase_migrations.schema_migrations" | tee "$OUT/version-after.txt"

verify after
echo "== snapshot after"; snapshot "$OUT/after"
fi

# tables where migrations are EXPECTED to change existing rows (catalogue / defaults owned by the migrations)
ALLOW='^(public\.permissions|public\.permission_modules|app\.default_roles|app\.default_sequences|app\.default_approvals|app\.doc_types|app\.data_scope_registry|app\.godown_scoped_tables|app\.import_entities|public\.data_scope_dimensions|storage\.buckets)$'
fail=0
REPORT="$OUT/report.txt"
{
  printf '%-45s %9s %9s %9s %9s\n' table rows_before rows_after changed_or_gone added
  for f in "$OUT"/before/*.rows; do
    t=$(basename "$f" .rows); a="$OUT/after/$t.rows"
    nb=$(wc -l < "$f"); na=$(wc -l < "$a")
    gone=$(LC_ALL=C comm -23 <(LC_ALL=C sort "$f") <(LC_ALL=C sort "$a") | wc -l)
    added=$(LC_ALL=C comm -13 <(LC_ALL=C sort "$f") <(LC_ALL=C sort "$a") | wc -l)
    [ "$gone" = 0 ] && [ "$added" = 0 ] && continue
    flag=""; if [ "$gone" != 0 ] && ! [[ "$t" =~ $ALLOW ]]; then flag="  <-- existing rows changed"; fail=1; fi
    printf '%-45s %9s %9s %9s %9s%s\n' "$t" "$nb" "$na" "$gone" "$added" "$flag"
  done
} > "$REPORT"     # not a pipe: \$fail must survive the loop
if [ "$fail" = 0 ]; then echo "OK: no existing row outside the catalogue allow-list was changed or removed" >> "$REPORT"
else echo "FAIL: existing rows changed — compare $OUT/before and $OUT/after" >> "$REPORT"; fi
cat "$REPORT"
[ -d "$WT" ] && git worktree remove --force "$WT" >/dev/null 2>&1 || true
exit "$fail"
