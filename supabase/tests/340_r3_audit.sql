-- =============================================================================
-- PLATFORM R3 — audit log (W4, D4)
--   coverage of the listed events, request metadata, redaction, access
--   (audit.view, company, godown / customer / vendor / item scope; OWNER all),
--   masking of financial values, append-only, export, paging.
-- AC 4.1–4.7, 4.9, 4.10 (AC-4.8 performance: scripts/db/perf-r3.sh)
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('AUD-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'CX', 'CUSTOMER') as v \gset cx_
select test.party(test.id('company'), 'CY', 'CUSTOMER') as v \gset cy_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 100);
select test.stock_in(test.id('company'), test.id('fg'), test.id('warehouse'), 100);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000a0d01', 'newuser@audit.local');
select id as v from public.voucher_books where company_id = test.id('company') and code = 'MAIN' \gset book_
select id as v from public.accounts where company_id = test.id('company') and system_key = 'CASH' \gset cash_

-- the API gateway passes the client address and agent in request.headers
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 AuditTest"}', true);

-- ------------------------------------------------------------ AC-4.1: the listed events (as the owner)
select test.login(test.id('admin'));
select public.user_create_complete(test.id('company'), '00000000-0000-0000-0000-0000000a0d01',
  jsonb_build_object('kind', 'INTERNAL', 'email', 'newuser@audit.local', 'full_name', 'New user',
                     'role_ids', jsonb_build_array((select id from public.roles where company_id = test.id('company') and code = 'OPERATOR'))), true);
