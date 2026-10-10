# Deployment readiness and migration plan — Netlify hosting and the R1–R4 release

Status: **plan only.** Nothing was merged, deployed or migrated. Production (`main` = `5cff5d6`, Cloudflare Pages + the
production Supabase project) was not accessed. All checks ran on disposable local copies: git, a throw-away PostgreSQL
database with production's exact schema, the local Supabase stack reset to production's 24 migrations, and local
builds with the Netlify CLI (27.12.0, `@netlify/build` 37.4.1, Next.js Runtime 5.16.2).

Items marked **UNVERIFIED** need access this environment does not have (production Supabase dashboard, Cloudflare,
Netlify account).

---

## 1. The three branches

| Branch | Head | Commits beyond `main` | Migrations | Last migration | Edge Functions |
|---|---|---|---|---|---|
| `main` (production) | `5cff5d6` | — | 24 | `20261007000009_release_hardening` | none |
| `claude/charming-gauss-o9fvzf` (R4 release candidate) | `6cc8774` | 34 (R1 `756be6a…a1a4c5c`, R2 `0ed1455…292bcce`, R3 `15e2d59…3eae044`, R4 `d336648`, `6cc8774`) | 47 | `20261010000012_r4_import_queue` | `admin-users` |
| `claude/netlify-hosting` | `54a3d36` | 35 (= R4 + 1) | 47 | `20261010000012_r4_import_queue` | `admin-users` |

History is linear: `main` → R4 → `claude/netlify-hosting`. `main` has nothing that the others lack.

The one Netlify commit (`54a3d36`) touches no migration and no database object:
`netlify.toml`, `docs/NETLIFY_DEPLOYMENT.md`, `.gitignore`, `web/eslint.config.mjs`, the password show / hide toggle
(`web/src/components/ui.tsx`, `login`, `PasswordGate`, `account`) and its browser test.

The 23 pending migrations (`20261008000001` … `20261010000012`) are listed in `docs/PLATFORM_R4_RELEASE_AUDIT.md` §2.3;
production's 24 migration files are byte-identical on all branches.

## 2. Can Netlify hosting be deployed without the 23 migrations?

**Yes — but only from production's code, not from `claude/netlify-hosting`.**

`netlify.toml` and `web/public/_headers` are hosting configuration and work with any version of the app: production's
`web/next.config.ts` already uses the static export (`output: 'export'`, `trailingSlash: true`) and already ships the same
security headers file. The `claude/netlify-hosting` branch, however, carries the whole R1–R4 application on top.

**Option A candidate** = `main` (`5cff5d6`) + `netlify.toml` only (no application change). Tested locally:

| Check | Result |
|---|---|
| `netlify build --offline --filter @rukman/web` on `5cff5d6` + `netlify.toml` | **PASS** (18.4 s; publishes `web/out`; the Next.js Runtime adds no server functions) |
| Netlify header parser on that build's `_headers` + `netlify.toml` | **PASS** (0 errors) |
| Production's API e2e suite against production's schema (local Supabase at 24 migrations) | **PASS** 4 / 4 |
| Production's browser e2e suite against the same | **PASS** 16 / 16 |

The password show / hide toggle is application code built on R4; it is **not** part of Option A (it can ship with the
R4 release, or be ported to `main` separately later).

## 3. Schema compatibility of each candidate with the production database

Static check: every `rpc('…')`, table / view (`.from('…')`) and storage bucket referenced by `web/src` and `worker/src`,
compared with the objects of production's schema (built from the 24 migrations of `main`).

| Code | Referenced objects | Missing in production | Runtime against production's schema |
|---|---|---|---|
| `main` (also = Option A) | 89 | **0** | API 4 / 4, browser 16 / 16 — **compatible** |
| R4 / `claude/netlify-hosting` | 161 | **71** — 52 functions (e.g. `role_save`, `admin_users`, `approval_inbox`, `audit_search`, `settings_save`, `import_create`, `import_claim_next`), 17 tables / views (e.g. `v_items`, `company_branding`, `approval_actions`, `departments`, `import_jobs`), 2 storage buckets (`item-images`, `company-assets`); it also calls the Edge Function `admin-users`, which is not in `main` | API **4 / 19** (15 fail: "Could not find the function … in the schema cache"); browser **7 / 45** (§3.1) — **incompatible** |

Conclusion: code from `claude/netlify-hosting` (or R4) **must not** be deployed against the current production database.
It needs the 23 migrations and the `admin-users` function first. The reverse direction was measured in R4: production's
current web app on the upgraded database works except creating / editing items.

