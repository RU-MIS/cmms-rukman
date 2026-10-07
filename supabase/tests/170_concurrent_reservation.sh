#!/usr/bin/env bash
# =============================================================================
# Concurrency: two users reserve the LAST stock at the same moment.
# Stock 100 pair; order 1 and order 2 each try to reserve 70 in parallel →
# exactly one succeeds, reserved ends at 70, available 30, never negative.
# Also two parallel dispatches of the last 100 pair (two orders, no
# reservation) → only one posts.
# =============================================================================
set -euo pipefail
DB="${TEST_DB:?TEST_DB is required}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -At)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"${PSQL[@]}" -c "delete from test.ctx where k = 'res'" \
             -c "insert into test.ctx values ('res', test.fixture('RES-' || floor(random()*1e9)::text))" >/dev/null
val() { "${PSQL[@]}" -c "select v->>'$1' from test.ctx where k = 'res'"; }
CO=$(val company); ADMIN=$(val admin); FG=$(val fg); PAIR=$(val pair); B336=$(val b336)

CUST=$("${PSQL[@]}" -c "select test.party('$CO', 'CUST-' || floor(random()*1e6)::text, 'CUSTOMER')")
"${PSQL[@]}" -c "select test.stock_in('$CO', '$FG', '$B336', 100)" >/dev/null

order() {
  "${PSQL[@]}" <<SQL | tail -1
begin;
select test.login('$ADMIN');
select (public.customer_po_approve(public.customer_po_create('$CO', '$CUST', jsonb_build_object(
  'po_no', 'C-' || gen_random_uuid(), 'lines', jsonb_build_array(jsonb_build_object(
  'item_id', '$FG', 'qty', 70, 'unit_id', '$PAIR', 'quoted_rate', 1)))))->>'sales_order_id');
commit;
SQL
}
SO1=$(order); SO2=$(order)
LINE1=$("${PSQL[@]}" -c "select id from public.sales_order_lines where order_id = '$SO1'")
LINE2=$("${PSQL[@]}" -c "select id from public.sales_order_lines where order_id = '$SO2'")

# ---- 1. parallel reservations ----------------------------------------------
reserve() {
  "${PSQL[@]}" <<SQL >"$TMP/res_$1.out" 2>&1 || true
begin;
select test.login('$ADMIN');
select public.sales_order_reserve('$2', '$B336', 70);
select pg_sleep(1);
commit;
SQL
}
reserve 1 "$LINE1" & reserve 2 "$LINE2" & wait

RESERVED=$("${PSQL[@]}" -c "select reserved_qty from public.stock_reserved where item_id = '$FG' and godown_id = '$B336'")
COUNT=$("${PSQL[@]}" -c "select count(*) from public.stock_reservations where item_id = '$FG'")
REJECTED=$(grep -l "Cannot reserve" "$TMP"/res_*.out | wc -l)
echo "reserved=$RESERVED reservations=$COUNT rejected=$REJECTED"
[ "$RESERVED" = "70.000" ] || { echo "FAIL: expected 70 reserved"; cat "$TMP"/res_*.out; exit 1; }
[ "$COUNT" = "1" ] || { echo "FAIL: expected exactly one reservation"; exit 1; }
[ "$REJECTED" = "1" ] || { echo "FAIL: expected one rejected reservation"; cat "$TMP"/res_*.out; exit 1; }
echo "ok - parallel reservations of the last stock: one reserved, one rejected, available 30"

# ---- 2. parallel dispatch of the last unreserved stock ----------------------
"${PSQL[@]}" -c "select 1 from public.stock_reservations" >/dev/null
"${PSQL[@]}" <<SQL >/dev/null
begin;
select test.login('$ADMIN');
select public.reservation_release(id) from public.stock_reservations where item_id = '$FG';
commit;
SQL
dispatch() {
  "${PSQL[@]}" <<SQL >"$TMP/dsp_$1.out" 2>&1 || true
begin;
select test.login('$ADMIN');
select public.doc_submit('DISPATCH', public.doc_save('DISPATCH', jsonb_build_object(
  'company_id', '$CO', 'doc_date', current_date, 'sales_order_id', '$2', 'godown_id', '$B336',
  'lines', jsonb_build_array(jsonb_build_object('order_line_id', '$3', 'item_id', '$FG', 'qty', 70, 'unit_id', '$PAIR')))))->>'status';
select pg_sleep(1);
commit;
SQL
}
dispatch 1 "$SO1" "$LINE1" & dispatch 2 "$SO2" "$LINE2" & wait

POSTED=$("${PSQL[@]}" -c "select count(*) from public.dispatches d join public.sales_orders o on o.id = d.sales_order_id
                          where o.id in ('$SO1', '$SO2') and d.status = 'POSTED'")
STOCK=$("${PSQL[@]}" -c "select sum(base_qty) from public.stock_balances where item_id = '$FG' and godown_id = '$B336'")
echo "posted=$POSTED stock=$STOCK"
[ "$POSTED" = "1" ] || { echo "FAIL: expected one dispatch"; cat "$TMP"/dsp_*.out; exit 1; }
[ "$STOCK" = "30.000" ] || { echo "FAIL: expected 30 left"; exit 1; }
grep -q "Insufficient stock" "$TMP"/dsp_*.out || { echo "FAIL: second dispatch not rejected for stock"; cat "$TMP"/dsp_*.out; exit 1; }
echo "ok - parallel dispatches of the last stock: one posted, one rejected, stock never negative"
