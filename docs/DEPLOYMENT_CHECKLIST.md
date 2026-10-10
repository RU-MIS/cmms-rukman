# Final deployment checklist — production handoff

Release candidate: branch `claude/charming-gauss-o9fvzf` (merge to the default
branch before deploying — scheduled workflows run only there).
Details behind every step: `docs/DEPLOYMENT.md`. Audit: `docs/RELEASE_AUDIT.md`.
Nothing has been deployed. All steps below are manual.

---

## Value classification

| Value | Class | Where it goes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Public** (frontend, visible in the browser) | Cloudflare Pages env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Public** (frontend; safe — RLS protects data) | Cloudflare Pages env |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_NAME`, `NEXT_PUBLIC_PRIMARY_COLOR`, `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_FAVICON_URL` | **Public** (branding) | Cloudflare Pages env |
| `NODE_VERSION=22` | Public (build setting) | Cloudflare Pages env |
| `SUPABASE_URL` | Server-side config (not secret, same as public URL) | **GitHub Secret** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-side SECRET** — bypasses RLS | **GitHub Secret** only. NEVER in Pages / browser / chat |
| `DATABASE_URL` (Session pooler URI with DB password) | **Server-side SECRET** | **GitHub Secret** + admin PC shell only |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` | Server-side config | **GitHub Secret** |
| `SMTP_PASSWORD` | **Server-side SECRET** | **GitHub Secret** + Supabase Auth SMTP form |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Server-side config | **GitHub Secret** |
| `BACKUP_PASSPHRASE` | **Server-side SECRET** — keep a copy offline; backups are useless without it | **GitHub Secret** |
| `APP_INSTANCE_ID` | Admin config (not secret) | admin PC shell (`instance:init` / `instance:verify`) |
| Sign-ups ON, Confirm email ON, OTP length 6, email templates, custom SMTP, Site URL, Redirect URLs | **Supabase configuration** | Supabase dashboard → Authentication |
| Database password | **Server-side SECRET** | password manager; part of `DATABASE_URL` |

---

## A. What you create / configure manually

- [ ] Supabase account + **new project** (region: Mumbai `ap-south-1`).
- [ ] SMTP mailbox on your own domain (e.g. `erp@company.com`) with an app password (Zoho / Google Workspace / Amazon SES / Brevo).
- [ ] DNS records at your domain registrar: SPF, DKIM, DMARC (section E).
- [ ] Cloudflare account + Pages project connected to the GitHub repository.
- [ ] GitHub: repository **private**, PR of this branch merged to the default branch, 11 repository secrets (section D), Actions enabled.
- [ ] Admin PC with Node 22, `psql` (PostgreSQL 15+ client), git, and `npx supabase login` done once.
- [ ] Password manager entries: DB password, service-role key, SMTP password, `BACKUP_PASSPHRASE`.
- [ ] Choose: production domain (e.g. `erp.company.com`), `APP_INSTANCE_ID` (e.g. `rukman-prod-2026`), company code / legal name / GSTIN, first owner email.

## B. Supabase steps (exact)

1. supabase.com → **New project** → name `rukman-erp-prod`, region Mumbai, strong DB password → Create.
2. **Project Settings → API**: copy Project URL, `anon` key (public), `service_role` key (secret).
3. **Connect → Session pooler** → copy URI → replace `[YOUR-PASSWORD]` → this is `DATABASE_URL`
   (`postgresql://postgres.<ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`). Do **not** use `db.<ref>.supabase.co` (IPv6-only; GitHub runners cannot reach it).
