/**
 * report.routes.ts
 * ────────────────
 * Report API endpoints.
 *
 * GET /api/v1/reports/compliance   → overall compliance summary
 * GET /api/v1/reports/machines     → machine-wise breakdown
 * GET /api/v1/reports/departments  → dept-wise breakdown
 * GET /api/v1/reports/employees    → employee-wise breakdown
 * GET /api/v1/reports/frequency    → frequency-wise breakdown
 * GET /api/v1/reports/tasks        → detailed task list
 * GET /api/v1/reports/overdue      → overdue aging report
 * GET /api/v1/reports/handover     → operator handover history
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyRole } from '../../middleware/role.middleware';
import { successResponse } from '../../utils/helpers';
import * as reportService from './report.service';
import { ROLES } from '../../config/constants';

const router = Router();
router.use(authMiddleware);
router.use(requireAnyRole([ROLES.ADMIN, ROLES.SUPERVISOR]));

const getFilters = (query: any) => ({
  fromDate:  query.fromDate  || undefined,
  toDate:    query.toDate    || undefined,
  machineId: query.machineId || undefined,
  deptId:    query.deptId    || undefined,
  userId:    query.userId    || undefined,
  frequency: query.frequency || undefined,
  status:    query.status    || undefined,
  page:      query.page      ? parseInt(query.page)  : 1,
  limit:     query.limit     ? parseInt(query.limit) : 20,
});

router.get('/compliance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getComplianceReport(getFilters(req.query));
    res.json(successResponse('Compliance report', data));
  } catch (err) { next(err); }
});

router.get('/machines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getMachineReport(getFilters(req.query));
    res.json(successResponse('Machine report', data.data, data.meta));
  } catch (err) { next(err); }
});

router.get('/departments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getDeptReport(getFilters(req.query));
    res.json(successResponse('Department report', data));
  } catch (err) { next(err); }
});

router.get('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getEmployeeReport(getFilters(req.query));
    res.json(successResponse('Employee report', data.data, data.meta));
  } catch (err) { next(err); }
});

router.get('/frequency', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getFrequencyReport(getFilters(req.query));
    res.json(successResponse('Frequency report', data));
  } catch (err) { next(err); }
});

router.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getTaskDetailReport(getFilters(req.query));
    res.json(successResponse('Task detail report', data.data, data.meta));
  } catch (err) { next(err); }
});

router.get('/overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getOverdueReport(getFilters(req.query));
    res.json(successResponse('Overdue report', data));
  } catch (err) { next(err); }
});

router.get('/handover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reportService.getHandoverReport(getFilters(req.query));
    res.json(successResponse('Handover report', data));
  } catch (err) { next(err); }
});

export default router;
