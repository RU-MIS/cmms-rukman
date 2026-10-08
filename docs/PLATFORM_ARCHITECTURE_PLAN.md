# Rukman Dataflow — Configurable Multi-Tenant Platform: Audit & Plan

Status: **PROPOSAL — awaiting approval. No code, migration or production change has been made.**
Baseline: production release `5cff5d6` (= `main`). All work below is additive, on a development branch, released through the same test + release process.

---

## A. Current architecture audit (findings)

| Area | What exists today (production `5cff5d6`) | Assessment |
|---|---|---|
| Tenancy | One Supabase project per instance; **many companies per instance** isolated by RLS (`company_id` on every business table, `app.is_member`, company-consistency triggers). | Good foundation — "tenant = company" already works. Keep instance-per-client cloning as a deployment option. |
| Authorization core | **Already database-driven**: `permissions` (code, module, action), per-company `roles`, `role_permissions`, `user_roles`; `app.has_permission(company, code)` used by **54** RLS policies/RPCs; UI reads `my_permissions()` and checks `can('module.action')` — **no `role === 'admin'` logic in the frontend**. | Correct pattern; extend rather than replace. |
| Hard-coding that remains | (1) default grants of system roles in `app.role_grants()` and `sync_system_role_permissions()` **re-applies them**, (2) system roles are **not editable** (`roles_write`/`role_permissions_write` exclude `is_system`), (3) role codes `OWNER`/`ADMIN` checked in `create_company`, `user_invite`, owner guard, (4) `perm_action` enum has only VIEW/CREATE/EDIT/DELETE/APPROVE/CANCEL/EXPORT (no IMPORT, no field-level rights), (5) navigation list (`NAV`) lives in code (permission-gated, but module visibility not configurable). | Gaps 1–5 are fixed in Phase 1/8. |
| Data scopes | None. A member sees all godowns / customers / vendors / items of the company. | **Gap** — Phase 1. |
| Field-level security | None. E.g. `items.purchase_price` / `sale_price`, order rates readable by every member with module view. | **Gap** — Phase 1/3. |
| User management | Invite staff by email + role (`user_invite`), portal invite (`portal_invite`), members list (`company_members`), OTP / password login, password change. No admin-created login, temp password, force change, disable, last login, overrides. | **Gap** — Phase 2 (needs a server-side admin function, see G). |
| Portal users | `portal_users` (company, party, kind, email, user, active). Rights = company + party visibility settings (`company_settings`, `party_settings`). No portal roles / per-user portal rights. | Extend in Phase 2/5. |
| Item master | `items` (code, name, description, kind, category, brand, base/purchase/sales unit, barcode, purchase/sale price, min/max/reorder, GST, active, portal_visible), `item_packings` (item-specific conversion), `units` (configurable, system + company). | Missing: part no, model, subcategory UI, min/max rate, reorder qty, images, notes, documents, custom fields, rate history. Phase 3. |
| Rates | `party_item_rates` (SALE/PURCHASE/…, party or default, effective date). Transaction lines snapshot rates (immutable after posting). | Missing: rate history of master price, min/max sale rate enforcement, approval, import/export UI. Phase 3. |
| Godowns | `godowns` + `storage_locations` (zone/rack/shelf/bin, code RACK-SHELF-BIN), UI exists. | Missing: manager, assigned users, default godown, import/export, delete-where-safe. Phase 4. |
| Customers / vendors | `parties` + `party_roles` + `party_addresses` + `party_settings` (visibility overrides) + portal access UI. | Missing fields (legal name, contact person, pincode, credit limit, payment terms label, type, status, notes), import/export, custom fields. Phase 5. |
| Import / export | None. | **Gap** — Phase 6 (reusable engine). |
| Custom fields | None. | **Gap** — Phase 7. |
| Settings | `company_settings` (portals, visibility, email, reminders, negative stock), company profile, `document_sequences` (numbering; no UI), `approval_policies` (no UI), `app_settings` (k/v). | Admin Control Center + numbering/approval UI — Phase 8. |
| Audit | `audit_log` (append-only; table, row, action, old/new, actor, time) written by posting functions and master triggers. No UI, no request metadata. | Phase 9. |
| Branding | Per **instance** via `NEXT_PUBLIC_*` env. | Per-company branding in DB (env stays as fallback) — Phase 8. |
| Tests | 17 SQL + 4 API e2e + 16 browser e2e + worker + container smoke + backup drill. | Every phase adds tests; full regression before each release. |

