# Cloning the application for a new client

A clone is a **new instance** built from the same source code. Follow
[`INSTANCE_SETUP.md`](./INSTANCE_SETUP.md) completely; this page lists what
must be *different* and how to prove the clone is independent.

## What a clone needs

1. Source code (this repository, same release tag)
2. Database migrations — `supabase/migrations/`
3. System seed — `supabase/seed/system/`
4. `.env.example` → new `.env` values
5. Hosting configuration (Cloudflare Pages project with the new env)
6. Storage buckets created in the new Supabase project

## Must be new for every clone

| Item | Where |
|---|---|
| Supabase project (DB, Auth, Storage) | new project in the client's own Supabase account |
| `NEXT_PUBLIC_SUPABASE_URL`, `…ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | from the new project |
| `APP_INSTANCE_ID` | new unique value |
| SMTP credentials, sender | client's mailbox |
| Hosting project, domain | client's account |
| Company, users, masters | created inside the new instance; nothing is copied |

## Renaming / white-label

| Change | How | Code change? |
|---|---|---|
| Product name | `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_NAME` | No |
| Logo, favicon, colours | env / `public/brand/` | No |
| Company name, GSTIN, address, PDF header/footer | Settings screen (database) | No |
| Document prefixes / formats | Settings → Numbering | No |

The database schema, SQL functions and business logic contain no product or
company name.

## Proving independence

1. `npm run instance:verify` on the new instance → `OK`.
2. Run it with the **old** instance's `APP_INSTANCE_ID` against the new
   database → must FAIL (`belongs to instance …`).
3. Log in to the new instance with a user of the old instance → must fail
   (separate Supabase Auth).
4. Create `Customer-B` in the new instance; it must not appear in the old one
   (separate databases) — spec §52.
