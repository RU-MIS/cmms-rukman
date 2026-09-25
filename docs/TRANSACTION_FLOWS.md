# Transaction Flows

> Phase 2 deliverable. Status: **DRAFT — awaiting user review.**
>
> Every flow lists: how it works in the sheets today, the ERP steps,
> validations, **stock effect**, **party-ledger effect**, **accounting
> effect**, the atomic posting function, and cancellation.
>
> **Accounting lines marked "PROPOSED" are not taken from the sheets** (the
> sheets are single-entry). They follow the default patterns in the Master
> Specification §28 and are **not final** until the linked question in
> [`ERP_DISCOVERY.md` §9](./ERP_DISCOVERY.md#9-questions_requiring_user_confirmation)
> is answered. Nothing will be implemented against a PROPOSED line without
> confirmation.

Conventions: `qty` = what the user types; `base_qty` = quantity in the item's
base unit (PAIR for FG) using the item-specific packing factor. `Dr` / `Cr` =
debit / credit. `[party]` means the journal line carries `party_id`, so it
appears in that party's ledger.

---

## 0. Big picture

```
 RM SUPPLIERS ──(RM purchase, §3)──► RM GODOWNS ──(stock transfer, §10)──► CUTTING UNITS
                                        │
                              (RM issue "GS bill", §8)
                                        ▼
                                  KARIGAR / JOB WORKER ◄──(Job-Work PO "GT", §4)
                                        │
                        (FG receipt, partial, §5–6) (debit note return, §9)
                                        ▼
 OWN FACTORY ──(lot receipt, §7)──► FG GODOWNS (B-336, WAREHOUSE…) ──(dispatch, §2)──► D-MART DCs
                                                                                     │
                                                        (tax invoice T/.., §2)       │
 BANK / CASH ◄──(customer receipt, TDS, GCN, §11)───────────────────────────────────┘
      │
      ├──(payment to karigar / supplier, §12)      ├──(ADJUST set-off, §13)
      └──(cash↔bank, bank↔bank transfer, §14)      └──(charges, ENTRY journal, §15)
```

---

## 1. Posting lifecycle (applies to every document)

```
DRAFT ──submit──► PENDING_APPROVAL ──approve──► POSTED ──cancel──► CANCELLED
  │                    (only where approval is configured)      (reversal rows)
  └──────────────── post (no approval) ─────────────►
```

- DRAFT: editable, **no** stock/ledger effect, no final number (optional
  temporary number).
- POSTED: document number assigned by `fn_next_doc_no` inside the posting
  transaction; stock movements + journal written; document is immutable.
- CANCELLED: posting function writes reversing stock movements and a
  reversing journal entry dated the cancellation date (configurable per
  company); original rows stay (spec §33).
- Corrections to a posted document = cancel + re-enter, or an explicit
  adjustment document.

---

## 2. Sales — D-Mart PO → Dispatch → Tax Invoice

**Today:** `SALE PO` rows (PO no, DC, item, req qty, box, delivery date).
Status `OK` + godown + dispatch date ⇒ full line leaves stock. Invoice is
made outside the sheets (Q-03). Receivable tracked in W4.

### 2.1 Sales Order (D-Mart PO)
| Step | Detail |
|---|---|
| Entities | `sales_orders` (party = D-Mart, ship-to = DC, customer PO no, delivery date), `sales_order_lines` |
| Validation | customer PO no unique per customer; item active; qty > 0 |
| Stock / ledger / accounting | **none** |
| Function | `fn_sales_order_confirm` |

### 2.2 Dispatch
| Step | Detail |
|---|---|
| Entities | `dispatches`, `dispatch_lines` (→ order line) |
| Validation | dispatch base_qty ≤ order line pending (Q-21 — whole line or partial); stock available in godown (Q-18) |
| **Stock** | `SALE_ISSUE` OUT from dispatch godown, per line |
| Order status | pending = 0 on all lines ⇒ `DISPATCHED`; delivered date set ⇒ `DELIVERED` (sheet status 2) |
| Ledger / accounting | none at dispatch (revenue at invoice) — **PROPOSED**, see Q-24 |
| Function | `fn_dispatch_post` |

### 2.3 Tax Invoice (spec §14 atomic unit)
| Step | Detail |
|---|---|
| Entities | `sales_invoices`, `sales_invoice_lines` (from dispatch lines when linked) |
| Validation | GST by place of supply; invoice series `T/{FY}/NNN`; dispatch not already invoiced |
| **Stock** | none if dispatch already posted; if invoice is created **without** a dispatch (direct invoice), the same function writes `SALE_ISSUE` movements |
| **Party ledger** | D-Mart debit = invoice total |
| **Accounting (PROPOSED — Q-03)** | `Sundry Debtors [D-Mart] Dr` total / `Sales – FG Cr` taxable / `Output CGST+SGST or IGST Cr` tax / `Round Off Dr/Cr` |
| Function | `fn_sales_invoice_post` — invoice + lines + (stock) + journal in one transaction |

### 2.4 Sale return / credit note
`sales_returns` → `SALE_RETURN` stock IN; `customer_credit_notes` → reverse of
2.3 (Sales Dr, Output GST Dr, Debtors Cr). D-Mart GCN without goods: see §11.

---

## 3. Purchase — RM (direct receiving, optional PO)

**Today:** `PURCHASE REC` form (W2) → `PURCHASE REC DATA`. Never uses a PO.
Amount = qty × rate × (1 + GST%). Payable to supplier.

### 3.1 Flow B — Direct Purchase Receiving (current practice)
| Step | Detail |
|---|---|
| Entities | `purchase_receipts` (party, godown, supplier bill no/date), lines (item, qty, unit, base_qty, rate, gst_rate) |
| Validation | party role SUPPLIER (or any party — Q-15); item stock-tracked or service (`TAX` pseudo-item) |
| **Stock** | `PURCHASE_RECEIPT` IN into receiving godown (stock-tracked items only) |
| **Party ledger** | supplier credit = bill total (incl. GST, as today) |
| **Accounting (PROPOSED — Q-15)** | Option 1 (as today, GST in cost): `Purchase – RM Dr` total / `Sundry Creditors [supplier] Cr` total. Option 2 (ITC): `Purchase – RM Dr` taxable + `Input GST Dr` tax / `Sundry Creditors [supplier] Cr` total |
| Function | `fn_purchase_receipt_post` |

### 3.2 Flow A — PO → Receiving (only if Q-16 = yes)
`purchase_orders` confirmed (no effect) → each receipt line references
`po_line_id`; pending = ordered − Σ received; same partial-receipt rules as
job work (§6). PO status PARTIALLY_RECEIVED / FULLY_RECEIVED derived.

### 3.3 Purchase return (Q-17)
`PURCHASE_RETURN` stock OUT; `Sundry Creditors [supplier] Dr` / `Purchase – RM Cr` (PROPOSED).

---

## 4. Factory / Job-Work PO

**Today:** `PURCHASE PO` form → `PURCHASE PO ENTRY` (one row per PO line),
PO number `GT-NNN` = first unused number in a pre-generated list. PDF/WhatsApp
share to karigar (Q-09).

| Step | Detail |
|---|---|
| Entities | `job_work_orders` (party = karigar, lot no, date, default godown), `job_work_order_lines` (FG item, qty, unit PAIR or BOX, base_qty, optional rate) |
| UI | Karigar ▼, Date, Lot, lines: Item ▼, Qty [pairs] ⇄ Box (auto via item packing), Rate |
| Validation | party has role JOB_WORKER; ≥ 1 line; each item once per PO (BR-10); qty > 0 |
| **Stock** | none |
| **Ledger / accounting** | none (a PO is a commitment, not a liability) |
| Status | `OPEN` after confirmation |
| Numbering | `fn_next_doc_no('JOB_WORK_ORDER')` → configurable prefix, e.g. `GT-` (continue after the highest migrated number, DQ-11) |
| Function | `fn_job_work_order_confirm` |
| Cancel | allowed only while no receipt is posted; otherwise **short-close** remaining qty (Q-05) |

---

## 5. Factory FG Receipt (Job-Work Receipt)

**Today:** `PURCHASE REC` form (W1): FROM karigar, TO godown, date; side panel
lists that karigar's open PO lines (status blank) with balance qty/box; rate =
last rate for karigar + item; SUBMIT appends to `PURCHASE REC ENTRY`.

### 5.1 Screen (spec §21)
```
Factory / Job Worker : [ ALEEM ▼ ]      To Godown : [ B-336 ▼ ]     Date : [ 23-Sep-2026 ]
PO / LOT             : [ GT-610 ▼ ]  (only POs of ALEEM with pending > 0)

PO      LOT    ITEM                   ORDERED  RECEIVED  PENDING   RECEIVE (Box)  = Pairs   RATE/PAIR   AMOUNT
GT-610  GT-04  TOE-RING SANDAL-4766   500 box  140 box   360 box   [ 100 ]        1 800     [ 140 ]     2,52,000
```
Only lines with pending > 0 are shown (`v_job_work_pending`). Receive qty may
be typed in box or pairs; both are displayed.

### 5.2 Posting — `fn_job_work_receipt_post` (one transaction)
1. Check permission `job_work_receipt.create`, period open, godown active.
2. For each line: `SELECT … FROM job_work_order_lines WHERE id = … FOR UPDATE`
   (serialises concurrent receipts of the same line).
3. Compute pending = ordered − Σ posted receipt base_qty − short_closed.
4. **Reject if receive base_qty > pending** (spec §21; tolerance per Q-04).
5. Resolve rate: line rate → party_item_rates (JOB_WORK) → last rate;
   rate required > 0 unless Q-06 says otherwise.
6. Insert receipt header (doc no from sequence) + lines.
7. **Stock:** `JOB_WORK_RECEIPT` IN to selected godown: item, godown, qty,
   unit, base_qty, rate, party, PO, lot, date, user (spec §22).
8. **Carton consumption** (if Q-19 confirmed): for each line with a matching
   `item_consumption_rules` row, `CONSUMPTION` OUT of the carton item from the
   same godown, qty = boxes received × qty_per_unit.
9. **Party ledger:** karigar **credit** = Σ amount (today's
   `PURCHASE LEDGER ENTRY` purchase side).
10. **Accounting (PROPOSED — Q-13):** `Job-Work Charges / Purchase – FG Dr`
    amount / `Sundry Creditors [karigar] Cr` amount.
11. Recompute order status: all lines pending = 0 ⇒ `FULLY_RECEIVED`, some
    received ⇒ `PARTIALLY_RECEIVED`.
12. Audit log row; return receipt id/number.

Any failure (e.g. step 4) raises an exception → **whole transaction rolls
back** — no half-posted receipt.

### 5.3 Cancel
`fn_job_work_receipt_cancel`: blocked if the receipt is already allocated in
a payment (must un-allocate first). Writes reversing movements (+ reverses
carton consumption) and a reversing journal; pending qty on the PO line
increases again automatically because it is derived.

---

## 6. Partial Receipt — worked example (spec §19 / §51)

PO `GT-610`, item `TOE-RING SANDAL-4766`, packing 1 BOX = 18 PAIR
(item-specific), ordered 500 BOX = 9 000 PAIR.

| Event | Receive | Σ received | Pending | PO line in pending list? | PO status | Result |
|---|---|---|---|---|---|---|
| PO confirmed | — | 0 | 500 box | yes | OPEN | — |
| Receipt 1 | 140 box (2 520 pr) | 140 | **360** | yes | PARTIALLY_RECEIVED | posted |
| Receipt 2 | 100 box (1 800 pr) | 240 | **260** | yes | PARTIALLY_RECEIVED | posted |
| Receipt 3 | 260 box (4 680 pr) | 500 | **0** | **no — disappears** | **FULLY_RECEIVED** | posted |
| Receipt 4 | 1 box | 500 | 0 | — | FULLY_RECEIVED | **REJECTED**: "pending is 0" |
| Attempt | 400 box when pending = 360 | — | — | — | — | **REJECTED** |

Multi-line PO (spec §20): pending is per line, so a PO with one pending line
shows only that line. Two users receiving the same line at the same time are
serialised by the row lock in step 5.2-2; the second one sees the reduced
pending and is rejected if it would exceed it. These cases are the mandatory
automated tests listed in spec §50–51.

---

## 7. Own-Factory Lot Receipt (pending Q-02 / Q-08)

**Today:** separate FACTORY workbook (not provided): `REC ENTRY` (date, FROM
`FACTORY`, TO godown, LOT `GT19`, item, box, qty) and `TOTAL ENTRY` (lot
status PENDING / LOT ORDER COMPLETED).

Provisional design: `production_lots` behave like job-work order lines
(ordered vs received vs pending); receipt posts `PRODUCTION_RECEIPT` IN to the
godown. **Ledger/accounting: none until Q-08 is answered** (if the factory is a
paid party, it follows §5 exactly with the factory as the job worker).

---

## 8. Job-Work Material Issue (RM "sale invoice" to karigar)

**Today:** `SALE INVOICE` form (W2): FROM `GAGATOSE`, party, date, godown,
items (unit from master), rate = last rate for party + item, amount = qty ×
rate. Bill `GS-NNN`. Draft goes to `BEFORE CONFIRMATION`; `SHARE TO DEEPAK`;
after approval appended to `SALE INV DATA` with `DEEPAK APPROVAL`.

| Step | Detail |
|---|---|
| Entities | `material_issues` (party, from godown, optional job-work PO link), `material_issue_lines` |
| Workflow | DRAFT → **PENDING_APPROVAL** (share to approver) → APPROVED ⇒ POSTED (Q-10) |
| Validation | stock available in the from-godown (Q-18); rate from `party_item_rates` (ISSUE) with party-specific column (DK/NAYAB/PARVEEN/SHIBU/OTHER) or last rate (Q-12) |
| **Stock** | `JOB_WORK_ISSUE` OUT from the godown, on POST |
| **Party ledger** | karigar **debit** = Σ amount (today's `SALE LEDGER`) |
| **Accounting (PROPOSED — Q-11, Q-13)** | Option A (not a sale, no GST): `Sundry Debtors/Creditors [karigar] Dr` / `Material Issued to Job Workers Cr`. Option B (GST sale): `Sundry Debtors [karigar] Dr` / `Sales – RM Cr` + `Output GST Cr` |
| Function | `fn_material_issue_submit`, `fn_material_issue_approve_post` (approval requires APPROVE permission; approver ≠ creator configurable) |
| Issue to own FACTORY (rate 0) | stock OUT only, no ledger (BR-36) — or a transfer to a FACTORY godown (Q-08) |

---

## 9. Debit Note — FG returned to karigar

**Today:** `DEBIT NOTE` form (W1): FROM party, TO (godown), date, items, qty,
box, rate, amount; series `DNGT - NNN` (numbers not saved, DQ-06). Stock OUT
from godown; reduces payable.

| Step | Detail |
|---|---|
| Entities | `job_work_returns` + lines (optional link to PO) |
| Validation | stock available in godown |
| **Stock** | `JOB_WORK_RETURN` OUT from godown |
| **Party ledger** | karigar **debit** = amount (reduces payable) |
| **Accounting (PROPOSED — Q-13)** | `Sundry Creditors [karigar] Dr` / `Job-Work Charges / Purchase – FG Cr` |
| PO effect | none by default (pending not re-opened) — confirm in Q-05 |
| Function | `fn_job_work_return_post` |

---

## 10. Stock Transfer (Stock Shifting)

**Today:** `STOCK SHIFTING ENTRY` → `STOCK SHIFTING` (all current rows RAW
MATERIAL → ABHISHEK CUTTING).

| Step | Detail |
|---|---|
| Entities | `stock_transfers` (from godown, to godown), lines |
| Validation | from ≠ to; stock available at source |
| **Stock** | `STOCK_TRANSFER_OUT` from source **and** `STOCK_TRANSFER_IN` to destination, same qty, same transaction (spec §34) |
| Ledger / accounting | none (location change only). If goods go to a cutter who is **paid**, the cutting charge is a separate bill (Q-14) |
| Function | `fn_stock_transfer_post` |

---

## 11. Customer Receipt (D-Mart) — with TDS, GCN, short amount

**Today:** payment book row `D-MART`, mode `CURRENT AXIS BANK`, remark
`T/26-27/029 | T/26-27/031`, IN amount. W4 register per bill: amount, TDS,
amount received, less amount, debit note/GCN.

| Step | Detail |
|---|---|
| Entities | `vouchers` (RECEIPT, bank account), `voucher_allocations` per invoice with `amount`, `tds_amount`, `short_amount` |
| Validation | allocation per invoice ≤ outstanding; unallocated remainder = customer advance |
| **Stock** | none |
| **Party ledger** | D-Mart credit = received + TDS + short amount (bill fully settled) |
| **Accounting (PROPOSED — Q-23)** | `Bank [AXIS] Dr` received / `TDS Receivable Dr` TDS / `Rate Difference / Short Receipt Dr` short / `Sundry Debtors [D-Mart] Cr` total |
| Outstanding | `v_bill_outstanding` = invoice − allocations − credit notes (replaces W4) |
| Partial payment | invoice ₹1,00,000, receipt ₹50,000 ⇒ outstanding ₹50,000 (spec §26) |
| Function | `fn_voucher_post` |

---

## 12. Vendor / Karigar Payment

**Today:** payment book row: party, mode = bank or `CASH`, OUT amount.
Reduces party payable (BR-62).

| Step | Detail |
|---|---|
| Entities | `vouchers` (PAYMENT), optional `voucher_allocations` to receipts/purchase bills |
| Validation | cash balance not negative (optional warning); allocation ≤ bill outstanding |
| **Party ledger** | party **debit** = amount |
| **Accounting (from spec §28)** | `Sundry Creditors [party] Dr` / `Bank or Cash Cr` |
| Advance | payment without allocation / exceeding outstanding = vendor advance (debit balance) |
| Function | `fn_voucher_post` |

Payment IN from a karigar (rare, `IN AMNT` on a karigar row) = RECEIPT
voucher: `Bank/Cash Dr` / `[party] Cr`.

---

## 13. ADJUST — set-off of RM bills against FG bills

**Today:** payment book row, mode `ADJUST`, OUT amount (e.g. MAJID 2,95,940).
Reduces the karigar's **payable** (purchase ledger) **and** the karigar's
**receivable** (sale ledger) by the same amount (BR-64).

| Design option (Q-13) | Effect |
|---|---|
| **A. One combined party account (recommended)** | RM issue debits and FG receipts credit the **same** party account, so the net balance is automatic. ADJUST is **not needed**; historical ADJUST rows are migrated as informational only (no journal) and the ledger still reconciles. |
| B. Two accounts per karigar (as today) | ADJUST = JOURNAL voucher: `Sundry Creditors [karigar] Dr` / `Sundry Debtors [karigar] Cr`. No cash/bank effect. |

Stock effect: none. Function: `fn_voucher_post` (JOURNAL).

---

## 14. Cash Transfer and Bank Transfer (Contra)

**Today:** payment book rows where party = one bank/cash account and mode =
the other (e.g. party `CURRENT ICICI BANK`, mode `CURRENT AXIS BANK`, OUT
1,00,000 = AXIS → ICICI). Cash-in-hand formula reverses IN/OUT for bank
parties (BR-65/66). `BANK TRANSFER` form.

| Case | Journal (spec §27) |
|---|---|
| Cash → Bank (deposit) | `Bank Dr` / `Cash Cr` |
| Bank → Cash (withdrawal) | `Cash Dr` / `Bank Cr` |
| Bank A → Bank B | `Bank B Dr` / `Bank A Cr` |

| Step | Detail |
|---|---|
| Entities | `vouchers` (CONTRA) with `from_account_id`, `to_account_id`, amount, instrument |
| Validation | from ≠ to; both are CASH/BANK sub-type accounts; source balance check (warning or block, configurable) |
| Ledger | no party |
| Atomicity | one voucher → one journal with both lines (spec §34) |
| Migration | sheet rows are converted by the rule "party is a bank/cash account ⇒ CONTRA; direction from IN/OUT and the formula in BR-65" and verified against the bank book balances |

Transfers involving `PAPA BANK`, `HOME`, `GAGAN CASH` are **not** contra until
Q-25/Q-30 decide whether those are company accounts or capital/drawings.

---

## 15. Bank Charges and ENTRY (journal) vouchers

| Sheet pattern | ERP voucher | Accounting |
|---|---|---|
| mode `CHARGES CURRENT AXIS BANK` or party `CHARGES …` | PAYMENT, no party | `Bank Charges Dr` / `Bank [AXIS] Cr` |
| `GST PAYMENT` party | PAYMENT, no party | `GST Payable / Electronic Cash Ledger Dr` / `Bank Cr` (PROPOSED — Q-31) |
| `HOME`, `PAPA BANK`, kitty, loans | PAYMENT / RECEIPT | `Drawings / Capital / Loan Dr/Cr` / `Cash or Bank` (PROPOSED — Q-30) |
| `STAFF`, `FACTORY RENT`, `DAILY EXPENSE`, `PORTER`… | PAYMENT, no party | `<Expense account> Dr` / `Cash/Bank Cr` (PROPOSED — Q-31) |
| mode `ENTRY` (TDS by BOBY, "FARME", interest, kitty, rate difference) | JOURNAL | account per remark — mapping table required (Q-29) |

---

## 16. Opening balances (migration)

| Opening | Sheet source | ERP |
|---|---|---|
| FG stock per godown | `STOCK IN GODOWN` B, M, Y columns | `OPENING` stock movements dated go-live − 1 (or original date) |
| RM stock per location | `STOCK DETAIL` E–H | `OPENING` stock movements |
| Party payable | `OPENING BAL ENTRY!B:C` (27-Apr-2026) | opening journal: `Opening Balance Adjustment Dr` / `[party] Cr` (sign-aware) |
| Party receivable | `OPENING BAL ENTRY!J:K`, `SALE LEDGER!BF:BG` | opening journal: `[party] Dr` / `Opening Balance Adjustment Cr` |
| Bank / cash | `PAYMENT LEDGER!AG:AH` | opening journal per account |
| D-Mart open bills | W4 rows with outstanding | `sales_invoices` (header-only, `is_migrated`) + opening journal |

Cut-over approach (to be confirmed in the migration phase): either (a) import
**all** historical transactions from Apr-2026 and verify balances, or (b)
import opening balances at a cut-over date + open documents (pending POs,
open bills). Reconciliation checks (spec §38) are run for both.

---

## 17. Accounting summary (PROPOSED patterns)

| Event | Dr | Cr | Party ledger | Stock | Question |
|---|---|---|---|---|---|
| Sales invoice | Debtors [cust] | Sales, Output GST | cust + | (if direct) OUT | Q-03 |
| Customer receipt | Bank, TDS Recv, Short/Disc | Debtors [cust] | cust − | — | Q-23 |
| RM purchase | Purchase RM (+ Input GST) | Creditors [supp] | supp + (Cr) | IN | Q-15 |
| Vendor payment | Creditors [supp] | Bank/Cash | supp − | — | spec |
| JW FG receipt | Job-Work Charges / Purchase FG | [karigar] | karigar Cr | IN (+ carton OUT) | Q-13 |
| RM issue to karigar | [karigar] | Material Issued / Sales RM | karigar Dr | OUT | Q-11 |
| Debit note to karigar | [karigar] | Job-Work Charges | karigar Dr | OUT | Q-13 |
| ADJUST | Creditors [karigar] | Debtors [karigar] | both | — | Q-13 |
| Cash/Bank contra | Destination | Source | — | — | spec |
| Bank charges | Bank Charges | Bank | — | — | — |
| Stock transfer | — | — | — | OUT + IN | — |
| Stock adjustment | Stock Adj. / Loss (if valued) | … | — | IN/OUT | Q-18 |

Stock is tracked in **quantity** (movement ledger). Inventory **valuation**
(weighted average / FIFO) for the balance sheet is a separate decision in the
Accounting phase (Q-33).

---

## 18. Atomicity checklist (spec §34)

| Business event | Single function | Rows written together |
|---|---|---|
| Sale | `fn_sales_invoice_post` | invoice + lines + (stock OUT) + journal (party line) |
| Purchase | `fn_purchase_receipt_post` | receipt + lines + stock IN + journal (party line) |
| Job-work receipt | `fn_job_work_receipt_post` | receipt + lines + stock IN + carton OUT + journal + PO status |
| Material issue | `fn_material_issue_approve_post` | status + stock OUT + journal |
| Payment / receipt | `fn_voucher_post` | voucher + allocations + journal |
| Stock transfer | `fn_stock_transfer_post` | OUT + IN movements |
| Bank transfer | `fn_voucher_post` (CONTRA) | voucher + 2 journal lines |
| Any cancel | `fn_<doc>_cancel` | status + reversal movements + reversal journal |

All functions run in one PostgreSQL transaction; the deferred
"journal balanced" trigger and CHECK constraints fire before COMMIT, so any
violation rolls everything back.
