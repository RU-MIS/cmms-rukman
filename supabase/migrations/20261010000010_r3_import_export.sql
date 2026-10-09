-- =============================================================================
-- PLATFORM R3 (10/10) — import / export completion (W11)
--   * saved column mappings per company and entity (import_templates); the
--     mapping used is stored on the job
--   * "did you mean …" suggestions for unknown references (pg_trgm), only
--     among records the importer can see
--   * new entities: UNITS, CATEGORIES (with parent = subcategory), BRANDS,
--     ITEM_PACKINGS, PARTY_ADDRESSES, ROLE_ASSIGNMENTS; export GODOWN_STOCK;
--     stock exports carry average cost / value only with the cost rights
--   * item columns part number / model / reorder qty / sale rate limits;
--     party columns legal name / status
--   * opening-stock rates need the landed-cost right (D3)
-- New entities are handled by a dispatcher in front of the R2 functions.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Saved mappings
-- -----------------------------------------------------------------------------
create table public.import_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  entity     text not null references app.import_entities (code),
  name       text not null check (length(trim(name)) between 1 and 80),
  mapping    jsonb not null check (jsonb_typeof(mapping) = 'object'),   -- {"file header": "column key"}
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (company_id, entity, name)
);
alter table public.import_templates enable row level security;
create policy import_templates_read on public.import_templates for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
grant select on public.import_templates to authenticated;
grant all on public.import_templates to service_role;
alter table public.import_jobs add column mapping jsonb;
alter table public.import_errors add column suggestion text;

create or replace function public.import_template_save(p_company_id uuid, p_entity text, p_name text, p_mapping jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e app.import_entities; v_id uuid; v_bad text;
begin
  select * into e from app.import_entities where code = upper(p_entity);
  if e.code is null or not app.is_member(p_company_id) then
    raise exception 'Unknown import' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, e.import_permission);
  select v into v_bad from jsonb_each_text(p_mapping) m(k, v)
  where v <> '' and not exists (select 1 from jsonb_array_elements(app.import_columns(p_company_id, e.code)) c where c->>'key' = v) limit 1;
  if v_bad is not null then
    raise exception 'Unknown column % in the mapping', v_bad using errcode = 'P0001';
  end if;
  insert into public.import_templates (company_id, entity, name, mapping, created_by, updated_by)
  values (p_company_id, e.code, trim(p_name), p_mapping, auth.uid(), auth.uid())
  on conflict (company_id, entity, name) do update set mapping = excluded.mapping, updated_at = now(), updated_by = auth.uid()
  returning id into v_id;
  perform app.audit(p_company_id, 'import_templates', v_id::text, 'SAVE', null, jsonb_build_object('entity', e.code, 'name', p_name, 'mapping', p_mapping));
  return v_id;
end;
$$;

create or replace function public.import_job_set_mapping(p_job_id uuid, p_mapping jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare j public.import_jobs := app.import_job_for(p_job_id);
begin
  update public.import_jobs set mapping = p_mapping where id = j.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- New entities in the registry; new columns of existing ones
-- -----------------------------------------------------------------------------
update app.import_entities set columns = columns || '[
   {"key":"part_no","label":"Part number","type":"text","example":""},
   {"key":"model","label":"Model","type":"text","example":""},
   {"key":"reorder_qty","label":"Reorder quantity","type":"number","min":0,"example":"1000"},
   {"key":"min_sale_rate","label":"Minimum sale rate (per base unit)","type":"number","min":0,"example":""},
   {"key":"max_sale_rate","label":"Maximum sale rate (per base unit)","type":"number","min":0,"example":""}]'::jsonb
where code = 'ITEMS';
update app.import_entities set columns = columns || '[
   {"key":"legal_name","label":"Legal name","type":"text","example":""},
   {"key":"status","label":"Status","type":"enum","values":["ACTIVE","ON_HOLD","DISABLED"],"example":"ACTIVE"}]'::jsonb
where code in ('CUSTOMERS', 'VENDORS');

