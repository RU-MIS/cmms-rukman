# Rukman Dataflow Management System

ERP for job-work / in-house footwear manufacturing, inventory, sales orders,
payments and double-entry accounting — rebuilt from the business logic of the
company's Google Sheets system.

> The product name is **not** hard-coded: it comes from configuration
> (`NEXT_PUBLIC_APP_NAME`). See `docs/INSTANCE_ARCHITECTURE.md`.

## Status

| Phase | State |
|---|---|
| Discovery (`docs/ERP_DISCOVERY.md`, `docs/DATABASE_BLUEPRINT.md`, `docs/TRANSACTION_FLOWS.md`, `docs/INSTANCE_ARCHITECTURE.md`) | ✅ complete |
| PostgreSQL schema, posting functions, RLS, tests (`supabase/migrations`, `supabase/tests`) | ✅ done — `npm run db:test` |
| Inventory + customer/vendor portals + PO + documents + email + payment reminders MVP (`MASTER_BUILD_PROMPT.md`) | ✅ done — see `docs/INVENTORY_MODULE.md`, `docs/INVENTORY_REQUIREMENTS_CHECKLIST.md` |
| Web application (Next.js, `web/`) | ✅ internal ERP screens + customer portal + vendor portal |
| Email worker (`worker/`) | ✅ SMTP sending, PO PDF, retries, daily payment reminders |

## Stack

- PostgreSQL (Supabase) — schema, RLS, posting functions (all business rules)
- Supabase Auth + Storage
- Next.js 16 + TypeScript + Tailwind 4 static app (`web/`), hosted free on Cloudflare Pages
- Email worker (`worker/`, Node + nodemailer + pdf-lib) run by GitHub Actions cron

## Database — local development

Requirements: PostgreSQL 15+ client tools (`psql`) and a local PostgreSQL
server **or** the Supabase CLI (Docker).

```bash
cp .env.example .env.local        # fill in values
npm run db:test                   # creates a throw-away DB, applies all migrations, runs SQL tests
```

`db:test` never touches a remote database. See `docs/TESTING.md`.

## Web app, worker and end-to-end tests

```bash
npm install
npm run lint && npm run typecheck && npm run build     # web + worker checks, static build in web/out
npm run test:worker                                    # worker unit tests
supabase start && supabase db reset                    # local Supabase (Docker)
npm run test:e2e:api                                   # Storage security + email worker against local Supabase
npm run test:e2e:ui                                    # Playwright browser tests of the whole flow
```

Module guide: `docs/INVENTORY_MODULE.md`.

New instance: `docs/INSTANCE_SETUP.md`. Clone for another client: `docs/CLONING.md`.

The previous "BusinessFlow ERP" code (Express/Prisma/MySQL) was removed on
purpose (decision Q-35); it remains available in git history.
