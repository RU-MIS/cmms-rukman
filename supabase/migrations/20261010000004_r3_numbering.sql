-- =============================================================================
-- PLATFORM R3 (4/10) — document and master numbering (W2)
--   * pattern tokens {PREFIX} {FY} {YYYY} {YY} {MM} {NUMBER}
--   * reset NEVER / FY / CALENDAR (calendar year) / MONTHLY
--   * sequence_save: future numbers only; the start number can never be set at
--     or below a number already issued in the current period; the next number
--     must not exist already (no collision after a pattern change)
--   * master code sequences ITEM / CUSTOMER / VENDOR / GODOWN (off by default:
--     an empty code is filled only while the sequence is active)
--   * CUSTOMER_BILL: internal reference when the invoice number is left empty
-- Issued numbers are never changed. Gap-free under concurrency (counter row lock).
-- =============================================================================

alter table public.document_sequences drop constraint document_sequences_reset_policy_check;
alter table public.document_sequences add constraint document_sequences_reset_policy_check
  check (reset_policy in ('NEVER', 'FY', 'CALENDAR', 'MONTHLY'));
alter table public.document_sequences add column is_active boolean not null default true;
alter table public.document_sequences add column label text;
alter table app.default_sequences add column is_active boolean not null default true;
alter table app.default_sequences add column label text;

insert into app.default_sequences (doc_type, prefix, pattern, padding, reset_policy, is_active, label) values
  ('ITEM',          'ITM-', '{PREFIX}{NUMBER}', 5, 'NEVER', false, 'Item code'),
  ('CUSTOMER',      'CUS-', '{PREFIX}{NUMBER}', 5, 'NEVER', false, 'Customer code'),
  ('VENDOR',        'VEN-', '{PREFIX}{NUMBER}', 5, 'NEVER', false, 'Vendor code'),
  ('GODOWN',        'GDN-', '{PREFIX}{NUMBER}', 3, 'NEVER', false, 'Godown code'),
  ('CUSTOMER_BILL', 'INV-', '{PREFIX}{FY}/{NUMBER}', 4, 'FY', false, 'Invoice reference (when the invoice number is left empty)')
on conflict (doc_type) do nothing;
update app.default_sequences d set label = x.label from (values
  ('CUSTOMER_PO', 'Customer PO'), ('DISPATCH', 'Dispatch'), ('JOB_WORK_ORDER', 'Job-work order'), ('JOB_WORK_RECEIPT', 'Job-work receipt'),
  ('JOB_WORK_RETURN', 'Job-work debit note'), ('JOURNAL', 'Journal'), ('MATERIAL_ISSUE', 'Material issue'), ('PRODUCTION_LOT', 'Production lot'),
  ('PRODUCTION_RECEIPT', 'Production receipt'), ('PURCHASE_ORDER', 'Purchase order'), ('PURCHASE_RECEIPT', 'Purchase receipt'),
  ('PURCHASE_RETURN', 'Purchase return'), ('SALES_ORDER', 'Sales order'), ('SALES_RETURN', 'Sales return'), ('SERVICE_BILL', 'Service bill'),
  ('STOCK_ADJUSTMENT', 'Stock adjustment'), ('STOCK_TRANSFER', 'Stock transfer'), ('VOUCHER_ADJUST', 'Adjustment voucher'),
  ('VOUCHER_CONTRA', 'Contra voucher'), ('VOUCHER_JOURNAL', 'Journal voucher'), ('VOUCHER_PAYMENT', 'Payment'),
  ('VOUCHER_RECEIPT', 'Receipt'), ('WORKER_EARNING', 'Worker earnings')) x(t, label)
where d.doc_type = x.t and d.label is null;
-- existing companies: add the new sequences (inactive), labels for all
insert into public.document_sequences (company_id, doc_type, prefix, pattern, padding, reset_policy, is_active, label)
select c.id, d.doc_type, d.prefix, d.pattern, d.padding, d.reset_policy, d.is_active, d.label
from public.companies c cross join app.default_sequences d
on conflict (company_id, doc_type) do nothing;
update public.document_sequences s set label = d.label from app.default_sequences d
where d.doc_type = s.doc_type and s.label is null;

-- new companies: include is_active / label
do $$
declare v_def text;
begin
  for v_def in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'app' and p.prosrc like '%from app.default_sequences%' loop
    v_def := replace(v_def, 'insert into public.document_sequences (company_id, doc_type, prefix, pattern, padding, reset_policy)',
                     'insert into public.document_sequences (company_id, doc_type, prefix, pattern, padding, reset_policy, is_active, label)');
    v_def := replace(v_def, 'select p_company_id, doc_type, prefix, pattern, padding, reset_policy from app.default_sequences',
                     'select p_company_id, doc_type, prefix, pattern, padding, reset_policy, is_active, label from app.default_sequences');
    execute v_def;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Engine
-- -----------------------------------------------------------------------------
create or replace function app.doc_period_key(p_company_id uuid, p_reset text, p_date date)
returns text
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case p_reset when 'FY' then app.fy_code(p_company_id, p_date)
                      when 'CALENDAR' then to_char(p_date, 'YYYY')
                      when 'MONTHLY' then to_char(p_date, 'YYYY-MM')
                      else '' end