select public.user_set_status(test.id('company'), '00000000-0000-0000-0000-0000000a0d01', false, 'left');
insert into t values ('aud_role', public.role_save(test.id('company'), null, '{"code":"AUDITOR","name":"Auditor"}'));
select public.role_set_permissions((select v from t where k = 'aud_role'), array['audit.view', 'items.view', 'customers.view']);
update public.items set sale_price = 321 where id = test.id('fg');
select public.party_save(test.id('company'), :'cx_v', '{"notes":"changed"}');
select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', current_date, 'godown_id', test.id('warehouse'), 'reason', 'DAMAGE',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', -1, 'qty', 1, 'unit_id', test.id('pair'))))));
select public.export_rows(test.id('company'), 'ITEMS');
insert into t values ('vch', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', current_date, 'voucher_type', 'RECEIPT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v', 'party_id', :'cx_v', 'amount', 100)));
select public.doc_save('VOUCHER', jsonb_build_object('id', (select v from t where k = 'vch'),
  'company_id', test.id('company'), 'doc_date', current_date, 'voucher_type', 'RECEIPT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v', 'party_id', :'cx_v', 'amount', 150, 'narration', 'edited'));
insert into t select 'doc', (public.document_register(jsonb_build_object('company_id', test.id('company'), 'entity_type', 'party',
  'entity_id', :'cx_v', 'storage_path', test.id('company') || '/party/x.pdf', 'file_name', 'x.pdf', 'send_email', false))->>'document_id')::uuid;
select public.document_delete((select v from t where k = 'doc'));
select public.settings_save(test.id('company'), 'portal', '{"customer_portal_enabled": true}');
select public.sequence_save(test.id('company'), 'SALES_ORDER', '{"prefix":"S-"}');
select public.settings_save(test.id('company'), 'branding', '{"app_name": "Audit Co"}');
select public.module_set(test.id('company'), 'FACTORY', false);

select test.eq((select string_agg(e, ', ') from unnest(array[
    'users:CREATE', 'users:DISABLE', 'roles:%PERMISSIONS%', 'items:UPDATE', 'parties:UPDATE', 'stock_adjustments:%',
    'export_log:EXPORT', 'vouchers:UPDATE', 'documents:DELETE', 'company_settings:SETTINGS', 'document_sequences:NUMBERING',
    'company_branding:SETTINGS', 'company_modules:DISABLE']) e
  where not exists (select 1 from public.audit_log a where a.company_id = test.id('company')
                    and a.table_name || ':' || a.action like e)),
  null, 'Every listed event is audited (user, role, rate, masters, stock, export, payment, document, portal, numbering, branding, module)');
select test.ok((select bool_and(actor_id = test.id('admin') and at is not null) from public.audit_log
                where company_id = test.id('company') and table_name in ('items', 'company_branding', 'company_modules')),
               'Rows carry who and when');
select test.ok(jsonb_array_length(public.audit_search(test.id('company'), jsonb_build_object('table_name', 'items', 'row_id', test.id('fg')::text), 10, null)) > 0,
               'Rate change visible in the viewer');
-- imports
select public.import_create(test.id('company'), 'BRANDS', 'b.xlsx', 'ALL_OR_NOTHING', false, array['name']) ->> 'job_id' as v \gset job_
select public.import_add_rows(:'job_v', '[{"row_no":2,"data":{"name":"ACME"}}]');
select public.import_validate(:'job_v');
select public.import_commit(:'job_v', true)->>'status';
select test.ok(exists (select 1 from public.audit_log where company_id = test.id('company') and table_name = 'import_jobs'), 'Import commit audited');
select test.eq((select code from public.brands where company_id = test.id('company') and name = 'ACME'), 'ACME', 'Brand without a code gets one from its name');

-- ------------------------------------------------------------ AC-4.2: request metadata
select test.eq((select request_meta->>'ip' || ' | ' || (request_meta->>'user_agent') from public.audit_log
                where company_id = test.id('company') and table_name = 'company_modules' order by id desc limit 1),
               '203.0.113.7 | Mozilla/5.0 AuditTest', 'IP and user agent recorded');

-- ------------------------------------------------------------ AC-4.3: redaction (app.audit is internal: not callable by API users)
select test.throws('select app.audit(null, ''x'', ''x'', ''x'', null, null)', 'permission denied%', 'API users cannot write audit rows');
select test.login(null);
select app.audit(test.id('company'), 'users', 'x', 'PASSWORD_RESET', null,
                 '{"temporary_password":"Tmp-Secret-123","nested":{"access_token":"tok123","smtp_password":"p"},"list":[{"api_key":"k"}],"email":"a@b"}');
select test.eq((select new_data from public.audit_log where company_id = test.id('company') and row_id = 'x'),
               '{"list": [{"api_key": "[REDACTED]"}], "email": "a@b", "nested": {"smtp_password": "[REDACTED]", "access_token": "[REDACTED]"}, "temporary_password": "[REDACTED]"}'::jsonb,
               'Passwords, tokens and keys are redacted before they are written (also nested)');
select test.login(null);
select test.eq((select count(*) from public.audit_log a, lateral jsonb_each_text(coalesce(a.new_data, '{}') || coalesce(a.old_data, '{}')) e(k, v)
                where e.k ~* '(password|secret|token|otp|api[_-]?key|smtp|credential)' and e.v <> '[REDACTED]'
                  and jsonb_typeof(coalesce(a.new_data, a.old_data)) = 'object')::int, 0,
               'No audit row holds a password / token / secret value');

-- ------------------------------------------------------------ AC-4.4: no audit.view
select test.login(test.id('operator'));
select test.eq((select count(*) from public.audit_log where company_id = test.id('company'))::int, 0, 'Operator reads no audit rows');
select test.eq(jsonb_array_length(public.audit_search(test.id('company'), '{}', 50, null)), 0, 'Audit RPC returns nothing to the operator');
select test.throws(format($$ select public.audit_export(%L, '{}') $$, test.id('company')), '%audit.export%', 'Export refused');
select test.throws('select new_data from public.audit_log limit 1', 'permission denied%', 'Old / new values are not directly selectable');

-- ------------------------------------------------------------ AC-4.6: other company
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('AUD-TEST-B'));
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(public.audit_search((select (v->>'company')::uuid from test.ctx where k = 'fx2'), '{}', 50, null)), 0,
               'Company A owner sees nothing of company B');
select test.eq((select count(*) from public.audit_log where company_id = (select (v->>'company')::uuid from test.ctx where k = 'fx2'))::int, 0,
               '... not even through the table');

-- ------------------------------------------------------------ AC-4.9 / 4.10 / 4.5: scoped and masked auditor
select test.login(null);
select test.user_with_role(test.id('company'), 'AUDITOR') as v \gset au_
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), :'au_v', 'GODOWN', array[test.id('b336')]);
select public.user_set_scope(test.id('company'), :'au_v', 'CUSTOMER', array[:'cy_v'::uuid]);
select test.login(:'au_v');
select test.ok(not exists (select 1 from public.audit_log where table_name = 'stock_adjustments'), 'Godown-B adjustment hidden from a Godown-A auditor');
select test.ok(not exists (select 1 from public.audit_log where table_name = 'parties' and row_id = :'cx_v'), 'Customer X changes hidden (scope: customer Y)');
select test.ok(exists (select 1 from public.audit_log where table_name = 'company_branding'), 'Company-level rows (no scope keys) visible');
select test.ok((select bool_and(x->'new_data'->>'sale_price' = '•••')
                from jsonb_array_elements(public.audit_search(test.id('company'), jsonb_build_object('table_name', 'items', 'row_id', test.id('fg')::text), 50, null)) x
                where x->'new_data' ? 'sale_price'), 'Sale price masked for an auditor without the sale-rate right');
