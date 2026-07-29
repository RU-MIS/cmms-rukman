/**
 * department.service.ts
 * ─────────────────────
 * Business logic for Department management.
 *
 * Functions:
 * - getAllDepartments()   → list all active departments
 * - getDepartmentById()  → single department detail
 * - createDepartment()   → create new department
 * - updateDepartment()   → update name/code/head
 * - toggleActive()       → activate/deactivate
 */

import { db } from '../../config/database';
import { TABLE } from '../../config/constants';
import { generateId } from '../../utils/idGenerator';
import { AppErrors } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { parsePagination, buildPaginationMeta } from '../../utils/helpers';

// ── Types ────────────────────────────────────────────────────────

export interface Department {
  deptId:     string;
  deptName:   string;
  deptCode:   string;
  headUserId: string | null;
  headName:   string | null;
  isActive:   boolean;
  createdAt:  string;
}

export interface CreateDepartmentDto {
  deptName:   string;
  deptCode:   string;
  headUserId?: string;
}

export interface UpdateDepartmentDto {
  deptName?:   string;
  deptCode?:   string;
  headUserId?: string | null;
}

// ── Get all departments ───────────────────────────────────────────

export async function getAllDepartments(query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);
  const showInactive = query.showInactive === 'true';

  const whereClause = showInactive ? '' : 'WHERE d.is_active = true';

  const [rows] = await db.execute<any[]>(
    `SELECT
       d.dept_id,    d.dept_name,   d.dept_code,
       d.is_active,  d.created_at,
       d.head_user_id,
       u.full_name AS head_name
     FROM ${TABLE.DEPARTMENTS} d
     LEFT JOIN ${TABLE.USERS} u ON d.head_user_id = u.user_id
     ${whereClause}
     ORDER BY d.dept_name ASC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*) AS total FROM ${TABLE.DEPARTMENTS} d ${whereClause}`
  );

  const total = countRows[0].total;

  return {
    data: rows.map(mapDepartment),
    meta: buildPaginationMeta(total, page, limit),
  };
}

// ── Get department by ID ──────────────────────────────────────────

export async function getDepartmentById(deptId: string): Promise<Department> {
  const [rows] = await db.execute<any[]>(
    `SELECT
       d.dept_id,    d.dept_name,  d.dept_code,
       d.is_active,  d.created_at, d.head_user_id,
       u.full_name AS head_name
     FROM ${TABLE.DEPARTMENTS} d
     LEFT JOIN ${TABLE.USERS} u ON d.head_user_id = u.user_id
     WHERE d.dept_id = ?`,
    [deptId]
  );

  if (rows.length === 0) throw AppErrors.notFound('Department');
  return mapDepartment(rows[0]);
}

// ── Create department ────────────────────────────────────────────

export async function createDepartment(
  dto: CreateDepartmentDto,
  createdBy: string
): Promise<Department> {
  // Check duplicate name
  const [existing] = await db.execute<any[]>(
    `SELECT dept_id FROM ${TABLE.DEPARTMENTS} WHERE dept_name = ? OR dept_code = ?`,
    [dto.deptName, dto.deptCode.toUpperCase()]
  );

  if (existing.length > 0) {
    throw AppErrors.conflict('Department name or code already exists.');
  }

  const deptId = await generateId('DEP');

  await db.query(
    `INSERT INTO ${TABLE.DEPARTMENTS}
       (dept_id, dept_name, dept_code, head_user_id)
     VALUES (?, ?, ?, ?)`,
    [deptId, dto.deptName.trim(), dto.deptCode.toUpperCase().trim(), dto.headUserId || null]
  );

  logger.info(`Department created: ${deptId} — ${dto.deptName} by ${createdBy}`);
  return getDepartmentById(deptId);
}

// ── Update department ────────────────────────────────────────────

export async function updateDepartment(
  deptId: string,
  dto: UpdateDepartmentDto,
  updatedBy: string
): Promise<Department> {
  const existing = await getDepartmentById(deptId);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (dto.deptName !== undefined) {
    fields.push('dept_name = ?');
    values.push(dto.deptName.trim());
  }
  if (dto.deptCode !== undefined) {
    fields.push('dept_code = ?');
    values.push(dto.deptCode.toUpperCase().trim());
  }
  if (dto.headUserId !== undefined) {
    fields.push('head_user_id = ?');
    values.push(dto.headUserId || null);
  }

  if (fields.length === 0) throw AppErrors.badRequest('No fields to update.');

  fields.push('updated_at = NOW()');
  values.push(deptId);

  await db.query(
    `UPDATE ${TABLE.DEPARTMENTS} SET ${fields.join(', ')} WHERE dept_id = ?`,
    values
  );

  logger.info(`Department updated: ${deptId} by ${updatedBy}`);
  return getDepartmentById(deptId);
}

// ── Toggle active status ─────────────────────────────────────────

export async function toggleDepartmentActive(
  deptId: string,
  updatedBy: string
): Promise<{ isActive: boolean }> {
  const dept = await getDepartmentById(deptId);

  const newStatus = dept.isActive ? 0 : 1;
  await db.query(
    `UPDATE ${TABLE.DEPARTMENTS} SET is_active = $, updated_at = NOW() WHERE dept_id = ?`,
    [newStatus, deptId]
  );

  logger.info(`Department ${newStatus ? 'activated' : 'deactivated'}: ${deptId} by ${updatedBy}`);
  return { isActive: Boolean(newStatus) };
}

// ── Mapper ───────────────────────────────────────────────────────

function mapDepartment(row: any): Department {
  return {
    deptId:     row.dept_id,
    deptName:   row.dept_name,
    deptCode:   row.dept_code,
    headUserId: row.head_user_id,
    headName:   row.head_name,
    isActive:   Boolean(row.is_active),
    createdAt:  row.created_at,
  };
}
