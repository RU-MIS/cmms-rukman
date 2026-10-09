-- =============================================================================
-- PLATFORM R2 — reusable Import / Export engine.
--
-- One engine for every master: the entity registry (data) describes columns,
-- types, required / allowed values and permissions; per-entity functions do
-- the reference checks and the write. Flow:
--   import_create (header check) → import_add_rows (chunks) → import_validate
--   (whole file: types, required, references, duplicates in file and in the
--   database, permissions, data scope) → preview / error file in the UI →
--   import_commit(confirm => true):
--     ALL_OR_NOTHING (default): any error → nothing is written;
--                               a failure during the write rolls everything back.
--     VALID_ONLY: every valid row in its own sub-transaction — an invalid or
--                 failing row never changes anything.
-- Existing records are never changed unless "update existing" is chosen.
-- Every write goes through the same database rules as the screens (triggers,
-- scope, field rights), executed as the importing user.
--
-- Export: export_rows() runs as the CALLER (SECURITY INVOKER): RLS, data
-- scopes, column privileges and masked views apply — an export can never
-- contain more than the user sees. Every export is logged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Registry
-- column: {key, label, type text|number|integer|date|boolean|enum|email,
--          required, values[], example, help, min}
-- -----------------------------------------------------------------------------
create table app.import_entities (
  code               text primary key,
  label              text not null,
  import_permission  text not null,
  export_permission  text not null,
  custom_entity      text,                 -- ITEM / CUSTOMER / VENDOR: custom fields appended as cf_<key>
  key_columns        text[] not null,      -- duplicates in the file / existing record
  can_update         boolean not null default true,
  columns            jsonb not null,
  help               text not null default '',
  sort_order         integer not null default 100
);

insert into app.import_entities (code, label, import_permission, export_permission, custom_entity, key_columns, can_update, sort_order, help, columns) values
('ITEMS', 'Items', 'items.import', 'items.export', 'ITEM', '{code}', true, 10,
 'One row per item. Units by code (PCS, BOX …); category / brand by code or name and must exist. Packing: one extra unit with its factor to the base unit.',
 '[{"key":"code","label":"Item / part code","type":"text","required":true,"example":"BOLT-10"},
   {"key":"name","label":"Name","type":"text","required":true,"example":"10mm Bolt"},
   {"key":"description","label":"Description","type":"text","example":"Zinc plated"},
   {"key":"item_kind","label":"Kind","type":"enum","required":true,"values":["FINISHED_GOOD","RAW_MATERIAL","PACKING","SERVICE"],"example":"RAW_MATERIAL"},
   {"key":"category","label":"Category (code or name)","type":"text","example":""},
   {"key":"brand","label":"Brand (code or name)","type":"text","example":""},
   {"key":"base_unit","label":"Base unit code","type":"text","required":true,"example":"PCS"},
   {"key":"pack_unit","label":"Packing unit code","type":"text","example":"BOX"},
   {"key":"pack_factor","label":"Base units per packing","type":"number","min":0,"example":"100"},
   {"key":"purchase_unit","label":"Purchase unit code","type":"text","example":"BOX"},
   {"key":"sales_unit","label":"Sales unit code","type":"text","example":"PCS"},
   {"key":"barcode","label":"Barcode","type":"text","example":""},
   {"key":"hsn_code","label":"HSN code","type":"text","example":"7318"},
   {"key":"sku","label":"SKU","type":"text","example":""},
   {"key":"gst_rate","label":"GST %","type":"number","min":0,"example":"18"},
   {"key":"min_stock","label":"Minimum stock","type":"number","min":0,"example":"500"},
   {"key":"max_stock","label":"Maximum stock","type":"number","min":0,"example":"50000"},
   {"key":"reorder_level","label":"Reorder level","type":"number","min":0,"example":"1000"},
   {"key":"purchase_price","label":"Purchase rate","type":"number","min":0,"example":"1.20","help":"needs Edit rates"},
   {"key":"sale_price","label":"Sales rate","type":"number","min":0,"example":"1.50","help":"needs Edit rates"},
   {"key":"is_active","label":"Active","type":"boolean","example":"YES"},
   {"key":"portal_visible","label":"Visible in customer portal","type":"boolean","example":"YES"},
   {"key":"notes","label":"Notes","type":"text","example":""}]'),
('ITEM_RATES', 'Item rates (price list)', 'items.import', 'items.export', null, '{item_code,rate_type}', true, 20,
 'Sets the item master sales / purchase rate. The previous rate is kept in the rate history.',
 '[{"key":"item_code","label":"Item code","type":"text","required":true,"example":"BOLT-10"},
   {"key":"rate_type","label":"Rate type","type":"enum","required":true,"values":["SALE","PURCHASE"],"example":"SALE"},
   {"key":"rate","label":"Rate","type":"number","required":true,"min":0,"example":"1.55"}]'),
('CUSTOMER_RATES', 'Customer-specific rates', 'rates.import', 'rates.export', null, '{customer_code,item_code,effective_from}', true, 30,
 'Special sales rate of a customer for an item from a date.',
 '[{"key":"customer_code","label":"Customer code","type":"text","required":true,"example":"CUST-1"},
   {"key":"item_code","label":"Item code","type":"text","required":true,"example":"BOLT-10"},
   {"key":"rate","label":"Rate","type":"number","required":true,"min":0,"example":"1.45"},
   {"key":"effective_from","label":"Effective from (YYYY-MM-DD)","type":"date","example":"2026-10-01","help":"empty = today"}]'),
('VENDOR_RATES', 'Vendor-specific rates', 'rates.import', 'rates.export', null, '{vendor_code,item_code,effective_from}', true, 40,
 'Purchase rate agreed with a vendor for an item from a date.',
 '[{"key":"vendor_code","label":"Vendor code","type":"text","required":true,"example":"VEND-1"},
   {"key":"item_code","label":"Item code","type":"text","required":true,"example":"BOLT-10"},
   {"key":"rate","label":"Rate","type":"number","required":true,"min":0,"example":"1.10"},
   {"key":"effective_from","label":"Effective from (YYYY-MM-DD)","type":"date","example":"2026-10-01","help":"empty = today"}]'),
('CUSTOMERS', 'Customers', 'parties.import', 'parties.export', 'CUSTOMER', '{code}', true, 50, 'One row per customer.',
 '[{"key":"code","label":"Customer code","type":"text","required":true,"example":"CUST-1"},
   {"key":"name","label":"Name","type":"text","required":true,"example":"Sharma Traders"},
   {"key":"contact_person","label":"Contact person","type":"text","example":"R. Sharma"},
   {"key":"mobile","label":"Mobile","type":"text","example":"9800000000"},
   {"key":"phone","label":"Phone","type":"text","example":""},
   {"key":"email","label":"Email","type":"email","example":"buyer@example.com"},
   {"key":"gstin","label":"GSTIN","type":"text","example":""},
   {"key":"pan","label":"PAN","type":"text","example":""},
   {"key":"address","label":"Billing address","type":"text","example":"12 Main Road"},
   {"key":"city","label":"City","type":"text","example":"Delhi"},
   {"key":"state_code","label":"State code","type":"text","example":"07"},
   {"key":"pincode","label":"Pincode","type":"text","example":"110001"},
   {"key":"credit_days","label":"Credit days","type":"integer","min":0,"example":"30"},
   {"key":"credit_limit","label":"Credit limit","type":"number","min":0,"example":"500000"},
   {"key":"payment_terms","label":"Payment terms","type":"text","example":"30 days"},
   {"key":"is_active","label":"Active","type":"boolean","example":"YES"},
   {"key":"notes","label":"Notes","type":"text","example":""}]'),
('VENDORS', 'Vendors', 'parties.import', 'parties.export', 'VENDOR', '{code}', true, 60, 'One row per vendor (supplier, job worker or cutter).',
 '[{"key":"code","label":"Vendor code","type":"text","required":true,"example":"VEND-1"},
   {"key":"name","label":"Name","type":"text","required":true,"example":"Gupta Steel"},
   {"key":"vendor_type","label":"Vendor type","type":"enum","values":["SUPPLIER","JOB_WORKER","CUTTER"],"example":"SUPPLIER","help":"empty = SUPPLIER"},
   {"key":"contact_person","label":"Contact person","type":"text","example":""},
   {"key":"mobile","label":"Mobile","type":"text","example":""},
   {"key":"phone","label":"Phone","type":"text","example":""},
   {"key":"email","label":"Email","type":"email","example":"sales@example.com"},
   {"key":"gstin","label":"GSTIN","type":"text","example":""},
   {"key":"pan","label":"PAN","type":"text","example":""},
   {"key":"address","label":"Address","type":"text","example":""},
   {"key":"city","label":"City","type":"text","example":""},
   {"key":"state_code","label":"State code","type":"text","example":""},
   {"key":"pincode","label":"Pincode","type":"text","example":""},
   {"key":"credit_days","label":"Credit days","type":"integer","min":0,"example":"45"},
   {"key":"payment_terms","label":"Payment terms","type":"text","example":""},
   {"key":"is_active","label":"Active","type":"boolean","example":"YES"},
   {"key":"notes","label":"Notes","type":"text","example":""}]'),
