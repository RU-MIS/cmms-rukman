-- =============================================================================
-- PLATFORM R3 (3/10) — settings sections (Owner vs Admin), company branding,
-- security settings, login overview.
--   * every setting belongs to a section with its own view / edit right;
--     writes only through settings_save (direct table writes revoked)
--   * branding per company (white label): app / short name, logo, favicon,
--     colour, document footer, e-mail sender name / reply-to; private bucket
--     `company-assets`
--   * password policy, temporary-password validity (expired temporary
--     passwords cannot be turned into a real one), idle sign-out, login overview
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New settings columns
-- -----------------------------------------------------------------------------
alter table public.company_settings
  add column sale_rate_limit_policy text not null default 'OFF' check (sale_rate_limit_policy in ('OFF', 'WARN', 'BLOCK')),
  add column rate_change_approval   boolean not null default false,
  add column purchase_terms         text,
  add column document_max_mb        integer not null default 20 check (document_max_mb between 1 and 50),
  add column document_categories    text[],
  add column password_min_length    integer not null default 10 check (password_min_length between 8 and 64),
  add column password_require_mixed boolean not null default true,
  add column temp_password_valid_days integer not null default 7 check (temp_password_valid_days between 1 and 90),
  add column idle_logout_minutes    integer check (idle_logout_minutes is null or idle_logout_minutes between 5 and 1440),
  add column image_max_px           integer not null default 1600 check (image_max_px between 400 and 4000),
  add column image_quality          integer not null default 82 check (image_quality between 40 and 95);

create table public.company_branding (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  app_name        text check (app_name is null or length(app_name) <= 60),
  short_name      text check (short_name is null or length(short_name) <= 20),
  primary_color   text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path       text,
  favicon_path    text,
  document_footer text check (document_footer is null or length(document_footer) <= 500),
  email_from_name text check (email_from_name is null or length(email_from_name) <= 80),
  email_reply_to  text check (email_reply_to is null or email_reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
alter table public.company_branding enable row level security;
-- readable by members and by the company's portal users (portal shell, documents)
create policy company_branding_read on public.company_branding for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[])
         or exists (select 1 from public.portal_users pu where pu.user_id = auth.uid() and pu.company_id = company_branding.company_id
                    and pu.is_active));
