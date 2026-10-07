-- =============================================================================
-- INVENTORY MVP — purchase PO receiving into rack/bin, PO close, pending
-- receiving list, bill due dates, payment methods (§18–20, §28)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Purchase receiving into a location (§20)
-- -----------------------------------------------------------------------------
alter table public.purchase_receipt_lines
  add column location_id uuid references public.storage_locations (id);

alter table public.purchase_orders
  add column closed_at timestamptz,
  add column closed_by uuid,
  add column close_reason text;

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
      if o.status not in ('OPEN', 'PARTIALLY_RECEIVED') then
        raise exception 'PO % is % — nothing can be received against it', o.doc_no, o.status using errcode = 'P0001';
      end if;
      v_pending := ol.ordered_base_qty - app.purchase_received(ol.id);
      if l.base_qty > v_pending then
        raise exception 'Over-receiving rejected: receive quantity % is more than pending % on PO %',
          app.fmt_qty(l.item_id, l.base_qty, h.doc_date), app.fmt_qty(l.item_id, greatest(v_pending, 0), h.doc_date),
          o.doc_no using errcode = 'P0001';
      end if;
      if not o.id = any (v_orders) then v_orders := v_orders || o.id; end if;
    end if;
    v_warns := v_warns || app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date, 'PURCHASE_RECEIPT',
                                         1::smallint, l.qty, l.unit_id, l.factor_to_base, l.rate, h.party_id,
                                         'purchase_receipts', p_id, l.id, v_doc_no, l.location_id);
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
  perform app.audit(h.company_id, 'purchase_receipts', p_id::text, 'POST', null,
                    jsonb_build_object('doc_no', v_doc_no, 'purchase_orders', to_jsonb(v_orders)));
  return app.result(p_id, v_doc_no, 'POSTED', array_remove(v_warns, null));
end;
$$;

