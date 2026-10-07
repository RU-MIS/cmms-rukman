# Release audit — Inventory + Portals + PO + Documents + Email + Payment Reminders

Branch `claude/charming-gauss-o9fvzf`. Status: **production-ready candidate,
pending final human approval.** Nothing has been deployed to production.

Audit scope: database (RLS, grants, every SECURITY DEFINER RPC, constraints,
indexes, concurrency), authentication, storage, email worker, scheduled jobs,
UI, configuration / secrets, dependencies, documentation, backup / recovery,
performance. Production-like environment: local Supabase stack
(`supabase start`, same images as Supabase Cloud) configured like production
(`supabase/config.toml`: email confirmation ON, OTP template, Mailpit SMTP).

## Findings

| ID | Severity | Finding | Status | Regression test |
|---|---|---|---|---|
| C1 | CRITICAL | Invitations (staff role incl. ADMIN, portal login) were linked to **any** auth account with the same email, verified or not. With email confirmation off — the local default, and not stated as mandatory in the setup guide — anyone could sign up with an invited address and take the role. `user_invite` / `portal_invite` also linked unverified existing accounts. | **Fixed**: `app.auth_email()` and both invite RPCs require `email_confirmed_at` (migration 0009); confirmation ON made mandatory (config.toml, DEPLOYMENT §3). | T190 §C1; `e2e/api/auth.test.mjs` (attacker sign-up refused, real OTP claims) |
| H1 | HIGH | Setup guide said "public sign-ups off", but invited users have no other way to create their login → nobody but the first admin could ever sign in. | **Fixed** (docs + config): sign-ups ON + confirmation ON; first login by email code. | e2e auth (OTP, API + UI) |
| H2 | HIGH | Default Supabase magic-link email contains only a link, while the login screen asks for a 6-digit code. | **Fixed**: `supabase/templates/otp.html` (code + link), config + DEPLOYMENT §3. | `zz-auth.spec.ts` OTP login with real email |
| H3 | HIGH | An item's base unit could be changed after stock / documents existed (only the UI prevented it) → all quantities would be misread. | **Fixed**: trigger `items_base_unit_guard`. | T190 §H3 |
| H4 | HIGH | Expired / revoked / forged session left the user on an error screen without logout. | **Fixed**: session errors sign out and return to login; error screen has Logout. | `zz-auth.spec.ts` forged session |
| H5 | HIGH | Open redirect: `/login/?next=//evil.example` sent the user to another site after login. | **Fixed**: only same-site paths accepted. | `zz-auth.spec.ts` |
| H6 | HIGH | No working backup: Supabase Free has none and the documented nightly dump did not exist. | **Fixed**: `scripts/backup/backup.sh` + `restore.sh`, encrypted nightly workflow `db-backup.yml`, documents bucket files included. | `scripts/backup/drill-local.sh` (backup → wipe → restore identical) |
| M1 | MEDIUM | An ADMIN could insert the OWNER role directly into `user_roles`; the last OWNER could be removed. | **Fixed**: trigger `user_roles_owner_guard`. | T190 §M1 |
| M2 | MEDIUM | A manual sales order (`doc_save`) could carry a fake `customer_po_id` / customer quote. | **Fixed** in `app.post_sales_order`. | T190 §M2 |
| M3 | MEDIUM | Two reminder runs at the same time → unique violation aborted the whole run. | **Fixed**: `ON CONFLICT DO NOTHING` on the dedupe key. | T190 §M3 |
| M4 | MEDIUM | Supabase default privileges gave `authenticated` INSERT/UPDATE/DELETE on all views and INSERT/DELETE on `company_settings` (blocked by RLS / security-invoker, but not least privilege). | **Fixed**: revoked; default privileges tightened. | T190 §M4 |
| M5 | MEDIUM | Missing indexes for reservation, portal and storage-policy lookups. | **Fixed** (8 indexes). | perf check below |
| M6 | MEDIUM | Daily reminders depended on one specific cron firing (GitHub skips schedules under load). | **Fixed**: every worker run generates the day's reminders (idempotent). | worker container smoke test |
| M7 | MEDIUM | No security headers on the static site (framing, MIME sniffing, CSP). | **Fixed**: `web/public/_headers`. | manual check after deployment (DEPLOYMENT §7) |
| M8 | MEDIUM | Settings without range checks (e.g. 0 email attempts, negative reminder days). | **Fixed**: check constraints. | T190 §M8 |
| M9 | MEDIUM | Several screens showed a spinner forever when loading failed. | **Fixed**: error shown instead. | — |
| M10 | MEDIUM | If the worker dies after the SMTP server accepted a mail but before recording it, the mail is re-sent after 15 min (at-least-once delivery). | **Mitigated**: stable `Message-ID` per outbox row (receivers de-duplicate); documented. | — |
| M11 | MEDIUM | Docs promised logo/favicon env, manual bucket creation and settings screens that did not exist; PO PDF company address had no screen. | **Fixed**: logo/favicon env implemented, Settings → Company profile added, docs corrected, `DEPLOYMENT.md` written. | — |
| L1 | LOW | Close order / price edit / warnings use browser `prompt` / `alert`. | Open (works; UX only). | — |
| L2 | LOW | Some database constraint messages are technical (duplicate item on one customer PO, deleting a used master). | Open. | — |
| L3 | LOW | A party that is both customer and vendor shares one set of overrides. | Open (documented). | — |
| L4 | LOW | `npm audit`: 5 high (braces, dev-only lint tooling) — see below. | Accepted (no fix exists; not in production). | `npm audit --omit=dev` = 0 |
| L5 | LOW | No application rate limit on portal PO creation (Supabase API limits only). | Open. | — |
| L6 | LOW | Document numbering / approval rules have no screen (table editor). | Open (documented). | — |
| L7 | LOW | Views compute per-row quantities with functions; fine at current scale (see performance). | Open. | — |
| L8 | LOW | Email attachments are not size-limited; above the SMTP limit the email fails visibly (Email log). | Open. | — |

