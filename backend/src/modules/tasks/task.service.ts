/**
 * task.service.ts
 * ───────────────
 * Task completion + supervisor verification logic.
 *
 * Functions:
 * - getMyTasks()          → tasks assigned to current user
 * - getAllTasks()          → all tasks (Admin/Supervisor)
 * - getTaskById()         → task detail with responses
 * - startTask()           → mark task as In Progress
 * - submitTask()          → submit all responses (complete task)
 * - verifyTask()          → supervisor approves/rejects
 * - getOverdueTasks()     → all overdue tasks
 * - createOnDemandTask()  → manually create On-Demand task
 */

import { db } from '../../config/database';
import { TABLE, TASK_STATUS, FREQUENCY } from '../../config/constants';
import { generateId } from '../../utils/idGenerator';
import { AppErrors } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { parsePagination, buildPaginationMeta, nowIST, isTaskOverdue } from '../../utils/helpers';

// ── Types ─────────────────────────────────────────────────────────

export interface TaskSummary {
  taskId:               string;
  machineId:            string;
  machineName:          string;
  machineCode:          string;
  templateId:           string;
  templateName:         string;
  frequency:            string;
  dueDate:              string;
  shiftName:            string;
  status:               string;
  originalAssignedTo:   string;
  originalAssigneeName: string;
  currentAssignedTo:    string;
  currentAssigneeName:  string;
  deptName:             string;
  isOverdue:            boolean;
  completedAt:          string | null;
}

export interface TaskDetail extends TaskSummary {
  items:    TaskItemResponse[];
  verification?: TaskVerification | null;
}

export interface TaskItemResponse {
  itemId:          string;
  itemText:        string;
  inputType:       string;
  isMandatory:     boolean;
  unit:            string | null;
  dropdownOptions: string[] | null;
  expectedValue:   string | null;
  minValue:        number | null;
  maxValue:        number | null;
  responseValue:   string | null;
  photoUrl:        string | null;
  remarks:         string | null;
  submittedAt:     string | null;
}

export interface TaskVerification {
  verifyId:    string;
  verifiedBy:  string;
  verifierName:string;
  verifiedAt:  string;
  status:      string;
  comments:    string | null;
}

export interface SubmitTaskDto {
  responses: {
    itemId:        string;
    responseValue: string;
    photoUrl?:     string;
    remarks?:      string;
  }[];
}

export interface VerifyTaskDto {
  status:    'Approved' | 'Rejected' | 'Needs Correction';
  comments?: string;
}

// ── Get my tasks ──────────────────────────────────────────────────

export async function getMyTasks(userId: string, query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);

  const conditions = ['tm.current_assigned_to = ?'];
  const params: unknown[] = [userId];

  if (query.status)    { conditions.push('tm.status = ?');    params.push(query.status); }
  if (query.dueDate)   { conditions.push('tm.due_date = ?');  params.push(query.dueDate); }
  if (query.frequency) { conditions.push('tm.frequency = ?'); params.push(query.frequency); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  return getTasksQuery(where, params, page, limit, offset);
}

// ── Get all tasks (Admin/Supervisor) ─────────────────────────────

export async function getAllTasks(query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.status)    { conditions.push('tm.status = ?');              params.push(query.status); }
  if (query.machineId) { conditions.push('tm.machine_id = ?');          params.push(query.machineId); }
  if (query.deptId)    { conditions.push('m.dept_id = ?');              params.push(query.deptId); }
  if (query.userId)    { conditions.push('tm.current_assigned_to = ?'); params.push(query.userId); }
  if (query.frequency) { conditions.push('tm.frequency = ?');           params.push(query.frequency); }
  if (query.dueDate)   { conditions.push('tm.due_date = ?');            params.push(query.dueDate); }
  if (query.fromDate)  { conditions.push('tm.due_date >= ?');           params.push(query.fromDate); }
  if (query.toDate)    { conditions.push('tm.due_date <= ?');           params.push(query.toDate); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return getTasksQuery(where, params, page, limit, offset);
}

// ── Shared query ──────────────────────────────────────────────────

