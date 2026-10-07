'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns, useItems, useParties, usePackings, useUnitsAll } from '@/lib/masters';
import { date, money, num, today } from '@/lib/format';
import { LineEditor, emptyLine, payloadLines, type Line } from '@/components/LineEditor';
import { DocumentsPanel } from '@/components/Documents';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, TextArea, Toggle, useAction } from '@/components/ui';

interface PoLine { company_id: string; customer_po_id: string; po_no: string; po_date: string; requested_delivery_date: string | null;
  status: string; source: string; party_id: string; party_name: string; sales_order_id: string | null; sales_order_no: string | null;
  remarks: string | null; review_remarks: string | null; reject_reason: string | null; created_at: string;
  line_id: string; line_no: number; item_id: string; item_code: string; item_name: string; qty: number; unit: string; base_qty: number;
  reference_rate: number | null; quoted_rate: number | null; approved_rate: number | null; quote_difference: number | null }

function CustomerPos() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const openId = useSearchParams().get('id');
  const [status, setStatus] = useState('OPEN');
  const [sel, setSel] = useState<string | null>(openId);
  const [creating, setCreating] = useState(false);
  const rows = useData(async () => must<PoLine[]>(await sb().from('v_customer_po_lines').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).order('line_no')), [companyId]);
  const pos = useMemo(() => {
    const m = new Map<string, PoLine[]>();
    for (const r of rows.data ?? []) m.set(r.customer_po_id, [...(m.get(r.customer_po_id) ?? []), r]);
    return [...m.values()].filter((ls) => status === 'ALL' || (status === 'OPEN' ? ['SUBMITTED', 'UNDER_REVIEW'].includes(ls[0].status) : ls[0].status === status));
  }, [rows.data, status]);
  const current = (rows.data ?? []).filter((r) => r.customer_po_id === sel);

  return (
    <div>
      <PageHeader title="Customer POs" subtitle="Review customer POs: approve, modify price or reject → sales order → reservation"
        actions={can('customer_po.create') && <Button onClick={() => setCreating(true)}>Enter customer PO</Button>} />
      <div className="mb-3 max-w-xs"><Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} options={[
        { value: 'OPEN', label: 'To review (submitted / under review)' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' },
        { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} /></div>
      <ErrorBox error={rows.error} />
      {rows.loading && !rows.data ? <Spinner /> : (
        <Table>
          <thead><tr><th>Customer PO</th><th>Customer</th><th>Date</th><th>Delivery</th><th className="num">Items</th><th className="num">Quoted value</th><th>Source</th><th>Status</th><th>Sales order</th></tr></thead>
          <tbody>{pos.map((ls) => { const h = ls[0]; return (
            <tr key={h.customer_po_id}>
              <td><button className="font-medium text-brand hover:underline" onClick={() => setSel(h.customer_po_id)}>{h.po_no}</button></td>
              <td>{h.party_name}</td><td>{date(h.po_date)}</td><td>{date(h.requested_delivery_date)}</td><td className="num">{ls.length}</td>
              <td className="num">{money(ls.reduce((s, l) => s + Number(l.base_qty) * Number(l.quoted_rate ?? l.reference_rate ?? 0), 0))}</td>
              <td>{h.source === 'PORTAL' ? 'Portal' : 'Internal'}</td><td><Badge>{h.status}</Badge></td>
              <td>{h.sales_order_id && <Link className="text-brand hover:underline" href={`/erp/sales-orders/?id=${h.sales_order_id}`}>{h.sales_order_no}</Link>}</td>
            </tr>); })}
            {pos.length === 0 && <tr><td colSpan={9} className="text-slate-500">Nothing here</td></tr>}</tbody>
        </Table>
      )}
      {current.length > 0 && <ReviewModal lines={current} onClose={() => setSel(null)} onDone={() => rows.reload()} />}
      {creating && <NewCustomerPo onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); rows.reload(); setSel(id); }} />}
    </div>
  );
}

