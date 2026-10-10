# Netlify hosting — Rukman Dataflow Management System

The web app is a **static site** (Next.js static export in `web/out`). Netlify only serves files; all data and all security
checks stay in Supabase (PostgreSQL row-level security, permission-checked database functions, the `admin-users` Edge
Function). Moving from Cloudflare Pages to Netlify therefore changes **hosting only** — no backend, database or secret moves
to Netlify, and no Netlify Functions are used.

| File | Purpose |
|---|---|
| `netlify.toml` | build command `npm --workspace web run build`, publish `web/out`, Node 22, cache headers for hashed assets |
| `web/public/_headers` | security headers (CSP, HSTS, X-Frame-Options, …) — same file format on Netlify and Cloudflare Pages |
| `web/.env.example` | the only variables the web build needs (all public) |

Verified locally (Netlify CLI 27.12.0, `@netlify/build` 37.4.1): `netlify build --offline --filter @rukman/web` succeeds with
this `netlify.toml` (base = repository root, publish = `web/out`; Netlify's Next.js Runtime 5.16.2 is applied
automatically and adds no server functions for a static export); Netlify's own header parser accepts `_headers` and
`netlify.toml` with no errors (6 security headers on every path, immutable caching for `/_next/static/*`). `netlify dev`
could not be run in the build sandbox (it downloads the Deno runtime from a blocked host) — the first real Netlify deploy
is the remaining check (§4 step 7).

---

## 1. Read this first — which code Netlify builds

The measured comparison of the branches, schema compatibility, deploy-preview risks and the two release options are in
[`DEPLOYMENT_READINESS_PLAN.md`](./DEPLOYMENT_READINESS_PLAN.md).

The web app and the database schema must match. The code on this branch includes the R1–R4 changes, which need the **47
migrations** of the R4 release candidate (production has 24).

| Netlify builds … | Works with … |
|---|---|
| `main` as it is today (production `5cff5d6`) **plus** `netlify.toml` | the current production database |
| this branch / the R1–R4 release | the database **after** the R4 upgrade runbook (`docs/PLATFORM_R4_RELEASE_AUDIT.md` §6) |

So either (a) deploy Netlify together with the R1–R4 release, or (b) bring only `netlify.toml` (and this guide) to `main`
first and switch hosting before the release. Both are your decision; nothing has been deployed.

## 2. Environment variables (Netlify → Site configuration → Environment variables)

Set these **five** (scope: *Builds*; they are compiled into the public JavaScript — that is expected):

| Variable | Value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | no — public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's **anon / publishable** key | no — public by design; RLS protects the data |
| `NEXT_PUBLIC_APP_NAME` | `Rukman Dataflow Management System` | no |
| `NEXT_PUBLIC_APP_SHORT_NAME` | `Rukman DMS` | no |
| `NEXT_PUBLIC_PRIMARY_COLOR` | `#1f4e79` | no |

Optional: `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_FAVICON_URL` (or upload branding in Settings → Branding).

**Never** set in Netlify: `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `SMTP_*`, `BACKUP_PASSPHRASE`, any GitHub or
Supabase access token. Those stay in GitHub Secrets (worker, backups) and in Supabase (Edge Function). Netlify needs no
secret at all.

**Deploy previews:** Netlify builds previews of pull requests and branches with the same variables — i.e. against the
**production** database. Either turn them off (Site configuration → Build & deploy → Branches and deploy contexts →
Deploy previews: *None*, Branch deploys: *None*) or give the *Deploy previews* context its own variables pointing to a
separate test Supabase project. Recommended: off until a staging project exists.

## 3. Supabase Auth URLs

Supabase → Authentication → URL Configuration:
- **Site URL** = the address users open (`https://<name>.netlify.app`, later the custom domain).
- **Redirect URLs**: add `https://<name>.netlify.app/**` (and later `https://<custom-domain>/**`). Keep the Cloudflare
  address in the list until Cloudflare is retired, so links in e-mails already sent keep working.

The `admin-users` Edge Function needs no change: it authenticates with the user's bearer token (no cookies), so it is
not tied to a domain.

## 4. Steps (first deployment)

1. Netlify → **Add new project → Import an existing project → GitHub** → choose `ru-mis/cmms-rukman`.
2. **Branch to deploy**: the branch from §1 (normally `main`).
3. Monorepo prompt: **Base directory** = empty (repository root); **Package directory** = `web`. Build command and publish
   directory are taken from `netlify.toml` (the UI shows them as set by the file) — do not override them.
