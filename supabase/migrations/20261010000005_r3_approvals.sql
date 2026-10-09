-- =============================================================================
-- PLATFORM R3 (5/10) — approval workflows (W3, D2)
--   * approval_rules: up to 3 levels per document type, approver = role or
--     permission, optional amount threshold, self-approval and "same person
--     on two levels" switches, optional e-mail to the approvers
--   * approval_actions: history (submit / approve / reject with reason)
--   * enforced by the database: doc_submit / doc_approve / doc_reject and
--     approval_approve / approval_reject check level, approver, threshold,
--     maker-checker and the approver's data scope (header and lines)
--   * no rule = exactly the previous behaviour (approval_policies on / off,
--     one level with <doc>.approve)
--   * customer POs: configured levels must be approved before the final
--     review (customer_po_approve)
--   * rate changes (company setting): changes by users without rates.approve
--     become rate_change_requests, effective only after approval
-- =============================================================================

create table public.approval_rules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  doc_type            text not null,
  level_no            smallint not null check (level_no between 1 and 3),
  approver_role_id    uuid references public.roles (id) on delete restrict,
  approver_permission text references public.permissions (code),
  min_amount          numeric(16,2) check (min_amount is null or min_amount >= 0),
  allow_self          boolean not null default false,
  allow_same_approver boolean not null default false,
  notify_email        boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (company_id, doc_type, level_no),
  check (approver_role_id is not null or approver_permission is not null)
);
alter table public.approval_rules enable row level security;
create policy approval_rules_read on public.approval_rules for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
grant select on public.approval_rules to authenticated;
grant all on public.approval_rules to service_role;

create table public.approval_actions (
  id         bigserial primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  doc_type   text not null,
  doc_id     uuid not null,
  level_no   smallint,
  decision   text not null check (decision in ('SUBMITTED', 'APPROVED', 'REJECTED')),
  comment    text,
  actor_id   uuid,
  at         timestamptz not null default now()
);
create index approval_actions_doc_idx on public.approval_actions (doc_type, doc_id, id);
alter table public.approval_actions enable row level security;
create policy approval_actions_read on public.approval_actions for select to authenticated
  using (company_id = any ((select app.user_company_ids())::uuid[]));
grant select on public.approval_actions to authenticated;
grant all on public.approval_actions to service_role;
grant usage, select on sequence public.approval_actions_id_seq to service_role;
create trigger approval_actions_immutable before update or delete on public.approval_actions
  for each row execute function app.tg_block_mutation();

-- -----------------------------------------------------------------------------
-- Document facts for approvals: company, creator, status, amount (internal,
-- real values), class of the amount for display
-- -----------------------------------------------------------------------------
create or replace function app.approval_doc(p_doc_type text, p_id uuid,
                                            out company_id uuid, out created_by uuid, out status text, out amount numeric,
                                            out table_name text, out perm_prefix text, out label text, out doc_no text)
returns record
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types;
begin
  if p_doc_type = 'CUSTOMER_PO' then
    select c.company_id, c.created_by, c.status::text, (select coalesce(sum(round(l.base_qty * coalesce(l.quoted_rate, l.reference_rate, 0), 2)), 0)
                                                         from public.customer_po_lines l where l.customer_po_id = c.id),
           'customer_pos', 'customer_po', 'Customer PO', c.po_no
      into company_id, created_by, status, amount, table_name, perm_prefix, label, doc_no
    from public.customer_pos c where c.id = p_id;
    return;
  end if;
  select * into d from app.doc_types where doc_type = p_doc_type;
  if d.doc_type is null then
    raise exception 'Unknown document type %', p_doc_type using errcode = 'P0001';
  end if;
  table_name := d.table_name; perm_prefix := d.perm_prefix; label := d.label;
  execute format('select company_id, created_by, status::text, doc_no from public.%I where id = $1', d.table_name)
    into company_id, created_by, status, doc_no using p_id;
  amount := case p_doc_type
    when 'PURCHASE_ORDER' then (select sum(round(ordered_base_qty * coalesce(rate, 0), 2)) from public.purchase_order_lines where order_id = p_id)
    when 'SALES_ORDER' then (select sum(round(ordered_base_qty * coalesce(rate, 0) / nullif(factor_to_base, 0), 2)) from public.sales_order_lines where order_id = p_id)
    when 'PURCHASE_RECEIPT' then (select total_amount from public.purchase_receipts where id = p_id)
    when 'PURCHASE_RETURN' then (select total_amount from public.purchase_returns where id = p_id)
    when 'SERVICE_BILL' then (select total_amount from public.service_bills where id = p_id)
    when 'JOB_WORK_RECEIPT' then (select total_amount from public.job_work_receipts where id = p_id)
    when 'JOB_WORK_RETURN' then (select total_amount from public.job_work_returns where id = p_id)
    when 'MATERIAL_ISSUE' then (select total_amount from public.material_issues where id = p_id)
    when 'WORKER_EARNING' then (select total_amount from public.worker_earnings where id = p_id)
    when 'CUSTOMER_BILL' then (select b.amount from public.customer_bills b where b.id = p_id)
    when 'SALES_RETURN' then (select credit_amount from public.sales_returns where id = p_id)
    when 'VOUCHER' then (select v.amount from public.vouchers v where v.id = p_id)
    when 'STOCK_ADJUSTMENT' then (select sum(round(base_qty * coalesce(rate, 0), 2)) from public.stock_adjustment_lines where adjustment_id = p_id)
    else 0 end;
  amount := coalesce(amount, 0);
