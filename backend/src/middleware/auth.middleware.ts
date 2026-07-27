/**
 * auth.middleware.ts
 * ──────────────────
 * JWT verification middleware.
 * Attach to any route that requires authentication.
 *
 * What it does:
 * 1. Reads Bearer token from Authorization header
 * 2. Verifies JWT signature + expiry
 * 3. Fetches fresh user data from DB
 * 4. Attaches user to req.user for downstream use
 *
 * Usage:
 *   router.get('/machines', authMiddleware, machineController.list)
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/environment';
import { TOKEN } from '../config/constants';
import { AppErrors } from './error.middleware';
import { getUserById } from '../modules/auth/auth.service';
import { TokenPayload } from '../modules/auth/auth.types';
import { logger } from '../utils/logger';

/**
 * Verifies JWT and populates req.user.
 * Throws 401 if token is missing, invalid, or expired.
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Extract token from Authorization: Bearer <token>
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith(TOKEN.BEARER_PREFIX)) {
      throw AppErrors.unauthorized();
    }

    const token = authHeader.slice(TOKEN.BEARER_PREFIX.length);

    if (!token) throw AppErrors.unauthorized();

    // 2. Verify JWT signature and expiry
    let decoded: TokenPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw AppErrors.unauthorized();
      }
      throw AppErrors.unauthorized();
    }

    // 3. Fetch fresh user from DB (ensures deactivated users are rejected)
    const user = await getUserById(decoded.userId);

    if (!user) {
      logger.warn(`Auth middleware: user not found or inactive: ${decoded.userId}`);
      throw AppErrors.unauthorized();
    }

    // 4. Attach user + token to request
    req.user  = user;
    req.token = token;

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth middleware — attaches user if token is present,
 * but does NOT throw if token is missing.
 * Use for routes that work both logged in and logged out.
 */
export async function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith(TOKEN.BEARER_PREFIX)) {
      return next(); // No token — continue without user
    }

    const token = authHeader.slice(TOKEN.BEARER_PREFIX.length);
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    const user = await getUserById(decoded.userId);

    if (user) {
      req.user  = user;
      req.token = token;
    }

    next();
  } catch {
    next(); // Token invalid — continue without user
  }
}
