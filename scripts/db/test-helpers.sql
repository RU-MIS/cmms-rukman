-- =============================================================================
-- TEST HELPERS — loaded into the throw-away test database only.
-- =============================================================================
create schema if not exists test;
grant usage on schema test to authenticated;

-- Act as a user (API request with the authenticated role), or as the database
-- owner (p_user null) for setup steps.
create or replace function test.login(p_user uuid)
returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    execute 'reset role';
  else
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function test.eq(p_actual anyelement, p_expected anyelement, p_msg text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT FAILED: % — expected %, got %', p_msg, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

create or replace function test.ok(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then
    raise exception 'ASSERT FAILED: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Asserts that p_sql raises an error whose message matches p_like.
create or replace function test.throws(p_sql text, p_like text, p_msg text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_like then
      raise notice 'ok - % (rejected: %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'ASSERT FAILED: % — wrong error: %', p_msg, sqlerrm;
  end;
  raise exception 'ASSERT FAILED: % — no error raised', p_msg;
end $$;

grant execute on all functions in schema test to authenticated;

-- -----------------------------------------------------------------------------
-- Fixture: one company with users, masters and a job worker.
-- Returns ids as jsonb. Must be called as the database owner.
-- -----------------------------------------------------------------------------
create or replace function test.fixture(p_code text default 'TEST-CO')
returns jsonb language plpgsql as $$
declare
  v_admin uuid := gen_random_uuid();
  v_op    uuid := gen_random_uuid();
  v_appr  uuid := gen_random_uuid();
  v_co    uuid;
  v_pair  uuid := (select id from public.units where company_id is null and code = 'PAIR');
  v_box   uuid := (select id from public.units where company_id is null and code = 'BOX');
  v_pcs   uuid := (select id from public.units where company_id is null and code = 'PCS');
  v_mtr   uuid := (select id from public.units where company_id is null and code = 'MTR');
  v_fg    uuid; v_fg2 uuid; v_carton uuid; v_rm uuid;
  v_b336  uuid; v_wh uuid; v_rmg uuid;
  v_jw    uuid; v_jw2 uuid;
begin
  insert into auth.users (id, email) values
    (v_admin, p_code || '-admin@test.local'), (v_op, p_code || '-op@test.local'), (v_appr, p_code || '-appr@test.local');
  v_co := public.create_company(jsonb_build_object('code', p_code, 'legal_name', p_code || ' Pvt Ltd'), v_admin);
  insert into public.user_roles (user_id, company_id, role_id)
  select v_op, v_co, id from public.roles where company_id = v_co and code = 'OPERATOR';
  insert into public.user_roles (user_id, company_id, role_id)
  select v_appr, v_co, id from public.roles where company_id = v_co and code = 'APPROVER';

  insert into public.items (company_id, code, name, item_kind, base_unit_id, job_work_rate)
  values (v_co, 'FG-4766', 'TOE-RING SANDAL-4766', 'FINISHED_GOOD', v_pair, 190) returning id into v_fg;
  insert into public.items (company_id, code, name, item_kind, base_unit_id)
  values (v_co, 'FG-5012', 'SAMOSA-5012', 'FINISHED_GOOD', v_pair) returning id into v_fg2;
  insert into public.items (company_id, code, name, item_kind, base_unit_id)
  values (v_co, 'CB-4766', 'CARTON TOE-RING-4766', 'PACKING', v_pcs) returning id into v_carton;
  insert into public.items (company_id, code, name, item_kind, base_unit_id)
  values (v_co, 'RM-LYCRA', 'BOMBAY LYCRA BOTTOM', 'RAW_MATERIAL', v_mtr) returning id into v_rm;
  insert into public.item_packings (item_id, unit_id, factor_to_base, is_default) values
    (v_fg, v_box, 18, true), (v_fg2, v_box, 36, true);

  insert into public.godowns (company_id, code, name) values (v_co, 'B-336', 'B-336') returning id into v_b336;
  insert into public.godowns (company_id, code, name) values (v_co, 'WAREHOUSE', 'Warehouse') returning id into v_wh;
  insert into public.godowns (company_id, code, name) values (v_co, 'RAW MATERIAL', 'Raw material') returning id into v_rmg;

  insert into public.parties (company_id, code, name) values (v_co, 'ALEEM', 'ALEEM') returning id into v_jw;
  insert into public.parties (company_id, code, name) values (v_co, 'MAJID', 'MAJID') returning id into v_jw2;
  insert into public.party_roles values (v_jw, 'JOB_WORKER'), (v_jw2, 'JOB_WORKER');

  insert into public.item_consumption_rules (company_id, fg_item_id, consumed_item_id, per_unit_id,
                                             qty_per_unit, applies_to, effective_from)
  values (v_co, v_fg, v_carton, v_box, 1, 'ANY', date '2026-06-15');

  return jsonb_build_object(
    'company', v_co, 'admin', v_admin, 'operator', v_op, 'approver', v_appr,
    'pair', v_pair, 'box', v_box, 'pcs', v_pcs, 'mtr', v_mtr,
    'fg', v_fg, 'fg2', v_fg2, 'carton', v_carton, 'rm', v_rm,
    'b336', v_b336, 'warehouse', v_wh, 'rm_godown', v_rmg,
    'aleem', v_jw, 'majid', v_jw2);
end $$;

create table if not exists test.ctx (k text primary key, v jsonb);
grant all on test.ctx to authenticated;
create or replace function test.id(p_key text) returns uuid language sql stable as
  $$ select (v->>p_key)::uuid from test.ctx where k = 'fx' $$;
grant execute on all functions in schema test to authenticated;
