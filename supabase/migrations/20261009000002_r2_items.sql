-- =============================================================================
-- PLATFORM R2 — Item / part master, custom fields, field-level security,
-- rate history, item images. Additive.
--
-- Field-level security (configurable per role / user in the Permission Matrix):
--   items.view_sale_rate      items.sale_price, SALE party rates, rate history
--   items.view_purchase_rate  items.purchase_price, PURCHASE party rates
--   items.view_cost           stock movement rate / value, stock valuation
--   items.edit_rate           writing any of these prices / rates
-- Enforced by the database: column privileges + masked view v_items, row
-- policies on rate tables, write triggers. Never by hiding UI fields only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Generic scope helpers (InitPlan form; dimensions GODOWN / CUSTOMER /
-- VENDOR / ITEM). Enforcement of CUSTOMER / VENDOR / ITEM: 20261009000003.
-- -----------------------------------------------------------------------------
create or replace function app.scope_unrestricted_company_ids(p_dimension text)
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c
  where app.user_scope_ids(auth.uid(), c, p_dimension) is null
$$;

create or replace function app.scope_allowed_ids(p_dimension text)
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct x), '{}')
  from unnest(app.user_company_ids()) c
  cross join lateral unnest(app.user_scope_ids(auth.uid(), c, p_dimension)) x
$$;
grant execute on function app.scope_unrestricted_company_ids(text), app.scope_allowed_ids(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Item master columns
-- -----------------------------------------------------------------------------
alter table public.items
  add column sku     text,
  add column notes   text,
  add column custom  jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
create unique index items_sku_uq on public.items (company_id, upper(sku)) where sku is not null;
create index items_custom_gin on public.items using gin (custom);

-- -----------------------------------------------------------------------------
-- Custom field engine (items, customers, vendors)
-- -----------------------------------------------------------------------------
create table public.custom_field_definitions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  entity       text not null check (entity in ('ITEM', 'CUSTOMER', 'VENDOR')),
  field_key    text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null,
  field_type   text not null check (field_type in ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'DROPDOWN')),
  options      text[] not null default '{}',
  is_required  boolean not null default false,
  is_active    boolean not null default true,
  sort_order   integer not null default 100,
  help_text    text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (company_id, entity, field_key),
  check (field_type <> 'DROPDOWN' or cardinality(options) > 0)
);
create trigger custom_field_definitions_audit_fields before insert or update on public.custom_field_definitions
  for each row execute function app.tg_set_audit_fields();

-- Validates and normalises custom values for the given entities.
-- Returns the cleaned object; raises with the field label on a bad value.
create or replace function app.validate_custom(p_company_id uuid, p_entities text[], p_values jsonb, p_check_required boolean)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare d public.custom_field_definitions; v jsonb; k text; v_out jsonb := '{}'; t text;
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
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if p_check_required and d.is_required and d.is_active then
        raise exception '% is required', d.label using errcode = 'P0001';
      end if;
      continue;
    end if;
    t := btrim(v #>> '{}');
    case d.field_type
      when 'NUMBER' then
        if t !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number', d.label using errcode = 'P0001'; end if;
        v_out := v_out || jsonb_build_object(d.field_key, t::numeric);
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
      else
        if length(t) > 500 then raise exception '% is too long (max 500)', d.label using errcode = 'P0001'; end if;
        v_out := v_out || jsonb_build_object(d.field_key, t);
    end case;
  end loop;
  return v_out;
end;
$$;

create or replace function app.tg_items_custom()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.custom is distinct from old.custom then
    new.custom := app.validate_custom(new.company_id, array['ITEM'], new.custom, true);
  end if;
  return new;
end;
$$;
create trigger items_custom before insert or update of custom on public.items
  for each row execute function app.tg_items_custom();

create or replace function public.custom_field_save(p_company_id uuid, p_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_id uuid; v_old jsonb;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings.edit');
  if p_id is null then
    insert into public.custom_field_definitions (company_id, entity, field_key, label, field_type, options, is_required,
                                                 is_active, sort_order, help_text)
    values (p_company_id, upper(p_payload->>'entity'), lower(trim(p_payload->>'field_key')), trim(p_payload->>'label'),
            upper(p_payload->>'field_type'),
            coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(p_payload->'options', '[]')) x where trim(x) <> ''), '{}'),
            coalesce((p_payload->>'is_required')::boolean, false), coalesce((p_payload->>'is_active')::boolean, true),
            coalesce((p_payload->>'sort_order')::int, 100), nullif(p_payload->>'help_text', ''))
    returning id into v_id;
    perform app.audit(p_company_id, 'custom_field_definitions', v_id::text, 'CREATE', null, p_payload);
  else
    select to_jsonb(d) into v_old from public.custom_field_definitions d where id = p_id and company_id = p_company_id;
    if v_old is null then
      raise exception 'Custom field not found' using errcode = 'P0001';
    end if;
    -- key, entity and type stay: stored values depend on them
    update public.custom_field_definitions
       set label = coalesce(nullif(trim(p_payload->>'label'), ''), label),
           options = coalesce(array(select trim(x) from jsonb_array_elements_text(p_payload->'options') x where trim(x) <> ''), options),
           is_required = coalesce((p_payload->>'is_required')::boolean, is_required),
           is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
           sort_order = coalesce((p_payload->>'sort_order')::int, sort_order),
           help_text = case when p_payload ? 'help_text' then nullif(p_payload->>'help_text', '') else help_text end
     where id = p_id
    returning id into v_id;
    perform app.audit(p_company_id, 'custom_field_definitions', v_id::text, 'UPDATE', v_old, p_payload);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Field-level security on the item prices
