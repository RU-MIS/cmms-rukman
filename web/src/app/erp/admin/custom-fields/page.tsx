'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import type { CustomFieldDef } from '@/components/admin/CustomFields';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Toggle, useAction } from '@/components/ui';

const ENTITIES = [{ value: 'ITEM', label: 'Items' }, { value: 'CUSTOMER', label: 'Customers' }, { value: 'VENDOR', label: 'Vendors' }];
const TYPES = [{ value: 'TEXT', label: 'Text' }, { value: 'NUMBER', label: 'Number' }, { value: 'DATE', label: 'Date' },
  { value: 'BOOLEAN', label: 'Yes / No' }, { value: 'DROPDOWN', label: 'Dropdown' }];

type Draft = { id: string | null; entity: string; field_key: string; label: string; field_type: string; options: string;
  is_required: boolean; is_active: boolean; sort_order: string; help_text: string };

/** Custom fields of items, customers and vendors: shown in the forms, the import templates and the exports. */
export default function CustomFieldsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const list = useData(async () => must<CustomFieldDef[]>(await sb().from('custom_field_definitions').select('*')
    .eq('company_id', companyId).order('entity').order('sort_order').order('label')), [companyId]);
  const [entity, setEntity] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const edit = can('settings_custom_fields.edit');
  const rows = (list.data ?? []).filter((d) => !entity || d.entity === entity);

  const save = () => run(async () => {
    if (!draft) return;
    await rpc('custom_field_save', { p_company_id: companyId, p_id: draft.id, p_payload: {
      entity: draft.entity, field_key: draft.field_key, label: draft.label, field_type: draft.field_type,
      options: draft.options.split(',').map((x) => x.trim()).filter(Boolean), is_required: draft.is_required,
      is_active: draft.is_active, sort_order: Number(draft.sort_order) || 100, help_text: draft.help_text } });
    setDraft(null); list.reload();
  }, 'Custom field saved');

  return (
    <div>
      <PageHeader title="Custom fields" subtitle="Extra fields for items, customers and vendors — no code change. They appear in the forms, import templates (cf_<key>) and exports."
        actions={edit && <Button onClick={() => setDraft({ id: null, entity: entity || 'ITEM', field_key: '', label: '', field_type: 'TEXT', options: '',
          is_required: false, is_active: true, sort_order: '100', help_text: '' })}>New field</Button>} />
      <div className="mb-3"><Select aria-label="Entity filter" className="w-40" value={entity} onChange={(e) => setEntity(e.target.value)}
        placeholder="All" options={ENTITIES} /></div>
      <ErrorBox error={list.error} />
      {!list.data ? <Spinner /> : (
        <Table><thead><tr><th>For</th><th>Label</th><th>Key</th><th>Type</th><th>Options</th><th>Required</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}>
              <td>{ENTITIES.find((e) => e.value === d.entity)?.label}</td><td className="font-medium">{d.label}</td>
              <td className="font-mono text-xs">{d.field_key}</td><td>{TYPES.find((t) => t.value === d.field_type)?.label}</td>
              <td className="text-xs">{d.options.join(', ')}</td><td>{d.is_required ? 'Yes' : ''}</td>
              <td><Badge color={d.is_active ? 'green' : 'slate'}>{d.is_active ? 'Active' : 'Disabled'}</Badge></td>
              <td>{edit && <Button variant="secondary" onClick={() => setDraft({ id: d.id, entity: d.entity, field_key: d.field_key, label: d.label,
                field_type: d.field_type, options: d.options.join(', '), is_required: d.is_required, is_active: d.is_active,
                sort_order: String(d.sort_order), help_text: d.help_text ?? '' })}>Edit</Button>}</td>
            </tr>))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-slate-500">No custom fields yet</td></tr>}</tbody></Table>)}
      <Modal open={!!draft} title={draft?.id ? `Edit field ${draft.label}` : 'New custom field'} onClose={() => setDraft(null)}>
        {draft && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="For"><Select value={draft.entity} disabled={!!draft.id} options={ENTITIES}
                onChange={(e) => setDraft({ ...draft, entity: e.target.value })} /></Field>
              <Field label="Type"><Select value={draft.field_type} disabled={!!draft.id} options={TYPES}
                onChange={(e) => setDraft({ ...draft, field_type: e.target.value })} /></Field>
              <Field label="Label"><Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
              <Field label="Key" hint="lower case letters, digits, _ (fixed after creation)"><Input value={draft.field_key} disabled={!!draft.id}
                onChange={(e) => setDraft({ ...draft, field_key: e.target.value.toLowerCase() })} /></Field>
              {draft.field_type === 'DROPDOWN' && <Field label="Options" hint="comma separated" className="md:col-span-2">
                <Input value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} /></Field>}
              <Field label="Help text"><Input value={draft.help_text} onChange={(e) => setDraft({ ...draft, help_text: e.target.value })} /></Field>
              <Field label="Sort order"><Input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} /></Field>
            </div>
            <div className="flex gap-6">
              <Toggle label="Required" checked={draft.is_required} onChange={(v) => setDraft({ ...draft, is_required: v })} />
              <Toggle label="Active" checked={draft.is_active} onChange={(v) => setDraft({ ...draft, is_active: v })} />
            </div>
            <div className="text-right"><Button type="submit" busy={busy}>Save field</Button></div>
          </form>)}
      </Modal>
    </div>
  );
}
