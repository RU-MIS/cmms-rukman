'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Eye, CheckCircle2, XCircle, AlertCircle, ChevronRight, X, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatDate, formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';

// ── Verify Modal ──────────────────────────────────────────────────
function VerifyModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'Approved' | 'Rejected' | 'Needs Correction'>('Approved');
  const [comments, setComments] = useState('');

  const { data: task, isLoading } = useQuery({
    queryKey: ['task-verify', taskId],
    queryFn:  () => api.get(`/tasks/${taskId}`).then(r => r.data.data),
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/verify`, { status, comments }),
    onSuccess: () => {
      toast.success(`Task ${status.toLowerCase()}!`);
      qc.invalidateQueries({ queryKey: ['verify-tasks'] });
      onClose();
    },
  });

  const inputTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      PassFail: '✅/❌', YesNo: 'Yes/No', Checkbox: '☑️',
      Temperature: '°C', Pressure: 'PSI', Photo: '📷',
    };
    return map[type] || type;
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#D4E4F7] flex-shrink-0">
          <div>
            {task && (
              <>
                <h2 className="text-base font-semibold text-[#0A1F4E]">Verify inspection</h2>
                <p className="text-xs text-[#7A9CC0] mt-0.5">
                  {task.machineName} · {task.templateName} · {formatDate(task.dueDate)}
                </p>
                <p className="text-xs text-[#3A5A8A] mt-0.5">
                  Completed by: <span className="font-semibold">{task.currentAssigneeName}</span>
                  {task.currentAssignedTo !== task.originalAssignedTo && (
                    <span className="text-amber-600 ml-1">(handed over from {task.originalAssigneeName})</span>
                  )}
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] p-1"><X className="w-5 h-5" /></button>
        </div>

        {/* Responses */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => <div key={i} className="h-16 bg-[#D4E4F7] rounded-lg animate-pulse" />)
          ) : (task?.items || []).map((item: any, idx: number) => {
            const hasResponse = item.responseValue !== null && item.responseValue !== '';
            const isFail = item.responseValue === 'Fail' || item.responseValue === 'No' || item.responseValue === 'false';
            const isPass = item.responseValue === 'Pass' || item.responseValue === 'Yes' || item.responseValue === 'true';

            return (
              <div key={item.itemId} className={`rounded-lg border p-3 ${
                !hasResponse && item.isMandatory ? 'border-red-200 bg-red-50/30' :
                isFail ? 'border-red-100 bg-red-50/20' :
                isPass ? 'border-green-100 bg-green-50/20' :
                'border-[#D4E4F7] bg-[#F5FEFF]'
              }`}>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold text-[#AAC0E1] flex-shrink-0 mt-0.5">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-[#0A1F4E] font-medium">
                        {item.itemText}
                        {item.isMandatory && <span className="text-red-500 ml-1">*</span>}
                      </p>
                      <span className="text-xs bg-white border border-[#D4E4F7] px-1.5 py-0.5 rounded flex-shrink-0">
                        {inputTypeLabel(item.inputType)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {!hasResponse ? (
                        <span className="text-xs font-semibold text-red-500">⚠️ No response</span>
                      ) : (
                        <span className={`text-sm font-bold ${isFail ? 'text-red-600' : isPass ? 'text-green-600' : 'text-[#0A1F4E]'}`}>
                          {item.responseValue}
                          {item.unit && <span className="text-xs font-normal text-[#7A9CC0] ml-1">{item.unit}</span>}
                        </span>
                      )}
                    </div>
                    {item.photoUrl && (
                      <a href={item.photoUrl} target="_blank" rel="noreferrer"
                        className="text-xs text-[#0E2F76] underline mt-1 block">📷 View photo</a>
                    )}
                    {item.remarks && <p className="text-xs text-[#7A9CC0] mt-1 italic">Remark: {item.remarks}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Verification decision */}
        <div className="p-5 border-t border-[#D4E4F7] flex-shrink-0 space-y-4">
          <div>
            <p className="text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-2">Verification decision</p>
            <div className="grid grid-cols-3 gap-2">
              {(['Approved', 'Needs Correction', 'Rejected'] as const).map(opt => (
                <button key={opt} onClick={() => setStatus(opt)}
                  className={`py-2.5 text-xs font-semibold rounded-lg border transition-all ${
                    status === opt
                      ? opt === 'Approved'    ? 'bg-green-500 text-white border-green-500'
                      : opt === 'Rejected'   ? 'bg-red-500 text-white border-red-500'
                      :                        'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-[#3A5A8A] border-[#AAC0E1] hover:border-[#0E2F76]'
                  }`}>{opt}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">
              Comments {status !== 'Approved' && <span className="text-red-500">*</span>}
            </label>
            <textarea className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 resize-none h-16"
              value={comments} onChange={e => setComments(e.target.value)}
              placeholder={status === 'Approved' ? 'Optional comments...' : 'Please explain the issue...'} />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7]">Cancel</button>
            <button onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending || (status !== 'Approved' && !comments.trim())}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 flex items-center gap-2 ${
                status === 'Approved' ? 'bg-green-600 hover:bg-green-700' :
                status === 'Rejected' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'
              }`}>
              {verifyMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Processing...</> : `Submit — ${status}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Verify Page ──────────────────────────────────────────────
export default function VerifyPage() {
  const { isRole } = useAuthStore();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['verify-tasks'],
    queryFn: () => api.get('/tasks', { params: { status: 'Completed', limit: 50 } }).then(r => r.data),
    refetchInterval: 30000,
  });

  const tasks = data?.data || [];

  if (!isRole(['Admin', 'Supervisor'])) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <ShieldCheck className="w-12 h-12 text-[#AAC0E1] mx-auto mb-3" />
          <p className="text-sm font-semibold text-[#0A1F4E]">Access restricted</p>
          <p className="text-xs text-[#7A9CC0] mt-1">Only supervisors and admins can verify tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0A1F4E]">Pending verification</h1>
        <p className="text-sm text-[#7A9CC0] mt-0.5">{tasks.length} tasks waiting for your review</p>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-[#D4E4F7] p-4 animate-pulse">
              <div className="flex gap-3">
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
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#0A1F4E]">All clear!</p>
            <p className="text-xs text-[#7A9CC0] mt-1">No tasks pending verification</p>
          </div>
        ) : tasks.map((task: any) => (
          <button key={task.taskId} onClick={() => setSelectedTask(task.taskId)}
            className="w-full bg-white rounded-xl border border-[#AAC0E1] p-4 text-left hover:border-[#0E2F76] hover:shadow-sm transition-all group">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#0A1F4E]">{task.templateName}</p>
                    <p className="text-xs text-[#7A9CC0] mt-0.5">{task.machineName} · {task.machineCode}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full">Needs review</span>
                    <ChevronRight className="w-4 h-4 text-[#AAC0E1] group-hover:text-[#0E2F76]" />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-xs bg-[#EFF6FF] text-[#0E2F76] font-medium px-2 py-0.5 rounded-full">{task.frequency}</span>
                  <span className="text-xs text-[#7A9CC0]">Due: {formatDate(task.dueDate)}</span>
                  <span className="text-xs text-[#3A5A8A]">By: <span className="font-medium">{task.currentAssigneeName}</span></span>
                  <span className="text-xs text-[#7A9CC0]">{task.shiftName}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedTask && <VerifyModal taskId={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
