-- =============================================================================
-- PLATFORM R3 (9/10) — custom fields completion (W10)
--   * entities: + USER, GODOWN, SALES_ORDER, PURCHASE_ORDER, DOCUMENT
--   * types: + MULTI_SELECT, EMAIL, PHONE, CURRENCY, FILE, IMAGE
--   * properties: default value, visible, editable (after creation), searchable,
--     exportable, view permission, edit permission
--   * fields with a view permission are stored outside the readable `custom`
--     column (custom_field_private_values) and served only to holders of the
--     permission who can see the record; edit permission enforced by trigger
-- Also: audit masking covers document lines inside audited payloads.
-- =============================================================================

alter table public.custom_field_definitions drop constraint custom_field_definitions_entity_check;
alter table public.custom_field_definitions add constraint custom_field_definitions_entity_check
  check (entity in ('ITEM', 'CUSTOMER', 'VENDOR', 'USER', 'GODOWN', 'SALES_ORDER', 'PURCHASE_ORDER', 'DOCUMENT'));
alter table public.custom_field_definitions drop constraint custom_field_definitions_field_type_check;
alter table public.custom_field_definitions add constraint custom_field_definitions_field_type_check
  check (field_type in ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'DROPDOWN', 'MULTI_SELECT', 'EMAIL', 'PHONE', 'CURRENCY', 'FILE', 'IMAGE'));
alter table public.custom_field_definitions drop constraint if exists custom_field_definitions_check;
alter table public.custom_field_definitions add constraint custom_field_definitions_options_check
  check (field_type not in ('DROPDOWN', 'MULTI_SELECT') or cardinality(options) > 0);
alter table public.custom_field_definitions
  add column default_value   jsonb,
  add column is_visible      boolean not null default true,
  add column is_editable     boolean not null default true,
  add column is_searchable   boolean not null default false,
  add column is_exportable   boolean not null default true,
  add column view_permission text references public.permissions (code),
  add column edit_permission text references public.permissions (code);

-- custom values on the new entities
alter table public.company_users  add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.godowns        add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.sales_orders   add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.purchase_orders add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.documents      add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
create index if not exists items_custom_gin on public.items using gin (custom jsonb_path_ops);
create index if not exists parties_custom_gin on public.parties using gin (custom jsonb_path_ops);

-- restricted values (fields with a view permission)
create table public.custom_field_private_values (
  company_id uuid not null references public.companies (id) on delete cascade,
  entity     text not null,
  record_id  uuid not null,
  field_key  text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (entity, record_id, field_key)
);
alter table public.custom_field_private_values enable row level security;   -- no policy: only through the functions below
grant all on public.custom_field_private_values to service_role;

