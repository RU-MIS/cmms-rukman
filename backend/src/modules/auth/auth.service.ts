/**
 * auth.service.ts
 * ───────────────
 * All authentication business logic lives here.
 * Controller calls these functions — no DB or JWT logic in controller.
 *
 * Functions:
 * - login()          → verify credentials, generate tokens
 * - logout()         → invalidate refresh token
 * - refreshToken()   → generate new access token from refresh token
 * - changePassword() → verify old password, hash new one
 * - getUserById()    → fetch full user with role + dept + shift
 */

import jwt from 'jsonwebtoken';
import { db } from '../../config/database';
import { env } from '../../config/environment';
import { TABLE } from '../../config/constants';
import { logger } from '../../utils/logger';
import { verifyPassword, hashPassword } from '../../utils/helpers';
import { generateId } from '../../utils/idGenerator';
import {
  LoginRequest,
  LoginResponse,
  AuthUser,
  TokenPayload,
} from './auth.types';
import { AppErrors } from '../../middleware/error.middleware';

// ── In-memory refresh token blacklist ────────────────────────────
// For production scale, use Redis. For now, a Set works fine.
const revokedTokens = new Set<string>();

// ── Main login function ───────────────────────────────────────────

/**
 * Verifies username + password, returns user data + JWT tokens.
 * Throws AppError on invalid credentials or inactive user.
 */
export async function login(body: LoginRequest): Promise<LoginResponse> {
  const { username, password, rememberMe = false } = body;

  // 1. Find user by username — join with roles, departments, shifts
  const [rows] = await db.execute<any[]>(
    `SELECT
       u.user_id,        u.employee_code,  u.full_name,
       u.username,       u.password_hash,  u.is_active,
       u.role_id,        r.role_name,      r.permissions,
       u.dept_id,        d.dept_name,
       u.shift_id,       s.shift_name
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.ROLES}       r ON u.role_id  = r.role_id
     JOIN ${TABLE.DEPARTMENTS} d ON u.dept_id  = d.dept_id
     JOIN ${TABLE.SHIFTS}      s ON u.shift_id = s.shift_id
     WHERE u.username = ?
     LIMIT 1`,
    [username.toLowerCase().trim()]
  );

  if (rows.length === 0) {
    // Don't reveal whether username exists or not
    throw AppErrors.badRequest('Invalid username or password.');
  }

  const user = rows[0];

  // 2. Check if account is active
  if (!user.is_active) {
    throw AppErrors.badRequest('Your account has been deactivated. Contact your administrator.');
  }

  // 3. Verify password
  const isPasswordValid = await verifyPassword(password, user.password_hash);
  if (!isPasswordValid) {
    logger.warn(`Failed login attempt for username: ${username}`);
    throw AppErrors.badRequest('Invalid username or password.');
  }

  // 4. Parse permissions from JSON
  let permissions: Record<string, string[]> = {};
  try {
    permissions = typeof user.permissions === 'string'
      ? JSON.parse(user.permissions)
      : user.permissions;
  } catch {
    permissions = {};
  }

  // 5. Build auth user object
  const authUser: AuthUser = {
    userId:       user.user_id,
    employeeCode: user.employee_code,
    fullName:     user.full_name,
    username:     user.username,
    roleId:       user.role_id,
    roleName:     user.role_name,
    deptId:       user.dept_id,
    deptName:     user.dept_name,
    shiftId:      user.shift_id,
    shiftName:    user.shift_name,
    permissions,
  };

  // 6. Generate JWT tokens
  const tokenPayload: TokenPayload = {
    userId:   user.user_id,
    username: user.username,
    roleId:   user.role_id,
    roleName: user.role_name,
    deptId:   user.dept_id,
  };

  const accessToken = jwt.sign(tokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });

  // rememberMe = true → 7 days, false → 8 hours
  const refreshExpiresIn = rememberMe ? '7d' : env.JWT_REFRESH_EXPIRES_IN;
  const refreshToken = jwt.sign(
    { userId: user.user_id, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: refreshExpiresIn as any }
  );

  // 7. Update last_login timestamp
  await db.query(
    `UPDATE ${TABLE.USERS} SET last_login = NOW() WHERE user_id = ?`,
    [user.user_id]
  );

  // 8. Write audit log
  await writeAuditLog(user.user_id, 'LOGIN', 'Auth', user.user_id);

  logger.info(`User logged in: ${user.username} (${user.role_name})`);

  return {
    user:        authUser,
    accessToken,
    refreshToken,
    expiresIn:   8 * 60 * 60, // 8 hours in seconds
  };
}

