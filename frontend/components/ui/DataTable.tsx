'use client';

import { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  keyField?: keyof T;
  onRowClick?: (row: T) => void;
}

const ALIGN_CLASS: Record<string, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  loading,
  emptyMessage = 'No records found',
  keyField = 'id' as keyof T,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`th ${ALIGN_CLASS[col.align ?? 'left']} ${col.className ?? ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="td text-center text-ink-muted py-8">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="td text-center text-ink-faint py-8">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={String(row[keyField])}
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? 'cursor-pointer hover:bg-brand-50/50' : ''}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`td ${ALIGN_CLASS[col.align ?? 'left']} ${col.className ?? ''}`}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
