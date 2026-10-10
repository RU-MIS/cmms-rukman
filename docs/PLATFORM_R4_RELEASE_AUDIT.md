# Platform R4 — Release-candidate audit (R1 + R2 + R3)

| | |
|---|---|
| Branch | `claude/charming-gauss-o9fvzf` |
| R3 baseline | `3eae044bcbba0d70dcc9a9a007abbfa55b8f122d` |
| Release candidate (code + migrations tested here) | `d336648` — the commit carrying this report changes documentation only |
| Production | `5cff5d6` (24 migrations, last `20261007000009`) — **not touched** |
| Scope (D1) | Regression, security verification, migration rehearsal, backup / restore validation, performance acceptance, release-candidate audit. No new features, no deployment. |

**Verdict: release candidate READY FOR REVIEW**, with the items under "Blocked" verified only on the local Supabase stack (they need the production project, which R4 must not touch) and the deployment-window note in §6. Every criterion that can be checked without production passes.

Everything ran on disposable local environments only: the local Supabase stack (`supabase/postgres:15.19.0.004`, PostgREST v16.4, GoTrue v2.197.0, Storage v1.79.36, Edge Runtime v1.77.4, Supabase CLI 2.120.0) and a throw-away PostgreSQL 16.13 test database. No production database, secret, Edge Function, Cloudflare setting or `main` was used or changed.

---

## 1. Findings fixed in R4

R4 found four defects. All four were fixed on the branch, re-tested and committed in `d336648`. None of the affected migrations has been applied anywhere except local test environments, so editing them is safe; production is unaffected.

| # | Finding | Severity | Fix | Verified by |
|---|---|---|---|---|
| F1 | **Queued 10,000-row import can never commit in production.** The worker calls `import_commit_next` through PostgREST as `service_role`; PostgREST connects as `authenticator`, whose `statement_timeout` on Supabase is 8 s, and `service_role` had no setting of its own. The commit (8.6 s) was cancelled at exactly 8 s. R3 measured it in `psql` with the timeout disabled, which hid this. | **High** | Migration `20261010000012`: `alter role service_role set statement_timeout = '120s'`. PostgREST applies the impersonated role's settings per request, so this covers trusted server calls only (worker, `admin-users` function); browser sessions keep `authenticated` = 8 s, `anon` = 3 s. | Reproduced through PostgREST: `canceling statement due to statement timeout` at 8,007 ms → after the fix the same 10,000-row commit succeeds through PostgREST (9.0–12.3 s). Permanent API test. |
| F2 | **Poison job blocks the import queue forever.** A cancelled commit is not caught by `exception when others`, so the job stayed `QUEUED`, was picked first again on every run (`order by queued_at`), and the worker loop stopped at the first error — every later import was blocked. | **High** | Same migration + worker: claim (`import_claim_next`, attempt counted in its own transaction) then commit (`import_commit_job`). After 3 failed attempts the job is `FAILED` with a message for the importer ("split the file"), audited; the worker continues with the next job. `import_commit_next` is kept for a worker of the previous version during the deployment window. | SQL test 390 (+12 assertions), worker unit tests (+2), API test. |
| F3 | **Upgrade rewrote `updated_at` / `updated_by` of every existing party** (backfill of `is_customer` / `is_vendor` in `20261010000001`, and of `status` for inactive parties in `20261010000008`): the "last changed by" of all customers / vendors would have become "nobody, at deployment time". | Medium (data fidelity; the audit log kept the old values) | The backfills suspend only the `parties_audit_fields` trigger; the audit trigger still records the backfill. | Rehearsal row-level diff: `parties` unchanged (incl. an inactive party). |
| F4 | **Upgrade refreshed `updated_at` of every existing role** (system-role metadata backfill in `20261008000002`). | Low | Same pattern on `roles_audit_fields`. | Rehearsal row-level diff: `roles` — 0 existing rows changed. |

Also improved (verification tooling, no product behaviour):
- `scripts/instance/verify.sql` now fails when an API role holds TRUNCATE. The production version of the script did not check this, which is why the `party_settings` / `storage_locations` gap was never reported.
- New `scripts/db/rehearse-upgrade.sh`: production chain → optional production backup → row-level snapshot → `supabase db push` → verify → row-level diff (exit 1 if an existing business row changed).

