# Inventory + Portals MVP — Requirement → Implementation Checklist

Source of truth: `MASTER_BUILD_PROMPT.md`. Architecture: existing Supabase / PostgreSQL
(no Firebase). Status as of commit on branch `claude/charming-gauss-o9fvzf`.

**Legend** — Status: ✅ built and tested (SQL tests T…, API e2e, browser e2e).

**Migration short names**
| Code | File |
|---|---|
| M-INV | `20260929000004_inventory.sql` (existing ledger) |
| M-PUR / M-SAL / M-VOU | existing `…0010_purchase`, `…0011_sales`, `…0012_vouchers` |
| M1 | `20261007000001_inventory_mvp_enums.sql` |
| M2 | `20261007000002_inventory_locations_settings.sql` |
| M3 | `20261007000003_sales_reservations_customer_po.sql` |
| M4 | `20261007000004_purchase_payments.sql` |
| M5 | `20261007000005_documents_email_reminders.sql` |
| M6 | `20261007000006_portals.sql` |
| M7 | `20261007000007_inventory_mvp_security_setup.sql` |

**Tests** (`supabase/tests/`): T010…T070 existing (still green), T100 inventory/locations,
T110 customer PO/reservation, T120 portal visibility/security, T130 purchase/vendor portal,
T140 documents/email, T150 payments/reminders. Run: `npm run db:test` → 13/13 PASS.

**UI** (Next.js app `web/`) screens: `Inventory`, `Item detail`, `Godowns & locations`,
`Items`, `Parties` (portal access, overrides, customer prices), `Customer POs (review)`,
`Sales orders` (reserve / dispatch), `Purchase orders`, `Receiving (pending lines)`,
`Stock transfer / adjustment`, `Documents`, `Email log`, `Payments`, `Settings (control center)`,
`Customer portal` (catalog, my POs, orders, invoices, payments, outstanding),
`Vendor portal` (POs, supply status, payments, documents), `Login (email OTP)`.

---

## 1. Multiple godowns
| A. Requirement | B. Where | C. DB | D. Backend / logic | E. UI | F. Test | Status |
|---|---|---|---|---|---|---|
| Multiple godowns | existing masters + M2 | `godowns` (+`portal_visible`) | RLS `godowns_*` | Godowns & locations | T100 "Delhi/Noida/Factory" | ✅ |
| Same item in many godowns | M2 | `stock_balances (item, godown, location)` | `app.post_stock` | Item detail | T100 "Item is in 3 godowns" | ✅ |
| Consolidated stock, ONE screen | M2 | view `v_inventory_items` | — | Inventory list (Item · Total · Reserved · Available · Locations) | T100 "Consolidated physical = 20,000" | ✅ |
| Godown-wise breakdown | M2 | view `v_stock_balance` | `inventory_item_detail()` → `godowns[]` | Item detail | T100 "Delhi godown = 8,000", "3 godown rows" | ✅ |
| Location-wise breakdown | M2 | view `v_stock_by_location` | `inventory_item_detail()` → `locations[]` | Item detail "Delhi / B1-C-123" | T100 "4 location rows" | ✅ |

## 2. Physical location
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Godown → Zone → Rack → Shelf → Bin | M2 | `storage_locations (godown_id, zone, rack, shelf, bin)` | trigger `tg_storage_location_code` (upper-cases, validates) | Godowns & locations | T100 location inserts | ✅ |
| Code `B1-C-123` | M2 | `storage_locations.code` = RACK-SHELF-BIN (zone kept as grouping, not in code) | same trigger; `app.location_label()` → "Delhi / B1-C-123" | everywhere stock is shown | T100 "RACK-SHELF-BIN", "Noida / A2-B-041" | ✅ |
| Same item in many locations | M2 | `stock_balances` PK incl. `location_id` | OUT auto-picks across bins | Item detail | T100 "second location", "auto-pick split" | ✅ |
| Every godown always has a location | M2 | default `UNASSIGNED` location per godown | trigger `tg_godown_default_location` | — | T100 first assertion | ✅ |
| Duplicate bin rejected | M2 | unique `(godown_id, upper(code))` | — | — | T100 | ✅ |

