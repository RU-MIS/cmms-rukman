-- =============================================================================
-- 0002 PLATFORM
-- Companies (multi-company, decision Q-34), users, roles & permissions,
-- settings, configurable document numbering (Q-37), approval policies (Q-36),
-- audit log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Companies
-- -----------------------------------------------------------------------------
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  legal_name       text not null,
  trade_name       text,
  gstin            text,
  pan              text,
  address_line1    text,
  address_line2    text,
  city             text,
  state            text,
  state_code       text,
  pincode          text,
  phone            text,
  email            text,
  website          text,
  logo_path        text,
  fy_start_month   smallint not null default 4 check (fy_start_month between 1 and 12),
  base_currency    text not null default 'INR',
  books_locked_until date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create unique index companies_code_uq on public.companies (upper(code));
create unique index companies_gstin_uq on public.companies (upper(gstin)) where gstin is not null;
create trigger companies_audit_fields before insert or update on public.companies
  for each row execute function app.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null default '',
  phone               text,
  default_company_id  uuid references public.companies (id),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Permissions (system seed), roles (per company), assignments
-- -----------------------------------------------------------------------------
create table public.permissions (
  code        text primary key,               -- e.g. job_work_receipt.approve
  module      text not null,
  action      public.perm_action not null,
  description text not null default ''
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  code        text not null,
  name        text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index roles_company_code_uq on public.roles (company_id, upper(code));
create trigger roles_audit_fields before insert or update on public.roles
  for each row execute function app.tg_set_audit_fields();

create table public.role_permissions (
  role_id          uuid not null references public.roles (id) on delete cascade,
  permission_code  text not null references public.permissions (code) on delete cascade,
  primary key (role_id, permission_code)
);

create table public.user_roles (
  user_id     uuid not null references auth.users (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  primary key (user_id, company_id, role_id)
);
create index user_roles_company_idx on public.user_roles (company_id);

-- Companies the current user belongs to.
create or replace function app.user_company_ids()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct company_id), '{}')
  from public.user_roles where user_id = auth.uid()
$$;

create or replace function app.is_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.user_roles
                 where user_id = auth.uid() and company_id = p_company_id)
$$;

create or replace function app.has_permission(p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid()
      and ur.company_id = p_company_id
      and rp.permission_code = p_permission)
$$;

create or replace function app.require_permission(p_company_id uuid, p_permission text)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.has_permission(p_company_id, p_permission) then
    raise exception 'Permission denied: % is required', p_permission
      using errcode = '42501';
  end if;
end;
$$;

-- Role claim of the API request ('authenticated', 'anon', 'service_role'),
-- or NULL for a direct database connection (migrations, admin scripts).
create or replace function app.request_role()
returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
$$;

-- Trusted = service role key, or a direct DB connection that is not the API
-- gateway role. SECURITY DEFINER functions must not use current_user for this.
create or replace function app.is_trusted_caller()
returns boolean
language sql stable
as $$
  select app.request_role() = 'service_role'
      or (app.request_role() is null and session_user not in ('authenticator', 'anon', 'authenticated'))
$$;

-- Exposed for the web app (menu visibility). Authorization is still enforced
-- in every posting function and RLS policy.
create or replace function public.my_permissions(p_company_id uuid)
returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select distinct rp.permission_code
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = auth.uid() and ur.company_id = p_company_id
$$;

-- -----------------------------------------------------------------------------
-- Company settings (business policies, document texts)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  company_id  uuid not null references public.companies (id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (company_id, key)
);

create or replace function app.setting(p_company_id uuid, p_key text, p_default jsonb default null)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select value from public.app_settings
                   where company_id = p_company_id and key = p_key), p_default)
$$;

-- -----------------------------------------------------------------------------
-- Financial year helper: '2026-27' for a date, using the company FY start.
-- -----------------------------------------------------------------------------
create or replace function app.fy_code(p_company_id uuid, p_date date)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  with c as (select fy_start_month m from public.companies where id = p_company_id),
       y as (select case when extract(month from p_date) >= c.m
                         then extract(year from p_date)::int
                         else extract(year from p_date)::int - 1 end as start_year,
                    c.m
             from c)
  select case when m = 1 then start_year::text
              else start_year::text || '-' || lpad(((start_year + 1) % 100)::text, 2, '0') end
  from y
$$;

