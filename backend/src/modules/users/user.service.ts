/**
 * user.service.ts
 * ───────────────
 * Employee management business logic.
 *
 * Functions:
 * - getAllUsers()         → paginated list with filters
 * - getUserById()        → single user detail
 * - createUser()         → create employee account
 * - updateUser()         → update profile
 * - resetPassword()      → admin resets password
 * - toggleActive()       → activate/deactivate
 * - getMachineHistory()  → all machines ever assigned to user
 */

import { db } from '../../config/database';
import { TABLE, ID_PREFIX } from '../../config/constants';
import { generateId } from '../../utils/idGenerator';
import { AppErrors } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import {
  hashPassword, generateTempPassword,
  parsePagination, buildPaginationMeta,
  nameToUsername,
} from '../../utils/helpers';

// ── Types ────────────────────────────────────────────────────────

export interface User {
  userId:       string;
  employeeCode: string;
  fullName:     string;
  username:     string;
  roleId:       string;
  roleName:     string;
  deptId:       string;
  deptName:     string;
  shiftId:      string;
  shiftName:    string;
  phone:        string | null;
  email:        string | null;
  isActive:     boolean;
  lastLogin:    string | null;
  createdAt:    string;
}

export interface CreateUserDto {
  fullName:     string;
  employeeCode: string;
  roleId:       string;
  deptId:       string;
  shiftId:      string;
  phone?:       string;
  email?:       string;
  username?:    string;   // auto-generated if not provided
}

export interface UpdateUserDto {
  fullName?:    string;
  roleId?:      string;
  deptId?:      string;
  shiftId?:     string;
  phone?:       string;
  email?:       string;
}

// ── Get all users ─────────────────────────────────────────────────

export async function getAllUsers(query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.deptId) {
    conditions.push('u.dept_id = ?');
    params.push(query.deptId);
  }
  if (query.roleId) {
    conditions.push('u.role_id = ?');
    params.push(query.roleId);
  }
  if (query.shiftId) {
    conditions.push('u.shift_id = ?');
    params.push(query.shiftId);
  }
  if (query.search) {
    conditions.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.employee_code LIKE ?)');
    const s = `%${query.search}%`;
    params.push(s, s, s);
  }
  if (query.showInactive !== 'true') {
    conditions.push('u.is_active = 1');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await db.execute<any[]>(
    `SELECT
       u.user_id,      u.employee_code,  u.full_name,
       u.username,     u.is_active,      u.last_login,   u.created_at,
       u.phone,        u.email,
       u.role_id,      r.role_name,
       u.dept_id,      d.dept_name,
       u.shift_id,     s.shift_name
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.ROLES}       r ON u.role_id  = r.role_id
     JOIN ${TABLE.DEPARTMENTS} d ON u.dept_id  = d.dept_id
     JOIN ${TABLE.SHIFTS}      s ON u.shift_id = s.shift_id
     ${where}
     ORDER BY u.full_name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*) AS total
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.ROLES}       r ON u.role_id  = r.role_id
     JOIN ${TABLE.DEPARTMENTS} d ON u.dept_id  = d.dept_id
     JOIN ${TABLE.SHIFTS}      s ON u.shift_id = s.shift_id
     ${where}`,
    params
  );

  return {
    data: rows.map(mapUser),
    meta: buildPaginationMeta(countRows[0].total, page, limit),
  };
}

// ── Get user by ID ────────────────────────────────────────────────

export async function getUserById(userId: string): Promise<User> {
  const [rows] = await db.execute<any[]>(
    `SELECT
       u.user_id,      u.employee_code,  u.full_name,
       u.username,     u.is_active,      u.last_login,   u.created_at,
       u.phone,        u.email,
       u.role_id,      r.role_name,
       u.dept_id,      d.dept_name,
       u.shift_id,     s.shift_name
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.ROLES}       r ON u.role_id  = r.role_id
     JOIN ${TABLE.DEPARTMENTS} d ON u.dept_id  = d.dept_id
     JOIN ${TABLE.SHIFTS}      s ON u.shift_id = s.shift_id
     WHERE u.user_id = ?`,
    [userId]
  );

  if (rows.length === 0) throw AppErrors.notFound('User');
  return mapUser(rows[0]);
}

// ── Create user ───────────────────────────────────────────────────

