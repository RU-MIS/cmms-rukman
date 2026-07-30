'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ClipboardCheck, ChevronRight, X, Users, UserCheck, Building2, Hash } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive', 'Production Head', 'Maintenance Incharge', 'Quality Head'];

// ── Assign Checklist Modal ─────────────────────────────────────────
function AssignModal({ template, onClose }: { template: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    userId: '', startDate: new Date().toISOString().split('T')[0],
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data.data || []),
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['assignments', template.templateId],
    queryFn: () => api.get(`/checklists/${template.templateId}/assignments`).then(r => r.data.data || []),
  });

  const assignMutation = useMutation({
    mutationFn: () => api.post(`/checklists/${template.templateId}/assign`, {
      machineId: template.machineId || null,
      userId: form.userId,
      scheduleStartDate: form.startDate,
    }),
    onSuccess: () => {
      toast.success('Checklist assigned!');
      qc.invalidateQueries({ queryKey: ['assignments', template.templateId] });
      setForm({ userId: '', startDate: new Date().toISOString().split('T')[0] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Assignment failed'),
  });

  const selectedEmp = (employees as any[]).find((e: any) => e.userId === form.userId);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#D4E4F7] sticky top-0 bg-white">
          <div>
            <h2 className="text-base font-semibold text-[#0A1F4E]">Assign Checklist</h2>
            <p className="text-xs text-[#7A9CC0] mt-0.5">{template.templateName}</p>
          </div>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-6">
          {/* Assign Form */}
          <div className="bg-[#F5FEFF] border border-[#D4E4F7] rounded-xl p-4 space-y-4">
            <h3 className="text-sm font-semibold text-[#0A1F4E]">Assign to employee</h3>
            
            {/* Employee select */}
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Employee Name *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}>
                <option value="">Select employee</option>
                {(employees as any[]).map((emp: any) => (
                  <option key={emp.userId} value={emp.userId}>{emp.fullName} — {emp.deptName}</option>
                ))}
              </select>
            </div>

            {/* Show selected employee details */}
            {selectedEmp && (
              <div className="bg-white border border-[#D4E4F7] rounded-lg p-3 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-[#7A9CC0]">Employee</p>
                  <p className="text-sm font-semibold text-[#0A1F4E]">{selectedEmp.fullName}</p>
                </div>
                <div>
                  <p className="text-xs text-[#7A9CC0]">Department</p>
                  <p className="text-sm font-semibold text-[#0A1F4E]">{selectedEmp.deptName}</p>
                </div>
                <div>
                  <p className="text-xs text-[#7A9CC0]">Plant No. (Emp Code)</p>
                  <p className="text-sm font-semibold text-[#0E2F76] font-mono">{selectedEmp.employeeCode}</p>
                </div>
              </div>
            )}

            {/* Start Date */}
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Start Date *</label>
              <input type="date"
                className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>

            <button onClick={() => assignMutation.mutate()}
              disabled={!form.userId || !form.startDate || assignMutation.isPending}
              className="w-full bg-[#0E2F76] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#071E52] disabled:opacity-50 flex items-center justify-center gap-2">
              <UserCheck className="w-4 h-4" />
              {assignMutation.isPending ? 'Assigning...' : 'Assign checklist'}
            </button>
          </div>

          {/* Current Assignments */}
          <div>
            <h3 className="text-sm font-semibold text-[#0A1F4E] mb-3">Currently assigned to</h3>
            {(assignments as any[]).length === 0 ? (
              <div className="text-center py-6 text-[#7A9CC0] text-sm">No assignments yet</div>
            ) : (
              <div className="space-y-2">
                {(assignments as any[]).map((a: any) => (
                  <div key={a.assignId} className="flex items-center gap-3 bg-white border border-[#D4E4F7] rounded-xl p-3">
                    <div className="w-10 h-10 bg-[#0E2F76] rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">
                        {a.fullName?.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0A1F4E]">{a.fullName}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1 text-xs text-[#7A9CC0]">
                          <Building2 className="w-3 h-3" /> {a.deptName}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-[#7A9CC0]">
                          <Hash className="w-3 h-3" /> {a.employeeCode}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs bg-green-50 text-green-700 font-medium px-2 py-0.5 rounded-full">Active</span>
                      <p className="text-xs text-[#7A9CC0] mt-1">From {new Date(a.startDate).toLocaleDateString('en-IN')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Template Card ─────────────────────────────────────────────────
function TemplateCard({ template, canManage, onAssign }: { template: any; canManage: boolean; onAssign: () => void }) {
  const freqColors: Record<string, string> = {
    Daily: 'bg-blue-50 text-blue-700',
    Weekly: 'bg-purple-50 text-purple-700',
    Monthly: 'bg-green-50 text-green-700',
    'On-Demand': 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="bg-white border border-[#D4E4F7] rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
            <ClipboardCheck className="w-5 h-5 text-[#0E2F76]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#0A1F4E] text-sm leading-tight">{template.templateName}</p>
            <p className="text-xs text-[#7A9CC0] mt-0.5">{template.deptName}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${freqColors[template.frequency] || 'bg-gray-100 text-gray-600'}`}>
                {template.frequency}
              </span>
              <span className="text-xs text-[#7A9CC0]">{template.itemCount} checks</span>
              {template.isActive ? (
                <span className="text-xs bg-green-50 text-green-700 font-medium px-2 py-0.5 rounded-full">Active</span>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-500 font-medium px-2 py-0.5 rounded-full">Inactive</span>
              )}
            </div>
          </div>
        </div>
        {canManage && (
          <button onClick={onAssign}
            className="flex items-center gap-1.5 text-xs font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-2 rounded-lg whitespace-nowrap flex-shrink-0">
            <Users className="w-3.5 h-3.5" /> Assign
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function ChecklistsPage() {
  const { user } = useAuthStore();
  const canManage = ADMIN_ROLES.includes(user?.roleName || '');
  const [search, setSearch] = useState('');
  const [freqFilter, setFreqFilter] = useState('');
  const [assignTemplate, setAssignTemplate] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['checklists', search, freqFilter],
    queryFn: () => api.get('/checklists', { params: { search, frequency: freqFilter, limit: 100 } }).then(r => r.data),
  });

  const templates = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Checklists</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{templates.length} templates</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input className="w-full border border-[#AAC0E1] rounded-lg pl-3 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
            placeholder="Search checklist..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
          value={freqFilter} onChange={e => setFreqFilter(e.target.value)}>
          <option value="">All frequencies</option>
          {['Daily','10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand'].map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Templates grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="bg-white border border-[#D4E4F7] rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-[#D4E4F7] rounded w-3/4 mb-2" />
              <div className="h-3 bg-[#D4E4F7] rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardCheck className="w-12 h-12 text-[#AAC0E1] mx-auto mb-3" />
          <p className="text-sm font-semibold text-[#0A1F4E]">No checklists found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((template: any) => (
            <TemplateCard
              key={template.templateId}
              template={template}
              canManage={canManage}
              onAssign={() => setAssignTemplate(template)}
            />
          ))}
        </div>
      )}

      {assignTemplate && (
        <AssignModal template={assignTemplate} onClose={() => setAssignTemplate(null)} />
      )}
    </div>
  );
}
