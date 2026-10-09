-- =============================================================================
-- PLATFORM R2 — permission catalogue for master data, field visibility,
-- import / export and portal features; new data-scope dimensions; portal
-- roles. Additive; existing roles keep today's behaviour (backfill below).
-- =============================================================================

insert into public.permission_modules (module, label, group_label, sort_order) values
  ('portal_customer', 'Customer portal features', 'Portal roles', 860),
  ('portal_vendor',   'Vendor portal features',   'Portal roles', 870)
on conflict (module) do nothing;

insert into public.permissions (code, module, action, description, label, kind, sort_order, is_sensitive) values
  -- field visibility (columns are masked / rows hidden by the database)
  ('items.view_sale_rate',     'items', 'VIEW_FIELD', 'Items — see sales rates (item sale price, customer rates)',       'See sales rate',    'FIELD', 200, true),
  ('items.view_purchase_rate', 'items', 'VIEW_FIELD', 'Items — see purchase rates (item purchase price, vendor rates)', 'See purchase rate', 'FIELD', 210, true),
  ('items.view_cost',          'items', 'VIEW_FIELD', 'Items — see cost: stock movement rates and stock value',          'See cost / value',  'FIELD', 220, true),
  ('items.edit_rate',          'items', 'EDIT_FIELD', 'Items — change sale / purchase prices and party rates',           'Edit rates',        'FIELD', 230, true),
  ('items.upload_image',       'items', 'UPLOAD',     'Items — upload / replace / delete item images',                   'Upload images',     'ACTION', 120, false),
  -- bulk import (export already exists per module)
  ('items.import',            'items',            'IMPORT', 'Items — bulk import (items, item rates)',          'Import', 'ACTION', 75, true),
  ('parties.import',          'parties',          'IMPORT', 'Customers & vendors — bulk import (incl. rates)',  'Import', 'ACTION', 75, true),
  ('godowns.import',          'godowns',          'IMPORT', 'Godowns & locations — bulk import',                'Import', 'ACTION', 75, true),
  ('rates.import',            'rates',            'IMPORT', 'Rate lists — bulk import',                         'Import', 'ACTION', 75, true),
  ('stock_adjustment.import', 'stock_adjustment', 'IMPORT', 'Opening stock — bulk import',                      'Import', 'ACTION', 75, true),
  ('users.import',            'users',            'IMPORT', 'Users — bulk import (invitations, no passwords)',  'Import', 'ACTION', 75, true),
  ('users.export',            'users',            'EXPORT', 'Users — export',                                   'Export', 'ACTION', 70, true),
  -- customer portal features (portal roles)
  ('portal_customer.catalog',          'portal_customer', 'VIEW',     'Customer portal — item catalog',            'Catalog',          'PORTAL', 10, false),
  ('portal_customer.view_stock',       'portal_customer', 'VIEW',     'Customer portal — stock (as configured)',   'Stock',            'PORTAL', 20, false),
  ('portal_customer.view_rates',       'portal_customer', 'VIEW',     'Customer portal — own rates (as configured)','Rates',           'PORTAL', 30, false),
  ('portal_customer.create_po',        'portal_customer', 'CREATE',   'Customer portal — create / cancel POs',     'Create PO',        'PORTAL', 40, false),
  ('portal_customer.view_pos',         'portal_customer', 'VIEW',     'Customer portal — own POs',                 'My POs',           'PORTAL', 50, false),
  ('portal_customer.view_orders',      'portal_customer', 'VIEW',     'Customer portal — orders & dispatch',       'Orders',           'PORTAL', 60, false),
  ('portal_customer.view_invoices',    'portal_customer', 'VIEW',     'Customer portal — invoices',                'Invoices',         'PORTAL', 70, false),
  ('portal_customer.view_payments',    'portal_customer', 'VIEW',     'Customer portal — payments',                'Payments',         'PORTAL', 80, false),
  ('portal_customer.view_outstanding', 'portal_customer', 'VIEW',     'Customer portal — outstanding (as configured)', 'Outstanding',  'PORTAL', 90, false),
  ('portal_customer.view_documents',   'portal_customer', 'VIEW',     'Customer portal — shared documents',        'Documents',        'PORTAL', 100, false),
  ('portal_customer.upload_documents', 'portal_customer', 'UPLOAD',   'Customer portal — upload PO documents',     'Upload documents', 'PORTAL', 110, false),
  -- vendor portal features
  ('portal_vendor.view_pos',           'portal_vendor', 'VIEW', 'Vendor portal — purchase orders / supply status', 'Purchase orders', 'PORTAL', 10, false),
  ('portal_vendor.view_payments',      'portal_vendor', 'VIEW', 'Vendor portal — payments (as configured)',        'Payments',        'PORTAL', 20, false),
  ('portal_vendor.view_documents',     'portal_vendor', 'VIEW', 'Vendor portal — shared documents',                'Documents',       'PORTAL', 30, false)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Backfill: today every member who sees items sees their prices and every