grant select on public.company_branding to authenticated;
grant all on public.company_branding to service_role;
insert into public.company_branding (company_id) select id from public.companies on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Section registry: which column of which table belongs to which section
-- -----------------------------------------------------------------------------
create table app.settings_fields (
  section     text not null,
  table_name  text not null check (table_name in ('companies', 'company_settings', 'company_branding')),
  column_name text not null,
  primary key (section, table_name, column_name)
);
insert into app.settings_fields values
  ('company', 'companies', 'legal_name'), ('company', 'companies', 'trade_name'), ('company', 'companies', 'gstin'),
  ('company', 'companies', 'pan'), ('company', 'companies', 'address_line1'), ('company', 'companies', 'address_line2'),
  ('company', 'companies', 'city'), ('company', 'companies', 'state'), ('company', 'companies', 'state_code'),
  ('company', 'companies', 'pincode'), ('company', 'companies', 'phone'), ('company', 'companies', 'email'),
  ('company', 'companies', 'website'), ('company', 'companies', 'fy_start_month'), ('company', 'companies', 'books_locked_until'),
  ('branding', 'company_branding', 'app_name'), ('branding', 'company_branding', 'short_name'),
  ('branding', 'company_branding', 'primary_color'), ('branding', 'company_branding', 'logo_path'),
  ('branding', 'company_branding', 'favicon_path'), ('branding', 'company_branding', 'document_footer'),
  ('branding', 'company_branding', 'email_from_name'), ('branding', 'company_branding', 'email_reply_to'),
  ('inventory', 'company_settings', 'allow_negative_stock'),
  ('inventory', 'company_settings', 'image_max_px'), ('inventory', 'company_settings', 'image_quality'),
  ('sales', 'company_settings', 'sale_rate_limit_policy'),
  ('purchase', 'company_settings', 'purchase_terms'),
  ('payments', 'company_settings', 'rate_change_approval'),
  ('documents', 'company_settings', 'document_max_mb'), ('documents', 'company_settings', 'document_categories'),
  ('portal', 'company_settings', 'customer_portal_enabled'), ('portal', 'company_settings', 'vendor_portal_enabled'),
  ('portal', 'company_settings', 'customer_stock_visibility'), ('portal', 'company_settings', 'vendor_stock_visibility'),
  ('portal', 'company_settings', 'customer_rate_visible'), ('portal', 'company_settings', 'vendor_rate_visible'),
  ('portal', 'company_settings', 'customer_quote_price_enabled'), ('portal', 'company_settings', 'customer_outstanding_visible'),
  ('portal', 'company_settings', 'vendor_payment_visible'),
  ('email', 'company_settings', 'email_automation'), ('email', 'company_settings', 'vendor_po_email'),
  ('email', 'company_settings', 'vendor_document_email'), ('email', 'company_settings', 'customer_invoice_email'),
  ('email', 'company_settings', 'customer_document_email'), ('email', 'company_settings', 'payment_reminder_email'),
  ('email', 'company_settings', 'vendor_payment_reminder_email'), ('email', 'company_settings', 'email_max_attempts'),
  ('reminders', 'company_settings', 'customer_reminder_enabled'), ('reminders', 'company_settings', 'customer_reminder_start_days'),
  ('reminders', 'company_settings', 'customer_reminder_frequency'), ('reminders', 'company_settings', 'vendor_reminder_enabled'),
  ('reminders', 'company_settings', 'vendor_reminder_start_days'), ('reminders', 'company_settings', 'vendor_reminder_frequency'),
  ('reminders', 'company_settings', 'vendor_reminder_roles'),
  ('security', 'company_settings', 'password_min_length'), ('security', 'company_settings', 'password_require_mixed'),
  ('security', 'company_settings', 'temp_password_valid_days'), ('security', 'company_settings', 'idle_logout_minutes');

