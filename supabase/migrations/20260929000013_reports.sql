-- =============================================================================
-- 0013 REPORTS & HELPERS (spec §30) — all derived from movements / journals.
-- Security invoker: RLS decides what the caller may see.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rate suggestion for entry forms (Q-07, Q-12)
--   JOB_WORK : party list → item list → items.job_work_rate → last receipt (party+item)
--   ISSUE    : last issue (party+item+godown) → last issue (party+item) → rate list
--   PURCHASE : last purchase (party+item+godown) → last purchase (party+item) → rate list
--   WORKER   : last earning (worker+item) → rate list
-- -----------------------------------------------------------------------------
create or replace function public.suggest_rate(p_company_id uuid, p_rate_type text, p_party_id uuid,
                                               p_item_id uuid, p_godown_id uuid default null,
                                               p_on date default current_date)
returns numeric
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v numeric;
begin
  if p_rate_type = 'JOB_WORK' then
    select rate into v from public.party_item_rates
     where company_id = p_company_id and rate_type = 'JOB_WORK' and item_id = p_item_id
       and party_id = p_party_id and effective_from <= p_on order by effective_from desc limit 1;
    if v is null then
      select rate into v from public.party_item_rates
       where company_id = p_company_id and rate_type = 'JOB_WORK' and item_id = p_item_id
         and party_id is null and effective_from <= p_on order by effective_from desc limit 1;
    end if;
    if v is null then
      select job_work_rate into v from public.items where id = p_item_id and company_id = p_company_id;
    end if;
    if v is null then
      select l.rate into v from public.job_work_receipt_lines l join public.job_work_receipts r on r.id = l.receipt_id
       where r.company_id = p_company_id and r.status = 'POSTED' and r.party_id = p_party_id
         and l.item_id = p_item_id and coalesce(l.rate, 0) > 0
       order by r.doc_date desc, r.posted_at desc limit 1;
    end if;
  elsif p_rate_type = 'ISSUE' then
    select l.rate into v from public.material_issue_lines l join public.material_issues r on r.id = l.issue_id
     where r.company_id = p_company_id and r.status = 'POSTED' and r.party_id = p_party_id and l.item_id = p_item_id
       and (p_godown_id is null or r.godown_id = p_godown_id) and coalesce(l.rate, 0) > 0
     order by r.doc_date desc, r.posted_at desc limit 1;
    if v is null then
      select l.rate into v from public.material_issue_lines l join public.material_issues r on r.id = l.issue_id
       where r.company_id = p_company_id and r.status = 'POSTED' and r.party_id = p_party_id and l.item_id = p_item_id
         and coalesce(l.rate, 0) > 0
       order by r.doc_date desc, r.posted_at desc limit 1;
    end if;
  elsif p_rate_type = 'PURCHASE' then
    select l.rate into v from public.purchase_receipt_lines l join public.purchase_receipts r on r.id = l.receipt_id
     where r.company_id = p_company_id and r.status = 'POSTED' and r.party_id = p_party_id and l.item_id = p_item_id
       and (p_godown_id is null or r.godown_id = p_godown_id) and coalesce(l.rate, 0) > 0
     order by r.doc_date desc, r.posted_at desc limit 1;
    if v is null then
      select l.rate into v from public.purchase_receipt_lines l join public.purchase_receipts r on r.id = l.receipt_id
       where r.company_id = p_company_id and r.status = 'POSTED' and r.party_id = p_party_id and l.item_id = p_item_id
         and coalesce(l.rate, 0) > 0
       order by r.doc_date desc, r.posted_at desc limit 1;
    end if;
  elsif p_rate_type = 'WORKER' then
    select l.rate into v from public.worker_earning_lines l join public.worker_earnings r on r.id = l.earning_id
     where r.company_id = p_company_id and r.status = 'POSTED' and r.party_id = p_party_id and l.item_id = p_item_id
       and coalesce(l.rate, 0) > 0
     order by r.doc_date desc, r.posted_at desc limit 1;
  else
    raise exception 'Unknown rate type %', p_rate_type using errcode = 'P0001';
  end if;
  if v is null and p_rate_type in ('ISSUE', 'PURCHASE', 'WORKER') then
    select rate into v from public.party_item_rates
     where company_id = p_company_id and rate_type = p_rate_type and item_id = p_item_id
       and (party_id = p_party_id or party_id is null) and effective_from <= p_on
     order by (party_id is null), effective_from desc limit 1;
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stock valuation (weighted average of valued receipts up to the date, Q-33)
-- -----------------------------------------------------------------------------
create or replace function public.stock_valuation(p_company_id uuid, p_as_on date)
returns table (item_id uuid, item_code text, item_name text, base_qty numeric, avg_rate numeric, value numeric)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select m.item_id,
           sum(m.signed_base_qty) as qty,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0
                    then m.base_qty * m.rate end) as in_value,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0
                    then m.base_qty end) as in_qty
    from public.stock_movements m
    where m.company_id = p_company_id and m.movement_date <= p_as_on
    group by m.item_id)
  select i.id, i.code, i.name, q.qty,
         round(coalesce(q.in_value / nullif(q.in_qty, 0), 0), 4),
         round(greatest(q.qty, 0) * coalesce(q.in_value / nullif(q.in_qty, 0), 0), 2)
  from q join public.items i on i.id = q.item_id
  where q.qty <> 0
  order by i.name
$$;