-- role that creates master data could enter it — keep exactly that.
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_code)
select rp.role_id, n.new_code
from public.role_permissions rp
join (values
  ('items.view',            'items.view_sale_rate'),
  ('items.view',            'items.view_purchase_rate'),
  ('items.view',            'items.view_cost'),
  ('items.edit',            'items.edit_rate'),
  ('items.edit',            'items.upload_image'),
  ('items.create',          'items.import'),
  ('parties.create',        'parties.import'),
  ('godowns.create',        'godowns.import'),
  ('rates.create',          'rates.import'),
  ('stock_adjustment.create', 'stock_adjustment.import'),
  ('users.create',          'users.import'),
  ('users.view',            'users.export')
) as n(old_code, new_code) on n.old_code = rp.permission_code
join public.roles r on r.id = rp.role_id and r.kind = 'INTERNAL'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.grants_all
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Default roles (new companies): field rights per role, portal roles.
-- -----------------------------------------------------------------------------
alter table app.default_roles add column kind text not null default 'INTERNAL';
insert into app.default_roles (code, name, description, sort_order, is_locked, kind) values
  ('CUSTOMER_ADMIN', 'Customer admin', 'Customer portal: every feature (visibility still follows the customer settings).', 110, false, 'CUSTOMER_PORTAL'),
  ('CUSTOMER_USER',  'Customer user',  'Customer portal: catalog, POs, orders, documents.',                              120, false, 'CUSTOMER_PORTAL'),
  ('VENDOR_ADMIN',   'Vendor admin',   'Vendor portal: every feature.',                                                  130, false, 'VENDOR_PORTAL'),
  ('VENDOR_USER',    'Vendor user',    'Vendor portal: purchase orders and documents.',                                  140, false, 'VENDOR_PORTAL')
on conflict (code) do nothing;

create or replace function app.default_role_grants(p_role text, p_code text, p_module text, p_action public.perm_action)
returns boolean
language sql immutable
as $$
  select case
    when p_role = 'OWNER' then true
    -- portal roles: only portal features
    when p_role = 'CUSTOMER_ADMIN' then p_module = 'portal_customer'
    when p_role = 'CUSTOMER_USER' then p_code in ('portal_customer.catalog', 'portal_customer.view_stock', 'portal_customer.view_rates',
                                                  'portal_customer.create_po', 'portal_customer.view_pos', 'portal_customer.view_orders',
                                                  'portal_customer.view_documents', 'portal_customer.upload_documents')
    when p_role = 'VENDOR_ADMIN' then p_module = 'portal_vendor'
    when p_role = 'VENDOR_USER' then p_code in ('portal_vendor.view_pos', 'portal_vendor.view_documents')
    when p_module in ('portal_customer', 'portal_vendor') then false
    -- field visibility
    when p_code in ('items.view_sale_rate', 'items.view_purchase_rate', 'items.view_cost') then
      p_role in ('ADMIN', 'MANAGER', 'APPROVER', 'ACCOUNTANT')
      or (p_role = 'SALES' and p_code = 'items.view_sale_rate')
      or (p_role = 'PURCHASE' and p_code = 'items.view_purchase_rate')
      or (p_role = 'OPERATOR' and p_code in ('items.view_sale_rate', 'items.view_purchase_rate'))
    when p_code = 'items.edit_rate' then p_role in ('ADMIN', 'MANAGER', 'APPROVER', 'OPERATOR', 'PURCHASE')
    when p_code = 'items.upload_image' then p_role in ('ADMIN', 'MANAGER', 'APPROVER', 'OPERATOR', 'PURCHASE', 'INVENTORY')
    when p_action = 'IMPORT' then p_role in ('ADMIN', 'MANAGER')
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
    when p_module in ('roles', 'company')
         or (p_module = 'users' and p_action not in ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'CANCEL', 'EXPORT')) then false
    when p_action in ('VIEW_FIELD', 'EDIT_FIELD', 'UPLOAD') then false
    else app.role_grants(p_role, p_module, p_action)
  end
