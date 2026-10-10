-- =============================================================================
-- LOCAL TEST SHIM — NOT a migration, NEVER applied to a Supabase project.
-- Recreates the minimum that Supabase provides (auth schema, auth.uid(),
-- API roles) so migrations can be tested on a plain PostgreSQL server.
-- =============================================================================
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  email_confirmed_at  timestamptz default now(),  -- tests insert NULL for an unverified address
  encrypted_password  text,
  created_at          timestamptz default now(),
  last_sign_in_at     timestamptz,
  banned_until        timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant usage on schema public to anon, authenticated, service_role;
-- as on Supabase: every new table / view is granted to all API roles (migrations must revoke what they do not need)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
