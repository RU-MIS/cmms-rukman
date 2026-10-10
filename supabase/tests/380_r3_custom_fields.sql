-- =============================================================================
-- PLATFORM R3 — custom fields completion (W10)
--   new entities and types, defaults, editable / visible / searchable /
--   exportable, view / edit permissions (restricted values stored apart and
--   masked in REST, RPC, export, import templates and audit), FILE fields.
-- AC 10.1–10.6 (UI / list export: e2e/ui/r3-admin.spec.ts)
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('CF-TEST'));
insert into test.ctx values ('fxb', test.fixture('CF-TEST-B'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'C1', 'CUSTOMER') as v \gset c1_
insert into t values ('role', (select id from public.roles where company_id = test.id('company') and code = 'SALES'));
select test.user_with_role(test.id('company'), 'SALES') as v \gset sales_

select test.login(test.id('operator'));
select test.throws(format($$ select public.custom_field_save(%L, null, '{"entity":"ITEM","field_key":"x","label":"X","field_type":"TEXT"}') $$, test.id('company')),
                   '%settings_custom_fields.edit%', 'Custom fields need the custom-fields section right');

select test.login(test.id('admin'));
-- ------------------------------------------------------------ AC-10.1: required dropdown on sales orders
select public.custom_field_save(test.id('company'), null, '{"entity":"SALES_ORDER","field_key":"channel","label":"Channel","field_type":"DROPDOWN","options":["DIRECT","DEALER"],"is_required":true}');
create or replace function pg_temp.so(p_custom jsonb) returns uuid language sql as $$
  select public.doc_save('SALES_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date,
    'party_id', (select id from public.parties where code = 'C1' and company_id = test.id('company')), 'customer_po_no', 'P-' || gen_random_uuid(),
    'custom', p_custom, 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'), 'rate', 10)))) $$;
select test.throws($$ select pg_temp.so('{}') $$, '%Channel is required%', 'Sales order without the required field refused by the database');
select test.throws($$ select pg_temp.so('{"channel":"ONLINE"}') $$, '%must be one of%', 'Value outside the dropdown refused');
insert into t values ('so', pg_temp.so('{"channel":"DEALER"}'));
select test.eq((select custom->>'channel' from public.sales_orders where id = (select v from t where k = 'so')), 'DEALER', 'Saved on the sales order');
-- sales orders created by approving a customer PO take the values entered in the approval
insert into t values ('cpo', public.customer_po_create(test.id('company'), :'c1_v', jsonb_build_object('po_no', 'CF-1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'))))));
create or replace function pg_temp.cpo_lines() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('line_id', id, 'approved_rate', 10, 'qty', qty)) from public.customer_po_lines where customer_po_id = (select v from t where k = 'cpo') $$;
select test.throws($$ select public.customer_po_approve_checked((select v from t where k = 'cpo'), pg_temp.cpo_lines(), null, null, false) $$,
                   '%Channel is required%', 'Customer PO approval without the required sales-order field refused');
insert into t select 'so_cpo', (public.customer_po_approve_checked((select v from t where k = 'cpo'), pg_temp.cpo_lines(), null, null, false, null,
  '{"channel":"DIRECT"}')->>'sales_order_id')::uuid;
select test.eq((select custom->>'channel' from public.sales_orders where id = (select v from t where k = 'so_cpo')), 'DIRECT',
               'Approval with the field creates the sales order with it');

-- ------------------------------------------------------------ AC-10.2: types
select public.custom_field_save(test.id('company'), null, '{"entity":"CUSTOMER","field_key":"buyer_email","label":"Buyer e-mail","field_type":"EMAIL"}');
select public.custom_field_save(test.id('company'), null, '{"entity":"CUSTOMER","field_key":"buyer_phone","label":"Buyer phone","field_type":"PHONE"}');
select public.custom_field_save(test.id('company'), null, '{"entity":"CUSTOMER","field_key":"segments","label":"Segments","field_type":"MULTI_SELECT","options":["RETAIL","EXPORT","ONLINE"]}');
select public.custom_field_save(test.id('company'), null, '{"entity":"CUSTOMER","field_key":"credit_cap","label":"Credit cap","field_type":"CURRENCY"}');
select test.throws(format($$ select public.party_save(%L, %L, '{"custom":{"buyer_email":"not-an-email"}}') $$, test.id('company'), :'c1_v'),
                   '%must be an e-mail address%', 'Invalid e-mail refused');
select test.throws(format($$ select public.party_save(%L, %L, '{"custom":{"buyer_phone":"call me"}}') $$, test.id('company'), :'c1_v'),
                   '%must be a phone number%', 'Invalid phone refused');
