'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Download, Filter, TrendingUp, AlertTriangle, CheckCircle2, Clock, Building2, Wrench, Users } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDate } from '@/lib/utils';
import dayjs from 'dayjs';

// ── Types ──────────────────────────────────────────────────────────
type ReportTab = 'overview' | 'machines' | 'departments' | 'employees' | 'tasks' | 'overdue';

// ── Colors ─────────────────────────────────────────────────────────
const CHART_COLORS = ['#0E2F76', '#AAC0E1', '#16A34A', '#D97706', '#DC2626', '#7C3AED'];

// ── Compliance circle ──────────────────────────────────────────────
function ComplianceCircle({ rate, size = 80 }: { rate: number; size?: number }) {
  const color = rate >= 95 ? '#16A34A' : rate >= 80 ? '#D97706' : '#DC2626';
  const circumference = 2 * Math.PI * 30;
  const strokeDash = (rate / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="30" fill="none" stroke="#D4E4F7" strokeWidth="8" />
      <circle cx="40" cy="40" r="30" fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${strokeDash} ${circumference}`}
        strokeLinecap="round" transform="rotate(-90 40 40)" />
      <text x="40" y="44" textAnchor="middle" fontSize="14" fontWeight="700" fill={color}>{rate}%</text>
    </svg>
  );
}

// ── Summary KPI ────────────────────────────────────────────────────
function SummaryKPI({ label, value, sub, color, icon: Icon }: any) {
  return (
    <div className="bg-white rounded-xl border border-[#D4E4F7] p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-[#0A1F4E]">{value}</p>
        {sub && <p className="text-xs text-[#7A9CC0] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Export CSV helper ──────────────────────────────────────────────
function exportToCSV(data: any[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(',');
  const rows    = data.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(','));
  const csv     = [headers, ...rows].join('\n');
  const blob    = new Blob([csv], { type: 'text/csv' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = `${filename}_${dayjs().format('YYYY-MM-DD')}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Main Reports Page ──────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [toDate, setToDate]     = useState(dayjs().format('YYYY-MM-DD'));
  const [deptFilter, setDeptFilter] = useState('');

  const filters = { fromDate, toDate, deptId: deptFilter };

  // Compliance summary
  const { data: compliance } = useQuery({
    queryKey: ['report-compliance', filters],
    queryFn: () => api.get('/reports/compliance', { params: filters }).then(r => r.data.data),
  });

  // Machine report
  const { data: machineData, isLoading: machineLoading } = useQuery({
    queryKey: ['report-machines', filters],
    queryFn: () => api.get('/reports/machines', { params: { ...filters, limit: 50 } }).then(r => r.data),
    enabled: activeTab === 'machines' || activeTab === 'overview',
  });

  // Dept report
  const { data: deptData } = useQuery({
    queryKey: ['report-depts', filters],
    queryFn: () => api.get('/reports/departments', { params: filters }).then(r => r.data.data),
    enabled: activeTab === 'departments' || activeTab === 'overview',
  });

  // Employee report
  const { data: empData, isLoading: empLoading } = useQuery({
    queryKey: ['report-employees', filters],
    queryFn: () => api.get('/reports/employees', { params: { ...filters, limit: 50 } }).then(r => r.data),
    enabled: activeTab === 'employees',
  });

  // Frequency report
  const { data: freqData } = useQuery({
    queryKey: ['report-frequency', filters],
    queryFn: () => api.get('/reports/frequency', { params: filters }).then(r => r.data.data),
    enabled: activeTab === 'overview',
  });

  // Task detail
  const { data: taskData, isLoading: taskLoading } = useQuery({
    queryKey: ['report-tasks', filters],
    queryFn: () => api.get('/reports/tasks', { params: { ...filters, limit: 50 } }).then(r => r.data),
    enabled: activeTab === 'tasks',
  });

  // Overdue
  const { data: overdueData } = useQuery({
    queryKey: ['report-overdue', deptFilter],
    queryFn: () => api.get('/reports/overdue', { params: { deptId: deptFilter } }).then(r => r.data.data),
    enabled: activeTab === 'overdue',
  });

  const { data: deptsData } = useQuery({
    queryKey: ['depts-list'],
    queryFn: () => api.get('/departments?limit=20').then(r => r.data.data),
  });

  const tabs: { id: ReportTab; label: string; icon: any }[] = [
    { id: 'overview',     label: 'Overview',     icon: TrendingUp },
    { id: 'machines',     label: 'Machines',     icon: Wrench },
    { id: 'departments',  label: 'Departments',  icon: Building2 },
    { id: 'employees',    label: 'Employees',    icon: Users },
    { id: 'tasks',        label: 'Task detail',  icon: CheckCircle2 },
    { id: 'overdue',      label: 'Overdue',      icon: AlertTriangle },
  ];

  const statusColors: Record<string, string> = {
    Completed: '#16A34A', Verified: '#16A34A', Pending: '#D97706',
    Overdue: '#DC2626', Rejected: '#DC2626', 'In Progress': '#0369A1',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Reports</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">Maintenance compliance & performance analytics</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">From date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">To date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Department</label>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
              className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[160px]">
              <option value="">All departments</option>
              {(deptsData || []).map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            {[
              { label: 'This month', from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') },
              { label: 'Last month', from: dayjs().subtract(1,'month').startOf('month').format('YYYY-MM-DD'), to: dayjs().subtract(1,'month').endOf('month').format('YYYY-MM-DD') },
              { label: 'This year',  from: dayjs().startOf('year').format('YYYY-MM-DD'),  to: dayjs().format('YYYY-MM-DD') },
            ].map(p => (
              <button key={p.label} onClick={() => { setFromDate(p.from); setToDate(p.to); }}
                className="text-xs font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-2 rounded-lg transition-colors">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Compliance summary KPIs */}
      {compliance && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2 sm:col-span-1 bg-white rounded-xl border border-[#D4E4F7] p-4 flex flex-col items-center justify-center">
            <ComplianceCircle rate={compliance.complianceRate} />
            <p className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide mt-2">Compliance</p>
          </div>
          <SummaryKPI label="Total tasks"  value={compliance.total}      icon={CheckCircle2} color="bg-[#EFF6FF] text-[#0E2F76]" />
          <SummaryKPI label="Completed"    value={compliance.completed}  icon={CheckCircle2} color="bg-green-50 text-green-600" />
          <SummaryKPI label="Pending"      value={compliance.pending}    icon={Clock}        color="bg-amber-50 text-amber-600" />
          <SummaryKPI label="Overdue"      value={compliance.overdue}    icon={AlertTriangle}color="bg-red-50 text-red-600" />
          <SummaryKPI label="Verified"     value={compliance.verified}   icon={CheckCircle2} color="bg-[#EFF6FF] text-[#0E2F76]" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F5FEFF] border border-[#D4E4F7] rounded-xl p-1 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-[#0E2F76] text-white shadow-sm'
                : 'text-[#3A5A8A] hover:bg-[#D4E4F7]'
            }`}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Dept compliance chart */}
          <div className="bg-white rounded-xl border border-[#D4E4F7] p-5">
            <h3 className="text-base font-semibold text-[#0A1F4E] mb-4">Department compliance</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={deptData || []} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#D4E4F7" />
                <XAxis dataKey="deptCode" tick={{ fontSize: 11, fill: '#7A9CC0' }} />
                <YAxis domain={[0,100]} tick={{ fontSize: 11, fill: '#7A9CC0' }} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Compliance']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '0.5px solid #D4E4F7' }} />
                <Bar dataKey="complianceRate" radius={[4,4,0,0]}>
                  {(deptData || []).map((d: any, i: number) => (
                    <Cell key={i} fill={d.complianceRate >= 95 ? '#16A34A' : d.complianceRate >= 80 ? '#0E2F76' : '#DC2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Frequency breakdown pie */}
          <div className="bg-white rounded-xl border border-[#D4E4F7] p-5">
            <h3 className="text-base font-semibold text-[#0A1F4E] mb-4">Tasks by frequency</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={freqData || []} cx="50%" cy="50%" outerRadius={80}
                  dataKey="total" nameKey="frequency" label={({ frequency, percent }) => `${frequency} ${(percent*100).toFixed(0)}%`}
                  labelLine={false} fontSize={10}>
                  {(freqData || []).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Machines tab ── */}
      {activeTab === 'machines' && (
        <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#D4E4F7]">
            <h3 className="text-base font-semibold text-[#0A1F4E]">Machine-wise report</h3>
            <button onClick={() => exportToCSV(machineData?.data || [], 'machine_report')}
              className="flex items-center gap-2 text-sm font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-1.5 rounded-lg">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
                  {['Machine','Department','Total','Completed','Overdue','Compliance'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {machineLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-[#D4E4F7]">
                      {Array(6).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                    </tr>
                  ))
                ) : (machineData?.data || []).map((m: any, idx: number) => (
                  <tr key={m.machineId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#0A1F4E]">{m.machineName}</p>
                      <p className="text-xs text-[#7A9CC0]">{m.machineCode}</p>
                    </td>
                    <td className="px-4 py-3 text-[#3A5A8A]">{m.deptName}</td>
                    <td className="px-4 py-3 font-medium text-[#0A1F4E]">{m.total}</td>
                    <td className="px-4 py-3 text-green-700 font-medium">{m.completed}</td>
                    <td className="px-4 py-3">
                      {m.overdue > 0
                        ? <span className="text-red-600 font-semibold">{m.overdue}</span>
                        : <span className="text-green-600">0</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[#D4E4F7] rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${m.complianceRate}%`, background: m.complianceRate >= 95 ? '#16A34A' : m.complianceRate >= 80 ? '#0E2F76' : '#DC2626' }} />
                        </div>
                        <span className={`text-xs font-bold ${m.complianceRate >= 95 ? 'text-green-700' : m.complianceRate >= 80 ? 'text-[#0E2F76]' : 'text-red-600'}`}>{m.complianceRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Departments tab ── */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => exportToCSV(deptData || [], 'department_report')}
              className="flex items-center gap-2 text-sm font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-1.5 rounded-lg">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(deptData || []).map((d: any) => (
              <div key={d.deptId} className="bg-white rounded-xl border border-[#D4E4F7] p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-[#0A1F4E]">{d.deptName}</p>
                    <p className="text-xs text-[#7A9CC0] mt-0.5">{d.machineCount} machines · {d.operatorCount} operators</p>
                  </div>
                  <ComplianceCircle rate={d.complianceRate} size={60} />
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'Total tasks', value: d.total, color: 'text-[#0A1F4E]' },
                    { label: 'Completed',   value: d.completed, color: 'text-green-700' },
                    { label: 'Overdue',     value: d.overdue,   color: d.overdue > 0 ? 'text-red-600' : 'text-green-600' },
                    { label: 'Pending',     value: d.pending,   color: 'text-amber-700' },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-xs text-[#7A9CC0]">{item.label}</span>
                      <span className={`text-sm font-semibold ${item.color}`}>{item.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 h-1.5 bg-[#D4E4F7] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${d.complianceRate}%`, background: d.complianceRate >= 95 ? '#16A34A' : d.complianceRate >= 80 ? '#0E2F76' : '#DC2626' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Employees tab ── */}
      {activeTab === 'employees' && (
        <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#D4E4F7]">
            <h3 className="text-base font-semibold text-[#0A1F4E]">Employee performance</h3>
            <button onClick={() => exportToCSV(empData?.data || [], 'employee_report')}
              className="flex items-center gap-2 text-sm font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-1.5 rounded-lg">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
                  {['Employee','Department','Shift','Total','Completed','Overdue','Rejected','Compliance','Avg time'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {empLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-[#D4E4F7]">
                      {Array(9).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                    </tr>
                  ))
                ) : (empData?.data || []).map((e: any, idx: number) => (
                  <tr key={e.userId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-[#0E2F76] rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{e.fullName.split(' ').map((n: string) => n[0]).join('').slice(0,2)}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-[#0A1F4E]">{e.fullName}</p>
                          <p className="text-xs text-[#7A9CC0]">{e.employeeCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#3A5A8A]">{e.deptName}</td>
                    <td className="px-4 py-3 text-[#3A5A8A] whitespace-nowrap">{e.shiftName}</td>
                    <td className="px-4 py-3 font-medium">{e.total}</td>
                    <td className="px-4 py-3 text-green-700 font-medium">{e.completed}</td>
                    <td className="px-4 py-3 font-medium">{e.overdue > 0 ? <span className="text-red-600">{e.overdue}</span> : <span className="text-green-600">0</span>}</td>
                    <td className="px-4 py-3">{e.rejected > 0 ? <span className="text-red-600 font-medium">{e.rejected}</span> : <span className="text-[#7A9CC0]">0</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${e.complianceRate >= 95 ? 'text-green-700' : e.complianceRate >= 80 ? 'text-[#0E2F76]' : 'text-red-600'}`}>{e.complianceRate}%</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#7A9CC0]">{e.avgCompletionMins ? `${e.avgCompletionMins} min` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Task detail tab ── */}
      {activeTab === 'tasks' && (
        <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#D4E4F7]">
            <h3 className="text-base font-semibold text-[#0A1F4E]">Task detail report</h3>
            <button onClick={() => exportToCSV(taskData?.data || [], 'task_report')}
              className="flex items-center gap-2 text-sm font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-1.5 rounded-lg">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F5FEFF] border-b border-[#D4E4F7]">
                  {['Task ID','Machine','Template','Operator','Due date','Frequency','Status','Verified by'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#0E2F76] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taskLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-[#D4E4F7]">
                      {Array(8).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-[#D4E4F7] rounded animate-pulse" /></td>)}
                    </tr>
                  ))
                ) : (taskData?.data || []).map((t: any, idx: number) => (
                  <tr key={t.taskId} className={`border-b border-[#D4E4F7] hover:bg-[#F5FEFF] ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-[#0E2F76] font-semibold">{t.taskId}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#0A1F4E]">{t.machineName}</p>
                      <p className="text-xs text-[#7A9CC0]">{t.machineCode}</p>
                    </td>
                    <td className="px-4 py-3 text-[#3A5A8A] max-w-[160px] truncate">{t.templateName}</td>
                    <td className="px-4 py-3 text-[#3A5A8A]">{t.operatorName}</td>
                    <td className="px-4 py-3 text-xs text-[#7A9CC0] whitespace-nowrap">{formatDate(t.dueDate)}</td>
                    <td className="px-4 py-3"><span className="text-xs bg-[#EFF6FF] text-[#0E2F76] font-medium px-2 py-0.5 rounded-full">{t.frequency}</span></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        ['Completed','Verified'].includes(t.status) ? 'bg-green-50 text-green-700' :
                        t.status === 'Overdue' ? 'bg-red-50 text-red-700' :
                        t.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#7A9CC0]">{t.verifierName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Overdue tab ── */}
      {activeTab === 'overdue' && (
        <div className="bg-white rounded-xl border border-[#D4E4F7] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#D4E4F7]">
            <div>
              <h3 className="text-base font-semibold text-[#0A1F4E]">Overdue tasks</h3>
              <p className="text-xs text-red-500 mt-0.5">{(overdueData || []).length} tasks overdue</p>
            </div>
            <button onClick={() => exportToCSV(overdueData || [], 'overdue_report')}
              className="flex items-center gap-2 text-sm font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-1.5 rounded-lg">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-red-50 border-b border-red-100">
                  {['Machine','Department','Checklist','Operator','Due date','Frequency','Days overdue'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-red-700 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(overdueData || []).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-16 text-center">
                    <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-[#0A1F4E]">No overdue tasks!</p>
                    <p className="text-xs text-[#7A9CC0] mt-1">All tasks are on track</p>
                  </td></tr>
                ) : (overdueData || []).map((t: any, idx: number) => (
                  <tr key={t.taskId} className={`border-b border-[#D4E4F7] hover:bg-red-50/30 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#0A1F4E]">{t.machineName}</p>
                      <p className="text-xs text-[#7A9CC0]">{t.machineCode}</p>
                    </td>
                    <td className="px-4 py-3 text-[#3A5A8A]">{t.deptName}</td>
                    <td className="px-4 py-3 text-[#3A5A8A] max-w-[160px] truncate">{t.templateName}</td>
                    <td className="px-4 py-3 text-[#3A5A8A]">{t.operatorName}</td>
                    <td className="px-4 py-3 text-xs text-red-600 font-medium whitespace-nowrap">{formatDate(t.dueDate)}</td>
                    <td className="px-4 py-3"><span className="text-xs bg-[#EFF6FF] text-[#0E2F76] font-medium px-2 py-0.5 rounded-full">{t.frequency}</span></td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${t.daysOverdue > 7 ? 'text-red-700' : 'text-red-500'}`}>
                        {t.daysOverdue} {t.daysOverdue === 1 ? 'day' : 'days'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
