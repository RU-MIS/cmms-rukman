-- =============================================================================
-- INVENTORY MVP — storage locations, item master, company settings,
-- location-aware stock engine, negative stock OFF by default.
-- MASTER_BUILD_PROMPT.md §2–8, §15, §33–34, §37.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Company settings (Owner/Admin control centre, §33). One row per company.
-- Typed columns instead of key/value so the UI and the rules cannot drift.
-- -----------------------------------------------------------------------------
create table public.company_settings (
  company_id                    uuid primary key references public.companies (id) on delete cascade,
  -- inventory
  allow_negative_stock          boolean not null default false,
  -- portals
  customer_portal_enabled       boolean not null default false,
  vendor_portal_enabled         boolean not null default false,
  customer_stock_visibility     public.stock_visibility not null default 'HIDDEN',
  vendor_stock_visibility       public.stock_visibility not null default 'HIDDEN',
  customer_rate_visible         boolean not null default false,
  vendor_rate_visible           boolean not null default false,
  customer_quote_price_enabled  boolean not null default true,
  customer_outstanding_visible  boolean not null default true,
  vendor_payment_visible        boolean not null default true,
  -- email (§27)
  email_automation              boolean not null default false,
  vendor_po_email               boolean not null default true,
  vendor_document_email         boolean not null default true,
  customer_invoice_email        boolean not null default true,
  customer_document_email       boolean not null default false,
  payment_reminder_email        boolean not null default true,
  vendor_payment_reminder_email boolean not null default true,
  email_max_attempts            smallint not null default 5 check (email_max_attempts between 1 and 20),
  -- payment reminders (§29–32)
  customer_reminder_enabled     boolean not null default false,
  customer_reminder_start_days  integer not null default 15 check (customer_reminder_start_days between 0 and 365),
  customer_reminder_frequency   public.reminder_frequency not null default 'DAILY',
  vendor_reminder_enabled       boolean not null default false,
  vendor_reminder_start_days    integer not null default 15 check (vendor_reminder_start_days between 0 and 365),
  vendor_reminder_frequency     public.reminder_frequency not null default 'DAILY',
  vendor_reminder_roles         text[] not null default array['OWNER', 'ADMIN', 'ACCOUNTANT'],
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid
);

create or replace function app.tg_company_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger company_settings_touch before update on public.company_settings
  for each row execute function app.tg_company_settings_touch();

create or replace function app.tg_audit_settings()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  perform app.audit(new.company_id, tg_table_name, new.company_id::text, 'UPDATE',
                    to_jsonb(old), to_jsonb(new));
  return null;
end $$;
create trigger company_settings_audit after update on public.company_settings
  for each row execute function app.tg_audit_settings();

-- Settings row of a company (created with defaults when missing).
create or replace function app.settings(p_company_id uuid)
returns public.company_settings
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare s public.company_settings;
begin
  select * into s from public.company_settings where company_id = p_company_id;
  if s.company_id is null then
    insert into public.company_settings (company_id) values (p_company_id)
    on conflict (company_id) do nothing;
    select * into s from public.company_settings where company_id = p_company_id;
  end if;
  return s;
end;
$$;

insert into public.company_settings (company_id) select id from public.companies on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Individual customer / vendor overrides (§15). NULL = use company setting.
-- Priority: individual override → company setting → system default.
-- -----------------------------------------------------------------------------
create table public.party_settings (
  party_id                  uuid primary key references public.parties (id) on delete cascade,
  stock_visibility          public.stock_visibility,
  rate_visible              boolean,
  quote_price_enabled       boolean,
  email_enabled             boolean,
  payment_reminder_enabled  boolean,
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);
create trigger party_settings_touch before update on public.party_settings
  for each row execute function app.tg_company_settings_touch();