select test.throws(format($$ select public.party_save(%L, %L, '{"custom":{"segments":["RETAIL","SPACE"]}}') $$, test.id('company'), :'c1_v'),
                   '%accepts only%', 'Multi-select accepts only listed options');
select public.party_save(test.id('company'), :'c1_v', '{"custom":{"buyer_email":"Buyer@Example.com","buyer_phone":"+91 98200 12345","segments":["RETAIL","EXPORT"],"credit_cap":"1500.567"}}');
select test.eq((select custom - 'x' from public.parties where id = :'c1_v'),
               '{"segments": ["RETAIL", "EXPORT"], "buyer_email": "buyer@example.com", "buyer_phone": "+91 98200 12345", "credit_cap": 1500.57}'::jsonb,
               'Valid values normalised (e-mail lower case, options, currency 2 decimals)');
-- defaults and editable
select public.custom_field_save(test.id('company'), null, '{"entity":"GODOWN","field_key":"zone","label":"Zone","field_type":"TEXT","default_value":"NORTH","is_editable":false}');
insert into public.godowns (company_id, code, name) values (test.id('company'), 'G-NEW', 'New') returning id as v \gset g_
select test.eq((select custom->>'zone' from public.godowns where id = :'g_v'), 'NORTH', 'Default value on creation');
select test.login(test.id('approver'));
select test.throws(format($$ update public.godowns set custom = '{"zone":"SOUTH"}' where id = %L $$, :'g_v'), '%cannot be changed after creation%',
                   'Non-editable field cannot be changed (database)');

-- ------------------------------------------------------------ AC-10.3: view permission
select test.login(test.id('admin'));
select public.custom_field_save(test.id('company'), null, '{"entity":"ITEM","field_key":"cost_note","label":"Cost note","field_type":"TEXT","view_permission":"items.view_cost"}');
select public.custom_field_save(test.id('company'), null, '{"entity":"ITEM","field_key":"finish","label":"Finish","field_type":"TEXT","is_searchable":true}');
select public.custom_field_save(test.id('company'), null, '{"entity":"ITEM","field_key":"internal_ref","label":"Internal ref","field_type":"TEXT","is_exportable":false}');
update public.items set custom = '{"cost_note":"Landed 182 incl. freight","finish":"MATT BLACK","internal_ref":"IR-9"}' where id = test.id('fg');
select test.ok((select not (custom ? 'cost_note') from public.items where id = test.id('fg')), 'Restricted value is not stored in the readable column');
select test.eq(public.custom_private_values(test.id('company'), 'ITEM', array[test.id('fg')])->(test.id('fg')::text)->>'cost_note',
               'Landed 182 incl. freight', 'Holder reads it through the RPC');
select test.login(:'sales_v');
select test.ok(not (public.custom_private_values(test.id('company'), 'ITEM', array[test.id('fg')]) ? (test.id('fg')::text)),
               'User without items.view_cost gets nothing from the RPC');
select test.ok((select not (custom ? 'cost_note') from public.v_items where id = test.id('fg')), '... nor from REST');
select test.ok(not exists (select 1 from public.custom_field_private_values), '... nor from the private table');
select test.ok((select bool_and(not (x ? 'cf_cost_note')) from jsonb_array_elements(public.export_rows(test.id('company'), 'ITEMS')) x),
               '... nor from the export');
select test.ok(not exists (select 1 from jsonb_array_elements(public.import_entities(test.id('company'))) e, jsonb_array_elements(e->'columns') c where e->>'code' = 'ITEMS' and c->>'key' = 'cf_cost_note'),
               '... nor from the import template');
select test.login(test.id('admin'));
select public.role_set_permissions((select v from t where k = 'role'),
  array(select permission_code from public.role_permissions where role_id = (select v from t where k = 'role')) || array['audit.view']);
select test.login(:'sales_v');
select test.ok((select bool_and(coalesce(x->'new_data'->>'value', '•••') = '•••' and coalesce(x->'old_data'->>'value', '•••') = '•••')
                from jsonb_array_elements(public.audit_search(test.id('company'), '{"table_name":"custom_field_private_values"}', 50, null)) x),
               '... nor from the audit diff');
-- a request payload carrying a restricted value is masked in the audit too
select test.login(test.id('admin'));
select public.custom_field_save(test.id('company'), null, '{"entity":"SALES_ORDER","field_key":"margin_note","label":"Margin note","field_type":"TEXT","view_permission":"sales.view_margin"}');
insert into t values ('so2', pg_temp.so('{"channel":"DIRECT","margin_note":"thin margin 3%"}'));
select test.login(:'sales_v');
select test.ok((select bool_and(x->'new_data'->'custom'->>'margin_note' = '•••')
                from jsonb_array_elements(public.audit_search(test.id('company'), jsonb_build_object('row_id', (select v from t where k = 'so2')::text), 50, null)) x
                where x->'new_data'->'custom' ? 'margin_note'), 'Restricted value in an audited request payload is masked');
