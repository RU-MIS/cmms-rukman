/**
 * report.service.ts
 * ─────────────────
 * All reporting queries — machine, dept, employee, date-wise.
 * Read-only — no data modification.
 *
 * Functions:
 * - getComplianceReport()    → overall compliance by date range
 * - getMachineReport()       → machine-wise task summary
 * - getDeptReport()          → department-wise compliance
 * - getEmployeeReport()      → employee-wise task summary
 * - getFrequencyReport()     → frequency-wise breakdown
 * - getTaskDetailReport()    → detailed task list with responses
 * - getOverdueReport()       → all overdue tasks with aging
 */

import { db } from '../../config/database';
import { TABLE, TASK_STATUS } from '../../config/constants';
import { parsePagination, buildPaginationMeta } from '../../utils/helpers';

// ── Types ──────────────────────────────────────────────────────────
export interface ReportFilters {
  fromDate?:  string;
  toDate?:    string;
  machineId?: string;
  deptId?:    string;
  userId?:    string;
  frequency?: string;
  status?:    string;
  page?:      number;
  limit?:     number;
}

// ── Compliance summary report ──────────────────────────────────────
export async function getComplianceReport(filters: ReportFilters) {
  const { fromDate, toDate, deptId } = filters;

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate) { conditions.push('tm.due_date >= ?'); params.push(fromDate); }
  if (toDate)   { conditions.push('tm.due_date <= ?'); params.push(toDate); }
  if (deptId)   { conditions.push('m.dept_id = ?');    params.push(deptId); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       COUNT(*)                                                              AS total,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN tm.status = 'Pending'                 THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN tm.status = 'Verified'                THEN 1 ELSE 0 END) AS verified,
       SUM(CASE WHEN tm.status = 'Rejected'                THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN tm.status = 'In Progress'             THEN 1 ELSE 0 END) AS in_progress
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES} m ON tm.machine_id = m.machine_id
     WHERE ${where}`,
    params
  );

  const row   = rows[0];
  const total = Number(row.total || 0);
  const done  = Number(row.completed || 0);

  return {
    total,
    completed:    done,
    pending:      Number(row.pending    || 0),
    overdue:      Number(row.overdue    || 0),
    verified:     Number(row.verified   || 0),
    rejected:     Number(row.rejected   || 0),
    inProgress:   Number(row.in_progress|| 0),
    complianceRate: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

// ── Machine-wise report ────────────────────────────────────────────
export async function getMachineReport(filters: ReportFilters) {
  const { fromDate, toDate, deptId, machineId } = filters;
  const { page, limit, offset } = parsePagination(filters as any);

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate)  { conditions.push('tm.due_date >= ?');  params.push(fromDate); }
  if (toDate)    { conditions.push('tm.due_date <= ?');  params.push(toDate); }
  if (deptId)    { conditions.push('m.dept_id = ?');     params.push(deptId); }
  if (machineId) { conditions.push('m.machine_id = ?');  params.push(machineId); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       m.machine_id,   m.machine_name,   m.machine_code,
       d.dept_name,
       COUNT(tm.task_id)                                                        AS total,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END)  AS completed,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END)  AS overdue,
       SUM(CASE WHEN tm.status = 'Pending'                 THEN 1 ELSE 0 END)  AS pending,
       SUM(CASE WHEN tm.status = 'Verified'                THEN 1 ELSE 0 END)  AS verified,
       MAX(tm.due_date)                                                         AS last_due,
       MAX(tm.completed_at)                                                     AS last_completed
     FROM ${TABLE.MACHINES} m
     JOIN ${TABLE.DEPARTMENTS} d  ON m.dept_id     = d.dept_id
     JOIN ${TABLE.TASK_MASTER} tm ON tm.machine_id = m.machine_id
     WHERE ${where}
     GROUP BY m.machine_id
     ORDER BY overdue DESC, total DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(DISTINCT m.machine_id) AS total
     FROM ${TABLE.MACHINES} m
     JOIN ${TABLE.TASK_MASTER} tm ON tm.machine_id = m.machine_id
     JOIN ${TABLE.DEPARTMENTS} d  ON m.dept_id     = d.dept_id
     WHERE ${where}`,
    params
  );

  return {
    data: rows.map(r => ({
      machineId:      r.machine_id,
      machineName:    r.machine_name,
      machineCode:    r.machine_code,
      deptName:       r.dept_name,
      total:          Number(r.total),
      completed:      Number(r.completed),
      overdue:        Number(r.overdue),
      pending:        Number(r.pending),
      verified:       Number(r.verified),
      complianceRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
      lastDue:        r.last_due,
      lastCompleted:  r.last_completed,
    })),
    meta: buildPaginationMeta(Number(countRows[0]?.count || countRows[0]?.total || 0), page, limit),
    summary: await getComplianceReport(filters),
  };
}

