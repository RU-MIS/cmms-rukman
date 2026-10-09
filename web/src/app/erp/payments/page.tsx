'use client';
import { useState } from 'react';
import { must, rpc, sb, withValues } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useParties } from '@/lib/masters';
import { date, money, today } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, useAction } from '@/components/ui';

interface Account { id: string; name: string; sub_type: string }
interface Bill { bill_table: string; bill_id: string; doc_no: string; doc_date: string; due_date: string | null; bill_amount: number; outstanding_amount: number }
const METHODS = ['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER'].map((m) => ({ value: m, label: m }));

export default function PaymentsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const [form, setForm] = useState<'RECEIPT' | 'PAYMENT' | 'CONTRA' | null>(null);
  const list = useData(async () => await withValues(must<{ id: string; doc_no: string | null; doc_date: string; voucher_type: string; payment_method: string | null; amount: number;
    status: string; instrument_ref: string | null; parties: { name: string } | null; acc: { name: string } | null; to: { name: string } | null }[]>(
    await sb().from('vouchers').select('id, doc_no, doc_date, voucher_type, payment_method, status, instrument_ref, parties(name), acc:accounts!vouchers_cash_bank_account_id_fkey(name), to:accounts!vouchers_to_account_id_fkey(name)')
      .eq('company_id', companyId).in('voucher_type', ['RECEIPT', 'PAYMENT', 'CONTRA']).order('created_at', { ascending: false }).limit(100)), 'v_vouchers', ['amount']), [companyId]);
  return (
    <div>
      <PageHeader title="Payments" subtitle="Customer receipts, vendor payments and cash ↔ bank transfers — one payment can settle many bills, one bill can get many payments"
        actions={can('voucher.create') && <>
          <Button onClick={() => setForm('RECEIPT')}>Receive from customer</Button>
          <Button onClick={() => setForm('PAYMENT')}>Pay vendor</Button>
          <Button variant="secondary" onClick={() => setForm('CONTRA')}>Bank / cash transfer</Button></>} />
      <ErrorBox error={list.error} />
      {!list.data ? (list.error ? null : <Spinner />) : (
        <Table><thead><tr><th>No</th><th>Date</th><th>Type</th><th>Party / transfer</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>{list.data.map((v) => (
            <tr key={v.id}><td>{v.doc_no ?? 'Draft'}</td><td>{date(v.doc_date)}</td><td>{v.voucher_type}</td>
              <td>{v.voucher_type === 'CONTRA' ? `${v.acc?.name} → ${v.to?.name}` : v.parties?.name}</td>
              <td>{v.payment_method}</td><td>{v.instrument_ref}</td><td className="num">{money(v.amount)}</td><td><Badge>{v.status}</Badge></td></tr>))}
            {list.data.length === 0 && <tr><td colSpan={8} className="text-slate-500">No payments yet</td></tr>}</tbody></Table>
      )}
      {form && <VoucherForm type={form} onClose={() => setForm(null)} onDone={() => { setForm(null); list.reload(); }} />}
    </div>
  );
}

