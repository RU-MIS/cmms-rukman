# BusinessFlow ERP — Server Execution Checklist (for a non-DevOps user)

**Status: no server exists yet. Nothing in this file has been run. This is
the exact, in-order script to follow once you have a domain and a credit
card for a VPS.** Every command below is copy-pasteable — the only things
you change are the placeholders listed in section 5.

Everything referenced here (`ecosystem.config.js`, the Nginx template,
`verify:env`, `cleanup:demo`, `prisma:deploy`, backup/restore) already
exists in the repository and was verified in earlier sessions — this file
just sequences it into one script for a real server.

---

## 1. Which VPS provider and plan I recommend

**DigitalOcean, "Basic Droplet," 2 GB RAM / 1 vCPU / 50 GB SSD, ~$12/month,
Ubuntu 22.04 LTS, Bangalore (BLR1) datacenter** (pick whichever DO region
is closest to most of your users — Bangalore if most users are in India).

Why this one, specifically:
- DigitalOcean's control panel and documentation are the most
  beginner-friendly of the major providers — this matters more than saving
  a few dollars a month when you're not a DevOps person.
- 2 GB RAM (not the cheaper 1 GB/$6 plan) because this server runs MySQL
  *and* the Node backend side by side — 1 GB is technically enough for a
  small business's traffic but leaves very little headroom.
- A fixed monthly cost you can budget for, with a plain invoice — no
  free-tier quota surprises.

**Alternative**: Oracle Cloud's "Always Free" tier gives more RAM for $0
forever, but its setup (virtual networks, security lists, capacity limits
in some regions) is noticeably more confusing for a first-time server
setup. Not recommended unless you're comfortable troubleshooting alone.

## 2. Exact server purchase requirements

1. Go to https://www.digitalocean.com and create an account (needs a
   card).
2. Click **Create → Droplets**.
3. Choose:
   - **Image**: Ubuntu 22.04 (LTS) x64
   - **Plan**: Basic → Regular → the $12/mo option (2 GB RAM / 1 vCPU /
     50 GB SSD)
   - **Datacenter region**: closest to your users (e.g. Bangalore)
   - **Authentication**: "Password" is simplest if you've never used SSH
     keys — DigitalOcean emails you the root password. ("SSH Key" is more
     secure if you already know how to generate one; if that sentence
     means nothing to you, use Password.)
   - **Hostname**: anything, e.g. `businessflow-erp-prod`
4. Click **Create Droplet**. Wait ~1 minute.
5. Copy the droplet's public IP address shown in the dashboard — you'll
   need it constantly below. This is your `<DROPLET_IP>`.

## 3. Exact DNS records

You need one domain (bought from any registrar — GoDaddy, Namecheap,
Google Domains, etc.). Two records:

| Type | Name | Value | Notes |
|---|---|---|---|
| A | `api` | `<DROPLET_IP>` | your backend, e.g. `api.yourdomain.com` |
| CNAME | `app` | `<your-project>.pages.dev` | your frontend — Cloudflare gives you this exact value when you add a custom domain in the Pages project (see section 9) |

Add these in your domain registrar's DNS settings (or Cloudflare's DNS
dashboard if you've pointed your domain's nameservers at Cloudflare —
common if you're already using Cloudflare Pages).

**Wait for DNS to propagate before continuing** — check with:
```bash
ping api.yourdomain.com
```
It should reply from `<DROPLET_IP>`. This can take a few minutes up to a
few hours. Do not run the HTTPS step (section 10) until this resolves
correctly, or it will fail.

## 4. Exact commands to run, in order

Run these from your own computer's terminal first, to connect to the
server:
```bash
ssh root@<DROPLET_IP>
```
(Type `yes` if asked about the host's fingerprint, then enter the
password DigitalOcean emailed you. On Windows, use PowerPoint... — no,
use PowerShell or install "Windows Terminal"; `ssh` works the same way.)

Everything below runs **on the server**, after that `ssh` command:

