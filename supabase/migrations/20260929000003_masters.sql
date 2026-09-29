-- =============================================================================
-- 0003 MASTERS
-- Units, categories, brands, items, item-specific packing, auto-consumption
-- rules (cartons / barcodes), godowns, parties (+roles, addresses, rates),
-- chart of accounts, voucher books.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Units. company_id NULL = system unit available to every company.
-- -----------------------------------------------------------------------------
create table public.units (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies (id) on delete cascade,
  code        text not null,
  name        text not null,
  decimals    smallint not null default 0 check (decimals between 0 and 3),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index units_code_uq on public.units
  (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(code));
create trigger units_audit_fields before insert or update on public.units
  for each row execute function app.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- Common master columns are repeated explicitly per table (clear DDL).
-- -----------------------------------------------------------------------------
create table public.item_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  code        text not null,
  name        text not null,
  parent_id   uuid references public.item_categories (id),
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index item_categories_code_uq on public.item_categories (company_id, upper(code));

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  code        text not null,
  name        text not null,
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index brands_code_uq on public.brands (company_id, upper(code));

-- -----------------------------------------------------------------------------
-- Items (finished goods, raw material, packing such as cartons & barcodes)
-- -----------------------------------------------------------------------------
create table public.items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  code              text not null,
  name              text not null,
  item_kind         public.item_kind not null,
  category_id       uuid references public.item_categories (id),
  brand_id          uuid references public.brands (id),
  base_unit_id      uuid not null references public.units (id),
  hsn_code          text,
  gst_rate          numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  is_stock_tracked  boolean not null default true,
  min_stock         numeric(16,3) not null default 0,
  job_work_rate     numeric(14,4) check (job_work_rate >= 0),   -- default FG rate per base unit (Q-07)
  is_active         boolean not null default true,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
create unique index items_code_uq on public.items (company_id, upper(code));
create unique index items_name_uq on public.items (company_id, upper(name));
create index items_kind_idx on public.items (company_id, item_kind) where not is_deleted;
create index items_name_trgm on public.items using gin (name extensions.gin_trgm_ops);

-- Item-specific packing conversion (spec §11): 1 <unit> = factor_to_base base units.
create table public.item_packings (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items (id) on delete cascade,
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null check (factor_to_base > 0),
  is_default      boolean not null default false,
  effective_from  date not null default date '2000-01-01',
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (item_id, unit_id, effective_from)
);
create unique index item_packings_default_uq on public.item_packings (item_id) where is_default;

-- Factor of p_unit for p_item on p_date (1 for the base unit).
create or replace function app.unit_factor(p_item_id uuid, p_unit_id uuid, p_date date)
returns numeric
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_base uuid; v_factor numeric;
begin
  select base_unit_id into v_base from public.items where id = p_item_id;
  if v_base is null then
    raise exception 'Unknown item %', p_item_id using errcode = 'P0001';
  end if;
  if p_unit_id is null or p_unit_id = v_base then
    return 1;
  end if;
  select factor_to_base into v_factor from public.item_packings
   where item_id = p_item_id and unit_id = p_unit_id and effective_from <= p_date
   order by effective_from desc limit 1;
  if v_factor is null then
    raise exception 'No packing conversion defined for this item and unit'
      using errcode = 'P0001';
  end if;
  return v_factor;
end;
$$;

-- Default packing factor (e.g. pairs per box) of an item, null if none.
create or replace function app.default_packing(p_item_id uuid, p_date date,
                                               out unit_id uuid, out factor numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.unit_id, p.factor_to_base
  from public.item_packings p
  where p.item_id = p_item_id and p.is_default and p.effective_from <= p_date
  order by p.effective_from desc limit 1
$$;

-- Human readable quantity: '360 BOX (6480 PAIR)' or '12.5 MTR'.
create or replace function app.fmt_qty(p_item_id uuid, p_base_qty numeric, p_date date)
returns text
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case when dp.factor is not null
              then trim_scale(round(p_base_qty / dp.factor, 3))::text || ' ' || pu.code
                   || ' (' || trim_scale(p_base_qty)::text || ' ' || bu.code || ')'
              else trim_scale(p_base_qty)::text || ' ' || bu.code end
  from public.items i
  join public.units bu on bu.id = i.base_unit_id
  left join lateral app.default_packing(i.id, p_date) dp on true
  left join public.units pu on pu.id = dp.unit_id
  where i.id = p_item_id
$$;

-- -----------------------------------------------------------------------------
-- Godowns / locations
-- -----------------------------------------------------------------------------
create table public.parties (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  code          text not null,
  name          text not null,
  gstin         text,
  pan           text,
  mobile        text,
  email         text,
  address       text,
  city          text,
  state_code    text,
  area          text,
  credit_days   integer not null default 0 check (credit_days >= 0),
  is_active     boolean not null default true,
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create unique index parties_code_uq on public.parties (company_id, upper(code));
create unique index parties_name_uq on public.parties (company_id, upper(name));
create index parties_name_trgm on public.parties using gin (name extensions.gin_trgm_ops);

create table public.party_roles (
  party_id  uuid not null references public.parties (id) on delete cascade,
  role      public.party_role not null,
  primary key (party_id, role)
);

-- Billing / ship-to addresses. Customer DCs (D-Mart BHIWANDI, PUNE, …) are SHIP_TO.
create table public.party_addresses (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references public.parties (id) on delete cascade,
  address_type  text not null check (address_type in ('BILLING', 'SHIP_TO')),
  code          text not null,
  name          text not null,
  address       text,
  city          text,
  state_code    text,
  gstin         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index party_addresses_code_uq on public.party_addresses (party_id, upper(code));

create table public.godowns (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  code            text not null,
  name            text not null,
  godown_type     public.godown_type not null default 'OWN_STORE',
  party_id        uuid references public.parties (id),     -- PARTY_LOCATION: material lying with a cutter / job worker
  allow_negative  boolean not null default false,
  is_active       boolean not null default true,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  check (godown_type <> 'PARTY_LOCATION' or party_id is not null)
);
create unique index godowns_code_uq on public.godowns (company_id, upper(code));

-- -----------------------------------------------------------------------------
-- Auto-consumption rules (cartons Q-19, barcodes Q-27): receiving FG consumes
-- packing items from the receiving godown.
--   per_unit_id = base unit  -> qty_per_unit per pair
--   per_unit_id = BOX        -> qty_per_unit per box (base_qty / pairs-per-box)
-- -----------------------------------------------------------------------------
create table public.item_consumption_rules (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  fg_item_id        uuid not null references public.items (id) on delete cascade,
  consumed_item_id  uuid not null references public.items (id),
  per_unit_id       uuid not null references public.units (id),
  qty_per_unit      numeric(16,6) not null check (qty_per_unit > 0),
  godown_id         uuid references public.godowns (id),      -- null = every godown
  applies_to        text not null default 'ANY' check (applies_to in ('JOB_WORK', 'FACTORY', 'ANY')),
  effective_from    date not null,
  effective_to      date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  check (fg_item_id <> consumed_item_id),
  check (effective_to is null or effective_to >= effective_from)
);
create index item_consumption_rules_fg_idx on public.item_consumption_rules (company_id, fg_item_id);

-- -----------------------------------------------------------------------------
-- Rate lists (optional fixed rates). Default suggestions otherwise come from
-- the last posted rate for party + item + godown (Q-12).
-- -----------------------------------------------------------------------------
create table public.party_item_rates (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  rate_type       text not null check (rate_type in ('ISSUE', 'JOB_WORK', 'PURCHASE', 'SALE', 'WORKER')),
  party_id        uuid references public.parties (id) on delete cascade,  -- null = default for all parties
  item_id         uuid not null references public.items (id) on delete cascade,
  rate            numeric(14,4) not null check (rate >= 0),
  effective_from  date not null default current_date,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create index party_item_rates_lookup_idx on public.party_item_rates
  (company_id, rate_type, item_id, party_id, effective_from desc);

-- -----------------------------------------------------------------------------
-- Chart of accounts (spec §28). Cash and bank are accounts (§27).
-- system_key identifies accounts used by posting functions; names are editable.
-- -----------------------------------------------------------------------------
create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  code               text not null,
  name               text not null,
  parent_id          uuid references public.accounts (id),
  is_group           boolean not null default false,
  account_type       public.account_type not null,
  sub_type           public.account_sub_type not null default 'GENERAL',
  system_key         text,
  is_system          boolean not null default false,
  bank_name          text,
  bank_account_no    text,
  ifsc               text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
create unique index accounts_code_uq on public.accounts (company_id, upper(code));
create unique index accounts_system_key_uq on public.accounts (company_id, system_key) where system_key is not null;
create index accounts_sub_type_idx on public.accounts (company_id, sub_type);

create or replace function app.account_id(p_company_id uuid, p_system_key text)
returns uuid
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id from public.accounts
   where company_id = p_company_id and system_key = p_system_key;
  if v_id is null then
    raise exception 'System account % is missing for this company', p_system_key
      using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- Payment books (decision Q-42): MAIN, FACTORY, … user defined.
create table public.voucher_books (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index voucher_books_code_uq on public.voucher_books (company_id, upper(code));

-- -----------------------------------------------------------------------------
-- Triggers: audit fields + audit log for masters
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['item_categories', 'brands', 'items', 'item_packings', 'parties',
                           'godowns', 'item_consumption_rules', 'party_item_rates',
                           'accounts', 'voucher_books']
  loop
    execute format('create trigger %1$s_audit_fields before insert or update on public.%1$s
                    for each row execute function app.tg_set_audit_fields()', t);
  end loop;
  foreach t in array array['item_categories', 'brands', 'items', 'parties', 'godowns',
                           'item_consumption_rules', 'party_item_rates', 'accounts', 'voucher_books']
  loop
    execute format('create trigger %1$s_audit_log after insert or update or delete on public.%1$s
                    for each row execute function app.tg_audit_row()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Company consistency: a row may only reference masters of the same company.
-- Generic check used by document triggers.
-- -----------------------------------------------------------------------------
create or replace function app.assert_same_company(p_company_id uuid, p_table text, p_id uuid)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_company uuid;
begin
  if p_id is null then return; end if;
  execute format('select company_id from public.%I where id = $1', p_table) into v_company using p_id;
  if v_company is null then
    raise exception '% % does not exist', p_table, p_id using errcode = 'P0001';
  end if;
  if v_company <> p_company_id then
    raise exception '% belongs to another company', p_table using errcode = 'P0001';
  end if;
end;
$$;

create or replace function app.party_has_role(p_party_id uuid, p_role public.party_role)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.party_roles where party_id = p_party_id and role = p_role)
$$;
