-- =============================================================================
-- INVENTORY MVP tests: 5 stock reservation · 7 customer PO · 8 customer quote
-- price · 9 internal price approval · customer-specific pricing (§16) ·
-- dispatch consumes the reservation (§22, §37) · reject / modify flow.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('SO-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'CUST-A', 'CUSTOMER', 'buyer@cust-a.test') as v \gset ca_
select test.party(test.id('company'), 'CUST-B', 'CUSTOMER') as v \gset cb_
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pa_
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');
update public.items set sale_price = 150, reorder_level = 100 where id = test.id('fg');
-- customer-specific price (§16): Customer A 145, others base 150
insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate, effective_from)
values (test.id('company'), 'SALE', :'ca_v', test.id('fg'), 145, '2026-01-01');
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 20000);
select test.eq(app.customer_price(test.id('company'), :'ca_v', test.id('fg')), 145.0000::numeric, 'Customer A price 145');
select test.eq(app.customer_price(test.id('company'), :'cb_v', test.id('fg')), 150.0000::numeric, 'Customer B gets base price 150');

-- ------------------------------------------------ 7/8: customer creates a PO with his own quote
select test.login(:'pa_v');
insert into t values ('cpo', ((public.portal_customer_po_create(test.id('company'), jsonb_build_object(
  'po_no', 'PO-A-001', 'po_date', '2026-09-10', 'requested_delivery_date', '2026-09-30', 'remarks', 'urgent',
  'party_id', :'cb_v',                                  -- tampering: ignored, party comes from the login
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 5000, 'unit_id', test.id('pair'),
                                                'quoted_rate', 140, 'reference_rate', 1, 'approved_rate', 1)))))->>'customer_po_id')::uuid);
select test.login(test.id('admin'));
select test.eq((select row(party_id, status::text)::text from public.customer_pos where id = (select v from t where k = 'cpo')),
               format('(%s,SUBMITTED)', :'ca_v'), 'PO belongs to the logged-in customer, status SUBMITTED');
select test.eq((select row(quoted_rate, reference_rate, approved_rate)::text from public.customer_po_lines
                where customer_po_id = (select v from t where k = 'cpo')),
               '(140.0000,145.0000,)', 'Quote 140 stored; reference = customer price 145; NOT approved automatically');
select test.ok(not exists (select 1 from public.sales_orders where customer_po_id = (select v from t where k = 'cpo')),
               'No sales order before internal review');

-- quote disabled → quote ignored
select test.login(null);
update public.company_settings set customer_quote_price_enabled = false where company_id = test.id('company');
select test.login(:'pa_v');
insert into t values ('cpo2', ((public.portal_customer_po_create(test.id('company'), jsonb_build_object(
  'po_no', 'PO-A-002', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 100,
  'unit_id', test.id('pair'), 'quoted_rate', 1)))))->>'customer_po_id')::uuid);
select test.throws(format($$ select public.portal_customer_po_create(%L, jsonb_build_object('po_no', 'PO-A-002',
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1)))) $$, test.id('company'), test.id('fg')),
  '%already exists%', 'Duplicate PO number rejected');
select public.portal_customer_po_cancel(test.id('company'), (select v from t where k = 'cpo2'));
select test.login(test.id('admin'));
select test.ok((select quoted_rate is null from public.customer_po_lines where customer_po_id = (select v from t where k = 'cpo2')),
               'Quote price ignored when quoting is OFF');
select test.eq((select status::text from public.customer_pos where id = (select v from t where k = 'cpo2')), 'CANCELLED',
               'Customer cancelled his SUBMITTED PO');

-- customer cannot approve / change price
select test.login(:'pa_v');
select test.throws(format($$ select public.customer_po_approve(%L) $$, (select v from t where k = 'cpo')),
                   '%not found%', 'Customer cannot approve his own PO');
select test.throws(format($$ update public.customer_po_lines set approved_rate = 1 $$),
                   'permission denied%', 'Customer cannot write the approved price');

-- ------------------------------------------------ 9: internal review — modify price → approve
select test.login(test.id('operator'));
select test.throws(format($$ select public.customer_po_approve(%L) $$, (select v from t where k = 'cpo')),
                   'Permission denied%', 'Operator cannot approve customer prices');
