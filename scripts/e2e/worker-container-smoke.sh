#!/usr/bin/env bash
# Release check: runs the email worker exactly like the scheduled GitHub
# Action — clean checkout, `npm ci --omit=dev`, Node 22, `node src/main.ts
# reminders` — inside Docker on the local Supabase network, sending through
# real SMTP (Mailpit). Verifies the mails arrived and the outbox is SENT.
set -euo pipefail
cd "$(dirname "$0")/../.."
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
eval "$("$SUPABASE_BIN" status -o env 2>/dev/null | sed -n 's/^\(API_URL\|ANON_KEY\|SERVICE_ROLE_KEY\)=/export E2E_\1=/p')"
NET="$(docker inspect supabase_kong_rukman-dataflow-local -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
DATA="$(node e2e/smoke/worker-data.mjs)"
echo "data: $DATA"
SRC="$(mktemp -d)"; trap 'rm -rf "$SRC"' EXIT
git archive HEAD | tar -x -C "$SRC"
docker run --rm --network "$NET" -v "$SRC:/w" -w /w \
  -e SUPABASE_URL=http://supabase_kong_rukman-dataflow-local:8000 -e SUPABASE_SERVICE_ROLE_KEY="$E2E_SERVICE_ROLE_KEY" \
  -e SMTP_HOST=supabase_inbucket_rukman-dataflow-local -e SMTP_PORT=1025 -e SMTP_SECURE=false \
  -e EMAIL_FROM_ADDRESS=erp@smoke.test -e EMAIL_FROM_NAME="Smoke ERP" \
  node:22 sh -c 'npm ci --workspace worker --include-workspace-root=false --omit=dev --no-audit --no-fund >/dev/null && cd worker && node src/main.ts reminders'
node --input-type=module -e "
import { mailpitUrl, service, ok } from './e2e/lib.mjs';
const d = JSON.parse(process.argv[1]);
const rows = ok(await service.from('email_outbox').select('kind,status,to_emails').eq('company_id', d.companyId));
console.log(rows);
const need = ['VENDOR_PO', 'CUSTOMER_PAYMENT_REMINDER', 'VENDOR_PAYMENT_REMINDER'];
for (const k of need) if (!rows.some((r) => r.kind === k && r.status === 'SENT')) { console.error('MISSING SENT', k); process.exit(1); }
for (const to of [d.vendorEmail, d.customerEmail]) {
  const r = await (await fetch(mailpitUrl + '/api/v1/search?query=' + encodeURIComponent('to:\"' + to + '\"'))).json();
  if (!r.messages?.length) { console.error('no mail in Mailpit for', to); process.exit(1); }
  console.log('mailpit:', to, '→', r.messages.map((m) => m.Subject).join(' | '), r.messages[0].Attachments ? '(attachments: ' + r.messages[0].Attachments + ')' : '');
}
console.log('OK: scheduled worker smoke test');
" "$DATA"
