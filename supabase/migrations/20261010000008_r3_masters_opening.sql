-- =============================================================================
-- PLATFORM R3 (8/10) — master data completion (W9) and opening balances (D5)
--   * items: part number, model, reorder quantity, minimum / maximum sale rate
--     (SALE class) with the company policy OFF / WARN / BLOCK enforced on
--     sales order lines (override right + reason), item documents
--   * party rates: active / inactive
--   * godowns: manager, default godown, receipts / dispatch / transfers allowed
--     (enforced on every stock movement)
--   * customers / vendors: legal name, type (configurable), status
--     ACTIVE / ON_HOLD / DISABLED (on hold blocks new orders / POs), automatic
--     codes; party_save checks customers.* / vendors.* per kind
--   * delete where safe: only unreferenced masters, otherwise disable
--   * opening balances (D5): one balanced opening journal per party and side
--     (party line on the debtor / creditor control account against Opening
--     Balance Adjustment), validated direction, idempotent, no duplicate,
--     period rules, correction only by an audited reversal; no tax lines
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Items
-- -----------------------------------------------------------------------------
alter table public.items
  add column part_no       text,
  add column model         text,
  add column reorder_qty   numeric(16,3) check (reorder_qty is null or reorder_qty >= 0),
  add column min_sale_rate numeric(14,4) check (min_sale_rate is null or min_sale_rate >= 0),
  add column max_sale_rate numeric(14,4) check (max_sale_rate is null or max_sale_rate >= 0),
  add constraint items_sale_rate_range check (min_sale_rate is null or max_sale_rate is null or min_sale_rate <= max_sale_rate);
-- the rate limits are sale rates (W13): column privilege + masked view
revoke select (min_sale_rate, max_sale_rate) on public.items from authenticated;
grant select (part_no, model, reorder_qty) on public.items to authenticated;
insert into secure.sensitive_columns values
  ('items', 'min_sale_rate', 'SALE', 'v_items'), ('items', 'max_sale_rate', 'SALE', 'v_items')
on conflict do nothing;
-- a rate-limit change is a rate change: needs items.edit_rate (R2 guard covers the prices)
create or replace function app.tg_items_rate_limit_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if (new.min_sale_rate is distinct from old.min_sale_rate or new.max_sale_rate is distinct from old.max_sale_rate)
     and auth.uid() is not null and not app.is_trusted_caller() and not app.has_permission(new.company_id, 'items.edit_rate') then
    raise exception 'Permission denied: items.edit_rate is required to change rate limits' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger items_rate_limit_guard before update of min_sale_rate, max_sale_rate on public.items
  for each row execute function app.tg_items_rate_limit_guard();

create or replace view public.v_items with (security_barrier) as
select i.id, i.company_id, i.code, i.name, i.description, i.item_kind, i.category_id, i.brand_id, i.base_unit_id,
       i.purchase_unit_id, i.sales_unit_id, i.hsn_code, i.gst_rate, i.barcode, i.sku, i.notes, i.custom, i.min_stock,
       i.max_stock, i.reorder_level,
       (case when i.company_id = any ((select secure.allowed('PURCHASE'))::uuid[]) then i.job_work_rate end)::numeric(14,4) as job_work_rate,
       i.is_stock_tracked, i.is_active, i.is_deleted, i.portal_visible, i.created_at, i.updated_at,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) then i.sale_price end as sale_price,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]) then i.purchase_price end as purchase_price,
       i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) as can_view_sale_rate,
       i.company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]) as can_view_purchase_rate,
       i.company_id = any ((select app.permitted_company_ids('items.edit_rate'))::uuid[]) as can_edit_rate,
       c.avg_cost, c.margin, c.margin_pct,
       i.part_no, i.model, i.reorder_qty,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) then i.min_sale_rate end as min_sale_rate,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) then i.max_sale_rate end as max_sale_rate
from public.items i
left join secure.item_cost_values c on c.item_id = i.id
where i.company_id = any ((select app.user_company_ids())::uuid[])
  and (i.company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[])
       or i.id = any ((select app.scope_allowed_ids('ITEM'))::uuid[]));
revoke insert, update, delete on public.v_items from authenticated, anon;

-- item documents
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('purchase_order', 'purchase_receipt', 'customer_bill', 'sales_order', 'customer_po', 'dispatch', 'voucher',
                         'party', 'item'));
