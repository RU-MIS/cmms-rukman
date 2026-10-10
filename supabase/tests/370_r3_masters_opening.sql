-- =============================================================================
-- PLATFORM R3 — master data completion (W9) and opening balances (D5)
--   sale rate limits (Block + audited override), inactive party rates, godown
--   flags / users / default, customer status (On hold), party types, delete
--   where safe, opening balances: balanced journal, direction, duplicates,
--   idempotency, period rules, reversal, ledgers.
-- AC 9.1, 9.2, 9.4–9.6, 9.7a–e, 9.8
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('MST-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'C1', 'CUSTOMER') as v \gset c1_
select test.party(test.id('company'), 'V1', 'SUPPLIER') as v \gset v1_
select test.party(test.id('company'), 'C9', 'CUSTOMER') as v \gset c9_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 500);
update public.items set sale_price = 20, min_sale_rate = 15, max_sale_rate = 30 where id = test.id('fg');
select test.user_with_role(test.id('company'), 'SALES') as v \gset sales_

create or replace function pg_temp.so(p_rate numeric, p_party uuid default null) returns uuid language sql as $$
  select public.doc_save('SALES_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date,
    'party_id', coalesce(p_party, (select id from public.parties where code = 'C1' and company_id = test.id('company'))),
    'customer_po_no', 'P-' || gen_random_uuid(),
    'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'), 'rate', p_rate)))) $$;

-- ------------------------------------------------------------ AC-9.1: sale rate limits
select test.login(test.id('admin'));
select public.settings_save(test.id('company'), 'sales', '{"sale_rate_limit_policy":"BLOCK"}');
select test.login(test.id('operator'));
select test.throws('select pg_temp.so(10)', '%outside the allowed sale rate%', 'Block: rate below the minimum refused');
select test.throws('select pg_temp.so(31)', '%outside the allowed sale rate%', 'Block: rate above the maximum refused');
select test.ok(pg_temp.so(20) is not null, 'Rate inside the limits accepted');
select test.login(test.id('approver'));
insert into t values ('so_ovr', pg_temp.so(20));
select public.sales_order_set_override_reason((select v from t where k = 'so_ovr'), 'Clearance sale approved by MD');
select public.doc_save('SALES_ORDER', jsonb_build_object('id', (select v from t where k = 'so_ovr'), 'company_id', test.id('company'),
  'doc_date', current_date, 'party_id', :'c1_v', 'customer_po_no', 'OVR-1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'), 'rate', 10))));
select test.ok(exists (select 1 from public.audit_log where row_id = (select v from t where k = 'so_ovr')::text and action = 'RATE_LIMIT_OVERRIDE'),
               'Override with the right and a reason is saved and audited');
select test.login(test.id('operator'));
select test.throws(format($$ select public.sales_order_set_override_reason(%L, 'x') $$, (select v from t where k = 'so_ovr')), '%',
                   'A user without the override right cannot set a reason');
select test.login(test.id('admin'));
select public.settings_save(test.id('company'), 'sales', '{"sale_rate_limit_policy":"WARN"}');
select test.login(test.id('operator'));
select test.ok(pg_temp.so(10) is not null, 'Warn: saved (the screen shows the warning from the visible limits)');
select test.login(:'sales_v');
update public.items set min_sale_rate = 1 where id = test.id('fg');
select test.eq(test.raw(format('(select min_sale_rate from public.items where id = %L)', test.id('fg'))), '15.0000',
               'Rate limits cannot be changed without the rate rights');

