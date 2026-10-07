-- =============================================================================
-- INVENTORY MVP — customer & vendor portals, invitations (§9–17, §35, §40–41)
--
-- Portal users are NOT company members: they have no user_roles row, so every
-- RLS policy denies them direct table access. Everything they see or do goes
-- through the SECURITY DEFINER portal_* functions below, which resolve the
-- caller's own party from portal_users (never from the request) and apply the
-- visibility settings (override → company → system default).
--
-- Login: Supabase email OTP. After the first login the app calls
-- session_bootstrap(), which links pending invitations for the verified
-- email address to the user.
-- =============================================================================

create table public.portal_users (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id),
  party_id       uuid not null references public.parties (id),
  kind           public.portal_kind not null,
  email          text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name   text,
  user_id        uuid references auth.users (id) on delete set null,
  is_active      boolean not null default true,
  invited_by     uuid,
  invited_at     timestamptz not null default now(),
  claimed_at     timestamptz,
  last_login_at  timestamptz
);
create unique index portal_users_email_uq on public.portal_users (company_id, kind, lower(email));
create index portal_users_user_idx on public.portal_users (user_id) where user_id is not null;

-- Internal staff invitations (role assigned when the invited email logs in).
create table public.user_invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id     uuid not null references public.roles (id),
  full_name   text,
  invited_by  uuid,
  invited_at  timestamptz not null default now(),
  claimed_by  uuid,
  claimed_at  timestamptz,
  revoked_at  timestamptz
);
create unique index user_invitations_open_uq on public.user_invitations (company_id, lower(email))
  where claimed_at is null and revoked_at is null;

create or replace function app.auth_email()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select lower(email) from auth.users where id = auth.uid() $$;

-- -----------------------------------------------------------------------------
-- Session bootstrap: link invitations, return what the user can open.
-- -----------------------------------------------------------------------------
create or replace function public.session_bootstrap()
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_email text := app.auth_email(); i public.user_invitations;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into public.profiles (id, full_name) values (v_uid, coalesce(split_part(v_email, '@', 1), ''))
  on conflict (id) do nothing;

  if v_email is not null then
    for i in select * from public.user_invitations
             where lower(email) = v_email and claimed_at is null and revoked_at is null for update loop
      insert into public.user_roles (user_id, company_id, role_id) values (v_uid, i.company_id, i.role_id)
      on conflict do nothing;
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

  return jsonb_build_object(
    'user_id', v_uid, 'email', v_email,
    'full_name', (select full_name from public.profiles where id = v_uid),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(c.trade_name, c.legal_name),
                                                                'code', c.code, 'roles', x.roles) order by c.legal_name)
                           from (select ur.company_id, jsonb_agg(r.code order by r.code) as roles
                                 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                 where ur.user_id = v_uid group by ur.company_id) x
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

-- Internal: invite a staff member.
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
  if upper(p_role_code) = 'OWNER' and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                                  where ur.user_id = auth.uid() and ur.company_id = p_company_id and r.code = 'OWNER') then
    raise exception 'Only an owner can invite another owner' using errcode = '42501';
  end if;
  update public.user_invitations set revoked_at = now()
   where company_id = p_company_id and lower(email) = lower(trim(p_email)) and claimed_at is null and revoked_at is null;
  insert into public.user_invitations (company_id, email, role_id, full_name, invited_by)
  values (p_company_id, lower(trim(p_email)), v_role, p_full_name, auth.uid()) returning id into v_id;
  -- already registered: grant now
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is not null then
    insert into public.user_roles (user_id, company_id, role_id) values (v_user, p_company_id, v_role) on conflict do nothing;
    update public.user_invitations set claimed_by = v_user, claimed_at = now() where id = v_id;
  end if;
  perform app.audit(p_company_id, 'user_invitations', v_id::text, 'INVITE', null,
                    jsonb_build_object('email', p_email, 'role', p_role_code));
  return v_id;
end;
$$;

