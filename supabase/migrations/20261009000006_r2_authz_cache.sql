-- =============================================================================
-- PLATFORM R2 — performance: transaction-scoped authorization cache.
--
-- Triggers that guard every written row (rate rights, data scopes) asked the
-- same permission / scope question once per row. The answers are now cached
-- for the current transaction (one API request) in a transaction-local
-- setting, keyed by user, company and permission / dimension. Any change of
-- roles, role permissions, overrides, scopes, memberships or login state in
-- the transaction clears the cache, so a change is visible immediately.
-- The setting cannot be written through the API (only the exposed schemas
-- are callable there); it is reset at the end of every transaction.
-- =============================================================================

create or replace function app.authz_cache_get(p_key text)
returns text
language sql stable
as $$ select (nullif(current_setting('app.authz_cache', true), '')::jsonb) ->> p_key $$;

create or replace function app.authz_cache_put(p_key text, p_value text)
returns void
language sql volatile
as $$
  select set_config('app.authz_cache',
    (coalesce(nullif(current_setting('app.authz_cache', true), '')::jsonb, '{}'::jsonb) || jsonb_build_object(p_key, p_value))::text, true)
$$;

create or replace function app.tg_authz_cache_clear()
returns trigger
language plpgsql
as $$
begin
  perform set_config('app.authz_cache', '', true);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['user_roles', 'role_permissions', 'roles', 'user_permission_overrides', 'user_data_scopes',
                           'role_data_scopes', 'company_users', 'profiles', 'portal_users'] loop
    execute format('create trigger %1$s_authz_cache after insert or update or delete or truncate on public.%1$I
                    for each statement execute function app.tg_authz_cache_clear()', t);
  end loop;
end $$;

-- uncached originals
CREATE OR REPLACE FUNCTION app.user_has_permission_nc(p_user uuid, p_company_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select p_user is not null
     and exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.company_id = p_company_id)
     and app.user_is_active(p_user, p_company_id)
     and (app.is_owner(p_user, p_company_id)
          or (not exists (select 1 from public.user_permission_overrides o
                          where o.company_id = p_company_id and o.user_id = p_user
                            and o.permission_code = p_permission and o.effect = 'DENY')
              and (exists (select 1 from public.user_roles ur
                           join public.roles r on r.id = ur.role_id
                           join public.role_permissions rp on rp.role_id = ur.role_id
                           where ur.user_id = p_user and ur.company_id = p_company_id
                             and r.is_active and rp.permission_code = p_permission)
                   or exists (select 1 from public.user_permission_overrides o
                              where o.company_id = p_company_id and o.user_id = p_user
                                and o.permission_code = p_permission and o.effect = 'ALLOW'))))
$function$;

CREATE OR REPLACE FUNCTION app.user_scope_ids_nc(p_user uuid, p_company_id uuid, p_dimension text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v uuid[];
begin
  if p_user is null or app.is_owner(p_user, p_company_id) then
    return null;
  end if;
  select array_agg(entity_id) into v from public.user_data_scopes
   where company_id = p_company_id and user_id = p_user and dimension = p_dimension;
  if v is not null then
    return v;
  end if;
  if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p_user and ur.company_id = p_company_id and r.is_active)
     or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                where ur.user_id = p_user and ur.company_id = p_company_id and r.is_active
                  and not exists (select 1 from public.role_data_scopes s
                                  where s.role_id = r.id and s.dimension = p_dimension)) then
    return null;
  end if;
  select array_agg(distinct s.entity_id) into v
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.is_active
  join public.role_data_scopes s on s.role_id = r.id and s.dimension = p_dimension
  where ur.user_id = p_user and ur.company_id = p_company_id;
  return v;
end;
$function$;

create or replace function app.user_has_permission(p_user uuid, p_company_id uuid, p_permission text)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_key text := 'p|' || coalesce(p_user::text, '') || '|' || coalesce(p_company_id::text, '') || '|' || p_permission; v text;
begin
  v := app.authz_cache_get(v_key);
  if v is null then
    v := coalesce(app.user_has_permission_nc(p_user, p_company_id, p_permission), false)::text;
    perform app.authz_cache_put(v_key, v);
  end if;
  return v::boolean;
end;
$$;

create or replace function app.user_scope_ids(p_user uuid, p_company_id uuid, p_dimension text)
returns uuid[]
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_key text := 's|' || coalesce(p_user::text, '') || '|' || coalesce(p_company_id::text, '') || '|' || p_dimension; v text;
begin
  v := app.authz_cache_get(v_key);
  if v is null then
    v := coalesce(app.user_scope_ids_nc(p_user, p_company_id, p_dimension)::text, 'ALL');
    perform app.authz_cache_put(v_key, v);
  end if;
  return case when v = 'ALL' then null else v::uuid[] end;
end;
$$;

grant execute on function app.authz_cache_get(text), app.authz_cache_put(text, text), app.user_has_permission_nc(uuid, uuid, text),
                          app.user_scope_ids_nc(uuid, uuid, text) to authenticated, service_role;
revoke all on function app.tg_authz_cache_clear() from public, anon, authenticated;
