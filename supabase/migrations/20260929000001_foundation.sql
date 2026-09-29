-- =============================================================================
-- 0001 FOUNDATION
-- Extensions, internal schema, instance fingerprint, enums, generic triggers.
-- Contains NO company/instance specific values (docs/INSTANCE_ARCHITECTURE.md).
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal helpers live in "app" (not exposed through the Supabase API).
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Instance fingerprint (INSTANCE_ARCHITECTURE §6). Exactly one row, written by
-- the instance:init script; the app refuses to run if APP_INSTANCE_ID differs.
-- -----------------------------------------------------------------------------
create table public.instance_meta (
  singleton     boolean primary key default true check (singleton),
  instance_id   text not null check (length(instance_id) >= 8),
  instance_name text not null,
  created_at    timestamptz not null default now()
);
comment on table public.instance_meta is 'One row identifying this installation; compared with env APP_INSTANCE_ID.';

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.doc_status as enum ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED');

create type public.order_status as enum (
  'DRAFT', 'PENDING_APPROVAL', 'OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED',
  'PARTIALLY_DISPATCHED', 'DISPATCHED', 'CANCELLED');

create type public.movement_type as enum (
  'OPENING',
  'PURCHASE_RECEIPT', 'PURCHASE_RETURN',
  'SALE_ISSUE', 'SALE_RETURN',
  'JOB_WORK_ISSUE', 'JOB_WORK_RECEIPT', 'JOB_WORK_RETURN',
  'PRODUCTION_RECEIPT', 'CONSUMPTION',
  'STOCK_TRANSFER_OUT', 'STOCK_TRANSFER_IN',
  'STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT');

create type public.party_role as enum (
  'CUSTOMER', 'SUPPLIER', 'JOB_WORKER', 'CUTTER', 'TRANSPORTER', 'WORKER');

create type public.godown_type as enum ('OWN_STORE', 'FACTORY', 'PARTY_LOCATION');

create type public.item_kind as enum ('FINISHED_GOOD', 'RAW_MATERIAL', 'PACKING', 'SERVICE');

create type public.account_type as enum ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

create type public.account_sub_type as enum (
  'GENERAL', 'CASH', 'BANK', 'RECEIVABLE_CONTROL', 'PAYABLE_CONTROL',
  'STOCK', 'TAX', 'CAPITAL', 'DRAWINGS', 'LOAN');

create type public.perm_action as enum ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'CANCEL', 'EXPORT');

-- -----------------------------------------------------------------------------
-- Current user helper (Supabase provides auth.uid()).
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql stable
as $$ select auth.uid() $$;

-- -----------------------------------------------------------------------------
-- Generic trigger: maintain created_*/updated_* columns.
-- -----------------------------------------------------------------------------
create or replace function app.tg_set_audit_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, app.current_user_id());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := app.current_user_id();
  return new;
end;
$$;

-- Generic trigger: forbid UPDATE / DELETE on append-only ledgers.
create or replace function app.tg_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only: % is not allowed (use a reversal)', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

-- Small helper to raise a business-rule error with a stable SQLSTATE so the
-- web layer can show the message to the user.
create or replace function app.fail(p_message text, variadic p_args text[] default '{}')
returns void
language plpgsql
as $$
begin
  raise exception using message = format(p_message, variadic p_args), errcode = 'P0001';
end;
$$;