insert into app.import_entities (code, label, import_permission, export_permission, custom_entity, key_columns, can_update, sort_order, help, columns) values
('UNITS', 'Units', 'items.import', 'items.export', null, '{code}', true, 3,
 'Company units of measure (PCS, BOX, PAIR …). System units already exist and are not imported.',
 '[{"key":"code","label":"Unit code","type":"text","required":true,"example":"DOZ"},
   {"key":"name","label":"Name","type":"text","required":true,"example":"Dozen"}]'),
('CATEGORIES', 'Item categories', 'items.import', 'items.export', null, '{name}', true, 4,
 'Categories; a parent makes it a subcategory (the parent must exist or be earlier in the file).',
 '[{"key":"name","label":"Category name","type":"text","required":true,"example":"Fasteners"},
   {"key":"code","label":"Code","type":"text","example":"FST"},
   {"key":"parent","label":"Parent category (name or code)","type":"text","example":""}]'),
('BRANDS', 'Brands', 'items.import', 'items.export', null, '{name}', true, 5,
 'Brand names used on items.',
 '[{"key":"name","label":"Brand name","type":"text","required":true,"example":"Rukman"},
   {"key":"code","label":"Code","type":"text","example":"RK"}]'),
('ITEM_PACKINGS', 'Item packings', 'items.import', 'items.export', null, '{item_code,unit}', true, 15,
 'Extra units of an item with the number of base units they contain (1 BOX = 24 PAIR).',
 '[{"key":"item_code","label":"Item code","type":"text","required":true,"example":"BOLT-10"},
   {"key":"unit","label":"Unit code","type":"text","required":true,"example":"BOX"},
   {"key":"factor","label":"Base units per unit","type":"number","required":true,"min":0,"example":"24"},
   {"key":"is_default","label":"Default packing","type":"boolean","example":"YES"}]'),
('PARTY_ADDRESSES', 'Customer / vendor addresses', 'parties.import', 'parties.export', null, '{party_code,code}', true, 45,
 'Billing / shipping addresses of customers and vendors (party code + address code).',
 '[{"key":"party_code","label":"Customer / vendor code","type":"text","required":true,"example":"CUS-00001"},
   {"key":"code","label":"Address code","type":"text","required":true,"example":"SHIP1"},
   {"key":"name","label":"Name","type":"text","required":true,"example":"Main warehouse"},
   {"key":"address_type","label":"Type","type":"enum","values":["SHIP_TO","BILL_TO"],"example":"SHIP_TO"},
   {"key":"address","label":"Address","type":"text","example":"Plot 4, Industrial Area"},
   {"key":"city","label":"City","type":"text","example":"Jaipur"},
   {"key":"state_code","label":"State code","type":"text","example":"08"},
   {"key":"gstin","label":"GSTIN","type":"text","example":""}]'),
('ROLE_ASSIGNMENTS', 'Role assignments', 'users.assign_role', 'users.export', null, '{email,role_code}', false, 105,
 'Adds a role to an existing user of the company. Owner and privilege rules apply to every row.',
 '[{"key":"email","label":"User e-mail","type":"email","required":true,"example":"store@company.com"},
   {"key":"role_code","label":"Role code","type":"text","required":true,"example":"INVENTORY"}]'),
('GODOWN_STOCK', 'Godown-wise stock (export)', 'items.export', 'items.export', null, '{item_code,godown_code}', false, 95,
 'Export only: stock per item and godown; average cost and value only with the cost rights.',
 '[{"key":"item_code","label":"Item code","type":"text","example":""},
   {"key":"item_name","label":"Item name","type":"text","example":""},
   {"key":"godown_code","label":"Godown code","type":"text","example":""},
   {"key":"qty","label":"Quantity (base unit)","type":"number","example":""},
   {"key":"unit","label":"Base unit","type":"text","example":""},
   {"key":"avg_cost","label":"Average cost","type":"number","example":""},
   {"key":"value","label":"Value","type":"number","example":""}]')
on conflict (code) do nothing;
-- stock exports: value columns (masked)
update app.import_entities set columns = columns || '[
   {"key":"avg_cost","label":"Average cost (export only)","type":"number","example":""},
   {"key":"value","label":"Value (export only)","type":"number","example":""}]'::jsonb
