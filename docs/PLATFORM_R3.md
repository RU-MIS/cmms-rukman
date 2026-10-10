# Platform R3 — Administration, approvals, audit, financial field security, masters, import / export completion

Branch `claude/charming-gauss-o9fvzf`. **Not deployed.** Production (`5cff5d6`) is unchanged; R1 (`a1a4c5c`) and R2
(`292bccec`) are not merged. Scope, decisions D1–D7 and the acceptance-criterion map: [`PLATFORM_R3_SCOPE.md`](./PLATFORM_R3_SCOPE.md).
Previous release: [`PLATFORM_R2.md`](./PLATFORM_R2.md). R4 (full regression, migration rehearsal, release candidate) has **not** been started.

Every setting below is configured in the UI and stored as data. Nothing is hard-coded per customer, user or role.

## What R3 adds

| Area | Delivered |
|---|---|
| Admin Control Center | `/erp/admin/settings` with 11 section tabs (company, branding, inventory, sales, purchase, documents, portals, email, payment reminders, approvals, security) plus the Modules, Numbering and Custom fields pages — **15 section rights** `settings_<section>.view / .edit`. Sections are read / saved through `settings_get` / `settings_save` (only the section's columns, audited). The old `/erp/settings` redirects there. |
| Modules | `/erp/admin/modules`: business modules are switched on / off per company. The **database** enforces it: `has_permission` / `permitted_company_ids` return nothing for a disabled module, so REST reads, document RPCs, imports, exports and portal RPCs all refuse. Core modules (Administration, Masters) cannot be disabled; the Modules page stays reachable for the Owner (recovery path, D6). |
| Numbering | `/erp/admin/numbering`: prefix, padding, pattern tokens, reset (never / calendar year / financial year / monthly), start number (only upwards), live preview; master codes (items, parties, godowns, brands, categories) can be numbered automatically. Concurrency-tested. |
| Approvals (D2) | `/erp/admin/approval-rules`: up to **3 levels** per document type, approver = role or the document's approve right (empty = approve right), **amount threshold** per level (`qty × rate`), self-approval and same-approver flags. `/erp/approvals`: inbox, approve, reject (**reason mandatory**), history per document. Enforced server-side: maker-checker, level order, approver must be able to open the record and every godown on it, amounts hidden without the rate right, immutable history (`approval_actions`), audit. **Rate-change approval** (setting): price changes become requests that a `rates.approve` holder applies. Customer-PO approval honours the sale-rate limit policy and carries the override reason and SO custom fields. |
| Audit (D4) | `/erp/admin/audit`: filters (date, user, area, action, record), keyset paging, export (≤ 50,000 rows, needs `audit.export`), detail diff; audit tab on items, parties, godowns. Every audit row carries `request_meta` (IP, user agent, session id). Rows are visible only with `audit.view` **and** inside the viewer's godown / customer / vendor scopes (scope keys stored on the row), field values are masked with the W13 classes, the Owner sees everything. Passwords, tokens, secrets and credentials are redacted centrally (`app.audit_redact`). Coverage registry `app.audit_coverage`. |
| Branding | Application name, short name, colour (contrast-corrected to WCAG AA), logo, favicon (private bucket `company-assets`, PNG / JPEG / WebP / ICO ≤ 1 MB, company folder only), document footer, e-mail sender name and reply-to. Applied to the ERP and portal shells, the PO PDF (logo, terms, footer on every page) and the e-mails. SVG is not accepted (script risk). |
| Security settings | Company password policy (minimum length 8–64, letters + digits) enforced by the `admin-users` Edge Function (`change_password`, temporary passwords are `max(16, policy)` long), temporary-password validity (expired temporary passwords cannot be turned into real ones — enforced by the database), idle sign-out, `/erp/admin/security` login overview (pending temporary passwords, disabled users, last logins). |
| Permissions | Customers / vendors split from `parties.*` (`parties.*` remains the umbrella), `documents.download` / `.share`, settings sections, `audit.export`, financial rights (below), `rates.approve`, `sales_order.override_rate_limit`, `accounts.opening_balance`. Backfilled so every existing role keeps its effective rights. |
| Record scope + departments | `/erp/admin/departments`; users get a department; record scope **All / My department / Own records** per role or user (restrictive RLS on `created_by` for every document table and customer POs). |
| Financial field security (D3) | Separate rights for **purchase rate** (`items.view_purchase_rate`), **landed cost** (`costs.view_landed_cost`), **average cost** (`items.view_cost`), **stock valuation** (`costs.view_stock_valuation`, also needs average cost), **gross margin** (`sales.view_margin`), **profit** (`reports.view_profit`), amounts (`accounts.view_amounts`). Sensitive columns are registered in `secure.sensitive_columns`; base-table column privileges are revoked and values are read through `secure.*_values` sidecar views merged into invoker `v_*` views. Reports, valuation, ledgers, exports, approvals inbox and audit use the same classes. A registry-driven test proves every right masks every registered column and that no other view or function reads them unmasked. |
| Masters | Items: min / max sale rate with OFF / WARN / BLOCK policy, more fields, delete-when-unused, documents / stock / audit tabs, bulk activate, image compression in the browser, orphan-image clean-up job (worker, daily). Godown administration: manager, default, receipts / dispatch / transfers flags enforced in posting, user assignment. Customers / vendors: legal name, type, status, delete-when-unused, **opening balances** (balanced opening journal per party, Dr / Cr validation, duplicates and closed periods refused, reversal instead of edit — no GST assumptions, D5). |
| Custom fields | Types text, number, date, yes / no, dropdown, multi-select, e-mail, phone, currency, file, image; entities items, customers, vendors, users, godowns, sales orders, purchase orders, documents; required / unique / searchable / restricted (restricted values stored separately and shown only with the field's view right, also masked in audit). |
| Import / export | Column mapping step with saved templates and suggestions (`pg_trgm`), 17 entities (new: units, categories, brands, item packings, party addresses, godown stock export, role assignments), automatic codes, imports **above 2,000 rows are queued** and committed by the worker as the importer (one transaction, rights re-checked at commit time). |
| Lists | Server-side paging (50), sorting and search on items / customers / vendors, bulk actions, keyboard shortcuts (`/` search, `n` new, `Ctrl+S` save, `Esc` close). |
| Hardening | `20261010000011_r3_privileges`: `anon` holds nothing on any public table or view, no API role holds TRUNCATE (it ignores RLS), function-only tables and masked views are not writable through the API, and default privileges stop Supabase from granting these to future tables. |

## Migrations (additive, 11)

`20261010000001`–`20261010000011` (catalogue + modules, financial security, settings / branding / security, numbering, approvals, audit,
scopes / departments, masters / opening balances, custom fields, import / export, privileges). Total on the branch: **46** migrations
(production `5cff5d6`: 24; R1 5, R2 6, R3 11). Fresh-instance migration verified: `supabase db reset` → `scripts/instance/init.sh` → `scripts/instance/verify.sh`
→ "RLS on every table, no anonymous access".

## Security model (summary)

| Layer | Enforcement |
|---|---|
| Company isolation | `company_id NOT NULL` + RLS in the InitPlan form on every new table (completeness test `395`). Storage paths start with the company id. Cross-company tests for REST, RPC, storage, import, export, approvals, audit. |
| Permissions / modules | `app.has_permission` (module-aware, cached per transaction). The UI hides; nothing depends on it — every R3 feature has a direct-API negative test. |
| Scopes | Godown / customer / vendor / item (R1 / R2) + record scope (R3), restrictive RLS; audit rows carry scope keys; approvers must be inside the scopes of the record. |
| Fields | Column privileges + sidecar masked views + definer functions that check the class (`secure.require_class`). No inference through another endpoint (valuation needs average cost; P&L stock needs profit + valuation; movement values follow the movement class). |
| Audit | Write-only for the API; immutable; secrets redacted; masked and scoped on read. |
| Privileges | `anon`: nothing. TRUNCATE: nobody. Writes only where a policy allows them. |
| Secrets | None added. Passwords are never stored, imported or logged; temporary passwords are shown once. |

### Security review (R3)

| Finding | Severity | Resolution |
|---|---|---|
| Supabase default privileges gave `anon` and `authenticated` ALL (incl. TRUNCATE) on the 15 new R3 tables / views; the local test shim did not emulate this, so tests missed it. Not reachable through PostgREST (no TRUNCATE endpoint, no `anon` policies), but it failed `verify.sh`. | Medium (defence in depth) | Migration `000011`; shim now mirrors Supabase defaults; test `395` asserts no `anon` privilege, no TRUNCATE, no API writes on function-only tables. |
| The same TRUNCATE grant exists on `party_settings` and `storage_locations` since the inventory release — i.e. **in production today**. Not reachable through the API. | Low–Medium, pre-existing | Fixed by `000011` when R3 is deployed. Production was not touched. |
| An approval level with neither role nor right failed (check constraint) although the UI offers "empty = anyone with the approve right". | Functional | `approval_rules_save` defaults it to `<document>.approve`; SQL test added. |
| Branding change applied only after a reload. | Functional | Settings save refreshes the session. |
| Reviewed and found sound: every definer function pins `search_path`; no public function is executable by `anon`; the only definer view (`v_items`, R2) applies the same company / item-scope filter as the `items` policies; `import_commit_next` is service-role only and runs the commit as the importer with rights re-checked; branding values are validated (reply-to regex, CR / LF stripped from the sender name); audit redaction covers password / token / secret / key fields. | — | — |

## Tests

| Suite | Result |
|---|---|
| SQL (`npm run db:test`, fresh build of all 46 migrations, Supabase default privileges emulated) | **35 / 35** files. New: `300` catalogue / modules, `310` financial security (registry-driven), `320` numbering + `325` concurrency, `330` approvals, `340` audit, `350` settings / branding / security, `360` scopes / departments, `370` masters / opening balances, `380` custom fields, `390` import / export, `395` completeness. |
| API e2e (real PostgREST / Storage / Auth / Edge Function) | **19 / 19** (12 R1 / R2 + 7 new in `e2e/api/r3-platform.test.mjs`: modules, settings + branding storage + password policy via the Edge Function, audit, financial masking, record scope, approvals, queued import). |
| Browser e2e (Playwright, static build) | **44 / 44** (30 R1 / R2 + 6 `r3-admin.spec.ts` + 8 `r3-acceptance.spec.ts` = the original 33 acceptance criteria as one journey, X-3). |
| Worker | 5 / 5 |
| Container smoke (`worker-container-smoke.sh`) | OK |
| Backup → wipe → restore drill | OK — data, `documents`, `item-images`, **`company-assets`**, branding, modules, approval rules / history, departments identical |
| Fresh instance (reset → init → verify) | OK |
| Lint / typecheck / build (web, worker) | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Changes to R1 / R2 tests (behaviour preserved)

| Test | Change | Why |
|---|---|---|
| `e2e/ui/flow.spec.ts`, `visibility.spec.ts` | Settings are opened in their section tab and saved per section; "Customer rate visibility" is labelled "Customers see their rates". | Sectioned settings (W1). Same settings, same effect. |
| `e2e/ui/flow.spec.ts`, `r2-master-data.spec.ts` | Item / party code field label without `*`. | Codes are optional when automatic numbering is on (W2); a typed code works as before. |
| SQL `040`, `110`, `160`, `190` | Reads of rate columns go through `test.raw` (as an API user the base-table rate columns are no longer granted; values are read through the masked views). One P&L assertion added. | W13 column privileges. |
| SQL `220` | Expected error text for valuation without the right. | Valuation now has its own right (D3). |
| SQL `240` | "Ten entities" asserts the ten R2 entities by code. | R3 adds entities. |
| SQL `330` (R3) | Updating approval history is refused by privilege instead of silently ignored. | Stricter after `000011`. |

## Performance (local stack, release-audit-size dataset: 2,000 items, 10,000 movements, 1,000,000 audit rows)

| Query (median of 5) | R2 | R3 owner | R3 operator | R3 scoped (record + godown) |
|---|---|---|---|---|
| Inventory list | 28–30 ms | 26 ms | 28 ms | 17 ms |
| Stock movements (base) | 5–6 ms | 4.9 ms | 4.8 ms | 5.6 ms |
| Stock movements with costs (masked view) | — | 17 ms | 17 ms | 15 ms |
| Items with prices / cost / margin | — | 6 ms | 5 ms | 5 ms |
| Audit viewer, 1M rows, date + user filter (AC-4.8 < 300 ms) | — | 161 ms | | |
| Audit viewer, 1M rows, no filter | — | 4 ms | | |

Import of 10,000 items (AC-11.5): add rows 0.18 s, validation 4.1 s (both under the 8 s API timeout), commit queued, worker commit 8.6 s
(service role, no API statement timeout). R2's scoped column measured an item-scope "no access" user and is not comparable.

## Known limitations

- **Password policy outside the Edge Function:** a user calling Supabase Auth's `updateUser` directly is bound only by the Auth project's
  minimum length. Set the Auth minimum to the strictest company policy in the Supabase dashboard (DEPLOYMENT_CHECKLIST).
- **Manual inference:** a user who may see individual purchase / landed rows could compute an average by hand; the system never computes
  or shows a value the user lacks the right for.
- **WARN sale-rate policy on sales orders** is shown when the customer PO is approved, not while typing.
- **Queued imports** run when the worker runs (every scheduled cycle); the screen polls the job status.
- **Deferred under D7:** team / business-unit scopes, per-company SMTP accounts, failed-login history, inline list editing, exports over
  50,000 rows.

## Production impact

**NONE.** No production database, Edge Function, secret, Cloudflare or `main` change. Eleven additive migrations
(`20261010000001`–`000011`) wait on the branch together with R1's and R2's. At deployment: create the `company-assets` bucket via the
migration, deploy the `admin-users` function, and run the worker with the new code (branding, import queue, orphan clean-up).
