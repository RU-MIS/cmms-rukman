-- =============================================================================
-- INVENTORY MVP (MASTER_BUILD_PROMPT.md) — enum changes
-- Kept in their own migration: new enum values cannot be used inside the
-- transaction that adds them.
-- =============================================================================

-- Movement types named as in the specification (§6).
alter type public.movement_type rename value 'SALE_ISSUE' to 'SALE_DISPATCH';
alter type public.movement_type rename value 'STOCK_ADJUSTMENT_IN' to 'STOCK_ADJUSTMENT';
alter type public.movement_type add value if not exists 'STOCK_IN';
alter type public.movement_type add value if not exists 'STOCK_OUT';
-- 'STOCK_ADJUSTMENT_OUT' is kept only for compatibility; new postings use
-- 'STOCK_ADJUSTMENT' with direction -1.

-- Purchase / sales order lifecycle (§19): CLOSED = closed with pending qty.
alter type public.order_status add value if not exists 'CLOSED';

-- Customer PO lifecycle (§10).
create type public.customer_po_status as enum
  ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- Visibility options (§11–12).
create type public.stock_visibility as enum
  ('HIDDEN', 'EXACT_QUANTITY', 'AVAILABLE_STATUS', 'AVAILABLE_TO_PROMISE');

create type public.reminder_frequency as enum ('DAILY', 'WEEKLY');

create type public.portal_kind as enum ('CUSTOMER', 'VENDOR');

create type public.email_status as enum
  ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

create type public.payment_method as enum ('CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER');

create type public.reservation_status as enum ('ACTIVE', 'RELEASED', 'CONSUMED');
