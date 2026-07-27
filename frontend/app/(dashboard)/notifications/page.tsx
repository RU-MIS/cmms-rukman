'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, AlertTriangle, Clock, CheckCircle2, X, ArrowRight } from 'lucide-react';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useRouter } from 'next/navigation';

const NOTIF_ICONS: Record<string, { icon: any; bg: string; color: string }> = {
  Task_Due:            { icon: Clock,         bg: 'bg-amber-50',  color: 'text-amber-600' },
  Task_Overdue:        { icon: AlertTriangle, bg: 'bg-red-50',    color: 'text-red-600' },
  Verification_Needed: { icon: CheckCircle2,  bg: 'bg-blue-50',   color: 'text-blue-600' },
  Task_Rejected:       { icon: X,             bg: 'bg-red-50',    color: 'text-red-600' },
  Handover:            { icon: ArrowRight,    bg: 'bg-[#EFF6FF]', color: 'text-[#0E2F76]' },
  System:              { icon: Bell,          bg: 'bg-[#EFF6FF]', color: 'text-[#0E2F76]' },
};

export default function NotificationsPage() {
  const qc     = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn:  () => api.get('/notifications?limit=50').then(r => r.data),
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/mark-all-read'),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = data?.data || [];
  const unread = notifications.filter((n: any) => !n.is_read).length;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Notifications</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{unread} unread</p>
        </div>
        {unread > 0 && (
          <button onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            className="flex items-center gap-2 text-sm font-medium text-[#0E2F76] bg-[#EFF6FF] hover:bg-[#D4E4F7] border border-[#D4E4F7] px-3 py-2 rounded-lg transition-colors">
            <CheckCheck className="w-4 h-4" />
            {markAllMutation.isPending ? 'Marking...' : 'Mark all read'}
          </button>
        )}
      </div>

      {/* Notification list */}
      <div className="space-y-2">
        {isLoading ? (
          Array(5).fill(0).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-[#D4E4F7] p-4 animate-pulse flex gap-3">
              <div className="w-10 h-10 bg-[#D4E4F7] rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-[#D4E4F7] rounded w-3/4" />
                <div className="h-3 bg-[#D4E4F7] rounded w-full" />
                <div className="h-3 bg-[#D4E4F7] rounded w-1/4" />
              </div>
            </div>
          ))
        ) : notifications.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#D4E4F7] py-16 text-center">
            <Bell className="w-12 h-12 text-[#AAC0E1] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#0A1F4E]">No notifications</p>
            <p className="text-xs text-[#7A9CC0] mt-1">You're all caught up!</p>
          </div>
        ) : notifications.map((notif: any) => {
          const cfg = NOTIF_ICONS[notif.type] || NOTIF_ICONS['System'];
          const Icon = cfg.icon;
          return (
            <div key={notif.notif_id}
              onClick={() => { if (!notif.is_read) markReadMutation.mutate(notif.notif_id); }}
              className={`bg-white rounded-xl border p-4 flex gap-3 cursor-pointer transition-all hover:shadow-sm ${
                !notif.is_read ? 'border-[#AAC0E1] bg-[#F5FEFF]/80' : 'border-[#D4E4F7]'
              }`}>
              <div className={`w-10 h-10 ${cfg.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${cfg.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm font-semibold ${!notif.is_read ? 'text-[#0A1F4E]' : 'text-[#3A5A8A]'}`}>
                    {notif.title}
                  </p>
                  {!notif.is_read && <span className="w-2 h-2 bg-[#0E2F76] rounded-full flex-shrink-0 mt-1" />}
                </div>
                <p className="text-xs text-[#7A9CC0] mt-0.5 leading-relaxed">{notif.message}</p>
                <p className="text-xs text-[#AAC0E1] mt-1.5">{formatDateTime(notif.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
