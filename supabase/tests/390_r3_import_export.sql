-- =============================================================================
-- PLATFORM R3 — import / export completion (W11)
--   saved mappings, "did you mean" suggestions (scope-aware), new entities,
--   role-assignment import with anti-escalation, stock exports with scope and
--   cost masking, opening-stock rates need landed cost.
-- AC 11.1 (database part), 11.2–11.4, 11.6 (R2 suite unchanged)
-- AC-11.5 (10,000 rows under the 8 s timeout): scripts/db/perf-r3.sh
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('IMP3-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

create or replace function pg_temp.imp(p_entity text, p_rows jsonb, p_update boolean default false) returns jsonb language plpgsql as $$
declare v_job jsonb; v_cols text[];
begin
  v_cols := array(select distinct k from jsonb_array_elements(p_rows) x, jsonb_object_keys(x) k);
  v_job := public.import_create(test.id('company'), p_entity, 'test.xlsx', 'VALID_ONLY', p_update, v_cols);
  perform public.import_add_rows((v_job->>'job_id')::uuid,
    (select jsonb_agg(jsonb_build_object('row_no', o + 1, 'data', x)) from jsonb_array_elements(p_rows) with ordinality a(x, o)));
  return public.import_validate((v_job->>'job_id')::uuid);
end $$;
create or replace function pg_temp.commit(p_job jsonb) returns jsonb language sql as $$ select public.import_commit((p_job->>'id')::uuid, true) $$;
create or replace function pg_temp.errors(p_job jsonb) returns text language sql as $$
  select string_agg(row_no || ':' || coalesce(column_key, '-') || ':' || message || coalesce(' → ' || suggestion, ''), ' | ' order by row_no, id)
  from public.import_errors where job_id = (p_job->>'id')::uuid $$;

select test.login(null);
select test.party(test.id('company'), 'CUS-A', 'CUSTOMER') as v \gset ca_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 100);
select app.post_stock(test.id('company'), test.id('fg'), test.id('warehouse'), date '2026-04-01', 'OPENING', 1::smallint, 50,
                      test.id('pair'), 1, 190, null, 'fixture', test.id('company'), null, 'OPENING');   -- with a landed rate
select test.user_with_role(test.id('company'), 'ADMIN') as v \gset adm_
select test.user_with_role(test.id('company'), 'INVENTORY') as v \gset inv_
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000e0001', 'new.member@imp.local');
select public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-0000000e0001',
  jsonb_build_object('kind', 'INTERNAL', 'email', 'new.member@imp.local', 'full_name', 'New member',
                     'role_ids', jsonb_build_array((select id from public.roles where company_id = test.id('company') and code = 'VIEWER'))), true)
from (select test.login(test.id('admin'))) x;

-- ------------------------------------------------------------ AC-11.1: saved mappings
select test.login(test.id('admin'));
insert into t values ('tpl', public.import_template_save(test.id('company'), 'CUSTOMERS', 'Tally layout',
  '{"Party Code":"code","Party Name":"name","E-mail":"email","Ignore me":""}'));
select test.eq((select mapping->>'Party Name' from public.import_templates where id = (select v from t where k = 'tpl')), 'name', 'Mapping saved per company and entity');
select test.throws(format($$ select public.import_template_save(%L, 'CUSTOMERS', 'Bad', '{"X":"no_such_column"}') $$, test.id('company')),
                   '%Unknown column no_such_column%', 'Mapping to an unknown column refused');
select test.eq(public.import_template_save(test.id('company'), 'CUSTOMERS', 'Tally layout', '{"Party Code":"code","Party Name":"name"}'),
               (select v from t where k = 'tpl'), 'Saving the same name updates the mapping');
select test.login(test.id('operator'));
select test.throws(format($$ select public.import_template_save(%L, 'ITEMS', 'x', '{}') $$, test.id('company')), 'Permission denied%',
                   'Saving a mapping needs the import right');

-- ------------------------------------------------------------ AC-11.2: did you mean
select test.login(test.id('admin'));
select pg_temp.imp('LOCATIONS', '[{"godown_code":"B-33","rack":"R1"}]') as v \gset j1_
select test.ok(pg_temp.errors(:'j1_v'::jsonb) like '%godown_code%→ B-336%', 'Unknown godown code suggests the closest existing one');
select pg_temp.imp('ITEM_PACKINGS', '[{"item_code":"FG-4767","unit":"BOX","factor":12}]') as v \gset j2_
select test.ok(pg_temp.errors(:'j2_v'::jsonb) like '%item_code%→ FG-476%', 'Unknown item code suggests the closest item');
select public.user_set_scope(test.id('company'), :'inv_v', 'GODOWN', array[test.id('warehouse')]);
select public.user_set_scope(test.id('company'), :'adm_v', 'GODOWN', array[test.id('warehouse')]);
select test.login(:'adm_v');
select pg_temp.imp('LOCATIONS', '[{"godown_code":"B-33","rack":"R1"}]') as v \gset j3_
select test.ok(coalesce(pg_temp.errors(:'j3_v'::jsonb), '') not like '%B-336%', 'Suggestions only among records the importer can see');

