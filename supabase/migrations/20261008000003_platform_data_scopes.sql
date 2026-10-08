-- =============================================================================
-- PLATFORM R1 / PHASE 1 — data scopes (record-level security)
-- (docs/PLATFORM_ARCHITECTURE_PLAN.md §D "Data scopes", §H).
--
-- A scope restricts a user to selected records of one dimension. R1 enforces
-- the GODOWN dimension everywhere stock or godown documents are read or
-- written; further dimensions (customers, vendors, items) are added as rows of
-- data_scope_dimensions together with their enforcement in later releases.
--
-- Effective scope of a user for a dimension:
--   owner                                   → unrestricted
--   user has own scope rows                 → exactly those records
--   every ACTIVE role of the user is scoped → union of the role scopes
--   otherwise                               → unrestricted (= behaviour before
--                                              this release; no rows = all)
--
-- Enforcement (never only in the UI):
--   * RESTRICTIVE RLS policies on every table with a godown column (reads and
--     direct writes; security-invoker views and reports inherit them),
--   * triggers on stock movements, reservations, godown documents and their
--     lines, so SECURITY DEFINER posting RPCs cannot touch another godown.
-- =============================================================================

create table public.data_scope_dimensions (
  code          text primary key,
  label         text not null,
  entity_table  text not null,
  description   text not null default '',
  sort_order    integer not null default 100
);
insert into public.data_scope_dimensions (code, label, entity_table, description, sort_order) values
  ('GODOWN', 'Godowns', 'godowns',
   'Stock, locations, reservations and godown documents only of the assigned godowns (ASSIGNED_GODOWNS).', 10);

create table public.role_data_scopes (
  role_id     uuid not null references public.roles (id) on delete cascade,
  dimension   text not null references public.data_scope_dimensions (code),
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  primary key (role_id, dimension, entity_id)
);

create table public.user_data_scopes (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  dimension   text not null references public.data_scope_dimensions (code),
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  primary key (company_id, user_id, dimension, entity_id)
);
create index user_data_scopes_user_idx on public.user_data_scopes (user_id, company_id, dimension);

-- Deleted godowns disappear from scopes.
create or replace function app.tg_godown_scope_cleanup()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.user_data_scopes where dimension = 'GODOWN' and entity_id = old.id;
  delete from public.role_data_scopes where dimension = 'GODOWN' and entity_id = old.id;
  return old;
end;
$$;
create trigger godowns_scope_cleanup after delete on public.godowns
  for each row execute function app.tg_godown_scope_cleanup();

-- -----------------------------------------------------------------------------
-- Scope resolution
-- -----------------------------------------------------------------------------

-- Allowed record ids of a dimension for a user; NULL = unrestricted.
create or replace function app.user_scope_ids(p_user uuid, p_company_id uuid, p_dimension text)
returns uuid[]
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
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
$$;

-- Is the record allowed for the current user? NULL record / no user (worker,
-- migrations) / unrestricted user → true.
create or replace function app.scope_allows(p_company_id uuid, p_dimension text, p_entity_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select p_entity_id is null or auth.uid() is null
      or coalesce(p_entity_id = any (app.user_scope_ids(auth.uid(), p_company_id, p_dimension)), true)
$$;

-- RLS helpers, used as InitPlans (evaluated once per query, not per row):
--   companies of the user without a godown restriction, and
--   the godowns assigned where there is one.
create or replace function app.godown_unrestricted_company_ids()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c
  where app.user_scope_ids(auth.uid(), c, 'GODOWN') is null
$$;

create or replace function app.allowed_godown_ids()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct g), '{}')
  from unnest(app.user_company_ids()) c
  cross join lateral unnest(app.user_scope_ids(auth.uid(), c, 'GODOWN')) g
$$;

create or replace function public.my_scopes(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_object_agg(d.code, to_jsonb(app.user_scope_ids(auth.uid(), p_company_id, d.code))), '{}')
  from public.data_scope_dimensions d
  where app.is_member(p_company_id)
$$;

