-- =============================================================================
-- 0008 JOB WORK (karigar) — TRANSACTION_FLOWS §4–6, §8–9
--   job_work_orders      Job-Work PO (GT-…), no rate (Q-06)
--   job_work_receipts    FG received, partial, rate per pair decided at receipt (Q-07)
--   material_issues      RM given to karigar ("GS" bill), no GST (Q-11), approval (Q-10)
--   job_work_returns     debit note: FG returned to karigar
-- Pending qty is ALWAYS derived from posted receipts (spec §16, BR-12).
-- Over-receipt is rejected; the PO qty can be edited instead (Q-04 / Q-05).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.job_work_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id),
  doc_no             text,
  doc_date           date not null,
  status             public.order_status not null default 'DRAFT',
  party_id           uuid not null references public.parties (id),
  lot_no             text,
  default_godown_id  uuid references public.godowns (id),
  expected_date      date,
  remarks            text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index job_work_orders_doc_no_uq on public.job_work_orders (company_id, doc_no) where doc_no is not null;
create index job_work_orders_party_idx on public.job_work_orders (company_id, party_id, status);

create table public.job_work_order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.job_work_orders (id) on delete cascade,
  line_no           integer not null,
  item_id           uuid not null references public.items (id),
  qty               numeric(16,3) not null check (qty > 0),
  unit_id           uuid not null references public.units (id),
  factor_to_base    numeric(16,6) not null default 1,
  ordered_base_qty  numeric(16,3) not null default 0,
  unique (order_id, line_no),
  unique (order_id, item_id)
);

create table public.job_work_receipts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  doc_no            text,
  doc_date          date not null,
  status            public.doc_status not null default 'DRAFT',
  party_id          uuid not null references public.parties (id),
  godown_id         uuid not null references public.godowns (id),
  challan_no        text,
  remarks           text,
  total_amount      numeric(16,2) not null default 0,
  has_missing_rate  boolean not null default false,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index job_work_receipts_doc_no_uq on public.job_work_receipts (company_id, doc_no) where doc_no is not null;
create index job_work_receipts_party_idx on public.job_work_receipts (company_id, party_id, doc_date);

create table public.job_work_receipt_lines (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.job_work_receipts (id) on delete cascade,
  line_no         integer not null,
  order_line_id   uuid not null references public.job_work_order_lines (id),
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  rate            numeric(14,4) check (rate >= 0),         -- per base unit (pair); null/0 allowed (Q-06)
  amount          numeric(16,2) not null default 0,
  unique (receipt_id, line_no),
  unique (receipt_id, order_line_id)
);
create index job_work_receipt_lines_order_line_idx on public.job_work_receipt_lines (order_line_id);

