'use client';
import { useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Toggle, useAction } from '@/components/ui';

interface Seq { doc_type: string; label: string | null; prefix: string; pattern: string; padding: number; reset_policy: string; start_value: number;
  is_active: boolean; state: { period: string; last_issued: number | null; next_value: number; next_no: string } | null }

const RESET = [{ value: 'NEVER', label: 'Never' }, { value: 'FY', label: 'Financial year' }, { value: 'CALENDAR', label: 'Calendar year' },
  { value: 'MONTHLY', label: 'Monthly' }];
const MASTERS = ['ITEM', 'CUSTOMER', 'VENDOR', 'GODOWN', 'CUSTOMER_BILL'];
const TOKENS = ['{PREFIX}', '{FY}', '{YYYY}', '{YY}', '{MM}', '{NUMBER}'];

/** Client preview of a pattern (the database formats the real number; FY assumed to start in April here). */
function previewNo(s: Pick<Seq, 'prefix' | 'pattern' | 'padding'>, n: number, d = new Date()): string {
  const y = d.getFullYear(); const fy = d.getMonth() >= 3 ? y : y - 1;
  return s.pattern.replaceAll('{PREFIX}', s.prefix).replaceAll('{FY}', `${fy}-${String(fy + 1).slice(2)}`)
    .replaceAll('{YYYY}', String(y)).replaceAll('{YY}', String(y).slice(2)).replaceAll('{MM}', String(d.getMonth() + 1).padStart(2, '0'))
    .replaceAll('{NUMBER}', String(n).padStart(s.padding, '0'));
}

export default function NumberingPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const list = useData(() => rpc<Seq[]>('numbering_list', { p_company_id: companyId }), [companyId]);
  const [edit, setEdit] = useState<Seq | null>(null);
  const editable = can('settings_numbering.edit');
  const rows = list.data ?? [];
  const section = (masters: boolean) => rows.filter((s) => MASTERS.includes(s.doc_type) === masters);
  const table = (items: Seq[]) => (
    <Table className="mb-6"><thead><tr><th>Sequence</th><th>Pattern</th><th>Reset</th><th>Last issued</th><th>Next number</th><th>Status</th><th /></tr></thead>
      <tbody>{items.map((s) => (
        <tr key={s.doc_type} data-testid={`seq-${s.doc_type}`}>
          <td>{s.label ?? s.doc_type}<div className="text-xs text-slate-500">{s.doc_type}</div></td>
          <td className="font-mono text-xs">{s.pattern.replaceAll('{PREFIX}', s.prefix)}</td>
          <td>{RESET.find((r) => r.value === s.reset_policy)?.label}</td>
          <td className="num">{s.state?.last_issued ?? '—'}</td>
          <td className="font-mono">{s.state?.next_no}</td>
          <td><Badge color={s.is_active ? 'green' : 'slate'}>{s.is_active ? 'Active' : 'Off'}</Badge></td>
          <td>{editable && <Button variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}</td></tr>))}</tbody></Table>);
  return (
    <div>
      <PageHeader title="Numbering" subtitle="Changes apply to future numbers only; issued numbers never change. Numbers stay unique and gap-free under concurrency." />
      <ErrorBox error={list.error} />
      {!list.data ? (list.error ? null : <Spinner />) : <>
        <h2 className="mb-2 font-semibold text-slate-700">Documents</h2>{table(section(false))}
        <h2 className="mb-2 font-semibold text-slate-700">Master codes and invoice reference</h2>
        <p className="mb-2 text-sm text-slate-500">When active, an empty code on create (screen or import) takes the next number; a typed code is still allowed.</p>
        {table(section(true))}
      </>}
      {edit && <SeqEditor companyId={companyId} seq={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function SeqEditor({ companyId, seq, onClose, onSaved }: { companyId: string; seq: Seq; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState({ prefix: seq.prefix, pattern: seq.pattern, padding: seq.padding, reset_policy: seq.reset_policy,
    start_value: seq.start_value, is_active: seq.is_active });
  const { busy, run } = useAction();
  const minStart = (seq.state?.last_issued ?? 0) + 1;
  const problem = !d.pattern.includes('{NUMBER}') ? 'The pattern must contain {NUMBER}'
    : /\{(?!PREFIX\}|FY\}|YYYY\}|YY\}|MM\}|NUMBER\})/.test(d.pattern) ? 'Unknown token in the pattern'
    : d.start_value !== seq.start_value && seq.state?.last_issued != null && d.start_value <= seq.state.last_issued
      ? `Number ${seq.state.last_issued} has already been issued; the start number must be at least ${minStart}` : null;
  return (
    <Modal open title={`Numbering — ${seq.label ?? seq.doc_type}`} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prefix"><Input aria-label="Prefix" value={d.prefix} onChange={(e) => setD({ ...d, prefix: e.target.value })} /></Field>
        <Field label="Padding (digits)"><Input aria-label="Padding" type="number" min={1} max={12} value={d.padding} onChange={(e) => setD({ ...d, padding: Number(e.target.value) })} /></Field>
        <Field label="Pattern" className="sm:col-span-2" hint={`Tokens: ${TOKENS.join(' ')}`}>
          <Input aria-label="Pattern" className="font-mono" value={d.pattern} onChange={(e) => setD({ ...d, pattern: e.target.value })} />
          <div className="mt-1 flex flex-wrap gap-1">{TOKENS.map((t) => <button key={t} type="button" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs"
            onClick={() => setD({ ...d, pattern: d.pattern + t })}>{t}</button>)}</div>
        </Field>
        <Field label="Reset numbering"><Select aria-label="Reset" value={d.reset_policy} options={RESET} onChange={(e) => setD({ ...d, reset_policy: e.target.value })} /></Field>
        <Field label="Start number" hint={seq.state?.last_issued != null ? `Last issued in this period: ${seq.state.last_issued}` : 'Nothing issued in this period yet'}>
          <Input aria-label="Start number" type="number" min={1} value={d.start_value} onChange={(e) => setD({ ...d, start_value: Number(e.target.value) })} /></Field>
        <div className="sm:col-span-2"><Toggle label="Active" checked={d.is_active} onChange={(v) => setD({ ...d, is_active: v })}
          hint={MASTERS.includes(seq.doc_type) ? 'Empty codes take the next number only while active' : undefined} /></div>
      </div>
      <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm">Preview of the next number:{' '}
        <b className="font-mono" data-testid="seq-preview">{previewNo(d, Math.max(d.start_value, minStart))}</b></p>
      {problem && <p role="alert" className="mt-2 text-sm text-red-600">{problem}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={Boolean(problem)} onClick={() => run(async () => {
          await rpc('sequence_save', { p_company_id: companyId, p_doc_type: seq.doc_type, p_payload: d });
          onSaved();
        }, 'Numbering saved')}>Save</Button>
      </div>
    </Modal>
  );
}
