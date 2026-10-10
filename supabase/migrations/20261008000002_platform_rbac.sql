-- =============================================================================
-- PLATFORM R1 / PHASE 1 — configurable authorization engine
-- (docs/PLATFORM_ARCHITECTURE_PLAN.md §D, §H).
--
-- Additive. Every existing role keeps exactly the rights it has today.
--
-- * Permission catalogue is data: permission_modules + permissions metadata.
--   The Permission Matrix UI renders whatever is in these tables.
-- * Roles are editable, cloneable and can be disabled; only the OWNER role is
--   locked (grants_all: every permission, also the ones added later).
-- * Default roles are seeded ONCE per company; admin edits are never reverted
--   (sync_system_role_permissions no longer deletes / re-applies grants).
-- * Effective permission = permissions of the user's ACTIVE roles
--   ∪ ALLOW overrides − DENY overrides; nothing while the membership is
--   disabled or a temporary password still has to be changed.
-- * Nobody can grant a permission they do not hold themselves (no privilege
--   escalation); only an owner can change owners.
-- * Role / permission writes only through the audited RPCs below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permission catalogue
-- -----------------------------------------------------------------------------
create table public.permission_modules (
  module       text primary key,
  label        text not null,
  group_label  text not null,
  sort_order   integer not null default 1000,
  description  text not null default ''
);

insert into public.permission_modules (module, label, group_label, sort_order) values
  ('items',              'Items & packing',            'Inventory',        110),
  ('godowns',            'Godowns & locations',        'Inventory',        120),
  ('stock_transfer',     'Stock transfers',            'Inventory',        130),
  ('stock_adjustment',   'Stock adjustments',          'Inventory',        140),
  ('reservation',        'Stock reservations',         'Inventory',        150),
  ('rates',              'Rate lists',                 'Inventory',        160),
  ('parties',            'Customers & vendors',        'Masters',          210),
  ('customer_po',        'Customer POs',               'Sales',            310),
  ('sales_order',        'Sales orders',               'Sales',            320),
  ('dispatch',           'Dispatch',                   'Sales',            330),
  ('sales_return',       'Sales returns',              'Sales',            340),
  ('customer_bill',      'Customer invoices',          'Sales',            350),
  ('purchase_order',     'Purchase orders',            'Purchase',         410),
  ('purchase_receipt',   'Purchase receipts',          'Purchase',         420),
  ('purchase_return',    'Purchase returns',           'Purchase',         430),
  ('service_bill',       'Service / vendor bills',     'Purchase',         440),
  ('voucher',            'Payments & receipts',        'Accounts',         510),
  ('accounts',           'Chart of accounts',          'Accounts',         520),
  ('reports',            'Reports',                    'Accounts',         530),
  ('job_work_order',     'Job-work orders',            'Factory',          610),
  ('job_work_receipt',   'Job-work receipts',          'Factory',          620),
  ('job_work_return',    'Job-work debit notes',       'Factory',          630),
  ('material_issue',     'Material issues',            'Factory',          640),
  ('production_lot',     'Production lots',            'Factory',          650),
  ('production_receipt', 'Production receipts',        'Factory',          660),
  ('worker_earning',     'Worker earnings',            'Factory',          670),
  ('documents',          'Documents',                  'Documents',        710),
  ('email',              'Email log & sending',        'Documents',        720),
  ('portal',             'Customer / vendor portals',  'Portals',          810),
  ('users',              'Users',                      'Administration',   910),
  ('roles',              'Roles & permissions',        'Administration',   920),
  ('settings',           'Company settings',           'Administration',   930),
  ('audit',              'Audit log',                  'Administration',   940),
  ('company',            'Companies',                  'Administration',   950)
on conflict (module) do nothing;

alter table public.permissions
  add column label        text,
  add column kind         text not null default 'ACTION'
                          check (kind in ('MODULE', 'PAGE', 'ACTION', 'FIELD', 'PORTAL')),
  add column sort_order   integer not null default 100,
  add column is_sensitive boolean not null default false;

