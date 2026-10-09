-- =============================================================================
-- PLATFORM R3 (1/10) — permission catalogue completion and module enable /
-- disable.
--   * customers.* / vendors.* split from parties.* (party rows carry
--     is_customer / is_vendor flags; policies stay InitPlan, no per-row lookup)
--   * documents.download / documents.share, audit.export, settings sections,
--     financial field rights (D3), sales_order.override_rate_limit,
--     accounts.opening_balance
--   * catalogue clean-up: permissions with no meaning are hidden (is_active)
--   * company modules (D6): a disabled module removes its permissions in the
--     database (has_permission / RLS / RPCs / imports / exports / posting),
--     plus restrictive policies on its member-readable tables and the portal
--     guard. Core modules cannot be disabled.
-- Additive. Every existing role keeps exactly its current access (backfill).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catalogue metadata
-- -----------------------------------------------------------------------------
alter table public.permissions add column is_active boolean not null default true;
alter table public.permission_modules add column app_module text;

create table public.app_modules (
  code        text primary key,
  label       text not null,
  description text not null default '',
  is_core     boolean not null default false,
  sort_order  integer not null default 100
);
alter table public.app_modules enable row level security;
create policy app_modules_read on public.app_modules for select to authenticated using (true);
grant select on public.app_modules to authenticated;
grant all on public.app_modules to service_role;

insert into public.app_modules (code, label, description, is_core, sort_order) values
  ('ADMINISTRATION',  'Administration',      'Users, roles, settings, security, audit. Always on.',                                  true,  10),
  ('MASTERS',         'Masters',             'Items, godowns, rates, customers, vendors. Always on (all modules use them).',         true,  20),
  ('INVENTORY',       'Inventory',           'Stock transfers, adjustments, reservations, cost and valuation rights.',               false, 30),
  ('SALES',           'Sales',               'Customer POs, sales orders, dispatch, sales returns, customer invoices.',              false, 40),
  ('PURCHASE',        'Purchase',            'Purchase orders, receiving, purchase returns, service / vendor bills.',                false, 50),
  ('ACCOUNTS',        'Payments & accounts', 'Payments / receipts, chart of accounts, journals, financial reports.',                  false, 60),
  ('FACTORY',         'Factory & job work',  'Job-work orders / receipts / debit notes, material issues, production, worker pay.',   false, 70),
  ('DOCUMENTS',       'Documents & email',   'Document storage and the e-mail outbox.',                                              false, 80),
  ('IMPORT_EXPORT',   'Import / Export',     'Bulk import and export of all entities.',                                              false, 90),
  ('CUSTOMER_PORTAL', 'Customer portal',     'Customer logins and every customer-portal function.',                                  false, 100),
  ('VENDOR_PORTAL',   'Vendor portal',       'Vendor logins and every vendor-portal function.',                                      false, 110);

-- new permission modules
insert into public.permission_modules (module, label, group_label, sort_order, description) values
  ('customers',                'Customers',              'Masters',        300, 'Customer master (customer rows of the party master).'),
  ('vendors',                  'Vendors',                'Masters',        310, 'Vendor master (suppliers, job workers, cutters).'),
  ('costs',                    'Costs & valuation',      'Inventory',      190, 'Landed cost and stock valuation (field rights).'),
  ('sales',                    'Sales analytics',        'Sales',          395, 'Gross margin (field right).'),
  ('settings_company',         'Settings · Company',     'Settings',       910, 'Company profile, financial year.'),
  ('settings_branding',        'Settings · Branding',    'Settings',       911, 'Logo, favicon, colours, document footer, e-mail sender.'),
  ('settings_modules',         'Settings · Modules',     'Settings',       912, 'Enable / disable modules.'),
  ('settings_inventory',       'Settings · Inventory',   'Settings',       913, 'Negative stock and inventory rules.'),
  ('settings_sales',           'Settings · Sales',       'Settings',       914, 'Sales rate limits and sales rules.'),
  ('settings_purchase',        'Settings · Purchase',    'Settings',       915, 'Purchase rules.'),
  ('settings_payments',        'Settings · Payments',    'Settings',       916, 'Payment and rate-approval rules.'),
  ('settings_documents',       'Settings · Documents',   'Settings',       917, 'Document categories and limits.'),
  ('settings_portal',          'Settings · Portals',     'Settings',       918, 'Portal on / off and default visibility.'),
  ('settings_email',           'Settings · E-mail',      'Settings',       919, 'Automatic e-mails.'),
  ('settings_reminders',       'Settings · Reminders',   'Settings',       920, 'Payment reminders.'),
  ('settings_numbering',       'Settings · Numbering',   'Settings',       921, 'Document and master numbering.'),
  ('settings_approvals',       'Settings · Approvals',   'Settings',       922, 'Approval workflows.'),
  ('settings_security',        'Settings · Security',    'Settings',       923, 'Password policy and login overview.'),
  ('settings_custom_fields',   'Settings · Custom fields','Settings',      924, 'Custom fields of items, parties, users, godowns, documents.')