-- -----------------------------------------------------------------------------
-- Profit & Loss for a period, with opening / closing stock
-- -----------------------------------------------------------------------------
create or replace function public.profit_loss(p_company_id uuid, p_from date, p_to date)
returns table (section text, account_code text, account_name text, amount numeric)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_open numeric; v_close numeric; v_income numeric; v_expense numeric;
begin
  select coalesce(sum(value), 0) into v_open from public.stock_valuation(p_company_id, p_from - 1);
  select coalesce(sum(value), 0) into v_close from public.stock_valuation(p_company_id, p_to);

  return query
    select case a.account_type when 'INCOME' then 'INCOME' else 'EXPENSE' end,
           a.code, a.name,
           case a.account_type when 'INCOME' then sum(l.credit - l.debit) else sum(l.debit - l.credit) end
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.entry_date between p_from and p_to
      and a.account_type in ('INCOME', 'EXPENSE')
    group by a.account_type, a.code, a.name
    having sum(l.debit - l.credit) <> 0
    order by 1 desc, 2;

  select coalesce(sum(l.credit - l.debit), 0) into v_income
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type = 'INCOME';
  select coalesce(sum(l.debit - l.credit), 0) into v_expense
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type = 'EXPENSE';

  section := 'STOCK'; account_code := null; account_name := 'Opening stock'; amount := v_open; return next;
  section := 'STOCK'; account_name := 'Closing stock'; amount := v_close; return next;
  section := 'RESULT'; account_name := 'Net profit (loss)';
  amount := v_income + v_close - v_expense - v_open; return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Balance sheet as on a date (profit of the year shown as a separate line)
-- -----------------------------------------------------------------------------
create or replace function public.balance_sheet(p_company_id uuid, p_as_on date)
returns table (section text, account_code text, account_name text, amount numeric)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_pl numeric; v_stock numeric;
begin
  return query
    select a.account_type::text, a.code, a.name,
           case when a.account_type = 'ASSET' then sum(l.debit - l.credit) else sum(l.credit - l.debit) end
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.entry_date <= p_as_on
      and a.account_type in ('ASSET', 'LIABILITY', 'EQUITY')
    group by a.account_type, a.code, a.name
    having sum(l.debit - l.credit) <> 0
    order by 1, 2;

  select coalesce(sum(value), 0) into v_stock from public.stock_valuation(p_company_id, p_as_on);
  select coalesce(sum(l.credit - l.debit), 0)
    into v_pl
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date <= p_as_on and a.account_type in ('INCOME', 'EXPENSE');

  section := 'ASSET'; account_code := null; account_name := 'Closing stock (valued)'; amount := v_stock; return next;
  section := 'EQUITY'; account_name := 'Profit & loss (incl. closing stock)'; amount := v_pl + v_stock; return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Day book
-- -----------------------------------------------------------------------------
create or replace function public.day_book(p_company_id uuid, p_from date, p_to date)
returns table (entry_date date, entry_no text, source_table text, source_doc_no text,
               account_name text, party_name text, debit numeric, credit numeric, narration text)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select l.entry_date, e.entry_no, e.source_table, e.source_doc_no, a.name, p.name,
         nullif(l.debit, 0), nullif(l.credit, 0), coalesce(l.narration, e.narration)
  from public.journal_entry_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a on a.id = l.account_id
  left join public.parties p on p.id = l.party_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to
  order by l.entry_date, e.entry_no, l.id
$$;

-- -----------------------------------------------------------------------------
-- Item planning (sheet "Item WISE STOCK"): stock + open demand + pending supply
-- -----------------------------------------------------------------------------
create or replace function public.item_planning(p_company_id uuid)
returns table (item_id uuid, item_code text, item_name text, stock_base_qty numeric,
               open_sales_base_qty numeric, pending_job_work_base_qty numeric,
               pending_factory_base_qty numeric, balance_to_order_base_qty numeric, pack_factor numeric)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with s as (select item_id, sum(signed_base_qty) q from public.stock_movements
             where company_id = p_company_id group by item_id),
       d as (select item_id, sum(pending_base_qty) q from public.v_sales_order_lines
             where company_id = p_company_id and pending_base_qty > 0 group by item_id),
       j as (select item_id, sum(pending_base_qty) q from public.v_job_work_pending
             where company_id = p_company_id group by item_id),
       f as (select item_id, sum(pending_base_qty) q from public.v_production_pending
             where company_id = p_company_id group by item_id)
  select i.id, i.code, i.name, coalesce(s.q, 0), coalesce(d.q, 0), coalesce(j.q, 0), coalesce(f.q, 0),
         coalesce(d.q, 0) - coalesce(s.q, 0) - coalesce(j.q, 0) - coalesce(f.q, 0),
         (select factor from app.default_packing(i.id, current_date))
  from public.items i
  left join s on s.item_id = i.id left join d on d.item_id = i.id
  left join j on j.item_id = i.id left join f on f.item_id = i.id
  where i.company_id = p_company_id and i.item_kind = 'FINISHED_GOOD' and not i.is_deleted
  order by i.name
$$;

-- Dispatch plan (sheet PLANING SHEET): pending boxes per DC and item in a date window
create or replace function public.dispatch_plan(p_company_id uuid, p_from date, p_to date)
returns table (dc_code text, item_name text, pending_base_qty numeric, pending_pack_qty numeric,
               orders text)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select dc_code, item_name, sum(pending_base_qty), sum(pending_pack_qty),
         string_agg(distinct customer_po_no, ', ')
  from public.v_sales_order_lines
  where company_id = p_company_id and pending_base_qty > 0
    and delivery_date between p_from and p_to
  group by dc_code, item_name
  order by dc_code, item_name
$$;
