-- =============================================================================
-- PLATFORM R3 — settings sections (Owner vs Admin), module enable / disable
-- (D6), customers / vendors split, documents.download / share, catalogue
-- clean-up, behaviour preserved by the backfill.
-- AC 1.1–1.9, 7.1–7.3, 7.5
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('R3CAT-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'C1', 'CUSTOMER') as v \gset c1_
select test.party(test.id('company'), 'V1', 'SUPPLIER') as v \gset v1_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 50);
select test.user_with_role(test.id('company'), 'ADMIN') as v \gset adm_

-- roles with exact rights (owner creates them through the API)
select test.login(test.id('admin'));
insert into t values ('email_only', public.role_save(test.id('company'), null, '{"code":"EMAIL_ADMIN","name":"Email admin"}'));
select public.role_set_permissions((select v from t where k = 'email_only'), array['settings_email.view', 'settings_email.edit']);
insert into t values ('cust_only', public.role_save(test.id('company'), null, '{"code":"CUST_ONLY","name":"Customers only"}'));
select public.role_set_permissions((select v from t where k = 'cust_only'), array['customers.view', 'customers.edit', 'customers.export']);
insert into t values ('doc_view', public.role_save(test.id('company'), null, '{"code":"DOC_VIEW","name":"Documents view"}'));
select public.role_set_permissions((select v from t where k = 'doc_view'), array['documents.view']);
select test.login(null);
select test.user_with_role(test.id('company'), 'EMAIL_ADMIN') as v \gset em_
select test.user_with_role(test.id('company'), 'CUST_ONLY') as v \gset co_
select test.user_with_role(test.id('company'), 'DOC_VIEW') as v \gset dv_

-- ------------------------------------------------------------ catalogue
select test.ok((select count(*) = 30 from public.permissions where module like 'settings\_%'), '15 settings sections × view / edit');
select test.ok((select count(*) = 12 from public.permissions where module in ('customers', 'vendors')), 'customers.* and vendors.* exist');
select test.ok(exists (select 1 from public.permissions where code = 'documents.download')
               and exists (select 1 from public.permissions where code = 'documents.share')
               and exists (select 1 from public.permissions where code = 'audit.export'), 'documents.download / share, audit.export');
select test.ok((select bool_and(not is_active) from public.permissions where code in ('audit.create', 'reports.edit', 'settings.cancel', 'settings.edit')),
               'No-effect permissions are hidden');
