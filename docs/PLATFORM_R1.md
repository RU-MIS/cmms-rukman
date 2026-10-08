# Platform R1 — Authorization engine + User Management (Phases 1–2)

Branch `claude/charming-gauss-o9fvzf`. **Not deployed.** Production (`5cff5d6`)
is unchanged. Plan: [`PLATFORM_ARCHITECTURE_PLAN.md`](./PLATFORM_ARCHITECTURE_PLAN.md).

## What R1 adds

| Area | Delivered |
|---|---|
| Permission catalogue | `permission_modules` (label, group, order) + permission metadata (label, kind, order, sensitive). The Permission Matrix renders whatever is in the database. New rights: `users.disable`, `users.reset_password`, `users.assign_role`, `users.assign_permissions`, `users.assign_scope`, `users.manage_owners`, `roles.view/create/edit/delete`, `company.create`. |
| Roles | Every role is editable, cloneable, can be disabled or deleted (when unused). Only **OWNER** is locked: it always has every permission (also future ones), cannot be reduced, disabled or deleted. Default roles are seeded **once** — admin edits are never reverted. New defaults: MANAGER, INVENTORY, FACTORY (existing roles keep exactly their rights). |
| Effective permission | Roles (active only) ∪ ALLOW overrides − DENY overrides; nothing while the membership is disabled or a temporary password is pending. `app.has_permission` keeps its signature, so all existing policies / RPCs use the new engine. |
| No privilege escalation | Nobody can grant a permission, a role, an override or a clone with more rights than they hold. Non-owners cannot change their own roles, overrides or scope, nor touch owners. Only an owner grants / removes the owner role; the last (active) owner cannot be removed or disabled. Hard-coded `OWNER`/`ADMIN` checks are replaced by permissions (`company.create`, locked owner role). |
| Data scope | GODOWN dimension (ASSIGNED_GODOWNS) per user or per role. Enforced by **restrictive RLS** on every table with a godown column (registry `app.godown_scoped_tables`, completeness tested) and by **triggers** on the stock ledger, reservations, godown documents and their lines, so SECURITY DEFINER posting RPCs cannot touch another godown either. No scope rows = all godowns (= behaviour before R1). |
| Users | `company_users` (per-company status, employee code, department, designation, mobile, notes), profile flags `must_change_password`, `password_changed_at`. User directory (internal + customer + vendor logins), detail with roles, overrides, effective permissions and scope, audit history, last login. |
| Logins | Edge Function `admin-users`: create login with a strong 16-character temporary password (shown once), reset password, disable / enable (ban only when the login has no access left anywhere). All decisions are database RPCs executed with the caller's own JWT. |
| Forced password change | Temporary password → the database refuses all business access; the app shows "Choose your own password" until changed. Changing the password clears the flag (trigger on `auth.users`); an admin reset makes the next password temporary again. |
| Audit | Role create / update / clone / permissions / scope / delete; user create, role add / remove, overrides, scope, profile, disable / enable, password reset (never the password), login. |
| UI | **Admin control center**, **Users** (search, filters, bulk enable / disable, new user, invite by email, user drawer: profile, roles, permission overrides, godown access, login & security, history), **Roles & permissions** (role list, new / duplicate / rename / disable / delete, matrix with select all / clear / module / column / group toggles, copy from role, diff before save, godown access per role). Menu is data-driven; direct URL access to a page without its permission shows "no access" (the database refuses the data anyway). |
| Performance | Read policies `is_member(company_id)` / `has_permission(company_id, '<code>')` rewritten to equivalent InitPlans (once per query instead of once per row). Same dataset as the release audit (2,004 items, 10,001 movements): inventory list 28 ms (before R1: 86 ms), location view 53 ms (116 ms), movements 3 ms (49 ms); godown-restricted user 15 / 6 / 4 ms. |

## Changed files