-- -----------------------------------------------------------------------------
-- Tables carrying a godown (registry = data, used by policies and triggers).
--   read_any: a row with several godown columns (transfer from → to) is
--   visible when one of them is allowed; writing needs all of them.
-- -----------------------------------------------------------------------------
create table app.godown_scoped_tables (
  table_name  text primary key,
  columns     text[] not null,
  read_any    boolean not null default false,
  guard_writes boolean not null default true   -- trigger (tables written by SECURITY DEFINER RPCs)
);
insert into app.godown_scoped_tables values
  ('godowns',                     '{id}',                          false, false),
  ('storage_locations',           '{godown_id}',                   false, false),
  ('item_consumption_rules',      '{godown_id}',                   false, false),
  ('stock_balances',              '{godown_id}',                   false, false),
  ('stock_reserved',              '{godown_id}',                   false, false),
  ('stock_movements',             '{godown_id}',                   false, true),
  ('stock_reservations',          '{godown_id}',                   false, true),
  ('stock_reservation_movements', '{godown_id}',                   false, true),
  ('stock_transfers',             '{from_godown_id,to_godown_id}', true,  true),
  ('stock_adjustments',           '{godown_id}',                   false, true),
  ('dispatches',                  '{godown_id}',                   false, true),
  ('sales_orders',                '{godown_id}',                   false, true),
  ('sales_returns',               '{godown_id}',                   false, true),
  ('purchase_orders',             '{godown_id}',                   false, true),
  ('purchase_receipts',           '{godown_id}',                   false, true),
  ('purchase_returns',            '{godown_id}',                   false, true),
  ('material_issues',             '{godown_id}',                   false, true),
  ('job_work_orders',             '{default_godown_id}',           false, true),
  ('job_work_receipts',           '{godown_id}',                   false, true),
  ('job_work_returns',            '{godown_id}',                   false, true),
  ('production_orders',           '{factory_godown_id}',           false, true),
  ('production_receipts',         '{godown_id,factory_godown_id}', true,  true);

-- All godown columns of a row allowed (p_any: at least one)?
create or replace function app.row_godowns_allowed(p_row jsonb, p_columns text[], p_any boolean)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_col text; v_ok boolean; v_seen boolean := false;
begin
  if auth.uid() is null then
    return true;
  end if;
  foreach v_col in array p_columns loop
    continue when p_row ->> v_col is null;
    v_seen := true;
    v_ok := app.scope_allows((p_row ->> 'company_id')::uuid, 'GODOWN', (p_row ->> v_col)::uuid);
    if p_any and v_ok then
      return true;
    elsif not p_any and not v_ok then
      return false;
    end if;
  end loop;
  return not p_any or not v_seen;
end;
$$;

create or replace function app.raise_godown_denied(p_row jsonb, p_columns text[])
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_col text; v_id uuid;
begin
  foreach v_col in array p_columns loop
    v_id := (p_row ->> v_col)::uuid;
    if v_id is not null and not app.scope_allows((p_row ->> 'company_id')::uuid, 'GODOWN', v_id) then
      raise exception 'Godown access denied: you are not assigned to godown %',
        coalesce((select code from public.godowns where id = v_id), v_id::text) using errcode = '42501';
    end if;
  end loop;
  raise exception 'Godown access denied' using errcode = '42501';
end;
$$;

-- Write guard for tables written by SECURITY DEFINER RPCs (posting engine).
create or replace function app.tg_godown_scope_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_cols text[];
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select columns into v_cols from app.godown_scoped_tables where table_name = tg_table_name;
  if tg_op in ('UPDATE', 'DELETE') and not app.row_godowns_allowed(to_jsonb(old), v_cols, false) then
    perform app.raise_godown_denied(to_jsonb(old), v_cols);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not app.row_godowns_allowed(to_jsonb(new), v_cols, false) then
    perform app.raise_godown_denied(to_jsonb(new), v_cols);
  end if;
  return coalesce(new, old);
end;
$$;

-- Lines of a godown document: the parent document must be allowed.
-- TG_ARGV: header table, foreign-key column of the line.
create or replace function app.tg_godown_scope_line_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_cols text[]; v_header jsonb; v_fk uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select columns into v_cols from app.godown_scoped_tables where table_name = tg_argv[0];
  v_fk := (to_jsonb(coalesce(new, old)) ->> tg_argv[1])::uuid;
  execute format('select to_jsonb(h) from public.%I h where id = $1', tg_argv[0]) into v_header using v_fk;
  if v_header is not null and not app.row_godowns_allowed(v_header, v_cols, false) then
    perform app.raise_godown_denied(v_header, v_cols);
  end if;
  return coalesce(new, old);
