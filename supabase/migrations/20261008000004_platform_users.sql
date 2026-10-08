-- =============================================================================
-- PLATFORM R1 / PHASE 2 — User Management Center (database side)
-- (docs/PLATFORM_ARCHITECTURE_PLAN.md §G).
--
-- Logins (auth.users) are created / reset / banned by the Edge Function
-- supabase/functions/admin-users with the service role. Everything that is a
-- business decision is checked HERE, with the caller's own JWT:
--   user_create_check → [function creates the auth user] → user_create_complete
--   user_password_reset_begin → [function sets the temporary password]
--   user_set_status → [function bans / unbans the login when no access is left]
-- Passwords never reach the database tables of the application: the
-- temporary password exists only in the function response (shown once).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Password change bookkeeping. Any change of the password clears the
-- "must change" flag — unless an administrator reset it moments ago
-- (password_reset_pending_until), then the new password is temporary.
-- -----------------------------------------------------------------------------
create or replace function app.tg_auth_password_changed()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles
       set must_change_password = coalesce(password_reset_pending_until > now(), false),
           password_reset_pending_until = null,
           password_changed_at = now()
     where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function app.tg_auth_password_changed() from public, anon, authenticated;
drop trigger if exists rukman_password_changed on auth.users;
create trigger rukman_password_changed after update of encrypted_password on auth.users
  for each row execute function app.tg_auth_password_changed();

-- Does the login still give access to anything (then it must not be banned)?
create or replace function app.user_has_any_access(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.user_roles ur
                 where ur.user_id = p_user
                   and not exists (select 1 from public.company_users cu where cu.company_id = ur.company_id
                                   and cu.user_id = p_user and cu.status <> 'ACTIVE'))
      or exists (select 1 from public.portal_users pu where pu.user_id = p_user and pu.is_active)
$$;

-- The caller may manage the LOGIN (password, ban) of p_user only if every
-- company the user belongs to is one where the caller holds p_permission.
create or replace function app.assert_can_manage_login(p_company_id uuid, p_user uuid, p_permission text)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, p_permission);
  if not exists (select 1 from public.user_roles where company_id = p_company_id and user_id = p_user)
     and not exists (select 1 from public.portal_users where company_id = p_company_id and user_id = p_user) then
    raise exception 'User not found' using errcode = 'P0001';
  end if;
  if p_user = v_actor then
    raise exception 'Use "My account" for your own login' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles ur where ur.user_id = p_user and app.is_owner(p_user, ur.company_id)
             and not app.is_owner(v_actor, ur.company_id)) then
    raise exception 'Only an owner can manage the login of an owner' using errcode = '42501';
  end if;
  if exists (select ur.company_id from public.user_roles ur where ur.user_id = p_user
             union select pu.company_id from public.portal_users pu where pu.user_id = p_user
             except select c.id from public.companies c where app.has_permission(c.id, p_permission)) then
    raise exception 'This login also belongs to another company: it can only be managed by an administrator of all its companies'
      using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- User directory
-- -----------------------------------------------------------------------------
create or replace function public.admin_users(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'users.view');
  return coalesce((
    select jsonb_agg(x order by x->>'kind', lower(x->>'full_name'), x->>'email')
    from (
      select jsonb_build_object(
        'key', 'U:' || cu.user_id, 'user_id', cu.user_id, 'kind', 'INTERNAL',
        'email', u.email, 'full_name', coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)),
        'mobile', cu.mobile, 'department', cu.department, 'designation', cu.designation,
        'employee_code', cu.employee_code, 'status', cu.status,
        'must_change_password', coalesce(p.must_change_password, false),
        'last_sign_in_at', u.last_sign_in_at, 'created_at', cu.created_at,
        'is_owner', app.is_owner(cu.user_id, p_company_id),
        'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) order by r.sort_order, r.name)
                           from public.user_roles ur join public.roles r on r.id = ur.role_id
                           where ur.company_id = p_company_id and ur.user_id = cu.user_id), '[]'),
        'godown_ids', (select jsonb_agg(entity_id) from public.user_data_scopes s
                       where s.company_id = p_company_id and s.user_id = cu.user_id and s.dimension = 'GODOWN'),
        'override_count', (select count(*) from public.user_permission_overrides o
                           where o.company_id = p_company_id and o.user_id = cu.user_id)) as x
      from public.company_users cu
      join auth.users u on u.id = cu.user_id
      left join public.profiles p on p.id = cu.user_id
      where cu.company_id = p_company_id
        and exists (select 1 from public.user_roles ur where ur.company_id = p_company_id and ur.user_id = cu.user_id)
      union all
      select jsonb_build_object(
        'key', 'P:' || pu.id, 'user_id', pu.user_id, 'portal_user_id', pu.id, 'kind', pu.kind::text,
        'email', pu.email, 'full_name', coalesce(nullif(pu.display_name, ''), nullif(p.full_name, ''), pu.email),
        'party_id', pu.party_id, 'party_name', pa.name,
        'status', case when pu.is_active then 'ACTIVE' else 'DISABLED' end,
        'claimed', pu.user_id is not null,
        'must_change_password', coalesce(p.must_change_password, false),
        'last_sign_in_at', u.last_sign_in_at, 'created_at', pu.invited_at, 'is_owner', false, 'roles', '[]'::jsonb)
      from public.portal_users pu
      join public.parties pa on pa.id = pu.party_id
      left join auth.users u on u.id = pu.user_id
      left join public.profiles p on p.id = pu.user_id
      where pu.company_id = p_company_id) q), '[]');
