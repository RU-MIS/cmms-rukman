-- =============================================================================
-- INVENTORY MVP tests: 17 purchase PO · 18 partial receiving · 19 full
-- receiving · 20 over-receiving rejection · receiving into rack/bin ·
-- pending screen shows only pending lines · PO CLOSED · 12 vendor stock
-- hidden · 16 vendor-specific override · 31 unauthorized vendor access.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('PUR-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'VEND-A', 'SUPPLIER', 'sales@vend-a.test') as v \gset va_
select test.party(test.id('company'), 'VEND-B', 'SUPPLIER') as v \gset vb_
select test.portal_user(test.id('company'), :'va_v', 'VENDOR') as v \gset pva_
select test.portal_user(test.id('company'), :'vb_v', 'VENDOR') as v \gset pvb_
update public.company_settings set vendor_portal_enabled = true where company_id = test.id('company');
select test.user_with_role(test.id('company'), 'PURCHASE') as v \gset buyer_
select test.location(test.id('company'), test.id('rm_godown'), 'R1', 'A', '001') as v \gset bin_
-- 10 items on one PO
insert into public.items (company_id, code, name, item_kind, base_unit_id)
select test.id('company'), 'RM-' || g, 'Raw material ' || g, 'RAW_MATERIAL', test.id('pcs') from generate_series(1, 9) g;

-- ------------------------------------------------ 17: purchase PO by a Purchase user
select test.login(:'buyer_v');
insert into t values ('po', public.doc_save('PURCHASE_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'party_id', :'va_v', 'expected_date', '2026-09-15',
  'godown_id', test.id('rm_godown'), 'remarks', 'Deliver to raw material store',
  'lines', (select jsonb_agg(x) from (
      select jsonb_build_object('item_id', test.id('rm'), 'qty', 500, 'unit_id', test.id('mtr'), 'rate', 200) x
      union all
      select jsonb_build_object('item_id', id, 'qty', 10, 'unit_id', test.id('pcs'), 'rate', 5)
      from public.items where company_id = test.id('company') and code like 'RM-_') s))));
select test.eq((public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po')))->>'status', 'OPEN', 'Vendor PO confirmed (OPEN)');
insert into t select 'line', id from public.purchase_order_lines where order_id = (select v from t where k = 'po') and item_id = test.id('rm');

create or replace function pg_temp.receive(p_qty numeric, p_loc uuid default null, p_line uuid default null,
                                           p_item uuid default null, p_unit uuid default null) returns jsonb language sql as $$
  select public.doc_submit('PURCHASE_RECEIPT', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-05',
    'party_id', (select id from public.parties where code = 'VEND-A' and company_id = test.id('company')),
    'godown_id', test.id('rm_godown'), 'supplier_bill_no', 'VA-' || p_qty,
    'lines', jsonb_build_array(jsonb_build_object('po_line_id', coalesce(p_line, (select v from t where k = 'line')),
       'item_id', coalesce(p_item, test.id('rm')), 'qty', p_qty, 'unit_id', coalesce(p_unit, test.id('mtr')), 'rate', 200,
       'location_id', p_loc)))))
$$;
create or replace function pg_temp.pending() returns numeric language sql as $$
  select pending_base_qty from public.v_purchase_order_lines where po_line_id = (select v from t where k = 'line')
$$;

-- ------------------------------------------------ 18: partial receiving into a rack/bin
select test.eq(pg_temp.receive(140, :'bin_v')->>'status', 'POSTED', 'Receive 140 into R1-A-001');
set constraints all immediate; set constraints all deferred;
select test.eq(pg_temp.pending(), 360.000::numeric, 'Ordered 500, received 140 → pending 360');
select test.eq((select order_status::text from public.v_purchase_order_lines where po_line_id = (select v from t where k = 'line')),
               'PARTIALLY_RECEIVED', 'PO PARTIALLY_RECEIVED');
select test.eq((select base_qty from public.v_stock_by_location where location_id = :'bin_v' and item_id = test.id('rm')),
               140.000::numeric(16,3), 'Stock actually increased in the selected location');
select pg_temp.receive(100);
select test.eq(pg_temp.pending(), 260.000::numeric, 'Next receipt 100 → pending 260');

-- ------------------------------------------------ 20: over-receiving rejected
select test.throws($$ select pg_temp.receive(261) $$, 'Over-receiving rejected%', 'Receiving 261 when 260 pending is rejected');
select test.eq(pg_temp.pending(), 260.000::numeric, 'Pending unchanged after the rejected receipt');

-- ------------------------------------------------ 19: full receiving; line disappears from pending screen
select pg_temp.receive(260);
select test.eq(pg_temp.pending(), 0.000::numeric, 'Pending 0');
select test.ok(not exists (select 1 from public.v_purchase_pending_lines where po_line_id = (select v from t where k = 'line')),
               'Fully received item disappears from the pending receiving screen');
select test.eq((select count(*) from public.v_purchase_pending_lines where order_id = (select v from t where k = 'po'))::int, 9,
               'PO with 10 items: only the 9 still pending are shown');
select test.throws($$ select pg_temp.receive(1) $$, 'Over-receiving rejected%', 'Receiving against a completed line is rejected');
-- receive the 9 others fully → FULLY_RECEIVED
select pg_temp.receive(10, null, l.id, l.item_id, test.id('pcs'))
from public.purchase_order_lines l where l.order_id = (select v from t where k = 'po') and l.item_id <> test.id('rm');
select test.eq((select status::text from public.purchase_orders where id = (select v from t where k = 'po')), 'FULLY_RECEIVED',
               'All lines received → PO FULLY_RECEIVED');
