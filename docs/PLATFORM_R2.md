# Platform R2 — Master data, data scopes, field security, portal permissions, Import / Export

Branch `claude/charming-gauss-o9fvzf`. **Not deployed.** Production (`5cff5d6`)
is unchanged; R1 (`a1a4c5c`) is not merged. Plan: [`PLATFORM_ARCHITECTURE_PLAN.md`](./PLATFORM_ARCHITECTURE_PLAN.md),
previous release: [`PLATFORM_R1.md`](./PLATFORM_R1.md).

Everything below is configured in the UI and stored as data. Nothing is
hard-coded per customer, user or role.

## What R2 adds

| Area | Delivered |
|---|---|
| Item master (`/erp/admin/items`) | Code, name, description, category, brand, base / purchase / sales unit, packings, barcode, HSN, **SKU** (unique per company), GST, min / max / reorder level, active, portal visibility, notes, purchase and sale rate, **customer- and vendor-specific rates**, **rate history** (append-only, written by triggers: item master changes and rate-list changes), **images** (several per item, primary, replace, delete, preview), **custom fields**. The old `/erp/items` route shows the same screen. |
| Custom fields (`/erp/admin/custom-fields`) | Text, number, date, yes/no or dropdown fields for items, customers and vendors. They can be required, ordered and disabled. They are validated by the database (`app.validate_custom`), appear in the forms, and appear as `cf_<key>` columns in import templates and exports. |
| Customers / vendors (`/erp/admin/customers`, `/erp/admin/vendors`) | Create, edit, disable. Contact person, phones, email, GSTIN / PAN, billing address, **shipping addresses**, credit days / **credit limit** / payment terms, vendor type (supplier, job worker, cutter), custom fields. Specific rates. **Portal & visibility**: stock, rate, outstanding and payment visibility per party. **Customer / vendor users**: create a login (temporary password), invite by email, reset, disable / enable, and the **portal role** of each login. |
| Data scopes | Four dimensions: **GODOWN** (R1), **CUSTOMER**, **VENDOR** and **ITEM**. Each can be set per user or per role to **All**, **Selected records** (one or many) or **No access** (sentinel `app.scope_none()`). The user setting overrides the roles; roles combine as a union, and one unrestricted role means all. Scopes are enforced by restrictive RLS on every table that has the dimension (registry `app.data_scope_registry`, completeness tested) and by write triggers on headers and document lines. The party master follows the rule "customer in CUSTOMER scope OR vendor in VENDOR scope OR neither". |
| Field-level security | Field permissions `items.view_sale_rate`, `items.view_purchase_rate`, `items.view_cost` and `items.edit_rate`, configured in the permission matrix. The price columns of `items` are not granted to `authenticated` (column privileges). Prices are read through the masked view `v_items`. Customer / vendor rate rows are filtered per `rate_type` by restrictive policies. Stock movement `rate` / `value` need `items.view_cost`, and so do valuation and P&L / balance-sheet stock values. Rate changes need `items.edit_rate` (trigger). **OWNER** always has every field. |
| Item images | Private bucket `item-images` (JPEG / PNG / WebP / GIF, ≤ 5 MB). The path `<company>/<item>/<file>` is checked by `item_image_register`. Storage policies require `items.view` plus ITEM scope to read and `items.upload_image` to write, and are company-isolated. The UI uses signed URLs (5 minutes). Upload, replace, delete and set-primary are audited. |
| Portal permissions | Portal roles (`CUSTOMER_PORTAL` / `VENDOR_PORTAL` kinds) with portal features: catalogue, view stock, view rates, create PO, POs, orders, invoices, payments, outstanding, documents, upload documents (customer); POs, payments, documents (vendor). Defaults: Customer admin / Customer user / Vendor admin / Vendor user. Each portal login has one role (per party, set in the UI). Every portal RPC checks its feature (`app.portal_party(company, kind, feature)`). The portal UI hides tabs whose feature is off. Rates and stock are masked unless the role **and** the company / customer visibility setting allow them. |
| Import / Export Center (`/erp/admin/import-export`) | Ten entities: items, item rates, customers, vendors, godowns, locations, opening stock, users (invitations, no passwords), customer rates, vendor rates. XLSX templates have a **Data** sheet (headers with `*` for required, colour-marked, example row) and an **Instructions** sheet (label, required, type, allowed values, notes). Files can be XLSX or CSV. Every import goes through validation → preview → explicit confirmation → commit. **All-or-nothing** is the default; "Import valid rows only" must be chosen explicitly. "Update existing records" is opt-in. Errors give the spreadsheet row, column, current value and reason, and can be downloaded as an error report (.xlsx). Exports (XLSX / CSV) contain only rows and fields the user can see, and are logged. |
| Menu / admin center | New entries: Customers, Vendors, Import / Export, Custom fields. Each is shown only with its permission, and a direct URL without the permission shows "no access" (the database refuses the data anyway). |
| Users / Roles screens | The **Data access** tab (user and role) covers all four dimensions with All / Selected / No access. The Roles screen has tabs for **Staff**, **Customer portal** and **Vendor portal** roles; the matrix shows only the permissions that fit the role kind. The user drawer has a **Portal role** tab for customer / vendor logins. |
| Backup / restore | Backup and restore now include the `item-images` bucket (with content types). The migration-owned tables `app.import_entities` and `app.data_scope_registry` are excluded from data dumps. The drill compares item images, rate history, import jobs and custom fields as well. |

