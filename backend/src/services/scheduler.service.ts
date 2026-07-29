/**
 * scheduler.service.ts
 * ────────────────────
 * Automatic task generation engine using node-cron.
 * Runs on a schedule and generates tasks based on
 * machine-template assignments and their frequency configs.
 *
 * Cron jobs:
 * - Daily task generation    : Every day at 00:01 AM IST
 * - Overdue check            : Every 30 minutes
 * - Notification digest      : Every day at 8:00 AM IST
 *
 * Logic:
 * 1. Fetch all active machine-template assignments
 * 2. For each assignment, check if a task is due today
 * 3. If due, check no duplicate task exists for today
 * 4. Generate task, update last_generated_date
 * 5. Send notifications to assigned operators
 */

import cron from 'node-cron';
import { db } from '../config/database';
import { TABLE, FREQUENCY, TASK_STATUS, CRON, SHIFTS } from '../config/constants';
import { generateId } from '../utils/idGenerator';
import { logger } from '../utils/logger';
import {
  calculateNextDueDate, todayIST, nowIST, FrequencyType
} from '../utils/helpers';

// ── Start all schedulers ──────────────────────────────────────────

export function startScheduler(): void {
  logger.info('⏰ Starting task scheduler...');

  // 1. Daily task generation — runs at 00:01 AM every day
  cron.schedule(CRON.DAILY_TASK_GEN, async () => {
    logger.info('🔄 Running daily task generation...');
    await generateDailyTasks();
    await generateScheduledTasks();
  }, { timezone: 'Asia/Kolkata' });

  // 2. Overdue check — every 30 minutes
  cron.schedule(CRON.OVERDUE_CHECK, async () => {
    await markOverdueTasks();
  }, { timezone: 'Asia/Kolkata' });

  // 3. Morning notification digest — 8 AM daily
  cron.schedule(CRON.NOTIFICATION_SEND, async () => {
    await sendDailyDigestNotifications();
  }, { timezone: 'Asia/Kolkata' });

  logger.info('✅ Scheduler started — 3 cron jobs active');
}

// ── Generate daily tasks for both shifts ─────────────────────────

async function generateDailyTasks(): Promise<void> {
  const today = todayIST();

  try {
    // Get all active daily assignments
    const [assignments] = await db.execute<any[]>(
      `SELECT
         mtm.map_id,       mtm.machine_id,   mtm.template_id,
         mtm.schedule_start_date,
         ma.user_id        AS operator_id,
         t.dept_id
       FROM ${TABLE.MACHINE_TEMPLATE_MAP} mtm
       JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON mtm.template_id = t.template_id
       LEFT JOIN ${TABLE.MACHINE_ASSIGNMENTS} ma
             ON ma.machine_id = mtm.machine_id AND ma.is_active = true
       WHERE mtm.is_active = true
         AND t.frequency = ?
         AND t.is_active = true
         AND mtm.schedule_start_date <= ?`,
      [FREQUENCY.DAILY, today]
    );

    let generated = 0;

    for (const assignment of assignments) {
      if (!assignment.operator_id) continue; // No operator assigned — skip

      // Generate for both shifts
      for (const shiftId of ['SHF001', 'SHF002']) {
        const exists = await taskExistsForToday(assignment.machine_id, assignment.template_id, today, shiftId);
        if (exists) continue;

        await createTask({
          machineId:  assignment.machine_id,
          templateId: assignment.template_id,
          assignedTo: assignment.operator_id,
          shiftId,
          frequency:  FREQUENCY.DAILY,
          dueDate:    today,
        });
        generated++;
      }
    }

    if (generated > 0) {
      logger.info(`✅ Generated ${generated} daily tasks for ${today}`);
    }

  } catch (error) {
    logger.error('Daily task generation failed', { error });
  }
}

// ── Generate scheduled tasks (non-daily) ──────────────────────────

