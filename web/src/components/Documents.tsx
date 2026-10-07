'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { useSession } from '@/lib/session';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Field, Select, Table, Toggle, useAction, useToast } from './ui';

export type EntityType = 'purchase_order' | 'purchase_receipt' | 'customer_bill' | 'sales_order' | 'customer_po' | 'dispatch' | 'voucher' | 'party';
export const CATEGORIES = [
  { value: 'PO_PDF', label: 'PO PDF' }, { value: 'INVOICE', label: 'Invoice (Tally PDF)' },
  { value: 'PURCHASE_DOCUMENT', label: 'Purchase document' }, { value: 'DELIVERY_DOCUMENT', label: 'Delivery document' },
  { value: 'PAYMENT_DOCUMENT', label: 'Payment document' }, { value: 'OTHER', label: 'Other' },
];

interface Doc { id: string; file_name: string; category: string; storage_path: string; visible_to_party: boolean; uploaded_at: string;
  size_bytes: number | null; uploaded_via: string }

export function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
}

/** Uploads a file into the company folder and registers it (emails are queued by the server per settings). */
export async function uploadDocument(companyId: string, entityType: EntityType, entityId: string, file: File,
  opts: { category: string; visible: boolean; sendEmail: boolean }) {
  const path = `${companyId}/${entityType}/${crypto.randomUUID()}-${safeName(file.name)}`;
  must(await sb().storage.from('documents').upload(path, file, { contentType: file.type || undefined }));
  return rpc<{ document_id: string; email_id: string | null; email_status: string | null }>('document_register', { p_payload: {
    company_id: companyId, entity_type: entityType, entity_id: entityId, category: opts.category, storage_path: path,
    file_name: file.name, mime_type: file.type || null, size_bytes: file.size, visible_to_party: opts.visible, send_email: opts.sendEmail } });
}

export async function downloadFile(path: string, name: string) {
  const blob = must<Blob>(await sb().storage.from('documents').download(path));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function DocumentsPanel({ companyId, entityType, entityId, defaultCategory = 'OTHER', title = 'Documents' }: {
  companyId: string; entityType: EntityType; entityId: string; defaultCategory?: string; title?: string }) {
  const { can } = useSession();
  const toast = useToast();
  const { busy, run } = useAction();
  const [category, setCategory] = useState(defaultCategory);
  const [visible, setVisible] = useState(defaultCategory === 'INVOICE' || defaultCategory === 'PO_PDF');
  const [sendEmail, setSendEmail] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const docs = useData(async () => must<Doc[]>(await sb().from('documents').select('*').eq('entity_type', entityType)
    .eq('entity_id', entityId).eq('is_deleted', false).order('uploaded_at', { ascending: false })), [entityType, entityId]);

  const upload = () => run(async () => {
    if (!file) throw new Error('Choose a file');
    const r = await uploadDocument(companyId, entityType, entityId, file, { category, visible, sendEmail });
    setFile(null);
    docs.reload();
    toast.ok(r.email_id ? `Uploaded. Email ${r.email_status === 'FAILED' ? 'could not be queued (see Email log)' : 'queued'}.` : 'Uploaded (no email — off in settings or not requested)');
  });

  return (
    <Card title={title}>
      <Table className="mb-3"><thead><tr><th>File</th><th>Category</th><th>Portal</th><th>Uploaded</th><th /></tr></thead>
        <tbody>{(docs.data ?? []).map((d) => (
          <tr key={d.id}>
            <td><button className="text-brand hover:underline" onClick={() => downloadFile(d.storage_path, d.file_name).catch(toast.fail)}>{d.file_name}</button>
              {d.uploaded_via === 'PORTAL' && <span className="ml-1 text-xs text-slate-500">(by customer)</span>}</td>
            <td>{d.category.replace(/_/g, ' ')}</td>
            <td>{can('documents.edit')
              ? <button className="text-xs" onClick={() => run(async () => { await rpc('document_set_visibility', { p_document_id: d.id, p_visible: !d.visible_to_party }); docs.reload(); })}>
                  <Badge color={d.visible_to_party ? 'green' : 'slate'}>{d.visible_to_party ? 'Shared' : 'Internal'}</Badge></button>
              : <Badge color={d.visible_to_party ? 'green' : 'slate'}>{d.visible_to_party ? 'Shared' : 'Internal'}</Badge>}</td>
            <td>{dateTime(d.uploaded_at)}</td>
            <td>{can('documents.delete') && <Button variant="ghost" onClick={() => {
              if (confirm(`Remove ${d.file_name}?`)) run(async () => { await rpc('document_delete', { p_document_id: d.id }); docs.reload(); }, 'Removed');
            }}>Remove</Button>}</td>
          </tr>))}
          {docs.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No documents yet</td></tr>}</tbody></Table>
      {can('documents.create') && (
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1.5fr_1fr_auto]">
          <Field label="File"><input aria-label="File" type="file" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES} /></Field>
          <Button busy={busy} onClick={upload}>Upload</Button>
          <div className="md:col-span-3 grid gap-x-6 md:grid-cols-2">
            <Toggle label="Visible in customer / vendor portal" checked={visible} onChange={setVisible} />
            <Toggle label="Send email automatically (if enabled in Settings → Email)" checked={sendEmail} onChange={setSendEmail} />
          </div>
        </div>
      )}
    </Card>
  );
}
