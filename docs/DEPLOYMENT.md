# Production deployment — one instance

Every client / installation is an **independent instance**: its own Supabase
project, its own static-hosting project, its own GitHub repository secrets.
Nothing is shared between instances (`INSTANCE_ARCHITECTURE.md`).

> Release gate: run the complete test suite (§10) on the exact commit you
> deploy, and get human approval of `docs/RELEASE_AUDIT.md`.

---

## 1. Accounts you need

| Service | Plan | Used for |
|---|---|---|
| Supabase | Free (Pro recommended for daily backups / no pausing) | PostgreSQL, Auth, Storage, API |
| Cloudflare Pages (or any static host) | Free | the web app (`web/out`) |
| GitHub | Free | code, email-worker cron, nightly backup |
| SMTP mailbox (Google Workspace, Zoho, Amazon SES, Brevo …) | — | ERP emails **and** Supabase Auth emails |

## 2. Supabase project

1. supabase.com → **New project** (region close to users, e.g. Mumbai). Save the
   database password.
2. Project Settings → API: copy **Project URL**, **anon public key**,
   **service_role key** (secret!). Project Settings → Database → connection
   string (URI, *session pooler*, port 5432) = `DATABASE_URL`.
3. Apply the schema (migrations only — never `db reset` on production):
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push            # all files in supabase/migrations
   npm run db:seed                 # permissions + system units (idempotent)
   ```
   The migrations also create the private Storage bucket **`documents`** and its
   policies — do not create buckets by hand.

## 3. Supabase Auth (mandatory settings)

Authentication → Providers → Email:

| Setting | Value | Why |
|---|---|---|
| Enable email provider | ON | password + email-code login |
| **Allow new users to sign up** | **ON** | invited staff / customers / vendors create their login with the email code on first sign-in. Strangers who sign up get **no** access (invitation required). |
| **Confirm email** | **ON — never turn off** | invitations are linked only to verified addresses (`email_confirmed_at`). With confirmation OFF anyone could register an invited address. |
| Email OTP length | 6 | the login screen asks for a 6-digit code |
| Secure password change | ON | |

Authentication → **Email Templates**: for **Magic Link** and **Confirm signup**
use the content of `supabase/templates/otp.html` (it shows `{{ .Token }}` — the
code — plus the link). Subject: "Your sign-in code".

Authentication → **URL Configuration**: Site URL = `https://<your-domain>`;
Redirect URLs = `https://<your-domain>/**`.

Authentication → **SMTP Settings**: enable custom SMTP with the same mailbox as
the ERP (the built-in Supabase mailer is limited to a few emails per hour and
is not for production). Rate limits → emails per hour: e.g. 100.

## 4. First owner + company

1. Authentication → Users → **Add user** → email + password, tick **Auto confirm user**.
2. ```bash
   DATABASE_URL=… APP_INSTANCE_ID=<new-unique-id> ADMIN_EMAIL=<that email> \
   COMPANY_CODE=RU COMPANY_LEGAL_NAME="Rukman Udyog Pvt Ltd" COMPANY_GSTIN=… \
   npm run instance:init
   DATABASE_URL=… APP_INSTANCE_ID=<same id> npm run instance:verify   # must print OK
   ```
   The admin becomes **OWNER** (+ADMIN) of the company.
3. Log in → **Settings**: company profile (address, GSTIN, email — printed on the
   PO PDF), portals, visibility, email switches, reminders. Negative stock stays
   OFF unless the owner decides otherwise.
4. **Users & roles** → invite staff (they sign in with the email code, then set a
   password under *My account*). **Customers & vendors** → *Portal access*.

Document numbering prefixes and approval rules have no screen yet: change them
in Supabase → Table editor → `document_sequences` / `approval_policies` (rows of
your company) if the defaults (PO-, SO-, … per financial year) do not fit.

## 5. Web app (Cloudflare Pages)

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm ci && npm --workspace web run build` |
| Build output directory | `web/out` |
| Node version | env `NODE_VERSION=22` |
| Environment variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_NAME`, `NEXT_PUBLIC_PRIMARY_COLOR`, optional `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_FAVICON_URL` |