do $$
declare v_def text;
begin
  select pg_get_functiondef('app.entity_party'::regproc) into v_def;
  v_def := replace(v_def, $x$    else raise exception 'Unknown document entity %', p_entity_type using errcode = 'P0001';$x$,
                   $x$    when 'item'             then select o.company_id, null::uuid into company_id, party_id from public.items o where o.id = p_entity_id;
    else raise exception 'Unknown document entity %', p_entity_type using errcode = 'P0001';$x$);
  execute v_def;
end $$;

-- -----------------------------------------------------------------------------
-- Sale rate limits on sales order lines
-- -----------------------------------------------------------------------------
alter table public.sales_orders add column rate_override_reason text;

create or replace function app.tg_sale_rate_limit()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.sales_orders; i public.items; v_policy text; v_base numeric;
begin
  if new.rate is null or (tg_op = 'UPDATE' and new.rate is not distinct from old.rate and new.item_id = old.item_id) then
    return new;
  end if;
  select * into h from public.sales_orders where id = new.order_id;
  select coalesce(sale_rate_limit_policy, 'OFF') into v_policy from public.company_settings where company_id = h.company_id;
  if v_policy <> 'BLOCK' then return new; end if;
  select * into i from public.items where id = new.item_id;
  v_base := new.rate / nullif(new.factor_to_base, 0);
  if (i.min_sale_rate is not null and v_base < i.min_sale_rate) or (i.max_sale_rate is not null and v_base > i.max_sale_rate) then
    if auth.uid() is not null and app.has_permission(h.company_id, 'sales_order.override_rate_limit')
       and coalesce(trim(h.rate_override_reason), '') <> '' then
      perform app.audit(h.company_id, 'sales_orders', h.id::text, 'RATE_LIMIT_OVERRIDE', null,
                        jsonb_build_object('item_id', i.id, 'rate_per_base', round(v_base, 4), 'reason', h.rate_override_reason));
      return new;
    end if;
    raise exception 'Rate % for % is outside the allowed sale rate (% – %)%', round(v_base, 4), i.name,
      coalesce(i.min_sale_rate::text, '—'), coalesce(i.max_sale_rate::text, '—'),
      case when app.has_permission(h.company_id, 'sales_order.override_rate_limit') then ': enter an override reason' else '' end
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger sales_order_lines_rate_limit before insert or update of rate, item_id on public.sales_order_lines
  for each row execute function app.tg_sale_rate_limit();

-- the override reason travels with the document (doc_save keeps unknown header keys out; set it here)
create or replace function public.sales_order_set_override_reason(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.sales_orders;
begin
  select * into h from public.sales_orders where id = p_order_id;
  if h.id is null or not app.is_member(h.company_id) or not app.record_allowed(h.company_id, h.created_by) then
    raise exception 'Sales order not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(h.company_id, 'sales_order.override_rate_limit');
  update public.sales_orders set rate_override_reason = nullif(trim(p_reason), '') where id = p_order_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Party rates: active / inactive (inactive rates are not used for new documents)
-- -----------------------------------------------------------------------------
alter table public.party_item_rates add column is_active boolean not null default true;
do $$
declare f text; v_def text;
begin
  foreach f in array array['app.customer_price', 'app.vendor_price'] loop
    select pg_get_functiondef(f::regproc) into v_def;
    v_def := regexp_replace(v_def, 'from public\.party_item_rates(\s+\w+)?\s+where', 'from public.party_item_rates\1 where is_active and', 'g');
    execute v_def;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Godowns
-- -----------------------------------------------------------------------------
alter table public.godowns
  add column manager_user_id   uuid references auth.users (id) on delete set null,
  add column is_default        boolean not null default false,
  add column receipts_allowed  boolean not null default true,
  add column dispatch_allowed  boolean not null default true,
  add column transfers_allowed boolean not null default true;
create unique index godowns_one_default on public.godowns (company_id) where is_default and not is_deleted;

create or replace function app.tg_godown_transaction_flags()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare g public.godowns;
begin
  if new.reversal_of is not null then return new; end if;          -- cancellations always possible
  select * into g from public.godowns where id = new.godown_id;
  if new.movement_type in ('STOCK_TRANSFER_IN', 'STOCK_TRANSFER_OUT') then
    if not g.transfers_allowed then
      raise exception 'Godown % does not allow transfers', g.name using errcode = 'P0001';
    end if;
  elsif new.direction = 1 and not g.receipts_allowed then
    raise exception 'Godown % does not accept receipts', g.name using errcode = 'P0001';
  elsif new.direction = -1 and new.movement_type in ('SALE_DISPATCH', 'JOB_WORK_ISSUE', 'PURCHASE_RETURN', 'STOCK_OUT')
        and not g.dispatch_allowed then
    raise exception 'Godown % does not allow dispatch', g.name using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stock_movements_godown_flags before insert on public.stock_movements
  for each row execute function app.tg_godown_transaction_flags();

-- users with access to a godown (godown page), assign / remove (writes user scopes)
create or replace function public.godown_users(p_godown_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare g public.godowns;
begin
  select * into g from public.godowns where id = p_godown_id;
  if g.id is null or not app.is_member(g.company_id) then
    raise exception 'Godown not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(g.company_id, 'users.view');
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email, 'full_name', pr.full_name,
                                                       'access', case when s.ids is null then 'ALL' else 'SELECTED' end)
                                    order by u.email)
                   from (select distinct user_id from public.user_roles where company_id = g.company_id) m
                   join auth.users u on u.id = m.user_id
                   join public.profiles pr on pr.id = u.id
                   cross join lateral (select app.user_scope_ids(u.id, g.company_id, 'GODOWN') as ids) s
                   where s.ids is null or g.id = any (s.ids)), '[]');
