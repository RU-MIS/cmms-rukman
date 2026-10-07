-- =============================================================================
-- INVENTORY MVP tests: 10 customer stock hidden · 11 customer stock visible
-- (EXACT / STATUS / ATP) · 13 customer rate hidden · 14 customer rate visible
-- · 15 customer-specific override · 30 unauthorized customer access ·
-- 33 company isolation for portal users · portal on/off · settings take
-- effect immediately (§34).
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('PORTAL-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'CUST-A', 'CUSTOMER') as v \gset ca_
select test.party(test.id('company'), 'CUST-B', 'CUSTOMER') as v \gset cb_
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pa_
select test.portal_user(test.id('company'), :'cb_v', 'CUSTOMER') as v \gset pb_
update public.items set sale_price = 150, reorder_level = 100, min_stock = 0 where id = test.id('fg');
update public.items set portal_visible = false where id = test.id('rm');
insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate) values
  (test.id('company'), 'SALE', :'ca_v', test.id('fg'), 145), (test.id('company'), 'SALE', :'cb_v', test.id('fg'), 138);
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 20000);
-- 2000 reserved for an order; another open order of 3000 not reserved yet (ATP)
select test.login(test.id('admin'));
insert into t values ('so', public.customer_po_create(test.id('company'), :'cb_v', jsonb_build_object('po_no', 'X1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 5000, 'unit_id', test.id('pair'))))));
select public.customer_po_approve((select v from t where k = 'so'));
select public.sales_order_reserve((select l.id from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
                                   where o.customer_po_id = (select v from t where k = 'so')), test.id('b336'), 2000);
-- a second company with its own customer portal
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('PORTAL-OTHER'));
select (v->>'company')::uuid as v from test.ctx where k = 'fx2' \gset co2_
select (v->>'fg')::uuid as v from test.ctx where k = 'fx2' \gset fg2co_
select test.party(:'co2_v', 'CUST-Z', 'CUSTOMER') as v \gset cz_
update public.company_settings set customer_portal_enabled = true where company_id = :'co2_v';

create or replace function pg_temp.fg(p_company uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.portal_catalog(p_company)) x where x->>'code' = 'FG-4766'
$$;

-- ------------------------------------------------ portal OFF by default
select test.login(:'pa_v');
select test.throws(format($$ select public.portal_catalog(%L) $$, test.id('company')), '%portal is currently turned off%',
                   'Customer portal is OFF by default');
select test.login(null);
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');

-- ------------------------------------------------ 10: stock HIDDEN (default) / 13: rate hidden (default)
select test.login(:'pa_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock', '{"visibility": "HIDDEN"}'::jsonb, 'Stock HIDDEN: no quantity');
select test.eq(pg_temp.fg(test.id('company'))->'price', 'null'::jsonb, 'Rate hidden: no price');
select test.ok(not exists (select 1 from jsonb_array_elements(public.portal_catalog(test.id('company'))) x
                           where x->>'code' = 'RM-LYCRA'), 'Items not marked portal-visible are not listed');
select test.ok(not (pg_temp.fg(test.id('company')) ? 'purchase_price'), 'Internal purchase cost never exposed');

-- ------------------------------------------------ 11: stock visible — EXACT, STATUS, ATP
select test.login(null);
update public.company_settings set customer_stock_visibility = 'EXACT_QUANTITY' where company_id = test.id('company');
select test.login(:'pa_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock', '{"qty": 18000.000, "visibility": "EXACT_QUANTITY"}'::jsonb,
               'EXACT_QUANTITY: available 18000 (20000 − 2000 reserved), shown immediately');
select test.login(null);
update public.company_settings set customer_stock_visibility = 'AVAILABLE_STATUS' where company_id = test.id('company');
select test.login(:'pa_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock', '{"status": "IN_STOCK", "visibility": "AVAILABLE_STATUS"}'::jsonb,
               'AVAILABLE_STATUS: IN STOCK');
select test.login(null);
update public.items set reorder_level = 18000 where id = test.id('fg');
select test.login(:'pa_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock'->>'status', 'LOW_STOCK', 'AVAILABLE_STATUS: LOW STOCK at reorder level');
select test.login(null);
update public.company_settings set customer_stock_visibility = 'AVAILABLE_TO_PROMISE' where company_id = test.id('company');
select test.login(:'pa_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock', '{"qty": 15000.000, "visibility": "AVAILABLE_TO_PROMISE"}'::jsonb,
               'ATP: 18000 available − 3000 unreserved open order = 15000');
select test.login(null);
update public.godowns set portal_visible = false where id = test.id('b336');
select test.login(:'pa_v');
select test.eq((pg_temp.fg(test.id('company'))->'stock'->>'qty')::numeric, 0::numeric,
               'Stock of godowns hidden from portals is not counted');
select test.login(null);
update public.godowns set portal_visible = true where id = test.id('b336');

-- ------------------------------------------------ 14: rate visible; customer-specific price (§16)
update public.company_settings set customer_rate_visible = true where company_id = test.id('company');
select test.login(:'pa_v');
select test.eq((pg_temp.fg(test.id('company'))->>'price')::numeric, 145::numeric, 'Customer A sees his own price 145');
select test.login(:'pb_v');
select test.eq((pg_temp.fg(test.id('company'))->>'price')::numeric, 138::numeric, 'Customer B sees his own price 138');

-- ------------------------------------------------ 15: individual override beats company setting
select test.login(test.id('admin'));
insert into public.party_settings (party_id, stock_visibility, rate_visible) values (:'ca_v', 'HIDDEN', false);
update public.party_settings set stock_visibility = 'EXACT_QUANTITY' where party_id = :'ca_v';
select test.login(null);
update public.company_settings set customer_stock_visibility = 'HIDDEN', customer_rate_visible = true
 where company_id = test.id('company');
select test.login(:'pa_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock'->>'visibility', 'EXACT_QUANTITY',
               'Override: company HIDDEN, Customer A EXACT_QUANTITY');
select test.eq(pg_temp.fg(test.id('company'))->'price', 'null'::jsonb, 'Override: rate hidden for Customer A only');
select test.login(:'pb_v');
select test.eq(pg_temp.fg(test.id('company'))->'stock'->>'visibility', 'HIDDEN', 'Customer B follows company: HIDDEN');
select test.eq((pg_temp.fg(test.id('company'))->>'price')::numeric, 138::numeric, 'Customer B follows company: rate visible');
select test.eq((public.portal_context(test.id('company'), 'CUSTOMER')->>'stock_visibility'), 'HIDDEN', 'Context reports HIDDEN');
-- an operator cannot change visibility overrides (owner/admin only)
select test.login(test.id('operator'));
select test.throws(format($$ insert into public.party_settings (party_id, stock_visibility) values (%L, 'EXACT_QUANTITY') $$, :'cb_v'),
                   '%row-level security%', 'Operator cannot set a visibility override');

-- ------------------------------------------------ 30: unauthorized customer access
select test.login(:'pa_v');
select test.eq((select count(*) from public.parties)::int, 0, 'Portal user reads no parties table rows');
select test.eq((select count(*) from public.items)::int, 0, 'Portal user reads no items table rows');
select test.eq((select count(*) from public.stock_movements)::int, 0, 'Portal user sees no internal stock movements');
select test.eq((select count(*) from public.sales_orders)::int, 0, 'Portal user sees no sales order table rows');
select test.eq((select count(*) from public.customer_pos)::int, 0, 'Portal user sees no customer PO table rows');
select test.eq((select count(*) from public.journal_entries)::int, 0, 'Portal user sees no accounting');
select test.eq((select count(*) from public.v_inventory_items)::int, 0, 'Portal user sees nothing in internal inventory view');
select test.eq(jsonb_array_length(public.portal_my_orders(test.id('company'))), 0, 'Customer A sees none of Customer B orders');
select test.throws(format($$ select public.customer_po_approve(%L) $$, (select v from t where k = 'so')), '%not found%',
                   'Customer cannot approve a PO');
select test.throws(format($$ select public.sales_order_line_set_rate(%L, 1) $$,
                          (select id from public.sales_order_lines limit 1)), '%not found%',
                   'Customer cannot change an approved price');
select test.throws(format($$ select public.doc_save('SALES_ORDER', jsonb_build_object('company_id', %L, 'doc_date', current_date)) $$,
                          test.id('company')), 'Unknown company%', 'Customer cannot create internal documents');
select test.throws(format($$ select public.portal_vendor_pos(%L) $$, test.id('company')), 'Portal access denied%',
                   'Customer cannot open the vendor portal');
select test.throws(format($$ select public.inventory_item_detail(%L) $$, test.id('fg')), 'Item not found%',
                   'Customer cannot open the internal item detail');

-- ------------------------------------------------ 33: company isolation for portal users
select test.throws(format($$ select public.portal_catalog(%L) $$, :'co2_v'), 'Portal access denied%',
                   'Customer of company 1 cannot open the portal of company 2');
select test.throws(format($$ select public.portal_customer_po_create(%L, jsonb_build_object('po_no', 'Z',
                            'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1)))) $$, :'co2_v', :'fg2co_v'),
                   'Portal access denied%', 'Cannot create a PO in another company');
select test.throws(format($$ select public.portal_customer_po_create(%L, jsonb_build_object('po_no', 'Z',
                            'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1)))) $$, test.id('company'), :'fg2co_v'),
                   'Item not available%', 'Cannot order an item of another company');

-- deactivated portal user loses access at once
select test.login(test.id('admin'));
select public.portal_user_set_active((select id from public.portal_users where user_id = :'pa_v'), false);
select test.login(:'pa_v');
select test.throws(format($$ select public.portal_catalog(%L) $$, test.id('company')), 'Portal access denied%',
                   'Deactivated portal user is locked out');

-- ------------------------------------------------ invitation flow (OTP login → bootstrap)
select test.login(test.id('admin'));
select public.portal_invite(:'cb_v', 'CUSTOMER', 'New.Buyer@cust-b.test', 'Buyer B') as v \gset inv_
select test.login(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000b0b0', 'new.buyer@cust-b.test');
select test.login('00000000-0000-0000-0000-00000000b0b0');
select test.eq((public.session_bootstrap()->'portals'->0->>'party_id')::uuid, :'cb_v'::uuid, 'Invited email linked to Customer B after login');
select test.eq(jsonb_array_length(public.portal_catalog(test.id('company'))) > 0, true, 'Invited customer can use the portal');
select test.eq(jsonb_array_length(public.session_bootstrap()->'companies'), 0, 'Portal user is not an internal member');
rollback;
