-- =============================================================================
-- PLATFORM R3 — financial field security (W13, D3)
--   * registry-driven: every masked view column and every RPC surface is
--     checked for each of the eight rights (a user holding every permission
--     except that one sees no value of its classes; a holder sees them)
--   * completeness: money-like columns registered / whitelisted, functions
--     reading registered columns reviewed, base columns not selectable
--   * inference rules, journal / report gap closed, owner sees everything
-- AC 13.1–13.5, 13.8
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('FINSEC-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- ------------------------------------------------------------ data (owner)
select test.login(null);
select test.party(test.id('company'), 'SUP', 'SUPPLIER') as v \gset sup_
select test.party(test.id('company'), 'CUS', 'CUSTOMER') as v \gset cus_
update public.items set sale_price = 400, purchase_price = 150, min_sale_rate = 100, max_sale_rate = 1000 where id = test.id('fg');
insert into public.party_item_rates (company_id, party_id, item_id, rate_type, rate, effective_from)
values (test.id('company'), :'cus_v', test.id('fg'), 'SALE', 390, date '2026-04-01');
select id as v from public.voucher_books where company_id = test.id('company') and code = 'MAIN' \gset book_
select id as v from public.accounts where company_id = test.id('company') and system_key = 'CASH' \gset cash_

select test.login(test.id('admin'));
-- landed: opening FG 10 box @ 190 per pair
select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'godown_id', test.id('b336'), 'reason', 'OPENING',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', 1, 'qty', 180, 'unit_id', test.id('pair'), 'rate', 190)))));
-- purchase: PO 100 MTR @ 200, receipt 10 MTR with 5 %
insert into t values ('po', public.doc_save('PURCHASE_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-02', 'party_id', :'sup_v',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 100, 'unit_id', test.id('mtr'), 'rate', 200)))));
select public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po'));
insert into t select 'pr', (public.doc_submit('PURCHASE_RECEIPT', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-03', 'party_id', :'sup_v', 'godown_id', test.id('rm_godown'), 'supplier_bill_no', 'S-1',
  'lines', jsonb_build_array(jsonb_build_object('po_line_id', (select id from public.purchase_order_lines where order_id = (select v from t where k = 'po')),
     'item_id', test.id('rm'), 'qty', 10, 'unit_id', test.id('mtr'), 'rate', 200, 'gst_rate', 5)))))->>'id')::uuid;
-- sales: order 5 box @ 400, dispatch, bill 36000, receipt 20000, payment 1000
insert into t values ('so', public.doc_save('SALES_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-05', 'party_id', :'cus_v', 'customer_po_no', 'CPO-0', 'delivery_date', '2026-09-30',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 5, 'unit_id', test.id('box'), 'rate', 400)))));
select public.doc_submit('SALES_ORDER', (select v from t where k = 'so'));
insert into t select 'd1', (public.doc_submit('DISPATCH', public.doc_save('DISPATCH', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-20', 'sales_order_id', (select v from t where k = 'so'), 'godown_id', test.id('b336'),
  'lines', jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.sales_order_lines where order_id = (select v from t where k = 'so')),
     'item_id', test.id('fg'), 'qty', 5, 'unit_id', test.id('box'))))))->>'id')::uuid;
insert into t values ('bill', public.doc_save('CUSTOMER_BILL', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-21', 'bill_no', 'T/1', 'party_id', :'cus_v', 'amount', 36000,
  'lines', jsonb_build_array(jsonb_build_object('dispatch_id', (select v from t where k = 'd1'))))));
