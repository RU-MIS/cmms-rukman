import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return dayjs(date).format('DD/MM/YYYY');
}

export function formatDateTime(date: string | Date): string {
  return dayjs(date).format('DD/MM/YYYY HH:mm');
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    Completed:   'badge-success',
    Verified:    'badge-success',
    Pending:     'badge-warning',
    'In Progress':'badge-info',
    Overdue:     'badge-danger',
    Rejected:    'badge-danger',
    Skipped:     'badge-gray',
    Active:      'badge-success',
    Inactive:    'badge-gray',
    'Under Maintenance': 'badge-warning',
  };
  return map[status] || 'badge-gray';
}

export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}