// ── Department-wise report ─────────────────────────────────────────
export async function getDeptReport(filters: ReportFilters) {
  const { fromDate, toDate } = filters;

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate) { conditions.push('tm.due_date >= ?'); params.push(fromDate); }
  if (toDate)   { conditions.push('tm.due_date <= ?'); params.push(toDate); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       d.dept_id,    d.dept_name,   d.dept_code,
       COUNT(tm.task_id)                                                       AS total,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN tm.status = 'Pending'                 THEN 1 ELSE 0 END) AS pending,
       COUNT(DISTINCT tm.machine_id)                                           AS machine_count,
       COUNT(DISTINCT tm.current_assigned_to)                                  AS operator_count
     FROM ${TABLE.DEPARTMENTS} d
     JOIN ${TABLE.MACHINES}    m  ON m.dept_id     = d.dept_id
     JOIN ${TABLE.TASK_MASTER} tm ON tm.machine_id = m.machine_id
     WHERE ${where}
     GROUP BY d.dept_id
     ORDER BY d.dept_name`,
    params
  );

  return rows.map(r => ({
    deptId:         r.dept_id,
    deptName:       r.dept_name,
    deptCode:       r.dept_code,
    total:          Number(r.total),
    completed:      Number(r.completed),
    overdue:        Number(r.overdue),
    pending:        Number(r.pending),
    machineCount:   Number(r.machine_count),
    operatorCount:  Number(r.operator_count),
    complianceRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
  }));
}

// ── Employee-wise report ───────────────────────────────────────────
export async function getEmployeeReport(filters: ReportFilters) {
  const { fromDate, toDate, deptId, userId } = filters;
  const { page, limit, offset } = parsePagination(filters as any);

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate) { conditions.push('tm.due_date >= ?');            params.push(fromDate); }
  if (toDate)   { conditions.push('tm.due_date <= ?');            params.push(toDate); }
  if (deptId)   { conditions.push('u.dept_id = ?');               params.push(deptId); }
  if (userId)   { conditions.push('tm.current_assigned_to = ?');  params.push(userId); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       u.user_id,      u.full_name,    u.employee_code,
       u.username,     d.dept_name,    s.shift_name,
       COUNT(tm.task_id)                                                       AS total,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN tm.status = 'Verified'                THEN 1 ELSE 0 END) AS verified,
       SUM(CASE WHEN tm.status = 'Rejected'                THEN 1 ELSE 0 END) AS rejected,
       AVG(CASE WHEN tm.completed_at IS NOT NULL
           THEN TIMESTAMPDIFF(MINUTE, tm.generated_at, tm.completed_at)
           END)                                                                AS avg_completion_mins
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.DEPARTMENTS}  d  ON u.dept_id              = d.dept_id
     JOIN ${TABLE.SHIFTS}       s  ON u.shift_id             = s.shift_id
     JOIN ${TABLE.TASK_MASTER}  tm ON tm.current_assigned_to = u.user_id
     WHERE ${where}
     GROUP BY u.user_id
     ORDER BY completed DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(DISTINCT u.user_id) AS total
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.TASK_MASTER} tm ON tm.current_assigned_to = u.user_id
     JOIN ${TABLE.DEPARTMENTS}  d ON u.dept_id = d.dept_id
     WHERE ${where}`,
    params
  );

  return {
    data: rows.map(r => ({
      userId:             r.user_id,
      fullName:           r.full_name,
      employeeCode:       r.employee_code,
      username:           r.username,
      deptName:           r.dept_name,
      shiftName:          r.shift_name,
      total:              Number(r.total),
      completed:          Number(r.completed),
      overdue:            Number(r.overdue),
      verified:           Number(r.verified),
      rejected:           Number(r.rejected),
      complianceRate:     r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
      avgCompletionMins:  r.avg_completion_mins ? Math.round(r.avg_completion_mins) : null,
    })),
    meta: buildPaginationMeta(Number(countRows[0]?.count || countRows[0]?.total || 0), page, limit),
  };
}

