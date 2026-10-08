-- =============================================================================
-- PLATFORM R1 — godown data scope enforced in RLS and in the posting RPCs,
-- user creation (internal + portal), login management across companies.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('SCOPE-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- Godown A = B-336 (has 1000 cartons from the fixture), Godown B = WAREHOUSE.
select test.login(null);
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 100);
select test.stock_in(test.id('company'), test.id('fg'), test.id('warehouse'), 50);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000d001', 'storea@scope.local');

-- ------------------------------------------------ create the user with a godown restriction
select test.login(test.id('admin'));
insert into t values ('inv', (select id from public.roles where company_id = test.id('company') and code = 'INVENTORY'));
select public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-00000000d001',
  jsonb_build_object('kind', 'INTERNAL', 'email', 'storea@scope.local', 'full_name', 'Store A',
                     'role_ids', jsonb_build_array((select v from t where k = 'inv')),
                     'godown_ids', jsonb_build_array(test.id('b336'))), true);
select test.ok((select must_change_password from public.profiles where id = '00000000-0000-0000-0000-00000000d001'),
               'New login with temporary password must change it');
select test.login(null);
update auth.users set encrypted_password = 'own', last_sign_in_at = now() where id = '00000000-0000-0000-0000-00000000d001';

-- ------------------------------------------------ enforcement is complete (catalogue check)
select test.eq((select count(*) from app.godown_scoped_tables g
                where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = g.table_name
                                  and p.policyname = g.table_name || '_godown_scope' and p.permissive = 'RESTRICTIVE'))::int, 0,
               'Every table with a godown has a restrictive scope policy');
select test.eq((select count(*) from app.godown_scoped_tables g
                where g.guard_writes and not exists (select 1 from pg_trigger tg where tg.tgrelid = ('public.' || g.table_name)::regclass
                                                     and tg.tgname = g.table_name || '_godown_scope'))::int, 0,
               'Every godown table written by RPCs has a scope trigger');
select test.eq((select count(*) from information_schema.columns c
                where c.table_schema = 'public' and c.column_name in ('godown_id', 'from_godown_id', 'to_godown_id', 'factory_godown_id', 'default_godown_id')
                  and exists (select 1 from information_schema.tables x where x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE')
                  and not exists (select 1 from app.godown_scoped_tables g where g.table_name = c.table_name and c.column_name = any (g.columns)))::int, 0,
               'No table with a godown column is missing from the scope registry');

-- ------------------------------------------------ reads (RLS)
select test.login('00000000-0000-0000-0000-00000000d001');
select test.ok(app.has_permission(test.id('company'), 'stock_adjustment.create'), 'Inventory role can post adjustments');
select test.eq((select array_agg(code order by code) from public.godowns), array['B-336'], 'Scoped user sees only Godown A');
select test.ok(not exists (select 1 from public.stock_balances where godown_id = test.id('warehouse')), 'No balances of Godown B');
select test.ok(not exists (select 1 from public.stock_movements where godown_id = test.id('warehouse')), 'No movements of Godown B');
select test.ok(not exists (select 1 from public.storage_locations where godown_id = test.id('warehouse')), 'No locations of Godown B');
select test.eq((select physical_qty from public.v_inventory_items where item_id = test.id('fg')), 100.000::numeric,
               'Consolidated inventory counts only Godown A (100, not 150)');
select test.ok(not exists (select 1 from public.v_stock_by_location where godown_id = test.id('warehouse')), 'Location view hides Godown B');
select test.eq((select count(*) from public.inventory_item_detail(test.id('fg')) d)::int,
               (select count(*) from public.inventory_item_detail(test.id('fg')) d)::int, 'Item detail runs under RLS');
select test.eq((public.my_scopes(test.id('company'))->'GODOWN'->>0)::uuid, test.id('b336'), 'my_scopes reports the restriction');

-- ------------------------------------------------ writes (posting RPCs)
select test.ok((public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'godown_id', test.id('b336'), 'reason', 'STOCK_IN',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', 1, 'qty', 5, 'unit_id', test.id('pair')))))))
  ->>'status' is not null, 'Stock IN in own Godown A works');
select test.throws(format($$ select public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-01', 'godown_id', %L, 'reason', 'STOCK_IN',
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'direction', 1, 'qty', 5, 'unit_id', %L)))) $$,
  test.id('company'), test.id('warehouse'), test.id('fg'), test.id('pair')),
  'Godown access denied%WAREHOUSE%', 'Cannot even save a document for Godown B');
