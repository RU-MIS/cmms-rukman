/**
 * helpers.ts
 * ──────────
 * Reusable utility functions used across the entire backend.
 * Each function does exactly ONE thing.
 *
 * Categories:
 * - API Response formatters
 * - Pagination helpers
 * - Date/time helpers (IST aware)
 * - Password helpers
 * - String helpers
 * - Validation helpers
 */

import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from '../config/environment';
import { PAGINATION, FrequencyType, FREQUENCY } from '../config/constants';

// Configure dayjs for IST
dayjs.extend(utc);
dayjs.extend(timezone);
const IST = 'Asia/Kolkata';

// ────────────────────────────────────────────────────────────────
// API RESPONSE FORMATTERS
// ────────────────────────────────────────────────────────────────

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

/** Format a successful API response */
export function successResponse<T>(
  message: string,
  data?: T,
  meta?: PaginationMeta
): ApiResponse<T> {
  return { success: true, message, data, meta };
}

/** Format an error API response */
export function errorResponse(
  message: string,
  errors?: ValidationError[]
): ApiResponse {
  return { success: false, message, errors };
}

// ────────────────────────────────────────────────────────────────
// PAGINATION
// ────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

/**
 * Parse and validate pagination params from query string.
 * Falls back to defaults if invalid values are provided.
 */
export function parsePagination(query: Record<string, unknown>): PaginationParams {
  let page = parseInt(String(query.page || PAGINATION.DEFAULT_PAGE), 10);
  let limit = parseInt(String(query.limit || PAGINATION.DEFAULT_LIMIT), 10);

  if (isNaN(page) || page < 1) page = PAGINATION.DEFAULT_PAGE;
  if (isNaN(limit) || limit < 1) limit = PAGINATION.DEFAULT_LIMIT;
  if (limit > PAGINATION.MAX_LIMIT) limit = PAGINATION.MAX_LIMIT;

  return { page, limit, offset: (page - 1) * limit };
}

/** Build pagination meta from total count */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ────────────────────────────────────────────────────────────────
// DATE / TIME — ALL IN IST
// ────────────────────────────────────────────────────────────────

/** Get current date+time in IST as a dayjs object */
export function nowIST() {
  return dayjs().tz(IST);
}

/** Get today's date string in YYYY-MM-DD (IST) */
export function todayIST(): string {
  return nowIST().format('YYYY-MM-DD');
}

/** Format a date for MySQL storage: YYYY-MM-DD HH:mm:ss */
export function toMySQLDateTime(date: Date | string | dayjs.Dayjs): string {
  return dayjs(date).tz(IST).format('YYYY-MM-DD HH:mm:ss');
}

/** Format a date for display: DD/MM/YYYY HH:mm */
export function toDisplayDateTime(date: Date | string): string {
  return dayjs(date).tz(IST).format('DD/MM/YYYY HH:mm');
}

/** Format a date for display: DD/MM/YYYY */
export function toDisplayDate(date: Date | string): string {
  return dayjs(date).tz(IST).format('DD/MM/YYYY');
}

/**
 * Calculate the next due date based on frequency and schedule start date.
 * Admin sets schedule_start_date — system calculates all subsequent dates from there.
 *
 * @param frequency - Task frequency type
 * @param scheduleStartDate - The start date admin configured
 * @param lastGeneratedDate - The last time a task was generated (null = never)
 * @returns Next due date as YYYY-MM-DD string, or null if not due yet
 */
