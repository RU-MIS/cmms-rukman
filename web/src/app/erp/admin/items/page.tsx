'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useParties, useUnitsAll } from '@/lib/masters';
import { date, dateTime, money, num } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, TextArea, Toggle, useAction, useToast } from '@/components/ui';
import { CustomFieldsEditor, useCustomFields } from '@/components/admin/CustomFields';
import { downloadRows, exportEntity } from '@/lib/spreadsheet';
import { useHotkeys } from '@/lib/hotkeys';
import { compressImage } from '@/lib/image';
import { PAGE_SIZE, Pager, SortTh, ilikeTerm, type Sort } from '@/components/ListTools';
import { DocumentsPanel } from '@/components/Documents';
import { AuditTrail } from '@/components/AuditTrail';

interface ItemRow { id: string; code: string; name: string; description: string | null; item_kind: string; category_id: string | null;
  brand_id: string | null; base_unit_id: string; purchase_unit_id: string | null; sales_unit_id: string | null; barcode: string | null;
  purchase_price: number | null; sale_price: number | null; min_stock: number; max_stock: number; reorder_level: number;
  hsn_code: string | null; gst_rate: number; is_active: boolean; portal_visible: boolean; sku: string | null; notes: string | null;
  custom: Record<string, unknown>; can_view_sale_rate?: boolean; can_view_purchase_rate?: boolean; can_edit_rate?: boolean;
  part_no: string | null; model: string | null; reorder_qty: number | null; min_sale_rate: number | null; max_sale_rate: number | null }
interface Packing { id: string; item_id: string; unit_id: string; factor_to_base: number; is_default: boolean }

const blank = (): Partial<ItemRow> => ({ item_kind: 'FINISHED_GOOD', is_active: true, portal_visible: true, min_stock: 0, max_stock: 0,
  reorder_level: 0, gst_rate: 0, custom: {} });
const kinds = ['FINISHED_GOOD', 'RAW_MATERIAL', 'PACKING', 'SERVICE'].map((k) => ({ value: k, label: k.replace('_', ' ') }));
const ITEM_COLS = 'id, code, name, description, item_kind, category_id, brand_id, base_unit_id, purchase_unit_id, sales_unit_id, barcode, '
  + 'purchase_price, sale_price, min_stock, max_stock, reorder_level, hsn_code, gst_rate, is_active, portal_visible, sku, notes, custom, '
  + 'can_view_sale_rate, can_view_purchase_rate, can_edit_rate, part_no, model, reorder_qty, min_sale_rate, max_sale_rate';

function ItemsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const editParam = useSearchParams().get('edit');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [kindF, setKindF] = useState('');
  const [catF, setCatF] = useState('');
  const [statusF, setStatusF] = useState('ACTIVE');
  const [sort, setSort] = useState<Sort>({ col: 'name', asc: true });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Partial<ItemRow> | null>(null);
  const { busy, run } = useAction();
  const units = useUnitsAll();
  const searchRef = useRef<HTMLInputElement>(null);
  // server-side page of the masked view (prices NULL where the user has no field right)
  const items = useData(async () => {
    let qy = sb().from('v_items').select(ITEM_COLS, { count: 'exact' }).eq('company_id', companyId).eq('is_deleted', false);
    if (q.trim()) { const t = ilikeTerm(q); qy = qy.or(`code.ilike.${t},name.ilike.${t},barcode.ilike.${t},sku.ilike.${t},part_no.ilike.${t}`); }
    if (kindF) qy = qy.eq('item_kind', kindF);
    if (catF) qy = qy.eq('category_id', catF);
    if (statusF) qy = qy.eq('is_active', statusF === 'ACTIVE');
    const res = await qy.order(sort.col, { ascending: sort.asc }).order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    return { rows: must<ItemRow[]>(res), total: res.count ?? 0 };
  }, [companyId, q, kindF, catF, statusF, sort.col, sort.asc, page]);
  const cats = useData(async () => must<{ id: string; name: string }[]>(await sb().from('item_categories').select('id, name').eq('company_id', companyId).order('name')), [companyId]);

  useEffect(() => {
    if (!editParam || edit) return;
    sb().from('v_items').select(ITEM_COLS).eq('id', editParam).maybeSingle().then(({ data }) => { if (data) setEdit(data as unknown as ItemRow); });
  }, [editParam, edit]);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  useHotkeys({ '/': () => searchRef.current?.focus(), n: can('items.create') ? () => setEdit(blank()) : undefined }, !edit);

  const rows = items.data?.rows ?? [];
  const unitCode = (id: string | null) => units.data?.find((u) => u.id === id)?.code ?? '';
  const showSale = rows.some((i) => i.can_view_sale_rate);
  const showPurchase = rows.some((i) => i.can_view_purchase_rate);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setFilter = (fn: () => void) => { fn(); setPage(0); };
  const bulk = (active: boolean) => run(async () => {
    if (!window.confirm(`${active ? 'Enable' : 'Disable'} ${selected.size} item(s)?`)) return;
    await rpc('master_set_active', { p_company_id: companyId, p_kind: 'ITEM', p_ids: [...selected], p_active: active });
    setSelected(new Set()); items.reload();
  }, active ? 'Items enabled' : 'Items disabled');

  return (
    <div>
      <PageHeader title="Items & packing" subtitle="Item / part master: units and packing, rates, images, documents and custom fields. Shortcuts: / search · N new · Esc close · Ctrl+S save"
        actions={<>
          {can('items.create') && <Button onClick={() => setEdit(blank())}>New item</Button>}
          {can('items.import') && <Link href="/erp/admin/import-export/?entity=ITEMS" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50">Import</Link>}
          {can('items.export') && <Button variant="secondary" busy={busy} onClick={() => run(() => exportEntity(companyId, 'ITEMS', 'Items'), 'Export ready')}>Export</Button>}
        </>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input ref={searchRef} className="max-w-xs" aria-label="Search items" placeholder="Search code, name, barcode, SKU, part no" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Kind filter" className="w-40" value={kindF} onChange={(e) => setFilter(() => setKindF(e.target.value))} placeholder="All kinds" options={kinds} />
        <Select aria-label="Category filter" className="w-44" value={catF} onChange={(e) => setFilter(() => setCatF(e.target.value))} placeholder="All categories"
          options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select aria-label="Status filter" className="w-32" value={statusF} onChange={(e) => setFilter(() => setStatusF(e.target.value))} placeholder="All"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        {selected.size > 0 && <div className="flex items-center gap-2 rounded-md bg-brand-light px-2 py-1 text-sm" data-testid="bulk-bar">
          {selected.size} selected
          {can('items.edit') && <><Button variant="secondary" busy={busy} onClick={() => bulk(true)}>Enable</Button>
            <Button variant="secondary" busy={busy} onClick={() => bulk(false)}>Disable</Button></>}
          {can('items.export') && <Button variant="secondary" busy={busy} onClick={() => run(async () => {
            const chosen = must<ItemRow[]>(await sb().from('v_items').select(ITEM_COLS).in('id', [...selected]));
            await downloadRows('items-selected', ['code', 'name', 'item_kind', 'part_no', 'model', 'barcode', 'sku', 'reorder_level', 'reorder_qty',
              ...(chosen.some((c) => c.can_view_purchase_rate) ? ['purchase_price'] : []), ...(chosen.some((c) => c.can_view_sale_rate) ? ['sale_price'] : [])],
              chosen as unknown as Record<string, unknown>[]);
          }, 'Export ready')}>Export selected</Button>}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button></div>}
      </div>
      <ErrorBox error={items.error} />
      {items.loading && !items.data ? <Spinner /> : (
        <>
          <Table>
            <thead><tr>
              <th><input type="checkbox" aria-label="Select page" checked={allOnPage}
                onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; })} /></th>
              <SortTh col="code" sort={sort} onSort={(x) => setFilter(() => setSort(x))}>Code</SortTh>
              <SortTh col="name" sort={sort} onSort={(x) => setFilter(() => setSort(x))}>Name</SortTh>
              <th>Kind</th><th>Base unit</th>
              {showPurchase && <th className="num">Purchase</th>}{showSale && <th className="num">Sale</th>}
              <SortTh col="reorder_level" sort={sort} onSort={(x) => setFilter(() => setSort(x))} className="num">Reorder</SortTh>
              <th>Portal</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id} data-testid={`item-row-${i.code}`}>
                <td><input type="checkbox" aria-label={`Select ${i.code}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td>
                <td className="font-mono">{i.code}</td>
                <td><Link className="text-brand hover:underline" href={`/erp/item/?id=${i.id}`}>{i.name}</Link>{i.sku && <div className="text-xs text-slate-500">SKU {i.sku}</div>}</td>
                <td>{i.item_kind.replace('_', ' ')}</td><td>{unitCode(i.base_unit_id)}</td>
                {showPurchase && <td className="num">{money(i.purchase_price)}</td>}{showSale && <td className="num">{money(i.sale_price)}</td>}
                <td className="num">{num(i.reorder_level)}</td><td>{i.portal_visible ? 'Visible' : 'Hidden'}</td>
                <td><Badge color={i.is_active ? 'green' : 'slate'}>{i.is_active ? 'Active' : 'Inactive'}</Badge></td>
                <td>{can('items.edit') && <Button variant="ghost" onClick={() => setEdit(i)}>Edit</Button>}</td>
              </tr>))}
              {rows.length === 0 && <tr><td colSpan={11} className="text-slate-500">No items</td></tr>}</tbody>
          </Table>
          <Pager page={page} total={items.data?.total ?? null} onPage={setPage} />
        </>
      )}
      {edit && <ItemEditor key={edit.id ?? 'new'} item={edit} onClose={() => setEdit(null)}
        onSaved={async (id) => { items.reload(); cats.reload();
          const fresh = must<ItemRow>(await sb().from('v_items').select(ITEM_COLS).eq('id', id).single()); setEdit(fresh); return fresh; }}
        onDeleted={() => { setEdit(null); items.reload(); }} />}
    </div>
  );
}

function ItemEditor({ item, onClose, onSaved, onDeleted }: { item: Partial<ItemRow>; onClose: () => void; onSaved: (id: string) => Promise<ItemRow>;
  onDeleted: () => void }) {
  const toast = useToast();
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Partial<ItemRow>>(item);
  const [tab, setTab] = useState('general');
  const [newCat, setNewCat] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [pack, setPack] = useState({ unit_id: '', factor: '' });
  const units = useUnitsAll();
  const cats = useData(async () => must<{ id: string; name: string }[]>(await sb().from('item_categories').select('id, name').eq('company_id', companyId).order('name')), [companyId]);
  const brands = useData(async () => must<{ id: string; name: string }[]>(await sb().from('brands').select('id, name').eq('company_id', companyId).order('name')), [companyId]);
  const packings = useData(async () => edit.id ? must<Packing[]>(await sb().from('item_packings').select('id, item_id, unit_id, factor_to_base, is_default').eq('item_id', edit.id)) : [], [edit.id]);
  const defs = useCustomFields(companyId, ['ITEM']);
  // new item: the user's field rights; existing item: as returned by the masked view
  const canEditRate = edit.id ? !!edit.can_edit_rate : can('items.edit_rate');
  const seeSale = edit.id ? !!edit.can_view_sale_rate : can('items.view_sale_rate');
  const seePurchase = edit.id ? !!edit.can_view_purchase_rate : can('items.view_purchase_rate');
  const unitOpts = (units.data ?? []).filter((u) => !u.company_id || u.company_id === companyId).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));
  const set = (k: keyof ItemRow, v: unknown) => setEdit((e) => ({ ...e, [k]: v }));
  const nOrNull = (v: string) => (v === '' ? null : Number(v));
  const itemUnits = unitOpts.filter((u) => u.value === edit.base_unit_id || (packings.data ?? []).some((p) => p.unit_id === u.value));
  const unitCode = (id: string | null | undefined) => units.data?.find((u) => u.id === id)?.code ?? '';

  const save = () => run(async () => {
    let category_id = edit.category_id ?? null;
    if (newCat.trim()) category_id = must<{ id: string }>(await sb().from('item_categories').insert({ company_id: companyId, name: newCat.trim() }).select('id').single()).id;
    let brand_id = edit.brand_id ?? null;
    if (newBrand.trim()) brand_id = must<{ id: string }>(await sb().from('brands').insert({ company_id: companyId, name: newBrand.trim() }).select('id').single()).id;
    const row: Record<string, unknown> = {
      code: edit.code?.trim(), name: edit.name?.trim(), description: edit.description || null, item_kind: edit.item_kind,
      category_id, brand_id, base_unit_id: edit.base_unit_id, purchase_unit_id: edit.purchase_unit_id || null,
      sales_unit_id: edit.sales_unit_id || null, barcode: edit.barcode?.trim() || null, sku: edit.sku?.trim() || null,
      min_stock: edit.min_stock ?? 0, max_stock: edit.max_stock ?? 0, reorder_level: edit.reorder_level ?? 0,
      hsn_code: edit.hsn_code || null, gst_rate: edit.gst_rate ?? 0, is_active: edit.is_active ?? true, portal_visible: edit.portal_visible ?? true,
      notes: edit.notes || null, custom: edit.custom ?? {},
    };
    // prices only when the user may change them (a masked price is never written back)
    if (canEditRate) {
      row.purchase_price = edit.purchase_price ?? null; row.sale_price = edit.sale_price ?? null;
      row.min_sale_rate = edit.min_sale_rate ?? null; row.max_sale_rate = edit.max_sale_rate ?? null;
    }
    row.part_no = edit.part_no?.trim() || null; row.model = edit.model?.trim() || null; row.reorder_qty = edit.reorder_qty ?? null;
    if (!row.name || !row.base_unit_id) throw new Error('Name and base unit are required (the code may be empty when automatic item codes are on)');
    if (!row.code) row.code = null;
    let id = edit.id;
    if (id) must(await sb().from('items').update(row).eq('id', id));
    else id = must<{ id: string }>(await sb().from('items').insert({ ...row, company_id: companyId }).select('id').single()).id;
    setNewCat(''); setNewBrand('');
    const fresh = await onSaved(id!);
    // with rate approval on, a price change waits for an approver (the stored price stays)
    if (canEditRate && edit.id && ((row.sale_price ?? null) !== (fresh.sale_price ?? null) || (row.purchase_price ?? null) !== (fresh.purchase_price ?? null))) {
      toast.ok('Price change sent for approval — it applies when an approver accepts it');
    }
  }, 'Item saved');
  useHotkeys({ 'mod+s': () => { if (can(edit.id ? 'items.edit' : 'items.create')) save(); } });

  const addPacking = () => run(async () => {
    if (!edit.id) throw new Error('Save the item first');
    if (!pack.unit_id || !(Number(pack.factor) > 0)) throw new Error('Choose a unit and a conversion factor > 0');
    must(await sb().from('item_packings').insert({ item_id: edit.id, unit_id: pack.unit_id, factor_to_base: Number(pack.factor),
      is_default: (packings.data ?? []).length === 0 }));
    setPack({ unit_id: '', factor: '' });
    packings.reload();
  }, 'Packing added');

  return (
    <Modal open wide title={edit.id ? `Edit ${edit.name}` : 'New item'} onClose={onClose}>
      <Tabs tabs={[{ id: 'general', label: 'General' }, ...(edit.id ? [{ id: 'rates', label: 'Rates' }, { id: 'images', label: 'Images' },
        { id: 'documents', label: 'Documents' }, { id: 'stock', label: 'Stock' }, { id: 'audit', label: 'Audit' }] : [])]}
        active={tab} onChange={setTab} />
      {tab === 'general' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Item code" hint={edit.id ? undefined : 'Empty = next automatic code (when switched on in Numbering)'}><Input aria-label="Item code" value={edit.code ?? ''} onChange={(e) => set('code', e.target.value)} /></Field>
            <Field label="Item name *" className="md:col-span-2"><Input value={edit.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Description" className="md:col-span-3"><TextArea rows={2} value={edit.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label="Kind"><Select value={edit.item_kind} onChange={(e) => set('item_kind', e.target.value)} options={kinds} /></Field>
            <Field label="Category"><Select value={edit.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)} placeholder="—"
              options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              <Input className="mt-1" placeholder="…or new category" value={newCat} onChange={(e) => setNewCat(e.target.value)} /></Field>
            <Field label="Brand"><Select value={edit.brand_id ?? ''} onChange={(e) => set('brand_id', e.target.value || null)} placeholder="—"
              options={(brands.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              <Input className="mt-1" placeholder="…or new brand" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} /></Field>
            <Field label="Base unit * (stock is kept in this unit)"><Select value={edit.base_unit_id ?? ''} disabled={!!edit.id}
              onChange={(e) => set('base_unit_id', e.target.value)} placeholder="Choose" options={unitOpts} /></Field>
            <Field label="Purchase unit" hint="Base unit or a packing below"><Select value={edit.purchase_unit_id ?? ''} placeholder="Base unit"
              onChange={(e) => set('purchase_unit_id', e.target.value || null)} options={itemUnits} /></Field>
            <Field label="Sales unit" hint="Base unit or a packing below"><Select value={edit.sales_unit_id ?? ''} placeholder="Base unit"
              onChange={(e) => set('sales_unit_id', e.target.value || null)} options={itemUnits} /></Field>
            <Field label="Barcode"><Input value={edit.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} /></Field>
            <Field label="SKU"><Input value={edit.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label="HSN code"><Input value={edit.hsn_code ?? ''} onChange={(e) => set('hsn_code', e.target.value)} /></Field>
            <Field label="Part number"><Input aria-label="Part number" value={edit.part_no ?? ''} onChange={(e) => set('part_no', e.target.value)} /></Field>
            <Field label="Model"><Input aria-label="Model" value={edit.model ?? ''} onChange={(e) => set('model', e.target.value)} /></Field>
            {seePurchase && <Field label="Purchase price (per base unit)"><Input type="number" step="0.01" disabled={!canEditRate} value={edit.purchase_price ?? ''}
              onChange={(e) => set('purchase_price', nOrNull(e.target.value))} /></Field>}
            {seeSale && <Field label="Sale price (per base unit)"><Input type="number" step="0.01" disabled={!canEditRate} value={edit.sale_price ?? ''}
              onChange={(e) => set('sale_price', nOrNull(e.target.value))} /></Field>}
            {seeSale && <Field label="Minimum sale rate (per base unit)" hint="Checked on sales orders per the Sales settings">
              <Input aria-label="Minimum sale rate" type="number" step="0.01" disabled={!canEditRate} value={edit.min_sale_rate ?? ''}
                onChange={(e) => set('min_sale_rate', nOrNull(e.target.value))} /></Field>}
            {seeSale && <Field label="Maximum sale rate (per base unit)">
              <Input aria-label="Maximum sale rate" type="number" step="0.01" disabled={!canEditRate} value={edit.max_sale_rate ?? ''}
                onChange={(e) => set('max_sale_rate', nOrNull(e.target.value))} /></Field>}
            <Field label="GST %"><Input type="number" value={edit.gst_rate ?? 0} onChange={(e) => set('gst_rate', Number(e.target.value))} /></Field>
            <Field label="Minimum stock"><Input type="number" value={edit.min_stock ?? 0} onChange={(e) => set('min_stock', Number(e.target.value))} /></Field>
            <Field label="Maximum stock"><Input type="number" value={edit.max_stock ?? 0} onChange={(e) => set('max_stock', Number(e.target.value))} /></Field>
            <Field label="Reorder level"><Input type="number" value={edit.reorder_level ?? 0} onChange={(e) => set('reorder_level', Number(e.target.value))} /></Field>
            <Field label="Reorder quantity"><Input aria-label="Reorder quantity" type="number" value={edit.reorder_qty ?? ''} onChange={(e) => set('reorder_qty', nOrNull(e.target.value))} /></Field>
            <Field label="Notes" className="md:col-span-3"><TextArea rows={2} value={edit.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
          </div>
          <CustomFieldsEditor defs={defs.data ?? []} value={edit.custom ?? {}} onChange={(v) => set('custom', v)} />
          <div className="grid gap-x-6 md:grid-cols-2">
            <Toggle label="Active" checked={edit.is_active ?? true} onChange={(v) => set('is_active', v)} />
            <Toggle label="Show in customer portal catalog" checked={edit.portal_visible ?? true} onChange={(v) => set('portal_visible', v)} />
          </div>
          <div className="flex justify-between gap-2">
            {edit.id && can('items.delete') ? <Button variant="danger" busy={busy} onClick={() => run(async () => {
              if (!window.confirm(`Delete ${edit.name}? Only possible when the item was never used — otherwise disable it.`)) return;
              await rpc('master_delete', { p_company_id: companyId, p_kind: 'ITEM', p_id: edit.id }); onDeleted(); }, 'Item deleted')}>Delete</Button> : <span />}
            <Button busy={busy} onClick={save}>Save item</Button></div>
          <Card title="Packing (item-specific conversion)">
            {!edit.id ? <p className="text-slate-500">Save the item first.</p> : (
              <>
                <Table className="mb-3"><thead><tr><th>Unit</th><th className="num">= base units</th><th>Default</th></tr></thead>
                  <tbody>{(packings.data ?? []).map((p) => (
                    <tr key={p.id}><td>1 {unitCode(p.unit_id)}</td><td className="num">{num(p.factor_to_base)} {unitCode(edit.base_unit_id)}</td>
                      <td>{p.is_default ? 'Yes' : ''}</td></tr>))}
                    {packings.data?.length === 0 && <tr><td colSpan={3} className="text-slate-500">No packing — stock is entered in the base unit only.</td></tr>}</tbody></Table>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Unit"><Select value={pack.unit_id} onChange={(e) => setPack({ ...pack, unit_id: e.target.value })} placeholder="Choose"
                    options={unitOpts.filter((u) => u.value !== edit.base_unit_id)} /></Field>
                  <Field label={`Contains (${unitCode(edit.base_unit_id)})`}><Input type="number" value={pack.factor} onChange={(e) => setPack({ ...pack, factor: e.target.value })} /></Field>
                  <Button variant="secondary" busy={busy} onClick={addPacking}>Add packing</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
      {tab === 'rates' && edit.id && <ItemRates itemId={edit.id} canEdit={canEditRate} />}
      {tab === 'images' && edit.id && <ItemImages itemId={edit.id} />}
      {tab === 'documents' && edit.id && <DocumentsPanel companyId={companyId} entityType="item" entityId={edit.id} title="Item documents" />}
      {tab === 'stock' && edit.id && <ItemStock itemId={edit.id} />}
      {tab === 'audit' && edit.id && <AuditTrail companyId={companyId} table="items" rowId={edit.id} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------- rates
function ItemRates({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const companyId = useCompanyId();
  const toast = useToast();
  const { can } = useSession();
  const { busy, run } = useAction();
  const customers = useParties(companyId, 'CUSTOMER');
  const vendors = useParties(companyId, ['SUPPLIER', 'JOB_WORKER', 'CUTTER']);
  // RLS: SALE rows only with the sales-rate right, PURCHASE rows only with the purchase-rate right
  const rates = useData(async () => must<{ id: string; rate_type: string; rate: number; effective_from: string; is_active: boolean; parties: { code: string; name: string } | null }[]>(
    await sb().from('party_item_rates').select('id, rate_type, rate, effective_from, is_active, parties(code, name)').eq('item_id', itemId)
      .in('rate_type', ['SALE', 'PURCHASE']).order('effective_from', { ascending: false })), [itemId]);
  const hist = useData(async () => must<{ id: number; rate_type: string; source: string; action: string; old_rate: number | null; new_rate: number | null;
    effective_from: string | null; changed_at: string; parties: { code: string } | null }[]>(
    await sb().from('item_rate_history').select('id, rate_type, source, action, old_rate, new_rate, effective_from, changed_at, parties(code)')
      .eq('item_id', itemId).order('changed_at', { ascending: false }).limit(100)), [itemId]);
  const [n, setN] = useState({ type: can('items.view_sale_rate') ? 'SALE' : 'PURCHASE', party: '', rate: '', from: new Date().toISOString().slice(0, 10) });
  const parties = n.type === 'SALE' ? customers.data : vendors.data;
  return (
    <div className="space-y-4">
      <Card title="Customer / vendor specific rates">
        <Table><thead><tr><th>Type</th><th>Customer / vendor</th><th className="num">Rate</th><th>From</th><th /></tr></thead>
          <tbody>{(rates.data ?? []).map((r) => (
            <tr key={r.id}><td><Badge color={r.rate_type === 'SALE' ? 'blue' : 'amber'}>{r.rate_type === 'SALE' ? 'Customer' : 'Vendor'}</Badge></td>
              <td>{r.parties ? `${r.parties.code} — ${r.parties.name}` : 'All (price list)'}</td><td className="num font-semibold">{money(r.rate)}</td>
              <td>{date(r.effective_from)} {!r.is_active && <Badge color="slate">Inactive</Badge>}</td>
              <td className="whitespace-nowrap">{canEdit && can('rates.edit') && <Button variant="ghost" onClick={() => run(async () => {
                must(await sb().from('party_item_rates').update({ is_active: !r.is_active }).eq('id', r.id)); rates.reload(); },
                r.is_active ? 'Rate deactivated — not used for new documents' : 'Rate activated')}>{r.is_active ? 'Deactivate' : 'Activate'}</Button>}
                {canEdit && can('rates.delete') && <Button variant="ghost" onClick={() => run(async () => {
                must(await sb().from('party_item_rates').delete().eq('id', r.id)); rates.reload(); hist.reload(); }, 'Rate removed')}>Remove</Button>}</td></tr>))}
            {rates.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No specific rates you are allowed to see</td></tr>}</tbody></Table>
        {canEdit && can('rates.create') && (
          <div className="mt-3 grid items-end gap-2 md:grid-cols-[1fr_2fr_1fr_1fr_auto]">
            <Field label="Rate type"><Select value={n.type} onChange={(e) => setN({ ...n, type: e.target.value, party: '' })}
              options={[...(can('items.view_sale_rate') ? [{ value: 'SALE', label: 'Customer (sales)' }] : []),
                        ...(can('items.view_purchase_rate') ? [{ value: 'PURCHASE', label: 'Vendor (purchase)' }] : [])]} /></Field>
            <Field label={n.type === 'SALE' ? 'Customer' : 'Vendor'}><Select value={n.party} onChange={(e) => setN({ ...n, party: e.target.value })} placeholder="Choose"
              options={(parties ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} /></Field>
            <Field label="Rate"><Input type="number" step="0.01" value={n.rate} onChange={(e) => setN({ ...n, rate: e.target.value })} /></Field>
            <Field label="Effective from"><Input type="date" value={n.from} onChange={(e) => setN({ ...n, from: e.target.value })} /></Field>
            <Button busy={busy} onClick={() => run(async () => {
              if (!n.party || n.rate === '' || !(Number(n.rate) >= 0)) throw new Error('Choose the party and a rate');
              const r = await rpc<{ status: string }>('party_rate_save', { p_company_id: companyId, p_payload: { rate_type: n.type, party_id: n.party,
                item_id: itemId, rate: Number(n.rate), effective_from: n.from } });
              if (r.status === 'PENDING_APPROVAL') toast.ok('Rate sent for approval');
              setN({ ...n, party: '', rate: '' }); rates.reload(); hist.reload(); }, 'Rate saved')}>Add rate</Button>
          </div>)}
      </Card>
      <Card title="Rate history">
        <Table><thead><tr><th>When</th><th>Type</th><th>Source</th><th>Party</th><th className="num">Old</th><th className="num">New</th><th>From</th></tr></thead>
          <tbody>{(hist.data ?? []).map((h) => (
            <tr key={h.id}><td className="whitespace-nowrap">{dateTime(h.changed_at)}</td><td>{h.rate_type}</td>
              <td>{h.source === 'ITEM_MASTER' ? 'Item master' : 'Rate list'} · {h.action.toLowerCase()}</td><td>{h.parties?.code ?? '—'}</td>
              <td className="num">{money(h.old_rate)}</td><td className="num">{money(h.new_rate)}</td><td>{date(h.effective_from)}</td></tr>))}
            {hist.data?.length === 0 && <tr><td colSpan={7} className="text-slate-500">No history you are allowed to see</td></tr>}</tbody></Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- stock (read)
function ItemStock({ itemId }: { itemId: string }) {
  const stock = useData(async () => must<{ godown_id: string; base_qty: number; godowns: { code: string; name: string } | null;
    storage_locations: { code: string } | null }[]>(await sb().from('stock_balances')
    .select('godown_id, base_qty, godowns(code, name), storage_locations(code)').eq('item_id', itemId).neq('base_qty', 0)), [itemId]);
  const cost = useData(async () => must<{ avg_cost: number | null }>(await sb().from('v_items').select('avg_cost').eq('id', itemId).single()), [itemId]);
  const moves = useData(async () => must<{ movement_id: string; movement_date: string; movement_type: string; direction: number; base_qty: number;
    rate: number | null; value: number | null }[]>(await sb().from('v_stock_movement_costs')
    .select('movement_id, movement_date, movement_type, direction, base_qty, rate, value').eq('item_id', itemId)
    .order('movement_date', { ascending: false }).limit(20)), [itemId]);
  if (!stock.data) return stock.error ? <ErrorBox error={stock.error} /> : <Spinner />;
  const total = stock.data.reduce((a, r) => a + Number(r.base_qty), 0);
  return (
    <div className="space-y-4">
      <Card title={`Stock by godown / location — total ${num(total)}`} actions={cost.data?.avg_cost != null && <span className="text-sm">Average cost {money(cost.data.avg_cost)}</span>}>
        <Table><thead><tr><th>Godown</th><th>Location</th><th className="num">Quantity (base unit)</th></tr></thead>
          <tbody>{stock.data.map((r, i) => (
            <tr key={i}><td>{r.godowns?.code} — {r.godowns?.name}</td><td>{r.storage_locations?.code ?? '—'}</td><td className="num">{num(r.base_qty)}</td></tr>))}
            {stock.data.length === 0 && <tr><td colSpan={3} className="text-slate-500">No stock in the godowns you can see</td></tr>}</tbody></Table>
      </Card>
      <Card title="Last movements">
        <Table><thead><tr><th>Date</th><th>Type</th><th className="num">Quantity</th><th className="num">Rate</th><th className="num">Value</th></tr></thead>
          <tbody>{(moves.data ?? []).map((m) => (
            <tr key={m.movement_id}><td>{date(m.movement_date)}</td><td>{m.movement_type.replace(/_/g, ' ')}</td>
              <td className="num">{m.direction > 0 ? '+' : '−'}{num(m.base_qty)}</td>
              <td className="num">{m.rate == null ? '—' : money(m.rate)}</td><td className="num">{m.value == null ? '—' : money(m.value)}</td></tr>))}</tbody></Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- images
interface Img { id: string; storage_path: string; file_name: string; is_primary: boolean; size_bytes: number; created_at: string }
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function ItemImages({ itemId }: { itemId: string }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const imgs = useData(async () => {
    const rows = must<Img[]>(await sb().from('item_images').select('id, storage_path, file_name, is_primary, size_bytes, created_at')
      .eq('item_id', itemId).order('is_primary', { ascending: false }).order('sort_order').order('created_at'));
    // private bucket: short-lived signed URLs, issued only if the storage policy allows reading
    const urls = rows.length ? must<{ path: string | null; signedUrl: string }[]>(await sb().storage.from('item-images')
      .createSignedUrls(rows.map((r) => r.storage_path), 300)) : [];
    return rows.map((r) => ({ ...r, url: urls.find((u) => u.path === r.storage_path)?.signedUrl ?? null }));
  }, [itemId]);
  const [preview, setPreview] = useState<string | null>(null);
  const cfg = useData(async () => must<{ image_max_px: number; image_quality: number } | null>(await sb().from('company_settings')
    .select('image_max_px, image_quality').eq('company_id', companyId).maybeSingle()), [companyId]);
  const upload = (original: File, replace?: Img) => run(async () => {
    if (!IMAGE_TYPES.includes(original.type)) throw new Error('Only JPEG, PNG, WebP or GIF images');
    // resized and re-encoded in the browser first (Settings → Inventory)
    const file = await compressImage(original, cfg.data?.image_max_px ?? 1600, cfg.data?.image_quality ?? 82);
    if (file.size > 5 * 1024 * 1024) throw new Error('An image may have at most 5 MB (after compression)');
    const ext = (file.name.split('.').pop() ?? 'img').toLowerCase().replace(/[^a-z0-9]/g, '') || 'img';
    const path = `${companyId}/${itemId}/${crypto.randomUUID()}.${ext}`;
    must(await sb().storage.from('item-images').upload(path, file, { contentType: file.type }));
    try {
      await rpc('item_image_register', { p_item_id: itemId, p_payload: { storage_path: path, file_name: file.name,
        content_type: file.type, size_bytes: file.size, is_primary: replace?.is_primary ?? false } });
    } catch (e) {
      await sb().storage.from('item-images').remove([path]);
      throw e;
    }
    if (replace) {
      const old = await rpc<string>('item_image_delete', { p_image_id: replace.id });
      await sb().storage.from('item-images').remove([old]);
    }
    imgs.reload();
  }, replace ? 'Image replaced' : 'Image uploaded');
  const pick = (replace?: Img) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = IMAGE_TYPES.join(',');
    input.onchange = () => { const f = input.files?.[0]; if (f) upload(f, replace); };
    input.click();
  };
  const canUpload = can('items.upload_image');
  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="flex items-center gap-3">
          <Button busy={busy} onClick={() => pick()}>Upload image</Button>
          <label className="text-sm text-slate-500">or drop a file:
            <input type="file" aria-label="Image file" accept={IMAGE_TYPES.join(',')} className="ml-2 text-sm"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
        </div>)}
      <p className="text-xs text-slate-500">Images are stored privately; links are valid for 5 minutes and only for users who may see this item.</p>
      {!imgs.data ? (imgs.error ? <ErrorBox error={imgs.error} /> : <Spinner />) : imgs.data.length === 0 ? <p className="text-slate-500">No images</p> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {imgs.data.map((m) => (
            <figure key={m.id} className="rounded-lg border border-slate-200 bg-white p-2">
              {m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.file_name} className="h-32 w-full cursor-zoom-in rounded object-contain" onClick={() => setPreview(m.url)} />
              ) : <div className="flex h-32 items-center justify-center text-xs text-slate-400">no access</div>}
              <figcaption className="mt-1 truncate text-xs text-slate-600" title={m.file_name}>{m.file_name}{m.is_primary && <Badge color="green">Primary</Badge>}</figcaption>
              {canUpload && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {!m.is_primary && <Button variant="ghost" onClick={() => run(async () => { await rpc('item_image_set_primary', { p_image_id: m.id }); imgs.reload(); }, 'Primary image set')}>Primary</Button>}
                  <Button variant="ghost" onClick={() => pick(m)}>Replace</Button>
                  <Button variant="ghost" onClick={() => { if (window.confirm(`Delete ${m.file_name}?`)) run(async () => {
                    const path = await rpc<string>('item_image_delete', { p_image_id: m.id });
                    await sb().storage.from('item-images').remove([path]); imgs.reload(); }, 'Image deleted'); }}>Delete</Button>
                </div>)}
            </figure>))}
        </div>)}
      <Modal open={!!preview} wide title="Image" onClose={() => setPreview(null)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="" className="mx-auto max-h-[70vh]" />}
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Suspense><ItemsPage /></Suspense>;
}
