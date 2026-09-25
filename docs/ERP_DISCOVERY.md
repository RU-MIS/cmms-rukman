# ERP Discovery — Existing Google Sheets System

> Phase 1 deliverable of the Master Development Specification.
> Status: **DRAFT — awaiting user review.** No application code is written until
> the questions at the end of this document are answered.

Related documents:

- [`DATABASE_BLUEPRINT.md`](./DATABASE_BLUEPRINT.md) — proposed PostgreSQL model
- [`TRANSACTION_FLOWS.md`](./TRANSACTION_FLOWS.md) — step-by-step flows with stock / ledger / accounting effect
- [`INSTANCE_ARCHITECTURE.md`](./INSTANCE_ARCHITECTURE.md) — standalone-clone and white-label architecture

---

## 1. What was analysed

Seven Google Sheets workbooks were exported to `.xlsx` and analysed cell-by-cell
(values **and** formulas, data validations, hidden sheets, cross-workbook
`IMPORTRANGE` links).

| # | Workbook | Tabs | Main purpose (as discovered) |
|---|----------|------|------------------------------|
| W1 | `NEW-SALE_PO_SHEET` | 13 (1 hidden) | Job-work (karigar) POs and FG receiving, FG stock per godown, D-Mart sale POs and dispatch, debit notes to karigars, barcode stock |
| W2 | `RAW_MATERIAL_SHEET` | 11 (1 hidden) | Raw-material (RM) purchase receiving, RM issue ("sale") to karigars, RM stock per godown/cutting unit, RM stock shifting |
| W3 | `NEW - LEDGER & PAYMENT` | 9 | Daily payment book (cash / bank / adjust / entry), bank ledger, party payable ledger, party receivable ledger, opening balances, FG item movement report |
| W4 | `PO_PAYMENT_RECEIVE_SHEET` | 20 | D-Mart tax-invoice receivable tracker (bill, TDS, received, short amount, debit note) with one tab per month |
| W5 | `PLANNING_SHEET` | 2 | Dispatch planning: pending D-Mart PO boxes per DC and delivery window |
| W6 | `NEW - FACTORY ORDERS` | 5 | **Own factory** production lots (`GT01`…`GT27`), lot-wise FG receipts, lot pending/completed status |
| W7 | `FACTORY PAYMENT` | 11 | **Factory payment book**: worker wages (bottom/upper/finish men, salaries), factory daily expenses, cash purchases, cartage; factory cash accounts `PAPA FACTORT`, `GAGAN CASH`, `PAPA BANK`, `CURRENT ICICI BANK` |

Data period covered: **FY 2025-26 (April 2025) → 22-Sep-2026**. The financial
year runs **April → March** (invoice series `T/25-26/…`, `T/26-27/…`).

### 1.1 Workbooks referenced by formulas

The formulas pull data from other Google Sheets via `IMPORTRANGE`. Status after
the second upload (W6, W7):

| Spreadsheet ID (prefix) | Tabs referenced | Used by | What it appears to be |
|---|---|---|---|
| `1JLgeYB2…` | `REC ENTRY` (DATE, FROM, TO, LOT NO., ITEM, BOX, QTY), `TOTAL ENTRY` (LOT, ITEM, BOX, QTY, REC QTY, BAL QTY, BAL BOX, STATUS = `PENDING` / `LOT ORDER COMPLETED`) | W1 `STOCK IN GODOWN`, `Item WISE STOCK`; W2 `SALE INV DATA`; W3 `ITEM WISE OUT-IN` | ✅ **Provided as W6** (`NEW - FACTORY ORDERS`, tabs and columns match). Please confirm the ID (Q-02). |
| `1yD_9rGi…` | `TOTAL ENTRY!B2:L` | W2 `STOCK SHIFTING ENTRY` | Probably W6 or an older copy (currently `#REF!`, not needed if W6 is the live file). |
| `1MHDJbPA…` | `DAILY PAYMENT ENTRIES!B2:G` filtered on `CURRENT ICICI BANK` | W3 `DAILY PAYMENT ENTRIES` (columns J:O) | ✅ **Very likely W7** (`FACTORY PAYMENT`) — same tab and columns, 174 `CURRENT ICICI BANK` rows, and W7 imports W3 back. An Apps Script `syncDailyPayments` (W7 `ERROR LOG`) syncs the two books. Confirm (Q-02, Q-42). |
| `1DQcmPBe…` | `SALE DATA!A3:J` | W3 `PO DETAILS` (currently `#REF!`) | ❌ **Still missing** — possibly the sale-invoice (tax invoice) register. Currently `#REF!` in both W3 and W7, so it may be obsolete (Q-02). |

Links to IDs `1gc_qxs4…` (= W1), `1hzpZbFN…` (= W2), `1-G6z4kx…`, `1FrRH4Er…`,
`1kMNXnWj…` resolve to workbooks already supplied or to themselves.

Apps Script is **not** included in an `.xlsx` export. Several tabs have
`SUBMIT` / `SUBMIT RECEIVING` / `SHARE AND SUBMIT` / `SHARE TO DEEPAK` buttons,
so a script copies the entry form into the data tab (and likely sends
WhatsApp). The script code is needed to confirm validations that are not
visible in formulas (see Q-01).

---

## 2. The business, as reconstructed from the sheets

> Everything below is derived from formulas and data. Where it is inference,
> it is marked *(inferred)* and repeated as a question in §9.

1. **The company** manufactures footwear (chappals, juttis, sandals — items
   such as `TOE-RING SANDAL-4766`, `SAMOSA-5012`, `PVC BLACK-406`). Every form
   shows **`GAGATOSE`** in the `FROM` field *(inferred: trading/brand name of
   the company; the user domain is Rukman Udyog)*.
2. **Main customer is D-Mart.** Sale POs have 10-digit D-Mart PO numbers
   (`5003103992`) and a **DC location** (BHIWANDI, PUNE, BANGALORE,
   BANGALORE NEW DC, JHAJJAR, ISNAPUR, VADODARA, NAGPUR, KOLHAPUR, PUNJAB,
   INDORE). Payments are received from `D-MART` against tax invoices
   `T/26-27/NNN`, after **TDS** (~0.1 % of bill) and occasional **debit notes /
   GCN** and short payments.
3. **Finished goods (FG) are made two ways:**
   - **Job work (karigar)** — the company raises a **Job-Work PO** numbered
     `GT-NNN` to a karigar (MAJID, PARVEEN, RAFI, ALEEM, NAYAB, …) for one or
     more FG items in pairs/boxes. The karigar delivers FG **in multiple partial
     lots**; each receipt is priced at a **per-pair rate** and becomes a
     **payable** to the karigar.
   - **Own factory** (W6) — the company allots **production lots** (`GT01`…
     `GT27`, each lot = one or more FG items with boxes/pairs) to `FACTORY`
     (the list also has `MUSHIR FACTORY`). The factory delivers each lot in
     **partial receipts** into `B-336` (104 of 105 receipts). Lots carry **no
     rate and no amount** — no payable is created. The factory's costs are
     paid directly from its own payment book (W7): piece-rate/salary payments
     to named workers (`ROFF BOTTOM MAN`, `MUSHIR UPPER MAN`, `AMEEN FINISH
     MAN`, `BUNTY CUTTING MASTER`, `MIRAJ-SALARY` …), `DAILY EXP FACTORY`,
     `FOOD EXP LABUR`, `CASH PURCHASE FACTORY`, `CARTAGE`, `MEDICEN`.
