-- =============================================================================
-- PLATFORM R3 (7/10) — departments and the record scope (W8)
--   * departments master; company_users.department_id (the R1 free-text
--     department becomes a department row; the text stays in sync)
--   * record scope per user / role on transaction documents:
--       ALL (default) · DEPARTMENT (created by users of my department) · OWN
--     user setting overrides the roles; roles combine to the widest
--   * restrictive RLS (InitPlan) on every document header with created_by;
--     lines follow their header; RPC actions check it in app.lock_doc
--   * combines with the godown / customer / vendor / item scopes (AND)
-- =============================================================================

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (company_id, name)
);
alter table public.departments enable row level security;
create policy departments_read on public.departments for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
create policy departments_write on public.departments for all to authenticated
  using (company_id = any ((select app.permitted_company_ids('users.edit'))::uuid[])) with check (company_id = any ((select app.permitted_company_ids('users.edit'))::uuid[]));
grant select, insert, update, delete on public.departments to authenticated;
grant all on public.departments to service_role;
create trigger departments_audit after insert or update or delete on public.departments
  for each row execute function app.tg_audit_row();
insert into app.audit_coverage values ('departments', 'TRIGGER', 'tg_audit_row') on conflict do nothing;

alter table public.company_users add column department_id uuid references public.departments (id) on delete set null;
insert into public.departments (company_id, name)
select distinct company_id, trim(department) from public.company_users where coalesce(trim(department), '') <> ''
on conflict do nothing;
update public.company_users cu set department_id = d.id
from public.departments d where d.company_id = cu.company_id and d.name = trim(cu.department);

-- the text column follows the reference (R1 screens / imports keep working)
create or replace function app.tg_company_user_department()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.department_id is distinct from old.department_id or tg_op = 'INSERT' then
    if new.department_id is not null then
      select name into new.department from public.departments where id = new.department_id and company_id = new.company_id;
      if new.department is null then
        raise exception 'Unknown department' using errcode = 'P0001';
      end if;
    end if;
  elsif new.department is distinct from old.department then
    if coalesce(trim(new.department), '') = '' then
      new.department_id := null;
    else
      insert into public.departments (company_id, name) values (new.company_id, trim(new.department)) on conflict do nothing;
      select id into new.department_id from public.departments where company_id = new.company_id and name = trim(new.department);
    end if;
  end if;
  return new;
end;
$$;
create trigger company_users_department before insert or update on public.company_users
  for each row execute function app.tg_company_user_department();

-- -----------------------------------------------------------------------------
-- Record scope
-- -----------------------------------------------------------------------------
alter table public.roles add column record_scope text not null default 'ALL' check (record_scope in ('ALL', 'DEPARTMENT', 'OWN'));
alter table public.company_users add column record_scope text check (record_scope is null or record_scope in ('ALL', 'DEPARTMENT', 'OWN'));

create or replace function app.user_record_scope(p_user uuid, p_company_id uuid)
returns text
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_key text := 'r|' || coalesce(p_user::text, '') || '|' || coalesce(p_company_id::text, ''); v text;
begin
  v := app.authz_cache_get(v_key);
  if v is null then
    if p_user is null or app.is_owner(p_user, p_company_id) then
      v := 'ALL';
    else
      select record_scope into v from public.company_users where company_id = p_company_id and user_id = p_user;
      if v is null then
        -- widest of the active roles (no role -> ALL, matches the other scopes)
        select case when bool_or(r.record_scope = 'ALL') or count(*) = 0 then 'ALL'
                    when bool_or(r.record_scope = 'DEPARTMENT') then 'DEPARTMENT' else 'OWN' end
          into v
        from public.user_roles ur join public.roles r on r.id = ur.role_id and r.is_active
        where ur.user_id = p_user and ur.company_id = p_company_id;
      end if;
    end if;
    perform app.authz_cache_put(v_key, v);
  end if;
  return v;
end;
$$;

create or replace function app.record_unrestricted_company_ids()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c where app.user_record_scope(auth.uid(), c) = 'ALL'
$$;

-- users whose records the caller may see in his restricted companies (self + department colleagues)
create or replace function app.record_visible_creators()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select array_agg(distinct u) from (
    select auth.uid() as u
    union all
    select cu2.user_id from public.company_users me
    join public.company_users cu2 on cu2.company_id = me.company_id and cu2.department_id = me.department_id
    where me.user_id = auth.uid() and me.department_id is not null
      and app.user_record_scope(auth.uid(), me.company_id) = 'DEPARTMENT') x
$$;

