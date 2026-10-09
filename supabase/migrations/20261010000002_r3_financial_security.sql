-- =============================================================================
-- PLATFORM R3 (2/10) — financial field security (D3, D7, W13).
--
-- Rights:  items.view_sale_rate (SALE) · items.view_purchase_rate (PURCHASE)
--          costs.view_landed_cost (LANDED) · items.view_cost (AVERAGE)
--          costs.view_stock_valuation (VALUATION) · sales.view_margin (MARGIN)
--          reports.view_profit (PROFIT) · accounts.view_amounts (AMOUNT)
-- Inference rules: receivable amounts = AMOUNT + SALE; payable amounts =
-- AMOUNT + PURCHASE; margin = MARGIN + SALE + AVERAGE; accounting reports and
-- non-party ledger lines = PROFIT + AMOUNT + SALE + PURCHASE; stock lines of
-- P&L / balance sheet additionally VALUATION.
--
-- Mechanism ("sidecar join"): SELECT on every sensitive column is revoked
-- from `authenticated`. Invoker views (RLS of the base table unchanged) left
-- join a definer value view in schema `secure` (not exposed by the API) on the
-- primary key; the value view returns a value only for companies where the
-- caller holds the class (InitPlan, no per-row permission query).
-- Journal lines are row-level (ledger_class). Registry `secure.sensitive_columns`
-- drives the views, the audit masking and the completeness tests.
-- =============================================================================

