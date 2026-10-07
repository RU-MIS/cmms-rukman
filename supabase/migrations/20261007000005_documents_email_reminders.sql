-- =============================================================================
-- INVENTORY MVP — documents, email outbox, payment reminders (§24–32)
--
-- Email is NEVER part of the critical transaction: business functions only
-- INSERT a row into email_outbox (or nothing, when the setting is OFF). The
-- worker (worker/) sends it later, records the result and retries failures.
-- A failing / missing SMTP server can never roll back a PO, upload or payment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documents (§24). Files live in Supabase Storage bucket "documents" under
-- "<company_id>/<entity_type>/<uuid>-<file name>"; this table holds metadata.
-- -----------------------------------------------------------------------------
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  category          text not null check (category in ('PO_PDF', 'INVOICE', 'PURCHASE_DOCUMENT', 'DELIVERY_DOCUMENT',
                                                      'PAYMENT_DOCUMENT', 'OTHER')),
  entity_type       text not null check (entity_type in ('purchase_order', 'purchase_receipt', 'customer_bill',
                                                         'sales_order', 'customer_po', 'dispatch', 'voucher', 'party')),
  entity_id         uuid not null,
  party_id          uuid references public.parties (id),          -- derived from the entity
  storage_bucket    text not null default 'documents',
  storage_path      text not null,
  file_name         text not null,
  mime_type         text,
  size_bytes        bigint check (size_bytes >= 0),
  visible_to_party  boolean not null default false,               -- shown in the customer / vendor portal
  uploaded_via      text not null default 'INTERNAL' check (uploaded_via in ('INTERNAL', 'PORTAL')),
  remarks           text,
  is_deleted        boolean not null default false,
  uploaded_by       uuid,
  uploaded_at       timestamptz not null default now()
);
create unique index documents_path_uq on public.documents (storage_bucket, storage_path);
create index documents_entity_idx on public.documents (company_id, entity_type, entity_id) where not is_deleted;
create index documents_party_idx on public.documents (company_id, party_id) where not is_deleted;

create or replace function app.try_uuid(p text)
returns uuid
language plpgsql immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Company + party of a business entity, or an error when it does not exist.
create or replace function app.entity_party(p_entity_type text, p_entity_id uuid,
                                            out company_id uuid, out party_id uuid)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  case p_entity_type
    when 'purchase_order'   then select o.company_id, o.party_id into company_id, party_id from public.purchase_orders o where o.id = p_entity_id;
    when 'purchase_receipt' then select o.company_id, o.party_id into company_id, party_id from public.purchase_receipts o where o.id = p_entity_id;
    when 'customer_bill'    then select o.company_id, o.party_id into company_id, party_id from public.customer_bills o where o.id = p_entity_id;
    when 'sales_order'      then select o.company_id, o.party_id into company_id, party_id from public.sales_orders o where o.id = p_entity_id;
    when 'customer_po'      then select o.company_id, o.party_id into company_id, party_id from public.customer_pos o where o.id = p_entity_id;
    when 'dispatch'         then select d.company_id, s.party_id into company_id, party_id
                                   from public.dispatches d join public.sales_orders s on s.id = d.sales_order_id where d.id = p_entity_id;
    when 'voucher'          then select o.company_id, o.party_id into company_id, party_id from public.vouchers o where o.id = p_entity_id;
    when 'party'            then select o.company_id, o.id into company_id, party_id from public.parties o where o.id = p_entity_id;
    else raise exception 'Unknown document entity %', p_entity_type using errcode = 'P0001';
  end case;
  if company_id is null then
    raise exception 'The record this document belongs to was not found' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Email outbox + history (§25–27)
-- -----------------------------------------------------------------------------
create table public.email_outbox (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id),
  kind                 text not null check (kind in ('VENDOR_PO', 'VENDOR_DOCUMENT', 'CUSTOMER_INVOICE', 'CUSTOMER_DOCUMENT',
                                                     'CUSTOMER_PAYMENT_REMINDER', 'VENDOR_PAYMENT_REMINDER')),
  party_id             uuid references public.parties (id),
  recipient_type       text not null check (recipient_type in ('PARTY', 'INTERNAL')),
  to_emails            text[] not null default '{}',
  cc_emails            text[] not null default '{}',
  subject              text not null,
  body_text            text not null,
  entity_type          text,
  entity_id            uuid,
  document_id          uuid references public.documents (id),
  attachments          jsonb not null default '[]',   -- [{"document_id": …}] / [{"po_pdf": "<purchase_order_id>"}]
  status               public.email_status not null default 'QUEUED',
  attempts             integer not null default 0,
  max_attempts         integer not null default 5,
  next_attempt_at      timestamptz not null default now(),
  claimed_at           timestamptz,
  last_error           text,
  provider_message_id  text,
  sent_at              timestamptz,
  dedupe_key           text,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index email_outbox_dedupe_uq on public.email_outbox (company_id, dedupe_key) where dedupe_key is not null;