## B. Existing schema reuse map

| Need | Reuse | Change (additive) |
|---|---|---|
| companies / tenants | `companies` | + branding columns (logo, favicon, colour, short name, document footer) |
| users | `auth.users` + `profiles` | + `user_type`, `employee_code`, `department_id`, `designation`, `mobile`, `status`, `must_change_password`, `last_login_at` mirror |
| roles | `roles` | + `kind` (INTERNAL / CUSTOMER_PORTAL / VENDOR_PORTAL), `description`, `is_active`, `is_locked` (OWNER only), `copied_from` |
| permissions | `permissions` | + `group_code`, `label`, `kind` (MODULE / PAGE / ACTION / FIELD / PORTAL), `sort_order`, `is_sensitive`; enum `perm_action` + IMPORT, UPLOAD, DOWNLOAD, SHARE, DISPATCH, RECEIVE, ASSIGN, RESET, MANAGE, VIEW_FIELD, EDIT_FIELD |
| role ↔ permission | `role_permissions` | none (rows become editable for every role except locked OWNER) |
| user ↔ role | `user_roles` | + `valid_from/valid_to` (optional) |
| user overrides | — | **new** `user_permission_overrides (company, user, permission, effect ALLOW/DENY)` |
| data scopes | — | **new** `scope_types` (seed), `role_data_scopes`, `user_data_scopes`, `user_scope_members (scope, entity_id)` |
| units, categories, brands | `units`, `item_categories`, `brands` | UI + import; subcategory = `parent_id` (exists) |
| items | `items`, `item_packings` | + columns; **new** `item_images`, `item_rate_history` |
| rates | `party_item_rates`, `items.*_price` | + `min_rate`, `max_rate`, `is_active`, `approved_by/at`; history trigger |
| godowns | `godowns`, `storage_locations` | + `manager_user_id`, `is_default`; scopes reuse godown ids |
| customers / vendors | `parties`, `party_roles`, `party_addresses`, `party_settings`, `portal_users` | + columns; `portal_users.role_id` |
| numbering | `document_sequences` + counters + `app.next_doc_no` | + master code sequences (ITEM, CUSTOMER, VENDOR) + UI |
| approvals | `approval_policies`, maker-checker in `doc_*` | UI only |
| documents / storage | `documents`, bucket `documents`, storage policies | + bucket `item-images` |
| audit | `audit_log`, `app.audit` | + `request_meta jsonb` (user-agent, forwarded IP from PostgREST headers), UI, export audit |
| settings | `company_settings`, `app_settings` | + module visibility, security policy, settings-section permissions |

## C. Missing modules

1. Authorization engine extensions: overrides, data scopes, field-level permissions, editable system roles, permission catalogue metadata.
2. User Management Center (internal / customer / vendor users, temp passwords, force change, disable/enable, last login, audit).
3. Role Builder + Permission Matrix.
4. Item/Part Master completion + images + rate management/history.
5. Godown management completion + godown/location/opening-stock import.
6. Customer/Vendor master completion.
7. Reusable Import/Export engine (CSV + XLSX).
8. Custom Field engine.
9. Admin Control Center (incl. numbering, approvals, branding, module visibility, security).
10. Audit Log viewer.

## D. RBAC architecture

