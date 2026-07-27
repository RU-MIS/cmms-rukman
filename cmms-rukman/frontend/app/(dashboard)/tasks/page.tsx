'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Clock, AlertTriangle, CheckCircle2, ChevronRight, X, Camera, FileText, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDate, formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

// ── Types ──────────────────────────────────────────────────────────
interface Task {
  taskId: string; machineName: string; machineCode: string;
  templateName: string; frequency: string; dueDate: string;
  shiftName: string; status: string; deptName: string;
  currentAssigneeName: string; isOverdue: boolean; completedAt: string | null;
}

interface TaskItem {
  itemId: string; itemText: string; inputType: string;
  isMandatory: boolean; unit: string | null; dropdownOptions: string[] | null;
  expectedValue: string | null; minValue: number | null; maxValue: number | null;
  responseValue: string | null; photoUrl: string | null; remarks: string | null;
}

interface TaskDetail extends Task {
  items: TaskItem[];
  verification: { status: string; verifierName: string; comments: string } | null;
}

// ── Status config ──────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; icon: any }> = {
  Pending:      { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500',  icon: Clock },
  'In Progress':{ bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500',   icon: Loader2 },
  Completed:    { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500',  icon: CheckCircle2 },
  Verified:     { bg: 'bg-green-50',  text: 'text-green-800',  dot: 'bg-green-600',  icon: CheckCircle2 },
  Overdue:      { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500',    icon: AlertTriangle },
  Rejected:     { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500',    icon: X },
};

function TaskStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', icon: Clock };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

// ── Checklist Item Input ───────────────────────────────────────────
function ChecklistInput({
  item, value, onChange
}: {
  item: TaskItem;
  value: string;
  onChange: (val: string) => void;
}) {
  const base = "w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76]";

  switch (item.inputType) {
    case 'Checkbox':
      return (
        <div className="flex items-center gap-2">
          <input type="checkbox" id={item.itemId} checked={value === 'true'}
            onChange={e => onChange(e.target.checked ? 'true' : 'false')}
            className="w-4 h-4 accent-[#0E2F76] cursor-pointer" />
          <label htmlFor={item.itemId} className="text-sm text-[#3A5A8A] cursor-pointer">Checked</label>
        </div>
      );
    case 'PassFail':
      return (
        <div className="flex gap-2">
          {['Pass', 'Fail'].map(opt => (
            <button key={opt} type="button" onClick={() => onChange(opt)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                value === opt
                  ? opt === 'Pass' ? 'bg-green-500 text-white border-green-500' : 'bg-red-500 text-white border-red-500'
                  : 'bg-white text-[#3A5A8A] border-[#AAC0E1] hover:border-[#0E2F76]'
              }`}>{opt}</button>
          ))}
        </div>
      );
    case 'YesNo':
      return (
        <div className="flex gap-2">
          {['Yes', 'No'].map(opt => (
            <button key={opt} type="button" onClick={() => onChange(opt)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                value === opt
                  ? 'bg-[#0E2F76] text-white border-[#0E2F76]'
                  : 'bg-white text-[#3A5A8A] border-[#AAC0E1] hover:border-[#0E2F76]'
              }`}>{opt}</button>
          ))}
        </div>
      );
    case 'Dropdown':
      return (
        <select className={base} value={value} onChange={e => onChange(e.target.value)}>
          <option value="">Select...</option>
          {(item.dropdownOptions || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case 'Number':
    case 'Decimal':
      return (
        <div className="flex items-center gap-2">
          <input type="number" step={item.inputType === 'Decimal' ? '0.01' : '1'}
            min={item.minValue ?? undefined} max={item.maxValue ?? undefined}
            className={base} value={value} onChange={e => onChange(e.target.value)}
            placeholder={item.expectedValue || 'Enter value'} />
          {item.unit && <span className="text-sm text-[#7A9CC0] whitespace-nowrap">{item.unit}</span>}
        </div>
      );
    case 'Temperature':
      return (
        <div className="flex items-center gap-2">
          <input type="number" step="0.1" className={base} value={value}
            onChange={e => onChange(e.target.value)} placeholder="Enter temperature" />
          <span className="text-sm text-[#7A9CC0]">°C</span>
        </div>
      );
    case 'Pressure':
      return (
        <div className="flex items-center gap-2">
          <input type="number" step="0.1" className={base} value={value}
            onChange={e => onChange(e.target.value)} placeholder="Enter pressure" />
          <span className="text-sm text-[#7A9CC0]">{item.unit || 'PSI'}</span>
        </div>
      );
    case 'Date':
      return <input type="date" className={base} value={value} onChange={e => onChange(e.target.value)} />;
    case 'Time':
      return <input type="time" className={base} value={value} onChange={e => onChange(e.target.value)} />;
    case 'Photo':
      return (
        <div className="border-2 border-dashed border-[#AAC0E1] rounded-lg p-4 text-center">
          <Camera className="w-8 h-8 text-[#AAC0E1] mx-auto mb-2" />
          <p className="text-xs text-[#7A9CC0]">Photo upload available on mobile app</p>
          <input type="text" className={`${base} mt-2`} value={value}
            onChange={e => onChange(e.target.value)} placeholder="Or paste photo URL here" />
        </div>
      );
    case 'Remarks':
      return (
        <textarea className={`${base} resize-none h-20`} value={value}
          onChange={e => onChange(e.target.value)} placeholder="Enter remarks..." />
      );
    default:
      return (
        <input type="text" className={base} value={value}
          onChange={e => onChange(e.target.value)} placeholder="Enter value..." />
      );
  }
}

// ── Task Completion Modal ──────────────────────────────────────────
function TaskModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const { data: task, isLoading } = useQuery<TaskDetail>({
    queryKey: ['task-detail', taskId],
    queryFn: () => api.get(`/tasks/${taskId}`).then(r => r.data.data),
    onSuccess: (data) => {
      // Pre-fill existing responses
      const preFilled: Record<string, string> = {};
      data.items.forEach(item => {
        if (item.responseValue) preFilled[item.itemId] = item.responseValue;
      });
      setResponses(preFilled);
    },
  } as any);

  const startMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-detail', taskId] }),
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/submit`, {
      responses: (task?.items || []).map(item => ({
        itemId: item.itemId,
        responseValue: responses[item.itemId] || '',
        photoUrl: item.inputType === 'Photo' ? responses[item.itemId] : undefined,
        remarks: remarks[item.itemId],
      })),
    }),
    onSuccess: () => {
      toast.success('Task submitted for verification!');
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      onClose();
    },
  });

  const canEdit = task && ['Pending', 'In Progress', 'Overdue'].includes(task.status);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#D4E4F7] flex-shrink-0">
          <div>
            {task && (
              <>
                <h2 className="text-base font-semibold text-[#0A1F4E]">{task.templateName}</h2>
                <p className="text-xs text-[#7A9CC0] mt-0.5">{task.machineName} · {task.shiftName} · Due {formatDate(task.dueDate)}</p>
                <div className="mt-2"><TaskStatusBadge status={task.status} /></div>
              </>
            )}
          </div>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] p-1"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="space-y-4">
              {Array(4).fill(0).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-[#D4E4F7] rounded animate-pulse w-3/4" />
                  <div className="h-10 bg-[#D4E4F7] rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : task?.status === 'Pending' ? (
            <div className="text-center py-8">
              <ClipboardCheck className="w-12 h-12 text-[#AAC0E1] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#0A1F4E] mb-1">Ready to start?</p>
              <p className="text-xs text-[#7A9CC0] mb-4">{task.items.length} checklist items to complete</p>
              <button onClick={() => startMutation.mutate()}
                className="bg-[#0E2F76] text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-[#071E52] transition-colors">
                Start inspection
              </button>
            </div>
          ) : task?.verification ? (
            <div className={`rounded-lg p-4 mb-4 ${task.verification.status === 'Approved' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className={`text-sm font-semibold ${task.verification.status === 'Approved' ? 'text-green-700' : 'text-red-700'}`}>
                {task.verification.status === 'Approved' ? '✅ Verified by ' : '❌ Rejected by '}
                {task.verification.verifierName}
              </p>
              {task.verification.comments && <p className="text-xs mt-1 text-gray-600">{task.verification.comments}</p>}
            </div>
          ) : null}

          {task && task.status !== 'Pending' && (
            <div className="space-y-5">
              {task.items.map((item, idx) => (
                <div key={item.itemId} className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-bold text-[#AAC0E1] mt-0.5 flex-shrink-0">{idx + 1}.</span>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-[#0A1F4E]">
                        {item.itemText}
                        {item.isMandatory && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {item.unit && <span className="text-xs text-[#7A9CC0] ml-2">({item.unit})</span>}
                      {item.minValue !== null && item.maxValue !== null && (
                        <span className="text-xs text-[#7A9CC0] ml-2">Range: {item.minValue}–{item.maxValue}</span>
                      )}
                    </div>
                  </div>
                  <ChecklistInput item={item}
                    value={responses[item.itemId] || ''}
                    onChange={val => setResponses(r => ({ ...r, [item.itemId]: val }))} />
                  {canEdit && item.inputType !== 'Remarks' && (
                    <input type="text" placeholder="Add remark (optional)"
                      className="w-full border border-[#D4E4F7] rounded-lg px-3 py-1.5 text-xs text-[#3A5A8A] focus:outline-none focus:ring-1 focus:ring-[#0E2F76]/20"
                      value={remarks[item.itemId] || ''}
                      onChange={e => setRemarks(r => ({ ...r, [item.itemId]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {canEdit && task?.status !== 'Pending' && (
          <div className="p-5 border-t border-[#D4E4F7] flex-shrink-0 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7]">
              Save & close
            </button>
            <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50 flex items-center gap-2">
              {submitMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : 'Submit for verification'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Tasks Page ────────────────────────────────────────────────
export default function TasksPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [freqFilter, setFreqFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['my-tasks', statusFilter, freqFilter],
    queryFn: () => api.get('/tasks/my', { params: { status: statusFilter, frequency: freqFilter, limit: 50 } }).then(r => r.data),
    refetchInterval: 30000,
  });

  const tasks: Task[] = data?.data || [];

  const counts = {
    all:      tasks.length,
    pending:  tasks.filter(t => t.status === 'Pending').length,
    inProg:   tasks.filter(t => t.status === 'In Progress').length,
    overdue:  tasks.filter(t => t.status === 'Overdue').length,
    done:     tasks.filter(t => ['Completed','Verified'].includes(t.status)).length,
  };

  const today = dayjs().format('YYYY-MM-DD');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0A1F4E]">My Tasks</h1>
        <p className="text-sm text-[#7A9CC0] mt-0.5">{user?.shiftName} · {dayjs().format('dddd, DD MMM YYYY')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',       value: counts.all,     color: 'text-[#0A1F4E]', bg: 'bg-[#EFF6FF]',  icon: ClipboardCheck },
          { label: 'Pending',     value: counts.pending, color: 'text-amber-700', bg: 'bg-amber-50',   icon: Clock },
          { label: 'Overdue',     value: counts.overdue, color: 'text-red-700',   bg: 'bg-red-50',     icon: AlertTriangle },
          { label: 'Completed',   value: counts.done,    color: 'text-green-700', bg: 'bg-green-50',   icon: CheckCircle2 },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl border border-[#D4E4F7] p-4`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide">{c.label}</span>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-4 flex flex-wrap gap-3">
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[140px]"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All status</option>
          {['Pending','In Progress','Completed','Verified','Overdue','Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[140px]"
          value={freqFilter} onChange={e => setFreqFilter(e.target.value)}>
          <option value="">All frequencies</option>
          {['Daily','10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Task list */}
      <div className="space-y-3">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-[#D4E4F7] p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#D4E4F7] rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[#D4E4F7] rounded w-3/4" />
                  <div className="h-3 bg-[#D4E4F7] rounded w-1/2" />
                </div>
              </div>
            </div>
          ))
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#D4E4F7] py-16 text-center">
            <CheckCircle2 className="w-12 h-12 text-[#AAC0E1] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#0A1F4E]">No tasks found</p>
            <p className="text-xs text-[#7A9CC0] mt-1">You're all caught up!</p>
          </div>
        ) : tasks.map(task => {
          const isToday = task.dueDate === today;
          const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG['Pending'];
          return (
            <button key={task.taskId} onClick={() => setSelectedTask(task.taskId)}
              className={`w-full bg-white rounded-xl border text-left p-4 hover:border-[#AAC0E1] hover:shadow-sm transition-all ${
                task.isOverdue ? 'border-red-200 bg-red-50/30' : isToday ? 'border-[#AAC0E1]' : 'border-[#D4E4F7]'
              }`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                  <cfg.icon className={`w-5 h-5 ${cfg.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0A1F4E] truncate">{task.templateName}</p>
                      <p className="text-xs text-[#7A9CC0] mt-0.5">{task.machineName} · {task.machineCode}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <TaskStatusBadge status={task.status} />
                      <ChevronRight className="w-4 h-4 text-[#AAC0E1]" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="text-xs bg-[#EFF6FF] text-[#0E2F76] font-medium px-2 py-0.5 rounded-full">{task.frequency}</span>
                    <span className="text-xs text-[#7A9CC0]">{task.shiftName}</span>
                    <span className={`text-xs font-medium ${task.isOverdue ? 'text-red-600' : isToday ? 'text-[#0E2F76]' : 'text-[#7A9CC0]'}`}>
                      {task.isOverdue ? '⚠️ Overdue — ' : isToday ? '📅 Today — ' : ''}{formatDate(task.dueDate)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Task modal */}
      {selectedTask && <TaskModal taskId={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
