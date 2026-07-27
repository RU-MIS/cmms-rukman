/**
 * role.middleware.ts
 * ──────────────────
 * Role-Based Access Control (RBAC) middleware.
 * Must be used AFTER authMiddleware (req.user must be populated).
 *
 * Usage:
 *   // Only Admin can create machines
 *   router.post('/machines', authMiddleware, requireRole('Admin'), controller)
 *
 *   // Admin OR Supervisor can verify tasks
 *   router.post('/verify', authMiddleware, requireAnyRole(['Admin','Supervisor']), controller)
 *
 *   // Check specific permission
 *   router.delete('/machines/:id', authMiddleware, requirePermission('machines','D'), controller)
 */

import { Request, Response, NextFunction } from 'express';
import { AppErrors } from './error.middleware';
import { RoleType } from '../config/constants';

/**
 * Allows only specific role(s).
 * @param roles - Single role name or array of role names
 */
export function requireRole(roles: RoleType | RoleType[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (_req: Request, _res: Response, next: NextFunction): void => {
    const user = _req.user;

    if (!user) {
      return next(AppErrors.unauthorized());
    }

    if (!allowedRoles.includes(user.roleName as RoleType)) {
      return next(AppErrors.forbidden());
    }

    next();
  };
}

/**
 * Allows any of the specified roles.
 * Alias for requireRole with array — more readable at call site.
 */
export function requireAnyRole(roles: RoleType[]) {
  return requireRole(roles);
}

/**
 * Checks a specific permission on a module.
 * C=Create R=Read U=Update D=Delete V=Verify
 *
 * @param module - Module name e.g. 'machines', 'tasks'
 * @param action - Permission letter: 'C' | 'R' | 'U' | 'D' | 'V'
 */
export function requirePermission(module: string, action: 'C' | 'R' | 'U' | 'D' | 'V') {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const user = _req.user;

    if (!user) {
      return next(AppErrors.unauthorized());
    }

    const modulePermissions = user.permissions[module];

    if (!modulePermissions || !modulePermissions.includes(action)) {
      return next(AppErrors.forbidden());
    }

    next();
  };
}

/**
 * Allows only the user themselves OR an Admin/Supervisor.
 * Used for routes like "edit my own profile".
 *
 * @param userIdParam - The request param name holding the target user ID
 */
export function requireSelfOrSuperior(userIdParam = 'userId') {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const user = _req.user;

    if (!user) {
      return next(AppErrors.unauthorized());
    }

    const targetUserId = _req.params[userIdParam];
    const isSelf       = user.userId === targetUserId;
    const isSuperior   = ['Admin', 'Supervisor'].includes(user.roleName);

    if (!isSelf && !isSuperior) {
      return next(AppErrors.forbidden());
    }

    next();
  };
}

/**
 * Technician can only access their own department's data.
 * Admin and Supervisor can access all departments.
 */
export function requireDeptAccess() {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const user = _req.user;

    if (!user) {
      return next(AppErrors.unauthorized());
    }

    // Admin + Supervisor see all departments
    if (['Admin', 'Supervisor'].includes(user.roleName)) {
      return next();
    }

    // Technician/Viewer — dept filter applied in service layer
    // We attach their deptId to params so service can filter
    _req.params.deptFilter = user.deptId;

    next();
  };
}