-- Internal: give a customer / vendor portal access (§9, §17).
create or replace function public.portal_invite(p_party_id uuid, p_kind public.portal_kind, p_email text,
                                                p_display_name text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare p public.parties; v_id uuid; v_user uuid;
begin
  select * into p from public.parties where id = p_party_id;
  if p.id is null or not app.is_member(p.company_id) then
    raise exception 'Party not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(p.company_id, 'portal.create');
  if p_kind = 'CUSTOMER' and not app.party_has_role(p.id, 'CUSTOMER') then
    raise exception '% is not set up as a customer', p.name using errcode = 'P0001';
  end if;
  if p_kind = 'VENDOR' and not (app.party_has_role(p.id, 'SUPPLIER') or app.party_has_role(p.id, 'JOB_WORKER')
                                or app.party_has_role(p.id, 'CUTTER')) then
    raise exception '% is not set up as a vendor', p.name using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_roles ur join auth.users u on u.id = ur.user_id
             where ur.company_id = p.company_id and lower(u.email) = lower(trim(p_email))) then
    raise exception 'This email belongs to an internal user of the company' using errcode = 'P0001';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  insert into public.portal_users (company_id, party_id, kind, email, display_name, user_id, invited_by, claimed_at)
  values (p.company_id, p.id, p_kind, lower(trim(p_email)), p_display_name, v_user, auth.uid(),
          case when v_user is not null then now() end)
  on conflict (company_id, kind, lower(email)) do update
    set party_id = excluded.party_id, display_name = excluded.display_name, is_active = true
  returning id into v_id;
  perform app.audit(p.company_id, 'portal_users', v_id::text, 'INVITE', null,
                    jsonb_build_object('party', p.name, 'kind', p_kind, 'email', p_email));
  return v_id;
end;
$$;

create or replace function public.portal_user_set_active(p_portal_user_id uuid, p_active boolean)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare u public.portal_users;
begin
  select * into u from public.portal_users where id = p_portal_user_id;
  if u.id is null or not app.is_member(u.company_id) then
    raise exception 'Portal user not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(u.company_id, 'portal.edit');
  update public.portal_users set is_active = p_active where id = u.id;
  perform app.audit(u.company_id, 'portal_users', u.id::text, case when p_active then 'ACTIVATE' else 'DEACTIVATE' end, null, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- Portal guard: the caller's own party for this company + kind.
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
    and pu.is_active and p.is_active and not p.is_deleted;
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

-- Stock as a portal may see it (§11–12). Only portal-visible godowns count.
--   EXACT_QUANTITY       available qty (physical − reserved)
--   AVAILABLE_STATUS     IN_STOCK / LOW_STOCK / OUT_OF_STOCK
--   AVAILABLE_TO_PROMISE available − open, not yet reserved sales-order demand
create or replace function app.portal_stock(p_company_id uuid, p_item_id uuid, p_visibility public.stock_visibility)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_phys numeric; v_res numeric; v_avail numeric; v_demand numeric; it public.items;
begin
  if p_visibility = 'HIDDEN' then
    return jsonb_build_object('visibility', 'HIDDEN');
  end if;
  select * into it from public.items where id = p_item_id;
  select coalesce(sum(b.base_qty), 0) into v_phys from public.stock_balances b join public.godowns g on g.id = b.godown_id
   where b.company_id = p_company_id and b.item_id = p_item_id and g.portal_visible and g.is_active;
  select coalesce(sum(r.reserved_qty), 0) into v_res from public.stock_reserved r join public.godowns g on g.id = r.godown_id
   where r.company_id = p_company_id and r.item_id = p_item_id and g.portal_visible and g.is_active;
  v_avail := greatest(v_phys - v_res, 0);
  if p_visibility = 'EXACT_QUANTITY' then
    return jsonb_build_object('visibility', 'EXACT_QUANTITY', 'qty', v_avail);
  elsif p_visibility = 'AVAILABLE_STATUS' then
    return jsonb_build_object('visibility', 'AVAILABLE_STATUS', 'status',
      case when v_avail <= 0 then 'OUT_OF_STOCK'
           when v_avail <= greatest(it.reorder_level, it.min_stock) then 'LOW_STOCK' else 'IN_STOCK' end);
  end if;
  select coalesce(sum(greatest(ol.ordered_base_qty - app.dispatched_qty(ol.id) - app.line_reserved(ol.id), 0)), 0)
    into v_demand
  from public.sales_order_lines ol join public.sales_orders o on o.id = ol.order_id
  where o.company_id = p_company_id and ol.item_id = p_item_id and o.status in ('OPEN', 'PARTIALLY_DISPATCHED');
  return jsonb_build_object('visibility', 'AVAILABLE_TO_PROMISE', 'qty', greatest(v_avail - v_demand, 0));
end;
$$;

-- What the portal user may see / do (for the UI; enforcement is server side).
create or replace function public.portal_context(p_company_id uuid, p_kind public.portal_kind)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, p_kind); ps record; s public.company_settings; p public.parties;
begin
  select * into ps from app.effective_party_settings(v_party, p_kind);
  select * into s from public.company_settings where company_id = p_company_id;
  select * into p from public.parties where id = v_party;
  return jsonb_build_object('company_id', p_company_id, 'company_name', app.company_name(p_company_id),
    'kind', p_kind, 'party_id', v_party, 'party_name', p.name,
    'stock_visibility', ps.stock_visibility, 'rate_visible', ps.rate_visible,
    'quote_price_enabled', p_kind = 'CUSTOMER' and ps.quote_price_enabled,
    'outstanding_visible', case when p_kind = 'CUSTOMER' then s.customer_outstanding_visible else s.vendor_payment_visible end,
    'addresses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code)
                           from public.party_addresses a where a.party_id = v_party and a.is_active and a.address_type = 'SHIP_TO'), '[]'));