end;
$$;

create or replace function public.godown_assign_user(p_godown_id uuid, p_user_id uuid, p_assign boolean)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare g public.godowns; v_ids uuid[]; v_new uuid[];
begin
  select * into g from public.godowns where id = p_godown_id;
  if g.id is null or not app.is_member(g.company_id) then
    raise exception 'Godown not found' using errcode = 'P0001';
  end if;
  select array_agg(entity_id) into v_ids from public.user_data_scopes
   where company_id = g.company_id and user_id = p_user_id and dimension = 'GODOWN';
  if p_assign then
    -- a user with all godowns becomes restricted to this one (the screen warns before)
    v_new := (select array_agg(distinct x) from unnest(coalesce(v_ids, '{}') || g.id) x where x <> app.scope_none());
  else
    v_new := (select array_agg(x) from unnest(coalesce(v_ids, '{}')) x where x <> g.id);
    if v_new is null then v_new := array[app.scope_none()]; end if;   -- removing the last godown = no godown, never "all"
  end if;
  perform public.user_set_scope(g.company_id, p_user_id, 'GODOWN', v_new);
  return jsonb_build_object('godown_ids', to_jsonb(v_new));
end;
$$;

-- -----------------------------------------------------------------------------
-- Customers / vendors
-- -----------------------------------------------------------------------------
create table public.party_types (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  applies_to text not null default 'BOTH' check (applies_to in ('CUSTOMER', 'VENDOR', 'BOTH')),
  is_active  boolean not null default true,
  unique (company_id, name)
);
alter table public.party_types enable row level security;
create policy party_types_read on public.party_types for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
create policy party_types_write on public.party_types for all to authenticated
  using (app.has_permission(company_id, 'customers.edit') or app.has_permission(company_id, 'vendors.edit'))
  with check (app.has_permission(company_id, 'customers.edit') or app.has_permission(company_id, 'vendors.edit'));
grant select, insert, update, delete on public.party_types to authenticated;
grant all on public.party_types to service_role;
create trigger party_types_audit after insert or update or delete on public.party_types
  for each row execute function app.tg_audit_row();

alter table public.parties
  add column legal_name    text,
  add column party_type_id uuid references public.party_types (id) on delete set null,
  add column status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'ON_HOLD', 'DISABLED'));
update public.parties set status = 'DISABLED' where not is_active;

-- status and is_active stay consistent (existing code uses is_active)
create or replace function app.tg_party_status()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.is_active := new.status <> 'DISABLED';
  elsif tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'ACTIVE' else 'DISABLED' end;
  elsif tg_op = 'INSERT' then
    if not new.is_active then new.status := 'DISABLED'; end if;
    new.is_active := new.status <> 'DISABLED';
  end if;
  return new;
end;
$$;
create trigger parties_status before insert or update on public.parties for each row execute function app.tg_party_status();

