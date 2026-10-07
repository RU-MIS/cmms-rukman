'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns, useItems, useLocations, useParties, usePackings, useUnitsAll } from '@/lib/masters';
import { date, money, num, today } from '@/lib/format';
import { LineEditor, emptyLine, payloadLines, type Line } from '@/components/LineEditor';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Tabs, useAction } from '@/components/ui';

interface Pending { order_id: string; po_no: string; po_date: string; expected_date: string | null; party_id: string; party_name: string;
  godown_id: string | null; po_line_id: string; item_id: string; item_code: string; item_name: string; rate: number | null;
  ordered_base_qty: number; received_base_qty: number; pending_base_qty: number; order_status: string }

function Receiving() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const poParam = useSearchParams().get('po');
  const [tab, setTab] = useState('po');
  const [po, setPo] = useState<string>(poParam ?? '');
  const pending = useData(async () => must<Pending[]>(await sb().from('v_purchase_pending_lines').select('*').eq('company_id', companyId)
    .order('po_date').order('po_no')), [companyId]);
  const recent = useData(async () => must<{ id: string; doc_no: string; doc_date: string; status: string; total_amount: number; supplier_bill_no: string | null;
    parties: { name: string } | null; godowns: { name: string } | null }[]>(await sb().from('purchase_receipts')
    .select('id, doc_no, doc_date, status, total_amount, supplier_bill_no, parties(name), godowns(name)').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(20)), [companyId]);
  const pos = useMemo(() => {
    const m = new Map<string, Pending[]>();
    for (const r of pending.data ?? []) m.set(r.order_id, [...(m.get(r.order_id) ?? []), r]);
    return [...m.values()];
  }, [pending.data]);
  const reload = () => { pending.reload(); recent.reload(); };

  return (
    <div>
      <PageHeader title="Receiving" subtitle="Only items still pending are listed — fully received lines disappear automatically" />
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'po', label: 'Against purchase order' }, { id: 'direct', label: 'Direct (without PO)' }]} />
      <ErrorBox error={pending.error} />
      {tab === 'po' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <Card title="Pending purchase orders">
            {!pending.data ? (pending.error ? null : <Spinner />) : (
              <Table><thead><tr><th>PO</th><th>Vendor</th><th className="num">Pending lines</th><th>Status</th></tr></thead>
                <tbody>{pos.map((ls) => (
                  <tr key={ls[0].order_id} className={po === ls[0].order_id ? 'bg-brand-light' : ''}>
                    <td><button className="font-medium text-brand hover:underline" onClick={() => setPo(ls[0].order_id)}>{ls[0].po_no}</button>
                      <div className="text-xs text-slate-500">{date(ls[0].po_date)}</div></td>
                    <td>{ls[0].party_name}</td><td className="num">{ls.length}</td><td><Badge>{ls[0].order_status}</Badge></td></tr>))}
                  {pos.length === 0 && <tr><td colSpan={4} className="text-slate-500">Nothing pending</td></tr>}</tbody></Table>
            )}
          </Card>
          {po && pos.find((ls) => ls[0].order_id === po)
            ? <ReceiveAgainstPo key={po} lines={pos.find((ls) => ls[0].order_id === po)!} canPost={can('purchase_receipt.create')} onDone={reload} />
            : <Card><p className="text-slate-500">{po ? 'This PO has nothing pending.' : 'Choose a PO on the left.'}</p></Card>}
        </div>
      ) : <DirectReceipt onDone={reload} canPost={can('purchase_receipt.create')} />}
      <Card title="Recent receipts" className="mt-4">
        <Table><thead><tr><th>No</th><th>Date</th><th>Vendor</th><th>Godown</th><th>Bill</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>{(recent.data ?? []).map((r) => (
            <tr key={r.id}><td>{r.doc_no ?? 'Draft'}</td><td>{date(r.doc_date)}</td><td>{r.parties?.name}</td><td>{r.godowns?.name}</td>
              <td>{r.supplier_bill_no}</td><td className="num">{money(r.total_amount)}</td><td><Badge>{r.status}</Badge></td></tr>))}</tbody></Table>
      </Card>
    </div>
  );
}

