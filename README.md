# CMMS Pro — Rukman Udyog

Enterprise Maintenance Inspection Management System

## Tech Stack
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS (PWA)
- **Backend**: Node.js + Express + TypeScript
- **Database**: MySQL on PlanetScale (free forever)
- **Storage**: Google Drive API (photos)
- **Auth**: JWT + bcrypt

## Project Status
- [x] Phase 1 — Architecture + Design System
- [x] Phase 2 — Database Design
- [x] Phase 3 — Setup: Config, DB, Utils, Migrations, Seeds
- [ ] Phase 4 — Auth Module (login/logout/JWT)
- [ ] Phase 5 — All API Modules
- [ ] Phase 6 — Frontend (Next.js PWA)
- [ ] Phase 7 — Scheduler (task auto-generation)
- [ ] Phase 8 — Reports + Export
- [ ] Phase 9 — PWA (manifest + service worker)
- [ ] Phase 10 — Deployment (Cloud Run)

## Quick Start

### 1. Setup environment
```bash
cp .env.example .env
# Fill in your values in .env
```

### 2. Install dependencies
```bash
cd backend
npm install
```

### 3. Run migrations + seed data
```bash
npm run migrate
```

### 4. Start development server
```bash
npm run dev
```

### Default Login (CHANGE IMMEDIATELY)
- Username: `admin`
- Password: `Admin@1234`

## Folder Structure
```
cmms-rukman/
├── backend/
│   ├── src/
│   │   ├── config/       ← environment, database, constants
│   │   ├── middleware/   ← auth, role, audit, error
│   │   ├── modules/      ← auth, users, machines, checklists...
│   │   ├── services/     ← drive, email, gchat, scheduler
│   │   └── utils/        ← idGenerator, logger, helpers
│   └── database/
│       ├── migrations/   ← 15 SQL table definitions
│       └── seeds/        ← master data (roles, depts, shifts)
└── frontend/             ← Next.js PWA (Phase 6+)
```

## Security Rules
- NEVER commit `.env` file
- `.env.example` is safe to commit (no real values)
- Change default admin password on first login
