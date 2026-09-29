-- =============================================================================
-- 0004 INVENTORY ENGINE (spec §12–13)
-- Append-only stock movement ledger, balance cache, posting helpers,
-- auto-consumption, stock transfers, stock adjustments, stock reports.
-- Stock is ALWAYS derived from movements; nothing updates a balance directly.
-- =============================================================================

create table public.stock_movements (
  id               bigserial primary key,
  company_id       uuid not null references public.companies (id),
  item_id          uuid not null references public.items (id),
  godown_id        uuid not null references public.godowns (id),
  movement_date    date not null,
  movement_type    public.movement_type not null,
  direction        smallint not null check (direction in (-1, 1)),
  qty              numeric(16,3) not null check (qty > 0),        -- as entered
  unit_id          uuid not null references public.units (id),
  factor_to_base   numeric(16,6) not null check (factor_to_base > 0),
  base_qty         numeric(16,3) not null check (base_qty > 0),
  signed_base_qty  numeric(16,3) generated always as (direction * base_qty) stored,
  rate             numeric(14,4),
  value            numeric(16,2),
  party_id         uuid references public.parties (id),
  source_table     text not null,
  source_id        uuid not null,
  source_line_id   uuid,
  doc_no           text,
  reversal_of      bigint references public.stock_movements (id),
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create index stock_movements_item_godown_idx on public.stock_movements (company_id, item_id, godown_id, movement_date, id);
create index stock_movements_date_idx on public.stock_movements (company_id, movement_date);
create index stock_movements_source_idx on public.stock_movements (source_table, source_id);
create unique index stock_movements_reversal_uq on public.stock_movements (reversal_of) where reversal_of is not null;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function app.tg_block_mutation();

-- Balance cache, maintained in the same transaction as the movement.
create table public.stock_balances (
  company_id  uuid not null,
  item_id     uuid not null references public.items (id),
  godown_id   uuid not null references public.godowns (id),
  base_qty    numeric(16,3) not null default 0,
  primary key (company_id, item_id, godown_id)
);

create or replace function app.tg_stock_balance()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stock_balances as b (company_id, item_id, godown_id, base_qty)
  values (new.company_id, new.item_id, new.godown_id, new.signed_base_qty)
  on conflict (company_id, item_id, godown_id)
    do update set base_qty = b.base_qty + excluded.base_qty;
  return new;
end;
$$;
create trigger stock_movements_balance after insert on public.stock_movements
  for each row execute function app.tg_stock_balance();

-- -----------------------------------------------------------------------------
-- app.post_stock: the ONLY way stock changes. Returns a warning text when an
-- OUT movement makes the balance negative and the company policy is WARN
-- (decision Q-18); raises when the policy is BLOCK or the godown forbids it.
-- Non stock-tracked items (services) are silently ignored.
-- -----------------------------------------------------------------------------
create or replace function app.post_stock(
  p_company_id uuid, p_item_id uuid, p_godown_id uuid, p_date date,
  p_type public.movement_type, p_direction smallint,
  p_qty numeric, p_unit_id uuid, p_factor numeric,
  p_rate numeric, p_party_id uuid,
  p_source_table text, p_source_id uuid, p_source_line_id uuid, p_doc_no text)
returns text
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tracked  boolean;
  v_item     text;
  v_godown   public.godowns;
  v_base     numeric(16,3) := round(p_qty * p_factor, 3);
  v_balance  numeric;
  v_policy   text;
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

  -- Serialise concurrent postings on the same item + godown.
  insert into public.stock_balances (company_id, item_id, godown_id, base_qty)
  values (p_company_id, p_item_id, p_godown_id, 0)
  on conflict do nothing;
  select base_qty into v_balance from public.stock_balances
   where company_id = p_company_id and item_id = p_item_id and godown_id = p_godown_id
   for update;

  insert into public.stock_movements (company_id, item_id, godown_id, movement_date, movement_type,
    direction, qty, unit_id, factor_to_base, base_qty, rate, value, party_id,
    source_table, source_id, source_line_id, doc_no, created_by)
  values (p_company_id, p_item_id, p_godown_id, p_date, p_type,
    p_direction, p_qty, p_unit_id, p_factor, v_base, p_rate,
    case when p_rate is null then null else round(v_base * p_rate, 2) end, p_party_id,
    p_source_table, p_source_id, p_source_line_id, p_doc_no, auth.uid());

  if p_direction = -1 and v_balance - v_base < 0 then
    v_policy := coalesce(app.setting(p_company_id, 'negative_stock', '"WARN"'::jsonb) #>> '{}', 'WARN');
    if v_policy = 'BLOCK' and not v_godown.allow_negative then
      raise exception 'Insufficient stock of % in % (available %, required %)',
        v_item, v_godown.code, v_balance, v_base using errcode = 'P0001';
    end if;
    return format('Stock of %s in %s becomes negative (%s)', v_item, v_godown.code, v_balance - v_base);
  end if;
  return null;
end;
$$;

-- Reverse every not-yet-reversed movement of a source document (cancellation).
create or replace function app.reverse_stock(p_source_table text, p_source_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stock_movements (company_id, item_id, godown_id, movement_date, movement_type,
    direction, qty, unit_id, factor_to_base, base_qty, rate, value, party_id,
    source_table, source_id, source_line_id, doc_no, reversal_of, created_by)
  select m.company_id, m.item_id, m.godown_id, p_date, m.movement_type,
         -m.direction, m.qty, m.unit_id, m.factor_to_base, m.base_qty, m.rate, m.value, m.party_id,
         m.source_table, m.source_id, m.source_line_id, m.doc_no, m.id, auth.uid()
  from public.stock_movements m
  where m.source_table = p_source_table and m.source_id = p_source_id
    and m.reversal_of is null
    and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Auto-consumption on FG receipt (cartons, barcodes). Returns warnings.
-- p_receipt_kind: 'JOB_WORK' | 'FACTORY'
-- -----------------------------------------------------------------------------
create or replace function app.post_consumption(
  p_company_id uuid, p_fg_item_id uuid, p_godown_id uuid, p_date date,
  p_fg_base_qty numeric, p_receipt_kind text,
  p_source_table text, p_source_id uuid, p_source_line_id uuid, p_doc_no text)
returns text[]
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  r         public.item_consumption_rules;
  v_units   numeric;
  v_qty     numeric;
  v_unit    uuid;
  v_warn    text;
  v_out     text[] := '{}';
begin
  for r in
    select * from public.item_consumption_rules
    where company_id = p_company_id and fg_item_id = p_fg_item_id and is_active
      and (godown_id is null or godown_id = p_godown_id)
      and applies_to in ('ANY', p_receipt_kind)
      and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  loop
    v_units := p_fg_base_qty / app.unit_factor(p_fg_item_id, r.per_unit_id, p_date);
    v_qty := round(v_units * r.qty_per_unit, 3);
    if v_qty > 0 then
      select base_unit_id into v_unit from public.items where id = r.consumed_item_id;
      v_warn := app.post_stock(p_company_id, r.consumed_item_id, p_godown_id, p_date,
                               'CONSUMPTION', -1::smallint, v_qty, v_unit, 1, null, null,
                               p_source_table, p_source_id, p_source_line_id, p_doc_no);
      if v_warn is not null then v_out := v_out || v_warn; end if;
    end if;
  end loop;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stock reports
-- -----------------------------------------------------------------------------
create or replace view public.v_stock_balance
with (security_invoker = true) as
select m.company_id, m.item_id, i.code as item_code, i.name as item_name, i.item_kind,
       m.godown_id, g.code as godown_code,
       sum(m.signed_base_qty) as base_qty,
       u.code as base_unit,
       dp.factor as pack_factor,
       case when dp.factor is not null then round(sum(m.signed_base_qty) / dp.factor, 3) end as pack_qty
from public.stock_movements m
join public.items i on i.id = m.item_id
join public.godowns g on g.id = m.godown_id
join public.units u on u.id = i.base_unit_id
left join lateral app.default_packing(i.id, current_date) dp on true
group by m.company_id, m.item_id, i.code, i.name, i.item_kind, m.godown_id, g.code, u.code, dp.factor;

-- Stock ledger with opening and running balance (replaces ITEM WISE DATA / OUT-IN).
create or replace function public.stock_ledger(p_company_id uuid, p_item_id uuid,
                                               p_godown_id uuid, p_from date, p_to date)
returns table (movement_id bigint, movement_date date, movement_type public.movement_type,
               doc_no text, party_name text, godown_code text,
               in_qty numeric, out_qty numeric, balance numeric)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_opening numeric;
begin
  select coalesce(sum(signed_base_qty), 0) into v_opening from public.stock_movements
   where company_id = p_company_id and item_id = p_item_id
     and (p_godown_id is null or godown_id = p_godown_id) and movement_date < p_from;
  movement_id := null; movement_date := p_from; movement_type := 'OPENING'; doc_no := 'Opening';
  party_name := null; godown_code := null; in_qty := null; out_qty := null; balance := v_opening;
  return next;
  return query
    select m.id, m.movement_date, m.movement_type, m.doc_no, p.name, g.code,
           case when m.direction = 1 then m.base_qty end,
           case when m.direction = -1 then m.base_qty end,
           v_opening + sum(m.signed_base_qty) over (order by m.movement_date, m.id)
    from public.stock_movements m
    join public.godowns g on g.id = m.godown_id
    left join public.parties p on p.id = m.party_id
    where m.company_id = p_company_id and m.item_id = p_item_id
      and (p_godown_id is null or m.godown_id = p_godown_id)
      and m.movement_date between p_from and p_to
    order by m.movement_date, m.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stock transfers (sheet: STOCK SHIFTING) — OUT + IN in one transaction.
-- -----------------------------------------------------------------------------
create table public.stock_transfers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  doc_no          text,
  doc_date        date not null,
  status          public.doc_status not null default 'DRAFT',
  from_godown_id  uuid not null references public.godowns (id),
  to_godown_id    uuid not null references public.godowns (id),
  remarks         text,
  submitted_at    timestamptz, submitted_by uuid,
  approved_at     timestamptz, approved_by uuid,
  posted_at       timestamptz, posted_by uuid,
  cancelled_at    timestamptz, cancelled_by uuid, cancel_reason text,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid,
  check (from_godown_id <> to_godown_id)
);
create unique index stock_transfers_doc_no_uq on public.stock_transfers (company_id, doc_no) where doc_no is not null;
create index stock_transfers_date_idx on public.stock_transfers (company_id, doc_date);

create table public.stock_transfer_lines (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references public.stock_transfers (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  unique (transfer_id, line_no)
);

create table public.stock_adjustments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.doc_status not null default 'DRAFT',
  godown_id     uuid not null references public.godowns (id),
  reason        text not null check (reason in ('OPENING', 'PHYSICAL_COUNT', 'DAMAGE', 'CORRECTION')),
  remarks       text,
  submitted_at  timestamptz, submitted_by uuid,
  approved_at   timestamptz, approved_by uuid,
  posted_at     timestamptz, posted_by uuid,
  cancelled_at  timestamptz, cancelled_by uuid, cancel_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create unique index stock_adjustments_doc_no_uq on public.stock_adjustments (company_id, doc_no) where doc_no is not null;

create table public.stock_adjustment_lines (
  id              uuid primary key default gen_random_uuid(),
  adjustment_id   uuid not null references public.stock_adjustments (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  direction       smallint not null check (direction in (-1, 1)),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  rate            numeric(14,4),
  unique (adjustment_id, line_no)
);

do $$
declare t text;
begin
  foreach t in array array['stock_transfers', 'stock_adjustments'] loop
    execute format('create trigger %1$s_audit_fields before insert or update on public.%1$s
                    for each row execute function app.tg_set_audit_fields()', t);
  end loop;
end $$;