select public.customer_po_start_review((select v from t where k = 'cpo'));
select test.login(test.id('approver'));
insert into t values ('so', (public.customer_po_approve((select v from t where k = 'cpo'),
  jsonb_build_array(jsonb_build_object('line_id', (select id from public.customer_po_lines
                                                   where customer_po_id = (select v from t where k = 'cpo')),
                                       'approved_rate', 143)),
  'Agreed at 143', test.id('b336'), true)->>'sales_order_id')::uuid);
select test.eq((select status::text from public.customer_pos where id = (select v from t where k = 'cpo')), 'APPROVED',
               'Customer PO APPROVED');
select test.eq((select row(rate, quoted_rate, reference_rate)::text from public.sales_order_lines
                where order_id = (select v from t where k = 'so')),
               '(143.0000,140.0000,145.0000)', 'Sales order keeps quote 140 and final approved price 143');
select test.eq((select row(status::text, customer_po_no)::text from public.sales_orders where id = (select v from t where k = 'so')),
               '(OPEN,PO-A-001)', 'Sales order created (OPEN) from the customer PO');

-- ------------------------------------------------ 5: reservation reduces available, not physical
select test.eq((select row(base_qty, reserved_qty, available_qty)::text from public.v_stock_balance
                where item_id = test.id('fg') and godown_id = test.id('b336')),
               '(20000.000,5000.000,15000.000)', 'Physical 20000, reserved 5000, available 15000');
select test.eq((select row(physical_qty, reserved_qty, available_qty)::text from public.v_inventory_items
                where item_id = test.id('fg')), '(20000.000,5000.000,15000.000)', 'Inventory list shows the same');
select test.ok(exists (select 1 from public.stock_reservation_movements where item_id = test.id('fg')
                       and movement_type = 'RESERVATION'), 'RESERVATION movement recorded');
select test.ok(not exists (select 1 from public.stock_movements where item_id = test.id('fg')
                           and movement_type in ('RESERVATION', 'RESERVATION_RELEASE')),
               'Reservation does not touch the physical ledger');

-- other demand cannot take reserved stock
select test.login(null);
update public.company_settings set customer_quote_price_enabled = true where company_id = test.id('company');
select test.login(test.id('admin'));
insert into t values ('cpo3', public.customer_po_create(test.id('company'), :'cb_v', jsonb_build_object(
  'po_no', 'B-77', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 16000, 'unit_id', test.id('pair'))))));
insert into t values ('so3', (public.customer_po_approve((select v from t where k = 'cpo3'))->>'sales_order_id')::uuid);
select test.eq((select rate from public.sales_order_lines where order_id = (select v from t where k = 'so3')),
               150.0000::numeric(14,4), 'No quote → approved at the price list (150)');
insert into t select 'so3line', id from public.sales_order_lines where order_id = (select v from t where k = 'so3');
select test.throws(format($$ select public.sales_order_reserve(%L, %L, 16000) $$, (select v from t where k = 'so3line'), test.id('b336')),
                   'Cannot reserve%16000 PAIR%only%15000 PAIR%', 'Reservation cannot exceed available stock');
select test.eq((public.sales_order_reserve((select v from t where k = 'so3line'), test.id('b336'), 15000))->>'available_qty',
               '0.000', 'Reserve the remaining 15000 → available 0');
select test.throws(format($$ select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-11', 'godown_id', %L, 'reason', 'STOCK_OUT',
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'direction', -1, 'qty', 1, 'unit_id', %L))))) $$,
  test.id('company'), test.id('b336'), test.id('fg'), test.id('pair')),
  'Insufficient stock%reserved 20000%', 'Reserved stock cannot be taken out by another transaction');

-- ------------------------------------------------ dispatch: physical ↓, reservation released
create or replace function pg_temp.dispatch(p_so uuid, p_qty numeric) returns jsonb language sql as $$
  select public.doc_submit('DISPATCH', public.doc_save('DISPATCH', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-20', 'sales_order_id', p_so, 'godown_id', test.id('b336'),
    'lines', jsonb_build_array(jsonb_build_object('order_line_id', (select id from public.sales_order_lines where order_id = p_so),
                                                  'item_id', test.id('fg'), 'qty', p_qty, 'unit_id', test.id('pair'))))))
