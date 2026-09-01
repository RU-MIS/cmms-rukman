'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, pageSize, onPageChange }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-3 py-2.5 text-sm text-ink-muted border-t border-card-border">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost !px-2 !py-1" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={16} />
        </button>
        <span className="px-2">
          Page {page} of {totalPages}
        </span>
        <button className="btn-ghost !px-2 !py-1" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
