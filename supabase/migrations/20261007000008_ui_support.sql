-- =============================================================================
-- INVENTORY MVP — support for the web app + one security fix found while
-- building the UI.
-- =============================================================================

-- Per-godown "allow negative stock" bypasses the company setting, so only an
-- Owner/Admin (settings.edit) may switch it on — same rule as the company
-- setting itself (§5, §33).
create or replace function app.tg_godown_negative_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.allow_negative and (tg_op = 'INSERT' or not old.allow_negative)
     and not app.is_trusted_caller() and not app.has_permission(new.company_id, 'settings.edit') then
    raise exception 'Only the Owner / Admin can allow negative stock for a godown' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger godowns_negative_guard before insert or update of allow_negative on public.godowns
  for each row execute function app.tg_godown_negative_guard();

-- Members of a company with name, email and roles (Users screen).
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
revoke all on function public.company_members(uuid) from anon, public;
grant execute on function public.company_members(uuid) to authenticated;
