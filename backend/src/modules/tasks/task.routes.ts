/**
 * task.routes.ts
 * ──────────────
 * Task management API endpoints.
 *
 * GET  /api/v1/tasks/my              → my tasks
 * GET  /api/v1/tasks                 → all tasks (Admin/Supervisor)
 * GET  /api/v1/tasks/overdue         → overdue tasks
 * GET  /api/v1/tasks/:id             → task detail with responses
 * POST /api/v1/tasks/:id/start       → mark in progress
 * POST /api/v1/tasks/:id/submit      → submit responses (complete)
 * POST /api/v1/tasks/:id/verify      → supervisor verify
 * POST /api/v1/tasks/on-demand       → create on-demand task
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRole, requireAnyRole } from '../../middleware/role.middleware';
import { successResponse } from '../../utils/helpers';
import * as taskService from './task.service';
import { ROLES } from '../../config/constants';

const router = Router();
router.use(authMiddleware);

// ── GET /my — my tasks ────────────────────────────────────────────
router.get('/my', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await taskService.getMyTasks(req.user!.userId, req.query as Record<string, unknown>);
    res.json(successResponse('My tasks fetched', result.data, result.meta));
  } catch (err) { next(err); }
});

// ── GET /overdue — overdue tasks ──────────────────────────────────
router.get('/overdue',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = await taskService.getOverdueTasks();
      res.json(successResponse('Overdue tasks fetched', tasks));
    } catch (err) { next(err); }
  }
);

// ── GET / — all tasks ─────────────────────────────────────────────
router.get('/',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await taskService.getAllTasks(req.query as Record<string, unknown>);
      res.json(successResponse('Tasks fetched', result.data, result.meta));
    } catch (err) { next(err); }
  }
);

// ── GET /:id — task detail ────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    res.json(successResponse('Task fetched', task));
  } catch (err) { next(err); }
});

// ── POST /:id/start — start task ──────────────────────────────────
router.post('/:id/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await taskService.startTask(req.params.id, req.user!.userId);
    res.json(successResponse('Task started'));
  } catch (err) { next(err); }
});

// ── POST /:id/submit — submit responses ───────────────────────────
router.post('/:id/submit',
  [body('responses').isArray({ min: 1 }).withMessage('Responses array is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await taskService.submitTask(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Task submitted for verification'));
    } catch (err) { next(err); }
  }
);

// ── POST /:id/verify — supervisor verify ──────────────────────────
router.post('/:id/verify',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [
    body('status')
      .isIn(['Approved', 'Rejected', 'Needs Correction'])
      .withMessage('Status must be Approved, Rejected, or Needs Correction'),
    body('comments').optional().isString(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await taskService.verifyTask(req.params.id, req.body, req.user!.userId);
      res.json(successResponse(`Task ${req.body.status.toLowerCase()}`));
    } catch (err) { next(err); }
  }
);

// ── POST /on-demand — create on-demand task ───────────────────────
router.post('/on-demand',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [
    body('machineId').notEmpty().withMessage('Machine ID required'),
    body('templateId').notEmpty().withMessage('Template ID required'),
    body('assignedTo').notEmpty().withMessage('Assigned user required'),
    body('shiftId').notEmpty().withMessage('Shift required'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { machineId, templateId, assignedTo, shiftId } = req.body;
      const task = await taskService.createOnDemandTask(
        machineId, templateId, assignedTo, shiftId, req.user!.userId
      );
      res.status(201).json(successResponse('On-demand task created', task));
    } catch (err) { next(err); }
  }
);

export default router;