create table public.material_issues (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.doc_status not null default 'DRAFT',
  party_id      uuid not null references public.parties (id),
  godown_id     uuid not null references public.godowns (id),
  job_work_order_id uuid references public.job_work_orders (id),
  change_note   text,                                        -- sheet "CHANGES"
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
create unique index material_issues_doc_no_uq on public.material_issues (company_id, doc_no) where doc_no is not null;
create index material_issues_party_idx on public.material_issues (company_id, party_id, doc_date);

create table public.material_issue_lines (
  id              uuid primary key default gen_random_uuid(),
  issue_id        uuid not null references public.material_issues (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  rate            numeric(14,4) check (rate >= 0),
  amount          numeric(16,2) not null default 0,
  unique (issue_id, line_no)
);
create index material_issue_lines_item_idx on public.material_issue_lines (item_id);

create table public.job_work_returns (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  doc_no        text,
  doc_date      date not null,
  status        public.doc_status not null default 'DRAFT',
  party_id      uuid not null references public.parties (id),
  godown_id     uuid not null references public.godowns (id),
  job_work_order_id uuid references public.job_work_orders (id),
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
create unique index job_work_returns_doc_no_uq on public.job_work_returns (company_id, doc_no) where doc_no is not null;

create table public.job_work_return_lines (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.job_work_returns (id) on delete cascade,
  line_no         integer not null,
  item_id         uuid not null references public.items (id),
  qty             numeric(16,3) not null check (qty > 0),
  unit_id         uuid not null references public.units (id),
  factor_to_base  numeric(16,6) not null default 1,
  base_qty        numeric(16,3) not null default 0,
  rate            numeric(14,4) check (rate >= 0),
  amount          numeric(16,2) not null default 0,
  unique (return_id, line_no)
);

do $$
declare t text;
begin
  foreach t in array array['job_work_orders', 'job_work_receipts', 'material_issues', 'job_work_returns'] loop
    execute format('create trigger %1$s_audit_fields before insert or update on public.%1$s
                    for each row execute function app.tg_set_audit_fields()', t);
  end loop;
end $$;

insert into app.doc_types (doc_type, table_name, line_table, line_fk, perm_prefix, is_order, label) values
  ('JOB_WORK_ORDER',   'job_work_orders',   'job_work_order_lines',   'order_id',   'job_work_order',   true,  'Job-work PO'),
  ('JOB_WORK_RECEIPT', 'job_work_receipts', 'job_work_receipt_lines', 'receipt_id', 'job_work_receipt', false, 'Job-work receipt'),
  ('MATERIAL_ISSUE',   'material_issues',   'material_issue_lines',   'issue_id',   'material_issue',   false, 'Material issue'),
  ('JOB_WORK_RETURN',  'job_work_returns',  'job_work_return_lines',  'return_id',  'job_work_return',  false, 'Job-work debit note');

-- -----------------------------------------------------------------------------
-- Derived order-line status (replaces sheet PO ENTRY SALE / TOTAL ENTRY)
-- -----------------------------------------------------------------------------
create or replace function app.job_work_received(p_order_line_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(rl.base_qty), 0)
  from public.job_work_receipt_lines rl
  join public.job_work_receipts r on r.id = rl.receipt_id
  where rl.order_line_id = p_order_line_id and r.status = 'POSTED'
$$;

create or replace view public.v_job_work_order_lines
with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no as po_no, o.lot_no, o.doc_date as po_date,
       o.status as order_status, o.party_id, p.name as party_name,
       ol.id as order_line_id, ol.line_no, ol.item_id, i.code as item_code, i.name as item_name,
       ol.ordered_base_qty,
       coalesce(rc.received, 0) as received_base_qty,
       ol.ordered_base_qty - coalesce(rc.received, 0) as pending_base_qty,
       dp.factor as pack_factor,
       case when dp.factor is not null then round(ol.ordered_base_qty / dp.factor, 3) end as ordered_pack_qty,
       case when dp.factor is not null then round(coalesce(rc.received, 0) / dp.factor, 3) end as received_pack_qty,
       case when dp.factor is not null then round((ol.ordered_base_qty - coalesce(rc.received, 0)) / dp.factor, 3) end as pending_pack_qty,
       case when ol.ordered_base_qty - coalesce(rc.received, 0) <= 0 then 'ALL RECEIVED' else 'PENDING' end as line_status
from public.job_work_orders o
join public.job_work_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.parties p on p.id = o.party_id
left join lateral (
  select sum(rl.base_qty) as received
  from public.job_work_receipt_lines rl
  join public.job_work_receipts r on r.id = rl.receipt_id
  where rl.order_line_id = ol.id and r.status = 'POSTED') rc on true
left join lateral app.default_packing(i.id, current_date) dp on true
where o.status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED');

-- Only lines still pending (spec §20: fully received lines disappear).
create or replace view public.v_job_work_pending
with (security_invoker = true) as
select * from public.v_job_work_order_lines where pending_base_qty > 0;

create or replace function app.refresh_job_work_order_status(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_pending boolean; v_received boolean; v_status public.order_status;
begin
  select status into v_status from public.job_work_orders where id = p_order_id;
  if v_status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then return; end if;
  select bool_or(ol.ordered_base_qty - app.job_work_received(ol.id) > 0),
         bool_or(app.job_work_received(ol.id) > 0)
    into v_pending, v_received
  from public.job_work_order_lines ol where ol.order_id = p_order_id;
  update public.job_work_orders
     set status = case when not v_pending then 'FULLY_RECEIVED'
                       when v_received then 'PARTIALLY_RECEIVED'
                       else 'OPEN' end::public.order_status
   where id = p_order_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Job-Work PO
-- -----------------------------------------------------------------------------
create or replace function app.post_job_work_order(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.job_work_orders; v_doc_no text;
begin
  select * into h from public.job_work_orders where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.default_godown_id);
  if not app.party_has_role(h.party_id, 'JOB_WORKER') then
    raise exception 'Party is not set up as a job worker' using errcode = 'P0001';
  end if;
  perform app.normalise_lines(app.doc_type('JOB_WORK_ORDER'), p_id, h.doc_date);
  if exists (select 1 from public.job_work_order_lines l join public.items i on i.id = l.item_id
             where l.order_id = p_id and i.company_id <> h.company_id) then
    raise exception 'Item belongs to another company' using errcode = 'P0001';
  end if;
  v_doc_no := app.next_doc_no(h.company_id, 'JOB_WORK_ORDER', h.doc_date);
  update public.job_work_orders set doc_no = v_doc_no, status = 'OPEN' where id = p_id;
  return app.result(p_id, v_doc_no, 'OPEN', null);
end;
$$;

create or replace function app.cancel_job_work_order(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if exists (select 1 from public.job_work_order_lines ol
             where ol.order_id = p_id and app.job_work_received(ol.id) > 0) then
    raise exception 'Goods were already received against this PO; edit the quantity instead of cancelling'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Edit the ordered qty of a confirmed PO line (Q-04: increase; Q-05: reduce,
-- never below what is already received). Audited.
create or replace function public.job_work_order_line_set_qty(p_order_line_id uuid, p_qty numeric,
                                                              p_unit_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  ol  public.job_work_order_lines;
  o   public.job_work_orders;
  v_unit uuid; v_factor numeric; v_base numeric; v_received numeric;
begin
  select * into ol from public.job_work_order_lines where id = p_order_line_id for update;
  select * into o from public.job_work_orders where id = ol.order_id for update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'PO line not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'job_work_order.edit');
  if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then
    raise exception 'PO is % and cannot be edited this way', o.status using errcode = 'P0001';
  end if;
  v_unit := coalesce(p_unit_id, ol.unit_id);
  v_factor := app.unit_factor(ol.item_id, v_unit, o.doc_date);
  v_base := round(p_qty * v_factor, 3);
  v_received := app.job_work_received(ol.id);
  if p_qty <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = 'P0001';
  end if;
  if v_base < v_received then
    raise exception 'Quantity cannot be less than already received (%)',
      app.fmt_qty(ol.item_id, v_received, o.doc_date) using errcode = 'P0001';
  end if;
  update public.job_work_order_lines
     set qty = p_qty, unit_id = v_unit, factor_to_base = v_factor, ordered_base_qty = v_base
   where id = ol.id;
  perform app.audit(o.company_id, 'job_work_order_lines', ol.id::text, 'EDIT_QTY',
                    jsonb_build_object('qty', ol.qty, 'unit_id', ol.unit_id, 'base_qty', ol.ordered_base_qty),
                    jsonb_build_object('qty', p_qty, 'unit_id', v_unit, 'base_qty', v_base));
  perform app.refresh_job_work_order_status(o.id);
  return jsonb_build_object('order_line_id', ol.id, 'ordered_base_qty', v_base,
                            'received_base_qty', v_received, 'pending_base_qty', v_base - v_received);
end;
$$;

-- Add an item to a confirmed PO (order edit, Q-04).
create or replace function public.job_work_order_add_line(p_order_id uuid, p_item_id uuid,
                                                          p_qty numeric, p_unit_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.job_work_orders; v_id uuid; v_factor numeric; v_line int;
begin
  select * into o from public.job_work_orders where id = p_order_id for update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'PO not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'job_work_order.edit');
  if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then
    raise exception 'PO is % and cannot be edited this way', o.status using errcode = 'P0001';
  end if;
  perform app.assert_same_company(o.company_id, 'items', p_item_id);
  if p_qty <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = 'P0001';
  end if;
  v_factor := app.unit_factor(p_item_id, p_unit_id, o.doc_date);
  select coalesce(max(line_no), 0) + 1 into v_line from public.job_work_order_lines where order_id = o.id;
  insert into public.job_work_order_lines (order_id, line_no, item_id, qty, unit_id, factor_to_base, ordered_base_qty)
  values (o.id, v_line, p_item_id, p_qty, p_unit_id, v_factor, round(p_qty * v_factor, 3))
  returning id into v_id;
  perform app.audit(o.company_id, 'job_work_order_lines', v_id::text, 'ADD_LINE', null,
                    jsonb_build_object('item_id', p_item_id, 'qty', p_qty));
  perform app.refresh_job_work_order_status(o.id);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Job-Work Receipt (FG from karigar) — TRANSACTION_FLOWS §5.2
-- -----------------------------------------------------------------------------
create or replace function app.post_job_work_receipt(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h          public.job_work_receipts;
  l          record;
  ol         public.job_work_order_lines;
  o          public.job_work_orders;
  v_doc_no   text;
  v_pending  numeric;
  v_warn     text;
  v_warns    text[] := '{}';
  v_total    numeric;
  v_missing  boolean;
  v_orders   uuid[] := '{}';
  v_item     text;
begin
  select * into h from public.job_work_receipts where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('JOB_WORK_RECEIPT'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'JOB_WORK_RECEIPT', h.doc_date);

  for l in select * from public.job_work_receipt_lines where receipt_id = p_id order by order_line_id loop
    -- Lock the PO line: concurrent receipts of the same line are serialised.
    select * into ol from public.job_work_order_lines where id = l.order_line_id for update;
    select * into o from public.job_work_orders where id = ol.order_id;
    select name into v_item from public.items where id = ol.item_id;
    if o.company_id <> h.company_id or o.party_id <> h.party_id then
      raise exception 'PO line does not belong to this job worker' using errcode = 'P0001';
    end if;
    if o.status not in ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED') then
      raise exception 'PO % is %', o.doc_no, o.status using errcode = 'P0001';
    end if;
    if l.item_id <> ol.item_id then
      raise exception 'Item does not match the PO line' using errcode = 'P0001';
    end if;
    v_pending := ol.ordered_base_qty - app.job_work_received(ol.id);
    if l.base_qty > v_pending then
      raise exception 'Receive quantity % is more than pending % for % on PO % — edit the PO quantity first',
        app.fmt_qty(l.item_id, l.base_qty, h.doc_date), app.fmt_qty(l.item_id, greatest(v_pending, 0), h.doc_date),
        v_item, o.doc_no using errcode = 'P0001';
    end if;

    v_warn := app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'JOB_WORK_RECEIPT',
                             1::smallint, l.qty, l.unit_id, l.factor_to_base, l.rate, h.party_id,
                             'job_work_receipts', p_id, l.id, v_doc_no);
    v_warns := v_warns || app.post_consumption(h.company_id, l.item_id, h.godown_id, h.doc_date,
                                               l.base_qty, 'JOB_WORK', 'job_work_receipts', p_id, l.id, v_doc_no);
    if not o.id = any (v_orders) then v_orders := v_orders || o.id; end if;
  end loop;

  select coalesce(sum(amount), 0), bool_or(coalesce(rate, 0) = 0)
    into v_total, v_missing
  from public.job_work_receipt_lines where receipt_id = p_id;

  update public.job_work_receipts
     set doc_no = v_doc_no, status = 'POSTED', total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;

  -- Payable to karigar (purchase-ledger side). A 0-amount receipt creates no journal (Q-06).
  perform app.post_journal(h.company_id, h.doc_date, 'job_work_receipts', p_id, v_doc_no,
    'Job-work receipt ' || v_doc_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'JOB_WORK_CHARGES'), 'debit', v_total),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'),
                         'party_id', h.party_id, 'credit', v_total)));

  for i in 1 .. coalesce(array_length(v_orders, 1), 0) loop
    perform app.refresh_job_work_order_status(v_orders[i]);
  end loop;
  if v_missing then v_warns := v_warns || 'Rate is missing on one or more lines'::text; end if;
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_job_work_receipt(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_order uuid;
begin
  perform app.cancel_standard('job_work_receipts', p_id, p_date);
  -- status changes to CANCELLED after this function; refresh uses posted receipts only
  update public.job_work_receipts set status = 'CANCELLED' where id = p_id;
  for v_order in select distinct ol.order_id from public.job_work_receipt_lines rl
                 join public.job_work_order_lines ol on ol.id = rl.order_line_id
                 where rl.receipt_id = p_id loop
    perform app.refresh_job_work_order_status(v_order);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Material issue to karigar (GS bill) — TRANSACTION_FLOWS §8
-- -----------------------------------------------------------------------------
create or replace function app.post_material_issue(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.material_issues;
  l        public.material_issue_lines;
  v_doc_no text;
  v_warn   text;
  v_warns  text[] := '{}';
  v_total  numeric;
  v_missing boolean;
begin
  select * into h from public.material_issues where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.assert_same_company(h.company_id, 'job_work_orders', h.job_work_order_id);
  perform app.normalise_lines(app.doc_type('MATERIAL_ISSUE'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'MATERIAL_ISSUE', h.doc_date);

  for l in select * from public.material_issue_lines where issue_id = p_id order by line_no loop
    v_warn := app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'JOB_WORK_ISSUE',
                             -1::smallint, l.qty, l.unit_id, l.factor_to_base, l.rate, h.party_id,
                             'material_issues', p_id, l.id, v_doc_no);
    if v_warn is not null then v_warns := v_warns || v_warn; end if;
  end loop;

  select coalesce(sum(amount), 0), bool_or(coalesce(rate, 0) = 0) into v_total, v_missing
  from public.material_issue_lines where issue_id = p_id;
  update public.material_issues
     set doc_no = v_doc_no, status = 'POSTED', total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;

  -- Receivable from karigar (sale-ledger side), no GST (Q-11).
  perform app.post_journal(h.company_id, h.doc_date, 'material_issues', p_id, v_doc_no,
    'Material issue ' || v_doc_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_DEBTORS'),
                         'party_id', h.party_id, 'debit', v_total),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'MATERIAL_ISSUED_TO_JW'), 'credit', v_total)));
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_material_issue(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('material_issues', p_id, p_date) $$;

-- -----------------------------------------------------------------------------
-- Debit note — FG returned to karigar (TRANSACTION_FLOWS §9)
-- -----------------------------------------------------------------------------
create or replace function app.post_job_work_return(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.job_work_returns;
  l        public.job_work_return_lines;
  v_doc_no text;
  v_warn   text;
  v_warns  text[] := '{}';
  v_total  numeric;
  v_missing boolean;
begin
  select * into h from public.job_work_returns where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.assert_same_company(h.company_id, 'job_work_orders', h.job_work_order_id);
  perform app.normalise_lines(app.doc_type('JOB_WORK_RETURN'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'JOB_WORK_RETURN', h.doc_date);

  for l in select * from public.job_work_return_lines where return_id = p_id order by line_no loop
    v_warn := app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'JOB_WORK_RETURN',
                             -1::smallint, l.qty, l.unit_id, l.factor_to_base, l.rate, h.party_id,
                             'job_work_returns', p_id, l.id, v_doc_no);
    if v_warn is not null then v_warns := v_warns || v_warn; end if;
  end loop;

  select coalesce(sum(amount), 0), bool_or(coalesce(rate, 0) = 0) into v_total, v_missing
  from public.job_work_return_lines where return_id = p_id;
  update public.job_work_returns
     set doc_no = v_doc_no, status = 'POSTED', total_amount = v_total, has_missing_rate = v_missing
   where id = p_id;

  perform app.post_journal(h.company_id, h.doc_date, 'job_work_returns', p_id, v_doc_no,
    'Debit note ' || v_doc_no,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'),
                         'party_id', h.party_id, 'debit', v_total),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'JOB_WORK_CHARGES'), 'credit', v_total)));
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_job_work_return(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('job_work_returns', p_id, p_date) $$;
