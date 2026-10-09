-- =============================================================================
-- PLATFORM R2 — configurable portal rights (portal roles × party visibility).
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('PORTAL2-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
update public.company_settings set customer_portal_enabled = true, vendor_portal_enabled = true,
       customer_stock_visibility = 'EXACT_QUANTITY', customer_rate_visible = true, customer_outstanding_visible = false
 where company_id = test.id('company');
select test.party(test.id('company'), 'CA', 'CUSTOMER') as v \gset ca_
select test.party(test.id('company'), 'CB', 'CUSTOMER') as v \gset cb_
select test.party(test.id('company'), 'VA', 'SUPPLIER') as v \gset va_
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pa_
select test.portal_user(test.id('company'), :'cb_v', 'CUSTOMER') as v \gset pb_
select test.portal_user(test.id('company'), :'va_v', 'VENDOR') as v \gset pv_
update public.items set portal_visible = true, sale_price = 190 where id = test.id('fg');
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 36);

-- ------------------------------------------------ defaults = today's rights
select test.ok((select r.code from public.portal_users pu join public.roles r on r.id = pu.role_id where pu.user_id = :'pa_v') = 'CUSTOMER_ADMIN',
               'New customer login gets the CUSTOMER_ADMIN portal role');
select test.ok((select r.code from public.portal_users pu join public.roles r on r.id = pu.role_id where pu.user_id = :'pv_v') = 'VENDOR_ADMIN',
               'New vendor login gets the VENDOR_ADMIN portal role');
select test.login(:'pa_v');
select test.ok(public.portal_my_invoices(test.id('company')) is not null, 'Customer admin: invoices');
select test.ok(public.portal_my_payments(test.id('company')) is not null, 'Customer admin: payments');
select test.ok((select x->'stock'->>'visibility' from jsonb_array_elements(public.portal_catalog(test.id('company'))) x where x->>'code' = 'FG-4766') = 'EXACT_QUANTITY',
               'Customer admin: stock as configured');
select test.ok('portal_customer.create_po' = any (array(select jsonb_array_elements_text(public.portal_context(test.id('company'), 'CUSTOMER')->'features'))),
               'Context lists the features of the login');

-- ------------------------------------------------ Customer B: user role (no invoices / payments / stock)
select test.login(test.id('admin'));
insert into t values ('cu', (select id from public.roles where company_id = test.id('company') and code = 'CUSTOMER_USER'));
select public.portal_user_set_role((select id from public.portal_users where user_id = :'pb_v'), (select v from t where k = 'cu'));
select public.role_set_permissions((select v from t where k = 'cu'),
  array['portal_customer.catalog', 'portal_customer.view_rates', 'portal_customer.create_po', 'portal_customer.view_pos']);
select test.login(:'pb_v');
select test.throws(format($$ select public.portal_my_invoices(%L) $$, test.id('company')), 'This portal feature is not enabled%',
                   'Customer user: invoices refused by the database');
select test.throws(format($$ select public.portal_my_payments(%L) $$, test.id('company')), 'This portal feature is not enabled%',
                   'Customer user: payments refused');
select test.throws(format($$ select public.portal_documents(%L, 'CUSTOMER') $$, test.id('company')), 'This portal feature is not enabled%',
                   'Customer user: documents refused');
select test.eq((select x->'stock'->>'visibility' from jsonb_array_elements(public.portal_catalog(test.id('company'))) x where x->>'code' = 'FG-4766'),
               'HIDDEN', 'No stock right → stock HIDDEN although the company shows it');
select test.ok((public.portal_context(test.id('company'), 'CUSTOMER')->>'rate_visible')::boolean, 'Rates right → rates visible');
select test.login(test.id('admin'));
select public.role_set_permissions((select v from t where k = 'cu'), array['portal_customer.catalog', 'portal_customer.create_po']);
select test.login(:'pb_v');
select test.ok(not (public.portal_context(test.id('company'), 'CUSTOMER')->>'rate_visible')::boolean, 'Rates right removed → rates hidden');

-- per-customer visibility still applies on top of the role
select test.login(test.id('admin'));
insert into public.party_settings (party_id, stock_visibility, outstanding_visible) values (:'ca_v', 'AVAILABLE_STATUS', true);
select test.login(:'pa_v');
select test.eq((select x->'stock'->>'visibility' from jsonb_array_elements(public.portal_catalog(test.id('company'))) x where x->>'code' = 'FG-4766'),
               'AVAILABLE_STATUS', 'Customer A override: availability status only');
select test.eq((public.portal_my_outstanding(test.id('company'))->>'visible'), 'true', 'Customer A override: outstanding visible (company: hidden)');
select test.login(:'pb_v');
select test.throws(format($$ select public.portal_my_outstanding(%L) $$, test.id('company')), 'This portal feature is not enabled%',
                   'Customer B: no outstanding feature');

-- ------------------------------------------------ vendor features
select test.login(test.id('admin'));
select public.portal_user_set_role((select id from public.portal_users where user_id = :'pv_v'),
                                   (select id from public.roles where company_id = test.id('company') and code = 'VENDOR_USER'));
select test.login(:'pv_v');
select test.ok(public.portal_vendor_pos(test.id('company')) is not null, 'Vendor user: purchase orders');
select test.throws(format($$ select public.portal_vendor_payments(%L) $$, test.id('company')), 'This portal feature is not enabled%',
                   'Vendor user: payments refused');

-- ------------------------------------------------ role types cannot be mixed
select test.login(test.id('admin'));
select test.throws(format($$ select public.portal_user_set_role((select id from public.portal_users where user_id = %L), (select id from public.roles where company_id = %L and code = 'ADMIN')) $$,
                          :'pa_v', test.id('company')), 'Portal role does not fit%', 'Staff role cannot be given to a portal login');
select test.throws(format($$ select public.portal_user_set_role((select id from public.portal_users where user_id = %L), (select id from public.roles where company_id = %L and code = 'VENDOR_USER')) $$,
                          :'pa_v', test.id('company')), 'Portal role does not fit%', 'Vendor role cannot be given to a customer login');
select test.throws(format($$ select public.role_set_permissions(%L, array['items.view']) $$, (select v from t where k = 'cu')),
                   '%does not fit a customer portal role%', 'Staff permissions cannot be put into a portal role');
select test.throws(format($$ select public.role_set_permissions((select id from public.roles where company_id = %L and code = 'VIEWER'), array['portal_customer.catalog']) $$,
                          test.id('company')), '%does not fit a internal role%', 'Portal permissions cannot be put into a staff role');
select test.throws(format($$ select public.user_set_roles(%L, %L, array[%L::uuid]) $$, test.id('company'), test.id('operator'), (select v from t where k = 'cu')),
                   '%is a portal role%', 'Portal role cannot be given to a staff user');
select test.ok(public.role_save(test.id('company'), null, '{"code":"KEY_CUSTOMER","name":"Key customer","kind":"CUSTOMER_PORTAL"}') is not null,
               'Admin creates a new portal role (configuration, no code)');
select test.login(test.id('operator'));
select test.throws(format($$ select public.portal_user_set_role((select id from public.portal_users where user_id = %L), %L) $$, :'pa_v', (select v from t where k = 'cu')),
                   '%', 'Operator cannot change portal roles');
select test.login(test.id('admin'));
select test.ok(exists (select 1 from public.audit_log where table_name = 'portal_users' and action = 'ROLE'), 'Portal role changes audited');

rollback;