where code = 'OPENING_STOCK' and not columns @> '[{"key":"value"}]';

-- export-only entities cannot be imported
create or replace function app.import_export_only(p_entity text)
returns boolean language sql immutable as $$ select p_entity in ('GODOWN_STOCK') $$;

-- -----------------------------------------------------------------------------
-- Dispatcher: new entities / new columns, then the R2 logic
-- -----------------------------------------------------------------------------
create or replace function app.import_check_r3(p_company_id uuid, p_entity text, r jsonb, p_update boolean)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare e jsonb := '[]'; v_id uuid; v_action text := 'CREATE'; res jsonb := '{}'; v_x uuid; v_item uuid; v_party public.parties; c jsonb;
begin
  if app.import_export_only(p_entity) then
    raise exception '% can only be exported', p_entity using errcode = 'P0001';
  end if;
  case p_entity
  when 'UNITS' then
    select id into v_id from public.units where upper(code) = upper(r->>'code') and (company_id = p_company_id or company_id is null);
    if v_id is not null then
      if (select company_id from public.units where id = v_id) is null then e := e || app.err('code', r->>'code', 'This is a system unit and already exists');
      elsif not p_update then e := e || app.err('code', r->>'code', 'Unit already exists (choose "update existing records")');
      else v_action := 'UPDATE'; end if;
    end if;
  when 'CATEGORIES' then
    select id into v_id from public.item_categories where company_id = p_company_id and lower(name) = lower(r->>'name') and not is_deleted;
    if v_id is not null then
      if not p_update then e := e || app.err('name', r->>'name', 'Category already exists (choose "update existing records")');
      else v_action := 'UPDATE'; end if;
    end if;
    if coalesce(r->>'parent', '') <> '' then
      select id into v_x from public.item_categories where company_id = p_company_id and not is_deleted
        and (lower(name) = lower(r->>'parent') or upper(code) = upper(r->>'parent'));
      -- the parent may also be created earlier in the same file (resolved again at commit)
      res := jsonb_build_object('parent_id', v_x);
    end if;
  when 'BRANDS' then
    select id into v_id from public.brands where company_id = p_company_id and lower(name) = lower(r->>'name');
    if v_id is not null then
      if not p_update then e := e || app.err('name', r->>'name', 'Brand already exists (choose "update existing records")');
      else v_action := 'UPDATE'; end if;
    end if;
  when 'ITEM_PACKINGS' then
    select id into v_item from public.items where company_id = p_company_id and upper(code) = upper(r->>'item_code') and not is_deleted;
    if v_item is null or not app.scope_allows(p_company_id, 'ITEM', v_item) then e := e || app.err('item_code', r->>'item_code', 'Unknown item'); end if;
    v_x := app.unit_by_code(p_company_id, r->>'unit');
    if v_x is null then e := e || app.err('unit', r->>'unit', 'Unknown unit');
    elsif v_x = (select base_unit_id from public.items where id = v_item) then e := e || app.err('unit', r->>'unit', 'This is the base unit of the item'); end if;
    if coalesce((r->>'factor')::numeric, 0) <= 0 then e := e || app.err('factor', r->>'factor', 'Must be greater than 0'); end if;
    if not app.has_permission(p_company_id, 'items.edit') then e := e || app.err('item_code', null, 'Permission items.edit is required'); end if;
    select id into v_id from public.item_packings where item_id = v_item and unit_id = v_x;
    if v_id is not null then
      if not p_update then e := e || app.err('unit', r->>'unit', 'Packing already exists (choose "update existing records")');
      else v_action := 'UPDATE'; end if;
    end if;
    res := jsonb_build_object('item_id', v_item, 'unit_id', v_x);
  when 'PARTY_ADDRESSES' then
    select * into v_party from public.parties where company_id = p_company_id and upper(code) = upper(r->>'party_code') and not is_deleted;
    if v_party.id is null or not app.party_allowed(p_company_id, v_party.id) then
      e := e || app.err('party_code', r->>'party_code', 'Unknown customer / vendor');
    elsif not app.party_right(p_company_id, v_party.is_customer, v_party.is_vendor, 'edit') then
      e := e || app.err('party_code', r->>'party_code', 'You may not edit this customer / vendor');
    end if;
    select id into v_id from public.party_addresses where party_id = v_party.id and upper(code) = upper(r->>'code');
    if v_id is not null then
      if not p_update then e := e || app.err('code', r->>'code', 'Address already exists (choose "update existing records")');
      else v_action := 'UPDATE'; end if;
    end if;
    res := jsonb_build_object('party_id', v_party.id);
  when 'ROLE_ASSIGNMENTS' then
    select u.id into v_id from auth.users u join public.user_roles ur on ur.user_id = u.id and ur.company_id = p_company_id
    where lower(u.email) = lower(r->>'email') limit 1;
    if v_id is null then e := e || app.err('email', r->>'email', 'Not a user of this company'); end if;
    select id into v_x from public.roles where company_id = p_company_id and upper(code) = upper(r->>'role_code') and kind = 'INTERNAL';
    if v_x is null then e := e || app.err('role_code', r->>'role_code', 'Unknown role');
    elsif v_id is not null then
      if exists (select 1 from public.user_roles where user_id = v_id and company_id = p_company_id and role_id = v_x) then
        e := e || app.err('role_code', r->>'role_code', 'The user already has this role');
      end if;
      if v_id = auth.uid() and not app.is_owner(auth.uid(), p_company_id) then
        e := e || app.err('email', r->>'email', 'You cannot change your own roles');
      end if;
      begin
        perform app.assert_can_assign_role(p_company_id, v_id, v_x, false);
      exception when others then e := e || app.err('role_code', r->>'role_code', sqlerrm);
      end;
    end if;
    res := jsonb_build_object('user_id', v_id, 'role_id', v_x);
  else
    c := app.import_check(p_company_id, p_entity, r, p_update);
    -- R3 rules on top of R2
    if p_entity = 'OPENING_STOCK' and r ? 'rate' and not secure.class_ok(p_company_id, 'LANDED') then
      c := jsonb_set(c, '{errors}', (c->'errors') || app.err('rate', null, 'The landed-cost right is required to import a cost rate'));
    end if;
    if p_entity = 'ITEMS' and (r ? 'min_sale_rate' or r ? 'max_sale_rate') then
      if not app.has_permission(p_company_id, 'items.edit_rate') or not secure.class_ok(p_company_id, 'SALE') then
        c := jsonb_set(c, '{errors}', (c->'errors') || app.err('min_sale_rate', null, 'Sale rate rights are required for rate limits'));
      elsif (r->>'min_sale_rate')::numeric > (r->>'max_sale_rate')::numeric then
        c := jsonb_set(c, '{errors}', (c->'errors') || app.err('max_sale_rate', r->>'max_sale_rate', 'Maximum is below the minimum'));
      end if;
    end if;
    if p_entity in ('CUSTOMERS', 'VENDORS') and r ? 'status' and upper(r->>'status') not in ('ACTIVE', 'ON_HOLD', 'DISABLED') then
      c := jsonb_set(c, '{errors}', (c->'errors') || app.err('status', r->>'status', 'Allowed: ACTIVE, ON_HOLD, DISABLED'));
    end if;
    return c;
  end case;
  return jsonb_build_object('errors', e, 'action', v_action, 'target_id', v_id, 'resolved', res);
