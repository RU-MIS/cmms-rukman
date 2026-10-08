'use client';
import { useMemo, type ReactNode } from 'react';
import type { Permission, PermissionModule } from '@/lib/admin';

/** Standard action columns of the matrix; any other permission of a module is listed under "More". */
export const MATRIX_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'CANCEL', 'IMPORT', 'EXPORT'] as const;
const ACTION_LABEL: Record<string, string> = { VIEW: 'View', CREATE: 'Create', EDIT: 'Edit', DELETE: 'Delete',
  APPROVE: 'Approve', CANCEL: 'Cancel', IMPORT: 'Import', EXPORT: 'Export' };

export interface MatrixRow { module: PermissionModule; cells: Record<string, Permission | undefined>; more: Permission[] }
export interface MatrixGroup { label: string; rows: MatrixRow[] }

/** Groups the permission catalogue (from the database) into matrix rows. */
export function buildMatrix(perms: Permission[], modules: PermissionModule[]): { groups: MatrixGroup[]; actions: string[] } {
  const modMap = new Map(modules.map((m) => [m.module, m]));
  const byModule = new Map<string, Permission[]>();
  for (const p of perms) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
  const rows: MatrixRow[] = [...byModule.entries()].map(([module, list]) => {
    const cells: Record<string, Permission | undefined> = {};
    const more: Permission[] = [];
    for (const p of list) {
      const std = (MATRIX_ACTIONS as readonly string[]).includes(p.action) && p.code === `${module}.${p.action.toLowerCase()}`;
      if (std) cells[p.action] = p; else more.push(p);
    }
    more.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
    return { module: modMap.get(module) ?? { module, label: module, group_label: 'Other', sort_order: 9999 }, cells, more };
  }).sort((a, b) => a.module.sort_order - b.module.sort_order || a.module.label.localeCompare(b.module.label));
  const groups: MatrixGroup[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.label === r.module.group_label);
    if (g) g.rows.push(r); else groups.push({ label: r.module.group_label, rows: [r] });
  }
  const actions = MATRIX_ACTIONS.filter((a) => rows.some((r) => r.cells[a]));
  return { groups, actions };
}

const codesOf = (r: MatrixRow) => [...Object.values(r.cells).filter(Boolean).map((p) => p!.code), ...r.more.map((p) => p.code)];

/**
 * Database-driven permission matrix: rows = modules (grouped), columns =
 * actions; extra permissions of a module (reset password, manage owners, …)
 * appear as chips. Row / column / group toggles for bulk selection.
 */
export function PermissionMatrix({ perms, modules, value, onChange, readOnly, filter = '', extraColumn }: {
  perms: Permission[]; modules: PermissionModule[]; value: Set<string>; onChange: (v: Set<string>) => void;
  readOnly?: boolean; filter?: string; extraColumn?: (row: MatrixRow) => ReactNode;
}) {
  const { groups, actions } = useMemo(() => buildMatrix(perms, modules), [perms, modules]);
  const q = filter.trim().toLowerCase();
  const visible = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => !q || r.module.label.toLowerCase().includes(q)
    || g.label.toLowerCase().includes(q) || codesOf(r).some((c) => c.includes(q))) })).filter((g) => g.rows.length);
  const set = (codes: string[], on: boolean) => {
    const next = new Set(value);
    for (const c of codes) { if (on) next.add(c); else next.delete(c); }
    onChange(next);
  };
  const allOn = (codes: string[]) => codes.length > 0 && codes.every((c) => value.has(c));
  const colCodes = (a: string) => visible.flatMap((g) => g.rows.map((r) => r.cells[a]?.code).filter(Boolean) as string[]);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="erp-table" aria-label="Permission matrix">
        <thead><tr>
          <th className="min-w-[200px]">Module</th>
          {actions.map((a) => (
            <th key={a} className="text-center">
              <div>{ACTION_LABEL[a]}</div>
              {!readOnly && <input type="checkbox" aria-label={`All ${ACTION_LABEL[a]}`} checked={allOn(colCodes(a))}
                onChange={(e) => set(colCodes(a), e.target.checked)} />}
            </th>))}
          <th>More</th>
          {extraColumn && <th />}
        </tr></thead>
        <tbody>
          {visible.map((g) => {
            const gCodes = g.rows.flatMap(codesOf);
            return [
              <tr key={`g-${g.label}`} className="bg-slate-50">
                <td colSpan={actions.length + 2 + (extraColumn ? 1 : 0)} className="font-semibold text-slate-700">
                  <label className="inline-flex items-center gap-2">
                    {!readOnly && <input type="checkbox" aria-label={`All of ${g.label}`} checked={allOn(gCodes)} onChange={(e) => set(gCodes, e.target.checked)} />}
                    {g.label}
                  </label>
                </td>
              </tr>,
              ...g.rows.map((r) => {
                const codes = codesOf(r);
                return (
                  <tr key={r.module.module}>
                    <td>
                      <label className="inline-flex items-center gap-2">
                        {!readOnly && <input type="checkbox" aria-label={`All of ${r.module.label}`} checked={allOn(codes)} onChange={(e) => set(codes, e.target.checked)} />}
                        <span>{r.module.label}</span>
                      </label>
                    </td>
                    {actions.map((a) => {
                      const p = r.cells[a];
                      return (
                        <td key={a} className="text-center">
                          {p ? <input type="checkbox" aria-label={p.code} title={p.description || p.code} disabled={readOnly}
                            checked={value.has(p.code)} onChange={(e) => set([p.code], e.target.checked)} /> : <span className="text-slate-300">–</span>}
                        </td>);
                    })}
                    <td>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {r.more.map((p) => (
                          <label key={p.code} className="inline-flex items-center gap-1 whitespace-nowrap text-xs" title={p.description}>
                            <input type="checkbox" aria-label={p.code} disabled={readOnly} checked={value.has(p.code)}
                              onChange={(e) => set([p.code], e.target.checked)} />
                            {p.label ?? p.code}{p.is_sensitive && <span className="text-amber-600" title="Sensitive">●</span>}
                          </label>))}
                      </div>
                    </td>
                    {extraColumn && <td>{extraColumn(r)}</td>}
                  </tr>);
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