// ── Logout ───────────────────────────────────────────────────────

/**
 * Adds refresh token to blacklist.
 * Access token expiry is handled by JWT exp claim.
 */
export async function logout(userId: string, refreshToken: string): Promise<void> {
  revokedTokens.add(refreshToken);
  await writeAuditLog(userId, 'LOGOUT', 'Auth', userId);
  logger.info(`User logged out: ${userId}`);
}

// ── Refresh token ────────────────────────────────────────────────

/**
 * Verifies refresh token, issues a new access token.
 * Refresh token must not be in the revoked list.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  // Check if token is revoked
  if (revokedTokens.has(refreshToken)) {
    throw AppErrors.unauthorized();
  }

  // Verify refresh token
  let decoded: any;
  try {
    decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
  } catch {
    throw AppErrors.unauthorized();
  }

  if (decoded.type !== 'refresh') {
    throw AppErrors.unauthorized();
  }

  // Fetch fresh user data
  const user = await getUserById(decoded.userId);
  if (!user) throw AppErrors.unauthorized();

  // Issue new access token
  const tokenPayload: TokenPayload = {
    userId:   user.userId,
    username: user.username,
    roleId:   user.roleId,
    roleName: user.roleName,
    deptId:   user.deptId,
  };

  const accessToken = jwt.sign(tokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });

  return { accessToken };
}

// ── Change password ───────────────────────────────────────────────

/**
 * Verifies current password, then saves new hashed password.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  // Get current hash
  const [rows] = await db.execute<any[]>(
    `SELECT password_hash FROM ${TABLE.USERS} WHERE user_id = ?`,
    [userId]
  );

  if (rows.length === 0) throw AppErrors.notFound('User');

  const isValid = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!isValid) {
    throw AppErrors.badRequest('Current password is incorrect.');
  }

  // Validate new password strength
  if (newPassword.length < 8) {
    throw AppErrors.badRequest('New password must be at least 8 characters.');
  }

  const newHash = await hashPassword(newPassword);
  await db.query(
    `UPDATE ${TABLE.USERS} SET password_hash = ?, updated_at = NOW() WHERE user_id = ?`,
    [newHash, userId]
  );

  await writeAuditLog(userId, 'UPDATE', 'Auth', userId, {}, { action: 'password_changed' });
  logger.info(`Password changed for user: ${userId}`);
}

// ── Get user by ID ────────────────────────────────────────────────

/**
 * Fetch full user profile with role, dept, shift.
 * Used by auth middleware to populate req.user.
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const [rows] = await db.execute<any[]>(
    `SELECT
       u.user_id,        u.employee_code,  u.full_name,
       u.username,       u.is_active,
       u.role_id,        r.role_name,      r.permissions,
       u.dept_id,        d.dept_name,
       u.shift_id,       s.shift_name
     FROM ${TABLE.USERS} u
     JOIN ${TABLE.ROLES}       r ON u.role_id  = r.role_id
     JOIN ${TABLE.DEPARTMENTS} d ON u.dept_id  = d.dept_id
     JOIN ${TABLE.SHIFTS}      s ON u.shift_id = s.shift_id
     WHERE u.user_id = ? AND u.is_active = 1
     LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) return null;

  const user = rows[0];
  let permissions: Record<string, string[]> = {};
  try {
    permissions = typeof user.permissions === 'string'
      ? JSON.parse(user.permissions)
      : user.permissions;
  } catch {
    permissions = {};
  }

  return {
    userId:       user.user_id,
    employeeCode: user.employee_code,
    fullName:     user.full_name,
    username:     user.username,
    roleId:       user.role_id,
    roleName:     user.role_name,
    deptId:       user.dept_id,
    deptName:     user.dept_name,
    shiftId:      user.shift_id,
    shiftName:    user.shift_name,
    permissions,
  };
}

// ── Audit log helper ─────────────────────────────────────────────

/**
 * Writes a record to audit_logs table.
 * Fire-and-forget — never blocks the main flow.
 */
async function writeAuditLog(
  userId: string,
  action: string,
  module: string,
  recordId: string,
  oldValue: object = {},
  newValue: object = {}
): Promise<void> {
  try {
    const logId = await generateId('LOG');
    await db.query(
      `INSERT INTO ${TABLE.AUDIT_LOGS}
         (log_id, user_id, action, module, record_id, old_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [logId, userId, action, module, recordId,
       JSON.stringify(oldValue), JSON.stringify(newValue)]
    );
  } catch (err) {
    // Never fail the main request because of audit log error
    logger.error('Audit log write failed', { err });
  }
}