// ── Frequency-wise breakdown ───────────────────────────────────────
export async function getFrequencyReport(filters: ReportFilters) {
  const { fromDate, toDate, deptId } = filters;

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate) { conditions.push('tm.due_date >= ?'); params.push(fromDate); }
  if (toDate)   { conditions.push('tm.due_date <= ?'); params.push(toDate); }
  if (deptId)   { conditions.push('m.dept_id = ?');    params.push(deptId); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       tm.frequency,
       COUNT(*)                                                               AS total,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END) AS overdue
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES} m ON tm.machine_id = m.machine_id
     WHERE ${where}
     GROUP BY tm.frequency
     ORDER BY FIELD(tm.frequency,'Daily','10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand')`,
    params
  );

  return rows.map(r => ({
    frequency:      r.frequency,
    total:          Number(r.total),
    completed:      Number(r.completed),
    overdue:        Number(r.overdue),
    complianceRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
  }));
}

// ── Detailed task list report ──────────────────────────────────────
export async function getTaskDetailReport(filters: ReportFilters) {
  const { fromDate, toDate, machineId, deptId, userId, frequency, status } = filters;
  const { page, limit, offset } = parsePagination(filters as any);

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate)  { conditions.push('tm.due_date >= ?');            params.push(fromDate); }
  if (toDate)    { conditions.push('tm.due_date <= ?');            params.push(toDate); }
  if (machineId) { conditions.push('tm.machine_id = ?');           params.push(machineId); }
  if (deptId)    { conditions.push('m.dept_id = ?');               params.push(deptId); }
  if (userId)    { conditions.push('tm.current_assigned_to = ?');  params.push(userId); }
  if (frequency) { conditions.push('tm.frequency = ?');            params.push(frequency); }
  if (status)    { conditions.push('tm.status = ?');               params.push(status); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       tm.task_id,         tm.due_date,      tm.status,
       tm.frequency,       tm.completed_at,  tm.generated_at,
       m.machine_name,     m.machine_code,
       t.template_name,    d.dept_name,
       s.shift_name,
       cu.full_name        AS operator_name,
       ou.full_name        AS original_operator,
       tv.status           AS verify_status,
       tv.verified_at,
       vu.full_name        AS verifier_name,
       CASE WHEN tm.completed_at IS NOT NULL
            THEN TIMESTAMPDIFF(MINUTE, tm.generated_at, tm.completed_at)
            ELSE NULL END  AS completion_mins
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}            m  ON tm.machine_id          = m.machine_id
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON tm.template_id         = t.template_id
     JOIN ${TABLE.DEPARTMENTS}         d  ON m.dept_id              = d.dept_id
     JOIN ${TABLE.SHIFTS}              s  ON tm.shift_id            = s.shift_id
     JOIN ${TABLE.USERS}               cu ON tm.current_assigned_to  = cu.user_id
     JOIN ${TABLE.USERS}               ou ON tm.original_assigned_to = ou.user_id
     LEFT JOIN ${TABLE.TASK_VERIFICATION} tv ON tv.task_id          = tm.task_id
     LEFT JOIN ${TABLE.USERS}          vu ON tv.verified_by          = vu.user_id
     WHERE ${where}
     ORDER BY tm.due_date DESC, tm.status ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*)
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES} m ON tm.machine_id = m.machine_id
     WHERE ${where}`,
    params
  );

  return {
    data: rows.map(r => ({
      taskId:           r.task_id,
      dueDate:          r.due_date,
      status:           r.status,
      frequency:        r.frequency,
      completedAt:      r.completed_at,
      machineName:      r.machine_name,
      machineCode:      r.machine_code,
      templateName:     r.template_name,
      deptName:         r.dept_name,
      shiftName:        r.shift_name,
      operatorName:     r.operator_name,
      originalOperator: r.original_operator,
      verifyStatus:     r.verify_status,
      verifiedAt:       r.verified_at,
      verifierName:     r.verifier_name,
      completionMins:   r.completion_mins,
    })),
    meta: buildPaginationMeta(Number(countRows[0]?.count || countRows[0]?.total || 0), page, limit),
  };
}