create or replace function app.assert_period_open(p_company_id uuid, p_date date)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_lock date;
begin
  select books_locked_until into v_lock from public.companies where id = p_company_id;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'Books are locked up to %; date % is not allowed', v_lock, p_date
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Configurable document numbering (spec §44, decision Q-37).
-- pattern tokens: {PREFIX} {FY} {NUMBER}
--   e.g. prefix 'GT ', padding 2, pattern '{PREFIX}{NUMBER}'   -> 'GT 01'
--        prefix 'T/',  padding 3, pattern '{PREFIX}{FY}/{NUMBER}' -> 'T/2026-27/001'
-- Counters are incremented with INSERT .. ON CONFLICT DO UPDATE, which takes a
-- row lock: concurrent users can never receive the same number.
-- -----------------------------------------------------------------------------
create table public.document_sequences (
  company_id    uuid not null references public.companies (id) on delete cascade,
  doc_type      text not null,
  prefix        text not null default '',
  pattern       text not null default '{PREFIX}{NUMBER}' check (pattern like '%{NUMBER}%'),
  padding       smallint not null default 4 check (padding between 1 and 12),
  start_value   bigint not null default 1 check (start_value >= 0),
  reset_policy  text not null default 'NEVER' check (reset_policy in ('NEVER', 'FY')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (company_id, doc_type)
);

create table public.document_sequence_counters (
  company_id  uuid not null,
  doc_type    text not null,
  period_key  text not null,           -- '' for NEVER, FY code for FY reset
  next_value  bigint not null,
  primary key (company_id, doc_type, period_key),
  foreign key (company_id, doc_type)
    references public.document_sequences (company_id, doc_type) on delete cascade
);

create or replace function app.next_doc_no(p_company_id uuid, p_doc_type text, p_date date)
returns text
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  s        public.document_sequences;
  v_fy     text := app.fy_code(p_company_id, p_date);
  v_period text;
  v_value  bigint;
begin
  select * into s from public.document_sequences
   where company_id = p_company_id and doc_type = p_doc_type;
  if not found then
    raise exception 'Document numbering is not configured for %', p_doc_type
      using errcode = 'P0001';
  end if;
  v_period := case when s.reset_policy = 'FY' then v_fy else '' end;

  insert into public.document_sequence_counters as c (company_id, doc_type, period_key, next_value)
  values (p_company_id, p_doc_type, v_period, s.start_value + 1)
  on conflict (company_id, doc_type, period_key)
    do update set next_value = c.next_value + 1
  returning next_value - 1 into v_value;

  return replace(replace(replace(s.pattern,
           '{PREFIX}', s.prefix),
           '{FY}', v_fy),
           '{NUMBER}', lpad(v_value::text, s.padding, '0'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Approval policies (maker–checker, decision Q-36)
-- -----------------------------------------------------------------------------
create table public.approval_policies (
  company_id         uuid not null references public.companies (id) on delete cascade,
  doc_type           text not null,
  requires_approval  boolean not null default false,
  allow_self_approval boolean not null default false,
  primary key (company_id, doc_type)
);

create or replace function app.requires_approval(p_company_id uuid, p_doc_type text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select requires_approval from public.approval_policies
                   where company_id = p_company_id and doc_type = p_doc_type), false)
$$;

-- Checks APPROVE permission and the maker ≠ checker rule.
create or replace function app.assert_can_approve(p_company_id uuid, p_doc_type text,
                                                  p_permission text, p_created_by uuid)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_self boolean;
begin
  perform app.require_permission(p_company_id, p_permission);
  select allow_self_approval into v_self from public.approval_policies
   where company_id = p_company_id and doc_type = p_doc_type;
  if not coalesce(v_self, false) and p_created_by = auth.uid() then
    raise exception 'A document cannot be approved by the user who created it'
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id          bigserial primary key,
  company_id  uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  actor_id    uuid,
  at          timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (company_id, table_name, row_id);
create index audit_log_at_idx on public.audit_log (company_id, at desc);
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function app.tg_block_mutation();

create or replace function app.audit(p_company_id uuid, p_table text, p_row_id text,
                                     p_action text, p_old jsonb, p_new jsonb)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (company_id, table_name, row_id, action, old_data, new_data, actor_id)
  values (p_company_id, p_table, p_row_id, p_action, p_old, p_new, auth.uid())
$$;

-- Generic row trigger for master tables (tables must have id and company_id).
create or replace function app.tg_audit_row()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.company_id, tg_table_name, new.id::text, 'INSERT', null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' - 'updated_by' is distinct from to_jsonb(old) - 'updated_at' - 'updated_by' then
      perform app.audit(new.company_id, tg_table_name, new.id::text, 'UPDATE', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform app.audit(old.company_id, tg_table_name, old.id::text, 'DELETE', to_jsonb(old), null);
    return old;
  end if;
end;
$$;