('GODOWNS', 'Godowns', 'godowns.import', 'godowns.export', null, '{code}', true, 70, 'Every new godown gets a default UNASSIGNED location.',
 '[{"key":"code","label":"Godown code","type":"text","required":true,"example":"WH-1"},
   {"key":"name","label":"Name","type":"text","required":true,"example":"Main warehouse"},
   {"key":"godown_type","label":"Type","type":"enum","values":["OWN_STORE","FACTORY","PARTY_LOCATION"],"example":"OWN_STORE","help":"empty = OWN_STORE"},
   {"key":"portal_visible","label":"Counts for portal stock","type":"boolean","example":"YES"},
   {"key":"is_active","label":"Active","type":"boolean","example":"YES"}]'),
('LOCATIONS', 'Locations (rack / shelf / bin)', 'godowns.import', 'godowns.export', null, '{godown_code,rack,shelf,bin}', true, 80,
 'Location code = RACK-SHELF-BIN within the godown.',
 '[{"key":"godown_code","label":"Godown code","type":"text","required":true,"example":"WH-1"},
   {"key":"zone","label":"Zone","type":"text","example":"A"},
   {"key":"rack","label":"Rack","type":"text","required":true,"example":"B1"},
   {"key":"shelf","label":"Shelf","type":"text","example":"C"},
   {"key":"bin","label":"Bin","type":"text","example":"123"},
   {"key":"remarks","label":"Remarks","type":"text","example":""},
   {"key":"is_active","label":"Active","type":"boolean","example":"YES"}]'),
('OPENING_STOCK', 'Opening stock', 'stock_adjustment.import', 'items.export', null, '{item_code,godown_code,location_code}', false, 90,
 'Posts OPENING stock movements (stock in). Quantity in the given unit (empty = base unit). Export = current stock per location.',
 '[{"key":"item_code","label":"Item code","type":"text","required":true,"example":"BOLT-10"},
   {"key":"godown_code","label":"Godown code","type":"text","required":true,"example":"WH-1"},
   {"key":"location_code","label":"Location code","type":"text","example":"B1-C-123","help":"empty = UNASSIGNED"},
   {"key":"qty","label":"Quantity","type":"number","required":true,"min":0,"example":"2500"},
   {"key":"unit","label":"Unit code","type":"text","example":"PCS"},
   {"key":"rate","label":"Rate per unit (cost)","type":"number","min":0,"example":"1.10","help":"needs Edit rates"},
   {"key":"date","label":"Date (YYYY-MM-DD)","type":"date","example":"2026-04-01","help":"empty = today"}]'),
('USERS', 'Users (invitations)', 'users.import', 'users.export', null, '{email}', true, 100,
 'Creates invitations (sign-in with the email code). No passwords are imported. Godowns: codes separated by commas, empty = all.',
 '[{"key":"email","label":"Email / login","type":"email","required":true,"example":"store@example.com"},
   {"key":"full_name","label":"Name","type":"text","example":"Store Keeper"},
   {"key":"role_code","label":"Role code","type":"text","required":true,"example":"INVENTORY"},
   {"key":"mobile","label":"Mobile","type":"text","example":""},
   {"key":"department","label":"Department","type":"text","example":"Stores"},
   {"key":"designation","label":"Designation","type":"text","example":""},
   {"key":"employee_code","label":"Employee code","type":"text","example":""},
   {"key":"godown_codes","label":"Godown codes","type":"text","example":"WH-1"}]');

-- Columns of an entity incl. the company's custom fields.
create or replace function app.import_columns(p_company_id uuid, p_entity text)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select e.columns || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'cf_' || d.field_key, 'label', d.label,
             'type', case d.field_type when 'NUMBER' then 'number' when 'DATE' then 'date' when 'BOOLEAN' then 'boolean'
                                       when 'DROPDOWN' then 'enum' else 'text' end,
             'required', d.is_required, 'values', to_jsonb(d.options), 'custom', true, 'help', coalesce(d.help_text, ''))
           order by d.sort_order, d.label)
    from public.custom_field_definitions d
    where d.company_id = p_company_id and d.entity = e.custom_entity and d.is_active), '[]'::jsonb)
  from app.import_entities e where e.code = p_entity
$$;

-- Entities the caller may import or export (templates and export are built from this).
create or replace function public.import_entities(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', e.code, 'label', e.label, 'help', e.help, 'key_columns', to_jsonb(e.key_columns),
           'can_update', e.can_update,
           'can_import', app.has_permission(p_company_id, e.import_permission),
           'can_export', app.has_permission(p_company_id, e.export_permission),
           'columns', app.import_columns(p_company_id, e.code)) order by e.sort_order), '[]')
  from app.import_entities e
  where app.is_member(p_company_id)
    and (app.has_permission(p_company_id, e.import_permission) or app.has_permission(p_company_id, e.export_permission))
$$;

-- -----------------------------------------------------------------------------
-- Jobs
-- -----------------------------------------------------------------------------
create table public.import_jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  entity           text not null,
  file_name        text not null default '',
  mode             text not null default 'ALL_OR_NOTHING' check (mode in ('ALL_OR_NOTHING', 'VALID_ONLY')),
  update_existing  boolean not null default false,
  columns          text[] not null default '{}',
  status           text not null default 'STAGING' check (status in ('STAGING', 'VALIDATED', 'COMMITTED', 'FAILED', 'CANCELLED')),
  total_rows       integer not null default 0,
  valid_rows       integer not null default 0,
  invalid_rows     integer not null default 0,
  duplicate_rows   integer not null default 0,
  create_rows      integer not null default 0,
  update_rows      integer not null default 0,
  imported_rows    integer not null default 0,
  failed_rows      integer not null default 0,
  error            text,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  validated_at     timestamptz,
  committed_at     timestamptz
);
create index import_jobs_company_idx on public.import_jobs (company_id, created_at desc);

create table public.import_rows (
  job_id      uuid not null references public.import_jobs (id) on delete cascade,
  row_no      integer not null check (row_no > 0),
  data        jsonb not null,
  normalized  jsonb,
  action      text check (action in ('CREATE', 'UPDATE')),
  status      text not null default 'PENDING' check (status in ('PENDING', 'VALID', 'ERROR', 'IMPORTED', 'FAILED')),
  target_id   uuid,
  primary key (job_id, row_no)
);

create table public.import_errors (
  id          bigserial primary key,
  job_id      uuid not null references public.import_jobs (id) on delete cascade,
  row_no      integer not null,            -- 0 = file / header
  column_key  text,
  value       text,
  message     text not null
);
create index import_errors_job_idx on public.import_errors (job_id, row_no);

create table public.export_log (
  id          bigserial primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  entity      text not null,
  row_count   integer not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create or replace function app.import_job_for(p_job_id uuid)
returns public.import_jobs
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare j public.import_jobs; e app.import_entities;
begin
  select * into j from public.import_jobs where id = p_job_id;
  if j.id is null or j.created_by <> auth.uid() or not app.is_member(j.company_id) then
    raise exception 'Import not found' using errcode = 'P0001';
  end if;
  select * into e from app.import_entities where code = j.entity;
  perform app.require_permission(j.company_id, e.import_permission);
  return j;
end;
$$;

-- Header check: unknown and missing required columns.
create or replace function public.import_create(p_company_id uuid, p_entity text, p_file_name text, p_mode text,
                                                p_update_existing boolean, p_columns text[])
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e app.import_entities; v_cols jsonb; v_id uuid; c text; v_errors int := 0;
begin
  select * into e from app.import_entities where code = upper(p_entity);
  if e.code is null or not app.is_member(p_company_id) then
    raise exception 'Unknown import' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, e.import_permission);
  if p_update_existing and not e.can_update then
    raise exception '% cannot update existing records', e.label using errcode = 'P0001';
  end if;
  v_cols := app.import_columns(p_company_id, e.code);
  insert into public.import_jobs (company_id, entity, file_name, mode, update_existing, columns)
  values (p_company_id, e.code, left(coalesce(p_file_name, ''), 200), coalesce(p_mode, 'ALL_OR_NOTHING'),
          coalesce(p_update_existing, false), coalesce(p_columns, '{}'))
  returning id into v_id;
  foreach c in array coalesce(p_columns, '{}') loop
    if not exists (select 1 from jsonb_array_elements(v_cols) x where x->>'key' = c) then
      insert into public.import_errors (job_id, row_no, column_key, message) values (v_id, 0, c, 'Unknown column');
      v_errors := v_errors + 1;
    end if;
  end loop;
  for c in select x->>'key' from jsonb_array_elements(v_cols) x where (x->>'required')::boolean loop
    if not c = any (coalesce(p_columns, '{}')) then
      insert into public.import_errors (job_id, row_no, column_key, message) values (v_id, 0, c, 'Required column is missing');
      v_errors := v_errors + 1;
    end if;
  end loop;
  return jsonb_build_object('job_id', v_id, 'header_errors', v_errors);
