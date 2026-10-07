-- =============================================================================
-- INVENTORY MVP — customer pricing, customer PO review, sales order,
-- stock reservation, dispatch (MASTER_BUILD_PROMPT §10, §16, §21, §22, §37)
--
--   Customer PO (portal) → internal review → approve / modify price / reject
--   → Sales Order (quoted + approved price kept) → Reservation → Dispatch.
--
-- Reservations never change physical stock. They are recorded in their own
-- append-only ledger (stock_reservation_movements: RESERVATION /
-- RESERVATION_RELEASE) and summed into stock_reserved, which post_stock uses
-- for Available = Physical − Reserved.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Customer-specific pricing (§16): party_item_rates rate_type SALE.
-- Priority: rate for this customer → company-wide SALE rate → item sale price.
-- -----------------------------------------------------------------------------
create or replace function app.customer_price(p_company_id uuid, p_party_id uuid, p_item_id uuid,
                                              p_date date default current_date)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.rate from public.party_item_rates r
      where r.company_id = p_company_id and r.rate_type = 'SALE' and r.item_id = p_item_id
        and r.party_id = p_party_id and r.effective_from <= p_date
      order by r.effective_from desc, r.created_at desc limit 1),
    (select r.rate from public.party_item_rates r
      where r.company_id = p_company_id and r.rate_type = 'SALE' and r.item_id = p_item_id
        and r.party_id is null and r.effective_from <= p_date
      order by r.effective_from desc, r.created_at desc limit 1),
    (select i.sale_price from public.items i where i.id = p_item_id and i.company_id = p_company_id))
$$;

create or replace function app.vendor_price(p_company_id uuid, p_party_id uuid, p_item_id uuid,
                                            p_date date default current_date)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.rate from public.party_item_rates r
      where r.company_id = p_company_id and r.rate_type = 'PURCHASE' and r.item_id = p_item_id
        and (r.party_id = p_party_id or r.party_id is null) and r.effective_from <= p_date
      order by (r.party_id is null), r.effective_from desc, r.created_at desc limit 1),
    (select i.purchase_price from public.items i where i.id = p_item_id and i.company_id = p_company_id))
$$;

-- -----------------------------------------------------------------------------
-- Sales order additions
-- -----------------------------------------------------------------------------
alter table public.sales_order_lines
  add column quoted_rate numeric(14,4) check (quoted_rate >= 0),        -- customer's quote (§10)
  add column reference_rate numeric(14,4) check (reference_rate >= 0); -- company price at PO time
comment on column public.sales_order_lines.rate is 'Final approved sale price per base unit';

alter table public.sales_orders
  add column customer_po_id uuid,
  add column closed_at timestamptz,
  add column closed_by uuid,
  add column close_reason text;

alter table public.dispatch_lines
  add column location_id uuid references public.storage_locations (id);

-- -----------------------------------------------------------------------------
-- Stock reservations (§22)
-- -----------------------------------------------------------------------------
create table public.stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  sales_order_id  uuid not null references public.sales_orders (id),
  order_line_id   uuid not null references public.sales_order_lines (id),
  item_id         uuid not null references public.items (id),
  godown_id       uuid not null references public.godowns (id),
  base_qty        numeric(16,3) not null check (base_qty > 0),        -- reserved originally
  consumed_qty    numeric(16,3) not null default 0 check (consumed_qty >= 0),  -- dispatched
  released_qty    numeric(16,3) not null default 0 check (released_qty >= 0), -- given back
  open_qty        numeric(16,3) generated always as (base_qty - consumed_qty - released_qty) stored,
  status          public.reservation_status not null default 'ACTIVE',
  remarks         text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  check (consumed_qty + released_qty <= base_qty)
);
create index stock_reservations_line_idx on public.stock_reservations (order_line_id) where status = 'ACTIVE';
create index stock_reservations_item_idx on public.stock_reservations (company_id, item_id, godown_id) where status = 'ACTIVE';

