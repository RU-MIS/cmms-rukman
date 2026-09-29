-- =============================================================================
-- 0005 ACCOUNTING CORE (spec §28–29)
-- Journal entries (double entry), balanced-entry constraint, party
-- sub-ledgers (receivable / payable side — decision Q-13), posting helpers.
-- Every financial posting of every module goes through app.post_journal.
-- =============================================================================

create table public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  entry_no        text not null,
  entry_date      date not null,
  source_table    text not null,            -- traceability to the business document
  source_id       uuid not null,
  source_doc_no   text,
  narration       text,
  is_opening      boolean not null default false,
  reversal_of_id  uuid references public.journal_entries (id),
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create unique index journal_entries_no_uq on public.journal_entries (company_id, entry_no);
create index journal_entries_date_idx on public.journal_entries (company_id, entry_date);
create index journal_entries_source_idx on public.journal_entries (source_table, source_id);
create unique index journal_entries_reversal_uq on public.journal_entries (reversal_of_id) where reversal_of_id is not null;

create table public.journal_entry_lines (
  id                bigserial primary key,
  journal_entry_id  uuid not null references public.journal_entries (id),
  company_id        uuid not null references public.companies (id),
  entry_date        date not null,                   -- denormalised for fast ledgers
  account_id        uuid not null references public.accounts (id),
  party_id          uuid references public.parties (id),
  debit             numeric(16,2) not null default 0 check (debit >= 0),
  credit            numeric(16,2) not null default 0 check (credit >= 0),
  narration         text,
  check ((debit = 0) <> (credit = 0))
);
create index journal_lines_account_idx on public.journal_entry_lines (company_id, account_id, entry_date);
create index journal_lines_party_idx on public.journal_entry_lines (company_id, party_id, entry_date) where party_id is not null;
create index journal_lines_entry_idx on public.journal_entry_lines (journal_entry_id);

create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function app.tg_block_mutation();
create trigger journal_entry_lines_immutable before update or delete on public.journal_entry_lines
  for each row execute function app.tg_block_mutation();

-- Party is mandatory on control accounts and forbidden elsewhere; account must
-- be a posting (non-group) account of the same company.
create or replace function app.tg_journal_line_check()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = new.account_id;
  if a.company_id <> new.company_id then
    raise exception 'Account belongs to another company' using errcode = 'P0001';
  end if;
  if a.is_group then
    raise exception 'Cannot post to group account %', a.name using errcode = 'P0001';
  end if;
  if a.sub_type in ('RECEIVABLE_CONTROL', 'PAYABLE_CONTROL') and new.party_id is null then
    raise exception 'Account % requires a party', a.name using errcode = 'P0001';
  end if;
  if new.party_id is not null and
     (select company_id from public.parties where id = new.party_id) <> new.company_id then
    raise exception 'Party belongs to another company' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger journal_entry_lines_check before insert on public.journal_entry_lines
  for each row execute function app.tg_journal_line_check();

-- Deferred: every journal entry must balance at COMMIT, otherwise the whole
-- business transaction rolls back (spec §34).
create or replace function app.tg_journal_balanced()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_dr numeric; v_cr numeric; v_n int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into v_dr, v_cr, v_n
  from public.journal_entry_lines where journal_entry_id = new.journal_entry_id;
  if v_n < 2 or v_dr <> v_cr then
    raise exception 'Journal entry is not balanced (debit %, credit %, lines %)', v_dr, v_cr, v_n
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger journal_entry_lines_balanced
  after insert on public.journal_entry_lines
  deferrable initially deferred
  for each row execute function app.tg_journal_balanced();