## 3. Stock
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Physical / Reserved / Available, Available = Physical − Reserved | M2, M3 | `stock_balances`, `stock_reserved` | views compute `available_qty` | Inventory list + item detail | T110 "(20000, 5000, 15000)" | ✅ |
| Movement-based, history not editable | M-INV + M2 | `stock_movements` (append-only, + `location_id`) | trigger `stock_movements_immutable`; balances only via trigger | — | T100 "Historical movements cannot be edited" | ✅ |
| Movement records item, godown, location, qty, unit, type, reference, date, user, timestamp | M2, M3 | `stock_movements`, view `v_stock_movement_history` | `app.insert_movement` | Item detail → history tab | T100 "Every movement records…" | ✅ |
| STOCK_IN / STOCK_OUT | M1, M2 | enum `movement_type` | `post_stock_adjustment` reason STOCK_IN / STOCK_OUT | Stock adjustment | T100 | ✅ |
| STOCK_TRANSFER_OUT / IN | M-INV, M2 | `stock_transfers`, lines `from/to_location_id` | `post_stock_transfer` | Stock transfer | T100 transfer section | ✅ |
| STOCK_ADJUSTMENT | M1, M2 | reasons PHYSICAL_COUNT / DAMAGE / CORRECTION | same | Stock adjustment | T020 / T100 | ✅ |
| RESERVATION / RESERVATION_RELEASE | M1, M3 | `stock_reservations`, `stock_reservation_movements` (append-only) | `app.reserve`, `app.release` | Sales order → Reserve / Release | T110 | ✅ |
| PURCHASE_RECEIPT | M-PUR, M4 | `purchase_receipt_lines.location_id` | `post_purchase_receipt` | Receiving | T130 | ✅ |
| SALE_DISPATCH | M1 (rename of SALE_ISSUE), M3 | `dispatch_lines.location_id` | `post_dispatch` | Sales order → Dispatch | T110 "SALE_DISPATCH movement" | ✅ |
| Failed operation leaves nothing half-done | all posting fns run in one transaction | — | — | — | T100 "Factory stock untouched after the failed transfer" | ✅ |

## 4. Item master
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Code, name, description, category, brand, active | existing + M2 | `items.code/name/description/category_id/brand_id/is_active` | RLS `items_*` | Items | T100 item insert | ✅ |
| Base unit, purchase unit, sales unit (secondary) | M2 | `items.base_unit_id/purchase_unit_id/sales_unit_id` | trigger `tg_item_units_check` (unit must be base or have packing) | Items | T100 "Sales unit must … have an item packing" | ✅ |
| Item-specific packing | existing | `item_packings (item_id, unit_id, factor_to_base)` | `app.unit_factor`, `app.fmt_qty` → "20 BOX (360 PAIR)" | Items → Packing | T100 "1 box = 18 / 36 pairs" | ✅ |
| Barcode | M2 | `items.barcode` unique per company | — | Items; catalog search by barcode | T100 "Barcode is unique" | ✅ |
| Purchase price, sale price | M2 | `items.purchase_price/sale_price` | `app.vendor_price`, `app.customer_price` | Items | T110/T120 | ✅ |
| Min / max / reorder | M2 | `items.min_stock/max_stock/reorder_level` | `stock_status` LOW_STOCK uses reorder/min | Items; Inventory filter "Stock status" | T120 "LOW STOCK at reorder level" | ✅ |