$$;

create or replace function app.seed_default_roles(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  with ins as (
    insert into public.roles (company_id, code, name, is_system, description, sort_order, is_locked, grants_all, kind)
    select p_company_id, d.code, d.name, true, d.description, d.sort_order, d.is_locked, d.is_locked, d.kind
    from app.default_roles d
    on conflict do nothing
    returning id, code, kind)
  insert into public.role_permissions (role_id, permission_code)
  select ins.id, p.code from ins cross join public.permissions p
  where app.default_role_grants(ins.code, p.code, p.module, p.action)
    and (ins.code = 'OWNER' or (p.kind = 'PORTAL') = (ins.kind <> 'INTERNAL'))
  on conflict do nothing;
end;
$$;

-- existing companies receive the portal roles (and nothing else changes)
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform app.seed_default_roles(c.id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Role permissions must match the role type; portal roles are configured
-- with portal.edit (no escalation question: staff never hold portal rights).
-- -----------------------------------------------------------------------------
create or replace function public.role_set_permissions(p_role_id uuid, p_permissions text[])
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_new text[]; v_added text[]; v_removed text[]; v_bad text;
begin
  r := app.role_for_write(p_role_id, 'roles.edit');
  if r.is_locked then
    raise exception 'The % role always has every permission', r.name using errcode = '42501';
  end if;
  v_new := array(select distinct unnest(coalesce(p_permissions, '{}')));
  select c into v_bad from unnest(v_new) c
  where not exists (select 1 from public.permissions p where p.code = c
                    and case r.kind when 'INTERNAL' then p.kind <> 'PORTAL'
                                    when 'CUSTOMER_PORTAL' then p.module = 'portal_customer'
                                    else p.module = 'portal_vendor' end) limit 1;
  if v_bad is not null then
    raise exception 'Permission % does not exist or does not fit a % role', v_bad, lower(replace(r.kind, '_', ' '))
      using errcode = 'P0001';
  end if;
  v_added := array(select c from unnest(v_new) c
                   except select permission_code from public.role_permissions where role_id = r.id);
  v_removed := array(select permission_code from public.role_permissions where role_id = r.id
                     except select c from unnest(v_new) c);
  if r.kind = 'INTERNAL' then
    perform app.assert_can_grant(r.company_id, v_added);
  else
    perform app.require_permission(r.company_id, 'portal.edit');
  end if;
  delete from public.role_permissions where role_id = r.id and permission_code = any (v_removed);
  insert into public.role_permissions (role_id, permission_code) select r.id, unnest(v_added) on conflict do nothing;
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    perform app.audit(r.company_id, 'roles', r.id::text, 'PERMISSIONS',
                      jsonb_build_object('removed', to_jsonb(v_removed)), jsonb_build_object('added', to_jsonb(v_added)));
  end if;
  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$$;

-- role_save / role_clone: a new role may be a portal role (payload.kind).
create or replace function public.role_save(p_company_id uuid, p_role_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_id uuid; v_code text := upper(trim(coalesce(p_payload->>'code', '')));
        v_kind text := coalesce(p_payload->>'kind', 'INTERNAL');
begin
  if p_role_id is null then
    if not app.is_member(p_company_id) then
      raise exception 'Unknown company' using errcode = 'P0001';
    end if;
    perform app.require_permission(p_company_id, 'roles.create');
    if v_kind not in ('INTERNAL', 'CUSTOMER_PORTAL', 'VENDOR_PORTAL') then
      raise exception 'Unknown role type %', v_kind using errcode = 'P0001';
    end if;
    if v_kind <> 'INTERNAL' then
      perform app.require_permission(p_company_id, 'portal.edit');
    end if;
    if v_code !~ '^[A-Z0-9_\-]{2,40}$' then
      raise exception 'Role code must be 2–40 letters, digits, - or _' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.roles where company_id = p_company_id and upper(code) = v_code) then
      raise exception 'A role with code % already exists', v_code using errcode = 'P0001';
    end if;
    insert into public.roles (company_id, code, name, description, is_active, sort_order, kind)
    values (p_company_id, v_code, coalesce(nullif(trim(p_payload->>'name'), ''), v_code),
            coalesce(p_payload->>'description', ''), coalesce((p_payload->>'is_active')::boolean, true),
            coalesce((p_payload->>'sort_order')::int, 100), v_kind)
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

create or replace function public.role_clone(p_role_id uuid, p_code text, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles; v_id uuid;
begin
  r := app.role_for_write(p_role_id, 'roles.create');
  if r.kind = 'INTERNAL' then
    perform app.assert_can_grant(r.company_id, coalesce((select array_agg(permission_code) from public.role_permissions
                                                         where role_id = r.id), '{}'));
  end if;
  v_id := public.role_save(r.company_id, null, jsonb_build_object('code', p_code, 'name', p_name, 'kind', r.kind,
                                                                  'description', r.description, 'sort_order', r.sort_order));
  update public.roles set copied_from = r.id where id = v_id;
  insert into public.role_permissions (role_id, permission_code)
  select v_id, permission_code from public.role_permissions rp
  where role_id = r.id and (r.kind <> 'INTERNAL' or not exists (
    select 1 from public.permissions p where p.code = rp.permission_code and p.kind = 'PORTAL'));
  insert into public.role_data_scopes (role_id, dimension, entity_id, created_by)
  select v_id, dimension, entity_id, auth.uid() from public.role_data_scopes where role_id = r.id;
  perform app.audit(r.company_id, 'roles', v_id::text, 'CLONE', jsonb_build_object('from', r.code), null);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- New data-scope dimensions (enforcement: 20261009000003)
-- -----------------------------------------------------------------------------
insert into public.data_scope_dimensions (code, label, entity_table, description, sort_order) values
  ('CUSTOMER', 'Customers', 'parties', 'Customer master, customer POs, sales orders, dispatches, returns, invoices, receipts of the assigned customers (ASSIGNED_CUSTOMERS).', 20),
  ('VENDOR',   'Vendors',   'parties', 'Vendor master, purchase orders, receipts, returns, bills, job work, payments of the assigned vendors (ASSIGNED_VENDORS).', 30),
  ('ITEM',     'Items',     'items',   'Item master, rates, images, stock and document lines of the assigned items (ASSIGNED_ITEMS).', 40)
on conflict (code) do nothing;

-- A scope entry with this id means "no record of this dimension".
create or replace function app.scope_none() returns uuid language sql immutable as
  $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;
grant execute on function app.scope_none() to authenticated, service_role;

create or replace function app.assert_scope_entities(p_company_id uuid, p_dimension text, p_ids uuid[])
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_bad int;
begin
  if not exists (select 1 from public.data_scope_dimensions where code = p_dimension) then
    raise exception 'Unknown data scope %', p_dimension using errcode = 'P0001';
  end if;
  if app.scope_none() = any (p_ids) and cardinality(p_ids) > 1 then
    raise exception '"No access" cannot be combined with selected records' using errcode = 'P0001';
  end if;
  select count(*) into v_bad from unnest(p_ids) x
  where x <> app.scope_none() and not case p_dimension
    when 'GODOWN' then exists (select 1 from public.godowns e where e.id = x and e.company_id = p_company_id)
    when 'ITEM' then exists (select 1 from public.items e where e.id = x and e.company_id = p_company_id)
    when 'CUSTOMER' then exists (select 1 from public.parties e where e.id = x and e.company_id = p_company_id
                                 and app.party_has_role(e.id, 'CUSTOMER'))
    when 'VENDOR' then exists (select 1 from public.parties e where e.id = x and e.company_id = p_company_id
                               and (app.party_has_role(e.id, 'SUPPLIER') or app.party_has_role(e.id, 'JOB_WORKER')
                                    or app.party_has_role(e.id, 'CUTTER')))
    else false end;
  if v_bad > 0 then
    raise exception 'Data scope contains records of another company, of the wrong type or unknown records' using errcode = 'P0001';
  end if;
end;
$$;
