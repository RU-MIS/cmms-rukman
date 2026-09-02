'use client';

import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';

const ENTITIES = [
  { key: 'customers', label: 'Customers' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'products', label: 'Products' },
  { key: 'opening-stock', label: 'Opening Stock' },
  { key: 'opening-balances', label: 'Opening Balances' },
];

export default function ExcelImportPage() {
  const [entity, setEntity] = useState(ENTITIES[0].key);
  const [preview, setPreview] = useState<{ valid: any[]; errors: any[]; totalRows: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPreview(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/excel/import/${entity}/preview`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(res.data.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleConfirmImport() {
    if (!preview || preview.valid.length === 0) return;
    setImporting(true);
    try {
      const res = await api.post(`/excel/import/${entity}/commit`, { rows: preview.valid });
      toast.success(`Imported ${res.data.data.imported} rows`);
      setPreview(null);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Excel Import" description="Upload a spreadsheet, review errors, then confirm the import" />

      <div className="card p-4 mb-4 max-w-lg space-y-3">
        <div>
          <label className="label">What are you importing?</label>
          <select className="input" value={entity} onChange={(e) => { setEntity(e.target.value); setPreview(null); }}>
            {ENTITIES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Excel File (.xlsx, .xls, .csv)</label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="input" />
        </div>
        {uploading && <p className="text-sm text-ink-muted">Validating file…</p>}
      </div>

      {preview && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="card p-3 flex items-center gap-2"><CheckCircle2 size={16} className="text-success" /><span className="text-sm">{preview.valid.length} valid rows</span></div>
            <div className="card p-3 flex items-center gap-2"><AlertCircle size={16} className="text-danger" /><span className="text-sm">{preview.errors.length} rows with errors</span></div>
          </div>

          {preview.errors.length > 0 && (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead><tr><th className="th">Row</th><th className="th">Error</th></tr></thead>
                <tbody>
                  {preview.errors.map((err, i) => (
                    <tr key={i}><td className="td">{err.row}</td><td className="td text-danger">{err.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.valid.length > 0 && (
            <div className="flex justify-end">
              <button className="btn-primary" disabled={importing} onClick={handleConfirmImport}>
                <UploadCloud size={15} /> Confirm Import ({preview.valid.length} rows)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
