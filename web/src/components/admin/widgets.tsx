'use client';
import { useState } from 'react';
import type { Godown } from '@/lib/masters';
import { Button, Modal } from '@/components/ui';

/** Shows a temporary password ONCE. It is not stored anywhere by the app. */
export function TempPasswordModal({ value, onClose }: { value: { email: string; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <Modal open title="Temporary password" onClose={() => { setCopied(false); onClose(); }}>
      <p className="mb-2 text-sm text-slate-600">Login: <b>{value.email}</b></p>
      <div className="flex items-center gap-2">
        <code data-testid="temp-password" className="flex-1 select-all rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-lg tracking-wide">
          {value.password}</code>
        <Button variant="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(value.password); setCopied(true); } catch { setCopied(false); }
        }}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
        This password is shown only now and is not stored by the application. Hand it over securely —
        the user must choose a new password at the first login.
      </p>
      <div className="mt-4 text-right"><Button onClick={() => { setCopied(false); onClose(); }}>Done</Button></div>
    </Modal>
  );
}

/** "All godowns" or a selection (data scope GODOWN). Empty selection = all. */
export function GodownScopePicker({ godowns, value, onChange, disabled }: {
  godowns: Godown[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const restricted = value.length > 0;
  const [open, setOpen] = useState(restricted);
  return (
    <div className="space-y-2" role="group" aria-label="Godown access">
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="godown-scope" disabled={disabled} checked={!open} onChange={() => { setOpen(false); onChange([]); }} />
        All godowns
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="godown-scope" disabled={disabled} checked={open} onChange={() => setOpen(true)} />
        Only selected godowns
      </label>
      {open && (
        <div className="ml-6 grid gap-1 sm:grid-cols-2">
          {godowns.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={disabled} aria-label={`Godown ${g.code}`} checked={value.includes(g.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((x) => x !== g.id))} />
              {g.name} <span className="text-xs text-slate-500">{g.code}</span>
            </label>))}
          {open && value.length === 0 && <p className="text-xs text-amber-700 sm:col-span-2">Select at least one godown (no selection = all godowns).</p>}
        </div>)}
    </div>
  );
}

/** Sentinel scope entry meaning "no record of this dimension" (app.scope_none()). */
export const SCOPE_NONE = '00000000-0000-0000-0000-000000000000';
export const SCOPE_DIMENSIONS: { code: 'GODOWN' | 'CUSTOMER' | 'VENDOR' | 'ITEM'; label: string; one: string }[] = [
  { code: 'GODOWN', label: 'Godowns', one: 'Godown' }, { code: 'CUSTOMER', label: 'Customers', one: 'Customer' },
  { code: 'VENDOR', label: 'Vendors', one: 'Vendor' }, { code: 'ITEM', label: 'Items', one: 'Item' },
];
export type ScopeOption = { id: string; code: string; name: string };

/**
 * Data scope of one dimension: full access (no entries), selected records,
 * or no access (the SCOPE_NONE sentinel). Enforced by the database.
 */
export function DataScopePicker({ dimension, label, one, options, value, onChange, disabled }: {
  dimension: string; label: string; one: string; options: ScopeOption[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const mode = value.includes(SCOPE_NONE) ? 'none' : value.length > 0 ? 'some' : 'all';
  const [picking, setPicking] = useState(mode === 'some');
  const [q, setQ] = useState('');
  const shown = picking && mode !== 'none' ? 'some' : mode;
  const s = q.trim().toLowerCase();
  const list = options.filter((o) => !s || o.code.toLowerCase().includes(s) || o.name.toLowerCase().includes(s) || value.includes(o.id)).slice(0, 300);
  const name = `scope-${dimension}`;
  return (
    <div className="space-y-2" role="group" aria-label={`${one} access`}>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} disabled={disabled} checked={shown === 'all'} onChange={() => { setPicking(false); onChange([]); }} />
          All {label.toLowerCase()}</label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} disabled={disabled} checked={shown === 'some'}
            onChange={() => { setPicking(true); if (mode === 'none') onChange([]); }} />
          Only selected {label.toLowerCase()}</label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} disabled={disabled} checked={shown === 'none'} onChange={() => { setPicking(false); onChange([SCOPE_NONE]); }} />
          No access</label>
      </div>
      {shown === 'some' && (
        <div className="ml-6 space-y-2">
          {options.length > 12 && <input className="input w-64" placeholder={`Find ${label.toLowerCase()}`} aria-label={`Find ${label.toLowerCase()}`}
            value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
            {list.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={disabled} aria-label={`${one} ${o.code}`} checked={value.includes(o.id)}
                  onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
                {o.name} <span className="text-xs text-slate-500">{o.code}</span>
              </label>))}
          </div>
          {value.length === 0 && <p className="text-xs text-amber-700">Select at least one (no selection = all {label.toLowerCase()}).</p>}
        </div>)}
    </div>
  );
}
