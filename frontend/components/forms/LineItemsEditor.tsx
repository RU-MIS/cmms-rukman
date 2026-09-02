'use client';

import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export interface LineItem {
  productId: string;
  qty: string;
  rate: string;
  discount: string;
  taxRate: string;
}

export const emptyLineItem: LineItem = { productId: '', qty: '1', rate: '0', discount: '0', taxRate: '0' };

interface Product {
  id: number;
  name: string;
  sku: string;
  saleRate: string;
  purchaseRate: string;
  taxRate: string;
  unit: { shortName: string };
}

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  products: Product[];
  rateField: 'saleRate' | 'purchaseRate';
}

export function LineItemsEditor({ items, onChange, products, rateField }: Props) {
  function updateItem(index: number, patch: Partial<LineItem>) {
    const next = items.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    updateItem(index, {
      productId,
      rate: product ? String(product[rateField]) : '0',
      taxRate: product ? String(product.taxRate) : '0',
    });
  }

  function addRow() {
    onChange([...items, { ...emptyLineItem }]);
  }
  function removeRow(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function lineTotal(item: LineItem) {
    const base = Number(item.qty || 0) * Number(item.rate || 0) - Number(item.discount || 0);
    const tax = (base * Number(item.taxRate || 0)) / 100;
    return base + tax;
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className="th">Product</th>
              <th className="th text-right w-24">Qty</th>
              <th className="th text-right w-28">Rate</th>
              <th className="th text-right w-24">Discount</th>
              <th className="th text-right w-20">Tax %</th>
              <th className="th text-right w-28">Total</th>
              <th className="th w-10"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td className="td">
                  <select className="input" value={item.productId} onChange={(e) => selectProduct(i, e.target.value)}>
                    <option value="">Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                </td>
                <td className="td text-right"><input type="number" step="0.001" className="input text-right" value={item.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} /></td>
                <td className="td text-right"><input type="number" step="0.01" className="input text-right" value={item.rate} onChange={(e) => updateItem(i, { rate: e.target.value })} /></td>
                <td className="td text-right"><input type="number" step="0.01" className="input text-right" value={item.discount} onChange={(e) => updateItem(i, { discount: e.target.value })} /></td>
                <td className="td text-right"><input type="number" step="0.01" className="input text-right" value={item.taxRate} onChange={(e) => updateItem(i, { taxRate: e.target.value })} /></td>
                <td className="td text-right font-medium">{formatCurrency(lineTotal(item))}</td>
                <td className="td text-right">
                  <button type="button" className="btn-ghost !px-2 !py-1 text-danger" onClick={() => removeRow(i)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={addRow} className="btn-ghost m-2 !text-brand-600">
        <Plus size={14} /> Add Item
      </button>
    </div>
  );
}
