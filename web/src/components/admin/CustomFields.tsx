'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { useSession } from '@/lib/session';
import { uploadDocument, type EntityType } from '@/components/Documents';
import { Button, Field, Input, Select } from '@/components/ui';

export type CustomEntity = 'ITEM' | 'CUSTOMER' | 'VENDOR' | 'USER' | 'GODOWN' | 'SALES_ORDER' | 'PURCHASE_ORDER' | 'DOCUMENT';
export type CustomType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'DROPDOWN' | 'MULTI_SELECT' | 'EMAIL' | 'PHONE' | 'CURRENCY' | 'FILE' | 'IMAGE';
export interface CustomFieldDef {
  id: string; entity: CustomEntity; field_key: string; label: string; field_type: CustomType; options: string[]; is_required: boolean;
  is_active: boolean; sort_order: number; help_text: string | null; default_value: unknown; is_visible: boolean; is_editable: boolean;
  is_searchable: boolean; is_exportable: boolean; view_permission: string | null; edit_permission: string | null;
}

/** Active, visible definitions the user may see (restricted fields need their view permission). */
export function useCustomFields(companyId: string, entities: string[]) {
  const { can } = useSession();
  return useData(async () => must<CustomFieldDef[]>(await sb().from('custom_field_definitions').select('*')
    .eq('company_id', companyId).in('entity', entities).eq('is_active', true).order('sort_order').order('label'))
    .filter((d) => d.is_visible !== false && (!d.view_permission || can(d.view_permission))), [companyId, entities.join()]);
}

/** Values of restricted fields (stored apart; served only to holders of the field's view permission). */
export async function privateValues(companyId: string, entity: string, id: string): Promise<Record<string, unknown>> {
  const r = await rpc<Record<string, Record<string, unknown>>>('custom_private_values', { p_company_id: companyId, p_entity: entity, p_ids: [id] });
  return r[id] ?? {};
}

/** Renders the custom fields; the database validates type, options, required, editable and edit permission. */
export function CustomFieldsEditor({ defs, value, onChange, disabled, existing, files }: {
  defs: CustomFieldDef[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean;
  /** the record exists already: fields that are not editable after creation are read-only */
  existing?: boolean;
  /** where FILE / IMAGE fields upload their document */
  files?: { companyId: string; entityType: EntityType; entityId: string };
}) {
  const { can } = useSession();
  if (defs.length === 0) return null;
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k]; else next[k] = v;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="group" aria-label="Custom fields">
      {defs.map((d) => {
        const label = `${d.label}${d.is_required ? ' *' : ''}`;
        const v = value[d.field_key];
        const dis = disabled || (existing && !d.is_editable) || (!!d.edit_permission && !can(d.edit_permission));
        const input = (type: string, extra: Record<string, unknown> = {}) => <Input aria-label={d.label} type={type} disabled={dis} value={String(v ?? '')}
          onChange={(e) => set(d.field_key, e.target.value)} {...extra} />;
        return (
          <Field key={d.id} label={label} hint={d.help_text ?? undefined}>
            {d.field_type === 'DROPDOWN' ? (
              <Select aria-label={d.label} value={String(v ?? '')} disabled={dis} onChange={(e) => set(d.field_key, e.target.value)} placeholder="—"
                options={d.options.map((o) => ({ value: o, label: o }))} />
            ) : d.field_type === 'MULTI_SELECT' ? (
              <div className="flex flex-wrap gap-3 py-1" role="group" aria-label={d.label}>{d.options.map((o) => {
                const cur = Array.isArray(v) ? (v as string[]) : [];
                return <label key={o} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={dis} checked={cur.includes(o)}
                  onChange={(e) => set(d.field_key, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />{o}</label>;
              })}</div>
            ) : d.field_type === 'BOOLEAN' ? (
              <Select aria-label={d.label} value={v === true ? 'true' : v === false ? 'false' : ''} disabled={dis} placeholder="—"
                onChange={(e) => set(d.field_key, e.target.value === '' ? '' : e.target.value === 'true')}
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            ) : d.field_type === 'FILE' || d.field_type === 'IMAGE' ? (
              <FileValue def={d} value={v as string | undefined} disabled={dis} files={files} onChange={(x) => set(d.field_key, x)} />
            ) : d.field_type === 'NUMBER' ? input('number')
              : d.field_type === 'CURRENCY' ? input('number', { step: '0.01' })
              : d.field_type === 'DATE' ? input('date')
              : d.field_type === 'EMAIL' ? input('email')
              : d.field_type === 'PHONE' ? input('tel') : input('text')}
          </Field>
        );
      })}
    </div>
  );
}

/** FILE / IMAGE field: the value is a document of this record (documents storage rules apply). */
function FileValue({ def, value, disabled, files, onChange }: { def: CustomFieldDef; value: string | undefined; disabled: boolean;
  files?: { companyId: string; entityType: EntityType; entityId: string }; onChange: (v: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = useData(async () => (value ? (await sb().from('documents').select('file_name').eq('id', value).maybeSingle()).data?.file_name ?? 'document' : null), [value]);
  if (!files) return <span className="text-xs text-slate-500">{value ? name.data : 'Save the record first, then attach the file'}</span>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="truncate">{value ? name.data : '—'}</span>
      {!disabled && <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 shadow-sm hover:bg-slate-50">
        {busy ? 'Uploading…' : 'Attach'}
        <input type="file" className="hidden" aria-label={`${def.label} file`} accept={def.field_type === 'IMAGE' ? 'image/*' : undefined} onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setBusy(true); setErr(null);
          try {
            const r = await uploadDocument(files.companyId, files.entityType, files.entityId, f, { category: 'OTHER', visible: false, sendEmail: false });
            onChange(r.document_id);
          } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
        }} /></label>}
      {!disabled && value && <Button variant="ghost" onClick={() => onChange(null)}>Clear</Button>}
      {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