4. **Raw material (RM)** — rexine, sole sheets, EVA, buckles, thread,
   cartons, etc. — is **purchased** from suppliers (CITY, BOBY, JAIN BAJAJ,
   PATTI WALA, …) into RM locations (`RAW MATERIAL`, `OFFICE`, `B-336`, …)
   **without a PO**, with GST %, and becomes a payable to the supplier.
5. **RM is "sold" (issued) to karigars** on a bill numbered `GS-NNN`, at a
   **party-specific rate** (rate table columns DK / NAYAB / PARVEEN / SHIBU /
   OTHER). This creates a **receivable from the karigar** and a stock OUT
   from the RM location. Bills wait in `BEFORE CONFIRMATION` until **Deepak
   approves** them.
6. The karigar's receivable (RM bills) is **set off** against the karigar's
   payable (FG receipts) using payment mode **`ADJUST`**; the rest is paid by
   bank/cash.
7. FG is stored mainly at **`B-336`** (also `WAREHOUSE`, `MANGOLPURI`,
   `GAGATOSE`, `OFFICE`) and **dispatched to D-Mart DCs** line-by-line against
   the D-Mart PO (`STATUS = OK` ⇒ dispatched ⇒ stock OUT).
8. From **15-Jun-2026**, every FG box received at `B-336` consumes one
   **carton** (RM item such as `CB-4841` for `CHADDI BOTTOM-4841`) from the
   `B-336` RM stock.
9. All money movement is written in one **Daily Payment book** — one row per
   entry: date, party, mode (a specific bank, `CASH`, `ADJUST`, `ENTRY`,
   `CHARGES <bank>`), remark, IN amount, OUT amount. Bank-to-bank and
   cash-to-bank transfers, bank charges, GST payments, loan EMIs, household
   withdrawals (`HOME`, `PAPA BANK`) and staff/expense payments all live in
   the same book.

---

## 3. Terminology map (sheet label → real ERP concept)

The sheet labels are **misleading** in several places. The ERP will use the
real concept, and keep the sheet label only as a migration reference.

| Sheet label (where) | Real concept in ERP | Notes |
|---|---|---|
| `PURCHASE PO` / `PURCHASE PO ENTRY` (W1) — header even says "SALE PO" | **Job-Work PO** to karigar | Series `GT-NNN`. Lines: FG item, qty (pairs), box. |
| `PO ENTRY SALE` (W1) | **Job-Work PO pending/received tracker** | Ordered vs received vs pending per PO+party+item. Column A is always the literal `SALE`. |
| `PURCHASE REC` / `PURCHASE REC ENTRY` (W1) | **Job-Work FG Receipt** | Against a GT PO; rate per pair; creates payable. |
| `PURCHASE REC` / `PURCHASE REC DATA` (W2) | **RM Purchase Receipt (direct, no PO)** | Party, receiving location, item, qty, unit, rate, GST %. |
| `SALE INVOICE` / `SALE INV DATA` (W2) | **RM Issue to Job Worker** (billed) | Series `GS-NNN`, "PO No." label is actually the bill no. |
| `BEFORE CONFIRMATION` (W2) | **Draft RM issue awaiting approval** | Column `CHANGES` + `DEEPAK APPROVAL`. |
| `SALE PO` (W1), `Sheet1` (W5) | **Sales Order (D-Mart PO)** | Per DC location, delivery date, dispatch date, dispatch godown, 2 status columns. |
| `DEBIT NOTE` / `DEBIT NOTE ENTRY` (W1) | **FG Return to Job Worker (debit note)** | Series `DNGT - NNN`; stock OUT from godown; reduces payable. |
| `STOCK SHIFTING ENTRY` / `STOCK SHIFTING` (W2) | **Stock Transfer (RM)** | From location → to location. |
| `DAILY PAYMENT` / `DAILY PAYMENT ENTRIES` (W3) | **Cash/Bank/Journal vouchers** | Single-entry book, see §5.6. |
| `BANK TRANSFER` (W3) | **Contra voucher form** | Entry form only (data lands in DAILY PAYMENT ENTRIES). |
| `PURCHASE LEDGER ENTRY` (W3) | **Party payable ledger report** | FG + RM purchases − debit notes − payments. |
| `SALE LEDGER` (W3) | **Party receivable ledger report (RM bills)** | RM issue bills − ADJUST entries. |
| `PAYMENT LEDGER` (W3) | **Bank / cash book report** | Running balance per mode/account. |
| `MAIN SHEET` + monthly tabs (W4) | **Customer (D-Mart) invoice outstanding register** | Bill, TDS, received, less amount, debit note. |
| `FACTORY PO` / `PO ENTRY` (W6) | **Production Order (factory lot allotment)** | Lot no `GT19` / `GT 19`; no rate. |
| `FACTORY REC` / `REC ENTRY` (W6) | **Production Receipt** (FG from own factory) | Partial receipts per lot + item. |
| `TOTAL ENTRY` (W6) | **Production lot pending/completed view** | |
| W7 `DAILY PAYMENT ENTRIES` | **Factory payment vouchers** (wages, expenses) | Payees = workers / expense heads. |
| `PAPA FACTORT` (mode) | **Factory cash account** *(inferred, Q-40)* | Spelling kept as legacy name. |
| `GODWN` / `GODOWN` / `REC IN` / `RECEIVING IN` / `TO (GODOWN)` | **Location (godown)** | Includes true warehouses **and** cutting job-worker locations. |
| `QTY` / `PO Qty` | **Quantity in base unit** (pairs for FG) | |
| `BOX` | **Packing quantity** (FG) | `BOX = QTY ÷ QTY/BOX` of that item. |

---

## 4. Sheet-by-sheet classification

Classification codes: **MASTER · TRANSACTION · TRANSACTION DETAIL · LEDGER ·
CALCULATION · REPORT · LOOKUP · CONFIGURATION · ENTRY FORM** (ENTRY FORM =
a UI screen, not data; it becomes a web form).