-- on hold: no new sales order / purchase order / customer PO for the party
create or replace function app.tg_party_on_hold()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.party_id is not null and (tg_op = 'INSERT' or new.party_id is distinct from old.party_id)
     and exists (select 1 from public.parties where id = new.party_id and status = 'ON_HOLD') then
    raise exception '% is on hold: no new orders', (select name from public.parties where id = new.party_id) using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger sales_orders_party_on_hold before insert or update of party_id on public.sales_orders
  for each row execute function app.tg_party_on_hold();
create trigger purchase_orders_party_on_hold before insert or update of party_id on public.purchase_orders
  for each row execute function app.tg_party_on_hold();
create trigger customer_pos_party_on_hold before insert or update of party_id on public.customer_pos
  for each row execute function app.tg_party_on_hold();

-- party save: customers.* / vendors.* per kind (parties.* for other parties), new fields, automatic codes
create or replace function public.party_save(p_company_id uuid, p_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  p public.parties; v_id uuid; v_roles text[]; v_old_roles text[] := '{}'; v_entities text[] := '{}'; v_custom jsonb;
  v_cs uuid[]; v_vs uuid[]; v_cust boolean; v_vend boolean; v_code text; v_status text;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into p from public.parties where id = p_id and company_id = p_company_id;
    if p.id is null or not app.party_allowed(p_company_id, p_id) then
      raise exception 'Customer / vendor not found' using errcode = 'P0001';
    end if;
    v_old_roles := array(select role::text from public.party_roles where party_id = p_id);
  end if;
  v_roles := case when p_payload ? 'roles'
                  then array(select distinct upper(x) from jsonb_array_elements_text(p_payload->'roles') x)
                  else v_old_roles end;
  if exists (select 1 from unnest(v_roles) r where r not in ('CUSTOMER', 'SUPPLIER', 'JOB_WORKER', 'CUTTER', 'TRANSPORTER', 'WORKER')) then
    raise exception 'Unknown party type' using errcode = 'P0001';
  end if;
  -- rights of every kind the record has before and after
  v_cust := 'CUSTOMER' = any (v_roles || v_old_roles);
  v_vend := (v_roles || v_old_roles) && array['SUPPLIER', 'JOB_WORKER', 'CUTTER'];
  if not app.party_right(p_company_id, v_cust, v_vend, case when p_id is null then 'create' else 'edit' end) then
    raise exception 'Permission denied: % is required', case when v_cust then 'customers.' else case when v_vend then 'vendors.' else 'parties.' end end
                    || case when p_id is null then 'create' else 'edit' end using errcode = '42501';
  end if;
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
  if p_payload ? 'party_type_id' and nullif(p_payload->>'party_type_id', '') is not null
     and not exists (select 1 from public.party_types where id = (p_payload->>'party_type_id')::uuid and company_id = p_company_id) then
    raise exception 'Unknown customer / vendor type' using errcode = 'P0001';
  end if;
  v_status := coalesce(upper(p_payload->>'status'), case when p_payload ? 'is_active' and not (p_payload->>'is_active')::boolean then 'DISABLED' end);

  if p_id is null then
    v_code := upper(trim(p_payload->>'code'));
    if coalesce(v_code, '') = '' then
      v_code := app.next_master_code(p_company_id, case when 'CUSTOMER' = any (v_roles) then 'CUSTOMER' else 'VENDOR' end);
      if v_code is null then
        raise exception 'Code is required (automatic codes are not switched on)' using errcode = 'P0001';
      end if;
    end if;
    insert into public.parties (company_id, code, name, legal_name, gstin, pan, mobile, phone, email, contact_person, address, city,
                                state_code, pincode, area, credit_days, credit_limit, payment_terms, notes, is_active, status,
                                party_type_id, custom)
    values (p_company_id, v_code, trim(p_payload->>'name'), nullif(trim(p_payload->>'legal_name'), ''),
            nullif(upper(trim(p_payload->>'gstin')), ''), nullif(upper(trim(p_payload->>'pan')), ''),
            nullif(trim(p_payload->>'mobile'), ''), nullif(trim(p_payload->>'phone'), ''),
            nullif(lower(trim(p_payload->>'email')), ''), nullif(trim(p_payload->>'contact_person'), ''),
            nullif(trim(p_payload->>'address'), ''), nullif(trim(p_payload->>'city'), ''), nullif(trim(p_payload->>'state_code'), ''),
            nullif(trim(p_payload->>'pincode'), ''), nullif(trim(p_payload->>'area'), ''),
            coalesce((p_payload->>'credit_days')::int, 0), (p_payload->>'credit_limit')::numeric,
            nullif(trim(p_payload->>'payment_terms'), ''), nullif(trim(p_payload->>'notes'), ''),
            coalesce(v_status, 'ACTIVE') <> 'DISABLED', coalesce(v_status, 'ACTIVE'),
            nullif(p_payload->>'party_type_id', '')::uuid, v_custom)
    returning id into v_id;
  else
    update public.parties set
      code = case when p_payload ? 'code' and coalesce(trim(p_payload->>'code'), '') <> '' then upper(trim(p_payload->>'code')) else code end,
      name = case when p_payload ? 'name' then trim(p_payload->>'name') else name end,
      legal_name = case when p_payload ? 'legal_name' then nullif(trim(p_payload->>'legal_name'), '') else legal_name end,
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
      status = coalesce(v_status, status),
      party_type_id = case when p_payload ? 'party_type_id' then nullif(p_payload->>'party_type_id', '')::uuid else party_type_id end,
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

-- imports use the party kind rights too (R2 checked parties.create / parties.edit)
do $$
declare v_def text;
begin
  select pg_get_functiondef('app.import_check'::regproc) into v_def;
  v_def := replace(v_def, $x$app.has_permission(p_company_id, 'parties.edit')$x$,
                   $x$app.has_permission(p_company_id, case when p_entity = 'CUSTOMERS' then 'customers.edit' else 'vendors.edit' end)$x$);
  v_def := replace(v_def, $x$app.has_permission(p_company_id, 'parties.create')$x$,
                   $x$app.has_permission(p_company_id, case when p_entity = 'CUSTOMERS' then 'customers.create' else 'vendors.create' end)$x$);
  v_def := replace(v_def, $x$'Permission parties.edit is required'$x$,
                   $x$'Permission ' || case when p_entity = 'CUSTOMERS' then 'customers' else 'vendors' end || '.edit is required'$x$);
  v_def := replace(v_def, $x$'Permission parties.create is required'$x$,
                   $x$'Permission ' || case when p_entity = 'CUSTOMERS' then 'customers' else 'vendors' end || '.create is required'$x$);
  if position('parties.' in v_def) > 0 then raise exception 'import_check: party permission not replaced'; end if;
  execute v_def;
  select pg_get_functiondef('public.import_commit'::regproc) into v_def;
  v_def := replace(v_def, $x$array[case a.action when 'CREATE' then 'parties.create' else 'parties.edit' end]$x$,
                   $x$array[case when j.entity = 'CUSTOMERS' then 'customers.' else 'vendors.' end
                            || case a.action when 'CREATE' then 'create' else 'edit' end]$x$);
  if position('parties.' in v_def) > 0 then raise exception 'import_commit: party permission not replaced'; end if;
  execute v_def;
end $$;

-- -----------------------------------------------------------------------------
-- Delete where safe (soft delete of unreferenced masters; otherwise disable)
-- -----------------------------------------------------------------------------
create or replace function app.master_references(p_table text, p_id uuid)
returns text[]
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare r record; v boolean; v_out text[] := '{}';
begin
  for r in
    select cl.relname as ref_table, a.attname as ref_col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = ('public.' || p_table)::regclass and cardinality(c.conkey) = 1
      and cl.relname not in ('audit_log', 'item_rate_history', 'item_cost_summary', 'party_roles', 'party_settings',
                             'item_packings', 'item_images', 'portal_users', 'company_users', 'storage_locations',
                             'party_addresses', 'documents', 'rate_change_requests', 'stock_balances')
  loop
    execute format('select exists (select 1 from public.%I where %I = $1)', r.ref_table, r.ref_col) into v using p_id;
    if v then v_out := v_out || r.ref_table; end if;
  end loop;
  if p_table = 'items' and exists (select 1 from public.stock_balances where item_id = p_id and base_qty <> 0) then v_out := v_out || 'stock_balances'; end if;
  if p_table = 'godowns' and exists (select 1 from public.stock_balances where godown_id = p_id and base_qty <> 0) then v_out := v_out || 'stock_balances'; end if;
  return v_out;
end;
$$;

create or replace function public.master_delete(p_company_id uuid, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_table text; v_refs text[]; v_party public.parties; v_old jsonb;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  v_table := case p_kind when 'ITEM' then 'items' when 'GODOWN' then 'godowns' when 'PARTY' then 'parties' when 'LOCATION' then 'storage_locations' end;
  if v_table is null then
    raise exception 'Unknown master %', p_kind using errcode = 'P0001';
  end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1 and x.company_id = $2', v_table) into v_old using p_id, p_company_id;
  if v_old is null then
    raise exception 'Record not found' using errcode = 'P0001';
  end if;
  if p_kind = 'PARTY' then
    select * into v_party from public.parties where id = p_id;
    if not app.party_allowed(p_company_id, p_id) or not app.party_right(p_company_id, v_party.is_customer, v_party.is_vendor, 'delete') then
      raise exception 'Permission denied: delete right for this customer / vendor is required' using errcode = '42501';
    end if;
  else
    perform app.require_permission(p_company_id, case p_kind when 'ITEM' then 'items.delete' else 'godowns.delete' end);
    if p_kind = 'ITEM' and not app.scope_allows(p_company_id, 'ITEM', p_id) then
      raise exception 'Access denied: outside your data scope' using errcode = '42501';
    end if;
    if p_kind = 'GODOWN' and not app.scope_allows(p_company_id, 'GODOWN', p_id) then
      raise exception 'Access denied: outside your data scope' using errcode = '42501';
    end if;
  end if;
  v_refs := app.master_references(v_table, p_id);
  if p_kind = 'LOCATION' and exists (select 1 from public.stock_balances where location_id = p_id and base_qty <> 0) then
    v_refs := v_refs || 'stock_balances';
  end if;
  if cardinality(v_refs) > 0 then
    raise exception 'Cannot delete: it is used in % (disable it instead)', array_to_string(v_refs, ', ') using errcode = 'P0001';
  end if;
  if p_kind = 'LOCATION' then
    if (v_old->>'is_default')::boolean then
      raise exception 'The default location of a godown cannot be deleted' using errcode = 'P0001';
    end if;
    delete from public.storage_locations where id = p_id;
  else
    execute format('update public.%I set is_deleted = true, is_active = false where id = $1', v_table) using p_id;
  end if;
  perform app.audit(p_company_id, v_table, p_id::text, 'DELETE', v_old, null);
  return jsonb_build_object('deleted', true);
end;
$$;

-- bulk enable / disable (lists), scope-checked and audited per record
create or replace function public.master_set_active(p_company_id uuid, p_kind text, p_ids uuid[], p_active boolean)
returns integer
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_id uuid; n int := 0; v_party public.parties;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    if p_kind = 'PARTY' then
      select * into v_party from public.parties where id = v_id and company_id = p_company_id;
      continue when v_party.id is null;
      if not app.party_allowed(p_company_id, v_id) or not app.party_right(p_company_id, v_party.is_customer, v_party.is_vendor, 'edit') then
        raise exception 'Permission denied for %', v_party.name using errcode = '42501';
      end if;
      update public.parties set status = case when p_active then 'ACTIVE' else 'DISABLED' end where id = v_id and is_active <> p_active;
    elsif p_kind = 'ITEM' then
      perform app.require_permission(p_company_id, 'items.edit');
      if not app.scope_allows(p_company_id, 'ITEM', v_id) then
        raise exception 'Access denied: outside your data scope' using errcode = '42501';
      end if;
      update public.items set is_active = p_active where id = v_id and company_id = p_company_id and is_active <> p_active;
    else
      raise exception 'Unknown master %', p_kind using errcode = 'P0001';
    end if;
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Opening balances (D5)
-- -----------------------------------------------------------------------------
create table public.party_opening_balances (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  party_id         uuid not null references public.parties (id) on delete restrict,
  side             text not null check (side in ('RECEIVABLE', 'PAYABLE')),
  dr_cr            text not null check (dr_cr in ('DR', 'CR')),
  amount           numeric(16,2) not null check (amount > 0),
  as_of            date not null,
  journal_entry_id uuid references public.journal_entries (id),
  status           text not null default 'POSTED' check (status in ('POSTED', 'REVERSED')),
  idempotency_key  text,
  remarks          text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  reversed_at      timestamptz,
  reversed_by      uuid,
  reverse_reason   text
);
create unique index party_opening_balances_one_active on public.party_opening_balances (party_id, side) where status = 'POSTED';
create unique index party_opening_balances_idem on public.party_opening_balances (company_id, idempotency_key) where idempotency_key is not null;
alter table public.party_opening_balances enable row level security;
create policy party_opening_balances_read on public.party_opening_balances for select to authenticated
  using (case side when 'RECEIVABLE' then company_id = any ((select secure.allowed('AMOUNT_SALE'))::uuid[])
                   else company_id = any ((select secure.allowed('AMOUNT_PURCHASE'))::uuid[]) end);
create policy party_opening_balances_party_scope on public.party_opening_balances as restrictive for select to authenticated
  using ((company_id = any ((select app.party_unrestricted_company_ids())::uuid[])) or (party_id = any ((select app.allowed_party_ids())::uuid[])));
grant select on public.party_opening_balances to authenticated;
grant all on public.party_opening_balances to service_role;
insert into app.data_scope_registry (table_name, dimension, columns, read_any, guard_writes)
values ('party_opening_balances', 'PARTY', '{party_id}', false, false) on conflict do nothing;
insert into app.audit_coverage values ('party_opening_balances', 'RPC', 'opening_balance_post / opening_balance_reverse') on conflict do nothing;
create trigger party_opening_balances_no_delete before delete on public.party_opening_balances
  for each row execute function app.tg_block_mutation();

create or replace function public.opening_balance_post(p_company_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_party public.parties; v_side text := upper(p_payload->>'side'); v_drcr text := upper(p_payload->>'dr_cr');
  v_amount numeric := round((p_payload->>'amount')::numeric, 2); v_date date := (p_payload->>'as_of')::date;
  v_key text := nullif(trim(p_payload->>'idempotency_key'), ''); v_id uuid := gen_random_uuid(); v_je uuid;
  v_ctrl uuid; v_oba uuid; v_existing public.party_opening_balances; v_lines jsonb;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'accounts.opening_balance');
  if v_key is not null then
    select * into v_existing from public.party_opening_balances where company_id = p_company_id and idempotency_key = v_key;
    if v_existing.id is not null then           -- the same request again: no second posting
      return jsonb_build_object('id', v_existing.id, 'journal_entry_id', v_existing.journal_entry_id, 'duplicate_request', true);
    end if;
  end if;
  select * into v_party from public.parties where id = (p_payload->>'party_id')::uuid and company_id = p_company_id;
  if v_party.id is null or not app.party_allowed(p_company_id, v_party.id) then
    raise exception 'Customer / vendor not found' using errcode = 'P0001';
  end if;
  if v_side not in ('RECEIVABLE', 'PAYABLE') then
    raise exception 'Side must be RECEIVABLE or PAYABLE' using errcode = 'P0001';
  end if;
  if v_side = 'RECEIVABLE' and not v_party.is_customer then
    raise exception '% is not a customer: a receivable opening balance needs a customer', v_party.name using errcode = 'P0001';
  end if;
  if v_side = 'PAYABLE' and not v_party.is_vendor then
    raise exception '% is not a vendor: a payable opening balance needs a vendor', v_party.name using errcode = 'P0001';
  end if;
  perform secure.require_class(p_company_id, case v_side when 'RECEIVABLE' then 'AMOUNT_SALE' else 'AMOUNT_PURCHASE' end, 'An opening balance');
  if v_drcr not in ('DR', 'CR') then
    raise exception 'Choose debit (Dr) or credit (Cr)' using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'The amount must be greater than zero' using errcode = 'P0001';
  end if;
  if v_date is null then
    raise exception 'The as-of date is required' using errcode = 'P0001';
  end if;
  -- normal direction: customers owe us (Dr), we owe vendors (Cr); the opposite (advance) only when confirmed
  if ((v_side = 'RECEIVABLE' and v_drcr = 'CR') or (v_side = 'PAYABLE' and v_drcr = 'DR'))
     and not coalesce((p_payload->>'confirm_opposite')::boolean, false) then
    raise exception 'A % opening balance is normally %; confirm that this is an advance / opposite balance',
      lower(v_side), case v_side when 'RECEIVABLE' then 'debit' else 'credit' end using errcode = 'P0001';
  end if;
  if exists (select 1 from public.party_opening_balances where party_id = v_party.id and side = v_side and status = 'POSTED') then
    raise exception '% already has a % opening balance; reverse it first to correct it', v_party.name, lower(v_side) using errcode = 'P0001';
  end if;
  perform app.assert_period_open(p_company_id, v_date);
  v_ctrl := app.account_id(p_company_id, case v_side when 'RECEIVABLE' then 'SUNDRY_DEBTORS' else 'SUNDRY_CREDITORS' end);
  v_oba := app.account_id(p_company_id, 'OPENING_BALANCE_ADJ');
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_ctrl, 'party_id', v_party.id,
                       'debit', case when v_drcr = 'DR' then v_amount else 0 end, 'credit', case when v_drcr = 'CR' then v_amount else 0 end,
                       'narration', 'Opening balance'),
    jsonb_build_object('account_id', v_oba,
                       'debit', case when v_drcr = 'CR' then v_amount else 0 end, 'credit', case when v_drcr = 'DR' then v_amount else 0 end,
                       'narration', 'Opening balance ' || v_party.code));
  insert into public.party_opening_balances (id, company_id, party_id, side, dr_cr, amount, as_of, idempotency_key, remarks, created_by)
  values (v_id, p_company_id, v_party.id, v_side, v_drcr, v_amount, v_date, v_key, nullif(trim(p_payload->>'remarks'), ''), auth.uid());
  v_je := app.post_journal(p_company_id, v_date, 'party_opening_balances', v_id, v_party.code,
                           'Opening balance ' || v_party.name, v_lines, true);
  update public.party_opening_balances set journal_entry_id = v_je where id = v_id;
  perform app.audit(p_company_id, 'party_opening_balances', v_id::text, 'POST', null,
                    jsonb_build_object('party_id', v_party.id, 'side', v_side, 'dr_cr', v_drcr, 'amount', v_amount, 'as_of', v_date,
                                       'journal_entry_id', v_je));
  return jsonb_build_object('id', v_id, 'journal_entry_id', v_je);
