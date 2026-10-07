'use client';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { date } from '@/lib/format';
import { downloadFile } from './Documents';
import { ErrorBox, Spinner, Table, useToast } from './ui';

/** Documents shared with the portal party (visible_to_party). */
export function MyDocumentsList({ companyId, kind }: { companyId: string; kind: 'CUSTOMER' | 'VENDOR' }) {
  const toast = useToast();
  const docs = useData(() => rpc<{ id: string; file_name: string; category: string; storage_path: string; uploaded_at: string }[]>('portal_documents', { p_company_id: companyId, p_kind: kind }), [companyId, kind]);
  if (!docs.data) return docs.error ? <ErrorBox error={docs.error} /> : <Spinner />;
  return (
    <Table><thead><tr><th>File</th><th>Type</th><th>Date</th></tr></thead>
      <tbody>{docs.data.map((d) => (<tr key={d.id}><td><button className="text-brand hover:underline" onClick={() => downloadFile(d.storage_path, d.file_name).catch(toast.fail)}>{d.file_name}</button></td>
        <td>{d.category.replace(/_/g, ' ')}</td><td>{date(d.uploaded_at)}</td></tr>))}
        {docs.data.length === 0 && <tr><td colSpan={3} className="text-slate-500">No documents shared with you</td></tr>}</tbody></Table>
  );
}