function ReceiveAgainstPo({ lines, canPost, onDone }: { lines: Pending[]; canPost: boolean; onDone: () => void }) {
  const companyId = useCompanyId();
  const godowns = useGodowns(companyId);
  const locations = useLocations(companyId);
  const items = useItems(companyId);
  const { busy, run } = useAction();
  const h = lines[0];
  const [godown, setGodown] = useState(h.godown_id ?? '');
  const [docDate, setDocDate] = useState(today());
  const [bill, setBill] = useState({ no: '', date: '' });
  const [rows, setRows] = useState(() => Object.fromEntries(lines.map((l) => [l.po_line_id, {
    qty: String(l.pending_base_qty), rate: l.rate === null ? '' : String(l.rate), gst: '0', loc: '' }])));
  const locOpts = (locations.data ?? []).filter((l) => l.godown_id === godown && l.is_active).map((l) => ({ value: l.id, label: l.is_default ? 'Unassigned' : l.code }));
  const set = (id: string, k: string, v: string) => setRows({ ...rows, [id]: { ...rows[id], [k]: v } });

  const post = () => run(async () => {
    if (!godown) throw new Error('Choose the receiving godown');
    const payload = lines.filter((l) => Number(rows[l.po_line_id].qty) > 0).map((l) => ({
      po_line_id: l.po_line_id, item_id: l.item_id, qty: Number(rows[l.po_line_id].qty),
      unit_id: items.data?.find((i) => i.id === l.item_id)?.base_unit_id,
      rate: rows[l.po_line_id].rate === '' ? null : Number(rows[l.po_line_id].rate), gst_rate: Number(rows[l.po_line_id].gst || 0),
      location_id: rows[l.po_line_id].loc || null }));
    if (payload.length === 0) throw new Error('Enter a quantity to receive');
    const id = await rpc<string>('doc_save', { p_doc_type: 'PURCHASE_RECEIPT', p_payload: { company_id: companyId, doc_date: docDate,
      party_id: h.party_id, godown_id: godown, supplier_bill_no: bill.no || null, supplier_bill_date: bill.date || null, lines: payload } });
    await rpc('doc_submit', { p_doc_type: 'PURCHASE_RECEIPT', p_id: id });
    onDone();
  }, 'Received — stock IN posted');

  return (
    <Card title={<>Receive PO <Link className="text-brand hover:underline" href={`/erp/purchase-orders/?id=${h.order_id}`}>{h.po_no}</Link> — {h.party_name}</>}>
      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <Field label="Receipt date"><Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></Field>
        <Field label="Godown"><Select value={godown} onChange={(e) => setGodown(e.target.value)} placeholder="Choose" options={(godowns.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
        <Field label="Supplier bill no"><Input value={bill.no} onChange={(e) => setBill({ ...bill, no: e.target.value })} /></Field>
        <Field label="Bill date"><Input type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} /></Field>
      </div>
      <Table><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Pending</th><th>Receive now</th><th>Rack / bin</th><th>Rate</th><th>GST %</th></tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.po_line_id}><td>{l.item_name}<div className="text-xs text-slate-500">{l.item_code}</div></td>
            <td className="num">{num(l.ordered_base_qty)}</td><td className="num">{num(l.received_base_qty)}</td><td className="num font-semibold">{num(l.pending_base_qty)}</td>
            <td><Input aria-label={`Receive ${l.item_code}`} className="w-24" type="number" value={rows[l.po_line_id].qty} onChange={(e) => set(l.po_line_id, 'qty', e.target.value)} /></td>
            <td><Select aria-label={`Bin ${l.item_code}`} value={rows[l.po_line_id].loc} placeholder="Unassigned" options={locOpts} onChange={(e) => set(l.po_line_id, 'loc', e.target.value)} /></td>
            <td><Input aria-label={`Rate ${l.item_code}`} className="w-24" type="number" value={rows[l.po_line_id].rate} onChange={(e) => set(l.po_line_id, 'rate', e.target.value)} /></td>
            <td><Input aria-label={`GST ${l.item_code}`} className="w-16" type="number" value={rows[l.po_line_id].gst} onChange={(e) => set(l.po_line_id, 'gst', e.target.value)} /></td></tr>))}</tbody></Table>
      <p className="mt-2 text-xs text-slate-500">Quantities are in the item&apos;s base unit. Receiving more than pending is rejected.</p>
      <div className="mt-3 flex justify-end"><Button busy={busy} disabled={!canPost} onClick={post}>Post receipt</Button></div>
    </Card>
  );
}

function DirectReceipt({ onDone, canPost }: { onDone: () => void; canPost: boolean }) {
  const companyId = useCompanyId();
  const vendors = useParties(companyId, ['SUPPLIER', 'JOB_WORKER', 'CUTTER']);
  const godowns = useGodowns(companyId); const locations = useLocations(companyId);
  const items = useItems(companyId); const units = useUnitsAll(); const packings = usePackings(companyId);
  const { busy, run } = useAction();
  const [h, setH] = useState({ party_id: '', godown_id: '', doc_date: today(), bill: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const post = () => run(async () => {
    if (!h.party_id || !h.godown_id) throw new Error('Choose vendor and godown');
    const id = await rpc<string>('doc_save', { p_doc_type: 'PURCHASE_RECEIPT', p_payload: { company_id: companyId, doc_date: h.doc_date,
      party_id: h.party_id, godown_id: h.godown_id, supplier_bill_no: h.bill || null, lines: payloadLines(lines, { rate: true, location: 'location_id' }) } });
    await rpc('doc_submit', { p_doc_type: 'PURCHASE_RECEIPT', p_id: id });
    setLines([emptyLine()]); onDone();
  }, 'Direct receipt posted');
  return (
    <Card title="Direct purchase receipt (no PO)">
      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <Field label="Vendor"><Select value={h.party_id} onChange={(e) => setH({ ...h, party_id: e.target.value })} placeholder="Choose" options={(vendors.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Godown"><Select value={h.godown_id} onChange={(e) => setH({ ...h, godown_id: e.target.value })} placeholder="Choose" options={(godowns.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
        <Field label="Date"><Input type="date" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
        <Field label="Supplier bill no"><Input value={h.bill} onChange={(e) => setH({ ...h, bill: e.target.value })} /></Field>
      </div>
      <LineEditor lines={lines} onChange={setLines} items={items.data} units={units.data} packings={packings.data} rate unitKind="purchase"
        locations={locations.data} godownId={h.godown_id} />
      <div className="mt-3 flex justify-end"><Button busy={busy} disabled={!canPost} onClick={post}>Post receipt</Button></div>
    </Card>
  );
}

export default function Page() {
  return <Suspense><Receiving /></Suspense>;
}