on conflict (module) do nothing;

update public.permission_modules set app_module = m.app_module
from (values
  ('stock_transfer', 'INVENTORY'), ('stock_adjustment', 'INVENTORY'), ('reservation', 'INVENTORY'), ('costs', 'INVENTORY'),
  ('customer_po', 'SALES'), ('sales_order', 'SALES'), ('dispatch', 'SALES'), ('sales_return', 'SALES'), ('customer_bill', 'SALES'),
  ('sales', 'SALES'),
  ('purchase_order', 'PURCHASE'), ('purchase_receipt', 'PURCHASE'), ('purchase_return', 'PURCHASE'), ('service_bill', 'PURCHASE'),
  ('voucher', 'ACCOUNTS'), ('accounts', 'ACCOUNTS'), ('reports', 'ACCOUNTS'),
  ('job_work_order', 'FACTORY'), ('job_work_receipt', 'FACTORY'), ('job_work_return', 'FACTORY'), ('material_issue', 'FACTORY'),
  ('production_lot', 'FACTORY'), ('production_receipt', 'FACTORY'), ('worker_earning', 'FACTORY'),
  ('documents', 'DOCUMENTS'), ('email', 'DOCUMENTS'),
  ('portal_customer', 'CUSTOMER_PORTAL'), ('portal_vendor', 'VENDOR_PORTAL')
) as m(module, app_module)
where permission_modules.module = m.module;

-- -----------------------------------------------------------------------------
-- New permissions
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, description, label, kind, sort_order, is_sensitive)
select x.module || '.' || lower(x.action), x.module, x.action::public.perm_action,
       initcap(x.module) || ' — ' || lower(x.action), null, 'ACTION', x.so, x.action in ('DELETE', 'IMPORT', 'EXPORT')
from (values ('customers', 'VIEW', 10), ('customers', 'CREATE', 20), ('customers', 'EDIT', 30), ('customers', 'DELETE', 40),
             ('customers', 'IMPORT', 75), ('customers', 'EXPORT', 70),
             ('vendors', 'VIEW', 10), ('vendors', 'CREATE', 20), ('vendors', 'EDIT', 30), ('vendors', 'DELETE', 40),
             ('vendors', 'IMPORT', 75), ('vendors', 'EXPORT', 70)) as x(module, action, so)
on conflict (code) do nothing;

insert into public.permissions (code, module, action, description, label, kind, sort_order, is_sensitive)
select 'settings_' || s || '.' || a, 'settings_' || s, upper(a)::public.perm_action,
       'Settings — ' || s || ' (' || a || ')', null, 'PAGE', case a when 'view' then 10 else 30 end, a = 'edit'
from unnest(array['company', 'branding', 'modules', 'inventory', 'sales', 'purchase', 'payments', 'documents', 'portal',
                  'email', 'reminders', 'numbering', 'approvals', 'security', 'custom_fields']) s,
     unnest(array['view', 'edit']) a
on conflict (code) do nothing;

