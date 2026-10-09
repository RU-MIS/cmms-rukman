'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId } from '@/lib/session';
import { useData } from '@/lib/useData';
import { dateTime } from '@/lib/format';
import { downloadRows, downloadTemplate, exportEntity, readSpreadsheet, type ImportEntity } from '@/lib/spreadsheet';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, Stat, Table, useAction } from '@/components/ui';

interface Job { id: string; entity: string; file_name: string; mode: string; update_existing: boolean; status: string;
  total_rows: number; valid_rows: number; invalid_rows: number; duplicate_rows: number; create_rows: number; update_rows: number;
  imported_rows: number; failed_rows: number; header_errors?: number; error: string | null; created_at: string; committed?: boolean; message?: string }
interface ImpError { row_no: number; column_key: string | null; value: string | null; message: string }

const CHUNK = 1000;

function ImportExport() {
  const companyId = useCompanyId();
  const initial = useSearchParams().get('entity');
  const entities = useData(() => rpc<ImportEntity[]>('import_entities', { p_company_id: companyId }), [companyId]);
  const jobs = useData(async () => must<Job[]>(await sb().from('import_jobs').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(20)), [companyId]);
  const [sel, setSel] = useState<string | null>(initial);
  const { busy, run } = useAction();
  const entity = entities.data?.find((e) => e.code === sel) ?? null;

  return (
    <div>
      <PageHeader title="Import / Export" subtitle="Excel (.xlsx) or CSV. Validate the whole file, preview, then confirm. Default: all-or-nothing." />
      <ErrorBox error={entities.error} />
      {!entities.data ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card title="Data">
            <ul className="-mx-2 space-y-0.5" aria-label="Import entities">
              {entities.data.map((e) => (
                <li key={e.code}>
                  <button onClick={() => setSel(e.code)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${sel === e.code ? 'bg-brand text-white' : 'hover:bg-slate-100'}`}>
                    <span>{e.label}</span>
                    <span className="text-xs opacity-80">{[e.can_import && 'import', e.can_export && 'export'].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>))}
              {entities.data.length === 0 && <li className="px-2 text-sm text-slate-500">You have no import or export permission.</li>}
            </ul>
          </Card>
          <div className="space-y-4">
            {entity ? <>
              <Card title={entity.label} actions={<>
                <Button variant="secondary" busy={busy} onClick={() => run(() => downloadTemplate(entity), 'Template downloaded')}>Download template</Button>
                {entity.can_export && <>
                  <Button variant="secondary" busy={busy} onClick={() => run(async () => { await exportEntity(companyId, entity.code, entity.label, 'xlsx'); }, 'Export ready')}>Export Excel</Button>
                  <Button variant="secondary" busy={busy} onClick={() => run(async () => { await exportEntity(companyId, entity.code, entity.label, 'csv'); }, 'Export ready')}>Export CSV</Button>
                </>}
              </>}>
                <p className="text-sm text-slate-600">{entity.help}</p>
                <p className="mt-1 text-xs text-slate-500">Columns: {entity.columns.map((c) => `${c.key}${c.required ? '*' : ''}`).join(', ')}.
                  Exports contain only the records and fields you are allowed to see.</p>
              </Card>
              {entity.can_import && <ImportWizard key={entity.code} entity={entity} onDone={() => jobs.reload()} />}
            </> : <Card><p className="text-slate-500">Choose what to import or export.</p></Card>}
            <Card title="Recent imports (yours)">
              <Table><thead><tr><th>When</th><th>Data</th><th>File</th><th>Mode</th><th>Status</th><th className="num">Rows</th><th className="num">Imported</th></tr></thead>
                <tbody>{(jobs.data ?? []).map((j) => (
                  <tr key={j.id}><td className="whitespace-nowrap">{dateTime(j.created_at)}</td><td>{j.entity}</td><td>{j.file_name}</td>
                    <td>{j.mode === 'VALID_ONLY' ? 'valid rows only' : 'all-or-nothing'}{j.update_existing ? ' · update' : ''}</td>
                    <td><Badge color={j.status === 'COMMITTED' ? 'green' : j.status === 'FAILED' ? 'red' : 'slate'}>{j.status}</Badge></td>
                    <td className="num">{j.total_rows}</td><td className="num">{j.imported_rows}</td></tr>))}
                  {jobs.data?.length === 0 && <tr><td colSpan={7} className="text-slate-500">No imports yet</td></tr>}</tbody></Table>
            </Card>
          </div>
        </div>)}
    </div>
  );
}

function ImportWizard({ entity, onDone }: { entity: ImportEntity; onDone: () => void }) {
  const companyId = useCompanyId();
  const { busy, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'ALL_OR_NOTHING' | 'VALID_ONLY'>('ALL_OR_NOTHING');
  const [update, setUpdate] = useState(false);
  const [progress, setProgress] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [errors, setErrors] = useState<ImpError[]>([]);
  const [raw, setRaw] = useState<{ row_no: number; data: Record<string, string> }[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Job | null>(null);

  const reset = () => { setJob(null); setErrors([]); setConfirm(false); setResult(null); setProgress(''); };
  const loadErrors = async (id: string) => setErrors(must<ImpError[]>(await sb().from('import_errors').select('row_no, column_key, value, message')
    .eq('job_id', id).order('row_no').order('id').limit(5000)));

  const validate = () => run(async () => {
    if (!file) throw new Error('Choose a file');
    reset();
    setProgress('Reading file…');
    const sheet = await readSpreadsheet(file, entity.columns);
    if (sheet.rows.length === 0) throw new Error('The file has no data rows');
    if (sheet.rows.length > 10000) throw new Error(`The file has ${sheet.rows.length} rows — at most 10,000 per file`);
    setRaw(sheet.rows);
    const created = await rpc<{ job_id: string; header_errors: number }>('import_create', { p_company_id: companyId, p_entity: entity.code,
      p_file_name: file.name, p_mode: mode, p_update_existing: update, p_columns: [...new Set(sheet.keys)] });
    for (let i = 0; i < sheet.rows.length; i += CHUNK) {
      setProgress(`Uploading rows ${i + 1}–${Math.min(i + CHUNK, sheet.rows.length)} of ${sheet.rows.length}…`);
      await rpc('import_add_rows', { p_job_id: created.job_id, p_rows: sheet.rows.slice(i, i + CHUNK) });
    }
    setProgress('Validating…');
    const v = await rpc<Job>('import_validate', { p_job_id: created.job_id });
    setJob(v); await loadErrors(v.id); setProgress('');
  }, 'Validation finished');

  const commit = () => run(async () => {
    if (!job) return;
    setProgress('Importing…');
    const r = await rpc<Job>('import_commit', { p_job_id: job.id, p_confirm: confirm });
    setResult(r); setProgress('');
    if (r.status !== 'COMMITTED') await loadErrors(job.id);
    onDone();
    if (!r.committed) throw new Error(r.message ?? 'Nothing was imported');
  }, 'Import finished');

  const errorReport = () => run(async () => {
    const byRow = new Map<number, string[]>();
    for (const e of errors) byRow.set(e.row_no, [...(byRow.get(e.row_no) ?? []), `${e.column_key ?? 'row'}: ${e.message}${e.value ? ` (${e.value})` : ''}`]);
    const cols = ['row', ...entity.columns.map((c) => c.key), 'errors'];
    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([rowNo, msgs]) => ({
      row: rowNo === 0 ? 'header' : rowNo, ...(raw.find((r) => r.row_no === rowNo)?.data ?? {}), errors: msgs.join(' | ') }));
    await downloadRows(`${entity.label}_errors`, cols, rows);
  }, 'Error report downloaded');

  const headerErrors = errors.filter((e) => e.row_no === 0);
  const canCommit = job && job.status === 'VALIDATED' && headerErrors.length === 0 && job.valid_rows > 0
    && (mode === 'VALID_ONLY' || job.invalid_rows === 0) && confirm && !result;

  return (
    <Card title={`Import ${entity.label.toLowerCase()}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm"><span className="field-label">File (.xlsx or .csv)</span>
            <input type="file" aria-label="Import file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} /></label>
          <fieldset className="text-sm">
            <legend className="field-label">Mode</legend>
            <label className="mr-4 inline-flex items-center gap-1"><input type="radio" name="mode" checked={mode === 'ALL_OR_NOTHING'}
              onChange={() => { setMode('ALL_OR_NOTHING'); reset(); }} />All or nothing (recommended)</label>
            <label className="inline-flex items-center gap-1"><input type="radio" name="mode" checked={mode === 'VALID_ONLY'}
              onChange={() => { setMode('VALID_ONLY'); reset(); }} />Import valid rows only</label>
          </fieldset>
          {entity.can_update && <label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={update}
            onChange={(e) => { setUpdate(e.target.checked); reset(); }} />Update existing records</label>}
          <Button busy={busy} disabled={!file} onClick={validate}>Validate file</Button>
        </div>
        {progress && <p className="text-sm text-slate-600" role="status">{progress}</p>}
        {job && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Rows" value={job.total_rows} />
              <Stat label="Valid" value={job.valid_rows} tone="green" />
              <Stat label="Invalid" value={job.invalid_rows} tone={job.invalid_rows ? 'red' : undefined} />
              <Stat label="Duplicates" value={job.duplicate_rows} tone={job.duplicate_rows ? 'amber' : undefined} />
              <Stat label="New" value={job.create_rows} />
              <Stat label="Updates" value={job.update_rows} />
            </div>
            {errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-700">Errors ({errors.length})</h3>
                  <Button variant="secondary" busy={busy} onClick={errorReport}>Download error report</Button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <Table><thead><tr><th className="num">Row</th><th>Column</th><th>Value</th><th>Reason</th></tr></thead>
                    <tbody>{errors.slice(0, 500).map((e, i) => (
                      <tr key={i}><td className="num">{e.row_no === 0 ? 'header' : e.row_no}</td><td>{e.column_key ?? '—'}</td>
                        <td className="max-w-[12rem] truncate">{e.value ?? ''}</td><td>{e.message}</td></tr>))}</tbody></Table>
                </div>
              </div>)}
            {!result && job.valid_rows > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                {mode === 'ALL_OR_NOTHING' && job.invalid_rows > 0
                  ? <p className="text-red-700">All-or-nothing: fix the {job.invalid_rows} invalid row(s) and validate again, or choose “Import valid rows only”.</p>
                  : <>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} aria-label="Confirm import" />
                      <span>I confirm: create {job.create_rows} and update {job.update_rows} record(s)
                        {mode === 'VALID_ONLY' && job.invalid_rows > 0 ? `; ${job.invalid_rows} invalid row(s) are skipped and change nothing` : ''}.</span>
                    </label>
                    <div className="mt-2"><Button busy={busy} disabled={!canCommit} onClick={commit}>Import now</Button></div>
                  </>}
              </div>)}
            {result && (
              <div role="status" className={`rounded-md p-3 text-sm ${result.status === 'COMMITTED' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {result.status === 'COMMITTED'
                  ? `Imported ${result.imported_rows} row(s)${result.failed_rows ? `, ${result.failed_rows} failed and were skipped` : ''}.`
                  : result.message ?? result.error ?? 'Nothing was imported.'}
              </div>)}
          </>)}
      </div>
    </Card>
  );
}

export default function Page() {
  return <Suspense><ImportExport /></Suspense>;
}