select public.doc_submit('CUSTOMER_BILL', (select v from t where k = 'bill'));
set constraints all immediate; set constraints all deferred;
insert into t values ('rcpt', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-27', 'voucher_type', 'RECEIPT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v', 'party_id', :'cus_v', 'amount', 20000)));
select public.voucher_set_allocations((select v from t where k = 'rcpt'), jsonb_build_array(jsonb_build_object(
  'bill_table', 'customer_bills', 'bill_id', (select v from t where k = 'bill'), 'amount', 20000)));
select public.doc_submit('VOUCHER', (select v from t where k = 'rcpt'));
insert into t values ('pay', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-28', 'voucher_type', 'PAYMENT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v', 'party_id', :'sup_v', 'amount', 1000)));
select public.voucher_set_allocations((select v from t where k = 'pay'), jsonb_build_array(jsonb_build_object(
  'bill_table', 'purchase_receipts', 'bill_id', (select v from t where k = 'pr'), 'amount', 1000)));
select public.doc_submit('VOUCHER', (select v from t where k = 'pay'));
set constraints all immediate; set constraints all deferred;
-- customer PO with rates
insert into t values ('cpo', public.customer_po_create(test.id('company'), :'cus_v', jsonb_build_object('po_no', 'CPO-1', 'po_date', '2026-09-06',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('box'), 'quoted_rate', 380)))));

-- outward adjustment (average cost side)
select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-25', 'godown_id', test.id('b336'), 'reason', 'DAMAGE',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', -1, 'qty', 18, 'unit_id', test.id('pair'))))));

-- ------------------------------------------------------------ the eight rights and what each class needs
create temp table req (cls text primary key, perms text[]) on commit drop;
insert into req values
  ('SALE', '{items.view_sale_rate}'), ('PURCHASE', '{items.view_purchase_rate}'), ('LANDED', '{costs.view_landed_cost}'),
  ('LANDED_PURCHASE', '{costs.view_landed_cost,items.view_purchase_rate}'), ('AVERAGE', '{items.view_cost}'),
  ('VALUATION', '{costs.view_stock_valuation,items.view_cost}'), ('AMOUNT', '{accounts.view_amounts}'),
  ('AMOUNT_SALE', '{accounts.view_amounts,items.view_sale_rate}'), ('AMOUNT_PURCHASE', '{accounts.view_amounts,items.view_purchase_rate}'),
  ('MARGIN', '{sales.view_margin,items.view_sale_rate,items.view_cost}'),
  ('PROFIT', '{reports.view_profit,accounts.view_amounts,items.view_sale_rate,items.view_purchase_rate}'),
  ('PROFIT_STOCK', '{reports.view_profit,accounts.view_amounts,items.view_sale_rate,items.view_purchase_rate,costs.view_stock_valuation,items.view_cost}');
grant select on req to authenticated;

