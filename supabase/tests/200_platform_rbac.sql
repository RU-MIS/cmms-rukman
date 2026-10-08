-- =============================================================================
-- PLATFORM R1 — configurable authorization engine
--   catalogue as data · existing roles unchanged · role builder (create,
--   clone, permissions, disable, delete) · overrides ALLOW / DENY · no
--   privilege escalation · owner protection · disabled user / temporary
--   password block every access · audit of security changes.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('RBAC-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- ------------------------------------------------ catalogue is data
select test.login(null);
select test.ok((select count(*) from public.permission_modules) >= 30, 'Permission modules are stored in the database');
select test.ok(exists (select 1 from public.permissions where code = 'users.reset_password' and is_sensitive),
               'Fine-grained permission users.reset_password exists');
select test.ok(not exists (select 1 from public.permissions where code in ('items.upload', 'sales_order.reset', 'voucher.view_field')),
               'Seed generates only the seven base actions per module (no permission explosion)');
select test.ok((select count(*) from public.roles where company_id = test.id('company')) >= 11,
               'Default roles seeded (OWNER, ADMIN, MANAGER, SALES, PURCHASE, INVENTORY, ACCOUNTANT, FACTORY, VIEWER, …)');
select test.ok((select grants_all and is_locked from public.roles where company_id = test.id('company') and code = 'OWNER'),
               'OWNER role is locked and grants everything');

-- ------------------------------------------------ existing behaviour of default roles
select test.ok(app.user_has_permission(test.id('operator'), test.id('company'), 'items.create'), 'Operator can still create items');
select test.ok(not app.user_has_permission(test.id('operator'), test.id('company'), 'items.delete'), 'Operator still cannot delete items');
select test.ok(not app.user_has_permission(test.id('operator'), test.id('company'), 'users.reset_password'), 'Operator has no user administration');
select test.ok(app.user_has_permission(test.id('approver'), test.id('company'), 'purchase_order.approve'), 'Approver still approves');
select test.ok(not app.user_has_permission(test.id('approver'), test.id('company'), 'roles.edit'), 'Approver cannot edit roles');
select test.user_with_role(test.id('company'), 'ADMIN') as v \gset adm_
select test.ok(app.user_has_permission(:'adm_v', test.id('company'), 'users.reset_password'), 'Admin can reset passwords by default');
select test.ok(not app.user_has_permission(:'adm_v', test.id('company'), 'users.manage_owners'), 'Admin cannot manage owners by default');
select test.ok(app.user_has_permission(test.id('admin'), test.id('company'), 'users.manage_owners'), 'Owner can manage owners');
select test.ok(app.user_has_permission(test.id('admin'), test.id('company'), 'any.future_permission'),
               'Owner holds every permission, also future ones');

-- seed-once: re-running the company setup does not revert admin edits
select test.login(test.id('admin'));
select public.role_set_permissions((select id from public.roles where company_id = test.id('company') and code = 'VIEWER'),
                                   array['items.view']);
select test.login(null);
select app.init_company(test.id('company'));
select test.eq((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
                where r.company_id = test.id('company') and r.code = 'VIEWER')::int, 1,
               'Seed-once: company setup no longer re-applies default grants over admin edits');

-- ------------------------------------------------ role builder
select test.login(test.id('admin'));
insert into t values ('store', public.role_save(test.id('company'), null,
  jsonb_build_object('code', 'STORE_A', 'name', 'Store executive', 'description', 'Store of Godown A')));
select public.role_set_permissions((select v from t where k = 'store'),
  array['items.view', 'godowns.view', 'stock_adjustment.view', 'stock_adjustment.create', 'stock_transfer.view', 'stock_transfer.create']);
select test.eq((select count(*) from public.role_permissions where role_id = (select v from t where k = 'store'))::int, 6,
               'Custom role created with permissions from the matrix');
insert into t values ('store2', public.role_clone((select v from t where k = 'store'), 'STORE_B', 'Store B'));
select test.eq((select count(*) from public.role_permissions where role_id = (select v from t where k = 'store2'))::int, 6,
               'Cloned role has the same permissions');
select test.eq((select copied_from from public.roles where id = (select v from t where k = 'store2')), (select v from t where k = 'store'),
               'Clone remembers its source');
select test.throws($$ select public.role_save((select company_id from public.roles limit 0), null, '{"code":"x"}') $$,
                   '%', 'Role without company is rejected');
select test.throws(format($$ select public.role_save(%L, null, '{"code":"STORE_A"}') $$, test.id('company')),
                   '%already exists%', 'Duplicate role code rejected');
-- direct table writes are not possible (only audited RPCs)
select test.throws(format($$ insert into public.roles (company_id, code, name) values (%L, 'HACK', 'Hack') $$, test.id('company')),
                   '%permission denied%', 'Roles cannot be inserted directly through the API');
select test.throws(format($$ insert into public.role_permissions values (%L, 'users.manage_owners') $$, (select v from t where k = 'store')),
                   '%permission denied%', 'Role permissions cannot be written directly through the API');

-- assign the role → user gets exactly these rights
select test.login(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c001', 'store@rbac.local');
select test.login(test.id('admin'));
select test.eq((public.user_create_check(test.id('company'), jsonb_build_object('kind', 'INTERNAL', 'email', 'store@rbac.local',
                 'role_ids', jsonb_build_array((select v from t where k = 'store')))))->>'existing_user_id',
               '00000000-0000-0000-0000-00000000c001', 'Create check finds the new login');
select public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-00000000c001',
  jsonb_build_object('kind', 'INTERNAL', 'email', 'store@rbac.local', 'full_name', 'Store Keeper', 'department', 'Stores',
                     'role_ids', jsonb_build_array((select v from t where k = 'store'))), false);
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok((select array_agg(c order by c) from public.my_permissions(test.id('company')) c)
               = array['godowns.view', 'items.view', 'stock_adjustment.create', 'stock_adjustment.view', 'stock_transfer.create', 'stock_transfer.view'],
               'my_permissions returns exactly the role permissions');
select test.ok(not app.has_permission(test.id('company'), 'stock_adjustment.approve'), 'Permission not in the role is denied');

-- permission change takes effect immediately, without code change
select test.login(test.id('admin'));
select public.role_set_permissions((select v from t where k = 'store'),
  array['items.view', 'godowns.view', 'stock_adjustment.view', 'stock_adjustment.create', 'stock_adjustment.approve',
        'stock_transfer.view', 'stock_transfer.create']);
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(app.has_permission(test.id('company'), 'stock_adjustment.approve'), 'Added permission is effective immediately');

-- overrides: DENY beats the role, ALLOW adds
select test.login(test.id('admin'));
select public.user_set_overrides(test.id('company'), '00000000-0000-0000-0000-00000000c001',
  '[{"permission_code":"stock_adjustment.approve","effect":"DENY","reason":"no approvals"},
    {"permission_code":"parties.view","effect":"ALLOW"}]'::jsonb);
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(not app.has_permission(test.id('company'), 'stock_adjustment.approve'), 'DENY override removes a role permission');
select test.ok(app.has_permission(test.id('company'), 'parties.view'), 'ALLOW override adds a permission');
select test.ok(not exists (select 1 from public.my_permissions(test.id('company')) c where c = 'stock_adjustment.approve'),
               'my_permissions reflects DENY');

-- disabled role → its permissions are gone
select test.login(test.id('admin'));
select public.role_save(test.id('company'), (select v from t where k = 'store'), '{"is_active": false}');
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(not app.has_permission(test.id('company'), 'items.view'), 'Disabled role grants nothing');
select test.ok(app.has_permission(test.id('company'), 'parties.view'), 'ALLOW override still applies');
select test.login(test.id('admin'));
select public.role_save(test.id('company'), (select v from t where k = 'store'), '{"is_active": true}');
select test.throws(format($$ select public.role_delete(%L) $$, (select v from t where k = 'store')),
                   '%assigned to 1 user%', 'A role in use cannot be deleted');
select public.role_delete((select v from t where k = 'store2'));
select test.ok(not exists (select 1 from public.roles where id = (select v from t where k = 'store2')), 'Unused role deleted');

-- ------------------------------------------------ privilege escalation
-- A "user admin" may manage users / roles but holds no settings rights.
select test.login(test.id('admin'));
insert into t values ('uadmin', public.role_save(test.id('company'), null, '{"code":"USER_ADMIN","name":"User admin"}'));
select public.role_set_permissions((select v from t where k = 'uadmin'),
  array['users.view', 'users.create', 'users.edit', 'users.assign_role', 'users.assign_permissions', 'users.assign_scope',
        'users.disable', 'users.reset_password', 'roles.view', 'roles.create', 'roles.edit', 'items.view']);
select test.login(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c002', 'uadmin@rbac.local');
select test.login(test.id('admin'));
select public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-00000000c002',
  jsonb_build_object('kind', 'INTERNAL', 'email', 'uadmin@rbac.local', 'role_ids', jsonb_build_array((select v from t where k = 'uadmin'))), false);
select test.login('00000000-0000-0000-0000-00000000c002');
select test.throws(format($$ select public.role_set_permissions(%L, array['items.view', 'settings.edit']) $$, (select v from t where k = 'store')),
                   'You cannot grant the permission settings.edit%', 'Cannot add a permission to a role that you do not hold');
select test.throws(format($$ select public.user_set_overrides(%L, %L, '[{"permission_code":"settings.edit","effect":"ALLOW"}]') $$,
                          test.id('company'), '00000000-0000-0000-0000-00000000c001'),
                   'You cannot grant the permission settings.edit%', 'Cannot ALLOW a permission that you do not hold');
select test.throws(format($$ select public.user_set_roles(%L, %L, array[(select id from public.roles where company_id = %L and code = 'ADMIN')]) $$,
                          test.id('company'), '00000000-0000-0000-0000-00000000c001', test.id('company')),
                   'You cannot grant the permission%', 'Cannot assign a role with more rights than you have');
select test.throws(format($$ insert into public.user_roles values (%L, %L, (select id from public.roles where company_id = %L and code = 'ADMIN')) $$,
                          '00000000-0000-0000-0000-00000000c001', test.id('company'), test.id('company')),
                   'You cannot grant the permission%', 'Direct API insert into user_roles gets the same escalation check');
select test.throws(format($$ select public.user_set_overrides(%L, %L, '[{"permission_code":"settings.edit","effect":"ALLOW"}]') $$,
                          test.id('company'), '00000000-0000-0000-0000-00000000c002'),
                   '%your own permissions%', 'Cannot change own overrides');
select test.throws(format($$ select public.user_set_roles(%L, %L, array[%L::uuid, %L::uuid]) $$, test.id('company'),
                          '00000000-0000-0000-0000-00000000c002', (select v from t where k = 'uadmin'), (select v from t where k = 'store')),
                   '%your own roles%', 'Cannot change own roles');
select test.throws(format($$ select public.role_clone(%L, 'ADM2', 'Admin copy') $$,
                          (select id from public.roles where company_id = test.id('company') and code = 'ADMIN')),
                   'You cannot grant the permission%', 'Cannot clone a role with more rights than you have');
-- permissions the user admin holds can be handed out
select public.user_set_overrides(test.id('company'), '00000000-0000-0000-0000-00000000c001',
  '[{"permission_code":"items.view","effect":"ALLOW"}]'::jsonb);
select test.ok(exists (select 1 from public.user_permission_overrides where user_id = '00000000-0000-0000-0000-00000000c001'
                       and permission_code = 'items.view'), 'Permission held by the admin can be granted');

-- ------------------------------------------------ owner protection
select test.throws(format($$ select public.role_save(%L, (select id from public.roles where company_id = %L and code = 'OWNER'), '{"name":"x"}') $$,
                          test.id('company'), test.id('company')),
                   '%', 'Non-owner cannot touch the owner role');
select test.throws(format($$ select public.user_set_roles(%L, %L, array[(select v from t where k = 'store')]) $$,
                          test.id('company'), test.id('admin')),
                   'Only an owner can change an owner%', 'Non-owner cannot change the roles of an owner');
select test.throws(format($$ select public.user_set_status(%L, %L, false) $$, test.id('company'), test.id('admin')),
                   'Only an owner can manage the login of an owner%', 'Non-owner cannot disable an owner');
select test.throws(format($$ select public.user_password_reset_begin(%L, %L) $$, test.id('company'), test.id('admin')),
                   'Only an owner can manage the login of an owner%', 'Non-owner cannot reset the password of an owner');
select test.login(test.id('admin'));
select test.throws(format($$ select public.role_set_permissions((select id from public.roles where company_id = %L and code = 'OWNER'), array['items.view']) $$,
                          test.id('company')), '%always has every permission%', 'Owner role permissions cannot be reduced');
select test.throws(format($$ select public.role_delete((select id from public.roles where company_id = %L and code = 'OWNER')) $$,
                          test.id('company')), '%protected%', 'Owner role cannot be deleted');
select test.throws(format($$ select public.role_save(%L, (select id from public.roles where company_id = %L and code = 'OWNER'), '{"is_active":false}') $$,
                          test.id('company'), test.id('company')), '%protected%', 'Owner role cannot be disabled');
select test.throws(format($$ select public.user_set_overrides(%L, %L, '[{"permission_code":"items.view","effect":"DENY"}]') $$,
                          test.id('company'), test.id('admin')), '%always has every permission%', 'No overrides on an owner');
select test.throws(format($$ select public.user_set_status(%L, %L, false) $$, test.id('company'), test.id('admin')),
                   '%My account%', 'Owner cannot disable their own login');
select test.throws(format($$ delete from public.user_roles where user_id = %L and role_id = (select id from public.roles where company_id = %L and code = 'OWNER') $$,
                          test.id('admin'), test.id('company')), '%at least one owner%', 'Last owner cannot be removed (M1 still holds)');
select public.role_save(test.id('company'), (select id from public.roles where company_id = test.id('company') and code = 'OWNER'),
                        '{"name":"Proprietor"}');
select test.eq((select name from public.roles where company_id = test.id('company') and code = 'OWNER'), 'Proprietor',
               'Owner may rename the owner role (labels are configuration)');

-- ------------------------------------------------ disabled user / temporary password
select public.user_set_status(test.id('company'), '00000000-0000-0000-0000-00000000c001', false, 'left the company');
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(not app.has_permission(test.id('company'), 'items.view'), 'Disabled user: no permission');
select test.ok(not app.is_member(test.id('company')), 'Disabled user: not a member (RLS reads denied)');
select test.eq((select count(*) from public.items)::int, 0, 'Disabled user reads no company data');
select test.eq((select count(*) from public.my_permissions(test.id('company')))::int, 0, 'Disabled user: empty permission list');
select test.eq(jsonb_array_length(public.session_bootstrap()->'companies'), 0, 'Disabled company is not offered after login');
select test.login(test.id('admin'));
select test.eq((public.user_set_status(test.id('company'), '00000000-0000-0000-0000-00000000c001', true))->>'has_access', 'true',
               'Enable again → login keeps access (no ban)');
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(app.has_permission(test.id('company'), 'items.view'), 'Enabled user has access again');

select test.login(null);
update public.profiles set must_change_password = true where id = '00000000-0000-0000-0000-00000000c001';
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(not app.has_permission(test.id('company'), 'items.view'), 'Temporary password not changed yet: no access');
select test.eq((public.session_bootstrap()->>'must_change_password'), 'true', 'Bootstrap tells the app to force the change');
select test.throws($$ update public.profiles set must_change_password = false where id = auth.uid() $$,
                   '%permission denied%', 'Users cannot clear the flag themselves');
select test.login(null);
update auth.users set encrypted_password = 'new-hash' where id = '00000000-0000-0000-0000-00000000c001';
select test.login('00000000-0000-0000-0000-00000000c001');
select test.ok(app.has_permission(test.id('company'), 'items.view'), 'Own password change clears the flag → access');

-- administrator reset → next password is temporary again
select test.login(test.id('admin'));
select public.user_password_reset_begin(test.id('company'), '00000000-0000-0000-0000-00000000c001');
select test.login(null);
update auth.users set encrypted_password = 'temp-hash' where id = '00000000-0000-0000-0000-00000000c001';
select test.ok((select must_change_password from public.profiles where id = '00000000-0000-0000-0000-00000000c001'),
               'Password set by the administrator is temporary (must change)');

-- ------------------------------------------------ audit of security changes
select test.ok((select count(*) from public.audit_log where company_id = test.id('company') and table_name = 'roles'
                and action in ('CREATE', 'CLONE', 'PERMISSIONS', 'UPDATE', 'DELETE')) >= 6, 'Role changes are audited');
select test.ok(exists (select 1 from public.audit_log where table_name = 'users' and row_id = '00000000-0000-0000-0000-00000000c001'
                       and action = 'OVERRIDES'), 'Overrides are audited');
select test.ok(exists (select 1 from public.audit_log where table_name = 'users' and row_id = '00000000-0000-0000-0000-00000000c001'
                       and action = 'ROLE_ADD'), 'Role assignment is audited');
select test.ok(exists (select 1 from public.audit_log where table_name = 'users' and row_id = '00000000-0000-0000-0000-00000000c001'
                       and action = 'DISABLE' and new_data->>'reason' = 'left the company'), 'Disable is audited with reason');
select test.ok(exists (select 1 from public.audit_log where table_name = 'users' and action = 'PASSWORD_RESET'
                       and new_data::text not like '%temp-hash%'), 'Password reset is audited without the password');

-- ------------------------------------------------ cross-company
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('RBAC-OTHER'));
select test.login(test.id('admin'));
select test.throws(format($$ select public.admin_users(%L) $$, (select (v->>'company')::uuid from test.ctx where k = 'fx2')),
                   'Unknown company%', 'Admin of A cannot list users of B');
