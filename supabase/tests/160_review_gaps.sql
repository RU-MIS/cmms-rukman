-- =============================================================================
-- Gaps from docs/INVENTORY_REQUIREMENTS_CHECKLIST.md:
--   1 dispatch beyond available stock rejected (negative stock OFF)
--   2 company_id / party tampering in portal payloads
--   3 vendor cannot change payment / allocation data
--   4 vendor portal shows only documents marked visible
--   5 CUSTOMER_DOCUMENT email (ON / OFF)
--   8 dispatch from an explicit rack / bin
-- (6 concurrency: 170_concurrent_reservation.sh, 7 storage: e2e/storage.test.mjs)
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('GAP-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'CUST-A', 'CUSTOMER', 'a@cust.test') as v \gset ca_
select test.party(test.id('company'), 'VEND-A', 'SUPPLIER', 'a@vend.test') as v \gset va_
select test.party(test.id('company'), 'VEND-B', 'SUPPLIER', 'b@vend.test') as v \gset vb_
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pca_
select test.portal_user(test.id('company'), :'va_v', 'VENDOR') as v \gset pva_
select test.portal_user(test.id('company'), :'vb_v', 'VENDOR') as v \gset pvb_
update public.company_settings set customer_portal_enabled = true, vendor_portal_enabled = true, email_automation = true,
       vendor_payment_visible = true where company_id = test.id('company');
insert into test.ctx values ('fx2', test.fixture('GAP-OTHER'));
select (v->>'company')::uuid as v from test.ctx where k = 'fx2' \gset co2_
select test.location(test.id('company'), test.id('b336'), 'B1', 'C', '123') as v \gset bin1_
select test.location(test.id('company'), test.id('b336'), 'B1', 'C', '124') as v \gset bin2_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 30, :'bin1_v');
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 20, :'bin2_v');

-- sales orders (internal entry)
select test.login(test.id('admin'));
insert into t values ('so1', (public.customer_po_approve(public.customer_po_create(test.id('company'), :'ca_v', jsonb_build_object(
  'po_no', 'G-1', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 100, 'unit_id', test.id('pair'),
  'quoted_rate', 10)))))->>'sales_order_id')::uuid);
create or replace function pg_temp.dispatch(p_so uuid, p_qty numeric, p_loc uuid default null) returns jsonb language sql as $$
  select public.doc_submit('DISPATCH', public.doc_save('DISPATCH', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-20', 'sales_order_id', p_so, 'godown_id', test.id('b336'),
    'lines', jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.sales_order_lines where order_id = p_so),
                                                  'item_id', test.id('fg'), 'qty', p_qty, 'unit_id', test.id('pair'),
                                                  'location_id', p_loc)))))
$$;

-- ------------------------------------------------ 1: dispatch beyond available stock
select test.throws(format($$ select pg_temp.dispatch(%L, 60) $$, (select v from t where k = 'so1')),
                   'Insufficient stock of TOE-RING SANDAL-4766 in B-336: available%(50 PAIR)%',
                   'Dispatch of 60 with 50 in stock is rejected (negative stock OFF)');
select test.eq((select base_qty from public.v_stock_balance where item_id = test.id('fg') and godown_id = test.id('b336')),
               50.000::numeric, 'Stock unchanged after the rejected dispatch');
select test.eq((select count(*) from public.dispatches where status = 'POSTED')::int, 0, 'No dispatch posted');
-- stock reserved for another order is not available for this one
insert into t values ('so2', (public.customer_po_approve(public.customer_po_create(test.id('company'), :'ca_v', jsonb_build_object(
  'po_no', 'G-2', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 40, 'unit_id', test.id('pair'),
  'quoted_rate', 10)))), null, null, test.id('b336'), true)->>'sales_order_id')::uuid);
select test.throws(format($$ select pg_temp.dispatch(%L, 11) $$, (select v from t where k = 'so1')),
                   'Insufficient stock%available%10 PAIR%reserved 40%', 'Order 1 cannot dispatch stock reserved for order 2');
select test.eq(pg_temp.dispatch((select v from t where k = 'so1'), 10)->>'status', 'POSTED', 'Order 1 can dispatch the 10 unreserved');

-- ------------------------------------------------ 8: dispatch from an explicit rack / bin
select test.eq((select row(base_qty)::text from public.v_stock_by_location where location_id = :'bin1_v'), '(20.000)',
               'Auto-pick took the 10 from B1-C-123 first (named locations by code)');
select test.throws(format($$ select pg_temp.dispatch(%L, 41, %L) $$, (select v from t where k = 'so2'), :'bin2_v'),
                   '%more than pending%', 'Cannot dispatch more than the order');
select test.eq(pg_temp.dispatch((select v from t where k = 'so2'), 15, :'bin2_v')->>'status', 'POSTED',
               'Dispatch 15 explicitly from bin B1-C-124');
select test.eq((select base_qty from public.v_stock_by_location where location_id = :'bin2_v'), 5.000::numeric(16,3),
               'B1-C-124: 20 − 15 = 5');
select test.eq((select base_qty from public.v_stock_by_location where location_id = :'bin1_v'), 20.000::numeric(16,3),
               'B1-C-123 untouched');