**Effective permission** for user U in company C:
```
granted = (permissions of all ACTIVE roles of U in C)
          ∪ (overrides ALLOW)  −  (overrides DENY)
OWNER role (locked) = every permission, cannot be reduced or removed (last-owner guard stays)
```
* `app.has_permission(company, code)` keeps its signature (54 call sites unchanged) and gains overrides + role `is_active` + user `status` + `must_change_password` (a user who must change the password gets **no** business permission until changed — enforced in the database, not only the UI).
* `app.my_permissions` / `public.my_permissions` return the effective set; the UI keeps using `can()`.
* **Permission catalogue** is data: `permissions` rows with group/label/kind/sort, seeded for every module; new modules add rows by migration — the matrix renders whatever is in the table.
* **Levels**: MODULE (`items.*` visible in menu), PAGE (`<module>.view`), ACTION (`create/edit/delete/import/export/approve/cancel/…`), FIELD (`items.view_cost`, `items.view_sale_rate`, `items.edit_rate`, `purchase.view_cost_summary`, `sales.view_margin`, `payments.view_amounts` …), DATA SCOPE (below).
* Requested codes such as `sales.*`, `purchase.*`, `customers.*`, `vendors.*`, `inventory.*` are presented as **matrix groups** that map onto the existing document permissions (`sales_order.*`, `dispatch.*`, `customer_po.*`, `purchase_order.*`, `purchase_receipt.*`, `parties.*` …) — no renaming of codes used by production policies; new fine-grained codes are added where they do not exist (`customers.*`/`vendors.*` split of `parties.*`, `*.import`, `users.reset_password`, `users.assign_role`, `users.assign_permissions`, `documents.download/share`, `roles.manage`, `settings.<section>.edit` …). Old codes stay valid (compatibility layer = role backfill).
* **Owner vs Admin**: settings are split into section permissions (`settings.company.edit`, `settings.security.edit`, `settings.email.edit`, `settings.numbering.edit`, `roles.manage`, `users.manage_owners` …). OWNER always has all; the OWNER decides via the matrix which ones ADMIN gets. Hard-coded `OWNER`/`ADMIN` checks are replaced by permission checks (`users.manage_owners`, `company.create`).
* **Default roles** seeded per company (OWNER locked; ADMIN, MANAGER, SALES, PURCHASE, INVENTORY, ACCOUNTS, FACTORY, VIEWER, CUSTOMER_ADMIN, CUSTOMER_USER, VENDOR_ADMIN, VENDOR_USER) — **editable, cloneable, disable-able**; `sync_system_role_permissions` changes to "seed only once" so admin edits are never reverted. Existing roles (APPROVER, OPERATOR, ACCOUNTANT, …) remain and keep their current rights (no behaviour change for production users).

