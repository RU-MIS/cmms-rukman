import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('products', 'view'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.unit.findMany({ orderBy: { name: 'asc' } });
    ok(res, items);
  })
);

router.post(
  '/',
  requirePermission('products', 'create'),
  [body('name').notEmpty(), body('shortName').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const unit = await prisma.unit.create({ data: { name: req.body.name, shortName: req.body.shortName } });
    await writeAudit(req, 'CREATE', 'units', unit.id, undefined, unit);
    created(res, unit);
  })
);

router.put(
  '/:id',
  requirePermission('products', 'edit'),
  [body('name').notEmpty(), body('shortName').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const unit = await prisma.unit.update({ where: { id }, data: { name: req.body.name, shortName: req.body.shortName } });
    await writeAudit(req, 'UPDATE', 'units', id, undefined, unit);
    ok(res, unit);
  })
);

router.delete(
  '/:id',
  requirePermission('products', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const usage = await prisma.product.count({ where: { unitId: id } });
    if (usage > 0) throw new ApiError(400, 'Cannot delete a unit that is used by products.');
    await prisma.unit.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'units', id);
    ok(res, { deleted: true });
  })
);

export default router;