-- masked view columns: (view, column, classes needed, row filter, seeded with a value)
create temp table vc (rel text, col text, cls text[], filter text, sample boolean) on commit drop;
insert into vc values
  ('v_items', 'sale_price', '{SALE}', 'id = test.id(''fg'')', true),
  ('v_items', 'min_sale_rate', '{SALE}', 'id = test.id(''fg'')', true),
  ('v_items', 'max_sale_rate', '{SALE}', 'id = test.id(''fg'')', true),
  ('v_items', 'purchase_price', '{PURCHASE}', 'id = test.id(''fg'')', true),
  ('v_items', 'job_work_rate', '{PURCHASE}', 'id = test.id(''fg'')', true),
  ('v_items', 'avg_cost', '{AVERAGE}', 'id = test.id(''fg'')', true),
  ('v_items', 'margin', '{MARGIN}', 'id = test.id(''fg'')', true),
  ('v_items', 'margin_pct', '{MARGIN}', 'id = test.id(''fg'')', true),
  ('v_inventory_items', 'sale_price', '{SALE}', 'item_id = test.id(''fg'')', true),
  ('v_purchase_order_lines', 'rate', '{PURCHASE}', 'true', true),
  ('v_purchase_pending_lines', 'rate', '{PURCHASE}', 'true', true),
  ('v_purchase_order_line_rates', 'rate', '{PURCHASE}', 'true', true),
  ('v_purchase_receipts', 'taxable_amount', '{PURCHASE}', 'true', true),
  ('v_purchase_receipts', 'gst_amount', '{PURCHASE}', 'true', true),
  ('v_purchase_receipts', 'total_amount', '{PURCHASE}', 'true', true),
  ('v_sales_order_lines', 'approved_rate', '{SALE}', 'true', true),
  ('v_sales_order_lines', 'quoted_rate', '{SALE}', 'true', false),
  ('v_sales_order_lines', 'reference_rate', '{SALE}', 'true', false),
  ('v_sales_order_lines', 'margin_per_base', '{MARGIN}', 'true', true),
  ('v_customer_po_lines', 'reference_rate', '{SALE}', 'true', true),
  ('v_customer_po_lines', 'quoted_rate', '{SALE}', 'true', true),
  ('v_customer_po_lines', 'approved_rate', '{SALE}', 'true', false),
  ('v_customer_po_lines', 'quote_difference', '{SALE}', 'true', true),
  ('v_bills', 'bill_amount', '{AMOUNT_SALE}', 'side = ''RECEIVABLE''', true),
  ('v_bills', 'bill_amount', '{AMOUNT_PURCHASE}', 'side = ''PAYABLE''', true),
  ('v_bill_outstanding', 'bill_amount', '{AMOUNT_SALE}', 'side = ''RECEIVABLE''', true),
  ('v_bill_outstanding', 'settled_amount', '{AMOUNT_SALE}', 'side = ''RECEIVABLE''', true),
  ('v_bill_outstanding', 'outstanding_amount', '{AMOUNT_SALE}', 'side = ''RECEIVABLE''', true),
  ('v_bill_outstanding', 'bill_amount', '{AMOUNT_PURCHASE}', 'side = ''PAYABLE''', true),
  ('v_bill_outstanding', 'settled_amount', '{AMOUNT_PURCHASE}', 'side = ''PAYABLE''', true),
  ('v_bill_outstanding', 'outstanding_amount', '{AMOUNT_PURCHASE}', 'side = ''PAYABLE''', true),
  ('v_customer_bill_register', 'amount', '{AMOUNT_SALE}', 'true', true),
  ('v_customer_bill_register', 'tds', '{AMOUNT_SALE}', 'true', true),
  ('v_customer_bill_register', 'amount_received', '{AMOUNT_SALE}', 'true', true),
  ('v_customer_bill_register', 'less_amount', '{AMOUNT_SALE}', 'true', true),
  ('v_customer_bill_register', 'debit_note', '{AMOUNT_SALE}', 'true', true),
  ('v_customer_bill_register', 'outstanding', '{AMOUNT_SALE}', 'true', true),
  ('v_payment_allocations', 'voucher_amount', '{AMOUNT_SALE}', 'voucher_type = ''RECEIPT''', true),
  ('v_payment_allocations', 'bill_amount', '{AMOUNT_SALE}', 'voucher_type = ''RECEIPT''', true),
  ('v_payment_allocations', 'allocated_amount', '{AMOUNT_SALE}', 'voucher_type = ''RECEIPT''', true),
  ('v_payment_allocations', 'tds_amount', '{AMOUNT_SALE}', 'voucher_type = ''RECEIPT''', false),
  ('v_payment_allocations', 'short_amount', '{AMOUNT_SALE}', 'voucher_type = ''RECEIPT''', false),
  ('v_payment_allocations', 'debit_note_amount', '{AMOUNT_SALE}', 'voucher_type = ''RECEIPT''', false),
  ('v_payment_allocations', 'voucher_amount', '{AMOUNT_PURCHASE}', 'voucher_type = ''PAYMENT''', true),
  ('v_payment_allocations', 'bill_amount', '{AMOUNT_PURCHASE}', 'voucher_type = ''PAYMENT''', true),
  ('v_payment_allocations', 'allocated_amount', '{AMOUNT_PURCHASE}', 'voucher_type = ''PAYMENT''', true),
  ('v_payment_allocations', 'tds_amount', '{AMOUNT_PURCHASE}', 'voucher_type = ''PAYMENT''', false),
  ('v_payment_allocations', 'short_amount', '{AMOUNT_PURCHASE}', 'voucher_type = ''PAYMENT''', false),
  ('v_payment_allocations', 'debit_note_amount', '{AMOUNT_PURCHASE}', 'voucher_type = ''PAYMENT''', false),
  ('v_party_balances', 'receivable_balance', '{AMOUNT_SALE}', 'party_id = (select id from public.parties where code = ''CUS'')', true),
  ('v_party_balances', 'payable_balance', '{AMOUNT_PURCHASE}', 'party_id = (select id from public.parties where code = ''SUP'')', true),
  ('v_party_balances', 'net_balance', '{AMOUNT_SALE,AMOUNT_PURCHASE}', 'true', true),
  ('v_payment_reminders', 'outstanding_amount', '{AMOUNT_SALE}', 'side = ''CUSTOMER''', false),
  ('v_payment_reminders', 'outstanding_amount', '{AMOUNT_PURCHASE}', 'side <> ''CUSTOMER''', false),
  ('v_vouchers', 'amount', '{AMOUNT_SALE}', 'party_side = ''RECEIVABLE''', true),
  ('v_vouchers', 'amount', '{AMOUNT_PURCHASE}', 'party_side = ''PAYABLE''', true),
  ('v_stock_movement_costs', 'rate', '{SALE}', 'movement_type = ''SALE_DISPATCH''', true),
  ('v_stock_movement_costs', 'value', '{SALE}', 'movement_type = ''SALE_DISPATCH''', true),
  ('v_stock_movement_costs', 'rate', '{LANDED_PURCHASE}', 'movement_type = ''PURCHASE_RECEIPT''', true),
  ('v_stock_movement_costs', 'value', '{LANDED_PURCHASE}', 'movement_type = ''PURCHASE_RECEIPT''', true),
  ('v_stock_movement_costs', 'rate', '{LANDED}', 'movement_type = ''OPENING''', true),
  ('v_stock_movement_costs', 'value', '{LANDED}', 'movement_type = ''OPENING''', true),
  ('v_stock_movement_costs', 'rate', '{AVERAGE}', 'direction = -1 and movement_type not in (''SALE_DISPATCH'', ''JOB_WORK_ISSUE'', ''PURCHASE_RETURN'', ''JOB_WORK_RETURN'')', false),
  ('v_stock_movement_costs', 'value', '{AVERAGE}', 'direction = -1 and movement_type not in (''SALE_DISPATCH'', ''JOB_WORK_ISSUE'', ''PURCHASE_RETURN'', ''JOB_WORK_RETURN'')', false);