**Data scopes** (record-level, enforced in RLS and in every posting RPC):
| Scope type | Applies to |
|---|---|
| ALL_COMPANY | default (= today's behaviour) |
| ASSIGNED_GODOWNS | stock_balances, stock_movements, stock_reserved, transfers, adjustments, receipts, dispatches, reservations, locations, inventory views/exports |
| ASSIGNED_CUSTOMERS | customer POs, sales orders, dispatches, customer bills, receipts, party list |
| ASSIGNED_VENDORS | purchase orders, receipts, vendor bills, payments, party list |
| ASSIGNED_ITEMS / ITEM_CATEGORIES | items, stock, rates |
| OWN_RECORDS | documents created_by = user |
| OWN_DEPARTMENT / OWN_TEAM | records created by users of the same department/team (via `profiles.department_id`) |
| CUSTOM_SCOPE | named member list per entity |

Implementation: `app.scope_allows(company, entity_kind, entity_id)` (STABLE, SECURITY DEFINER, cached per statement) added to the RLS `USING` of the affected tables (`… and app.scope_allows(company_id, 'GODOWN', godown_id)`), and `app.require_scope(...)` inside `app.post_stock`, `post_dispatch`, `post_purchase_receipt`, transfers, reservations, approvals and exports. Security-invoker views inherit RLS automatically. Effective scope = union of role scopes and user scopes; no scope rows = ALL_COMPANY (backwards compatible).

**Field-level security**: sensitive columns (item purchase/sale price, rates on order lines, purchase cost, payment amounts if configured) become readable only through **masked security-invoker views** (`v_items`, …) that return `NULL` unless the field permission is granted; direct `SELECT` on those base-table columns is revoked from `authenticated` (column-level GRANT). Exports and RPCs use the same masking functions, so an export can never contain a column the user cannot see.

## E. Import / export architecture

* **Entity registry** `app.import_entities` (data): entity code, target, required permission (`<module>.import` / `.export`), column definitions (name, label, type, required, unique, reference lookup, allowed values, sensitive-field permission), commit function name. Custom fields are appended automatically.
* **Tables**: `import_jobs` (company, entity, file name, status DRAFT/VALIDATED/COMMITTED/FAILED/CANCELLED, counts, mode, created_by), `import_rows` (job, row_no, raw jsonb, mapped jsonb, status VALID/ERROR/IMPORTED, target_id), `import_errors` (job, row_no, column, value, message, suggestion), `import_templates` (saved column mappings), `export_jobs` (audit of exports).
* **Flow** (10 steps as specified): template download (generated from registry incl. custom fields) → file parsed **in the browser** (CSV native; XLSX via an MIT-licensed library — candidates `exceljs` / `read-excel-file`+`write-excel-file`, chosen after an `npm audit`) → column detection + mapping (saved as template) → rows sent in chunks of 500 to `import_stage(job, rows)` → `import_validate(job)` runs **in the database** (types, required, duplicates in file and in DB, references: units/godowns/locations/categories/parties/items/emails, negatives, unknown/missing columns, scope + permission of the importer) → preview + error table + "download error file" (original row + error columns) → user chooses **all-or-nothing** (default) or "import valid rows only" (explicit, shown as "Imported 940, failed 60" with the failed-row file) → `import_commit(job)` in one transaction through the same posting/insert functions as the UI (opening stock posts real `OPENING` movements, rates create history rows) → audit entry.
* Entities: items, item packings, units, categories, brands, customers, vendors, party addresses, godowns, locations, opening stock, item rates, customer rates, vendor rates, internal users (create invitations; passwords never imported), role assignments (only by `users.assign_role`), custom-field values.
* **Export**: `export_rows(entity, filters)` RPC — applies RLS, data scopes and field masks, logs an `export_jobs` row; browser builds CSV/XLSX. No table is exported by direct client queries, so export cannot bypass authorization.

## F. Custom field architecture

* `custom_field_definitions` (company, entity, key, label, type TEXT/NUMBER/DATE/DROPDOWN/MULTI_SELECT/BOOLEAN/EMAIL/PHONE/CURRENCY/FILE/IMAGE, options, required, default, visible, editable, searchable, exportable, sort, view permission, edit permission, is_active).
* Values: `custom jsonb not null default '{}'` column on items, parties, godowns, profiles, sales_orders, purchase_orders, documents (+ others later), validated by one generic trigger `app.tg_validate_custom_fields` against the definitions (type, required, options); GIN index for searchable fields.
* Field-level visibility: definitions with a view permission are masked by the same view/RPC layer as other sensitive fields.
* FILE/IMAGE fields store document ids (existing documents/storage policies).
* UI: one generic `<CustomFields entity=…>` renderer on every form, list column chooser, filters, import/export columns.

## G. User management architecture

* **Creating a login with a temporary password needs the Supabase Auth Admin API (service-role key)**, which must never reach the browser. Proposal: one **Supabase Edge Function `admin-users`** (Deno, deployed to the same Supabase project; service-role key stays in Supabase function secrets). It verifies the caller's JWT, calls `app.has_permission(company, 'users.create' | 'users.reset_password' | 'users.disable')` through the database, then: create user (email confirmed, temp password), reset password, ban/unban (disable/enable), revoke sessions. This stays within Supabase — **not** an architecture switch — but adds one deployment step (`supabase functions deploy admin-users`). Alternative without it: invitation-only (today's OTP flow) — no temporary passwords. **Decision needed (Q1).**
* Temporary password: generated server-side (crypto random, policy-compliant), returned **once** in the response, shown once in the UI with copy button, never stored or logged; `profiles.must_change_password = true`; until changed the user is routed to "Change password" and `has_permission` returns false.
* Disable/enable: Auth ban + `profiles.status = DISABLED` (RLS denies immediately even with a live token).
* Password policy: Supabase Auth settings (min length, character classes, leaked-password check on Pro) + documented; account lockout/rate limiting = Supabase Auth rate limits + CAPTCHA option.
* Last login / login audit: `auth.users.last_sign_in_at` via a definer RPC + `session_bootstrap` logs a LOGIN audit row (with user-agent / IP from request headers).
* "Send invitation / reset link": existing OTP invite + Auth reset email.
* Customer / vendor users: `portal_users.role_id` → portal role with portal permissions (`portal.view_stock`, `portal.view_rates`, `portal.create_po`, `portal.view_invoices`, `portal.view_payments`, `portal.view_documents`, `portal.upload_documents`, `portal.view_outstanding`, vendor: `portal.view_pos`, `portal.view_receipts`, `portal.view_payments` …). Effective portal right = company setting ∧ party override ∧ portal-user role. Portal RPCs check these permissions (still never direct table access).

