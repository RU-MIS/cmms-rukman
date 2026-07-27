# CMMS Pro — Complete Setup & Deployment Guide
## Rukman Udyog | Enterprise Maintenance Management System

---

## 📋 Prerequisites

Before starting, install these on your computer:

| Tool | Download | Purpose |
|------|----------|---------|
| Node.js 20+ | nodejs.org | Backend + Frontend runtime |
| Git | git-scm.com | Version control |
| VS Code | code.visualstudio.com | Code editor |

---

## 🗄️ Step 1 — PlanetScale Database Setup (FREE)

PlanetScale = free MySQL database in the cloud. No credit card needed.

### 1.1 Create account
1. Go to **planetscale.com** → Sign up (free)
2. Create organization: `rukman-udyog`
3. Create database: `cmms-rukman`
4. Region: **Asia Pacific (Mumbai)** → closest to Delhi

### 1.2 Get connection string
1. Database → **Connect** → **Node.js**
2. Copy the connection string — looks like:
   ```
   mysql://username:password@aws.connect.psdb.cloud/cmms-rukman?ssl={"rejectUnauthorized":true}
   ```
3. Also copy: Host, Username, Password separately

### 1.3 Enable safe migrations (important!)
Database → Settings → **Safe migrations: OFF** (for initial setup)
You can turn it back ON after first migration.

---

## ⚙️ Step 2 — Backend Setup

### 2.1 Install dependencies
```bash
cd Desktop/cmms-rukman/backend
npm install
```

### 2.2 Create .env file
```bash
# Copy the example file
copy .env.example .env
```

Open `.env` in VS Code and fill in:

```env
# ── App ──────────────────────────────────────
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:3000
API_URL=http://localhost:4000

# ── PlanetScale Database ──────────────────────
DATABASE_URL="mysql://YOUR_USER:YOUR_PASS@aws.connect.psdb.cloud/cmms-rukman?ssl={"rejectUnauthorized":true}"
DB_HOST=aws.connect.psdb.cloud
DB_USER=YOUR_PLANETSCALE_USERNAME
DB_PASSWORD=YOUR_PLANETSCALE_PASSWORD
DB_NAME=cmms-rukman
DB_PORT=3306
DB_SSL=true

# ── JWT (generate random 32+ char strings) ────
JWT_SECRET=your_random_32_char_secret_key_here_change_this
JWT_REFRESH_SECRET=another_random_32_char_secret_here_change

# ── Google Drive (for photo uploads) ─────────
# Get from: console.cloud.google.com → Service Accounts
GOOGLE_SERVICE_ACCOUNT_EMAIL=cmms@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----"
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id

# ── Gmail SMTP (for email notifications) ─────
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=your_16_char_app_password

# ── Google Chat Webhook (optional) ────────────
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/...

# ── Security ──────────────────────────────────
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000
```

### 2.3 Generate JWT secrets (use this website)
Go to: **generate-secret.vercel.app** → copy two 32-char secrets

### 2.4 Run database migrations
```bash
npm run migrate
```

This creates all 15 tables + seeds master data.

### 2.5 Start backend
```bash
npm run dev
```

Test it: Open browser → `http://localhost:4000/health`
Should show: `{"status":"ok","app":"CMMS Pro",...}`

**Default login:**
- Username: `admin`
- Password: `Admin@1234`
- ⚠️ Change this immediately after first login!

---

## 🖥️ Step 3 — Frontend Setup

### 3.1 Create frontend .env
```bash
cd Desktop/cmms-rukman/frontend
```

Create file `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_APP_NAME=CMMS Pro
```

### 3.2 Install dependencies
```bash
npm install
```

### 3.3 Start frontend
```bash
npm run dev
```

Open browser → `http://localhost:3000`
Login with: `admin` / `Admin@1234`

---

## 📱 Step 4 — Install as PWA (Mobile)

### Android (Chrome)
1. Open Chrome on phone
2. Go to your app URL
3. Three dots menu → **Add to Home Screen**
4. Tap **Add** → App installs on home screen!

### iPhone (Safari)
1. Open Safari on iPhone
2. Go to your app URL
3. Share button → **Add to Home Screen**
4. Tap **Add**

---

## 🚀 Step 5 — Production Deployment (Google Cloud Run)

### 5.1 Prerequisites
1. Create Google Cloud account (free $300 credit)
2. Install Google Cloud SDK: `cloud.google.com/sdk`
3. Run: `gcloud auth login`

### 5.2 Deploy Backend
```bash
cd Desktop/cmms-rukman/backend

# Build Docker image
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/cmms-backend

# Deploy to Cloud Run
gcloud run deploy cmms-backend \
  --image gcr.io/YOUR_PROJECT_ID/cmms-backend \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-env-vars DATABASE_URL="YOUR_PLANETSCALE_URL" \
  --set-env-vars JWT_SECRET="YOUR_SECRET" \
  --set-env-vars JWT_REFRESH_SECRET="YOUR_REFRESH_SECRET"
```

Copy the deployed URL (e.g. `https://cmms-backend-xxx-uc.a.run.app`)

