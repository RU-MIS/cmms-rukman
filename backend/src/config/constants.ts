/**
 * constants.ts
 * ────────────
 * Single source of truth for ALL constants used across the backend.
 * Never hardcode strings like 'Admin' or 'Daily' anywhere else.
 * Always import from here.
 *
 * Usage: import { ROLES, FREQUENCIES, TABLE } from '@config/constants'
 */

// ── Database table names ─────────────────────────────────────────
export const TABLE = {
  SETTINGS:              'settings',
  ROLES:                 'roles',
  DEPARTMENTS:           'departments',
  SHIFTS:                'shifts',
  USERS:                 'users',
  MACHINES:              'machines',
  MACHINE_ASSIGNMENTS:   'machine_assignments',
  CHECKLIST_TEMPLATES:   'checklist_templates',
  CHECKLIST_ITEMS:       'checklist_items',
  MACHINE_TEMPLATE_MAP:  'machine_template_map',
  TASK_MASTER:           'task_master',
  TASK_RESPONSES:        'task_responses',
  TASK_VERIFICATION:     'task_verification',
  NOTIFICATIONS:         'notifications',
  AUDIT_LOGS:            'audit_logs',
} as const;

// ── ID prefixes — USR000001 format ──────────────────────────────
export const ID_PREFIX = {
  USER:         'USR',
  MACHINE:      'MAC',
  DEPARTMENT:   'DEP',
  SHIFT:        'SHF',
  ROLE:         'ROL',
  TEMPLATE:     'TMP',
  ITEM:         'ITM',
  TASK:         'TSK',
  RESPONSE:     'RSP',
  VERIFICATION: 'VRF',
  ASSIGNMENT:   'ASN',
  MAP:          'MAP',
  NOTIFICATION: 'NTF',
  LOG:          'LOG',
} as const;

export const ID_PAD_LENGTH = 6; // USR + 000001 = 9 chars total

// ── Roles ────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN:       'Admin',
  SUPERVISOR:  'Supervisor',
  TECHNICIAN:  'Technician',
  VIEWER:      'Viewer',
} as const;

export type RoleType = typeof ROLES[keyof typeof ROLES];

// ── Departments (pre-seeded) ─────────────────────────────────────
export const DEPARTMENTS = {
  BLOW_MOULDING:     'Blow Moulding',
  INJECTION_MOULDING:'Injection Moulding',
  PAINT_SHOP:        'Paint Shop',
  ASSEMBLY:          'Assembly',
  QUALITY_CONTROL:   'Quality Control',
  MAINTENANCE:       'Maintenance',
  HR_ADMIN:          'HR / Admin',
} as const;

// ── Shifts (pre-seeded) ──────────────────────────────────────────
export const SHIFTS = {
  DAY:   'Day Shift',
  NIGHT: 'Night Shift',
} as const;

// ── Task frequencies ─────────────────────────────────────────────
export const FREQUENCY = {
  DAILY:       'Daily',
  TEN_DAY:     '10-Day',
  FIFTEEN_DAY: '15-Day',
  WEEKLY:      'Weekly',
  MONTHLY:     'Monthly',
  QUARTERLY:   'Quarterly',
  HALF_YEARLY: 'Half-Yearly',
  YEARLY:      'Yearly',
  ON_DEMAND:   'On-Demand',
} as const;

export type FrequencyType = typeof FREQUENCY[keyof typeof FREQUENCY];

// ── Frequencies where photo is required ─────────────────────────
export const PHOTO_REQUIRED_FREQUENCIES: FrequencyType[] = [
  FREQUENCY.TEN_DAY,
  FREQUENCY.FIFTEEN_DAY,
  FREQUENCY.WEEKLY,
  FREQUENCY.MONTHLY,
  FREQUENCY.QUARTERLY,
  FREQUENCY.HALF_YEARLY,
  FREQUENCY.YEARLY,
  FREQUENCY.ON_DEMAND,
];

// ── Checklist item input types ───────────────────────────────────
export const INPUT_TYPE = {
  CHECKBOX:    'Checkbox',
  PASS_FAIL:   'PassFail',
  YES_NO:      'YesNo',
  DROPDOWN:    'Dropdown',
  TEXT:        'Text',
  NUMBER:      'Number',
  DECIMAL:     'Decimal',
  TEMPERATURE: 'Temperature',
  PRESSURE:    'Pressure',
  DATE:        'Date',
  TIME:        'Time',
  PHOTO:       'Photo',
  REMARKS:     'Remarks',
} as const;

export type InputType = typeof INPUT_TYPE[keyof typeof INPUT_TYPE];

// ── Task statuses ────────────────────────────────────────────────
export const TASK_STATUS = {
  PENDING:     'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  VERIFIED:    'Verified',
  OVERDUE:     'Overdue',
  SKIPPED:     'Skipped',
  REJECTED:    'Rejected',
} as const;

