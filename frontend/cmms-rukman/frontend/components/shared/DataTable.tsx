'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

// ── Types ─────────────────────────────────────────────────────────
export interface Column<T> {
  key:       keyof T | string;
  label:     string;
  render?:   (row: T) => React.ReactNode;
  sortable?: boolean;
  width?:    string;
}

interface DataTableProps<T> {
  data:          T[];
  columns:       Column<T>[];
  keyField:      keyof T;
  loading?:      boolean;
  searchable?:   boolean;
  searchPlaceholder?: string;
  pageSize?:     number;
  emptyMessage?: string;
  actions?:      (row: T) => React.ReactNode;
  onRowClick?:   (row: T) => void;
}

type SortDir = 'asc' | 'desc' | null;

// ── DataTable ─────────────────────────────────────────────────────
export default function DataTable<T extends Record<string, any>>({
  data, columns, keyField, loading = false,
  searchable = true, searchPlaceholder = 'Search...',
  pageSize = 15, emptyMessage = 'No records found',
  actions, onRowClick,
}: DataTableProps<T>) {

  const [search,  setSearch]  = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page,    setPage]    = useState(1);

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(row =>
      Object.values(row).some(val =>
        String(val ?? '').toLowerCase().includes(q)
      )
    );
  }, [data, search]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize);
  const paginated  = sorted.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc')  setSortDir('desc');
    else { setSortKey(null); setSortDir(null); }
    setPage(1);
  };

  const handleSearch = (val: string) => { setSearch(val); setPage(1); };

  // ── Skeleton rows ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="skeleton h-9 w-48 rounded-lg" />
        </div>
        <table className="table">
          <thead>
            <tr>{columns.map(c => <th key={String(c.key)}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map(c => (
                  <td key={String(c.key)}>
                    <div className="skeleton h-4 rounded w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">

      {/* Search bar */}
      {searchable && (
        <div className="p-4 border-b border-border">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="input pl-9 text-sm"
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper border-0 rounded-none">
        <table className="table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  style={{ width: col.width }}
                  className={clsx(col.sortable && 'cursor-pointer select-none hover:bg-primary-tint')}
                  onClick={() => col.sortable && handleSort(String(col.key))}
                >
                  <div className="flex items-center gap-1.5">
                    {col.label}
                    {col.sortable && (
                      <span className="flex flex-col">
                        <ChevronUp   className={clsx('w-2.5 h-2.5', sortKey === String(col.key) && sortDir === 'asc'  ? 'text-primary' : 'text-ink-muted/40')} />
                        <ChevronDown className={clsx('w-2.5 h-2.5 -mt-0.5', sortKey === String(col.key) && sortDir === 'desc' ? 'text-primary' : 'text-ink-muted/40')} />
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {actions && <th className="w-24 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="text-center py-12">
                  <div className="empty-state">
                    <p className="text-ink-muted text-sm">{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map(row => (
                <tr
                  key={String(row[keyField])}
                  onClick={() => onRowClick?.(row)}
                  className={clsx(onRowClick && 'cursor-pointer')}
                >
                  {columns.map(col => (
                    <td key={String(col.key)}>
                      {col.render ? col.render(row) : String(row[col.key as keyof T] ?? '—')}
                    </td>
                  ))}
                  {actions && (
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {actions(row)}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <p className="text-xs text-ink-muted">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-icon btn-ghost disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pg = page <= 3 ? i + 1 : page - 2 + i;
              if (pg < 1 || pg > totalPages) return null;
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={clsx(
                    'w-8 h-8 rounded-lg text-xs font-medium transition-colors',
                    pg === page
                      ? 'bg-primary text-white'
                      : 'text-ink-secondary hover:bg-primary-light'
                  )}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-icon btn-ghost disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