end;
$$;

create or replace function public.admin_user_detail(p_company_id uuid, p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'users.view');
  if not exists (select 1 from public.company_users where company_id = p_company_id and user_id = p_user_id)
     and not exists (select 1 from public.portal_users where company_id = p_company_id and user_id = p_user_id) then
    raise exception 'User not found' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'user_id', p_user_id,
    'email', (select email from auth.users where id = p_user_id),
    'full_name', (select full_name from public.profiles where id = p_user_id),
    'membership', (select to_jsonb(cu) from public.company_users cu where cu.company_id = p_company_id and cu.user_id = p_user_id),
    'must_change_password', coalesce((select must_change_password from public.profiles where id = p_user_id), false),
    'password_changed_at', (select password_changed_at from public.profiles where id = p_user_id),
    'last_sign_in_at', (select last_sign_in_at from auth.users where id = p_user_id),
    'is_owner', app.is_owner(p_user_id, p_company_id),
    'role_ids', coalesce((select jsonb_agg(role_id) from public.user_roles where company_id = p_company_id and user_id = p_user_id), '[]'),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('permission_code', permission_code, 'effect', effect, 'reason', reason)
                                            order by permission_code)
                           from public.user_permission_overrides where company_id = p_company_id and user_id = p_user_id), '[]'),
    'scopes', coalesce((select jsonb_object_agg(dimension, ids) from (
                          select dimension, jsonb_agg(entity_id) ids from public.user_data_scopes
                          where company_id = p_company_id and user_id = p_user_id group by dimension) s), '{}'),
    'effective_scopes', (select coalesce(jsonb_object_agg(d.code, to_jsonb(app.user_scope_ids(p_user_id, p_company_id, d.code))), '{}')
                         from public.data_scope_dimensions d),
    'permissions', coalesce((select jsonb_agg(c order by c) from app.user_permissions(p_user_id, p_company_id) c), '[]'),
    'portal', coalesce((select jsonb_agg(jsonb_build_object('id', pu.id, 'kind', pu.kind, 'party_id', pu.party_id,
                                                            'party_name', pa.name, 'is_active', pu.is_active))
                        from public.portal_users pu join public.parties pa on pa.id = pu.party_id
                        where pu.company_id = p_company_id and pu.user_id = p_user_id), '[]'),
    'history', case when app.has_permission(p_company_id, 'audit.view') or app.has_permission(p_company_id, 'users.view') then
                 coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'old', a.old_data, 'new', a.new_data,
                                                               'actor', coalesce((select email from auth.users where id = a.actor_id), 'system'))
                                            order by a.at desc, a.id desc)
                           from (select * from public.audit_log a
                                 where a.company_id = p_company_id and a.table_name = 'users' and a.row_id = p_user_id::text
                                 order by a.at desc, a.id desc limit 200) a), '[]') end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Profile / roles / overrides