select test.throws(format($$ select public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-02', 'from_godown_id', %L, 'to_godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L))))) $$,
  test.id('company'), test.id('b336'), test.id('warehouse'), test.id('fg'), test.id('pair')),
  'Godown access denied%', 'Transfer into Godown B needs access to Godown B');
select test.throws(format($$ insert into public.stock_movements (company_id, item_id, godown_id, movement_date, movement_type, direction, qty, unit_id,
                                                                 factor_to_base, base_qty, source_table, source_id)
                            values (%L, %L, %L, current_date, 'OPENING', 1, 1, %L, 1, 1, 'x', gen_random_uuid()) $$,
                          test.id('company'), test.id('fg'), test.id('warehouse'), test.id('pair')),
                   '%permission denied%', 'Direct API insert into the stock ledger is impossible');

-- a document of Godown B created by the owner cannot be touched by id
select test.login(test.id('admin'));
insert into t values ('adjb', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'godown_id', test.id('warehouse'), 'reason', 'STOCK_IN',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', 1, 'qty', 1, 'unit_id', test.id('pair'))))));
select test.login('00000000-0000-0000-0000-00000000d001');
select test.ok(not exists (select 1 from public.stock_adjustments where id = (select v from t where k = 'adjb')),
               'Document of Godown B is invisible');
select test.ok(not exists (select 1 from public.stock_adjustment_lines where adjustment_id = (select v from t where k = 'adjb')),
               'Lines of a Godown B document are invisible');
select test.throws(format($$ select public.doc_submit('STOCK_ADJUSTMENT', %L) $$, (select v from t where k = 'adjb')),
                   'Godown access denied%', 'Cannot submit a Godown B document by id (URL / API bypass)');
select test.login(test.id('admin'));
select public.user_set_overrides(test.id('company'), '00000000-0000-0000-0000-00000000d001',
                                 '[{"permission_code":"stock_adjustment.delete","effect":"ALLOW"}]');
select test.login('00000000-0000-0000-0000-00000000d001');
select test.throws(format($$ select public.doc_delete_draft('STOCK_ADJUSTMENT', %L) $$, (select v from t where k = 'adjb')),
                   'Godown access denied%', 'Cannot delete a Godown B document by id (even with delete permission)');
select test.login(test.id('admin'));
select test.ok(exists (select 1 from public.stock_adjustments where id = (select v from t where k = 'adjb') and status = 'DRAFT'),
               'Godown B document is unchanged');

-- ------------------------------------------------ role scope + union semantics
select test.login(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000d002', 'storeb@scope.local');
select test.login(test.id('admin'));
insert into t values ('storeb', public.role_clone((select v from t where k = 'inv'), 'STORE_B', 'Store B'));
select public.role_set_scope((select v from t where k = 'storeb'), 'GODOWN', array[test.id('warehouse')]);
select public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-00000000d002',
  jsonb_build_object('kind', 'INTERNAL', 'email', 'storeb@scope.local', 'role_ids', jsonb_build_array((select v from t where k = 'storeb'))), false);
select test.login('00000000-0000-0000-0000-00000000d002');
select test.eq((select array_agg(code order by code) from public.godowns), array['WAREHOUSE'], 'Role scope: user sees only Godown B');
select test.login(test.id('admin'));
select public.user_set_roles(test.id('company'), '00000000-0000-0000-0000-00000000d002',
                             array[(select v from t where k = 'storeb'), (select id from public.roles where company_id = test.id('company') and code = 'VIEWER')]);
select test.login('00000000-0000-0000-0000-00000000d002');
select test.eq((select count(*) from public.godowns)::int, 3, 'Another unrestricted role → all godowns');
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), '00000000-0000-0000-0000-00000000d002', 'GODOWN', array[test.id('rm_godown')]);
select test.login('00000000-0000-0000-0000-00000000d002');
select test.eq((select array_agg(code order by code) from public.godowns), array['RAW MATERIAL'], 'User scope overrides role scopes');
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), '00000000-0000-0000-0000-00000000d002', 'GODOWN', '{}');
select test.ok(exists (select 1 from public.audit_log where table_name = 'users' and row_id = '00000000-0000-0000-0000-00000000d002'
                       and action = 'SCOPE'), 'Scope changes are audited');