async function getTasksQuery(
  where: string,
  params: unknown[],
  page: number,
  limit: number,
  offset: number
) {
  const [rows] = await db.execute<any[]>(
    `SELECT
       tm.task_id,           tm.due_date,          tm.status,
       tm.frequency,         tm.completed_at,      tm.handover_date,
       tm.machine_id,        m.machine_name,       m.machine_code,
       tm.template_id,       t.template_name,
       m.dept_id,            d.dept_name,
       tm.shift_id,          s.shift_name,
       tm.original_assigned_to,  ou.full_name AS original_assignee_name,
       tm.current_assigned_to,   cu.full_name AS current_assignee_name
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}            m  ON tm.machine_id          = m.machine_id
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON tm.template_id         = t.template_id
     JOIN ${TABLE.DEPARTMENTS}         d  ON m.dept_id              = d.dept_id
     JOIN ${TABLE.SHIFTS}              s  ON tm.shift_id            = s.shift_id
     JOIN ${TABLE.USERS}               ou ON tm.original_assigned_to = ou.user_id
     JOIN ${TABLE.USERS}               cu ON tm.current_assigned_to  = cu.user_id
     ${where}
     ORDER BY
       FIELD(tm.status, 'Overdue','Pending','In Progress','Completed','Verified','Rejected','Skipped'),
       tm.due_date DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*) AS total
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES} m ON tm.machine_id = m.machine_id
     ${where}`,
    params
  );

  return {
    data: rows.map(mapTaskSummary),
    meta: buildPaginationMeta(countRows[0].total, page, limit),
  };
}

// ── Get task by ID with responses ─────────────────────────────────

export async function getTaskById(taskId: string): Promise<TaskDetail> {
  const [tRows] = await db.execute<any[]>(
    `SELECT
       tm.task_id,           tm.due_date,          tm.status,
       tm.frequency,         tm.completed_at,      tm.started_at,
       tm.machine_id,        m.machine_name,       m.machine_code,
       tm.template_id,       t.template_name,
       m.dept_id,            d.dept_name,
       tm.shift_id,          s.shift_name,
       tm.original_assigned_to,  ou.full_name AS original_assignee_name,
       tm.current_assigned_to,   cu.full_name AS current_assignee_name
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}            m  ON tm.machine_id          = m.machine_id
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON tm.template_id         = t.template_id
     JOIN ${TABLE.DEPARTMENTS}         d  ON m.dept_id              = d.dept_id
     JOIN ${TABLE.SHIFTS}              s  ON tm.shift_id            = s.shift_id
     JOIN ${TABLE.USERS}               ou ON tm.original_assigned_to = ou.user_id
     JOIN ${TABLE.USERS}               cu ON tm.current_assigned_to  = cu.user_id
     WHERE tm.task_id = ?`,
    [taskId]
  );

  if (tRows.length === 0) throw AppErrors.notFound('Task');

  const task = mapTaskSummary(tRows[0]) as TaskDetail;

  // Fetch checklist items with responses
  const [itemRows] = await db.execute<any[]>(
    `SELECT
       ci.item_id,       ci.item_text,       ci.input_type,
       ci.is_mandatory,  ci.unit,            ci.dropdown_options,
       ci.expected_value,ci.min_value,       ci.max_value,
       tr.response_value,tr.photo_url,       tr.remarks,    tr.submitted_at
     FROM ${TABLE.CHECKLIST_ITEMS} ci
     LEFT JOIN ${TABLE.TASK_RESPONSES} tr
           ON tr.item_id = ci.item_id AND tr.task_id = ?
     WHERE ci.template_id = ? AND ci.is_active = true
     ORDER BY ci.sort_order ASC`,
    [taskId, tRows[0].template_id]
  );

  task.items = itemRows.map(mapTaskItem);

  // Fetch verification if exists
  const [verRows] = await db.execute<any[]>(
    `SELECT
       tv.verify_id,  tv.verified_at,   tv.status,   tv.comments,
       tv.verified_by, u.full_name AS verifier_name
     FROM ${TABLE.TASK_VERIFICATION} tv
     JOIN ${TABLE.USERS} u ON tv.verified_by = u.user_id
     WHERE tv.task_id = ?`,
    [taskId]
  );

  task.verification = verRows.length > 0 ? {
    verifyId:    verRows[0].verify_id,
    verifiedBy:  verRows[0].verified_by,
    verifierName:verRows[0].verifier_name,
    verifiedAt:  verRows[0].verified_at,
    status:      verRows[0].status,
    comments:    verRows[0].comments,
  } : null;

  return task;
}