create schema if not exists secure;
revoke all on schema secure from public;
grant usage on schema secure to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Classes
-- -----------------------------------------------------------------------------
create or replace function secure.class_ok(p_company_id uuid, p_class text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case p_class
    when 'SALE'            then app.has_permission(p_company_id, 'items.view_sale_rate')
    when 'PURCHASE'        then app.has_permission(p_company_id, 'items.view_purchase_rate')
    when 'LANDED'          then app.has_permission(p_company_id, 'costs.view_landed_cost')
    when 'AVERAGE'         then app.has_permission(p_company_id, 'items.view_cost')
    when 'VALUATION'       then app.has_permission(p_company_id, 'costs.view_stock_valuation')
    when 'AMOUNT'          then app.has_permission(p_company_id, 'accounts.view_amounts')
    when 'AMOUNT_SALE'     then app.has_permission(p_company_id, 'accounts.view_amounts')
                                and app.has_permission(p_company_id, 'items.view_sale_rate')
    when 'AMOUNT_PURCHASE' then app.has_permission(p_company_id, 'accounts.view_amounts')
                                and app.has_permission(p_company_id, 'items.view_purchase_rate')
    when 'MARGIN'          then app.has_permission(p_company_id, 'sales.view_margin')
                                and app.has_permission(p_company_id, 'items.view_sale_rate')
                                and app.has_permission(p_company_id, 'items.view_cost')
    when 'PROFIT'          then app.has_permission(p_company_id, 'reports.view_profit')
                                and app.has_permission(p_company_id, 'accounts.view_amounts')
                                and app.has_permission(p_company_id, 'items.view_sale_rate')
                                and app.has_permission(p_company_id, 'items.view_purchase_rate')
    when 'PROFIT_STOCK'    then secure.class_ok(p_company_id, 'PROFIT')
                                and app.has_permission(p_company_id, 'costs.view_stock_valuation')
    else false end
$$;

-- companies of the caller where the class is visible (InitPlan in views / policies)
create or replace function secure.allowed(p_class text)
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c where secure.class_ok(c, p_class)
$$;

create or replace function secure.require_class(p_company_id uuid, p_class text, p_what text)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  if not secure.class_ok(p_company_id, p_class) then
    raise exception 'Permission denied: % needs %', p_what,
      case p_class
        when 'PROFIT' then 'the profit & accounting reports right together with financial amounts, sale rates and purchase rates'
        when 'VALUATION' then 'the stock valuation right'
        when 'PURCHASE' then 'the purchase rate right'
        when 'SALE' then 'the sale rate right'
        when 'AMOUNT' then 'the financial amounts right'
        else lower(p_class) || ' visibility' end
      using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
create table secure.sensitive_columns (
  table_name  text not null,
  column_name text not null,
  class       text not null check (class in ('SALE', 'PURCHASE', 'MOVEMENT', 'AMOUNT_SIDE', 'LANDED', 'AVERAGE', 'VALUATION',
                                             'AMOUNT', 'PROFIT', 'ROW_LEVEL')),
  note        text not null default '',
  primary key (table_name, column_name)
);
-- money-like columns that are not sensitive (or protected another way)
create table secure.column_whitelist (
  relation    text not null,
  column_name text not null,
  reason      text not null,
  primary key (relation, column_name)
);
-- functions that read registered columns, and how they are protected
create table secure.reviewed_functions (
  function_name text primary key,
  treatment     text not null
);
-- where the value view takes company / side from
create table secure.value_sources (
  table_name   text primary key,
  from_clause  text not null,
  company_expr text not null,
  side_expr    text
);
grant select on secure.sensitive_columns, secure.column_whitelist, secure.reviewed_functions, secure.value_sources to authenticated;

insert into secure.sensitive_columns (table_name, column_name, class, note) values
  -- sales
  ('sales_order_lines', 'rate', 'SALE', ''), ('sales_order_lines', 'quoted_rate', 'SALE', ''), ('sales_order_lines', 'reference_rate', 'SALE', ''),
  ('customer_po_lines', 'reference_rate', 'SALE', ''), ('customer_po_lines', 'quoted_rate', 'SALE', ''), ('customer_po_lines', 'approved_rate', 'SALE', ''),
  ('customer_bills', 'amount', 'SALE', 'invoice amount; receivable views add AMOUNT'),
  ('sales_returns', 'credit_amount', 'SALE', ''),
  ('material_issue_lines', 'rate', 'SALE', 'charged to the job worker (income account)'), ('material_issue_lines', 'amount', 'SALE', ''),
  ('material_issues', 'total_amount', 'SALE', ''),
  -- purchase / job work / worker pay
  ('purchase_order_lines', 'rate', 'PURCHASE', ''),
  ('purchase_receipt_lines', 'rate', 'PURCHASE', ''), ('purchase_receipt_lines', 'taxable_amount', 'PURCHASE', ''),
  ('purchase_receipt_lines', 'gst_amount', 'PURCHASE', ''), ('purchase_receipt_lines', 'amount', 'PURCHASE', ''),
  ('purchase_receipts', 'taxable_amount', 'PURCHASE', ''), ('purchase_receipts', 'gst_amount', 'PURCHASE', ''), ('purchase_receipts', 'total_amount', 'PURCHASE', ''),
  ('purchase_return_lines', 'rate', 'PURCHASE', ''), ('purchase_return_lines', 'taxable_amount', 'PURCHASE', ''),
  ('purchase_return_lines', 'gst_amount', 'PURCHASE', ''), ('purchase_return_lines', 'amount', 'PURCHASE', ''),
  ('purchase_returns', 'taxable_amount', 'PURCHASE', ''), ('purchase_returns', 'gst_amount', 'PURCHASE', ''), ('purchase_returns', 'total_amount', 'PURCHASE', ''),
  ('service_bill_lines', 'rate', 'PURCHASE', ''), ('service_bill_lines', 'taxable_amount', 'PURCHASE', ''),
  ('service_bill_lines', 'gst_amount', 'PURCHASE', ''), ('service_bill_lines', 'amount', 'PURCHASE', ''),
  ('service_bills', 'taxable_amount', 'PURCHASE', ''), ('service_bills', 'gst_amount', 'PURCHASE', ''), ('service_bills', 'total_amount', 'PURCHASE', ''),
  ('job_work_receipt_lines', 'rate', 'PURCHASE', ''), ('job_work_receipt_lines', 'amount', 'PURCHASE', ''),
  ('job_work_receipts', 'total_amount', 'PURCHASE', ''),
  ('job_work_return_lines', 'rate', 'PURCHASE', ''), ('job_work_return_lines', 'amount', 'PURCHASE', ''),
  ('job_work_returns', 'total_amount', 'PURCHASE', ''),
  ('worker_earning_lines', 'rate', 'PURCHASE', 'labour paid to the worker'), ('worker_earning_lines', 'amount', 'PURCHASE', ''),
  ('worker_earnings', 'total_amount', 'PURCHASE', ''),
  -- cost
  ('stock_movements', 'rate', 'MOVEMENT', 'inward = landed cost, outward = average cost'),
  ('stock_movements', 'value', 'MOVEMENT', ''),
  ('stock_adjustment_lines', 'rate', 'MOVEMENT', 'adjustment in = landed, out = average'),
  -- money moving between parties
  ('vouchers', 'amount', 'AMOUNT_SIDE', 'receivable: AMOUNT+SALE, payable: AMOUNT+PURCHASE, other: PROFIT'),
  ('voucher_lines', 'debit', 'AMOUNT_SIDE', ''), ('voucher_lines', 'credit', 'AMOUNT_SIDE', ''),
  ('voucher_allocations', 'amount', 'AMOUNT_SIDE', ''), ('voucher_allocations', 'tds_amount', 'AMOUNT_SIDE', ''),
  ('voucher_allocations', 'short_amount', 'AMOUNT_SIDE', ''), ('voucher_allocations', 'debit_note_amount', 'AMOUNT_SIDE', ''),
  ('payment_reminders', 'outstanding_amount', 'AMOUNT_SIDE', ''),
  -- protected through the masked item view (R2) / row-level policies
  ('items', 'sale_price', 'SALE', 'v_items'), ('items', 'purchase_price', 'PURCHASE', 'v_items'),
  ('items', 'job_work_rate', 'PURCHASE', 'v_items'),
  ('party_item_rates', 'rate', 'ROW_LEVEL', 'rows per rate type (SALE / ISSUE: SALE; PURCHASE / JOB_WORK / WORKER: PURCHASE)'),
  ('item_rate_history', 'old_rate', 'ROW_LEVEL', 'rows per rate type'), ('item_rate_history', 'new_rate', 'ROW_LEVEL', 'rows per rate type'),
  ('journal_entry_lines', 'debit', 'ROW_LEVEL', 'rows per ledger class'), ('journal_entry_lines', 'credit', 'ROW_LEVEL', 'rows per ledger class');

insert into secure.column_whitelist values
  ('items', 'gst_rate', 'tax percentage, not a value'),
  ('purchase_receipt_lines', 'gst_rate', 'tax percentage'), ('purchase_return_lines', 'gst_rate', 'tax percentage'),
  ('service_bill_lines', 'gst_rate', 'tax percentage'),
  ('purchase_receipts', 'has_missing_rate', 'flag'), ('purchase_returns', 'has_missing_rate', 'flag'),
  ('service_bills', 'has_missing_rate', 'flag'), ('job_work_receipts', 'has_missing_rate', 'flag'),
  ('job_work_returns', 'has_missing_rate', 'flag'), ('material_issues', 'has_missing_rate', 'flag'),
  ('worker_earnings', 'has_missing_rate', 'flag'),
  ('item_rate_history', 'rate_type', 'type, not a value'), ('party_item_rates', 'rate_type', 'type, not a value'),
  ('parties', 'credit_days', 'terms'), ('parties', 'credit_limit', 'credit limit agreed with the party (master data, parties rights)'),
  ('company_settings', 'customer_rate_visible', 'setting'), ('company_settings', 'vendor_rate_visible', 'setting'),
  ('company_settings', 'customer_quote_price_enabled', 'setting'), ('company_settings', 'customer_outstanding_visible', 'setting'),
  ('party_settings', 'rate_visible', 'setting'), ('party_settings', 'quote_price_enabled', 'setting'),
  ('party_settings', 'outstanding_visible', 'setting'),
  ('document_sequences', 'start_value', 'numbering'), ('document_sequence_counters', 'next_value', 'numbering'),
  ('import_errors', 'value', 'value uploaded by the importer himself'), ('import_jobs', 'total_rows', 'count'),
  ('app_settings', 'value', 'settings'), ('voucher_allocations', 'debit_note_ref', 'reference text');

insert into secure.value_sources values
  ('sales_order_lines',      'public.sales_order_lines t join public.sales_orders h on h.id = t.order_id', 'h.company_id', null),
  ('customer_po_lines',      'public.customer_po_lines t join public.customer_pos h on h.id = t.customer_po_id', 'h.company_id', null),
  ('customer_bills',         'public.customer_bills t', 't.company_id', null),
  ('sales_returns',          'public.sales_returns t', 't.company_id', null),
  ('material_issue_lines',   'public.material_issue_lines t join public.material_issues h on h.id = t.issue_id', 'h.company_id', null),
  ('material_issues',        'public.material_issues t', 't.company_id', null),
  ('purchase_order_lines',   'public.purchase_order_lines t join public.purchase_orders h on h.id = t.order_id', 'h.company_id', null),
  ('purchase_receipt_lines', 'public.purchase_receipt_lines t join public.purchase_receipts h on h.id = t.receipt_id', 'h.company_id', null),
  ('purchase_receipts',      'public.purchase_receipts t', 't.company_id', null),
  ('purchase_return_lines',  'public.purchase_return_lines t join public.purchase_returns h on h.id = t.return_id', 'h.company_id', null),
  ('purchase_returns',       'public.purchase_returns t', 't.company_id', null),
  ('service_bill_lines',     'public.service_bill_lines t join public.service_bills h on h.id = t.bill_id', 'h.company_id', null),
  ('service_bills',          'public.service_bills t', 't.company_id', null),
  ('job_work_receipt_lines', 'public.job_work_receipt_lines t join public.job_work_receipts h on h.id = t.receipt_id', 'h.company_id', null),
  ('job_work_receipts',      'public.job_work_receipts t', 't.company_id', null),
  ('job_work_return_lines',  'public.job_work_return_lines t join public.job_work_returns h on h.id = t.return_id', 'h.company_id', null),
  ('job_work_returns',       'public.job_work_returns t', 't.company_id', null),
  ('worker_earning_lines',   'public.worker_earning_lines t join public.worker_earnings h on h.id = t.earning_id', 'h.company_id', null),
  ('worker_earnings',        'public.worker_earnings t', 't.company_id', null),
  ('stock_movements',        'public.stock_movements t', 't.company_id', null),
  ('stock_adjustment_lines', 'public.stock_adjustment_lines t join public.stock_adjustments h on h.id = t.adjustment_id', 'h.company_id', null),
  ('vouchers',               'public.vouchers t', 't.company_id', 't.party_side'),
  ('voucher_lines',          'public.voucher_lines t join public.vouchers h on h.id = t.voucher_id', 'h.company_id', 'h.party_side'),
  ('voucher_allocations',    'public.voucher_allocations t join public.vouchers h on h.id = t.voucher_id', 'h.company_id', 'h.party_side'),
  ('payment_reminders',      'public.payment_reminders t', 't.company_id',
                             'case t.side when ''CUSTOMER'' then ''RECEIVABLE'' else ''PAYABLE'' end');

-- -----------------------------------------------------------------------------
-- Value views (generated from the registry) + column privileges
-- -----------------------------------------------------------------------------
create or replace function secure.class_condition(p_class text, p_company text, p_side text)
returns text
language sql immutable
as $$
  select case p_class
    when 'MOVEMENT' then format('(case when t.direction = 1 then %1$s = any ((select secure.allowed(''LANDED''))::uuid[]) '
                                || 'else %1$s = any ((select secure.allowed(''AVERAGE''))::uuid[]) end)', p_company)
    when 'AMOUNT_SIDE' then format('(case %2$s when ''RECEIVABLE'' then %1$s = any ((select secure.allowed(''AMOUNT_SALE''))::uuid[]) '
                                   || 'when ''PAYABLE'' then %1$s = any ((select secure.allowed(''AMOUNT_PURCHASE''))::uuid[]) '
                                   || 'else %1$s = any ((select secure.allowed(''PROFIT''))::uuid[]) end)', p_company, p_side)
    else format('%s = any ((select secure.allowed(%L))::uuid[])', p_company, p_class) end
$$;

do $$
declare s record; v_cols text; v_names text[]; v_keep text;
begin
  for s in select * from secure.value_sources loop
    select string_agg(format('(case when %s then t.%I end)::%s as %I',
                             secure.class_condition(c.class, s.company_expr, s.side_expr), c.column_name,
                             (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                              where a.attrelid = ('public.' || quote_ident(s.table_name))::regclass and a.attname = c.column_name),
                             c.column_name), ', '
                      order by c.column_name),
           array_agg(c.column_name)
      into v_cols, v_names
    from secure.sensitive_columns c where c.table_name = s.table_name;
    execute format('create view secure.%I with (security_barrier) as select t.id, %s from %s where %s = any ((select app.user_company_ids())::uuid[])',
                   s.table_name || '_values', v_cols, s.from_clause, s.company_expr);
    execute format('revoke all on secure.%I from public, anon', s.table_name || '_values');
    execute format('grant select on secure.%I to authenticated, service_role', s.table_name || '_values');
    -- base table: every column except the sensitive ones
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_keep
    from information_schema.columns
    where table_schema = 'public' and table_name = s.table_name and column_name <> all (v_names);
    execute format('revoke select on public.%I from authenticated', s.table_name);
    execute format('grant select (%s) on public.%I to authenticated', v_keep, s.table_name);
  end loop;
end $$;
-- items: the R2 grant list already excludes the prices; job_work_rate joins them
revoke select (job_work_rate) on public.items from authenticated;

-- -----------------------------------------------------------------------------
-- Average cost (incremental, same rule as stock_valuation: weighted average of
-- inward movements with a rate) and margin
-- -----------------------------------------------------------------------------
create table public.item_cost_summary (
  item_id    uuid primary key references public.items (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  in_qty     numeric not null default 0,
  in_value   numeric not null default 0
);
alter table public.item_cost_summary enable row level security;   -- no policy: read only through secure views
grant all on public.item_cost_summary to service_role;
insert into public.item_cost_summary (item_id, company_id, in_qty, in_value)
select m.item_id, m.company_id, sum(m.base_qty), sum(m.base_qty * m.rate)
from public.stock_movements m
where m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0
group by m.item_id, m.company_id;

create or replace function app.tg_item_cost_summary()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.direction = 1 and new.reversal_of is null and coalesce(new.rate, 0) > 0 then
    insert into public.item_cost_summary as s (item_id, company_id, in_qty, in_value)
    values (new.item_id, new.company_id, new.base_qty, new.base_qty * new.rate)
    on conflict (item_id) do update set in_qty = s.in_qty + excluded.in_qty, in_value = s.in_value + excluded.in_value;
  end if;
  return null;
end;
$$;
create trigger stock_movements_cost_summary after insert on public.stock_movements
  for each row execute function app.tg_item_cost_summary();
revoke all on function app.tg_item_cost_summary() from public, anon, authenticated;

create view secure.item_cost_values with (security_barrier) as
select i.id as item_id,
       case when i.company_id = any ((select secure.allowed('AVERAGE'))::uuid[])
            then round(s.in_value / nullif(s.in_qty, 0), 4) end as avg_cost,
       case when i.company_id = any ((select secure.allowed('MARGIN'))::uuid[]) and i.sale_price is not null
            then round(i.sale_price - s.in_value / nullif(s.in_qty, 0), 4) end as margin,
       case when i.company_id = any ((select secure.allowed('MARGIN'))::uuid[]) and coalesce(i.sale_price, 0) > 0
            then round((i.sale_price - s.in_value / nullif(s.in_qty, 0)) * 100 / i.sale_price, 2) end as margin_pct
from public.items i
left join public.item_cost_summary s on s.item_id = i.id
where i.company_id = any ((select app.user_company_ids())::uuid[]);
grant select on secure.item_cost_values to authenticated, service_role;
-- raw inward totals for margin expressions inside invoker views (never selected as columns)
create view secure.item_cost_rows with (security_barrier) as
select s.item_id, s.in_qty, s.in_value from public.item_cost_summary s
where s.company_id = any ((select secure.allowed('MARGIN'))::uuid[]);
grant select on secure.item_cost_rows to authenticated, service_role;

-- masked item view: + job-work rate (PURCHASE), average cost, margin. The
-- R2 columns, order and filters stay as they are; new columns at the end.
create or replace view public.v_items with (security_barrier) as
select i.id, i.company_id, i.code, i.name, i.description, i.item_kind, i.category_id, i.brand_id, i.base_unit_id,
       i.purchase_unit_id, i.sales_unit_id, i.hsn_code, i.gst_rate, i.barcode, i.sku, i.notes, i.custom, i.min_stock,
       i.max_stock, i.reorder_level,
       (case when i.company_id = any ((select secure.allowed('PURCHASE'))::uuid[]) then i.job_work_rate end)::numeric(14,4) as job_work_rate,
       i.is_stock_tracked, i.is_active, i.is_deleted, i.portal_visible, i.created_at, i.updated_at,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) then i.sale_price end as sale_price,
       case when i.company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]) then i.purchase_price end as purchase_price,
       i.company_id = any ((select app.permitted_company_ids('items.view_sale_rate'))::uuid[]) as can_view_sale_rate,
       i.company_id = any ((select app.permitted_company_ids('items.view_purchase_rate'))::uuid[]) as can_view_purchase_rate,
       i.company_id = any ((select app.permitted_company_ids('items.edit_rate'))::uuid[]) as can_edit_rate,
       c.avg_cost, c.margin, c.margin_pct
