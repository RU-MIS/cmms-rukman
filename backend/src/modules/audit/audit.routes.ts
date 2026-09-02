import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { getPageParams, pageMeta } from '../../utils/pagination';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('audit', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const module = req.query.module ? String(req.query.module) : undefined;
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const where: any = { ...(module ? { module: { contains: module } } : {}), ...(userId ? { userId } : {}) };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.auditLog.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

export default router;