export async function createUser(
  dto: CreateUserDto,
  createdBy: string
): Promise<{ user: User; tempPassword: string }> {
  // Auto-generate username if not provided
  const username = dto.username || nameToUsername(dto.fullName);

  // Check unique constraints
  const [existing] = await db.execute<any[]>(
    `SELECT user_id FROM ${TABLE.USERS}
     WHERE username = ? OR employee_code = ?`,
    [username, dto.employeeCode]
  );

  if (existing.length > 0) {
    throw AppErrors.conflict('Username or employee code already exists.');
  }

  const userId      = await generateId('USR');
  const tempPass    = generateTempPassword();
  const passHash    = await hashPassword(tempPass);

  await db.query(
    `INSERT INTO ${TABLE.USERS}
       (user_id, employee_code, full_name, username, password_hash,
        role_id, dept_id, shift_id, phone, email, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, dto.employeeCode, dto.fullName.trim(), username, passHash,
      dto.roleId, dto.deptId, dto.shiftId,
      dto.phone || null, dto.email || null, createdBy,
    ]
  );

  logger.info(`User created: ${userId} — ${dto.fullName} by ${createdBy}`);

  const user = await getUserById(userId);
  return { user, tempPassword: tempPass };
}

// ── Update user ───────────────────────────────────────────────────

export async function updateUser(
  userId: string,
  dto: UpdateUserDto,
  updatedBy: string
): Promise<User> {
  await getUserById(userId); // throws if not found

  const fields: string[] = [];
  const values: unknown[] = [];

  if (dto.fullName)  { fields.push('full_name = ?');  values.push(dto.fullName.trim()); }
  if (dto.roleId)    { fields.push('role_id = ?');    values.push(dto.roleId); }
  if (dto.deptId)    { fields.push('dept_id = ?');    values.push(dto.deptId); }
  if (dto.shiftId)   { fields.push('shift_id = ?');   values.push(dto.shiftId); }
  if (dto.phone !== undefined) { fields.push('phone = ?'); values.push(dto.phone || null); }
  if (dto.email !== undefined) { fields.push('email = ?'); values.push(dto.email || null); }

  if (fields.length === 0) throw AppErrors.badRequest('No fields to update.');

  fields.push('updated_at = NOW()');
  values.push(userId);

  await db.query(
    `UPDATE ${TABLE.USERS} SET ${fields.join(', ')} WHERE user_id = ?`,
    values
  );

  logger.info(`User updated: ${userId} by ${updatedBy}`);
  return getUserById(userId);
}

// ── Admin reset password ──────────────────────────────────────────

export async function resetPassword(
  userId: string,
  resetBy: string
): Promise<{ tempPassword: string }> {
  await getUserById(userId);

  const tempPass = generateTempPassword();
  const passHash = await hashPassword(tempPass);

  await db.query(
    `UPDATE ${TABLE.USERS} SET password_hash = ?, updated_at = NOW() WHERE user_id = ?`,
    [passHash, userId]
  );

  logger.info(`Password reset for user: ${userId} by ${resetBy}`);
  return { tempPassword: tempPass };
}

// ── Toggle active ─────────────────────────────────────────────────

export async function toggleUserActive(
  userId: string,
  updatedBy: string
): Promise<{ isActive: boolean }> {
  const user = await getUserById(userId);
  const newStatus = user.isActive ? 0 : 1;

  await db.query(
    `UPDATE ${TABLE.USERS} SET is_active = ?, updated_at = NOW() WHERE user_id = ?`,
    [newStatus, userId]
  );

  logger.info(`User ${newStatus ? 'activated' : 'deactivated'}: ${userId} by ${updatedBy}`);
  return { isActive: Boolean(newStatus) };
}

// ── Get machine assignment history for a user ─────────────────────

export async function getUserMachineHistory(userId: string) {
  await getUserById(userId);

  const [rows] = await db.execute<any[]>(
    `SELECT
       ma.assign_id,     ma.assigned_date,   ma.unassigned_date,
       ma.is_active,     ma.handover_notes,
       m.machine_id,     m.machine_name,     m.machine_code,
       d.dept_name,
       ab.full_name AS assigned_by_name
     FROM ${TABLE.MACHINE_ASSIGNMENTS} ma
     JOIN ${TABLE.MACHINES}    m  ON ma.machine_id  = m.machine_id
     JOIN ${TABLE.DEPARTMENTS} d  ON m.dept_id      = d.dept_id
     LEFT JOIN ${TABLE.USERS}  ab ON ma.assigned_by = ab.user_id
     WHERE ma.user_id = ?
     ORDER BY ma.assigned_date DESC`,
    [userId]
  );

  return rows;
}

// ── Mapper ────────────────────────────────────────────────────────

function mapUser(row: any): User {
  return {
    userId:       row.user_id,
    employeeCode: row.employee_code,
    fullName:     row.full_name,
    username:     row.username,
    roleId:       row.role_id,
    roleName:     row.role_name,
    deptId:       row.dept_id,
    deptName:     row.dept_name,
    shiftId:      row.shift_id,
    shiftName:    row.shift_name,
    phone:        row.phone,
    email:        row.email,
    isActive:     Boolean(row.is_active),
    lastLogin:    row.last_login,
    createdAt:    row.created_at,
  };
}
