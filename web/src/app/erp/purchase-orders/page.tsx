'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns, useItems, useParties, usePackings, useUnitsAll } from '@/lib/masters';
import { date, money, num, today } from '@/lib/format';
import { downloadPoPdf } from '@/lib/po-download';
import { LineEditor, emptyLine, payloadLines, type Line } from '@/components/LineEditor';
import { DocumentsPanel } from '@/components/Documents';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, TextArea, useAction } from '@/components/ui';

interface PO { id: string; doc_no: string | null; doc_date: string; expected_date: string | null; status: string; remarks: string | null;
  party_id: string; godown_id: string | null; close_reason: string | null; parties: { name: string; email: string | null } | null }

function PurchaseOrders() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const id = useSearchParams().get('id');
  const [status, setStatus] = useState('OPEN');
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const list = useData(async () => {
    let q = sb().from('purchase_orders').select('id, doc_no, doc_date, expected_date, status, remarks, party_id, godown_id, close_reason, parties(name, email)')
      .eq('company_id', companyId).order('created_at', { ascending: false }).limit(300);
    if (status === 'OPEN') q = q.in('status', ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'PARTIALLY_RECEIVED']);
    else if (status !== 'ALL') q = q.eq('status', status);
    return must<PO[]>(await q);
  }, [companyId, status]);
  if (id) return <PoDetail id={id} />;
  return (
    <div>
      <PageHeader title="Purchase orders" subtitle="Vendor POs — full or partial receiving, PO PDF and vendor email"
        actions={can('purchase_order.create') && <Button onClick={() => setCreating(true)}>New purchase order</Button>} />
      <div className="mb-3 max-w-xs"><Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} options={[
        { value: 'OPEN', label: 'Open (draft / open / partially received)' }, { value: 'FULLY_RECEIVED', label: 'Fully received' },
        { value: 'CLOSED', label: 'Closed' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} /></div>
      <ErrorBox error={list.error} />
      {!list.data ? <Spinner /> : (
        <Table><thead><tr><th>PO</th><th>Vendor</th><th>Date</th><th>Expected</th><th>Status</th></tr></thead>
          <tbody>{list.data.map((o) => (
            <tr key={o.id}><td><Link className="font-medium text-brand hover:underline" href={`/erp/purchase-orders/?id=${o.id}`}>{o.doc_no ?? 'Draft'}</Link></td>
              <td>{o.parties?.name}</td><td>{date(o.doc_date)}</td><td>{date(o.expected_date)}</td><td><Badge>{o.status}</Badge></td></tr>))}
            {list.data.length === 0 && <tr><td colSpan={5} className="text-slate-500">No purchase orders</td></tr>}</tbody></Table>
      )}
      {creating && <PoForm onClose={() => setCreating(false)} onSaved={(poId) => { setCreating(false); router.push(`/erp/purchase-orders/?id=${poId}`); }} />}
    </div>
  );
}

function PoForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const companyId = useCompanyId();
  const vendors = useParties(companyId, ['SUPPLIER', 'JOB_WORKER', 'CUTTER']);
  const godowns = useGodowns(companyId);
  const items = useItems(companyId); const units = useUnitsAll(); const packings = usePackings(companyId);
  const { busy, run } = useAction();
  const [h, setH] = useState({ party_id: '', doc_date: today(), expected_date: '', godown_id: '', remarks: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const save = (confirm: boolean) => run(async () => {
    if (!h.party_id) throw new Error('Choose the vendor');
    const id = await rpc<string>('doc_save', { p_doc_type: 'PURCHASE_ORDER', p_payload: { company_id: companyId, doc_date: h.doc_date,
      party_id: h.party_id, expected_date: h.expected_date || null, godown_id: h.godown_id || null, remarks: h.remarks || null,
      lines: payloadLines(lines, { rate: true }) } });
    if (confirm) await rpc('doc_submit', { p_doc_type: 'PURCHASE_ORDER', p_id: id });
    onSaved(id);
  }, confirm ? 'PO confirmed' : 'Draft saved');
  return (
    <Modal open wide title="New purchase order" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Vendor *"><Select value={h.party_id} onChange={(e) => setH({ ...h, party_id: e.target.value })} placeholder="Choose"
            options={(vendors.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="PO date"><Input type="date" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
          <Field label="Expected delivery"><Input type="date" value={h.expected_date} onChange={(e) => setH({ ...h, expected_date: e.target.value })} /></Field>
          <Field label="Deliver to godown"><Select value={h.godown_id} onChange={(e) => setH({ ...h, godown_id: e.target.value })} placeholder="—"
            options={(godowns.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
          <Field label="Remarks" className="md:col-span-4"><TextArea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} items={items.data} units={units.data} packings={packings.data} rate unitKind="purchase" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" busy={busy} onClick={() => save(false)}>Save draft</Button>
          <Button busy={busy} onClick={() => save(true)}>Confirm PO</Button>
        </div>
      </div>
    </Modal>
  );
}

function PoDetail({ id }: { id: string }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const router = useRouter();
  const { busy, run } = useAction();
  const po = useData(async () => must<PO>(await sb().from('purchase_orders').select('id, doc_no, doc_date, expected_date, status, remarks, party_id, godown_id, close_reason, parties(name, email)').eq('id', id).single()), [id]);
  const lines = useData(async () => must<Record<string, string | number>[]>(await sb().from('v_purchase_order_lines').select('*').eq('order_id', id).order('line_no')), [id]);
  const draftLines = useData(async () => must<{ id: string; qty: number; rate: number | null; items: { name: string } | null; units: { code: string } | null }[]>(
    await sb().from('purchase_order_lines').select('id, qty, rate, items(name), units(code)').eq('order_id', id).order('line_no')), [id]);
  const mails = useData(async () => must<{ id: string; kind: string; status: string; to_emails: string[]; created_at: string; last_error: string | null }[]>(
    await sb().from('email_outbox').select('id, kind, status, to_emails, created_at, last_error').eq('entity_type', 'purchase_order').eq('entity_id', id).order('created_at')), [id]);
  const reload = () => { po.reload(); lines.reload(); mails.reload(); };
  if (!po.data) return po.error ? <ErrorBox error={po.error} /> : <Spinner />;
  const p = po.data;
  const posted = !['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(p.status);
  const open = ['OPEN', 'PARTIALLY_RECEIVED'].includes(p.status);
  return (
    <div className="space-y-4">
      <PageHeader title={`Purchase order ${p.doc_no ?? '(draft)'}`} subtitle={`${p.parties?.name} · ${date(p.doc_date)}${p.expected_date ? ' · expected ' + date(p.expected_date) : ''}`}
        actions={<>
          <Button variant="secondary" onClick={() => router.push('/erp/purchase-orders/')}>← All POs</Button>
          {p.status === 'DRAFT' && can('purchase_order.create') && <Button busy={busy} onClick={() => run(async () => { await rpc('doc_submit', { p_doc_type: 'PURCHASE_ORDER', p_id: id }); reload(); }, 'PO confirmed')}>Confirm PO</Button>}
          {p.status === 'PENDING_APPROVAL' && can('purchase_order.approve') && <Button busy={busy} onClick={() => run(async () => { await rpc('doc_approve', { p_doc_type: 'PURCHASE_ORDER', p_id: id }); reload(); }, 'PO approved')}>Approve</Button>}
          {posted && <Button variant="secondary" onClick={() => run(() => downloadPoPdf(id))}>Download PO PDF</Button>}
          {posted && can('email.create') && <Button variant="secondary" busy={busy} onClick={() => run(async () => { await rpc('purchase_order_send_email', { p_po_id: id }); mails.reload(); }, 'PO email queued')}>Email PO to vendor</Button>}
          {open && can('purchase_receipt.create') && <Button onClick={() => router.push(`/erp/receiving/?po=${id}`)}>Receive</Button>}
          {open && can('purchase_order.cancel') && <Button variant="danger" busy={busy} onClick={() => {
            const reason = prompt('Reason to close the PO (pending quantity will not be received):');
            if (reason) run(async () => { await rpc('purchase_order_close', { p_order_id: id, p_reason: reason }); reload(); }, 'PO closed');
          }}>Close PO</Button>}
        </>} />
      <div className="flex flex-wrap items-center gap-3"><Badge>{p.status}</Badge>{p.close_reason && <span className="text-sm text-slate-500">Closed: {p.close_reason}</span>}
        {p.remarks && <span className="text-sm text-slate-600">Remarks: {p.remarks}</span>}</div>
      <Card title="Items">
        {posted ? (
          <Table><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Pending</th><th>Unit</th><th className="num">Rate</th></tr></thead>
            <tbody>{(lines.data ?? []).map((l) => (
              <tr key={String(l.po_line_id)}><td>{l.item_name}<div className="text-xs text-slate-500">{l.item_code}</div></td>
                <td className="num">{num(l.ordered_base_qty)}</td><td className="num">{num(l.received_base_qty)}</td>
                <td className="num font-semibold">{num(l.pending_base_qty)}</td><td>{l.unit}</td><td className="num">{money(l.rate)}</td></tr>))}</tbody></Table>
        ) : (
          <Table><thead><tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th></tr></thead>
            <tbody>{(draftLines.data ?? []).map((l) => (<tr key={l.id}><td>{l.items?.name}</td><td className="num">{num(l.qty)}</td><td>{l.units?.code}</td><td className="num">{money(l.rate)}</td></tr>))}</tbody></Table>
        )}
      </Card>
      <Card title="Emails for this PO">
        <Table><thead><tr><th>Type</th><th>To</th><th>Status</th><th>Queued</th><th>Error</th></tr></thead>
          <tbody>{(mails.data ?? []).map((m) => (<tr key={m.id}><td>{m.kind.replace(/_/g, ' ')}</td><td>{m.to_emails.join(', ')}</td><td><Badge>{m.status}</Badge></td>
            <td>{date(m.created_at)}</td><td className="text-red-600">{m.last_error}</td></tr>))}
            {mails.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No emails (email automation may be off — Settings → Email)</td></tr>}</tbody></Table>
      </Card>
      {posted && <DocumentsPanel companyId={companyId} entityType="purchase_order" entityId={id} defaultCategory="PURCHASE_DOCUMENT"
        title="Vendor documents (uploading emails the vendor PO PDF + document when enabled)" />}
    </div>
  );
}

export default function Page() {
  return <Suspense><PurchaseOrders /></Suspense>;
}
