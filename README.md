# BusinessFlow ERP

A complete, self-hosted mini ERP for small manufacturers, traders, distributors
and retail/wholesale businesses: customers, vendors, products, sales,
purchases, inventory, sales/purchase orders, payments & outstanding,
production planning, reports, PDF documents, email, Excel import/export,
users/roles/permissions, and an audit log.

This README assumes **zero coding experience**. Follow it top to bottom.

## Tech stack (all free/open-source)

- Frontend: Next.js 14 + React + TypeScript + Tailwind CSS
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL
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
2. Install **PostgreSQL**: https://www.postgresql.org/download/
   - During setup, remember the password you set for the `postgres` user.
   - Alternatively use a free hosted Postgres: https://neon.tech or
     https://supabase.com — copy the "connection string" they give you.
3. Create a database named `businessflow_erp` (using pgAdmin, or run
   `createdb businessflow_erp` in a terminal).

## 2. Configure environment variables

```bash
cp .env.example backend/.env
```

Open `backend/.env` in any text editor and fill in:

- `DATABASE_URL` — your PostgreSQL connection string
- `JWT_SECRET` — any long random string (used to secure logins)
- `SMTP_*` — only needed if you want to email PDFs (Gmail works with an
  "App Password": https://myaccount.google.com/apppasswords)

```bash
cp frontend/.env.example frontend/.env.local
```

The default `NEXT_PUBLIC_API_URL=http://localhost:4000/api` works for local
development unchanged.

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

**Change this password immediately after your first login** (Settings →
your profile → Change Password).

## 4. Install & run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 in your browser and log in.

## 5. Everyday use

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

This runs PostgreSQL's own `pg_dump` and writes a timestamped `.dump` file
into `backend/backups/`. To restore a backup:

```bash
npm run restore -- backend/backups/<filename>.dump
```

(Requires `pg_dump`/`pg_restore` to be installed — they come bundled with
PostgreSQL.)

## 7. Building for production

```bash
cd backend && npm run build && npm run prisma:deploy
cd ../frontend && npm run build
```

## 8. Deploying to a real server (Ubuntu VPS)

1. Install Node.js LTS, PostgreSQL, Nginx, and PM2 (`npm i -g pm2`) on the
   server.
2. Copy this project to the server, set `backend/.env` with production
   values (a strong `JWT_SECRET`, your real `DATABASE_URL`, real SMTP
   creds), then run the "production build" steps above.
3. Start the backend with PM2: `pm2 start dist/server.js --name erp-api`
   and `pm2 save` so it restarts on reboot.
4. Serve the frontend with `pm2 start npm --name erp-web -- start` (from
   `frontend/`) or `next start`.
5. Put Nginx in front of both as a reverse proxy, and use `certbot` for a
   free HTTPS certificate (Let's Encrypt) once you've pointed a domain's
   DNS at the server.

## Troubleshooting

- **"Can't reach database server"** — check `DATABASE_URL` in
  `backend/.env` and that PostgreSQL is running.
- **Login fails after fresh install** — make sure you ran `npm run seed`.
- **Emails don't send** — check `backend/.env` SMTP settings; failed
  attempts are recorded under Email → Email Logs with the exact error.
- **Port already in use** — another program is using port 3000 or 4000;
  close it or change `PORT` / the frontend dev port.