Only `NEXT_PUBLIC_*` values are used by the browser; **never** put the
service-role key, SMTP password or `DATABASE_URL` into the Pages project.
`web/public/_headers` adds security headers (CSP, no framing, HSTS). If the
Supabase project uses a custom domain, add it to `connect-src` / `img-src`
there. Custom domain: Pages → Custom domains; then update the Supabase Site URL.

## 6. Email worker (GitHub Actions)

Repository → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Example |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.zoho.in` / `465` / `true` (587 → `false`, STARTTLS) |
| `SMTP_USER` / `SMTP_PASSWORD` | mailbox login / app password |
| `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` | `erp@company.com` / `Rukman Udyog` |

`.github/workflows/email-worker.yml` runs every 10 minutes (scheduled workflows
run only on the **default branch** — merge first) and on *Run workflow*. Each
run sends queued emails and generates the day's payment reminders (idempotent:
one reminder per bill per day / week). Check: Actions → email-worker → logs
(`claimed=… sent=… failed=…`) and the ERP **Email log**. The sender domain needs
SPF/DKIM for the SMTP provider, otherwise mails land in spam.

Alternative host: any server/container — `cd worker && npm ci --omit=dev && node src/main.ts loop`.

## 7. Production smoke test (after deployment)

1. Owner logs in (password) → Dashboard loads; *My account* → change password.
2. Settings → turn ON Email automation → create a test vendor with your own
   email → confirm a PO → within 10 minutes the PO PDF arrives; Email log = SENT.
3. Upload a PDF to a customer bill → invoice email arrives.
4. Invite a test customer email → sign in with the email code → portal shows
   only that customer. Turn the portal OFF in Settings → access refused.
5. Actions → db-backup → Run → artifact appears.

## 8. Security checklist

- [ ] Confirm email ON, OTP template with `{{ .Token }}`, custom SMTP for Auth.
- [ ] Service-role key only in GitHub secrets (worker, backup) — not in Pages.
- [ ] `npm run instance:verify` OK (RLS on every table, no anonymous access).
- [ ] Owner account uses a strong password; at least two OWNER users.
- [ ] Supabase → Database → Network restrictions (optional) / SSL enforced.
- [ ] Repository is private.

## 9. Backup & recovery

**Backup** — `.github/workflows/db-backup.yml`, nightly 02:37 IST: database data
(`supabase db dump --data-only`, app configuration tables excluded because the
migrations create them) + all files of the `documents` bucket →
`backup-<date>.tar.gz`, encrypted with AES-256 (`BACKUP_PASSPHRASE`), kept 30
days as a private artifact. Secrets: `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE`. Download a backup to off-site
storage at least weekly. Supabase Pro additionally provides daily backups / PITR.

**Restore** (tested by `scripts/backup/drill-local.sh`: data and files identical):
1. Create a **new** Supabase project, configure Auth (§3).
2. `npx supabase link --project-ref <new>` → `npx supabase db push` (migrations only, **no** `db:seed`).
3. `gpg -d backup-<date>.tar.gz.gpg > backup.tar.gz`
4. `DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… bash scripts/backup/restore.sh backup.tar.gz`
   (refuses a non-empty database). Users keep their passwords.
5. Point the Pages env + GitHub secrets to the new project, redeploy, run §7.

## 10. Release test suite

```bash
npm ci
PGHOST=/var/run/postgresql npm run db:test          # SQL + concurrency (local PostgreSQL)
npm run lint && npm run typecheck && npm run build  # web + worker
npm run test:worker
supabase start && supabase db reset                 # production-like local stack (supabase/config.toml)
npm run test:e2e:api                                # auth/OTP via Mailpit, storage security, worker + SMTP
npm run test:e2e:ui                                 # Playwright: full flow, auth, permissions, mobile
bash scripts/e2e/worker-container-smoke.sh          # worker exactly as the scheduled job
bash scripts/backup/drill-local.sh                  # backup → wipe → restore
```
