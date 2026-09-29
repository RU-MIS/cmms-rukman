-- =============================================================================
-- 0080 SECURITY — Row-Level Security, grants, company-consistency triggers
-- (DATABASE_BLUEPRINT §12, spec §32).
--
-- * Every table has RLS enabled.
-- * Users see rows of the companies they belong to (user_roles).
-- * Masters may be written directly (with the module permission).
-- * Documents are written ONLY through doc_save / doc_submit / … RPCs.
-- * Stock movements, journals and audit log are read-only for users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Company-consistency trigger for master tables with cross references.
-- TG_ARGV: 'column:table' pairs.
-- -----------------------------------------------------------------------------
create or replace function app.tg_company_refs()
returns trigger
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_pair  text;
  v_col   text;
  v_tab   text;
  v_val   uuid;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'company_id cannot be changed' using errcode = 'P0001';
  end if;
  foreach v_pair in array coalesce(tg_argv, array[]::text[]) loop
    v_col := split_part(v_pair, ':', 1);
    v_tab := split_part(v_pair, ':', 2);
    v_val := (to_jsonb(new) ->> v_col)::uuid;
    perform app.assert_same_company(new.company_id, v_tab, v_val);
  end loop;
  return new;
end;
$$;

create trigger items_company_refs before insert or update on public.items
  for each row execute function app.tg_company_refs('category_id:item_categories', 'brand_id:brands');
create trigger item_categories_company_refs before insert or update on public.item_categories
  for each row execute function app.tg_company_refs('parent_id:item_categories');
create trigger godowns_company_refs before insert or update on public.godowns
  for each row execute function app.tg_company_refs('party_id:parties');
create trigger consumption_rules_company_refs before insert or update on public.item_consumption_rules
  for each row execute function app.tg_company_refs('fg_item_id:items', 'consumed_item_id:items', 'godown_id:godowns');
create trigger party_item_rates_company_refs before insert or update on public.party_item_rates
  for each row execute function app.tg_company_refs('party_id:parties', 'item_id:items');
create trigger accounts_company_refs before insert or update on public.accounts
  for each row execute function app.tg_company_refs('parent_id:accounts');
create trigger parties_company_refs before insert or update on public.parties
  for each row execute function app.tg_company_refs();
create trigger brands_company_refs before insert or update on public.brands
  for each row execute function app.tg_company_refs();
create trigger voucher_books_company_refs before insert or update on public.voucher_books
  for each row execute function app.tg_company_refs();

-- System accounts: code/type/sub_type/system_key cannot be altered or deleted.
create or replace function app.tg_protect_system_account()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'System account % cannot be deleted', old.name using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.is_system and
     (new.system_key is distinct from old.system_key or new.account_type <> old.account_type
      or new.sub_type <> old.sub_type or new.is_group <> old.is_group or not new.is_system) then
    raise exception 'Only the name of system account % can be changed', old.name using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger accounts_protect_system before update or delete on public.accounts
  for each row execute function app.tg_protect_system_account();

-- Item packing / party children must belong to the same company as the parent.
create or replace function app.tg_item_packing_check()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_item_company uuid; v_unit_company uuid;
begin
  select company_id into v_item_company from public.items where id = new.item_id;
  select company_id into v_unit_company from public.units where id = new.unit_id;
  if v_unit_company is not null and v_unit_company <> v_item_company then
    raise exception 'Unit belongs to another company' using errcode = 'P0001';
  end if;
  if new.unit_id = (select base_unit_id from public.items where id = new.item_id) then
    raise exception 'Packing unit must differ from the item base unit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger item_packings_check before insert or update on public.item_packings
  for each row execute function app.tg_item_packing_check();

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all functions in schema app from public;

grant select on all tables in schema public to authenticated;
-- Supabase grants ALL on new tables by default: take write access away and
-- give it back only where intended.
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;

-- Functions referenced by RLS policies and security-invoker views/reports.
grant execute on function app.user_company_ids(), app.is_member(uuid), app.has_permission(uuid, text),
                          app.default_packing(uuid, date), app.current_user_id()
  to authenticated, service_role;

-- Masters: direct write with permissions (RLS below).
grant insert, update, delete on
  public.items, public.item_categories, public.brands, public.item_packings,
  public.item_consumption_rules, public.parties, public.party_roles, public.party_addresses,
  public.godowns, public.party_item_rates, public.accounts, public.voucher_books, public.units,
  public.app_settings, public.document_sequences, public.approval_policies,
  public.roles, public.role_permissions, public.user_roles, public.profiles
  to authenticated;
grant update on public.companies to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Instance / reference tables
create policy instance_meta_read on public.instance_meta for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);

-- Companies
create policy companies_read on public.companies for select to authenticated
  using (app.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (app.has_permission(id, 'settings.edit')) with check (app.has_permission(id, 'settings.edit'));

-- Profiles: own profile, and profiles of users sharing a company
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.user_roles a join public.user_roles b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Roles & assignments
create policy roles_read on public.roles for select to authenticated using (app.is_member(company_id));
create policy roles_write on public.roles for all to authenticated
  using (app.has_permission(company_id, 'users.edit') and not is_system)
  with check (app.has_permission(company_id, 'users.edit') and not is_system);
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and app.is_member(r.company_id)));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                 and app.has_permission(r.company_id, 'users.edit')))
  with check (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                      and app.has_permission(r.company_id, 'users.edit')));
