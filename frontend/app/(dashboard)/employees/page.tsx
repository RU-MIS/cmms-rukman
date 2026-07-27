'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users, KeyRound, RefreshCw, UserCheck, UserX } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Employee {
  userId: string; employeeCode: string; fullName: string; username: string;
  roleName: string; deptName: string; shiftName: string;
  phone: string | null; email: string | null; isActive: boolean; lastLogin: string | null;
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    Admin:       'bg-[#0E2F76] text-white',
    Supervisor:  'bg-[#AAC0E1] text-[#0A1F4E]',
    Technician:  'bg-[#D4E4F7] text-[#0A1F4E]',
    Viewer:      'bg-gray-100 text-gray-600',
  };
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${colors[role] || 'bg-gray-100 text-gray-600'}`}>{role}</span>;
}

// ── Add Employee Modal ────────────────────────────────────────────
function AddEmployeeModal({ onClose, departments, shifts, roles }: any) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: '', employeeCode: '', roleId: '', deptId: '', shiftId: '', phone: '', email: '',
  });
  const [createdUser, setCreatedUser] = useState<{ username: string; tempPassword: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: (res) => {
      setCreatedUser({ username: res.data.data.username, tempPassword: res.data.data.tempPassword });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  if (createdUser) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-md p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserCheck className="w-6 h-6 text-green-600" />
          </div>
          <h2 className="text-base font-semibold text-[#0A1F4E] mb-1">Employee created!</h2>
          <p className="text-xs text-[#7A9CC0] mb-4">Share these credentials securely. Temporary password shown only once.</p>
          <div className="bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg p-4 text-left space-y-2 mb-4">
            <div className="flex justify-between">
              <span className="text-xs text-[#7A9CC0]">Username</span>
              <span className="text-sm font-semibold text-[#0A1F4E] font-mono">{createdUser.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-[#7A9CC0]">Temp password</span>
              <span className="text-sm font-semibold text-[#0E2F76] font-mono">{createdUser.tempPassword}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-full bg-[#0E2F76] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#071E52]">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
          <h2 className="text-base font-semibold text-[#0A1F4E]">Add new employee</h2>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Full name *</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Ramesh Kumar" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Employee code *</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.employeeCode} onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} placeholder="EMP-BLW-001" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Role *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.roleId} onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))}>
                <option value="">Select role</option>
                {roles.map((r: any) => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Department *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.deptId} onChange={e => setForm(f => ({ ...f, deptId: e.target.value }))}>
                <option value="">Select dept</option>
                {departments.map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Shift *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.shiftId} onChange={e => setForm(f => ({ ...f, shiftId: e.target.value }))}>
                <option value="">Select shift</option>
                {shifts.map((s: any) => <option key={s.shiftId} value={s.shiftId}>{s.shiftName}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Phone</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="9876543210" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Email</label>
              <input type="email" className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="ramesh@rukman.com" />
            </div>
          </div>
          <p className="text-xs text-[#7A9CC0]">* Username will be auto-generated from full name. Temporary password will be shown after creation.</p>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7]">Cancel</button>
          <button onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.fullName || !form.employeeCode || !form.roleId || !form.deptId || !form.shiftId}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
            {mutation.isPending ? 'Creating...' : 'Create employee'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmployeesPage() {
  const { isRole } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: empData, isLoading } = useQuery({
    queryKey: ['employees', search, deptFilter],
    queryFn: () => api.get('/users', { params: { search, deptId: deptFilter, limit: 50 } }).then(r => r.data),
  });

  const { data: deptsData } = useQuery({ queryKey: ['depts-list'], queryFn: () => api.get('/departments?limit=20').then(r => r.data.data) });
  const { data: rolesData } = useQuery({ queryKey: ['roles-list'], queryFn: () => api.get('/roles?limit=10').then(r => r.data.data) });
  const { data: shiftsData } = useQuery({ queryKey: ['shifts-list'], queryFn: () => api.get('/shifts?limit=5').then(r => r.data.data) });

  const employees: Employee[] = empData?.data || [];

  const resetMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/users/${userId}/reset-password`),
    onSuccess: (res) => {
      toast.success(`Temp password: ${res.data.data.tempPassword}`, { duration: 8000 });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (userId: string) => api.patch(`/users/${userId}/toggle`),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['employees'] }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Employees</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{employees.length} employees</p>
        </div>
        {isRole(['Admin']) && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52]">
            <Plus className="w-4 h-4" /> Add employee
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A9CC0]" />
          <input className="w-full border border-[#AAC0E1] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
            placeholder="Search by name, username, code..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[160px]"
          value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {(deptsData || []).map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
                {['Employee','Department','Shift','Role','Last login','Status','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-[#D4E4F7]">
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center">
                  <Users className="w-10 h-10 text-[#AAC0E1] mx-auto mb-3" />
                  <p className="text-sm text-[#7A9CC0]">No employees found</p>
                </td></tr>
              ) : employees.map((emp, idx) => (
                <tr key={emp.userId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] transition-colors ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-[#0E2F76] rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">
                          {emp.fullName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-[#0A1F4E]">{emp.fullName}</p>
                        <p className="text-xs text-[#7A9CC0]">@{emp.username} · {emp.employeeCode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#3A5A8A]">{emp.deptName}</td>
                  <td className="px-4 py-3 text-[#3A5A8A] whitespace-nowrap">{emp.shiftName}</td>
                  <td className="px-4 py-3"><RoleBadge role={emp.roleName} /></td>
                  <td className="px-4 py-3 text-xs text-[#7A9CC0] whitespace-nowrap">
                    {emp.lastLogin ? formatDateTime(emp.lastLogin) : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${emp.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {emp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isRole(['Admin']) && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => resetMutation.mutate(emp.userId)}
                          className="flex items-center gap-1 text-xs text-[#3A5A8A] hover:text-[#0E2F76] bg-[#F5FEFF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-2 py-1.5 rounded-lg transition-colors">
                          <KeyRound className="w-3.5 h-3.5" /> Reset
                        </button>
                        <button onClick={() => toggleMutation.mutate(emp.userId)}
                          className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${emp.isActive ? 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100' : 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100'}`}>
                          {emp.isActive ? <><UserX className="w-3.5 h-3.5" /> Deactivate</> : <><UserCheck className="w-3.5 h-3.5" /> Activate</>}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddEmployeeModal onClose={() => setShowAdd(false)} departments={deptsData || []} roles={rolesData || []} shifts={shiftsData || []} />}
    </div>
  );
}
