'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar, Trash2, Pencil, Info } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const ALLOWED_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];
const HOLIDAY_TYPES = ['National', 'Festival', 'Regional', 'Company', 'Other'];

export default function HolidaysPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canManage = ALLOWED_ROLES.includes(user?.roleName || '');
  const [year, setYear] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({
    holidayName: '', holidayDate: '', holidayType: 'National',
    isRecurring: false, description: ''
  });

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api.get(`/holidays?year=${year}`).then(r => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/holidays', form),
    onSuccess: () => { toast.success('Holiday added!'); qc.invalidateQueries({ queryKey: ['holidays'] }); setShowAdd(false); resetForm(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.put(`/holidays/${editItem.holiday_id}`, form),
    onSuccess: () => { toast.success('Holiday updated!'); qc.invalidateQueries({ queryKey: ['holidays'] }); setEditItem(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => { toast.success('Holiday deleted!'); qc.invalidateQueries({ queryKey: ['holidays'] }); },
  });

  const resetForm = () => setForm({ holidayName: '', holidayDate: '', holidayType: 'National', isRecurring: false, description: '' });

  const openEdit = (h: any) => {
    setEditItem(h);
    setForm({
      holidayName: h.holiday_name, holidayDate: h.holiday_date?.split('T')[0],
      holidayType: h.holiday_type, isRecurring: h.is_recurring, description: h.description || ''
    });
  };

  const typeColors: Record<string, string> = {
    National: 'bg-blue-50 text-blue-700',
    Festival:  'bg-purple-50 text-purple-700',
    Regional:  'bg-green-50 text-green-700',
    Company:   'bg-[#EFF6FF] text-[#0E2F76]',
    Other:     'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Holidays</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{holidays.length} holidays in {year} · Sundays are always off</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="w-8 h-8 border border-[#D4E4F7] rounded-lg flex items-center justify-center text-[#7A9CC0] hover:border-[#AAC0E1]">‹</button>
            <span className="text-sm font-semibold text-[#0A1F4E] w-12 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="w-8 h-8 border border-[#D4E4F7] rounded-lg flex items-center justify-center text-[#7A9CC0] hover:border-[#AAC0E1]">›</button>
          </div>
          {canManage && (
            <button onClick={() => { setShowAdd(true); resetForm(); }}
              className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52]">
              <Plus className="w-4 h-4" /> Add holiday
            </button>
          )}
        </div>
      </div>

      {/* Sunday note */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Sunday is automatically off</p>
          <p className="text-xs text-blue-600 mt-0.5">No checklists will be generated on Sundays. Add other holidays below.</p>
        </div>
      </div>

      {/* Holiday list */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
              {['Date', 'Holiday name', 'Type', 'Recurring', canManage ? 'Actions' : ''].filter(Boolean).map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(4).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-[#D4E4F7]">
                  {Array(4).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : holidays.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-16 text-center">
                <Calendar className="w-10 h-10 text-[#AAC0E1] mx-auto mb-3" />
                <p className="text-sm font-semibold text-[#0A1F4E]">No holidays added for {year}</p>
                <p className="text-xs text-[#7A9CC0] mt-1">{canManage ? 'Click "Add holiday" to add.' : 'Contact admin to add holidays.'}</p>
              </td></tr>
            ) : (holidays as any[]).map((h, idx) => {
              const date = dayjs(h.holiday_date);
              const dayName = date.format('dddd');
              return (
                <tr key={h.holiday_id} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#0A1F4E]">{date.format('DD MMM YYYY')}</p>
                    <p className="text-xs text-[#7A9CC0]">{dayName}</p>
                  </td>
                  <td className="px-4 py-3 font-medium text-[#0A1F4E]">{h.holiday_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${typeColors[h.holiday_type] || 'bg-gray-100 text-gray-600'}`}>
                      {h.holiday_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {h.is_recurring
                      ? <span className="text-xs bg-green-50 text-green-700 font-medium px-2 py-0.5 rounded-full">Every year</span>
                      : <span className="text-xs text-[#7A9CC0]">Once</span>
                    }
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(h)}
                          className="text-xs text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button onClick={() => { if (confirm('Delete this holiday?')) deleteMutation.mutate(h.holiday_id); }}
                          className="text-xs text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {(showAdd || editItem) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
              <h2 className="text-base font-semibold text-[#0A1F4E]">{editItem ? 'Edit holiday' : 'Add holiday'}</h2>
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Holiday name *</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.holidayName} onChange={e => setForm(f => ({ ...f, holidayName: e.target.value }))}
                  placeholder="e.g. Republic Day, Diwali" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Date *</label>
                <input type="date" className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.holidayDate} onChange={e => setForm(f => ({ ...f, holidayDate: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Type</label>
                <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.holidayType} onChange={e => setForm(f => ({ ...f, holidayType: e.target.value }))}>
                  {HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Description</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional note" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="recurring" checked={form.isRecurring}
                  onChange={e => setForm(f => ({ ...f, isRecurring: e.target.checked }))}
                  className="w-4 h-4 accent-[#0E2F76]" />
                <label htmlFor="recurring" className="text-sm text-[#3A5A8A] cursor-pointer">
                  Repeat every year (recurring holiday)
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
              <button onClick={() => { setShowAdd(false); setEditItem(null); }}
                className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg">Cancel</button>
              <button onClick={() => editItem ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!form.holidayName || !form.holidayDate}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
                {editItem ? 'Update' : 'Add holiday'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