-- Effective portal settings for a party in its role.
create or replace function app.effective_party_settings(p_party_id uuid, p_kind public.portal_kind,
  out stock_visibility public.stock_visibility, out rate_visible boolean,
  out quote_price_enabled boolean, out email_enabled boolean, out payment_reminder_enabled boolean)
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare p public.parties; o public.party_settings; s public.company_settings;
begin
  select * into p from public.parties where id = p_party_id;
  s := app.settings(p.company_id);
  select * into o from public.party_settings where party_id = p_party_id;
  if p_kind = 'CUSTOMER' then
    stock_visibility := coalesce(o.stock_visibility, s.customer_stock_visibility);
    rate_visible := coalesce(o.rate_visible, s.customer_rate_visible);
    quote_price_enabled := coalesce(o.quote_price_enabled, s.customer_quote_price_enabled);
    payment_reminder_enabled := coalesce(o.payment_reminder_enabled, s.customer_reminder_enabled);
  else
    stock_visibility := coalesce(o.stock_visibility, s.vendor_stock_visibility);
    rate_visible := coalesce(o.rate_visible, s.vendor_rate_visible);
    quote_price_enabled := false;
    payment_reminder_enabled := coalesce(o.payment_reminder_enabled, s.vendor_reminder_enabled);
  end if;
  email_enabled := coalesce(o.email_enabled, true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Item master (§7) — additional fields
-- -----------------------------------------------------------------------------
alter table public.items
  add column description      text,
  add column barcode           text,
  add column purchase_unit_id  uuid references public.units (id),
  add column sales_unit_id     uuid references public.units (id),
  add column purchase_price    numeric(14,4) check (purchase_price >= 0),
  add column sale_price        numeric(14,4) check (sale_price >= 0),
  add column max_stock         numeric(16,3) not null default 0 check (max_stock >= 0),
  add column reorder_level     numeric(16,3) not null default 0 check (reorder_level >= 0),
  add column portal_visible    boolean not null default true;
create unique index items_barcode_uq on public.items (company_id, barcode) where barcode is not null;

-- Purchase / sales unit must be the base unit or a packing defined for the item.
create or replace function app.tg_item_units_check()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.purchase_unit_id is not null and new.purchase_unit_id <> new.base_unit_id
       and not exists (select 1 from public.item_packings where item_id = new.id and unit_id = new.purchase_unit_id) then
      raise exception 'Purchase unit needs a packing conversion for this item' using errcode = 'P0001';
    end if;
    if new.sales_unit_id is not null and new.sales_unit_id <> new.base_unit_id
       and not exists (select 1 from public.item_packings where item_id = new.id and unit_id = new.sales_unit_id) then
      raise exception 'Sales unit needs a packing conversion for this item' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger items_units_check before update on public.items
  for each row execute function app.tg_item_units_check();

-- -----------------------------------------------------------------------------
-- Godowns: portal visibility + storage locations (§3–4)
-- Godown → Zone → Rack → Shelf/Level → Bin. Display code: RACK-SHELF-BIN.
-- Every godown has one DEFAULT location ("unassigned") used when no rack/bin
-- is chosen, so stock always has a location.
-- -----------------------------------------------------------------------------
alter table public.godowns add column portal_visible boolean not null default true;

create table public.storage_locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  godown_id   uuid not null references public.godowns (id) on delete cascade,
  zone        text,
  rack        text,
  shelf       text,
  bin         text,
  code        text not null,                     -- e.g. B1-C-123 (generated)
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  remarks     text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  check (is_default or (rack is not null and trim(rack) <> ''))
);
create unique index storage_locations_code_uq on public.storage_locations (godown_id, upper(code));
create unique index storage_locations_default_uq on public.storage_locations (godown_id) where is_default;
create index storage_locations_company_idx on public.storage_locations (company_id, godown_id);
create trigger storage_locations_audit_fields before insert or update on public.storage_locations
  for each row execute function app.tg_set_audit_fields();
create trigger storage_locations_audit_log after insert or update or delete on public.storage_locations
  for each row execute function app.tg_audit_row();

create or replace function app.tg_storage_location_code()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (select company_id from public.godowns where id = new.godown_id) is distinct from new.company_id then
    raise exception 'Location godown belongs to another company' using errcode = 'P0001';
  end if;
  if new.is_default then
    new.code := 'UNASSIGNED';
  else
    new.zone := nullif(upper(trim(new.zone)), '');
    new.rack := upper(trim(new.rack));
    new.shelf := nullif(upper(trim(new.shelf)), '');
    new.bin := nullif(upper(trim(new.bin)), '');
    new.code := concat_ws('-', new.rack, new.shelf, new.bin);
  end if;
  if tg_op = 'UPDATE' and old.is_default and (not new.is_default or not new.is_active) then
    raise exception 'The default location of a godown cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger storage_locations_code before insert or update on public.storage_locations
  for each row execute function app.tg_storage_location_code();