end;
$$;

-- class of a document's amount (what the viewer must hold to see it)
create or replace function app.approval_amount_class(p_doc_type text, p_id uuid)
returns text
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select case
    when p_doc_type in ('SALES_ORDER', 'CUSTOMER_BILL', 'SALES_RETURN', 'MATERIAL_ISSUE', 'CUSTOMER_PO') then 'SALE'
    when p_doc_type in ('PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'SERVICE_BILL', 'JOB_WORK_RECEIPT',
                        'JOB_WORK_RETURN', 'WORKER_EARNING') then 'PURCHASE'
    when p_doc_type = 'STOCK_ADJUSTMENT' then 'LANDED'
    when p_doc_type = 'VOUCHER' then
      (select case v.party_side when 'RECEIVABLE' then 'AMOUNT_SALE' when 'PAYABLE' then 'AMOUNT_PURCHASE' else 'PROFIT' end
       from public.vouchers v where v.id = p_id)
    else null end
$$;

-- applicable levels for an amount; no rule + approval switched on = one default level
create or replace function app.approval_levels(p_company_id uuid, p_doc_type text, p_amount numeric)
returns table (level_no smallint, approver_role_id uuid, approver_permission text, allow_self boolean,
               allow_same_approver boolean, notify_email boolean)
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_prefix text := coalesce((select perm_prefix from app.doc_types where doc_type = p_doc_type),
                                  case p_doc_type when 'CUSTOMER_PO' then 'customer_po' end);
begin
  if exists (select 1 from public.approval_rules r where r.company_id = p_company_id and r.doc_type = p_doc_type and r.is_active) then
    return query
      select r.level_no, r.approver_role_id, coalesce(r.approver_permission, case when r.approver_role_id is null then v_prefix || '.approve' end),
             r.allow_self, r.allow_same_approver, r.notify_email
      from public.approval_rules r
      where r.company_id = p_company_id and r.doc_type = p_doc_type and r.is_active
        and (r.min_amount is null or p_amount >= r.min_amount)
      order by r.level_no;
  elsif p_doc_type <> 'CUSTOMER_PO' and app.requires_approval(p_company_id, p_doc_type) then
    return query
      select 1::smallint, null::uuid, v_prefix || '.approve',
             coalesce((select p.allow_self_approval from public.approval_policies p
                       where p.company_id = p_company_id and p.doc_type = p_doc_type), false),
             false, false;
  end if;
end;
$$;

-- whether a document type needs approval at all (rules or the old switch)
create or replace function app.approval_required(p_company_id uuid, p_doc_type text)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (select 1 from public.approval_rules r where r.company_id = p_company_id and r.doc_type = p_doc_type and r.is_active)
      or (p_doc_type <> 'CUSTOMER_PO' and app.requires_approval(p_company_id, p_doc_type))
$$;

-- state of the current round (since the last submission)
create or replace function app.approval_state(p_doc_type text, p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare d record; v_round bigint; v_levels jsonb; v_done smallint[]; v_next jsonb;
begin
  select * into d from app.approval_doc(p_doc_type, p_id);
  if d.company_id is null then return null; end if;
  select coalesce(max(id), 0) into v_round from public.approval_actions
   where doc_type = p_doc_type and doc_id = p_id and decision = 'SUBMITTED';
  select coalesce(array_agg(distinct level_no), '{}') into v_done from public.approval_actions
   where doc_type = p_doc_type and doc_id = p_id and decision = 'APPROVED' and id > v_round;
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('approved', l.level_no = any (v_done)) order by l.level_no), '[]')
    into v_levels from app.approval_levels(d.company_id, p_doc_type, d.amount) l;
  select x into v_next from jsonb_array_elements(v_levels) x where not (x->>'approved')::boolean
   order by (x->>'level_no')::int limit 1;
  return jsonb_build_object('company_id', d.company_id, 'created_by', d.created_by, 'status', d.status, 'amount', d.amount,
                            'levels', v_levels, 'next_level', v_next, 'complete', v_next is null, 'round', v_round,
                            'table_name', d.table_name, 'label', d.label, 'doc_no', d.doc_no);
