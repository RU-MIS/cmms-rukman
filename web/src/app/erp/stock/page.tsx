'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns, useItems, useLocations, usePackings, useUnitsAll } from '@/lib/masters';
import { date, today } from '@/lib/format';
import { LineEditor, emptyLine, payloadLines, type Line } from '@/components/LineEditor';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table, Tabs, useAction } from '@/components/ui';

const reasons: Record<string, { label: string; direction?: 1 | -1 }> = {
  STOCK_IN: { label: 'Stock IN', direction: 1 },
  STOCK_OUT: { label: 'Stock OUT', direction: -1 },
  OPENING: { label: 'Opening stock', direction: 1 },
  PHYSICAL_COUNT: { label: 'Physical count correction' },
  DAMAGE: { label: 'Damage / write-off', direction: -1 },
  CORRECTION: { label: 'Correction' },
};

export default function StockPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [tab, setTab] = useState('in');
  const items = useItems(companyId); const godowns = useGodowns(companyId); const locations = useLocations(companyId);
  const units = useUnitsAll(); const packings = usePackings(companyId);
  const [docDate, setDocDate] = useState(today());
  const [godown, setGodown] = useState('');
  const [toGodown, setToGodown] = useState('');
  const [reason, setReason] = useState('CORRECTION');
  const [direction, setDirection] = useState<'1' | '-1'>('1');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const recent = useData(async () => {
    const [adj, trf] = await Promise.all([
      sb().from('stock_adjustments').select('id, doc_no, doc_date, reason, status, godowns(name)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(15),
      sb().from('stock_transfers').select('id, doc_no, doc_date, status, from:godowns!stock_transfers_from_godown_id_fkey(name), to:godowns!stock_transfers_to_godown_id_fkey(name)')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(15),
    ]);
    return { adj: must<Record<string, unknown>[]>(adj), trf: must<Record<string, unknown>[]>(trf) };
  }, [companyId]);

  const gOpts = (godowns.data ?? []).filter((g) => g.is_active).map((g) => ({ value: g.id, label: g.name }));
  const reset = () => { setLines([emptyLine()]); setRemarks(''); };

  const post = () => run(async () => {
    if (!godown) throw new Error('Choose the godown');
    let res: { doc_no: string; warnings: string[] };
    if (tab === 'transfer') {
      if (!toGodown) throw new Error('Choose the destination godown');
      const id = await rpc<string>('doc_save', { p_doc_type: 'STOCK_TRANSFER', p_payload: { company_id: companyId, doc_date: docDate,
        from_godown_id: godown, to_godown_id: toGodown, remarks, lines: payloadLines(lines, { location: 'from_to' }) } });
      res = await rpc('doc_submit', { p_doc_type: 'STOCK_TRANSFER', p_id: id });
    } else {
      const r = tab === 'in' ? 'STOCK_IN' : tab === 'out' ? 'STOCK_OUT' : reason;
      const dir = reasons[r].direction ?? Number(direction);
      const id = await rpc<string>('doc_save', { p_doc_type: 'STOCK_ADJUSTMENT', p_payload: { company_id: companyId, doc_date: docDate,
        godown_id: godown, reason: r, remarks,
        lines: payloadLines(lines, { location: 'location_id' }).map((l) => ({ ...l, direction: dir })) } });
      res = await rpc('doc_submit', { p_doc_type: 'STOCK_ADJUSTMENT', p_id: id });
    }
    reset(); recent.reload();
    if (res.warnings?.length) alert(res.warnings.join('\n'));
    return res;
  }, 'Stock posted');

  return (
    <div>
      <PageHeader title="Stock in / out / transfer" subtitle="Every change creates stock movements — balances are never typed in" />
      <Tabs active={tab} onChange={(t) => { setTab(t); reset(); }} tabs={[
        { id: 'in', label: 'Stock IN' }, { id: 'out', label: 'Stock OUT' }, { id: 'adjust', label: 'Adjustment' }, { id: 'transfer', label: 'Transfer' }]} />
      <Card>
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Date"><Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></Field>
          <Field label={tab === 'transfer' ? 'From godown' : 'Godown'}><Select value={godown} onChange={(e) => setGodown(e.target.value)} placeholder="Choose" options={gOpts} /></Field>
          {tab === 'transfer' && <Field label="To godown"><Select value={toGodown} onChange={(e) => setToGodown(e.target.value)} placeholder="Choose" options={gOpts} /></Field>}
          {tab === 'adjust' && <>
            <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}
              options={['OPENING', 'PHYSICAL_COUNT', 'DAMAGE', 'CORRECTION'].map((r) => ({ value: r, label: reasons[r].label }))} /></Field>
            {!reasons[reason].direction && <Field label="Direction"><Select value={direction} onChange={(e) => setDirection(e.target.value as '1' | '-1')}
              options={[{ value: '1', label: 'Increase (+)' }, { value: '-1', label: 'Decrease (−)' }]} /></Field>}
          </>}
          <Field label="Remarks" className={tab === 'adjust' ? 'md:col-span-4' : ''}><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} items={items.data} units={units.data} packings={packings.data}
          locations={locations.data} godownId={godown} toGodownId={tab === 'transfer' ? toGodown : undefined} />
        <div className="mt-3 flex justify-end">
          <Button busy={busy} disabled={!(tab === 'transfer' ? can('stock_transfer.create') : can('stock_adjustment.create'))} onClick={post}>
            Post {tab === 'transfer' ? 'transfer' : tab === 'in' ? 'stock IN' : tab === 'out' ? 'stock OUT' : 'adjustment'}</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Stock OUT without a rack/bin is taken automatically from the locations that hold the item. With negative stock OFF a posting that would go below available stock (physical − reserved) is rejected.</p>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent adjustments">
          <Table><thead><tr><th>No</th><th>Date</th><th>Reason</th><th>Godown</th><th>Status</th></tr></thead>
            <tbody>{(recent.data?.adj ?? []).map((a) => (
              <tr key={String(a.id)}><td>{String(a.doc_no ?? '—')}</td><td>{date(a.doc_date)}</td><td>{String(a.reason).replace('_', ' ')}</td>
                <td>{(a.godowns as { name: string } | null)?.name}</td><td><Badge>{String(a.status)}</Badge></td></tr>))}</tbody></Table>
        </Card>
        <Card title="Recent transfers">
          <Table><thead><tr><th>No</th><th>Date</th><th>From → To</th><th>Status</th></tr></thead>
            <tbody>{(recent.data?.trf ?? []).map((a) => (
              <tr key={String(a.id)}><td>{String(a.doc_no ?? '—')}</td><td>{date(a.doc_date)}</td>
                <td>{(a.from as { name: string } | null)?.name} → {(a.to as { name: string } | null)?.name}</td><td><Badge>{String(a.status)}</Badge></td></tr>))}</tbody></Table>
        </Card>
      </div>
    </div>
  );
}