### 4.1 W1 — `NEW-SALE_PO_SHEET`

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `PURCHASE PO` | ENTRY FORM + LOOKUP | form rows 1-24; K:L 160 parties; X:AA 4 000 numbers | Job-Work PO entry form (FROM, TO party, DATE, items, qty, box = qty ÷ qty/box, rate, amount). Holds the **job-worker list with mobile numbers** (K:L) and the **PO number series** `GT-501…GT-4496` with DONE/NOT flags (used = number exists in PO ENTRY). | Form → `job_work_orders`; K:L → `parties` + `party_contacts`; X:AA → `document_sequences` |
| `PURCHASE PO ENTRY` | TRANSACTION + DETAIL (flat) | 366 lines | One row per PO line: PO no, PO date, party, item, PO qty, box, receiving-on date (rare), rate (rare), amount. | `job_work_orders` + `job_work_order_lines` |
| `PURCHASE REC` | ENTRY FORM + CALCULATION | form rows 1-24 | FG receiving form: FROM party, TO godown (`B-336, OFFICE, WAREHOUSE, MANGOLPURI`), date, items, qty, box, price. Side panel lists **pending PO lines for the selected party** (`PO ENTRY SALE` where status blank) and **last rate** per item for that party. | Form → `job_work_receipts`; pending panel → `v_job_work_pending` |
| `PURCHASE REC ENTRY` | TRANSACTION + DETAIL (flat) | 640 lines | One row per receipt line: PO no, date, party, rec-in godown, item, qty (pairs), box, rate, amount (= qty × rate), GST (always blank). | `job_work_receipts` + `job_work_receipt_lines` + `stock_movements` (JOB_WORK_RECEIPT) |
| `PO ENTRY SALE` | CALCULATION / REPORT | 391 PO lines | Per PO line: received = `SUMIFS(receipts by PO, party, item)`; pending = ordered − received; box pending; status `ALL RECEIVED` if pending = 0, `EXTRA RECEIVED` if received > ordered, else blank (= pending). Last receipt rate & godown by VLOOKUP. | View `v_job_work_order_line_status` |
| `Sheet15` (hidden) | CALCULATION | 640 | Plain copy of `PURCHASE REC ENTRY` (QUERY) used for lookups. | Not migrated |
| `SALE PO` | TRANSACTION + DETAIL (flat) | ~320 lines | D-Mart PO lines: PO no, date, DC location, item, req qty (pairs), box, dispatch date, from godown, status (OK = dispatched), delivery date, status2 (OK = delivered). A few rows flagged `revise` in col L. | `sales_orders`, `sales_order_lines`, `dispatches` |
| `PO TRACKING SHEET` | REPORT | ~108 | (a) dispatched but not yet delivered; (b) not yet dispatched; (c) archived old POs (static values). | Views on sales orders |
| `Item WISE STOCK` | REPORT (planning) | 1 item at a time | For a chosen FG item: stock at WAREHOUSE and B-336, open D-Mart demand, open job-work POs (pending qty), open factory lots, **BAL TO ORDER** = demand − (stock + JW pending + factory pending), cartons in stock vs **BOX REQUIRED**. | Report `rpt_item_planning` |
| `STOCK IN GODOWN` | CALCULATION (stock) + MASTER (FG items) | 21 FG items | FG item master (`ITEM`, `QTY/BOX`, **opening stock per godown**). Stock per godown = opening + receipts (JW + factory) − (dispatched sale PO lines + debit notes). Section X:AE = **carton ("BOX") stock** at B-336: opening + purchased cartons − FG boxes received. AN:AT = factory receipts (IMPORTRANGE); AX:BF = RM purchases (IMPORTRANGE). | FG `items` + `item_packings`; opening → opening `stock_movements`; balances → `v_stock_balance` |
| `BARCODE` | REPORT + CALCULATION | form | Barcode sticker usage: SMALL barcode = 1 per pair received, BIG barcode = 2 per box received, from a chosen start date. | See Q-27 |
| `DEBIT NOTE` | ENTRY FORM + LOOKUP | form; W:Z number series | Debit-note form: FROM party, TO godown, date (=TODAY()), items, qty, box, rate, amount. Number series `DNGT - 101…`. | Form → `job_work_returns` |
| `DEBIT NOTE ENTRY` | TRANSACTION + DETAIL (flat) | 3 lines | Debit note no (blank in data!), date, party, godown, item, qty, box, rate, amount. | `job_work_returns` + lines |

### 4.2 W2 — `RAW_MATERIAL_SHEET`

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `SALE INVOICE` | ENTRY FORM + LOOKUP | form rows 1-24; Q:R item-rate list; Z:AA 1 100 parties+mobile; V:X bill series | RM issue form: FROM (`GAGATOSE`), party, date, godown (`RAW MATERIAL, OFFICE, MUNNA CUTTING, UMER CUTTING, VINOD DOODH, ABHISHEK CUTTING, B-336`), items, qty, unit (from item master), rate (last rate for that party+item), amount = qty × rate. Bill no series `GS-01…GS-1998`; next free = not used in data **or** in BEFORE CONFIRMATION. Buttons `SHARE TO DEEPAK`, `SUBMIT`. | Form → `material_issues` |
| `SALE INV DATA` | TRANSACTION + DETAIL (flat) + LOOKUP | 3 514 lines | Godown, date, party, from, item, qty, unit, rate, amount, **bill no**, **DEEPAK APPROVAL**. Right side: IMPORTRANGE copies of JW receipts (O:W) and factory receipts (AB:AH) plus column **X = carton item mapping** (`CHADDI BOTTOM-4841` → `CB-4841`). | `material_issues` + lines + `stock_movements` (JOB_WORK_ISSUE); X → `item_consumption_rules` |
| `BEFORE CONFIRMATION` | TRANSACTION (draft queue) | 1 | Same columns as SALE INV DATA + `CHANGES`; bills waiting for approval. | `material_issues.status = PENDING_APPROVAL` |
| `Transport Entry` | ENTRY FORM | empty | Twin Sale/Purchase forms with party `GODWN` only. Not used in data. | See Q-28 |
| `STOCK DETAIL` | MASTER (RM items) + CALCULATION + LOOKUP | 309 items | RM item master (`ITEM NAME`, `ITEM TYPE` ∈ RM / REXINE / OTHER / TAX, `UNIT` ∈ MTR, PAIR, PCS, Nos, BOX, PKT, ROLL, DOLLY, CONE, BOTTLE, KGS, LTR). Opening stock per location. Stock per location = opening + purchases + transfers-in − issues − transfers-out. **B-336 OUT = carton consumption since 15-Jun-2026.** X:AE debit-note area; AI:AN **party-specific RM rates** (DK, NAYAB, PARVEEN, SHIBU, OTHER). | `items`, `units`, opening `stock_movements`, `party_item_rates`, `v_stock_balance` |
| `ITEM WISE DATA` | REPORT | 1 item at a time | Stock ledger of one RM item in one location between start/end date: purchases, issues, transfers in/out; plus a small per-item consumption-ratio calculation (AI:AM). | Report `rpt_stock_ledger` |
| `PURCHASE REC` | ENTRY FORM + LOOKUP | form; Q:T 290 party-location-item-rate rows; X:Y item-rate | RM purchase receiving form: FROM party, TO location, date, item, qty, unit, rate (last rate), GST %, amount = qty × rate × (1 + GST/100). | Form → `purchase_receipts` |
| `PURCHASE REC DATA` | TRANSACTION + DETAIL (flat) | 1 378 lines | PO no (blank), date, party, receiving location, item, qty, unit (col labelled BOX), rate, amount, GST %. Includes pseudo-items like `TAX`. | `purchase_receipts` + lines + `stock_movements` (PURCHASE_RECEIPT) |
| `Sheet16` (hidden) | — | empty | — | Not migrated |
| `STOCK SHIFTING ENTRY` | ENTRY FORM | form | From location, to location, date, items, qty, unit. | Form → `stock_transfers` |
| `STOCK SHIFTING` | TRANSACTION + DETAIL (flat) | 14 lines | Date, from, to, item, **unit (col E), qty (col F)** — headers are swapped. All rows RAW MATERIAL → ABHISHEK CUTTING. | `stock_transfers` + lines + `stock_movements` (TRANSFER_OUT / TRANSFER_IN) |

