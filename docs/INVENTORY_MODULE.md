# Inventory + Customer / Vendor Portal + PO + Documents + Email + Payment Reminders

Module documentation for the MVP specified in `MASTER_BUILD_PROMPT.md`.
Requirement-by-requirement mapping: `docs/INVENTORY_REQUIREMENTS_CHECKLIST.md`.

---

## 1. Architecture

```
 Browser (Next.js static SPA, web/)          Email worker (worker/, Node)
   ├─ internal ERP  /erp/...                   ├─ email_claim → SMTP → email_complete
   ├─ customer portal /portal/customer/        └─ run_payment_reminders (daily)
   └─ vendor portal   /portal/vendor/                 │ service role
          │ anon key + user session (JWT)              │
          ▼                                            ▼
 Supabase: PostgREST · Auth (password + email OTP) · Storage (bucket "documents")
          ▼
 PostgreSQL — ALL business rules, security and posting logic
   tables + RLS · SECURITY DEFINER RPCs · append-only ledgers · triggers
```

* **Existing Supabase / PostgreSQL system was kept** (no Firebase). The MVP is
  implemented as eight new migrations (`supabase/migrations/20261007000001…08`)
  that extend the existing schema; nothing working was removed.
* **Critical operations run server-side in one database transaction**
  (`app.post_*` posting functions behind `doc_submit`, and the RPCs below). If
  any step fails, nothing is written — no half-completed inventory.
* **The web app is a static export** (`next build` → `web/out`) hosted on any
  static host (Cloudflare Pages free tier). It never holds a secret: it uses the
  anon key + the user's session; RLS and RPC checks enforce everything.
* **Email is never part of a business transaction.** Business functions only
  insert into `email_outbox`; the worker sends later and retries.

| Folder | Content |
|---|---|
| `supabase/migrations/20261007000001…08` | enums, locations & settings, reservations & customer PO, purchase & payments, documents & email & reminders, portals, security & setup, UI support |
| `supabase/tests/100…180` | SQL tests of the module (plus the older 010…070) |
| `worker/` | email worker (nodemailer + pdf-lib), GitHub Actions cron `.github/workflows/email-worker.yml` |
| `web/` | Next.js 16 + TypeScript + Tailwind 4 app |
| `e2e/` | API / Storage / worker tests (`e2e/api`) and Playwright browser tests (`e2e/ui`) against the local Supabase stack |

---

## 2. Data model (new / changed objects)

| Object | Purpose |
|---|---|
| `company_settings` | One row per company: every Owner/Admin switch (negative stock, portals, visibility, quote price, email switches, reminder rules). Audited on change. |
| `party_settings` | Per customer / vendor override (`NULL` = use company setting): stock visibility, rate visibility, quote price, email, payment reminders. |
| `storage_locations` | Godown → zone → rack → shelf → bin. `code` = RACK-SHELF-BIN (e.g. `B1-C-123`). Each godown gets a default `UNASSIGNED` location automatically. |
| `items` (+cols) | description, barcode (unique per company), purchase/sales unit, purchase/sale price, max stock, reorder level, portal visible. |
| `item_packings` (existing) | Item-specific conversion: 1 BOX = 24 PAIR for item A, 36 for item B … |
| `stock_movements` (+`location_id`) | Append-only physical ledger. Types: STOCK_IN, STOCK_OUT, STOCK_TRANSFER_OUT/IN, STOCK_ADJUSTMENT, PURCHASE_RECEIPT, SALE_DISPATCH, OPENING (+ existing job-work / production types). |
| `stock_balances` | Physical stock per item + godown + **location** (maintained by trigger from movements only). |
| `stock_reserved` | Reserved quantity per item + godown; also the row lock that serialises all postings of an item in a godown. |
| `stock_reservations` / `stock_reservation_movements` | Reservations per sales-order line + append-only RESERVATION / RESERVATION_RELEASE ledger. |
| `customer_pos` / `customer_po_lines` | Customer PO from the portal (or entered internally): `reference_rate` (company price), `quoted_rate` (customerQuotedPrice), `approved_rate`. |
| `sales_order_lines` (+cols) | `rate` = final approved price, plus `quoted_rate` and `reference_rate` kept for history. |
| `purchase_receipt_lines.location_id`, `dispatch_lines.location_id`, `stock_transfer_lines.from/to_location_id`, `stock_adjustment_lines.location_id` | Rack/bin on every stock document. |
| `due_date` on `customer_bills`, `purchase_receipts`, `service_bills`, `job_work_receipts` | Default = bill date + party credit days; editable (`bill_set_due_date`). |
| `vouchers.payment_method` | CASH / BANK / UPI / CHEQUE / OTHER (validated against the cash/bank account). |
| `documents` | Metadata of files in Storage (category, entity, party, path, size, visible to party, uploader). |
| `email_outbox` / `email_events` | Email queue with status, attempts, back-off, error, provider message id; full history. |
| `payment_reminders` | One row per reminder sent (bill, date, outstanding then, email). |
| `portal_users` | Customer / vendor portal logins linked to a party; invitation claimed on first login. |
| `user_invitations` | Internal staff invitations with role. |