-- read every section the caller may view
create or replace function public.settings_get(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v jsonb := '{}'; s text; v_row jsonb; v_sec jsonb;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  for s in select distinct section from app.settings_fields loop
    if app.has_permission(p_company_id, 'settings_' || s || '.view') then
      v_sec := jsonb_build_object('can_edit', app.has_permission(p_company_id, 'settings_' || s || '.edit'));
      for v_row in
        select to_jsonb(c) from public.companies c where c.id = p_company_id
        union all select to_jsonb(cs) from public.company_settings cs where cs.company_id = p_company_id
        union all select to_jsonb(b) from public.company_branding b where b.company_id = p_company_id
      loop
        v_sec := v_sec || coalesce((select jsonb_object_agg(f.column_name, v_row -> f.column_name)
                                    from app.settings_fields f where f.section = s and v_row ? f.column_name), '{}');
      end loop;
      v := v || jsonb_build_object(s, v_sec);
    end if;
  end loop;
  return v;
end;
$$;

-- save one section: only its columns, only with its edit right, audited
create or replace function public.settings_save(p_company_id uuid, p_section text, p_payload jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare t text; v_cols text; v_bad text;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  if not exists (select 1 from app.settings_fields where section = p_section) then
    raise exception 'Unknown settings section %', p_section using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_' || p_section || '.edit');
  select k into v_bad from jsonb_object_keys(p_payload) k
  where not exists (select 1 from app.settings_fields f where f.section = p_section and f.column_name = k) limit 1;
  if v_bad is not null then
    raise exception 'Field % does not belong to the % settings', v_bad, p_section using errcode = 'P0001';
  end if;
  -- section specific checks
  if p_section = 'branding' then
    if p_payload ? 'logo_path' and p_payload->>'logo_path' is not null and split_part(p_payload->>'logo_path', '/', 1) <> p_company_id::text then
      raise exception 'Logo must be uploaded into the company folder' using errcode = 'P0001';
    end if;
    if p_payload ? 'favicon_path' and p_payload->>'favicon_path' is not null and split_part(p_payload->>'favicon_path', '/', 1) <> p_company_id::text then
      raise exception 'Favicon must be uploaded into the company folder' using errcode = 'P0001';
    end if;
  end if;
  for t in select distinct table_name from app.settings_fields where section = p_section loop
    select string_agg(format('%I = r.%I', f.column_name, f.column_name), ', ') into v_cols
    from app.settings_fields f where f.section = p_section and f.table_name = t and p_payload ? f.column_name;
    continue when v_cols is null;
    if t = 'company_settings' then
      execute format('update public.company_settings x set %s from jsonb_populate_record(null::public.company_settings, $1) r '
                     || 'where x.company_id = $2', v_cols) using p_payload, p_company_id;
    elsif t = 'company_branding' then
      insert into public.company_branding (company_id) values (p_company_id) on conflict do nothing;
      execute format('update public.company_branding x set %s '
                     || 'from jsonb_populate_record(null::public.company_branding, $1) r where x.company_id = $2', v_cols)
        using p_payload, p_company_id;
    else
      execute format('update public.companies x set %s from jsonb_populate_record(null::public.companies, $1) r '
                     || 'where x.id = $2', v_cols) using p_payload, p_company_id;
    end if;
  end loop;
end;
$$;

-- Section rights are enforced on the tables themselves: every changed column
-- needs the edit right of its section (also for direct API updates), and the
-- change is audited. Users without any settings edit right are filtered by RLS.
create or replace function app.has_any_settings_edit(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (select 1 from (select distinct section from app.settings_fields) s
                 where app.has_permission(p_company_id, 'settings_' || s.section || '.edit'))
$$;

create or replace function app.tg_settings_section_guard()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_company uuid; v_old jsonb := to_jsonb(old); v_new jsonb := to_jsonb(new); k text; v_section text;
        v_changed text[] := '{}'; v_sections text[] := '{}';
begin
  v_company := case tg_table_name when 'companies' then (v_new->>'id')::uuid else (v_new->>'company_id')::uuid end;
  for k in select jsonb_object_keys(v_new) loop
    continue when k in ('updated_at', 'updated_by');
    continue when (v_old -> k) is not distinct from (v_new -> k);
    v_changed := v_changed || k;
    select section into v_section from app.settings_fields where table_name = tg_table_name and column_name = k;
    if v_section is null then
      -- columns outside the sections (codes, status, ids): only the system may change them
      if auth.uid() is not null and not app.is_trusted_caller() then
        raise exception 'Field % cannot be changed here', k using errcode = '42501';
      end if;
    else
      if auth.uid() is not null and not app.is_trusted_caller()
         and not app.has_permission(v_company, 'settings_' || v_section || '.edit') then
        raise exception 'Permission denied: settings_%.edit is required to change %', v_section, k using errcode = '42501';
      end if;
      if not v_section = any (v_sections) then v_sections := v_sections || v_section; end if;
    end if;
  end loop;
  if tg_table_name = 'companies' and v_new->>'books_locked_until' is distinct from v_old->>'books_locked_until'
     and (v_new->>'books_locked_until')::date < (v_old->>'books_locked_until')::date
     and auth.uid() is not null and not app.is_owner(auth.uid(), v_company) then
    raise exception 'Only the owner can re-open locked books' using errcode = '42501';
  end if;
  if cardinality(v_changed) > 0 then
    perform app.audit(v_company, tg_table_name, v_company::text, 'SETTINGS',
                      (select jsonb_object_agg(c, v_old -> c) from unnest(v_changed) c),
                      (select jsonb_object_agg(c, v_new -> c) from unnest(v_changed) c) || jsonb_build_object('sections', v_sections));
  end if;
  if tg_table_name = 'company_branding' then
    new.updated_at := now(); new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger companies_settings_guard before update on public.companies
  for each row execute function app.tg_settings_section_guard();
create trigger company_settings_section_guard before update on public.company_settings
  for each row execute function app.tg_settings_section_guard();
create trigger company_branding_section_guard before update on public.company_branding
  for each row execute function app.tg_settings_section_guard();
revoke all on function app.tg_settings_section_guard() from public, anon, authenticated;
grant execute on function app.has_any_settings_edit(uuid) to authenticated, service_role;

drop policy if exists companies_update on public.companies;
drop policy if exists company_settings_update on public.company_settings;
create policy companies_update on public.companies for update to authenticated
  using (app.has_any_settings_edit(id)) with check (app.has_any_settings_edit(id));
create policy company_settings_update on public.company_settings for update to authenticated
  using (app.has_any_settings_edit(company_id)) with check (app.has_any_settings_edit(company_id));
create policy company_branding_update on public.company_branding for update to authenticated
  using (app.has_any_settings_edit(company_id)) with check (app.has_any_settings_edit(company_id));
grant update on public.company_branding to authenticated;

-- remaining permission checks of the umbrella right -> section rights
drop policy app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (app.has_permission(company_id, 'settings_inventory.edit'))
  with check (app.has_permission(company_id, 'settings_inventory.edit'));
drop policy approval_policies_write on public.approval_policies;
create policy approval_policies_write on public.approval_policies for all to authenticated
  using (app.has_permission(company_id, 'settings_approvals.edit'))
  with check (app.has_permission(company_id, 'settings_approvals.edit'));
drop policy document_sequences_write on public.document_sequences;
create policy document_sequences_write on public.document_sequences for all to authenticated
  using (app.has_permission(company_id, 'settings_numbering.edit'))
  with check (app.has_permission(company_id, 'settings_numbering.edit'));
do $$
declare f record; v_def text;
begin
  for f in select * from (values ('app.tg_godown_negative_guard', 'settings_inventory.edit'),
                                 ('public.custom_field_save', 'settings_custom_fields.edit'),
                                 ('public.run_payment_reminders', 'settings_reminders.edit')) x(fn, perm) loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = f.fn::regproc;
    v_def := replace(v_def, '''settings.edit''', quote_literal(f.perm));
    execute v_def;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Branding files: private bucket company-assets (<company>/<file>)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('company-assets', 'company-assets', false, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'])
    on conflict (id) do nothing;
    execute $p$create policy company_assets_read on storage.objects for select to authenticated
              using (bucket_id = 'company-assets'
                     and (app.is_member(app.try_uuid(split_part(name, '/', 1)))
                          or exists (select 1 from public.portal_users pu where pu.user_id = auth.uid() and pu.is_active
                                     and pu.company_id = app.try_uuid(split_part(name, '/', 1)))))$p$;
    execute $p$create policy company_assets_insert on storage.objects for insert to authenticated
              with check (bucket_id = 'company-assets'
                          and app.has_permission(app.try_uuid(split_part(name, '/', 1)), 'settings_branding.edit'))$p$;
    execute $p$create policy company_assets_update on storage.objects for update to authenticated
              using (bucket_id = 'company-assets'
                     and app.has_permission(app.try_uuid(split_part(name, '/', 1)), 'settings_branding.edit'))$p$;
    execute $p$create policy company_assets_delete on storage.objects for delete to authenticated
              using (bucket_id = 'company-assets'
                     and app.has_permission(app.try_uuid(split_part(name, '/', 1)), 'settings_branding.edit'))$p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Security: an expired temporary password cannot be turned into a real one
-- (the database refuses the password change); the app shows why
-- -----------------------------------------------------------------------------
create or replace function app.temp_password_expired(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(p.must_change_password, false) and p.password_changed_at is not null
     and p.password_changed_at < now() - make_interval(days => coalesce(
           (select min(s.temp_password_valid_days) from public.company_settings s
            where s.company_id in (select company_id from public.user_roles where user_id = p_user
                                   union select company_id from public.portal_users where user_id = p_user)), 7))
  from public.profiles p where p.id = p_user
$$;

create or replace function app.tg_auth_password_changed()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    -- a new admin reset is always allowed (pending window); a user change from an expired temporary password is not
    if not exists (select 1 from public.profiles where id = new.id and password_reset_pending_until > now())
       and app.temp_password_expired(new.id) then
      raise exception 'The temporary password has expired. Ask your administrator for a new one.' using errcode = '42501';
    end if;
    update public.profiles
       set must_change_password = coalesce(password_reset_pending_until > now(), false),
           password_reset_pending_until = null,
           password_changed_at = now()
     where id = new.id;
  end if;
  return new;
end;
$$;

-- strictest password policy over the user's companies (used by the admin-users function)
create or replace function public.password_policy()
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'min_length', coalesce(max(s.password_min_length), 10),
    'require_mixed', coalesce(bool_or(s.password_require_mixed), true))
  from public.company_settings s
  where s.company_id in (select company_id from public.user_roles where user_id = auth.uid()
                         union select company_id from public.portal_users where user_id = auth.uid())
$$;

-- login overview (Security section)
create or replace function public.login_overview(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_security.view');
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object(
                'user_id', u.id, 'email', u.email, 'full_name', pr.full_name, 'last_sign_in_at', u.last_sign_in_at,
                'must_change_password', pr.must_change_password, 'temp_password_expired', app.temp_password_expired(u.id),
                'status', coalesce(cu.status, 'ACTIVE'), 'kind', 'INTERNAL') order by u.last_sign_in_at desc nulls last)
              from auth.users u
              join public.profiles pr on pr.id = u.id
              left join public.company_users cu on cu.company_id = p_company_id and cu.user_id = u.id
              where exists (select 1 from public.user_roles ur where ur.company_id = p_company_id and ur.user_id = u.id)), '[]'),
    'recent_logins', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
                select jsonb_build_object('at', a.at, 'user_id', a.actor_id,
                                          'email', (select email from auth.users where id = a.actor_id),
                                          'request_meta', to_jsonb(a) -> 'request_meta') x
                from public.audit_log a
                where a.company_id = p_company_id and a.action = 'LOGIN'
                order by a.at desc limit 100) s), '[]'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Session bootstrap: + branding, disabled modules, idle sign-out, expired