from public.items i
left join secure.item_cost_values c on c.item_id = i.id
where i.company_id = any ((select app.user_company_ids())::uuid[])
  and (i.company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[])
       or i.id = any ((select app.scope_allowed_ids('ITEM'))::uuid[]));
revoke insert, update, delete on public.v_items from authenticated, anon;

-- -----------------------------------------------------------------------------
-- Journal lines: row level by ledger class (pre-existing gap: every member
-- could read every line, and the financial report functions had no check)
-- -----------------------------------------------------------------------------
alter table public.journal_entry_lines add column ledger_class text not null default 'OTHER'
  check (ledger_class in ('RECEIVABLE', 'PAYABLE', 'OTHER'));
-- derived classification of existing lines: the append-only guard is lifted for this one
-- backfill statement only (amounts, accounts and dates are not touched)
do $$
declare v_trg text;
begin
  select tgname into v_trg from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'public.journal_entry_lines'::regclass and p.proname = 'tg_block_mutation' and not t.tgisinternal
    and (t.tgtype & 16) <> 0;      -- the UPDATE trigger
  if v_trg is not null then execute format('alter table public.journal_entry_lines disable trigger %I', v_trg); end if;
  update public.journal_entry_lines l set ledger_class = case a.sub_type when 'RECEIVABLE_CONTROL' then 'RECEIVABLE'
                                                                        when 'PAYABLE_CONTROL' then 'PAYABLE' else 'OTHER' end
  from public.accounts a where a.id = l.account_id;
  if v_trg is not null then execute format('alter table public.journal_entry_lines enable trigger %I', v_trg); end if;
