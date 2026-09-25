# Instance Architecture — Standalone Clones, White-Label, Isolation

> Phase 2 deliverable. Status: **DRAFT — awaiting user review.**
> Implements Master Specification §2–7, §39–45, §52–53.
> The step-by-step operator guides (`docs/CLONING.md`, `docs/INSTANCE_SETUP.md`)
> will be written in the implementation phase from this design.

---

## 1. Goal

One source code → any number of **completely independent installations**.

```
                 SOURCE CODE (this git repository)
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
     INSTANCE A           INSTANCE B           INSTANCE C
  (Rukman Dataflow)     (Client XYZ ERP)          (…)
          │                    │                    │
   Supabase project A   Supabase project B   Supabase project C
   ├ Postgres DB-A      ├ Postgres DB-B      ├ Postgres DB-C
   ├ Auth-A             ├ Auth-B             ├ Auth-C
   └ Storage-A          └ Storage-B          └ Storage-C
          │                    │                    │
   Vercel project A     Vercel project B     Vercel project C
   (env vars A)         (env vars B)         (env vars C)
```

**An instance = one Supabase project + one Vercel project + one set of
environment variables.** Nothing else is shared. There is no central server,
licence server or shared database that instances talk to.

---

## 2. What is shared vs. what is per-instance

| Layer | Shared across instances | Per instance (never shared) |
|---|---|---|
| Source code, UI components, business logic | ✅ same git repo / release tag | — |
| SQL migrations (`supabase/migrations`) | ✅ same files | applied separately to each DB |
| System seed (permissions, roles, units, enums) | ✅ same files | applied separately |
| Database, data, users | — | ✅ own Supabase project |
| Auth users, sessions, JWT secret | — | ✅ own Supabase Auth |
| Uploaded files, generated PDFs | — | ✅ own Supabase Storage buckets |
| API keys, SMTP credentials, secrets | — | ✅ own env vars |
| Branding (name, logo, colours, footer) | — | ✅ env + company settings |
| Company master data, parties, items, openings | — | ✅ loaded per instance by import scripts |
| Domain / URL | — | ✅ own domain |

---

## 3. Configuration layers

Three layers, from most static to most dynamic. **No layer contains
hard-coded values of a specific company or instance.**

### 3.1 Layer 1 — Environment variables (deployment / secrets)

Read **only** in `src/config/env.ts` (validated with a schema at start-up;
the app refuses to start if a required variable is missing or malformed).