### 4.3 W3 — `NEW - LEDGER & PAYMENT`

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `DAILY PAYMENT` | ENTRY FORM + REPORT | form | Payment entry form (party, date, mode, remark, in, out) + **cash-in-hand today** and **cash IN/OUT today**. | Form → `vouchers`; KPIs → `v_cash_book` |
| `DAILY PAYMENT ENTRIES` | TRANSACTION (single-entry) + CALCULATION | 1 128 rows (B:G) + imported ICICI rows (J:O) | Date, party, mode, remarks, IN amount, OUT amount. S:U = per-party payable and receivable balance. | `vouchers` + `voucher_lines` + `journal_entries` |
| `BANK TRANSFER` | ENTRY FORM | form | Mode of pay, remark, in, out. | Form → contra `vouchers` |
| `PAYMENT LEDGER` | REPORT + LOOKUP + CONFIGURATION | 7 180 | Running-balance book for a selected mode/account (and optional party, date). **AG:AH = list of payment modes + opening balance** (bank accounts, cash, charges accounts, `ENTRY`, `PAPA BANK`, `GAGAN CASH`). M:V = D-Mart bill register (static copy of W4). | `accounts` (cash/bank) + opening journals; report `rpt_cash_bank_book` |
| `PURCHASE LEDGER ENTRY` | REPORT (party ledger) | per party | For one party: opening, purchase lines (JW receipts + RM purchases), debit notes, payments; running balance. AV = **party list**. | Report `rpt_party_ledger` (payable view) |
| `PO DETAILS` | CALCULATION | 638 | Imported copies of JW receipts (K:S) and debit notes (U:AB) for ledger formulas. | Not migrated (source data already mapped) |
| `SALE LEDGER` | REPORT (party ledger) | per party | For one party: opening receivable, RM issue bills (from W2 `Sale inv Data`), ADJUST entries; balance. BF:BG = additional sale openings. | Report `rpt_party_ledger` (receivable view) |
| `OPENING BAL ENTRY` | MASTER (opening balances) + REPORT | 47 parties | Two opening lists as of **27-Apr-2026**: B:C **payable** opening per party, J:K **receivable** opening per party. O:Q = current payable & receivable per party. | Opening `journal_entries`; report `rpt_party_balances` |
| `ITEM WISE OUT-IN` | REPORT | 1 item at a time | FG item stock ledger: JW receipts, stock shifting, debit notes, D-Mart dispatches, factory receipts; current stock WAREHOUSE and B-336. | Report `rpt_stock_ledger` |

### 4.4 W4 — `PO_PAYMENT_RECEIVE_SHEET`

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `MAIN SHEET` | TRANSACTION (register) | 52 (FY25-26 Apr–May) | Place (DC), bill date, bill no (`T/25-26/NNN`, with remarks like `NO T/24-25/01`, `OK`), amount, TDS, amount received, received date, less amount, debit note (`GCN/25-26/007`). Y = DC list. | `sales_invoices` (header data), `receipt_allocations`, `customer_credit_notes` |
| `APRIL` … `MARCH`, `APR-26` … `Oct-26` (19 tabs) | TRANSACTION (register) / REPORT | ≤ 50 each | April is a FILTER view of MAIN SHEET; later months are **typed directly** into the month tab. From Jul-26: `LESS AMOUNT = TDS + received − bill`. | Same as above (one-time migration of each month tab) |

### 4.5 W5 — `PLANNING_SHEET`

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `Sheet1` | TRANSACTION copy | 104 | Copy of pending D-Mart PO lines (IMPORTRANGE of `SALE PO`). | Not migrated (source = `sales_order_lines`) |
| `PLANING SHEET` | REPORT | 8 DC blocks | For up to 8 DCs, a date window each: boxes to deliver per FG item (by delivery date), and total boxes per item. | Report `rpt_dispatch_plan` |

### 4.6 W6 — `NEW - FACTORY ORDERS` (own factory)

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `FACTORY PO` | ENTRY FORM + LOOKUP | form rows 1-23 | Lot allotment form: FROM `GAGATOSE`, TO `FACTORY` / `MUSHIR FACTORY`, date, **lot no** (typed), items, **box** → qty = box × qty/box. Side panel shows lots/boxes already allotted for the chosen item. R:S = FG item + qty/box (IMPORTRANGE of W1 `STOCK IN GODOWN`). | Form → `production_orders` |
| `PO ENTRY` | TRANSACTION + DETAIL (flat) | 50 lines | Date, from, to, lot no, item, box, qty. | `production_orders` + `production_order_lines` |
| `FACTORY REC` | ENTRY FORM | form | Receipt form: FROM factory, TO `WAREHOUSE`/`B-336`, date = TODAY(), items, box → qty. Side panel: **pending lots for the chosen item** (`TOTAL ENTRY` status PENDING) with balance boxes. | Form → `production_receipts` |
| `REC ENTRY` | TRANSACTION + DETAIL (flat) | 105 lines | Date, from, to, lot no, item, box, qty. Q:W = same data re-ordered for W1/W2/W3 imports. | `production_receipts` + lines + `stock_movements` (PRODUCTION_RECEIPT) |
| `TOTAL ENTRY` | CALCULATION / REPORT | 50 lots-lines | Per lot + item: allotted qty, received qty = `SUMIFS(REC ENTRY qty, item, lot)`, balance qty, balance box, status `LOT ORDER COMPLETED` if balance = 0 else `PENDING`. | View `v_production_order_line_status` |

### 4.7 W7 — `FACTORY PAYMENT` (factory payment book)

| Tab | Class | Rows used | What it holds / does | Maps to |
|---|---|---|---|---|
| `DAILY PAYMENT` | ENTRY FORM + REPORT | form | Same payment form as W3; KPIs **cash in hand of `PAPA FACTORT`** and of **`GAGAN CASH`** (from 16-May-2026, + opening), amount in Hindi words. | Form → `vouchers`; KPIs → `fn_cash_bank_book` |
| `DAILY PAYMENT ENTRIES` | TRANSACTION (single-entry) | 703 rows, 16-May → 19-Sep-2026 | Date, party (worker / expense head), mode (`PAPA FACTORT` 339, `CURRENT ICICI BANK` 174, `PAPA BANK` 113, `GAGAN CASH` 77), remark, IN, OUT. `SYNC_KEY` column for the Apps Script sync. | `vouchers` (PAYMENT, mostly expense) |
| `PAYMENT LEDGER` | REPORT + CONFIGURATION | 1 125 | Cash/bank book for a selected mode; merges **W3's** entries (X:AC) with W7's own (AJ:AO). BA:BB = opening: ICICI 258 550.49, PAPA BANK −3 008, **PAPA FACTORT 6 000**, GAGAN CASH 11 300. | `accounts` + opening journals; report |
| `PURCHASE LEDGER ENTRY` | REPORT + LOOKUP | 69 names | Month-wise **paid-amount statement per worker** (no earnings side). Q = list of worker names. | Report `rpt_payee_statement` |
| `OPENING BAL ENTRY`, `SALE LEDGER`, `PO DETAILS` | REPORT (copies of W3) | — | Copied from W3; most formulas are `#REF!`/`#N/A`. | Not migrated |
| `SALE INVOICE DETAIL`, `AUDIT LOG` | — | empty | — | Not migrated |
| `ERROR LOG` | LOG | 1 | `syncDailyPayments` error "Missing Target Header : DATE" (18-Jul-2026). | Evidence of Apps Script sync |
| `Form responses 1` | CONFIGURATION | header only | Google Form "Karigar Name / Mode of Pay / Amount" — unused. | Not migrated |

---

## 5. Business rules extracted (with evidence)

Each rule has an ID so that later code, tests and questions can reference it.

### 5.1 Items, units and packing

- **BR-01** FG quantity is recorded in **pairs**; **box** is derived:
  `BOX = QTY ÷ QTY/BOX(item)` (`STOCK IN GODOWN!N:O`, used in every FG form).
- **BR-02** Pairs per box is **item-specific**: 18 (16 items), 21 (3 items),
  24 (`PATENT V-SHAPE`), 36 (`SAMOSA-5012`). Never global.
