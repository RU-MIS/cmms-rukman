'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useParties } from '@/lib/masters';
import { date, money, today } from '@/lib/format';
import { DocumentsPanel, uploadDocument, type EntityType } from '@/components/Documents';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Toggle, useAction } from '@/components/ui';

interface Bill { bill_table: string; bill_id: string; company_id: string; party_id: string; party_name: string; doc_no: string; doc_date: string;
  bill_amount: number; side: string; due_date: string | null; settled_amount: number; outstanding_amount: number; overdue_days: number | null }

const entityOf: Record<string, EntityType | null> = { customer_bills: 'customer_bill', purchase_receipts: 'purchase_receipt' };

export default function BillsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const [tab, setTab] = useState('RECEIVABLE');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [sel, setSel] = useState<Bill | null>(null);
  const [recording, setRecording] = useState(false);
  const bills = useData(async () => {
    let q = sb().from('v_bill_outstanding').select('*').eq('company_id', companyId).eq('side', tab)
      .in('bill_table', tab === 'RECEIVABLE' ? ['customer_bills'] : ['purchase_receipts', 'service_bills', 'job_work_receipts'])
      .order('due_date', { ascending: true });
    if (onlyOpen) q = q.gt('outstanding_amount', 0);
    return must<Bill[]>(await q);
  }, [companyId, tab, onlyOpen]);
  const total = (bills.data ?? []).reduce((s, b) => s + Number(b.outstanding_amount), 0);

  return (
    <div>
      <PageHeader title="Invoices & bills" subtitle="Customer invoices are made in Tally — record them here, upload the PDF and the customer is emailed automatically"
        actions={can('customer_bill.create') && <Button onClick={() => setRecording(true)}>Record Tally invoice</Button>} />
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'RECEIVABLE', label: 'Customer invoices (receivable)' }, { id: 'PAYABLE', label: 'Vendor bills (payable)' }]} />
      <div className="mb-3 flex items-center gap-4"><div className="w-56"><Toggle label="Only outstanding" checked={onlyOpen} onChange={setOnlyOpen} /></div>
        <span className="text-sm">Total outstanding: <b>{money(total)}</b></span></div>
      <ErrorBox error={bills.error} />
      {!bills.data ? (bills.error ? null : <Spinner />) : (
        <Table><thead><tr><th>Bill</th><th>Party</th><th>Date</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
          <tbody>{bills.data.map((b) => {
            const st = Number(b.outstanding_amount) <= 0 ? 'PAID' : Number(b.settled_amount) > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
            return (
              <tr key={b.bill_id}><td><button className="font-medium text-brand hover:underline" onClick={() => setSel(b)}>{b.doc_no}</button></td>
                <td>{b.party_name}</td><td>{date(b.doc_date)}</td>
                <td className={Number(b.overdue_days) > 0 && Number(b.outstanding_amount) > 0 ? 'font-medium text-red-600' : ''}>{date(b.due_date)}
                  {Number(b.overdue_days) > 0 && Number(b.outstanding_amount) > 0 && <span className="ml-1 text-xs">({b.overdue_days}d overdue)</span>}</td>
                <td className="num">{money(b.bill_amount)}</td><td className="num">{money(b.settled_amount)}</td>
                <td className="num font-semibold">{money(b.outstanding_amount)}</td><td><Badge>{st}</Badge></td></tr>);
          })}
            {bills.data.length === 0 && <tr><td colSpan={8} className="text-slate-500">No bills</td></tr>}</tbody></Table>
      )}
      {sel && <BillDetail bill={sel} onClose={() => setSel(null)} onChanged={() => bills.reload()} />}
      {recording && <RecordInvoice onClose={() => setRecording(false)} onDone={() => { setRecording(false); bills.reload(); }} />}
    </div>
  );
}