## New permissions

| Code | Kind | Default (backfilled from) |
|---|---|---|
| `items.view_sale_rate`, `items.view_purchase_rate`, `items.view_cost` | field | roles with `items.view` |
| `items.edit_rate`, `items.upload_image` | field / action | roles with `items.edit` |
| `items.import`, `parties.import`, `godowns.import`, `rates.import`, `stock_adjustment.import`, `users.import` | import | roles with the matching `*.create` |
| `users.export` | export | roles with `users.view` |
| `portal_customer.catalog`, `.view_stock`, `.view_rates`, `.create_po`, `.view_pos`, `.view_orders`, `.view_invoices`, `.view_payments`, `.view_outstanding`, `.view_documents`, `.upload_documents` | portal | Customer admin: all; Customer user: catalogue, POs, orders, documents |
| `portal_vendor.view_pos`, `.view_payments`, `.view_documents` | portal | Vendor admin: all; Vendor user: POs, documents |

`items.export`, `parties.export`, `godowns.export` and `rates.export` already existed. The backfill preserves what existing roles could do before R2. Every existing portal login gets the *admin* portal role, so its behaviour does not change.

## Import / Export architecture

```
Browser (XLSX/CSV parsed locally: read-excel-file)          Database (all rules)
  1. import_create(company, entity, file, mode, update, headers) ─► import_jobs; header errors (row 0); entity permission + company
  2. import_add_rows(job, ≤2000 rows/call, ≤10,000 rows/file)    ─► import_rows (raw text, spreadsheet row numbers)
  3. import_validate(job)                                         ─► per row app.import_check: types, required, enums, min,
                                                                     references (units, categories, godowns, parties, roles …),
                                                                     existing records, scope (godown / customer / vendor / item),
                                                                     field rights (rates); set-based duplicate detection;
                                                                     import_errors(row, column, value, reason); counts
  4. preview + error table + error report (.xlsx)                 ◄─ import_jobs / import_errors (own jobs only, RLS)
  5. import_commit(job, confirm = true)                           ─► needs VALIDATED (< 15 min), no header errors, explicit
                                                                     confirmation; re-checks the import / create / update rights;
                                                                     ALL_OR_NOTHING: one sub-transaction, any failure → FAILED,
                                                                     nothing written; VALID_ONLY: one sub-transaction per row,
                                                                     invalid / failing rows skipped; audit entry
Export: export_rows(company, entity)  (SECURITY INVOKER: the user's RLS, scopes and masked views) → app.log_export → XLSX/CSV
```

