-- =============================================================================
-- 0011 SALES — TRANSACTION_FLOWS §2; decisions Q-03, Q-20…Q-24
--   sales_orders       customer PO per ship-to (D-Mart DC), date revisions (Q-22)
--   dispatches         goods leaving a godown, partial allowed (Q-21)
--   customer_bills     tax invoice made in Tally, RECORDED here (Q-03); linkable
--                      to one or many orders / dispatches (Q-24)
--   sales_returns      goods returned by the customer
-- =============================================================================

create table public.sales_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  doc_no              text,
  doc_date            date not null,                                  -- PO date
  status              public.order_status not null default 'DRAFT',
  party_id            uuid not null references public.parties (id),
  ship_to_address_id  uuid references public.party_addresses (id),    -- DC
  customer_po_no      text not null,
  delivery_date       date,
  godown_id           uuid references public.godowns (id),            -- planned dispatch godown
  remarks             text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index sales_orders_doc_no_uq on public.sales_orders (company_id, doc_no) where doc_no is not null;
create unique index sales_orders_customer_po_uq on public.sales_orders (company_id, party_id, upper(customer_po_no), ship_to_address_id)
  where status <> 'CANCELLED';
create index sales_orders_delivery_idx on public.sales_orders (company_id, delivery_date);

create table public.sales_order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.sales_orders (id) on delete cascade,
  line_no           integer not null,
  item_id           uuid not null references public.items (id),
  qty               numeric(16,3) not null check (qty > 0),
  unit_id           uuid not null references public.units (id),
  factor_to_base    numeric(16,6) not null default 1,
  ordered_base_qty  numeric(16,3) not null default 0,
  rate              numeric(14,4) check (rate >= 0),
  unique (order_id, line_no),
  unique (order_id, item_id)
);

-- "revise" in the sheet = PO / delivery date changed (Q-22)
create table public.sales_order_date_revisions (
  id              uuid primary key default gen_random_uuid(),
  sales_order_id  uuid not null references public.sales_orders (id) on delete cascade,
  field           text not null check (field in ('PO_DATE', 'DELIVERY_DATE')),
  old_date        date,
  new_date        date not null,
  reason          text,
  revised_by      uuid,
  revised_at      timestamptz not null default now()
);
create index sales_order_date_revisions_idx on public.sales_order_date_revisions (sales_order_id, revised_at);

create table public.dispatches (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id),
  doc_no                text,
  doc_date              date not null,                 -- dispatch date
  status                public.doc_status not null default 'DRAFT',
  sales_order_id        uuid not null references public.sales_orders (id),
  godown_id             uuid not null references public.godowns (id),
  vehicle_no            text,
  transporter_party_id  uuid references public.parties (id),
  delivered_date        date,
  remarks               text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index dispatches_doc_no_uq on public.dispatches (company_id, doc_no) where doc_no is not null;
create index dispatches_order_idx on public.dispatches (sales_order_id);

create table public.dispatch_lines (
  id              uuid primary key default gen_random_uuid(),
  dispatch_id     uuid not null references public.dispatches (id) on delete cascade,
  line_no         integer not null,
  order_line_id   uuid not null references public.sales_order_lines (id),
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  unique (dispatch_id, line_no),
  unique (dispatch_id, order_line_id)
);
create index dispatch_lines_order_line_idx on public.dispatch_lines (order_line_id);