update public.permissions
   set label = initcap(replace(lower(action::text), '_', ' ')),
       kind = case when action = 'VIEW' then 'PAGE' else 'ACTION' end,
       sort_order = array_position(array['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'CANCEL', 'EXPORT'], action::text) * 10;

-- Fine-grained permissions for user / role administration.
insert into public.permissions (code, module, action, description, label, kind, sort_order, is_sensitive) values
  ('users.disable',            'users', 'DISABLE', 'Users — disable / enable logins',              'Disable / enable',     'ACTION', 110, true),
  ('users.reset_password',     'users', 'RESET',   'Users — reset password (temporary password)',  'Reset password',       'ACTION', 120, true),
  ('users.assign_role',        'users', 'ASSIGN',  'Users — assign roles',                         'Assign roles',         'ACTION', 130, true),
  ('users.assign_permissions', 'users', 'ASSIGN',  'Users — permission overrides (allow / deny)',  'Permission overrides', 'ACTION', 140, true),
  ('users.assign_scope',       'users', 'ASSIGN',  'Users — data scope (godown access)',           'Assign data scope',    'ACTION', 150, true),
  ('users.manage_owners',      'users', 'MANAGE',  'Users — grant / remove the Owner role',        'Manage owners',        'ACTION', 160, true),
  ('roles.view',               'roles', 'VIEW',    'Roles & permissions — view',                   'View',                 'PAGE',    10, false),
  ('roles.create',             'roles', 'CREATE',  'Roles & permissions — create / clone roles',   'Create',               'ACTION',  20, true),
  ('roles.edit',               'roles', 'EDIT',    'Roles & permissions — edit role permissions',  'Edit',                 'ACTION',  30, true),
  ('roles.delete',             'roles', 'DELETE',  'Roles & permissions — delete roles',           'Delete',               'ACTION',  40, true),
  ('company.create',           'company', 'MANAGE', 'Create another company in this installation', 'Create company',       'ACTION', 110, true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Roles: editable, cloneable, can be disabled; OWNER locked.
-- -----------------------------------------------------------------------------
alter table public.roles
  add column description  text not null default '',
  add column kind         text not null default 'INTERNAL'
                          check (kind in ('INTERNAL', 'CUSTOMER_PORTAL', 'VENDOR_PORTAL')),
  add column is_active    boolean not null default true,
  add column is_locked    boolean not null default false,
  add column grants_all   boolean not null default false,
  add column copied_from  uuid references public.roles (id) on delete set null,
  add column sort_order   integer not null default 100,
  add constraint roles_grants_all_locked check (not grants_all or (is_locked and is_active));

alter table app.default_roles
  add column description text not null default '',
  add column sort_order  integer not null default 100,
  add column is_locked   boolean not null default false;

update app.default_roles d set description = v.description, sort_order = v.sort_order, is_locked = v.locked
from (values
  ('OWNER',      'Full control of the company. Locked: always has every permission.', 10, true),
  ('ADMIN',      'Operational administration as decided by the owner.',               20, false),
  ('APPROVER',   'Senior user: approves documents, no deletions.',                     40, false),
  ('ACCOUNTANT', 'Accounts: invoices, payments, documents, email.',                    70, false),
  ('PURCHASE',   'Purchase: POs, receiving, vendors.',                                 60, false),
  ('SALES',      'Sales: customer POs, orders, dispatch.',                             50, false),
  ('OPERATOR',   'Data entry: view, create, edit.',                                    90, false),
  ('VIEWER',     'Read only.',                                                         99, false)
) as v(code, description, sort_order, locked)
where d.code = v.code;

insert into app.default_roles (code, name, description, sort_order, is_locked) values
  ('MANAGER',   'Manager',   'Everything operational incl. approvals; no deletions, no administration.', 30, false),
  ('INVENTORY', 'Inventory', 'Items, godowns, stock transfers / adjustments, receiving and dispatch.',    80, false),
  ('FACTORY',   'Factory',   'Job work, material issues and production.',                                85, false)
on conflict (code) do nothing;

-- metadata of the system roles, not a user change: keep updated_at / updated_by of existing roles
alter table public.roles disable trigger roles_audit_fields;
update public.roles r
   set is_locked = d.is_locked, grants_all = d.is_locked, description = d.description, sort_order = d.sort_order
from app.default_roles d
where r.is_system and r.code = d.code;
alter table public.roles enable trigger roles_audit_fields;

-- Default grants of the seeded roles. Used ONCE when a role is created for a
-- company; afterwards the role belongs to the company admin.
create or replace function app.default_role_grants(p_role text, p_code text, p_module text, p_action public.perm_action)
returns boolean
language sql immutable
as $$
  select case
    when p_role = 'OWNER' then true
    when p_role = 'ADMIN' then p_code not in ('users.manage_owners')
    when p_role = 'MANAGER' then
      case when p_module in ('settings', 'users', 'roles', 'portal', 'audit', 'company') then p_action = 'VIEW'
           else p_action in ('VIEW', 'CREATE', 'EDIT', 'APPROVE', 'CANCEL', 'EXPORT') end
    when p_role = 'INVENTORY' then
      p_module not in ('settings', 'users', 'roles', 'portal', 'audit', 'company', 'accounts', 'voucher',
                       'customer_bill', 'service_bill', 'reports')
      and (p_action in ('VIEW', 'EXPORT')
           or (p_module in ('items', 'godowns', 'stock_transfer', 'stock_adjustment', 'reservation',
                            'purchase_receipt', 'dispatch', 'documents') and p_action in ('CREATE', 'EDIT')))
    when p_role = 'FACTORY' then
      (p_module in ('job_work_order', 'job_work_receipt', 'job_work_return', 'material_issue',
                    'production_lot', 'production_receipt', 'worker_earning')
       and p_action in ('VIEW', 'CREATE', 'EDIT', 'EXPORT'))
      or (p_module in ('items', 'godowns', 'parties', 'documents') and p_action = 'VIEW')
    -- older default roles: no access to the new administration rights
    when p_module in ('roles', 'company')
         or (p_module = 'users' and p_action not in ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'CANCEL', 'EXPORT')) then false
    else app.role_grants(p_role, p_module, p_action)
  end
$$;

-- Seed missing default roles of a company with their default grants.
-- Existing roles are never touched (admin edits are kept).
create or replace function app.seed_default_roles(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  with ins as (
    insert into public.roles (company_id, code, name, is_system, description, sort_order, is_locked, grants_all)
    select p_company_id, d.code, d.name, true, d.description, d.sort_order, d.is_locked, d.is_locked
    from app.default_roles d
    on conflict do nothing
    returning id, code)
  insert into public.role_permissions (role_id, permission_code)
  select ins.id, p.code from ins cross join public.permissions p
  where app.default_role_grants(ins.code, p.code, p.module, p.action)
  on conflict do nothing;
end;
$$;

-- Kept for compatibility (called by app.init_company): seed-once now.
create or replace function app.sync_system_role_permissions(p_company_id uuid)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.seed_default_roles(p_company_id) $$;

-- Backfill (existing companies keep their behaviour):
--   * roles that could edit users (users.edit) get the new user/role admin rights,
--   * roles that could view users get roles.view,
--   * ADMIN roles get company.create (create_company allowed OWNER / ADMIN),
--   * OWNER explicitly holds every permission (also implied by grants_all).
insert into public.role_permissions (role_id, permission_code)
select rp.role_id, n.code
from public.role_permissions rp
cross join (values ('users.disable'), ('users.reset_password'), ('users.assign_role'), ('users.assign_permissions'),
                   ('users.assign_scope'), ('roles.view'), ('roles.create'), ('roles.edit'), ('roles.delete')) n(code)
where rp.permission_code = 'users.edit'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select rp.role_id, 'roles.view' from public.role_permissions rp where rp.permission_code = 'users.view'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'company.create' from public.roles r where r.is_system and r.code in ('OWNER', 'ADMIN')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.grants_all
on conflict do nothing;

-- Locked roles cannot be deleted, renamed (code), disabled or reduced.
create or replace function app.tg_roles_protect()
returns trigger
language plpgsql
as $$
begin
  if app.is_trusted_caller() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and old.is_locked then
    raise exception 'The % role is protected and cannot be deleted', old.name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.is_locked and (new.code is distinct from old.code or not new.is_active
       or new.is_locked is distinct from old.is_locked or new.grants_all is distinct from old.grants_all
       or new.kind is distinct from old.kind) then
    raise exception 'The % role is protected: only its name and description can be changed', old.name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not old.is_locked and (new.is_locked or new.grants_all) then
    raise exception 'Only the Owner role is locked' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'company_id cannot be changed' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger roles_protect before update or delete on public.roles
  for each row execute function app.tg_roles_protect();

-- The permissions of a locked (owner) role cannot be removed.
create or replace function app.tg_role_permissions_protect()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_trusted_caller() and exists (select 1 from public.roles r where r.id = old.role_id and r.is_locked)
     and exists (select 1 from public.permissions p where p.code = old.permission_code) then
    raise exception 'Permissions of the protected Owner role cannot be removed' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger role_permissions_protect before delete on public.role_permissions
  for each row execute function app.tg_role_permissions_protect();

-- -----------------------------------------------------------------------------
-- Company membership details (per company: a user can belong to several).
-- -----------------------------------------------------------------------------
create table public.company_users (
  company_id       uuid not null references public.companies (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  employee_code    text,
  department       text,
  designation      text,
  mobile           text,
  notes            text,
  disabled_at      timestamptz,
  disabled_by      uuid,
  disabled_reason  text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  primary key (company_id, user_id)
);
create index company_users_user_idx on public.company_users (user_id);
create unique index company_users_employee_code_uq on public.company_users (company_id, upper(employee_code))
  where employee_code is not null;
create trigger company_users_audit_fields before insert or update on public.company_users
  for each row execute function app.tg_set_audit_fields();

insert into public.company_users (company_id, user_id)
select distinct company_id, user_id from public.user_roles
on conflict do nothing;

create or replace function app.tg_user_roles_membership()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.company_users (company_id, user_id) values (new.company_id, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;
create trigger user_roles_membership after insert on public.user_roles
  for each row execute function app.tg_user_roles_membership();

-- Global login state (a password is global, not per company).
alter table public.profiles
  add column must_change_password        boolean not null default false,
  add column password_changed_at         timestamptz,
  add column password_reset_pending_until timestamptz,
  add column last_login_seen_at          timestamptz;

-- Users may edit only their name / phone; status and password flags are
-- written by the administration RPCs.
revoke insert, update on public.profiles from authenticated;
grant insert (id, full_name, phone, default_company_id) on public.profiles to authenticated;
grant update (full_name, phone, default_company_id) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Per-user permission overrides
-- -----------------------------------------------------------------------------
create table public.user_permission_overrides (
  company_id       uuid not null references public.companies (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  permission_code  text not null references public.permissions (code) on delete cascade,
  effect           text not null check (effect in ('ALLOW', 'DENY')),
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  primary key (company_id, user_id, permission_code)
);
create index user_permission_overrides_user_idx on public.user_permission_overrides (user_id, company_id);

-- -----------------------------------------------------------------------------
-- Effective permissions
-- -----------------------------------------------------------------------------

-- Membership is usable: not disabled in this company, no pending temporary
-- password, login not globally deactivated. Rows that do not exist yet
-- (users created before this release) count as active.
create or replace function app.user_is_active(p_user uuid, p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from public.company_users cu
                     where cu.company_id = p_company_id and cu.user_id = p_user and cu.status <> 'ACTIVE')
     and not exists (select 1 from public.profiles p
                     where p.id = p_user and (p.must_change_password or not p.is_active))
$$;

create or replace function app.is_owner(p_user uuid, p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p_user and ur.company_id = p_company_id and r.grants_all and r.is_active)
$$;

create or replace function app.user_has_permission(p_user uuid, p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
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
$$;

-- Same signature as before: the 54 policies / RPCs using it are unchanged.
create or replace function app.has_permission(p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$ select app.user_has_permission(auth.uid(), p_company_id, p_permission) $$;

create or replace function app.is_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and company_id = p_company_id)
     and app.user_is_active(auth.uid(), p_company_id)
$$;

create or replace function app.user_company_ids()
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct company_id), '{}')
  from public.user_roles where user_id = auth.uid() and app.user_is_active(auth.uid(), company_id)
$$;

-- Effective permission set of a user (owner: every permission).
create or replace function app.user_permissions(p_user uuid, p_company_id uuid)
returns setof text
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select p.code from public.permissions p
  where exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.company_id = p_company_id)
    and app.user_is_active(p_user, p_company_id)
    and (app.is_owner(p_user, p_company_id)
         or ((p.code in (select rp.permission_code from public.user_roles ur
                         join public.roles r on r.id = ur.role_id
                         join public.role_permissions rp on rp.role_id = ur.role_id
                         where ur.user_id = p_user and ur.company_id = p_company_id and r.is_active)
              or p.code in (select o.permission_code from public.user_permission_overrides o
                            where o.company_id = p_company_id and o.user_id = p_user and o.effect = 'ALLOW'))
             and p.code not in (select o.permission_code from public.user_permission_overrides o
                                where o.company_id = p_company_id and o.user_id = p_user and o.effect = 'DENY')))
$$;

create or replace function public.my_permissions(p_company_id uuid)
returns setof text
language sql stable security definer
set search_path = public, app, pg_temp
as $$ select app.user_permissions(auth.uid(), p_company_id) $$;

-- -----------------------------------------------------------------------------
-- Privilege-escalation guards (shared by every RPC that hands out rights)
-- -----------------------------------------------------------------------------

-- Raises unless the caller holds every permission in p_codes (owner: all).
create or replace function app.assert_can_grant(p_company_id uuid, p_codes text[])
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_missing text;
begin
  if app.is_trusted_caller() or app.is_owner(auth.uid(), p_company_id) then
    return;
  end if;
  select c into v_missing from unnest(p_codes) c
  where not app.has_permission(p_company_id, c) order by c limit 1;
  if v_missing is not null then
    raise exception 'You cannot grant the permission % because you do not hold it yourself', v_missing
      using errcode = '42501';
  end if;
end;
$$;

-- Checks for giving (or removing) a role to a user (or an invitation: p_user NULL).
create or replace function app.assert_can_assign_role(p_company_id uuid, p_user uuid, p_role_id uuid, p_removing boolean)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_actor uuid := auth.uid(); v_codes text[];
begin
  if app.is_trusted_caller() then
    return;
  end if;
  select * into r from public.roles where id = p_role_id;
  if r.id is null or r.company_id <> p_company_id then
    raise exception 'Unknown role' using errcode = 'P0001';
  end if;
  if p_user is not null then
    perform app.require_permission(p_company_id, 'users.assign_role');
  end if;
  if r.grants_all and not app.has_permission(p_company_id, 'users.manage_owners') then
    raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
  end if;
  if p_user is not null and p_user = v_actor and not app.is_owner(v_actor, p_company_id) then
    raise exception 'You cannot change your own roles' using errcode = '42501';
  end if;
  if p_user is not null and app.is_owner(p_user, p_company_id) and not app.is_owner(v_actor, p_company_id) then
    raise exception 'Only an owner can change the roles of an owner' using errcode = '42501';
  end if;
  if not p_removing then
    if r.kind <> 'INTERNAL' then
      raise exception 'Role % is a portal role and cannot be given to an internal user', r.name using errcode = 'P0001';
    end if;
    if not r.is_active then
      raise exception 'Role % is disabled', r.name using errcode = 'P0001';
    end if;
    select array_agg(permission_code) into v_codes from public.role_permissions where role_id = r.id;
    perform app.assert_can_grant(p_company_id, coalesce(v_codes, '{}'));
  end if;
end;
$$;

-- Direct table writes on user_roles (API) get the same checks as the RPCs.
-- SECURITY INVOKER on purpose: current_user is 'authenticated' only for a
-- direct API write; inside the SECURITY DEFINER RPCs it is the owner and the
-- RPC has already checked.
create or replace function app.tg_user_roles_privilege_guard()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if current_user = 'authenticated' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform app.assert_can_assign_role(old.company_id, old.user_id, old.role_id, true);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform app.assert_can_assign_role(new.company_id, new.user_id, new.role_id, false);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger user_roles_privilege_guard before insert or update or delete on public.user_roles
  for each row execute function app.tg_user_roles_privilege_guard();

-- Owner role guard (M1) — owner identified by the locked role, not its code.
-- An invitation to the owner role (created by an owner) may be claimed.
create or replace function app.tg_user_roles_owner_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_owner_role boolean; v_company uuid;
begin
  v_company := coalesce(new.company_id, old.company_id);
  if tg_op = 'UPDATE' then
    select bool_or(grants_all) into v_owner_role from public.roles where id in (new.role_id, old.role_id);
  else
    select grants_all into v_owner_role from public.roles where id = coalesce(new.role_id, old.role_id);
  end if;
  if not coalesce(v_owner_role, false) or app.is_trusted_caller() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and (
       not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                   where ur.company_id = v_company and r.grants_all)                -- first owner (create_company)
       or current_setting('app.claiming_invitation', true) = new.user_id::text) then  -- invitation by an owner
    return new;
  end if;
  if not app.is_owner(auth.uid(), v_company) then
    raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
  end if;
  if tg_op in ('DELETE', 'UPDATE') and not exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
       where ur.company_id = v_company and r.grants_all and ur.user_id <> old.user_id) then
    raise exception 'A company must keep at least one owner' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

-- Audit of role assignments (who got / lost which role).
create or replace function app.tg_user_roles_audit()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_role record;
begin
  select id, code, name into v_role from public.roles where id = coalesce(new.role_id, old.role_id);
  perform app.audit(coalesce(new.company_id, old.company_id), 'users', coalesce(new.user_id, old.user_id)::text,
                    case tg_op when 'INSERT' then 'ROLE_ADD' else 'ROLE_REMOVE' end,
                    case when tg_op = 'DELETE' then jsonb_build_object('role', v_role.code, 'role_name', v_role.name) end,
                    case when tg_op = 'INSERT' then jsonb_build_object('role', v_role.code, 'role_name', v_role.name) end);
  return coalesce(new, old);
end;
$$;
create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function app.tg_user_roles_audit();

-- user_roles direct writes: assignment permission (checks in the guard above).
drop policy user_roles_write on public.user_roles;
create policy user_roles_write on public.user_roles for all to authenticated
  using (app.has_permission(company_id, 'users.assign_role'))
  with check (app.has_permission(company_id, 'users.assign_role')
              and exists (select 1 from public.roles r where r.id = user_roles.role_id and r.company_id = user_roles.company_id));

-- Roles / role permissions: read for members, writes only via the RPCs.
drop policy roles_write on public.roles;
drop policy role_permissions_write on public.role_permissions;
revoke insert, update, delete, truncate on public.roles, public.role_permissions from authenticated;

-- -----------------------------------------------------------------------------
-- Role builder RPCs
-- -----------------------------------------------------------------------------
create or replace function app.role_for_write(p_role_id uuid, p_permission text)
returns public.roles
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles;
begin
  select * into r from public.roles where id = p_role_id;
  if r.id is null or not app.is_member(r.company_id) then
    raise exception 'Role not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(r.company_id, p_permission);
  return r;
end;
$$;

-- Create (p_role_id NULL) or update a role: code (create only), name,
-- description, is_active, sort_order.
create or replace function public.role_save(p_company_id uuid, p_role_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_id uuid; v_code text := upper(trim(coalesce(p_payload->>'code', '')));
begin
  if p_role_id is null then
    if not app.is_member(p_company_id) then
      raise exception 'Unknown company' using errcode = 'P0001';
    end if;
    perform app.require_permission(p_company_id, 'roles.create');
    if v_code !~ '^[A-Z0-9_\-]{2,40}$' then
      raise exception 'Role code must be 2–40 letters, digits, - or _' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.roles where company_id = p_company_id and upper(code) = v_code) then
      raise exception 'A role with code % already exists', v_code using errcode = 'P0001';
    end if;
    insert into public.roles (company_id, code, name, description, is_active, sort_order)
    values (p_company_id, v_code, coalesce(nullif(trim(p_payload->>'name'), ''), v_code),
            coalesce(p_payload->>'description', ''), coalesce((p_payload->>'is_active')::boolean, true),
            coalesce((p_payload->>'sort_order')::int, 100))
    returning id into v_id;
    perform app.audit(p_company_id, 'roles', v_id::text, 'CREATE', null, p_payload);
    return v_id;
  end if;

  r := app.role_for_write(p_role_id, 'roles.edit');
  if r.company_id <> p_company_id then
    raise exception 'Role not found' using errcode = 'P0001';
  end if;
  if r.grants_all and not app.is_owner(auth.uid(), r.company_id) then
    raise exception 'Only an owner can change the owner role' using errcode = '42501';
  end if;
  update public.roles
     set name = coalesce(nullif(trim(p_payload->>'name'), ''), name),
         description = coalesce(p_payload->>'description', description),
         is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
         sort_order = coalesce((p_payload->>'sort_order')::int, sort_order)
   where id = r.id;
  perform app.audit(r.company_id, 'roles', r.id::text, 'UPDATE',
                    jsonb_build_object('name', r.name, 'description', r.description, 'is_active', r.is_active),
                    p_payload);
  return r.id;
end;
$$;

-- Duplicate a role with its permissions and data scope.
create or replace function public.role_clone(p_role_id uuid, p_code text, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_id uuid;
begin
  r := app.role_for_write(p_role_id, 'roles.create');
  perform app.assert_can_grant(r.company_id, coalesce((select array_agg(permission_code) from public.role_permissions
                                                       where role_id = r.id), '{}'));
  v_id := public.role_save(r.company_id, null, jsonb_build_object('code', p_code, 'name', p_name,
                                                                  'description', r.description, 'sort_order', r.sort_order));
  update public.roles set copied_from = r.id, kind = r.kind where id = v_id;
  insert into public.role_permissions (role_id, permission_code)
  select v_id, permission_code from public.role_permissions where role_id = r.id;
  perform app.audit(r.company_id, 'roles', v_id::text, 'CLONE', jsonb_build_object('from', r.code), null);
  return v_id;
end;
$$;

-- Replace the permission set of a role. Returns {added, removed}.
create or replace function public.role_set_permissions(p_role_id uuid, p_permissions text[])
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_new text[]; v_added text[]; v_removed text[]; v_unknown text;
begin
  r := app.role_for_write(p_role_id, 'roles.edit');
  if r.is_locked then
    raise exception 'The % role always has every permission', r.name using errcode = '42501';
  end if;
  v_new := array(select distinct unnest(coalesce(p_permissions, '{}')));
  select c into v_unknown from unnest(v_new) c where not exists (select 1 from public.permissions p where p.code = c) limit 1;
  if v_unknown is not null then
    raise exception 'Unknown permission %', v_unknown using errcode = 'P0001';
  end if;
  v_added := array(select c from unnest(v_new) c
                   except select permission_code from public.role_permissions where role_id = r.id);
  v_removed := array(select permission_code from public.role_permissions where role_id = r.id
                     except select c from unnest(v_new) c);
  perform app.assert_can_grant(r.company_id, v_added);
  -- a non-owner changing a role they hold could only add rights they have; also
  -- a role held by an owner is fine. Removing rights is always allowed.
  delete from public.role_permissions where role_id = r.id and permission_code = any (v_removed);
  insert into public.role_permissions (role_id, permission_code) select r.id, unnest(v_added) on conflict do nothing;
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    perform app.audit(r.company_id, 'roles', r.id::text, 'PERMISSIONS',
                      jsonb_build_object('removed', to_jsonb(v_removed)), jsonb_build_object('added', to_jsonb(v_added)));
  end if;
  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$$;

create or replace function public.role_delete(p_role_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_users int;
begin
  r := app.role_for_write(p_role_id, 'roles.delete');
  if r.is_locked then
    raise exception 'The % role is protected and cannot be deleted', r.name using errcode = '42501';
  end if;
  select count(*) into v_users from public.user_roles where role_id = r.id;
  if v_users > 0 then
    raise exception 'Role % is assigned to % user(s): remove it from them or disable the role instead', r.name, v_users
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_invitations where role_id = r.id and claimed_at is null and revoked_at is null) then
    raise exception 'Role % has open invitations', r.name using errcode = 'P0001';
  end if;
  perform app.audit(r.company_id, 'roles', r.id::text, 'DELETE', to_jsonb(r), null);
  delete from public.user_invitations where role_id = r.id;
  delete from public.roles where id = r.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Hard-coded OWNER / ADMIN checks replaced by permissions
-- -----------------------------------------------------------------------------
create or replace function public.create_company(p_payload jsonb, p_admin_user_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id    uuid;
  v_admin uuid := coalesce(p_admin_user_id, auth.uid());
begin
  if not app.is_trusted_caller() then
    if not exists (select 1 from public.user_roles ur
                   where ur.user_id = auth.uid() and app.has_permission(ur.company_id, 'company.create')) then
      raise exception 'Only an owner / administrator can create a company' using errcode = '42501';
    end if;
    v_admin := auth.uid();
  end if;
  if v_admin is null then
    raise exception 'An admin user is required' using errcode = 'P0001';
  end if;

  insert into public.companies (code, legal_name, trade_name, gstin, pan, address_line1, address_line2,
                                city, state, state_code, pincode, phone, email, website, fy_start_month)
  values (p_payload->>'code', p_payload->>'legal_name', p_payload->>'trade_name', p_payload->>'gstin',
          p_payload->>'pan', p_payload->>'address_line1', p_payload->>'address_line2', p_payload->>'city',
          p_payload->>'state', p_payload->>'state_code', p_payload->>'pincode', p_payload->>'phone',
          p_payload->>'email', p_payload->>'website', coalesce((p_payload->>'fy_start_month')::smallint, 4))
  returning id into v_id;

  perform app.init_company(v_id);

  insert into public.user_roles (user_id, company_id, role_id)
  select v_admin, v_id, id from public.roles where company_id = v_id and code in ('OWNER', 'ADMIN') and is_system;
  perform app.audit(v_id, 'companies', v_id::text, 'CREATE', null, p_payload);
  return v_id;
end;
$$;

create or replace function public.user_invite(p_company_id uuid, p_email text, p_role_code text,
                                              p_full_name text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_role uuid; v_id uuid; v_user uuid;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'users.create');
  select id into v_role from public.roles where company_id = p_company_id and upper(code) = upper(p_role_code);
  if v_role is null then
    raise exception 'Unknown role %', p_role_code using errcode = 'P0001';
  end if;
  if exists (select 1 from public.roles where id = v_role and grants_all) and not app.is_owner(auth.uid(), p_company_id) then
    raise exception 'Only an owner can invite another owner' using errcode = '42501';
  end if;
  perform app.assert_can_assign_role(p_company_id, null, v_role, false);
  update public.user_invitations set revoked_at = now()
   where company_id = p_company_id and lower(email) = lower(trim(p_email)) and claimed_at is null and revoked_at is null;
  insert into public.user_invitations (company_id, email, role_id, full_name, invited_by)
  values (p_company_id, lower(trim(p_email)), v_role, p_full_name, auth.uid()) returning id into v_id;
  -- already registered: grant now
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if v_user is not null then
    perform set_config('app.claiming_invitation', v_user::text, true);
    insert into public.user_roles (user_id, company_id, role_id) values (v_user, p_company_id, v_role) on conflict do nothing;
    perform set_config('app.claiming_invitation', '', true);
    update public.user_invitations set claimed_by = v_user, claimed_at = now() where id = v_id;
  end if;
  perform app.audit(p_company_id, 'user_invitations', v_id::text, 'INVITE', null,
                    jsonb_build_object('email', p_email, 'role', p_role_code));
  return v_id;
end;
$$;

-- Reminder recipients: only active members.
create or replace function app.role_emails(p_company_id uuid, p_roles text[])
returns text[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct lower(u.email)) filter (where u.email is not null), '{}')
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join auth.users u on u.id = ur.user_id
  where ur.company_id = p_company_id and upper(r.code) = any (select upper(x) from unnest(p_roles) x)
    and r.is_active and app.user_is_active(ur.user_id, p_company_id)
$$;

-- -----------------------------------------------------------------------------
-- RLS + grants for the new tables
-- -----------------------------------------------------------------------------
alter table public.permission_modules enable row level security;
alter table public.company_users enable row level security;
alter table public.user_permission_overrides enable row level security;

create policy permission_modules_read on public.permission_modules for select to authenticated using (true);
create policy company_users_read on public.company_users for select to authenticated
  using (user_id = auth.uid() or app.has_permission(company_id, 'users.view'));
create policy user_permission_overrides_read on public.user_permission_overrides for select to authenticated
  using (user_id = auth.uid() or app.has_permission(company_id, 'users.view'));

revoke all on public.permission_modules, public.company_users, public.user_permission_overrides from anon;
grant select on public.permission_modules, public.company_users, public.user_permission_overrides to authenticated;
revoke insert, update, delete, truncate on public.permission_modules, public.company_users,
                                           public.user_permission_overrides from authenticated;
grant all on public.permission_modules, public.company_users, public.user_permission_overrides to service_role;

revoke all on function public.role_save(uuid, uuid, jsonb), public.role_clone(uuid, text, text),
                       public.role_set_permissions(uuid, text[]), public.role_delete(uuid) from public, anon;
grant execute on function public.role_save(uuid, uuid, jsonb), public.role_clone(uuid, text, text),
                          public.role_set_permissions(uuid, text[]), public.role_delete(uuid) to authenticated, service_role;
grant execute on function app.user_is_active(uuid, uuid), app.is_owner(uuid, uuid),
                          app.user_has_permission(uuid, uuid, text), app.assert_can_grant(uuid, text[]),
                          app.assert_can_assign_role(uuid, uuid, uuid, boolean)
  to authenticated, service_role;
revoke all on function app.tg_user_roles_privilege_guard(), app.tg_roles_protect(),
                       app.tg_role_permissions_protect(), app.tg_user_roles_membership(),
                       app.tg_user_roles_audit() from public, anon;