-- Close a PO that will not be fully supplied: pending lines leave the
-- receiving screen, status CLOSED.
create or replace function public.purchase_order_close(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.purchase_orders;
begin
  select * into o from public.purchase_orders where id = p_order_id for no key update;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Purchase order not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'purchase_order.cancel');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to close the PO' using errcode = 'P0001';
  end if;
  if o.status not in ('OPEN', 'PARTIALLY_RECEIVED') then
    raise exception 'Only open POs can be closed (status %)', o.status using errcode = 'P0001';
  end if;
  update public.purchase_orders set status = 'CLOSED', closed_at = now(), closed_by = auth.uid(),
         close_reason = p_reason where id = o.id;
  perform app.audit(o.company_id, 'purchase_orders', o.id::text, 'CLOSE', null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('id', o.id, 'status', 'CLOSED');
end;
$$;

drop view public.v_purchase_order_lines;
create view public.v_purchase_order_lines
with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no as po_no, o.doc_date as po_date, o.expected_date,
       o.status as order_status, o.party_id, p.name as party_name, o.godown_id,
       ol.id as po_line_id, ol.line_no, ol.item_id, i.code as item_code, i.name as item_name,
       ol.qty, u.code as unit, ol.rate,
       ol.ordered_base_qty, app.purchase_received(ol.id) as received_base_qty,
       ol.ordered_base_qty - app.purchase_received(ol.id) as pending_base_qty
from public.purchase_orders o
join public.purchase_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.units u on u.id = ol.unit_id
join public.parties p on p.id = o.party_id
where o.status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED');

-- Pending receiving screen (§19): only lines still pending on OPEN /
-- PARTIALLY_RECEIVED POs. Fully received lines disappear.
create or replace view public.v_purchase_pending_lines
with (security_invoker = true) as
select * from public.v_purchase_order_lines
where order_status in ('OPEN', 'PARTIALLY_RECEIVED') and pending_base_qty > 0;

-- -----------------------------------------------------------------------------
-- Due dates on bills (§29–31): default = bill date + party credit days.
-- -----------------------------------------------------------------------------
alter table public.customer_bills    add column due_date date;
alter table public.purchase_receipts add column due_date date;
alter table public.service_bills     add column due_date date;
alter table public.job_work_receipts add column due_date date;

create or replace function app.tg_default_due_date()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.due_date is null and new.party_id is not null and new.doc_date is not null then
    new.due_date := new.doc_date + coalesce((select credit_days from public.parties where id = new.party_id), 0);
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['customer_bills', 'purchase_receipts', 'service_bills', 'job_work_receipts'] loop
    execute format('create trigger %1$s_due_date before insert or update on public.%1$s
                    for each row execute function app.tg_default_due_date()', t);
    execute format('update public.%1$I set due_date = doc_date + coalesce((select credit_days from public.parties
                    where id = %1$I.party_id), 0) where due_date is null', t);
  end loop;
end $$;

drop view public.v_bill_outstanding;
drop view public.v_bills;
create view public.v_bills
with (security_invoker = true) as
select 'customer_bills'::text as bill_table, b.id as bill_id, b.company_id, b.party_id, b.doc_no, b.doc_date,
       b.amount as bill_amount, 'RECEIVABLE'::text as side, b.due_date
from public.customer_bills b where b.status = 'POSTED'
union all
select 'material_issues', m.id, m.company_id, m.party_id, m.doc_no, m.doc_date, m.total_amount, 'RECEIVABLE', m.doc_date
from public.material_issues m where m.status = 'POSTED'
union all
select 'job_work_receipts', r.id, r.company_id, r.party_id, r.doc_no, r.doc_date, r.total_amount, 'PAYABLE', r.due_date
from public.job_work_receipts r where r.status = 'POSTED'
union all
select 'purchase_receipts', r.id, r.company_id, r.party_id, r.doc_no, r.doc_date, r.total_amount, 'PAYABLE', r.due_date
from public.purchase_receipts r where r.status = 'POSTED'
union all
select 'service_bills', s.id, s.company_id, s.party_id, s.doc_no, s.doc_date, s.total_amount, 'PAYABLE', s.due_date
from public.service_bills s where s.status = 'POSTED'
union all
select 'worker_earnings', w.id, w.company_id, w.party_id, w.doc_no, w.doc_date, w.total_amount, 'PAYABLE', w.doc_date
from public.worker_earnings w where w.status = 'POSTED';

create view public.v_bill_outstanding
with (security_invoker = true) as
select b.*, p.name as party_name,
       app.bill_settled(b.bill_table, b.bill_id) as settled_amount,
       b.bill_amount - app.bill_settled(b.bill_table, b.bill_id) as outstanding_amount,
       current_date - b.doc_date as age_days,
       current_date - b.due_date as overdue_days
from public.v_bills b join public.parties p on p.id = b.party_id;

-- Customer bill due date can be corrected after posting (Tally terms).
create or replace function public.bill_set_due_date(p_bill_table text, p_bill_id uuid, p_due_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_company uuid; v_perm text;
begin
  if p_bill_table not in ('customer_bills', 'purchase_receipts', 'service_bills', 'job_work_receipts') then
    raise exception 'Unknown bill type' using errcode = 'P0001';
  end if;
  execute format('select company_id from public.%I where id = $1 for no key update', p_bill_table)
    into v_company using p_bill_id;
  if v_company is null or not app.is_member(v_company) then
    raise exception 'Bill not found' using errcode = 'P0001';
  end if;
  v_perm := case p_bill_table when 'customer_bills' then 'customer_bill.edit'
                              when 'purchase_receipts' then 'purchase_receipt.edit'
                              when 'service_bills' then 'service_bill.edit'
                              else 'job_work_receipt.edit' end;
  perform app.require_permission(v_company, v_perm);
  if p_due_date is null then
    raise exception 'Due date is required' using errcode = 'P0001';
  end if;
  execute format('update public.%I set due_date = $2 where id = $1', p_bill_table) using p_bill_id, p_due_date;
  perform app.audit(v_company, p_bill_table, p_bill_id::text, 'DUE_DATE', null, jsonb_build_object('due_date', p_due_date));
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment method (§28). Contra covers Bank→Cash, Cash→Bank, Bank→Bank.
-- -----------------------------------------------------------------------------
alter table public.vouchers add column payment_method public.payment_method;

create or replace function app.tg_voucher_payment_method()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.voucher_type in ('RECEIPT', 'PAYMENT') and new.payment_method is null and new.cash_bank_account_id is not null then
    new.payment_method := case (select sub_type from public.accounts where id = new.cash_bank_account_id)
                            when 'CASH' then 'CASH' else 'BANK' end::public.payment_method;
  end if;
  if new.payment_method = 'CASH' and new.cash_bank_account_id is not null
     and (select sub_type from public.accounts where id = new.cash_bank_account_id) = 'BANK' then
    raise exception 'Cash payments must use a cash account' using errcode = 'P0001';
  end if;
  if new.payment_method in ('BANK', 'UPI', 'CHEQUE') and new.cash_bank_account_id is not null
     and (select sub_type from public.accounts where id = new.cash_bank_account_id) = 'CASH' then
    raise exception '% payments must use a bank account', new.payment_method using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger vouchers_payment_method before insert or update on public.vouchers
  for each row execute function app.tg_voucher_payment_method();

-- Payment history per bill (one invoice ↔ many payments, one payment ↔ many invoices).
create or replace view public.v_payment_allocations
with (security_invoker = true) as
select v.company_id, v.id as voucher_id, v.doc_no as voucher_no, v.doc_date as payment_date, v.voucher_type,
       v.payment_method, v.party_id, v.amount as voucher_amount, v.instrument_ref,
       a.bill_table, a.bill_id, b.doc_no as bill_no, b.doc_date as bill_date, b.bill_amount,
       a.amount as allocated_amount, a.tds_amount, a.short_amount, a.debit_note_amount
from public.vouchers v
join public.voucher_allocations a on a.voucher_id = v.id
left join public.v_bills b on b.bill_table = a.bill_table and b.bill_id = a.bill_id
where v.status = 'POSTED';