create or replace function app.record_allowed(p_company_id uuid, p_created_by uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select app.user_record_scope(auth.uid(), p_company_id) = 'ALL'
      or p_created_by = any (app.record_visible_creators())
      or auth.uid() is null
$$;

create table app.record_scope_tables (table_name text primary key);
insert into app.record_scope_tables select table_name from app.doc_types union select 'customer_pos';

do $$
declare t text;
begin
  for t in select table_name from app.record_scope_tables loop
    execute format('create policy %1$I on public.%2$I as restrictive for select to authenticated
                    using (company_id = any ((select app.record_unrestricted_company_ids())::uuid[])
                           or created_by = any ((select app.record_visible_creators())::uuid[]))',
                   t || '_record_scope', t);
  end loop;
end $$;

-- RPC actions on a document (save / submit / approve / reject / cancel / delete)
create or replace function app.lock_doc(d app.doc_types, p_id uuid, out company_id uuid, out status text, out created_by uuid, out doc_date date)
returns record
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  execute format('select company_id, status::text, created_by, doc_date from public.%I where id = $1 for no key update', d.table_name)
    into company_id, status, created_by, doc_date using p_id;
  if company_id is null then
    raise exception '% not found', d.label using errcode = 'P0001';
  end if;
  if not app.is_member(company_id) or not app.record_allowed(company_id, created_by) then
    raise exception '% not found', d.label using errcode = 'P0001';
  end if;
end;
$$;

-- cache invalidation on the new inputs
create trigger company_users_record_cache after insert or update or delete on public.company_users
  for each statement execute function app.tg_authz_cache_clear();

-- record scope setting (users / roles screens)
create or replace function public.user_set_record_scope(p_company_id uuid, p_user_id uuid, p_scope text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_old text;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'users.assign_scope');
  if p_user_id = auth.uid() and not app.is_owner(auth.uid(), p_company_id) then
    raise exception 'You cannot change your own data access' using errcode = '42501';
  end if;
  if app.is_owner(p_user_id, p_company_id) then
    raise exception 'The owner always sees all records' using errcode = 'P0001';
  end if;
  if p_scope is not null and p_scope not in ('ALL', 'DEPARTMENT', 'OWN') then
    raise exception 'Unknown record scope' using errcode = 'P0001';
  end if;
  select record_scope into v_old from public.company_users where company_id = p_company_id and user_id = p_user_id;
  insert into public.company_users (company_id, user_id, record_scope) values (p_company_id, p_user_id, p_scope)
  on conflict (company_id, user_id) do update set record_scope = excluded.record_scope;
  perform app.audit(p_company_id, 'users', p_user_id::text, 'RECORD_SCOPE', jsonb_build_object('record_scope', v_old),
                    jsonb_build_object('record_scope', p_scope));
end;
$$;

create or replace function public.role_set_record_scope(p_role_id uuid, p_scope text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles;
begin
  r := app.role_for_write(p_role_id, 'roles.edit');
  perform app.require_permission(r.company_id, 'users.assign_scope');
  if r.is_locked then
    raise exception 'The % role always sees all records', r.name using errcode = 'P0001';
  end if;
  if p_scope not in ('ALL', 'DEPARTMENT', 'OWN') then
    raise exception 'Unknown record scope' using errcode = 'P0001';
  end if;
  update public.roles set record_scope = p_scope where id = r.id;
  perform app.audit(r.company_id, 'roles', r.id::text, 'RECORD_SCOPE', jsonb_build_object('record_scope', r.record_scope),
                    jsonb_build_object('record_scope', p_scope));
end;
$$;

create or replace function public.user_set_department(p_company_id uuid, p_user_id uuid, p_department_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'users.edit');
  update public.company_users set department_id = p_department_id where company_id = p_company_id and user_id = p_user_id;
  if not found then
    insert into public.company_users (company_id, user_id, department_id) values (p_company_id, p_user_id, p_department_id);
  end if;
  perform app.audit(p_company_id, 'users', p_user_id::text, 'DEPARTMENT', null, jsonb_build_object('department_id', p_department_id));
end;
$$;

revoke all on function public.user_set_record_scope(uuid, uuid, text), public.role_set_record_scope(uuid, text),
                       public.user_set_department(uuid, uuid, uuid) from public, anon;
grant execute on function public.user_set_record_scope(uuid, uuid, text), public.role_set_record_scope(uuid, text),
                          public.user_set_department(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function app.user_record_scope(uuid, uuid), app.record_unrestricted_company_ids(), app.record_visible_creators(),
                          app.record_allowed(uuid, uuid) to authenticated, service_role;
revoke all on function app.tg_company_user_department() from public, anon, authenticated;
