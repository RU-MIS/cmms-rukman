'use client';
import type { ReactNode } from 'react';
import { Button } from './ui';

export const PAGE_SIZE = 50;
export interface Sort { col: string; asc: boolean }

/** Column header that sorts on the server. */
export function SortTh({ col, sort, onSort, children, className = '' }: { col: string; sort: Sort; onSort: (s: Sort) => void; children: ReactNode; className?: string }) {
  const active = sort.col === col;
  return (
    <th className={className} aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 font-semibold" onClick={() => onSort({ col, asc: active ? !sort.asc : true })}>
        {children}<span className="text-xs text-slate-400">{active ? (sort.asc ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

/** Pages of PAGE_SIZE rows (range queries: at most PAGE_SIZE rows are transferred). */
export function Pager({ page, total, onPage }: { page: number; total: number | null; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-slate-500" data-testid="list-total">{total ?? '…'} record(s) · page {page + 1} of {pages}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** Escapes a search term for a PostgREST `or=(...ilike...)` filter. */
export function ilikeTerm(q: string): string {
  return `%${q.trim().replace(/[%_,()*\\]/g, (c) => (c === ',' || c === '(' || c === ')' ? ' ' : `\\${c}`))}%`;
}
