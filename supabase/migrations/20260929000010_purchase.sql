-- =============================================================================
-- 0010 PURCHASE — TRANSACTION_FLOWS §3, §10.1; decisions Q-14…Q-17, Q-28
--   purchase_orders    optional RM PO (Q-16), partial receiving
--   purchase_receipts  RM receipt with or without PO; GST as input credit (Q-15)
--   purchase_returns   return to supplier (Q-17)
--   service_bills      cutting charges (Q-14), freight / transport (Q-28), other
-- Rates are per BASE unit of the item; GST is on the taxable value.
-- =============================================================================

create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.order_status not null default 'DRAFT',
  party_id      uuid not null references public.parties (id),
  godown_id     uuid references public.godowns (id),
  expected_date date,
  remarks       text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index purchase_orders_doc_no_uq on public.purchase_orders (company_id, doc_no) where doc_no is not null;

create table public.purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.purchase_orders (id) on delete cascade,
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

create table public.purchase_receipts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id),
  doc_no             text,
  doc_date           date not null,
  status             public.doc_status not null default 'DRAFT',
  party_id           uuid not null references public.parties (id),
  godown_id          uuid not null references public.godowns (id),
  supplier_bill_no   text,
  supplier_bill_date date,
  remarks            text,
  taxable_amount     numeric(16,2) not null default 0,
  gst_amount         numeric(16,2) not null default 0,
  total_amount       numeric(16,2) not null default 0,
  has_missing_rate   boolean not null default false,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index purchase_receipts_doc_no_uq on public.purchase_receipts (company_id, doc_no) where doc_no is not null;
create index purchase_receipts_party_idx on public.purchase_receipts (company_id, party_id, doc_date);

create table public.purchase_receipt_lines (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.purchase_receipts (id) on delete cascade,
  line_no         integer not null,
  po_line_id      uuid references public.purchase_order_lines (id),      -- optional (Q-16)
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  rate            numeric(14,4) check (rate >= 0),
  gst_rate        numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  taxable_amount  numeric(16,2) not null default 0,
  gst_amount      numeric(16,2) not null default 0,
  amount          numeric(16,2) not null default 0,
  unique (receipt_id, line_no)
);
create index purchase_receipt_lines_po_line_idx on public.purchase_receipt_lines (po_line_id) where po_line_id is not null;