-- -----------------------------------------------------------------------------
-- Users read items through column privileges: everything except the two
-- prices. The prices are read through v_items, which masks them per
-- company with the field permissions (InitPlan, once per query).
revoke select on public.items from authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'items' and column_name not in ('sale_price', 'purchase_price');
  execute format('grant select (%s) on public.items to authenticated', v_cols);
end $$;

-- Masked item view. Owned by the migration role (not security_invoker): it
-- reads the price columns, so it applies the access rules itself — the same
-- as the items policies: member companies and the ITEM data scope.
create view public.v_items with (security_barrier) as
select i.id, i.company_id, i.code, i.name, i.description, i.item_kind, i.category_id, i.brand_id, i.base_unit_id,
       i.purchase_unit_id, i.sales_unit_id, i.hsn_code, i.gst_rate, i.barcode, i.sku, i.notes, i.custom,
       i.min_stock, i.max_stock, i.reorder_level, i.job_work_rate, i.is_stock_tracked, i.is_active, i.is_deleted,
       i.portal_visible, i.created_at, i.updated_at,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) then i.sale_price end as sale_price,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]) then i.purchase_price end as purchase_price,
       i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) as can_view_sale_rate,
       i.company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]) as can_view_purchase_rate,
       i.company_id = any ((select app.permitted_company_ids('items.edit_rate'))::uuid[]) as can_edit_rate
from public.items i
where i.company_id = any ((select app.user_company_ids())::uuid[])
  and (i.company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[])
       or i.id = any ((select app.scope_allowed_ids('ITEM'))::uuid[]));
revoke all on public.v_items from anon, public;
grant select on public.v_items to authenticated, service_role;

-- Inventory list: same columns as before, sale price masked.
drop view public.v_inventory_items;
create view public.v_inventory_items with (security_invoker = true) as
 WITH phys AS (
         SELECT stock_balances.company_id, stock_balances.item_id, sum(stock_balances.base_qty) AS physical,
            count(*) FILTER (WHERE stock_balances.base_qty <> 0::numeric) AS locations,
            count(DISTINCT stock_balances.godown_id) FILTER (WHERE stock_balances.base_qty <> 0::numeric) AS godowns
           FROM stock_balances
          GROUP BY stock_balances.company_id, stock_balances.item_id
        ), res AS (
         SELECT stock_reserved.company_id, stock_reserved.item_id, sum(stock_reserved.reserved_qty) AS reserved
           FROM stock_reserved
          GROUP BY stock_reserved.company_id, stock_reserved.item_id
        )
 SELECT i.company_id, i.id AS item_id, i.code AS item_code, i.name AS item_name, i.item_kind, i.category_id,
    c.name AS category_name, i.brand_id, i.is_active, u.code AS base_unit, dp.factor AS pack_factor, pu.code AS pack_unit,
    i.sale_price, i.min_stock, i.reorder_level, i.max_stock,
    COALESCE(phys.physical, 0::numeric) AS physical_qty,
    COALESCE(res.reserved, 0::numeric) AS reserved_qty,
    COALESCE(phys.physical, 0::numeric) - COALESCE(res.reserved, 0::numeric) AS available_qty,
    COALESCE(phys.locations, 0::bigint) AS location_count,
    COALESCE(phys.godowns, 0::bigint) AS godown_count,
        CASE
            WHEN (COALESCE(phys.physical, 0::numeric) - COALESCE(res.reserved, 0::numeric)) <= 0::numeric THEN 'OUT_OF_STOCK'::text
            WHEN (COALESCE(phys.physical, 0::numeric) - COALESCE(res.reserved, 0::numeric)) <= GREATEST(i.reorder_level, i.min_stock) THEN 'LOW_STOCK'::text
            ELSE 'IN_STOCK'::text
        END AS stock_status
   FROM public.v_items i
     JOIN units u ON u.id = i.base_unit_id
     LEFT JOIN item_categories c ON c.id = i.category_id
     LEFT JOIN phys ON phys.item_id = i.id AND phys.company_id = i.company_id
     LEFT JOIN res ON res.item_id = i.id AND res.company_id = i.company_id
     LEFT JOIN LATERAL app.default_packing(i.id, CURRENT_DATE) dp(unit_id, factor) ON true
     LEFT JOIN units pu ON pu.id = dp.unit_id
  WHERE NOT i.is_deleted AND i.is_stock_tracked;