-- temporary password
-- -----------------------------------------------------------------------------
create or replace function app.branding_json(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce((select to_jsonb(b) - 'company_id' - 'updated_by' from public.company_branding b where b.company_id = p_company_id), '{}')
$$;

create or replace function public.session_bootstrap()
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_email text := app.auth_email(); i public.user_invitations;
  v_last timestamptz; v_seen timestamptz; v_must boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into public.profiles (id, full_name) values (v_uid, coalesce(split_part(v_email, '@', 1), ''))
  on conflict (id) do nothing;

  if v_email is not null then
    for i in select * from public.user_invitations
             where lower(email) = v_email and claimed_at is null and revoked_at is null for update loop
      perform set_config('app.claiming_invitation', v_uid::text, true);
      insert into public.user_roles (user_id, company_id, role_id) values (v_uid, i.company_id, i.role_id)
      on conflict do nothing;
      perform set_config('app.claiming_invitation', '', true);
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

  select last_sign_in_at into v_last from auth.users where id = v_uid;
  select last_login_seen_at, must_change_password into v_seen, v_must from public.profiles where id = v_uid;
  if v_last is not null and v_last is distinct from v_seen then
    update public.profiles set last_login_seen_at = v_last where id = v_uid;
    perform app.audit(c.company_id, 'users', v_uid::text, 'LOGIN', null, jsonb_build_object('at', v_last))
    from (select distinct company_id from public.user_roles where user_id = v_uid
          union select company_id from public.portal_users where user_id = v_uid) c;
  end if;

  return jsonb_build_object(
    'user_id', v_uid, 'email', v_email,
    'full_name', (select full_name from public.profiles where id = v_uid),
    'must_change_password', coalesce(v_must, false),
    'temp_password_expired', app.temp_password_expired(v_uid),
    'password_policy', public.password_policy(),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(c.trade_name, c.legal_name),
                                                                'code', c.code, 'roles', x.roles,
                                                                'branding', app.branding_json(c.id),
                                                                'idle_logout_minutes', (select idle_logout_minutes from public.company_settings where company_id = c.id),
                                                                'disabled_modules', coalesce((select jsonb_agg(module_code) from public.company_modules
                                                                                              where company_id = c.id and not is_enabled), '[]'))
                                                    order by c.legal_name)
                           from (select ur.company_id, jsonb_agg(r.code order by r.code) as roles
                                 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                 where ur.user_id = v_uid
                                   and not exists (select 1 from public.company_users cu where cu.company_id = ur.company_id
                                                   and cu.user_id = v_uid and cu.status <> 'ACTIVE')
                                 group by ur.company_id) x
                           join public.companies c on c.id = x.company_id), '[]'),
    'portals', coalesce((select jsonb_agg(jsonb_build_object('company_id', pu.company_id,
                                                              'company_name', app.company_name(pu.company_id),
                                                              'kind', pu.kind, 'party_id', pu.party_id, 'party_name', p.name,
                                                              'branding', app.branding_json(pu.company_id),
                                                              'enabled', case pu.kind when 'CUSTOMER' then s.customer_portal_enabled
                                                                                       else s.vendor_portal_enabled end
                                                                         and app.module_enabled(pu.company_id,
                                                                               case pu.kind when 'CUSTOMER' then 'CUSTOMER_PORTAL' else 'VENDOR_PORTAL' end)))
                         from public.portal_users pu
                         join public.parties p on p.id = pu.party_id
                         join public.company_settings s on s.company_id = pu.company_id
                         where pu.user_id = v_uid and pu.is_active and p.is_active), '[]'));
