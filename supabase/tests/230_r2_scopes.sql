-- =============================================================================
-- PLATFORM R2 — CUSTOMER / VENDOR / ITEM data scopes (all, selected, none),
-- enforced by RLS and by the posting RPCs; party master save; registry
-- completeness; scoped export.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('SCOPE2-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'CA', 'CUSTOMER') as v \gset ca_
select test.party(test.id('company'), 'CB', 'CUSTOMER') as v \gset cb_
select test.party(test.id('company'), 'VA', 'SUPPLIER') as v \gset va_
select test.party(test.id('company'), 'VB', 'SUPPLIER') as v \gset vb_
select test.party(test.id('company'), 'TR', 'TRANSPORTER') as v \gset tr_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 100);
select test.stock_in(test.id('company'), test.id('fg2'), test.id('b336'), 100);
select test.user_with_role(test.id('company'), 'MANAGER') as v \gset u_
-- documents of every party (owner)
select test.login(test.id('admin'));
create or replace function pg_temp.so(p_party uuid, p_item uuid) returns uuid language sql as $$
  select public.doc_save('SALES_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date, 'party_id', p_party, 'customer_po_no', 'PO-X',
    'lines', jsonb_build_array(jsonb_build_object('item_id', p_item, 'qty', 1, 'unit_id', test.id('pair'), 'rate', 10)))) $$;
create or replace function pg_temp.po(p_party uuid, p_item uuid) returns uuid language sql as $$
  select public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date, 'party_id', p_party,
    'lines', jsonb_build_array(jsonb_build_object('item_id', p_item, 'qty', 1, 'unit_id', test.id('pair'), 'rate', 10)))) $$;
insert into t values ('so_a', pg_temp.so(:'ca_v', test.id('fg'))), ('so_b', pg_temp.so(:'cb_v', test.id('fg'))),
                     ('po_a', pg_temp.po(:'va_v', test.id('fg'))), ('po_b', pg_temp.po(:'vb_v', test.id('fg'))),
                     ('so_fg2', pg_temp.so(:'ca_v', test.id('fg2')));

-- ------------------------------------------------ registry completeness
select test.login(null);
select test.eq((select string_agg(c.table_name, ',') from information_schema.columns c
                join information_schema.tables x on x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
                where c.table_schema = 'public' and c.column_name = 'party_id'
                  and c.table_name not in ('party_addresses', 'party_roles', 'party_settings')   -- follow the parties policy
                  and not exists (select 1 from app.data_scope_registry r where r.table_name = c.table_name and r.dimension <> 'ITEM')),
               null, 'Every table with a party is in the scope registry');
select test.eq((select string_agg(c.table_name || '.' || c.column_name, ',') from information_schema.columns c
                join information_schema.tables x on x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
                where c.table_schema = 'public' and c.column_name like '%item_id'
                  and not exists (select 1 from app.data_scope_registry r where r.table_name = c.table_name and r.dimension = 'ITEM'
                                  and c.column_name = any (r.columns))),
               null, 'Every item column is in the scope registry');
select test.eq((select count(*) from app.data_scope_registry r where not exists (
                  select 1 from pg_policies p where p.tablename = r.table_name and p.policyname = r.table_name || '_' || lower(r.dimension) || '_scope'
                    and p.permissive = 'RESTRICTIVE'))::int, 0, 'Every registered table has its restrictive policy');

-- ------------------------------------------------ CUSTOMER scope: selected
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), :'u_v', 'CUSTOMER', array[:'ca_v'::uuid]);
select test.login(:'u_v');
select test.eq((select string_agg(code, ',' order by code) from public.parties), 'ALEEM,CA,MAJID,TR,VA,VB',
               'Customer scope: other customers hidden; vendors (unrestricted) and others visible');
select test.eq((select count(*) from public.sales_orders where id = (select v from t where k = 'so_b'))::int, 0, 'Sales order of customer B invisible');
select test.eq((select count(*) from public.sales_order_lines where order_id = (select v from t where k = 'so_b'))::int, 0, 'Its lines too');
select test.ok(exists (select 1 from public.sales_orders where id = (select v from t where k = 'so_a')), 'Sales order of customer A visible');
select test.throws(format($$ select pg_temp.so(%L, %L) $$, :'cb_v', test.id('fg')), 'Access denied: customer CB is outside your data scope%',
                   'Cannot create a sales order for customer B through the API');
