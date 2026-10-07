'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { date, money, num } from '@/lib/format';
import { downloadPoPdf } from '@/lib/po-download';
import { PortalShell, type PortalContext } from '@/components/PortalShell';
import { downloadFile } from '@/components/Documents';
import { MyDocumentsList } from '@/components/PortalDocs';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, Stat, Table, Tabs, useToast } from '@/components/ui';

interface VendorPo { id: string; po_no: string; po_date: string; expected_date: string | null; status: string; remarks: string | null;
  lines: { item_code: string; item_name: string; qty: number; unit: string; base_unit: string; rate: number | null; ordered_qty: number;
    received_qty: number; pending_qty: number; stock: { visibility: string; qty?: number; status?: string } }[];
  documents: { id: string; file_name: string; storage_path: string }[] }

function VendorPortal() {
  const companyId = useSearchParams().get('c') ?? '';
  return <PortalShell companyId={companyId} kind="VENDOR">{(ctx) => <Vendor ctx={ctx} />}</PortalShell>;
}

function Vendor({ ctx }: { ctx: PortalContext }) {
  const [tab, setTab] = useState('pending');
  const toast = useToast();
  const pos = useData(() => rpc<VendorPo[]>('portal_vendor_pos', { p_company_id: ctx.company_id }), [ctx.company_id]);
  const pay = useData(() => rpc<{ visible: boolean; total_outstanding?: number;
    bills?: { bill_no: string; bill_date: string; due_date: string | null; amount: number; paid: number; outstanding: number; status: string }[];
    payments?: { id: string; voucher_no: string; date: string; amount: number; method: string | null; reference: string | null; allocations: { bill_no: string; amount: number }[] }[] }>(
    'portal_vendor_payments', { p_company_id: ctx.company_id }), [ctx.company_id]);
  const open = (pos.data ?? []).filter((p) => ['OPEN', 'PARTIALLY_RECEIVED'].includes(p.status));
  const shown = tab === 'pending' ? open : pos.data ?? [];
  const pendingLines = open.reduce((s, p) => s + p.lines.filter((l) => Number(l.pending_qty) > 0).length, 0);

  return (
    <div>
      <PageHeader title={`Welcome, ${ctx.party_name}`} subtitle="Purchase orders placed with you, supply status and payments" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open POs" value={open.length} />
        <Stat label="Lines pending supply" value={pendingLines} tone={pendingLines ? 'amber' : undefined} />
        {pay.data?.visible && <Stat label="Payment due to you" value={money(pay.data.total_outstanding)} />}
      </div>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'pending', label: 'Pending supply' }, { id: 'all', label: 'All POs' },
        { id: 'payments', label: 'Payments' }, { id: 'docs', label: 'Documents' }]} />
      {(tab === 'pending' || tab === 'all') && (pos.error ? <ErrorBox error={pos.error} /> : !pos.data ? <Spinner /> :
        shown.length === 0 ? <Card><Empty>No purchase orders</Empty></Card> : (
          <div className="space-y-3">{shown.map((p) => (
            <Card key={p.id} title={<>PO {p.po_no} <span className="ml-2 text-sm font-normal text-slate-500">{date(p.po_date)}{p.expected_date ? ` · expected ${date(p.expected_date)}` : ''}</span></>}
              actions={<><Badge>{p.status}</Badge><Button variant="secondary" onClick={() => downloadPoPdf(p.id, { companyId: ctx.company_id }).catch(toast.fail)}>PO PDF</Button></>}>
              {p.remarks && <p className="mb-2 text-sm text-slate-600">{p.remarks}</p>}
              <Table><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Pending</th>
                {ctx.rate_visible && <th className="num">Rate</th>}{ctx.stock_visibility !== 'HIDDEN' && <th>Our stock</th>}</tr></thead>
                <tbody>{p.lines.filter((l) => tab === 'all' || Number(l.pending_qty) > 0).map((l, i) => (
                  <tr key={i}><td>{l.item_name}<div className="text-xs text-slate-500">{l.item_code}</div></td>
                    <td className="num">{num(l.ordered_qty)} {l.base_unit}</td><td className="num">{num(l.received_qty)}</td>
                    <td className="num font-semibold">{num(l.pending_qty)}</td>
                    {ctx.rate_visible && <td className="num">{money(l.rate)}</td>}
                    {ctx.stock_visibility !== 'HIDDEN' && <td>{l.stock.visibility === 'AVAILABLE_STATUS' ? <Badge>{l.stock.status}</Badge> : num(l.stock.qty)}</td>}</tr>))}</tbody></Table>
              {p.documents.length > 0 && <p className="mt-2 text-sm">Documents: {p.documents.map((d) => (
                <button key={d.id} className="mr-2 text-brand hover:underline" onClick={() => downloadFile(d.storage_path, d.file_name).catch(toast.fail)}>{d.file_name}</button>))}</p>}
            </Card>))}</div>
        ))}
      {tab === 'payments' && (!pay.data ? <Spinner /> : !pay.data.visible ? <Card><Empty>Payment information is not shared in this portal.</Empty></Card> : (
        <div className="space-y-4">
          <Card title="Bills">
            <Table><thead><tr><th>Bill</th><th>Date</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
              <tbody>{(pay.data.bills ?? []).map((b, i) => (<tr key={i}><td>{b.bill_no}</td><td>{date(b.bill_date)}</td><td>{date(b.due_date)}</td>
                <td className="num">{money(b.amount)}</td><td className="num">{money(b.paid)}</td><td className="num">{money(b.outstanding)}</td><td><Badge>{b.status}</Badge></td></tr>))}
                {pay.data.bills?.length === 0 && <tr><td colSpan={7} className="text-slate-500">No bills</td></tr>}</tbody></Table>
          </Card>
          <Card title="Payment history">
            <Table><thead><tr><th>Voucher</th><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th>Against</th></tr></thead>
              <tbody>{(pay.data.payments ?? []).map((p) => (<tr key={p.id}><td>{p.voucher_no}</td><td>{date(p.date)}</td><td>{p.method}</td><td>{p.reference}</td>
                <td className="num">{money(p.amount)}</td><td>{p.allocations.map((a) => `${a.bill_no}: ${money(a.amount)}`).join(', ')}</td></tr>))}
                {pay.data.payments?.length === 0 && <tr><td colSpan={6} className="text-slate-500">No payments yet</td></tr>}</tbody></Table>
          </Card>
        </div>))}
      {tab === 'docs' && <MyDocumentsList companyId={ctx.company_id} kind="VENDOR" />}
    </div>
  );
}

export default function Page() {
  return <Suspense><VendorPortal /></Suspense>;
}
