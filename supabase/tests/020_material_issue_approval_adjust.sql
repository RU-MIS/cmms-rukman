-- =============================================================================
-- RM issue to karigar with maker–checker approval (Q-10, Q-36), no GST (Q-11),
-- last-rate suggestion per party + item + godown (Q-12), party sub-ledgers and
-- ADJUST set-off (Q-13), negative stock warning (Q-18), opening stock.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('RM-TEST'));

create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- Opening stock 250 MTR lycra in RAW MATERIAL godown (admin)
select test.login(test.id('admin'));
select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'godown_id', test.id('rm_godown'),
  'reason', 'OPENING', 'lines', jsonb_build_array(jsonb_build_object(
     'item_id', test.id('rm'), 'direction', 1, 'qty', 250, 'unit_id', test.id('mtr'), 'rate', 200)))));
select test.eq((select base_qty from public.stock_balances where item_id = test.id('rm')),
               250.000::numeric(16,3), 'Opening stock 250 MTR');

-- ------------------------------------------------ junior creates, submits → pending
select test.login(test.id('operator'));
insert into t values ('issue', public.doc_save('MATERIAL_ISSUE', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-05', 'party_id', test.id('majid'),
  'godown_id', test.id('rm_godown'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 25, 'unit_id', test.id('mtr'), 'rate', 240)))));
select test.eq(public.doc_submit('MATERIAL_ISSUE', (select v from t where k = 'issue'))->>'status',
               'PENDING_APPROVAL', 'RM issue waits for approval (default policy)');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('rm')),
               250.000::numeric(16,3), 'No stock effect before approval');
select test.throws(format($$ select public.doc_approve('MATERIAL_ISSUE', %L) $$, (select v from t where k = 'issue')),
                   'Permission denied%', 'Operator (junior) cannot approve');

-- ------------------------------------------------ senior corrects qty and approves
select test.login(test.id('approver'));
select public.doc_save('MATERIAL_ISSUE', jsonb_build_object('id', (select v from t where k = 'issue'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 22, 'unit_id', test.id('mtr'), 'rate', 240))));
select test.eq(public.doc_approve('MATERIAL_ISSUE', (select v from t where k = 'issue'))->>'doc_no',
               'GS-1', 'Approved and posted as GS-1');
set constraints all immediate; set constraints all deferred;
select test.eq((select base_qty from public.stock_balances where item_id = test.id('rm')),
               228.000::numeric(16,3), 'Stock OUT = approved (corrected) qty 22');
select test.eq((select receivable_balance from public.v_party_balances where party_id = test.id('majid')),
               5280.00::numeric, 'Karigar receivable = 22 × 240, no GST');
select test.ok((select approved_by = test.id('approver') from public.material_issues where id = (select v from t where k = 'issue')),
               'Approver recorded');

-- maker ≠ checker: approver creates and tries to approve own document
insert into t values ('own', public.doc_save('MATERIAL_ISSUE', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-06', 'party_id', test.id('majid'),
  'godown_id', test.id('rm_godown'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 1, 'unit_id', test.id('mtr'), 'rate', 240)))));
select public.doc_submit('MATERIAL_ISSUE', (select v from t where k = 'own'));
select test.throws(format($$ select public.doc_approve('MATERIAL_ISSUE', %L) $$, (select v from t where k = 'own')),
                   '%cannot be approved by the user who created it%', 'Maker cannot approve own document');
select public.doc_reject('MATERIAL_ISSUE', (select v from t where k = 'own'), 'test');
select test.eq((select status::text from public.material_issues where id = (select v from t where k = 'own')),
               'DRAFT', 'Rejected document returns to DRAFT');

-- ------------------------------------------------ rate suggestion (Q-12)
select test.eq(public.suggest_rate(test.id('company'), 'ISSUE', test.id('majid'), test.id('rm'), test.id('rm_godown')),
               240.0000::numeric(14,4), 'Last issue rate for party + item + godown suggested');
select test.eq(public.suggest_rate(test.id('company'), 'JOB_WORK', test.id('majid'), test.id('fg')),
               190.0000::numeric(14,4), 'Job-work rate falls back to the FG item rate (Q-07)');

-- ------------------------------------------------ payable side via job work, then ADJUST
select test.login(test.id('operator'));
insert into t values ('po', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-05', 'party_id', test.id('majid'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 10, 'unit_id', test.id('box'))))));
select public.doc_submit('JOB_WORK_ORDER', (select v from t where k = 'po'));
select public.doc_submit('JOB_WORK_RECEIPT', public.doc_save('JOB_WORK_RECEIPT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-10', 'party_id', test.id('majid'), 'godown_id', test.id('b336'),
  'lines', jsonb_build_array(jsonb_build_object(
     'order_line_id', (select id from public.job_work_order_lines where order_id = (select v from t where k = 'po')),
     'item_id', test.id('fg'), 'qty', 10, 'unit_id', test.id('box'), 'rate', 190)))));
set constraints all immediate; set constraints all deferred;
select test.eq((select payable_balance from public.v_party_balances where party_id = test.id('majid')),
               34200.00::numeric, 'Karigar payable = 180 pair × 190');
select test.eq((select net_balance from public.v_party_balances where party_id = test.id('majid')),
               -28920.00::numeric, 'Combined view: net 28,920 payable (Q-13)');

select test.eq(public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-22', 'voucher_type', 'ADJUST',
  'book_id', (select id from public.voucher_books where company_id = test.id('company') and code = 'MAIN'),
  'party_id', test.id('majid'), 'amount', 5280)))->>'status', 'POSTED', 'ADJUST voucher posted');
set constraints all immediate; set constraints all deferred;
select test.eq((select receivable_balance from public.v_party_balances where party_id = test.id('majid')),
               0.00::numeric, 'Receivable side cleared by ADJUST');
select test.eq((select payable_balance from public.v_party_balances where party_id = test.id('majid')),
               28920.00::numeric, 'Payable side reduced by ADJUST');
select test.eq((select net_balance from public.v_party_balances where party_id = test.id('majid')),
               -28920.00::numeric, 'Net balance unchanged by ADJUST');

-- sale ledger (receivable side) running balance
select test.eq((select balance from public.party_ledger(test.id('company'), test.id('majid'),
                 date '2026-04-01', date '2027-03-31', 'RECEIVABLE') order by entry_date desc, entry_no desc nulls last limit 1),
               0.00::numeric, 'Receivable ledger closes at 0');

-- ------------------------------------------------ negative stock only warns (Q-18)
select test.login(test.id('admin'));
select test.ok(jsonb_array_length(public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-23', 'from_godown_id', test.id('rm_godown'),
  'to_godown_id', test.id('warehouse'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 300, 'unit_id', test.id('mtr'))))))->'warnings') = 1,
  'Transfer more than stock posts with a negative-stock warning');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('rm') and godown_id = test.id('warehouse')),
               300.000::numeric(16,3), 'Transfer IN at destination');

-- policy switched to BLOCK
insert into public.app_settings (company_id, key, value) values (test.id('company'), 'negative_stock', '"BLOCK"');
select test.throws(format($$ select public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-23', 'from_godown_id', %L, 'to_godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L))))) $$,
  test.id('company'), test.id('rm_godown'), test.id('warehouse'), test.id('rm'), test.id('mtr')),
  'Insufficient stock%', 'With policy BLOCK the transfer is rejected');

rollback;
