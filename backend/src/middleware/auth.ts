import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/response';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  roleId: number;
  roleName: string;
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
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'Not authenticated');
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { role: true },
    });
    if (!user || !user.active) {
      throw new ApiError(401, 'Invalid session');
    }
    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
    };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

export function signToken(userId: number): string {
  return jwt.sign({ userId } as JwtPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}