end;
$$;

-- -----------------------------------------------------------------------------
-- CUSTOMER portal
-- -----------------------------------------------------------------------------
create or replace function public.portal_catalog(p_company_id uuid, p_search text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); ps record;
begin
  select * into ps from app.effective_party_settings(v_party, 'CUSTOMER');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_id', i.id, 'code', i.code, 'name', i.name, 'description', i.description,
             'category', c.name, 'brand', br.name,
             'unit', coalesce(su.code, bu.code), 'unit_id', coalesce(i.sales_unit_id, i.base_unit_id),
             'base_unit', bu.code,
             'pack_factor', app.unit_factor(i.id, coalesce(i.sales_unit_id, i.base_unit_id), current_date),
             'price', case when ps.rate_visible then app.customer_price(p_company_id, v_party, i.id) end,
             'stock', app.portal_stock(p_company_id, i.id, ps.stock_visibility)) order by i.name)
    from public.items i
    join public.units bu on bu.id = i.base_unit_id
    left join public.units su on su.id = i.sales_unit_id
    left join public.item_categories c on c.id = i.category_id
    left join public.brands br on br.id = i.brand_id
    where i.company_id = p_company_id and i.portal_visible and i.is_active and not i.is_deleted
      and i.item_kind in ('FINISHED_GOOD', 'RAW_MATERIAL', 'PACKING')
      and (p_search is null or i.name ilike '%' || p_search || '%' or i.code ilike '%' || p_search || '%'
           or i.barcode = p_search)), '[]');
end;
$$;

create or replace function public.portal_customer_po_create(p_company_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); ps record; v_id uuid;
begin
  select * into ps from app.effective_party_settings(v_party, 'CUSTOMER');
  -- party_id / company_id / prices in the payload are ignored: the party comes
  -- from the login, the reference price from the price list.
  v_id := app.customer_po_create(p_company_id, v_party, p_payload - 'party_id' - 'company_id', 'PORTAL',
                                 ps.quote_price_enabled);
  return jsonb_build_object('customer_po_id', v_id, 'status', 'SUBMITTED');
end;
$$;

create or replace function public.portal_customer_po_cancel(p_company_id uuid, p_customer_po_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); c public.customer_pos;
begin
  select * into c from public.customer_pos where id = p_customer_po_id and company_id = p_company_id
    and party_id = v_party for no key update;
  if c.id is null then
    raise exception 'PO not found' using errcode = 'P0001';
  end if;
  if c.status <> 'SUBMITTED' then
    raise exception 'The PO is % and can no longer be cancelled', c.status using errcode = 'P0001';
  end if;
  update public.customer_pos set status = 'CANCELLED', updated_at = now() where id = c.id;
  perform app.audit(c.company_id, 'customer_pos', c.id::text, 'CANCEL_BY_CUSTOMER', null, null);
end;
$$;