-- AC-7.5: no hidden permission is referenced by any policy or function
select test.eq((select string_agg(p.code, ',') from public.permissions p
                where not p.is_active
                  and (exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                               where n.nspname in ('public', 'app', 'secure') and position('''' || p.code || '''' in f.prosrc) > 0)
                       or exists (select 1 from pg_policies x where position('''' || p.code || '''' in coalesce(x.qual, '') || coalesce(x.with_check, '')) > 0))),
               null, 'Hidden permissions are not used by policies or functions');
select test.login(test.id('admin'));
select test.throws(format($$ select public.role_set_permissions(%L, array['audit.create']) $$, (select v from t where k = 'email_only')),
                   '%not available%', 'A hidden permission cannot be granted');

-- ------------------------------------------------------------ backfill (AC-1.5)
select test.ok((select bool_and(exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_code = 'settings_numbering.edit'))
                from public.roles r where r.company_id = test.id('company') and r.code = 'ADMIN'), 'ADMIN keeps every settings section (from settings.edit)');
select test.ok(exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
                       where r.company_id = test.id('company') and r.code = 'ADMIN' and rp.permission_code = 'customers.edit')
               and exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
                           where r.company_id = test.id('company') and r.code = 'ADMIN' and rp.permission_code = 'vendors.edit'),
               'parties.edit holders get customers.edit and vendors.edit');

-- ------------------------------------------------------------ settings sections (AC-1.1, 1.2, 1.6)
select test.login(:'em_v');
select public.settings_save(test.id('company'), 'email', '{"email_automation": true}');
select test.ok((select email_automation from public.company_settings where company_id = test.id('company')), 'E-mail section saved by the e-mail admin');
select test.throws(format($$ select public.settings_save(%L, 'security', '{"password_min_length": 12}') $$, test.id('company')),
                   '%settings_security.edit%', 'Security section refused by RPC');
select test.throws(format($$ update public.company_settings set allow_negative_stock = true where company_id = %L $$, test.id('company')),
                   '%settings_inventory.edit%', 'Direct API update of another section refused');
select test.ok((public.settings_get(test.id('company')) ? 'email') and not (public.settings_get(test.id('company')) ? 'security'),
               'settings_get returns only the viewable sections');
select test.login(test.id('admin'));
select test.ok(exists (select 1 from public.audit_log where company_id = test.id('company') and table_name = 'company_settings'
                       and action = 'SETTINGS' and actor_id = :'em_v'), 'Settings change audited with the actor');
-- owner removes a section from ADMIN: effective at once (AC-1.2)
select public.role_set_permissions(r.id, array(select permission_code from public.role_permissions where role_id = r.id
                                               and permission_code <> 'settings_numbering.edit' and permission_code in (select code from public.permissions where is_active)))
from public.roles r where r.company_id = test.id('company') and r.code = 'ADMIN';
select test.login(:'adm_v');
select test.throws(format($$ select public.sequence_save(%L, 'SALES_ORDER', '{"prefix":"X-"}') $$, test.id('company')),
                   '%settings_numbering.edit%', 'Admin without the numbering section cannot change numbering');
select public.settings_save(test.id('company'), 'email', '{"email_automation": false}');

-- ------------------------------------------------------------ modules (AC-1.3, 1.4, 1.7, 1.8, 1.9)
select test.login(test.id('admin'));
insert into t values ('po', public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date,
  'party_id', :'v1_v', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'), 'rate', 10)))));
select test.throws(format($$ select public.module_set(%L, 'ADMINISTRATION', false) $$, test.id('company')), '%always on%', 'Core module cannot be disabled');
select test.throws(format($$ select public.module_set(%L, 'MASTERS', false) $$, test.id('company')), '%always on%', 'Masters cannot be disabled');
select public.module_set(test.id('company'), 'PURCHASE', false);
select test.ok(exists (select 1 from public.audit_log where table_name = 'company_modules' and action = 'DISABLE'), 'Module change audited');
select test.login(:'adm_v');
select test.eq((select count(*) from public.purchase_orders where company_id = test.id('company'))::int, 0, 'Disabled module: REST read returns nothing');
select test.throws(format($$ select public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', %L, 'doc_date', current_date, 'party_id', %L, 'lines', '[]'::jsonb)) $$,
                          test.id('company'), :'v1_v'), '%purchase_order.create%', 'Disabled module: document action refused');
select test.ok(not ('purchase_order.view' = any (array(select public.my_permissions(test.id('company'))))), 'Disabled module: permission gone from my_permissions');
select test.login(test.id('admin'));
select test.eq((select count(*) from public.purchase_orders where company_id = test.id('company'))::int, 0, 'Also the owner (module off for everyone)');
select test.ok((select bool_or(x->>'code' = 'PURCHASE' and not (x->>'is_enabled')::boolean) from jsonb_array_elements(public.company_modules_list(test.id('company'))) x),
               'Owner still sees the Modules list (recovery path)');
-- import / export module
select public.module_set(test.id('company'), 'IMPORT_EXPORT', false);
select test.throws(format($$ select public.export_rows(%L, 'ITEMS') $$, test.id('company')), '%items.export%', 'Export refused while Import / Export is off');
select test.throws(format($$ select public.import_create(%L, 'ITEMS', 'x', 'ALL_OR_NOTHING', false, array['code']) $$, test.id('company')),
                   '%items.import%', 'Import refused while Import / Export is off');
select public.module_set(test.id('company'), 'IMPORT_EXPORT', true);
select public.module_set(test.id('company'), 'PURCHASE', true);
select test.eq((select count(*) from public.purchase_orders where company_id = test.id('company'))::int, 1, 'Re-enabled: data back');
-- inventory module: reservation tables / transfer documents
select public.module_set(test.id('company'), 'INVENTORY', false);
select test.throws(format($$ select public.doc_save('STOCK_TRANSFER', jsonb_build_object('company_id', %L, 'doc_date', current_date, 'lines', '[]'::jsonb)) $$,
                          test.id('company')), '%stock_transfer.create%', 'Inventory off: transfers refused');
select public.module_set(test.id('company'), 'INVENTORY', true);
-- portal module
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');
select test.login(null);
select test.portal_user(test.id('company'), :'c1_v', 'CUSTOMER') as v \gset pu_
select test.login(test.id('admin'));
select public.module_set(test.id('company'), 'CUSTOMER_PORTAL', false);
select test.login(:'pu_v');
select test.throws(format($$ select public.portal_catalog(%L, null) $$, test.id('company')), '%portal module is not enabled%', 'Portal RPC refused when the module is off');
select test.login(test.id('admin'));
select public.module_set(test.id('company'), 'CUSTOMER_PORTAL', true);
select test.login(:'pu_v');
select test.ok(public.portal_catalog(test.id('company'), null) is not null, 'Portal works again');

-- ------------------------------------------------------------ customers / vendors split (AC-7.1)
select test.login(:'co_v');
select test.ok(exists (select 1 from public.parties where id = :'c1_v'), 'Customer-only role sees customers');
select test.ok(not exists (select 1 from public.parties where id = :'v1_v'), 'Customer-only role does not see vendors');
select test.ok(not exists (select 1 from public.parties where id = test.id('aleem')), 'Job workers are vendors: hidden too');
select test.throws(format($$ select public.party_save(%L, %L, '{"name":"X"}') $$, test.id('company'), :'v1_v'), '%vendors.edit%',
                   'Vendor cannot be edited by a customer-only role');
select public.party_save(test.id('company'), :'c1_v', '{"notes":"ok"}');
select test.ok((select bool_and(x ? 'code') from jsonb_array_elements(public.export_rows(test.id('company'), 'CUSTOMERS')) x), 'Customers export allowed');
select test.throws(format($$ select public.export_rows(%L, 'VENDORS') $$, test.id('company')), '%vendors.export%', 'Vendors export refused');

-- ------------------------------------------------------------ documents.download / share (AC-7.3)
select test.login(:'dv_v');
select test.ok(not app.storage_can_read(test.id('company') || '/party/file.pdf'), 'documents.view without download: file refused');
select test.login(test.id('admin'));
select test.ok(app.storage_can_read(test.id('company') || '/party/file.pdf'), 'Owner downloads');
rollback;