export function calculateNextDueDate(
  frequency: FrequencyType,
  scheduleStartDate: string,
  lastGeneratedDate: string | null
): string | null {
  const today = nowIST().startOf('day');
  const startDate = dayjs(scheduleStartDate).tz(IST).startOf('day');

  // If start date is in the future, nothing to generate yet
  if (startDate.isAfter(today)) return null;

  // If never generated, the start date is the first due date
  if (!lastGeneratedDate) {
    return startDate.format('YYYY-MM-DD');
  }

  const lastGen = dayjs(lastGeneratedDate).tz(IST).startOf('day');
  let nextDate: dayjs.Dayjs;

  switch (frequency) {
    case FREQUENCY.DAILY:
      // Daily is handled separately — generates for both shifts each day
      nextDate = lastGen.add(1, 'day');
      break;
    case FREQUENCY.TEN_DAY:
      nextDate = lastGen.add(10, 'day');
      break;
    case FREQUENCY.FIFTEEN_DAY:
      nextDate = lastGen.add(15, 'day');
      break;
    case FREQUENCY.WEEKLY:
      nextDate = lastGen.add(7, 'day');
      break;
    case FREQUENCY.MONTHLY:
      // Same day of month as start date
      nextDate = lastGen.add(1, 'month');
      break;
    case FREQUENCY.QUARTERLY:
      nextDate = lastGen.add(3, 'month');
      break;
    case FREQUENCY.HALF_YEARLY:
      nextDate = lastGen.add(6, 'month');
      break;
    case FREQUENCY.YEARLY:
      nextDate = lastGen.add(1, 'year');
      break;
    case FREQUENCY.ON_DEMAND:
      // On-demand tasks are never auto-generated
      return null;
    default:
      return null;
  }

  // Only return if next date is today or in the past (overdue)
  if (nextDate.isBefore(today) || nextDate.isSame(today, 'day')) {
    return nextDate.format('YYYY-MM-DD');
  }

  return null; // Not due yet
}

/**
 * Check if a task is overdue.
 * A task is overdue if its due_date is before today and status is still Pending/In Progress.
 */
export function isTaskOverdue(dueDate: string, status: string): boolean {
  if (!['Pending', 'In Progress'].includes(status)) return false;
  return dayjs(dueDate).tz(IST).isBefore(nowIST().startOf('day'));
}

// ────────────────────────────────────────────────────────────────
// PASSWORD HELPERS
// ────────────────────────────────────────────────────────────────

/** Hash a plain-text password using bcrypt */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

/** Compare plain-text password against stored hash */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generate a random temporary password */
export function generateTempPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// ────────────────────────────────────────────────────────────────
// STRING HELPERS
// ────────────────────────────────────────────────────────────────

/** Sanitize string — trim whitespace, remove dangerous chars */
export function sanitizeString(value: string): string {
  return value.trim().replace(/[<>'"]/g, '');
}

/** Convert name to username: "Ramesh Kumar" → "ramesh.kumar" */
export function nameToUsername(fullName: string): string {
  return fullName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]/g, '');
}

/** Truncate long strings for display */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

// ────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ────────────────────────────────────────────────────────────────

/** Check if a string is a valid email */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Check if a string is a valid Indian mobile number */
export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

/** Check if a string is a valid date (YYYY-MM-DD) */
export function isValidDate(dateStr: string): boolean {
  return dayjs(dateStr, 'YYYY-MM-DD', true).isValid();
}

/** Check if a value is within a numeric range */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

// ────────────────────────────────────────────────────────────────
// GOOGLE DRIVE PATH BUILDER
// ────────────────────────────────────────────────────────────────

/**
 * Build Google Drive file path for a photo upload.
 * Format: Photos/YYYY/MM-MonthName/MachineID/TemplateID-Frequency/
 */
export function buildDrivePath(
  machineId: string,
  templateId: string,
  frequency: string
): string {
  const now = nowIST();
  const year = now.format('YYYY');
  const month = now.format('MM-MMMM'); // e.g. "01-January"
  return `Photos/${year}/${month}/${machineId}/${templateId}-${frequency}`;
}

/**
 * Build Google Drive filename for a photo.
 * Format: {TaskID}_{ItemID}_{ResponseID}.jpg
 */
export function buildDriveFilename(
  taskId: string,
  itemId: string,
  responseId: string,
  extension = 'jpg'
): string {
  return `${taskId}_${itemId}_${responseId}.${extension}`;
}