create table public.purchase_returns (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.doc_status not null default 'DRAFT',
  party_id      uuid not null references public.parties (id),
  godown_id     uuid not null references public.godowns (id),
  purchase_receipt_id uuid references public.purchase_receipts (id),
  remarks       text,
  taxable_amount numeric(16,2) not null default 0,
  gst_amount    numeric(16,2) not null default 0,
  total_amount  numeric(16,2) not null default 0,
  has_missing_rate boolean not null default false,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index purchase_returns_doc_no_uq on public.purchase_returns (company_id, doc_no) where doc_no is not null;

create table public.purchase_return_lines (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.purchase_returns (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  rate            numeric(14,4) check (rate >= 0),
  gst_rate        numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  taxable_amount  numeric(16,2) not null default 0,
  gst_amount      numeric(16,2) not null default 0,
  amount          numeric(16,2) not null default 0,
  unique (return_id, line_no)
);

-- Service bills: cutting (Q-14), freight / transport (Q-28), other expenses
-- billed by a party. No stock effect.
create table public.service_bills (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  doc_no              text,
  doc_date            date not null,
  status              public.doc_status not null default 'DRAFT',
  bill_type           text not null check (bill_type in ('CUTTING', 'FREIGHT', 'OTHER')),
  party_id            uuid not null references public.parties (id),
  expense_account_id  uuid references public.accounts (id),       -- required for OTHER
  supplier_bill_no    text,
  reference           text,                                     -- e.g. dispatch / vehicle no
  remarks             text,
  taxable_amount      numeric(16,2) not null default 0,
  gst_amount          numeric(16,2) not null default 0,
  total_amount        numeric(16,2) not null default 0,
  has_missing_rate    boolean not null default false,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index service_bills_doc_no_uq on public.service_bills (company_id, doc_no) where doc_no is not null;
create index service_bills_party_idx on public.service_bills (company_id, party_id, doc_date);

create table public.service_bill_lines (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.service_bills (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid references public.items (id),           -- e.g. the material that was cut
  description     text,
  qty             numeric(16,3) not null check (qty > 0),
  rate            numeric(14,4) check (rate >= 0),
  gst_rate        numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  taxable_amount  numeric(16,2) not null default 0,
  gst_amount      numeric(16,2) not null default 0,
  amount          numeric(16,2) not null default 0,
  unique (bill_id, line_no),
  check (item_id is not null or coalesce(trim(description), '') <> '')
);

do $$
declare t text;
begin
  foreach t in array array['purchase_orders', 'purchase_receipts', 'purchase_returns', 'service_bills'] loop
    execute format('create trigger %1$s_audit_fields before insert or update on public.%1$s
                    for each row execute function app.tg_set_audit_fields()', t);
  end loop;
end $$;

insert into app.doc_types (doc_type, table_name, line_table, line_fk, perm_prefix, is_order, label) values
  ('PURCHASE_ORDER',   'purchase_orders',   'purchase_order_lines',   'order_id',   'purchase_order',   true,  'Purchase order'),
  ('PURCHASE_RECEIPT', 'purchase_receipts', 'purchase_receipt_lines', 'receipt_id', 'purchase_receipt', false, 'Purchase receipt'),
  ('PURCHASE_RETURN',  'purchase_returns',  'purchase_return_lines',  'return_id',  'purchase_return',  false, 'Purchase return'),
  ('SERVICE_BILL',     'service_bills',     'service_bill_lines',     'bill_id',    'service_bill',     false, 'Service bill');

-- -----------------------------------------------------------------------------
-- GST split on lines after app.normalise_lines has set amount = qty × rate.
-- -----------------------------------------------------------------------------
create or replace function app.apply_gst(p_line_table text, p_fk text, p_header_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  execute format(
    'update public.%1$I set taxable_amount = amount,
                            gst_amount = round(amount * gst_rate / 100, 2),
                            amount = amount + round(amount * gst_rate / 100, 2)
     where %2$I = $1', p_line_table, p_fk)
  using p_header_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Purchase order
-- -----------------------------------------------------------------------------
create or replace function app.purchase_received(p_po_line_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(rl.base_qty), 0)
  from public.purchase_receipt_lines rl
  join public.purchase_receipts r on r.id = rl.receipt_id
  where rl.po_line_id = p_po_line_id and r.status = 'POSTED'
$$;

create or replace view public.v_purchase_order_lines
with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no as po_no, o.doc_date as po_date, o.status as order_status,
       o.party_id, p.name as party_name, ol.id as po_line_id, ol.item_id, i.name as item_name,
       ol.ordered_base_qty, app.purchase_received(ol.id) as received_base_qty,
       ol.ordered_base_qty - app.purchase_received(ol.id) as pending_base_qty, ol.rate
from public.purchase_orders o
join public.purchase_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.parties p on p.id = o.party_id
where o.status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED');
grant execute on function app.purchase_received(uuid) to authenticated;

create or replace function app.refresh_purchase_order_status(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_pending boolean; v_received boolean; v_status public.order_status;
begin
  select status into v_status from public.purchase_orders where id = p_order_id;
  if v_status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then return; end if;
  select bool_or(ol.ordered_base_qty - app.purchase_received(ol.id) > 0),
         bool_or(app.purchase_received(ol.id) > 0)
    into v_pending, v_received
  from public.purchase_order_lines ol where ol.order_id = p_order_id;
  update public.purchase_orders
     set status = case when not v_pending then 'FULLY_RECEIVED'
                       when v_received then 'PARTIALLY_RECEIVED'
                       else 'OPEN' end::public.order_status
   where id = p_order_id;
end;
$$;

create or replace function app.post_purchase_order(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.purchase_orders; v_doc_no text;
begin
  select * into h from public.purchase_orders where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('PURCHASE_ORDER'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'PURCHASE_ORDER', h.doc_date);
  update public.purchase_orders set doc_no = v_doc_no, status = 'OPEN' where id = p_id;
  return app.result(p_id, v_doc_no, 'OPEN', null);
end;
$$;

create or replace function app.cancel_purchase_order(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if exists (select 1 from public.purchase_order_lines ol
             where ol.order_id = p_id and app.purchase_received(ol.id) > 0) then
    raise exception 'Goods were already received against this PO; edit the quantity instead of cancelling'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.purchase_order_line_set_qty(p_po_line_id uuid, p_qty numeric,
                                                              p_unit_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare ol public.purchase_order_lines; o public.purchase_orders;
        v_unit uuid; v_factor numeric; v_base numeric; v_received numeric;
begin
  select * into ol from public.purchase_order_lines where id = p_po_line_id for no key update;
  select * into o from public.purchase_orders where id = ol.order_id for no key update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'PO line not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'purchase_order.edit');
  if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') or p_qty <= 0 then
    raise exception 'PO cannot be edited (status %, qty %)', o.status, p_qty using errcode = 'P0001';
  end if;
  v_unit := coalesce(p_unit_id, ol.unit_id);
  v_factor := app.unit_factor(ol.item_id, v_unit, o.doc_date);
  v_base := round(p_qty * v_factor, 3);
  v_received := app.purchase_received(ol.id);
  if v_base < v_received then
    raise exception 'Quantity cannot be less than already received (%)',
      app.fmt_qty(ol.item_id, v_received, o.doc_date) using errcode = 'P0001';
  end if;
  update public.purchase_order_lines set qty = p_qty, unit_id = v_unit, factor_to_base = v_factor,
         ordered_base_qty = v_base where id = ol.id;
  perform app.audit(o.company_id, 'purchase_order_lines', ol.id::text, 'EDIT_QTY',
                    jsonb_build_object('base_qty', ol.ordered_base_qty), jsonb_build_object('base_qty', v_base));
  perform app.refresh_purchase_order_status(o.id);
  return jsonb_build_object('po_line_id', ol.id, 'pending_base_qty', v_base - v_received);
end;
$$;

-- -----------------------------------------------------------------------------
-- Purchase receipt (with or without PO)
-- -----------------------------------------------------------------------------
create or replace function app.post_purchase_receipt(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h         public.purchase_receipts;
  l         public.purchase_receipt_lines;
  ol        public.purchase_order_lines;
  o         public.purchase_orders;
  v_doc_no  text;
  v_pending numeric;
  v_warns   text[] := '{}';
  v_orders  uuid[] := '{}';
  v_taxable numeric; v_gst numeric; v_total numeric; v_missing boolean;
begin
  select * into h from public.purchase_receipts where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('PURCHASE_RECEIPT'), p_id, h.doc_date);
  perform app.apply_gst('purchase_receipt_lines', 'receipt_id', p_id);
  v_doc_no := app.next_doc_no(h.company_id, 'PURCHASE_RECEIPT', h.doc_date);

  for l in select * from public.purchase_receipt_lines where receipt_id = p_id order by po_line_id nulls last, line_no loop
    if l.po_line_id is not null then
      select * into ol from public.purchase_order_lines where id = l.po_line_id for no key update;
      select * into o from public.purchase_orders where id = ol.order_id;
      if o.company_id <> h.company_id or o.party_id <> h.party_id or ol.item_id <> l.item_id then
        raise exception 'PO line does not match this supplier / item' using errcode = 'P0001';
      end if;
      if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then
        raise exception 'PO % is %', o.doc_no, o.status using errcode = 'P0001';
      end if;
      v_pending := ol.ordered_base_qty - app.purchase_received(ol.id);
      if l.base_qty > v_pending then
        raise exception 'Receive quantity % is more than pending % on PO % — edit the PO quantity first',
          app.fmt_qty(l.item_id, l.base_qty, h.doc_date), app.fmt_qty(l.item_id, greatest(v_pending, 0), h.doc_date),
          o.doc_no using errcode = 'P0001';
      end if;
      if not o.id = any (v_orders) then v_orders := v_orders || o.id; end if;
    end if;
    v_warns := v_warns || app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'PURCHASE_RECEIPT',
                                         1::smallint, l.qty, l.unit_id, l.factor_to_base, l.rate, h.party_id,
                                         'purchase_receipts', p_id, l.id, v_doc_no);
  end loop;

  select coalesce(sum(taxable_amount), 0), coalesce(sum(gst_amount), 0), coalesce(sum(amount), 0),
         bool_or(coalesce(rate, 0) = 0)
    into v_taxable, v_gst, v_total, v_missing
  from public.purchase_receipt_lines where receipt_id = p_id;
  update public.purchase_receipts
     set doc_no = v_doc_no, status = 'POSTED', taxable_amount = v_taxable, gst_amount = v_gst,
         total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;

  perform app.post_journal(h.company_id, h.doc_date, 'purchase_receipts', p_id, v_doc_no,
    'Purchase ' || v_doc_no || coalesce(' / bill ' || h.supplier_bill_no, ''),
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'PURCHASE'), 'debit', v_taxable),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'INPUT_GST'), 'debit', v_gst),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'),
                         'party_id', h.party_id, 'credit', v_total)));

  for i in 1 .. coalesce(array_length(v_orders, 1), 0) loop
    perform app.refresh_purchase_order_status(v_orders[i]);
  end loop;
  return app.result(p_id, v_doc_no, 'POSTED', array_remove(v_warns, null));
end;
$$;

create or replace function app.cancel_purchase_receipt(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_order uuid;
begin
  perform app.cancel_standard('purchase_receipts', p_id, p_date);
  update public.purchase_receipts set status = 'CANCELLED' where id = p_id;
  for v_order in select distinct ol.order_id from public.purchase_receipt_lines rl
                 join public.purchase_order_lines ol on ol.id = rl.po_line_id
                 where rl.receipt_id = p_id loop
    perform app.refresh_purchase_order_status(v_order);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Purchase return
-- -----------------------------------------------------------------------------
create or replace function app.post_purchase_return(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h public.purchase_returns; l public.purchase_return_lines; v_doc_no text; v_warns text[] := '{}';
  v_taxable numeric; v_gst numeric; v_total numeric; v_missing boolean;
begin
  select * into h from public.purchase_returns where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.assert_same_company(h.company_id, 'purchase_receipts', h.purchase_receipt_id);
  perform app.normalise_lines(app.doc_type('PURCHASE_RETURN'), p_id, h.doc_date);
  perform app.apply_gst('purchase_return_lines', 'return_id', p_id);
  v_doc_no := app.next_doc_no(h.company_id, 'PURCHASE_RETURN', h.doc_date);
  for l in select * from public.purchase_return_lines where return_id = p_id order by line_no loop
    v_warns := v_warns || app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'PURCHASE_RETURN',
                                         -1::smallint, l.qty, l.unit_id, l.factor_to_base, l.rate, h.party_id,
                                         'purchase_returns', p_id, l.id, v_doc_no);
  end loop;
  select coalesce(sum(taxable_amount), 0), coalesce(sum(gst_amount), 0), coalesce(sum(amount), 0),
         bool_or(coalesce(rate, 0) = 0)
    into v_taxable, v_gst, v_total, v_missing
  from public.purchase_return_lines where return_id = p_id;
  update public.purchase_returns
     set doc_no = v_doc_no, status = 'POSTED', taxable_amount = v_taxable, gst_amount = v_gst,
         total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;
  perform app.post_journal(h.company_id, h.doc_date, 'purchase_returns', p_id, v_doc_no,
    'Purchase return ' || v_doc_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'),
                         'party_id', h.party_id, 'debit', v_total),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'PURCHASE'), 'credit', v_taxable),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'INPUT_GST'), 'credit', v_gst)));
  return app.result(p_id, v_doc_no, 'POSTED', array_remove(v_warns, null));