function BillDetail({ bill, onClose, onChanged }: { bill: Bill; onClose: () => void; onChanged: () => void }) {
  const companyId = useCompanyId();
  const { busy, run } = useAction();
  const [due, setDue] = useState(bill.due_date ?? '');
  const pays = useData(async () => must<Record<string, string | number>[]>(await sb().from('v_payment_allocations').select('*')
    .eq('bill_table', bill.bill_table).eq('bill_id', bill.bill_id).order('payment_date')), [bill.bill_id]);
  const entity = entityOf[bill.bill_table];
  return (
    <Modal open wide title={`${bill.doc_no} — ${bill.party_name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
          <div>Amount <b>{money(bill.bill_amount)}</b></div><div>Paid <b>{money(bill.settled_amount)}</b></div>
          <div>Outstanding <b>{money(bill.outstanding_amount)}</b></div><div>Bill date <b>{date(bill.doc_date)}</b></div>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Due date (reminders use this)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Button variant="secondary" busy={busy} onClick={() => run(async () => {
            await rpc('bill_set_due_date', { p_bill_table: bill.bill_table, p_bill_id: bill.bill_id, p_due_date: due }); onChanged(); }, 'Due date saved')}>Save due date</Button>
        </div>
        <Card title="Payments against this bill (one bill can have many payments)">
          <Table><thead><tr><th>Voucher</th><th>Date</th><th>Method</th><th>Reference</th><th className="num">Allocated</th><th className="num">TDS</th></tr></thead>
            <tbody>{(pays.data ?? []).map((p) => (<tr key={`${p.voucher_id}`}><td>{p.voucher_no}</td><td>{date(p.payment_date)}</td><td>{p.payment_method}</td>
              <td>{p.instrument_ref}</td><td className="num">{money(p.allocated_amount)}</td><td className="num">{money(p.tds_amount)}</td></tr>))}
              {pays.data?.length === 0 && <tr><td colSpan={6} className="text-slate-500">No payments yet</td></tr>}</tbody></Table>
        </Card>
        {entity && <DocumentsPanel companyId={companyId} entityType={entity} entityId={bill.bill_id}
          defaultCategory={entity === 'customer_bill' ? 'INVOICE' : 'PURCHASE_DOCUMENT'}
          title={entity === 'customer_bill' ? 'Invoice PDF (uploading emails the customer when Customer Invoice Email is ON)' : 'Documents'} />}
      </div>
    </Modal>
  );
}

function RecordInvoice({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const companyId = useCompanyId();
  const customers = useParties(companyId, 'CUSTOMER');
  const { busy, run } = useAction();
  const [h, setH] = useState({ party_id: '', bill_no: '', doc_date: today(), amount: '', due_date: '', remarks: '' });
  const [file, setFile] = useState<File | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const save = () => run(async () => {
    if (!h.party_id || !h.bill_no.trim() || !(Number(h.amount) > 0)) throw new Error('Customer, invoice number and amount are required');
    const id = await rpc<string>('doc_save', { p_doc_type: 'CUSTOMER_BILL', p_payload: { company_id: companyId, doc_date: h.doc_date,
      bill_no: h.bill_no.trim(), party_id: h.party_id, amount: Number(h.amount), due_date: h.due_date || null, remarks: h.remarks || null } });
    await rpc('doc_submit', { p_doc_type: 'CUSTOMER_BILL', p_id: id });
    if (file) await uploadDocument(companyId, 'customer_bill', id, file, { category: 'INVOICE', visible: true, sendEmail });
    onDone();
  }, file ? 'Invoice recorded and PDF uploaded' : 'Invoice recorded');
  return (
    <Modal open title="Record invoice made in Tally" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer *" className="col-span-2"><Select value={h.party_id} onChange={(e) => setH({ ...h, party_id: e.target.value })} placeholder="Choose"
            options={(customers.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Invoice no (as in Tally) *"><Input value={h.bill_no} onChange={(e) => setH({ ...h, bill_no: e.target.value })} /></Field>
          <Field label="Invoice date"><Input type="date" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
          <Field label="Amount (incl. GST) *"><Input type="number" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
          <Field label="Due date" hint="Blank = invoice date + customer credit days"><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
        </div>
        <Field label="Tally invoice PDF"><input aria-label="Invoice PDF" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Toggle label="Email the invoice to the customer (if Customer Invoice Email is ON)" checked={sendEmail} onChange={setSendEmail} />
        <p className="text-xs text-slate-500">This ERP does not create GST invoices — it stores the Tally invoice for tracking, emailing, payments and reminders.</p>
        <div className="flex justify-end"><Button busy={busy} onClick={save}>Save invoice</Button></div>
      </div>
    </Modal>
  );
}
