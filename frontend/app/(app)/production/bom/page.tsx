'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Save } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';

interface Row { componentId: string; qtyPerUnit: string }

export default function BomPage() {
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data });
  const { data: bom } = useQuery({
    queryKey: ['bom', productId],
    queryFn: async () => (await api.get(`/production/bom/${productId}`)).data.data,
    enabled: !!productId,
  });

  useEffect(() => {
    if (bom) setRows(bom.map((b: any) => ({ componentId: String(b.componentId), qtyPerUnit: String(b.qtyPerUnit) })));
    else setRows([]);
  }, [bom]);

  const componentOptions = (products ?? []).filter((p: any) => String(p.id) !== productId);

  async function handleSave() {
    const items = rows.filter((r) => r.componentId && Number(r.qtyPerUnit) > 0).map((r) => ({ componentId: Number(r.componentId), qtyPerUnit: Number(r.qtyPerUnit) }));
    setSaving(true);
    try {
      await api.put(`/production/bom/${productId}`, { items });
      toast.success('Bill of Materials saved');
      qc.invalidateQueries({ queryKey: ['bom', productId] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Bill of Materials (BOM)" description="Define the raw materials required to manufacture one unit of a finished product" />

      <div className="card p-4 mb-4 max-w-sm">
        <label className="label">Finished Product</label>
        <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Select finished product…</option>
          {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {productId && (
        <div className="card overflow-hidden">
          <table className="w-full min-w-[500px] border-collapse">
            <thead><tr><th className="th">Raw Material</th><th className="th text-right w-32">Qty per Unit</th><th className="th w-10"></th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="td">
                    <select className="input" value={row.componentId} onChange={(e) => setRows(rows.map((r, idx) => idx === i ? { ...r, componentId: e.target.value } : r))}>
                      <option value="">Select component</option>
                      {componentOptions.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td className="td text-right">
                    <input type="number" step="0.0001" className="input text-right" value={row.qtyPerUnit} onChange={(e) => setRows(rows.map((r, idx) => idx === i ? { ...r, qtyPerUnit: e.target.value } : r))} />
                  </td>
                  <td className="td text-right"><button className="btn-ghost !px-2 !py-1 text-danger" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between p-2">
            <button className="btn-ghost !text-brand-600" onClick={() => setRows([...rows, { componentId: '', qtyPerUnit: '1' }])}><Plus size={14} /> Add Component</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}><Save size={14} /> Save BOM</button>
          </div>
        </div>
      )}
    </div>
  );
}
