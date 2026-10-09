-- =============================================================================
-- PLATFORM R2 — customer / vendor master and CUSTOMER / VENDOR / ITEM data
-- scopes (in addition to GODOWN from R1).
--
-- Scope options per user or role and dimension: all records (no rows),
-- selected records, or no record (app.scope_none()).
--
-- Party rule: a party row is visible when it is a customer allowed by the
-- CUSTOMER scope, or a vendor allowed by the VENDOR scope, or neither a
-- customer nor a vendor (transporter, worker …). Documents follow their side:
-- sales documents the CUSTOMER scope, purchase / job-work documents the
-- VENDOR scope, party-neutral tables (vouchers, documents, email, ledger
-- lines) the party rule ("PARTY").
--
-- Enforcement like R1: restrictive RLS policies in InitPlan form (once per
-- query) generated from a registry, plus write triggers so that SECURITY
-- DEFINER RPCs cannot touch records outside the scope. Completeness of the
-- registry is a test.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Customer / vendor master columns
-- -----------------------------------------------------------------------------
alter table public.parties
  add column contact_person text,
  add column phone          text,
  add column pincode        text,
  add column credit_limit   numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  add column payment_terms  text,
  add column notes          text,
  add column custom         jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
create index parties_custom_gin on public.parties using gin (custom);

alter table public.party_settings
  add column outstanding_visible boolean,   -- customer: NULL = company setting
  add column payment_visible     boolean;   -- vendor:   NULL = company setting

