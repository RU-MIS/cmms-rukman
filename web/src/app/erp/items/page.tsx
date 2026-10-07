'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { must, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useUnitsAll } from '@/lib/masters';
import { money, num } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, TextArea, Toggle, useAction } from '@/components/ui';

interface ItemRow { id: string; code: string; name: string; description: string | null; item_kind: string; category_id: string | null;
  brand_id: string | null; base_unit_id: string; purchase_unit_id: string | null; sales_unit_id: string | null; barcode: string | null;
  purchase_price: number | null; sale_price: number | null; min_stock: number; max_stock: number; reorder_level: number;
  hsn_code: string | null; gst_rate: number; is_active: boolean; portal_visible: boolean }
interface Packing { id: string; item_id: string; unit_id: string; factor_to_base: number; is_default: boolean }

const blank = (): Partial<ItemRow> => ({ item_kind: 'FINISHED_GOOD', is_active: true, portal_visible: true, min_stock: 0, max_stock: 0, reorder_level: 0, gst_rate: 0 });
const kinds = ['FINISHED_GOOD', 'RAW_MATERIAL', 'PACKING', 'SERVICE'].map((k) => ({ value: k, label: k.replace('_', ' ') }));

function ItemsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const editParam = useSearchParams().get('edit');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Partial<ItemRow> | null>(null);
  const [newCat, setNewCat] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const { busy, run } = useAction();
  const units = useUnitsAll();
  const items = useData(async () => must<ItemRow[]>(await sb().from('items').select('*').eq('company_id', companyId)
    .eq('is_deleted', false).order('name')), [companyId]);
  const cats = useData(async () => must<{ id: string; name: string }[]>(await sb().from('item_categories').select('id, name').eq('company_id', companyId).order('name')), [companyId]);
  const brands = useData(async () => must<{ id: string; name: string }[]>(await sb().from('brands').select('id, name').eq('company_id', companyId).order('name')), [companyId]);
  const packings = useData(async () => edit?.id ? must<Packing[]>(await sb().from('item_packings').select('*').eq('item_id', edit.id)) : [], [edit?.id]);
  const [pack, setPack] = useState({ unit_id: '', factor: '' });

  useEffect(() => {
    if (editParam && items.data && !edit) {
      const it = items.data.find((i) => i.id === editParam);
      if (it) queueMicrotask(() => setEdit(it));
    }
  }, [editParam, items.data, edit]);

  const unitOpts = (units.data ?? []).filter((u) => !u.company_id || u.company_id === companyId).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));
  const set = (k: keyof ItemRow, v: unknown) => setEdit((e) => ({ ...e, [k]: v }));
  const nOrNull = (v: string) => (v === '' ? null : Number(v));
  const itemUnits = edit ? unitOpts.filter((u) => u.value === edit.base_unit_id || (packings.data ?? []).some((p) => p.unit_id === u.value)) : [];

  const save = () => run(async () => {
    if (!edit) return;
    let category_id = edit.category_id ?? null;
    if (newCat.trim()) category_id = must<{ id: string }>(await sb().from('item_categories').insert({ company_id: companyId, name: newCat.trim() }).select('id').single()).id;
    let brand_id = edit.brand_id ?? null;
    if (newBrand.trim()) brand_id = must<{ id: string }>(await sb().from('brands').insert({ company_id: companyId, name: newBrand.trim() }).select('id').single()).id;
    const row = {
      code: edit.code?.trim(), name: edit.name?.trim(), description: edit.description || null, item_kind: edit.item_kind,
      category_id, brand_id, base_unit_id: edit.base_unit_id, purchase_unit_id: edit.purchase_unit_id || null,
      sales_unit_id: edit.sales_unit_id || null, barcode: edit.barcode?.trim() || null, purchase_price: edit.purchase_price ?? null,
      sale_price: edit.sale_price ?? null, min_stock: edit.min_stock ?? 0, max_stock: edit.max_stock ?? 0, reorder_level: edit.reorder_level ?? 0,
      hsn_code: edit.hsn_code || null, gst_rate: edit.gst_rate ?? 0, is_active: edit.is_active ?? true, portal_visible: edit.portal_visible ?? true,
    };
    if (!row.code || !row.name || !row.base_unit_id) throw new Error('Code, name and base unit are required');
    if (edit.id) must(await sb().from('items').update(row).eq('id', edit.id));
    else {
      const created = must<ItemRow>(await sb().from('items').insert({ ...row, company_id: companyId }).select('*').single());
      setEdit(created);
    }
    setNewCat(''); setNewBrand('');
    items.reload(); cats.reload(); brands.reload();
  }, 'Item saved');

  const addPacking = () => run(async () => {
    if (!edit?.id) throw new Error('Save the item first');
    if (!pack.unit_id || !(Number(pack.factor) > 0)) throw new Error('Choose a unit and a conversion factor > 0');
    must(await sb().from('item_packings').insert({ item_id: edit.id, unit_id: pack.unit_id, factor_to_base: Number(pack.factor),
      is_default: (packings.data ?? []).length === 0 }));
    setPack({ unit_id: '', factor: '' });
    packings.reload();
  }, 'Packing added');

  const rows = (items.data ?? []).filter((i) => !search || `${i.code} ${i.name} ${i.barcode ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const unitCode = (id: string | null) => units.data?.find((u) => u.id === id)?.code ?? '';

  return (
    <div>
      <PageHeader title="Items & packing" subtitle="Item master with item-specific packing conversion"
        actions={can('items.create') && <Button onClick={() => setEdit(blank())}>New item</Button>} />
      <div className="mb-3 max-w-sm"><Input placeholder="Search code, name or barcode" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <ErrorBox error={items.error} />
      {items.loading && !items.data ? <Spinner /> : (
        <Table>
          <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Base unit</th><th className="num">Purchase</th><th className="num">Sale</th>
            <th className="num">Reorder</th><th>Portal</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((i) => (
            <tr key={i.id}>
              <td className="font-mono">{i.code}</td>
              <td><Link className="text-brand hover:underline" href={`/erp/item/?id=${i.id}`}>{i.name}</Link></td>
              <td>{i.item_kind.replace('_', ' ')}</td><td>{unitCode(i.base_unit_id)}</td>
              <td className="num">{money(i.purchase_price)}</td><td className="num">{money(i.sale_price)}</td>
              <td className="num">{num(i.reorder_level)}</td><td>{i.portal_visible ? 'Visible' : 'Hidden'}</td>
              <td><Badge color={i.is_active ? 'green' : 'slate'}>{i.is_active ? 'Active' : 'Inactive'}</Badge></td>
              <td>{can('items.edit') && <Button variant="ghost" onClick={() => setEdit(i)}>Edit</Button>}</td>
            </tr>))}</tbody>
        </Table>
      )}
      <Modal open={!!edit} wide title={edit?.id ? `Edit ${edit.name}` : 'New item'} onClose={() => setEdit(null)}>
        {edit && (
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
              <Field label="Purchase price (per base unit)"><Input type="number" step="0.01" value={edit.purchase_price ?? ''} onChange={(e) => set('purchase_price', nOrNull(e.target.value))} /></Field>
              <Field label="Sale price (per base unit)"><Input type="number" step="0.01" value={edit.sale_price ?? ''} onChange={(e) => set('sale_price', nOrNull(e.target.value))} /></Field>
              <Field label="Minimum stock"><Input type="number" value={edit.min_stock ?? 0} onChange={(e) => set('min_stock', Number(e.target.value))} /></Field>
              <Field label="Maximum stock"><Input type="number" value={edit.max_stock ?? 0} onChange={(e) => set('max_stock', Number(e.target.value))} /></Field>
              <Field label="Reorder level"><Input type="number" value={edit.reorder_level ?? 0} onChange={(e) => set('reorder_level', Number(e.target.value))} /></Field>
              <Field label="HSN code"><Input value={edit.hsn_code ?? ''} onChange={(e) => set('hsn_code', e.target.value)} /></Field>
              <Field label="GST %"><Input type="number" value={edit.gst_rate ?? 0} onChange={(e) => set('gst_rate', Number(e.target.value))} /></Field>
            </div>
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
                      <tr key={p.id}><td>1 {unitCode(p.unit_id)}</td><td className="num">{num(p.factor_to_base)} {unitCode(edit.base_unit_id ?? null)}</td>
                        <td>{p.is_default ? 'Yes' : ''}</td></tr>))}
                      {packings.data?.length === 0 && <tr><td colSpan={3} className="text-slate-500">No packing — stock is entered in the base unit only.</td></tr>}</tbody></Table>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Unit"><Select value={pack.unit_id} onChange={(e) => setPack({ ...pack, unit_id: e.target.value })} placeholder="Choose"
                      options={unitOpts.filter((u) => u.value !== edit.base_unit_id)} /></Field>
                    <Field label={`Contains (${unitCode(edit.base_unit_id ?? null)})`}><Input type="number" value={pack.factor} onChange={(e) => setPack({ ...pack, factor: e.target.value })} /></Field>
                    <Button variant="secondary" busy={busy} onClick={addPacking}>Add packing</Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Suspense><ItemsPage /></Suspense>;
}
