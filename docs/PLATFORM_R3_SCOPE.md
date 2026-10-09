# Platform R3 — Scope, acceptance criteria and implementation / test map

Status: **APPROVED with decisions D1–D7 (§0)** — implementation in progress on the development branch.
The binding decisions in §0 override any differing text in §§1–8; §9 maps every acceptance criterion to its implementation and tests.
Baseline: development branch `claude/charming-gauss-o9fvzf` at R2 `292bcce` (on top of R1 `a1a4c5c`).
Production stays at `5cff5d630d704aeecdc670c1e6af642854eb7c60`. R3 changes nothing in production and is not merged into `main`.

Sources: the original platform specification (sections 1–41, including the 33 critical acceptance criteria), the approved
architecture plan ([`PLATFORM_ARCHITECTURE_PLAN.md`](./PLATFORM_ARCHITECTURE_PLAN.md)), and the R1 / R2 reports
([`PLATFORM_R1.md`](./PLATFORM_R1.md), [`PLATFORM_R2.md`](./PLATFORM_R2.md)). The gap analysis below was checked against the
R2 schema (permission catalogue, tables, functions) and the R2 UI, not written from memory.

---

## 0. Approved decisions (binding)

| # | Decision (as approved) | Effect on the scope |
|---|---|---|
| D1 | R3 = documented remaining functionality; R4 = regression / security / migration rehearsal / performance / release candidate only. No production deployment or `main` merge without separate approval. | §1 as proposed. |
| D2 | Up to 3 levels; amount thresholds; approver role or permission; no self-approval where maker-checker applies; mandatory rejection reason; approval history + audit; approver must have access to the record **and** its data scope; existing workflows unchanged unless configured; rate-change approval configurable; **server-side enforcement**. | W3 as proposed; AC-3.9 / 3.10 added. |
| D3 | **Separate permissions**: purchase rate, landed cost, average cost, stock valuation, gross margin, profit-related figures and reports. Masking applies to screens, DB / API responses, reports, exports, audit details and related calculations; **no inference through another endpoint**. | New W13 (financial field security) replaces the single "purchase cost summary" right of W7. |
| D4 | **No unrestricted audit for ordinary users.** Company isolation, audit permissions **and godown / customer / vendor restrictions** apply; financial values masked; **OWNER unrestricted**; never passwords / tokens / secrets / credentials. | W4 changed: audit rows carry their scope keys; RLS + masking; AC-4.9 / 4.10 added. |
| D5 | Balanced double-entry opening journals linked to customer / vendor sub-ledgers; validate Dr / Cr direction, totals, duplicate posting, period rules; prevent accidental reposting; auditable **reversal / correction** instead of editing; **no GST assumptions**. | W9 opening balance re-specified (AC-9.7a–e). |
| D6 | Module status **required** and enforced at database / RPC / API boundaries: direct API calls, imports, exports, posting functions and document actions of disabled modules rejected. Users, Roles, core Security Settings, Audit not disableable; OWNER keeps a safe recovery path. | W1 as proposed, AC-1.7–1.9 added. |
| D7 | May defer: team / business-unit scopes, per-company SMTP, failed-login history (if data not reliably available), inline list editing, exports > 50,000 rows. **Not deferrable**: field-level masking of purchase costs, **financial amounts** and margins everywhere; existing company / customer / vendor / item / godown scope enforcement; security checks on imports, exports, audit access and direct API calls. | Payment / financial-amount masking moves **into** R3 (W13). |

Additional requirements carried into every work stream: all ordinary administration through the UI; R1 / R2 behaviour and tests preserved;
additive migrations only, fresh-instance migration + backup / restore tested; no production, secrets, Cloudflare or `main` change;
branch `claude/charming-gauss-o9fvzf` only; full regression + security review; exact SHA; stop after R3.

## 1. Release grouping (revision proposed)

The approved grouping was R3 = Phases 6–7 (import / export, custom fields) and R4 = Phases 8–10. R2 already delivered most of
Phases 6–7, so this document proposes:

| Release | Content |
|---|---|
| **R3** | Remaining work of Phases 3–7 (gaps listed in §2) + **Phase 8 Admin Control Center** (settings sections, numbering, approvals, branding, security, module visibility) + **Phase 9 Audit Logs** |
| **R4** | **Phase 10**: consolidated regression of R1–R3, security review, migration rehearsal on a production-like copy, performance at volume, release candidate and deployment runbook. No new features. Production deployment happens only after your separate approval. |

## 2. Requirement coverage after R2

✅ done · ◐ partial (gap goes into R3) · ⬜ missing (goes into R3) · ⏸ proposed to defer (see §5)

