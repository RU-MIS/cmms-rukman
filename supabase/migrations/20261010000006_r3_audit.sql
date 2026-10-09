-- =============================================================================
-- PLATFORM R3 (6/10) — audit log (W4, D4)
--   * request metadata (IP / user agent / session as reported by the API gateway)
--   * central redaction: passwords, tokens, secrets, keys never reach the table
--   * scope keys per row (godowns, parties, items) derived when the row is
--     written (lines from their header); restrictive RLS applies the auditor's
--     godown / customer / vendor / item scope; OWNER unrestricted
--   * old / new values are not directly readable: audit_search / audit_export
--     (invoker, so the policies apply) return them masked per W13 rights;
--     OWNER sees them unmasked
--   * coverage registry + triggers for the tables that were not audited
-- =============================================================================

alter table public.audit_log
  add column request_meta jsonb,
  add column scope_godowns uuid[],
  add column scope_parties uuid[],
  add column scope_items   uuid[];
create index if not exists audit_log_company_at_idx on public.audit_log (company_id, at desc, id desc);
create index if not exists audit_log_company_actor_idx on public.audit_log (company_id, actor_id, at desc);
create index if not exists audit_log_company_table_idx on public.audit_log (company_id, table_name, at desc);
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id);

-- -----------------------------------------------------------------------------
-- Redaction (recursive, by key name)
-- -----------------------------------------------------------------------------
create or replace function app.audit_redact(p jsonb)
returns jsonb
language sql immutable
as $$
  select case jsonb_typeof(p)
    when 'object' then coalesce((select jsonb_object_agg(k, case when k ~* '(password|passwd|pwd|secret|token|otp|api[_-]?key|service[_-]?role|smtp|encrypted|credential|private[_-]?key|jwt)'
                                                            then to_jsonb('[REDACTED]'::text) else app.audit_redact(v) end)
                                 from jsonb_each(p) e(k, v)), '{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(app.audit_redact(v)) from jsonb_array_elements(p) a(v)), '[]'::jsonb)
    else p end
$$;

-- request metadata from the PostgREST request headers / JWT
create or replace function app.request_meta()
returns jsonb
language plpgsql stable
as $$
declare h jsonb; c jsonb; v jsonb;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  begin c := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then c := null; end;
  if h is null and c is null then return null; end if;
  v := jsonb_strip_nulls(jsonb_build_object(
         'ip', coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), h->>'x-real-ip'),
         'user_agent', left(h->>'user-agent', 300),
         'session_id', c->>'session_id'));
  return nullif(v, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Scope keys of an audited row
-- -----------------------------------------------------------------------------
create or replace function app.audit_scope_keys(p_table text, p_row_id text, p_data jsonb,
                                                out godowns uuid[], out parties uuid[], out items uuid[])
returns record
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_data jsonb := p_data; d app.doc_types; v_hdr jsonb; c text; r record;
begin
  -- the data of the row itself (fetched when the caller audited only an action)
  if v_data is null and p_row_id ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from pg_attribute where attrelid = to_regclass('public.' || quote_ident(p_table)) and attname = 'id' and not attisdropped) then
    begin
      execute format('select to_jsonb(x) from public.%I x where x.id = $1::uuid', p_table) into v_data using p_row_id;
    exception when others then v_data := null;
    end;
  end if;
  if v_data is null then return; end if;
  -- lines: godown / party from the header
  select * into d from app.doc_types where line_table = p_table;
  if d.doc_type is not null and v_data ? d.line_fk then
    execute format('select to_jsonb(h) from public.%I h where h.id = $1::uuid', d.table_name) into v_hdr using v_data->>d.line_fk;
  end if;
  v_data := coalesce(v_hdr, '{}'::jsonb) || v_data;
  if p_table = 'godowns' then godowns := array[(v_data->>'id')::uuid]; end if;
  for r in select columns from app.godown_scoped_tables where table_name in (p_table, d.table_name) loop
    foreach c in array r.columns loop
      if v_data->>c is not null then godowns := array_append(godowns, (v_data->>c)::uuid); end if;
    end loop;
  end loop;
  for r in select dimension, columns from app.data_scope_registry where table_name in (p_table, d.table_name) loop
    foreach c in array r.columns loop
      continue when v_data->>c is null or (v_data->>c) !~ '^[0-9a-f-]{36}$';
      if r.dimension = 'ITEM' then items := array_append(items, (v_data->>c)::uuid);
      else parties := array_append(parties, (v_data->>c)::uuid); end if;
    end loop;
  end loop;
  if v_data->>'item_id' is not null and (v_data->>'item_id') ~ '^[0-9a-f-]{36}$' and not ((v_data->>'item_id')::uuid = any (coalesce(items, '{}'))) then
    items := array_append(items, (v_data->>'item_id')::uuid);
  end if;
  if v_data->>'party_id' is not null and (v_data->>'party_id') ~ '^[0-9a-f-]{36}$' and not ((v_data->>'party_id')::uuid = any (coalesce(parties, '{}'))) then
    parties := array_append(parties, (v_data->>'party_id')::uuid);
  end if;
  godowns := (select array_agg(distinct x) from unnest(godowns) x);
  parties := (select array_agg(distinct x) from unnest(parties) x);
  items := (select array_agg(distinct x) from unnest(items) x);