end;
$$;

-- For RPCs that read a single document by id.
create or replace function app.assert_doc_godown_scope(p_table text, p_id uuid)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_cols text[]; v_any boolean; v_row jsonb;
begin
  if auth.uid() is null then
    return;
  end if;
  select columns, read_any into v_cols, v_any from app.godown_scoped_tables where table_name = p_table;
  if v_cols is null then
    return;
  end if;
  execute format('select to_jsonb(h) from public.%I h where id = $1', p_table) into v_row using p_id;
  if v_row is not null and not app.row_godowns_allowed(v_row, v_cols, v_any) then
    perform app.raise_godown_denied(v_row, v_cols);
  end if;
end;
$$;

-- Policies + triggers from the registry.
do $$
declare t app.godown_scoped_tables; v_read text; v_write text; d record;
begin
  for t in select * from app.godown_scoped_tables loop
    -- reads: one evaluation per query (InitPlan); writes: per row
    select string_agg(format('(%1$I is null or company_id = any ((select app.godown_unrestricted_company_ids())::uuid[])'
                             ' or %1$I = any ((select app.allowed_godown_ids())::uuid[]))', c),
                      case when t.read_any then ' or ' else ' and ' end)
      into v_read from unnest(t.columns) c;
    select string_agg(format('app.scope_allows(company_id, %L, %I)', 'GODOWN', c), ' and ')
      into v_write from unnest(t.columns) c;
    execute format('create policy %1$s_godown_scope on public.%1$I as restrictive for all to authenticated
                    using (%2$s) with check (%3$s)', t.table_name, v_read, v_write);
    if t.guard_writes then
      execute format('create trigger %1$s_godown_scope before insert or update or delete on public.%1$I
                      for each row execute function app.tg_godown_scope_guard()', t.table_name);
    end if;
  end loop;
  -- lines of godown documents
  for d in select dt.table_name, dt.line_table, dt.line_fk from app.doc_types dt
           join app.godown_scoped_tables g on g.table_name = dt.table_name
           where dt.line_table is not null loop
    execute format('create trigger %1$s_godown_scope before insert or update or delete on public.%1$I
                    for each row execute function app.tg_godown_scope_line_guard(%2$L, %3$L)',
                   d.line_table, d.table_name, d.line_fk);
  end loop;
end $$;

-- PO print / email read a document by id.
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
  perform app.assert_doc_godown_scope('purchase_orders', p_po_id);
  return app.purchase_order_print_data(p_po_id);
end;
$$;

create or replace function public.purchase_order_send_email(p_po_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.purchase_orders; v uuid;
begin
  select * into o from public.purchase_orders where id = p_po_id;
  if o.id is null or not app.is_member(o.company_id) then
    raise exception 'Purchase order not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(o.company_id, 'email.create');
  perform app.assert_doc_godown_scope('purchase_orders', p_po_id);
  if o.status in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED') then
    raise exception 'Only confirmed POs can be emailed' using errcode = 'P0001';
  end if;
  v := app.queue_vendor_po_email(o.id);
  if v is null then
    raise exception 'Vendor PO email is turned off in Settings → Email (or for this vendor)' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Scope assignment RPCs (audited). Empty list = unrestricted.
-- -----------------------------------------------------------------------------
create or replace function app.assert_scope_entities(p_company_id uuid, p_dimension text, p_ids uuid[])
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_table text; v_bad int;
begin
  select entity_table into v_table from public.data_scope_dimensions where code = p_dimension;
  if v_table is null then
    raise exception 'Unknown data scope %', p_dimension using errcode = 'P0001';
  end if;
  execute format('select count(*) from unnest($1) x where not exists (select 1 from public.%I e where e.id = x and e.company_id = $2)', v_table)
    into v_bad using p_ids, p_company_id;
  if v_bad > 0 then
    raise exception 'Data scope contains records of another company or unknown records' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.role_set_scope(p_role_id uuid, p_dimension text, p_entity_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_ids uuid[] := array(select distinct unnest(coalesce(p_entity_ids, '{}')));
        v_old uuid[];
begin
  r := app.role_for_write(p_role_id, 'roles.edit');
  perform app.require_permission(r.company_id, 'users.assign_scope');
  if r.is_locked then
    raise exception 'The % role always has access to all records', r.name using errcode = '42501';
  end if;
  perform app.assert_scope_entities(r.company_id, p_dimension, v_ids);
  select array_agg(entity_id) into v_old from public.role_data_scopes where role_id = r.id and dimension = p_dimension;
  delete from public.role_data_scopes where role_id = r.id and dimension = p_dimension;
  insert into public.role_data_scopes (role_id, dimension, entity_id, created_by)
  select r.id, p_dimension, unnest(v_ids), auth.uid();
  perform app.audit(r.company_id, 'roles', r.id::text, 'SCOPE',
                    jsonb_build_object('dimension', p_dimension, 'ids', to_jsonb(v_old)),
                    jsonb_build_object('dimension', p_dimension, 'ids', to_jsonb(v_ids)));
end;
$$;

create or replace function public.user_set_scope(p_company_id uuid, p_user_id uuid, p_dimension text, p_entity_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_ids uuid[] := array(select distinct unnest(coalesce(p_entity_ids, '{}'))); v_old uuid[];
begin
  if not app.is_member(p_company_id)
     or not exists (select 1 from public.user_roles where company_id = p_company_id and user_id = p_user_id) then
    raise exception 'User not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'users.assign_scope');
  if p_user_id = auth.uid() and not app.is_owner(auth.uid(), p_company_id) then
    raise exception 'You cannot change your own data scope' using errcode = '42501';
  end if;
  if app.is_owner(p_user_id, p_company_id) then
    raise exception 'An owner always has access to all records' using errcode = '42501';
  end if;
  perform app.assert_scope_entities(p_company_id, p_dimension, v_ids);
  select array_agg(entity_id) into v_old from public.user_data_scopes
   where company_id = p_company_id and user_id = p_user_id and dimension = p_dimension;
  delete from public.user_data_scopes where company_id = p_company_id and user_id = p_user_id and dimension = p_dimension;
  insert into public.user_data_scopes (company_id, user_id, dimension, entity_id, created_by)
  select p_company_id, p_user_id, p_dimension, unnest(v_ids), auth.uid();
  perform app.audit(p_company_id, 'users', p_user_id::text, 'SCOPE',
                    jsonb_build_object('dimension', p_dimension, 'ids', to_jsonb(v_old)),
                    jsonb_build_object('dimension', p_dimension, 'ids', to_jsonb(v_ids)));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.data_scope_dimensions enable row level security;
alter table public.role_data_scopes enable row level security;
alter table public.user_data_scopes enable row level security;
create policy data_scope_dimensions_read on public.data_scope_dimensions for select to authenticated using (true);
create policy role_data_scopes_read on public.role_data_scopes for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and app.is_member(r.company_id)));
create policy user_data_scopes_read on public.user_data_scopes for select to authenticated
  using (user_id = auth.uid() or app.has_permission(company_id, 'users.view'));

revoke all on public.data_scope_dimensions, public.role_data_scopes, public.user_data_scopes from anon;
grant select on public.data_scope_dimensions, public.role_data_scopes, public.user_data_scopes to authenticated;
revoke insert, update, delete, truncate on public.data_scope_dimensions, public.role_data_scopes,
                                           public.user_data_scopes from authenticated;
grant all on public.data_scope_dimensions, public.role_data_scopes, public.user_data_scopes to service_role;

revoke all on function public.role_set_scope(uuid, text, uuid[]), public.user_set_scope(uuid, uuid, text, uuid[]),
                       public.my_scopes(uuid) from public, anon;
grant execute on function public.role_set_scope(uuid, text, uuid[]), public.user_set_scope(uuid, uuid, text, uuid[]),
                          public.my_scopes(uuid) to authenticated, service_role;
-- used inside RLS policies
grant execute on function app.scope_allows(uuid, text, uuid), app.user_scope_ids(uuid, uuid, text), app.allowed_godown_ids(),
                          app.godown_unrestricted_company_ids()
  to authenticated, service_role;
revoke all on function app.tg_godown_scope_guard(), app.tg_godown_scope_line_guard(),
                       app.tg_godown_scope_cleanup() from public, anon;
