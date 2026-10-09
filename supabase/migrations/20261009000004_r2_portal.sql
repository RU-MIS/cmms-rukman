-- =============================================================================
-- PLATFORM R2 — configurable customer / vendor portal rights.
--
-- What a portal login can do = its portal role (CUSTOMER_ADMIN, CUSTOMER_USER,
-- VENDOR_ADMIN, VENDOR_USER or any role the admin builds in the matrix)
--   ∧ the portal switch of the company
--   ∧ the visibility of its customer / vendor (stock, rates, outstanding,
--     payments: company default, overridable per party).
-- Every portal RPC checks its feature in the database.
-- Existing portal logins get the *_ADMIN role = exactly today's rights.
-- =============================================================================

alter table public.portal_users add column role_id uuid references public.roles (id);

create or replace function app.tg_portal_users_role()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.roles;
begin
  if new.role_id is null then
    select id into new.role_id from public.roles
     where company_id = new.company_id and code = case new.kind when 'CUSTOMER' then 'CUSTOMER_ADMIN' else 'VENDOR_ADMIN' end
       and kind = case new.kind when 'CUSTOMER' then 'CUSTOMER_PORTAL' else 'VENDOR_PORTAL' end;
  end if;
  select * into r from public.roles where id = new.role_id;
  if r.id is null or r.company_id <> new.company_id
     or r.kind <> (case new.kind when 'CUSTOMER' then 'CUSTOMER_PORTAL' else 'VENDOR_PORTAL' end) then
    raise exception 'Portal role does not fit this % login', lower(new.kind::text) using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger portal_users_role before insert or update of role_id, kind on public.portal_users
  for each row execute function app.tg_portal_users_role();
update public.portal_users set role_id = null where role_id is null;   -- fires the default

create or replace function app.portal_features(p_company_id uuid, p_kind public.portal_kind)
returns text[]
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code), '{}')
  from public.portal_users pu
  join public.roles r on r.id = pu.role_id and r.is_active
  join public.role_permissions rp on rp.role_id = r.id
  where pu.user_id = auth.uid() and pu.company_id = p_company_id and pu.kind = p_kind and pu.is_active
$$;

-- Portal guard with a feature: the caller's party, if the feature is granted.
create or replace function app.portal_party(p_company_id uuid, p_kind public.portal_kind, p_feature text)
returns uuid
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_party uuid := app.portal_party(p_company_id, p_kind);
begin
  if not p_feature = any (app.portal_features(p_company_id, p_kind)) then
    raise exception 'This portal feature is not enabled for your login' using errcode = '42501';
  end if;
  return v_party;
end;
$$;

-- Outstanding (customer) / payments (vendor) visibility: party override,
-- else company setting.
create or replace function app.portal_outstanding_visible(p_party_id uuid, p_kind public.portal_kind)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case when p_kind = 'CUSTOMER' then coalesce(o.outstanding_visible, s.customer_outstanding_visible)
              else coalesce(o.payment_visible, s.vendor_payment_visible) end
  from public.parties p
  join public.company_settings s on s.company_id = p.company_id
  left join public.party_settings o on o.party_id = p.id
  where p.id = p_party_id
$$;

-- Stock / rate visibility of a customer, narrowed by the role of the
-- portal login that asks (the worker and staff see the party setting).
create or replace function app.effective_party_settings(p_party_id uuid, p_kind public.portal_kind,
  out stock_visibility public.stock_visibility, out rate_visible boolean, out quote_price_enabled boolean,
  out email_enabled boolean, out payment_reminder_enabled boolean)
returns record
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare p public.parties; o public.party_settings; s public.company_settings; v_feat text[];
begin
  select * into p from public.parties where id = p_party_id;
  s := app.settings(p.company_id);
  select * into o from public.party_settings where party_id = p_party_id;
  if p_kind = 'CUSTOMER' then
    stock_visibility := coalesce(o.stock_visibility, s.customer_stock_visibility);
    rate_visible := coalesce(o.rate_visible, s.customer_rate_visible);
    quote_price_enabled := coalesce(o.quote_price_enabled, s.customer_quote_price_enabled);
    payment_reminder_enabled := coalesce(o.payment_reminder_enabled, s.customer_reminder_enabled);
    if exists (select 1 from public.portal_users where user_id = auth.uid() and party_id = p_party_id and kind = 'CUSTOMER') then
      v_feat := app.portal_features(p.company_id, 'CUSTOMER');
      if not 'portal_customer.view_stock' = any (v_feat) then stock_visibility := 'HIDDEN'; end if;
      if not 'portal_customer.view_rates' = any (v_feat) then rate_visible := false; quote_price_enabled := false; end if;
    end if;
  else
    stock_visibility := coalesce(o.stock_visibility, s.vendor_stock_visibility);
    rate_visible := coalesce(o.rate_visible, s.vendor_rate_visible);
    quote_price_enabled := false;
    payment_reminder_enabled := coalesce(o.payment_reminder_enabled, s.vendor_reminder_enabled);
  end if;
  email_enabled := coalesce(o.email_enabled, true);
end;
$$;