## H. Security / RLS design

1. All new tables: RLS on, `company_id` NOT NULL, company-consistency trigger, policies via `has_permission` + `scope_allows`; writes through RPCs or permission-checked policies; anon nothing.
2. `has_permission` extended (overrides, role active, user status, must-change-password); `scope_allows` added to RLS of scoped tables; `require_scope` in posting RPCs.
3. Sensitive columns: column grants revoked; masked views + RPCs.
4. Never trust browser `company_id`: every RPC derives membership from `auth.uid()`; imports/exports run in the database with the caller's rights.
5. Storage: bucket `item-images` private; read = member with `items.view` (+ portal users for portal-visible items when image visibility is on); write = `items.upload_image`; path `<company>/<item>/<uuid>.webp`.
6. Owner protection: OWNER role locked; last owner guard (exists); only `users.manage_owners` can grant OWNER.
7. Audit for every security change (role, permission, override, scope, user status, password reset event — never the password).
8. Regression: all existing security tests must stay green (portal isolation, approved price, stock, payments, storage, C1 verified email).

## I. Migration plan (additive, each with tests; production data untouched until a release is approved)

| # | Migration | Content |
|---|---|---|
| 0010 | `platform_rbac_catalogue` | perm_action values, permission metadata, new permission codes, role kind/active/locked, editable system roles, seed-once grants, backfill so every existing role keeps exactly its current effective rights |
| 0011 | `platform_overrides_scopes` | `user_permission_overrides`, scope tables, `has_permission` v2, `scope_allows`, `require_scope`, RLS updates on scoped tables, posting RPC scope checks |
| 0012 | `platform_field_security` | masked views, column grants, export masking helpers |
| 0013 | `platform_users` | profile columns, departments, `must_change_password`, status, login audit, portal roles + portal permissions, user admin RPCs |
| 0014 | `platform_items` | item columns, `item_images`, bucket `item-images` + policies, `item_rate_history`, min/max rate checks, rate approval option |
| 0015 | `platform_godowns` | manager/default, user-godown assignment (via scopes), safe delete |
| 0016 | `platform_parties` | customer/vendor fields, master code numbering |
| 0017 | `platform_import_export` | registry, jobs/rows/errors/templates/export_jobs, stage/validate/commit/export RPCs per entity |
| 0018 | `platform_custom_fields` | definitions, `custom` jsonb columns, validation trigger, indexes |
| 0019 | `platform_admin_center` | module visibility, branding per company, settings-section permissions, numbering for masters |
| 0020 | `platform_audit` | request metadata, audit read RPC with filters, export audit |
Plus Edge Function `supabase/functions/admin-users` (if Q1 = yes).