select test.throws(format($$ select public.doc_submit('SALES_ORDER', %L) $$, (select v from t where k = 'so_b')), 'Access denied%',
                   'Cannot submit customer B''s order by id');
select test.throws(format($$ select public.sales_order_line_set_rate((select id from public.sales_order_lines where order_id = %L limit 1), 1, 'x') $$,
                          (select v from t where k = 'so_b')), '%', 'Cannot change a line of customer B''s order by id');
select test.ok(pg_temp.so(:'ca_v', test.id('fg')) is not null, 'Customer A: order can be created');
select test.ok(exists (select 1 from public.purchase_orders where id = (select v from t where k = 'po_b')), 'Purchase side unaffected');

-- ------------------------------------------------ CUSTOMER scope: none
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), :'u_v', 'CUSTOMER', array[app.scope_none()]);
select test.login(:'u_v');
select test.eq((select count(*) from public.parties p where exists (select 1 from public.party_roles r where r.party_id = p.id and r.role = 'CUSTOMER'))::int,
               0, 'No access: no customer visible');
select test.eq((select count(*) from public.sales_orders)::int, 0, 'No access: no sales order visible');
select test.login(test.id('admin'));
select test.throws(format($$ select public.user_set_scope(%L, %L, 'CUSTOMER', array[%L::uuid, %L::uuid]) $$, test.id('company'), :'u_v', app.scope_none(), :'ca_v'),
                   '"No access" cannot be combined%', 'No access cannot be mixed with records');
select test.throws(format($$ select public.user_set_scope(%L, %L, 'CUSTOMER', array[%L::uuid]) $$, test.id('company'), :'u_v', :'va_v'),
                   '%wrong type%', 'A vendor cannot be put into a customer scope');
select public.user_set_scope(test.id('company'), :'u_v', 'CUSTOMER', '{}');

-- ------------------------------------------------ VENDOR scope via role
insert into t values ('buyer', public.role_clone((select id from public.roles where company_id = test.id('company') and code = 'MANAGER'), 'BUYER_A', 'Buyer A'));
select public.role_set_scope((select v from t where k = 'buyer'), 'VENDOR', array[:'va_v'::uuid]);
select public.user_set_roles(test.id('company'), :'u_v', array[(select v from t where k = 'buyer')]);
select test.login(:'u_v');
select test.eq((select string_agg(code, ',' order by code) from public.parties), 'CA,CB,TR,VA', 'Role vendor scope: vendor B hidden');
select test.eq((select count(*) from public.purchase_orders where id = (select v from t where k = 'po_b'))::int, 0, 'PO of vendor B invisible');
select test.throws(format($$ select pg_temp.po(%L, %L) $$, :'vb_v', test.id('fg')), 'Access denied: vendor VB is outside%',
                   'Cannot create a PO for vendor B');
select test.throws(format($$ select public.purchase_order_print(%L) $$, (select v from t where k = 'po_b')), 'Access denied%', 'Cannot print the PO of vendor B');
select test.throws(format($$ select public.party_save(%L, %L, '{"name":"hack"}') $$, test.id('company'), :'vb_v'), 'Customer / vendor not found%',
                   'Cannot edit vendor B by id');
select test.throws(format($$ select public.party_save(%L, null, '{"code":"VNEW","name":"New","roles":["SUPPLIER"]}') $$, test.id('company')),
                   'Access denied: vendors outside%', 'Vendor-restricted user cannot create vendors');
select test.ok(public.party_save(test.id('company'), null, '{"code":"CNEW","name":"New customer","roles":["CUSTOMER"]}') is not null,
               'Customer side unrestricted: can create a customer');