end;
$$;

create or replace function app.import_apply_r3(p_company_id uuid, p_entity text, p_job_id uuid, r jsonb, p_action text,
                                               p_target uuid, x jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_id uuid := p_target; v_parent uuid;
begin
  case p_entity
  when 'UNITS' then
    if p_action = 'CREATE' then
      insert into public.units (company_id, code, name) values (p_company_id, upper(r->>'code'), r->>'name') returning id into v_id;
    else
      update public.units set name = r->>'name' where id = v_id and company_id = p_company_id;
    end if;
  when 'CATEGORIES' then
    v_parent := coalesce((x->>'parent_id')::uuid,
                         (select id from public.item_categories where company_id = p_company_id and not is_deleted and coalesce(r->>'parent', '') <> ''
                          and (lower(name) = lower(r->>'parent') or upper(code) = upper(r->>'parent')) limit 1));
    if coalesce(r->>'parent', '') <> '' and v_parent is null then
      raise exception 'Unknown parent category %', r->>'parent';
    end if;
    if p_action = 'CREATE' then
      insert into public.item_categories (company_id, code, name, parent_id)
      values (p_company_id, nullif(upper(r->>'code'), ''), r->>'name', v_parent) returning id into v_id;
    else
      update public.item_categories set code = coalesce(nullif(upper(r->>'code'), ''), code), parent_id = coalesce(v_parent, parent_id) where id = v_id;
    end if;
  when 'BRANDS' then
    if p_action = 'CREATE' then
      insert into public.brands (company_id, code, name) values (p_company_id, nullif(upper(r->>'code'), ''), r->>'name') returning id into v_id;
    else
      update public.brands set code = coalesce(nullif(upper(r->>'code'), ''), code) where id = v_id;
    end if;
  when 'ITEM_PACKINGS' then
    if p_action = 'CREATE' then
      insert into public.item_packings (item_id, unit_id, factor_to_base, is_default)
      values ((x->>'item_id')::uuid, (x->>'unit_id')::uuid, (r->>'factor')::numeric, coalesce((r->>'is_default')::boolean, false))
      returning id into v_id;
    else
      update public.item_packings set factor_to_base = (r->>'factor')::numeric,
             is_default = coalesce((r->>'is_default')::boolean, is_default) where id = v_id;
    end if;
  when 'PARTY_ADDRESSES' then
    if p_action = 'CREATE' then
      insert into public.party_addresses (party_id, code, name, address_type, address, city, state_code, gstin)
      values ((x->>'party_id')::uuid, upper(r->>'code'), r->>'name', coalesce(r->>'address_type', 'SHIP_TO'), r->>'address',
              r->>'city', r->>'state_code', nullif(upper(r->>'gstin'), ''))
      returning id into v_id;
    else
      update public.party_addresses set name = r->>'name', address_type = coalesce(r->>'address_type', address_type),
             address = coalesce(r->>'address', address), city = coalesce(r->>'city', city),
             state_code = coalesce(r->>'state_code', state_code), gstin = coalesce(nullif(upper(r->>'gstin'), ''), gstin)
      where id = v_id;
    end if;
  when 'ROLE_ASSIGNMENTS' then
    -- the user_roles guards (privilege / owner) apply to this insert as to the Users screen
    insert into public.user_roles (user_id, company_id, role_id) values ((x->>'user_id')::uuid, p_company_id, (x->>'role_id')::uuid);
    v_id := (x->>'user_id')::uuid;
  else
    v_id := app.import_apply(p_company_id, p_entity, p_job_id, r, p_action, p_target, x);
    if p_entity = 'ITEMS' and v_id is not null
       and (r ? 'part_no' or r ? 'model' or r ? 'reorder_qty' or r ? 'min_sale_rate' or r ? 'max_sale_rate') then
      update public.items set
        part_no = case when r ? 'part_no' then nullif(r->>'part_no', '') else part_no end,
        model = case when r ? 'model' then nullif(r->>'model', '') else model end,
        reorder_qty = case when r ? 'reorder_qty' then (r->>'reorder_qty')::numeric else reorder_qty end,
        min_sale_rate = case when r ? 'min_sale_rate' then (r->>'min_sale_rate')::numeric else min_sale_rate end,
        max_sale_rate = case when r ? 'max_sale_rate' then (r->>'max_sale_rate')::numeric else max_sale_rate end
      where id = v_id;
    end if;
  end case;
  return v_id;
end;
$$;

do $$
declare f text; v_def text;
begin
  foreach f in array array['app.import_run_validation', 'public.import_commit'] loop
    select pg_get_functiondef(f::regproc) into v_def;
    v_def := replace(replace(v_def, 'app.import_check(', 'app.import_check_r3('), 'app.import_apply(', 'app.import_apply_r3(');
    if position('_r3(' in v_def) = 0 then raise exception '% has an unexpected shape', f; end if;
    execute v_def;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Suggestions for unknown references (only among visible records)
-- -----------------------------------------------------------------------------
create or replace function app.import_suggest(p_job_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions, pg_temp
as $$
declare j public.import_jobs;
begin
  select * into j from public.import_jobs where id = p_job_id;
  with c as (
    select er.id, case
      when er.column_key in ('godown_code', 'godown_codes') then
        (select g.code from public.godowns g where g.company_id = j.company_id and not g.is_deleted
           and app.scope_allows(j.company_id, 'GODOWN', g.id)
         order by similarity(g.code, er.value) desc, g.code limit 1)
      when er.column_key = 'item_code' then
        (select i.code from public.items i where i.company_id = j.company_id and not i.is_deleted
           and similarity(i.code, er.value) > 0.2 and app.scope_allows(j.company_id, 'ITEM', i.id)
         order by similarity(i.code, er.value) desc, i.code limit 1)
      when er.column_key in ('customer_code', 'vendor_code', 'party_code') then
        (select p.code from public.parties p where p.company_id = j.company_id and not p.is_deleted
           and similarity(p.code, er.value) > 0.2 and app.party_allowed(j.company_id, p.id)
           and (er.column_key <> 'customer_code' or p.is_customer) and (er.column_key <> 'vendor_code' or p.is_vendor)
         order by similarity(p.code, er.value) desc, p.code limit 1)
      when er.column_key in ('unit', 'base_unit', 'pack_unit', 'sales_unit', 'purchase_unit') then
        (select u.code from public.units u where (u.company_id = j.company_id or u.company_id is null)
         order by similarity(u.code, er.value) desc, u.code limit 1)
      when er.column_key = 'role_code' then
        (select ro.code from public.roles ro where ro.company_id = j.company_id and ro.kind = 'INTERNAL'
         order by similarity(ro.code, er.value) desc, ro.code limit 1)
      when er.column_key in ('category', 'parent') then
        (select c.name from public.item_categories c where c.company_id = j.company_id and not c.is_deleted
         order by similarity(c.name, er.value) desc, c.name limit 1)
      when er.column_key = 'brand' then
        (select b.name from public.brands b where b.company_id = j.company_id order by similarity(b.name, er.value) desc, b.name limit 1)
    end as best, er.value
    from public.import_errors er
    where er.job_id = p_job_id and er.value is not null and er.message ilike 'unknown%')
  update public.import_errors x set suggestion = c.best
  from c where x.id = c.id and c.best is not null and similarity(c.best, c.value) > 0.2;
end;
$$;

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.import_validate'::regproc) into v_def;
  v_def := replace(v_def, '  return app.import_run_validation(j);',
                   '  declare v_res jsonb; begin v_res := app.import_run_validation(j); perform app.import_suggest(j.id); return v_res; end;');
  if position('import_suggest' in v_def) = 0 then raise exception 'import_validate has an unexpected shape'; end if;
  execute v_def;
end $$;

-- -----------------------------------------------------------------------------
-- Exports: new entities, masked stock values; module / permission checks stay
-- in the R2 function (renamed), which this one delegates to
-- -----------------------------------------------------------------------------
alter function public.export_rows(uuid, text) rename to export_rows_r2;
alter function public.export_rows_r2(uuid, text) set schema app;

create or replace function public.export_rows(p_company_id uuid, p_entity text)
returns jsonb
language plpgsql
set search_path = public, app, pg_temp
as $$
declare e app.import_entities; v jsonb; v_avg boolean; v_val boolean;
begin
  select * into e from app.import_entities where code = upper(p_entity);
  if e.code is null or not app.is_member(p_company_id) then
    raise exception 'Unknown export %', p_entity using errcode = 'P0001';
  end if;
  if not app.has_permission(p_company_id, e.export_permission) then
    raise exception 'Permission denied: % is required', e.export_permission using errcode = '42501';
  end if;
  v_avg := secure.class_ok(p_company_id, 'AVERAGE');
  v_val := secure.class_ok(p_company_id, 'VALUATION') and v_avg;
  case e.code
  when 'UNITS' then
    select jsonb_agg(jsonb_build_object('code', u.code, 'name', u.name) order by u.code) into v
    from public.units u where u.company_id = p_company_id;
  when 'CATEGORIES' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', c.name, 'code', c.code, 'parent', p.name)) order by c.name) into v
    from public.item_categories c left join public.item_categories p on p.id = c.parent_id
    where c.company_id = p_company_id and not c.is_deleted;
  when 'BRANDS' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', b.name, 'code', b.code)) order by b.name) into v
    from public.brands b where b.company_id = p_company_id;
  when 'ITEM_PACKINGS' then
    select jsonb_agg(jsonb_build_object('item_code', i.code, 'unit', u.code, 'factor', k.factor_to_base,
                                        'is_default', case when k.is_default then 'YES' else 'NO' end) order by i.code, u.code) into v
    from public.item_packings k join public.v_items i on i.id = k.item_id join public.units u on u.id = k.unit_id
    where i.company_id = p_company_id and not i.is_deleted;
  when 'PARTY_ADDRESSES' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('party_code', p.code, 'code', a.code, 'name', a.name, 'address_type', a.address_type,
                                        'address', a.address, 'city', a.city, 'state_code', a.state_code, 'gstin', a.gstin))
                     order by p.code, a.code) into v
    from public.party_addresses a join public.parties p on p.id = a.party_id
    where p.company_id = p_company_id and not p.is_deleted;
  when 'ROLE_ASSIGNMENTS' then
    select jsonb_agg(jsonb_build_object('email', x->>'email', 'role_code', r->>'code') order by x->>'email', r->>'code') into v
    from jsonb_array_elements(public.admin_users(p_company_id)) x, jsonb_array_elements(x->'roles') r
    where x->>'kind' = 'INTERNAL';
  when 'GODOWN_STOCK' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item_code', s.item_code, 'item_name', s.item_name, 'godown_code', s.godown_code,
                                        'qty', s.qty, 'unit', s.unit,
                                        'avg_cost', case when v_avg then s.avg_cost end,
                                        'value', case when v_val then round(s.qty * s.avg_cost, 2) end))
                     order by s.item_code, s.godown_code) into v
    from (select i.code as item_code, i.name as item_name, g.code as godown_code, sum(b.base_qty) as qty, u.code as unit, i.avg_cost
          from public.stock_balances b
          join public.v_items i on i.id = b.item_id
          join public.godowns g on g.id = b.godown_id
          join public.units u on u.id = i.base_unit_id
          where b.company_id = p_company_id
          group by i.code, i.name, g.code, u.code, i.avg_cost
          having sum(b.base_qty) <> 0) s;
  when 'OPENING_STOCK' then
    -- current stock per location (R2) + masked average cost / value
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item_code', i.code, 'godown_code', g.code, 'location_code', l.code,
                                        'qty', b.base_qty, 'unit', u.code,
                                        'avg_cost', case when v_avg then i.avg_cost end,
                                        'value', case when v_val then round(b.base_qty * i.avg_cost, 2) end))
                     order by i.code, g.code, l.code) into v
    from public.stock_balances b
    join public.v_items i on i.id = b.item_id
    join public.godowns g on g.id = b.godown_id
    join public.storage_locations l on l.id = b.location_id
    join public.units u on u.id = i.base_unit_id
    where b.company_id = p_company_id and b.base_qty <> 0;
  else
    return app.export_rows_r2(p_company_id, p_entity);
  end case;
  v := coalesce(v, '[]');
  perform app.log_export(p_company_id, e.code, jsonb_array_length(v));
  return v;
