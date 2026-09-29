-- =============================================================================
-- 0012 PAYMENTS & VOUCHERS — TRANSACTION_FLOWS §11–15; decisions Q-13, Q-23,
-- Q-29, Q-31, Q-42.
--   RECEIPT   money in (customer, karigar …) or other income
--   PAYMENT   money out (supplier, karigar, worker …) or expense (no party)
--   CONTRA    cash ↔ bank, bank ↔ bank
--   JOURNAL   any balanced adjustment (replaces the sheet's "ENTRY" mode, Q-29)
--   ADJUST    set-off of a party's payable against its receivable (Q-13)
-- Every voucher belongs to a book (MAIN, FACTORY …, Q-42).
-- Allocations settle bills fully or partly; the rest stays as advance (spec §26).
-- =============================================================================

create type public.voucher_type as enum ('RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL', 'ADJUST');

create table public.vouchers (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id),
  doc_no                text,
  doc_date              date not null,
  status                public.doc_status not null default 'DRAFT',
  voucher_type          public.voucher_type not null,
  book_id               uuid not null references public.voucher_books (id),
  cash_bank_account_id  uuid references public.accounts (id),   -- RECEIPT/PAYMENT: the cash/bank; CONTRA: from
  to_account_id         uuid references public.accounts (id),   -- CONTRA: destination
  party_id              uuid references public.parties (id),
  party_side            text check (party_side in ('RECEIVABLE', 'PAYABLE')),
  counter_account_id    uuid references public.accounts (id),   -- RECEIPT/PAYMENT without party: income / expense
  amount                numeric(16,2) not null default 0 check (amount >= 0),
  instrument            text,                                    -- UPI / NEFT / IMPS / CHEQUE / CASH
  instrument_ref        text,
  narration             text,
  submitted_at timestamptz, submitted_by uuid,
  approved_at  timestamptz, approved_by  uuid,
  posted_at    timestamptz, posted_by    uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index vouchers_doc_no_uq on public.vouchers (company_id, doc_no) where doc_no is not null;
create index vouchers_date_idx on public.vouchers (company_id, doc_date);
create index vouchers_party_idx on public.vouchers (company_id, party_id) where party_id is not null;
create index vouchers_book_idx on public.vouchers (company_id, book_id, doc_date);

-- JOURNAL lines
create table public.voucher_lines (
  id          uuid primary key default gen_random_uuid(),
  voucher_id  uuid not null references public.vouchers (id) on delete cascade,
  line_no     integer not null,
  account_id  uuid not null references public.accounts (id),
  party_id    uuid references public.parties (id),
  debit       numeric(16,2) not null default 0 check (debit >= 0),
  credit      numeric(16,2) not null default 0 check (credit >= 0),
  narration   text,
  unique (voucher_id, line_no),
  check ((debit = 0) <> (credit = 0))
);

-- Bill settlement. tds / short / debit-note amounts only on RECEIPT (Q-23).
create table public.voucher_allocations (
  id                  uuid primary key default gen_random_uuid(),
  voucher_id          uuid not null references public.vouchers (id) on delete cascade,
  bill_table          text not null check (bill_table in ('customer_bills', 'job_work_receipts', 'purchase_receipts',
                                                          'material_issues', 'service_bills', 'worker_earnings',
                                                          'job_work_returns', 'purchase_returns')),
  bill_id             uuid not null,
  amount              numeric(16,2) not null default 0 check (amount >= 0),
  tds_amount          numeric(16,2) not null default 0 check (tds_amount >= 0),
  short_amount        numeric(16,2) not null default 0,               -- "LESS AMOUNT"; may be ± rounding
  debit_note_amount   numeric(16,2) not null default 0 check (debit_note_amount >= 0),
  debit_note_ref      text,                                           -- e.g. GCN/25-26/007
  unique (voucher_id, bill_table, bill_id)
);
create index voucher_allocations_bill_idx on public.voucher_allocations (bill_table, bill_id);

create trigger vouchers_audit_fields before insert or update on public.vouchers
  for each row execute function app.tg_set_audit_fields();

insert into app.doc_types (doc_type, table_name, line_table, line_fk, perm_prefix, label) values
  ('VOUCHER', 'vouchers', 'voucher_lines', 'voucher_id', 'voucher', 'Voucher');

-- -----------------------------------------------------------------------------
-- Bills: amount, side and settlement
-- -----------------------------------------------------------------------------
create or replace view public.v_bills
with (security_invoker = true) as
select 'customer_bills'::text as bill_table, b.id as bill_id, b.company_id, b.party_id, b.doc_no, b.doc_date,
       b.amount as bill_amount, 'RECEIVABLE'::text as side
from public.customer_bills b where b.status = 'POSTED'
union all
select 'material_issues', m.id, m.company_id, m.party_id, m.doc_no, m.doc_date, m.total_amount, 'RECEIVABLE'
from public.material_issues m where m.status = 'POSTED'
union all
select 'job_work_receipts', r.id, r.company_id, r.party_id, r.doc_no, r.doc_date, r.total_amount, 'PAYABLE'
from public.job_work_receipts r where r.status = 'POSTED'
union all
select 'purchase_receipts', r.id, r.company_id, r.party_id, r.doc_no, r.doc_date, r.total_amount, 'PAYABLE'
from public.purchase_receipts r where r.status = 'POSTED'
union all
select 'service_bills', s.id, s.company_id, s.party_id, s.doc_no, s.doc_date, s.total_amount, 'PAYABLE'
from public.service_bills s where s.status = 'POSTED'
union all
select 'worker_earnings', w.id, w.company_id, w.party_id, w.doc_no, w.doc_date, w.total_amount, 'PAYABLE'
from public.worker_earnings w where w.status = 'POSTED';

create or replace function app.bill_settled(p_bill_table text, p_bill_id uuid, p_exclude_voucher uuid default null)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(a.amount + a.tds_amount + a.short_amount + a.debit_note_amount), 0)
  from public.voucher_allocations a join public.vouchers v on v.id = a.voucher_id
  where a.bill_table = p_bill_table and a.bill_id = p_bill_id and v.status = 'POSTED'
    and (p_exclude_voucher is null or v.id <> p_exclude_voucher)