## 5. Customer portal
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Customer login | M6 + Supabase Auth (email OTP) | `portal_users` (invite → claimed on first login) | `portal_invite`, `session_bootstrap` | Login, Parties → Portal access | T120 "Invited email linked … after login" | ✅ |
| Sees ONLY own data | M6, M7 | no table policy for portal users | every `portal_*` fn derives party from `auth.uid()` via `app.portal_party` | — | T120 §30 block | ✅ |
| Product catalog | M6 | `items.portal_visible`, `godowns.portal_visible` | `portal_catalog()` | Customer portal → Catalog | T120 | ✅ |
| Create PO: PO no, date, items, qty, quoted price, requested delivery, remarks, attachments | M3, M6 | `customer_pos`, `customer_po_lines`, `documents (entity customer_po)` | `portal_customer_po_create`, `portal_document_register`, `portal_customer_po_cancel` | Customer portal → New PO | T110 | ✅ |
| PO status / order status | M6 | `customer_pos.status`, `sales_orders.status` | `portal_my_customer_pos`, `portal_my_orders` (ordered / dispatched / pending, dispatches) | My POs, My Orders | T110, T120 | ✅ |
| Invoices + documents | M6 | `customer_bills`, `documents.visible_to_party` | `portal_my_invoices`, `portal_documents`; storage policy `app.storage_can_read` | My Invoices (download PDF) | T140 "Customer sees his invoice PDF" | ✅ (e2e/api/storage) |
| Payment history | M6 | `vouchers` RECEIPT + allocations | `portal_my_payments` | My Payments | T150 "Customer sees his 4 payments" | ✅ |
| Outstanding if permitted | M2, M6 | `company_settings.customer_outstanding_visible` | `portal_my_outstanding`, `portal_my_invoices` hide amounts | Dashboard | T150 "Outstanding hidden when not allowed" | ✅ |

## 6. Customer quoted price
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Customer enters requested price (if allowed) | M3, M6 | `customer_po_lines.quoted_rate`; setting `customer_quote_price_enabled` + party override | `app.customer_po_create(p_allow_quote)` | New PO form | T110 "Quote 140 stored", "Quote ignored when OFF" | ✅ |
| Original quote preserved | M3 | `customer_po_lines.quoted_rate`, copied to `sales_order_lines.quoted_rate` | — | Review screen shows quote vs reference vs approved | T110 "(143, 140, 145)" | ✅ |
| NOT automatically final | M3 | `approved_rate` null until review | — | — | T110 "NOT approved automatically", "No sales order before review" | ✅ |
| Approve / modify / reject | M3 | `customer_pos.status` SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED | `customer_po_start_review`, `customer_po_approve(p_lines …)`, `customer_po_reject` (permission `customer_po.approve`) | Customer POs review | T110 | ✅ |
| approvedPrice stored separately | M3 | `customer_po_lines.approved_rate`, `sales_order_lines.rate` (+ `quoted_rate`, `reference_rate`) | `sales_order_line_set_rate` (approver only, audited) | Sales order | T110 | ✅ |

## 7–9. Stock & rate visibility (customer / vendor, global + override)
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Customer stock HIDDEN / EXACT / STATUS / ATP | M2, M6 | `company_settings.customer_stock_visibility` | `app.portal_stock` (ATP = available − unreserved open order demand) | Settings; catalog | T120 (all 4 modes) | ✅ |
| Vendor stock, independent | M2, M6 | `company_settings.vendor_stock_visibility` | `portal_vendor_pos` uses vendor setting | Settings; vendor portal | T130 "Customer setting does not change vendor visibility" | ✅ |
| Customer rate visible / hidden | M2, M6 | `customer_rate_visible` | `portal_catalog` price null when hidden; reference price hidden on POs | Settings | T120 §13/§14 | ✅ |
| Vendor rate visible / hidden | M2, M6 | `vendor_rate_visible` | `portal_vendor_pos`, `portal_vendor_po_print` strip rate | Settings | T130 "Vendor rate hidden", "PO print has no rate" | ✅ |
| Individual override (stock, rate, email, reminders); priority override → company → default | M2, M7 | `party_settings` (nullable = inherit); write only Owner/Admin (`portal.edit`) | `app.effective_party_settings`, `app.email_enabled` | Parties → Portal & overrides | T120 §15, T130 §16, T140 email override, T150 reminder override | ✅ |

## 10. Customer-specific pricing
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Base 150, A 145, B 138 | existing `party_item_rates` (rate_type SALE) + M3 | `party_item_rates`, `items.sale_price` | `app.customer_price` (customer → company SALE rate → item price) | Parties → Prices | T110 "A 145 / B 150", T120 "A sees 145, B sees 138" | ✅ |
| Pricing separate from visibility | M3 / M6 | price list vs `rate_visible` | catalog shows price only when visible; price still used as reference on PO | — | T120 override "rate hidden for A only" | ✅ |