end;
$$;

create or replace function app.cancel_purchase_return(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('purchase_returns', p_id, p_date) $$;

-- -----------------------------------------------------------------------------
-- Service bill (cutting / freight / other) — no stock effect
-- -----------------------------------------------------------------------------
create or replace function app.post_service_bill(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h public.service_bills; v_doc_no text; v_expense uuid;
  v_taxable numeric; v_gst numeric; v_total numeric; v_missing boolean;
begin
  select * into h from public.service_bills where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'accounts', h.expense_account_id);
  if exists (select 1 from public.service_bill_lines l join public.items i on i.id = l.item_id
             where l.bill_id = p_id and i.company_id <> h.company_id) then
    raise exception 'Item belongs to another company' using errcode = 'P0001';
  end if;
  v_expense := coalesce(h.expense_account_id,
                        case h.bill_type when 'CUTTING' then app.account_id(h.company_id, 'CUTTING_CHARGES')
                                         when 'FREIGHT' then app.account_id(h.company_id, 'FREIGHT') end);
  if v_expense is null then
    raise exception 'Choose the expense account for this bill' using errcode = 'P0001';
  end if;
  update public.service_bill_lines
     set taxable_amount = round(qty * coalesce(rate, 0), 2),
         gst_amount = round(round(qty * coalesce(rate, 0), 2) * gst_rate / 100, 2),
         amount = round(qty * coalesce(rate, 0), 2) + round(round(qty * coalesce(rate, 0), 2) * gst_rate / 100, 2)
   where bill_id = p_id;
  select coalesce(sum(taxable_amount), 0), coalesce(sum(gst_amount), 0), coalesce(sum(amount), 0),
         bool_or(coalesce(rate, 0) = 0)
    into v_taxable, v_gst, v_total, v_missing
  from public.service_bill_lines where bill_id = p_id;
  v_doc_no := app.next_doc_no(h.company_id, 'SERVICE_BILL', h.doc_date);
  update public.service_bills
     set doc_no = v_doc_no, status = 'POSTED', taxable_amount = v_taxable, gst_amount = v_gst,
         total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;
  perform app.post_journal(h.company_id, h.doc_date, 'service_bills', p_id, v_doc_no,
    initcap(h.bill_type) || ' bill ' || v_doc_no || coalesce(' / ' || h.supplier_bill_no, ''),
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense, 'debit', v_taxable),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'INPUT_GST'), 'debit', v_gst),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'),
                         'party_id', h.party_id, 'credit', v_total)));
  return app.result(p_id, v_doc_no, 'POSTED', null);
end;
$$;

create or replace function app.cancel_service_bill(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('service_bills', p_id, p_date) $$;