grant select on vc to authenticated;

-- RPC / table surfaces: (key, classes needed, SQL returning text; NULL or an error = no value)
create temp table fx (k text primary key, cls text[], q text) on commit drop;
insert into fx values
  ('stock_valuation.value', '{VALUATION}', 'select sum(value)::text from public.stock_valuation(test.id(''company''), current_date)'),
  ('stock_valuation.avg_rate', '{VALUATION}', 'select max(avg_rate)::text from public.stock_valuation(test.id(''company''), current_date)'),
  ('profit_loss', '{PROFIT}', 'select nullif(count(*), 0)::text from public.profit_loss(test.id(''company''), ''2026-04-01'', current_date)'),
  ('profit_loss.stock+result', '{PROFIT_STOCK}', 'select string_agg(amount::text, '','') from public.profit_loss(test.id(''company''), ''2026-04-01'', current_date) where section in (''STOCK'', ''RESULT'')'),
  ('balance_sheet', '{PROFIT}', 'select nullif(count(*), 0)::text from public.balance_sheet(test.id(''company''), current_date)'),
  ('trial_balance', '{PROFIT}', 'select nullif(count(*), 0)::text from public.trial_balance(test.id(''company''), current_date)'),
  ('day_book', '{PROFIT}', 'select nullif(count(*), 0)::text from public.day_book(test.id(''company''), ''2026-04-01'', current_date)'),
  ('account_ledger', '{PROFIT}', 'select nullif(count(*), 0)::text from public.account_ledger(test.id(''company''), (select id from public.accounts where company_id = test.id(''company'') and system_key = ''CASH''), ''2026-04-01'', current_date)'),
  ('party_ledger.customer', '{AMOUNT_SALE}', 'select string_agg(balance::text, '','') from public.party_ledger(test.id(''company''), (select id from public.parties where code = ''CUS''), ''2026-04-01'', current_date, ''RECEIVABLE'')'),
  ('party_ledger.vendor', '{AMOUNT_PURCHASE}', 'select string_agg(balance::text, '','') from public.party_ledger(test.id(''company''), (select id from public.parties where code = ''SUP''), ''2026-04-01'', current_date, ''PAYABLE'')'),
  ('party_ledger.both', '{AMOUNT_SALE,AMOUNT_PURCHASE}', 'select string_agg(balance::text, '','') from public.party_ledger(test.id(''company''), (select id from public.parties where code = ''CUS''), ''2026-04-01'', current_date, null)'),
  ('suggest_rate.sale', '{SALE}', 'select public.suggest_rate(test.id(''company''), ''SALE'', (select id from public.parties where code = ''CUS''), test.id(''fg''), test.id(''b336''))::text'),
  ('suggest_rate.purchase', '{PURCHASE}', 'select public.suggest_rate(test.id(''company''), ''PURCHASE'', (select id from public.parties where code = ''SUP''), test.id(''rm''), test.id(''rm_godown''))::text'),
  ('purchase_order_print', '{PURCHASE}', 'select public.purchase_order_print((select v from t where k = ''po''))::text'),
  ('export.ITEMS.sale_price', '{SALE}', 'select string_agg(x->>''sale_price'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''ITEMS'')) x'),
  ('export.ITEMS.purchase_price', '{PURCHASE}', 'select string_agg(x->>''purchase_price'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''ITEMS'')) x'),
  ('export.ITEM_RATES.sale', '{SALE}', 'select string_agg(x->>''rate'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''ITEM_RATES'')) x where x->>''rate_type'' = ''SALE'''),
  ('export.ITEM_RATES.purchase', '{PURCHASE}', 'select string_agg(x->>''rate'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''ITEM_RATES'')) x where x->>''rate_type'' = ''PURCHASE'''),
  ('export.CUSTOMER_RATES', '{SALE}', 'select string_agg(x->>''rate'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''CUSTOMER_RATES'')) x'),
  ('export.GODOWN_STOCK.avg_cost', '{AVERAGE}', 'select string_agg(x->>''avg_cost'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''GODOWN_STOCK'')) x'),
  ('export.GODOWN_STOCK.value', '{VALUATION}', 'select string_agg(x->>''value'', '','') from jsonb_array_elements(public.export_rows(test.id(''company''), ''GODOWN_STOCK'')) x'),
  ('journal_lines.receivable', '{AMOUNT_SALE}', 'select nullif(count(*), 0)::text from public.journal_entry_lines where ledger_class = ''RECEIVABLE'''),
  ('journal_lines.payable', '{AMOUNT_PURCHASE}', 'select nullif(count(*), 0)::text from public.journal_entry_lines where ledger_class = ''PAYABLE'''),
  ('journal_lines.other', '{PROFIT}', 'select nullif(count(*), 0)::text from public.journal_entry_lines where ledger_class = ''OTHER'''),
  ('journal_entries', '{AMOUNT}', 'select nullif(count(*), 0)::text from public.journal_entries'),
  ('party_item_rates.sale', '{SALE}', 'select nullif(count(*), 0)::text from public.party_item_rates where rate_type = ''SALE'''),
  ('item_rate_history.sale', '{SALE}', 'select nullif(count(*), 0)::text from public.item_rate_history where rate_type = ''SALE'''),
  ('item_rate_history.purchase', '{PURCHASE}', 'select nullif(count(*), 0)::text from public.item_rate_history where rate_type = ''PURCHASE'''),
  ('audit.items.sale_price', '{SALE}', 'select string_agg(x->''new_data''->>''sale_price'', '','') from jsonb_array_elements(public.audit_search(test.id(''company''), jsonb_build_object(''table_name'', ''items'', ''row_id'', test.id(''fg'')), 50, null)) x where x->''new_data''->>''sale_price'' <> ''•••'''),
  ('audit.items.purchase_price', '{PURCHASE}', 'select string_agg(x->''new_data''->>''purchase_price'', '','') from jsonb_array_elements(public.audit_search(test.id(''company''), jsonb_build_object(''table_name'', ''items'', ''row_id'', test.id(''fg'')), 50, null)) x where x->''new_data''->>''purchase_price'' <> ''•••'''),
  ('audit.items.job_work_rate', '{PURCHASE}', 'select string_agg(x->''new_data''->>''job_work_rate'', '','') from jsonb_array_elements(public.audit_search(test.id(''company''), jsonb_build_object(''table_name'', ''items'', ''row_id'', test.id(''fg'')), 50, null)) x where x->''new_data''->>''job_work_rate'' <> ''•••''');
