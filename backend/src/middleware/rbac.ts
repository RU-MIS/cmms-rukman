import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/response';

const ADMIN_ROLE = 'Admin';

/**
 * requirePermission('sales', 'create') checks that the logged-in user's
 * role has been granted that (module, action) permission. Admin always
 * passes. Action is one of view|create|edit|delete|export|print.
 */
export function requirePermission(module: string, action: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new ApiError(401, 'Not authenticated');
      if (req.user.isSuperAdmin || req.user.roleName === ADMIN_ROLE) return next();

      const grant = await prisma.rolePermission.findFirst({
        where: {
          roleId: req.user.roleId,
          permission: { module, action },
        },
      });
      if (!grant) {
        throw new ApiError(403, `You do not have '${action}' access to '${module}'`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Gates platform-level endpoints (cross-company): manage companies, central config. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new ApiError(401, 'Not authenticated'));
  if (!req.user.isSuperAdmin) return next(new ApiError(403, 'Super admin access required'));
  next();
}
