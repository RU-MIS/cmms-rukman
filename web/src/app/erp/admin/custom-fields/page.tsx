'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import type { CustomFieldDef } from '@/components/admin/CustomFields';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Toggle, useAction } from '@/components/ui';

const ENTITIES = [{ value: 'ITEM', label: 'Items' }, { value: 'CUSTOMER', label: 'Customers' }, { value: 'VENDOR', label: 'Vendors' },
  { value: 'USER', label: 'Users' }, { value: 'GODOWN', label: 'Godowns' }, { value: 'SALES_ORDER', label: 'Sales orders' },
  { value: 'PURCHASE_ORDER', label: 'Purchase orders' }, { value: 'DOCUMENT', label: 'Documents' }];
const TYPES = [{ value: 'TEXT', label: 'Text' }, { value: 'NUMBER', label: 'Number' }, { value: 'CURRENCY', label: 'Currency' },
  { value: 'DATE', label: 'Date' }, { value: 'BOOLEAN', label: 'Yes / No' }, { value: 'DROPDOWN', label: 'Dropdown' },
  { value: 'MULTI_SELECT', label: 'Multi-select' }, { value: 'EMAIL', label: 'E-mail' }, { value: 'PHONE', label: 'Phone' },
  { value: 'FILE', label: 'File' }, { value: 'IMAGE', label: 'Image' }];

type Draft = { id: string | null; entity: string; field_key: string; label: string; field_type: string; options: string;
  is_required: boolean; is_active: boolean; sort_order: string; help_text: string; default_value: string; is_visible: boolean;
  is_editable: boolean; is_searchable: boolean; is_exportable: boolean; view_permission: string; edit_permission: string };
const NEW: Omit<Draft, 'entity'> = { id: null, field_key: '', label: '', field_type: 'TEXT', options: '', is_required: false, is_active: true,
  sort_order: '100', help_text: '', default_value: '', is_visible: true, is_editable: true, is_searchable: false, is_exportable: true,
  view_permission: '', edit_permission: '' };

