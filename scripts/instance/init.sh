#!/usr/bin/env bash
# One-time initialisation of a NEW instance (docs/INSTANCE_SETUP.md):
# writes the instance fingerprint and creates the first company with the first
# admin (the admin user must already exist in Supabase Auth).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?Set DATABASE_URL of this instance}"
: "${APP_INSTANCE_ID:?Set APP_INSTANCE_ID}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL (user created in Supabase Auth)}"
: "${COMPANY_CODE:?Set COMPANY_CODE}"
: "${COMPANY_LEGAL_NAME:?Set COMPANY_LEGAL_NAME}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X \
  -v instance_id="$APP_INSTANCE_ID" -v instance_name="${INSTANCE_NAME:-$COMPANY_LEGAL_NAME}" \
  -v admin_email="$ADMIN_EMAIL" -v company_code="$COMPANY_CODE" \
  -v company_name="$COMPANY_LEGAL_NAME" -v company_gstin="${COMPANY_GSTIN:-}" \
  -f scripts/instance/init.sql
echo "Instance '$APP_INSTANCE_ID' initialised."