end $$;

create or replace function app.tg_journal_line_class()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  select case a.sub_type when 'RECEIVABLE_CONTROL' then 'RECEIVABLE' when 'PAYABLE_CONTROL' then 'PAYABLE' else 'OTHER' end
    into new.ledger_class from public.accounts a where a.id = new.account_id;
  return new;
end;
$$;
create trigger journal_entry_lines_class before insert on public.journal_entry_lines
  for each row execute function app.tg_journal_line_class();
revoke all on function app.tg_journal_line_class() from public, anon, authenticated;

drop policy journal_entry_lines_read on public.journal_entry_lines;
create policy journal_entry_lines_read on public.journal_entry_lines for select to authenticated
  using (case ledger_class
           when 'RECEIVABLE' then company_id = any ((select secure.allowed('AMOUNT_SALE'))::uuid[])
           when 'PAYABLE' then company_id = any ((select secure.allowed('AMOUNT_PURCHASE'))::uuid[])
           else company_id = any ((select secure.allowed('PROFIT'))::uuid[]) end);
drop policy journal_entries_read on public.journal_entries;
create policy journal_entries_read on public.journal_entries for select to authenticated
  using (company_id = any ((select secure.allowed('AMOUNT'))::uuid[])
         or company_id = any ((select secure.allowed('PROFIT'))::uuid[]));

-- party rates / rate history: every rate type is classified (R2 covered SALE / PURCHASE)
create or replace function secure.rate_type_class(p_rate_type text)
returns text language sql immutable as $$
  select case when p_rate_type in ('SALE', 'ISSUE') then 'SALE' else 'PURCHASE' end
$$;
drop policy if exists party_item_rates_field_read on public.party_item_rates;
create policy party_item_rates_field_read on public.party_item_rates as restrictive for select to authenticated
  using (case when rate_type in ('SALE', 'ISSUE') then company_id = any ((select secure.allowed('SALE'))::uuid[])
              else company_id = any ((select secure.allowed('PURCHASE'))::uuid[]) end);
do $$
declare v_pol text;
begin
  for v_pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'item_rate_history' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.item_rate_history', v_pol);
  end loop;
end $$;
create policy item_rate_history_read on public.item_rate_history for select to authenticated
  using (company_id = any ((select app.permitted_company_ids('items.view'))::uuid[])
         and case when rate_type in ('SALE', 'ISSUE') then company_id = any ((select secure.allowed('SALE'))::uuid[])
                  else company_id = any ((select secure.allowed('PURCHASE'))::uuid[]) end);

-- -----------------------------------------------------------------------------
-- Unmasked copies for internal logic (voucher posting, reminders, portal
-- outstanding): definer functions must compute with the real amounts, never
-- with what the current caller may see. Schema `app` is not exposed by the API.
-- -----------------------------------------------------------------------------
create view app.v_bills_raw as
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

create view app.v_bill_outstanding_raw as
select b.bill_table, b.bill_id, b.company_id, b.party_id, b.doc_no, b.doc_date, b.bill_amount, b.side, b.due_date,
       p.name as party_name, app.bill_settled(b.bill_table, b.bill_id) as settled_amount,
       b.bill_amount - app.bill_settled(b.bill_table, b.bill_id) as outstanding_amount,
       current_date - b.doc_date as age_days, current_date - b.due_date as overdue_days
from app.v_bills_raw b join public.parties p on p.id = b.party_id;
revoke all on app.v_bills_raw, app.v_bill_outstanding_raw from public, anon, authenticated;

