'use client';
import { useState } from 'react';
import { useCompanyId } from '@/lib/session';
import { useGodowns, useItems, useParties } from '@/lib/masters';
import { Button, Spinner, useAction } from '@/components/ui';
import { DataScopePicker, SCOPE_DIMENSIONS, SCOPE_NONE, type ScopeOption } from './widgets';

const VENDOR_ROLES = ['SUPPLIER', 'JOB_WORKER', 'CUTTER'];

/** Records the scope pickers offer (what the administrator can see). */
export function useScopeOptions() {
  const companyId = useCompanyId();
  const godowns = useGodowns(companyId);
  const customers = useParties(companyId, 'CUSTOMER');
  const vendors = useParties(companyId, VENDOR_ROLES);
  const items = useItems(companyId);
  const ready = godowns.data && customers.data && vendors.data && items.data;
  const options: Record<string, ScopeOption[]> = {
    GODOWN: godowns.data ?? [], CUSTOMER: customers.data ?? [], VENDOR: vendors.data ?? [], ITEM: items.data ?? [] };
  return { ready: !!ready, options };
}

const describe = (ids: string[] | null | undefined, opts: ScopeOption[], label: string) =>
  !ids ? `All ${label.toLowerCase()}` : ids.includes(SCOPE_NONE) ? 'No access'
    : ids.map((id) => opts.find((o) => o.id === id)?.name ?? '?').join(', ');

/**
 * Data access per dimension (godowns, customers, vendors, items) of a user or
 * a role. Saved with user_set_scope / role_set_scope; enforced by RLS.
 */
export function ScopeEditor({ stored, effective, disabled, intro, onSave }: {
  stored: Record<string, string[]>; effective?: Record<string, string[] | null>; disabled?: boolean; intro: string;
  onSave: (dimension: string, ids: string[]) => Promise<void>;
}) {
  const { ready, options } = useScopeOptions();
  const [edit, setEdit] = useState<Record<string, string[]>>({});
  const { busy, run } = useAction();
  if (!ready) return <Spinner />;
  const value = (d: string) => edit[d] ?? stored[d] ?? [];
  const changed = SCOPE_DIMENSIONS.filter((d) => d.code in edit
    && JSON.stringify([...value(d.code)].sort()) !== JSON.stringify([...(stored[d.code] ?? [])].sort()));
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{intro}</p>
      {SCOPE_DIMENSIONS.map((d) => (
        <fieldset key={d.code} className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-700">{d.label}</legend>
          {effective && <p className="mb-2 text-xs text-slate-500">Effective now: <b>{describe(effective[d.code], options[d.code], d.label)}</b>
            {!(stored[d.code]?.length) && effective[d.code] ? ' (from the roles)' : ''}</p>}
          <DataScopePicker dimension={d.code} label={d.label} one={d.one} options={options[d.code]} value={value(d.code)}
            disabled={disabled} onChange={(ids) => setEdit({ ...edit, [d.code]: ids })} />
        </fieldset>))}
      {!disabled && (
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-slate-500">{changed.length ? `Changed: ${changed.map((d) => d.label).join(', ')}` : 'No changes'}</span>
          <Button busy={busy} disabled={changed.length === 0} onClick={() => run(async () => {
            for (const d of changed) await onSave(d.code, value(d.code));
            setEdit({});
          }, 'Data access saved')}>Save data access</Button>
        </div>)}
    </div>
  );
}