-- ------------------------------------------------------------ new entities
select test.login(test.id('admin'));
select pg_temp.commit(pg_temp.imp('UNITS', '[{"code":"DOZ","name":"Dozen"}]'));
select pg_temp.commit(pg_temp.imp('CATEGORIES', '[{"name":"Footwear","code":"FW"},{"name":"Sandals","parent":"Footwear"}]'));
select pg_temp.commit(pg_temp.imp('BRANDS', '[{"name":"Rukman Gold"}]'));
select pg_temp.commit(pg_temp.imp('ITEM_PACKINGS', '[{"item_code":"FG-4766","unit":"DOZ","factor":12}]'));
select pg_temp.commit(pg_temp.imp('PARTY_ADDRESSES', '[{"party_code":"CUS-A","code":"DC1","name":"DC Bhiwandi","city":"Bhiwandi","gstin":"27abcde1234f1z5"}]'));
select test.ok(exists (select 1 from public.units where company_id = test.id('company') and code = 'DOZ'), 'Unit imported');
select test.eq((select p.name from public.item_categories c join public.item_categories p on p.id = c.parent_id
                where c.company_id = test.id('company') and c.name = 'Sandals'), 'Footwear', 'Subcategory imported with its parent');
select test.eq((select code from public.brands where company_id = test.id('company') and name = 'Rukman Gold'), 'RUKMAN-GOLD', 'Brand imported (code from the name)');
select test.ok(exists (select 1 from public.item_packings k join public.units u on u.id = k.unit_id where k.item_id = test.id('fg') and u.code = 'DOZ'),
               'Packing imported');
select test.eq((select gstin from public.party_addresses where party_id = :'ca_v' and code = 'DC1'), '27ABCDE1234F1Z5', 'Address imported');
select test.ok(exists (select 1 from jsonb_array_elements(public.export_rows(test.id('company'), 'UNITS')) x where x->>'code' = 'DOZ'),
               'Units export');
select test.ok(exists (select 1 from jsonb_array_elements(public.export_rows(test.id('company'), 'PARTY_ADDRESSES')) x where x->>'code' = 'DC1'),
               'Addresses export');

-- ------------------------------------------------------------ AC-11.3: role assignments, no escalation
select test.login(:'adm_v');
select pg_temp.imp('ROLE_ASSIGNMENTS', '[{"email":"new.member@imp.local","role_code":"OPERATOR"},
                                        {"email":"new.member@imp.local","role_code":"OWNER"},
                                        {"email":"nobody@imp.local","role_code":"OPERATOR"}]') as v \gset j4_
select test.eq(pg_temp.errors(:'j4_v'::jsonb),
               '3:role_code:Only an owner can grant or remove the owner role | 4:email:Not a user of this company',
               'Assigning OWNER refused for a non-owner; unknown user refused; the valid row (2) accepted');
select pg_temp.commit(:'j4_v'::jsonb);
select test.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                       where ur.user_id = '00000000-0000-0000-0000-0000000e0001' and r.code = 'OPERATOR'), 'Role assigned through the import');
select test.ok(not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                           where ur.user_id = '00000000-0000-0000-0000-0000000e0001' and r.code = 'OWNER'), 'OWNER not assigned');
select test.login(test.id('admin'));
insert into t values ('big', public.role_save(test.id('company'), null, '{"code":"SUPER","name":"Super"}'));
select public.role_set_permissions((select v from t where k = 'big'), array['users.manage_owners', 'users.view']);
select public.role_set_permissions(r.id, array(select permission_code from public.role_permissions where role_id = r.id and permission_code <> 'users.manage_owners'))
from public.roles r where r.company_id = test.id('company') and r.code = 'ADMIN';
select test.login(:'adm_v');
select pg_temp.imp('ROLE_ASSIGNMENTS', '[{"email":"new.member@imp.local","role_code":"SUPER"}]') as v \gset j5_
select test.ok(pg_temp.errors(:'j5_v'::jsonb) like '2:role_code:%', 'Role with rights the importer does not hold is refused for that row');
select test.login(test.id('operator'));
select test.throws(format($$ select public.import_create(%L, 'ROLE_ASSIGNMENTS', 'x', 'VALID_ONLY', false, array['email', 'role_code']) $$, test.id('company')),
                   'Permission denied%', 'Role-assignment import needs the role-assignment right');

