'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { errorText } from '@/lib/supabase';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  ghost: 'text-brand hover:bg-brand-light',
};

export function Button({ variant = 'primary', busy, className = '', children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}>
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Input({ ref, ...p }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} {...p} className={`input ${p.className ?? ''}`} />;
}

/**
 * Password input with a show / hide toggle. `aria-label` is required: inside a
 * <Field> the toggle would otherwise become part of the field's name.
 */
export function PasswordInput({ 'aria-label': label, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { 'aria-label': string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <Input {...p} aria-label={label} type={visible ? 'text' : 'password'} className={`pr-16 ${p.className ?? ''}`}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" onClick={() => setVisible(!visible)} aria-pressed={visible}
        aria-label={visible ? 'Hide typed characters' : 'Show typed characters'}
        className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        {visible ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}

export function TextArea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={`input ${p.className ?? ''}`} />;
}

export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={`input ${p.className ?? ''}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void;
  label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-slate-300'} disabled:opacity-50`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="font-semibold text-slate-700">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

const badgeColors: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};
const statusColor: Record<string, string> = {
  IN_STOCK: 'green', LOW_STOCK: 'amber', OUT_OF_STOCK: 'red', OPEN: 'blue', PARTIALLY_RECEIVED: 'amber',
  FULLY_RECEIVED: 'green', PARTIALLY_DISPATCHED: 'amber', DISPATCHED: 'green', CANCELLED: 'slate', CLOSED: 'slate',
  SUBMITTED: 'blue', UNDER_REVIEW: 'amber', APPROVED: 'green', REJECTED: 'red', POSTED: 'green', DRAFT: 'slate',
  PENDING_APPROVAL: 'amber', QUEUED: 'blue', SENDING: 'amber', SENT: 'green', FAILED: 'red', SKIPPED: 'slate',
  ACTIVE: 'blue', RELEASED: 'slate', CONSUMED: 'green', PAID: 'green', PARTIALLY_PAID: 'amber', UNPAID: 'red',
};
export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  const c = color ?? statusColor[String(children)] ?? 'slate';
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeColors[c]}`}>
    {String(children).replace(/_/g, ' ')}</span>;
}

export function Spinner({ text = 'Loading…' }: { text?: string }) {
  return <div className="flex items-center gap-2 p-6 text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />{text}</div>;
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-slate-500">{children}</div>;
}

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto rounded-lg border border-slate-200 bg-white ${className}`}><table className="erp-table">{children}</table></div>;
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-2 sm:p-6" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className={`w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} rounded-lg bg-white shadow-xl`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>✕</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// ---- toast -----------------------------------------------------------------
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<{ ok: (t: string) => void; fail: (e: unknown) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  const api = { ok: (t: string) => push(t, 'ok'), fail: (e: unknown) => push(errorText(e), 'error') };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-md px-4 py-2.5 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-800 text-white'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

/** Runs an action with busy state + toast. Returns true on success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okText) toast.ok(okText);
      return true;
    } catch (e) {
      toast.fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}