grant select on fx to authenticated;

-- value of one surface for the current user (an error counts as "no value")
create or replace function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return v;
exception when others then
  return null;
end $$;

-- every surface for the current user, who holds exactly p_perms; returns the failures
create or replace function pg_temp.surfaces(p_perms text[], p_rows boolean default true) returns text language plpgsql as $$
declare r record; v_vis boolean; v_nn bigint; v_total bigint; v_fail text[] := '{}'; v text;
begin
  for r in select * from vc loop
    v_vis := (select bool_and(q.perms <@ p_perms) from req q where q.cls = any (r.cls));
    execute format('select count(*) filter (where %I is not null), count(*) from public.%I where %s', r.col, r.rel, r.filter) into v_nn, v_total;
    if r.sample and v_total = 0 and p_rows then
      v_fail := v_fail || format('%s: no rows (%s)', r.rel, r.filter);
    elsif v_vis and r.sample and v_nn = 0 then
      v_fail := v_fail || format('%s.%s hidden from a holder of %s (%s)', r.rel, r.col, r.cls, r.filter);
    elsif not v_vis and v_nn > 0 then
      v_fail := v_fail || format('%s.%s visible without %s (%s)', r.rel, r.col, r.cls, r.filter);
    end if;
  end loop;
  for r in select * from fx loop
    v_vis := (select bool_and(q.perms <@ p_perms) from req q where q.cls = any (r.cls));
    v := pg_temp.val(r.q);
    if v_vis and v is null then
      v_fail := v_fail || format('%s hidden from a holder of %s', r.k, r.cls);
    elsif not v_vis and v is not null then
      v_fail := v_fail || format('%s visible without %s: %s', r.k, r.cls, left(v, 60));
    end if;
  end loop;
  return nullif(array_to_string(v_fail, '; '), '');