## 11. Vendor portal
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Vendor login | M6 | `portal_users kind VENDOR` | `portal_invite`, `session_bootstrap` | Login | T130 | ✅ |
| Only own POs; details; ordered / received / pending; supply status | M6 | `purchase_orders`, `purchase_order_lines` | `portal_vendor_pos`, `portal_vendor_po_print` | Vendor portal → My POs | T130 | ✅ |
| Payment status + history | M6 | `v_bill_outstanding`, vouchers PAYMENT | `portal_vendor_payments` (UNPAID / PARTIALLY_PAID / PAID), setting `vendor_payment_visible` | Vendor portal → Payments | T130 | ✅ |
| Documents if permitted | M5, M6 | `documents.visible_to_party` | `portal_documents` | Vendor portal → Documents | T160 §4 | ✅ |
| Vendor does NOT create POs | M6 | — | no vendor write RPC exists | — | T130 "Vendor cannot post receipts" | ✅ |

## 12–13. Purchase PO & partial receiving
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Company creates PO (vendor, no, date, items, qty, rate, expected delivery, remarks, attachments) | M-PUR + M5 | `purchase_orders.expected_date/remarks`, `documents` | `doc_save/doc_submit('PURCHASE_ORDER')` | Purchase orders | T130 | ✅ |
| PO-linked + direct receiving | M-PUR, M4 | `purchase_receipt_lines.po_line_id` nullable | `post_purchase_receipt` | Receiving | T130 "Direct receiving without a PO" | ✅ |
| Into selected godown + rack/bin | M4 | `purchase_receipts.godown_id`, `purchase_receipt_lines.location_id` | — | Receiving | T130 "Stock actually increased in the selected location" | ✅ |
| 500 → 140 → 360 → 100 → 260 → 260 → 0 | M4 | `ordered_base_qty`, `app.purchase_received` | — | Receiving | T130 exact sequence | ✅ |
| Fully received line disappears; only pending lines | M4 | view `v_purchase_pending_lines` | — | Receiving screen lists this view only | T130 "10 items: only 9 shown", "disappears" | ✅ |
| Over-receiving rejected | M4 | — | error "Over-receiving rejected…" (row-locked, concurrency-safe) | — | T130, T060 (parallel) | ✅ |
| Status OPEN / PARTIALLY_RECEIVED / FULLY_RECEIVED / CANCELLED / CLOSED | M1, M4 | `order_status` + CLOSED | `refresh_purchase_order_status`, `purchase_order_close` | PO list | T130 | ✅ |
| Audit on receipt | M4 | `audit_log` | — | — | T130 "Every receipt is audited" | ✅ |

## 14–16. Sales flow, reservation, transfer
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Customer PO → Review → Approve/Modify/Reject → Sales Order → Reservation → Dispatch → Stock OUT | M3 | `customer_pos` → `sales_orders.customer_po_id` → `stock_reservations` → `dispatches` | `customer_po_approve(…, p_godown_id, p_reserve)`, `sales_order_reserve`, `post_dispatch` | Customer POs → Sales order → Dispatch | T110 whole flow | ✅ |
| Validate available stock before reservation / dispatch | M2, M3 | — | `app.reserve` (always ≤ available), `post_stock` | — | T110 "Reservation cannot exceed available" | ✅ |
| Reservation does not reduce physical | M3 | separate ledger | — | — | T110 "(20000, 5000, 15000)", "does not touch the physical ledger" | ✅ |
| Dispatch reduces physical + releases reservation | M3 | `stock_reservations.consumed_qty` | `post_dispatch` consumes own reservation first | — | T110 "Reservation consumed 2000", "CONSUMED" | ✅ |
| Reserved stock protected from other OUTs | M2 | — | `post_stock` checks physical − qty ≥ reserved | — | T110 "Reserved stock cannot be taken out…" | ✅ |
| Release / close order releases | M3 | — | `reservation_release`, `sales_order_close`, `cancel_sales_order` | Sales order | T110 | ✅ |
| Transfer A → B with OUT + IN | M-INV, M2 | `stock_transfers` | `post_stock_transfer` | Stock transfer | T100 | ✅ |

