import { formatCurrency } from '@/lib/utils';

interface PerformerRow {
  name: string;
  amount: number;
}

interface TopPerformerCardProps {
  title: string;
  rows: PerformerRow[];
}

const RANK_STYLES = [
  { badge: 'bg-warning text-white', ring: 'ring-warning/30' },
  { badge: 'bg-ink-faint text-white', ring: 'ring-ink-faint/30' },
  { badge: 'bg-brand-400 text-white', ring: 'ring-brand-400/30' },
];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

export function TopPerformerCard({ title, rows }: TopPerformerCardProps) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-ink mb-3">{title}</h2>
      {rows.length === 0 && <p className="text-sm text-ink-muted py-6 text-center">No data yet</p>}
      <div className="space-y-2.5">
        {rows.map((r, i) => {
          const style = RANK_STYLES[i] ?? { badge: 'bg-brand-50 text-brand-600', ring: 'ring-brand-100' };
          return (
            <div key={r.name + i} className={`flex items-center gap-3 rounded-xl p-2.5 ${i < 3 ? 'bg-app-bg/60' : ''}`}>
              <div className={`relative shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ring-4 ${style.ring} ${style.badge}`}>
                {i < 3 ? i + 1 : initials(r.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink truncate">{r.name}</p>
                <div className="mt-1 h-1.5 rounded-pill bg-brand-50 overflow-hidden">
                  <div className="h-full rounded-pill bg-brand-500" style={{ width: `${Math.max(6, (r.amount / max) * 100)}%` }} />
                </div>
              </div>
              <span className="text-sm font-semibold text-ink shrink-0">{formatCurrency(r.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
