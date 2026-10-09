-- =============================================================================
-- PLATFORM R2 — import / export engine: header and row validation, duplicates,
-- existing records, all-or-nothing, valid-only, explicit confirmation,
-- permissions, scope, every entity, export rights.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('IMP-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
create temp table r (k text primary key, v jsonb) on commit drop;
grant all on t, r to authenticated;

-- stage + validate in one step: returns the validation summary
create or replace function pg_temp.imp(p_entity text, p_mode text, p_update boolean, p_rows jsonb)
returns jsonb language plpgsql as $$
declare v_job jsonb; v_cols text[];
begin
  v_cols := array(select distinct k from jsonb_array_elements(p_rows) x, jsonb_object_keys(x) k);
  v_job := public.import_create(test.id('company'), p_entity, 'test.xlsx', p_mode, p_update, v_cols);
  perform public.import_add_rows((v_job->>'job_id')::uuid,
    (select jsonb_agg(jsonb_build_object('row_no', o + 1, 'data', x)) from jsonb_array_elements(p_rows) with ordinality a(x, o)));
  return public.import_validate((v_job->>'job_id')::uuid);
end $$;
create or replace function pg_temp.errors(p_job uuid) returns text language sql as $$
  select string_agg(row_no || ':' || coalesce(column_key, '-') || ':' || message, ' | ' order by row_no, id)
  from public.import_errors where job_id = p_job $$;

select test.login(test.id('admin'));
select public.custom_field_save(test.id('company'), null, '{"entity":"ITEM","field_key":"finish","label":"Finish","field_type":"DROPDOWN","options":["ZINC","BLACK"]}');

-- ------------------------------------------------ registry and templates
-- R3 adds entities; the ten R2 entities must all still be there
select test.ok((select count(*) from jsonb_array_elements(public.import_entities(test.id('company'))) x
                where x->>'code' in ('ITEMS', 'ITEM_RATES', 'CUSTOMERS', 'VENDORS', 'GODOWNS', 'LOCATIONS', 'OPENING_STOCK', 'USERS',
                                     'CUSTOMER_RATES', 'VENDOR_RATES')) = 10, 'Ten import / export entities');
select test.ok(exists (select 1 from jsonb_array_elements(public.import_entities(test.id('company'))) e, jsonb_array_elements(e->'columns') c
                       where e->>'code' = 'ITEMS' and c->>'key' = 'cf_finish'), 'Custom fields appear as template columns');

-- ------------------------------------------------ header validation
insert into r values ('hdr', public.import_create(test.id('company'), 'ITEMS', 'x.xlsx', 'ALL_OR_NOTHING', false, array['code', 'colour']));
select test.eq((r.v->>'header_errors')::int, 4, 'Unknown column + missing required columns (name, kind, base unit)') from r where k = 'hdr';
select public.import_validate((v->>'job_id')::uuid) from r where k = 'hdr';
select test.throws(format($$ select public.import_commit(%L, true) $$, (select v->>'job_id' from r where k = 'hdr')),
                   'The file has column errors%', 'Header errors block the import');

-- ------------------------------------------------ row validation + all-or-nothing
insert into r values ('aon', pg_temp.imp('ITEMS', 'ALL_OR_NOTHING', false, '[
  {"code":"IMP-1","name":"Import one","item_kind":"raw_material","base_unit":"pcs","pack_unit":"BOX","pack_factor":"100","sales_unit":"BOX","sale_price":"1.5","cf_finish":"ZINC"},
  {"code":"IMP-2","name":"Import two","item_kind":"PACKING","base_unit":"PCS","min_stock":"1,000"},
  {"code":"IMP-3","name":"Bad","item_kind":"WOOD","base_unit":"XYZ","min_stock":"abc"},
  {"code":"imp-1","name":"Dup","item_kind":"PACKING","base_unit":"PCS"},
  {"code":"FG-4766","name":"Existing","item_kind":"FINISHED_GOOD","base_unit":"PAIR"},
  {"code":"IMP-6","name":"Bad custom","item_kind":"PACKING","base_unit":"PCS","cf_finish":"RED"}]'));
select test.eq((v->>'total_rows')::int || '/' || (v->>'valid_rows') || '/' || (v->>'invalid_rows') || '/' || (v->>'duplicate_rows'),
               '6/2/4/1', 'Preview: 6 rows, 2 valid, 4 invalid, 1 duplicate') from r where k = 'aon';
select test.ok(pg_temp.errors((v->>'id')::uuid) like '%4:item_kind:Allowed: FINISHED_GOOD, RAW_MATERIAL, PACKING, SERVICE%'
               and pg_temp.errors((v->>'id')::uuid) like '%4:min_stock:Must be a number%'
               and pg_temp.errors((v->>'id')::uuid) like '%5:code:Duplicate of row 2%'
               and pg_temp.errors((v->>'id')::uuid) like '%6:code:Item already exists%'
               and pg_temp.errors((v->>'id')::uuid) like '%7:cf_finish:Allowed: ZINC, BLACK%',
               'Errors with spreadsheet row (header = row 1), column and reason') from r where k = 'aon';
select test.ok((select value from public.import_errors where job_id = (r.v->>'id')::uuid and row_no = 4 and column_key = 'min_stock') = 'abc',
               'Error keeps the current value') from r where k = 'aon';
select test.throws(format($$ select public.import_commit(%L, false) $$, (select v->>'id' from r where k = 'aon')),
                   'Confirm the import%', 'Explicit confirmation required');
select test.eq((public.import_commit((v->>'id')::uuid, true))->>'committed', 'false', 'All-or-nothing with errors: refused') from r where k = 'aon';
select test.eq((select count(*) from public.items where code like 'IMP-%')::int, 0, 'All-or-nothing: nothing imported');

-- ------------------------------------------------ valid rows only
insert into r values ('vo', pg_temp.imp('ITEMS', 'VALID_ONLY', false, (select v from (select '[
  {"code":"IMP-1","name":"Import one","item_kind":"RAW_MATERIAL","base_unit":"PCS","pack_unit":"BOX","pack_factor":"100","sales_unit":"BOX","sale_price":"1.5","cf_finish":"ZINC"},
  {"code":"IMP-2","name":"Import two","item_kind":"PACKING","base_unit":"PCS","min_stock":"1,000"},
  {"code":"IMP-3","name":"Bad","item_kind":"WOOD","base_unit":"XYZ"},
  {"code":"FG-4766","name":"Existing renamed","item_kind":"FINISHED_GOOD","base_unit":"PAIR"}]'::jsonb v) x)));
select test.eq((public.import_commit((v->>'id')::uuid, true))->>'imported_rows', '2', 'Valid only: 2 rows imported') from r where k = 'vo';
select test.ok((select sales_unit_id = test.id('box') and custom->>'finish' = 'ZINC' from public.items where code = 'IMP-1')
               and (select factor_to_base from public.item_packings p join public.items i on i.id = p.item_id where i.code = 'IMP-1') = 100,
               'Item with packing, sales unit and custom field imported');
select test.eq((select sale_price from public.v_items where code = 'IMP-1'), 1.5000::numeric, 'Rate imported (with history)');
select test.eq((select min_stock from public.items where code = 'IMP-2'), 1000.000::numeric, 'Number with thousands separator');
select test.eq((select name from public.items where code = 'FG-4766'), 'TOE-RING SANDAL-4766', 'Existing record untouched without "update existing"');
select test.ok(exists (select 1 from public.audit_log where table_name = 'import_jobs' and action = 'IMPORT'), 'Import audited');

-- ------------------------------------------------ update existing
insert into r values ('upd', pg_temp.imp('ITEMS', 'ALL_OR_NOTHING', true, '[
  {"code":"FG-4766","name":"Toe ring sandal","item_kind":"FINISHED_GOOD","base_unit":"PAIR","reorder_level":"90"},
  {"code":"IMP-9","name":"New nine","item_kind":"PACKING","base_unit":"PCS"}]'));
select test.eq((v->>'update_rows') || '/' || (v->>'create_rows'), '1/1', 'Preview shows 1 update, 1 create') from r where k = 'upd';
select public.import_commit((v->>'id')::uuid, true) from r where k = 'upd';
select test.ok((select name = 'Toe ring sandal' and reorder_level = 90 and base_unit_id = test.id('pair') from public.items where code = 'FG-4766'),
               'Existing item updated');
insert into r values ('bu', pg_temp.imp('ITEMS', 'ALL_OR_NOTHING', true, '[{"code":"FG-4766","name":"x","item_kind":"FINISHED_GOOD","base_unit":"PCS"}]'));
select test.ok(pg_temp.errors((v->>'id')::uuid) like '%base unit of an existing item cannot be changed%', 'Base unit is never changed by import')
from r where k = 'bu';

-- ------------------------------------------------ failure during the write: rollback / per-row
insert into r values ('fail', pg_temp.imp('ITEMS', 'ALL_OR_NOTHING', false, '[
  {"code":"BC-1","name":"Barcode one","item_kind":"PACKING","base_unit":"PCS","barcode":"55501"},
  {"code":"BC-2","name":"Barcode two","item_kind":"PACKING","base_unit":"PCS","barcode":"55501"}]'));
select test.eq((public.import_commit((v->>'id')::uuid, true))->>'committed', 'false', 'Error while writing (duplicate barcode)') from r where k = 'fail';
select test.eq((select count(*) from public.items where code in ('BC-1', 'BC-2'))::int, 0, 'All-or-nothing: the first row is rolled back too');
select test.eq((select status from public.import_jobs where id = (r.v->>'id')::uuid), 'FAILED', 'Job marked failed') from r where k = 'fail';
insert into r values ('fail2', pg_temp.imp('ITEMS', 'VALID_ONLY', false, '[
  {"code":"BC-1","name":"Barcode one","item_kind":"PACKING","base_unit":"PCS","barcode":"55501"},
  {"code":"BC-2","name":"Barcode two","item_kind":"PACKING","base_unit":"PCS","barcode":"55501"}]'));
select test.eq((public.import_commit((v->>'id')::uuid, true))->>'failed_rows', '1', 'Valid only: failing row skipped') from r where k = 'fail2';
select test.eq((select string_agg(code, ',') from public.items where code in ('BC-1', 'BC-2')), 'BC-1', 'Only the good row was written');

-- ------------------------------------------------ other entities
insert into r values ('cust', pg_temp.imp('CUSTOMERS', 'ALL_OR_NOTHING', false, '[
  {"code":"CUST-1","name":"Sharma Traders","email":"Buyer@Example.com","credit_days":"30","credit_limit":"500000","is_active":"yes"},
  {"code":"CUST-2","name":"Gupta Stores","email":"not-an-email"}]'));
select test.ok(pg_temp.errors((v->>'id')::uuid) = '3:email:Not a valid email address', 'Customer email validated') from r where k = 'cust';
insert into r values ('cust2', pg_temp.imp('CUSTOMERS', 'ALL_OR_NOTHING', false, '[{"code":"CUST-1","name":"Sharma Traders","email":"Buyer@Example.com","credit_days":"30","credit_limit":"500000"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'cust2';
select test.ok((select email = 'buyer@example.com' and credit_limit = 500000 and app.party_is_customer(id) from public.parties where code = 'CUST-1'),
               'Customer imported with role CUSTOMER');
insert into r values ('vend', pg_temp.imp('VENDORS', 'ALL_OR_NOTHING', false, '[{"code":"VEND-1","name":"Gupta Steel","vendor_type":"job_worker"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'vend';
select test.ok(exists (select 1 from public.party_roles pr join public.parties p on p.id = pr.party_id where p.code = 'VEND-1' and pr.role = 'JOB_WORKER'), 'Vendor imported as job worker');
insert into r values ('gd', pg_temp.imp('GODOWNS', 'ALL_OR_NOTHING', false, '[{"code":"wh-9","name":"Warehouse nine","godown_type":"own_store"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'gd';
insert into r values ('loc', pg_temp.imp('LOCATIONS', 'ALL_OR_NOTHING', false, '[{"godown_code":"WH-9","rack":"b1","shelf":"c","bin":"123"},{"godown_code":"NOPE","rack":"A"}]'));
select test.ok(pg_temp.errors((v->>'id')::uuid) = '3:godown_code:Unknown godown', 'Unknown godown reference') from r where k = 'loc';
insert into r values ('loc2', pg_temp.imp('LOCATIONS', 'VALID_ONLY', false, '[{"godown_code":"WH-9","rack":"b1","shelf":"c","bin":"123"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'loc2';
select test.ok(exists (select 1 from public.storage_locations where code = 'B1-C-123'), 'Godown and location imported');
insert into r values ('os', pg_temp.imp('OPENING_STOCK', 'ALL_OR_NOTHING', false, '[
  {"item_code":"IMP-1","godown_code":"WH-9","location_code":"B1-C-123","qty":"5","unit":"BOX","rate":"1.1"},
  {"item_code":"IMP-2","godown_code":"WH-9","qty":"250"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'os';
select test.eq((select sum(base_qty) from public.stock_balances b join public.items i on i.id = b.item_id where i.code = 'IMP-1'), 500.000::numeric,
               'Opening stock posted in base units (5 BOX = 500 PCS)');
select test.ok(exists (select 1 from public.stock_movements m join public.items i on i.id = m.item_id
                       where i.code = 'IMP-2' and m.movement_type = 'OPENING' and m.source_table = 'import_jobs'), 'Opening movement traceable to the import');
insert into r values ('cr', pg_temp.imp('CUSTOMER_RATES', 'ALL_OR_NOTHING', false, '[{"customer_code":"CUST-1","item_code":"IMP-1","rate":"1.4","effective_from":"2026-10-01"},
                                                                                    {"customer_code":"VEND-1","item_code":"IMP-1","rate":"1"}]'));
select test.ok(pg_temp.errors((v->>'id')::uuid) = '3:customer_code:Unknown customer', 'Vendor code rejected as customer') from r where k = 'cr';
insert into r values ('ir', pg_temp.imp('ITEM_RATES', 'ALL_OR_NOTHING', false, '[{"item_code":"IMP-1","rate_type":"purchase","rate":"1.2"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'ir';
select test.eq((select purchase_price from public.v_items where code = 'IMP-1'), 1.2000::numeric, 'Item rate imported');
insert into r values ('us2', pg_temp.imp('USERS', 'ALL_OR_NOTHING', false, '[{"email":"newstore@imp.test","full_name":"New Store","role_code":"INVENTORY","department":"Stores","godown_codes":"WH-9"}]'));
select public.import_commit((v->>'id')::uuid, true) from r where k = 'us2';
select test.ok(exists (select 1 from public.user_invitations where email = 'newstore@imp.test' and details->>'department' = 'Stores'),
               'User import creates an invitation with the details (no password)');
-- the invited person signs in → details applied
select test.login(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e001', 'newstore@imp.test');
select test.login('00000000-0000-0000-0000-00000000e001');
select public.session_bootstrap();
select test.login(test.id('admin'));
select test.ok((select department = 'Stores' from public.company_users where user_id = '00000000-0000-0000-0000-00000000e001')
               and (select count(*) = 1 from public.user_data_scopes where user_id = '00000000-0000-0000-0000-00000000e001' and dimension = 'GODOWN'),
               'Invitation claimed: department and godown scope applied');

-- ------------------------------------------------ authorization: import / export / scope
select test.login(test.id('operator'));
select test.throws(format($$ select public.import_create(%L, 'ITEMS', 'x', 'ALL_OR_NOTHING', false, array['code']) $$, test.id('company')),
                   'Permission denied: items.import%', 'Import refused without the import permission');
select test.throws(format($$ select public.import_validate(%L) $$, (select v->>'id' from r where k = 'upd')), 'Import not found%',
                   'Another user''s import job cannot be used');
select test.login(test.id('admin'));
insert into t values ('noexp', public.role_save(test.id('company'), null, '{"code":"NOEXP","name":"No export"}'));
select public.role_set_permissions((select v from t where k = 'noexp'), array['items.view', 'parties.view']);
select test.login(null);
select test.user_with_role(test.id('company'), 'NOEXP') as v \gset ne_
select test.login(:'ne_v');
select test.throws(format($$ select public.export_rows(%L, 'ITEMS') $$, test.id('company')), 'Permission denied: items.export%',
                   'Export refused without the export permission');
select test.login(test.id('admin'));
select public.role_set_permissions((select v from t where k = 'noexp'), array['items.view', 'items.export', 'parties.view']);
select test.login(:'ne_v');
select test.ok((select bool_and(x->>'sale_price' is null and x->>'purchase_price' is null)
                from jsonb_array_elements(public.export_rows(test.id('company'), 'ITEMS')) x), 'Export masks rates the user cannot see');
select test.eq(jsonb_array_length(public.export_rows(test.id('company'), 'ITEM_RATES')), 0, 'Rate export empty without rate rights');
select test.ok(exists (select 1 from public.export_log where created_by = :'ne_v' and entity = 'ITEM_RATES'), 'Exports are logged');
-- godown-restricted importer: rows for other godowns are errors
select test.login(test.id('admin'));
select public.role_set_permissions((select v from t where k = 'noexp'), array['items.view', 'godowns.view', 'stock_adjustment.import', 'stock_adjustment.create']);
select public.user_set_scope(test.id('company'), :'ne_v', 'GODOWN', array[test.id('b336')]);
select test.login(:'ne_v');
insert into r values ('os2', pg_temp.imp('OPENING_STOCK', 'ALL_OR_NOTHING', false, '[{"item_code":"FG-4766","godown_code":"WH-9","qty":"1"}]'));
select test.ok(pg_temp.errors((v->>'id')::uuid) like '%godown_code:Unknown godown or outside your data scope%', 'Import refuses godowns outside the scope')
from r where k = 'os2';

-- cross-company: export / import of another company
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('IMP-OTHER'));
select test.login((select (v->>'admin')::uuid from test.ctx where k = 'fx2'));
select test.throws(format($$ select public.export_rows(%L, 'CUSTOMERS') $$, test.id('company')), 'Unknown export%', 'Cross-company export refused');
select test.throws(format($$ select public.import_create(%L, 'ITEMS', 'x', 'ALL_OR_NOTHING', false, array['code']) $$, test.id('company')),
                   'Unknown import%', 'Cross-company import refused');
select test.eq((select count(*) from public.import_jobs)::int, 0, 'Import jobs of other companies invisible');

rollback;