-- the same through a customer PO approval (which creates the sales order)
select test.login(test.id('admin'));
select public.settings_save(test.id('company'), 'sales', '{"sale_rate_limit_policy":"BLOCK"}');
create or replace function pg_temp.cpo(p_no text) returns uuid language sql as $$
  select public.customer_po_create(test.id('company'), (select id from public.parties where code = 'C1' and company_id = test.id('company')),
    jsonb_build_object('po_no', p_no, 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'))))) $$;
create or replace function pg_temp.lines(p_cpo uuid, p_rate numeric) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('line_id', id, 'approved_rate', p_rate, 'qty', qty)) from public.customer_po_lines where customer_po_id = p_cpo $$;
insert into t values ('cpo1', pg_temp.cpo('CPO-LIM-1'));
select test.throws(format($$ select public.customer_po_approve_checked(%L, pg_temp.lines(%L, 5), null, null, false) $$,
                          (select v from t where k = 'cpo1'), (select v from t where k = 'cpo1')), '%outside the allowed sale rate%',
                   'Customer PO approval below the minimum refused (Block)');
select test.login(test.id('operator'));
select test.throws(format($$ select public.customer_po_approve_checked(%L, pg_temp.lines(%L, 5), null, null, false, 'please') $$,
                          (select v from t where k = 'cpo1'), (select v from t where k = 'cpo1')), '%', 'Override reason needs the override right');
select test.login(test.id('admin'));
select test.ok(public.customer_po_approve_checked((select v from t where k = 'cpo1'), pg_temp.lines((select v from t where k = 'cpo1'), 5), null, null, false,
                 'Old stock clearance') ? 'sales_order_id', 'Approved with an override reason');
select test.ok(test.raw(format($q$exists (select 1 from public.audit_log where action = 'RATE_LIMIT_OVERRIDE' and company_id = %L
                                and new_data->>'reason' = 'Old stock clearance')$q$, test.id('company')))::boolean, 'Override reason audited');
select public.settings_save(test.id('company'), 'sales', '{"sale_rate_limit_policy":"WARN"}');
insert into t values ('cpo2', pg_temp.cpo('CPO-LIM-2'));
select test.ok(public.customer_po_approve_checked((select v from t where k = 'cpo2'), pg_temp.lines((select v from t where k = 'cpo2'), 5), null, null, false)->'warnings'
               @> '["Rate 5.0000 for TOE-RING SANDAL-4766 is outside the allowed sale rate (15.0000 – 30.0000)"]', 'Warn: approved with a visible warning');

-- ------------------------------------------------------------ AC-9.2: inactive party rates
select test.login(test.id('admin'));
insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate, effective_from)
values (test.id('company'), 'SALE', :'c1_v', test.id('fg'), 18, current_date - 10) returning id as v \gset rate_
select test.eq(public.suggest_rate(test.id('company'), 'SALE', :'c1_v', test.id('fg'), test.id('b336')), 18.0000::numeric(14,4), 'Active customer rate used');
insert into t values ('so_snap', pg_temp.so(18));
update public.party_item_rates set is_active = false where id = :'rate_v';
select test.ok(public.suggest_rate(test.id('company'), 'SALE', :'c1_v', test.id('fg'), test.id('b336')) is distinct from 18,
               'Inactive customer rate not used for new documents');
select test.eq(test.raw(format('(select rate from public.sales_order_lines where order_id = %L)', (select v from t where k = 'so_snap'))), '18.0000',
               'Existing document keeps its snapshot rate');

-- ------------------------------------------------------------ AC-9.4: godown flags
update public.godowns set receipts_allowed = false where id = test.id('rm_godown');
select test.throws(format($$ select public.doc_submit('PURCHASE_RECEIPT', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object(
  'company_id', %L, 'doc_date', current_date, 'party_id', %L, 'godown_id', %L, 'supplier_bill_no', 'X1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L, 'rate', 10))))) $$,
  test.id('company'), :'v1_v', test.id('rm_godown'), test.id('rm'), test.id('mtr')), '%does not accept receipts%',
  'Receipt into a godown with receipts disabled is refused by the database');
update public.godowns set transfers_allowed = false where id = test.id('warehouse');
select test.throws(format($$ select public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', %L, 'doc_date', current_date, 'from_godown_id', %L, 'to_godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L))))) $$,
  test.id('company'), test.id('b336'), test.id('warehouse'), test.id('fg'), test.id('pair')), '%does not allow transfers%',
  'Transfer into a godown with transfers disabled is refused');
update public.godowns set is_default = true where id = test.id('b336');
select test.throws(format($$ update public.godowns set is_default = true where id = %L $$, test.id('warehouse')), '%godowns_one_default%',
                   'Only one default godown');

-- ------------------------------------------------------------ AC-9.5: delete where safe
select test.throws(format($$ select public.master_delete(%L, 'GODOWN', %L) $$, test.id('company'), test.id('b336')), '%Cannot delete%',
                   'Godown with stock / movements cannot be deleted');
insert into public.godowns (company_id, code, name) values (test.id('company'), 'EMPTY', 'Empty') returning id as v \gset empty_
select test.eq(public.master_delete(test.id('company'), 'GODOWN', :'empty_v')->>'deleted', 'true', 'Unused godown deleted');
select test.ok((select is_deleted from public.godowns where id = :'empty_v'), '... as a soft delete');
select test.eq((select count(*) from public.audit_log where row_id = :'empty_v'::text and action = 'DELETE')::int, 1, 'Delete audited');
select test.throws(format($$ select public.master_delete(%L, 'PARTY', %L) $$, test.id('company'), :'c1_v'), '%Cannot delete%',
                   'Customer with orders cannot be deleted (disable instead)');
select test.eq(public.master_set_active(test.id('company'), 'PARTY', array[:'v1_v'::uuid], false), 1, 'Vendor disabled in bulk');
select test.eq((select status from public.parties where id = :'v1_v'), 'DISABLED', 'Status follows');
select public.master_set_active(test.id('company'), 'PARTY', array[:'v1_v'::uuid], true);
select test.login(:'sales_v');
select test.throws(format($$ select public.master_delete(%L, 'GODOWN', %L) $$, test.id('company'), test.id('warehouse')), 'Permission denied%',
                   'Delete needs the delete right');

