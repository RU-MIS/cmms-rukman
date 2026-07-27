/**
 * user.routes.ts
 * ──────────────
 * Employee management API endpoints.
 *
 * GET    /api/v1/users                    → list all employees
 * GET    /api/v1/users/:id               → single employee
 * GET    /api/v1/users/:id/machines      → machine history
 * POST   /api/v1/users                   → create employee (Admin)
 * PUT    /api/v1/users/:id               → update (Admin/Supervisor)
 * PATCH  /api/v1/users/:id/toggle        → activate/deactivate (Admin)
 * POST   /api/v1/users/:id/reset-password → reset password (Admin)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { validationResult } from 'express-validator';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRole, requireAnyRole } from '../../middleware/role.middleware';
import { successResponse, errorResponse } from '../../utils/helpers';
import * as userService from './user.service';
import { ROLES } from '../../config/constants';

const router = Router();
router.use(authMiddleware);

// ── GET / — list all employees ────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await userService.getAllUsers(req.query as Record<string, unknown>);
    res.json(successResponse('Users fetched', result.data, result.meta));
  } catch (err) { next(err); }
});

// ── GET /:id — single employee ────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await userService.getUserById(req.params.id);
    res.json(successResponse('User fetched', user));
  } catch (err) { next(err); }
});

// ── GET /:id/machines — machine assignment history ────────────────
router.get('/:id/machines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await userService.getUserMachineHistory(req.params.id);
    res.json(successResponse('Machine history fetched', history));
  } catch (err) { next(err); }
});

// ── POST / — create employee (Admin only) ─────────────────────────
router.post('/',
  requireRole(ROLES.ADMIN),
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('employeeCode').trim().notEmpty().withMessage('Employee code is required'),
    body('roleId').trim().notEmpty().withMessage('Role is required'),
    body('deptId').trim().notEmpty().withMessage('Department is required'),
    body('shiftId').trim().notEmpty().withMessage('Shift is required'),
    body('phone').optional().isMobilePhone('en-IN').withMessage('Invalid phone number'),
    body('email').optional().isEmail().withMessage('Invalid email'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json(errorResponse('Validation failed',
          errors.array().map(e => ({ field: (e as any).path, message: e.msg }))));
        return;
      }

      const result = await userService.createUser(req.body, req.user!.userId);

      // Return temp password only on creation — never stored in plain text again
      res.status(201).json(successResponse('Employee created', {
        ...result.user,
        tempPassword: result.tempPassword, // Show once!
      }));
    } catch (err) { next(err); }
  }
);

// ── PUT /:id — update employee (Admin + Supervisor) ───────────────
router.put('/:id',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await userService.updateUser(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Employee updated', user));
    } catch (err) { next(err); }
  }
);

// ── PATCH /:id/toggle — activate/deactivate (Admin only) ─────────
router.patch('/:id/toggle',
  requireRole(ROLES.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await userService.toggleUserActive(req.params.id, req.user!.userId);
      res.json(successResponse(`Employee ${result.isActive ? 'activated' : 'deactivated'}`, result));
    } catch (err) { next(err); }
  }
);

// ── POST /:id/reset-password — admin resets password ─────────────
router.post('/:id/reset-password',
  requireRole(ROLES.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await userService.resetPassword(req.params.id, req.user!.userId);
      res.json(successResponse('Password reset. Share temp password securely.', result));
    } catch (err) { next(err); }
  }
);

export default router;