- **BR-03** RM items carry a single unit from the item master (MTR, PAIR, PCS,
  Nos, BOX, PKT, ROLL, DOLLY, CONE, BOTTLE, KGS, LTR). No conversion between
  RM units is used anywhere.
- **BR-04** Items are identified **by name only** (no code). The same product
  appears under different spellings in different sheets (see DQ-02).

### 5.2 Job-Work PO and FG receiving

- **BR-10** A Job-Work PO (`GT-NNN`) has one party and **one or more FG
  lines**. The same item may appear once per PO.
- **BR-11** PO numbers come from a pre-generated list; the next free number
  is the first one **not yet present** in `PURCHASE PO ENTRY`. Two ranges are
  visible (`GT-100001…` and `GT-501…GT-4496`); numbers are not chronological
  (GT-991 in Feb-26, GT-1030 in Apr-26, GT-623…GT-729 in Sep-26).
- **BR-12** Received qty per PO line = `SUMIFS(receipt qty, PO no, party,
  item)` — computed from receipts, never typed. ✅ matches spec §16.
- **BR-13** Pending = ordered − received; pending boxes = pending ÷ qty/box.
- **BR-14** Status: `ALL RECEIVED` when pending = 0; `EXTRA RECEIVED` when
  received > ordered; blank otherwise (= open).
- **BR-15** The receiving screen lists only PO lines of **the selected party**
  whose status is blank (open). ✅ matches spec §20. Lines with
  `EXTRA RECEIVED` also disappear.
- **BR-16** **Over-receiving is currently NOT blocked** — 1 line
  (`GT-661 / JUNED JUTI / PATCH JUTI-1076`: ordered 1 296, received 1 350).
  The spec (§21) requires rejection → **Q-04**.
- **BR-17** Receipt rate is **per pair**; the form proposes the **last rate
  used for that party + item**; amount = qty × rate. Receipts with rate 0 /
  blank exist (early data).
- **BR-18** A receipt line always references a PO (0 of 640 lines have no PO).
- **BR-19** Receipt goes into one godown chosen on the form (`B-336` 621 lines,
  `GAGATOSE` 15 lines; list also allows OFFICE, WAREHOUSE, MANGOLPURI).
- **BR-20** A receipt creates a **payable** to the karigar equal to its amount
  (`PURCHASE LEDGER ENTRY` purchase side). No GST is applied.

### 5.3 RM issue to karigar ("Sale invoice")

- **BR-30** Bill no `GS-NNN` from a pre-generated list; next free = not used in
  `SALE INV DATA` **nor** in `BEFORE CONFIRMATION`.
- **BR-31** Rate proposed = last rate for that **party + item** in the chosen
  godown; a separate party-rate table exists (`STOCK DETAIL!AI:AN`, columns
  DK / NAYAB / PARVEEN / SHIBU / OTHER).
- **BR-32** Amount = qty × rate. **No GST** on these bills.
- **BR-33** Stock OUT from the selected godown/location (`STOCK DETAIL`
  OUT columns = `SUMIFS(SALE INV DATA qty, item, godown)`).
- **BR-34** Creates a **receivable** from the party (`SALE LEDGER`).
- **BR-35** Bills pass through `BEFORE CONFIRMATION` and carry a
  `DEEPAK APPROVAL` column → approval workflow (**Q-10**).
- **BR-36** Some bills are issued to party `FACTORY` (own factory) with rate 0.

### 5.4 RM purchase

- **BR-40** RM purchase receiving is **always direct** (PO No. column is blank
  in all 1 378 lines). ✅ matches spec §15 flow B.
- **BR-41** Amount = qty × rate × (1 + GST%/100) — GST is **included in the
  payable** (from row 906 onward some rows use qty × rate only).
- **BR-42** Stock IN into the receiving location.
- **BR-43** Creates a **payable** to the supplier (`PURCHASE LEDGER ENTRY`
  imports `PURCHASE REC DATA`).
- **BR-44** Pseudo-items such as `TAX` (item type TAX, 1 PCS × 11 414) and
  `SAMPLE SOLE` are recorded as purchases (**Q-15**).

### 5.5 Stock

- **BR-50** Stock is **always derived** (opening + IN − OUT) — never typed,
  except opening stock. ✅ matches spec §12.
- **BR-51** FG godowns in formulas: `WAREHOUSE`, `B-336` (+ list values
  `MANGOLPURI`, `OFFICE`, `GAGATOSE`).
- **BR-52** RM locations: `RAW MATERIAL`, `OFFICE`, `B-336`, `VINOD DOODH`,
  `WAREHOUSE`, `CB` and **cutting units** `MUNNA CUTTING`, `UMER CUTTING`,
  `ABHISHEK CUTTING`, `PARMANAND CUTTING` — i.e. material sitting with an
  outside cutter is tracked as a location.
- **BR-53** FG stock IN: JW receipts + factory receipts. FG stock OUT:
  D-Mart PO lines with status `OK` from that godown (full req qty) + debit
  notes from that godown.
- **BR-54** RM stock IN: purchases + transfers in. RM stock OUT: issues +
  transfers out (+ carton consumption at B-336).
- **BR-55** **Carton consumption** (since 15-Jun-2026): RM stock OUT at
  `B-336` for the carton item mapped to the FG item (`SALE INV DATA!X`), qty
  = FG **boxes** received at B-336 from JW **plus** factory receipt **qty**
  (see DQ-04).
- **BR-56** Negative stock is **not blocked** (see DQ-01).

### 5.6 Payments, cash and bank

- **BR-60** One row = one money event: date, party, mode, remark, IN, OUT.
- **BR-61** Modes in use: `CURRENT AXIS BANK` (551), `CASH` (253),
  `ADJUST` (200), `CURRENT ICICI BANK` (49), generic `BANK` (41, early
  data), `ENTRY` (25), `CHARGES CURRENT AXIS BANK` (4). Configured accounts
  also include `CURRENT GAGATOSE 19 BANK`, `CURRENT GAGATOSE 20 BANK`,
  `SAVING INDIAN BANK`, `SAVING AXIS BANK`, `PAPA BANK`, `GAGAN CASH`.
- **BR-62** **Party payable** = opening + FG receipts + RM purchases
  − debit notes − **all OUT amounts for that party** (any mode except
  `CHARGES…`).
- **BR-63** **Party receivable** = opening + RM issue bills − **OUT amounts
  with mode `ADJUST`**.
- **BR-64** ⇒ an `ADJUST` row **reduces both** the payable and the receivable
  of the same party: it is a **set-off** of RM bills against FG bills.
- **BR-65** **Bank transfer** is written as party = destination (or source)
  bank account, mode = the other bank; the bank-book formula flips IN/OUT when
  the selected account is the *party* rather than the *mode*.
- **BR-66** **Cash in hand** = CASH-mode rows, but for parties whose name ends
  in `BANK` (except `PAPA BANK`) IN/OUT are **reversed** (cash withdrawn from a
  bank is written as OUT to the bank party). `PAPA BANK` is treated as a
  normal party.
- **BR-67** Bank charges: mode `CHARGES <bank>` (or party `CHARGES <bank>`);
  excluded from party ledgers, included in the bank book.
- **BR-68** `ENTRY` mode = non-cash adjustment (TDS, interest, rate
  difference, freight "FARME", kitty) → journal voucher.
- **BR-69** Customer receipts from D-Mart name **one or more invoice numbers**
  in the remark (`T/26-27/029 | T/26-27/031`) → receipt allocation.