end;
$$;

create or replace function app.audit(p_company_id uuid, p_table text, p_row_id text, p_action text, p_old jsonb, p_new jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare k record;
begin
  select * into k from app.audit_scope_keys(p_table, p_row_id, coalesce(p_new, p_old));
  insert into public.audit_log (company_id, table_name, row_id, action, old_data, new_data, actor_id, request_meta,
                                scope_godowns, scope_parties, scope_items)
  values (p_company_id, p_table, p_row_id, p_action, app.audit_redact(p_old), app.audit_redact(p_new), auth.uid(), app.request_meta(),
          k.godowns, k.parties, k.items);
end;
$$;

-- existing rows: scope keys from their stored data (no redaction needed: R1 already never stored secrets; done anyway)
do $$
declare v_trg text;
begin
  for v_trg in select tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where t.tgrelid = 'public.audit_log'::regclass and not t.tgisinternal and p.proname = 'tg_block_mutation' loop
    execute format('alter table public.audit_log disable trigger %I', v_trg);
  end loop;
  update public.audit_log a set (scope_godowns, scope_parties, scope_items) =
           (select k.godowns, k.parties, k.items from app.audit_scope_keys(a.table_name, a.row_id, coalesce(a.new_data, a.old_data)) k),
         old_data = app.audit_redact(a.old_data), new_data = app.audit_redact(a.new_data);
  for v_trg in select tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where t.tgrelid = 'public.audit_log'::regclass and not t.tgisinternal and p.proname = 'tg_block_mutation' loop
    execute format('alter table public.audit_log enable trigger %I', v_trg);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Access: audit.view, company, and the auditor's data scope (OWNER: all)
-- -----------------------------------------------------------------------------
drop policy audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (company_id = any ((select app.permitted_company_ids('audit.view'))::uuid[]));
create policy audit_log_godown_scope on public.audit_log as restrictive for select to authenticated
  using (scope_godowns is null or company_id = any ((select app.godown_unrestricted_company_ids())::uuid[])
         or scope_godowns <@ (select app.allowed_godown_ids())::uuid[]);
create policy audit_log_party_scope on public.audit_log as restrictive for select to authenticated
  using (scope_parties is null or company_id = any ((select app.party_unrestricted_company_ids())::uuid[])
         or scope_parties <@ (select app.allowed_party_ids())::uuid[]);
create policy audit_log_item_scope on public.audit_log as restrictive for select to authenticated
  using (scope_items is null or company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[])
         or scope_items <@ (select app.scope_allowed_ids('ITEM'))::uuid[]);

-- old / new only through the masked functions
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_cols from information_schema.columns
  where table_schema = 'public' and table_name = 'audit_log' and column_name not in ('old_data', 'new_data');
  execute 'revoke select on public.audit_log from authenticated';
  execute format('grant select (%s) on public.audit_log to authenticated', v_cols);
end $$;

