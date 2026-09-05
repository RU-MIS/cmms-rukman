# Automated test suite

Run with:

```bash
cd backend
npm test
```

This runs Jest + Supertest against the real Express `app` exported from
`src/server.ts` (no separate process/port needed) and a dedicated MySQL
test database — resolved from `TEST_DATABASE_URL` if set, otherwise derived
from your `DATABASE_URL` by appending `_jest_test` to the database name
(always appended, even if your `DATABASE_URL` already ends in `_test`), so
`npm test` can never resolve to the same database you point `DATABASE_URL`
at for everyday development — which matters because `globalSetup.ts`
drops that database on every run.

`globalSetup.ts` drops and recreates that test database and runs
`prisma migrate deploy` against it before any test runs, so every run
starts from a known-clean schema — the same command used in production.

## What's covered

- **Login and authentication** (`auth.test.ts`) — correct/incorrect
  credentials, unauthenticated access is rejected, `/auth/me`, and the
  first-login forced password-change flow (blocks every other route with
  428 until the password is changed).
- **Company isolation** (`isolation.test.ts`) — one company's data never
  appears in another's list or single-record endpoints, a cross-tenant
  foreign-key reference (e.g. one company's unit id used in another
  company's product) is rejected, switching to a company you don't belong
  to is rejected (403), and switching to one you do belong to works.
- **Make a Copy** (`makeACopy.test.ts`) — cloning a company copies its
  settings/accounts but never its customers or transactions, and cloning
  from a company you don't belong to silently clones nothing.
- **Independent document numbering** (`documentNumbering.test.ts`) — a
  brand-new company's invoice/bill/payment numbering starts at `000001`
  regardless of how many documents other companies have created.
- **GSTIN validation and normalization** (`gstin.test.ts`) — format
  validation, normalization (trim + uppercase) on create, GSTIN being
  optional, and the GST lookup API's honest "not configured" response
  (503, no fake data).

## Adding a test

Use `tests/helpers.ts` — `bootstrapCompany()` creates a company + Admin
user directly (the same helpers `prisma/seed.ts` uses), and `loginAs()`
logs in through the real `/api/auth/login` endpoint to get a token. Give
each company/username a `uniqueSuffix()` so tests can share one database
safely.