end;
$$;

create or replace function public.opening_balance_reverse(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare b public.party_opening_balances;
begin
  select * into b from public.party_opening_balances where id = p_id for update;
  if b.id is null or not app.is_member(b.company_id) or not app.party_allowed(b.company_id, b.party_id) then
    raise exception 'Opening balance not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(b.company_id, 'accounts.opening_balance');
  perform secure.require_class(b.company_id, case b.side when 'RECEIVABLE' then 'AMOUNT_SALE' else 'AMOUNT_PURCHASE' end, 'An opening balance');
  if b.status <> 'POSTED' then
    raise exception 'This opening balance is already reversed' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for the reversal' using errcode = 'P0001';
  end if;
  -- the reversal is dated like the original, so the period rules apply to it as well
  perform app.reverse_journal('party_opening_balances', b.id, b.as_of, 'Reversal of opening balance: ' || trim(p_reason));
  update public.party_opening_balances set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason)
   where id = b.id;
  perform app.audit(b.company_id, 'party_opening_balances', b.id::text, 'REVERSE', jsonb_build_object('status', 'POSTED'),
                    jsonb_build_object('status', 'REVERSED', 'reason', trim(p_reason)));
  return jsonb_build_object('id', b.id, 'status', 'REVERSED');
end;
$$;

revoke all on function public.sales_order_set_override_reason(uuid, text), public.godown_users(uuid),
                       public.godown_assign_user(uuid, uuid, boolean), public.master_delete(uuid, text, uuid),
                       public.master_set_active(uuid, text, uuid[], boolean), public.opening_balance_post(uuid, jsonb),
                       public.opening_balance_reverse(uuid, text) from public, anon;
grant execute on function public.sales_order_set_override_reason(uuid, text), public.godown_users(uuid),
                          public.godown_assign_user(uuid, uuid, boolean), public.master_delete(uuid, text, uuid),
                          public.master_set_active(uuid, text, uuid[], boolean), public.opening_balance_post(uuid, jsonb),
                          public.opening_balance_reverse(uuid, text) to authenticated, service_role;
revoke all on function app.tg_items_rate_limit_guard(), app.tg_sale_rate_limit(), app.tg_godown_transaction_flags(),
                       app.tg_party_on_hold(), app.master_references(text, uuid) from public, anon, authenticated;