end;
$$;

-- PO print carries the purchase terms and the document footer (worker PDF)
create or replace function app.po_print_extras(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object('purchase_terms', (select purchase_terms from public.company_settings where company_id = p_company_id),
                            'branding', app.branding_json(p_company_id))
$$;
do $$
declare v_def text;
begin
  select pg_get_functiondef('app.purchase_order_print_data'::regproc) into v_def;
  if position('po_print_extras' in v_def) = 0 then
    v_def := replace(v_def, E'\n  from public.purchase_orders o\n', E' || app.po_print_extras(o.company_id)\n  from public.purchase_orders o\n');
    if position('po_print_extras' in v_def) = 0 then
      raise exception 'purchase_order_print_data has an unexpected shape';
    end if;
    execute v_def;
  end if;
end $$;

-- new companies get their branding row
create or replace function app.tg_company_branding_row()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.company_branding (company_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
create trigger companies_branding_row after insert on public.companies
  for each row execute function app.tg_company_branding_row();

revoke all on function public.settings_get(uuid), public.settings_save(uuid, text, jsonb), public.login_overview(uuid),
                       public.password_policy() from public, anon;
grant execute on function public.settings_get(uuid), public.settings_save(uuid, text, jsonb), public.login_overview(uuid),
                          public.password_policy() to authenticated, service_role;
grant execute on function app.temp_password_expired(uuid), app.branding_json(uuid) to authenticated, service_role;
revoke all on function app.tg_company_branding_row() from public, anon, authenticated;
