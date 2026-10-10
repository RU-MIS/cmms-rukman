# Rukman Dataflow Management System — Google Sheets edition (Phase 1)

A simple, separate application: **plain HTML / CSS / JavaScript on Netlify**, **Google Apps Script** as the backend,
**a private Google Sheet** as the database. It does not use and does not change the older Next.js / Supabase application
in this repository (`web/`, `supabase/`, …); everything of this edition lives in `sheets-app/`.

Phase 1 = secure foundation: login, sessions, roles (Admin / Manager / Staff), user administration, audit log, dashboard
shell, responsive layout. ERP modules (masters, sales, purchase, stock, payments, accounts) are Phase 2.

```
sheets-app/
  apps-script/   backend: Config, Util, Db, Auth, Users, Audit, Api, Setup (.gs) + appsscript.json
  frontend/      static site published by Netlify (index.html = login, app.html = application)
  tests/         local tests (Apps Script simulator, browser tests, deployment checker) — not deployed
  netlify.toml   Netlify settings (base directory sheets-app, publish frontend, no build)
```

---

## 1. Architecture and why

| Decision | Choice | Reason |
|---|---|---|
| Backend | **Apps Script web app, bound to the database Sheet** | Requested; no server to run; the script reads the Sheet as its owner, so the Sheet is never shared with anyone. Netlify Functions + Sheets API would need a Google service-account key stored on Netlify — one more secret and more setup, no security gain for this size. |
| Sheet access | scope `spreadsheets.currentonly` | The script can open **only its own spreadsheet**, not the owner's other files. |
| Deployment | **Execute as: Me**, **Who has access: Anyone** | The browser calls the web app without a Google login. "Anyone with a Google account" makes Google redirect a cross-site `fetch` to a Google sign-in page, which cannot work from a Netlify page. "Anyone" only means the URL can be *called*; every action except `login` requires a valid session, checked by the script. |
| Calls | `POST`, body = JSON sent as **text/plain**, no custom headers | Apps Script cannot answer a CORS pre-flight (`OPTIONS`) and cannot read request headers. A text/plain POST is a CORS "simple request", so no pre-flight is sent; the session token travels in the body. |
| Responses | Google answers `302` → `script.googleusercontent.com`; the browser follows it | The JSON is served from the second address. Both addresses are allowed in the Content-Security-Policy (`connect-src`). Apps Script always answers HTTP 200, so success / error is in the body: `{ok:true,data}` / `{ok:false,error:{code,message}}`. |

## 2. Authentication design

- **Passwords:** never stored in plain text and never checked in the browser. Stored as
  `PBKDF2-HMAC-SHA256(HMAC(pepper, password), random salt, 5,000 iterations)`. The pepper is a random secret in the
  script's **Script Properties** (not in the Sheet, not in the browser): a copy of the Sheet alone is not enough to
  attack the passwords offline.
- **First Admin:** created from the Sheet's own menu by the owner; it gets a temporary password shown once on screen
  (not written to any log). Every temporary password (new users, resets) must be changed at the first sign-in — until then
  the server allows only "change password" and "sign out".
- **Sessions:** a random 256-bit token is returned once at login. The server stores only its SHA-256 hash (Sessions tab)
  with idle timeout (30 min) and maximum length (12 h), both configurable in the Settings tab. Sign-out, password change,
  password reset and disabling a user end sessions immediately on the server.
- **Every request:** the script validates the session, re-reads the user's **role and status from the Users tab** and
  checks the action's permission. Nothing the browser sends about roles is trusted. Denials are written to the audit log.
- **Brute force:** after 5 failed sign-ins an account is locked for 15 minutes (an Admin can unlock it); a global brake
  pauses sign-ins after 200 failures in 10 minutes. Unknown users and wrong passwords get the same answer and the same
  amount of work (no hint which usernames exist).