select test.eq((select count(*) from public.v_purchase_pending_lines where order_id = (select v from t where k = 'po'))::int, 0,
               'Nothing of this PO left on the pending screen');
select test.login(test.id('admin'));
select test.eq((select count(*) from public.audit_log where table_name = 'purchase_receipts' and action = 'POST')::int, 12,
               'Every receipt is audited');
select test.login(:'buyer_v');

-- direct purchase receiving without PO
select test.eq(public.doc_submit('PURCHASE_RECEIPT', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-05', 'party_id', :'va_v', 'godown_id', test.id('rm_godown'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 5, 'unit_id', test.id('mtr'), 'rate', 200)))))->>'status',
  'POSTED', 'Direct receiving without a PO');

-- ------------------------------------------------ PO CLOSED with pending qty
insert into t values ('po2', public.doc_save('PURCHASE_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-02', 'party_id', :'vb_v',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 50, 'unit_id', test.id('mtr'), 'rate', 190)))));
select public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po2'));
select test.eq((public.purchase_order_close((select v from t where k = 'po2'), 'Vendor cannot supply'))->>'status', 'CLOSED',
               'PO closed with pending quantity');
select test.ok(not exists (select 1 from public.v_purchase_pending_lines where order_id = (select v from t where k = 'po2')),
               'Closed PO leaves the pending screen');

-- ------------------------------------------------ vendor portal: own POs only, ordered/received/pending
select test.login(:'pva_v');
select test.eq(jsonb_array_length(public.portal_vendor_pos(test.id('company'))), 1, 'Vendor A sees only his PO');
select test.eq((select (l->>'received_qty')::numeric from jsonb_array_elements(public.portal_vendor_pos(test.id('company'))->0->'lines') l
                where l->>'item_code' = 'RM-LYCRA'), 500.000::numeric, 'Vendor sees received 500');
select test.eq((select (l->>'pending_qty')::numeric from jsonb_array_elements(public.portal_vendor_pos(test.id('company'))->0->'lines') l
                where l->>'item_code' = 'RM-LYCRA'), 0::numeric, 'Vendor sees pending 0');

-- ------------------------------------------------ 12: vendor stock hidden by default; rate hidden by default
select test.eq(public.portal_vendor_pos(test.id('company'))->0->'lines'->0->'stock', '{"visibility": "HIDDEN"}'::jsonb,
               'Vendor stock visibility HIDDEN');
select test.eq(public.portal_vendor_pos(test.id('company'))->0->'lines'->0->'rate', 'null'::jsonb, 'Vendor rate hidden');
select test.ok(not (public.portal_vendor_po_print(test.id('company'), (select v from t where k = 'po'))->'lines'->0 ? 'rate'),
               'PO print for the vendor has no rate when rates are hidden');

-- customer settings do not affect vendors (independent, §12)
select test.login(null);
update public.company_settings set customer_stock_visibility = 'EXACT_QUANTITY', customer_rate_visible = true
 where company_id = test.id('company');
select test.login(:'pva_v');
select test.eq(public.portal_vendor_pos(test.id('company'))->0->'lines'->0->'stock'->>'visibility', 'HIDDEN',
               'Customer setting does not change vendor visibility');

-- ------------------------------------------------ 16: vendor-specific override
select test.login(test.id('admin'));
insert into public.party_settings (party_id, stock_visibility, rate_visible) values (:'va_v', 'AVAILABLE_STATUS', true);
select test.login(:'pva_v');
select test.eq(public.portal_vendor_pos(test.id('company'))->0->'lines'->0->'stock'->>'visibility', 'AVAILABLE_STATUS',
               'Vendor A override: AVAILABLE_STATUS');
select test.ok((public.portal_vendor_pos(test.id('company'))->0->'lines'->0->>'rate') is not null, 'Vendor A override: rate visible');
select test.login(:'pvb_v');
select test.eq(public.portal_vendor_pos(test.id('company'))->0->'lines'->0->'stock'->>'visibility', 'HIDDEN',
               'Vendor B keeps company setting HIDDEN');

-- ------------------------------------------------ 31: unauthorized vendor access
select test.throws(format($$ select public.portal_vendor_po_print(%L, %L) $$, test.id('company'), (select v from t where k = 'po')),
                   'PO not found%', 'Vendor B cannot open Vendor A''s PO');
select test.eq((select count(*) from public.purchase_orders)::int, 0, 'Vendor reads no purchase order table rows');
select test.eq((select count(*) from public.parties)::int, 0, 'Vendor cannot list other vendors / customers');
select test.throws(format($$ select public.portal_catalog(%L) $$, test.id('company')), 'Portal access denied%',
                   'Vendor cannot open the customer portal');
select test.throws(format($$ select public.purchase_order_print(%L) $$, (select v from t where k = 'po')), 'Purchase order not found%',
                   'Vendor cannot use the internal PO print');
select test.throws(format($$ select public.doc_submit('PURCHASE_RECEIPT', %L) $$, gen_random_uuid()), '%not found%',
                   'Vendor cannot post receipts');
select test.eq((public.portal_vendor_payments(test.id('company'))->>'visible')::boolean, true, 'Vendor payment status visible');
select test.eq((public.portal_vendor_payments(test.id('company'))->>'total_outstanding')::numeric, 0::numeric,
               'Vendor B has no bills');
rollback;
