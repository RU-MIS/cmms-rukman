-- =============================================================================
-- PLATFORM R3 — document and master numbering (W2)
--   patterns / tokens, reset policies, start-number rule, collision check,
--   master codes (UI + import), customer-bill reference, permissions, audit.
--   Concurrency: 325_r3_numbering_concurrency.sh
-- AC 2.1–2.3, 2.5–2.7
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('NUM-TEST'));
create temp table t (k text primary key, v text) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'C1', 'CUSTOMER') as v \gset c1_
select test.party(test.id('company'), 'V1', 'SUPPLIER') as v \gset v1_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 500);
select id as v from public.voucher_books where company_id = test.id('company') and code = 'MAIN' \gset book_
select id as v from public.accounts where company_id = test.id('company') and system_key = 'CASH' \gset cash_

create or replace function pg_temp.so(p_date date) returns text language sql as $$
  select public.doc_submit('SALES_ORDER', public.doc_save('SALES_ORDER', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', p_date, 'party_id', (select id from public.parties where code = 'C1' and company_id = test.id('company')),
    'customer_po_no', 'X-' || gen_random_uuid(),
    'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('box'), 'rate', 10)))))->>'doc_no'
$$;
create or replace function pg_temp.po(p_date date) returns text language sql as $$
  select public.doc_submit('PURCHASE_ORDER', public.doc_save('PURCHASE_ORDER', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', p_date, 'party_id', (select id from public.parties where code = 'V1' and company_id = test.id('company')),
    'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 1, 'unit_id', test.id('mtr'), 'rate', 10)))))->>'doc_no'
$$;

-- ------------------------------------------------------------ AC-2.1 / 2.2: configured in the application, no code change
select test.login(test.id('admin'));
select test.eq(public.sequence_save(test.id('company'), 'SALES_ORDER',
                 '{"prefix":"SO-","pattern":"{PREFIX}{YYYY}-{NUMBER}","padding":6,"reset_policy":"CALENDAR"}')->>'next_no',
               'SO-' || to_char(current_date, 'YYYY') || '-000001', 'Preview of the next sales order number');
select test.eq(pg_temp.so('2026-09-10'), 'SO-2026-000001', 'First sales order SO-2026-000001');
select test.eq(pg_temp.so('2026-09-11'), 'SO-2026-000002', 'Second sales order SO-2026-000002');
select public.sequence_save(test.id('company'), 'PURCHASE_ORDER', '{"prefix":"PO-","pattern":"{PREFIX}{YYYY}-{NUMBER}","padding":6,"reset_policy":"CALENDAR"}');
select test.eq(pg_temp.po('2026-09-10'), 'PO-2026-000001', 'Purchase order PO-2026-000001');
select public.sequence_save(test.id('company'), 'VOUCHER_RECEIPT', '{"prefix":"REC-","pattern":"{PREFIX}{YYYY}-{NUMBER}","padding":6,"reset_policy":"CALENDAR"}');
select test.eq(public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-12', 'voucher_type', 'RECEIPT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v', 'party_id', :'c1_v', 'amount', 100)))->>'doc_no', 'REC-2026-000001', 'Receipt REC-2026-000001');

-- ------------------------------------------------------------ AC-2.7: calendar-year reset
select test.eq(pg_temp.so('2027-01-05'), 'SO-2027-000001', 'First order dated in 2027 starts again at 1');
select test.eq(pg_temp.so('2026-12-31'), 'SO-2026-000003', '2026 counter continues independently');
-- monthly reset with {MM}
select public.sequence_save(test.id('company'), 'PURCHASE_ORDER', '{"pattern":"{PREFIX}{YY}{MM}-{NUMBER}","padding":3,"reset_policy":"MONTHLY"}');
select test.eq(pg_temp.po('2026-09-15'), 'PO-2609-001', 'Monthly: September');
select test.eq(pg_temp.po('2026-10-01'), 'PO-2610-001', 'Monthly: October starts at 1');
-- financial year token
select public.sequence_save(test.id('company'), 'PURCHASE_ORDER', '{"pattern":"{PREFIX}{FY}/{NUMBER}","padding":4,"reset_policy":"FY"}');
select test.ok(pg_temp.po('2026-09-16') like 'PO-%/0001', 'Financial-year pattern');

-- ------------------------------------------------------------ AC-2.3: start number and collisions
select test.throws(format($$ select public.sequence_save(%L, 'SALES_ORDER', '{"start_value":2}') $$, test.id('company')),
                   '%already been issued%', 'Start number at or below an issued number refused');
select test.eq(public.sequence_save(test.id('company'), 'SALES_ORDER', '{"start_value":50}')->>'next_no',
               'SO-' || to_char(current_date, 'YYYY') || '-000050', 'Higher start number accepted: preview');
select test.eq(pg_temp.so(current_date), 'SO-' || to_char(current_date, 'YYYY') || '-000050', 'Next number follows the new start');
select test.throws(format($$ select public.sequence_save(%L, 'SALES_ORDER', '{"pattern":"{PREFIX}{YYYY}"}') $$, test.id('company')),
                   '%must contain {NUMBER}%', 'Pattern without {NUMBER} refused');
select test.throws(format($$ select public.sequence_save(%L, 'SALES_ORDER', '{"pattern":"{PREFIX}{DD}{NUMBER}"}') $$, test.id('company')),
                   '%Unknown token%', 'Unknown token refused');
-- a pattern change whose next number already exists is refused (no duplicate numbers)
select test.login(null);
update public.document_sequences set prefix = 'Q-', pattern = '{PREFIX}{NUMBER}', padding = 1, start_value = 1, reset_policy = 'NEVER'
where company_id = test.id('company') and doc_type = 'STOCK_TRANSFER';
select test.login(test.id('admin'));
select public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', current_date, 'from_godown_id', test.id('b336'), 'to_godown_id', test.id('warehouse'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'))))));
select test.throws(format($$ select public.sequence_save(%L, 'STOCK_TRANSFER', '{"reset_policy":"FY"}') $$, test.id('company')),
                   '%already exists%', 'Change whose next number collides with an issued one refused');
