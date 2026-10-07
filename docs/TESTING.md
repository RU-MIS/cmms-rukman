# Testing

All business rules live in PostgreSQL (posting functions, constraints, RLS),
so they are tested directly in the database.

## Run

```bash
# needs a LOCAL PostgreSQL 15+ server and psql (Supabase local via Docker also works)
PGHOST=localhost PGUSER=postgres npm run db:test
```

`scripts/db/test-local.sh`:

1. drops and creates the throw-away database `rukman_erp_test` (refuses any
   non-local host);
2. applies `scripts/db/local-supabase-shim.sql` — a stand-in for what Supabase
   provides (`auth.users`, `auth.uid()`, roles `anon`/`authenticated`/
   `service_role`). **Never** applied to a real project;
3. applies every file in `supabase/migrations/` in order, then the system seed;
4. loads `scripts/db/test-helpers.sql` (`test.fixture`, `test.login`,
   `test.eq`, `test.ok`, `test.throws`);
5. runs every `supabase/tests/*.sql` (each wrapped in `BEGIN … ROLLBACK`) and
   `supabase/tests/*.sh` (real parallel sessions).

Tests act as real users: `test.login(user)` sets the JWT claims and switches
to the `authenticated` role, so RLS and permissions are exercised exactly as
through the Supabase API.

## What is covered

| File | Spec § / decision | Covers |
|---|---|---|
| `010_job_work_partial_receipt.sql` | §19, §21, §51, Q-04…Q-07 | GT-610 example: 500 box → 140 / 100 / 260 → pending 0, FULLY_RECEIVED, line leaves pending list, 4th receipt rejected; over-receipt rejected; PO qty edit (up; not below received); stock IN; carton consumption; karigar payable; zero-rate receipt; cancel re-opens pending; permissions; immutable ledgers |
| `020_material_issue_approval_adjust.sql` | Q-10…Q-13, Q-18, Q-36 | maker–checker, approver corrects qty, no stock before approval, maker ≠ checker, reject; last-rate suggestion; receivable/payable sub-ledgers; ADJUST; negative stock WARN vs BLOCK |
| `030_production_lots_workers.sql` | Q-19, Q-37, Q-39, Q-41, Q-42 | lot numbers "GT NN", pending lots per item, partial lot receipts, lot mandatory, factory carton consumption, no ledger for own factory, worker earnings − payments = balance, factory book |
| `040_purchase_sales_payments_accounts.sql` | §14–16, §26–30, Q-14…Q-17, Q-21…Q-24 | RM PO partial receiving, GST input credit, direct purchase, return, cutting bill; sales order, partial dispatch, date revision; Tally bill with links; receipt with TDS / less amount (sheet register row); partial payment; allocated bill cannot be cancelled; contra; expense payment; trial balance, P&L, balance sheet, day book |
| `050_company_isolation.sql` | §52, Q-34 | company A users cannot read or write company B data (parties, orders, stock, godowns, ledgers, users, reports), cannot reference B masters; per-company numbering; anonymous has no access |
| `060_concurrency.sh` | §44, §50 | two users receive the same PO line at once → one posted, one rejected; 10 parallel confirmations → 10 distinct numbers |
| `070_numbering.sql` | §44, Q-37 | patterns, padding (no truncation), FY reset, admin-changed lot format |

Two real defects were found by these tests and fixed before commit: a
deadlock when two users post against the same PO line (FK share lock vs.
`FOR UPDATE`, now `FOR NO KEY UPDATE`) and numbers longer than the padding
being truncated (`GT-10` → `GT-1`).

## Instance isolation

Isolation between **instances** comes from separate Supabase projects; it is
checked on a real instance with `npm run instance:verify` (fingerprint,
RLS on every table, no anonymous privileges).

## Inventory + portals MVP

* SQL: `supabase/tests/100…180` (+ parallel-session tests `060_concurrency.sh`, `170_concurrent_reservation.sh`) — `npm run db:test`.
* API / Storage / email worker against the local Supabase stack — `npm run test:e2e:api`.
* Browser (Playwright, Chromium) against the static build — `npm run test:e2e:ui`.
* Details and the mapping to the 33 required test cases: `docs/INVENTORY_MODULE.md` §16 and
  `docs/INVENTORY_REQUIREMENTS_CHECKLIST.md`.