## 17–20. Documents & email
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Upload PO / invoice / purchase / delivery / payment / other | M5 | `documents.category`, `entity_type` (purchase_order, purchase_receipt, customer_bill, sales_order, customer_po, dispatch, voucher, party) | `document_register`, `document_delete`, `document_set_visibility` | Documents panel on each record | T140 | ✅ |
| Metadata stored | M5 | file name, mime, size, path, uploader, time, party | — | — | T140 "metadata saved and linked" | ✅ |
| Secure storage | M6 | Storage bucket `documents` (private) + policies `app.storage_can_read/write` (company folder / own portal folder) | — | — | e2e/api/storage.test.mjs | ✅ |
| Vendor document → PO PDF + attachment → auto email | M5 | `email_outbox.attachments` [{po_pdf},{document_id}] | `app.document_emails`, `app.queue_vendor_po_email`; PDF made by worker from `purchase_order_print_data` | — | T140 "Email contains PO PDF + uploaded document" | ✅ |
| Vendor PO email on confirmation | M5 | — | `app.post_purchase_order` queues VENDOR_PO | PO → "Email PO" button (`purchase_order_send_email`) | T140 | ✅ |
| Email failure never rolls back | M5 | outbox only; send happens in worker | business fns only INSERT | — | T140 "PO confirmed even though the email cannot be sent" | ✅ |
| History + retry | M5 | `email_events`, `attempts`, `next_attempt_at` back-off, `max_attempts` | `email_claim`, `email_complete`, `email_retry`, stale re-claim | Email log (retry button) | T140 | ✅ |
| Tally invoice PDF → upload → attach → email → history → retry (no GST invoice generation) | M5 | `customer_bills` (recorded from Tally) + `documents` category INVOICE | `document_emails` → CUSTOMER_INVOICE | Customer bill → Upload invoice PDF | T140 §24 | ✅ |
| Customer document email | M5 | kind CUSTOMER_DOCUMENT | `document_emails` | Documents panel | T160 §5 | ✅ |
| Email settings: automation, vendor PO, vendor document, customer invoice, customer document, payment reminder, vendor payment reminder | M2, M5 | `company_settings.*_email`, `email_automation` | `app.email_enabled` checked at queue AND at send | Settings → Email | T140 (OFF → nothing; OFF later → SKIPPED) | ✅ |

## 21–22. Payment reminders & payments
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Customer reminder ON/OFF, X days before due, daily/weekly | M2, M5 | `customer_reminder_enabled/_start_days/_frequency`; `customer_bills.due_date` (bill date + credit days, editable `bill_set_due_date`) | `run_payment_reminders(as_of)` (daily by worker cron) | Settings → Reminders | T150 (14 Oct none, 15 Oct start, daily, weekly) | ✅ |
| Continue after partial; stop at 0 | M5 | `payment_reminders` log | uses `v_bill_outstanding`; trigger cancels queued reminders when paid; worker re-checks | — | T150 100000 / 40000 / 60000 | ✅ |
| Vendor reminder ON/OFF, days, frequency, internal roles | M2, M5 | `vendor_reminder_*`, `vendor_reminder_roles` | `app.role_emails` | Settings → Reminders | T150 "goes to internal Owner + Accounts" | ✅ |
| Payment methods cash / bank / UPI / cheque / other | M1, M4 | `vouchers.payment_method` | trigger validates method vs account | Payments | T150 | ✅ |
| Contra bank→cash, cash→bank, bank→bank | M-VOU | `vouchers` CONTRA | `post_voucher` | Payments → Contra | T150 | ✅ |
| One payment → many invoices; one invoice → many payments | M-VOU, M4 | `voucher_allocations`, view `v_payment_allocations` | `voucher_set_allocations` | Payments → allocate | T150 | ✅ |