// ── Start task ────────────────────────────────────────────────────

export async function startTask(taskId: string, userId: string): Promise<void> {
  const task = await getTaskById(taskId);

  if (task.currentAssignedTo !== userId) {
    throw AppErrors.forbidden();
  }

  if (task.status !== TASK_STATUS.PENDING && task.status !== TASK_STATUS.OVERDUE) {
    throw AppErrors.badRequest(`Task is already ${task.status}.`);
  }

  await db.query(
    `UPDATE ${TABLE.TASK_MASTER}
     SET status = ?, started_at = NOW() WHERE task_id = ?`,
    [TASK_STATUS.IN_PROGRESS, taskId]
  );
}

// ── Submit task (complete) ────────────────────────────────────────

export async function submitTask(
  taskId: string,
  dto: SubmitTaskDto,
  submittedBy: string
): Promise<void> {
  const task = await getTaskById(taskId);

  if (task.currentAssignedTo !== submittedBy) {
    throw AppErrors.forbidden();
  }

  if (![TASK_STATUS.PENDING, TASK_STATUS.IN_PROGRESS, TASK_STATUS.OVERDUE].includes(task.status as any)) {
    throw AppErrors.badRequest(`Cannot submit a task with status: ${task.status}`);
  }

  // Validate mandatory items have responses
  const mandatoryItems = task.items.filter(i => i.isMandatory);
  const submittedItemIds = dto.responses.map(r => r.itemId);
  const missingMandatory = mandatoryItems.filter(
    i => !submittedItemIds.includes(i.itemId) || !dto.responses.find(r => r.itemId === i.itemId)?.responseValue
  );

  if (missingMandatory.length > 0) {
    throw AppErrors.badRequest(
      `Missing responses for mandatory items: ${missingMandatory.map(i => i.itemText).join(', ')}`
    );
  }

  // Insert/update responses
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const response of dto.responses) {
      const responseId = await generateId('RSP');
      await conn.execute(
        `INSERT INTO ${TABLE.TASK_RESPONSES}
           (response_id, task_id, item_id, response_value, photo_url, submitted_by, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           response_value = VALUES(response_value),
           photo_url      = VALUES(photo_url),
           remarks        = VALUES(remarks),
           submitted_at   = NOW()`,
        [
          responseId, taskId, response.itemId,
          response.responseValue, response.photoUrl || null,
          submittedBy, response.remarks || null,
        ]
      );
    }

    // Mark task as completed
    await conn.execute(
      `UPDATE ${TABLE.TASK_MASTER}
       SET status = ?, completed_at = NOW() WHERE task_id = ?`,
      [TASK_STATUS.COMPLETED, taskId]
    );

    await conn.commit();
    logger.info(`Task ${taskId} submitted by ${submittedBy}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Verify task (Supervisor) ──────────────────────────────────────

export async function verifyTask(
  taskId: string,
  dto: VerifyTaskDto,
  verifiedBy: string
): Promise<void> {
  const task = await getTaskById(taskId);

  if (task.status !== TASK_STATUS.COMPLETED) {
    throw AppErrors.badRequest('Only completed tasks can be verified.');
  }

  const verifyId = await generateId('VRF');

  await db.query(
    `INSERT INTO ${TABLE.TASK_VERIFICATION}
       (verify_id, task_id, verified_by, status, comments)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       verified_by = VALUES(verified_by),
       status      = VALUES(status),
       comments    = VALUES(comments),
       verified_at = NOW()`,
    [verifyId, taskId, verifiedBy, dto.status, dto.comments || null]
  );

  // Update task status based on verification result
  const newTaskStatus = dto.status === 'Approved'
    ? TASK_STATUS.VERIFIED
    : TASK_STATUS.REJECTED;

  await db.query(
    `UPDATE ${TABLE.TASK_MASTER} SET status = ? WHERE task_id = ?`,
    [newTaskStatus, taskId]
  );

  logger.info(`Task ${taskId} ${dto.status} by ${verifiedBy}`);
}

// ── Create On-Demand task ─────────────────────────────────────────

export async function createOnDemandTask(
  machineId:  string,
  templateId: string,
  assignedTo: string,
  shiftId:    string,
  createdBy:  string
): Promise<TaskSummary> {
  const taskId  = await generateId('TSK');
  const today   = nowIST().format('YYYY-MM-DD');

  await db.query(
    `INSERT INTO ${TABLE.TASK_MASTER}
       (task_id, machine_id, template_id, original_assigned_to, current_assigned_to,
        shift_id, frequency, due_date, status, is_auto_generated, generated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [taskId, machineId, templateId, assignedTo, assignedTo,
     shiftId, FREQUENCY.ON_DEMAND, today, TASK_STATUS.PENDING, createdBy]
  );

  return getTaskById(taskId);
}