| Original requirement | State | R3 work stream |
|---|---|---|
| 2–3 Database-driven RBAC, module / page / action / field levels | ✅ engine · ◐ catalogue: no `customers.*` / `vendors.*` split, no `documents.download` / `documents.share`, no per-section settings rights, no margin / purchase-cost-summary rights; unused codes (e.g. `audit.create`, `reports.edit`) clutter the matrix | W7 |
| 4 Data scopes | ✅ GODOWN, CUSTOMER, VENDOR, ITEM (All / Selected / No access) · ⬜ OWN_RECORDS, OWN_DEPARTMENT · ⏸ OWN_TEAM, business units | W8 |
| 5–6 User management, passwords | ✅ (R1) · ◐ department is free text (no master); password policy only Supabase's floor; no security / login overview screen | W6, W8 |
| 7–8 Role builder, permission matrix | ✅ | — |
| 9 Item master | ◐ missing: part number, model, subcategory in the UI, minimum / maximum sale rate, reorder quantity, item documents, stock and audit tabs, image compression | W9 |
| 10 Item images | ✅ · ◐ no client-side compression; orphaned files are not cleaned up | W9 |
| 11 Rates | ✅ manual entry, history, import / export, field security · ⬜ min / max sale-rate enforcement, rate active / inactive, rate approval "if required" | W3, W9 |
| 12–14 Import / export | ✅ engine, 10 entities, validation, all-or-nothing, error file, scoped and masked export · ⬜ **column mapping step** (step 4), saved mappings, "suggested correction", entities units / categories / brands / packings / party addresses / role assignments, stock and godown-wise stock export · ◐ a 10k-row commit is close to the 8 s timeout | W11 |
| 15–16 Godown management | ◐ UI exists (create / edit / disable, locations) · ⬜ manager, assigned users, default godown, delete where safe, transaction flags, admin page, godown-wise stock export | W9, W11 |
| 17–18 Customer / vendor master | ✅ most fields, rates, portal, logins · ⬜ legal name, opening balance, customer / vendor type master, status beyond active (e.g. on hold), documents tab, portal-enabled flag shown on the master | W9 |
| 19 Custom fields | ◐ entities ITEM / CUSTOMER / VENDOR, types TEXT / NUMBER / DATE / BOOLEAN / DROPDOWN, required · ⬜ entities USER / GODOWN / SALES_ORDER / PURCHASE_ORDER / DOCUMENT; types MULTI_SELECT / EMAIL / PHONE / CURRENCY / FILE / IMAGE; default, visible, editable, searchable, exportable, role visibility | W10 |
| 20 Configurable menu, **module visibility** | ✅ permission-driven menu + URL guard · ⬜ admin-configurable module visibility | W1 |
| 21 Admin Control Center sections | ◐ Users, Roles, Items, Customers, Vendors, Import / Export, Custom fields exist; settings is one page with one `settings.edit` right · ⬜ sections Company, Portal, Inventory, Sales, Purchase, Payment, Document, Email, Reminder, Numbering, Branding, Security, Audit, Modules with their own rights | W1 |
| 22 Numbering | ◐ engine exists (`document_sequences`: prefix, pattern, padding, start, NEVER / FY reset) but **no UI**, no calendar-year tokens, no master codes (item / customer / vendor) | W2 |
| 23 Audit log | ◐ append-only `audit_log` written for most security and document events · ⬜ **viewer UI**, IP / session metadata, gaps in coverage (settings, godowns, payments edits, document deletes, portal settings), secret redaction as a central rule, audit export | W4 |
| 24 Security | ✅ throughout · new R3 surfaces must follow the same rules | all |
| 30 Owner vs Admin | ◐ owner is locked and protected · ⬜ owner decides **which settings sections** admin may use | W1, W7 |
| 31 UI (search, filters, sorting, pagination, bulk, shortcuts) | ◐ search / filters / bulk exist on Users; master lists load everything client-side, no sorting / pagination / shortcuts | W12 |
| 36 Cloning / white label: branding, logo, favicon, app name, short name, colour, document footer, email sender, prefixes | ◐ branding is per **instance** (env) · ⬜ per-company branding | W5 |
| Approval workflows (sections 1, 11, 21; plan §B "approvals UI") | ◐ single-level maker-checker per document type (`approval_policies`: on / off, self-approval) with **no UI**, no thresholds, no multi-level, no inbox | W3 |
| R2 request "field-level security: sales rate, purchase rate, cost, **margin**" | ◐ rate and cost rights were delivered; **no margin right was created** (no screen shows margin today). The R2 report did not call this out; it is corrected here. | W7 |

## 3. R3 work streams, deliverables and acceptance criteria

Each criterion must pass in the **UI** (browser e2e) and at the **API / database** level (SQL or API e2e), unless marked "DB" or "UI".
"Without code change" means a configuration change in the Admin UI that takes effect at the next page load.

### W1 — Admin Control Center: settings sections, Owner vs Admin, module visibility

Deliverables
- `/erp/admin` becomes the single entry point. The current `/erp/settings` page is split into sections, each a page under `/erp/admin/settings/<section>`: **Company, Branding, Modules, Inventory, Sales, Purchase, Payments, Documents, Portal, Email, Reminders, Numbering, Approvals, Security, Audit**. The old URL redirects.
- New per-section permissions `settings.<section>.view` / `.edit` (see W7). They are backfilled so every role keeps today's behaviour (`settings.view` → all `.view`, `settings.edit` → all `.edit`).
- **Owner vs Admin:** the owner grants or withholds each section through the permission matrix. The owner always has every section. Nobody can grant a section right they do not hold (R1 anti-escalation).
- **Module visibility** (`company_modules`): Inventory, Sales, Purchase, Payments / Accounts, Production / Factory, Documents, Reports, Customer portal, Vendor portal, Import / Export.
  - A disabled module disappears from the menu and Admin Center, and its pages show "not enabled".
  - **The database refuses the module's permissions:** `has_permission` returns false while the module is off; this is still an InitPlan, not per row.
  - Users, Roles, Settings and Audit are core modules and cannot be disabled (no lock-out).
- **New settings** introduced by other work streams live in these sections:
  - Sales: min / max sale-rate policy.
  - Purchase: approval thresholds through W3.
  - Documents: allowed categories, max size.
  - Rates: "rate changes need approval".

Acceptance criteria
- **AC-1.1** A user with `settings.email.edit` but not `settings.security.edit` can save email settings. Opening Security by URL shows "no access". Calling the security-settings RPC directly is refused.
- **AC-1.2** Owner removes `settings.numbering.edit` from ADMIN in the matrix. An admin user can no longer change numbering (UI + API); no code change.
- **AC-1.3** Owner disables the *Purchase* module.
  - For every non-owner user, Purchase orders / Receiving disappear from the menu.
  - Direct URLs show "not enabled".
  - REST reads of `purchase_orders` return no rows and `doc_save('PURCHASE_ORDER', …)` is refused.
  - Re-enabling restores access.
