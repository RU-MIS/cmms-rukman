-- =============================================================================
-- PLATFORM R3 — company branding (W5), security settings (W6), onboarding
--   branding per company (isolation, rights, validation, portal visibility,
--   session bootstrap, PO print), password policy, temporary-password expiry,
--   login overview, a new company configured without code changes.
--   Storage-bucket policies and upload limits need the real Storage API:
--   e2e/api/r3-platform.test.mjs.
-- AC 5.1, 5.2 (data), 5.5, 5.6 (database part), 6.1 (policy), 6.2, 6.3
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('BRAND-A'));
insert into test.ctx values ('fxb', test.fixture('BRAND-B'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;
create or replace function pg_temp.b(p_key text) returns uuid language sql as $$ select (v->>p_key)::uuid from test.ctx where k = 'fxb' $$;

select test.login(null);
select test.party(test.id('company'), 'CA', 'CUSTOMER') as v \gset ca_
select test.party(test.id('company'), 'VA', 'SUPPLIER') as v \gset va_
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pu_

-- ------------------------------------------------------------ AC-5.1: company A sets its branding
select test.login(test.id('admin'));
select public.settings_save(test.id('company'), 'branding', jsonb_build_object(
  'app_name', 'Rukman Footwear', 'short_name', 'RUK', 'primary_color', '#0B5FFF',
  'logo_path', test.id('company') || '/logo.png', 'favicon_path', test.id('company') || '/favicon.ico',
  'document_footer', 'Thank you for your business', 'email_from_name', 'Rukman Purchase', 'email_reply_to', 'purchase@rukman.example'));
select test.eq((select x->'branding'->>'app_name' from jsonb_array_elements(public.session_bootstrap()->'companies') x
                where (x->>'id')::uuid = test.id('company')), 'Rukman Footwear', 'Members get the branding with their session');
select test.login(:'pu_v');
select test.eq((select x->'branding'->>'primary_color' from jsonb_array_elements(public.session_bootstrap()->'portals') x), '#0B5FFF',
               'Portal users get their company''s branding');
select test.ok(exists (select 1 from public.company_branding where company_id = test.id('company')), 'Portal user can read the branding row');
select test.login(pg_temp.b('admin'));
select test.ok(not exists (select 1 from public.company_branding where company_id = test.id('company')), 'Company B cannot read A''s branding');
select test.ok((select x->'branding'->>'app_name' is null from jsonb_array_elements(public.session_bootstrap()->'companies') x), 'Company B keeps the default branding');
update public.company_branding set app_name = 'Hijacked' where company_id = test.id('company');
select test.throws(format($$ select public.settings_save(%L, 'branding', '{"app_name":"Hijacked"}') $$, test.id('company')), 'Unknown company%',
                   'Company B owner cannot change A''s branding');
select test.login(test.id('admin'));
select test.eq((select app_name from public.company_branding where company_id = test.id('company')), 'Rukman Footwear', 'A''s branding unchanged');

-- validation
select test.throws(format($$ select public.settings_save(%L, 'branding', '{"primary_color":"blue"}') $$, test.id('company')), '%primary_color%',
                   'Colour must be a hex value');
select test.throws(format($$ select public.settings_save(%L, 'branding', '{"email_reply_to":"not-an-email"}') $$, test.id('company')), '%email_reply_to%',
                   'Reply-to must be an e-mail address');
select test.throws(format($$ select public.settings_save(%L, 'branding', jsonb_build_object('logo_path', %L)) $$, test.id('company'), pg_temp.b('company') || '/logo.png'),
                   '%company folder%', 'Logo must be in the company''s own folder');
select test.throws(format($$ select public.settings_save(%L, 'branding', jsonb_build_object('logo_path', %L)) $$, test.id('company'), test.id('company') || '/../x.png'),
                   '%logo_path%', 'No path traversal');

-- ------------------------------------------------------------ AC-5.5: rights
select test.login(test.id('operator'));
select test.throws(format($$ select public.settings_save(%L, 'branding', '{"app_name":"X"}') $$, test.id('company')), '%settings_branding.edit%',
                   'Operator cannot change branding (RPC)');
update public.company_branding set app_name = 'X' where company_id = test.id('company');   -- direct API: no row may change
select test.login(test.id('admin'));
select test.eq((select app_name from public.company_branding where company_id = test.id('company')), 'Rukman Footwear',
               'Branding unchanged after the operator''s direct API update');
select test.ok(exists (select 1 from public.audit_log where company_id = test.id('company') and table_name = 'company_branding' and action = 'SETTINGS'),
               'Branding change audited');

-- ------------------------------------------------------------ AC-5.2: PO print carries logo, footer and terms
select public.settings_save(test.id('company'), 'purchase', '{"purchase_terms":"Delivery within 7 days"}');
insert into t values ('po', public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date,
  'party_id', :'va_v', 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 1, 'unit_id', test.id('mtr'), 'rate', 10)))));