- **BR-70** Opening balances: payable and receivable per party as of
  **27-Apr-2026**; bank opening in `PAYMENT LEDGER!AH` (AXIS 9 584 972.01,
  ICICI 258 550.49, GAGAN CASH 11 300).

### 5.7 D-Mart sales and receivables

- **BR-80** D-Mart PO line: PO no, date, DC, item, req qty (pairs), box,
  delivery date.
- **BR-81** Dispatch is **per whole line**: setting status `OK` + godown + date
  removes the full req qty from stock (no partial dispatch field).
- **BR-82** Second status `OK` = delivered (from PO TRACKING).
- **BR-83** **The tax invoice (items, rate, GST) is NOT in these sheets.** Only
  the bill number, date, DC and amount are in W4 (**Q-20**).
- **BR-84** Receivable per bill: amount − TDS − received − less amount −
  debit note. TDS ≈ 0.1 % of bill value.
- **BR-85** D-Mart debit notes appear as `GCN/25-26/NNN` references.

### 5.8 Debit note to karigar

- **BR-90** Debit note: party, godown, item, qty, box, rate, amount.
- **BR-91** Stock OUT from that godown (FG) and **reduces the payable**.
- **BR-92** Series `DNGT - NNN`, but the stored rows have **no number**.

### 5.9 Own factory (W6, W7)

- **BR-100** A factory **lot** = lot no + FG item + allotted boxes; qty =
  box × qty/box (item-specific, BR-02). A lot can contain several items
  (e.g. `GT19`: TRANSPARENT-139 and SAMOSA-5012).
- **BR-101** Lot numbers are **typed**, not generated: formats `GT19` and
  `GT 19` both exist, and numbers restart (`GT01`–`GT25` then `GT 01`–`GT 27`)
  → lot no alone is **not unique** (DQ-15, Q-37).
- **BR-102** Received per lot line = `SUMIFS(receipt qty, item, lot)` — derived,
  never typed. Balance = allotted − received; status `LOT ORDER COMPLETED` when
  balance = 0 else `PENDING`. Same pattern as job-work POs (BR-12…14).
- **BR-103** The receipt form lists only **pending lots of the chosen item**
  (= spec §20 pending-list behaviour).
- **BR-104** Over-receipt is not blocked by formula, but none exists in the
  data. 8 lot lines are still pending (e.g. `GT 27 / SAMOSA-5012` 0 of 1 296).
- **BR-105** 4 receipt rows have **no lot** (`MULTI HERITAGE JUTI PLAIN`,
  `ROYAL JUTI PRINT PATAVA`, `THREAD JUTI`, `BLOCK HEEL BUCKLE`) — direct
  factory receipts (Q-41).
- **BR-106** Factory receipt = **stock IN** into the TO godown (W1
  `STOCK IN GODOWN` adds `REC ENTRY` qty for `B-336`/`WAREHOUSE`) and counts
  for carton consumption (BR-55, DQ-04). **No party ledger, no amount.**
- **BR-107** Factory issue of RM: RM bills to party `FACTORY` at rate 0
  (BR-36) — stock OUT only.
- **BR-108** Factory costs are **payments only** (W7): no wage calculation,
  attendance or piece counting exists in the sheets — each row is a paid
  amount to a worker name or expense head. Month-wise "total paid" per worker
  is the only worker report.
- **BR-109** Factory cash accounts: `PAPA FACTORT` (factory cash, opening
  6 000), `GAGAN CASH` (opening 11 300), `PAPA BANK` (opening −3 008),
  `CURRENT ICICI BANK` (opening 258 550.49 — the same ICICI account as W3).
  Cash in hand is computed only from **16-May-2026** onward.

---

## 6. Masters inferred from the sheets

| Master | Source | Count | Notes |
|---|---|---|---|
| Parties (all roles) | `PURCHASE PO!K`, `SALE INVOICE!Z:AA`, `PURCHASE LEDGER ENTRY!AV`, payment book | ~100 active | Job workers, RM suppliers, cutters, D-Mart, transporters, **and expense/personal heads** (`HOME`, `STAFF`, `FACTORY RENT`, `PNB HOME LOAN`, `CAR LONE`, `GST PAYMENT`, `ICICI CRIDET CARD`, `DAILY EXPENSE`). Mobile numbers for some. |
| FG items | `STOCK IN GODOWN!N:O` | 21 | + qty/box, opening stock per godown. |
| RM items | `STOCK DETAIL!B:D` | 309 | + item type, unit, opening per location. |
| Units | RM item master | 12 | See BR-03. |
| Godowns / locations | data validations + formulas | ~14 | See BR-51/52. |
| Bank / cash accounts | `PAYMENT LEDGER!AG:AH` | 11 | + opening balances. |
| DC locations (D-Mart) | `SALE PO!AK`, `MAIN SHEET!Y` | 11 | |
| Party-item rates | `STOCK DETAIL!AI:AN`, last-rate lookups | — | |
| Carton mapping FG → carton RM | `SALE INV DATA!X` | ~20 | |
| Factory workers / expense heads | W7 `DAILY PAYMENT ENTRIES!C`, `PURCHASE LEDGER ENTRY!Q` | 71 | Bottom / upper / finish men, cutting master, salaried staff, expense heads (Q-39). |
| Factories | W6 data validation | 2 | `FACTORY`, `MUSHIR FACTORY` (Q-38). |
| Factory cash accounts | W7 `PAYMENT LEDGER!BA:BB` | 4 | `PAPA FACTORT`, `GAGAN CASH`, `PAPA BANK`, `CURRENT ICICI BANK` (+ openings). |

---

