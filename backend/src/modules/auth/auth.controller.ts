/**
 * auth.controller.ts
 * ──────────────────
 * Handles HTTP layer only — validates input, calls service, sends response.
 * Zero business logic here — that all lives in auth.service.ts.
 *
 * Endpoints:
 * POST /api/v1/auth/login
 * POST /api/v1/auth/logout
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/change-password
 * GET  /api/v1/auth/me
 */

import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { successResponse, errorResponse } from '../../utils/helpers';
import { AppErrors } from '../../middleware/error.middleware';
import * as authService from './auth.service';

// ── POST /api/v1/auth/login ───────────────────────────────────────
export async function loginController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Check validation errors from express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json(errorResponse('Validation failed', errors.array().map(e => ({
        field: (e as any).path,
        message: e.msg,
      }))));
      return;
    }

    const result = await authService.login(req.body);

    // Set refresh token as httpOnly cookie (more secure than localStorage)
    res.cookie('cmms_refresh_token', result.refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json(successResponse('Login successful', {
      user:        result.user,
      accessToken: result.accessToken,
      expiresIn:   result.expiresIn,
    }));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/v1/auth/logout ──────────────────────────────────────
export async function logoutController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const refreshToken = req.cookies?.cmms_refresh_token || req.body?.refreshToken;

    if (refreshToken && req.user) {
      await authService.logout(req.user.userId, refreshToken);
    }

    // Clear the cookie
    res.clearCookie('cmms_refresh_token', {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.status(200).json(successResponse('Logged out successfully'));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/v1/auth/refresh ─────────────────────────────────────
export async function refreshTokenController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get refresh token from cookie or body
    const refreshToken = req.cookies?.cmms_refresh_token || req.body?.refreshToken;

    if (!refreshToken) {
      throw AppErrors.unauthorized();
    }

    const result = await authService.refreshAccessToken(refreshToken);

    res.status(200).json(successResponse('Token refreshed', result));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/v1/auth/change-password ────────────────────────────
export async function changePasswordController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json(errorResponse('Validation failed', errors.array().map(e => ({
        field: (e as any).path,
        message: e.msg,
      }))));
      return;
    }

    if (!req.user) throw AppErrors.unauthorized();

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      throw AppErrors.badRequest('New password and confirm password do not match.');
    }

    await authService.changePassword(req.user.userId, currentPassword, newPassword);

    res.status(200).json(successResponse('Password changed successfully. Please login again.'));
  } catch (err) {
    next(err);
  }
}

// ── GET /api/v1/auth/me ───────────────────────────────────────────
export async function getMeController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw AppErrors.unauthorized();

    // Return fresh user data from DB
    const user = await authService.getUserById(req.user.userId);
    if (!user) throw AppErrors.unauthorized();

    res.status(200).json(successResponse('User profile', user));
  } catch (err) {
    next(err);
  }
}