end;
$$;

-- items / parties exports: new columns; restricted / non-exportable custom fields filtered
do $$
declare v_def text;
begin
  select pg_get_functiondef('app.export_rows_r2'::regproc) into v_def;
  v_def := replace(v_def, $x$'notes', i.notes)$x$,
                   $x$'notes', i.notes, 'part_no', i.part_no, 'model', i.model, 'reorder_qty', i.reorder_qty,
      'min_sale_rate', i.min_sale_rate, 'max_sale_rate', i.max_sale_rate)$x$);
  v_def := replace(v_def, $x$jsonb_each(i.custom) as cx(k, val)$x$,
                   $x$jsonb_each(i.custom) as cx(k, val) where exists (select 1 from public.custom_field_definitions d
                     where d.company_id = p_company_id and d.entity = 'ITEM' and d.field_key = cx.k and d.is_exportable)$x$);
  v_def := replace(v_def, $x$jsonb_each(p.custom) as cx(k, val)$x$,
                   $x$jsonb_each(p.custom) as cx(k, val) where exists (select 1 from public.custom_field_definitions d
                     where d.company_id = p_company_id and d.entity in ('CUSTOMER', 'VENDOR') and d.field_key = cx.k and d.is_exportable)$x$);
  if position('part_no' in v_def) = 0 or position('is_exportable' in v_def) = 0 then
    raise exception 'export_rows_r2 has an unexpected shape';
  end if;
  execute v_def;