revoke all on public.v_inventory_items from anon, public;
grant select on public.v_inventory_items to authenticated, service_role;
revoke insert, update, delete, truncate on public.v_items, public.v_inventory_items from authenticated;

-- Writing prices needs items.edit_rate (direct API writes and RPCs alike).
create or replace function app.tg_items_rate_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.sale_price is not null or new.purchase_price is not null))
     or (tg_op = 'UPDATE' and (new.sale_price is distinct from old.sale_price or new.purchase_price is distinct from old.purchase_price)) then
    if not app.has_permission(new.company_id, 'items.edit_rate') then
      raise exception 'Permission denied: items.edit_rate is required to change prices' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger items_rate_guard before insert or update on public.items
  for each row execute function app.tg_items_rate_guard();

-- Party / price-list rates: SALE rows need the sales-rate right, PURCHASE
-- rows the purchase-rate right; writing needs items.edit_rate.
create policy party_item_rates_field_read on public.party_item_rates as restrictive for select to authenticated
  using (rate_type not in ('SALE', 'PURCHASE')
         or (rate_type = 'SALE' and company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]))
         or (rate_type = 'PURCHASE' and company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[])));
create policy party_item_rates_field_insert on public.party_item_rates as restrictive for insert to authenticated
  with check (app.has_permission(company_id, 'items.edit_rate'));
create policy party_item_rates_field_update on public.party_item_rates as restrictive for update to authenticated
  using (app.has_permission(company_id, 'items.edit_rate')) with check (app.has_permission(company_id, 'items.edit_rate'));
create policy party_item_rates_field_delete on public.party_item_rates as restrictive for delete to authenticated
  using (app.has_permission(company_id, 'items.edit_rate'));

-- -----------------------------------------------------------------------------
-- Rate history (append-only, written by triggers)
-- -----------------------------------------------------------------------------
create table public.item_rate_history (
  id              bigserial primary key,
  company_id      uuid not null references public.companies (id) on delete cascade,
  item_id         uuid not null references public.items (id) on delete cascade,
  party_id        uuid references public.parties (id) on delete cascade,
  rate_type       text not null,
  source          text not null check (source in ('ITEM_MASTER', 'RATE_LIST')),
  action          text not null check (action in ('SET', 'CHANGE', 'REMOVE')),
  old_rate        numeric(14,4),
  new_rate        numeric(14,4),
  effective_from  date,
  changed_by      uuid,
  changed_at      timestamptz not null default now()
);
create index item_rate_history_item_idx on public.item_rate_history (company_id, item_id, changed_at desc);
create trigger item_rate_history_immutable before update on public.item_rate_history
  for each row execute function app.tg_block_mutation();

create or replace function app.tg_item_price_history()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.sale_price is distinct from (case when tg_op = 'UPDATE' then old.sale_price end) then
    insert into public.item_rate_history (company_id, item_id, rate_type, source, action, old_rate, new_rate, effective_from, changed_by)
    values (new.company_id, new.id, 'SALE', 'ITEM_MASTER',
            case when tg_op = 'INSERT' or old.sale_price is null then 'SET' when new.sale_price is null then 'REMOVE' else 'CHANGE' end,
            case when tg_op = 'UPDATE' then old.sale_price end, new.sale_price, current_date, auth.uid());
  end if;
  if new.purchase_price is distinct from (case when tg_op = 'UPDATE' then old.purchase_price end) then
    insert into public.item_rate_history (company_id, item_id, rate_type, source, action, old_rate, new_rate, effective_from, changed_by)
    values (new.company_id, new.id, 'PURCHASE', 'ITEM_MASTER',
            case when tg_op = 'INSERT' or old.purchase_price is null then 'SET' when new.purchase_price is null then 'REMOVE' else 'CHANGE' end,
            case when tg_op = 'UPDATE' then old.purchase_price end, new.purchase_price, current_date, auth.uid());
  end if;
  return new;
