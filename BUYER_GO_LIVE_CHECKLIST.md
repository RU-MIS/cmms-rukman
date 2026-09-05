# BusinessFlow ERP — Buyer Go-Live Checklist

A concise checklist to work through before a real buyer starts using a
production deployment. Every command referenced here is documented in full
in `README.md` — this file is the checklist, not the explanation.

## 1. Security checklist

- [ ] `backend/.env` has `NODE_ENV=production`.
- [ ] `JWT_SECRET` is a real random value (32+ characters), generated with:
      `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
      — not the `.env.example` placeholder.
- [ ] `CORS_ORIGIN` is set to the buyer's real frontend URL (not `localhost`).
- [ ] `NODE_ENV=production npm run verify:env` (from `backend/`) passes with
      no errors.
- [ ] The `admin` login's password has actually been changed (the app
      forces this on first login — confirm it was actually done, not
      skipped by leaving the account unused).
- [ ] No `.env` file is committed to git (`git status` shows none; check
      `.gitignore` covers `.env`, `.env.local`, `.env.*.local`).
- [ ] `BCRYPT_ROUNDS` is 10 or higher (12 recommended for production).

## 2. Environment checklist

- [ ] `DATABASE_URL` points at the production MySQL instance, not a local
      dev database.
- [ ] `SMTP_*` variables are set with real credentials if email features
      (invoice/receipt emailing, password reset emails) are needed.
- [ ] `GST_API_*` are left blank until a GST lookup API is actually
      subscribed to — confirmed the "Fetch GST Details" button shows a
      clear "not configured" message, not an error or fake data.
- [ ] `NEXT_PUBLIC_API_URL` is set correctly in the frontend host's build
      settings (e.g. Cloudflare Pages project settings) and points at the
      backend's real public URL + `/api`.
- [ ] No secret (`JWT_SECRET`, `DATABASE_URL`, SMTP credentials, GST API
      key) appears anywhere in frontend code, build output, or browser
      devtools — only `NEXT_PUBLIC_API_URL` is ever frontend-visible.
- [ ] `GET /health` on the production backend URL returns
      `{"status":"ok",...}`.

## 3. Database checklist

- [ ] `npm run prisma:deploy` has been run against the production database
      (never `prisma:migrate`/`migrate dev` in production).
- [ ] The database user in `DATABASE_URL` has appropriate permissions
      (not necessarily root) and the database itself uses `utf8mb4`.
- [ ] The database is reachable only from the backend (private
      network/VPC where possible), not exposed to the public internet.

## 4. Backup checklist

- [ ] `npm run backup` works and produces a `.sql` file under
      `backend/backups/`.
- [ ] A backup schedule is running (e.g. a daily cron job), not just a
      one-time manual backup.
- [ ] Backups are copied off the server automatically — not left only on
      the same disk as the database.
- [ ] At least one backup has actually been restored once, following
      README §9.4, to confirm the process works before it's needed for
      real.
- [ ] Old backups are pruned on a schedule so disk usage doesn't grow
      unbounded.

## 5. Demo cleanup checklist

- [ ] `npm run cleanup:demo` (dry run) has been run and reviewed.
- [ ] The demo company ("BusinessFlow ERP Demo Co.") has been retired —
      either `npm run cleanup:demo -- --confirm` (deactivated) or
      `npm run cleanup:demo -- --confirm --delete` (permanently removed).
- [ ] The buyer's real company was created fresh (Companies → Create New
      Company) rather than by renaming the demo company in place — see
      README §9.2 "Setting up the buyer's first real company."
- [ ] No demo customers/vendors/products/sales (named with a `Demo —`
      prefix, or the sample sale/purchase) remain visible in the buyer's
      real company.

## 6. First admin setup

- [ ] The buyer's first real login (whether the renamed `admin` account or
      a newly created named user) was forced through Change Password on
      first login — confirmed, not assumed.
- [ ] A real named admin user exists for the actual business owner
      (Administration → Users) rather than everyone sharing the generic
      `admin` login indefinitely.
- [ ] The buyer knows how to add further users and assign roles
      (Administration → Users → role dropdown).
- [ ] The buyer knows how to use "Forgot password" if they get locked out,
      and that it requires working SMTP configuration to actually deliver
      the reset email.

## 7. Smoke tests

Run through this list once against the real production deployment before
declaring it live:

- [ ] Log in with the real admin account.
- [ ] Company creation — create a second company and confirm it starts
      blank (no demo data).
- [ ] Company switching — switch between the two companies from the header.
- [ ] Create a customer, a vendor, and a product.
- [ ] Record a sale invoice — confirm stock and ledgers update.
- [ ] Record a purchase invoice — confirm stock and ledgers update.
- [ ] Record a payment against an invoice — confirm Outstanding updates.
- [ ] Generate a PDF (invoice/receipt) and confirm the buyer's real
      business name/logo/GSTIN appear on it, not demo branding.
- [ ] Enter an invalid GSTIN and confirm it's rejected with a clear message.
- [ ] Confirm "Fetch GST Details" shows "not configured" (unless a GST API
      has actually been subscribed to and wired up).
- [ ] Confirm data created in one company never appears in another
      (tenant isolation) — the automated test suite (`npm test`) covers
      this, but a manual spot-check on the real deployment is still worth
      doing once.
- [ ] Open the app on a phone/narrow browser window and confirm the layout
      is usable (sidebar collapses, tables scroll, forms are readable).

## 8. Support / handover requirements

- [ ] The buyer (or whoever will operate this day to day) has been told:
      where backups live and how to restore one, how to check `/health`,
      how to restart the backend (`pm2 restart erp-api`), and how to view
      logs (`pm2 logs erp-api`).
- [ ] Whoever holds `backend/.env` credentials is documented — this file
      is never committed to git, so it must be handed over or securely
      stored some other way (a password manager, not chat/email).
- [ ] A process exists for reporting bugs/issues after handover (even if
      informal — a shared inbox, a support contact).
- [ ] The repository access (GitHub, hosting accounts, DNS, Cloudflare)
      that the buyer needs going forward has been transferred or shared as
      agreed.

---

**This checklist does not replace judgment.** A small business running
this for the first time doesn't need every box ticked with enterprise
rigor — but every box should have been *considered*, not skipped by
accident.
