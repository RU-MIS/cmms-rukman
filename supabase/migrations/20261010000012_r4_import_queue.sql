-- =============================================================================
-- R4 — queued imports: time limit and poison jobs (release-candidate fix)
--
-- Found in the R4 rehearsal: the worker commits a queued import through
-- PostgREST as service_role. PostgREST connects as `authenticator`, whose
-- statement_timeout on Supabase is 8 s, and service_role had no setting of its
-- own — so a 10,000-row commit (≈ 8–9 s) was cancelled, the job stayed QUEUED
-- (a cancel is not caught by `exception when others`), was picked first again
-- on every run and blocked every later import.
--
-- 1. service_role gets its own statement timeout. PostgREST applies the
--    settings of the impersonated role per request, so this affects only
--    trusted server calls with the service key (worker, admin-users function);
--    browser sessions keep authenticated = 8 s, anon = 3 s.
-- 2. The worker claims a job in one call (attempt counted and committed) and
--    commits it in a second call. A job that could not be committed in three
--    attempts is marked FAILED with a message instead of being retried forever,
--    and the queue moves on.
-- Additive: no data change for existing rows (new columns with defaults).
-- =============================================================================

alter role service_role set statement_timeout = '120s';

alter table public.import_jobs
  add column commit_attempts integer not null default 0,
  add column claimed_at      timestamptz;

-- claim the next queued job (service role only). Returns null when the queue is empty.
create or replace function public.import_claim_next()
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v uuid; r record;
begin
  if not app.is_trusted_caller() then
    raise exception 'Only the background worker commits queued imports' using errcode = '42501';
  end if;
  -- jobs that already failed to commit three times (e.g. the time limit): give up, tell the importer
  for r in select id, company_id, entity from public.import_jobs where status = 'QUEUED' and commit_attempts >= 3 for update skip locked loop
    update public.import_jobs
       set status = 'FAILED', imported_rows = 0, committed_at = now(),
           error = 'The import could not be committed in 3 attempts (time limit). Nothing was imported — split the file and import the parts.'
     where id = r.id;
    perform app.audit(r.company_id, 'import_jobs', r.id::text, 'IMPORT_FAILED', null,
                      jsonb_build_object('entity', r.entity, 'error', 'commit attempts exhausted'));
  end loop;
  select id into v from public.import_jobs
   where status = 'QUEUED' and commit_attempts < 3
   order by queued_at, id
   for update skip locked limit 1;
  if v is not null then
    update public.import_jobs set commit_attempts = commit_attempts + 1, claimed_at = now() where id = v;
  end if;
  return v;
end;
$$;

-- commit one claimed job as the importer (service role only); null when the job is no longer queued
create or replace function public.import_commit_job(p_job_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare j public.import_jobs; v jsonb;
        v_claims text := current_setting('request.jwt.claims', true); v_sub text := current_setting('request.jwt.claim.sub', true);
        v_role text := current_setting('request.jwt.claim.role', true);
begin
  if not app.is_trusted_caller() then
    raise exception 'Only the background worker commits queued imports' using errcode = '42501';
  end if;
  -- the row lock serialises two workers: the second one finds the job committed and returns null
  select * into j from public.import_jobs where id = p_job_id and status = 'QUEUED' for update;
  if j.id is null then
    return null;
  end if;
  -- act as the importer for the rest of this transaction
  perform set_config('request.jwt.claims', jsonb_build_object('sub', j.created_by, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', j.created_by::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('app.authz_cache', '', true);
  begin
    update public.import_jobs set status = 'VALIDATED' where id = j.id;
    v := app.import_commit_run(j.id, true);
  exception when others then
    -- e.g. the importer lost the right meanwhile: nothing was written
    update public.import_jobs set status = 'FAILED', error = sqlerrm, committed_at = now(), imported_rows = 0 where id = j.id;
    perform app.audit(j.company_id, 'import_jobs', j.id::text, 'IMPORT_FAILED', null, jsonb_build_object('entity', j.entity, 'error', sqlerrm));
    v := (select to_jsonb(jj) - 'columns' from public.import_jobs jj where id = j.id) || jsonb_build_object('committed', false);
  end;
  -- back to the worker's own identity
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  perform set_config('app.authz_cache', '', true);
  return v || jsonb_build_object('job_id', j.id);
end;
$$;

-- kept for a worker of the previous version during the deployment window (claim + commit in one call)
create or replace function public.import_commit_next()
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare v uuid;
begin
  v := public.import_claim_next();
  return case when v is null then null else public.import_commit_job(v) end;
end;
$$;

revoke all on function public.import_claim_next(), public.import_commit_job(uuid), public.import_commit_next() from public, anon, authenticated;
grant execute on function public.import_claim_next(), public.import_commit_job(uuid), public.import_commit_next() to service_role;

insert into secure.reviewed_functions values
  ('public.import_claim_next', 'service role only; returns a job id, no values'),
  ('public.import_commit_job', 'service role only; runs the import commit as the importer, with the importer''s rights and masks')
on conflict do nothing;

-- PostgREST reads role settings when it reloads its configuration
notify pgrst, 'reload config';