Main views: `v_inventory_items`, `v_stock_balance`, `v_stock_by_location`,
`v_stock_movement_history`, `v_stock_reservations`, `v_customer_po_lines`,
`v_sales_order_lines`, `v_purchase_order_lines`, `v_purchase_pending_lines`,
`v_bills`, `v_bill_outstanding`, `v_payment_allocations`, `v_email_log`,
`v_payment_reminders` (all `security_invoker`, so RLS applies).

---

## 3. Inventory logic & stock calculation

```
Physical   = Σ stock_movements (signed)            per item / godown / location
Reserved   = Σ open reservations                   per item / godown
Available  = Physical − Reserved
```

* Stock is **never typed in**. Every change goes through `app.post_stock`
  (called by the posting functions) which writes movements; balances follow by
  trigger. History cannot be edited (trigger `stock_movements_immutable`);
  corrections are stock adjustments or cancellations (reversal movements).
* `app.post_stock` locks `stock_reserved` for the item + godown first, so two
  users can never both take the last stock (tested with parallel sessions:
  `supabase/tests/170_concurrent_reservation.sh`, `060_concurrency.sh`).
* **Negative stock** (`company_settings.allow_negative_stock`, default **OFF**):
  an OUT is rejected when `physical − qty < reserved` for the godown, or when a
  chosen location holds less than the quantity, with a clear message, e.g.
  *"Insufficient stock of 10mm Bolt in Delhi: available 2,000 PCS (physical 2000 − reserved 0), required 2,001 PCS"*.
  Owner/Admin can switch it ON (then the posting succeeds with a warning).
  A per-godown `allow_negative` flag exists; only Owner/Admin can set it.
* Units: everything is stored in the item's **base unit**; documents keep the
  entered unit + conversion factor snapshot. UI shows both, e.g. *20 BOX (480 PAIR)*.

## 4. Godown logic

Any number of godowns per company. The inventory screen shows one consolidated
row per item (Total · Reserved · Available · Locations); the item detail shows
the godown breakdown and the location breakdown. Godowns can be hidden from
portal stock (`godowns.portal_visible`).

## 5. Rack / bin logic

* `storage_locations` per godown; code generated as `RACK-SHELF-BIN`
  (zone is a grouping field). Unique per godown. Deactivated locations cannot
  receive or issue stock.