end $$;

revoke all on function app.export_rows_r2(uuid, text) from public, anon;
grant execute on function app.export_rows_r2(uuid, text) to authenticated, service_role;
revoke all on function public.export_rows(uuid, text), public.import_template_save(uuid, text, text, jsonb),
                       public.import_job_set_mapping(uuid, jsonb) from public, anon;
grant execute on function public.export_rows(uuid, text), public.import_template_save(uuid, text, text, jsonb),
                          public.import_job_set_mapping(uuid, jsonb) to authenticated, service_role;
revoke all on function app.import_suggest(uuid), app.import_check_r3(uuid, text, jsonb, boolean),
                       app.import_apply_r3(uuid, text, uuid, jsonb, text, uuid, jsonb) from public, anon, authenticated;
update secure.reviewed_functions set treatment = 'invoker: masked views / row-level tables; stock values by AVERAGE / VALUATION'
where function_name = 'public.export_rows';
insert into secure.reviewed_functions values ('app.export_rows_r2', 'invoker (R2 export), reads v_items / row-level tables')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Master codes in imports (AC-2.5): while the ITEM / CUSTOMER / VENDOR / GODOWN
-- sequence is active, an empty `code` is allowed (the next code is assigned on
-- commit by the master-code trigger / party_save) and empty codes are not
-- reported as duplicates of each other
-- -----------------------------------------------------------------------------
create or replace function app.import_auto_code(p_company_id uuid, p_entity text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (select 1 from public.document_sequences
                 where company_id = p_company_id and is_active
                   and doc_type = case p_entity when 'ITEMS' then 'ITEM' when 'CUSTOMERS' then 'CUSTOMER'
                                                when 'VENDORS' then 'VENDOR' when 'GODOWNS' then 'GODOWN' end)
$$;
revoke all on function app.import_auto_code(uuid, text) from public, anon;
grant execute on function app.import_auto_code(uuid, text) to authenticated, service_role;

do $$
declare v_def text;
begin
  select pg_get_functiondef('app.import_run_validation'::regproc) into v_def;
  v_def := replace(v_def, $x$  v_cols := app.import_columns(p_job.company_id, p_job.entity);$x$,
                   $x$  v_cols := app.import_columns(p_job.company_id, p_job.entity);
  if app.import_auto_code(p_job.company_id, p_job.entity) then
    v_cols := (select jsonb_agg(case when cc->>'key' = 'code' then cc || '{"required": false}' else cc end order by o)
               from jsonb_array_elements(v_cols) with ordinality as z(cc, o));
  end if;$x$);
  v_def := replace(v_def, $x$  where row_no <> first_row;$x$, $x$  where row_no <> first_row and k <> '';$x$);
  v_def := replace(v_def, $x$select row_no, min(row_no) over (partition by k) as first_row$x$,
                   $x$select row_no, k, min(row_no) over (partition by k) as first_row$x$);
  if position('import_auto_code' in v_def) = 0 or position($x$k <> ''$x$ in v_def) = 0 or position('select row_no, k,' in v_def) = 0 then
    raise exception 'import_run_validation has an unexpected shape';
  end if;
  execute v_def;
end $$;
