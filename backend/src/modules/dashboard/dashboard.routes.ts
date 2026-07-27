/**
 * dashboard.routes.ts
 * ───────────────────
 * Dashboard KPI API endpoints.
 *
 * GET /api/v1/dashboard/kpis           → main KPI cards
 * GET /api/v1/dashboard/dept-compliance → dept-wise chart data
 * GET /api/v1/dashboard/recent-activity → activity feed
 * GET /api/v1/dashboard/today-machines  → today's tasks by machine
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import * as dashboardService from './dashboard.service';

const router = Router();
router.use(authMiddleware);

router.get('/kpis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getDashboardKPIs(
      req.user!.userId, req.user!.roleName, req.user!.deptId
    );
    res.json(successResponse('Dashboard KPIs', data));
  } catch (err) { next(err); }
});

router.get('/dept-compliance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getDeptWiseCompliance();
    res.json(successResponse('Department compliance', data));
  } catch (err) { next(err); }
});

router.get('/recent-activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getRecentActivity(10);
    res.json(successResponse('Recent activity', data));
  } catch (err) { next(err); }
});

router.get('/today-machines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deptId = req.user!.roleName === 'Supervisor' ? req.user!.deptId : undefined;
    const data = await dashboardService.getTodayTasksByMachine(deptId);
    res.json(successResponse('Today tasks by machine', data));
  } catch (err) { next(err); }
});

export default router;