$$;

create or replace function app.format_doc_no(p_company_id uuid, s public.document_sequences, p_date date, p_value bigint)
returns text
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select replace(replace(replace(replace(replace(replace(s.pattern,
           '{PREFIX}', s.prefix),
           '{FY}', app.fy_code(p_company_id, p_date)),
           '{YYYY}', to_char(p_date, 'YYYY')),
           '{YY}', to_char(p_date, 'YY')),
           '{MM}', to_char(p_date, 'MM')),
           '{NUMBER}', case when length(p_value::text) >= s.padding then p_value::text else lpad(p_value::text, s.padding, '0') end)
$$;

create or replace function app.next_doc_no(p_company_id uuid, p_doc_type text, p_date date)
returns text
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare s public.document_sequences; v_period text; v_value bigint;
begin
  select * into s from public.document_sequences where company_id = p_company_id and doc_type = p_doc_type;
  if not found then
    raise exception 'Document numbering is not configured for %', p_doc_type using errcode = 'P0001';
  end if;
  v_period := app.doc_period_key(p_company_id, s.reset_policy, p_date);
  insert into public.document_sequence_counters as c (company_id, doc_type, period_key, next_value)
  values (p_company_id, p_doc_type, v_period, s.start_value + 1)
  on conflict (company_id, doc_type, period_key) do update set next_value = c.next_value + 1
  returning next_value - 1 into v_value;
  return app.format_doc_no(p_company_id, s, p_date, v_value);
end;
$$;

-- last number issued in the current period (null = none yet) and the preview of the next one
create or replace function app.sequence_state(p_company_id uuid, p_doc_type text, p_date date default current_date)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare s public.document_sequences; v_next bigint; v_period text;
begin
  select * into s from public.document_sequences where company_id = p_company_id and doc_type = p_doc_type;
  if s.doc_type is null then return null; end if;
  v_period := app.doc_period_key(p_company_id, s.reset_policy, p_date);
  select next_value into v_next from public.document_sequence_counters
   where company_id = p_company_id and doc_type = p_doc_type and period_key = v_period;
  return jsonb_build_object('period', v_period, 'last_issued', v_next - 1,
                            'next_value', coalesce(v_next, s.start_value),
                            'next_no', app.format_doc_no(p_company_id, s, p_date, coalesce(v_next, s.start_value)));
end;
$$;

-- where numbers of a type are stored (collision check after a pattern change)
create or replace function app.doc_no_exists(p_company_id uuid, p_doc_type text, p_doc_no text)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_table text; v_col text := 'doc_no'; v boolean;
begin
  v_table := case
    when p_doc_type = 'JOURNAL' then 'journal_entries'
    when p_doc_type like 'VOUCHER\_%' then 'vouchers'
    when p_doc_type = 'ITEM' then 'items'
    when p_doc_type in ('CUSTOMER', 'VENDOR') then 'parties'
    when p_doc_type = 'GODOWN' then 'godowns'
    when p_doc_type = 'CUSTOMER_PO' then 'customer_pos'
    else (select table_name from app.doc_types where doc_type = p_doc_type) end;
  if p_doc_type = 'JOURNAL' then v_col := 'entry_no';
  elsif p_doc_type in ('ITEM', 'CUSTOMER', 'VENDOR', 'GODOWN') then v_col := 'code';
  elsif p_doc_type = 'CUSTOMER_PO' then v_col := 'po_no';
  end if;
  if v_table is null then return false; end if;
  execute format('select exists (select 1 from public.%I where company_id = $1 and upper(%I) = upper($2))', v_table, v_col)
    into v using p_company_id, p_doc_no;
  return v;
end;
$$;