-- -----------------------------------------------------------------------------
-- Validation (all types; defaults; editable)
-- -----------------------------------------------------------------------------
create or replace function app.validate_custom(p_company_id uuid, p_entities text[], p_values jsonb, p_check_required boolean)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare d public.custom_field_definitions; v jsonb; k text; v_out jsonb := '{}'; t text; x text; v_arr text[];
begin
  for k in select jsonb_object_keys(coalesce(p_values, '{}')) loop
    if not exists (select 1 from public.custom_field_definitions where company_id = p_company_id
                   and entity = any (p_entities) and field_key = k) then
      raise exception 'Unknown custom field %', k using errcode = 'P0001';
    end if;
  end loop;
  for d in select distinct on (field_key) * from public.custom_field_definitions
           where company_id = p_company_id and entity = any (p_entities) order by field_key, is_active desc loop
    v := p_values -> d.field_key;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      if p_check_required and d.is_required and d.is_active then
        raise exception '% is required', d.label using errcode = 'P0001';
      end if;
      continue;
    end if;
    t := btrim(v #>> '{}');
    case d.field_type
      when 'NUMBER', 'CURRENCY' then
        if t !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number', d.label using errcode = 'P0001'; end if;
        v_out := v_out || jsonb_build_object(d.field_key, case when d.field_type = 'CURRENCY' then round(t::numeric, 2) else t::numeric end);
      when 'DATE' then
        begin
          v_out := v_out || jsonb_build_object(d.field_key, t::date);
        exception when others then
          raise exception '% must be a date (YYYY-MM-DD)', d.label using errcode = 'P0001';
        end;
      when 'BOOLEAN' then
        if lower(t) not in ('true', 'false', 'yes', 'no', '1', '0') then
          raise exception '% must be yes or no', d.label using errcode = 'P0001';
        end if;
        v_out := v_out || jsonb_build_object(d.field_key, lower(t) in ('true', 'yes', '1'));
      when 'DROPDOWN' then
        if not t = any (d.options) then
          raise exception '% must be one of: %', d.label, array_to_string(d.options, ', ') using errcode = 'P0001';
        end if;
        v_out := v_out || jsonb_build_object(d.field_key, t);
      when 'MULTI_SELECT' then
        v_arr := case when jsonb_typeof(v) = 'array' then array(select btrim(e) from jsonb_array_elements_text(v) e)
                      else string_to_array(t, ',') end;
        v_arr := array(select distinct btrim(e) from unnest(v_arr) e where btrim(e) <> '');
        foreach x in array v_arr loop
          if not x = any (d.options) then
            raise exception '% accepts only: %', d.label, array_to_string(d.options, ', ') using errcode = 'P0001';
          end if;
        end loop;
        v_out := v_out || jsonb_build_object(d.field_key, to_jsonb(v_arr));
      when 'EMAIL' then
        if t !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% must be an e-mail address', d.label using errcode = 'P0001'; end if;
        v_out := v_out || jsonb_build_object(d.field_key, lower(t));
      when 'PHONE' then
        if t !~ '^\+?[0-9][0-9 ()-]{5,19}$' then raise exception '% must be a phone number', d.label using errcode = 'P0001'; end if;
        v_out := v_out || jsonb_build_object(d.field_key, t);
      when 'FILE', 'IMAGE' then
        if t !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.documents doc where doc.id = t::uuid and doc.company_id = p_company_id
                                                  and not doc.is_deleted
                                                  and (d.field_type = 'FILE' or coalesce(doc.mime_type, '') like 'image/%')) then
          raise exception '% must be an uploaded % of this company', d.label, lower(d.field_type) using errcode = 'P0001';
        end if;
        v_out := v_out || jsonb_build_object(d.field_key, t);
      else
        if length(t) > 500 then raise exception '% is too long (max 500)', d.label using errcode = 'P0001'; end if;
        v_out := v_out || jsonb_build_object(d.field_key, t);
    end case;
  end loop;
  return v_out;
end;
$$;