-- -----------------------------------------------------------------------------
-- Masking of audit values (W13 classes)
-- -----------------------------------------------------------------------------
create or replace function app.audit_field_class(p_table text, p_column text, p_data jsonb)
returns text
language sql stable security definer
set search_path = public, app, secure, pg_temp
as $$
  select case
    when p_column in ('rate', 'old_rate', 'new_rate') and p_table in ('party_item_rates', 'item_rate_history', 'rate_change_requests') then
      case when p_data->>'rate_type' in ('SALE', 'ISSUE') then 'SALE' else 'PURCHASE' end
    when p_table = 'party_opening_balances' and p_column = 'amount' then
      case p_data->>'side' when 'RECEIVABLE' then 'AMOUNT_SALE' else 'AMOUNT_PURCHASE' end
    when p_table = 'journal_entry_lines' and p_column in ('debit', 'credit') then
      case p_data->>'ledger_class' when 'RECEIVABLE' then 'AMOUNT_SALE' when 'PAYABLE' then 'AMOUNT_PURCHASE' else 'PROFIT' end
    else (select case s.class
                   when 'MOVEMENT' then secure.movement_class(p_data->>'movement_type', (p_data->>'direction')::smallint)
                   when 'AMOUNT_SIDE' then case coalesce(p_data->>'party_side', case p_data->>'side' when 'CUSTOMER' then 'RECEIVABLE'
                                                                                    when 'VENDOR' then 'PAYABLE' end)
                                             when 'RECEIVABLE' then 'AMOUNT_SALE' when 'PAYABLE' then 'AMOUNT_PURCHASE' else 'PROFIT' end
                   when 'ROW_LEVEL' then 'PROFIT'
                   else s.class end
          from secure.sensitive_columns s where s.table_name = p_table and s.column_name = p_column)
  end
$$;

create or replace function app.audit_mask(p_company_id uuid, p_table text, p_data jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare k text; v_class text; v jsonb := p_data;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or app.is_owner(auth.uid(), p_company_id) then
    return p_data;
  end if;
  for k in select jsonb_object_keys(p_data) loop
    v_class := app.audit_field_class(p_table, k, p_data);
    if v_class is not null and not secure.class_ok(p_company_id, v_class) then
      v := jsonb_set(v, array[k], to_jsonb('•••'::text));
    end if;
  end loop;
  -- margin / cost summaries inside nested objects are not stored by the audit; lines of documents are masked by their own table
  return v;
end;
$$;

-- values of one visible audit row (called by the invoker search after RLS)
create or replace function app.audit_values(p_id bigint)
returns table (old_data jsonb, new_data jsonb)
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select app.audit_mask(a.company_id, a.table_name, a.old_data), app.audit_mask(a.company_id, a.table_name, a.new_data)
  from public.audit_log a where a.id = p_id
$$;

create or replace function public.audit_search(p_company_id uuid, p_filters jsonb default '{}'::jsonb,
                                               p_limit integer default 50, p_before_id bigint default null)
returns jsonb
language plpgsql stable
set search_path = public, app, pg_temp
as $$
declare v jsonb;
begin
  -- invoker: audit_log policies (audit.view, company, scope keys) decide the rows
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'table_name', a.table_name, 'row_id', a.row_id, 'action', a.action,
                                               'actor_id', a.actor_id, 'actor', app.user_email(a.actor_id), 'request_meta', a.request_meta,
                                               'old_data', x.old_data, 'new_data', x.new_data) order by a.at desc, a.id desc), '[]')
    into v
  from (select a.id, a.at, a.table_name, a.row_id, a.action, a.actor_id, a.request_meta from public.audit_log a
        where a.company_id = p_company_id
          and (p_before_id is null or a.id < p_before_id)
          and (p_filters->>'from' is null or a.at >= (p_filters->>'from')::date)
          and (p_filters->>'to' is null or a.at < (p_filters->>'to')::date + 1)
          and (p_filters->>'actor_id' is null or a.actor_id = (p_filters->>'actor_id')::uuid)
          and (p_filters->>'table_name' is null or a.table_name = p_filters->>'table_name')
          and (p_filters->>'action' is null or a.action = upper(p_filters->>'action'))
          and (p_filters->>'row_id' is null or a.row_id = p_filters->>'row_id')
        order by a.at desc, a.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 500)) a
  cross join lateral app.audit_values(a.id) x;
  return v;
end;
$$;

create or replace function app.user_email(p_user uuid)
returns text
language sql stable security definer
set search_path = public, app, pg_temp
as $$ select email from auth.users where id = p_user $$;

create or replace function public.audit_export(p_company_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path = public, app, pg_temp
as $$
declare v jsonb;
begin
  if not app.has_permission(p_company_id, 'audit.export') then
    raise exception 'Permission denied: audit.export is required' using errcode = '42501';
  end if;
  v := public.audit_search(p_company_id, p_filters, 500, null);
  perform app.log_export(p_company_id, 'AUDIT', jsonb_array_length(v));
  return v;
end;
$$;

-- areas present in the audit (filter list of the viewer)
create or replace function public.audit_tables(p_company_id uuid)
returns text[]
language sql stable
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct table_name order by table_name), '{}') from public.audit_log where company_id = p_company_id
$$;

