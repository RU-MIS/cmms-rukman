'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, sb } from '@/lib/supabase';
import { useCompanyId } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns } from '@/lib/masters';
import { num, money } from '@/lib/format';
import { Badge, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table } from '@/components/ui';

interface Row { item_id: string; item_code: string; item_name: string; category_id: string | null; category_name: string | null;
  base_unit: string; pack_factor: number | null; pack_unit: string | null; sale_price: number | null;
  physical_qty: number; reserved_qty: number; available_qty: number; location_count: number; godown_count: number;
  stock_status: string; is_active: boolean }

function InventoryList() {
  const companyId = useCompanyId();
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [godown, setGodown] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const godowns = useGodowns(companyId);
  const cats = useData(async () => must<{ id: string; name: string }[]>(await sb().from('item_categories').select('id, name')
    .eq('company_id', companyId).order('name')), [companyId]);
  const items = useData(async () => must<Row[]>(await sb().from('v_inventory_items').select('*').eq('company_id', companyId)
    .order('item_name')), [companyId]);
  // per-godown figures when a godown is selected
  const perGodown = useData(async () => godown
    ? must<{ item_id: string; base_qty: number; reserved_qty: number; available_qty: number }[]>(await sb().from('v_stock_balance')
        .select('item_id, base_qty, reserved_qty, available_qty').eq('company_id', companyId).eq('godown_id', godown))
    : null, [companyId, godown]);
  const locCount = useData(async () => godown
    ? must<{ item_id: string }[]>(await sb().from('v_stock_by_location').select('item_id').eq('company_id', companyId).eq('godown_id', godown))
    : null, [companyId, godown]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (items.data ?? []).map((r) => {
      if (!godown) return r;
      const g = perGodown.data?.find((x) => x.item_id === r.item_id);
      return { ...r, physical_qty: g?.base_qty ?? 0, reserved_qty: g?.reserved_qty ?? 0, available_qty: g?.available_qty ?? 0,
        location_count: (locCount.data ?? []).filter((x) => x.item_id === r.item_id).length };
    }).filter((r) => (!s || r.item_name.toLowerCase().includes(s) || r.item_code.toLowerCase().includes(s))
      && (!category || r.category_id === category) && (!status || r.stock_status === status)
      && (!godown || r.physical_qty !== 0 || r.reserved_qty !== 0));
  }, [items.data, perGodown.data, locCount.data, search, category, status, godown]);

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Consolidated stock of all godowns — click an item for godown and rack/bin breakdown" />
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search item"><Input placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="Godown"><Select value={godown} onChange={(e) => setGodown(e.target.value)} placeholder="All godowns"
          options={(godowns.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories"
          options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Stock status"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All"
          options={[{ value: 'IN_STOCK', label: 'In stock' }, { value: 'LOW_STOCK', label: 'Low stock' }, { value: 'OUT_OF_STOCK', label: 'Out of stock' }]} /></Field>
      </div>
      <ErrorBox error={items.error} />
      {items.loading && !items.data ? <Spinner /> : (
        <Table>
          <thead><tr>
            <th>Item</th><th className="num">Total</th><th className="num">Reserved</th><th className="num">Available</th>
            <th className="num">Locations</th><th>Status</th><th className="num">Sale price</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id}>
                <td><Link className="font-medium text-brand hover:underline" href={`/erp/item/?id=${r.item_id}`}>{r.item_name}</Link>
                  <div className="text-xs text-slate-500">{r.item_code}{r.category_name ? ` · ${r.category_name}` : ''}</div></td>
                <td className="num">{num(r.physical_qty)} <span className="text-xs text-slate-500">{r.base_unit}</span>
                  {r.pack_factor ? <div className="text-xs text-slate-500">{num(Number(r.physical_qty) / Number(r.pack_factor))} {r.pack_unit}</div> : null}</td>
                <td className="num">{num(r.reserved_qty)}</td>
                <td className="num font-semibold">{num(r.available_qty)}</td>
                <td className="num">{r.location_count}</td>
                <td><Badge>{r.stock_status}</Badge></td>
                <td className="num">{money(r.sale_price)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {items.data && rows.length === 0 && <Empty>No items match the filters.</Empty>}
    </div>
  );
}

export default function InventoryPage() {
  return <Suspense><InventoryList /></Suspense>;
}