insert into public.permissions (code, module, action, description, label, kind, sort_order, is_sensitive) values
  ('documents.download', 'documents', 'DOWNLOAD', 'Documents — download / open files', 'Download', 'ACTION', 110, false),
  ('documents.share',    'documents', 'SHARE',    'Documents — share with the customer / vendor and send by e-mail', 'Share', 'ACTION', 120, true),
  ('audit.export',       'audit',     'EXPORT',   'Audit log — export', 'Export', 'ACTION', 70, true),
  -- financial field rights (D3); the existing items.view_cost becomes "average cost"
  ('costs.view_landed_cost',     'costs',   'VIEW_FIELD', 'Landed cost: inward stock movement rate / value', 'See landed cost', 'FIELD', 200, true),
  ('costs.view_stock_valuation', 'costs',   'VIEW_FIELD', 'Stock valuation: stock value report, stock in P&L / balance sheet', 'See stock valuation', 'FIELD', 210, true),
  ('sales.view_margin',          'sales',   'VIEW_FIELD', 'Gross margin (sale rate − average cost)', 'See gross margin', 'FIELD', 200, true),
  ('reports.view_profit',        'reports', 'VIEW_FIELD', 'Profit & loss, balance sheet, trial balance, account ledgers, day book', 'See profit & accounting reports', 'FIELD', 200, true),
  ('accounts.view_amounts',      'accounts','VIEW_FIELD', 'Financial amounts: payments, receipts, allocations, outstanding, party balances', 'See financial amounts', 'FIELD', 200, true),
  ('accounts.opening_balance',   'accounts','MANAGE',     'Post / reverse customer and vendor opening balances', 'Opening balances', 'ACTION', 120, true),
  ('sales_order.override_rate_limit', 'sales_order', 'EDIT_FIELD', 'Save sales order lines outside the item minimum / maximum sale rate', 'Override rate limits', 'FIELD', 210, true)
on conflict (code) do nothing;

update public.permissions set label = 'See average cost',
       description = 'Average cost: outward / issue valuation, item average cost, stock movement cost'
where code = 'items.view_cost';
update public.permissions set label = 'See sale rates', description = 'Sale rates and sales amounts (item, party rates, sales documents, customer invoices)'
where code = 'items.view_sale_rate';
update public.permissions set label = 'See purchase rates', description = 'Purchase rates and purchase amounts (item, party rates, purchase / job-work documents, vendor bills)'
where code = 'items.view_purchase_rate';
update public.permissions set label = 'Customers & vendors (other parties / combined page)'
where code = 'parties.view' and label is null;

-- -----------------------------------------------------------------------------
-- Backfill: nobody gains or loses access by this migration
-- -----------------------------------------------------------------------------
-- permanent: drives this backfill AND the default grants of companies created
-- later (a new right follows the right(s) it was derived from)
create table app.permission_derivations (
  source_code text not null,
  target_code text not null,
  -- skip when the role holds this code: the admin already decided about the
  -- target in R2 (e.g. a role with items.view but without the purchase-rate
  -- right had that rate hidden on purpose; R3 applies it to documents too)
  unless_code text,
  primary key (source_code, target_code)
);
create temp view r3_map as select source_code as old_code, target_code as new_code, unless_code from app.permission_derivations;
insert into app.permission_derivations (source_code, target_code) values
  -- party master split (combined page holders get both halves)
  ('parties.view', 'customers.view'), ('parties.view', 'vendors.view'),
  ('parties.create', 'customers.create'), ('parties.create', 'vendors.create'),
  ('parties.edit', 'customers.edit'), ('parties.edit', 'vendors.edit'),
  ('parties.delete', 'customers.delete'), ('parties.delete', 'vendors.delete'),
  ('parties.import', 'customers.import'), ('parties.import', 'vendors.import'),
  ('parties.export', 'customers.export'), ('parties.export', 'vendors.export'),
  -- every member could read party names until R3: keep it for roles that show them on documents
  ('customer_po.view', 'customers.view'), ('sales_order.view', 'customers.view'), ('dispatch.view', 'customers.view'),
  ('sales_return.view', 'customers.view'), ('customer_bill.view', 'customers.view'), ('voucher.view', 'customers.view'),
  ('purchase_order.view', 'vendors.view'), ('purchase_receipt.view', 'vendors.view'), ('purchase_return.view', 'vendors.view'),
  ('service_bill.view', 'vendors.view'), ('job_work_order.view', 'vendors.view'), ('job_work_receipt.view', 'vendors.view'),
  ('job_work_return.view', 'vendors.view'), ('material_issue.view', 'vendors.view'), ('voucher.view', 'vendors.view'),
  ('items.view', 'customers.view'), ('items.view', 'vendors.view'), ('godowns.view', 'customers.view'), ('godowns.view', 'vendors.view'),
  ('documents.view', 'customers.view'), ('documents.view', 'vendors.view'),
  -- documents
  ('documents.view', 'documents.download'), ('documents.edit', 'documents.share'), ('documents.create', 'documents.share'),
  ('audit.view', 'audit.export'),
  -- financial rights: whoever sees a value today keeps seeing it
  ('items.view_cost', 'costs.view_landed_cost'), ('items.view_cost', 'costs.view_stock_valuation'),
  ('material_issue.view', 'items.view_sale_rate'), ('stock_adjustment.view', 'items.view_cost'),
  ('stock_adjustment.view', 'costs.view_landed_cost'), ('worker_earning.view', 'items.view_purchase_rate'),
  ('sales_order.view', 'items.view_sale_rate'), ('customer_po.view', 'items.view_sale_rate'), ('sales_return.view', 'items.view_sale_rate'),
  ('customer_bill.view', 'items.view_sale_rate'), ('dispatch.view', 'items.view_sale_rate'),
  ('purchase_order.view', 'items.view_purchase_rate'), ('purchase_receipt.view', 'items.view_purchase_rate'),
  ('purchase_return.view', 'items.view_purchase_rate'), ('service_bill.view', 'items.view_purchase_rate'),
  ('job_work_order.view', 'items.view_purchase_rate'), ('job_work_receipt.view', 'items.view_purchase_rate'),
  ('job_work_return.view', 'items.view_purchase_rate'),
  ('voucher.view', 'accounts.view_amounts'), ('customer_bill.view', 'accounts.view_amounts'), ('accounts.view', 'accounts.view_amounts'),
  ('purchase_receipt.view', 'accounts.view_amounts'), ('service_bill.view', 'accounts.view_amounts'),
  -- journals / financial reports were readable by every member: keep it for roles with any accounting or payment right
  ('voucher.view', 'reports.view_profit'), ('accounts.view', 'reports.view_profit'), ('customer_bill.view', 'reports.view_profit'),
  ('voucher.view', 'items.view_sale_rate'), ('voucher.view', 'items.view_purchase_rate'),
  ('accounts.view', 'items.view_sale_rate'), ('accounts.view', 'items.view_purchase_rate'),
  ('accounts.view', 'costs.view_stock_valuation'), ('voucher.view', 'costs.view_stock_valuation'),
  ('accounts.create', 'accounts.opening_balance'),
  ('sales_order.approve', 'sales_order.override_rate_limit');
