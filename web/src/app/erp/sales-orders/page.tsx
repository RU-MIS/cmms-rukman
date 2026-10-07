'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns, useLocations } from '@/lib/masters';
import { date, dateTime, money, num, today } from '@/lib/format';
import { DocumentsPanel } from '@/components/Documents';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, useAction } from '@/components/ui';

interface SO { id: string; doc_no: string; doc_date: string; customer_po_no: string; delivery_date: string | null; status: string;
  parties: { name: string } | null; customer_po_id: string | null }
interface SOLine { order_id: string; order_line_id: string; line_no: number; item_id: string; item_code: string; item_name: string;
  qty: number; approved_rate: number | null; quoted_rate: number | null; reference_rate: number | null; ordered_base_qty: number;
  dispatched_base_qty: number; pending_base_qty: number; reserved_base_qty: number; unreserved_base_qty: number;
  pack_factor: number | null; order_status: string; party_name: string; doc_no: string; customer_po_no: string; po_date: string; delivery_date: string | null }

function SalesOrders() {
  const companyId = useCompanyId();
  const id = useSearchParams().get('id');
  const [status, setStatus] = useState('OPEN');
  const list = useData(async () => {
    let q = sb().from('sales_orders').select('id, doc_no, doc_date, customer_po_no, delivery_date, status, customer_po_id, parties(name)')
      .eq('company_id', companyId).order('doc_date', { ascending: false }).limit(300);
    if (status === 'OPEN') q = q.in('status', ['OPEN', 'PARTIALLY_DISPATCHED']);
    else if (status !== 'ALL') q = q.eq('status', status);
    return must<SO[]>(await q);
  }, [companyId, status]);
  if (id) return <OrderDetail id={id} />;
  return (
    <div>
      <PageHeader title="Sales orders & dispatch" subtitle="Approved customer POs → reserve stock → dispatch (stock OUT)" />
      <div className="mb-3 max-w-xs"><Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} options={[
        { value: 'OPEN', label: 'Open / partially dispatched' }, { value: 'DISPATCHED', label: 'Dispatched' }, { value: 'CLOSED', label: 'Closed' },
        { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} /></div>
      <ErrorBox error={list.error} />
      {!list.data ? <Spinner /> : (
        <Table><thead><tr><th>Order</th><th>Customer</th><th>Customer PO</th><th>Date</th><th>Delivery</th><th>Status</th></tr></thead>
          <tbody>{list.data.map((o) => (
            <tr key={o.id}><td><Link className="font-medium text-brand hover:underline" href={`/erp/sales-orders/?id=${o.id}`}>{o.doc_no}</Link></td>
              <td>{o.parties?.name}</td><td>{o.customer_po_no}</td><td>{date(o.doc_date)}</td><td>{date(o.delivery_date)}</td><td><Badge>{o.status}</Badge></td></tr>))}
            {list.data.length === 0 && <tr><td colSpan={6} className="text-slate-500">No orders</td></tr>}</tbody></Table>
      )}
    </div>
  );
}

function OrderDetail({ id }: { id: string }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const router = useRouter();
  const { busy, run } = useAction();
  const godowns = useGodowns(companyId);
  const locations = useLocations(companyId);
  const lines = useData(async () => must<SOLine[]>(await sb().from('v_sales_order_lines').select('*').eq('order_id', id).order('line_no')), [id]);
  const so = useData(async () => must<{ status: string; godown_id: string | null; close_reason: string | null }>(
    await sb().from('sales_orders').select('status, godown_id, close_reason').eq('id', id).single()), [id]);
  const res = useData(async () => must<Record<string, string | number>[]>(await sb().from('v_stock_reservations').select('*')
    .eq('sales_order_id', id).order('created_at')), [id]);
  const dsp = useData(async () => must<{ id: string; doc_no: string; doc_date: string; status: string; vehicle_no: string | null; delivered_date: string | null; godowns: { name: string } | null }[]>(
    await sb().from('dispatches').select('id, doc_no, doc_date, status, vehicle_no, delivered_date, godowns(name)').eq('sales_order_id', id).order('created_at')), [id]);
  const [reserveLine, setReserveLine] = useState<SOLine | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const reloadAll = () => { lines.reload(); so.reload(); res.reload(); dsp.reload(); };

  if (!lines.data || !so.data) return <Spinner />;
  const h = lines.data[0];
  const open = ['OPEN', 'PARTIALLY_DISPATCHED'].includes(so.data.status);

  return (
    <div className="space-y-4">
      <PageHeader title={`Sales order ${h?.doc_no ?? ''}`} subtitle={h ? `${h.party_name} · customer PO ${h.customer_po_no} · ${date(h.po_date)}${h.delivery_date ? ' · delivery ' + date(h.delivery_date) : ''}` : ''}
        actions={<>
          <Button variant="secondary" onClick={() => router.push('/erp/sales-orders/')}>← All orders</Button>
          {open && can('dispatch.create') && <Button onClick={() => setDispatching(true)}>Dispatch</Button>}
          {open && can('sales_order.cancel') && <Button variant="danger" busy={busy} onClick={() => {
            const reason = prompt('Reason to close this order (pending quantity will not be dispatched):');
            if (reason) run(async () => { await rpc('sales_order_close', { p_order_id: id, p_reason: reason }); reloadAll(); }, 'Order closed');
          }}>Close order</Button>}
        </>} />
      <div className="flex gap-2"><Badge>{so.data.status}</Badge>{so.data.close_reason && <span className="text-sm text-slate-500">Closed: {so.data.close_reason}</span>}</div>
      <Card title="Lines">
        <Table><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Dispatched</th><th className="num">Pending</th>
          <th className="num">Reserved</th><th className="num">Quoted</th><th className="num">Approved price</th><th /></tr></thead>
          <tbody>{lines.data.map((l) => (
            <tr key={l.order_line_id}>
              <td>{l.item_name}<div className="text-xs text-slate-500">{l.item_code}</div></td>
              <td className="num">{num(l.ordered_base_qty)}</td><td className="num">{num(l.dispatched_base_qty)}</td>
              <td className="num font-semibold">{num(l.pending_base_qty)}</td><td className="num">{num(l.reserved_base_qty)}</td>
              <td className="num">{l.quoted_rate === null ? '—' : money(l.quoted_rate)}</td>
              <td className="num">{money(l.approved_rate)}
                {open && can('sales_order.approve') && <button className="ml-1 text-xs text-brand" onClick={() => {
                  const v = prompt(`New approved price for ${l.item_name}`, String(l.approved_rate ?? ''));
                  if (v !== null) run(async () => { await rpc('sales_order_line_set_rate', { p_order_line_id: l.order_line_id, p_rate: Number(v), p_reason: 'Changed from sales order screen' }); lines.reload(); }, 'Price updated');
                }}>edit</button>}</td>
              <td>{open && can('reservation.create') && Number(l.unreserved_base_qty) > 0 && <Button variant="ghost" onClick={() => setReserveLine(l)}>Reserve</Button>}</td>
            </tr>))}</tbody></Table>
        <p className="mt-2 text-xs text-slate-500">Quantities in base units. Reservation keeps stock for this order: it reduces available stock, not physical stock.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reservations">
          <Table><thead><tr><th>Item</th><th>Godown</th><th className="num">Reserved</th><th className="num">Dispatched</th><th className="num">Open</th><th>Status</th><th /></tr></thead>
            <tbody>{(res.data ?? []).map((r) => (
              <tr key={String(r.id)}><td>{r.item_name}</td><td>{r.godown_name}</td><td className="num">{num(r.base_qty)}</td>
                <td className="num">{num(r.consumed_qty)}</td><td className="num">{num(r.open_qty)}</td><td><Badge>{String(r.status)}</Badge></td>
                <td>{r.status === 'ACTIVE' && can('reservation.cancel') && <Button variant="ghost" busy={busy} onClick={() =>
                  run(async () => { await rpc('reservation_release', { p_reservation_id: r.id }); reloadAll(); }, 'Reservation released')}>Release</Button>}</td></tr>))}
              {res.data?.length === 0 && <tr><td colSpan={7} className="text-slate-500">No reservations</td></tr>}</tbody></Table>
        </Card>
        <Card title="Dispatches">
          <Table><thead><tr><th>No</th><th>Date</th><th>Godown</th><th>Vehicle</th><th>Delivered</th><th /></tr></thead>
            <tbody>{(dsp.data ?? []).map((d) => (
              <tr key={d.id}><td>{d.doc_no}</td><td>{date(d.doc_date)}</td><td>{d.godowns?.name}</td><td>{d.vehicle_no}</td>
                <td>{d.delivered_date ? date(d.delivered_date) : d.status === 'POSTED' && can('dispatch.edit') ? <Button variant="ghost" onClick={() => {
                  const v = prompt('Delivered on (YYYY-MM-DD)', today());
                  if (v) run(async () => { await rpc('dispatch_mark_delivered', { p_dispatch_id: d.id, p_delivered_date: v }); dsp.reload(); }, 'Marked delivered');
                }}>Mark delivered</Button> : ''}</td><td><Badge>{d.status}</Badge></td></tr>))}
              {dsp.data?.length === 0 && <tr><td colSpan={6} className="text-slate-500">No dispatches yet</td></tr>}</tbody></Table>
        </Card>
      </div>
      <DocumentsPanel companyId={companyId} entityType="sales_order" entityId={id} defaultCategory="DELIVERY_DOCUMENT" />
      {reserveLine && <ReserveModal line={reserveLine} godowns={godowns.data ?? []} defaultGodown={so.data.godown_id}
        onClose={() => setReserveLine(null)} onDone={() => { setReserveLine(null); reloadAll(); }} />}
      {dispatching && <DispatchModal orderId={id} lines={lines.data.filter((l) => Number(l.pending_base_qty) > 0)}
        godowns={godowns.data ?? []} locations={locations.data ?? []} defaultGodown={so.data.godown_id}
        onClose={() => setDispatching(false)} onDone={() => { setDispatching(false); reloadAll(); }} />}
      <p className="text-xs text-slate-400">Updated {dateTime(new Date().toISOString())}</p>
    </div>
  );
}

function ReserveModal({ line, godowns, defaultGodown, onClose, onDone }: { line: SOLine; godowns: { id: string; name: string }[];
  defaultGodown: string | null; onClose: () => void; onDone: () => void }) {
  const companyId = useCompanyId();
  const [godown, setGodown] = useState(defaultGodown ?? '');
  const [qty, setQty] = useState(String(line.unreserved_base_qty));
  const { busy, run } = useAction();
  const avail = useData(async () => godown ? must<{ available_qty: number }[]>(await sb().from('v_stock_balance').select('available_qty')
    .eq('company_id', companyId).eq('item_id', line.item_id).eq('godown_id', godown)) : [], [godown, line.item_id]);
  const available = avail.data?.[0]?.available_qty ?? 0;
  return (
    <Modal open title={`Reserve ${line.item_name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Godown"><Select value={godown} onChange={(e) => setGodown(e.target.value)} placeholder="Choose" options={godowns.map((g) => ({ value: g.id, label: g.name }))} /></Field>
        {godown && <p className="text-sm">Available in this godown: <b>{num(available)}</b> · still to reserve: <b>{num(line.unreserved_base_qty)}</b></p>}
        <Field label="Quantity to reserve (base unit)"><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <div className="flex justify-end"><Button busy={busy} onClick={() => run(async () => {
          if (!godown) throw new Error('Choose the godown');
          await rpc('sales_order_reserve', { p_order_line_id: line.order_line_id, p_godown_id: godown, p_qty: Number(qty), p_unit_id: null });
          onDone(); }, 'Stock reserved')}>Reserve</Button></div>
      </div>
    </Modal>
  );
}

function DispatchModal({ orderId, lines, godowns, locations, defaultGodown, onClose, onDone }: { orderId: string; lines: SOLine[];
  godowns: { id: string; name: string }[]; locations: { id: string; godown_id: string; code: string; is_default: boolean; is_active: boolean }[];
  defaultGodown: string | null; onClose: () => void; onDone: () => void }) {
  const companyId = useCompanyId();
  const [godown, setGodown] = useState(defaultGodown ?? '');
  const [docDate, setDocDate] = useState(today());
  const [vehicle, setVehicle] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.order_line_id, String(l.pending_base_qty)])));
  const [loc, setLoc] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const items = useData(async () => must<{ id: string; base_unit_id: string }[]>(await sb().from('items').select('id, base_unit_id')
    .in('id', lines.map((l) => l.item_id))), [lines.map((l) => l.item_id).join()]);
  const locOpts = locations.filter((l) => l.godown_id === godown && l.is_active).map((l) => ({ value: l.id, label: l.is_default ? 'Unassigned' : l.code }));
  const post = () => run(async () => {
    if (!godown) throw new Error('Choose the godown');
    const payload = lines.filter((l) => Number(qty[l.order_line_id]) > 0).map((l) => ({
      order_line_id: l.order_line_id, item_id: l.item_id, qty: Number(qty[l.order_line_id]),
      unit_id: items.data?.find((i) => i.id === l.item_id)?.base_unit_id, location_id: loc[l.order_line_id] || null }));
    if (payload.length === 0) throw new Error('Enter a quantity to dispatch');
    const id = await rpc<string>('doc_save', { p_doc_type: 'DISPATCH', p_payload: { company_id: companyId, doc_date: docDate,
      sales_order_id: orderId, godown_id: godown, vehicle_no: vehicle || null, lines: payload } });
    await rpc('doc_submit', { p_doc_type: 'DISPATCH', p_id: id });
    onDone();
  }, 'Dispatched — stock OUT posted');
  return (
    <Modal open wide title="Dispatch" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Dispatch date"><Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></Field>
          <Field label="From godown"><Select value={godown} onChange={(e) => setGodown(e.target.value)} placeholder="Choose" options={godowns.map((g) => ({ value: g.id, label: g.name }))} /></Field>
          <Field label="Vehicle no"><Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></Field>
        </div>
        <Table><thead><tr><th>Item</th><th className="num">Pending</th><th className="num">Reserved</th><th>Dispatch qty (base unit)</th><th>Rack / bin</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.order_line_id}><td>{l.item_name}</td><td className="num">{num(l.pending_base_qty)}</td><td className="num">{num(l.reserved_base_qty)}</td>
              <td><Input aria-label={`Dispatch ${l.item_code}`} type="number" value={qty[l.order_line_id]} onChange={(e) => setQty({ ...qty, [l.order_line_id]: e.target.value })} /></td>
              <td><Select aria-label={`Bin ${l.item_code}`} value={loc[l.order_line_id] ?? ''} placeholder="Auto pick" options={locOpts}
                onChange={(e) => setLoc({ ...loc, [l.order_line_id]: e.target.value })} /></td></tr>))}</tbody></Table>
        <p className="text-xs text-slate-500">The order&apos;s own reservation in this godown is consumed first. Dispatch beyond available stock is rejected when negative stock is OFF.</p>
        <div className="flex justify-end"><Button busy={busy} onClick={post}>Post dispatch</Button></div>
      </div>
    </Modal>
  );
}

export default function Page() {
  return <Suspense><SalesOrders /></Suspense>;
}
