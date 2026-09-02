'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, FileText, PlayCircle, CheckCircle2, XCircle } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { formatDate, formatNumber } from '@/lib/utils';

interface Plan { id: number; planNo: string; date: string; dueDate?: string; product: { name: string; unit: { shortName: string } }; plannedQty: string; completedQty: string; status: string }

export default function ProductionPlansPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [plannedQty, setPlannedQty] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const [completeFor, setCompleteFor] = useState<Plan | null>(null);
  const [completeQty, setCompleteQty] = useState('');
  const [completing, setCompleting] = useState(false);

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['production-plans'], queryFn: async () => (await api.get('/production/plans', { params: { pageSize: 50 } })).data });
  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data, enabled: createOpen });
  const { data: planDetail } = useQuery({
    queryKey: ['production-plan-detail', completeFor?.id],
    queryFn: async () => (await api.get(`/production/plans/${completeFor!.id}`)).data.data,
    enabled: !!completeFor,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !(Number(plannedQty) > 0)) return toast.error('Select a product and enter a valid quantity');
    setSaving(true);
    try {
      await api.post('/production/plans', { productId: Number(productId), plannedQty: Number(plannedQty), dueDate: dueDate || undefined });
      toast.success('Production plan created');
      setCreateOpen(false); setProductId(''); setPlannedQty(''); setDueDate('');
      qc.invalidateQueries({ queryKey: ['production-plans'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleStart(plan: Plan) {
    try {
      await api.post(`/production/plans/${plan.id}/start`);
      qc.invalidateQueries({ queryKey: ['production-plans'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }
  async function handleCancel(plan: Plan) {
    if (!confirm('Cancel this production plan?')) return;
    try {
      await api.post(`/production/plans/${plan.id}/cancel`);
      qc.invalidateQueries({ queryKey: ['production-plans'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!completeFor || !(Number(completeQty) > 0)) return;
    setCompleting(true);
    try {
      await api.post(`/production/plans/${completeFor.id}/complete`, { completedQty: Number(completeQty) });
      toast.success('Production recorded — finished goods stock updated, raw materials consumed');
      setCompleteFor(null); setCompleteQty('');
      qc.invalidateQueries({ queryKey: ['production-plans'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCompleting(false);
    }
  }

  const columns: Column<Plan>[] = [
    { key: 'planNo', header: 'Plan No' },
    { key: 'date', header: 'Date', render: (p) => formatDate(p.date) },
    { key: 'product', header: 'Product', render: (p) => p.product.name },
    { key: 'plannedQty', header: 'Planned', align: 'right', render: (p) => `${formatNumber(p.plannedQty)} ${p.product.unit.shortName}` },
    { key: 'completedQty', header: 'Completed', align: 'right', render: (p) => `${formatNumber(p.completedQty)} ${p.product.unit.shortName}` },
    { key: 'status', header: 'Status', render: (p) => <Badge status={p.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (p) => (
        <div className="flex justify-end gap-1">
          {p.status === 'PLANNED' && <button className="btn-ghost !px-2 !py-1" title="Start" onClick={() => handleStart(p)}><PlayCircle size={14} /></button>}
          {(p.status === 'PLANNED' || p.status === 'IN_PROGRESS' || p.status === 'PARTIALLY_COMPLETED') && (
            <button className="btn-ghost !px-2 !py-1 text-success" title="Complete" onClick={() => setCompleteFor(p)}><CheckCircle2 size={14} /></button>
          )}
          {p.status !== 'COMPLETED' && p.status !== 'CANCELLED' && <button className="btn-ghost !px-2 !py-1 text-danger" title="Cancel" onClick={() => handleCancel(p)}><XCircle size={14} /></button>}
          <button className="btn-ghost !px-2 !py-1" title="PDF" onClick={() => openFile(`/documents/production-plan/${p.id}`)}><FileText size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Production Plans" description="Plan, start and complete production runs — BOM consumption is automatic"
        actions={<button className="btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Production Plan</button>} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Production Plan" width="max-w-md">
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="label">Finished Product *</label>
            <select className="input" required value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select product</option>
              {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="label">Planned Quantity *</label><input type="number" step="0.001" className="input" required value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} /></div>
          <div><label className="label">Due Date</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">Create Plan</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!completeFor} onClose={() => setCompleteFor(null)} title={`Complete Production — ${completeFor?.planNo ?? ''}`} width="max-w-lg">
        {planDetail && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Raw material requirement for the quantity you enter below:</p>
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead><tr><th className="th">Component</th><th className="th text-right">Available</th></tr></thead>
                <tbody>
                  {planDetail.requirement.map((r: any) => (
                    <tr key={r.componentId}>
                      <td className="td">{r.name}</td>
                      <td className="td text-right">{formatNumber(r.available)} {r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form onSubmit={handleComplete} className="space-y-3">
              <div><label className="label">Quantity to Complete Now *</label><input type="number" step="0.001" className="input" required value={completeQty} onChange={(e) => setCompleteQty(e.target.value)} /></div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setCompleteFor(null)}>Cancel</button>
                <button type="submit" disabled={completing} className="btn-primary">Confirm Completion</button>
              </div>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}