function VoucherForm({ type, onClose, onDone }: { type: 'RECEIPT' | 'PAYMENT' | 'CONTRA'; onClose: () => void; onDone: () => void }) {
  const companyId = useCompanyId();
  const { busy, run } = useAction();
  const parties = useParties(companyId, type === 'RECEIPT' ? 'CUSTOMER' : ['SUPPLIER', 'JOB_WORKER', 'CUTTER', 'TRANSPORTER', 'WORKER']);
  const accounts = useData(async () => must<Account[]>(await sb().from('accounts').select('id, name, sub_type').eq('company_id', companyId)
    .in('sub_type', ['CASH', 'BANK']).eq('is_group', false).eq('is_active', true).order('name')), [companyId]);
  const book = useData(async () => must<{ id: string }[]>(await sb().from('voucher_books').select('id').eq('company_id', companyId).order('code').limit(1)), [companyId]);
  const [h, setH] = useState({ party_id: '', account_id: '', to_account_id: '', method: 'BANK', ref: '', amount: '', doc_date: today(), narration: '' });
  const [alloc, setAlloc] = useState<Record<string, { amount: string; tds: string }>>({});
  const bills = useData(async () => h.party_id ? must<Bill[]>(await sb().from('v_bill_outstanding').select('bill_table, bill_id, doc_no, doc_date, due_date, bill_amount, outstanding_amount')
    .eq('company_id', companyId).eq('party_id', h.party_id).eq('side', type === 'RECEIPT' ? 'RECEIVABLE' : 'PAYABLE').gt('outstanding_amount', 0).order('doc_date')) : [], [h.party_id]);
  const allocated = Object.values(alloc).reduce((s, a) => s + Number(a.amount || 0), 0);
  const accOpts = (accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.sub_type.toLowerCase()})` }));

  const autoAllocate = () => {
    let left = Number(h.amount || 0);
    const next: typeof alloc = {};
    for (const b of bills.data ?? []) {
      const take = Math.min(left, Number(b.outstanding_amount));
      if (take > 0) next[b.bill_id] = { amount: String(Math.round(take * 100) / 100), tds: '' };
      left -= take;
    }
    setAlloc(next);
  };

  const save = () => run(async () => {
    if (!book.data?.[0]) throw new Error('No voucher book');
    if (!(Number(h.amount) > 0)) throw new Error('Enter the amount');
    const payload: Record<string, unknown> = { company_id: companyId, doc_date: h.doc_date, voucher_type: type, book_id: book.data[0].id,
      cash_bank_account_id: h.account_id, amount: Number(h.amount), narration: h.narration || null };
    if (type === 'CONTRA') payload.to_account_id = h.to_account_id;
    else Object.assign(payload, { party_id: h.party_id, payment_method: h.method, instrument_ref: h.ref || null, instrument: h.method });
    const id = await rpc<string>('doc_save', { p_doc_type: 'VOUCHER', p_payload: payload });
    if (type !== 'CONTRA') {
      const rows = (bills.data ?? []).filter((b) => Number(alloc[b.bill_id]?.amount || 0) > 0 || Number(alloc[b.bill_id]?.tds || 0) > 0)
        .map((b) => ({ bill_table: b.bill_table, bill_id: b.bill_id, amount: Number(alloc[b.bill_id].amount || 0), tds_amount: Number(alloc[b.bill_id].tds || 0) }));
      await rpc('voucher_set_allocations', { p_voucher_id: id, p_allocations: rows });
    }
    const r = await rpc<{ status: string; warnings: string[] }>('doc_submit', { p_doc_type: 'VOUCHER', p_id: id });
    if (r.warnings?.length) alert(r.warnings.join('\n'));
    onDone();
  }, type === 'CONTRA' ? 'Transfer posted' : 'Payment posted');

  return (
    <Modal open wide title={type === 'RECEIPT' ? 'Receive payment from customer' : type === 'PAYMENT' ? 'Pay vendor' : 'Bank / cash transfer (contra)'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Date"><Input type="date" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
          {type !== 'CONTRA' && <Field label={type === 'RECEIPT' ? 'Customer' : 'Vendor'}><Select value={h.party_id} placeholder="Choose"
            onChange={(e) => { setH({ ...h, party_id: e.target.value }); setAlloc({}); }} options={(parties.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>}
          <Field label={type === 'CONTRA' ? 'From account' : type === 'RECEIPT' ? 'Received into' : 'Paid from'}><Select value={h.account_id} placeholder="Cash / bank account"
            onChange={(e) => setH({ ...h, account_id: e.target.value })} options={accOpts} /></Field>
          {type === 'CONTRA' && <Field label="To account"><Select value={h.to_account_id} placeholder="Cash / bank account" onChange={(e) => setH({ ...h, to_account_id: e.target.value })} options={accOpts} /></Field>}
          {type !== 'CONTRA' && <Field label="Method"><Select value={h.method} onChange={(e) => setH({ ...h, method: e.target.value })} options={METHODS} /></Field>}
          {type !== 'CONTRA' && <Field label="UTR / cheque no / reference"><Input value={h.ref} onChange={(e) => setH({ ...h, ref: e.target.value })} /></Field>}
          <Field label="Amount"><Input type="number" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
          <Field label="Narration" className="md:col-span-3"><Input value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} /></Field>
        </div>
        {type !== 'CONTRA' && h.party_id && (
          <Card title="Settle bills" actions={<Button variant="secondary" onClick={autoAllocate}>Allocate oldest first</Button>}>
            <Table><thead><tr><th>Bill</th><th>Date</th><th>Due</th><th className="num">Outstanding</th><th>Allocate</th>{type === 'RECEIPT' && <th>TDS</th>}</tr></thead>
              <tbody>{(bills.data ?? []).map((b) => (
                <tr key={b.bill_id}><td>{b.doc_no}</td><td>{date(b.doc_date)}</td><td>{date(b.due_date)}</td><td className="num">{money(b.outstanding_amount)}</td>
                  <td><Input aria-label={`Allocate ${b.doc_no}`} className="w-32" type="number" value={alloc[b.bill_id]?.amount ?? ''}
                    onChange={(e) => setAlloc({ ...alloc, [b.bill_id]: { amount: e.target.value, tds: alloc[b.bill_id]?.tds ?? '' } })} /></td>
                  {type === 'RECEIPT' && <td><Input aria-label={`TDS ${b.doc_no}`} className="w-24" type="number" value={alloc[b.bill_id]?.tds ?? ''}
                    onChange={(e) => setAlloc({ ...alloc, [b.bill_id]: { amount: alloc[b.bill_id]?.amount ?? '', tds: e.target.value } })} /></td>}</tr>))}
                {bills.data?.length === 0 && <tr><td colSpan={6} className="text-slate-500">No outstanding bills — the amount stays as advance</td></tr>}</tbody></Table>
            <p className="mt-2 text-sm">Allocated {money(allocated)} of {money(h.amount || 0)}{Number(h.amount) > allocated ? ` — ${money(Number(h.amount) - allocated)} stays as advance` : ''}</p>
          </Card>
        )}
        <div className="flex justify-end"><Button busy={busy} onClick={save}>Post</Button></div>
      </div>
    </Modal>
  );
}
