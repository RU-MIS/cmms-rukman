'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Wrench, ArrowLeftRight, Eye, Filter, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDate, getStatusColor } from '@/lib/utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

// ── Types ─────────────────────────────────────────────────────────
interface Machine {
  machineId: string; machineName: string; machineCode: string;
  deptName: string; machineType: string; status: string;
  location: string; isActive: boolean; installDate: string;
  currentOperator: { userId: string; fullName: string; employeeCode: string; assignedDate: string } | null;
}
interface User { userId: string; fullName: string; employeeCode: string; deptName: string; }

// ── Status badge ──────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Active:             'bg-green-50 text-green-700',
    'Under Maintenance':'bg-amber-50 text-amber-700',
    Inactive:           'bg-gray-100 text-gray-600',
  };
  const dots: Record<string, string> = {
    Active: 'bg-green-500', 'Under Maintenance': 'bg-amber-500', Inactive: 'bg-gray-400',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status] || 'bg-gray-400'}`} />
      {status}
    </span>
  );
}

// ── Add Machine Modal ─────────────────────────────────────────────
function AddMachineModal({ onClose, departments }: { onClose: () => void; departments: any[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    machineName: '', machineCode: '', deptId: '', machineType: '',
    manufacturer: '', location: '', installDate: '',
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/machines', form),
    onSuccess: () => {
      toast.success('Machine added successfully!');
      qc.invalidateQueries({ queryKey: ['machines'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-lg shadow-xl animate-slideUp">
        <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
          <h2 className="text-base font-semibold text-[#0A1F4E]">Add new machine</h2>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Machine name *</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]"
                value={form.machineName} onChange={e => setForm(f => ({ ...f, machineName: e.target.value }))} placeholder="Blow Mould #1" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Machine code *</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]"
                value={form.machineCode} onChange={e => setForm(f => ({ ...f, machineCode: e.target.value }))} placeholder="BLW-M-001" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Department *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.deptId} onChange={e => setForm(f => ({ ...f, deptId: e.target.value }))}>
                <option value="">Select department</option>
                {departments.map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Machine type</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.machineType} onChange={e => setForm(f => ({ ...f, machineType: e.target.value }))} placeholder="Blow Moulding" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Location</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Plant A, Bay 2" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Install date</label>
              <input type="date" className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.installDate} onChange={e => setForm(f => ({ ...f, installDate: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7] transition-colors">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.machineName || !form.machineCode || !form.deptId}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50 transition-colors">
            {mutation.isPending ? 'Saving...' : 'Add machine'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Handover Modal ────────────────────────────────────────────────
function HandoverModal({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const qc = useQueryClient();
  const [newUserId, setNewUserId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users?limit=100').then(r => r.data.data),
  });

  const mutation = useMutation({
    mutationFn: () => api.post(`/machines/${machine.machineId}/handover`, { newUserId, handoverNotes: notes }),
    onSuccess: () => {
      toast.success('Operator handover completed!');
      qc.invalidateQueries({ queryKey: ['machines'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-md shadow-xl animate-slideUp">
        <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
          <div>
            <h2 className="text-base font-semibold text-[#0A1F4E]">Operator handover</h2>
            <p className="text-xs text-[#7A9CC0] mt-0.5">{machine.machineName} — {machine.machineCode}</p>
          </div>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Current operator */}
          <div className="bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg p-3">
            <p className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide mb-1">Current operator</p>
            {machine.currentOperator ? (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-[#0E2F76] rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-bold">
                    {machine.currentOperator.fullName.split(' ').map(n => n[0]).join('').slice(0,2)}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0A1F4E]">{machine.currentOperator.fullName}</p>
                  <p className="text-xs text-[#7A9CC0]">Since {formatDate(machine.currentOperator.assignedDate)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#7A9CC0]">No operator assigned</p>
            )}
          </div>

          {/* New operator */}
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">New operator *</label>
            <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
              value={newUserId} onChange={e => setNewUserId(e.target.value)}>
              <option value="">Select new operator</option>
              {(usersData || []).filter((u: User) => u.userId !== machine.currentOperator?.userId).map((u: User) => (
                <option key={u.userId} value={u.userId}>{u.fullName} ({u.employeeCode})</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Handover notes</label>
            <textarea className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 resize-none h-20"
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes about this handover..." />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            ⚠️ Pending tasks will be reassigned to the new operator. Completed tasks will remain under the previous operator's record.
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7]">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !newUserId}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
            {mutation.isPending ? 'Processing...' : 'Confirm handover'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function MachinesPage() {
  const { isRole } = useAuthStore();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [handoverMachine, setHandoverMachine] = useState<Machine | null>(null);
  const qc = useQueryClient();

  const { data: machinesData, isLoading } = useQuery({
    queryKey: ['machines', search, deptFilter, statusFilter],
    queryFn: () => api.get('/machines', { params: { search, deptId: deptFilter, status: statusFilter, limit: 50 } }).then(r => r.data),
    staleTime: 30000,
  });

  const { data: deptsData } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.get('/departments?limit=20').then(r => r.data.data),
  });

  const machines: Machine[] = machinesData?.data || [];
  const departments = deptsData || [];

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/machines/${id}/status`, { status }),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['machines'] }); },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Machines</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{machines.length} machines total</p>
        </div>
        {isRole(['Admin']) && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52] transition-colors">
            <Plus className="w-4 h-4" /> Add machine
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A9CC0]" />
            <input className="w-full border border-[#AAC0E1] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]"
              placeholder="Search machines..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[160px]"
            value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
          </select>
          <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[140px]"
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All status</option>
            <option value="Active">Active</option>
            <option value="Under Maintenance">Under Maintenance</option>
            <option value="Inactive">Inactive</option>
          </select>
          <button onClick={() => { setSearch(''); setDeptFilter(''); setStatusFilter(''); }}
            className="flex items-center gap-1.5 text-sm text-[#7A9CC0] hover:text-[#0E2F76] px-3 py-2 border border-[#D4E4F7] rounded-lg hover:border-[#AAC0E1] transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">Machine</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">Department</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">Current operator</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-[#D4E4F7]">
                    {Array(6).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-[#D4E4F7] rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : machines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <Wrench className="w-10 h-10 text-[#AAC0E1] mx-auto mb-3" />
                    <p className="text-sm font-semibold text-[#0A1F4E]">No machines found</p>
                    <p className="text-xs text-[#7A9CC0] mt-1">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : machines.map((m, idx) => (
                <tr key={m.machineId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] transition-colors ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                        <Wrench className="w-4 h-4 text-[#0E2F76]" />
                      </div>
                      <div>
                        <p className="font-semibold text-[#0A1F4E]">{m.machineName}</p>
                        <p className="text-xs text-[#7A9CC0]">{m.machineCode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#3A5A8A]">{m.deptName}</td>
                  <td className="px-4 py-3 text-[#3A5A8A]">{m.location || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-3">
                    {m.currentOperator ? (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-[#0E2F76] rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">
                            {m.currentOperator.fullName.split(' ').map(n => n[0]).join('').slice(0,2)}
                          </span>
                        </div>
                        <span className="text-sm text-[#0A1F4E]">{m.currentOperator.fullName}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#7A9CC0]">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isRole(['Admin', 'Supervisor']) && (
                        <button onClick={() => setHandoverMachine(m)}
                          className="flex items-center gap-1.5 text-xs font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] px-2.5 py-1.5 rounded-lg transition-colors">
                          <ArrowLeftRight className="w-3.5 h-3.5" /> Handover
                        </button>
                      )}
                      {isRole(['Admin', 'Supervisor']) && (
                        <select
                          value={m.status}
                          onChange={e => statusMutation.mutate({ id: m.machineId, status: e.target.value })}
                          className="text-xs border border-[#D4E4F7] rounded-lg px-2 py-1.5 text-[#3A5A8A] focus:outline-none focus:ring-1 focus:ring-[#0E2F76]/20">
                          <option value="Active">Active</option>
                          <option value="Under Maintenance">Under Maintenance</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {machinesData?.meta && (
          <div className="px-4 py-3 border-t border-[#D4E4F7] text-xs text-[#7A9CC0]">
            Showing {machines.length} of {machinesData.meta.total} machines
          </div>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddMachineModal onClose={() => setShowAdd(false)} departments={departments} />}
      {handoverMachine && <HandoverModal machine={handoverMachine} onClose={() => setHandoverMachine(null)} />}
    </div>
  );
}