## 23–24. Owner/Admin settings, negative stock
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| All settings without code change | M2, M7 | one row per company in `company_settings` (+ audit trigger) | RLS: update only `settings.edit` (Owner/Admin) | Settings control center | T020 "Settings change is audited", T100 "Operator cannot enable negative stock" | ✅ |
| Portal ON/OFF (customer, vendor) | M2, M6 | `customer_portal_enabled`, `vendor_portal_enabled` | `app.portal_party` | Settings | T120 "OFF by default" | ✅ |
| Negative stock default BLOCK; Owner/Admin can enable | M2 | `allow_negative_stock` (default false), `godowns.allow_negative` | `post_stock`, `reverse_stock` | Settings | T100, T020 | ✅ |
| Dispatch beyond available rejected | M2, M3 | — | `post_dispatch` → `post_stock` | Dispatch dialog | T160 §1, UI e2e | ✅ |

## 25. Security
| A | B | C | D | E | F | Status |
|---|---|---|---|---|---|---|
| Customer A ≠ Customer B | M6, M7 | RLS (portal users are not members) | party resolved from login | — | T120 | ✅ |
| Vendor A ≠ Vendor B | M6 | same | same | — | T130 §31 | ✅ |
| Customer cannot modify approved price | M3, M7 | no write grant on PO / SO lines | `sales_order_line_set_rate` needs `sales_order.approve` | — | T110, T120 | ✅ |
| Customer cannot modify stock | M2, M7 | no write grant on ledgers; `app.*` not executable | — | — | T100 §32, T120 | ✅ |
| Customer cannot modify companyId / party | M6 | payload `company_id`/`party_id` stripped | — | — | T110, T160 §2 | ✅ |
| Vendor cannot modify payment status | M7 | no write path on vouchers / allocations for portal users | — | — | T160 §3 | ✅ |
| Internal roles (Owner, Admin, Approver, Accounts, Purchase, Sales, Operator, Viewer) | M7 | `app.role_grants` | `sync_system_role_permissions` | Users & roles | T130/T140/T150 use ACCOUNTANT / PURCHASE | ✅ |
| Company isolation | existing + M7 | RLS everywhere | — | — | T050, T120 §33 | ✅ |
| Concurrency (two users reserving the last stock) | M3 | row lock on `stock_reserved` | — | — | T170 (parallel sessions) | ✅ |

## 26. Existing project
| A | B | Status |
|---|---|---|
| Nothing destroyed; Supabase kept | New migrations only ALTER / extend; old tests T010–T070 still pass (adjusted only for the BLOCK default and tighter audit-log access) | ✅ |
| Works on real Supabase | `supabase db reset` on local Supabase stack: all 22 migrations + seed applied | ✅ |

## 27. Delivery status

| Item | Where | Test |
|---|---|---|
| Email worker | `worker/` (nodemailer, pdf-lib PO PDF, retries), `.github/workflows/email-worker.yml` | `worker/test`, `e2e/api/email-worker.test.mjs` |
| Web app — internal ERP | `web/src/app/erp/*` (dashboard, inventory, item detail, items & packing, godowns & locations, stock in/out/transfer, customer POs, sales orders & dispatch, purchase orders, receiving, invoices & bills, payments, reminders, documents, email log, customers & vendors, users, settings) | `e2e/ui/*.spec.ts` |
| Customer / vendor portals | `web/src/app/portal/*` | `e2e/ui/flow.spec.ts`, `visibility.spec.ts` |
| Module documentation | `docs/INVENTORY_MODULE.md` | — |
| Lint / typecheck / production build | `npm run lint`, `npm run typecheck`, `npm run build` | CI-ready |

## Gaps found in the review — all closed
1. Dispatch beyond available stock rejected → T160 §1 + UI e2e (stock OUT block).
2. Customer `company_id` / party / status tampering → T160 §2.
3. Vendor cannot change payment / allocation / bill / due date → T160 §3.
4. Vendor portal documents visibility → T160 §4.
5. CUSTOMER_DOCUMENT email ON / OFF → T160 §5.
6. Parallel reservations / dispatches of the last stock → T170.
7. Storage security on real Supabase Storage → `e2e/api/storage.test.mjs`.
8. Dispatch from an explicit rack / bin → T160 §8 + UI e2e.

Additional fix found while building the UI: the per-godown "allow negative
stock" flag could be set by any user with `godowns.edit`; it is now Owner/Admin
only (migration 0008, T180).
