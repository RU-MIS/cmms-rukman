'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users, KeyRound, UserCheck, UserX, Copy, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];

interface Employee {
  userId: string; employeeCode: string; fullName: string; username: string;
  roleName: string; deptName: string; shiftName: string;
  phone: string | null; email: string | null; isActive: boolean; lastLogin: string | null;
}

function RoleBadge({ role }: { role: string }) {
  return <span className="text-xs font-semibold bg-[#EFF6FF] text-[#0E2F76] px-2.5 py-0.5 rounded-full">{role}</span>;
}

// ── Add Employee Modal ─────────────────────────────────────────────
function AddEmployeeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: '', employeeCode: '', roleId: '', deptId: '', shiftId: '',
    phone: '', email: '', username: '', plantId: '',
  });
  const [createdUser, setCreatedUser] = useState<{ username: string; tempPassword: string } | null>(null);
  const [showPass, setShowPass] = useState(false);

  // Fetch roles
  const { data: roles = [] } = useQuery({
    queryKey: ['roles-dropdown'],
    queryFn: () => api.get('/roles').then(r => r.data.data || []),
  });

  // Fetch departments
  const { data: depts = [] } = useQuery({
    queryKey: ['depts-dropdown'],
    queryFn: () => api.get('/departments?limit=50').then(r => r.data.data || []),
  });

  // Fetch plants
  const { data: plants = [] } = useQuery({
    queryKey: ['plants-dropdown'],
    queryFn: () => api.get('/plants').then(r => r.data.data || []),
  });

  // Fetch shifts
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts-dropdown'],
    queryFn: () => api.get('/shifts').then(r => r.data.data || []),
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: (res) => {
      setCreatedUser({
        username: res.data.data.username,
        tempPassword: res.data.data.tempPassword
      });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create employee'),
  });

  // Success screen — show credentials
  if (createdUser) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-md p-6 text-center shadow-xl">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserCheck className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-[#0A1F4E] mb-1">Employee created!</h2>
          <p className="text-xs text-[#7A9CC0] mb-5">Share these login credentials securely. Password shown only once.</p>

          <div className="bg-[#F5FEFF] border border-[#D4E4F7] rounded-xl p-4 text-left space-y-3 mb-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#7A9CC0] font-medium">Username</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#0A1F4E] font-mono">{createdUser.username}</span>
                <button onClick={() => { navigator.clipboard.writeText(createdUser.username); toast.success('Copied!'); }}
                  className="text-[#0E2F76] hover:text-[#071E52]"><Copy className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="border-t border-[#D4E4F7]" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#7A9CC0] font-medium">Temp password</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#0E2F76] font-mono">
                  {showPass ? createdUser.tempPassword : '••••••••••'}
                </span>
                <button onClick={() => setShowPass(p => !p)} className="text-[#7A9CC0]">
                  {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => { navigator.clipboard.writeText(createdUser.tempPassword); toast.success('Copied!'); }}
                  className="text-[#0E2F76] hover:text-[#071E52]"><Copy className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mb-4 text-left">
            ⚠️ Employee must change this password on first login.
          </div>

          <button onClick={onClose} className="w-full bg-[#0E2F76] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#071E52]">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7] sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-[#0A1F4E]">Add new employee</h2>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Full name + Employee code */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Full name *</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]"
                value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Ramesh Kumar" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Employee code *</label>
              <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]"
                value={form.employeeCode} onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} placeholder="E0023" />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">
              Username <span className="text-[#7A9CC0] font-normal normal-case">(leave blank to auto-generate)</span>
            </label>
            <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]"
              value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="e.g. ramesh.kumar (auto if blank)" />
          </div>

          {/* Role + Dept + Shift */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Role *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.roleId} onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))}>
                <option value="">Select role</option>
                {(roles as any[]).map((r: any) => (
                  <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Department *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.deptId} onChange={e => setForm(f => ({ ...f, deptId: e.target.value }))}>
                <option value="">Select dept</option>
                {(depts as any[]).map((d: any) => (
                  <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Shift *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.shiftId} onChange={e => setForm(f => ({ ...f, shiftId: e.target.value }))}>
                <option value="">Select shift</option>
                {(shifts as any[]).map((s: any) => (
                  <option key={s.shift_id} value={s.shift_id}>{s.shift_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Plant */}
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Plant No.</label>
            <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
              value={form.plantId} onChange={e => setForm(f => ({ ...f, plantId: e.target.value }))}>
              <option value="">Select plant</option>
              {(plants as any[]).map((p: any) => (
                <option key={p.plant_id} value={p.plant_id}>Plant No.{p.plant_no} — {p.address || p.plant_name}</option>
              ))}
            </select>
          </div>

          {/* Phone + Email */}
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

          <div className="bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg p-3 text-xs text-[#7A9CC0]">
            🔐 A temporary password will be auto-generated and shown after creation. Employee must change it on first login.
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7]">Cancel</button>
          <button onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.fullName || !form.employeeCode || !form.roleId || !form.deptId || !form.shiftId}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50 flex items-center gap-2">
            {mutation.isPending ? 'Creating...' : '+ Create employee'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function EmployeesPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canManage = ADMIN_ROLES.includes(user?.roleName || '');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: empData, isLoading } = useQuery({
    queryKey: ['employees', search, deptFilter],
    queryFn: () => api.get('/users', { params: { search, deptId: deptFilter, limit: 100 } }).then(r => r.data),
  });

  const { data: deptsData } = useQuery({
    queryKey: ['depts-filter'],
    queryFn: () => api.get('/departments?limit=50').then(r => r.data.data || []),
  });

  const resetMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/users/${userId}/reset-password`),
    onSuccess: (res) => {
      const p = res.data.data.tempPassword;
      toast.success(`New temp password: ${p}`, { duration: 10000 });
      navigator.clipboard.writeText(p);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (userId: string) => api.patch(`/users/${userId}/toggle`),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['employees'] }); },
  });

  const employees: Employee[] = empData?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Employees</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{employees.length} employees</p>
        </div>
        {canManage && (
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
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[180px]"
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
                {['Employee', 'Username', 'Department', 'Role', 'Shift', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-[#D4E4F7]">
                    {Array(7).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center">
                  <Users className="w-10 h-10 text-[#AAC0E1] mx-auto mb-3" />
                  <p className="text-sm text-[#7A9CC0]">No employees found</p>
                </td></tr>
              ) : employees.map((emp, idx) => (
                <tr key={emp.userId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-[#0E2F76] rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">{emp.fullName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-[#0A1F4E]">{emp.fullName}</p>
                        <p className="text-xs text-[#7A9CC0]">{emp.employeeCode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#0E2F76]">@{emp.username}</td>
                  <td className="px-4 py-3 text-[#3A5A8A] text-xs">{emp.deptName}</td>
                  <td className="px-4 py-3"><RoleBadge role={emp.roleName} /></td>
                  <td className="px-4 py-3 text-xs text-[#7A9CC0] whitespace-nowrap">{emp.shiftName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${emp.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {emp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => { if(confirm('Reset password?')) resetMutation.mutate(emp.userId); }}
                          className="flex items-center gap-1 text-xs text-[#3A5A8A] hover:text-[#0E2F76] bg-[#F5FEFF] border border-[#D4E4F7] px-2 py-1.5 rounded-lg">
                          <KeyRound className="w-3.5 h-3.5" /> Reset
                        </button>
                        <button onClick={() => toggleMutation.mutate(emp.userId)}
                          className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border ${emp.isActive ? 'text-red-600 bg-red-50 border-red-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                          {emp.isActive ? <><UserX className="w-3.5 h-3.5" />Deactivate</> : <><UserCheck className="w-3.5 h-3.5" />Activate</>}
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

      {showAdd && <AddEmployeeModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