-- ------------------------------------------------ ITEM scope
select test.login(test.id('admin'));
select public.user_set_roles(test.id('company'), :'u_v', array[(select id from public.roles where company_id = test.id('company') and code = 'MANAGER')]);
select public.user_set_scope(test.id('company'), :'u_v', 'ITEM', array[test.id('fg')]);
select test.login(:'u_v');
select test.eq((select string_agg(code, ',') from public.items), 'FG-4766', 'Item scope: only the assigned item');
select test.eq((select string_agg(item_code, ',') from public.v_inventory_items), 'FG-4766', 'Inventory list only the assigned item');
select test.eq((select count(distinct item_id) from public.stock_balances)::int, 1, 'Stock only of the assigned item');
select test.eq((select count(*) from public.sales_order_lines where order_id = (select v from t where k = 'so_fg2'))::int, 0,
               'Document lines of other items hidden');
select test.throws(format($$ select pg_temp.so(%L, %L) $$, :'ca_v', test.id('fg2')), 'Access denied: item FG-5012 is outside%',
                   'Cannot order an item outside the scope');
select test.eq((select count(*) from public.v_items)::int, 1, 'Masked item view respects the item scope');

-- ------------------------------------------------ scoped export never exceeds what the user sees
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), :'u_v', 'CUSTOMER', array[:'ca_v'::uuid]);
select test.login(:'u_v');
select test.eq((select string_agg(x->>'code', ',') from jsonb_array_elements(public.export_rows(test.id('company'), 'CUSTOMERS')) x),
               'CA', 'Customer export contains only the customers in scope');
select test.eq((select string_agg(x->>'code', ',') from jsonb_array_elements(public.export_rows(test.id('company'), 'ITEMS')) x),
               'FG-4766', 'Item export contains only the items in scope');

-- ------------------------------------------------ party master save
select test.login(test.id('admin'));
select public.custom_field_save(test.id('company'), null, '{"entity":"CUSTOMER","field_key":"segment","label":"Segment","field_type":"DROPDOWN","options":["RETAIL","DEALER"],"is_required":true}');
select test.throws(format($$ select public.party_save(%L, null, '{"code":"C9","name":"x","roles":["CUSTOMER"]}') $$, test.id('company')),
                   'Segment is required%', 'Required customer field enforced');
insert into t values ('c9', public.party_save(test.id('company'), null, '{"code":"c9","name":"Dealer Nine","roles":["CUSTOMER"],"contact_person":"Ram",
  "credit_limit":50000,"pincode":"110001","custom":{"segment":"DEALER"}}'));
select test.ok((select code = 'C9' and credit_limit = 50000 and custom->>'segment' = 'DEALER' from public.parties where id = (select v from t where k = 'c9')),
               'Customer created with contact, credit limit and custom field');
select public.party_save(test.id('company'), (select v from t where k = 'c9'), '{"is_active":false}');
select test.ok(not (select is_active from public.parties where id = (select v from t where k = 'c9')), 'Customer disabled');
select test.ok(public.party_save(test.id('company'), null, '{"code":"V9","name":"Vendor Nine","roles":["JOB_WORKER"]}') is not null,
               'Vendor (job worker) created; customer fields not required');
select test.ok(exists (select 1 from public.audit_log where table_name = 'parties' and row_id = (select v from t where k = 'c9')::text),
               'Customer changes audited');

-- ------------------------------------------------ cross-company
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('SCOPE2-OTHER'));
select test.login((select (v->>'admin')::uuid from test.ctx where k = 'fx2'));
select test.throws(format($$ select public.party_save(%L, %L, '{"name":"x"}') $$, test.id('company'), :'ca_v'), 'Unknown company%',
                   'Other company cannot edit our customer');
select test.throws(format($$ select public.user_set_scope(%L, %L, 'CUSTOMER', array[%L::uuid]) $$,
                          (select (v->>'company')::uuid from test.ctx where k = 'fx2'), (select (v->>'operator')::uuid from test.ctx where k = 'fx2'), :'ca_v'),
                   '%another company%', 'Customer of another company cannot be put into a scope');
select test.throws(format($$ select public.export_rows(%L, 'ITEMS') $$, test.id('company')), 'Unknown export%',
                   'Other company cannot export our items');

rollback;
