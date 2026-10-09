'use client';
// Spreadsheet helpers for the Import / Export Center.
// XLSX: read-excel-file / write-excel-file (MIT, small, no known vulnerabilities;
// chosen over exceljs and the npm "xlsx" package — see docs/PLATFORM_R2.md).
import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import { rpc } from './supabase';

export interface ImportColumn {
  key: string; label: string; type: 'text' | 'number' | 'integer' | 'date' | 'boolean' | 'enum' | 'email';
  required?: boolean; values?: string[]; example?: string; help?: string; min?: number; custom?: boolean;
}
export interface ImportEntity {
  code: string; label: string; help: string; key_columns: string[]; can_update: boolean;
  can_import: boolean; can_export: boolean; columns: ImportColumn[];
}

const today = () => new Date().toISOString().slice(0, 10);
const fileBase = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Header text of a column in templates: key + " *" when required. */
export const headerOf = (c: ImportColumn) => (c.required ? `${c.key} *` : c.key);

/** Template: "Data" sheet (headers + example row) and "Instructions" sheet. */
export async function downloadTemplate(e: ImportEntity) {
  const bold = { fontWeight: 'bold' as const };
  const data = [
    e.columns.map((c) => ({ value: headerOf(c), ...bold, backgroundColor: c.required ? '#FDE68A' : '#E2E8F0' })),
    e.columns.map((c) => (c.example ? { value: c.example } : null)),
  ];
  const instructions = [
    [{ value: `${e.label} — import template`, ...bold }],
    [{ value: e.help }],
    [{ value: 'Fill the "Data" sheet from row 2 (replace the example row). Columns marked * are required. Keep the header row unchanged; unknown columns are rejected.' }],
    [{ value: 'Import mode: ALL-OR-NOTHING by default — nothing is written if any row has an error. "Import valid rows only" must be chosen explicitly.' }],
    [],
    ['Column', 'Label', 'Required', 'Type', 'Allowed values', 'Notes'].map((v) => ({ value: v, ...bold })),
    ...e.columns.map((c) => [c.key, c.label, c.required ? 'yes' : 'no', c.type === 'enum' ? 'one of' : c.type,
      (c.values ?? []).join(', '), [c.help, c.custom ? 'custom field' : '', c.type === 'date' ? 'YYYY-MM-DD' : '', c.type === 'boolean' ? 'YES / NO' : '',
        c.min !== undefined ? `minimum ${c.min}` : ''].filter(Boolean).join('; ')].map((v) => ({ value: String(v) }))),
  ];
  await writeXlsxFile([
    { sheet: 'Data', data, columns: e.columns.map(() => ({ width: 18 })), stickyRowsCount: 1 },
    { sheet: 'Instructions', data: instructions, columns: [{ width: 22 }, { width: 30 }, { width: 10 }, { width: 10 }, { width: 40 }, { width: 50 }] },
  ]).toFile(`${fileBase(e.label)}_template.xlsx`);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'YES' : 'NO';
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Reads the first sheet ("Data" if present) of an XLSX file or a CSV file. */
export async function readSpreadsheet(file: File, columns: ImportColumn[]): Promise<{ headers: string[]; keys: string[]; rows: { row_no: number; data: Record<string, string> }[] }> {
  let grid: unknown[][];
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    grid = parseCsv((await file.text()).replace(/^﻿/, ''));
  } else {
    const sheets = await readXlsxFile(file);
    const s = sheets.find((x) => x.sheet === 'Data') ?? sheets[0];
    grid = (s?.data ?? []) as unknown[][];
  }
  if (grid.length === 0) throw new Error('The file is empty');
  const headers = grid[0].map((h) => cellText(h));
  const byLabel = new Map(columns.flatMap((c) => [[c.key.toLowerCase(), c.key], [c.label.toLowerCase(), c.key]]));
  // "code *" → code; labels are accepted too; unknown headers are kept (the server reports them)
  const keys = headers.map((h) => { const n = h.replace(/\s*\*\s*$/, '').trim().toLowerCase(); return byLabel.get(n) ?? n; });
  const rows = grid.slice(1).map((r, i) => {
    const data: Record<string, string> = {};
    keys.forEach((k, j) => { if (k) { const t = cellText(r[j]); if (t !== '') data[k] = t; } });
    return { row_no: i + 2, data };   // spreadsheet row number (header = row 1)
  }).filter((r) => Object.keys(r.data).length > 0);
  return { headers, keys: keys.filter(Boolean), rows };
}

/** Rows (objects) → XLSX or CSV download, columns in template order. */
export async function downloadRows(name: string, columns: string[], rows: Record<string, unknown>[], format: 'xlsx' | 'csv' = 'xlsx') {
  if (format === 'csv') {
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${fileBase(name)}_${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const data = [columns.map((c) => ({ value: c, fontWeight: 'bold' as const })),
    ...rows.map((r) => columns.map((c) => { const v = r[c]; return v === null || v === undefined || v === '' ? null
      : { value: typeof v === 'number' ? v : String(v), type: typeof v === 'number' ? Number : String }; }))];
  await writeXlsxFile(data as never, { columns: columns.map(() => ({ width: 18 })), stickyRowsCount: 1 }).toFile(`${fileBase(name)}_${today()}.xlsx`);
}

/** Server-side export (RLS, scopes, field rights apply), downloaded as XLSX / CSV. */
export async function exportEntity(companyId: string, entity: string, label: string, format: 'xlsx' | 'csv' = 'xlsx') {
  const [entities, rows] = await Promise.all([
    rpc<ImportEntity[]>('import_entities', { p_company_id: companyId }),
    rpc<Record<string, unknown>[]>('export_rows', { p_company_id: companyId, p_entity: entity }),
  ]);
  const e = entities.find((x) => x.code === entity);
  const cols = e ? e.columns.map((c) => c.key) : Object.keys(rows[0] ?? {});
  await downloadRows(label, cols, rows, format);
  return rows.length;
}