end;
$$;

-- rows: [{row_no, data: {column_key: value}}]  (max 2000 per call)
create or replace function public.import_add_rows(p_job_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare j public.import_jobs := app.import_job_for(p_job_id); v_n integer;
begin
  if j.status <> 'STAGING' then
    raise exception 'Rows can only be added before validation' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'At most 2000 rows per call' using errcode = 'P0001';
  end if;
  insert into public.import_rows (job_id, row_no, data)
  select j.id, (x->>'row_no')::int, coalesce(x->'data', '{}') from jsonb_array_elements(p_rows) x;
  get diagnostics v_n = row_count;
  update public.import_jobs set total_rows = total_rows + v_n where id = j.id;
  -- tested: 10,000 items validate in ~4 s and import in ~7 s (Supabase API
  -- statement timeout 8 s); split larger files
  if (select total_rows from public.import_jobs where id = j.id) > 10000 then
    raise exception 'At most 10,000 rows per file — split the file' using errcode = 'P0001';
  end if;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Generic type / required checks for one row
-- -----------------------------------------------------------------------------
create or replace function app.import_typed(p_cols jsonb, p_data jsonb, out normalized jsonb, out errors jsonb)
language plpgsql stable
set search_path = public, app, pg_temp
as $$
declare c jsonb; v text; k text; t text;
begin
  normalized := '{}'; errors := '[]';
  for c in select x from jsonb_array_elements(p_cols) x loop
    k := c->>'key'; t := c->>'type';
    v := nullif(btrim(p_data->>k), '');
    if v is null then
      if coalesce((c->>'required')::boolean, false) then
        errors := errors || jsonb_build_object('column', k, 'value', null, 'message', 'Required');
      end if;
      continue;
    end if;
    if t in ('number', 'integer') then
      v := replace(v, ',', '');
      if (t = 'number' and v !~ '^-?[0-9]+(\.[0-9]+)?$') or (t = 'integer' and v !~ '^-?[0-9]+$') then
        errors := errors || jsonb_build_object('column', k, 'value', p_data->>k, 'message', case t when 'integer' then 'Must be a whole number' else 'Must be a number' end);
        continue;
      end if;
      if c ? 'min' and v::numeric < (c->>'min')::numeric then
        errors := errors || jsonb_build_object('column', k, 'value', v, 'message', 'Must not be below ' || (c->>'min'));
        continue;
      end if;
      normalized := normalized || jsonb_build_object(k, v::numeric);
    elsif t = 'date' then
      if v !~ '^\d{4}-\d{2}-\d{2}' then
        errors := errors || jsonb_build_object('column', k, 'value', v, 'message', 'Must be a date YYYY-MM-DD');
        continue;
      end if;
      begin
        normalized := normalized || jsonb_build_object(k, left(v, 10)::date);
      exception when others then
        errors := errors || jsonb_build_object('column', k, 'value', v, 'message', 'Not a valid date');
      end;
    elsif t = 'boolean' then
      if lower(v) in ('yes', 'y', 'true', '1') then normalized := normalized || jsonb_build_object(k, true);
      elsif lower(v) in ('no', 'n', 'false', '0') then normalized := normalized || jsonb_build_object(k, false);
      else errors := errors || jsonb_build_object('column', k, 'value', v, 'message', 'Must be YES or NO');
      end if;
    elsif t = 'enum' then
      if not exists (select 1 from jsonb_array_elements_text(c->'values') a where upper(a) = upper(v)) then
        errors := errors || jsonb_build_object('column', k, 'value', v, 'message',
                                               'Allowed: ' || (select string_agg(a, ', ') from jsonb_array_elements_text(c->'values') a));
        continue;
      end if;
      normalized := normalized || jsonb_build_object(k, (select a from jsonb_array_elements_text(c->'values') a where upper(a) = upper(v)));
    elsif t = 'email' then
      if lower(v) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        errors := errors || jsonb_build_object('column', k, 'value', v, 'message', 'Not a valid email address');
        continue;
      end if;
      normalized := normalized || jsonb_build_object(k, lower(v));
    else
      if length(v) > 500 then
        errors := errors || jsonb_build_object('column', k, 'value', left(v, 50), 'message', 'Too long (max 500 characters)');
        continue;
      end if;
      normalized := normalized || jsonb_build_object(k, v);
    end if;
  end loop;
end;
$$;

-- custom cf_<key> columns → custom jsonb (validated by app.validate_custom)
create or replace function app.import_custom(p_row jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_object_agg(substr(k, 4), v), '{}') from jsonb_each(p_row) as x(k, v) where k like 'cf\_%'
$$;

create or replace function app.err(p_column text, p_value text, p_message text)
returns jsonb language sql immutable as
  $$ select jsonb_build_array(jsonb_build_object('column', p_column, 'value', p_value, 'message', p_message)) $$;

-- -----------------------------------------------------------------------------
-- Entity checks: (company, normalized row, update_existing)
--   → {errors[], action CREATE|UPDATE, target_id, resolved{}}
-- -----------------------------------------------------------------------------
create or replace function app.unit_by_code(p_company_id uuid, p_code text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.units where upper(code) = upper(p_code) and (company_id = p_company_id or company_id is null)
  order by company_id nulls last limit 1
$$;

create or replace function app.import_check(p_company_id uuid, p_entity text, r jsonb, p_update boolean)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare
  e jsonb := '[]'; v_id uuid; v_action text := 'CREATE'; res jsonb := '{}';
  v_item uuid; v_party uuid; v_godown uuid; v_unit uuid; v_x uuid; v_n numeric; v_roles text[]; i public.items;
begin
  case p_entity
  -- ------------------------------------------------------------------ ITEMS
  when 'ITEMS' then
    select * into i from public.items where company_id = p_company_id and upper(code) = upper(r->>'code');
    v_id := i.id;
    if v_id is not null then
      if not p_update then e := e || app.err('code', r->>'code', 'Item already exists (choose "update existing records" to change it)');
      elsif not app.scope_allows(p_company_id, 'ITEM', v_id) then e := e || app.err('code', r->>'code', 'Item is outside your data scope');
      elsif not app.has_permission(p_company_id, 'items.edit') then e := e || app.err('code', r->>'code', 'Permission items.edit is required to update items');
      else v_action := 'UPDATE'; end if;
    elsif not app.has_permission(p_company_id, 'items.create') then
      e := e || app.err('code', r->>'code', 'Permission items.create is required');
    elsif app.user_scope_ids(auth.uid(), p_company_id, 'ITEM') is not null then
      e := e || app.err('code', r->>'code', 'Users with an item scope cannot create items');
    end if;
    v_unit := app.unit_by_code(p_company_id, r->>'base_unit');
    if v_unit is null then e := e || app.err('base_unit', r->>'base_unit', 'Unknown unit');
    elsif v_action = 'UPDATE' and i.base_unit_id <> v_unit then e := e || app.err('base_unit', r->>'base_unit', 'The base unit of an existing item cannot be changed by import');
    end if;
    res := res || jsonb_build_object('base_unit_id', v_unit);
    if r ? 'pack_unit' then
      v_x := app.unit_by_code(p_company_id, r->>'pack_unit');
      if v_x is null then e := e || app.err('pack_unit', r->>'pack_unit', 'Unknown unit');
      elsif v_x = v_unit then e := e || app.err('pack_unit', r->>'pack_unit', 'Packing unit must differ from the base unit');
      elsif coalesce((r->>'pack_factor')::numeric, 0) <= 0 then e := e || app.err('pack_factor', r->>'pack_factor', 'Required (> 0) with a packing unit');
      end if;
      res := res || jsonb_build_object('pack_unit_id', v_x);
    end if;
    foreach v_n in array array[1, 2] loop
      declare k text := case v_n when 1 then 'purchase_unit' else 'sales_unit' end;
      begin
        if r ? k then
          v_x := app.unit_by_code(p_company_id, r->>k);
          if v_x is null then e := e || app.err(k, r->>k, 'Unknown unit');
          elsif v_x <> v_unit and v_x is distinct from (res->>'pack_unit_id')::uuid
                and not exists (select 1 from public.item_packings where item_id = v_id and unit_id = v_x) then
            e := e || app.err(k, r->>k, 'Must be the base unit or the packing unit');
          end if;
          res := res || jsonb_build_object(k || '_id', v_x);
        end if;
      end;
    end loop;
    if r ? 'category' then
      select id into v_x from public.item_categories where company_id = p_company_id and not is_deleted
        and (upper(code) = upper(r->>'category') or upper(name) = upper(r->>'category')) limit 1;
      if v_x is null then e := e || app.err('category', r->>'category', 'Unknown category'); end if;
      res := res || jsonb_build_object('category_id', v_x);
    end if;
    if r ? 'brand' then
      select id into v_x from public.brands where company_id = p_company_id and not is_deleted
        and (upper(code) = upper(r->>'brand') or upper(name) = upper(r->>'brand')) limit 1;
      if v_x is null then e := e || app.err('brand', r->>'brand', 'Unknown brand'); end if;
      res := res || jsonb_build_object('brand_id', v_x);
    end if;
    if (r ? 'sale_price' or r ? 'purchase_price') and not app.has_permission(p_company_id, 'items.edit_rate') then
      e := e || app.err(case when r ? 'sale_price' then 'sale_price' else 'purchase_price' end, null, 'Permission items.edit_rate is required to import rates');
    end if;
    if r ? 'barcode' and exists (select 1 from public.items where company_id = p_company_id and barcode = r->>'barcode' and id is distinct from v_id) then
      e := e || app.err('barcode', r->>'barcode', 'Barcode is used by another item');
    end if;
    if r ? 'sku' and exists (select 1 from public.items where company_id = p_company_id and upper(sku) = upper(r->>'sku') and id is distinct from v_id) then
      e := e || app.err('sku', r->>'sku', 'SKU is used by another item');
    end if;
    begin
      res := res || jsonb_build_object('custom', app.validate_custom(p_company_id, array['ITEM'],
                                         case when v_action = 'UPDATE' then i.custom else '{}'::jsonb end || app.import_custom(r), true));
    exception when others then e := e || app.err('custom', null, sqlerrm);
    end;
  -- ------------------------------------------------------------- ITEM_RATES
  when 'ITEM_RATES' then
    v_action := 'UPDATE';
    select id into v_id from public.items where company_id = p_company_id and upper(code) = upper(r->>'item_code');
    if v_id is null or not app.scope_allows(p_company_id, 'ITEM', v_id) then e := e || app.err('item_code', r->>'item_code', 'Unknown item'); end if;
    if not app.has_permission(p_company_id, 'items.edit_rate') then e := e || app.err('rate', null, 'Permission items.edit_rate is required'); end if;
  -- -------------------------------------------- CUSTOMER_RATES / VENDOR_RATES
  when 'CUSTOMER_RATES', 'VENDOR_RATES' then
    declare k text := case p_entity when 'CUSTOMER_RATES' then 'customer_code' else 'vendor_code' end;
    begin
      select id into v_party from public.parties where company_id = p_company_id and upper(code) = upper(r->>k);
      if v_party is null or not app.party_allowed(p_company_id, v_party)
         or (p_entity = 'CUSTOMER_RATES' and not app.party_is_customer(v_party))
         or (p_entity = 'VENDOR_RATES' and not app.party_is_vendor(v_party)) then
        e := e || app.err(k, r->>k, case p_entity when 'CUSTOMER_RATES' then 'Unknown customer' else 'Unknown vendor' end);
      end if;
      select id into v_item from public.items where company_id = p_company_id and upper(code) = upper(r->>'item_code');
      if v_item is null or not app.scope_allows(p_company_id, 'ITEM', v_item) then e := e || app.err('item_code', r->>'item_code', 'Unknown item'); end if;
      if not app.has_permission(p_company_id, 'items.edit_rate') then e := e || app.err('rate', null, 'Permission items.edit_rate is required'); end if;
      select id into v_id from public.party_item_rates where company_id = p_company_id and party_id = v_party and item_id = v_item
        and rate_type = case p_entity when 'CUSTOMER_RATES' then 'SALE' else 'PURCHASE' end
        and effective_from = coalesce((r->>'effective_from')::date, current_date);
      if v_id is not null then
        if p_update then v_action := 'UPDATE';
        else e := e || app.err('effective_from', r->>'effective_from', 'A rate for this date already exists (choose "update existing records")'); end if;
      elsif not app.has_permission(p_company_id, 'rates.create') then e := e || app.err('rate', null, 'Permission rates.create is required');
      end if;
      res := jsonb_build_object('party_id', v_party, 'item_id', v_item);
    end;
  -- ---------------------------------------------------- CUSTOMERS / VENDORS
  when 'CUSTOMERS', 'VENDORS' then
    select id, array(select role::text from public.party_roles where party_id = pa.id) into v_id, v_roles
    from public.parties pa where company_id = p_company_id and upper(code) = upper(r->>'code');
    if v_id is not null then
      if not p_update then e := e || app.err('code', r->>'code', 'Code already exists (choose "update existing records" to change it)');
      elsif not app.party_allowed(p_company_id, v_id) then e := e || app.err('code', r->>'code', 'Record is outside your data scope');
      elsif not app.has_permission(p_company_id, 'parties.edit') then e := e || app.err('code', r->>'code', 'Permission parties.edit is required');
      else v_action := 'UPDATE'; end if;
    elsif not app.has_permission(p_company_id, 'parties.create') then
      e := e || app.err('code', r->>'code', 'Permission parties.create is required');
    elsif app.user_scope_ids(auth.uid(), p_company_id, case p_entity when 'CUSTOMERS' then 'CUSTOMER' else 'VENDOR' end) is not null then
      e := e || app.err('code', r->>'code', 'Users with a customer / vendor scope cannot create new ones');
    end if;
    begin
      res := jsonb_build_object('custom', app.validate_custom(p_company_id,
               array[case p_entity when 'CUSTOMERS' then 'CUSTOMER' else 'VENDOR' end],
               coalesce((select custom from public.parties where id = v_id), '{}'::jsonb) || app.import_custom(r), true));
    exception when others then e := e || app.err('custom', null, sqlerrm);
    end;
  -- ----------------------------------------------------------------- GODOWNS
  when 'GODOWNS' then
    select id into v_id from public.godowns where company_id = p_company_id and upper(code) = upper(r->>'code');
    if v_id is not null then
      if not p_update then e := e || app.err('code', r->>'code', 'Godown already exists (choose "update existing records")');
      elsif not app.scope_allows(p_company_id, 'GODOWN', v_id) then e := e || app.err('code', r->>'code', 'Godown is outside your data scope');
      elsif not app.has_permission(p_company_id, 'godowns.edit') then e := e || app.err('code', r->>'code', 'Permission godowns.edit is required');
      else v_action := 'UPDATE'; end if;
    elsif not app.has_permission(p_company_id, 'godowns.create') then e := e || app.err('code', r->>'code', 'Permission godowns.create is required');
    elsif app.user_scope_ids(auth.uid(), p_company_id, 'GODOWN') is not null then
      e := e || app.err('code', r->>'code', 'Users with a godown scope cannot create godowns');
    end if;
  -- --------------------------------------------------------------- LOCATIONS
  when 'LOCATIONS' then
    select id into v_godown from public.godowns where company_id = p_company_id and upper(code) = upper(r->>'godown_code');
    if v_godown is null or not app.scope_allows(p_company_id, 'GODOWN', v_godown) then
      e := e || app.err('godown_code', r->>'godown_code', 'Unknown godown');
    end if;
    select id into v_id from public.storage_locations where godown_id = v_godown
      and upper(coalesce(rack, '')) = upper(coalesce(r->>'rack', '')) and upper(coalesce(shelf, '')) = upper(coalesce(r->>'shelf', ''))
      and upper(coalesce(bin, '')) = upper(coalesce(r->>'bin', ''));
    if v_id is not null then
      if not p_update then e := e || app.err('rack', r->>'rack', 'Location already exists (choose "update existing records")');
      elsif not app.has_permission(p_company_id, 'godowns.edit') then e := e || app.err('rack', null, 'Permission godowns.edit is required');
      else v_action := 'UPDATE'; end if;
    elsif not app.has_permission(p_company_id, 'godowns.create') then e := e || app.err('rack', null, 'Permission godowns.create is required');
    end if;
    res := jsonb_build_object('godown_id', v_godown);
  -- ----------------------------------------------------------- OPENING_STOCK
  when 'OPENING_STOCK' then
    select id into v_item from public.items where company_id = p_company_id and upper(code) = upper(r->>'item_code') and not is_deleted;
    if v_item is null or not app.scope_allows(p_company_id, 'ITEM', v_item) then e := e || app.err('item_code', r->>'item_code', 'Unknown item'); end if;
    select id into v_godown from public.godowns where company_id = p_company_id and upper(code) = upper(r->>'godown_code');
    if v_godown is null or not app.scope_allows(p_company_id, 'GODOWN', v_godown) then
      e := e || app.err('godown_code', r->>'godown_code', 'Unknown godown or outside your data scope');
    end if;
    if r ? 'location_code' then
      select id into v_x from public.storage_locations where godown_id = v_godown and upper(code) = upper(r->>'location_code') and is_active;
      if v_x is null then e := e || app.err('location_code', r->>'location_code', 'Unknown location in this godown'); end if;
      res := res || jsonb_build_object('location_id', v_x);
    end if;
    if coalesce((r->>'qty')::numeric, 0) <= 0 then e := e || app.err('qty', r->>'qty', 'Must be greater than 0'); end if;
    v_unit := coalesce(app.unit_by_code(p_company_id, r->>'unit'), (select base_unit_id from public.items where id = v_item));
    if r ? 'unit' and app.unit_by_code(p_company_id, r->>'unit') is null then e := e || app.err('unit', r->>'unit', 'Unknown unit');
    elsif v_item is not null then
      begin
        res := res || jsonb_build_object('unit_id', v_unit, 'factor', app.unit_factor(v_item, v_unit, coalesce((r->>'date')::date, current_date)));
      exception when others then e := e || app.err('unit', r->>'unit', 'Unit is not valid for this item');
      end;
    end if;
    if r ? 'rate' and not app.has_permission(p_company_id, 'items.edit_rate') then
      e := e || app.err('rate', null, 'Permission items.edit_rate is required to import a cost rate');
    end if;
    res := res || jsonb_build_object('item_id', v_item, 'godown_id', v_godown);
  -- ------------------------------------------------------------------- USERS
  when 'USERS' then
    select id into v_x from public.roles where company_id = p_company_id and upper(code) = upper(r->>'role_code') and kind = 'INTERNAL';
    if v_x is null then e := e || app.err('role_code', r->>'role_code', 'Unknown role');
    else
      begin
        perform app.assert_can_assign_role(p_company_id, null, v_x, false);
      exception when others then e := e || app.err('role_code', r->>'role_code', sqlerrm);
      end;
    end if;
    select u.id into v_id from auth.users u join public.user_roles ur on ur.user_id = u.id and ur.company_id = p_company_id
    where lower(u.email) = lower(r->>'email') limit 1;
    if v_id is not null then
      if not p_update then e := e || app.err('email', r->>'email', 'Already a user of this company (choose "update existing records" to update the details)');
      elsif not app.has_permission(p_company_id, 'users.edit') then e := e || app.err('email', null, 'Permission users.edit is required');
      elsif app.is_owner(v_id, p_company_id) and not app.is_owner(auth.uid(), p_company_id) then e := e || app.err('email', r->>'email', 'Only an owner can change an owner');
      else v_action := 'UPDATE'; end if;
    elsif not app.has_permission(p_company_id, 'users.create') then e := e || app.err('email', null, 'Permission users.create is required');
    end if;
    if r ? 'godown_codes' then
      declare g text; v_ids uuid[] := '{}';
      begin
        if not app.has_permission(p_company_id, 'users.assign_scope') then e := e || app.err('godown_codes', null, 'Permission users.assign_scope is required'); end if;
        foreach g in array string_to_array(r->>'godown_codes', ',') loop
          select id into v_godown from public.godowns where company_id = p_company_id and upper(code) = upper(btrim(g));
          if v_godown is null then e := e || app.err('godown_codes', btrim(g), 'Unknown godown'); else v_ids := v_ids || v_godown; end if;
        end loop;
        res := res || jsonb_build_object('godown_ids', to_jsonb(v_ids));
      end;
    end if;
    res := res || jsonb_build_object('role_id', v_x);
  else
    raise exception 'Unknown import %', p_entity using errcode = 'P0001';
  end case;
  return jsonb_build_object('errors', e, 'action', v_action, 'target_id', v_id, 'resolved', res);
end;
$$;

-- -----------------------------------------------------------------------------
-- Entity writes (one row; called inside the commit transaction)
-- -----------------------------------------------------------------------------
create or replace function app.import_apply(p_company_id uuid, p_entity text, p_job_id uuid, r jsonb, p_action text,
                                            p_target uuid, x jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_id uuid := p_target; v_user uuid; v_inv uuid;
begin
  case p_entity
  when 'ITEMS' then
    if p_action = 'CREATE' then
      insert into public.items (company_id, code, name, description, item_kind, category_id, brand_id, base_unit_id, barcode,
                                hsn_code, sku, gst_rate, min_stock, max_stock, reorder_level, purchase_price, sale_price,
                                is_active, portal_visible, notes, custom)
      values (p_company_id, upper(r->>'code'), r->>'name', r->>'description', (r->>'item_kind')::public.item_kind,
              (x->>'category_id')::uuid, (x->>'brand_id')::uuid, (x->>'base_unit_id')::uuid, r->>'barcode', r->>'hsn_code',
              r->>'sku', coalesce((r->>'gst_rate')::numeric, 0), coalesce((r->>'min_stock')::numeric, 0),
              coalesce((r->>'max_stock')::numeric, 0), coalesce((r->>'reorder_level')::numeric, 0),
              (r->>'purchase_price')::numeric, (r->>'sale_price')::numeric, coalesce((r->>'is_active')::boolean, true),
              coalesce((r->>'portal_visible')::boolean, true), r->>'notes', coalesce(x->'custom', '{}'))
      returning id into v_id;
    else
      update public.items set
        name = r->>'name', item_kind = (r->>'item_kind')::public.item_kind,
        description = case when r ? 'description' then r->>'description' else description end,
        category_id = case when x ? 'category_id' then (x->>'category_id')::uuid else category_id end,
        brand_id = case when x ? 'brand_id' then (x->>'brand_id')::uuid else brand_id end,
        barcode = case when r ? 'barcode' then r->>'barcode' else barcode end,
        hsn_code = case when r ? 'hsn_code' then r->>'hsn_code' else hsn_code end,
        sku = case when r ? 'sku' then r->>'sku' else sku end,
        gst_rate = coalesce((r->>'gst_rate')::numeric, gst_rate),
        min_stock = coalesce((r->>'min_stock')::numeric, min_stock),
        max_stock = coalesce((r->>'max_stock')::numeric, max_stock),
        reorder_level = coalesce((r->>'reorder_level')::numeric, reorder_level),
        purchase_price = case when r ? 'purchase_price' then (r->>'purchase_price')::numeric else purchase_price end,
        sale_price = case when r ? 'sale_price' then (r->>'sale_price')::numeric else sale_price end,
        is_active = coalesce((r->>'is_active')::boolean, is_active),
        portal_visible = coalesce((r->>'portal_visible')::boolean, portal_visible),
        notes = case when r ? 'notes' then r->>'notes' else notes end,
        custom = coalesce(x->'custom', custom)
      where id = v_id;
    end if;
    if x ? 'pack_unit_id' and x->>'pack_unit_id' is not null then
      insert into public.item_packings (item_id, unit_id, factor_to_base, is_default)
      select v_id, (x->>'pack_unit_id')::uuid, (r->>'pack_factor')::numeric, true
      where not exists (select 1 from public.item_packings where item_id = v_id and unit_id = (x->>'pack_unit_id')::uuid);
    end if;
    if x ? 'purchase_unit_id' or x ? 'sales_unit_id' then
      update public.items set purchase_unit_id = coalesce((x->>'purchase_unit_id')::uuid, purchase_unit_id),
                              sales_unit_id = coalesce((x->>'sales_unit_id')::uuid, sales_unit_id)
      where id = v_id;
    end if;
  when 'ITEM_RATES' then
    v_id := (select id from public.items where company_id = p_company_id and upper(code) = upper(r->>'item_code'));
    if r->>'rate_type' = 'SALE' then
      update public.items set sale_price = (r->>'rate')::numeric where id = v_id;
    else
      update public.items set purchase_price = (r->>'rate')::numeric where id = v_id;
    end if;
  when 'CUSTOMER_RATES', 'VENDOR_RATES' then
    if p_action = 'CREATE' then
      insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate, effective_from)
      values (p_company_id, case p_entity when 'CUSTOMER_RATES' then 'SALE' else 'PURCHASE' end, (x->>'party_id')::uuid,
              (x->>'item_id')::uuid, (r->>'rate')::numeric, coalesce((r->>'effective_from')::date, current_date))
      returning id into v_id;
    else
      update public.party_item_rates set rate = (r->>'rate')::numeric where id = v_id;
    end if;
  when 'CUSTOMERS', 'VENDORS' then
    v_id := public.party_save(p_company_id, v_id,
      (r - array(select k from jsonb_object_keys(r) k where k like 'cf\_%') - 'vendor_type')
      || jsonb_build_object('custom', x->'custom')
      || case when p_action = 'CREATE' then jsonb_build_object('roles', jsonb_build_array(
                case p_entity when 'CUSTOMERS' then 'CUSTOMER' else coalesce(r->>'vendor_type', 'SUPPLIER') end))
              else jsonb_build_object('roles', (select jsonb_agg(distinct x2) from (
                  select role::text x2 from public.party_roles where party_id = v_id
                  union select case p_entity when 'CUSTOMERS' then 'CUSTOMER' else coalesce(r->>'vendor_type', 'SUPPLIER') end) s)) end);
  when 'GODOWNS' then
    if p_action = 'CREATE' then
      insert into public.godowns (company_id, code, name, godown_type, portal_visible, is_active)
      values (p_company_id, upper(r->>'code'), r->>'name', coalesce(r->>'godown_type', 'OWN_STORE')::public.godown_type,
              coalesce((r->>'portal_visible')::boolean, true), coalesce((r->>'is_active')::boolean, true))
      returning id into v_id;
    else
      update public.godowns set name = r->>'name',
        godown_type = coalesce((r->>'godown_type')::public.godown_type, godown_type),
        portal_visible = coalesce((r->>'portal_visible')::boolean, portal_visible),
        is_active = coalesce((r->>'is_active')::boolean, is_active)
      where id = v_id;
    end if;
  when 'LOCATIONS' then
    if p_action = 'CREATE' then
      insert into public.storage_locations (company_id, godown_id, zone, rack, shelf, bin, remarks, is_active)
      values (p_company_id, (x->>'godown_id')::uuid, r->>'zone', r->>'rack', r->>'shelf', r->>'bin', r->>'remarks',
              coalesce((r->>'is_active')::boolean, true))
      returning id into v_id;
    else
      update public.storage_locations set zone = coalesce(r->>'zone', zone), remarks = coalesce(r->>'remarks', remarks),
             is_active = coalesce((r->>'is_active')::boolean, is_active)
      where id = v_id;
    end if;
  when 'OPENING_STOCK' then
    perform app.post_stock(p_company_id, (x->>'item_id')::uuid, (x->>'godown_id')::uuid,
                           coalesce((r->>'date')::date, current_date), 'OPENING', 1::smallint, (r->>'qty')::numeric,
                           (x->>'unit_id')::uuid, (x->>'factor')::numeric, (r->>'rate')::numeric, null,
                           'import_jobs', p_job_id, null, 'IMPORT', (x->>'location_id')::uuid);
    v_id := (x->>'item_id')::uuid;
  when 'USERS' then
    if p_action = 'CREATE' then
      v_inv := public.user_invite(p_company_id, r->>'email', (select code from public.roles where id = (x->>'role_id')::uuid), r->>'full_name');
      update public.user_invitations set details = r || jsonb_build_object('godown_ids', x->'godown_ids') where id = v_inv;
      select claimed_by into v_user from public.user_invitations where id = v_inv;
      if v_user is not null then
        perform app.apply_invitation_details(v_inv);
      end if;
      v_id := v_inv;
    else
      select u.id into v_user from auth.users u where lower(u.email) = lower(r->>'email');
      update public.company_users set
        mobile = coalesce(r->>'mobile', mobile), department = coalesce(r->>'department', department),
        designation = coalesce(r->>'designation', designation), employee_code = coalesce(r->>'employee_code', employee_code)
      where company_id = p_company_id and user_id = v_user;
      if r ? 'full_name' then update public.profiles set full_name = r->>'full_name' where id = v_user; end if;
      v_id := v_user;
    end if;
  end case;
  return v_id;
end;
$$;

-- Invitation details (from the users import) applied when the invitation is
-- claimed or immediately for an existing login.
alter table public.user_invitations add column details jsonb;

create or replace function app.apply_invitation_details(p_invitation_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare i public.user_invitations;
begin
  select * into i from public.user_invitations where id = p_invitation_id;
  if i.claimed_by is null or i.details is null then
    return;
  end if;
  insert into public.company_users (company_id, user_id) values (i.company_id, i.claimed_by) on conflict do nothing;
  update public.company_users set
    mobile = coalesce(i.details->>'mobile', mobile), department = coalesce(i.details->>'department', department),
    designation = coalesce(i.details->>'designation', designation), employee_code = coalesce(i.details->>'employee_code', employee_code)
  where company_id = i.company_id and user_id = i.claimed_by;
  if jsonb_array_length(coalesce(i.details->'godown_ids', '[]')) > 0 and not app.is_owner(i.claimed_by, i.company_id) then
    delete from public.user_data_scopes where company_id = i.company_id and user_id = i.claimed_by and dimension = 'GODOWN';
    insert into public.user_data_scopes (company_id, user_id, dimension, entity_id, created_by)
    select i.company_id, i.claimed_by, 'GODOWN', g::uuid, i.invited_by from jsonb_array_elements_text(i.details->'godown_ids') g
    on conflict do nothing;
  end if;
end;
$$;

create or replace function app.tg_invitation_claimed()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.claimed_by is not null and old.claimed_by is null and new.details is not null then
    perform app.apply_invitation_details(new.id);
  end if;
  return new;
end;
$$;
create trigger user_invitations_claimed after update of claimed_by on public.user_invitations
  for each row execute function app.tg_invitation_claimed();

-- -----------------------------------------------------------------------------
-- Validate the whole file
-- -----------------------------------------------------------------------------
create or replace function app.import_run_validation(p_job public.import_jobs)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  ent app.import_entities; v_cols jsonb; x record; t record; c jsonb; v_errs jsonb;
  v_dups jsonb;
begin
  select * into ent from app.import_entities where code = p_job.entity;
  v_cols := app.import_columns(p_job.company_id, p_job.entity);
  delete from public.import_errors where job_id = p_job.id and row_no > 0;
  -- duplicates in the file (set-based): row → first row with the same key
  select coalesce(jsonb_object_agg(row_no::text, first_row), '{}') into v_dups
  from (select row_no, min(row_no) over (partition by k) as first_row
        from (select ir.row_no, (select string_agg(upper(btrim(coalesce(ir.data->>kc, ''))), '|' order by ord)
                                 from unnest(ent.key_columns) with ordinality as kk(kc, ord)) as k
              from public.import_rows ir where ir.job_id = p_job.id) a) b
  where row_no <> first_row;
  for x in select * from public.import_rows where job_id = p_job.id order by row_no loop
    select * into t from app.import_typed(v_cols, x.data);
    v_errs := t.errors;
    -- unknown keys sent for this row
    v_errs := v_errs || coalesce((select jsonb_agg(jsonb_build_object('column', k, 'value', x.data->>k, 'message', 'Unknown column'))
                                  from jsonb_object_keys(x.data) k
                                  where not exists (select 1 from jsonb_array_elements(v_cols) cc where cc->>'key' = k)), '[]');
    -- duplicates in the file
    if v_dups ? x.row_no::text then
      v_errs := v_errs || jsonb_build_object('column', ent.key_columns[1], 'value', t.normalized->>ent.key_columns[1],
                                             'message', 'Duplicate of row ' || (v_dups->>x.row_no::text));
      update public.import_rows set status = 'ERROR', normalized = t.normalized, action = null where job_id = p_job.id and row_no = x.row_no;
      insert into public.import_errors (job_id, row_no, column_key, value, message)
      select p_job.id, x.row_no, e->>'column', e->>'value', e->>'message' from jsonb_array_elements(v_errs) e;
      update public.import_jobs set duplicate_rows = duplicate_rows + 1 where id = p_job.id;
      continue;
    end if;
    if jsonb_array_length(t.errors) = 0 then
      c := app.import_check(p_job.company_id, p_job.entity, t.normalized, p_job.update_existing);
      v_errs := v_errs || (c->'errors');
    end if;
    update public.import_rows
       set normalized = t.normalized || jsonb_build_object('_resolved', c->'resolved'),
           action = case when jsonb_array_length(v_errs) = 0 then c->>'action' end,
           target_id = (c->>'target_id')::uuid,
           status = case when jsonb_array_length(v_errs) = 0 then 'VALID' else 'ERROR' end
     where job_id = p_job.id and row_no = x.row_no;
    insert into public.import_errors (job_id, row_no, column_key, value, message)
    select p_job.id, x.row_no, e->>'column', e->>'value', e->>'message' from jsonb_array_elements(v_errs) e;
    c := null;
  end loop;
  update public.import_jobs j set
    status = 'VALIDATED', validated_at = now(),
    valid_rows = (select count(*) from public.import_rows where job_id = j.id and status = 'VALID'),
    invalid_rows = (select count(*) from public.import_rows where job_id = j.id and status = 'ERROR'),
    create_rows = (select count(*) from public.import_rows where job_id = j.id and status = 'VALID' and action = 'CREATE'),
    update_rows = (select count(*) from public.import_rows where job_id = j.id and status = 'VALID' and action = 'UPDATE')
  where id = p_job.id;
  return (select to_jsonb(j) - 'columns' || jsonb_build_object(
            'header_errors', (select count(*) from public.import_errors where job_id = j.id and row_no = 0))
          from public.import_jobs j where id = p_job.id);
end;
$$;

create or replace function public.import_validate(p_job_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare j public.import_jobs := app.import_job_for(p_job_id);
begin
  if j.status not in ('STAGING', 'VALIDATED') then
    raise exception 'This import is already %', lower(j.status) using errcode = 'P0001';
  end if;
  update public.import_jobs set duplicate_rows = 0 where id = j.id;
  return app.import_run_validation(j);
end;
$$;

-- A large import grows tables inside one transaction; plans cached while a
-- table was small would scan it again for every row. Refreshing the
-- statistics every 1,000 rows re-plans them (index lookups).
create or replace function app.import_refresh_stats(p_entity text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  case p_entity
    when 'ITEMS' then analyze public.items, public.item_packings, public.item_rate_history;
    when 'ITEM_RATES' then analyze public.items, public.item_rate_history;
    when 'CUSTOMERS', 'VENDORS' then analyze public.parties, public.party_roles;
    when 'CUSTOMER_RATES', 'VENDOR_RATES' then analyze public.party_item_rates, public.item_rate_history;
    when 'GODOWNS', 'LOCATIONS' then analyze public.godowns, public.storage_locations;
    when 'OPENING_STOCK' then analyze public.stock_movements, public.stock_balances;
    else null;
  end case;
end;
$$;
revoke all on function app.import_refresh_stats(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Commit (explicit confirmation required)
-- -----------------------------------------------------------------------------
create or replace function public.import_commit(p_job_id uuid, p_confirm boolean)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  j public.import_jobs := app.import_job_for(p_job_id); v jsonb; x public.import_rows; v_id uuid;
  v_ok integer := 0; v_failed integer := 0; v_hdr integer;
  v_done integer[] := '{}'; v_ids uuid[] := '{}'; v_fail integer[] := '{}'; v_msgs text[] := '{}';
begin
  if not coalesce(p_confirm, false) then
    raise exception 'Confirm the import to write the data' using errcode = 'P0001';
  end if;
  if j.status <> 'VALIDATED' then
    raise exception 'Validate the file before importing' using errcode = 'P0001';
  end if;
  select count(*) into v_hdr from public.import_errors where job_id = j.id and row_no = 0;
  if v_hdr > 0 then
    raise exception 'The file has column errors — fix the header row' using errcode = 'P0001';
  end if;
  -- The preview must be recent. Every write still passes the database rules
  -- (constraints, scope and rate triggers, permissions below), so a change
  -- since the preview makes the row fail instead of slipping through.
  if j.validated_at < now() - interval '15 minutes' then
    raise exception 'The preview is older than 15 minutes — validate the file again' using errcode = 'P0001';
  end if;
  perform app.require_permission(j.company_id, p)
  from (select distinct unnest(case
          when j.entity in ('ITEMS') then array[case a.action when 'CREATE' then 'items.create' else 'items.edit' end]
          when j.entity in ('CUSTOMERS', 'VENDORS') then array[case a.action when 'CREATE' then 'parties.create' else 'parties.edit' end]
          when j.entity in ('GODOWNS', 'LOCATIONS') then array[case a.action when 'CREATE' then 'godowns.create' else 'godowns.edit' end]
          when j.entity in ('CUSTOMER_RATES', 'VENDOR_RATES') then array['items.edit_rate', case a.action when 'CREATE' then 'rates.create' else 'rates.edit' end]
          when j.entity = 'ITEM_RATES' then array['items.edit_rate']
          when j.entity = 'USERS' then array[case a.action when 'CREATE' then 'users.create' else 'users.edit' end]
          else array[]::text[] end) p
        from (select distinct action from public.import_rows where job_id = j.id and status = 'VALID') a) q;
  v := (select to_jsonb(jj) - 'columns' from public.import_jobs jj where id = j.id);
  if j.mode = 'ALL_OR_NOTHING' and (v->>'invalid_rows')::int > 0 then
    return v || jsonb_build_object('committed', false, 'message', 'Nothing was imported: the file has errors (all-or-nothing)');
  end if;
  if (v->>'valid_rows')::int = 0 then
    return v || jsonb_build_object('committed', false, 'message', 'No valid rows');
  end if;

  if j.mode = 'ALL_OR_NOTHING' then
    begin
      foreach x in array array(select ir from public.import_rows ir where ir.job_id = j.id and ir.status = 'VALID' order by ir.row_no) loop
        v_id := app.import_apply(j.company_id, j.entity, j.id, x.normalized - '_resolved', x.action, x.target_id, x.normalized->'_resolved');
        v_done := v_done || x.row_no; v_ids := v_ids || v_id;
        v_ok := v_ok + 1;
        if v_ok % 1000 = 0 then perform app.import_refresh_stats(j.entity); end if;
      end loop;
    exception when others then
      -- every change of this block is rolled back: nothing was imported
      insert into public.import_errors (job_id, row_no, column_key, message) values (j.id, coalesce(x.row_no, 0), null, sqlerrm);
      update public.import_jobs set status = 'FAILED', error = 'Row ' || coalesce(x.row_no, 0) || ': ' || sqlerrm,
             imported_rows = 0, committed_at = now() where id = j.id;
      perform app.audit(j.company_id, 'import_jobs', j.id::text, 'IMPORT_FAILED', null,
                        jsonb_build_object('entity', j.entity, 'error', sqlerrm, 'row', x.row_no));
      return (select to_jsonb(jj) - 'columns' from public.import_jobs jj where id = j.id)
             || jsonb_build_object('committed', false, 'message', 'Nothing was imported: row ' || coalesce(x.row_no, 0) || ' failed — ' || sqlerrm);
    end;
  else
    foreach x in array array(select ir from public.import_rows ir where ir.job_id = j.id and ir.status = 'VALID' order by ir.row_no) loop
      begin
        v_id := app.import_apply(j.company_id, j.entity, j.id, x.normalized - '_resolved', x.action, x.target_id, x.normalized->'_resolved');
        v_done := v_done || x.row_no; v_ids := v_ids || v_id;
        v_ok := v_ok + 1;
        if v_ok % 1000 = 0 then perform app.import_refresh_stats(j.entity); end if;
      exception when others then
        v_fail := v_fail || x.row_no; v_msgs := v_msgs || sqlerrm;
        v_failed := v_failed + 1;
      end;
    end loop;
    update public.import_rows ir set status = 'FAILED' from unnest(v_fail) f(row_no)
     where ir.job_id = j.id and ir.row_no = f.row_no;
    insert into public.import_errors (job_id, row_no, column_key, message)
    select j.id, f.row_no, null, f.msg from unnest(v_fail, v_msgs) f(row_no, msg);
  end if;
  -- row status in one statement (row-by-row updates inside the write loop do not scale)
  update public.import_rows ir set status = 'IMPORTED', target_id = d.id from unnest(v_done, v_ids) d(row_no, id)
   where ir.job_id = j.id and ir.row_no = d.row_no;
  update public.import_jobs set status = 'COMMITTED', committed_at = now(), imported_rows = v_ok, failed_rows = v_failed
  where id = j.id;
  perform app.audit(j.company_id, 'import_jobs', j.id::text, 'IMPORT', null,
                    jsonb_build_object('entity', j.entity, 'file', j.file_name, 'mode', j.mode, 'update_existing', j.update_existing,
                                       'imported', v_ok, 'failed', v_failed, 'skipped_invalid', (v->>'invalid_rows')::int));
  return (select to_jsonb(jj) - 'columns' from public.import_jobs jj where id = j.id) || jsonb_build_object('committed', true);
end;
$$;

create or replace function public.import_cancel(p_job_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare j public.import_jobs := app.import_job_for(p_job_id);
begin
  if j.status in ('STAGING', 'VALIDATED') then
    update public.import_jobs set status = 'CANCELLED' where id = j.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Export: executed with the caller's rights (SECURITY INVOKER)
-- -----------------------------------------------------------------------------
create or replace function app.log_export(p_company_id uuid, p_entity text, p_rows integer)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.export_log (company_id, entity, row_count, created_by) values (p_company_id, p_entity, p_rows, auth.uid());
  perform app.audit(p_company_id, 'export_log', p_entity, 'EXPORT', null, jsonb_build_object('entity', p_entity, 'rows', p_rows));
end;
$$;

create or replace function public.export_rows(p_company_id uuid, p_entity text)
returns jsonb
language plpgsql
set search_path = public, app, pg_temp
as $$
declare e app.import_entities; v jsonb;
begin
  select * into e from app.import_entities where code = upper(p_entity);
  if e.code is null or not app.is_member(p_company_id) then
    raise exception 'Unknown export' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, e.export_permission);
  case e.code
  when 'ITEMS' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'code', i.code, 'name', i.name, 'description', i.description, 'item_kind', i.item_kind,
      'category', c.code, 'brand', b.code, 'base_unit', u.code, 'pack_unit', pu.code, 'pack_factor', pk.factor_to_base,
      'purchase_unit', u2.code, 'sales_unit', u3.code, 'barcode', i.barcode, 'hsn_code', i.hsn_code, 'sku', i.sku,
      'gst_rate', i.gst_rate, 'min_stock', i.min_stock, 'max_stock', i.max_stock, 'reorder_level', i.reorder_level,
      'purchase_price', i.purchase_price, 'sale_price', i.sale_price,
      'is_active', case when i.is_active then 'YES' else 'NO' end, 'portal_visible', case when i.portal_visible then 'YES' else 'NO' end,
      'notes', i.notes) || coalesce((select jsonb_object_agg('cf_' || k, val) from jsonb_each(i.custom) as cx(k, val)), '{}'))
      order by i.code) into v
    from public.v_items i
    join public.units u on u.id = i.base_unit_id
    left join public.item_categories c on c.id = i.category_id
    left join public.brands b on b.id = i.brand_id
    left join public.units u2 on u2.id = i.purchase_unit_id
    left join public.units u3 on u3.id = i.sales_unit_id
    left join lateral (select unit_id, factor_to_base from public.item_packings where item_id = i.id order by is_default desc, effective_from desc limit 1) pk on true
    left join public.units pu on pu.id = pk.unit_id
    where i.company_id = p_company_id and not i.is_deleted;
  when 'ITEM_RATES' then
    select jsonb_agg(x order by x->>'item_code', x->>'rate_type') into v from (
      select jsonb_build_object('item_code', i.code, 'rate_type', 'SALE', 'rate', i.sale_price) x
      from public.v_items i where i.company_id = p_company_id and i.sale_price is not null and not i.is_deleted
      union all
      select jsonb_build_object('item_code', i.code, 'rate_type', 'PURCHASE', 'rate', i.purchase_price)
      from public.v_items i where i.company_id = p_company_id and i.purchase_price is not null and not i.is_deleted) s;
  when 'CUSTOMER_RATES', 'VENDOR_RATES' then
    select jsonb_agg(jsonb_build_object(case e.code when 'CUSTOMER_RATES' then 'customer_code' else 'vendor_code' end, p.code,
                                        'item_code', i.code, 'rate', r.rate, 'effective_from', r.effective_from)
                     order by p.code, i.code, r.effective_from) into v
    from public.party_item_rates r
    join public.parties p on p.id = r.party_id
    join public.items i on i.id = r.item_id
    where r.company_id = p_company_id and r.rate_type = case e.code when 'CUSTOMER_RATES' then 'SALE' else 'PURCHASE' end;
  when 'CUSTOMERS', 'VENDORS' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'code', p.code, 'name', p.name, 'contact_person', p.contact_person, 'mobile', p.mobile, 'phone', p.phone, 'email', p.email,
      'gstin', p.gstin, 'pan', p.pan, 'address', p.address, 'city', p.city, 'state_code', p.state_code, 'pincode', p.pincode,
      'credit_days', p.credit_days, 'credit_limit', case when e.code = 'CUSTOMERS' then p.credit_limit end,
      'payment_terms', p.payment_terms, 'is_active', case when p.is_active then 'YES' else 'NO' end, 'notes', p.notes,
      'vendor_type', case when e.code = 'VENDORS' then (select min(role::text) from public.party_roles r
                                                       where r.party_id = p.id and r.role in ('SUPPLIER', 'JOB_WORKER', 'CUTTER')) end)
      || coalesce((select jsonb_object_agg('cf_' || k, val) from jsonb_each(p.custom) as cx(k, val)), '{}')) order by p.code) into v
    from public.parties p
    where p.company_id = p_company_id and not p.is_deleted
      and exists (select 1 from public.party_roles r where r.party_id = p.id
                  and (case e.code when 'CUSTOMERS' then r.role = 'CUSTOMER' else r.role in ('SUPPLIER', 'JOB_WORKER', 'CUTTER') end));
  when 'GODOWNS' then
    select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'godown_type', g.godown_type,
                                        'portal_visible', case when g.portal_visible then 'YES' else 'NO' end,
                                        'is_active', case when g.is_active then 'YES' else 'NO' end) order by g.code) into v
    from public.godowns g where g.company_id = p_company_id and not g.is_deleted;
  when 'LOCATIONS' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('godown_code', g.code, 'zone', l.zone, 'rack', l.rack, 'shelf', l.shelf,
                                        'bin', l.bin, 'remarks', l.remarks, 'is_active', case when l.is_active then 'YES' else 'NO' end))
                     order by g.code, l.code) into v
    from public.storage_locations l join public.godowns g on g.id = l.godown_id
    where l.company_id = p_company_id and not l.is_default;
  when 'OPENING_STOCK' then
    select jsonb_agg(jsonb_build_object('item_code', i.code, 'godown_code', g.code, 'location_code', l.code,
                                        'qty', b.base_qty, 'unit', u.code) order by i.code, g.code, l.code) into v
    from public.stock_balances b
    join public.items i on i.id = b.item_id
    join public.godowns g on g.id = b.godown_id
    join public.storage_locations l on l.id = b.location_id
    join public.units u on u.id = i.base_unit_id
    where b.company_id = p_company_id and b.base_qty <> 0;
  when 'USERS' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('email', x->>'email', 'full_name', x->>'full_name',
             'role_code', (select string_agg(r->>'code', ',') from jsonb_array_elements(x->'roles') r),
             'mobile', x->>'mobile', 'department', x->>'department', 'designation', x->>'designation',
             'employee_code', x->>'employee_code',
             'godown_codes', (select string_agg(g.code, ',') from public.godowns g
                              where g.id in (select (jsonb_array_elements_text(x->'godown_ids'))::uuid)))))
      into v
    from jsonb_array_elements(public.admin_users(p_company_id)) x where x->>'kind' = 'INTERNAL';
  end case;
  v := coalesce(v, '[]');
  perform app.log_export(p_company_id, e.code, jsonb_array_length(v));
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
alter table public.import_errors enable row level security;
alter table public.export_log enable row level security;
create policy import_jobs_read on public.import_jobs for select to authenticated
  using (created_by = auth.uid() and company_id = any ((select app.user_company_ids())::uuid[]));
