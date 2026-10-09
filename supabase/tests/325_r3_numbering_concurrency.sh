#!/usr/bin/env bash
# =============================================================================
# PLATFORM R3 — AC-2.4: 20 concurrent sales orders with a configured pattern
# get 20 distinct, consecutive numbers (real parallel sessions).
# Runs against the throw-away test database only (TEST_DB).
# =============================================================================
set -euo pipefail
DB="${TEST_DB:?TEST_DB is required}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -At)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"${PSQL[@]}" -c "delete from test.ctx where k = 'numc'" -c "insert into test.ctx values ('numc', test.fixture('NUMC-' || floor(random()*1e9)::text))" >/dev/null
val() { "${PSQL[@]}" -c "select v->>'$1' from test.ctx where k = 'numc'"; }
CO=$(val company); ADMIN=$(val admin); OP=$(val operator); FG=$(val fg); BOX=$(val box)
CUST=$("${PSQL[@]}" -c "select test.party('$CO', 'NC1', 'CUSTOMER')")
"${PSQL[@]}" >/dev/null <<SQL
begin;
select test.login('$ADMIN');
select public.sequence_save('$CO', 'SALES_ORDER', '{"prefix":"SO-","pattern":"{PREFIX}{YYYY}-{NUMBER}","padding":6,"reset_policy":"CALENDAR"}');
commit;
SQL

create() {
  "${PSQL[@]}" <<SQL >"$TMP/so_$1.out" 2>&1
begin;
select test.login('$OP');
select public.doc_submit('SALES_ORDER', public.doc_save('SALES_ORDER', jsonb_build_object(
  'company_id', '$CO', 'doc_date', '2026-09-10', 'party_id', '$CUST', 'customer_po_no', 'conc-$1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', '$FG', 'qty', 1, 'unit_id', '$BOX', 'rate', 10)))))->>'doc_no';
select pg_sleep(0.1);
commit;
SQL
}
for i in $(seq 1 20); do create "$i" & done
wait

TOTAL=$("${PSQL[@]}" -c "select count(*) from public.sales_orders where company_id = '$CO' and customer_po_no like 'conc-%'")
DISTINCT=$("${PSQL[@]}" -c "select count(distinct doc_no) from public.sales_orders where company_id = '$CO' and customer_po_no like 'conc-%'")
RANGE=$("${PSQL[@]}" -c "select min(doc_no) || '..' || max(doc_no) from public.sales_orders where company_id = '$CO' and customer_po_no like 'conc-%'")
echo "created=$TOTAL distinct=$DISTINCT range=$RANGE"
[ "$TOTAL" = "20" ] && [ "$DISTINCT" = "20" ] || { echo "FAIL: duplicate or missing numbers"; cat "$TMP"/so_*.out; exit 1; }
[ "$RANGE" = "SO-2026-000001..SO-2026-000020" ] || { echo "FAIL: numbers are not consecutive"; exit 1; }
echo "ok - 20 concurrent sales orders got SO-2026-000001 … SO-2026-000020 without gaps"