create or replace function public.portal_my_customer_pos(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); ps record;
begin
  select * into ps from app.effective_party_settings(v_party, 'CUSTOMER');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'po_no', c.po_no, 'po_date', c.po_date, 'requested_delivery_date', c.requested_delivery_date,
      'status', c.status, 'remarks', c.remarks, 'reject_reason', c.reject_reason,
      'sales_order_no', so.doc_no, 'order_status', so.status,
      'lines', (select jsonb_agg(jsonb_build_object(
                   'item_id', l.item_id, 'item_name', i.name, 'qty', l.qty, 'unit', u.code,
                   'quoted_rate', l.quoted_rate,
                   'reference_rate', case when ps.rate_visible then l.reference_rate end,
                   'approved_rate', l.approved_rate) order by l.line_no)
                from public.customer_po_lines l join public.items i on i.id = l.item_id
                join public.units u on u.id = l.unit_id where l.customer_po_id = c.id)) order by c.created_at desc)
    from public.customer_pos c left join public.sales_orders so on so.id = c.sales_order_id
    where c.company_id = p_company_id and c.party_id = v_party), '[]');
end;
$$;

create or replace function public.portal_my_orders(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_no', o.doc_no, 'customer_po_no', o.customer_po_no, 'order_date', o.doc_date,
      'delivery_date', o.delivery_date, 'status', o.status,
      'lines', (select jsonb_agg(jsonb_build_object(
                   'item_name', i.name, 'unit', bu.code, 'rate', ol.rate,
                   'ordered_qty', ol.ordered_base_qty, 'dispatched_qty', app.dispatched_qty(ol.id),
                   'pending_qty', ol.ordered_base_qty - app.dispatched_qty(ol.id)) order by ol.line_no)
                from public.sales_order_lines ol join public.items i on i.id = ol.item_id
                join public.units bu on bu.id = i.base_unit_id where ol.order_id = o.id),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object('doc_no', d.doc_no, 'date', d.doc_date,
                                  'vehicle_no', d.vehicle_no, 'delivered_date', d.delivered_date) order by d.doc_date)
                              from public.dispatches d where d.sales_order_id = o.id and d.status = 'POSTED'), '[]'))
      order by o.doc_date desc, o.doc_no desc)
    from public.sales_orders o
    where o.company_id = p_company_id and o.party_id = v_party and o.status not in ('DRAFT', 'PENDING_APPROVAL')), '[]');
end;
$$;

create or replace function public.portal_my_invoices(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); v_show boolean;
begin
  select customer_outstanding_visible into v_show from public.company_settings where company_id = p_company_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'bill_no', b.bill_no, 'bill_date', b.doc_date, 'due_date', b.due_date, 'amount', b.amount,
      'paid', case when v_show then app.bill_settled('customer_bills', b.id) end,
      'outstanding', case when v_show then b.amount - app.bill_settled('customer_bills', b.id) end,
      'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name,
                                 'storage_path', d.storage_path, 'category', d.category))
                             from public.documents d where d.entity_type = 'customer_bill' and d.entity_id = b.id
                               and d.visible_to_party and not d.is_deleted), '[]'))
      order by b.doc_date desc)
    from public.customer_bills b
    where b.company_id = p_company_id and b.party_id = v_party and b.status = 'POSTED'), '[]');
end;
$$;

-- Payment history for a portal party (customer receipts / vendor payments).
create or replace function app.portal_payments(p_company_id uuid, p_party_id uuid, p_type public.voucher_type)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'voucher_no', v.doc_no, 'date', v.doc_date, 'amount', v.amount, 'method', v.payment_method,
    'reference', v.instrument_ref,
    'allocations', coalesce((select jsonb_agg(jsonb_build_object('bill_no', b.doc_no, 'amount', a.amount,
                                 'tds', a.tds_amount))
                             from public.voucher_allocations a left join public.v_bills b
                               on b.bill_table = a.bill_table and b.bill_id = a.bill_id
                             where a.voucher_id = v.id), '[]')) order by v.doc_date desc), '[]')
  from public.vouchers v
  where v.company_id = p_company_id and v.party_id = p_party_id and v.voucher_type = p_type and v.status = 'POSTED'
$$;