create table public.customer_bills (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  doc_no              text,                          -- = bill_no after posting
  doc_date            date not null,                 -- bill date
  status              public.doc_status not null default 'DRAFT',
  bill_no             text not null,                 -- as printed by Tally, e.g. T/26-27/070
  party_id            uuid not null references public.parties (id),
  ship_to_address_id  uuid references public.party_addresses (id),   -- "Place" (DC)
  amount              numeric(16,2) not null check (amount > 0),
  remarks             text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index customer_bills_no_uq on public.customer_bills (company_id, upper(bill_no)) where status <> 'CANCELLED';
create index customer_bills_party_idx on public.customer_bills (company_id, party_id, doc_date);

create table public.customer_bill_links (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.customer_bills (id) on delete cascade,
  line_no         integer not null,
  sales_order_id  uuid references public.sales_orders (id),
  dispatch_id     uuid references public.dispatches (id),
  unique (bill_id, line_no),
  check (sales_order_id is not null or dispatch_id is not null)
);

create table public.sales_returns (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.doc_status not null default 'DRAFT',
  party_id      uuid not null references public.parties (id),
  godown_id     uuid not null references public.godowns (id),
  customer_bill_id uuid references public.customer_bills (id),
  credit_amount numeric(16,2) not null default 0 check (credit_amount >= 0),   -- value credited to customer
  remarks       text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index sales_returns_doc_no_uq on public.sales_returns (company_id, doc_no) where doc_no is not null;

create table public.sales_return_lines (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.sales_returns (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  unique (return_id, line_no)
);

do $$
declare t text;
begin
  foreach t in array array['sales_orders', 'dispatches', 'customer_bills', 'sales_returns'] loop
    execute format('create trigger %1$s_audit_fields before insert or update on public.%1$s
                    for each row execute function app.tg_set_audit_fields()', t);
  end loop;
end $$;

insert into app.doc_types (doc_type, table_name, line_table, line_fk, perm_prefix, is_order, label) values
  ('SALES_ORDER',   'sales_orders',   'sales_order_lines',   'order_id',    'sales_order',   true,  'Sales order'),
  ('DISPATCH',      'dispatches',     'dispatch_lines',      'dispatch_id', 'dispatch',      false, 'Dispatch'),
  ('CUSTOMER_BILL', 'customer_bills', 'customer_bill_links', 'bill_id',     'customer_bill', false, 'Customer bill'),
  ('SALES_RETURN',  'sales_returns',  'sales_return_lines',  'return_id',   'sales_return',  false, 'Sales return');

-- -----------------------------------------------------------------------------
-- Sales order status
-- -----------------------------------------------------------------------------
create or replace function app.dispatched_qty(p_order_line_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(dl.base_qty), 0)
  from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
  where dl.order_line_id = p_order_line_id and d.status = 'POSTED'
$$;
grant execute on function app.dispatched_qty(uuid) to authenticated;

create or replace view public.v_sales_order_lines
with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no, o.customer_po_no, o.doc_date as po_date, o.delivery_date,
       o.status as order_status, o.party_id, p.name as party_name,
       o.ship_to_address_id, a.code as dc_code,
       exists (select 1 from public.sales_order_date_revisions r where r.sales_order_id = o.id) as is_revised,
       ol.id as order_line_id, ol.item_id, i.code as item_code, i.name as item_name,
       ol.ordered_base_qty, app.dispatched_qty(ol.id) as dispatched_base_qty,
       ol.ordered_base_qty - app.dispatched_qty(ol.id) as pending_base_qty,
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
end;
$$;

create or replace function app.post_sales_order(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.sales_orders; v_doc_no text;
begin
  select * into h from public.sales_orders where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  if not app.party_has_role(h.party_id, 'CUSTOMER') then
    raise exception 'Party is not set up as a customer' using errcode = 'P0001';
  end if;
  if h.ship_to_address_id is not null and not exists (
       select 1 from public.party_addresses where id = h.ship_to_address_id and party_id = h.party_id) then
    raise exception 'Delivery location does not belong to this customer' using errcode = 'P0001';
  end if;
  perform app.normalise_lines(app.doc_type('SALES_ORDER'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'SALES_ORDER', h.doc_date);
  update public.sales_orders set doc_no = v_doc_no, status = 'OPEN' where id = p_id;
  return app.result(p_id, v_doc_no, 'OPEN', null);
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
    raise exception 'Goods were already dispatched against this order; edit the quantity instead'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Date revision (Q-22): keeps history, audited.
create or replace function public.sales_order_revise_date(p_order_id uuid, p_field text, p_new_date date,
                                                          p_reason text default null)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.sales_orders; v_old date;
begin
  select * into o from public.sales_orders where id = p_order_id for update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Sales order not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'sales_order.edit');
  if o.status in ('CANCELLED') then
    raise exception 'Sales order is cancelled' using errcode = 'P0001';
  end if;
  if p_field = 'DELIVERY_DATE' then
    v_old := o.delivery_date;
    update public.sales_orders set delivery_date = p_new_date where id = o.id;
  elsif p_field = 'PO_DATE' then
    v_old := o.doc_date;
    update public.sales_orders set doc_date = p_new_date where id = o.id;
  else
    raise exception 'field must be PO_DATE or DELIVERY_DATE' using errcode = 'P0001';
  end if;
  insert into public.sales_order_date_revisions (sales_order_id, field, old_date, new_date, reason, revised_by)
  values (o.id, p_field, v_old, p_new_date, p_reason, auth.uid());
  perform app.audit(o.company_id, 'sales_orders', o.id::text, 'REVISE_DATE',
                    jsonb_build_object(p_field, v_old), jsonb_build_object(p_field, p_new_date, 'reason', p_reason));
end;
$$;

create or replace function public.sales_order_line_set_qty(p_order_line_id uuid, p_qty numeric,
                                                           p_unit_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare ol public.sales_order_lines; o public.sales_orders;
        v_unit uuid; v_factor numeric; v_base numeric; v_done numeric;
begin
  select * into ol from public.sales_order_lines where id = p_order_line_id for update;
  select * into o from public.sales_orders where id = ol.order_id for update;
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
  if v_base < v_done then
    raise exception 'Quantity cannot be less than already dispatched (%)',
      app.fmt_qty(ol.item_id, v_done, o.doc_date) using errcode = 'P0001';
  end if;
  update public.sales_order_lines set qty = p_qty, unit_id = v_unit, factor_to_base = v_factor,
         ordered_base_qty = v_base where id = ol.id;
  perform app.audit(o.company_id, 'sales_order_lines', ol.id::text, 'EDIT_QTY',
                    jsonb_build_object('base_qty', ol.ordered_base_qty), jsonb_build_object('base_qty', v_base));
  perform app.refresh_sales_order_status(o.id);
  return jsonb_build_object('order_line_id', ol.id, 'pending_base_qty', v_base - v_done);
end;
$$;

-- -----------------------------------------------------------------------------
-- Dispatch — stock OUT, partial allowed, never more than pending
-- -----------------------------------------------------------------------------
create or replace function app.post_dispatch(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h public.dispatches; o public.sales_orders; l public.dispatch_lines; ol public.sales_order_lines;
  v_doc_no text; v_pending numeric; v_warns text[] := '{}';
begin
  select * into h from public.dispatches where id = p_id;
  select * into o from public.sales_orders where id = h.sales_order_id for update;
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
    select * into ol from public.sales_order_lines where id = l.order_line_id for update;
    if ol.order_id <> o.id or ol.item_id <> l.item_id then
      raise exception 'Dispatch line does not match the sales order' using errcode = 'P0001';
    end if;
    v_pending := ol.ordered_base_qty - app.dispatched_qty(ol.id);
    if l.base_qty > v_pending then
      raise exception 'Dispatch quantity % is more than pending % on order %',
        app.fmt_qty(l.item_id, l.base_qty, h.doc_date), app.fmt_qty(l.item_id, greatest(v_pending, 0), h.doc_date),
        coalesce(o.customer_po_no, o.doc_no) using errcode = 'P0001';
    end if;
    v_warns := v_warns || app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'SALE_ISSUE',
                                         -1::smallint, l.qty, l.unit_id, l.factor_to_base, null, o.party_id,
                                         'dispatches', p_id, l.id, v_doc_no);
  end loop;

  update public.dispatches set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  perform app.refresh_sales_order_status(o.id);
  return app.result(p_id, v_doc_no, 'POSTED', array_remove(v_warns, null));
end;
$$;

create or replace function app.cancel_dispatch(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_order uuid;
begin
  if exists (select 1 from public.customer_bill_links bl join public.customer_bills b on b.id = bl.bill_id
             where bl.dispatch_id = p_id and b.status = 'POSTED') then
    raise exception 'This dispatch is linked to a customer bill; cancel the bill first' using errcode = 'P0001';
  end if;
  perform app.cancel_standard('dispatches', p_id, p_date);
  update public.dispatches set status = 'CANCELLED' where id = p_id returning sales_order_id into v_order;
  perform app.refresh_sales_order_status(v_order);
end;
$$;

-- Mark delivered (sheet: second STATUS column).
create or replace function public.dispatch_mark_delivered(p_dispatch_id uuid, p_delivered_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d public.dispatches;
begin
  select * into d from public.dispatches where id = p_dispatch_id for update;
  if d.id is null or not app.is_member(d.company_id) then
    raise exception 'Dispatch not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(d.company_id, 'dispatch.edit');
  if d.status <> 'POSTED' then
    raise exception 'Only posted dispatches can be marked delivered' using errcode = 'P0001';
  end if;
  update public.dispatches set delivered_date = p_delivered_date where id = d.id;
  perform app.audit(d.company_id, 'dispatches', d.id::text, 'DELIVERED', null,
                    jsonb_build_object('delivered_date', p_delivered_date));
end;
$$;

-- -----------------------------------------------------------------------------
-- Customer bill (recorded from Tally) — Debtors Dr / Sales Cr
-- -----------------------------------------------------------------------------
create or replace function app.post_customer_bill(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.customer_bills;
begin
  select * into h from public.customer_bills where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  if h.ship_to_address_id is not null and not exists (
       select 1 from public.party_addresses where id = h.ship_to_address_id and party_id = h.party_id) then
    raise exception 'Delivery location does not belong to this customer' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_bill_links bl
             left join public.sales_orders so on so.id = bl.sales_order_id
             left join public.dispatches d on d.id = bl.dispatch_id
             left join public.sales_orders dso on dso.id = d.sales_order_id
             where bl.bill_id = p_id
               and (coalesce(so.party_id, dso.party_id) <> h.party_id
                    or coalesce(so.company_id, d.company_id) <> h.company_id)) then
    raise exception 'Linked order / dispatch belongs to another customer' using errcode = 'P0001';
  end if;
  update public.customer_bills set doc_no = bill_no, status = 'POSTED' where id = p_id;
  perform app.post_journal(h.company_id, h.doc_date, 'customer_bills', p_id, h.bill_no,
    'Bill ' || h.bill_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_DEBTORS'),
                         'party_id', h.party_id, 'debit', h.amount),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SALES'), 'credit', h.amount)));
  return app.result(p_id, h.bill_no, 'POSTED', null);
end;
$$;

create or replace function app.cancel_customer_bill(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('customer_bills', p_id, p_date) $$;

-- -----------------------------------------------------------------------------
-- Sales return — stock IN, optional credit to the customer
-- -----------------------------------------------------------------------------
create or replace function app.post_sales_return(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.sales_returns; l public.sales_return_lines; v_doc_no text;
begin
  select * into h from public.sales_returns where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.assert_same_company(h.company_id, 'customer_bills', h.customer_bill_id);
  perform app.normalise_lines(app.doc_type('SALES_RETURN'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'SALES_RETURN', h.doc_date);
  for l in select * from public.sales_return_lines where return_id = p_id order by line_no loop
    perform app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'SALE_RETURN',
                           1::smallint, l.qty, l.unit_id, l.factor_to_base, null, h.party_id,
                           'sales_returns', p_id, l.id, v_doc_no);
  end loop;
  update public.sales_returns set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  perform app.post_journal(h.company_id, h.doc_date, 'sales_returns', p_id, v_doc_no,
    'Sales return ' || v_doc_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SALES'), 'debit', h.credit_amount),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_DEBTORS'),
                         'party_id', h.party_id, 'credit', h.credit_amount)));
  return app.result(p_id, v_doc_no, 'POSTED', null);
end;
$$;

create or replace function app.cancel_sales_return(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('sales_returns', p_id, p_date) $$;
