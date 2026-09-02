const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-success-bg text-success',
  COMPLETED: 'bg-success-bg text-success',
  PAID: 'bg-success-bg text-success',
  ACTIVE: 'bg-success-bg text-success',
  SENT: 'bg-success-bg text-success',
  PENDING: 'bg-warning-bg text-warning',
  PLANNED: 'bg-info-bg text-info',
  PARTIAL: 'bg-warning-bg text-warning',
  PARTIALLY_COMPLETED: 'bg-warning-bg text-warning',
  IN_PROGRESS: 'bg-info-bg text-info',
  OVERDUE: 'bg-danger-bg text-danger',
  CANCELLED: 'bg-danger-bg text-danger',
  FAILED: 'bg-danger-bg text-danger',
  INACTIVE: 'bg-ink-faint/20 text-ink-muted',
  LOW_STOCK: 'bg-warning-bg text-warning',
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-brand-50 text-brand-700';
  return <span className={`badge ${style}`}>{label ?? status.replace(/_/g, ' ')}</span>;
}
