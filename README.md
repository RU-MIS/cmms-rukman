# BusinessFlow ERP

A complete, self-hosted, multi-company ERP for small manufacturers, traders,
distributors and retail/wholesale businesses: customers, vendors, products,
sales, purchases, inventory, sales/purchase orders, payments & outstanding,
production planning, reports, PDF documents, email, Excel import/export,
users/roles/permissions, and an audit log.

One deployment can host any number of independent company workspaces (each
with fully isolated data — its own customers, stock, invoices, invoice
numbering, GST profile and settings) that a single login can create and
switch between from the header. GSTIN fields are validated everywhere they
appear; a "Fetch GST Details" placeholder is ready for a paid GST lookup
API to be plugged in later without any redesign — see `GST_API_*` in
`.env.example`.

This README assumes **zero coding experience**. Follow it top to bottom.

## Deploying for real

There's no more one-click free host (Render's free tier used to sleep
after 15 minutes idle, giving every visitor a ~30-60 second cold start on
the first request — not something you want a customer to see). The
recommended setup instead is: **Cloudflare Pages** for the frontend (a
static export — always-on, no cold start) + a **plain VM** for the backend
(e.g. Oracle Cloud's Always Free tier) + **MySQL** for the database (e.g.
Oracle MySQL HeatWave Always Free). See section 8, "Deploying to
production", below for the full walkthrough. None of this is
platform-specific — the backend is a standard Node/Express process that
runs the same way on any VPS.

## Tech stack (all free/open-source)

- Frontend: Next.js 14 + React + TypeScript + Tailwind CSS (built as a
  static export — no Node server required to host it)
- Backend: Node.js + Express + TypeScript
- Database: MySQL 8.0+ (e.g. Oracle MySQL HeatWave Always Free)
- ORM: Prisma
- PDF: PDFKit
- Excel: ExcelJS
- Email: Nodemailer (SMTP)
- Charts: Recharts

Free software is not the same as free hosting — running this yourself on
your own PC or a VPS is free forever; a managed cloud host may charge once
you go beyond its free tier.

## 1. Install prerequisites (one-time)

1. Install **Node.js LTS** (18 or 20): https://nodejs.org
2. Install **MySQL** (8.0+): https://dev.mysql.com/downloads/mysql/
   - During setup, remember the password you set for the `root` user (or
     create a dedicated app user).
   - Alternatively use a free hosted MySQL: Oracle MySQL HeatWave Always
     Free — copy the connection details it gives you.
3. Create a database named `businessflow_erp`:
   ```bash
   mysql -u root -p -e "CREATE DATABASE businessflow_erp CHARACTER SET utf8mb4;"
   ```

## 2. Configure environment variables

```bash
cp .env.example backend/.env
```

Open `backend/.env` in any text editor and fill in:

- `DATABASE_URL` — your MySQL connection string, e.g.
  `mysql://root:yourpassword@localhost:3306/businessflow_erp`