-- one generic trigger for every entity: defaults, validation, editable / edit
-- permission, restricted values moved to the private table
create or replace function app.tg_custom_fields()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_entities text[]; v_company uuid; v_old jsonb := '{}'; v_new jsonb; d public.custom_field_definitions; v_id uuid;
  v_trusted boolean := auth.uid() is null or app.is_trusted_caller();
  jn jsonb := to_jsonb(new); jo jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  v_entities := case tg_table_name
    when 'items' then array['ITEM']
    when 'parties' then array_remove(array[case when (jn->>'is_customer')::boolean then 'CUSTOMER' end,
                                           case when (jn->>'is_vendor')::boolean then 'VENDOR' end], null)
    when 'company_users' then array['USER'] when 'godowns' then array['GODOWN']
    when 'sales_orders' then array['SALES_ORDER'] when 'purchase_orders' then array['PURCHASE_ORDER']
    when 'documents' then array['DOCUMENT'] end;
  v_company := (jn->>'company_id')::uuid;
  v_id := case tg_table_name when 'company_users' then (jn->>'user_id')::uuid else (jn->>'id')::uuid end;
  if tg_op = 'UPDATE' then
    v_old := coalesce(old.custom, '{}') || coalesce((select jsonb_object_agg(p.field_key, p.value) from public.custom_field_private_values p
                                                     where p.entity = any (v_entities) and p.record_id = v_id), '{}');
    -- unchanged values; for parties also re-run when the customer / vendor role changes (fields of the new kind)
    if new.custom is not distinct from old.custom
       and (tg_table_name <> 'parties' or ((jn->>'is_customer') = (jo->>'is_customer') and (jn->>'is_vendor') = (jo->>'is_vendor'))) then
      return new;
    end if;
  end if;
  v_new := coalesce(new.custom, '{}');
  -- parties without customer / vendor role yet (party_save adds the role afterwards): keep as is
  if cardinality(v_entities) = 0 then
    return new;
  end if;
  for d in select * from public.custom_field_definitions where company_id = v_company and entity = any (v_entities) and is_active loop
    -- defaults on creation
    if tg_op = 'INSERT' and not v_new ? d.field_key and d.default_value is not null then
      v_new := v_new || jsonb_build_object(d.field_key, d.default_value);
    end if;
    -- a value the user did not send on update stays (also restricted values he cannot see)
    if tg_op = 'UPDATE' and not v_new ? d.field_key and v_old ? d.field_key then
      v_new := v_new || jsonb_build_object(d.field_key, v_old -> d.field_key);
    end if;
    if not v_trusted and (v_new -> d.field_key) is distinct from (v_old -> d.field_key) then
      if tg_op = 'UPDATE' and not d.is_editable and not app.is_owner(auth.uid(), v_company) then
        raise exception '% cannot be changed after creation', d.label using errcode = '42501';
      end if;
      if d.edit_permission is not null and not app.has_permission(v_company, d.edit_permission) then
        raise exception 'Permission denied: % is required to change %', d.edit_permission, d.label using errcode = '42501';
      end if;
      if d.view_permission is not null and not app.has_permission(v_company, d.view_permission) then
        raise exception 'Permission denied: % is required to change %', d.view_permission, d.label using errcode = '42501';
      end if;
    end if;
  end loop;
  v_new := app.validate_custom(v_company, v_entities, v_new, true);
  -- restricted fields: out of the readable column
  for d in select * from public.custom_field_definitions
           where company_id = v_company and entity = any (v_entities) and view_permission is not null loop
    if v_new ? d.field_key then
      if (v_new -> d.field_key) is distinct from (v_old -> d.field_key) then
        insert into public.custom_field_private_values (company_id, entity, record_id, field_key, value, updated_by)
        values (v_company, v_entities[1], v_id, d.field_key, v_new -> d.field_key, auth.uid())
        on conflict (entity, record_id, field_key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
        perform app.audit(v_company, 'custom_field_private_values', v_id::text, 'UPDATE',
                          jsonb_build_object('field_key', d.field_key, 'view_permission', d.view_permission, 'value', v_old -> d.field_key),
                          jsonb_build_object('field_key', d.field_key, 'view_permission', d.view_permission, 'value', v_new -> d.field_key));
      end if;
      v_new := v_new - d.field_key;
    end if;
  end loop;
  new.custom := v_new;
  return new;
end;
$$;

drop trigger if exists items_custom on public.items;
drop trigger if exists parties_custom on public.parties;
do $$
declare t text;
begin
  foreach t in array array['items', 'parties', 'company_users', 'godowns', 'sales_orders', 'purchase_orders', 'documents'] loop
    execute format('create trigger %I before insert or update of %s on public.%I for each row execute function app.tg_custom_fields()',
                   t || '_custom_fields', case when t = 'parties' then 'custom, is_customer, is_vendor' else 'custom' end, t);
  end loop;
end $$;
-- parties get their role after the insert: validate required customer / vendor fields then (party_save does it explicitly too)

-- -----------------------------------------------------------------------------
-- Reading restricted values: permission of the field + visibility of the record
-- -----------------------------------------------------------------------------
create or replace function app.custom_record_allowed(p_entity text, p_company_id uuid, p_record_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare r record;
begin
  if not app.is_member(p_company_id) then return false; end if;
  case p_entity
    when 'ITEM' then return app.has_permission(p_company_id, 'items.view') and app.scope_allows(p_company_id, 'ITEM', p_record_id);
    when 'CUSTOMER' then return app.has_permission(p_company_id, 'customers.view') and app.party_allowed(p_company_id, p_record_id);
    when 'VENDOR' then return app.has_permission(p_company_id, 'vendors.view') and app.party_allowed(p_company_id, p_record_id);
    when 'GODOWN' then return app.scope_allows(p_company_id, 'GODOWN', p_record_id);
    when 'USER' then return app.has_permission(p_company_id, 'users.view');
    when 'SALES_ORDER' then
      select company_id, party_id, godown_id, created_by into r from public.sales_orders where id = p_record_id;
      return app.has_permission(p_company_id, 'sales_order.view') and app.party_allowed(p_company_id, r.party_id)
         and app.scope_allows(p_company_id, 'GODOWN', r.godown_id) and app.record_allowed(p_company_id, r.created_by);
    when 'PURCHASE_ORDER' then
      select company_id, party_id, godown_id, created_by into r from public.purchase_orders where id = p_record_id;
      return app.has_permission(p_company_id, 'purchase_order.view') and app.party_allowed(p_company_id, r.party_id)
         and app.scope_allows(p_company_id, 'GODOWN', r.godown_id) and app.record_allowed(p_company_id, r.created_by);
    when 'DOCUMENT' then
      select party_id into r from public.documents where id = p_record_id;
      return app.has_permission(p_company_id, 'documents.view') and app.party_allowed(p_company_id, r.party_id);
    else return false;
  end case;
end;
$$;

create or replace function public.custom_private_values(p_company_id uuid, p_entity text, p_ids uuid[])
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_object_agg(x.record_id, x.vals), '{}') from (
    select p.record_id, jsonb_object_agg(p.field_key, p.value) as vals
    from public.custom_field_private_values p
    join public.custom_field_definitions d on d.company_id = p.company_id and d.entity = p.entity and d.field_key = p.field_key
    where p.company_id = p_company_id and p.entity = p_entity and p.record_id = any (p_ids)
      and app.has_permission(p.company_id, d.view_permission)
      and app.custom_record_allowed(p.entity, p.company_id, p.record_id)
    group by p.record_id) x
$$;

-- search on searchable fields (server-side filter of lists)
create or replace function public.custom_search(p_company_id uuid, p_entity text, p_field_key text, p_value text)
returns uuid[]
language plpgsql stable
set search_path = public, app, pg_temp
as $$
declare d public.custom_field_definitions; v uuid[];
begin
  select * into d from public.custom_field_definitions where company_id = p_company_id and entity = p_entity and field_key = p_field_key
    and is_searchable and is_active;
  if d.id is null then
    raise exception 'Field % is not searchable', p_field_key using errcode = 'P0001';
  end if;
  if d.view_permission is not null then
    raise exception 'Restricted fields cannot be searched' using errcode = 'P0001';
  end if;
  -- invoker: the entity's own RLS / masked view decides which records exist for the caller
  if p_entity = 'ITEM' then
    select array_agg(id) into v from public.v_items where company_id = p_company_id
      and (custom @> jsonb_build_object(p_field_key, p_value) or custom->>p_field_key ilike '%' || p_value || '%');
  elsif p_entity in ('CUSTOMER', 'VENDOR') then
    select array_agg(id) into v from public.parties where company_id = p_company_id
      and (custom @> jsonb_build_object(p_field_key, p_value) or custom->>p_field_key ilike '%' || p_value || '%');
  elsif p_entity = 'GODOWN' then
    select array_agg(id) into v from public.godowns where company_id = p_company_id
      and (custom @> jsonb_build_object(p_field_key, p_value) or custom->>p_field_key ilike '%' || p_value || '%');
  else
    raise exception 'Search is available for items, customers, vendors and godowns' using errcode = 'P0001';
  end if;
  return coalesce(v, '{}');
end;
$$;

-- definition save: new properties
create or replace function public.custom_field_save(p_company_id uuid, p_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_id uuid; v_old jsonb; v_opts text[];
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_custom_fields.edit');
  v_opts := case when p_payload ? 'options'
                 then coalesce(array(select trim(x) from jsonb_array_elements_text(p_payload->'options') x where trim(x) <> ''), '{}') end;
  if p_id is null then
    insert into public.custom_field_definitions (company_id, entity, field_key, label, field_type, options, is_required,
                                                 is_active, sort_order, help_text, default_value, is_visible, is_editable,
                                                 is_searchable, is_exportable, view_permission, edit_permission)
    values (p_company_id, upper(p_payload->>'entity'), lower(trim(p_payload->>'field_key')), trim(p_payload->>'label'),
            upper(p_payload->>'field_type'), coalesce(v_opts, '{}'),
            coalesce((p_payload->>'is_required')::boolean, false), coalesce((p_payload->>'is_active')::boolean, true),
            coalesce((p_payload->>'sort_order')::int, 100), nullif(p_payload->>'help_text', ''),
            case when p_payload ? 'default_value' and p_payload->'default_value' <> 'null'::jsonb and p_payload->>'default_value' <> '' then p_payload->'default_value' end,
            coalesce((p_payload->>'is_visible')::boolean, true), coalesce((p_payload->>'is_editable')::boolean, true),
            coalesce((p_payload->>'is_searchable')::boolean, false), coalesce((p_payload->>'is_exportable')::boolean, true),
            nullif(p_payload->>'view_permission', ''), nullif(p_payload->>'edit_permission', ''))
    returning id into v_id;
    perform app.audit(p_company_id, 'custom_field_definitions', v_id::text, 'CREATE', null, p_payload);
  else
    select to_jsonb(d) into v_old from public.custom_field_definitions d where id = p_id and company_id = p_company_id;
    if v_old is null then
      raise exception 'Custom field not found' using errcode = 'P0001';
    end if;
    -- key, entity and type stay: stored values depend on them; the view permission too (values were moved)
    if p_payload ? 'view_permission' and nullif(p_payload->>'view_permission', '') is distinct from v_old->>'view_permission' then
      raise exception 'The view permission of a field cannot be changed after creation' using errcode = 'P0001';
    end if;
    update public.custom_field_definitions
       set label = coalesce(nullif(trim(p_payload->>'label'), ''), label),
           options = coalesce(v_opts, options),
           is_required = coalesce((p_payload->>'is_required')::boolean, is_required),
           is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
           sort_order = coalesce((p_payload->>'sort_order')::int, sort_order),
           help_text = case when p_payload ? 'help_text' then nullif(p_payload->>'help_text', '') else help_text end,
           default_value = case when p_payload ? 'default_value' then
                             case when p_payload->'default_value' = 'null'::jsonb or p_payload->>'default_value' = '' then null
                                  else p_payload->'default_value' end else default_value end,
           is_visible = coalesce((p_payload->>'is_visible')::boolean, is_visible),
           is_editable = coalesce((p_payload->>'is_editable')::boolean, is_editable),
           is_searchable = coalesce((p_payload->>'is_searchable')::boolean, is_searchable),
           is_exportable = coalesce((p_payload->>'is_exportable')::boolean, is_exportable),
           edit_permission = case when p_payload ? 'edit_permission' then nullif(p_payload->>'edit_permission', '') else edit_permission end
     where id = p_id
    returning id into v_id;
    perform app.audit(p_company_id, 'custom_field_definitions', v_id::text, 'UPDATE', v_old, p_payload);
  end if;
  return v_id;
end;
$$;

-- import templates / exports: only exportable fields; restricted fields only for holders of their permission
create or replace function app.custom_field_columns(p_company_id uuid, p_entity text)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', 'cf_' || d.field_key, 'label', d.label,
           'type', case d.field_type when 'NUMBER' then 'number' when 'CURRENCY' then 'number' when 'DATE' then 'date'
                                     when 'BOOLEAN' then 'boolean' when 'DROPDOWN' then 'enum' when 'EMAIL' then 'email' else 'text' end,
           'required', d.is_required, 'values', to_jsonb(d.options), 'custom', true, 'help', d.help_text) order by d.sort_order, d.label), '[]')
  from public.custom_field_definitions d
  where d.company_id = p_company_id and d.entity = p_entity and d.is_active and d.is_exportable
    and (d.view_permission is null or app.has_permission(p_company_id, d.view_permission))