create or replace function app.tg_godown_default_location()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.storage_locations (company_id, godown_id, is_default, code)
  values (new.company_id, new.id, true, 'UNASSIGNED')
  on conflict do nothing;
  return new;
end;
$$;
create trigger godowns_default_location after insert on public.godowns
  for each row execute function app.tg_godown_default_location();

insert into public.storage_locations (company_id, godown_id, is_default, code)
select company_id, id, true, 'UNASSIGNED' from public.godowns
on conflict do nothing;

create or replace function app.default_location(p_godown_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select id from public.storage_locations where godown_id = p_godown_id and is_default $$;

-- Human label: "Delhi / B1-C-123"
create or replace function app.location_label(p_location_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select g.name || ' / ' || l.code
  from public.storage_locations l join public.godowns g on g.id = l.godown_id
  where l.id = p_location_id
$$;

-- -----------------------------------------------------------------------------
-- Stock movements get a location; balances are kept per item + godown + location.
-- -----------------------------------------------------------------------------
alter table public.stock_movements add column location_id uuid references public.storage_locations (id);
alter table public.stock_movements disable trigger stock_movements_immutable;
update public.stock_movements m set location_id = app.default_location(m.godown_id) where location_id is null;
alter table public.stock_movements enable trigger stock_movements_immutable;
alter table public.stock_movements alter column location_id set not null;
create index stock_movements_location_idx on public.stock_movements (company_id, item_id, location_id);

drop trigger stock_movements_balance on public.stock_movements;
drop table public.stock_balances;
create table public.stock_balances (
  company_id   uuid not null,
  item_id      uuid not null references public.items (id),
  godown_id    uuid not null references public.godowns (id),
  location_id  uuid not null references public.storage_locations (id),
  base_qty     numeric(16,3) not null default 0,
  primary key (company_id, item_id, godown_id, location_id)
);
create index stock_balances_godown_idx on public.stock_balances (company_id, item_id, godown_id);
insert into public.stock_balances (company_id, item_id, godown_id, location_id, base_qty)
select company_id, item_id, godown_id, location_id, sum(signed_base_qty)
from public.stock_movements group by 1, 2, 3, 4;

create or replace function app.tg_stock_balance()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stock_balances as b (company_id, item_id, godown_id, location_id, base_qty)
  values (new.company_id, new.item_id, new.godown_id, new.location_id, new.signed_base_qty)
  on conflict (company_id, item_id, godown_id, location_id)
    do update set base_qty = b.base_qty + excluded.base_qty;
  return new;
end;
$$;
create trigger stock_movements_balance after insert on public.stock_movements
  for each row execute function app.tg_stock_balance();

-- Reserved quantity per item + godown (filled by the reservation engine).
create table public.stock_reserved (
  company_id    uuid not null,
  item_id       uuid not null references public.items (id),
  godown_id     uuid not null references public.godowns (id),
  reserved_qty  numeric(16,3) not null default 0 check (reserved_qty >= 0),
  primary key (company_id, item_id, godown_id)
);

create or replace function app.reserved_qty(p_company_id uuid, p_item_id uuid, p_godown_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select reserved_qty from public.stock_reserved
                   where company_id = p_company_id and item_id = p_item_id and godown_id = p_godown_id), 0)
$$;

create or replace function app.physical_qty(p_company_id uuid, p_item_id uuid, p_godown_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(base_qty), 0) from public.stock_balances
  where company_id = p_company_id and item_id = p_item_id and godown_id = p_godown_id
$$;

create or replace function app.negative_allowed(p_company_id uuid, p_godown_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select (app.settings(p_company_id)).allow_negative_stock
      or coalesce((select allow_negative from public.godowns where id = p_godown_id), false)
$$;

-- -----------------------------------------------------------------------------
-- app.post_stock — the ONLY way stock changes (§6, §37).
--   IN : into p_location_id (default location when null).
--   OUT: from p_location_id, or — when null — from the godown's locations that
--        hold stock (named locations first), split over several movements.
-- With negative stock OFF (default) an OUT is rejected when it would make the
-- location balance negative or the godown AVAILABLE stock
-- (physical − reserved) negative. Callers that consume their own reservation
-- release it first. Returns a warning text only when negative stock is allowed.
-- -----------------------------------------------------------------------------
drop function app.post_stock(uuid, uuid, uuid, date, public.movement_type, smallint, numeric, uuid, numeric,
                             numeric, uuid, text, uuid, uuid, text);

create or replace function app.insert_movement(
  p_company_id uuid, p_item_id uuid, p_godown_id uuid, p_location_id uuid, p_date date,
  p_type public.movement_type, p_direction smallint, p_qty numeric, p_unit_id uuid, p_factor numeric,
  p_base numeric, p_rate numeric, p_party_id uuid,
  p_source_table text, p_source_id uuid, p_source_line_id uuid, p_doc_no text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.stock_movements (company_id, item_id, godown_id, location_id, movement_date, movement_type,
    direction, qty, unit_id, factor_to_base, base_qty, rate, value, party_id,
    source_table, source_id, source_line_id, doc_no, created_by)
  values (p_company_id, p_item_id, p_godown_id, p_location_id, p_date, p_type,
    p_direction, p_qty, p_unit_id, p_factor, p_base, p_rate,
    case when p_rate is null then null else round(p_base * p_rate, 2) end, p_party_id,
    p_source_table, p_source_id, p_source_line_id, p_doc_no, auth.uid())
$$;

create or replace function app.post_stock(
  p_company_id uuid, p_item_id uuid, p_godown_id uuid, p_date date,
  p_type public.movement_type, p_direction smallint,
  p_qty numeric, p_unit_id uuid, p_factor numeric,
  p_rate numeric, p_party_id uuid,
  p_source_table text, p_source_id uuid, p_source_line_id uuid, p_doc_no text,
  p_location_id uuid default null)
returns text
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tracked   boolean;
  v_item      text;
  v_godown    public.godowns;
  v_base      numeric(16,3) := round(p_qty * p_factor, 3);
  v_loc       public.storage_locations;
  v_allow     boolean;
  v_left      numeric;
  v_take      numeric;
  v_bal       record;
  v_physical  numeric;
  v_reserved  numeric;
begin
  select is_stock_tracked, name into v_tracked, v_item from public.items
   where id = p_item_id and company_id = p_company_id;
  if v_item is null then
    raise exception 'Item does not belong to this company' using errcode = 'P0001';
  end if;
  if not v_tracked then
    return null;
  end if;
  select * into v_godown from public.godowns where id = p_godown_id and company_id = p_company_id;
  if v_godown.id is null then
    raise exception 'Godown does not belong to this company' using errcode = 'P0001';
  end if;
  if not v_godown.is_active then
    raise exception 'Godown % is inactive', v_godown.code using errcode = 'P0001';
  end if;
  if p_qty <= 0 or v_base <= 0 then
    raise exception 'Quantity must be greater than zero (%)', v_item using errcode = 'P0001';
  end if;
  if p_location_id is not null then
    select * into v_loc from public.storage_locations where id = p_location_id;
    if v_loc.id is null or v_loc.godown_id <> p_godown_id then
      raise exception 'Location does not belong to godown %', v_godown.code using errcode = 'P0001';
    end if;
    if not v_loc.is_active then
      raise exception 'Location % is inactive', v_loc.code using errcode = 'P0001';
    end if;
  end if;

  -- Serialise concurrent postings on the same item + godown (all locations).
  insert into public.stock_reserved (company_id, item_id, godown_id, reserved_qty)
  values (p_company_id, p_item_id, p_godown_id, 0) on conflict do nothing;
  select reserved_qty into v_reserved from public.stock_reserved
   where company_id = p_company_id and item_id = p_item_id and godown_id = p_godown_id
   for no key update;

  if p_direction = 1 then
    perform app.insert_movement(p_company_id, p_item_id, p_godown_id,
      coalesce(p_location_id, app.default_location(p_godown_id)), p_date, p_type, 1::smallint,
      p_qty, p_unit_id, p_factor, v_base, p_rate, p_party_id,
      p_source_table, p_source_id, p_source_line_id, p_doc_no);
    return null;
  end if;

  v_allow := app.negative_allowed(p_company_id, p_godown_id);
  v_physical := app.physical_qty(p_company_id, p_item_id, p_godown_id);

  if not v_allow and v_physical - v_base < v_reserved then
    raise exception 'Insufficient stock of % in %: available % (physical % − reserved %), required %',
      v_item, v_godown.name, app.fmt_qty(p_item_id, greatest(v_physical - v_reserved, 0), p_date),
      trim_scale(v_physical), trim_scale(v_reserved), app.fmt_qty(p_item_id, v_base, p_date)
      using errcode = 'P0001';
  end if;

  if p_location_id is not null then
    if not v_allow and coalesce((select base_qty from public.stock_balances
                                 where company_id = p_company_id and item_id = p_item_id
                                   and godown_id = p_godown_id and location_id = p_location_id), 0) < v_base then
      raise exception 'Insufficient stock of % at location %', v_item, app.location_label(p_location_id)
        using errcode = 'P0001';
    end if;
    perform app.insert_movement(p_company_id, p_item_id, p_godown_id, p_location_id, p_date, p_type,
      -1::smallint, p_qty, p_unit_id, p_factor, v_base, p_rate, p_party_id,
      p_source_table, p_source_id, p_source_line_id, p_doc_no);
  else
    -- Pick from locations holding stock (named locations first, then by code).
    v_left := v_base;
    for v_bal in
      select b.location_id, b.base_qty
      from public.stock_balances b join public.storage_locations l on l.id = b.location_id
      where b.company_id = p_company_id and b.item_id = p_item_id and b.godown_id = p_godown_id
        and b.base_qty > 0
      order by l.is_default, l.code
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_bal.base_qty);
      perform app.insert_movement(p_company_id, p_item_id, p_godown_id, v_bal.location_id, p_date, p_type,
        -1::smallint, round(v_take / p_factor, 3), p_unit_id, p_factor, v_take, p_rate, p_party_id,
        p_source_table, p_source_id, p_source_line_id, p_doc_no);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      if not v_allow then
        raise exception 'Insufficient stock of % in %', v_item, v_godown.name using errcode = 'P0001';
      end if;
      perform app.insert_movement(p_company_id, p_item_id, p_godown_id, app.default_location(p_godown_id),
        p_date, p_type, -1::smallint, round(v_left / p_factor, 3), p_unit_id, p_factor, v_left, p_rate,
        p_party_id, p_source_table, p_source_id, p_source_line_id, p_doc_no);
    end if;
  end if;

  if v_physical - v_base < v_reserved then
    return format('Stock of %s in %s becomes %s (negative stock allowed)', v_item, v_godown.name,
                  trim_scale(v_physical - v_base - v_reserved));
  end if;
  return null;
end;
$$;

-- Reversal keeps the original location.
create or replace function app.reverse_stock(p_source_table text, p_source_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare m public.stock_movements; v_allow boolean;
begin
  for m in select * from public.stock_movements
           where source_table = p_source_table and source_id = p_source_id and reversal_of is null
             and not exists (select 1 from public.stock_movements r where r.reversal_of = stock_movements.id)
           order by id
  loop
    -- reversing an IN takes stock out again: respect the negative-stock rule
    if m.direction = 1 then
      v_allow := app.negative_allowed(m.company_id, m.godown_id);
      if not v_allow and (
           coalesce((select base_qty from public.stock_balances where company_id = m.company_id
                     and item_id = m.item_id and godown_id = m.godown_id and location_id = m.location_id), 0) < m.base_qty
           or app.physical_qty(m.company_id, m.item_id, m.godown_id) - m.base_qty
              < app.reserved_qty(m.company_id, m.item_id, m.godown_id)) then
        raise exception 'Cannot cancel: the received stock has already been used (%)',
          app.location_label(m.location_id) using errcode = 'P0001';
      end if;
    end if;
    insert into public.stock_movements (company_id, item_id, godown_id, location_id, movement_date, movement_type,
      direction, qty, unit_id, factor_to_base, base_qty, rate, value, party_id,
      source_table, source_id, source_line_id, doc_no, reversal_of, created_by)
    values (m.company_id, m.item_id, m.godown_id, m.location_id, p_date, m.movement_type,
      -m.direction, m.qty, m.unit_id, m.factor_to_base, m.base_qty, m.rate, m.value, m.party_id,
      m.source_table, m.source_id, m.source_line_id, m.doc_no, m.id, auth.uid());
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stock views (§2–5, §38–39)
-- -----------------------------------------------------------------------------
drop view public.v_stock_balance;
create view public.v_stock_balance
with (security_invoker = true) as
select b.company_id, b.item_id, i.code as item_code, i.name as item_name, i.item_kind,
       b.godown_id, g.code as godown_code, g.name as godown_name,
       sum(b.base_qty) as base_qty,
       app.reserved_qty(b.company_id, b.item_id, b.godown_id) as reserved_qty,
       sum(b.base_qty) - app.reserved_qty(b.company_id, b.item_id, b.godown_id) as available_qty,
       u.code as base_unit,
       dp.factor as pack_factor,
       case when dp.factor is not null then round(sum(b.base_qty) / dp.factor, 3) end as pack_qty
from public.stock_balances b
join public.items i on i.id = b.item_id
join public.godowns g on g.id = b.godown_id
join public.units u on u.id = i.base_unit_id
left join lateral app.default_packing(i.id, current_date) dp on true
group by b.company_id, b.item_id, i.code, i.name, i.item_kind, b.godown_id, g.code, g.name, u.code, dp.factor;

create or replace view public.v_stock_by_location
with (security_invoker = true) as
select b.company_id, b.item_id, i.code as item_code, i.name as item_name,
       b.godown_id, g.code as godown_code, g.name as godown_name,
       b.location_id, l.code as location_code, l.zone, l.rack, l.shelf, l.bin, l.is_default,
       b.base_qty
from public.stock_balances b
join public.items i on i.id = b.item_id
join public.godowns g on g.id = b.godown_id
join public.storage_locations l on l.id = b.location_id
where b.base_qty <> 0;

-- Consolidated inventory: one row per item (§3, §38).
create or replace view public.v_inventory_items
with (security_invoker = true) as
with phys as (
  select company_id, item_id, sum(base_qty) as physical,
         count(*) filter (where base_qty <> 0) as locations,
         count(distinct godown_id) filter (where base_qty <> 0) as godowns
  from public.stock_balances group by company_id, item_id),
res as (
  select company_id, item_id, sum(reserved_qty) as reserved
  from public.stock_reserved group by company_id, item_id)
select i.company_id, i.id as item_id, i.code as item_code, i.name as item_name, i.item_kind,
       i.category_id, c.name as category_name, i.brand_id, i.is_active,
       u.code as base_unit, dp.factor as pack_factor, pu.code as pack_unit,
       i.sale_price, i.min_stock, i.reorder_level, i.max_stock,
       coalesce(phys.physical, 0) as physical_qty,
       coalesce(res.reserved, 0) as reserved_qty,
       coalesce(phys.physical, 0) - coalesce(res.reserved, 0) as available_qty,
       coalesce(phys.locations, 0) as location_count,
       coalesce(phys.godowns, 0) as godown_count,
       case when coalesce(phys.physical, 0) - coalesce(res.reserved, 0) <= 0 then 'OUT_OF_STOCK'
            when coalesce(phys.physical, 0) - coalesce(res.reserved, 0) <= greatest(i.reorder_level, i.min_stock) then 'LOW_STOCK'
            else 'IN_STOCK' end as stock_status
from public.items i
join public.units u on u.id = i.base_unit_id
left join public.item_categories c on c.id = i.category_id
left join phys on phys.item_id = i.id and phys.company_id = i.company_id
left join res on res.item_id = i.id and res.company_id = i.company_id
left join lateral app.default_packing(i.id, current_date) dp on true
left join public.units pu on pu.id = dp.unit_id
where not i.is_deleted and i.is_stock_tracked;

-- Stock ledger: now with location.
drop function public.stock_ledger(uuid, uuid, uuid, date, date);
create or replace function public.stock_ledger(p_company_id uuid, p_item_id uuid,
                                               p_godown_id uuid, p_from date, p_to date)
returns table (movement_id bigint, movement_date date, movement_type public.movement_type,
               doc_no text, party_name text, godown_code text, location_code text,
               in_qty numeric, out_qty numeric, balance numeric, created_by uuid, created_at timestamptz)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_opening numeric;
begin
  select coalesce(sum(signed_base_qty), 0) into v_opening from public.stock_movements
   where company_id = p_company_id and item_id = p_item_id
     and (p_godown_id is null or godown_id = p_godown_id) and movement_date < p_from;
  movement_id := null; movement_date := p_from; movement_type := 'OPENING'; doc_no := 'Opening';
  party_name := null; godown_code := null; location_code := null; in_qty := null; out_qty := null;
  balance := v_opening; created_by := null; created_at := null;
  return next;
  return query
    select m.id, m.movement_date, m.movement_type, m.doc_no, p.name, g.code, l.code,
           case when m.direction = 1 then m.base_qty end,
           case when m.direction = -1 then m.base_qty end,
           v_opening + sum(m.signed_base_qty) over (order by m.movement_date, m.id),
           m.created_by, m.created_at
    from public.stock_movements m
    join public.godowns g on g.id = m.godown_id
    join public.storage_locations l on l.id = m.location_id
    left join public.parties p on p.id = m.party_id
    where m.company_id = p_company_id and m.item_id = p_item_id
      and (p_godown_id is null or m.godown_id = p_godown_id)
      and m.movement_date between p_from and p_to
    order by m.movement_date, m.id;
end;
$$;

-- Item detail (§39): totals, godown breakdown, location breakdown.
create or replace function public.inventory_item_detail(p_item_id uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  select to_jsonb(x) into v from public.v_inventory_items x where x.item_id = p_item_id;
  if v is null then
    raise exception 'Item not found' using errcode = 'P0001';
  end if;
  return v || jsonb_build_object(
    'godowns', coalesce((select jsonb_agg(to_jsonb(g) order by g.godown_name)
                         from public.v_stock_balance g where g.item_id = p_item_id and g.base_qty <> 0), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(to_jsonb(l) order by l.godown_name, l.is_default, l.location_code)
                           from public.v_stock_by_location l where l.item_id = p_item_id), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Location on stock documents (§20, §23)
-- -----------------------------------------------------------------------------
alter table public.stock_transfer_lines
  add column from_location_id uuid references public.storage_locations (id),
  add column to_location_id   uuid references public.storage_locations (id);
alter table public.stock_adjustment_lines
  add column location_id uuid references public.storage_locations (id);
alter table public.stock_adjustments drop constraint stock_adjustments_reason_check;
alter table public.stock_adjustments add constraint stock_adjustments_reason_check
  check (reason in ('OPENING', 'STOCK_IN', 'STOCK_OUT', 'PHYSICAL_COUNT', 'DAMAGE', 'CORRECTION'));

create or replace function app.post_stock_transfer(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.stock_transfers;
  l        public.stock_transfer_lines;
  v_doc_no text;
  v_warn   text;
  v_warns  text[] := '{}';
begin
  select * into h from public.stock_transfers where id = p_id;
  perform app.assert_same_company(h.company_id, 'godowns', h.from_godown_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.to_godown_id);
  perform app.normalise_lines(app.doc_type('STOCK_TRANSFER'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'STOCK_TRANSFER', h.doc_date);

  for l in select * from public.stock_transfer_lines where transfer_id = p_id order by line_no loop
    v_warn := app.post_stock(h.company_id, l.item_id, h.from_godown_id, h.doc_date,
                             'STOCK_TRANSFER_OUT', -1::smallint, l.qty, l.unit_id, l.factor_to_base,
                             null, null, 'stock_transfers', p_id, l.id, v_doc_no, l.from_location_id);
    if v_warn is not null then v_warns := v_warns || v_warn; end if;
    perform app.post_stock(h.company_id, l.item_id, h.to_godown_id, h.doc_date,
                           'STOCK_TRANSFER_IN', 1::smallint, l.qty, l.unit_id, l.factor_to_base,
                           null, null, 'stock_transfers', p_id, l.id, v_doc_no, l.to_location_id);
  end loop;

  update public.stock_transfers set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  perform app.audit(h.company_id, 'stock_transfers', p_id::text, 'POST', null, jsonb_build_object('doc_no', v_doc_no));
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

-- Same godown, different rack/bin is allowed; same location twice is not.
alter table public.stock_transfers drop constraint stock_transfers_check;
create or replace function app.tg_transfer_line_check()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.stock_transfers;
begin
  select * into h from public.stock_transfers where id = new.transfer_id;
  if h.from_godown_id = h.to_godown_id
     and coalesce(new.from_location_id, app.default_location(h.from_godown_id))
       = coalesce(new.to_location_id, app.default_location(h.to_godown_id)) then
    raise exception 'From and to location must be different' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stock_transfer_lines_check before insert or update on public.stock_transfer_lines
  for each row execute function app.tg_transfer_line_check();

create or replace function app.post_stock_adjustment(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.stock_adjustments;
  l        public.stock_adjustment_lines;
  v_doc_no text;
  v_warn   text;
  v_warns  text[] := '{}';
  v_dir    smallint;
begin
  select * into h from public.stock_adjustments where id = p_id;
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('STOCK_ADJUSTMENT'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'STOCK_ADJUSTMENT', h.doc_date);

  for l in select * from public.stock_adjustment_lines where adjustment_id = p_id order by line_no loop
    v_dir := case h.reason when 'STOCK_IN' then 1 when 'OPENING' then 1 when 'STOCK_OUT' then -1
                           else l.direction end;
    v_warn := app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date,
                             case h.reason when 'OPENING' then 'OPENING'::public.movement_type
                                           when 'STOCK_IN' then 'STOCK_IN'
                                           when 'STOCK_OUT' then 'STOCK_OUT'
                                           else 'STOCK_ADJUSTMENT' end,
                             v_dir, l.qty, l.unit_id, l.factor_to_base,
                             l.rate, null, 'stock_adjustments', p_id, l.id, v_doc_no, l.location_id);
    if v_warn is not null then v_warns := v_warns || v_warn; end if;
  end loop;

  update public.stock_adjustments set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  perform app.audit(h.company_id, 'stock_adjustments', p_id::text, 'POST', null, jsonb_build_object('doc_no', v_doc_no));
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

-- -----------------------------------------------------------------------------
-- Security for the tables created above (0080 ran before them)
-- -----------------------------------------------------------------------------
alter table public.company_settings enable row level security;
alter table public.party_settings   enable row level security;
alter table public.storage_locations enable row level security;
alter table public.stock_balances   enable row level security;
alter table public.stock_reserved   enable row level security;

revoke all on public.company_settings, public.party_settings, public.storage_locations,
              public.stock_balances, public.stock_reserved from anon;
grant select on public.company_settings, public.party_settings, public.storage_locations,
                public.stock_balances, public.stock_reserved, public.v_stock_balance,
                public.v_stock_by_location, public.v_inventory_items to authenticated;
revoke insert, update, delete, truncate on public.stock_balances, public.stock_reserved from authenticated;
grant update on public.company_settings to authenticated;
grant insert, update, delete on public.party_settings, public.storage_locations to authenticated;
grant all on public.company_settings, public.party_settings, public.storage_locations,
             public.stock_balances, public.stock_reserved to service_role;
grant execute on function public.inventory_item_detail(uuid),
                          public.stock_ledger(uuid, uuid, uuid, date, date) to authenticated, service_role;
grant execute on function app.reserved_qty(uuid, uuid, uuid) to authenticated, service_role;

create policy company_settings_read on public.company_settings for select to authenticated
  using (app.is_member(company_id));
create policy company_settings_update on public.company_settings for update to authenticated
  using (app.has_permission(company_id, 'settings.edit'))
  with check (app.has_permission(company_id, 'settings.edit'));
create policy party_settings_read on public.party_settings for select to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.is_member(p.company_id)));
create policy party_settings_write on public.party_settings for all to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'parties.edit')))
  with check (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'parties.edit')));
create policy storage_locations_read on public.storage_locations for select to authenticated
  using (app.is_member(company_id));
create policy storage_locations_insert on public.storage_locations for insert to authenticated
  with check (app.has_permission(company_id, 'godowns.create'));
create policy storage_locations_update on public.storage_locations for update to authenticated
  using (app.has_permission(company_id, 'godowns.edit'))
  with check (app.has_permission(company_id, 'godowns.edit'));
create policy storage_locations_delete on public.storage_locations for delete to authenticated
  using (app.has_permission(company_id, 'godowns.delete') and not is_default);
create policy stock_balances_read on public.stock_balances for select to authenticated
  using (app.is_member(company_id));
create policy stock_reserved_read on public.stock_reserved for select to authenticated
  using (app.is_member(company_id));
create trigger storage_locations_company_refs before insert or update on public.storage_locations
  for each row execute function app.tg_company_refs('godown_id:godowns');
