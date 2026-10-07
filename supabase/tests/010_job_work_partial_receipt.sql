-- =============================================================================
-- Spec §51 CRITICAL JOB-WORK TEST (GT-610 / TOE-RING SANDAL-4766)
-- Ordered 500 box → receive 140, 100, 260 → pending 0, FULLY_RECEIVED,
-- line disappears from pending list, a 4th receipt of 1 box is REJECTED.
-- Also: over-receipt rejected, PO qty edit (Q-04/Q-05), stock, cartons,
-- karigar payable, zero-rate receipt (Q-06), cancellation re-opens pending.
-- =============================================================================
begin;
set client_min_messages = notice;

insert into test.ctx values ('fx', test.fixture('JW-TEST'));

-- ---------------------------------------------------------------- PO (operator)
select test.login(test.id('operator'));

create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

insert into t values ('po', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'party_id', test.id('aleem'),
  'lot_no', 'GT-04',
  'lines', jsonb_build_array(
     jsonb_build_object('item_id', test.id('fg'),  'qty', 500, 'unit_id', test.id('box')),
     jsonb_build_object('item_id', test.id('fg2'), 'qty', 10,  'unit_id', test.id('box'))))));

select test.eq((public.doc_submit('JOB_WORK_ORDER', (select v from t where k = 'po')))->>'status',
               'OPEN', 'PO confirmed without approval');
select test.eq((select doc_no from public.job_work_orders where id = (select v from t where k = 'po')),
               'GT-1', 'PO number from configurable sequence');
select test.eq((select ordered_base_qty from public.job_work_order_lines
                where order_id = (select v from t where k = 'po') and item_id = test.id('fg')),
               9000.000::numeric(16,3), '500 box = 9000 pair (item-specific 18/box)');

insert into t select 'line', id from public.job_work_order_lines
 where order_id = (select v from t where k = 'po') and item_id = test.id('fg');

-- helper: create + submit a receipt of N box for the TOE-RING line
create or replace function pg_temp.receive(p_box numeric, p_rate numeric default 140)
returns jsonb language sql as $$
  select public.doc_submit('JOB_WORK_RECEIPT', public.doc_save('JOB_WORK_RECEIPT', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-23', 'party_id', test.id('aleem'),
    'godown_id', test.id('b336'),
    'lines', jsonb_build_array(jsonb_build_object(
       'order_line_id', (select v from t where k = 'line'), 'item_id', test.id('fg'),
       'qty', p_box, 'unit_id', test.id('box'), 'rate', p_rate)))))
$$;

create or replace function pg_temp.pending_box() returns numeric language sql as $$
  select pending_pack_qty from public.v_job_work_order_lines where order_line_id = (select v from t where k = 'line')
$$;

-- ---------------------------------------------------------------- receipts
select test.eq(pg_temp.receive(140)->>'status', 'POSTED', 'Receipt 1: 140 box posted');
set constraints all immediate; set constraints all deferred;  -- run deferred checks now
select test.eq(pg_temp.pending_box(), 360.000::numeric, 'Pending = 360 box');
select test.eq((select status::text from public.job_work_orders where id = (select v from t where k = 'po')),
               'PARTIALLY_RECEIVED', 'PO status PARTIALLY_RECEIVED');

select test.eq(pg_temp.receive(100)->>'status', 'POSTED', 'Receipt 2: 100 box posted');
select test.eq(pg_temp.pending_box(), 260.000::numeric, 'Pending = 260 box');

select test.throws($$ select pg_temp.receive(400) $$, '%more than pending%',
                   'Receiving 400 box when 260 pending is rejected');

select test.eq(pg_temp.receive(260)->>'status', 'POSTED', 'Receipt 3: 260 box posted');
set constraints all immediate; set constraints all deferred;  -- run deferred checks now
select test.eq(pg_temp.pending_box(), 0.000::numeric, 'Pending = 0');
select test.ok(not exists (select 1 from public.v_job_work_pending
                           where order_line_id = (select v from t where k = 'line')),
               'Fully received line disappears from pending list');
