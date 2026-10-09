'use client';
import { useState } from 'react';
import Link from 'next/link';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { money } from '@/lib/format';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Toggle, useAction } from '@/components/ui';

interface Level { level_no?: number; approver_role_id: string | null; approver_permission: string | null; min_amount: number | null;
  allow_self: boolean; allow_same_approver: boolean; notify_email: boolean }
interface DocRules { doc_type: string; label: string; requires: boolean; levels: Level[] }

const NEW_LEVEL: Level = { approver_role_id: null, approver_permission: null, min_amount: null, allow_self: false, allow_same_approver: false, notify_email: false };

/** Approval levels per document type (D2): enforced by the database on submit / approve / reject. */
export default function ApprovalRulesPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const cfg = useData(() => rpc<DocRules[]>('approval_config', { p_company_id: companyId }), [companyId]);
  const roles = useData(async () => must<{ id: string; code: string; name: string }[]>(await sb().from('roles').select('id, code, name')
    .eq('company_id', companyId).eq('kind', 'INTERNAL').eq('is_active', true).order('name')), [companyId]);
  const [edit, setEdit] = useState<DocRules | null>(null);
  const editable = can('settings_approvals.edit');
  const roleName = (id: string | null) => roles.data?.find((r) => r.id === id)?.name ?? '—';
  return (
    <div>
      <PageHeader title="Approval rules" subtitle="Up to three levels per document. Without rules a document type behaves as before."
        actions={<Link className="text-sm text-brand hover:underline" href="/erp/admin/settings/?section=approvals">Rate-change approval setting</Link>} />
      <ErrorBox error={cfg.error} />
      {!cfg.data ? (cfg.error ? null : <Spinner />) : (
        <Table><thead><tr><th>Document</th><th>Approval</th><th>Levels</th><th /></tr></thead>
          <tbody>{cfg.data.map((d) => (
            <tr key={d.doc_type} data-testid={`rules-${d.doc_type}`}>
              <td>{d.label}</td>
              <td><Badge color={d.requires ? 'amber' : 'slate'}>{d.requires ? 'Required' : 'Not required'}</Badge></td>
              <td className="text-sm">{d.levels.length === 0 ? (d.requires ? 'One level: the approve right of the document' : '—') : d.levels.map((l) => (
                <div key={l.level_no}>L{l.level_no}: {l.approver_role_id ? `role ${roleName(l.approver_role_id)}` : `right ${l.approver_permission}`}
                  {l.min_amount != null && ` · from ${money(l.min_amount)}`}{l.allow_self && ' · self-approval allowed'}</div>))}</td>
              <td>{editable && <Button variant="ghost" onClick={() => setEdit(d)}>Configure</Button>}</td></tr>))}</tbody></Table>)}
      {edit && <RulesEditor companyId={companyId} rules={edit} roles={roles.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cfg.reload(); }} />}
    </div>
  );
}

function RulesEditor({ companyId, rules, roles, onClose, onSaved }: { companyId: string; rules: DocRules; roles: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void }) {
  const [requires, setRequires] = useState(rules.requires);
  const [levels, setLevels] = useState<Level[]>(rules.levels.length ? rules.levels : [{ ...NEW_LEVEL }]);
  const { busy, run } = useAction();
  const setL = (i: number, l: Partial<Level>) => setLevels(levels.map((x, j) => (j === i ? { ...x, ...l } : x)));
  return (
    <Modal open wide title={`Approval — ${rules.label}`} onClose={onClose}>
      <Toggle label="Requires approval" checked={requires} onChange={setRequires} />
      {requires && <div className="space-y-3">
        {levels.map((l, i) => (
          <div key={i} className="rounded-md border border-slate-200 p-3" data-testid={`level-${i + 1}`}>
            <div className="mb-2 flex items-center justify-between"><b>Level {i + 1}</b>
              {levels.length > 1 && <Button variant="ghost" onClick={() => setLevels(levels.filter((_, j) => j !== i))}>Remove</Button>}</div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Approver role" hint="Empty = anyone with the approve right of the document">
                <Select aria-label={`Level ${i + 1} role`} value={l.approver_role_id ?? ''} placeholder="— approve right —"
                  options={roles.map((r) => ({ value: r.id, label: r.name }))} onChange={(e) => setL(i, { approver_role_id: e.target.value || null })} /></Field>
              <Field label="Applies from amount" hint="Empty = always">
                <Input aria-label={`Level ${i + 1} amount`} type="number" min={0} value={l.min_amount ?? ''}
                  onChange={(e) => setL(i, { min_amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <div>
                <Toggle label="Creator may approve" checked={l.allow_self} onChange={(v) => setL(i, { allow_self: v })} />
                <Toggle label="Same person may approve another level" checked={l.allow_same_approver} onChange={(v) => setL(i, { allow_same_approver: v })} />
                <Toggle label="E-mail the approvers" checked={l.notify_email} onChange={(v) => setL(i, { notify_email: v })} />
              </div>
            </div>
          </div>))}
        {levels.length < 3 && <Button variant="secondary" onClick={() => setLevels([...levels, { ...NEW_LEVEL }])}>Add level</Button>}
      </div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} onClick={() => run(async () => {
          await rpc('approval_rules_save', { p_company_id: companyId, p_doc_type: rules.doc_type, p_requires: requires,
            p_levels: requires ? levels.map((l) => ({ approver_role_id: l.approver_role_id, approver_permission: l.approver_permission, min_amount: l.min_amount,
              allow_self: l.allow_self, allow_same_approver: l.allow_same_approver, notify_email: l.notify_email })) : [] });
          onSaved();
        }, 'Approval rules saved')}>Save</Button>
      </div>
    </Modal>
  );
}