select test.eq((select doc_no from public.stock_transfers where company_id = test.id('company')), 'Q-1', 'Issued number unchanged');
-- issued numbers never change
select test.eq((select count(*) from public.sales_orders where company_id = test.id('company') and doc_no like 'SO-2026-00000%')::int, 3,
               'Earlier numbers kept after the sequence changed');
-- audit
select test.ok((select count(*) >= 5 from public.audit_log where company_id = test.id('company') and table_name = 'document_sequences'
                and action = 'NUMBERING'), 'Every numbering change audited');
select test.ok(exists (select 1 from jsonb_array_elements(public.numbering_list(test.id('company'))) x
                       where x->>'doc_type' = 'SALES_ORDER' and (x->'state'->>'last_issued')::int >= 50), 'Numbering list shows the last issued number');
select test.ok((select count(*) >= 28 from jsonb_array_elements(public.numbering_list(test.id('company')))),
               'Numbering lists the 23 document types, the masters and the bill reference');

-- ------------------------------------------------------------ AC-2.6: permissions
select test.login(test.id('operator'));
select test.throws(format($$ select public.sequence_save(%L, 'SALES_ORDER', '{"prefix":"HACK-"}') $$, test.id('company')),
                   '%settings_numbering.edit%', 'Operator cannot change numbering (RPC)');
update public.document_sequences set prefix = 'HACK-' where company_id = test.id('company') and doc_type = 'SALES_ORDER';
select test.eq((select prefix from public.document_sequences where company_id = test.id('company') and doc_type = 'SALES_ORDER'), 'SO-',
               'Operator cannot change numbering (direct API update has no effect)');
select test.throws(format($$ delete from public.document_sequences where company_id = %L $$, test.id('company')), 'permission denied%',
                   'Sequences cannot be deleted');
select test.throws(format($$ update public.document_sequence_counters set next_value = 1 where company_id = %L $$, test.id('company')),
                   'permission denied%', 'Counters cannot be changed through the API');

