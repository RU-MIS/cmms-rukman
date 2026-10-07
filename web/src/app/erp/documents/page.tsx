'use client';
import { useState } from 'react';
import { must, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useParties } from '@/lib/masters';
import { dateTime, label } from '@/lib/format';
import { CATEGORIES, DocumentsPanel, downloadFile } from '@/components/Documents';
import { Badge, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, useToast } from '@/components/ui';

const LINKS: Record<string, string> = { purchase_order: '/erp/purchase-orders/?id=', sales_order: '/erp/sales-orders/?id=', customer_po: '/erp/customer-pos/?id=' };

export default function DocumentsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [party, setParty] = useState('');
  const parties = useParties(companyId);
  const docs = useData(async () => {
    let q = sb().from('documents').select('*, parties(name)').eq('company_id', companyId).eq('is_deleted', false)
      .order('uploaded_at', { ascending: false }).limit(300);
    if (category) q = q.eq('category', category);
    return must<{ id: string; file_name: string; category: string; entity_type: string; entity_id: string; storage_path: string;
      visible_to_party: boolean; uploaded_at: string; uploaded_via: string; parties: { name: string } | null }[]>(await q);
  }, [companyId, category]);
  const rows = (docs.data ?? []).filter((d) => !search || `${d.file_name} ${d.parties?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-4">
      <PageHeader title="Documents" subtitle="PO, invoice, purchase, delivery and payment documents — stored privately, shared with a customer / vendor only when marked" />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="File or party" /></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All" options={CATEGORIES} /></Field>
      </div>
      <ErrorBox error={docs.error} />
      {!docs.data ? (docs.error ? null : <Spinner />) : (
        <Table><thead><tr><th>File</th><th>Category</th><th>Attached to</th><th>Party</th><th>Portal</th><th>Uploaded</th></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}><td><button className="text-brand hover:underline" onClick={() => downloadFile(d.storage_path, d.file_name).catch(toast.fail)}>{d.file_name}</button></td>
              <td>{label(d.category)}</td>
              <td>{LINKS[d.entity_type] ? <a className="text-brand hover:underline" href={LINKS[d.entity_type] + d.entity_id}>{label(d.entity_type)}</a> : label(d.entity_type)}</td>
              <td>{d.parties?.name}</td><td><Badge color={d.visible_to_party ? 'green' : 'slate'}>{d.visible_to_party ? 'Shared' : 'Internal'}</Badge></td>
              <td>{dateTime(d.uploaded_at)}{d.uploaded_via === 'PORTAL' && ' (portal)'}</td></tr>))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-slate-500">No documents</td></tr>}</tbody></Table>
      )}
      {can('documents.create') && (
        <Card title="Upload a customer / vendor document">
          <Field label="Customer or vendor" className="mb-3 max-w-md"><Select value={party} onChange={(e) => setParty(e.target.value)} placeholder="Choose"
            options={(parties.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Field>
          {party && <DocumentsPanel key={party} companyId={companyId} entityType="party" entityId={party} title="Documents of this party" />}
          <p className="mt-2 text-xs text-slate-500">Documents of a specific PO, invoice, order or payment are uploaded from that record.</p>
        </Card>
      )}
    </div>
  );
}