Release safety: every phase on a branch → full suite (existing 17+4+16 + new) → production-like local stack → release candidate → your approval → `db-backup` → `db push` → Pages deploy (runbook). No direct production edits.

## J. UI screen plan

* **Admin Control Center** (`/erp/admin/`): Company · Branding · Users · Roles & Permissions · Data scopes · Godowns · Items · Customers · Vendors · Units/Categories/Brands · Import/Export · Custom Fields · Portal · Inventory · Sales · Purchase · Payments · Documents · Email · Reminders · Numbering · Approvals · Security · Audit Logs. Each section shown only with its permission.
* **Users**: list (search, filters: type/status/role/godown; bulk enable/disable/assign role; last login) → user drawer (profile, type, roles, overrides, godowns/customers/vendors scopes, portal rights, audit tab) → actions: create login + temp password (shown once), reset, force change, disable/enable, send invite/reset link.
* **Roles & Permissions**: role list (create, duplicate, rename, disable) → **Permission Matrix** (rows = modules/pages grouped, columns = actions, field-permission section, bulk: select all / clear / module all / copy from role) + data scope tab + portal rights tab; diff preview + audit on save.
* **Items**: list with search/filters/pagination/bulk/export/import, item drawer with tabs (General, Units & packing, Rates & history, Stock, Images, Documents, Custom fields, Audit).
* **Godowns & locations**, **Customers**, **Vendors**: same list + drawer pattern, import/export buttons, portal users tab.
* **Import/Export Center**: wizard (entity → template → upload → map → validate → preview/errors → commit) + job history with error files.
* **Custom fields**: per entity list + field editor.
* **Audit logs**: filters (user, entity, action, date), diff view, export.
* **Forced password change** screen; permission-driven navigation from `my_permissions` + module visibility; direct URL guard per page.
* Desktop-first ERP UI; portals remain mobile-friendly.

## K. Testing plan

| Layer | New tests (examples) |
|---|---|
| SQL | effective permissions (role ∪ allow − deny), disabled role/user, must-change-password blocks business RPCs, OWNER lock & last-owner, scope: godown A vs B in RLS + posting RPCs + views, customer/vendor/item scopes, field masking (no rate without permission), import validate (required, duplicates in file + DB, bad refs, negatives, emails, unknown/missing columns), import all-or-nothing vs valid-only, import authorization, export masking + scope, custom field validation, audit rows for every sensitive change, cross-company isolation for every new table |
| API e2e | `admin-users` function: create login + temp password + login + forced change; reset; disable → token rejected; unauthorized caller refused; item image upload/read/deny by storage policy; import 10,000 items performance |
| Browser e2e | the 33 acceptance criteria as user journeys (create user → temp password → forced change → custom role → matrix → godown restriction → item + image + rate → imports/exports of items/customers/vendors/godowns/opening stock → portal users with configured rights → unauthorized API/import/export blocked → audit visible) |
| Regression | complete existing suite (17 SQL, 4 API, 16 browser, worker, container smoke, backup drill) green before every release |

## Decisions needed before implementation

* **Q1** Edge Function `admin-users` for admin-created logins / temporary passwords / disable (recommended; stays inside Supabase; adds `supabase functions deploy` to the release runbook) — or invitation-only without temporary passwords?
* **Q2** Import mode default: all-or-nothing (recommended) with an explicit "import valid rows only" option — OK?
* **Q3** XLSX library: `exceljs` (MIT) or `read-excel-file`/`write-excel-file` (MIT) — final pick after `npm audit` in Phase 6.
* **Q4** Phase scope per release: one production release after each 2–3 phases (recommended: R1 = Phases 1–2, R2 = 3–5, R3 = 6–7, R4 = 8–10).