-- ------------------------------------------------------------ AC-11.4: stock export scope + masking
select test.login(:'inv_v');
select test.eq((select string_agg(distinct x->>'godown_code', ',') from jsonb_array_elements(public.export_rows(test.id('company'), 'GODOWN_STOCK')) x),
               'WAREHOUSE', 'Godown-A user exports only Godown A');
select test.ok((select bool_and(not (x ? 'avg_cost') and not (x ? 'value')) from jsonb_array_elements(public.export_rows(test.id('company'), 'GODOWN_STOCK')) x),
               'Without average cost / valuation: no value columns');
select test.login(test.id('admin'));
select test.ok((select bool_or(x ? 'value') from jsonb_array_elements(public.export_rows(test.id('company'), 'GODOWN_STOCK')) x), 'Owner export has values');

-- ------------------------------------------------------------ opening stock: rate needs landed cost (D3)
select test.login(test.id('admin'));
insert into t values ('si_role', public.role_save(test.id('company'), null, '{"code":"STOCK_IMPORTER","name":"Stock importer"}'));
select public.role_set_permissions((select v from t where k = 'si_role'),
  array['stock_adjustment.import', 'stock_adjustment.create', 'stock_adjustment.view', 'items.view', 'godowns.view']);
select test.login(null);
select test.user_with_role(test.id('company'), 'STOCK_IMPORTER') as v \gset si_
select test.login(:'si_v');
select pg_temp.imp('OPENING_STOCK', '[{"item_code":"FG-4766","godown_code":"WAREHOUSE","qty":5,"rate":190}]') as v \gset j6_
select test.ok(pg_temp.errors(:'j6_v'::jsonb) like '%rate%', 'Opening-stock rate refused without the landed-cost right');
-- ------------------------------------------------------------ AC-11.5: large files are committed by the worker as the importer
select test.login(test.id('admin'));
select public.import_create(test.id('company'), 'UNITS', 'big.xlsx', 'ALL_OR_NOTHING', false, array['code', 'name'])->>'job_id' as big \gset
select public.import_add_rows(:'big', (select jsonb_agg(jsonb_build_object('row_no', n + 1, 'data', jsonb_build_object('code', 'U' || n, 'name', 'Unit ' || n)))
                                       from generate_series(1, 2000) n));
select public.import_add_rows(:'big', '[{"row_no": 2002, "data": {"code": "U2001", "name": "Unit 2001"}}]');
select public.import_validate(:'big')->>'valid_rows';
select test.eq(public.import_commit(:'big', true)->>'status', 'QUEUED', 'More than 2,000 rows: the confirmed import is queued');
select test.eq((select count(*) from public.units where company_id = test.id('company') and code like 'U%')::int, 0, 'Nothing written yet');
select test.throws('select public.import_commit_next()', 'permission denied%', 'API users cannot run the queue');
select test.login(null);   -- the worker (service role)
select test.eq(public.import_commit_next()->>'status', 'COMMITTED', 'Worker commits the queued job');
select test.eq((select count(*) from public.units where company_id = test.id('company') and code like 'U%')::int, 2001, 'All rows written in one transaction');
select test.eq((select string_agg(distinct actor_id::text, ',') from public.audit_log where table_name = 'import_jobs' and row_id = :'big'),
               test.id('admin')::text, 'Written and audited as the importer, not as the worker');
select test.ok(public.import_commit_next() is null, 'Queue empty');
-- rights checked again at commit time
select test.login(:'adm_v');
select public.import_create(test.id('company'), 'UNITS', 'big2.xlsx', 'ALL_OR_NOTHING', false, array['code', 'name'])->>'job_id' as big2 \gset
select public.import_add_rows(:'big2', (select jsonb_agg(jsonb_build_object('row_no', n + 1, 'data', jsonb_build_object('code', 'W' || n, 'name', 'W ' || n)))
                                        from generate_series(1, 2000) n));
select public.import_add_rows(:'big2', '[{"row_no": 2002, "data": {"code": "W2001", "name": "W 2001"}}]');
select public.import_validate(:'big2')->>'valid_rows';
select public.import_commit(:'big2', true)->>'status';
select test.login(test.id('admin'));
select public.user_set_status(test.id('company'), :'adm_v', false, 'left');
select test.login(null);
select test.eq(public.import_commit_next()->>'status', 'FAILED', 'Importer disabled before the worker ran: the job fails');
select test.eq((select count(*) from public.units where code like 'W%')::int, 0, '... and nothing is written');
rollback;
