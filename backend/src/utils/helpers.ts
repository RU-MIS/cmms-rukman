/**
 * helpers.ts
 * ──────────
 * Reusable utility functions used across the entire backend.
 */

import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from '../config/environment';
import { PAGINATION, FREQUENCY, FrequencyType } from '../config/constants';

// Re-export FrequencyType so other modules can import from helpers
export type { FrequencyType } from '../config/constants';

dayjs.extend(utc);
dayjs.extend(timezone);
const IST = 'Asia/Kolkata';

// ── API RESPONSE FORMATTERS ──────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: PaginationMeta;
  errors?: ValidationError[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function successResponse<T>(
  message: string,
  data?: T,
  meta?: PaginationMeta
): ApiResponse<T> {
  return { success: true, message, data, meta };
}

export function errorResponse(
  message: string,
  errors?: ValidationError[]
): ApiResponse {
  return { success: false, message, errors };
}

// ── PAGINATION ────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  let page  = parseInt(String(query.page  || PAGINATION.DEFAULT_PAGE),  10);
  let limit = parseInt(String(query.limit || PAGINATION.DEFAULT_LIMIT), 10);
  if (isNaN(page)  || page  < 1) page  = PAGINATION.DEFAULT_PAGE;
  if (isNaN(limit) || limit < 1) limit = PAGINATION.DEFAULT_LIMIT;
  if (limit > PAGINATION.MAX_LIMIT) limit = PAGINATION.MAX_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

// ── DATE / TIME ───────────────────────────────────────────────────

export function nowIST() {
  return dayjs().tz(IST);
}

export function todayIST(): string {
  return nowIST().format('YYYY-MM-DD');
}

export function toMySQLDateTime(date: Date | string | dayjs.Dayjs): string {
  return dayjs(date).tz(IST).format('YYYY-MM-DD HH:mm:ss');
}

export function toDisplayDateTime(date: Date | string): string {
  return dayjs(date).tz(IST).format('DD/MM/YYYY HH:mm');
}

export function toDisplayDate(date: Date | string): string {
  return dayjs(date).tz(IST).format('DD/MM/YYYY');
}

export function calculateNextDueDate(
  frequency: FrequencyType,
  scheduleStartDate: string,
  lastGeneratedDate: string | null
): string | null {
  const today     = nowIST().startOf('day');
  const startDate = dayjs(scheduleStartDate).tz(IST).startOf('day');

  if (startDate.isAfter(today)) return null;
  if (!lastGeneratedDate) return startDate.format('YYYY-MM-DD');

  const lastGen = dayjs(lastGeneratedDate).tz(IST).startOf('day');
  let nextDate: dayjs.Dayjs;

  switch (frequency) {
    case FREQUENCY.DAILY:        nextDate = lastGen.add(1,  'day');   break;
    case FREQUENCY.TEN_DAY:      nextDate = lastGen.add(10, 'day');   break;
    case FREQUENCY.FIFTEEN_DAY:  nextDate = lastGen.add(15, 'day');   break;
    case FREQUENCY.WEEKLY:       nextDate = lastGen.add(7,  'day');   break;
    case FREQUENCY.MONTHLY:      nextDate = lastGen.add(1,  'month'); break;
    case FREQUENCY.QUARTERLY:    nextDate = lastGen.add(3,  'month'); break;
    case FREQUENCY.HALF_YEARLY:  nextDate = lastGen.add(6,  'month'); break;
    case FREQUENCY.YEARLY:       nextDate = lastGen.add(1,  'year');  break;
    case FREQUENCY.ON_DEMAND:    return null;
    default:                     return null;
  }

  if (nextDate.isBefore(today) || nextDate.isSame(today, 'day')) {
    return nextDate.format('YYYY-MM-DD');
  }
  return null;
}

export function isTaskOverdue(dueDate: string, status: string): boolean {
  if (!['Pending', 'In Progress'].includes(status)) return false;
  return dayjs(dueDate).tz(IST).isBefore(nowIST().startOf('day'));
}

// ── PASSWORD HELPERS ──────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateTempPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── STRING HELPERS ────────────────────────────────────────────────

export function sanitizeString(value: string): string {
  return value.trim().replace(/[<>'"]/g, '');
}

export function nameToUsername(fullName: string): string {
  return fullName.toLowerCase().trim().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

// ── VALIDATION HELPERS ────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

export function isValidDate(dateStr: string): boolean {
  return dayjs(dateStr, 'YYYY-MM-DD', true).isValid();
}

export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

// ── GOOGLE DRIVE PATH BUILDER ─────────────────────────────────────

export function buildDrivePath(machineId: string, templateId: string, frequency: string): string {
  const now = nowIST();
  return `Photos/${now.format('YYYY')}/${now.format('MM-MMMM')}/${machineId}/${templateId}-${frequency}`;
}

export function buildDriveFilename(taskId: string, itemId: string, responseId: string, extension = 'jpg'): string {
  return `${taskId}_${itemId}_${responseId}.${extension}`;
}