create or replace function app.party_is_customer(p_party_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
  $$ select exists (select 1 from public.party_roles where party_id = p_party_id and role = 'CUSTOMER') $$;
create or replace function app.party_is_vendor(p_party_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
  $$ select exists (select 1 from public.party_roles where party_id = p_party_id and role in ('SUPPLIER', 'JOB_WORKER', 'CUTTER')) $$;

-- custom values of parties: types / options always; required in party_save
create or replace function app.tg_parties_custom()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.custom is distinct from old.custom then
    new.custom := app.validate_custom(new.company_id, array['CUSTOMER', 'VENDOR'], new.custom, false);
  end if;
  return new;
end;
$$;
create trigger parties_custom before insert or update of custom on public.parties
  for each row execute function app.tg_parties_custom();

-- -----------------------------------------------------------------------------
-- Scope resolution for parties and for tables without company_id
-- -----------------------------------------------------------------------------
create or replace function app.party_allowed(p_company_id uuid, p_party_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_cs uuid[]; v_vs uuid[]; v_cust boolean; v_vend boolean;
begin
  if p_party_id is null or auth.uid() is null then
    return true;
  end if;
  v_cs := app.user_scope_ids(auth.uid(), p_company_id, 'CUSTOMER');
  v_vs := app.user_scope_ids(auth.uid(), p_company_id, 'VENDOR');
  if v_cs is null and v_vs is null then
    return true;
  end if;
  v_cust := app.party_is_customer(p_party_id);
  v_vend := app.party_is_vendor(p_party_id);
  return (not v_cust and not v_vend)
      or (v_cust and (v_cs is null or p_party_id = any (v_cs)))
      or (v_vend and (v_vs is null or p_party_id = any (v_vs)));
end;
$$;

create or replace function app.party_unrestricted_company_ids()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c
  where app.user_scope_ids(auth.uid(), c, 'CUSTOMER') is null and app.user_scope_ids(auth.uid(), c, 'VENDOR') is null
$$;

-- Parties allowed in the companies where a customer / vendor scope exists.
create or replace function app.allowed_party_ids()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  with s as (
    select c, app.user_scope_ids(auth.uid(), c, 'CUSTOMER') cs, app.user_scope_ids(auth.uid(), c, 'VENDOR') vs
    from unnest(app.user_company_ids()) c),
  r as (select * from s where cs is not null or vs is not null),
  p as (
    select pa.id, r.cs, r.vs,
           exists (select 1 from public.party_roles x where x.party_id = pa.id and x.role = 'CUSTOMER') cust,
           exists (select 1 from public.party_roles x where x.party_id = pa.id and x.role in ('SUPPLIER', 'JOB_WORKER', 'CUTTER')) vend
    from r join public.parties pa on pa.company_id = r.c)
  select coalesce(array_agg(id), '{}') from p
  where (not cust and not vend) or (cust and (cs is null or id = any (cs))) or (vend and (vs is null or id = any (vs)))
$$;

-- True when the user has no restriction of the dimension in any company.
create or replace function app.scope_unrestricted_everywhere(p_dimension text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case when p_dimension = 'PARTY'
              then cardinality(app.party_unrestricted_company_ids()) = cardinality(app.user_company_ids())
              else cardinality(app.scope_unrestricted_company_ids(p_dimension)) = cardinality(app.user_company_ids()) end
$$;

-- For tables without company_id (document lines): every visible record id of
-- the dimension (assigned ones + all of the companies without restriction).
create or replace function app.scope_visible_ids(p_dimension text)
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case p_dimension
    when 'ITEM' then (select coalesce(array_agg(i.id), '{}') from public.items i
                      where i.company_id = any (app.scope_unrestricted_company_ids('ITEM')))
                     || app.scope_allowed_ids('ITEM')
    when 'PARTY' then (select coalesce(array_agg(p.id), '{}') from public.parties p
                       where p.company_id = any (app.party_unrestricted_company_ids()))
                      || app.allowed_party_ids()
    else (select coalesce(array_agg(p.id), '{}') from public.parties p
          where p.company_id = any (app.scope_unrestricted_company_ids(p_dimension)))
         || app.scope_allowed_ids(p_dimension) end
$$;

-- One record of a dimension allowed for the current user (write guards).
create or replace function app.scope_check(p_dimension text, p_company_id uuid, p_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_company uuid := p_company_id;
begin
  if p_id is null or auth.uid() is null then
    return true;
  end if;
  if v_company is null then
    if p_dimension = 'ITEM' then
      select company_id into v_company from public.items where id = p_id;
    else
      select company_id into v_company from public.parties where id = p_id;
    end if;
  end if;
  if p_dimension = 'PARTY' then
    return app.party_allowed(v_company, p_id);
  end if;
  return app.scope_allows(v_company, p_dimension, p_id);
end;
$$;

grant execute on function app.party_allowed(uuid, uuid), app.party_unrestricted_company_ids(), app.allowed_party_ids(),
                          app.scope_unrestricted_everywhere(text), app.scope_visible_ids(text), app.scope_check(text, uuid, uuid),
                          app.party_is_customer(uuid), app.party_is_vendor(uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Registry of scoped tables (data) → policies + triggers
-- -----------------------------------------------------------------------------
create table app.data_scope_registry (
  table_name    text not null,
  dimension     text not null check (dimension in ('CUSTOMER', 'VENDOR', 'PARTY', 'ITEM')),
  columns       text[] not null,
  read_any      boolean not null default false,
  guard_writes  boolean not null default true,
  primary key (table_name, dimension)
);
insert into app.data_scope_registry (table_name, dimension, columns, read_any, guard_writes) values
  -- sales side
  ('customer_pos',      'CUSTOMER', '{party_id}', false, true),
  ('sales_orders',      'CUSTOMER', '{party_id}', false, true),
  ('sales_returns',     'CUSTOMER', '{party_id}', false, true),
  ('customer_bills',    'CUSTOMER', '{party_id}', false, true),
  -- purchase / job-work side
  ('purchase_orders',   'VENDOR',   '{party_id}', false, true),
  ('purchase_receipts', 'VENDOR',   '{party_id}', false, true),
  ('purchase_returns',  'VENDOR',   '{party_id}', false, true),
  ('service_bills',     'VENDOR',   '{party_id}', false, true),
  ('job_work_orders',   'VENDOR',   '{party_id}', false, true),
  ('job_work_receipts', 'VENDOR',   '{party_id}', false, true),
  ('job_work_returns',  'VENDOR',   '{party_id}', false, true),
  ('material_issues',   'VENDOR',   '{party_id}', false, true),
  -- party-neutral
  ('parties',             'PARTY', '{id}',       false, true),
  ('documents',           'PARTY', '{party_id}', false, true),
  ('email_outbox',        'PARTY', '{party_id}', false, true),
  ('godowns',             'PARTY', '{party_id}', false, true),
  ('journal_entry_lines', 'PARTY', '{party_id}', false, true),
  ('party_item_rates',    'PARTY', '{party_id}', false, true),
  ('payment_reminders',   'PARTY', '{party_id}', false, true),
  ('portal_users',        'PARTY', '{party_id}', false, true),
  ('stock_movements',     'PARTY', '{party_id}', false, true),
  ('vouchers',            'PARTY', '{party_id}', false, true),
  ('voucher_lines',       'PARTY', '{party_id}', false, true),
  ('worker_earnings',     'PARTY', '{party_id}', false, true),
  ('item_rate_history',   'PARTY', '{party_id}', false, false),
  -- items
  ('items',                       'ITEM', '{id}',                          false, true),
  ('item_packings',               'ITEM', '{item_id}',                     false, true),
  ('item_images',                 'ITEM', '{item_id}',                     false, true),
  ('item_rate_history',           'ITEM', '{item_id}',                     false, false),
  ('item_consumption_rules',      'ITEM', '{fg_item_id,consumed_item_id}', true,  true),
  ('party_item_rates',            'ITEM', '{item_id}',                     false, true),
  ('stock_movements',             'ITEM', '{item_id}',                     false, true),
  ('stock_balances',              'ITEM', '{item_id}',                     false, false),
  ('stock_reserved',              'ITEM', '{item_id}',                     false, false),
  ('stock_reservations',          'ITEM', '{item_id}',                     false, true),
  ('stock_reservation_movements', 'ITEM', '{item_id}',                     false, true),
  ('customer_po_lines',           'ITEM', '{item_id}',                     false, true),
  ('dispatch_lines',              'ITEM', '{item_id}',                     false, true),
  ('job_work_order_lines',        'ITEM', '{item_id}',                     false, true),
  ('job_work_receipt_lines',      'ITEM', '{item_id}',                     false, true),
  ('job_work_return_lines',       'ITEM', '{item_id}',                     false, true),
  ('material_issue_lines',        'ITEM', '{item_id}',                     false, true),
  ('production_order_lines',      'ITEM', '{item_id}',                     false, true),
  ('production_receipt_lines',    'ITEM', '{item_id}',                     false, true),
  ('purchase_order_lines',        'ITEM', '{item_id}',                     false, true),
  ('purchase_receipt_lines',      'ITEM', '{item_id}',                     false, true),
  ('purchase_return_lines',       'ITEM', '{item_id}',                     false, true),
  ('sales_order_lines',           'ITEM', '{item_id}',                     false, true),
  ('sales_return_lines',          'ITEM', '{item_id}',                     false, true),
  ('service_bill_lines',          'ITEM', '{item_id}',                     false, true),
  ('stock_adjustment_lines',      'ITEM', '{item_id}',                     false, true),
  ('stock_transfer_lines',        'ITEM', '{item_id}',                     false, true),
  ('worker_earning_lines',        'ITEM', '{item_id}',                     false, true);

create or replace function app.tg_data_scope_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_cols text[]; v_col text; v_row jsonb; v_id uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select columns into v_cols from app.data_scope_registry where table_name = tg_table_name and dimension = tg_argv[0];
  foreach v_row in array array_remove(array[case when tg_op <> 'INSERT' then to_jsonb(old) end,
                                            case when tg_op <> 'DELETE' then to_jsonb(new) end], null) loop
    foreach v_col in array v_cols loop
      v_id := (v_row ->> v_col)::uuid;
      if not app.scope_check(tg_argv[0], (v_row ->> 'company_id')::uuid, v_id) then
        raise exception 'Access denied: % % is outside your data scope', lower(case tg_argv[0] when 'PARTY' then 'party' else tg_argv[0] end),
          coalesce((select code from public.parties where id = v_id), (select code from public.items where id = v_id), v_id::text)
          using errcode = '42501';
      end if;
    end loop;
  end loop;
  return coalesce(new, old);
end;
$$;

-- Lines of a scoped document (RPCs that change only lines): parent allowed.
create or replace function app.tg_data_scope_line_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_header jsonb; r app.data_scope_registry; v_col text;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  execute format('select to_jsonb(h) from public.%I h where id = $1', tg_argv[0])
    into v_header using (to_jsonb(coalesce(new, old)) ->> tg_argv[1])::uuid;
  if v_header is null then
    return coalesce(new, old);
  end if;
  for r in select * from app.data_scope_registry where table_name = tg_argv[0] and dimension <> 'ITEM' loop
    foreach v_col in array r.columns loop
      if not app.scope_check(r.dimension, (v_header ->> 'company_id')::uuid, (v_header ->> v_col)::uuid) then
        raise exception 'Access denied: the document is outside your data scope' using errcode = '42501';
      end if;
    end loop;
  end loop;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t app.data_scope_registry; v_has_company boolean; v_read text; v_write text; v_expr text; d record;
begin
  for t in select * from app.data_scope_registry loop
    v_has_company := exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = t.table_name and column_name = 'company_id');
    select string_agg(e, case when t.read_any then ' or ' else ' and ' end), string_agg(e, ' and ')
      into v_read, v_write
    from (select case
            when v_has_company and t.dimension = 'PARTY' then format(
              '(%1$I is null or company_id = any ((select app.party_unrestricted_company_ids())::uuid[])'
              ' or %1$I = any ((select app.allowed_party_ids())::uuid[]))', c)
            when v_has_company then format(
              '(%1$I is null or company_id = any ((select app.scope_unrestricted_company_ids(%2$L))::uuid[])'
              ' or %1$I = any ((select app.scope_allowed_ids(%2$L))::uuid[]))', c, t.dimension)
            else format(
              '((select app.scope_unrestricted_everywhere(%2$L)) or %1$I is null'
              ' or %1$I = any ((select app.scope_visible_ids(%2$L))::uuid[]))', c, t.dimension) end as e
          from unnest(t.columns) c) x;
    execute format('create policy %1$s on public.%2$I as restrictive for all to authenticated using (%3$s) with check (%4$s)',
                   t.table_name || '_' || lower(t.dimension) || '_scope', t.table_name, v_read, v_write);
    if t.guard_writes then
      execute format('create trigger %1$s before insert or update or delete on public.%2$I
                      for each row execute function app.tg_data_scope_guard(%3$L)',
                     t.table_name || '_' || lower(t.dimension) || '_scope', t.table_name, t.dimension);
    end if;
  end loop;

  -- lines of party-scoped documents
  for d in select distinct x.table_name, x.line_table, x.line_fk from (
             select dt.table_name, dt.line_table, dt.line_fk from app.doc_types dt where dt.line_table is not null
             union all select 'customer_pos', 'customer_po_lines', 'customer_po_id') x
           join app.data_scope_registry r on r.table_name = x.table_name and r.dimension <> 'ITEM' loop
    execute format('create trigger %1$s_doc_scope before insert or update or delete on public.%1$I
                    for each row execute function app.tg_data_scope_line_guard(%2$L, %3$L)',
                   d.line_table, d.table_name, d.line_fk);
  end loop;
end $$;

-- Dispatches carry the customer through their sales order.
create policy dispatches_customer_scope on public.dispatches as restrictive for all to authenticated
  using (company_id = any ((select app.scope_unrestricted_company_ids('CUSTOMER'))::uuid[])
         or exists (select 1 from public.sales_orders so where so.id = dispatches.sales_order_id))
  with check (company_id = any ((select app.scope_unrestricted_company_ids('CUSTOMER'))::uuid[])
              or exists (select 1 from public.sales_orders so where so.id = dispatches.sales_order_id));
create or replace function app.tg_dispatch_customer_scope()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.dispatches := coalesce(new, old);
begin
  if auth.uid() is not null and not app.scope_check('CUSTOMER', r.company_id,
       (select party_id from public.sales_orders where id = r.sales_order_id)) then
    raise exception 'Access denied: the customer of this dispatch is outside your data scope' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger dispatches_customer_scope before insert or update or delete on public.dispatches
  for each row execute function app.tg_dispatch_customer_scope();

-- For RPCs that read one document by id (print, email): party scope.
create or replace function app.assert_doc_party_scope(p_table text, p_id uuid)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_row jsonb; r app.data_scope_registry; v_col text;
begin
  if auth.uid() is null then
    return;
  end if;
  execute format('select to_jsonb(h) from public.%I h where id = $1', p_table) into v_row using p_id;
  if v_row is null then
    return;
  end if;
  for r in select * from app.data_scope_registry where table_name = p_table and dimension <> 'ITEM' loop
    foreach v_col in array r.columns loop
      if not app.scope_check(r.dimension, (v_row ->> 'company_id')::uuid, (v_row ->> v_col)::uuid) then
        raise exception 'Access denied: the document is outside your data scope' using errcode = '42501';
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.purchase_order_print(p_po_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare o public.purchase_orders;
begin
  select * into o from public.purchase_orders where id = p_po_id;
  if o.id is null or not (app.is_trusted_caller() or app.has_permission(o.company_id, 'purchase_order.view')) then
    raise exception 'Purchase order not found' using errcode = 'P0001';
  end if;
  perform app.assert_doc_godown_scope('purchase_orders', p_po_id);
  perform app.assert_doc_party_scope('purchase_orders', p_po_id);
  return app.purchase_order_print_data(p_po_id);
end;
$$;

create or replace function public.purchase_order_send_email(p_po_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.purchase_orders; v uuid;
begin
  select * into o from public.purchase_orders where id = p_po_id;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Purchase order not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'email.create');
  perform app.assert_doc_godown_scope('purchase_orders', p_po_id);
  perform app.assert_doc_party_scope('purchase_orders', p_po_id);
  if o.status in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED') then
    raise exception 'Only confirmed POs can be emailed' using errcode = 'P0001';
  end if;
  v := app.queue_vendor_po_email(o.id);
  if v is null then
    raise exception 'Vendor PO email is turned off in Settings → Email (or for this vendor)' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Document files: a party-scoped user cannot open a file of another party.
create or replace function app.storage_can_read(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select (app.has_permission(app.try_uuid(split_part(p_name, '/', 1)), 'documents.view')
          and not exists (select 1 from public.documents d where d.storage_path = p_name
                          and not app.party_allowed(d.company_id, d.party_id)))
      or exists (select 1 from public.documents d
                 join public.portal_users pu on pu.party_id = d.party_id and pu.company_id = d.company_id
                 join public.company_settings s on s.company_id = d.company_id
                 where d.storage_path = p_name and d.visible_to_party and not d.is_deleted
                   and pu.user_id = auth.uid() and pu.is_active
                   and case pu.kind when 'CUSTOMER' then s.customer_portal_enabled else s.vendor_portal_enabled end)
$$;

-- -----------------------------------------------------------------------------
-- Customer / vendor save (audited by the parties audit trigger)
-- payload: code, name, roles[], gstin, pan, mobile, phone, email, contact_person,
--          address, city, state_code, pincode, area, credit_days, credit_limit,
--          payment_terms, notes, is_active, custom{}
-- -----------------------------------------------------------------------------
create or replace function public.party_save(p_company_id uuid, p_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  p public.parties; v_id uuid; v_roles text[]; v_entities text[] := '{}'; v_custom jsonb;
  v_cs uuid[]; v_vs uuid[];
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into p from public.parties where id = p_id and company_id = p_company_id;
    if p.id is null or not app.party_allowed(p_company_id, p_id) then
      raise exception 'Customer / vendor not found' using errcode = 'P0001';
    end if;
    perform app.require_permission(p_company_id, 'parties.edit');
  else
    perform app.require_permission(p_company_id, 'parties.create');
  end if;
  v_roles := case when p_payload ? 'roles'
                  then array(select distinct upper(x) from jsonb_array_elements_text(p_payload->'roles') x)
                  else array(select role::text from public.party_roles where party_id = p_id) end;
  if exists (select 1 from unnest(v_roles) r where r not in ('CUSTOMER', 'SUPPLIER', 'JOB_WORKER', 'CUTTER', 'TRANSPORTER', 'WORKER')) then
    raise exception 'Unknown party type' using errcode = 'P0001';
  end if;
  -- restricted users can only keep records inside their own scope
  v_cs := app.user_scope_ids(auth.uid(), p_company_id, 'CUSTOMER');
  v_vs := app.user_scope_ids(auth.uid(), p_company_id, 'VENDOR');
  if 'CUSTOMER' = any (v_roles) and v_cs is not null and (p_id is null or not p_id = any (v_cs)) then
    raise exception 'Access denied: customers outside your data scope' using errcode = '42501';
  end if;
  if v_roles && array['SUPPLIER', 'JOB_WORKER', 'CUTTER'] and v_vs is not null and (p_id is null or not p_id = any (v_vs)) then
    raise exception 'Access denied: vendors outside your data scope' using errcode = '42501';
  end if;
  if 'CUSTOMER' = any (v_roles) then v_entities := array_append(v_entities, 'CUSTOMER'); end if;
  if v_roles && array['SUPPLIER', 'JOB_WORKER', 'CUTTER'] then v_entities := array_append(v_entities, 'VENDOR'); end if;
  v_custom := app.validate_custom(p_company_id, v_entities,
                                  coalesce(p_payload->'custom', case when p_id is null then '{}'::jsonb else p.custom end), true);

  if p_id is null then
    insert into public.parties (company_id, code, name, gstin, pan, mobile, phone, email, contact_person, address, city,
                                state_code, pincode, area, credit_days, credit_limit, payment_terms, notes, is_active, custom)
    values (p_company_id, upper(trim(p_payload->>'code')), trim(p_payload->>'name'), nullif(upper(trim(p_payload->>'gstin')), ''),
            nullif(upper(trim(p_payload->>'pan')), ''), nullif(trim(p_payload->>'mobile'), ''), nullif(trim(p_payload->>'phone'), ''),
            nullif(lower(trim(p_payload->>'email')), ''), nullif(trim(p_payload->>'contact_person'), ''),
            nullif(trim(p_payload->>'address'), ''), nullif(trim(p_payload->>'city'), ''), nullif(trim(p_payload->>'state_code'), ''),
            nullif(trim(p_payload->>'pincode'), ''), nullif(trim(p_payload->>'area'), ''),
            coalesce((p_payload->>'credit_days')::int, 0), (p_payload->>'credit_limit')::numeric,
            nullif(trim(p_payload->>'payment_terms'), ''), nullif(trim(p_payload->>'notes'), ''),
            coalesce((p_payload->>'is_active')::boolean, true), v_custom)
    returning id into v_id;
  else
    update public.parties set
      code = case when p_payload ? 'code' then upper(trim(p_payload->>'code')) else code end,
      name = case when p_payload ? 'name' then trim(p_payload->>'name') else name end,
      gstin = case when p_payload ? 'gstin' then nullif(upper(trim(p_payload->>'gstin')), '') else gstin end,
      pan = case when p_payload ? 'pan' then nullif(upper(trim(p_payload->>'pan')), '') else pan end,
      mobile = case when p_payload ? 'mobile' then nullif(trim(p_payload->>'mobile'), '') else mobile end,
      phone = case when p_payload ? 'phone' then nullif(trim(p_payload->>'phone'), '') else phone end,
      email = case when p_payload ? 'email' then nullif(lower(trim(p_payload->>'email')), '') else email end,
      contact_person = case when p_payload ? 'contact_person' then nullif(trim(p_payload->>'contact_person'), '') else contact_person end,
      address = case when p_payload ? 'address' then nullif(trim(p_payload->>'address'), '') else address end,
      city = case when p_payload ? 'city' then nullif(trim(p_payload->>'city'), '') else city end,
      state_code = case when p_payload ? 'state_code' then nullif(trim(p_payload->>'state_code'), '') else state_code end,
      pincode = case when p_payload ? 'pincode' then nullif(trim(p_payload->>'pincode'), '') else pincode end,
      area = case when p_payload ? 'area' then nullif(trim(p_payload->>'area'), '') else area end,
      credit_days = case when p_payload ? 'credit_days' then coalesce((p_payload->>'credit_days')::int, 0) else credit_days end,
      credit_limit = case when p_payload ? 'credit_limit' then (p_payload->>'credit_limit')::numeric else credit_limit end,
      payment_terms = case when p_payload ? 'payment_terms' then nullif(trim(p_payload->>'payment_terms'), '') else payment_terms end,
      notes = case when p_payload ? 'notes' then nullif(trim(p_payload->>'notes'), '') else notes end,
      is_active = case when p_payload ? 'is_active' then (p_payload->>'is_active')::boolean else is_active end,
      custom = v_custom
    where id = p_id
    returning id into v_id;
  end if;
  if p_payload ? 'roles' then
    delete from public.party_roles where party_id = v_id and role::text <> all (v_roles);
    insert into public.party_roles (party_id, role) select v_id, r::public.party_role from unnest(v_roles) r on conflict do nothing;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.party_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.party_save(uuid, uuid, jsonb) to authenticated, service_role;
revoke all on function app.tg_data_scope_guard(), app.tg_data_scope_line_guard(), app.tg_dispatch_customer_scope(),
                       app.tg_parties_custom() from public, anon, authenticated;
