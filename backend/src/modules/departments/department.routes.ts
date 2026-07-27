/**
 * department.routes.ts
 * ────────────────────
 * Department API endpoints + controller logic.
 *
 * GET    /api/v1/departments          → list all
 * GET    /api/v1/departments/:id      → single dept
 * POST   /api/v1/departments          → create (Admin only)
 * PUT    /api/v1/departments/:id      → update (Admin only)
 * PATCH  /api/v1/departments/:id/toggle → activate/deactivate (Admin only)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param } from 'express-validator';
import { validationResult } from 'express-validator';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { successResponse, errorResponse } from '../../utils/helpers';
import * as deptService from './department.service';
import { ROLES } from '../../config/constants';

const router = Router();

// All department routes require login
router.use(authMiddleware);

// ── GET / — list all departments ──────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deptService.getAllDepartments(req.query as Record<string, unknown>);
    res.json(successResponse('Departments fetched', result.data, result.meta));
  } catch (err) { next(err); }
});

// ── GET /:id — single department ──────────────────────────────────
router.get('/:id',
  param('id').notEmpty(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dept = await deptService.getDepartmentById(req.params.id);
      res.json(successResponse('Department fetched', dept));
    } catch (err) { next(err); }
  }
);

// ── POST / — create department (Admin only) ───────────────────────
router.post('/',
  requireRole(ROLES.ADMIN),
  [
    body('deptName').trim().notEmpty().withMessage('Department name is required')
      .isLength({ max: 100 }).withMessage('Max 100 characters'),
    body('deptCode').trim().notEmpty().withMessage('Department code is required')
      .isLength({ max: 10 }).withMessage('Max 10 characters')
      .isAlphanumeric().withMessage('Code must be alphanumeric only'),
    body('headUserId').optional().isString(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json(errorResponse('Validation failed',
          errors.array().map(e => ({ field: (e as any).path, message: e.msg }))));
        return;
      }
      const dept = await deptService.createDepartment(req.body, req.user!.userId);
      res.status(201).json(successResponse('Department created', dept));
    } catch (err) { next(err); }
  }
);

// ── PUT /:id — update department (Admin only) ─────────────────────
router.put('/:id',
  requireRole(ROLES.ADMIN),
  [
    body('deptName').optional().trim().isLength({ max: 100 }),
    body('deptCode').optional().trim().isLength({ max: 10 }).isAlphanumeric(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dept = await deptService.updateDepartment(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Department updated', dept));
    } catch (err) { next(err); }
  }
);

// ── PATCH /:id/toggle — activate/deactivate (Admin only) ──────────
router.patch('/:id/toggle',
  requireRole(ROLES.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deptService.toggleDepartmentActive(req.params.id, req.user!.userId);
      res.json(successResponse(`Department ${result.isActive ? 'activated' : 'deactivated'}`, result));
    } catch (err) { next(err); }
  }
);

export default router;