-- document / accounting views -> rate and cost rights only where R2 made no decision
update app.permission_derivations set unless_code = 'items.view'
where target_code in ('items.view_sale_rate', 'items.view_purchase_rate', 'items.view_cost',
                      'costs.view_landed_cost', 'costs.view_stock_valuation')
  and source_code not in ('items.view', 'items.view_cost');
-- settings sections from the umbrella rights
insert into app.permission_derivations (source_code, target_code) select 'settings.view', code from public.permissions where module like 'settings\_%' and action = 'VIEW';
insert into app.permission_derivations (source_code, target_code) select 'settings.edit', code from public.permissions where module like 'settings\_%' and action = 'EDIT';
-- margin: roles that see both the sale rate and the cost (a new display, no previous behaviour)
-- transitive: a derived right can itself be the source of another one
do $$
begin
  for i in 1..5 loop
    insert into public.role_permissions (role_id, permission_code)
    select distinct rp.role_id, m.new_code
    from public.role_permissions rp join r3_map m on m.old_code = rp.permission_code
    join public.roles r on r.id = rp.role_id and r.kind = 'INTERNAL'
    where m.unless_code is null
       or not exists (select 1 from public.role_permissions x where x.role_id = rp.role_id and x.permission_code = m.unless_code)
    on conflict do nothing;
  end loop;
end $$;
insert into public.role_permissions (role_id, permission_code)
select a.role_id, 'sales.view_margin' from public.role_permissions a
join public.role_permissions b on b.role_id = a.role_id and b.permission_code = 'items.view_cost'
join public.roles r on r.id = a.role_id and r.kind = 'INTERNAL'
where a.permission_code = 'items.view_sale_rate'
on conflict do nothing;
-- user overrides follow the same mapping (ALLOW and DENY)
insert into public.user_permission_overrides (company_id, user_id, permission_code, effect, reason, created_by)
select distinct o.company_id, o.user_id, m.new_code, o.effect, coalesce(o.reason, 'R3 catalogue split'), o.created_by
from public.user_permission_overrides o join r3_map m on m.old_code = o.permission_code
where m.old_code like 'parties.%' or m.old_code like 'settings.%' or m.old_code in ('documents.view', 'documents.edit', 'audit.view')
on conflict do nothing;
drop view r3_map;