$$;
select test.eq(pg_temp.dispatch((select v from t where k = 'so'), 2000)->>'status', 'POSTED', 'Dispatch 2000 of reserved order');
select test.eq((select row(base_qty, reserved_qty, available_qty)::text from public.v_stock_balance
                where item_id = test.id('fg') and godown_id = test.id('b336')),
               '(18000.000,18000.000,0.000)', 'Physical 18000, reserved 3000+15000, available 0');
select test.ok(exists (select 1 from public.stock_movements where item_id = test.id('fg') and movement_type = 'SALE_DISPATCH'),
               'SALE_DISPATCH movement');
select test.eq((select row(consumed_qty, open_qty)::text from public.stock_reservations
                where sales_order_id = (select v from t where k = 'so')), '(2000.000,3000.000)', 'Reservation consumed 2000, open 3000');
select test.eq((select status::text from public.sales_orders where id = (select v from t where k = 'so')),
               'PARTIALLY_DISPATCHED', 'Order PARTIALLY_DISPATCHED');
select test.throws(format($$ select pg_temp.dispatch(%L, 3001) $$, (select v from t where k = 'so')),
                   '%more than pending%', 'Dispatch above pending rejected');
select pg_temp.dispatch((select v from t where k = 'so'), 3000);
select test.eq((select status::text from public.sales_orders where id = (select v from t where k = 'so')), 'DISPATCHED',
               'Order fully DISPATCHED');
select test.eq((select status::text from public.stock_reservations where sales_order_id = (select v from t where k = 'so')),
               'CONSUMED', 'Reservation fully CONSUMED');

-- release + close
select test.eq((public.reservation_release((select id from public.stock_reservations
                where sales_order_id = (select v from t where k = 'so3')), 5000))->>'released_qty', '5000',
               'Partial release of 5000');
select test.eq((select available_qty from public.v_stock_balance where item_id = test.id('fg') and godown_id = test.id('b336')),
               5000.000::numeric, 'Released stock is available again');
select test.eq((public.sales_order_close((select v from t where k = 'so3'), 'Customer cancelled'))->>'status', 'CLOSED',
               'Order closed');
select test.eq((select reserved_qty from public.v_stock_balance where item_id = test.id('fg') and godown_id = test.id('b336')),
               0::numeric, 'Closing the order released its reservation');
select test.ok(exists (select 1 from public.stock_reservation_movements where movement_type = 'RESERVATION_RELEASE'
                       and reason = 'ORDER_CLOSED'), 'RESERVATION_RELEASE movement recorded');

-- reject flow
insert into t values ('cpo4', public.customer_po_create(test.id('company'), :'cb_v', jsonb_build_object(
  'po_no', 'B-78', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 10, 'unit_id', test.id('pair'),
                                                                 'quoted_rate', 50)))));
select test.throws(format($$ select public.customer_po_reject(%L, '') $$, (select v from t where k = 'cpo4')),
                   '%reason is required%', 'Reject needs a reason');
select public.customer_po_reject((select v from t where k = 'cpo4'), 'Price too low');
select test.eq((select row(status::text, reject_reason)::text from public.customer_pos where id = (select v from t where k = 'cpo4')),
               '(REJECTED,"Price too low")', 'Customer PO rejected with reason');
select test.throws(format($$ select public.customer_po_approve(%L) $$, (select v from t where k = 'cpo4')),
                   '%cannot be approved%', 'Rejected PO cannot be approved');
select test.ok(exists (select 1 from public.audit_log where table_name = 'customer_pos' and action = 'APPROVE'),
               'Approval is audited');

-- customer sees approved price on his own PO, never the internal reference price when rates are hidden
select test.login(:'pa_v');
select test.eq((select (x->'lines'->0->>'approved_rate')::numeric from jsonb_array_elements(public.portal_my_customer_pos(test.id('company'))) x where x->>'po_no' = 'PO-A-001'), 143::numeric,
               'Customer sees the final approved price');
select test.ok((select x->'lines'->0->'reference_rate' from jsonb_array_elements(public.portal_my_customer_pos(test.id('company'))) x where x->>'po_no' = 'PO-A-001') = 'null'::jsonb,
               'Internal reference price hidden (rate visibility OFF by default)');
rollback;