// ── Overdue aging report ───────────────────────────────────────────
export async function getOverdueReport(filters: ReportFilters) {
  const { deptId } = filters;

  const conditions = [`tm.status = '${TASK_STATUS.OVERDUE}'`];
  const params: unknown[] = [];

  if (deptId) { conditions.push('m.dept_id = ?'); params.push(deptId); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       tm.task_id,    tm.due_date,      tm.frequency,
       m.machine_name,m.machine_code,   d.dept_name,
       t.template_name,
       cu.full_name   AS operator_name,
       DATEDIFF(CURDATE(), tm.due_date) AS days_overdue
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}            m  ON tm.machine_id         = m.machine_id
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON tm.template_id        = t.template_id
     JOIN ${TABLE.DEPARTMENTS}         d  ON m.dept_id             = d.dept_id
     JOIN ${TABLE.USERS}               cu ON tm.current_assigned_to = cu.user_id
     WHERE ${where}
     ORDER BY days_overdue DESC`,
    params
  );

  return rows.map(r => ({
    taskId:       r.task_id,
    dueDate:      r.due_date,
    frequency:    r.frequency,
    machineName:  r.machine_name,
    machineCode:  r.machine_code,
    deptName:     r.dept_name,
    templateName: r.template_name,
    operatorName: r.operator_name,
    daysOverdue:  Number(r.days_overdue),
  }));
}

// ── Handover history report ────────────────────────────────────────
export async function getHandoverReport(filters: ReportFilters) {
  const { fromDate, toDate, machineId, deptId } = filters;

  const conditions = ['1=1'];
  const params: unknown[] = [];

  if (fromDate)  { conditions.push('ma.assigned_date >= ?'); params.push(fromDate); }
  if (toDate)    { conditions.push('ma.assigned_date <= ?'); params.push(toDate); }
  if (machineId) { conditions.push('ma.machine_id = ?');     params.push(machineId); }
  if (deptId)    { conditions.push('m.dept_id = ?');         params.push(deptId); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT
       ma.assign_id,      ma.assigned_date,   ma.unassigned_date,
       ma.is_active,      ma.handover_notes,
       m.machine_name,    m.machine_code,      d.dept_name,
       u.full_name        AS operator_name,    u.employee_code,
       ab.full_name       AS assigned_by_name
     FROM ${TABLE.MACHINE_ASSIGNMENTS} ma
     JOIN ${TABLE.MACHINES}    m  ON ma.machine_id  = m.machine_id
     JOIN ${TABLE.DEPARTMENTS} d  ON m.dept_id      = d.dept_id
     JOIN ${TABLE.USERS}       u  ON ma.user_id     = u.user_id
     LEFT JOIN ${TABLE.USERS}  ab ON ma.assigned_by = ab.user_id
     WHERE ${where}
     ORDER BY ma.assigned_date DESC`,
    params
  );

  return rows;
}