-- -----------------------------------------------------------------------------
-- Catalogue clean-up: permissions that no policy, function or screen checks
-- and that have no meaning for their module. Kept (role data intact), hidden.
-- -----------------------------------------------------------------------------
update public.permissions set is_active = false where code in (
  'audit.create', 'audit.edit', 'audit.delete', 'audit.approve', 'audit.cancel',
  'reports.create', 'reports.edit', 'reports.delete', 'reports.approve', 'reports.cancel',
  'settings.create', 'settings.delete', 'settings.approve', 'settings.cancel', 'settings.export',
  'settings.view', 'settings.edit',                     -- replaced by the section rights
  'accounts.approve', 'accounts.cancel', 'documents.approve', 'documents.cancel',
  'email.approve', 'email.cancel', 'godowns.approve', 'godowns.cancel', 'items.approve', 'items.cancel',
  'parties.approve', 'parties.cancel', 'portal.approve', 'portal.cancel', 'portal.delete', 'portal.export',
  'rates.cancel', 'users.approve', 'users.cancel', 'reservation.approve');

-- -----------------------------------------------------------------------------
-- Default grants of new companies (seed_default_roles): new codes follow the
-- code they were split from, so a new company gets the same behaviour.
-- -----------------------------------------------------------------------------
create or replace function app.default_role_grants_r3(p_role text, p_code text, p_module text, p_action public.perm_action)
returns boolean
language sql stable
set search_path = public, app, pg_temp
as $$
  select case
    when p_role = 'OWNER' then true
    when p_code = 'sales.view_margin' then
      app.default_role_grants_r3(p_role, 'items.view_sale_rate', 'items', 'VIEW_FIELD')
      and app.default_role_grants_r3(p_role, 'items.view_cost', 'items', 'VIEW_FIELD')
    when exists (select 1 from app.permission_derivations d where d.target_code = p_code) then
      (exists (select 1 from public.permissions p where p.code = p_code and p.code in ('items.view_sale_rate', 'items.view_purchase_rate', 'items.view_cost'))
       and app.default_role_grants(p_role, p_code, p_module, p_action))
      or exists (select 1 from app.permission_derivations d join public.permissions s on s.code = d.source_code
                 left join public.permissions u on u.code = d.unless_code
                 where d.target_code = p_code and app.default_role_grants_r3(p_role, s.code, s.module, s.action)
                   and (u.code is null or not app.default_role_grants_r3(p_role, u.code, u.module, u.action)))
    else app.default_role_grants(p_role, p_code, p_module, p_action)
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
  where p.is_active
    and app.default_role_grants_r3(ins.code, p.code, p.module, p.action)
    and (ins.code = 'OWNER' or (p.kind = 'PORTAL') = (ins.kind <> 'INTERNAL'))
  on conflict do nothing;
end;
$$;

-- hidden permissions cannot be granted any more (existing grants stay, harmless)
create or replace function app.tg_role_permission_active()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.permissions where code = new.permission_code and is_active) then
    raise exception 'Permission % is not available', new.permission_code using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger role_permissions_active before insert on public.role_permissions
  for each row execute function app.tg_role_permission_active();
create trigger user_permission_overrides_active before insert on public.user_permission_overrides
  for each row execute function app.tg_role_permission_active();

-- -----------------------------------------------------------------------------
-- Company modules (D6)
-- -----------------------------------------------------------------------------
create table public.company_modules (
  company_id  uuid not null references public.companies (id) on delete cascade,
  module_code text not null references public.app_modules (code),
  is_enabled  boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (company_id, module_code)
);
alter table public.company_modules enable row level security;
create policy company_modules_read on public.company_modules for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
grant select on public.company_modules to authenticated;
grant all on public.company_modules to service_role;