-- ------------------------------------------------------------ AC-2.5: master codes
select test.login(test.id('admin'));
select test.throws(format($$ select public.party_save(%L, null, '{"name":"No code","roles":["CUSTOMER"]}') $$, test.id('company')),
                   '%Code is required%', 'Automatic customer codes off: code required');
select public.sequence_save(test.id('company'), 'CUSTOMER', '{"is_active":true,"padding":5}');
insert into t values ('c2', public.party_save(test.id('company'), null, '{"name":"Auto customer","roles":["CUSTOMER"]}')::text);
select test.eq((select code from public.parties where id = (select v from t where k = 'c2')::uuid), 'CUS-00001', 'Empty code → CUS-00001');
select public.party_save(test.id('company'), null, '{"code":"CUS-00002","name":"Manual","roles":["CUSTOMER"]}');
insert into t values ('c3', public.party_save(test.id('company'), null, '{"name":"Auto 2","roles":["CUSTOMER"]}')::text);
select test.eq((select code from public.parties where id = (select v from t where k = 'c3')::uuid), 'CUS-00003', 'A typed-in code is skipped');
select test.throws(format($$ select public.party_save(%L, null, '{"code":"cus-00001","name":"Dup","roles":["CUSTOMER"]}') $$, test.id('company')),
                   '%', 'Manual code must be unique');
-- items / godowns
select public.sequence_save(test.id('company'), 'ITEM', '{"is_active":true}');
insert into public.items (company_id, code, name, item_kind, base_unit_id)
values (test.id('company'), '', 'Auto item', 'FINISHED_GOOD', test.id('pair'));
select test.eq((select code from public.items where company_id = test.id('company') and name = 'Auto item'), 'ITM-00001', 'Item code ITM-00001');
select public.sequence_save(test.id('company'), 'GODOWN', '{"is_active":true}');
insert into public.godowns (company_id, code, name) values (test.id('company'), null, 'Auto godown');
select test.eq((select code from public.godowns where company_id = test.id('company') and name = 'Auto godown'), 'GDN-001', 'Godown code GDN-001');
-- import with an empty code column
create or replace function pg_temp.imp(p_entity text, p_rows jsonb) returns jsonb language plpgsql as $$
declare v_job jsonb; v_cols text[];
begin
  v_cols := array(select distinct k from jsonb_array_elements(p_rows) x, jsonb_object_keys(x) k);
  v_job := public.import_create(test.id('company'), p_entity, 'test.xlsx', 'ALL_OR_NOTHING', false, v_cols);
  perform public.import_add_rows((v_job->>'job_id')::uuid,
    (select jsonb_agg(jsonb_build_object('row_no', o + 1, 'data', x)) from jsonb_array_elements(p_rows) with ordinality a(x, o)));
  perform public.import_validate((v_job->>'job_id')::uuid);
  return public.import_commit((v_job->>'job_id')::uuid, true);
end $$;
select pg_temp.imp('CUSTOMERS', '[{"code":"","name":"Imported customer"}]');
select test.eq((select code from public.parties where company_id = test.id('company') and name = 'Imported customer'), 'CUS-00004',
               'Import with an empty code column takes the next customer code');
select pg_temp.imp('GODOWNS', '[{"code":"","name":"Imported A"},{"code":"","name":"Imported B"}]');
select test.eq((select string_agg(code, ',' order by code) from public.godowns where company_id = test.id('company') and name like 'Imported %'),
               'GDN-002,GDN-003', 'Several empty codes in one file are not duplicates; each gets its own code');

-- ------------------------------------------------------------ customer-bill reference
select test.login(test.id('admin'));
select public.sequence_save(test.id('company'), 'CUSTOMER_BILL', '{"is_active":true}');
insert into t values ('bill', public.doc_save('CUSTOMER_BILL', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-21', 'party_id', :'c1_v', 'amount', 100))::text);
select test.ok((select bill_no like 'INV-%/0001' from public.customer_bills where id = (select v from t where k = 'bill')::uuid),
               'Bill without an invoice number gets the INV reference');
rollback;
