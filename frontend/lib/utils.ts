import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}

export function formatNumber(value: number | string | null | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return dayjs(value).format('DD-MMM-YYYY');
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return dayjs(value).format('DD-MMM-YYYY, hh:mm A');
}