end $$;

-- ------------------------------------------------------------ AC-13.1: each right removed in turn
select test.login(test.id('admin'));
create temp table eight (code text primary key, role_id uuid, user_id uuid) on commit drop;
grant all on eight to authenticated;
insert into eight (code) values ('items.view_sale_rate'), ('items.view_purchase_rate'), ('costs.view_landed_cost'), ('items.view_cost'),
  ('costs.view_stock_valuation'), ('sales.view_margin'), ('reports.view_profit'), ('accounts.view_amounts'), ('-');
update eight set role_id = public.role_save(test.id('company'), null, jsonb_build_object('code', 'ALL_BUT_' || upper(regexp_replace(code, '\W', '_', 'g')),
                                                                                       'name', 'All but ' || code));
select public.role_set_permissions(role_id, array(select p.code from public.permissions p where p.is_active and p.kind <> 'PORTAL' and p.code <> e.code)) from eight e;
select test.login(null);
update eight set user_id = test.user_with_role(test.id('company'), (select code from public.roles where id = role_id));

create or replace function pg_temp.check_without(p_code text) returns void language plpgsql as $$
declare v_user uuid := (select user_id from eight where code = p_code); v_fail text;
begin
  perform test.login(v_user);
  v_fail := pg_temp.surfaces(array(select p.code from public.permissions p where p.is_active and p.kind <> 'PORTAL' and p.code <> p_code));
  perform test.login(null);
  perform test.ok(v_fail is null, format('Every permission except %s: masked exactly as the registry says%s', p_code, coalesce(' — ' || v_fail, '')));
end $$;
select pg_temp.check_without(code) from eight order by code;

