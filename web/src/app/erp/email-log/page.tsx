'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { dateTime, label } from '@/lib/format';
import { Badge, Button, ErrorBox, Field, Modal, PageHeader, Select, Spinner, Table, useAction } from '@/components/ui';

interface Mail { id: string; kind: string; status: string; party_name: string | null; recipient_type: string; to_emails: string[]; subject: string;
  document_name: string | null; attempts: number; max_attempts: number; last_error: string | null; sent_at: string | null; next_attempt_at: string; created_at: string }

function EmailLog() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [status, setStatus] = useState(useSearchParams().get('status') ?? '');
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<Mail | null>(null);
  const mails = useData(async () => {
    let q = sb().from('v_email_log').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300);
    if (status) q = q.eq('status', status);
    if (kind) q = q.eq('kind', kind);
    return must<Mail[]>(await q);
  }, [companyId, status, kind]);
  const events = useData(async () => sel ? must<{ id: number; status: string; message: string | null; created_at: string }[]>(
    await sb().from('email_events').select('*').eq('outbox_id', sel.id).order('id')) : [], [sel?.id]);
  return (
    <div>
      <PageHeader title="Email log" subtitle="Every automatic email with its status. Failed emails are retried automatically; you can also retry after fixing the address." />
      <div className="mb-3 grid max-w-2xl gap-3 md:grid-cols-2">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All"
          options={['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'].map((s) => ({ value: s, label: s }))} /></Field>
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)} placeholder="All"
          options={['VENDOR_PO', 'VENDOR_DOCUMENT', 'CUSTOMER_INVOICE', 'CUSTOMER_DOCUMENT', 'CUSTOMER_PAYMENT_REMINDER', 'VENDOR_PAYMENT_REMINDER'].map((s) => ({ value: s, label: label(s) }))} /></Field>
      </div>
      <ErrorBox error={mails.error} />
      {!mails.data ? (mails.error ? null : <Spinner />) : (
        <Table><thead><tr><th>Queued</th><th>Type</th><th>Recipient</th><th>Subject</th><th>Attempts</th><th>Status</th><th>Error</th><th /></tr></thead>
          <tbody>{mails.data.map((m) => (
            <tr key={m.id}><td>{dateTime(m.created_at)}</td><td>{label(m.kind)}</td>
              <td>{m.party_name && <div>{m.party_name}</div>}<div className="text-xs text-slate-500">{m.to_emails.join(', ')}{m.recipient_type === 'INTERNAL' && ' (internal)'}</div></td>
              <td><button className="text-left text-brand hover:underline" onClick={() => setSel(m)}>{m.subject}</button>
                {m.document_name && <div className="text-xs text-slate-500">📎 {m.document_name}</div>}</td>
              <td>{m.attempts}/{m.max_attempts}</td><td><Badge>{m.status}</Badge>{m.sent_at && <div className="text-xs text-slate-500">{dateTime(m.sent_at)}</div>}</td>
              <td className="max-w-xs text-xs text-red-600">{m.last_error}</td>
              <td>{['FAILED', 'SKIPPED', 'CANCELLED'].includes(m.status) && can('email.edit') &&
                <Button variant="ghost" busy={busy} onClick={() => run(async () => { await rpc('email_retry', { p_id: m.id }); mails.reload(); }, 'Email re-queued')}>Retry</Button>}</td></tr>))}
            {mails.data.length === 0 && <tr><td colSpan={8} className="text-slate-500">No emails</td></tr>}</tbody></Table>
      )}
      <Modal open={!!sel} title={sel?.subject ?? ''} onClose={() => setSel(null)}>
        <Table><thead><tr><th>Time</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>{(events.data ?? []).map((e) => (<tr key={e.id}><td>{dateTime(e.created_at)}</td><td><Badge>{e.status}</Badge></td><td>{e.message}</td></tr>))}</tbody></Table>
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Suspense><EmailLog /></Suspense>;
}
