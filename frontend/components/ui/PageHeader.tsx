import { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {description && <p className="text-sm text-ink-muted mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