-- disabled modules of a company (none rows = all enabled)
create or replace function app.module_enabled(p_company_id uuid, p_module text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select p_module is null or not exists (select 1 from public.company_modules
                                         where company_id = p_company_id and module_code = p_module and not is_enabled)
$$;

-- a permission is usable only while its module (and, for import / export, the
-- Import / Export module) is enabled
create or replace function app.permission_module_enabled(p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select not exists (
    select 1 from public.permissions p
    left join public.permission_modules m on m.module = p.module
    join public.company_modules cm on cm.company_id = p_company_id and not cm.is_enabled
     and (cm.module_code = m.app_module
          or (cm.module_code = 'IMPORT_EXPORT' and p.action in ('IMPORT', 'EXPORT')))
    where p.code = p_permission)
$$;

create or replace function app.user_has_permission_nc(p_user uuid, p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select p_user is not null
     and exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.company_id = p_company_id)
     and app.user_is_active(p_user, p_company_id)
     and app.permission_module_enabled(p_company_id, p_permission)
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

create or replace function app.user_permissions(p_user uuid, p_company_id uuid)
returns setof text
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select p.code from public.permissions p
  where exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.company_id = p_company_id)
    and app.user_is_active(p_user, p_company_id)
    and app.permission_module_enabled(p_company_id, p.code)
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

-- companies of the caller where a module is enabled (InitPlan in policies)
create or replace function app.module_company_ids(p_module text)
returns uuid[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(c), '{}') from unnest(app.user_company_ids()) c where app.module_enabled(c, p_module)
$$;

-- member-readable tables of non-core modules
create table app.module_tables (
  table_name  text primary key,
  module_code text not null references public.app_modules (code)
);
insert into app.module_tables values
  ('journal_entries', 'ACCOUNTS'), ('journal_entry_lines', 'ACCOUNTS'), ('voucher_books', 'ACCOUNTS'),
  ('stock_reservations', 'INVENTORY'), ('stock_reservation_movements', 'INVENTORY');

do $$
declare t record;
begin
  for t in select * from app.module_tables loop
    execute format('create policy %1$I on public.%2$I as restrictive for select to authenticated
                    using (company_id = any ((select app.module_company_ids(%3$L))::uuid[]))',
                   t.table_name || '_module', t.table_name, t.module_code);
  end loop;
end $$;

-- the authorization cache must not survive a module change
create trigger company_modules_authz_cache after insert or update or delete on public.company_modules
  for each statement execute function app.tg_authz_cache_clear();

-- portal guard: the portal module of the company must be enabled
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
  if not app.module_enabled(p_company_id, case p_kind when 'CUSTOMER' then 'CUSTOMER_PORTAL' else 'VENDOR_PORTAL' end) then
    raise exception 'The % portal module is not enabled', lower(p_kind::text) using errcode = '42501';
  end if;
  select * into s from public.company_settings where company_id = p_company_id;
  if (p_kind = 'CUSTOMER' and not s.customer_portal_enabled) or (p_kind = 'VENDOR' and not s.vendor_portal_enabled) then
    raise exception 'The % portal is currently turned off', lower(p_kind::text) using errcode = '42501';
  end if;
  return v_party;
end;
$$;

-- portal feature list is empty while the portal module is off (storage, UI)
create or replace function app.portal_features(p_company_id uuid, p_kind public.portal_kind)
returns text[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case when not app.module_enabled(p_company_id, case p_kind when 'CUSTOMER' then 'CUSTOMER_PORTAL' else 'VENDOR_PORTAL' end)
              then '{}'::text[]
         else (select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code), '{}')
               from public.portal_users pu
               join public.roles r on r.id = pu.role_id and r.is_active
               join public.role_permissions rp on rp.role_id = r.id
               where pu.user_id = auth.uid() and pu.company_id = p_company_id and pu.kind = p_kind and pu.is_active) end
$$;

