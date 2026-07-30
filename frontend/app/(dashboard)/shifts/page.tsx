'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Clock, Pencil } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];

export default function ShiftsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canManage = ADMIN_ROLES.includes(user?.roleName || '');
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ shiftName: '', startTime: '', endTime: '' });

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts-page'],
    queryFn: () => api.get('/shifts').then(r => r.data.data || []),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/shifts', form),
    onSuccess: () => {
      toast.success('Shift added!');
      qc.invalidateQueries({ queryKey: ['shifts-page'] });
      qc.invalidateQueries({ queryKey: ['shifts-dropdown'] });
      setShowAdd(false); setForm({ shiftName: '', startTime: '', endTime: '' });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.put(`/shifts/${editItem.shift_id}`, form),
    onSuccess: () => {
      toast.success('Shift updated!');
      qc.invalidateQueries({ queryKey: ['shifts-page'] });
      qc.invalidateQueries({ queryKey: ['shifts-dropdown'] });
      setEditItem(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/shifts/${id}/toggle`),
    onSuccess: () => { toast.success('Status updated!'); qc.invalidateQueries({ queryKey: ['shifts-page'] }); },
  });

  const openEdit = (shift: any) => {
    setEditItem(shift);
    setForm({
      shiftName: shift.shift_name,
      startTime: shift.start_time?.slice(0, 5) || '',
      endTime: shift.end_time?.slice(0, 5) || '',
    });
  };

  const formatTime = (t: string) => {
    if (!t) return '—';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Shifts</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{(shifts as any[]).length} shifts</p>
        </div>
        {canManage && (
          <button onClick={() => { setShowAdd(true); setForm({ shiftName: '', startTime: '', endTime: '' }); }}
            className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52]">
            <Plus className="w-4 h-4" /> Add shift
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
              {['Shift name', 'Start time', 'End time', 'Status', canManage ? 'Actions' : ''].filter(Boolean).map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(3).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-[#D4E4F7]">
                  {Array(4).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : (shifts as any[]).map((shift: any, idx: number) => (
              <tr key={shift.shift_id} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
                      <Clock className="w-4 h-4 text-[#0E2F76]" />
                    </div>
                    <span className="font-semibold text-[#0A1F4E]">{shift.shift_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[#3A5A8A]">{formatTime(shift.start_time)}</td>
                <td className="px-4 py-3 text-[#3A5A8A]">{formatTime(shift.end_time)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${shift.is_active !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {shift.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(shift)}
                        className="text-xs text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button onClick={() => toggleMutation.mutate(shift.shift_id)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border ${shift.is_active !== false ? 'text-red-600 bg-red-50 border-red-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                        {shift.is_active !== false ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showAdd || editItem) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
              <h2 className="text-base font-semibold text-[#0A1F4E]">{editItem ? 'Edit shift' : 'Add shift'}</h2>
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="text-[#7A9CC0] text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Shift name *</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.shiftName} onChange={e => setForm(f => ({ ...f, shiftName: e.target.value }))}
                  placeholder="e.g. Night Shift" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Start time *</label>
                  <input type="time" className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                    value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">End time *</label>
                  <input type="time" className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                    value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="px-4 py-2 text-sm text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg">Cancel</button>
              <button onClick={() => editItem ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!form.shiftName.trim() || !form.startTime || !form.endTime}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
                {editItem ? 'Update' : 'Add shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
