'use client';
import { useState } from 'react';
import Link from 'next/link';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { date, dateTime, money } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Table, TextArea, useAction } from '@/components/ui';

interface InboxRow { doc_type: string; label: string; id: string; doc_no: string | null; doc_date: string; created_by: string; amount: number | null;
  state: { next_level: { level_no: number } | null; levels: { level_no: number; approved: boolean }[] } }
interface RateRequest { id: string; kind: string; rate_type: string; old_rate: number | null; new_rate: number | null; effective_from: string | null;
  requested_at: string; items: { code: string; name: string } | null; parties: { code: string; name: string } | null }
interface Action { id: number; level_no: number | null; decision: string; comment: string | null; actor_id: string | null; at: string }

const DOC_LINK: Record<string, string> = {
  PURCHASE_ORDER: '/erp/purchase-orders/?id=', SALES_ORDER: '/erp/sales-orders/?id=', CUSTOMER_PO: '/erp/customer-pos/?id=',
};

/** Documents waiting for MY level (the database decides: role / right, threshold, maker-checker, data scope). */
export default function ApprovalsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const inbox = useData(() => rpc<InboxRow[]>('approval_inbox', { p_company_id: companyId }), [companyId]);
  const rates = useData(async () => (can('rates.approve') ? must<RateRequest[]>(await sb().from('rate_change_requests')
    .select('id, kind, rate_type, old_rate, new_rate, effective_from, requested_at, items(code, name), parties(code, name)')
    .eq('company_id', companyId).eq('status', 'PENDING').order('requested_at')) : []), [companyId]);
  const [act, setAct] = useState<{ row: InboxRow; reject: boolean } | null>(null);
  const [rateAct, setRateAct] = useState<{ r: RateRequest; approve: boolean } | null>(null);
  const [history, setHistory] = useState<InboxRow | null>(null);
  const count = (inbox.data?.length ?? 0) + (rates.data?.length ?? 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Approvals" subtitle={`${count} waiting for you`} />
      <ErrorBox error={inbox.error ?? rates.error} />
      <Card title="Documents">
        {!inbox.data ? <Spinner /> : inbox.data.length === 0 ? <Empty>Nothing is waiting for your approval.</Empty> : (
          <Table><thead><tr><th>Document</th><th>No</th><th>Date</th><th className="num">Amount</th><th>Level</th><th /></tr></thead>
            <tbody>{inbox.data.map((r) => (
              <tr key={r.doc_type + r.id} data-testid={`inbox-${r.id}`}>
                <td>{r.label}</td>
                <td>{DOC_LINK[r.doc_type] ? <Link className="text-brand hover:underline" href={DOC_LINK[r.doc_type] + r.id}>{r.doc_no ?? 'Draft'}</Link> : (r.doc_no ?? 'Draft')}</td>
                <td>{date(r.doc_date)}</td>
                <td className="num">{r.amount == null ? '—' : money(r.amount)}</td>
                <td>{r.state.next_level ? `${r.state.next_level.level_no} of ${r.state.levels.length}` : '—'}</td>
                <td className="whitespace-nowrap">
                  <Button variant="ghost" onClick={() => setHistory(r)}>History</Button>
                  <Button onClick={() => setAct({ row: r, reject: false })}>Approve</Button>{' '}
                  <Button variant="danger" onClick={() => setAct({ row: r, reject: true })}>Reject</Button></td></tr>))}</tbody></Table>)}
      </Card>
      {can('rates.approve') && (
        <Card title="Rate changes">
          {!rates.data ? <Spinner /> : rates.data.length === 0 ? <Empty>No rate change is waiting.</Empty> : (
            <Table><thead><tr><th>Item</th><th>Customer / vendor</th><th>Type</th><th className="num">Old</th><th className="num">New</th><th>Requested</th><th /></tr></thead>
              <tbody>{rates.data.map((r) => (
                <tr key={r.id} data-testid={`rate-req-${r.id}`}>
                  <td>{r.items?.name} <span className="text-xs text-slate-500">{r.items?.code}</span></td>
                  <td>{r.parties?.name ?? 'Item price'}</td><td>{r.rate_type}</td>
                  <td className="num">{r.old_rate == null ? '—' : money(r.old_rate)}</td><td className="num font-semibold">{money(r.new_rate)}</td>
                  <td>{dateTime(r.requested_at)}</td>
                  <td className="whitespace-nowrap"><Button onClick={() => setRateAct({ r, approve: true })}>Approve</Button>{' '}
                    <Button variant="danger" onClick={() => setRateAct({ r, approve: false })}>Reject</Button></td></tr>))}</tbody></Table>)}
        </Card>)}
      {act && <DecideModal row={act.row} reject={act.reject} onClose={() => setAct(null)} onDone={() => { setAct(null); inbox.reload(); }} />}
      {rateAct && <RateModal r={rateAct.r} approve={rateAct.approve} onClose={() => setRateAct(null)} onDone={() => { setRateAct(null); rates.reload(); }} />}
      {history && <HistoryModal row={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function DecideModal({ row, reject, onClose, onDone }: { row: InboxRow; reject: boolean; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal open title={`${reject ? 'Reject' : 'Approve'} ${row.label} ${row.doc_no ?? ''}`} onClose={onClose}>
      <Field label={reject ? 'Reason (required — the creator sees it)' : 'Comment (optional)'}>
        <TextArea aria-label={reject ? 'Reason' : 'Comment'} rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={reject ? 'danger' : 'primary'} busy={busy} disabled={reject && !text.trim()} onClick={() => run(async () => {
          if (reject) await rpc('approval_reject', { p_doc_type: row.doc_type, p_id: row.id, p_reason: text });
          else await rpc('approval_approve', { p_doc_type: row.doc_type, p_id: row.id, p_comment: text || null });
          onDone();
        }, reject ? 'Rejected — back to the creator' : 'Approved')}>{reject ? 'Reject' : 'Approve'}</Button>
      </div>
    </Modal>
  );
}

function RateModal({ r, approve, onClose, onDone }: { r: RateRequest; approve: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal open title={`${approve ? 'Approve' : 'Reject'} rate change`} onClose={onClose}>
      <p className="mb-3 text-sm">{r.items?.name}{r.parties ? ` · ${r.parties.name}` : ''}: {r.old_rate == null ? '—' : money(r.old_rate)} → <b>{money(r.new_rate)}</b></p>
      {!approve && <Field label="Reason (required)"><Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={approve ? 'primary' : 'danger'} busy={busy} disabled={!approve && !reason.trim()} onClick={() => run(async () => {
          await rpc('rate_change_decide', { p_request_id: r.id, p_approve: approve, p_reason: reason || null });
          onDone();
        }, approve ? 'Rate approved and effective' : 'Rate change rejected')}>{approve ? 'Approve' : 'Reject'}</Button>
      </div>
    </Modal>
  );
}

function HistoryModal({ row, onClose }: { row: InboxRow; onClose: () => void }) {
  const h = useData(async () => must<Action[]>(await sb().from('approval_actions').select('id, level_no, decision, comment, actor_id, at')
    .eq('doc_type', row.doc_type).eq('doc_id', row.id).order('id')), [row.id]);
  return (
    <Modal open title={`Approval history — ${row.doc_no ?? row.label}`} onClose={onClose}>
      {!h.data ? <Spinner /> : (
        <ul className="space-y-1 text-sm">{h.data.map((a) => (
          <li key={a.id}><Badge>{a.decision}</Badge> {a.level_no ? `level ${a.level_no} · ` : ''}{dateTime(a.at)}{a.comment ? ` — ${a.comment}` : ''}</li>))}</ul>)}
    </Modal>
  );
}