-- e-mails are part of the Documents module
create or replace function app.email_enabled(p_company_id uuid, p_kind text, p_party_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare s public.company_settings; v_party boolean := true;
begin
  if not app.module_enabled(p_company_id, 'DOCUMENTS') then
    return false;
  end if;
  select * into s from public.company_settings where company_id = p_company_id;
  if s.company_id is null or not s.email_automation then
    return false;
  end if;
  if p_party_id is not null and p_kind not in ('VENDOR_PAYMENT_REMINDER') then
    select coalesce(email_enabled, true) into v_party from public.party_settings where party_id = p_party_id;
    v_party := coalesce(v_party, true);
  end if;
  return v_party and case p_kind
    when 'VENDOR_PO' then s.vendor_po_email
    when 'VENDOR_DOCUMENT' then s.vendor_document_email
    when 'CUSTOMER_INVOICE' then s.customer_invoice_email
    when 'CUSTOMER_DOCUMENT' then s.customer_document_email
    when 'CUSTOMER_PAYMENT_REMINDER' then s.payment_reminder_email
    when 'VENDOR_PAYMENT_REMINDER' then s.vendor_payment_reminder_email
    else false end;
end;
$$;

-- enable / disable a module (core modules refused; OWNER always keeps the
-- Modules section because it is part of the always-on Administration module)
create or replace function public.module_set(p_company_id uuid, p_module text, p_enabled boolean)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare m public.app_modules; v_old boolean;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_modules.edit');
  select * into m from public.app_modules where code = p_module;
  if m.code is null then
    raise exception 'Unknown module %', p_module using errcode = 'P0001';
  end if;
  if m.is_core then
    raise exception 'The % module is always on', m.label using errcode = 'P0001';
  end if;
  select is_enabled into v_old from public.company_modules where company_id = p_company_id and module_code = p_module;
  insert into public.company_modules (company_id, module_code, is_enabled, updated_at, updated_by)
  values (p_company_id, p_module, p_enabled, now(), auth.uid())
  on conflict (company_id, module_code) do update set is_enabled = excluded.is_enabled, updated_at = now(), updated_by = auth.uid();
  if v_old is distinct from p_enabled then
    perform app.audit(p_company_id, 'company_modules', p_module, case when p_enabled then 'ENABLE' else 'DISABLE' end,
                      jsonb_build_object('is_enabled', coalesce(v_old, true)), jsonb_build_object('is_enabled', p_enabled));
  end if;
end;
$$;

create or replace function public.company_modules_list(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case when app.is_member(p_company_id) then
    coalesce((select jsonb_agg(jsonb_build_object('code', m.code, 'label', m.label, 'description', m.description,
                                                  'is_core', m.is_core, 'is_enabled', app.module_enabled(p_company_id, m.code))
                               order by m.sort_order) from public.app_modules m), '[]') end
$$;

-- -----------------------------------------------------------------------------
-- Customers / vendors split of the party master (D7: existing scopes intact)
-- -----------------------------------------------------------------------------
alter table public.parties
  add column is_customer boolean not null default false,
  add column is_vendor   boolean not null default false;
update public.parties p set
  is_customer = exists (select 1 from public.party_roles r where r.party_id = p.id and r.role = 'CUSTOMER'),
  is_vendor   = exists (select 1 from public.party_roles r where r.party_id = p.id and r.role in ('SUPPLIER', 'JOB_WORKER', 'CUTTER'));

create or replace function app.tg_party_role_flags()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := coalesce(new.party_id, old.party_id);
begin
  update public.parties p set
    is_customer = exists (select 1 from public.party_roles r where r.party_id = p.id and r.role = 'CUSTOMER'),
    is_vendor   = exists (select 1 from public.party_roles r where r.party_id = p.id and r.role in ('SUPPLIER', 'JOB_WORKER', 'CUTTER'))
  where p.id = v_party;
  return null;
end;
$$;
create trigger party_roles_flags after insert or update or delete on public.party_roles
  for each row execute function app.tg_party_role_flags();

-- read: customer rows need customers.view, vendor rows vendors.view (either
-- when both); other parties stay member-readable as before
create policy parties_kind_read on public.parties as restrictive for select to authenticated
  using ((not is_customer and not is_vendor)
         or (is_customer and company_id = any ((select app.permitted_company_ids('customers.view'))::uuid[]))
         or (is_vendor and company_id = any ((select app.permitted_company_ids('vendors.view'))::uuid[])));

-- writes: the right of the kind(s) of the row
create or replace function app.party_right(p_company_id uuid, p_is_customer boolean, p_is_vendor boolean, p_action text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select (not p_is_customer or app.has_permission(p_company_id, 'customers.' || p_action))
     and (not p_is_vendor or app.has_permission(p_company_id, 'vendors.' || p_action))
     and ((p_is_customer or p_is_vendor) or app.has_permission(p_company_id, 'parties.' || p_action))
$$;

drop policy parties_insert on public.parties;
drop policy parties_update on public.parties;
drop policy parties_delete on public.parties;
-- new rows have no role yet: creating needs the create right of any kind; party_save checks the exact kind
create policy parties_insert on public.parties for insert to authenticated
  with check (app.has_permission(company_id, 'parties.create') or app.has_permission(company_id, 'customers.create')
              or app.has_permission(company_id, 'vendors.create'));
create policy parties_update on public.parties for update to authenticated
  using (app.party_right(company_id, is_customer, is_vendor, 'edit'))
  with check (app.party_right(company_id, is_customer, is_vendor, 'edit'));
create policy parties_delete on public.parties for delete to authenticated
  using (app.party_right(company_id, is_customer, is_vendor, 'delete'));

drop policy party_addresses_write on public.party_addresses;
create policy party_addresses_write on public.party_addresses for all to authenticated
  using (exists (select 1 from public.parties p where p.id = party_addresses.party_id
                 and app.party_right(p.company_id, p.is_customer, p.is_vendor, 'edit')))
  with check (exists (select 1 from public.parties p where p.id = party_addresses.party_id
                      and app.party_right(p.company_id, p.is_customer, p.is_vendor, 'edit')));
drop policy party_roles_write on public.party_roles;
create policy party_roles_write on public.party_roles for all to authenticated
  using (exists (select 1 from public.parties p where p.id = party_roles.party_id
                 and (app.has_permission(p.company_id, 'parties.edit')
                      or app.has_permission(p.company_id, case when party_roles.role = 'CUSTOMER' then 'customers.edit' else 'vendors.edit' end))))
  with check (exists (select 1 from public.parties p where p.id = party_roles.party_id
                      and (app.has_permission(p.company_id, 'parties.edit')
                           or app.has_permission(p.company_id, case when party_roles.role = 'CUSTOMER' then 'customers.edit' else 'vendors.edit' end))));

update app.import_entities set import_permission = 'customers.import', export_permission = 'customers.export' where code = 'CUSTOMERS';
update app.import_entities set import_permission = 'vendors.import', export_permission = 'vendors.export' where code = 'VENDORS';

-- -----------------------------------------------------------------------------
-- documents.download (storage read) / documents.share (party visibility, e-mail)
-- -----------------------------------------------------------------------------
create or replace function app.storage_can_read(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select (app.has_permission(app.try_uuid(split_part(p_name, '/', 1)), 'documents.view')
          and app.has_permission(app.try_uuid(split_part(p_name, '/', 1)), 'documents.download')
          and not exists (select 1 from public.documents d where d.storage_path = p_name
                          and not app.party_allowed(d.company_id, d.party_id)))
      or exists (select 1 from public.documents d
                 join public.portal_users pu on pu.party_id = d.party_id and pu.company_id = d.company_id
                 join public.company_settings s on s.company_id = d.company_id
                 where d.storage_path = p_name and d.visible_to_party and not d.is_deleted
                   and pu.user_id = auth.uid() and pu.is_active
                   and case pu.kind when 'CUSTOMER' then s.customer_portal_enabled else s.vendor_portal_enabled end
                   and (case pu.kind when 'CUSTOMER' then 'portal_customer.view_documents' else 'portal_vendor.view_documents' end)
                       = any (app.portal_features(pu.company_id, pu.kind)))
$$;

create or replace function public.document_set_visibility(p_document_id uuid, p_visible boolean)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_document_id for no key update;
  if d.id is null or not app.is_member(d.company_id) or not app.party_allowed(d.company_id, d.party_id) then
    raise exception 'Document not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(d.company_id, 'documents.edit');
  if p_visible then
    perform app.require_permission(d.company_id, 'documents.share');
  end if;
  update public.documents set visible_to_party = p_visible where id = d.id;
  perform app.audit(d.company_id, 'documents', d.id::text, 'VISIBILITY', jsonb_build_object('visible_to_party', d.visible_to_party),
                    jsonb_build_object('visible_to_party', p_visible));
end;
$$;

-- sharing at upload (visible to the party / e-mail) needs documents.share
create or replace function app.tg_documents_share_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.visible_to_party and (tg_op = 'INSERT' or not old.visible_to_party)
     and auth.uid() is not null and not app.is_trusted_caller()
     and not exists (select 1 from public.portal_users pu where pu.user_id = auth.uid() and pu.company_id = new.company_id
                     and pu.party_id = new.party_id)
     and not app.has_permission(new.company_id, 'documents.share') then
    raise exception 'Permission denied: documents.share is required to share a document' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger documents_share_guard before insert or update of visible_to_party on public.documents
  for each row execute function app.tg_documents_share_guard();

revoke all on function public.module_set(uuid, text, boolean), public.company_modules_list(uuid) from public, anon;
grant execute on function public.module_set(uuid, text, boolean), public.company_modules_list(uuid) to authenticated, service_role;
grant execute on function app.module_enabled(uuid, text), app.module_company_ids(text), app.permission_module_enabled(uuid, text),
                          app.party_right(uuid, boolean, boolean, text) to authenticated, service_role;
revoke all on function app.tg_party_role_flags(), app.tg_role_permission_active(), app.tg_documents_share_guard() from public, anon, authenticated;
