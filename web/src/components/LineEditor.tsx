'use client';
import { itemUnits, type Item, type Location, type Unit } from '@/lib/masters';
import { Button, Input, Select } from './ui';

export interface Line { item_id: string; qty: string; unit_id: string; rate?: string; location_id?: string; to_location_id?: string }
export const emptyLine = (): Line => ({ item_id: '', qty: '', unit_id: '', rate: '', location_id: '', to_location_id: '' });

interface Props {
  lines: Line[];
  onChange: (lines: Line[]) => void;
  items: Item[] | null;
  units: Unit[] | null;
  packings: { item_id: string; unit_id: string; factor_to_base: number }[] | null;
  locations?: Location[] | null;
  godownId?: string;            // locations of this godown (from location)
  toGodownId?: string;          // transfer: destination locations
  rate?: boolean;
  rateLabel?: string;
  unitKind?: 'sales' | 'purchase';
}

export function LineEditor(p: Props) {
  const set = (i: number, patch: Partial<Line>) => p.onChange(p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const locs = (g?: string) => (p.locations ?? []).filter((l) => l.godown_id === g && l.is_active)
    .map((l) => ({ value: l.id, label: l.is_default ? 'Unassigned (no rack)' : l.code }));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="erp-table min-w-[640px]">
          <thead><tr><th className="w-[34%]">Item</th><th>Qty</th><th>Unit</th>
            {p.rate && <th>{p.rateLabel ?? 'Rate / base unit'}</th>}
            {p.godownId !== undefined && <th>{p.toGodownId !== undefined ? 'From location' : 'Rack / bin'}</th>}
            {p.toGodownId !== undefined && <th>To location</th>}<th /></tr></thead>
          <tbody>
            {p.lines.map((l, i) => {
              const item = p.items?.find((x) => x.id === l.item_id);
              return (
                <tr key={i}>
                  <td><Select aria-label={`Item ${i + 1}`} value={l.item_id} placeholder="Choose item"
                    options={(p.items ?? []).filter((x) => x.is_active).map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }))}
                    onChange={(e) => {
                      const it = p.items?.find((x) => x.id === e.target.value);
                      const unit = (p.unitKind === 'purchase' ? it?.purchase_unit_id : it?.sales_unit_id) ?? it?.base_unit_id ?? '';
                      set(i, { item_id: e.target.value, unit_id: unit });
                    }} /></td>
                  <td><Input aria-label={`Qty ${i + 1}`} type="number" min="0" step="any" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                  <td><Select aria-label={`Unit ${i + 1}`} value={l.unit_id} options={itemUnits(item, p.units, p.packings)} onChange={(e) => set(i, { unit_id: e.target.value })} /></td>
                  {p.rate && <td><Input aria-label={`Rate ${i + 1}`} type="number" min="0" step="any" value={l.rate ?? ''} onChange={(e) => set(i, { rate: e.target.value })} /></td>}
                  {p.godownId !== undefined && <td><Select aria-label={`Location ${i + 1}`} value={l.location_id ?? ''} placeholder="Auto / unassigned"
                    options={locs(p.godownId)} onChange={(e) => set(i, { location_id: e.target.value })} /></td>}
                  {p.toGodownId !== undefined && <td><Select aria-label={`To location ${i + 1}`} value={l.to_location_id ?? ''} placeholder="Unassigned"
                    options={locs(p.toGodownId)} onChange={(e) => set(i, { to_location_id: e.target.value })} /></td>}
                  <td><button aria-label="Remove line" className="px-2 text-slate-400 hover:text-red-600"
                    onClick={() => p.onChange(p.lines.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" onClick={() => p.onChange([...p.lines, emptyLine()])}>+ Add line</Button>
    </div>
  );
}

/** Validates and converts editor lines to RPC payload lines. */
export function payloadLines(lines: Line[], opts: { rate?: boolean; location?: 'location_id' | 'from_to' } = {}) {
  const rows = lines.filter((l) => l.item_id);
  if (rows.length === 0) throw new Error('Add at least one item');
  return rows.map((l) => {
    const qty = Number(l.qty);
    if (!(qty > 0)) throw new Error('Every line needs a quantity greater than zero');
    const row: Record<string, unknown> = { item_id: l.item_id, qty, unit_id: l.unit_id };
    if (opts.rate) row.rate = l.rate === '' || l.rate === undefined ? null : Number(l.rate);
    if (opts.location === 'location_id') row.location_id = l.location_id || null;
    if (opts.location === 'from_to') { row.from_location_id = l.location_id || null; row.to_location_id = l.to_location_id || null; }
    return row;
  });
}