create table public.stock_reservation_movements (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies (id),
  reservation_id  uuid not null references public.stock_reservations (id),
  item_id         uuid not null references public.items (id),
  godown_id       uuid not null references public.godowns (id),
  movement_type   public.movement_type not null check (movement_type in ('RESERVATION', 'RESERVATION_RELEASE')),
  reason          text not null check (reason in ('RESERVE', 'RELEASE', 'DISPATCH', 'ORDER_CLOSED', 'ORDER_EDITED')),
  base_qty        numeric(16,3) not null check (base_qty > 0),
  source_table    text not null,
  source_id       uuid not null,
  doc_no          text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index stock_reservation_movements_item_idx on public.stock_reservation_movements (company_id, item_id, created_at);
create trigger stock_reservation_movements_immutable before update or delete on public.stock_reservation_movements
  for each row execute function app.tg_block_mutation();

-- Applies a reservation change: ledger row + stock_reserved summary.
-- Caller must hold the stock_reserved row lock (app.lock_stock_row).
create or replace function app.lock_stock_row(p_company_id uuid, p_item_id uuid, p_godown_id uuid)
returns numeric
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v numeric;
begin
  insert into public.stock_reserved (company_id, item_id, godown_id, reserved_qty)
  values (p_company_id, p_item_id, p_godown_id, 0) on conflict do nothing;
  select reserved_qty into v from public.stock_reserved
   where company_id = p_company_id and item_id = p_item_id and godown_id = p_godown_id
   for no key update;
  return v;
end;
$$;

create or replace function app.reservation_change(r public.stock_reservations, p_type public.movement_type,
                                                  p_reason text, p_qty numeric,
                                                  p_source_table text, p_source_id uuid, p_doc_no text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stock_reservation_movements (company_id, reservation_id, item_id, godown_id, movement_type,
                                                  reason, base_qty, source_table, source_id, doc_no, created_by)
  values (r.company_id, r.id, r.item_id, r.godown_id, p_type, p_reason, p_qty, p_source_table, p_source_id,
          p_doc_no, auth.uid());
  update public.stock_reserved
     set reserved_qty = reserved_qty + case when p_type = 'RESERVATION' then p_qty else -p_qty end
   where company_id = r.company_id and item_id = r.item_id and godown_id = r.godown_id;
end;
$$;

create or replace function app.line_reserved(p_order_line_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(open_qty), 0) from public.stock_reservations
  where order_line_id = p_order_line_id and status = 'ACTIVE'
$$;

-- Reserve stock for an order line in a godown (internal).
create or replace function app.reserve(p_order_line_id uuid, p_godown_id uuid, p_base_qty numeric,
                                       p_remarks text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  ol public.sales_order_lines; o public.sales_orders; g public.godowns;
  v_reserved numeric; v_physical numeric; v_pending numeric; r public.stock_reservations;
begin
  select * into ol from public.sales_order_lines where id = p_order_line_id for no key update;
  select * into o from public.sales_orders where id = ol.order_id;
  if o.status not in ('OPEN', 'PARTIALLY_DISPATCHED') then
    raise exception 'Stock can only be reserved for an open sales order (status %)', o.status using errcode = 'P0001';
  end if;
  select * into g from public.godowns where id = p_godown_id and company_id = o.company_id;
  if g.id is null then
    raise exception 'Godown does not belong to this company' using errcode = 'P0001';
  end if;
  if p_base_qty is null or p_base_qty <= 0 then
    raise exception 'Reservation quantity must be greater than zero' using errcode = 'P0001';
  end if;
  v_pending := ol.ordered_base_qty - app.dispatched_qty(ol.id) - app.line_reserved(ol.id);
  if p_base_qty > v_pending then
    raise exception 'Reservation % is more than the unreserved pending quantity % of this order line',
      app.fmt_qty(ol.item_id, p_base_qty, current_date), app.fmt_qty(ol.item_id, greatest(v_pending, 0), current_date)
      using errcode = 'P0001';
  end if;
  v_reserved := app.lock_stock_row(o.company_id, ol.item_id, p_godown_id);
  v_physical := app.physical_qty(o.company_id, ol.item_id, p_godown_id);
  -- Reservations are always limited to available stock (even with negative stock ON).
  if v_physical - v_reserved < p_base_qty then
    raise exception 'Cannot reserve %: only % available in % (physical % − reserved %)',
      app.fmt_qty(ol.item_id, p_base_qty, current_date),
      app.fmt_qty(ol.item_id, greatest(v_physical - v_reserved, 0), current_date), g.name,
      trim_scale(v_physical), trim_scale(v_reserved) using errcode = 'P0001';
  end if;
  insert into public.stock_reservations (company_id, sales_order_id, order_line_id, item_id, godown_id, base_qty,
                                         remarks, created_by)
  values (o.company_id, o.id, ol.id, ol.item_id, p_godown_id, p_base_qty, p_remarks, auth.uid())
  returning * into r;
  perform app.reservation_change(r, 'RESERVATION', 'RESERVE', p_base_qty, 'sales_orders', o.id, o.doc_no);
  perform app.audit(o.company_id, 'stock_reservations', r.id::text, 'RESERVE', null,
                    jsonb_build_object('order', o.doc_no, 'item_id', ol.item_id, 'godown_id', p_godown_id,
                                       'base_qty', p_base_qty));
  return r.id;
end;
$$;

-- Release (part of) a reservation.
create or replace function app.release(p_reservation_id uuid, p_base_qty numeric, p_reason text,
                                       p_source_table text, p_source_id uuid, p_doc_no text)
returns numeric
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.stock_reservations; v_qty numeric;
begin
  select * into r from public.stock_reservations where id = p_reservation_id;
  perform app.lock_stock_row(r.company_id, r.item_id, r.godown_id);
  select * into r from public.stock_reservations where id = p_reservation_id for no key update;
  if r.status <> 'ACTIVE' or r.open_qty <= 0 then
    return 0;
  end if;
  v_qty := least(coalesce(p_base_qty, r.open_qty), r.open_qty);
  if v_qty <= 0 then
    return 0;
  end if;
  if p_reason = 'DISPATCH' then
    update public.stock_reservations set consumed_qty = consumed_qty + v_qty, updated_at = now() where id = r.id
    returning * into r;
  else
    update public.stock_reservations set released_qty = released_qty + v_qty, updated_at = now() where id = r.id
    returning * into r;
  end if;
  if r.open_qty = 0 then
    update public.stock_reservations
       set status = case when consumed_qty > 0 and released_qty = 0 then 'CONSUMED' else 'RELEASED' end::public.reservation_status
     where id = r.id;
  end if;
  perform app.reservation_change(r, 'RESERVATION_RELEASE', p_reason, v_qty, p_source_table, p_source_id, p_doc_no);
  return v_qty;
end;
$$;

-- Public RPCs ------------------------------------------------------------------
create or replace function public.sales_order_reserve(p_order_line_id uuid, p_godown_id uuid, p_qty numeric,
                                                      p_unit_id uuid default null, p_remarks text default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare ol public.sales_order_lines; o public.sales_orders; v_id uuid; v_base numeric;
begin
  select * into ol from public.sales_order_lines where id = p_order_line_id;
  select * into o from public.sales_orders where id = ol.order_id;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Order line not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'reservation.create');
  v_base := round(p_qty * app.unit_factor(ol.item_id, coalesce(p_unit_id, ol.unit_id), current_date), 3);
  v_id := app.reserve(ol.id, p_godown_id, v_base, p_remarks);
  return jsonb_build_object('reservation_id', v_id, 'base_qty', v_base,
                            'available_qty', app.physical_qty(o.company_id, ol.item_id, p_godown_id)
                                             - app.reserved_qty(o.company_id, ol.item_id, p_godown_id));
end;
$$;

create or replace function public.reservation_release(p_reservation_id uuid, p_qty numeric default null,
                                                      p_remarks text default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.stock_reservations; v numeric;
begin
  select * into r from public.stock_reservations where id = p_reservation_id;
  if r.id is null or not app.is_member(r.company_id) then
    raise exception 'Reservation not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(r.company_id, 'reservation.cancel');
  if p_qty is not null and p_qty <= 0 then
    raise exception 'Release quantity must be greater than zero' using errcode = 'P0001';
  end if;
  v := app.release(r.id, p_qty, 'RELEASE', 'stock_reservations', r.id, null);
  if v = 0 then
    raise exception 'Nothing left to release on this reservation' using errcode = 'P0001';
  end if;
  perform app.audit(r.company_id, 'stock_reservations', r.id::text, 'RELEASE', null,
                    jsonb_build_object('base_qty', v, 'remarks', p_remarks));
  return jsonb_build_object('released_qty', v);
end;
$$;

create or replace function app.release_order_reservations(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.stock_reservations; o public.sales_orders;
begin
  select * into o from public.sales_orders where id = p_order_id;
  for r in select * from public.stock_reservations where sales_order_id = p_order_id and status = 'ACTIVE'
           order by id loop
    perform app.release(r.id, null, p_reason, 'sales_orders', p_order_id, o.doc_no);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sales order views / status
-- -----------------------------------------------------------------------------
drop view public.v_sales_order_lines;
create view public.v_sales_order_lines
with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no, o.customer_po_no, o.doc_date as po_date, o.delivery_date,
       o.status as order_status, o.party_id, p.name as party_name, o.customer_po_id,
       o.ship_to_address_id, a.code as dc_code,
       exists (select 1 from public.sales_order_date_revisions r where r.sales_order_id = o.id) as is_revised,
       ol.id as order_line_id, ol.line_no, ol.item_id, i.code as item_code, i.name as item_name,
       ol.qty, ol.unit_id, ol.rate as approved_rate, ol.quoted_rate, ol.reference_rate,
       ol.ordered_base_qty, app.dispatched_qty(ol.id) as dispatched_base_qty,
       ol.ordered_base_qty - app.dispatched_qty(ol.id) as pending_base_qty,
       app.line_reserved(ol.id) as reserved_base_qty,
       greatest(ol.ordered_base_qty - app.dispatched_qty(ol.id) - app.line_reserved(ol.id), 0) as unreserved_base_qty,
       dp.factor as pack_factor,
       case when dp.factor is not null then round(ol.ordered_base_qty / dp.factor, 3) end as ordered_pack_qty,
       case when dp.factor is not null then round((ol.ordered_base_qty - app.dispatched_qty(ol.id)) / dp.factor, 3) end as pending_pack_qty
from public.sales_orders o
join public.sales_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.parties p on p.id = o.party_id
left join public.party_addresses a on a.id = o.ship_to_address_id
left join lateral app.default_packing(i.id, current_date) dp on true
where o.status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED');

create or replace view public.v_stock_reservations
with (security_invoker = true) as
select r.id, r.company_id, r.sales_order_id, o.doc_no as order_no, o.customer_po_no, o.party_id, p.name as party_name,
       r.order_line_id, r.item_id, i.code as item_code, i.name as item_name,
       r.godown_id, g.name as godown_name, r.base_qty, r.consumed_qty, r.released_qty, r.open_qty,
       r.status, r.remarks, r.created_at, r.created_by
from public.stock_reservations r
join public.sales_orders o on o.id = r.sales_order_id
join public.parties p on p.id = o.party_id
join public.items i on i.id = r.item_id
join public.godowns g on g.id = r.godown_id;

create or replace function app.refresh_sales_order_status(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_pending boolean; v_any boolean; v_status public.order_status;
begin
  select status into v_status from public.sales_orders where id = p_order_id;
  if v_status not in ('OPEN', 'PARTIALLY_DISPATCHED', 'DISPATCHED') then return; end if;
  select bool_or(ol.ordered_base_qty - app.dispatched_qty(ol.id) > 0),
         bool_or(app.dispatched_qty(ol.id) > 0)
    into v_pending, v_any
  from public.sales_order_lines ol where ol.order_id = p_order_id;
  update public.sales_orders
     set status = case when not v_pending then 'DISPATCHED'
                       when v_any then 'PARTIALLY_DISPATCHED'
                       else 'OPEN' end::public.order_status
   where id = p_order_id;
  if not v_pending then
    perform app.release_order_reservations(p_order_id, 'ORDER_CLOSED');
  end if;
end;
$$;

create or replace function app.cancel_sales_order(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if exists (select 1 from public.sales_order_lines ol
             where ol.order_id = p_id and app.dispatched_qty(ol.id) > 0) then
    raise exception 'Goods were already dispatched against this order; close it instead of cancelling'
      using errcode = 'P0001';
  end if;
  perform app.release_order_reservations(p_id, 'ORDER_CLOSED');
end;
$$;

-- Close an order that will not be fully dispatched (CLOSED, §19 statuses).
create or replace function public.sales_order_close(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.sales_orders;
begin
  select * into o from public.sales_orders where id = p_order_id for no key update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Sales order not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'sales_order.cancel');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to close the order' using errcode = 'P0001';
  end if;
  if o.status not in ('OPEN', 'PARTIALLY_DISPATCHED') then
    raise exception 'Only open orders can be closed (status %)', o.status using errcode = 'P0001';
  end if;
  perform app.release_order_reservations(o.id, 'ORDER_CLOSED');
  update public.sales_orders set status = 'CLOSED', closed_at = now(), closed_by = auth.uid(), close_reason = p_reason
   where id = o.id;
  perform app.audit(o.company_id, 'sales_orders', o.id::text, 'CLOSE', null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('id', o.id, 'status', 'CLOSED');
end;
$$;

-- Editing the ordered quantity: never below dispatched + reserved.
create or replace function public.sales_order_line_set_qty(p_order_line_id uuid, p_qty numeric,
                                                           p_unit_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare ol public.sales_order_lines; o public.sales_orders;
        v_unit uuid; v_factor numeric; v_base numeric; v_done numeric; v_res numeric;
begin
  select * into ol from public.sales_order_lines where id = p_order_line_id for no key update;
  select * into o from public.sales_orders where id = ol.order_id for no key update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Order line not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'sales_order.edit');
  if o.status not in ('OPEN', 'PARTIALLY_DISPATCHED', 'DISPATCHED') or p_qty <= 0 then
    raise exception 'Order cannot be edited (status %, qty %)', o.status, p_qty using errcode = 'P0001';
  end if;
  v_unit := coalesce(p_unit_id, ol.unit_id);
  v_factor := app.unit_factor(ol.item_id, v_unit, o.doc_date);
  v_base := round(p_qty * v_factor, 3);
  v_done := app.dispatched_qty(ol.id);
  v_res := app.line_reserved(ol.id);
  if v_base < v_done then
    raise exception 'Quantity cannot be less than already dispatched (%)',
      app.fmt_qty(ol.item_id, v_done, o.doc_date) using errcode = 'P0001';
  end if;
  if v_base < v_done + v_res then
    raise exception 'Quantity cannot be less than dispatched + reserved (%); release the reservation first',
      app.fmt_qty(ol.item_id, v_done + v_res, o.doc_date) using errcode = 'P0001';
  end if;
  update public.sales_order_lines set qty = p_qty, unit_id = v_unit, factor_to_base = v_factor,
         ordered_base_qty = v_base where id = ol.id;
  perform app.audit(o.company_id, 'sales_order_lines', ol.id::text, 'EDIT_QTY',
                    jsonb_build_object('base_qty', ol.ordered_base_qty), jsonb_build_object('base_qty', v_base));
  if o.status = 'DISPATCHED' and v_base > v_done then
    update public.sales_orders set status = 'PARTIALLY_DISPATCHED' where id = o.id;
  end if;
  perform app.refresh_sales_order_status(o.id);
  return jsonb_build_object('order_line_id', ol.id, 'pending_base_qty', v_base - v_done);
end;
$$;

-- Approved price can be changed only by an approver (§35: never by the customer).
create or replace function public.sales_order_line_set_rate(p_order_line_id uuid, p_rate numeric,
                                                            p_reason text default null)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare ol public.sales_order_lines; o public.sales_orders;
begin
  select * into ol from public.sales_order_lines where id = p_order_line_id for no key update;
  select * into o from public.sales_orders where id = ol.order_id;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Order line not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'sales_order.approve');
  if p_rate is null or p_rate < 0 then
    raise exception 'Rate must be zero or more' using errcode = 'P0001';
  end if;
  if o.status not in ('OPEN', 'PARTIALLY_DISPATCHED') then
    raise exception 'Order is % and its price can no longer be changed', o.status using errcode = 'P0001';
  end if;
  update public.sales_order_lines set rate = p_rate where id = ol.id;
  perform app.audit(o.company_id, 'sales_order_lines', ol.id::text, 'EDIT_RATE',
                    jsonb_build_object('rate', ol.rate), jsonb_build_object('rate', p_rate, 'reason', p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- Dispatch: consume reservation of the order line in this godown first, then
-- stock OUT (SALE_DISPATCH) from the chosen / auto-picked location (§37).
-- -----------------------------------------------------------------------------
create or replace function app.post_dispatch(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h public.dispatches; o public.sales_orders; l public.dispatch_lines; ol public.sales_order_lines;
  r public.stock_reservations;
  v_doc_no text; v_pending numeric; v_left numeric; v_warns text[] := '{}';
begin
  select * into h from public.dispatches where id = p_id;
  select * into o from public.sales_orders where id = h.sales_order_id for no key update;
  if o.company_id <> h.company_id then
    raise exception 'Sales order belongs to another company' using errcode = 'P0001';
  end if;
  if o.status not in ('OPEN', 'PARTIALLY_DISPATCHED') then
    raise exception 'Sales order % is %', o.doc_no, o.status using errcode = 'P0001';
  end if;
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.assert_same_company(h.company_id, 'parties', h.transporter_party_id);
  perform app.normalise_lines(app.doc_type('DISPATCH'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'DISPATCH', h.doc_date);

  for l in select * from public.dispatch_lines where dispatch_id = p_id order by order_line_id loop
    select * into ol from public.sales_order_lines where id = l.order_line_id for no key update;
    if ol.order_id <> o.id or ol.item_id <> l.item_id then
      raise exception 'Dispatch line does not match the sales order' using errcode = 'P0001';
    end if;
    v_pending := ol.ordered_base_qty - app.dispatched_qty(ol.id);
    if l.base_qty > v_pending then
      raise exception 'Dispatch quantity % is more than pending % on order %',
        app.fmt_qty(l.item_id, l.base_qty, h.doc_date), app.fmt_qty(l.item_id, greatest(v_pending, 0), h.doc_date),
        coalesce(o.customer_po_no, o.doc_no) using errcode = 'P0001';
    end if;
    -- consume this line's own reservation in this godown
    v_left := l.base_qty;
    for r in select * from public.stock_reservations
             where order_line_id = ol.id and godown_id = h.godown_id and status = 'ACTIVE' order by created_at loop
      exit when v_left <= 0;
      v_left := v_left - app.release(r.id, v_left, 'DISPATCH', 'dispatches', p_id, v_doc_no);
    end loop;
    v_warns := v_warns || app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'SALE_DISPATCH',
                                         -1::smallint, l.qty, l.unit_id, l.factor_to_base, ol.rate, o.party_id,
                                         'dispatches', p_id, l.id, v_doc_no, l.location_id);
  end loop;

  update public.dispatches set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  perform app.refresh_sales_order_status(o.id);
  perform app.audit(h.company_id, 'dispatches', p_id::text, 'POST', null, jsonb_build_object('doc_no', v_doc_no));
  return app.result(p_id, v_doc_no, 'POSTED', array_remove(v_warns, null));
end;
$$;

-- -----------------------------------------------------------------------------
-- Customer PO (§10) — created by the customer in the portal (or by an internal
-- user on behalf of the customer), reviewed internally.
-- -----------------------------------------------------------------------------
create table public.customer_pos (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies (id),
  party_id                 uuid not null references public.parties (id),
  po_no                    text not null,
  po_date                  date not null,
  requested_delivery_date  date,
  ship_to_address_id       uuid references public.party_addresses (id),
  remarks                  text,
  status                   public.customer_po_status not null default 'SUBMITTED',
  source                   text not null default 'PORTAL' check (source in ('PORTAL', 'INTERNAL')),
  review_remarks           text,
  reject_reason            text,
  reviewed_at              timestamptz,
  reviewed_by              uuid,
  sales_order_id           uuid references public.sales_orders (id),
  created_at               timestamptz not null default now(),
  created_by               uuid,
  updated_at               timestamptz not null default now()
);
create unique index customer_pos_no_uq on public.customer_pos (company_id, party_id, upper(po_no))
  where status <> 'CANCELLED';
create index customer_pos_status_idx on public.customer_pos (company_id, status, po_date);
alter table public.sales_orders
  add constraint sales_orders_customer_po_fk foreign key (customer_po_id) references public.customer_pos (id);

create table public.customer_po_lines (
  id              uuid primary key default gen_random_uuid(),
  customer_po_id  uuid not null references public.customer_pos (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  reference_rate  numeric(14,4) check (reference_rate >= 0),   -- company price for this customer (internal)
  quoted_rate     numeric(14,4) check (quoted_rate >= 0),      -- customerQuotedPrice
  approved_rate   numeric(14,4) check (approved_rate >= 0),    -- final approved price
  remarks         text,
  unique (customer_po_id, line_no),
  unique (customer_po_id, item_id)
);

-- Builds a customer PO from a payload (shared by portal and internal entry).
-- Server sets reference_rate; quoted_rate kept only when quoting is allowed.
create or replace function app.customer_po_create(p_company_id uuid, p_party_id uuid, p_payload jsonb,
                                                  p_source text, p_allow_quote boolean)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid(); e jsonb; n int := 0; it public.items; v_unit uuid; v_factor numeric;
  v_date date := coalesce((p_payload->>'po_date')::date, current_date);
  v_qty numeric; v_quote numeric;
begin
  if coalesce(trim(p_payload->>'po_no'), '') = '' then
    raise exception 'PO number is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and company_id = p_company_id and is_active) then
    raise exception 'Customer not found' using errcode = 'P0001';
  end if;
  if (p_payload->>'ship_to_address_id') is not null and not exists (
       select 1 from public.party_addresses where id = (p_payload->>'ship_to_address_id')::uuid and party_id = p_party_id) then
    raise exception 'Delivery location does not belong to this customer' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'PO must have at least one item' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_pos where company_id = p_company_id and party_id = p_party_id
             and upper(po_no) = upper(trim(p_payload->>'po_no')) and status <> 'CANCELLED') then
    raise exception 'PO number % already exists', trim(p_payload->>'po_no') using errcode = 'P0001';
  end if;

  insert into public.customer_pos (id, company_id, party_id, po_no, po_date, requested_delivery_date,
                                   ship_to_address_id, remarks, source, created_by)
  values (v_id, p_company_id, p_party_id, trim(p_payload->>'po_no'), v_date,
          (p_payload->>'requested_delivery_date')::date, (p_payload->>'ship_to_address_id')::uuid,
          p_payload->>'remarks', p_source, auth.uid());

  for e in select * from jsonb_array_elements(p_payload->'lines') loop
    n := n + 1;
    select * into it from public.items where id = (e->>'item_id')::uuid and company_id = p_company_id
      and is_active and not is_deleted;
    if it.id is null or (p_source = 'PORTAL' and not it.portal_visible) then
      raise exception 'Item not available' using errcode = 'P0001';
    end if;
    v_unit := coalesce((e->>'unit_id')::uuid, it.sales_unit_id, it.base_unit_id);
    v_factor := app.unit_factor(it.id, v_unit, v_date);
    v_qty := (e->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity of % must be greater than zero', it.name using errcode = 'P0001';
    end if;
    v_quote := case when p_allow_quote then (e->>'quoted_rate')::numeric end;
    if v_quote is not null and v_quote < 0 then
      raise exception 'Quoted price cannot be negative' using errcode = 'P0001';
    end if;
    insert into public.customer_po_lines (customer_po_id, line_no, item_id, qty, unit_id, factor_to_base, base_qty,
                                          reference_rate, quoted_rate, remarks)
    values (v_id, n, it.id, v_qty, v_unit, v_factor, round(v_qty * v_factor, 3),
            app.customer_price(p_company_id, p_party_id, it.id, v_date), v_quote, e->>'remarks');
  end loop;
  perform app.audit(p_company_id, 'customer_pos', v_id::text, 'CREATE', null, p_payload || jsonb_build_object('source', p_source));
  return v_id;
end;
$$;

-- Internal entry of a customer PO received by mail / phone.
create or replace function public.customer_po_create(p_company_id uuid, p_party_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'customer_po.create');
  if not app.party_has_role(p_party_id, 'CUSTOMER') then
    raise exception 'Party is not set up as a customer' using errcode = 'P0001';
  end if;
  return app.customer_po_create(p_company_id, p_party_id, p_payload, 'INTERNAL', true);
end;
$$;

create or replace function app.lock_customer_po(p_id uuid)
returns public.customer_pos
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare c public.customer_pos;
begin
  select * into c from public.customer_pos where id = p_id for no key update;
  if c.id is null or not app.is_member(c.company_id) then
    raise exception 'Customer PO not found' using errcode = 'P0001';
  end if;
  return c;
end;
$$;

create or replace function public.customer_po_start_review(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare c public.customer_pos := app.lock_customer_po(p_id);
begin
  perform app.require_permission(c.company_id, 'customer_po.edit');
  if c.status <> 'SUBMITTED' then
    raise exception 'Customer PO is %', c.status using errcode = 'P0001';
  end if;
  update public.customer_pos set status = 'UNDER_REVIEW', updated_at = now() where id = p_id;
  perform app.audit(c.company_id, 'customer_pos', p_id::text, 'START_REVIEW', null, null);
end;
$$;

-- Approve (optionally with modified prices / qty) → Sales Order (OPEN).
-- p_lines: [{"line_id": …, "approved_rate": 145, "qty": 100}] — lines not
-- listed keep quoted price (or the reference price when no quote).
-- p_godown_id + p_reserve: reserve available stock for the new order.
create or replace function public.customer_po_approve(p_id uuid, p_lines jsonb default '[]',
                                                      p_remarks text default null,
                                                      p_godown_id uuid default null,
                                                      p_reserve boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  c public.customer_pos := app.lock_customer_po(p_id);
  l public.customer_po_lines; e jsonb; v_rate numeric; v_qty numeric;
  v_so uuid := gen_random_uuid(); v_doc_no text; v_line uuid; v_avail numeric; v_res numeric;
  v_warns text[] := '{}'; v_reserved jsonb := '[]';
begin
  perform app.require_permission(c.company_id, 'customer_po.approve');
  if c.status not in ('SUBMITTED', 'UNDER_REVIEW') then
    raise exception 'Customer PO is % and cannot be approved', c.status using errcode = 'P0001';
  end if;
  perform app.assert_period_open(c.company_id, c.po_date);
  if p_godown_id is not null then
    perform app.assert_same_company(c.company_id, 'godowns', p_godown_id);
  end if;

  for l in select * from public.customer_po_lines where customer_po_id = p_id order by line_no loop
    select x into e from jsonb_array_elements(coalesce(p_lines, '[]')) x where (x->>'line_id')::uuid = l.id;
    v_rate := coalesce((e->>'approved_rate')::numeric, l.quoted_rate, l.reference_rate);
    if v_rate is null or v_rate < 0 then
      raise exception 'Approved price is required for item % (no quote and no price list)',
        (select name from public.items where id = l.item_id) using errcode = 'P0001';
    end if;
    v_qty := coalesce((e->>'qty')::numeric, l.qty);
    if v_qty <= 0 then
      raise exception 'Quantity must be greater than zero' using errcode = 'P0001';
    end if;
    update public.customer_po_lines
       set approved_rate = v_rate, qty = v_qty, base_qty = round(v_qty * factor_to_base, 3)
     where id = l.id;
  end loop;

  v_doc_no := app.next_doc_no(c.company_id, 'SALES_ORDER', c.po_date);
  insert into public.sales_orders (id, company_id, doc_no, doc_date, status, party_id, ship_to_address_id,
                                   customer_po_no, delivery_date, godown_id, remarks, customer_po_id,
                                   submitted_at, submitted_by, approved_at, approved_by, posted_at, posted_by)
  values (v_so, c.company_id, v_doc_no, c.po_date, 'OPEN', c.party_id, c.ship_to_address_id, c.po_no,
          c.requested_delivery_date, p_godown_id, coalesce(p_remarks, c.remarks), c.id,
          c.created_at, c.created_by, now(), auth.uid(), now(), auth.uid());
  insert into public.sales_order_lines (order_id, line_no, item_id, qty, unit_id, factor_to_base, ordered_base_qty,
                                        rate, quoted_rate, reference_rate)
  select v_so, line_no, item_id, qty, unit_id, factor_to_base, base_qty, approved_rate, quoted_rate, reference_rate
  from public.customer_po_lines where customer_po_id = p_id;

  update public.customer_pos
     set status = 'APPROVED', sales_order_id = v_so, reviewed_at = now(), reviewed_by = auth.uid(),
         review_remarks = p_remarks, updated_at = now()
   where id = p_id;
  perform app.audit(c.company_id, 'customer_pos', p_id::text, 'APPROVE', null,
                    jsonb_build_object('sales_order', v_doc_no, 'lines', p_lines, 'remarks', p_remarks));

  if p_reserve and p_godown_id is not null then
    for v_line in select id from public.sales_order_lines where order_id = v_so order by line_no loop
      select ol.ordered_base_qty, ol.item_id into v_qty, l.item_id from public.sales_order_lines ol where ol.id = v_line;
      perform app.lock_stock_row(c.company_id, l.item_id, p_godown_id);
      v_avail := app.physical_qty(c.company_id, l.item_id, p_godown_id) - app.reserved_qty(c.company_id, l.item_id, p_godown_id);
      v_res := least(v_qty, greatest(v_avail, 0));
      if v_res > 0 then
        perform app.reserve(v_line, p_godown_id, v_res, 'Reserved on approval of ' || c.po_no);
        v_reserved := v_reserved || jsonb_build_object('order_line_id', v_line, 'base_qty', v_res);
      end if;
      if v_res < v_qty then
        v_warns := v_warns || format('%s: only %s of %s could be reserved',
          (select name from public.items where id = l.item_id), trim_scale(v_res), trim_scale(v_qty));
      end if;
    end loop;
  end if;

  return jsonb_build_object('customer_po_id', p_id, 'sales_order_id', v_so, 'sales_order_no', v_doc_no,
                            'status', 'APPROVED', 'reserved', v_reserved, 'warnings', to_jsonb(v_warns));
end;
$$;

create or replace function public.customer_po_reject(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare c public.customer_pos := app.lock_customer_po(p_id);
begin
  perform app.require_permission(c.company_id, 'customer_po.approve');
  if c.status not in ('SUBMITTED', 'UNDER_REVIEW') then
    raise exception 'Customer PO is % and cannot be rejected', c.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reject' using errcode = 'P0001';
  end if;
  update public.customer_pos set status = 'REJECTED', reject_reason = p_reason, reviewed_at = now(),
         reviewed_by = auth.uid(), updated_at = now() where id = p_id;
  perform app.audit(c.company_id, 'customer_pos', p_id::text, 'REJECT', null, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace view public.v_customer_po_lines
with (security_invoker = true) as
select c.company_id, c.id as customer_po_id, c.po_no, c.po_date, c.requested_delivery_date, c.status,
       c.source, c.party_id, p.name as party_name, c.sales_order_id, so.doc_no as sales_order_no,
       c.remarks, c.review_remarks, c.reject_reason, c.created_at, c.reviewed_at,
       l.id as line_id, l.line_no, l.item_id, i.code as item_code, i.name as item_name,
       l.qty, u.code as unit, l.base_qty, l.reference_rate, l.quoted_rate, l.approved_rate,
       case when l.quoted_rate is not null and l.reference_rate is not null
            then l.quoted_rate - l.reference_rate end as quote_difference
from public.customer_pos c
join public.parties p on p.id = c.party_id
join public.customer_po_lines l on l.customer_po_id = c.id
join public.items i on i.id = l.item_id
join public.units u on u.id = l.unit_id
left join public.sales_orders so on so.id = c.sales_order_id;

-- -----------------------------------------------------------------------------
-- Unified stock movement history (physical + reservation ledgers) for the
-- item screen (§6: item, godown, location, qty, unit, type, reference, date,
-- user, timestamp).
-- -----------------------------------------------------------------------------
create or replace view public.v_stock_movement_history
with (security_invoker = true) as
select m.company_id, 'STOCK'::text as ledger, m.id as movement_id, m.movement_date, m.movement_type,
       m.item_id, m.godown_id, g.name as godown_name, m.location_id, l.code as location_code,
       m.direction, m.qty, u.code as unit, m.base_qty, m.signed_base_qty,
       m.source_table, m.source_id, m.doc_no, m.party_id, m.created_by, m.created_at
from public.stock_movements m
join public.godowns g on g.id = m.godown_id
join public.storage_locations l on l.id = m.location_id
join public.units u on u.id = m.unit_id
union all
select r.company_id, 'RESERVATION', r.id, r.created_at::date, r.movement_type,
       r.item_id, r.godown_id, g.name, null, null,
       case when r.movement_type = 'RESERVATION' then 1 else -1 end::smallint, r.base_qty, iu.code, r.base_qty, 0,
       r.source_table, r.source_id, r.doc_no, null, r.created_by, r.created_at
from public.stock_reservation_movements r
join public.godowns g on g.id = r.godown_id
join public.items i on i.id = r.item_id
join public.units iu on iu.id = i.base_unit_id;