select test.ok((select bool_and(location_id = :'bin2_v') from public.stock_movements m join public.dispatches d on d.id = m.source_id
                where d.sales_order_id = (select v from t where k = 'so2')), 'SALE_DISPATCH movement carries the chosen bin');
select test.throws(format($$ select pg_temp.dispatch(%L, 6, %L) $$, (select v from t where k = 'so2'), :'bin2_v'),
                   'Insufficient stock%at location%B1-C-124%', 'Bin holding 5 cannot dispatch 6');
select test.throws(format($$ select pg_temp.dispatch(%L, 1, %L) $$, (select v from t where k = 'so2'),
                          (select id from public.storage_locations where godown_id = test.id('warehouse') and is_default)),
                   'Location does not belong to godown%', 'Bin of another godown rejected');
select test.eq((select reserved_qty from public.v_stock_balance where item_id = test.id('fg') and godown_id = test.id('b336')),
               25.000::numeric, 'Reservation of order 2 reduced by the 15 dispatched');

-- ------------------------------------------------ 2: company_id / party tampering
select test.login(:'pca_v');
insert into t values ('cpo', ((public.portal_customer_po_create(test.id('company'), jsonb_build_object(
  'po_no', 'TAMPER-1', 'company_id', :'co2_v', 'party_id', gen_random_uuid(), 'status', 'APPROVED',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'approved_rate', 0)))))->>'customer_po_id')::uuid);
select test.login(test.id('admin'));
select test.eq((select row(company_id::text, party_id::text, status::text)::text from public.customer_pos where id = (select v from t where k = 'cpo')),
               format('(%s,%s,SUBMITTED)', test.id('company'), :'ca_v'),
               'company_id, party_id and status from the request are ignored');
select test.ok(test.raw($q$select approved_rate is null from public.customer_po_lines where customer_po_id = (select v from t where k = 'cpo')$q$)::boolean,
               'approved_rate from the request is ignored');
select test.login(:'pca_v');
select test.throws(format($$ update public.customer_pos set company_id = %L $$, :'co2_v'), 'permission denied%',
                   'Customer cannot update company_id directly');
update public.parties set company_id = :'co2_v';   -- RLS: matches no row for a portal user
select test.login(null);
select test.eq((select count(*) from public.parties where company_id = test.id('company'))::int, 5,
               'Customer could not move any party to another company');
select test.login(:'pca_v');
select test.throws(format($$ select public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', %L, 'doc_date', current_date)) $$, :'co2_v'),
                   'Unknown company%', 'Customer cannot write into another company');
-- an internal user of company 1 cannot post into company 2 either
select test.login(test.id('admin'));
select test.throws(format($$ select public.customer_po_create(%L, %L, '{}'::jsonb) $$, :'co2_v', :'ca_v'), 'Unknown company%',
                   'Internal user cannot create records in a company he does not belong to');
select test.throws(format($$ select public.document_register(jsonb_build_object('company_id', %L, 'entity_type', 'party',
                            'entity_id', %L, 'storage_path', %L, 'file_name', 'x')) $$, test.id('company'),
                          (select (v->>'aleem')::uuid from test.ctx where k = 'fx2'), test.id('company') || '/x'),
                   '%not found%', 'Document cannot be attached to a record of another company');

-- ------------------------------------------------ 3: vendor cannot change payment data
-- vendor bill + partial payment
insert into t values ('pr', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object('company_id', test.id('company'),
  'doc_date', '2026-09-01', 'party_id', :'va_v', 'godown_id', test.id('rm_godown'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 10, 'unit_id', test.id('mtr'), 'rate', 100)))));
select public.doc_submit('PURCHASE_RECEIPT', (select v from t where k = 'pr'));
insert into t values ('pay', public.doc_save('VOUCHER', jsonb_build_object('company_id', test.id('company'), 'doc_date', '2026-09-02',
  'voucher_type', 'PAYMENT', 'book_id', (select id from public.voucher_books where company_id = test.id('company')),
  'cash_bank_account_id', (select id from public.accounts where company_id = test.id('company') and system_key = 'CASH'),
  'party_id', :'va_v', 'amount', 400)));
select public.voucher_set_allocations((select v from t where k = 'pay'), jsonb_build_array(jsonb_build_object(
  'bill_table', 'purchase_receipts', 'bill_id', (select v from t where k = 'pr'), 'amount', 400)));
select public.doc_submit('VOUCHER', (select v from t where k = 'pay'));
set constraints all immediate; set constraints all deferred;

select test.login(:'pva_v');
select test.eq((public.portal_vendor_payments(test.id('company'))->'bills'->0->>'status'), 'PARTIALLY_PAID', 'Vendor sees PARTIALLY_PAID');
select test.throws(format($$ update public.vouchers set amount = 1000 where id = %L $$, (select v from t where k = 'pay')),
                   'permission denied%', 'Vendor cannot change a payment');
select test.throws(format($$ insert into public.voucher_allocations (voucher_id, bill_table, bill_id, amount) values (%L, 'purchase_receipts', %L, 600) $$,
                          (select v from t where k = 'pay'), (select v from t where k = 'pr')),
                   'permission denied%', 'Vendor cannot add an allocation (mark bill paid)');
