import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info';
}

const TONE_STYLES: Record<string, { bg: string; icon: string; accent: string }> = {
  brand: { bg: 'bg-brand-50', icon: 'text-brand-600', accent: 'bg-brand-500' },
  success: { bg: 'bg-success-bg', icon: 'text-success', accent: 'bg-success' },
  warning: { bg: 'bg-warning-bg', icon: 'text-warning', accent: 'bg-warning' },
  danger: { bg: 'bg-danger-bg', icon: 'text-danger', accent: 'bg-danger' },
  info: { bg: 'bg-info-bg', icon: 'text-info', accent: 'bg-info' },
};

export function StatCard({ label, value, icon: Icon, tone = 'brand' }: StatCardProps) {
  const t = TONE_STYLES[tone];
  return (
    <div className="card relative overflow-hidden p-4 pl-5 flex items-center gap-3">
      <span className={`absolute inset-y-0 left-0 w-1.5 rounded-l-card ${t.accent}`} />
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${t.bg} ${t.icon}`}>
        <Icon size={20} strokeWidth={2.25} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-ink leading-tight truncate">{value}</p>
        <p className="text-xs text-ink-muted truncate">{label}</p>
      </div>
    </div>
  );
}
