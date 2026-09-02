'use client';

import { Plus, Trash2 } from 'lucide-react';

export interface OrderItem { productId: string; qty: string; rate: string }
export const emptyOrderItem: OrderItem = { productId: '', qty: '1', rate: '0' };

interface Product { id: number; name: string; sku: string; saleRate: string; purchaseRate: string; unit: { shortName: string } }

export function OrderItemsEditor({
  items, onChange, products, rateField,
}: { items: OrderItem[]; onChange: (items: OrderItem[]) => void; products: Product[]; rateField: 'saleRate' | 'purchaseRate' }) {
  function update(i: number, patch: Partial<OrderItem>) {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function selectProduct(i: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    update(i, { productId, rate: product ? String(product[rateField]) : '0' });
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full min-w-[520px] border-collapse">
        <thead><tr><th className="th">Product</th><th className="th text-right w-28">Quantity</th><th className="th text-right w-28">Rate</th><th className="th w-10"></th></tr></thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td className="td">
                <select className="input" value={item.productId} onChange={(e) => selectProduct(i, e.target.value)}>
                  <option value="">Select product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
              </td>
              <td className="td text-right"><input type="number" step="0.001" className="input text-right" value={item.qty} onChange={(e) => update(i, { qty: e.target.value })} /></td>
              <td className="td text-right"><input type="number" step="0.01" className="input text-right" value={item.rate} onChange={(e) => update(i, { rate: e.target.value })} /></td>
              <td className="td text-right"><button type="button" className="btn-ghost !px-2 !py-1 text-danger" onClick={() => onChange(items.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...items, { ...emptyOrderItem }])} className="btn-ghost m-2 !text-brand-600"><Plus size={14} /> Add Item</button>
    </div>
  );
}