select test.throws(format($$ select public.user_set_roles(%L, %L, array[(select v from t where k = 'store')]) $$,
                          test.id('company'), (select (v->>'operator')::uuid from test.ctx where k = 'fx2')),
                   'User not found%', 'Admin of A cannot change a user of B');
select test.throws(format($$ select public.user_set_roles(%L, %L, array[(select id from public.roles where company_id = %L and code = 'VIEWER')]) $$,
                          test.id('company'), '00000000-0000-0000-0000-00000000c001', (select (v->>'company')::uuid from test.ctx where k = 'fx2')),
                   'Unknown role%', 'Role of another company cannot be assigned');
select test.throws(format($$ select public.role_set_permissions((select id from public.roles where company_id = %L and code = 'VIEWER'), array['items.view']) $$,
                          (select (v->>'company')::uuid from test.ctx where k = 'fx2')),
                   'Role not found%', 'Role of another company cannot be edited');

-- company.create is a permission, not a role name
select test.login(:'adm_v');
select test.ok(public.create_company('{"code":"RBAC-NEW","legal_name":"New Co"}') is not null,
               'Admin (company.create) creates a company and becomes its owner');
select test.login(test.id('operator'));
select test.throws($$ select public.create_company('{"code":"RBAC-NO","legal_name":"No"}') $$, '%Only an owner%',
                   'Without company.create no company can be created');

rollback;