-- AC-13.8: owner sees every value
select test.login(test.id('admin'));
select test.eq(pg_temp.surfaces(array(select code from public.permissions)), null, 'Owner sees every value');

-- ------------------------------------------------------------ AC-13.5: member without accounting / payment rights
select test.login(test.id('admin'));
insert into t values ('ro', public.role_save(test.id('company'), null, '{"code":"ITEMS_ONLY","name":"Items only"}'));
select public.role_set_permissions((select v from t where k = 'ro'), array['items.view']);
select test.login(null);
select test.user_with_role(test.id('company'), 'ITEMS_ONLY') as v \gset io_
select test.login(:'io_v');
select test.eq((select count(*) from public.journal_entry_lines)::int, 0, 'No journal lines for a member without accounting rights');
select test.eq((select count(*) from public.journal_entries)::int, 0, 'No journal entries either');
select test.throws(format($$ select * from public.trial_balance(%L, current_date) $$, test.id('company')), 'Permission denied%', 'Trial balance refused');
select test.throws(format($$ select * from public.profit_loss(%L, '2026-04-01', current_date) $$, test.id('company')), 'Permission denied%', 'P&L refused');
select test.throws(format($$ select * from public.day_book(%L, '2026-04-01', current_date) $$, test.id('company')), 'Permission denied%', 'Day book refused');
select test.throws(format($$ select * from public.party_ledger(%L, %L, '2026-04-01', current_date, 'RECEIVABLE') $$, test.id('company'), :'cus_v'),
                   'Permission denied%', 'Party ledger refused');
select test.eq(pg_temp.surfaces('{items.view}', false), null, 'Items-only member: every financial surface masked');
-- another company: reports return nothing (unchanged R1 behaviour)
select test.login(test.id('admin'));
select test.eq((select count(*) from public.trial_balance(gen_random_uuid(), current_date))::int, 0, 'Non-member: empty report');

-- ------------------------------------------------------------ AC-13.2: completeness
select test.login(null);
-- base columns of every protected class cannot be selected through the API
create or replace function pg_temp.direct_select_failures() returns text language plpgsql as $$
declare r record; v_fail text[] := '{}';
begin
  for r in select * from secure.sensitive_columns where class <> 'ROW_LEVEL' loop
    begin
      execute format('select %I from public.%I limit 1', r.column_name, r.table_name);
      v_fail := v_fail || (r.table_name || '.' || r.column_name);
    exception when insufficient_privilege then null;
    end;
  end loop;
  return nullif(array_to_string(v_fail, ', '), '');
end $$;
select test.login((select user_id from eight where code = '-'));
select test.eq(pg_temp.direct_select_failures(), null, 'No protected base column is selectable by API users (even with every right)');
select test.login(null);
select test.eq((select string_agg(c.relname || '.' || a.attname, ', ' order by 1)
                from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                where c.relkind = 'r' and a.attname ~ '(rate|price|amount|value|cost|total|balance|debit|credit|outstanding|margin)'
                  and not exists (select 1 from secure.sensitive_columns s where s.table_name = c.relname and s.column_name = a.attname)
                  and not exists (select 1 from secure.column_whitelist w where w.relation = c.relname and w.column_name = a.attname)),
               null, 'Every money-like table column is registered or whitelisted');
select test.eq((select string_agg(c.relname || '.' || a.attname, ', ' order by 1)
                from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                where c.relkind in ('v', 'm') and a.attname ~ '(rate|price|amount|value|cost|total|balance|debit|credit|outstanding|margin)'
                  and not exists (select 1 from vc where vc.rel = c.relname and vc.col = a.attname)
                  and not exists (select 1 from secure.column_whitelist w where w.relation = c.relname and w.column_name = a.attname)),
               null, 'Every money-like view column is tested here or whitelisted');
select test.eq((select string_agg(distinct f.proname, ', ')
                from pg_proc f join pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
                join secure.sensitive_columns s on f.prosrc ~ ('\m' || s.table_name || '\M') and f.prosrc ~ ('\m' || s.column_name || '\M')
                where f.prorettype <> 'trigger'::regtype
                  and ('public.' || f.proname) not in (select function_name from secure.reviewed_functions)),
               null, 'Every API function reading a registered column is reviewed');