- **AC-1.4** Users, Roles, Settings and Audit cannot be disabled (UI and API refuse).
- **AC-1.5** Every existing role keeps exactly its current effective permissions after migration (SQL test compares before / after).
- **AC-1.6** Every settings change writes an audit row with old and new values (W4).
- **AC-1.7** (D6) Imports and exports of a disabled module's entities are refused by `import_create`, `import_commit` and `export_rows`.
- **AC-1.8** (D6) Posting functions and document actions (`doc_save` / submit / approve / reject / cancel, module RPCs such as reservation,
  dispatch, PO print / e-mail) of a disabled module are refused; portal RPCs are refused when the portal module is disabled.
- **AC-1.9** (D6) OWNER recovery: the owner can always open Modules and re-enable a module; core modules cannot be disabled by anyone;
  module changes are audited.

### W2 — Document and master numbering

Deliverables
- **Numbering** section listing every sequence:
  - all 23 document types in `app.default_sequences`;
  - the customer-bill reference prefix;
  - new **master code sequences**: ITEM, CUSTOMER, VENDOR, GODOWN.
- Editable per sequence: prefix, pattern, padding, start number, reset policy (**Never / Financial year / Calendar year / Monthly**), and active. Pattern tokens are `{PREFIX}`, `{FY}`, `{YYYY}`, `{YY}`, `{MM}`, `{NUMBER}`.
- Live preview of the next number, plus the last number issued in the current period.
- Rules, enforced in the database:
  - Changes apply to future numbers only. Issued numbers are never changed.
  - The start number cannot be set at or below a number already issued in the current period, so numbers can never collide.
  - Numbers stay gap-free under concurrency (existing counter-lock mechanism).
- Master codes: when the code field is left empty on create (UI or import, if the sequence is active), the next master code is assigned. A manual code is still allowed and must be unique.
- Audit of every change.

Acceptance criteria
- **AC-2.1** Admin sets SALES_ORDER to prefix `SO-`, pattern `{PREFIX}{YYYY}-{NUMBER}`, padding 6, reset Calendar year. The next sales order gets `SO-2026-000001` and the following one `SO-2026-000002`, without a code change.
- **AC-2.2** PURCHASE_ORDER → `PO-2026-000001` and VOUCHER_RECEIPT → `REC-2026-000001` in the same way.
- **AC-2.3** Setting the start number below an already issued number is refused with a clear message (UI + API).
- **AC-2.4** 20 concurrent document creations get 20 distinct consecutive numbers (concurrency test).
- **AC-2.5** Customer code sequence `CUS-{NUMBER}` padding 5 is active, and a customer is created with an empty code → `CUS-00001`. The same works through import with an empty `code` column.
- **AC-2.6** A user without `settings.numbering.edit` cannot change a sequence by API.
- **AC-2.7** A calendar-year reset produces `…-2027-000001` for the first document dated in 2027 (test with dates).

### W3 — Approval workflows

Deliverables
- **Approval rules** per document type (all types in the document framework, plus customer PO review and rate changes):
  - Requires approval: on / off.
  - **Levels 1–3**. Each level has: approver = a permission (`<doc>.approve` by default) or a specific role; an optional **amount threshold** (the level applies only when the document value ≥ threshold); and self-approval allowed yes / no.
  - The same person cannot approve two levels of the same document unless the rule allows it.
- Approvers must also pass the document's **data scope** (godown / customer / vendor / item).
- **Approval inbox** `/erp/approvals`:
  - documents waiting for *my* level, with filters and a count badge in the menu;
  - open, approve, or reject with a mandatory reason (rejected → back to DRAFT with the reason shown to the creator).
- **Approval history** (`approval_actions`): who, level, decision, comment, time. Shown on the document and in the audit log.
- Optional email to approvers through the existing email outbox (setting per rule).
- **Rate approval** (company setting, off by default): when on, a price or party-rate change by a user without `rates.approve` becomes a *pending rate change*. It is effective only after approval; the rate history shows requester and approver. Transactions keep their snapshot rates (unchanged rule).
- Existing behaviour is the default: rules are migrated from `approval_policies` (today only MATERIAL_ISSUE requires approval), so nothing changes until an admin configures it.

Acceptance criteria
- **AC-3.1** Admin configures PURCHASE_ORDER as follows: level 1 = role *Purchase manager*; level 2 = role *Owner* for value ≥ 1,00,000. Then:
  - A PO of 50,000 needs one approval.
  - A PO of 2,00,000 stays PENDING after level 1 and posts only after level 2.
- **AC-3.2** The creator cannot approve their own document when self-approval is off (UI hides the button; RPC refuses).
- **AC-3.3** An approver restricted to Godown A does not see a Godown B transfer in the inbox, and the approve RPC refuses it.
- **AC-3.4** Reject requires a reason; the document returns to DRAFT and the reason is visible to the creator and in the audit log.
- **AC-3.5** Approving the same level twice, or approving out of order, is refused.
- **AC-3.6** With rate approval on, a sales user's rate change is not effective until approved; the approver sees old vs new; approval makes it effective and writes rate history with both users.
- **AC-3.7** A user without the approver permission or role gets no inbox entries and is refused by API.
- **AC-3.8** With no rules changed after migration, all existing document flows behave exactly as in R2 (regression suite green).
- **AC-3.9** (D2) Approval rules are enforced by the database: calling `doc_approve` / approval RPCs directly with a user who does not
  satisfy the level (role / permission / threshold / self-approval / scope) is refused.
