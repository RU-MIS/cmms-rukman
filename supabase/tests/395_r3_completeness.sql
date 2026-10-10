-- =============================================================================
-- PLATFORM R3 — completeness of the new tables (X-1)
--   RLS on, company_id NOT NULL (company tables), anon gets nothing, policies
--   in the InitPlan form (no per-row permission call), audit coverage, every
--   new API function revoked from anon.
-- =============================================================================
begin;
set client_min_messages = notice;
create temp table r3_tables (name text primary key, company boolean not null default true) on commit drop;
insert into r3_tables values ('app_modules', false), ('company_modules', true), ('company_branding', true), ('approval_rules', true),
  ('approval_actions', true), ('rate_change_requests', true), ('departments', true), ('party_types', true),
  ('party_opening_balances', true), ('custom_field_private_values', true), ('import_templates', true), ('item_cost_summary', true);

select test.eq((select string_agg(t.name, ', ') from r3_tables t join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
                where not c.relrowsecurity), null, 'Every new table has RLS on');
select test.eq((select string_agg(t.name, ', ') from r3_tables t join pg_attribute a on a.attrelid = ('public.' || t.name)::regclass and a.attname = 'company_id'
                where t.company and not a.attnotnull), null, 'company_id is NOT NULL on every company table');
select test.eq((select string_agg(t.name, ', ') from r3_tables t where t.company
                and not exists (select 1 from pg_attribute a where a.attrelid = ('public.' || t.name)::regclass and a.attname = 'company_id')), null,
               'Every company table has company_id');
select test.eq((select string_agg(t.name || ':' || p, ', ') from r3_tables t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
                where has_table_privilege('anon', 'public.' || t.name, p)), null, 'anon has no privilege on the new tables');
select test.eq((select string_agg(table_name, ', ') from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
               null, 'anon has no privilege on any public table or view (Supabase default privileges revoked)');
select test.eq((select string_agg(distinct table_name, ', ') from information_schema.role_table_grants
                where grantee in ('anon', 'authenticated') and table_schema = 'public' and privilege_type = 'TRUNCATE'),
               null, 'No API role may TRUNCATE (it ignores row-level security)');
select test.eq((select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('authenticated', c.oid, 'INSERT')
                  and c.relname in ('app_modules', 'approval_actions', 'approval_rules', 'company_modules', 'rate_change_requests',
                                    'party_opening_balances', 'v_vouchers', 'v_purchase_receipts')), null,
               'Function-only tables and masked views are not writable through the API');
-- policies of the new tables (and the ones R3 rewrote): permission / scope lookups only inside (SELECT …) — once per query
select test.eq((select string_agg(tablename || '.' || policyname, ', ') from pg_policies
                where schemaname = 'public' and cmd in ('SELECT', 'ALL')
                  and (tablename in (select name from r3_tables) or policyname in ('app_settings_write', 'approval_policies_write', 'document_sequences_write',
                       'parties_kind_read', 'journal_entry_lines_read', 'journal_entries_read', 'audit_log_read'))
                  and regexp_replace(coalesce(qual, ''), '\(\s*SELECT\s+(app|secure)\.\w+\([^()]*\)\s+AS\s+\w+\)', '', 'gi') ~ '(app|secure)\.\w+\('),
               null, 'Read policies use the InitPlan form');
-- audit coverage: registered tables with a trigger mechanism have the trigger
select test.ok((select count(*) = 0 from unnest(array['departments','party_opening_balances','company_branding','approval_rules',
  'rate_change_requests','company_modules']) t(n) where not exists (select 1 from app.audit_coverage c where c.table_name = t.n)),
  'R3 tables are registered in the audit coverage registry');
-- new public functions are never executable anonymously
select test.eq((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'public'::regnamespace
                and p.proname in ('settings_get', 'settings_save', 'module_set', 'company_modules_list', 'numbering_list', 'sequence_save',
                                  'approval_approve', 'approval_reject', 'approval_rules_save', 'approval_config', 'approval_inbox', 'party_rate_save',
                                  'rate_change_decide', 'audit_search', 'audit_export', 'login_overview', 'user_set_record_scope', 'role_set_record_scope',
                                  'user_set_department', 'godown_users', 'godown_assign_user', 'master_delete', 'master_set_active',
                                  'opening_balance_post', 'opening_balance_reverse', 'custom_private_values', 'custom_search', 'import_template_save',
                                  'import_job_set_mapping', 'import_commit_next', 'customer_po_approve_checked', 'sales_order_set_override_reason')
                and has_function_privilege('anon', p.oid, 'EXECUTE')), null, 'No new API function is executable by anon');
select test.ok(not has_function_privilege('authenticated', 'public.import_commit_next()', 'EXECUTE'), 'The import queue runs only as the worker');
rollback;
