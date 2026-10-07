'use client';
import { useState } from 'react';
import { must, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Toggle, useAction } from '@/components/ui';

interface Godown { id: string; code: string; name: string; godown_type: string; is_active: boolean; portal_visible: boolean; allow_negative: boolean }
interface Loc { id: string; godown_id: string; zone: string | null; rack: string | null; shelf: string | null; bin: string | null;
  code: string; is_default: boolean; is_active: boolean; remarks: string | null }

export default function GodownsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const godowns = useData(async () => must<Godown[]>(await sb().from('godowns').select('*').eq('company_id', companyId)
    .eq('is_deleted', false).order('name')), [companyId]);
  const locs = useData(async () => must<Loc[]>(await sb().from('storage_locations').select('*').eq('company_id', companyId)
    .order('code')), [companyId]);
  const [g, setG] = useState<Partial<Godown> | null>(null);
  const [sel, setSel] = useState<string>('');
  const [loc, setLoc] = useState({ zone: '', rack: '', shelf: '', bin: '' });
  const current = godowns.data?.find((x) => x.id === sel) ?? godowns.data?.[0];

  const saveGodown = () => run(async () => {
    if (!g?.code?.trim() || !g?.name?.trim()) throw new Error('Code and name are required');
    const row: Record<string, unknown> = { code: g.code.trim(), name: g.name.trim(), godown_type: g.godown_type ?? 'OWN_STORE',
      is_active: g.is_active ?? true, portal_visible: g.portal_visible ?? true };
    if (can('settings.edit')) row.allow_negative = g.allow_negative ?? false;
    if (g.id) must(await sb().from('godowns').update(row).eq('id', g.id));
    else must(await sb().from('godowns').insert({ ...row, company_id: companyId }));
    setG(null); godowns.reload(); locs.reload();
  }, 'Godown saved');

  const addLoc = () => run(async () => {
    if (!current) return;
    if (!loc.rack.trim()) throw new Error('Rack is required');
    must(await sb().from('storage_locations').insert({ company_id: companyId, godown_id: current.id, zone: loc.zone || null,
      rack: loc.rack, shelf: loc.shelf || null, bin: loc.bin || null }));
    setLoc({ zone: loc.zone, rack: loc.rack, shelf: '', bin: '' });
    locs.reload();
  }, 'Location added');

  const toggleLoc = (l: Loc) => run(async () => {
    must(await sb().from('storage_locations').update({ is_active: !l.is_active }).eq('id', l.id));
    locs.reload();
  }, l.is_active ? 'Location deactivated' : 'Location activated');

  return (
    <div>
      <PageHeader title="Godowns & locations" subtitle="Godown → zone → rack → shelf → bin. Location code is RACK-SHELF-BIN (e.g. B1-C-123)"
        actions={can('godowns.create') && <Button onClick={() => setG({ godown_type: 'OWN_STORE', is_active: true, portal_visible: true })}>New godown</Button>} />
      <ErrorBox error={godowns.error || locs.error} />
      {!godowns.data ? (godowns.error ? null : <Spinner />) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card title="Godowns">
            <Table><thead><tr><th>Godown</th><th>Type</th><th className="num">Locations</th><th /></tr></thead>
              <tbody>{godowns.data.map((x) => (
                <tr key={x.id} className={current?.id === x.id ? 'bg-brand-light' : ''}>
                  <td><button className="text-left font-medium text-brand hover:underline" onClick={() => setSel(x.id)}>{x.name}</button>
                    <div className="text-xs text-slate-500">{x.code}{!x.portal_visible && ' · hidden from portals'}{x.allow_negative && ' · negative allowed'}</div></td>
                  <td>{x.godown_type.replace('_', ' ')} {!x.is_active && <Badge>Inactive</Badge>}</td>
                  <td className="num">{(locs.data ?? []).filter((l) => l.godown_id === x.id && !l.is_default).length}</td>
                  <td>{can('godowns.edit') && <Button variant="ghost" onClick={() => setG(x)}>Edit</Button>}</td>
                </tr>))}</tbody></Table>
          </Card>
          {current && (
            <Card title={`Locations in ${current.name}`}>
              {can('godowns.create') && (
                <div className="mb-3 grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
                  <Field label="Zone"><Input value={loc.zone} onChange={(e) => setLoc({ ...loc, zone: e.target.value })} /></Field>
                  <Field label="Rack *"><Input value={loc.rack} onChange={(e) => setLoc({ ...loc, rack: e.target.value })} /></Field>
                  <Field label="Shelf / level"><Input value={loc.shelf} onChange={(e) => setLoc({ ...loc, shelf: e.target.value })} /></Field>
                  <Field label="Bin / position"><Input value={loc.bin} onChange={(e) => setLoc({ ...loc, bin: e.target.value })} /></Field>
                  <Button busy={busy} onClick={addLoc}>Add location</Button>
                </div>
              )}
              <Table><thead><tr><th>Code</th><th>Zone</th><th>Rack</th><th>Shelf</th><th>Bin</th><th>Status</th><th /></tr></thead>
                <tbody>{(locs.data ?? []).filter((l) => l.godown_id === current.id).map((l) => (
                  <tr key={l.id}><td className="font-mono font-medium">{l.code}{l.is_default && <span className="ml-1 font-sans text-xs text-slate-500">(default — no rack chosen)</span>}</td>
                    <td>{l.zone}</td><td>{l.rack}</td><td>{l.shelf}</td><td>{l.bin}</td>
                    <td><Badge color={l.is_active ? 'green' : 'slate'}>{l.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td>{!l.is_default && can('godowns.edit') && <Button variant="ghost" onClick={() => toggleLoc(l)}>{l.is_active ? 'Deactivate' : 'Activate'}</Button>}</td>
                  </tr>))}</tbody></Table>
            </Card>
          )}
        </div>
      )}
      <Modal open={!!g} title={g?.id ? 'Edit godown' : 'New godown'} onClose={() => setG(null)}>
        {g && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code *"><Input value={g.code ?? ''} onChange={(e) => setG({ ...g, code: e.target.value })} /></Field>
              <Field label="Name *"><Input value={g.name ?? ''} onChange={(e) => setG({ ...g, name: e.target.value })} /></Field>
              <Field label="Type"><Select value={g.godown_type} onChange={(e) => setG({ ...g, godown_type: e.target.value })}
                options={[{ value: 'OWN_STORE', label: 'Own store' }, { value: 'FACTORY', label: 'Factory' }]} /></Field>
            </div>
            <Toggle label="Active" checked={g.is_active ?? true} onChange={(v) => setG({ ...g, is_active: v })} />
            <Toggle label="Counted in portal stock" hint="Stock of this godown is used for customer / vendor stock visibility"
              checked={g.portal_visible ?? true} onChange={(v) => setG({ ...g, portal_visible: v })} />
            {can('settings.edit') && <Toggle label="Allow negative stock in this godown only" hint="Owner/Admin only. Company-wide setting is in Settings."
              checked={g.allow_negative ?? false} onChange={(v) => setG({ ...g, allow_negative: v })} />}
            <div className="flex justify-end"><Button busy={busy} onClick={saveGodown}>Save</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