end;
$$;
create trigger items_price_history after insert or update of sale_price, purchase_price on public.items
  for each row execute function app.tg_item_price_history();

create or replace function app.tg_party_rate_history()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.party_item_rates := coalesce(new, old);
begin
  if tg_op = 'UPDATE' and new.rate is not distinct from old.rate and new.effective_from is not distinct from old.effective_from then
    return new;
  end if;
  insert into public.item_rate_history (company_id, item_id, party_id, rate_type, source, action, old_rate, new_rate,
                                        effective_from, changed_by)
  values (r.company_id, r.item_id, r.party_id, r.rate_type, 'RATE_LIST',
          case tg_op when 'INSERT' then 'SET' when 'DELETE' then 'REMOVE' else 'CHANGE' end,
          case when tg_op <> 'INSERT' then old.rate end, case when tg_op <> 'DELETE' then new.rate end,
          r.effective_from, auth.uid());
  return coalesce(new, old);
end;
$$;
create trigger party_item_rates_history after insert or update or delete on public.party_item_rates
  for each row execute function app.tg_party_rate_history();

-- history is read with the same field rights as the rates themselves
alter table public.item_rate_history enable row level security;
create policy item_rate_history_read on public.item_rate_history for select to authenticated
  using (company_id = any ((select app.permitted_company_ids('items.view'))::uuid[])
         and (rate_type not in ('SALE', 'PURCHASE')
              or (rate_type = 'SALE' and company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]))
              or (rate_type = 'PURCHASE' and company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]))));

-- -----------------------------------------------------------------------------
-- Cost: stock movement rate / value only with items.view_cost
-- -----------------------------------------------------------------------------
revoke select on public.stock_movements from authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'stock_movements' and column_name not in ('rate', 'value');
  execute format('grant select (%s) on public.stock_movements to authenticated', v_cols);
end $$;

-- Valuation report: reads the rates, so it applies the access rules itself
-- (membership, items.view_cost, godown and item scope).
create or replace function public.stock_valuation(p_company_id uuid, p_as_on date)
returns table (item_id uuid, item_code text, item_name text, base_qty numeric, avg_rate numeric, value numeric)
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'items.view_cost');
  return query
  with q as (
    select m.item_id,
           sum(m.signed_base_qty) as qty,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0
                    then m.base_qty * m.rate end) as in_value,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0
                    then m.base_qty end) as in_qty
    from public.stock_movements m
    where m.company_id = p_company_id and m.movement_date <= p_as_on
      and app.scope_allows(p_company_id, 'GODOWN', m.godown_id)
    group by m.item_id)
  select i.id, i.code, i.name, q.qty,
         round(coalesce(q.in_value / nullif(q.in_qty, 0), 0), 4),
         round(greatest(q.qty, 0) * coalesce(q.in_value / nullif(q.in_qty, 0), 0), 2)
  from q join public.items i on i.id = q.item_id
  where q.qty <> 0 and app.scope_allows(p_company_id, 'ITEM', i.id)
  order by i.name;
end;
$$;

-- Financial statements need the closing stock value as a total (governed
-- by the report permission as before); the item-level rates stay masked.
create or replace function app.stock_value_rows(p_company_id uuid, p_as_on date)
returns table (item_id uuid, value numeric)
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  with q as (
    select m.item_id, sum(m.signed_base_qty) as qty,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0 then m.base_qty * m.rate end) as in_value,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0 then m.base_qty end) as in_qty
    from public.stock_movements m
    where m.company_id = p_company_id and m.movement_date <= p_as_on and app.is_member(p_company_id)
    group by m.item_id)
  select q.item_id, round(greatest(q.qty, 0) * coalesce(q.in_value / nullif(q.in_qty, 0), 0), 2)
  from q where q.qty <> 0