create policy import_rows_read on public.import_rows for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id));
create policy import_errors_read on public.import_errors for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id));
create policy export_log_read on public.export_log for select to authenticated
  using (company_id = any ((select app.permitted_company_ids('audit.view'))::uuid[]) or created_by = auth.uid());

revoke all on public.import_jobs, public.import_rows, public.import_errors, public.export_log from anon;
grant select on public.import_jobs, public.import_rows, public.import_errors, public.export_log to authenticated;
revoke insert, update, delete, truncate on public.import_jobs, public.import_rows, public.import_errors, public.export_log
  from authenticated;
grant all on public.import_jobs, public.import_rows, public.import_errors, public.export_log to service_role;
grant usage, select on sequence public.import_errors_id_seq, public.export_log_id_seq to service_role;

revoke all on function public.import_entities(uuid), public.import_create(uuid, text, text, text, boolean, text[]),
                       public.import_add_rows(uuid, jsonb), public.import_validate(uuid), public.import_commit(uuid, boolean),
                       public.import_cancel(uuid), public.export_rows(uuid, text) from public, anon;
grant execute on function public.import_entities(uuid), public.import_create(uuid, text, text, text, boolean, text[]),
                          public.import_add_rows(uuid, jsonb), public.import_validate(uuid), public.import_commit(uuid, boolean),
                          public.import_cancel(uuid), public.export_rows(uuid, text) to authenticated, service_role;
-- used by the invoker export function
grant execute on function app.log_export(uuid, text, integer), app.require_permission(uuid, text) to authenticated;
revoke all on function app.tg_invitation_claimed() from public, anon, authenticated;
grant select on app.import_entities to authenticated;   -- column definitions (configuration, no data)
