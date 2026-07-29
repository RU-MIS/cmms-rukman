/**
 * machine.service.ts
 * ──────────────────
 * Machine management + operator assignment + handover logic.
 *
 * Functions:
 * - getAllMachines()        → list with filters
 * - getMachineById()       → single machine detail
 * - createMachine()        → create new machine
 * - updateMachine()        → update machine info
 * - toggleActive()         → activate/deactivate machine
 * - assignOperator()       → assign operator to machine
 * - handoverOperator()     → Ramesh → Suresh handover
 * - getCurrentOperator()   → who is currently assigned
 * - getAssignmentHistory() → full handover history
 */

import { db } from '../../config/database';
import { TABLE, MACHINE_STATUS } from '../../config/constants';
import { generateId } from '../../utils/idGenerator';
import { AppErrors } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { parsePagination, buildPaginationMeta, todayIST } from '../../utils/helpers';

// ── Types ────────────────────────────────────────────────────────

export interface Machine {
  machineId:    string;
  machineName:  string;
  machineCode:  string;
  deptId:       string;
  deptName:     string;
  machineType:  string | null;
  manufacturer: string | null;
  modelNumber:  string | null;
  serialNumber: string | null;
  installDate:  string | null;
  location:     string | null;
  status:       string;
  isActive:     boolean;
  createdAt:    string;
  currentOperator?: CurrentOperator | null;
}

export interface CurrentOperator {
  userId:       string;
  fullName:     string;
  employeeCode: string;
  assignedDate: string;
}

export interface CreateMachineDto {
  machineName:  string;
  machineCode:  string;
  deptId:       string;
  machineType?: string;
  manufacturer?: string;
  modelNumber?:  string;
  serialNumber?: string;
  installDate?:  string;
  location?:     string;
}

export interface HandoverDto {
  newUserId:      string;
  handoverNotes?: string;
}

// ── Get all machines ──────────────────────────────────────────────

