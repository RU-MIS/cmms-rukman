/**
 * machine.routes.ts
 * ─────────────────
 * Machine management API endpoints.
 *
 * GET    /api/v1/machines                        → list all
 * GET    /api/v1/machines/:id                    → single machine
 * GET    /api/v1/machines/:id/history            → assignment history
 * POST   /api/v1/machines                        → create (Admin)
 * PUT    /api/v1/machines/:id                    → update (Admin/Supervisor)
 * PATCH  /api/v1/machines/:id/status             → change status
 * PATCH  /api/v1/machines/:id/toggle             → activate/deactivate
 * POST   /api/v1/machines/:id/assign             → assign operator
 * POST   /api/v1/machines/:id/handover           → handover to new operator
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRole, requireAnyRole } from '../../middleware/role.middleware';
import { successResponse } from '../../utils/helpers';
import * as machineService from './machine.service';
import { ROLES } from '../../config/constants';

const router = Router();
router.use(authMiddleware);

// ── GET / ─────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await machineService.getAllMachines(req.query as Record<string, unknown>);
    res.json(successResponse('Machines fetched', result.data, result.meta));
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const machine = await machineService.getMachineById(req.params.id);
    res.json(successResponse('Machine fetched', machine));
  } catch (err) { next(err); }
});

// ── GET /:id/history — assignment history ─────────────────────────
router.get('/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await machineService.getAssignmentHistory(req.params.id);
    res.json(successResponse('Assignment history fetched', history));
  } catch (err) { next(err); }
});

// ── POST / — create machine (Admin) ──────────────────────────────
router.post('/',
  requireRole(ROLES.ADMIN),
  [
    body('machineName').trim().notEmpty().withMessage('Machine name is required'),
    body('machineCode').trim().notEmpty().withMessage('Machine code is required'),
    body('deptId').trim().notEmpty().withMessage('Department is required'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const machine = await machineService.createMachine(req.body, req.user!.userId);
      res.status(201).json(successResponse('Machine created', machine));
    } catch (err) { next(err); }
  }
);

// ── PUT /:id — update machine ─────────────────────────────────────
router.put('/:id',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const machine = await machineService.updateMachine(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Machine updated', machine));
    } catch (err) { next(err); }
  }
);

// ── PATCH /:id/status — change status ────────────────────────────
router.patch('/:id/status',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [body('status').notEmpty().withMessage('Status is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const machine = await machineService.updateMachineStatus(
        req.params.id, req.body.status, req.user!.userId
      );
      res.json(successResponse('Machine status updated', machine));
    } catch (err) { next(err); }
  }
);

// ── PATCH /:id/toggle — activate/deactivate ───────────────────────
router.patch('/:id/toggle',
  requireRole(ROLES.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await machineService.toggleMachineActive(req.params.id, req.user!.userId);
      res.json(successResponse(`Machine ${result.isActive ? 'activated' : 'deactivated'}`, result));
    } catch (err) { next(err); }
  }
);

// ── POST /:id/assign — assign operator ───────────────────────────
router.post('/:id/assign',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [body('userId').notEmpty().withMessage('User ID is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await machineService.assignOperator(req.params.id, req.body.userId, req.user!.userId);
      res.json(successResponse('Operator assigned successfully'));
    } catch (err) { next(err); }
  }
);

// ── POST /:id/handover — operator handover ────────────────────────
router.post('/:id/handover',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [
    body('newUserId').notEmpty().withMessage('New operator user ID is required'),
    body('handoverNotes').optional().isString(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await machineService.handoverOperator(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Operator handover completed successfully'));
    } catch (err) { next(err); }
  }
);

export default router;
