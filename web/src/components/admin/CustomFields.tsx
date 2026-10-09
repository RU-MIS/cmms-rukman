'use client';
import { must, sb } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Field, Input, Select } from '@/components/ui';

export interface CustomFieldDef {
  id: string; entity: 'ITEM' | 'CUSTOMER' | 'VENDOR'; field_key: string; label: string;
  field_type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'DROPDOWN'; options: string[]; is_required: boolean; is_active: boolean;
  sort_order: number; help_text: string | null;
}

export function useCustomFields(companyId: string, entities: string[]) {
  return useData(async () => must<CustomFieldDef[]>(await sb().from('custom_field_definitions').select('*')
    .eq('company_id', companyId).in('entity', entities).eq('is_active', true).order('sort_order').order('label')), [companyId, entities.join()]);
}

/** Renders the company's custom fields; the database validates type, options and required. */
export function CustomFieldsEditor({ defs, value, onChange, disabled }: {
  defs: CustomFieldDef[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean;
}) {
  if (defs.length === 0) return null;
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === '' || v === null || v === undefined) delete next[k]; else next[k] = v;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="group" aria-label="Custom fields">
      {defs.map((d) => {
        const label = `${d.label}${d.is_required ? ' *' : ''}`;
        const v = value[d.field_key];
        return (
          <Field key={d.id} label={label} hint={d.help_text ?? undefined}>
            {d.field_type === 'DROPDOWN' ? (
              <Select value={String(v ?? '')} disabled={disabled} onChange={(e) => set(d.field_key, e.target.value)} placeholder="—"
                options={d.options.map((o) => ({ value: o, label: o }))} />
            ) : d.field_type === 'BOOLEAN' ? (
              <Select value={v === true ? 'true' : v === false ? 'false' : ''} disabled={disabled} placeholder="—"
                onChange={(e) => set(d.field_key, e.target.value === '' ? '' : e.target.value === 'true')}
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            ) : (
              <Input type={d.field_type === 'NUMBER' ? 'number' : d.field_type === 'DATE' ? 'date' : 'text'} disabled={disabled}
                value={String(v ?? '')} onChange={(e) => set(d.field_key, e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}
