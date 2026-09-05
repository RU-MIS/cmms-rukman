import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/response';
import { runWithCompany } from '../lib/tenantContext';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  companyId: number;
  roleId: number;
  roleName: string;
  isSuperAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface JwtPayload {
  userId: number;
  companyId: number;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'Not authenticated');
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;

    // Re-derived fresh on every request (not embedded in the JWT) so that
    // revoking a user's access to a company, deactivating a user, or
    // deactivating a company takes effect immediately, not after token expiry.
    const membership = await prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId: payload.companyId, userId: payload.userId } },
      include: { user: true, role: true, company: true },
    });
    if (!membership || !membership.user.active || !membership.company.active) {
      throw new ApiError(401, 'Invalid session');
    }
    req.user = {
      id: membership.user.id,
      username: membership.user.username,
      name: membership.user.name,
      companyId: membership.companyId,
      roleId: membership.roleId,
      roleName: membership.role.name,
      isSuperAdmin: membership.user.isSuperAdmin,
    };
    return runWithCompany(membership.companyId, () => next());
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

export function signToken(userId: number, companyId: number): string {
  return jwt.sign({ userId, companyId } as JwtPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}