// ── Get overdue tasks ─────────────────────────────────────────────

export async function getOverdueTasks() {
  const today = nowIST().format('YYYY-MM-DD');

  await db.query(
    `UPDATE ${TABLE.TASK_MASTER}
     SET status = '${TASK_STATUS.OVERDUE}'
     WHERE due_date < ? AND status IN (?, ?)`,
    [today, TASK_STATUS.PENDING, TASK_STATUS.IN_PROGRESS]
  );

  const [rows] = await db.execute<any[]>(
    `SELECT
       tm.task_id, tm.due_date, tm.status, tm.frequency,
       m.machine_name, t.template_name, d.dept_name,
       cu.full_name AS current_assignee_name,
       DATEDIFF(?, tm.due_date) AS days_overdue
     FROM ${TABLE.TASK_MASTER} tm
     JOIN ${TABLE.MACHINES}            m  ON tm.machine_id         = m.machine_id
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON tm.template_id        = t.template_id
     JOIN ${TABLE.DEPARTMENTS}         d  ON m.dept_id             = d.dept_id
     JOIN ${TABLE.USERS}               cu ON tm.current_assigned_to = cu.user_id
     WHERE tm.status = ?
     ORDER BY tm.due_date ASC`,
    [today, TASK_STATUS.OVERDUE]
  );

  return rows;
}

// ── Mappers ────────────────────────────────────────────────────────

function mapTaskSummary(row: any): TaskSummary {
  return {
    taskId:               row.task_id,
    machineId:            row.machine_id,
    machineName:          row.machine_name,
    machineCode:          row.machine_code,
    templateId:           row.template_id,
    templateName:         row.template_name,
    frequency:            row.frequency,
    dueDate:              row.due_date,
    shiftName:            row.shift_name,
    status:               row.status,
    originalAssignedTo:   row.original_assigned_to,
    originalAssigneeName: row.original_assignee_name,
    currentAssignedTo:    row.current_assigned_to,
    currentAssigneeName:  row.current_assignee_name,
    deptName:             row.dept_name,
    isOverdue:            isTaskOverdue(row.due_date, row.status),
    completedAt:          row.completed_at,
  };
}

function mapTaskItem(row: any): TaskItemResponse {
  return {
    itemId:          row.item_id,
    itemText:        row.item_text,
    inputType:       row.input_type,
    isMandatory:     Boolean(row.is_mandatory),
    unit:            row.unit,
    dropdownOptions: row.dropdown_options ? row.dropdown_options.split(',') : null,
    expectedValue:   row.expected_value,
    minValue:        row.min_value,
    maxValue:        row.max_value,
    responseValue:   row.response_value,
    photoUrl:        row.photo_url,
    remarks:         row.remarks,
    submittedAt:     row.submitted_at,
  };
}