select test.throws(format($$ select public.voucher_set_allocations(%L, '[]') $$, (select v from t where k = 'pay')), '%not found%',
                   'Vendor cannot use the allocation RPC');
select test.throws(format($$ select public.doc_cancel('VOUCHER', %L, 'x') $$, (select v from t where k = 'pay')), '%not found%',
                   'Vendor cannot cancel a payment');
select test.throws(format($$ update public.purchase_receipts set total_amount = 1 where id = %L $$, (select v from t where k = 'pr')),
                   'permission denied%', 'Vendor cannot change the bill amount');
select test.throws(format($$ select public.bill_set_due_date('purchase_receipts', %L, '2030-01-01') $$, (select v from t where k = 'pr')),
                   'Bill not found%', 'Vendor cannot change the due date');
select test.eq((public.portal_vendor_payments(test.id('company'))->'bills'->0->>'outstanding')::numeric, 600.00::numeric,
               'Outstanding unchanged: 1000 − 400 = 600');

-- ------------------------------------------------ 4: vendor document visibility
select test.login(test.id('admin'));
insert into t values ('po', public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', '2026-09-01',
  'party_id', :'va_v', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 5, 'unit_id', test.id('mtr'), 'rate', 100)))));
select public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po'));
select public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'purchase_order',
  'entity_id', (select v from t where k = 'po'), 'category', 'PURCHASE_DOCUMENT', 'visible_to_party', true, 'send_email', false,
  'storage_path', test.id('company') || '/purchase_order/shared-drawing.pdf', 'file_name', 'drawing.pdf'));
insert into t values ('internal', (public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'purchase_order',
  'entity_id', (select v from t where k = 'po'), 'category', 'OTHER', 'visible_to_party', false, 'send_email', false,
  'storage_path', test.id('company') || '/purchase_order/internal-costing.xlsx', 'file_name', 'costing.xlsx'))->>'document_id')::uuid);
select test.login(:'pva_v');
select test.eq((select jsonb_agg(d->>'file_name') from jsonb_array_elements(public.portal_vendor_pos(test.id('company'))) p,
                jsonb_array_elements(p->'documents') d), '["drawing.pdf"]'::jsonb, 'Vendor PO shows only the shared document');
select test.eq((select jsonb_agg(d->>'file_name') from jsonb_array_elements(public.portal_documents(test.id('company'), 'VENDOR')) d),
               '["drawing.pdf"]'::jsonb, 'Vendor document list hides the internal file');
select test.login(:'pvb_v');
select test.eq(jsonb_array_length(public.portal_documents(test.id('company'), 'VENDOR')), 0, 'Vendor B sees none of Vendor A documents');
select test.login(test.id('admin'));
select public.document_set_visibility((select v from t where k = 'internal'), true);
select test.login(:'pva_v');
select test.eq(jsonb_array_length(public.portal_documents(test.id('company'), 'VENDOR')), 2, 'Shared later → visible at once');
select test.login(null);
update public.company_settings set vendor_portal_enabled = false where company_id = test.id('company');
select test.login(:'pva_v');
select test.throws(format($$ select public.portal_documents(%L, 'VENDOR') $$, test.id('company')), '%turned off%',
                   'Vendor portal OFF: no documents');

-- ------------------------------------------------ 5: CUSTOMER_DOCUMENT email
select test.login(test.id('admin'));
select test.ok((public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'sales_order',
  'entity_id', (select v from t where k = 'so1'), 'category', 'DELIVERY_DOCUMENT', 'visible_to_party', true,
  'storage_path', test.id('company') || '/sales_order/lr-1.pdf', 'file_name', 'LR-1.pdf'))->>'email_id') is null,
  'Customer document email OFF by default: none queued');
update public.company_settings set customer_document_email = true where company_id = test.id('company');
insert into t values ('cdoc', (public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'sales_order',
  'entity_id', (select v from t where k = 'so1'), 'category', 'DELIVERY_DOCUMENT', 'visible_to_party', true,
  'storage_path', test.id('company') || '/sales_order/lr-2.pdf', 'file_name', 'LR-2.pdf'))->>'email_id')::uuid);
select test.eq((select row(kind, recipient_type, to_emails::text, status::text)::text from public.email_outbox where id = (select v from t where k = 'cdoc')),
               '(CUSTOMER_DOCUMENT,PARTY,{a@cust.test},QUEUED)', 'Customer document email queued to the customer');
select test.eq((select attachments->0->>'document_id' from public.email_outbox where id = (select v from t where k = 'cdoc')),
               (select id::text from public.documents where file_name = 'LR-2.pdf'), 'Document attached');
select test.ok((public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'sales_order',
  'entity_id', (select v from t where k = 'so1'), 'category', 'DELIVERY_DOCUMENT', 'send_email', false,
  'storage_path', test.id('company') || '/sales_order/lr-3.pdf', 'file_name', 'LR-3.pdf'))->>'email_id') is null,
  'User can upload without emailing');
rollback;
