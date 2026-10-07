'use client';
import Link from 'next/link';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { date, money } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, Table, useAction } from '@/components/ui';

export default function RemindersPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const settings = useData(async () => must<Record<string, unknown>>(await sb().from('company_settings').select('*').eq('company_id', companyId).single()), [companyId]);
  const rows = useData(async () => must<Record<string, unknown>[]>(await sb().from('v_payment_reminders').select('*').eq('company_id', companyId)
    .order('reminder_date', { ascending: false }).limit(200)), [companyId]);
  const s = settings.data;
  return (
    <div>
      <PageHeader title="Payment reminders" subtitle="Generated daily by the email worker; stop automatically when the bill is fully paid"
        actions={can('settings.edit') && <Button busy={busy} onClick={() => run(async () => {
          const r = await rpc<{ customer_reminders: number; vendor_reminders: number }>('run_payment_reminders', { p_company_id: companyId });
          rows.reload();
          return r;
        }, 'Reminders generated for today')}>Run today&apos;s reminders now</Button>} />
      {s && (
        <Card className="mb-4" title="Current settings" actions={<Link className="text-brand hover:underline" href="/erp/settings/">Change</Link>}>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>Customer reminders: <Badge color={s.customer_reminder_enabled ? 'green' : 'slate'}>{s.customer_reminder_enabled ? 'ON' : 'OFF'}</Badge> — start {String(s.customer_reminder_start_days)} days before due, {String(s.customer_reminder_frequency).toLowerCase()}</div>
            <div>Vendor reminders: <Badge color={s.vendor_reminder_enabled ? 'green' : 'slate'}>{s.vendor_reminder_enabled ? 'ON' : 'OFF'}</Badge> — start {String(s.vendor_reminder_start_days)} days before due, {String(s.vendor_reminder_frequency).toLowerCase()}, to {(s.vendor_reminder_roles as string[]).join(', ')}</div>
            <div>Email automation: <Badge color={s.email_automation ? 'green' : 'red'}>{s.email_automation ? 'ON' : 'OFF'}</Badge> · payment reminder email {s.payment_reminder_email ? 'ON' : 'OFF'} · vendor reminder email {s.vendor_payment_reminder_email ? 'ON' : 'OFF'}</div>
          </div>
        </Card>
      )}
      <ErrorBox error={rows.error} />
      {!rows.data ? <Spinner /> : (
        <Table><thead><tr><th>Date</th><th>Side</th><th>Party</th><th>Due</th><th className="num">Outstanding then</th><th>Sent to</th><th>Email</th></tr></thead>
          <tbody>{rows.data.map((r) => (
            <tr key={String(r.id)}><td>{date(r.reminder_date)}</td><td>{String(r.side)}</td><td>{String(r.party_name)}</td><td>{date(r.due_date)}</td>
              <td className="num">{money(r.outstanding_amount)}</td><td>{((r.to_emails as string[] | null) ?? []).join(', ')}</td>
              <td><Badge>{String(r.email_status ?? '')}</Badge></td></tr>))}
            {rows.data.length === 0 && <tr><td colSpan={7} className="text-slate-500">No reminders yet</td></tr>}</tbody></Table>
      )}
    </div>
  );
}