export type TaskStatusType = typeof TASK_STATUS[keyof typeof TASK_STATUS];

// ── Verification statuses ────────────────────────────────────────
export const VERIFY_STATUS = {
  APPROVED:          'Approved',
  REJECTED:          'Rejected',
  NEEDS_CORRECTION:  'Needs Correction',
} as const;

// ── Machine statuses ─────────────────────────────────────────────
export const MACHINE_STATUS = {
  ACTIVE:            'Active',
  UNDER_MAINTENANCE: 'Under Maintenance',
  INACTIVE:          'Inactive',
} as const;

// ── Notification types ───────────────────────────────────────────
export const NOTIFICATION_TYPE = {
  TASK_DUE:            'Task_Due',
  TASK_OVERDUE:        'Task_Overdue',
  VERIFICATION_NEEDED: 'Verification_Needed',
  TASK_REJECTED:       'Task_Rejected',
  HANDOVER:            'Handover',
  SYSTEM:              'System',
} as const;

// ── Notification channels ────────────────────────────────────────
export const NOTIFICATION_CHANNEL = {
  IN_APP: 'InApp',
  EMAIL:  'Email',
  GCHAT:  'GChat',
  ALL:    'All',
} as const;

// ── Audit actions ────────────────────────────────────────────────
export const AUDIT_ACTION = {
  CREATE:   'CREATE',
  UPDATE:   'UPDATE',
  DELETE:   'DELETE',
  LOGIN:    'LOGIN',
  LOGOUT:   'LOGOUT',
  VERIFY:   'VERIFY',
  ASSIGN:   'ASSIGN',
  HANDOVER: 'HANDOVER',
  GENERATE: 'GENERATE',
} as const;

// ── Audit modules ────────────────────────────────────────────────
export const AUDIT_MODULE = {
  USER:       'User',
  MACHINE:    'Machine',
  DEPARTMENT: 'Department',
  CHECKLIST:  'Checklist',
  TASK:       'Task',
  ASSIGNMENT: 'Assignment',
  SCHEDULER:  'Scheduler',
  REPORT:     'Report',
  AUTH:       'Auth',
} as const;

// ── RBAC Permissions map ─────────────────────────────────────────
// C=Create R=Read U=Update D=Delete V=Verify
export const PERMISSIONS = {
  Admin: {
    dashboard:   ['R'],
    machines:    ['C','R','U','D'],
    employees:   ['C','R','U','D'],
    departments: ['C','R','U','D'],
    checklists:  ['C','R','U','D'],
    tasks:       ['C','R','U','D','V'],
    reports:     ['R'],
    settings:    ['C','R','U','D'],
    audit:       ['R'],
    scheduler:   ['C','R','U','D'],
    notifications:['R'],
  },
  Supervisor: {
    dashboard:   ['R'],
    machines:    ['R','U'],
    employees:   ['R'],
    departments: ['R'],
    checklists:  ['C','R','U'],
    tasks:       ['C','R','U','V'],
    reports:     ['R'],
    settings:    [],
    audit:       ['R'],
    scheduler:   ['R','U'],
    notifications:['R'],
  },
  Technician: {
    dashboard:   ['R'],
    machines:    ['R'],
    employees:   [],
    departments: ['R'],
    checklists:  ['R'],
    tasks:       ['R','U'],
    reports:     ['R'],
    settings:    [],
    audit:       [],
    scheduler:   [],
    notifications:['R'],
  },
  Viewer: {
    dashboard:   ['R'],
    machines:    ['R'],
    employees:   [],
    departments: ['R'],
    checklists:  ['R'],
    tasks:       ['R'],
    reports:     ['R'],
    settings:    [],
    audit:       [],
    scheduler:   [],
    notifications:['R'],
  },
} as const;

// ── Google Drive folder structure ────────────────────────────────
export const DRIVE_FOLDER = {
  ROOT:   'CMMS-RukmanUdyog',
  PHOTOS: 'Photos',
} as const;

// ── Scheduler cron expressions ───────────────────────────────────
// Daily task generation: every day at 00:01 AM
export const CRON = {
  DAILY_TASK_GEN:    '1 0 * * *',
  OVERDUE_CHECK:     '*/30 * * * *',  // Every 30 minutes
  NOTIFICATION_SEND: '0 8 * * *',     // 8 AM daily digest
  CLEANUP_OLD_LOGS:  '0 2 * * 0',     // Every Sunday 2 AM
} as const;

// ── Pagination defaults ──────────────────────────────────────────
export const PAGINATION = {
  DEFAULT_PAGE:     1,
  DEFAULT_LIMIT:    20,
  MAX_LIMIT:        100,
} as const;

// ── Token settings ───────────────────────────────────────────────
export const TOKEN = {
  HEADER_NAME:     'Authorization',
  BEARER_PREFIX:   'Bearer ',
  COOKIE_NAME:     'cmms_refresh_token',
} as const;
