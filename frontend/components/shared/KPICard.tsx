import { clsx } from 'clsx';
import { LucideIcon } from 'lucide-react';

interface KPICardProps {
  label:      string;
  value:      string | number;
  sub?:       string;
  icon?:      LucideIcon;
  trend?:     'up' | 'down' | 'neutral';
  variant?:   'default' | 'success' | 'warning' | 'danger' | 'primary';
  loading?:   boolean;
}

const VARIANT_STYLES = {
  default: { icon: 'bg-primary-tint text-primary', value: 'text-ink' },
  success: { icon: 'bg-success-light text-success', value: 'text-success' },
  warning: { icon: 'bg-warning-light text-warning', value: 'text-warning' },
  danger:  { icon: 'bg-danger-light text-danger',   value: 'text-danger'  },
  primary: { icon: 'bg-primary text-white',          value: 'text-primary' },
};

export default function KPICard({
  label, value, sub, icon: Icon,
  trend = 'neutral', variant = 'default', loading = false,
}: KPICardProps) {
  const styles = VARIANT_STYLES[variant];

  if (loading) {
    return (
      <div className="kpi-card">
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton h-8 w-16 rounded mt-1" />
        <div className="skeleton h-3 w-20 rounded" />
      </div>
    );
  }

  return (
    <div className="kpi-card group hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <p className="kpi-label">{label}</p>
        {Icon && (
          <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', styles.icon)}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <p className={clsx('kpi-value', styles.value)}>{value}</p>

      {sub && (
        <p className={clsx('kpi-sub', {
          'text-success': trend === 'up',
          'text-danger':  trend === 'down',
          'text-ink-muted': trend === 'neutral',
        })}>
          {trend === 'up' && '↑ '}
          {trend === 'down' && '↓ '}
          {sub}
        </p>
      )}
    </div>
  );
}
