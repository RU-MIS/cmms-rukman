-- =============================================================================
-- INVENTORY MVP — security & company setup for everything added in
-- 20261007000001…0006 (0080 / 0090 ran before these objects existed).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissions for the new modules (also in supabase/seed/system).
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, description)
select m.module || '.' || lower(a::text), m.module, a, m.label || ' — ' || lower(a::text)
from (values
  ('customer_po',  'Customer POs (review / approve)'),
  ('reservation',  'Stock reservations'),
  ('documents',    'Documents'),
  ('email',        'Email log & sending'),
  ('portal',       'Customer / vendor portal access')
) as m(module, label)
cross join unnest(enum_range(null::public.perm_action)) a
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Roles (§33 Owner/Admin control center; Accounts / Purchase users §24)
-- -----------------------------------------------------------------------------
insert into app.default_roles values
  ('OWNER',      'Owner'),
  ('ACCOUNTANT', 'Accounts'),
  ('PURCHASE',   'Purchase'),
  ('SALES',      'Sales')
on conflict (code) do nothing;

-- Which permissions a system role gets.
--   OWNER, ADMIN  everything (only they change settings, users, portal access)
--   APPROVER      everything except DELETE and administration
--   OPERATOR      VIEW / CREATE / EDIT / EXPORT, no administration
--   VIEWER        VIEW / EXPORT
--   ACCOUNTANT    view all; full work (no delete) on bills, vouchers, documents, email
--   PURCHASE      view all; full work on purchase docs, documents, items, vendors
--   SALES         view all; full work on customer POs, sales orders, dispatch, reservations
create or replace function app.role_grants(p_role text, p_module text, p_action public.perm_action)
returns boolean
language sql immutable
as $$
  select case
    when p_role in ('OWNER', 'ADMIN') then true
    when p_module in ('settings', 'users', 'portal', 'audit') then
      p_action = 'VIEW' and p_role in ('APPROVER', 'ACCOUNTANT')
    when p_role = 'APPROVER' then p_action <> 'DELETE'
    when p_role = 'OPERATOR' then p_action in ('VIEW', 'CREATE', 'EDIT', 'EXPORT')
    when p_role = 'VIEWER' then p_action in ('VIEW', 'EXPORT')
    when p_role = 'ACCOUNTANT' then p_action in ('VIEW', 'EXPORT')
      or (p_module in ('customer_bill', 'voucher', 'documents', 'email', 'accounts', 'reports', 'service_bill')
          and p_action <> 'DELETE')
      or (p_module = 'parties' and p_action in ('CREATE', 'EDIT'))
    when p_role = 'PURCHASE' then p_action in ('VIEW', 'EXPORT')
      or (p_module in ('purchase_order', 'purchase_receipt', 'purchase_return', 'documents', 'email')
          and p_action <> 'DELETE')
      or (p_module in ('items', 'parties', 'godowns', 'rates', 'stock_transfer') and p_action in ('CREATE', 'EDIT'))
    when p_role = 'SALES' then p_action in ('VIEW', 'EXPORT')
      or (p_module in ('customer_po', 'sales_order', 'dispatch', 'reservation', 'sales_return', 'documents', 'email')
          and p_action <> 'DELETE')
      or (p_module in ('parties', 'rates') and p_action in ('CREATE', 'EDIT'))
    else false end
$$;

create or replace function app.sync_system_role_permissions(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.roles (company_id, code, name, is_system)
  select p_company_id, code, name, true from app.default_roles
  on conflict do nothing;
  delete from public.role_permissions rp using public.roles r, public.permissions p
   where rp.role_id = r.id and p.code = rp.permission_code and r.company_id = p_company_id and r.is_system
     and not app.role_grants(r.code, p.module, p.action);
  insert into public.role_permissions (role_id, permission_code)
  select r.id, p.code from public.roles r cross join public.permissions p
  where r.company_id = p_company_id and r.is_system and app.role_grants(r.code, p.module, p.action)
  on conflict do nothing;
end;
$$;

insert into app.default_sequences values
  ('CUSTOMER_PO', 'CPO-', '{PREFIX}{FY}/{NUMBER}', 4, 'FY')
on conflict (doc_type) do nothing;

create or replace function app.init_company(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare a app.default_accounts;
begin
  insert into public.document_sequences (company_id, doc_type, prefix, pattern, padding, reset_policy)
  select p_company_id, doc_type, prefix, pattern, padding, reset_policy from app.default_sequences
  on conflict do nothing;

  insert into public.approval_policies (company_id, doc_type, requires_approval)
  select p_company_id, doc_type, requires_approval from app.default_approvals
  on conflict do nothing;

  for a in select * from app.default_accounts order by sort_order loop
    insert into public.accounts (company_id, code, name, parent_id, is_group, account_type, sub_type,
                                 system_key, is_system)
    values (p_company_id, a.code, a.name,
            (select id from public.accounts where company_id = p_company_id and code = a.parent_code),
            a.is_group, a.account_type, a.sub_type, a.system_key, a.system_key is not null)
    on conflict do nothing;
  end loop;

  insert into public.voucher_books (company_id, code, name)
  values (p_company_id, 'MAIN', 'Main book')
  on conflict do nothing;

  insert into public.company_settings (company_id) values (p_company_id) on conflict do nothing;
  perform app.sync_system_role_permissions(p_company_id);
end;
$$;

-- The creator of a company becomes OWNER (and ADMIN for compatibility).
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
    if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                   where ur.user_id = auth.uid() and r.code in ('OWNER', 'ADMIN')) then
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
  select v_admin, v_id, id from public.roles where company_id = v_id and code in ('OWNER', 'ADMIN');
  perform app.audit(v_id, 'companies', v_id::text, 'CREATE', null, p_payload);
  return v_id;
end;
$$;

-- Existing companies: settings row, new roles, corrected permissions.
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform app.init_company(c.id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Company-consistency triggers for new tables with cross references
-- -----------------------------------------------------------------------------
create trigger customer_pos_company_refs before insert or update on public.customer_pos
  for each row execute function app.tg_company_refs('party_id:parties');
create trigger documents_company_refs before insert or update on public.documents
  for each row execute function app.tg_company_refs('party_id:parties');
create trigger portal_users_company_refs before insert or update on public.portal_users
  for each row execute function app.tg_company_refs('party_id:parties');
create trigger stock_reservations_company_refs before insert or update on public.stock_reservations
  for each row execute function app.tg_company_refs('godown_id:godowns', 'item_id:items', 'sales_order_id:sales_orders');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stock_reservations', 'stock_reservation_movements', 'customer_pos', 'customer_po_lines',
                           'documents', 'email_outbox', 'email_events', 'payment_reminders', 'portal_users',
                           'user_invitations'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Visibility / email / reminder overrides are an Owner/Admin control (§33).
drop policy party_settings_write on public.party_settings;
create policy party_settings_write on public.party_settings for all to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'portal.edit')))
  with check (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'portal.edit')));

