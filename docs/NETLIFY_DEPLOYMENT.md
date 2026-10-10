# Netlify hosting — Rukman Dataflow Management System (production application)

This branch, `claude/netlify-production-hosting`, is the **production application exactly as deployed today**
(`main` = `5cff5d6`) plus `netlify.toml` and this guide. It changes **hosting only**:

- no application code change, no database migration, no Supabase setting is changed by the code;
- the web app is a **static site** (Next.js static export in `web/out`); Netlify only serves files;
- all data and all security checks stay in the existing production Supabase project (PostgreSQL row-level security and
  permission-checked database functions); no Netlify Functions and no secrets on Netlify.

The R1–R4 work (user center, approvals, audit viewer, password show / hide, …) is **not** included. It needs 23 database
migrations and is released separately later (`claude/charming-gauss-o9fvzf`, `docs/PLATFORM_R4_RELEASE_AUDIT.md`).

| File | Purpose |
|---|---|
| `netlify.toml` | build command `npm --workspace web run build`, publish `web/out`, Node 22, cache headers for hashed assets |
| `web/public/_headers` | security headers (CSP, HSTS, X-Frame-Options, …) — unchanged; same file format on Netlify and Cloudflare Pages |
| `web/.env.example` | the variables the web build needs (all public) |

Verified locally on this branch (no production access): Netlify CLI 27.12.0 / `@netlify/build` 37.4.1
`netlify build --offline --filter @rukman/web` succeeds (Netlify's Next.js Runtime 5.16.2 is applied automatically and adds
no server functions for a static export); Netlify's header parser accepts `_headers` and `netlify.toml` (0 errors); the
production test suites pass against a local Supabase with production's exact 24-migration schema. `netlify dev` cannot run
in the build sandbox (it downloads the Deno runtime from a blocked host), so the first real Netlify deploy is the remaining
check (§4).

---

## 1. Netlify site settings

| Setting | Value |
|---|---|
| Repository | `ru-mis/cmms-rukman` |
| Production branch | `claude/netlify-production-hosting` (until this file is merged into `main`; then `main`) |
| Base directory | *(empty — repository root)* |
| Package directory | `web` |
| Build command / Publish directory | from `netlify.toml` (`npm --workspace web run build` / `web/out`) — do not override |
| Node | 22 (from `netlify.toml`) |
| Deploy previews | **Don't deploy** |
| Branch deploys | **Deploy only the production branch** |

Every push to the production branch deploys. Push to it only what has been reviewed.

## 2. Environment variables (Site configuration → Environment variables)

Scope: **Builds**; deploy context: **Production only** (not "All"). They are compiled into the public JavaScript — expected.
Use the **same values as the current Cloudflare Pages production environment**.

| Variable | Required | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` (`https://<project-ref>.supabase.co`) | yes | no — public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon / publishable key) | yes | no — public by design; RLS protects the data |
| `NEXT_PUBLIC_APP_NAME` (`Rukman Dataflow Management System`) | recommended | no |
| `NEXT_PUBLIC_APP_SHORT_NAME` (`Rukman DMS`) | recommended | no |
| `NEXT_PUBLIC_PRIMARY_COLOR` (`#1f4e79`) | recommended | no |
| `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_FAVICON_URL` | optional | no |

**Never** set in Netlify: the service-role key, `DATABASE_URL`, `SMTP_*`, `BACKUP_PASSPHRASE`, any GitHub or Supabase
access token. They stay in GitHub Secrets (email worker, backups). Netlify needs no secret.

Why previews stay off: a preview built with these variables talks to the **production** database. The anon key alone
reads nothing (row-level security needs a signed-in user), but a real user signing in on a preview would run unreviewed
code with real permissions. Turn previews on only after a separate staging Supabase project exists, with the staging
values in the *Deploy Previews* context.

## 3. Supabase Auth URLs (production project, Authentication → URL Configuration)

- **While Cloudflare is still the main address:** keep the **Site URL** unchanged; **add** `https://<name>.netlify.app/**`
  to **Redirect URLs**.
- **When users move to Netlify:** set the **Site URL** to the Netlify address (or the custom domain); keep the Cloudflare
  address in Redirect URLs until Cloudflare is retired.
- Do **not** add deploy-preview addresses (`*--<name>.netlify.app`).

Why only these: login is by password or by a typed 6-digit e-mail code; the code passes no redirect address and there is
no password-reset e-mail. The only domain-dependent part is the link in the code e-mail (`{{ .ConfirmationURL }}`), which
opens the Site URL. Sessions are stored per web address, so users sign in once more on the new address.

## 4. Steps (first deployment — only after approval)

1. Netlify → **Add new project → Import an existing project → GitHub** → `ru-mis/cmms-rukman`.
2. Apply §1 (branch, package directory `web`, previews off) and §2 (variables, Production context) **before** the first build.
3. Deploy (about 1–2 minutes).
4. **Short URL**: Site configuration → General → **Change site name** → e.g. `rukman-dms` → `https://rukman-dms.netlify.app`.
5. Headers: `curl -sI https://<name>.netlify.app/login/` shows `content-security-policy`, `strict-transport-security`,
   `x-frame-options: DENY`.
6. Supabase Redirect URLs (§3, first bullet).
7. Smoke test (§6) on desktop, Android and iPhone.

## 5. Custom domain (later)

1. Netlify → Domain management → **Add a domain** → e.g. `erp.rukmanudyog.com`.
2. DNS: **CNAME** `erp` → `<name>.netlify.app` (or delegate the domain to Netlify DNS).
3. HTTPS certificate is issued automatically (Let's Encrypt); keep *Force HTTPS* on.
4. Add `https://erp.rukmanudyog.com/**` to the Supabase Redirect URLs; set it as Site URL when users move.
5. No code or header change (the CSP names only Supabase, not the site's own domain).

## 6. Smoke test on the Netlify address (production data — read-mostly)

Prefer reading; create test records only in a separate "TEST" company or delete them afterwards.

1. `/erp/` anonymously → redirected to `/login/`.
2. Owner: password login → dashboard loads with the company's real figures → Logout.
3. Second account: **Email code** tab → 6-digit code arrives → login works.
4. Open Inventory, Items, Customers & vendors, Purchase orders, Sales orders, Payments: lists load, no error message.
5. Operator account: no Settings / Users menu; a direct `/erp/settings/` shows no editable settings.
6. Customer portal login (code) → only that customer's data.
7. Phone check (Android Chrome, iPhone Safari): login, menu opens, no sideways scrolling.
8. Compare a few numbers with the Cloudflare address (same database → identical).

## 7. Cloudflare stays the rollback

- Cloudflare Pages is not changed. Both addresses use the same database, so both always show the same data.
- Rollback = tell users to use the Cloudflare address again and, if it was changed, set the Supabase Site URL back. No
  data or schema change to undo.
- Netlify's own rollback: Deploys → earlier deploy → **Publish deploy**.
- Retire Cloudflare only after Netlify has run without problems for an agreed period.
- Cloudflare ignores `netlify.toml`; merging this branch into `main` later rebuilds the same application on Cloudflare.
