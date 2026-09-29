-- =============================================================================
-- 0009 OWN FACTORY — production lots, lot receipts, worker earnings
-- TRANSACTION_FLOWS §7, §15; decisions Q-08, Q-37, Q-39, Q-41.
--   production_orders    lot allotted to own factory; lot no from a configurable
--                        sequence (PRODUCTION_LOT, e.g. "GT 01"), no rate
--   production_receipts  FG received from the factory; LOT IS MANDATORY
--   worker_earnings      pairs × rate per worker (not payroll): Factory Wages Dr / worker Cr
-- =============================================================================

create table public.production_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id),
  doc_no             text,                                 -- = lot number
  doc_date           date not null,
  status             public.order_status not null default 'DRAFT',
  factory_godown_id  uuid not null references public.godowns (id),
  remarks            text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index production_orders_doc_no_uq on public.production_orders (company_id, doc_no) where doc_no is not null;

create table public.production_order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.production_orders (id) on delete cascade,
  line_no           integer not null,
  item_id           uuid not null references public.items (id),
  qty               numeric(16,3) not null check (qty > 0),
  unit_id           uuid not null references public.units (id),
  factor_to_base    numeric(16,6) not null default 1,
  planned_base_qty  numeric(16,3) not null default 0,
  unique (order_id, line_no),
  unique (order_id, item_id)
);

create table public.production_receipts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id),
  doc_no             text,
  doc_date           date not null,
  status             public.doc_status not null default 'DRAFT',
  factory_godown_id  uuid not null references public.godowns (id),
  godown_id          uuid not null references public.godowns (id),
  remarks            text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index production_receipts_doc_no_uq on public.production_receipts (company_id, doc_no) where doc_no is not null;

create table public.production_receipt_lines (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.production_receipts (id) on delete cascade,
  line_no         integer not null,
  order_line_id   uuid not null references public.production_order_lines (id),   -- lot mandatory (Q-41)
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  unique (receipt_id, line_no),
  unique (receipt_id, order_line_id)
);
create index production_receipt_lines_order_line_idx on public.production_receipt_lines (order_line_id);

create table public.worker_earnings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.doc_status not null default 'DRAFT',
  party_id      uuid not null references public.parties (id),       -- worker (role WORKER)
  remarks       text,
  total_amount  numeric(16,2) not null default 0,
  has_missing_rate boolean not null default false,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index worker_earnings_doc_no_uq on public.worker_earnings (company_id, doc_no) where doc_no is not null;
create index worker_earnings_party_idx on public.worker_earnings (company_id, party_id, doc_date);

create table public.worker_earning_lines (
  id                        uuid primary key default gen_random_uuid(),
  earning_id                uuid not null references public.worker_earnings (id) on delete cascade,
  line_no                   integer not null,
  production_order_line_id  uuid references public.production_order_lines (id),
  item_id                   uuid not null references public.items (id),
  operation                 text not null check (operation in ('BOTTOM', 'UPPER', 'FINISH', 'CUTTING', 'OTHER')),
  qty                       numeric(16,3) not null check (qty > 0),
  unit_id                   uuid not null references public.units (id),
  factor_to_base            numeric(16,6) not null default 1,
  base_qty                  numeric(16,3) not null default 0,
  rate                      numeric(14,4) check (rate >= 0),
  amount                    numeric(16,2) not null default 0,
  unique (earning_id, line_no)
);

