/**
 * dashboard.service.ts
 * ────────────────────
 * KPI aggregations for the dashboard.
 * All queries are read-only — no data modification here.
 */

import { db } from '../../config/database';
import { TABLE, TASK_STATUS } from '../../config/constants';
import { nowIST } from '../../utils/helpers';

// ── Main dashboard KPIs ───────────────────────────────────────────

export async function getDashboardKPIs(userId: string, roleName: string, deptId: string) {
  const today = nowIST().format('YYYY-MM-DD');
  const monthStart = nowIST().startOf('month').format('YYYY-MM-DD');

  // For technician — only their tasks; for others — all
  const userFilter = roleName === 'Technician'
    ? `AND tm.current_assigned_to = '${userId}'`
    : '';

  const deptFilter = roleName === 'Supervisor'
    ? `AND m.dept_id = '${deptId}'`
    : '';

  // Today's task counts
  const [todayRows] = await db.execute<any[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN tm.status IN (?,?) THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN tm.status IN (?,?) THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN tm.status = ?      THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN tm.status = ?      THEN 1 ELSE 0 END) AS in_progress
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES} m ON tm.machine_id = m.machine_id
     WHERE tm.due_date = ? ${userFilter} ${deptFilter}`,
    [
      TASK_STATUS.PENDING, TASK_STATUS.OVERDUE,
      TASK_STATUS.COMPLETED, TASK_STATUS.VERIFIED,
      TASK_STATUS.OVERDUE,
      TASK_STATUS.IN_PROGRESS,
      today,
    ]
  );

  // Monthly compliance rate
  const [monthRows] = await db.execute<any[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN tm.status IN (?,?) THEN 1 ELSE 0 END) AS completed
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES} m ON tm.machine_id = m.machine_id
     WHERE tm.due_date >= ? ${userFilter} ${deptFilter}`,
    [TASK_STATUS.COMPLETED, TASK_STATUS.VERIFIED, monthStart]
  );

  const monthTotal     = Number(monthRows[0].total || 0);
  const monthCompleted = Number(monthRows[0].completed || 0);
  const complianceRate = monthTotal > 0
    ? Math.round((monthCompleted / monthTotal) * 100)
    : 0;

  // Active machines count
  const [machineRows] = await db.execute<any[]>(
    `SELECT COUNT(*) AS total FROM ${TABLE.MACHINES}
     WHERE is_active = true ${deptFilter.replace('m.dept_id', 'dept_id')}`
  );

  return {
    today: {
      total:      Number(todayRows[0].total      || 0),
      pending:    Number(todayRows[0].pending     || 0),
      completed:  Number(todayRows[0].completed   || 0),
      overdue:    Number(todayRows[0].overdue     || 0),
      inProgress: Number(todayRows[0].in_progress || 0),
    },
    monthly: {
      total:          monthTotal,
      completed:      monthCompleted,
      complianceRate: complianceRate,
      target:         95, // Target compliance %
    },
    machines: {
      active: Number(machineRows[0].total || 0),
    },
  };
}

// ── Department-wise compliance ────────────────────────────────────

export async function getDeptWiseCompliance() {
  const monthStart = nowIST().startOf('month').format('YYYY-MM-DD');

  const [rows] = await db.execute<any[]>(
    `SELECT
       d.dept_name,
       COUNT(tm.task_id)                                                       AS total,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END) AS overdue
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}    m ON tm.machine_id = m.machine_id
     JOIN ${TABLE.DEPARTMENTS} d ON m.dept_id     = d.dept_id
     WHERE tm.due_date >= ?
     GROUP BY d.dept_id, d.dept_name
     ORDER BY d.dept_name`,
    [monthStart]
  );

  return rows.map(r => ({
    deptName:       r.dept_name,
    total:          Number(r.total),
    completed:      Number(r.completed),
    overdue:        Number(r.overdue),
    complianceRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
  }));
}

// ── Recent activity feed ──────────────────────────────────────────

export async function getRecentActivity(limit = 10) {
  const [rows] = await db.execute<any[]>(
    `SELECT
       tm.task_id,    tm.status,      tm.completed_at,
       m.machine_name,t.template_name,
       u.full_name AS user_name
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}            m ON tm.machine_id        = m.machine_id
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t ON tm.template_id       = t.template_id
     JOIN ${TABLE.USERS}               u ON tm.current_assigned_to = u.user_id
     WHERE tm.status IN (?,?,?)
     ORDER BY tm.completed_at DESC
     LIMIT ?`,
    [TASK_STATUS.COMPLETED, TASK_STATUS.VERIFIED, TASK_STATUS.REJECTED, limit]
  );

  return rows;
}

// ── Tasks due today per machine ───────────────────────────────────

export async function getTodayTasksByMachine(deptId?: string) {
  const today  = nowIST().format('YYYY-MM-DD');
  const params: unknown[] = [today];
  let deptWhere = '';

  if (deptId) {
    deptWhere = 'AND m.dept_id = ?';
    params.push(deptId);
  }

  const [rows] = await db.execute<any[]>(
    `SELECT
       m.machine_id,   m.machine_name,   m.machine_code,
       d.dept_name,
       COUNT(tm.task_id)                                                       AS total_tasks,
       SUM(CASE WHEN tm.status IN ('Completed','Verified') THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN tm.status = 'Pending'                 THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN tm.status = 'Overdue'                 THEN 1 ELSE 0 END) AS overdue
     FROM ${TABLE.MACHINES} m
     JOIN ${TABLE.DEPARTMENTS} d  ON m.dept_id    = d.dept_id
     JOIN ${TABLE.TASK_MASTER} tm ON tm.machine_id = m.machine_id AND tm.due_date = ?
     WHERE m.is_active = true ${deptWhere}
     GROUP BY m.machine_id
     ORDER BY overdue DESC, pending DESC`,
    params
  );

  return rows;
}