- `JWT_SECRET` — any long random string (used to secure logins)
- `SMTP_*` — only needed if you want to email PDFs (Gmail works with an
  "App Password": https://myaccount.google.com/apppasswords)
- `GST_API_*` — optional, leave blank until you subscribe to a GST
  verification API. Set once here and every company benefits — the
  "Fetch GST Details" button otherwise shows a clear "not configured" state
  instead of failing or fetching fake data.

```bash
cp frontend/.env.example frontend/.env.local
```

The default `NEXT_PUBLIC_API_URL=http://localhost:4000/api` works for local
development unchanged. **Note for production**: this variable is baked
into the frontend at *build time*, not read at runtime — when deploying to
Cloudflare Pages (a static export has no server to read env vars from at
request time), you must set it in the Pages project's build settings, not
just in a local `.env` file.

## 3. Install & set up the backend

```bash
cd backend
npm install
npm run prisma:migrate    # creates all database tables
npm run seed               # loads demo data + a default admin login
npm run dev                 # starts the API on http://localhost:4000
```

Default login created by the seed script:

- Username: `admin`
- Password: `Admin@1234`

This account is created with a forced password change — the very first
login redirects straight to Change Password and every other API call is
blocked until a new password is set. **Never rely on this default password
for a real deployment** — see section 9, "Before your first real buyer goes
live," before handing the system to anyone.

## 4. Install & run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 in your browser and log in.

## 5. Everyday use

- **Companies**: the seed script creates one demo company (with the default
  `admin` login as its Admin). For a real customer, either rename this
  company (Companies → the pencil icon → GST profile) or create a fresh one
  from Companies → "Create New Company" — optionally cloning another
  company's settings/ledgers via "Make a Copy" (never its transactions).
  Switch between companies any time from the dropdown in the top header.
- **Master Data**: add your Customers, Vendors, Products, Categories, Units
  and Warehouses first.
- **Sales / Purchases**: record every sale/purchase here — stock and
  ledgers update automatically, nothing needs to be entered twice.
- **Payments**: record money received/paid against invoices; Outstanding and
  Ageing update automatically.
- **Inventory**: view current stock, low stock, stock ledger, and record
  manual stock in/out/adjustment/transfer.
- **Production**: define a Bill of Materials (BOM) per finished product,
  plan production, and mark it complete — this consumes raw materials and
  adds finished-goods stock automatically.
- **Reports / Documents**: every report and PDF (invoices, orders, receipts,
  ledgers) is generated from real data — export to PDF or Excel, or email it
  directly to a customer/vendor from the document screen.
- **Excel Import**: Administration → import Customers/Vendors/Products/
  Opening Stock/Opening Balances from a spreadsheet — bad rows are shown
  before anything is saved.
- **Users & Roles**: Administration → Users lets you add employees and
  assign a role (Admin/Manager/Sales/Purchase/Accounts/Production/Viewer)
  that controls what they can see and do.
- **Audit Log**: Administration → Audit Logs shows who did what and when.

## 6. Backing up your data

```bash
cd backend
npm run backup
```

This runs MySQL's own `mysqldump` and writes a timestamped `.sql` file
into `backend/backups/`. To restore a backup:

```bash
npm run restore -- backend/backups/<filename>.sql
```

(Requires the `mysqldump`/`mysql` client tools to be installed — they come
bundled with MySQL, or can be installed standalone as the "MySQL client".)

## 7. Building for production

```bash
cd backend && npm run build && npm run prisma:deploy
cd ../frontend && npm run build   # produces a static site in frontend/out/
```

## 8. Deploying to production (Cloudflare Pages + a VM + MySQL)

This is a two-part deployment: the frontend is a static export served
from Cloudflare's CDN (fast everywhere, never sleeps, free), and the
backend is a plain Node/Express process on any VM you control (these
instructions use Oracle Cloud's Always Free tier as a concrete example,
but the backend has no cloud-specific code — the same steps work on any
Ubuntu VPS).

### Backend: Node/Express on a VM

1. Provision a VM (e.g. an Oracle Cloud "Always Free" Ampere A1 compute
   instance running Ubuntu) and a MySQL database (e.g. an Oracle MySQL
   HeatWave "Always Free" DB System). **Put them in the same private
   network (VCN/subnet)** so the backend reaches the database over a
   private IP — this avoids exposing the database to the public internet
   at all, and sidesteps needing a public-endpoint TLS/certificate setup
   for the DB connection. Only the VM itself needs a public IP, and only
   for inbound HTTPS traffic.
2. On the VM, install Node.js LTS, the MySQL client tools (`mysql`,
   `mysqldump` — for the backup feature; you do **not** need a local
   MySQL *server* on this VM, the database is HeatWave), Nginx, and PM2
   (`npm i -g pm2`).
3. Copy this project's `backend/` folder to the VM, set `backend/.env`
   with production values (a strong `JWT_SECRET`, the `DATABASE_URL`
   pointing at your MySQL DB System's private IP, real SMTP creds, and
   `CORS_ORIGIN` set to your Cloudflare Pages URL — see part 2 below),
   then run:
   ```bash
   npm install
   npm run build          # prisma generate && tsc
   npm run prisma:deploy  # applies migrations
   npm run seed           # first deploy only
   ```
4. Start it with PM2 and have it survive reboots:
   ```bash
   pm2 start dist/src/server.js --name erp-api
   pm2 save
   pm2 startup   # follow the printed instructions once, so PM2 itself survives a reboot
   ```
5. Put Nginx in front as a reverse proxy to `localhost:4000`, and use
   `certbot` for a free HTTPS certificate (Let's Encrypt) once you've
   pointed a domain's DNS at the VM's public IP. Keep `UPLOAD_DIR` (logos
   etc.) as an absolute path outside your deploy folder if you plan to
   redeploy by replacing the whole directory, so uploads survive a
   redeploy; a plain `git pull`-in-place setup can leave it as the default
   relative `uploads/`.

### Frontend: Cloudflare Pages

1. In the Cloudflare dashboard, create a **Pages** project connected to
   this GitHub repo.
2. Build settings: root directory `frontend`, build command
   `npm run build`, build output directory `frontend/out` (`out`, if the
   root directory is already set to `frontend`).
3. Add an environment variable in the Pages project's build settings:
   `NEXT_PUBLIC_API_URL` = your backend's public URL + `/api` (e.g.
   `https://api.yourdomain.com/api`) — this gets baked into the static
   build, so it must be set here, not just in a local `.env` file.
4. Deploy. Cloudflare gives you a `*.pages.dev` URL immediately; attach a
   custom domain from the project settings whenever you're ready.
5. Back on the backend VM, set `CORS_ORIGIN` in `backend/.env` to this
   exact frontend URL and restart the backend (`pm2 restart erp-api`) —
   the API only allows the one origin configured here.

## 9. Before your first real buyer goes live

This section is the production handover checklist — read it before anyone
but you logs into a deployment. Nothing here changes how the app works day
to day; it's what separates "a demo running on a VM" from "safe to hand to
a paying customer."

### 9.1 Security hardening

- **`JWT_SECRET` is mandatory and validated in production.** When
  `NODE_ENV=production`, the backend refuses to start if `JWT_SECRET` is
  missing, shorter than 32 characters, or a well-known placeholder (the
  `.env.example` value included). Generate a real one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- **`CORS_ORIGIN` is validated too.** In production it must be set to your
  real frontend URL — the server refuses to start if it's still `localhost`.
- **Login/password endpoints have a dedicated, tight rate limit** (20
  requests per 15 minutes per IP) on top of the general API limit, to slow
  down credential-stuffing/brute-force attempts. This is fixed in code, not
  configurable via `.env`.
- **First-login forced password change.** Any account created with a
  password by an admin (including the `admin` seed login) must change its
  password before it can do anything else — enforced server-side, not just
  in the UI, so it can't be bypassed by calling the API directly.
- **Passwords are hashed with bcrypt** (`BCRYPT_ROUNDS`, default 10 — bump to
  12 in production for a slower, more brute-force-resistant hash at a small
  login-latency cost).
- **CORS** allows exactly one explicit origin (`CORS_ORIGIN`) with
  credentials — never a wildcard.
- Review who has the `admin` login's credentials before go-live, and change
  its password (or your own admin account's password) even though the app
  already forces this on first use — don't let "forced on first login" be
  the only thing standing between a demo password and production.

### 9.2 Demo-data cleanup

The seed script (`npm run seed`) creates one demo company, "BusinessFlow ERP
Demo Co.", with the `admin` login and sample customers/vendors/products/a
sale/a purchase. Before a real buyer starts using the system, retire it:

```bash
cd backend
npm run cleanup:demo                      # dry run — reports what it found, changes nothing
npm run cleanup:demo -- --confirm         # deactivates the demo company (safe, reversible, no data lost)
npm run cleanup:demo -- --confirm --delete  # permanently deletes it and all its data (irreversible)
```

- The dry run is always safe to run — it never writes anything.
- `--confirm` alone is the recommended option: it sets the demo company's
  `active` flag to `false`. The app already refuses login/switch-company
  into an inactive company everywhere, so it simply disappears from use
  without touching the schema or deleting anything.
- `--confirm --delete` is for when you specifically want the demo data
  gone rather than hidden — it permanently removes the company and every
  row under it (customers, products, sales, purchases, roles, settings,
  etc.) in one transaction.
- The script identifies the demo company by its exact seeded name and
  GSTIN — never by a fuzzy match — so a company you've renamed or started
  using for real is never touched.
- It never deletes or deactivates the `admin` login itself (only the
  company it belongs to), to avoid risking a total lockout. If that login
  ends up with no remaining company memberships, the script just tells you
  so you can decide — leave it for the buyer's first login (it already
  forces a password change) or deactivate it once real users exist.

### 9.3 Production environment validation

Before starting the backend with `NODE_ENV=production`, confirm every
variable below is set correctly in `backend/.env` (see `.env.example` for
the full annotated list):

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your production MySQL connection string — required, checked at startup |
| `JWT_SECRET` | 32+ random characters, not a placeholder — required, checked at startup |
| `CORS_ORIGIN` | Your real frontend URL, not `localhost` — required, checked at startup |
| `SMTP_*` | Real SMTP credentials, if you want email features to work |
| `GST_API_*` | Leave blank until you subscribe to a GST lookup API — the app shows a clear "not configured" state instead of failing |
| `BCRYPT_ROUNDS` | 10 (default) or 12 for slightly stronger hashing |
| `UPLOAD_DIR` | An absolute path outside your deploy folder, so logos survive a redeploy |

The backend fails to start with a clear error message if `JWT_SECRET` or
`CORS_ORIGIN` are missing or invalid in production — this is intentional,
so a misconfiguration is caught at deploy time, not discovered later as a
security incident or a broken login.

**No secret is ever exposed to the frontend.** The only backend-derived
value the frontend build ever sees is `NEXT_PUBLIC_API_URL` (the API's
public base URL) — never `JWT_SECRET`, `DATABASE_URL`, SMTP credentials, or
the GST API key, all of which stay server-side only (`backend/.env`,
never committed — see `.gitignore`).

### 9.4 Backup and deployment readiness

- **Backup**: `npm run backup` (from `backend/`) runs `mysqldump` and
  writes a timestamped `.sql` file to `backend/backups/`. Run this on a
  schedule (e.g. a daily cron job) once real data exists, and copy backups
  off the VM (they're not safe sitting only on the same disk).
- **Restore**: `npm run restore -- backend/backups/<filename>.sql`.
- **Migrations**: always use `npm run prisma:deploy` (`prisma migrate
  deploy`) in production — never `prisma:migrate` (`migrate dev`), which is
  for local development only and can prompt interactively or reset data.
- **Deploying an update**:
  1. `git pull` (or copy the new `backend/` and `frontend/` folders over).
  2. `cd backend && npm install && npm run build && npm run prisma:deploy`.
  3. `pm2 restart erp-api`.
  4. `cd ../frontend && npm install && npm run build`, then redeploy the
     `frontend/out/` static export (e.g. push to the branch Cloudflare
     Pages watches, or re-upload the `out/` folder).
  5. Verify: `curl https://api.yourdomain.com/health` should return
     `{"status":"ok",...}`, then log in and spot-check a page.
- **Rollback**: `git checkout <previous-tag-or-commit>` in `backend/`, then
  repeat the build + `prisma:deploy` + `pm2 restart` steps above. Prisma
  migrations are additive (new tables/columns), so rolling back the app
  code while ahead-of-it migrations remain applied is safe as long as you
  haven't rolled back past a breaking schema change — take a fresh backup
  before any migration you're unsure about.
- **Health check**: `GET /health` (no auth required) returns
  `{"status":"ok","app":"BusinessFlow ERP"}` — use it for your process
  manager/uptime monitor, and check it manually after every deploy.
- **Environment separation**: keep separate `backend/.env` files per
  environment (development on your machine, staging/production on their
  own VMs or `.env` files) — never point a local dev backend at the
  production `DATABASE_URL`, and never reuse a production `JWT_SECRET`
  anywhere else (every environment should have its own).

### 9.5 Automated tests

A checked-in test suite covers the multi-tenant foundations end to end —
see `backend/tests/README.md` for what's covered and how to run it
(`npm test` from `backend/`).

## Troubleshooting

- **"Can't reach database server"** — check `DATABASE_URL` in
  `backend/.env` and that MySQL is running and reachable.
- **Login fails after fresh install** — make sure you ran `npm run seed`.
- **Emails don't send** — check `backend/.env` SMTP settings; failed
  attempts are recorded under Email → Email Logs with the exact error.
- **Port already in use** — another program is using port 3000 or 4000;
  close it or change `PORT` / the frontend dev port.
