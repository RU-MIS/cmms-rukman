-- =============================================================================
-- Own factory: configurable lot numbers (Q-37), lot mandatory + pending list per
-- item (Q-41), partial lot receipts, carton consumption on factory receipts
-- (Q-19), worker earnings and payments with worker balance (Q-39).
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('FAC-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- factory godown, worker, cash account (admin)
select test.login(test.id('admin'));
insert into public.godowns (company_id, code, name, godown_type)
values (test.id('company'), 'FACTORY', 'Own factory', 'FACTORY') returning id as v \gset fac_
insert into t values ('factory', :'fac_v');
insert into public.parties (company_id, code, name) values (test.id('company'), 'ROFF', 'ROFF BOTTOM MAN')
returning id as v \gset w_
insert into t values ('worker', :'w_v');
insert into public.party_roles values (:'w_v', 'WORKER');

-- lot number format "GT NN" (default); admin changes start value
update public.document_sequences set start_value = 26
 where company_id = test.id('company') and doc_type = 'PRODUCTION_LOT';

-- ------------------------------------------------ lot allotment
select test.login(test.id('operator'));
insert into t values ('lot', public.doc_save('PRODUCTION_LOT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'factory_godown_id', (select v from t where k = 'factory'),
  'lines', jsonb_build_array(
    jsonb_build_object('item_id', test.id('fg'),  'qty', 80, 'unit_id', test.id('box')),
    jsonb_build_object('item_id', test.id('fg2'), 'qty', 36, 'unit_id', test.id('box'))))));
select test.eq(public.doc_submit('PRODUCTION_LOT', (select v from t where k = 'lot'))->>'doc_no',
               'GT 26', 'Lot number from configurable format "GT NN"');

insert into t values ('lot2', public.doc_save('PRODUCTION_LOT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-02', 'factory_godown_id', (select v from t where k = 'factory'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 20, 'unit_id', test.id('box'))))));
select test.eq(public.doc_submit('PRODUCTION_LOT', (select v from t where k = 'lot2'))->>'doc_no',
               'GT 27', 'Next lot number');

-- pending lots of TOE-RING item-wise (Q-41)
select test.eq((select count(*) from public.v_production_pending
                where company_id = test.id('company') and item_id = test.id('fg'))::int, 2,
               'Receive screen lists 2 pending lots for the item');
select test.eq((select sum(pending_pack_qty) from public.v_production_pending
                where company_id = test.id('company') and item_id = test.id('fg')), 100.000::numeric,
               'Pending boxes of the item across lots = 100');

-- ------------------------------------------------ lot receipts
create or replace function pg_temp.lot_line(p_lot text, p_item uuid) returns uuid language sql as $$
  select ol.id from public.production_order_lines ol where ol.order_id = (select v from t where k = p_lot) and ol.item_id = p_item
$$;

select test.eq(public.doc_submit('PRODUCTION_RECEIPT', public.doc_save('PRODUCTION_RECEIPT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-10', 'factory_godown_id', (select v from t where k = 'factory'),
  'godown_id', test.id('b336'),
  'lines', jsonb_build_array(
    jsonb_build_object('order_line_id', pg_temp.lot_line('lot', test.id('fg')), 'item_id', test.id('fg'), 'qty', 40, 'unit_id', test.id('box')),
    jsonb_build_object('order_line_id', pg_temp.lot_line('lot', test.id('fg2')), 'item_id', test.id('fg2'), 'qty', 36, 'unit_id', test.id('box'))))))->>'status',
  'POSTED', 'Partial lot receipt posted');
select test.eq((select status::text from public.production_orders where id = (select v from t where k = 'lot')),
               'PARTIALLY_RECEIVED', 'Lot partially received');
select test.eq((select pending_pack_qty from public.v_production_pending
                where order_line_id = pg_temp.lot_line('lot', test.id('fg'))), 40.000::numeric, 'Lot GT 26 TOE-RING pending 40 box');
select test.ok(not exists (select 1 from public.v_production_pending where order_line_id = pg_temp.lot_line('lot', test.id('fg2'))),
               'SAMOSA line of the lot completed and disappears');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('fg') and godown_id = test.id('b336')),
               720.000::numeric(16,3), 'Stock IN 40 box = 720 pair');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('carton') and godown_id = test.id('b336')),
               960.000::numeric(16,3), 'Carton consumed for factory receipt too (Q-19)');
select test.ok(not exists (select 1 from public.journal_entries where source_table = 'production_receipts'),
               'Own-factory receipt creates no ledger entry (Q-08)');

select test.throws(format($$ select public.doc_save('PRODUCTION_RECEIPT', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-10', 'factory_godown_id', %L, 'godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L)))) $$,
  test.id('company'), (select v from t where k = 'factory'), test.id('b336'), test.id('fg'), test.id('box')),
  '%order_line_id%', 'Receipt without lot is rejected (Q-41)');

select test.throws(format($$ select public.doc_submit('PRODUCTION_RECEIPT', public.doc_save('PRODUCTION_RECEIPT', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-11', 'factory_godown_id', %L, 'godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('order_line_id', %L, 'item_id', %L, 'qty', 41, 'unit_id', %L))))) $$,
  test.id('company'), (select v from t where k = 'factory'), test.id('b336'),
  pg_temp.lot_line('lot', test.id('fg')), test.id('fg'), test.id('box')),
  '%more than pending%', 'Lot over-receipt rejected');

-- ------------------------------------------------ worker earnings and payment (Q-39)
insert into t values ('earn', public.doc_save('WORKER_EARNING', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-15', 'party_id', (select v from t where k = 'worker'),
  'lines', jsonb_build_array(jsonb_build_object(
     'production_order_line_id', pg_temp.lot_line('lot', test.id('fg')), 'item_id', test.id('fg'),
     'operation', 'BOTTOM', 'qty', 720, 'unit_id', test.id('pair'), 'rate', 6.5)))));
select test.eq(public.doc_submit('WORKER_EARNING', (select v from t where k = 'earn'))->>'status', 'POSTED', 'Earnings posted');
set constraints all immediate; set constraints all deferred;

select test.login(test.id('admin'));
insert into public.accounts (company_id, code, name, account_type, sub_type, parent_id)
values (test.id('company'), '2122', 'Factory cash', 'ASSET', 'CASH',
        (select id from public.accounts where company_id = test.id('company') and code = '2120'))
returning id as v \gset cash_
insert into public.voucher_books (company_id, code, name) values (test.id('company'), 'FACTORY', 'Factory book')
returning id as v \gset book_

select test.login(test.id('operator'));
select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-19', 'voucher_type', 'PAYMENT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v', 'party_id', (select v from t where k = 'worker'), 'amount', 3000)));
set constraints all immediate; set constraints all deferred;
select test.eq((select payable_balance from public.v_party_balances where party_id = (select v from t where k = 'worker')),
               1680.00::numeric, 'Worker balance = earned 4680 − paid 3000');
select test.eq((select sum(debit) from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
                where a.system_key = 'FACTORY_WAGES' and l.company_id = test.id('company')),
               4680.00::numeric, 'Factory wages expense booked');
select test.ok(exists (select 1 from public.vouchers where book_id = :'book_v' and status = 'POSTED'),
               'Payment recorded in the FACTORY book (Q-42)');

-- edit lot qty below received is refused
select test.throws(format($$ select public.production_lot_line_set_qty(%L, 30, %L) $$,
                          pg_temp.lot_line('lot', test.id('fg')), test.id('box')),
                   '%less than already received%', 'Lot qty cannot go below received');

rollback;