function ReviewModal({ lines, onClose, onDone }: { lines: PoLine[]; onClose: () => void; onDone: () => void }) {
  const h = lines[0];
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const godowns = useGodowns(companyId);
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.line_id, String(l.approved_rate ?? l.quoted_rate ?? l.reference_rate ?? '')])));
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.line_id, String(l.qty)])));
  const [godown, setGodown] = useState('');
  const [reserve, setReserve] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');
  const open = ['SUBMITTED', 'UNDER_REVIEW'].includes(h.status);
  const canApprove = open && can('customer_po.approve');

  const approve = () => run(async () => {
    const payload = lines.map((l) => {
      const p = prices[l.line_id];
      if (p === '' || !(Number(p) >= 0)) throw new Error(`Enter the approved price for ${l.item_name}`);
      return { line_id: l.line_id, approved_rate: Number(p), qty: Number(qtys[l.line_id]) };
    });
    const r = await rpc<{ sales_order_no: string; warnings: string[] }>('customer_po_approve', { p_id: h.customer_po_id, p_lines: payload,
      p_remarks: remarks || null, p_godown_id: godown || null, p_reserve: !!godown && reserve });
    if (r.warnings?.length) alert(r.warnings.join('\n'));
    onDone(); onClose();
  }, 'Approved — sales order created');

  return (
    <Modal open wide title={`Customer PO ${h.po_no} — ${h.party_name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>Status <Badge>{h.status}</Badge></span><span>PO date {date(h.po_date)}</span>
          <span>Requested delivery {date(h.requested_delivery_date) || '—'}</span><span>Source {h.source}</span>
          {h.sales_order_no && <span>Sales order <b>{h.sales_order_no}</b></span>}
        </div>
        {h.remarks && <p className="rounded bg-slate-50 p-2 text-sm">Customer remarks: {h.remarks}</p>}
        {h.reject_reason && <p className="rounded bg-red-50 p-2 text-sm text-red-700">Rejected: {h.reject_reason}</p>}
        <Table>
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Our price</th><th className="num">Customer quote</th>
            <th className="num">Difference</th><th>Approved price</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.line_id}>
              <td>{l.item_name}<div className="text-xs text-slate-500">{l.item_code}</div></td>
              <td className="num">{canApprove
                ? <Input aria-label={`Qty ${l.item_code}`} className="w-24 text-right" type="number" value={qtys[l.line_id]} onChange={(e) => setQtys({ ...qtys, [l.line_id]: e.target.value })} />
                : num(l.qty)} {l.unit}</td>
              <td className="num">{money(l.reference_rate)}</td>
              <td className="num">{l.quoted_rate === null ? '—' : money(l.quoted_rate)}</td>
              <td className={`num ${Number(l.quote_difference) < 0 ? 'text-red-600' : ''}`}>{l.quote_difference === null ? '' : money(l.quote_difference)}</td>
              <td>{canApprove
                ? <Input aria-label={`Approved price ${l.item_code}`} className="w-32" type="number" step="any" value={prices[l.line_id]}
                    onChange={(e) => setPrices({ ...prices, [l.line_id]: e.target.value })} />
                : money(l.approved_rate)}</td>
            </tr>))}</tbody>
        </Table>
        <p className="text-xs text-slate-500">Prices are per base unit. The customer quote is kept as it was submitted; the approved price is stored separately and used on the sales order.</p>
        {canApprove && (
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Reserve stock in godown"><Select value={godown} onChange={(e) => setGodown(e.target.value)} placeholder="Do not reserve now"
              options={(godowns.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
            <div className="pt-5"><Toggle label="Reserve available stock" checked={reserve} onChange={setReserve} disabled={!godown} /></div>
            <Field label="Review remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {open && h.status === 'SUBMITTED' && can('customer_po.edit') &&
            <Button variant="secondary" busy={busy} onClick={() => run(async () => { await rpc('customer_po_start_review', { p_id: h.customer_po_id }); onDone(); }, 'Marked under review')}>Start review</Button>}
          {canApprove && <>
            <Input aria-label="Reject reason" className="max-w-xs" placeholder="Reason to reject" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="danger" busy={busy} onClick={() => run(async () => {
              await rpc('customer_po_reject', { p_id: h.customer_po_id, p_reason: reason }); onDone(); onClose(); }, 'Customer PO rejected')}>Reject</Button>
            <Button busy={busy} onClick={approve}>Approve → sales order</Button>
          </>}
        </div>
        <DocumentsPanel companyId={companyId} entityType="customer_po" entityId={h.customer_po_id} title="Attachments" />
      </div>
    </Modal>
  );
}

function NewCustomerPo({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const companyId = useCompanyId();
  const customers = useParties(companyId, 'CUSTOMER');
  const items = useItems(companyId); const units = useUnitsAll(); const packings = usePackings(companyId);
  const { busy, run } = useAction();
  const [h, setH] = useState({ party_id: '', po_no: '', po_date: today(), requested_delivery_date: '', remarks: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const save = () => run(async () => {
    if (!h.party_id) throw new Error('Choose the customer');
    const id = await rpc<string>('customer_po_create', { p_company_id: companyId, p_party_id: h.party_id, p_payload: {
      po_no: h.po_no, po_date: h.po_date, requested_delivery_date: h.requested_delivery_date || null, remarks: h.remarks || null,
      lines: payloadLines(lines, { rate: true }).map(({ rate, ...l }) => ({ ...l, quoted_rate: rate })) } });
    onDone(id);
  }, 'Customer PO saved');
  return (
    <Modal open wide title="Enter customer PO (received by mail / phone)" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Customer *"><Select value={h.party_id} onChange={(e) => setH({ ...h, party_id: e.target.value })} placeholder="Choose"
            options={(customers.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Customer PO no *"><Input value={h.po_no} onChange={(e) => setH({ ...h, po_no: e.target.value })} /></Field>
          <Field label="PO date"><Input type="date" value={h.po_date} onChange={(e) => setH({ ...h, po_date: e.target.value })} /></Field>
          <Field label="Requested delivery"><Input type="date" value={h.requested_delivery_date} onChange={(e) => setH({ ...h, requested_delivery_date: e.target.value })} /></Field>
          <Field label="Remarks" className="md:col-span-4"><TextArea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} items={items.data} units={units.data} packings={packings.data} rate rateLabel="Customer quoted price / base unit" unitKind="sales" />
        <div className="flex justify-end"><Button busy={busy} onClick={save}>Save customer PO</Button></div>
      </div>
    </Modal>
  );
}

export default function Page() {
  return <Suspense><CustomerPos /></Suspense>;
}