## 7. Data-quality findings (must be resolved before migration)

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| DQ-01 | **Negative stock** exists | FG B-336: `PUNJAB JUTI-1052` −4 053, `ROYAL JUTI PRINT PATAVA` −126. Cartons B-336: `TOE-RING SANDAL-4766` −9 020, `PVC CHINA UPPER-963` −4 420, `PVC BLACK-406` −3 063, `SAMOSA-5012` −1 624. | Opening stock will not reconcile unless corrected. |
| DQ-02 | Same item, different names | FG `PUNJAB JUTI-1052` vs carton `PUNJAB JUTTI NEW-1052`; `2 PVC PATCH-605` vs `2 PATCH PVC-3605`; `3 PVC PATCH-0949` vs `3-RED PATCH PVC-949`; `HB CHAIN-0864` vs `CHAIN HARD BOTTOM-864`; `PATCH JUTI-1076` vs `PATCH JUTTI-1076`. | Need a name → item-code mapping file. |
| DQ-03 | One over-receipt | `GT-661` ordered 1 296, received 1 350. | Conflicts with "reject over-receipt" rule. |
| DQ-04 | Carton consumption mixes units | Formula adds JW **boxes** (col T = BOX) with factory **qty in pairs** (col AH). | Very likely a bug; explains large negative carton stock. |
| DQ-05 | Hard-coded / edited numbers inside formulas | `STOCK IN GODOWN!M4 = 1962`, `STOCK DETAIL!E35 = 141+22.5`, `OPENING BAL ENTRY!C47 = -2222+40`, `SALE LEDGER!BG6 = 556845`. | Must be converted into explicit opening/adjustment entries. |
| DQ-06 | Debit note numbers not stored | `DEBIT NOTE ENTRY!A` blank for all rows. | Numbers must be assigned at migration. |
| DQ-07 | Generic `BANK` mode in 41 early rows | Which bank is unknown. | Needs mapping for bank reconciliation. |
| DQ-08 | Personal / household entries in business book | `HOME` (₹80 lakh in/out on 14-Sep-2026), `PAPA BANK`, `GAGAN CASH`, loans, kitty. | Need owner capital/drawings accounts (Q-30). |
| DQ-09 | Receipt rate blank/0 on early JW receipts | `GT-991` receipts rate 0 → amount 0. | Payable understated for those rows or settled differently (Q-06). |
| DQ-10 | Stock-shifting headers swapped | `STOCK SHIFTING!E` = unit, `F` = qty. | Handle in import script. |
| DQ-11 | Job-Work PO numbers not chronological, two ranges | BR-11. | Keep original numbers as `legacy_doc_no`. |
| DQ-12 | Month tabs typed separately after April | W4 tabs from MAY onward are not formula views. | Import every month tab; de-duplicate by bill no. |
| DQ-13 | `EXTRA RECEIVED` lines disappear from pending, `revise` flags on sale PO | — | Business meaning to confirm (Q-04, Q-22). |
| DQ-14 | Name trailing spaces / case | `RM ` vs `RM`, `upi` vs `UPI`. | Normalise on import. |
| DQ-15 | Factory lot numbers not unique | `GT19` (Mar-26) and `GT 19` (later); `GT01…` and `GT 01…`. Receipts are summed by lot + item over all time. | Two different lots with the same normalised number would merge; import must keep them separate (Q-37). |
| DQ-16 | Factory receipts without lot | 4 rows (BR-105). | Need a rule for lot-less receipts. |
| DQ-17 | Two payment books share accounts | ICICI bank and `PAPA BANK` rows exist in both W3 and W7, synced by script. | Import must de-duplicate so the bank balance is not counted twice (Q-42). |
| DQ-18 | Worker names inconsistent | `SOHEAL BOTTOM Man`, `ROHIT NEW BOOTOM MAN`, `VIJAY  SALARY` (double space), `REKHA SALERY`. | Normalise on import. |

---

## 8. Mapping summary: sheet workflow → PostgreSQL

| Workflow | Today (sheet) | ERP table(s) | Posting function | Detailed in |
|---|---|---|---|---|
| Job-Work PO | `PURCHASE PO` → `PURCHASE PO ENTRY` | `job_work_orders`, `job_work_order_lines` | `fn_job_work_order_confirm` | TRANSACTION_FLOWS §4 |
| JW FG receipt (partial) | `PURCHASE REC` → `PURCHASE REC ENTRY` | `job_work_receipts`, `…_lines`, `stock_movements`, `journal_entries` | `fn_job_work_receipt_post` | §5, §6 |
| Factory lot allotment | W6 `FACTORY PO` → `PO ENTRY` | `production_orders`, `production_order_lines` | `fn_production_order_confirm` | §7 |
| Factory lot receipt (partial) | W6 `FACTORY REC` → `REC ENTRY` | `production_receipts`, `…_lines`, `stock_movements` | `fn_production_receipt_post` | §7 |
| Factory wages & expenses | W7 `DAILY PAYMENT ENTRIES` | `vouchers` (PAYMENT), `journal_entries` | `fn_voucher_post` | §15 |
| RM issue to JW | `SALE INVOICE` → `BEFORE CONFIRMATION` → `SALE INV DATA` | `material_issues`, `…_lines`, `stock_movements`, `journal_entries` | `fn_material_issue_approve_post` | §8 |
| FG return / debit note to JW | `DEBIT NOTE` → `DEBIT NOTE ENTRY` | `job_work_returns`, `…_lines`, `stock_movements`, `journal_entries` | `fn_job_work_return_post` | §9 |
| RM purchase (direct) | `PURCHASE REC` (W2) → `PURCHASE REC DATA` | `purchase_receipts`, `…_lines`, `stock_movements`, `journal_entries` | `fn_purchase_receipt_post` | §3 |
| RM stock transfer | `STOCK SHIFTING ENTRY` → `STOCK SHIFTING` | `stock_transfers`, `…_lines`, `stock_movements` | `fn_stock_transfer_post` | §10 |
| Carton consumption | formula only | `stock_movements` (CONSUMPTION) | inside `fn_job_work_receipt_post` (if confirmed) | §6.4 |
| D-Mart PO | `SALE PO` | `sales_orders`, `sales_order_lines` | `fn_sales_order_confirm` | §2 |
| D-Mart dispatch | `SALE PO` status OK | `dispatches`, `dispatch_lines`, `stock_movements` | `fn_dispatch_post` | §2 |
| D-Mart tax invoice | outside the sheets | `sales_invoices`, `…_lines`, `journal_entries` | `fn_sales_invoice_post` | §2 |
| D-Mart receipt (TDS, GCN) | payment book + W4 | `vouchers`, `receipt_allocations`, `journal_entries` | `fn_voucher_post` | §11 |
| Vendor/JW payment | payment book | `vouchers`, `journal_entries` | `fn_voucher_post` | §12 |
| ADJUST set-off | payment book `ADJUST` | journal voucher | `fn_voucher_post` | §13 |
| Cash/bank transfer | payment book / `BANK TRANSFER` | contra voucher | `fn_voucher_post` | §14 |
| Bank charges, ENTRY | payment book | payment / journal voucher | `fn_voucher_post` | §15 |
| Opening balances | `OPENING BAL ENTRY`, `PAYMENT LEDGER!AH`, opening stock columns | opening `journal_entries`, opening `stock_movements` | migration scripts | §16 |
| All ledgers, stock reports, planning | report tabs | SQL views / RPC reports | — | DATABASE_BLUEPRINT §9 |

---

## 9. QUESTIONS_REQUIRING_USER_CONFIRMATION

Please answer in any form (Hindi/English, voice note transcribed, one line
each). IDs are referenced from the other documents. **Items marked 🔴 block
the database design; 🟡 block a specific module; 🟢 can be decided later.**

### A. Missing inputs

- 🔴 **Q-01** Please share the **Apps Script** code of each workbook
  (Extensions → Apps Script → copy all files). It contains the SUBMIT logic and
  possibly validations not visible in formulas.
- 🟡 **Q-02** ✅ FACTORY sheet (W6) and factory payment book (W7) received.
  Please confirm W6 is the sheet `1JLgeYB2…` and W7 is `1MHDJbPA…` (open the
  file → the ID is in the browser URL). Still missing: whatever holds
  `SALE DATA` (`1DQcmPBe…`) — or confirm it is no longer used.
- 🔴 **Q-03** Where are the **D-Mart tax invoices** (`T/26-27/NNN`) created
  today — Tally, Busy, Vyapar, a GST portal, another sheet? Should the new ERP
  **create** these invoices (with GST, HSN, e-way bill) or only **record** them?

### B. Job work (karigar)

- 🔴 **Q-04** Over-receipt: sheets allow `EXTRA RECEIVED` (GT-661). The spec
  says reject. Confirm: **reject always**, or allow up to a tolerance % with
  approval?
- 🟡 **Q-05** Can a PO line be **short-closed** (karigar will never send the
  rest)? Today such lines stay pending forever.
- 🟡 **Q-06** Early receipts have rate 0 (e.g. GT-991). Was the karigar paid
  some other way for these? What should the ERP do when the rate is unknown —
  block, or allow 0 with a later rate-revision entry?
- 🟡 **Q-07** Is the job-work rate fixed **on the PO** (PO has a RATE column,
  rarely filled) or decided **at receipt** (last-rate rule)? Can two receipts of
  the same PO line have different rates?
