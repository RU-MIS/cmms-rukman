/**
 * auth.routes.ts
 * ──────────────
 * All authentication API routes.
 * Input validation happens here using express-validator.
 *
 * Public routes (no auth required):
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/refresh
 *
 * Protected routes (JWT required):
 *   POST /api/v1/auth/logout
 *   POST /api/v1/auth/change-password
 *   GET  /api/v1/auth/me
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  loginController,
  logoutController,
  refreshTokenController,
  changePasswordController,
  getMeController,
} from './auth.controller';

const router = Router();

// ── POST /login ───────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('username')
      .trim()
      .notEmpty().withMessage('Username is required')
      .isLength({ min: 3, max: 50 }).withMessage('Username must be 3–50 characters'),
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 4 }).withMessage('Password must be at least 4 characters'),
    body('rememberMe')
      .optional()
      .isBoolean().withMessage('rememberMe must be true or false'),
  ],
  loginController
);

// ── POST /logout ──────────────────────────────────────────────────
router.post('/logout', authMiddleware, logoutController);

// ── POST /refresh ─────────────────────────────────────────────────
router.post('/refresh', refreshTokenController);

// ── POST /change-password ─────────────────────────────────────────
router.post(
  '/change-password',
  authMiddleware,
  [
    body('currentPassword')
      .notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .notEmpty().withMessage('New password is required')
      .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and a number'),
    body('confirmPassword')
      .notEmpty().withMessage('Confirm password is required'),
  ],
  changePasswordController
);

// ── GET /me ───────────────────────────────────────────────────────
router.get('/me', authMiddleware, getMeController);

export default router;