-- ------------------------------------------------------------ AC-9.6: customer on hold
select test.login(test.id('admin'));
insert into public.party_types (company_id, name, applies_to) values (test.id('company'), 'Distributor', 'CUSTOMER') returning id as v \gset ptype_
select public.party_save(test.id('company'), :'c1_v', jsonb_build_object('legal_name', 'C1 Traders Pvt Ltd', 'party_type_id', :'ptype_v', 'status', 'ON_HOLD'));
select test.eq((select legal_name || ' / ' || status from public.parties where id = :'c1_v'), 'C1 Traders Pvt Ltd / ON_HOLD', 'Legal name, type and status saved');
select test.login(:'sales_v');
select test.throws('select pg_temp.so(20)', '%on hold%', 'Customer on hold: no new sales order');
select test.ok((select count(*) > 0 from public.sales_orders where party_id = :'c1_v'), 'Existing documents stay');
select test.login(test.id('admin'));
select public.party_save(test.id('company'), :'c1_v', '{"status":"ACTIVE"}');

-- ------------------------------------------------------------ AC-9.8: godown users
select public.godown_assign_user(test.id('warehouse'), :'sales_v', true);
select test.login(:'sales_v');
select test.eq((select string_agg(code, ',') from public.godowns where company_id = test.id('company') and not is_deleted), 'WAREHOUSE',
               'Assigning from the godown page restricts the user at once (RLS)');
select test.login(test.id('admin'));
select public.godown_assign_user(test.id('warehouse'), :'sales_v', false);
select test.login(:'sales_v');
select test.eq((select count(*) from public.godowns where company_id = test.id('company'))::int, 0, 'Removing the last godown leaves none (never "all")');

-- ------------------------------------------------------------ AC-9.7a: opening balance = one balanced journal
select test.login(test.id('admin'));
insert into t select 'ob_c', (public.opening_balance_post(test.id('company'), jsonb_build_object('party_id', :'c1_v', 'side', 'RECEIVABLE',
  'dr_cr', 'DR', 'amount', 50000, 'as_of', '2026-04-01', 'idempotency_key', 'ob-c1'))->>'id')::uuid;
select test.eq((select row(e.is_opening, count(l.*), sum(l.debit), sum(l.credit))::text
                from public.party_opening_balances b join public.journal_entries e on e.id = b.journal_entry_id
                join public.journal_entry_lines l on l.journal_entry_id = e.id where b.id = (select v from t where k = 'ob_c') group by e.is_opening),
               '(t,2,50000.00,50000.00)', 'One balanced opening journal (two lines, Dr = Cr)');
select test.eq((select string_agg(a.system_key || ':' || l.debit || '/' || l.credit || ':' || coalesce(l.party_id::text = :'c1_v', false), ' ' order by a.system_key)
                from public.party_opening_balances b join public.journal_entry_lines l on l.journal_entry_id = b.journal_entry_id
                join public.accounts a on a.id = l.account_id where b.id = (select v from t where k = 'ob_c')),
               'OPENING_BALANCE_ADJ:0.00/50000.00:false SUNDRY_DEBTORS:50000.00/0.00:true',
               'Party line on Sundry Debtors (sub-ledger) against Opening Balance Adjustment; no tax lines');
-- AC-9.7b direction / amount
select test.throws(format($$ select public.opening_balance_post(%L, jsonb_build_object('party_id', %L, 'side', 'PAYABLE', 'dr_cr', 'DR', 'amount', 100, 'as_of', '2026-04-01')) $$,
                          test.id('company'), :'v1_v'), '%normally credit%', 'Vendor payable Dr (advance) needs confirmation');
select test.ok(public.opening_balance_post(test.id('company'), jsonb_build_object('party_id', :'v1_v', 'side', 'PAYABLE', 'dr_cr', 'DR', 'amount', 100,
                 'as_of', '2026-04-01', 'confirm_opposite', true)) ? 'journal_entry_id', '... accepted when confirmed');
select test.throws(format($$ select public.opening_balance_post(%L, jsonb_build_object('party_id', %L, 'side', 'RECEIVABLE', 'dr_cr', 'DR', 'amount', 0, 'as_of', '2026-04-01')) $$,
                          test.id('company'), :'c1_v'), '%greater than zero%', 'Zero amount refused');
select test.throws(format($$ select public.opening_balance_post(%L, jsonb_build_object('party_id', %L, 'side', 'RECEIVABLE', 'dr_cr', 'DR', 'amount', 10, 'as_of', '2026-04-01')) $$,
                          test.id('company'), :'v1_v'), '%not a customer%', 'Receivable opening balance needs a customer');