-- Portal role of a login (Users center / customer & vendor screens).
create or replace function public.portal_user_set_role(p_portal_user_id uuid, p_role_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare u public.portal_users;
begin
  select * into u from public.portal_users where id = p_portal_user_id;
  if u.id is null or not app.is_member(u.company_id) or not app.party_allowed(u.company_id, u.party_id) then
    raise exception 'Portal user not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(u.company_id, 'portal.edit');
  update public.portal_users set role_id = p_role_id where id = u.id;
  perform app.audit(u.company_id, 'portal_users', u.id::text, 'ROLE',
                    jsonb_build_object('role_id', u.role_id), jsonb_build_object('role_id', p_role_id));
end;
$$;

-- Storage: portal reads need the documents feature, uploads the upload feature.
create or replace function app.storage_can_read(p_name text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select (app.has_permission(app.try_uuid(split_part(p_name, '/', 1)), 'documents.view')
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
              and pu.party_id = app.try_uuid(split_part(p_name, '/', 3))
              and 'portal_customer.upload_documents' = any (app.portal_features(pu.company_id, 'CUSTOMER'))))
$$;

-- -----------------------------------------------------------------------------
-- Portal RPCs: unchanged bodies, the guard now names the feature
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_catalog(p_company_id uuid, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.catalog'); ps record;
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_customer_po_cancel(p_company_id uuid, p_customer_po_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.create_po'); c public.customer_pos;
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_customer_po_create(p_company_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.create_po'); ps record; v_id uuid;
begin
  select * into ps from app.effective_party_settings(v_party, 'CUSTOMER');
  -- party_id / company_id / prices in the payload are ignored: the party comes
  -- from the login, the reference price from the price list.
  v_id := app.customer_po_create(p_company_id, v_party, p_payload - 'party_id' - 'company_id', 'PORTAL',
                                 ps.quote_price_enabled);
  return jsonb_build_object('customer_po_id', v_id, 'status', 'SUBMITTED');
end;
$function$;

CREATE OR REPLACE FUNCTION public.portal_document_register(p_company_id uuid, p_customer_po_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.upload_documents'); v_id uuid; v_path text := p_payload->>'storage_path';
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_my_customer_pos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.view_pos'); ps record;
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_my_invoices(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.view_invoices'); v_show boolean;
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_my_orders(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.view_orders');
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_my_outstanding(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.view_outstanding'); v_show boolean;
begin
  v_show := app.portal_outstanding_visible(v_party, 'CUSTOMER');
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_my_payments(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'CUSTOMER', 'portal_customer.view_payments');
begin
  return app.portal_payments(p_company_id, v_party, 'RECEIPT');
end;
$function$;

CREATE OR REPLACE FUNCTION public.portal_vendor_payments(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'VENDOR', 'portal_vendor.view_payments'); v_show boolean;
begin
  v_show := app.portal_outstanding_visible(v_party, 'VENDOR');
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_vendor_po_print(p_company_id uuid, p_po_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'VENDOR', 'portal_vendor.view_pos'); ps record; v jsonb;
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_vendor_pos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, 'VENDOR', 'portal_vendor.view_pos'); ps record;
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_documents(p_company_id uuid, p_kind portal_kind)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, p_kind, case p_kind when 'CUSTOMER' then 'portal_customer.view_documents' else 'portal_vendor.view_documents' end);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'category', d.category,
                             'entity_type', d.entity_type, 'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
                             order by d.uploaded_at desc)
                   from public.documents d
                   where d.company_id = p_company_id and d.party_id = v_party and d.visible_to_party and not d.is_deleted), '[]');
end;
$function$;

CREATE OR REPLACE FUNCTION public.portal_context(p_company_id uuid, p_kind portal_kind)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare v_party uuid := app.portal_party(p_company_id, p_kind); ps record; s public.company_settings; p public.parties;
begin
  select * into ps from app.effective_party_settings(v_party, p_kind);
  select * into s from public.company_settings where company_id = p_company_id;
  select * into p from public.parties where id = v_party;
  return jsonb_build_object('company_id', p_company_id, 'company_name', app.company_name(p_company_id),
    'kind', p_kind, 'party_id', v_party, 'party_name', p.name,
    'stock_visibility', ps.stock_visibility, 'rate_visible', ps.rate_visible,
    'quote_price_enabled', p_kind = 'CUSTOMER' and ps.quote_price_enabled,
    'outstanding_visible', app.portal_outstanding_visible(v_party, p_kind),
    'features', app.portal_features(p_company_id, p_kind),
    'addresses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code)
                           from public.party_addresses a where a.party_id = v_party and a.is_active and a.address_type = 'SHIP_TO'), '[]'));
end;
$function$;

revoke all on function public.portal_user_set_role(uuid, uuid) from public, anon;
grant execute on function public.portal_user_set_role(uuid, uuid) to authenticated, service_role;
grant execute on function app.portal_features(uuid, public.portal_kind), app.portal_outstanding_visible(uuid, public.portal_kind)
  to authenticated, service_role;
revoke all on function app.tg_portal_users_role() from public, anon, authenticated;
