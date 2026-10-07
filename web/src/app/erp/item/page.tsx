'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { date, dateTime, label, money, num } from '@/lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat, Table } from '@/components/ui';

interface Detail { item_id: string; item_code: string; item_name: string; base_unit: string; sale_price: number | null;
  physical_qty: number; reserved_qty: number; available_qty: number; stock_status: string; category_name: string | null;
  min_stock: number; reorder_level: number; max_stock: number; pack_factor: number | null; pack_unit: string | null;
  godowns: { godown_id: string; godown_name: string; base_qty: number; reserved_qty: number; available_qty: number }[];
  locations: { location_id: string; godown_name: string; location_code: string; zone: string | null; is_default: boolean; base_qty: number }[] }

function ItemDetail() {
  const id = useSearchParams().get('id') ?? '';
  const d = useData(() => rpc<Detail>('inventory_item_detail', { p_item_id: id }), [id]);
  const moves = useData(async () => must<Record<string, string | number>[]>(await sb().from('v_stock_movement_history')
    .select('*').eq('item_id', id).order('created_at', { ascending: false }).limit(200)), [id]);
  const res = useData(async () => must<Record<string, string | number>[]>(await sb().from('v_stock_reservations')
    .select('*').eq('item_id', id).eq('status', 'ACTIVE').order('created_at')), [id]);

  if (d.loading && !d.data) return <Spinner />;
  if (!d.data) return <ErrorBox error={d.error ?? 'Item not found'} />;
  const x = d.data;
  return (
    <div className="space-y-4">
      <PageHeader title={x.item_name} subtitle={`${x.item_code}${x.category_name ? ' · ' + x.category_name : ''} · base unit ${x.base_unit}${x.pack_factor ? ` · 1 ${x.pack_unit} = ${num(x.pack_factor)} ${x.base_unit}` : ''}`}
        actions={<Link className="text-brand hover:underline" href={`/erp/items/?edit=${x.item_id}`}>Edit item master</Link>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total physical" value={num(x.physical_qty)} />
        <Stat label="Reserved" value={num(x.reserved_qty)} tone={Number(x.reserved_qty) ? 'amber' : undefined} />
        <Stat label="Available" value={num(x.available_qty)} tone={Number(x.available_qty) > 0 ? 'green' : 'red'} />
        <Stat label="Sale price" value={money(x.sale_price) || '—'} />
        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-4"><Badge>{x.stock_status}</Badge>
          <span className="ml-2 text-xs text-slate-500">reorder {num(x.reorder_level)} · min {num(x.min_stock)} · max {num(x.max_stock)}</span></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Godown breakdown">
          <Table><thead><tr><th>Godown</th><th className="num">Physical</th><th className="num">Reserved</th><th className="num">Available</th></tr></thead>
            <tbody>{x.godowns.map((g) => (
              <tr key={g.godown_id}><td>{g.godown_name}</td><td className="num">{num(g.base_qty)}</td>
                <td className="num">{num(g.reserved_qty)}</td><td className="num font-semibold">{num(g.available_qty)}</td></tr>))}
              {x.godowns.length === 0 && <tr><td colSpan={4} className="text-slate-500">No stock</td></tr>}</tbody></Table>
        </Card>
        <Card title="Location breakdown (rack / shelf / bin)">
          <Table><thead><tr><th>Location</th><th>Zone</th><th className="num">Qty</th></tr></thead>
            <tbody>{x.locations.map((l) => (
              <tr key={l.location_id}><td>{l.godown_name} / <span className="font-mono">{l.location_code}</span>
                {l.is_default && <span className="ml-1 text-xs text-slate-500">(no rack assigned)</span>}</td>
                <td>{l.zone ?? ''}</td><td className="num">{num(l.base_qty)}</td></tr>))}
              {x.locations.length === 0 && <tr><td colSpan={3} className="text-slate-500">No stock</td></tr>}</tbody></Table>
        </Card>
      </div>
      <Card title="Active reservations">
        <Table><thead><tr><th>Order</th><th>Customer</th><th>Godown</th><th className="num">Open qty</th><th>Since</th></tr></thead>
          <tbody>{(res.data ?? []).map((r) => (
            <tr key={String(r.id)}><td><Link className="text-brand hover:underline" href={`/erp/sales-orders/?id=${r.sales_order_id}`}>{r.order_no}</Link></td>
              <td>{r.party_name}</td><td>{r.godown_name}</td><td className="num">{num(r.open_qty)}</td><td>{dateTime(r.created_at)}</td></tr>))}
            {res.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No reservations</td></tr>}</tbody></Table>
      </Card>
      <Card title="Stock movement history">
        <ErrorBox error={moves.error} />
        <Table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Godown / location</th><th className="num">In</th><th className="num">Out</th><th>Unit</th><th>Entered</th></tr></thead>
          <tbody>{(moves.data ?? []).map((m) => (
            <tr key={`${m.ledger}-${m.movement_id}`} className={m.ledger === 'RESERVATION' ? 'text-slate-500 italic' : ''}>
              <td>{date(m.movement_date)}</td><td>{label(m.movement_type)}</td><td>{m.doc_no}</td>
              <td>{m.godown_name}{m.location_code ? ` / ${m.location_code}` : ''}</td>
              <td className="num">{Number(m.direction) === 1 ? num(m.qty) : ''}</td>
              <td className="num">{Number(m.direction) === -1 ? num(m.qty) : ''}</td>
              <td>{m.unit}</td><td>{dateTime(m.created_at)}</td></tr>))}</tbody></Table>
        <p className="mt-2 text-xs text-slate-500">Reservation rows (italic) do not change physical stock. History cannot be edited — corrections are made with a stock adjustment or cancellation.</p>
      </Card>
    </div>
  );
}

export default function ItemPage() {
  return <Suspense><ItemDetail /></Suspense>;
}