- 🔴 **Q-08** Own factory (W6/W7): the sheets show lots **without rate** and
  factory costs paid directly as wages/expenses (BR-106, BR-108). Confirm:
  the factory is **in-house** (no per-pair payable to "FACTORY"), and its cost
  = wages + expenses + RM issued to it. Is a lot ever closed with a shortfall
  (pending never received)?
- 🟡 **Q-09** Is a **Job-Work PO document (PDF) sent to the karigar** today
  (`SHARE AND SUBMIT` button + mobile number)? WhatsApp or print?

### C. Raw material issue ("sale invoice" to karigar)

- 🔴 **Q-10** Deepak approval: until approval, should the issue **not** affect
  stock and ledger (draft), or is stock already out and only the rate/amount
  awaiting approval?
- 🔴 **Q-11** Accounting nature of RM issue to karigar: is it a real **sale**
  (with GST invoice to the karigar) or an internal **material-issue debit** to
  the karigar's account without GST? (Sheets show no GST.)
- 🟡 **Q-12** Party-specific RM rates (DK / NAYAB / PARVEEN / SHIBU / OTHER):
  should the ERP keep a **rate list per party per item** with effective dates,
  or keep "last rate used" only?
- 🔴 **Q-13** Should each karigar have **one combined account** (RM bills debit,
  FG receipts credit — net balance, no ADJUST needed) or **two separate
  accounts** (receivable + payable, settled by ADJUST as today)?
- 🟡 **Q-14** Is material issued to cutting units (`MUNNA / UMER / ABHISHEK /
  PARMANAND CUTTING`) and returned as cut pieces? Or only transferred? Is the
  cutter a party who is paid?

### D. Purchase

- 🟡 **Q-15** Should GST on RM purchases be tracked as **input tax credit**
  separately (Purchase A/C + Input GST A/C) or stay included in cost as today?
  How should pseudo-items like `TAX` and `SAMPLE SOLE` be handled?
- 🟢 **Q-16** Do you want **RM Purchase Orders** at all (spec §15 flow A)? The
  sheets never use them.
- 🟡 **Q-17** Purchase returns to RM suppliers — do they happen? Not in the
  sheets.

### E. Stock

- 🔴 **Q-18** Should the ERP **block negative stock** (recommended) or warn only?
  If block: the current negatives (DQ-01) must be fixed by an opening
  adjustment first.
- 🔴 **Q-19** Carton rule (BR-55): confirm **1 carton per FG box received at
  B-336**, from which date, and whether the same applies at other godowns and
  to factory receipts. The current formula mixes boxes and pairs (DQ-04).
- 🟢 **Q-27** Barcode stickers: should SMALL (1 per pair) / BIG (2 per box)
  barcode stock be tracked as RM items consumed automatically on receipt, like
  cartons?

### F. Sales (D-Mart)

- 🔴 **Q-20** Is D-Mart the **only** customer? Should DC locations be
  **ship-to addresses of one customer** (recommended) or separate customers?
- 🟡 **Q-21** Can one PO line be dispatched **partially** (e.g. 40 of 94
  boxes now, rest later)? Sheets dispatch whole lines only.
- 🟡 **Q-22** What does `revise` in `SALE PO!L` mean — PO revised by D-Mart
  (qty change / cancellation)?
- 🟡 **Q-23** TDS on D-Mart receipts (~0.1 %): confirm it should be booked to a
  **TDS Receivable** account. What are `LESS AMOUNT` and `GCN` — rate
  difference, shortage, damage? Which expense/income account?
- 🟢 **Q-24** Is one invoice raised per PO, per DC, or per dispatch?

### G. Payments, cash, bank, accounting

- 🔴 **Q-25** Bank accounts list — confirm the real list and which are
  **company** accounts vs **personal/family** (`PAPA BANK`, `GAGAN CASH`,
  `SAVING INDIAN BANK`?).
- 🔴 **Q-26** Generic mode `BANK` in 41 early rows — which bank was it?
- 🔴 **Q-29** `ENTRY` mode meaning (TDS by BOBY, "FARME", interest, kitty,
  `31/07 TAK OK` with 0 amount) — confirm it is a **non-cash journal**. Which
  accounts do the common remarks map to?
- 🔴 **Q-30** `HOME`, `PAPA BANK`, `ROHIT SABARWAL`, loans (`PNB HOME LOAN`,
  `CAR LONE`, `GOVINDA AUTO`), kitty — should these be **Capital / Drawings /
  Loan** accounts in the chart of accounts?
- 🔴 **Q-31** Expense heads currently written as parties (`STAFF`,
  `FACTORY RENT`, `DAILY EXPENSE`, `PORTER`, `ICE DASTI`, `CANRA BANK RENT`,
  `GST PAYMENT`) — confirm they become **expense / tax accounts**, not parties.
- 🔴 **Q-32** Do you already have a **Chart of Accounts** (e.g. in Tally)? If
  yes, please share it so ledger names match your CA's books.
- 🟡 **Q-33** Is **full double-entry** (trial balance, P&L, balance sheet)
  required in phase 1, or are party ledgers + cash/bank book enough initially?
  (Spec says double-entry; the sheets are single-entry.)

### H. Company & instance

- 🔴 **Q-34** Legal company name, GSTIN, address, and relation to
  `GAGATOSE` (brand? second firm?). Are `CURRENT GAGATOSE 19 / 20 BANK`
  accounts of a **different legal entity** (would need multi-company)?
- 🟢 **Q-35** Existing code in this repository (BusinessFlow ERP:
  Express + Prisma + MySQL) — may it be **replaced** by the new Supabase/Next.js
  implementation (kept in git history), or must parts be reused?
- 🟢 **Q-28** `Transport Entry` tab is empty — is transport/freight billing a
  required module?
- 🟢 **Q-36** Users and roles: who enters data today (names/roles), and who
  approves (Deepak = approver for RM issues)?

### I. Own factory (added after W6 / W7)

- 🔴 **Q-37** Lot numbering: are `GT19` and `GT 19` the **same lot** or a new
  cycle? Should the ERP generate lot numbers (e.g. `LOT-2026-0001`) and keep
  the old ones as reference, or must the typed `GT NN` format stay?
- 🟡 **Q-38** `MUSHIR FACTORY` (in the TO list, never used in data) — a second
  own factory, or an outside party? (A worker `MUSHIR UPPER MAN` is paid from
  W7.)
- 🔴 **Q-39** Factory workers: the spec excludes HRMS/payroll. Proposal: keep
  each worker as a **payee** (party role `WORKER`) so "total paid per worker
  per month" still works, and book payments to expense accounts (Factory
  Wages – Bottom / Upper / Finish / Cutting, Salary). No attendance, no wage
  calculation. OK? Or should piece-rate **earnings** (pairs made × rate) also
  be recorded, so a worker balance (earned − paid) exists?
- 🟡 **Q-40** `PAPA FACTORT` = factory petty-cash box? `GAGAN CASH` = cash held
  by Gagan? `PAPA BANK` = a family bank account? Are they **company**
  accounts (in the balance sheet) or owner's personal accounts?
- 🟡 **Q-41** Factory receipts without a lot (BR-105): allowed in the ERP
  (direct production receipt), or must every receipt reference a lot?
- 🔴 **Q-42** W3 and W7 both contain ICICI / PAPA BANK rows, synced by Apps
  Script. Which book is the **master** for which account, so that migration
  imports every entry exactly once?
