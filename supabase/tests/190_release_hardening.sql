-- Regression tests for docs/RELEASE_AUDIT.md (C1, H3, M1, M2, M3, M8).
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('REL-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- ------------------------------------------------ C1 unverified email cannot claim invitations
select test.login(test.id('admin'));
select public.user_invite(test.id('company'), 'new.manager@rel.test', 'ADMIN', 'Manager');
select test.login(null);
select test.party(test.id('company'), 'CUST-R', 'CUSTOMER') as v \gset cr_
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');
select test.login(test.id('admin'));
select public.portal_invite(:'cr_v', 'CUSTOMER', 'buyer@rel.test');
select test.login(null);
-- attacker registers both addresses without verifying them
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'new.manager@rel.test', null),
  ('00000000-0000-0000-0000-0000000000a2', 'buyer@rel.test', null);
select test.login('00000000-0000-0000-0000-0000000000a1');
select test.eq(jsonb_array_length(public.session_bootstrap()->'companies'), 0, 'Unverified email does not receive the invited ADMIN role');
select test.login('00000000-0000-0000-0000-0000000000a2');
select test.eq(jsonb_array_length(public.session_bootstrap()->'portals'), 0, 'Unverified email does not receive the portal login');
select test.throws(format($$ select public.portal_catalog(%L) $$, test.id('company')), 'Portal access denied%', 'Unverified user has no portal access');
-- after verification (OTP / confirmation link) the invitation is linked
select test.login(null);
update auth.users set email_confirmed_at = now() where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
select test.login('00000000-0000-0000-0000-0000000000a1');
select test.eq(jsonb_array_length(public.session_bootstrap()->'companies'), 1, 'Verified email receives the invited role');
select test.login('00000000-0000-0000-0000-0000000000a2');
select test.eq(jsonb_array_length(public.session_bootstrap()->'portals'), 1, 'Verified email receives the portal login');
-- invite of an existing but unverified user is not linked immediately
select test.login(null);
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a3', 'pending@rel.test', null);
select test.login(test.id('admin'));
select public.user_invite(test.id('company'), 'pending@rel.test', 'VIEWER');
select test.ok(not exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000a3'),
               'user_invite does not grant a role to an unverified account');

-- ------------------------------------------------ H3 base unit locked once used
select test.login(null);
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 10);
select test.login(test.id('admin'));
select test.throws(format($$ update public.items set base_unit_id = %L where id = %L $$, test.id('pcs'), test.id('fg')),
                   '%base unit%cannot be changed%', 'Base unit of an item with stock cannot be changed');
insert into public.items (company_id, code, name, item_kind, base_unit_id) values (test.id('company'), 'NEW-1', 'New one', 'PACKING', test.id('pcs'))
returning id as v \gset new_
update public.items set base_unit_id = test.id('mtr') where id = :'new_v';
select test.eq((select base_unit_id from public.items where id = :'new_v'), test.id('mtr'), 'Unused item: base unit can still be corrected');

-- ------------------------------------------------ M1 owner role protection
select test.login(null);
select test.user_with_role(test.id('company'), 'ADMIN') as v \gset adm2_
select test.login(:'adm2_v');
select test.throws(format($$ insert into public.user_roles (user_id, company_id, role_id) values (%L, %L,
                            (select id from public.roles where company_id = %L and code = 'OWNER')) $$, :'adm2_v', test.id('company'), test.id('company')),
                   'Only an owner can grant%', 'Admin cannot make himself OWNER');
select test.login(test.id('admin'));   -- creator = OWNER
select test.throws(format($$ delete from public.user_roles where user_id = %L and role_id = (select id from public.roles where company_id = %L and code = 'OWNER') $$,
                          test.id('admin'), test.id('company')), '%at least one owner%', 'Last owner cannot be removed');
insert into public.user_roles (user_id, company_id, role_id)
select :'adm2_v', test.id('company'), id from public.roles where company_id = test.id('company') and code = 'OWNER';
select test.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = :'adm2_v' and r.code = 'OWNER'),
               'Owner can grant OWNER');

-- ------------------------------------------------ M2 manual SO cannot fake a customer-PO link / quote
insert into t values ('cpo', public.customer_po_create(test.id('company'), :'cr_v', jsonb_build_object('po_no', 'R-1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'), 'quoted_rate', 5)))));
select test.throws(format($$ select public.doc_submit('SALES_ORDER', public.doc_save('SALES_ORDER', jsonb_build_object(
  'company_id', %L, 'doc_date', current_date, 'party_id', %L, 'customer_po_no', 'FAKE', 'customer_po_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L, 'rate', 1))))) $$,
  test.id('company'), :'cr_v', (select v from t where k = 'cpo'), test.id('fg'), test.id('pair')),
  'Orders of a customer PO are created by approving%', 'Manual sales order cannot claim a customer PO');
insert into t values ('so', public.doc_save('SALES_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', current_date,
  'party_id', :'cr_v', 'customer_po_no', 'PHONE-1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'), 'rate', 9, 'quoted_rate', 1)))));
select public.doc_submit('SALES_ORDER', (select v from t where k = 'so'));
select test.ok((select quoted_rate is null and reference_rate is null and rate = 9 from public.sales_order_lines where order_id = (select v from t where k = 'so')),
               'Manual order keeps its entered rate but no fake quote');

-- ------------------------------------------------ M3 duplicate reminder enqueue is silently skipped
select test.login(null);
update public.company_settings set email_automation = true where company_id = test.id('company');
update public.company_settings set customer_document_email = true where company_id = test.id('company');
select test.ok(app.enqueue_email(test.id('company'), 'CUSTOMER_DOCUMENT', null, 's', 'b', p_to => array['x@rel.test'], p_dedupe_key => 'K2') is not null, 'Queued once');
select test.ok(app.enqueue_email(test.id('company'), 'CUSTOMER_DOCUMENT', null, 's', 'b', p_to => array['x@rel.test'], p_dedupe_key => 'K2') is null, 'Same dedupe key → skipped, no error');

-- ------------------------------------------------ M4 views are read-only for users
select test.login(test.id('admin'));
select test.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'v'
                             and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
                               or has_table_privilege('authenticated', c.oid, 'DELETE'))),
               'No view is writable by users');
select test.throws(format($$ delete from public.company_settings where company_id = %L $$, test.id('company')), 'permission denied%',
                   'Settings row cannot be deleted');

-- ------------------------------------------------ M8 settings ranges
select test.throws(format($$ update public.company_settings set email_max_attempts = 0 where company_id = %L $$, test.id('company')),
                   '%company_settings_email_attempts_chk%', 'Max attempts must be 1..20');
select test.throws(format($$ update public.company_settings set customer_reminder_start_days = -1 where company_id = %L $$, test.id('company')),
                   '%company_settings_customer_days_chk%', 'Reminder days cannot be negative');
-- an owner creates a second company from the app: he becomes its first OWNER
select test.login(test.id('admin'));
select public.create_company(jsonb_build_object('code', 'REL-2', 'legal_name', 'Rel Two')) as v \gset co2_
select test.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                       where ur.company_id = :'co2_v' and ur.user_id = test.id('admin') and r.code = 'OWNER'), 'Creator becomes OWNER of the new company');
rollback;