async function generateScheduledTasks(): Promise<void> {
  const today = todayIST();

  try {
    // Get all non-daily active assignments
    const [assignments] = await db.execute<any[]>(
      `SELECT
         mtm.map_id,              mtm.machine_id,       mtm.template_id,
         mtm.schedule_start_date, mtm.last_generated_date,
         t.frequency,
         ma.user_id AS operator_id
       FROM ${TABLE.MACHINE_TEMPLATE_MAP} mtm
       JOIN ${TABLE.CHECKLIST_TEMPLATES} t  ON mtm.template_id = t.template_id
       LEFT JOIN ${TABLE.MACHINE_ASSIGNMENTS} ma
             ON ma.machine_id = mtm.machine_id AND ma.is_active = true
       WHERE mtm.is_active = true
         AND t.frequency != ?
         AND t.frequency != ?
         AND t.is_active = true
         AND mtm.schedule_start_date <= ?`,
      [FREQUENCY.DAILY, FREQUENCY.ON_DEMAND, today]
    );

    let generated = 0;

    for (const assignment of assignments) {
      if (!assignment.operator_id) continue;

      const nextDue = calculateNextDueDate(
        assignment.frequency as FrequencyType,
        assignment.schedule_start_date,
        assignment.last_generated_date
      );

      if (!nextDue) continue; // Not due yet

      // Check no duplicate
      const exists = await taskExistsForDate(assignment.machine_id, assignment.template_id, nextDue);
      if (exists) {
        // Update last_generated_date even if task exists (to avoid re-checking)
        await updateLastGeneratedDate(assignment.map_id, nextDue);
        continue;
      }

      await createTask({
        machineId:  assignment.machine_id,
        templateId: assignment.template_id,
        assignedTo: assignment.operator_id,
        shiftId:    'SHF001', // Day shift default for non-daily
        frequency:  assignment.frequency,
        dueDate:    nextDue,
      });

      await updateLastGeneratedDate(assignment.map_id, nextDue);
      generated++;
    }

    if (generated > 0) {
      logger.info(`✅ Generated ${generated} scheduled tasks`);
    }

  } catch (error) {
    logger.error('Scheduled task generation failed', { error });
  }
}

// ── Mark overdue tasks ────────────────────────────────────────────

async function markOverdueTasks(): Promise<void> {
  const today = todayIST();

  try {
    const [result] = await db.query(
      `UPDATE ${TABLE.TASK_MASTER}
       SET status = ?
       WHERE due_date < ?
         AND status IN (?, ?)`,
      [TASK_STATUS.OVERDUE, today, TASK_STATUS.PENDING, TASK_STATUS.IN_PROGRESS]
    );

    const affected = (result as any).affectedRows;
    if (affected > 0) {
      logger.info(`⚠️  Marked ${affected} tasks as overdue`);

      // Create notifications for overdue tasks
      await createOverdueNotifications();
    }

  } catch (error) {
    logger.error('Overdue check failed', { error });
  }
}

// ── Send daily digest notifications ──────────────────────────────

