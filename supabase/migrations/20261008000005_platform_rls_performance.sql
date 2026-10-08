-- =============================================================================
-- PLATFORM R1 — RLS performance (no behaviour change).
--
-- With overrides, disabled memberships and temporary passwords, the effective
-- permission check does more work. Read policies of the form
--     app.is_member(company_id)                    and
--     app.has_permission(company_id, '<code>')
-- were evaluated once PER ROW. They are rewritten to the equivalent
--     company_id = any ((select app.user_company_ids())::uuid[])
--     company_id = any ((select app.permitted_company_ids('<code>'))::uuid[])
-- where the sub-select is an InitPlan: evaluated once PER QUERY.
-- Equivalence: user_company_ids() = companies where is_member() is true;
-- permitted_company_ids(p) = companies where has_permission(·, p) is true.
-- Write checks (INSERT / UPDATE / DELETE) keep the per-row form.
-- =============================================================================

create or replace function app.permitted_company_ids(p_permission text)
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c
  where app.user_has_permission(auth.uid(), c, p_permission)
$$;
grant execute on function app.permitted_company_ids(text) to authenticated, service_role;

do $$
declare p record; v_new text; v_code text;
begin
  for p in
    select n.nspname, c.relname, pol.polname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) as qual
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage') and pol.polpermissive and pol.polcmd = 'r'   -- SELECT policies
  loop
    v_new := null;
    if p.qual = 'app.is_member(company_id)' then
      v_new := 'company_id = any ((select app.user_company_ids())::uuid[])';
    else
      v_code := substring(p.qual from '^app\.has_permission\(company_id, ''([a-z0-9_.]+)''::text\)$');
      if v_code is not null then
        v_new := format('company_id = any ((select app.permitted_company_ids(%L))::uuid[])', v_code);
      end if;
    end if;
    if v_new is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.polname, p.nspname, p.relname, v_new);
    end if;
  end loop;
end $$;