-- -----------------------------------------------------------------------------
create or replace function app.assert_can_edit_user(p_company_id uuid, p_user uuid, p_permission text)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id)
     or not exists (select 1 from public.user_roles where company_id = p_company_id and user_id = p_user) then
    raise exception 'User not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, p_permission);
  if app.is_owner(p_user, p_company_id) and not app.is_owner(auth.uid(), p_company_id) then
    raise exception 'Only an owner can change an owner' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.user_update(p_company_id uuid, p_user_id uuid, p_payload jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_old jsonb;
begin
  perform app.assert_can_edit_user(p_company_id, p_user_id, 'users.edit');
  select to_jsonb(cu) - 'updated_at' - 'updated_by' into v_old from public.company_users cu
   where company_id = p_company_id and user_id = p_user_id;
  if p_payload ? 'full_name' then
    insert into public.profiles (id, full_name) values (p_user_id, coalesce(p_payload->>'full_name', ''))
    on conflict (id) do update set full_name = excluded.full_name, updated_at = now();
  end if;
  update public.company_users
     set mobile = case when p_payload ? 'mobile' then nullif(trim(p_payload->>'mobile'), '') else mobile end,
         department = case when p_payload ? 'department' then nullif(trim(p_payload->>'department'), '') else department end,
         designation = case when p_payload ? 'designation' then nullif(trim(p_payload->>'designation'), '') else designation end,
         employee_code = case when p_payload ? 'employee_code' then nullif(trim(p_payload->>'employee_code'), '') else employee_code end,
         notes = case when p_payload ? 'notes' then nullif(trim(p_payload->>'notes'), '') else notes end
   where company_id = p_company_id and user_id = p_user_id;
  perform app.audit(p_company_id, 'users', p_user_id::text, 'PROFILE', v_old, p_payload);
end;
$$;

-- Replace the roles of a user (at least one; use disable to remove access).
create or replace function public.user_set_roles(p_company_id uuid, p_user_id uuid, p_role_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_new uuid[] := array(select distinct unnest(coalesce(p_role_ids, '{}'))); v_role uuid;
begin
  perform app.assert_can_edit_user(p_company_id, p_user_id, 'users.assign_role');
  if cardinality(v_new) = 0 then
    raise exception 'A user needs at least one role (disable the user to remove all access)' using errcode = 'P0001';
  end if;
  for v_role in select role_id from public.user_roles where company_id = p_company_id and user_id = p_user_id
                except select unnest(v_new) loop
    perform app.assert_can_assign_role(p_company_id, p_user_id, v_role, true);
    delete from public.user_roles where company_id = p_company_id and user_id = p_user_id and role_id = v_role;
  end loop;
  for v_role in select unnest(v_new)
                except select role_id from public.user_roles where company_id = p_company_id and user_id = p_user_id loop
    perform app.assert_can_assign_role(p_company_id, p_user_id, v_role, false);
    insert into public.user_roles (user_id, company_id, role_id) values (p_user_id, p_company_id, v_role);
  end loop;
end;
$$;

-- Replace the permission overrides: [{permission_code, effect ALLOW|DENY, reason}]
create or replace function public.user_set_overrides(p_company_id uuid, p_user_id uuid, p_overrides jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_old jsonb; v_allow text[]; v_bad text;
begin
  perform app.assert_can_edit_user(p_company_id, p_user_id, 'users.assign_permissions');
  if p_user_id = auth.uid() and not app.is_owner(auth.uid(), p_company_id) then
    raise exception 'You cannot change your own permissions' using errcode = '42501';
  end if;
  if app.is_owner(p_user_id, p_company_id) then
    raise exception 'An owner always has every permission' using errcode = '42501';
  end if;
  select x->>'permission_code' into v_bad from jsonb_array_elements(coalesce(p_overrides, '[]')) x
  where coalesce(x->>'effect', '') not in ('ALLOW', 'DENY')
     or not exists (select 1 from public.permissions p where p.code = x->>'permission_code') limit 1;
  if found then
    raise exception 'Invalid override for %', coalesce(v_bad, '?') using errcode = 'P0001';
  end if;
  v_allow := array(select x->>'permission_code' from jsonb_array_elements(coalesce(p_overrides, '[]')) x where x->>'effect' = 'ALLOW');
  perform app.assert_can_grant(p_company_id, v_allow);
  select jsonb_agg(jsonb_build_object('permission_code', permission_code, 'effect', effect) order by permission_code)
    into v_old from public.user_permission_overrides where company_id = p_company_id and user_id = p_user_id;
  delete from public.user_permission_overrides where company_id = p_company_id and user_id = p_user_id;
  insert into public.user_permission_overrides (company_id, user_id, permission_code, effect, reason, created_by)
  select distinct on (x->>'permission_code') p_company_id, p_user_id, x->>'permission_code', x->>'effect',
         nullif(x->>'reason', ''), auth.uid()
  from jsonb_array_elements(coalesce(p_overrides, '[]')) x;
  perform app.audit(p_company_id, 'users', p_user_id::text, 'OVERRIDES', v_old,
                    (select jsonb_agg(jsonb_build_object('permission_code', permission_code, 'effect', effect) order by permission_code)
                     from public.user_permission_overrides where company_id = p_company_id and user_id = p_user_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Enable / disable (company membership and portal access of the login).
-- Returns has_access: false → the Edge Function bans the login.
-- -----------------------------------------------------------------------------
create or replace function public.user_set_status(p_company_id uuid, p_user_id uuid, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.assert_can_manage_login(p_company_id, p_user_id, 'users.disable');
  if not p_active and app.is_owner(p_user_id, p_company_id) and not exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
       join public.company_users cu on cu.company_id = ur.company_id and cu.user_id = ur.user_id
       where ur.company_id = p_company_id and r.grants_all and ur.user_id <> p_user_id and cu.status = 'ACTIVE') then
    raise exception 'A company must keep at least one active owner' using errcode = 'P0001';
  end if;
  update public.company_users
     set status = case when p_active then 'ACTIVE' else 'DISABLED' end,
         disabled_at = case when p_active then null else now() end,
         disabled_by = case when p_active then null else auth.uid() end,
         disabled_reason = case when p_active then null else p_reason end
   where company_id = p_company_id and user_id = p_user_id;
  update public.portal_users set is_active = p_active where company_id = p_company_id and user_id = p_user_id;
  perform app.audit(p_company_id, 'users', p_user_id::text, case when p_active then 'ENABLE' else 'DISABLE' end,
                    null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('user_id', p_user_id, 'has_access', app.user_has_any_access(p_user_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Password reset by an administrator: authorise + mark; the Edge Function then
-- sets the temporary password (the trigger above turns on "must change").
-- -----------------------------------------------------------------------------
create or replace function public.user_password_reset_begin(p_company_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.assert_can_manage_login(p_company_id, p_user_id, 'users.reset_password');
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;
  update public.profiles set password_reset_pending_until = now() + interval '5 minutes' where id = p_user_id;
  perform app.audit(p_company_id, 'users', p_user_id::text, 'PASSWORD_RESET', null,
                    jsonb_build_object('temporary_password', 'generated (not stored)'));
  return jsonb_build_object('user_id', p_user_id, 'email', (select email from auth.users where id = p_user_id),
                            'has_access', app.user_has_any_access(p_user_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Create user: check (before the login exists) and complete (after).
-- payload: kind INTERNAL|CUSTOMER|VENDOR, email, full_name, mobile, department,
--          designation, employee_code, role_ids[] (internal), godown_ids[]
--          (internal, optional), party_id (customer / vendor)
-- -----------------------------------------------------------------------------
create or replace function app.validate_new_user(p_company_id uuid, p_payload jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare
  v_kind  text := upper(coalesce(p_payload->>'kind', 'INTERNAL'));
  v_email text := lower(trim(coalesce(p_payload->>'email', '')));
  v_roles uuid[]; v_godowns uuid[]; v_role uuid; v_user uuid; v_confirmed boolean; p public.parties;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required' using errcode = 'P0001';
  end if;
  select id, email_confirmed_at is not null into v_user, v_confirmed from auth.users where lower(email) = v_email;
  if v_user is not null and not v_confirmed then
    raise exception 'An unverified sign-up exists for %: ask the person to verify it, or remove it first', v_email using errcode = 'P0001';
  end if;
  if v_kind = 'INTERNAL' then
    perform app.require_permission(p_company_id, 'users.create');
    perform app.require_permission(p_company_id, 'users.assign_role');
    v_roles := array(select distinct (jsonb_array_elements_text(coalesce(p_payload->'role_ids', '[]')))::uuid);
    if cardinality(v_roles) = 0 then
      raise exception 'Select at least one role' using errcode = 'P0001';
    end if;
    foreach v_role in array v_roles loop
      perform app.assert_can_assign_role(p_company_id, null, v_role, false);
    end loop;
    v_godowns := array(select distinct (jsonb_array_elements_text(coalesce(p_payload->'godown_ids', '[]')))::uuid);
    if cardinality(v_godowns) > 0 then
      perform app.require_permission(p_company_id, 'users.assign_scope');
      perform app.assert_scope_entities(p_company_id, 'GODOWN', v_godowns);
    end if;
    if v_user is not null and exists (select 1 from public.user_roles where company_id = p_company_id and user_id = v_user) then
      raise exception '% is already a user of this company', v_email using errcode = 'P0001';
    end if;
    if exists (select 1 from public.portal_users where company_id = p_company_id and lower(email) = v_email) then
      raise exception '% is a customer / vendor portal login of this company', v_email using errcode = 'P0001';
    end if;
  elsif v_kind in ('CUSTOMER', 'VENDOR') then
    perform app.require_permission(p_company_id, 'users.create');
    perform app.require_permission(p_company_id, 'portal.create');
    select * into p from public.parties where id = (p_payload->>'party_id')::uuid and company_id = p_company_id;
    if p.id is null then
      raise exception 'Select the % of this login', lower(v_kind) using errcode = 'P0001';
    end if;
    if v_kind = 'CUSTOMER' and not app.party_has_role(p.id, 'CUSTOMER') then
      raise exception '% is not set up as a customer', p.name using errcode = 'P0001';
    end if;
    if v_kind = 'VENDOR' and not (app.party_has_role(p.id, 'SUPPLIER') or app.party_has_role(p.id, 'JOB_WORKER')
                                  or app.party_has_role(p.id, 'CUTTER')) then
      raise exception '% is not set up as a vendor', p.name using errcode = 'P0001';
    end if;
    if v_user is not null and exists (select 1 from public.user_roles where company_id = p_company_id and user_id = v_user) then
      raise exception 'This email belongs to an internal user of the company' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.portal_users where company_id = p_company_id and kind = v_kind::public.portal_kind
               and lower(email) = v_email) then
      raise exception '% already has a % portal login', v_email, lower(v_kind) using errcode = 'P0001';
    end if;
  else
    raise exception 'Unknown user type %', v_kind using errcode = 'P0001';
  end if;
  return jsonb_build_object('kind', v_kind, 'email', v_email, 'existing_user_id', v_user,
                            'role_ids', to_jsonb(v_roles), 'godown_ids', to_jsonb(v_godowns));
end;
$$;

create or replace function public.user_create_check(p_company_id uuid, p_payload jsonb)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$ select app.validate_new_user(p_company_id, p_payload) $$;

create or replace function public.user_create_complete(p_company_id uuid, p_user_id uuid, p_payload jsonb, p_new_login boolean)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v jsonb := app.validate_new_user(p_company_id, p_payload); u record; v_role uuid; v_pu uuid;
begin
  select id, lower(email) email, created_at, last_sign_in_at, email_confirmed_at into u from auth.users where id = p_user_id;
  if u.id is null or u.email <> v->>'email' then
    raise exception 'Login does not match the email address' using errcode = 'P0001';
  end if;
  if p_new_login then
    -- only a login created moments ago by the admin-users function, never used
    if (v->>'existing_user_id')::uuid is distinct from u.id or u.created_at < now() - interval '10 minutes'
       or u.last_sign_in_at is not null
       or exists (select 1 from public.user_roles where user_id = u.id)
       or exists (select 1 from public.portal_users where user_id = u.id) then
      raise exception 'This login is not a new login' using errcode = '42501';
    end if;
  elsif u.email_confirmed_at is null then
    raise exception 'Email address of this login is not verified' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, full_name, phone, must_change_password)
  values (u.id, coalesce(nullif(trim(p_payload->>'full_name'), ''), split_part(u.email, '@', 1)),
          nullif(trim(p_payload->>'mobile'), ''), p_new_login)
  on conflict (id) do update
    set full_name = case when coalesce(public.profiles.full_name, '') = '' then excluded.full_name else public.profiles.full_name end,
        must_change_password = public.profiles.must_change_password or excluded.must_change_password;

  if v->>'kind' = 'INTERNAL' then
    insert into public.company_users (company_id, user_id, mobile, department, designation, employee_code)
    values (p_company_id, u.id, nullif(trim(p_payload->>'mobile'), ''), nullif(trim(p_payload->>'department'), ''),
            nullif(trim(p_payload->>'designation'), ''), nullif(trim(p_payload->>'employee_code'), ''))
    on conflict (company_id, user_id) do update
      set status = 'ACTIVE', mobile = excluded.mobile, department = excluded.department,
          designation = excluded.designation, employee_code = excluded.employee_code;
    for v_role in select (jsonb_array_elements_text(v->'role_ids'))::uuid loop
      insert into public.user_roles (user_id, company_id, role_id) values (u.id, p_company_id, v_role);
    end loop;
    insert into public.user_data_scopes (company_id, user_id, dimension, entity_id, created_by)
    select p_company_id, u.id, 'GODOWN', (g)::uuid, auth.uid()
    from jsonb_array_elements_text(coalesce(v->'godown_ids', '[]')) g;
  else
    insert into public.portal_users (company_id, party_id, kind, email, display_name, user_id, invited_by, claimed_at)
    values (p_company_id, (p_payload->>'party_id')::uuid, (v->>'kind')::public.portal_kind, u.email,
            nullif(trim(p_payload->>'full_name'), ''), u.id, auth.uid(), now())
    returning id into v_pu;
  end if;
  perform app.audit(p_company_id, 'users', u.id::text, 'CREATE', null,
                    (p_payload - 'password') || jsonb_build_object('new_login', p_new_login, 'portal_user_id', v_pu));
  return jsonb_build_object('user_id', u.id, 'kind', v->>'kind', 'portal_user_id', v_pu);
end;
$$;

-- Service role only: end all sessions of a login (disable / password reset).
-- Access tokens already issued are refused by the database checks anyway.
create or replace function public.auth_revoke_sessions(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_trusted_caller() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Portal guard: a deactivated login / pending temporary password has no
-- portal access either.
-- -----------------------------------------------------------------------------
create or replace function app.portal_party(p_company_id uuid, p_kind public.portal_kind)
returns uuid
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid; s public.company_settings;
begin
  select pu.party_id into v_party
  from public.portal_users pu join public.parties p on p.id = pu.party_id
  where pu.user_id = auth.uid() and pu.company_id = p_company_id and pu.kind = p_kind
    and pu.is_active and p.is_active and not p.is_deleted
    and not exists (select 1 from public.profiles pr where pr.id = auth.uid()
                    and (pr.must_change_password or not pr.is_active));
  if v_party is null then
    raise exception 'Portal access denied' using errcode = '42501';
  end if;
  select * into s from public.company_settings where company_id = p_company_id;
  if (p_kind = 'CUSTOMER' and not s.customer_portal_enabled) or (p_kind = 'VENDOR' and not s.vendor_portal_enabled) then
    raise exception 'The % portal is currently turned off', lower(p_kind::text) using errcode = '42501';
  end if;
  return v_party;
end;
$$;

-- -----------------------------------------------------------------------------
-- Session bootstrap: + must_change_password, login audit, disabled companies
-- hidden, invitations to the owner role claimable.
-- -----------------------------------------------------------------------------
create or replace function public.session_bootstrap()
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_email text := app.auth_email(); i public.user_invitations;
  v_last timestamptz; v_seen timestamptz; v_must boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into public.profiles (id, full_name) values (v_uid, coalesce(split_part(v_email, '@', 1), ''))
  on conflict (id) do nothing;

  if v_email is not null then
    for i in select * from public.user_invitations
             where lower(email) = v_email and claimed_at is null and revoked_at is null for update loop
      perform set_config('app.claiming_invitation', v_uid::text, true);
      insert into public.user_roles (user_id, company_id, role_id) values (v_uid, i.company_id, i.role_id)
      on conflict do nothing;
      perform set_config('app.claiming_invitation', '', true);
      update public.user_invitations set claimed_by = v_uid, claimed_at = now() where id = i.id;
      if coalesce(i.full_name, '') <> '' then
        update public.profiles set full_name = i.full_name where id = v_uid and full_name in ('', split_part(v_email, '@', 1));
      end if;
      perform app.audit(i.company_id, 'user_invitations', i.id::text, 'CLAIM', null, jsonb_build_object('user_id', v_uid));
    end loop;
    update public.portal_users set user_id = v_uid, claimed_at = coalesce(claimed_at, now())
     where lower(email) = v_email and user_id is null;
  end if;
  update public.portal_users set last_login_at = now() where user_id = v_uid;

  -- login audit: one LOGIN row per company for every new sign-in
  select last_sign_in_at into v_last from auth.users where id = v_uid;
  select last_login_seen_at, must_change_password into v_seen, v_must from public.profiles where id = v_uid;
  if v_last is not null and v_last is distinct from v_seen then
    update public.profiles set last_login_seen_at = v_last where id = v_uid;
    perform app.audit(c.company_id, 'users', v_uid::text, 'LOGIN', null, jsonb_build_object('at', v_last))
    from (select distinct company_id from public.user_roles where user_id = v_uid
          union select company_id from public.portal_users where user_id = v_uid) c;
  end if;

  return jsonb_build_object(
    'user_id', v_uid, 'email', v_email,
    'full_name', (select full_name from public.profiles where id = v_uid),
    'must_change_password', coalesce(v_must, false),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(c.trade_name, c.legal_name),
                                                                'code', c.code, 'roles', x.roles) order by c.legal_name)
                           from (select ur.company_id, jsonb_agg(r.code order by r.code) as roles
                                 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                 where ur.user_id = v_uid
                                   and not exists (select 1 from public.company_users cu where cu.company_id = ur.company_id
                                                   and cu.user_id = v_uid and cu.status <> 'ACTIVE')
                                 group by ur.company_id) x
                           join public.companies c on c.id = x.company_id), '[]'),
    'portals', coalesce((select jsonb_agg(jsonb_build_object('company_id', pu.company_id,
                                                              'company_name', app.company_name(pu.company_id),
                                                              'kind', pu.kind, 'party_id', pu.party_id, 'party_name', p.name,
                                                              'enabled', case pu.kind when 'CUSTOMER' then s.customer_portal_enabled
                                                                                       else s.vendor_portal_enabled end))
                         from public.portal_users pu
                         join public.parties p on p.id = pu.party_id
                         join public.company_settings s on s.company_id = pu.company_id
                         where pu.user_id = v_uid and pu.is_active and p.is_active), '[]'));
end;
$$;

-- Members list of the old Users screen: also status.
create or replace function public.company_members(p_company_id uuid)
returns table (user_id uuid, email text, full_name text, roles text[], role_names text[])
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.has_permission(p_company_id, 'users.view') then
    raise exception 'Permission denied: users.view is required' using errcode = '42501';
  end if;
  return query
    select ur.user_id, u.email::text, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)),
           array_agg(r.code order by r.code), array_agg(r.name order by r.code)
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join auth.users u on u.id = ur.user_id
    left join public.profiles p on p.id = ur.user_id
    where ur.company_id = p_company_id
    group by ur.user_id, u.email, p.full_name
    order by 3;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.admin_users(uuid), public.admin_user_detail(uuid, uuid),
                       public.user_update(uuid, uuid, jsonb), public.user_set_roles(uuid, uuid, uuid[]),
                       public.user_set_overrides(uuid, uuid, jsonb), public.user_set_status(uuid, uuid, boolean, text),
                       public.user_password_reset_begin(uuid, uuid), public.user_create_check(uuid, jsonb),
                       public.user_create_complete(uuid, uuid, jsonb, boolean), public.auth_revoke_sessions(uuid),
                       public.session_bootstrap(), public.company_members(uuid)
  from public, anon;
grant execute on function public.admin_users(uuid), public.admin_user_detail(uuid, uuid),
                          public.user_update(uuid, uuid, jsonb), public.user_set_roles(uuid, uuid, uuid[]),
                          public.user_set_overrides(uuid, uuid, jsonb), public.user_set_status(uuid, uuid, boolean, text),
                          public.user_password_reset_begin(uuid, uuid), public.user_create_check(uuid, jsonb),
                          public.user_create_complete(uuid, uuid, jsonb, boolean),
                          public.session_bootstrap(), public.company_members(uuid)
  to authenticated, service_role;
grant execute on function public.auth_revoke_sessions(uuid) to service_role;
revoke execute on function public.auth_revoke_sessions(uuid) from authenticated;   -- Supabase default privileges