-- -----------------------------------------------------------------------------
-- app.post_journal
--   p_lines: jsonb array of {account_id, party_id?, debit?, credit?, narration?}
--   Zero lines are skipped; if nothing remains (e.g. a 0-rate receipt, Q-06)
--   no entry is created and NULL is returned.
-- -----------------------------------------------------------------------------
create or replace function app.post_journal(
  p_company_id uuid, p_date date, p_source_table text, p_source_id uuid,
  p_source_doc_no text, p_narration text, p_lines jsonb, p_is_opening boolean default false)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id   uuid;
  v_no   text;
  l      jsonb;
  v_dr   numeric;
  v_cr   numeric;
  v_any  boolean := false;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    if round(coalesce((l->>'debit')::numeric, 0), 2) <> 0
       or round(coalesce((l->>'credit')::numeric, 0), 2) <> 0 then
      v_any := true;
    end if;
  end loop;
  if not v_any then
    return null;
  end if;

  perform app.assert_period_open(p_company_id, p_date);
  v_no := app.next_doc_no(p_company_id, 'JOURNAL', p_date);
  insert into public.journal_entries (company_id, entry_no, entry_date, source_table, source_id,
                                      source_doc_no, narration, is_opening, created_by)
  values (p_company_id, v_no, p_date, p_source_table, p_source_id, p_source_doc_no, p_narration,
          p_is_opening, auth.uid())
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_dr := round(coalesce((l->>'debit')::numeric, 0), 2);
    v_cr := round(coalesce((l->>'credit')::numeric, 0), 2);
    if v_dr < 0 then v_cr := v_cr - v_dr; v_dr := 0; end if;     -- normalise negatives
    if v_cr < 0 then v_dr := v_dr - v_cr; v_cr := 0; end if;
    if v_dr = 0 and v_cr = 0 then continue; end if;
    if v_dr > 0 and v_cr > 0 then                                 -- net a line with both sides
      if v_dr >= v_cr then v_dr := v_dr - v_cr; v_cr := 0; else v_cr := v_cr - v_dr; v_dr := 0; end if;
      if v_dr = 0 and v_cr = 0 then continue; end if;
    end if;
    insert into public.journal_entry_lines (journal_entry_id, company_id, entry_date, account_id,
                                            party_id, debit, credit, narration)
    values (v_id, p_company_id, p_date, (l->>'account_id')::uuid, nullif(l->>'party_id', '')::uuid,
            v_dr, v_cr, l->>'narration');
  end loop;
  return v_id;
end;
$$;