select test.eq((select string_agg(v.relname, ', ') from pg_class v join pg_namespace n on n.oid = v.relnamespace and n.nspname = 'public'
                where v.relkind = 'v' and v.relname <> 'v_items'
                  and coalesce(array_to_string(v.reloptions, ','), '') not like '%security_invoker=true%'
                  and exists (select 1 from vc where vc.rel = v.relname)),
               null, 'Masked views are security-invoker (base RLS applies), v_items masks explicitly');
select test.ok(not has_schema_privilege('anon', 'secure', 'USAGE') or not has_table_privilege('anon', 'secure.items_values', 'SELECT'),
               'Value views are not readable anonymously');

-- ------------------------------------------------------------ AC-13.3: inference rules (direct)
select test.login((select user_id from eight where code = 'items.view_purchase_rate'));
select test.ok((select payable_balance is null and net_balance is null from public.v_party_balances where party_id = :'sup_v'),
               'No purchase rate: payable balance and net balance hidden even with financial amounts');
select test.ok((select receivable_balance is not null from public.v_party_balances where party_id = :'cus_v'), '... receivable still visible');
select test.ok((select rate is null from public.v_stock_movement_costs where movement_type = 'PURCHASE_RECEIPT'),
               'No purchase rate: landed cost of a purchase receipt hidden (it is the purchase rate)');
select test.login((select user_id from eight where code = 'items.view_sale_rate'));
select test.ok((select rate is null from public.v_stock_movement_costs where movement_type = 'SALE_DISPATCH'),
               'No sale rate: the dispatch movement rate (the sale rate) is hidden, even with average cost');
select test.ok((select margin is null and avg_cost is not null from public.v_items where id = test.id('fg')),
               'No sale rate: margin hidden (sale rate = cost + margin), average cost shown');
select test.login((select user_id from eight where code = 'items.view_cost'));
select test.ok((select avg_cost is null and margin is null from public.v_items where id = test.id('fg')),
               'No average cost: average cost and margin hidden');
select test.throws(format($$ select * from public.stock_valuation(%L, current_date) $$, test.id('company')), '%stock valuation%',
                   'No average cost: stock valuation refused (value ÷ quantity = average cost)');
select test.ok((select bool_and(amount is null) from public.profit_loss(test.id('company'), '2026-04-01', current_date) where section in ('STOCK', 'RESULT')),
               'No average cost: P&L stock and result lines empty');
select test.login((select user_id from eight where code = 'costs.view_stock_valuation'));
select test.eq((select string_agg(section, ',' order by section) from public.profit_loss(test.id('company'), '2026-04-01', current_date)
                where amount is not null),
               'EXPENSE,INCOME', 'No valuation: P&L shows income / expense only (net profit would reveal the closing stock)');
-- ------------------------------------------------------------ AC-13.4: default roles keep their R2 visibility
select test.login(null);
select test.eq((select string_agg(r.code || ':' || (select string_agg(replace(replace(replace(rp.permission_code, 'items.view_', ''), 'costs.view_', ''), 'accounts.view_', ''), '+' order by rp.permission_code)
                                                  from public.role_permissions rp where rp.role_id = r.id
                                                    and rp.permission_code in ('items.view_sale_rate', 'items.view_purchase_rate', 'items.view_cost',
                                                                               'costs.view_landed_cost', 'costs.view_stock_valuation', 'accounts.view_amounts')),
                                ' ' order by r.code)
                from public.roles r where r.company_id = test.id('company') and r.code in ('SALES', 'PURCHASE', 'INVENTORY', 'OPERATOR', 'VIEWER', 'ACCOUNTANT')),
               'ACCOUNTANT:amounts+landed_cost+stock_valuation+cost+purchase_rate+sale_rate INVENTORY:amounts OPERATOR:amounts+purchase_rate+sale_rate PURCHASE:amounts+purchase_rate SALES:amounts+sale_rate VIEWER:amounts',
               'Default roles: sale / purchase / cost visibility unchanged from R2 (amounts follow the document rights)');
rollback;
