import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info';
}

const TONE_STYLES: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
};

export function StatCard({ label, value, icon: Icon, tone = 'brand' }: StatCardProps) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${TONE_STYLES[tone]}`}>
        <Icon size={19} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold text-ink leading-tight truncate">{value}</p>
        <p className="text-xs text-ink-muted truncate">{label}</p>
      </div>
    </div>
  );
}
