# Instance Setup — a new, independent installation

Every installation (instance) has its **own** Supabase project (database,
auth, storage), its **own** hosting project and its **own** environment
variables. Nothing is shared with any other instance.
Design: [`INSTANCE_ARCHITECTURE.md`](./INSTANCE_ARCHITECTURE.md). Step-by-step production guide: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Checklist

| # | Step | How |
|---|---|---|
| 1 | Clone the repository | `git clone <repo-url>` (Windows: `git clone <repo-url> D:\rukman-erp`) |
| 2 | Create a **new** Supabase project | supabase.com → New project. Note the project ref, anon key, service-role key and database password. Free tier is fine to start (INSTANCE_ARCHITECTURE §11). |
| 3 | Database | created with the project |
| 4 | Storage | nothing to do — the migrations create the private bucket `documents` and its access policies |
| 5 | Authentication | **Exactly as `DEPLOYMENT.md` §3**: email provider on, sign-ups **ON**, **Confirm email ON** (mandatory — invitations are linked only to verified addresses), OTP template with `{{ .Token }}`, custom SMTP, Site URL |
| 6 | Environment | copy `.env.example` → `.env.local`; fill the values of **this** project; choose a new unique `APP_INSTANCE_ID` (e.g. `rukman-prod-2026`) |
| 7 | Migrations | `npx supabase link --project-ref <ref>` then `npm run db:migrate` |
| 8 | System seed | `npm run db:seed` (permissions, units — idempotent) |
| 9 | First admin user | Supabase → Authentication → Add user (e-mail + password, **Auto confirm user** ticked) |
| 10 | Initialise instance + first company | `ADMIN_EMAIL=… COMPANY_CODE=… COMPANY_LEGAL_NAME=… COMPANY_GSTIN=… npm run instance:init` |
| 11 | Configure company | log in as owner → Settings: company profile (address, GSTIN, email), portals, visibility, email, reminders; Godowns & locations; bank / cash accounts (Supabase table editor `accounts`, sub type BANK); numbering / approval rules: table editor `document_sequences` / `approval_policies` (no screen yet) |
| 12 | Branding | env `NEXT_PUBLIC_APP_NAME`, `…SHORT_NAME`, colours, logo, favicon → redeploy |
| 13 | Deploy | web app on Cloudflare Pages, email worker + nightly backup on GitHub Actions — `DEPLOYMENT.md` §5–6, §9 |
| 14 | Verify isolation | `npm run instance:verify` — must print `OK: instance …` |

## Adding another company to the same instance (multi-company, Q-34)

An admin creates it from the app (calls `create_company`); it gets its own
numbering, accounts, roles and data, isolated by row-level security.

## Safety

- `npm run db:reset` only works against a **local** server and never with
  `APP_ENV=production`.
- `instance:init` refuses to run twice on the same database.
- `instance:verify` fails if `APP_INSTANCE_ID` does not match the database,
  if any table lacks row-level security, or if the anonymous role has access.