create index email_outbox_queue_idx on public.email_outbox (next_attempt_at) where status = 'QUEUED';
create index email_outbox_company_idx on public.email_outbox (company_id, created_at desc);
create index email_outbox_entity_idx on public.email_outbox (entity_type, entity_id);

create table public.email_events (
  id          bigint generated always as identity primary key,
  outbox_id   uuid not null references public.email_outbox (id) on delete cascade,
  status      public.email_status not null,
  message     text,
  actor_id    uuid,
  created_at  timestamptz not null default now()
);
create index email_events_outbox_idx on public.email_events (outbox_id, id);

create or replace function app.email_event(p_id uuid, p_status public.email_status, p_message text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.email_events (outbox_id, status, message, actor_id) values (p_id, p_status, p_message, auth.uid())
$$;

-- Is this kind of email switched on for the company (and the party)?
create or replace function app.email_enabled(p_company_id uuid, p_kind text, p_party_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare s public.company_settings; v_party boolean := true;
begin
  select * into s from public.company_settings where company_id = p_company_id;
  if s.company_id is null or not s.email_automation then
    return false;
  end if;
  -- party override (only for mails that go TO the party)
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

-- Email addresses of a party (comma / semicolon separated in parties.email).
create or replace function app.party_emails(p_party_id uuid)
returns text[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct lower(trim(e))) filter (where trim(e) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'), '{}')
  from public.parties p, regexp_split_to_table(coalesce(p.email, ''), '[,;\s]+') e
  where p.id = p_party_id
$$;

-- Internal users of the company having one of the given role codes.
create or replace function app.role_emails(p_company_id uuid, p_roles text[])
returns text[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct lower(u.email)) filter (where u.email is not null), '{}')
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join auth.users u on u.id = ur.user_id
  left join public.profiles pr on pr.id = ur.user_id
  where ur.company_id = p_company_id and upper(r.code) = any (select upper(x) from unnest(p_roles) x)
    and coalesce(pr.is_active, true)
$$;

-- Queue an email. Returns NULL (and queues nothing) when the setting is OFF.
-- A missing address is queued as FAILED with a clear error so it shows in the
-- email log and can be retried after the address is fixed.
create or replace function app.enqueue_email(
  p_company_id uuid, p_kind text, p_party_id uuid, p_subject text, p_body text,
  p_entity_type text default null, p_entity_id uuid default null, p_document_id uuid default null,
  p_attachments jsonb default '[]', p_to text[] default null, p_dedupe_key text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid; v_to text[]; v_internal boolean := p_kind = 'VENDOR_PAYMENT_REMINDER';
  s public.company_settings := app.settings(p_company_id);
begin
  if not app.email_enabled(p_company_id, p_kind, p_party_id) then
    return null;
  end if;
  if p_dedupe_key is not null and exists (select 1 from public.email_outbox
                                          where company_id = p_company_id and dedupe_key = p_dedupe_key) then
    return null;
  end if;
  v_to := coalesce(p_to, case when p_party_id is not null and not v_internal then app.party_emails(p_party_id) end, '{}');
  insert into public.email_outbox (company_id, kind, party_id, recipient_type, to_emails, subject, body_text,
                                   entity_type, entity_id, document_id, attachments, max_attempts, dedupe_key,
                                   status, last_error, created_by)
  values (p_company_id, p_kind, p_party_id, case when v_internal then 'INTERNAL' else 'PARTY' end, v_to,
          p_subject, p_body, p_entity_type, p_entity_id, p_document_id, coalesce(p_attachments, '[]'),
          s.email_max_attempts, p_dedupe_key,
          case when cardinality(v_to) = 0 then 'FAILED' else 'QUEUED' end::public.email_status,
          case when cardinality(v_to) = 0 then
            case when v_internal then 'No internal user with an email address has the configured reminder roles'
                 else 'No email address is set for ' || coalesce((select name from public.parties where id = p_party_id), 'the recipient') end
          end, auth.uid())
  returning id into v_id;
  perform app.email_event(v_id, case when cardinality(v_to) = 0 then 'FAILED' else 'QUEUED' end::public.email_status,
                          case when cardinality(v_to) = 0 then 'No recipient address' else 'Queued' end);
  return v_id;
end;
$$;

create or replace function app.company_name(p_company_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce(trade_name, legal_name) from public.companies where id = p_company_id $$;

-- -----------------------------------------------------------------------------
-- Vendor PO email when the PO is confirmed (§25: PO PDF).
-- -----------------------------------------------------------------------------
create or replace function app.queue_vendor_po_email(p_po_id uuid, p_document_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare o public.purchase_orders; v_kind text := case when p_document_id is null then 'VENDOR_PO' else 'VENDOR_DOCUMENT' end;
        v_att jsonb; v_doc public.documents;
begin
  select * into o from public.purchase_orders where id = p_po_id;
  v_att := jsonb_build_array(jsonb_build_object('po_pdf', o.id));
  if p_document_id is not null then
    select * into v_doc from public.documents where id = p_document_id;
    v_att := v_att || jsonb_build_array(jsonb_build_object('document_id', p_document_id));
  end if;
  return app.enqueue_email(o.company_id, v_kind, o.party_id,
    case when p_document_id is null then 'Purchase Order ' || o.doc_no || ' from ' || app.company_name(o.company_id)
         else 'Document for Purchase Order ' || o.doc_no || ' — ' || v_doc.file_name end,
    format(E'Dear %s,\n\nPlease find attached Purchase Order %s dated %s%s.\n%s\nRegards,\n%s',
           (select name from public.parties where id = o.party_id), o.doc_no, to_char(o.doc_date, 'DD-Mon-YYYY'),
           case when o.expected_date is not null then ', expected delivery ' || to_char(o.expected_date, 'DD-Mon-YYYY') else '' end,
           case when p_document_id is not null then E'\nAlso attached: ' || v_doc.file_name || E'\n' else '' end,
           app.company_name(o.company_id)),
    'purchase_order', o.id, p_document_id, v_att);
end;
$$;

create or replace function app.post_purchase_order(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.purchase_orders; v_doc_no text; v_mail uuid;
begin
  select * into h from public.purchase_orders where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('PURCHASE_ORDER'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'PURCHASE_ORDER', h.doc_date);
  update public.purchase_orders set doc_no = v_doc_no, status = 'OPEN' where id = p_id;
  perform app.audit(h.company_id, 'purchase_orders', p_id::text, 'POST', null, jsonb_build_object('doc_no', v_doc_no));
  v_mail := app.queue_vendor_po_email(p_id);   -- queued only; never sent here
  return app.result(p_id, v_doc_no, 'OPEN', null) || jsonb_build_object('email_id', v_mail);
end;
$$;

-- Resend the PO email on demand (e.g. after correcting the vendor email).
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
-- Register an uploaded document (§24) and queue the automatic email (§25–26).
-- payload: company_id, entity_type, entity_id, category, storage_path,
--          file_name, mime_type, size_bytes, visible_to_party, remarks,
--          send_email (default true)
-- -----------------------------------------------------------------------------
create or replace function app.document_emails(d public.documents, p_send boolean)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_po uuid; v_party public.parties; v_bill public.customer_bills; v_is_vendor boolean; v_is_customer boolean;
begin
  if not p_send or d.party_id is null then
    return null;
  end if;
  select * into v_party from public.parties where id = d.party_id;
  v_is_vendor := app.party_has_role(d.party_id, 'SUPPLIER') or app.party_has_role(d.party_id, 'JOB_WORKER')
                 or app.party_has_role(d.party_id, 'CUTTER');
  v_is_customer := app.party_has_role(d.party_id, 'CUSTOMER');

  -- Customer invoice (Tally PDF) → CUSTOMER_INVOICE
  if d.entity_type = 'customer_bill' and d.category = 'INVOICE' then
    select * into v_bill from public.customer_bills where id = d.entity_id;
    return app.enqueue_email(d.company_id, 'CUSTOMER_INVOICE', d.party_id,
      'Invoice ' || v_bill.bill_no || ' from ' || app.company_name(d.company_id),
      format(E'Dear %s,\n\nPlease find attached invoice %s dated %s for ₹%s%s.\n\nRegards,\n%s',
             v_party.name, v_bill.bill_no, to_char(v_bill.doc_date, 'DD-Mon-YYYY'),
             to_char(v_bill.amount, 'FM99,99,99,99,990.00'),
             case when v_bill.due_date is not null then ', due on ' || to_char(v_bill.due_date, 'DD-Mon-YYYY') else '' end,
             app.company_name(d.company_id)),
      'customer_bill', v_bill.id, d.id, jsonb_build_array(jsonb_build_object('document_id', d.id)),
      null, 'INVOICE:' || d.id);
  end if;

  -- Vendor document → PO PDF + uploaded document
  if d.entity_type in ('purchase_order', 'purchase_receipt') or (d.entity_type in ('party', 'voucher') and v_is_vendor and not v_is_customer) then
    v_po := case d.entity_type
              when 'purchase_order' then d.entity_id
              when 'purchase_receipt' then (select ol.order_id from public.purchase_receipt_lines rl
                                            join public.purchase_order_lines ol on ol.id = rl.po_line_id
                                            where rl.receipt_id = d.entity_id limit 1)
              else (select o.id from public.purchase_orders o where o.party_id = d.party_id
                    and o.status in ('OPEN', 'PARTIALLY_RECEIVED') order by o.doc_date desc limit 1)
            end;
    if v_po is not null then
      return app.queue_vendor_po_email(v_po, d.id);
    end if;
    return app.enqueue_email(d.company_id, 'VENDOR_DOCUMENT', d.party_id,
      'Document from ' || app.company_name(d.company_id) || ' — ' || d.file_name,
      format(E'Dear %s,\n\nPlease find attached %s.\n\nRegards,\n%s', v_party.name, d.file_name, app.company_name(d.company_id)),
      d.entity_type, d.entity_id, d.id, jsonb_build_array(jsonb_build_object('document_id', d.id)));
  end if;

  -- Other customer documents → CUSTOMER_DOCUMENT
  if v_is_customer then
    return app.enqueue_email(d.company_id, 'CUSTOMER_DOCUMENT', d.party_id,
      'Document from ' || app.company_name(d.company_id) || ' — ' || d.file_name,
      format(E'Dear %s,\n\nPlease find attached %s.\n\nRegards,\n%s', v_party.name, d.file_name, app.company_name(d.company_id)),
      d.entity_type, d.entity_id, d.id, jsonb_build_array(jsonb_build_object('document_id', d.id)));
  end if;
  return null;
end;
$$;

create or replace function public.document_register(p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_company uuid := (p_payload->>'company_id')::uuid;
  v_ent record; d public.documents; v_mail uuid; v_path text := p_payload->>'storage_path';
begin
  if v_company is null or not app.is_member(v_company) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(v_company, 'documents.create');
  select * into v_ent from app.entity_party(p_payload->>'entity_type', (p_payload->>'entity_id')::uuid);
  if v_ent.company_id <> v_company then
    raise exception 'The record this document belongs to was not found' using errcode = 'P0001';
  end if;
  if v_path is null or split_part(v_path, '/', 1) <> v_company::text or v_path like '%..%' then
    raise exception 'File must be uploaded into the company folder' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_payload->>'file_name'), '') = '' then
    raise exception 'File name is required' using errcode = 'P0001';
  end if;
  insert into public.documents (company_id, category, entity_type, entity_id, party_id, storage_path, file_name,
                                mime_type, size_bytes, visible_to_party, remarks, uploaded_by)
  values (v_company, coalesce(p_payload->>'category', 'OTHER'), p_payload->>'entity_type', (p_payload->>'entity_id')::uuid,
          v_ent.party_id, v_path, trim(p_payload->>'file_name'), p_payload->>'mime_type',
          (p_payload->>'size_bytes')::bigint, coalesce((p_payload->>'visible_to_party')::boolean,
            coalesce(p_payload->>'category', 'OTHER') in ('INVOICE', 'PO_PDF')),
          p_payload->>'remarks', auth.uid())
  returning * into d;
  perform app.audit(v_company, 'documents', d.id::text, 'UPLOAD', null, to_jsonb(d));
  -- email is queued, never sent inside this transaction
  v_mail := app.document_emails(d, coalesce((p_payload->>'send_email')::boolean, true));
  return jsonb_build_object('document_id', d.id, 'email_id', v_mail,
                            'email_status', (select status from public.email_outbox where id = v_mail));
end;
$$;

create or replace function public.document_delete(p_document_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_document_id for no key update;
  if d.id is null or not app.is_member(d.company_id) then
    raise exception 'Document not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(d.company_id, 'documents.delete');
  update public.documents set is_deleted = true where id = d.id;
  perform app.audit(d.company_id, 'documents', d.id::text, 'DELETE', to_jsonb(d), null);
end;
$$;

create or replace function public.document_set_visibility(p_document_id uuid, p_visible boolean)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_document_id for no key update;
  if d.id is null or not app.is_member(d.company_id) then
    raise exception 'Document not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(d.company_id, 'documents.edit');
  update public.documents set visible_to_party = p_visible where id = d.id;
  perform app.audit(d.company_id, 'documents', d.id::text, 'VISIBILITY', null, jsonb_build_object('visible_to_party', p_visible));
end;
$$;

-- -----------------------------------------------------------------------------
-- Print data of a PO (worker PDF, internal download, vendor portal).
-- -----------------------------------------------------------------------------
create or replace function app.purchase_order_print_data(p_po_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', coalesce(c.trade_name, c.legal_name), 'legal_name', c.legal_name,
                                  'address', concat_ws(', ', c.address_line1, c.address_line2, c.city, c.state, c.pincode),
                                  'gstin', c.gstin, 'phone', c.phone, 'email', c.email),
    'vendor', jsonb_build_object('name', p.name, 'address', concat_ws(', ', p.address, p.city), 'gstin', p.gstin,
                                 'email', p.email, 'mobile', p.mobile),
    'po', jsonb_build_object('id', o.id, 'doc_no', o.doc_no, 'doc_date', o.doc_date, 'expected_date', o.expected_date,
                             'status', o.status, 'remarks', o.remarks,
                             'deliver_to', (select name from public.godowns where id = o.godown_id)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                         'line_no', l.line_no, 'item_code', i.code, 'item_name', i.name, 'description', i.description,
                         'qty', l.qty, 'unit', u.code, 'rate', l.rate,
                         'amount', round(l.ordered_base_qty * coalesce(l.rate, 0), 2)) order by l.line_no)
                       from public.purchase_order_lines l join public.items i on i.id = l.item_id
                       join public.units u on u.id = l.unit_id where l.order_id = o.id), '[]'),
    'total', (select coalesce(sum(round(l.ordered_base_qty * coalesce(l.rate, 0), 2)), 0)
              from public.purchase_order_lines l where l.order_id = o.id))
  from public.purchase_orders o
  join public.companies c on c.id = o.company_id
  join public.parties p on p.id = o.party_id
  where o.id = p_po_id
$$;

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
  return app.purchase_order_print_data(p_po_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker API (service role only)
-- -----------------------------------------------------------------------------
create or replace function app.require_trusted()
returns void
language plpgsql stable
as $$
begin
  if not app.is_trusted_caller() then
    raise exception 'Only the email worker (service role) can do this' using errcode = '42501';
  end if;
end;
$$;

-- Is a reminder still due? (bill outstanding > 0 and reminders still on)
create or replace function app.reminder_still_due(e public.email_outbox)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_out numeric; v_table text;
begin
  v_table := e.entity_type;
  select outstanding_amount into v_out from public.v_bill_outstanding where bill_table = v_table and bill_id = e.entity_id;
  return coalesce(v_out, 0) > 0;
end;
$$;

create or replace function public.email_claim(p_limit integer default 10)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e public.email_outbox; v_out jsonb := '[]'; v_att jsonb; a jsonb; d public.documents; v_to text[];
begin
  perform app.require_trusted();
  -- a worker that died while sending: hand the mail back to the queue
  update public.email_outbox set status = 'QUEUED', claimed_at = null, updated_at = now(),
         last_error = 'Worker stopped while sending; re-queued'
   where status = 'SENDING' and claimed_at < now() - interval '15 minutes';

  for e in select * from public.email_outbox
           where status = 'QUEUED' and next_attempt_at <= now()
           order by next_attempt_at, created_at
           limit greatest(p_limit, 1)
           for update skip locked
  loop
    -- settings are checked again at send time (§34)
    if not app.email_enabled(e.company_id, e.kind, e.party_id) then
      update public.email_outbox set status = 'SKIPPED', last_error = 'Email turned off in settings', updated_at = now()
       where id = e.id;
      perform app.email_event(e.id, 'SKIPPED', 'Email turned off in settings');
      continue;
    end if;
    if e.kind in ('CUSTOMER_PAYMENT_REMINDER', 'VENDOR_PAYMENT_REMINDER') and not app.reminder_still_due(e) then
      update public.email_outbox set status = 'CANCELLED', last_error = 'Bill is fully paid', updated_at = now()
       where id = e.id;
      perform app.email_event(e.id, 'CANCELLED', 'Bill is fully paid');
      continue;
    end if;
    v_to := e.to_emails;
    if cardinality(v_to) = 0 and e.party_id is not null and e.recipient_type = 'PARTY' then
      v_to := app.party_emails(e.party_id);
    end if;
    if cardinality(v_to) = 0 then
      update public.email_outbox set status = 'FAILED', last_error = 'No recipient address', updated_at = now()
       where id = e.id;
      perform app.email_event(e.id, 'FAILED', 'No recipient address');
      continue;
    end if;
    v_att := '[]';
    for a in select * from jsonb_array_elements(e.attachments) loop
      if a ? 'document_id' then
        select * into d from public.documents where id = (a->>'document_id')::uuid and company_id = e.company_id;
        if d.id is not null then
          v_att := v_att || jsonb_build_array(jsonb_build_object('type', 'storage', 'bucket', d.storage_bucket,
                     'path', d.storage_path, 'file_name', d.file_name, 'mime_type', d.mime_type));
        end if;
      elsif a ? 'po_pdf' then
        v_att := v_att || jsonb_build_array(jsonb_build_object('type', 'po_pdf',
                   'file_name', 'PO-' || regexp_replace(coalesce((select doc_no from public.purchase_orders
                                                                  where id = (a->>'po_pdf')::uuid), 'PO'), '[^A-Za-z0-9-]+', '-', 'g') || '.pdf',
                   'data', app.purchase_order_print_data((a->>'po_pdf')::uuid)));
      end if;
    end loop;
    update public.email_outbox set status = 'SENDING', attempts = attempts + 1, claimed_at = now(), to_emails = v_to,
           updated_at = now() where id = e.id;
    perform app.email_event(e.id, 'SENDING', 'Attempt ' || (e.attempts + 1));
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', e.id, 'company_id', e.company_id, 'company_name', app.company_name(e.company_id),
      'company_email', (select email from public.companies where id = e.company_id),
      'kind', e.kind, 'to', to_jsonb(v_to), 'cc', to_jsonb(e.cc_emails), 'subject', e.subject, 'body_text', e.body_text,
      'attachments', v_att, 'attempt', e.attempts + 1));
  end loop;
  return v_out;
end;
$$;

create or replace function public.email_complete(p_id uuid, p_ok boolean, p_error text default null,
                                                 p_message_id text default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e public.email_outbox;
begin
  perform app.require_trusted();
  select * into e from public.email_outbox where id = p_id for update;
  if e.id is null or e.status <> 'SENDING' then
    raise exception 'Email % is not being sent', p_id using errcode = 'P0001';
  end if;
  if p_ok then
    update public.email_outbox set status = 'SENT', sent_at = now(), provider_message_id = p_message_id,
           last_error = null, updated_at = now() where id = p_id;
    perform app.email_event(p_id, 'SENT', coalesce('Message ' || p_message_id, 'Sent'));
    return jsonb_build_object('id', p_id, 'status', 'SENT');
  end if;
  if e.attempts >= e.max_attempts then
    update public.email_outbox set status = 'FAILED', last_error = p_error, updated_at = now() where id = p_id;
    perform app.email_event(p_id, 'FAILED', p_error);
    return jsonb_build_object('id', p_id, 'status', 'FAILED');
  end if;
  -- retry with back-off: 2, 4, 8, 16 … minutes
  update public.email_outbox set status = 'QUEUED', last_error = p_error,
         next_attempt_at = now() + make_interval(mins => power(2, e.attempts)::int), updated_at = now()
   where id = p_id;
  perform app.email_event(p_id, 'QUEUED', 'Retry scheduled after error: ' || coalesce(p_error, 'unknown'));
  return jsonb_build_object('id', p_id, 'status', 'QUEUED');
end;
$$;

-- Manual retry from the email log (§25 "retry failed email").
create or replace function public.email_retry(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e public.email_outbox; v_to text[];
begin
  select * into e from public.email_outbox where id = p_id for update;
  if e.id is null or not app.is_member(e.company_id) then
    raise exception 'Email not found' using errcode = 'P0001';
  end if;
  perform app.require_permission(e.company_id, 'email.edit');
  if e.status not in ('FAILED', 'SKIPPED', 'CANCELLED') then
    raise exception 'Only failed / skipped emails can be retried (status %)', e.status using errcode = 'P0001';
  end if;
  v_to := e.to_emails;
  if e.party_id is not null and e.recipient_type = 'PARTY' then
    v_to := app.party_emails(e.party_id);      -- pick up a corrected address
  elsif e.kind = 'VENDOR_PAYMENT_REMINDER' then
    v_to := app.role_emails(e.company_id, (app.settings(e.company_id)).vendor_reminder_roles);
  end if;
  update public.email_outbox set status = 'QUEUED', attempts = 0, next_attempt_at = now(), to_emails = v_to,
         last_error = null, updated_at = now() where id = p_id;
  perform app.email_event(p_id, 'QUEUED', 'Manual retry');
  perform app.audit(e.company_id, 'email_outbox', p_id::text, 'RETRY', null, null);
  return jsonb_build_object('id', p_id, 'status', 'QUEUED');
end;
$$;

create or replace view public.v_email_log
with (security_invoker = true) as
select e.id, e.company_id, e.kind, e.status, e.party_id, p.name as party_name, e.recipient_type,
       e.to_emails, e.subject, e.entity_type, e.entity_id, e.document_id, dmt.file_name as document_name,
       e.attempts, e.max_attempts, e.last_error, e.sent_at, e.next_attempt_at, e.created_at, e.updated_at
from public.email_outbox e
left join public.parties p on p.id = e.party_id
left join public.documents dmt on dmt.id = e.document_id;

-- -----------------------------------------------------------------------------
-- Payment reminders (§29–32)
-- -----------------------------------------------------------------------------
create table public.payment_reminders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  side                text not null check (side in ('CUSTOMER', 'VENDOR')),
  bill_table          text not null,
  bill_id             uuid not null,
  party_id            uuid not null references public.parties (id),
  reminder_date       date not null,
  due_date            date not null,
  outstanding_amount  numeric(16,2) not null,
  outbox_id           uuid references public.email_outbox (id),
  created_at          timestamptz not null default now(),
  unique (bill_table, bill_id, reminder_date)
);
create index payment_reminders_bill_idx on public.payment_reminders (bill_table, bill_id, reminder_date desc);

-- Generates reminder emails for one company (or all, when trusted).
-- Rules: start <start_days> before the due date, repeat DAILY or WEEKLY,
-- continue after partial payment, stop when outstanding = 0, nothing at all
-- when the reminder setting (or its email setting) is OFF.
create or replace function public.run_payment_reminders(p_as_of date default current_date, p_company_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  s public.company_settings; b record; v_mail uuid; v_days int; v_freq public.reminder_frequency;
  v_customer int := 0; v_vendor int := 0; v_internal text[]; ps record;
begin
  if p_company_id is null then
    perform app.require_trusted();
  elsif not app.is_trusted_caller() then
    if not app.is_member(p_company_id) then
      raise exception 'Unknown company' using errcode = 'P0001';
    end if;
    perform app.require_permission(p_company_id, 'settings.edit');
  end if;

  for s in select * from public.company_settings where p_company_id is null or company_id = p_company_id loop
    -- customer reminders → customer's email
    if s.customer_reminder_enabled then
      for b in select o.* from public.v_bill_outstanding o
               where o.company_id = s.company_id and o.side = 'RECEIVABLE' and o.bill_table = 'customer_bills'
                 and o.due_date is not null and o.outstanding_amount > 0
                 and p_as_of >= o.due_date - s.customer_reminder_start_days
      loop
        select * into ps from app.effective_party_settings(b.party_id, 'CUSTOMER');
        continue when not ps.payment_reminder_enabled;
        continue when exists (select 1 from public.payment_reminders r where r.bill_table = b.bill_table and r.bill_id = b.bill_id
                              and r.reminder_date > p_as_of - case s.customer_reminder_frequency when 'WEEKLY' then 7 else 1 end
                              and r.reminder_date <= p_as_of);
        v_mail := app.enqueue_email(s.company_id, 'CUSTOMER_PAYMENT_REMINDER', b.party_id,
          case when p_as_of > b.due_date then 'Overdue: invoice ' else 'Payment reminder: invoice ' end || b.doc_no,
          format(E'Dear %s,\n\nThis is a reminder that invoice %s dated %s is %s %s.\nInvoice amount: ₹%s\nOutstanding: ₹%s\n\nPlease arrange the payment. Ignore this message if already paid.\n\nRegards,\n%s',
                 b.party_name, b.doc_no, to_char(b.doc_date, 'DD-Mon-YYYY'),
                 case when p_as_of > b.due_date then 'overdue since' else 'due on' end, to_char(b.due_date, 'DD-Mon-YYYY'),
                 to_char(b.bill_amount, 'FM99,99,99,99,990.00'), to_char(b.outstanding_amount, 'FM99,99,99,99,990.00'),
                 app.company_name(s.company_id)),
          b.bill_table, b.bill_id, null, '[]', null, 'CPR:' || b.bill_id || ':' || p_as_of);
        continue when v_mail is null;
        insert into public.payment_reminders (company_id, side, bill_table, bill_id, party_id, reminder_date, due_date,
                                              outstanding_amount, outbox_id)
        values (s.company_id, 'CUSTOMER', b.bill_table, b.bill_id, b.party_id, p_as_of, b.due_date, b.outstanding_amount, v_mail)
        on conflict do nothing;
        v_customer := v_customer + 1;
      end loop;
    end if;

    -- vendor reminders → internal users with the configured roles (§31)
    if s.vendor_reminder_enabled then
      v_internal := app.role_emails(s.company_id, s.vendor_reminder_roles);
      for b in select o.* from public.v_bill_outstanding o
               where o.company_id = s.company_id and o.side = 'PAYABLE'
                 and o.bill_table in ('purchase_receipts', 'service_bills', 'job_work_receipts')
                 and o.due_date is not null and o.outstanding_amount > 0
                 and p_as_of >= o.due_date - s.vendor_reminder_start_days
      loop
        select * into ps from app.effective_party_settings(b.party_id, 'VENDOR');
        continue when not ps.payment_reminder_enabled;
        continue when exists (select 1 from public.payment_reminders r where r.bill_table = b.bill_table and r.bill_id = b.bill_id
                              and r.reminder_date > p_as_of - case s.vendor_reminder_frequency when 'WEEKLY' then 7 else 1 end
                              and r.reminder_date <= p_as_of);
        v_mail := app.enqueue_email(s.company_id, 'VENDOR_PAYMENT_REMINDER', b.party_id,
          'Vendor payment ' || case when p_as_of > b.due_date then 'overdue' else 'due' end || ': ' || b.party_name || ' — ₹'
            || to_char(b.outstanding_amount, 'FM99,99,99,99,990.00'),
          format(E'Vendor: %s\nBill: %s dated %s\nAmount: ₹%s\nOutstanding: ₹%s\nDue: %s%s\n\n— %s ERP',
                 b.party_name, b.doc_no, to_char(b.doc_date, 'DD-Mon-YYYY'),
                 to_char(b.bill_amount, 'FM99,99,99,99,990.00'), to_char(b.outstanding_amount, 'FM99,99,99,99,990.00'),
                 to_char(b.due_date, 'DD-Mon-YYYY'), case when p_as_of > b.due_date then ' (OVERDUE)' else '' end,
                 app.company_name(s.company_id)),
          b.bill_table, b.bill_id, null, '[]', v_internal, 'VPR:' || b.bill_id || ':' || p_as_of);
        continue when v_mail is null;
        insert into public.payment_reminders (company_id, side, bill_table, bill_id, party_id, reminder_date, due_date,
                                              outstanding_amount, outbox_id)
        values (s.company_id, 'VENDOR', b.bill_table, b.bill_id, b.party_id, p_as_of, b.due_date, b.outstanding_amount, v_mail)
        on conflict do nothing;
        v_vendor := v_vendor + 1;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('as_of', p_as_of, 'customer_reminders', v_customer, 'vendor_reminders', v_vendor);
end;
$$;

-- Queued reminders of a bill that has just been fully paid are cancelled at
-- once (the worker also re-checks before sending).
create or replace function app.tg_cancel_paid_reminders()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare a record;
begin
  if new.status = 'POSTED' and old.status is distinct from 'POSTED' then
    for a in select bill_table, bill_id from public.voucher_allocations where voucher_id = new.id loop
      if coalesce((select outstanding_amount from public.v_bill_outstanding
                   where bill_table = a.bill_table and bill_id = a.bill_id), 0) <= 0 then
        update public.email_outbox set status = 'CANCELLED', last_error = 'Bill is fully paid', updated_at = now()
         where entity_type = a.bill_table and entity_id = a.bill_id and status = 'QUEUED'
           and kind in ('CUSTOMER_PAYMENT_REMINDER', 'VENDOR_PAYMENT_REMINDER');
      end if;
    end loop;
  end if;
  return null;
end;
$$;
create trigger vouchers_cancel_paid_reminders after update of status on public.vouchers
  for each row execute function app.tg_cancel_paid_reminders();

create or replace view public.v_payment_reminders
with (security_invoker = true) as
select r.*, p.name as party_name, e.status as email_status, e.to_emails, e.last_error, e.sent_at
from public.payment_reminders r
join public.parties p on p.id = r.party_id
left join public.email_outbox e on e.id = r.outbox_id;