### 3.1 Browser suite of the new code against production's schema

Current browser suite (45 tests) of `claude/netlify-hosting` against the local Supabase stack at production's 24
migrations: **7 passed, 8 failed, 30 not run** (they follow a failed step in the same serial journey). The failures cover
every area: control-center settings, roles & users, item master, approvals / administration, the J33 acceptance
journey and account / password screens. The 7 that pass are login, logout, route protection and portal-separation checks
that use only objects production already has.

## 4. Netlify configuration and environment variables

From `netlify.toml` (repository root): base = repository root, command `npm --workspace web run build`, publish
`web/out`, `NODE_VERSION = 22`, immutable caching for `/_next/static/*`. In the Netlify UI: base directory empty,
**package directory `web`**, build command / publish directory left to the file.

Environment variables read by the web code — identical on `main` and on the new branch (checked in the source):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | production project URL (same value as in Cloudflare Pages) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | the anon / publishable key (same as Cloudflare) |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_NAME`, `NEXT_PUBLIC_PRIMARY_COLOR` | recommended | branding |
| `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_FAVICON_URL` | optional | branding |

Scope them to the **Production** deploy context only (§7). Copy the values from the Cloudflare Pages production
environment — **UNVERIFIED** what is set there today.

`docs/NETLIFY_DEPLOYMENT.md` §2 lists the same set (five required + the two optional logo / favicon URLs).

## 5. Browser bundle: only the Supabase URL and the anon key

Checked on both builds (Option A and `claude/netlify-hosting`), built with the local stack's real keys so the
service-role key could be searched for literally:

| Check | Option A | `claude/netlify-hosting` |
|---|---|---|
| JWTs in the bundle | 1 — the configured anon key (`role: anon`) | 1 — the anon key (`role: anon`) |
| service-role key, `postgres://` URL, `SUPABASE_SERVICE_ROLE_KEY` / `SMTP_PASSWORD` / `BACKUP_PASSPHRASE` / `DATABASE_URL` names, private keys | none | none |
| `sb_secret_` text | only inside supabase-js (`startsWith("sb_secret_")` key-format check) — not a key | same |
| `process.env.*` reads in `web/src` other than `NEXT_PUBLIC_*` | 0 | 0 |

Privileged credentials live only in GitHub Secrets (worker, backups) and in Supabase (Edge Function). Netlify needs none.

## 6. Supabase Auth: redirects, login, password reset, domain-dependent settings

What the code does (identical on both code lines):
- **Login:** e-mail + password (`signInWithPassword`) or e-mail code (`signInWithOtp` → the user types the 6-digit code →
  `verifyOtp`). No `emailRedirectTo` / `redirectTo` is passed anywhere, so login does not depend on the site's domain.
- **E-mail template** (`supabase/templates/otp.html`) contains the code **and** `{{ .ConfirmationURL }}`; that link opens
  the project's **Site URL**. While the Site URL is the Cloudflare address, a user who clicks the link instead of typing
  the code lands on Cloudflare — harmless while Cloudflare stays live.
- **Password reset:** there is **no** self-service "forgot password" e-mail flow (`resetPasswordForEmail` is not used).
  On `main` a user signs in with an e-mail code and sets a new password on the Account page (`updateUser`); on R4 an
  administrator issues a temporary password (Edge Function). Neither depends on redirect URLs.
- **Sessions are per domain** (browser storage). Moving users from the Cloudflare address to the Netlify address means
  one new sign-in each; nothing else.
- **CORS:** PostgREST / Auth / Storage accept any origin with the anon key; the `admin-users` function (R4 only) answers
  `*` and authenticates by bearer token. No domain allow-list to update.
- **E-mails sent by the worker** contain no links to the site.

Production settings to check in the Supabase dashboard before switching users — **UNVERIFIED** (no access):
Authentication → URL Configuration (Site URL, Redirect URLs), Email provider (Confirm email ON, OTP length 6), the OTP
template, Rate limits. Add `https://<site>.netlify.app/**` (and later the custom domain) to the Redirect URLs; change the
Site URL only when users move.

## 7. Deploy previews — can they reach production data?

What a preview can do: Netlify builds pull requests (Deploy Previews) and other branches (Branch deploys) on public
`*--<site>.netlify.app` addresses. If the Supabase variables are set for *all* contexts (Netlify's default when a
variable is added), every preview talks to the **production** database.

- The anon key alone gives no data: row-level security requires a signed-in user, so an anonymous visitor of a preview
  sees nothing.