-- Reverse every journal entry of a source document (cancellation).
create or replace function app.reverse_journal(p_source_table text, p_source_id uuid, p_date date,
                                               p_narration text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e public.journal_entries; v_id uuid;
begin
  for e in select * from public.journal_entries
           where source_table = p_source_table and source_id = p_source_id
             and reversal_of_id is null
             and not exists (select 1 from public.journal_entries r where r.reversal_of_id = journal_entries.id)
  loop
    perform app.assert_period_open(e.company_id, p_date);
    insert into public.journal_entries (company_id, entry_no, entry_date, source_table, source_id,
                                        source_doc_no, narration, reversal_of_id, created_by)
    values (e.company_id, app.next_doc_no(e.company_id, 'JOURNAL', p_date), p_date,
            e.source_table, e.source_id, e.source_doc_no, p_narration, e.id, auth.uid())
    returning id into v_id;
    insert into public.journal_entry_lines (journal_entry_id, company_id, entry_date, account_id,
                                            party_id, debit, credit, narration)
    select v_id, l.company_id, p_date, l.account_id, l.party_id, l.credit, l.debit, l.narration
    from public.journal_entry_lines l where l.journal_entry_id = e.id;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Party ledger (Q-13): side = 'RECEIVABLE' (sale ledger), 'PAYABLE' (purchase
-- ledger) or NULL (combined). Balance is debit − credit (positive = party owes us).
-- -----------------------------------------------------------------------------
create or replace function public.party_ledger(p_company_id uuid, p_party_id uuid,
                                               p_from date, p_to date, p_side text default null)
returns table (entry_date date, entry_no text, source_table text, source_doc_no text,
               account_name text, narration text, debit numeric, credit numeric, balance numeric)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_opening numeric;
begin
  if p_side is not null and p_side not in ('RECEIVABLE', 'PAYABLE') then
    raise exception 'side must be RECEIVABLE, PAYABLE or null' using errcode = 'P0001';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_opening
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.party_id = p_party_id and l.entry_date < p_from
    and (p_side is null
         or (p_side = 'RECEIVABLE' and a.sub_type = 'RECEIVABLE_CONTROL')
         or (p_side = 'PAYABLE' and a.sub_type = 'PAYABLE_CONTROL'));

  entry_date := p_from; entry_no := null; source_table := null; source_doc_no := 'Opening balance';
  account_name := null; narration := null; debit := null; credit := null; balance := v_opening;
  return next;

  return query
    select l.entry_date, e.entry_no, e.source_table, e.source_doc_no, a.name,
           coalesce(l.narration, e.narration),
           nullif(l.debit, 0), nullif(l.credit, 0),
           v_opening + sum(l.debit - l.credit) over (order by l.entry_date, l.id)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    join public.accounts a on a.id = l.account_id
    where l.company_id = p_company_id and l.party_id = p_party_id
      and l.entry_date between p_from and p_to
      and (p_side is null
           or (p_side = 'RECEIVABLE' and a.sub_type = 'RECEIVABLE_CONTROL')
           or (p_side = 'PAYABLE' and a.sub_type = 'PAYABLE_CONTROL'))
    order by l.entry_date, l.id;
end;
$$;

-- Account ledger (cash book, bank book, any account).
create or replace function public.account_ledger(p_company_id uuid, p_account_id uuid,
                                                 p_from date, p_to date)
returns table (entry_date date, entry_no text, source_table text, source_doc_no text,
               party_name text, narration text, debit numeric, credit numeric, balance numeric)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_opening numeric;
begin
  select coalesce(sum(jl.debit - jl.credit), 0) into v_opening from public.journal_entry_lines jl
   where jl.company_id = p_company_id and jl.account_id = p_account_id and jl.entry_date < p_from;
  entry_date := p_from; entry_no := null; source_table := null; source_doc_no := 'Opening balance';
  party_name := null; narration := null; debit := null; credit := null; balance := v_opening;
  return next;
  return query
    select l.entry_date, e.entry_no, e.source_table, e.source_doc_no, p.name,
           coalesce(l.narration, e.narration), nullif(l.debit, 0), nullif(l.credit, 0),
           v_opening + sum(l.debit - l.credit) over (order by l.entry_date, l.id)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    left join public.parties p on p.id = l.party_id
    where l.company_id = p_company_id and l.account_id = p_account_id
      and l.entry_date between p_from and p_to
    order by l.entry_date, l.id;
end;
$$;

-- Trial balance as on a date.
create or replace function public.trial_balance(p_company_id uuid, p_as_on date)
returns table (account_id uuid, account_code text, account_name text,
               account_type public.account_type, debit numeric, credit numeric)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select a.id, a.code, a.name, a.account_type,
         greatest(sum(l.debit - l.credit), 0), greatest(sum(l.credit - l.debit), 0)
  from public.journal_entry_lines l
  join public.accounts a on a.id = l.account_id
  where l.company_id = p_company_id and l.entry_date <= p_as_on
  group by a.id, a.code, a.name, a.account_type
  having sum(l.debit - l.credit) <> 0
  order by a.code
$$;

-- Party balances (both sides and net) — replaces OPENING BAL ENTRY O:Q.
create or replace view public.v_party_balances
with (security_invoker = true) as
select p.company_id, p.id as party_id, p.code, p.name,
       coalesce(sum(l.debit - l.credit) filter (where a.sub_type = 'RECEIVABLE_CONTROL'), 0) as receivable_balance,
       coalesce(sum(l.credit - l.debit) filter (where a.sub_type = 'PAYABLE_CONTROL'), 0) as payable_balance,
       coalesce(sum(l.debit - l.credit) filter (where a.sub_type in ('RECEIVABLE_CONTROL', 'PAYABLE_CONTROL')), 0) as net_balance
from public.parties p
left join public.journal_entry_lines l on l.party_id = p.id
left join public.accounts a on a.id = l.account_id
group by p.company_id, p.id, p.code, p.name;