create policy stock_reservations_read on public.stock_reservations for select to authenticated
  using (app.is_member(company_id));
create policy stock_reservation_movements_read on public.stock_reservation_movements for select to authenticated
  using (app.is_member(company_id));
create policy customer_pos_read on public.customer_pos for select to authenticated
  using (app.has_permission(company_id, 'customer_po.view'));
create policy customer_po_lines_read on public.customer_po_lines for select to authenticated
  using (exists (select 1 from public.customer_pos c where c.id = customer_po_id
                 and app.has_permission(c.company_id, 'customer_po.view')));
create policy documents_read on public.documents for select to authenticated
  using (app.has_permission(company_id, 'documents.view'));
create policy email_outbox_read on public.email_outbox for select to authenticated
  using (app.has_permission(company_id, 'email.view'));
create policy email_events_read on public.email_events for select to authenticated
  using (exists (select 1 from public.email_outbox e where e.id = outbox_id and app.has_permission(e.company_id, 'email.view')));
create policy payment_reminders_read on public.payment_reminders for select to authenticated
  using (app.has_permission(company_id, 'voucher.view'));
create policy portal_users_read on public.portal_users for select to authenticated
  using (app.has_permission(company_id, 'portal.view'));
create policy user_invitations_read on public.user_invitations for select to authenticated
  using (app.has_permission(company_id, 'users.view'));

-- -----------------------------------------------------------------------------
-- Grants: read through RLS, all writes only through the RPCs above.
-- -----------------------------------------------------------------------------
revoke all on public.stock_reservations, public.stock_reservation_movements, public.customer_pos,
              public.customer_po_lines, public.documents, public.email_outbox, public.email_events,
              public.payment_reminders, public.portal_users, public.user_invitations from anon;
grant select on public.stock_reservations, public.stock_reservation_movements, public.customer_pos,
                public.customer_po_lines, public.documents, public.email_outbox, public.email_events,
                public.payment_reminders, public.portal_users, public.user_invitations to authenticated;
revoke insert, update, delete, truncate on public.stock_reservations, public.stock_reservation_movements,
              public.customer_pos, public.customer_po_lines, public.documents, public.email_outbox,
              public.email_events, public.payment_reminders, public.portal_users, public.user_invitations
  from authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- views (security_invoker: the RLS of the underlying tables applies)
revoke all on public.v_stock_balance, public.v_stock_by_location, public.v_inventory_items,
              public.v_sales_order_lines, public.v_stock_reservations, public.v_customer_po_lines,
              public.v_stock_movement_history, public.v_purchase_order_lines, public.v_purchase_pending_lines,
              public.v_bills, public.v_bill_outstanding, public.v_payment_allocations, public.v_email_log,
              public.v_payment_reminders from anon;
grant select on public.v_stock_balance, public.v_stock_by_location, public.v_inventory_items,
                public.v_sales_order_lines, public.v_stock_reservations, public.v_customer_po_lines,
                public.v_stock_movement_history, public.v_purchase_order_lines, public.v_purchase_pending_lines,
                public.v_bills, public.v_bill_outstanding, public.v_payment_allocations, public.v_email_log,
                public.v_payment_reminders to authenticated;

-- Functions: nothing for anon / PUBLIC (new functions get EXECUTE for PUBLIC
-- by default in PostgreSQL), RPCs for authenticated users.
revoke all on all functions in schema public from anon, public;
revoke all on all functions in schema app from public;
grant execute on all functions in schema public to authenticated, service_role;

-- Worker-only RPCs: also check app.is_trusted_caller() inside.
revoke execute on function public.email_claim(integer), public.email_complete(uuid, boolean, text, text)
  from authenticated;

-- app functions used by security-invoker views / RLS policies
grant execute on function app.reserved_qty(uuid, uuid, uuid), app.line_reserved(uuid), app.dispatched_qty(uuid),
                          app.purchase_received(uuid), app.bill_settled(text, uuid, uuid), app.default_packing(uuid, date),
                          app.is_member(uuid), app.has_permission(uuid, text), app.user_company_ids(),
                          app.current_user_id(), app.try_uuid(text), app.storage_can_read(text), app.storage_can_write(text)
  to authenticated, service_role;