do $$
declare f text; v_def text;
begin
  foreach f in array array['app.portal_payments', 'app.post_voucher', 'app.reminder_still_due', 'app.tg_cancel_paid_reminders',
                           'public.portal_my_outstanding', 'public.portal_vendor_payments', 'public.run_payment_reminders'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = f::regproc;
    v_def := regexp_replace(v_def, '(public\.)?\mv_bill_outstanding\M', 'app.v_bill_outstanding_raw', 'g');
    v_def := regexp_replace(v_def, '(public\.)?\mv_bills\M', 'app.v_bills_raw', 'g');
    execute v_def;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Invoker views rewritten on the value views (RLS of the base tables unchanged)
-- -----------------------------------------------------------------------------
create or replace view public.v_bills with (security_invoker = true) as
select 'customer_bills'::text as bill_table, b.id as bill_id, b.company_id, b.party_id, b.doc_no, b.doc_date,
       (case when b.company_id = any ((select secure.allowed('AMOUNT'))::uuid[]) then f.amount end)::numeric(16,2) as bill_amount,
       'RECEIVABLE'::text as side, b.due_date
from public.customer_bills b left join secure.customer_bills_values f on f.id = b.id
where b.status = 'POSTED'
union all
select 'material_issues', m.id, m.company_id, m.party_id, m.doc_no, m.doc_date,
       (case when m.company_id = any ((select secure.allowed('AMOUNT'))::uuid[]) then f.total_amount end)::numeric(16,2),
       'RECEIVABLE', m.doc_date
from public.material_issues m left join secure.material_issues_values f on f.id = m.id
where m.status = 'POSTED'
union all
select 'job_work_receipts', r.id, r.company_id, r.party_id, r.doc_no, r.doc_date,
       (case when r.company_id = any ((select secure.allowed('AMOUNT'))::uuid[]) then f.total_amount end)::numeric(16,2),
       'PAYABLE', r.due_date
from public.job_work_receipts r left join secure.job_work_receipts_values f on f.id = r.id
where r.status = 'POSTED'
union all
select 'purchase_receipts', r.id, r.company_id, r.party_id, r.doc_no, r.doc_date,
       (case when r.company_id = any ((select secure.allowed('AMOUNT'))::uuid[]) then f.total_amount end)::numeric(16,2),
       'PAYABLE', r.due_date
from public.purchase_receipts r left join secure.purchase_receipts_values f on f.id = r.id
where r.status = 'POSTED'
union all
select 'service_bills', s.id, s.company_id, s.party_id, s.doc_no, s.doc_date,
       (case when s.company_id = any ((select secure.allowed('AMOUNT'))::uuid[]) then f.total_amount end)::numeric(16,2),
       'PAYABLE', s.due_date
from public.service_bills s left join secure.service_bills_values f on f.id = s.id
where s.status = 'POSTED'
union all
select 'worker_earnings', w.id, w.company_id, w.party_id, w.doc_no, w.doc_date,
       (case when w.company_id = any ((select secure.allowed('AMOUNT'))::uuid[]) then f.total_amount end)::numeric(16,2),
       'PAYABLE', w.doc_date
from public.worker_earnings w left join secure.worker_earnings_values f on f.id = w.id
where w.status = 'POSTED';

-- settled amount only next to a visible bill amount
create or replace view public.v_bill_outstanding with (security_invoker = true) as
select b.bill_table, b.bill_id, b.company_id, b.party_id, b.doc_no, b.doc_date, b.bill_amount, b.side, b.due_date,
       p.name as party_name,
       case when b.bill_amount is not null then app.bill_settled(b.bill_table, b.bill_id) end as settled_amount,
       case when b.bill_amount is not null then b.bill_amount - app.bill_settled(b.bill_table, b.bill_id) end as outstanding_amount,
       current_date - b.doc_date as age_days,
       current_date - b.due_date as overdue_days
from public.v_bills b join public.parties p on p.id = b.party_id;

create or replace view public.v_customer_bill_register with (security_invoker = true) as
select b.company_id, b.id as bill_id, b.party_id, p.name as party_name, a.code as place, b.doc_date as bill_date, b.bill_no,
       (case when x.ok then f.amount end)::numeric(16,2) as amount,
       case when x.ok then coalesce(s.tds, 0) end as tds,
       case when x.ok then coalesce(s.received, 0) end as amount_received,
       s.received_date,
       case when x.ok then coalesce(s.tds, 0) + coalesce(s.received, 0) - f.amount end as less_amount,
       case when x.ok then coalesce(s.debit_note, 0) end as debit_note,
       s.debit_note_refs,
       case when x.ok then f.amount - coalesce(s.settled, 0) end as outstanding
from public.customer_bills b
join public.parties p on p.id = b.party_id
left join public.party_addresses a on a.id = b.ship_to_address_id
left join secure.customer_bills_values f on f.id = b.id
cross join lateral (select b.company_id = any ((select secure.allowed('AMOUNT_SALE'))::uuid[]) as ok) x
left join lateral (
  select sum(xa.tds_amount) as tds, sum(xa.amount) as received, max(v.doc_date) as received_date,
         sum(xa.debit_note_amount) as debit_note, string_agg(al.debit_note_ref, ', ') as debit_note_refs,
         sum(xa.amount + xa.tds_amount + xa.short_amount + xa.debit_note_amount) as settled
  from secure.voucher_allocations_values xa
  join public.voucher_allocations al on al.id = xa.id
  join public.vouchers v on v.id = al.voucher_id
  where al.bill_table = 'customer_bills' and al.bill_id = b.id and v.status = 'POSTED') s on true
where b.status = 'POSTED';

create or replace view public.v_payment_allocations with (security_invoker = true) as
select v.company_id, v.id as voucher_id, v.doc_no as voucher_no, v.doc_date as payment_date, v.voucher_type, v.payment_method,
       v.party_id, fv.amount as voucher_amount, v.instrument_ref, a.bill_table, a.bill_id, b.doc_no as bill_no,
       b.doc_date as bill_date, b.bill_amount, fa.amount as allocated_amount, fa.tds_amount, fa.short_amount, fa.debit_note_amount
from public.vouchers v
join public.voucher_allocations a on a.voucher_id = v.id
left join secure.vouchers_values fv on fv.id = v.id
left join secure.voucher_allocations_values fa on fa.id = a.id
left join public.v_bills b on b.bill_table = a.bill_table and b.bill_id = a.bill_id
where v.status = 'POSTED';

create or replace view public.v_payment_reminders with (security_invoker = true) as
select r.id, r.company_id, r.side, r.bill_table, r.bill_id, r.party_id, r.reminder_date, r.due_date,
       f.outstanding_amount, r.outbox_id, r.created_at, p.name as party_name,
       e.status as email_status, e.to_emails, e.last_error, e.sent_at
from public.payment_reminders r
join public.parties p on p.id = r.party_id
left join public.email_outbox e on e.id = r.outbox_id
left join secure.payment_reminders_values f on f.id = r.id;

create or replace view public.v_purchase_order_lines with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no as po_no, o.doc_date as po_date, o.expected_date, o.status as order_status,
       o.party_id, p.name as party_name, o.godown_id, ol.id as po_line_id, ol.line_no, ol.item_id, i.code as item_code,
       i.name as item_name, ol.qty, u.code as unit, f.rate, ol.ordered_base_qty,
       app.purchase_received(ol.id) as received_base_qty,
       ol.ordered_base_qty - app.purchase_received(ol.id) as pending_base_qty
from public.purchase_orders o
join public.purchase_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.units u on u.id = ol.unit_id
join public.parties p on p.id = o.party_id
left join secure.purchase_order_lines_values f on f.id = ol.id
where o.status <> all (array['DRAFT', 'PENDING_APPROVAL', 'CANCELLED']::public.order_status[]);

create or replace view public.v_sales_order_lines with (security_invoker = true) as
select o.company_id, o.id as order_id, o.doc_no, o.customer_po_no, o.doc_date as po_date, o.delivery_date,
       o.status as order_status, o.party_id, p.name as party_name, o.customer_po_id, o.ship_to_address_id, a.code as dc_code,
       exists (select 1 from public.sales_order_date_revisions r where r.sales_order_id = o.id) as is_revised,
       ol.id as order_line_id, ol.line_no, ol.item_id, i.code as item_code, i.name as item_name, ol.qty, ol.unit_id,
       f.rate as approved_rate, f.quoted_rate, f.reference_rate, ol.ordered_base_qty,
       app.dispatched_qty(ol.id) as dispatched_base_qty,
       ol.ordered_base_qty - app.dispatched_qty(ol.id) as pending_base_qty,
       app.line_reserved(ol.id) as reserved_base_qty,
       greatest(ol.ordered_base_qty - app.dispatched_qty(ol.id) - app.line_reserved(ol.id), 0) as unreserved_base_qty,
       dp.factor as pack_factor,
       case when dp.factor is not null then round(ol.ordered_base_qty / dp.factor, 3) end as ordered_pack_qty,
       case when dp.factor is not null then round((ol.ordered_base_qty - app.dispatched_qty(ol.id)) / dp.factor, 3) end as pending_pack_qty,
       -- gross margin per base unit (rate is per base unit after factor)
       case when o.company_id = any ((select secure.allowed('MARGIN'))::uuid[]) and f.rate is not null and c.in_qty > 0
            then round(f.rate / nullif(ol.factor_to_base, 0) - c.in_value / c.in_qty, 4) end as margin_per_base
from public.sales_orders o
join public.sales_order_lines ol on ol.order_id = o.id
join public.items i on i.id = ol.item_id
join public.parties p on p.id = o.party_id
left join public.party_addresses a on a.id = o.ship_to_address_id
left join lateral app.default_packing(i.id, current_date) dp(unit_id, factor) on true
left join secure.sales_order_lines_values f on f.id = ol.id
left join secure.item_cost_rows c on c.item_id = ol.item_id
where o.status <> all (array['DRAFT', 'PENDING_APPROVAL', 'CANCELLED']::public.order_status[]);

create or replace view public.v_customer_po_lines with (security_invoker = true) as
select c.company_id, c.id as customer_po_id, c.po_no, c.po_date, c.requested_delivery_date, c.status, c.source, c.party_id,
       p.name as party_name, c.sales_order_id, so.doc_no as sales_order_no, c.remarks, c.review_remarks, c.reject_reason,
       c.created_at, c.reviewed_at, l.id as line_id, l.line_no, l.item_id, i.code as item_code, i.name as item_name, l.qty,
       u.code as unit, l.base_qty, f.reference_rate, f.quoted_rate, f.approved_rate,
       case when f.quoted_rate is not null and f.reference_rate is not null then f.quoted_rate - f.reference_rate end as quote_difference
from public.customer_pos c
join public.parties p on p.id = c.party_id
join public.customer_po_lines l on l.customer_po_id = c.id
join public.items i on i.id = l.item_id
join public.units u on u.id = l.unit_id
left join public.sales_orders so on so.id = c.sales_order_id
left join secure.customer_po_lines_values f on f.id = l.id;

create or replace view public.v_party_balances with (security_invoker = true) as
select p.company_id, p.id as party_id, p.code, p.name,
       case when p.company_id = any ((select secure.allowed('AMOUNT_SALE'))::uuid[])
            then coalesce(sum(l.debit - l.credit) filter (where l.ledger_class = 'RECEIVABLE'), 0) end as receivable_balance,
       case when p.company_id = any ((select secure.allowed('AMOUNT_PURCHASE'))::uuid[])
            then coalesce(sum(l.credit - l.debit) filter (where l.ledger_class = 'PAYABLE'), 0) end as payable_balance,
       case when p.company_id = any ((select secure.allowed('AMOUNT_SALE'))::uuid[])
             and p.company_id = any ((select secure.allowed('AMOUNT_PURCHASE'))::uuid[])
            then coalesce(sum(l.debit - l.credit) filter (where l.ledger_class in ('RECEIVABLE', 'PAYABLE')), 0) end as net_balance
from public.parties p
left join public.journal_entry_lines l on l.party_id = p.id
group by p.company_id, p.id, p.code, p.name;

-- new: vouchers with masked amounts (payments screen)
create view public.v_vouchers with (security_invoker = true) as
select v.id, v.company_id, v.doc_no, v.doc_date, v.status, v.voucher_type, v.payment_method, v.party_id, v.party_side,
       v.cash_bank_account_id, v.to_account_id, v.instrument, v.instrument_ref, v.narration, f.amount,
       v.created_at, v.created_by, v.posted_at
from public.vouchers v left join secure.vouchers_values f on f.id = v.id;

-- new: document lines with masked rates (draft editors)
create view public.v_purchase_order_line_rates with (security_invoker = true) as
select l.id, l.order_id, l.line_no, l.item_id, l.qty, l.unit_id, l.ordered_base_qty, f.rate
from public.purchase_order_lines l left join secure.purchase_order_lines_values f on f.id = l.id;

-- new: stock movement cost (item page, cost reports)
create view public.v_stock_movement_costs with (security_invoker = true) as
select m.id as movement_id, m.company_id, m.item_id, m.godown_id, m.movement_date, m.movement_type, m.direction,
       m.base_qty, f.rate, f.value
from public.stock_movements m left join secure.stock_movements_values f on f.id = m.id;

do $$
declare v text;
begin
  foreach v in array array['v_bills', 'v_bill_outstanding', 'v_customer_bill_register', 'v_payment_allocations',
                           'v_payment_reminders', 'v_purchase_order_lines', 'v_sales_order_lines', 'v_customer_po_lines',
                           'v_party_balances', 'v_vouchers', 'v_purchase_order_line_rates', 'v_stock_movement_costs'] loop
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Report functions: explicit rights (they were callable by every member)
-- -----------------------------------------------------------------------------
create or replace function public.profit_loss(p_company_id uuid, p_from date, p_to date)
returns table (section text, account_code text, account_name text, amount numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_open numeric; v_close numeric; v_income numeric; v_expense numeric; v_stock boolean;
begin
  if not app.is_member(p_company_id) then return; end if;   -- other company: empty, as before
  perform secure.require_class(p_company_id, 'PROFIT', 'Profit & loss');
  v_stock := secure.class_ok(p_company_id, 'PROFIT_STOCK');
  if v_stock then
    select coalesce(sum(value), 0) into v_open from app.stock_value_rows(p_company_id, p_from - 1);
    select coalesce(sum(value), 0) into v_close from app.stock_value_rows(p_company_id, p_to);
  end if;
  return query
    select case a.account_type when 'INCOME' then 'INCOME' else 'EXPENSE' end, a.code, a.name,
           case a.account_type when 'INCOME' then sum(l.credit - l.debit) else sum(l.debit - l.credit) end
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type in ('INCOME', 'EXPENSE')
    group by a.account_type, a.code, a.name
    having sum(l.debit - l.credit) <> 0
    order by 1 desc, 2;
  select coalesce(sum(l.credit - l.debit), 0) into v_income
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type = 'INCOME';
  select coalesce(sum(l.debit - l.credit), 0) into v_expense
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to and a.account_type = 'EXPENSE';
  -- without the stock valuation right the stock lines and the result (which contains them) stay empty
  section := 'STOCK'; account_code := null; account_name := 'Opening stock'; amount := v_open; return next;
  section := 'STOCK'; account_name := 'Closing stock'; amount := v_close; return next;
  section := 'RESULT'; account_name := 'Net profit (loss)';
  amount := case when v_stock then v_income + v_close - v_expense - v_open end; return next;
end;
$$;

create or replace function public.balance_sheet(p_company_id uuid, p_as_on date)
returns table (section text, account_code text, account_name text, amount numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_pl numeric; v_stock numeric; v_ok boolean;
begin
  if not app.is_member(p_company_id) then return; end if;   -- other company: empty, as before
  perform secure.require_class(p_company_id, 'PROFIT', 'Balance sheet');
  v_ok := secure.class_ok(p_company_id, 'PROFIT_STOCK');
  return query
    select a.account_type::text, a.code, a.name,
           case when a.account_type = 'ASSET' then sum(l.debit - l.credit) else sum(l.credit - l.debit) end
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.entry_date <= p_as_on and a.account_type in ('ASSET', 'LIABILITY', 'EQUITY')
    group by a.account_type, a.code, a.name
    having sum(l.debit - l.credit) <> 0
    order by 1, 2;
  if v_ok then
    select coalesce(sum(value), 0) into v_stock from app.stock_value_rows(p_company_id, p_as_on);
  end if;
  select coalesce(sum(l.credit - l.debit), 0) into v_pl
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date <= p_as_on and a.account_type in ('INCOME', 'EXPENSE');
  section := 'ASSET'; account_code := null; account_name := 'Closing stock (valued)'; amount := v_stock; return next;
  section := 'EQUITY'; account_name := 'Profit & loss (incl. closing stock)';
  amount := case when v_ok then v_pl + v_stock end; return next;
end;
$$;

create or replace function public.trial_balance(p_company_id uuid, p_as_on date)
returns table (account_id uuid, account_code text, account_name text, account_type public.account_type, debit numeric, credit numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then return; end if;   -- other company: empty, as before
  perform secure.require_class(p_company_id, 'PROFIT', 'Trial balance');
  return query
  select a.id, a.code, a.name, a.account_type, greatest(sum(l.debit - l.credit), 0), greatest(sum(l.credit - l.debit), 0)
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date <= p_as_on
  group by a.id, a.code, a.name, a.account_type
  having sum(l.debit - l.credit) <> 0
  order by a.code;
end;
$$;

create or replace function public.account_ledger(p_company_id uuid, p_account_id uuid, p_from date, p_to date)
returns table (entry_date date, entry_no text, source_table text, source_doc_no text, party_name text, narration text,
               debit numeric, credit numeric, balance numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_opening numeric;
begin
  if not app.is_member(p_company_id) then return; end if;   -- other company: empty, as before
  perform secure.require_class(p_company_id, 'PROFIT', 'Account ledger');
  select coalesce(sum(jl.debit - jl.credit), 0) into v_opening from public.journal_entry_lines jl
   where jl.company_id = p_company_id and jl.account_id = p_account_id and jl.entry_date < p_from;
  entry_date := p_from; entry_no := null; source_table := null; source_doc_no := 'Opening balance';
  party_name := null; narration := null; debit := null; credit := null; balance := v_opening;
  return next;
  return query
    select l.entry_date, e.entry_no, e.source_table, e.source_doc_no, p.name, coalesce(l.narration, e.narration),
           nullif(l.debit, 0), nullif(l.credit, 0), v_opening + sum(l.debit - l.credit) over (order by l.entry_date, l.id)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    left join public.parties p on p.id = l.party_id
    where l.company_id = p_company_id and l.account_id = p_account_id and l.entry_date between p_from and p_to
    order by l.entry_date, l.id;
end;
$$;

create or replace function public.day_book(p_company_id uuid, p_from date, p_to date)
returns table (entry_date date, entry_no text, source_table text, source_doc_no text, account_name text, party_name text,
               debit numeric, credit numeric, narration text)
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then return; end if;   -- other company: empty, as before
  perform secure.require_class(p_company_id, 'PROFIT', 'Day book');
  return query
  select l.entry_date, e.entry_no, e.source_table, e.source_doc_no, a.name, p.name,
         nullif(l.debit, 0), nullif(l.credit, 0), coalesce(l.narration, e.narration)
  from public.journal_entry_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a on a.id = l.account_id
  left join public.parties p on p.id = l.party_id
  where l.company_id = p_company_id and l.entry_date between p_from and p_to
  order by l.entry_date, e.entry_no, l.id;
end;
$$;

-- party ledger: the receivable side needs AMOUNT+SALE, the payable side AMOUNT+PURCHASE
create or replace function public.party_ledger(p_company_id uuid, p_party_id uuid, p_from date, p_to date, p_side text default null)
returns table (entry_date date, entry_no text, source_table text, source_doc_no text, account_name text, narration text,
               debit numeric, credit numeric, balance numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_opening numeric;
begin
  if p_side is not null and p_side not in ('RECEIVABLE', 'PAYABLE') then
    raise exception 'side must be RECEIVABLE, PAYABLE or null' using errcode = 'P0001';
  end if;
  if not app.is_member(p_company_id) then return; end if;
  if p_side = 'RECEIVABLE' then
    perform secure.require_class(p_company_id, 'AMOUNT_SALE', 'The customer ledger');
  elsif p_side = 'PAYABLE' then
    perform secure.require_class(p_company_id, 'AMOUNT_PURCHASE', 'The vendor ledger');
  else
    perform secure.require_class(p_company_id, 'AMOUNT_SALE', 'The party ledger');
    perform secure.require_class(p_company_id, 'AMOUNT_PURCHASE', 'The party ledger');
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_opening
  from public.journal_entry_lines l
  where l.company_id = p_company_id and l.party_id = p_party_id and l.entry_date < p_from
    and l.ledger_class in ('RECEIVABLE', 'PAYABLE') and (p_side is null or l.ledger_class = p_side);
  entry_date := p_from; entry_no := null; source_table := null; source_doc_no := 'Opening balance';
  account_name := null; narration := null; debit := null; credit := null; balance := v_opening;
  return next;
  return query
    select l.entry_date, e.entry_no, e.source_table, e.source_doc_no, a.name, coalesce(l.narration, e.narration),
           nullif(l.debit, 0), nullif(l.credit, 0), v_opening + sum(l.debit - l.credit) over (order by l.entry_date, l.id)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.party_id = p_party_id and l.entry_date between p_from and p_to
      and l.ledger_class in ('RECEIVABLE', 'PAYABLE') and (p_side is null or l.ledger_class = p_side)
    order by l.entry_date, l.id;
end;
$$;

-- stock valuation: valuation right; the average rate column needs average cost
create or replace function public.stock_valuation(p_company_id uuid, p_as_on date)
returns table (item_id uuid, item_code text, item_name text, base_qty numeric, avg_rate numeric, value numeric)
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_avg boolean;
begin
  perform secure.require_class(p_company_id, 'VALUATION', 'Stock valuation');
  v_avg := secure.class_ok(p_company_id, 'AVERAGE');
  return query
  with q as (
    select m.item_id, sum(m.signed_base_qty) as qty,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0 then m.base_qty * m.rate end) as in_value,
           sum(case when m.direction = 1 and m.reversal_of is null and coalesce(m.rate, 0) > 0 then m.base_qty end) as in_qty
    from public.stock_movements m
    where m.company_id = p_company_id and m.movement_date <= p_as_on
      and (m.company_id = any (app.godown_unrestricted_company_ids()) or m.godown_id = any (app.allowed_godown_ids()))
    group by m.item_id)
  select i.id, i.code, i.name, q.qty,
         case when v_avg then round(coalesce(q.in_value / nullif(q.in_qty, 0), 0), 4) end,
         round(greatest(q.qty, 0) * coalesce(q.in_value / nullif(q.in_qty, 0), 0), 2)
  from q join public.items i on i.id = q.item_id
  where q.qty <> 0
    and (i.company_id = any (app.scope_unrestricted_company_ids('ITEM')) or i.id = any (app.scope_allowed_ids('ITEM')))
  order by i.name;
end;
$$;

-- rate suggestion (document entry): definer now, every type needs its class and the record scope
create or replace function public.suggest_rate(p_company_id uuid, p_rate_type text, p_party_id uuid, p_item_id uuid,
                                               p_godown_id uuid default null, p_on date default current_date)
returns numeric
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v numeric;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  if not secure.class_ok(p_company_id, case when p_rate_type in ('SALE', 'ISSUE') then 'SALE' else 'PURCHASE' end)
     or (p_party_id is not null and not app.party_allowed(p_company_id, p_party_id))
     or not app.scope_allows(p_company_id, 'ITEM', p_item_id) then
    return null;
  end if;
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
    if v is null then
      v := app.vendor_price(p_company_id, p_party_id, p_item_id, p_on);
    end if;
  elsif p_rate_type = 'SALE' then
    v := app.customer_price(p_company_id, p_party_id, p_item_id, p_on);
  end if;
  return v;
end;
$$;

-- printing a PO shows its rates
create or replace function public.purchase_order_print(p_po_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare o public.purchase_orders;
begin
  select * into o from public.purchase_orders where id = p_po_id;
  if o.id is null or not (app.is_trusted_caller() or app.has_permission(o.company_id, 'purchase_order.view')) then
    raise exception 'Purchase order not found' using errcode = 'P0001';
  end if;
  if not app.is_trusted_caller() then
    perform secure.require_class(o.company_id, 'PURCHASE', 'Printing a purchase order (it shows the rates)');
  end if;
  perform app.assert_doc_godown_scope('purchase_orders', p_po_id);
  perform app.assert_doc_party_scope('purchase_orders', p_po_id);
  return app.purchase_order_print_data(p_po_id);
end;
$$;

-- the cost summary has an item column: register it (no read policy at all = no direct access)
insert into app.data_scope_registry (table_name, dimension, columns, read_any, guard_writes)
values ('item_cost_summary', 'ITEM', '{item_id}', false, false) on conflict do nothing;
create policy item_cost_summary_item_scope on public.item_cost_summary as restrictive for select to authenticated
  using ((company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[]))
         or (item_id = any ((select app.scope_allowed_ids('ITEM'))::uuid[])));

insert into secure.reviewed_functions values
  ('public.profit_loss', 'PROFIT; stock lines and result need VALUATION'),
  ('public.balance_sheet', 'PROFIT; stock lines and result need VALUATION'),
  ('public.trial_balance', 'PROFIT'), ('public.account_ledger', 'PROFIT'), ('public.day_book', 'PROFIT'),
  ('public.party_ledger', 'AMOUNT_SALE / AMOUNT_PURCHASE per side; journal rows also row-level'),
  ('public.stock_valuation', 'VALUATION; avg rate AVERAGE'),
  ('public.suggest_rate', 'class of the rate type + party / item scope; NULL otherwise'),
  ('public.purchase_order_print', 'PURCHASE (trusted worker exempt)'),
  ('app.purchase_order_print_data', 'only called by purchase_order_print / the worker'),
  ('app.stock_value_rows', 'only called by profit_loss / balance_sheet after the class check'),
  ('app.bill_settled', 'used in v_bill_outstanding only next to a visible bill amount'),
  ('app.portal_payments', 'internal: unmasked app.v_bills_raw'), ('app.post_voucher', 'internal: unmasked app.v_bills_raw'),
  ('app.reminder_still_due', 'internal: unmasked app.v_bill_outstanding_raw'),
  ('app.tg_cancel_paid_reminders', 'internal: unmasked app.v_bill_outstanding_raw'),
  ('public.portal_catalog', 'portal: own party, rates per portal settings + portal role'),
  ('public.portal_my_invoices', 'portal: own party'), ('public.portal_my_outstanding', 'portal: own party, setting'),
  ('public.portal_my_customer_pos', 'portal: own party'), ('public.portal_my_orders', 'portal: own party'),
  ('public.portal_vendor_pos', 'portal: own party, rate setting'), ('public.portal_vendor_payments', 'portal: own party, setting'),
  ('public.portal_vendor_po_print', 'portal: own party'), ('public.portal_context', 'portal: own party'),
  ('public.portal_customer_po_create', 'portal: writes own PO'), ('public.portal_my_payments', 'portal: own party'),
  ('public.export_rows', 'invoker: reads masked views / row-level tables only'),
  ('public.customer_po_approve', 'write: approver enters / confirms rates'),
  ('public.sales_order_line_set_rate', 'write'), ('public.voucher_set_allocations', 'write'),
  ('public.run_payment_reminders', 'queues reminder e-mails to parties (worker / settings_reminders.edit)'),
  ('public.party_save', 'writes credit limit (whitelisted master data)');

revoke all on function secure.class_ok(uuid, text), secure.allowed(text), secure.require_class(uuid, text, text),
                       secure.class_condition(text, text, text), secure.rate_type_class(text) from public, anon;
grant execute on function secure.class_ok(uuid, text), secure.allowed(text), secure.require_class(uuid, text, text),
                          secure.class_condition(text, text, text), secure.rate_type_class(text) to authenticated, service_role;
grant select on all tables in schema secure to service_role;

-- -----------------------------------------------------------------------------
-- Self-check: no invoker view of the public schema may read a protected column
-- (it would either fail or bypass the masking)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(distinct v.relname || '.' || a.attname || ' via ' || t.relname, ', ') into v_bad
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class v on v.oid = r.ev_class and v.relkind = 'v'
  join pg_namespace vn on vn.oid = v.relnamespace and vn.nspname = 'public'
  join pg_class t on t.oid = d.refobjid
  join pg_namespace tn on tn.oid = t.relnamespace and tn.nspname = 'public'
  join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
  join secure.sensitive_columns s on s.table_name = t.relname and s.column_name = a.attname and s.class <> 'ROW_LEVEL'
  where v.relname <> 'v_items'                                   -- definer view with explicit masking
    and coalesce(array_to_string(v.reloptions, ','), '') like '%security_invoker=true%';
  if v_bad is not null then
    raise exception 'Invoker views still read protected columns: %', v_bad;
  end if;
end $$;
