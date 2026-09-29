-- =============================================================================
-- 0006 DOCUMENT FRAMEWORK
-- One lifecycle for every business document (TRANSACTION_FLOWS §1):
--
--   doc_save      -> DRAFT (create / edit header + lines)
--   doc_submit    -> PENDING_APPROVAL (if the company requires approval, Q-36)
--                    or posted immediately
--   doc_approve   -> checker approves (maker ≠ checker) and the document posts
--   doc_reject    -> back to DRAFT
--   doc_cancel    -> reversal of stock + journal, status CANCELLED
--
-- Each document type registers its tables and its app.post_<type> /
-- app.cancel_<type> functions in app.doc_types. Posting functions run inside
-- the caller's transaction: any error rolls back everything (spec §34).
-- =============================================================================

create table app.doc_types (
  doc_type      text primary key,          -- e.g. JOB_WORK_RECEIPT
  table_name    text not null,             -- header table in public
  line_table    text,                      -- line table in public
  line_fk       text,                      -- FK column in line table
  perm_prefix   text not null,             -- permissions <prefix>.create/.edit/.approve/.cancel
  is_order      boolean not null default false,   -- orders use public.order_status
  label         text not null
);

-- Columns a client may never set through doc_save.
create or replace function app.protected_columns()
returns text[]
language sql immutable
as $$
  select array['id', 'company_id', 'doc_no', 'status', 'created_at', 'created_by', 'updated_at',
               'updated_by', 'submitted_at', 'submitted_by', 'approved_at', 'approved_by',
               'posted_at', 'posted_by', 'cancelled_at', 'cancelled_by', 'cancel_reason',
               'total_amount', 'has_missing_rate', 'lines']
$$;

create or replace function app.doc_type(p_doc_type text)
returns app.doc_types
language plpgsql stable security definer
set search_path = app, pg_temp
as $$
declare d app.doc_types;
begin
  select * into d from app.doc_types where doc_type = p_doc_type;
  if d.doc_type is null then
    raise exception 'Unknown document type %', p_doc_type using errcode = 'P0001';
  end if;
  return d;
end;
$$;

-- Lock a document header and return its key fields.
-- Row locks use FOR NO KEY UPDATE throughout: inserting a child row takes a
-- FOR KEY SHARE lock on the referenced row (FK check). FOR UPDATE would conflict
-- with that and two users posting against the same PO line would deadlock;
-- FOR NO KEY UPDATE still serialises the posting functions among themselves.
create or replace function app.lock_doc(d app.doc_types, p_id uuid,
                                        out company_id uuid, out status text, out created_by uuid,
                                        out doc_date date)
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  execute format('select company_id, status::text, created_by, doc_date from public.%I where id = $1 for no key update',
                 d.table_name)
    into company_id, status, created_by, doc_date using p_id;
  if company_id is null then
    raise exception '% not found', d.label using errcode = 'P0001';
  end if;
  if not app.is_member(company_id) then
    raise exception '% not found', d.label using errcode = 'P0001';
  end if;
end;
$$;

-- Columns of public.<table> that are present as keys in p_json.
create or replace function app.json_columns(p_table text, p_json jsonb)
returns text
language sql stable
as $$
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table
    and p_json ? column_name
    and is_generated = 'NEVER'
$$;

-- Replace all lines of a document from a jsonb array. Line numbers are
-- assigned in array order; computed columns default to neutral values and are
-- recalculated when the document is posted.
create or replace function app.replace_lines(d app.doc_types, p_header_id uuid, p_lines jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare e jsonb; n int := 0; v_row jsonb; v_cols text;
begin
  if d.line_table is null then return; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '% must have at least one line', d.label using errcode = 'P0001';
  end if;
  execute format('delete from public.%I where %I = $1', d.line_table, d.line_fk) using p_header_id;
  for e in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_row := (e - 'id' - 'base_qty' - 'ordered_base_qty' - 'planned_base_qty' - 'amount' - 'factor_to_base')
             || jsonb_build_object(d.line_fk, p_header_id, 'line_no', n);
    v_cols := app.json_columns(d.line_table, v_row);
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
                   d.line_table, v_cols)
      using v_row;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- doc_save: create (no id) or edit (id) a DRAFT. While PENDING_APPROVAL the