$$;
grant execute on function app.bill_settled(text, uuid, uuid) to authenticated;

create or replace view public.v_bill_outstanding
with (security_invoker = true) as
select b.*, p.name as party_name,
       app.bill_settled(b.bill_table, b.bill_id) as settled_amount,
       b.bill_amount - app.bill_settled(b.bill_table, b.bill_id) as outstanding_amount,
       current_date - b.doc_date as age_days
from public.v_bills b join public.parties p on p.id = b.party_id;

-- Customer-bill register exactly like the sheet (Q-23):
-- Place · Bill date · Bill no · Amount · TDS · Amount received · Received date · Less amount · Debit note
create or replace view public.v_customer_bill_register
with (security_invoker = true) as
select b.company_id, b.id as bill_id, b.party_id, p.name as party_name,
       a.code as place, b.doc_date as bill_date, b.bill_no, b.amount,
       coalesce(s.tds, 0) as tds,
       coalesce(s.received, 0) as amount_received,
       s.received_date,
       coalesce(s.tds, 0) + coalesce(s.received, 0) - b.amount as less_amount,
       coalesce(s.debit_note, 0) as debit_note,
       s.debit_note_refs,
       b.amount - coalesce(s.settled, 0) as outstanding
from public.customer_bills b
join public.parties p on p.id = b.party_id
left join public.party_addresses a on a.id = b.ship_to_address_id
left join lateral (
  select sum(x.tds_amount) as tds, sum(x.amount) as received, max(v.doc_date) as received_date,
         sum(x.debit_note_amount) as debit_note,
         string_agg(x.debit_note_ref, ', ') as debit_note_refs,
         sum(x.amount + x.tds_amount + x.short_amount + x.debit_note_amount) as settled
  from public.voucher_allocations x join public.vouchers v on v.id = x.voucher_id
  where x.bill_table = 'customer_bills' and x.bill_id = b.id and v.status = 'POSTED') s on true
where b.status = 'POSTED';

-- Replace the hook from the document framework: allocated bills cannot be cancelled.
create or replace function app.assert_not_allocated(p_table text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.voucher_allocations a join public.vouchers v on v.id = a.voucher_id
             where a.bill_table = p_table and a.bill_id = p_id and v.status = 'POSTED') then
    raise exception 'This bill is settled by a payment/receipt; cancel that voucher first' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Voucher posting
