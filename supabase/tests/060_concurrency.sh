#!/usr/bin/env bash
# =============================================================================
# Concurrency tests with real parallel sessions (spec §44, §50):
#  1. Two users receive against the same PO line at the same time; pending is
#     10 box, each tries 6 box → exactly one succeeds, pending ends at 4.
#  2. Ten users confirm POs at the same time → ten different numbers.
# Runs against the throw-away test database only (TEST_DB).
# =============================================================================
set -euo pipefail
DB="${TEST_DB:?TEST_DB is required}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -At)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- committed setup -------------------------------------------------------
"${PSQL[@]}" -c "delete from test.ctx where k = 'conc'" -c "insert into test.ctx values ('conc', test.fixture('CONC-' || floor(random()*1e9)::text))" >/dev/null
val() { "${PSQL[@]}" -c "select v->>'$1' from test.ctx where k = 'conc'"; }
CO=$(val company); OP=$(val operator); ALEEM=$(val aleem); FG=$(val fg); BOX=$(val box); B336=$(val b336)

PO=$("${PSQL[@]}" <<SQL | tail -1
begin;
select test.login('$OP');
select (public.doc_submit('JOB_WORK_ORDER', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
  'company_id', '$CO', 'doc_date', '2026-09-01', 'party_id', '$ALEEM',
  'lines', jsonb_build_array(jsonb_build_object('item_id', '$FG', 'qty', 10, 'unit_id', '$BOX'))))))->>'id';
commit;
SQL
)
LINE=$("${PSQL[@]}" -c "select id from public.job_work_order_lines where order_id = '$PO'")

# ---- 1. concurrent receipts --------------------------------------------------
receive() {
  "${PSQL[@]}" <<SQL >"$TMP/recv_$1.out" 2>&1 || true
begin;
select test.login('$OP');
select (public.doc_submit('JOB_WORK_RECEIPT', public.doc_save('JOB_WORK_RECEIPT', jsonb_build_object(
  'company_id', '$CO', 'doc_date', '2026-09-23', 'party_id', '$ALEEM', 'godown_id', '$B336',
  'lines', jsonb_build_array(jsonb_build_object('order_line_id', '$LINE', 'item_id', '$FG',
                                                'qty', 6, 'unit_id', '$BOX', 'rate', 100))))))->>'status';
select pg_sleep(1);
commit;
SQL
}
receive 1 & receive 2 & wait

POSTED=$("${PSQL[@]}" -c "select count(*) from public.job_work_receipts r join public.job_work_receipt_lines l on l.receipt_id = r.id
                           where l.order_line_id = '$LINE' and r.status = 'POSTED'")
PENDING=$("${PSQL[@]}" -c "select app.fmt_qty('$FG', ol.ordered_base_qty - app.job_work_received(ol.id), current_date)
                           from public.job_work_order_lines ol where ol.id = '$LINE'")
REJECTED=$(grep -l "more than pending" "$TMP"/recv_*.out | wc -l)
echo "posted=$POSTED pending='$PENDING' rejected=$REJECTED"
[ "$POSTED" = "1" ] || { echo "FAIL: expected exactly one posted receipt"; cat "$TMP"/recv_*.out; exit 1; }
[ "$PENDING" = "4 BOX (72 PAIR)" ] || { echo "FAIL: expected pending 4 box"; exit 1; }
[ "$REJECTED" = "1" ] || { echo "FAIL: expected the other receipt to be rejected"; cat "$TMP"/recv_*.out; exit 1; }
echo "ok - concurrent receipts on one PO line: one posted, one rejected, pending 4 box"

# ---- 2. concurrent numbering -------------------------------------------------
confirm() {
  "${PSQL[@]}" <<SQL >"$TMP/po_$1.out" 2>&1
begin;
select test.login('$OP');
select (public.doc_submit('JOB_WORK_ORDER', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
  'company_id', '$CO', 'doc_date', '2026-09-02', 'party_id', '$ALEEM', 'remarks', 'conc-$1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', '$FG', 'qty', 1, 'unit_id', '$BOX'))))))->>'doc_no';
select pg_sleep(0.2);
commit;
SQL
}
for i in $(seq 1 10); do confirm "$i" & done
wait
TOTAL=$("${PSQL[@]}" -c "select count(*) from public.job_work_orders where company_id = '$CO' and remarks like 'conc-%' and status = 'OPEN'")
DISTINCT=$("${PSQL[@]}" -c "select count(distinct doc_no) from public.job_work_orders where company_id = '$CO' and remarks like 'conc-%'")
echo "confirmed=$TOTAL distinct_numbers=$DISTINCT"
[ "$TOTAL" = "10" ] && [ "$DISTINCT" = "10" ] || { echo "FAIL: duplicate or missing numbers"; cat "$TMP"/po_*.out; exit 1; }
echo "ok - 10 concurrent PO confirmations got 10 different numbers"