- **Browser side:** the token is kept in `sessionStorage` (gone when the tab closes), never in `localStorage` or cookies.
  The Content-Security-Policy allows scripts only from the site itself (no inline scripts, no third-party scripts), and
  all data is displayed with `textContent`, which keeps cross-site scripting — the way such a token could be stolen —
  as hard as possible.

### Limitations of this architecture (be aware)

| Limitation | Effect | Mitigation / alternative |
|---|---|---|
| No **HttpOnly cookies**: the web app lives on a Google domain and cannot set headers or cookies for the Netlify site | The session token is readable by JavaScript on the page; a successful XSS could steal it | Strict CSP, no third-party code, `textContent` rendering, short idle timeout, server-side revocation. If cookie-based sessions are required, add a small **Netlify Function proxy** that holds the session in an HttpOnly cookie and forwards to Apps Script (one shared secret on Netlify) — more moving parts, available on request |
| No client IP address in Apps Script | Lockout is per account, so someone can deliberately lock a known username for 15 minutes | Admin unlock; lock expires by itself |
| Password hashing speed is limited by Apps Script | 5,000 PBKDF2 iterations (well below what a dedicated server would use) | The pepper makes a stolen Sheet alone useless for cracking; strong-password policy; lockout. The iteration count is stored per hash and can be raised later |
| Google Sheets is not a transactional database | No rollback: a script failure in the middle of a multi-row change can leave a partial write; many simultaneous users queue behind the script lock | Phase 1 writes one row at a time under the script lock. Phase 2 posting will validate fully **before** writing, use append-only ledgers with idempotency keys, and reversal entries instead of edits |
| Sheet size and quotas | A spreadsheet holds at most 10 million cells; large tabs get slow; Apps Script has daily quotas and execution-time limits (see Google's "Quotas for Google Services" page for current values) | Keep ledgers lean; archive by financial year; check quotas before going live with many users |
| Speed | Each call typically takes about 1–3 seconds (Google's infrastructure) — **not measured here** | Loading indicators on every action |
| People with edit access to the Sheet bypass the app | They could change roles, data or the script directly | Keep the Sheet **owner-only**. Never share it; never publish it |

## 3. Roles and permissions (enforced in `apps-script/Config.gs` → `ROLE_PERMISSIONS`)

| Permission | Admin | Manager | Staff |
|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ |
| View users | ✓ | ✓ | — |
| Create / edit / disable users, reset passwords, unlock | ✓ | — | — |
| View audit log | ✓ | ✓ | — |

Safety rules: nobody can change their own role or status; the last active Admin cannot be disabled or demoted;
an Admin cannot "reset" their own password (they use Change password).

## 4. Database (private Google Sheet) — Phase 1 tabs

All cells are formatted as plain text (no automatic conversion of ids, numbers or dates); values starting with
`= + - @` are stored as text, never as formulas. Records have a UUID id, never a row number, as identity.

| Tab | Columns |
|---|---|
| `Settings` | key, value, description, updatedAt, updatedBy |
| `Users` | userId, username, displayName, email, role, status, passwordHash, mustChangePassword, failedAttempts, lockedUntil, lastLoginAt, passwordChangedAt, createdAt, createdBy, updatedAt, updatedBy |
| `Sessions` | sessionId, tokenHash, userId, createdAt, lastSeenAt, expiresAt, revokedAt, userAgent |
| `AuditLog` | auditId, at, userId, username, action, target, result, details |

Phase 2 adds Parties, Items, ItemPackings, Godowns, Documents, DocumentLines, StockLedger, Payments, PaymentAllocations,
Accounts, JournalEntries, JournalLines (to be designed in Phase 2).

---

## 5. Set up Google (once) — you do this; nothing has been deployed

Use the company Google account that should own the data.

1. **Create the Sheet:** Google Drive → New → Google Sheets → name it e.g. `Rukman DMS Database`. **Do not share it.**
2. **Add the code:** in the Sheet → **Extensions → Apps Script**. Name the project `Rukman DMS Backend`.
   - Create one script file per file in `sheets-app/apps-script/` (Config, Util, Db, Auth, Users, Audit, Api, Setup) and
     paste the content (Apps Script shows them as `.gs`). Delete the default `Code.gs`.
   - **Project Settings** (gear) → tick **"Show appsscript.json manifest file in editor"** → open `appsscript.json` and
     replace its content with `sheets-app/apps-script/appsscript.json`. Save.
3. **Create the tabs:** reload the Sheet. A menu **Rukman DMS** appears → **1. Set up / repair database tabs**.
   Google asks for permission ("This app isn't verified" is normal for your own script → *Advanced* → *Go to …*).
   Allow it. The tabs Settings, Users, Sessions, AuditLog are created.
4. **Create the first Admin:** menu **Rukman DMS → 2. Create an Admin user** → enter a username and a name → **write
   down the temporary password** shown (it is shown only once).
5. **Deploy the web app:** in Apps Script → **Deploy → New deployment** → type **Web app** →
   *Execute as:* **Me** · *Who has access:* **Anyone** → **Deploy** → copy the **Web app URL** (ends in `/exec`).
6. **Check the deployment** (from a computer with Node.js 18+):
   `node sheets-app/tests/check-deployment.mjs <web-app-URL>` → every line must say PASS.
7. **Later code changes:** paste the new code → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
   The URL stays the same. (Optional: the `clasp` command-line tool can push the files instead of copy-paste.)

Never put the pepper, the Sheet id or any Google credential into the frontend. The web-app URL is not a secret.

## 6. Set up Netlify — after your approval

1. Put the Web app URL into `sheets-app/frontend/js/config.js` (`apiUrl`) and commit it to this branch.
2. Netlify → **Add new project → Import an existing project → GitHub** → `ru-mis/cmms-rukman` →
   branch **`claude/rukman-dms-sheets`**.
3. Build settings: **Base directory `sheets-app`**, build command **empty**, publish directory **`sheets-app/frontend`**
   (taken from `sheets-app/netlify.toml`). No environment variables are needed.
4. **Turn off deploy previews and branch deploys** (Project configuration → Build & deploy → Branches and deploy
   contexts): only the production branch deploys.
5. Deploy → **Change site name** for a short address, e.g. `https://rukman-dms.netlify.app`.
6. Check: `curl -sI https://<site>.netlify.app/` shows `content-security-policy`; then
   `node sheets-app/tests/check-deployment.mjs <web-app-URL> https://<site>.netlify.app`.
7. Sign in with the Admin's temporary password → choose a new password → create Manager / Staff users.
8. **Custom domain (later):** Netlify → Domain management → add e.g. `erp.rukmanudyog.com` → CNAME to
   `<site>.netlify.app` → HTTPS is automatic. No code change needed.

Add to Home Screen works on iPhone (Safari → Share → Add to Home Screen) and Android (Chrome menu → Add to Home
screen); it remains a web app, not a native app.

## 7. Tests (local)

```
cd sheets-app/tests && npm install && npm test
```
- `backend.test.mjs` (19 tests): the real `.gs` files run in `gas-sim.mjs`, an in-memory imitation of the Apps Script
  services (incl. Google Sheets' automatic number / boolean conversion and formula behaviour).
- `browser.spec.mjs` (8 tests, Chromium): the real frontend with its real security headers, against the real backend code
  behind `mock-gas-server.mjs`, which imitates Google's web-app behaviour (302 to a second origin, CORS `*`, no pre-flight).
- `check-deployment.mjs`: read-only check of the real deployment (step 5.6).

**Verified locally:** everything above. **Not verifiable here:** the real Google behaviour (redirect, CORS headers,
permission prompts, speed, quotas) — this environment cannot reach `script.google.com` — and real iPhone Safari (only
Chromium with iPhone screen emulation was available). These are covered by step 5.6 and the smoke test after deployment.
Also confirmed only by Google at the first run: the manifest asks for just two permissions
(`spreadsheets.currentonly` and `script.container.ui` for the Sheet menu). If Google reports a missing permission during
step 3, stop and report the exact message — do not widen the permissions blindly.
