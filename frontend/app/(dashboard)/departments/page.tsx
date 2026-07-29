'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, Pencil, X } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

export default function DepartmentsPage() {
  const { isRole } = useAuthStore();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ deptName: '', deptCode: '' });

  const canEdit = isRole(['Admin', 'MD', 'CEO', 'HR', 'MIS Executive']);

  const { data, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments?limit=50').then(r => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/departments', form),
    onSuccess: () => { toast.success('Department added!'); qc.invalidateQueries({ queryKey: ['departments'] }); setShowAdd(false); setForm({ deptName: '', deptCode: '' }); },
  });

  const updateMutation = useMutation({
    mutationFn: () => api.put(`/departments/${editItem.deptId}`, form),
    onSuccess: () => { toast.success('Department updated!'); qc.invalidateQueries({ queryKey: ['departments'] }); setEditItem(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/departments/${id}/toggle`),
    onSuccess: () => { toast.success('Status updated!'); qc.invalidateQueries({ queryKey: ['departments'] }); },
  });

  const openEdit = (dept: any) => {
    setEditItem(dept);
    setForm({ deptName: dept.deptName, deptCode: dept.deptCode });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Departments</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{(data || []).length} departments</p>
        </div>
        {canEdit && (
          <button onClick={() => { setShowAdd(true); setForm({ deptName: '', deptCode: '' }); }}
            className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52]">
            <Plus className="w-4 h-4" /> Add department
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
              {['Department name', 'Code', 'Status', canEdit ? 'Actions' : ''].filter(Boolean).map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-[#D4E4F7]">
                  {Array(3).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : (data || []).map((dept: any, idx: number) => (
              <tr key={dept.deptId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-[#0E2F76]" />
                    </div>
                    <span className="font-semibold text-[#0A1F4E]">{dept.deptName}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><span className="bg-[#EFF6FF] text-[#0E2F76] text-xs font-bold px-2.5 py-0.5 rounded-full">{dept.deptCode}</span></td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${dept.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {dept.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canEdit && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(dept)} className="text-xs text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button onClick={() => toggleMutation.mutate(dept.deptId)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border ${dept.isActive ? 'text-red-600 bg-red-50 border-red-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                        {dept.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {(showAdd || editItem) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
              <h2 className="text-base font-semibold text-[#0A1F4E]">{editItem ? 'Edit department' : 'Add department'}</h2>
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Department name *</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.deptName} onChange={e => setForm(f => ({ ...f, deptName: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Code *</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.deptCode} onChange={e => setForm(f => ({ ...f, deptCode: e.target.value.toUpperCase() }))} placeholder="e.g. QC, NPD" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg">Cancel</button>
              <button onClick={() => editItem ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!form.deptName || !form.deptCode}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
                {editItem ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
