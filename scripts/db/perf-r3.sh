#!/usr/bin/env bash
# =============================================================================
# R3 performance checks on the throw-away local test database (never on a
# shared or production database). Builds a dataset like the R2 release-audit
# one (2,000 items, 10,000 stock movements) plus 1,000,000 audit rows, then
# measures as API users (role `authenticated`, RLS active):
#   * inventory list / stock movements / PO lines / bills  (AC-13.7, X-5)
#   * the same for a record- and godown-scoped user         (AC-8.4)
#   * audit viewer: first page with date + user filter       (AC-4.8, < 300 ms)
#   * 10,000-item all-or-nothing import, statement_timeout 8 s (AC-11.5)
# Usage: PGHOST=/var/run/postgresql bash scripts/db/perf-r3.sh   (after test-local.sh)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${PGHOST:-localhost}"
case "$HOST" in
  localhost|127.0.0.1|/*) ;;
  *) echo "Refusing to run against non-local host '$HOST'"; exit 1 ;;
esac
DB="${TEST_DB:-rukman_erp_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -At)

echo "== dataset"
"${PSQL[@]}" <<'SQL'
delete from test.ctx where k = 'perf';
insert into test.ctx values ('perf', test.fixture('PERF-' || floor(random() * 1e9)::text));
do $$
declare co uuid := (select (v->>'company')::uuid from test.ctx where k = 'perf');
        pair uuid := (select (v->>'pair')::uuid from test.ctx where k = 'perf');
        g1 uuid := (select (v->>'b336')::uuid from test.ctx where k = 'perf');
        g2 uuid := (select (v->>'warehouse')::uuid from test.ctx where k = 'perf');
        adm uuid := (select (v->>'admin')::uuid from test.ctx where k = 'perf');
        op uuid := (select (v->>'operator')::uuid from test.ctx where k = 'perf');
        sup uuid; i int; it uuid[];
begin
  insert into public.items (company_id, code, name, item_kind, base_unit_id, sale_price, purchase_price)
  select co, 'P-' || lpad(n::text, 5, '0'), 'Perf item ' || n, 'FINISHED_GOOD', pair, 100 + n % 50, 60 + n % 40
  from generate_series(1, 2000) n;
  it := array(select id from public.items where company_id = co and code like 'P-%' order by code);
  for i in 1 .. 10000 loop
    perform app.post_stock(co, it[1 + (i % 2000)], case when i % 3 = 0 then g2 else g1 end, date '2026-04-01' + (i % 150),
                           'OPENING', 1::smallint, 10, pair, 1, 50 + i % 30, null, 'perf', co, null, 'PERF');
  end loop;
  insert into public.parties (company_id, code, name) values (co, 'PSUP', 'Perf supplier') returning id into sup;
  insert into public.party_roles values (sup, 'SUPPLIER');
  -- 1,000,000 audit rows over a year, 20 actors
  insert into public.audit_log (company_id, table_name, row_id, action, old_data, new_data, actor_id, at)
  select co, (array['items', 'parties', 'vouchers', 'sales_orders', 'godowns'])[1 + n % 5], gen_random_uuid()::text, 'UPDATE',
         jsonb_build_object('n', n), jsonb_build_object('n', n + 1),
         case when n % 20 = 0 then op else adm end, now() - make_interval(secs => n * 30)
  from generate_series(1, 1000000) n;
end $$;
analyze;
SQL

echo "== timings (median of 5 runs, ms)"
"${PSQL[@]}" <<'SQL'
create or replace function pg_temp.ms(p_user uuid, p_sql text) returns numeric language plpgsql as $$
declare t0 timestamptz; d numeric[] := '{}'; i int;
begin
  perform test.login(p_user);
  for i in 1 .. 5 loop
    t0 := clock_timestamp();
    execute p_sql;
    d := d || extract(epoch from clock_timestamp() - t0)::numeric * 1000;
  end loop;
  perform test.login(null);
  return round((select percentile_cont(0.5) within group (order by x) from unnest(d) x)::numeric, 1);
end $$;
begin;
-- a scoped user: Godown B-336 only, own records only (INVENTORY role)
select test.user_with_role((select (v->>'company')::uuid from test.ctx where k = 'perf'), 'INVENTORY') as su \gset
select test.login((select (v->>'admin')::uuid from test.ctx where k = 'perf'));
select public.user_set_scope((select (v->>'company')::uuid from test.ctx where k = 'perf'), :'su', 'GODOWN',
                             array[(select (v->>'b336')::uuid from test.ctx where k = 'perf')]);
select public.user_set_record_scope((select (v->>'company')::uuid from test.ctx where k = 'perf'), :'su', 'OWN');
select test.login(null);
select format('%-58s %8s %8s %8s', 'query', 'owner', 'operator', 'scoped');
select format('%-58s %8s %8s %8s', q.label,
              pg_temp.ms((select (v->>'admin')::uuid from test.ctx where k = 'perf'), q.sql),
              pg_temp.ms((select (v->>'operator')::uuid from test.ctx where k = 'perf'), q.sql),
              pg_temp.ms(:'su', q.sql))
from (values
  ('Inventory list (v_inventory_items)', 'select count(*) from (select * from public.v_inventory_items order by item_code limit 100000) x'),
  ('Items with prices / avg cost / margin (v_items)', 'select count(*), sum(avg_cost), sum(margin) from public.v_items'),
  ('Stock movements with costs (v_stock_movement_costs)', 'select count(*), sum(value) from public.v_stock_movement_costs'),
  ('Stock movements (base table)', 'select count(*) from public.stock_movements'),
  ('Stock adjustments (record scope)', 'select count(*) from public.stock_adjustments'),
  ('Purchase order lines (v_purchase_order_lines)', 'select count(*) from public.v_purchase_order_lines'),
  ('Bills outstanding (v_bill_outstanding)', 'select count(*) from public.v_bill_outstanding')
) q(label, sql);
select format('%-58s %8s', 'Audit viewer, 1M rows: first page, date + user filter',
              pg_temp.ms((select (v->>'admin')::uuid from test.ctx where k = 'perf'),
                         format($q$select public.audit_search(%L, jsonb_build_object('actor_id', %L, 'from', current_date - 30, 'to', current_date), 50, null)$q$,
                                (select v->>'company' from test.ctx where k = 'perf'), (select v->>'operator' from test.ctx where k = 'perf'))));
select format('%-58s %8s', 'Audit viewer, 1M rows: first page, no filter',
              pg_temp.ms((select (v->>'admin')::uuid from test.ctx where k = 'perf'),
                         format($q$select public.audit_search(%L, '{}', 50, null)$q$, (select v->>'company' from test.ctx where k = 'perf'))));
rollback;
SQL

echo "== import: 10,000 items, all-or-nothing: API calls with statement_timeout = 8s, then the worker commit"
"${PSQL[@]}" <<'SQL'
begin;
select test.login((select (v->>'admin')::uuid from test.ctx where k = 'perf'));
set local statement_timeout = '8s';
select public.import_create((select (v->>'company')::uuid from test.ctx where k = 'perf'), 'ITEMS', 'perf.xlsx', 'ALL_OR_NOTHING', false,
                            array['code', 'name', 'item_kind', 'base_unit', 'sale_price', 'purchase_price'])->>'job_id' as job \gset
\timing on
-- the browser sends the file in calls of 2,000 rows
select sum(public.import_add_rows(:'job', (select jsonb_agg(jsonb_build_object('row_no', n + 1, 'data', jsonb_build_object(
  'code', 'IMP-' || lpad(n::text, 5, '0'), 'name', 'Imported ' || n, 'item_kind', 'FINISHED_GOOD', 'base_unit', 'PAIR',
  'sale_price', 100 + n % 7, 'purchase_price', 60 + n % 5))) from generate_series(c * 2000 + 1, c * 2000 + 2000) n))) as rows_added
from generate_series(0, 4) c;
select public.import_validate(:'job')->>'valid_rows' as valid_rows;
select public.import_commit(:'job', true)->>'status' as commit_status;
-- the worker (service role, no gateway timeout) commits the queued job as the importer
select test.login(null);
set local statement_timeout = 0;
select public.import_commit_next()->>'status' as worker_commit;
\timing off
select count(*) as imported from public.items where code like 'IMP-%';
rollback;
SQL