4. Before the first build: add the variables of §2.
5. Deploy. A build takes about 1–2 minutes.
6. **Short URL**: Site configuration → General → **Change site name** → e.g. `rukman-dms` → `https://rukman-dms.netlify.app`
   (if the name is taken, choose another).
7. Check: open `/login/`; `curl -sI https://<name>.netlify.app/login/` must show `content-security-policy`,
   `strict-transport-security` and `x-frame-options: DENY`; sign in, sign out; run the smoke test of
   `docs/DEPLOYMENT_CHECKLIST.md` section G on desktop, an Android phone and an iPhone.
8. Set the Supabase Auth URLs (§3) to the new address — only when users move to it.

## 5. Custom domain (later)

1. Netlify → Domain management → **Add a domain** → e.g. `erp.rukmanudyog.com`.
2. At your DNS provider add a **CNAME** `erp` → `<name>.netlify.app` (or delegate the domain to Netlify DNS).
3. Netlify issues the HTTPS certificate (Let's Encrypt) automatically; enable *Force HTTPS* (default).
4. Add `https://erp.rukmanudyog.com/**` to the Supabase Redirect URLs and set it as Site URL.
5. Nothing in the code or headers changes (the CSP only names Supabase, not the site's own domain).

## 6. Moving users from Cloudflare Pages, and rollback

- Run both in parallel: Cloudflare stays live while the Netlify address is tested by one or two users.
- Switch: announce the new address, change the Supabase Site URL (§3), keep the old address in Redirect URLs for a while.
- Netlify rollback: Deploys → choose an earlier deploy → **Publish deploy** (instant, no data change). Until Cloudflare is
  retired, pointing users back to the Cloudflare address is also a rollback.
- Database changes are never rolled back by the hosting; see the release runbook for that.

---

## 7. Phase 1 requirement check (existing system)

| Requirement | Status | Where |
|---|---|---|
| App shell, sidebar on desktop, mobile menu, dashboard | **existing** | `web/src/components/AppShell.tsx`, `/erp/` |
| Login page with product branding, e-mail field, clear errors | **existing** | `/login/` (password or e-mail code) |
| Password show / hide | **added now** | `PasswordInput` in `web/src/components/ui.tsx` (login, first-password and account screens); browser test in `e2e/ui/zz-auth.spec.ts` |
| Logout, session expiry | **existing** | user menu → Logout; the Supabase access token expires (Supabase default 1 h, Authentication → Sessions) and is refreshed; idle sign-out per company (Settings → Security) |
| No plaintext passwords; no password check in the browser | **existing** | Supabase Auth (bcrypt); temporary passwords shown once, forced change, expiry |
| Roles Admin / Manager / Staff, enforced on the server | **existing** | roles Owner, Administrator, Manager, Senior / Approver, Sales, Purchase, Accounts, Inventory, Factory, Data entry, View only + custom roles (Roles & permissions). "Staff" = *Data entry*, or create a role named Staff in the UI. Enforced by RLS and database functions, not by the UI |
| Server-side API | **existing** | PostgREST + permission-checked functions + `admin-users` Edge Function |
| Environment-variable configuration, `.env.example`, `.gitignore` | **existing** | root and `web/.env.example` (placeholders only); `.gitignore` excludes `.env*` and `.netlify` |
| Loading / validation / error / success states | **existing** | spinners, inline validation, error boxes, toasts |
| Responsive desktop / tablet / mobile, no horizontal overflow | **existing** | browser test "mobile layout: no horizontal page overflow" |
| Audit log | **existing** | `/erp/admin/audit` (masked, scoped, exportable) |
| Brute-force protection | **partly** | Supabase Auth rate limits apply (dashboard → Authentication → Rate limits). Recommended: review the limits and enable **CAPTCHA** (Turnstile or hCaptcha, free tiers) — needs a small login-page change; not done |
| Session token in an HttpOnly cookie, not in browser storage | **not met — decision needed** | Supabase JS keeps the user's session token in `localStorage`. It is a user-scoped token (no privileged key), but it is readable by any script on the page. Moving it to an HttpOnly cookie needs a server component (e.g. Netlify Functions as a login proxy) — a larger change best done as its own milestone |
| CSP hardening | **note** | the CSP still allows `'unsafe-inline'` scripts (needed by the static Next.js export); removing it requires script hashes or nonces — recommended together with the cookie decision |
| Google Sheets | **not used** (decision) | PostgreSQL is the database; a read-only Sheets export can be added later if wanted |
| Add to Home Screen | not in Phase 1 | can be added (web manifest + icons); it remains a web app, not a native iOS app |
