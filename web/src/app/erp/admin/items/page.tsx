'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useParties, useUnitsAll } from '@/lib/masters';
import { date, dateTime, money, num } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, TextArea, Toggle, useAction } from '@/components/ui';
import { CustomFieldsEditor, useCustomFields } from '@/components/admin/CustomFields';
import { exportEntity } from '@/lib/spreadsheet';

interface ItemRow { id: string; code: string; name: string; description: string | null; item_kind: string; category_id: string | null;
  brand_id: string | null; base_unit_id: string; purchase_unit_id: string | null; sales_unit_id: string | null; barcode: string | null;
  purchase_price: number | null; sale_price: number | null; min_stock: number; max_stock: number; reorder_level: number;
  hsn_code: string | null; gst_rate: number; is_active: boolean; portal_visible: boolean; sku: string | null; notes: string | null;
  custom: Record<string, unknown>; can_view_sale_rate?: boolean; can_view_purchase_rate?: boolean; can_edit_rate?: boolean }
interface Packing { id: string; item_id: string; unit_id: string; factor_to_base: number; is_default: boolean }

const blank = (): Partial<ItemRow> => ({ item_kind: 'FINISHED_GOOD', is_active: true, portal_visible: true, min_stock: 0, max_stock: 0,
  reorder_level: 0, gst_rate: 0, custom: {} });
const kinds = ['FINISHED_GOOD', 'RAW_MATERIAL', 'PACKING', 'SERVICE'].map((k) => ({ value: k, label: k.replace('_', ' ') }));
const ITEM_COLS = 'id, code, name, description, item_kind, category_id, brand_id, base_unit_id, purchase_unit_id, sales_unit_id, barcode, '
  + 'purchase_price, sale_price, min_stock, max_stock, reorder_level, hsn_code, gst_rate, is_active, portal_visible, sku, notes, custom, '
  + 'can_view_sale_rate, can_view_purchase_rate, can_edit_rate';

function ItemsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const editParam = useSearchParams().get('edit');
  const [search, setSearch] = useState('');
  const [kindF, setKindF] = useState('');
  const [catF, setCatF] = useState('');
  const [statusF, setStatusF] = useState('ACTIVE');
  const [edit, setEdit] = useState<Partial<ItemRow> | null>(null);
  const { busy, run } = useAction();
  const units = useUnitsAll();
  // masked view: prices are NULL where the user has no field right
  const items = useData(async () => must<ItemRow[]>(await sb().from('v_items').select(ITEM_COLS).eq('company_id', companyId)
    .eq('is_deleted', false).order('name')), [companyId]);
  const cats = useData(async () => must<{ id: string; name: string }[]>(await sb().from('item_categories').select('id, name').eq('company_id', companyId).order('name')), [companyId]);

  useEffect(() => {
    if (editParam && items.data && !edit) {
      const it = items.data.find((i) => i.id === editParam);
      if (it) queueMicrotask(() => setEdit(it));
    }
  }, [editParam, items.data, edit]);

  const rows = useMemo(() => (items.data ?? []).filter((i) =>
    (!search || `${i.code} ${i.name} ${i.barcode ?? ''} ${i.sku ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    && (!kindF || i.item_kind === kindF) && (!catF || i.category_id === catF)
    && (!statusF || (statusF === 'ACTIVE') === i.is_active)), [items.data, search, kindF, catF, statusF]);
  const unitCode = (id: string | null) => units.data?.find((u) => u.id === id)?.code ?? '';
  const showSale = (items.data ?? []).some((i) => i.can_view_sale_rate);
  const showPurchase = (items.data ?? []).some((i) => i.can_view_purchase_rate);

  return (
    <div>
      <PageHeader title="Items & packing" subtitle="Item / part master: units and packing, rates, images and custom fields"
        actions={<>
          {can('items.create') && <Button onClick={() => setEdit(blank())}>New item</Button>}
          {can('items.import') && <Link href="/erp/admin/import-export/?entity=ITEMS" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50">Import</Link>}
          {can('items.export') && <Button variant="secondary" busy={busy} onClick={() => run(() => exportEntity(companyId, 'ITEMS', 'Items'), 'Export ready')}>Export</Button>}
        </>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input className="max-w-xs" placeholder="Search code, name, barcode, SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Kind filter" className="w-40" value={kindF} onChange={(e) => setKindF(e.target.value)} placeholder="All kinds" options={kinds} />
        <Select aria-label="Category filter" className="w-44" value={catF} onChange={(e) => setCatF(e.target.value)} placeholder="All categories"
          options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select aria-label="Status filter" className="w-32" value={statusF} onChange={(e) => setStatusF(e.target.value)} placeholder="All"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        <span className="text-sm text-slate-500">{rows.length} item(s)</span>
      </div>
      <ErrorBox error={items.error} />
      {items.loading && !items.data ? <Spinner /> : (
        <Table>
          <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Base unit</th>
            {showPurchase && <th className="num">Purchase</th>}{showSale && <th className="num">Sale</th>}
            <th className="num">Reorder</th><th>Portal</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((i) => (
            <tr key={i.id}>
              <td className="font-mono">{i.code}</td>
              <td><Link className="text-brand hover:underline" href={`/erp/item/?id=${i.id}`}>{i.name}</Link>{i.sku && <div className="text-xs text-slate-500">SKU {i.sku}</div>}</td>
              <td>{i.item_kind.replace('_', ' ')}</td><td>{unitCode(i.base_unit_id)}</td>
              {showPurchase && <td className="num">{money(i.purchase_price)}</td>}{showSale && <td className="num">{money(i.sale_price)}</td>}
              <td className="num">{num(i.reorder_level)}</td><td>{i.portal_visible ? 'Visible' : 'Hidden'}</td>
              <td><Badge color={i.is_active ? 'green' : 'slate'}>{i.is_active ? 'Active' : 'Inactive'}</Badge></td>
              <td>{can('items.edit') && <Button variant="ghost" onClick={() => setEdit(i)}>Edit</Button>}</td>
            </tr>))}
            {rows.length === 0 && <tr><td colSpan={10} className="text-slate-500">No items</td></tr>}</tbody>
        </Table>
      )}
      {edit && <ItemEditor key={edit.id ?? 'new'} item={edit} onClose={() => setEdit(null)}
        onSaved={async (id) => { items.reload(); cats.reload();
          const fresh = must<ItemRow>(await sb().from('v_items').select(ITEM_COLS).eq('id', id).single()); setEdit(fresh); }} />}
    </div>
  );
}

function ItemEditor({ item, onClose, onSaved }: { item: Partial<ItemRow>; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
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
    if (canEditRate) { row.purchase_price = edit.purchase_price ?? null; row.sale_price = edit.sale_price ?? null; }
    if (!row.code || !row.name || !row.base_unit_id) throw new Error('Code, name and base unit are required');
    let id = edit.id;
    if (id) must(await sb().from('items').update(row).eq('id', id));
    else id = must<{ id: string }>(await sb().from('items').insert({ ...row, company_id: companyId }).select('id').single()).id;
    setNewCat(''); setNewBrand('');
    await onSaved(id!);
  }, 'Item saved');

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
      <Tabs tabs={[{ id: 'general', label: 'General' }, ...(edit.id ? [{ id: 'rates', label: 'Rates' }, { id: 'images', label: 'Images' }] : [])]}
        active={tab} onChange={setTab} />
      {tab === 'general' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Item code *"><Input value={edit.code ?? ''} onChange={(e) => set('code', e.target.value)} /></Field>
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
            {seePurchase && <Field label="Purchase price (per base unit)"><Input type="number" step="0.01" disabled={!canEditRate} value={edit.purchase_price ?? ''}
              onChange={(e) => set('purchase_price', nOrNull(e.target.value))} /></Field>}
            {seeSale && <Field label="Sale price (per base unit)"><Input type="number" step="0.01" disabled={!canEditRate} value={edit.sale_price ?? ''}
              onChange={(e) => set('sale_price', nOrNull(e.target.value))} /></Field>}
            <Field label="GST %"><Input type="number" value={edit.gst_rate ?? 0} onChange={(e) => set('gst_rate', Number(e.target.value))} /></Field>
            <Field label="Minimum stock"><Input type="number" value={edit.min_stock ?? 0} onChange={(e) => set('min_stock', Number(e.target.value))} /></Field>
            <Field label="Maximum stock"><Input type="number" value={edit.max_stock ?? 0} onChange={(e) => set('max_stock', Number(e.target.value))} /></Field>
            <Field label="Reorder level"><Input type="number" value={edit.reorder_level ?? 0} onChange={(e) => set('reorder_level', Number(e.target.value))} /></Field>
            <Field label="Notes" className="md:col-span-3"><TextArea rows={2} value={edit.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
          </div>
          <CustomFieldsEditor defs={defs.data ?? []} value={edit.custom ?? {}} onChange={(v) => set('custom', v)} />
          <div className="grid gap-x-6 md:grid-cols-2">
            <Toggle label="Active" checked={edit.is_active ?? true} onChange={(v) => set('is_active', v)} />
            <Toggle label="Show in customer portal catalog" checked={edit.portal_visible ?? true} onChange={(v) => set('portal_visible', v)} />
          </div>
          <div className="flex justify-end"><Button busy={busy} onClick={save}>Save item</Button></div>
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
    </Modal>
  );
}

// ---------------------------------------------------------------------------- rates
function ItemRates({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const customers = useParties(companyId, 'CUSTOMER');
  const vendors = useParties(companyId, ['SUPPLIER', 'JOB_WORKER', 'CUTTER']);
  // RLS: SALE rows only with the sales-rate right, PURCHASE rows only with the purchase-rate right
  const rates = useData(async () => must<{ id: string; rate_type: string; rate: number; effective_from: string; parties: { code: string; name: string } | null }[]>(
    await sb().from('party_item_rates').select('id, rate_type, rate, effective_from, parties(code, name)').eq('item_id', itemId)
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
              <td>{date(r.effective_from)}</td>
              <td>{canEdit && can('rates.delete') && <Button variant="ghost" onClick={() => run(async () => {
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
              must(await sb().from('party_item_rates').insert({ company_id: companyId, rate_type: n.type, party_id: n.party, item_id: itemId,
                rate: Number(n.rate), effective_from: n.from }));
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
  const upload = (file: File, replace?: Img) => run(async () => {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Only JPEG, PNG, WebP or GIF images');
    if (file.size > 5 * 1024 * 1024) throw new Error('An image may have at most 5 MB');
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