- **AC-3.10** (D2) Every approval, rejection (with reason) and rate-change decision is in the approval history and the audit log.

### W4 — Audit log: coverage, metadata, viewer, export

Deliverables
- **Coverage** — every sensitive change writes `audit_log`, extended to the gaps:
  - settings sections, numbering, approvals, branding, modules, security settings;
  - godowns / locations;
  - payments / vouchers edits and cancels;
  - document deletes and visibility changes;
  - portal settings and party visibility;
  - stock adjustments and imports (exists);
  - exports (exists in `export_log`, shown in the viewer).
  - A registry test fails if a configured sensitive table has no audit trigger.
- **Request metadata**: IP address and user agent as reported by the Supabase gateway (`request.headers`), plus session id, stored in `request_meta`. Rows written before R3 have none.
- **Redaction**: a central rule removes keys such as `password`, `token`, `secret`, `otp`, `service_role`, `smtp` from old / new values before they are written. A test proves a temporary password never reaches the table.
- **Audit viewer** `/erp/admin/audit`:
  - filters: date range, user, area / table, action, record (code or id);
  - paginated server-side; detail with a side-by-side old / new **diff**.
  - Shortcuts: an "Audit" tab on item, customer, vendor, godown, user and role drawers.
- **Field masking in the viewer**: rate / cost values in old / new are masked unless the viewer holds the corresponding field right (otherwise the audit log would leak prices).
- **Export** of the filtered audit (CSV / XLSX) with `audit.export`; the export itself is logged.
- Append-only: no update or delete by anyone, including the owner (database-enforced; exists, re-tested).

Acceptance criteria
- **AC-4.1** Each of the following creates an audit row with who, when, what, record, and old / new values, visible in the viewer:
  - user created, user disabled;
  - role permissions changed;
  - rate changed;
  - item / customer / vendor changed;
  - stock adjusted, stock imported, bulk import committed, export generated;
  - payment changed;
  - approval performed;
  - document deleted;
  - portal setting changed;
  - numbering / branding / module changed.
- **AC-4.2** An audit row written through the API carries IP and user agent.
- **AC-4.3** No audit row contains a password, temporary password, token or SMTP secret (test scans all rows after the full e2e run).
- **AC-4.4** A user without `audit.view` cannot open the viewer (URL) or read `audit_log` / the audit RPC (API).
- **AC-4.9** (D4) Audit rows carry their scope keys (godown, customer / vendor, item — derived from the row, lines from their header). A
  non-owner auditor restricted to Godown A / Customer X sees only rows of that scope (plus company-level rows without scope keys).
- **AC-4.10** (D4) OWNER sees all audit rows of the company unmasked; every other auditor sees financial values masked per W13.
- **AC-4.5** A viewer with `audit.view` but without `items.view_sale_rate` sees `•••` instead of sale prices in item diffs (generalised to all W13 classes).
- **AC-4.6** Audit rows of company A are never visible to company B (cross-company test).
- **AC-4.7** UPDATE / DELETE on `audit_log` is refused for every role.
- **AC-4.8** With 1,000,000 audit rows, the first page with a date + user filter loads in < 300 ms (local stack).

### W5 — Company branding and white label