create or replace function public.portal_my_payments(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER');
begin
  return app.portal_payments(p_company_id, v_party, 'RECEIPT');
end;
$$;

create or replace function public.portal_my_outstanding(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); v_show boolean;
begin
  select customer_outstanding_visible into v_show from public.company_settings where company_id = p_company_id;
  if not v_show then
    return jsonb_build_object('visible', false);
  end if;
  return (select jsonb_build_object('visible', true,
            'total_outstanding', coalesce(sum(o.outstanding_amount), 0),
            'overdue', coalesce(sum(o.outstanding_amount) filter (where o.due_date < current_date), 0),
            'bills', count(*) filter (where o.outstanding_amount > 0))
          from public.v_bill_outstanding o
          where o.company_id = p_company_id and o.party_id = v_party and o.bill_table = 'customer_bills');
end;
$$;

-- -----------------------------------------------------------------------------
-- VENDOR portal
-- -----------------------------------------------------------------------------
create or replace function public.portal_vendor_pos(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'VENDOR'); ps record;
begin
  select * into ps from app.effective_party_settings(v_party, 'VENDOR');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'po_no', o.doc_no, 'po_date', o.doc_date, 'expected_date', o.expected_date, 'status', o.status,
      'remarks', o.remarks,
      'lines', (select jsonb_agg(jsonb_build_object(
                   'item_id', ol.item_id, 'item_code', i.code, 'item_name', i.name, 'qty', ol.qty, 'unit', u.code,
                   'base_unit', bu.code,
                   'rate', case when ps.rate_visible then ol.rate end,
                   'ordered_qty', ol.ordered_base_qty, 'received_qty', app.purchase_received(ol.id),
                   'pending_qty', greatest(ol.ordered_base_qty - app.purchase_received(ol.id), 0),
                   'stock', app.portal_stock(p_company_id, ol.item_id, ps.stock_visibility)) order by ol.line_no)
                from public.purchase_order_lines ol join public.items i on i.id = ol.item_id
                join public.units u on u.id = ol.unit_id join public.units bu on bu.id = i.base_unit_id
                where ol.order_id = o.id),
      'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name,
                                 'storage_path', d.storage_path, 'category', d.category))
                             from public.documents d where d.entity_type = 'purchase_order' and d.entity_id = o.id
                               and d.visible_to_party and not d.is_deleted), '[]'))
      order by o.doc_date desc, o.doc_no desc)
    from public.purchase_orders o
    where o.company_id = p_company_id and o.party_id = v_party
      and o.status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED')), '[]');
end;
$$;

create or replace function public.portal_vendor_po_print(p_company_id uuid, p_po_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'VENDOR'); ps record; v jsonb;
begin
  if not exists (select 1 from public.purchase_orders where id = p_po_id and company_id = p_company_id
                 and party_id = v_party and status not in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED')) then
    raise exception 'PO not found' using errcode = 'P0001';
  end if;
  select * into ps from app.effective_party_settings(v_party, 'VENDOR');
  v := app.purchase_order_print_data(p_po_id);
  if not ps.rate_visible then
    v := jsonb_set(v - 'total', '{lines}', coalesce((select jsonb_agg(x - 'rate' - 'amount') from jsonb_array_elements(v->'lines') x), '[]'));
  end if;
  return v;
end;
$$;

create or replace function public.portal_vendor_payments(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'VENDOR'); v_show boolean;
begin
  select vendor_payment_visible into v_show from public.company_settings where company_id = p_company_id;
  if not v_show then
    return jsonb_build_object('visible', false);
  end if;
  return jsonb_build_object('visible', true,
    'payments', app.portal_payments(p_company_id, v_party, 'PAYMENT'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('bill_no', o.doc_no, 'bill_date', o.doc_date,
                                'due_date', o.due_date, 'amount', o.bill_amount, 'paid', o.settled_amount,
                                'outstanding', o.outstanding_amount,
                                'status', case when o.outstanding_amount <= 0 then 'PAID'
                                               when o.settled_amount > 0 then 'PARTIALLY_PAID' else 'UNPAID' end)
                                order by o.doc_date desc)
                       from public.v_bill_outstanding o
                       where o.company_id = p_company_id and o.party_id = v_party and o.side = 'PAYABLE'
                         and o.bill_table in ('purchase_receipts', 'service_bills', 'job_work_receipts')), '[]'),
    'total_outstanding', (select coalesce(sum(o.outstanding_amount), 0) from public.v_bill_outstanding o
                          where o.company_id = p_company_id and o.party_id = v_party and o.side = 'PAYABLE'
                            and o.bill_table in ('purchase_receipts', 'service_bills', 'job_work_receipts')));