end;
$$;

-- the caller's data scope must cover the document (header and lines)
create or replace function app.assert_doc_scope(p_doc_type text, p_id uuid)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types; v_bad boolean;
begin
  if p_doc_type = 'CUSTOMER_PO' then
    perform app.assert_doc_party_scope('customer_pos', p_id);
    if exists (select 1 from public.customer_po_lines l join public.customer_pos c on c.id = l.customer_po_id
               where l.customer_po_id = p_id and not app.scope_allows(c.company_id, 'ITEM', l.item_id)) then
      raise exception 'Access denied: the document contains items outside your data scope' using errcode = '42501';
    end if;
    return;
  end if;
  select * into d from app.doc_types where doc_type = p_doc_type;
  if exists (select 1 from app.godown_scoped_tables where table_name = d.table_name) then
    perform app.assert_doc_godown_scope(d.table_name, p_id);
  end if;
  perform app.assert_doc_party_scope(d.table_name, p_id);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = d.line_table and column_name = 'item_id') then
    execute format('select exists (select 1 from public.%I l join public.%I h on h.id = l.%I where l.%I = $1 and l.item_id is not null
                    and not app.scope_allows(h.company_id, ''ITEM'', l.item_id))', d.line_table, d.table_name, d.line_fk, d.line_fk)
      into v_bad using p_id;
    if v_bad then
      raise exception 'Access denied: the document contains items outside your data scope' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- may the caller act on this level? raises with the reason
create or replace function app.approval_assert_actor(p_doc_type text, p_id uuid, p_state jsonb, p_reject boolean default false)
returns void
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare v_level jsonb := p_state->'next_level'; v_company uuid := (p_state->>'company_id')::uuid; v_role uuid;
begin
  if v_level is null then
    raise exception 'Nothing is waiting for approval' using errcode = 'P0001';
  end if;
  if v_level->>'approver_permission' is not null then
    perform app.require_permission(v_company, v_level->>'approver_permission');
  end if;
  v_role := (v_level->>'approver_role_id')::uuid;
  if v_role is not null and not app.is_owner(auth.uid(), v_company)
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.is_active
                     where ur.user_id = auth.uid() and ur.company_id = v_company and ur.role_id = v_role) then
    raise exception 'Level % must be approved by role %', v_level->>'level_no', (select name from public.roles where id = v_role)
      using errcode = '42501';
  end if;
  -- maker-checker applies to approving; the creator may still withdraw (reject) his own submission, as before
  if not p_reject and not coalesce((v_level->>'allow_self')::boolean, false) and (p_state->>'created_by')::uuid = auth.uid() then
    raise exception 'A document cannot be approved by the user who created it' using errcode = '42501';
  end if;
  if not p_reject and not coalesce((v_level->>'allow_same_approver')::boolean, false)
     and exists (select 1 from public.approval_actions a where a.doc_type = p_doc_type and a.doc_id = p_id
                 and a.decision = 'APPROVED' and a.id > (p_state->>'round')::bigint and a.actor_id = auth.uid()) then
    raise exception 'You have already approved another level of this document' using errcode = '42501';
  end if;
  perform app.assert_doc_scope(p_doc_type, p_id);
end;
$$;

-- e-mail to the approvers of a level (optional per rule)
create or replace function app.approval_notify(p_doc_type text, p_id uuid, p_state jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v_level jsonb := p_state->'next_level'; v_company uuid := (p_state->>'company_id')::uuid; v_to text[];
begin
  if v_level is null or not coalesce((v_level->>'notify_email')::boolean, false) then return; end if;
  select coalesce(array_agg(distinct lower(u.email)), '{}') into v_to
  from public.user_roles ur join auth.users u on u.id = ur.user_id
  where ur.company_id = v_company and u.email is not null and ur.user_id is distinct from auth.uid()
    and ((v_level->>'approver_role_id') is not null and ur.role_id = (v_level->>'approver_role_id')::uuid
         or (v_level->>'approver_role_id') is null and app.user_has_permission(ur.user_id, v_company, v_level->>'approver_permission'));
  perform app.enqueue_email(v_company, 'APPROVAL_REQUEST', null,
                            format('%s %s waits for your approval (level %s)', p_state->>'label', coalesce(p_state->>'doc_no', ''), v_level->>'level_no'),
                            format('%s %s is waiting for approval at level %s. Open the approval inbox in the ERP to approve or reject it.',
                                   p_state->>'label', coalesce(p_state->>'doc_no', ''), v_level->>'level_no'),
                            p_doc_type, p_id, null, '[]'::jsonb, v_to,
                            'approval:' || p_doc_type || ':' || p_id || ':' || (p_state->>'round') || ':' || (v_level->>'level_no'));
end;
$$;

alter table public.email_outbox drop constraint email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('VENDOR_PO', 'VENDOR_DOCUMENT', 'CUSTOMER_INVOICE', 'CUSTOMER_DOCUMENT', 'CUSTOMER_PAYMENT_REMINDER',
                  'VENDOR_PAYMENT_REMINDER', 'APPROVAL_REQUEST'));