- The registry `app.import_entities` holds, per entity, the label, help text, import / export permission, scope dimension, key columns, whether updates are allowed, and the column definitions (key, label, type, required, allowed values, example). `app.import_columns` adds the company's custom fields. The template, the column check, the UI and the export all read this registry. Adding an entity means adding a registry row plus `import_check` / `import_apply` branches; no UI change is needed.
- Writes go through the same tables, triggers and RLS as manual entry: scope guards, rate guard, rate history, custom-field validation, stock posting engine for opening stock. **An import cannot do anything the user could not do by hand.**
- Existing records are never changed unless "Update existing records" is chosen, and some keys (for example an item's base unit) are never changed by an import.
- XLSX library: **read-excel-file 9.3.10 + write-excel-file 4.1.1** (MIT, small, 0 known vulnerabilities, `npm audit --omit=dev` clean). Rejected: **exceljs** (open audit findings through its dependencies, ~53 MB installed, maintenance stalled) and the npm **xlsx** 0.18.5 package (no npm releases since 2022, known prototype-pollution / ReDoS advisories). Newer patch versions (9.3.11 / 9.3.12) were less than two weeks old when R2 was built, so they were not adopted.

## Security model (summary)

| Layer | Enforcement |
|---|---|
| Company isolation | All new tables have `company_id` + RLS `company_id = any((select app.permitted_company_ids('<perm>'))::uuid[])`. Storage paths start with the company id and are checked in the policies. Cross-company access is tested for API, storage, import, export and portal. |
| Permissions | RPCs: `app.require_permission`. Tables: RLS. Imports re-check the rights at commit time. The UI hides what is not allowed, but nothing depends on that. |
| Scopes | Restrictive RLS (InitPlan form) plus write triggers on headers and lines, registry-driven, with a completeness test that fails if a table with a scoped column is not registered. |
| Fields | Column privileges, a masked definer view with explicit company / scope filters, restrictive per-`rate_type` policies, a rate-edit trigger, and definer valuation functions that check `items.view_cost`. |
| Exports | SECURITY INVOKER: an export is the same query as the screen, under the same RLS and masks. A user cannot export data they cannot view. |
| Portal | Feature check in every portal RPC. Data is limited to the login's own party. The role and the visibility settings must both allow rates / stock. |
| Audit | Items, rates (history table), images, parties, custom fields, roles / scopes, portal roles, import commits, and exports (`export_log`). |
| Secrets | No new secrets. Passwords are never stored, imported or logged (user import creates invitations). |

## Performance

Measured against the release-audit dataset (2,004 items, 10,001 stock movements) on the local stack. Policies use the R1 InitPlan pattern: permission and scope lookups run once per query, not once per row. A transaction-scoped authorization cache (`app.authz_cache`, cleared by statement triggers whenever roles, overrides, scopes or memberships change) removes repeated permission lookups during bulk writes.

| Query | Before R1 | R1 | R2 owner | R2 operator | R2 scoped user (godown + item + customer "no access") |
|---|---|---|---|---|---|
| Inventory list (`v_inventory_items`, now built on `v_items`) | 86 ms | 28 ms | 30 ms | 28 ms | 5–6 ms |
| Inventory by location | 116 ms | 53 ms | 36 ms | — | 5–6 ms |
| Stock movements | 49 ms | 3 ms | 5 ms | 6 ms | 5–6 ms |

| Import (10,000 item rows) | Result |
|---|---|
| Validation (types, references, duplicates, scope) | ~3.8 s |
| Commit, all-or-nothing | ~6.4–7.2 s |
| Row write with the authz cache vs. without it | 0.38 ms vs. 1.35 ms per row |

During R2 development, the first version of the inventory view took 2.1 s (a nested loop over an aggregated CTE). It was rewritten to per-item LATERAL lookups and now runs in 30 ms. The first version of import validation took 18 s for 10k rows (an O(n²) duplicate map plus per-row permission queries). It now uses set-based duplicate detection and the authz cache.

## Tests

| Suite | Result |
|---|---|
| SQL (`npm run db:test`) | **23 / 23** files pass. New: `220_r2_items_fields` (45 assertions), `230_r2_scopes` (39), `240_r2_import_export` (45), `250_r2_portal_permissions` (25). |
| API e2e (real PostgREST / Storage / Auth / Edge Function) | **12 / 12**. New `e2e/api/r2-master-data.test.mjs` covers: field security + rate guard + rate history; images (private bucket, permission, item scope, other company, anonymous, not public, delete); import preview / all-or-nothing / valid-only / duplicates / confirmation; unauthorized import and export; scoped and masked export; cross-company import / export / commit; customer / vendor / item scopes by direct REST and RPC calls; portal permissions per customer. |
| Browser e2e (Playwright, static build) | **30 / 30**. New `e2e/ui/r2-master-data.spec.ts` covers: item create / edit / rate / rate history / image upload, preview, replace, delete; customer + address + login + portal role; vendor; template download (real .xlsx, two sheets); invalid .xlsx file with all-or-nothing refused, error report download, valid-only import; all-or-nothing rollback on a write failure; Excel export content; limited user (item scope, hidden rates, no export, direct URLs refused); role scope "No access"; portal role tabs; portal features per customer. |
| Worker | 4 / 4 |
| Container smoke (`worker-container-smoke.sh`) | OK |
| Backup → wipe → restore drill | OK (data, documents, item images, rate history, import jobs, custom fields identical) |
| Lint / typecheck / build | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Known limitations

- **Import size:** at most 10,000 rows per file. A 10k-row commit takes about 7 s, which is close to Supabase's default 8 s statement timeout for `authenticated`. Use ≤ 5,000 rows per file in production, or raise the timeout for that role.
- **Preview expiry:** a preview is valid for 15 minutes; after that the file must be validated again before committing.
- **Export size:** an export is returned as one response. Very large exports (tens of thousands of rows) can take several seconds; there is no streaming or pagination yet.
- **Custom fields:** the key, entity and type cannot be changed after creation, because stored values depend on them. Disable the field and create a new one instead.
- **Orphaned image files:** if the browser closes between uploading a file and registering it, the file stays in storage without a row. It is still protected by the storage policies. There is no automatic clean-up job yet.
- **Portal visibility needs two switches:** a portal role can only *narrow* visibility. Rates / stock are shown only when the role allows them **and** the company / customer visibility setting shows them.
- **Old parties screen:** `/erp/parties` (customers and vendors on one screen) remains available next to the new Customers / Vendors pages.
- **Large scope pickers:** the record picker in a scope editor shows up to 300 matches at a time; use its search box when there are many records.
- **R3 features are not built:** document workflows, approvals redesign and reports from the architecture plan were not started.

## Production impact

**NONE.** No production database, Edge Function, secret, Cloudflare or `main` branch change. Six additive migrations (`20261009000001`–`000006`) wait on the branch together with R1's five.