## Security review summary

* **RLS**: enabled on every public table (verified by query and `instance:verify`); no table without a policy; anon has no table grant and no function grant.
* **Every SECURITY DEFINER RPC** callable by users reviewed (52): each checks membership + permission, or resolves the portal party from the login, or requires the service role (`email_claim`, `email_complete`, reminders for all companies).
* **Company isolation**: T050, T120 §33, T160 §2, e2e storage (other company cannot read/upload).
* **Customer / vendor isolation**: portal users are not company members; T120, T130, T160, e2e portal tests.
* **Role permissions**: `app.role_grants`; settings / users / portal access / overrides / per-godown negative stock Owner-Admin only (T100, T120, T180, T190, `zz-auth.spec.ts` operator).
* **Approved price**: no write grant on PO/SO lines; only `customer_po.approve` can approve / change price (T110, T120, T190 §M2).
* **Stock manipulation**: ledgers append-only, balances trigger-only, `app.*` not executable (T100 §32).
* **Payments / allocations**: writes only through voucher RPCs; posted allocations immutable; vendors cannot touch them (T040, T160 §3).
* **Storage**: private bucket; read = `documents.view` of the company or own shared document while the portal is on; write = company folder or own portal folder (e2e storage on real Supabase Storage).
* **Negative stock**: company setting + per-godown flag Owner/Admin only (T100, T180).
* **Concurrency**: last-stock reservation / dispatch / receiving with parallel sessions (T060, T170); email claim with `SKIP LOCKED`.
* **Server-side validation**: every business rule is in the database; the UI only mirrors it. Base unit lock was the one UI-only rule (H3, fixed).

## Dependencies (`npm audit`)

```
eslint-config-next 16.4.0 → @next/eslint-plugin-next 16.4.0 → fast-glob 3.3.1 → micromatch 4.0.8 → braces 3.0.3
GHSA-vfj7-8cjw-p6xm (DoS by deeply nested brace patterns), affected range: all versions of braces
```
* **Not in production**: dev-only lint tooling; `npm audit --omit=dev` → 0 vulnerabilities; the static bundle and the worker install (`--omit=dev`) do not contain it. Exploiting it needs attacker-controlled glob patterns in the lint config.
* **No safe upgrade**: braces 3.0.3 is the latest release and no patched version exists. npm's suggested "fix" is a downgrade to eslint-config-next 14.2.35, which requires ESLint 7/8 and does not support this Next 16 flat config → lint would break (regression). Decision: accept, re-check on each release.

## Performance (2,004 items, 5 godowns, 200 locations, ~10,000 movements)

| Query | Time |
|---|---|
| Consolidated inventory list (`v_inventory_items`) | 20 ms |
| Location breakdown (`v_stock_by_location`, 8,000 rows) | 5 ms |
| Item detail (`inventory_item_detail`) | 8 ms |
| Movement history of an item | 3 ms |
| One stock OUT posting (`app.post_stock`) | 4 ms |

Browser: complete 16-test e2e run ≈ 50 s including ≈ 30 page loads and logins.

## Verification run (this commit)

See the "Tests" section of the release readiness report and `docs/DEPLOYMENT.md` §10 for the commands.