Deliverables
- **Branding** section, per company: app name, short name, logo, favicon, primary colour, document footer text, email sender **name** and **reply-to** address.
- Files are stored in a private bucket `company-assets` (company-isolated policies; read = members and that company's portal users; write = `settings.branding.edit`), with type and size validation (PNG / SVG / WebP / ICO, ≤ 1 MB).
- Applied:
  - after login: ERP shell, portal shell, browser title, favicon;
  - generated PDFs (PO): logo + footer;
  - emails: sender name, reply-to, footer.
- The **login page** keeps the instance branding (env) because the company is not known before login. Env values stay as the fallback whenever a company has no branding.
- Colour: hex validation and automatic text colour (WCAG AA 4.5:1 contrast) so a chosen colour cannot make the UI unreadable.

Acceptance criteria
- **AC-5.1** Company A sets name, short name, logo, favicon and colour. After reload, its users and portal users see them. Company B users on the same instance still see their own (or the default) branding.
- **AC-5.2** A PO PDF of company A shows A's logo and footer; emails show A's sender name and reply-to.
- **AC-5.3** Company B (owner included) cannot read or overwrite company A's logo through Storage; anonymous access is refused.
- **AC-5.4** Uploading a non-image or a file > 1 MB is refused.
- **AC-5.5** A user without `settings.branding.edit` cannot change branding (UI + API).
- **AC-5.6** Onboarding a new company needs no code change or environment change: profile, branding, prefixes, settings, roles are all set in the UI. A browser e2e journey creates a second company and configures it end to end.

### W6 — Security settings

Deliverables
- **Security** section:
  - password policy (minimum length ≥ Supabase's minimum, character classes), enforced by the change-password screen and the `admin-users` function;
  - temporary-password validity (days);
  - optional idle sign-out after N minutes (client-side convenience, documented as such);
  - read-only display of what Supabase Auth enforces (rate limits / lockout).
- **Login overview**:
  - last login per user;
  - recent successful logins (from the R1 login audit) with IP / user agent;
  - users with pending temporary passwords;
  - disabled users.

Acceptance criteria
- **AC-6.1** With minimum length 12 configured, the change-password screen and the API refuse an 11-character password, and an admin-generated temporary password always satisfies the policy.
- **AC-6.2** A temporary password older than the configured validity can no longer be used to sign in; it shows "ask your administrator for a new password".
- **AC-6.3** The login overview shows the last login with IP / user agent and is visible only with `settings.security.view`.

### W7 — Permission catalogue completion

Deliverables
- **`customers.*` and `vendors.*`** (view / create / edit / delete / import / export) split from `parties.*`:
  - backfilled from `parties.*` so nobody gains or loses access;
  - RLS on parties: customer rows need `customers.view`, vendor rows `vendors.view`, other parties `parties.view`;
  - the customer / vendor pages, imports and exports use the new codes.
- **`documents.download`** (storage read; backfilled from `documents.view`) and **`documents.share`** (make visible to a party / email; backfilled from `documents.edit`).
- **Field rights:** see **W13** (D3 replaced the single purchase-cost-summary right with six separate rights).
- Settings section rights (W1); `audit.export`; `sales_order.override_rate_limit` (W9).
- **Catalogue clean-up:** permissions that no policy or function checks (e.g. `audit.create`, `reports.edit`, `settings.cancel`) are hidden from the matrix (`is_active = false`). A SQL test proves that no policy or function references a hidden code.

Acceptance criteria
- **AC-7.1** A role with `customers.view` but not `vendors.view` sees customers and not vendors through REST, export and UI.
- **AC-7.2** All R2 roles have identical effective access to parties before and after the split (SQL comparison).
- **AC-7.3** A user with `documents.view` but not `documents.download` sees the document list but cannot download the file (Storage refuses).
- **AC-7.4** Margin is visible only with `sales.view_margin` + sale rate + average cost (W13).
- **AC-7.5** The matrix no longer shows no-effect permissions; no hidden code is referenced by any policy or function.

### W8 — Data scopes completion: OWN_RECORDS, OWN_DEPARTMENT, departments

Deliverables
- **Departments master** (Admin → Users → Departments). `company_users.department` text is migrated to a department reference; distinct existing values become department rows.
- New record scope per user / role on transaction documents (headers with `created_by`): **All**, **Own records** (created by me), **My department** (created by users of my department).
  - It combines restrictively with godown / customer / vendor / item scopes.
  - Enforced by restrictive RLS through the existing registry, in the InitPlan form.
  - Lines follow their header.

Acceptance criteria
- **AC-8.1** A user with "Own records" sees only sales orders they created (REST, UI, export), and cannot open another user's order by URL or ID.
- **AC-8.2** A user with "My department" sees orders created by colleagues of the same department, not by other departments.
- **AC-8.3** Own records + Godown A: only own records in Godown A.
- **AC-8.4** Inventory / document list timings stay within 20 % of the R2 numbers for scoped users (performance test).

### W9 — Master data completion

Deliverables
- **Items**:
  - part number, model, subcategory (category tree in the UI), reorder quantity, item documents, Stock tab (by godown / location, read), Audit tab;
  - **minimum / maximum sale rate**, with a company policy *Off / Warn / Block* in Sales settings. Block is enforced in the database on sales-order line save and submit; `sales_order.override_rate_limit` allows an audited override;
  - rate rows get **active / inactive**;
  - client-side image compression / resizing before upload (max dimension and quality configurable);
  - a worker job removes orphaned image files (no row, older than 24 h).
- **Godowns** (`/erp/admin/godowns`):
  - manager (user), default godown, assigned users (writes user godown scopes, with a warning when this restricts a user who had all godowns);
  - transaction flags *receipts / dispatch / transfers allowed* (enforced in the posting engine; `allow_negative` exists);
  - delete where safe; Audit tab.
- **Customers / vendors**:
  - legal name, **type** (configurable master), **status** (Active / On hold / Disabled; *On hold* blocks new sales orders / POs, database-enforced);
  - **opening balance** (Dr / Cr, as-of date), posted as one opening journal per party through the existing accounting engine (see D5);
  - Documents tab; portal-enabled indicator; Audit tab.
- **Delete where safe** (items, customers, vendors, godowns, locations): allowed only without references (movements, documents, rates, balances) and database-enforced; otherwise the UI offers *Disable*. Audited.

Acceptance criteria
- **AC-9.1** With policy *Block*, saving a sales order line below the item's minimum sale rate is refused by API and UI. A user with `sales_order.override_rate_limit` can save it with a reason, which is audited. With *Warn* it saves with a visible warning.
- **AC-9.2** An inactive customer rate is not used for new documents; existing documents keep their snapshot rates.
- **AC-9.3** A 6 MB photo is compressed below 5 MB in the browser and uploaded; orphaned files are removed by the worker (test).
- **AC-9.4** Godown with receipts disabled: a purchase receipt into it is refused by the database.
- **AC-9.5** Deleting a godown with stock or movements is refused; deleting an unused one works; both are audited.
- **AC-9.6** A customer *On hold* cannot get a new sales order (API + UI); existing documents continue.
- **AC-9.7a** (D5) An opening balance (party, receivable / payable side, Dr / Cr, amount > 0, as-of date) posts **one balanced
  double-entry journal** (`is_opening`): party line on Sundry Debtors / Creditors (sub-ledger) against *Opening Balance Adjustment*.
  No tax lines.
- **AC-9.7b** Direction validated: customer receivable defaults to Dr, vendor payable to Cr; the opposite (advance) needs an explicit
  confirmation flag; amount ≤ 0 or unbalanced totals are refused.
- **AC-9.7c** Duplicate posting refused: one active opening balance per party and side; re-submitting the same request is idempotent.
- **AC-9.7d** Period rules: dates inside locked books are refused for posting and for reversal.
- **AC-9.7e** No editing of posted entries: correction = auditable **reversal** (reason required, reversal journal linked) followed by a new
  opening balance; history shows both. Balances appear in the party ledger, outstanding and party balances; trial balance stays balanced.
- **AC-9.8** Assigning a user to a godown from the godown page is effective immediately and enforced by RLS.

### W10 — Custom fields completion

Deliverables
- Entities: + **USER, GODOWN, SALES_ORDER, PURCHASE_ORDER, DOCUMENT**.
- Types: + **MULTI_SELECT, EMAIL, PHONE, CURRENCY, FILE, IMAGE** (file / image fields store document ids and use the documents storage rules).
- Properties: default value, visible, editable, searchable (indexed, usable in list filters), exportable, **view permission / edit permission** (role visibility).
- Fields with a view permission are stored outside the generally readable column and served masked through views / RPCs. Exports and imports respect them.

Acceptance criteria
- **AC-10.1** Admin adds a required DROPDOWN to Sales orders. The SO form shows it, save without it is refused by the database, and it appears in export.
- **AC-10.2** An EMAIL / PHONE field rejects invalid values (DB); a MULTI_SELECT accepts only listed options.
- **AC-10.3** A field with view permission `items.view_cost` is invisible (UI, REST, export, audit diff) to users without that right.
- **AC-10.4** A *searchable* field filters the item list server-side.
- **AC-10.5** A field marked *not exportable* is absent from exports and templates.
- **AC-10.6** A FILE field upload follows document storage isolation (other company / customer refused).

### W11 — Import / export completion

Deliverables
- **Column mapping step** (original step 4): detected headers ↔ entity columns, auto-mapped by key / label / saved mapping, editable. Required columns must be mapped. **Saved mappings** per company and entity (`import_templates`).
- **Suggested correction** for reference errors: the closest existing code, e.g. "Godown GDN-999 does not exist — did you mean GDN-099?" (trigram similarity), shown in the error table and the error file.
- New entities:
  - units, categories (with parent = subcategory), brands, item packings, party addresses;
  - **role assignments** (needs `users.assign_role`; R1 anti-escalation and owner protection apply to every row).
- Exports: **current stock** (item × godown × location) and **godown-wise stock** (masked values without `items.view_cost`, godown / item scope applied).
- Large-file robustness: a 10,000-row all-or-nothing commit must succeed with the 8 s `authenticated` statement timeout. The mechanism is decided during R3 and documented. If no safe mechanism exists, the per-file limit is lowered to what passes.

Acceptance criteria
- **AC-11.1** A customer file with headers `Party Code, Party Name, E-mail` maps to `code, name, email` after the user picks the mapping once. The next upload of the same layout is auto-mapped from the saved mapping.
- **AC-11.2** An unknown godown code shows the suggested existing code in the error table and the error file.
- **AC-11.3** A role-assignment import that would grant a role with more rights than the importer holds is refused for that row. Assigning OWNER needs `users.manage_owners`.
- **AC-11.4** A stock export by a Godown-A user contains only Godown A, and without `items.view_cost` it has no value columns.
- **AC-11.5** The 10,000-item all-or-nothing import commits successfully on the local stack with `statement_timeout = 8s` for `authenticated`.
- **AC-11.6** All R2 import / export tests stay green.

### W12 — List UX

Deliverables
- **Server-side pagination, sorting and search** for Items, Customers, Vendors, Godowns, Users, Audit and Import jobs.
- Bulk selection with enable / disable and export-selected.
- Keyboard shortcuts: `/` search, `N` new, `Esc` close, `Ctrl+S` save in drawers.
- Empty / loading / error states consistent across the new screens.

Acceptance criteria
- **AC-12.1** With 10,000 items, the item list's first page loads in < 200 ms (query) and transfers ≤ 100 rows; sorting by name / code / reorder level is server-side.
- **AC-12.2** Bulk-disabling 50 selected customers is one confirmed action, scope-checked and audited per record.
- **AC-12.3** Shortcuts work in the item and customer drawers (browser e2e).

### W13 — Financial field security (D3, D7)

Rights (field level, configured in the permission matrix):

| Code | Label | Masks |
|---|---|---|
| `items.view_sale_rate` (R2) | Sale rates and sales amounts | item sale price, SALE rates / history (R2); **R3:** sales order / customer PO / sales return line rates and amounts, customer bill amounts |
| `items.view_purchase_rate` (R2) | Purchase rates and purchase amounts | item purchase price, PURCHASE rates / history (R2); **R3:** PO line rates, purchase receipt / return / service bill / job-work receipt / return rates, amounts, taxes and totals, PO print / e-mail, rate suggestions |
| `costs.view_landed_cost` | Landed cost | inward stock movement rate / value (receipts, opening, production, job-work and adjustment-in) |
| `items.view_cost` (R2, relabelled) | Average cost | outward stock movement rate / value, issue valuation (material issues, adjustments-out), item average cost |
| `costs.view_stock_valuation` | Stock valuation | stock value report, stock value in P&L / balance sheet, value totals |
| `sales.view_margin` | Gross margin | margin = sale rate − average cost on items and sales order lines |
| `reports.view_profit` | Profit and accounting reports | profit & loss, balance sheet, trial balance, account ledgers, day book, journals of non-party accounts |
| `accounts.view_amounts` | Financial amounts | payment / receipt amounts, allocations, outstanding, party balances / ledgers, reminder amounts |

Inference rules (database-enforced): payable-side amounts need `accounts.view_amounts` **and** `items.view_purchase_rate`; receivable-side
amounts need `accounts.view_amounts` **and** `items.view_sale_rate`; margin needs `sales.view_margin` + sale rate + average cost; accounting
reports and non-party journal lines need `reports.view_profit` + financial amounts + both rate rights; P&L / balance-sheet stock lines and
anything computed from them (net profit, totals) additionally need `costs.view_stock_valuation`. OWNER has every right.

Mechanism: sensitive columns get column-level `SELECT` revoked on the base tables; values are served through **sidecar joins** — invoker views
(RLS of the base table applies unchanged) left-join a definer "value" view keyed by primary key that only returns values for companies where
the caller holds the right (InitPlan, PK join — no per-row permission query). A registry `secure.sensitive_columns(table, column, class)`
drives the views, the audit masking and a **completeness test**. Definer RPCs check the same rights; invoker RPCs that read these
columns are rewritten. Backfill grants each new right to every role that can see the values today, so nobody loses access by migration.

Pre-existing gap closed here: `journal_entry_lines` is readable by every company member and `profit_loss`, `trial_balance`, `day_book`,
`account_ledger`, `party_ledger` are invoker functions without a permission check.

Acceptance criteria
- **AC-13.1** For each of the eight rights: a user holding *every* permission except that one receives NULL / no value for every column of
  its class through REST tables, views, RPCs, exports and audit diffs (systematic SQL test iterating the registry) — and a holder sees them.
- **AC-13.2** Completeness: every money-like column (rate, price, amount, value, cost, total, balance, debit, credit, outstanding …) of every
  public table and view is registered with a class or explicitly whitelisted with a reason; every public function that reads a registered
  column is in the reviewed list. A new unregistered column or function fails the test.
- **AC-13.3** No inference: payable / receivable amounts, margin, accounting reports and P&L stock lines follow the inference rules above
  (tests per rule, including PO print, rate suggestion, party ledger, bills outstanding, dashboard totals and exports).
- **AC-13.4** Behaviour preserved: every role created before R3 sees exactly the same values after migration (SQL comparison per role).
- **AC-13.5** A member without accounting / payment rights cannot read journal lines, P&L, balance sheet, trial balance, day book, account
  or party ledgers through the API (pre-existing gap).
- **AC-13.6** UI: masked values show "—" or the column is hidden; dashboard totals the user may not see are not shown; printing a PO needs
  the purchase-rate right.
- **AC-13.7** Performance: inventory, PO list, bills and movements within 20 % of R2 timings; masking adds no per-row permission query.
- **AC-13.8** OWNER sees every value.

## 4. Cross-cutting acceptance criteria (R3 exit gate)

| # | Criterion |
|---|---|
| X-1 | Every new table: RLS on, `company_id` NOT NULL, company-consistency, policies in the InitPlan form, anon nothing, write through permission-checked RPCs / policies. A completeness test covers all new tables. |
| X-2 | Every new feature has: permission check, scope check where data has a dimension, audit, direct-API negative test, direct-URL negative test, cross-company test. |
| X-3 | The original 33 critical acceptance criteria are re-run as one browser journey and pass. |
| X-4 | All existing suites are green: SQL (23 + new), API e2e (12 + new), browser e2e (30 + new), worker, container smoke, backup → restore drill (including `company-assets`), lint, typecheck, build, `npm audit --omit=dev` = 0. |
| X-5 | Performance: inventory / movements / scoped-user timings within 20 % of the R2 numbers; the new criteria AC-4.8, AC-12.1, AC-11.5 are met. |
| X-6 | Additive migrations only; no `db reset` / push to production; no secrets in the repository; production untouched (`main` = `5cff5d6`). |
| X-7 | Completion report: SHA, migrations, changed files, screens, permissions, security model, tests, performance, known limitations, "production impact = NONE". Then STOP. |

## 5. Deferred (approved under D7)

| Item | Reason |
|---|---|
| OWN_TEAM and business-unit scopes | No team or business-unit concept exists in the data model; it needs a definition (who belongs to a team, which records a team owns) before it can be enforced. Departments (W8) cover the stated example. |
| Per-company SMTP accounts | SMTP credentials are instance secrets. R3 makes sender name / reply-to / footer per company; separate SMTP accounts per company would need a secret store design. |
| Failed-login history | Supabase Auth does not expose failed attempts to the database; lockout / rate limiting stays with Supabase Auth (documented in W6). |
| Inline editing in lists | Low value and high risk of bypassing drawer validation; drawers stay the edit path. |
| Streaming / paginated exports > 50,000 rows | Not needed at current volumes; R2 exports in one response. |

## 6. Decisions (answered — see §0; the table below is kept for the record)

| # | Question | Recommendation |
|---|---|---|
| D1 | Release grouping as in §1 (R3 = remaining Phases 3–7 + Phases 8–9; R4 = Phase 10 regression / release candidate)? | Yes. |
| D2 | Approval model: up to 3 levels per document type, approver = permission or role, optional amount threshold per level; no parallel or conditional branches. Enough? | Yes; branches can be added later on the same tables. |
| D3 | What is the "purchase cost summary" that `purchase.view_cost_summary` hides? | The value / total columns on the purchase-order list, any purchase totals on the dashboard, and PO values in exports. PO line rates stay visible to users who create POs (they must enter them). |
| D4 | Does the audit viewer apply the viewer's data scopes (e.g. a Godown-A admin sees only Godown-A audit rows)? | No. `audit.view` is an owner / admin-level right; the viewer sees all company audit rows, with **field masking** (AC-4.5). Scoped audit can be added later. |
| D5 | Customer / vendor opening balance: posted as an opening journal through the existing accounting engine? | Yes, one opening journal per party, reversed and reposted on change, blocked after the period is locked. |
| D6 | Should module visibility (W1) also be enforced by the database, not only the menu? | Yes (`has_permission` returns false for a disabled module). |
| D7 | Is the deferral list in §5 acceptable? | Yes. |

## 7. Migrations (additive)

| # | Migration | Content |
|---|---|---|
| 1 | `20261010000001_r3_catalogue_modules` | new rights (customers / vendors split, documents.download / share, settings sections, audit.export, financial rights, overrides), backfill, catalogue clean-up, `company_modules` + DB enforcement in `has_permission` / `permitted_company_ids` / portal guard |
| 2 | `20261010000002_r3_financial_security` | `secure` schema, sensitive-column registry, column privileges, value views, rewritten views / RPCs, journal read tightening |
| 3 | `20261010000003_r3_settings_branding_security` | settings-section RPCs, branding, `company-assets` bucket, security policy, login overview |
| 4 | `20261010000004_r3_numbering` | tokens, resets, start-number rule, master code sequences |
| 5 | `20261010000005_r3_approvals` | rules / levels / actions, multi-level submit / approve / reject, inbox, rate-change requests |
| 6 | `20261010000006_r3_audit` | `request_meta`, scope keys, redaction, coverage triggers + registry, audit RLS, read / export RPCs with masking |
| 7 | `20261010000007_r3_scopes_departments` | departments, RECORDS scope (own / department) |
| 8 | `20261010000008_r3_masters_opening` | item / godown / party fields, rate-limit policy, godown flags, party status, delete-where-safe, opening balances |
| 9 | `20261010000009_r3_custom_fields` | entities, types, properties, restricted values |
| 10 | `20261010000010_r3_import_export` | mappings, suggestions, new entities, stock exports, commit robustness |

## 8. Process (unchanged)

Development branch only → migration review → SQL tests → API tests → browser e2e → security / RLS tests → full regression → lint →
typecheck → build → commit → report exact SHA → **STOP** → your approval. No production deployment, no merge into `main`.

## 9. Acceptance criterion → implementation → test map

SQL tests are new files under `supabase/tests/` (run by `npm run db:test`); API = `e2e/api/r3-platform.test.mjs`; UI = `e2e/ui/r3-admin.spec.ts`;
J33 = `e2e/ui/r3-acceptance.spec.ts` (the 33 original criteria as one journey).

| AC | Implementation | Tests |
|---|---|---|
| 1.1, 1.2 | `settings.<section>.view/edit` rights; section RPCs `settings_get/settings_save(section)` check them; pages under `/erp/admin/settings/*` | SQL `300_r3_catalogue_modules`; API; UI |
| 1.3, 1.7, 1.8 | `company_modules`; `app.module_enabled()` folded into `user_has_permission` (cached) and `permitted_company_ids`; module map on `permission_modules.app_module`; import / export / doc RPCs therefore refuse; portal guard checks portal modules | SQL 300 (REST, doc RPCs, import, export, portal); API; UI |
| 1.4, 1.9 | core modules flagged `is_core`, `module_set` refuses them; Modules page always reachable for OWNER | SQL 300; UI |
| 1.5, 13.4 | backfill + before / after snapshot of effective permissions and visible values | SQL 300, 310 |
| 1.6, 4.1 | audit triggers / registry on every settings table | SQL 340 |
| 2.1–2.7 | `next_doc_no` v2 (tokens, CALENDAR / MONTHLY / FY / NEVER), `sequence_save` with start-number rule, master sequences used by item / party / godown create and imports | SQL `320_r3_numbering` (incl. concurrency `325_r3_numbering_concurrency.sh`); API; UI |
| 3.1–3.10 | `approval_rules`, `approval_actions`, `app.doc_amount`, multi-level `doc_submit` / `doc_approve` / `doc_reject`, `approval_inbox`, scope + self checks, `rate_change_requests` | SQL `330_r3_approvals`; API; UI |
| 4.1–4.10 | `audit_log.request_meta`, scope-key columns, central redaction in `app.audit`, coverage registry + test, RLS (company, `audit.view`, scope keys, OWNER bypass), `audit_search` / `audit_export` with W13 masking | SQL `340_r3_audit`; API; UI |
| 5.1–5.6 | branding columns, `company-assets` bucket + policies, shells / PDF / e-mail use branding, contrast helper, new-company journey | SQL `350_r3_settings_branding_security`; API (storage); UI; worker test |
| 6.1–6.3 | `security_settings`, password policy check in change-password + `admin-users`, temp-password expiry in `has_permission` / bootstrap, `login_overview` | SQL 350; API (Edge Function); UI |
| 7.1–7.5 | `customers.*` / `vendors.*` with party RLS split, `documents.download` in storage policy, `documents.share`, catalogue `is_active` + reference test | SQL 300; API; UI |
| 8.1–8.4 | `departments`, `company_users.department_id`, RECORDS dimension in scope registry (restrictive RLS on `created_by`) | SQL `360_r3_scopes_departments`; API; UI; perf script |
| 9.1–9.8, 9.7a–e | item / godown / party columns, rate-limit trigger, godown flags in posting, party status guard, `delete_if_unused`, `opening_balance_post` / `opening_balance_reverse`, orphan-image worker job | SQL `370_r3_masters_opening`; worker test; API; UI |
| 10.1–10.6 | definitions v2, `custom` on new entities, restricted values table + masked access | SQL `380_r3_custom_fields`; API; UI |
| 11.1–11.6 | `import_templates`, mapping in `import_create`, `pg_trgm` suggestions, new entities, `export_rows` stock entities, commit with function-level timeout | SQL `390_r3_import_export`; API (10k with 8 s timeout); UI |
| 12.1–12.3 | `list_*` RPCs / range queries with server-side sort, bulk RPCs | API (timing); UI |
| 13.1–13.8 | `secure` schema, registry, column privileges, value views, rewritten views / RPCs, inference rules, journal read tightening | SQL `310_r3_financial_security` (registry-driven per-right test + completeness); API; UI |
| X-1–X-7 | completeness tests for new tables, full regression, fresh-instance migration + backup / restore drill, security review | all suites; `drill-local.sh`; review notes in `PLATFORM_R3.md` |