### 5.3 Deploy Frontend
```bash
cd Desktop/cmms-rukman/frontend

# Update .env for production
# NEXT_PUBLIC_API_URL=https://cmms-backend-xxx-uc.a.run.app

npm run build

gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/cmms-frontend

gcloud run deploy cmms-frontend \
  --image gcr.io/YOUR_PROJECT_ID/cmms-frontend \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars NEXT_PUBLIC_API_URL=https://cmms-backend-xxx-uc.a.run.app
```

---

## 🔧 Google Drive Setup (Photo Uploads)

### 6.1 Create Service Account
1. Go to: **console.cloud.google.com**
2. Create new project: `cmms-rukman`
3. Enable **Google Drive API**
4. IAM → Service Accounts → Create
5. Name: `cmms-drive`
6. Download JSON key

### 6.2 Create Drive Folder
1. Go to Google Drive
2. Create folder: `CMMS-RukmanUdyog`
3. Share folder with service account email (Editor access)
4. Copy folder ID from URL: `drive.google.com/drive/folders/FOLDER_ID_HERE`

### 6.3 Update .env
```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=cmms-drive@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID=1ABC...your_folder_id
```

---

## 📧 Gmail Setup (Email Notifications)

### 7.1 Enable 2-Factor Authentication
Gmail → Account → Security → 2-Step Verification: ON

### 7.2 Create App Password
Gmail → Account → Security → App passwords
- Select app: **Mail**
- Select device: **Windows Computer**
- Copy the 16-char password

### 7.3 Update .env
```env
GMAIL_USER=your.email@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
```

---

## 💬 Google Chat Webhook (Optional)

### 8.1 Create Webhook
1. Open Google Chat
2. Create space: `CMMS Notifications`
3. Apps & Integrations → Webhooks → Add
4. Name: `CMMS Pro Alerts`
5. Copy webhook URL

### 8.2 Update .env
```env
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/...
```

---

## 🔐 First-Time Setup After Deployment

### Admin initial setup
1. Login: `admin` / `Admin@1234`
2. Go to **Employees** → Add yourself as Admin
3. Change default admin password (Settings or API)
4. Add departments (pre-seeded: 7 departments)
5. Add machines per department
6. Create checklist templates
7. Assign templates to machines with schedule dates
8. Add employees (technicians, supervisors)
9. Assign operators to machines

### Verify everything works
1. ✅ Login works
2. ✅ Dashboard shows data
3. ✅ Create a machine
4. ✅ Create a checklist template + items
5. ✅ Assign template to machine
6. ✅ Tasks generate automatically (or trigger manually)
7. ✅ Technician completes task
8. ✅ Supervisor verifies
9. ✅ Reports show compliance data

---

## 🆘 Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| `Database connection failed` | Check PlanetScale credentials in .env |
| `JWT error` | Ensure JWT_SECRET is 32+ chars |
| `CORS error` | Set CORS_ORIGIN=http://localhost:3000 in backend .env |
| `npm install fails` | Delete node_modules → run npm install again |
| `Port 4000 in use` | Change PORT in .env or kill the process |
| `Tasks not generating` | Check scheduler logs — ensure cron job started |

---

## 📁 Project Structure (Final)

```
cmms-rukman/
├── backend/
│   ├── src/
│   │   ├── config/          ← environment, database, constants
│   │   ├── middleware/       ← auth, role, error
│   │   ├── modules/          ← auth, users, machines, checklists, tasks,
│   │   │                        dashboard, reports, notifications
│   │   ├── services/         ← scheduler (task auto-generation)
│   │   └── utils/            ← idGenerator, logger, helpers
│   └── database/
│       ├── migrations/       ← 15 SQL table definitions
│       └── seeds/            ← master data
├── frontend/
│   ├── app/
│   │   ├── (auth)/login/     ← Login page
│   │   └── (dashboard)/      ← All dashboard pages
│   ├── components/
│   │   ├── layout/           ← Sidebar, Topbar
│   │   └── shared/           ← Providers, etc.
│   ├── lib/                  ← API client, utils
│   ├── store/                ← Zustand auth store
│   └── public/               ← PWA icons, manifest, sw.js
├── .env.example
├── docker-compose.yml
└── README.md
```

---

## 🎯 API Endpoints Reference

```
Auth:          POST /api/v1/auth/login|logout|refresh|change-password
Users:         GET|POST /api/v1/users
               GET|PUT|PATCH /api/v1/users/:id
               POST /api/v1/users/:id/reset-password
Machines:      GET|POST /api/v1/machines
               PUT|PATCH /api/v1/machines/:id
               POST /api/v1/machines/:id/assign|handover
Departments:   GET|POST|PUT|PATCH /api/v1/departments
Checklists:    GET|POST|PUT /api/v1/checklists
               POST /api/v1/checklists/:id/items
               POST /api/v1/checklists/:id/assign
Tasks:         GET /api/v1/tasks/my|overdue
               POST /api/v1/tasks/:id/start|submit|verify
               POST /api/v1/tasks/on-demand
Dashboard:     GET /api/v1/dashboard/kpis|dept-compliance|recent-activity
Reports:       GET /api/v1/reports/compliance|machines|departments
               GET /api/v1/reports/employees|frequency|tasks|overdue
Notifications: GET|PATCH /api/v1/notifications
```

---

*CMMS Pro v1.0 — Built for Rukman Udyog*
*Stack: Next.js 14 + Node.js + MySQL (PlanetScale) + PWA*