---

## 2. Focus items requested

### 2.1 The 10,000-row import (8.6 s against the 8 s target)

| Step (10,000 items, all-or-nothing) | Who / limit | Measured | Result |
|---|---|---|---|
| Upload rows (`import_add_rows`, 5 calls of 2,000) | user, 8 s per call | 0.15 s (psql) / 0.28–0.29 s (API, all calls) | **PASS** |
| Validate (`import_validate`) | user, 8 s | 3.5 s (psql) / 4.5–4.8 s (API) | **PASS** — 57–60 % of the limit (see risk R1) |
| Confirm (`import_commit`, queues > 2,000 rows) | user, 8 s | 0.004–0.012 s | **PASS** |
| Commit by the worker (`import_commit_job`) | service role, **was 8 s → now 120 s** | 8.6 s (psql) / 9.0–12.3 s (API) | **PASS after F1** (was FAIL: cancelled) |

Conclusion: the 8 s target is the browser-session limit. Every call the importer makes stays inside it. The commit is no longer measured against 8 s: it runs in the worker with its own 120 s budget, about 10× the measured time. The profile shows no single hotspot that is safe to optimise in a release-candidate pass: audit chain ≈ 2.8 s, price-history trigger 1.1 s, the row writer itself 1.65 s.

### 2.2 Production privilege gap (`party_settings`, `storage_locations`)

| Check | Production state (rehearsal of `5cff5d6`) | After upgrade |
|---|---|---|
| `authenticated` holds TRUNCATE on | `party_settings`, `storage_locations` (exactly these two) | none |
| `anon` privileges on public tables | none | none |
| Production `verify.sql` | passes (it does not check TRUNCATE) | — |
| R4 `verify.sql` | **FAIL: API roles hold TRUNCATE on 2 public tables** | **OK** |

**Exposure:** TRUNCATE is not reachable through the Supabase API. PostgREST has no TRUNCATE operation, no API function runs dynamic TRUNCATE, and API users have no SQL access. It is a defence-in-depth gap, not an exploitable path. It is closed by migration `20261010000011` as part of this release. A stand-alone hotfix for production would be a two-line migration (`revoke truncate on public.party_settings, public.storage_locations from authenticated;`), but I did not prepare or apply one, because R4 must not change production. Whether to ship it ahead of the release is your decision.

### 2.3 Reconciliation of the migration chain with production history

