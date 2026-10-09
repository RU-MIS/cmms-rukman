'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { date, money, num, today } from '@/lib/format';
import { PortalShell, portalTabs, type PortalContext } from '@/components/PortalShell';
import { downloadFile, safeName } from '@/components/Documents';
import { MyDocumentsList } from '@/components/PortalDocs';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Stat, Table, Tabs, TextArea, useAction, useToast } from '@/components/ui';

interface CatalogItem { item_id: string; code: string; name: string; description: string | null; category: string | null; brand: string | null;
  unit: string; unit_id: string; base_unit: string; pack_factor: number; price: number | null;
  stock: { visibility: string; qty?: number; status?: string } }
interface CartLine { item: CatalogItem; qty: string; quote: string }

function StockCell({ s, unit }: { s: CatalogItem['stock']; unit: string }) {
  if (s.visibility === 'HIDDEN') return <span className="text-slate-400">—</span>;
  if (s.visibility === 'AVAILABLE_STATUS') return <Badge>{s.status}</Badge>;
  return <span>{num(s.qty)} {unit}{s.visibility === 'AVAILABLE_TO_PROMISE' && <span className="block text-xs text-slate-500">available to promise</span>}</span>;
}

function CustomerPortal() {
  const companyId = useSearchParams().get('c') ?? '';
  return <PortalShell companyId={companyId} kind="CUSTOMER">{(ctx) => <Customer ctx={ctx} />}</PortalShell>;
}

