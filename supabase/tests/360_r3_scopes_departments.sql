-- =============================================================================
-- PLATFORM R3 — departments and the record scope (W8)
--   ALL / DEPARTMENT / OWN per user or role, restrictive and combined with the
--   godown scope; lines and views follow their header; RPC actions checked.
-- AC 8.1–8.3 (AC-8.4 performance: scripts/db/perf-r3.sh)
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('REC-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'C1', 'CUSTOMER') as v \gset c1_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 500);
select test.stock_in(test.id('company'), test.id('fg'), test.id('warehouse'), 500);
select test.user_with_role(test.id('company'), 'SALES') as v \gset s1_
select test.user_with_role(test.id('company'), 'SALES') as v \gset s2_
select test.user_with_role(test.id('company'), 'SALES') as v \gset s3_
select test.user_with_role(test.id('company'), 'INVENTORY') as v \gset i1_
select test.user_with_role(test.id('company'), 'INVENTORY') as v \gset i2_

-- ------------------------------------------------------------ departments
select test.login(test.id('admin'));
insert into public.departments (company_id, name) values (test.id('company'), 'North') returning id as v \gset north_
insert into public.departments (company_id, name) values (test.id('company'), 'South') returning id as v \gset south_
select public.user_set_department(test.id('company'), :'s1_v', :'north_v');
select public.user_set_department(test.id('company'), :'s2_v', :'north_v');
select public.user_set_department(test.id('company'), :'s3_v', :'south_v');
select test.eq((select department from public.company_users where company_id = test.id('company') and user_id = :'s1_v'), 'North',
               'The R1 department text follows the reference');
select test.login(null);   -- R1 user profile save / import path (service role)
update public.company_users set department = 'East' where company_id = test.id('company') and user_id = :'i1_v';
select test.login(test.id('admin'));
select test.ok(exists (select 1 from public.departments where company_id = test.id('company') and name = 'East')
               and (select department_id is not null from public.company_users where company_id = test.id('company') and user_id = :'i1_v'),
               'A department typed as text (R1 screens, imports) becomes a department row');
select test.login(test.id('operator'));
select test.throws(format($$ insert into public.departments (company_id, name) values (%L, 'Hack') $$, test.id('company')), '%',
                   'Departments need users.edit');

-- ------------------------------------------------------------ documents by three sales users
create or replace function pg_temp.so(p_no text) returns uuid language sql as $$
  select (public.doc_submit('SALES_ORDER', public.doc_save('SALES_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date,
    'party_id', (select id from public.parties where code = 'C1' and company_id = test.id('company')), 'customer_po_no', p_no,
    'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('box'), 'rate', 10)))))->>'id')::uuid $$;
select test.login(:'s1_v'); insert into t values ('so1', pg_temp.so('S1'));
select test.login(:'s2_v'); insert into t values ('so2', pg_temp.so('S2'));
select test.login(:'s3_v'); insert into t values ('so3', pg_temp.so('S3'));

-- ------------------------------------------------------------ AC-8.1: own records
select test.login(test.id('admin'));
select public.user_set_record_scope(test.id('company'), :'s1_v', 'OWN');
select test.throws(format($$ select public.user_set_record_scope(%L, %L, 'OWN') $$, test.id('company'), test.id('admin')),
                   '%owner always sees all records%', 'The owner cannot be restricted');
select test.login(:'s1_v');
select test.eq((select string_agg(customer_po_no, ',' order by customer_po_no) from public.sales_orders where company_id = test.id('company')), 'S1',
               'Own records: only my sales orders');
select test.eq((select count(*) from public.sales_order_lines l where l.order_id in ((select v from t where k = 'so2'), (select v from t where k = 'so3')))::int, 0,
               'Lines of other users'' orders hidden');
select test.eq((select count(distinct order_id) from public.v_sales_order_lines where company_id = test.id('company'))::int, 1,
               'Order line view follows the header');
select test.throws(format($$ select public.doc_submit('SALES_ORDER', %L) $$, (select v from t where k = 'so2')), '%not found%',
                   'Another user''s order cannot be opened / submitted by ID');
select test.throws(format($$ select public.doc_save('SALES_ORDER', jsonb_build_object('id', %L, 'company_id', %L, 'doc_date', current_date,
                             'party_id', %L, 'customer_po_no', 'X', 'lines', '[]'::jsonb)) $$, (select v from t where k = 'so2'), test.id('company'), :'c1_v'),
                   '%not found%', 'Another user''s order cannot be changed by ID');
select test.throws('select public.user_set_record_scope(test.id(''company''), auth.uid(), ''ALL'')', '%',
                   'A user cannot widen his own record scope');

-- ------------------------------------------------------------ AC-8.2: my department (via the role)
select test.login(test.id('admin'));
insert into t values ('dept_role', public.role_save(test.id('company'), null, '{"code":"SALES_DEPT","name":"Sales (department)"}'));
select public.role_set_permissions((select v from t where k = 'dept_role'),
                                   array(select permission_code from public.role_permissions rp join public.roles r on r.id = rp.role_id
                                         where r.company_id = test.id('company') and r.code = 'SALES'));
select public.role_set_record_scope((select v from t where k = 'dept_role'), 'DEPARTMENT');
select test.login(null);
update public.user_roles set role_id = (select v from t where k = 'dept_role') where user_id = :'s2_v' and company_id = test.id('company');
select test.login(:'s2_v');
select test.eq((select string_agg(customer_po_no, ',' order by customer_po_no) from public.sales_orders where company_id = test.id('company')), 'S1,S2',
               'My department: orders of North colleagues, not South');
select test.login(:'s3_v');
select test.eq((select count(*) from public.sales_orders where company_id = test.id('company'))::int, 3, 'Default scope ALL: unchanged R2 behaviour');
-- roles combine to the widest; the user setting overrides the roles
select test.login(test.id('admin'));
select public.user_set_record_scope(test.id('company'), :'s2_v', 'OWN');
select test.login(:'s2_v');
select test.eq((select string_agg(customer_po_no, ',') from public.sales_orders where company_id = test.id('company')), 'S2', 'User setting overrides the role');
select test.login(test.id('admin'));
select public.user_set_record_scope(test.id('company'), :'s2_v', null);
select test.login(:'s2_v');
select test.eq((select count(*) from public.sales_orders where company_id = test.id('company'))::int, 2, 'Back to the role''s department scope');
select test.ok(exists (select 1 from public.audit_log where company_id = test.id('company') and action = 'RECORD_SCOPE'), 'Scope changes audited')
from (select test.login(test.id('admin'))) x;

-- ------------------------------------------------------------ AC-8.3: own records + Godown A
select test.login(test.id('admin'));
select public.user_set_record_scope(test.id('company'), :'i1_v', 'OWN');
select public.user_set_scope(test.id('company'), :'i1_v', 'GODOWN', array[test.id('b336')]);
create or replace function pg_temp.adj(p_godown uuid) returns uuid language sql as $$
  select public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date, 'godown_id', p_godown,
    'reason', 'DAMAGE', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', -1, 'qty', 1, 'unit_id', test.id('pair'))))) $$;
select test.login(:'i1_v'); insert into t values ('a_own_b336', pg_temp.adj(test.id('b336')));
select test.login(:'i2_v'); insert into t values ('a_other_b336', pg_temp.adj(test.id('b336')));
                            insert into t values ('a_other_wh', pg_temp.adj(test.id('warehouse')));
select test.login(:'i1_v');
select test.eq((select string_agg(id::text, ',') from public.stock_adjustments where company_id = test.id('company')),
               (select v from t where k = 'a_own_b336')::text, 'Own records + Godown A: only my adjustments in Godown A');
select test.login(test.id('admin'));
select test.eq((select count(*) from public.stock_adjustments where company_id = test.id('company'))::int, 3, 'Owner sees every record');
rollback;