-- -----------------------------------------------------------------------------
-- Coverage: sensitive tables and how they are audited
-- -----------------------------------------------------------------------------
create table app.audit_coverage (
  table_name text primary key,
  mechanism  text not null check (mechanism in ('TRIGGER', 'RPC', 'GUARD')),
  note       text not null default ''
);
insert into app.audit_coverage values
  ('items', 'TRIGGER', 'tg_audit_row'), ('parties', 'TRIGGER', 'tg_audit_row'), ('party_item_rates', 'TRIGGER', 'tg_audit_row'),
  ('godowns', 'TRIGGER', 'tg_audit_row'), ('storage_locations', 'TRIGGER', 'tg_audit_row'), ('user_roles', 'TRIGGER', 'tg_user_roles_audit'),
  ('company_settings', 'GUARD', 'tg_settings_section_guard'), ('companies', 'GUARD', 'tg_settings_section_guard'),
  ('company_branding', 'GUARD', 'tg_settings_section_guard'), ('document_sequences', 'GUARD', 'tg_sequence_guard'),
  ('party_settings', 'TRIGGER', 'tg_audit_row (R3)'), ('party_addresses', 'TRIGGER', 'tg_audit_row (R3)'),
  ('item_packings', 'TRIGGER', 'tg_audit_row (R3)'), ('item_images', 'RPC', 'item_image_register / delete / set_primary'),
  ('vouchers', 'TRIGGER', 'tg_audit_row (R3) + document framework'),
  ('roles', 'RPC', 'role_save / role_set_permissions / role_set_scope / role_clone / role_delete'),
  ('users', 'RPC', 'user_* RPCs and the admin-users function'),
  ('documents', 'RPC', 'document_register / document_delete / document_set_visibility'),
  ('import_jobs', 'RPC', 'import_commit'), ('export_log', 'RPC', 'app.log_export'),
  ('company_modules', 'RPC', 'module_set'), ('approval_rules', 'RPC', 'approval_rules_save'),
  ('approval_actions', 'RPC', 'doc_submit / approval_approve / approval_reject'),
  ('rate_change_requests', 'RPC', 'rate_change_decide'), ('custom_field_definitions', 'RPC', 'custom_field_save'),
  ('stock_adjustments', 'RPC', 'document framework'), ('portal_users', 'RPC', 'portal_* RPCs');

do $$
declare t text;
begin
  foreach t in array array['party_settings', 'party_addresses', 'item_packings', 'vouchers'] loop
    if not exists (select 1 from pg_trigger tr join pg_proc p on p.oid = tr.tgfoid
                   where tr.tgrelid = ('public.' || t)::regclass and p.proname = 'tg_audit_row') then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.tg_audit_row()',
                     t || '_audit', t);
    end if;
  end loop;
end $$;

-- tg_audit_row needs company_id / id on the row: party children take them from the party
create or replace function app.tg_audit_row()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_row jsonb := to_jsonb(coalesce(new, old)); v_company uuid; v_id text;
begin
  v_company := coalesce((v_row->>'company_id')::uuid,
                        (select p.company_id from public.parties p where p.id = (v_row->>'party_id')::uuid),
                        (select i.company_id from public.items i where i.id = (v_row->>'item_id')::uuid));
  v_id := coalesce(v_row->>'id', v_row->>'party_id');
  if tg_op = 'INSERT' then
    perform app.audit(v_company, tg_table_name, v_id, 'INSERT', null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' - 'updated_by' is distinct from to_jsonb(old) - 'updated_at' - 'updated_by' then
      perform app.audit(v_company, tg_table_name, v_id, 'UPDATE', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform app.audit(v_company, tg_table_name, v_id, 'DELETE', to_jsonb(old), null);
    return old;
  end if;
end;
$$;

revoke all on function app.audit_redact(jsonb), app.request_meta(), app.audit_scope_keys(text, text, jsonb),
                       app.audit_field_class(text, text, jsonb), app.audit_mask(uuid, text, jsonb), app.audit_values(bigint)
  from public, anon;
grant execute on function app.audit_values(bigint), app.audit_mask(uuid, text, jsonb), app.user_email(uuid) to authenticated, service_role;
revoke all on function public.audit_search(uuid, jsonb, integer, bigint), public.audit_export(uuid, jsonb), public.audit_tables(uuid)
  from public, anon;
grant execute on function public.audit_search(uuid, jsonb, integer, bigint), public.audit_export(uuid, jsonb), public.audit_tables(uuid)
  to authenticated, service_role;
grant select on app.audit_coverage to authenticated, service_role;
