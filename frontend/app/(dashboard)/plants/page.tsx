'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Factory, Pencil, Trash2, MapPin } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];

export default function PlantsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canManage = ADMIN_ROLES.includes(user?.roleName || '');
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ plantNo: '', plantName: '', address: '' });

  const { data: plants = [], isLoading } = useQuery({
    queryKey: ['plants'],
    queryFn: () => api.get('/plants').then(r => r.data.data || []),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/plants', { ...form, plantNo: Number(form.plantNo) }),
    onSuccess: () => {
      toast.success('Plant added!');
      qc.invalidateQueries({ queryKey: ['plants'] });
      setShowAdd(false); setForm({ plantNo: '', plantName: '', address: '' });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.put(`/plants/${editItem.plant_id}`, form),
    onSuccess: () => {
      toast.success('Plant updated!');
      qc.invalidateQueries({ queryKey: ['plants'] });
      setEditItem(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/plants/${id}`),
    onSuccess: () => { toast.success('Plant deleted!'); qc.invalidateQueries({ queryKey: ['plants'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Cannot delete — employees/machines assigned'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/plants/${id}/toggle`),
    onSuccess: () => { toast.success('Status updated!'); qc.invalidateQueries({ queryKey: ['plants'] }); },
  });

  const openEdit = (plant: any) => {
    setEditItem(plant);
    setForm({ plantNo: plant.plant_no, plantName: plant.plant_name, address: plant.address || '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Plants</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{(plants as any[]).length} plants</p>
        </div>
        {canManage && (
          <button onClick={() => { setShowAdd(true); setForm({ plantNo: '', plantName: '', address: '' }); }}
            className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52]">
            <Plus className="w-4 h-4" /> Add plant
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i} className="bg-white border border-[#D4E4F7] rounded-xl p-4 animate-pulse">
              <div className="h-5 bg-[#D4E4F7] rounded w-1/3 mb-2" />
              <div className="h-4 bg-[#D4E4F7] rounded w-2/3" />
            </div>
          ))
        ) : (plants as any[]).map((plant: any) => (
          <div key={plant.plant_id} className="bg-white border border-[#D4E4F7] rounded-xl p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-[#EFF6FF] rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-[#0E2F76] font-bold text-lg">{plant.plant_no}</span>
                </div>
                <div>
                  <p className="font-semibold text-[#0A1F4E]">{plant.plant_name}</p>
                  {plant.address && (
                    <p className="flex items-center gap-1 text-xs text-[#7A9CC0] mt-1">
                      <MapPin className="w-3 h-3" /> {plant.address}
                    </p>
                  )}
                  <span className={`inline-block mt-2 text-xs font-semibold px-2.5 py-0.5 rounded-full ${plant.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {plant.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {canManage && (
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(plant)}
                    className="flex items-center gap-1 text-xs text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-2.5 py-1.5 rounded-lg">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => toggleMutation.mutate(plant.plant_id)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border ${plant.is_active ? 'text-orange-600 bg-orange-50 border-orange-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                    {plant.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => { if (confirm(`Delete ${plant.plant_name}?`)) deleteMutation.mutate(plant.plant_id); }}
                    className="flex items-center gap-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-lg">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {(showAdd || editItem) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
              <h2 className="text-base font-semibold text-[#0A1F4E]">{editItem ? 'Edit plant' : 'Add plant'}</h2>
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="text-[#7A9CC0] text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              {!editItem && (
                <div>
                  <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Plant No. *</label>
                  <input type="number" min="1"
                    className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                    value={form.plantNo} onChange={e => setForm(f => ({ ...f, plantNo: e.target.value }))}
                    placeholder="e.g. 6" />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Plant Name *</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.plantName} onChange={e => setForm(f => ({ ...f, plantName: e.target.value }))}
                  placeholder="e.g. Plant No.6" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Address</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. Mundka Gali No. X" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="px-4 py-2 text-sm text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg">Cancel</button>
              <button
                onClick={() => editItem ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!form.plantName || (!editItem && !form.plantNo)}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
                {editItem ? 'Update' : 'Add plant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