| File | Change |
|---|---|
| `supabase/migrations/20261008000001_platform_enums.sql` | `perm_action` + IMPORT, UPLOAD, DOWNLOAD, SHARE, DISPATCH, RECEIVE, DISABLE, RESET, ASSIGN, MANAGE, VIEW_FIELD, EDIT_FIELD |
| `supabase/migrations/20261008000002_platform_rbac.sql` | catalogue, editable roles, seed-once defaults + backfill, `company_users`, profile flags (column grants), overrides, effective-permission functions, escalation / owner guards, role RPCs, permission-based `create_company` / `user_invite` |
| `supabase/migrations/20261008000003_platform_data_scopes.sql` | scope dimensions, role / user scopes, scope resolution, registry, restrictive policies, write triggers, scope RPCs, PO print / email scope check |
| `supabase/migrations/20261008000004_platform_users.sql` | password trigger on `auth.users`, user directory / detail, profile / roles / overrides / status / reset / create RPCs, `auth_revoke_sessions` (service role), portal guard + session bootstrap (must-change, login audit, owner-invitation claim) |
| `supabase/migrations/20261008000005_platform_rls_performance.sql` | InitPlan rewrite of 48 read policies (no behaviour change) |
| `supabase/functions/admin-users/{index,handler}.ts` | Edge Function (no dependencies) |
| `supabase/config.toml` | Edge runtime + `[functions.admin-users] verify_jwt = true` (local) |
| `supabase/seed/system/001_permissions_units.sql` | seed only the seven base actions per module (no permission explosion from the new enum values) |
| `supabase/tests/200_platform_rbac.sql`, `210_platform_scopes_users.sql` | new SQL tests (75 + 47 assertions) |
| `e2e/api/admin-users.test.mjs`, `e2e/ui/platform-admin.spec.ts` | new API and browser tests |
| `e2e/ui/zz-auth.spec.ts` | operator test: settings by direct URL is now refused (R1 rule "no direct URL access without permission") instead of shown read-only |
| `web/src/app/erp/admin/**`, `web/src/components/admin/*`, `web/src/components/PasswordGate.tsx`, `web/src/lib/admin.ts` | new screens / components |
| `web/src/components/AppShell.tsx`, `Providers.tsx`, `web/src/lib/session.tsx`, `web/src/app/erp/users/page.tsx` | data-driven menu + route guard, password gate, old Users page → redirect |
| `scripts/backup/exclude-tables.txt`, `scripts/backup/restore.sh` | migration-created catalogue tables excluded; restore starts from the backup's permission catalogue (fixes a duplicate-key restore into a new project) |
| `scripts/db/local-supabase-shim.sql` | test shim: `auth.users` columns used by R1 |
| `docs/DEPLOYMENT.md`, `docs/DEPLOYMENT_CHECKLIST.md`, `docs/PLATFORM_ARCHITECTURE_PLAN.md` | function deployment, counts, status |

## Tests (all on the final commit)

| Suite | Result |
|---|---|
| SQL (`npm run db:test`) | **19/19** (17 existing + 200_platform_rbac + 210_platform_scopes_users) |
| API e2e against local Supabase incl. Edge Runtime | **7/7** (4 existing + 3 new) |
| Browser e2e (Playwright, static build) | **22/22** (16 existing + 6 new) |
| Worker unit | 4/4 |
| Worker container smoke (as the scheduled job) | OK |
| Backup → wipe → restore drill | OK (data and files identical) |
| Lint / typecheck / production build | OK |
| `npm audit --omit=dev` | 0 vulnerabilities |

### R1 success criteria → evidence

| # | Criterion | Proven by |
|---|---|---|
| 1 | Owner creates an internal user from UI | `platform-admin.spec` "creates an internal user…"; API `admin-users.test` |
| 2 | Owner generates temporary password | same (16 chars, 4 classes; not in any table / audit — API test) |
| 3 | User can log in | `platform-admin.spec` "user logs in…"; API test |
| 4 | User is forced to change password | same; SQL 200 (no access until changed, user cannot clear the flag) |
| 5 | Owner can disable user | `platform-admin.spec` "disables the user…"; API test |
| 6 | Disabled user cannot log in / use the app | login refused (banned); live token gets no permission and no data (API); SQL 200 |
| 7 | Owner creates a custom role | `platform-admin.spec` "custom role…"; SQL 200 |
| 8 | Owner clones a role | same ("Duplicate"); SQL 200 (`role_clone`) |
| 9 | Permissions from the Permission Matrix | same (matrix checkboxes → save); SQL 200 (`my_permissions` exact) |
| 10 | ALLOW override | `platform-admin.spec` "ALLOW / DENY overrides"; SQL 200 |
| 11 | DENY override | same |
| 12 | Godown data scope | `platform-admin.spec` (user restricted to Godown A); SQL 210 (user + role scope, union rules) |
| 13 | Backend / RLS enforces the scope | SQL 210 (tables, views, item detail, documents, lines, posting RPCs, transfers); API test (REST read, `doc_save` for Godown B rejected) |
| 14 | No bypass through URL / API | SQL 210 (submit / delete a Godown B document by id refused, even with delete permission; direct ledger insert refused); API test; browser direct URL → no access |
| 15 | OWNER protection intact | SQL 200 (M1 messages unchanged, owner role locked, no overrides / scope on owner, non-owner cannot change / disable / reset an owner, last active owner); API test (admin cannot disable owner) |
| 16–19 | Existing 17 SQL, 4 API, 16 browser, worker tests | all green (table above) |
| 20–22 | Lint, typecheck, build | green |