/** Custom fields of every master and document type: shown in the forms, the import templates and the exports. */
export default function CustomFieldsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const list = useData(async () => must<CustomFieldDef[]>(await sb().from('custom_field_definitions').select('*')
    .eq('company_id', companyId).order('entity').order('sort_order').order('label')), [companyId]);
  const [entity, setEntity] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const edit = can('settings_custom_fields.edit');
  const perms = useData(async () => must<{ code: string; label: string | null }[]>(await sb().from('permissions').select('code, label')
    .eq('is_active', true).neq('kind', 'PORTAL').order('code')), []);
  const permOpts = (perms.data ?? []).map((p) => ({ value: p.code, label: p.label ? `${p.label} (${p.code})` : p.code }));
  const rows = (list.data ?? []).filter((d) => !entity || d.entity === entity);

  const save = () => run(async () => {
    if (!draft) return;
    await rpc('custom_field_save', { p_company_id: companyId, p_id: draft.id, p_payload: {
      entity: draft.entity, field_key: draft.field_key, label: draft.label, field_type: draft.field_type,
      options: draft.options.split(',').map((x) => x.trim()).filter(Boolean), is_required: draft.is_required,
      is_active: draft.is_active, sort_order: Number(draft.sort_order) || 100, help_text: draft.help_text,
      default_value: draft.default_value === '' ? null : draft.default_value, is_visible: draft.is_visible, is_editable: draft.is_editable,
      is_searchable: draft.is_searchable, is_exportable: draft.is_exportable, edit_permission: draft.edit_permission,
      ...(draft.id ? {} : { view_permission: draft.view_permission }) } });
    setDraft(null); list.reload();
  }, 'Custom field saved');

  return (
    <div>
      <PageHeader title="Custom fields" subtitle="Extra fields for items, customers, vendors, users, godowns, orders and documents — no code change. They appear in the forms, import templates (cf_<key>) and exports."
        actions={edit && <Button onClick={() => setDraft({ ...NEW, entity: entity || 'ITEM' })}>New field</Button>} />
      <div className="mb-3"><Select aria-label="Entity filter" className="w-40" value={entity} onChange={(e) => setEntity(e.target.value)}
        placeholder="All" options={ENTITIES} /></div>
      <ErrorBox error={list.error} />
      {!list.data ? <Spinner /> : (
        <Table><thead><tr><th>For</th><th>Label</th><th>Key</th><th>Type</th><th>Options</th><th>Required</th><th>Restricted</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}>
              <td>{ENTITIES.find((e) => e.value === d.entity)?.label}</td><td className="font-medium">{d.label}</td>
              <td className="font-mono text-xs">{d.field_key}</td><td>{TYPES.find((t) => t.value === d.field_type)?.label}</td>
              <td className="text-xs">{d.options.join(', ')}</td><td>{d.is_required ? 'Yes' : ''}</td><td className="text-xs">{d.view_permission ?? ''}</td>
              <td><Badge color={d.is_active ? 'green' : 'slate'}>{d.is_active ? 'Active' : 'Disabled'}</Badge></td>
              <td>{edit && <Button variant="secondary" onClick={() => setDraft({ id: d.id, entity: d.entity, field_key: d.field_key, label: d.label,
                field_type: d.field_type, options: d.options.join(', '), is_required: d.is_required, is_active: d.is_active,
                sort_order: String(d.sort_order), help_text: d.help_text ?? '', default_value: d.default_value == null ? '' : String(d.default_value),
                is_visible: d.is_visible, is_editable: d.is_editable, is_searchable: d.is_searchable, is_exportable: d.is_exportable,
                view_permission: d.view_permission ?? '', edit_permission: d.edit_permission ?? '' })}>Edit</Button>}</td>
            </tr>))}
            {rows.length === 0 && <tr><td colSpan={9} className="text-slate-500">No custom fields yet</td></tr>}</tbody></Table>)}
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
              {['DROPDOWN', 'MULTI_SELECT'].includes(draft.field_type) && <Field label="Options" hint="comma separated" className="md:col-span-2">
                <Input value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} /></Field>}
              <Field label="Help text"><Input value={draft.help_text} onChange={(e) => setDraft({ ...draft, help_text: e.target.value })} /></Field>
              <Field label="Sort order"><Input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} /></Field>
              <Field label="Default value" hint="Filled in on new records"><Input aria-label="Default value" value={draft.default_value}
                onChange={(e) => setDraft({ ...draft, default_value: e.target.value })} /></Field>
              <Field label="Who may see it" hint={draft.id ? 'Fixed after creation' : 'Restricted fields are stored apart and masked everywhere'}>
                <Select aria-label="View permission" disabled={!!draft.id} value={draft.view_permission} placeholder="Everyone who sees the record"
                  options={permOpts} onChange={(e) => setDraft({ ...draft, view_permission: e.target.value })} /></Field>
              <Field label="Who may change it"><Select aria-label="Edit permission" value={draft.edit_permission} placeholder="Everyone who may edit the record"
                options={permOpts} onChange={(e) => setDraft({ ...draft, edit_permission: e.target.value })} /></Field>
            </div>
            <div className="grid gap-x-6 md:grid-cols-2">
              <Toggle label="Visible in forms" checked={draft.is_visible} onChange={(v) => setDraft({ ...draft, is_visible: v })} />
              <Toggle label="Editable after creation" checked={draft.is_editable} onChange={(v) => setDraft({ ...draft, is_editable: v })} />
              <Toggle label="Searchable (list filter)" checked={draft.is_searchable} onChange={(v) => setDraft({ ...draft, is_searchable: v })} />
              <Toggle label="In exports and import templates" checked={draft.is_exportable} onChange={(v) => setDraft({ ...draft, is_exportable: v })} />
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