* **IN** goes to the chosen location (or the godown's `UNASSIGNED` location).
* **OUT** from a chosen location must not exceed that location's stock; without a
  location the system auto-picks from locations holding the item (named racks
  first, then by code) and splits the movement.
* Transfers can move between godowns or between racks of the same godown
  (same location → rejected).

## 6. Reservation logic

* Reserve from a sales-order line for a godown (`sales_order_reserve`) or
  automatically on customer-PO approval (`customer_po_approve(..., p_godown_id, p_reserve)`).
* A reservation is limited to **available** stock (even when negative stock is
  ON) and to the line's unreserved pending quantity.
* Reservation never changes physical stock; it is recorded as RESERVATION in
  its own ledger and added to `stock_reserved`.
* **Dispatch** first consumes the order line's own reservation in that godown
  (RESERVATION_RELEASE, reason DISPATCH) and then posts SALE_DISPATCH (stock
  OUT). Other orders cannot take reserved stock.
* Release: manually (`reservation_release`), on order close / cancel, or
  automatically when the order is fully dispatched. Quantity edits cannot go
  below dispatched + reserved.

## 7. Sales flow

```
Customer PO (portal / internal entry) → SUBMITTED → UNDER_REVIEW
   → approve (price per line may be modified) → APPROVED → Sales Order (OPEN)
   → reject (reason)                          → REJECTED
Sales Order → reserve → dispatch (partial allowed) → DISPATCHED / CLOSED
```

The customer's quote is stored as `quoted_rate` and **never** becomes the
price by itself. `customer_po_approve` stores `approved_rate` (default = quote,
else price list) and copies quote + reference + approved price to the sales
order. Only `customer_po.approve` (Owner/Admin/Approver) can approve or change
an approved price (`sales_order_line_set_rate`, audited).

## 8. Purchase PO & receiving

* Company creates the vendor PO (vendors never create POs). Confirming the PO
  queues the VENDOR_PO email with the PO PDF (when enabled).
* Receiving: with or without PO, into a selected godown + rack/bin.
  Pending = ordered − received. Over-receiving is rejected
  (*"Over-receiving rejected: receive quantity … is more than pending …"*).
* `v_purchase_pending_lines` lists only lines with pending > 0 on OPEN /
  PARTIALLY_RECEIVED POs — fully received lines disappear.
* Statuses: OPEN → PARTIALLY_RECEIVED → FULLY_RECEIVED; CANCELLED; CLOSED
  (`purchase_order_close`, pending will not be received).

## 9. Customer visibility (portal)

| Setting value | Customer sees |
|---|---|
| `HIDDEN` | no quantity |
| `EXACT_QUANTITY` | available quantity (physical − reserved, portal-visible godowns) |
| `AVAILABLE_STATUS` | IN_STOCK / LOW_STOCK (≤ reorder level or min stock) / OUT_OF_STOCK |
| `AVAILABLE_TO_PROMISE` | available − open sales-order demand not yet reserved |

Computed server-side by `app.portal_stock`; nothing else is sent to the browser.

## 10. Vendor visibility

Separate setting `vendor_stock_visibility` (same four values) and
`vendor_rate_visible`. The vendor sees only his own POs (ordered / received /
pending, status), his bills and payments (if `vendor_payment_visible`) and
documents shared with him. With rates hidden, rates are removed from his PO list
and PO PDF.

## 11. Pricing & price visibility

Pricing and visibility are independent:

* Price = customer-specific SALE rate (`party_item_rates`, effective date) →
  company-wide SALE rate → `items.sale_price` (`app.customer_price`).
* `customer_rate_visible` (+ override) only decides whether the customer may
  **see** it. A customer with hidden rates can still order (if the portal is on)
  and may quote a price if quoting is enabled.
* Priority of every visibility / email / reminder flag:
  **individual override → company setting → system default** (`app.effective_party_settings`).

## 12. Documents

Files are uploaded by the browser into the private bucket `documents` at
`<company_id>/<entity_type>/<uuid>-<file>` and registered with
`document_register` (entity must belong to the company; path must be in the
company folder). Portal customers can attach files to their own PO under
`<company_id>/portal/<party_id>/…`. Storage policies (`app.storage_can_read/write`)
allow: users with `documents.view` / `documents.create` of that company, and
portal users only for files of their own party marked `visible_to_party`
while their portal is enabled (verified on real Supabase Storage:
`e2e/api/storage.test.mjs`).

## 13. Email settings & sending

Settings → Email (Owner/Admin): **Email automation** (master), Vendor PO email,
Vendor document email, Customer invoice email, Customer document email,
Payment reminder email, Vendor payment reminder, max attempts.

| Event | Email kind | Attachments |
|---|---|---|
| PO confirmed | VENDOR_PO | PO PDF |
| Document uploaded on PO / receipt / vendor | VENDOR_DOCUMENT | PO PDF + uploaded file |
| Tally invoice PDF uploaded on a customer bill | CUSTOMER_INVOICE | invoice PDF |
| Other customer document uploaded | CUSTOMER_DOCUMENT | file |
| Reminder run | CUSTOMER_PAYMENT_REMINDER / VENDOR_PAYMENT_REMINDER | — |

* Setting OFF → no email row is created at all. Party without an address → row
  is created as FAILED with the reason (visible in the Email log) and can be
  retried after the address is fixed.
* The worker (`email_claim`, `FOR UPDATE SKIP LOCKED`, service role only)
  re-checks the settings at send time (→ SKIPPED), cancels reminders of bills
  that are already paid, builds attachments (PO PDF generated with pdf-lib from
  `purchase_order_print_data`; files downloaded from Storage), sends with
  nodemailer and calls `email_complete`. Failure → re-queued with back-off
  2, 4, 8, 16 … minutes until `max_attempts`, then FAILED. A worker that died
  while sending is re-claimed after 15 minutes. Manual retry: `email_retry`.
* **The ERP does not generate GST invoices.** Invoices are made in Tally; the ERP
  records the bill (`customer_bills`), stores the PDF, emails it and tracks
  payment.

Running the worker: `node worker/src/main.ts once | reminders | loop` with the
variables in `.env.example` (SMTP_*, EMAIL_FROM_*, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY). In production the GitHub Actions workflow runs it
every 10 minutes and the reminders daily at 09:00 IST.

## 14. Payment tracking & reminder settings

* Receipts / payments with method CASH / BANK / UPI / CHEQUE / OTHER; contra
  Bank→Cash, Cash→Bank, Bank→Bank. Allocations: one payment → many bills, one
  bill ← many payments (`voucher_allocations`); unallocated amount stays as
  advance.
* Customer reminders: ON/OFF, start N days before due (10/15/20/30/custom),
  DAILY or WEEKLY, continue after partial payment with the new outstanding,
  stop when outstanding = 0 (queued ones are cancelled by trigger as soon as the
  payment posts; the worker re-checks too). Override per customer.
* Vendor reminders: ON/OFF, days, frequency, sent to **internal** users with the
  configured roles (default Owner, Admin, Accounts) — never to the vendor.

## 15. Security rules

* RLS on every table. Internal users: rows of companies they are members of,
  writes by module permission; documents only through RPCs.
* **Portal users are not company members**: every table policy denies them.
  They use only `portal_*` RPCs which resolve the party from the login
  (`app.portal_party`) and check that the portal is enabled. Payload fields such
  as `company_id`, `party_id`, `status`, prices are ignored / recomputed.
* Customers cannot change stock, approved price, company, other customers,
  payment status or invoice amounts; vendors cannot change payments, bills,
  due dates or see other vendors (tests 120, 130, 160).
* `app.*` functions are not executable by users; the worker RPCs require the
  service role.
* Roles: OWNER, ADMIN (all, incl. settings/users/portal access), APPROVER,
  ACCOUNTANT, PURCHASE, SALES, OPERATOR, VIEWER (`app.role_grants`). Settings,
  overrides, per-godown negative stock and portal access are Owner/Admin only.
* Every posting, approval, settings change, upload and retry is in `audit_log`.

## 16. Testing

| Command | What it runs |
|---|---|
| `npm run db:test` | throw-away PostgreSQL DB, all migrations, 16 SQL / shell test files (incl. parallel sessions) |
| `npm run test:worker` | worker unit tests (PO PDF) |
| `npm run test:e2e:api` | against `supabase start`: Storage security, email worker with a local SMTP server (SMTP down → retry → delivered with PO PDF + documents, invoice email, reminder) |
| `npm run test:e2e:ui` | builds the web app and drives it in Chromium (Playwright): settings, godown/bin, item packing, stock in/out, negative stock block, customer portal PO with quote, approval with modified price + reservation, dispatch from a bin, purchase PO + partial receiving + over-receiving block, vendor portal + PO PDF, Tally invoice upload + email queued, payment + outstanding in the portal, visibility setting + customer override |
| `npm run lint` / `npm run typecheck` / `npm run build` | web + worker |

Coverage of the 33 required test cases: see the "Test" column of
`docs/INVENTORY_REQUIREMENTS_CHECKLIST.md`.

## 17. Local development

```bash
npm install
npm run db:test                                      # database tests (local PostgreSQL)
supabase start && supabase db reset                  # local Supabase stack with all migrations
cp web/.env.example web/.env.local                   # set URL + anon key from `supabase status`
npm --workspace web run dev                          # http://localhost:3000
npm run test:e2e:api && npm run test:e2e:ui          # end-to-end
```

First login: create the instance with `npm run instance:init` (see
`docs/INSTANCE_SETUP.md`) — the admin becomes OWNER. Further staff: Users &
roles → Invite. Customers / vendors: Customers & vendors → Portal access.
