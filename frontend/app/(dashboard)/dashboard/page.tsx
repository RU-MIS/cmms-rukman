'use client';
import { useQuery } from '@tanstack/react-query';
import { Wrench, ClipboardCheck, AlertTriangle, TrendingUp, CheckCircle2, Clock, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import dayjs from 'dayjs';

// KPI Card component
function KPICard({ label, value, sub, subColor, icon: Icon, iconBg }: {
  label: string; value: string | number; sub?: string;
  subColor?: string; icon: any; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-[#D4E4F7] p-5 flex items-start gap-4">
      <div className={`w-11 h-11 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-[#0A1F4E] mt-0.5">{value}</p>
        {sub && <p className={`text-xs font-medium mt-0.5 ${subColor || 'text-[#7A9CC0]'}`}>{sub}</p>}
      </div>
    </div>
  );
}

// Skeleton loader
function Skeleton({ className }: { className?: string }) {
  return <div className={`bg-[#D4E4F7] animate-pulse rounded-lg ${className}`} />;
}

export default function DashboardPage() {
  const { user } = useAuthStore();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn:  () => api.get('/dashboard/kpis').then(r => r.data.data),
    refetchInterval: 60000,
  });

  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ['dept-compliance'],
    queryFn:  () => api.get('/dashboard/dept-compliance').then(r => r.data.data),
  });

  const { data: todayMachines } = useQuery({
    queryKey: ['today-machines'],
    queryFn:  () => api.get('/dashboard/today-machines').then(r => r.data.data),
  });

  const today = dayjs().format('dddd, DD MMM YYYY');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Dashboard</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{today} · {user?.deptName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#7A9CC0]">Logged in as</p>
          <p className="text-sm font-semibold text-[#0A1F4E]">{user?.fullName}</p>
          <span className="inline-block bg-[#D4E4F7] text-[#0E2F76] text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5">{user?.roleName}</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpisLoading ? (
          Array(4).fill(0).map((_,i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard label="Today's Tasks" value={kpis?.today?.total || 0}
              sub={`${kpis?.today?.inProgress || 0} in progress`}
              icon={ClipboardCheck} iconBg="bg-[#EFF6FF]"
              subColor="text-[#0369A1]" />
            <KPICard label="Completed" value={kpis?.today?.completed || 0}
              sub={`${kpis?.today?.total ? Math.round((kpis.today.completed / kpis.today.total) * 100) : 0}% today`}
              icon={CheckCircle2} iconBg="bg-green-50" subColor="text-green-700" />
            <KPICard label="Overdue" value={kpis?.today?.overdue || 0}
              sub={kpis?.today?.overdue > 0 ? 'Needs attention' : 'All on track'}
              icon={AlertTriangle} iconBg="bg-red-50"
              subColor={kpis?.today?.overdue > 0 ? 'text-red-600' : 'text-green-600'} />
            <KPICard label="Monthly Compliance" value={`${kpis?.monthly?.complianceRate || 0}%`}
              sub={`Target: ${kpis?.monthly?.target || 95}%`}
              icon={TrendingUp} iconBg="bg-[#EFF6FF]"
              subColor={(kpis?.monthly?.complianceRate || 0) >= 95 ? 'text-green-600' : 'text-amber-600'} />
          </>
        )}
      </div>

      {/* Charts + Machine status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Dept compliance chart */}
        <div className="bg-white rounded-xl border border-[#D4E4F7] p-5">
          <h2 className="text-base font-semibold text-[#0A1F4E] mb-4">Department compliance</h2>
          {deptLoading ? <Skeleton className="h-48" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#D4E4F7" />
                <XAxis dataKey="deptName" tick={{ fontSize: 10, fill: '#7A9CC0' }}
                  tickFormatter={v => v.split(' ')[0]} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#7A9CC0' }} />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, 'Compliance']}
                  contentStyle={{ fontSize: 12, border: '0.5px solid #D4E4F7', borderRadius: 8 }} />
                <Bar dataKey="complianceRate" radius={[4,4,0,0]}>
                  {(deptData || []).map((_: any, i: number) => (
                    <Cell key={i} fill={(deptData[i]?.complianceRate || 0) >= 95 ? '#16A34A' : (deptData[i]?.complianceRate || 0) >= 80 ? '#0E2F76' : '#DC2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Today's machines */}
        <div className="bg-white rounded-xl border border-[#D4E4F7] p-5">
          <h2 className="text-base font-semibold text-[#0A1F4E] mb-4">Today's machine status</h2>
          <div className="space-y-3 max-h-[220px] overflow-y-auto">
            {!todayMachines?.length ? (
              <div className="text-center py-8 text-[#7A9CC0] text-sm">No tasks today</div>
            ) : todayMachines.map((m: any) => {
              const pct = m.total_tasks > 0 ? Math.round((m.done / m.total_tasks) * 100) : 0;
              return (
                <div key={m.machine_id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[#0A1F4E] truncate">{m.machine_name}</span>
                      <span className="text-xs text-[#7A9CC0] ml-2">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[#D4E4F7] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: pct === 100 ? '#16A34A' : m.overdue > 0 ? '#DC2626' : '#0E2F76' }} />
                    </div>
                  </div>
                  <div className="text-xs text-[#7A9CC0] whitespace-nowrap">{m.done}/{m.total_tasks}</div>
                  {m.overdue > 0 && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-5">
        <h2 className="text-base font-semibold text-[#0A1F4E] mb-4">Quick actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'My tasks today', href: '/tasks?dueDate=today', icon: ClipboardCheck, color: 'bg-[#EFF6FF] text-[#0E2F76]' },
            { label: 'Pending tasks',  href: '/tasks?status=Pending', icon: Clock,         color: 'bg-amber-50 text-amber-700' },
            { label: 'Overdue tasks',  href: '/tasks?status=Overdue', icon: XCircle,       color: 'bg-red-50 text-red-700' },
            { label: 'All machines',   href: '/machines',             icon: Wrench,        color: 'bg-[#EFF6FF] text-[#0E2F76]' },
          ].map(a => (
            <a key={a.href} href={a.href}
              className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[#D4E4F7] hover:border-[#AAC0E1] hover:bg-[#F5FEFF] transition-all group">
              <div className={`w-10 h-10 ${a.color} rounded-lg flex items-center justify-center`}>
                <a.icon className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium text-[#3A5A8A] text-center">{a.label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