| Check | Result |
|---|---|
| Production's 24 migration files on the branch | **byte-identical** (`git diff 5cff5d6 HEAD` on those files is empty); none renamed or deleted |
| New migrations | 23 (`20261008000001` … `20261010000012`), all ordered after production's last version `20261007000009` |
| `supabase db push --dry-run` against the production-state rehearsal | pushes exactly the 23 new files, no seed, no roles |
| Real push on production data (2,002 items, 10,003 movements, 7 companies, 15 users, files) | 3–4.5 s, success |
| Existing rows changed by the upgrade (row-level diff, every table, production columns) | **none** outside catalogue tables: only `permissions` (7 rows: new wording of the `parties.*` descriptions); everything else only gains rows |
| Effective rights of every existing membership (9) | **none lost**; owners 224 → 311, operator 112 → 140 (backfills preserve and extend, as designed in R1 / R2) |
| Upgraded database vs. fresh install (`pg_dump` schema, table grants, function grants, permission catalogue) | **identical** (only `pg_dump`'s random restrict tokens differ) |
| Existing user after upgrade (password hash from the production backup) | signs in; 311 rights; modules and all 11 settings sections load |
| Current suites on the **upgraded** production data (no reset) | API 19 / 19, browser 44 / 44 (pass 3, 46-migration chain; the final 47-migration chain was re-run on a fresh install, §3.1) |
| System seed (`supabase/seed/system`) | changed only to generate the seven base actions; idempotent; **not needed** for the upgrade (the migrations create every new permission — catalogue identical to a fresh install) |

---

## 3. Criteria — pass / fail / blocked

### 3.1 Regression (on `d336648`)

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| REG-1 | SQL suite, fresh build of all 47 migrations, Supabase default privileges emulated | **PASS** — 35 / 35 files | `npm run db:test` |
| REG-2 | API e2e (PostgREST, Storage, Auth, Edge Function `admin-users`) on a fresh 47-migration stack | **PASS** — 19 / 19 (incl. the real 10,000-row import) | `scripts/e2e/run.sh api` |
| REG-3 | Browser e2e (static build, Chromium) | **PASS** — 44 / 44 (R1 / R2 30, R3 admin 6, J33 journey of the 33 original criteria 8) | `scripts/e2e/run.sh ui` |
| REG-4 | Worker unit tests | **PASS** — 7 / 7 | `npm run test:worker` |
| REG-5 | Worker container smoke (Node 22, `npm ci --omit=dev`, real SMTP to Mailpit) | **PASS** | `worker-container-smoke.sh` |
| REG-6 | Lint (web, worker), typecheck (web, worker), static build | **PASS** | `npm run lint`, `npm run typecheck`, build in REG-3 |
| REG-7 | Production suites (`5cff5d6`) on the production-state rehearsal | **PASS** — API 4 / 4, browser 16 / 16 | rehearsal pass 1 |

### 3.2 Migration rehearsal

| ID | Criterion | Result |
|---|---|---|
| MIG-1 | Production migration files unchanged on the branch | **PASS** |
| MIG-2 | New versions strictly after production's last version; dry run lists exactly the new files | **PASS** (23) |
| MIG-3 | Upgrade of a production-state database with realistic data succeeds | **PASS** (4 rehearsal passes; final: 3 s) |
| MIG-4 | No existing business row changed or removed | **PASS** after F3 / F4 (pass 1–2 found them) |
| MIG-5 | No existing user loses a right | **PASS** (9 / 9 memberships) |
| MIG-6 | Upgraded schema = fresh-install schema (DDL, grants, catalogue) | **PASS** |
| MIG-7 | Existing users / files / passwords work after the upgrade | **PASS** |
| MIG-8 | Migrations apply as Supabase's non-superuser `postgres` (incl. `alter role service_role`) | **PASS** on the local Supabase image; **hosted project: BLOCKED** (B-2) |
| MIG-9 | Fresh instance: migrations → `init.sh` → `verify.sh` | **PASS** (47 migrations, "no TRUNCATE for API roles") |

### 3.3 Security verification

| ID | Criterion | Result |
|---|---|---|
| SEC-1 | Every public table has RLS | **PASS** (0 without) |
| SEC-2 | `anon` has no table privilege; no API role holds TRUNCATE | **PASS** (0 / 0); production gap reproduced and shown closed (§2.2) |
| SEC-3 | Every security-definer function pins `search_path` | **PASS** (0 without) |
| SEC-4 | No `public` function executable by `anon` | **PASS**. 95 `app` / `secure` functions carry EXECUTE for `anon`, but `anon` has no USAGE on those schemas and PostgREST exposes only `public`: unreachable (unchanged pattern from production). |
| SEC-5 | Worker-only functions not executable by `authenticated` (`email_claim`, `import_claim_next`, `import_commit_job`, `import_commit_next`) | **PASS**. `run_payment_reminders` is callable by users by design (requires the trusted worker or `settings.edit` of the company). |
| SEC-6 | Public views are `security_invoker`, except the reviewed definer view `v_items` (same company + item-scope filter as the `items` policies) | **PASS** |
| SEC-7 | Financial values (D3) only through masked views / class-checked functions; registry-driven test | **PASS** (SQL 310, API) |
| SEC-8 | Company isolation, scopes, record scope, approvals maker-checker, audit masking + scope, import / export rights — direct API negative tests | **PASS** (SQL 300–395, API 19, browser J33) |
| SEC-9 | No secret in the release diff (`5cff5d6..HEAD`); no `.env` / key / fixture file tracked; built web bundle contains no service-role key or DB URL | **PASS** (1 pattern hit = the local-only URL guard in `rehearse-upgrade.sh`, a false positive) |
| SEC-10 | `npm audit --omit=dev` | **PASS** — 0 vulnerabilities. Full audit: 5 high in dev-only lint tooling (`braces` via `eslint-config-next`), not shipped in the static site or the worker. |
| SEC-11 | `service_role` timeout change limited to trusted callers | **PASS** — `authenticated` 8 s, `anon` 3 s unchanged (checked in `pg_roles` after the push) |

### 3.4 Backup / restore

| ID | Criterion | Result |
|---|---|---|
| BAK-1 | Backup taken with **production's** `backup.sh` on production-state data restores into a fresh production-schema project, identical (86 tables + `auth.users` incl. password hashes + `storage.objects`) | **PASS** |
| BAK-2 | Production backup → restore → upgrade to the release (the disaster-recovery path during the release) | **PASS** (rehearsal passes 2–4) |
| BAK-3 | Current drill (`drill-local.sh`): backup → wipe → restore, data + `documents` + `item-images` + `company-assets` | **PASS** — identical |
| BAK-4 | Encrypted nightly backup (`db-backup.yml`, GPG) on GitHub | **BLOCKED** (B-4) — workflow unchanged; uses the same `backup.sh` validated above |

### 3.5 Performance acceptance (local stack, 2,000 items, 10,000 movements, 1,000,000 audit rows; median of 5)

| ID | Query / operation | Target | Owner | Operator | Scoped | Result |
|---|---|---|---|---|---|---|
| PERF-1 | Inventory list | ≤ R2 + 20 % (R2 28–30 ms) | 17.1 ms | 17.0 ms | 16.8 ms | **PASS** |
| PERF-2 | Stock movements (base) | ≤ R2 + 20 % (R2 5–6 ms) | 4.0 ms | 4.1 ms | 4.6 ms | **PASS** |
| PERF-3 | Stock movements with costs (masked) | < 100 ms | 14.0 ms | 13.2 ms | 13.1 ms | **PASS** |
| PERF-4 | Items with prices / cost / margin | < 100 ms | 6.1 ms | 4.4 ms | 6.2 ms | **PASS** |
| PERF-5 | Audit viewer, 1M rows, date + user filter (AC-4.8) | < 300 ms | 126 ms | | | **PASS** |
| PERF-6 | 10,000-row import: user calls | < 8 s each | max 4.8 s (validate, API) | | | **PASS** |
| PERF-7 | 10,000-row import: worker commit | completes | 8.6–12.3 s of 120 s | | | **PASS** after F1 |
| PERF-8 | Upgrade duration on production-size data | short | 3–4.5 s | | | **PASS** |
| PERF-9 | The same on production hardware | — | | | | **BLOCKED** (B-1) |

### 3.6 Release-candidate readiness

| ID | Criterion | Result |
|---|---|---|
| RC-1 | Additive migrations only, no destructive DDL on existing data | **PASS** (row-level diff) |
| RC-2 | Deployment-window compatibility (new DB, previous web / worker) | **PASS with condition**: previous worker OK (smoke), previous API usage OK (4 / 4); previous **web app cannot create / edit items** (R2 price-column privileges) → deploy the web build right after `db push` (§6) |
| RC-3 | Rollback path documented and rehearsed | **PASS** (backup / restore rehearsed; §6.3) |
| RC-4 | Documentation updated (this report, deployment checklist: 47 migrations, rollback wording, GO list counts) | **PASS** |
| RC-5 | Production impact of R4 | **NONE** |

### 3.7 Blocked (needs the production project or its owner — not allowed in R4)

| ID | Item | Why blocked | How to close at deployment |
|---|---|---|---|
| B-1 | Timings on production hardware (validation 4.8 s is the tightest user call) | no production access | After `db push`: time one 5,000-row validation; if > 6 s, keep files ≤ 5,000 rows (R2 guidance) |
| B-2 | `alter role service_role set statement_timeout` accepted on the hosted project | no production access | Rehearse on a **staging copy** of the project first (`supabase db push` there); if refused, set it once in the SQL editor (`alter role service_role set statement_timeout = '120s'; notify pgrst, 'reload config';`) |
| B-3 | Production migration history matches the 24 files | reading production is out of scope | `npx supabase migration list` (read-only) must show 24 remote = local, last `20261007000009` |
| B-4 | Nightly encrypted backup workflow on GitHub; real SMTP; Cloudflare Pages build; hosted Edge Function deploy | deployment actions | Checklist sections B–G |
| B-5 | Auth minimum password length ≥ strictest company policy | dashboard setting | Checklist B.5 |

---

## 4. Risks accepted / to decide

| # | Risk | Mitigation |
|---|---|---|
| R1 | Import validation of 10,000 rows uses 57–60 % of the 8 s browser limit locally; slower production hardware could exceed it. A timeout writes nothing (the user retries with a smaller file). | B-1 measurement; ≤ 5,000 rows per file until measured |
| R2 | `service_role` statement timeout 120 s applies to every service-key call (worker, `admin-users`). | Trusted server code only; the browser never holds the key |
| R3 | Deployment window: previous web app cannot edit items once the database is upgraded. | Maintenance window of a few minutes; §6 order |
| R4 | Dev-only `npm audit` findings (lint tooling) | Not shipped; update with the next tooling upgrade |
| R5 | `party_settings` / `storage_locations` TRUNCATE grant stays in production until this release (not API-reachable) | Optional two-line hotfix (§2.2) — your decision |

---

## 5. What changed in R4 (files)

`supabase/migrations/20261008000002_platform_rbac.sql`, `20261010000001_r3_catalogue_modules.sql`, `20261010000008_r3_masters_opening.sql` (backfills keep audit fields), new `20261010000012_r4_import_queue.sql`; `worker/src/worker.ts` (claim → commit loop), `worker/test/import-queue.test.ts`; `supabase/tests/390_r3_import_export.sql`; `e2e/api/r3-platform.test.mjs` (10,000 rows through PostgREST); `scripts/instance/verify.sql` (TRUNCATE check); new `scripts/db/rehearse-upgrade.sh`; `.gitignore`; documentation.

---

## 6. Upgrade runbook (production `5cff5d6` → release candidate) — for use only after your approval

### 6.1 Before (no change to production)
1. Freeze: no other merges to `main`.
2. Confirm B-3: `npx supabase migration list` → 24 / 24, last `20261007000009`.
3. Rehearse on a staging copy (recommended, closes B-2): new Supabase project → `supabase link` to it → `supabase db push` of `5cff5d6` → restore last night's backup (checklist I) → `supabase db push` of the release → `npm run instance:verify` → smoke test. (`scripts/db/rehearse-upgrade.sh` does the same with a row-level diff, but only against the local stack — it refuses any other database.)
4. Announce a short maintenance window (item editing unavailable for a few minutes).

### 6.2 Deploy (in this order)
1. GitHub → Actions → **db-backup** → Run workflow; download and test-decrypt the artifact.
2. `npx supabase db push` (dry run first: exactly 23 files). Each file runs in its own transaction; if one fails, the push stops and **earlier files stay applied** → fix forward with a corrective migration or restore (6.3).
3. `npm run instance:verify` → must print "… no TRUNCATE for API roles".
4. Check `select rolconfig from pg_roles where rolname = 'service_role'` → `{statement_timeout=120s}`.
5. Deploy Edge Function `admin-users` (`npx supabase functions deploy admin-users`).
6. Merge the release to `main` → Cloudflare Pages builds the web app; the email worker uses the new code from the next run (the previous worker keeps working meanwhile — rehearsed).
7. Supabase Auth → minimum password length (B-5).
8. Smoke test (checklist G) + one import of ≥ 2,001 rows (queued → committed by the worker) + B-1 timing.

### 6.3 Rollback
- Web only: Cloudflare Pages rollback restores the previous UI, but the previous UI cannot edit items on the new schema — use only together with a database restore.
- Database: there is no down-migration. Fix forward, or restore the step-6.2.1 backup into a **new** project (checklist I, rehearsed in BAK-1 / BAK-2) and repoint Pages / GitHub secrets.

---

## 7. Production impact

**NONE.** R4 used only the local Supabase stack, a local PostgreSQL test database and a git worktree of `5cff5d6`. No production database, migration history, Edge Function, secret, Cloudflare setting or `main` change. Waiting for your review; no deployment and no new features started.