| Variable | Exposure | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL of **this** instance |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key of this project |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | used by server jobs (import, email worker); never sent to browser |
| `DATABASE_URL` | **server only** | direct Postgres URL for migration tooling only |
| `APP_INSTANCE_ID` | server | unique id of this instance (see §6 guard) |
| `APP_ENV` | server | `development` / `staging` / `production` |
| `NEXT_PUBLIC_APP_NAME` | public | e.g. `Rukman Dataflow Management System` |
| `NEXT_PUBLIC_APP_SHORT_NAME` | public | e.g. `Rukman DMS` |
| `NEXT_PUBLIC_PRIMARY_COLOR` / `NEXT_PUBLIC_SECONDARY_COLOR` | public | brand colours |
| `NEXT_PUBLIC_LOGO_URL` / `NEXT_PUBLIC_FAVICON_URL` | public | branding assets (default: files under `public/brand/`) |
| `STORAGE_BUCKET_DOCUMENTS` / `STORAGE_BUCKET_ATTACHMENTS` | server | bucket names in this project |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS` | **server only** | email sender of this instance |
| `APP_BASE_URL` | server | used in email links |

`.env.example` in the repo contains **placeholders only**. `.env.local` (dev)
and the Vercel project env (prod) hold real values; `.env*` except
`.env.example` stay in `.gitignore`. Secret scanning runs in CI.

### 3.2 Layer 2 — Application config (`src/config/app.ts`)

Typed object built from Layer 1 + defaults. **The only place UI code gets
branding from.**

```ts
// shape only — implementation comes later
export const appConfig = {
  name, shortName, version,          // from env + package.json
  branding: { primaryColor, secondaryColor, logoUrl, faviconUrl },
  locale: { currency: 'INR', dateFormat: 'dd-MMM-yyyy', timezone: 'Asia/Kolkata' },
} as const;
```

Components use `appConfig.name`, never a literal product name (spec §2).
A lint rule / CI grep fails the build if the literal current product name
appears outside `src/config` and docs.

### 3.3 Layer 3 — Company settings (database)

Business identity that an admin edits in the UI, stored in `companies` and
`app_settings` (see `DATABASE_BLUEPRINT.md` §3):

- legal name, trade name, GSTIN, PAN, address, phone, email, website, logo
  (Storage path) — used on PDFs and emails;
- document prefixes and numbering (`document_sequences`) — e.g. `GT-`,
  `GS-`, `T/{FY}/` (spec §44);
- PDF header/footer text, terms & conditions, signature label (spec §24, §43);
- business policies: negative stock, over-receipt tolerance, approval
  required for RM issues, FY start month.

### 3.4 Renaming the application (spec §3)

| Change | Where | Code change needed? |
|---|---|---|
| Product name, short name | env `NEXT_PUBLIC_APP_NAME`, `…SHORT_NAME` → redeploy | No |
| Logo, favicon, colours | env / `public/brand/*` → redeploy | No |
| Company name, address, GSTIN, PDF header/footer | Settings screen (DB) | No |
| Document prefixes | Settings → Numbering (DB) | No |
| Email sender | env SMTP / `EMAIL_FROM_*` | No |

Database schema, SQL functions, inventory and accounting logic contain **no**
product or company name.

---

## 4. Deployment models (spec §6)

### Model A — standalone (default, used for Rukman)
One deployment · one Supabase project · **one row in `companies`**. The
company id is read from the DB at login (the user's `user_roles`), never
from code or env.

### Model B — multi-company in one instance (future)
Same schema. Several `companies` rows; users get `user_roles` per company;
the UI shows a company switcher. Isolation by:

1. `company_id` on every header/master table (+ movement/journal tables);
2. RLS policies `company_id = ANY (auth_company_ids())`;
3. company-consistency triggers (a document cannot reference another
   company's party/item/godown/account);
4. storage object paths prefixed with `company_id`, enforced by storage RLS;
5. document sequences keyed by `company_id`.

Model B is an **option inside one instance**; it never links two instances.

---

## 5. Isolation guarantees (spec §4, §52)

| Asset | How isolation is guaranteed |
|---|---|
| Database | Each instance has its own Supabase project → separate Postgres cluster. The app only knows the URL/keys in its own env. |
| Auth | Supabase Auth is per project; a JWT of project A is signed with A's secret and is **invalid** in project B. Users/passwords are not shared. |
| Storage | Buckets belong to the project; URLs are signed by that project. |
| Secrets | Separate Vercel projects and env sets; no shared `.env` file committed. |
| Email | Each instance has its own SMTP credentials and sender. |
| Code defaults | No fallback URL/key in code: if env is missing, start-up fails instead of silently pointing to another instance. |

---

## 6. Guard against accidental cross-connection (spec §53)

A misconfigured env (e.g. instance B's Vercel project pasted with A's
Supabase URL) is the realistic risk. Two checks prevent it:

1. **Instance fingerprint in the database.** Migration `0001` creates
   `instance_meta (instance_id text primary key, instance_name text,
   created_at timestamptz)`; the setup script inserts the value of
   `APP_INSTANCE_ID` once. On server start and on every admin login the app
   compares `APP_INSTANCE_ID` with `instance_meta.instance_id`. **Mismatch ⇒
   the app shows a blocking "wrong database" error and refuses to operate.**
2. **Supabase project ref check.** Where the configured keys are JWTs that
   carry a `ref` claim, that ref must match the project ref in
   `NEXT_PUBLIC_SUPABASE_URL`; mismatch ⇒ start-up failure. (Fingerprint check
   1 covers key formats without a ref claim.)

Production destructive commands (reset/seed) additionally require
`APP_ENV != production` **and** typing the instance id (spec §41).

---

## 7. Repository layout (target)

```
/src
  /app            Next.js routes (UI only)
  /components     shared UI
  /modules        sales, purchase, inventory, job-work, payments, accounting, masters, reports
                  (each: api client → Supabase RPC, types, forms; no SQL business rules)
  /lib            supabase clients (browser / server), pdf, email adapters
  /config         env.ts (validated env), app.ts (appConfig)
  /types          generated DB types
/supabase
  /migrations     ordered SQL: schema, RLS, functions, views
  /seed/system    permissions, roles, units, enums (every instance)
  /seed/dev       fake demo data for local development only
/scripts
  /import         sheet → staging tables → validated inserts (company data)
  /reconcile      spec §38 comparisons (sheet totals vs DB)
/docs             this document set
```

Business rules live in **SQL posting functions** (single source of truth,
enforced for every client); the TypeScript layer handles UI, validation
messages and orchestration only (spec §45).

---

## 8. Cloning procedure (summary — full guide in `docs/CLONING.md` later)

1. `git clone` the repository (same release tag as instance A).
2. Create a **new** Supabase project (new DB, Auth, Storage automatically).
3. Create storage buckets `documents`, `attachments` (private) + policies
   (script provided).
4. Create a **new** Vercel project; set all env vars from `.env.example`
   with the new project's values and a **new** `APP_INSTANCE_ID`.
5. `npm run db:migrate` against the new project (Supabase CLI linked to the
   new ref).
6. `npm run db:seed:system` — permissions, roles, units.
7. `npm run instance:init` — writes `instance_meta`, creates the first
   company row and the first admin user (email + temporary password).
8. Admin logs in → Settings: company details, logo, document prefixes.
9. Optional: `npm run import:company -- --file <client-data.xlsx>` for master
   data and openings.
10. Deploy; run `npm run instance:verify` — checks env ↔ DB fingerprint, that
    the DB contains exactly the expected company, that no row of another
    instance exists, and that storage/auth belong to the same project ref.

The isolation test in spec §52 (Customer-A / Customer-B visibility across
instances, repeated for users, sales, stock, payments, ledgers, PDFs, files,
reports) is part of `db:test` / e2e tests run against two local instances.

---

## 9. Local development — keep everything on the D: drive (Windows)

The code will be written and pushed to GitHub from this cloud session (there
is no C:/D: drive here). On the developer's Windows PC:

| What | How to keep it on D: |
|---|---|
| Source code | `git clone https://github.com/RU-MIS/cmms-rukman.git D:\cmms-rukman` |
| `node_modules`, `.next` build output | inside the project folder → automatically on D: |
| npm cache | `npm config set cache D:\dev-cache\npm --global` |
| Local Supabase (Docker) data | Docker Desktop → Settings → Resources → Advanced → **Disk image location** → `D:\docker` (before running `supabase start`) |
| Supabase CLI | `npx supabase …` from the project folder (no global install on C:) |
| `.env.local` | `D:\cmms-rukman\.env.local` (never committed) |

A cloud deployment (Supabase + Vercel) does not use the local disk at all.

---

## 10. Existing code in this repository

The repository currently contains **BusinessFlow ERP** (Express + Prisma +
**MySQL**, Next.js static export, deployed to Cloudflare Pages + a VM). The
specification requires **Supabase (PostgreSQL + Auth + Storage) + Next.js on
Vercel**, RLS and SQL posting functions, which is a different architecture.

Proposal (pending Q-35): build the new application in the same repository on
the Supabase stack and remove the old `backend/` and `frontend/` folders in a
separate, clearly-labelled commit when the new app reaches parity (history
remains in git). Reusable pieces (Tailwind UI components, PDF layout ideas)
may be ported where they fit the new structure.

---

## 11. Cost profile (spec §53 "low-cost")

| Component | Small single-company instance |
|---|---|
| Supabase | Free tier possible for trial; Pro plan recommended for production (daily backups, no pause on inactivity) |
| Vercel | Hobby for trial; Pro if used commercially per Vercel terms |
| Email | any SMTP (e.g. company mailbox / transactional provider) |
| Domain | optional |

Each instance is billed to **its own** accounts — another reason there is no
shared infrastructure.