-- approver may still correct it (e.g. Deepak ji corrects the final qty, Q-10).
-- -----------------------------------------------------------------------------
create or replace function public.doc_save(p_doc_type text, p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  d          app.doc_types := app.doc_type(p_doc_type);
  v_id       uuid := nullif(p_payload->>'id', '')::uuid;
  v_company  uuid;
  v_status   text;
  v_created  uuid;
  v_date     date;
  v_hdr      jsonb := p_payload;
  v_cols     text;
  v_rcols    text;
  k          text;
begin
  foreach k in array app.protected_columns() loop
    v_hdr := v_hdr - k;
  end loop;

  if v_id is null then
    v_company := (p_payload->>'company_id')::uuid;
    if v_company is null or not app.is_member(v_company) then
      raise exception 'Unknown company' using errcode = 'P0001';
    end if;
    perform app.require_permission(v_company, d.perm_prefix || '.create');
    v_id := gen_random_uuid();
    v_hdr := v_hdr || jsonb_build_object('id', v_id, 'company_id', v_company, 'status', 'DRAFT');
    v_cols := app.json_columns(d.table_name, v_hdr);
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
                   d.table_name, v_cols)
    using v_hdr;
    perform app.audit(v_company, d.table_name, v_id::text, 'CREATE', null, p_payload);
  else
    select l.company_id, l.status, l.created_by, l.doc_date
      into v_company, v_status, v_created, v_date
    from app.lock_doc(d, v_id) l;
    if v_status = 'DRAFT' then
      perform app.require_permission(v_company, d.perm_prefix || '.edit');
    elsif v_status = 'PENDING_APPROVAL' then
      perform app.require_permission(v_company, d.perm_prefix || '.approve');
    else
      raise exception '% is % and can no longer be edited', d.label, v_status using errcode = 'P0001';
    end if;
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
           string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols, v_rcols
    from information_schema.columns
    where table_schema = 'public' and table_name = d.table_name
      and column_name <> all (app.protected_columns());
    execute format(
      'update public.%1$I as t set (%2$s) = (select %3$s from jsonb_populate_record(t, $2) r) where t.id = $1',
      d.table_name, v_cols, v_rcols)
    using v_id, v_hdr;
    perform app.audit(v_company, d.table_name, v_id::text, 'EDIT', null, p_payload);
  end if;

  if p_payload ? 'lines' then
    perform app.replace_lines(d, v_id, p_payload->'lines');
  end if;
  return v_id;
end;
$$;

