/**
 * checklist.routes.ts
 * ───────────────────
 * Checklist template + items + assignment API endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRole, requireAnyRole } from '../../middleware/role.middleware';
import { successResponse } from '../../utils/helpers';
import * as checklistService from './checklist.service';
import { ROLES, FREQUENCY, INPUT_TYPE } from '../../config/constants';

const router = Router();
router.use(authMiddleware);

// ── GET / — list all templates ─────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checklistService.getAllTemplates(req.query as Record<string, unknown>);
    res.json(successResponse('Templates fetched', result.data, result.meta));
  } catch (err) { next(err); }
});

// ── GET /:id — template with items ────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const template = await checklistService.getTemplateById(req.params.id);
    res.json(successResponse('Template fetched', template));
  } catch (err) { next(err); }
});

// ── POST / — create template ──────────────────────────────────────
router.post('/',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [
    body('templateName').trim().notEmpty().withMessage('Template name is required'),
    body('deptId').trim().notEmpty().withMessage('Department is required'),
    body('frequency').isIn(Object.values(FREQUENCY)).withMessage('Invalid frequency'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await checklistService.createTemplate(req.body, req.user!.userId);
      res.status(201).json(successResponse('Template created', template));
    } catch (err) { next(err); }
  }
);

// ── PUT /:id — update template ────────────────────────────────────
router.put('/:id',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await checklistService.updateTemplate(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Template updated', template));
    } catch (err) { next(err); }
  }
);

// ── POST /:id/items — add item to template ────────────────────────
router.post('/:id/items',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [
    body('itemText').trim().notEmpty().withMessage('Item text is required'),
    body('inputType').isIn(Object.values(INPUT_TYPE)).withMessage('Invalid input type'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await checklistService.addItem(req.params.id, req.body, req.user!.userId);
      res.status(201).json(successResponse('Item added', item));
    } catch (err) { next(err); }
  }
);

// ── PUT /:id/items/:itemId — update item ──────────────────────────
router.put('/:id/items/:itemId',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await checklistService.updateItem(req.params.itemId, req.body);
      res.json(successResponse('Item updated', item));
    } catch (err) { next(err); }
  }
);

// ── DELETE /:id/items/:itemId — delete item ───────────────────────
router.delete('/:id/items/:itemId',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checklistService.deleteItem(req.params.itemId);
      res.json(successResponse('Item deleted'));
    } catch (err) { next(err); }
  }
);

// ── PUT /:id/items/reorder — drag-drop reorder ────────────────────
router.put('/:id/reorder',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [body('items').isArray().withMessage('Items array is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checklistService.reorderItems(req.params.id, req.body.items);
      res.json(successResponse('Items reordered'));
    } catch (err) { next(err); }
  }
);

// ── POST /:id/assign — assign template to machine ─────────────────
router.post('/:id/assign',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  [
    body('machineId').notEmpty().withMessage('Machine ID is required'),
    body('scheduleStartDate').isDate().withMessage('Valid start date required (YYYY-MM-DD)'),
    body('scheduleDay').optional().isInt({ min: 1, max: 31 }),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checklistService.assignToMachine(req.params.id, req.body, req.user!.userId);
      res.json(successResponse('Template assigned to machine'));
    } catch (err) { next(err); }
  }
);

// ── DELETE /:id/assign/:machineId — unassign ──────────────────────
router.delete('/:id/assign/:machineId',
  requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checklistService.unassignFromMachine(req.params.id, req.params.machineId);
      res.json(successResponse('Template unassigned from machine'));
    } catch (err) { next(err); }
  }
);

export default router;