async function sendDailyDigestNotifications(): Promise<void> {
  const today = todayIST();

  try {
    // Get all operators with pending tasks today
    const [rows] = await db.execute<any[]>(
      `SELECT
         tm.current_assigned_to AS user_id,
         COUNT(*) AS pending_count,
         u.full_name
       FROM ${TABLE.TASK_MASTER} tm
       JOIN ${TABLE.USERS} u ON tm.current_assigned_to = u.user_id
       WHERE tm.due_date = ? AND tm.status IN (?, ?)
       GROUP BY tm.current_assigned_to`,
      [today, TASK_STATUS.PENDING, TASK_STATUS.OVERDUE]
    );

    for (const row of rows) {
      const notifId = await generateId('NTF');
      await db.query(
        `INSERT IGNORE INTO ${TABLE.NOTIFICATIONS}
           (notif_id, user_id, type, title, message, channel)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          notifId, row.user_id, 'Task_Due',
          `${row.pending_count} tasks due today`,
          `You have ${row.pending_count} pending inspection task(s) for ${today}. Please complete them before end of shift.`,
          'InApp',
        ]
      );
    }

    if (rows.length > 0) {
      logger.info(`📧 Sent daily digest to ${rows.length} operators`);
    }

  } catch (error) {
    logger.error('Daily digest failed', { error });
  }
}

// ── Create overdue notifications ──────────────────────────────────

async function createOverdueNotifications(): Promise<void> {
  try {
    const [rows] = await db.execute<any[]>(
      `SELECT DISTINCT
         tm.current_assigned_to AS user_id,
         m.machine_name, t.template_name, tm.due_date
       FROM ${TABLE.TASK_MASTER} tm
       JOIN ${TABLE.MACHINES}            m ON tm.machine_id  = m.machine_id
       JOIN ${TABLE.CHECKLIST_TEMPLATES} t ON tm.template_id = t.template_id
       WHERE tm.status = ? AND DATE(NOW()) = DATE(NOW())`,
      [TASK_STATUS.OVERDUE]
    );

    for (const row of rows) {
      const notifId = await generateId('NTF');
      await db.query(
        `INSERT IGNORE INTO ${TABLE.NOTIFICATIONS}
           (notif_id, user_id, type, title, message, channel)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          notifId, row.user_id, 'Task_Overdue',
          `Overdue: ${row.machine_name}`,
          `Inspection "${row.template_name}" for ${row.machine_name} was due on ${row.due_date} and is now overdue.`,
          'All',
        ]
      );
    }

  } catch (error) {
    logger.error('Overdue notifications failed', { error });
  }
}

// ── Helpers ───────────────────────────────────────────────────────

async function taskExistsForToday(
  machineId: string,
  templateId: string,
  dueDate: string,
  shiftId: string
): Promise<boolean> {
  const [rows] = await db.execute<any[]>(
    `SELECT task_id FROM ${TABLE.TASK_MASTER}
     WHERE machine_id = ? AND template_id = ? AND due_date = ? AND shift_id = ?
     LIMIT 1`,
    [machineId, templateId, dueDate, shiftId]
  );
  return rows.length > 0;
}

async function taskExistsForDate(
  machineId: string,
  templateId: string,
  dueDate: string
): Promise<boolean> {
  const [rows] = await db.execute<any[]>(
    `SELECT task_id FROM ${TABLE.TASK_MASTER}
     WHERE machine_id = ? AND template_id = ? AND due_date = ?
     LIMIT 1`,
    [machineId, templateId, dueDate]
  );
  return rows.length > 0;
}

async function createTask(params: {
  machineId: string; templateId: string; assignedTo: string;
  shiftId: string; frequency: string; dueDate: string;
}): Promise<void> {
  const taskId = await generateId('TSK');

  await db.query(
    `INSERT INTO ${TABLE.TASK_MASTER}
       (task_id, machine_id, template_id, original_assigned_to, current_assigned_to,
        shift_id, frequency, due_date, status, is_auto_generated, generated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'SCHEDULER')`,
    [
      taskId, params.machineId, params.templateId,
      params.assignedTo, params.assignedTo,
      params.shiftId, params.frequency, params.dueDate,
      TASK_STATUS.PENDING,
    ]
  );
}

async function updateLastGeneratedDate(mapId: string, date: string): Promise<void> {
  await db.query(
    `UPDATE ${TABLE.MACHINE_TEMPLATE_MAP}
     SET last_generated_date = ?, updated_at = NOW()
     WHERE map_id = ?`,
    [date, mapId]
  );
}

// ── Manual trigger (for admin use) ────────────────────────────────

export async function triggerManualGeneration(): Promise<{ daily: number; scheduled: number }> {
  logger.info('🔧 Manual task generation triggered');
  await generateDailyTasks();
  await generateScheduledTasks();
  return { daily: 0, scheduled: 0 };
}