function Customer({ ctx }: { ctx: PortalContext }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const tabs = portalTabs(ctx, [{ id: 'catalog', label: 'Products', feature: 'catalog' }, { id: 'cart', label: `New PO (${cart.length})`, feature: 'create_po' },
    { id: 'pos', label: 'My POs', feature: 'view_pos' }, { id: 'orders', label: 'My orders', feature: 'view_orders' },
    { id: 'invoices', label: 'Invoices', feature: 'view_invoices' }, { id: 'payments', label: 'Payments', feature: 'view_payments' },
    { id: 'docs', label: 'Documents', feature: 'view_documents' }]);
  const [picked, setTab] = useState('');
  const tab = tabs.some((t) => t.id === picked) ? picked : tabs[0]?.id ?? '';
  const canOrder = tabs.some((t) => t.id === 'cart');
  const c = ctx.company_id;
  const outstanding = useData(() => rpc<{ visible: boolean; total_outstanding?: number; overdue?: number; bills?: number }>('portal_my_outstanding', { p_company_id: c }), [c]);
  return (
    <div>
      <PageHeader title={`Welcome, ${ctx.party_name}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {outstanding.data?.visible && <>
          <Stat label="Outstanding" value={money(outstanding.data.total_outstanding)} />
          <Stat label="Overdue" value={money(outstanding.data.overdue)} tone={Number(outstanding.data.overdue) > 0 ? 'red' : undefined} /></>}
        {canOrder && <Stat label="Items in PO cart" value={cart.length} />}
      </div>
      {tabs.length === 0 ? <Card><Empty>No portal features are enabled for your login. Please contact us.</Empty></Card>
        : <Tabs active={tab} onChange={setTab} tabs={tabs} />}
      {tab === 'catalog' && <Catalog ctx={ctx} cart={cart} setCart={setCart} goCart={() => setTab('cart')} canOrder={canOrder} />}
      {tab === 'cart' && <Cart ctx={ctx} cart={cart} setCart={setCart} onDone={() => { setCart([]); setTab('pos'); }} />}
      {tab === 'pos' && <MyPos ctx={ctx} />}
      {tab === 'orders' && <MyOrders companyId={c} />}
      {tab === 'invoices' && <MyInvoices companyId={c} />}
      {tab === 'payments' && <MyPayments companyId={c} />}
      {tab === 'docs' && <MyDocuments companyId={c} />}
    </div>
  );
}

function Catalog({ ctx, cart, setCart, goCart, canOrder }: { ctx: PortalContext; cart: CartLine[]; setCart: (c: CartLine[]) => void; goCart: () => void; canOrder: boolean }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const toast = useToast();
  const items = useData(() => rpc<CatalogItem[]>('portal_catalog', { p_company_id: ctx.company_id, p_search: q || null }), [ctx.company_id, q]);
  const [qty, setQty] = useState<Record<string, string>>({});
  return (
    <Card>
      <form className="mb-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); }}>
        <Input placeholder="Search product, code or barcode" value={search} onChange={(e) => setSearch(e.target.value)} /><Button type="submit" variant="secondary">Search</Button>
      </form>
      <ErrorBox error={items.error} />
      {!items.data ? (items.error ? null : <Spinner />) : items.data.length === 0 ? <Empty>No products</Empty> : (
        <Table><thead><tr><th>Product</th>{ctx.rate_visible && <th className="num">Price</th>}{ctx.stock_visibility !== 'HIDDEN' && <th>Stock</th>}{canOrder && <><th>Request quantity</th><th /></>}</tr></thead>
          <tbody>{items.data.map((i) => (
            <tr key={i.item_id}>
              <td className="font-medium">{i.name}<div className="text-xs text-slate-500">{i.code}{i.category ? ` · ${i.category}` : ''}{i.brand ? ` · ${i.brand}` : ''}</div>
                {i.description && <div className="text-xs text-slate-500">{i.description}</div>}</td>
              {ctx.rate_visible && <td className="num">{i.price === null ? '—' : `${money(i.price)} / ${i.base_unit}`}</td>}
              {ctx.stock_visibility !== 'HIDDEN' && <td><StockCell s={i.stock} unit={i.base_unit} /></td>}
              {canOrder && <><td><div className="flex items-center gap-1"><Input aria-label={`Qty ${i.code}`} className="w-24" type="number" min="0" value={qty[i.item_id] ?? ''}
                onChange={(e) => setQty({ ...qty, [i.item_id]: e.target.value })} /><span className="text-xs text-slate-500">{i.unit}</span></div></td>
              <td><Button variant="secondary" onClick={() => {
                if (!(Number(qty[i.item_id]) > 0)) { toast.fail('Enter a quantity'); return; }
                setCart([...cart.filter((l) => l.item.item_id !== i.item_id), { item: i, qty: qty[i.item_id], quote: '' }]);
                toast.ok(`${i.name} added to the PO`);
              }}>Add to PO</Button></td></>}
            </tr>))}</tbody></Table>
      )}
      {canOrder && cart.length > 0 && <div className="mt-3 flex justify-end"><Button onClick={goCart}>Review PO ({cart.length})</Button></div>}
    </Card>
  );
}

function Cart({ ctx, cart, setCart, onDone }: { ctx: PortalContext; cart: CartLine[]; setCart: (c: CartLine[]) => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [h, setH] = useState({ po_no: '', po_date: today(), requested_delivery_date: '', ship_to: '', remarks: '' });
  const [file, setFile] = useState<File | null>(null);
  if (cart.length === 0) return <Card><Empty>Add products from the Products tab.</Empty></Card>;
  const submit = () => run(async () => {
    if (!h.po_no.trim()) throw new Error('Enter your PO number');
    const r = await rpc<{ customer_po_id: string }>('portal_customer_po_create', { p_company_id: ctx.company_id, p_payload: {
      po_no: h.po_no.trim(), po_date: h.po_date, requested_delivery_date: h.requested_delivery_date || null,
      ship_to_address_id: h.ship_to || null, remarks: h.remarks || null,
      lines: cart.map((l) => ({ item_id: l.item.item_id, qty: Number(l.qty), unit_id: l.item.unit_id,
        quoted_rate: ctx.quote_price_enabled && l.quote !== '' ? Number(l.quote) : null })) } });
    if (file) {
      const path = `${ctx.company_id}/portal/${ctx.party_id}/${crypto.randomUUID()}-${safeName(file.name)}`;
      must(await sb().storage.from('documents').upload(path, file, { contentType: file.type || undefined }));
      await rpc('portal_document_register', { p_company_id: ctx.company_id, p_customer_po_id: r.customer_po_id,
        p_payload: { storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size } });
    }
    onDone();
  }, 'PO submitted — the company will review it');
  return (
    <Card title="New purchase order">
      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <Field label="Your PO number *"><Input value={h.po_no} onChange={(e) => setH({ ...h, po_no: e.target.value })} /></Field>
        <Field label="PO date"><Input type="date" value={h.po_date} onChange={(e) => setH({ ...h, po_date: e.target.value })} /></Field>
        <Field label="Requested delivery date"><Input type="date" value={h.requested_delivery_date} onChange={(e) => setH({ ...h, requested_delivery_date: e.target.value })} /></Field>
        {ctx.addresses.length > 0 && <Field label="Deliver to"><Select value={h.ship_to} onChange={(e) => setH({ ...h, ship_to: e.target.value })} placeholder="Default"
          options={ctx.addresses.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))} /></Field>}
        <Field label="Remarks" className="md:col-span-4"><TextArea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
      </div>
      <Table><thead><tr><th>Product</th><th>Quantity</th>{ctx.rate_visible && <th className="num">Price</th>}{ctx.quote_price_enabled && <th>Your price (per {cart[0].item.base_unit})</th>}<th /></tr></thead>
        <tbody>{cart.map((l, i) => (
          <tr key={l.item.item_id}><td>{l.item.name}</td>
            <td><Input aria-label={`Cart qty ${l.item.code}`} className="w-24" type="number" value={l.qty} onChange={(e) => setCart(cart.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /> {l.item.unit}</td>
            {ctx.rate_visible && <td className="num">{money(l.item.price)}</td>}
            {ctx.quote_price_enabled && <td><Input aria-label={`Quote ${l.item.code}`} className="w-28" type="number" placeholder="optional" value={l.quote}
              onChange={(e) => setCart(cart.map((x, j) => j === i ? { ...x, quote: e.target.value } : x))} /></td>}
            <td><button aria-label="Remove" className="text-slate-400 hover:text-red-600" onClick={() => setCart(cart.filter((_, j) => j !== i))}>✕</button></td></tr>))}</tbody></Table>
      {ctx.quote_price_enabled && <p className="mt-2 text-xs text-slate-500">Your requested price is sent for review — the final price is confirmed by the company.</p>}
      <Field label="Attachment (optional)" className="mt-3"><input aria-label="Attachment" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      <div className="mt-3 flex justify-end"><Button busy={busy} onClick={submit}>Submit PO</Button></div>
    </Card>
  );
}

function MyPos({ ctx }: { ctx: PortalContext }) {
  const { busy, run } = useAction();
  const pos = useData(() => rpc<{ id: string; po_no: string; po_date: string; requested_delivery_date: string | null; status: string; reject_reason: string | null;
    sales_order_no: string | null; order_status: string | null; lines: { item_name: string; qty: number; unit: string; quoted_rate: number | null; reference_rate: number | null; approved_rate: number | null }[] }[]>(
    'portal_my_customer_pos', { p_company_id: ctx.company_id }), [ctx.company_id]);
  if (!pos.data) return pos.error ? <ErrorBox error={pos.error} /> : <Spinner />;
  if (pos.data.length === 0) return <Card><Empty>No POs yet</Empty></Card>;
  return (
    <div className="space-y-3">{pos.data.map((p) => (
      <Card key={p.id} title={<>PO {p.po_no} <span className="ml-2 text-sm font-normal text-slate-500">{date(p.po_date)}</span></>}
        actions={<><Badge>{p.status}</Badge>{p.status === 'SUBMITTED' && <Button variant="secondary" busy={busy} onClick={() => {
          if (confirm('Cancel this PO?')) run(async () => { await rpc('portal_customer_po_cancel', { p_company_id: ctx.company_id, p_customer_po_id: p.id }); pos.reload(); }, 'PO cancelled');
        }}>Cancel PO</Button>}</>}>
        {p.reject_reason && <p className="mb-2 text-sm text-red-600">Rejected: {p.reject_reason}</p>}
        {p.sales_order_no && <p className="mb-2 text-sm">Order {p.sales_order_no} · <Badge>{p.order_status}</Badge></p>}
        <Table><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Your price</th>{ctx.rate_visible && <th className="num">List price</th>}<th className="num">Approved price</th></tr></thead>
          <tbody>{p.lines.map((l, i) => (<tr key={i}><td>{l.item_name}</td><td className="num">{num(l.qty)} {l.unit}</td>
            <td className="num">{l.quoted_rate === null ? '—' : money(l.quoted_rate)}</td>{ctx.rate_visible && <td className="num">{money(l.reference_rate)}</td>}
            <td className="num font-semibold">{l.approved_rate === null ? 'In review' : money(l.approved_rate)}</td></tr>))}</tbody></Table>
      </Card>))}</div>
  );
}

function MyOrders({ companyId }: { companyId: string }) {
  const orders = useData(() => rpc<{ id: string; order_no: string; customer_po_no: string; order_date: string; delivery_date: string | null; status: string;
    lines: { item_name: string; unit: string; rate: number | null; ordered_qty: number; dispatched_qty: number; pending_qty: number }[];
    dispatches: { doc_no: string; date: string; vehicle_no: string | null; delivered_date: string | null }[] }[]>('portal_my_orders', { p_company_id: companyId }), [companyId]);
  if (!orders.data) return orders.error ? <ErrorBox error={orders.error} /> : <Spinner />;
  if (orders.data.length === 0) return <Card><Empty>No orders yet</Empty></Card>;
  return (
    <div className="space-y-3">{orders.data.map((o) => (
      <Card key={o.id} title={<>Order {o.order_no} <span className="ml-2 text-sm font-normal text-slate-500">your PO {o.customer_po_no} · {date(o.order_date)}</span></>} actions={<Badge>{o.status}</Badge>}>
        <Table><thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">Dispatched</th><th className="num">Pending</th><th className="num">Price</th></tr></thead>
          <tbody>{o.lines.map((l, i) => (<tr key={i}><td>{l.item_name}</td><td className="num">{num(l.ordered_qty)} {l.unit}</td><td className="num">{num(l.dispatched_qty)}</td>
            <td className="num">{num(l.pending_qty)}</td><td className="num">{money(l.rate)}</td></tr>))}</tbody></Table>
        {o.dispatches.length > 0 && <p className="mt-2 text-sm text-slate-600">Dispatches: {o.dispatches.map((d) => `${d.doc_no} on ${date(d.date)}${d.vehicle_no ? ` (${d.vehicle_no})` : ''}${d.delivered_date ? ` — delivered ${date(d.delivered_date)}` : ''}`).join('; ')}</p>}
      </Card>))}</div>
  );
}

function MyInvoices({ companyId }: { companyId: string }) {
  const toast = useToast();
  const inv = useData(() => rpc<{ id: string; bill_no: string; bill_date: string; due_date: string | null; amount: number; paid: number | null; outstanding: number | null;
    documents: { id: string; file_name: string; storage_path: string }[] }[]>('portal_my_invoices', { p_company_id: companyId }), [companyId]);
  if (!inv.data) return inv.error ? <ErrorBox error={inv.error} /> : <Spinner />;
  return (
    <Table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Outstanding</th><th>PDF</th></tr></thead>
      <tbody>{inv.data.map((b) => (<tr key={b.id}><td>{b.bill_no}</td><td>{date(b.bill_date)}</td><td>{date(b.due_date)}</td><td className="num">{money(b.amount)}</td>
        <td className="num">{money(b.paid)}</td><td className="num font-semibold">{money(b.outstanding)}</td>
        <td>{b.documents.map((d) => <button key={d.id} className="mr-2 text-brand hover:underline" onClick={() => downloadFile(d.storage_path, d.file_name).catch(toast.fail)}>{d.file_name}</button>)}</td></tr>))}
        {inv.data.length === 0 && <tr><td colSpan={7} className="text-slate-500">No invoices</td></tr>}</tbody></Table>
  );
}

function MyPayments({ companyId }: { companyId: string }) {
  const pays = useData(() => rpc<{ id: string; voucher_no: string; date: string; amount: number; method: string | null; reference: string | null;
    allocations: { bill_no: string; amount: number }[] }[]>('portal_my_payments', { p_company_id: companyId }), [companyId]);
  if (!pays.data) return pays.error ? <ErrorBox error={pays.error} /> : <Spinner />;
  return (
    <Table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th>Against invoices</th></tr></thead>
      <tbody>{pays.data.map((p) => (<tr key={p.id}><td>{p.voucher_no}</td><td>{date(p.date)}</td><td>{p.method}</td><td>{p.reference}</td><td className="num">{money(p.amount)}</td>
        <td>{p.allocations.map((a) => `${a.bill_no}: ${money(a.amount)}`).join(', ')}</td></tr>))}
        {pays.data.length === 0 && <tr><td colSpan={6} className="text-slate-500">No payments recorded</td></tr>}</tbody></Table>
  );
}

function MyDocuments({ companyId }: { companyId: string }) { return <MyDocumentsList companyId={companyId} kind="CUSTOMER" />; }

export default function Page() {
  return <Suspense><CustomerPortal /></Suspense>;
}