$$;
do $$
declare v_def text;
begin
  select pg_get_functiondef('app.import_columns'::regproc) into v_def;
  if position('is_exportable' in v_def) = 0 then
    v_def := replace(v_def, 'where d.company_id = p_company_id and d.entity = ', 'where d.is_exportable and (d.view_permission is null or app.has_permission(p_company_id, d.view_permission)) and d.company_id = p_company_id and d.entity = ');
    if position('is_exportable' in v_def) = 0 then raise exception 'import_columns has an unexpected shape'; end if;
    execute v_def;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Audit masking: restricted custom values and document lines inside payloads
-- -----------------------------------------------------------------------------
create or replace function app.audit_mask(p_company_id uuid, p_table text, p_data jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare k text; v_class text; v jsonb := p_data; v_line_table text; v_lines jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or app.is_owner(auth.uid(), p_company_id) then
    return p_data;
  end if;
  if p_table = 'custom_field_private_values' then
    if p_data->>'view_permission' is not null and not app.has_permission(p_company_id, p_data->>'view_permission') then
      return jsonb_set(p_data, '{value}', to_jsonb('•••'::text));
    end if;
    return p_data;
  end if;
  for k in select jsonb_object_keys(p_data) loop
    if k = 'lines' and jsonb_typeof(p_data->'lines') = 'array' then
      select line_table into v_line_table from app.doc_types where table_name = p_table;
      if v_line_table is not null then
        select coalesce(jsonb_agg(app.audit_mask(p_company_id, v_line_table,
                                                 l || case when p_table = 'stock_adjustments' then '{}'::jsonb else '{}'::jsonb end)), '[]')
          into v_lines from jsonb_array_elements(p_data->'lines') l;
        v := jsonb_set(v, '{lines}', v_lines);
      end if;
      continue;
    end if;
    if k = 'custom' and jsonb_typeof(p_data->'custom') = 'object' then
      continue;   -- restricted custom values never reach `custom` (stored in custom_field_private_values)
    end if;
    v_class := app.audit_field_class(p_table, k, p_data);
    if v_class is not null and not secure.class_ok(p_company_id, v_class) then
      v := jsonb_set(v, array[k], to_jsonb('•••'::text));
    end if;
  end loop;
  return v;
end;
$$;

-- document payloads with a total / amount at the top level (doc_save audits the whole payload)
insert into secure.column_whitelist values ('custom_field_private_values', 'value', 'masked by field view permission')
on conflict do nothing;

revoke all on function public.custom_private_values(uuid, text, uuid[]), public.custom_search(uuid, text, text, text) from public, anon;
grant execute on function public.custom_private_values(uuid, text, uuid[]), public.custom_search(uuid, text, text, text) to authenticated, service_role;
grant execute on function app.custom_field_columns(uuid, text), app.custom_record_allowed(text, uuid, uuid) to authenticated, service_role;
revoke all on function app.tg_custom_fields() from public, anon, authenticated;

insert into secure.column_whitelist values ('custom_field_definitions', 'default_value', 'field configuration, not a business value')
on conflict do nothing;