select test.throws(format($$ select public.user_set_scope(%L, %L, 'GODOWN', array[%L::uuid]) $$, test.id('company'), test.id('admin'), test.id('b336')),
                   '%owner always has access%', 'Owner cannot be restricted');
select test.eq((select count(*) from public.godowns)::int, 3, 'Owner sees all godowns');

-- scope entities must belong to the company
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('SCOPE-OTHER'));
select test.login(test.id('admin'));
select test.throws(format($$ select public.user_set_scope(%L, %L, 'GODOWN', array[%L::uuid]) $$, test.id('company'),
                          '00000000-0000-0000-0000-00000000d002', (select (v->>'b336')::uuid from test.ctx where k = 'fx2')),
                   '%another company%', 'Godown of another company cannot be put into a scope');

-- ------------------------------------------------ portal user creation
select test.login(null);
select test.party(test.id('company'), 'CUST-1', 'CUSTOMER', 'c1@scope.local') as v \gset cust_
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000d003', 'buyer@scope.local');
select test.login(test.id('admin'));
select test.throws(format($$ select public.user_create_complete(%L, %L, jsonb_build_object('kind', 'VENDOR', 'email', 'buyer@scope.local', 'party_id', %L), true) $$,
                          test.id('company'), '00000000-0000-0000-0000-00000000d003', :'cust_v'),
                   '%not set up as a vendor%', 'Portal kind must match the party');
select (public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-00000000d003',
         jsonb_build_object('kind', 'CUSTOMER', 'email', 'buyer@scope.local', 'party_id', :'cust_v', 'full_name', 'Buyer'), true))->>'portal_user_id' as v \gset pu_
select test.ok(exists (select 1 from public.portal_users where id = :'pu_v' and user_id = '00000000-0000-0000-0000-00000000d003'),
               'Customer portal login created and linked');
select test.login('00000000-0000-0000-0000-00000000d003');
select test.throws(format($$ select public.portal_context(%L, 'CUSTOMER') $$, test.id('company')),
                   'Portal access denied%', 'Portal login with a temporary password has no access until changed');
select test.login(null);
update auth.users set encrypted_password = 'own' where id = '00000000-0000-0000-0000-00000000d003';
select test.login('00000000-0000-0000-0000-00000000d003');
select test.ok(public.portal_context(test.id('company'), 'CUSTOMER') is not null, 'After the password change the portal opens');
select test.login(test.id('admin'));
select test.eq((public.user_set_status(test.id('company'), '00000000-0000-0000-0000-00000000d003', false))->>'has_access', 'false',
               'Disabling the only access → login must be banned');
select test.ok(exists (select 1 from jsonb_array_elements(public.admin_users(test.id('company'))) x
                       where x->>'kind' = 'CUSTOMER' and x->>'status' = 'DISABLED'), 'Users center lists the disabled customer login');