```bash
# --- Create a non-root user (safer than working as root every time) ---
adduser deploy
# (it will ask for a new password — pick one and remember it — and some
#  optional info you can leave blank by pressing Enter)
usermod -aG sudo deploy
su - deploy

# --- Basic firewall ---
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
# type "y" to confirm

# --- Node.js 20 LTS ---
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
# should print v20.x.x

# --- MySQL server + client, Nginx, PM2, certbot, git ---
sudo apt-get update
sudo apt-get install -y mysql-server mysql-client nginx git
sudo apt-get install -y certbot python3-certbot-nginx
sudo npm install -g pm2

# --- Secure MySQL (interactive — see section 7 for exact answers) ---
sudo mysql_secure_installation

# --- Create the application database and its own database user ---
sudo mysql -u root -p
```
At this point you're inside the MySQL prompt (`mysql>`). Type these
(replacing `<DB_PASSWORD>` with a password you make up — write it down,
you'll need it in section 8):
```sql
CREATE DATABASE businessflow_erp CHARACTER SET utf8mb4;
CREATE USER 'erp_app'@'localhost' IDENTIFIED BY '<DB_PASSWORD>';
GRANT ALL PRIVILEGES ON businessflow_erp.* TO 'erp_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
Back at the normal terminal prompt:
```bash
# --- Get the code onto the server ---
git clone <YOUR_REPO_URL> businessflow-erp
cd businessflow-erp/backend

# --- Configure environment (edit the file — see section 8) ---
cp ../.env.example .env
nano .env
# edit values, then press Ctrl+O, Enter (save), Ctrl+X (exit)

# --- Install, build, validate, migrate ---
npm install
npm run build
NODE_ENV=production npm run verify:env
# ^ if this prints "Environment validation FAILED", fix backend/.env and
#   re-run this line before continuing — do not proceed past a failure here.
npm run prisma:deploy
npm run seed
# ^ "seed" only once, on this very first setup — it creates a demo
#   company and the admin/Admin@1234 login you'll change immediately.

# --- Start the backend with PM2 ---
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# ^ this prints ANOTHER command starting with "sudo env PATH=..." —
#   copy that exact line it prints and run it too. This is the one place
#   PM2 needs you to run something it generates for you.

# --- Nginx reverse proxy ---
sudo cp deploy/nginx.erp-api.conf.example /etc/nginx/sites-available/erp-api
sudo nano /etc/nginx/sites-available/erp-api
# replace "api.yourdomain.com" with your real domain, e.g. api.yourdomain.com
# save: Ctrl+O, Enter, Ctrl+X
sudo ln -s /etc/nginx/sites-available/erp-api /etc/nginx/sites-enabled/
sudo nginx -t
# should print "syntax is ok" and "test is successful"
sudo systemctl reload nginx

# --- HTTPS ---
sudo certbot --nginx -d api.yourdomain.com
# answer the prompts: enter your email, agree to terms, choose "2" (redirect
# HTTP to HTTPS) when asked

# --- Verify ---
curl https://api.yourdomain.com/health
# should print: {"status":"ok","app":"BusinessFlow ERP"}
```

That's the entire backend. Frontend deployment (no server commands — a
web dashboard flow) is section 9 below.

## 5. Which values you must replace in every command

| Placeholder | What it is | Where you get it |
|---|---|---|
| `<DROPLET_IP>` | The server's public IP | DigitalOcean dashboard, after creating the droplet |
| `<YOUR_REPO_URL>` | Your GitHub repo's clone URL | GitHub → your repo → "Code" button |
| `<DB_PASSWORD>` | A password you invent for the app's database user | Make one up now — a long random string, save it somewhere safe |
| `api.yourdomain.com` | Your backend's domain | The domain you bought, with `api.` in front |
| `app.yourdomain.com` | Your frontend's domain | The same domain, with `app.` in front |
| `<JWT_SECRET>` (used inside `.env`, section 8) | A long random secret for login security | Generated by a command in section 8 — never type this by hand |

Every other command above (`apt-get install`, `npm install`, etc.) is
copy-pasted exactly as written — nothing else to substitute.

## 6. Which files you need to edit

Only these — nothing else in the codebase changes for deployment:

1. **`backend/.env`** (created by copying `.env.example` in section 4) —
   see exact contents in section 8 below.
2. **`/etc/nginx/sites-available/erp-api`** (created by copying
   `backend/deploy/nginx.erp-api.conf.example` in section 4) — replace
   `api.yourdomain.com` with your real domain (certbot will edit this file
   further, automatically, in the HTTPS step — you don't touch it again
   after that).
3. **Cloudflare Pages project settings** (a website dashboard, not a file
   in the repo) — set one environment variable, described in section 9.

## 7. How to configure MySQL securely

When you ran `sudo mysql_secure_installation` above, answer exactly like
this:

| Prompt | Answer |
|---|---|
| "VALIDATE PASSWORD COMPONENT" | `Y` (optional but recommended — choose strength level `1` if asked) |
| "Set root password" | `Y`, then type and confirm a strong password (write it down — this is MySQL's root password, different from your app's `erp_app` password) |
| "Remove anonymous users" | `Y` |
| "Disallow root login remotely" | `Y` |
| "Remove test database" | `Y` |
| "Reload privilege tables now" | `Y` |

This, plus the fact that you never opened MySQL's port (3306) in the
firewall (section 4's `ufw` rules only allow SSH and Nginx), means MySQL
is only reachable from the server itself — not the public internet. That
is the correct, secure setup for this architecture.

The `erp_app` database user created in section 4 has privileges on the
`businessflow_erp` database only — not MySQL's `root` user, and not access
to any other database, which is what `backend/.env`'s `DATABASE_URL`
should use (see section 8).

## 8. How to configure backend `.env`

Open the file with `nano .env` (inside `businessflow-erp/backend/`, as in
section 4) and make it read exactly like this, replacing only the
placeholders:

```bash
NODE_ENV=production
APP_NAME="BusinessFlow ERP"
COMPANY_NAME="Your Company Pvt Ltd"
PORT=4000

DATABASE_URL="mysql://erp_app:<DB_PASSWORD>@localhost:3306/businessflow_erp"

JWT_SECRET=<JWT_SECRET>
JWT_EXPIRES_IN=8h

CORS_ORIGIN=https://app.yourdomain.com

BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

FILE_SIZE_LIMIT_MB=5
UPLOAD_DIR=/home/deploy/erp-uploads

# Leave these blank unless you're sending emails from the app:
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="BusinessFlow ERP <no-reply@yourdomain.com>"

# Leave blank until you subscribe to a GST lookup API:
GST_API_KEY=
GST_API_BASE_URL=
GST_API_PROVIDER=
```

To generate `<JWT_SECRET>` (run this once, before editing the file, and
paste its output in place of `<JWT_SECRET>` above — never use the literal
text `<JWT_SECRET>`):
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Also create the uploads folder referenced above, outside the app's own
directory (so it survives a future redeploy):
```bash
mkdir -p /home/deploy/erp-uploads
```

After saving, always re-run `NODE_ENV=production npm run verify:env`
(section 4) — it tells you immediately if anything above is wrong.

## 9. How to deploy the frontend

This is a website dashboard, not server commands:

1. Go to https://dash.cloudflare.com → **Workers & Pages → Create → Pages
   → Connect to Git**.
2. Authorize Cloudflare to access your GitHub account, pick this
   repository.
3. Build settings:
   - **Root directory**: `frontend`
   - **Build command**: `npm run build`
   - **Build output directory**: `out`
4. Before the first deploy, add an environment variable (in the same
   setup screen, or afterward under **Settings → Environment variables**):
   - Name: `NEXT_PUBLIC_API_URL`
   - Value: `https://api.yourdomain.com/api`
5. Click **Save and Deploy**. Wait for the build to finish — Cloudflare
   gives you a working `*.pages.dev` URL immediately.
6. Go to **Custom domains** in this Pages project → **Set up a custom
   domain** → enter `app.yourdomain.com`. Cloudflare shows you the exact
   CNAME value to add — this is what goes in the DNS record from section 3.
7. Wait for the custom domain to show "Active" (a few minutes).

**Every future frontend update**: just push to the GitHub branch this
Pages project watches — it rebuilds and redeploys automatically. No
server commands needed for the frontend, ever.

## 10. How to configure Nginx and HTTPS

Already done as part of section 4's command sequence — repeating the key
points:
- `backend/deploy/nginx.erp-api.conf.example` → copied to
  `/etc/nginx/sites-available/erp-api`, domain replaced, symlinked into
  `sites-enabled`, tested with `nginx -t`, reloaded.
- `sudo certbot --nginx -d api.yourdomain.com` issues the certificate and
  rewrites the Nginx file to redirect HTTP to HTTPS automatically.
- Certbot also installs a systemd timer that renews the certificate
  automatically before it expires — nothing further to do. You can confirm
  this works, without waiting months, with:
  ```bash
  sudo certbot renew --dry-run
  ```
  It should say the simulated renewal succeeded.

## 11. How to verify the live URL

```bash
curl https://api.yourdomain.com/health
```
Expected: `{"status":"ok","app":"BusinessFlow ERP"}`

Then in a browser, open `https://app.yourdomain.com` — you should see the
login screen, with a padlock icon (valid HTTPS) in the address bar for
both `app.` and `api.` domains.

## 12. How to run demo cleanup safely

Do this **after** you've logged in once and created the buyer's real
company (see the login/company-creation steps referenced in the
smoke tests, section 14) — not before, and never with `--delete` on your
very first run:

```bash
cd ~/businessflow-erp/backend

# Step 1 — dry run. This changes nothing. Read its output.
npm run cleanup:demo

# Step 2 — only after reading step 1's output and confirming it found
# exactly the demo company (named "BusinessFlow ERP Demo Co."):
npm run cleanup:demo -- --confirm
```

`--confirm` alone **deactivates** the demo company — it hides it
completely from login/use but deletes nothing, so it's reversible if you
made a mistake. Do not run `--confirm --delete` (which permanently erases
it) unless you specifically want the demo data gone forever and have
already confirmed, from step 1's dry-run output, that it's the right
company.

## 13. How to configure daily off-server backups

**Part A — the daily backup itself, on the server:**
```bash
crontab -e
```
If asked which editor, choose `nano` (usually option 1). Add this one
line at the bottom of the file, then save (Ctrl+O, Enter, Ctrl+X):
```
0 2 * * * cd /home/deploy/businessflow-erp/backend && npm run backup >> /home/deploy/backup.log 2>&1
```
This runs the backup every night at 2 AM server time, writing to
`businessflow-erp/backend/backups/` and logging to `~/backup.log`.

**Part B — copying backups off the server** (required — a backup that
only lives on the same disk as the database is not a real backup). Using
Backblaze B2 (10 GB free tier, no card required for the free tier):

1. Sign up at https://www.backblaze.com/b2/sign-up.html, create a bucket
   (e.g. `businessflow-erp-backups`), and create an "Application Key"
   (Account → App Keys → Add a New Application Key) — copy the **Key ID**
   and **Application Key** it shows you (shown once only).
2. On the server:
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   rclone config
   ```
   Follow the prompts: `n` (new remote) → name it `b2` → find `Backblaze
   B2` in the provider list and enter its number → paste the Key ID as
   "account" and the Application Key as "key" → leave other prompts at
   their defaults → `y` to confirm → `q` to quit.
3. Add a second cron line (`crontab -e` again), timed 5 minutes after the
   backup so it has time to finish:
   ```
   5 2 * * * rclone copy /home/deploy/businessflow-erp/backend/backups b2:businessflow-erp-backups >> /home/deploy/backup.log 2>&1
   ```

**Verify it's actually working**, a day or two after setting this up:
```bash
rclone ls b2:businessflow-erp-backups
```
This should list `.sql` files with today's/yesterday's date. If it's
empty, check `~/backup.log` for errors.

**Restore, if you ever need to** (from the backend folder):
```bash
npm run restore -- backend/backups/<filename>.sql
```

## 14. Exact live smoke tests

Do these once, in order, right after section 11's verification, before
telling the buyer it's ready:

1. Open `https://app.yourdomain.com`. Log in with `admin` / `Admin@1234`.
2. You should be redirected straight to a **Change Password** screen —
   confirm this happens automatically. Set a real password.
3. Go to **Companies → Create New Company**. Enter the buyer's real
   business name, GSTIN, address. Confirm it switches you into the new,
   empty company.
4. Go to **Administration → Users → Add User**. Create a real named login
   for the actual business owner with a temporary password.
5. Log out, log back in as that new user — confirm it also forces a
   password change on first login.
6. In the new company: create one Customer, one Vendor, one Product.
7. Record one Sale (against the customer/product you just made) — confirm
   it shows an invoice number and the product's stock decreases.
8. Record one Purchase (against the vendor/product) — confirm stock
   increases and a bill number appears.
9. Record one Payment against the sale — confirm Outstanding updates.
10. Open the sale, click to generate/download its PDF — confirm the
    buyer's real business name/address appears on it (not demo branding).
11. Try creating a customer with an obviously wrong GSTIN (e.g.
    `1234`) — confirm it's rejected with a clear error, not a crash.
12. Go to the "Fetch GST Details" button (Company GST profile) — confirm
    it says GST lookup is not configured, rather than erroring or
    returning fake data (expected, since `GST_API_*` is blank).
13. Switch back to the original demo company from the header dropdown,
    confirm the buyer's new company's customer/product do **not** appear
    there (and vice versa).
14. Open `https://app.yourdomain.com` on your phone (or shrink the
    browser window) — confirm the layout adapts (collapsible sidebar,
    readable tables/forms).
15. Only after all of the above pass: run section 12's demo cleanup.

## 15. Common errors and their fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run verify:env` fails: "JWT_SECRET is required..." | `.env` still has the placeholder or is empty | Generate a real one (section 8) and paste it into `.env` |
| `verify:env` fails: "CORS_ORIGIN is missing or still points at localhost" | Forgot to change `CORS_ORIGIN` in `.env` | Set it to `https://app.yourdomain.com` exactly |
| `Can't reach database server at localhost:3306` | MySQL isn't running, or `DATABASE_URL` password/user is wrong | `sudo systemctl status mysql` — if stopped, `sudo systemctl start mysql`; double-check the password in `DATABASE_URL` matches what you set in section 4 |
| Browser shows a CORS error in the console when logging in | `CORS_ORIGIN` in `backend/.env` doesn't exactly match the frontend URL (including `https://`, no trailing slash) | Fix `.env`, then `pm2 restart erp-api` |
| `curl https://api.yourdomain.com/health` gives `502 Bad Gateway` | The backend isn't running, or PM2 lost it | `pm2 status` — if `erp-api` isn't `online`, run `pm2 logs erp-api --lines 50` to see why, fix it, then `pm2 restart erp-api` |
| `certbot --nginx` fails with a DNS/connection error | The domain's DNS hasn't propagated to the server's IP yet | Wait longer, confirm with `ping api.yourdomain.com`, then retry certbot |
| Login page loads but login itself hangs/fails with a network error | `NEXT_PUBLIC_API_URL` in Cloudflare Pages is wrong or the frontend hasn't rebuilt since you set it | Check the value in Cloudflare Pages → Settings → Environment variables, then trigger a new deployment (Deployments → Retry deployment) |
| `pm2 start ecosystem.config.js` immediately shows `erp-api` as `errored` | Usually a crash on startup — check the exact reason | `pm2 logs erp-api --lines 50`; most common cause is `.env` failing validation (run `NODE_ENV=production npm run verify:env` to see the real error) |
| `npm install` fails with engine/version errors | Wrong Node.js version | `node -v` should show v20.x — if not, redo the Node.js install step in section 4 |
| `sudo mysql -u root -p` says "Access denied" | Typed the wrong root password, or `mysql_secure_installation` wasn't completed | Re-run `sudo mysql_secure_installation` to reset it |
| PM2 doesn't restart the app after a server reboot | `pm2 startup`'s printed command was never run | Run `pm2 startup`, copy and run the `sudo env PATH=...` line it prints, then `pm2 save` again |
| `rclone ls b2:...` shows nothing, days after setup | The `rclone config` remote name doesn't match the cron line, or the B2 keys were mistyped | Run `rclone config` again to check/fix the remote named `b2`; re-run the copy command manually to see the actual error |
| Uploaded company logo disappears after a redeploy | `UPLOAD_DIR` in `.env` is a relative path inside the app folder that got replaced | Confirm `UPLOAD_DIR` in `.env` is the absolute path from section 8 (`/home/deploy/erp-uploads`), not the default relative `uploads/` |

---

**This file describes what to run — nothing in it has been executed.**
Work through sections 1→15 in order on your actual server, and don't skip
section 14's smoke tests before calling it live.
