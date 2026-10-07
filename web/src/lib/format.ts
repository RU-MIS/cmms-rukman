export function num(v: unknown, digits = 3): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function money(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function date(v: unknown): string {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}-${m}-${y}` : s;
}

export function dateTime(v: unknown): string {
  if (!v) return '';
  return new Date(String(v)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function label(code: unknown): string {
  return String(code ?? '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