4. On the admin PC, in the repository (default branch, release commit):
   ```bash
   npm ci
   npx supabase link --project-ref <ref>          # asks for the DB password
   npx supabase db push                           # applies all 47 migrations (upgrade of an existing instance: docs/PLATFORM_R4_RELEASE_AUDIT.md §6)
   DATABASE_URL='<session pooler URI>' npm run db:seed
   npx supabase functions deploy admin-users      # User Management Center (create login / reset / disable)
   ```
   The function gets `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase automatically — set no secret for it.
   The migrations create the private buckets `documents`, `item-images` and `company-assets` (branding) and all RLS / storage policies — create nothing by hand.
5. **Authentication → Sign In / Providers → Email**:
   - Email provider: **ON**
   - Allow new users to sign up: **ON**
   - **Confirm email: ON** (mandatory; never switch off — finding C1)
   - Email OTP length: **6**, OTP expiry: 3600 s
   - Secure password change: **OFF** (default)
   - **Authentication → Policies → Minimum password length**: at least the strictest company password policy (Settings → Security, default 10). The ERP enforces the company policy in the `admin-users` function; this setting covers direct Auth API calls.
6. **Authentication → Email Templates** → *Magic Link* and *Confirm signup*: subject `Your sign-in code`; body = full content of `supabase/templates/otp.html` (contains `{{ .Token }}` and `{{ .ConfirmationURL }}`).
7. **Authentication → URL Configuration**: Site URL `https://erp.company.com`; Redirect URLs `https://erp.company.com/**` (add the `*.pages.dev` URL too until the custom domain is live).
8. **Authentication → Emails → SMTP Settings**: Enable custom SMTP → host / port / user / password of your mailbox, sender email `erp@company.com`, sender name = company name. **Rate limits**: emails per hour ≥ 100.
9. **Database → Settings**: SSL enforcement ON (default).

## C. Cloudflare Pages steps (exact)

1. Cloudflare dashboard → Workers & Pages → **Create → Pages → Connect to Git** → choose the repository → production branch = default branch.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm ci && npm --workspace web run build`
   - Build output directory: `web/out`
   - Root directory: *(empty — repository root)*
3. Environment variables (Production): `NODE_VERSION=22`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_NAME`, `NEXT_PUBLIC_PRIMARY_COLOR`, optional `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_FAVICON_URL`. **Nothing else** (no service key, no SMTP, no DATABASE_URL).
4. Save and Deploy → open the `*.pages.dev` URL → login page shows.
5. Custom domains → add `erp.company.com` → follow the DNS prompt → wait for the certificate.
6. Check the security headers once: browser dev-tools → Network → document → `content-security-policy`, `x-frame-options: DENY` present (from `web/public/_headers`). If Supabase uses a custom domain, add it to `connect-src` and `img-src` in that file.

## D. GitHub Secrets required (exact names)

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Used by | Value |
|---|---|---|
| `SUPABASE_URL` | email-worker, db-backup | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | email-worker, db-backup | service_role key |
| `DATABASE_URL` | db-backup | Session pooler URI (B.3) |
| `BACKUP_PASSPHRASE` | db-backup | long random passphrase (≥ 32 chars), also stored offline |
| `SMTP_HOST` | email-worker | e.g. `smtp.zoho.in` / `smtp.gmail.com` |
| `SMTP_PORT` | email-worker | `465` or `587` |
| `SMTP_SECURE` | email-worker | `true` for 465, `false` for 587 |
| `SMTP_USER` | email-worker | mailbox login |
| `SMTP_PASSWORD` | email-worker | mailbox app password |
| `EMAIL_FROM_ADDRESS` | email-worker | `erp@company.com` (same domain as SPF/DKIM) |
| `EMAIL_FROM_NAME` | email-worker | company name |

Workflows: `email-worker.yml` (every 10 min; sends queued mails + daily reminders), `db-backup.yml` (nightly 02:37 IST). Scheduled runs start only after the branch is merged to the **default branch**.

## E. SMTP / DNS requirements (exact)