do $$
declare v_def text;
begin
  select pg_get_functiondef('app.enqueue_email'::regproc) into v_def;
  v_def := replace(v_def, 'v_internal boolean := p_kind = ''VENDOR_PAYMENT_REMINDER'';',
                   'v_internal boolean := p_kind in (''VENDOR_PAYMENT_REMINDER'', ''APPROVAL_REQUEST'');');
  execute v_def;
  select pg_get_functiondef('app.email_enabled'::regproc) into v_def;
  v_def := replace(v_def, 'when ''VENDOR_PAYMENT_REMINDER'' then s.vendor_payment_reminder_email',
                   'when ''VENDOR_PAYMENT_REMINDER'' then s.vendor_payment_reminder_email
    when ''APPROVAL_REQUEST'' then true');
  v_def := replace(v_def, 'p_kind not in (''VENDOR_PAYMENT_REMINDER'')', 'p_kind not in (''VENDOR_PAYMENT_REMINDER'', ''APPROVAL_REQUEST'')');
  execute v_def;
end $$;

-- -----------------------------------------------------------------------------
-- Document framework: submit / approve / reject with levels
-- -----------------------------------------------------------------------------
create or replace function public.doc_submit(p_doc_type text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types := app.doc_type(p_doc_type); v record; v_state jsonb;
begin
  select * into v from app.lock_doc(d, p_id);
  if v.status <> 'DRAFT' then
    raise exception '% is already %', d.label, v.status using errcode = 'P0001';
  end if;
  perform app.require_permission(v.company_id, d.perm_prefix || '.create');
  perform app.assert_period_open(v.company_id, v.doc_date);
  execute format('update public.%I set submitted_at = now(), submitted_by = auth.uid() where id = $1', d.table_name) using p_id;
  if app.approval_required(v.company_id, d.doc_type) then
    insert into public.approval_actions (company_id, doc_type, doc_id, decision, actor_id)
    values (v.company_id, d.doc_type, p_id, 'SUBMITTED', auth.uid());
    v_state := app.approval_state(d.doc_type, p_id);
    if not (v_state->>'complete')::boolean then
      execute format('update public.%I set status = ''PENDING_APPROVAL'' where id = $1', d.table_name) using p_id;
      perform app.audit(v.company_id, d.table_name, p_id::text, 'SUBMIT', null,
                        jsonb_build_object('next_level', v_state->'next_level'->'level_no'));
      perform app.approval_notify(d.doc_type, p_id, v_state);
      return jsonb_build_object('id', p_id, 'status', 'PENDING_APPROVAL', 'warnings', '[]'::jsonb,
                                'next_level', v_state->'next_level'->'level_no');
    end if;
  end if;
  return app.run_post(d, p_id);
end;
$$;

create or replace function public.doc_approve(p_doc_type text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  return public.approval_approve(p_doc_type, p_id, null);
end;
$$;

create or replace function public.approval_approve(p_doc_type text, p_id uuid, p_comment text default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types; v record; v_state jsonb; v_level smallint; v_cpo public.customer_pos;
begin
  if p_doc_type = 'CUSTOMER_PO' then
    select * into v_cpo from public.customer_pos where id = p_id for no key update;
    if v_cpo.id is null or not app.is_member(v_cpo.company_id) then
      raise exception 'Customer PO not found' using errcode = 'P0001';
    end if;
    if v_cpo.status not in ('SUBMITTED', 'UNDER_REVIEW') then
      raise exception 'Customer PO is % and cannot be approved', v_cpo.status using errcode = 'P0001';
    end if;
  else
    d := app.doc_type(p_doc_type);
    select * into v from app.lock_doc(d, p_id);
    if v.status <> 'PENDING_APPROVAL' then
      raise exception '% is not waiting for approval (status %)', d.label, v.status using errcode = 'P0001';
    end if;
  end if;
  v_state := app.approval_state(p_doc_type, p_id);
  perform app.approval_assert_actor(p_doc_type, p_id, v_state);
  v_level := (v_state->'next_level'->>'level_no')::smallint;
  insert into public.approval_actions (company_id, doc_type, doc_id, level_no, decision, comment, actor_id)
  values ((v_state->>'company_id')::uuid, p_doc_type, p_id, v_level, 'APPROVED', nullif(trim(p_comment), ''), auth.uid());
  perform app.audit((v_state->>'company_id')::uuid, v_state->>'table_name', p_id::text, 'APPROVE', null,
                    jsonb_build_object('level', v_level, 'comment', nullif(trim(p_comment), '')));
  v_state := app.approval_state(p_doc_type, p_id);
  if not (v_state->>'complete')::boolean then
    perform app.approval_notify(p_doc_type, p_id, v_state);
    return jsonb_build_object('id', p_id, 'status', 'PENDING_APPROVAL', 'next_level', v_state->'next_level'->'level_no',
                              'warnings', '[]'::jsonb);
  end if;
  if p_doc_type = 'CUSTOMER_PO' then
    -- all configured levels are done; the final review (prices, conversion) stays customer_po_approve
    return jsonb_build_object('id', p_id, 'status', v_cpo.status, 'levels_complete', true);
  end if;
  execute format('update public.%I set approved_at = now(), approved_by = auth.uid() where id = $1', d.table_name) using p_id;
  return app.run_post(d, p_id);
end;
$$;

create or replace function public.doc_reject(p_doc_type text, p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  perform public.approval_reject(p_doc_type, p_id, p_reason);
end;
$$;

create or replace function public.approval_reject(p_doc_type text, p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare d app.doc_types; v record; v_state jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reject' using errcode = 'P0001';
  end if;
  if p_doc_type = 'CUSTOMER_PO' then
    raise exception 'Use the customer PO review to reject a customer PO' using errcode = 'P0001';
  end if;
  d := app.doc_type(p_doc_type);
  select * into v from app.lock_doc(d, p_id);
  if v.status <> 'PENDING_APPROVAL' then
    raise exception '% is not waiting for approval', d.label using errcode = 'P0001';
  end if;
  v_state := app.approval_state(p_doc_type, p_id);
  perform app.approval_assert_actor(p_doc_type, p_id, v_state, true);
  execute format('update public.%I set status = ''DRAFT'' where id = $1', d.table_name) using p_id;
  insert into public.approval_actions (company_id, doc_type, doc_id, level_no, decision, comment, actor_id)
  values (v.company_id, p_doc_type, p_id, (v_state->'next_level'->>'level_no')::smallint, 'REJECTED', trim(p_reason), auth.uid());
  perform app.audit(v.company_id, d.table_name, p_id::text, 'REJECT', null,
                    jsonb_build_object('reason', trim(p_reason), 'level', v_state->'next_level'->'level_no'));
  return jsonb_build_object('id', p_id, 'status', 'DRAFT');
end;
$$;

-- customer PO: configured pre-approval levels must be complete before the final review
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.customer_po_approve'::regproc) into v_def;
  v_def := replace(v_def, $x$  perform app.require_permission(c.company_id, 'customer_po.approve');$x$,
                   $x$  perform app.require_permission(c.company_id, 'customer_po.approve');
  if exists (select 1 from public.approval_rules r where r.company_id = c.company_id and r.doc_type = 'CUSTOMER_PO' and r.is_active)
     and not (app.approval_state('CUSTOMER_PO', p_id)->>'complete')::boolean then
    raise exception 'The approval levels of this customer PO are not complete yet' using errcode = 'P0001';
  end if;
  perform app.assert_doc_scope('CUSTOMER_PO', p_id);$x$);
  if position('approval_state(''CUSTOMER_PO''' in v_def) = 0 then
    raise exception 'customer_po_approve has an unexpected shape';
  end if;
  execute v_def;
end $$;

-- configuration (Approvals section)
create or replace function public.approval_rules_save(p_company_id uuid, p_doc_type text, p_requires boolean, p_levels jsonb)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare l jsonb; v_old jsonb; i int := 0;
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_approvals.edit');
  if p_doc_type <> 'CUSTOMER_PO' and not exists (select 1 from app.doc_types where doc_type = p_doc_type) then
    raise exception 'Unknown document type %', p_doc_type using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_levels, '[]')) > 3 then
    raise exception 'At most 3 approval levels' using errcode = 'P0001';
  end if;
  select jsonb_build_object('requires', app.approval_required(p_company_id, p_doc_type),
                            'levels', coalesce(jsonb_agg(to_jsonb(r) - 'company_id' order by r.level_no), '[]'))
    into v_old from public.approval_rules r where r.company_id = p_company_id and r.doc_type = p_doc_type;
  delete from public.approval_rules where company_id = p_company_id and doc_type = p_doc_type;
  if p_doc_type <> 'CUSTOMER_PO' then
    insert into public.approval_policies (company_id, doc_type, requires_approval, allow_self_approval)
    values (p_company_id, p_doc_type, coalesce(p_requires, false), false)
    on conflict (company_id, doc_type) do update set requires_approval = excluded.requires_approval;
  end if;
  if coalesce(p_requires, false) then
    for l in select * from jsonb_array_elements(coalesce(p_levels, '[]')) loop
      i := i + 1;
      if l->>'approver_role_id' is not null and not exists (select 1 from public.roles where id = (l->>'approver_role_id')::uuid
                                                            and company_id = p_company_id and kind = 'INTERNAL') then
        raise exception 'Unknown approver role' using errcode = 'P0001';
      end if;
      insert into public.approval_rules (company_id, doc_type, level_no, approver_role_id, approver_permission, min_amount,
                                         allow_self, allow_same_approver, notify_email, created_by, updated_by)
      values (p_company_id, p_doc_type, i, nullif(l->>'approver_role_id', '')::uuid, nullif(l->>'approver_permission', ''),
              nullif(l->>'min_amount', '')::numeric, coalesce((l->>'allow_self')::boolean, false),
              coalesce((l->>'allow_same_approver')::boolean, false), coalesce((l->>'notify_email')::boolean, false),
              auth.uid(), auth.uid());
    end loop;
  end if;
  perform app.audit(p_company_id, 'approval_rules', p_doc_type, 'APPROVAL_RULES', v_old,
                    jsonb_build_object('requires', p_requires, 'levels', p_levels));
end;
$$;

create or replace function public.approval_config(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(p_company_id) then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;
  perform app.require_permission(p_company_id, 'settings_approvals.view');
  return coalesce((select jsonb_agg(jsonb_build_object(
            'doc_type', t.doc_type, 'label', t.label, 'requires', app.approval_required(p_company_id, t.doc_type),
            'levels', coalesce((select jsonb_agg(to_jsonb(r) - 'company_id' order by r.level_no) from public.approval_rules r
                                where r.company_id = p_company_id and r.doc_type = t.doc_type), '[]')) order by t.label)
          from (select doc_type, label from app.doc_types union all select 'CUSTOMER_PO', 'Customer PO (pre-approval levels)') t), '[]');
end;
$$;

-- -----------------------------------------------------------------------------
-- Approval inbox (invoker: the document tables' RLS and scopes apply)
-- -----------------------------------------------------------------------------
create or replace function public.approval_inbox(p_company_id uuid)
returns jsonb
language plpgsql stable
set search_path = public, app, pg_temp
as $$
declare d record; v jsonb := '[]'; v_rows jsonb;
begin
  for d in select doc_type, table_name, label from app.doc_types loop
    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object('doc_type', %L, 'label', %L, 'id', h.id, 'doc_no', h.doc_no, 'doc_date', h.doc_date,
                                                   'created_by', h.created_by, 'state', s.state,
                                                   'amount', app.approval_amount_visible(%L, h.id))
                                order by h.doc_date, h.doc_no), '[]')
      from public.%I h
      cross join lateral (select app.approval_state(%L, h.id) as state) s
      where h.company_id = $1 and h.status = 'PENDING_APPROVAL' and app.approval_can_act(%L, h.id, s.state)$q$,
      d.doc_type, d.label, d.doc_type, d.table_name, d.doc_type, d.doc_type) into v_rows using p_company_id;
    v := v || v_rows;
  end loop;
  select v || coalesce(jsonb_agg(jsonb_build_object('doc_type', 'CUSTOMER_PO', 'label', 'Customer PO', 'id', c.id, 'doc_no', c.po_no,
                                                    'doc_date', c.po_date, 'created_by', c.created_by, 'state', s.state,
                                                    'amount', app.approval_amount_visible('CUSTOMER_PO', c.id))), '[]')
    into v
  from public.customer_pos c
  cross join lateral (select app.approval_state('CUSTOMER_PO', c.id) as state) s
  where c.company_id = p_company_id and c.status in ('SUBMITTED', 'UNDER_REVIEW')
    and exists (select 1 from public.approval_rules r where r.company_id = c.company_id and r.doc_type = 'CUSTOMER_PO' and r.is_active)
    and app.approval_can_act('CUSTOMER_PO', c.id, s.state);
  return v;
end;
$$;

-- non-raising version of approval_assert_actor (inbox)
create or replace function app.approval_can_act(p_doc_type text, p_id uuid, p_state jsonb)
returns boolean
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.approval_assert_actor(p_doc_type, p_id, p_state);
  return true;
exception when others then
  return false;
end;
$$;

create or replace function app.approval_amount_visible(p_doc_type text, p_id uuid)
returns numeric
language plpgsql stable security definer
set search_path = public, app, pg_temp
as $$
declare d record; v_class text;
begin
  select * into d from app.approval_doc(p_doc_type, p_id);
  v_class := app.approval_amount_class(p_doc_type, p_id);
  if v_class is null or not secure.class_ok(d.company_id, v_class) then return null; end if;
  return d.amount;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rate-change approval (company setting rate_change_approval)
-- -----------------------------------------------------------------------------
create table public.rate_change_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  kind           text not null check (kind in ('ITEM_PRICE', 'PARTY_RATE')),
  item_id        uuid not null references public.items (id) on delete cascade,
  party_id       uuid references public.parties (id) on delete cascade,
  rate_type      text not null,
  old_rate       numeric(14,4),
  new_rate       numeric(14,4),
  effective_from date,
  status         text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by   uuid,
  requested_at   timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  reason         text
);
create index rate_change_requests_company_idx on public.rate_change_requests (company_id, status);
alter table public.rate_change_requests enable row level security;
-- rows follow the field rights of their rate type and the item / party scope
create policy rate_change_requests_read on public.rate_change_requests for select to authenticated
  using (case when rate_type in ('SALE', 'ISSUE') then company_id = any ((select secure.allowed('SALE'))::uuid[])
              else company_id = any ((select secure.allowed('PURCHASE'))::uuid[]) end
         and (company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[])
              or item_id = any ((select app.scope_allowed_ids('ITEM'))::uuid[]))
         and (party_id is null or company_id = any ((select app.party_unrestricted_company_ids())::uuid[])
              or party_id = any ((select app.allowed_party_ids())::uuid[])));
grant select on public.rate_change_requests to authenticated;
grant all on public.rate_change_requests to service_role;
insert into app.data_scope_registry (table_name, dimension, columns, read_any, guard_writes) values
  ('rate_change_requests', 'ITEM', '{item_id}', false, false),
  ('rate_change_requests', 'PARTY', '{party_id}', false, false)
on conflict do nothing;
create policy rate_change_requests_item_scope on public.rate_change_requests as restrictive for select to authenticated
  using ((company_id = any ((select app.scope_unrestricted_company_ids('ITEM'))::uuid[])) or (item_id = any ((select app.scope_allowed_ids('ITEM'))::uuid[])));
create policy rate_change_requests_party_scope on public.rate_change_requests as restrictive for select to authenticated
  using ((party_id is null) or (company_id = any ((select app.party_unrestricted_company_ids())::uuid[]))
         or (party_id = any ((select app.allowed_party_ids())::uuid[])));

alter table public.item_rate_history add column requested_by uuid, add column approved_by uuid;

create or replace function app.rate_approval_needed(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select coalesce((select rate_change_approval from public.company_settings where company_id = p_company_id), false)
     and auth.uid() is not null and not app.is_trusted_caller()
     and current_setting('app.applying_rate_request', true) is distinct from 'on'
     and not app.has_permission(p_company_id, 'rates.approve')
$$;

-- item master prices: a change becomes a request, the stored price stays
create or replace function app.tg_items_rate_request()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if app.rate_approval_needed(new.company_id) then
    if new.sale_price is distinct from old.sale_price then
      insert into public.rate_change_requests (company_id, kind, item_id, rate_type, old_rate, new_rate, requested_by)
      values (new.company_id, 'ITEM_PRICE', new.id, 'SALE', old.sale_price, new.sale_price, auth.uid());
      new.sale_price := old.sale_price;
    end if;
    if new.purchase_price is distinct from old.purchase_price then
      insert into public.rate_change_requests (company_id, kind, item_id, rate_type, old_rate, new_rate, requested_by)
      values (new.company_id, 'ITEM_PRICE', new.id, 'PURCHASE', old.purchase_price, new.purchase_price, auth.uid());
      new.purchase_price := old.purchase_price;
    end if;
  end if;
  return new;
end;
$$;
create trigger items_rate_request before update of sale_price, purchase_price on public.items
  for each row execute function app.tg_items_rate_request();

-- party rates: insert / update becomes a request (the row is not written)
create or replace function app.tg_party_rate_request()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if app.rate_approval_needed(new.company_id) then
    insert into public.rate_change_requests (company_id, kind, item_id, party_id, rate_type, old_rate, new_rate, effective_from, requested_by)
    values (new.company_id, 'PARTY_RATE', new.item_id, new.party_id, new.rate_type,
            case when tg_op = 'UPDATE' then old.rate end, new.rate, new.effective_from, auth.uid());
    return null;
  end if;
  return new;
end;
$$;
create trigger party_item_rates_request before insert or update of rate, effective_from on public.party_item_rates
  for each row execute function app.tg_party_rate_request();

-- rate entry through the API: tells the screen whether it is applied or pending
create or replace function public.party_rate_save(p_company_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public, app, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate, effective_from)
  values (p_company_id, upper(p_payload->>'rate_type'), nullif(p_payload->>'party_id', '')::uuid, (p_payload->>'item_id')::uuid,
          (p_payload->>'rate')::numeric, coalesce((p_payload->>'effective_from')::date, current_date))
  returning id into v_id;
  return jsonb_build_object('status', case when v_id is null then 'PENDING_APPROVAL' else 'APPLIED' end, 'id', v_id);
end;
$$;

create or replace function public.rate_change_decide(p_request_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare r public.rate_change_requests;
begin
  select * into r from public.rate_change_requests where id = p_request_id for update;
  if r.id is null or not app.is_member(r.company_id) then
    raise exception 'Request not found' using errcode = 'P0001';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'The request is already %', lower(r.status) using errcode = 'P0001';
  end if;
  perform app.require_permission(r.company_id, 'rates.approve');
  perform secure.require_class(r.company_id, case when r.rate_type in ('SALE', 'ISSUE') then 'SALE' else 'PURCHASE' end, 'Deciding this rate');
  if r.requested_by = auth.uid() then
    raise exception 'A rate change cannot be approved by the user who requested it' using errcode = '42501';
  end if;
  if not app.scope_allows(r.company_id, 'ITEM', r.item_id) or (r.party_id is not null and not app.party_allowed(r.company_id, r.party_id)) then
    raise exception 'Access denied: outside your data scope' using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reject' using errcode = 'P0001';
  end if;
  if p_approve then
    perform set_config('app.applying_rate_request', 'on', true);
    perform set_config('app.rate_request_by', coalesce(r.requested_by::text, ''), true);
    if r.kind = 'ITEM_PRICE' then
      if r.rate_type = 'SALE' then update public.items set sale_price = r.new_rate where id = r.item_id;
      else update public.items set purchase_price = r.new_rate where id = r.item_id; end if;
    else
      insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate, effective_from)
      values (r.company_id, r.rate_type, r.party_id, r.item_id, r.new_rate, coalesce(r.effective_from, current_date));
    end if;
    perform set_config('app.applying_rate_request', '', true);
    perform set_config('app.rate_request_by', '', true);
  end if;
  update public.rate_change_requests set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
         decided_by = auth.uid(), decided_at = now(), reason = nullif(trim(p_reason), '')
   where id = r.id;
  perform app.audit(r.company_id, 'rate_change_requests', r.id::text, case when p_approve then 'APPROVE' else 'REJECT' end,
                    jsonb_build_object('rate_type', r.rate_type, 'old_rate', r.old_rate, 'item_id', r.item_id, 'party_id', r.party_id),
                    jsonb_build_object('new_rate', r.new_rate, 'reason', nullif(trim(p_reason), ''), 'requested_by', r.requested_by));
end;
$$;

-- rate history knows who requested and who approved
create or replace function app.tg_rate_history_approval()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
begin
  if current_setting('app.applying_rate_request', true) = 'on' then
    new.requested_by := nullif(current_setting('app.rate_request_by', true), '')::uuid;
    new.approved_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger item_rate_history_approval before insert on public.item_rate_history
  for each row execute function app.tg_rate_history_approval();

revoke all on function public.approval_approve(text, uuid, text), public.approval_reject(text, uuid, text),
                       public.approval_rules_save(uuid, text, boolean, jsonb), public.approval_config(uuid),
                       public.approval_inbox(uuid), public.party_rate_save(uuid, jsonb), public.rate_change_decide(uuid, boolean, text)
  from public, anon;
grant execute on function public.approval_approve(text, uuid, text), public.approval_reject(text, uuid, text),
                          public.approval_rules_save(uuid, text, boolean, jsonb), public.approval_config(uuid),
                          public.approval_inbox(uuid), public.party_rate_save(uuid, jsonb), public.rate_change_decide(uuid, boolean, text)
  to authenticated, service_role;
grant execute on function app.approval_state(text, uuid), app.approval_can_act(text, uuid, jsonb), app.approval_amount_visible(text, uuid),
                          app.approval_doc(text, uuid), app.approval_levels(uuid, text, numeric), app.approval_assert_actor(text, uuid, jsonb, boolean),
                          app.assert_doc_scope(text, uuid), app.approval_amount_class(text, uuid), app.approval_required(uuid, text)
  to authenticated, service_role;
revoke all on function app.tg_items_rate_request(), app.tg_party_rate_request(), app.tg_rate_history_approval(),
                       app.approval_notify(text, uuid, jsonb) from public, anon, authenticated;

-- financial-security registry (migration 2): the new write RPCs that touch rates
insert into secure.reviewed_functions values
  ('public.party_rate_save', 'invoker write: row-level policies + rate-change trigger'),
  ('public.rate_change_decide', 'write; requires rates.approve + class + scope; returns no values')
on conflict do nothing;
insert into secure.sensitive_columns (table_name, column_name, class, note) values
  ('rate_change_requests', 'old_rate', 'ROW_LEVEL', 'read policy by rate_type (SALE / PURCHASE) + item / party scope'),
  ('rate_change_requests', 'new_rate', 'ROW_LEVEL', 'read policy by rate_type (SALE / PURCHASE) + item / party scope')
on conflict do nothing;
insert into secure.column_whitelist values
  ('rate_change_requests', 'rate_type', 'type, not a value'),
  ('approval_rules', 'min_amount', 'approval threshold (configuration), not a business value')
on conflict do nothing;
