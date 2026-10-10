-- =============================================================================
-- R3 — table privileges (defence in depth)
--
-- Supabase grants ALL privileges on every new table / view to anon and
-- authenticated by default. Row-level security already decides the rows, but
-- the API roles must not hold privileges they never need:
--   * anon: nothing on any public table or view (scripts/instance/verify.sql);
--   * TRUNCATE ignores row-level security: no API role may hold it;
--   * write privileges only where a write policy exists (all other changes go
--     through the reviewed security-definer functions).
-- This also removes TRUNCATE from party_settings / storage_locations, which
-- the inventory release (20261007000002) left with the Supabase default.
-- Additive: no data change, no behaviour change for the application.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;

-- R3 tables written only by functions (no insert / update / delete policy)
revoke insert, update, delete on public.app_modules, public.approval_actions, public.approval_rules, public.company_modules,
  public.custom_field_private_values, public.import_templates, public.party_opening_balances, public.rate_change_requests
  from authenticated;
-- branding: the row is created with the company; members with the edit right update it (policy), never insert / delete
revoke insert, delete on public.company_branding from authenticated;
-- masked views are read-only
revoke insert, update, delete on public.v_purchase_order_line_rates, public.v_purchase_receipts, public.v_stock_movement_costs,
  public.v_vouchers from authenticated;

-- tables and views created by later migrations start without these privileges
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate on tables from authenticated;