For the domain of `EMAIL_FROM_ADDRESS` (records come from your SMTP provider's admin panel):

| Record | Type | Requirement |
|---|---|---|
| SPF | TXT on `@` | exactly **one** SPF record including your provider, e.g. `v=spf1 include:zoho.in ~all` / `include:_spf.google.com` / `include:amazonses.com`; merge into an existing SPF record instead of adding a second one |
| DKIM | TXT or CNAME on `<selector>._domainkey` | the key published by the provider; enable signing in the provider panel after DNS propagates |
| DMARC | TXT on `_dmarc` | start with `v=DMARC1; p=none; rua=mailto:dmarc@company.com`; move to `p=quarantine` after a clean week |
| Mailbox | — | app password (2-step verification on); daily sending limit ≥ expected volume (POs + invoices + reminders + auth codes) |

The same mailbox is configured twice: Supabase Auth SMTP (B.8) for sign-in codes, and GitHub secrets (D) for ERP emails. Port 465 = implicit TLS (`SMTP_SECURE=true`); 587 = STARTTLS (`SMTP_SECURE=false`).

## F. First-admin setup (exact)

1. Supabase → Authentication → Users → **Add user → Create new user** → owner email + strong password → tick **Auto Confirm User**.
2. Admin PC:
   ```bash
   export DATABASE_URL='<session pooler URI>'
   APP_INSTANCE_ID=rukman-prod-2026 ADMIN_EMAIL=owner@company.com COMPANY_CODE=RU \
   COMPANY_LEGAL_NAME="Rukman Udyog Pvt Ltd" COMPANY_GSTIN=<gstin> npm run instance:init
   APP_INSTANCE_ID=rukman-prod-2026 NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co npm run instance:verify
   ```
   `instance:verify` must print `OK: instance rukman-prod-2026, 1 companies, RLS on every table, no anonymous access`.
3. Owner signs in at `https://erp.company.com` (password) → **Settings**:
   Company profile (legal name, address, GSTIN, email) → Save profile; keep Negative stock **OFF**; set portals / visibility / email / reminders as decided → Save settings.
4. **Users & roles** → invite a **second OWNER** (backup owner) and the staff. They sign in with *Email code (OTP)*, then set a password under *My account*.
5. Masters: Godowns & locations, Items & packing, Customers & vendors (email + credit days), bank/cash accounts (Supabase table editor `accounts`, sub type BANK, under group *Bank Accounts*).

## G. Smoke test after deployment (exact sequence)

| # | Step | Expected |
|---|---|---|
| 1 | Open the site anonymously → `/erp/` | redirected to login |
| 2 | Owner password login → *My account* → change password → Logout → login with new password | works; old password refused |
| 3 | Login tab *Email code (OTP)* with the second owner's email | 6-digit code arrives within a minute (from your domain, not spam) → logged in |
| 4 | Settings → Email automation **ON** | saved |
| 5 | Create godown + rack/bin, item with packing, Stock IN 100 into the bin | Inventory shows 100; item detail shows `Godown / RACK-SHELF-BIN` |
| 6 | Stock OUT 101 | rejected "Insufficient stock" |
| 7 | Create vendor with **your own email** → Purchase order → Confirm | PO email with PO PDF arrives within 10 min; Email log = SENT |
| 8 | Receiving: receive part of the PO | pending reduced; over-receiving refused |
| 9 | Create customer with a second email of yours → *Portal access* → that email | customer signs in with code → sees only own data |
| 10 | Customer creates PO with quoted price → owner approves with a modified price + reserve → dispatch | reserved/available correct; order PARTIALLY DISPATCHED |
| 11 | Record Tally invoice + upload PDF | customer receives the invoice email; portal shows the PDF |
| 12 | Settings → customer portal OFF | customer gets "portal is currently turned off" |
| 13 | GitHub → Actions → db-backup → Run workflow | green; artifact `backup-…` present |
| 14 | Actions → email-worker runs every 10 min | green; logs `claimed=… sent=… failed=0` |
| 15 | Delete / cancel smoke-test data you do not want (or keep a separate "TEST" company) | — |

## H. Rollback procedure

| Situation | Action |
|---|---|
| Web app broken after a release | Cloudflare Pages → Deployments → previous deployment → **Rollback to this deployment** (instant, no data change). |
| Emails wrong / flooding | Settings → Email automation **OFF** (immediate, queued mails become SKIPPED), and/or GitHub → Actions → email-worker → **Disable workflow**. Re-enable after fixing; use *Email log → Retry* where needed. |
| A new migration misbehaves | Before every `db push`: run **db-backup** manually and download the artifact. Each migration file is transactional (a failing file changes nothing), but files applied before it in the same push stay applied. Undo = a new corrective migration; last resort = restore the pre-release backup into a **new** project (section I) and point Pages env + GitHub secrets to it. Never edit or delete applied migration files. |
| Wrong business setting | Settings → set back (audited). |
| Compromised key | Supabase → API → **roll** the service_role / JWT secret → update GitHub secrets (and Pages anon key if rolled) → redeploy. Change SMTP password → update Supabase SMTP + GitHub secret. |

## I. Backup / restore procedure

**Backup (automatic):** `db-backup.yml` nightly 02:37 IST → `scripts/backup/backup.sh` → database data (Supabase CLI data dump) + all files of bucket `documents` → `backup-<date>.tar.gz.gpg` (AES-256, `BACKUP_PASSPHRASE`) → private artifact, 30 days. **Weekly:** download the newest artifact to off-site storage. Manual run: Actions → db-backup → Run workflow (also before every migration).

**Restore** (tested: `scripts/backup/drill-local.sh`, data and files identical):
1. New Supabase project; configure Auth exactly as B.5–B.8.
2. `npx supabase link --project-ref <new>` → `npx supabase db push` (**no** `db:seed`).
3. `gpg -d backup-<date>.tar.gz.gpg > backup.tar.gz` (asks for `BACKUP_PASSPHRASE`).
4. `DATABASE_URL=<new pooler URI> SUPABASE_URL=https://<new>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<new key> bash scripts/backup/restore.sh backup.tar.gz` (refuses a non-empty database; users keep passwords).
5. `APP_INSTANCE_ID=<same id> npm run instance:verify` → OK.
6. Update Cloudflare Pages env + GitHub secrets to the new project → redeploy → smoke test G.1–G.4.

## J. Final GO / NO-GO checklist

GO only if **every** box is ticked:

- [ ] PR merged to the default branch; deployed commit = tested commit.
- [ ] Release suite green on that commit (`docs/PLATFORM_R4_RELEASE_AUDIT.md` §3): SQL 35/35, API e2e 19/19, browser e2e 44/44, lint, typecheck, build, worker unit 7/7, worker container smoke, backup drill.
- [ ] `docs/RELEASE_AUDIT.md` reviewed and the LOW risks accepted by the owner.
- [ ] Supabase: 47 migrations applied, seed applied, buckets `documents`, `item-images` and `company-assets` exist (Storage), Edge Function `admin-users` deployed (Edge Functions list), `instance:verify` OK (includes "no TRUNCATE for API roles"); `service_role` has `statement_timeout=120s` (`select rolconfig from pg_roles where rolname = 'service_role'`).
- [ ] Auth: sign-ups ON, **Confirm email ON**, OTP 6 digits, both templates show the code, custom SMTP set, Site URL + Redirect URLs = production domain.
- [ ] DNS: SPF, DKIM, DMARC published and verified in the SMTP provider; test mail not in spam.
- [ ] Cloudflare Pages: only `NEXT_PUBLIC_*` + `NODE_VERSION`; custom domain with TLS; security headers present.
- [ ] GitHub: repository private; all 11 secrets set; email-worker and db-backup each ran green once; first backup artifact downloaded and decryptable with the offline passphrase copy.
- [ ] Owner + second owner can log in; company profile filled; negative stock OFF unless decided.
- [ ] Smoke test G.1–G.14 passed.
- [ ] Rollback contacts/steps (section H) known to the person deploying.

**NO-GO** if any of: Confirm email OFF · OTP email without code · service-role key in Pages env or in the repository · email-worker or db-backup red · `instance:verify` not OK · smoke test step 6, 9, 10 or 12 failing.
