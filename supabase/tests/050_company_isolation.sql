-- =============================================================================
-- Spec §52 isolation — inside one instance between companies (Q-34).
-- (Isolation between INSTANCES is by separate Supabase projects; see
-- docs/INSTANCE_ARCHITECTURE.md §5–6 and scripts/instance-verify.sql.)
-- Company A users must not see or touch company B data, and documents of A
-- cannot reference B's masters.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('CO-A'));
insert into test.ctx values ('fxb', test.fixture('CO-B'));
create or replace function pg_temp.b(p_key text) returns uuid language sql stable as
  $$ select (v->>p_key)::uuid from test.ctx where k = 'fxb' $$;

-- give B some data: a customer and a posted job-work PO
select test.login(pg_temp.b('admin'));
insert into public.parties (company_id, code, name) values (pg_temp.b('company'), 'CUSTOMER-B', 'Customer-B');
select public.doc_submit('JOB_WORK_ORDER', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
  'company_id', pg_temp.b('company'), 'doc_date', '2026-09-01', 'party_id', pg_temp.b('aleem'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', pg_temp.b('fg'), 'qty', 5, 'unit_id', pg_temp.b('box'))))));
select public.doc_submit('JOB_WORK_RECEIPT', public.doc_save('JOB_WORK_RECEIPT', jsonb_build_object(
  'company_id', pg_temp.b('company'), 'doc_date', '2026-09-02', 'party_id', pg_temp.b('aleem'), 'godown_id', pg_temp.b('b336'),
  'lines', jsonb_build_array(jsonb_build_object(
     'order_line_id', (select ol.id from public.job_work_order_lines ol join public.job_work_orders o on o.id = ol.order_id
                       where o.company_id = pg_temp.b('company') limit 1),
     'item_id', pg_temp.b('fg'), 'qty', 5, 'unit_id', pg_temp.b('box'), 'rate', 100)))));
set constraints all immediate; set constraints all deferred;

-- and A a customer
select test.login(test.id('admin'));
insert into public.parties (company_id, code, name) values (test.id('company'), 'CUSTOMER-A', 'Customer-A');

-- ------------------------------------------------ A cannot see B
select test.eq((select count(*) from public.companies)::int, 1, 'A admin sees only company A');
select test.ok(not exists (select 1 from public.parties where name = 'Customer-B'), 'A cannot see Customer-B');
select test.ok(exists (select 1 from public.parties where name = 'Customer-A'), 'A sees Customer-A');
select test.eq((select count(*) from public.job_work_orders)::int, 0, 'A sees no B purchase/job-work orders');
select test.eq((select count(*) from public.job_work_receipts)::int, 0, 'A sees no B receipts');
select test.eq((select count(*) from public.stock_movements)::int, 0, 'A sees no B stock');
select test.eq((select count(*) from public.stock_balances)::int, 0, 'A sees no B godown stock');
select test.eq((select count(*) from public.journal_entries)::int, 0, 'A sees no B ledger / accounting');
select test.eq((select count(*) from public.v_party_balances where company_id = pg_temp.b('company'))::int, 0,
               'A sees no B party balances');
select test.eq((select count(*) from public.godowns where company_id = pg_temp.b('company'))::int, 0, 'A sees no B godowns');
select test.eq((select count(*) from public.user_roles where company_id = pg_temp.b('company'))::int, 0, 'A sees no B users');
select test.eq((select count(*) from public.trial_balance(pg_temp.b('company'), date '2027-03-31'))::int, 0,
               'B trial balance is empty for an A user');

-- ------------------------------------------------ A cannot write into B
select test.throws(format($$ insert into public.parties (company_id, code, name) values (%L, 'X', 'X') $$, pg_temp.b('company')),
                   '%row-level security%', 'A cannot create a party in company B');
update public.parties set name = 'hacked' where company_id = pg_temp.b('company');
select test.login(pg_temp.b('admin'));
select test.ok(exists (select 1 from public.parties where name = 'Customer-B'), 'B data unchanged by A update attempt');
select test.login(test.id('admin'));
select test.throws(format($$ select public.doc_save('JOB_WORK_ORDER', jsonb_build_object('company_id', %L,
                     'doc_date', '2026-09-01', 'party_id', %L,
                     'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L)))) $$,
                   pg_temp.b('company'), pg_temp.b('aleem'), pg_temp.b('fg'), pg_temp.b('box')),
                   'Unknown company%', 'A cannot create documents in company B');
select test.throws(format($$ select public.doc_cancel('JOB_WORK_RECEIPT', %L, 'x') $$,
                          (select id from public.job_work_receipts where company_id = pg_temp.b('company') limit 1)),
                   '%not found%', 'A cannot cancel B documents (not even visible)');

-- ------------------------------------------------ A documents cannot use B masters
select test.throws(format($$ select public.doc_submit('JOB_WORK_ORDER', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
                     'company_id', %L, 'doc_date', '2026-09-01', 'party_id', %L,
                     'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L))))) $$,
                   test.id('company'), pg_temp.b('aleem'), test.id('fg'), test.id('box')),
                   '%belongs to another company%', 'A PO with a B party is rejected');
select test.throws(format($$ insert into public.item_consumption_rules (company_id, fg_item_id, consumed_item_id, per_unit_id,
                     qty_per_unit, effective_from) values (%L, %L, %L, %L, 1, '2026-01-01') $$,
                   test.id('company'), test.id('fg'), pg_temp.b('carton'), test.id('box')),
                   '%belongs to another company%', 'A rule cannot consume a B item');

-- ------------------------------------------------ same numbering, independent per company
select test.eq((select doc_no from public.job_work_orders where company_id = test.id('company') limit 1), null::text,
               'A has no PO yet');
select public.doc_submit('JOB_WORK_ORDER', public.doc_save('JOB_WORK_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'party_id', test.id('aleem'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('box'))))));
select test.eq((select doc_no from public.job_work_orders where company_id = test.id('company') limit 1), 'GT-1',
               'Each company has its own document numbering');

-- ------------------------------------------------ anonymous users see nothing
select test.login(null);
set local role anon;
select test.throws($$ select count(*) from public.parties $$, 'permission denied%', 'Anonymous cannot read parties');
reset role;

rollback;