-- AC-9.7c duplicates / idempotency
select test.eq(public.opening_balance_post(test.id('company'), jsonb_build_object('party_id', :'c1_v', 'side', 'RECEIVABLE',
                 'dr_cr', 'DR', 'amount', 50000, 'as_of', '2026-04-01', 'idempotency_key', 'ob-c1'))->>'duplicate_request', 'true',
               'Same request again: idempotent, no second posting');
select test.throws(format($$ select public.opening_balance_post(%L, jsonb_build_object('party_id', %L, 'side', 'RECEIVABLE', 'dr_cr', 'DR', 'amount', 1, 'as_of', '2026-04-01')) $$,
                          test.id('company'), :'c1_v'), '%already has a receivable opening balance%', 'Second opening balance for the same side refused');
select test.eq((select count(*) from public.journal_entries where source_table = 'party_opening_balances' and company_id = test.id('company'))::int, 2,
               'Exactly the two posted journals');
-- AC-9.7e: ledgers and balances; trial balance balanced
select test.eq((select receivable_balance from public.v_party_balances where party_id = :'c1_v'), 50000.00::numeric, 'Party balance shows the opening balance');
select test.eq((select balance from public.party_ledger(test.id('company'), :'c1_v', '2026-03-01', current_date, 'RECEIVABLE') order by entry_date desc nulls last limit 1),
               50000.00::numeric, 'Customer ledger carries it');
select test.eq((select sum(debit) - sum(credit) from public.trial_balance(test.id('company'), current_date)), 0::numeric, 'Trial balance stays balanced');
select test.throws(format($$ update public.journal_entry_lines set debit = 1 where journal_entry_id = (select journal_entry_id from public.party_opening_balances where id = %L) $$,
                          (select v from t where k = 'ob_c')), '%', 'Posted entries cannot be edited');
-- AC-9.7d: period rules
select test.login(null);
update public.companies set books_locked_until = '2026-06-30' where id = test.id('company');
select test.login(test.id('admin'));
select test.throws(format($$ select public.opening_balance_reverse(%L, 'wrong amount') $$, (select v from t where k = 'ob_c')), '%locked%',
                   'Reversal inside locked books refused');
select test.throws(format($$ select public.opening_balance_post(%L, jsonb_build_object('party_id', %L, 'side', 'RECEIVABLE', 'dr_cr', 'DR', 'amount', 5, 'as_of', '2026-05-01')) $$,
                          test.id('company'), :'c9_v'), '%locked%', 'Posting inside locked books refused');
select test.login(null);
update public.companies set books_locked_until = null where id = test.id('company');
-- AC-9.7e: correction = reversal + new posting
select test.login(test.id('admin'));
select test.throws(format($$ select public.opening_balance_reverse(%L, ' ') $$, (select v from t where k = 'ob_c')), '%reason is required%', 'Reversal needs a reason');
select test.eq(public.opening_balance_reverse((select v from t where k = 'ob_c'), 'Amount was 45,000')->>'status', 'REVERSED', 'Reversed');
select test.ok(exists (select 1 from public.journal_entries where source_table = 'party_opening_balances' and source_id = (select v from t where k = 'ob_c')
                       and reversal_of_id is not null), 'Reversal journal linked to the original');
select test.eq((select receivable_balance from public.v_party_balances where party_id = :'c1_v'), 0.00::numeric, 'Balance back to zero');
select public.opening_balance_post(test.id('company'), jsonb_build_object('party_id', :'c1_v', 'side', 'RECEIVABLE', 'dr_cr', 'DR', 'amount', 45000, 'as_of', '2026-04-01'));
select test.eq((select receivable_balance from public.v_party_balances where party_id = :'c1_v'), 45000.00::numeric, 'Corrected balance posted');
select test.eq((select string_agg(status, ',' order by status desc) from public.party_opening_balances where party_id = :'c1_v'), 'REVERSED,POSTED',
               'History keeps both');
select test.eq((select string_agg(action, ',' order by id) from public.audit_log where table_name = 'party_opening_balances' and company_id = test.id('company')
                and row_id in (select id::text from public.party_opening_balances where party_id = :'c1_v')), 'POST,REVERSE,POST', 'All audited');
select test.login(:'sales_v');
select test.throws(format($$ select public.opening_balance_post(%L, jsonb_build_object('party_id', %L, 'side', 'RECEIVABLE', 'dr_cr', 'DR', 'amount', 5, 'as_of', '2026-04-01')) $$,
                          test.id('company'), :'c9_v'), 'Permission denied%accounts.opening_balance%', 'Opening balances need accounts.opening_balance');
rollback;