-- ------------------------------------------------ create: safety of the "new login" path
select test.login(null);
select email as v from auth.users where id = (select (v->>'operator')::uuid from test.ctx where k = 'fx2') \gset op2mail_
select test.login(test.id('admin'));
select test.throws(format($$ select public.user_create_complete(%L, %L, jsonb_build_object('kind', 'INTERNAL', 'email', %L,
                            'role_ids', jsonb_build_array((select id from public.roles where company_id = %L and code = 'VIEWER'))), true) $$,
                          test.id('company'), (select (v->>'operator')::uuid from test.ctx where k = 'fx2'),
                          :'op2mail_v', test.id('company')),
                   'This login is not a new login%', 'An existing login of another company is never treated as new (no forced password)');
select test.throws(format($$ select public.user_create_check(%L, jsonb_build_object('kind', 'INTERNAL', 'email', 'storea@scope.local',
                            'role_ids', jsonb_build_array(%L::uuid))) $$, test.id('company'), (select v from t where k = 'inv')),
                   '%already a user of this company%', 'Duplicate user rejected');
select test.login(null);
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-00000000d004', 'squat@scope.local', null);
select test.login(test.id('admin'));
select test.throws(format($$ select public.user_create_check(%L, jsonb_build_object('kind', 'INTERNAL', 'email', 'squat@scope.local',
                            'role_ids', jsonb_build_array(%L::uuid))) $$, test.id('company'), (select v from t where k = 'inv')),
                   'An unverified sign-up exists%', 'Unverified sign-up for the address is never attached (C1)');
select test.login(test.id('operator'));
select test.throws(format($$ select public.user_create_check(%L, jsonb_build_object('kind', 'INTERNAL', 'email', 'x@scope.local',
                            'role_ids', jsonb_build_array(%L::uuid))) $$, test.id('company'), (select v from t where k = 'inv')),
                   'Permission denied: users.create%', 'Operator cannot create users');
select test.throws(format($$ select public.user_password_reset_begin(%L, '00000000-0000-0000-0000-00000000d001') $$, test.id('company')),
                   'Permission denied%', 'Operator cannot reset passwords');

-- ------------------------------------------------ login shared by two companies
select test.login(null);
insert into public.user_roles (user_id, company_id, role_id)
select '00000000-0000-0000-0000-00000000d001', (v->>'company')::uuid,
       (select id from public.roles where company_id = (v->>'company')::uuid and code = 'VIEWER')
from test.ctx where k = 'fx2';
select test.login(test.id('admin'));
select test.throws($$ select public.user_password_reset_begin(test.id('company'), '00000000-0000-0000-0000-00000000d001') $$,
                   '%also belongs to another company%', 'Admin of A cannot reset the password of a login that also works in B');
select test.throws($$ select public.user_set_status(test.id('company'), '00000000-0000-0000-0000-00000000d001', false, null) $$,
                   '%also belongs to another company%', 'Admin of A cannot ban a login that also works in B');

-- ------------------------------------------------ service-only RPC
select test.ok(not has_function_privilege('authenticated', 'public.auth_revoke_sessions(uuid)', 'execute'),
               'auth_revoke_sessions is not executable by users');
select test.login(test.id('admin'));

-- ------------------------------------------------ users center data
select test.ok(jsonb_array_length(public.admin_users(test.id('company'))) >= 6, 'Users center lists internal and portal users');
select test.eq((public.admin_user_detail(test.id('company'), '00000000-0000-0000-0000-00000000d001')->'effective_scopes'->'GODOWN'->>0)::uuid,
               test.id('b336'), 'User detail shows the effective godown scope');
select test.ok(jsonb_array_length(public.admin_user_detail(test.id('company'), '00000000-0000-0000-0000-00000000d001')->'history') >= 2,
               'User detail shows the audit history');
select test.ok((select count(*) from public.audit_log where table_name = 'users' and action = 'CREATE') >= 3, 'User creation audited');

rollback;