do $$
declare t text;
begin
  foreach t in array array['production_orders', 'production_receipts', 'worker_earnings'] loop
    execute format('create trigger %1$s_audit_fields before insert or update on public.%1$s
                    for each row execute function app.tg_set_audit_fields()', t);
  end loop;
end $$;

insert into app.doc_types (doc_type, table_name, line_table, line_fk, perm_prefix, is_order, label) values
  ('PRODUCTION_LOT',     'production_orders',   'production_order_lines',   'order_id',   'production_lot',     true,  'Production lot'),
  ('PRODUCTION_RECEIPT', 'production_receipts', 'production_receipt_lines', 'receipt_id', 'production_receipt', false, 'Production receipt'),
  ('WORKER_EARNING',     'worker_earnings',     'worker_earning_lines',     'earning_id', 'worker_earning',     false, 'Worker earnings');

-- -----------------------------------------------------------------------------
-- Lot status (replaces TOTAL ENTRY) and pending list per item (Q-41)
-- -----------------------------------------------------------------------------
create or replace function app.production_received(p_order_line_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(rl.base_qty), 0)
  from public.production_receipt_lines rl
  join public.production_receipts r on r.id = rl.receipt_id
  where rl.order_line_id = p_order_line_id and r.status = 'POSTED'
$$;

create or replace view public.v_production_lot_lines
with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no as lot_no, o.doc_date as lot_date, o.status as lot_status,
       o.factory_godown_id, g.code as factory_code,
       ol.id as order_line_id, ol.item_id, i.code as item_code, i.name as item_name,
       ol.planned_base_qty,
       coalesce(rc.received, 0) as received_base_qty,
       ol.planned_base_qty - coalesce(rc.received, 0) as pending_base_qty,
       dp.factor as pack_factor,
       case when dp.factor is not null then round((ol.planned_base_qty - coalesce(rc.received, 0)) / dp.factor, 3) end as pending_pack_qty,
       case when ol.planned_base_qty - coalesce(rc.received, 0) <= 0 then 'LOT ORDER COMPLETED' else 'PENDING' end as line_status
from public.production_orders o
join public.production_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.godowns g on g.id = o.factory_godown_id
left join lateral (
  select sum(rl.base_qty) as received
  from public.production_receipt_lines rl
  join public.production_receipts r on r.id = rl.receipt_id
  where rl.order_line_id = ol.id and r.status = 'POSTED') rc on true
left join lateral app.default_packing(i.id, current_date) dp on true
where o.status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED');

create or replace view public.v_production_pending
with (security_invoker = true) as
select * from public.v_production_lot_lines where pending_base_qty > 0;

create or replace function app.refresh_production_order_status(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_pending boolean; v_received boolean; v_status public.order_status;
begin
  select status into v_status from public.production_orders where id = p_order_id;
  if v_status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then return; end if;
  select bool_or(ol.planned_base_qty - app.production_received(ol.id) > 0),
         bool_or(app.production_received(ol.id) > 0)
    into v_pending, v_received
  from public.production_order_lines ol where ol.order_id = p_order_id;
  update public.production_orders
     set status = case when not v_pending then 'FULLY_RECEIVED'
                       when v_received then 'PARTIALLY_RECEIVED'
                       else 'OPEN' end::public.order_status
   where id = p_order_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lot allotment
-- -----------------------------------------------------------------------------
create or replace function app.post_production_lot(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.production_orders; v_doc_no text; v_type public.godown_type;
begin
  select * into h from public.production_orders where id = p_id;
  perform app.assert_same_company(h.company_id, 'godowns', h.factory_godown_id);
  select godown_type into v_type from public.godowns where id = h.factory_godown_id;
  if v_type <> 'FACTORY' then
    raise exception 'Lots can only be allotted to a godown of type FACTORY' using errcode = 'P0001';
  end if;
  perform app.normalise_lines(app.doc_type('PRODUCTION_LOT'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'PRODUCTION_LOT', h.doc_date);
  update public.production_orders set doc_no = v_doc_no, status = 'OPEN' where id = p_id;
  return app.result(p_id, v_doc_no, 'OPEN', null);
end;
$$;

create or replace function app.cancel_production_lot(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if exists (select 1 from public.production_order_lines ol
             where ol.order_id = p_id and app.production_received(ol.id) > 0) then
    raise exception 'Goods were already received against this lot; edit the quantity instead of cancelling'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Edit the planned qty of a lot line (same rules as job-work PO, Q-04/Q-05).
create or replace function public.production_lot_line_set_qty(p_order_line_id uuid, p_qty numeric,
                                                              p_unit_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  ol public.production_order_lines; o public.production_orders;
  v_unit uuid; v_factor numeric; v_base numeric; v_received numeric;
begin
  select * into ol from public.production_order_lines where id = p_order_line_id for update;
  select * into o from public.production_orders where id = ol.order_id for update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Lot line not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'production_lot.edit');
  if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then
    raise exception 'Lot is % and cannot be edited this way', o.status using errcode = 'P0001';
  end if;
  if p_qty <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = 'P0001';
  end if;
  v_unit := coalesce(p_unit_id, ol.unit_id);
  v_factor := app.unit_factor(ol.item_id, v_unit, o.doc_date);
  v_base := round(p_qty * v_factor, 3);
  v_received := app.production_received(ol.id);
  if v_base < v_received then
    raise exception 'Quantity cannot be less than already received (%)',
      app.fmt_qty(ol.item_id, v_received, o.doc_date) using errcode = 'P0001';
  end if;
  update public.production_order_lines
     set qty = p_qty, unit_id = v_unit, factor_to_base = v_factor, planned_base_qty = v_base
   where id = ol.id;
  perform app.audit(o.company_id, 'production_order_lines', ol.id::text, 'EDIT_QTY',
                    jsonb_build_object('qty', ol.qty, 'base_qty', ol.planned_base_qty),
                    jsonb_build_object('qty', p_qty, 'base_qty', v_base));
  perform app.refresh_production_order_status(o.id);
  return jsonb_build_object('order_line_id', ol.id, 'planned_base_qty', v_base,
                            'received_base_qty', v_received, 'pending_base_qty', v_base - v_received);
end;
$$;

-- -----------------------------------------------------------------------------
-- Lot receipt — stock IN + carton consumption, no ledger (Q-08)
-- -----------------------------------------------------------------------------
create or replace function app.post_production_receipt(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h         public.production_receipts;
  l         public.production_receipt_lines;
  ol        public.production_order_lines;
  o         public.production_orders;
  v_doc_no  text;
  v_pending numeric;
  v_warns   text[] := '{}';
  v_orders  uuid[] := '{}';
  v_item    text;
begin
  select * into h from public.production_receipts where id = p_id;
  perform app.assert_same_company(h.company_id, 'godowns', h.factory_godown_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('PRODUCTION_RECEIPT'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'PRODUCTION_RECEIPT', h.doc_date);

  for l in select * from public.production_receipt_lines where receipt_id = p_id order by order_line_id loop
    select * into ol from public.production_order_lines where id = l.order_line_id for update;
    select * into o from public.production_orders where id = ol.order_id;
    select name into v_item from public.items where id = ol.item_id;
    if o.company_id <> h.company_id or o.factory_godown_id <> h.factory_godown_id then
      raise exception 'Lot does not belong to this factory' using errcode = 'P0001';
    end if;
    if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then
      raise exception 'Lot % is %', o.doc_no, o.status using errcode = 'P0001';
    end if;
    if l.item_id <> ol.item_id then
      raise exception 'Item does not match the lot line' using errcode = 'P0001';
    end if;
    v_pending := ol.planned_base_qty - app.production_received(ol.id);
    if l.base_qty > v_pending then
      raise exception 'Receive quantity % is more than pending % for % in lot % — edit the lot quantity first',
        app.fmt_qty(l.item_id, l.base_qty, h.doc_date), app.fmt_qty(l.item_id, greatest(v_pending, 0), h.doc_date),
        v_item, o.doc_no using errcode = 'P0001';
    end if;
    perform app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'PRODUCTION_RECEIPT',
                           1::smallint, l.qty, l.unit_id, l.factor_to_base, null, null,
                           'production_receipts', p_id, l.id, v_doc_no);
    v_warns := v_warns || app.post_consumption(h.company_id, l.item_id, h.godown_id, h.doc_date,
                                               l.base_qty, 'FACTORY', 'production_receipts', p_id, l.id, v_doc_no);
    if not o.id = any (v_orders) then v_orders := v_orders || o.id; end if;
  end loop;

  update public.production_receipts set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  for i in 1 .. coalesce(array_length(v_orders, 1), 0) loop
    perform app.refresh_production_order_status(v_orders[i]);
  end loop;
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_production_receipt(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_order uuid;
begin
  perform app.cancel_standard('production_receipts', p_id, p_date);
  update public.production_receipts set status = 'CANCELLED' where id = p_id;
  for v_order in select distinct ol.order_id from public.production_receipt_lines rl
                 join public.production_order_lines ol on ol.id = rl.order_line_id
                 where rl.receipt_id = p_id loop
    perform app.refresh_production_order_status(v_order);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker earnings (Q-39) — not payroll: no attendance, salary structure, PF…
-- -----------------------------------------------------------------------------
create or replace function app.post_worker_earning(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.worker_earnings; v_doc_no text; v_total numeric; v_missing boolean;
begin
  select * into h from public.worker_earnings where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  if not app.party_has_role(h.party_id, 'WORKER') then
    raise exception 'Party is not set up as a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.worker_earning_lines l
             join public.production_order_lines ol on ol.id = l.production_order_line_id
             join public.production_orders o on o.id = ol.order_id
             where l.earning_id = p_id and o.company_id <> h.company_id) then
    raise exception 'Lot belongs to another company' using errcode = 'P0001';
  end if;
  perform app.normalise_lines(app.doc_type('WORKER_EARNING'), p_id, h.doc_date);
  select coalesce(sum(amount), 0), bool_or(coalesce(rate, 0) = 0) into v_total, v_missing
  from public.worker_earning_lines where earning_id = p_id;
  v_doc_no := app.next_doc_no(h.company_id, 'WORKER_EARNING', h.doc_date);
  update public.worker_earnings
     set doc_no = v_doc_no, status = 'POSTED', total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;
  perform app.post_journal(h.company_id, h.doc_date, 'worker_earnings', p_id, v_doc_no,
    'Worker earnings ' || v_doc_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'FACTORY_WAGES'), 'debit', v_total),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'),
                         'party_id', h.party_id, 'credit', v_total)));
  return app.result(p_id, v_doc_no, 'POSTED', null);
end;
$$;

create or replace function app.cancel_worker_earning(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('worker_earnings', p_id, p_date) $$;