-- -----------------------------------------------------------------------------
create or replace function app.assert_cash_bank(p_company_id uuid, p_account_id uuid)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account_id;
  if a.id is null or a.company_id <> p_company_id or a.sub_type not in ('CASH', 'BANK') or a.is_group then
    raise exception 'Choose a cash or bank account' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function app.post_voucher(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.vouchers;
  a        public.voucher_allocations;
  b        record;
  v_doc_no text;
  v_side   text;
  v_party_account uuid;
  v_alloc  numeric := 0;
  v_tds    numeric := 0;
  v_short  numeric := 0;
  v_dn     numeric := 0;
  v_lines  jsonb := '[]'::jsonb;
  v_warns  text[] := '{}';
  v_dr     numeric; v_cr numeric;
begin
  select * into h from public.vouchers where id = p_id;
  perform app.assert_same_company(h.company_id, 'voucher_books', h.book_id);
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'accounts', h.counter_account_id);

  v_side := coalesce(h.party_side, case h.voucher_type when 'RECEIPT' then 'RECEIVABLE' else 'PAYABLE' end);
  if h.party_id is not null then
    v_party_account := app.account_id(h.company_id,
                         case v_side when 'RECEIVABLE' then 'SUNDRY_DEBTORS' else 'SUNDRY_CREDITORS' end);
  end if;

  -- Allocations: validate each bill and collect TDS / short / debit-note totals.
  for a in select * from public.voucher_allocations where voucher_id = p_id loop
    if h.voucher_type not in ('RECEIPT', 'PAYMENT') or h.party_id is null then
      raise exception 'Bills can only be settled by a receipt or payment of a party' using errcode = 'P0001';
    end if;
    select * into b from public.v_bills where bill_table = a.bill_table and bill_id = a.bill_id;
    if b.bill_id is null or b.company_id <> h.company_id or b.party_id <> h.party_id then
      raise exception 'Bill does not belong to this party' using errcode = 'P0001';
    end if;
    if h.voucher_type = 'PAYMENT' and (a.short_amount <> 0 or a.debit_note_amount <> 0) then
      raise exception 'Less amount / debit note can only be used on receipts' using errcode = 'P0001';
    end if;
    -- lock settlement per bill: serialise concurrent vouchers for the same bill
    perform pg_advisory_xact_lock(hashtextextended(a.bill_table || a.bill_id::text, 0));
    if a.amount + a.tds_amount + a.short_amount + a.debit_note_amount
       > b.bill_amount - app.bill_settled(a.bill_table, a.bill_id, p_id) then
      raise exception 'Settlement of bill % is more than its outstanding %',
        b.doc_no, b.bill_amount - app.bill_settled(a.bill_table, a.bill_id, p_id) using errcode = 'P0001';
    end if;
    v_alloc := v_alloc + a.amount;
    v_tds := v_tds + a.tds_amount;
    v_short := v_short + a.short_amount;
    v_dn := v_dn + a.debit_note_amount;
  end loop;
  if v_alloc > h.amount then
    raise exception 'Allocated amount % is more than the voucher amount %', v_alloc, h.amount using errcode = 'P0001';
  end if;

  if h.voucher_type = 'RECEIPT' then
    perform app.assert_cash_bank(h.company_id, h.cash_bank_account_id);
    if (h.party_id is null) = (h.counter_account_id is null) then
      raise exception 'Choose either a party or an income account' using errcode = 'P0001';
    end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', h.cash_bank_account_id, 'debit', h.amount),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'TDS_RECEIVABLE'), 'debit', v_tds),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'RATE_DIFFERENCE'), 'debit', v_short + v_dn),
      jsonb_build_object('account_id', coalesce(v_party_account, h.counter_account_id), 'party_id', h.party_id,
                         'credit', h.amount + v_tds + v_short + v_dn));
  elsif h.voucher_type = 'PAYMENT' then
    perform app.assert_cash_bank(h.company_id, h.cash_bank_account_id);
    if (h.party_id is null) = (h.counter_account_id is null) then
      raise exception 'Choose either a party or an expense account' using errcode = 'P0001';
    end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', coalesce(v_party_account, h.counter_account_id), 'party_id', h.party_id,
                         'debit', h.amount + v_tds),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'TDS_PAYABLE'), 'credit', v_tds),
      jsonb_build_object('account_id', h.cash_bank_account_id, 'credit', h.amount));
  elsif h.voucher_type = 'CONTRA' then
    perform app.assert_cash_bank(h.company_id, h.cash_bank_account_id);
    perform app.assert_cash_bank(h.company_id, h.to_account_id);
    if h.cash_bank_account_id = h.to_account_id then
      raise exception 'From and to accounts must be different' using errcode = 'P0001';
    end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', h.to_account_id, 'debit', h.amount),
      jsonb_build_object('account_id', h.cash_bank_account_id, 'credit', h.amount));
  elsif h.voucher_type = 'ADJUST' then
    if h.party_id is null then
      raise exception 'ADJUST needs a party' using errcode = 'P0001';
    end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_CREDITORS'), 'party_id', h.party_id,
                         'debit', h.amount, 'narration', 'Set-off against receivable'),
      jsonb_build_object('account_id', app.account_id(h.company_id, 'SUNDRY_DEBTORS'), 'party_id', h.party_id,
                         'credit', h.amount, 'narration', 'Set-off against payable'));
  else -- JOURNAL
    if exists (select 1 from public.voucher_lines l join public.accounts ac on ac.id = l.account_id
               where l.voucher_id = p_id and ac.company_id <> h.company_id) then
      raise exception 'Account belongs to another company' using errcode = 'P0001';
    end if;
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr
    from public.voucher_lines where voucher_id = p_id;
    if v_dr = 0 or v_dr <> v_cr then
      raise exception 'Journal is not balanced (debit %, credit %)', v_dr, v_cr using errcode = 'P0001';
    end if;
    select jsonb_agg(jsonb_build_object('account_id', account_id, 'party_id', party_id,
                                        'debit', debit, 'credit', credit, 'narration', narration) order by line_no)
      into v_lines from public.voucher_lines where voucher_id = p_id;
    update public.vouchers set amount = v_dr where id = p_id;
  end if;

  if h.voucher_type <> 'JOURNAL' and h.amount <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = 'P0001';
  end if;

  v_doc_no := app.next_doc_no(h.company_id, 'VOUCHER_' || h.voucher_type::text, h.doc_date);
  update public.vouchers set doc_no = v_doc_no, status = 'POSTED', party_side = case when party_id is not null then v_side end
   where id = p_id;
  perform app.post_journal(h.company_id, h.doc_date, 'vouchers', p_id, v_doc_no,
                           coalesce(h.narration, initcap(h.voucher_type::text) || ' ' || v_doc_no), v_lines);

  if h.voucher_type in ('RECEIPT', 'PAYMENT') and v_alloc < h.amount and h.party_id is not null then
    v_warns := v_warns || format('%s of %s kept as advance / on account', h.amount - v_alloc, h.amount);
  end if;
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_voucher(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.reverse_journal('vouchers', p_id, p_date, 'Cancellation');
end;
$$;

-- Allocations are saved with the voucher draft (voucher_lines carry journal
-- lines). This RPC replaces the allocations of a DRAFT / PENDING voucher.
create or replace function public.voucher_set_allocations(p_voucher_id uuid, p_allocations jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v record; e jsonb;
begin
  select * into v from app.lock_doc(app.doc_type('VOUCHER'), p_voucher_id);
  if v.status = 'DRAFT' then
    perform app.require_permission(v.company_id, 'voucher.edit');
  elsif v.status = 'PENDING_APPROVAL' then
    perform app.require_permission(v.company_id, 'voucher.approve');
  else
    raise exception 'Voucher is % and can no longer be edited', v.status using errcode = 'P0001';
  end if;
  delete from public.voucher_allocations where voucher_id = p_voucher_id;
  for e in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    insert into public.voucher_allocations (voucher_id, bill_table, bill_id, amount, tds_amount,
                                            short_amount, debit_note_amount, debit_note_ref)
    values (p_voucher_id, e->>'bill_table', (e->>'bill_id')::uuid,
            coalesce((e->>'amount')::numeric, 0), coalesce((e->>'tds_amount')::numeric, 0),
            coalesce((e->>'short_amount')::numeric, 0), coalesce((e->>'debit_note_amount')::numeric, 0),
            e->>'debit_note_ref');
  end loop;
end;
$$;

-- Allocations are a second child table of vouchers (the registry knows only
-- voucher_lines), so its policy is declared here.
alter table public.voucher_allocations enable row level security;
create policy voucher_allocations_read on public.voucher_allocations for select to authenticated
  using (exists (select 1 from public.vouchers v where v.id = voucher_id
                 and app.has_permission(v.company_id, 'voucher.view')));
revoke insert, update, delete on public.voucher_allocations from authenticated;