$$;
grant execute on function app.stock_value_rows(uuid, date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profit_loss(p_company_id uuid, p_from date, p_to date)
 RETURNS TABLE(section text, account_code text, account_name text, amount numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_open numeric; v_close numeric; v_income numeric; v_expense numeric;
begin
  select coalesce(sum(value), 0) into v_open from app.stock_value_rows(p_company_id, p_from - 1);
  select coalesce(sum(value), 0) into v_close from app.stock_value_rows(p_company_id, p_to);

  return query
    select case a.account_type when 'INCOME' then 'INCOME' else 'EXPENSE' end,
           a.code, a.name,
           case a.account_type when 'INCOME' then sum(l.credit - l.debit) else sum(l.debit - l.credit) end
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.entry_date between p_from and p_to
      and a.account_type in ('INCOME', 'EXPENSE')
    group by a.account_type, a.code, a.name
    having sum(l.debit - l.credit) <> 0
    order by 1 desc, 2;

  select coalesce(sum(l.credit - l.debit), 0) into v_income
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type = 'INCOME';
  select coalesce(sum(l.debit - l.credit), 0) into v_expense
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type = 'EXPENSE';

  section := 'STOCK'; account_code := null; account_name := 'Opening stock'; amount := v_open; return next;
  section := 'STOCK'; account_name := 'Closing stock'; amount := v_close; return next;
  section := 'RESULT'; account_name := 'Net profit (loss)';
  amount := v_income + v_close - v_expense - v_open; return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.balance_sheet(p_company_id uuid, p_as_on date)
 RETURNS TABLE(section text, account_code text, account_name text, amount numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_pl numeric; v_stock numeric;
begin
  return query
    select a.account_type::text, a.code, a.name,
           case when a.account_type = 'ASSET' then sum(l.debit - l.credit) else sum(l.credit - l.debit) end
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.entry_date <= p_as_on
      and a.account_type in ('ASSET', 'LIABILITY', 'EQUITY')
    group by a.account_type, a.code, a.name
    having sum(l.debit - l.credit) <> 0
    order by 1, 2;

  select coalesce(sum(value), 0) into v_stock from app.stock_value_rows(p_company_id, p_as_on);
  select coalesce(sum(l.credit - l.debit), 0)
    into v_pl
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date <= p_as_on and a.account_type in ('INCOME', 'EXPENSE');

  section := 'ASSET'; account_code := null; account_name := 'Closing stock (valued)'; amount := v_stock; return next;
  section := 'EQUITY'; account_name := 'Profit & loss (incl. closing stock)'; amount := v_pl + v_stock; return next;
end;
$function$;

-- -----------------------------------------------------------------------------
-- Item images: private bucket "item-images", path <company>/<item>/<file>
-- -----------------------------------------------------------------------------
create table public.item_images (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  item_id       uuid not null references public.items (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  content_type  text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  is_primary    boolean not null default false,
  sort_order    integer not null default 100,
  caption       text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  check (storage_path like company_id::text || '/' || item_id::text || '/%')
);
create index item_images_item_idx on public.item_images (item_id, sort_order);
create unique index item_images_primary_uq on public.item_images (item_id) where is_primary;

create or replace function app.item_for_image(p_item_id uuid, p_permission text)
returns public.items
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare i public.items;
begin
  select * into i from public.items where id = p_item_id;
  if i.id is null or not app.is_member(i.company_id) or not app.scope_allows(i.company_id, 'ITEM', i.id) then
    raise exception 'Item not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(i.company_id, p_permission);
  return i;
end;
$$;

-- Register an uploaded image (the file is uploaded first with the storage API).
create or replace function public.item_image_register(p_item_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare i public.items := app.item_for_image(p_item_id, 'items.upload_image'); v_id uuid; v_primary boolean;
begin
  if coalesce(p_payload->>'storage_path', '') not like i.company_id || '/' || i.id || '/%' then
    raise exception 'Image path does not belong to this item' using errcode = '42501';
  end if;
  v_primary := coalesce((p_payload->>'is_primary')::boolean, false)
               or not exists (select 1 from public.item_images where item_id = i.id);
  if v_primary then
    update public.item_images set is_primary = false where item_id = i.id and is_primary;
  end if;
  insert into public.item_images (company_id, item_id, storage_path, file_name, content_type, size_bytes, is_primary,
                                  sort_order, caption, created_by)
  values (i.company_id, i.id, p_payload->>'storage_path', coalesce(p_payload->>'file_name', 'image'),
          p_payload->>'content_type', (p_payload->>'size_bytes')::int, v_primary,
          coalesce((p_payload->>'sort_order')::int, 100), nullif(p_payload->>'caption', ''), auth.uid())
  returning id into v_id;
  perform app.audit(i.company_id, 'items', i.id::text, 'IMAGE_ADD', null,
                    jsonb_build_object('image_id', v_id, 'file_name', p_payload->>'file_name'));
  return v_id;
end;
$$;

-- Remove (returns the storage path; the client deletes the file, allowed by
-- the same permission in the storage policy). Replace = add new + remove old.
create or replace function public.item_image_delete(p_image_id uuid)
returns text
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare m public.item_images; i public.items; v_next uuid;
begin
  select * into m from public.item_images where id = p_image_id;
  if m.id is null then
    raise exception 'Image not found' using errcode = 'P0001';
  end if;
  i := app.item_for_image(m.item_id, 'items.upload_image');
  delete from public.item_images where id = m.id;
  if m.is_primary then
    select id into v_next from public.item_images where item_id = m.item_id order by sort_order, created_at limit 1;
    update public.item_images set is_primary = true where id = v_next;
  end if;
  perform app.audit(i.company_id, 'items', i.id::text, 'IMAGE_REMOVE', jsonb_build_object('image_id', m.id, 'file_name', m.file_name), null);
  return m.storage_path;
end;
$$;

create or replace function public.item_image_set_primary(p_image_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare m public.item_images;
begin
  select * into m from public.item_images where id = p_image_id;
  if m.id is null then
    raise exception 'Image not found' using errcode = 'P0001';
  end if;
  perform app.item_for_image(m.item_id, 'items.upload_image');
  update public.item_images set is_primary = false where item_id = m.item_id and is_primary;
  update public.item_images set is_primary = true where id = m.id;
end;
$$;

-- storage checks: <company>/<item>/<file>
create or replace function app.item_image_can_read(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (select 1 from public.items i
                 where i.id = app.try_uuid(split_part(p_name, '/', 2))
                   and i.company_id = app.try_uuid(split_part(p_name, '/', 1))
                   and app.has_permission(i.company_id, 'items.view')
                   and app.scope_allows(i.company_id, 'ITEM', i.id))
$$;
create or replace function app.item_image_can_write(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (select 1 from public.items i
                 where i.id = app.try_uuid(split_part(p_name, '/', 2))
                   and i.company_id = app.try_uuid(split_part(p_name, '/', 1))
                   and app.has_permission(i.company_id, 'items.upload_image')
                   and app.scope_allows(i.company_id, 'ITEM', i.id))
$$;
grant execute on function app.item_image_can_read(text), app.item_image_can_write(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('item-images', 'item-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    on conflict (id) do nothing;
    execute $p$create policy item_images_read on storage.objects for select to authenticated
              using (bucket_id = 'item-images' and app.item_image_can_read(name))$p$;
    execute $p$create policy item_images_insert on storage.objects for insert to authenticated
              with check (bucket_id = 'item-images' and app.item_image_can_write(name))$p$;
    execute $p$create policy item_images_delete on storage.objects for delete to authenticated
              using (bucket_id = 'item-images' and app.item_image_can_write(name))$p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.custom_field_definitions enable row level security;
alter table public.item_images enable row level security;
create policy custom_field_definitions_read on public.custom_field_definitions for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
create policy item_images_read on public.item_images for select to authenticated
  using (company_id = any ((select app.permitted_company_ids('items.view'))::uuid[]));

revoke all on public.custom_field_definitions, public.item_images, public.item_rate_history from anon;
grant select on public.custom_field_definitions, public.item_images, public.item_rate_history to authenticated;
revoke insert, update, delete, truncate on public.custom_field_definitions, public.item_images, public.item_rate_history
  from authenticated;
grant all on public.custom_field_definitions, public.item_images, public.item_rate_history to service_role;
grant usage, select on sequence public.item_rate_history_id_seq to service_role;

revoke all on function public.custom_field_save(uuid, uuid, jsonb), public.item_image_register(uuid, jsonb),
                       public.item_image_delete(uuid), public.item_image_set_primary(uuid), public.stock_valuation(uuid, date)
  from public, anon;
grant execute on function public.custom_field_save(uuid, uuid, jsonb), public.item_image_register(uuid, jsonb),
                          public.item_image_delete(uuid), public.item_image_set_primary(uuid), public.stock_valuation(uuid, date)
  to authenticated, service_role;
revoke all on function app.tg_items_custom(), app.tg_items_rate_guard(), app.tg_item_price_history(),
                       app.tg_party_rate_history() from public, anon, authenticated;