select public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po'));
select test.eq((select row(p->'branding'->>'logo_path', p->'branding'->>'document_footer', p->>'purchase_terms', p->'branding'->>'email_reply_to')::text
                from (select public.purchase_order_print((select v from t where k = 'po')) p) x),
               row(test.id('company') || '/logo.png', 'Thank you for your business', 'Delivery within 7 days', 'purchase@rukman.example')::text,
               'PO print data has the logo, footer, terms and reply-to of company A');

-- ------------------------------------------------------------ AC-6.1: password policy (enforced by admin-users / change-password)
select public.settings_save(test.id('company'), 'security', '{"password_min_length": 12, "temp_password_valid_days": 3, "idle_logout_minutes": 30}');
select test.eq(public.password_policy()->>'min_length', '12', 'Policy reports minimum length 12');
select test.throws(format($$ select public.settings_save(%L, 'security', '{"password_min_length": 6}') $$, test.id('company')), '%',
                   'Minimum length below 8 refused');
select test.login(test.id('operator'));
select test.eq((public.password_policy()->>'min_length')::int, 12, 'Members of the company get the company policy');
select test.eq((select (x->>'idle_logout_minutes')::int from jsonb_array_elements(public.session_bootstrap()->'companies') x), 30,
               'Idle sign-out minutes in the session');
select test.throws(format($$ select public.settings_save(%L, 'security', '{"password_min_length": 8}') $$, test.id('company')), '%settings_security.edit%',
                   'Operator cannot weaken the policy');

-- ------------------------------------------------------------ AC-6.2: temporary-password expiry
select test.login(null);
update public.profiles set must_change_password = true, password_changed_at = now() - interval '4 days' where id = test.id('operator');
select test.ok(app.temp_password_expired(test.id('operator')), 'Temporary password older than 3 days has expired');
select test.login(test.id('operator'));
select test.ok((public.session_bootstrap()->>'temp_password_expired')::boolean, 'The app is told (shows "ask your administrator")');
select test.eq((select count(*) from public.items)::int, 0, 'No data while the temporary password is pending');
select test.login(null);
select test.throws(format($$ update auth.users set encrypted_password = 'new-hash' where id = %L $$, test.id('operator')),
                   '%temporary password has expired%', 'The expired temporary password cannot be changed into a real one');
update public.profiles set password_reset_pending_until = now() + interval '10 minutes' where id = test.id('operator');
update auth.users set encrypted_password = 'admin-reset' where id = test.id('operator');
select test.ok((select must_change_password and not app.temp_password_expired(id) from public.profiles where id = test.id('operator')),
               'A new reset by the administrator starts a fresh temporary password');
update auth.users set encrypted_password = 'user-own' where id = test.id('operator');
select test.ok((select not must_change_password from public.profiles where id = test.id('operator')), 'User sets his own password in time');

-- ------------------------------------------------------------ AC-6.3: login overview
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.9", "user-agent": "LoginAgent/1.0"}', true);
update auth.users set last_sign_in_at = now() where id = test.id('operator');
select test.login(test.id('operator'));
select public.session_bootstrap();
select test.throws(format($$ select public.login_overview(%L) $$, test.id('company')), '%settings_security.view%', 'Operator cannot open the login overview');
select test.login(test.id('admin'));
select test.ok((select bool_or(x->'request_meta'->>'ip' = '198.51.100.9' and x->'request_meta'->>'user_agent' = 'LoginAgent/1.0')
                from jsonb_array_elements(public.login_overview(test.id('company'))->'recent_logins') x), 'Last login with IP and user agent');
select test.ok((select bool_or(x->>'last_sign_in_at' is not null) from jsonb_array_elements(public.login_overview(test.id('company'))->'users') x),
               'Last login per user');
select test.login(pg_temp.b('admin'));
select test.throws(format($$ select public.login_overview(%L) $$, test.id('company')), 'Unknown company%', 'Other company refused');

-- ------------------------------------------------------------ AC-5.6: a new company is configured without code changes
select test.login(null);
select test.ok(exists (select 1 from public.company_branding where company_id = pg_temp.b('company')), 'New company has its branding row');
select test.ok((select count(*) >= 28 from public.document_sequences where company_id = pg_temp.b('company')), 'New company has every sequence');
select test.ok((select count(*) >= 9 from public.roles where company_id = pg_temp.b('company')), 'New company has the default roles');
select test.login(pg_temp.b('admin'));
select public.settings_save(pg_temp.b('company'), 'company', '{"trade_name":"Second Co","city":"Mumbai"}');
select public.settings_save(pg_temp.b('company'), 'branding', jsonb_build_object('app_name', 'Second ERP', 'primary_color', '#123456'));
select public.sequence_save(pg_temp.b('company'), 'PURCHASE_ORDER', '{"prefix":"B-PO-"}');
select public.settings_save(pg_temp.b('company'), 'inventory', '{"allow_negative_stock": true}');
select test.eq((select x->>'name' || ' / ' || (x->'branding'->>'app_name') from jsonb_array_elements(public.session_bootstrap()->'companies') x),
               'Second Co / Second ERP', 'Second company: profile and branding set through the API');
select test.login(test.id('admin'));
select test.eq((select app_name from public.company_branding where company_id = test.id('company')), 'Rukman Footwear', 'Company A unaffected');
rollback;