end;
$$;

-- Documents visible to the portal party (both kinds).
create or replace function public.portal_documents(p_company_id uuid, p_kind public.portal_kind)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, p_kind);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'category', d.category,
                             'entity_type', d.entity_type, 'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
                             order by d.uploaded_at desc)
                   from public.documents d
                   where d.company_id = p_company_id and d.party_id = v_party and d.visible_to_party and not d.is_deleted), '[]');
end;
$$;

-- Customer attaches a file to his own PO (§10 Attachments). The file is
-- uploaded first to "<company_id>/portal/<party_id>/…" (storage policy below).
create or replace function public.portal_document_register(p_company_id uuid, p_customer_po_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER'); v_id uuid; v_path text := p_payload->>'storage_path';
begin
  if not exists (select 1 from public.customer_pos where id = p_customer_po_id and company_id = p_company_id
                 and party_id = v_party) then
    raise exception 'PO not found' using errcode = 'P0001';
  end if;
  if v_path is null or v_path not like p_company_id::text || '/portal/' || v_party::text || '/%' or v_path like '%..%' then
    raise exception 'File must be uploaded into your portal folder' using errcode = 'P0001';
  end if;
  insert into public.documents (company_id, category, entity_type, entity_id, party_id, storage_path, file_name,
                                mime_type, size_bytes, visible_to_party, uploaded_via, uploaded_by)
  values (p_company_id, 'OTHER', 'customer_po', p_customer_po_id, v_party, v_path,
          coalesce(nullif(trim(p_payload->>'file_name'), ''), 'attachment'), p_payload->>'mime_type',
          (p_payload->>'size_bytes')::bigint, true, 'PORTAL', auth.uid())
  returning id into v_id;
  perform app.audit(p_company_id, 'documents', v_id::text, 'UPLOAD_PORTAL', null, p_payload);
  return v_id;
end;
$$;

-- Storage access check (used by storage policies).
create or replace function app.storage_can_read(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select app.has_permission(app.try_uuid(split_part(p_name, '/', 1)), 'documents.view')
      or exists (select 1 from public.documents d
                 join public.portal_users pu on pu.party_id = d.party_id and pu.company_id = d.company_id
                 join public.company_settings s on s.company_id = d.company_id
                 where d.storage_path = p_name and d.visible_to_party and not d.is_deleted
                   and pu.user_id = auth.uid() and pu.is_active
                   and case pu.kind when 'CUSTOMER' then s.customer_portal_enabled else s.vendor_portal_enabled end)
$$;

create or replace function app.storage_can_write(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select app.has_permission(app.try_uuid(split_part(p_name, '/', 1)), 'documents.create')
      or (split_part(p_name, '/', 2) = 'portal' and exists (
            select 1 from public.portal_users pu
            join public.company_settings s on s.company_id = pu.company_id
            where pu.user_id = auth.uid() and pu.is_active and pu.kind = 'CUSTOMER' and s.customer_portal_enabled
              and pu.company_id = app.try_uuid(split_part(p_name, '/', 1))
              and pu.party_id = app.try_uuid(split_part(p_name, '/', 3))))
$$;

-- Supabase Storage bucket + policies (skipped on a plain PostgreSQL test DB).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 20971520)
    on conflict (id) do nothing;
    execute $p$create policy documents_read on storage.objects for select to authenticated
              using (bucket_id = 'documents' and app.storage_can_read(name))$p$;
    execute $p$create policy documents_insert on storage.objects for insert to authenticated
              with check (bucket_id = 'documents' and app.storage_can_write(name))$p$;
    execute $p$grant usage on schema app to authenticated$p$;
    execute $p$grant execute on function app.storage_can_read(text), app.storage_can_write(text), app.try_uuid(text) to authenticated$p$;
  end if;
end $$;
