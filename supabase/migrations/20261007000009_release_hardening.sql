-- =============================================================================
-- RELEASE HARDENING (docs/RELEASE_AUDIT.md). No business rule changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C1  Invitations are linked only to VERIFIED email addresses.
-- An auth user whose email is not confirmed (e.g. a password sign-up by
-- someone else) can never claim a staff role or a portal login.
-- -----------------------------------------------------------------------------
create or replace function app.auth_email()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null $$;

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
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if v_user is not null then
    insert into public.user_roles (user_id, company_id, role_id) values (v_user, p_company_id, v_role) on conflict do nothing;
    update public.user_invitations set claimed_by = v_user, claimed_at = now() where id = v_id;
  end if;
  perform app.audit(p_company_id, 'user_invitations', v_id::text, 'INVITE', null,
                    jsonb_build_object('email', p_email, 'role', p_role_code));
  return v_id;
end;
$$;

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
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
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

-- -----------------------------------------------------------------------------
-- H3  The base unit of an item cannot change once it has stock or documents
-- (all quantities are stored in the base unit).
-- -----------------------------------------------------------------------------
create or replace function app.tg_item_base_unit_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.base_unit_id is distinct from old.base_unit_id and (
       exists (select 1 from public.stock_movements where item_id = old.id)
    or exists (select 1 from public.purchase_order_lines where item_id = old.id)
    or exists (select 1 from public.sales_order_lines where item_id = old.id)
    or exists (select 1 from public.customer_po_lines where item_id = old.id)
    or exists (select 1 from public.purchase_receipt_lines where item_id = old.id)
    or exists (select 1 from public.stock_adjustment_lines where item_id = old.id)
    or exists (select 1 from public.stock_transfer_lines where item_id = old.id)) then
    raise exception 'The base unit of % cannot be changed: the item already has stock or documents', old.name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger items_base_unit_guard before update of base_unit_id on public.items
  for each row execute function app.tg_item_base_unit_guard();

-- -----------------------------------------------------------------------------
-- M1  Only an OWNER can grant or remove the OWNER role; the last OWNER of a
-- company cannot be removed.
-- -----------------------------------------------------------------------------
create or replace function app.tg_user_roles_owner_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_role text; v_company uuid; v_actor_owner boolean;
begin
  v_company := coalesce(new.company_id, old.company_id);
  select code into v_role from public.roles where id = coalesce(new.role_id, old.role_id);
  if v_role <> 'OWNER' or app.is_trusted_caller() then
    return coalesce(new, old);
  end if;
  -- first owner of a new company (create_company)
  if tg_op = 'INSERT' and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                      where ur.company_id = v_company and r.code = 'OWNER') then
    return new;
  end if;
  v_actor_owner := exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                           where ur.user_id = auth.uid() and ur.company_id = v_company and r.code = 'OWNER');
  if not v_actor_owner then
    raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                      where ur.company_id = v_company and r.code = 'OWNER' and ur.user_id <> old.user_id) then
    raise exception 'A company must keep at least one owner' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger user_roles_owner_guard before insert or update or delete on public.user_roles
  for each row execute function app.tg_user_roles_owner_guard();

-- -----------------------------------------------------------------------------
-- M2  Manual sales orders cannot fake a customer-PO link or a customer quote.
-- -----------------------------------------------------------------------------
create or replace function app.post_sales_order(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare h public.sales_orders; v_doc_no text;
begin
  select * into h from public.sales_orders where id = p_id;
  perform app.assert_same_company(h.company_id, 'parties', h.party_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  if not app.party_has_role(h.party_id, 'CUSTOMER') then
    raise exception 'Party is not set up as a customer' using errcode = 'P0001';
  end if;
  if h.ship_to_address_id is not null and not exists (
       select 1 from public.party_addresses where id = h.ship_to_address_id and party_id = h.party_id) then
    raise exception 'Delivery location does not belong to this customer' using errcode = 'P0001';
  end if;
  -- Orders from a customer PO are created only by customer_po_approve (which
  -- stores the quote and approved price); a manually entered order can not
  -- pretend to come from a customer PO or carry a customer quote.
  if h.customer_po_id is not null then
    raise exception 'Orders of a customer PO are created by approving the customer PO' using errcode = 'P0001';
  end if;
  update public.sales_order_lines set quoted_rate = null, reference_rate = null where order_id = p_id;
  perform app.normalise_lines(app.doc_type('SALES_ORDER'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'SALES_ORDER', h.doc_date);
  update public.sales_orders set doc_no = v_doc_no, status = 'OPEN' where id = p_id;
  return app.result(p_id, v_doc_no, 'OPEN', null);
end;
$$;

-- -----------------------------------------------------------------------------
-- M3  Concurrent reminder runs: duplicates are skipped, never an error.
-- -----------------------------------------------------------------------------
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
  on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    return null;     -- already queued by another run
  end if;
  perform app.email_event(v_id, case when cardinality(v_to) = 0 then 'FAILED' else 'QUEUED' end::public.email_status,
                          case when cardinality(v_to) = 0 then 'No recipient address' else 'Queued' end);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- M4  Privilege hygiene: views are read-only; settings rows are never
-- inserted / deleted by users; trigger functions not executable.
-- -----------------------------------------------------------------------------
do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', v.table_name);
  end loop;
end $$;
revoke insert, delete, truncate on public.company_settings from authenticated;
revoke all on function app.tg_godown_negative_guard() from public, anon, authenticated;
-- objects created from now on: nothing for anon / PUBLIC by default
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- M5  Indexes for the lookups used by reservations, portals and storage checks.
-- -----------------------------------------------------------------------------
create index if not exists stock_reservations_order_idx on public.stock_reservations (sales_order_id);
create index if not exists stock_reservation_movements_res_idx on public.stock_reservation_movements (reservation_id);
create index if not exists sales_orders_party_idx on public.sales_orders (company_id, party_id, doc_date);
create index if not exists sales_orders_customer_po_idx on public.sales_orders (customer_po_id) where customer_po_id is not null;
create index if not exists purchase_orders_party_idx on public.purchase_orders (company_id, party_id, doc_date);
create index if not exists portal_users_party_idx on public.portal_users (party_id);
create index if not exists customer_pos_sales_order_idx on public.customer_pos (sales_order_id) where sales_order_id is not null;
create index if not exists payment_reminders_party_idx on public.payment_reminders (company_id, party_id);

-- -----------------------------------------------------------------------------
-- M8  Valid ranges for settings.
-- -----------------------------------------------------------------------------
alter table public.company_settings
  add constraint company_settings_email_attempts_chk check (email_max_attempts between 1 and 20),
  add constraint company_settings_customer_days_chk check (customer_reminder_start_days between 0 and 365),
  add constraint company_settings_vendor_days_chk check (vendor_reminder_start_days between 0 and 365);