-- updating other fields keeps the restricted value
select test.login(test.id('approver'));
update public.items set custom = '{"finish":"GLOSS"}' where id = test.id('fg');
select test.login(test.id('admin'));
select test.eq(public.custom_private_values(test.id('company'), 'ITEM', array[test.id('fg')])->(test.id('fg')::text)->>'cost_note',
               'Landed 182 incl. freight', 'A user who cannot see the restricted value does not wipe it');
select test.login(test.id('operator'));   -- may edit items, but not see costs
select test.throws(format($$ update public.items set custom = '{"cost_note":"x"}' where id = %L $$, test.id('fg')), '%items.view_cost%',
                   'Restricted value cannot be written without its permission');
select test.login(test.id('admin'));
select test.throws(format($$ select public.custom_field_save(%L, (select id from public.custom_field_definitions where field_key = 'cost_note' and company_id = %L), '{"view_permission":null}') $$,
                          test.id('company'), test.id('company')), '%cannot be changed after creation%', 'View permission is fixed once values exist');

-- ------------------------------------------------------------ AC-10.4: searchable
select test.eq(public.custom_search(test.id('company'), 'ITEM', 'finish', 'gloss'), array[test.id('fg')], 'Searchable field filters items server-side');
select test.throws(format($$ select public.custom_search(%L, 'ITEM', 'internal_ref', 'IR') $$, test.id('company')), '%not searchable%', 'Only searchable fields');
select test.login(:'sales_v');
select test.throws(format($$ select public.custom_search(%L, 'ITEM', 'finish', 'gloss') $$, (select (v->>'company')::uuid from test.ctx where k = 'fxb')),
                   'Unknown company%', 'Other company refused');

-- ------------------------------------------------------------ AC-10.5: not exportable
select test.login(test.id('admin'));
select test.ok((select bool_and(not (x ? 'cf_internal_ref')) from jsonb_array_elements(public.export_rows(test.id('company'), 'ITEMS')) x)
               and (select bool_or(x ? 'cf_finish') from jsonb_array_elements(public.export_rows(test.id('company'), 'ITEMS')) x),
               'Not-exportable field absent from the export (others present)');
select test.ok(not exists (select 1 from jsonb_array_elements(public.import_entities(test.id('company'))) e, jsonb_array_elements(e->'columns') c where e->>'code' = 'ITEMS' and c->>'key' = 'cf_internal_ref'),
               'Not-exportable field absent from the import template');

-- ------------------------------------------------------------ AC-10.6: FILE fields follow document isolation
select public.custom_field_save(test.id('company'), null, '{"entity":"CUSTOMER","field_key":"agreement","label":"Agreement","field_type":"FILE"}');
insert into t select 'doc_a', (public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'party', 'entity_id', :'c1_v',
  'storage_path', test.id('company') || '/party/agreement.pdf', 'file_name', 'agreement.pdf', 'send_email', false))->>'document_id')::uuid;
select test.login(null);
insert into public.documents (company_id, category, entity_type, entity_id, storage_path, file_name, uploaded_by)
select (v->>'company')::uuid, 'OTHER', 'item', (v->>'fg')::uuid, (v->>'company') || '/item/b.pdf', 'b.pdf', (v->>'admin')::uuid
from test.ctx where k = 'fxb' returning id as v \gset docb_
select test.login(test.id('admin'));
select test.throws(format($$ select public.party_save(%L, %L, jsonb_build_object('custom', jsonb_build_object('agreement', %L))) $$, test.id('company'), :'c1_v', :'docb_v'),
                   '%must be an uploaded file of this company%', 'A document of another company is refused');
select public.party_save(test.id('company'), :'c1_v', jsonb_build_object('custom', jsonb_build_object('agreement', (select v from t where k = 'doc_a'))));
select test.eq((select custom->>'agreement' from public.parties where id = :'c1_v'), (select v from t where k = 'doc_a')::text, 'Own document accepted');

-- new entities exist
select test.eq((select count(distinct entity) from public.custom_field_definitions where company_id = test.id('company'))::int, 4,
               'Fields on sales orders, customers, godowns and items');
select test.ok(public.custom_field_save(test.id('company'), null, '{"entity":"USER","field_key":"badge","label":"Badge","field_type":"TEXT"}') is not null
               and public.custom_field_save(test.id('company'), null, '{"entity":"PURCHASE_ORDER","field_key":"po_ref","label":"Ref","field_type":"TEXT"}') is not null
               and public.custom_field_save(test.id('company'), null, '{"entity":"DOCUMENT","field_key":"tag","label":"Tag","field_type":"TEXT"}') is not null,
               'User, purchase-order and document fields can be defined');
rollback;