create policy user_roles_read on public.user_roles for select to authenticated
  using (app.is_member(company_id));
create policy user_roles_write on public.user_roles for all to authenticated
  using (app.has_permission(company_id, 'users.edit'))
  with check (app.has_permission(company_id, 'users.edit')
              and exists (select 1 from public.roles r where r.id = role_id and r.company_id = user_roles.company_id));

-- Settings, numbering, approvals
create policy app_settings_read on public.app_settings for select to authenticated using (app.is_member(company_id));
create policy app_settings_write on public.app_settings for all to authenticated
  using (app.has_permission(company_id, 'settings.edit')) with check (app.has_permission(company_id, 'settings.edit'));
create policy document_sequences_read on public.document_sequences for select to authenticated using (app.is_member(company_id));
create policy document_sequences_write on public.document_sequences for all to authenticated
  using (app.has_permission(company_id, 'settings.edit')) with check (app.has_permission(company_id, 'settings.edit'));
create policy document_sequence_counters_read on public.document_sequence_counters for select to authenticated
  using (app.is_member(company_id));
create policy approval_policies_read on public.approval_policies for select to authenticated using (app.is_member(company_id));
create policy approval_policies_write on public.approval_policies for all to authenticated
  using (app.has_permission(company_id, 'settings.edit')) with check (app.has_permission(company_id, 'settings.edit'));
create policy audit_log_read on public.audit_log for select to authenticated
  using (company_id is not null and app.has_permission(company_id, 'audit.view'));

-- Units: system units visible to all, company units to members
create policy units_read on public.units for select to authenticated
  using (company_id is null or app.is_member(company_id));
create policy units_write on public.units for all to authenticated
  using (company_id is not null and app.has_permission(company_id, 'items.edit'))
  with check (company_id is not null and app.has_permission(company_id, 'items.edit'));

-- Company-scoped masters: read = member, write = module permission
do $$
declare m record;
begin
  for m in select * from (values
      ('items', 'items'), ('item_categories', 'items'), ('brands', 'items'),
      ('item_consumption_rules', 'items'), ('parties', 'parties'), ('godowns', 'godowns'),
      ('party_item_rates', 'rates'), ('accounts', 'accounts'), ('voucher_books', 'accounts')
    ) as v(tbl, module)
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated
                    using (app.is_member(company_id))', m.tbl);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (app.has_permission(company_id, %2$L))', m.tbl, m.module || '.create');
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (app.has_permission(company_id, %2$L))
                    with check (app.has_permission(company_id, %2$L))', m.tbl, m.module || '.edit');
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using (app.has_permission(company_id, %2$L))', m.tbl, m.module || '.delete');
  end loop;
end $$;

-- Child masters (no company_id): access follows the parent row
create policy item_packings_read on public.item_packings for select to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and app.is_member(i.company_id)));
create policy item_packings_write on public.item_packings for all to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and app.has_permission(i.company_id, 'items.edit')))
  with check (exists (select 1 from public.items i where i.id = item_id and app.has_permission(i.company_id, 'items.edit')));
create policy party_roles_read on public.party_roles for select to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.is_member(p.company_id)));
create policy party_roles_write on public.party_roles for all to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'parties.edit')))
  with check (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'parties.edit')));
create policy party_addresses_read on public.party_addresses for select to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.is_member(p.company_id)));
create policy party_addresses_write on public.party_addresses for all to authenticated
  using (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'parties.edit')))
  with check (exists (select 1 from public.parties p where p.id = party_id and app.has_permission(p.company_id, 'parties.edit')));

-- Ledgers: read-only for members
create policy stock_movements_read on public.stock_movements for select to authenticated using (app.is_member(company_id));
create policy stock_balances_read on public.stock_balances for select to authenticated using (app.is_member(company_id));
create policy journal_entries_read on public.journal_entries for select to authenticated using (app.is_member(company_id));
create policy journal_entry_lines_read on public.journal_entry_lines for select to authenticated using (app.is_member(company_id));

-- Documents: read with <prefix>.view; writes only via RPC (no write policy)
create or replace function app.create_document_policies()
returns void
language plpgsql
as $$
declare d app.doc_types;
begin
  for d in select * from app.doc_types loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = d.table_name
                   and policyname = d.table_name || '_read') then
      execute format('create policy %1$s_read on public.%1$I for select to authenticated
                      using (app.has_permission(company_id, %2$L))', d.table_name, d.perm_prefix || '.view');
      execute format('revoke insert, update, delete on public.%I from authenticated', d.table_name);
    end if;
    if d.line_table is not null and not exists (
         select 1 from pg_policies where schemaname = 'public' and tablename = d.line_table
         and policyname = d.line_table || '_read') then
      execute format('create policy %1$s_read on public.%1$I for select to authenticated
                      using (exists (select 1 from public.%2$I h where h.id = %1$I.%3$I
                                     and app.has_permission(h.company_id, %4$L)))',
                     d.line_table, d.table_name, d.line_fk, d.perm_prefix || '.view');
      execute format('revoke insert, update, delete on public.%I from authenticated', d.line_table);
    end if;
  end loop;
end;
$$;
do $$ begin perform app.create_document_policies(); end $$;

-- Child tables outside the document registry
create policy sales_order_date_revisions_read on public.sales_order_date_revisions for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = sales_order_id
                 and app.has_permission(o.company_id, 'sales_order.view')));
revoke insert, update, delete on public.sales_order_date_revisions from authenticated;