- **But** a real user who signs in on a preview runs **unreviewed code** with his real rights — e.g. a preview of the R4
  branch would call missing functions against production (fails safely), and a malicious or buggy preview could act
  within that user's permissions or capture his password on a look-alike login page.

Required settings (Netlify, **UNVERIFIED** until the site exists):
1. Site configuration → Build & deploy → Branches and deploy contexts: **Deploy previews: Don't deploy**, **Branch
   deploys: Deploy only the production branch**.
2. Environment variables: scope `NEXT_PUBLIC_SUPABASE_*` to the **Production** context only.
3. Do **not** add preview addresses (`*--<site>.netlify.app`) to the Supabase Redirect URLs.
4. Later, with a staging Supabase project, give the Deploy-preview context the staging values and turn previews back on.

The same question applies to **Cloudflare Pages today** — **UNVERIFIED**: Cloudflare builds preview deployments for
pushed branches by default (`claude/charming-gauss-o9fvzf` and `claude/netlify-hosting` have been pushed). If the
Cloudflare *Preview* environment has the production Supabase variables, R1–R4 previews exist at `*.pages.dev` against
the production database. Check Cloudflare → the Pages project → Deployments / Settings → Environment variables
(Preview) and, if so, delete those preview deployments or remove the Preview variables.

## 8. Rollback

**Option A (hosting only):**
- Cloudflare Pages stays the production deployment and is not changed; the database is not touched.
- The Netlify site runs in parallel; users move only after it passes the smoke test.
- Rollback = send users back to the Cloudflare address (and, if it was changed, set the Supabase Site URL back). No data,
  schema or Cloudflare change to undo.
- Merging `netlify.toml` to `main` triggers a Cloudflare rebuild of the **same** application (Cloudflare ignores
  `netlify.toml`); if that is unwanted, the file can stay on a dedicated branch that only Netlify builds.

**Option B (R4 + Netlify together):**
- The database change is one-way (no down-migrations). After `db push`, the previous web app (Cloudflare) can no longer
  create / edit items, so Cloudflare is **not** a complete rollback any more.
- Rollback = restore the pre-release backup into a **new** Supabase project and repoint the app (rehearsed in R4,
  BAK-1 / BAK-2), or fix forward with a corrective migration.

## 9. Is a staging environment needed?

- **Option A:** not required. Application and database are unchanged; the Netlify site itself is tested in parallel
  before users move. A staging Supabase project is still useful to re-enable deploy previews safely later.
- **Option B:** **yes, required** before production: a staging Supabase project restored from a production backup, to
  run the 23 migrations on the hosted platform (R4 blocked items B-1 timings on real hardware, B-2 `alter role
  service_role` accepted on hosted Supabase, B-3 migration history), deploy the `admin-users` function, and smoke-test
  the R4 app on a Netlify branch deploy pointed at staging. Supabase's free plan allows two projects (a free project is
  paused after a week without activity).

## 10. Options

**A. Netlify first, current application and database unchanged** — deploy `5cff5d6` + `netlify.toml` to a new Netlify
site; Cloudflare stays live; move users after testing; R4 follows later as its own release (with staging).
- Migrations: none. Code change: none. Rollback: trivial. Tested: build, headers, production suites on production schema.

**B. R4 release and Netlify as one coordinated release** — staging rehearsal, backup, 23 migrations, `admin-users`
function, then the R4 app on Netlify.
- Migrations: 23 (one-way). Two independent changes at once (hosting + application + schema), so a failure is harder
  to locate; Cloudflare cannot serve as the fallback after the database upgrade.

**Recommendation: Option A.** The Netlify change has no dependency on the 23 migrations when it is built from production's
code, it is proven compatible with production's schema, and it is fully reversible. R4 depends on the migrations and is
incompatible with the current database (71 missing objects), so it should be released separately, after a staging
rehearsal — on Netlify, which by then is already the proven host.

### Steps of Option A (only after your approval)
1. Create branch `release/netlify-hosting` from `main` (`5cff5d6`) with `netlify.toml` + `docs/NETLIFY_DEPLOYMENT.md`
   only (no application code).
2. Netlify: new site from that branch, package directory `web`, the variables of §4 scoped to Production, deploy
   previews off (§7).
3. Supabase: add the Netlify address to Redirect URLs (Site URL unchanged).
4. Smoke test on desktop, Android and iPhone; check the security headers.
5. Move users; then decide whether to merge the branch into `main` and when to retire Cloudflare.