create or replace function public.numbering_list(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_numbering.view');
  return coalesce((select jsonb_agg(to_jsonb(s) - 'company_id' || jsonb_build_object('state', app.sequence_state(p_company_id, s.doc_type))
                                    order by coalesce(s.label, s.doc_type))
                   from public.document_sequences s where s.company_id = p_company_id), '[]');
end;
$$;

-- every change (API update or sequence_save) is validated here
create or replace function app.tg_sequence_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_period text; v_last bigint; v_next bigint; v_no text;
begin
  if position('{NUMBER}' in new.pattern) = 0 then
    raise exception 'The pattern must contain {NUMBER}' using errcode = 'P0001';
  end if;
  if new.pattern ~ '\{(?!PREFIX\}|FY\}|YYYY\}|YY\}|MM\}|NUMBER\})' then
    raise exception 'Unknown token in the pattern. Allowed: {PREFIX} {FY} {YYYY} {YY} {MM} {NUMBER}' using errcode = 'P0001';
  end if;
  if new.start_value < 1 then
    raise exception 'The start number must be at least 1' using errcode = 'P0001';
  end if;
  v_period := app.doc_period_key(new.company_id, new.reset_policy, current_date);
  select next_value - 1 into v_last from public.document_sequence_counters
   where company_id = new.company_id and doc_type = new.doc_type and period_key = v_period;
  if new.start_value is distinct from old.start_value and v_last is not null and new.start_value <= v_last then
    raise exception 'Number % has already been issued in this period; the start number must be higher than %', v_last, v_last
      using errcode = 'P0001';
  end if;
  v_next := case when v_last is null then new.start_value else greatest(v_last + 1, new.start_value) end;
  v_no := app.format_doc_no(new.company_id, new, current_date, v_next);
  if (new.prefix, new.pattern, new.padding, new.reset_policy, new.start_value) is distinct from
     (old.prefix, old.pattern, old.padding, old.reset_policy, old.start_value)
     and app.doc_no_exists(new.company_id, new.doc_type, v_no) then
    raise exception 'The next number % already exists. Choose another prefix, pattern or a higher start number.', v_no
      using errcode = 'P0001';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  perform app.audit(new.company_id, 'document_sequences', new.doc_type, 'NUMBERING',
                    to_jsonb(old) - 'company_id' - 'updated_at' - 'updated_by', to_jsonb(new) - 'company_id' - 'updated_at' - 'updated_by');
  return new;
end;
$$;
create trigger document_sequences_guard before update on public.document_sequences
  for each row execute function app.tg_sequence_guard();

-- a higher start number applies to the current period at once
create or replace function app.tg_sequence_start()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.start_value > old.start_value then
    update public.document_sequence_counters set next_value = new.start_value
     where company_id = new.company_id and doc_type = new.doc_type
       and period_key = app.doc_period_key(new.company_id, new.reset_policy, current_date) and next_value < new.start_value;
  end if;
  return null;
end;
$$;
create trigger document_sequences_start after update of start_value on public.document_sequences
  for each row execute function app.tg_sequence_start();

create or replace function public.sequence_save(p_company_id uuid, p_doc_type text, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_numbering.edit');
  update public.document_sequences set
    prefix = coalesce(p_payload->>'prefix', prefix),
    pattern = coalesce(nullif(trim(p_payload->>'pattern'), ''), pattern),
    padding = coalesce((p_payload->>'padding')::smallint, padding),
    reset_policy = coalesce(upper(p_payload->>'reset_policy'), reset_policy),
    start_value = coalesce((p_payload->>'start_value')::bigint, start_value),
    is_active = coalesce((p_payload->>'is_active')::boolean, is_active)
  where company_id = p_company_id and doc_type = p_doc_type;
  if not found then
    raise exception 'Unknown sequence %', p_doc_type using errcode = 'P0001';
  end if;
  return app.sequence_state(p_company_id, p_doc_type);
end;
$$;

-- numbering is changed by update only (rows are created with the company)
revoke insert, delete on public.document_sequences from authenticated;
revoke insert, update, delete on public.document_sequence_counters from authenticated;
revoke all on function app.tg_sequence_guard(), app.tg_sequence_start() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Master codes: an empty code takes the next number while the sequence is active
-- -----------------------------------------------------------------------------
create or replace function app.next_master_code(p_company_id uuid, p_kind text)
returns text
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v text; i int := 0;
begin
  if not exists (select 1 from public.document_sequences where company_id = p_company_id and doc_type = p_kind and is_active) then
    return null;
  end if;
  loop      -- skip numbers that were typed in by hand
    v := app.next_doc_no(p_company_id, p_kind, current_date);
    exit when not app.doc_no_exists(p_company_id, p_kind, v);
    i := i + 1;
    if i > 1000 then raise exception 'Could not find a free % code', lower(p_kind) using errcode = 'P0001'; end if;
  end loop;
  return v;
end;
$$;

create or replace function app.tg_master_code()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if coalesce(trim(new.code), '') = '' then
    new.code := app.next_master_code(new.company_id, tg_argv[0]);
    if new.code is null then
      raise exception 'Code is required (automatic % codes are not switched on)', lower(tg_argv[0]) using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger items_master_code before insert on public.items for each row execute function app.tg_master_code('ITEM');
create trigger godowns_master_code before insert on public.godowns for each row execute function app.tg_master_code('GODOWN');

-- customer bill: reference from the sequence when the invoice number is left empty
create or replace function app.tg_customer_bill_ref()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if coalesce(trim(new.bill_no), '') = '' then
    if exists (select 1 from public.document_sequences where company_id = new.company_id and doc_type = 'CUSTOMER_BILL' and is_active) then
      new.bill_no := app.next_doc_no(new.company_id, 'CUSTOMER_BILL', coalesce(new.doc_date, current_date));
    end if;
  end if;
  return new;
end;
$$;
create trigger customer_bills_ref before insert on public.customer_bills for each row execute function app.tg_customer_bill_ref();

revoke all on function public.numbering_list(uuid), public.sequence_save(uuid, text, jsonb) from public, anon;
grant execute on function public.numbering_list(uuid), public.sequence_save(uuid, text, jsonb) to authenticated, service_role;
revoke all on function app.tg_master_code(), app.tg_customer_bill_ref() from public, anon, authenticated;
grant execute on function app.next_master_code(uuid, text) to service_role;