select test.login(test.id('admin'));
select test.ok(exists (select 1 from public.audit_log where table_name = 'stock_adjustments'), 'Owner sees all scopes');
select test.ok((select bool_or(x->'new_data'->>'sale_price' = '321.0000')
                from jsonb_array_elements(public.audit_search(test.id('company'), jsonb_build_object('table_name', 'items', 'row_id', test.id('fg')::text), 50, null)) x),
               'Owner sees the values unmasked');
select test.ok((select bool_and(scope_godowns = array[test.id('warehouse')]) from public.audit_log
                where company_id = test.id('company') and table_name in ('stock_adjustments', 'stock_adjustment_lines')),
               'Scope keys derived from the row (lines from their header)');

-- ------------------------------------------------------------ AC-4.7: append-only
select test.login(test.id('admin'));
select test.throws(format($$ update public.audit_log set action = 'X' where company_id = %L $$, test.id('company')), 'permission denied%',
                   'Owner cannot update audit rows through the API');
select test.throws(format($$ delete from public.audit_log where company_id = %L $$, test.id('company')), 'permission denied%',
                   'Owner cannot delete audit rows through the API');
select test.login(null);
select test.throws(format($$ delete from public.audit_log where company_id = %L $$, test.id('company')), '%append-only%',
                   'Audit rows cannot be deleted even by the service role');
select test.throws(format($$ update public.audit_log set action = 'X' where company_id = %L $$, test.id('company')), '%append-only%',
                   'Audit rows cannot be updated even by the service role');

-- ------------------------------------------------------------ viewer: filters, paging, export
select test.login(test.id('admin'));
select test.ok((select bool_and(x->>'table_name' = 'items') from jsonb_array_elements(public.audit_search(test.id('company'), '{"table_name":"items"}', 50, null)) x),
               'Filter by area');
select test.ok((select bool_and((x->>'actor_id')::uuid = test.id('admin'))
                from jsonb_array_elements(public.audit_search(test.id('company'), jsonb_build_object('actor_id', test.id('admin'), 'from', current_date, 'to', current_date), 50, null)) x),
               'Filter by user and date');
create temp table pg (n int, ids bigint[]) on commit drop;
grant all on pg to authenticated;
insert into pg select 1, array(select (x->>'id')::bigint from jsonb_array_elements(public.audit_search(test.id('company'), '{}', 5, null)) x);
insert into pg select 2, array(select (x->>'id')::bigint from jsonb_array_elements(public.audit_search(test.id('company'), '{}', 5,
                                 (select ids[5] from pg where n = 1))) x);
select test.ok((select cardinality(ids) = 5 from pg where n = 2) and not exists (select 1 from pg a, pg b where a.n = 1 and b.n = 2 and a.ids && b.ids),
               'Paging: the next page continues without overlap');
select test.eq(jsonb_array_length(public.audit_export(test.id('company'), '{}')),
               (select count(*)::int from public.audit_log where company_id = test.id('company')), 'Export returns every filtered row');
select test.ok(exists (select 1 from public.export_log where company_id = test.id('company') and entity = 'AUDIT'), 'The export itself is logged');

-- ------------------------------------------------------------ coverage registry
select test.login(null);
select test.eq((select string_agg(c.table_name, ', ') from app.audit_coverage c
                where c.mechanism in ('TRIGGER', 'GUARD') and to_regclass('public.' || c.table_name) is not null
                  and not exists (select 1 from pg_trigger tr where tr.tgrelid = ('public.' || c.table_name)::regclass and not tr.tgisinternal
                                  and tr.tgfoid in ('app.tg_audit_row'::regproc, 'app.tg_settings_section_guard'::regproc, 'app.tg_sequence_guard'::regproc,
                                                    (select oid from pg_proc where proname = 'tg_user_roles_audit' limit 1)))),
               null, 'Every registered table has its audit trigger');
rollback;
