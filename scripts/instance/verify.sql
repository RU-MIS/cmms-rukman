-- Fails (non-zero exit) when the database does not belong to this instance or
-- is not secured.
\set QUIET on
select set_config('verify.instance_id', :'instance_id', false) as _ \gset
do $$
declare v_id text; v_n int;
begin
  select instance_id into v_id from public.instance_meta;
  if v_id is null then
    raise exception 'FAIL: instance_meta is empty — run instance:init first';
  end if;
  if v_id <> current_setting('verify.instance_id') then
    raise exception 'FAIL: this database belongs to instance %, not %', v_id, current_setting('verify.instance_id');
  end if;
  select count(*) into v_n from pg_tables t
   where t.schemaname = 'public' and not exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity);
  if v_n > 0 then
    raise exception 'FAIL: % public tables without row-level security', v_n;
  end if;
  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  if v_n > 0 then
    raise exception 'FAIL: anonymous role has % table privileges', v_n;
  end if;
  raise notice 'OK: instance %, % companies, RLS on every table, no anonymous access',
    v_id, (select count(*) from public.companies);
end $$;