create or replace function public.doc_delete_draft(p_doc_type text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types := app.doc_type(p_doc_type); v record;
begin
  select * into v from app.lock_doc(d, p_id);
  if v.status <> 'DRAFT' then
    raise exception 'Only drafts can be deleted; use cancel instead' using errcode = 'P0001';
  end if;
  perform app.require_permission(v.company_id, d.perm_prefix || '.delete');
  if d.line_table is not null then
    execute format('delete from public.%I where %I = $1', d.line_table, d.line_fk) using p_id;
  end if;
  execute format('delete from public.%I where id = $1', d.table_name) using p_id;
  perform app.audit(v.company_id, d.table_name, p_id::text, 'DELETE_DRAFT', null, null);
end;
$$;

-- Runs app.post_<doc_type>(id) and records who posted.
create or replace function app.run_post(d app.doc_types, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_result jsonb;
begin
  execute format('select app.post_%s($1)', lower(d.doc_type)) into v_result using p_id;
  execute format('update public.%I set posted_at = now(), posted_by = auth.uid() where id = $1',
                 d.table_name) using p_id;
  return v_result;
end;
$$;

create or replace function public.doc_submit(p_doc_type text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types := app.doc_type(p_doc_type); v record;
begin
  select * into v from app.lock_doc(d, p_id);
  if v.status <> 'DRAFT' then
    raise exception '% is already %', d.label, v.status using errcode = 'P0001';
  end if;
  perform app.require_permission(v.company_id, d.perm_prefix || '.create');
  perform app.assert_period_open(v.company_id, v.doc_date);
  execute format('update public.%I set submitted_at = now(), submitted_by = auth.uid() where id = $1',
                 d.table_name) using p_id;
  if app.requires_approval(v.company_id, d.doc_type) then
    execute format('update public.%I set status = ''PENDING_APPROVAL'' where id = $1', d.table_name)
      using p_id;
    perform app.audit(v.company_id, d.table_name, p_id::text, 'SUBMIT', null, null);
    return jsonb_build_object('id', p_id, 'status', 'PENDING_APPROVAL', 'warnings', '[]'::jsonb);
  end if;
  return app.run_post(d, p_id);
end;
$$;

create or replace function public.doc_approve(p_doc_type text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types := app.doc_type(p_doc_type); v record;
begin
  select * into v from app.lock_doc(d, p_id);
  if v.status <> 'PENDING_APPROVAL' then
    raise exception '% is not waiting for approval (status %)', d.label, v.status using errcode = 'P0001';
  end if;
  perform app.assert_can_approve(v.company_id, d.doc_type, d.perm_prefix || '.approve', v.created_by);
  execute format('update public.%I set approved_at = now(), approved_by = auth.uid() where id = $1',
                 d.table_name) using p_id;
  perform app.audit(v.company_id, d.table_name, p_id::text, 'APPROVE', null, null);
  return app.run_post(d, p_id);
end;
$$;

create or replace function public.doc_reject(p_doc_type text, p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types := app.doc_type(p_doc_type); v record;
begin
  select * into v from app.lock_doc(d, p_id);
  if v.status <> 'PENDING_APPROVAL' then
    raise exception '% is not waiting for approval', d.label using errcode = 'P0001';
  end if;
  perform app.require_permission(v.company_id, d.perm_prefix || '.approve');
  execute format('update public.%I set status = ''DRAFT'' where id = $1', d.table_name) using p_id;
  perform app.audit(v.company_id, d.table_name, p_id::text, 'REJECT', null,
                    jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.doc_cancel(p_doc_type text, p_id uuid, p_reason text,
                                             p_cancel_date date default current_date)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types := app.doc_type(p_doc_type); v record;
begin
  select * into v from app.lock_doc(d, p_id);
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel' using errcode = 'P0001';
  end if;
  if v.status in ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED') then
    raise exception 'Only posted documents can be cancelled (status %)', v.status using errcode = 'P0001';
  end if;
  perform app.require_permission(v.company_id, d.perm_prefix || '.cancel');
  execute format('select app.cancel_%s($1, $2)', lower(d.doc_type)) using p_id, p_cancel_date;
  execute format('update public.%I set status = ''CANCELLED'', cancelled_at = now(),
                  cancelled_by = auth.uid(), cancel_reason = $2 where id = $1', d.table_name)
    using p_id, p_reason;
  perform app.audit(v.company_id, d.table_name, p_id::text, 'CANCEL', null,
                    jsonb_build_object('reason', p_reason, 'date', p_cancel_date));
  return jsonb_build_object('id', p_id, 'status', 'CANCELLED');
end;
$$;

-- Standard cancellation of a posted document: reverse stock and journal.
create or replace function app.cancel_standard(p_table text, p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.assert_not_allocated(p_table, p_id);
  perform app.reverse_stock(p_table, p_id, p_date);
  perform app.reverse_journal(p_table, p_id, p_date, 'Cancellation');
end;
$$;

-- Hook replaced by the payments migration: a bill that is settled by a
-- payment/receipt allocation cannot be cancelled before un-allocating it.
create or replace function app.assert_not_allocated(p_table text, p_id uuid)
returns void
language plpgsql
as $$ begin return; end $$;

-- Recompute line quantities (factor snapshot + base qty) at posting time.
create or replace function app.normalise_lines(d app.doc_types, p_header_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_has_rate boolean; v_qty_col text;
begin
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = d.line_table and column_name = 'rate')
    into v_has_rate;
  select column_name into v_qty_col from information_schema.columns
   where table_schema = 'public' and table_name = d.line_table
     and column_name in ('base_qty', 'ordered_base_qty', 'planned_base_qty') limit 1;
  execute format(
    'update public.%1$I l set factor_to_base = app.unit_factor(l.item_id, l.unit_id, $2),
                              %3$I = round(l.qty * app.unit_factor(l.item_id, l.unit_id, $2), 3)
     where l.%2$I = $1', d.line_table, d.line_fk, v_qty_col)
  using p_header_id, p_date;
  if v_has_rate and exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = d.line_table and column_name = 'amount') then
    execute format(
      'update public.%1$I l set amount = round(%3$I * coalesce(l.rate, 0), 2) where l.%2$I = $1',
      d.line_table, d.line_fk, v_qty_col)
    using p_header_id;
  end if;
end;
$$;

-- Standard result object returned to the web app.
create or replace function app.result(p_id uuid, p_doc_no text, p_status text, p_warnings text[])
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('id', p_id, 'doc_no', p_doc_no, 'status', p_status,
                            'warnings', to_jsonb(coalesce(p_warnings, '{}'::text[])))
$$;