select test.ok(exists (select 1 from public.v_job_work_pending
                       where order_id = (select v from t where k = 'po') and item_id = test.id('fg2')),
               'Other PO line (SAMOSA) is still pending');

select test.throws($$ select pg_temp.receive(1) $$, '%more than pending%',
                   'Receipt 4 of 1 box is REJECTED because pending = 0');

-- ---------------------------------------------------------------- stock, cartons, ledger
select test.eq((select base_qty from public.stock_balances where item_id = test.id('fg') and godown_id = test.id('b336')),
               9000.000::numeric(16,3), 'Stock IN at B-336 = 9000 pair');
select test.eq((select count(*) from public.stock_movements where item_id = test.id('fg')
                and movement_type = 'JOB_WORK_RECEIPT')::int, 3, '3 JOB_WORK_RECEIPT movements');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('carton') and godown_id = test.id('b336')),
               500.000::numeric(16,3), 'Carton rule: 1 carton per box consumed (1000 opening − 500)');
select test.eq((select payable_balance from public.v_party_balances where party_id = test.id('aleem')),
               (9000 * 140)::numeric, 'Karigar payable = 9000 pair × 140');

-- ---------------------------------------------------------------- edit PO qty (Q-04 / Q-05)
select test.throws(format($$ select public.job_work_order_line_set_qty(%L, 400, %L) $$,
                          (select v from t where k = 'line'), test.id('box')),
                   '%less than already received%', 'Cannot reduce PO below received');
select test.eq((public.job_work_order_line_set_qty((select v from t where k = 'line'), 520, test.id('box')))->>'pending_base_qty',
               '360.000', 'PO increased to 520 box → 20 box (360 pair) pending again');
select test.eq((select status::text from public.job_work_orders where id = (select v from t where k = 'po')),
               'PARTIALLY_RECEIVED', 'PO re-opened after qty increase');
select test.login(test.id('admin'));  -- audit log is visible to owner/admin only
select test.ok(exists (select 1 from public.audit_log where table_name = 'job_work_order_lines'
                        and action = 'EDIT_QTY'), 'PO qty edit is audited');
select test.login(test.id('operator'));

-- zero-rate receipt allowed (Q-06): no journal, flagged
insert into t select 'r0', (pg_temp.receive(20, 0)->>'id')::uuid;
set constraints all immediate; set constraints all deferred;  -- run deferred checks now
select test.ok((select has_missing_rate from public.job_work_receipts where id = (select v from t where k = 'r0')),
               'Zero-rate receipt posted and flagged rate missing');
select test.ok(not exists (select 1 from public.journal_entries where source_id = (select v from t where k = 'r0')),
               'Zero-rate receipt creates no journal');

-- ---------------------------------------------------------------- cancel (approver) re-opens pending
select test.login(test.id('approver'));
select public.doc_cancel('JOB_WORK_RECEIPT', (select v from t where k = 'r0'), 'Wrong entry', date '2026-09-24');
set constraints all immediate; set constraints all deferred;  -- run deferred checks now
select test.eq(pg_temp.pending_box(), 20.000::numeric, 'Cancelled receipt → pending 20 box again');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('fg') and godown_id = test.id('b336')),
               9000.000::numeric(16,3), 'Cancellation reversed the stock');

-- operator cannot cancel (no CANCEL permission)
select test.login(test.id('operator'));
select test.throws(format($$ select public.doc_cancel('JOB_WORK_RECEIPT', %L, 'x') $$,
                          (select id from public.job_work_receipts where status = 'POSTED' limit 1)),
                   'Permission denied%', 'Operator cannot cancel');

-- ledgers are immutable
select test.login(null);
select test.throws($$ update public.stock_movements set qty = 1 $$, '%append-only%', 'Stock movements cannot be edited');
select test.throws($$ delete from public.journal_entry_lines $$, '%append-only%', 'Journal lines cannot be deleted');

rollback;
