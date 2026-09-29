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
| PostgreSQL schema & posting functions (`supabase/migrations`) | 🚧 in progress |
| Web application (Next.js) | ⏳ not started |

## Stack

- PostgreSQL (Supabase) — schema, RLS, posting functions (all business rules)
- Supabase Auth + Storage
- Next.js + TypeScript + Tailwind (to come), hosted free on Cloudflare Pages

## Database — local development

Requirements: PostgreSQL 15+ client tools (`psql`) and a local PostgreSQL
server **or** the Supabase CLI (Docker).

```bash
cp .env.example .env.local        # fill in values
npm run db:test                   # creates a throw-away DB, applies all migrations, runs SQL tests
```

`db:test` never touches a remote database. See `docs/TESTING.md`.

The previous "BusinessFlow ERP" code (Express/Prisma/MySQL) was removed on
purpose (decision Q-35); it remains available in git history.