export async function getAllMachines(query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.deptId)  { conditions.push('m.dept_id = ?');  params.push(query.deptId); }
  if (query.status)  { conditions.push('m.status = ?');   params.push(query.status); }
  if (query.search) {
    conditions.push('(m.machine_name LIKE ? OR m.machine_code LIKE ?)');
    const s = `%${query.search}%`;
    params.push(s, s);
  }
  if (query.showInactive !== 'true') { conditions.push('m.is_active = true'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await db.execute<any[]>(
    `SELECT
       m.machine_id,   m.machine_name,   m.machine_code,
       m.machine_type, m.manufacturer,   m.model_number,
       m.serial_number,m.install_date,   m.location,
       m.status,       m.is_active,      m.created_at,
       m.dept_id,      d.dept_name,
       -- Current operator subquery
       u.user_id       AS op_user_id,
       u.full_name     AS op_full_name,
       u.employee_code AS op_employee_code,
       ma.assigned_date AS op_assigned_date
     FROM ${TABLE.MACHINES} m
     JOIN ${TABLE.DEPARTMENTS} d  ON m.dept_id = d.dept_id
     LEFT JOIN ${TABLE.MACHINE_ASSIGNMENTS} ma
           ON ma.machine_id = m.machine_id AND ma.is_active = true
     LEFT JOIN ${TABLE.USERS} u ON ma.user_id = u.user_id
     ${where}
     ORDER BY m.machine_name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*) FROM ${TABLE.MACHINES} m ${where}`,
    params
  );

  return {
    data: rows.map(mapMachine),
    meta: buildPaginationMeta(Number(countRows[0]?.count || countRows[0]?.total || 0), page, limit),
  };
}

// ── Get machine by ID ─────────────────────────────────────────────

export async function getMachineById(machineId: string): Promise<Machine> {
  const [rows] = await db.execute<any[]>(
    `SELECT
       m.machine_id,   m.machine_name,   m.machine_code,
       m.machine_type, m.manufacturer,   m.model_number,
       m.serial_number,m.install_date,   m.location,
       m.status,       m.is_active,      m.created_at,
       m.dept_id,      d.dept_name,
       u.user_id       AS op_user_id,
       u.full_name     AS op_full_name,
       u.employee_code AS op_employee_code,
       ma.assigned_date AS op_assigned_date
     FROM ${TABLE.MACHINES} m
     JOIN ${TABLE.DEPARTMENTS} d ON m.dept_id = d.dept_id
     LEFT JOIN ${TABLE.MACHINE_ASSIGNMENTS} ma
           ON ma.machine_id = m.machine_id AND ma.is_active = true
     LEFT JOIN ${TABLE.USERS} u ON ma.user_id = u.user_id
     WHERE m.machine_id = ?`,
    [machineId]
  );

  if (rows.length === 0) throw AppErrors.notFound('Machine');
  return mapMachine(rows[0]);
}

// ── Create machine ────────────────────────────────────────────────

export async function createMachine(
  dto: CreateMachineDto,
  createdBy: string
): Promise<Machine> {
  const [existing] = await db.execute<any[]>(
    `SELECT machine_id FROM ${TABLE.MACHINES} WHERE machine_code = ?`,
    [dto.machineCode.toUpperCase()]
  );

  if (existing.length > 0) throw AppErrors.conflict('Machine code already exists.');

  const machineId = await generateId('MAC');

  await db.query(
    `INSERT INTO ${TABLE.MACHINES}
       (machine_id, machine_name, machine_code, dept_id,
        machine_type, manufacturer, model_number, serial_number,
        install_date, location, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      machineId, dto.machineName.trim(), dto.machineCode.toUpperCase().trim(),
      dto.deptId, dto.machineType || null, dto.manufacturer || null,
      dto.modelNumber || null, dto.serialNumber || null,
      dto.installDate || null, dto.location || null, createdBy,
    ]
  );

  logger.info(`Machine created: ${machineId} — ${dto.machineName} by ${createdBy}`);
  return getMachineById(machineId);
}

// ── Update machine ────────────────────────────────────────────────

export async function updateMachine(
  machineId: string,
  dto: Partial<CreateMachineDto>,
  updatedBy: string
): Promise<Machine> {
  await getMachineById(machineId);

  const fields: string[] = [];
  const values: unknown[] = [];

  const fieldMap: Record<string, string> = {
    machineName: 'machine_name', machineCode: 'machine_code',
    deptId: 'dept_id', machineType: 'machine_type',
    manufacturer: 'manufacturer', modelNumber: 'model_number',
    serialNumber: 'serial_number', installDate: 'install_date',
    location: 'location',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if ((dto as any)[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push((dto as any)[key] || null);
    }
  }

  if (fields.length === 0) throw AppErrors.badRequest('No fields to update.');

  fields.push('updated_at = NOW()');
  values.push(machineId);

  await db.query(
    `UPDATE ${TABLE.MACHINES} SET ${fields.join(', ')} WHERE machine_id = ?`,
    values
  );

  logger.info(`Machine updated: ${machineId} by ${updatedBy}`);
  return getMachineById(machineId);
}

// ── Update machine status ─────────────────────────────────────────

export async function updateMachineStatus(
  machineId: string,
  status: string,
  updatedBy: string
): Promise<Machine> {
  await getMachineById(machineId);

  if (!Object.values(MACHINE_STATUS).includes(status as any)) {
    throw AppErrors.badRequest(`Invalid status. Must be: ${Object.values(MACHINE_STATUS).join(', ')}`);
  }

  await db.query(
    `UPDATE ${TABLE.MACHINES} SET status = ?, updated_at = NOW() WHERE machine_id = ?`,
    [status, machineId]
  );

  return getMachineById(machineId);
}

// ── Assign operator ───────────────────────────────────────────────

export async function assignOperator(
  machineId: string,
  userId: string,
  assignedBy: string
): Promise<void> {
  await getMachineById(machineId);

  // Deactivate any existing assignment
  await db.query(
    `UPDATE ${TABLE.MACHINE_ASSIGNMENTS}
     SET is_active = false, unassigned_date = ?
     WHERE machine_id = ? AND is_active = true`,
    [todayIST(), machineId]
  );

  // Create new assignment
  const assignId = await generateId('ASN');
  await db.query(
    `INSERT INTO ${TABLE.MACHINE_ASSIGNMENTS}
       (assign_id, machine_id, user_id, assigned_date, is_active, assigned_by)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [assignId, machineId, userId, todayIST(), assignedBy]
  );

  // Update pending tasks to new operator
  await db.query(
    `UPDATE ${TABLE.TASK_MASTER}
     SET current_assigned_to = ?, handover_date = ?
     WHERE machine_id = ? AND status IN ('Pending', 'In Progress')`,
    [userId, todayIST(), machineId]
  );

  logger.info(`Machine ${machineId} assigned to user ${userId} by ${assignedBy}`);
}

// ── Handover operator — Ramesh → Suresh ──────────────────────────

export async function handoverOperator(
  machineId: string,
  dto: HandoverDto,
  handoverBy: string
): Promise<void> {
  const machine = await getMachineById(machineId);

  // Get current active assignment
  const [current] = await db.execute<any[]>(
    `SELECT assign_id, user_id FROM ${TABLE.MACHINE_ASSIGNMENTS}
     WHERE machine_id = ? AND is_active = true`,
    [machineId]
  );

  const today = todayIST();

  if (current.length > 0) {
    // Close current assignment with handover notes
    await db.query(
      `UPDATE ${TABLE.MACHINE_ASSIGNMENTS}
       SET is_active = false, unassigned_date = ?, handover_notes = ?
       WHERE assign_id = ?`,
      [today, dto.handoverNotes || null, current[0].assign_id]
    );
  }

  // Create new assignment for incoming operator
  const assignId = await generateId('ASN');
  await db.query(
    `INSERT INTO ${TABLE.MACHINE_ASSIGNMENTS}
       (assign_id, machine_id, user_id, assigned_date, is_active, assigned_by, handover_notes)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [assignId, machineId, dto.newUserId, today, handoverBy, dto.handoverNotes || null]
  );

  // KEY: Update pending tasks → new operator
  // Historical completed tasks stay with original_assigned_to (Ramesh)
  // Only pending/in-progress tasks move to new operator (Suresh)
  await db.query(
    `UPDATE ${TABLE.TASK_MASTER}
     SET current_assigned_to = ?, handover_date = ?
     WHERE machine_id = ? AND status IN ('Pending', 'In Progress')`,
    [dto.newUserId, today, machineId]
  );

  logger.info(`Machine ${machineId} handed over to ${dto.newUserId} by ${handoverBy}`);
}

// ── Get full assignment history ────────────────────────────────────

export async function getAssignmentHistory(machineId: string) {
  await getMachineById(machineId);

  const [rows] = await db.execute<any[]>(
    `SELECT
       ma.assign_id,       ma.assigned_date,   ma.unassigned_date,
       ma.is_active,       ma.handover_notes,
       u.user_id,          u.full_name,        u.employee_code,
       ab.full_name AS assigned_by_name
     FROM ${TABLE.MACHINE_ASSIGNMENTS} ma
     JOIN ${TABLE.USERS}      u  ON ma.user_id     = u.user_id
     LEFT JOIN ${TABLE.USERS} ab ON ma.assigned_by = ab.user_id
     WHERE ma.machine_id = ?
     ORDER BY ma.assigned_date DESC`,
    [machineId]
  );

  return rows;
}

// ── Toggle machine active ─────────────────────────────────────────

export async function toggleMachineActive(
  machineId: string,
  updatedBy: string
): Promise<{ isActive: boolean }> {
  const machine = await getMachineById(machineId);
  const newStatus = machine.isActive ? 0 : 1;

  await db.query(
    `UPDATE ${TABLE.MACHINES} SET is_active = $, updated_at = NOW() WHERE machine_id = ?`,
    [newStatus, machineId]
  );

  return { isActive: Boolean(newStatus) };
}

// ── Mapper ────────────────────────────────────────────────────────

function mapMachine(row: any): Machine {
  return {
    machineId:    row.machine_id,
    machineName:  row.machine_name,
    machineCode:  row.machine_code,
    deptId:       row.dept_id,
    deptName:     row.dept_name,
    machineType:  row.machine_type,
    manufacturer: row.manufacturer,
    modelNumber:  row.model_number,
    serialNumber: row.serial_number,
    installDate:  row.install_date,
    location:     row.location,
    status:       row.status,
    isActive:     Boolean(row.is_active),
    createdAt:    row.created_at,
    currentOperator: row.op_user_id ? {
      userId:       row.op_user_id,
      fullName:     row.op_full_name,
      employeeCode: row.op_employee_code,
      assignedDate: row.op_assigned_date,
    } : null,
  };
}
