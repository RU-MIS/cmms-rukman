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
