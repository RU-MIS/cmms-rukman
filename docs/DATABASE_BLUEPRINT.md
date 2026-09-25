# Database Blueprint — PostgreSQL (Supabase)

> Phase 2 deliverable. Status: **DRAFT — awaiting answers to the 🔴 questions
> in [`ERP_DISCOVERY.md` §9](./ERP_DISCOVERY.md#9-questions_requiring_user_confirmation).**
> Table names, columns and constraints below are the proposed design; the
> SQL migrations will be generated from this document only after review.

---

## 1. Design principles

| # | Principle | How it is applied |
|---|---|---|
| P1 | **Movements are the truth, balances are derived** | `stock_movements` and `journal_entry_lines` are append-only. Stock, pending qty, ledger and outstanding are views/functions. |
| P2 | **Documents never lose history** | Posted documents are never updated in place: they are `CANCELLED` (with an automatic reversal) or corrected by a new document. |
| P3 | **Every posting is one DB transaction** | Each business event is posted by a single PL/pgSQL function (`fn_*_post`) — all rows or none. |
| P4 | **Company-ready, single-company deployable** | Every business header table has `company_id`. Deployment model A = exactly one company row. Model B = many, isolated by RLS. |
| P5 | **Base-unit quantities** | Every line stores what the user typed (`qty`, `unit_id`) **and** `base_qty` using the item's conversion snapshot. |
| P6 | **No names as keys** | Items, parties, godowns get UUID ids + a unique `code`; the sheet names are kept in `legacy_name` for migration traceability. |
| P7 | **Authorization in the DB** | RLS on every table + `SECURITY DEFINER` posting functions that check `has_permission()` themselves. |
| P8 | **Money** is `numeric(16,2)`, **quantity** is `numeric(16,3)`, **rate** is `numeric(14,4)`. No floats. |

### 1.1 Common columns

Applied to every **header / master** table (marked ⓒ below):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `company_id` | `uuid` NOT NULL FK → `companies.id` | RLS key |
| `created_at` / `created_by` | `timestamptz` / `uuid` FK → `auth.users` | set by trigger |
| `updated_at` / `updated_by` | `timestamptz` / `uuid` | set by trigger |
| `is_deleted` | `boolean` default false | soft delete for masters only |

Transaction headers additionally carry (ⓣ):

| Column | Type | Notes |
|---|---|---|
| `doc_no` | `text` NOT NULL | from `fn_next_doc_no()` |
| `doc_date` | `date` NOT NULL | |
| `status` | `doc_status` enum | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `POSTED`, `CANCELLED` (+ order-specific states) |
| `approved_at/by`, `posted_at/by`, `cancelled_at/by`, `cancel_reason` | | audit trail (spec §33) |
| `legacy_ref` | `text` | original sheet number/row for reconciliation |
| `remarks` | `text` | |

Pure child tables (lines) do **not** carry `company_id`; ownership follows
the header FK and RLS joins through it (spec §6). Exception: `stock_movements`
and `journal_entry_lines` carry `company_id` because they are queried directly
in heavy reports.

---

## 2. Entity overview

```
                ┌──────────── MASTERS ─────────────┐
 companies ─┬─ branches        items ─ item_packings
            ├─ godowns          │    └ item_consumption_rules (cartons)
            ├─ parties ─ party_roles / party_contacts / party_addresses
            │            └ party_item_rates
            ├─ accounts (chart of accounts, cash & bank are accounts)
            └─ document_sequences, app_settings

 ┌──────── JOB WORK ────────┐  ┌──── PURCHASE ────┐  ┌───── SALES ─────┐
 job_work_orders             purchase_orders?       sales_orders
   └ job_work_order_lines      └ lines                └ sales_order_lines
 job_work_receipts ──────┐   purchase_receipts        dispatches
   └ lines (→ order_line)│     └ lines                  └ lines (→ order_line)
 material_issues         │   purchase_returns         sales_invoices
   └ lines               │     └ lines                  └ lines
 job_work_returns        │                            customer_credit_notes
   └ lines               │
 production_lots (factory, pending Q-08)
                         ▼
             stock_movements  ◄── stock_transfers / stock_adjustments
                         
 vouchers (receipt / payment / contra / journal)
   ├ voucher_lines
   └ voucher_allocations (→ invoices / bills)
                         ▼
             journal_entries ─ journal_entry_lines  (every financial posting)

 PLATFORM: profiles, roles, permissions, role_permissions, user_roles,
           audit_log, documents, email_log, attachments
```

---

## 3. Platform tables

### 3.1 `companies`
| | |
|---|---|
| Purpose | Legal entity. Model A has exactly one row. |
| PK | `id uuid` |
| Important fields | `code` (unique), `legal_name`, `trade_name` (e.g. GAGATOSE), `gstin`, `pan`, `address_*`, `state_code`, `phone`, `email`, `logo_path`, `fy_start_month` (default 4), `base_currency` (INR), `settings jsonb` |
| Indexes | unique(`code`), unique(`gstin`) where not null |
| RLS | readable by members of the company; writable by `company.admin` |

### 3.2 `branches`
Optional physical sites. `id`, `company_id`, `code`, `name`, `address`. Unique(`company_id`,`code`).

### 3.3 `profiles`
| | |
|---|---|
| Purpose | App-side user record linked 1:1 to `auth.users` (Supabase Auth). |
| PK / FK | `id uuid` = `auth.users.id` |
| Fields | `full_name`, `phone`, `default_company_id`, `is_active`, `last_login_at` |

### 3.4 `roles`, `permissions`, `role_permissions`, `user_roles`
| Table | PK | Important fields | Notes |
|---|---|---|---|
| `permissions` | `code text` (e.g. `job_work_receipt.create`) | `module`, `action` ∈ VIEW, CREATE, EDIT, DELETE, APPROVE, CANCEL, EXPORT | **System seed.** |
| `roles` ⓒ | `id` | `code`, `name`, `is_system` | System roles seeded per company: ADMIN, ACCOUNTANT, STORE, PURCHASE, SALES, APPROVER, VIEWER. |
| `role_permissions` | (`role_id`,`permission_code`) | | |
| `user_roles` | (`user_id`,`company_id`,`role_id`) | | A user can belong to several companies (model B). |

Helper functions: `auth_company_ids()` → set of company ids of the current
user; `has_permission(company_id, perm_code) → boolean`.

### 3.5 `document_sequences`
| | |
|---|---|
| Purpose | Concurrency-safe numbering (spec §44). |
| PK | (`company_id`, `doc_type`, `fy_code`) |
| Fields | `prefix` (e.g. `GT-`, `GS-`, `DNGT - `, `T/{FY}/`), `padding`, `next_value bigint`, `reset_policy` (NEVER / FY) |
| Function | `fn_next_doc_no(company, doc_type, doc_date)` does `UPDATE … SET next_value = next_value + 1 … RETURNING` — row lock guarantees no duplicates under concurrent users. Called **inside** the posting function, never from the browser. |

### 3.6 `app_settings`
Key/value per company for non-secret, business-configurable settings
(document footer, terms, default godown, negative-stock policy, over-receipt
tolerance). Instance-level branding stays in env/config (see
`INSTANCE_ARCHITECTURE.md`).

### 3.7 `audit_log`
| | |
|---|---|
| Purpose | Row-level change history of masters and documents (spec §33). |
| Fields | `id bigserial`, `company_id`, `table_name`, `row_id`, `action` (INSERT/UPDATE/DELETE/POST/CANCEL/APPROVE), `old_data jsonb`, `new_data jsonb`, `actor_id`, `at timestamptz`, `request_id` |
| Written by | generic trigger `trg_audit()` on audited tables + explicit calls in posting functions |
| Indexes | (`company_id`,`table_name`,`row_id`), (`company_id`,`at` desc) |
| RLS | insert only via trigger; select for `audit.view`; **no update/delete for anyone** |

### 3.8 `documents`, `email_log`, `attachments`
| Table | Purpose | Key fields |
|---|---|---|
| `documents` | Generated PDFs | `company_id`, `source_table`, `source_id`, `template_code`, `storage_path`, `version`, `generated_by/at` |
| `email_log` | Spec §25 | `document_id`, `recipient`, `cc`, `subject`, `sent_at`, `status` (QUEUED/SENT/FAILED), `error_message`, `provider_message_id` |
| `attachments` | Uploaded files (bills, photos) | `company_id`, `source_table`, `source_id`, `storage_path`, `mime`, `size` |

Storage paths always begin with `{company_id}/…` so storage RLS can be
enforced per company.

---

## 4. Master tables

### 4.1 `parties` ⓒ
| | |
|---|---|
| Purpose | **One record per real person/firm**, whatever roles it plays (spec §10). Replaces the name lists in `PURCHASE PO!K`, `SALE INVOICE!Z`, `PURCHASE LEDGER ENTRY!AV`. |
| PK | `id` |
| FK | `company_id`; `receivable_account_id`, `payable_account_id` → `accounts` (see Q-13) |
| Important fields | `code` (unique per company), `name`, `legacy_names text[]` (all spellings found in sheets), `gstin`, `pan`, `mobile`, `email`, `area` (e.g. MADIPUR, KARDAMPURI, PATIALA), `credit_days`, `is_active` |
| Indexes | unique(`company_id`,`code`); unique(`company_id`, lower(`name`)); GIN trigram on `name` for search |

### 4.2 `party_roles`
(`party_id`, `role`) with `role` ∈ `CUSTOMER`, `SUPPLIER`, `JOB_WORKER`,
`CUTTER`, `TRANSPORTER`, `FACTORY`. A karigar who buys RM and sells FG is
**one party with role JOB_WORKER** (no duplicate master — spec §10).

### 4.3 `party_addresses` / `party_contacts`
Addresses (billing / shipping). **D-Mart DC locations** are
`party_addresses` of type `SHIP_TO` under the D-Mart party (pending Q-20),
fields: `code` (BHIWANDI, PUNE…), `address`, `state_code`, `gstin`.

### 4.4 `units`
`id`, `code` (PAIR, BOX, PCS, MTR, NOS, PKT, ROLL, DOLLY, CONE, BOTTLE, KGS,
LTR), `name`, `decimals`. **System seed** (global, no company_id; companies
may add their own with `company_id` set).

### 4.5 `item_categories`, `brands`
Simple masters (`code`, `name`, `parent_id` for categories). RM "item type"
(RM / REXINE / OTHER / TAX) maps to `item_categories`.

### 4.6 `items` ⓒ
| | |
|---|---|
| Purpose | FG and RM items (21 FG + 309 RM today). |
| PK | `id` |
| FK | `company_id`, `category_id`, `brand_id`, `base_unit_id` → `units` |
| Important fields | `code` (unique), `name`, `legacy_names text[]`, `item_kind` ∈ FINISHED_GOOD, RAW_MATERIAL, PACKING, SERVICE, `hsn_code`, `gst_rate`, `is_stock_tracked` (false for `TAX` pseudo-item / services), `min_stock`, `is_active` |
| Indexes | unique(`company_id`,`code`); unique(`company_id`, lower(`name`)); (`company_id`,`item_kind`) |

### 4.7 `item_packings` (item-specific conversion — spec §11)
| | |
|---|---|
| Purpose | `1 BOX = 18 PAIR` for `PVC BLACK-406`, `= 36 PAIR` for `SAMOSA-5012`, … |
| PK | `id` |
| FK | `item_id`, `unit_id` (packing unit) |
| Fields | `factor_to_base numeric(16,6)` > 0, `is_default boolean`, `effective_from date` |
| Constraints | unique(`item_id`,`unit_id`,`effective_from`); one default per item |
| Use | Lines store `qty`, `unit_id`, `factor_to_base` (snapshot) and `base_qty = qty × factor`. Changing a factor later does **not** change history. |

### 4.8 `item_consumption_rules` (cartons, barcodes — pending Q-19 / Q-27)
| | |
|---|---|
| Purpose | Auto-consumption when FG is received, e.g. `CHADDI BOTTOM-4841` → 1 × `CB-4841` per BOX. |
| FK | `fg_item_id`, `consumed_item_id` → `items`; `per_unit_id` → `units` |
| Fields | `qty_per_unit`, `applies_to_godown_id` (nullable = all), `applies_to_receipt_type` (JOB_WORK / FACTORY / ANY), `effective_from` (2026-06-15), `effective_to` |

### 4.9 `godowns` ⓒ
| | |
|---|---|
| Purpose | Every stock location (spec §13). |
| Fields | `code` (B-336, WAREHOUSE, MANGOLPURI, OFFICE, RAW-MATERIAL, VINOD-DOODH, CB, GAGATOSE…), `name`, `godown_type` ∈ OWN_STORE, FACTORY, **PARTY_LOCATION** (material lying with a cutter/job worker), `party_id` (for PARTY_LOCATION), `allow_negative boolean` default false, `is_active` |
| Indexes | unique(`company_id`,`code`) |

### 4.10 `party_item_rates`
| | |
|---|---|
| Purpose | Rate lists: RM issue rate per karigar (DK/NAYAB/…), JW rate per pair per karigar+item, purchase rate per supplier. Replaces "last rate" lookups. |
| FK | `party_id` (nullable = default "OTHER" rate), `item_id` |
| Fields | `rate_type` ∈ ISSUE, JOB_WORK, PURCHASE, SALE; `rate`, `per_unit_id`, `effective_from`, `effective_to` |
| Index | (`company_id`,`rate_type`,`item_id`,`party_id`,`effective_from` desc) |

### 4.11 `accounts` ⓒ — Chart of Accounts (cash & bank are accounts, spec §27)
| | |
|---|---|
| PK | `id` |
| FK | `parent_id` (tree), `company_id` |
| Fields | `code`, `name`, `account_type` ∈ ASSET, LIABILITY, EQUITY, INCOME, EXPENSE; `sub_type` ∈ CASH, BANK, RECEIVABLE_CONTROL, PAYABLE_CONTROL, STOCK, TAX, CAPITAL, DRAWINGS, LOAN, …; `is_group`; `is_system` |
| Bank details | `bank_name`, `account_no_masked`, `ifsc`, `is_personal` (Q-25) |
| Indexes | unique(`company_id`,`code`); (`company_id`,`sub_type`) |

Seeded **system** accounts per company (codes stable, names editable): Cash,
Sundry Debtors (control), Sundry Creditors (control), Job-Work Charges,
Purchase – Raw Material, Sales – Finished Goods, Material Issued to Job
Workers (Q-11), Input GST (CGST/SGST/IGST), Output GST, TDS Receivable,
Bank Charges, Rate Difference / Short Receipt (Q-23), Capital, Drawings,
Opening Balance Adjustment, Round Off. The complete list waits for Q-32.

**Party sub-ledgers:** every `journal_entry_line` that hits a control account
also carries `party_id`, so customer/vendor ledgers are simply
`journal_entry_lines WHERE party_id = …` (spec §29 — ledger derived, never
edited).

---

## 5. Inventory tables

### 5.1 `stock_movements` (the stock ledger — spec §12)
| | |
|---|---|
| Purpose | One row per item per godown per effect. **Only** written by posting functions. |
| PK | `id bigserial` |
| FK | `company_id`, `item_id`, `godown_id`, `unit_id`, `created_by` |
| Fields | `movement_date date`, `movement_type` enum (below), `direction smallint` (+1 IN / −1 OUT), `qty`, `factor_to_base`, `base_qty numeric(16,3) CHECK (base_qty > 0)`, `signed_base_qty` (generated = direction × base_qty), `rate`, `value`, `source_table text`, `source_id uuid`, `source_line_id uuid`, `doc_no`, `party_id`, `reversal_of bigint` (FK self), `created_at` |
| `movement_type` | `OPENING`, `PURCHASE_RECEIPT`, `PURCHASE_RETURN`, `SALE_ISSUE` (dispatch), `SALE_RETURN`, `JOB_WORK_ISSUE` (RM to karigar), `JOB_WORK_RECEIPT` (FG from karigar), `JOB_WORK_RETURN` (debit note, FG back to karigar), `PRODUCTION_RECEIPT` (own factory), `CONSUMPTION` (cartons), `STOCK_TRANSFER_OUT`, `STOCK_TRANSFER_IN`, `STOCK_ADJUSTMENT_IN`, `STOCK_ADJUSTMENT_OUT` |
| Indexes | (`company_id`,`item_id`,`godown_id`,`movement_date`); (`company_id`,`movement_date`); (`source_table`,`source_id`); partial index on `reversal_of` |
| Constraints | no UPDATE / DELETE (RLS + trigger `trg_block_mutation`); cancellation inserts reversal rows |

### 5.2 `stock_balances` (performance cache, optional)
(`company_id`,`item_id`,`godown_id`) PK, `base_qty`, `last_movement_id`.
Maintained by trigger on `stock_movements` insert **inside the same
transaction**; used for fast "available stock" and negative-stock checks
(`SELECT … FOR UPDATE`). It is a cache — `v_stock_balance` recomputed from
movements must always equal it (nightly check + `db:test`).

### 5.3 `stock_transfers` ⓒⓣ + `stock_transfer_lines`
Header: `from_godown_id`, `to_godown_id` (CHECK different). Lines: `item_id`,
`qty`, `unit_id`, `factor_to_base`, `base_qty`. Posting creates paired
`STOCK_TRANSFER_OUT` / `STOCK_TRANSFER_IN` movements. Source: `STOCK SHIFTING`.

### 5.4 `stock_adjustments` ⓒⓣ + lines
`godown_id`, `reason` (PHYSICAL_COUNT, DAMAGE, OPENING_CORRECTION); lines
with `direction`. Requires APPROVE permission. Used to fix DQ-01.

---

## 6. Job-work & factory tables

### 6.1 `job_work_orders` ⓒⓣ
| | |
|---|---|
| Purpose | Karigar PO `GT-NNN` (sheet `PURCHASE PO ENTRY`). |
| FK | `party_id` (role JOB_WORKER), `default_godown_id` |
| Fields | `lot_no` (spec §18), `expected_date`, `status` ∈ DRAFT, OPEN, PARTIALLY_RECEIVED, FULLY_RECEIVED, SHORT_CLOSED (Q-05), CANCELLED |
| Indexes | unique(`company_id`,`doc_no`); (`company_id`,`party_id`,`status`) |

### 6.2 `job_work_order_lines`
| | |
|---|---|
| FK | `order_id`, `item_id` (FG), `unit_id` |
| Fields | `line_no`, `qty`, `factor_to_base`, `ordered_base_qty`, `rate` (nullable, Q-07), `short_closed_base_qty` default 0 |
| Constraints | unique(`order_id`,`item_id`) (BR-10); `ordered_base_qty > 0` |
| **Not stored** | received / pending — derived (spec §16, BR-12) |

### 6.3 `job_work_receipts` ⓒⓣ + `job_work_receipt_lines`
| | |
|---|---|
| Purpose | FG received from karigar (sheet `PURCHASE REC ENTRY`). |
| Header FK | `party_id`, `godown_id` (To Godown) |
| Line FK | `receipt_id`, `order_line_id` → `job_work_order_lines` (NOT NULL, BR-18), `item_id`, `unit_id` |
| Line fields | `qty`, `factor_to_base`, `base_qty`, `rate` (per base unit — per pair), `amount` |
| Indexes | (`order_line_id`) — drives the pending calculation |
| Rule | Posting function locks the order line (`SELECT … FOR UPDATE`) and rejects `base_qty > pending` (spec §21, Q-04). |

### 6.4 `material_issues` ⓒⓣ + `material_issue_lines`
| | |
|---|---|
| Purpose | RM issued/sold to karigar, bill `GS-NNN` (sheet `SALE INV DATA`, `BEFORE CONFIRMATION`). |
| Header FK | `party_id`, `godown_id` (from), `job_work_order_id` (optional link, see Q-10/Q-11) |
| Header fields | `status` flow DRAFT → PENDING_APPROVAL → APPROVED/POSTED (Q-10), `change_note` (sheet `CHANGES`) |
| Line fields | `item_id`, `qty`, `unit_id`, `base_qty`, `rate`, `amount`, `gst_rate` (Q-11) |

### 6.5 `job_work_returns` ⓒⓣ + lines
Debit note to karigar, `DNGT - NNN` (sheet `DEBIT NOTE ENTRY`). Header:
`party_id`, `godown_id`, optional `order_id`. Lines: `item_id`, `qty`,
`base_qty`, `rate`, `amount`. Whether a return **re-opens** pending qty on
the PO is part of Q-05 (default: no).

### 6.6 `production_lots` / `production_receipts` (own factory — pending Q-08)
Placeholder until the FACTORY workbook is analysed: `lot_no` (GT19…),
`item_id`, `planned_base_qty`, `status` (PENDING / LOT_ORDER_COMPLETED);
receipts reference the lot and post `PRODUCTION_RECEIPT` movements.

---

## 7. Purchase tables (RM)

| Table | Purpose | Key fields |
|---|---|---|
| `purchase_orders` ⓒⓣ + lines | Optional RM PO (spec §15 flow A; unused in sheets, Q-16) | `party_id`; lines `item_id`, `qty`, `base_qty`, `rate`; status OPEN / PARTIALLY_RECEIVED / FULLY_RECEIVED / CLOSED |
| `purchase_receipts` ⓒⓣ + lines | RM purchase receipt (`PURCHASE REC DATA`); **PO optional** | header `party_id`, `godown_id`, `supplier_bill_no`, `supplier_bill_date`; lines `po_line_id` (nullable), `item_id`, `qty`, `unit_id`, `base_qty`, `rate`, `taxable_amount`, `gst_rate`, `gst_amount`, `amount` |
| `purchase_returns` ⓒⓣ + lines | Return to supplier (Q-17) | mirror of receipt |

Pending PO qty for RM (if POs are used) is derived exactly like job work.

---

## 8. Sales tables (D-Mart)

| Table | Purpose | Key fields |
|---|---|---|
| `sales_orders` ⓒⓣ | D-Mart PO (`SALE PO`) | `party_id` (D-Mart), `ship_to_address_id` (DC), `customer_po_no` (10-digit), `po_date`, `delivery_date`, status OPEN / PARTIALLY_DISPATCHED / DISPATCHED / DELIVERED / CANCELLED; `revision_no` (Q-22) |
| `sales_order_lines` | PO line | `item_id`, `qty`, `unit_id`, `base_qty`, `rate` (nullable), unique(`order_id`,`item_id`) |
| `dispatches` ⓒⓣ + `dispatch_lines` | Goods leaving a godown for a DC | header `godown_id`, `sales_order_id`, `dispatch_date`, `delivered_date`, `vehicle_no`, `transporter_party_id`; lines `order_line_id`, `item_id`, `base_qty` (≤ pending, Q-21) |
| `sales_invoices` ⓒⓣ + lines | Tax invoice `T/26-27/NNN` (Q-03) | `party_id`, `ship_to_address_id`, `dispatch_id` (nullable), `place_of_supply`, `taxable_amount`, `cgst`, `sgst`, `igst`, `round_off`, `total`; lines `item_id`, `hsn`, `qty`, `rate`, `discount`, `taxable`, `gst_rate`, tax amounts |
| `customer_credit_notes` ⓒⓣ | D-Mart GCN / debit note / short payment (Q-23) | `party_id`, `against_invoice_id`, `reason`, `amount`, tax split |
| `sales_returns` ⓒⓣ + lines | Goods returned by customer | stock IN `SALE_RETURN` |

Whether dispatch and invoice are **one document** or two is decided by Q-03 /
Q-24; the tables allow both (invoice may reference a dispatch).

---

## 9. Payments & accounting tables

### 9.1 `vouchers` ⓒⓣ
| | |
|---|---|
| Purpose | Every money / adjustment event (sheet `DAILY PAYMENT ENTRIES`). |
| Fields | `voucher_type` ∈ RECEIPT, PAYMENT, CONTRA (cash↔bank, bank↔bank), JOURNAL (ENTRY / ADJUST / TDS / set-off); `cash_bank_account_id` (for RECEIPT/PAYMENT/CONTRA), `party_id` (nullable), `amount`, `instrument` (UPI/IMPS/NEFT/CHEQUE/CASH), `instrument_ref`, `narration` |
| Indexes | unique(`company_id`,`doc_no`); (`company_id`,`doc_date`); (`company_id`,`party_id`) |

### 9.2 `voucher_lines`
For JOURNAL and multi-line vouchers: `account_id`, `party_id`, `debit`,
`credit`, `narration`. CHECK exactly one of debit/credit > 0.

### 9.3 `voucher_allocations` (spec §26 — partial payments)
| | |
|---|---|
| FK | `voucher_id`; exactly one of `sales_invoice_id`, `job_work_receipt_id`, `purchase_receipt_id`, `material_issue_id` (bill references) |
| Fields | `amount` > 0, `tds_amount`, `short_amount` |
| Rule | Sum of allocations ≤ voucher amount; unallocated remainder = **advance** (spec §26 customer/vendor advance). |
| Outstanding | bill total − Σ allocations − credit notes → view `v_bill_outstanding`. |

### 9.4 `journal_entries` + `journal_entry_lines` (spec §28)
| Table | Fields |
|---|---|
| `journal_entries` ⓒ | `entry_date`, `entry_no` (sequence JV), `source_table`, `source_id` (**traceability to source document**), `narration`, `reversal_of_id`, `is_opening` |
| `journal_entry_lines` | `journal_entry_id`, `company_id`, `account_id`, `party_id` (nullable; required when account is a control account — trigger), `debit numeric(16,2)`, `credit numeric(16,2)`, `line_narration` |

Constraints:
- CHECK (`debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)`).
- **Deferred constraint trigger** `trg_journal_balanced`: Σ debit = Σ credit
  per `journal_entry_id` at COMMIT → an unbalanced entry makes the whole
  posting roll back.
- No UPDATE / DELETE; cancellation = reversing entry.

Indexes: (`company_id`,`account_id`,`entry_date`), (`company_id`,`party_id`,`entry_date`), (`journal_entry_id`).

### 9.5 Financial periods
`fiscal_years` (`company_id`, `code` 2026-27, `start_date`, `end_date`,
`is_closed`) and `period_locks` (`lock_until date`). Posting functions refuse
dates in closed periods.

---

## 10. Views and report functions (derived — spec §35)

| Object | Replaces sheet | Logic |
|---|---|---|
| `v_stock_balance` | `STOCK IN GODOWN`, `STOCK DETAIL` | Σ `signed_base_qty` by company, item, godown |
| `fn_stock_ledger(item, godown, from, to)` | `ITEM WISE DATA`, `ITEM WISE OUT-IN` | opening + movements + running balance |
| `v_job_work_order_line_status` | `PO ENTRY SALE` | ordered, received (Σ posted receipt lines), returned, short-closed, **pending = ordered − received − short_closed**, status |
| `v_job_work_pending` | `PURCHASE REC` side panel | rows of the above with pending > 0 (spec §20) |
| `v_sales_order_line_status` | `SALE PO`, `PO TRACKING SHEET` | ordered, dispatched, pending, delivered |
| `fn_dispatch_plan(dc[], from, to)` | `PLANING SHEET` | pending boxes by DC/item/delivery date |
| `fn_item_planning(item)` | `Item WISE STOCK` | stock + open demand + JW pending + factory pending → balance to order; cartons required |
| `fn_party_ledger(party, from, to)` | `PURCHASE LEDGER ENTRY`, `SALE LEDGER` | opening, debit, credit, running balance from `journal_entry_lines` |
| `v_bill_outstanding`, `fn_party_outstanding` | W4 `MAIN SHEET`, `OPENING BAL ENTRY!O:Q` | bills − allocations − notes, ageing |
| `fn_cash_bank_book(account, from, to)` | `PAYMENT LEDGER`, `DAILY PAYMENT` KPIs | account ledger with running balance |
| `fn_trial_balance`, `fn_profit_loss`, `fn_balance_sheet`, `fn_day_book` | — (new) | from journal lines |

Heavy reports use SQL aggregation with date-range and server-side pagination;
materialized views only if measured necessary (spec §31).

---

## 11. Key constraints and indexes (summary)

| Rule | Mechanism |
|---|---|
| No duplicate document numbers | unique(`company_id`,`doc_type`,`doc_no`) + `fn_next_doc_no` row lock |
| No over-receipt (JW / PO) | posting fn locks order line, compares with derived pending |
| No negative stock (if Q-18 = block) | posting fn locks `stock_balances` rows; godown `allow_negative` override |
| Balanced journals | deferred constraint trigger |
| Immutable ledgers | trigger blocks UPDATE/DELETE on `stock_movements`, `journal_entry_lines`, `audit_log` |
| Posted documents immutable | trigger blocks UPDATE of posted headers/lines except status → CANCELLED via `fn_*_cancel` |
| Party required on control accounts | trigger on `journal_entry_lines` |
| Transfer from ≠ to | CHECK |
| Company consistency | trigger: FK targets (party, item, godown, account) must have the same `company_id` as the header |

---

## 12. Row-Level Security (RLS)

- RLS **enabled on every table** in the `public` schema.
- Header / master tables: `USING (company_id = ANY (auth_company_ids()))`
  for SELECT; INSERT/UPDATE additionally `has_permission(company_id,
  '<module>.create|edit')`.
- Line tables: policy joins to header (`EXISTS (SELECT 1 FROM header h WHERE
  h.id = header_id AND h.company_id = ANY (auth_company_ids()))`).
- **Posting, approval, cancellation** are only possible through
  `SECURITY DEFINER` functions (`fn_*_post`, `fn_*_cancel`, `fn_*_approve`)
  which check `has_permission` explicitly; direct INSERT into
  `stock_movements` / `journal_*` is denied to the `authenticated` role.
- `service_role` key is used only by server-side jobs (migration import,
  email worker) and never shipped to the browser.
- Storage bucket policies restrict object paths to `{company_id}/…` of the
  user's companies.

---

## 13. Posting functions (atomic units — spec §34)

| Function | Inserts | Validations |
|---|---|---|
| `fn_job_work_order_confirm(id)` | status → OPEN, doc no | ≥ 1 line, party is JOB_WORKER |
| `fn_job_work_receipt_post(payload)` | receipt + lines, `JOB_WORK_RECEIPT` movements, carton `CONSUMPTION` movements (Q-19), journal, order status update | pending ≥ qty per line, godown active, period open, rate rule (Q-06/07) |
| `fn_material_issue_submit/approve/post` | issue + lines, `JOB_WORK_ISSUE` movements, journal | stock available (Q-18), APPROVE permission |
| `fn_job_work_return_post` | return + lines, `JOB_WORK_RETURN` movements, journal | stock available |
| `fn_purchase_receipt_post` | receipt + lines, `PURCHASE_RECEIPT` movements, journal, PO status | PO pending (if linked) |
| `fn_stock_transfer_post` | paired OUT/IN movements | stock available at source |
| `fn_dispatch_post` | dispatch + lines, `SALE_ISSUE` movements, SO status | SO pending, stock available |
| `fn_sales_invoice_post` | invoice + lines, journal | GST calc, place of supply |
| `fn_voucher_post` | voucher + lines + allocations, journal | allocation ≤ bill outstanding, balanced |
| `fn_<doc>_cancel(id, reason)` | reversal movements + reversal journal, status CANCELLED | CANCEL permission, dependent documents (e.g. cannot cancel a receipt that is allocated) |

All return the created document id and number. The web layer calls them via
Supabase RPC; the browser never writes movements or journals directly.

---

## 14. Enum / seed summary

| Seed type | Contents | File (future) |
|---|---|---|
| **System seed** (every instance) | permissions, system roles, units, movement types, doc status enums, default document sequences (prefixes configurable), system account codes | `supabase/seed/system/*.sql` |
| **Company seed** (optional, per instance) | company row, godowns, bank accounts, parties, items, packings, rates, opening balances | generated by migration scripts from the sheets — **never hard-coded in app code** (spec §42) |