## Security review

* **Passwords**: generated in the Edge Function with `crypto.getRandomValues` (rejection sampling), set in Supabase Auth (bcrypt there), returned once, never written to an application table, audit row or log; the function ignores any password sent by the browser. Function logs contain only the action name and error class.
* **Service role**: only inside the Edge Function environment (injected by Supabase) and the existing GitHub secrets. Not in the browser, the Pages project or the repository (secret scan of the new files: clean).
* **Caller identity**: taken from the JWT verified by Supabase Auth; all business checks run as database RPCs with that JWT (`auth.uid()`), never from body fields. `company_id` from the browser is only a selector — every RPC checks membership and permission in that company.
* **Login operations across companies**: reset / disable of a login that also belongs to another company require the permission in **all** its companies; an existing login of another company is never treated as "new" (no forced password, no password change).
* **Escalation**: grant ⊆ own rights for role permissions, role assignment (RPC **and** direct API insert into `user_roles`), overrides and clones; self-changes blocked for non-owners.
* **Direct table writes** on `roles`, `role_permissions`, overrides, scopes, `company_users` revoked; profile columns `must_change_password` / `is_active` not writable by users (column grants).
* **Disabled / temporary-password users**: `is_member`, `has_permission`, portal guard all false → every RLS policy and RPC refuses, also with a still-valid access token; sessions revoked and login banned when no access is left.
* **Godown scope**: RLS (reads + direct writes) and triggers (SECURITY DEFINER posting). Registry completeness is a test: a future table with a godown column fails the suite until it is registered.
* **Anonymous**: no table grant, no function grant (checked on the Supabase stack). `auth_revoke_sessions` is service-role only (Supabase default privileges revoked explicitly).
* **Unchanged**: C1 (verified email only), portal isolation, approved price, stock ledger, payments, storage policies — all existing security tests green.

### Behaviour changes to note

1. **Direct URL without permission**: pages are no longer rendered (before: some showed read-only data the database allowed). Menu entries were already hidden.
2. **Seed-once roles**: company setup no longer re-applies default grants to system roles; what the owner configures stays.
3. **Stock transfer between godowns** requires access to **both** godowns (the IN movement is posted in the destination godown).
4. A sales order whose planned godown is outside the user's scope cannot be changed by that user.

## Not in R1 (planned)

* Customer / vendor / item data scopes, OWN_RECORDS / department scopes — R2 with the master phases (the dimension table is ready; nothing is stored without enforcement).
* Portal roles / per-login portal permissions (CUSTOMER_ADMIN … VENDOR_USER) — R2 (Phase 5). Today portal visibility = company settings + per-party overrides (unchanged).
* Field-level permissions (cost / rate visibility) — R2 with the item master (Phase 3).
* Request metadata (IP / user agent) in the audit log and the audit screen — R4 (Phase 9).
* Account lockout / password policy beyond Supabase Auth settings (rate limits, minimum length, leaked-password check on Pro).

## Production deployment of R1 (only after approval)

1. Run the `db-backup` workflow manually; download and test-decrypt the artifact.
2. On the admin PC at the approved commit: `npx supabase link --project-ref <ref>` → `npx supabase db push` (5 new migrations, forward-only, each in a transaction) → `npm run db:seed` (idempotent) → `npx supabase functions deploy admin-users`.
3. Cloudflare Pages: deploy the same commit (no new environment variables).
4. Smoke: owner → Admin → Users → New user (test address) → temporary password → log in in a private window → forced change → Roles & permissions → matrix → Godown access → disable / enable → reset password.
5. Rollback: web = previous Pages deployment; function = delete or redeploy previous; database = forward fix (or restore the pre-release backup into a new project, `DEPLOYMENT.md` §9–10). Existing users keep their rights after the migrations, so a web rollback alone is safe.
