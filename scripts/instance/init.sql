-- Called by scripts/instance/init.sh with psql variables.
begin;
do $$ begin
  if exists (select 1 from public.instance_meta) then
    raise exception 'This database is already initialised as instance %',
      (select instance_id from public.instance_meta);
  end if;
end $$;
insert into public.instance_meta (instance_id, instance_name) values (:'instance_id', :'instance_name');

select id as admin_id from auth.users where lower(email) = lower(:'admin_email') \gset
insert into public.profiles (id, full_name) values (:'admin_id', 'Administrator') on conflict (id) do nothing;
select public.create_company(jsonb_build_object('code', :'company_code', 'legal_name', :'company_name',
                                                'gstin', nullif(:'company_gstin', '')), :'admin_id') as company_id \gset
commit;
